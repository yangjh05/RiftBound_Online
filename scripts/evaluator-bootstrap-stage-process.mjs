import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectEvaluatorBootstrap } from "./evaluator-bootstrap.mjs";
import {
  hydrateEvaluatorBootstrapStageRequest
} from "./evaluator-bootstrap-stage-handoff.mjs";
import { withFileLock } from "./file-lock.mjs";
import { renameWithRetry } from "./file-replace.mjs";

const requestArgument = process.argv[2];
const resultArgument = process.argv[3];
if (!requestArgument || !resultArgument) {
  throw new Error("Evaluator-bootstrap stage process requires request and result paths.");
}
const requestPath = path.resolve(requestArgument);
const resultPath = path.resolve(resultArgument);
let stageFinished = false;

process.once("beforeExit", () => {
  // A stage must never look successful unless it atomically committed a result.
  // The parent can safely resume committed game files after this non-zero exit.
  if (!stageFinished && !process.exitCode) process.exitCode = 1;
});

const send = (message) => {
  if (typeof process.send === "function" && process.connected) {
    process.send(message);
  }
};

async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await renameWithRetry(temporary, filename);
}

try {
  const request = JSON.parse(
    (await readFile(requestPath, "utf8")).replace(/^\uFEFF/, "")
  );
  const stopRequestPath =
    request.options?.collection?.stopRequestPath || null;
  let orphanStopRequestOwned = false;
  let orphanStopRequestWrite = Promise.resolve();
  process.once("disconnect", () => {
    if (stageFinished || !stopRequestPath) return;
    orphanStopRequestWrite = writeOrphanStopRequest(stopRequestPath, request)
      .then((owned) => {
        orphanStopRequestOwned = owned;
      })
      .catch(() => {});
  });
  const options = hydrateEvaluatorBootstrapStageRequest(request, {
    onAuditProgress: (audit) => send({ type: "audit-progress", audit }),
    onStopRequested: (stop) => send({ type: "stop-requested", stop })
  });
  const stageLockPath = path.join(
    options.dataRoot,
    "resume",
    "evaluator-bootstrap-stage.lock"
  );
  const result = await withFileLock(
    stageLockPath,
    () => collectEvaluatorBootstrap(options),
    {
      // A replacement parent may start while an orphaned child is draining.
      // Waiting here prevents two coordinators from writing the same dataset.
      timeoutMs: 12 * 60 * 60 * 1000,
      staleMs: 2 * 60 * 1000,
      heartbeatMs: 30 * 1000
    }
  );
  await orphanStopRequestWrite;
  if (orphanStopRequestOwned) {
    await unlink(stopRequestPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  await writeJsonAtomic(resultPath, {
    version: 1,
    ok: true,
    datasetKey: result.datasetKey,
    directory: result.directory,
    audit: result.audit
  });
  stageFinished = true;
  send({ type: "complete", datasetKey: result.datasetKey });
  if (process.connected) process.disconnect();
} catch (error) {
  await writeJsonAtomic(resultPath, {
    version: 1,
    ok: false,
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || null
    }
  }).catch(() => {});
  stageFinished = true;
  send({
    type: "error",
    error: error?.message || String(error)
  });
  if (process.connected) process.disconnect();
  process.exitCode = 1;
}

async function writeOrphanStopRequest(filename, request) {
  await mkdir(path.dirname(filename), { recursive: true });
  let handle;
  try {
    handle = await open(filename, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({
      version: 1,
      requestedAt: new Date().toISOString(),
      reason: "evaluator-bootstrap-parent-disconnected",
      handoffId: request?.metadata?.stageId || null,
      parentProcessId: request?.metadata?.parentProcessId || null,
      childProcessId: process.pid
    }), "utf8");
    return true;
  } finally {
    await handle.close();
  }
}
