import {
  pairedBinaryDifferenceIntervalFromCounts
} from "../src/ai/neural/paired-action-effect-statistics.mjs";

const sampleSizes = [8, 32, 64, 128];
const confidence = 0.99;
const probabilities = [
  0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5,
  0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 1
];
const logFactorials = [0];

const reports = sampleSizes.map((samples) => validateCoverage(samples));
for (const report of reports) {
  console.log(JSON.stringify(report));
}
if (reports.some((report) => report.minimumCoverage + 1e-12 < confidence)) {
  process.exitCode = 1;
}

function validateCoverage(samples) {
  const intervals = new Map();
  for (let wins = 0; wins <= samples; wins += 1) {
    for (let losses = 0; losses <= samples - wins; losses += 1) {
      const ties = samples - wins - losses;
      intervals.set(
        `${wins}:${losses}`,
        pairedBinaryDifferenceIntervalFromCounts(
          wins,
          losses,
          ties,
          confidence
        )
      );
    }
  }
  let minimumCoverage = 1;
  let worstCase = null;
  let gridPoints = 0;
  for (const winProbability of probabilities) {
    for (const lossProbability of probabilities) {
      if (winProbability + lossProbability > 1 + 1e-12) continue;
      const tieProbability = Math.max(
        0,
        1 - winProbability - lossProbability
      );
      const effect = winProbability - lossProbability;
      let coverage = 0;
      for (let wins = 0; wins <= samples; wins += 1) {
        for (let losses = 0; losses <= samples - wins; losses += 1) {
          const ties = samples - wins - losses;
          const probability = multinomialProbability(
            samples,
            wins,
            losses,
            ties,
            winProbability,
            lossProbability,
            tieProbability
          );
          const interval = intervals.get(`${wins}:${losses}`);
          if (interval.lowerBound <= effect + 1e-12
            && interval.upperBound >= effect - 1e-12) {
            coverage += probability;
          }
        }
      }
      gridPoints += 1;
      if (coverage < minimumCoverage) {
        minimumCoverage = coverage;
        worstCase = {
          winProbability,
          lossProbability,
          tieProbability,
          effect
        };
      }
    }
  }
  return {
    samples,
    confidence,
    gridPoints,
    minimumCoverage,
    worstCase,
    method: "exact-multinomial-grid-v1"
  };
}

function multinomialProbability(
  samples,
  wins,
  losses,
  ties,
  winProbability,
  lossProbability,
  tieProbability
) {
  if ((wins > 0 && winProbability === 0)
    || (losses > 0 && lossProbability === 0)
    || (ties > 0 && tieProbability === 0)) return 0;
  const logProbability = logFactorial(samples)
    - logFactorial(wins)
    - logFactorial(losses)
    - logFactorial(ties)
    + safeLogPower(winProbability, wins)
    + safeLogPower(lossProbability, losses)
    + safeLogPower(tieProbability, ties);
  return Math.exp(logProbability);
}

function logFactorial(value) {
  for (let index = logFactorials.length; index <= value; index += 1) {
    logFactorials[index] = logFactorials[index - 1] + Math.log(index);
  }
  return logFactorials[value];
}

function safeLogPower(probability, count) {
  return count === 0 ? 0 : count * Math.log(probability);
}
