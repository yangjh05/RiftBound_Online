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
import { readAiStatus, storeAiReplay } from "./ai-data.mjs";

export async function handleMultiplayerRequest(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders({
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, ngrok-skip-browser-warning",
      "access-control-max-age": "86400"
    }));
    res.end();
    return true;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/rooms") {
      return json(res, 200, { ok: true, rooms: listRooms() });
    }

    if (req.method === "GET" && url.pathname === "/api/ai/status") {
      return json(res, 200, { ok: true, status: await readAiStatus() });
    }

    if (req.method === "POST" && url.pathname === "/api/ai/replays") {
      const body = await readJson(req);
      const stored = await storeAiReplay(body.replay);
      return json(res, 200, { ok: true, ...stored });
    }

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(req);
      const result = createRoom({ sideboardingEnabled: body.sideboardingEnabled === true });
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
    return json(res, 500, { ok: false, message: error?.message || "Server error." });
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
  return {
    "access-control-allow-origin": "*",
    ...extra
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
