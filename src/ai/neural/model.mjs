import { tf } from "./tf-runtime.mjs";
import {
  ACTION_DIM, CARD_BINS, CARD_VOCABULARY, MAX_ACTIONS, MAX_SEQUENCE, STATE_DIM,
  encodeActionSet, encodeState
} from "./encoding.mjs";

export const NEURAL_MODEL_VERSION = 3;
export const NEURAL_HIDDEN_SIZE = 64;
const EMBEDDING_SIZE = 64;

export function createNeuralModel(options = {}) {
  const layers = {
    gru: tf.layers.gru({ units: options.hiddenSize || NEURAL_HIDDEN_SIZE, returnSequences: true, returnState: true, name: "memory_gru" }),
    stateProjection: tf.layers.dense({ units: options.embeddingSize || EMBEDDING_SIZE, activation: "tanh", name: "state_projection" }),
    actionProjection: tf.layers.dense({ units: options.embeddingSize || EMBEDDING_SIZE, activation: "tanh", name: "action_projection" }),
    actionBias: tf.layers.dense({ units: 1, useBias: true, name: "action_bias" }),
    value: tf.layers.dense({ units: 1, activation: "tanh", name: "value_head" }),
    belief: tf.layers.dense({ units: CARD_BINS, activation: "sigmoid", name: "belief_head" })
  };
  const model = {
    version: NEURAL_MODEL_VERSION,
    generation: options.generation || 0,
    gamesTrained: options.gamesTrained || 0,
    layers,
    calibration: { temperature: 1, bins: [], ...(options.calibration || {}) },
    knowledge: structuredClone(options.knowledge || {}),
    metadata: { algorithm: "recurrent-ppo-belief", cardRepresentation: "relational-public-state-v3", actionRepresentation: "semantic-with-legal-set-collision-disambiguation", ...(options.metadata || {}) }
  };
  warmup(model);
  return model;
}

export function forwardNeural(model, states, actions, initialMemory = null) {
  const applied = model.layers.gru.apply(states, initialMemory ? { initialState: [initialMemory] } : undefined);
  const sequence = Array.isArray(applied) ? applied[0] : applied;
  const memoryState = Array.isArray(applied) ? applied[1] : null;
  const stateEmbedding = model.layers.stateProjection.apply(sequence);
  const actionEmbedding = model.layers.actionProjection.apply(actions);
  const actionBias = tf.squeeze(model.layers.actionBias.apply(actions), [-1]);
  const logits = tf.add(tf.sum(tf.mul(tf.expandDims(stateEmbedding, 2), actionEmbedding), -1), actionBias);
  const value = tf.squeeze(model.layers.value.apply(sequence), [-1]);
  const belief = model.layers.belief.apply(sequence);
  return { logits, value, belief, memoryState };
}

export function createNeuralSession(model, options = {}) {
  const histories = new Map();
  const memories = new Map();
  const maxHistory = options.maxHistory || MAX_SEQUENCE;
  return {
    reset(playerId = null) {
      if (playerId) { histories.delete(playerId); memories.delete(playerId); }
      else { histories.clear(); memories.clear(); }
    },
    history(playerId) { return histories.get(playerId) || []; },
    decide(game, actorId, legalActions, decideOptions = {}) {
      if (!legalActions.length) return null;
      const state = encodeState(game, actorId);
      const history = [...(histories.get(actorId) || []), state].slice(-maxHistory);
      histories.set(actorId, history);
      const actionSet = encodeActionSet(game, actorId, legalActions);
      const initialMemory = memories.get(actorId) || new Array(NEURAL_HIDDEN_SIZE).fill(0);
      const outputs = inferStep(model, state, actionSet.encoded, actionSet.legalCount, initialMemory);
      memories.set(actorId, outputs.memory);
      const temperature = Math.max(0.05, decideOptions.temperature || model.calibration?.temperature || 1);
      const probabilities = softmax(outputs.logits.slice(0, actionSet.legalCount), temperature);
      const selectedIndex = decideOptions.greedy ? argmax(probabilities) : sample(probabilities, decideOptions.random || Math.random);
      return {
        action: actionSet.actions[selectedIndex],
        selectedIndex,
        legalActions: actionSet.actions,
        actionEncoding: actionSet.encoded,
        stateEncoding: state,
        legalCount: actionSet.legalCount,
        probability: probabilities[selectedIndex],
        logProbability: Math.log(Math.max(1e-8, probabilities[selectedIndex])),
        probabilities,
        value: outputs.value,
        belief: outputs.belief,
        initialMemory
      };
    }
  };
}

export function inferStep(model, state, actions, legalCount, memory = null) {
  return tf.tidy(() => {
    const stateTensor = tf.tensor3d(state, [1, 1, STATE_DIM]);
    const actionTensor = tf.tensor4d(actions, [1, 1, MAX_ACTIONS, ACTION_DIM]);
    const memoryTensor = memory ? tf.tensor2d(memory, [1, memory.length]) : null;
    const output = forwardNeural(model, stateTensor, actionTensor, memoryTensor);
    return {
      logits: Array.from(output.logits.slice([0, 0, 0], [1, 1, legalCount]).dataSync()),
      value: output.value.dataSync()[0],
      belief: Array.from(output.belief.dataSync()),
      memory: Array.from(output.memoryState.dataSync())
    };
  });
}

export function estimateNeuralValue(model, game, viewerId) {
  const state = encodeState(game, viewerId);
  const actions = new Float32Array(MAX_ACTIONS * ACTION_DIM);
  return inferStep(model, state, actions, 1, new Array(NEURAL_HIDDEN_SIZE).fill(0)).value;
}

export function inferSequence(model, history, finalActions, legalCount) {
  return tf.tidy(() => {
    const length = Math.max(1, history.length);
    const stateData = new Float32Array(length * STATE_DIM);
    history.forEach((state, index) => stateData.set(state, index * STATE_DIM));
    const actionData = new Float32Array(length * MAX_ACTIONS * ACTION_DIM);
    actionData.set(finalActions, (length - 1) * MAX_ACTIONS * ACTION_DIM);
    const states = tf.tensor3d(stateData, [1, length, STATE_DIM]);
    const actions = tf.tensor4d(actionData, [1, length, MAX_ACTIONS, ACTION_DIM]);
    const output = forwardNeural(model, states, actions);
    const logits = Array.from(output.logits.slice([0, length - 1, 0], [1, 1, legalCount]).dataSync());
    const value = output.value.slice([0, length - 1], [1, 1]).dataSync()[0];
    const belief = Array.from(output.belief.slice([0, length - 1, 0], [1, 1, CARD_BINS]).dataSync());
    return { logits, value, belief };
  });
}

export function trainPpoBatch(model, batch, optimizer, options = {}) {
  const clipRatio = options.clipRatio || 0.2;
  const valueCoefficient = options.valueCoefficient || 0.5;
  const beliefCoefficient = options.beliefCoefficient || 0.15;
  const entropyCoefficient = options.entropyCoefficient ?? 0.01;
  const variableList = trainableVariables(model);
  const tensors = makeBatchTensors(batch);
  let components = null;
  const loss = optimizer.minimize(() => {
    const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories);
    const legalMask = tf.less(
      tf.reshape(tf.range(0, MAX_ACTIONS, 1, "int32"), [1, 1, MAX_ACTIONS]),
      tf.expandDims(tensors.legalCounts, -1)
    ).toFloat();
    const maskedLogits = tf.add(output.logits, tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = tf.oneHot(tensors.selectedIndices, MAX_ACTIONS);
    const newLogProbabilities = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
    const ratio = tf.exp(tf.sub(newLogProbabilities, tensors.oldLogProbabilities));
    const clippedRatio = tf.clipByValue(ratio, 1 - clipRatio, 1 + clipRatio);
    const surrogate = tf.minimum(tf.mul(ratio, tensors.advantages), tf.mul(clippedRatio, tensors.advantages));
    const denominator = tf.maximum(1, tf.sum(tensors.stepMask));
    const policyLoss = tf.neg(tf.div(tf.sum(tf.mul(surrogate, tensors.stepMask)), denominator));
    const valueError = tf.square(tf.sub(output.value, tensors.returns));
    const valueLoss = tf.div(tf.sum(tf.mul(valueError, tensors.stepMask)), denominator);
    const clippedBelief = tf.clipByValue(output.belief, 1e-6, 1 - 1e-6);
    const beliefCrossEntropy = tf.neg(tf.mean(tf.add(
      tf.mul(tensors.beliefTargets, tf.log(clippedBelief)),
      tf.mul(tf.sub(1, tensors.beliefTargets), tf.log(tf.sub(1, clippedBelief)))
    ), -1));
    const beliefLoss = tf.div(tf.sum(tf.mul(beliefCrossEntropy, tensors.stepMask)), denominator);
    const entropy = tf.neg(tf.div(tf.sum(tf.mul(tf.sum(tf.mul(tf.exp(logProbabilities), logProbabilities), -1), tensors.stepMask)), denominator));
    components = {
      policyLoss: tf.keep(policyLoss),
      valueLoss: tf.keep(valueLoss),
      beliefLoss: tf.keep(beliefLoss),
      entropy: tf.keep(entropy)
    };
    return tf.addN([
      policyLoss,
      tf.mul(valueLoss, valueCoefficient),
      tf.mul(beliefLoss, beliefCoefficient),
      tf.mul(entropy, -entropyCoefficient)
    ]);
  }, true, variableList);
  const result = {
    loss: loss.dataSync()[0],
    policyLoss: components.policyLoss.dataSync()[0],
    valueLoss: components.valueLoss.dataSync()[0],
    beliefLoss: components.beliefLoss.dataSync()[0],
    entropy: components.entropy.dataSync()[0]
  };
  loss.dispose();
  Object.values(components).forEach((tensor) => tensor.dispose());
  Object.values(tensors).forEach((tensor) => tensor.dispose());
  return result;
}

export function trainBehaviorCloningBatch(model, batch, optimizer, options = {}) {
  const valueCoefficient = options.valueCoefficient ?? 0.35;
  const beliefCoefficient = options.beliefCoefficient ?? 0.1;
  const entropyCoefficient = options.entropyCoefficient ?? 0.002;
  const variableList = trainableVariables(model);
  const tensors = makeBatchTensors(batch);
  let components = null;
  const loss = optimizer.minimize(() => {
    const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories);
    const legalMask = legalActionMask(tensors.legalCounts);
    const maskedLogits = tf.add(output.logits, tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = tf.oneHot(tensors.selectedIndices, MAX_ACTIONS);
    const selectedLogProbabilities = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
    const weights = tf.mul(tensors.stepMask, tf.maximum(0.05, tensors.advantages));
    const denominator = tf.maximum(1, tf.sum(weights));
    const policyLoss = tf.neg(tf.div(tf.sum(tf.mul(selectedLogProbabilities, weights)), denominator));
    const stepDenominator = tf.maximum(1, tf.sum(tensors.stepMask));
    const valueLoss = tf.div(tf.sum(tf.mul(tf.square(tf.sub(output.value, tensors.returns)), tensors.stepMask)), stepDenominator);
    const beliefLoss = beliefCrossEntropyLoss(output.belief, tensors.beliefTargets, tensors.stepMask, stepDenominator);
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
  const result = tf.tidy(() => {
    const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories);
    const legalMask = legalActionMask(tensors.legalCounts);
    const maskedLogits = tf.add(output.logits, tf.mul(tf.sub(1, legalMask), -1e9));
    const logProbabilities = tf.logSoftmax(maskedLogits, -1);
    const selectedMask = tf.oneHot(tensors.selectedIndices, MAX_ACTIONS);
    const selectedLogProbabilities = tf.sum(tf.mul(logProbabilities, selectedMask), -1);
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
      beliefLoss: beliefCrossEntropyLoss(output.belief, tensors.beliefTargets, tensors.stepMask, tf.scalar(count)).dataSync()[0],
      values: Array.from(output.value.dataSync()),
      returns: Array.from(tensors.returns.dataSync()),
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
      actionDim: ACTION_DIM,
      maxActions: MAX_ACTIONS,
      cardVocabulary: CARD_VOCABULARY,
      cardVocabularySize: CARD_BINS
    },
    weights: Object.fromEntries(Object.entries(model.layers).map(([name, layer]) => [name, layer.getWeights().map((tensor) => ({
      shape: tensor.shape,
      values: Array.from(tensor.dataSync())
    }))]))
  };
}

export function deserializeNeuralModel(checkpoint) {
  if (checkpoint?.version !== NEURAL_MODEL_VERSION) {
    throw new Error(`Neural checkpoint version ${checkpoint?.version ?? "unknown"} is incompatible with model version ${NEURAL_MODEL_VERSION}.`);
  }
  if (JSON.stringify(checkpoint.architecture?.cardVocabulary) !== JSON.stringify(CARD_VOCABULARY)) {
    throw new Error("Neural checkpoint card vocabulary does not match the registered card pool.");
  }
  const model = createNeuralModel(checkpoint);
  for (const [name, weights] of Object.entries(checkpoint.weights || {})) {
    if (!model.layers[name]) continue;
    const tensors = weights.map((weight) => tf.tensor(weight.values, weight.shape));
    model.layers[name].setWeights(tensors);
    tensors.forEach((tensor) => tensor.dispose());
  }
  return model;
}

function makeBatchTensors(batch) {
  const [batchSize, sequenceLength] = batch.shape;
  return {
    states: tf.tensor3d(batch.states, [batchSize, sequenceLength, STATE_DIM]),
    initialMemories: tf.tensor2d(batch.initialMemories, [batchSize, NEURAL_HIDDEN_SIZE]),
    actions: tf.tensor4d(batch.actions, [batchSize, sequenceLength, MAX_ACTIONS, ACTION_DIM]),
    selectedIndices: tf.tensor2d(batch.selectedIndices, [batchSize, sequenceLength], "int32"),
    legalCounts: tf.tensor2d(batch.legalCounts, [batchSize, sequenceLength], "int32"),
    oldLogProbabilities: tf.tensor2d(batch.oldLogProbabilities, [batchSize, sequenceLength]),
    advantages: tf.tensor2d(batch.advantages, [batchSize, sequenceLength]),
    returns: tf.tensor2d(batch.returns, [batchSize, sequenceLength]),
    stepMask: tf.tensor2d(batch.stepMask, [batchSize, sequenceLength]),
    beliefTargets: tf.tensor3d(batch.beliefTargets, [batchSize, sequenceLength, CARD_BINS])
  };
}

function legalActionMask(legalCounts) {
  return tf.less(
    tf.reshape(tf.range(0, MAX_ACTIONS, 1, "int32"), [1, 1, MAX_ACTIONS]),
    tf.expandDims(legalCounts, -1)
  ).toFloat();
}

function beliefCrossEntropyLoss(prediction, target, stepMask, denominator) {
  const clipped = tf.clipByValue(prediction, 1e-6, 1 - 1e-6);
  const crossEntropy = tf.neg(tf.mean(tf.add(
    tf.mul(target, tf.log(clipped)),
    tf.mul(tf.sub(1, target), tf.log(tf.sub(1, clipped)))
  ), -1));
  return tf.div(tf.sum(tf.mul(crossEntropy, stepMask)), denominator);
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
  tf.tidy(() => forwardNeural(
    model,
    tf.zeros([1, 1, STATE_DIM]),
    tf.zeros([1, 1, MAX_ACTIONS, ACTION_DIM])
  ));
}

function softmax(values, temperature) {
  const maximum = Math.max(...values);
  const exponents = values.map((value) => Math.exp((value - maximum) / temperature));
  const total = exponents.reduce((sum, value) => sum + value, 0) || 1;
  return exponents.map((value) => value / total);
}

function argmax(values) { return values.reduce((best, value, index) => value > values[best] ? index : best, 0); }
function sample(probabilities, random) { let roll = random(); for (let index = 0; index < probabilities.length; index += 1) { roll -= probabilities[index]; if (roll <= 0) return index; } return probabilities.length - 1; }
