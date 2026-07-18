import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadProjectEnv } from "./load-project-env.mjs";

const root = process.cwd();
loadProjectEnv(root);
const port = Number(process.env.PORT || 4173);
const command = process.argv[2] || "restart";
const flags = new Set(process.argv.slice(3));
const useTunnel = process.env.TAILSCALE_FUNNEL !== "0" && !flags.has("--no-tunnel");

if (!["stop", "restart"].includes(command)) {
  console.error("Usage: node scripts/server-control.mjs stop|restart [--no-tunnel]");
  process.exit(1);
}

await stopPortListeners(port);
if (command === "stop" || !useTunnel) await stopTailscaleFunnel({ optional: true });

if (command === "restart") {
  await import("./dev-server.mjs");
  if (useTunnel) {
    try {
      await startTailscaleFunnel(port);
    } catch (error) {
      console.error(error?.message || error);
      process.exit(1);
    }
  }
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
    try {
      await killPid(pid);
      console.log(`Stopped process ${pid} on port ${targetPort}.`);
    } catch (error) {
      if (!processMissing(error)) throw error;
    }
  }
}

async function windowsListenerPids(targetPort) {
  const { stdout } = await execFileText("netstat", ["-ano", "-p", "tcp"]);
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.includes("LISTENING"))
    .map((line) => line.split(/\s+/u))
    .filter((parts) => addressUsesPort(parts[1], targetPort))
    .map((parts) => parts.at(-1));
}

async function unixListenerPids(targetPort) {
  try {
    const { stdout } = await execFileText("lsof", ["-ti", `tcp:${targetPort}`, "-sTCP:LISTEN"]);
    return stdout.split(/\s+/u).filter(Boolean);
  } catch {
    return [];
  }
}

function addressUsesPort(address, targetPort) {
  return String(address || "").endsWith(`:${targetPort}`);
}

async function killPid(pid) {
  if (process.platform === "win32") {
    await execFileText("taskkill", ["/PID", String(pid), "/F"]);
  } else {
    await execFileText("kill", ["-TERM", String(pid)]);
  }
}

function processMissing(error) {
  const detail = `${error?.message || ""}\n${error?.stdout || ""}\n${error?.stderr || ""}`;
  return /not found|no such process|not running|could not be found/iu.test(detail);
}

async function startTailscaleFunnel(targetPort) {
  console.log(`Starting Tailscale Funnel for http://127.0.0.1:${targetPort}`);
  await runTailscale(["funnel", "--bg", String(targetPort)]);
  await runTailscale(["funnel", "status"]);
}

async function stopTailscaleFunnel({ optional = false } = {}) {
  const result = await runTailscale(["funnel", "--https=443", "off"], { optional, allowFailure: true });
  if (result.started && result.code === 0) console.log("Stopped Tailscale Funnel on HTTPS port 443.");
}

function runTailscale(args, { optional = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveTailscaleCommand(), args, {
      env: process.env,
      stdio: "inherit",
      windowsHide: false
    });
    let started = false;
    child.once("spawn", () => { started = true; });
    child.once("error", (error) => {
      if (optional && error.code === "ENOENT") return resolve({ started: false, code: null });
      if (error.code === "ENOENT") {
        return reject(new Error("Tailscale is not installed. Install it with `winget install --id Tailscale.Tailscale`, sign in, then retry."));
      }
      reject(error);
    });
    child.once("close", (code) => {
      if (!started) return;
      if (code === 0 || allowFailure) return resolve({ started: true, code });
      reject(new Error(`tailscale ${args[0]} exited with code ${code}. If the output says NoState, open an Administrator PowerShell, run \`Restart-Service Tailscale\`, open Tailscale and sign in, then retry.`));
    });
  });
}

function resolveTailscaleCommand() {
  if (process.platform !== "win32") return "tailscale";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const candidates = [
    path.join(programFiles, "Tailscale", "tailscale.exe"),
    path.join(programFiles, "Tailscale IPN", "tailscale.exe")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "tailscale.exe";
}

function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", timeout: 5000 }, (error, stdout, stderr) => {
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
