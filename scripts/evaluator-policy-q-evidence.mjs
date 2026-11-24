import { createHash } from "node:crypto";
import {
  validActionRankingReference, validIndependentLeafValueReference,
  validLeafActionEffectComparison
} from "../src/ai/neural/action-ranking-reference.mjs";
import { normalizeEvaluatorAuditStratum } from "../src/ai/neural/audit-strata.mjs";
import { pairedBinaryDifferenceInterval } from "../src/ai/neural/paired-action-effect-statistics.mjs";
import { POLICY_Q_SHADOW_READINESS_GRID } from "./evaluator-policy-q-readiness.mjs";
import { policyQPrecisionDemandItem } from "./evaluator-policy-q-precision.mjs";

export const POLICY_Q_EVIDENCE_COLLECTION_CONTRACT = "policy-q-mixed-fixed-precision-v1";

export function mixNaturalPolicyQFocuses(focuses, acceptedGames = 0) {
  const result = structuredClone(focuses);
  const counts = new Map();
  for (const focus of result) counts.set(focus?.phaseBand,
    (counts.get(focus?.phaseBand) || 0) + 1);
  const originalCounts = new Map(counts);
  let remaining = Math.floor(result.length / 2);
  while (remaining > 0) {
    let index = -1;
    let score = -1;
    for (let candidate = result.length - 1; candidate >= 0; candidate -= 1) {
      const focus = result[candidate];
      const count = counts.get(focus?.phaseBand);
      if (focus?.naturalDistribution || count <= 1) continue;
      const priority = count / originalCounts.get(focus?.phaseBand);
      if (priority > score) { score = priority; index = candidate; }
    }
    if (index < 0) break;
    const phase = result[index]?.phaseBand;
    result[index] = { naturalDistribution: true };
    counts.set(phase, counts.get(phase) - 1);
    remaining -= 1;
  }
  // Tiny waves alternate when no phase focus has a duplicate. Larger waves
  // retain each requested phase while reserving half the jobs for natural data.
  if (result.length > 0 && result.every((focus) => !focus?.naturalDistribution)
    && acceptedGames % 2 === 0) result[result.length - 1] = { naturalDistribution: true };
  // Long queues must provide both distributions to the first worker wave.
  // Keep each subgroup's order, but do not leave all natural jobs at the tail.
  const natural = result.filter((focus) => focus?.naturalDistribution);
  const targeted = result.filter((focus) => !focus?.naturalDistribution);
  const interleaved = [];
  for (let index = 0; index < Math.max(natural.length, targeted.length); index += 1) {
    if (index < targeted.length) interleaved.push(targeted[index]);
    if (index < natural.length) interleaved.push(natural[index]);
  }
  return interleaved;
}

export function policyQLeafAuditPrecision(datasetKey, taskIndex, base = 128) {
  const baseline = Math.max(0, Math.min(1024, Math.floor(Number(base) || 0)));
  if (baseline === 0) return 0;
  // Assignment precedes the game and the final seed bank. Spending more on
  // one quarter of jobs cannot depend on favorable final audit outcomes.
  const hash = createHash("sha256")
    .update(`${POLICY_Q_EVIDENCE_COLLECTION_CONTRACT}:${datasetKey}:${taskIndex}`)
    .digest();
  return hash[0] % 4 === 0 ? 1024 : baseline;
}

const phases = ["mulligan", "early", "mid", "late"];
const bucket = () => ({ comparisons: 0, games: new Set(), decisive: 0, knownZero: 0,
  decisiveGames: new Set(), riskAssessed: 0, riskAssessedGames: new Set(),
  gameWeights: new Map(), decisiveGameWeights: new Map(), informationSets: new Set() });

function addEvidenceWeight(target, gameId, weight, informationSet, decisive = false) {
  target.gameWeights.set(gameId, (target.gameWeights.get(gameId) || 0) + weight);
  if (decisive) target.decisiveGameWeights.set(gameId,
    (target.decisiveGameWeights.get(gameId) || 0) + 1);
  if (informationSet) target.informationSets.add(informationSet);
}

function effectiveEvidenceGames(weights) {
  const values = [...weights.values()];
  const sum = values.reduce((a, b) => a + b, 0);
  return sum > 0 ? sum ** 2 / values.reduce((a, b) => a + b ** 2, 0) : 0;
}

export async function collectPolicyQEvidenceInventory(batches) {
  const { validLeafAuditSamplingFrame } = await import(
    "../src/ai/neural/action-ranking-reference.mjs"
  );
  const groups = Object.fromEntries(["overall", ...phases].map((phase) => [
    phase, { targeted: bucket(), natural: bucket() }
  ]));
  const seen = new Set();
  const validationGames = new Set();
  for await (const trajectories of batches) {
    for (const trajectory of trajectories || []) {
      // Unknown game identity cannot establish independent evidence.
      if (!trajectory.gameId) continue;
      validationGames.add(trajectory.gameId);
      const seat = trajectory.playerId || trajectory.seat
        || (Number(trajectory.playerSeat) === 0 ? "p1" : Number(trajectory.playerSeat) === 1 ? "p2" : null);
      const deckSeat = trajectory.deckId && ["p1", "p2"].includes(seat)
        ? `${trajectory.deckId}:${seat}` : null;
      const groupKeys = phase => {
        const keys = ["overall", ...(phases.includes(phase) ? [phase] : [])];
        if (deckSeat && phases.includes(phase)) {
          const key = `${deckSeat}::${phase}`;
          groups[key] ||= { targeted: bucket(), natural: bucket() };
          keys.push(key);
        }
        return keys;
      };
      for (const step of trajectory.steps || []) {
        const countedNaturalFrames = new Set();
        const references = [
          validIndependentLeafValueReference(step.leafValueAuditReference)
            ? step.leafValueAuditReference : null,
          validActionRankingReference(step.actionRankingReference, {
            informationSetHash: step.informationSetHash, legalActionKeys: step.legalActionKeys
          }) ? step.actionRankingReference.leafValueReference : null
        ];
        for (const reference of references.filter(Boolean)) {
          const comparison = reference.actionEffectComparison;
          if (!validLeafActionEffectComparison(comparison)) continue;
          const frame = comparison.samplingFrame;
          // Legacy unframed data remains useful for training, but proves no
          // natural/targeted sampling coverage for the Shadow audit.
          if (!frame || frame.certificationRole !== "training") continue;
          const identity = JSON.stringify([trajectory.gameId,
            comparison.provenance.informationSetHash,
            comparison.recommendedActionKey, comparison.comparedActionKey]);
          if (seen.has(identity)) continue;
          const phase = normalizeEvaluatorAuditStratum({
            stored: reference.auditStratum, state: step.state,
            recommendedAction: comparison.recommendedActionKey,
            selectedAction: comparison.comparedActionKey,
            legalActions: step.legalActionKeys, deckId: trajectory.deckId,
            seat: trajectory.seat || trajectory.playerId
          }).phaseBand;
          if (frame.version === 3 && frame.selectedPhaseBand !== phase) continue;
          const distribution = frame.distribution === "natural-distribution"
            ? "natural" : "targeted";
          if (distribution === "natural" && ![
            "hash-priority-reservoir-policy-decision-v1",
            "hash-priority-mixture-reservoir-policy-decision-v1"
          ].includes(frame.candidateSelection)) continue;
          seen.add(identity);
          if (distribution === "natural") {
            countedNaturalFrames.add(frame.taskManifestHash);
            seen.add(JSON.stringify([trajectory.gameId, "natural-observation", frame.taskManifestHash]));
          }
          const interval = pairedBinaryDifferenceInterval(
            comparison.pairedAudit.outcomePairs, comparison.pairedAudit.confidence);
          const threshold = Number(comparison.decisiveEffectThreshold) || 0.01;
          const decisive = interval.lowerBound > threshold || interval.upperBound < -threshold;
          for (const key of groupKeys(phase)) {
            const target = groups[key][distribution];
            target.comparisons += 1;
            target.games.add(trajectory.gameId);
            target.riskAssessed += 1;
            target.riskAssessedGames.add(trajectory.gameId);
            addEvidenceWeight(target, trajectory.gameId,
              distribution === "natural" ? 1 / frame.selectionProbability : 1,
              comparison.provenance.informationSetHash, decisive);
            if (decisive) {
              target.decisive += 1;
              target.decisiveGames.add(trajectory.gameId);
            }
          }
        }
        const observation = step.naturalLeafAuditSamplingObservation;
        const frame = observation?.samplingFrame;
        if (!observation || ![1, 2, 3].includes(observation.version)
          || observation.contract !== `natural-leaf-audit-sampling-observation-v${observation.version}`
          || !["audited", "identical-action-zero-regret", "audit-unavailable"].includes(observation.status)
          || !frame || !validLeafAuditSamplingFrame(frame)
          || frame.certificationRole !== "training" || frame.distribution !== "natural-distribution"
          || !["hash-priority-reservoir-policy-decision-v1",
            "hash-priority-mixture-reservoir-policy-decision-v1"].includes(frame.candidateSelection)
          || countedNaturalFrames.has(frame.taskManifestHash)) continue;
        const phase = normalizeEvaluatorAuditStratum({ state: step.state,
          selectedAction: step.selectedActionKey, legalActions: step.legalActionKeys,
          deckId: trajectory.deckId, seat: trajectory.playerId ?? trajectory.playerSeat }).phaseBand;
        if (frame.version === 3 && frame.selectedPhaseBand !== phase) continue;
        const identity = JSON.stringify([trajectory.gameId, "natural-observation", frame.taskManifestHash]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        for (const key of groupKeys(phase)) {
          const target = groups[key].natural;
          target.comparisons += 1;
          target.games.add(trajectory.gameId);
          addEvidenceWeight(target, trajectory.gameId, 1 / frame.selectionProbability,
            step.informationSetHash);
          if (observation.status === "identical-action-zero-regret"
            || (step.legalCount === 1 && step.originalLegalCount === 1
              && step.selectedIndex === 0 && step.legalActionKeys?.length === 1
              && step.selectedActionKey === step.legalActionKeys[0])) {
            target.riskAssessed += 1;
            target.riskAssessedGames.add(trajectory.gameId);
            target.knownZero += 1;
          }
        }
      }
    }
  }
  const result = Object.fromEntries(Object.entries(groups).map(([phase, values]) => [phase,
    Object.fromEntries(Object.entries(values).map(([distribution, value]) => [distribution, {
      comparisons: value.comparisons, contributingGames: value.games.size,
      decisiveComparisons: value.decisive, decisiveContributingGames: value.decisiveGames.size,
      riskAssessedComparisons: value.riskAssessed,
      knownZeroComparisons: value.knownZero,
      riskAssessedContributingGames: value.riskAssessedGames.size,
      riskAssessmentCoverage: value.comparisons ? value.riskAssessed / value.comparisons : 0,
      effectiveGames: effectiveEvidenceGames(value.gameWeights),
      decisiveEffectiveGames: effectiveEvidenceGames(value.decisiveGameWeights),
      uniqueInformationSets: value.informationSets.size
    }]))
  ]));
  result.collection = { validationGames: validationGames.size, splitUnit: "game",
    effectiveGameWeighting: "inverse-propensity-game-clusters" };
  return result;
}

export function policyQShadowEvidencePreflight(inventory, grid = POLICY_Q_SHADOW_READINESS_GRID, options = {}) {
  const items = [];
  const precisionTargets = [];
  const priorItems = options.demand?.items || [];
  const priorTargets = [...(options.demand?.precisionTargets || []), ...priorItems];
  const deckPhases = [...new Set(priorTargets.filter(item => item.deckSeat && phases.includes(item.phaseBand))
    .map(item => `${item.deckSeat}::${item.phaseBand}`))];
  for (const group of ["overall", ...phases, ...deckPhases]) {
    const phase = group.includes("::") ? group.split("::")[1] : group;
    const deckSeat = group.includes("::") ? group.split("::")[0] : null;
    for (const distribution of ["targeted", "natural"]) {
      const actual = inventory[group]?.[distribution] || {};
      const required = phase === "overall" ? {
        ...grid.performanceRequirements.regretAlternative,
        minimumDecisiveComparisons: 1, minimumDecisiveGames: 1
      }
        : grid.performanceRequirements.phaseActionEffect[distribution];
      const deficits = {
        comparisons: Math.max(0, required.minimumComparisons - (actual.comparisons || 0)),
        games: Math.max(0, required.minimumContributingGames - (actual.contributingGames || 0)),
        decisiveComparisons: distribution === "targeted"
          ? Math.max(0, (required.minimumDecisiveComparisons || 0) - (actual.decisiveComparisons || 0)) : 0,
        decisiveGames: distribution === "targeted"
          ? Math.max(0, (required.minimumDecisiveContributingGames || required.minimumDecisiveGames || 0)
            - (actual.decisiveContributingGames || 0)) : 0
      };
      if (distribution === "natural") {
        const assessed = actual.riskAssessedComparisons || 0;
        const coverage = required.minimumRiskAssessmentCoverage || 0;
        deficits.riskAssessedComparisons = Math.max(0,
          (required.minimumRiskAssessedComparisons || 0) - assessed);
        deficits.riskAssessedGames = Math.max(0,
          (required.minimumRiskAssessedGames || 0) - (actual.riskAssessedContributingGames || 0));
        deficits.riskCoverageComparisons = Math.max(0, Math.ceil(
          (coverage * (actual.comparisons || 0) - assessed) / (1 - coverage)
        ));
      }
      const prior = priorTargets.filter(item => (item.deficientPhaseBand || item.phaseBand || "overall") === phase
        && (item.deckSeat || null) === deckSeat
        && item.auditDistribution === (distribution === "natural" ? "natural-distribution" : "targeted-decisive"));
      const planned = policyQPrecisionDemandItem({
        evidenceKind: "action-effect",
        auditDistribution: distribution === "natural" ? "natural-distribution" : "targeted-decisive",
        phaseBand: phase === "overall" ? null : phase, deficientPhaseBand: phase, deckSeat,
        targetValidationGames: Math.max(0, ...prior.map(item => Number(item.targetValidationGames) || 0)),
        targetEffectiveGames: Math.max(0, ...prior.map(item => Number(item.targetEffectiveGames) || 0)),
        additionalValidationGames: Math.max(...Object.values(deficits))
      }, grid, actual, inventory.collection?.validationGames || 0);
      precisionTargets.push({ phaseBand: planned.phaseBand, deficientPhaseBand: phase, deckSeat,
        auditDistribution: planned.auditDistribution, targetValidationGames: planned.targetValidationGames,
        targetEffectiveGames: planned.targetEffectiveGames });
      deficits.precisionValidationGames = planned.additionalValidationGames;
      const missing = Math.max(...Object.values(deficits));
      if (missing === 0) continue;
      items.push({
        ...planned,
        // The precommitted mixture retains positive probability for the full
        // decision population; demand never cherry-picks final outcomes.
        phaseBand: phase !== "overall" ? phase : null,
        deficientPhaseBand: phase, deficits,
        reason: "policy-q-shadow-evidence-precision-insufficient"
      });
    }
  }
  return {
    contract: "policy-q-shadow-evidence-preflight-v3", sufficient: items.length === 0,
    assessment: "sample-support-only-not-performance", sufficientForPerformance: false,
    inventory, modelTrainingStarted: false, performanceAssessed: false,
    diagnosticDemand: {
      version: 1, contract: "policy-q-shadow-targeted-training-demand-v1", role: "training",
      priority: "warning-only", officialEvidenceRuleChanged: false, items, precisionTargets
    }
  };
}
