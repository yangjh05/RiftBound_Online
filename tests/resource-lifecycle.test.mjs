import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createNeuralModel,
  deserializeNeuralModel,
  disposeNeuralModel,
  serializeNeuralModel
} from "../src/ai/neural/model.mjs";
import {
  ACTION_DIM,
  ACTION_TARGET_CONTEXT_DIM,
  CARD_BINS,
  CARD_INDEX,
  CARD_VOCABULARY,
  STATE_DIM,
  STATE_SCALARS,
  STRUCTURED_STATE_LAYOUT
} from "../src/ai/neural/encoding.mjs";
import { cards } from "../src/cards.mjs";
import { tf } from "../src/ai/neural/tf-runtime.mjs";
import { persistableAiReplay } from "../src/ai/replay.mjs";

test('target context migration preserves every trained weight and zero-initializes only appended inputs',()=>{
  const original=createNeuralModel();
  let loaded;
  try {
    const checkpoint=serializeNeuralModel(original);
    checkpoint.architecture.actionDim=464; // Before target and payment-option inputs.
    for(const name of ['actionProjection','actionBias']){
      const kernel=checkpoint.weights[name][0];
      const width=kernel.shape.slice(1).reduce((a,b)=>a*b,1);
      kernel.shape[0]=checkpoint.architecture.actionDim;
      kernel.values=kernel.values.slice(0,kernel.shape[0]*width);
    }
    loaded=deserializeNeuralModel(checkpoint);
    const migrated=serializeNeuralModel(loaded);
    for(const [name,weights]of Object.entries(checkpoint.weights))for(const [index,weight]of weights.entries()){
      const result=migrated.weights[name][index];
      assert.deepEqual(result.values.slice(0,weight.values.length),weight.values,`${name} preserved`);
      assert.ok(result.values.slice(weight.values.length).every(v=>v===0),`${name} new rows zero`);
    }
    assert.equal(loaded.checkpointInputMigrated,true);
    assert.equal(migrated.metadata.encodingMigration.requiresRevalidation,true);
  } finally {disposeNeuralModel(original);if(loaded)disposeNeuralModel(loaded);}
});

function orderPreservingVocabularySubset() {
  const indexes = [
    0,
    2,
    Math.floor(CARD_BINS / 4),
    Math.floor(CARD_BINS / 2),
    Math.floor(CARD_BINS * 3 / 4),
    CARD_BINS - 1
  ];
  return [...new Set(indexes)].sort((left, right) => left - right)
    .map((index) => CARD_VOCABULARY[index]);
}

function projectCheckpointToVocabulary(checkpoint, vocabulary) {
  const cardZoneCount = STRUCTURED_STATE_LAYOUT.cardZones.count;
  const tailRows = STATE_DIM - STATE_SCALARS - cardZoneCount * CARD_BINS;
  const oldStateDim = STATE_SCALARS + cardZoneCount * vocabulary.length + tailRows;
  const currentIndexes = vocabulary.map((cardNumber) => CARD_VOCABULARY.indexOf(cardNumber));
  const currentGruKernel = checkpoint.weights.gru[0];
  const rowWidth = currentGruKernel.shape[1];
  const oldGruValues = new Array(oldStateDim * rowWidth).fill(0);
  copyMatrixRows(currentGruKernel.values, 0, oldGruValues, 0, STATE_SCALARS, rowWidth);
  for (let zone = 0; zone < cardZoneCount; zone += 1) {
    for (let oldIndex = 0; oldIndex < vocabulary.length; oldIndex += 1) {
      copyMatrixRows(
        currentGruKernel.values,
        STATE_SCALARS + zone * CARD_BINS + currentIndexes[oldIndex],
        oldGruValues,
        STATE_SCALARS + zone * vocabulary.length + oldIndex,
        1,
        rowWidth
      );
    }
  }
  copyMatrixRows(
    currentGruKernel.values,
    STATE_SCALARS + cardZoneCount * CARD_BINS,
    oldGruValues,
    STATE_SCALARS + cardZoneCount * vocabulary.length,
    tailRows,
    rowWidth
  );

  const currentBeliefKernel = checkpoint.weights.belief[0];
  const beliefRows = currentBeliefKernel.shape[0];
  const oldBeliefKernel = new Array(beliefRows * vocabulary.length).fill(0);
  for (let row = 0; row < beliefRows; row += 1) {
    for (let oldIndex = 0; oldIndex < vocabulary.length; oldIndex += 1) {
      oldBeliefKernel[row * vocabulary.length + oldIndex]
        = currentBeliefKernel.values[row * CARD_BINS + currentIndexes[oldIndex]];
    }
  }
  const oldBeliefBias = currentIndexes.map((index) => checkpoint.weights.belief[1].values[index]);

  return {
    ...checkpoint,
    architecture: {
      ...checkpoint.architecture,
      stateDim: oldStateDim,
      cardVocabulary: [...vocabulary],
      cardVocabularySize: vocabulary.length
    },
    weights: {
      ...checkpoint.weights,
      gru: [
        { shape: [oldStateDim, rowWidth], values: oldGruValues },
        ...checkpoint.weights.gru.slice(1)
      ],
      belief: [
        { shape: [beliefRows, vocabulary.length], values: oldBeliefKernel },
        { shape: [vocabulary.length], values: oldBeliefBias }
      ]
    }
  };
}

function copyMatrixRows(source, sourceRow, target, targetRow, rowCount, rowWidth) {
  for (let index = 0; index < rowCount * rowWidth; index += 1) {
    target[targetRow * rowWidth + index] = source[sourceRow * rowWidth + index];
  }
}

function equalRange(left, leftOffset, right, rightOffset, length) {
  for (let index = 0; index < length; index += 1) {
    if (left[leftOffset + index] !== right[rightOffset + index]) return false;
  }
  return true;
}

function subsetCheckpointFixture() {
  const source = createNeuralModel();
  try {
    const checkpoint = serializeNeuralModel(source);
    const vocabulary = orderPreservingVocabularySubset();
    return {
      current: checkpoint,
      subset: projectCheckpointToVocabulary(checkpoint, vocabulary),
      vocabulary
    };
  } finally {
    disposeNeuralModel(source);
  }
}

test("disposing a neural model releases all layer and attached optimizer resources once", () => {
  const model = createNeuralModel({ evaluatorArchitecture: "flat-v1-64" });
  const weights = Object.values(model.layers).flatMap((layer) => layer.getWeights());
  const optimizer = tf.train.adam(0.001);
  const optimizedVariable = weights[0];
  optimizer.minimize(() => optimizedVariable.square().sum());
  const optimizerMoments = [
    ...optimizer.accumulatedFirstMoment,
    ...optimizer.accumulatedSecondMoment
  ].map((entry) => entry.variable);
  model.optimizer = optimizer;

  const result = disposeNeuralModel(model);

  assert.equal(result.disposed, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.disposedResources, Object.keys(model.layers).length + 1);
  assert.ok(weights.every((tensor) => tensor.isDisposedInternal));
  assert.ok(optimizerMoments.every((tensor) => tensor.isDisposedInternal));

  const repeated = disposeNeuralModel(model);
  assert.deepEqual(repeated, { disposed: false, disposedResources: 0, errors: [] });
});

test("failed neural checkpoint deserialization releases temporary tensors and the partial model", () => {
  const source = createNeuralModel();
  let checkpoint;
  try {
    checkpoint = serializeNeuralModel(source);
  } finally {
    disposeNeuralModel(source);
  }

  const invalidTensorCheckpoint = structuredClone(checkpoint);
  invalidTensorCheckpoint.weights.stateProjection[1].shape = [
    invalidTensorCheckpoint.weights.stateProjection[1].shape[0] + 1
  ];

  const invalidLayerCheckpoint = structuredClone(checkpoint);
  invalidLayerCheckpoint.weights.stateProjection[0] = {
    shape: [1, 1],
    values: [0]
  };

  const invalidEvaluatorCheckpoint = structuredClone(checkpoint);
  invalidEvaluatorCheckpoint.architecture.evaluator = { id: "unsupported-evaluator" };

  for (const candidate of [
    invalidTensorCheckpoint,
    invalidLayerCheckpoint,
    invalidEvaluatorCheckpoint,
    invalidEvaluatorCheckpoint
  ]) {
    const tensorsBefore = tf.memory().numTensors;
    assert.throws(() => deserializeNeuralModel(candidate));
    assert.equal(tf.memory().numTensors, tensorsBefore);
  }
});

test("the full registered vocabulary keeps the shipped checkpoint vocabulary as its stable prefix", () => {
  const checkpoint = JSON.parse(readFileSync(
    new URL("../src/ai/checkpoints/neural-champion.json", import.meta.url),
    "utf8"
  ));
  const shippedVocabulary = checkpoint.architecture.cardVocabulary;
  const registeredCardNumbers = new Set(Object.values(cards)
    .map((card) => card.cardNumber)
    .filter(Boolean));

  assert.equal(CARD_VOCABULARY.length, registeredCardNumbers.size + 1);
  assert.deepEqual(CARD_VOCABULARY.slice(0, shippedVocabulary.length), shippedVocabulary);
  assert.ok([...registeredCardNumbers].every((cardNumber) => CARD_INDEX.has(cardNumber)));

  const tensorsBefore = tf.memory().numTensors;
  const restored = deserializeNeuralModel(checkpoint);
  disposeNeuralModel(restored);
  assert.equal(tf.memory().numTensors, tensorsBefore);
});

test("order-preserving vocabulary extensions remap every card zone, state tail, and belief output", () => {
  const { current, subset, vocabulary } = subsetCheckpointFixture();
  const tensorsBefore = tf.memory().numTensors;
  const restored = deserializeNeuralModel(subset);
  try {
    const migrated = serializeNeuralModel(restored);
    const cardZoneCount = STRUCTURED_STATE_LAYOUT.cardZones.count;
    const tailRows = STATE_DIM - STATE_SCALARS - cardZoneCount * CARD_BINS;
    const currentIndexes = vocabulary.map((cardNumber) => CARD_VOCABULARY.indexOf(cardNumber));
    const retainedIndexes = new Set(currentIndexes);
    const rowWidth = migrated.weights.gru[0].shape[1];
    const oldGru = subset.weights.gru[0].values;
    const newGru = migrated.weights.gru[0].values;

    assert.equal(migrated.architecture.stateDim, STATE_DIM);
    assert.deepEqual(migrated.architecture.cardVocabulary, CARD_VOCABULARY);
    assert.equal(equalRange(newGru, 0, oldGru, 0, STATE_SCALARS * rowWidth), true);
    for (let zone = 0; zone < cardZoneCount; zone += 1) {
      for (let oldIndex = 0; oldIndex < vocabulary.length; oldIndex += 1) {
        assert.equal(equalRange(
          newGru,
          (STATE_SCALARS + zone * CARD_BINS + currentIndexes[oldIndex]) * rowWidth,
          oldGru,
          (STATE_SCALARS + zone * vocabulary.length + oldIndex) * rowWidth,
          rowWidth
        ), true);
      }
      for (let currentIndex = 0; currentIndex < CARD_BINS; currentIndex += 1) {
        if (retainedIndexes.has(currentIndex)) continue;
        const offset = (STATE_SCALARS + zone * CARD_BINS + currentIndex) * rowWidth;
        assert.equal(newGru.slice(offset, offset + rowWidth).every((value) => value === 0), true);
      }
    }

    const oldTailOffset = (STATE_SCALARS + cardZoneCount * vocabulary.length) * rowWidth;
    const newTailOffset = (STATE_SCALARS + cardZoneCount * CARD_BINS) * rowWidth;
    assert.equal(equalRange(
      newGru,
      newTailOffset,
      oldGru,
      oldTailOffset,
      tailRows * rowWidth
    ), true);
    assert.equal(equalRange(
      newGru,
      newTailOffset,
      current.weights.gru[0].values,
      newTailOffset,
      tailRows * rowWidth
    ), true);

    const oldBeliefKernel = subset.weights.belief[0].values;
    const newBeliefKernel = migrated.weights.belief[0].values;
    const beliefRows = migrated.weights.belief[0].shape[0];
    for (let row = 0; row < beliefRows; row += 1) {
      for (let oldIndex = 0; oldIndex < vocabulary.length; oldIndex += 1) {
        assert.equal(
          newBeliefKernel[row * CARD_BINS + currentIndexes[oldIndex]],
          oldBeliefKernel[row * vocabulary.length + oldIndex]
        );
      }
      for (let currentIndex = 0; currentIndex < CARD_BINS; currentIndex += 1) {
        if (!retainedIndexes.has(currentIndex)) {
          assert.equal(newBeliefKernel[row * CARD_BINS + currentIndex], 0);
        }
      }
    }
    for (let oldIndex = 0; oldIndex < vocabulary.length; oldIndex += 1) {
      assert.equal(
        migrated.weights.belief[1].values[currentIndexes[oldIndex]],
        subset.weights.belief[1].values[oldIndex]
      );
    }
    for (let currentIndex = 0; currentIndex < CARD_BINS; currentIndex += 1) {
      if (!retainedIndexes.has(currentIndex)) {
        assert.equal(migrated.weights.belief[1].values[currentIndex], 0);
      }
    }
  } finally {
    disposeNeuralModel(restored);
  }
  assert.equal(tf.memory().numTensors, tensorsBefore);
});

test("vocabulary extension rejects missing, duplicate, reordered, and mismatched layouts without tensor leaks", () => {
  const { subset, vocabulary } = subsetCheckpointFixture();
  const missingVocabulary = [...vocabulary];
  missingVocabulary[missingVocabulary.length - 1] = "missing-card-number";
  const duplicateVocabulary = [...vocabulary];
  duplicateVocabulary[2] = duplicateVocabulary[1];
  const reorderedVocabulary = [...vocabulary];
  [reorderedVocabulary[1], reorderedVocabulary[2]] = [reorderedVocabulary[2], reorderedVocabulary[1]];
  const corruptLayer = {
    ...subset,
    weights: {
      ...subset.weights,
      stateProjection: [
        { shape: [1, 1], values: [0] },
        subset.weights.stateProjection[1]
      ]
    }
  };
  const candidates = [
    { ...subset, architecture: { ...subset.architecture, cardVocabulary: missingVocabulary } },
    { ...subset, architecture: { ...subset.architecture, cardVocabulary: duplicateVocabulary } },
    { ...subset, architecture: { ...subset.architecture, cardVocabulary: reorderedVocabulary } },
    { ...subset, architecture: { ...subset.architecture, cardVocabularySize: vocabulary.length + 1 } },
    { ...subset, architecture: { ...subset.architecture, stateDim: subset.architecture.stateDim + 1 } },
    {
      ...subset,
      weights: {
        ...subset.weights,
        belief: [
          { ...subset.weights.belief[0], shape: [subset.weights.belief[0].shape[0], vocabulary.length + 1] },
          subset.weights.belief[1]
        ]
      }
    },
    corruptLayer
  ];

  for (const candidate of candidates) {
    const tensorsBefore = tf.memory().numTensors;
    assert.throws(() => deserializeNeuralModel(candidate));
    assert.equal(tf.memory().numTensors, tensorsBefore);
  }
});

test("persistable AI replay never traverses discarded game states and preserves replay data", () => {
  let discardedStateReads = 0;
  const gameState = {};
  Object.defineProperty(gameState, "expensiveGraph", {
    enumerable: true,
    get() {
      discardedStateReads += 1;
      throw new Error("discarded game state was cloned");
    }
  });
  const replay = {
    version: 1,
    id: "replay-1",
    decisions: [{
      sequence: 1,
      actorId: "p1",
      command: { kind: "pass" },
      gameState,
      analysis: { regret: 0.25, alternatives: [{ kind: "playCard" }] }
    }],
    winnerId: "p1",
    report: { rating: "great" }
  };

  const persisted = persistableAiReplay(replay);

  assert.equal(discardedStateReads, 0);
  assert.deepEqual(persisted, {
    version: 1,
    id: "replay-1",
    decisions: [{
      sequence: 1,
      actorId: "p1",
      command: { kind: "pass" },
      analysis: { regret: 0.25, alternatives: [{ kind: "playCard" }] }
    }],
    winnerId: "p1",
    report: { rating: "great" }
  });
  assert.notEqual(persisted.decisions[0].analysis, replay.decisions[0].analysis);
  assert.notEqual(persisted.report, replay.report);
});
