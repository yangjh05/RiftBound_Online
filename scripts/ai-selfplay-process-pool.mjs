import { fork } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { availableParallelism, freemem, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serializeNeuralModel } from "../src/ai/neural/model.mjs";
import {
  consumeSelfPlayResultHandoff,
  discardSelfPlayResultHandoff,
  readSelfPlayResultHandoffSummary
} from "./ai-selfplay-result-handoff.mjs";

const WORKER_PATH = fileURLToPath(new URL("./ai-selfplay-worker-process.mjs", import.meta.url));
const DEFAULT_DYNAMIC_SCALE_INTERVAL_MS = 10_000;
const DEFAULT_DYNAMIC_SCALE_HEALTHY_SAMPLES = 2;
const DEFAULT_DYNAMIC_WORKER_HEADROOM_BYTES = Math.round(1.2 * 1024 ** 3);

export function selfPlayProcessLimits(options = {}, taskCount = Infinity) {
  const availableTasks = Number.isFinite(Number(taskCount))
    ? Math.max(1, Math.floor(Number(taskCount)))
    : Number.MAX_SAFE_INTEGER;
  const requestedInitial = Math.max(
    1,
    Math.floor(Number(options.initialProcesses ?? options.processes
      ?? options.workers) || 1)
  );
  const requestedMaximum = Math.max(
    requestedInitial,
    Math.floor(Number(options.maximumProcesses) || requestedInitial)
  );
  return {
    initialProcessCount: Math.min(requestedInitial, availableTasks),
    maximumProcessCount: Math.min(requestedMaximum, availableTasks)
  };
}

export function selfPlayDynamicScaleDecision(state = {}, options = {}) {
  const processCount = Math.max(0, Math.floor(Number(state.processCount) || 0));
  const desiredProcessCount = Math.max(
    1,
    Math.floor(Number(state.desiredProcessCount) || processCount || 1)
  );
  const maximumProcessCount = Math.max(
    desiredProcessCount,
    Math.floor(Number(options.maximumProcessCount) || desiredProcessCount)
  );
  const minimumFreeMemoryBytes = Math.max(
    0,
    Number(options.minimumFreeMemoryBytes) || 0
  );
  const configuredHeadroom = Math.max(
    256 * 1024 ** 2,
    Number(options.workerHeadroomBytes)
      || DEFAULT_DYNAMIC_WORKER_HEADROOM_BYTES
  );
  const observedHeadroom = Math.ceil(
    Math.max(0, Number(state.observedWorkerRssBytes) || 0) * 1.25
  );
  const requiredHeadroomBytes = Math.max(
    configuredHeadroom,
    observedHeadroom
  );
  const freeMemoryBytes = Number(state.freeMemoryBytes);
  const memoryKnown = Number.isFinite(freeMemoryBytes);
  const memoryPressured = minimumFreeMemoryBytes > 0
    && memoryKnown
    && freeMemoryBytes < minimumFreeMemoryBytes;
  if (memoryPressured && desiredProcessCount > 1) {
    return {
      action: "scale-down",
      desiredProcessCount: desiredProcessCount - 1,
      requiredHeadroomBytes
    };
  }
  const queuedTasks = Math.max(0, Number(state.queuedTasks) || 0);
  const idleProcesses = Math.max(0, Number(state.idleProcesses) || 0);
  // Never expand on an unknown reading. The conservative initial pool is
  // already usable; a larger pool must be justified by a real physical-memory
  // sample rather than by treating missing telemetry as infinite headroom.
  const enoughMemory = memoryKnown
    && freeMemoryBytes >= minimumFreeMemoryBytes + requiredHeadroomBytes;
  if (state.dynamicScaling !== false
    && state.retiringProcesses === 0
    && desiredProcessCount < maximumProcessCount
    && processCount < maximumProcessCount
    && queuedTasks > idleProcesses
    && enoughMemory) {
    return {
      action: "scale-up",
      desiredProcessCount: desiredProcessCount + 1,
      requiredHeadroomBytes
    };
  }
  return {
    action: "hold",
    desiredProcessCount,
    requiredHeadroomBytes
  };
}

export function buildSelfPlayTaskQueue(games, workers, completedGameIndexes = new Map()) {
  const assignments = workerAssignments(games, workers);
  const offsets = assignments.map((_, index) => assignments.slice(0, index)
    .reduce((sum, count) => sum + Math.ceil(count / 4), 0));
  const tasks = [];
  const maximumAssignment = Math.max(...assignments, 0);
  // Interleave logical workers so a partially completed run retains balanced
  // matchup and seat coverage even though physical processes now pull work
  // dynamically instead of owning a fixed 20-game partition.
  for (let gameIndex = 0; gameIndex < maximumAssignment; gameIndex += 1) {
    for (let workerIndex = 0; workerIndex < assignments.length; workerIndex += 1) {
      if (gameIndex >= assignments[workerIndex]) continue;
      const completed = completedGameIndexes?.get?.(workerIndex)
        || completedGameIndexes?.[workerIndex]
        || [];
      if (completed instanceof Set ? completed.has(gameIndex) : completed.includes?.(gameIndex)) continue;
      tasks.push({
        workerIndex,
        gameIndex,
        assignedGames: assignments[workerIndex],
        comparisonBlockOffset: offsets[workerIndex]
      });
    }
  }
  return { assignments, tasks };
}

export function resolveSelfPlayTaskOptions(
  task,
  taskIndex,
  totalTasks,
  resolver
) {
  if (typeof resolver !== "function") return task;
  const resolved = resolver({
    task: { ...task },
    taskIndex,
    totalTasks
  });
  if (!resolved) return task;
  return {
    ...task,
    optionOverrides: resolved.optionOverrides || null,
    taskContext: resolved.taskContext || null
  };
}

export function selfPlayProcessEnvironment(poolSize, environment = process.env) {
  const cpuCount = Math.max(1, availableParallelism());
  const threadsPerProcess = Math.max(1, Math.floor(cpuCount / Math.max(1, poolSize)));
  return {
    ...environment,
    TF_NUM_INTRAOP_THREADS: environment.TF_NUM_INTRAOP_THREADS || String(threadsPerProcess),
    TF_NUM_INTEROP_THREADS: environment.TF_NUM_INTEROP_THREADS || "1",
    OMP_NUM_THREADS: environment.OMP_NUM_THREADS || String(threadsPerProcess)
  };
}

export function selfPlayChildExecArgv(execArgv = process.execArgv) {
  const output = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index];
    if ([
      "-e",
      "--eval",
      "-p",
      "--print",
      "--test-name-pattern",
      "--test-reporter",
      "--test-reporter-destination"
    ].includes(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith("--input-type") || argument.startsWith("--eval=")
      || argument.startsWith("--print=") || argument.startsWith("--test")) continue;
    output.push(argument);
  }
  return output;
}

export async function collectProcessPoolSelfPlay(options) {
  const queue = buildSelfPlayTaskQueue(options.games, options.workers, options.completedGameIndexes);
  const assignments = queue.assignments;
  const allPendingTasks = queue.tasks;
  const taskLimit = Number.isFinite(Number(options.taskLimit))
    ? Math.max(0, Math.floor(Number(options.taskLimit)))
    : allPendingTasks.length;
  const tasks = allPendingTasks
    .slice(0, taskLimit)
    .map((task, taskIndex, selectedTasks) =>
      resolveSelfPlayTaskOptions(
        task,
        taskIndex,
        selectedTasks.length,
        options.resolveTaskOptions
      ));
  const reusedGames = options.games - allPendingTasks.length;
  if (!tasks.length) {
    return finishCollection(options, [], assignments.length, reusedGames, {
      stoppedAtGameBoundary: false,
      pendingTasks: 0
    });
  }

  const {
    initialProcessCount,
    maximumProcessCount
  } = selfPlayProcessLimits(options, tasks.length);
  const handoffDirectory = await mkdtemp(path.join(
    options.resultHandoffRoot || tmpdir(),
    "riftbound-ai-selfplay-pool-"
  ));
  // Size TensorFlow's per-process thread pools for the maximum live pool.
  // Otherwise workers added later would each retain the larger initial-pool
  // thread budget and oversubscribe the CPU.
  const childEnvironment = selfPlayProcessEnvironment(maximumProcessCount, {
    ...process.env,
    ...(options.workerEnvironment || {})
  });
  const commonOptions = {
    decks: options.decks,
    model: serializeNeuralModel(options.model),
    league: (options.league || []).map(serializeNeuralModel),
    teacherEvaluatorModels: (options.teacherEvaluatorModels || []).map(serializeNeuralModel),
    meta: options.meta || null,
    bestOfThreeFraction: options.bestOfThreeFraction ?? 0.25,
    mirrorFraction: options.mirrorFraction ?? 0.25,
    shapingWeight: options.shapingWeight || 0,
    diagnosticWeight: options.diagnosticWeight ?? 0,
    leagueSamplingWeights: options.leagueSamplingWeights || null,
    gamma: options.gamma ?? 0.997,
    gaeLambda: options.gaeLambda ?? 0.95,
    longHorizonLambda: options.longHorizonLambda ?? 0.985,
    longHorizonWeight: options.longHorizonWeight ?? 0.6,
    maxActions: options.maxActions || 600,
    temperature: options.temperature || 0.8,
    engineFingerprint: options.engineFingerprint || null,
    balancedPairings: options.balancedPairings !== false,
    deckCurriculum: options.deckCurriculum || null,
    deckSeatScheduleVersion:
      options.deckSeatScheduleVersion || "deck-seat-schedule-v1",
    deckSeatScheduleBoundaryGameIndex:
      Number.isFinite(Number(options.deckSeatScheduleBoundaryGameIndex))
        ? Number(options.deckSeatScheduleBoundaryGameIndex)
        : null,
    teacherFraction: options.teacherFraction ?? 0.12,
    teacherBudget: options.teacherBudget ?? 16,
    teacherCriticalBudget: options.teacherCriticalBudget ?? 8,
    teacherUrgentBudget: options.teacherUrgentBudget ?? 4,
    teacherScreenSimulations: options.teacherScreenSimulations ?? options.teacherSimulations ?? 4,
    teacherConfirmationSimulations: options.teacherConfirmationSimulations ?? 16,
    teacherConfirmationMaxSimulations: options.teacherConfirmationMaxSimulations ?? 32,
    teacherDepth: options.teacherDepth || 10,
    teacherCandidates: options.teacherCandidates || 6,
    teacherLeafAuditSimulations: options.teacherLeafAuditSimulations ?? 8,
    captureIndependentActionAudit:
      options.captureIndependentActionAudit === true,
    deferIndependentActionAudit:
      options.deferIndependentActionAudit === true,
    detachedIndependentActionAudit:
      options.detachedIndependentActionAudit === true,
    teacherActionAuditCandidatePoolSize:
      Math.max(
        0,
        Number(options.teacherActionAuditCandidatePoolSize) || 0
      ),
    teacherActionAuditMaximumQueries:
      Math.max(
        0,
        Number(options.teacherActionAuditMaximumQueries) || 0
      ),
    teacherActionAuditReducedQueryFraction:
      Number.isFinite(Number(options.teacherActionAuditReducedQueryFraction))
        ? Math.max(
          0,
          Math.min(
            1,
            Number(options.teacherActionAuditReducedQueryFraction)
          )
        )
        : undefined,
    teacherActionAuditSaturationQueries:
      Math.max(
        0,
        Number(options.teacherActionAuditSaturationQueries) || 0
      ),
    teacherActionAuditBudget:
      Number.isFinite(Number(options.teacherActionAuditBudget))
        ? Math.max(0, Number(options.teacherActionAuditBudget))
        : 4,
    teacherActionAuditMaximumSteps:
      Math.max(192, Number(options.teacherActionAuditMaximumSteps) || 1200),
    stopTeacherAfterActionAuditBudget:
      options.stopTeacherAfterActionAuditBudget === true,
    teacherLeafAuditPairBudget:
      Number.isFinite(Number(options.teacherLeafAuditPairBudget))
        ? Math.max(0, Math.floor(Number(options.teacherLeafAuditPairBudget)))
        : undefined,
    stopTeacherAfterLeafAuditBudget:
      options.stopTeacherAfterLeafAuditBudget === true,
    teacherEvaluatorMode: options.teacherEvaluatorMode || "certified-neural-ensemble",
    captureProductionLeafAudit: options.captureProductionLeafAudit === true,
    captureIndependentLeafAudit:
      options.captureIndependentLeafAudit !== false,
    // Phase-stratified evaluator bootstrap runs must carry their focus all the
    // way into the child. Dropping either list makes the child treat every
    // phase as eligible and lets the small per-game audit budget expire before
    // the requested late-game stratum is reached.
    teacherLeafAuditFocusPhaseBands:
      [...(options.teacherLeafAuditFocusPhaseBands || [])],
    teacherActionAuditFocusPhaseBands:
      [...(options.teacherActionAuditFocusPhaseBands || [])],
    teacherActionAuditFocusActionClasses:
      [...(options.teacherActionAuditFocusActionClasses || [])],
    evidenceProtocolManifest:
      options.evidenceProtocolManifest
        ? structuredClone(options.evidenceProtocolManifest)
        : null,
    evidenceSamplingFrame:
      options.evidenceSamplingFrame
        ? structuredClone(options.evidenceSamplingFrame)
        : null,
    postmortemReviews: Math.max(0, Number(options.postmortemReviews) || 0),
    postmortemCaptureLimit: Math.max(2, Number(options.postmortemCaptureLimit) || 8),
    postmortemAuditInterval: Math.max(6, Number(options.postmortemAuditInterval) || 12),
    postmortemWinnerReviewFraction: Number.isFinite(Number(options.postmortemWinnerReviewFraction))
      ? Math.max(0, Math.min(1, Number(options.postmortemWinnerReviewFraction)))
      : 0.15,
    postmortemSimulations: Math.max(8, Number(options.postmortemSimulations) || 16),
    postmortemDepth: Math.max(10, Number(options.postmortemDepth) || 16),
    postmortemCandidates: Math.max(2, Number(options.postmortemCandidates) || 6),
    captureReplays: options.captureReplays === true,
    replayEvery: Math.max(1, Number(options.replayEvery) || 8),
    perfProfile: options.perfProfile === true,
    pairingSeed: options.seed || 1,
    resultHandoffDirectory: handoffDirectory,
    resultHandoff: options.resultHandoff || null
  };
  const retainResults = options.retainResults !== false;
  const streamResultHandoff = options.streamResultHandoff === true;
  const maximumTaskRetries = Math.max(
    0,
    Number.isFinite(Number(options.maximumTaskRetries))
      ? Math.floor(Number(options.maximumTaskRetries))
      : 2
  );
  const maximumWorkerStartupRetries = Math.max(
    0,
    Number.isFinite(Number(options.maximumWorkerStartupRetries))
      ? Math.floor(Number(options.maximumWorkerStartupRetries))
      : 4
  );
  const workerStartupRetryBaseDelayMs = Math.max(
    10,
    Number(options.workerStartupRetryBaseDelayMs) || 1_000
  );
  const maximumGamesPerProcess = Math.max(
    0,
    Number.isFinite(Number(options.maximumGamesPerProcess))
      ? Math.floor(Number(options.maximumGamesPerProcess))
      : 0
  );
  const maximumWorkerRssBytes = Math.max(
    0,
    Number(options.maximumWorkerRssBytes) || 0
  );
  const minimumFreeMemoryBytes = Math.max(
    0,
    Number(options.minimumFreeMemoryBytes) || 0
  );
  const results = [];
  const slots = Array.from({ length: maximumProcessCount }, () => null);
  const retryAttempts = new Map();
  const retryTasks = [];
  const startupRetryAttempts = new Map();
  const startupRetryTimers = new Map();
  let nextTaskIndex = 0;
  let completedTasks = 0;
  let desiredProcessCount = initialProcessCount;
  let peakProcessCount = 0;
  let observedWorkerRssBytes = 0;
  let healthyScaleSamples = 0;
  let lastScaleChangeAt = 0;
  let settled = false;
  let draining = false;
  let stopRequestedAt = null;
  let stopHandoffId = null;
  let assignmentClosed = false;
  let assignmentClosedReason = null;
  let memoryBackpressured = false;
  let lastFreeMemoryBytes = null;
  let finishResolve;
  let finishReject;
  const finished = new Promise((resolve, reject) => {
    finishResolve = resolve;
    finishReject = reject;
  });
  const dynamicScaling = options.dynamicScaling !== false
    && maximumProcessCount > initialProcessCount;
  const dynamicScaleIntervalMs = Math.max(
    1_000,
    Number(options.dynamicScaleIntervalMs)
      || DEFAULT_DYNAMIC_SCALE_INTERVAL_MS
  );
  const dynamicScaleHealthySamples = Math.max(
    1,
    Math.floor(Number(options.dynamicScaleHealthySamples)
      || DEFAULT_DYNAMIC_SCALE_HEALTHY_SAMPLES)
  );
  const dynamicWorkerHeadroomBytes = Math.max(
    256 * 1024 ** 2,
    Number(options.dynamicWorkerHeadroomBytes)
      || DEFAULT_DYNAMIC_WORKER_HEADROOM_BYTES
  );

  const heartbeat = setInterval(() => {
    if (settled) return;
    detectStopRequest();
    assignAvailableSlots();
    options.onWorkerHeartbeat?.(poolSnapshot(
      slots,
      completedTasks,
      tasks.length,
      {
        draining,
        stopRequestedAt,
        stopHandoffId,
        assignmentClosed,
        assignmentClosedReason,
        memoryBackpressured,
        freeMemoryBytes: lastFreeMemoryBytes,
        minimumFreeMemoryBytes,
        initialProcessCount,
        maximumProcessCount,
        desiredProcessCount,
        peakProcessCount,
        dynamicScaling
      }
    ));
    finishIfDrained();
  }, Math.max(5000, Number(options.workerHeartbeatMs) || 60000));
  heartbeat.unref?.();
  const scheduler = setInterval(() => {
    if (settled) return;
    assignAvailableSlots();
  }, Math.max(1000, Number(options.memoryBackpressurePollMs) || 5000));
  scheduler.unref?.();
  const scaleScheduler = setInterval(() => {
    if (settled) return;
    evaluateDynamicScale();
  }, dynamicScaleIntervalMs);
  scaleScheduler.unref?.();

  for (let slotIndex = 0; slotIndex < initialProcessCount; slotIndex += 1) {
    spawnSlot(slotIndex);
  }
  try {
    await finished;
    return await finishCollection(options, results, peakProcessCount, reusedGames, {
      stoppedAtGameBoundary: draining,
      stopRequestedAt,
      stopHandoffId,
      assignmentClosed,
      assignmentClosedReason,
      pendingTasks: Math.max(0, tasks.length - completedTasks),
      completedTasks,
      initialProcessCount,
      maximumProcessCount,
      desiredProcessCount,
      peakProcessCount,
      dynamicScaling
    });
  } finally {
    clearInterval(heartbeat);
    clearInterval(scheduler);
    clearInterval(scaleScheduler);
    clearWorkerStartupRetryTimers();
    await rm(handoffDirectory, { recursive: true, force: true }).catch(() => {});
  }

  function spawnSlot(slotIndex, retryTask = null) {
    if (settled || ((draining || assignmentClosed) && !retryTask)
      || slots[slotIndex]) return;
    const child = fork(options.workerPath || WORKER_PATH, [], {
      env: childEnvironment,
      execArgv: selfPlayChildExecArgv(),
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      windowsHide: true
    });
    const slot = {
      slotIndex,
      child,
      ready: false,
      task: null,
      startedAt: null,
      completedGames: 0,
      expectedExit: false,
      recovering: false,
      retryTask,
      waitingForMemory: false,
      retireRequested: false,
      startupRetryDelayMs: null
    };
    slots[slotIndex] = slot;
    peakProcessCount = Math.max(
      peakProcessCount,
      slots.filter(Boolean).length
    );
    child.on("message", (message) => handleMessage(slot, message));
    child.once("error", (error) => recoverWorker(slot, error));
    child.once("exit", (code, signal) => {
      if (slots[slotIndex] !== slot || settled) return;
      if (slot.expectedExit) {
        const pendingRetry = slot.retryTask;
        const retiring = slot.retireRequested === true;
        const startupRetryDelayMs = slot.startupRetryDelayMs;
        slots[slotIndex] = null;
        if (Number.isFinite(startupRetryDelayMs)) {
          scheduleWorkerStartupRetry(slotIndex, startupRetryDelayMs);
          return;
        }
        if (pendingRetry && retiring) retryTasks.unshift(pendingRetry);
        if (!settled && !retiring
          && ((!draining && !assignmentClosed) || pendingRetry)
          && liveProcessCount() < desiredProcessCount) {
          spawnSlot(slotIndex, pendingRetry);
        } else {
          if (pendingRetry && !retiring) retryTasks.unshift(pendingRetry);
          ensureDesiredWorkers();
          assignAvailableSlots();
          finishIfDrained();
        }
        return;
      }
      const exitError = new Error(
        `Self-play process ${slotIndex} exited before completing its task `
        + `(code ${code}, signal ${signal || "none"}).`
      );
      exitError.exitCode = code;
      exitError.signal = signal || null;
      recoverWorker(
        slot,
        exitError,
        {
          alreadyExited: true,
          retryDelayMs: selfPlayWorkerRetryDelayMs(code)
        }
      );
    });
    sendChildMessage(child, {
      type: "initialize",
      slotIndex,
      options: commonOptions
    });
  }

  async function handleMessage(slot, message) {
    if (settled) {
      await discardSelfPlayResultHandoff(message);
      return;
    }
    if (message?.type === "ready") {
      slot.ready = true;
      startupRetryAttempts.delete(slot.slotIndex);
      if (slot.retryTask) {
        const retryTask = slot.retryTask;
        slot.retryTask = null;
        assignTask(slot, retryTask);
      } else {
        assignNext(slot);
      }
      return;
    }
    if (message?.type === "game-complete") {
      const task = slot.task;
      if (!task || task.workerIndex !== message.workerIndex || task.gameIndex !== message.gameIndex) {
        await discardSelfPlayResultHandoff(message);
        fail(new Error(`Self-play process ${slot.slotIndex} returned an unexpected game result.`));
        return;
      }
      try {
        let game;
        if (streamResultHandoff) {
          const resultSummary = await readSelfPlayResultHandoffSummary(message);
          game = {
            workerIndex: task.workerIndex,
            gameIndex: task.gameIndex,
            games: task.assignedGames,
            seed: task.seed,
            taskContext: task.taskContext || null,
            resultSummary,
            resultHandoff: {
              resultArchivePath: message.resultArchivePath,
              resultSummaryPath: message.resultSummaryPath
            }
          };
          if (typeof options.onGameHandoff !== "function") {
            throw new Error(
              "Streaming self-play results require an onGameHandoff callback."
            );
          }
          try {
            await options.onGameHandoff(game);
          } finally {
            // Adopted files no longer exist at the temporary paths. If the
            // callback failed before adopting them, remove both leftovers.
            await discardSelfPlayResultHandoff(message);
          }
        } else {
          const result = await consumeSelfPlayResultHandoff(message);
          game = {
            workerIndex: task.workerIndex,
            gameIndex: task.gameIndex,
            games: task.assignedGames,
            seed: task.seed,
            taskContext: task.taskContext || null,
            result
          };
          await options.onGameComplete?.(game);
        }
        if (retainResults) results.push(game);
        completedTasks += 1;
        retryAttempts.delete(taskIdentity(task));
        slot.task = null;
        slot.startedAt = null;
        slot.completedGames = Number(message.workerCompletedGames)
          || slot.completedGames + 1;
        observedWorkerRssBytes = Math.max(
          observedWorkerRssBytes,
          Number(message.workerRssBytes) || 0
        );
        detectStopRequest();
        if (!draining && !assignmentClosed
          && typeof options.shouldAssignNext === "function") {
          const continuation = await options.shouldAssignNext({
            completedTasks,
            totalTasks: tasks.length,
            assignedTasks: nextTaskIndex,
            // Dynamic scale-down leaves a null hole in the stable slot array.
            // A different worker can finish before that slot is repopulated,
            // so completion accounting must ignore retired slots.
            activeTasks: slots.filter((item) => item?.task).length,
            pendingTasks: Math.max(0, tasks.length - completedTasks),
            lastGame: game
          });
          if (continuation === false
            || continuation?.continue === false) {
            assignmentClosed = true;
            assignmentClosedReason =
              continuation?.reason || "assignment-condition-satisfied";
          }
        }
        // Publish the cleared slot immediately. Without this completion
        // snapshot, a following detached audit kept reusing the previous
        // heartbeat and displayed the already-finished final game as active.
        options.onWorkerHeartbeat?.(poolSnapshot(
          slots,
          completedTasks,
          tasks.length,
          {
            draining,
            stopRequestedAt,
            stopHandoffId,
            assignmentClosed,
            assignmentClosedReason,
            memoryBackpressured,
            freeMemoryBytes: lastFreeMemoryBytes,
            minimumFreeMemoryBytes,
            initialProcessCount,
            maximumProcessCount,
            desiredProcessCount,
            peakProcessCount,
            dynamicScaling
          }
        ));
        if (completedTasks >= tasks.length) {
          settled = true;
          for (const item of slots.filter(Boolean)) {
            item.expectedExit = true;
            sendChildMessage(item.child, { type: "shutdown" });
          }
          finishResolve();
          return;
        }
        if (finishIfDrained()) return;
        if (slot.retireRequested === true
          || liveProcessCount() > desiredProcessCount) {
          requestSlotRetirement(slot);
          return;
        }
        if (shouldRecycleSelfPlayWorker({
          completedGames: slot.completedGames,
          rssBytes: Number(message.workerRssBytes) || 0
        }, {
          maximumGamesPerProcess,
          maximumWorkerRssBytes
        })) {
          recycleWorker(slot);
        } else {
          assignNext(slot);
        }
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (message?.type === "error") {
      const error = new Error(message.error?.message || "Self-play process failed.");
      error.stack = message.error?.stack || error.stack;
      error.code = message.error?.code || "AI_SELFPLAY_PROCESS_FAILED";
      error.diagnostic = message.error?.diagnostic || null;
      error.task = message.task || slot.task;
      recoverWorker(slot, error);
    }
  }

  function assignNext(slot) {
    if (settled || !slot.ready || slot.task
      || slot.retireRequested === true) return;
    detectStopRequest();
    const pendingRetry = retryTasks.shift();
    if (pendingRetry) {
      assignTask(slot, pendingRetry);
      return;
    }
    if (draining || assignmentClosed) {
      finishIfDrained();
      return;
    }
    const memory = memoryBackpressureState();
    memoryBackpressured = memory.active;
    lastFreeMemoryBytes = memory.freeBytes;
    slot.waitingForMemory = memory.active;
    if (memory.active) {
      options.onWorkerHeartbeat?.(poolSnapshot(
        slots,
        completedTasks,
        tasks.length,
        {
          draining,
          stopRequestedAt,
          stopHandoffId,
          assignmentClosed,
          assignmentClosedReason,
          memoryBackpressured,
          freeMemoryBytes: lastFreeMemoryBytes,
          minimumFreeMemoryBytes,
          initialProcessCount,
          maximumProcessCount,
          desiredProcessCount,
          peakProcessCount,
          dynamicScaling
        }
      ));
      return;
    }
    const task = tasks[nextTaskIndex++];
    if (!task) return;
    assignTask(slot, {
      ...task,
      seed: (options.seed || Date.now()) + task.workerIndex * 100003
    });
  }

  function assignTask(slot, task) {
    if (settled || !slot.ready || slot.task) return;
    slot.waitingForMemory = false;
    slot.task = task;
    slot.startedAt = Date.now();
    if (!sendChildMessage(slot.child, {
      type: "run-game",
      task
    })) {
      recoverWorker(
        slot,
        new Error(`Self-play process ${slot.slotIndex} disconnected before task assignment.`)
      );
      return;
    }
    options.onWorkerHeartbeat?.(poolSnapshot(
      slots,
      completedTasks,
      tasks.length,
      {
        draining,
        stopRequestedAt,
        stopHandoffId,
        assignmentClosed,
        assignmentClosedReason,
        memoryBackpressured,
        freeMemoryBytes: lastFreeMemoryBytes,
        minimumFreeMemoryBytes,
        initialProcessCount,
        maximumProcessCount,
        desiredProcessCount,
        peakProcessCount,
        dynamicScaling
      }
    ));
  }

  function assignAvailableSlots() {
    if (settled) return;
    const memory = memoryBackpressureState();
    const previousMemoryBackpressured = memoryBackpressured;
    memoryBackpressured = memory.active;
    lastFreeMemoryBytes = memory.freeBytes;
    if (previousMemoryBackpressured !== memoryBackpressured) {
      options.onWorkerHeartbeat?.(poolSnapshot(
        slots,
        completedTasks,
        tasks.length,
        {
          draining,
          stopRequestedAt,
          stopHandoffId,
          assignmentClosed,
          assignmentClosedReason,
          memoryBackpressured,
          freeMemoryBytes: lastFreeMemoryBytes,
          minimumFreeMemoryBytes,
          initialProcessCount,
          maximumProcessCount,
          desiredProcessCount,
          peakProcessCount,
          dynamicScaling
        }
      ));
    }
    if (memory.active) return;
    for (const slot of slots.filter(Boolean)) {
      if (!slot.ready || slot.task || slot.expectedExit
        || slot.retireRequested) continue;
      if (slot.retryTask) {
        const retryTask = slot.retryTask;
        slot.retryTask = null;
        assignTask(slot, retryTask);
      } else {
        assignNext(slot);
      }
    }
  }

  function liveProcessCount() {
    return slots.filter(Boolean).length;
  }

  function ensureDesiredWorkers() {
    if (settled || draining || assignmentClosed) return;
    let needed = Math.max(0, desiredProcessCount - liveProcessCount());
    if (needed === 0) return;
    for (let slotIndex = 0;
      slotIndex < slots.length && needed > 0;
      slotIndex += 1) {
      if (slots[slotIndex]) continue;
      if (startupRetryTimers.has(slotIndex)) continue;
      spawnSlot(slotIndex);
      needed -= 1;
    }
  }

  function requestSlotRetirement(slot) {
    if (!slot || slot.expectedExit || settled) return false;
    slot.retireRequested = true;
    if (slot.task) return true;
    slot.expectedExit = true;
    slot.retryTask = null;
    slot.startedAt = null;
    if (slot.child.connected) {
      sendChildMessage(slot.child, { type: "shutdown" });
    } else {
      slot.child.kill();
    }
    const child = slot.child;
    setTimeout(() => {
      if (slots[slot.slotIndex] === slot && !child.killed) child.kill();
    }, 5000).unref?.();
    return true;
  }

  function retireOneWorker() {
    const candidates = slots.filter((slot) =>
      slot && !slot.expectedExit && !slot.retireRequested);
    const idle = candidates.find((slot) => !slot.task);
    const selected = idle || candidates.at(-1);
    return selected ? requestSlotRetirement(selected) : false;
  }

  function evaluateDynamicScale() {
    if (settled || draining || assignmentClosed) return;
    const memory = memoryBackpressureState();
    memoryBackpressured = memory.active;
    lastFreeMemoryBytes = memory.freeBytes;
    const live = liveProcessCount();
    const retiring = slots.filter((slot) => slot?.retireRequested).length;
    const idle = slots.filter((slot) => slot
      && slot.ready
      && !slot.task
      && !slot.expectedExit
      && !slot.retireRequested).length;
    const queued = retryTasks.length
      + Math.max(0, tasks.length - nextTaskIndex);
    const decision = selfPlayDynamicScaleDecision({
      processCount: live,
      desiredProcessCount,
      freeMemoryBytes: memory.freeBytes,
      observedWorkerRssBytes,
      queuedTasks: queued,
      idleProcesses: idle,
      retiringProcesses: retiring,
      dynamicScaling
    }, {
      maximumProcessCount,
      minimumFreeMemoryBytes,
      workerHeadroomBytes: dynamicWorkerHeadroomBytes
    });
    if (decision.action === "scale-down") {
      healthyScaleSamples = 0;
      desiredProcessCount = decision.desiredProcessCount;
      lastScaleChangeAt = Date.now();
      retireOneWorker();
    } else if (decision.action === "scale-up") {
      healthyScaleSamples += 1;
      const cooldownElapsed = Date.now() - lastScaleChangeAt
        >= dynamicScaleIntervalMs;
      if (healthyScaleSamples >= dynamicScaleHealthySamples
        && cooldownElapsed) {
        healthyScaleSamples = 0;
        desiredProcessCount = decision.desiredProcessCount;
        lastScaleChangeAt = Date.now();
        ensureDesiredWorkers();
      }
    } else {
      healthyScaleSamples = 0;
    }
    options.onWorkerHeartbeat?.(poolSnapshot(
      slots,
      completedTasks,
      tasks.length,
      {
        draining,
        stopRequestedAt,
        stopHandoffId,
        assignmentClosed,
        assignmentClosedReason,
        memoryBackpressured,
        freeMemoryBytes: lastFreeMemoryBytes,
        minimumFreeMemoryBytes,
        initialProcessCount,
        maximumProcessCount,
        desiredProcessCount,
        peakProcessCount,
        dynamicScaling,
        dynamicWorkerHeadroomBytes: decision.requiredHeadroomBytes
      }
    ));
    assignAvailableSlots();
  }

  function memoryBackpressureState() {
    const freeBytes = typeof options.freeMemoryBytes === "function"
      ? Number(options.freeMemoryBytes())
      : freemem();
    return {
      freeBytes,
      active: minimumFreeMemoryBytes > 0
        && Number.isFinite(freeBytes)
        && freeBytes < minimumFreeMemoryBytes
    };
  }

  function recycleWorker(slot, retryTask = null) {
    if (!slot || slot.expectedExit || settled) return;
    slot.expectedExit = true;
    slot.retryTask = retryTask;
    slot.task = null;
    slot.startedAt = null;
    if (slot.child.connected) {
      sendChildMessage(slot.child, { type: "shutdown" });
    } else {
      slot.child.kill();
    }
    const child = slot.child;
    setTimeout(() => {
      if (slots[slot.slotIndex] === slot && !child.killed) child.kill();
    }, 5000).unref?.();
  }

  function recoverWorker(slot, error, recovery = {}) {
    if (!slot || slot.recovering || slot.expectedExit || settled) return;
    slot.recovering = true;
    const task = slot.task || slot.retryTask;
    if (!task) {
      if (slot.ready !== true) {
        retryWorkerStartup(slot, error, recovery);
        return;
      }
      if (recovery.alreadyExited === true) {
        slots[slot.slotIndex] = null;
        if (slot.retireRequested !== true
          && liveProcessCount() < desiredProcessCount) {
          spawnSlot(slot.slotIndex);
        } else {
          ensureDesiredWorkers();
        }
      } else {
        if (slot.retireRequested) requestSlotRetirement(slot);
        else recycleWorker(slot);
      }
      return;
    }
    const identity = taskIdentity(task);
    const attempts = retryAttempts.get(identity) || 0;
    if (!selfPlayTaskRetryAllowed(attempts, maximumTaskRetries)) {
      error.code ||= "AI_SELFPLAY_PROCESS_FAILED";
      error.task = task;
      error.retryAttempts = attempts;
      fail(error);
      return;
    }
    retryAttempts.set(identity, attempts + 1);
    options.onTaskRetry?.({
      workerIndex: task.workerIndex,
      gameIndex: task.gameIndex,
      seed: task.seed,
      retryAttempt: attempts + 1,
      maximumTaskRetries,
      reason: error?.message || String(error)
    });
    slot.recovering = false;
    if (slot.retireRequested === true) {
      retryTasks.unshift(task);
      slot.task = null;
      slot.retryTask = null;
      if (recovery.alreadyExited === true) {
        slots[slot.slotIndex] = null;
        ensureDesiredWorkers();
        assignAvailableSlots();
      } else {
        requestSlotRetirement(slot);
      }
      return;
    }
    if (recovery.alreadyExited === true) {
      slots[slot.slotIndex] = null;
      const retryDelayMs = Math.max(
        0,
        Number(recovery.retryDelayMs) || 0
      );
      if (retryDelayMs > 0) {
        setTimeout(() => {
          if (settled) return;
          if (!slots[slot.slotIndex]
            && liveProcessCount() < desiredProcessCount) {
            spawnSlot(slot.slotIndex, task);
          } else {
            retryTasks.unshift(task);
            assignAvailableSlots();
          }
        }, retryDelayMs).unref?.();
      } else {
        if (liveProcessCount() < desiredProcessCount) {
          spawnSlot(slot.slotIndex, task);
        } else {
          retryTasks.unshift(task);
          assignAvailableSlots();
        }
      }
    } else {
      recycleWorker(slot, task);
    }
  }

  function retryWorkerStartup(slot, error, recovery = {}) {
    const slotIndex = slot.slotIndex;
    const attempts = startupRetryAttempts.get(slotIndex) || 0;
    if (!selfPlayTaskRetryAllowed(attempts, maximumWorkerStartupRetries)) {
      error.code ||= "AI_SELFPLAY_WORKER_INITIALIZATION_FAILED";
      error.workerSlotIndex = slotIndex;
      error.startupRetryAttempts = attempts;
      fail(error);
      return;
    }
    const retryAttempt = attempts + 1;
    startupRetryAttempts.set(slotIndex, retryAttempt);
    const delayMs = Math.max(
      workerStartupRetryBaseDelayMs * (2 ** Math.min(attempts, 4)),
      Number(recovery.retryDelayMs) || 0
    );
    options.onWorkerStartupRetry?.({
      slotIndex,
      retryAttempt,
      maximumWorkerStartupRetries,
      delayMs,
      exitCode: error?.exitCode ?? null,
      signal: error?.signal || null,
      reason: error?.message || String(error)
    });
    slot.startupRetryDelayMs = delayMs;
    slot.expectedExit = true;
    slot.task = null;
    slot.retryTask = null;
    slot.startedAt = null;
    if (recovery.alreadyExited === true) {
      slots[slotIndex] = null;
      scheduleWorkerStartupRetry(slotIndex, delayMs);
      return;
    }
    if (slot.child.connected) {
      sendChildMessage(slot.child, { type: "shutdown" });
    } else {
      slot.child.kill();
    }
    const child = slot.child;
    setTimeout(() => {
      if (slots[slotIndex] === slot && !child.killed) child.kill();
    }, 5_000).unref?.();
  }

  function scheduleWorkerStartupRetry(slotIndex, delayMs) {
    if (settled || startupRetryTimers.has(slotIndex)) return;
    const timer = setTimeout(() => {
      startupRetryTimers.delete(slotIndex);
      if (settled || draining || assignmentClosed || slots[slotIndex]) return;
      spawnSlot(slotIndex);
    }, Math.max(0, Number(delayMs) || 0));
    startupRetryTimers.set(slotIndex, timer);
  }

  function clearWorkerStartupRetryTimers() {
    for (const timer of startupRetryTimers.values()) clearTimeout(timer);
    startupRetryTimers.clear();
  }

  function detectStopRequest() {
    if (draining || !options.stopRequestPath) return draining;
    if (!existsSync(options.stopRequestPath)) return false;
    try {
      const request = JSON.parse(
        readFileSync(options.stopRequestPath, "utf8").replace(/^\uFEFF/, "")
      );
      stopHandoffId = typeof request?.handoffId === "string"
        ? request.handoffId
        : null;
    } catch {
      stopHandoffId = null;
    }
    draining = true;
    stopRequestedAt = new Date().toISOString();
    options.onStopRequested?.({
      stopRequestPath: options.stopRequestPath,
      stopRequestedAt,
      stopHandoffId,
      completedTasks,
      activeTasks: slots.filter((slot) => slot?.task).length,
      pendingTasks: Math.max(0, tasks.length - completedTasks)
    });
    return true;
  }

  function finishIfDrained() {
    if ((!draining && !assignmentClosed)
      || settled
      || slots.some((slot) => slot?.task)
      || retryTasks.length > 0) return false;
    settled = true;
    for (const item of slots.filter(Boolean)) {
      item.expectedExit = true;
      sendChildMessage(item.child, { type: "shutdown" });
    }
    finishResolve();
    return true;
  }

  function fail(error) {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    clearInterval(scheduler);
    clearInterval(scaleScheduler);
    clearWorkerStartupRetryTimers();
    for (const slot of slots.filter(Boolean)) {
      if (slot.child.connected) slot.child.disconnect();
      slot.child.kill();
    }
    finishReject(error);
  }
}

function poolSnapshot(slots, completedTasks, totalTasks, stop = {}) {
  const now = Date.now();
  return {
    backend: "child-process-pool",
    processCount: slots.filter(Boolean).length,
    initialProcessCount: Math.max(
      0,
      Number(stop.initialProcessCount) || 0
    ),
    maximumProcessCount: Math.max(
      0,
      Number(stop.maximumProcessCount) || 0
    ),
    desiredProcessCount: Math.max(
      0,
      Number(stop.desiredProcessCount) || 0
    ),
    peakProcessCount: Math.max(
      0,
      Number(stop.peakProcessCount) || 0
    ),
    dynamicScaling: stop.dynamicScaling === true,
    dynamicWorkerHeadroomBytes: Math.max(
      0,
      Number(stop.dynamicWorkerHeadroomBytes) || 0
    ),
    completedTasks,
    totalTasks,
    draining: stop.draining === true,
    stopRequestedAt: stop.stopRequestedAt || null,
    stopHandoffId: stop.stopHandoffId || null,
    assignmentClosed: stop.assignmentClosed === true,
    assignmentClosedReason: stop.assignmentClosedReason || null,
    memoryBackpressured: stop.memoryBackpressured === true,
    freeMemoryBytes: Number.isFinite(Number(stop.freeMemoryBytes))
      ? Number(stop.freeMemoryBytes)
      : null,
    minimumFreeMemoryBytes: Number(stop.minimumFreeMemoryBytes) || 0,
    active: slots.filter((slot) => slot?.task).map((slot) => ({
      slotIndex: slot.slotIndex,
      processId: slot.child.pid,
      workerIndex: slot.task.workerIndex,
      gameIndex: slot.task.gameIndex,
      taskContext: slot.task.taskContext || null,
      elapsedSeconds: Math.max(0, Math.round((now - slot.startedAt) / 1000))
    }))
  };
}

async function finishCollection(options, games, processCount, reusedGames, stop = {}) {
  const collectedGames = Math.max(
    games.length,
    Number(stop.completedTasks) || 0
  );
  if (typeof options.loadCollectedResults === "function") {
    const collected = await options.loadCollectedResults({
      allowPartial: stop.stoppedAtGameBoundary === true
    });
    collected.workerStats = {
      total: processCount,
      initial: Math.max(0, Number(stop.initialProcessCount) || processCount),
      maximum: Math.max(0, Number(stop.maximumProcessCount) || processCount),
      desired: Math.max(0, Number(stop.desiredProcessCount) || processCount),
      peak: Math.max(0, Number(stop.peakProcessCount) || processCount),
      dynamicScaling: stop.dynamicScaling === true,
      backend: "child-process-pool",
      reusedGames,
      collectedGames,
      stoppedAtGameBoundary: stop.stoppedAtGameBoundary === true,
      stopRequestedAt: stop.stopRequestedAt || null,
      stopHandoffId: stop.stopHandoffId || null,
      assignmentClosed: stop.assignmentClosed === true,
      assignmentClosedReason: stop.assignmentClosedReason || null,
      pendingTasks: Math.max(0, Number(stop.pendingTasks) || 0)
    };
    return collected;
  }
  const snapshots = games.map((game) => game.result);
  return {
    trajectories: snapshots.flatMap((result) => result.trajectories || []),
    summaries: snapshots.flatMap((result) => result.summaries || []),
    deckLearning: mergeLearningSnapshots(snapshots.map((result) => result.deckLearning)),
    workerStats: {
      total: processCount,
      initial: Math.max(0, Number(stop.initialProcessCount) || processCount),
      maximum: Math.max(0, Number(stop.maximumProcessCount) || processCount),
      desired: Math.max(0, Number(stop.desiredProcessCount) || processCount),
      peak: Math.max(0, Number(stop.peakProcessCount) || processCount),
      dynamicScaling: stop.dynamicScaling === true,
      backend: "child-process-pool",
      reusedGames,
      collectedGames,
      stoppedAtGameBoundary: stop.stoppedAtGameBoundary === true,
      stopRequestedAt: stop.stopRequestedAt || null,
      stopHandoffId: stop.stopHandoffId || null,
      assignmentClosed: stop.assignmentClosed === true,
      assignmentClosedReason: stop.assignmentClosedReason || null,
      pendingTasks: Math.max(0, Number(stop.pendingTasks) || 0)
    }
  };
}

export function shouldRecycleSelfPlayWorker(state = {}, options = {}) {
  const maximumGames = Math.max(
    0,
    Number(options.maximumGamesPerProcess) || 0
  );
  const maximumRss = Math.max(
    0,
    Number(options.maximumWorkerRssBytes) || 0
  );
  return (maximumGames > 0
      && Number(state.completedGames) >= maximumGames)
    || (maximumRss > 0
      && Number(state.rssBytes) >= maximumRss);
}

export function selfPlayTaskRetryAllowed(
  completedRetries,
  maximumTaskRetries = 2
) {
  return Math.max(0, Number(completedRetries) || 0)
    < Math.max(0, Number(maximumTaskRetries) || 0);
}

export function selfPlayWorkerRetryDelayMs(
  exitCode,
  platform = process.platform
) {
  if (platform !== "win32" || !Number.isFinite(Number(exitCode))) return 0;
  const normalizedCode = Number(exitCode) >>> 0;
  return normalizedCode === 0xc0000409
    ? 5_000
    : 0;
}

function taskIdentity(task) {
  return `${task.workerIndex}:${task.gameIndex}:${task.seed}`;
}

function sendChildMessage(child, message) {
  if (!child?.connected || typeof child.send !== "function") return false;
  try {
    child.send(message, () => {});
    return true;
  } catch {
    return false;
  }
}

function workerAssignments(games, workers) {
  const count = Math.max(1, Math.min(workers || 1, games));
  return Array.from({ length: count }, (_, index) => Math.floor(games / count) + (index < games % count ? 1 : 0));
}

function mergeLearningSnapshots(snapshots) {
  const output = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
  for (const snapshot of snapshots) mergeObjects(output, snapshot);
  return output;
}

function mergeObjects(target, source, path = []) {
  for (const [key, value] of Object.entries(source || {})) {
    if (path[0] === "deckProfiles") {
      if (target[key] == null) target[key] = structuredClone(value);
      continue;
    }
    if (typeof value === "number") target[key] = (target[key] || 0) + value;
    else if (value && typeof value === "object") mergeObjects(target[key] ||= {}, value, [...path, key]);
    else if (target[key] == null) target[key] = value;
  }
  return target;
}
