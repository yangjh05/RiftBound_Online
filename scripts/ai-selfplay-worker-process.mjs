import { collectSequential, hydrateWorkerModel } from "../src/ai/neural/selfplay.mjs";
import { PerformanceObserver } from "node:perf_hooks";
import {
  addAiPerformance,
  configureAiPerformance,
  resetAiPerformance,
  snapshotAiPerformance
} from "../src/ai/performance.mjs";
import { createSelfPlayResultHandoff } from "./ai-selfplay-result-handoff.mjs";
import { createEvaluatorBootstrapResultIndex } from "./evaluator-bootstrap-index.mjs";

let slotIndex = null;
let options = null;
let model = null;
let league = null;
let teacherEvaluatorModels = null;
let busy = false;
let gcObserver = null;
let completedGames = 0;

process.on("message", async (message) => {
  try {
    if (message?.type === "initialize") {
      if (options) throw new Error("Self-play process was initialized twice.");
      slotIndex = message.slotIndex;
      options = message.options;
      configureAiPerformance({ enabled: options.perfProfile === true });
      if (options.perfProfile === true) {
        gcObserver = new PerformanceObserver((items) => {
          for (const entry of items.getEntries()) {
            addAiPerformance("gcCount");
            addAiPerformance("gcMs", entry.duration);
          }
        });
        gcObserver.observe({ entryTypes: ["gc"] });
      }
      model = hydrateWorkerModel(options.model);
      league = (options.league || []).map(hydrateWorkerModel);
      teacherEvaluatorModels = (options.teacherEvaluatorModels || []).map(hydrateWorkerModel);
      await sendToParent({ type: "ready", slotIndex });
      return;
    }
    if (message?.type === "run-game") {
      if (!options || !model) throw new Error("Self-play process received work before initialization.");
      if (busy) throw new Error("Self-play process received overlapping game tasks.");
      busy = true;
      resetAiPerformance();
      const task = message.task;
      const taskOptions = selfPlayTaskOptions(options, task);
      let gameResult = null;
      const completedGameIndexes = Array.from({ length: task.assignedGames }, (_, index) => index)
        .filter((index) => index !== task.gameIndex);
      await collectSequential({
        ...taskOptions,
        model,
        league,
        teacherEvaluatorModels,
        games: task.assignedGames,
        workerIndex: task.workerIndex,
        seed: task.seed,
        comparisonBlockOffset: task.comparisonBlockOffset,
        completedGameIndexes,
        retainResults: false,
        onGameComplete: ({ result }) => { gameResult = result; }
      });
      if (!gameResult) throw new Error(`Self-play process did not produce game ${task.workerIndex}:${task.gameIndex}.`);
      gameResult.performance = snapshotAiPerformance();
      const resultHandoff = taskOptions.resultHandoff || null;
      if (resultHandoff?.kind === "evaluator-bootstrap") {
        for (const trajectory of gameResult.trajectories || []) {
          trajectory.evaluatorBootstrapSamplingMode =
            resultHandoff.samplingMode;
          trajectory.evaluatorBootstrapCertificationRole =
            resultHandoff.certificationRole || null;
        }
      }
      const resultSummary = resultHandoff?.kind === "evaluator-bootstrap"
        ? {
          version: 1,
          kind: resultHandoff.kind,
          datasetKey: resultHandoff.datasetKey,
          workerIndex: task.workerIndex,
          gameIndex: task.gameIndex,
          samplingMode: resultHandoff.samplingMode,
          certificationRole:
            resultHandoff.certificationRole || null,
          appliedAuditPhaseFocus: {
            leaf: [...(taskOptions.teacherLeafAuditFocusPhaseBands || [])],
            action: [...(taskOptions.teacherActionAuditFocusPhaseBands || [])],
            actionClasses: [
              ...(taskOptions.teacherActionAuditFocusActionClasses || [])
            ]
          },
          archiveFormat: "result-v1",
          resultIndex: createEvaluatorBootstrapResultIndex(gameResult)
        }
        : {
          version: 1,
          kind: "self-play-result",
          workerIndex: task.workerIndex,
          gameIndex: task.gameIndex,
          archiveFormat: "result-v1"
        };
      const handoff = await createSelfPlayResultHandoff(
        gameResult,
        options.resultHandoffDirectory,
        { summary: resultSummary }
      );
      completedGames += 1;
      const memory = process.memoryUsage();
      busy = false;
      await sendToParent({
        type: "game-complete",
        slotIndex,
        workerIndex: task.workerIndex,
        gameIndex: task.gameIndex,
        workerCompletedGames: completedGames,
        workerRssBytes: memory.rss,
        workerHeapUsedBytes: memory.heapUsed,
        ...handoff
      });
      return;
    }
    if (message?.type === "shutdown") {
      gcObserver?.disconnect();
      setImmediate(() => {
        if (process.connected) process.disconnect?.();
      });
    }
  } catch (error) {
    busy = false;
    await sendToParent({
      type: "error",
      slotIndex,
      task: message?.task || null,
      error: {
        message: error?.message || String(error),
        stack: error?.stack || null,
        code: error?.code || "AI_SELFPLAY_PROCESS_FAILED",
        diagnostic: error?.diagnostic || null
      }
    }).catch(() => {});
  }
});

function selfPlayTaskOptions(baseOptions, task) {
  const overrides = task?.optionOverrides;
  if (!overrides || typeof overrides !== "object") return baseOptions;
  const merged = { ...baseOptions };
  // A scheduled game may alter only collection metadata. The hydrated
  // learner, league, engine settings and handoff directory remain frozen.
  for (const key of [
    "deckCurriculum",
    "resultHandoff",
    "teacherLeafAuditFocusPhaseBands",
    "teacherActionAuditFocusPhaseBands",
    "teacherActionAuditFocusActionClasses",
    "evidenceSamplingFrame"
  ]) {
    if (Object.hasOwn(overrides, key)) merged[key] = overrides[key];
  }
  return merged;
}

function sendToParent(message) {
  if (!process.send || !process.connected) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    process.send(message, (error) => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}
