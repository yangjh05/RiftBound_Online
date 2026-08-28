import { createHash } from "node:crypto";

import { inferStep } from "./model.mjs";
import {
  neuralArtifactHash,
  neuralBehaviorHash
} from "./evaluator-certification.mjs";

export const CONTINUATION_STRENGTH_CONTRACT =
  "paired-league-continuation-strength-v1";
export const CONTINUATION_DIVERSITY_CONTRACT =
  "fixed-public-policy-probe-diversity-v1";
export const CONTINUATION_PROBE_CONTRACT =
  "fixed-public-policy-probe-v1";
const PAIRED_CONTINUATION_STRENGTH_EVALUATION_MODE =
  "same-deck-mirror-v3";

export function createFixedContinuationBehaviorProbe(
  trajectories,
  options = {}
) {
  const maximumStates = Math.max(
    16,
    Math.floor(Number(options.maximumStates) || 64)
  );
  const candidates = [];
  for (const trajectory of trajectories || []) {
    const gameId = String(trajectory?.gameId || trajectory?.id || "unknown");
    for (let stepIndex = 0; stepIndex < (trajectory?.steps || []).length; stepIndex += 1) {
      const step = trajectory.steps[stepIndex];
      const legalCount = Math.floor(Number(step?.legalCount) || 0);
      if (legalCount < 2 || !step?.state || !step?.actions) continue;
      const id = `${gameId}:${stepIndex}:${step.informationSetHash || "unknown"}`;
      const state = Array.from(step.state, Number);
      const actions = Array.from(step.actions, Number);
      const memory = step.initialMemory
        ? Array.from(step.initialMemory, Number)
        : null;
      candidates.push({
        id,
        order: stableDigest({ namespace: options.namespace || "run-c-v1", id }),
        state,
        actions,
        legalCount,
        memory,
        deckId: trajectory?.deckId || null,
        playerId: trajectory?.playerId || null,
        payloadDigest: stableDigest({ state, actions, legalCount, memory })
      });
    }
  }
  candidates.sort((left, right) => left.order.localeCompare(right.order)
    || left.id.localeCompare(right.id));
  const states = candidates.slice(0, maximumStates).map(({ order, ...item }) => item);
  const probe = {
    version: 1,
    contract: CONTINUATION_PROBE_CONTRACT,
    namespace: options.namespace || "run-c-v1",
    engineFingerprint: options.engineFingerprint || null,
    publicInformationOnly: true,
    states
  };
  return {
    ...probe,
    probeDigest: stableDigest({
      version: probe.version,
      contract: probe.contract,
      namespace: probe.namespace,
      engineFingerprint: probe.engineFingerprint,
      states: states.map((item) => ({
        id: item.id,
        payloadDigest: item.payloadDigest
      }))
    })
  };
}

export function validFixedContinuationBehaviorProbe(probe, options = {}) {
  return probe?.version === 1
    && probe?.contract === CONTINUATION_PROBE_CONTRACT
    && probe?.publicInformationOnly === true
    && Array.isArray(probe?.states)
    && probe.states.length >= 16
    && probe.states.every((item) => item?.payloadDigest === stableDigest({
      state: item.state,
      actions: item.actions,
      legalCount: item.legalCount,
      memory: item.memory
    }))
    && (!options.engineFingerprint
      || probe.engineFingerprint === options.engineFingerprint)
    && probe.probeDigest === stableDigest({
      version: probe.version,
      contract: probe.contract,
      namespace: probe.namespace,
      engineFingerprint: probe.engineFingerprint,
      states: probe.states.map((item) => ({
        id: item.id,
        payloadDigest: item.payloadDigest
      }))
    });
}

export function createContinuationStrengthCertificate(
  model,
  evaluation,
  options = {}
) {
  const leagueEvaluation = options.leagueEvaluation || evaluation;
  const artifactHash = neuralArtifactHash(model);
  const behaviorHash = neuralBehaviorHash(model);
  const deckSeats = candidateDeckSeatStats(evaluation?.summaries || []);
  const eligibleDeckSeats = Object.values(deckSeats).filter((item) =>
    item.completed >= Math.max(1, Number(options.minimumDeckSeatGames) || 4)
  );
  const expectedDeckSeatGroups = new Set((evaluation?.summaries || [])
    .flatMap((summary) => summary?.deckIds || [])
    .filter(Boolean)).size * 2;
  const deckSeatCoverageComplete = expectedDeckSeatGroups > 0
    && eligibleDeckSeats.length >= expectedDeckSeatGroups;
  const weakestDeckSeatWinRate = eligibleDeckSeats.length
    ? Math.min(...eligibleDeckSeats.map((item) => item.winRate))
    : 0;
  const games = Number(evaluation?.games)
    || Number(evaluation?.completed)
    || 0;
  const completed = Number(evaluation?.completed) || 0;
  const completionRate = games > 0 ? completed / games : 0;
  const winRateLowerBound = Number(evaluation?.wilsonLowerBound) || 0;
  const independentHoldout = options.independentHoldout === true;
  const evaluationMode = String(options.evaluationMode || "");
  const pairedSeeds = evaluationMode
    === PAIRED_CONTINUATION_STRENGTH_EVALUATION_MODE;
  const leagueHoldoutEligible = Number(leagueEvaluation?.invalidGames) === 0
    && Number(leagueEvaluation?.completed) >= 40
    && Number(leagueEvaluation?.wilsonLowerBound) >= 0.45
    && (Array.isArray(leagueEvaluation?.results)
      ? leagueEvaluation.results.every((item) =>
        Number(item?.completed) >= 20 && Number(item?.invalidGames) === 0
      )
      : true);
  const eligible = independentHoldout
    && pairedSeeds
    && leagueHoldoutEligible
    && games >= Math.max(40, Number(options.minimumGames) || 40)
    && completionRate >= Math.max(0.9,
      Number(options.minimumCompletionRate) || 0.9)
    && Number(evaluation?.invalidGames) === 0
    && deckSeatCoverageComplete
    && winRateLowerBound >= Math.max(0.5,
      Number(options.minimumWinRateLowerBound) || 0.5)
    && weakestDeckSeatWinRate >= Math.max(0.35,
      Number(options.minimumWeakestDeckSeatWinRate) || 0.35);
  return {
    version: 1,
    contract: CONTINUATION_STRENGTH_CONTRACT,
    engineFingerprint: options.engineFingerprint || null,
    artifactHash,
    behaviorHash,
    evaluationMode,
    independentHoldout,
    pairedSeeds,
    seedManifestDigest: options.seedManifestDigest || null,
    leagueHoldout: {
      eligible: leagueHoldoutEligible,
      opponents: Number(leagueEvaluation?.opponents) || 1,
      games: Number(leagueEvaluation?.games)
        || Number(leagueEvaluation?.completed)
        || 0,
      completed: Number(leagueEvaluation?.completed) || 0,
      invalidGames: Number(leagueEvaluation?.invalidGames) || 0,
      winRateLowerBound: Number(leagueEvaluation?.wilsonLowerBound) || 0,
      worstOpponentWilsonLowerBound: Number(
        leagueEvaluation?.worstOpponentWilsonLowerBound
          ?? leagueEvaluation?.wilsonLowerBound
      ) || 0
    },
    evaluationDigest: stableDigest({
      artifactHash,
      seedManifestDigest: options.seedManifestDigest || null,
      summaries: (evaluation?.summaries || []).map((summary) => ({
        candidateSeat: summary.candidateSeat,
        firstPlayerId: summary.firstPlayerId,
        gameSeed: summary.gameSeed,
        deckIds: summary.deckIds,
        completed: summary.completed,
        invalid: summary.invalid,
        winnerId: summary.winnerId
      }))
    }),
    games,
    completed,
    completionRate,
    invalidGames: Number(evaluation?.invalidGames) || 0,
    winRate: Number(evaluation?.winRate) || 0,
    winRateLowerBound,
    weakestDeckSeatWinRate,
    minimumDeckSeatGames: Math.max(1,
      Number(options.minimumDeckSeatGames) || 4),
    expectedDeckSeatGroups,
    eligibleDeckSeatGroups: eligibleDeckSeats.length,
    deckSeatCoverageComplete,
    deckSeats,
    strength: eligible ? Math.max(0, Math.min(1, winRateLowerBound)) : 0,
    eligible,
    issuedAt: options.issuedAt || new Date().toISOString()
  };
}

export function certifiedContinuationStrength(model, engineFingerprint) {
  const certificate = model?.metadata?.actionEvidenceStrengthCertificate;
  if (certificate?.version !== 1
    || certificate?.contract !== CONTINUATION_STRENGTH_CONTRACT
    || certificate?.engineFingerprint !== engineFingerprint
    || certificate?.artifactHash !== neuralArtifactHash(model)
    || certificate?.behaviorHash !== neuralBehaviorHash(model)
    || certificate?.eligible !== true
    || certificate?.independentHoldout !== true
    || certificate?.pairedSeeds !== true
    || certificate?.evaluationMode
      !== PAIRED_CONTINUATION_STRENGTH_EVALUATION_MODE
    || certificate?.leagueHoldout?.eligible !== true
    || certificate?.deckSeatCoverageComplete !== true
    || Number(certificate?.games) < 40
    || !(Number(certificate?.completionRate) >= 0.9)
    || !(Number(certificate?.winRateLowerBound) >= 0.5)
    || !(Number(certificate?.weakestDeckSeatWinRate) >= 0.35)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(certificate.strength) || 0));
}

export function createContinuationDiversityCertificates(
  models,
  probe,
  options = {}
) {
  if (!validFixedContinuationBehaviorProbe(probe, options)) {
    throw new Error("A valid fixed public continuation probe is required.");
  }
  const minimumDisagreementRate = Math.max(0,
    Number(options.minimumDisagreementRate) || 0.08);
  const minimumJsDivergence = Math.max(0,
    Number(options.minimumJsDivergence) || 0.005);
  const unique = [...new Map((models || []).filter(Boolean).map((model) => [
    neuralArtifactHash(model),
    model
  ])).values()];
  const predictions = new Map(unique.map((model) => [
    neuralArtifactHash(model),
    probePredictions(model, probe)
  ]));
  const certificates = [];
  for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
      const left = unique[leftIndex];
      const right = unique[rightIndex];
      const leftHash = neuralArtifactHash(left);
      const rightHash = neuralArtifactHash(right);
      const leftPredictions = predictions.get(leftHash);
      const rightPredictions = predictions.get(rightHash);
      let disagreements = 0;
      let jsTotal = 0;
      for (let index = 0; index < probe.states.length; index += 1) {
        const leftPrediction = leftPredictions[index];
        const rightPrediction = rightPredictions[index];
        if (leftPrediction.selectedIndex !== rightPrediction.selectedIndex) {
          disagreements += 1;
        }
        jsTotal += jensenShannon(
          leftPrediction.probabilities,
          rightPrediction.probabilities
        );
      }
      const disagreementRate = disagreements / probe.states.length;
      const meanJsDivergence = jsTotal / probe.states.length;
      const artifactHashes = [leftHash, rightHash].sort();
      const behaviorHashes = [
        neuralBehaviorHash(left),
        neuralBehaviorHash(right)
      ].sort();
      certificates.push({
        version: 1,
        contract: CONTINUATION_DIVERSITY_CONTRACT,
        engineFingerprint: options.engineFingerprint || probe.engineFingerprint,
        probeDigest: probe.probeDigest,
        probeStates: probe.states.length,
        artifactHashes,
        behaviorHashes,
        disagreementRate,
        meanJsDivergence,
        minimumDisagreementRate,
        minimumJsDivergence,
        behaviorallyIndependent:
          disagreementRate >= minimumDisagreementRate
          && meanJsDivergence >= minimumJsDivergence,
        issuedAt: options.issuedAt || new Date().toISOString()
      });
    }
  }
  return certificates;
}

export function selectCertifiedIndependentContinuationPool(
  models,
  options = {}
) {
  const strong = [...new Map((models || []).filter((model) =>
    certifiedContinuationStrength(model, options.engineFingerprint) > 0
  ).map((model) => [neuralArtifactHash(model), model])).values()]
    .sort((left, right) =>
      certifiedContinuationStrength(right, options.engineFingerprint)
        - certifiedContinuationStrength(left, options.engineFingerprint)
      || (Number(right?.generation) || 0) - (Number(left?.generation) || 0)
      || neuralArtifactHash(left).localeCompare(neuralArtifactHash(right)));
  const certificates = (models || []).flatMap((model) =>
    model?.metadata?.actionEvidenceDiversityCertificates || []
  );
  const maximumModels = Math.max(2, Number(options.maximumModels) || 3);
  let selected = strong.slice(0, 1);
  let probeDigest = null;
  outer: for (let size = Math.min(maximumModels, strong.length); size >= 2; size -= 1) {
    for (const combination of combinations(strong, size)) {
      const pairCertificates = [];
      for (let left = 0; left < combination.length; left += 1) {
        for (let right = left + 1; right < combination.length; right += 1) {
          pairCertificates.push(validPairCertificate(
            certificates,
            combination[left],
            combination[right],
            options
          ));
        }
      }
      if (pairCertificates.some((item) => !item)) continue;
      const digests = new Set(pairCertificates.map((item) => item.probeDigest));
      if (digests.size !== 1) continue;
      selected = combination;
      probeDigest = [...digests][0];
      break outer;
    }
  }
  return {
    models: selected,
    ready: selected.length >= Math.max(2, Number(options.minimumModels) || 2),
    probeDigest,
    strongCandidates: strong.length
  };
}

function combinations(items, size, offset = 0, prefix = []) {
  if (prefix.length === size) return [prefix];
  const result = [];
  for (let index = offset;
    index <= items.length - (size - prefix.length);
    index += 1) {
    result.push(...combinations(
      items,
      size,
      index + 1,
      [...prefix, items[index]]
    ));
  }
  return result;
}

function validPairCertificate(certificates, left, right, options) {
  const artifactHashes = [
    neuralArtifactHash(left),
    neuralArtifactHash(right)
  ].sort();
  const behaviorHashes = [
    neuralBehaviorHash(left),
    neuralBehaviorHash(right)
  ].sort();
  return certificates.find((certificate) =>
    certificate?.version === 1
      && certificate?.contract === CONTINUATION_DIVERSITY_CONTRACT
      && certificate?.engineFingerprint === options.engineFingerprint
      && certificate?.behaviorallyIndependent === true
      && typeof certificate?.probeDigest === "string"
      && certificate.probeDigest.length > 0
      && Number(certificate?.disagreementRate)
        >= Number(certificate?.minimumDisagreementRate)
      && Number(certificate?.meanJsDivergence)
        >= Number(certificate?.minimumJsDivergence)
      && JSON.stringify(certificate.artifactHashes) === JSON.stringify(artifactHashes)
      && JSON.stringify(certificate.behaviorHashes) === JSON.stringify(behaviorHashes)
  ) || null;
}

function probePredictions(model, probe) {
  return probe.states.map((item) => {
    const output = inferStep(
      model,
      item.state,
      item.actions,
      item.legalCount,
      item.memory
    );
    const probabilities = softmax(output.logits.slice(0, item.legalCount));
    return {
      selectedIndex: probabilities.indexOf(Math.max(...probabilities)),
      probabilities
    };
  });
}

function candidateDeckSeatStats(summaries) {
  const result = {};
  for (const summary of summaries || []) {
    const seat = Number(summary?.candidateSeat) === 1 ? 1 : 0;
    const deckId = summary?.deckIds?.[seat] || "unknown";
    const key = `${deckId}:p${seat + 1}`;
    const item = result[key] ||= {
      deckId,
      seat: `p${seat + 1}`,
      games: 0,
      completed: 0,
      wins: 0,
      winRate: 0
    };
    item.games += 1;
    if (!summary?.completed || summary?.invalid) continue;
    item.completed += 1;
    if (summary.winnerId === `p${seat + 1}`) item.wins += 1;
    item.winRate = item.completed ? item.wins / item.completed : 0;
  }
  return result;
}

function softmax(values) {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
}

function jensenShannon(left, right) {
  const midpoint = left.map((value, index) =>
    (value + (right[index] || 0)) / 2
  );
  return (kl(left, midpoint) + kl(right, midpoint)) / 2;
}

function kl(left, right) {
  return left.reduce((sum, value, index) => value > 0
    ? sum + value * Math.log(value / Math.max(1e-12, right[index] || 0))
    : sum, 0);
}

function stableDigest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      stableValue(value[key])
    ]));
  }
  return value;
}
