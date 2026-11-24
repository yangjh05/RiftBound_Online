import assert from "node:assert/strict";
import test from "node:test";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import {
  createGame, confirmFirstPlayer, selectChampion, selectBattlefield, skipMulligan,
  playCard, chooseEffectOption, confirmPayment, togglePaymentRune, passShowdown, cancelPayment
} from "../src/engine.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";

function copy(card, playerId, instanceId) {
  return {
    ...structuredClone(card), instanceId, ownerId: playerId, controllerId: playerId,
    exhausted: false, damage: 0, stunned: false, buffs: 0, mightModifier: 0
  };
}

function fixture(aKey, bKey, { lux = false } = {}) {
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
  for (const [index, player] of [a, b].entries()) {
    player.name = index ? "B" : "A";
    player.base = [];
    player.trash = [];
    player.banished = [];
    player.legend = { ...player.legend, effects: [] };
    // Keep observation windows open; this Reaction is never played.
    player.hand = [copy({ ...cards.flash, energy: 0, power: [], effects: [] }, player.id, `${player.name}-reaction-window`)];
    player.runes = Object.values(DOMAINS).filter(d => d !== "Any").flatMap(domain =>
      Array.from({ length: 8 }, (_, j) => copy(makeRune(domain), player.id, `${player.name}-${domain}-${j}`)));
    player.runePool = { energy: [], power: [] };
    player.cardsPlayedThisTurn = 0;
    player.cardsPlayedByTypeThisTurn = {};
    player.nonTokenCardsPlayedByTypeThisTurn = {};
    player.mainDeck = Array.from({ length: 16 }, (_, j) => copy(cards.lonelyPoro, player.id, `${player.name}-filler-${j}`));
  }
  game.battlefields = game.battlefields.map(field => ({ ...field, effects: [], units: [], hidden: [], controlledBy: null }));
  if (lux) a.legend = copy(cards.luxLadyOfLuminosity, a.id, "A-Lux");
  const ac = copy(cards[aKey], a.id, "A-chosen");
  const bc = copy(cards[bKey], b.id, "B-chosen");
  a.mainDeck.unshift(ac);
  b.mainDeck.unshift(bc);
  const pf = copy(cards.promisingFuture, a.id, "PF");
  a.hand.push(pf);
  return { game, a, b, ac, bc, pf };
}

function pay(f) {
  const game = f.game;
  const payment = game.pendingPayment;
  const player = game.players.find(p => p.id === payment.playerId);
  for (let j = 0; j < (payment.energyCost || 0); j++) {
    const rune = player.runes.find(r => !r.exhausted && !payment.energyRuneIds.includes(r.instanceId));
    assert.ok(rune);
    assert.equal(togglePaymentRune(game, rune.instanceId, "energy").ok, true);
  }
  for (const requirement of payment.powerCost || []) {
    for (let j = 0; j < requirement.amount; j++) {
      const rune = player.runes.find(r => !payment.powerRuneIds.includes(r.instanceId)
        && (requirement.domain === "Any" || r.domain === requirement.domain));
      assert.ok(rune);
      assert.equal(togglePaymentRune(game, rune.instanceId, "power").ok, true);
    }
  }
  assert.equal(confirmPayment(game).ok, true);
}

function choice(f, id) {
  assert.equal(chooseEffectOption(f.game, id).ok, true);
}

function pass(f) {
  const chain = f.game.actionChain || f.game.showdown;
  assert.ok(chain);
  const result = passShowdown(f.game, chain.priorityPlayerId);
  assert.equal(result.ok, true, result.message);
}

function start(f) {
  assert.equal(playCard(f.game, f.pf.instanceId).ok, true);
  if (f.game.pendingPayment) pay(f);
  for (let j = 0; j < 4 && !f.game.pendingChoice; j++) pass(f);
  assert.equal(f.game.pendingChoice?.effect, "promisingFutureChoose");
  choice(f, f.ac.instanceId);
  assert.equal(f.game.pendingChoice?.playerId, f.b.id);
  choice(f, f.bc.instanceId);
}

function drive(f, select) {
  for (let n = 0; n < 100; n += 1) {
    const q = f.game.pendingChoice;
    if (q) {
      const id = select?.(q)
        || q.options.find(o => o.id === 'use-optional-trigger')?.id
        || q.options.find(o => o.id === 'pay-trigger-cost')?.id
        || q.options.find(o => o.cardId)?.id
        || q.options[0]?.id;
      assert.ok(id, 'A choice must have a legal option');
      choice(f, id);
    } else if (f.game.pendingPayment) pay(f);
    else if (f.game.actionChain || f.game.showdown) pass(f);
    else return;
  }
  assert.fail('Resolution did not finish in 100 actions');
}

test('PF selection: A reveals first, B can see it, and the other four cards are recycled', () => {
  const f = fixture('dazzlingAurora', 'salvage');
  const originalTop = f.a.mainDeck.slice(0, 5).map(c => c.instanceId);
  assert.equal(playCard(f.game, f.pf.instanceId).ok, true);
  if (f.game.pendingPayment) pay(f);
  while (!f.game.pendingChoice) pass(f);
  assert.equal(f.game.pendingChoice.playerId, f.a.id);
  assert.equal(f.game.pendingChoice.options.length, 5);
  choice(f, f.ac.instanceId);
  assert.equal(f.game.pendingChoice.playerId, f.b.id);
  assert.ok(f.a.banished.some(c => c.instanceId === f.ac.instanceId));
  assert.deepEqual(new Set(f.a.mainDeck.slice(-4).map(c => c.instanceId)), new Set(originalTop.slice(1)));
});

test('PF queues both cards B then A before asking B to pay Power; Energy is waived', () => {
  const f = fixture('dazzlingAurora', 'salvage');
  start(f);
  assert.deepEqual(f.game.actionChain.chain.map(i => [i.playerId, i.status]), [[f.b.id, 'pending'], [f.a.id, 'pending']]);
  assert.equal(f.game.pendingPayment.playerId, f.b.id);
  assert.equal(f.game.pendingPayment.energyCost, 0);
  assert.equal(f.game.pendingPayment.powerCost.reduce((n, p) => n + p.amount, 0), 1);
  pay(f);
  assert.equal(f.game.pendingPayment.playerId, f.a.id);
  assert.equal(f.game.pendingPayment.energyCost, 0);
  assert.equal(f.game.pendingPayment.powerCost.reduce((n, p) => n + p.amount, 0), 2);
});

test('PF leaves an unaffordable selected card banished', () => {
  const f = fixture('energyConduit', 'dazzlingAurora');
  f.b.runes = [];
  start(f);
  drive(f);
  assert.ok(f.b.banished.some(c => c.instanceId === f.bc.instanceId));
  assert.ok(f.a.base.some(c => c.instanceId === f.ac.instanceId));
});

test('PF lets both players decline required Power and keeps both cards banished', () => {
  const f = fixture('annieFiery', 'annieFiery');
  start(f);
  assert.equal(f.game.pendingPayment.playerId, f.b.id);
  assert.equal(cancelPayment(f.game).ok, true);
  assert.equal(f.game.pendingPayment.playerId, f.a.id);
  assert.equal(cancelPayment(f.game).ok, true);
  assert.ok(f.a.banished.some(c => c.instanceId === f.ac.instanceId));
  assert.ok(f.b.banished.some(c => c.instanceId === f.bc.instanceId));
});

test('PF Aurora A / Salvage B: Salvage cannot acquire Aurora as a new target on resolution', () => {
  const f = fixture('dazzlingAurora', 'salvage');
  start(f);
  drive(f);
  assert.ok(f.a.base.some(c => c.instanceId === f.ac.instanceId), 'Aurora must survive: it was not on the board when Salvage finalized');
});

test('PF Salvage A / Aurora B: Aurora must enter before A declares Salvage targets', () => {
  const f = fixture('salvage', 'dazzlingAurora');
  start(f);
  pay(f);
  assert.ok(f.b.base.some(c => c.instanceId === f.bc.instanceId), 'B gear must enter immediately when its own finalization completes');
  assert.equal(f.game.pendingChoice?.effect, 'declarePlayTarget');
  assert.ok(f.game.pendingChoice.options.some(o => o.cardId === f.bc.instanceId));
});

test('PF Aurora A / Disarming Rake B: the later finalized play trigger can destroy Aurora', () => {
  const f = fixture('dazzlingAurora', 'disarmingRake');
  start(f);
  drive(f);
  assert.ok(f.a.trash.some(c => c.instanceId === f.ac.instanceId), 'Rake must retain its trigger until after Aurora enters');
});

test('PF Elder Dragon A / Harnessed Dragon B: both declared play triggers survive their sources dying', () => {
  const f = fixture('unl118elderDragon', 'harnessedDragon');
  start(f);
  drive(f);
  assert.ok(f.b.trash.some(c => c.instanceId === f.bc.instanceId), 'Elder kills Harnessed Dragon first');
  assert.ok(f.a.trash.some(c => c.instanceId === f.ac.instanceId), 'Harnessed Dragon trigger must then kill Elder Dragon');
});

test('PF Lux / Progress Day A / Sabotage B: A draws six before Sabotage inspects the hand', () => {
  const f = fixture('progressDay', 'sabotage', {lux: true});
  start(f);
  let handCountAtSabotage = null;
  drive(f, q => {
    if (q.effect === 'sabotage') handCountAtSabotage = f.a.hand.length;
    return null;
  });
  assert.equal(handCountAtSabotage, 7, 'One initial card + PF Lux draw + Progress Day four draws + Progress Day Lux draw');
  // The UI log retains only 18 entries; verify the cards drawn, not log retention.
  assert.equal(f.a.hand.length, 6, 'Sabotage recycles the initial Reaction after the six new draws');
});

test('PF Aurora A / Ravenbloom Prefect B: Prefect can banish itself and Aurora', () => {
  const f = fixture('dazzlingAurora', 'ven102ravenbloomPrefect');
  start(f);
  drive(f);
  assert.ok(f.a.banished.some(c => c.instanceId === f.ac.instanceId));
  assert.ok(f.b.banished.some(c => c.instanceId === f.bc.instanceId));
});

test('PF double Star-Crossed: B still returns B1 after the shared enemy A1 has left', () => {
  const f = fixture('starCrossed', 'starCrossed');
  f.a.base = [copy(cards.lonelyPoro, f.a.id, 'A1')];
  f.b.base = [copy(cards.lonelyPoro, f.b.id, 'B1'), copy(cards.lonelyPoro, f.b.id, 'B2')];
  start(f);
  drive(f, q => q.playerId === f.a.id
    ? (q.options.some(o => o.id === 'A1') ? 'A1' : 'B2')
    : (q.options.some(o => o.id === 'B1') ? 'B1' : 'A1'));
  assert.ok(f.a.hand.some(c => c.instanceId === 'A1'));
  assert.ok(f.b.hand.some(c => c.instanceId === 'B2'));
  assert.ok(f.b.hand.some(c => c.instanceId === 'B1'), 'The second spell must resolve its remaining legal friendly target');
});

test("PF does not trigger the opponent's Lux when that opponent makes the last choice", () => {
  const f = fixture("energyConduit", "energyConduit");
  f.b.legend = copy(cards.luxLadyOfLuminosity, f.b.id, "B-Lux");
  start(f);
  drive(f);
  assert.equal(f.b.hand.length, 1, "B must not draw for A's PF");
  assert.ok(f.a.base.some(c => c.instanceId === f.ac.instanceId));
  assert.ok(f.b.base.some(c => c.instanceId === f.bc.instanceId));
});

for (const [aKey, bKey] of [["dazzlingAurora", "disarmingRake"], ["unl118elderDragon", "harnessedDragon"]]) {
  test(`PF automatic declarations retain play triggers: ${aKey} / ${bKey}`, () => {
    const f = fixture(aKey, bKey);
    f.game.interactive = false;
    assert.equal(playCard(f.game, f.pf.instanceId).ok, true);
    drive(f);
    assert.ok(f.a.trash.some(c => c.instanceId === f.ac.instanceId));
    if (bKey === "harnessedDragon") assert.ok(f.b.trash.some(c => c.instanceId === f.bc.instanceId));
  });
}

test("PF deferred trigger preparation survives JSON save and is omitted from player snapshots", () => {
  const f = fixture("dazzlingAurora", "disarmingRake");
  start(f);
  pay(f);
  assert.equal(f.game.pendingPayment?.playerId, f.a.id);
  assert.ok(f.game.actionChain.deferredTriggerPreparations?.length);
  const room = { game: f.game, roomId: "pf-regression", status: "playing", seats: { p1: null, p2: null } };
  for (const player of [f.a, f.b]) {
    const snapshot = snapshotForPlayer(room, player.id).game;
    assert.equal(snapshot.actionChain.deferredTriggerPreparations, undefined);
    assert.ok(snapshot.actionChain.chain.some(item => item.itemType === "trigger"));
  }
  f.game = JSON.parse(JSON.stringify(f.game));
  f.a = f.game.players.find(p => p.id === f.a.id);
  f.b = f.game.players.find(p => p.id === f.b.id);
  drive(f);
  assert.ok(f.a.trash.some(c => c.instanceId === f.ac.instanceId));
  assert.equal(f.game.actionChain, null);
});
