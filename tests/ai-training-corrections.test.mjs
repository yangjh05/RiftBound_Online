import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cards, decklists } from "../src/cards.mjs";
import { createGame, currentMight, canStandardMoveUnits } from "../src/engine.mjs";
import { observeGame } from "../src/ai/observation.mjs";
import { deckInventoryCards } from "../src/ai/deck-inventory.mjs";
import { inferOpponentDeckBelief } from "../src/ai/belief.mjs";
import { opponentResponseProfile } from "../src/ai/resource-strategy.mjs";
import { enumerateAiPolicyActions, actionKey } from "../src/ai/actions.mjs";
import { determinizeGame, determinizationStatus, rolloutAlternatives } from "../src/ai/rollout.mjs";
import { DEFAULT_AI_MODEL } from "../src/ai/policy.mjs";
import { encodeHumanDecisionSample, hydrateHumanReplayTrajectories } from "../src/ai/human-data.mjs";
import { ACTION_DIM, MAX_ACTIONS, STATE_DIM, CARD_BINS, CARD_VOCABULARY, STRUCTURED_STATE_LAYOUT,
  CONTEXT_HASH_FEATURES, CONTEXT_RULE_FEATURES, CONTEXT_READY_FEATURES, cardIndex, encodeState, encodeActionSet, encodeOpponentDeckTarget } from "../src/ai/neural/encoding.mjs";
import { createNeuralModel, deserializeNeuralModel, serializeNeuralModel, forwardNeural, inferStep,
  estimateEncodedNeuralValue, trainPpoBatch, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import { applyGeneralizedAdvantageEstimation, seededRandom } from "../src/ai/neural/selfplay.mjs";
import { packPpoBatch } from "../src/ai/neural/trainer.mjs";
import { validateActionManifest } from "../src/ai/neural/action-manifest.mjs";
import { createPublicStructuredEvidenceSnapshot, encodePublicStructuredEvidence, validPublicStructuredEvidenceSnapshot } from "../src/ai/neural/structured-evidence.mjs";
import { numericArgument } from "../scripts/numeric-argument.mjs";
import { tf } from "../src/ai/neural/tf-runtime.mjs";

function baseGame() {
  const game = createGame({ decks: Object.values(decklists).slice(0, 2), random: seededRandom(20260905), interactive: true, manualActionChainPriority: true });
  for (const player of game.players) player.hand = player.mainDeck.splice(0, 4);
  return game;
}
function unit(id, ownerId, might = 6) {
  return { ...structuredClone(cards.lonelyPoro), instanceId: id, ownerId, controllerId: ownerId,
    zone: "base", might, effects: [], tags: [], keywords: [], damage: 0, buffs: 0,
    mightModifier: 0, exhausted: false, attachments: [] };
}
function actionGame() {
  const game = baseGame();
  Object.assign(game, { phase: "action", currentPlayerId: "p1", turnNumber: 6, turnSequence: 10,
    pendingChoice: null, pendingPayment: null, actionChain: null, showdown: null });
  game.battlefields = Object.values(cards).filter((card) => card.type === "battlefield").slice(0, 2)
    .map((card, index) => ({ ...structuredClone(card), instanceId: `audit-field-${index}`, units: [], hidden: [], controlledBy: null, effects: [] }));
  for (const player of game.players) {
    Object.assign(player, { base: [], turnScoredBattlefields: [] });
    player.legend.effects = [];
  }
  return game;
}

test("both players' scoring history is visible to flat and structured evaluators", () => {
  const game = actionGame();
  const before = encodeState(game, "p1");
  game.players[0].turnScoredBattlefields = [game.battlefields[0].instanceId];
  game.players[1].turnScoredBattlefields = new Set([game.battlefields[1].instanceId]);
  const after = encodeState(game, "p1");
  const offset = STRUCTURED_STATE_LAYOUT.context.offset + CONTEXT_HASH_FEATURES;
  assert.equal(before[offset], 0);
  assert.equal(after[offset], 1);
  assert.equal(after[offset + 4], 1);
  const structured = encodePublicStructuredEvidence(createPublicStructuredEvidenceSnapshot(game, "p1", {
    engineFingerprint: "test-engine", informationSetHash: "test-information"
  }));
  assert.equal(structured.battlefields[9], 1);
  assert.equal(structured.battlefields[32 + 10], 1);
});

test("damage changes durability without reducing Might used for combat", () => {
  const game = actionGame();
  const damaged = unit("damaged", "p1", 6);
  Object.assign(damaged, { damage: 5, mightModifier: 2, buffs: 1 });
  game.battlefields[0].units = [damaged];
  const state = encodeState(game, "p1");
  const might = currentMight(game, damaged);
  assert.ok(Math.abs(state[11] * 40 - might) < 1e-5);
  const durabilityOffset = STRUCTURED_STATE_LAYOUT.context.offset + CONTEXT_HASH_FEATURES + 6;
  assert.ok(Math.abs(state[durabilityOffset] * 40 - (might - 5)) < 1e-5);
});

test("four ready units can attack together with an exhausted fifth unit present", () => {
  const game = actionGame();
  game.players[0].hand = [];
  game.players[0].base = Array.from({ length: 5 }, (_, index) => ({ ...unit(`group-${index}`, "p1", 2), exhausted: index === 4 }));
  const field = game.battlefields[1];
  field.units = [unit("defender", "p2", 7)];
  field.controlledBy = "p2";
  const ids = game.players[0].base.slice(0, 4).map((card) => card.instanceId);
  assert.ok(canStandardMoveUnits(game, ids, field.instanceId));
  const attacks = enumerateAiPolicyActions(game, "p1").filter((action) => action.destinationId === field.instanceId);
  assert.ok(attacks.some((action) => action.unitIds?.length === 4 && ids.every((id) => action.unitIds.includes(id))));
  assert.ok(attacks.every((action) => !action.unitIds?.includes("group-4")));
});

test("capped action manifests preserve indices and reject the old full-list mismatch", () => {
  const game = actionGame();
  game.players[0].hand = [];
  game.players[0].base = Array.from({ length: 10 }, (_, index) => unit(`wide-${index}`, "p1", 2));
  const legal = enumerateAiPolicyActions(game, "p1");
  const encoded = encodeActionSet(game, "p1", legal);
  assert.ok(legal.length > MAX_ACTIONS);
  const selectedIndex = encoded.actions.findIndex((action, index) => actionKey(action) !== actionKey(legal[index]));
  assert.ok(selectedIndex >= 0);
  const step = { selectedIndex, selectedActionKey: actionKey(encoded.actions[selectedIndex]), legalCount: encoded.legalCount,
    legalActionKeys: encoded.actions.map(actionKey), originalLegalCount: legal.length, originalLegalActionKeys: legal.map(actionKey) };
  assert.equal(validateActionManifest(step), null);
  assert.ok(validateActionManifest({ ...step, legalActionKeys: legal.map(actionKey) }));
  assert.ok(validateActionManifest({ ...step, selectedIndex: (selectedIndex + 1) % encoded.legalCount }));
});

test("an empty opponent hand has zero card and reaction probabilities", () => {
  const game = actionGame();
  game.players[1].mainDeck.push(...game.players[1].hand);
  game.players[1].hand = [];
  game.players[1].runes = game.players[1].runeDeck.splice(0, 6);
  assert.deepEqual(inferOpponentDeckBelief(game, "p1").cardProbabilities, []);
  assert.equal(opponentResponseProfile(game, "p1").responseProbability, 0);
});

test("unknown hand probabilities use sampling without replacement", () => {
  const game = baseGame();
  const opponent = game.players[1];
  const known = deckInventoryCards(observeGame(game, "p1"), opponent.id);
  const counts = {};
  for (const card of deckInventoryCards(game, opponent.id)) counts[card.cardNumber] = (counts[card.cardNumber] || 0) + 1;
  const profile = { id: "exact", legendCardNumber: opponent.legend.cardNumber, mainSize: Object.values(counts).reduce((a,b) => a+b,0), cardCounts: counts };
  const belief = inferOpponentDeckBelief(game, "p1", { deckProfiles: { exact: profile } });
  const number = opponent.hand[0].cardNumber;
  const remainingCopies = counts[number] - known.filter((card) => card.cardNumber === number).length;
  const population = profile.mainSize - known.length;
  let miss = 1;
  for (let index = 0; index < opponent.hand.length; index++) miss *= Math.max(0, population - remainingCopies - index) / (population - index);
  assert.ok(Math.abs(belief.cardProbabilities.find((item) => item.cardNumber === number).probability - (1 - miss)) < 1e-12);
});

test("determinization preserves revealed hands and visible hidden cards", () => {
  const game = baseGame();
  const opponent = game.players[1];
  const hidden = opponent.mainDeck.shift();
  game.battlefields = [{ instanceId: "hidden-field", units: [], hidden: [{ ownerId: opponent.id, card: hidden }] }];
  game.revealedIntel = [{ viewerId: "p1", ownerId: "p2", expiresAtTurnSequence: game.turnSequence }];
  const belief = inferOpponentDeckBelief(game, "p1");
  assert.ok(belief.cardProbabilities.every((item) => item.probability === 1 && opponent.hand.some((card) => card.cardNumber === item.cardNumber)));
  const evidence = createPublicStructuredEvidenceSnapshot(game, "p1", { engineFingerprint: "test-engine", informationSetHash: "test-information" });
  assert.equal(validPublicStructuredEvidenceSnapshot(evidence), true);
  for (const seed of [1, 2, 3]) {
    const sampled = determinizeGame(game, "p1", belief, seededRandom(seed));
    assert.equal(determinizationStatus(sampled).complete, true);
    assert.deepEqual(sampled.players[1].hand, opponent.hand);
    assert.deepEqual(sampled.battlefields[0].hidden[0].card, hidden);
  }
});

test("deck targets count chain, champion and attachments once by owner and omit tokens", () => {
  const game = baseGame();
  const opponent = game.players[1];
  const before = encodeOpponentDeckTarget(game, "p1");
  const card = opponent.hand.shift();
  game.actionChain = { chain: [{ card }] };
  assert.deepEqual(encodeOpponentDeckTarget(game, "p1"), before);
  game.actionChain = null;
  const host = unit("host", "p1");
  host.isToken = true;
  host.attachments = [card];
  card.controllerId = "p1";
  game.players[0].base.push(host);
  const champion = opponent.availableChampions[0];
  opponent.champion = champion;
  opponent.base.push(champion, { ...card, instanceId: "generated", isToken: true });
  assert.deepEqual(encodeOpponentDeckTarget(game, "p1"), before);
  assert.equal(inferOpponentDeckBelief(game, "p1").observedCards[card.cardNumber],
    deckInventoryCards(observeGame(game, "p1"), "p2").filter((item) => item.cardNumber === card.cardNumber).length);
});

test("every registered card has its own vocabulary slot", () => {
  const numbers = [...new Set(Object.values(cards).map((card) => card.cardNumber).filter(Boolean))];
  assert.equal(numbers.filter((number) => cardIndex(number) === 0).length, 0);
  assert.equal(new Set(numbers.map(cardIndex)).size, numbers.length);
  assert.ok(CARD_VOCABULARY.length <= 1024, "Card identity bit encoding must be expanded before the vocabulary exceeds 10 bits.");
});

test("CLI zero disables optional training work and invalid numbers fail explicitly", () => {
  const source = readFileSync(new URL("../scripts/train-neural-ai.mjs", import.meta.url), "utf8");
  const args = new Proxy({}, { get: () => "0" });
  for (const name of ["teacherFraction", "teacherBudget", "teacherCriticalBudget", "teacherActionAuditBudget", "teacherLeafAuditSimulations", "anchorCoefficient", "turningPointReplayFraction", "turningPointReplayLimit"]) {
    const expression = source.match(new RegExp(`const ${name} = ([\\s\\S]*?);`))[1];
    assert.equal(Function("args", "numericArgument", `return (${expression});`)(args, numericArgument), 0, name);
  }
  assert.equal(numericArgument(undefined, 8), 8);
  assert.throws(() => numericArgument("oops", 8), /Invalid numeric/);
  assert.throws(() => numericArgument("", 8), /Invalid numeric/);
});

test("rollout evaluates an independent model once per leaf", () => {
  const model = createNeuralModel();
  const original = model.layers.value.apply;
  let calls = 0;
  model.layers.value.apply = function (...args) { calls++; return original.apply(this, args); };
  try {
    const results = rolloutAlternatives(actionGame(), "p1", [{ kind: "endTurn" }], DEFAULT_AI_MODEL,
      { simulations: 1, depth: 1, evaluatorModels: [model, model], evaluatorModelsCertified: true, random: seededRandom(77) });
    assert.ok(results.length);
    assert.equal(calls, 1);
  } finally { disposeNeuralModel(model); }
});

test("repeated random values cannot trap disjoint rollout seed generation", () => {
  const moduleUrl = new URL("../src/ai/rollout.mjs", import.meta.url).href;
  const script = `import { independentSimulationSeeds } from ${JSON.stringify(moduleUrl)};
    const first = independentSimulationSeeds(32, () => 0.25);
    const second = independentSimulationSeeds(128, () => 0.25, first);
    if (new Set([...first, ...second]).size !== 160) throw new Error('Overlapping seeds');`;
  execFileSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 10000, stdio: "pipe" });
});

function trainingStep(game, legal) {
  const actionSet = encodeActionSet(game, "p1", legal);
  return { state: encodeState(game, "p1"), actions: actionSet.encoded, selectedIndex: 0, legalCount: legal.length,
    oldLogProbability: 0, behaviorTemperature: 1, advantage: 1, return: 1, value: 0,
    beliefTarget: encodeOpponentDeckTarget(game, "p1"), initialMemory: new Float32Array(64) };
}

test("PPO packs variable action counts without copying padding into the next step", () => {
  const game = actionGame();
  const one = trainingStep(game, [{ kind: "endTurn" }]);
  one.actions.fill(17, ACTION_DIM);
  const two = trainingStep(game, [{ kind: "endTurn" }, { kind: "passShowdown" }]);
  const batch = packPpoBatch([{ steps: [one, two], won: true }]);
  assert.equal(batch.actionCount, 2);
  assert.equal(batch.actions.length, 2 * 2 * ACTION_DIM);
  assert.ok(batch.actions.slice(ACTION_DIM, 2 * ACTION_DIM).every((value) => value === 0));
  assert.deepEqual(batch.actions.slice(2 * ACTION_DIM), two.actions.slice(0, 2 * ACTION_DIM));
});

test("compact inference matches padded inference and PPO handles forced decisions", () => {
  const model = createNeuralModel();
  const optimizer = tf.train.adam(0.0001);
  try {
    const game = actionGame();
    const step = trainingStep(game, [{ kind: "endTurn" }]);
    const compact = inferStep(model, step.state, step.actions, 1);
    const padded = tf.tidy(() => {
      const output = forwardNeural(model, tf.tensor3d(step.state, [1,1,STATE_DIM]), tf.tensor4d(step.actions, [1,1,MAX_ACTIONS,ACTION_DIM]));
      return { logit: output.logits.dataSync()[0], value: output.value.dataSync()[0] };
    });
    assert.ok(Math.abs(compact.logits[0] - padded.logit) < 1e-5);
    assert.equal(compact.value, padded.value);
    const batch = packPpoBatch([{ steps: [step], won: true }]);
    assert.equal(batch.actions.length, ACTION_DIM);
    let unusedCalls = 0;
    for (const name of ["teacherProposalValue", "diagnostic", "belief"]) {
      const original = model.layers[name].apply;
      model.layers[name].apply = function (...args) { unusedCalls++; return original.apply(this, args); };
    }
    const result = trainPpoBatch(model, batch, optimizer, { teacherCoefficient: 0, teacherRankingCoefficient: 0,
      teacherActionValueCoefficient: 0, diagnosticCoefficient: 0, beliefCoefficient: 0 });
    assert.ok(Number.isFinite(result.loss));
    assert.equal(unusedCalls, 0);
  } finally { optimizer.dispose(); disposeNeuralModel(model); }
});

test("Q interactions can reverse action ranking when the state changes", () => {
  const model = createNeuralModel();
  try {
    // Controlled embeddings isolate the expressivity of the deployed Q path.
    model.layers.gru.apply = (states) => [tf.tile(states.slice([0,0,0], [1,1,1]), [1,1,64]), tf.zeros([1,64])];
    model.layers.stateProjection.apply = (sequence) => sequence;
    model.layers.actionProjection.apply = (actions) => tf.tile(actions.slice([0,0,0,0], [1,1,2,1]), [1,1,1,64]);
    const kernel = new Float32Array(192);
    kernel[128] = 1;
    const weights = [tf.tensor2d(kernel, [192,1]), tf.zeros([1])];
    model.layers.actionValue.setWeights(weights);
    weights.forEach((tensor) => tensor.dispose());
    const rank = (sign) => tf.tidy(() => {
      const state = new Float32Array(STATE_DIM); state[0] = sign;
      const actions = new Float32Array(2 * ACTION_DIM); actions[0] = 1; actions[ACTION_DIM] = -1;
      return Array.from(forwardNeural(model, tf.tensor3d(state, [1,1,STATE_DIM]), tf.tensor4d(actions, [1,1,2,ACTION_DIM])).actionValues.dataSync());
    });
    const positive = rank(1), negative = rank(-1);
    assert.ok(positive[0] > positive[1]);
    assert.ok(negative[0] < negative[1]);
  } finally { disposeNeuralModel(model); }
});

test("terminal shaping telescopes across complete player decision transitions", () => {
  const gamma = 0.997;
  const steps = [0.2, -0.4, 0.7].map((shapingPotential) => ({ value: 0, shapingPotential }));
  applyGeneralizedAdvantageEstimation(steps, 1, gamma, 1, 1);
  assert.ok(Math.abs(steps[0].return - (gamma ** 2 - 0.2)) < 1e-12);
  assert.equal(steps.at(-1).shapedReward, -0.7);
  const long = Array.from({ length: 200 }, () => ({ value: 0 }));
  applyGeneralizedAdvantageEstimation(long, 1, gamma, 0.95, 0, 0, { longLambda: 1, longWeight: 0.6 });
  assert.ok(long[0].return >= 0.6 * gamma ** 199 - 1e-12);
});

test("the saved champion migrates weights without discarding its trained Q interactions", () => {
  const checkpoint = JSON.parse(readFileSync(new URL("../src/ai/checkpoints/neural-champion.json", import.meta.url), "utf8"));
  const model = deserializeNeuralModel(checkpoint);
  try {
    const saved = serializeNeuralModel(model);
    assert.equal(saved.architecture.stateDim, STATE_DIM);
    assert.equal(saved.architecture.cardVocabularySize, CARD_BINS);
    assert.equal(saved.metadata.encodingMigration.requiresRevalidation, true);
    const old = checkpoint.weights.gru[0], migrated = saved.weights.gru[0];
    const stride = old.shape[1], oldBins = checkpoint.architecture.cardVocabularySize;
    for (let zone = 0; zone < 4; zone++) {
      const source = (40 + zone * oldBins + 1) * stride;
      const target = (40 + zone * CARD_BINS + cardIndex(checkpoint.architecture.cardVocabulary[1])) * stride;
      assert.deepEqual(migrated.values.slice(target, target + stride), old.values.slice(source, source + stride));
    }
    const oldQ = checkpoint.weights.actionValue[0].values;
    assert.deepEqual(saved.weights.actionValue[0].values.slice(0, oldQ.length), oldQ);
    assert.ok(saved.weights.actionValue[0].values.slice(oldQ.length).every((value) => value === 0));
    assert.ok(inferStep(model, encodeState(actionGame(), "p1"), encodeActionSet(actionGame(), "p1", [{ kind: "endTurn" }]).encoded, 1).logits.every(Number.isFinite));
  } finally { disposeNeuralModel(model); }
});

test("human replay encoding preserves a copied required action without duplicating it", () => {
  const game = actionGame();
  const action = { ...enumerateAiPolicyActions(game, "p1")[0] };
  const sample = encodeHumanDecisionSample(game, "p1", action, {
    best: { key: actionKey(action), simulations: 8, confidenceInterval: [0.5, 0.6] }, confidence: "high"
  });
  assert.equal(validateActionManifest(sample), null);
  assert.equal(new Set(sample.legalActionKeys).size, sample.legalActionKeys.length);
  const replay = { id: "human", humanPlayerId: "p1", winnerId: "p1", decisions: [{ actorId: "p1", trainingSample: sample }] };
  const trajectories = hydrateHumanReplayTrajectories([replay]);
  assert.equal(trajectories.length, 1);
  assert.equal(trajectories[0].steps[0].actions.length, sample.legalCount * ACTION_DIM);
  assert.equal(validateActionManifest(trajectories[0].steps[0]), null);
  assert.throws(() => encodeActionSet(game, "p1", [action], { requiredActions: [{ kind: "nonexistent" }] }), /not in the legal/);
});

test("legacy flat and structured evaluators preserve vocabulary and suffix weights during migration", () => {
  const legacy = JSON.parse(readFileSync(new URL("../src/ai/checkpoints/neural-champion.json", import.meta.url), "utf8"));
  const oldBins = legacy.architecture.cardVocabularySize;
  const legacyTailEnd = STATE_DIM - CONTEXT_RULE_FEATURES - CONTEXT_READY_FEATURES;
  for (const id of ["flat-v1-64", "structured-set-v1-128", "structured-set-v2-128"]) {
    const original = createNeuralModel({ evaluatorArchitecture: id, evaluatorArchitectureSeed: 17 });
    let migrated;
    try {
      const checkpoint = serializeNeuralModel(original);
      checkpoint.version = 5;
      checkpoint.architecture = { ...checkpoint.architecture, stateDim: legacyTailEnd - (CARD_BINS - oldBins) * 4,
        stateLayoutVersion: 1, cardVocabulary: legacy.architecture.cardVocabulary, cardVocabularySize: oldBins };
      for (const name of ["gru", "evaluatorFlatGru"]) {
        const weight = checkpoint.weights[name]?.[0];
        if (!weight) continue;
        const width = weight.shape[1];
        const rows = [...Array(40).keys()];
        for (let zone = 0; zone < 4; zone++) for (let index = 0; index < oldBins; index++) rows.push(40 + zone * CARD_BINS + index);
        for (let row = 40 + CARD_BINS * 4; row < legacyTailEnd; row++) rows.push(row);
        weight.values = rows.flatMap((row) => weight.values.slice(row * width, (row + 1) * width));
        weight.shape[0] = rows.length;
      }
      const belief = checkpoint.weights.belief;
      belief[0].values = Array.from({ length: belief[0].shape[0] }, (_, row) => belief[0].values.slice(row * CARD_BINS, row * CARD_BINS + oldBins)).flat();
      belief[0].shape[1] = oldBins;
      belief[1].values = belief[1].values.slice(0, oldBins); belief[1].shape[0] = oldBins;
      const cardProjection = checkpoint.weights.evaluatorCardProjection?.[0];
      if (cardProjection) {
        const width = cardProjection.shape[1], suffix = cardProjection.shape[0] - CARD_BINS;
        cardProjection.values = [...cardProjection.values.slice(0, oldBins * width), ...cardProjection.values.slice(CARD_BINS * width)];
        cardProjection.shape[0] = oldBins + suffix;
      }
      if (id === "structured-set-v1-128") {
        const global = checkpoint.weights.evaluatorGlobalProjection[0];
        global.shape[0] -= CONTEXT_RULE_FEATURES + CONTEXT_READY_FEATURES;
        global.values = global.values.slice(0, global.shape[0] * global.shape[1]);
      }
      migrated = deserializeNeuralModel(checkpoint);
      if (cardProjection) {
        const restored = migrated.layers.evaluatorCardProjection.getWeights()[0];
        const width = restored.shape[1], values = Array.from(restored.dataSync());
        assert.deepEqual(values.slice(CARD_BINS * width), cardProjection.values.slice(oldBins * width));
        assert.ok(values.slice(oldBins * width, CARD_BINS * width).every((value) => value === 0));
      }
      const game = actionGame(), state = encodeState(game, "p1");
      const structuredState = createPublicStructuredEvidenceSnapshot(game, "p1", { engineFingerprint: "test-engine", informationSetHash: "test-information" });
      assert.ok(Number.isFinite(estimateEncodedNeuralValue(migrated, state, { structuredState })));
    } finally { disposeNeuralModel(original); if (migrated) disposeNeuralModel(migrated); }
  }
});
