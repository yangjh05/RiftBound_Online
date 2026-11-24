import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectEnv } from "./load-project-env.mjs";
import { resolvePublicStaticPath } from "../server/public-static.mjs";
import { healthPayload, securityHeaders } from "../server/http-security.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadProjectEnv(root);
const [{ handleMultiplayerRequest }, { handleUpdateRequest }] = await Promise.all([
  import("../server/http-multiplayer.mjs"),
  import("../server/updates.mjs")
]);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

async function handleRequest(req, res) {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/health/ready")) {
    res.writeHead(200, securityHeaders({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }));
    res.end(JSON.stringify(healthPayload()));
    return;
  }
  if (await handleUpdateRequest(req, res, { root })) return;
  if (await handleMultiplayerRequest(req, res)) return;

  const filePath = resolvePublicStaticPath(root, req.url || "/");
  if (!filePath) {
    res.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, securityHeaders({
      "content-type": types.get(path.extname(filePath)) || "application/octet-stream"
    }));
    res.end(data);
  } catch {
    res.writeHead(404, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("Request failed:", error);
    if (res.headersSent || res.writableEnded || res.destroyed) {
      if (!res.writableEnded && !res.destroyed) res.destroy();
      return;
    }
    res.writeHead(500, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Internal server error");
  });
});

server.listen(port, host, () => {
  console.log(`Riftbound Online: http://${host}:${port}`);
});
