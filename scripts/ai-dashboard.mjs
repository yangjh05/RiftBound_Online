import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createDashboardReader } from "../server/training-dashboard-data.mjs";
import { createPriorityController, PRIORITIES } from "../server/training-dashboard-priority.mjs";
import {readDeckLeague} from '../server/deck-league-data.mjs';

export async function startDashboard({ projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  port = 4180, dataRoot = path.join(projectRoot, "data/ai"), runDirectory = null,
  priorityController = createPriorityController({ projectRoot }), readSnapshot,
  readLeagueSnapshot=()=>readDeckLeague(projectRoot) } = {}) {
  const token = randomBytes(32).toString("hex");
  const reader = readSnapshot || createDashboardReader({ dataRoot, runDirectory, getProcesses: () => priorityController.processes });
  let cached = null, pending = null, priorityError = null, refreshBusy = false;
  async function refreshPriority() {
    if (refreshBusy) return;
    refreshBusy = true;
    try { await priorityController.refresh(); priorityError = null; }
    catch (error) { priorityError = error.message; }
    finally { refreshBusy = false; }
  }
  await refreshPriority();
  const timer = setInterval(refreshPriority, 3000);
  timer.unref();
  async function snapshot() {
    if (cached && Date.now() - cached.time < 2500) return cached.value;
    if (!pending) pending = reader().then(value => { cached = { time: Date.now(), value }; return value; }).finally(() => { pending = null; });
    return pending;
  }
  const assets = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/legacy", ["index.html", "text/html; charset=utf-8"]],
    ["/league", ["league.html", "text/html; charset=utf-8"]],
    ["/league.mjs", ["league.mjs", "text/javascript; charset=utf-8"]],
    ["/league.css", ["league.css", "text/css; charset=utf-8"]],
    ["/dashboard.mjs", ["dashboard.mjs", "text/javascript; charset=utf-8"]],
    ["/structure.mjs", ["structure.mjs", "text/javascript; charset=utf-8"]],
    ["/dashboard.css", ["dashboard.css", "text/css; charset=utf-8"]]
  ]);
  const server = http.createServer((req, res) => { void handle(req, res).catch(error => {
    if (!res.headersSent) respond(res, 500, { error: error.message }); else res.end();
  }); });
  function respond(res, status, body, type = "application/json; charset=utf-8") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
  }
  async function handle(req, res) {
    const authority = req.headers.host;
    const actualPort = server.address()?.port;
    if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(authority)
      || !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(req.socket.remoteAddress)
      || req.headers["sec-fetch-site"] === "cross-site") return respond(res, 403, { error: "이 PC의 대시보드에서만 접근할 수 있습니다." });
    const pathname = new URL(req.url, `http://${authority}`).pathname;
    if(req.method==='GET' && pathname==='/api/deck-league')return respond(res,200,await readLeagueSnapshot());
    if(req.method==='GET' && pathname==='/' && await readLeagueSnapshot())return respond(res,200,await readFile(path.join(projectRoot,'training-dashboard/league.html')),'text/html; charset=utf-8');
    if (req.method === "GET" && pathname === "/api/state") {
      return respond(res, 200, { ...await snapshot(), priority: { ...priorityController.status, monitorError: priorityError }, token });
    }
    if (pathname === "/api/priority" && req.method === "POST") {
      const supplied = Buffer.from(String(req.headers["x-dashboard-token"] || ""));
      if (req.headers.origin !== `http://${authority}` || supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return respond(res, 403, { error: "대시보드를 새로고침한 뒤 다시 시도해 주세요." });
      if (!req.headers["content-type"]?.startsWith("application/json")) return respond(res, 415, { error: "JSON 요청이 필요합니다." });
      let body = "";
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return respond(res, 413, { error: "요청이 너무 큽니다." }); }
      let input;
      try { input = JSON.parse(body); } catch { return respond(res, 400, { error: "요청 형식이 잘못되었습니다." }); }
      if (!Object.hasOwn(PRIORITIES, input?.priority)) return respond(res, 400, { error: "지원하지 않는 우선순위입니다." });
      return respond(res, 200, await priorityController.set(input.priority));
    }
    if (req.method !== "GET") return respond(res, 405, { error: "지원하지 않는 요청입니다." });
    const asset = assets.get(pathname);
    if (!asset) return respond(res, 404, { error: "페이지를 찾을 수 없습니다." });
    return respond(res, 200, await readFile(path.join(projectRoot, "training-dashboard", asset[0])), asset[1]);
  }
  server.on("close", () => clearInterval(timer));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  } catch (error) { clearInterval(timer); throw error; }
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const { server, url } = await startDashboard({ port: Number(value("--port") || process.env.RIFTBOUND_AI_DASHBOARD_PORT || 4180),
    ...(value("--data-dir") ? { dataRoot: path.resolve(value("--data-dir")) } : {}),
    runDirectory: value("--run-dir") || process.env.RIFTBOUND_AI_DASHBOARD_RUN_DIR || null });
  console.log(`AI 학습 대시보드: ${url}`);
  console.log("3초마다 갱신합니다. 이 창을 닫으면 대시보드가 종료됩니다.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
}
