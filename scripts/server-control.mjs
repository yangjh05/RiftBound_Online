import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const port = Number(process.env.PORT || 4173);
const command = process.argv[2] || "restart";
const flags = new Set(process.argv.slice(3));
const useNgrok = process.env.NGROK !== "0" && !flags.has("--no-ngrok");
let ngrokProcess = null;

if (!["stop", "restart"].includes(command)) {
  console.error("Usage: node scripts/server-control.mjs stop|restart");
  process.exit(1);
}

await stopPortListeners(port);
if (useNgrok) await stopNgrokForPort(port);

if (command === "restart") {
  await import("./dev-server.mjs");
  if (useNgrok) ngrokProcess = startNgrok(port);
}

async function stopPortListeners(targetPort) {
  const pids = process.platform === "win32"
    ? await windowsListenerPids(targetPort)
    : await unixListenerPids(targetPort);

  const uniquePids = [...new Set(pids)].filter((pid) => pid && pid !== String(process.pid));
  if (!uniquePids.length) {
    console.log(`No server is listening on port ${targetPort}.`);
    return;
  }

  for (const pid of uniquePids) {
    await killPid(pid);
    console.log(`Stopped process ${pid} on port ${targetPort}.`);
  }
}

async function windowsListenerPids(targetPort) {
  const { stdout } = await execFileText("netstat", ["-ano", "-p", "tcp"]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("LISTENING"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => addressUsesPort(parts[1], targetPort))
    .map((parts) => parts.at(-1));
}

async function unixListenerPids(targetPort) {
  try {
    const { stdout } = await execFileText("lsof", ["-ti", `tcp:${targetPort}`, "-sTCP:LISTEN"]);
    return stdout.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

function addressUsesPort(address, targetPort) {
  return String(address || "").endsWith(`:${targetPort}`);
}

async function killPid(pid) {
  if (process.platform === "win32") {
    await execFileText("taskkill", ["/PID", pid, "/F"]);
  } else {
    await execFileText("kill", ["-TERM", pid]);
  }
}

async function stopNgrokForPort(targetPort) {
  const pids = process.platform === "win32"
    ? await windowsNgrokPids(targetPort)
    : await unixNgrokPids(targetPort);
  const uniquePids = [...new Set(pids)].filter((pid) => pid && pid !== String(process.pid));
  for (const pid of uniquePids) {
    await killPid(pid);
    console.log(`Stopped ngrok process ${pid}.`);
  }
}

async function windowsNgrokPids(targetPort) {
  const script = [
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.Name -eq 'ngrok.exe' -and $_.CommandLine -like '*http*' -and $_.CommandLine -like '*" + targetPort + "*' }",
    "| Select-Object -ExpandProperty ProcessId"
  ].join(" ");
  try {
    const { stdout } = await execFileText("powershell", ["-NoProfile", "-Command", script]);
    return stdout.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

async function unixNgrokPids(targetPort) {
  try {
    const { stdout } = await execFileText("pgrep", ["-f", `ngrok.*http.*${targetPort}`]);
    return stdout.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

function startNgrok(targetPort) {
  console.log(`Starting ngrok tunnel: ngrok http ${targetPort}`);
  const ngrokCommand = resolveNgrokCommand();
  const child = spawn(ngrokCommand, ["http", String(targetPort)], {
    env: withWindowsAppsPath(process.env),
    stdio: "inherit",
    windowsHide: false
  });

  child.once("error", (error) => {
    if (error.code === "ENOENT") {
      console.error("ngrok is not installed or not on PATH. Install ngrok, then run `npm run restart` again.");
    } else {
      console.error(`ngrok failed to start: ${error.message}`);
    }
  });

  child.once("exit", (code) => {
    if (code && code !== 0) console.error(`ngrok exited with code ${code}.`);
  });

  return child;
}

function resolveNgrokCommand() {
  if (process.platform !== "win32") return "ngrok";
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    localAppData ? path.join(localAppData, "Microsoft", "WindowsApps", "ngrok.exe") : "",
    "ngrok.exe",
    "ngrok"
  ].filter(Boolean);
  return candidates.find((candidate) => candidate.includes(path.sep) && existsSync(candidate)) || candidates.at(-1);
}

function withWindowsAppsPath(env) {
  if (process.platform !== "win32") return env;
  const localAppData = env.LOCALAPPDATA || "";
  if (!localAppData) return env;
  const windowsApps = path.join(localAppData, "Microsoft", "WindowsApps");
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  const currentPath = env[pathKey] || "";
  if (currentPath.split(";").some((entry) => entry.toLowerCase() === windowsApps.toLowerCase())) return env;
  return {
    ...env,
    [pathKey]: `${currentPath};${windowsApps}`
  };
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (ngrokProcess && !ngrokProcess.killed) ngrokProcess.kill();
    process.exit(0);
  });
}

function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
