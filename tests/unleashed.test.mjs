import test from "node:test";
import assert from "node:assert/strict";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import {
  activateCard,
  applyDamage,
  beginPlayCard,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmPayment,
  createGame,
  currentPlayer,
  moveUnit,
  passShowdown,
  playCard,
  resolveEffect,
  selectBattlefield,
  selectChampion,
  skipMulligan,
  startTurn,
  togglePaymentRune
} from "../src/engine.mjs";

function instance(card, ownerId, id) {
  return {
    ...structuredClone(card),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    mightModifier: 0,
    attachments: []
  };
}

function rune(domain, ownerId, id) {
  return {
    ...makeRune(domain),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false
  };
}

function finishSetup(game) {
  game.setupRandomValues = game.players.map(() => 0);
  if (game.phase === "first-player") confirmFirstPlayer(game);
  while (game.phase === "champion-select") {
    const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
    selectChampion(game, player.id, player.availableChampions[0].instanceId);
  }
  while (game.phase === "battlefield-select") {
    const player = game.players.find((candidate) => candidate.id === game.setupPlayerId);
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  while (game.phase === "mulligan") skipMulligan(game);
}

function settleActionChain(game) {
  for (let guard = 0; game.actionChain && !game.pendingChoice && !game.pendingPayment && guard < 20; guard += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
}

function settleAllChains(game) {
  for (let guard = 0; guard < 40; guard += 1) {
    if (game.pendingChoice || game.pendingPayment) break;
    const chain = game.showdown || game.actionChain;
    if (!chain) break;
    assert.equal(passShowdown(game, chain.priorityPlayerId).ok, true);
  }
}

test("Sprite Fountain repeats its play effect when its Temporary Deathknell resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const fountain = instance(cards.unl078spriteFountain, player.id, "unl-sprite-fountain");
  player.base = [fountain];

  startTurn(game);
  settleAllChains(game);

  assert.equal(player.trash.some((card) => card.instanceId === fountain.instanceId), true);
  const sprites = player.base.filter((card) => card.name === "Sprite");
  assert.equal(sprites.length, 1);
  assert.equal(sprites[0].exhausted, false);
  assert.equal(sprites[0].keywords.includes("Temporary"), true);
});

test("Unleashed conditional values use facedown control, battlefield control, and Level", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const target = instance({ ...cards.lonelyPoro, might: 10 }, opponent.id, "unl-conditional-target");
  field.units = [target];
  field.controlledBy = player.id;
  field.hidden = [{
    ownerId: player.id,
    hiddenByPlayerId: player.id,
    card: instance(cards.charm, player.id, "unl-facedown")
  }];

  const harpoon = instance(cards.unl014monsterHarpoon, player.id, "unl-harpoon");
  assert.equal(resolveEffect(game, player, harpoon), true);
  assert.equal(game.pendingChoice?.data?.amount, 4);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, 4);

  player.hand = [];
  player.mainDeck = [
    instance(cards.charm, player.id, "unl-draw-1"),
    instance(cards.gust, player.id, "unl-draw-2")
  ];
  field.controlledBy = player.id;
  resolveEffect(game, player, instance(cards.unl015rightOfConquest, player.id, "unl-right"));
  assert.equal(player.hand.length, 2, "base draw plus one controlled battlefield");

  player.xp = 6;
  target.damage = 0;
  const experience = instance(cards.unl031combatExperience, player.id, "unl-experience");
  assert.equal(resolveEffect(game, player, experience), true);
  assert.equal(game.pendingChoice?.data?.amount, 3);
});

test("Smite banishes instead of killing and Deadly Flourish remembers a later death", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const smiteTarget = instance({ ...cards.lonelyPoro, might: 3 }, opponent.id, "unl-smite-target");
  field.units = [smiteTarget];

  assert.equal(resolveEffect(game, player, instance(cards.unl007smite, player.id, "unl-smite")), true);
  assert.equal(chooseEffectOption(game, smiteTarget.instanceId).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === smiteTarget.instanceId), false);
  assert.equal(opponent.banished.some((card) => card.instanceId === smiteTarget.instanceId), true);

  const flourishTarget = instance({ ...cards.ravenbloomStudent, might: 5 }, opponent.id, "unl-flourish-target");
  field.units = [flourishTarget];
  assert.equal(resolveEffect(game, player, instance(cards.unl073deadlyFlourish, player.id, "unl-flourish")), true);
  assert.equal(chooseEffectOption(game, flourishTarget.instanceId).ok, true);
  assert.equal(flourishTarget.damage, 3);
  assert.equal(game.damageKillFollowups?.length, 1);

  const finishingSpell = instance({
    ...cards.charm,
    name: "Finishing Damage",
    effects: [{ timing: "spell", kind: "dealDamageUnit", target: "enemyUnit", amount: 2 }]
  }, player.id, "unl-finisher");
  assert.equal(resolveEffect(game, player, finishingSpell), true);
  assert.equal(chooseEffectOption(game, flourishTarget.instanceId).ok, true);
  settleActionChain(game);
  assert.equal(opponent.trash.some((card) => card.instanceId === flourishTarget.instanceId), true);
  assert.equal(player.base.some((card) => card.name === "Gold" && card.exhausted), true);
});

test("Forgotten Signpost declares, pays, and displays its two different unit choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const signpost = instance(cards.unl045forgottenSignpost, player.id, "unl-signpost");
  const costUnit = instance(cards.lonelyPoro, player.id, "unl-signpost-cost");
  const movedUnit = instance(cards.stalwartPoro, player.id, "unl-signpost-move");
  player.base = [signpost, costUnit];
  field.units = [movedUnit];

  assert.equal(activateCard(game, signpost.instanceId).ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "exhaustFriendlyUnitCost");
  assert.equal(chooseEffectOption(game, costUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "moveToExhaustedUnitLocation");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [movedUnit.instanceId]);
  assert.equal(chooseEffectOption(game, movedUnit.instanceId).ok, true);
  settleActionChain(game);

  assert.equal(costUnit.exhausted, true);
  assert.equal(signpost.exhausted, true);
  assert.equal(player.base.some((card) => card.instanceId === movedUnit.instanceId), true);
});

test("Shadow's Call excludes Temporary and enemy units from both declaration and resolution", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const friendly = instance(cards.lonelyPoro, player.id, "unl-shadow-friendly");
  const temporary = instance(cards.stalwartPoro, player.id, "unl-shadow-temporary");
  temporary.temporary = true;
  temporary.keywords = [...(temporary.keywords || []), "Temporary"];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "unl-shadow-enemy");
  game.battlefields[0].units = [friendly, temporary, enemy];
  const spell = instance({ ...cards.unl165shadowsCall, energy: 0, power: [] }, player.id, "unl-shadow-call");
  player.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [friendly.instanceId]);
});

test("Hextech Gauntlets reduces its declared Equip Energy by the chosen unit's Might", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const gear = instance(cards.unl188hextechGauntlets, player.id, "unl-gauntlets");
  const target = instance({ ...cards.lonelyPoro, might: 4 }, player.id, "unl-gauntlets-target");
  player.base = [gear, target];
  player.runes = [rune(DOMAINS.FURY, player.id, "unl-gauntlets-power")];

  assert.equal(activateCard(game, gear.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment?.energyCost, 0);
  assert.equal(game.pendingPayment?.powerCost.reduce((sum, cost) => sum + cost.amount, 0), 1);
});

test("Curtain Call exposes each distinct Repeat cost and requires one unused mode per paid repeat", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const fieldTarget = instance({ ...cards.lonelyPoro, might: 8 }, opponent.id, "unl-curtain-field");
  const baseTarget = instance({ ...cards.ravenbloomStudent, might: 8 }, opponent.id, "unl-curtain-base");
  game.battlefields[0].units = [fieldTarget];
  opponent.base = [baseTarget];
  const spell = instance({ ...cards.unl182curtainCall, energy: 0, power: [] }, player.id, "unl-curtain");
  player.hand = [spell];
  player.runes = [
    rune(DOMAINS.FURY, player.id, "unl-curtain-energy"),
    rune(DOMAINS.MIND, player.id, "unl-curtain-power")
  ];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, "curtain-repeat-0-pay").ok, true);
  assert.equal(chooseEffectOption(game, "curtain-repeat-1-pay").ok, true);
  assert.equal(chooseEffectOption(game, "curtain-repeat-2-skip").ok, true);
  assert.equal(game.pendingChoice?.data?.min, 3);
  assert.equal(game.pendingChoice?.data?.max, 3);
  assert.equal(chooseEffectOption(game, "draw").ok, true);
  assert.equal(chooseEffectOption(game, "damageBattlefield").ok, true);
  assert.equal(chooseEffectOption(game, "damageBase").ok, true);
  assert.equal(chooseEffectOption(game, fieldTarget.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, baseTarget.instanceId).ok, true);
  assert.equal(game.pendingPayment?.energyCost, 1);
  assert.equal(game.pendingPayment?.powerCost.reduce((sum, cost) => sum + cost.amount, 0), 1);
  assert.equal(togglePaymentRune(game, "unl-curtain-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "unl-curtain-power", "power").ok, true);
  const confirmation = confirmPayment(game);
  assert.equal(confirmation.ok, true, confirmation.message);
  settleActionChain(game);
  assert.equal(fieldTarget.damage, 2);
  assert.equal(baseTarget.damage, 3);
});

test("Conscription's paid XP declaration removes the Might limit and preserves exhaust through recall", () => {
  const limitedGame = createGame({ interactive: true });
  finishSetup(limitedGame);
  const limitedPlayer = currentPlayer(limitedGame);
  const limitedOpponent = limitedGame.players.find((candidate) => candidate.id !== limitedPlayer.id);
  const low = instance({ ...cards.lonelyPoro, might: 3 }, limitedOpponent.id, "unl-conscription-low");
  const high = instance({ ...cards.stalwartPoro, might: 7 }, limitedOpponent.id, "unl-conscription-high");
  limitedGame.battlefields[0].units = [low, high];
  limitedPlayer.xp = 5;
  const limitedSpell = instance({ ...cards.unl140conscription, energy: 0, power: [] }, limitedPlayer.id, "unl-conscription-limited");
  limitedPlayer.hand = [limitedSpell];

  assert.equal(beginPlayCard(limitedGame, limitedSpell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(limitedGame, "skip").ok, true);
  assert.deepEqual(limitedGame.pendingChoice.options.map((option) => option.cardId), [low.instanceId]);

  const paidGame = createGame({ interactive: true });
  finishSetup(paidGame);
  const paidPlayer = currentPlayer(paidGame);
  const paidOpponent = paidGame.players.find((candidate) => candidate.id !== paidPlayer.id);
  const paidHigh = instance({ ...cards.stalwartPoro, might: 7 }, paidOpponent.id, "unl-conscription-paid-high");
  paidGame.battlefields[0].units = [paidHigh];
  paidPlayer.xp = 5;
  const paidSpell = instance({ ...cards.unl140conscription, energy: 0, power: [] }, paidPlayer.id, "unl-conscription-paid");
  paidPlayer.hand = [paidSpell];

  assert.equal(beginPlayCard(paidGame, paidSpell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(paidGame, "pay-xp").ok, true);
  assert.deepEqual(paidGame.pendingChoice.options.map((option) => option.cardId), [paidHigh.instanceId]);
  assert.equal(chooseEffectOption(paidGame, paidHigh.instanceId).ok, true);
  assert.equal(confirmPayment(paidGame).ok, true);
  settleActionChain(paidGame);
  assert.equal(paidPlayer.xp, 0);
  assert.equal(paidHigh.controllerId, paidPlayer.id);
  assert.equal(paidHigh.exhausted, true);
  assert.equal(paidPlayer.base.some((card) => card.instanceId === paidHigh.instanceId), true);
});

test("Undying Loyalty discounts only a chosen animal and enforces both printed trash limits", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const tagged = instance({ ...cards.lonelyPoro, energy: 2, power: [{ domain: DOMAINS.ORDER, amount: 1 }] }, player.id, "unl-loyalty-tagged");
  const untagged = instance({ ...cards.ravenbloomStudent, tags: ["Noxus"], energy: 2, power: [{ domain: DOMAINS.ORDER, amount: 1 }] }, player.id, "unl-loyalty-untagged");
  const tooExpensive = instance({ ...cards.stalwartPoro, energy: 3, power: [{ domain: DOMAINS.ORDER, amount: 1 }] }, player.id, "unl-loyalty-expensive");
  player.trash = [tagged, untagged, tooExpensive];
  player.runes = [
    rune(DOMAINS.ORDER, player.id, "unl-loyalty-rune-1"),
    rune(DOMAINS.ORDER, player.id, "unl-loyalty-rune-2")
  ];
  const spell = instance({ ...cards.unl168undyingLoyalty, power: [] }, player.id, "unl-loyalty");
  player.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.deepEqual(new Set(game.pendingChoice.options.map((option) => option.cardId)), new Set([tagged.instanceId, untagged.instanceId]));
  assert.equal(chooseEffectOption(game, tagged.instanceId).ok, true);
  assert.equal(game.pendingPayment.energyCost, 0);
  assert.equal(confirmPayment(game).ok, true);
  settleActionChain(game);
  assert.equal(player.base.some((card) => card.instanceId === tagged.instanceId), true);
});

test("Grim Resolve awards its delayed XP only when the chosen unit wins combat", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const winner = instance({ ...cards.lonelyPoro, might: 2 }, player.id, "unl-grim-winner");
  const defender = instance({ ...cards.ravenbloomStudent, might: 1 }, opponent.id, "unl-grim-defender");
  player.base = [winner];
  game.battlefields[0].units = [defender];
  const xpBefore = player.xp;

  resolveEffect(game, player, instance(cards.unl095grimResolve, player.id, "unl-grim"));
  assert.equal(winner.combatWinXpBonus, 2);
  assert.equal(moveUnit(game, winner.instanceId, game.battlefields[0].instanceId).ok, true);
  settleAllChains(game);
  assert.equal(player.xp, xpBefore + 2, JSON.stringify({
    phase: game.phase,
    showdown: game.showdown,
    actionChain: game.actionChain,
    stagedEvents: game.stagedEvents,
    combatResults: game.combatResultEvents,
    log: game.log.slice(-20)
  }));
});

test("LeBlanc draws two during her controller's Beginning Phase", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const leblanc = instance(cards.unl172leBlancFragmented, player.id, "unl-leblanc");
  game.battlefields[0].units = [leblanc];
  player.hand = [];
  player.mainDeck = [
    instance(cards.charm, player.id, "unl-leblanc-draw-1"),
    instance(cards.gust, player.id, "unl-leblanc-draw-2")
  ];
  game.phase = "beginning";
  game.turnPlayerId = player.id;

  const lethalSpell = instance({
    ...cards.charm,
    effects: [{ timing: "spell", kind: "dealDamageUnit", target: "enemyUnit", amount: 3 }]
  }, opponent.id, "unl-leblanc-source");
  resolveEffect(game, opponent, lethalSpell);
  assert.equal(player.hand.length, 2);
});

test("Pyke and Star Spring enforce their once-per-turn and first-non-token markers", () => {
  const pykeGame = createGame();
  finishSetup(pykeGame);
  const pykePlayer = currentPlayer(pykeGame);
  const pykeOpponent = pykeGame.players.find((candidate) => candidate.id !== pykePlayer.id);
  const pyke = instance(cards.unl145pykeReturned, pykePlayer.id, "unl-pyke");
  const victimOne = instance({ ...cards.lonelyPoro, might: 1 }, pykeOpponent.id, "unl-pyke-victim-1");
  const victimTwo = instance({ ...cards.lonelyPoro, might: 1 }, pykeOpponent.id, "unl-pyke-victim-2");
  pykeGame.battlefields[0].units = [pyke, victimOne, victimTwo];
  const damageSource = (id) => instance({
    ...cards.charm,
    effects: [{ timing: "spell", kind: "dealDamageUnit", target: "enemyUnit", amount: 1 }]
  }, pykePlayer.id, id);
  resolveEffect(pykeGame, pykePlayer, damageSource("unl-pyke-damage-1"));
  resolveEffect(pykeGame, pykePlayer, damageSource("unl-pyke-damage-2"));
  assert.equal(pykePlayer.base.filter((card) => card.name === "Gold").length, 1);

  const springGame = createGame();
  finishSetup(springGame);
  const springPlayer = currentPlayer(springGame);
  const spring = {
    ...instance(cards.unl215starSpring, springPlayer.id, "unl-star-spring"),
    controlledBy: springPlayer.id,
    units: [],
    hidden: []
  };
  springGame.battlefields[0] = spring;
  const movableFirst = instance(cards.lonelyPoro, springPlayer.id, "unl-star-move-first");
  spring.units = [movableFirst];
  const firstPlay = instance({ ...cards.stalwartPoro, energy: 0, power: [] }, springPlayer.id, "unl-star-play-first");
  springPlayer.hand = [firstPlay];
  assert.equal(playCard(springGame, firstPlay.instanceId, spring.instanceId).ok, true);
  assert.equal(springPlayer.base.some((card) => card.instanceId === movableFirst.instanceId), true);

  const movableSecond = instance(cards.lonelyPoro, springPlayer.id, "unl-star-move-second");
  spring.units.push(movableSecond);
  const secondPlay = instance({ ...cards.stalwartPoro, energy: 0, power: [] }, springPlayer.id, "unl-star-play-second");
  springPlayer.hand = [secondPlay];
  assert.equal(playCard(springGame, secondPlay.instanceId, spring.instanceId).ok, true);
  assert.equal(spring.units.some((card) => card.instanceId === movableSecond.instanceId), true);
});
