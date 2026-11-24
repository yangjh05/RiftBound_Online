import assert from "node:assert/strict";
import test from "node:test";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import {
  createGame, confirmFirstPlayer, selectChampion, selectBattlefield, skipMulligan,
  beginPlayCard, chooseEffectOption, confirmPayment, togglePaymentRune, passShowdown
} from "../src/engine.mjs";

function instance(card, playerId, instanceId) {
  return {
    ...structuredClone(card), instanceId, ownerId: playerId, controllerId: playerId,
    exhausted: false, damage: 0, stunned: false, buffs: 0, mightModifier: 0
  };
}

function fixture() {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  game.setupRandomValues = game.players.map(() => 0);
  if (game.phase === "first-player") confirmFirstPlayer(game);
  while (game.phase === "champion-select") {
    const player = game.players.find(p => p.id === game.championSelectPlayerId);
    selectChampion(game, player.id, player.availableChampions[0].instanceId);
  }
  while (game.phase === "battlefield-select") {
    const player = game.players.find(p => p.id === game.setupPlayerId);
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  while (game.phase === "mulligan") skipMulligan(game);
  const a = game.players.find(p => p.id === game.currentPlayerId);
  const b = game.players.find(p => p !== a);
  for (const player of [a, b]) {
    player.base = [];
    player.trash = [];
    player.legend = { ...player.legend, effects: [] };
    player.hand = [instance({ ...cards.flash, energy: 0, power: [], effects: [] }, player.id, `${player.id}-reaction`)];
    player.runes = Array.from({ length: 5 }, (_, i) => instance(makeRune(DOMAINS.CHAOS), player.id, `${player.id}-rune-${i}`));
    player.runePool = { energy: [], power: [] };
  }
  game.battlefields = game.battlefields.map(field => ({ ...field, effects: [], units: [], hidden: [], controlledBy: null }));
  const spell = instance(cards.whirlwind, a.id, "whirlwind");
  a.hand.push(spell);
  return { game, a, b, spell };
}

function startResolution({ game, a, b, spell }) {
  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice, null, "Whirlwind has no targets to declare before payment");
  assert.equal(game.pendingPayment.energyCost, 4);
  for (let i = 0; i < 4; i++) assert.equal(togglePaymentRune(game, a.runes[i].instanceId, "energy").ok, true);
  assert.equal(togglePaymentRune(game, a.runes[4].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null, "units are selected only when Whirlwind resolves");
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice?.effect, "eachPlayerReturnUnitToHand");
  assert.equal(game.pendingChoice.playerId, b.id);
}

for (const location of ["base", "battlefield"]) {
  test(`Whirlwind lets both players return enemy Baron Nashor from ${location} during resolution`, () => {
    const f = fixture();
    const aBaron = instance(cards.unl147baronNashor, f.a.id, "a-baron");
    const bBaron = instance(cards.unl147baronNashor, f.b.id, "b-baron");
    if (location === "base") {
      f.a.base.push(aBaron);
      f.b.base.push(bBaron);
    } else {
      f.game.battlefields[0].units.push(aBaron);
      f.game.battlefields[1].units.push(bBaron);
    }
    startResolution(f);
    assert.ok(f.game.pendingChoice.options.some(o => o.cardId === aBaron.instanceId));
    assert.equal(chooseEffectOption(f.game, aBaron.instanceId).ok, true);
    assert.ok(f.a.hand.some(card => card.instanceId === aBaron.instanceId));
    assert.equal(f.game.pendingChoice?.playerId, f.a.id, "A still selects even after losing its only unit");
    assert.ok(f.game.pendingChoice.options.some(o => o.cardId === bBaron.instanceId));
    assert.equal(chooseEffectOption(f.game, bBaron.instanceId).ok, true);
    assert.ok(f.b.hand.some(card => card.instanceId === bBaron.instanceId));
    assert.equal(f.game.pendingChoice, null);
    assert.ok(f.a.trash.some(card => card.instanceId === f.spell.instanceId));
  });
}

test("Whirlwind lets the caster return an enemy Deflect unit without paying Deflect after the opponent declines", () => {
  const f = fixture();
  const unit = instance(cards.poutyPoro, f.b.id, "deflect-unit");
  f.b.base.push(unit);
  startResolution(f);
  assert.equal(chooseEffectOption(f.game, "decline").ok, true);
  assert.equal(f.game.pendingChoice?.playerId, f.a.id);
  const runeCount = f.a.runes.length;
  assert.equal(chooseEffectOption(f.game, unit.instanceId).ok, true);
  assert.equal(f.game.pendingPayment, null);
  assert.equal(f.a.runes.length, runeCount);
  assert.ok(f.b.hand.some(card => card.instanceId === unit.instanceId));
});

test("Whirlwind's resolution selection does not invoke Gangplank's targeted return replacement", () => {
  const f = fixture();
  const unit = instance(cards.ven086gangplankNaval, f.b.id, "empowered-gangplank");
  unit.empoweredCount = 1;
  f.b.base.push(unit);
  startResolution(f);
  assert.equal(chooseEffectOption(f.game, "decline").ok, true);
  assert.equal(f.game.pendingChoice?.playerId, f.a.id);
  assert.equal(chooseEffectOption(f.game, unit.instanceId).ok, true);
  assert.ok(f.b.hand.some(card => card.instanceId === unit.instanceId));
});
