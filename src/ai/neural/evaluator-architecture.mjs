import { tf } from "./tf-runtime.mjs";
import {
  BATTLEFIELD_FEATURES,
  CARD_BINS,
  CONTEXT_FEATURES,
  MAX_BASE_UNITS,
  MAX_BATTLEFIELDS,
  MAX_FIELD_UNITS,
  STATE_DIM,
  STATE_SCALARS,
  STRUCTURED_STATE_LAYOUT,
  STRUCTURED_STATE_TOKEN_VERSION,
  UNIT_FEATURES
} from "./encoding.mjs";
import {
  STRUCTURED_EVIDENCE_TENSOR_LAYOUT,
  stackPublicStructuredEvidence
} from "./structured-evidence.mjs";

export const EVALUATOR_ARCHITECTURE_CONTRACT = "isolated-evaluator-architecture-v3-multihead-policy-q";
export const EVALUATOR_TARGET_HEADS = Object.freeze({
  stateValue: "state-value",
  generalActionQ: "general-action-q",
  mulliganQ: "mulligan-q"
});
export const EVALUATOR_ARCHITECTURE_SPECS = Object.freeze([
  Object.freeze({ id: "flat-v1-64", family: "flat-v1", inputSchema: "legacy-v1", hiddenSize: 64 }),
  Object.freeze({ id: "flat-v1-256", family: "flat-v1", inputSchema: "legacy-v1", hiddenSize: 256 }),
  Object.freeze({ id: "structured-set-v1-128", family: "structured-set-v1", inputSchema: "legacy-v1", hiddenSize: 128 }),
  Object.freeze({ id: "structured-set-v2-128", family: "structured-set-v2", inputSchema: "structured-v2", hiddenSize: 128 }),
  Object.freeze({ id: "structured-attention-v2-128", family: "structured-attention-v2", inputSchema: "structured-v2", hiddenSize: 128 }),
  Object.freeze({ id: "structured-attention-v2-256", family: "structured-attention-v2", inputSchema: "structured-v2", hiddenSize: 256 })
]);

const EVALUATOR_LAYER_PREFIX = "evaluator";

export function normalizeEvaluatorArchitecture(value) {
  const id = typeof value === "string" ? value : value?.id;
  const spec = EVALUATOR_ARCHITECTURE_SPECS.find((item) => item.id === id);
  if (!spec) throw new Error(`Unsupported evaluator architecture: ${id || "missing"}`);
  return { ...spec, contract: EVALUATOR_ARCHITECTURE_CONTRACT };
}

export function attachEvaluatorArchitecture(model, requested, options = {}) {
  const spec = normalizeEvaluatorArchitecture(requested);
  const existing = evaluatorArchitecture(model);
  const hasAttachedLayers = Boolean(
    model.layers.evaluatorValue
    && model.layers.evaluatorActionQ
    && model.layers.evaluatorMulliganQ
    && (model.layers.evaluatorFlatGru || model.layers.evaluatorIntegration)
  );
  if (existing?.id === spec.id && hasAttachedLayers) return model;
  if (existing && existing.id !== spec.id && hasAttachedLayers) {
    throw new Error("An evaluator architecture is already attached to this model.");
  }
  const seed = positiveSeed(options.seed);
  if (spec.family === "flat-v1") attachFlatLayers(model, spec, seed);
  else if (spec.family === "structured-set-v1") {
    attachStructuredV1Layers(model, spec, seed);
  } else {
    attachStructuredV2Layers(model, spec, seed);
  }
  model.evaluatorArchitecture = spec;
  model.metadata = {
    ...model.metadata,
    evaluatorArchitecture: spec,
    structuredStateTokenVersion: STRUCTURED_STATE_TOKEN_VERSION
  };
  warmupEvaluator(model);
  if (options.warmStart !== false && spec.family === "flat-v1") {
    warmStartFlatEvaluator(model, {
      seed,
      initializationJitter: Math.max(
        0,
        Number(options.initializationJitter) || 0
      )
    });
  }
  return model;
}

export function evaluatorArchitecture(model) {
  const value = model?.evaluatorArchitecture || model?.metadata?.evaluatorArchitecture;
  return value?.id ? { ...value } : null;
}

export function evaluatorLayerNames(model) {
  const spec = evaluatorArchitecture(model);
  if (!spec) return ["gru", "value"];
  if (spec.family === "flat-v1") return [
    "evaluatorFlatGru",
    "evaluatorValue",
    "evaluatorActionQ",
    "evaluatorMulliganQ"
  ];
  const common = [
    "evaluatorGlobalProjection",
    "evaluatorCardProjection",
    "evaluatorBattlefieldProjection",
    "evaluatorEventProjection",
    "evaluatorActionProjection",
    "evaluatorIntegration",
    "evaluatorValue",
    "evaluatorActionQ",
    "evaluatorMulliganQ"
  ];
  if (spec.family === "structured-set-v1") return [
    "evaluatorGlobalProjection",
    "evaluatorCardProjection",
    "evaluatorUnitProjection",
    "evaluatorBattlefieldProjection",
    "evaluatorBattlefieldRelation",
    "evaluatorBaseRelation",
    "evaluatorIntegration",
    "evaluatorValue",
    "evaluatorActionQ",
    "evaluatorMulliganQ"
  ];
  if (spec.family === "structured-attention-v2") return [
    ...common,
    "evaluatorCardQuery",
    "evaluatorCardKey",
    "evaluatorCardValue",
    "evaluatorBattlefieldQuery",
    "evaluatorBattlefieldKey",
    "evaluatorBattlefieldValue",
    "evaluatorEventQuery",
    "evaluatorEventKey",
    "evaluatorEventValue",
    "evaluatorActionQuery"
  ];
  return common;
}

export function evaluatorTrainableVariables(model, options = {}) {
  const spec = evaluatorArchitecture(model);
  const targetHead = normalizeEvaluatorTargetHead(options.targetHead);
  const selectedHead = evaluatorHeadLayerName(targetHead);
  const names = spec
    ? evaluatorLayerNames(model).filter((name) => (
      !EVALUATOR_OUTPUT_LAYER_NAMES.has(name) || name === selectedHead
    ))
    : evaluatorLayerNames(model);
  return names
    .flatMap((name) => model.layers[name]?.trainableWeights || [])
    .map((weight) => weight.val);
}

export function forwardEvaluatorValue(model, states, options = {}) {
  const spec = evaluatorArchitecture(model);
  if (!spec) {
    const applied = model.layers.gru.apply(states);
    const sequence = Array.isArray(applied) ? applied[0] : applied;
    return tf.squeeze(model.layers.value.apply(sequence), [-1]);
  }
  const outputLayer = evaluatorOutputLayer(model, options.targetHead);
  if (spec.family === "flat-v1") {
    const applied = model.layers.evaluatorFlatGru.apply(states);
    const sequence = Array.isArray(applied) ? applied[0] : applied;
    return tf.squeeze(outputLayer.apply(sequence), [-1]);
  }
  if (spec.family === "structured-set-v1") {
    return forwardStructuredV1EvaluatorValue(model, states, outputLayer);
  }
  return forwardStructuredV2EvaluatorValue(model, states, spec, outputLayer);
}

export function evaluatorRequiresStructuredV2(model) {
  return evaluatorArchitecture(model)?.inputSchema === "structured-v2";
}

export function evaluatorPathId(model) {
  const architecture = evaluatorArchitecture(model);
  if (!architecture) return "gru-value-head-calibrated-probability-v1";
  return `${architecture.id}-calibrated-multihead-policy-q-v2`;
}

export function normalizeEvaluatorTargetHead(value) {
  if (Object.values(EVALUATOR_TARGET_HEADS).includes(value)) return value;
  return EVALUATOR_TARGET_HEADS.stateValue;
}

function evaluatorHeadLayerName(targetHead) {
  if (targetHead === EVALUATOR_TARGET_HEADS.generalActionQ) {
    return "evaluatorActionQ";
  }
  if (targetHead === EVALUATOR_TARGET_HEADS.mulliganQ) {
    return "evaluatorMulliganQ";
  }
  return "evaluatorValue";
}

function evaluatorOutputLayer(model, targetHead) {
  const name = evaluatorHeadLayerName(normalizeEvaluatorTargetHead(targetHead));
  const layer = model.layers[name];
  if (!layer) throw new Error(`Evaluator output head ${name} is unavailable.`);
  return layer;
}

const EVALUATOR_OUTPUT_LAYER_NAMES = new Set([
  "evaluatorValue",
  "evaluatorActionQ",
  "evaluatorMulliganQ"
]);

export function createStructuredV2TensorInput(values, options = {}) {
  const batch = stackPublicStructuredEvidence(values, options);
  const layout = STRUCTURED_EVIDENCE_TENSOR_LAYOUT;
  return {
    size: batch.size,
    actualStructuredV2: batch.actualStructuredV2,
    global: tf.tensor2d(batch.global, [batch.size, layout.globalWidth]),
    cards: tf.tensor3d(batch.cards, [
      batch.size,
      layout.maximumCardTokens,
      layout.cardTokenWidth
    ]),
    cardMask: tf.tensor2d(batch.cardMask, [
      batch.size,
      layout.maximumCardTokens
    ]),
    actionSourceMask: tf.tensor2d(batch.actionSourceMask, [
      batch.size,
      layout.maximumCardTokens
    ]),
    actionTargetMask: tf.tensor2d(batch.actionTargetMask, [
      batch.size,
      layout.maximumCardTokens
    ]),
    battlefields: tf.tensor3d(batch.battlefields, [
      batch.size,
      layout.maximumBattlefields,
      layout.battlefieldTokenWidth
    ]),
    battlefieldMask: tf.tensor2d(batch.battlefieldMask, [
      batch.size,
      layout.maximumBattlefields
    ]),
    turnEvents: tf.tensor3d(batch.turnEvents, [
      batch.size,
      layout.maximumTurnEvents,
      layout.turnEventTokenWidth
    ]),
    turnEventMask: tf.tensor2d(batch.turnEventMask, [
      batch.size,
      layout.maximumTurnEvents
    ]),
    action: tf.tensor2d(batch.action, [batch.size, layout.actionWidth]),
    availability: tf.tensor2d(batch.availability, [
      batch.size,
      layout.availabilityWidth
    ])
  };
}

export function disposeStructuredV2TensorInput(input) {
  for (const value of Object.values(input || {})) value?.dispose?.();
}

export function structuredStateTokens(encodedState) {
  if (!(Array.isArray(encodedState) || ArrayBuffer.isView(encodedState))
    || encodedState.length !== STATE_DIM) {
    throw new Error(`Structured state requires ${STATE_DIM} public encoded values.`);
  }
  const state = Float32Array.from(encodedState);
  const slice = (offset, length) => state.slice(offset, offset + length);
  const battlefields = [];
  for (let index = 0; index < MAX_BATTLEFIELDS; index += 1) {
    const offset = STRUCTURED_STATE_LAYOUT.battlefields.offset
      + index * STRUCTURED_STATE_LAYOUT.battlefields.width;
    battlefields.push({
      features: slice(offset, BATTLEFIELD_FEATURES),
      units: Array.from({ length: MAX_FIELD_UNITS }, (_, unit) => slice(
        offset + BATTLEFIELD_FEATURES + unit * UNIT_FEATURES,
        UNIT_FEATURES
      ))
    });
  }
  const bases = Array.from({ length: 2 }, (_, owner) => {
    const offset = STRUCTURED_STATE_LAYOUT.bases.offset
      + owner * STRUCTURED_STATE_LAYOUT.bases.width;
    return Array.from({ length: MAX_BASE_UNITS }, (_, unit) => slice(
      offset + unit * UNIT_FEATURES,
      UNIT_FEATURES
    ));
  });
  return {
    version: STRUCTURED_STATE_TOKEN_VERSION,
    source: "public-encoded-state-v1",
    scalars: slice(0, STATE_SCALARS),
    cardZones: Array.from({ length: 4 }, (_, zone) => slice(
      STRUCTURED_STATE_LAYOUT.cardZones.offset + zone * CARD_BINS,
      CARD_BINS
    )),
    battlefields,
    bases,
    context: slice(STRUCTURED_STATE_LAYOUT.context.offset, CONTEXT_FEATURES)
  };
}

function attachFlatLayers(model, spec, seed) {
  model.layers.evaluatorFlatGru = tf.layers.gru({
    units: spec.hiddenSize,
    returnSequences: true,
    returnState: true,
    kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 1 }),
    recurrentInitializer: tf.initializers.orthogonal({ seed: seed + 2 }),
    name: "evaluator_flat_gru"
  });
  model.layers.evaluatorValue = tf.layers.dense({
    units: 1,
    activation: "tanh",
    kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 3 }),
    name: "evaluator_value_head"
  });
  model.layers.evaluatorActionQ = tf.layers.dense({
    units: 1,
    activation: "tanh",
    kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 4 }),
    name: "evaluator_general_action_q_head"
  });
  model.layers.evaluatorMulliganQ = tf.layers.dense({
    units: 1,
    activation: "tanh",
    kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 5 }),
    name: "evaluator_mulligan_q_head"
  });
}

function attachStructuredV1Layers(model, spec, seed) {
  const width = Math.max(32, Math.floor(spec.hiddenSize / 2));
  const dense = (units, name, seedOffset, activation = "tanh") => tf.layers.dense({
    units,
    activation,
    kernelInitializer: tf.initializers.glorotUniform({ seed: seed + seedOffset }),
    name
  });
  model.layers.evaluatorGlobalProjection = dense(width, "evaluator_global_projection", 1);
  model.layers.evaluatorCardProjection = dense(width, "evaluator_card_projection", 2);
  model.layers.evaluatorUnitProjection = dense(width, "evaluator_unit_projection", 3);
  model.layers.evaluatorBattlefieldProjection = dense(width, "evaluator_battlefield_projection", 4);
  model.layers.evaluatorBattlefieldRelation = dense(width, "evaluator_battlefield_relation", 5);
  model.layers.evaluatorBaseRelation = dense(width, "evaluator_base_relation", 6);
  model.layers.evaluatorIntegration = dense(spec.hiddenSize, "evaluator_structured_integration", 7);
  model.layers.evaluatorValue = dense(1, "evaluator_value_head", 8, "tanh");
  model.layers.evaluatorActionQ = dense(1, "evaluator_general_action_q_head", 9, "tanh");
  model.layers.evaluatorMulliganQ = dense(1, "evaluator_mulligan_q_head", 10, "tanh");
}

function attachStructuredV2Layers(model, spec, seed) {
  const width = Math.max(32, Math.floor(spec.hiddenSize / 2));
  const dense = (units, name, seedOffset, activation = "tanh") => tf.layers.dense({
    units,
    activation,
    kernelInitializer: tf.initializers.glorotUniform({ seed: seed + seedOffset }),
    name
  });
  model.layers.evaluatorGlobalProjection = dense(width, "evaluator_v2_global_projection", 1);
  model.layers.evaluatorCardProjection = dense(width, "evaluator_v2_card_projection", 2);
  model.layers.evaluatorBattlefieldProjection = dense(width, "evaluator_v2_battlefield_projection", 3);
  model.layers.evaluatorEventProjection = dense(width, "evaluator_v2_event_projection", 4);
  model.layers.evaluatorActionProjection = dense(width, "evaluator_v2_action_projection", 5);
  if (spec.family === "structured-attention-v2") {
    model.layers.evaluatorCardQuery = dense(width, "evaluator_v2_card_query", 6, "linear");
    model.layers.evaluatorCardKey = dense(width, "evaluator_v2_card_key", 7, "linear");
    model.layers.evaluatorCardValue = dense(width, "evaluator_v2_card_value", 8, "linear");
    model.layers.evaluatorBattlefieldQuery = dense(width, "evaluator_v2_battlefield_query", 9, "linear");
    model.layers.evaluatorBattlefieldKey = dense(width, "evaluator_v2_battlefield_key", 10, "linear");
    model.layers.evaluatorBattlefieldValue = dense(width, "evaluator_v2_battlefield_value", 11, "linear");
    model.layers.evaluatorEventQuery = dense(width, "evaluator_v2_event_query", 12, "linear");
    model.layers.evaluatorEventKey = dense(width, "evaluator_v2_event_key", 13, "linear");
    model.layers.evaluatorEventValue = dense(width, "evaluator_v2_event_value", 14, "linear");
    model.layers.evaluatorActionQuery = dense(width, "evaluator_v2_action_query", 15, "linear");
  }
  model.layers.evaluatorIntegration = dense(spec.hiddenSize, "evaluator_v2_integration", 16);
  model.layers.evaluatorValue = dense(1, "evaluator_value_head", 17, "tanh");
  model.layers.evaluatorActionQ = dense(1, "evaluator_general_action_q_head", 18, "tanh");
  model.layers.evaluatorMulliganQ = dense(1, "evaluator_mulligan_q_head", 19, "tanh");
}

function forwardStructuredV1EvaluatorValue(model, states, outputLayer) {
  const shape = states.shape;
  const batch = shape[0];
  const sequence = shape[1];
  const rows = batch * sequence;
  const flat = tf.reshape(states, [rows, STATE_DIM]);
  const context = flat.slice(
    [0, STRUCTURED_STATE_LAYOUT.context.offset],
    [rows, CONTEXT_FEATURES]
  );
  const globalInput = tf.concat([
    flat.slice([0, 0], [rows, STATE_SCALARS]),
    context
  ], -1);
  const globalEmbedding = model.layers.evaluatorGlobalProjection.apply(globalInput);

  const cardZones = tf.reshape(flat.slice(
    [0, STRUCTURED_STATE_LAYOUT.cardZones.offset],
    [rows, CARD_BINS * 4]
  ), [rows, 4, CARD_BINS]);
  const zoneIdentity = tf.tile(tf.expandDims(tf.eye(4), 0), [rows, 1, 1]);
  const cardTokens = model.layers.evaluatorCardProjection.apply(
    tf.concat([cardZones, zoneIdentity], -1)
  );
  const cardSummary = poolSet(cardTokens);

  const battlefieldRelations = [];
  for (let index = 0; index < MAX_BATTLEFIELDS; index += 1) {
    const offset = STRUCTURED_STATE_LAYOUT.battlefields.offset
      + index * STRUCTURED_STATE_LAYOUT.battlefields.width;
    const battlefield = flat.slice([0, offset], [rows, BATTLEFIELD_FEATURES]);
    const units = tf.reshape(flat.slice(
      [0, offset + BATTLEFIELD_FEATURES],
      [rows, MAX_FIELD_UNITS * UNIT_FEATURES]
    ), [rows, MAX_FIELD_UNITS, UNIT_FEATURES]);
    const unitTokens = model.layers.evaluatorUnitProjection.apply(units);
    battlefieldRelations.push(model.layers.evaluatorBattlefieldRelation.apply(tf.concat([
      model.layers.evaluatorBattlefieldProjection.apply(battlefield),
      ...poolSetParts(unitTokens)
    ], -1)));
  }
  const battlefieldTokens = tf.stack(battlefieldRelations, 1);
  const battlefieldSummary = poolSet(battlefieldTokens);

  const baseRelations = [];
  for (let owner = 0; owner < 2; owner += 1) {
    const offset = STRUCTURED_STATE_LAYOUT.bases.offset
      + owner * STRUCTURED_STATE_LAYOUT.bases.width;
    const units = tf.reshape(flat.slice(
      [0, offset],
      [rows, MAX_BASE_UNITS * UNIT_FEATURES]
    ), [rows, MAX_BASE_UNITS, UNIT_FEATURES]);
    const unitTokens = model.layers.evaluatorUnitProjection.apply(units);
    const ownerToken = tf.tile(tf.tensor2d(
      owner === 0 ? [1, 0] : [0, 1],
      [1, 2]
    ), [rows, 1]);
    baseRelations.push(model.layers.evaluatorBaseRelation.apply(tf.concat([
      ...poolSetParts(unitTokens),
      ownerToken
    ], -1)));
  }
  const baseSummary = tf.concat(baseRelations, -1);
  const integrated = model.layers.evaluatorIntegration.apply(tf.concat([
    globalEmbedding,
    cardSummary,
    battlefieldSummary,
    baseSummary
  ], -1));
  return tf.reshape(
    tf.squeeze(outputLayer.apply(integrated), [-1]),
    [batch, sequence]
  );
}

function forwardStructuredV2EvaluatorValue(model, input, spec, outputLayer) {
  if (!input?.global || !input?.cards || !input?.cardMask
    || !input?.battlefields || !input?.battlefieldMask
    || !input?.turnEvents || !input?.turnEventMask
    || !input?.actionSourceMask || !input?.actionTargetMask
    || !input?.action || !input?.availability) {
    throw new Error(`${spec.id} requires a structured-v2 tensor batch.`);
  }
  const globalEmbedding = model.layers.evaluatorGlobalProjection.apply(
    tf.concat([input.global, input.availability], -1)
  );
  const cardTokens = model.layers.evaluatorCardProjection.apply(input.cards);
  const battlefieldTokens = model.layers.evaluatorBattlefieldProjection.apply(
    input.battlefields
  );
  const eventTokens = model.layers.evaluatorEventProjection.apply(
    input.turnEvents
  );
  const actionEmbedding = model.layers.evaluatorActionProjection.apply(
    input.action
  );
  let cardSummary;
  let battlefieldSummary;
  let eventSummary;
  let actionContext = actionEmbedding;
  if (spec.family === "structured-attention-v2") {
    const cardAttention = maskedSelfAttention(
      cardTokens,
      input.cardMask,
      model.layers.evaluatorCardQuery,
      model.layers.evaluatorCardKey,
      model.layers.evaluatorCardValue
    );
    cardSummary = maskedPool(cardAttention, input.cardMask);
    const battlefieldAttention = maskedSelfAttention(
      battlefieldTokens,
      input.battlefieldMask,
      model.layers.evaluatorBattlefieldQuery,
      model.layers.evaluatorBattlefieldKey,
      model.layers.evaluatorBattlefieldValue
    );
    battlefieldSummary = maskedPool(
      battlefieldAttention,
      input.battlefieldMask
    );
    const eventAttention = maskedSelfAttention(
      eventTokens,
      input.turnEventMask,
      model.layers.evaluatorEventQuery,
      model.layers.evaluatorEventKey,
      model.layers.evaluatorEventValue
    );
    eventSummary = maskedPool(eventAttention, input.turnEventMask);
    const actionQuery = tf.expandDims(
      model.layers.evaluatorActionQuery.apply(actionEmbedding),
      1
    );
    const cardKeys = model.layers.evaluatorCardKey.apply(cardTokens);
    const cardValues = model.layers.evaluatorCardValue.apply(cardTokens);
    const scale = Math.sqrt(cardKeys.shape[2]);
    let scores = tf.div(
      tf.matMul(actionQuery, cardKeys, false, true),
      scale
    );
    scores = tf.add(
      scores,
      tf.mul(tf.sub(1, tf.expandDims(input.cardMask, 1)), -1e9)
    );
    const relationMask = tf.minimum(
      1,
      tf.add(input.actionSourceMask, input.actionTargetMask)
    );
    scores = tf.add(scores, tf.mul(tf.expandDims(relationMask, 1), 2));
    actionContext = tf.squeeze(
      tf.matMul(tf.softmax(scores, -1), cardValues),
      [1]
    );
  } else {
    cardSummary = maskedPool(cardTokens, input.cardMask);
    battlefieldSummary = maskedPool(
      battlefieldTokens,
      input.battlefieldMask
    );
    eventSummary = maskedPool(eventTokens, input.turnEventMask);
  }
  const relationMask = tf.minimum(
    1,
    tf.add(input.actionSourceMask, input.actionTargetMask)
  );
  const relationContext = maskedMean(
    cardTokens,
    relationMask
  );
  const integrated = model.layers.evaluatorIntegration.apply(tf.concat([
    globalEmbedding,
    cardSummary,
    battlefieldSummary,
    eventSummary,
    actionEmbedding,
    actionContext,
    relationContext,
    input.availability
  ], -1));
  return tf.squeeze(outputLayer.apply(integrated), [-1]);
}

function maskedSelfAttention(tokens, mask, queryLayer, keyLayer, valueLayer) {
  const queries = queryLayer.apply(tokens);
  const keys = keyLayer.apply(tokens);
  const values = valueLayer.apply(tokens);
  const scale = Math.sqrt(keys.shape[2]);
  let scores = tf.div(tf.matMul(queries, keys, false, true), scale);
  scores = tf.add(
    scores,
    tf.mul(tf.sub(1, tf.expandDims(mask, 1)), -1e9)
  );
  const attended = tf.matMul(tf.softmax(scores, -1), values);
  return tf.mul(attended, tf.expandDims(mask, -1));
}

function maskedPool(tokens, mask) {
  const expanded = tf.expandDims(mask, -1);
  const rawCount = tf.sum(expanded, 1);
  const count = tf.maximum(1, rawCount);
  const meanValues = tf.div(tf.sum(tf.mul(tokens, expanded), 1), count);
  const masked = tf.add(tokens, tf.mul(tf.sub(1, expanded), -1e9));
  const maxValues = tf.mul(
    tf.max(masked, 1),
    tf.greater(rawCount, 0).toFloat()
  );
  return tf.concat([meanValues, maxValues], -1);
}

function maskedMean(tokens, mask) {
  const expanded = tf.expandDims(mask, -1);
  const count = tf.maximum(1, tf.sum(expanded, 1));
  return tf.div(tf.sum(tf.mul(tokens, expanded), 1), count);
}

function poolSet(tokens) {
  return tf.concat(poolSetParts(tokens), -1);
}

function poolSetParts(tokens) {
  return [tf.mean(tokens, 1), tf.max(tokens, 1)];
}

function warmupEvaluator(model) {
  tf.tidy(() => {
    const spec = evaluatorArchitecture(model);
    if (spec?.inputSchema === "structured-v2") {
      const layout = STRUCTURED_EVIDENCE_TENSOR_LAYOUT;
      const input = {
        global: tf.zeros([1, layout.globalWidth]),
        cards: tf.zeros([1, layout.maximumCardTokens, layout.cardTokenWidth]),
        cardMask: tf.ones([1, layout.maximumCardTokens]),
        actionSourceMask: tf.zeros([1, layout.maximumCardTokens]),
        actionTargetMask: tf.zeros([1, layout.maximumCardTokens]),
        battlefields: tf.zeros([1, layout.maximumBattlefields, layout.battlefieldTokenWidth]),
        battlefieldMask: tf.ones([1, layout.maximumBattlefields]),
        turnEvents: tf.zeros([
          1,
          layout.maximumTurnEvents,
          layout.turnEventTokenWidth
        ]),
        turnEventMask: tf.zeros([1, layout.maximumTurnEvents]),
        action: tf.zeros([1, layout.actionWidth]),
        availability: tf.zeros([1, layout.availabilityWidth])
      };
      for (const targetHead of Object.values(EVALUATOR_TARGET_HEADS)) {
        forwardEvaluatorValue(model, input, { targetHead }).dataSync();
      }
      return;
    }
    const input = tf.zeros([1, 1, STATE_DIM]);
    for (const targetHead of Object.values(EVALUATOR_TARGET_HEADS)) {
      forwardEvaluatorValue(model, input, { targetHead }).dataSync();
    }
  });
}

function warmStartFlatEvaluator(model, options = {}) {
  const jitter = seededJitter(options.seed);
  const jitterScale = Number(options.initializationJitter) || 0;
  const sourceWeights = model.layers.gru.getWeights();
  const targetWeights = model.layers.evaluatorFlatGru.getWeights();
  const sourceSize = sourceWeights[1]?.shape?.[0] || 0;
  const targetSize = targetWeights[1]?.shape?.[0] || 0;
  if (!sourceSize || !targetSize) return;
  const mapped = targetWeights.map((target, index) => {
    const source = sourceWeights[index];
    const values = Float32Array.from(target.dataSync());
    copyGruGateBlocks(source, values, target.shape, sourceSize, targetSize);
    applyInitializationJitter(values, jitter, jitterScale);
    return tf.tensor(values, target.shape);
  });
  model.layers.evaluatorFlatGru.setWeights(mapped);
  mapped.forEach((tensor) => tensor.dispose());

  const sourceValue = model.layers.value.getWeights();
  const targetValue = model.layers.evaluatorValue.getWeights();
  const copied = targetValue.map((target, index) => {
    const values = Float32Array.from(target.dataSync());
    const source = sourceValue[index];
    const sourceValues = source?.dataSync?.() || [];
    values.set(sourceValues.slice(0, Math.min(values.length, sourceValues.length)));
    if (index === 0) applyInitializationJitter(values, jitter, jitterScale);
    return tf.tensor(values, target.shape);
  });
  model.layers.evaluatorValue.setWeights(copied);
  copied.forEach((tensor) => tensor.dispose());
}

function seededJitter(seed) {
  let state = positiveSeed(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function applyInitializationJitter(values, random, scale) {
  if (!(scale > 0)) return;
  for (let index = 0; index < values.length; index += 1) {
    values[index] += (random() * 2 - 1) * scale;
  }
}

function copyGruGateBlocks(sourceTensor, targetValues, targetShape, sourceSize, targetSize) {
  const sourceValues = sourceTensor.dataSync();
  if (targetShape.length === 2 && targetShape[1] === targetSize * 3) {
    const sourceRows = sourceTensor.shape[0];
    const targetRows = targetShape[0];
    for (let row = 0; row < Math.min(sourceRows, targetRows); row += 1) {
      for (let gate = 0; gate < 3; gate += 1) {
        for (let column = 0; column < Math.min(sourceSize, targetSize); column += 1) {
          targetValues[row * targetShape[1] + gate * targetSize + column]
            = sourceValues[row * sourceTensor.shape[1] + gate * sourceSize + column];
        }
      }
    }
    return;
  }
  if (targetShape.length === 1 && targetShape[0] === targetSize * 3) {
    for (let gate = 0; gate < 3; gate += 1) {
      for (let column = 0; column < Math.min(sourceSize, targetSize); column += 1) {
        targetValues[gate * targetSize + column]
          = sourceValues[gate * sourceSize + column];
      }
    }
    return;
  }
  if (targetShape.length === 2 && targetShape[1] === targetSize * 3
    && sourceTensor.shape[0] === 2) return;
  targetValues.set(sourceValues.slice(0, Math.min(targetValues.length, sourceValues.length)));
}

function positiveSeed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return (Math.abs(Math.floor(numeric)) % 2147483646) + 1;
  }
  let hash = 2166136261;
  for (const character of String(value ?? "1")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 2147483646) + 1;
}
