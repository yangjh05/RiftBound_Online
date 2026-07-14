import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const userArgs = process.argv.slice(2);
const runId = `bootstrap-${timestamp()}`;
const runDir = path.resolve(argumentValue(userArgs, "report") ? path.dirname(argumentValue(userArgs, "report")) : path.join("data", "ai", "runs", runId));
const report = path.resolve(argumentValue(userArgs, "report") || path.join(runDir, "run-report.json"));
const output = path.resolve(argumentValue(userArgs, "output") || "src/ai/checkpoints/neural-champion.json");
const logPath = path.join(runDir, "console.log");
await mkdir(runDir, { recursive: true });

const args = [...userArgs];
if (!argumentValue(args, "report")) args.push("--report", report);
if (!argumentValue(args, "output")) args.push("--output", output);
const log = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
const child = spawn(process.execPath, [fileURLToPath(new URL("./bootstrap-neural-ai.mjs", import.meta.url)), ...args], {
  cwd: process.cwd(),
  env: { ...process.env, TF_CPP_MIN_LOG_LEVEL: process.env.TF_CPP_MIN_LOG_LEVEL || "1" },
  windowsHide: true,
  stdio: ["inherit", "pipe", "pipe"]
});

console.log(JSON.stringify({ event: "logged-bootstrap-start", runDir, report, output, log: logPath }));
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); });
const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code) => resolve(code ?? 1));
});
await new Promise((resolve) => log.end(resolve));
if (exitCode !== 0) {
  console.error(`모방 초기화가 실패했습니다. 로그: ${logPath}`);
  process.exitCode = exitCode;
} else {
  console.log(JSON.stringify({ event: "logged-bootstrap-complete", runDir, report, output, log: logPath }));
}

function argumentValue(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : null;
}

function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
