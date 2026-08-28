export function compareRetentionByDeck(baseline, current, options = {}) {
  const failures = [];
  const warnings = [];
  const minimumDecisionSteps = Math.max(1, options.minimumDecisionSteps || 64);
  const minimumCorrectionSteps = Math.max(1, options.minimumCorrectionSteps || 8);
  const accuracyTolerance = Math.max(0, options.accuracyTolerance ?? 0.08);
  const catastrophicAccuracyDrop = Math.max(accuracyTolerance, options.catastrophicAccuracyDrop ?? 0.18);
  const correctionAccuracyTolerance = Math.max(0, options.correctionAccuracyTolerance ?? 0.12);
  for (const [deckId, before] of Object.entries(baseline || {})) {
    const after = current?.[deckId];
    if (!after) continue;
    const decisionSteps = Math.min(Number(before.decisionSteps) || 0, Number(after.decisionSteps) || 0);
    const accuracyDrop = (Number(before.decisionAccuracy) || 0) - (Number(after.decisionAccuracy) || 0);
    const accuracyFloor = Math.max(0, (Number(before.decisionAccuracy) || 0) - accuracyTolerance);
    const lossCeiling = Math.max((Number(before.policyLoss) || 0) + 0.08, (Number(before.policyLoss) || 0) * 1.35);
    const enoughEvidence = decisionSteps >= minimumDecisionSteps;
    const accuracyDegraded = enoughEvidence && accuracyDrop > accuracyTolerance;
    const lossDegraded = (Number(after.policyLoss) || 0) > lossCeiling;
    const catastrophic = enoughEvidence && accuracyDrop > catastrophicAccuracyDrop;
    const correctionSteps = Math.min(
      Number(before.verifiedCorrectionSteps) || 0,
      Number(after.verifiedCorrectionSteps) || 0
    );
    const correctionAccuracyDrop = Number(before.verifiedCorrectionAccuracy)
      - Number(after.verifiedCorrectionAccuracy);
    const correctionRegressed = correctionSteps >= minimumCorrectionSteps
      && Number.isFinite(correctionAccuracyDrop)
      && correctionAccuracyDrop > correctionAccuracyTolerance;
    const evidence = {
      deckId, decisionSteps, enoughEvidence, accuracyDrop, accuracyFloor,
      decisionAccuracy: after.decisionAccuracy, lossCeiling, policyLoss: after.policyLoss,
      accuracyDegraded, lossDegraded, catastrophic,
      correctionSteps, correctionAccuracyDrop, correctionRegressed
    };
    if (catastrophic || correctionRegressed || (accuracyDegraded && lossDegraded)) failures.push(evidence);
    else if (accuracyDegraded || lossDegraded) warnings.push(evidence);
  }
  const baselineScore = retentionCompositeScore(baseline);
  const score = retentionCompositeScore(current);
  return { version: 4, passed: failures.length === 0, failures, warnings, baselineScore, score, scoreDelta: score - baselineScore };
}

export function retentionCompositeScore(results) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const metrics of Object.values(results || {})) {
    const weight = Math.max(1, Number(metrics.decisionSteps) || 0);
    const decisionAdvantage = (Number(metrics.decisionAccuracy) || 0) - (Number(metrics.decisionChanceAccuracy) || 0);
    const policyLoss = Math.max(0, Number(metrics.policyLoss) || 0);
    const valueMse = Math.max(0, Math.min(2, Number(metrics.valueMse) || 0));
    const beliefLoss = Math.max(0, Math.min(2, Number(metrics.beliefLoss) || 0));
    weightedScore += weight * (
      decisionAdvantage
      - policyLoss * 0.2
      - valueMse * 0.05
      - beliefLoss * 0.05
    );
    totalWeight += weight;
  }
  return totalWeight ? weightedScore / totalWeight : Number.NEGATIVE_INFINITY;
}

export function summarizePracticalEvaluation(evaluation, options = {}) {
  const requiredDeckIds = [...new Set(options.requiredDeckIds || [])];
  const minimumDeckGames = Math.max(1, Math.floor(Number(options.minimumDeckGames) || 1));
  const deckScores = Object.fromEntries(Object.entries(evaluation?.deckStats || {}).map(([deckId, stat]) => {
    const winRate = clamp01(Number(stat.winRate) || 0);
    const completed = Number(stat.completed) || 0;
    const margin = (Number(stat.meanScoreFor) || 0) - (Number(stat.meanScoreAgainst) || 0);
    const marginScore = clamp01((margin + 8) / 16);
    const score = winRate * 0.65 + marginScore * 0.35;
    return [deckId, {
      completed,
      winRate,
      meanScoreMargin: margin,
      score,
      // Kept as compatibility fields for archived reports. Epoch selection
      // must never raise an observed weak-cell score toward neutral merely
      // because the cell is small.
      confidenceAdjustedWinRate: winRate,
      confidenceAdjustedScore: score
    }];
  }));
  const conditionScores = Object.fromEntries(Object.entries(evaluation?.conditionStats || {}).map(([key, stat]) => {
    const completed = Number(stat.completed) || 0;
    const winRate = clamp01(Number(stat.winRate) || 0);
    return [key, {
      completed,
      winRate,
      confidenceAdjustedWinRate: winRate
    }];
  }));
  const completed = Number(evaluation?.completed) || 0;
  const requested = Math.max(1, Number(evaluation?.games) || completed || 1);
  const completionRate = clamp01(completed / requested);
  const overall = clamp01(Number(evaluation?.winRate) || 0);
  const deckValues = Object.values(deckScores).filter((item) => item.completed > 0).map((item) => item.score);
  const conditionValues = Object.values(conditionScores).filter((item) => item.completed > 0).map((item) => item.winRate);
  const weakestDeck = deckValues.length ? Math.min(...deckValues) : overall;
  const lowerTailDeckCvar = lowerTailMean(deckValues, Number(options.deckCvarFraction) || 0.4);
  const weakestCondition = conditionValues.length ? Math.min(...conditionValues) : overall;
  const score = (overall * 0.45 + weakestDeck * 0.35 + weakestCondition * 0.2) * completionRate;
  const missingDeckIds = requiredDeckIds.filter((deckId) => !deckScores[deckId]);
  const underCoveredDeckIds = requiredDeckIds.filter((deckId) =>
    deckScores[deckId] && deckScores[deckId].completed < minimumDeckGames);
  const coverage = {
    version: 1,
    passed: missingDeckIds.length === 0 && underCoveredDeckIds.length === 0,
    requiredDeckIds,
    minimumDeckGames,
    missingDeckIds,
    underCoveredDeckIds,
    deckGames: Object.fromEntries(requiredDeckIds.map((deckId) => [
      deckId,
      Number(deckScores[deckId]?.completed) || 0
    ]))
  };
  const pairedEvidence = summarizePairedEvaluationEvidence(evaluation?.summaries || []);
  return {
    version: 5,
    games: requested,
    completed,
    completionRate,
    invalidGames: Number(evaluation?.invalidGames) || 0,
    winRate: overall,
    weakestDeckScore: weakestDeck,
    lowerTailDeckCvar,
    weakestConditionWinRate: weakestCondition,
    score,
    selectionScore: score,
    confidenceAdjustedWeakestDeckScore: weakestDeck,
    confidenceAdjustedWeakestConditionWinRate: weakestCondition,
    coverage,
    pairedEvidence,
    deckScores,
    conditionScores
  };
}

export function combinedEpochSelectionScore(retentionScore, practicalScore, baselinePracticalScore, practicalWeight = 0.35) {
  const retention = Number(retentionScore);
  const practical = Number(practicalScore);
  const baselinePractical = Number(baselinePracticalScore);
  if (!Number.isFinite(retention)) return Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(practical) || !Number.isFinite(baselinePractical)) return retention;
  return retention + Math.max(0, Number(practicalWeight) || 0) * (practical - baselinePractical);
}

export function robustEpochSelection(retentionComparison, practical, options = {}) {
  const retentionScore = Number(retentionComparison?.score);
  const baselineRetentionScore = Number(options.baselineRetentionScore
    ?? retentionComparison?.baselineScore);
  const observedPracticalScore = Number(practical?.score);
  const practicalScore = Number(practical?.selectionScore ?? practical?.score);
  const practicalWinRate = Number(practical?.winRate);
  const neutralPracticalScore = Number(options.neutralPracticalScore ?? 0.5);
  const maximumRetentionDrop = Math.max(0, Number(options.maximumRetentionDrop) || 0.005);
  const minimumPracticalScore = clamp01(Number(options.minimumPracticalScore) || 0.47);
  const minimumPracticalWinRate = clamp01(Number(options.minimumPracticalWinRate) || 0.5);
  const requireBootstrapEvidence = options.requireBootstrapEvidence === true;
  const minimumBootstrapSupport = clamp01(
    Number.isFinite(Number(options.minimumBootstrapSupport))
      ? Number(options.minimumBootstrapSupport)
      : 0.75
  );
  const minimumDeckCvar = clamp01(
    Number.isFinite(Number(options.minimumDeckCvar))
      ? Number(options.minimumDeckCvar)
      : 0.35
  );
  const bootstrapSupport = Number(practical?.pairedEvidence?.bootstrapSupportRate);
  const lowerTailDeckCvar = Number(practical?.lowerTailDeckCvar);
  const retentionDrop = Number.isFinite(retentionScore) && Number.isFinite(baselineRetentionScore)
    ? baselineRetentionScore - retentionScore
    : Number.POSITIVE_INFINITY;
  const reasons = [];
  if (retentionComparison?.passed === false) reasons.push("retention-guard-failed");
  if (!Number.isFinite(retentionScore)) reasons.push("invalid-retention-score");
  if (practical) {
    if ((Number(practical.invalidGames) || 0) > 0) reasons.push("invalid-practical-games");
    if ((Number(practical.completionRate) || 0) < 1) reasons.push("incomplete-practical-evaluation");
    if (practical.coverage?.passed === false) reasons.push("incomplete-deck-coverage");
    if (!Number.isFinite(practicalScore) || practicalScore < minimumPracticalScore) reasons.push("low-practical-score");
    if (!Number.isFinite(practicalWinRate) || practicalWinRate < minimumPracticalWinRate) reasons.push("low-practical-win-rate");
    if (requireBootstrapEvidence
      && (!Number.isFinite(bootstrapSupport) || bootstrapSupport < minimumBootstrapSupport)) {
      reasons.push("insufficient-bootstrap-support");
    }
    if (requireBootstrapEvidence
      && (!Number.isFinite(lowerTailDeckCvar) || lowerTailDeckCvar < minimumDeckCvar)) {
      reasons.push("low-deck-cvar");
    }
  }
  // Selection is deliberately lexicographic rather than a weighted sum of
  // unlike units. Retention is a hard catastrophic-regression guard first,
  // paired practical play is the primary selector, and old-policy agreement
  // is only a tie-breaker when practical evidence is indistinguishable.
  const primaryScore = Number.isFinite(practicalScore)
    ? practicalScore
    : neutralPracticalScore;
  const tieBreakerScore = Number.isFinite(retentionScore)
    ? retentionScore
    : Number.NEGATIVE_INFINITY;
  return {
    version: 4,
    selectionPolicy: requireBootstrapEvidence
      ? "hard-gates-paired-bootstrap-cvar-practical-first-v5"
      : "hard-gates-observed-practical-screen-retention-tiebreak-v5",
    selectionEligible: reasons.length === 0,
    reasons,
    score: primaryScore,
    primaryScore,
    tieBreakerScore,
    retentionScore,
    baselineRetentionScore,
    retentionDrop,
    maximumRetentionDrop,
    retentionFloorExceeded: retentionDrop > maximumRetentionDrop,
    practicalScore: Number.isFinite(practicalScore) ? practicalScore : null,
    observedPracticalScore: Number.isFinite(observedPracticalScore) ? observedPracticalScore : null,
    practicalWinRate: Number.isFinite(practicalWinRate) ? practicalWinRate : null,
    neutralPracticalScore,
    minimumPracticalScore,
    minimumPracticalWinRate,
    requireBootstrapEvidence,
    bootstrapSupport: Number.isFinite(bootstrapSupport) ? bootstrapSupport : null,
    minimumBootstrapSupport,
    lowerTailDeckCvar: Number.isFinite(lowerTailDeckCvar) ? lowerTailDeckCvar : null,
    minimumDeckCvar
  };
}

export function evaluateLearnerAdvance(evaluation, deckIds, options = {}) {
  const completionRate = clamp01((Number(evaluation?.completed) || 0)
    / Math.max(1, Number(evaluation?.games) || 0));
  const minimumCompletionRate = clamp01(Number(options.minimumCompletionRate) || 0.9);
  const minimumWinRate = clamp01(Number(options.minimumWinRate) || 0.525);
  const minimumWilsonLowerBound = clamp01(Number(options.minimumWilsonLowerBound) || 0.35);
  const maximumSeatGap = clamp01(Number(options.maximumSeatGap) || 0.3);
  const maximumConditionGap = clamp01(Number(options.maximumConditionGap) || 0.5);
  const baselineEvaluation = options.baselineEvaluation || null;
  const baselineSeatGap = baselineEvaluation
    ? clamp01(Number(baselineEvaluation.seatGap) || 0)
    : null;
  const baselineConditionGap = baselineEvaluation
    ? clamp01(Number(baselineEvaluation.conditionGap) || 0)
    : null;
  const seatGapIncrease = baselineEvaluation
    ? (Number(evaluation?.seatGap) || 0) - baselineSeatGap
    : null;
  const conditionGapIncrease = baselineEvaluation
    ? (Number(evaluation?.conditionGap) || 0) - baselineConditionGap
    : null;
  const maximumSeatGapIncrease = clamp01(
    Number(options.maximumSeatGapIncrease) || 0.1
  );
  const maximumConditionGapIncrease = clamp01(
    Number(options.maximumConditionGapIncrease) || 0.1
  );
  const maximumSeatWinRateDrop = clamp01(
    Number(options.maximumSeatWinRateDrop) || 0.1
  );
  const maximumConditionWinRateDrop = clamp01(
    Number(options.maximumConditionWinRateDrop) || 0.15
  );
  const seatRegressions = baselineEvaluation
    ? keyedWinRateRegressions(
      evaluation?.seatStats,
      baselineEvaluation?.seatStats,
      maximumSeatWinRateDrop,
      (key) => `seat-${key}`
    )
    : [];
  const conditionRegressions = baselineEvaluation
    ? keyedWinRateRegressions(
      evaluation?.conditionStats,
      baselineEvaluation?.conditionStats,
      maximumConditionWinRateDrop,
      (key) => key
    )
    : [];
  const failures = [];
  if (completionRate < minimumCompletionRate) failures.push({
    reason: "insufficient-completion", completionRate, minimumCompletionRate
  });
  if ((Number(evaluation?.invalidGames) || 0) > 0) failures.push({
    reason: "invalid-games", invalidGames: Number(evaluation.invalidGames) || 0
  });
  if ((Number(evaluation?.winRate) || 0) < minimumWinRate) failures.push({
    reason: "low-win-rate", winRate: Number(evaluation?.winRate) || 0, minimumWinRate
  });
  if ((Number(evaluation?.wilsonLowerBound) || 0) < minimumWilsonLowerBound) failures.push({
    reason: "low-wilson-bound",
    wilsonLowerBound: Number(evaluation?.wilsonLowerBound) || 0,
    minimumWilsonLowerBound
  });
  if (baselineEvaluation) {
    if (seatRegressions.length) failures.push(...seatRegressions.map(
      (regression) => ({ reason: "seat-win-rate-regression", ...regression })
    ));
    if (conditionRegressions.length) failures.push(
      ...conditionRegressions.map((regression) => ({
        reason: "condition-win-rate-regression",
        ...regression
      }))
    );
    // Legacy summaries may not contain per-seat/per-condition statistics.
    // Keep the former gap check only as a compatibility fallback; current
    // evaluations always take the more informative keyed path above.
    if (!hasComparableWinRateStats(
      evaluation?.seatStats,
      baselineEvaluation?.seatStats
    ) && seatGapIncrease > maximumSeatGapIncrease) failures.push({
      reason: "seat-gap-regression",
      seatGap: Number(evaluation?.seatGap) || 0,
      baselineSeatGap,
      seatGapIncrease,
      maximumSeatGapIncrease
    });
    if (!hasComparableWinRateStats(
      evaluation?.conditionStats,
      baselineEvaluation?.conditionStats
    ) && conditionGapIncrease > maximumConditionGapIncrease) failures.push({
      reason: "condition-gap-regression",
      conditionGap: Number(evaluation?.conditionGap) || 0,
      baselineConditionGap,
      conditionGapIncrease,
      maximumConditionGapIncrease
    });
  } else {
    if ((Number(evaluation?.seatGap) || 0) > maximumSeatGap) failures.push({
      reason: "seat-gap", seatGap: Number(evaluation?.seatGap) || 0, maximumSeatGap
    });
    if ((Number(evaluation?.conditionGap) || 0) > maximumConditionGap) failures.push({
      reason: "condition-gap", conditionGap: Number(evaluation?.conditionGap) || 0, maximumConditionGap
    });
  }
  const deckSafety = options.deckSafety || evaluateDeckSafety(evaluation, deckIds, {
    minimumDeckWinRate: options.minimumDeckWinRate,
    minimumDeckScoreMargin: options.minimumDeckScoreMargin,
    minimumDeckGames: options.minimumDeckGames,
    confirmationDeckGames: options.confirmationDeckGames
  });
  for (const item of deckSafety.decks) {
    if (item.status === "pass") continue;
    failures.push({
      reason: item.status === "fail" ? "deck-collapse" : "deck-confirmation-required",
      ...item
    });
  }
  return {
    version: 5,
    passed: failures.length === 0,
    failures,
    completionRate,
    minimumCompletionRate,
    minimumWinRate,
    minimumWilsonLowerBound,
    maximumSeatGap,
    maximumConditionGap,
    baselineSeatGap,
    baselineConditionGap,
    seatGapIncrease,
    conditionGapIncrease,
    maximumSeatGapIncrease,
    maximumConditionGapIncrease,
    maximumSeatWinRateDrop,
    maximumConditionWinRateDrop,
    seatRegressions,
    conditionRegressions,
    minimumDeckWinRate: deckSafety.minimumDeckWinRate,
    minimumDeckScoreMargin: deckSafety.minimumDeckScoreMargin,
    minimumDeckGames: deckSafety.minimumDeckGames,
    deckSafety
  };
}

function keyedWinRateRegressions(
  candidateStats,
  baselineStats,
  maximumDrop,
  keyLabel
) {
  if (!hasComparableWinRateStats(candidateStats, baselineStats)) return [];
  const candidateEntries = new Map(normalizedStatEntries(candidateStats));
  const baselineEntries = normalizedStatEntries(baselineStats);
  return baselineEntries.flatMap(([key, baseline]) => {
    if (!(Number(baseline.completed) > 0)) return [];
    const candidate = candidateEntries.get(key) || {};
    const candidateWinRate = Number(candidate.winRate) || 0;
    const baselineWinRate = Number(baseline.winRate) || 0;
    const delta = candidateWinRate - baselineWinRate;
    return delta < -maximumDrop
      ? [{
        key: keyLabel(key),
        candidateWinRate,
        baselineWinRate,
        delta,
        maximumDrop,
        candidateGames: Number(candidate.completed) || 0,
        baselineGames: Number(baseline.completed) || 0
      }]
      : [];
  });
}

function hasComparableWinRateStats(candidateStats, baselineStats) {
  const candidate = normalizedStatEntries(candidateStats);
  const baseline = new Map(normalizedStatEntries(baselineStats));
  return candidate.some(([key, stat]) =>
    Number(stat?.completed) > 0
      && Number(baseline.get(key)?.completed) > 0);
}

function normalizedStatEntries(stats) {
  if (Array.isArray(stats)) {
    return stats.map((stat, index) => [String(index), stat || {}]);
  }
  if (stats && typeof stats === "object") return Object.entries(stats);
  return [];
}

export function evaluateDeckSafety(evaluation, deckIds, options = {}) {
  const minimumDeckWinRate = clamp01(finiteOr(options.minimumDeckWinRate, 0.25));
  const minimumDeckScoreMargin = Math.max(-8, Math.min(0,
    finiteOr(options.minimumDeckScoreMargin, -3.5)));
  const minimumDeckGames = Math.max(2, Math.floor(finiteOr(
    options.minimumDeckGames,
    (Number(evaluation?.games) || 0) / Math.max(1, (deckIds?.length || 1) * 2)
  )));
  const confirmationDeckGames = Math.max(
    minimumDeckGames,
    Math.floor(finiteOr(options.confirmationDeckGames, Math.max(24, minimumDeckGames)))
  );
  const decks = (deckIds || []).map((deckId) => {
    const stat = evaluation?.deckStats?.[deckId];
    const completed = Number(stat?.completed) || 0;
    const winRate = Number(stat?.winRate) || 0;
    const meanScoreMargin = (Number(stat?.meanScoreFor) || 0)
      - (Number(stat?.meanScoreAgainst) || 0);
    const lowWinRate = winRate <= minimumDeckWinRate;
    const lowScoreMargin = meanScoreMargin <= minimumDeckScoreMargin;
    const triggered = lowWinRate || lowScoreMargin;
    const status = completed < minimumDeckGames
      ? "needs-confirmation"
      : !triggered
        ? "pass"
        : completed < confirmationDeckGames
          ? "needs-confirmation"
          : "fail";
    return {
      deckId,
      status,
      completed,
      winRate,
      meanScoreMargin,
      lowWinRate,
      lowScoreMargin,
      minimumDeckWinRate,
      minimumDeckScoreMargin,
      minimumDeckGames,
      confirmationDeckGames
    };
  });
  return {
    version: 1,
    status: decks.some((item) => item.status === "fail")
      ? "fail"
      : decks.some((item) => item.status === "needs-confirmation")
        ? "needs-confirmation"
        : "pass",
    passed: decks.every((item) => item.status === "pass"),
    minimumDeckWinRate,
    minimumDeckScoreMargin,
    minimumDeckGames,
    confirmationDeckGames,
    decks
  };
}

function summarizePairedEvaluationEvidence(summaries) {
  const blocks = new Map();
  for (const summary of summaries || []) {
    if (!summary?.completed || !Number.isInteger(summary.candidateSeat)) continue;
    const deckKey = [...(summary.deckIds || [])].sort().join("|");
    const key = `${summary.gameSeed ?? "none"}:${deckKey}`;
    const block = blocks.get(key) || { games: 0, wins: 0 };
    block.games += 1;
    if (summary.winnerId === `p${summary.candidateSeat + 1}`) block.wins += 1;
    blocks.set(key, block);
  }
  const completeBlocks = [...blocks.values()].filter((block) => block.games > 0);
  if (!completeBlocks.length) {
    return {
      version: 1,
      blocks: 0,
      completedGames: 0,
      meanBlockWinRate: null,
      confidenceLower: null,
      confidenceUpper: null
    };
  }
  const values = completeBlocks.map((block) => block.wins / block.games);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    : 0;
  const standardError = values.length > 1 ? Math.sqrt(variance / values.length) : 0.5;
  const spread = 1.96 * standardError;
  const bootstrap = bootstrapBlockMeans(values);
  return {
    version: 2,
    blocks: values.length,
    completedGames: completeBlocks.reduce((sum, block) => sum + block.games, 0),
    meanBlockWinRate: mean,
    standardError,
    confidenceLower: clamp01(mean - spread),
    confidenceUpper: clamp01(mean + spread),
    bootstrapSupportRate: bootstrap.supportRate,
    bootstrapConfidenceLower: bootstrap.lower,
    bootstrapConfidenceUpper: bootstrap.upper
  };
}

function bootstrapBlockMeans(values, iterations = 2000) {
  if (!values.length) return { supportRate: null, lower: null, upper: null };
  let state = 0x7f4a7c15;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const means = [];
  let positive = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    const value = sum / values.length;
    means.push(value);
    if (value > 0.5) positive += 1;
  }
  means.sort((left, right) => left - right);
  return {
    supportRate: positive / iterations,
    lower: means[Math.floor(iterations * 0.025)],
    upper: means[Math.min(iterations - 1, Math.floor(iterations * 0.975))]
  };
}

function lowerTailMean(values, fraction = 0.4) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const count = Math.max(1, Math.ceil(sorted.length * Math.max(0.1, Math.min(1, fraction))));
  return sorted.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
}

function finiteOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
