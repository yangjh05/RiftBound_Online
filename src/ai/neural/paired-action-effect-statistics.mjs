export const PAIRED_ACTION_EFFECT_ASSESSMENT_VERSION = 5;
export const PAIRED_ACTION_EFFECT_CONFIDENCE_METHOD =
  "paired-multinomial-exact-projection-v1";

export function pairedBinaryDifferenceInterval(
  outcomePairs = [],
  confidence = 0.95
) {
  const pairs = (outcomePairs || []).map((pair) => ({
    left: Number(pair?.leftOutcome),
    right: Number(pair?.rightOutcome)
  }));
  if (!pairs.length || pairs.some(({ left, right }) =>
    ![0, 1].includes(left) || ![0, 1].includes(right))) return null;
  const samples = pairs.length;
  const wins = pairs.filter(({ left, right }) => left > right).length;
  const losses = pairs.filter(({ left, right }) => left < right).length;
  const ties = samples - wins - losses;
  return pairedBinaryDifferenceIntervalFromCounts(
    wins,
    losses,
    ties,
    confidence
  );
}

export function pairedBinaryDifferenceIntervalFromCounts(
  wins,
  losses,
  ties,
  confidence = 0.95
) {
  const samples = Number(wins) + Number(losses) + Number(ties);
  if (![wins, losses, ties].every(
    (value) => Number.isInteger(Number(value)) && Number(value) >= 0
  ) || samples <= 0) return null;
  const boundedConfidence = Math.max(
    0.95,
    Math.min(0.999999, Number(confidence) || 0.95)
  );
  const mean = (wins - losses) / samples;
  // Simultaneous exact binomial bounds for the win and loss marginals form
  // a finite-sample confidence set for p(win)-p(loss). The former asymptotic
  // profile interval never narrowed this projection on the production sample
  // sizes, so it is no longer part of either the result or the hot path.
  const tailAlpha = (1 - boundedConfidence) / 4;
  const exactLowerBound = clopperPearsonLower(wins, samples, tailAlpha)
    - clopperPearsonUpper(losses, samples, tailAlpha);
  const exactUpperBound = clopperPearsonUpper(wins, samples, tailAlpha)
    - clopperPearsonLower(losses, samples, tailAlpha);
  const lowerBound = Math.max(-1, exactLowerBound);
  const upperBound = Math.min(1, exactUpperBound);
  return {
    version: PAIRED_ACTION_EFFECT_ASSESSMENT_VERSION,
    method: PAIRED_ACTION_EFFECT_CONFIDENCE_METHOD,
    confidence: boundedConfidence,
    samples,
    wins,
    losses,
    ties,
    mean,
    lowerBound,
    upperBound,
    profileInterval: null,
    exactProjectionInterval: {
      lowerBound: Math.max(-1, exactLowerBound),
      upperBound: Math.min(1, exactUpperBound),
      familyWiseConfidence: boundedConfidence,
      marginalTailAlpha: tailAlpha
    },
    finiteSampleCoverageCorrection: "exact-marginal-bonferroni-v1"
  };
}

function clopperPearsonLower(successes, attempts, alpha) {
  if (successes === 0) return 0;
  if (successes === attempts) return Math.pow(alpha, 1 / attempts);
  let lower = 0;
  let upper = successes / attempts;
  const target = 1 - alpha;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (binomialCdf(successes - 1, attempts, middle) > target) {
      lower = middle;
    } else upper = middle;
  }
  return (lower + upper) / 2;
}

function clopperPearsonUpper(successes, attempts, alpha) {
  if (successes === attempts) return 1;
  if (successes === 0) return 1 - Math.pow(alpha, 1 / attempts);
  let lower = successes / attempts;
  let upper = 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (binomialCdf(successes, attempts, middle) > alpha) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

function binomialCdf(maximumSuccesses, attempts, probability) {
  if (maximumSuccesses < 0) return 0;
  if (maximumSuccesses >= attempts) return 1;
  if (probability === 0) return 1;
  if (probability === 1) return 0;
  const complement = 1 - probability;
  let term = Math.pow(complement, attempts);
  let total = term;
  for (let successes = 1;
    successes <= maximumSuccesses;
    successes += 1) {
    term *= (attempts - successes + 1) / successes
      * probability / complement;
    total += term;
  }
  return Math.max(0, Math.min(1, total));
}
