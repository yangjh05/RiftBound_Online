import { cards } from "../cards.mjs";
import { actionKey, activeActorId, applyAiAction, cloneGame, enumerateAiPolicyActions } from "./actions.mjs";
import { inferOpponentDeckBelief } from "./belief.mjs";
import { choosePolicyAction, evaluateState } from "./policy.mjs";
import {
  createNeuralSession,
  estimateEncodedNeuralValue,
  estimateEvidenceNeuralValue,
  estimateNeuralValue
} from "./neural/model.mjs";
import { EVALUATOR_TARGET_HEADS } from "./neural/evaluator-architecture.mjs";
import { CARD_INDEX, encodeActionSet, encodeOpponentDeckTarget, encodeState } from "./neural/encoding.mjs";
import { calibratedProbability } from "./neural/trainer.mjs";
import { hiddenCardControllerId, hiddenCardIsControlledBy } from "../rules/zones.mjs";
import { resolvePlannedPayment } from "./payment-planner.mjs";
import { opponentResponseProfile, strategicResourceCommitment } from "./resource-strategy.mjs";
import { mulliganPlanProfile } from "./mulligan.mjs";
import { randomizeUnknownOwnDeck } from "./deck-memory.mjs";
import { tacticalActionPrior } from "./action-tactics.mjs";
import { addAiPerformance, measureAiPerformance } from "./performance.mjs";
import { certifiedIndependentEvaluators } from "./neural/evaluator-certification.mjs";
import {
  pairedBinaryDifferenceInterval,
  PAIRED_ACTION_EFFECT_ASSESSMENT_VERSION
} from "./neural/paired-action-effect-statistics.mjs";
import {
  createPublicStructuredEvidenceSnapshot,
  createPublicStructuredEvidenceTransition
} from "./neural/structured-evidence.mjs";

const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
const ROLLOUT_OUTCOMES = Symbol("rollout-outcomes");
const ROLLOUT_SAMPLES = Symbol("rollout-samples");
const DETERMINIZATION_STATUS = Symbol("determinization-status");

export function rolloutAlternatives(game, viewerId, actions, model, options = {}) {
  const explicitSimulationSeeds = Array.isArray(options.explicitSimulationSeeds)
    || ArrayBuffer.isView(options.explicitSimulationSeeds)
    ? [...new Set(Array.from(
      options.explicitSimulationSeeds,
      (seed) => Number(seed) >>> 0
    ))]
    : null;
  const simulations = explicitSimulationSeeds?.length
    || Math.max(1, options.simulations || 16);
  addAiPerformance("rolloutCalls");
  addAiPerformance("rolloutCandidates", actions.length);
  return measureAiPerformance("rolloutMs", () =>
    rolloutAlternativesMeasured(
      game,
      viewerId,
      actions,
      model,
      options,
      simulations,
      explicitSimulationSeeds
    ));
}

function rolloutAlternativesMeasured(
  game,
  viewerId,
  actions,
  model,
  options,
  simulations,
  explicitSimulationSeeds = null
) {
  const depth = Math.max(1, options.depth || 48);
  const random = options.random || Math.random;
  const viewerNeuralModel = options.neuralModels?.[viewerId] || options.neuralModel || null;
  const beliefModel = viewerNeuralModel?.knowledge || model;
  const belief = blendNeuralDeckBelief(
    inferOpponentDeckBelief(game, viewerId, beliefModel),
    options.neuralBelief
  );
  const response = opponentResponseProfile(game, viewerId, beliefModel);
  const evaluatorCertification = options.evaluatorModelsCertified === true
    ? { accepted: [...new Set(options.evaluatorModels || [])], rejected: [] }
    : certifiedIndependentEvaluators(
      options.evaluatorModels || [],
      viewerNeuralModel,
      {
        requiredPermission: "leafEvaluation",
        engineFingerprint: options.engineFingerprint
          || viewerNeuralModel?.metadata?.engineFingerprint
          || null
      }
    );
  const actionQTargetHead = game.phase === "mulligan"
    ? EVALUATOR_TARGET_HEADS.mulliganQ
    : EVALUATOR_TARGET_HEADS.generalActionQ;
  // Certificate hashing is intentionally done once per alternatives call,
  // never once per candidate/seed rollout sample.
  const actionQCertification = certifiedIndependentEvaluators(
    evaluatorCertification.accepted,
    viewerNeuralModel,
    {
      requiredPermission: "proposalRanking",
      requiredTargetHead: actionQTargetHead,
      engineFingerprint: options.engineFingerprint
        || viewerNeuralModel?.metadata?.engineFingerprint
        || null
    }
  );
  const policyCorrectionActionQEvaluatorModels =
    actionQCertification.accepted.filter((candidate) =>
      candidate?.metadata?.evaluatorCertificate?.permissions
        ?.policyCorrection === true
    );
  const priorByKey = new Map((options.priorResults || []).map((result) => [actionKey(result.action), result]));
  // Common random numbers make alternatives comparable: simulation N uses the
  // same hidden-information and continuation seed for every candidate.
  const simulationSeeds = explicitSimulationSeeds || independentSimulationSeeds(
    simulations,
    random,
    options.excludedSimulationSeeds
  );
  let simulationsExecuted = 0;
  const sharedSamples = options.reusePairedDeterminization === true
    && explicitSimulationSeeds
    && actions.length > 1
    && priorByKey.size === 0
    ? sharedDeterminizationSamples(
      game,
      viewerId,
      actions,
      model,
      {
        ...options,
        depth,
        belief,
        viewerNeuralModel,
        evaluatorModels: evaluatorCertification.accepted,
        actionQEvaluatorModels: actionQCertification.accepted,
        policyCorrectionActionQEvaluatorModels,
        actionQTargetHead
      },
      simulationSeeds
    )
    : null;
  const results = actions.map((action) => {
    const prior = priorByKey.get(actionKey(action));
    const samples = sharedSamples
      ? sharedSamples.get(actionKey(action)) || []
      : [...(prior?.[ROLLOUT_SAMPLES] || [])].slice(0, simulations);
    const reusedSimulations = sharedSamples ? 0 : samples.length;
    if (sharedSamples) {
      simulationsExecuted += samples.length;
    } else for (let simulation = samples.length; simulation < simulations; simulation += 1) {
      simulationsExecuted += 1;
      const simulationSeed = simulationSeeds[simulation];
      const simulationRandom = seededRandom(simulationSeed);
      const determinized = determinizeGame(
        game,
        viewerId,
        belief,
        simulationRandom
      );
      const determinization = determinizationStatus(determinized);
      if (!determinization.complete) {
        samples.push(invalidRolloutSample(
          determinization.reason || "incomplete-determinization",
          simulationSeed,
          "determinization"
        ));
        continue;
      }
      samples.push(rolloutSampleFromDeterminized(
        game,
        determinized,
        viewerId,
        action,
        model,
        {
          ...options,
          depth,
          viewerNeuralModel,
          evaluatorModels: evaluatorCertification.accepted,
          actionQEvaluatorModels: actionQCertification.accepted,
          policyCorrectionActionQEvaluatorModels,
          actionQTargetHead
        },
        simulationRandom,
        simulationSeed
      ));
    }
    const result = summarizeRolloutResult(game, viewerId, action, samples, belief, response, options);
    result.reusedSimulations = reusedSimulations;
    result.additionalSimulations = Math.max(0, samples.length - reusedSimulations);
    return result;
  });
  addAiPerformance("rolloutSimulations", simulationsExecuted);
  const hold = results.find((item) => ["endTurn", "passShowdown", "declineEffectChoice"].includes(item.action?.kind)) || null;
  const holdOutcomes = hold?.[ROLLOUT_OUTCOMES];
  for (const result of results) {
    const pairedGains = holdOutcomes
      ? result[ROLLOUT_OUTCOMES].flatMap((value, index) =>
        Number.isFinite(value) && Number.isFinite(holdOutcomes[index])
          ? [value - holdOutcomes[index]]
          : [])
      : [];
    result.pairedGainOverHold = holdOutcomes ? average(pairedGains) : null;
  }
  return results;
}

function sharedDeterminizationSamples(
  game,
  viewerId,
  actions,
  model,
  options,
  simulationSeeds
) {
  const samplesByAction = new Map(
    actions.map((action) => [actionKey(action), []])
  );
  for (const simulationSeed of simulationSeeds) {
    const determinizationRandom = seededRandom(simulationSeed);
    const determinized = determinizeGame(
      game,
      viewerId,
      options.belief,
      determinizationRandom
    );
    const determinization = determinizationStatus(determinized);
    if (!determinization.complete) {
      for (const action of actions) {
        samplesByAction.get(actionKey(action)).push(invalidRolloutSample(
          determinization.reason || "incomplete-determinization",
          simulationSeed,
          "determinization"
        ));
      }
      continue;
    }
    const continuationRandomState = determinizationRandom.getState();
    for (const action of actions) {
      const branch = cloneGame(determinized);
      const branchRandom = seededRandom(simulationSeed);
      branchRandom.setState(continuationRandomState);
      samplesByAction.get(actionKey(action)).push(
        rolloutSampleFromDeterminized(
          game,
          branch,
          viewerId,
          action,
          model,
          options,
          branchRandom,
          simulationSeed
        )
      );
    }
  }
  return samplesByAction;
}

function rolloutSampleFromDeterminized(
  originalGame,
  determinized,
  viewerId,
  action,
  model,
  options,
  simulationRandom,
  simulationSeed
) {
  const viewerNeuralModel = options.viewerNeuralModel || null;
  const actionQTargetHead = options.actionQTargetHead
    || (originalGame.phase === "mulligan"
      ? EVALUATOR_TARGET_HEADS.mulliganQ
      : EVALUATOR_TARGET_HEADS.generalActionQ);
  const actionQEvaluatorModels = options.actionQEvaluatorModels || [];
  // The production teacher must evaluate the same post-action Q head that is
  // certified. Production-leaf capture is an evidence-storage concern, not a
  // prerequisite for using a certified proposal-ranking evaluator at runtime.
  const captureActionAuditEvaluatorState =
    options.captureActionAuditEvaluatorState !== false
    && (options.captureProductionLeafAudit === true
      || actionQEvaluatorModels.length > 0);
  const preActionAuditGame = captureActionAuditEvaluatorState
    ? cloneGame(determinized)
    : null;
  if (!applyAiAction(determinized, action, viewerId)?.ok) {
    return invalidRolloutSample(
      "action-application-failed",
      simulationSeed
    );
  }
  const payment = determinized.pendingPayment
    ? resolvePlannedPayment(
      determinized,
      paymentOptions(model, viewerNeuralModel)
    )
    : null;
  if (payment && !payment.ok) {
    return invalidRolloutSample(
      "payment-resolution-failed",
      simulationSeed
    );
  }
  const initialChoice = Boolean(determinized.pendingChoice);
  const immediateTerminal = determinized.phase === "complete";
  const immediateTerminalWin =
    immediateTerminal && determinized.winnerId === viewerId;
  const commitment = strategicResourceCommitment(
    originalGame,
    determinized,
    viewerId
  );
  const immediateWinRate = evaluateWinRate(
    determinized,
    viewerId,
    model,
    viewerNeuralModel
  );
  const postActionAuditState = captureActionAuditEvaluatorState
    ? {
      state: Float32Array.from(encodeState(determinized, viewerId)),
      structuredState: createPublicStructuredEvidenceTransition(
        preActionAuditGame,
        determinized,
        viewerId,
        {
          action,
          engineFingerprint: options.engineFingerprint,
          informationSetHash: options.informationSetHash
        }
      ),
      heuristicValue: immediateTerminal
        ? immediateTerminalWin ? 1 : 0
        : (evaluateState(determinized, viewerId, model) + 1) / 2,
      terminal: immediateTerminal
    }
    : null;
  const continuation = simulateContinuation(
    determinized,
    viewerId,
    model,
    {
      depth: options.depth,
      minimumTurnTransitions: options.minimumTurnTransitions || 0,
      neuralModel: viewerNeuralModel,
      neuralModels: options.neuralModels,
      evaluatorModels: options.evaluatorModels || [],
      evaluatorModelsCertified: true,
      engineFingerprint: options.engineFingerprint || null,
      initialMemories: options.initialMemories,
      captureInitialMacro: initialChoice,
      captureProductionLeafAudit:
        options.captureProductionLeafAudit === true,
      captureProductionLeafAuditState: captureActionAuditEvaluatorState,
      productionLeafAuditSeed: simulationSeed,
      productionLeafAuditMaximumSteps:
        options.productionLeafAuditMaximumSteps,
      informationSetHash: options.informationSetHash || null
    },
    simulationRandom
  );
  const independentActionQValues = postActionAuditState
    ? actionQEvaluatorModels.map((evaluatorModel) => {
      const rawValue = postActionAuditState.structuredState
        ? estimateEvidenceNeuralValue(
          evaluatorModel,
          postActionAuditState.state,
          postActionAuditState.structuredState,
          {
            engineFingerprint: options.engineFingerprint,
            informationSetHash: options.informationSetHash,
            targetHead: actionQTargetHead
          }
        )
        : estimateEncodedNeuralValue(
          evaluatorModel,
          postActionAuditState.state,
          { targetHead: actionQTargetHead }
        );
      return Math.max(0, Math.min(1, (Number(rawValue) + 1) / 2));
    })
    : [];
  const independentPolicyCorrectionActionQValues =
    independentActionQValues.filter((_, index) =>
      (options.policyCorrectionActionQEvaluatorModels || []).includes(
        actionQEvaluatorModels[index]
      )
    );
  return {
    simulationSeed: Number(simulationSeed) >>> 0,
    value: continuation.value,
    heuristicValue: continuation.heuristicValue,
    immediateWinRate,
    immediateTerminal,
    immediateTerminalWin,
    commitment,
    opponentResponded: continuation.opponentResponses > 0,
    initialChoice,
    macroResolved: continuation.macroResolved,
    macroActionKeys: continuation.macroActionKeys,
    evaluatorValues: continuation.evaluatorValues,
    independentEvaluatorValues: continuation.independentEvaluatorValues,
    independentActionQValues,
    independentPolicyCorrectionActionQValues,
    independentActionQTargetHead: actionQTargetHead,
    terminal: continuation.terminal,
    terminalOutcome: continuation.terminalOutcome,
    // Runtime Q routing needs the transition only during this call. Persist it
    // solely for an explicit production audit so ordinary teacher searches do
    // not retain large encoded states in every rollout sample.
    postActionAuditState: options.captureProductionLeafAudit === true
      ? postActionAuditState
      : null,
    productionLeafAudit: continuation.productionLeafAudit,
    continuationSteps: continuation.steps,
    saturated: !continuation.terminal
      && (continuation.value <= 0.02 || continuation.value >= 0.98)
  };
}

export function serializeActionAuditRolloutResults(results = []) {
  return (results || []).map((result) => ({
    version: 1,
    action: structuredClone(result.action),
    simulationSeeds: Array.from(
      result.simulationSeeds || [],
      (seed) => Number(seed) >>> 0
    ),
    determinizationAudit:
      structuredClone(result.determinizationAudit || null),
    samples: structuredClone(result[ROLLOUT_SAMPLES] || [])
  }));
}

export function hydrateActionAuditRolloutResults(serialized = []) {
  return (serialized || []).map((entry) => {
    const samples = structuredClone(entry?.samples || [])
      .sort((left, right) =>
        (Number(left?.simulationSeed) >>> 0)
          - (Number(right?.simulationSeed) >>> 0));
    const result = {
      action: structuredClone(entry?.action),
      simulationSeeds: samples.map(
        (sample) => Number(sample?.simulationSeed) >>> 0
      ),
      determinizationAudit: mergedDeterminizationAudit(samples)
    };
    Object.defineProperty(result, ROLLOUT_SAMPLES, {
      value: samples,
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(result, ROLLOUT_OUTCOMES, {
      value: samples.map((sample) =>
        sample?.invalid === true || !Number.isFinite(Number(sample?.value))
          ? null
          : Number(sample.value)),
      enumerable: false,
      configurable: true
    });
    return result;
  });
}

export function mergeActionAuditRolloutResults(...collections) {
  const byAction = new Map();
  for (const collection of collections.flat()) {
    if (!collection?.action) continue;
    const key = actionKey(collection.action);
    const target = byAction.get(key) || {
      version: 1,
      action: structuredClone(collection.action),
      samplesBySeed: new Map()
    };
    for (const sample of collection.samples || []) {
      target.samplesBySeed.set(
        Number(sample?.simulationSeed) >>> 0,
        structuredClone(sample)
      );
    }
    byAction.set(key, target);
  }
  return [...byAction.values()]
    .sort((left, right) =>
      actionKey(left.action).localeCompare(actionKey(right.action)))
    .map((entry) => {
      const samples = [...entry.samplesBySeed.values()]
        .sort((left, right) =>
          (Number(left?.simulationSeed) >>> 0)
            - (Number(right?.simulationSeed) >>> 0));
      return {
        version: 1,
        action: entry.action,
        simulationSeeds: samples.map(
          (sample) => Number(sample?.simulationSeed) >>> 0
        ),
        determinizationAudit: mergedDeterminizationAudit(samples),
        samples
      };
    });
}

function mergedDeterminizationAudit(samples = []) {
  const invalidReasons = {};
  let failures = 0;
  for (const sample of samples) {
    if (sample?.invalid !== true
      || sample?.invalidCategory !== "determinization") continue;
    failures += 1;
    const reason = sample.invalidReason || "incomplete-determinization";
    invalidReasons[reason] = (invalidReasons[reason] || 0) + 1;
  }
  return {
    version: 1,
    attempted: samples.length,
    failures,
    complete: samples.length > 0 && failures === 0,
    invalidReasons
  };
}

function summarizeRolloutResult(game, viewerId, action, samples, belief, response, options = {}) {
    const validSamples = samples.filter((sample) => sample?.invalid !== true
      && Number.isFinite(Number(sample?.value)));
    const outcomes = validSamples.map((sample) => Number(sample.value));
    const pairedOutcomes = samples.map((sample) =>
      sample?.invalid === true || !Number.isFinite(Number(sample?.value)) ? null : Number(sample.value));
    const heuristicLeafWinRates = validSamples.map((sample) => sample.heuristicValue);
    const commitments = validSamples.map((sample) => sample.commitment).filter(Boolean);
    const ensembleLeafWinRates = validSamples.map((sample) =>
      average((sample.evaluatorValues || []).filter(Number.isFinite)));
    const evaluatorSpreads = validSamples.map((sample) => {
      const values = (sample.evaluatorValues || []).filter(Number.isFinite);
      return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    });
    const independentEvaluatorLeafWinRates = validSamples.flatMap((sample) => {
      const values = (sample.independentEvaluatorValues || []).filter(Number.isFinite);
      return values.length ? [average(values)] : [];
    });
    const independentEvaluatorCount = Math.max(
      0,
      ...validSamples.map((sample) =>
        (sample.independentEvaluatorValues || []).length)
    );
    const independentEvaluatorLeafWinRatesByModel = Array.from(
      { length: independentEvaluatorCount },
      (_, evaluatorIndex) => {
        const values = validSamples
          .map((sample) => Number(sample.independentEvaluatorValues?.[evaluatorIndex]))
          .filter(Number.isFinite);
        return values.length ? average(values) : null;
      }
    );
    const independentEvaluatorActionQWinRates = validSamples.flatMap((sample) => {
      const values = (sample.independentActionQValues || []).filter(Number.isFinite);
      return values.length ? [average(values)] : [];
    });
    const independentEvaluatorActionQTargetHeads = [...new Set(
      validSamples
        .filter((sample) => (sample.independentActionQValues || []).length > 0)
        .map((sample) => String(sample.independentActionQTargetHead || ""))
        .filter(Boolean)
    )];
    const independentActionQCount = Math.max(
      0,
      ...validSamples.map((sample) =>
        (sample.independentActionQValues || []).length)
    );
    const independentEvaluatorActionQWinRatesByModel = Array.from(
      { length: independentActionQCount },
      (_, evaluatorIndex) => {
        const values = validSamples
          .map((sample) => Number(sample.independentActionQValues?.[evaluatorIndex]))
          .filter(Number.isFinite);
        return values.length ? average(values) : null;
      }
    );
    const independentEvaluatorPolicyCorrectionActionQWinRates =
      validSamples.flatMap((sample) => {
        const values = (sample.independentPolicyCorrectionActionQValues || [])
          .filter(Number.isFinite);
        return values.length ? [average(values)] : [];
      });
    const independentPolicyCorrectionActionQCount = Math.max(
      0,
      ...validSamples.map((sample) =>
        (sample.independentPolicyCorrectionActionQValues || []).length)
    );
    const independentEvaluatorPolicyCorrectionActionQWinRatesByModel =
      Array.from(
        { length: independentPolicyCorrectionActionQCount },
        (_, evaluatorIndex) => {
          const values = validSamples.map((sample) => Number(
            sample.independentPolicyCorrectionActionQValues?.[evaluatorIndex]
          )).filter(Number.isFinite);
          return values.length ? average(values) : null;
        }
      );
    const invalidReasons = {};
    const determinizationInvalidReasons = {};
    let determinizationFailures = 0;
    for (const sample of samples) {
      if (sample?.invalid !== true) continue;
      const reason = sample.invalidReason || "unknown";
      invalidReasons[reason] = (invalidReasons[reason] || 0) + 1;
      if (sample.invalidCategory === "determinization") {
        determinizationFailures += 1;
        determinizationInvalidReasons[reason] =
          (determinizationInvalidReasons[reason] || 0) + 1;
      }
    }
    const validRate = validSamples.length / Math.max(1, samples.length);
    const minimumValidRate = Math.max(0.5, Math.min(1, Number(options.minimumValidRate) || 0.75));
    const minimumValidSamples = Math.max(1, Math.min(
      samples.length,
      Number(options.minimumValidSamples) || Math.min(4, samples.length)
    ));
    const rolloutEvidenceEligible = validRate >= minimumValidRate
      && validSamples.length >= minimumValidSamples;
    const mean = outcomes.length ? average(outcomes) : 0.5;
    const variance = average(outcomes.map((value) => (value - mean) ** 2));
    const halfWidth = 1.96 * Math.sqrt(variance / Math.max(1, outcomes.length));
    const downsideWinRate = quantile(outcomes, 0.25);
    const mulliganPlan = mulliganPlanProfile(game, viewerId, action);
    const tacticalPrior = tacticalActionPrior(game, viewerId, action);
    // Expected calibrated win probability is the objective. Mulligan, target,
    // movement, and risk heuristics remain diagnostics/features and cannot
    // directly override the simulated outcomes.
    const decisionScore = clamp01(mean);
    const commitment = average(commitments.map((item) => item.commitment));
    const posture = commitment >= 0.75 ? "commit" : commitment <= 0.2 ? "reserve" : "balanced";
    const macroContinuation = summarizeMacroContinuation(validSamples);
    const result = {
      action,
      expectedWinRate: mean,
      decisionScore,
      downsideWinRate,
      immediateWinRate: average(validSamples.map((sample) => sample.immediateWinRate)),
      confidenceInterval: [Math.max(0, mean - halfWidth), Math.min(1, mean + halfWidth)],
      simulations: validSamples.length,
      attemptedSimulations: samples.length,
      invalidSimulations: samples.length - validSamples.length,
      simulationSeeds: samples.map((sample) => Number(sample?.simulationSeed) >>> 0),
      simulationSeedFingerprint: simulationSeedFingerprint(
        samples.map((sample) => Number(sample?.simulationSeed) >>> 0)
      ),
      validRate,
      minimumValidRate,
      rolloutEvidenceEligible,
      invalidReasons,
      determinizationAudit: {
        version: 1,
        attempted: samples.length,
        failures: determinizationFailures,
        complete: samples.length > 0 && determinizationFailures === 0,
        invalidReasons: determinizationInvalidReasons
      },
      resourcePlan: {
        posture,
        commitment,
        allInRate: average(commitments.map((item) => item.allIn ? 1 : 0)),
        readyRunesAfter: average(commitments.map((item) => item.readyRunesAfter)),
        reserveCoverageAfter: average(commitments.map((item) => item.reserveCoverageAfter))
      },
      mulliganPlan: game.phase === "mulligan" ? mulliganPlan : null,
      responseRisk: {
        probability: response.responseProbability,
        expectedThreat: response.expectedThreat,
        affordableResponses: response.affordableResponses,
        observedPasses: response.observedPasses,
        recentPasses: response.recentPasses,
        passEvidenceStrength: response.passEvidenceStrength,
        sampledResponseRate: average(validSamples.map((sample) => sample.opponentResponded ? 1 : 0)),
        topResponses: response.topResponses.slice(0, 3)
      },
      riskWeight: 0,
      beliefConfidence: belief.confidence,
      beliefSource: belief.neuralBlend ? "public+neural" : "public",
      tacticalPrior,
      initialChoiceRate: average(validSamples.map((sample) => sample.initialChoice ? 1 : 0)),
      terminalRate: average(validSamples.map((sample) => sample.terminal ? 1 : 0)),
      immediateTerminalRate: average(validSamples.map((sample) => sample.immediateTerminal ? 1 : 0)),
      immediateTerminalWinRate: average(validSamples.map((sample) => sample.immediateTerminalWin ? 1 : 0)),
      saturatedLeafRate: average(validSamples.map((sample) => sample.saturated ? 1 : 0)),
      neuralLeafWinRate: mean,
      ensembleLeafWinRate: average(ensembleLeafWinRates),
      independentEvaluatorLeafWinRate: independentEvaluatorLeafWinRates.length
        ? average(independentEvaluatorLeafWinRates)
        : null,
      independentEvaluatorLeafWinRatesByModel,
      independentEvaluatorActionQWinRate:
        independentEvaluatorActionQWinRates.length
          ? average(independentEvaluatorActionQWinRates)
          : null,
      independentEvaluatorActionQWinRatesByModel,
      independentEvaluatorActionQAvailable:
        independentEvaluatorActionQWinRates.length > 0,
      independentEvaluatorActionQTargetHead:
        independentEvaluatorActionQTargetHeads.length === 1
          ? independentEvaluatorActionQTargetHeads[0]
          : null,
      independentEvaluatorPolicyCorrectionActionQWinRate:
        independentEvaluatorPolicyCorrectionActionQWinRates.length
          ? average(independentEvaluatorPolicyCorrectionActionQWinRates)
          : null,
      independentEvaluatorPolicyCorrectionActionQWinRatesByModel,
      independentEvaluatorSamples: independentEvaluatorLeafWinRates.length,
      independentEvaluatorAvailable: independentEvaluatorLeafWinRates.length > 0,
      independentEvaluatorPolicyCorrectionEligible:
        independentEvaluatorPolicyCorrectionActionQWinRates.length > 0,
      evaluatorSpread: average(evaluatorSpreads),
      heuristicLeafWinRate: average(heuristicLeafWinRates),
      neuralHeuristicDisagreement: average(outcomes.map((value, index) =>
        Math.abs(value - (heuristicLeafWinRates[index] ?? value)))),
      macroContinuation,
      opponentDeckPosterior: belief.posterior.slice(0, 3).map(({ deckId, name, probability }) => ({ deckId, name, probability })),
    };
    Object.defineProperty(result, ROLLOUT_OUTCOMES, { value: pairedOutcomes, enumerable: false });
    Object.defineProperty(result, ROLLOUT_SAMPLES, { value: samples, enumerable: false });
    return result;
}

function invalidRolloutSample(reason = "unknown", simulationSeed = 0, invalidCategory = "rollout") {
  return {
    simulationSeed: Number(simulationSeed) >>> 0,
    invalid: true,
    invalidReason: reason,
    invalidCategory,
    value: null,
    heuristicValue: null,
    immediateWinRate: null,
    immediateTerminal: false,
    immediateTerminalWin: false,
    commitment: null,
    opponentResponded: false,
    initialChoice: false,
    macroResolved: false,
    macroActionKeys: [],
    evaluatorValues: [],
    terminal: false,
    terminalOutcome: null,
    postActionAuditState: null,
    productionLeafAudit: null,
    continuationSteps: 0,
    saturated: false
  };
}

export function pairedTerminalLeafValueEvidence(correctResult, comparedResult, options = {}) {
  return pairedProductionLeafValuePairs(
    correctResult?.[ROLLOUT_SAMPLES] || [],
    comparedResult?.[ROLLOUT_SAMPLES] || [],
    options
  );
}

export function pairedTerminalLeafValuePairs(
  correctSamplesInput,
  comparedSamplesInput,
  options = {}
) {
  return pairedProductionLeafValuePairs(
    correctSamplesInput,
    comparedSamplesInput,
    options
  );
}

export function pairedProductionLeafValuePairs(
  correctSamplesInput,
  comparedSamplesInput,
  options = {}
) {
  const maximumPairs = Math.max(1, Math.min(4, Number(options.maximumPairs) || 2));
  const comparedBySeed = new Map(
    (comparedSamplesInput || [])
      .map((sample) => [Number(sample?.simulationSeed) >>> 0, sample])
  );
  const pairs = [];
  const correctSamples = [...(correctSamplesInput || [])]
    .sort((left, right) =>
      (Number(left?.simulationSeed) >>> 0) - (Number(right?.simulationSeed) >>> 0));
  for (const correct of correctSamples) {
    const simulationSeed = Number(correct?.simulationSeed) >>> 0;
    const compared = comparedBySeed.get(simulationSeed);
    if (correct?.invalid === true
      || compared?.invalid === true
      || correct?.productionLeafAudit?.terminal !== true
      || compared?.productionLeafAudit?.terminal !== true
      || Number(correct?.productionLeafAudit?.outcome) !== 1
      || Number(compared?.productionLeafAudit?.outcome) !== 0
      || !validLeafAuditState(correct?.productionLeafAudit?.state)
      || !validLeafAuditState(compared?.productionLeafAudit?.state)) continue;
    pairs.push({
      simulationSeed,
      correctState: Float32Array.from(correct.productionLeafAudit.state),
      comparedState: Float32Array.from(compared.productionLeafAudit.state),
      correctStructuredState:
        structuredClone(correct.productionLeafAudit.structuredState || null),
      comparedStructuredState:
        structuredClone(compared.productionLeafAudit.structuredState || null),
      correctOutcome: 1,
      comparedOutcome: 0,
      correctCaptureStep: Math.max(
        0,
        Number(correct.productionLeafAudit.captureStep) || 0
      ),
      comparedCaptureStep: Math.max(
        0,
        Number(compared.productionLeafAudit.captureStep) || 0
      ),
      correctDepthBin: correct.productionLeafAudit.depthBin || "unknown",
      comparedDepthBin: compared.productionLeafAudit.depthBin || "unknown",
      auditContinuationSteps: {
        correct: Math.max(
          0,
          Number(correct.productionLeafAudit.continuationSteps) || 0
        ),
        compared: Math.max(
          0,
          Number(compared.productionLeafAudit.continuationSteps) || 0
        )
      }
    });
    if (pairs.length >= maximumPairs) break;
  }
  return pairs;
}

function validLeafAuditState(value) {
  return (Array.isArray(value) || ArrayBuffer.isView(value))
    && value.length > 0
    && Array.from(value).every((item) => Number.isFinite(Number(item)));
}

function independentSimulationSeeds(count, random, excludedSeeds = []) {
  const excluded = new Set(Array.from(excludedSeeds || [], (value) => Number(value) >>> 0));
  const selected = new Set();
  const seeds = [];
  let fallback = 0x9e3779b9;
  while (seeds.length < count) {
    let seed = Math.floor(random() * 0x100000000) >>> 0;
    let attempts = 0;
    while ((excluded.has(seed) || selected.has(seed)) && attempts < 16) {
      seed = Math.floor(random() * 0x100000000) >>> 0;
      attempts += 1;
    }
    while (excluded.has(seed) || selected.has(seed)) {
      fallback = (Math.imul(fallback ^ seed, 1664525) + 1013904223) >>> 0;
      seed = fallback;
    }
    selected.add(seed);
    seeds.push(seed);
  }
  return seeds;
}

function simulationSeedFingerprint(seeds) {
  let hash = 2166136261;
  for (const seed of seeds) {
    hash ^= Number(seed) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `seed-bank-${hash.toString(16).padStart(8, "0")}-${seeds.length}`;
}

function summarizeMacroContinuation(samples) {
  const choiceSamples = samples.filter((sample) => sample.initialChoice);
  if (!choiceSamples.length) return null;
  const resolved = choiceSamples.filter((sample) => sample.macroResolved && sample.macroActionKeys?.length);
  const groups = new Map();
  for (const sample of resolved) {
    const key = JSON.stringify(sample.macroActionKeys);
    const group = groups.get(key) || { actionKeys: sample.macroActionKeys, samples: 0, outcomeTotal: 0 };
    group.samples += 1;
    group.outcomeTotal += sample.value;
    groups.set(key, group);
  }
  const ranked = [...groups.values()]
    .map((group) => ({ ...group, expectedWinRate: group.outcomeTotal / Math.max(1, group.samples) }))
    .sort((left, right) => right.samples - left.samples
      || right.expectedWinRate - left.expectedWinRate
      || JSON.stringify(left.actionKeys).localeCompare(JSON.stringify(right.actionKeys)));
  const best = ranked[0] || null;
  const resolvedRate = resolved.length / Math.max(1, choiceSamples.length);
  const consensusRate = best ? best.samples / Math.max(1, choiceSamples.length) : 0;
  return {
    required: true,
    samples: choiceSamples.length,
    resolvedSamples: resolved.length,
    resolvedRate,
    consensusSamples: best?.samples || 0,
    consensusRate,
    expectedWinRate: best?.expectedWinRate ?? null,
    actionKeys: best?.actionKeys || [],
    verified: Boolean(best?.actionKeys?.length
      && choiceSamples.length >= 8
      && best.samples >= Math.max(4, Math.ceil(choiceSamples.length * 0.75))
      && resolvedRate >= 0.8
      && consensusRate >= 0.75)
  };
}

export function proveImmediateActionOutcome(game, viewerId, action) {
  const preview = cloneGame(game);
  const applied = applyAiAction(preview, action, viewerId);
  if (!applied?.ok) return { resolved: false, terminal: false, won: false, reason: "illegal-action" };
  const opensContinuation = Boolean(preview.pendingPayment || preview.pendingChoice || preview.actionChain);
  return {
    resolved: !opensContinuation,
    terminal: !opensContinuation && preview.phase === "complete",
    won: !opensContinuation && preview.phase === "complete" && preview.winnerId === viewerId,
    winnerId: !opensContinuation && preview.phase === "complete" ? preview.winnerId || null : null,
    score: preview.players.find((player) => player.id === viewerId)?.score ?? null,
    reason: opensContinuation ? "opens-continuation" : preview.phase === "complete" ? "terminal" : "nonterminal"
  };
}

export function buildTeacherMacroDemonstration(game, viewerId, action, macroContinuation, model, options = {}) {
  if (!macroContinuation?.verified || !macroContinuation.actionKeys?.length) {
    return { verified: false, reason: "missing-verified-macro", steps: [], actionKeys: [] };
  }
  const preview = cloneGame(game);
  if (!applyAiAction(preview, action, viewerId)?.ok) {
    return { verified: false, reason: "macro-initial-action-failed", steps: [], actionKeys: [] };
  }
  const paymentActions = [];
  if (preview.pendingPayment) {
    const payment = resolvePlannedPayment(preview, paymentOptions(model, options.neuralModel));
    if (!payment?.ok) return { verified: false, reason: "macro-payment-failed", steps: [], actionKeys: [] };
    for (const plan of payment.plans || []) {
      for (const paymentAction of plan.actions || []) paymentActions.push(actionKey(paymentAction));
    }
  }
  const steps = [];
  for (const expectedKey of macroContinuation.actionKeys) {
    if (!preview.pendingChoice || activeActorId(preview) !== viewerId) {
      return { verified: false, reason: "macro-choice-boundary-changed", steps: [], actionKeys: [] };
    }
    const legal = enumerateAiPolicyActions(preview, viewerId);
    const selected = legal.find((candidate) => actionKey(candidate) === expectedKey);
    if (!selected) return { verified: false, reason: "macro-choice-no-longer-legal", steps: [], actionKeys: [] };
    const actionSet = encodeActionSet(preview, viewerId, legal, { requiredActions: [selected] });
    const selectedIndex = actionSet.actions.findIndex((candidate) => actionKey(candidate) === expectedKey);
    if (selectedIndex < 0) return { verified: false, reason: "macro-choice-not-encoded", steps: [], actionKeys: [] };
    steps.push({
      state: encodeState(preview, viewerId),
      actions: actionSet.encoded,
      selectedIndex,
      legalCount: actionSet.legalCount,
      originalLegalCount: actionSet.originalLegalCount,
      selectedActionKey: expectedKey,
      legalActionKeys: actionSet.actions.map(actionKey),
      beliefTarget: encodeOpponentDeckTarget(preview, viewerId),
      initialMemory: steps.length === 0
        ? Float32Array.from(options.initialMemory || [])
        : undefined
    });
    if (!applyAiAction(preview, selected, viewerId)?.ok) {
      return { verified: false, reason: "macro-choice-apply-failed", steps: [], actionKeys: [] };
    }
    if (preview.pendingPayment) {
      const payment = resolvePlannedPayment(preview, paymentOptions(model, options.neuralModel));
      if (!payment?.ok) return { verified: false, reason: "macro-continuation-payment-failed", steps: [], actionKeys: [] };
    }
  }
  if (preview.pendingChoice) {
    return { verified: false, reason: "macro-choice-incomplete", steps: [], actionKeys: [] };
  }
  return {
    verified: steps.length === macroContinuation.actionKeys.length,
    reason: null,
    steps,
    actionKeys: macroContinuation.actionKeys,
    paymentActionKeys: paymentActions,
    initialMemory: Float32Array.from(options.initialMemory || [])
  };
}

export function pairedRolloutDifference(left, right) {
  const leftOutcomes = left?.[ROLLOUT_OUTCOMES] || [];
  const rightOutcomes = right?.[ROLLOUT_OUTCOMES] || [];
  const paired = Array.from({ length: Math.min(leftOutcomes.length, rightOutcomes.length) }, (_, index) => [
    leftOutcomes[index],
    rightOutcomes[index]
  ]).filter(([leftValue, rightValue]) => Number.isFinite(leftValue) && Number.isFinite(rightValue));
  const count = paired.length;
  if (!count) {
    return {
      samples: 0,
      mean: Math.max(0, Number(left?.decisionScore) - Number(right?.decisionScore)),
      standardError: 1,
      lowerBound: -1,
      upperBound: 1,
      positiveRate: 0
    };
  }
  const differences = paired.map(([leftValue, rightValue]) => Number(leftValue) - Number(rightValue));
  const mean = average(differences);
  const variance = count > 1
    ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
    : 1;
  // Correlated neural leaves often produce identical values. Keep a small
  // uncertainty floor so two saturated model estimates cannot masquerade as
  // independent proof.
  const modelUncertainty = Math.max(
    Number(left?.saturatedLeafRate) || 0,
    Number(right?.saturatedLeafRate) || 0,
    1 - Math.min(Number(left?.terminalRate) || 0, Number(right?.terminalRate) || 0)
  );
  const standardError = Math.max(
    Math.sqrt(Math.max(0, variance) / count),
    0.06 * modelUncertainty / Math.sqrt(count)
  );
  const criticalValue = count >= 16 ? 1.96 : count >= 8 ? 2.15 : count >= 4 ? 2.45 : 3;
  return {
    samples: count,
    mean,
    standardError,
    lowerBound: mean - criticalValue * standardError,
    upperBound: mean + criticalValue * standardError,
    positiveRate: differences.filter((value) => value > 0).length / count
  };
}

export function pairedTerminalRolloutDifference(left, right) {
  const leftSamples = left?.[ROLLOUT_SAMPLES] || [];
  const rightSamples = right?.[ROLLOUT_SAMPLES] || [];
  const paired = Array.from(
    { length: Math.min(leftSamples.length, rightSamples.length) },
    (_, index) => [leftSamples[index], rightSamples[index]]
  ).filter(([leftSample, rightSample]) =>
    leftSample?.invalid !== true
      && rightSample?.invalid !== true
      && leftSample?.terminal === true
      && rightSample?.terminal === true
      && Number.isFinite(Number(leftSample?.value))
      && Number.isFinite(Number(rightSample?.value)));
  const count = paired.length;
  if (!count) {
    return {
      samples: 0,
      mean: 0,
      standardError: 1,
      lowerBound: -1,
      upperBound: 1,
      positiveRate: 0
    };
  }
  const differences = paired.map(([leftSample, rightSample]) =>
    Number(leftSample.value) - Number(rightSample.value));
  const mean = average(differences);
  const variance = count > 1
    ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
    : 1;
  const standardError = Math.sqrt(Math.max(0, variance) / count);
  const criticalValue = count >= 16 ? 1.96 : count >= 8 ? 2.15 : count >= 4 ? 2.45 : 3;
  return {
    samples: count,
    mean,
    standardError,
    lowerBound: mean - criticalValue * standardError,
    upperBound: mean + criticalValue * standardError,
    positiveRate: differences.filter((value) => value > 0).length / count
  };
}

export function pairedIndependentTerminalActionAudit(left, right, options = {}) {
  const leftSamples = left?.[ROLLOUT_SAMPLES] || [];
  const rightSamples = right?.[ROLLOUT_SAMPLES] || [];
  const leftSeedCount = new Map();
  const rightSeedCount = new Map();
  for (const sample of leftSamples) {
    const seed = Number(sample?.simulationSeed) >>> 0;
    leftSeedCount.set(seed, (leftSeedCount.get(seed) || 0) + 1);
  }
  for (const sample of rightSamples) {
    const seed = Number(sample?.simulationSeed) >>> 0;
    rightSeedCount.set(seed, (rightSeedCount.get(seed) || 0) + 1);
  }
  const duplicateSeeds = [...new Set([
    ...[...leftSeedCount].filter(([, count]) => count !== 1).map(([seed]) => seed),
    ...[...rightSeedCount].filter(([, count]) => count !== 1).map(([seed]) => seed)
  ])].sort((a, b) => a - b);
  const rightBySeed = new Map(rightSamples.map((sample) => [
    Number(sample?.simulationSeed) >>> 0,
    sample
  ]));
  const attemptedSeeds = new Set();
  const terminalSeeds = [];
  const outcomePairs = [];
  const differences = [];
  const failureReasons = {};
  let validPairs = 0;
  let leftValidSamples = 0;
  let rightValidSamples = 0;
  let leftTerminalSamples = 0;
  let rightTerminalSamples = 0;
  let maximumStepCutoffs = 0;
  for (const leftSample of leftSamples) {
    const simulationSeed = Number(leftSample?.simulationSeed) >>> 0;
    const rightSample = rightBySeed.get(simulationSeed);
    if (!rightSample) continue;
    attemptedSeeds.add(simulationSeed);
    const leftValid = leftSample?.invalid !== true;
    const rightValid = rightSample?.invalid !== true;
    if (leftValid) leftValidSamples += 1;
    else incrementReason(failureReasons, `recommended:${leftSample?.invalidReason || "invalid"}`);
    if (rightValid) rightValidSamples += 1;
    else incrementReason(failureReasons, `selected:${rightSample?.invalidReason || "invalid"}`);
    if (leftValid && rightValid) validPairs += 1;
    const leftOutcome = independentTerminalAuditOutcome(leftSample);
    const rightOutcome = independentTerminalAuditOutcome(rightSample);
    if (Number.isFinite(leftOutcome)) leftTerminalSamples += 1;
    if (Number.isFinite(rightOutcome)) rightTerminalSamples += 1;
    maximumStepCutoffs += maximumStepCutoffCount(leftSample)
      + maximumStepCutoffCount(rightSample);
    if (!Number.isFinite(leftOutcome) || !Number.isFinite(rightOutcome)) {
      if (leftValid && !Number.isFinite(leftOutcome)) {
        incrementReason(failureReasons, `recommended:${terminalAuditFailureReason(leftSample)}`);
      }
      if (rightValid && !Number.isFinite(rightOutcome)) {
        incrementReason(failureReasons, `selected:${terminalAuditFailureReason(rightSample)}`);
      }
      continue;
    }
    terminalSeeds.push(simulationSeed);
    differences.push(leftOutcome - rightOutcome);
    outcomePairs.push({
      simulationSeed,
      leftOutcome,
      rightOutcome
    });
  }
  const count = differences.length;
  const attemptedPairs = attemptedSeeds.size;
  const rates = {
    valid: {
      recommended: rateWithWilsonLower(leftValidSamples, attemptedPairs),
      selected: rateWithWilsonLower(rightValidSamples, attemptedPairs),
      paired: rateWithWilsonLower(validPairs, attemptedPairs)
    },
    terminal: {
      recommended: rateWithWilsonLower(leftTerminalSamples, attemptedPairs),
      selected: rateWithWilsonLower(rightTerminalSamples, attemptedPairs),
      paired: rateWithWilsonLower(count, attemptedPairs)
    }
  };
  const determinizationAudit = {
    recommendedComplete: left?.determinizationAudit?.complete === true,
    selectedComplete: right?.determinizationAudit?.complete === true,
    complete: left?.determinizationAudit?.complete === true
      && right?.determinizationAudit?.complete === true
  };
  const leftSeeds = [...leftSeedCount.keys()].sort((a, b) => a - b);
  const rightSeeds = [...rightSeedCount.keys()].sort((a, b) => a - b);
  const pairingContract = {
    version: 1,
    exactSeedPairing: leftSeeds.length === rightSeeds.length
      && leftSeeds.every((seed, index) => seed === rightSeeds[index]),
    duplicateSeeds,
    uniqueSeeds: duplicateSeeds.length === 0,
    terminalSeedsMatchOutcomePairs: true
  };
  if (!count) {
    return {
      attemptedPairs,
      validPairs,
      terminalPairs: 0,
      samples: 0,
      mean: 0,
      standardError: 1,
      lowerBound: -1,
      upperBound: 1,
      positiveRate: 0,
      terminalSeeds: [],
      outcomePairs: [],
      confidenceMethod: "bounded-hoeffding-mean-v1",
      confidence: 0.95,
      pairingContract,
      determinizationAudit,
      rates,
      failureReasons,
      maximumStepCutoffs
    };
  }
  const mean = average(differences);
  const variance = count > 1
    ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / (count - 1)
    : 1;
  const standardError = Math.sqrt(Math.max(0, variance) / count);
  const confidence = Math.max(
    0.95,
    Math.min(0.999999, Number(options.confidence) || 0.95)
  );
  const pairedInterval = pairedBinaryDifferenceInterval(
    outcomePairs,
    confidence
  );
  if (!pairedInterval) {
    throw new Error(
      "Independent terminal action audit requires paired binary outcomes."
    );
  }
  return {
    attemptedPairs,
    validPairs,
    terminalPairs: count,
    samples: count,
    mean,
    standardError,
    lowerBound: pairedInterval.lowerBound,
    upperBound: pairedInterval.upperBound,
    positiveRate: differences.filter((value) => value > 0).length / count,
    assessmentVersion: PAIRED_ACTION_EFFECT_ASSESSMENT_VERSION,
    confidenceMethod: pairedInterval.method,
    confidence,
    pairedOutcomeCounts: {
      wins: pairedInterval.wins,
      losses: pairedInterval.losses,
      ties: pairedInterval.ties
    },
    pairingContract,
    determinizationAudit,
    terminalSeeds,
    outcomePairs,
    rates,
    failureReasons,
    maximumStepCutoffs
  };
}

export function pairedEvaluatorLeafStateEvidence(
  recommendedResult,
  selectedResult,
  options = {}
) {
  const maximumPairs = Math.max(1, Math.min(64, Number(options.maximumPairs) || 64));
  const recommendedSamples = recommendedResult?.[ROLLOUT_SAMPLES] || [];
  const selectedBySeed = new Map(
    (selectedResult?.[ROLLOUT_SAMPLES] || []).map((sample) => [
      Number(sample?.simulationSeed) >>> 0,
      sample
    ])
  );
  const pairs = [];
  for (const recommendedSample of recommendedSamples) {
    const simulationSeed = Number(recommendedSample?.simulationSeed) >>> 0;
    const selectedSample = selectedBySeed.get(simulationSeed);
    const recommendedAudit = recommendedSample?.postActionAuditState;
    const selectedAudit = selectedSample?.postActionAuditState;
    const recommendedOutcome =
      independentTerminalAuditOutcome(recommendedSample);
    const selectedOutcome =
      independentTerminalAuditOutcome(selectedSample);
    if (recommendedSample?.invalid === true
      || selectedSample?.invalid === true
      || !validLeafAuditState(recommendedAudit?.state)
      || !validLeafAuditState(selectedAudit?.state)) continue;
    if (!Number.isFinite(recommendedOutcome)
      || !Number.isFinite(selectedOutcome)) continue;
    pairs.push({
      simulationSeed,
      recommendedState: Float32Array.from(recommendedAudit.state),
      selectedState: Float32Array.from(selectedAudit.state),
      recommendedStructuredState:
        structuredClone(recommendedAudit.structuredState || null),
      selectedStructuredState:
        structuredClone(selectedAudit.structuredState || null),
      recommendedOutcome,
      selectedOutcome,
      recommendedHeuristicValue:
        finiteOrNull(recommendedAudit.heuristicValue),
      selectedHeuristicValue:
        finiteOrNull(selectedAudit.heuristicValue),
      recommendedCaptureStep:
        0,
      selectedCaptureStep:
        0,
      recommendedDepthBin: "post-action",
      selectedDepthBin: "post-action",
      auditContinuationSteps: {
        recommended: terminalAuditContinuationSteps(recommendedSample),
        selected: terminalAuditContinuationSteps(selectedSample)
      }
    });
    if (pairs.length >= maximumPairs) break;
  }
  return pairs;
}

function independentTerminalAuditOutcome(sample) {
  if (sample?.invalid === true) return null;
  if (sample?.terminal === true
    && Number.isFinite(Number(sample?.terminalOutcome))) {
    return Number(sample.terminalOutcome);
  }
  if (sample?.productionLeafAudit?.terminal === true
    && Number.isFinite(Number(sample.productionLeafAudit.outcome))) {
    return Number(sample.productionLeafAudit.outcome);
  }
  return null;
}

function terminalAuditFailureReason(sample) {
  const audit = sample?.productionLeafAudit;
  if (!audit) return "no-production-cutoff-audit";
  if (audit.failureReason) return audit.failureReason;
  if (audit.maximumStepsReached === true) return "maximum-steps-reached";
  return audit.terminal === true ? "unknown-terminal-outcome" : "nonterminal";
}

function maximumStepCutoffCount(sample) {
  return sample?.productionLeafAudit?.maximumStepsReached === true ? 1 : 0;
}

function terminalAuditContinuationSteps(sample) {
  return Math.max(0, Number(sample?.continuationSteps) || 0)
    + Math.max(
      0,
      Number(sample?.productionLeafAudit?.continuationSteps) || 0
    );
}

function rateWithWilsonLower(successes, attempts) {
  const count = Math.max(0, Number(attempts) || 0);
  const passed = Math.max(0, Math.min(count, Number(successes) || 0));
  return {
    successes: passed,
    attempts: count,
    rate: count ? passed / count : 0,
    lowerBound: wilsonLowerBound(passed, count)
  };
}

function wilsonLowerBound(successes, attempts, z = 1.96) {
  if (!attempts) return 0;
  const probability = successes / attempts;
  const denominator = 1 + (z * z) / attempts;
  const centre = probability + (z * z) / (2 * attempts);
  const margin = z * Math.sqrt(
    (probability * (1 - probability) + (z * z) / (4 * attempts)) / attempts
  );
  return Math.max(0, (centre - margin) / denominator);
}

function incrementReason(target, reason) {
  target[reason] = (target[reason] || 0) + 1;
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function determinizeGame(game, viewerId, belief = inferOpponentDeckBelief(game, viewerId), random = Math.random) {
  const clone = cloneGame(game);
  const viewer = clone.players.find((player) => player.id === viewerId);
  randomizeUnknownOwnDeck(viewer, random);
  const opponent = clone.players.find((player) => player.id !== viewerId);
  if (!opponent) return markDeterminization(clone, {
    complete: false,
    reason: "missing-opponent",
    requiredPrivateCards: 0,
    availablePrivateCards: 0
  });
  const privateSlots = [
    ...opponent.hand.map((card, index) => ({ zone: opponent.hand, index, original: card })),
    ...opponent.mainDeck.map((card, index) => ({ zone: opponent.mainDeck, index, original: card })),
    ...clone.battlefields.flatMap((field) => (field.hidden || [])
      .filter((item) => item.ownerId === opponent.id && !hiddenCardIsControlledBy(item, viewerId))
      .map((item) => ({ hidden: item, original: item.card })))
  ];
  if (!privateSlots.length) return markDeterminization(clone, {
    complete: true,
    reason: null,
    requiredPrivateCards: 0,
    availablePrivateCards: 0
  });
  if (!belief.posterior.length) return markDeterminization(clone, {
    complete: false,
    reason: "missing-belief-posterior",
    requiredPrivateCards: privateSlots.length,
    availablePrivateCards: 0
  });
  const selected = weightedPick(belief.posterior, random);
  const remaining = [];
  const observed = new Map(Object.entries(belief.observedCards || {}));
  for (const [cardNumber, copies] of Object.entries(selected.profile.cardCounts || {})) {
    const count = Math.max(0, copies - (observed.get(cardNumber) || 0));
    for (let index = 0; index < count; index += 1) if (CARD_BY_NUMBER.has(cardNumber)) remaining.push(CARD_BY_NUMBER.get(cardNumber));
  }
  shuffle(remaining, random);
  if (remaining.length < privateSlots.length) return markDeterminization(clone, {
    complete: false,
    reason: "insufficient-belief-cards",
    deckId: selected.deckId || null,
    requiredPrivateCards: privateSlots.length,
    availablePrivateCards: remaining.length
  });
  for (const slot of privateSlots) {
    const source = remaining.shift();
    if (!source) break;
    const replacement = instantiatePrivateCard(source, slot.original,
      slot.hidden?.ownerId || opponent.id,
      slot.hidden ? hiddenCardControllerId(slot.hidden) : opponent.id);
    if (slot.hidden) slot.hidden.card = replacement;
    else slot.zone[slot.index] = replacement;
  }
  return markDeterminization(clone, {
    complete: true,
    reason: null,
    deckId: selected.deckId || null,
    requiredPrivateCards: privateSlots.length,
    availablePrivateCards: remaining.length + privateSlots.length
  });
}

function markDeterminization(game, status) {
  Object.defineProperty(game, DETERMINIZATION_STATUS, {
    value: Object.freeze({ ...status }),
    enumerable: false,
    configurable: false
  });
  return game;
}

export function determinizationStatus(game) {
  return game?.[DETERMINIZATION_STATUS] || {
    complete: false,
    reason: "missing-determinization-status",
    requiredPrivateCards: 0,
    availablePrivateCards: 0
  };
}

function simulateContinuation(game, viewerId, model, planning, random) {
  const depth = Math.max(1, planning.depth || 1);
  const minimumTurnTransitions = Math.max(0, planning.minimumTurnTransitions || 0);
  const hardLimit = Math.max(depth, Math.min(192, depth * 2));
  const startTurnSequence = Number(game.turnSequence || 0);
  const neuralModels = planning.neuralModels || {};
  const sessions = new Map();
  const sessionFor = (actorId) => {
    const actorModel = neuralModels[actorId] || planning.neuralModel || null;
    if (!actorModel) return null;
    if (!sessions.has(actorId)) sessions.set(actorId, createNeuralSession(actorModel, {
      initialMemories: planning.initialMemories
    }));
    return sessions.get(actorId);
  };
  let opponentResponses = 0;
  let steps = 0;
  let captureInitialMacro = planning.captureInitialMacro === true;
  let macroResolved = !captureInitialMacro;
  const macroActionKeys = [];
  for (; steps < hardLimit && game.phase !== "complete"; steps += 1) {
    if (game.pendingPayment) {
      const payerId = game.pendingPayment.playerId;
      const payerModel = neuralModels[payerId] || planning.neuralModel || null;
      if (!resolvePlannedPayment(game, paymentOptions(model, payerModel))?.ok) break;
      if (captureInitialMacro && !game.pendingChoice && !game.pendingPayment) {
        captureInitialMacro = false;
        macroResolved = true;
      }
      continue;
    }
    const actorId = activeActorId(game);
    if (captureInitialMacro && actorId !== viewerId) {
      captureInitialMacro = false;
      macroResolved = false;
    }
    const legal = enumerateAiPolicyActions(game, actorId);
    const neuralSession = sessionFor(actorId);
    const selectingMacroChoice = captureInitialMacro && Boolean(game.pendingChoice) && actorId === viewerId;
    const selected = neuralSession
      ? neuralSession.decide(game, actorId, legal, selectingMacroChoice
        ? { temperature: 0.2, random, greedy: true }
        : { temperature: 0.2, random })
      : choosePolicyAction(game, actorId, legal, model, selectingMacroChoice
        ? { temperature: 0.35, random, greedy: true }
        : { temperature: 0.35, random });
    if (!selected || !applyAiAction(game, selected.action, actorId)?.ok) break;
    if (selectingMacroChoice) {
      macroActionKeys.push(actionKey(selected.action));
      if (!game.pendingChoice && !game.pendingPayment) {
        captureInitialMacro = false;
        macroResolved = true;
      }
    }
    if (actorId !== viewerId && isCardResponse(selected.action)) opponentResponses += 1;
    const turnsElapsed = Math.max(0, Number(game.turnSequence || 0) - startTurnSequence);
    const stableBoundary = !game.pendingChoice && !game.pendingPayment && !game.actionChain && game.phase !== "showdown";
    if (steps + 1 >= depth && turnsElapsed >= minimumTurnTransitions && stableBoundary) break;
  }
  addAiPerformance("rolloutSteps", steps);
  const viewerNeuralModel = neuralModels[viewerId] || planning.neuralModel || null;
  const terminal = game.phase === "complete";
  const productionLeafAudit = !terminal
    && planning.captureProductionLeafAudit === true
    ? auditProductionLeafState(game, viewerId, model, planning, {
      captureStep: steps,
      seed: Number(planning.productionLeafAuditSeed) >>> 0
    })
    : null;
  const primaryValue = evaluateWinRate(game, viewerId, model, viewerNeuralModel);
  const evaluatorCertification = planning.evaluatorModelsCertified === true
    ? { accepted: [...new Set(planning.evaluatorModels || [])], rejected: [] }
    : certifiedIndependentEvaluators(
      planning.evaluatorModels || [],
      viewerNeuralModel,
      {
        requiredPermission: "leafEvaluation",
        engineFingerprint: planning.engineFingerprint
          || viewerNeuralModel?.metadata?.engineFingerprint
          || null
      }
    );
  const independentEvaluatorModels = evaluatorCertification.accepted;
  const evaluatorModels = [...new Set([
    viewerNeuralModel,
    ...independentEvaluatorModels
  ].filter(Boolean))];
  const evaluatorValues = evaluatorModels.length
    ? evaluatorModels.map((evaluatorModel) =>
      evaluatorModel === viewerNeuralModel
        ? primaryValue
        : evaluateWinRate(game, viewerId, model, evaluatorModel))
    : [primaryValue];
  const independentEvaluatorValues = independentEvaluatorModels.map((evaluatorModel) =>
    evaluateWinRate(game, viewerId, model, evaluatorModel));
  return {
    value: primaryValue,
    evaluatorValues,
    independentEvaluatorValues,
    evaluatorCertification: {
      accepted: independentEvaluatorModels.length,
      rejectedReasons: evaluatorCertification.rejected.map((item) => item.reasons)
    },
    heuristicValue: terminal
      ? game.winnerId === viewerId ? 1 : 0
      : (evaluateState(game, viewerId, model) + 1) / 2,
    terminal,
    terminalOutcome: terminal ? game.winnerId === viewerId ? 1 : 0 : null,
    productionLeafAudit,
    opponentResponses,
    macroResolved,
    macroActionKeys,
    steps
  };
}

function auditProductionLeafState(game, viewerId, model, planning, options = {}) {
  addAiPerformance("productionLeafAuditCalls");
  const captureAuditState = planning.captureProductionLeafAuditState !== false;
  const state = captureAuditState
    ? Float32Array.from(encodeState(game, viewerId))
    : null;
  const structuredState = captureAuditState
    ? createPublicStructuredEvidenceSnapshot(
      game,
      viewerId,
      {
        engineFingerprint: planning.engineFingerprint,
        informationSetHash: planning.informationSetHash
      }
    )
    : null;
  const heuristicValue = captureAuditState
    ? (evaluateState(game, viewerId, model) + 1) / 2
    : null;
  const auditGame = cloneGame(game);
  const auditSeed = (Number(options.seed) ^ 0xa17d9e3b) >>> 0;
  const random = seededRandom(auditSeed);
  const neuralModels = planning.neuralModels || {};
  const sessions = new Map();
  const sessionFor = (actorId) => {
    const actorModel = neuralModels[actorId] || planning.neuralModel || null;
    if (!actorModel) return null;
    if (!sessions.has(actorId)) {
      sessions.set(actorId, createNeuralSession(actorModel));
    }
    return sessions.get(actorId);
  };
  const maximumSteps = Math.max(
    64,
    Math.min(1200, Number(planning.productionLeafAuditMaximumSteps) || 1200)
  );
  let continuationSteps = 0;
  let valid = true;
  for (; continuationSteps < maximumSteps
    && auditGame.phase !== "complete"; continuationSteps += 1) {
    if (auditGame.pendingPayment) {
      const payerId = auditGame.pendingPayment.playerId;
      const payerModel = neuralModels[payerId] || planning.neuralModel || null;
      if (!resolvePlannedPayment(
        auditGame,
        paymentOptions(model, payerModel)
      )?.ok) {
        valid = false;
        break;
      }
      continue;
    }
    const actorId = activeActorId(auditGame);
    const legal = enumerateAiPolicyActions(auditGame, actorId);
    const neuralSession = sessionFor(actorId);
    const selected = neuralSession
      ? neuralSession.decide(auditGame, actorId, legal, {
        temperature: 0.2,
        random
      })
      : choosePolicyAction(auditGame, actorId, legal, model, {
        temperature: 0.35,
        random
      });
    if (!selected || !applyAiAction(
      auditGame,
      selected.action,
      actorId
    )?.ok) {
      valid = false;
      break;
    }
  }
  const terminal = valid && auditGame.phase === "complete";
  const maximumStepsReached = valid
    && !terminal
    && continuationSteps >= maximumSteps;
  addAiPerformance("productionLeafAuditSteps", continuationSteps);
  if (terminal) addAiPerformance("productionLeafAuditTerminal");
  else addAiPerformance("productionLeafAuditIncomplete");
  return {
    version: 1,
    contract: "production-rollout-cutoff-terminal-audit-v1",
    state,
    structuredState,
    heuristicValue,
    captureStep: Math.max(0, Number(options.captureStep) || 0),
    depthBin: rolloutDepthBin(options.captureStep),
    auditSeed,
    continuationSteps,
    maximumSteps,
    maximumStepsReached,
    failureReason: terminal
      ? null
      : !valid
        ? "continuation-invalid"
        : maximumStepsReached
          ? "maximum-steps-reached"
          : "continuation-incomplete",
    terminal,
    outcome: terminal ? auditGame.winnerId === viewerId ? 1 : 0 : null,
    usedForTeacherDecision: false,
    usedForPolicyTraining: false
  };
}

function rolloutDepthBin(depth) {
  const value = Math.max(0, Number(depth) || 0);
  if (value < 8) return "0-7";
  if (value < 16) return "8-15";
  if (value < 32) return "16-31";
  if (value < 64) return "32-63";
  return "64+";
}

function evaluateWinRate(game, viewerId, model, neuralModel = null) {
  if (game.phase === "complete") return game.winnerId === viewerId ? 1 : 0;
  if (neuralModel) {
    const value = estimateNeuralValue(neuralModel, game, viewerId);
    return calibratedProbability(value, neuralModel.calibration?.temperature || 1, neuralModel.calibration?.bias || 0);
  }
  return (evaluateState(game, viewerId, model) + 1) / 2;
}

function isCardResponse(action) {
  return ["beginPlayCard", "beginPlayChampion", "activateCard", "chooseEffectOption"].includes(action?.kind);
}

function instantiatePrivateCard(source, original, ownerId, controllerId = ownerId) {
  return {
    ...structuredClone(source),
    instanceId: original.instanceId,
    ownerId,
    controllerId,
    zone: original.zone,
    damage: 0,
    buffs: 0,
    mightModifier: 0,
    exhausted: Boolean(original.exhausted),
    attachments: []
  };
}

function weightedPick(items, random) { let roll = random(); for (const item of items) { roll -= item.probability; if (roll <= 0) return item; } return items.at(-1); }
function shuffle(items, random) { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [items[index], items[target]] = [items[target], items[index]]; } }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function blendNeuralDeckBelief(belief, neuralBelief) {
  if (!belief?.posterior?.length || !neuralBelief?.length) return belief;
  const scored = belief.posterior.map((candidate) => {
    const cardNumbers = Object.keys(candidate.profile?.cardCounts || {});
    const evidence = cardNumbers.length ? cardNumbers.reduce((sum, cardNumber) => {
      const index = CARD_INDEX.get(cardNumber) || 0;
      return sum + Math.log(Math.max(0.02, Math.min(0.98, Number(neuralBelief[index]) || 0.02)));
    }, 0) / cardNumbers.length : Math.log(0.02);
    return { ...candidate, logWeight: Math.log(Math.max(1e-9, candidate.probability)) + evidence * 1.5 };
  });
  const maximum = Math.max(...scored.map((candidate) => candidate.logWeight));
  const weights = scored.map((candidate) => Math.exp(candidate.logWeight - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const posterior = scored.map((candidate, index) => {
    const { logWeight, ...rest } = candidate;
    return { ...rest, probability: weights[index] / total };
  }).sort((left, right) => right.probability - left.probability);
  return {
    ...belief,
    posterior,
    confidence: posterior[0]?.probability >= 0.75 ? "high" : posterior[0]?.probability >= 0.45 ? "medium" : "low",
    neuralBlend: true
  };
}
function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  const random = () =>
    ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
  random.getState = () => state >>> 0;
  random.setState = (nextState) => {
    state = Number(nextState) >>> 0 || 1;
    return state;
  };
  return random;
}
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability)))];
}

function paymentOptions(model, neuralModel) {
  return neuralModel?.layers
    ? { model, learnedCandidateLimit: 3, valueEstimator: (game, actorId) => estimateNeuralValue(neuralModel, game, actorId) }
    : { model };
}
