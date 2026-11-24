import { tf } from "./tf-runtime.mjs";
import { ACTION_DIM, CARD_BINS, MAX_ACTIONS, MAX_SEQUENCE, STATE_DIM } from "./encoding.mjs";
import {
  NEURAL_HIDDEN_SIZE,
  estimateEvidenceNeuralValue,
  estimateEncodedNeuralValue,
  evaluateBehaviorCloningBatch,
  trainBehaviorCloningBatch,
  trainPpoBatch,
  trainTeacherProposalValueBatch
} from "./model.mjs";
import {
  createStructuredV2TensorInput,
  disposeStructuredV2TensorInput,
  evaluatorArchitecture,
  evaluatorLayerNames,
  evaluatorPathId,
  evaluatorRequiresStructuredV2,
  EVALUATOR_TARGET_HEADS,
  evaluatorTrainableVariables,
  forwardEvaluatorValue,
  normalizeEvaluatorTargetHead
} from "./evaluator-architecture.mjs";
import { validPublicStructuredEvidenceSnapshot } from "./structured-evidence.mjs";
import { PROOF_LABEL_VERSION } from "./proof-contract.mjs";
import { stableTeacherCorrectionId, TEACHER_LABEL_VERSION } from "./teacher-contract.mjs";
import {
  ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
  ACTION_RANKING_AUDIT_REFERENCE_VERSION,
  ACTION_RANKING_REFERENCE_CONTRACT,
  ACTION_RANKING_REFERENCE_VERSION,
  LEAF_VALUE_REFERENCE_CONTRACT,
  LEAF_VALUE_REFERENCE_VERSION,
  validActionRankingAuditReference,
  validActionRankingReference,
  validIndependentLeafValueReference,
  validLeafActionEffectComparison,
  validLeafAuditSamplingFrame,
  validLeafValueReference
} from "./action-ranking-reference.mjs";
import {
  assessActionEvidence
} from "./evidence-protocol.mjs";
import { pairedBinaryDifferenceInterval } from
  "./paired-action-effect-statistics.mjs";
import {
  EVALUATOR_AUDIT_CORE_ACTION_CLASSES,
  EVALUATOR_AUDIT_PHASE_BANDS,
  evaluatorAuditOpportunityActionClasses,
  normalizeEvaluatorAuditStratum
} from "./audit-strata.mjs";

export async function trainEvaluatorFromAuditEvidence(
  model,
  batchFactory,
  options = {}
) {
  if (typeof batchFactory !== "function") {
    throw new Error("Evaluator evidence training requires a restartable batch factory.");
  }
  const epochs = Math.max(1, Math.floor(Number(options.epochs) || 4));
  const batchSize = Math.max(1, Math.floor(Number(options.batchSize) || 32));
  const learningRate = Math.max(1e-6, Number(options.learningRate) || 0.0001);
  const optimizer = tf.train.adam(learningRate);
  const history = [];
  let totalSamples = 0;
  let totalSourceSamples = {};
  let totalStatisticalStrengthSamples = {};
  let totalContinuationScopeSamples = {};
  let totalTargetHeadSamples = {};
  const structuredV2 = evaluatorRequiresStructuredV2(model);
  const structuredV1PretrainingEpochs = structuredV2 && epochs >= 2
    ? Math.max(1, Math.floor(epochs * 0.25))
    : 0;
  const legacyRehearsalFraction = structuredV2
    ? Math.max(0.1, Math.min(
      0.25,
      Number(options.legacyRehearsalFraction) || 0.2
    ))
    : 0;
  try {
    for (let epoch = 1; epoch <= epochs; epoch += 1) {
      const metrics = [];
      let epochSamples = 0;
      const epochSourceSamples = {};
      const epochStatisticalStrengthSamples = {};
      const epochContinuationScopeSamples = {};
      const epochTargetHeadSamples = {};
      // Dataset archives are intentionally small so they can be streamed
      // without retaining the full evidence set. Do not let those storage
      // boundaries become optimizer batch boundaries: doing so turned the
      // configured batch size of 32 into roughly 5-6 samples per update on
      // Run C. Keep only the incomplete tail for each independent head and
      // train full batches across archive boundaries.
      const pendingSamplesByTargetHead = new Map();
      for await (const trajectories of batchFactory()) {
        const rawSamples = evaluatorValueTrainingSamples(trajectories, options);
        const balancedSamples = applyEvaluatorTrainingBalanceProfile(
          rawSamples,
          options.trainingBalanceProfile
        );
        const samples = evaluatorTrainingStageSamples(balancedSamples, {
          epoch,
          epochs,
          structuredV1PretrainingEpochs,
          legacyRehearsalFraction,
          structuredV2
        });
        epochSamples += samples.length;
        for (const sample of samples) {
          epochSourceSamples[sample.source] =
            (Number(epochSourceSamples[sample.source]) || 0) + 1;
          if (sample.structuredV2Eligible) {
            const key = `structured-v2-${sample.source}`;
            epochSourceSamples[key] =
              (Number(epochSourceSamples[key]) || 0) + 1;
          }
          if (sample.evidenceAssessment?.statisticalStrength) {
            const key = sample.evidenceAssessment.statisticalStrength;
            epochStatisticalStrengthSamples[key] =
              (Number(epochStatisticalStrengthSamples[key]) || 0) + 1;
          }
          if (sample.evidenceAssessment?.continuationScope) {
            const key = sample.evidenceAssessment.continuationScope;
            epochContinuationScopeSamples[key] =
              (Number(epochContinuationScopeSamples[key]) || 0) + 1;
          }
          const targetHead = normalizeEvaluatorTargetHead(sample.targetHead);
          epochTargetHeadSamples[targetHead] =
            (Number(epochTargetHeadSamples[targetHead]) || 0) + 1;
        }
        for (const sample of samples) {
          const targetHead = normalizeEvaluatorTargetHead(sample.targetHead);
          const headSamples = pendingSamplesByTargetHead.get(targetHead) || [];
          headSamples.push(sample);
          pendingSamplesByTargetHead.set(targetHead, headSamples);
          if (headSamples.length >= batchSize) {
            metrics.push(trainEvaluatorValuePairBatch(
              model,
              headSamples.splice(0, batchSize),
              optimizer,
              { ...options, targetHead }
            ));
          }
        }
      }
      for (const [targetHead, headSamples] of pendingSamplesByTargetHead) {
        if (!headSamples.length) continue;
        metrics.push(trainEvaluatorValuePairBatch(
          model,
          headSamples,
          optimizer,
          { ...options, targetHead }
        ));
      }
      totalSamples = Math.max(totalSamples, epochSamples);
      // batchFactory is replayed every epoch. Report one-pass evidence counts,
      // not epoch-multiplied exposure.
      for (const [source, count] of Object.entries(epochSourceSamples)) {
        totalSourceSamples[source] = Math.max(
          Number(totalSourceSamples[source]) || 0,
          count
        );
      }
      for (const [strength, count] of Object.entries(
        epochStatisticalStrengthSamples
      )) {
        totalStatisticalStrengthSamples[strength] = Math.max(
          Number(totalStatisticalStrengthSamples[strength]) || 0,
          count
        );
      }
      for (const [scope, count] of Object.entries(
        epochContinuationScopeSamples
      )) {
        totalContinuationScopeSamples[scope] = Math.max(
          Number(totalContinuationScopeSamples[scope]) || 0,
          count
        );
      }
      for (const [targetHead, count] of Object.entries(epochTargetHeadSamples)) {
        totalTargetHeadSamples[targetHead] = Math.max(
          Number(totalTargetHeadSamples[targetHead]) || 0,
          count
        );
      }
      const epochMetrics = {
        epoch,
        stage: evaluatorTrainingStageName({
          epoch,
          epochs,
          structuredV1PretrainingEpochs,
          structuredV2
        }),
        samples: epochSamples,
        batches: metrics.length,
        loss: mean(metrics.map((item) => item.loss)),
        rankingLoss: mean(metrics.map((item) => item.rankingLoss)),
        outcomeLoss: mean(metrics.map((item) => item.outcomeLoss)),
        meanPreferredMargin: mean(
          metrics.map((item) => item.meanPreferredMargin)
        )
      };
      history.push(epochMetrics);
      await options.onEpoch?.(epochMetrics);
    }
  } finally {
    optimizer.dispose?.();
  }
  const report = {
    version: 5,
    contract: "independent-isolated-evaluator-staged-v1-v2-train-v5-stream-batches",
    policyWeightsUpdated: false,
    evaluatorArchitecture: evaluatorArchitecture(model),
    trainableLayers: evaluatorLayerNames(model),
    epochs,
    batchSize,
    learningRate,
    structuredV1PretrainingEpochs,
    structuredV2FineTuningEpochs: structuredV2
      ? epochs - structuredV1PretrainingEpochs
      : 0,
    legacyRehearsalFraction,
    trainingBalanceProfile: options.trainingBalanceProfile || null,
    samples: totalSamples,
    sourceSamples: totalSourceSamples,
    statisticalStrengthSamples: totalStatisticalStrengthSamples,
    continuationScopeSamples: totalContinuationScopeSamples,
    targetHeadSamples: totalTargetHeadSamples,
    history
  };
  model.metadata = {
    ...model.metadata,
    evaluatorEvidenceTraining: report
  };
  return report;
}

function evaluatorTrainingStageSamples(samples, options = {}) {
  if (!options.structuredV2) return samples;
  if (options.epoch <= options.structuredV1PretrainingEpochs) {
    // Use every stored legacy state as a common representation pretraining
    // source. The actual v2 companions are intentionally hidden in this stage.
    return samples.map((sample) => ({
      ...sample,
      preferredStructuredState: null,
      comparedStructuredState: null,
      structuredV2Eligible: false,
      source: `legacy-pretrain:${sample.source}`
    }));
  }
  const finalEpoch = options.epoch === options.epochs;
  const structured = samples.filter((sample) => sample.structuredV2Eligible);
  if (!finalEpoch) return structured;
  const legacy = samples.filter((sample) => !sample.structuredV2Eligible);
  // Cap legacy as a fraction of the final mixed batch, rather than as a
  // fraction of the potentially much larger legacy archive.
  const rehearsalCount = Math.min(
    legacy.length,
    Math.floor(
      structured.length * options.legacyRehearsalFraction
        / Math.max(1e-6, 1 - options.legacyRehearsalFraction)
    )
  );
  const rehearsal = Array.from({ length: rehearsalCount }, (_, index) => {
    const sample = legacy[Math.floor(index * legacy.length / rehearsalCount)];
    return {
      ...sample,
      preferredStructuredState: null,
      comparedStructuredState: null,
      structuredV2Eligible: false,
      source: `legacy-rehearsal:${sample.source}`
    };
  });
  return [...structured, ...rehearsal];
}

function evaluatorTrainingStageName(options = {}) {
  if (!options.structuredV2) return "shared-evidence-training";
  if (options.epoch <= options.structuredV1PretrainingEpochs) {
    return "legacy-v1-common-pretraining";
  }
  return options.epoch === options.epochs
    ? "structured-v2-finetune-with-legacy-rehearsal"
    : "structured-v2-only-finetune";
}

export function trainEvaluatorValuePairBatch(
  model,
  samples,
  optimizer,
  options = {}
) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      samples: 0,
      loss: 0,
      rankingLoss: 0,
      outcomeLoss: 0,
      meanPreferredMargin: 0
    };
  }
  const sampleTargetHeads = new Set(samples.map((sample) =>
    normalizeEvaluatorTargetHead(sample.targetHead)));
  const targetHead = normalizeEvaluatorTargetHead(
    options.targetHead || samples[0]?.targetHead
  );
  if (sampleTargetHeads.size !== 1 || !sampleTargetHeads.has(targetHead)) {
    throw new Error(
      "Evaluator batches must contain exactly one matching output target head."
    );
  }
  const margin = Math.max(0, Number(options.margin) || 0.15);
  const rankingCoefficient = Math.max(
    0,
    Number(options.rankingCoefficient) || 1
  );
  const outcomeCoefficient = Math.max(
    0,
    Number(options.outcomeCoefficient) || 0.25
  );
  const stateValues = new Float32Array(samples.length * 2 * STATE_DIM);
  const structuredStates = [];
  const informationSetHashes = [];
  const outcomeTargets = new Float32Array(samples.length * 2);
  const outcomeMask = new Float32Array(samples.length * 2);
  const pairWeights = new Float32Array(samples.length);
  const branchWeights = new Float32Array(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const configuredSampleWeight = Number(sample.sampleWeight);
    const sampleWeight = Number.isFinite(configuredSampleWeight)
      ? Math.max(0, Math.min(1, configuredSampleWeight))
      : 1;
    pairWeights[index] = sampleWeight * Math.max(0, Math.min(1, Number(sample.rankingWeight ?? 1)));
    branchWeights[index * 2] = sampleWeight;
    branchWeights[index * 2 + 1] = sampleWeight;
    stateValues.set(sample.preferredState, index * 2 * STATE_DIM);
    stateValues.set(sample.comparedState, (index * 2 + 1) * STATE_DIM);
    structuredStates.push(
      sample.preferredStructuredState || null,
      sample.comparedStructuredState || null
    );
    informationSetHashes.push(
      sample.informationSetHash || null,
      sample.informationSetHash || null
    );
    for (const [branch, target] of [
      [0, sample.preferredTarget],
      [1, sample.comparedTarget]
    ]) {
      if (target == null || !Number.isFinite(Number(target))) continue;
      outcomeTargets[index * 2 + branch] = Math.max(
        -1,
        Math.min(1, Number(target))
      );
      outcomeMask[index * 2 + branch] = 1;
    }
  }
  const legacyStates = Array.from(
    { length: samples.length * 2 },
    (_, index) => stateValues.slice(
      index * STATE_DIM,
      (index + 1) * STATE_DIM
    )
  );
  const states = evaluatorRequiresStructuredV2(model)
    ? createStructuredV2TensorInput(structuredStates, {
      engineFingerprint: options.engineFingerprint,
      informationSetHashes,
      legacyStates
    })
    : tf.tensor3d(
      stateValues,
      [samples.length * 2, 1, STATE_DIM]
    );
  const targets = tf.tensor2d(outcomeTargets, [samples.length, 2]);
  const targetMask = tf.tensor2d(outcomeMask, [samples.length, 2]);
  const rankingWeights = tf.tensor2d(pairWeights, [samples.length, 1]);
  const outcomeWeights = tf.tensor2d(branchWeights, [samples.length, 2]);
  const variables = evaluatorTrainableVariables(model, { targetHead });
  let keptRankingLoss = null;
  let keptOutcomeLoss = null;
  let keptMeanMargin = null;
  const lossFunction = () => {
    const values = tf.reshape(
      forwardEvaluatorValue(model, states, { targetHead }),
      [samples.length, 2]
    );
    const preferredMargins = tf.sub(
      values.slice([0, 0], [samples.length, 1]),
      values.slice([0, 1], [samples.length, 1])
    );
    const rankingDenominator = tf.maximum(1e-6, tf.sum(rankingWeights));
    const rankingLoss = tf.div(
      tf.sum(tf.mul(
        tf.relu(tf.sub(margin, preferredMargins)),
        rankingWeights
      )),
      rankingDenominator
    );
    const weightedTargetMask = tf.mul(targetMask, outcomeWeights);
    const outcomeDenominator = tf.maximum(1e-6, tf.sum(weightedTargetMask));
    const outcomeLoss = tf.div(
      tf.sum(tf.mul(
        tf.square(tf.sub(values, targets)),
        weightedTargetMask
      )),
      outcomeDenominator
    );
    keptRankingLoss = tf.keep(rankingLoss);
    keptOutcomeLoss = tf.keep(outcomeLoss);
    keptMeanMargin = tf.keep(tf.div(
      tf.sum(tf.mul(preferredMargins, rankingWeights)),
      rankingDenominator
    ));
    return tf.add(
      tf.mul(rankingLoss, rankingCoefficient),
      tf.mul(outcomeLoss, outcomeCoefficient)
    );
  };
  const { value: loss, grads } = tf.variableGrads(lossFunction, variables);
  const gradientClipNorm = Math.max(
    0.1,
    Number(options.gradientClipNorm) || 1
  );
  const clipped = Object.fromEntries(Object.entries(grads).map(([name, grad]) => {
    const norm = tf.sqrt(tf.sum(tf.square(grad)));
    const scale = tf.minimum(
      1,
      tf.div(gradientClipNorm, tf.add(norm, 1e-12))
    );
    const clippedGradient = tf.mul(grad, scale);
    norm.dispose();
    scale.dispose();
    return [name, clippedGradient];
  }));
  optimizer.applyGradients(clipped);
  const result = {
    samples: samples.length,
    targetHead,
    loss: loss.dataSync()[0],
    rankingLoss: keptRankingLoss.dataSync()[0],
    outcomeLoss: keptOutcomeLoss.dataSync()[0],
    meanPreferredMargin: keptMeanMargin.dataSync()[0]
  };
  loss.dispose();
  Object.values(grads).forEach((tensor) => tensor.dispose());
  Object.values(clipped).forEach((tensor) => tensor.dispose());
  keptRankingLoss.dispose();
  keptOutcomeLoss.dispose();
  keptMeanMargin.dispose();
  if (evaluatorRequiresStructuredV2(model)) {
    disposeStructuredV2TensorInput(states);
  } else {
    states.dispose();
  }
  targets.dispose();
  targetMask.dispose();
  rankingWeights.dispose();
  outcomeWeights.dispose();
  return result;
}

export function evaluatorValueTrainingSamples(trajectories, options = {}) {
  const maximumActionPairs = Math.max(
    1,
    Math.floor(Number(options.maximumActionPairsPerDecision) || 8)
  );
  const maximumLeafPairs = Math.max(
    1,
    Math.floor(Number(options.maximumLeafPairsPerDecision) || 6)
  );
  const samples = [];
  for (const trajectory of trajectories || []) {
    for (const step of trajectory.steps || []) {
      const auditReference = step.actionRankingAuditReference;
      if (validActionRankingAuditReference(auditReference, {
        informationSetHash: step.informationSetHash,
        legalActionKeys: step.legalActionKeys
      })) {
        const evidenceAssessment = assessActionEvidence(auditReference, {
          role: options.certificationRole || options.role || "training",
          datasetContinuationPolicyHash:
            options.datasetContinuationPolicyHash,
          continuationLineage: options.continuationLineage,
          currentPolicyHash: options.currentPolicyHash,
          currentPolicyArtifactHash: options.currentPolicyArtifactHash,
          allowPolicyConditionedActorCorrection: false,
          minimumHighConfidenceEffect: options.minimumHighConfidenceEffect
        });
        if (evidenceAssessment.authorizedUses.policyQTraining) {
         for (const pair of evenlySpacedEvidencePairs(
          auditReference.evaluatorStatePairs,
          maximumActionPairs
        )) {
          const recommendedOutcome = Number(pair.recommendedOutcome);
          const selectedOutcome = Number(pair.selectedOutcome);
          if (pair.recommendedState?.length !== STATE_DIM
            || pair.selectedState?.length !== STATE_DIM
            || !Number.isFinite(recommendedOutcome)
            || !Number.isFinite(selectedOutcome)
            || recommendedOutcome === selectedOutcome) continue;
          const recommendedPreferred = recommendedOutcome > selectedOutcome;
          const recommendedStructuredState = validEvidenceStructuredState(
            pair.recommendedStructuredState,
            step,
            options
          ) ? pair.recommendedStructuredState : null;
          const selectedStructuredState = validEvidenceStructuredState(
            pair.selectedStructuredState,
            step,
            options
          ) ? pair.selectedStructuredState : null;
          samples.push({
            source: "terminal-action-ranking",
            gameId: trajectory.gameId || null,
            preferredState: Float32Array.from(
              recommendedPreferred
                ? pair.recommendedState
                : pair.selectedState
            ),
            comparedState: Float32Array.from(
              recommendedPreferred
                ? pair.selectedState
                : pair.recommendedState
            ),
            preferredStructuredState: recommendedPreferred
              ? recommendedStructuredState
              : selectedStructuredState,
            comparedStructuredState: recommendedPreferred
              ? selectedStructuredState
              : recommendedStructuredState,
            structuredV2Eligible: Boolean(
              recommendedStructuredState && selectedStructuredState
            ),
            informationSetHash: step.informationSetHash || null,
            evidenceAssessment,
            sampleWeight: evidenceAssessment.sampleWeight,
            phaseBand: String(
              auditReference.auditStratum?.phaseBand || "unknown"
            ),
            actionClass: String(
              auditReference.auditStratum?.actionClass || "unknown"
            ),
            deckSeat: evaluatorTrainingDeckSeat(trajectory),
            targetHead: auditReference.auditStratum?.phaseBand === "mulligan"
              ? "mulligan-q"
              : "general-action-q",
            preferredTarget: terminalAuditOutcomeValueTarget(
              recommendedPreferred
                ? recommendedOutcome
                : selectedOutcome
            ),
            comparedTarget: terminalAuditOutcomeValueTarget(
              recommendedPreferred
                ? selectedOutcome
                : recommendedOutcome
            )
          });
        }
        }
      }
      const actionReference = step.actionRankingReference;
      const validActionReference = validActionRankingReference(actionReference, {
        informationSetHash: step.informationSetHash,
        legalActionKeys: step.legalActionKeys
      });
      const leafReferences = [
        validIndependentLeafValueReference(step.leafValueAuditReference)
          ? step.leafValueAuditReference
          : null,
        validActionReference ? actionReference?.leafValueReference : null
      ].filter(validLeafValueReference);
      for (const reference of leafReferences) {
        // Training-only shadow Q under the explicitly recorded heuristic
        // continuation. This is not certified Q for the changing actor policy.
        // Regress both actions, including ties; conditioning on decisive wins
        // would systematically bias action values upwards.
        if (options.trainFixedContinuationShadowQ === true
          && options.certificationRole === "training"
          && trajectory.fixedShadowContinuation === "heuristic-only-v1"
          && validLeafActionEffectComparison(reference.actionEffectComparison)) {
          const pairs = evenlySpacedEvidencePairs(reference.actionEffectComparison.evaluatorStatePairs, maximumActionPairs);
          for (const pair of pairs) {
            if (pair.recommendedCaptureStep !== 0 || pair.selectedCaptureStep !== 0) continue;
            const preferredStructuredState = validEvidenceStructuredState(pair.recommendedStructuredState, step, options)
              ? pair.recommendedStructuredState : null;
            const comparedStructuredState = validEvidenceStructuredState(pair.selectedStructuredState, step, options)
              ? pair.selectedStructuredState : null;
            if (!preferredStructuredState || !comparedStructuredState) continue;
            samples.push({ source: "fixed-continuation-shadow-action-q",
              targetHead: reference.auditStratum?.phaseBand === "mulligan"
                ? EVALUATOR_TARGET_HEADS.mulliganQ : EVALUATOR_TARGET_HEADS.generalActionQ,
              sampleWeight: 1 / pairs.length, rankingWeight: 0,
              gameId: trajectory.gameId || null, phaseBand: reference.auditStratum?.phaseBand || "unknown",
              actionClass: reference.auditStratum?.actionClass || "unknown", deckSeat: evaluatorTrainingDeckSeat(trajectory),
              preferredState: Float32Array.from(pair.recommendedState), comparedState: Float32Array.from(pair.selectedState),
              preferredStructuredState, comparedStructuredState, structuredV2Eligible: true,
              informationSetHash: step.informationSetHash || null,
              preferredTarget: terminalAuditOutcomeValueTarget(pair.recommendedOutcome),
              comparedTarget: terminalAuditOutcomeValueTarget(pair.selectedOutcome) });
          }
        }
        for (const pair of evenlySpacedEvidencePairs(
          reference.pairs,
          maximumLeafPairs
        )) {
          if (pair.correctState?.length !== STATE_DIM
            || pair.comparedState?.length !== STATE_DIM) continue;
          samples.push({
            source: "terminal-leaf-ranking",
            targetHead: EVALUATOR_TARGET_HEADS.stateValue,
            sampleWeight: 1,
            gameId: trajectory.gameId || null,
            phaseBand: String(
              reference.auditStratum?.phaseBand || "unknown"
            ),
            actionClass: String(
              reference.auditStratum?.actionClass || "leaf-value"
            ),
            deckSeat: evaluatorTrainingDeckSeat(trajectory),
            preferredState: Float32Array.from(pair.correctState),
            comparedState: Float32Array.from(pair.comparedState),
            preferredStructuredState: validEvidenceStructuredState(
              pair.correctStructuredState,
              step,
              options
            ) ? pair.correctStructuredState : null,
            comparedStructuredState: validEvidenceStructuredState(
              pair.comparedStructuredState,
              step,
              options
            ) ? pair.comparedStructuredState : null,
            informationSetHash: step.informationSetHash || null,
            preferredTarget: terminalAuditOutcomeValueTarget(
              pair.correctOutcome
            ),
            comparedTarget: terminalAuditOutcomeValueTarget(
              pair.comparedOutcome
            )
          });
          const added = samples[samples.length - 1];
          added.structuredV2Eligible = Boolean(
            added.preferredStructuredState
              && added.comparedStructuredState
          );
        }
      }
    }
  }
  return samples;
}

export function createEvaluatorTrainingBalanceProfile(samples = [], options = {}) {
  const structuredV2Only = options.structuredV2Only === true;
  const eligible = structuredV2Only
    ? samples.filter((sample) => sample.structuredV2Eligible)
    : [...samples];
  const source = eligible.length ? eligible : [...samples];
  const groups = new Map();
  for (const sample of source) {
    const targetHead = normalizeEvaluatorTargetHead(sample.targetHead);
    if (!groups.has(targetHead)) {
      groups.set(targetHead, {
        samples: 0,
        phases: new Map(),
        deckSeats: new Map(),
        deckSeatPhases: new Map()
      });
    }
    const group = groups.get(targetHead);
    group.samples += 1;
    incrementCount(group.phases, sample.phaseBand || "unknown");
    incrementCount(group.deckSeats, sample.deckSeat || "unknown");
    incrementCount(
      group.deckSeatPhases,
      `${sample.deckSeat || "unknown"}::${sample.phaseBand || "unknown"}`
    );
  }
  return {
    version: 1,
    contract: "phase-deck-seat-inverse-frequency-gradient-balance-v1",
    structuredV2Only,
    samples: source.length,
    byTargetHead: Object.fromEntries([...groups.entries()].map(
      ([targetHead, group]) => [targetHead, {
        samples: group.samples,
        phaseWeights: inverseFrequencyWeights(group.phases),
        deckSeatWeights: inverseFrequencyWeights(group.deckSeats),
        deckSeatPhaseWeights: inverseFrequencyWeights(group.deckSeatPhases)
      }]
    ))
  };
}

export function applyEvaluatorTrainingBalanceProfile(
  samples = [],
  profile = null
) {
  if (!profile?.byTargetHead) return samples;
  return samples.map((sample) => {
    const targetHead = normalizeEvaluatorTargetHead(sample.targetHead);
    const group = profile.byTargetHead[targetHead] || {};
    const phaseWeight = Number(
      group.phaseWeights?.[sample.phaseBand || "unknown"]
    );
    const deckSeatWeight = Number(
      group.deckSeatWeights?.[sample.deckSeat || "unknown"]
    );
    const deckSeatPhaseWeight = Number(group.deckSeatPhaseWeights?.[
      `${sample.deckSeat || "unknown"}::${sample.phaseBand || "unknown"}`
    ]);
    const factors = [phaseWeight, deckSeatWeight, deckSeatPhaseWeight]
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!factors.length) return sample;
    const balanceWeight = Math.max(
      0.2,
      Math.min(1, Math.pow(
        factors.reduce((product, value) => product * value, 1),
        1 / factors.length
      ))
    );
    const baseWeight = Number.isFinite(Number(sample.sampleWeight))
      ? Math.max(0, Math.min(1, Number(sample.sampleWeight)))
      : 1;
    return {
      ...sample,
      sampleWeight: baseWeight * balanceWeight,
      balanceWeight
    };
  });
}

function evaluatorTrainingDeckSeat(trajectory) {
  return `${trajectory?.deckId || "unknown"}:${trajectory?.playerId || "unknown"}`;
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function inverseFrequencyWeights(counts) {
  const knownEntries = [...counts.entries()].filter(([key, value]) =>
    value > 0 && !String(key).split("::").includes("unknown"));
  const positive = knownEntries.map(([, value]) => value);
  const floor = positive.length ? Math.min(...positive) : 1;
  return Object.fromEntries([...counts.entries()].map(([key, count]) => [
    key,
    String(key).split("::").includes("unknown")
      ? 0.2
      : Math.max(0.2, Math.min(1, floor / Math.max(1, count)))
  ]));
}

/**
 * Turn statistically strong Q^pi action audits into a physically separate,
 * trust-region correction stream. Raw audit references remain inert inside
 * ordinary PPO batches; only this explicit derivation may connect a
 * policy-conditioned label to the actor, and only for the policy lineage that
 * generated the continuation outcomes.
 */
export function policyConditionedActionCorrectionTrajectories(
  trajectories,
  options = {}
) {
  if (options.enabled !== true || !options.currentPolicyHash) return [];
  const maximumCorrections = Math.max(
    0,
    Math.floor(Number(options.maximumCorrections) || 256)
  );
  const maximumPerPhase = Math.max(
    1,
    Math.floor(Number(options.maximumPerPhase) || 96)
  );
  const maximumPerDeckSeat = Math.max(
    1,
    Math.floor(Number(options.maximumPerDeckSeat) || 48)
  );
  const selectionState = options.selectionState || {};
  selectionState.total = Math.max(0, Number(selectionState.total) || 0);
  selectionState.byPhase ||= new Map();
  selectionState.byDeckSeat ||= new Map();
  const corrections = [];
  for (const trajectory of trajectories || []) {
    if (selectionState.total >= maximumCorrections) break;
    for (const parentStep of trajectory.steps || []) {
      if (selectionState.total >= maximumCorrections) break;
      const reference = parentStep.actionRankingAuditReference;
      if (!validActionRankingAuditReference(reference, {
        informationSetHash: parentStep.informationSetHash,
        legalActionKeys: parentStep.legalActionKeys
      })) continue;
      const assessment = assessActionEvidence(reference, {
        role: "training",
        datasetContinuationPolicyHash:
          options.datasetContinuationPolicyHash,
        continuationLineage: options.continuationLineage,
        currentPolicyHash: options.currentPolicyHash,
        currentPolicyArtifactHash: options.currentPolicyArtifactHash,
        allowPolicyConditionedActorCorrection: true,
        minimumHighConfidenceEffect: options.minimumHighConfidenceEffect
      });
      if (!assessment.authorizedUses.actorPreferenceTraining
        || assessment.authorizedUses.actorCorrectionMode
          !== "pi5-local-trust-region"
        || assessment.authorizedUses.requireAnchorKl !== true) continue;
      const correctIndex = Number(reference.correctIndex);
      const selectedIndex = Number(parentStep.selectedIndex);
      const legalCount = Number(parentStep.legalCount);
      const comparedIndex = Number(reference.comparedIndex);
      const legalActionKeys = parentStep.legalActionKeys;
      if (!Number.isInteger(correctIndex)
        || !Number.isInteger(selectedIndex)
        || !Number.isInteger(comparedIndex)
        || !Number.isInteger(legalCount)
        || correctIndex < 0
        || correctIndex >= legalCount
        || correctIndex === selectedIndex
        || comparedIndex !== selectedIndex
        || !Array.isArray(legalActionKeys)
        || legalActionKeys.length < legalCount
        || reference.correctActionKey !== legalActionKeys[correctIndex]
        || reference.comparedActionKey !== legalActionKeys[selectedIndex]
        || parentStep.state?.length !== STATE_DIM
        || parentStep.actions?.length < legalCount * ACTION_DIM
        || parentStep.actions?.length > MAX_ACTIONS * ACTION_DIM) continue;
      const phase = String(reference.auditStratum?.phaseBand || "unknown");
      const deckSeat = `${trajectory.deckId || "unknown"}:${trajectory.playerId || "unknown"}`;
      if ((selectionState.byPhase.get(phase) || 0) >= maximumPerPhase
        || (selectionState.byDeckSeat.get(deckSeat) || 0)
          >= maximumPerDeckSeat) continue;
      const maximumActorWeight = Math.min(
        0.35,
        Math.max(0, Number(
          assessment.authorizedUses.maximumActorWeight
        ) || 0)
      );
      const confidence = Math.min(
        maximumActorWeight,
        Math.max(0.05, Number(assessment.sampleWeight) * maximumActorWeight)
      );
      const finalLowerBound = Math.max(
        0,
        Number(reference.final?.lowerBound) || 0
      );
      const correctedStep = {
        ...parentStep,
        teacherIndex: correctIndex,
        teacherLabelVersion: TEACHER_LABEL_VERSION,
        teacherCorrectionEligible: true,
        teacherVerificationStatus: "verified",
        teacherPolicyEligible: true,
        teacherConfidence: confidence,
        teacherSelectedRegret: Math.min(1, finalLowerBound),
        teacherRankingMargin: Math.max(
          0.05,
          Math.min(0.35, finalLowerBound)
        ),
        imitation: true,
        source: "high-confidence-policy-conditioned-q",
        policyConditionedCorrection: {
          version: 1,
          mode: "pi5-local-trust-region",
          continuationModelHash: assessment.continuationModelHash,
          provenanceStatus: assessment.provenanceStatus,
          statisticalStrength: assessment.statisticalStrength,
          continuationScope: assessment.continuationScope,
          maximumActorWeight,
          anchorKlRequired: true
        }
      };
      corrections.push({
        ...trajectory,
        gameId:
          `${trajectory.gameId || "game"}:policy-q:${selectionState.total}`,
        imitation: true,
        policyConditionedCorrection: true,
        steps: [correctedStep]
      });
      selectionState.total += 1;
      selectionState.byPhase.set(
        phase,
        (selectionState.byPhase.get(phase) || 0) + 1
      );
      selectionState.byDeckSeat.set(
        deckSeat,
        (selectionState.byDeckSeat.get(deckSeat) || 0) + 1
      );
    }
  }
  return corrections;
}

function validEvidenceStructuredState(value, step, options = {}) {
  return validPublicStructuredEvidenceSnapshot(value, {
    engineFingerprint: options.engineFingerprint,
    informationSetHash: step?.informationSetHash
  });
}

export function terminalAuditOutcomeValueTarget(outcome) {
  const numeric = Number(outcome);
  if (numeric === 1) return 1;
  if (numeric === 0 || numeric === -1) return -1;
  return null;
}

function evenlySpacedEvidencePairs(pairs, maximum) {
  const values = Array.isArray(pairs) ? pairs : [];
  if (values.length <= maximum) return values;
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.floor(index * values.length / maximum)]);
}

export async function trainRecurrentPpo(model, trajectories, options = {}) {
  const epochs = Math.max(1, options.epochs || 4);
  const teacherConsumptionPolicy = options.teacherConsumptionPolicy || "strict-v8";
  if (!["record-only-v1", "strict-v8"].includes(teacherConsumptionPolicy)) {
    throw new Error(`Unsupported teacher consumption policy: ${teacherConsumptionPolicy}`);
  }
  const consumeTeacherSignals = teacherConsumptionPolicy === "strict-v8";
  const teacherRandom = options.teacherRandom || options.random || Math.random;
  const correctionLifecycleStep = Math.max(0,
    Number(options.correctionLifecycleStep
      ?? model.metadata?.trainingIteration
      ?? model.generation) || 0);
  const correctionLifecycleTtl = Math.max(1,
    Math.floor(Number(options.correctionLifecycleTtl) || 8));
  const resumeState = options.resumeState || null;
  const startEpoch = Math.max(0, Math.min(
    epochs,
    Number(options.startEpoch ?? resumeState?.startEpoch) || 0
  ));
  const learningRate = options.learningRate || 0.0003;
  if (options.enablePolicyConditionedActorCorrection === true
    && Array.isArray(options.policyConditionedCorrectionTrajectories)
    && options.policyConditionedCorrectionTrajectories.length
    && !(options.anchorModels || []).length) {
    throw new Error(
      "Policy-conditioned actor correction requires a frozen anchor model."
    );
  }
  let optimizer = options.optimizer || tf.train.adam(learningRate);
  // The provisional proposal head is intentionally optimized by a stateless,
  // dedicated optimizer. Reusing Adam with a different variable subset can
  // bind another layer's moment tensor to this head and would also couple its
  // optimizer state back into the deployed policy update path.
  const teacherProposalOptimizer = tf.train.sgd(
    options.teacherProposalLearningRate || learningRate
  );
  const chunks = chunkTrajectories(trajectories, options.sequenceLength || MAX_SEQUENCE);
  const auxiliaryTrajectories = options.auxiliaryTrajectories || [];
  const supervisionTrajectories = [...trajectories, ...auxiliaryTrajectories];
  const policyConditionedCorrectionFraction = Math.max(
    0,
    Math.min(0.2, Number(options.policyConditionedCorrectionFraction) || 0.15)
  );
  const rawPolicyConditionedCorrectionChunks = Array.isArray(
    options.policyConditionedCorrectionTrajectories
  )
    ? chunkTrajectories(
      options.policyConditionedCorrectionTrajectories,
      options.sequenceLength || MAX_SEQUENCE
    )
    : [];
  const policyConditionedCorrectionChunks = consumeTeacherSignals
    && options.enablePolicyConditionedActorCorrection === true
    ? rawPolicyConditionedCorrectionChunks.slice(
      0,
      Math.ceil(chunks.length * policyConditionedCorrectionFraction)
    )
    : [];
  const rawProofCorrectionChunks = provenCorrectionChunks(
    supervisionTrajectories,
    options.sequenceLength || MAX_SEQUENCE
  );
  const proofCorrectionChunks = consumeTeacherSignals ? rawProofCorrectionChunks : [];
  const rawMacroCorrectionChunks = teacherMacroDemonstrationChunks(
    supervisionTrajectories,
    options.sequenceLength || MAX_SEQUENCE
  ).map((chunk) => ({ ...chunk, correctionKind: "macro" }));
  const rawPostmortemCorrectionChunks = defeatPostmortemCorrectionChunks(
    supervisionTrajectories,
    options.sequenceLength || MAX_SEQUENCE
  ).map((chunk) => ({ ...chunk, correctionKind: "postmortem" }));
  const history = Array.isArray(resumeState?.history)
    ? structuredClone(resumeState.history)
    : [];
  const batchSize = Math.max(1, options.batchSize || 4);
  const teacherCorrectionFraction = Math.max(0, Math.min(0.5, options.teacherCorrectionFraction ?? 0.35));
  const rawVerifiedTeacherCorrectionChunks = verifiedTeacherCorrectionChunks(supervisionTrajectories)
    .map((chunk) => ({ ...chunk, correctionKind: "teacher" }));
  const rawLifecycleCorrectionChunks = [
    ...rawVerifiedTeacherCorrectionChunks,
    ...rawMacroCorrectionChunks,
    ...rawPostmortemCorrectionChunks
  ];
  const consumableLifecycleCorrectionChunks = consumeTeacherSignals
    ? rawLifecycleCorrectionChunks
    : [];
  const correctionLifecycleBefore = applyTeacherCorrectionLifecycle(
    model,
    consumableLifecycleCorrectionChunks,
    model.metadata?.teacherCorrectionLifecycle?.states,
    {
      lifecycleStep: correctionLifecycleStep,
      ttl: correctionLifecycleTtl
    }
  );
  const prioritizedCorrectionChunks = balancedCorrectionChunkOrder(
    correctionLifecycleBefore.chunks
    .filter((chunk) => chunk.correctionState !== "dormant")
    .map((chunk) => ({
      chunk,
      priority: unifiedCorrectionPriority(chunk)
    }))
    .filter((item) => item.priority > 0)
    .map((item) => ({ ...item.chunk, correctionPriority: item.priority })),
    teacherRandom
  );
  const correctionMassCap = selectCorrectionChunksWithCaps(
    prioritizedCorrectionChunks,
    chunks.length * teacherCorrectionFraction,
    options
  );
  const teacherCorrectionChunks = balancedCorrectionChunkOrder(
    correctionMassCap.chunks.filter((chunk) => chunk.correctionKind !== "postmortem"),
    teacherRandom
  );
  const balancedPostmortemCorrectionChunks = balancedCorrectionChunkOrder(
    correctionMassCap.chunks.filter((chunk) => chunk.correctionKind === "postmortem"),
    teacherRandom
  );
  const provisionalActionValueCoefficient = Math.min(
    0.15,
    Math.max(0, Number(options.provisionalActionValueCoefficient) || 0.08)
  );
  const verifiedActionValueCoefficient = options.teacherCorrectionActionValueCoefficient
    ?? Math.max(0.35, options.teacherActionValueCoefficient ?? 0.25);
  const rawRecordedProvisionalActionValueChunks = provisionalTeacherActionValueChunks(
    supervisionTrajectories
  );
  const rawProvisionalActionValueChunks = consumeTeacherSignals
    ? balancedCorrectionChunkOrder(
      rawRecordedProvisionalActionValueChunks,
      teacherRandom
    ).slice(0, Math.ceil(chunks.length * Math.min(
      0.25,
      Math.max(0, Number(options.provisionalActionValueFraction) || 0.15)
    )))
    : [];
  const provisionalMassCap = capProvisionalActionValueMass(
    rawProvisionalActionValueChunks,
    teacherCorrectionChunks,
    {
      maximumRatio: Math.min(0.15, Math.max(0,
        Number(options.provisionalVerifiedEffectiveMassRatio) || 0.15)),
      provisionalCoefficient: provisionalActionValueCoefficient,
      verifiedCoefficient: verifiedActionValueCoefficient
    }
  );
  const provisionalActionValueChunks = provisionalMassCap.chunks;
  const proofPolicyMass = Object.values(
    correctionEffectiveMassByKind(proofCorrectionChunks)
  ).reduce((sum, value) => sum + value, 0)
    * Math.max(0, Number(options.proofCoefficient ?? 0.7));
  const appliedCorrectionMass =
    correctionMassCap.report.appliedEffectiveMassByKind || {};
  const teacherPolicyCoefficient = Math.max(0, Number(
    options.teacherCorrectionCoefficient
      ?? Math.max(0.25, options.teacherCoefficient ?? 0.2)
  ));
  const postmortemCoefficient = Math.max(0, Number(
    Math.min(0.45, options.postmortemCoefficient
      ?? Math.max(0.25, options.teacherCoefficient ?? 0.2))
  ));
  const verifiedTeacherPolicyMass = (
    (Number(appliedCorrectionMass.teacher) || 0)
    + (Number(appliedCorrectionMass.macro) || 0)
  ) * teacherPolicyCoefficient;
  const postmortemPolicyMass = (Number(appliedCorrectionMass.postmortem) || 0)
    * postmortemCoefficient;
  const correctionEvidenceMass = correctionEffectiveMassByEvidence(
    correctionMassCap.chunks
  );
  const terminalConfirmedPolicyMass =
    ((Number(correctionEvidenceMass.terminalConfirmed.teacher) || 0)
      + (Number(correctionEvidenceMass.terminalConfirmed.macro) || 0))
      * teacherPolicyCoefficient
    + (Number(correctionEvidenceMass.terminalConfirmed.postmortem) || 0)
      * postmortemCoefficient;
  const certifiedEvaluatorPolicyMass =
    ((Number(correctionEvidenceMass.certifiedEvaluator.teacher) || 0)
      + (Number(correctionEvidenceMass.certifiedEvaluator.macro) || 0))
      * teacherPolicyCoefficient
    + (Number(correctionEvidenceMass.certifiedEvaluator.postmortem) || 0)
      * postmortemCoefficient;
  const provisionalAuxiliaryMass = Object.values(
    provisionalMassCap.report.appliedProvisionalByDeck || {}
  ).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const policyConditionedActorMass = policyConditionedCorrectionChunks
    .flatMap((chunk) => chunk.steps || [])
    .reduce((sum, step) =>
      sum + Math.max(0, Math.min(0.35, Number(step.teacherConfidence) || 0)), 0);
  const policyConnectedMass = {
    version: 2,
    proofPolicyMass,
    verifiedTeacherPolicyMass,
    postmortemPolicyMass,
    terminalConfirmedPolicyMass,
    certifiedEvaluatorPolicyMass,
    otherVerifiedPolicyMass: Math.max(
      0,
      verifiedTeacherPolicyMass + postmortemPolicyMass
        - terminalConfirmedPolicyMass - certifiedEvaluatorPolicyMass
    ),
    policyConditionedActorMass,
    provisionalAuxiliaryMass,
    totalPolicyConnectedMass:
      proofPolicyMass + verifiedTeacherPolicyMass + postmortemPolicyMass
        + policyConditionedActorMass
  };
  const regularBatchesPerEpoch = Math.ceil(chunks.length / batchSize);
  const proofCorrectionBatchesPerEpoch = Math.ceil(proofCorrectionChunks.length / batchSize);
  const teacherCorrectionBatchesPerEpoch = Math.ceil(teacherCorrectionChunks.length / batchSize);
  const policyConditionedCorrectionBatchesPerEpoch = Math.ceil(
    policyConditionedCorrectionChunks.length / batchSize
  );
  const provisionalActionValueBatchesPerEpoch = Math.ceil(provisionalActionValueChunks.length / batchSize);
  const postmortemCorrectionBatchesPerEpoch = Math.ceil(balancedPostmortemCorrectionChunks.length / batchSize);
  const batchesPerEpoch = regularBatchesPerEpoch
    + proofCorrectionBatchesPerEpoch
    + teacherCorrectionBatchesPerEpoch
    + policyConditionedCorrectionBatchesPerEpoch
    + provisionalActionValueBatchesPerEpoch
    + postmortemCorrectionBatchesPerEpoch;
  const gradientConflictDiagnostics = options.gradientConflictDiagnostics === true
    ? collectGradientConflictDiagnostics(model, optimizer, {
      ppo: chunks,
      // Diagnostics are deliberately based on the raw recorded labels. Run A
      // must not train on them, but it still needs an optimizer-free view of
      // the gradients those labels would have produced.
      teacher: [...rawVerifiedTeacherCorrectionChunks, ...rawMacroCorrectionChunks],
      postmortem: rawPostmortemCorrectionChunks
    }, options)
    : null;
  const epochGuards = Array.isArray(resumeState?.epochGuards)
    ? structuredClone(resumeState.epochGuards)
    : [];
  let acceptedEpochs = Math.max(
    startEpoch,
    Number(resumeState?.acceptedEpochs) || 0
  );
  const baselineScore = Number(options.baselineSelectionScore);
  const baselineTieBreakerScore = Number(options.baselineTieBreakerScore);
  let bestEpoch = Number.isFinite(Number(resumeState?.bestEpoch))
    ? Number(resumeState.bestEpoch)
    : Number.isFinite(baselineScore) ? 0 : null;
  let bestEpochScore = Number.isFinite(Number(resumeState?.bestEpochScore))
    ? Number(resumeState.bestEpochScore)
    : Number.isFinite(baselineScore) ? baselineScore : Number.NEGATIVE_INFINITY;
  let bestEpochTieBreakerScore = Number.isFinite(Number(resumeState?.bestEpochTieBreakerScore))
    ? Number(resumeState.bestEpochTieBreakerScore)
    : Number.isFinite(baselineTieBreakerScore)
      ? baselineTieBreakerScore
      : Number.NEGATIVE_INFINITY;
  let bestEpochSnapshot = resumeState?.bestModelWeightSnapshot
    ? deserializeModelWeightSnapshot(resumeState.bestModelWeightSnapshot)
    : Number.isFinite(baselineScore) ? snapshotModelWeights(model) : null;
  let bestEpochOptimizerState = resumeState?.bestOptimizerState
    || (Number.isFinite(baselineScore)
      ? await serializeOptimizer(optimizer, model.generation)
      : null);
  let bestEpochRandomState = resumeState?.bestRandomState
    ?? options.random?.getState?.()
    ?? null;
  const finalSelectionBaselineSnapshot = resumeState?.finalSelectionBaselineSnapshot
    ? deserializeModelWeightSnapshot(resumeState.finalSelectionBaselineSnapshot)
    : typeof options.finalEpochSelector === "function" && Number.isFinite(baselineScore)
      ? snapshotModelWeights(options.finalSelectionBaselineModel || model)
      : null;
  const finalSelectionBaselineOptimizerState = resumeState?.finalSelectionBaselineOptimizerState
    || options.finalSelectionBaselineOptimizerState
    || (finalSelectionBaselineSnapshot && startEpoch === 0
      ? await serializeOptimizer(optimizer, model.generation)
      : null);
  const finalSelectionBaselineRandomState = resumeState?.finalSelectionBaselineRandomState
    ?? options.finalSelectionBaselineRandomState
    ?? (finalSelectionBaselineSnapshot && startEpoch === 0
      ? options.random?.getState?.() ?? null
      : null);
  const earlyStoppingPatience = Math.max(0, Math.floor(Number(options.earlyStoppingPatience) || 0));
  const minimumEpochsBeforeEarlyStopping = Math.max(
    0,
    Math.min(epochs, Math.floor(Number(options.minimumEpochsBeforeEarlyStopping) || 0))
  );
  const minimumScoreImprovement = Math.max(0, Number(options.minimumScoreImprovement) || 0);
  const selectionTieTolerance = Math.max(
    minimumScoreImprovement,
    Number(options.selectionTieTolerance) || 0.01
  );
  const minimumTieBreakerImprovement = Math.max(
    0,
    Number(options.minimumTieBreakerImprovement) || 0.0005
  );
  let epochsWithoutImprovement = Math.max(
    0,
    Number(resumeState?.epochsWithoutImprovement) || 0
  );
  let stoppedEarly = false;
  let stopReason = null;
  const epochSelectionCandidates = Array.isArray(resumeState?.epochSelectionCandidates)
    ? resumeState.epochSelectionCandidates.map(deserializeEpochSelectionCandidate)
    : [];
  let finalEpochConfirmations = Array.isArray(resumeState?.finalEpochConfirmations)
    ? structuredClone(resumeState.finalEpochConfirmations)
    : [];
  for (let epoch = startEpoch; epoch < epochs; epoch += 1) {
    const scheduledAnchorCoefficient = typeof options.anchorCoefficientForEpoch === "function"
      ? options.anchorCoefficientForEpoch({
        epoch: epoch + 1,
        epochs,
        defaultCoefficient: options.anchorCoefficient ?? 0.03
      })
      : options.anchorCoefficient;
    const epochOptions = {
      ...options,
      anchorCoefficient: Number.isFinite(Number(scheduledAnchorCoefficient))
        ? Math.max(0, Number(scheduledAnchorCoefficient))
        : (options.anchorCoefficient ?? 0.03)
    };
    const snapshot = options.epochGuard ? snapshotModelWeights(model) : null;
    const optimizerSnapshot = options.epochGuard
      ? await serializeOptimizer(optimizer, model.generation)
      : null;
    const randomSnapshot = options.random?.getState?.() ?? null;
    const epochChunks = options.stratified === false
      ? shuffle([...chunks], options.random || Math.random)
      : stratifiedChunkOrder(chunks, options.random || Math.random);
    const epochProofCorrectionChunks = shuffle([...proofCorrectionChunks], teacherRandom);
    const epochTeacherCorrectionChunks = balancedCorrectionChunkOrder(
      teacherCorrectionChunks,
      teacherRandom
    );
    const epochPolicyConditionedCorrectionChunks = balancedCorrectionChunkOrder(
      policyConditionedCorrectionChunks,
      teacherRandom
    );
    const epochProvisionalActionValueChunks = balancedCorrectionChunkOrder(
      provisionalActionValueChunks,
      teacherRandom
    );
    const epochPostmortemCorrectionChunks = balancedCorrectionChunkOrder(
      balancedPostmortemCorrectionChunks,
      teacherRandom
    );
    let batchIndex = 0;
    for (let start = 0; start < epochProofCorrectionChunks.length; start += batchSize) {
      const batch = packPpoBatch(epochProofCorrectionChunks.slice(start, start + batchSize));
      const metrics = {
        epoch: epoch + 1,
        phase: "proof-correction",
        ...trainPpoBatch(model, batch, optimizer, {
          ...epochOptions,
          policyCoefficient: 0,
          valueCoefficient: 0,
          actionValueCoefficient: 0,
          beliefCoefficient: 0,
          entropyCoefficient: 0,
          teacherCoefficient: options.proofCoefficient ?? 0.7,
          teacherDistillationCoefficient: options.proofDistillationCoefficient ?? 0.25,
          teacherRankingCoefficient: options.proofRankingCoefficient ?? 0.75,
          teacherActionValueCoefficient: options.proofActionValueCoefficient ?? 0.55,
          anchorCoefficient: options.proofAnchorCoefficient
            ?? epochOptions.anchorCoefficient
            ?? 0.03
        })
      };
      history.push(metrics);
      batchIndex += 1;
      options.onBatch?.({
        epoch: epoch + 1,
        epochs,
        phase: metrics.phase,
        batch: batchIndex,
        batchesPerEpoch,
        completedBatches: epoch * batchesPerEpoch + batchIndex,
        totalBatches: epochs * batchesPerEpoch,
        metrics
      });
    }
    for (let start = 0; start < epochTeacherCorrectionChunks.length; start += batchSize) {
      const batch = packPpoBatch(epochTeacherCorrectionChunks.slice(start, start + batchSize));
      const metrics = {
        epoch: epoch + 1,
        phase: "teacher-correction",
        ...trainPpoBatch(model, batch, optimizer, {
          ...epochOptions,
          policyCoefficient: 0,
          valueCoefficient: 0,
          actionValueCoefficient: 0,
          beliefCoefficient: 0,
          entropyCoefficient: 0,
          teacherCoefficient: options.teacherCorrectionCoefficient ?? Math.max(0.25, options.teacherCoefficient ?? 0.2),
          teacherDistillationCoefficient: options.teacherCorrectionDistillationCoefficient ?? 0.15,
          teacherRankingCoefficient: options.teacherCorrectionRankingCoefficient
            ?? Math.max(0.4, options.teacherRankingCoefficient ?? 0.3),
          teacherActionValueCoefficient: options.teacherCorrectionActionValueCoefficient
            ?? Math.max(0.35, options.teacherActionValueCoefficient ?? 0.25),
          anchorCoefficient: options.teacherCorrectionAnchorCoefficient
            ?? epochOptions.anchorCoefficient
            ?? 0.03
        })
      };
      history.push(metrics);
      batchIndex += 1;
      options.onBatch?.({
        epoch: epoch + 1,
        epochs,
        phase: metrics.phase,
        batch: batchIndex,
        batchesPerEpoch,
        completedBatches: epoch * batchesPerEpoch + batchIndex,
        totalBatches: epochs * batchesPerEpoch,
        metrics
      });
    }
    for (let start = 0;
      start < epochPolicyConditionedCorrectionChunks.length;
      start += batchSize) {
      const batch = packPpoBatch(
        epochPolicyConditionedCorrectionChunks.slice(start, start + batchSize)
      );
      const metrics = {
        epoch: epoch + 1,
        phase: "policy-conditioned-q-correction",
        ...trainPpoBatch(model, batch, optimizer, {
          ...epochOptions,
          policyCoefficient: 0,
          valueCoefficient: 0,
          actionValueCoefficient: 0,
          beliefCoefficient: 0,
          entropyCoefficient: 0,
          teacherCoefficient: Math.min(
            0.35,
            Math.max(0, Number(
              options.policyConditionedCorrectionCoefficient
            ) || 0.3)
          ),
          teacherDistillationCoefficient: 0,
          teacherRankingCoefficient: Math.min(
            0.35,
            Math.max(0, Number(
              options.policyConditionedCorrectionRankingCoefficient
            ) || 0.3)
          ),
          teacherActionValueCoefficient: 0,
          anchorCoefficient: Math.max(
            0.05,
            Number(options.policyConditionedCorrectionAnchorCoefficient)
              || Number(epochOptions.anchorCoefficient)
              || 0.05
          )
        })
      };
      history.push(metrics);
      batchIndex += 1;
      options.onBatch?.({
        epoch: epoch + 1,
        epochs,
        phase: metrics.phase,
        batch: batchIndex,
        batchesPerEpoch,
        completedBatches: epoch * batchesPerEpoch + batchIndex,
        totalBatches: epochs * batchesPerEpoch,
        metrics
      });
    }
    for (let start = 0; start < epochPostmortemCorrectionChunks.length; start += batchSize) {
      const batch = packPpoBatch(epochPostmortemCorrectionChunks.slice(start, start + batchSize));
      const metrics = {
        epoch: epoch + 1,
        phase: "postmortem-correction",
        ...trainPpoBatch(model, batch, optimizer, {
          ...epochOptions,
          policyCoefficient: 0,
          valueCoefficient: 0,
          actionValueCoefficient: 0,
          beliefCoefficient: 0,
          entropyCoefficient: 0,
          teacherCoefficient: Math.min(0.45, options.postmortemCoefficient
            ?? Math.max(0.25, options.teacherCoefficient ?? 0.2)),
          teacherDistillationCoefficient: options.postmortemDistillationCoefficient ?? 0.15,
          teacherRankingCoefficient: Math.min(0.55, options.postmortemRankingCoefficient
            ?? Math.max(0.4, options.teacherRankingCoefficient ?? 0.3)),
          teacherActionValueCoefficient: Math.min(0.5, options.postmortemActionValueCoefficient
            ?? Math.max(0.35, options.teacherActionValueCoefficient ?? 0.25)),
          anchorCoefficient: options.postmortemAnchorCoefficient
            ?? epochOptions.anchorCoefficient
            ?? 0.03
        })
      };
      history.push(metrics);
      batchIndex += 1;
      options.onBatch?.({
        epoch: epoch + 1,
        epochs,
        phase: metrics.phase,
        batch: batchIndex,
        batchesPerEpoch,
        completedBatches: epoch * batchesPerEpoch + batchIndex,
        totalBatches: epochs * batchesPerEpoch,
        metrics
      });
    }
    for (let start = 0; start < epochChunks.length; start += batchSize) {
      const batch = packPpoBatch(
        epochChunks.slice(start, start + batchSize),
        { ignoreCorrectionSignals: !consumeTeacherSignals }
      );
      const metrics = {
        epoch: epoch + 1,
        phase: "ppo",
        ...trainPpoBatch(model, batch, optimizer, {
          ...epochOptions,
          // Teacher supervision is deliberately absent from ordinary PPO.
          // Verified proof/teacher/postmortem decisions are trained only in
          // their physically separate correction batches above.
          teacherCoefficient: 0,
          teacherPolicyPreferenceCoefficient: 0,
          teacherRankingCoefficient: 0,
          teacherActionValueCoefficient: 0
        })
      };
      history.push(metrics);
      batchIndex += 1;
      options.onBatch?.({
        epoch: epoch + 1,
        epochs,
        phase: metrics.phase,
        batch: batchIndex,
        batchesPerEpoch,
        completedBatches: epoch * batchesPerEpoch + batchIndex,
        totalBatches: epochs * batchesPerEpoch,
        metrics
      });
    }
    // Fit the isolated proposal head after all shared GRU/action embeddings
    // have settled for this epoch. This keeps its next-generation
    // confirmation priorities aligned without connecting it to policy logits.
    for (let start = 0; start < epochProvisionalActionValueChunks.length; start += batchSize) {
      const batch = packPpoBatch(epochProvisionalActionValueChunks.slice(start, start + batchSize));
      const metrics = {
        epoch: epoch + 1,
        phase: "provisional-action-value",
        ...trainTeacherProposalValueBatch(model, batch, teacherProposalOptimizer, {
          coefficient: provisionalActionValueCoefficient
        })
      };
      history.push(metrics);
      batchIndex += 1;
      options.onBatch?.({
        epoch: epoch + 1,
        epochs,
        phase: metrics.phase,
        batch: batchIndex,
        batchesPerEpoch,
        completedBatches: epoch * batchesPerEpoch + batchIndex,
        totalBatches: epochs * batchesPerEpoch,
        metrics
      });
    }
    const epochMetrics = aggregateMetrics(history.filter((item) => item.epoch === epoch + 1));
    const guard = options.epochGuard?.({ epoch: epoch + 1, epochs, model, metrics: epochMetrics }) ?? { passed: true };
    const passed = guard !== false && guard?.passed !== false;
    const epochGuard = { epoch: epoch + 1, passed, ...(typeof guard === "object" ? guard : {}) };
    epochGuards.push(epochGuard);
    if (!passed && snapshot) {
      restoreModelWeights(model, snapshot);
      disposeModelWeights(snapshot);
      optimizer.dispose();
      optimizer = await restoreAdamOptimizer(optimizerSnapshot, learningRate);
      if (randomSnapshot != null) options.random?.setState?.(randomSnapshot);
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].epoch === epoch + 1) history.splice(index, 1);
      }
      await options.onEpochCheckpoint?.({
        epoch: epoch + 1,
        epochs,
        accepted: false,
        selected: false,
        guard: epochGuard,
        metrics: epochMetrics,
        optimizerState: await serializeOptimizer(optimizer, model.generation),
        randomState: options.random?.getState?.() ?? null,
        selectionState: epochResumeSelectionState({
          startEpoch: epoch,
          acceptedEpochs,
          epochGuards,
          history,
          bestEpoch,
          bestEpochScore,
          bestEpochTieBreakerScore,
          bestEpochSnapshot,
          bestEpochOptimizerState,
          bestEpochRandomState,
          epochsWithoutImprovement,
          epochSelectionCandidates,
          finalEpochConfirmations,
          finalSelectionBaselineSnapshot,
          finalSelectionBaselineOptimizerState,
          finalSelectionBaselineRandomState
        })
      });
      await options.onEpoch?.({ epoch: epoch + 1, epochs, accepted: false, guard, metrics: epochMetrics });
      break;
    }
    acceptedEpochs += 1;
    if (snapshot) disposeModelWeights(snapshot);
    const epochScore = Number(guard?.score);
    const epochTieBreakerScore = Number(guard?.tieBreakerScore);
    const primaryImproved = Number.isFinite(epochScore)
      && epochScore > bestEpochScore + minimumScoreImprovement;
    const primaryTied = Number.isFinite(epochScore)
      && Math.abs(epochScore - bestEpochScore) <= selectionTieTolerance;
    const tieBreakerImproved = Number.isFinite(epochTieBreakerScore)
      && epochTieBreakerScore > bestEpochTieBreakerScore + minimumTieBreakerImprovement;
    const improved = options.selectBestEpoch
      && guard?.selectionEligible !== false
      && (primaryImproved || (primaryTied && tieBreakerImproved));
    if (improved) {
      if (bestEpochSnapshot) disposeModelWeights(bestEpochSnapshot);
      bestEpochSnapshot = snapshotModelWeights(model);
      bestEpochScore = epochScore;
      bestEpochTieBreakerScore = Number.isFinite(epochTieBreakerScore)
        ? epochTieBreakerScore
        : bestEpochTieBreakerScore;
      bestEpochOptimizerState = await serializeOptimizer(optimizer, model.generation);
      bestEpochRandomState = options.random?.getState?.() ?? null;
      bestEpoch = epoch + 1;
      epochsWithoutImprovement = 0;
      epochGuard.best = true;
    } else if (options.selectBestEpoch && Number.isFinite(epochScore)) {
      epochsWithoutImprovement += 1;
      epochGuard.best = false;
    }
    // The per-epoch practical suite is a small development screen. It may
    // prioritize candidates, but it must not prevent a retention-safe epoch
    // from reaching the independent top-two confirmation merely because a
    // noisy 40-game score missed the soft screen floor.
    if (options.selectBestEpoch
      && guard?.passed !== false
      && Number.isFinite(epochScore)) {
      epochSelectionCandidates.push({
        epoch: epoch + 1,
        score: epochScore,
        tieBreakerScore: Number.isFinite(epochTieBreakerScore)
          ? epochTieBreakerScore
          : Number.NEGATIVE_INFINITY,
        guard: structuredClone({
          ...epochGuard,
          screeningEligible: guard?.selectionEligible !== false
        }),
        snapshot: snapshotModelWeights(model),
        optimizerState: await serializeOptimizer(optimizer, model.generation),
        randomState: options.random?.getState?.() ?? null
      });
      epochSelectionCandidates.sort(compareEpochSelectionCandidates);
      while (epochSelectionCandidates.length > 2) {
        disposeModelWeights(epochSelectionCandidates.pop().snapshot);
      }
    }
    await options.onEpochCheckpoint?.({
      epoch: epoch + 1,
      epochs,
      accepted: true,
      selected: improved,
      guard: epochGuard,
      metrics: epochMetrics,
      optimizerState: await serializeOptimizer(optimizer, model.generation),
      randomState: options.random?.getState?.() ?? null,
      selectionState: epochResumeSelectionState({
        startEpoch: epoch + 1,
        acceptedEpochs,
        epochGuards,
        history,
        bestEpoch,
        bestEpochScore,
        bestEpochTieBreakerScore,
        bestEpochSnapshot,
        bestEpochOptimizerState,
        bestEpochRandomState,
        epochsWithoutImprovement,
        epochSelectionCandidates,
        finalEpochConfirmations,
        finalSelectionBaselineSnapshot,
        finalSelectionBaselineOptimizerState,
        finalSelectionBaselineRandomState
      })
    });
    await options.onEpoch?.({ epoch: epoch + 1, epochs, accepted: true, guard, metrics: epochMetrics });
    if (earlyStoppingPatience > 0
      && acceptedEpochs >= minimumEpochsBeforeEarlyStopping
      && epochsWithoutImprovement >= earlyStoppingPatience) {
      stoppedEarly = true;
      stopReason = "selection-score-plateau";
      break;
    }
  }
  let finalSelectorChangedModel = false;
  let finalEpochAudit = resumeState?.finalEpochAudit
    ? structuredClone(resumeState.finalEpochAudit)
    : null;
  if (typeof options.finalEpochSelector === "function" && epochSelectionCandidates.length) {
    for (const item of epochSelectionCandidates) {
      const existingConfirmation = finalEpochConfirmations.find((confirmation) =>
        Number(confirmation.epoch) === Number(item.epoch));
      if (existingConfirmation) continue;
      restoreModelWeights(model, item.snapshot);
      finalSelectorChangedModel = true;
      const confirmation = await options.finalEpochSelector({
        epoch: item.epoch,
        model,
        guard: item.guard
      });
      finalEpochConfirmations.push({
        epoch: item.epoch,
        preliminaryScore: item.score,
        preliminaryTieBreakerScore: item.tieBreakerScore,
        ...(confirmation || {})
      });
      await options.onFinalSelectionCheckpoint?.({
        stage: "candidate-confirmation",
        epoch: item.epoch,
        candidate: item,
        optimizerState: item.optimizerState,
        randomState: item.randomState,
        selectionState: epochResumeSelectionState({
          startEpoch: acceptedEpochs,
          acceptedEpochs,
          epochGuards,
          history,
          bestEpoch,
          bestEpochScore,
          bestEpochTieBreakerScore,
          bestEpochSnapshot,
          bestEpochOptimizerState,
          bestEpochRandomState,
          epochsWithoutImprovement,
          epochSelectionCandidates,
          finalEpochConfirmations,
          finalEpochAudit,
          finalSelectionBaselineSnapshot,
          finalSelectionBaselineOptimizerState,
          finalSelectionBaselineRandomState
        })
      });
    }
    const eligibleConfirmations = finalEpochConfirmations
      .filter((item) => item.selectionEligible !== false && Number.isFinite(Number(item.score)))
      .sort((left, right) =>
        Number(right.score) - Number(left.score)
          || Number(right.tieBreakerScore || Number.NEGATIVE_INFINITY)
            - Number(left.tieBreakerScore || Number.NEGATIVE_INFINITY));
    const winner = eligibleConfirmations[0];
    const beatsBaseline = winner && (
      !Number.isFinite(baselineScore)
      || Number(winner.score) > baselineScore + minimumScoreImprovement
      || (Math.abs(Number(winner.score) - baselineScore) <= selectionTieTolerance
        && Number(winner.tieBreakerScore) > baselineTieBreakerScore + minimumTieBreakerImprovement)
    );
    let auditAccepted = true;
    let selected = null;
    if (beatsBaseline) {
      selected = epochSelectionCandidates.find((item) => item.epoch === winner.epoch);
      if (selected) {
        restoreModelWeights(model, selected.snapshot);
        if (finalEpochAudit && Number(finalEpochAudit.epoch) === Number(selected.epoch)) {
          auditAccepted = finalEpochAudit.selectionEligible !== false
            && Number.isFinite(Number(finalEpochAudit.score))
            && (
              !Number.isFinite(baselineScore)
              || Number(finalEpochAudit.score) > baselineScore + minimumScoreImprovement
              || (Math.abs(Number(finalEpochAudit.score) - baselineScore) <= selectionTieTolerance
                && Number(finalEpochAudit.tieBreakerScore)
                  > baselineTieBreakerScore + minimumTieBreakerImprovement)
            );
        } else if (typeof options.finalEpochAuditor === "function") {
          const audit = await options.finalEpochAuditor({
            epoch: selected.epoch,
            model,
            guard: selected.guard,
            confirmation: winner
          });
          finalEpochAudit = {
            epoch: selected.epoch,
            ...(audit || {})
          };
          auditAccepted = finalEpochAudit.selectionEligible !== false
            && Number.isFinite(Number(finalEpochAudit.score))
            && (
              !Number.isFinite(baselineScore)
              || Number(finalEpochAudit.score) > baselineScore + minimumScoreImprovement
              || (Math.abs(Number(finalEpochAudit.score) - baselineScore) <= selectionTieTolerance
                && Number(finalEpochAudit.tieBreakerScore)
                  > baselineTieBreakerScore + minimumTieBreakerImprovement)
            );
          await options.onFinalSelectionCheckpoint?.({
            stage: "final-audit",
            epoch: selected.epoch,
            candidate: selected,
            optimizerState: selected.optimizerState,
            randomState: selected.randomState,
            finalEpochAudit,
            selectionState: epochResumeSelectionState({
              startEpoch: acceptedEpochs,
              acceptedEpochs,
              epochGuards,
              history,
              bestEpoch,
              bestEpochScore,
              bestEpochTieBreakerScore,
              bestEpochSnapshot,
              bestEpochOptimizerState,
              bestEpochRandomState,
              epochsWithoutImprovement,
              epochSelectionCandidates,
              finalEpochConfirmations,
              finalEpochAudit,
              finalSelectionBaselineSnapshot,
              finalSelectionBaselineOptimizerState,
              finalSelectionBaselineRandomState
            })
          });
        }
        if (auditAccepted) {
          if (bestEpochSnapshot) disposeModelWeights(bestEpochSnapshot);
          bestEpochSnapshot = snapshotModelWeights(model);
          bestEpochOptimizerState = selected.optimizerState;
          bestEpochRandomState = selected.randomState;
          bestEpoch = selected.epoch;
          bestEpochScore = Number(finalEpochAudit?.score ?? winner.score);
          bestEpochTieBreakerScore = Number(
            finalEpochAudit?.tieBreakerScore ?? winner.tieBreakerScore
          );
        }
      }
      if (!selected) auditAccepted = false;
    }
    if ((!beatsBaseline || !auditAccepted)
      && Number.isFinite(baselineScore)
      && finalSelectionBaselineSnapshot) {
      restoreModelWeights(model, finalSelectionBaselineSnapshot);
      if (bestEpochSnapshot) disposeModelWeights(bestEpochSnapshot);
      bestEpochSnapshot = snapshotModelWeights(model);
      bestEpochOptimizerState = finalSelectionBaselineOptimizerState;
      bestEpochRandomState = finalSelectionBaselineRandomState;
      bestEpoch = 0;
      bestEpochScore = baselineScore;
      bestEpochTieBreakerScore = baselineTieBreakerScore;
    }
  }
  const selectedEpoch = bestEpoch ?? acceptedEpochs;
  if (bestEpochSnapshot) {
    if (bestEpoch !== acceptedEpochs || finalSelectorChangedModel) {
      restoreModelWeights(model, bestEpochSnapshot);
      optimizer.dispose();
      optimizer = await restoreAdamOptimizer(bestEpochOptimizerState, learningRate);
      if (bestEpochRandomState != null) options.random?.setState?.(bestEpochRandomState);
    }
    disposeModelWeights(bestEpochSnapshot);
  }
  for (const item of epochSelectionCandidates) disposeModelWeights(item.snapshot);
  if (finalSelectionBaselineSnapshot) disposeModelWeights(finalSelectionBaselineSnapshot);
  if (selectedEpoch > 0) model.generation += 1;
  const observedGames = options.gamesObserved
    ?? (new Set(trajectories.map((trajectory) => trajectory.gameId).filter(Boolean)).size || Math.ceil(trajectories.length / 2));
  if (selectedEpoch > 0) model.gamesTrained += observedGames;
  const calibrationTrajectories = options.calibrationFitTrajectories?.length
    ? options.calibrationFitTrajectories
    : options.calibrationTrajectories?.length
      ? options.calibrationTrajectories
      : trajectories;
  // Re-run the now-trained value head on held-out states. Calibrating the
  // values stored during collection would fit the previous model instead.
  model.calibration = options.calibrationTestTrajectories?.length
    ? evaluateValueCalibration(
      model,
      calibrationTrajectories,
      options.calibrationTestTrajectories,
      { batchSize: options.calibrationBatchSize || 8 }
    )
    : evaluateBehaviorCloning(model, calibrationTrajectories, {
      batchSize: options.calibrationBatchSize || 8
    }).calibration;
  const selectedHistory = history.filter((item) => item.epoch <= selectedEpoch);
  const correctionLifecycleAfter = applyTeacherCorrectionLifecycle(
    model,
    consumableLifecycleCorrectionChunks,
    correctionLifecycleBefore.states,
    {
      lifecycleStep: correctionLifecycleStep,
      ttl: correctionLifecycleTtl
    }
  );
  model.metadata = {
    ...model.metadata,
    algorithm: "recurrent-ppo-belief-isolated-teacher-proposal",
    trainedAt: new Date().toISOString(),
    epochs: selectedEpoch,
    requestedEpochs: epochs,
    acceptedEpochs,
    selectedEpoch,
    baselineSelected: selectedEpoch === 0 && Number.isFinite(baselineScore),
    baselineSelectionScore: Number.isFinite(baselineScore) ? baselineScore : null,
    selectedEpochScore: Number.isFinite(bestEpochScore) ? bestEpochScore : null,
    selectedEpochTieBreakerScore: Number.isFinite(bestEpochTieBreakerScore)
      ? bestEpochTieBreakerScore
      : null,
    selectionTieTolerance,
    minimumTieBreakerImprovement,
    earlyStoppingPatience,
    minimumEpochsBeforeEarlyStopping,
    minimumScoreImprovement,
    stoppedEarly,
    stopReason,
    finalEpochConfirmations,
    finalEpochAudit,
    trajectories: trajectories.length,
    meanLoss: mean(selectedHistory.map((item) => item.loss)),
    meanEntropy: mean(selectedHistory.map((item) => item.entropy)),
    meanTeacherRankingLoss: mean(selectedHistory.map((item) => item.teacherRankingLoss).filter(Number.isFinite)),
    meanTeacherActionValueLoss: mean(selectedHistory.map((item) => item.teacherActionValueLoss).filter(Number.isFinite)),
    meanAnchorKl: mean(selectedHistory.map((item) => item.anchorKl).filter(Number.isFinite)),
    teacherConsumptionPolicy,
    teacherSignalsConsumed: consumeTeacherSignals,
    recordedTeacherSignals: {
      proofChunks: rawProofCorrectionChunks.length,
      verifiedChunks: rawVerifiedTeacherCorrectionChunks.length,
      macroChunks: rawMacroCorrectionChunks.length,
      postmortemChunks: rawPostmortemCorrectionChunks.length,
      provisionalActionValueChunks: rawRecordedProvisionalActionValueChunks.length
    },
    teacherCorrectionFraction,
    policyConditionedCorrectionFraction,
    policyConditionedCorrectionChunks:
      policyConditionedCorrectionChunks.length,
    policyConditionedCorrectionSteps:
      policyConditionedCorrectionChunks.reduce((sum, chunk) =>
        sum + (chunk.steps?.length || 0), 0),
    proofCorrectionChunks: proofCorrectionChunks.length,
    teacherCorrectionChunks: teacherCorrectionChunks.length,
    teacherCorrectionSteps: teacherCorrectionChunks.reduce((sum, chunk) =>
      sum + (chunk.steps?.length || 0), 0),
    teacherMacroCorrectionChunks: rawMacroCorrectionChunks.length,
    provisionalActionValueChunks: provisionalActionValueChunks.length,
    postmortemCorrectionChunks: balancedPostmortemCorrectionChunks.length,
    correctionBalance: {
      version: 2,
      teacher: summarizeCorrectionStrata(teacherCorrectionChunks),
      unifiedVerifiedCorrections: {
        raw: summarizeCorrectionStrata(rawLifecycleCorrectionChunks),
        applied: summarizeCorrectionStrata(correctionMassCap.chunks),
        effectiveMassCap: correctionMassCap.report
      },
      provisionalActionValue: {
        ...summarizeCorrectionStrata(provisionalActionValueChunks),
        effectiveMassCap: provisionalMassCap.report
      },
      postmortem: summarizeCorrectionStrata(balancedPostmortemCorrectionChunks),
      policyConnectedMass
    },
    gradientConflictDiagnostics,
    teacherCorrectionLifecycle: {
      version: 3,
      ttl: correctionLifecycleAfter.ttl,
      lifecycleStep: correctionLifecycleAfter.lifecycleStep,
      preservedUnseenStates: correctionLifecycleAfter.preservedUnseenStates,
      transitions: correctionLifecycleAfter.transitions,
      counts: correctionLifecycleAfter.counts,
      states: correctionLifecycleAfter.states
    },
    auxiliarySupervisionTrajectories: auxiliaryTrajectories.length,
    offPolicyReplayExcludedFromPpo: auxiliaryTrajectories.length,
    trainingStrata: summarizeTrainingStrata(trajectories),
    epochGuards
  };
  teacherProposalOptimizer.dispose?.();
  return { model, optimizer, history, calibration: model.calibration, epochGuards };
}

export function stratifiedChunkOrder(chunks, random = Math.random) {
  const buckets = new Map();
  for (const chunk of chunks) {
    const key = trainingStratumKey(chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(chunk);
  }
  const keys = shuffle([...buckets.keys()], random);
  for (const values of buckets.values()) shuffle(values, random);
  const output = [];
  let remaining = chunks.length;
  while (remaining > 0) {
    for (const key of keys) {
      const item = buckets.get(key)?.pop();
      if (!item) continue;
      output.push(item);
      remaining -= 1;
    }
  }
  return output;
}

export function balancedCorrectionChunkOrder(chunks, random = Math.random) {
  const buckets = new Map();
  for (const chunk of chunks || []) {
    const key = correctionStratumKey(chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(chunk);
  }
  const keys = shuffle([...buckets.keys()], random);
  for (const values of buckets.values()) {
    values.sort((left, right) =>
      (Number(right.correctionPriority) || teacherCorrectionPriority(right))
      - (Number(left.correctionPriority) || teacherCorrectionPriority(left)));
  }
  const output = [];
  let remaining = [...buckets.values()].reduce((sum, values) => sum + values.length, 0);
  while (remaining > 0) {
    for (const key of keys) {
      const values = buckets.get(key);
      if (!values?.length) continue;
      output.push(values.shift());
      remaining -= 1;
    }
  }
  return output;
}

export function summarizeTrainingStrata(trajectories) {
  const dimensions = {
    deck: {}, matchup: {}, condition: {}, result: {}, margin: {}, opponentGeneration: {}
  };
  for (const trajectory of trajectories) {
    increment(dimensions.deck, trajectory.deckId || "unknown");
    increment(dimensions.matchup, trajectory.matchupType || "unknown");
    increment(dimensions.condition, trajectory.condition || "unknown");
    increment(dimensions.result, trajectory.resultClass || "unknown");
    increment(dimensions.margin, trajectory.marginClass || "unknown");
    increment(dimensions.opponentGeneration, String(trajectory.opponentGeneration ?? "unknown"));
  }
  return { version: 1, trajectories: trajectories.length, dimensions };
}

export function trainBehaviorCloning(model, trajectories, options = {}) {
  const epochs = Math.max(1, options.epochs || 4);
  const optimizer = options.optimizer || tf.train.adam(options.learningRate || 0.0005);
  const chunks = chunkTrajectories(trajectories, options.sequenceLength || MAX_SEQUENCE);
  const history = [];
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    shuffle(chunks, options.random || Math.random);
    const batchSize = Math.max(1, options.batchSize || 8);
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = packPpoBatch(chunks.slice(start, start + batchSize));
      history.push({ epoch: epoch + 1, ...trainBehaviorCloningBatch(model, batch, optimizer, options) });
    }
    options.onEpoch?.({ epoch: epoch + 1, epochs, metrics: aggregateMetrics(history.filter((item) => item.epoch === epoch + 1)) });
  }
  if (!options.auxiliary) {
    model.gamesTrained = new Set(trajectories.map((trajectory) => trajectory.gameId)).size;
    model.metadata = {
      ...model.metadata,
      algorithm: "recurrent-behavior-cloning-belief",
      trainedAt: new Date().toISOString(),
      epochs,
      trajectories: trajectories.length,
      ...aggregateMetrics(history)
    };
  } else {
    model.metadata = {
      ...model.metadata,
      [options.policyInitializationOnly ? 'tacticalBaselineInitialization' : 'humanAuxiliary']: {
        trainedAt: new Date().toISOString(),
        epochs,
        trajectories: trajectories.length,
        ...aggregateMetrics(history)
      }
    };
  }
  return { model, optimizer, history };
}

export function evaluateBehaviorCloning(model, trajectories, options = {}) {
  const chunks = chunkTrajectories(trajectories, options.sequenceLength || MAX_SEQUENCE);
  const batchSize = Math.max(1, options.batchSize || 8);
  const batches = [];
  const valueSamples = [];
  for (let start = 0; start < chunks.length; start += batchSize) {
    const batchChunks = chunks.slice(start, start + batchSize);
    const packed = packPpoBatch(batchChunks);
    const result = evaluateBehaviorCloningBatch(model, packed);
    batches.push(result);
    result.mask.forEach((mask, index) => {
      if (!mask) return;
      const chunkIndex = Math.floor(index / packed.shape[1]);
      valueSamples.push({
        value: result.values[index],
        outcome: result.outcomes[index] > 0 ? 1 : 0,
        gameId: batchChunks[chunkIndex]?.gameId || `trajectory-${start + chunkIndex}`
      });
    });
  }
  const steps = batches.reduce((sum, item) => sum + item.steps, 0);
  const decisionSteps = batches.reduce((sum, item) => sum + item.decisionSteps, 0);
  return {
    trajectories: trajectories.length,
    games: new Set(trajectories.map((trajectory) => trajectory.gameId)).size,
    steps,
    actionAccuracy: steps ? batches.reduce((sum, item) => sum + item.correct, 0) / steps : 0,
    decisionSteps,
    decisionAccuracy: decisionSteps ? batches.reduce((sum, item) => sum + item.decisionCorrect, 0) / decisionSteps : 0,
    decisionChanceAccuracy: decisionSteps ? batches.reduce((sum, item) => sum + item.chanceCorrect, 0) / decisionSteps : 0,
    policyLoss: weightedMean(batches, "policyLoss"),
    valueMse: weightedMean(batches, "valueMse"),
    beliefLoss: weightedMean(batches, "beliefLoss"),
    belief: aggregateBeliefMetrics(batches.map((batch) => batch.beliefMetrics)),
    calibration: options.skipCalibration ? null : calibrateValueSamples(valueSamples),
    valueSamples
  };
}

export function splitCalibrationTrajectoriesByGame(trajectories, options = {}) {
  const testFraction = Math.max(0.1, Math.min(0.5, Number(options.testFraction) || 0.4));
  const seed = Number(options.seed) >>> 0;
  const byGame = new Map();
  for (const trajectory of trajectories || []) {
    const gameId = trajectory.gameId || `trajectory-${byGame.size}`;
    if (!byGame.has(gameId)) byGame.set(gameId, []);
    byGame.get(gameId).push(trajectory);
  }
  const gameIds = [...byGame.keys()].sort((left, right) =>
    stableStringHash(`${seed}:${left}`) - stableStringHash(`${seed}:${right}`)
      || left.localeCompare(right));
  const requestedTestGames = gameIds.length > 1
    ? Math.max(1, Math.min(gameIds.length - 1, Math.round(gameIds.length * testFraction)))
    : 0;
  const testIds = new Set(gameIds.slice(0, requestedTestGames));
  const fit = [];
  const test = [];
  for (const [gameId, items] of byGame) {
    (testIds.has(gameId) ? test : fit).push(...items);
  }
  return {
    version: 1,
    fit,
    test,
    manifest: {
      seed,
      testFraction,
      fitGames: gameIds.length - requestedTestGames,
      testGames: requestedTestGames,
      overlapGames: 0,
      fitGameFingerprint: stableStringHash(gameIds.filter((id) => !testIds.has(id)).join("|")),
      testGameFingerprint: stableStringHash(gameIds.filter((id) => testIds.has(id)).join("|"))
    }
  };
}

export function evaluateValueCalibration(model, fitTrajectories, testTrajectories, options = {}) {
  const fit = evaluateBehaviorCloning(model, fitTrajectories, {
    ...options,
    skipCalibration: true
  });
  const test = evaluateBehaviorCloning(model, testTrajectories, {
    ...options,
    skipCalibration: true
  });
  return calibrateValueSamples(fit.valueSamples, {
    testSamples: test.valueSamples,
    fitGames: fit.games,
    testGames: test.games
  });
}

export function createActionRankingAuditAccumulator() {
  return {
    evaluatorPath: null,
    evaluatorArchitecture: null,
    trajectories: 0,
    gameIds: new Set(),
    byGame: new Map(),
    byTargetHead: new Map(),
    byPhase: new Map(),
    byActionClass: new Map(),
    byDeckSeat: new Map(),
    byDeckSeatPhase: new Map(),
    byDeckSeatActionClass: new Map(),
    phaseOpportunitiesByDeckSeat: new Map(),
    actionClassOpportunitiesByDeckSeat: new Map(),
    naturalDistribution: {
      states: new Set(),
      byState: new Map(),
      byStratum: new Map(),
      decisions: 0,
      correct: 0,
      regret: 0,
      regrets: []
    },
    decisions: 0,
    evaluatedStatePairs: 0,
    neuralCorrect: 0,
    heuristicCorrect: 0,
    neuralOnly: 0,
    heuristicOnly: 0
  };
}

export function accumulateActionRankingAudit(
  model,
  trajectories,
  accumulator = createActionRankingAuditAccumulator(),
  options = {}
) {
  accumulator.evaluatorPath = evaluatorPathId(model);
  accumulator.evaluatorArchitecture = evaluatorArchitecture(model);
  const trajectoryOffset = accumulator.trajectories;
  for (const [trajectoryIndex, trajectory] of (trajectories || []).entries()) {
    const gameId =
      trajectory.gameId || `unknown-game:${trajectoryOffset + trajectoryIndex}`;
    const coverageKey = trajectoryDeckSeatKey(trajectory);
    if (trajectory.gameId) accumulator.gameIds.add(trajectory.gameId);
    for (const step of trajectory.steps || []) {
      const reference = step.actionRankingAuditReference;
      const auditStratum = normalizeEvaluatorAuditStratum({
        stored: reference?.auditStratum,
        state: step.state,
        recommendedAction: reference?.correctActionKey,
        selectedAction: reference?.comparedActionKey,
        legalActions: step.legalActionKeys,
        deckId: trajectory.deckId,
        seat: trajectory.playerId ?? trajectory.playerSeat
      });
      const targetHead = auditStratum.phaseBand === "mulligan"
        ? EVALUATOR_TARGET_HEADS.mulliganQ
        : EVALUATOR_TARGET_HEADS.generalActionQ;
      addAuditOpportunity(
        accumulator.phaseOpportunitiesByDeckSeat,
        coverageKey,
        auditStratum.phaseBand
      );
      for (const actionClass of evaluatorAuditOpportunityActionClasses({
        phaseBand: auditStratum.phaseBand,
        legalActions: step.legalActionKeys
      })) {
        addAuditOpportunity(
          accumulator.actionClassOpportunitiesByDeckSeat,
          coverageKey,
          actionClass
        );
      }
      if (!validActionRankingAuditReference(reference, {
        informationSetHash: step.informationSetHash,
        legalActionKeys: step.legalActionKeys
      })) continue;
      if (typeof options.actionEvidenceFilter === "function"
        && options.actionEvidenceFilter(reference, step, trajectory) !== true) {
        continue;
      }
      const pairs = reference.evaluatorStatePairs || [];
      const neuralDeltas = [];
      const heuristicDeltas = [];
      const actualOutcomeDeltas = [];
      for (const pair of pairs) {
        if (pair.recommendedState?.length !== STATE_DIM
          || pair.selectedState?.length !== STATE_DIM) continue;
        const recommendedValue = estimateAuditEvidenceValue(
          model,
          pair.recommendedState,
          pair.recommendedStructuredState,
          step,
          { ...options, targetHead }
        );
        const selectedValue = estimateAuditEvidenceValue(
          model,
          pair.selectedState,
          pair.selectedStructuredState,
          step,
          { ...options, targetHead }
        );
        if (!Number.isFinite(recommendedValue)
          || !Number.isFinite(selectedValue)) continue;
        const recommendedProbability = calibratedProbability(
          recommendedValue,
          model.calibration?.temperature || 1,
          model.calibration?.bias || 0
        );
        const selectedProbability = calibratedProbability(
          selectedValue,
          model.calibration?.temperature || 1,
          model.calibration?.bias || 0
        );
        const heuristicRecommendedProbability =
          Number(pair.recommendedHeuristicValue);
        const heuristicSelectedProbability =
          Number(pair.selectedHeuristicValue);
        const recommendedOutcome = Number(pair.recommendedOutcome);
        const selectedOutcome = Number(pair.selectedOutcome);
        if (!Number.isFinite(recommendedProbability)
          || !Number.isFinite(selectedProbability)
          || !Number.isFinite(heuristicRecommendedProbability)
          || !Number.isFinite(heuristicSelectedProbability)
          || !Number.isFinite(recommendedOutcome)
          || !Number.isFinite(selectedOutcome)) continue;
        neuralDeltas.push(recommendedProbability - selectedProbability);
        heuristicDeltas.push(
          heuristicRecommendedProbability - heuristicSelectedProbability
        );
        actualOutcomeDeltas.push(recommendedOutcome - selectedOutcome);
      }
      if (!neuralDeltas.length) continue;
      const actualMeanOutcomeDelta = mean(actualOutcomeDeltas);
      if (actualMeanOutcomeDelta === 0) continue;
      const expectedDirection = Math.sign(actualMeanOutcomeDelta);
      const neuralPreferred =
        Math.sign(mean(neuralDeltas)) === expectedDirection;
      const heuristicPreferred =
        Math.sign(mean(heuristicDeltas)) === expectedDirection;
      const naturalFrameInScope = reference?.samplingFrame?.scope
        === "opening-and-mulligan"
        ? ["mulligan", "early"].includes(auditStratum.phaseBand)
        : true;
      if (reference?.samplingFrame?.distribution === "natural-distribution"
        && naturalFrameInScope) {
        accumulateNaturalDistributionPrediction(
          accumulator.naturalDistribution,
          {
            stateId: reference.informationSetHash || step.informationSetHash,
            correct: neuralPreferred,
            regret: neuralPreferred ? 0 : Math.abs(actualMeanOutcomeDelta),
            deckId: trajectory.deckId || "unknown",
            seat: trajectory.playerId ?? trajectory.playerSeat ?? "unknown",
            matchup: trajectory.matchup?.id
              || trajectory.matchup?.opponentDeckId
              || trajectory.opponentDeckId
              || "unknown"
          }
        );
      }
      accumulator.decisions += 1;
      accumulator.evaluatedStatePairs += neuralDeltas.length;
      if (!accumulator.byGame.has(gameId)) {
        accumulator.byGame.set(gameId, {
          gameId,
          decisions: 0,
          statePairs: 0,
          neuralCorrect: 0,
          heuristicCorrect: 0,
          neuralOnly: 0,
          heuristicOnly: 0,
          coverageKeys: new Set()
        });
      }
      const game = accumulator.byGame.get(gameId);
      const phaseGame = actionPhaseGame(
        accumulator,
        auditStratum.phaseBand,
        gameId
      );
      const targetHeadGame = actionCompositeAuditGame(
        accumulator.byTargetHead,
        targetHead,
        gameId
      );
      const actionClassGame = actionClassAuditGame(
        accumulator,
        auditStratum.actionClass,
        gameId
      );
      const deckSeatGame = actionDeckSeatAuditGame(
        accumulator,
        coverageKey,
        gameId
      );
      const deckSeatPhaseGame = actionCompositeAuditGame(
        accumulator.byDeckSeatPhase,
        `${coverageKey}::${auditStratum.phaseBand}`,
        gameId
      );
      const deckSeatActionClassGame = actionCompositeAuditGame(
        accumulator.byDeckSeatActionClass,
        `${coverageKey}::${auditStratum.actionClass}`,
        gameId
      );
      for (const evidenceGame of [
        game,
        targetHeadGame,
        phaseGame,
        actionClassGame,
        deckSeatGame,
        deckSeatPhaseGame,
        deckSeatActionClassGame
      ]) {
        evidenceGame.coverageKeys.add(coverageKey);
        evidenceGame.decisions += 1;
        evidenceGame.statePairs += neuralDeltas.length;
      }
      if (neuralPreferred) accumulator.neuralCorrect += 1;
      if (heuristicPreferred) accumulator.heuristicCorrect += 1;
      if (neuralPreferred && !heuristicPreferred) accumulator.neuralOnly += 1;
      if (!neuralPreferred && heuristicPreferred) {
        accumulator.heuristicOnly += 1;
      }
      for (const evidenceGame of [
        game,
        targetHeadGame,
        phaseGame,
        actionClassGame,
        deckSeatGame,
        deckSeatPhaseGame,
        deckSeatActionClassGame
      ]) {
        if (neuralPreferred) evidenceGame.neuralCorrect += 1;
        if (heuristicPreferred) evidenceGame.heuristicCorrect += 1;
        if (neuralPreferred && !heuristicPreferred) {
          evidenceGame.neuralOnly += 1;
        }
        if (!neuralPreferred && heuristicPreferred) {
          evidenceGame.heuristicOnly += 1;
        }
      }
    }
  }
  accumulator.trajectories += (trajectories || []).length;
  return accumulator;
}

export function finalizeActionRankingAudit(
  accumulator,
  options = {}
) {
  const gameImprovements = [...accumulator.byGame.values()]
    .filter((game) => game.decisions > 0)
    .map((game) => ({
      gameId: game.gameId,
      improvement: (game.neuralOnly - game.heuristicOnly) / game.decisions,
      stratum: [...game.coverageKeys].sort().join("&") || "unknown",
      ...game
    }))
    .sort((left, right) => left.gameId.localeCompare(right.gameId));
  const bootstrap = bootstrapStratifiedGamePairedImprovements(
    gameImprovements,
    {
      samples: options.bootstrapSamples
    }
  );
  const neuralAccuracy = macroAccuracyByStratum(
    gameImprovements,
    "neuralCorrect"
  );
  const heuristicAccuracy = macroAccuracyByStratum(
    gameImprovements,
    "heuristicCorrect"
  );
  const phaseBands = Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map(
    (phase) => [phase, finalizeActionPhaseBand(
      accumulator.byPhase.get(phase),
      options
    )]
  ));
  const targetHeads = Object.fromEntries([
    EVALUATOR_TARGET_HEADS.generalActionQ,
    EVALUATOR_TARGET_HEADS.mulliganQ
  ].map((targetHead) => [
    targetHead,
    finalizeActionPhaseBand(
      accumulator.byTargetHead.get(targetHead),
      options
    )
  ]));
  const actionClasses = Object.fromEntries(
    EVALUATOR_AUDIT_CORE_ACTION_CLASSES.map((actionClass) => [
      actionClass,
      finalizeActionPhaseBand(
        accumulator.byActionClass.get(actionClass),
        options
      )
    ])
  );
  const deckSeats = Object.fromEntries(
    [...accumulator.byDeckSeat.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([deckSeat, games]) => [
        deckSeat,
        finalizeActionPhaseBand(games, options)
      ])
  );
  const deckSeatPhases = finalizeActionAuditGroups(
    accumulator.byDeckSeatPhase,
    options,
    auditOpportunityKeys(accumulator.phaseOpportunitiesByDeckSeat)
  );
  const deckSeatActionClasses = finalizeActionAuditGroups(
    accumulator.byDeckSeatActionClass,
    options,
    auditOpportunityKeys(accumulator.actionClassOpportunitiesByDeckSeat)
  );
  return {
    version: 8,
    referenceVersion: ACTION_RANKING_AUDIT_REFERENCE_VERSION,
    reference: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
    referenceContract: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
    evaluatorPath: accumulator.evaluatorPath,
    evaluatorArchitecture: accumulator.evaluatorArchitecture,
    comparator: "default-ai-post-action-state-evaluator-v1",
    comparatorScope:
      "mean predicted post-action branch delta versus mean terminal outcome delta over every paired final-bank seed",
    splitUnit: "game-cluster-bootstrap",
    weighting: "deck-seat-macro",
    games: accumulator.gameIds.size,
    contributingGames: gameImprovements.length,
    decisions: accumulator.decisions,
    evaluatedStatePairs: accumulator.evaluatedStatePairs,
    neuralCorrect: accumulator.neuralCorrect,
    comparatorCorrect: accumulator.heuristicCorrect,
    heuristicCorrect: accumulator.heuristicCorrect,
    neuralAccuracy,
    comparatorAccuracy: heuristicAccuracy,
    heuristicAccuracy,
    neuralOnly: accumulator.neuralOnly,
    heuristicOnly: accumulator.heuristicOnly,
    pairedImprovement: bootstrap.mean,
    pairedImprovementLowerBound: bootstrap.lowerBound,
    pairedImprovementUpperBound: bootstrap.upperBound,
    bootstrap,
    targetHeads,
    phaseBands,
    actionClasses,
    deckSeats,
    deckSeatPhases,
    deckSeatActionClasses,
    naturalDistribution: finalizeNaturalDistributionPredictions(
      accumulator.naturalDistribution
    ),
    opportunityMask: {
      deckSeatPhases: auditOpportunityKeys(
        accumulator.phaseOpportunitiesByDeckSeat
      ),
      deckSeatActionClasses: auditOpportunityKeys(
        accumulator.actionClassOpportunitiesByDeckSeat
      )
    }
  };
}

function accumulateNaturalDistributionPrediction(accumulator, item) {
  const stateId = String(item.stateId || "unknown");
  const regret = Math.max(0, Math.min(1, Number(item.regret) || 0));
  accumulator.states.add(stateId);
  accumulator.decisions += 1;
  if (item.correct === true) accumulator.correct += 1;
  accumulator.regret += regret;
  accumulator.regrets.push(regret);
  const state = accumulator.byState.get(stateId) || {
    stateId,
    decisions: 0,
    correct: 0,
    regret: 0
  };
  state.decisions += 1;
  if (item.correct === true) state.correct += 1;
  state.regret += regret;
  accumulator.byState.set(stateId, state);
  const stratumKeys = [
    `deck:${item.deckId}`,
    `seat:${item.seat}`,
    `deck-seat:${item.deckId}:${item.seat}`,
    `matchup:${item.matchup}`
  ];
  for (const key of stratumKeys) {
    const bucket = accumulator.byStratum.get(key) || {
      decisions: 0,
      correct: 0,
      regret: 0,
      regrets: []
    };
    bucket.decisions += 1;
    if (item.correct === true) bucket.correct += 1;
    bucket.regret += regret;
    bucket.regrets.push(regret);
    accumulator.byStratum.set(key, bucket);
  }
}

function finalizeNaturalDistributionPredictions(accumulator) {
  const strata = Object.fromEntries(
    [...accumulator.byStratum.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [key, {
        ...bucket,
        conditionalAccuracy: bucket.decisions > 0
          ? bucket.correct / bucket.decisions
          : null,
        expectedRegret: bucket.decisions > 0
          ? bucket.regret / bucket.decisions
          : null,
        regretTailRisk: evaluatorRegretTailRisk(bucket.regrets)
      }])
  );
  const weakestStrata = Object.entries(strata)
    .filter(([, bucket]) => bucket.decisions > 0)
    .sort((left, right) =>
      left[1].conditionalAccuracy - right[1].conditionalAccuracy
        || right[1].expectedRegret - left[1].expectedRegret)
    .slice(0, 10)
    .map(([key, bucket]) => ({ key, ...bucket }));
  return {
    version: 2,
    contract: "natural-distribution-evaluator-ranking-v2",
    independentOpeningStates: accumulator.states.size,
    decisions: accumulator.decisions,
    correct: accumulator.correct,
    conditionalAccuracy: accumulator.decisions > 0
      ? accumulator.correct / accumulator.decisions
      : null,
    expectedRegret: accumulator.decisions > 0
      ? accumulator.regret / accumulator.decisions
      : null,
    expectedRegretInterval: evaluatorRegretStateInterval(
      [...accumulator.byState.values()]
    ),
    regretTailRisk: evaluatorRegretTailRisk(accumulator.regrets),
    strata,
    weakestStrata
  };
}

function evaluatorRegretTailRisk(values = []) {
  const finite = values.map(Number).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!finite.length) return {
    decisions: 0,
    aboveThreePercentRate: null,
    aboveFivePercentRate: null,
    worstTenPercentCvar: null
  };
  const descending = [...finite].sort((left, right) => right - left);
  const tailCount = Math.max(1, Math.ceil(descending.length * 0.1));
  return {
    decisions: finite.length,
    aboveThreePercentRate: finite.filter((value) => value >= 0.03).length
      / finite.length,
    aboveFivePercentRate: finite.filter((value) => value >= 0.05).length
      / finite.length,
    worstTenPercentCvar: descending.slice(0, tailCount)
      .reduce((sum, value) => sum + value, 0) / tailCount
  };
}

function evaluatorWeightedRegretTailRisk(values = [], weights = []) {
  const items = values.flatMap((value, index) => {
    const boundedValue = Math.max(0, Math.min(1, Number(value)));
    const weight = Number(weights[index]);
    return Number.isFinite(boundedValue) && Number.isFinite(weight)
      && weight > 0
      ? [{ value: boundedValue, weight }]
      : [];
  });
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) return {
    decisions: 0,
    weightedDecisions: 0,
    aboveThreePercentRate: null,
    aboveFivePercentRate: null,
    worstTenPercentCvar: null
  };
  const rate = (threshold) => items.reduce(
    (sum, item) => sum + (item.value >= threshold ? item.weight : 0),
    0
  ) / totalWeight;
  const tailTarget = totalWeight * 0.1;
  let remaining = tailTarget;
  let tailLoss = 0;
  for (const item of [...items].sort((left, right) =>
    right.value - left.value)) {
    if (!(remaining > 0)) break;
    const used = Math.min(remaining, item.weight);
    tailLoss += used * item.value;
    remaining -= used;
  }
  return {
    decisions: items.length,
    weightedDecisions: totalWeight,
    aboveThreePercentRate: rate(0.03),
    aboveFivePercentRate: rate(0.05),
    worstTenPercentCvar: tailLoss / tailTarget
  };
}

function weightedNumericMean(values = [], weights = []) {
  const totalWeight = weights.reduce(
    (sum, weight) => sum + Number(weight),
    0
  );
  return totalWeight > 0
    ? values.reduce((sum, value, index) =>
      sum + Number(value) * Number(weights[index]), 0) / totalWeight
    : null;
}

function evaluatorRegretStateInterval(states = [], confidence = 0.95) {
  const values = states.filter((state) => Number(state?.decisions) > 0)
    .map((state) => Math.max(
      0,
      Math.min(1, Number(state.regret) / Number(state.decisions))
    ));
  if (!values.length) return {
    method: "opening-state-hoeffding-v1",
    confidence,
    states: 0,
    mean: null,
    lowerBound: null,
    upperBound: null
  };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const radius = Math.sqrt(Math.log(2 / (1 - confidence)) / (2 * values.length));
  return {
    method: "opening-state-hoeffding-v1",
    confidence,
    states: values.length,
    mean,
    lowerBound: Math.max(0, mean - radius),
    upperBound: Math.min(1, mean + radius)
  };
}

export function evaluateActionRankingAudit(model, trajectories, options = {}) {
  return finalizeActionRankingAudit(
    accumulateActionRankingAudit(
      model,
      trajectories,
      createActionRankingAuditAccumulator(),
      options
    ),
    options
  );
}

export function createLeafValueRankingAuditAccumulator() {
  return {
    evaluatorPath: null,
    evaluatorArchitecture: null,
    trajectories: 0,
    gameIds: new Set(),
    byGame: new Map(),
    byPhase: new Map(),
    byDeckSeat: new Map(),
    byDeckSeatPhase: new Map(),
    phaseOpportunitiesByDeckSeat: new Map(),
    actionEffectByGame: new Map(),
    actionEffectByPhase: new Map(),
    targetedActionEffectByGame: new Map(),
    targetedActionEffectByPhase: new Map(),
    targetedActionEffectByDeckSeatPhase: new Map(),
    naturalActionEffectByGame: new Map(),
    naturalActionEffectByPhase: new Map(),
    naturalActionEffectByDeckSeat: new Map(),
    naturalActionEffectByDeckSeatPhase: new Map(),
    depthBins: {},
    decisions: 0,
    correct: 0
  };
}

export function accumulateLeafValueRankingAudit(
  model,
  trajectories,
  accumulator = createLeafValueRankingAuditAccumulator(),
  options = {}
) {
  accumulator.evaluatorPath = evaluatorPathId(model);
  accumulator.evaluatorArchitecture = evaluatorArchitecture(model);
  for (const trajectory of trajectories || []) {
    const gameId =
      trajectory.gameId
      || `unknown-game:${accumulator.trajectories + accumulator.byGame.size}`;
    const coverageKey = trajectoryDeckSeatKey(trajectory);
    if (trajectory.gameId) accumulator.gameIds.add(trajectory.gameId);
    for (const step of trajectory.steps || []) {
      const actionReference = step.actionRankingReference;
      const naturalComparisonsBefore =
        accumulator.naturalActionEffectByGame.get(gameId)?.comparisons || 0;
      const opportunityStratum = normalizeEvaluatorAuditStratum({
        state: step.state,
        recommendedAction: step.recommendedActionKey,
        selectedAction: step.selectedActionKey,
        legalActions: step.legalActionKeys,
        deckId: trajectory.deckId,
        seat: trajectory.playerId ?? trajectory.playerSeat
      });
      addAuditOpportunity(
        accumulator.phaseOpportunitiesByDeckSeat,
        coverageKey,
        opportunityStratum.phaseBand
      );
      const validActionReference = validActionRankingReference(actionReference, {
        informationSetHash: step.informationSetHash,
        legalActionKeys: step.legalActionKeys
      });
      const leafReferences = [
        validIndependentLeafValueReference(step.leafValueAuditReference)
          ? step.leafValueAuditReference
          : null,
        validActionReference ? actionReference?.leafValueReference : null
      ].filter(validLeafValueReference);
      for (const leafReference of leafReferences) {
        const auditStratum = normalizeEvaluatorAuditStratum({
          stored: leafReference.auditStratum,
          state: step.state,
          recommendedAction:
            actionReference?.correctActionKey || step.recommendedActionKey,
          selectedAction:
            actionReference?.comparedActionKey || step.selectedActionKey,
          legalActions: step.legalActionKeys,
          deckId: trajectory.deckId,
          seat: trajectory.playerId ?? trajectory.playerSeat
        });
        if (validLeafActionEffectComparison(
          leafReference.actionEffectComparison
        )) {
          accumulateLeafActionEffectRanking(
            accumulator,
            model,
            leafReference.actionEffectComparison,
            step,
            gameId,
            coverageKey,
            auditStratum.phaseBand,
            options
          );
        }
        for (const pair of leafReference.pairs) {
          if (pair.correctState.length !== STATE_DIM
            || pair.comparedState.length !== STATE_DIM) continue;
          const correctValue = estimateAuditEvidenceValue(
            model,
            pair.correctState,
            pair.correctStructuredState,
            step,
            options
          );
          const comparedValue = estimateAuditEvidenceValue(
            model,
            pair.comparedState,
            pair.comparedStructuredState,
            step,
            options
          );
          if (!Number.isFinite(correctValue)
            || !Number.isFinite(comparedValue)) continue;
          const correctProbability = calibratedProbability(
            correctValue,
            model.calibration?.temperature || 1,
            model.calibration?.bias || 0
          );
          const comparedProbability = calibratedProbability(
            comparedValue,
            model.calibration?.temperature || 1,
            model.calibration?.bias || 0
          );
          const preferred = correctProbability > comparedProbability;
          const depthBin = pair.correctDepthBin === pair.comparedDepthBin
            ? pair.correctDepthBin || "unknown"
            : `${pair.correctDepthBin || "unknown"}|${pair.comparedDepthBin || "unknown"}`;
          accumulator.depthBins[depthBin] ||= { decisions: 0, correct: 0 };
          accumulator.depthBins[depthBin].decisions += 1;
          if (!accumulator.byGame.has(gameId)) {
            accumulator.byGame.set(gameId, {
              gameId,
              decisions: 0,
              correct: 0,
              coverageKeys: new Set()
            });
          }
          const game = accumulator.byGame.get(gameId);
          const phaseGame = leafPhaseGame(
            accumulator,
            auditStratum.phaseBand,
            gameId
          );
          const deckSeatGame = leafDeckSeatAuditGame(
            accumulator,
            coverageKey,
            gameId
          );
          const deckSeatPhaseGame = leafCompositeAuditGame(
            accumulator.byDeckSeatPhase,
            `${coverageKey}::${auditStratum.phaseBand}`,
            gameId
          );
          game.coverageKeys.add(coverageKey);
          phaseGame.coverageKeys.add(coverageKey);
          deckSeatGame.coverageKeys.add(coverageKey);
          deckSeatPhaseGame.coverageKeys.add(coverageKey);
          accumulator.decisions += 1;
          game.decisions += 1;
          phaseGame.decisions += 1;
          deckSeatGame.decisions += 1;
          deckSeatPhaseGame.decisions += 1;
          if (preferred) {
            accumulator.correct += 1;
            game.correct += 1;
            phaseGame.correct += 1;
            deckSeatGame.correct += 1;
            deckSeatPhaseGame.correct += 1;
            accumulator.depthBins[depthBin].correct += 1;
          }
        }
      }
      accumulateUnauditedNaturalLeafObservation(
        accumulator,
        step.naturalLeafAuditSamplingObservation,
        gameId,
        coverageKey,
        opportunityStratum.phaseBand,
        { ...options, hasAuditedNaturalComparison:
          (accumulator.naturalActionEffectByGame.get(gameId)?.comparisons || 0)
            > naturalComparisonsBefore,
          singleLegalPolicyAction: step.legalCount === 1
            && step.originalLegalCount === 1 && step.selectedIndex === 0
            && step.legalActionKeys?.length === 1
            && step.selectedActionKey === step.legalActionKeys[0] }
      );
    }
  }
  accumulator.trajectories += (trajectories || []).length;
  return accumulator;
}

export function finalizeLeafValueRankingAudit(
  accumulator,
  options = {}
) {
  const gameAdvantages = [...accumulator.byGame.values()]
    .filter((game) => game.decisions > 0)
    .map((game) => ({
      ...game,
      improvement: game.correct / game.decisions - 0.5,
      stratum: [...game.coverageKeys].sort().join("&") || "unknown"
    }))
    .sort((left, right) => left.gameId.localeCompare(right.gameId));
  const bootstrap = bootstrapStratifiedGamePairedImprovements(
    gameAdvantages,
    {
      samples: options.bootstrapSamples
    }
  );
  const accuracy = macroAccuracyByStratum(gameAdvantages, "correct");
  const phaseBands = Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map(
    (phase) => [phase, finalizeLeafPhaseBand(
      accumulator.byPhase.get(phase),
      options
    )]
  ));
  const deckSeats = Object.fromEntries(
    [...accumulator.byDeckSeat.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([deckSeat, games]) => [
        deckSeat,
        finalizeLeafPhaseBand(games, options)
      ])
  );
  const deckSeatPhases = finalizeLeafAuditGroups(
    accumulator.byDeckSeatPhase,
    options,
    auditOpportunityKeys(accumulator.phaseOpportunitiesByDeckSeat)
  );
  const actionEffectRanking = finalizeLeafActionEffectRanking(
    accumulator.actionEffectByGame,
    accumulator.actionEffectByPhase,
    accumulator.targetedActionEffectByGame,
    accumulator.targetedActionEffectByPhase,
    accumulator.targetedActionEffectByDeckSeatPhase,
    accumulator.naturalActionEffectByGame,
    accumulator.naturalActionEffectByPhase,
    accumulator.naturalActionEffectByDeckSeat,
    accumulator.naturalActionEffectByDeckSeatPhase,
    options
  );
  return {
    version: 3,
    referenceVersion: LEAF_VALUE_REFERENCE_VERSION,
    referenceContract: LEAF_VALUE_REFERENCE_CONTRACT,
    evaluatorPath: accumulator.evaluatorPath,
    evaluatorArchitecture: accumulator.evaluatorArchitecture,
    splitUnit: "game-cluster-bootstrap",
    weighting: "deck-seat-macro",
    games: accumulator.gameIds.size,
    contributingGames: gameAdvantages.length,
    decisions: accumulator.decisions,
    correct: accumulator.correct,
    accuracy,
    accuracyLowerBound: Number.isFinite(Number(bootstrap.lowerBound))
      ? 0.5 + Number(bootstrap.lowerBound)
      : null,
    accuracyUpperBound: Number.isFinite(Number(bootstrap.upperBound))
      ? 0.5 + Number(bootstrap.upperBound)
      : null,
    pairedAdvantage: bootstrap.mean,
    pairedAdvantageLowerBound: bootstrap.lowerBound,
    pairedAdvantageUpperBound: bootstrap.upperBound,
    depthBins: Object.fromEntries(Object.entries(accumulator.depthBins).map(
      ([key, value]) => [key, {
        ...value,
        accuracy: value.decisions ? value.correct / value.decisions : 0
      }]
    )),
    bootstrap,
    phaseBands,
    deckSeats,
    deckSeatPhases,
    evidenceSemantics: {
      storedLeafPairs: "discordant-terminal-state-pairs-v1",
      populationActionRegretRecoverableFromStoredLeafPairs: false,
      actionEffectRankingContract:
        actionEffectRanking.contract
    },
    actionEffectRanking,
    opportunityMask: {
      deckSeatPhases: auditOpportunityKeys(
        accumulator.phaseOpportunitiesByDeckSeat
      )
    }
  };
}

function accumulateUnauditedNaturalLeafObservation(
  accumulator,
  observation,
  gameId,
  coverageKey,
  phaseBand,
  options = {}
) {
  if (![1, 2, 3].includes(observation?.version)
    || ![
      "natural-leaf-audit-sampling-observation-v1",
      "natural-leaf-audit-sampling-observation-v2",
      "natural-leaf-audit-sampling-observation-v3"
    ].includes(observation?.contract)
    || (observation.status === "audited" && options.hasAuditedNaturalComparison)
    || !["audited", "identical-action-zero-regret", "audit-unavailable"]
      .includes(observation.status)
    || !validLeafAuditSamplingFrame(observation.samplingFrame)
    || observation.samplingFrame?.distribution !== "natural-distribution"
    || !["hash-priority-reservoir-policy-decision-v1",
      "hash-priority-mixture-reservoir-policy-decision-v1"]
      .includes(observation.samplingFrame?.candidateSelection)
    || (observation.samplingFrame.version === 3
      && observation.samplingFrame.selectedPhaseBand !== phaseBand)
    || (options.certificationRole
      && observation.samplingFrame.certificationRole
        !== options.certificationRole)
    || (options.datasetKey
      && observation.samplingFrame.datasetKey !== options.datasetKey)) return;
  const identical = observation.status === "identical-action-zero-regret"
    || options.singleLegalPolicyAction === true;
  const sampleWeight = 1 / Number(
    observation.samplingFrame.selectionProbability
  );
  const item = {
    gameId,
    coverageKey,
    disposition: identical ? "near-equivalent" : "inconclusive",
    correct: null,
    regret: identical ? 0 : null,
    conservativeRegretUpperBound: identical ? 0 : 1,
    riskAssessmentStatus: identical ? "known-zero" : "unavailable",
    sampleWeight
  };
  for (const games of [
    accumulator.actionEffectByGame,
    leafActionEffectPhaseGames(accumulator, phaseBand),
    accumulator.naturalActionEffectByGame,
    leafActionEffectGroup(accumulator.naturalActionEffectByPhase, phaseBand),
    leafActionEffectGroup(accumulator.naturalActionEffectByDeckSeat, coverageKey),
    leafActionEffectGroup(
      accumulator.naturalActionEffectByDeckSeatPhase,
      `${coverageKey}::${phaseBand}`
    )
  ]) {
    accumulateLeafActionEffectGame(games, item);
  }
}

function accumulateLeafActionEffectRanking(
  accumulator,
  model,
  comparison,
  step,
  gameId,
  coverageKey,
  phaseBand,
  options
) {
  const predictedDeltas = [];
  for (const pair of comparison.evaluatorStatePairs || []) {
    const recommendedValue = estimateAuditEvidenceValue(
      model,
      pair.recommendedState,
      pair.recommendedStructuredState,
      step,
      options
    );
    const comparedValue = estimateAuditEvidenceValue(
      model,
      pair.selectedState,
      pair.selectedStructuredState,
      step,
      options
    );
    if (!Number.isFinite(recommendedValue)
      || !Number.isFinite(comparedValue)) continue;
    predictedDeltas.push(
      calibratedProbability(
        recommendedValue,
        model.calibration?.temperature || 1,
        model.calibration?.bias || 0
      ) - calibratedProbability(
        comparedValue,
        model.calibration?.temperature || 1,
        model.calibration?.bias || 0
      )
    );
  }
  if (!predictedDeltas.length) return;
  const audit = comparison.pairedAudit;
  // Reassess every stored raw pair under the current paired-data contract.
  // This upgrades legacy Hoeffding-derived records without mutating them.
  const pairedAssessment = pairedBinaryDifferenceInterval(
    audit.outcomePairs,
    audit.confidence
  );
  if (!pairedAssessment) return;
  const effect = Number(pairedAssessment.mean);
  const lower = Number(pairedAssessment.lowerBound);
  const upper = Number(pairedAssessment.upperBound);
  const delta = Math.max(0, Number(comparison.decisiveEffectThreshold) || 0.01);
  const equivalentMargin = Math.max(
    0,
    Number(comparison.nearEquivalentMargin) || 0.01
  );
  const minimumNearEquivalentSamples = Math.max(
    32,
    Number(comparison.minimumNearEquivalentSamples) || 32
  );
  let disposition = "inconclusive";
  let expectedDirection = 0;
  if (lower > delta) {
    disposition = "decisive";
    expectedDirection = 1;
  } else if (upper < -delta) {
    disposition = "decisive";
    expectedDirection = -1;
  } else if (Number(pairedAssessment.samples)
      >= minimumNearEquivalentSamples
    && lower >= -equivalentMargin && upper <= equivalentMargin) {
    disposition = "near-equivalent";
  }
  const predictedDirection = Math.sign(mean(predictedDeltas));
  const correct = disposition === "decisive"
    ? predictedDirection === expectedDirection
    : null;
  const regret = disposition === "decisive"
    ? correct ? 0 : Math.min(1, Math.abs(effect))
    : disposition === "near-equivalent" ? 0 : null;
  const conservativeRegretUpperBound =
    evaluatorConservativeRegretUpperBound({
      disposition,
      expectedDirection,
      predictedDirection,
      correct,
      lower,
      upper
    });
  for (const games of [
    accumulator.actionEffectByGame,
    leafActionEffectPhaseGames(accumulator, phaseBand)
  ]) {
    accumulateLeafActionEffectGame(games, {
      gameId,
      coverageKey,
      disposition,
      correct,
      regret,
      conservativeRegretUpperBound,
      riskAssessmentStatus: "audited"
    });
  }
  const formalSamplingFrame = comparison.samplingFrame;
  const formalSamplingFrameValid = validLeafAuditSamplingFrame(
    formalSamplingFrame
  ) && formalSamplingFrame != null
    && (!options.certificationRole
      || formalSamplingFrame.certificationRole === options.certificationRole)
    && (!options.datasetKey
      || formalSamplingFrame.datasetKey === options.datasetKey);
  if (formalSamplingFrameValid
    && formalSamplingFrame.distribution === "natural-distribution"
    && ["hash-priority-reservoir-policy-decision-v1",
      "hash-priority-mixture-reservoir-policy-decision-v1"]
      .includes(formalSamplingFrame.candidateSelection)
    && (formalSamplingFrame.version !== 3
      || formalSamplingFrame.selectedPhaseBand === phaseBand)) {
    const sampleWeight = 1 / Number(
      formalSamplingFrame.selectionProbability
    );
    const naturalPhase = leafActionEffectGroup(
      accumulator.naturalActionEffectByPhase,
      phaseBand
    );
    const naturalDeckSeat = leafActionEffectGroup(
      accumulator.naturalActionEffectByDeckSeat,
      coverageKey
    );
    const naturalDeckSeatPhase = leafActionEffectGroup(
      accumulator.naturalActionEffectByDeckSeatPhase,
      `${coverageKey}::${phaseBand}`
    );
    for (const games of [
      accumulator.naturalActionEffectByGame,
      naturalPhase,
      naturalDeckSeat,
      naturalDeckSeatPhase
    ]) {
      accumulateLeafActionEffectGame(games, {
        gameId,
        coverageKey,
        disposition,
        correct,
        regret,
        conservativeRegretUpperBound,
        riskAssessmentStatus: "audited",
        sampleWeight
      });
    }
  } else if (formalSamplingFrameValid
    && formalSamplingFrame.distribution === "prespecified-stratified") {
    const targetedPhase = leafActionEffectGroup(
      accumulator.targetedActionEffectByPhase,
      phaseBand
    );
    const targetedDeckSeatPhase = leafActionEffectGroup(
      accumulator.targetedActionEffectByDeckSeatPhase,
      `${coverageKey}::${phaseBand}`
    );
    for (const games of [
      accumulator.targetedActionEffectByGame,
      targetedPhase,
      targetedDeckSeatPhase
    ]) {
      accumulateLeafActionEffectGame(games, {
        gameId,
        coverageKey,
        disposition,
        correct,
        regret,
        conservativeRegretUpperBound,
        riskAssessmentStatus: "audited"
      });
    }
  }
}

function accumulateLeafActionEffectGame(games, {
  gameId,
  coverageKey,
  disposition,
  correct,
  regret,
  conservativeRegretUpperBound,
  riskAssessmentStatus,
  sampleWeight = 1
}) {
    const boundedWeight = Number.isFinite(Number(sampleWeight))
      && Number(sampleWeight) > 0
      ? Number(sampleWeight)
      : 1;
    if (!games.has(gameId)) games.set(gameId, {
      gameId,
      coverageKeys: new Set(),
      comparisons: 0,
      decisive: 0,
      nearEquivalent: 0,
      inconclusive: 0,
      correct: 0,
      auditedComparisons: 0,
      knownZeroComparisons: 0,
      riskAssessedComparisons: 0,
      measuredRegret: 0,
      regret: 0,
      regrets: [],
      conservativeRegretUpperBound: 0,
      conservativeRegretUpperBounds: [],
      conservativeRegretWeights: []
    });
    const game = games.get(gameId);
    game.coverageKeys.add(coverageKey);
    game.comparisons += 1;
    if (riskAssessmentStatus === "audited") {
      game.auditedComparisons += 1;
      game.riskAssessedComparisons += 1;
    } else if (riskAssessmentStatus === "known-zero") {
      game.knownZeroComparisons += 1;
      game.riskAssessedComparisons += 1;
    }
    game.conservativeRegretUpperBound += conservativeRegretUpperBound;
    game.conservativeRegretUpperBounds.push(
      conservativeRegretUpperBound
    );
    game.conservativeRegretWeights.push(boundedWeight);
    if (disposition === "decisive") {
      game.decisive += 1;
      if (correct) game.correct += 1;
    } else if (disposition === "near-equivalent") {
      game.nearEquivalent += 1;
    } else {
      game.inconclusive += 1;
    }
    if (regret != null) {
      game.measuredRegret += 1;
      game.regret += regret;
      game.regrets.push(regret);
    }
}

function leafActionEffectGroup(groups, key) {
  if (!groups.has(key)) groups.set(key, new Map());
  return groups.get(key);
}

export function evaluatorConservativeRegretUpperBound({
  disposition,
  expectedDirection,
  predictedDirection,
  correct,
  lower,
  upper
} = {}) {
  const boundedLower = Math.max(-1, Math.min(1, Number(lower) || 0));
  const boundedUpper = Math.max(-1, Math.min(1, Number(upper) || 0));
  if (disposition === "near-equivalent") return 0;
  if (disposition === "decisive") {
    if (correct === true) return 0;
    return Number(expectedDirection) > 0
      ? Math.max(0, boundedUpper)
      : Math.max(0, -boundedLower);
  }
  if (Number(predictedDirection) > 0) return Math.max(0, -boundedLower);
  if (Number(predictedDirection) < 0) return Math.max(0, boundedUpper);
  return Math.max(0, -boundedLower, boundedUpper);
}

function leafActionEffectPhaseGames(accumulator, phaseBand) {
  if (!accumulator.actionEffectByPhase.has(phaseBand)) {
    accumulator.actionEffectByPhase.set(phaseBand, new Map());
  }
  return accumulator.actionEffectByPhase.get(phaseBand);
}

function finalizeLeafActionEffectRanking(
  byGame,
  byPhase,
  targetedByGame,
  targetedByPhase,
  targetedByDeckSeatPhase,
  naturalByGame,
  naturalByPhase,
  naturalByDeckSeat,
  naturalByDeckSeatPhase,
  options = {}
) {
  const phaseBands = Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map(
    (phase) => [phase, finalizeLeafActionEffectGroup(
      byPhase.get(phase),
      options
    )]
  ));
  const naturalPhaseBands = Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map(
    (phase) => [phase, finalizeLeafActionEffectGroup(
      naturalByPhase.get(phase),
      options
    )]
  ));
  const targetedPhaseBands = Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map(
    (phase) => [phase, finalizeLeafActionEffectGroup(
      targetedByPhase.get(phase),
      options
    )]
  ));
  const naturalDeckSeats = Object.fromEntries(
    [...naturalByDeckSeat.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, games]) => [
        key,
        finalizeLeafActionEffectGroup(games, options)
      ])
  );
  const naturalDeckSeatPhases = Object.fromEntries(
    [...naturalByDeckSeatPhase.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, games]) => [
        key,
        finalizeLeafActionEffectGroup(games, options)
      ])
  );
  const targetedDeckSeatPhases = Object.fromEntries(
    [...targetedByDeckSeatPhase.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, games]) => [
        key,
        finalizeLeafActionEffectGroup(games, options)
      ])
  );
  return {
    ...finalizeLeafActionEffectGroup(byGame, options),
    version: 2,
    contract: "paired-action-effect-evaluator-regret-v15",
    evidenceSource: "paired-terminal-outcome-pairs-v1",
    auditDistribution: "teacher-selected-targeted",
    phaseBands,
    targetedDecisiveAudit: {
      ...finalizeLeafActionEffectGroup(targetedByGame, options),
      evidenceSource: "paired-terminal-outcome-pairs-v1",
      auditDistribution: "teacher-selected-targeted",
      samplingContract: "teacher-selected-policy-decision-pair-v1",
      provenanceValidated: true,
      phaseBands: targetedPhaseBands,
      deckSeatPhases: targetedDeckSeatPhases
    },
    naturalDistributionAudit: {
      ...finalizeLeafActionEffectGroup(naturalByGame, options),
      evidenceSource: "paired-terminal-outcome-pairs-v1",
      auditDistribution: "natural-policy-decision-pairs",
      samplingContract: "propensity-weighted-natural-policy-decisions-v1",
      provenanceValidated: true,
      phaseBands: naturalPhaseBands,
      deckSeats: naturalDeckSeats,
      deckSeatPhases: naturalDeckSeatPhases
    }
  };
}

function finalizeLeafActionEffectGroup(games, options = {}) {
  const values = [...(games?.values() || [])];
  const comparisons = values.reduce((sum, game) => sum + game.comparisons, 0);
  const decisive = values.reduce((sum, game) => sum + game.decisive, 0);
  const nearEquivalent = values.reduce(
    (sum, game) => sum + game.nearEquivalent,
    0
  );
  const inconclusive = values.reduce(
    (sum, game) => sum + game.inconclusive,
    0
  );
  const correct = values.reduce((sum, game) => sum + game.correct, 0);
  const auditedComparisons = values.reduce(
    (sum, game) => sum + (Number(game.auditedComparisons) || 0),
    0
  );
  const knownZeroComparisons = values.reduce(
    (sum, game) => sum + (Number(game.knownZeroComparisons) || 0),
    0
  );
  const riskAssessedComparisons = values.reduce(
    (sum, game) => sum + (Number(game.riskAssessedComparisons) || 0),
    0
  );
  const riskAssessedContributingGames = values.filter((game) =>
    Number(game.riskAssessedComparisons) > 0).length;
  const measuredRegret = values.reduce(
    (sum, game) => sum + game.measuredRegret,
    0
  );
  const regret = values.reduce((sum, game) => sum + game.regret, 0);
  const conservativePopulationRegretValues = values.flatMap(
    (game) => game.conservativeRegretUpperBounds || []
  );
  const conservativePopulationRegretWeights = values.flatMap(
    (game) => game.conservativeRegretWeights
      || (game.conservativeRegretUpperBounds || []).map(() => 1)
  );
  const conservativePopulationWeight = conservativePopulationRegretWeights
    .reduce((sum, weight) => sum + Number(weight), 0);
  const conservativePopulationRegret = conservativePopulationRegretValues
    .reduce((sum, value, index) =>
      sum + Number(value) * conservativePopulationRegretWeights[index], 0);
  const populationRiskBootstrap = bootstrapLeafActionEffectPopulationRisk(
    values,
    options
  );
  const accuracyGames = values.filter((game) => game.decisive > 0).map(
    (game) => ({
      ...game,
      decisions: game.decisive,
      stratum: [...game.coverageKeys].sort().join("&") || "unknown"
    })
  );
  const accuracyInterval = conservativeStratifiedGameAccuracyInterval(
    accuracyGames,
    "correct",
    options
  );
  const stateRegrets = values.filter((game) => game.measuredRegret > 0).map(
    (game) => game.regret / game.measuredRegret
  );
  return {
    version: 1,
    contract: "paired-action-effect-evaluator-regret-v15",
    comparisons,
    contributingGames: values.length,
    auditedComparisons,
    knownZeroComparisons,
    riskAssessedComparisons,
    riskAssessedContributingGames,
    riskAssessmentCoverage: comparisons > 0
      ? riskAssessedComparisons / comparisons
      : null,
    unavailableComparisons: Math.max(
      0,
      comparisons - riskAssessedComparisons
    ),
    decisive,
    decisiveCoverage: comparisons > 0 ? decisive / comparisons : null,
    decisiveAccuracy: decisive > 0 ? correct / decisive : null,
    decisiveAccuracyInterval: accuracyInterval,
    nearEquivalent,
    nearEquivalentRate: comparisons > 0 ? nearEquivalent / comparisons : null,
    inconclusive,
    inconclusiveRate: comparisons > 0 ? inconclusive / comparisons : null,
    measuredRegretComparisons: measuredRegret,
    observedRegretCoverage: comparisons > 0
      ? measuredRegret / comparisons
      : null,
    classifiedCoverage: comparisons > 0
      ? measuredRegret / comparisons
      : null,
    expectedRegret: measuredRegret === comparisons && comparisons > 0
      ? regret / comparisons
      : null,
    conditionalExpectedRegret: measuredRegret > 0
      ? regret / measuredRegret
      : null,
    observedClassificationRegret: measuredRegret > 0
      ? regret / measuredRegret
      : null,
    observedClassificationRegretInterval:
      evaluatorRegretValueInterval(stateRegrets),
    populationRegretUpperBound: conservativePopulationWeight > 0
      ? conservativePopulationRegret / conservativePopulationWeight
      : null,
    populationEstimand: "ipw-per-decision-natural-policy-decision-pairs-v2",
    populationRiskBootstrap,
    populationRegretConfidenceInterval: populationRiskBootstrap.meanRegret,
    populationRegretConfidenceUpperBound:
      populationRiskBootstrap.meanRegret.upperBound,
    populationRegretTailRisk: evaluatorWeightedRegretTailRisk(
      conservativePopulationRegretValues,
      conservativePopulationRegretWeights
    ),
    populationRegretTailRiskConfidence: {
      method: populationRiskBootstrap.method,
      aboveThreePercentRate: populationRiskBootstrap.aboveThreePercentRate,
      aboveFivePercentRate: populationRiskBootstrap.aboveFivePercentRate,
      worstTenPercentCvar: populationRiskBootstrap.worstTenPercentCvar
    },
    expectedRegretInterval: evaluatorRegretValueInterval(stateRegrets),
    regretTailRisk: evaluatorRegretTailRisk(
      values.flatMap((game) => game.regrets)
    ),
    regretGateEligible: comparisons > 0
      && decisive > 0
      && measuredRegret > 0
  };
}

export function bootstrapLeafActionEffectPopulationRisk(
  games = [],
  options = {}
) {
  const values = (games || []).filter((game) =>
    Array.isArray(game.conservativeRegretUpperBounds)
      && game.conservativeRegretUpperBounds.length > 0)
    .map((game) => ({
      gameId: String(game.gameId),
      regrets: game.conservativeRegretUpperBounds.map(Number)
        .map((value) => Math.max(0, Math.min(1, value))),
      weights: game.conservativeRegretUpperBounds.map((_, index) => {
        const weight = Number(game.conservativeRegretWeights?.[index]);
        return Number.isFinite(weight) && weight > 0 ? weight : 1;
      })
    }))
    .filter((game) => game.regrets.length > 0
      && game.regrets.every(Number.isFinite))
    .sort((left, right) => left.gameId.localeCompare(right.gameId));
  const emptyInterval = {
    confidence: 0.95,
    lowerBound: null,
    upperBound: null
  };
  if (!values.length) return {
    version: 2,
    method: "game-cluster-percentile-bootstrap-ipw-per-decision-v2",
    estimand: "per-decision",
    weighting: "inverse-propensity-per-decision-v1",
    samples: 0,
    contributingGames: 0,
    decisions: 0,
    totalPopulationWeight: 0,
    maximumSampleWeight: null,
    meanRegret: { ...emptyInterval, pointEstimate: null },
    aboveThreePercentRate: { ...emptyInterval, pointEstimate: null },
    aboveFivePercentRate: { ...emptyInterval, pointEstimate: null },
    worstTenPercentCvar: { ...emptyInterval, pointEstimate: null },
    seedFingerprint: null
  };
  const samples = Math.max(
    500,
    Math.floor(Number(options.populationRiskBootstrapSamples) || 2000)
  );
  const seedText = values.map((game) =>
    `${game.gameId}:${game.regrets.map((value, index) =>
      `${value.toPrecision(12)}@${game.weights[index].toPrecision(12)}`
    ).join(",")}`
  ).join("|");
  let state = stableStringHash(seedText) || 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const distributions = {
    meanRegret: [],
    aboveThreePercentRate: [],
    aboveFivePercentRate: [],
    worstTenPercentCvar: []
  };
  for (let sample = 0; sample < samples; sample += 1) {
    const regrets = [];
    const weights = [];
    for (let draw = 0; draw < values.length; draw += 1) {
      const selected = values[Math.floor(random() * values.length)];
      regrets.push(...selected.regrets);
      weights.push(...selected.weights);
    }
    const tail = evaluatorWeightedRegretTailRisk(regrets, weights);
    distributions.meanRegret.push(weightedNumericMean(regrets, weights));
    distributions.aboveThreePercentRate.push(tail.aboveThreePercentRate);
    distributions.aboveFivePercentRate.push(tail.aboveFivePercentRate);
    distributions.worstTenPercentCvar.push(tail.worstTenPercentCvar);
  }
  const observed = values.flatMap((game) => game.regrets);
  const observedWeights = values.flatMap((game) => game.weights);
  const observedTail = evaluatorWeightedRegretTailRisk(
    observed,
    observedWeights
  );
  const totalObservedWeight = observedWeights.reduce(
    (sum, weight) => sum + weight,
    0
  );
  const clusterWeights = values.map((game) =>
    game.weights.reduce((sum, weight) => sum + weight, 0)
      / totalObservedWeight);
  const clusterEvents = (threshold) => values.filter((game) =>
    game.regrets.some((value) => value >= threshold)).length;
  const interval = (
    items,
    pointEstimate,
    concentrationUpperBound = null,
    clusterClopperPearsonUpperBound = null
  ) => {
    items.sort((left, right) => left - right);
    const percentile = (fraction) => items[Math.min(
      items.length - 1,
      Math.max(0, Math.floor((items.length - 1) * fraction))
    )];
    const percentileUpperBound = percentile(0.975);
    const upperBound = Math.max(
      percentileUpperBound,
      Number.isFinite(Number(concentrationUpperBound))
        ? Number(concentrationUpperBound) : 0,
      Number.isFinite(Number(clusterClopperPearsonUpperBound))
        ? Number(clusterClopperPearsonUpperBound) : 0
    );
    return {
      confidence: 0.95,
      pointEstimate,
      lowerBound: percentile(0.025),
      percentileUpperBound,
      concentrationUpperBound,
      clusterClopperPearsonUpperBound,
      upperBound: Math.min(1, upperBound)
    };
  };
  const meanConcentrationUpper = weightedClusterHoeffdingUpperBound(
    weightedNumericMean(observed, observedWeights),
    clusterWeights
  );
  const threePercentClusterUpper = Math.max(
    weightedClusterHoeffdingUpperBound(
      observedTail.aboveThreePercentRate,
      clusterWeights
    ),
    oneSidedClopperPearsonUpperBound(
      clusterEvents(0.03), values.length
    )
  );
  const fivePercentClusterUpper = Math.max(
    weightedClusterHoeffdingUpperBound(
      observedTail.aboveFivePercentRate,
      clusterWeights
    ),
    oneSidedClopperPearsonUpperBound(
      clusterEvents(0.05), values.length
    )
  );
  const positiveClusterUpper = oneSidedClopperPearsonUpperBound(
    clusterEvents(Number.EPSILON),
    values.length
  );
  const anyObservedPositiveLoss = observed.some((value) => value > 0);
  const cvarConcentration = anyObservedPositiveLoss
    ? clusterCvarConcentrationUpperBound(values, {
      tailFraction: 0.1,
      alpha: 0.05
    })
    : {
      method: "zero-loss-cluster-clopper-pearson-v1",
      positiveClusterUpperBound: positiveClusterUpper,
      upperBound: Math.min(1, positiveClusterUpper / 0.1),
      thresholds: []
    };
  const unobservedTailCvarUpper = cvarConcentration.upperBound;
  return {
    version: 2,
    method: "game-cluster-percentile-bootstrap-ipw-per-decision-v2",
    estimand: "per-decision",
    weighting: "inverse-propensity-per-decision-v1",
    samples,
    contributingGames: values.length,
    decisions: observed.length,
    totalPopulationWeight: totalObservedWeight,
    maximumSampleWeight: Math.max(...observedWeights),
    meanRegret: interval(
      distributions.meanRegret,
      weightedNumericMean(observed, observedWeights),
      meanConcentrationUpper
    ),
    aboveThreePercentRate: interval(
      distributions.aboveThreePercentRate,
      observedTail.aboveThreePercentRate,
      threePercentClusterUpper,
      oneSidedClopperPearsonUpperBound(
        clusterEvents(0.03), values.length
      )
    ),
    aboveFivePercentRate: interval(
      distributions.aboveFivePercentRate,
      observedTail.aboveFivePercentRate,
      fivePercentClusterUpper,
      oneSidedClopperPearsonUpperBound(
        clusterEvents(0.05), values.length
      )
    ),
    worstTenPercentCvar: interval(
      distributions.worstTenPercentCvar,
      observedTail.worstTenPercentCvar,
      unobservedTailCvarUpper,
      anyObservedPositiveLoss ? null : positiveClusterUpper
    ),
    cvarConcentration,
    seedFingerprint:
      `stable:${stableStringHash(seedText).toString(16).padStart(8, "0")}`
  };
}

function clusterCvarConcentrationUpperBound(games = [], options = {}) {
  const tailFraction = Math.max(
    Number.EPSILON,
    Math.min(1, Number(options.tailFraction) || 0.1)
  );
  const thresholds = [
    0, 0.001, 0.003, 0.01, 0.03, 0.05, 0.1, 0.2, 0.5, 1
  ];
  const alpha = Math.max(Number.EPSILON, Number(options.alpha) || 0.05)
    / thresholds.length;
  const totalDecisionWeight = games.reduce(
    (sum, game) => sum + game.weights.reduce(
      (gameSum, weight) => gameSum + weight,
      0
    ),
    0
  );
  const weights = games.map((game) => game.weights.reduce(
    (sum, weight) => sum + weight,
    0
  ) / totalDecisionWeight);
  const candidates = thresholds.map((threshold) => {
    const clusterExcessMeans = games.map((game) => weightedNumericMean(
      game.regrets.map((regret) => Math.max(0, regret - threshold)),
      game.weights
    ));
    const excessMean = clusterExcessMeans.reduce(
      (sum, value, index) => sum + weights[index] * value,
      0
    );
    const excessUpperBound = weightedClusterEmpiricalBernsteinUpperBound(
      clusterExcessMeans,
      weights,
      Math.max(0, 1 - threshold),
      alpha
    );
    return {
      threshold,
      excessMean,
      excessUpperBound,
      cvarUpperBound: Math.min(
        1,
        threshold + excessUpperBound / tailFraction
      )
    };
  });
  const selected = [...candidates].sort((left, right) =>
    left.cvarUpperBound - right.cvarUpperBound
      || left.threshold - right.threshold)[0];
  return {
    method: "game-cluster-bonferroni-cvar-excess-bernstein-v1",
    tailFraction,
    familywiseAlpha: Number(options.alpha) || 0.05,
    thresholdAlpha: alpha,
    upperBound: selected?.cvarUpperBound ?? 1,
    selectedThreshold: selected?.threshold ?? null,
    thresholds: candidates
  };
}

function weightedClusterEmpiricalBernsteinUpperBound(
  values,
  weights,
  range,
  alpha
) {
  if (!values.length || values.length !== weights.length) return range;
  const estimate = values.reduce(
    (sum, value, index) => sum + weights[index] * value,
    0
  );
  const squaredWeightSum = weights.reduce(
    (sum, weight) => sum + weight * weight,
    0
  );
  const maximumWeight = Math.max(...weights);
  const variance = values.reduce(
    (sum, value, index) =>
      sum + weights[index] * (value - estimate) ** 2,
    0
  );
  const logTerm = Math.log(3 / Math.max(Number.EPSILON, alpha));
  const radius = Math.sqrt(
    2 * variance * squaredWeightSum * logTerm
  ) + 3 * range * maximumWeight * logTerm;
  return Math.min(range, Math.max(0, estimate + radius));
}

function weightedClusterHoeffdingUpperBound(
  pointEstimate,
  weights = [],
  alpha = 0.05
) {
  const squaredWeightSum = weights.reduce(
    (sum, weight) => sum + Number(weight) ** 2,
    0
  );
  if (!(squaredWeightSum > 0)) return 1;
  const radius = Math.sqrt(
    Math.log(1 / Math.max(Number.EPSILON, alpha))
      * squaredWeightSum / 2
  );
  return Math.min(1, Math.max(0, Number(pointEstimate) || 0) + radius);
}

function oneSidedClopperPearsonUpperBound(
  successes,
  attempts,
  alpha = 0.05
) {
  const n = Math.max(0, Math.floor(Number(attempts) || 0));
  const k = Math.max(0, Math.min(n, Math.floor(Number(successes) || 0)));
  if (n === 0 || k === n) return 1;
  if (k === 0) return 1 - Math.pow(alpha, 1 / n);
  let lower = k / n;
  let upper = 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (binomialCdf(k, n, middle) > alpha) lower = middle;
    else upper = middle;
  }
  return upper;
}

function binomialCdf(maximumSuccesses, attempts, probability) {
  const p = Math.max(0, Math.min(1, Number(probability)));
  if (p === 1) return maximumSuccesses >= attempts ? 1 : 0;
  if (p === 0) return 1;
  const q = 1 - p;
  let term = Math.pow(q, attempts);
  let total = term;
  for (let successes = 1;
    successes <= maximumSuccesses;
    successes += 1) {
    term *= (attempts - successes + 1) / successes * p / q;
    total += term;
  }
  return Math.max(0, Math.min(1, total));
}

function evaluatorRegretValueInterval(values = [], confidence = 0.95) {
  const finite = values.map(Number).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!finite.length) return {
    method: "game-cluster-hoeffding-v1",
    confidence,
    games: 0,
    mean: null,
    lowerBound: null,
    upperBound: null
  };
  const averageValue = mean(finite);
  const radius = Math.sqrt(Math.log(2 / (1 - confidence)) / (2 * finite.length));
  return {
    method: "game-cluster-hoeffding-v1",
    confidence,
    games: finite.length,
    mean: averageValue,
    lowerBound: Math.max(0, averageValue - radius),
    upperBound: Math.min(1, averageValue + radius)
  };
}

function actionPhaseGame(accumulator, phase, gameId) {
  if (!accumulator.byPhase.has(phase)) accumulator.byPhase.set(phase, new Map());
  const games = accumulator.byPhase.get(phase);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      statePairs: 0,
      neuralCorrect: 0,
      heuristicCorrect: 0,
      neuralOnly: 0,
      heuristicOnly: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function actionClassAuditGame(accumulator, actionClass, gameId) {
  if (!accumulator.byActionClass.has(actionClass)) {
    accumulator.byActionClass.set(actionClass, new Map());
  }
  const games = accumulator.byActionClass.get(actionClass);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      statePairs: 0,
      neuralCorrect: 0,
      heuristicCorrect: 0,
      neuralOnly: 0,
      heuristicOnly: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function actionDeckSeatAuditGame(accumulator, deckSeat, gameId) {
  if (!accumulator.byDeckSeat.has(deckSeat)) {
    accumulator.byDeckSeat.set(deckSeat, new Map());
  }
  const games = accumulator.byDeckSeat.get(deckSeat);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      statePairs: 0,
      neuralCorrect: 0,
      heuristicCorrect: 0,
      neuralOnly: 0,
      heuristicOnly: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function actionCompositeAuditGame(groups, key, gameId) {
  if (!groups.has(key)) groups.set(key, new Map());
  const games = groups.get(key);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      statePairs: 0,
      neuralCorrect: 0,
      heuristicCorrect: 0,
      neuralOnly: 0,
      heuristicOnly: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function addAuditOpportunity(opportunities, deckSeat, value) {
  if (!deckSeat || !value || value === "unknown") return;
  if (!opportunities.has(deckSeat)) opportunities.set(deckSeat, new Set());
  opportunities.get(deckSeat).add(value);
}

function auditOpportunityKeys(opportunities) {
  return [...opportunities.entries()].flatMap(([deckSeat, values]) =>
    [...values].map((value) => `${deckSeat}::${value}`)).sort();
}

function leafPhaseGame(accumulator, phase, gameId) {
  if (!accumulator.byPhase.has(phase)) accumulator.byPhase.set(phase, new Map());
  const games = accumulator.byPhase.get(phase);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      correct: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function leafDeckSeatAuditGame(accumulator, deckSeat, gameId) {
  if (!accumulator.byDeckSeat.has(deckSeat)) {
    accumulator.byDeckSeat.set(deckSeat, new Map());
  }
  const games = accumulator.byDeckSeat.get(deckSeat);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      correct: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function leafCompositeAuditGame(groups, key, gameId) {
  if (!groups.has(key)) groups.set(key, new Map());
  const games = groups.get(key);
  if (!games.has(gameId)) {
    games.set(gameId, {
      gameId,
      decisions: 0,
      correct: 0,
      coverageKeys: new Set()
    });
  }
  return games.get(gameId);
}

function finalizeActionAuditGroups(groups, options = {}, expectedKeys = []) {
  const keys = [...new Set([...expectedKeys, ...groups.keys()])].sort();
  return Object.fromEntries(keys.map((key) => [
    key,
    finalizeActionPhaseBand(groups.get(key), options)
  ]));
}

function finalizeLeafAuditGroups(groups, options = {}, expectedKeys = []) {
  const keys = [...new Set([...expectedKeys, ...groups.keys()])].sort();
  return Object.fromEntries(keys.map((key) => [
    key,
    finalizeLeafPhaseBand(groups.get(key), options)
  ]));
}

function finalizeActionPhaseBand(games, options = {}) {
  const values = [...(games?.values() || [])].map((game) => ({
    ...game,
    improvement: game.decisions
      ? (game.neuralOnly - game.heuristicOnly) / game.decisions
      : 0,
    stratum: [...game.coverageKeys].sort().join("&") || "unknown"
  }));
  const bootstrap = bootstrapStratifiedGamePairedImprovements(values, {
    samples: options.bootstrapSamples
  });
  const decisions = values.reduce((sum, game) => sum + game.decisions, 0);
  const neuralCorrect = values.reduce(
    (sum, game) => sum + game.neuralCorrect,
    0
  );
  const comparatorCorrect = values.reduce(
    (sum, game) => sum + game.heuristicCorrect,
    0
  );
  const neuralInterval = conservativeStratifiedGameAccuracyInterval(
    values,
    "neuralCorrect"
  );
  const comparatorInterval = conservativeStratifiedGameAccuracyInterval(
    values,
    "heuristicCorrect"
  );
  return {
    decisions,
    contributingGames: values.length,
    neuralAccuracy: macroAccuracyByStratum(values, "neuralCorrect"),
    neuralAccuracyLowerBound: neuralInterval.lowerBound,
    neuralAccuracyUpperBound: neuralInterval.upperBound,
    neuralAccuracyInterval: neuralInterval,
    comparatorAccuracy: macroAccuracyByStratum(values, "heuristicCorrect"),
    comparatorAccuracyLowerBound: comparatorInterval.lowerBound,
    comparatorAccuracyUpperBound: comparatorInterval.upperBound,
    comparatorAccuracyInterval: comparatorInterval,
    pairedImprovement: bootstrap.mean,
    pairedImprovementLowerBound: bootstrap.lowerBound,
    pairedImprovementUpperBound: bootstrap.upperBound,
    bootstrap
  };
}

function finalizeLeafPhaseBand(games, options = {}) {
  const values = [...(games?.values() || [])].map((game) => ({
    ...game,
    improvement: game.decisions ? game.correct / game.decisions - 0.5 : 0,
    stratum: [...game.coverageKeys].sort().join("&") || "unknown"
  }));
  const bootstrap = bootstrapStratifiedGamePairedImprovements(values, {
    samples: options.bootstrapSamples
  });
  const decisions = values.reduce((sum, game) => sum + game.decisions, 0);
  const correct = values.reduce((sum, game) => sum + game.correct, 0);
  const interval = conservativeStratifiedGameAccuracyInterval(
    values,
    "correct"
  );
  return {
    decisions,
    contributingGames: values.length,
    accuracy: macroAccuracyByStratum(values, "correct"),
    accuracyLowerBound: interval.lowerBound,
    accuracyUpperBound: interval.upperBound,
    accuracyInterval: interval,
    pairedAdvantage: bootstrap.mean,
    pairedAdvantageLowerBound: bootstrap.lowerBound,
    pairedAdvantageUpperBound: bootstrap.upperBound,
    bootstrap
  };
}

function conservativeStratifiedGameAccuracyInterval(
  games = [],
  correctKey,
  options = {}
) {
  const values = (games || []).filter((game) =>
    Number(game?.decisions) > 0
      && Number.isFinite(Number(game?.[correctKey])));
  if (!values.length) {
    return {
      lowerBound: null,
      upperBound: null,
      mean: null,
      contributingGames: 0,
      effectiveGames: 0,
      method: "unavailable"
    };
  }
  const byStratum = new Map();
  for (const game of values) {
    const stratum = String(game.stratum || "unknown");
    if (!byStratum.has(stratum)) byStratum.set(stratum, []);
    byStratum.get(stratum).push(game);
  }
  const groups = [...byStratum.values()];
  const groupWeight = 1 / groups.length;
  let mean = 0;
  let squaredWeightSum = 0;
  for (const group of groups) {
    const groupDecisions = group.reduce(
      (sum, game) => sum + Number(game.decisions),
      0
    );
    const groupCorrect = group.reduce(
      (sum, game) => sum + Number(game[correctKey]),
      0
    );
    if (!(groupDecisions > 0)) continue;
    mean += groupWeight * (groupCorrect / groupDecisions);
    for (const game of group) {
      const weight = groupWeight
        * (Number(game.decisions) / groupDecisions);
      squaredWeightSum += weight * weight;
    }
  }
  const alpha = Math.max(
    Number.EPSILON,
    Math.min(0.25, Number(options.alpha) || 0.05)
  );
  const radius = squaredWeightSum > 0
    ? Math.sqrt(Math.log(2 / alpha) * squaredWeightSum / 2)
    : 1;
  return {
    lowerBound: Math.max(0, mean - radius),
    upperBound: Math.min(1, mean + radius),
    mean,
    contributingGames: values.length,
    effectiveGames: squaredWeightSum > 0 ? 1 / squaredWeightSum : 0,
    radius,
    alpha,
    method: "deck-seat-stratified-game-hoeffding-v1"
  };
}

export function evaluateLeafValueRankingAudit(model, trajectories, options = {}) {
  return finalizeLeafValueRankingAudit(
    accumulateLeafValueRankingAudit(
      model,
      trajectories,
      createLeafValueRankingAuditAccumulator(),
      options
    ),
    options
  );
}

function estimateAuditEvidenceValue(
  model,
  encodedState,
  structuredState,
  step,
  options = {}
) {
  const validStructured = validEvidenceStructuredState(
    structuredState,
    step,
    options
  );
  if (options.requireStructuredV2 === true && !validStructured) return null;
  if (evaluatorRequiresStructuredV2(model)) {
    if (!validStructured) return null;
    return estimateEvidenceNeuralValue(
      model,
      encodedState,
      structuredState,
      {
        engineFingerprint: options.engineFingerprint,
        informationSetHash: step?.informationSetHash,
        targetHead: options.targetHead
      }
    );
  }
  return estimateEncodedNeuralValue(model, encodedState, {
    targetHead: options.targetHead
  });
}

function trajectoryDeckSeatKey(trajectory) {
  const seat = trajectory?.playerId === "p1"
    || trajectory?.playerId === "p2"
    ? trajectory.playerId
    : Number(trajectory?.playerSeat) === 0
      ? "p1"
      : Number(trajectory?.playerSeat) === 1
        ? "p2"
        : "unknown";
  return `${trajectory?.deckId || "unknown"}:${seat}`;
}

function macroAccuracyByStratum(gameResults, correctKey) {
  const strata = new Map();
  for (const game of gameResults || []) {
    const stratum = String(game.stratum || "unknown");
    const aggregate = strata.get(stratum) || {
      correct: 0,
      decisions: 0
    };
    aggregate.correct += Number(game[correctKey]) || 0;
    aggregate.decisions += Number(game.decisions) || 0;
    strata.set(stratum, aggregate);
  }
  const accuracies = [...strata.values()]
    .filter((item) => item.decisions > 0)
    .map((item) => item.correct / item.decisions);
  return mean(accuracies);
}

export function bootstrapStratifiedGamePairedImprovements(
  gameResults,
  options = {}
) {
  const normalized = (gameResults || [])
    .map((item, index) => ({
      gameId: String(item?.gameId || `game-${index}`),
      stratum: String(item?.stratum || "unknown"),
      improvement: Number(item?.improvement)
    }))
    .filter((item) => Number.isFinite(item.improvement))
    .sort((left, right) =>
      left.stratum.localeCompare(right.stratum)
        || left.gameId.localeCompare(right.gameId));
  if (!normalized.length) {
    return {
      version: 1,
      unit: "game",
      stratification: "deck-seat-macro",
      samples: 0,
      contributingGames: 0,
      strata: 0,
      mean: 0,
      lowerBound: null,
      upperBound: null,
      seedFingerprint: null
    };
  }
  const byStratum = new Map();
  for (const item of normalized) {
    if (!byStratum.has(item.stratum)) byStratum.set(item.stratum, []);
    byStratum.get(item.stratum).push(item);
  }
  const groups = [...byStratum.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const samples = Math.max(200, Math.floor(Number(options.samples) || 2000));
  const seedText = normalized
    .map((item) =>
      `${item.stratum}:${item.gameId}:${item.improvement.toPrecision(12)}`)
    .join("|");
  let state = stableStringHash(seedText) || 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const bootstrapMeans = new Array(samples);
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    let macroTotal = 0;
    for (const [, items] of groups) {
      let stratumTotal = 0;
      for (let draw = 0; draw < items.length; draw += 1) {
        stratumTotal +=
          items[Math.floor(random() * items.length)].improvement;
      }
      macroTotal += stratumTotal / items.length;
    }
    bootstrapMeans[sampleIndex] = macroTotal / groups.length;
  }
  bootstrapMeans.sort((left, right) => left - right);
  const percentile = (fraction) =>
    bootstrapMeans[Math.min(
      samples - 1,
      Math.max(0, Math.floor((samples - 1) * fraction))
    )];
  return {
    version: 1,
    unit: "game",
    stratification: "deck-seat-macro",
    samples,
    contributingGames: normalized.length,
    strata: groups.length,
    mean: mean(groups.map(([, items]) =>
      mean(items.map((item) => item.improvement)))),
    lowerBound: percentile(0.025),
    upperBound: percentile(0.975),
    seedFingerprint:
      `stable:${stableStringHash(seedText).toString(16).padStart(8, "0")}`
  };
}

export function bootstrapGamePairedImprovements(gameResults, options = {}) {
  const normalized = (gameResults || [])
    .map((item, index) => ({
      gameId: String(item?.gameId || `game-${index}`),
      improvement: Number(item?.improvement)
    }))
    .filter((item) => Number.isFinite(item.improvement))
    .sort((left, right) => left.gameId.localeCompare(right.gameId));
  if (!normalized.length) {
    return {
      version: 1,
      unit: "game",
      samples: 0,
      contributingGames: 0,
      mean: 0,
      lowerBound: null,
      upperBound: null,
      seedFingerprint: null
    };
  }
  const samples = Math.max(200, Math.floor(Number(options.samples) || 2000));
  const seedText = normalized
    .map((item) => `${item.gameId}:${item.improvement.toPrecision(12)}`)
    .join("|");
  let state = stableStringHash(seedText) || 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const bootstrapMeans = new Array(samples);
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    let total = 0;
    for (let draw = 0; draw < normalized.length; draw += 1) {
      total += normalized[Math.floor(random() * normalized.length)].improvement;
    }
    bootstrapMeans[sampleIndex] = total / normalized.length;
  }
  bootstrapMeans.sort((left, right) => left - right);
  const percentile = (fraction) =>
    bootstrapMeans[Math.min(samples - 1, Math.max(0, Math.floor((samples - 1) * fraction)))];
  return {
    version: 1,
    unit: "game",
    samples,
    contributingGames: normalized.length,
    mean: mean(normalized.map((item) => item.improvement)),
    lowerBound: percentile(0.025),
    upperBound: percentile(0.975),
    seedFingerprint: `stable:${stableStringHash(seedText).toString(16).padStart(8, "0")}`
  };
}

export async function serializeOptimizer(optimizer, modelGeneration) {
  const weights = await optimizer.getWeights();
  const serialized = weights.map((item) => ({ name: item.name, shape: item.tensor.shape, values: Array.from(item.tensor.dataSync()) }));
  // Adam#getWeights returns its moment Variables by reference. Disposing those
  // entries corrupts the live optimizer and makes the next checkpoint fail.
  // Only the iteration counter is a temporary Tensor created for this read.
  weights.find((item) => item.name === "iter")?.tensor.dispose();
  return { version: 1, kind: "adam", modelGeneration, weights: serialized };
}

export async function restoreAdamOptimizer(state, learningRate = 0.0003) {
  const optimizer = tf.train.adam(learningRate);
  if (!state?.weights?.length) return optimizer;
  const weights = state.weights.map((item) => ({ name: item.name, tensor: tf.tensor(item.values, item.shape) }));
  await optimizer.setWeights(weights);
  weights.forEach((item) => item.tensor.dispose());
  return optimizer;
}

export function packPpoBatch(chunks, options = {}) {
  const ignoreCorrectionSignals = options.ignoreCorrectionSignals === true;
  const batchSize = chunks.length;
  const sequenceLength = Math.max(1, ...chunks.map((chunk) => chunk.steps.length));
  const actionCount = Math.max(1, ...chunks.flatMap((chunk) => chunk.steps.map((step) => step.legalCount)));
  if (actionCount > MAX_ACTIONS) throw new Error("Batch exceeds legal action capacity.");
  const states = new Float32Array(batchSize * sequenceLength * STATE_DIM);
  const initialMemories = new Float32Array(batchSize * NEURAL_HIDDEN_SIZE);
  const actions = new Float32Array(batchSize * sequenceLength * actionCount * ACTION_DIM);
  const selectedIndices = new Int32Array(batchSize * sequenceLength);
  const legalCounts = new Int32Array(batchSize * sequenceLength);
  const oldLogProbabilities = new Float32Array(batchSize * sequenceLength);
  const behaviorTemperatures = new Float32Array(batchSize * sequenceLength);
  const advantages = new Float32Array(batchSize * sequenceLength);
  const returns = new Float32Array(batchSize * sequenceLength);
  const outcomeTargets = new Float32Array(batchSize * sequenceLength);
  const stepMask = new Float32Array(batchSize * sequenceLength);
  const policyStepWeights = new Float32Array(batchSize * sequenceLength);
  const teacherIndices = new Int32Array(batchSize * sequenceLength);
  const teacherWeights = new Float32Array(batchSize * sequenceLength);
  const teacherMargins = new Float32Array(batchSize * sequenceLength);
  const teacherTargets = new Float32Array(batchSize * sequenceLength * actionCount);
  const teacherSupports = new Float32Array(batchSize * sequenceLength * actionCount);
  const teacherActionValueTargets = new Float32Array(batchSize * sequenceLength * actionCount);
  const teacherActionValueWeights = new Float32Array(batchSize * sequenceLength * actionCount);
  const diagnosticTargets = new Float32Array(batchSize * sequenceLength * 2);
  const diagnosticWeights = new Float32Array(batchSize * sequenceLength * 2);
  const beliefTargets = new Float32Array(batchSize * sequenceLength * CARD_BINS);
  const advantageValues = chunks.flatMap((chunk) => chunk.steps.map((step) => step.advantage));
  const advantageMean = mean(advantageValues);
  const advantageDeviation = Math.sqrt(mean(advantageValues.map((value) => (value - advantageMean) ** 2))) || 1;
  const imitationBatch = chunks.every((chunk) => chunk.steps.every((step) => step.imitation));
  chunks.forEach((chunk, batchIndex) => {
    initialMemories.set(chunk.steps[0]?.initialMemory || [], batchIndex * NEURAL_HIDDEN_SIZE);
    chunk.steps.forEach((step, stepIndex) => {
      const flat = batchIndex * sequenceLength + stepIndex;
      states.set(step.state, flat * STATE_DIM);
      actions.set(step.actions.slice(0, step.legalCount * ACTION_DIM), flat * actionCount * ACTION_DIM);
      selectedIndices[flat] = step.selectedIndex;
      legalCounts[flat] = Math.max(1, step.legalCount);
      oldLogProbabilities[flat] = step.oldLogProbability;
      behaviorTemperatures[flat] = Math.max(0.05, Number(step.behaviorTemperature) || 1);
      advantages[flat] = imitationBatch ? step.advantage : (step.advantage - advantageMean) / advantageDeviation;
      returns[flat] = step.return;
      outcomeTargets[flat] = Number(step.terminalOutcome ?? (chunk.won === true ? 1 : chunk.won === false ? -1 : 0)) > 0 ? 1 : 0;
      stepMask[flat] = 1;
      // Do not simultaneously rehearse the student's old action through PPO
      // at a state where a verified teacher/proof/postmortem correction says
      // that a different action was preferable. Value and belief targets from
      // the game remain useful, so only policy-connected losses are masked.
      policyStepWeights[flat] = !ignoreCorrectionSignals
        && !step.imitation
        && correctionConflictsWithBehavior(step)
        ? 0
        : 1;
      teacherIndices[flat] = Math.max(0, Math.min(step.legalCount - 1, step.teacherIndex || 0));
      const supportedTeacherLabel = !ignoreCorrectionSignals
        && (step.imitation === true
        || (step.teacherLabelVersion === TEACHER_LABEL_VERSION
          && step.teacherCorrectionEligible === true
          && step.teacherVerificationStatus === "verified"
          && step.teacherPolicyEligible === true));
      teacherWeights[flat] = supportedTeacherLabel
        ? Math.max(0, Math.min(1, step.teacherConfidence || 0))
        : 0;
      teacherMargins[flat] = teacherWeights[flat] > 0 && teacherIndices[flat] !== selectedIndices[flat]
        ? Math.max(0.05, Math.min(0.5, Number(step.teacherRankingMargin) || 0.05))
        : 0;
      const softTargets = step.teacherTargets;
      if (Array.isArray(softTargets) && softTargets.length) {
        teacherTargets.set(softTargets.slice(0, actionCount), flat * actionCount);
      } else if (teacherWeights[flat] > 0) {
        teacherTargets[flat * actionCount + teacherIndices[flat]] = 1;
      }
      const valueTargets = step.teacherActionValueTargets;
      const valueWeights = step.teacherActionValueWeights;
      const supportedActionValueLabel = !ignoreCorrectionSignals
        && (supportedTeacherLabel
        || (step.teacherLabelVersion === TEACHER_LABEL_VERSION
          && step.teacherActionValueEligible === true
          && (step.teacherVerificationStatus === "verified"
            || provisionalTeacherStepHasIndependentEvidence(step))));
      if (supportedActionValueLabel
        && (Array.isArray(valueTargets) || ArrayBuffer.isView(valueTargets))
        && (Array.isArray(valueWeights) || ArrayBuffer.isView(valueWeights))) {
        teacherActionValueTargets.set(Array.from(valueTargets).slice(0, actionCount), flat * actionCount);
        teacherActionValueWeights.set(Array.from(valueWeights).slice(0, actionCount), flat * actionCount);
      }
      if (teacherWeights[flat] > 0) {
        const explicitSupport = Array.isArray(step.teacherSupport) || ArrayBuffer.isView(step.teacherSupport)
          ? Array.from(step.teacherSupport)
          : null;
        for (let actionIndex = 0; actionIndex < legalCounts[flat]; actionIndex += 1) {
          const offset = flat * actionCount + actionIndex;
          // Only searched/proven alternatives belong to the distillation
          // support. The actually selected action is included as a contrast,
          // even when it has target probability zero. Unsearched actions stay
          // masked and are never taught as negatives.
          teacherSupports[offset] = explicitSupport
            ? (Number(explicitSupport[actionIndex]) > 0 ? 1 : 0)
            : (teacherTargets[offset] > 0 || teacherActionValueWeights[offset] > 0 ? 1 : 0);
        }
        teacherSupports[flat * actionCount + teacherIndices[flat]] = 1;
        teacherSupports[flat * actionCount + selectedIndices[flat]] = 1;
      }
      for (const [diagnosticIndex, field] of [
        [0, "resourceReservationDiagnosticReward"],
        [1, "handOpportunityDiagnosticReward"]
      ]) {
        if (step[field] == null || !Number.isFinite(Number(step[field]))) continue;
        diagnosticTargets[flat * 2 + diagnosticIndex] = Math.max(-1, Math.min(1, Number(step[field])));
        diagnosticWeights[flat * 2 + diagnosticIndex] = 1;
      }
      beliefTargets.set(step.beliefTarget, flat * CARD_BINS);
    });
  });
  return {
    actionCount, shape: [batchSize, sequenceLength], states, initialMemories, actions, selectedIndices, legalCounts,
    oldLogProbabilities, behaviorTemperatures, advantages, returns, outcomeTargets, stepMask, policyStepWeights,
    teacherIndices, teacherWeights, teacherMargins, teacherTargets, teacherSupports, teacherActionValueTargets,
    teacherActionValueWeights, diagnosticTargets, diagnosticWeights, beliefTargets
  };
}

function correctionConflictsWithBehavior(step) {
  const selectedIndex = Number(step.selectedIndex);
  const verifiedTeacherConflict = step.teacherLabelVersion === TEACHER_LABEL_VERSION
    && step.teacherCorrectionEligible === true
    && step.teacherVerificationStatus === "verified"
    && step.teacherPolicyEligible === true
    && Number(step.teacherIndex) !== selectedIndex;
  const engineProofConflict = step.proofLabelVersion === PROOF_LABEL_VERSION
    && step.proofCorrectionEligible === true
    && (step.proofEvidenceKind === "engine-proof" || step.proofKind === "immediate-terminal-win")
    && Number(step.proofIndex) !== selectedIndex;
  const postmortemIndex = step.postmortemCorrectionSteps?.[0]?.teacherIndex
    ?? step.postmortemCorrectionSteps?.[0]?.selectedIndex;
  const postmortemConflict = (step.postmortemReview?.verifiedLocalRegret === true
      || step.postmortemReview?.avoidableLoss === true)
    && Number.isFinite(Number(postmortemIndex))
    && Number(postmortemIndex) !== selectedIndex;
  return verifiedTeacherConflict || engineProofConflict || postmortemConflict;
}

export function calibrateValueHead(trajectories) {
  const samples = [];
  for (const trajectory of trajectories) {
    if (!trajectory.steps.length) continue;
    const outcomeValue = trajectory.terminalOutcome
      ?? trajectory.steps.at(-1).terminalOutcome
      ?? (trajectory.won === true ? 1 : trajectory.won === false ? -1 : null);
    if (!Number.isFinite(Number(outcomeValue))) continue;
    const outcome = Number(outcomeValue) > 0 ? 1 : 0;
    for (const step of trajectory.steps) samples.push({ value: clamp(step.value, -0.999, 0.999), outcome });
  }
  return calibrateValueSamples(samples);
}

export function calibrateValueSamples(samples, options = {}) {
  const testSamples = options.testSamples?.length ? options.testSamples : samples;
  if (samples.length < 10 || testSamples.length < 2) return {
    temperature: 1,
    bias: 0,
    brier: null,
    expectedCalibrationError: null,
    rankingAuc: null,
    calibrationSlope: null,
    logLoss: null,
    bins: [],
    samples: testSamples.length,
    fitSamples: samples.length,
    testSamples: testSamples.length,
    fitGames: options.fitGames ?? null,
    testGames: options.testGames ?? null,
    evaluationScope: options.testSamples ? "independent-game-holdout" : "in-sample",
    teacherPromotionEligible: false,
    teacherPromotionReasons: ["insufficient-calibration-samples"]
  };
  const normalized = samples.map((sample) => ({ value: clamp(sample.value, -0.999, 0.999), outcome: sample.outcome ? 1 : 0 }));
  const normalizedTest = testSamples.map((sample) => ({
    value: clamp(sample.value, -0.999, 0.999),
    outcome: sample.outcome ? 1 : 0,
    gameId: sample.gameId || null
  }));
  const observedRate = mean(normalized.map((sample) => sample.outcome));
  let best = { temperature: 1, bias: 0, loss: Infinity };
  for (let temperature = 0.35; temperature <= 6; temperature += 0.05) {
    const bias = fitCalibrationBias(normalized, temperature, observedRate);
    const loss = mean(samples.map((sample) => {
      const probability = calibratedProbability(clamp(sample.value, -0.999, 0.999), temperature, bias);
      return -(sample.outcome * Math.log(probability) + (1 - sample.outcome) * Math.log(1 - probability));
    }));
    if (loss < best.loss) best = { temperature, bias, loss };
  }
  const bins = Array.from({ length: 10 }, (_, index) => ({ low: index / 10, high: (index + 1) / 10, count: 0, probabilitySum: 0, outcomeSum: 0 }));
  const scoredTest = normalizedTest.map((sample) => ({
    ...sample,
    probability: calibratedProbability(
      clamp(sample.value, -0.999, 0.999),
      best.temperature,
      best.bias
    )
  }));
  let brier = 0;
  let logLoss = 0;
  for (const sample of scoredTest) {
    const probability = sample.probability;
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.count += 1;
    bin.probabilitySum += probability;
    bin.outcomeSum += sample.outcome;
    brier += (probability - sample.outcome) ** 2;
    logLoss += -(sample.outcome * Math.log(probability)
      + (1 - sample.outcome) * Math.log(1 - probability));
  }
  const publishedBins = bins.filter((bin) => bin.count).map((bin) => ({
    low: bin.low, high: bin.high, count: bin.count,
    predicted: bin.probabilitySum / bin.count, observed: bin.outcomeSum / bin.count
  }));
  const expectedCalibrationError = publishedBins.reduce((sum, bin) =>
    sum + bin.count / normalizedTest.length * Math.abs(bin.predicted - bin.observed), 0);
  const rankingAuc = binaryRankingAuc(scoredTest.map((sample) => ({
    score: sample.probability,
    outcome: sample.outcome
  })));
  const calibrationSlope = logisticCalibrationSlope(scoredTest);
  const bootstrap = bootstrapCalibrationByGame(
    normalizedTest,
    best.temperature,
    best.bias
  );
  const teacherPromotionReasons = [];
  if (Number(options.testGames) < 100) teacherPromotionReasons.push("insufficient-test-games");
  if (brier / normalizedTest.length > 0.3) teacherPromotionReasons.push("high-brier");
  if (expectedCalibrationError > 0.25) teacherPromotionReasons.push("high-ece");
  if (!Number.isFinite(rankingAuc) || rankingAuc < 0.5) teacherPromotionReasons.push("weak-ranking");
  return {
    temperature: best.temperature,
    bias: best.bias,
    fitLogLoss: best.loss,
    logLoss: logLoss / normalizedTest.length,
    brier: brier / normalizedTest.length,
    expectedCalibrationError,
    rankingAuc,
    calibrationSlope,
    bootstrap,
    bins: publishedBins,
    samples: normalizedTest.length,
    fitSamples: normalized.length,
    testSamples: normalizedTest.length,
    fitGames: options.fitGames ?? null,
    testGames: options.testGames ?? null,
    evaluationScope: options.testSamples ? "independent-game-holdout" : "in-sample",
    teacherPromotionEligible: teacherPromotionReasons.length === 0,
    teacherPromotionReasons
  };
}

// Evaluate an already-frozen calibration without fitting temperature or bias
// on the protected dataset. This is used by confirmation/final audit after
// architecture and calibration selection have both finished on development.
export function evaluateCalibratedValueSamples(
  samples,
  calibration = {},
  options = {}
) {
  const normalized = (samples || []).flatMap((sample) =>
    Number.isFinite(Number(sample?.value))
      && Number.isFinite(Number(sample?.outcome))
      ? [{
        value: clamp(Number(sample.value), -0.999, 0.999),
        outcome: Number(sample.outcome) > 0 ? 1 : 0,
        gameId: sample.gameId || null
      }]
      : []);
  const temperature = Math.max(
    0.05,
    Number(calibration?.temperature) || 1
  );
  const bias = Number(calibration?.bias) || 0;
  if (normalized.length < 2) return {
    temperature,
    bias,
    brier: null,
    expectedCalibrationError: null,
    rankingAuc: null,
    calibrationSlope: null,
    logLoss: null,
    bins: [],
    samples: normalized.length,
    fitSamples: Number(options.fitSamples) || null,
    testSamples: normalized.length,
    fitGames: options.fitGames ?? null,
    testGames: options.testGames ?? null,
    evaluationScope: "frozen-independent-game-holdout",
    teacherPromotionEligible: false,
    teacherPromotionReasons: ["insufficient-calibration-samples"]
  };
  const bins = Array.from({ length: 10 }, (_, index) => ({
    low: index / 10,
    high: (index + 1) / 10,
    count: 0,
    probabilitySum: 0,
    outcomeSum: 0
  }));
  let brier = 0;
  let logLoss = 0;
  const scored = normalized.map((sample) => {
    const probability = calibratedProbability(
      sample.value,
      temperature,
      bias
    );
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.count += 1;
    bin.probabilitySum += probability;
    bin.outcomeSum += sample.outcome;
    brier += (probability - sample.outcome) ** 2;
    logLoss += -(sample.outcome * Math.log(probability)
      + (1 - sample.outcome) * Math.log(1 - probability));
    return { ...sample, probability };
  });
  const publishedBins = bins.filter((bin) => bin.count).map((bin) => ({
    low: bin.low,
    high: bin.high,
    count: bin.count,
    predicted: bin.probabilitySum / bin.count,
    observed: bin.outcomeSum / bin.count
  }));
  const expectedCalibrationError = publishedBins.reduce((sum, bin) =>
    sum + bin.count / normalized.length
      * Math.abs(bin.predicted - bin.observed), 0);
  const rankingAuc = binaryRankingAuc(scored.map((sample) => ({
    score: sample.probability,
    outcome: sample.outcome
  })));
  const calibrationSlope = logisticCalibrationSlope(scored);
  const bootstrap = bootstrapCalibrationByGame(
    normalized,
    temperature,
    bias
  );
  const teacherPromotionReasons = [];
  if (Number(options.testGames) < 100) {
    teacherPromotionReasons.push("insufficient-test-games");
  }
  if (brier / normalized.length > 0.3) {
    teacherPromotionReasons.push("high-brier");
  }
  if (expectedCalibrationError > 0.25) {
    teacherPromotionReasons.push("high-ece");
  }
  if (!Number.isFinite(rankingAuc) || rankingAuc < 0.5) {
    teacherPromotionReasons.push("weak-ranking");
  }
  return {
    temperature,
    bias,
    logLoss: logLoss / normalized.length,
    brier: brier / normalized.length,
    expectedCalibrationError,
    rankingAuc,
    calibrationSlope,
    bootstrap,
    bins: publishedBins,
    samples: normalized.length,
    fitSamples: Number(options.fitSamples) || null,
    testSamples: normalized.length,
    fitGames: options.fitGames ?? null,
    testGames: options.testGames ?? null,
    evaluationScope: "frozen-independent-game-holdout",
    teacherPromotionEligible: teacherPromotionReasons.length === 0,
    teacherPromotionReasons
  };
}

export function calibratedProbability(value, temperature = 1, bias = 0) {
  const bounded = clamp(value, -0.999999, 0.999999);
  const logit = Math.log((bounded + 1) / (1 - bounded));
  return clamp(1 / (1 + Math.exp(-(logit / Math.max(0.05, temperature) + bias))), 1e-6, 1 - 1e-6);
}

function fitCalibrationBias(samples, temperature, targetRate) {
  let low = -12;
  let high = 12;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const predictedRate = mean(samples.map((sample) => calibratedProbability(sample.value, temperature, middle)));
    if (predictedRate < targetRate) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function logisticCalibrationSlope(samples = []) {
  const values = (samples || []).map((sample) => ({
    x: Math.log(
      clamp(Number(sample?.probability), 1e-6, 1 - 1e-6)
        / (1 - clamp(Number(sample?.probability), 1e-6, 1 - 1e-6))
    ),
    y: Number(sample?.outcome) > 0 ? 1 : 0
  })).filter((sample) => Number.isFinite(sample.x));
  if (values.length < 10
    || new Set(values.map((sample) => sample.y)).size < 2) return null;
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    let gradientIntercept = 0;
    let gradientSlope = 0;
    let hessianIntercept = 0;
    let hessianCross = 0;
    let hessianSlope = 0;
    for (const sample of values) {
      const probability = clamp(
        1 / (1 + Math.exp(-(intercept + slope * sample.x))),
        1e-6,
        1 - 1e-6
      );
      const residual = sample.y - probability;
      const variance = probability * (1 - probability);
      gradientIntercept += residual;
      gradientSlope += residual * sample.x;
      hessianIntercept += variance;
      hessianCross += variance * sample.x;
      hessianSlope += variance * sample.x * sample.x;
    }
    const determinant = hessianIntercept * hessianSlope
      - hessianCross * hessianCross;
    if (!(determinant > 1e-10)) return null;
    const interceptStep = (
      gradientIntercept * hessianSlope
      - gradientSlope * hessianCross
    ) / determinant;
    const slopeStep = (
      gradientSlope * hessianIntercept
      - gradientIntercept * hessianCross
    ) / determinant;
    intercept = clamp(intercept + interceptStep, -20, 20);
    slope = clamp(slope + slopeStep, -10, 10);
    if (Math.max(Math.abs(interceptStep), Math.abs(slopeStep)) < 1e-6) break;
  }
  return Number.isFinite(slope) ? slope : null;
}

function provenCorrectionChunks(trajectories, length) {
  const corrections = [];
  let correctionIndex = 0;
  for (const trajectory of trajectories) {
    for (const parentStep of trajectory.steps || []) {
      if (parentStep.proofLabelVersion !== PROOF_LABEL_VERSION
        || parentStep.proofCorrectionEligible !== true
        || !(Number(parentStep.proofConfidence) > 0)
        || parentStep.proofIndex === parentStep.selectedIndex) continue;
      const proofEvidenceKind = parentStep.proofEvidenceKind
        || (parentStep.proofKind === "immediate-terminal-win" ? "engine-proof" : "rule-guard");
      // Rule guards remain diagnostics. Only an engine transition that proves
      // the result may alter the policy-connected heads in this generation.
      if (proofEvidenceKind !== "engine-proof") continue;
      const proofConfidenceCap = proofEvidenceKind === "engine-proof" ? 1 : 0.75;
      const step = {
        ...parentStep,
        teacherIndex: parentStep.proofIndex,
        teacherLabelVersion: TEACHER_LABEL_VERSION,
        teacherCorrectionEligible: true,
        teacherVerificationStatus: proofEvidenceKind === "engine-proof"
          ? "verified"
          : "provisional",
        teacherConfidence: Math.min(proofConfidenceCap, Number(parentStep.proofConfidence) || proofConfidenceCap),
        teacherSelectedRegret: 1,
        teacherRankingMargin: 0.5,
        teacherTargets: parentStep.proofTargets,
        teacherActionValueTargets: parentStep.proofActionValueTargets,
        teacherActionValueWeights: parentStep.proofActionValueWeights,
        imitation: true,
        source: proofEvidenceKind === "engine-proof"
          ? "engine-proof-teacher"
          : "rule-guard-teacher"
      };
      corrections.push({
        ...trajectory,
        gameId: `${trajectory.gameId || "game"}:proof:${correctionIndex}`,
        imitation: true,
        proofCorrection: true,
        proofKind: parentStep.proofKind,
        steps: [step]
      });
      correctionIndex += 1;
    }
  }
  return chunkTrajectories(corrections, length);
}

function verifiedTeacherCorrectionChunks(trajectories) {
  const corrections = [];
  let correctionIndex = 0;
  for (const trajectory of trajectories) {
    for (const step of trajectory.steps || []) {
      if (step.teacherLabelVersion !== TEACHER_LABEL_VERSION
        || step.teacherCorrectionEligible !== true
        || step.teacherVerificationStatus !== "verified"
        || step.teacherPolicyEligible !== true
        || !verifiedTeacherDeterminizationEvidence(step)
        || !(Number(step.teacherConfidence) > 0)
        || step.teacherIndex === step.selectedIndex) continue;
      corrections.push({
        ...trajectory,
        gameId: `${trajectory.gameId || "game"}:teacher:${correctionIndex}`,
        teacherCorrection: true,
        steps: [{ ...step, source: step.source || "verified-simulation-teacher" }]
      });
      correctionIndex += 1;
    }
  }
  return corrections;
}

function provisionalTeacherActionValueChunks(trajectories) {
  const corrections = [];
  let correctionIndex = 0;
  for (const trajectory of trajectories) {
    for (const step of trajectory.steps || []) {
      const valueWeights = Array.isArray(step.teacherActionValueWeights)
        || ArrayBuffer.isView(step.teacherActionValueWeights)
        ? Array.from(step.teacherActionValueWeights)
        : [];
      const eligible = step.teacherActionValueEligible === true
        && provisionalTeacherStepHasIndependentEvidence(step);
      if (!eligible
        || step.teacherLabelVersion !== TEACHER_LABEL_VERSION
        || step.teacherVerificationStatus !== "provisional"
        || !valueWeights.some((weight) => Number(weight) > 0)) continue;
      corrections.push({
        ...trajectory,
        gameId: `${trajectory.gameId || "game"}:teacher-value:${correctionIndex}`,
        provisionalTeacherActionValue: true,
        steps: [{
          ...step,
          teacherActionValueEligible: true,
          teacherPolicyEligible: false,
          source: step.source || "provisional-simulation-value"
        }]
      });
      correctionIndex += 1;
    }
  }
  return corrections;
}

function provisionalTeacherStepHasIndependentEvidence(step) {
  const confirmation = step?.teacherConfirmation;
  const evaluator = confirmation?.evaluatorComparison
    || step?.teacherEvaluatorComparison;
  return step?.teacherLabelVersion === TEACHER_LABEL_VERSION
    && step?.teacherVerificationStatus === "provisional"
    && confirmation?.independent === true
    && confirmation?.seedBanks?.disjoint === true
    && confirmation?.determinizationAudit?.complete === true
    && Number(confirmation?.validPairedSamples) >= 8
    && Number(confirmation?.validRates?.recommended) >= 0.75
    && Number(confirmation?.validRates?.selected) >= 0.75
    && Number(confirmation?.pairedEvidence?.lowerBound) > 0
    && evaluator?.available === true
    && evaluator?.independent === true
    && evaluator?.conflict !== true
    && evaluator?.materialConflict !== true
    && evaluator?.agreesOnDirection === true
    && Number(evaluator?.primaryDelta) > 0
    && Number(evaluator?.independentDelta) >= 0;
}

function capProvisionalActionValueMass(provisionalChunks, verifiedChunks, options = {}) {
  const maximumRatio = Math.max(0, Math.min(0.15, Number(options.maximumRatio) || 0));
  const provisionalCoefficient = Math.max(0, Number(options.provisionalCoefficient) || 0);
  const verifiedCoefficient = Math.max(0, Number(options.verifiedCoefficient) || 0);
  const verifiedByDeck = actionValueEffectiveMassByDeck(verifiedChunks, verifiedCoefficient);
  const provisionalByDeck = actionValueEffectiveMassByDeck(provisionalChunks, provisionalCoefficient);
  const scaleByDeck = {};
  for (const deckId of new Set([...Object.keys(verifiedByDeck), ...Object.keys(provisionalByDeck)])) {
    const verified = verifiedByDeck[deckId] || 0;
    const provisional = provisionalByDeck[deckId] || 0;
    const allowed = verified * maximumRatio;
    scaleByDeck[deckId] = provisional > 0 ? Math.min(1, allowed / provisional) : 0;
  }
  const chunks = provisionalChunks.flatMap((chunk) => {
    const deckId = correctionDeckId(chunk);
    const scale = scaleByDeck[deckId] || 0;
    if (!(scale > 0)) return [];
    const steps = (chunk.steps || []).map((step) => ({
      ...step,
      teacherActionValueWeights: Array.from(step.teacherActionValueWeights || [], (weight) =>
        Math.max(0, Number(weight) || 0) * scale)
    }));
    return steps.some((step) => step.teacherActionValueWeights.some((weight) => weight > 0))
      ? [{ ...chunk, steps }]
      : [];
  });
  const appliedByDeck = actionValueEffectiveMassByDeck(chunks, provisionalCoefficient);
  return {
    chunks,
    report: {
      version: 1,
      definition: "sum(step-mask * sample-action-weight * phase-loss-coefficient)",
      maximumVerifiedRatioPerDeck: maximumRatio,
      verifiedCoefficient,
      provisionalCoefficient,
      verifiedByDeck,
      rawProvisionalByDeck: provisionalByDeck,
      appliedProvisionalByDeck: appliedByDeck,
      scaleByDeck,
      verifiedZeroDisablesProvisional: true
    }
  };
}

function actionValueEffectiveMassByDeck(chunks, coefficient) {
  const result = {};
  for (const chunk of chunks || []) {
    const deckId = correctionDeckId(chunk);
    let mass = 0;
    for (const step of chunk.steps || []) {
      for (const weight of step.teacherActionValueWeights || []) {
        mass += Math.max(0, Number(weight) || 0) * coefficient;
      }
    }
    result[deckId] = (result[deckId] || 0) + mass;
  }
  return result;
}

function correctionDeckId(chunk) {
  return chunk?.deckId || chunk?.steps?.[0]?.deckId || "unknown";
}

function teacherMacroDemonstrationChunks(trajectories, length) {
  const demonstrations = [];
  let demonstrationIndex = 0;
  for (const trajectory of trajectories) {
    for (const parentStep of trajectory.steps || []) {
      if (parentStep.teacherLabelVersion !== TEACHER_LABEL_VERSION
        || parentStep.teacherCorrectionEligible !== true
        || parentStep.teacherPolicyEligible !== true
        || !verifiedTeacherDeterminizationEvidence(parentStep)
        || !Array.isArray(parentStep.teacherMacroDemonstrationSteps)
        || !parentStep.teacherMacroDemonstrationSteps.length) continue;
      const steps = parentStep.teacherMacroDemonstrationSteps
        .filter((step) => step?.imitation === true
          && step.teacherLabelVersion === TEACHER_LABEL_VERSION
          && step.teacherVerificationStatus === "verified");
      if (!steps.length) continue;
      demonstrations.push({
        ...trajectory,
        gameId: `${trajectory.gameId || "game"}:teacher-macro:${demonstrationIndex}`,
        imitation: true,
        teacherMacro: true,
        steps
      });
      demonstrationIndex += 1;
    }
  }
  return chunkTrajectories(demonstrations, length);
}

function verifiedTeacherDeterminizationEvidence(step) {
  return step?.teacherProofKind === "immediate-terminal-win"
    || step?.teacherConfirmation?.determinizationAudit?.complete === true;
}

function defeatPostmortemCorrectionChunks(trajectories, length) {
  const corrections = [];
  let correctionIndex = 0;
  for (const trajectory of trajectories) {
    for (const parentStep of trajectory.steps || []) {
      if (parentStep.postmortemReview?.version !== 2
        || (parentStep.postmortemReview?.verifiedLocalRegret !== true
          && parentStep.postmortemReview?.avoidableLoss !== true)
        || (parentStep.postmortemReview?.proofKind !== "immediate-terminal-win"
          && (parentStep.postmortemReview?.independentConfirmation !== true
            || parentStep.postmortemReview?.confirmationValidity !== true))
        || parentStep.postmortemReview?.determinizationAudit?.complete !== true
        || !Array.isArray(parentStep.postmortemCorrectionSteps)
        || !parentStep.postmortemCorrectionSteps.length) continue;
      const steps = parentStep.postmortemCorrectionSteps.filter((step) =>
        step?.imitation === true
        && step.postmortemVersion === 2
        && step.teacherLabelVersion === TEACHER_LABEL_VERSION
        && step.teacherCorrectionEligible === true
        && step.teacherVerificationStatus === "verified");
      if (!steps.length) continue;
      corrections.push({
        ...trajectory,
        gameId: `${trajectory.gameId || "game"}:postmortem:${correctionIndex}`,
        imitation: true,
        postmortem: true,
        postmortemCause: parentStep.postmortemReview.cause,
        steps
      });
      correctionIndex += 1;
    }
  }
  return chunkTrajectories(corrections, length);
}

function chunkTrajectories(trajectories, length) {
  const output = [];
  for (const trajectory of trajectories) {
    for (let start = 0; start < trajectory.steps.length; start += length) output.push({ ...trajectory, steps: trajectory.steps.slice(start, start + length) });
  }
  return output.filter((chunk) => chunk.steps.length);
}

function trainingStratumKey(item) {
  return [
    item.deckId || "unknown",
    item.matchupType || "unknown",
    item.condition || "unknown",
    item.resultClass || "unknown",
    item.marginClass || "unknown",
    item.opponentGeneration ?? "unknown"
  ].join("|");
}

function correctionStratumKey(chunk) {
  const step = chunk.steps?.[0] || {};
  const decisionType = step.postmortemCause
    || step.criticalDecisionTypes?.[0]
    || step.teacherProofKind
    || step.proofKind
    || step.source
    || "general";
  return [
    chunk.deckId || step.deckId || "unknown",
    chunk.condition || step.condition || "unknown",
    decisionType
  ].join("|");
}

function summarizeCorrectionStrata(chunks) {
  const strata = {};
  for (const chunk of chunks || []) increment(strata, correctionStratumKey(chunk));
  return { chunks: chunks?.length || 0, strata };
}

function applyTeacherCorrectionLifecycle(model, chunks, previousStates = {}, options = {}) {
  const lifecycleStep = Math.max(0,
    Number(options.lifecycleStep ?? model.metadata?.trainingIteration ?? model.generation) || 0);
  const ttl = Math.max(1, Math.floor(Number(options.ttl) || 8));
  const states = {};
  for (const [identity, value] of Object.entries(previousStates || {})) {
    const record = typeof value === "string" ? { state: value } : structuredClone(value);
    const lastSeenStep = Number(record.lastSeenStep ?? record.updatedAtGeneration);
    if (!Number.isFinite(lastSeenStep) || lifecycleStep - lastSeenStep <= ttl) {
      states[identity] = record;
    }
  }
  const preservedBeforeClassification = new Set(Object.keys(states));
  const transitions = {};
  const counts = { active: 0, decayed: 0, dormant: 0, reactivated: 0 };
  const classified = (chunks || []).map((chunk) => {
    const step = chunk.steps?.[0] || {};
    const identity = teacherCorrectionIdentity(chunk, step);
    const previousRecord = states[identity] || null;
    const previous = previousRecord?.state || null;
    const evaluation = evaluateBehaviorCloningBatch(model, packPpoBatch([chunk]));
    const teacherMargins = evaluation.teacherPolicyMargins || [];
    const teacherWeights = evaluation.teacherWeights || [];
    const marginIndex = teacherWeights.findIndex((weight) => Number(weight) > 0);
    const preferenceCorrection = Number(step.teacherIndex) !== Number(step.selectedIndex);
    const achievedMargin = preferenceCorrection
      ? Number(teacherMargins[Math.max(0, marginIndex)]) || 0
      : Math.exp(-Math.max(0, Number(evaluation.policyLoss) || 0));
    const targetMargin = preferenceCorrection
      ? Math.max(0.05, Math.min(0.5, Number(step.teacherRankingMargin) || 0.05))
      : 0.65;
    const dormantThreshold = preferenceCorrection
      ? targetMargin * 2
      : 0.85;
    const lifecycle = advanceCorrectionLifecycleRecord(previousRecord, {
      achievedMargin,
      targetMargin,
      dormantThreshold,
      lifecycleStep
    });
    const {
      state,
      consecutiveMarginPasses,
      lastMarginPassStep
    } = lifecycle;
    counts[state] += 1;
    if (previous && previous !== state) {
      const key = `${previous}->${state}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
    states[identity] = {
      state,
      achievedMargin,
      targetMargin,
      measurement: preferenceCorrection ? "teacher-vs-behavior-logit-margin" : "demonstration-action-probability",
      correctionKind: chunk.correctionKind || "teacher",
      consecutiveMarginPasses,
      lastMarginPassStep,
      lastSeenStep: lifecycleStep,
      updatedAtGeneration: model.generation
    };
    preservedBeforeClassification.delete(identity);
    const multiplier = correctionLifecycleMultiplier(state);
    return {
      ...chunk,
      correctionState: state,
      correctionAchievedMargin: achievedMargin,
      correctionTargetMargin: targetMargin,
      correctionConsecutiveMarginPasses: consecutiveMarginPasses,
      steps: (chunk.steps || []).map((item) => ({
        ...item,
        teacherCorrectionState: state,
        teacherConfidence: Math.max(0, Number(item.teacherConfidence) || 0) * multiplier
      }))
    };
  });
  return {
    chunks: classified,
    states,
    transitions,
    counts,
    ttl,
    lifecycleStep,
    preservedUnseenStates: preservedBeforeClassification.size
  };
}

export function advanceCorrectionLifecycleRecord(previousRecord, options = {}) {
  const previous = previousRecord?.state || null;
  const achievedMargin = Number(options.achievedMargin) || 0;
  const targetMargin = Math.max(0, Number(options.targetMargin) || 0);
  const dormantThreshold = Math.max(targetMargin, Number(options.dormantThreshold) || targetMargin);
  const lifecycleStep = Math.max(0, Number(options.lifecycleStep) || 0);
  const passedDormantMargin = achievedMargin >= dormantThreshold;
  const previousConsecutivePasses = Math.max(0,
    Number(previousRecord?.consecutiveMarginPasses) || 0);
  const alreadyCountedThisStep = Number(previousRecord?.lastMarginPassStep) === lifecycleStep;
  const consecutiveMarginPasses = passedDormantMargin
    ? alreadyCountedThisStep
      ? previousConsecutivePasses
      : previousConsecutivePasses + 1
    : 0;
  const state = !previous
    ? achievedMargin >= targetMargin ? "decayed" : "active"
    : consecutiveMarginPasses >= 2
      ? "dormant"
      : achievedMargin >= targetMargin
        ? "decayed"
        : previous === "dormant"
          ? "reactivated"
          : "active";
  return {
    state,
    consecutiveMarginPasses,
    lastMarginPassStep: passedDormantMargin
      ? lifecycleStep
      : previousRecord?.lastMarginPassStep ?? null
  };
}

function teacherCorrectionIdentity(chunk, step) {
  return stableTeacherCorrectionId(
    chunk,
    step,
    chunk.correctionKind || (chunk.postmortem ? "postmortem"
      : chunk.teacherMacro ? "macro" : "teacher")
  );
}

function correctionLifecycleMultiplier(state) {
  if (state === "dormant") return 0;
  if (state === "decayed") return 0.25;
  if (state === "reactivated") return 1.25;
  return 1;
}

function compareEpochSelectionCandidates(left, right) {
  return right.score - left.score
    || right.tieBreakerScore - left.tieBreakerScore
    || left.epoch - right.epoch;
}

function teacherCorrectionPriority(chunk) {
  return Math.max(0, ...chunk.steps.map((step) => {
    if (step.teacherLabelVersion !== TEACHER_LABEL_VERSION
      || step.teacherCorrectionEligible !== true
      || !(Number(step.teacherConfidence) > 0)
      || step.teacherIndex === step.selectedIndex) return 0;
    const regret = Math.max(0, Number(step.teacherSelectedRegret) || 0);
    const turningPointBonus = step.turningPoint === "teacher-critical" ? 4
      : step.turningPoint === "teacher-urgent" ? 3
        : step.turningPoint === "teacher-regret" ? 2
          : 0;
    const urgencyBonus = step.criticalDecisionUrgent ? 2 : step.criticalDecisionTypes?.length ? 1 : 0;
    if (regret < 0.05 && !turningPointBonus && !urgencyBonus) return 0;
    return regret * 20 + turningPointBonus + urgencyBonus + Number(step.teacherConfidence);
  }));
}

function collectGradientConflictDiagnostics(model, optimizer, phaseChunks, options = {}) {
  const signatures = {};
  const batches = {};
  for (const [phase, chunks] of Object.entries(phaseChunks || {})) {
    const byDeck = new Map();
    for (const chunk of chunks || []) {
      const deckId = correctionDeckId(chunk);
      if (!byDeck.has(deckId)) byDeck.set(deckId, chunk);
    }
    batches[phase] = {};
    for (const [deckId, chunk] of [...byDeck].sort(([left], [right]) =>
      left.localeCompare(right))) {
      const metrics = trainPpoBatch(model, packPpoBatch([chunk], {
        // Run A ignores correction metadata in its PPO diagnostic just as it
        // does in real PPO. Raw teacher/postmortem phases intentionally keep
        // the metadata so their hypothetical gradients remain measurable.
        ignoreCorrectionSignals: phase === "ppo"
          && options.teacherConsumptionPolicy === "record-only-v1"
      }), optimizer, {
        ...gradientDiagnosticPhaseOptions(phase, options),
        applyGradients: false,
        captureGradientSignature: true,
        gradientSignatureGroups: ["shared-state-memory"],
        anchorCoefficient: 0,
        anchorModels: []
      });
      const key = `${phase}:${deckId}`;
      if (metrics.gradientSignature?.length) signatures[key] = metrics.gradientSignature;
      batches[phase][deckId] = {
        available: Boolean(metrics.gradientSignature?.length),
        sharedGradientNorm: Number(metrics.gradientNormByGroup?.["shared-state-memory"]) || 0,
        steps: chunk.steps?.length || 0
      };
    }
  }
  const keys = Object.keys(signatures).sort();
  const cosineMatrix = {};
  for (const left of keys) {
    cosineMatrix[left] = {};
    for (const right of keys) {
      cosineMatrix[left][right] = gradientSignatureCosine(
        signatures[left],
        signatures[right]
      );
    }
  }
  return {
    version: 1,
    modelGeneration: model.generation,
    sharedTrunkGroup: "shared-state-memory",
    fixedBatchPolicy: "first-stable-chunk-per-phase-and-deck-before-epoch-updates",
    teacherSignalSource: "raw-recorded-labels",
    optimizerMutation: false,
    batches,
    cosineMatrix
  };
}

function gradientDiagnosticPhaseOptions(phase, options) {
  if (phase === "ppo") {
    return {
      ...options,
      teacherCoefficient: 0,
      teacherPolicyPreferenceCoefficient: 0,
      teacherRankingCoefficient: 0,
      teacherActionValueCoefficient: 0
    };
  }
  return {
    ...options,
    policyCoefficient: 0,
    valueCoefficient: 0,
    actionValueCoefficient: 0,
    diagnosticCoefficient: 0,
    beliefCoefficient: 0,
    entropyCoefficient: 0,
    teacherCoefficient: phase === "postmortem"
      ? Math.min(0.45, options.postmortemCoefficient
        ?? Math.max(0.25, options.teacherCoefficient ?? 0.2))
      : options.teacherCorrectionCoefficient
        ?? Math.max(0.25, options.teacherCoefficient ?? 0.2),
    teacherDistillationCoefficient: 0.15,
    teacherPolicyPreferenceCoefficient: options.teacherPolicyPreferenceCoefficient ?? 0.5,
    teacherRankingCoefficient: phase === "postmortem"
      ? Math.min(0.55, options.postmortemRankingCoefficient
        ?? Math.max(0.4, options.teacherRankingCoefficient ?? 0.3))
      : options.teacherCorrectionRankingCoefficient
        ?? Math.max(0.4, options.teacherRankingCoefficient ?? 0.3),
    teacherActionValueCoefficient: phase === "postmortem"
      ? Math.min(0.5, options.postmortemActionValueCoefficient
        ?? Math.max(0.35, options.teacherActionValueCoefficient ?? 0.25))
      : options.teacherCorrectionActionValueCoefficient
        ?? Math.max(0.35, options.teacherActionValueCoefficient ?? 0.25)
  };
}

function gradientSignatureCosine(left, right) {
  const leftEntries = new Map((left?.entries || []).map((entry) => [entry.name, entry.values]));
  const rightEntries = new Map((right?.entries || []).map((entry) => [entry.name, entry.values]));
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (const name of new Set([...leftEntries.keys(), ...rightEntries.keys()])) {
    const leftValues = leftEntries.get(name) || [];
    const rightValues = rightEntries.get(name) || [];
    const length = Math.max(leftValues.length, rightValues.length);
    for (let index = 0; index < length; index += 1) {
      const leftValue = Number(leftValues[index]) || 0;
      const rightValue = Number(rightValues[index]) || 0;
      dot += leftValue * rightValue;
      leftSquared += leftValue * leftValue;
      rightSquared += rightValue * rightValue;
    }
  }
  const denominator = Math.sqrt(leftSquared * rightSquared);
  return denominator > 0 ? Math.max(-1, Math.min(1, dot / denominator)) : null;
}

function unifiedCorrectionPriority(chunk) {
  const teacherPriority = teacherCorrectionPriority(chunk);
  if (teacherPriority > 0) return teacherPriority;
  const step = chunk.steps?.[0] || {};
  if (step.teacherLabelVersion !== TEACHER_LABEL_VERSION
    || step.teacherCorrectionEligible !== true
    || !(Number(step.teacherConfidence) > 0)) return 0;
  const kindBonus = chunk.correctionKind === "postmortem" ? 4
    : chunk.correctionKind === "macro" ? 2
      : 0;
  return kindBonus
    + Math.max(0, Number(step.teacherSelectedRegret) || 0) * 20
    + Math.max(0, Number(step.teacherConfidence) || 0);
}

function selectCorrectionChunksWithCaps(chunks, maximumChunks, options = {}) {
  const maximumEffectiveMass = Math.max(0, Number(maximumChunks) || 0);
  const presentKinds = new Set((chunks || []).map((chunk) =>
    ["macro", "postmortem"].includes(chunk.correctionKind)
      ? chunk.correctionKind
      : "teacher"));
  const maximum = maximumEffectiveMass > 0
    ? Math.max(presentKinds.size, Math.ceil(maximumEffectiveMass))
    : 0;
  const macroFraction = Math.max(0, Math.min(0.5,
    Number(options.maximumMacroCorrectionFraction) || 0.35));
  const postmortemFraction = Math.max(0, Math.min(0.5,
    Number(options.maximumPostmortemCorrectionFraction) || 0.35));
  const caps = {
    teacher: maximum,
    macro: presentKinds.has("macro")
      ? Math.max(1, Math.ceil(maximum * macroFraction))
      : 0,
    postmortem: presentKinds.has("postmortem")
      ? Math.max(1, Math.ceil(maximum * postmortemFraction))
      : 0
  };
  const counts = { teacher: 0, macro: 0, postmortem: 0 };
  const selected = [];
  const ranked = [...(chunks || [])].sort((left, right) =>
    Number(right.correctionPriority || 0) - Number(left.correctionPriority || 0)
      || correctionStratumKey(left).localeCompare(correctionStratumKey(right)));
  for (const chunk of ranked) {
    if (selected.length >= maximum) break;
    const kind = ["macro", "postmortem"].includes(chunk.correctionKind)
      ? chunk.correctionKind
      : "teacher";
    if (counts[kind] >= caps[kind]) continue;
    selected.push(chunk);
    counts[kind] += 1;
  }
  const rawMass = correctionEffectiveMassByKind(chunks);
  const selectedMass = correctionEffectiveMassByKind(selected);
  const kindMassCaps = {
    teacher: maximumEffectiveMass,
    macro: maximumEffectiveMass * macroFraction,
    postmortem: maximumEffectiveMass * postmortemFraction
  };
  const kindScale = Object.fromEntries(Object.keys(kindMassCaps).map((kind) => [
    kind,
    selectedMass[kind] > 0
      ? Math.min(1, kindMassCaps[kind] / selectedMass[kind])
      : 0
  ]));
  let scaled = selected.map((chunk) => {
    const kind = ["macro", "postmortem"].includes(chunk.correctionKind)
      ? chunk.correctionKind
      : "teacher";
    const scale = kindScale[kind];
    return {
      ...chunk,
      steps: (chunk.steps || []).map((step) => ({
        ...step,
        teacherConfidence: Math.max(0, Number(step.teacherConfidence) || 0) * scale
      }))
    };
  }).filter((chunk) => chunk.steps.some((step) => Number(step.teacherConfidence) > 0));
  const kindCappedMass = correctionEffectiveMassByKind(scaled);
  const totalKindCappedMass = Object.values(kindCappedMass)
    .reduce((sum, value) => sum + value, 0);
  const globalScale = totalKindCappedMass > 0
    ? Math.min(1, maximumEffectiveMass / totalKindCappedMass)
    : 0;
  if (globalScale < 1) {
    scaled = scaled.map((chunk) => ({
      ...chunk,
      steps: chunk.steps.map((step) => ({
        ...step,
        teacherConfidence: Number(step.teacherConfidence) * globalScale
      }))
    }));
  }
  const appliedMass = correctionEffectiveMassByKind(scaled);
  return {
    chunks: scaled,
    report: {
      version: 1,
      definition: "sum(step.teacherConfidence) after lifecycle multiplier",
      maximumChunks: maximum,
      maximumEffectiveMass,
      perKindChunkCaps: caps,
      perKindEffectiveMassCaps: kindMassCaps,
      perKindScale: kindScale,
      globalScale,
      rawChunksByKind: countCorrectionKinds(chunks),
      appliedChunksByKind: counts,
      rawEffectiveMassByKind: rawMass,
      appliedEffectiveMassByKind: appliedMass,
      macroInsideGlobalCap: true,
      postmortemInsideGlobalCap: true
    }
  };
}

function correctionEffectiveMassByKind(chunks) {
  const result = { teacher: 0, macro: 0, postmortem: 0 };
  for (const chunk of chunks || []) {
    const kind = ["macro", "postmortem"].includes(chunk.correctionKind)
      ? chunk.correctionKind
      : "teacher";
    result[kind] += (chunk.steps || []).reduce((sum, step) =>
      sum + Math.max(0, Number(step.teacherConfidence) || 0), 0);
  }
  return result;
}

function correctionEffectiveMassByEvidence(chunks) {
  const empty = () => ({ teacher: 0, macro: 0, postmortem: 0 });
  const result = {
    terminalConfirmed: empty(),
    certifiedEvaluator: empty(),
    otherVerified: empty()
  };
  for (const chunk of chunks || []) {
    const kind = ["macro", "postmortem"].includes(chunk.correctionKind)
      ? chunk.correctionKind
      : "teacher";
    for (const step of chunk.steps || []) {
      const mass = Math.max(0, Number(step.teacherConfidence) || 0);
      const evidenceSource = step.teacherEvidenceSource || null;
      if (["engine-proof", "terminal-confirmed"].includes(evidenceSource)) {
        result.terminalConfirmed[kind] += mass;
        continue;
      }
      if (evidenceSource === "certified-evaluator") {
        result.certifiedEvaluator[kind] += mass;
        continue;
      }
      const proofKind = step.teacherProofKind
        || step.postmortemReview?.proofKind
        || step.actionRankingReference?.proofKind
        || null;
      if (["confirmed-terminal-rollout-dominance", "immediate-terminal-win",
        "terminal-postmortem-dominance"].includes(proofKind)
        || ["confirmed-terminal-rollout-dominance",
          "terminal-postmortem-dominance"].includes(
          step.actionRankingReference?.evidenceKind
        )) {
        result.terminalConfirmed[kind] += mass;
        continue;
      }
      const evaluator = step.teacherConfirmation?.evaluatorComparison
        || step.teacherEvaluatorComparison
        || step.postmortemReview?.evaluatorComparison
        || null;
      if (evaluator?.available === true
        && evaluator?.independent === true
        && evaluator?.conflict !== true
        && evaluator?.materialConflict !== true) {
        result.certifiedEvaluator[kind] += mass;
        continue;
      }
      result.otherVerified[kind] += mass;
    }
  }
  return result;
}

function countCorrectionKinds(chunks) {
  const result = { teacher: 0, macro: 0, postmortem: 0 };
  for (const chunk of chunks || []) {
    const kind = ["macro", "postmortem"].includes(chunk.correctionKind)
      ? chunk.correctionKind
      : "teacher";
    result[kind] += 1;
  }
  return result;
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function snapshotModelWeights(model) {
  return Object.fromEntries(Object.entries(model.layers).map(([name, layer]) => [name, layer.getWeights().map((tensor) => tensor.clone())]));
}

function serializeModelWeightSnapshot(snapshot) {
  if (!snapshot) return null;
  return Object.fromEntries(Object.entries(snapshot).map(([name, weights]) => [
    name,
    weights.map((tensor) => ({
      shape: [...tensor.shape],
      values: Array.from(tensor.dataSync())
    }))
  ]));
}

function deserializeModelWeightSnapshot(snapshot) {
  return Object.fromEntries(Object.entries(snapshot || {}).map(([name, weights]) => [
    name,
    weights.map((weight) => tf.tensor(weight.values, weight.shape))
  ]));
}

function epochResumeSelectionState(state) {
  return {
    version: 2,
    startEpoch: state.startEpoch,
    acceptedEpochs: state.acceptedEpochs,
    epochGuards: structuredClone(state.epochGuards),
    history: structuredClone(state.history),
    bestEpoch: state.bestEpoch,
    bestEpochScore: state.bestEpochScore,
    bestEpochTieBreakerScore: state.bestEpochTieBreakerScore,
    bestModelWeightSnapshot: serializeModelWeightSnapshot(state.bestEpochSnapshot),
    bestOptimizerState: structuredClone(state.bestEpochOptimizerState),
    bestRandomState: state.bestEpochRandomState,
    epochsWithoutImprovement: state.epochsWithoutImprovement,
    epochSelectionCandidates: (state.epochSelectionCandidates || [])
      .map(serializeEpochSelectionCandidate),
    finalEpochConfirmations: structuredClone(state.finalEpochConfirmations || []),
    finalEpochAudit: structuredClone(state.finalEpochAudit || null),
    finalSelectionBaselineSnapshot: serializeModelWeightSnapshot(
      state.finalSelectionBaselineSnapshot
    ),
    finalSelectionBaselineOptimizerState: structuredClone(
      state.finalSelectionBaselineOptimizerState
    ),
    finalSelectionBaselineRandomState: state.finalSelectionBaselineRandomState
  };
}

function serializeEpochSelectionCandidate(candidate) {
  return {
    epoch: candidate.epoch,
    score: candidate.score,
    tieBreakerScore: candidate.tieBreakerScore,
    guard: structuredClone(candidate.guard),
    modelWeightSnapshot: serializeModelWeightSnapshot(candidate.snapshot),
    optimizerState: structuredClone(candidate.optimizerState),
    randomState: candidate.randomState
  };
}

function deserializeEpochSelectionCandidate(candidate) {
  return {
    epoch: Number(candidate.epoch),
    score: Number(candidate.score),
    tieBreakerScore: Number(candidate.tieBreakerScore),
    guard: structuredClone(candidate.guard),
    snapshot: deserializeModelWeightSnapshot(candidate.modelWeightSnapshot),
    optimizerState: structuredClone(candidate.optimizerState),
    randomState: candidate.randomState
  };
}

function restoreModelWeights(model, snapshot) {
  for (const [name, weights] of Object.entries(snapshot)) model.layers[name]?.setWeights(weights);
}

function disposeModelWeights(snapshot) {
  for (const weights of Object.values(snapshot)) weights.forEach((tensor) => tensor.dispose());
}

function shuffle(items, random) { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [items[index], items[target]] = [items[target], items[index]]; } return items; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function weightedMean(items, key) { const weight = items.reduce((sum, item) => sum + item.steps, 0); return weight ? items.reduce((sum, item) => sum + item[key] * item.steps, 0) / weight : 0; }
function aggregateMetrics(items) {
  return {
    meanLoss: metricMean(items, "loss"),
    meanPolicyLoss: metricMean(items, "policyLoss"),
    meanValueLoss: metricMean(items, "valueLoss"),
    meanActionValueLoss: metricMean(items, "actionValueLoss"),
    meanDiagnosticLoss: metricMean(items, "diagnosticLoss"),
    meanTeacherActionValueLoss: metricMean(items, "teacherActionValueLoss"),
    meanTeacherProposalValueLoss: metricMean(items, "teacherProposalValueLoss"),
    meanTeacherLoss: metricMean(items, "teacherLoss"),
    meanTeacherDistillationLoss: metricMean(items, "teacherDistillationLoss"),
    meanTeacherPolicyPreferenceLoss: metricMean(items, "teacherPolicyPreferenceLoss"),
    meanTeacherRankingLoss: metricMean(items, "teacherRankingLoss"),
    meanBeliefLoss: metricMean(items, "beliefLoss"),
    meanEntropy: metricMean(items, "entropy"),
    meanAnchorKl: metricMean(items, "anchorKl"),
    meanGradientNorm: metricMean(items, "gradientNorm"),
    meanGradientNormByGroup: aggregateGradientNormGroups(items)
  };
}

function aggregateGradientNormGroups(items) {
  const groups = new Set(items.flatMap((item) => Object.keys(item.gradientNormByGroup || {})));
  return Object.fromEntries([...groups].map((group) => [
    group,
    mean(items.flatMap((item) => Number.isFinite(item.gradientNormByGroup?.[group])
      ? [item.gradientNormByGroup[group]]
      : []))
  ]));
}

function aggregateBeliefMetrics(items) {
  const valid = items.filter(Boolean);
  const positives = valid.reduce((sum, item) => sum + (item.positives || 0), 0);
  const topKHits = valid.reduce((sum, item) => sum + (item.topKHits || 0), 0);
  const topKPredictions = valid.reduce((sum, item) => sum + (item.topKPredictions || 0), 0);
  const thresholds = new Map();
  for (const item of valid) {
    for (const point of item.thresholds || []) {
      const target = thresholds.get(point.threshold) || {
        threshold: point.threshold, truePositive: 0, falsePositive: 0, falseNegative: 0
      };
      target.truePositive += point.truePositive || 0;
      target.falsePositive += point.falsePositive || 0;
      target.falseNegative += point.falseNegative || 0;
      thresholds.set(point.threshold, target);
    }
  }
  const curve = [...thresholds.values()].sort((left, right) => right.threshold - left.threshold)
    .map((point) => ({
      ...point,
      precision: point.truePositive / Math.max(1, point.truePositive + point.falsePositive),
      recall: point.truePositive / Math.max(1, point.truePositive + point.falseNegative)
    }));
  let prAuc = 0;
  for (let index = 1; index < curve.length; index += 1) {
    const left = curve[index - 1];
    const right = curve[index];
    prAuc += Math.max(0, right.recall - left.recall) * (left.precision + right.precision) / 2;
  }
  return {
    positives,
    topKRecall: positives ? topKHits / positives : 0,
    topKPrecision: topKPredictions ? topKHits / topKPredictions : 0,
    prAuc,
    curve
  };
}
function binaryRankingAuc(samples) {
  const ranked = [...samples].sort((left, right) => left.score - right.score);
  const positives = ranked.filter((item) => item.outcome === 1).length;
  const negatives = ranked.length - positives;
  if (!positives || !negatives) return null;
  let rankSum = 0;
  let index = 0;
  while (index < ranked.length) {
    let end = index + 1;
    while (end < ranked.length && ranked[end].score === ranked[index].score) end += 1;
    const meanRank = (index + 1 + end) / 2;
    for (let itemIndex = index; itemIndex < end; itemIndex += 1) {
      if (ranked[itemIndex].outcome === 1) rankSum += meanRank;
    }
    index = end;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function bootstrapCalibrationByGame(samples, temperature, bias, iterations = 250) {
  const groups = new Map();
  for (const sample of samples || []) {
    const gameId = sample.gameId;
    if (!gameId) continue;
    if (!groups.has(gameId)) groups.set(gameId, []);
    groups.get(gameId).push(sample);
  }
  const gameIds = [...groups.keys()];
  if (gameIds.length < 4) return {
    unit: "game",
    games: gameIds.length,
    iterations: 0,
    brier95: null,
    rankingAuc95: null
  };
  let randomState = 0x51f15e5d;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const briers = [];
  const aucs = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resampled = [];
    for (let index = 0; index < gameIds.length; index += 1) {
      resampled.push(...groups.get(gameIds[Math.floor(random() * gameIds.length)]));
    }
    const probabilities = resampled.map((sample) => ({
      score: calibratedProbability(sample.value, temperature, bias),
      outcome: sample.outcome
    }));
    briers.push(mean(probabilities.map((sample) => (sample.score - sample.outcome) ** 2)));
    const auc = binaryRankingAuc(probabilities);
    if (Number.isFinite(auc)) aucs.push(auc);
  }
  briers.sort((left, right) => left - right);
  aucs.sort((left, right) => left - right);
  return {
    unit: "game",
    games: gameIds.length,
    iterations,
    brier95: percentileInterval(briers),
    rankingAuc95: aucs.length ? percentileInterval(aucs) : null
  };
}

function percentileInterval(values) {
  if (!values.length) return null;
  return [
    values[Math.floor(values.length * 0.025)],
    values[Math.min(values.length - 1, Math.floor(values.length * 0.975))]
  ];
}

function stableStringHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function metricMean(items, key) {
  const available = items.filter((item) => Number.isFinite(item[key]));
  const weight = available.reduce((sum, item) => sum + (item.steps || 0), 0);
  return weight ? available.reduce((sum, item) => sum + item[key] * item.steps, 0) / weight : mean(available.map((item) => item[key]));
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
