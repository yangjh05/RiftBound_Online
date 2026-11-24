import { handleReplayAnalysisWorkerRequest } from "./replay.mjs";

export function registerReplayAnalysisWorker(scope = globalThis) {
  if (typeof scope?.addEventListener !== "function" || typeof scope?.postMessage !== "function") return false;
  scope.addEventListener("message", (event) => {
    scope.postMessage(handleReplayAnalysisWorkerRequest(event.data));
  });
  return true;
}

const runningInsideWorker = typeof globalThis.document === "undefined"
  && typeof globalThis.addEventListener === "function"
  && typeof globalThis.postMessage === "function";

if (runningInsideWorker) registerReplayAnalysisWorker(globalThis);
