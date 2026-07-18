import test from "node:test";
import assert from "node:assert/strict";
import { decklists } from "../src/cards.mjs";
import {
  actionKey, activeActorId, applyAiAction, cloneGame, enumerateLegalActions, resolveLegalAction
} from "../src/ai/actions.mjs";
import { buildMatchReport } from "../src/ai/coach.mjs";
import { metaCardLeaderboard, mutateDeck, updateDeckLearning } from "../src/ai/deckbuilding.mjs";
import { observeGame } from "../src/ai/observation.mjs";
import { createModel, DEFAULT_AI_MODEL, determineStrategicPlan } from "../src/ai/policy.mjs";
import { createAiReplay, recordReplayDecision } from "../src/ai/replay.mjs";
import { createGame } from "../src/engine.mjs";

const decks = Object.values(decklists);

test("AI legal-action environment only emits executable actions", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  for (let step = 0; step < 8; step += 1) {
    const actorId = activeActorId(game);
    const actions = enumerateLegalActions(game, actorId);
    assert.ok(actions.length > 0);
    for (const action of actions) {
      assert.equal(actionKey(resolveLegalAction(game, action, actorId)), actionKey(action));
      assert.equal(applyAiAction(cloneGame(game), action, actorId).ok, true);
    }
    assert.equal(applyAiAction(game, actions.at(-1), actorId).ok, true);
  }
});

test("AI can take its play-order roll and choose whether to go first or second", () => {
  const game = createGame({ decks: decks.slice(0, 2), randomFirstPlayer: true, randomSeed: 123 });

  assert.deepEqual(enumerateLegalActions(game, "p1"), [{ kind: "rollFirstPlayer" }]);
  assert.equal(applyAiAction(game, { kind: "rollFirstPlayer" }, "p1").ok, true);
  assert.deepEqual(enumerateLegalActions(game, "p2"), [{ kind: "rollFirstPlayer" }]);
  assert.equal(applyAiAction(game, { kind: "rollFirstPlayer" }, "p2").ok, true);
  assert.equal(activeActorId(game), "p2");
  assert.equal(applyAiAction(game, { kind: "chooseFirstPlayer", playerId: "p2" }, "p2").ok, true);
  assert.equal(game.firstPlayerId, "p2");
  assert.equal(game.phase, "champion-select");
});

test("AI observations never expose an opponent hand without current intel", () => {
  const game = createGame({ decks: decks.slice(0, 2) });
  const [viewer, opponent] = game.players;
  const hidden = observeGame(game, viewer.id);
  assert.equal(hidden.opponent.handCount, opponent.hand.length);
  assert.deepEqual(hidden.opponent.hand, []);
  game.revealedIntel.push({ viewerId: viewer.id, ownerId: opponent.id, expiresAtTurnSequence: game.turnSequence });
  const revealed = observeGame(game, viewer.id);
  assert.equal(revealed.opponent.hand.length, opponent.hand.length);
});

test("mulligan choices are attributed separately from play mistakes", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  advanceToMulligan(game);
  const actorId = activeActorId(game);
  const replay = createAiReplay(game, { humanPlayerId: actorId, deckIds: decks.slice(0, 2).map((deck) => deck.id) });
  const before = cloneGame(game);
  const result = applyAiAction(game, { kind: "skipMulligan" }, actorId);
  recordReplayDecision(replay, before, actorId, { kind: "skipMulligan" }, result);
  const report = buildMatchReport(replay);
  assert.equal(report.summaries.mulligan.decisions, 1);
  assert.equal(report.summaries.play.decisions, 0);
});

test("deck learning records wins and mutation preserves size and copy limits", () => {
  const model = createModel(DEFAULT_AI_MODEL);
  const pair = decks.slice(0, 2);
  const game = createGame({ decks: pair });
  updateDeckLearning(model, pair, game.players[0].id, game.players);
  assert.equal(model.deckStats[pair[0].id].wins, 1);
  assert.equal(model.cardStats[pair[0].main[0].cardNumber].games > 0, true);
  assert.equal(model.matchupStats[`${pair[0].id}::${pair[1].id}`].games, 1);
  assert.equal(metaCardLeaderboard(model).length > 0, true);
  const mutated = mutateDeck(pair[0], model, () => 0.25);
  assert.equal(mutated.main.length, pair[0].main.length);
  const counts = new Map();
  for (const card of mutated.main) counts.set(card.cardNumber, (counts.get(card.cardNumber) || 0) + 1);
  assert.equal(Math.max(...counts.values()) <= 3, true);
  assert.equal(mutated.main.some((card) => card.isChampion || card.tags?.includes("Champion")), true);
});

test("public opponent archetype statistics select a matchup plan without reading hidden cards", () => {
  const game = createGame({ decks: decks.slice(0, 2) });
  const model = createModel(DEFAULT_AI_MODEL);
  const opponentLegend = game.players[1].legend.cardNumber;
  model.deckProfiles = { synthetic: { id: "synthetic", name: "Synthetic", legendCardNumber: opponentLegend, cardCounts: {}, mainSize: 40, unitRatio: 0.72, spellRatio: 0.2, gearRatio: 0.08, reactionRatio: 0.1, averageEnergy: 2.4 } };
  const plan = determineStrategicPlan(game, game.players[0].id, model);
  assert.equal(plan.kind, "stabilize");
  game.players[1].hand.reverse();
  assert.equal(determineStrategicPlan(game, game.players[0].id, model).kind, "stabilize");
});

function advanceToMulligan(game) {
  assert.equal(applyAiAction(game, { kind: "confirmFirstPlayer" }, activeActorId(game)).ok, true);
  while (game.phase === "champion-select") {
    const actorId = activeActorId(game);
    const player = game.players.find((candidate) => candidate.id === actorId);
    assert.equal(applyAiAction(game, { kind: "selectChampion", cardId: player.availableChampions[0].instanceId }, actorId).ok, true);
  }
  while (game.phase === "battlefield-select") {
    const actorId = activeActorId(game);
    const player = game.players.find((candidate) => candidate.id === actorId);
    assert.equal(applyAiAction(game, { kind: "selectBattlefield", battlefieldId: player.availableBattlefields[0].instanceId }, actorId).ok, true);
  }
  assert.equal(game.phase, "mulligan");
}
