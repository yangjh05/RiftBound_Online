import {
  createRoom,
  joinRoom,
  leaveRoom,
  listRooms,
  runCommand,
  setReady,
  submitDeck,
  subscribe
} from "./rooms.mjs";
import {
  MAX_AI_REPLAY_REQUEST_BYTES,
  listAiGenerations,
  listAiSpectatorReplays,
  readAiGenerationCheckpoint,
  readAiSpectatorReplay,
  readAiStatus,
  storeAiReplay
} from "./ai-data.mjs";
import { handleAccountRequest } from "./http-accounts.mjs";
import { handleBugReportRequest } from "./http-bug-reports.mjs";
import { securityHeaders } from "./http-security.mjs";
import { handleDeckCardImageRequest } from "./deck-card-images.mjs";
import {deckLeagueCatalog,deckLeagueCheckpoint} from './deck-league-data.mjs';
import {fileURLToPath} from 'node:url';
const leagueProjectRoot=fileURLToPath(new URL('../',import.meta.url));

export async function handleMultiplayerRequest(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders({
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400"
    }));
    res.end();
    return true;
  }

  try {
    if (await handleDeckCardImageRequest(req, res)) return true;
    if (await handleAccountRequest(req, res, { json, readJson })) return true;
    if (await handleBugReportRequest(req, res, { json, readJson })) return true;

    if (req.method === "GET" && url.pathname === "/api/rooms") {
      return json(res, 200, { ok: true, rooms: listRooms() });
    }

    if (req.method === "GET" && url.pathname === "/api/ai/status") {
      return json(res, 200, { ok: true, status: await readAiStatus() });
    }

    if (req.method === "GET" && url.pathname === "/api/ai/generations") {
      return json(res, 200, { ok: true, generations: await listAiGenerations(), deckModels:await deckLeagueCatalog(leagueProjectRoot) });
    }

    const specialistModelMatch=url.pathname.match(/^\/api\/ai\/models\/([a-z0-9-]+)\/model$/);
    if(req.method==='GET'&&specialistModelMatch){
      const checkpoint=await deckLeagueCheckpoint(leagueProjectRoot,specialistModelMatch[1]);
      if(!checkpoint)return json(res,404,{ok:false,message:'AI model was not found.'});
      res.writeHead(200,corsHeaders({'content-type':'application/json; charset=utf-8','cache-control':'no-store',
        'content-length':checkpoint.contents.length}));res.end(checkpoint.contents);return true;
    }

    const generationModelMatch = url.pathname.match(/^\/api\/ai\/generations\/(\d+)\/model$/u);
    if (req.method === "GET" && generationModelMatch) {
      const checkpoint = await readAiGenerationCheckpoint(generationModelMatch[1]);
      if (!checkpoint) return json(res, 404, { ok: false, message: "AI generation was not found." });
      res.writeHead(200, corsHeaders({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": checkpoint.contents.length
      }));
      res.end(checkpoint.contents);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/ai/selfplay-replays") {
      return json(res, 200, { ok: true, replays: await listAiSpectatorReplays({ limit: url.searchParams.get("limit") }) });
    }

    const spectatorReplayMatch = url.pathname.match(/^\/api\/ai\/selfplay-replays\/([^/]+)$/);
    if (req.method === "GET" && spectatorReplayMatch) {
      const replay = await readAiSpectatorReplay(decodeURIComponent(spectatorReplayMatch[1]));
      return replay
        ? json(res, 200, { ok: true, replay })
        : json(res, 404, { ok: false, message: "AI spectator replay was not found." });
    }

    if (req.method === "POST" && url.pathname === "/api/ai/replays") {
      const body = await readJson(req, MAX_AI_REPLAY_REQUEST_BYTES);
      const stored = await storeAiReplay(body.replay);
      return json(res, 200, { ok: true, ...stored });
    }

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(req);
      const result = createRoom({
        sideboardingEnabled: body.sideboardingEnabled === true,
        poolId: body.poolId,
        banlistEnabled: body.banlistEnabled === true
      });
      return json(res, 200, { ok: true, ...result });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/([^/]+)$/);
    if (!match) return json(res, 404, { ok: false, message: "Unknown API route." });

    const roomId = decodeURIComponent(match[1]).toUpperCase();
    const action = match[2];

    if (req.method === "GET" && action === "events") {
      req.socket.setTimeout(0);
      res.writeHead(200, {
        ...corsHeaders(),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no"
      });
      res.flushHeaders?.();
      const result = subscribe(roomId, url.searchParams.get("token") || "", res);
      if (!result.ok) {
        res.write(`event: server-error\ndata: ${JSON.stringify({ message: result.message })}\n\n`);
        res.end();
      }
      return true;
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed." });
    const body = await readJson(req);

    if (action === "join") return jsonResult(res, joinRoom(roomId, body.playerToken));
    if (action === "leave") return jsonResult(res, leaveRoom(roomId, body.playerToken));
    if (action === "deck") return jsonResult(res, submitDeck(roomId, body.playerToken, body.deckRecord));
    if (action === "ready") return jsonResult(res, setReady(roomId, body.playerToken, body.ready !== false));
    if (action === "commands") return jsonResult(res, runCommand(roomId, body.playerToken, body.command));

    return json(res, 404, { ok: false, message: "Unknown API route." });
  } catch (error) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status : 500;
    return json(res, status, {
      ok: false,
      message: error?.message || "Server error.",
      ...(typeof error?.code === "string" && status < 500 ? { code: error.code } : {})
    });
  }
}

function jsonResult(res, result) {
  return json(res, result.ok ? 200 : 400, result);
}

function json(res, status, payload) {
  res.writeHead(status, corsHeaders({ "content-type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(payload));
  return true;
}

function corsHeaders(extra = {}) {
  return securityHeaders({
    "access-control-allow-origin": "*",
    ...extra
  });
}

async function readJson(req, maximumBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      error.code = "request_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
