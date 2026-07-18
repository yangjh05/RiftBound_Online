import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cards, decklists, DOMAINS, makeRune } from "../src/cards.mjs";
import { confirmFirstPlayer, createGame, selectChampion } from "../src/engine.mjs";
import { activeActorId, enumerateLegalActions } from "../src/ai/actions.mjs";
import { inferOpponentDeckBelief } from "../src/ai/belief.mjs";
import { mutateBattlefieldSuite, mutateCardPackage, mutateDeck, mutateRuneDistribution, mutateSideboardPackage } from "../src/ai/deckbuilding.mjs";
import { ACTION_DIM, CARD_VOCABULARY, MAX_ACTIONS, encodeAction, encodeActionSet, encodeState, STATE_DIM, actionStage, cardIndex, selectHierarchicalActions } from "../src/ai/neural/encoding.mjs";
import { actionFeatures } from "../src/ai/policy.mjs";
import { createNeuralModel, createNeuralSession, deserializeNeuralModel, serializeNeuralModel } from "../src/ai/neural/model.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { determinizeGame } from "../src/ai/rollout.mjs";
import { applyResolvedSideboardSwap, enumerateSideboardActions, leagueGamesPerOpponent, terminalRewards } from "../src/ai/neural/selfplay.mjs";
import { normalizeMetaSnapshot } from "../src/ai/meta.mjs";
import { encodeHumanDecisionSample, hydrateHumanReplayTrajectories } from "../src/ai/human-data.mjs";
import { CARD_POOL_FORMATS, cardAllowedInPool, cardNumbersForPool } from "../src/card-pools.mjs";
import { buildMetaPreset, ORIGINS_HOUSTON_2025 } from "../src/ai/meta-presets.mjs";
import { weightedDeckPick } from "../src/ai/neural/imitation.mjs";
import { evaluateBehaviorCloning, trainBehaviorCloning } from "../src/ai/neural/trainer.mjs";
import { assessBehaviorCloningQuality, auditImitationDataset } from "../src/ai/neural/quality.mjs";
import { FOCUSED_TRAINING_DECK_IDS, resolveTrainingDecks, sameLegendIdentity } from "../src/ai/training-decks.mjs";

const decks = Object.values(decklists);

test("focused training uses only Sett, Annie, Kai'Sa, canonical Master Yi, and Leona", () => {
  const selected = resolveTrainingDecks(decklists, "origins-era");
  assert.deepEqual(selected.map((deck) => deck.id), FOCUSED_TRAINING_DECK_IDS);
  assert.equal(selected.some((deck) => deck.id === "keenan-xiong"), false);
  assert.throws(() => resolveTrainingDecks(decklists, "origins-era", ["origins-sett", "unknown-deck"]), /unknown-deck/);
  for (const deck of selected) {
    for (const roll of [0.05, 0.2, 0.35, 0.55, 0.9]) {
      assert.equal(sameLegendIdentity(deck, mutateDeck(deck, {}, () => roll)), true);
    }
  }
  const changedLegend = { ...structuredClone(selected[0]), legend: structuredClone(selected[1].legend) };
  assert.equal(sameLegendIdentity(selected[0], changedLegend), false);
});

test("training random seeds reproduce deck and Rune shuffles", () => {
  const create = () => createGame({
    decks: decks.slice(0, 2),
    firstPlayerId: "p1",
    interactive: true,
    manualActionChainPriority: true,
    random: () => 0.25,
    randomSeed: 20260716
  });
  const first = create();
  const second = create();
  for (const game of [first, second]) {
    assert.equal(confirmFirstPlayer(game).ok, true);
    while (game.phase === "champion-select") {
      const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
      assert.equal(selectChampion(game, player.id, player.availableChampions[0].instanceId).ok, true);
    }
  }
  const sequence = (game) => game.players.map((player) => ({
    hand: player.hand.map((card) => card.cardNumber),
    main: player.mainDeck.map((card) => card.cardNumber),
    runes: player.runeDeck.map((card) => card.cardNumber)
  }));
  assert.deepEqual(sequence(first), sequence(second));
});

test("neural public-state encoding and Bayesian belief do not depend on hidden hand order", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewerId = game.players[0].id;
  const before = Array.from(encodeState(game, viewerId));
  const beliefBefore = inferOpponentDeckBelief(game, viewerId);
  game.players[1].hand.reverse();
  assert.deepEqual(Array.from(encodeState(game, viewerId)), before);
  assert.deepEqual(inferOpponentDeckBelief(game, viewerId).posterior.map((item) => [item.deckId, item.probability]), beliefBefore.posterior.map((item) => [item.deckId, item.probability]));
  assert.equal(before.length, STATE_DIM);
});

test("AI encodings distinguish a Rune's Energy and Power activated abilities", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  const rune = {
    ...makeRune(DOMAINS.BODY),
    instanceId: "encoded-basic-rune",
    ownerId: actor.id,
    controllerId: actor.id,
    exhausted: false
  };
  actor.runes = [rune];
  const energy = { kind: "activateCard", cardId: rune.instanceId, abilityId: `${rune.instanceId}:basic-rune-energy` };
  const power = { kind: "activateCard", cardId: rune.instanceId, abilityId: `${rune.instanceId}:basic-rune-power` };

  assert.notDeepEqual(Array.from(encodeAction(game, actor.id, energy)), Array.from(encodeAction(game, actor.id, power)));
  assert.equal(actionFeatures(game, actor.id, energy)["ability:basic-rune-energy"], 1);
  assert.equal(actionFeatures(game, actor.id, power)["ability:basic-rune-power"], 1);

  const generatedPowerAction = { kind: "togglePaymentPoolPower", powerId: "generated-body-power" };
  const generatedPowerEncoding = encodeAction(game, actor.id, generatedPowerAction);
  assert.equal(generatedPowerEncoding[67], 1, "generated Power payment has a checkpoint-compatible action-kind feature");
  assert.equal(actionStage(generatedPowerAction), "payment");
  actor.runePool = { energy: [], power: [{ id: "generated-body-power", domain: DOMAINS.BODY }] };
  game.pendingPayment = {
    playerId: actor.id,
    energyCost: 0,
    powerCost: [{ domain: DOMAINS.BODY, amount: 1 }],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: ["generated-body-power"]
  };
  const generatedPowerFeatures = actionFeatures(game, actor.id, generatedPowerAction);
  assert.equal(generatedPowerFeatures.paymentPowerProgress, 1);
  assert.equal(generatedPowerFeatures.togglePoolPowerRemovesSelection, 1);
});

test("neural action encodings distinguish effect options, battlefields, and generated payment resources", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  game.pendingChoice = {
    playerId: actor.id,
    effect: "encoding-regression",
    options: [{ id: "left", amount: 1 }, { id: "right", amount: 2 }]
  };
  assert.notDeepEqual(
    Array.from(encodeAction(game, actor.id, { kind: "chooseEffectOption", optionId: "left" })),
    Array.from(encodeAction(game, actor.id, { kind: "chooseEffectOption", optionId: "right" }))
  );

  const fields = game.players.flatMap((player) => player.availableBattlefields).slice(0, 2);
  assert.equal(fields.length, 2);
  assert.notDeepEqual(
    Array.from(encodeAction(game, actor.id, { kind: "selectBattlefield", battlefieldId: fields[0].instanceId })),
    Array.from(encodeAction(game, actor.id, { kind: "selectBattlefield", battlefieldId: fields[1].instanceId }))
  );

  actor.runePool = { energy: [{ id: "energy-body", domain: DOMAINS.BODY }, { id: "energy-mind", domain: DOMAINS.MIND }], power: [] };
  assert.notDeepEqual(
    Array.from(encodeAction(game, actor.id, { kind: "togglePaymentPoolEnergy", energyId: "energy-body" })),
    Array.from(encodeAction(game, actor.id, { kind: "togglePaymentPoolEnergy", energyId: "energy-mind" }))
  );

  const legal = [
    { kind: "chooseEffectOption", optionId: "left" },
    { kind: "chooseEffectOption", optionId: "right" },
    { kind: "declineEffectChoice" }
  ];
  const actionSet = encodeActionSet(game, actor.id, legal);
  const signatures = Array.from({ length: actionSet.legalCount }, (_, index) =>
    Array.from(actionSet.encoded.subarray(index * ACTION_DIM, (index + 1) * ACTION_DIM)).join(","));
  assert.equal(new Set(signatures).size, legal.length, "every legal action reaches the model with a distinct vector");
});

test("relational state encoding preserves battlefield location and individual unit status", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewer = game.players[0];
  const unit = { ...structuredClone(cards.annieFiery), instanceId: "relational-unit", ownerId: viewer.id, controllerId: viewer.id, exhausted: false, stunned: false, attachments: [] };
  game.battlefields = [
    { ...structuredClone(viewer.availableBattlefields[0]), instanceId: "field-a", controlledBy: null, units: [unit], hidden: [] },
    { ...structuredClone(viewer.availableBattlefields[1]), instanceId: "field-b", controlledBy: null, units: [], hidden: [] }
  ];
  const atFirstField = Array.from(encodeState(game, viewer.id));
  game.battlefields[0].units = [];
  game.battlefields[1].units = [unit];
  const atSecondField = Array.from(encodeState(game, viewer.id));
  assert.notDeepEqual(atSecondField, atFirstField);
  unit.stunned = true;
  unit.damage = 2;
  assert.notDeepEqual(Array.from(encodeState(game, viewer.id)), atSecondField);
});

test("incomplete games have no terminal reward and league evaluation keeps per-opponent evidence", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  assert.equal(terminalRewards(game), null);
  assert.equal(leagueGamesPerOpponent(9, { games: 20 }), 20);
  assert.equal(leagueGamesPerOpponent(9, { gamesPerOpponent: 36 }), 36);
});

test("determinization preserves private slot identities while sampling only belief-compatible cards", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewerId = game.players[0].id;
  const ids = game.players[1].hand.map((card) => card.instanceId);
  const sampled = determinizeGame(game, viewerId, inferOpponentDeckBelief(game, viewerId), () => 0.2);
  assert.deepEqual(sampled.players[1].hand.map((card) => card.instanceId), ids);
  assert.equal(sampled.players[1].hand.every((card) => card.ownerId === game.players[1].id), true);
});

test("determinization keeps a viewer-controlled facedown card private to that controller", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewer = game.players[0];
  const opponent = game.players[1];
  const original = {
    ...structuredClone(cards.annieFiery),
    instanceId: "controlled-hidden-slot",
    ownerId: opponent.id,
    controllerId: viewer.id
  };
  opponent.hand = [];
  opponent.mainDeck = [];
  game.battlefields = [{
    instanceId: "determinization-hidden-field",
    name: "Determinization Hidden Field",
    type: "battlefield",
    controlledBy: viewer.id,
    units: [],
    hidden: []
  }];
  game.battlefields[0].hidden = [{
    ownerId: opponent.id,
    hiddenByPlayerId: viewer.id,
    card: original
  }];
  const belief = {
    observedCards: {},
    posterior: [{
      probability: 1,
      profile: { cardCounts: { [cards.lonelyPoro.cardNumber]: 1 } }
    }]
  };

  const controlled = determinizeGame(game, viewer.id, belief, () => 0);
  assert.equal(controlled.battlefields[0].hidden[0].card.name, cards.annieFiery.name);
  assert.equal(controlled.battlefields[0].hidden[0].card.controllerId, viewer.id);

  game.battlefields[0].hidden[0].card.controllerId = opponent.id;
  game.battlefields[0].hidden[0].hiddenByPlayerId = opponent.id;
  const unknown = determinizeGame(game, viewer.id, belief, () => 0);
  assert.equal(unknown.battlefields[0].hidden[0].card.name, cards.lonelyPoro.name);
  assert.equal(unknown.battlefields[0].hidden[0].card.controllerId, opponent.id);
});

test("recurrent neural policy serializes, restores and scores the legal action set", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const first = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  const restored = deserializeNeuralModel(serializeNeuralModel(model));
  const second = createNeuralSession(restored).decide(game, actorId, legal, { greedy: true });
  assert.equal(first.action.kind, second.action.kind);
  assert.equal(first.belief.length, CARD_VOCABULARY.length);
  assert.equal(Number.isFinite(first.value), true);
});

test("every registered card has a collision-free neural vocabulary index", () => {
  const registered = decks.flatMap((deck) => [...deck.main, ...(deck.sideboard || [])]).map((card) => card.cardNumber);
  const indices = registered.map(cardIndex);
  assert.equal(indices.every((index) => index > 0), true);
  const uniqueNumbers = new Set(registered);
  assert.equal(new Set([...uniqueNumbers].map(cardIndex)).size, uniqueNumbers.size);
});

test("sideboard policy exposes learned swaps and preserves the registered pool", () => {
  const deck = structuredClone(decks.find((candidate) => candidate.sideboard?.length));
  const before = [...deck.main, ...deck.sideboard].map((card) => card.cardNumber).sort();
  const actions = enumerateSideboardActions(deck, { sideboardStats: {} });
  const swap = actions.find((action) => action.kind === "sideboardSwap");
  assert.ok(swap);
  assert.equal(applyResolvedSideboardSwap(deck, swap), true);
  assert.deepEqual([...deck.main, ...deck.sideboard].map((card) => card.cardNumber).sort(), before);
});

test("external meta import produces normalized deck and card weights", () => {
  const deck = decks[0];
  const snapshot = normalizeMetaSnapshot({ decks: [{ id: deck.id, legend: deck.legend.cardNumber, games: 100, wins: 55, share: 0.4, main: [...new Map(deck.main.map((card) => [card.cardNumber, deck.main.filter((item) => item.cardNumber === card.cardNumber).length])).entries()] }] });
  assert.equal(snapshot.decks.length, 1);
  assert.equal(snapshot.deckWeights[deck.id], 1);
  assert.equal(Object.keys(snapshot.cardStats).length > 0, true);
});

test("human coaching decisions persist as sparse public training samples", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const action = enumerateLegalActions(game, actorId)[0];
  const sample = encodeHumanDecisionSample(game, actorId, action, { best: { key: JSON.stringify(action), simulations: 16, confidenceInterval: [0.45, 0.6] }, confidence: "medium", regret: 0 });
  const trajectories = hydrateHumanReplayTrajectories([{ id: "human-1", humanPlayerId: actorId, winnerId: actorId, decisions: [{ actorId, trainingSample: sample }] }], { engineFingerprint: "sha256:test" });
  assert.equal(sample.state.length < STATE_DIM, true);
  assert.equal(trajectories.length, 1);
  assert.equal(trajectories[0].steps[0].state.length, STATE_DIM);
  assert.equal(trajectories[0].completed, true);
  assert.equal(trajectories[0].engineFingerprint, "sha256:test");
  assert.equal(trajectories[0].steps[0].oldLogProbability, 0);
});

test("released card pools are cumulative and Origins excludes later packs", () => {
  const counts = CARD_POOL_FORMATS.map((pool) => cardNumbersForPool(pool.id).size);
  assert.deepEqual(counts, [383, 395, 413]);
  assert.equal(counts.every((count, index) => index === 0 || count > counts[index - 1]), true);
  const spiritforgedCard = Object.values(cards).find((card) => card.cardNumber.startsWith("SFD-"));
  assert.equal(cardAllowedInPool(spiritforgedCard, "origins-era"), false);
  assert.equal(cardAllowedInPool(spiritforgedCard, "spiritforged-era"), true);
});

test("historical Origins preset preserves official Houston field shares", () => {
  const preset = buildMetaPreset();
  const kaisa = preset.decks.find((deck) => deck.id === "origins-kaisa");
  assert.equal(preset.cardPoolId, "origins-era");
  assert.equal(preset.fieldSize, 1129);
  assert.equal(kaisa.games, ORIGINS_HOUSTON_2025.legendCounts["Kai'Sa, Daughter of the Void"]);
  assert.equal(kaisa.winRate, null);
  assert.equal(preset.unrepresentedLegendCounts["Jinx, Loose Cannon"], 24);
});

test("hierarchical action cap retains every active decision stage", () => {
  const kinds = ["confirmPayment", "chooseEffectOption", "passShowdown", "sideboardDone", "confirmMulligan", "moveUnit", "endTurn"];
  const actions = kinds.flatMap((kind) => Array.from({ length: 70 }, (_, index) => ({ kind, index })));
  const selected = selectHierarchicalActions(actions, 192);
  assert.equal(selected.length, 192);
  assert.deepEqual(new Set(selected.map(actionStage)), new Set(["payment", "choice", "reaction", "match", "mulligan", "movement", "main"]));
});

test("imitation action capping always preserves the full-set teacher choice", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const actions = Array.from({ length: MAX_ACTIONS + 20 }, (_, index) => ({ kind: "endTurn", syntheticIndex: index }));
  const teacherChoice = actions.at(-1);
  const encoded = encodeActionSet(game, actorId, actions, { requiredActions: [teacherChoice] });
  assert.equal(encoded.truncated, true);
  assert.equal(encoded.originalLegalCount, actions.length);
  assert.equal(encoded.actions.includes(teacherChoice), true);
});

test("trajectory shards round-trip typed neural tensors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-"));
  const filename = path.join(directory, "shard.json.gz");
  try {
    await writeTrajectoryArchive(filename, { generation: 4, trajectories: [{ state: new Float32Array([1.25, -0.5]), actions: new Uint16Array([2, 9]) }] });
    const restored = await readTrajectoryArchive(filename);
    assert.equal(restored.trajectories[0].state instanceof Float32Array, true);
    assert.deepEqual([...restored.trajectories[0].state], [1.25, -0.5]);
    assert.deepEqual([...restored.trajectories[0].actions], [2, 9]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical meta weighting favors the dominant Origins deck while retaining exploration", () => {
  const meta = buildMetaPreset();
  const kaisa = decks.find((deck) => deck.id === "origins-kaisa");
  const other = decks.find((deck) => deck.id === "origins-sett");
  assert.equal(weightedDeckPick([kaisa, other], () => 0.1, meta, 0.7).id, kaisa.id);
  assert.ok(weightedDeckPick([kaisa, other], () => 0.99, meta, 0.7));
});

test("behavior-cloning bootstrap trains and reports held-out action metrics", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  const step = {
    state: decision.stateEncoding,
    actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
    selectedIndex: decision.selectedIndex,
    legalCount: decision.legalCount,
    oldLogProbability: 0,
    value: 0,
    beliefTarget: new Float32Array(decision.belief.length),
    initialMemory: decision.initialMemory,
    advantage: 1,
    return: 1,
    imitation: true
  };
  const trajectories = [{ gameId: "bc-one", playerId: actorId, steps: [step] }];
  const trained = trainBehaviorCloning(model, trajectories, { epochs: 1, batchSize: 1 });
  const evaluated = evaluateBehaviorCloning(model, trajectories, { batchSize: 1 });
  assert.equal(trained.history.length, 1);
  assert.equal(evaluated.steps, 1);
  assert.equal(Number.isFinite(evaluated.policyLoss), true);
  assert.equal(evaluated.actionAccuracy >= 0 && evaluated.actionAccuracy <= 1, true);
  assert.equal(evaluated.decisionChanceAccuracy >= 0 && evaluated.decisionChanceAccuracy <= 1, true);
});

test("bootstrap quality gates reject corrupt data and accept measurable learning", () => {
  const validStep = {
    state: new Float32Array(STATE_DIM),
    actions: new Float32Array(ACTION_DIM),
    selectedIndex: 0,
    legalCount: 1,
    beliefTarget: new Float32Array(CARD_VOCABULARY.length),
    initialMemory: new Float32Array(64),
    advantage: 1,
    return: 1,
    teacherConfidence: 1,
    selectedKind: "endTurn",
    originalLegalCount: 1,
    actionSetTruncated: false
  };
  const trajectories = ["quality-1", "quality-2"].map((gameId, index) => ({ gameId, playerId: "p1", completed: true, steps: Array.from({ length: 10 }, () => ({ ...validStep })) }));
  const summaries = trajectories.map((trajectory, index) => ({ gameId: trajectory.gameId, completed: true, capped: false, firstPlayerId: index ? "p2" : "p1", deckIds: [decks[0].id, decks[1].id] }));
  const dataset = auditImitationDataset({
    collected: { trajectories, summaries, completedGames: 2, attemptedGames: 2, targetGames: 2 },
    split: { training: [trajectories[0]], validation: [trajectories[1]] },
    deckIds: [decks[0].id, decks[1].id]
  });
  assert.equal(dataset.passed, true);
  trajectories[0].steps[0].state[0] = Number.NaN;
  assert.equal(auditImitationDataset({ collected: { trajectories, summaries, completedGames: 2, attemptedGames: 2, targetGames: 2 }, split: { training: [trajectories[0]], validation: [trajectories[1]] }, deckIds: [decks[0].id, decks[1].id] }).passed, false);

  const quality = assessBehaviorCloningQuality({
    baseline: { decisionAccuracy: 0.2, policyLoss: 2 },
    validation: { decisionAccuracy: 0.35, decisionChanceAccuracy: 0.2, decisionSteps: 100, policyLoss: 1.5, valueMse: 0.8, beliefLoss: 0.4 },
    training: { decisionAccuracy: 0.4, policyLoss: 1.3 },
    validationGames: 10
  });
  assert.equal(quality.passed, true);
});

test("advanced deck mutations preserve card count, rune count and unique battlefield count", () => {
  const deck = decks.find((candidate) => new Set(candidate.runes.map((rune) => rune.domain)).size > 1) || decks[0];
  const model = { cardStats: {}, synergyStats: {}, battlefieldStats: {}, runeStats: {} };
  const cardsMutated = mutateCardPackage(deck, model, () => 0.3, 3);
  const runesMutated = mutateRuneDistribution(deck, model, () => 0.1);
  const fieldsMutated = mutateBattlefieldSuite(deck, model, () => 0.1);
  const sideboardMutated = mutateSideboardPackage(deck, model, () => 0.1);
  assert.equal(cardsMutated.main.length, deck.main.length);
  assert.equal(cardsMutated.evolution?.changes.length, 3);
  const registeredCounts = new Map();
  for (const card of [...cardsMutated.main, ...(cardsMutated.sideboard || [])]) {
    registeredCounts.set(card.name, (registeredCounts.get(card.name) || 0) + 1);
  }
  assert.equal([...registeredCounts.values()].every((count) => count <= 3), true);
  assert.equal([...cardsMutated.main, ...(cardsMutated.sideboard || [])].filter((card) => card.tags?.includes("Signature") || card.tags?.includes("Signature Spell")).length <= 3, true);
  assert.equal(runesMutated.runes.length, deck.runes.length);
  assert.equal(fieldsMutated.battlefields.length, deck.battlefields.length);
  assert.equal(new Set(fieldsMutated.battlefields.map((field) => field.cardNumber)).size, fieldsMutated.battlefields.length);
  assert.equal(sideboardMutated.sideboard.length <= 8, true);
  assert.equal(sideboardMutated.main.length, deck.main.length);
});
