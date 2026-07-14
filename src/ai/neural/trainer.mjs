import { tf } from "./tf-runtime.mjs";
import { ACTION_DIM, CARD_BINS, MAX_ACTIONS, MAX_SEQUENCE, STATE_DIM } from "./encoding.mjs";
import { NEURAL_HIDDEN_SIZE, evaluateBehaviorCloningBatch, trainBehaviorCloningBatch, trainPpoBatch } from "./model.mjs";

export function trainRecurrentPpo(model, trajectories, options = {}) {
  const epochs = Math.max(1, options.epochs || 4);
  const learningRate = options.learningRate || 0.0003;
  const optimizer = options.optimizer || tf.train.adam(learningRate);
  const chunks = chunkTrajectories(trajectories, options.sequenceLength || MAX_SEQUENCE);
  const history = [];
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    shuffle(chunks, options.random || Math.random);
    const batchSize = Math.max(1, options.batchSize || 4);
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = packPpoBatch(chunks.slice(start, start + batchSize));
      history.push({ epoch: epoch + 1, ...trainPpoBatch(model, batch, optimizer, options) });
    }
  }
  model.generation += 1;
  model.gamesTrained += new Set(trajectories.map((trajectory) => trajectory.gameId).filter(Boolean)).size || Math.ceil(trajectories.length / 2);
  model.calibration = calibrateValueHead(trajectories);
  model.metadata = {
    ...model.metadata,
    algorithm: "recurrent-ppo-belief",
    trainedAt: new Date().toISOString(),
    epochs,
    trajectories: trajectories.length,
    meanLoss: mean(history.map((item) => item.loss)),
    meanEntropy: mean(history.map((item) => item.entropy))
  };
  return { model, optimizer, history, calibration: model.calibration };
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
  model.gamesTrained = new Set(trajectories.map((trajectory) => trajectory.gameId)).size;
  model.metadata = {
    ...model.metadata,
    algorithm: "recurrent-behavior-cloning-belief",
    trainedAt: new Date().toISOString(),
    epochs,
    trajectories: trajectories.length,
    ...aggregateMetrics(history)
  };
  return { model, optimizer, history };
}

export function evaluateBehaviorCloning(model, trajectories, options = {}) {
  const chunks = chunkTrajectories(trajectories, options.sequenceLength || MAX_SEQUENCE);
  const batchSize = Math.max(1, options.batchSize || 8);
  const batches = [];
  const valueSamples = [];
  for (let start = 0; start < chunks.length; start += batchSize) {
    const result = evaluateBehaviorCloningBatch(model, packPpoBatch(chunks.slice(start, start + batchSize)));
    batches.push(result);
    result.mask.forEach((mask, index) => { if (mask) valueSamples.push({ value: result.values[index], outcome: result.returns[index] > 0 ? 1 : 0 }); });
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
    calibration: calibrateValueSamples(valueSamples)
  };
}

export async function serializeOptimizer(optimizer, modelGeneration) {
  const weights = await optimizer.getWeights();
  const serialized = weights.map((item) => ({ name: item.name, shape: item.tensor.shape, values: Array.from(item.tensor.dataSync()) }));
  weights.forEach((item) => item.tensor.dispose());
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

export function packPpoBatch(chunks) {
  const batchSize = chunks.length;
  const sequenceLength = Math.max(1, ...chunks.map((chunk) => chunk.steps.length));
  const states = new Float32Array(batchSize * sequenceLength * STATE_DIM);
  const initialMemories = new Float32Array(batchSize * NEURAL_HIDDEN_SIZE);
  const actions = new Float32Array(batchSize * sequenceLength * MAX_ACTIONS * ACTION_DIM);
  const selectedIndices = new Int32Array(batchSize * sequenceLength);
  const legalCounts = new Int32Array(batchSize * sequenceLength);
  const oldLogProbabilities = new Float32Array(batchSize * sequenceLength);
  const advantages = new Float32Array(batchSize * sequenceLength);
  const returns = new Float32Array(batchSize * sequenceLength);
  const stepMask = new Float32Array(batchSize * sequenceLength);
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
      actions.set(step.actions, flat * MAX_ACTIONS * ACTION_DIM);
      selectedIndices[flat] = step.selectedIndex;
      legalCounts[flat] = Math.max(1, step.legalCount);
      oldLogProbabilities[flat] = step.oldLogProbability;
      advantages[flat] = imitationBatch ? step.advantage : (step.advantage - advantageMean) / advantageDeviation;
      returns[flat] = step.return;
      stepMask[flat] = 1;
      beliefTargets.set(step.beliefTarget, flat * CARD_BINS);
    });
  });
  return {
    shape: [batchSize, sequenceLength], states, initialMemories, actions, selectedIndices, legalCounts,
    oldLogProbabilities, advantages, returns, stepMask, beliefTargets
  };
}

export function calibrateValueHead(trajectories) {
  const samples = [];
  for (const trajectory of trajectories) {
    if (!trajectory.steps.length) continue;
    const outcome = trajectory.steps.at(-1).return > 0 ? 1 : 0;
    for (const step of trajectory.steps) samples.push({ value: clamp(step.value, -0.999, 0.999), outcome });
  }
  if (samples.length < 10) return { temperature: 1, brier: null, expectedCalibrationError: null, bins: [], samples: samples.length };
  let best = { temperature: 1, loss: Infinity };
  for (let temperature = 0.35; temperature <= 3; temperature += 0.05) {
    const loss = mean(samples.map((sample) => {
      const probability = calibratedProbability(sample.value, temperature);
      return -(sample.outcome * Math.log(probability) + (1 - sample.outcome) * Math.log(1 - probability));
    }));
    if (loss < best.loss) best = { temperature, loss };
  }
  const bins = Array.from({ length: 10 }, (_, index) => ({ low: index / 10, high: (index + 1) / 10, count: 0, probabilitySum: 0, outcomeSum: 0 }));
  let brier = 0;
  for (const sample of samples) {
    const probability = calibratedProbability(sample.value, best.temperature);
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.count += 1;
    bin.probabilitySum += probability;
    bin.outcomeSum += sample.outcome;
    brier += (probability - sample.outcome) ** 2;
  }
  const publishedBins = bins.filter((bin) => bin.count).map((bin) => ({
    low: bin.low,
    high: bin.high,
    count: bin.count,
    predicted: bin.probabilitySum / bin.count,
    observed: bin.outcomeSum / bin.count
  }));
  const expectedCalibrationError = publishedBins.reduce((sum, bin) => sum + bin.count / samples.length * Math.abs(bin.predicted - bin.observed), 0);
  return { temperature: best.temperature, brier: brier / samples.length, expectedCalibrationError, bins: publishedBins, samples: samples.length };
}

export function calibrateValueSamples(samples) {
  if (samples.length < 10) return { temperature: 1, brier: null, expectedCalibrationError: null, bins: [], samples: samples.length };
  let best = { temperature: 1, loss: Infinity };
  for (let temperature = 0.35; temperature <= 3; temperature += 0.05) {
    const loss = mean(samples.map((sample) => {
      const probability = calibratedProbability(clamp(sample.value, -0.999, 0.999), temperature);
      return -(sample.outcome * Math.log(probability) + (1 - sample.outcome) * Math.log(1 - probability));
    }));
    if (loss < best.loss) best = { temperature, loss };
  }
  const bins = Array.from({ length: 10 }, (_, index) => ({ low: index / 10, high: (index + 1) / 10, count: 0, probabilitySum: 0, outcomeSum: 0 }));
  let brier = 0;
  for (const sample of samples) {
    const probability = calibratedProbability(clamp(sample.value, -0.999, 0.999), best.temperature);
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.count += 1;
    bin.probabilitySum += probability;
    bin.outcomeSum += sample.outcome;
    brier += (probability - sample.outcome) ** 2;
  }
  const publishedBins = bins.filter((bin) => bin.count).map((bin) => ({
    low: bin.low, high: bin.high, count: bin.count,
    predicted: bin.probabilitySum / bin.count, observed: bin.outcomeSum / bin.count
  }));
  const expectedCalibrationError = publishedBins.reduce((sum, bin) => sum + bin.count / samples.length * Math.abs(bin.predicted - bin.observed), 0);
  return { temperature: best.temperature, brier: brier / samples.length, expectedCalibrationError, bins: publishedBins, samples: samples.length };
}

export function calibratedProbability(value, temperature = 1) {
  const logit = Math.log((value + 1) / (1 - value));
  return clamp(1 / (1 + Math.exp(-logit / temperature)), 1e-6, 1 - 1e-6);
}

function chunkTrajectories(trajectories, length) {
  const output = [];
  for (const trajectory of trajectories) {
    for (let start = 0; start < trajectory.steps.length; start += length) output.push({ ...trajectory, steps: trajectory.steps.slice(start, start + length) });
  }
  return output.filter((chunk) => chunk.steps.length);
}

function shuffle(items, random) { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [items[index], items[target]] = [items[target], items[index]]; } }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function weightedMean(items, key) { const weight = items.reduce((sum, item) => sum + item.steps, 0); return weight ? items.reduce((sum, item) => sum + item[key] * item.steps, 0) / weight : 0; }
function aggregateMetrics(items) {
  return {
    meanLoss: metricMean(items, "loss"),
    meanPolicyLoss: metricMean(items, "policyLoss"),
    meanValueLoss: metricMean(items, "valueLoss"),
    meanBeliefLoss: metricMean(items, "beliefLoss"),
    meanEntropy: metricMean(items, "entropy")
  };
}
function metricMean(items, key) {
  const weight = items.reduce((sum, item) => sum + (item.steps || 0), 0);
  return weight ? items.reduce((sum, item) => sum + item[key] * item.steps, 0) / weight : mean(items.map((item) => item[key]));
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
