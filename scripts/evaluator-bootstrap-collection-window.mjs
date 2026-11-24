// Queue capacity and physical concurrency are separate. A Training precision
// checkpoint may need 256 independent games, but still uses at most the
// configured process ceiling and obeys the pool's memory backpressure.
export function trainingPrecisionCheckpointGames(options = {}) {
  const checkpoint = options.stopWhenEvidenceCheckpoint;
  const demand = checkpoint?.requirement?.shadowActionEffectDemand;
  const games = Number(demand?.requestedGames);
  return checkpoint?.role === "training"
    && demand?.precisionPlanning === true
    && Number.isInteger(games) && games > 0 && games <= 256
    ? games : 0;
}

export function evaluatorBootstrapPrecisionCollectionWindow({
  options = {}, allocation, audit, completedLogical, samplingMode
}) {
  const waveGames = trainingPrecisionCheckpointGames(options);
  const roles = options.activeEvidenceRoles;
  const accepted = Number(audit?.certificationPartitions?.training?.acceptedGames);
  const target = Number(options.stopWhenEvidenceCheckpoint?.requirement?.minimumGames);
  if (!waveGames || samplingMode !== "leaf-audit"
    || roles?.length !== 1 || roles[0] !== "training"
    || !Number.isInteger(accepted) || accepted < 0
    || !Number.isInteger(target) || target <= accepted
    || !Number.isInteger(completedLogical) || completedLogical < 0) return null;

  const capacity = options.continueUntilComplete === true
    ? Infinity
    : Math.max(Number(allocation.allocatedGames) || 0,
      Number(options.maximumTotalGames) || 1280) - completedLogical;
  const remainingGames = Math.max(0, Math.min(waveGames, target - accepted, capacity));
  if (!remainingGames) return null;
  const targetCompletedLogical = completedLogical + remainingGames;
  const previous = allocation.activeCollectionWindow;
  const continuing = previous?.version === 1
    && previous.samplingMode === samplingMode
    && Number.isInteger(previous.startCompletedLogical)
    && completedLogical >= previous.startCompletedLogical
    && completedLogical < previous.targetCompletedLogical;
  const allocatedGames = Math.max(allocation.allocatedGames, targetCompletedLogical);
  return {
    remainingGames,
    allocation: {
      ...allocation,
      status: "collecting",
      allocatedGames,
      expansions: (Number(allocation.expansions) || 0)
        + Number(allocatedGames > allocation.allocatedGames),
      activeCollectionWindow: {
        ...(continuing ? previous : {}),
        version: 1,
        schedulingContract: "training-precision-checkpoint-queue-v1",
        samplingMode,
        startCompletedLogical: continuing ? previous.startCompletedLogical : completedLogical,
        targetCompletedLogical,
        actionCollectionStrategy: null,
        actionEvidenceSnapshot: null,
        createdAt: continuing ? previous.createdAt : new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    }
  };
}
