const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { startAutoUpdate } = require("./updater.cjs");

const root = path.resolve(__dirname, "..");
const desktopUrl = process.env.RIFTBOUND_DESKTOP_URL || "";
const host = "127.0.0.1";
const preferredPort = 4173;
let updateCheckStarted = false;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

async function createWindow() {
  const appUrl = desktopUrl || await startBundledServer();
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Riftbound Online",
    backgroundColor: "#111318",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadURL(appUrl);

  win.webContents.once("did-finish-load", () => {
    if (updateCheckStarted) return;
    updateCheckStarted = true;
    startAutoUpdate({ app, dialog, win });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url, appUrl)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function isAppUrl(url, appUrl) {
  return Boolean(appUrl && url.startsWith(appUrl));
}

async function startBundledServer() {
  const { handleMultiplayerRequest } = await import(pathToFileUrl(path.join(root, "server", "http-multiplayer.mjs")));
  const port = await findAvailablePort(preferredPort);
  const server = http.createServer(async (req, res) => {
    if (await handleMultiplayerRequest(req, res)) return;

    const filePath = resolveRequest(req.url || "/");
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const data = await fs.readFile(filePath);
      res.writeHead(200, { "content-type": contentTypes.get(path.extname(filePath)) || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return `http://${host}:${port}`;
}

function resolveRequest(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
  if (pathname === "/") return path.join(root, "index.html");
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, normalized);
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const probe = net.createServer();
      probe.once("error", () => tryPort(port + 1));
      probe.once("listening", () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, host);
    };
    tryPort(startPort);
  });
}

function pathToFileUrl(filePath) {
  return new URL(`file://${filePath.replace(/\\/g, "/")}`).href;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
