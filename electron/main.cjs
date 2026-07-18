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
let startupStarted = false;
let gameWindow = null;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

async function createGameWindow() {
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
  gameWindow = win;
  win.once("closed", () => {
    if (gameWindow === win) gameWindow = null;
  });

  win.loadURL(appUrl);

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

async function runStartup() {
  if (startupStarted) return;
  startupStarted = true;
  const updateWindow = createUpdateWindow();
  const report = (status) => {
    if (!updateWindow.isDestroyed()) updateWindow.webContents.send("update-status", status);
  };

  await updateWindow.__ready;
  let result;
  do {
    result = await startAutoUpdate({ app, dialog, win: updateWindow, onStatus: report });
    if (result.status !== "error") break;
    const choice = await dialog.showMessageBox(updateWindow, {
      type: "warning",
      title: "업데이트 확인 실패",
      message: "업데이트 서버에 연결하지 못했습니다.",
      detail: `${friendlyUpdateError(result.error)}\n\n인터넷 연결을 확인한 뒤 다시 시도하거나 현재 버전으로 게임을 시작할 수 있습니다.`,
      buttons: ["다시 시도", "현재 버전으로 시작"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (choice.response !== 0) break;
  } while (true);

  if (result.status === "applying") return;
  report({ phase: "launching", message: "게임을 시작하는 중입니다…", progress: 1 });
  await delay(350);
  if (!updateWindow.isDestroyed()) updateWindow.close();
  await createGameWindow();
}

function createUpdateWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 420,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    title: "Riftbound Online",
    backgroundColor: "#090d14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "updater-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.__ready = new Promise((resolve, reject) => {
    win.webContents.once("did-finish-load", resolve);
    win.webContents.once("did-fail-load", (_event, code, description) => reject(new Error(`${description} (${code})`)));
  });
  win.loadFile(path.join(__dirname, "updater.html"));
  win.once("ready-to-show", () => win.show());
  return win;
}

function friendlyUpdateError(error) {
  if (error?.name === "AbortError") return "서버 응답 시간이 초과되었습니다.";
  return error?.message || String(error || "알 수 없는 오류");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  runStartup().catch(async (error) => {
    await dialog.showErrorBox("Riftbound Online 시작 실패", error?.message || String(error));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !gameWindow) createGameWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
