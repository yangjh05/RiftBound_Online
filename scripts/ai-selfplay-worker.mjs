import { parentPort, workerData } from "node:worker_threads";
import { collectSequential, hydrateWorkerModel } from "../src/ai/neural/selfplay.mjs";

try {
  const model = hydrateWorkerModel(workerData.model);
  const league = (workerData.league || []).map(hydrateWorkerModel);
  const teacherEvaluatorModels = (workerData.teacherEvaluatorModels || []).map(hydrateWorkerModel);
  const acknowledgements = new Map();
  parentPort.on("message", (message) => {
    if (message?.type !== "game-saved") return;
    acknowledgements.get(message.gameIndex)?.();
    acknowledgements.delete(message.gameIndex);
  });
  const result = await collectSequential({
    games: workerData.games,
    workerIndex: workerData.workerIndex,
    decks: workerData.decks,
    model,
    league,
    teacherEvaluatorModels,
    meta: workerData.meta,
    bestOfThreeFraction: workerData.bestOfThreeFraction,
    mirrorFraction: workerData.mirrorFraction,
    shapingWeight: workerData.shapingWeight,
    diagnosticWeight: workerData.diagnosticWeight,
    leagueSamplingWeights: workerData.leagueSamplingWeights,
    gamma: workerData.gamma,
    gaeLambda: workerData.gaeLambda,
    longHorizonLambda: workerData.longHorizonLambda,
    longHorizonWeight: workerData.longHorizonWeight,
    seed: workerData.seed,
    maxActions: workerData.maxActions,
    temperature: workerData.temperature,
    engineFingerprint: workerData.engineFingerprint,
    completedGameIndexes: workerData.completedGameIndexes,
    balancedPairings: workerData.balancedPairings,
    deckCurriculum: workerData.deckCurriculum,
    teacherFraction: workerData.teacherFraction,
    teacherBudget: workerData.teacherBudget,
    teacherCriticalBudget: workerData.teacherCriticalBudget,
    teacherUrgentBudget: workerData.teacherUrgentBudget,
    teacherScreenSimulations: workerData.teacherScreenSimulations,
    teacherConfirmationSimulations: workerData.teacherConfirmationSimulations,
    teacherConfirmationMaxSimulations: workerData.teacherConfirmationMaxSimulations,
    teacherDepth: workerData.teacherDepth,
    teacherCandidates: workerData.teacherCandidates,
    teacherLeafAuditSimulations: workerData.teacherLeafAuditSimulations,
    teacherEvaluatorMode: workerData.teacherEvaluatorMode,
    captureProductionLeafAudit:
      workerData.captureProductionLeafAudit === true,
    captureIndependentLeafAudit:
      workerData.captureIndependentLeafAudit !== false,
    captureIndependentActionAudit:
      workerData.captureIndependentActionAudit === true,
    deferIndependentActionAudit:
      workerData.deferIndependentActionAudit === true,
    detachedIndependentActionAudit:
      workerData.detachedIndependentActionAudit === true,
    teacherActionAuditCandidatePoolSize:
      workerData.teacherActionAuditCandidatePoolSize,
    teacherActionAuditMaximumQueries:
      workerData.teacherActionAuditMaximumQueries,
    teacherActionAuditReducedQueryFraction:
      workerData.teacherActionAuditReducedQueryFraction,
    teacherActionAuditSaturationQueries:
      workerData.teacherActionAuditSaturationQueries,
    teacherActionAuditBudget: workerData.teacherActionAuditBudget,
    teacherActionAuditMaximumSteps:
      workerData.teacherActionAuditMaximumSteps,
    stopTeacherAfterActionAuditBudget:
      workerData.stopTeacherAfterActionAuditBudget === true,
    teacherLeafAuditPairBudget:
      workerData.teacherLeafAuditPairBudget,
    stopTeacherAfterLeafAuditBudget:
      workerData.stopTeacherAfterLeafAuditBudget === true,
    postmortemReviews: workerData.postmortemReviews,
    postmortemCaptureLimit: workerData.postmortemCaptureLimit,
    postmortemSimulations: workerData.postmortemSimulations,
    postmortemDepth: workerData.postmortemDepth,
    postmortemCandidates: workerData.postmortemCandidates,
    comparisonBlockOffset: workerData.comparisonBlockOffset,
    pairingSeed: workerData.pairingSeed,
    retainResults: !workerData.streamGames,
    onGameComplete: workerData.streamGames ? ({ gameIndex, result: gameResult }) => new Promise((resolve) => {
      acknowledgements.set(gameIndex, resolve);
      parentPort.postMessage({ type: "game-complete", gameIndex, result: gameResult });
    }) : null
  });
  parentPort.postMessage({ type: "complete", result });
  parentPort.close();
} catch (error) {
  parentPort.postMessage({
    type: "error",
    error: {
      message: error?.message || String(error),
      stack: error?.stack || null,
      code: error?.code || "AI_SELFPLAY_WORKER_FAILED",
      diagnostic: error?.diagnostic || null
    }
  });
  parentPort.close();
}
