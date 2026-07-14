import { createWriteStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const userArgs = process.argv.slice(2);
const runId = `bootstrap-${timestamp()}`;
const runDir = path.resolve(argumentValue(userArgs, "report") ? path.dirname(argumentValue(userArgs, "report")) : path.join("data", "ai", "runs", runId));
const report = path.resolve(argumentValue(userArgs, "report") || path.join(runDir, "run-report.json"));
const output = path.resolve(argumentValue(userArgs, "output") || "src/ai/checkpoints/neural-champion.json");
const logPath = path.join(runDir, "console.log");
const statusPath = path.join(runDir, "run-status.json");
const startedAt = Date.now();
await mkdir(runDir, { recursive: true });

const args = [...userArgs];
if (!argumentValue(args, "report")) args.push("--report", report);
if (!argumentValue(args, "output")) args.push("--output", output);
const log = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
await writeStatus("starting");
const child = spawn(process.execPath, [fileURLToPath(new URL("./bootstrap-neural-ai.mjs", import.meta.url)), ...args], {
  cwd: process.cwd(),
  env: { ...process.env, TF_CPP_MIN_LOG_LEVEL: process.env.TF_CPP_MIN_LOG_LEVEL || "1" },
  windowsHide: true,
  stdio: ["inherit", "pipe", "pipe"]
});

console.log(JSON.stringify({ event: "logged-bootstrap-start", runDir, report, output, log: logPath }));
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); });
await writeStatus("running", { childPid: child.pid });
const heartbeat = setInterval(() => {
  const event = { event: "bootstrap-heartbeat", elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), childPid: child.pid };
  process.stdout.write(`${JSON.stringify(event)}\n`);
  log.write(`${JSON.stringify(event)}\n`);
}, 60000);
heartbeat.unref();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill(signal);
    void writeStatus("interrupted", { signal });
  });
}
const result = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => resolve({ exitCode: code ?? 1, signal }));
});
clearInterval(heartbeat);
await new Promise((resolve) => log.end(resolve));
if (result.exitCode !== 0) {
  await writeStatus("failed", result);
  console.error(`모방 초기화가 실패했습니다. 로그: ${logPath}`);
  process.exitCode = result.exitCode;
} else {
  await writeStatus("complete", result);
  console.log(JSON.stringify({ event: "logged-bootstrap-complete", runDir, report, output, log: logPath }));
}

function argumentValue(values, name) {
  const index = values.indexOf(`--${name}`);
  return index >= 0 && values[index + 1] && !values[index + 1].startsWith("--") ? values[index + 1] : null;
}

async function writeStatus(state, details = {}) {
  const payload = {
    version: 1,
    state,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    runDir,
    report,
    output,
    log: logPath,
    arguments: args,
    ...details
  };
  const temporary = `${statusPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporary, statusPath);
}

function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
