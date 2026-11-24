import test from "node:test";
import assert from "node:assert/strict";
import { cards, makeRune } from "../src/cards.mjs";
import {
  createGame, moveUnits, startTurn, hideCard, resolveEffect,
  chooseEffectOption, passShowdown, togglePaymentRune, confirmPayment
} from "../src/engine.mjs";

function instance(card, ownerId, instanceId) {
  return { ...structuredClone(card), instanceId, ownerId, controllerId: ownerId,
    exhausted: false, damage: 0, buffs: 0, mightModifier: 0, attachments: [] };
}

function unit(ownerId, id, might = 5) {
  return instance({ ...cards.lonelyPoro, might, effects: [], keywords: [] }, ownerId, id);
}

function fixture() {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const [player, opponent] = game.players;
  Object.assign(game, { phase: "action", currentPlayerId: player.id, firstPlayerId: player.id,
    turnNumber: 4, turnSequence: 7, pendingChoice: null, pendingPayment: null,
    actionChain: null, showdown: null, triggerQueue: [], triggerQueueContinuation: null });
  for (const p of game.players) {
    Object.assign(p, { score: 0, hand: [], base: [], trash: [], banished: [], runeDeck: [],
      turnScoredBattlefields: [], hasTakenFirstTurn: true, runePool: { energy: [], power: [] } });
    p.legend.effects = [];
    p.mainDeck = Array.from({ length: 6 }, (_, i) => unit(p.id, `${p.id}-draw-${i}`));
    p.runes = Array.from({ length: 3 }, (_, i) => instance(makeRune("Order"), p.id, `${p.id}-rune-${i}`));
  }
  const field = { id: "field", instanceId: "field", name: "Field", type: "battlefield",
    effects: [], units: [], hidden: [], controlledBy: null };
  game.battlefields = [field];
  return { game, player, opponent, field };
}

function choose(game, id) {
  const result = chooseEffectOption(game, id);
  assert.equal(result.ok, true, result.message);
}

function pass(game) {
  for (let i = 0; i < 30 && !game.pendingChoice && !game.pendingPayment; i++) {
    const chain = game.showdown || game.actionChain;
    if (!chain) return;
    const result = passShowdown(game, chain.priorityPlayerId);
    assert.equal(result.ok, true, result.message);
  }
}

function kill(state, source) {
  const spell = instance({ ...cards.uncheckedPower, effects: [{ timing: "spell", kind: "killUnit", target: "friendlyUnit" }] }, state.player.id, "kill-source");
  assert.equal(resolveEffect(state.game, state.player, spell), true);
  choose(state.game, source.instanceId);
  pass(state.game);
  assert.ok(state.player.trash.some(card => card.instanceId === source.instanceId));
}

test("Blade Dancer can pay one Energy to ready its exhausted legend after a conquest", () => {
  const { game, player, field } = fixture();
  const legend = instance(cards.sfd195bladeDancer, player.id, "blade-dancer");
  legend.exhausted = true;
  player.legend = legend;
  const conqueror = unit(player.id, "conqueror");
  player.base = [conqueror];
  assert.equal(moveUnits(game, [conqueror.instanceId], field.instanceId).ok, true);
  pass(game);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  choose(game, "use-optional-trigger");
  assert.equal(game.pendingPayment?.energyCost, 1);
  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  pass(game);
  assert.equal(legend.exhausted, false);
});

for (const might of [4, 5]) {
  test(`Trapping Grounds checks the three excess damage threshold after a ${might}-Might attack`, () => {
    const { game, player, opponent, field } = fixture();
    Object.assign(field, structuredClone(cards.unl217trappingGrounds), { instanceId: "field", controlledBy: opponent.id });
    const attacker = unit(player.id, "attacker", might);
    field.units = [unit(opponent.id, "defender", 2)];
    player.base = [attacker];
    assert.equal(moveUnits(game, [attacker.instanceId], field.instanceId).ok, true);
    pass(game);
    for (let i = 0; i < 10 && game.pendingChoice?.effect === "combatDamage"; i++) {
      const option = [...game.pendingChoice.options].sort((left, right) => (right.amount || 0) - (left.amount || 0))[0];
      choose(game, option.id);
      pass(game);
    }
    assert.equal(field.controlledBy, player.id);
    const birds = player.base.filter(card => card.tags?.includes("Bird"));
    assert.equal(birds.length, might === 5 ? 1 : 0, JSON.stringify({ excess: attacker.lastConquerExcessDamage, base: player.base.map(card => card.name), choice: game.pendingChoice?.effect, log: game.log.slice(-10) }));
    if (birds.length) assert.ok(birds[0].keywords.includes("Deflect"));
  });
}

test("Dusk Rose Lab offers its sacrifice before hold scoring and resumes the beginning phase", () => {
  const { game, player, field } = fixture();
  Object.assign(field, structuredClone(cards.unl209duskRoseLab), { instanceId: "field", controlledBy: player.id });
  const sacrifice = unit(player.id, "sacrifice");
  field.units = [sacrifice];
  startTurn(game);
  assert.equal(game.pendingChoice?.card?.instanceId, field.instanceId);
  assert.equal(player.score, 0);
  // Optional placement, declaration and resolution all belong to the same ability.
  for (let i = 0; i < 10 && !player.trash.includes(sacrifice); i++) {
    if (game.pendingChoice) {
      const option = game.pendingChoice.options.find(o => o.id === sacrifice.instanceId)
        || game.pendingChoice.options.find(o => !/decline|skip/.test(o.id));
      choose(game, option.id);
    }
    pass(game);
  }
  assert.ok(player.trash.includes(sacrifice));
  assert.equal(player.hand.length, 2, "one effect draw plus the normal turn draw");
  assert.equal(player.score, 0, "sacrificing the only occupant loses control before hold scoring");
  assert.equal(game.startTurnProcess, undefined);
});

for (const alone of [false, true]) {
  test(`Loyal Poro's death draw ${alone ? "does not happen alone" : "happens with a surviving ally"}`, () => {
    const state = fixture();
    const poro = instance(cards.unl156loyalPoro, state.player.id, "loyal");
    state.player.base = [poro, ...(alone ? [] : [unit(state.player.id, "ally")])];
    kill(state, poro);
    assert.equal(state.player.hand.length, alone ? 0 : 1);
  });
}

test("Dramatic Visionary opens Predict 2 from an actual death event", () => {
  const state = fixture();
  const source = instance(cards.unl062dramaticVisionary, state.player.id, "visionary");
  state.player.base = [source];
  kill(state, source);
  assert.ok(state.game.pendingChoice, "Predict must offer a choice after the death resolves");
  assert.equal(state.game.pendingChoice.card.instanceId, source.instanceId);
  assert.equal(state.game.pendingChoice.effect, "predictMultipleRecycle");
  assert.equal(state.game.pendingChoice.data.revealedIds.length, 2);
  const [first, second] = state.player.mainDeck;
  choose(state.game, `recycle:${first.instanceId}`);
  choose(state.game, "done");
  pass(state.game);
  assert.equal(state.player.mainDeck[0].instanceId, second.instanceId);
  assert.equal(state.player.mainDeck.at(-1).instanceId, first.instanceId);
  assert.equal(state.game.pendingChoice, null);
  assert.equal(state.game.actionChain, null);
});

test("Ruined Rex's actual death declares an enemy target and deals four damage", () => {
  const state = fixture();
  const source = instance(cards.unl067ruinedRex, state.player.id, "rex");
  const enemy = unit(state.opponent.id, "enemy", 9);
  state.player.base = [source];
  state.opponent.base = [enemy];
  kill(state, source);
  assert.ok(state.game.pendingChoice, "the death trigger must declare a target");
  choose(state.game, enemy.instanceId);
  pass(state.game);
  assert.equal(enemy.damage, 4, JSON.stringify({ choice: state.game.pendingChoice, log: state.game.log.slice(-8) }));
  assert.equal(state.game.pendingChoice, null, "a declared target must not be asked for again during resolution");
});

test("Rift Herald's actual death plays a hand unit ignoring Energy and preserving Power payment", () => {
  const state = fixture();
  const source = instance(cards.unl179riftHerald, state.player.id, "herald");
  const played = instance({ ...cards.lonelyPoro, energy: 8, power: [{ domain: "Order", amount: 1 }] }, state.player.id, "hand-unit");
  state.player.base = [source];
  state.player.hand = [played];
  kill(state, source);
  assert.equal(state.game.pendingChoice?.effect, "unleashedDeathPlayHandUnit");
  choose(state.game, played.instanceId);
  assert.equal(state.game.pendingPayment?.energyCost, 0);
  assert.deepEqual(state.game.pendingPayment.powerCost, played.power);
  assert.equal(togglePaymentRune(state.game, state.player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(state.game).ok, true);
  pass(state.game);
  assert.ok(state.player.base.includes(played));
});

test("Katarina Reckless readies after a card is actually hidden", () => {
  const { game, player, field } = fixture();
  const katarina = instance(cards.unl023katarinaReckless, player.id, "katarina");
  katarina.exhausted = true;
  player.base = [katarina];
  const hidden = instance(cards.backOff, player.id, "hidden");
  player.hand = [hidden];
  field.controlledBy = player.id;
  field.units = [unit(player.id, "resident")];
  assert.equal(hideCard(game, hidden.instanceId, field.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  pass(game);
  assert.equal(field.hidden.length, 1);
  assert.equal(katarina.exhausted, false);
});

for (const timing of ["conquer", "hold"]) {
  test(`Sumpworks Map draws when its opponent scores by ${timing}`, () => {
    const { game, player, opponent, field } = fixture();
    const map = instance(cards.unl085sumpworksMap, opponent.id, "map");
    opponent.base = [map];
    const conqueror = unit(player.id, "conqueror");
    if (timing === "conquer") {
      player.base = [conqueror];
      assert.equal(moveUnits(game, [conqueror.instanceId], field.instanceId).ok, true);
    } else {
      field.units = [conqueror];
      field.controlledBy = player.id;
      startTurn(game);
    }
    pass(game);
    assert.equal(player.score, 1);
    assert.equal(opponent.hand.length, 1);
    assert.ok(opponent.base.includes(map), "Temporary belongs to its controller's own beginning phase");
    assert.equal(game.pendingChoice, null);
    assert.equal(game.actionChain, null);
    assert.equal(game.currentPlayerId, player.id);
  });
}

test("Sumpworks Map ignores its controller's score and is not doubled by an enemy conquer multiplier", () => {
  for (const mapOwner of ["player", "opponent"]) {
    const state = fixture();
    const owner = state[mapOwner];
    const map = instance(cards.unl085sumpworksMap, owner.id, "map");
    owner.base.push(map);
    const conqueror = unit(state.player.id, "conqueror");
    conqueror.effects = [{ timing: "static", kind: "conquerTriggersAdditionalTime" }];
    state.player.base.push(conqueror);
    assert.equal(moveUnits(state.game, [conqueror.instanceId], state.field.instanceId).ok, true);
    pass(state.game);
    assert.equal(owner.hand.length, mapOwner === "opponent" ? 1 : 0);
  }
});
