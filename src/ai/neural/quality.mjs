import { createHash } from "node:crypto";
import { ACTION_DIM, CARD_BINS, MAX_ACTIONS, STATE_DIM } from "./encoding.mjs";
import { NEURAL_HIDDEN_SIZE } from "./model.mjs";

export function auditImitationDataset({ collected, split, deckIds, thresholds = {} }) {
  const integrityErrors = validateTrajectories(collected.trajectories);
  const completedSummaries = collected.summaries.filter((summary) => summary.completed);
  const steps = collected.trajectories.flatMap((trajectory) => trajectory.steps);
  const attemptedGames = collected.attemptedGames || 0;
  const cappedGames = collected.summaries.filter((summary) => summary.capped).length;
  const truncatedSteps = steps.filter((step) => step.actionSetTruncated).length;
  const representedDecks = new Set(completedSummaries.flatMap((summary) => summary.deckIds || []));
  const firstPlayerCounts = countValues(completedSummaries.map((summary) => summary.firstPlayerId));
  const firstPlayerImbalance = completedSummaries.length
    ? Math.abs((firstPlayerCounts.p1 || 0) - (firstPlayerCounts.p2 || 0)) / completedSummaries.length
    : 1;
  const trainingIds = new Set(split.training.map((trajectory) => trajectory.gameId));
  const validationIds = new Set(split.validation.map((trajectory) => trajectory.gameId));
  const overlap = [...trainingIds].filter((gameId) => validationIds.has(gameId));
  if (overlap.length) integrityErrors.push(`Training and validation share ${overlap.length} game IDs.`);

  const metrics = {
    completedGames: collected.completedGames,
    targetGames: collected.targetGames,
    attemptedGames,
    completionRate: attemptedGames ? collected.completedGames / attemptedGames : 0,
    capRate: attemptedGames ? cappedGames / attemptedGames : 1,
    steps: steps.length,
    stepsPerCompletedGame: collected.completedGames ? steps.length / collected.completedGames : 0,
    truncatedSteps,
    truncationRate: steps.length ? truncatedSteps / steps.length : 0,
    maxLegalActions: Math.max(0, ...steps.map((step) => step.originalLegalCount || step.legalCount || 0)),
    representedDecks: representedDecks.size,
    availableDecks: deckIds.length,
    deckCoverage: deckIds.length ? representedDecks.size / deckIds.length : 0,
    firstPlayerCounts,
    firstPlayerImbalance,
    actionKinds: countValues(steps.map((step) => step.selectedKind || "unknown")),
    fingerprint: fingerprintTrajectories(collected.trajectories)
  };
  const limits = {
    maxCapRate: thresholds.maxCapRate ?? 0.15,
    maxTruncationRate: thresholds.maxTruncationRate ?? 0.01,
    minDeckCoverage: thresholds.minDeckCoverage ?? 0.9,
    maxSeatImbalance: thresholds.maxSeatImbalance ?? 0.15,
    minStepsPerGame: thresholds.minStepsPerGame ?? 10
  };
  const checks = [
    check("trajectory-integrity", integrityErrors.length === 0, { errors: integrityErrors }),
    check("target-games-completed", collected.completedGames === collected.targetGames, { actual: collected.completedGames, expected: collected.targetGames }),
    check("non-empty-split", split.training.length > 0 && split.validation.length > 0, { training: split.training.length, validation: split.validation.length }),
    check("cap-rate", metrics.capRate <= limits.maxCapRate, { actual: metrics.capRate, maximum: limits.maxCapRate }),
    check("action-truncation-rate", metrics.truncationRate <= limits.maxTruncationRate, { actual: metrics.truncationRate, maximum: limits.maxTruncationRate }),
    check("deck-coverage", metrics.deckCoverage >= limits.minDeckCoverage, { actual: metrics.deckCoverage, minimum: limits.minDeckCoverage }),
    check("first-player-balance", metrics.firstPlayerImbalance <= limits.maxSeatImbalance, { actual: metrics.firstPlayerImbalance, maximum: limits.maxSeatImbalance }),
    check("steps-per-game", metrics.stepsPerCompletedGame >= limits.minStepsPerGame, { actual: metrics.stepsPerCompletedGame, minimum: limits.minStepsPerGame })
  ];
  return { passed: checks.every((item) => item.passed), checks, metrics, limits };
}

export function assessBehaviorCloningQuality({ baseline, validation, training, validationGames, thresholds = {} }) {
  const limits = {
    minDecisionAdvantage: thresholds.minDecisionAdvantage ?? 0.01,
    minAccuracyImprovement: thresholds.minAccuracyImprovement ?? 0.002,
    minRelativePolicyLossImprovement: thresholds.minRelativePolicyLossImprovement ?? 0.01,
    maxGeneralizationGap: thresholds.maxGeneralizationGap ?? 0.3,
    minDecisionStepsPerGame: thresholds.minDecisionStepsPerGame ?? 5
  };
  const accuracyImprovement = validation.decisionAccuracy - baseline.decisionAccuracy;
  const relativePolicyLossImprovement = baseline.policyLoss > 0
    ? (baseline.policyLoss - validation.policyLoss) / baseline.policyLoss
    : 0;
  const decisionAdvantage = validation.decisionAccuracy - validation.decisionChanceAccuracy;
  const generalizationGap = training.decisionAccuracy - validation.decisionAccuracy;
  const finite = [
    baseline.policyLoss, baseline.decisionAccuracy, validation.policyLoss, validation.valueMse,
    validation.beliefLoss, validation.decisionAccuracy, validation.decisionChanceAccuracy,
    training.policyLoss, training.decisionAccuracy
  ].every(Number.isFinite);
  const learnedSignal = accuracyImprovement >= limits.minAccuracyImprovement
    || relativePolicyLossImprovement >= limits.minRelativePolicyLossImprovement;
  const checks = [
    check("finite-metrics", finite, {}),
    check("validation-decision-samples", validation.decisionSteps >= validationGames * limits.minDecisionStepsPerGame, { actual: validation.decisionSteps, minimum: validationGames * limits.minDecisionStepsPerGame }),
    check("better-than-chance", decisionAdvantage >= limits.minDecisionAdvantage, { actual: decisionAdvantage, minimum: limits.minDecisionAdvantage }),
    check("learned-signal", learnedSignal, { accuracyImprovement, relativePolicyLossImprovement, minimumAccuracyImprovement: limits.minAccuracyImprovement, minimumRelativePolicyLossImprovement: limits.minRelativePolicyLossImprovement }),
    check("generalization-gap", generalizationGap <= limits.maxGeneralizationGap, { actual: generalizationGap, maximum: limits.maxGeneralizationGap })
  ];
  return {
    passed: checks.every((item) => item.passed), checks, limits,
    metrics: { accuracyImprovement, relativePolicyLossImprovement, decisionAdvantage, generalizationGap }
  };
}

function validateTrajectories(trajectories) {
  const errors = [];
  const keys = new Set();
  for (const trajectory of trajectories) {
    const key = `${trajectory.gameId}:${trajectory.playerId}`;
    if (keys.has(key)) errors.push(`Duplicate trajectory ${key}.`);
    keys.add(key);
    if (!trajectory.completed) errors.push(`Trajectory ${key} is not complete.`);
    if (!trajectory.steps?.length) errors.push(`Trajectory ${key} has no steps.`);
    for (let index = 0; index < (trajectory.steps || []).length; index += 1) {
      const step = trajectory.steps[index];
      const prefix = `${key} step ${index}`;
      if (step.state?.length !== STATE_DIM) errors.push(`${prefix} has invalid state length.`);
      if (step.beliefTarget?.length !== CARD_BINS) errors.push(`${prefix} has invalid belief length.`);
      if (step.initialMemory?.length !== NEURAL_HIDDEN_SIZE) errors.push(`${prefix} has invalid memory length.`);
      if (!Number.isInteger(step.legalCount) || step.legalCount < 1 || step.legalCount > MAX_ACTIONS) errors.push(`${prefix} has invalid legal count.`);
      if (step.actions?.length !== step.legalCount * ACTION_DIM) errors.push(`${prefix} has invalid action encoding length.`);
      if (!Number.isInteger(step.selectedIndex) || step.selectedIndex < 0 || step.selectedIndex >= step.legalCount) errors.push(`${prefix} has invalid selected index.`);
      if (![step.state, step.actions, step.beliefTarget, step.initialMemory].every(finiteArray)) errors.push(`${prefix} contains a non-finite tensor value.`);
      if (![step.advantage, step.return, step.teacherConfidence].every(Number.isFinite)) errors.push(`${prefix} contains a non-finite scalar.`);
      if (errors.length >= 100) return errors;
    }
  }
  return errors;
}

function fingerprintTrajectories(trajectories) {
  const hash = createHash("sha256");
  for (const trajectory of [...trajectories].sort((left, right) => `${left.gameId}:${left.playerId}`.localeCompare(`${right.gameId}:${right.playerId}`))) {
    hash.update(`${trajectory.gameId}:${trajectory.playerId}:${trajectory.steps.length}\n`);
    for (const step of trajectory.steps) {
      hash.update(`${step.selectedIndex}:${step.legalCount}:${step.return}:${step.teacherConfidence}\n`);
      for (const values of [step.state, step.actions, step.beliefTarget, step.initialMemory]) {
        hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
      }
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function finiteArray(values) {
  if (!values) return false;
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}
function countValues(values) { const counts = {}; for (const value of values) counts[value] = (counts[value] || 0) + 1; return counts; }
function check(name, passed, details) { return { name, passed: Boolean(passed), ...details }; }
