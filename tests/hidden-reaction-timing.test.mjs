import test from "node:test";
import assert from "node:assert/strict";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import {
  beginPlayCard, cancelPayment, cardHasKeyword, chooseEffectOption, confirmPayment, createGame,
  legalCardPlayDestinations, passShowdown, togglePaymentRune
} from "../src/engine.mjs";

// Core Rules 811.1.b, 811.1.d, 811.6 and 813.2 (2026-10-09).
function instance(card, ownerId, instanceId) {
  return { ...structuredClone(card), instanceId, ownerId, controllerId: ownerId,
    exhausted: false, damage: 0, stunned: false, buffs: 0 };
}

function fixture(definition = cards.hiddenBlade) {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const [player, opponent] = game.players;
  for (const p of game.players) {
    p.hand = []; p.base = []; p.runes = []; p.trash = [];
    p.mainDeck = Array.from({ length: 8 }, (_, i) => instance(cards.lonelyPoro, p.id, `${p.id}-draw-${i}`));
  }
  const ally = instance({ ...cards.lonelyPoro, effects: [] }, player.id, "local-ally");
  const remote = instance(cards.lonelyPoro, opponent.id, "remote-enemy");
  const field = { instanceId: "hidden-field", type: "battlefield", name: "Hidden field",
    effects: [], units: [ally], hidden: [], controlledBy: player.id };
  const otherField = { instanceId: "other-field", type: "battlefield", name: "Other field",
    effects: [], units: [remote], hidden: [], controlledBy: opponent.id };
  const card = instance(definition, player.id, "hidden-card");
  card.hidden = true;
  field.hidden.push({ card, ownerId: player.id, hiddenByPlayerId: player.id, playableFromTurnSequence: 3 });
  Object.assign(game, { phase: "action", turnSequence: 3, turnPlayerId: player.id,
    currentPlayerId: player.id, battlefields: [field, otherField], showdown: null,
    actionChain: null, pendingChoice: null, pendingPayment: null });
  return { game, player, opponent, field, otherField, card, ally, remote };
}

function showdown(f, field = f.otherField) {
  f.game.phase = "showdown";
  f.game.showdown = { battlefieldId: field.instanceId, turnPlayerId: f.player.id,
    attackerId: f.player.id, defenderId: f.opponent.id, focusPlayerId: f.player.id,
    priorityPlayerId: f.player.id, consecutivePasses: 0, chainSequence: 0, chain: [] };
}

function resolveActionChain(game) {
  for (let i = 0; game.actionChain && i < 20; i++) {
    assert.equal(game.pendingChoice, null);
    assert.equal(game.pendingPayment, null);
    assert.equal(passShowdown(game).ok, true);
  }
  assert.equal(game.actionChain, null);
}

test("Hidden spell opens an ordinary chain on a later own turn and ignores its base cost", () => {
  const f = fixture();
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), [f.field.instanceId]);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.deepEqual(f.game.pendingChoice.options.map(o => o.cardId), [f.ally.instanceId]);
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  assert.equal(f.field.hidden.length, 0);
  assert.equal(f.game.actionChain.chain.at(-1).status, "finalized");
  resolveActionChain(f.game);
  assert.equal(f.player.hand.length, 2);
  assert.ok(f.player.trash.includes(f.ally));
  assert.ok(f.player.trash.includes(f.card));
});

test("Hidden Blade can react to Hextech Ray outside combat and salvage its target", () => {
  const f = fixture();
  f.game.turnPlayerId = f.opponent.id;
  f.game.currentPlayerId = f.opponent.id;
  const ray = instance({ ...cards.hextechRay, energy: 0, power: [] }, f.opponent.id, "ray");
  f.opponent.hand = [ray];
  assert.equal(beginPlayCard(f.game, ray.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  if (f.game.pendingPayment) assert.equal(confirmPayment(f.game).ok, true);
  assert.equal(passShowdown(f.game).ok, true);
  assert.equal(f.game.actionChain.priorityPlayerId, f.player.id);
  assert.equal(f.game.showdown, null);
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), [f.field.instanceId]);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  assert.deepEqual(f.game.actionChain.chain.map(item => item.card.instanceId), [ray.instanceId, f.card.instanceId]);
  resolveActionChain(f.game);
  assert.equal(f.player.hand.length, 2, "Blade resolves before Ray and draws for the killed unit's controller");
  assert.ok(f.opponent.trash.includes(ray));
  assert.ok(f.player.trash.includes(f.ally));
});

test("Hidden at one field may react during another field's showdown but targets remain local", () => {
  const f = fixture(); showdown(f);
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), [f.field.instanceId]);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.deepEqual(f.game.pendingChoice.options.map(o => o.cardId), [f.ally.instanceId]);
  assert.equal(chooseEffectOption(f.game, f.remote.instanceId).ok, false);
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  assert.equal(f.game.showdown.battlefieldId, f.otherField.instanceId);
  assert.equal(f.game.showdown.chain.at(-1).status, "finalized");
});

test("Hidden unit may enter its own field during a remote showdown and its play trigger stays local", () => {
  const f = fixture(cards.blastconeFae); showdown(f);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.ok(f.field.units.includes(f.card));
  assert.equal(f.game.pendingChoice.effect, "modifyMight");
  assert.deepEqual(new Set(f.game.pendingChoice.options.map(o => o.cardId)), new Set([f.ally.instanceId, f.card.instanceId]));
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  assert.ok(f.game.showdown.chain.some(item => item.itemType === "trigger" && item.status === "finalized"));
});

test("Hidden cannot be played on the hiding turn even if the printed card already has Reaction", () => {
  for (const mode of ["open", "showdown"]) {
    const f = fixture({ ...cards.hiddenBlade, keywords: ["Hidden", "Reaction"] });
    f.game.turnSequence = 2;
    if (mode === "showdown") showdown(f, f.field);
    assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), []);
    assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, false);
    assert.equal(f.field.hidden.length, 1);
    assert.equal(f.game.pendingChoice, null);
  }
});

test("Hidden reveal requires the controller's priority and cannot interrupt another player's open turn", () => {
  const f = fixture();
  f.game.turnPlayerId = f.opponent.id;
  f.game.currentPlayerId = f.opponent.id;
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), []);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, false);
  showdown(f);
  f.game.showdown.focusPlayerId = f.opponent.id;
  f.game.showdown.priorityPlayerId = f.opponent.id;
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), []);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, false);
  assert.equal(f.field.hidden.length, 1);
});

test("Hidden rejects a remote destination before moving the card or opening a chain", () => {
  const f = fixture();
  for (const destination of ["base", f.otherField.instanceId]) {
    assert.equal(beginPlayCard(f.game, f.card.instanceId, destination).ok, false);
    assert.equal(f.field.hidden.length, 1);
    assert.equal(f.game.actionChain, null);
    assert.equal(f.game.pendingChoice, null);
  }
});

test("Hidden cannot start a play whose only eligible targets are at another field", () => {
  const f = fixture();
  // An empty battlefield can retain control until the next Cleanup.
  f.field.units = [];
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), []);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, false);
  assert.equal(f.field.hidden.length, 1);
  assert.equal(f.game.actionChain, null);
});

test("Hidden reveal still respects the opponent's local reveal prohibition", () => {
  const f = fixture(); showdown(f);
  f.field.units.push(instance({ ...cards.lonelyPoro,
    effects: [{ timing: "static", kind: "opponentsHiddenCantRevealHere" }] }, f.opponent.id, "reveal-blocker"));
  assert.deepEqual(legalCardPlayDestinations(f.game, f.card.instanceId), []);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, false);
  assert.equal(f.field.hidden.length, 1);
});

test("Hidden waives base cost but still pays Deflect through the common payment continuation", () => {
  const f = fixture(cards.backOff);
  const target = instance({ ...cards.vexApathetic, effects: [] }, f.opponent.id, "deflect-target");
  f.field.units.push(target);
  const rune = instance(makeRune(DOMAINS.MIND), f.player.id, "deflect-rune");
  f.player.runes = [rune];
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.equal(chooseEffectOption(f.game, target.instanceId).ok, true);
  assert.equal(f.game.pendingPayment.energyCost, 0);
  assert.ok(f.game.pendingPayment.powerCost.some(cost => cost.domain === "Any" && cost.amount === 1));
  assert.equal(confirmPayment(f.game).ok, false, "Deflect is not free");
  assert.equal(togglePaymentRune(f.game, rune.instanceId, "power").ok, true);
  assert.equal(confirmPayment(f.game).ok, true);
  resolveActionChain(f.game);
  assert.equal(target.stunned, true);
  assert.equal(f.player.runes.length, 0);
});

test("Cancelling Hidden additional payment restores facedown state and the existing chain priority", () => {
  const f = fixture(cards.backOff);
  const target = instance({ ...cards.vexApathetic, effects: [] }, f.opponent.id, "cancel-deflect-target");
  f.field.units.push(target);
  f.player.runes = [instance(makeRune(DOMAINS.MIND), f.player.id, "cancel-rune")];
  f.game.actionChain = { turnPlayerId: f.player.id, priorityPlayerId: f.player.id,
    consecutivePasses: 1, chainSequence: 0, chain: [] };
  const existingChain = f.game.actionChain;
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.equal(chooseEffectOption(f.game, target.instanceId).ok, true);
  assert.equal(cancelPayment(f.game).ok, true);
  assert.equal(f.game.actionChain, existingChain);
  assert.equal(existingChain.priorityPlayerId, f.player.id);
  assert.equal(existingChain.consecutivePasses, 1);
  assert.equal(existingChain.chain.length, 0);
  assert.equal(f.field.hidden[0].card, f.card);
  assert.equal(f.field.hidden[0].playableFromTurnSequence, 3);
  assert.equal(f.card.hidden, true);
});

test("Hidden grants the Reaction characteristic from the next turn through the spell's Chain lifetime", () => {
  const f = fixture();
  f.game.turnSequence = 2;
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), false);
  f.game.turnSequence = 3;
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), true);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), true, "Pending card retains Reaction during declaration/payment");
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), true, "Finalized spell remains a Reaction");
  resolveActionChain(f.game);
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), false, "No Hidden grant remains in Trash");
});

test("Hidden Reaction pays Mystic Vortex's additional Power even when revealed at another battlefield", () => {
  const f = fixture(); showdown(f);
  f.otherField.effects = structuredClone(cards.ven160mysticVortex.effects);
  f.player.runes = [instance(makeRune(DOMAINS.MIND), f.player.id, "vortex-rune")];
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.equal(chooseEffectOption(f.game, f.ally.instanceId).ok, true);
  assert.equal(f.game.pendingPayment.energyCost, 0);
  assert.deepEqual(f.game.pendingPayment.powerCost, [{ domain: "Any", amount: 1 }]);
  assert.equal(confirmPayment(f.game).ok, false);
  assert.equal(togglePaymentRune(f.game, "vortex-rune", "power").ok, true);
  assert.equal(confirmPayment(f.game).ok, true);
  assert.equal(f.game.showdown.chain.at(-1).status, "finalized");
});

test("Hidden Reaction is not retained on a permanent after immediate Finalize", () => {
  const f = fixture({ ...cards.blastconeFae, effects: [] });
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), true);
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.ok(f.field.units.includes(f.card));
  assert.equal(cardHasKeyword(f.game, f.card, "Reaction"), false);
});

test("Mystic Vortex taxes a Hidden Reaction unit while spell-only increases do not", () => {
  const f = fixture({ ...cards.blastconeFae, effects: [] }); showdown(f);
  f.otherField.effects = structuredClone(cards.ven160mysticVortex.effects);
  f.remote.effects = [{ timing: "combatStatic", kind: "spellCostModifier", enemyEnergy: 5 }];
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, false);
  assert.equal(f.field.hidden[0].card, f.card, "Unpaid Reaction cost rolls the Pending play back");
  f.player.runes = [instance(makeRune(DOMAINS.MIND), f.player.id, "unit-vortex-rune")];
  assert.equal(beginPlayCard(f.game, f.card.instanceId, f.field.instanceId).ok, true);
  assert.equal(f.player.runes.length, 0, "The one Power was paid; no spell-only Energy was charged");
  assert.equal(f.player.runeDeck.at(-1).instanceId, "unit-vortex-rune");
  assert.ok(f.field.units.includes(f.card));
});
