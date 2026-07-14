import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, ".desktop_runtime");
const electronCli = path.join(runtime, "node_modules", "electron", "cli.js");
const host = process.env.HOST || "127.0.0.1";
const preferredPort = Number(process.env.PORT || 4173);

if (!existsSync(electronCli)) {
  console.error("Desktop runtime is not installed. Run: npm run desktop:setup");
  process.exit(1);
}

const { url, server } = await prepareLocalServer();

const child = spawn(process.execPath, [electronCli, root], {
  cwd: root,
  env: {
    ...process.env,
    RIFTBOUND_DESKTOP_URL: url
  },
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code, signal) => {
  if (server) server.kill();
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

async function prepareLocalServer() {
  const preferredUrl = `http://${host}:${preferredPort}`;
  if (await isRiftboundServer(preferredUrl)) return { url: preferredUrl, server: null };

  const port = await findAvailablePort(preferredPort);
  const url = `http://${host}:${port}`;
  const server = spawn(process.execPath, [path.join(root, "scripts", "dev-server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port)
    },
    stdio: "inherit",
    windowsHide: true
  });

  await waitForServer(url);
  return { url, server };
}

function isRiftboundServer(url) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/rooms`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve(response.statusCode === 200 && body.includes('"rooms"'));
      });
    });
    request.on("error", () => resolve(false));
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const probe = net.createServer();
      probe.once("error", () => tryPort(port + 1));
      probe.once("listening", () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, host);
    };
    try {
      tryPort(startPort);
    } catch (error) {
      reject(error);
    }
  });
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    if (await isRiftboundServer(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Desktop server did not start: ${url}`);
}
