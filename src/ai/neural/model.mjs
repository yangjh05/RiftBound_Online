import { tf } from "./tf-runtime.mjs";
import {
  ACTION_DIM, LEGACY_ACTION_DIM, CARD_BINS, CARD_INDEX, CARD_VOCABULARY, MAX_ACTIONS, MAX_SEQUENCE,
  STATE_DIM, STATE_SCALARS, CONTEXT_RULE_FEATURES, CONTEXT_READY_FEATURES, STRUCTURED_STATE_LAYOUT, NEURAL_HIDDEN_SIZE, encodeActionSet, encodeState
} from "./encoding.mjs";
import { addAiPerformance, measureAiPerformance } from "../performance.mjs";
import {
  attachEvaluatorArchitecture,
  createStructuredV2TensorInput,
  disposeStructuredV2TensorInput,
  evaluatorArchitecture,
  evaluatorRequiresStructuredV2,
  forwardEvaluatorValue
} from "./evaluator-architecture.mjs";
import { createPublicStructuredEvidenceSnapshot } from "./structured-evidence.mjs";

export const NEURAL_MODEL_VERSION = 6;
export { NEURAL_HIDDEN_SIZE };
const EMBEDDING_SIZE = 64;
const disposedNeuralModels = new WeakSet();

export function createNeuralModel(options = {}) {
  const layers = {};
  let model = null;
  try {
    // Assign each layer as it is created so a later constructor failure cannot
    // orphan resources that were already allocated earlier in this sequence.
    layers.gru = tf.layers.gru({ units: options.hiddenSize || NEURAL_HIDDEN_SIZE, returnSequences: true, returnState: true, name: "memory_gru" });
    layers.stateProjection = tf.layers.dense({ units: options.embeddingSize || EMBEDDING_SIZE, activation: "tanh", name: "state_projection" });
    layers.actionProjection = tf.layers.dense({ units: options.embeddingSize || EMBEDDING_SIZE, activation: "tanh", name: "action_projection" });
    layers.actionBias = tf.layers.dense({ units: 1, useBias: true, name: "action_bias" });
    layers.actionValue = tf.layers.dense({ units: 1, activation: "tanh", kernelInitializer: "zeros", biasInitializer: "zeros", name: "action_value_head" });
    layers.teacherProposalValue = tf.layers.dense({
      units: 1,
      activation: "tanh",
      kernelInitializer: "zeros",
      biasInitializer: "zeros",
      name: "teacher_proposal_value_head"
    });
    layers.value = tf.layers.dense({ units: 1, activation: "tanh", name: "value_head" });
    layers.diagnostic = tf.layers.dense({
      units: 2,
      activation: "tanh",
      kernelInitializer: "zeros",
      biasInitializer: "zeros",
      name: "diagnostic_auxiliary_head"
    });
    layers.belief = tf.layers.dense({ units: CARD_BINS, activation: "sigmoid", name: "belief_head" });
    model = {
      version: NEURAL_MODEL_VERSION,
      generation: options.generation || 0,
      gamesTrained: options.gamesTrained || 0,
      layers,
      calibration: { temperature: 1, bias: 0, bins: [], ...(options.calibration || {}) },
      knowledge: structuredClone(options.knowledge || {}),
      metadata: {
        algorithm: "recurrent-ppo-action-value-belief-isolated-teacher-proposal",
        ...(options.metadata || {}),
        cardRepresentation: "full-vocabulary-scoring-history-might-durability-v5",
        actionRepresentation: "semantic-tactical-v3",
        targetContextRepresentation: "allocated-damage-response-location-v1"
      }
    };
    warmup(model);
    if (options.evaluatorArchitecture) {
      attachEvaluatorArchitecture(model, options.evaluatorArchitecture, {
        seed: options.evaluatorArchitectureSeed,
        warmStart: options.evaluatorWarmStart !== false
      });
    }
    return model;
  } catch (error) {
    if (model) disposeNeuralModel(model);
    else disposeNeuralLayers(layers);
    throw error;
  }
}

function disposeNeuralLayers(layers) {
  for (const layer of Object.values(layers)) {
    try { layer?.dispose?.(); } catch {}
  }
}

/**
 * Releases every TensorFlow resource owned by a neural model.
 *
 * Layers own their variables, while training callers may attach optimizers or
 * other disposable resources to a model for shared lifecycle management.  A
 * best-effort cleanup keeps one failing resource from preventing the rest from
 * being released, and the WeakSet makes repeated UI cleanup safe.
 */
export function disposeNeuralModel(model) {
  if ((!model || (typeof model !== "object" && typeof model !== "function"))
    || disposedNeuralModels.has(model)) {
    return { disposed: false, disposedResources: 0, errors: [] };
  }
  disposedNeuralModels.add(model);

  const resources = new Set();
  addDisposableResource(resources, model.optimizer);
  addDisposableResources(resources, model.optimizers);
  addDisposableResources(resources, model.ownedResources);
  addDisposableResources(resources, model.ownedTensors);
  addDisposableResources(resources, model.tensors);
  addDisposableResources(resources, model.layers);

  let disposedResources = 0;
  const errors = [];
  for (const resource of resources) {
    try {
      resource.dispose();
      disposedResources += 1;
    } catch (error) {
      errors.push(error);
    }
  }
  return { disposed: true, disposedResources, errors };
}

function addDisposableResources(resources, values) {
  if (!values) return;
  if (values instanceof Map || values instanceof Set) {
    for (const value of values.values()) addDisposableResource(resources, value);
    return;
  }
  if (Array.isArray(values)) {
    for (const value of values) addDisposableResource(resources, value);
    return;
  }
  if (typeof values === "object" && typeof values.dispose !== "function") {
    for (const value of Object.values(values)) addDisposableResource(resources, value);
    return;
  }
  addDisposableResource(resources, values);
}

function addDisposableResource(resources, resource) {
  if (resource && typeof resource.dispose === "function") resources.add(resource);
}

export function forwardNeural(model, states, actions, initialMemory = null, heads = {}) {
  const policy = forwardNeuralPolicy(model, states, actions, initialMemory);
  const { sequence, stateActionEmbedding } = policy;
  // Provisional search evidence is intentionally isolated from every tensor
  // used by the deployed policy. This head may prioritize future independent
  // confirmations, but it must never alter action selection.
  const teacherProposalValues = heads.teacherProposal === false ? null : tf.squeeze(
    model.layers.teacherProposalValue.apply(stateActionEmbedding),
    [-1]
  );
  const value = tf.squeeze(model.layers.value.apply(sequence), [-1]);
  const diagnostic = heads.diagnostic === false ? null : model.layers.diagnostic.apply(sequence);
  const belief = heads.belief === false ? null : model.layers.belief.apply(sequence);
  return {
    logits: policy.logits,
    policyLogits: policy.policyLogits,
    actionValues: policy.actionValues,
    teacherProposalValues,
    value,
    diagnostic,
    belief,
    memoryState: policy.memoryState
  };
}

function forwardStateActionEmbeddings(model, states, actions, initialMemory = null) {
  const applied = model.layers.gru.apply(states, initialMemory ? { initialState: [initialMemory] } : undefined);
  const sequence = Array.isArray(applied) ? applied[0] : applied;
  const memoryState = Array.isArray(applied) ? applied[1] : null;
  const stateEmbedding = model.layers.stateProjection.apply(sequence);
  const actionEmbedding = model.layers.actionProjection.apply(actions);
  const actionCount = actions.shape[2];
  const repeatedState = tf.tile(tf.expandDims(stateEmbedding, 2), [1, 1, actionCount, 1]);
  const interaction = tf.mul(repeatedState, actionEmbedding);
  const stateActionEmbedding = tf.concat([repeatedState, actionEmbedding, interaction], -1);
  return { sequence, memoryState, interaction, stateActionEmbedding };
}

function forwardNeuralPolicy(model, states, actions, initialMemory = null) {
  const { sequence, memoryState, interaction, stateActionEmbedding } = forwardStateActionEmbeddings(model, states, actions, initialMemory);
  const actionBias = tf.squeeze(model.layers.actionBias.apply(actions), [-1]);
  const policyLogits = tf.add(tf.sum(interaction, -1), actionBias);
  const actionValues = tf.squeeze(model.layers.actionValue.apply(stateActionEmbedding), [-1]);
  // Tactical heuristics are encoded as ordinary input features. They must not
  // bypass learning by being added directly to the final policy logits: the
  // same normally-good action can be wrong when a combo, response, sacrifice,
  // or delayed payoff changes the actual win probability.
  const logits = tf.add(policyLogits, tf.mul(actionValues, 0.5));
  return {
    sequence,
    stateActionEmbedding,
    logits,
    policyLogits,
    actionValues,
    memoryState
  };
}

export function createNeuralSession(model, options = {}) {
  const histories = new Map();
  const memories = new Map(Object.entries(options.initialMemories || {}));
  const configuredMaxHistory = Number(options.maxHistory);
  const maxHistory = options.maxHistory == null || !Number.isFinite(configuredMaxHistory)
    ? MAX_SEQUENCE
    : Math.max(0, Math.floor(configuredMaxHistory));
  const lean = options.lean === true;
  const decideEncoded = (actorId, prepared, decideOptions = {}) => {
    const state = prepared?.stateEncoding;
    const actions = prepared?.actions || [];
    const encoded = prepared?.actionEncoding;
    const legalCount = Math.min(actions.length, Number(prepared?.legalCount) || 0);
    if (!state || !encoded || !legalCount) return null;
    if (maxHistory > 0) {
      const history = [...(histories.get(actorId) || []), state].slice(-maxHistory);
      histories.set(actorId, history);
    }
    const initialMemory = memories.get(actorId) || new Array(NEURAL_HIDDEN_SIZE).fill(0);
    const outputs = lean
      ? inferLeanStep(model, state, encoded, legalCount, initialMemory)
      : inferStep(model, state, encoded, legalCount, initialMemory);
    memories.set(actorId, outputs.memory);
    // Value calibration belongs only to the win-probability head. Reusing
    // its temperature for action sampling silently changes the policy.
    const temperature = Math.max(0.05, decideOptions.temperature ?? 1);
    const probabilities = softmax(outputs.logits.slice(0, legalCount), temperature);
    const selectedIndex = decideOptions.greedy ? argmax(probabilities) : sample(probabilities, decideOptions.random || Math.random);
    const result = {
      action: actions[selectedIndex],
      selectedIndex,
      legalActions: actions,
      actionEncoding: encoded,
      stateEncoding: state,
      legalCount,
      probability: probabilities[selectedIndex],
      logProbability: Math.log(Math.max(1e-8, probabilities[selectedIndex])),
      behaviorTemperature: temperature,
      probabilities,
      initialMemory,
      nextMemory: outputs.memory
    };
    if (lean) return result;
    return {
      ...result,
      actionValues: outputs.actionValues.slice(0, legalCount),
      teacherProposalValues: outputs.teacherProposalValues.slice(0, legalCount),
      selectedActionValue: outputs.actionValues[selectedIndex],
      value: outputs.value,
      diagnostic: outputs.diagnostic,
      belief: outputs.belief
    };
  };
  return {
    reset(playerId = null) {
      if (playerId) { histories.delete(playerId); memories.delete(playerId); }
      else { histories.clear(); memories.clear(); }
    },
    history(playerId) { return histories.get(playerId) || []; },
    memory(playerId) { return memories.get(playerId) || null; },
    decide(game, actorId, legalActions, decideOptions = {}) {
      if (!legalActions.length) return null;
      const actionSet = encodeActionSet(game, actorId, legalActions);
      return decideEncoded(actorId, {
        stateEncoding: encodeState(game, actorId),
        actions: actionSet.actions,
        actionEncoding: actionSet.encoded,
        legalCount: actionSet.legalCount
      }, decideOptions);
    },
    decideEncoded
  };
}

export function inferStep(model, state, actions, legalCount, memory = null) {
  addAiPerformance("inferenceCalls");
  return measureAiPerformance("inferenceMs", () => tf.tidy(() => {
    const stateTensor = tf.tensor3d(state, [1, 1, STATE_DIM]);
    const actionTensor = tf.tensor4d(actions.slice(0, legalCount * ACTION_DIM), [1, 1, legalCount, ACTION_DIM]);
    const memoryTensor = memory ? tf.tensor2d(memory, [1, memory.length]) : null;
    const output = forwardNeural(model, stateTensor, actionTensor, memoryTensor);
    return {
      logits: Array.from(output.logits.slice([0, 0, 0], [1, 1, legalCount]).dataSync()),
      actionValues: Array.from(output.actionValues.slice([0, 0, 0], [1, 1, legalCount]).dataSync()),
      teacherProposalValues: Array.from(
        output.teacherProposalValues.slice([0, 0, 0], [1, 1, legalCount]).dataSync()
      ),
      value: output.value.dataSync()[0],
      diagnostic: Array.from(output.diagnostic.dataSync()),
      belief: Array.from(output.belief.dataSync()),
      memory: Array.from(output.memoryState.dataSync())
    };
  }));
}

function inferLeanStep(model, state, actions, legalCount, memory = null) {
  addAiPerformance("inferenceCalls");
  return measureAiPerformance("inferenceMs", () => tf.tidy(() => {
    const stateTensor = tf.tensor3d(state, [1, 1, STATE_DIM]);
    const actionValues = typeof actions.subarray === "function"
      ? actions.subarray(0, legalCount * ACTION_DIM)
      : actions.slice(0, legalCount * ACTION_DIM);
    const actionTensor = tf.tensor4d(actionValues, [1, 1, legalCount, ACTION_DIM]);
    const memoryTensor = memory ? tf.tensor2d(memory, [1, memory.length]) : null;
    const output = forwardNeuralPolicy(model, stateTensor, actionTensor, memoryTensor);
    return {
      logits: Array.from(output.logits.dataSync()),
      memory: Array.from(output.memoryState.dataSync())
    };
  }));
}

export function estimateNeuralValue(model, game, viewerId) {
  const state = encodeState(game, viewerId);
  if (evaluatorRequiresStructuredV2(model)) {
    const engineFingerprint = model.metadata?.engineFingerprint
      || "runtime-engine-unversioned";
    const structuredState = createPublicStructuredEvidenceSnapshot(
      game,
      viewerId,
      {
        engineFingerprint,
        informationSetHash:
          `runtime:${viewerId}:${Number(game.turnSequence) || 0}`
      }
    );
    return estimateEvidenceNeuralValue(model, state, structuredState, {
      engineFingerprint
    });
  }
  return estimateEncodedNeuralValue(model, state);
}

export function estimateEncodedNeuralValue(model, encodedState, options = {}) {
  if (!(Array.isArray(encodedState) || ArrayBuffer.isView(encodedState))
    || encodedState.length !== STATE_DIM) {
    throw new Error(`Encoded neural value state must contain ${STATE_DIM} values.`);
  }
  if (evaluatorRequiresStructuredV2(model)) {
    if (!options.structuredState) {
      throw new Error(
        "Structured-v2 evaluator inference requires its public snapshot."
      );
    }
    return estimateEvidenceNeuralValue(
      model,
      encodedState,
      options.structuredState,
      options
    );
  }
  const state = Float32Array.from(encodedState);
  return tf.tidy(() => forwardEvaluatorValue(
    model,
    tf.tensor3d(state, [1, 1, STATE_DIM]),
    { targetHead: options.targetHead }
  ).dataSync()[0]);
}

export function estimateEvidenceNeuralValue(
  model,
  encodedState,
  structuredState,
  options = {}
) {
  if (!evaluatorRequiresStructuredV2(model)) {
    return estimateEncodedNeuralValue(model, encodedState);
  }
  const input = createStructuredV2TensorInput([structuredState], {
    engineFingerprint: options.engineFingerprint,
    informationSetHashes: options.informationSetHash
      ? [options.informationSetHash]
      : undefined,
    legacyStates: [encodedState]
  });
  try {
    return tf.tidy(() =>
      forwardEvaluatorValue(model, input, {
        targetHead: options.targetHead
      }).dataSync()[0]);
  } finally {
    disposeStructuredV2TensorInput(input);
  }
}

export function inferSequence(model, history, finalActions, legalCount) {
  return tf.tidy(() => {
    const length = Math.max(1, history.length);
    const stateData = new Float32Array(length * STATE_DIM);
    history.forEach((state, index) => stateData.set(state, index * STATE_DIM));
    const actionCount = legalCount;
    const actionData = new Float32Array(length * actionCount * ACTION_DIM);
    actionData.set(finalActions.slice(0, actionCount * ACTION_DIM), (length - 1) * actionCount * ACTION_DIM);
    const states = tf.tensor3d(stateData, [1, length, STATE_DIM]);
    const actions = tf.tensor4d(actionData, [1, length, actionCount, ACTION_DIM]);
    const output = forwardNeural(model, states, actions);
    const logits = Array.from(output.logits.slice([0, length - 1, 0], [1, 1, legalCount]).dataSync());
    const value = output.value.slice([0, length - 1], [1, 1]).dataSync()[0];
    const belief = Array.from(output.belief.slice([0, length - 1, 0], [1, 1, CARD_BINS]).dataSync());
    return { logits, value, belief };
  });
}

export function trainPpoBatch(model, batch, optimizer, options = {}) {
  const clipRatio = options.clipRatio || 0.2;
  const policyCoefficient = options.policyCoefficient ?? 1;
  const valueCoefficient = options.valueCoefficient ?? 0.5;
  const actionValueCoefficient = options.actionValueCoefficient ?? 0.25;
  const diagnosticCoefficient = options.diagnosticCoefficient ?? 0.05;
  const beliefCoefficient = options.beliefCoefficient ?? 0.15;
  const entropyCoefficient = options.entropyCoefficient ?? 0.01;
  const teacherCoefficient = options.teacherCoefficient ?? 0.2;
  const teacherDistillationCoefficient = options.teacherDistillationCoefficient ?? 1;
  const teacherPolicyPreferenceCoefficient = options.teacherPolicyPreferenceCoefficient ?? 0.5;
  const teacherRankingCoefficient = options.teacherRankingCoefficient ?? 0.3;
  const teacherActionValueCoefficient = options.teacherActionValueCoefficient ?? 0.25;
  const anchorCoefficient = options.anchorCoefficient ?? 0.03;
  const anchorModels = normalizeAnchorModels(options);
  if (!ppoBatchHasEffectiveSignal(batch, {
    policyCoefficient,
    valueCoefficient,
    actionValueCoefficient,
    diagnosticCoefficient,
    beliefCoefficient,
    entropyCoefficient,
    teacherCoefficient,
    teacherRankingCoefficient,
    teacherActionValueCoefficient
  })) {
    return emptyPpoMetrics();
  }
  const hasTeacherSignal = ((teacherCoefficient > 0 || teacherRankingCoefficient > 0) && Array.from(batch.teacherWeights).some((weight) => weight > 0))
    || (teacherActionValueCoefficient > 0 && Array.from(batch.teacherActionValueWeights).some((weight) => weight > 0));
  const variableList = trainableVariables(model);
  const tensors = makeBatchTensors(batch);
  const actionCount = tensors.actions.shape[2];
  let components = null;
  const lossFunction = () => {
    const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories, { teacherProposal: false, diagnostic: diagnosticCoefficient > 0, belief: beliefCoefficient > 0 });
    const legalMask = tf.less(
      tf.reshape(tf.range(0, actionCount, 1, "int32"), [1, 1, actionCount]),
      tf.expandDims(tensors.legalCounts, -1)
    ).toFloat();
    const policyTemperature = tf.maximum(0.05, tf.expandDims(tensors.behaviorTemperatures, -1));
    const maskedLogits = tf.add(tf.div(output.logits, policyTemperature), tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = actionOneHot(tensors.selectedIndices, actionCount);
    const newLogProbabilities = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
    const ratio = tf.exp(tf.sub(newLogProbabilities, tensors.oldLogProbabilities));
    const clippedRatio = tf.clipByValue(ratio, 1 - clipRatio, 1 + clipRatio);
    const surrogate = tf.minimum(tf.mul(ratio, tensors.advantages), tf.mul(clippedRatio, tensors.advantages));
    const denominator = tf.maximum(1, tf.sum(tensors.stepMask));
    const policyDenominator = tf.maximum(1, tf.sum(tensors.policyStepWeights));
    const policyLoss = tf.neg(tf.div(
      tf.sum(tf.mul(surrogate, tensors.policyStepWeights)),
      policyDenominator
    ));
    // Candidate search can deliberately evaluate only a strategic subset.
    // Distill relative preferences inside that support without treating every
    // unsearched legal action as proven bad.
    const { teacherLoss, teacherDistillationLoss, teacherPolicyPreferenceLoss, teacherRankingLoss, teacherActionValueLoss } = teacherPpoLosses(output, tensors, selectedMask, { teacherDistillationCoefficient, teacherPolicyPreferenceCoefficient }, hasTeacherSignal);
    const valueError = tf.square(tf.sub(output.value, tensors.returns));
    const valueLoss = tf.div(tf.sum(tf.mul(valueError, tensors.stepMask)), denominator);
    const selectedActionValues = tf.sum(tf.mul(output.actionValues, selectedMask), -1);
    const actionValueError = tf.square(tf.sub(selectedActionValues, tensors.returns));
    const actionValueLoss = tf.div(tf.sum(tf.mul(actionValueError, tensors.stepMask)), denominator);
    const diagnosticLoss = diagnosticCoefficient > 0 ? tf.div(
      tf.sum(tf.mul(tf.square(tf.sub(output.diagnostic, tensors.diagnosticTargets)), tensors.diagnosticWeights)),
      tf.maximum(1, tf.sum(tensors.diagnosticWeights))
    ) : tf.scalar(0);
    const beliefLoss = beliefCoefficient > 0 ? weightedBeliefCrossEntropyLoss(
      output.belief, tensors.beliefTargets, tensors.stepMask, denominator
    ) : tf.scalar(0);
    const entropy = tf.neg(tf.div(
      tf.sum(tf.mul(
        tf.sum(tf.mul(tf.exp(logProbabilities), logProbabilities), -1),
        tensors.policyStepWeights
      )),
      policyDenominator
    ));
    let anchorKl = tf.scalar(0);
    if (anchorModels.length && anchorCoefficient > 0) {
      // Keep the candidate near both its immediate parent and the stable
      // champion. A champion-only anchor allowed useful learner behaviour to
      // disappear between non-promoted generations.
      const weightedAnchorKls = anchorModels.map(({ model: anchorModel, weight }) => {
        const anchorOutput = forwardNeuralPolicy(anchorModel, tensors.states, tensors.actions, tensors.initialMemories);
        const anchorMaskedLogits = tf.add(tf.div(anchorOutput.logits, policyTemperature), tf.mul(tf.sub(1, legalMask), -1e9));
        // Anchor variables are intentionally absent from variableList, so this
        // branch is constant with respect to the candidate update.
        const anchorLogProbabilities = tf.logSoftmax(anchorMaskedLogits, -1);
        const anchorProbabilities = tf.exp(anchorLogProbabilities);
        const perStepKl = tf.sum(tf.mul(anchorProbabilities, tf.sub(anchorLogProbabilities, logProbabilities)), -1);
        return tf.mul(tf.div(
          tf.sum(tf.mul(perStepKl, tensors.policyStepWeights)),
          policyDenominator
        ), weight);
      });
      anchorKl = weightedAnchorKls.length === 1 ? weightedAnchorKls[0] : tf.addN(weightedAnchorKls);
    }
    components = {
      policyLoss: tf.keep(policyLoss),
      valueLoss: tf.keep(valueLoss),
      actionValueLoss: tf.keep(actionValueLoss),
      diagnosticLoss: tf.keep(diagnosticLoss),
      teacherActionValueLoss: tf.keep(teacherActionValueLoss),
      teacherRankingLoss: tf.keep(teacherRankingLoss),
      teacherDistillationLoss: tf.keep(teacherDistillationLoss),
      teacherPolicyPreferenceLoss: tf.keep(teacherPolicyPreferenceLoss),
      teacherLoss: tf.keep(teacherLoss),
      beliefLoss: tf.keep(beliefLoss),
      entropy: tf.keep(entropy),
      anchorKl: tf.keep(anchorKl)
    };
    return tf.addN([
      tf.mul(policyLoss, policyCoefficient),
      tf.mul(valueLoss, valueCoefficient),
      tf.mul(actionValueLoss, actionValueCoefficient),
      tf.mul(diagnosticLoss, diagnosticCoefficient),
      tf.mul(teacherLoss, teacherCoefficient),
      tf.mul(teacherRankingLoss, teacherRankingCoefficient),
      tf.mul(teacherActionValueLoss, teacherActionValueCoefficient),
      tf.mul(beliefLoss, beliefCoefficient),
      tf.mul(anchorKl, anchorCoefficient),
      tf.mul(entropy, -entropyCoefficient)
    ]);
  };
  const { value: loss, grads } = tf.variableGrads(lossFunction, variableList);
  const gradientDiagnostics = summarizeGradientNorms(grads);
  const gradientSignature = options.captureGradientSignature === true
    ? captureGradientSignature(grads, options.gradientSignatureGroups || ["shared-state-memory"])
    : null;
  if (options.applyGradients !== false) optimizer.applyGradients(grads);
  const result = {
    optimizerStepApplied: options.applyGradients !== false,
    loss: loss.dataSync()[0],
    policyLoss: components.policyLoss.dataSync()[0],
    valueLoss: components.valueLoss.dataSync()[0],
    actionValueLoss: components.actionValueLoss.dataSync()[0],
    diagnosticLoss: components.diagnosticLoss.dataSync()[0],
    teacherActionValueLoss: components.teacherActionValueLoss.dataSync()[0],
    teacherLoss: components.teacherLoss.dataSync()[0],
    teacherDistillationLoss: components.teacherDistillationLoss.dataSync()[0],
    teacherPolicyPreferenceLoss: components.teacherPolicyPreferenceLoss.dataSync()[0],
    teacherRankingLoss: components.teacherRankingLoss.dataSync()[0],
    beliefLoss: components.beliefLoss.dataSync()[0],
    entropy: components.entropy.dataSync()[0],
    anchorKl: components.anchorKl.dataSync()[0],
    gradientNorm: gradientDiagnostics.total,
    gradientNormByGroup: gradientDiagnostics.byGroup,
    gradientSignature
  };
  Object.values(grads).forEach((tensor) => tensor.dispose());
  loss.dispose();
  Object.values(components).forEach((tensor) => tensor.dispose());
  Object.values(tensors).forEach((tensor) => tensor.dispose());
  return result;
}

function teacherPpoLosses(output, tensors, selectedMask, coefficients, hasSignal) {
  if (!hasSignal) return Object.fromEntries(["teacherLoss","teacherDistillationLoss","teacherPolicyPreferenceLoss","teacherRankingLoss","teacherActionValueLoss"].map((name) => [name, tf.scalar(0)]));
  const { teacherDistillationCoefficient, teacherPolicyPreferenceCoefficient } = coefficients;
  const actionCount = tensors.actions.shape[2];
  const selectedActionValues = tf.sum(tf.mul(output.actionValues, selectedMask), -1);
  const teacherSupport = tf.greater(tensors.teacherSupports, 0).toFloat();
  const teacherMaskedLogits = tf.add(output.policyLogits, tf.mul(tf.sub(1, teacherSupport), -1e9));
  const teacherSupportedLogProbabilities = tf.logSoftmax(teacherMaskedLogits, -1);
  const teacherTargetTotals = tf.maximum(1e-8, tf.sum(tensors.teacherTargets, -1, true));
  const normalizedTeacherTargets = tf.div(tensors.teacherTargets, teacherTargetTotals);
  const teacherLogProbabilities = tf.sum(tf.mul(teacherSupportedLogProbabilities, normalizedTeacherTargets), -1);
  const teacherStepSupport = tf.mul(tf.greater(tensors.teacherWeights, 0).toFloat(), tensors.stepMask);
  const teacherDenominator = tf.maximum(1, tf.sum(teacherStepSupport));
  const teacherDistillationLoss = tf.neg(tf.div(
    tf.sum(tf.mul(teacherLogProbabilities, tensors.teacherWeights)),
    teacherDenominator
  ));
  const teacherBestMask = actionOneHot(tensors.teacherIndices, actionCount);
  const teacherBestPolicyLogits = tf.sum(tf.mul(output.policyLogits, teacherBestMask), -1);
  const selectedPolicyLogits = tf.sum(tf.mul(output.policyLogits, selectedMask), -1);
  const teacherBestActionValues = tf.sum(tf.mul(output.actionValues, teacherBestMask), -1);
  const distinctTeacherChoice = tf.notEqual(tensors.teacherIndices, tensors.selectedIndices).toFloat();
  const rankingWeights = tf.mul(tf.mul(tensors.teacherWeights, distinctTeacherChoice), tensors.stepMask);
  const rankingSupport = tf.mul(tf.mul(tf.greater(tensors.teacherWeights, 0).toFloat(), distinctTeacherChoice), tensors.stepMask);
  const rankingDenominator = tf.maximum(1, tf.sum(rankingSupport));
  // A verified correction should establish a margin, not push the teacher
  // probability toward one forever. The hinge reaches exactly zero once the
  // requested margin is satisfied, automatically lowering repeat priority.
  const policyPreferenceError = tf.relu(tf.sub(
    tensors.teacherMargins,
    tf.sub(teacherBestPolicyLogits, selectedPolicyLogits)
  ));
  const teacherPolicyPreferenceLoss = tf.div(
    tf.sum(tf.mul(policyPreferenceError, rankingWeights)),
    rankingDenominator
  );
  const teacherLoss = tf.add(
    tf.mul(teacherDistillationLoss, teacherDistillationCoefficient),
    tf.mul(teacherPolicyPreferenceLoss, teacherPolicyPreferenceCoefficient)
  );
  const rankingError = tf.relu(tf.sub(tensors.teacherMargins,
    tf.sub(teacherBestActionValues, selectedActionValues)));
  const teacherRankingLoss = tf.div(tf.sum(tf.mul(rankingError, rankingWeights)), rankingDenominator);
  const teacherActionValueError = tf.abs(tf.sub(output.actionValues, tensors.teacherActionValueTargets));
  const teacherActionValueQuadratic = tf.minimum(teacherActionValueError, 1);
  const teacherActionValueHuber = tf.add(
    tf.mul(tf.square(teacherActionValueQuadratic), 0.5),
    tf.sub(teacherActionValueError, teacherActionValueQuadratic)
  );
  const teacherActionValueSupport = tf.greater(tensors.teacherActionValueWeights, 0).toFloat();
  const teacherActionValueDenominator = tf.maximum(1, tf.sum(teacherActionValueSupport));
  const teacherActionValueLoss = tf.div(
    tf.sum(tf.mul(teacherActionValueHuber, tensors.teacherActionValueWeights)),
    teacherActionValueDenominator
  );
  return { teacherLoss, teacherDistillationLoss, teacherPolicyPreferenceLoss, teacherRankingLoss, teacherActionValueLoss };
}

export function trainTeacherProposalValueBatch(model, batch, optimizer, options = {}) {
  const coefficient = Math.max(0, Number(options.coefficient) || 0);
  const hasTargets = coefficient > 0
    && Array.from(batch.teacherActionValueWeights || []).some((value) => Number(value) > 0);
  if (!hasTargets) return {
    ...emptyPpoMetrics(),
    teacherProposalValueLoss: 0
  };
  const tensors = makeBatchTensors(batch);
  const variableList = model.layers.teacherProposalValue.trainableWeights
    .map((weight) => weight.val);
  let keptLoss = null;
  const lossFunction = () => {
    const { stateActionEmbedding } = forwardStateActionEmbeddings(model, tensors.states, tensors.actions, tensors.initialMemories);
    const output = { teacherProposalValues: tf.squeeze(model.layers.teacherProposalValue.apply(stateActionEmbedding), [-1]) };
    const absoluteError = tf.abs(tf.sub(
      output.teacherProposalValues,
      tensors.teacherActionValueTargets
    ));
    const quadratic = tf.minimum(absoluteError, 1);
    const huber = tf.add(
      tf.mul(tf.square(quadratic), 0.5),
      tf.sub(absoluteError, quadratic)
    );
    const support = tf.greater(tensors.teacherActionValueWeights, 0).toFloat();
    const denominator = tf.maximum(1, tf.sum(support));
    const loss = tf.div(
      tf.sum(tf.mul(huber, tensors.teacherActionValueWeights)),
      denominator
    );
    keptLoss = tf.keep(loss);
    return tf.mul(loss, coefficient);
  };
  const { value: loss, grads } = tf.variableGrads(lossFunction, variableList);
  const gradientDiagnostics = summarizeGradientNorms(grads);
  if (options.applyGradients !== false) optimizer.applyGradients(grads);
  const proposalLoss = keptLoss.dataSync()[0];
  const result = {
    ...emptyPpoMetrics(),
    optimizerStepApplied: options.applyGradients !== false,
    loss: loss.dataSync()[0],
    teacherActionValueLoss: proposalLoss,
    teacherProposalValueLoss: proposalLoss,
    gradientNorm: gradientDiagnostics.total,
    gradientNormByGroup: gradientDiagnostics.byGroup
  };
  Object.values(grads).forEach((tensor) => tensor.dispose());
  loss.dispose();
  keptLoss.dispose();
  Object.values(tensors).forEach((tensor) => tensor.dispose());
  return result;
}

function captureGradientSignature(grads, includedGroups) {
  const allowed = new Set(includedGroups || []);
  const entries = [];
  let length = 0;
  for (const [name, gradient] of Object.entries(grads || {})) {
    const group = gradientVariableGroup(name);
    if (!allowed.has(group)) continue;
    const values = Float32Array.from(gradient.dataSync());
    entries.push({ name, group, values });
    length += values.length;
  }
  return { version: 1, groups: [...allowed], length, entries };
}

function ppoBatchHasEffectiveSignal(batch, coefficients) {
  const hasSteps = Array.from(batch.stepMask || []).some((value) => Number(value) > 0);
  if (hasSteps && [
    coefficients.policyCoefficient,
    coefficients.valueCoefficient,
    coefficients.actionValueCoefficient,
    coefficients.beliefCoefficient,
    coefficients.entropyCoefficient
  ].some((value) => Number(value) !== 0)) return true;
  if (Number(coefficients.diagnosticCoefficient) !== 0
    && Array.from(batch.diagnosticWeights || []).some((value) => Number(value) > 0)) return true;
  const hasTeacherPolicy = Array.from(batch.teacherWeights || []).some((value) => Number(value) > 0);
  if (hasTeacherPolicy && (Number(coefficients.teacherCoefficient) !== 0
    || Number(coefficients.teacherRankingCoefficient) !== 0)) return true;
  return Number(coefficients.teacherActionValueCoefficient) !== 0
    && Array.from(batch.teacherActionValueWeights || []).some((value) => Number(value) > 0);
}

function emptyPpoMetrics() {
  return {
    optimizerStepApplied: false,
    loss: 0,
    policyLoss: 0,
    valueLoss: 0,
    actionValueLoss: 0,
    diagnosticLoss: 0,
    teacherActionValueLoss: 0,
    teacherLoss: 0,
    teacherDistillationLoss: 0,
    teacherPolicyPreferenceLoss: 0,
    teacherRankingLoss: 0,
    beliefLoss: 0,
    entropy: 0,
    anchorKl: 0,
    gradientNorm: 0,
    gradientNormByGroup: {},
    gradientSignature: null
  };
}

function summarizeGradientNorms(grads) {
  const squaredByGroup = {};
  let totalSquared = 0;
  for (const [name, gradient] of Object.entries(grads || {})) {
    const squared = tf.tidy(() => tf.sum(tf.square(gradient)).dataSync()[0]);
    const group = gradientVariableGroup(name);
    totalSquared += squared;
    squaredByGroup[group] = (squaredByGroup[group] || 0) + squared;
  }
  return {
    total: Math.sqrt(Math.max(0, totalSquared)),
    byGroup: Object.fromEntries(Object.entries(squaredByGroup).map(([group, squared]) => [
      group,
      Math.sqrt(Math.max(0, squared))
    ]))
  };
}

function gradientVariableGroup(name) {
  if (name.includes("memory_gru") || name.includes("state_projection")) return "shared-state-memory";
  if (name.includes("action_projection") || name.includes("action_bias")) return "policy-action-encoder";
  if (name.includes("action_value_head")) return "action-value";
  if (name.includes("teacher_proposal_value_head")) return "teacher-proposal-value";
  if (name.includes("value_head")) return "state-value";
  if (name.includes("belief_head")) return "belief";
  if (name.includes("diagnostic_auxiliary_head")) return "diagnostic";
  return "other";
}

function normalizeAnchorModels(options) {
  const configured = Array.isArray(options.anchorModels) && options.anchorModels.length
    ? options.anchorModels
    : (options.anchorModel ? [{ model: options.anchorModel, weight: 1 }] : []);
  const unique = new Map();
  for (const entry of configured) {
    const model = entry?.model || entry;
    if (!model) continue;
    unique.set(model, (unique.get(model) || 0) + Math.max(0, Number(entry?.weight) || 0));
  }
  const totalWeight = [...unique.values()].reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) return [];
  return [...unique].map(([model, weight]) => ({ model, weight: weight / totalWeight }));
}

export function trainBehaviorCloningBatch(model, batch, optimizer, options = {}) {
  const policyInitializationOnly = options.policyInitializationOnly === true;
  if (policyInitializationOnly && ((options.valueCoefficient ?? 0) !== 0 || (options.beliefCoefficient ?? 0) !== 0)) {
    throw new Error('Tactical initialization must not train value or hidden-card labels.');
  }
  const valueCoefficient = options.valueCoefficient ?? (policyInitializationOnly ? 0 : 0.35);
  const beliefCoefficient = options.beliefCoefficient ?? (policyInitializationOnly ? 0 : 0.1);
  const entropyCoefficient = options.entropyCoefficient ?? 0.002;
  const variableList = policyInitializationOnly
    ? ['stateProjection','actionProjection','actionBias'].flatMap(name => model.layers[name].trainableWeights.map(w=>w.val))
    : trainableVariables(model);
  const tensors = makeBatchTensors(batch);
  const actionCount = tensors.actions.shape[2];
  let components = null;
  const loss = optimizer.minimize(() => {
    const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories, { teacherProposal: false, diagnostic: false });
    const legalMask = legalActionMask(tensors.legalCounts, actionCount);
    const maskedLogits = tf.add(output.logits, tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = actionOneHot(tensors.selectedIndices, actionCount);
    const selectedLogProbabilities = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
    const weights = tf.mul(tensors.stepMask, tf.maximum(0.05, tensors.advantages));
    const denominator = tf.maximum(1, tf.sum(weights));
    const policyLoss = tf.neg(tf.div(tf.sum(tf.mul(selectedLogProbabilities, weights)), denominator));
    const stepDenominator = tf.maximum(1, tf.sum(tensors.stepMask));
    const valueLoss = tf.div(tf.sum(tf.mul(tf.square(tf.sub(output.value, tensors.returns)), tensors.stepMask)), stepDenominator);
    const beliefLoss = weightedBeliefCrossEntropyLoss(output.belief, tensors.beliefTargets, tensors.stepMask, stepDenominator);
    const entropy = tf.neg(tf.div(tf.sum(tf.mul(tf.sum(tf.mul(tf.exp(logProbabilities), logProbabilities), -1), tensors.stepMask)), stepDenominator));
    components = {
      policyLoss: tf.keep(policyLoss), valueLoss: tf.keep(valueLoss),
      beliefLoss: tf.keep(beliefLoss), entropy: tf.keep(entropy)
    };
    return tf.addN([
      policyLoss,
      tf.mul(valueLoss, valueCoefficient),
      tf.mul(beliefLoss, beliefCoefficient),
      tf.mul(entropy, -entropyCoefficient)
    ]);
  }, true, variableList);
  const result = readLossComponents(loss, components, batch);
  Object.values(tensors).forEach((tensor) => tensor.dispose());
  return result;
}

export function evaluateBehaviorCloningBatch(model, batch) {
  const tensors = makeBatchTensors(batch);
  const actionCount = tensors.actions.shape[2];
  const result = tf.tidy(() => {
    const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories, { teacherProposal: false, diagnostic: false });
    const legalMask = legalActionMask(tensors.legalCounts, actionCount);
    const maskedLogits = tf.add(output.logits, tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = actionOneHot(tensors.selectedIndices, actionCount);
    const teacherMask = actionOneHot(tensors.teacherIndices, actionCount);
    const selectedLogProbabilities = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
    const teacherPolicyLogits = tf.sum(tf.mul(output.policyLogits, teacherMask), -1);
    const selectedPolicyLogits = tf.sum(tf.mul(output.policyLogits, selectedMask), -1);
    const teacherActionValues = tf.sum(tf.mul(output.actionValues, teacherMask), -1);
    const selectedActionValues = tf.sum(tf.mul(output.actionValues, selectedMask), -1);
    const predictions = tf.argMax(maskedLogits, -1).toInt();
    const correct = tf.mul(tf.equal(predictions, tensors.selectedIndices).toFloat(), tensors.stepMask);
    const decisionMask = tf.mul(tf.greater(tensors.legalCounts, 1).toFloat(), tensors.stepMask);
    const decisionCorrect = tf.mul(tf.equal(predictions, tensors.selectedIndices).toFloat(), decisionMask);
    const chanceCorrect = tf.mul(tf.div(1, tf.maximum(1, tensors.legalCounts.toFloat())), decisionMask);
    const count = Math.max(1, tf.sum(tensors.stepMask).dataSync()[0]);
    return {
      steps: count,
      correct: tf.sum(correct).dataSync()[0],
      decisionSteps: tf.sum(decisionMask).dataSync()[0],
      decisionCorrect: tf.sum(decisionCorrect).dataSync()[0],
      chanceCorrect: tf.sum(chanceCorrect).dataSync()[0],
      policyLoss: -tf.sum(tf.mul(selectedLogProbabilities, tensors.stepMask)).dataSync()[0] / count,
      valueMse: tf.sum(tf.mul(tf.square(tf.sub(output.value, tensors.returns)), tensors.stepMask)).dataSync()[0] / count,
      beliefLoss: weightedBeliefCrossEntropyLoss(output.belief, tensors.beliefTargets, tensors.stepMask, tf.scalar(count)).dataSync()[0],
      values: Array.from(output.value.dataSync()),
      returns: Array.from(tensors.returns.dataSync()),
      outcomes: Array.from(tensors.outcomeTargets.dataSync()),
      teacherPolicyMargins: Array.from(tf.sub(
        teacherPolicyLogits,
        selectedPolicyLogits
      ).dataSync()),
      teacherActionValueMargins: Array.from(tf.sub(
        teacherActionValues,
        selectedActionValues
      ).dataSync()),
      actionValues: Array.from(output.actionValues.dataSync()),
      teacherWeights: Array.from(tensors.teacherWeights.dataSync()),
      beliefMetrics: beliefEvaluationMetrics(output.belief, tensors.beliefTargets, tensors.stepMask),
      mask: Array.from(tensors.stepMask.dataSync())
    };
  });
  Object.values(tensors).forEach((tensor) => tensor.dispose());
  return result;
}

export function serializeNeuralModel(model) {
  return {
    version: model.version,
    generation: model.generation,
    gamesTrained: model.gamesTrained,
    calibration: model.calibration,
    metadata: model.metadata,
    knowledge: model.knowledge,
    architecture: {
      stateDim: STATE_DIM,
      stateLayoutVersion: STRUCTURED_STATE_LAYOUT.version,
      actionDim: ACTION_DIM,
      maxActions: MAX_ACTIONS,
      cardVocabulary: CARD_VOCABULARY,
      cardVocabularySize: CARD_BINS,
      evaluator: evaluatorArchitecture(model)
    },
    weights: Object.fromEntries(Object.entries(model.layers).map(([name, layer]) => [name, layer.getWeights().map((tensor) => ({
      shape: tensor.shape,
      values: Array.from(tensor.dataSync())
    }))]))
  };
}

export function deserializeNeuralModel(checkpoint) {
  if (![2, 3, 4, 5, NEURAL_MODEL_VERSION].includes(checkpoint?.version)) {
    throw new Error(`Neural checkpoint version ${checkpoint?.version ?? "unknown"} is incompatible with model version ${NEURAL_MODEL_VERSION}.`);
  }
  const vocabularyMigration = checkpointVocabularyMigration(checkpoint);
  let model = null;
  try {
    model = createNeuralModel({
      ...checkpoint,
      evaluatorArchitecture: checkpoint.architecture?.evaluator || null,
      evaluatorWarmStart: false
    });
    const migrateCompositeTacticalFeature = checkpoint.metadata?.actionRepresentation !== "semantic-tactical-v3";
    for (const [name, weights] of Object.entries(checkpoint.weights || {})) {
      if (!model.layers[name]) continue;
      const expectedTensors = model.layers[name].getWeights();
      const expectedShapes = expectedTensors.map((tensor) => [...tensor.shape]);
      const tensors = [];
      try {
        for (const [index, weight] of weights.entries()) {
          const migrated = migratedCheckpointWeight(
            name,
            index,
            weight,
            expectedShapes[index],
            vocabularyMigration
          );
          const shape = migrated.shape;
          let values = migrated.values;
          if (migrateCompositeTacticalFeature && ["actionProjection", "actionBias"].includes(name)
            && shape?.[0] === ACTION_DIM) values = zeroInputRow(values, shape, LEGACY_ACTION_DIM + 15);
          tensors.push(tf.tensor(values, shape));
        }
        model.layers[name].setWeights(tensors);
      } finally {
        for (const tensor of tensors) tensor.dispose();
      }
    }
    if (vocabularyMigration.extended || checkpoint.version < NEURAL_MODEL_VERSION
      || checkpoint.architecture.actionDim !== ACTION_DIM) {
      model.checkpointInputMigrated = true;
      model.metadata.encodingMigration = {
        fromVersion: checkpoint.version,
        fromStateDim: checkpoint.architecture.stateDim,
        fromActionDim: checkpoint.architecture.actionDim,
        toActionDim: ACTION_DIM,
        fromVocabularySize: checkpoint.architecture.cardVocabularySize,
        toStateDim: STATE_DIM,
        requiresRevalidation: true
      };
    }
    return model;
  } catch (error) {
    if (model) disposeNeuralModel(model);
    throw error;
  }
}

function checkpointVocabularyMigration(checkpoint) {
  const architecture = checkpoint?.architecture;
  const vocabulary = architecture?.cardVocabulary;
  if (!Array.isArray(vocabulary) || !vocabulary.length) {
    throw new Error("Neural checkpoint card vocabulary is missing.");
  }
  if (!Number.isInteger(architecture.cardVocabularySize)
    || architecture.cardVocabularySize !== vocabulary.length) {
    throw new Error("Neural checkpoint card vocabulary size does not match its vocabulary.");
  }

  const seen = new Set();
  const currentIndexes = [];
  let previousCurrentIndex = -1;
  for (const cardNumber of vocabulary) {
    if (typeof cardNumber !== "string" || !cardNumber) {
      throw new Error("Neural checkpoint card vocabulary contains an invalid entry.");
    }
    if (seen.has(cardNumber)) {
      throw new Error(`Neural checkpoint card vocabulary contains duplicate entry ${cardNumber}.`);
    }
    seen.add(cardNumber);
    const currentIndex = CARD_INDEX.get(cardNumber);
    if (currentIndex == null) {
      throw new Error(`Neural checkpoint card vocabulary entry ${cardNumber} is unavailable.`);
    }
    if (currentIndex <= previousCurrentIndex) {
      throw new Error("Neural checkpoint card vocabulary is not an order-preserving subset of the registered card pool.");
    }
    currentIndexes.push(currentIndex);
    previousCurrentIndex = currentIndex;
  }
  if (currentIndexes[0] !== 0) {
    throw new Error("Neural checkpoint card vocabulary is missing the unknown-card entry.");
  }

  const cardZoneCount = STRUCTURED_STATE_LAYOUT.cardZones.count;
  const currentTailRows = STATE_DIM - STATE_SCALARS - cardZoneCount * CARD_BINS;
  const tailRows = architecture.stateDim - STATE_SCALARS - cardZoneCount * vocabulary.length;
  if (![currentTailRows, currentTailRows - CONTEXT_READY_FEATURES,
    currentTailRows - CONTEXT_READY_FEATURES - CONTEXT_RULE_FEATURES].includes(tailRows)) {
    throw new Error("Neural checkpoint state layout does not match its card vocabulary.");
  }
  const checkpointStateDim = STATE_SCALARS + cardZoneCount * vocabulary.length + tailRows;
  if (architecture.stateDim !== checkpointStateDim) {
    throw new Error("Neural checkpoint state layout does not match its card vocabulary.");
  }

  const extended = vocabulary.length !== CARD_BINS || checkpointStateDim !== STATE_DIM;
  const migration = {
    extended,
    oldCardBins: vocabulary.length,
    oldStateDim: checkpointStateDim,
    currentIndexes,
    cardZoneCount,
    tailRows
  };
  if (extended) validateVocabularyExtensionWeights(checkpoint, migration);
  return migration;
}

function validateVocabularyExtensionWeights(checkpoint, migration) {
  const gruWeights = checkpoint?.weights?.gru;
  const beliefWeights = checkpoint?.weights?.belief;
  if (!Array.isArray(gruWeights) || gruWeights.length !== 3
    || !Array.isArray(beliefWeights) || beliefWeights.length !== 2) {
    throw new Error("Neural checkpoint vocabulary extension requires complete GRU and belief weights.");
  }
  const gruKernel = gruWeights[0];
  const beliefKernel = beliefWeights[0];
  const beliefBias = beliefWeights[1];
  if (!weightHasLayout(gruKernel, [migration.oldStateDim, null])
    || !weightHasLayout(beliefKernel, [null, migration.oldCardBins])
    || !weightHasLayout(beliefBias, [migration.oldCardBins])) {
    throw new Error("Neural checkpoint GRU or belief layout does not match its card vocabulary.");
  }
}

function weightHasLayout(weight, dimensions) {
  if (!Array.isArray(weight?.shape) || weight.shape.length !== dimensions.length
    || !weight?.values || typeof weight.values.length !== "number") return false;
  if (dimensions.some((dimension, index) => dimension != null && weight.shape[index] !== dimension)) return false;
  if (weight.shape.some((dimension) => !Number.isInteger(dimension) || dimension <= 0)) return false;
  return weight.values.length === weight.shape.reduce((product, dimension) => product * dimension, 1);
}

function migratedCheckpointWeight(name, index, weight, expectedShape, vocabularyMigration) {
  if (vocabularyMigration.extended && ["gru", "evaluatorFlatGru"].includes(name) && index === 0) {
    return migrateGruVocabularyKernel(weight, expectedShape, vocabularyMigration);
  }
  if (vocabularyMigration.extended && name === "belief" && index === 0) {
    return migrateBeliefVocabularyKernel(weight, expectedShape, vocabularyMigration);
  }
  if (vocabularyMigration.extended && name === "belief" && index === 1) {
    return migrateBeliefVocabularyBias(weight, expectedShape, vocabularyMigration);
  }
  if (vocabularyMigration.extended && name === "evaluatorCardProjection" && index === 0) {
    const { oldCardBins, currentIndexes } = vocabularyMigration;
    const suffix = weight.shape[0] - oldCardBins;
    if (expectedShape?.[0] !== CARD_BINS + suffix || ![4, 32].includes(suffix)
      || !weightHasLayout(weight, [oldCardBins + suffix, expectedShape?.[1]])) {
      throw new Error("Neural checkpoint evaluator card projection cannot be migrated.");
    }
    const values = new Float32Array(expectedShape[0] * expectedShape[1]);
    for (let row = 0; row < oldCardBins; row += 1) {
      copyMatrixRows(weight.values, row, values, currentIndexes[row], 1, expectedShape[1]);
    }
    copyMatrixRows(weight.values, oldCardBins, values, CARD_BINS, suffix, expectedShape[1]);
    return { shape: expectedShape, values };
  }
  return {
    shape: migratedWeightShape(weight, expectedShape),
    values: migratedWeightValues(weight, expectedShape)
  };
}

function migrateGruVocabularyKernel(weight, expectedShape, migration) {
  if (!weightHasLayout(weight, [migration.oldStateDim, expectedShape?.[1]])
    || expectedShape?.[0] !== STATE_DIM) {
    throw new Error("Neural checkpoint GRU input layout cannot be migrated to the current card vocabulary.");
  }
  const rowWidth = expectedShape[1];
  const output = new Float32Array(STATE_DIM * rowWidth);
  copyMatrixRows(weight.values, 0, output, 0, STATE_SCALARS, rowWidth);
  for (let zone = 0; zone < migration.cardZoneCount; zone += 1) {
    for (let oldIndex = 0; oldIndex < migration.oldCardBins; oldIndex += 1) {
      copyMatrixRows(
        weight.values,
        STATE_SCALARS + zone * migration.oldCardBins + oldIndex,
        output,
        STATE_SCALARS + zone * CARD_BINS + migration.currentIndexes[oldIndex],
        1,
        rowWidth
      );
    }
  }
  copyMatrixRows(
    weight.values,
    STATE_SCALARS + migration.cardZoneCount * migration.oldCardBins,
    output,
    STATE_SCALARS + migration.cardZoneCount * CARD_BINS,
    migration.tailRows,
    rowWidth
  );
  return { shape: expectedShape, values: output };
}

function migrateBeliefVocabularyKernel(weight, expectedShape, migration) {
  if (!weightHasLayout(weight, [expectedShape?.[0], migration.oldCardBins])
    || expectedShape?.[1] !== CARD_BINS) {
    throw new Error("Neural checkpoint belief kernel layout cannot be migrated to the current card vocabulary.");
  }
  const output = new Float32Array(expectedShape[0] * CARD_BINS);
  for (let row = 0; row < expectedShape[0]; row += 1) {
    for (let oldIndex = 0; oldIndex < migration.oldCardBins; oldIndex += 1) {
      output[row * CARD_BINS + migration.currentIndexes[oldIndex]]
        = weight.values[row * migration.oldCardBins + oldIndex];
    }
  }
  return { shape: expectedShape, values: output };
}

function migrateBeliefVocabularyBias(weight, expectedShape, migration) {
  if (!weightHasLayout(weight, [migration.oldCardBins])
    || expectedShape?.[0] !== CARD_BINS) {
    throw new Error("Neural checkpoint belief bias layout cannot be migrated to the current card vocabulary.");
  }
  const output = new Float32Array(CARD_BINS);
  for (let oldIndex = 0; oldIndex < migration.oldCardBins; oldIndex += 1) {
    output[migration.currentIndexes[oldIndex]] = weight.values[oldIndex];
  }
  return { shape: expectedShape, values: output };
}

function copyMatrixRows(source, sourceRow, target, targetRow, rowCount, rowWidth) {
  const sourceOffset = sourceRow * rowWidth;
  const targetOffset = targetRow * rowWidth;
  const valueCount = rowCount * rowWidth;
  for (let index = 0; index < valueCount; index += 1) {
    target[targetOffset + index] = source[sourceOffset + index];
  }
}

function migratedWeightShape(weight, expectedShape) {
  if (canZeroPadInputDimension(weight.shape, expectedShape)) return expectedShape;
  return weight.shape;
}

function migratedWeightValues(weight, expectedShape) {
  if (!canZeroPadInputDimension(weight.shape, expectedShape)) return weight.values;
  const rowSize = weight.shape.slice(1).reduce((product, value) => product * value, 1) || 1;
  return [...weight.values, ...new Array((expectedShape[0] - weight.shape[0]) * rowSize).fill(0)];
}

function canZeroPadInputDimension(shape, expectedShape) {
  return Array.isArray(shape) && Array.isArray(expectedShape)
    && shape.length === expectedShape.length
    && shape.length > 1
    && shape[0] < expectedShape[0]
    && JSON.stringify(shape.slice(1)) === JSON.stringify(expectedShape.slice(1));
}

function zeroInputRow(values, shape, row) {
  const output = [...values];
  const rowSize = shape.slice(1).reduce((product, value) => product * value, 1) || 1;
  const start = row * rowSize;
  output.fill(0, start, start + rowSize);
  return output;
}

function makeBatchTensors(batch) {
  const actionCount = batch.actionCount ?? MAX_ACTIONS;
  const [batchSize, sequenceLength] = batch.shape;
  return {
    states: tf.tensor3d(batch.states, [batchSize, sequenceLength, STATE_DIM]),
    initialMemories: tf.tensor2d(batch.initialMemories, [batchSize, NEURAL_HIDDEN_SIZE]),
    actions: tf.tensor4d(batch.actions, [batchSize, sequenceLength, actionCount, ACTION_DIM]),
    selectedIndices: tf.tensor2d(batch.selectedIndices, [batchSize, sequenceLength], "int32"),
    legalCounts: tf.tensor2d(batch.legalCounts, [batchSize, sequenceLength], "int32"),
    oldLogProbabilities: tf.tensor2d(batch.oldLogProbabilities, [batchSize, sequenceLength]),
    behaviorTemperatures: tf.tensor2d(batch.behaviorTemperatures, [batchSize, sequenceLength]),
    advantages: tf.tensor2d(batch.advantages, [batchSize, sequenceLength]),
    returns: tf.tensor2d(batch.returns, [batchSize, sequenceLength]),
    outcomeTargets: tf.tensor2d(batch.outcomeTargets, [batchSize, sequenceLength]),
    stepMask: tf.tensor2d(batch.stepMask, [batchSize, sequenceLength]),
    policyStepWeights: tf.tensor2d(
      batch.policyStepWeights || batch.stepMask,
      [batchSize, sequenceLength]
    ),
    teacherIndices: tf.tensor2d(batch.teacherIndices, [batchSize, sequenceLength], "int32"),
    teacherWeights: tf.tensor2d(batch.teacherWeights, [batchSize, sequenceLength]),
    teacherMargins: tf.tensor2d(batch.teacherMargins, [batchSize, sequenceLength]),
    teacherTargets: tf.tensor3d(batch.teacherTargets, [batchSize, sequenceLength, actionCount]),
    teacherSupports: tf.tensor3d(
      batch.teacherSupports || batch.teacherTargets,
      [batchSize, sequenceLength, actionCount]
    ),
    teacherActionValueTargets: tf.tensor3d(batch.teacherActionValueTargets, [batchSize, sequenceLength, actionCount]),
    teacherActionValueWeights: tf.tensor3d(batch.teacherActionValueWeights, [batchSize, sequenceLength, actionCount]),
    diagnosticTargets: tf.tensor3d(batch.diagnosticTargets, [batchSize, sequenceLength, 2]),
    diagnosticWeights: tf.tensor3d(batch.diagnosticWeights, [batchSize, sequenceLength, 2]),
    beliefTargets: tf.tensor3d(batch.beliefTargets, [batchSize, sequenceLength, CARD_BINS])
  };
}

function legalActionMask(legalCounts, actionCount) {
  return tf.less(
    tf.reshape(tf.range(0, actionCount, 1, "int32"), [1, 1, actionCount]),
    tf.expandDims(legalCounts, -1)
  ).toFloat();
}

function actionOneHot(indices, actionCount) {
  // tfjs oneHot requires depth >= 2; forced decisions still have one action.
  return actionCount === 1 ? tf.ones([...indices.shape, 1]) : tf.oneHot(indices, actionCount);
}

function weightedBeliefCrossEntropyLoss(prediction, target, stepMask, denominator) {
  const clipped = tf.clipByValue(prediction, 1e-6, 1 - 1e-6);
  const expandedStepMask = tf.expandDims(stepMask, -1);
  const positives = tf.sum(tf.mul(target, expandedStepMask), [0, 1]);
  const observations = tf.maximum(1, tf.sum(stepMask));
  const negatives = tf.maximum(0, tf.sub(observations, positives));
  const positiveWeights = tf.clipByValue(tf.div(negatives, tf.maximum(1, positives)), 1, 20);
  const crossEntropy = tf.neg(tf.mean(tf.add(
    tf.mul(tf.mul(target, positiveWeights), tf.log(clipped)),
    tf.mul(tf.sub(1, target), tf.log(tf.sub(1, clipped)))
  ), -1));
  return tf.div(tf.sum(tf.mul(crossEntropy, stepMask)), denominator);
}

function beliefEvaluationMetrics(prediction, target, stepMask, topK = 40) {
  const [batchSize, sequenceLength, bins] = prediction.shape;
  const predicted = prediction.dataSync();
  const expected = target.dataSync();
  const mask = stepMask.dataSync();
  let positives = 0;
  let topKHits = 0;
  let topKPredictions = 0;
  const thresholds = Array.from({ length: 11 }, (_, index) => ({
    threshold: index / 10,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0
  }));
  for (let step = 0; step < batchSize * sequenceLength; step += 1) {
    if (!mask[step]) continue;
    const offset = step * bins;
    const indexes = Array.from({ length: bins }, (_, index) => index)
      .sort((left, right) => predicted[offset + right] - predicted[offset + left])
      .slice(0, Math.min(topK, bins));
    for (let index = 0; index < bins; index += 1) {
      if (expected[offset + index] > 0.5) positives += 1;
    }
    topKHits += indexes.filter((index) => expected[offset + index] > 0.5).length;
    topKPredictions += indexes.length;
    for (const item of thresholds) {
      for (let index = 0; index < bins; index += 1) {
        const positive = expected[offset + index] > 0.5;
        const selected = predicted[offset + index] >= item.threshold;
        if (selected && positive) item.truePositive += 1;
        else if (selected) item.falsePositive += 1;
        else if (positive) item.falseNegative += 1;
      }
    }
  }
  return { positives, topKHits, topKPredictions, thresholds };
}

export function evaluatePpoBatchPolicyRatios(model, batch) {
  const tensors = makeBatchTensors(batch);
  const actionCount = tensors.actions.shape[2];
  const ratios = tf.tidy(() => {
    const output = forwardNeuralPolicy(model, tensors.states, tensors.actions, tensors.initialMemories);
    const legalMask = legalActionMask(tensors.legalCounts, actionCount);
    const temperature = tf.maximum(0.05, tf.expandDims(tensors.behaviorTemperatures, -1));
    const maskedLogits = tf.add(tf.div(output.logits, temperature), tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = actionOneHot(tensors.selectedIndices, actionCount);
    const selected = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
    return Array.from(tf.exp(tf.sub(selected, tensors.oldLogProbabilities)).dataSync());
  });
  const mask = Array.from(tensors.stepMask.dataSync());
  Object.values(tensors).forEach((tensor) => tensor.dispose());
  return ratios.filter((_, index) => mask[index]);
}

function readLossComponents(loss, components, batch) {
  const result = {
    steps: batch.stepMask.reduce((sum, value) => sum + value, 0),
    loss: loss.dataSync()[0],
    policyLoss: components.policyLoss.dataSync()[0],
    valueLoss: components.valueLoss.dataSync()[0],
    beliefLoss: components.beliefLoss.dataSync()[0],
    entropy: components.entropy.dataSync()[0]
  };
  loss.dispose();
  Object.values(components).forEach((tensor) => tensor.dispose());
  return result;
}

function trainableVariables(model) {
  return Object.values(model.layers).flatMap((layer) => layer.trainableWeights.map((weight) => weight.val));
}

function warmup(model) {
  tf.tidy(() => {
    forwardNeural(
      model,
      tf.zeros([1, 1, STATE_DIM]),
      tf.zeros([1, 1, 1, ACTION_DIM])
    );
  });
}

function softmax(values, temperature) {
  const maximum = Math.max(...values);
  const exponents = values.map((value) => Math.exp((value - maximum) / temperature));
  const total = exponents.reduce((sum, value) => sum + value, 0) || 1;
  return exponents.map((value) => value / total);
}

function argmax(values) { return values.reduce((best, value, index) => value > values[best] ? index : best, 0); }
function sample(probabilities, random) { let roll = random(); for (let index = 0; index < probabilities.length; index += 1) { roll -= probabilities[index]; if (roll <= 0) return index; } return probabilities.length - 1; }
