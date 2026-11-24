// Planning only: these targets never certify a model or replace its measured
// confidence bounds. Constants mirror the trainer's 95% game-cluster bounds.
export const SHADOW_PRECISION_PLANNING_CONTRACT = "policy-q-independent-evidence-planning-v1";
const alpha = 0.05;
const tailFraction = 0.1;

export function policyQPrecisionTarget(requirement, distribution) {
  if (distribution === "targeted") {
    const margin = Number(requirement.minimumDecisiveAccuracy)
      - Number(requirement.minimumDecisiveAccuracyLowerBound);
    if (!(margin > 0 && margin < 1)) throw new Error("Invalid decisive precision margin");
    // Two-sided Hoeffding radius used by conservativeStratifiedGameAccuracyInterval.
    const effectiveGames = Math.floor(Math.log(2 / alpha) / (2 * margin ** 2)) + 1;
    return { independentGames: Math.max(effectiveGames,
      requirement.minimumContributingGames || 0), effectiveGames,
      basis: "decisive-accuracy-threshold-margin", confidence: 1 - alpha };
  }
  const limits = [requirement.maximumPopulationRegretUpperBound,
    requirement.maximumThreePercentLossRate, requirement.maximumFivePercentLossRate];
  const cvarLimit = Number(requirement.maximumWorstTenPercentCvar);
  if (!limits.every(n => Number(n) > 0 && Number(n) < 1)
    || !(cvarLimit > 0 && cvarLimit < 1)) throw new Error("Invalid natural precision limits");
  const concentrationGames = Math.ceil(Math.log(1 / alpha)
    / (2 * Math.min(...limits) ** 2));
  // Even an equal-weight, all-zero-loss sample leaves an unobserved tail.
  // 1 - alpha^(1/n) <= tailFraction * allowed CVaR.
  const zeroLossTailGames = Math.ceil(Math.log(alpha) / Math.log1p(-tailFraction * cvarLimit));
  const independentGames = Math.max(concentrationGames, zeroLossTailGames,
    requirement.minimumContributingGames || 0, requirement.minimumRiskAssessedGames || 0);
  return { independentGames, effectiveGames: independentGames, concentrationGames,
    zeroLossTailGames, basis: "equal-weight-zero-loss-reference", confidence: 1 - alpha,
    sufficientForPerformance: false };
}

export function precisionEvidenceRequirement(grid, phase, distribution) {
  return phase === "overall" ? grid.performanceRequirements.regretAlternative
    : grid.performanceRequirements.phaseActionEffect[distribution];
}

export function policyQPrecisionDemandItem(item, grid, actual = {}, validationGames = 0) {
  const distribution = item.auditDistribution === "natural-distribution" ? "natural" : "targeted";
  const phase = item.deficientPhaseBand || item.phaseBand || "overall";
  const target = policyQPrecisionTarget(precisionEvidenceRequirement(grid, phase, distribution), distribution);
  const targetGames = Math.max(target.independentGames, Number(item.targetValidationGames) || 0);
  const targetEffective = Math.max(target.effectiveGames, Number(item.targetEffectiveGames) || 0);
  const games = Number(distribution === "natural"
    ? actual.riskAssessedContributingGames : actual.decisiveContributingGames) || 0;
  const effective = Number(distribution === "natural"
    ? actual.effectiveGames : actual.decisiveEffectiveGames) || 0;
  const additionalValidationGames = Math.max(0, Math.ceil(targetGames - games),
    Math.ceil(targetEffective - effective), Number(item.additionalValidationGames) || 0);
  // The yield includes distribution/phase/deck and audit eligibility. No
  // speculative conversion of "validation games" into "new collection games".
  const observedYield = validationGames > 0 ? Math.min(1, games / validationGames) : null;
  const estimatedCollectionGames = additionalValidationGames === 0 ? 0
    : observedYield > 0 ? Math.ceil(additionalValidationGames
      / (Number(grid.validationFraction) * observedYield)) : null;
  return { ...item, precisionPlanningContract: SHADOW_PRECISION_PLANNING_CONTRACT,
    targetValidationGames: targetGames, targetEffectiveGames: targetEffective,
    observedValidationGames: games, observedPrecisionEffectiveGames: effective,
    additionalValidationGames, observedYieldPerValidationGame: observedYield,
    estimatedCollectionGames, estimateIsGuarantee: false,
    // Legacy field is explicitly in collection units; zero-yield buckets use
    // a bounded discovery batch and retain an unknown total estimate.
    requiredAdditionalGames: estimatedCollectionGames ?? 64,
    requiredAdditionalGamesUnit: "collection-games",
    planningBasis: target.basis };
}

export function precisionRetryCollectionGames(items) {
  const planned = items.filter(item => item?.precisionPlanningContract === SHADOW_PRECISION_PLANNING_CONTRACT);
  if (!planned.length) return null;
  // Overlapping phase/deck demands must not be summed as independent games.
  // Recheck cheap evidence after at most 256 games, using 32-game worker pools.
  return Math.min(256, Math.max(64, ...planned.map(item =>
    Number(item.estimatedCollectionGames) || Number(item.requiredAdditionalGames) || 64)));
}

export function precisionTargetFromMeasuredRisk(summary, target, requirement) {
  let requested = target.independentGames;
  const bootstrap = summary?.populationRiskBootstrap;
  if (!bootstrap) return requested;
  const games = Number(bootstrap.contributingGames) || 0;
  for (const [metric, limit] of [["meanRegret", requirement.maximumPopulationRegretUpperBound],
    ["aboveThreePercentRate", requirement.maximumThreePercentLossRate],
    ["aboveFivePercentRate", requirement.maximumFivePercentLossRate],
    ["worstTenPercentCvar", requirement.maximumWorstTenPercentCvar]]) {
    const interval = bootstrap[metric];
    if (!interval || interval.pointEstimate == null || interval.upperBound == null) continue;
    const point = Number(interval.pointEstimate), upper = Number(interval.upperBound);
    const margin = Number(limit) - point;
    // A point estimate already outside the limit is a model problem; do not
    // claim that a larger sample will repair it.
    if (!(games > 0 && margin > 0 && upper > Number(limit))) continue;
    const projection = Math.ceil(games * ((upper - point) / margin) ** 2);
    if (Number.isSafeInteger(projection)) requested = Math.max(requested, projection);
  }
  return requested;
}
