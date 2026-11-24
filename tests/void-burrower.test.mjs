import test from "node:test";
import assert from "node:assert/strict";
import { cards, makeRune } from "../src/cards.mjs";
import {
  createGame, moveUnits, chooseEffectOption, passShowdown,
  togglePaymentRune, confirmPayment, endTurn
} from "../src/engine.mjs";

function instance(card, ownerId, instanceId) {
  return {
    ...structuredClone(card), instanceId, ownerId, controllerId: ownerId,
    exhausted: false, damage: 0, stunned: false, buffs: 0, mightModifier: 0,
    attachments: []
  };
}

function fixture({ enemyControlled = false, combat = false, exhausted = false } = {}) {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const [player, opponent] = game.players;
  Object.assign(game, {
    phase: "action", currentPlayerId: player.id, firstPlayerId: player.id,
    turnSequence: 7, turnNumber: 4, pendingChoice: null, pendingPayment: null,
    actionChain: null, showdown: null, triggerQueue: [], triggerQueueContinuation: null
  });
  for (const participant of game.players) {
    Object.assign(participant, {
      score: 0, hand: [], base: [], mainDeck: [], runeDeck: [], runes: [],
      trash: [], banished: [], turnScoredBattlefields: [], cardsPlayedThisTurn: 0,
      runePool: { energy: [], power: [] }
    });
    participant.legend.effects = [];
  }
  const legend = instance(cards.sfd187voidBurrower, player.id, "void-burrower");
  legend.exhausted = exhausted;
  player.legend = legend;
  const attacker = instance({ ...cards.lonelyPoro, might: 5, keywords: [], effects: [] }, player.id, "conqueror");
  player.base = [attacker];
  const top = ["first", "second", "third"].map(id => instance(cards.lonelyPoro, player.id, id));
  player.mainDeck = [...top];
  player.runes = [0, 1].map(index => instance(makeRune("Order"), player.id, `energy-rune-${index}`));
  const field = {
    id: "conquer-field", instanceId: "conquer-field", name: "Conquer Field",
    type: "battlefield", effects: [], hidden: [],
    controlledBy: enemyControlled || combat ? opponent.id : null,
    units: combat ? [instance({ ...cards.lonelyPoro, keywords: [], effects: [] }, opponent.id, "defender")] : []
  };
  game.battlefields = [field];
  return { game, player, opponent, legend, attacker, top, field };
}

function passUntilChoice(game) {
  for (let index = 0; index < 30 && !game.pendingChoice && !game.pendingPayment; index += 1) {
    const chain = game.showdown || game.actionChain;
    if (!chain) return;
    const result = passShowdown(game, chain.priorityPlayerId);
    assert.equal(result.ok, true, result.message);
  }
}

function conquer(state) {
  const { game, attacker, field, player } = state;
  assert.equal(moveUnits(game, [attacker.instanceId], field.instanceId).ok, true);
  passUntilChoice(game);
  for (let index = 0; index < 10 && game.pendingChoice?.effect === "combatDamage"; index += 1) {
    choose(game, game.pendingChoice.options[0].id);
    passUntilChoice(game);
  }
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
}

function choose(game, optionId) {
  const result = chooseEffectOption(game, optionId);
  assert.equal(result.ok, true, result.message);
}

function acceptReveal(state) {
  const { game, legend, top } = state;
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(game.pendingChoice.card.instanceId, legend.instanceId);
  assert.equal(legend.exhausted, false, "the legend waits for its controller's decision");
  choose(game, "use-optional-trigger");
  assert.equal(game.pendingChoice?.effect, "declareTriggerCost");
  assert.equal(legend.exhausted, false);
  choose(game, "pay-trigger-cost");
  assert.equal(legend.exhausted, true);
  passUntilChoice(game);
  assert.equal(game.pendingChoice?.effect, "revealTopBanishPlay");
  assert.deepEqual(game.pendingChoice.data.revealedIds, top.slice(0, 2).map(card => card.instanceId));
  assert.deepEqual(game.revealEvents.at(-1).cardIds, top.slice(0, 2).map(card => card.instanceId));
}

for (const [label, options] of [
  ["an open battlefield", {}],
  ["an empty enemy battlefield", { enemyControlled: true }],
  ["a defended enemy battlefield after combat", { combat: true }]
]) {
  test(`Void Burrower reveals and plays a card after conquering ${label}`, () => {
    const state = fixture(options);
    const { game, player, legend, top } = state;
    conquer(state);
    acceptReveal(state);
    choose(game, top[0].instanceId);
    assert.equal(game.pendingChoice?.effect, "effectPlayDestination");
    choose(game, "base");
    assert.equal(game.pendingPayment?.energyCost, top[0].energy, "the revealed card still costs its normal Energy");
    for (const rune of player.runes) assert.equal(togglePaymentRune(game, rune.instanceId, "energy").ok, true);
    assert.equal(confirmPayment(game).ok, true);
    passUntilChoice(game);
    assert.equal(player.base.some(card => card.instanceId === top[0].instanceId), true);
    assert.equal(player.banished.some(card => card.instanceId === top[0].instanceId), false);
    assert.deepEqual(player.mainDeck.map(card => card.instanceId), [top[2].instanceId, top[1].instanceId]);
    assert.equal(legend.exhausted, true);
    assert.equal(game.pendingChoice, null);
    assert.equal(game.pendingPayment, null);
    assert.equal(game.actionChain, null);
    assert.equal(game.phase, "action");
    assert.equal(endTurn(game).ok, true, "the conquer and effect-play continuations must finish");
  });
}

test("Void Burrower can recycle both revealed cards without banishing either", () => {
  const state = fixture();
  conquer(state);
  acceptReveal(state);
  choose(state.game, "none");
  passUntilChoice(state.game);
  assert.equal(state.game.pendingChoice, null);
  assert.equal(state.game.actionChain, null);
  assert.equal(state.player.mainDeck[0].instanceId, state.top[2].instanceId);
  assert.deepEqual(new Set(state.player.mainDeck.slice(1).map(card => card.instanceId)), new Set(["first", "second"]));
  assert.equal(state.player.banished.length, 0);
  assert.equal(state.legend.exhausted, true);
});

for (const declineCost of [false, true]) {
  test(`Void Burrower can decline ${declineCost ? "its exhaust cost" : "its optional trigger"} and resume the turn`, () => {
    const state = fixture();
    conquer(state);
    assert.equal(state.game.pendingChoice?.effect, "declareOptionalTrigger");
    if (declineCost) choose(state.game, "use-optional-trigger");
    choose(state.game, declineCost ? "decline-trigger-cost" : "decline-optional-trigger");
    passUntilChoice(state.game);
    assert.equal(state.legend.exhausted, false);
    assert.deepEqual(state.player.mainDeck.map(card => card.instanceId), ["first", "second", "third"]);
    assert.equal(state.game.pendingChoice, null);
    assert.equal(state.game.actionChain, null);
    assert.equal(endTurn(state.game).ok, true);
  });
}

test("Void Burrower cannot pay its conquer cost while already exhausted", () => {
  const state = fixture({ exhausted: true });
  conquer(state);
  assert.equal(state.game.pendingChoice, null);
  assert.equal(state.legend.exhausted, true);
  assert.deepEqual(state.player.mainDeck.map(card => card.instanceId), ["first", "second", "third"]);
  assert.equal(state.game.actionChain, null);
});

test("Void Burrower does not trigger for an opponent's conquest", () => {
  const state = fixture();
  state.opponent.legend = instance(cards.sfd187voidBurrower, state.opponent.id, "enemy-legend");
  state.player.legend.effects = [];
  conquer(state);
  assert.equal(state.game.pendingChoice, null);
  assert.equal(state.opponent.legend.exhausted, false);
});

test("Void Burrower triggers once when multiple friendly units conquer together", () => {
  const state = fixture();
  const ally = instance(cards.lonelyPoro, state.player.id, "ally-conqueror");
  state.player.base.push(ally);
  assert.equal(moveUnits(state.game, [state.attacker.instanceId, ally.instanceId], state.field.instanceId).ok, true);
  passUntilChoice(state.game);
  acceptReveal(state);
  choose(state.game, "none");
  passUntilChoice(state.game);
  assert.equal(state.game.pendingChoice, null);
  assert.equal(state.game.actionChain, null);
  assert.equal(state.game.revealEvents.filter(event => event.sourceCardId === state.legend.instanceId).length, 1);
});
