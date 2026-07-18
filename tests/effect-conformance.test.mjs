import test from "node:test";
import assert from "node:assert/strict";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import {
  activateCard,
  applyDamage,
  beginPlayCard,
  chooseEffectOption,
  createGame,
  currentCombatMight,
  currentMight,
  endTurn,
  moveUnits,
  passShowdown,
  playCard,
  resolveEffect,
  startTurn
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

function plainUnit(ownerId, id, might = 2) {
  return instance({
    id: `TEST-${id}`,
    collectorNumber: `TEST-${id}`,
    cardNumber: `TEST-${id}`,
    name: id,
    type: "unit",
    set: "Rules Test",
    rarity: "Common",
    domains: [],
    tags: [],
    keywords: [],
    energy: 0,
    power: [],
    might,
    text: "",
    effects: []
  }, ownerId, id);
}

function plainSpell(ownerId, id, energy = 0, effects = []) {
  return instance({
    id: `TEST-${id}`,
    collectorNumber: `TEST-${id}`,
    cardNumber: `TEST-${id}`,
    name: id,
    type: "spell",
    set: "Rules Test",
    rarity: "Common",
    domains: [],
    tags: [],
    keywords: [],
    energy,
    power: [],
    text: "",
    effects
  }, ownerId, id);
}

function plainGear(ownerId, id, energy = 0) {
  const gear = plainSpell(ownerId, id, energy);
  gear.type = "gear";
  return gear;
}

function freeToPlay(card) {
  card.energy = 0;
  card.power = [];
  return card;
}

function rune(domain, ownerId, id) {
  return instance(makeRune(domain), ownerId, id);
}

function battlefield(id, units = [], controlledBy = null) {
  return {
    id,
    instanceId: id,
    name: id,
    type: "battlefield",
    effects: [],
    units,
    hidden: [],
    controlledBy
  };
}

function ruleGame({ interactive = true } = {}) {
  const game = createGame({ interactive });
  game.phase = "action";
  game.currentPlayerId = game.players[0].id;
  game.firstPlayerId = game.players[0].id;
  game.turnSequence = 7;
  game.turnNumber = 4;
  game.pendingChoice = null;
  game.pendingPayment = null;
  game.actionChain = null;
  game.showdown = null;
  game.triggerQueue = [];
  game.triggerQueueContinuation = null;
  game.battlefields = [];

  for (const player of game.players) {
    player.score = 0;
    player.xp = 0;
    player.hand = [];
    player.base = [];
    player.mainDeck = [];
    player.runeDeck = [];
    player.runes = [];
    player.trash = [];
    player.banished = [];
    player.turnScoredBattlefields = [];
    player.cardsPlayedThisTurn = 0;
    player.drawCountThisTurn = 0;
    player.discardedCardsThisTurn = 0;
    delete player.cannotPlayCardsUntilTurnSequence;
  }
  return game;
}

function advanceUntil(game, predicate, limit = 20) {
  for (let index = 0; index < limit && !predicate(); index += 1) {
    if (game.pendingChoice) {
      const option = game.pendingChoice.options.find((candidate) => !["skip", "decline"].includes(candidate.id))
        || game.pendingChoice.options[0];
      if (!option) break;
      chooseEffectOption(game, option.id);
      continue;
    }
    if (game.showdown) {
      passShowdown(game, game.showdown.priorityPlayerId);
      continue;
    }
    break;
  }
  return predicate();
}

test("Tasty Faefolk Deathknell draws after lethal spell damage", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const opponent = game.players[1];
  const tasty = instance(cards.tastyFaefolk, player.id, "tasty-deathknell");
  const finalSpark = instance(cards.finalSpark, opponent.id, "lethal-final-spark");
  const drawn = plainUnit(player.id, "deathknell-draw");
  player.mainDeck = [drawn];
  player.runeDeck = [
    rune(DOMAINS.CALM, player.id, "deathknell-rune-1"),
    rune(DOMAINS.CALM, player.id, "deathknell-rune-2")
  ];
  game.battlefields = [battlefield("deathknell-field", [tasty], player.id)];

  assert.equal(resolveEffect(game, opponent, finalSpark), false);
  assert.equal(player.trash.some((card) => card.instanceId === tasty.instanceId), true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
  assert.equal(player.runes.length, 2);
  assert.equal(game.log.filter((entry) => entry === "Tasty Faefolk trigger finalized.").length, 1);
});

test("Deathknell remains controlled by the permanent's last controller after it enters its owner's trash", () => {
  const game = ruleGame({ interactive: false });
  const controller = game.players[0];
  const owner = game.players[1];
  const faefolk = instance(cards.tastyFaefolk, owner.id, "controlled-faefolk");
  faefolk.controllerId = controller.id;
  const controlledDraw = plainSpell(controller.id, "controlled-faefolk-draw");
  const ownerDeckCard = plainSpell(owner.id, "controlled-faefolk-owner-deck");
  controller.base = [faefolk];
  controller.mainDeck = [controlledDraw];
  controller.runeDeck = [
    rune(DOMAINS.CALM, controller.id, "controlled-faefolk-rune-1"),
    rune(DOMAINS.CALM, controller.id, "controlled-faefolk-rune-2")
  ];
  owner.mainDeck = [ownerDeckCard];

  resolveEffect(game, owner, instance(cards.finalSpark, owner.id, "controlled-faefolk-final-spark"));

  assert.equal(owner.trash.some((card) => card.instanceId === faefolk.instanceId), true, "the owner still receives the killed card");
  assert.equal(controller.hand.some((card) => card.instanceId === controlledDraw.instanceId), true);
  assert.equal(controller.runes.length, 2);
  assert.deepEqual(owner.mainDeck.map((card) => card.instanceId), [ownerDeckCard.instanceId]);
});

test("Discard instructions let their responsible player choose the cards before later instructions continue", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const agent = instance(cards.undercoverAgent, player.id, "undercover-agent-choice");
  const keep = plainSpell(player.id, "agent-keep");
  const firstDiscard = plainSpell(player.id, "agent-chosen-discard-1");
  const secondDiscard = plainSpell(player.id, "agent-chosen-discard-2");
  const drawn = [plainUnit(player.id, "agent-chosen-draw-1"), plainUnit(player.id, "agent-chosen-draw-2")];
  player.hand = [keep, firstDiscard, secondDiscard];
  player.mainDeck = [...drawn];
  game.battlefields = [battlefield("agent-choice-field", [agent], player.id)];

  resolveEffect(game, opponent, instance(cards.finalSpark, opponent.id, "agent-choice-final-spark"));

  assert.equal(game.pendingChoice?.effect, "damageUnit");
  assert.equal(chooseEffectOption(game, agent.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "discardCard");
  assert.equal(chooseEffectOption(game, secondDiscard.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "discardCard");
  assert.equal(chooseEffectOption(game, firstDiscard.instanceId).ok, true);
  assert.deepEqual(player.hand.map((card) => card.instanceId).sort(), [
    keep.instanceId,
    ...drawn.map((card) => card.instanceId)
  ].sort());
  assert.equal(player.trash.some((card) => card.instanceId === firstDiscard.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === secondDiscard.instanceId), true);
});

test("Recycle instructions let the responsible player choose the Rune and preserve its owner destination", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const conqueror = plainUnit(player.id, "sigil-choice-conqueror");
  const keep = rune(DOMAINS.FURY, player.id, "sigil-choice-keep");
  const recycle = rune(DOMAINS.CALM, player.id, "sigil-choice-recycle");
  const sigil = { ...instance(cards.sigilOfTheStorm, opponent.id, "sigil-choice-field"), units: [], hidden: [], controlledBy: opponent.id };
  player.base = [conqueror];
  player.runes = [keep, recycle];
  player.runeDeck = [];
  game.battlefields = [sigil];

  assert.equal(moveUnits(game, [conqueror.instanceId], sigil.instanceId).ok, true);
  for (let step = 0; step < 12 && game.pendingChoice?.effect !== "recycleRunes"; step += 1) {
    const priorityPlayerId = game.showdown?.priorityPlayerId || game.actionChain?.priorityPlayerId;
    if (!priorityPlayerId) break;
    assert.equal(passShowdown(game, priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "recycleRunes");
  assert.equal(chooseEffectOption(game, recycle.instanceId).ok, true);
  assert.deepEqual(player.runes.map((card) => card.instanceId), [keep.instanceId]);
  assert.deepEqual(player.runeDeck.map((card) => card.instanceId), [recycle.instanceId]);
});

test("Chemtech Enforcer discards one card when played", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const enforcer = instance(cards.chemtechEnforcer, player.id, "chemtech-enforcer");
  const discarded = plainUnit(player.id, "chemtech-discard");
  player.hand = [enforcer, discarded];
  player.runes = [
    rune(DOMAINS.FURY, player.id, "chemtech-rune-1"),
    rune(DOMAINS.FURY, player.id, "chemtech-rune-2")
  ];

  assert.equal(playCard(game, enforcer.instanceId, "base").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === enforcer.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  assert.equal(player.hand.length, 0);
});

test("Sprite Mother plays one ready Temporary Sprite at her battlefield", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const mother = instance(cards.spriteMother, player.id, "sprite-mother");
  const field = battlefield("sprite-field", [], player.id);
  game.battlefields = [field];
  player.hand = [mother];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.MIND, player.id, `sprite-rune-${index}`));

  assert.equal(playCard(game, mother.instanceId, field.instanceId).ok, true);
  const sprites = field.units.filter((card) => card.cardNumber === "OGN-274/298");
  assert.equal(sprites.length, 1);
  assert.equal(sprites[0].exhausted, false);
  assert.equal(sprites[0].keywords.includes("Temporary"), true);
  assert.equal(mother.keywords.includes("Temporary"), false, "Sprite Mother herself is not Temporary");

  startTurn(game);
  assert.equal(field.units.some((card) => card.instanceId === mother.instanceId), true,
    "killing the Temporary Sprite must not also kill Sprite Mother");
  assert.equal(field.units.some((card) => card.instanceId === sprites[0].instanceId), false,
    "the generated Sprite is killed at the start of its controller's turn");
});

test("Brynhir Thundersong prevents an opponent from playing cards for the turn", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const opponent = game.players[1];
  const brynhir = instance(cards.brynhirThundersong, player.id, "brynhir");
  const opposingCard = plainUnit(opponent.id, "blocked-opposing-card");
  player.hand = [brynhir];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.FURY, player.id, `brynhir-rune-${index}`));

  assert.equal(playCard(game, brynhir.instanceId, "base").ok, true);
  assert.equal(opponent.cannotPlayCardsUntilTurnSequence, game.turnSequence);

  game.currentPlayerId = opponent.id;
  opponent.hand = [opposingCard];
  assert.equal(playCard(game, opposingCard.instanceId, "base").ok, false);
  assert.equal(opponent.hand.some((card) => card.instanceId === opposingCard.instanceId), true);
});

test("Kai'Sa, Survivor draws when she conquers", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const opponent = game.players[1];
  const kaiSa = instance(cards.kaiSaSurvivor, player.id, "kaisa-survivor");
  const drawn = plainUnit(player.id, "kaisa-conquer-draw");
  const field = battlefield("kaisa-field");
  player.base = [kaiSa];
  player.mainDeck = [drawn];
  game.battlefields = [field];

  assert.equal(moveUnits(game, [kaiSa.instanceId], field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(player.score, 1);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
});

test("Defy counters an eligible opposing spell on the chain", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const defy = instance(cards.defy, player.id, "defy");
  const opposingSpell = instance({
    id: "TEST-SPELL",
    collectorNumber: "TEST-SPELL",
    cardNumber: "TEST-SPELL",
    name: "Eligible opposing spell",
    type: "spell",
    energy: 4,
    power: [{ domain: DOMAINS.FURY, amount: 1 }],
    effects: []
  }, opponent.id, "eligible-opposing-spell");
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: "counter-field",
    attackerId: opponent.id,
    defenderId: player.id,
    turnPlayerId: opponent.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [
      null,
      {
        id: "cardless-trigger",
        itemType: "trigger",
        card: null,
        playerId: opponent.id,
        trigger: { kind: "effectSpecs" },
        status: "finalized"
      },
      { card: opposingSpell, playerId: opponent.id, destination: "base", status: "pending" }
    ]
  };

  assert.equal(resolveEffect(game, player, defy), true);
  assert.equal(game.pendingChoice?.effect, "counterChainCard");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [opposingSpell.instanceId]);
  assert.equal(chooseEffectOption(game, opposingSpell.instanceId).ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0]?.id, "cardless-trigger");
  assert.equal(opponent.trash.some((card) => card.instanceId === opposingSpell.instanceId), true);
});

test("Unchecked Power exhausts friendly units outside battlefields before its damage", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const first = plainUnit(player.id, "unchecked-friendly-1");
  const second = plainUnit(player.id, "unchecked-friendly-2");
  player.base = [first, second];

  assert.equal(resolveEffect(game, player, instance(cards.uncheckedPower, player.id, "unchecked-power")), false);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
});

test("Stand United grants only a turn-long additional Might to buffed units", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const target = plainUnit(player.id, "stand-united-target");
  const alreadyBuffed = plainUnit(player.id, "stand-united-buffed");
  alreadyBuffed.buffs = 1;
  player.base = [target, alreadyBuffed];
  player.mainDeck = [plainUnit(player.id, "stand-united-next-draw")];

  assert.equal(resolveEffect(game, player, instance(cards.standUnited, player.id, "stand-united")), true);
  assert.equal(game.pendingChoice?.effect, "standUnited");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.buffs, 1);
  assert.equal(target.mightModifier, 1);
  assert.equal(target.temporaryMight, 1);
  assert.equal(alreadyBuffed.buffs, 1);
  assert.equal(alreadyBuffed.mightModifier, 1);
  assert.equal(alreadyBuffed.temporaryMight, 1);

  startTurn(game);
  assert.equal(target.buffs, 1);
  assert.equal(alreadyBuffed.buffs, 1);
  assert.equal(target.mightModifier, 0);
  assert.equal(alreadyBuffed.mightModifier, 0);
  assert.equal(target.temporaryMight, undefined);
  assert.equal(alreadyBuffed.temporaryMight, undefined);
});

test("Confront makes a subsequently played unit enter ready", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const unit = plainUnit(player.id, "confront-unit");
  unit.energy = 2;
  player.hand = [unit];
  player.mainDeck = [plainUnit(player.id, "confront-draw")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "confront-rune-1"),
    rune(DOMAINS.BODY, player.id, "confront-rune-2")
  ];

  assert.equal(resolveEffect(game, player, instance(cards.confront, player.id, "confront")), false);
  assert.equal(player.unitsEnterReadyThisTurn, true);
  assert.equal(playCard(game, unit.instanceId, "base").ok, true);
  assert.equal(unit.exhausted, false);
});

test("Trinity Force and Guardian Angel use the shared attached Might resolver", () => {
  const game = ruleGame();
  const player = game.players[0];
  const unit = plainUnit(player.id, "equipped-unit", 2);
  unit.attachments = [
    instance(cards.trinityForce, player.id, "trinity-force"),
    instance(cards.guardianAngel, player.id, "guardian-angel")
  ];
  player.base = [unit];

  assert.equal(currentMight(game, unit), 5);
});

test("Master Yi, Wuju Bladesman gives +2 Might to a lone defender", () => {
  const game = ruleGame();
  const player = game.players[0];
  const opponent = game.players[1];
  player.legend = instance(cards.masterYiWujuBladesman, player.id, "master-yi-legend");
  const defender = plainUnit(player.id, "lone-defender", 2);
  const attacker = plainUnit(opponent.id, "opposing-attacker", 2);
  defender.combatRole = "defender";
  attacker.combatRole = "attacker";
  const field = battlefield("yi-defense-field", [defender, attacker], opponent.id);
  game.battlefields = [field];

  assert.equal(currentCombatMight(game, field, defender, "defender"), 4);
});

test("Leona, Zealot reduces a stunned enemy by 8 Might but never below 1", () => {
  const game = ruleGame();
  const player = game.players[0];
  const opponent = game.players[1];
  const leona = instance(cards.leonaZealot, player.id, "leona-zealot");
  const stunnedEnemy = plainUnit(opponent.id, "stunned-enemy", 5);
  stunnedEnemy.stunned = true;
  const field = battlefield("leona-field", [leona, stunnedEnemy], player.id);
  game.battlefields = [field];

  assert.equal(currentMight(game, stunnedEnemy), 1);
  assert.equal(currentCombatMight(game, field, stunnedEnemy, "defender"), 1);
});

test("Heimerdinger, Inventor copies a friendly activated ability", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const opponent = game.players[1];
  const heimerdinger = instance(cards.heimerdingerInventor, player.id, "heimerdinger-inventor");
  const ballista = instance(cards.ironBallista, player.id, "friendly-ballista");
  const target = plainUnit(opponent.id, "copied-ability-target", 8);
  player.base = [heimerdinger, ballista];
  game.battlefields = [battlefield("copied-ability-field", [target], opponent.id)];

  assert.equal(activateCard(game, heimerdinger.instanceId).ok, true);
  assert.equal(target.damage, 2);
});

test("Heimerdinger chooses one copied activated ability instead of resolving all of them", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const heimerdinger = instance(cards.heimerdingerInventor, player.id, "heimerdinger-choice");
  const ballista = instance(cards.ironBallista, player.id, "heimerdinger-choice-ballista");
  const tome = instance(cards.ravenbornTome, player.id, "heimerdinger-choice-tome");
  const target = plainUnit(opponent.id, "heimerdinger-choice-target", 8);
  player.base = [heimerdinger, ballista, tome];
  game.battlefields = [battlefield("heimerdinger-choice-field", [target], opponent.id)];

  assert.equal(activateCard(game, heimerdinger.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedAbility");
  const ballistaAbility = game.pendingChoice.options.find((option) => option.label.includes(ballista.name));
  assert.ok(ballistaAbility);
  assert.equal(chooseEffectOption(game, ballistaAbility.id).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);

  assert.equal(target.damage, 2);
  assert.equal(player.nextSpellBonusDamage || 0, 0);
  assert.equal(heimerdinger.exhausted, true);
});

test("Kayn, Unleashed prevents damage after his second move in a turn", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const kayn = instance(cards.kaynUnleashed, player.id, "kayn-unleashed");
  const first = battlefield("kayn-field-1", [], player.id);
  const second = battlefield("kayn-field-2", [], player.id);
  player.base = [kayn];
  game.battlefields = [first, second];

  assert.equal(moveUnits(game, [kayn.instanceId], first.instanceId).ok, true);
  kayn.exhausted = false;
  assert.equal(moveUnits(game, [kayn.instanceId], second.instanceId).ok, true);
  assert.equal(kayn.movesThisTurn, 2);
  assert.equal(applyDamage(game, player, { ...plainUnit(player.id, "damage-source"), type: "spell" }, kayn, 5), 0);
  assert.equal(kayn.damage, 0);
});

test("Ahri, Nine-Tailed Fox uses the showdown chain and keeps its Might reduction above the minimum", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const attacker = plainUnit(player.id, "ahri-attacker", 1);
  attacker.keywords = ["Assault"];
  const defender = plainUnit(opponent.id, "ahri-defender", 8);
  opponent.legend = instance(cards.ahriNineTailedFox, opponent.id, "ahri-legend");
  player.base = [attacker];
  game.battlefields = [battlefield("ahri-controlled-field", [defender], opponent.id)];

  assert.equal(moveUnits(game, [attacker.instanceId], "ahri-controlled-field").ok, true);
  assert.equal(attacker.temporaryMight, undefined, "the trigger must not resolve as part of attack designation");
  assert.equal(game.showdown?.chain.some((item) =>
    item.trigger?.kind === "attackOrDefendModifyUnit" && item.trigger.sourceCardId === "ahri-legend"), true);

  assert.equal(advanceUntil(game, () => attacker.temporaryMight === -1), true);
  assert.equal(currentMight(game, attacker), 1);
  assert.equal(attacker.temporaryMight, -1);
  delete attacker.combatRole;
  assert.equal(currentMight(game, attacker), 1, "losing Assault must not let Ahri's effect reduce Might below 1");
});

test("Symbol of the Solari recalls every unit after an attacking combat tie", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const opponent = game.players[1];
  const symbol = instance(cards.symbolOfTheSolari, player.id, "symbol-of-the-solari");
  const attacker = plainUnit(player.id, "tied-attacker", 3);
  const defender = plainUnit(opponent.id, "tied-defender", 3);
  attacker.stunned = true;
  defender.stunned = true;
  defender.buffs = 1;
  defender.mightModifier = 2;
  defender.temporaryMight = 2;
  defender.attachments = [instance(cards.guardianAngel, opponent.id, "solari-defender-gear")];
  const field = battlefield("solari-tie-field", [attacker, defender], opponent.id);
  player.base = [symbol];
  game.battlefields = [field];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    attackerId: player.id,
    defenderId: opponent.id,
    turnPlayerId: player.id,
    priorityPlayerId: player.id,
    combat: true,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(field.units.length, 0);
  assert.equal(player.base.some((card) => card.instanceId === attacker.instanceId), true);
  assert.equal(opponent.base.some((card) => card.instanceId === defender.instanceId), true);
  assert.equal(defender.exhausted, false);
  assert.equal(defender.stunned, true);
  assert.equal(defender.buffs, 1);
  assert.equal(defender.mightModifier, 2);
  assert.equal(defender.temporaryMight, 2);
  assert.deepEqual(defender.attachments.map((card) => card.instanceId), ["solari-defender-gear"]);
  assert.equal(field.controlledBy, null);
});

test("Commander Ledros and Kraken Hunter derive optional cost declarations from static effects", () => {
  {
    const game = ruleGame({ interactive: true });
    const player = game.players[0];
    const ledros = instance(cards.commanderLedros, player.id, "commander-ledros");
    const sacrifice = plainUnit(player.id, "ledros-sacrifice");
    player.hand = [ledros];
    player.base = [sacrifice];
    player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.ORDER, player.id, `ledros-cost-${index}`));
    assert.equal(beginPlayCard(game, ledros.instanceId, "base").ok, true);
    assert.equal(game.pendingChoice?.data?.targetEffect, "killFriendlyUnitsAdditionalCost");
    assert.equal(game.pendingChoice?.options.some((option) => option.cardId === sacrifice.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: true });
    const player = game.players[0];
    const hunter = instance(cards.krakenHunter, player.id, "kraken-hunter");
    const buffed = plainUnit(player.id, "kraken-buff-source");
    buffed.buffs = 1;
    player.hand = [hunter];
    player.base = [buffed];
    player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.BODY, player.id, `hunter-cost-${index}`));
    assert.equal(beginPlayCard(game, hunter.instanceId, "base").ok, true);
    assert.equal(game.pendingChoice?.data?.targetEffect, "spendFriendlyBuffsAdditionalCost");
    assert.equal(game.pendingChoice?.options.some((option) => option.cardId === buffed.instanceId), true);
  }
});

test("static entry permissions and restrictions follow their declared shared effects", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const deckhand = freeToPlay(instance(cards.sneakyDeckhand, player.id, "sneaky-deckhand"));
    const open = battlefield("deckhand-open-field");
    player.hand = [deckhand];
    game.battlefields = [open];
    assert.equal(playCard(game, deckhand.instanceId, open.instanceId).ok, true);
    assert.equal(open.units.some((unit) => unit.instanceId === deckhand.instanceId), true);
    assert.equal(open.controlledBy, player.id);
    assert.equal(player.score, 1, "playing to an open battlefield conquers it");
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const buccaneer = instance(cards.missFortuneBuccaneer, player.id, "miss-fortune-buccaneer");
    const ally = plainUnit(player.id, "buccaneer-open-ally");
    const open = battlefield("buccaneer-open-field");
    player.base = [buccaneer];
    player.hand = [ally];
    game.battlefields = [open];
    assert.equal(playCard(game, ally.instanceId, open.instanceId).ok, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const warden = instance(cards.mageseekerWarden, opponent.id, "mageseeker-warden");
    const ally = plainUnit(player.id, "restricted-unit");
    const occupied = battlefield("warden-field", [warden], opponent.id);
    const friendly = battlefield("restricted-friendly-field", [], player.id);
    player.hand = [ally];
    game.battlefields = [occupied, friendly];
    assert.equal(playCard(game, ally.instanceId, friendly.instanceId).ok, false);
    assert.equal(player.hand.some((card) => card.instanceId === ally.instanceId), true);
  }
});

test("static ready-entry effects work for self, board condition, and friendly aura", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const yi = freeToPlay(instance(cards.masterYiHoned, player.id, "master-yi-honed"));
    player.hand = [yi];
    assert.equal(playCard(game, yi.instanceId, "base").ok, true);
    assert.equal(yi.exhausted, false);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const vayne = freeToPlay(instance(cards.vayneHunter, player.id, "vayne-ready-entry"));
    game.battlefields = [battlefield("enemy-controlled-field", [], opponent.id)];
    player.hand = [vayne];
    assert.equal(playCard(game, vayne.instanceId, "base").ok, true);
    assert.equal(vayne.exhausted, false);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const wurm = instance(cards.magmaWurm, player.id, "magma-wurm");
    const ally = plainUnit(player.id, "magma-ready-ally");
    player.base = [wurm];
    player.hand = [ally];
    assert.equal(playCard(game, ally.instanceId, "base").ok, true);
    assert.equal(ally.exhausted, false);
  }
});

test("a battlefield Eager Apprentice reduces a spell's Energy cost to its minimum", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const apprentice = instance(cards.eagerApprentice, player.id, "eager-apprentice");
  const spell = plainSpell(player.id, "two-energy-spell", 2);
  game.battlefields = [battlefield("apprentice-field", [apprentice], player.id)];
  player.hand = [spell];
  player.runes = [rune(DOMAINS.MIND, player.id, "apprentice-rune")];

  assert.equal(playCard(game, spell.instanceId, "base").ok, true);
  assert.equal(player.runes[0].exhausted, true);
});

test("dynamic static Might modifiers are applied from units, legends, trash, buffs, and battlefields", () => {
  {
    const game = ruleGame();
    const player = game.players[0];
    const lee = instance(cards.leeSinCentered, player.id, "lee-sin-centered");
    const ally = plainUnit(player.id, "lee-buffed-ally", 2);
    ally.buffs = 1;
    player.base = [lee, ally];
    assert.equal(currentMight(game, ally), 5);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const sett = instance(cards.settKingpin, player.id, "sett-kingpin");
    const first = plainUnit(player.id, "sett-buffed-1");
    const second = plainUnit(player.id, "sett-buffed-2");
    first.buffs = 1;
    second.buffs = 1;
    player.base = [sett, first, second];
    assert.equal(currentMight(game, sett), sett.might + 2);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const draven = instance(cards.dravenShowboat, player.id, "draven-showboat");
    player.score = 3;
    player.base = [draven];
    assert.equal(currentMight(game, draven), draven.might + 3);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const mundo = instance(cards.drMundoExpert, player.id, "mundo-expert");
    player.base = [mundo];
    player.trash = [plainSpell(player.id, "mundo-trash-1"), plainSpell(player.id, "mundo-trash-2")];
    assert.equal(currentMight(game, mundo), mundo.might + 2);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const wielder = instance(cards.wielderOfWater, player.id, "wielder-of-water");
    wielder.combatRole = "attacker";
    const field = battlefield("wielder-field", [wielder], player.id);
    game.battlefields = [field];
    assert.equal(currentMight(game, wielder), wielder.might + 2);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const elder = instance(cards.wizenedElder, player.id, "wizened-elder");
    elder.buffs = 1;
    player.base = [elder];
    assert.equal(currentMight(game, elder), elder.might + 2);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const camp = { ...instance(cards.trifarianWarCamp, player.id, "trifarian-war-camp"), units: [], hidden: [], controlledBy: player.id };
    const unit = plainUnit(player.id, "war-camp-unit", 2);
    camp.units = [unit];
    game.battlefields = [camp];
    assert.equal(currentMight(game, unit), 3);
  }
});

test("conditional and shared static keywords affect combat, movement, and Deflect targeting", () => {
  {
    const game = ruleGame();
    const player = game.players[0];
    const soul = instance(cards.ragingSoul, player.id, "raging-soul");
    player.discardedCardsThisTurn = 1;
    const field = battlefield("raging-soul-field", [soul], player.id);
    game.battlefields = [field];
    assert.equal(currentCombatMight(game, field, soul, "attacker"), currentMight(game, soul) + 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const bully = instance(cards.bilgewaterBully, player.id, "bilgewater-bully");
    bully.buffs = 1;
    const source = battlefield("bully-source", [bully], player.id);
    const destination = battlefield("bully-destination", [], player.id);
    game.battlefields = [source, destination];
    assert.equal(moveUnits(game, [bully.instanceId], destination.instanceId).ok, true);
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const fiora = instance(cards.fioraVictorious, player.id, "fiora-victorious");
    player.legend.effects = [];
    fiora.buffs = 1;
    const field = battlefield("fiora-field", [fiora], player.id);
    game.battlefields = [field];
    assert.equal(currentMight(game, fiora), 5);
    fiora.combatRole = "defender";
    assert.equal(currentCombatMight(game, field, fiora, "defender"), 6);
    assert.equal(currentMight(game, fiora), 6);
    fiora.buffs = 0;
    assert.equal(currentMight(game, fiora), 4, "Mighty-granted Shield cannot keep its own Mighty condition active");
  }

  {
    const game = ruleGame();
    const player = game.players[0];
    const farron = instance(cards.captainFarron, player.id, "captain-farron");
    const ally = plainUnit(player.id, "farron-ally", 2);
    const field = battlefield("farron-field", [farron, ally], player.id);
    game.battlefields = [field];
    assert.equal(currentCombatMight(game, field, ally, "attacker"), 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const unit = plainUnit(player.id, "hillock-ganking-unit");
    const hillock = { ...instance(cards.windsweptHillock, player.id, "windswept-hillock"), units: [unit], hidden: [], controlledBy: player.id };
    const destination = battlefield("hillock-destination", [], player.id);
    game.battlefields = [hillock, destination];
    assert.equal(moveUnits(game, [unit.instanceId], destination.instanceId).ok, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const refuge = instance(cards.spiritsRefuge, player.id, "spirits-refuge");
    const protectedUnit = plainUnit(player.id, "refuge-protected-unit", 5);
    protectedUnit.buffs = 1;
    player.base = [refuge];
    game.battlefields = [battlefield("refuge-field", [protectedUnit], player.id)];
    resolveEffect(game, opponent, instance(cards.incinerate, opponent.id, "refuge-incinerate"));
    assert.equal(protectedUnit.damage, 0);
  }
});

test("Spirit's Refuge on-play effect explicitly buffs a friendly unit", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const refuge = freeToPlay(instance(cards.spiritsRefuge, player.id, "played-spirits-refuge"));
  const target = plainUnit(player.id, "refuge-buff-target");
  player.base = [target];
  player.hand = [refuge];

  assert.equal(playCard(game, refuge.instanceId, "base").ok, true);
  assert.equal(target.buffs, 1);
});

test("Dr. Mundo, Expert recycles three trash cards at the Beginning Phase", () => {
  const game = ruleGame({ interactive: false });
  const player = game.players[0];
  const mundo = instance(cards.drMundoExpert, player.id, "beginning-mundo");
  player.base = [mundo];
  player.trash = [
    plainSpell(player.id, "mundo-recycle-1"),
    plainSpell(player.id, "mundo-recycle-2"),
    plainSpell(player.id, "mundo-recycle-3")
  ];
  player.mainDeck = [
    plainUnit(player.id, "mundo-existing-deck-1"),
    plainUnit(player.id, "mundo-existing-deck-2")
  ];

  startTurn(game);
  assert.equal(player.trash.length, 0);
  assert.equal(player.hand.length, 1);
  assert.equal(player.mainDeck.length, 4);
  assert.equal(player.mainDeck.filter((card) => card.instanceId.startsWith("mundo-recycle-")).length, 3);
});

test("Beginning recycle effects explicitly choose every card instead of using trash order", () => {
  const game = ruleGame({ interactive: true });
  const player = game.players[0];
  const mundo = instance(cards.drMundoExpert, player.id, "beginning-choice-mundo");
  const keep = plainSpell(player.id, "mundo-choice-keep");
  const selected = [
    plainSpell(player.id, "mundo-choice-1"),
    plainSpell(player.id, "mundo-choice-2"),
    plainSpell(player.id, "mundo-choice-3")
  ];
  player.base = [mundo];
  player.trash = [keep, ...selected];
  player.mainDeck = [plainUnit(player.id, "mundo-choice-existing-deck")];

  startTurn(game);
  for (let step = 0; step < 8 && game.pendingChoice?.effect !== "recycleTrashCards"; step += 1) {
    const priorityPlayerId = game.actionChain?.priorityPlayerId || game.showdown?.priorityPlayerId;
    if (!priorityPlayerId) break;
    assert.equal(passShowdown(game, priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "recycleTrashCards");
  for (const card of [selected[2], selected[0], selected[1]]) {
    assert.equal(chooseEffectOption(game, card.instanceId).ok, true);
  }
  assert.deepEqual(player.trash.map((card) => card.instanceId), [keep.instanceId]);
  for (const card of selected) {
    assert.equal([...player.mainDeck, ...player.hand].some((candidate) => candidate.instanceId === card.instanceId), true);
  }
});

test("activated shared resolvers buff, grant keywords, kill, move, ready entry, create tokens, return tags, and prepare saves", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const lee = instance(cards.leeSinAscetic, player.id, "activated-lee-sin");
    player.base = [lee];
    assert.equal(activateCard(game, lee.instanceId).ok, true);
    assert.equal(lee.buffs, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const target = plainUnit(player.id, "activated-keyword-target");
    const missFortune = instance(cards.missFortuneBountyHunter, player.id, "activated-miss-fortune");
    missFortune.type = "unit";
    player.base = [target, missFortune];
    assert.equal(activateCard(game, missFortune.instanceId).ok, true);
    assert.equal(target.temporaryKeywords?.includes("Ganking"), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const trove = instance(cards.treasureTrove, player.id, "activated-treasure-trove");
    player.base = [trove];
    player.mainDeck = [plainSpell(player.id, "treasure-trove-draw")];
    player.runes = [rune(DOMAINS.CHAOS, player.id, "trove-power-rune")];
    assert.equal(activateCard(game, trove.instanceId).ok, true);
    assert.equal(player.trash.some((card) => card.instanceId === trove.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const yasuo = instance(cards.yasuoUnforgiven, player.id, "activated-yasuo");
    yasuo.type = "unit";
    const ally = plainUnit(player.id, "yasuo-move-target");
    const destination = battlefield("yasuo-move-field", [], player.id);
    player.base = [ally, yasuo];
    player.runes = [
      rune(DOMAINS.CALM, player.id, "yasuo-rune-1"),
      rune(DOMAINS.CALM, player.id, "yasuo-rune-2")
    ];
    game.battlefields = [destination];
    assert.equal(activateCard(game, yasuo.instanceId).ok, true);
    assert.equal(destination.units.some((unit) => unit.instanceId === ally.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const disc = instance(cards.sunDisc, player.id, "activated-sun-disc");
    const next = plainUnit(player.id, "sun-disc-ready-unit");
    player.base = [disc];
    player.cardsPlayedThisTurn = 1;
    assert.equal(activateCard(game, disc.instanceId).ok, true);
    assert.equal(player.nextUnitEnterReady, true);
    player.hand = [next];
    assert.equal(playCard(game, next.instanceId, "base").ok, true);
    assert.equal(next.exhausted, false);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const viktor = instance(cards.viktorHeraldOfTheArcane, player.id, "activated-viktor");
    viktor.type = "unit";
    player.base = [viktor];
    player.runes = [rune(DOMAINS.MIND, player.id, "viktor-rune")];
    assert.equal(activateCard(game, viktor.instanceId).ok, true);
    assert.equal(player.base.filter((card) => card.cardNumber === "OGN-273/298").length, 1);
    assert.equal(viktor.exhausted, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const teemoUnit = plainUnit(player.id, "owned-teemo-unit");
    teemoUnit.tags = ["Teemo"];
    const teemo = instance(cards.teemoSwiftScout, player.id, "activated-teemo");
    teemo.type = "unit";
    player.base = [teemoUnit, teemo];
    player.runes = [rune(DOMAINS.CALM, player.id, "teemo-rune")];
    assert.equal(activateCard(game, teemo.instanceId).ok, true);
    assert.equal(player.hand.some((card) => card.instanceId === teemoUnit.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const armory = instance(cards.unlicensedArmory, player.id, "activated-armory");
    const saved = plainUnit(player.id, "armory-saved-unit");
    const discarded = plainSpell(player.id, "armory-discard-cost");
    player.base = [saved, armory];
    player.hand = [discarded];
    assert.equal(activateCard(game, armory.instanceId).ok, true);
    assert.equal(saved.saveWithRuneUntilTurnSequence, game.turnSequence);
    assert.equal(saved.saveWithRuneDomain, DOMAINS.FURY);
    assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  }
});

test("Beginning, first-Beginning, hold, and end-turn effects resolve through their shared trigger queue", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const pouch = instance(cards.mushroomPouch, player.id, "mushroom-pouch");
    const field = battlefield("hidden-control-field", [], player.id);
    field.hidden = [{ card: plainSpell(player.id, "hidden-card"), ownerId: player.id, playableFromTurnSequence: 0 }];
    player.base = [pouch];
    player.mainDeck = [plainUnit(player.id, "pouch-draw-1"), plainUnit(player.id, "pouch-draw-2")];
    game.battlefields = [field];
    startTurn(game);
    assert.equal(player.hand.length, 2);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    player.legend = instance(cards.jinxLooseCannon, player.id, "jinx-loose-cannon");
    player.hand = [plainSpell(player.id, "jinx-small-hand")];
    player.mainDeck = [plainUnit(player.id, "jinx-draw-1"), plainUnit(player.id, "jinx-draw-2")];
    startTurn(game);
    assert.equal(player.hand.length, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const obelisk = { ...instance(cards.obeliskOfPower, player.id, "obelisk-of-power"), units: [], hidden: [], controlledBy: player.id };
    player.hasTakenFirstTurn = false;
    player.runeDeck = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.ORDER, player.id, `obelisk-rune-${index}`));
    game.battlefields = [obelisk];
    startTurn(game);
    assert.equal(player.runes.length, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const unit = plainUnit(player.id, "navori-buff-target");
    const pit = { ...instance(cards.navoriFightingPit, player.id, "navori-fighting-pit"), units: [unit], hidden: [], controlledBy: player.id };
    player.mainDeck = [plainUnit(player.id, "navori-turn-draw")];
    game.battlefields = [pit];
    startTurn(game);
    assert.equal(unit.buffs, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const peak = { ...instance(cards.startippedPeak, player.id, "startipped-peak"), units: [], hidden: [], controlledBy: player.id };
    player.runeDeck = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CALM, player.id, `peak-rune-${index}`));
    game.battlefields = [peak];
    startTurn(game);
    assert.equal(player.runes.length, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const ahri = instance(cards.ahriAlluring, player.id, "ahri-alluring");
    game.battlefields = [battlefield("ahri-hold-field", [ahri], player.id)];
    startTurn(game);
    assert.equal(player.score, 2);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const altar = { ...instance(cards.altarToUnity, player.id, "altar-to-unity"), units: [], hidden: [], controlledBy: player.id };
    game.battlefields = [altar];
    startTurn(game);
    assert.equal(player.base.filter((card) => card.cardNumber === "OGN-273/298").length, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    player.legend = instance(cards.annieDarkChild, player.id, "annie-dark-child");
    player.runes = [
      rune(DOMAINS.CHAOS, player.id, "annie-ready-rune-1"),
      rune(DOMAINS.CHAOS, player.id, "annie-ready-rune-2")
    ];
    for (const resource of player.runes) resource.exhausted = true;
    opponent.mainDeck = [plainUnit(opponent.id, "opponent-turn-draw")];
    assert.equal(endTurn(game).ok, true);
    assert.equal(player.runes.every((resource) => resource.exhausted === false), true);
  }
});

test("card-played triggers observe the played card, ordinal, and actual turn owner", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const cithria = instance(cards.cithriaOfCloudfield, player.id, "cithria-cloudfield");
    const unit = plainUnit(player.id, "cithria-other-unit");
    player.base = [cithria];
    player.hand = [unit];
    assert.equal(playCard(game, unit.instanceId, "base").ok, true);
    assert.equal(cithria.buffs, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const crew = instance(cards.pitCrew, player.id, "pit-crew");
    crew.exhausted = true;
    const gear = plainGear(player.id, "pit-crew-gear");
    player.base = [crew];
    player.hand = [gear];
    assert.equal(playCard(game, gear.instanceId, "base").ok, true);
    assert.equal(crew.exhausted, false);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const lux = instance(cards.luxIlluminated, player.id, "lux-illuminated");
    const spell = plainSpell(player.id, "lux-five-energy-spell", 5);
    player.base = [lux];
    player.hand = [spell];
    player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.CALM, player.id, `lux-buff-rune-${index}`));
    assert.equal(playCard(game, spell.instanceId, "base").ok, true);
    assert.equal(lux.temporaryMight, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    player.legend = instance(cards.luxLadyOfLuminosity, player.id, "lux-lady-luminosity");
    const spell = plainSpell(player.id, "lux-draw-five-energy-spell", 5);
    const drawn = plainUnit(player.id, "lux-high-cost-draw");
    player.hand = [spell];
    player.mainDeck = [drawn];
    player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.ORDER, player.id, `lux-draw-rune-${index}`));
    assert.equal(playCard(game, spell.instanceId, "base").ok, true);
    assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const viktor = instance(cards.viktorInnovator, player.id, "viktor-innovator");
    const reaction = plainSpell(player.id, "opponent-turn-reaction");
    reaction.tags = ["Reaction"];
    reaction.keywords = ["Reaction"];
    player.base = [viktor];
    player.hand = [reaction];
    game.phase = "showdown";
    game.currentPlayerId = player.id;
    game.showdown = {
      battlefieldId: "opponent-turn-field",
      attackerId: opponent.id,
      defenderId: player.id,
      turnPlayerId: opponent.id,
      priorityPlayerId: player.id,
      focusPlayerId: player.id,
      combat: false,
      consecutivePasses: 0,
      chain: []
    };
    assert.equal(playCard(game, reaction.instanceId, "base").ok, true);
    for (let index = 0; index < 6 && game.showdown && !player.base.some((card) => card.cardNumber === "OGN-273/298"); index += 1) {
      assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    }
    assert.equal(player.base.filter((card) => card.cardNumber === "OGN-273/298").length, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const darius = instance(cards.dariusTrifarian, player.id, "darius-trifarian");
    darius.exhausted = true;
    const second = plainGear(player.id, "darius-second-card");
    player.base = [darius];
    player.hand = [second];
    player.cardsPlayedThisTurn = 1;
    assert.equal(playCard(game, second.instanceId, "base").ok, true);
    assert.equal(darius.exhausted, false);
    assert.equal(darius.mightModifier, 2);
    assert.equal(darius.temporaryMight, 2);
  }
});

test("attack and defend trigger resolvers apply their declared damage, Might, and stun outcomes", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const anivia = instance(cards.aniviaPrimal, player.id, "anivia-primal");
    const first = plainUnit(opponent.id, "anivia-target-1", 20);
    const second = plainUnit(opponent.id, "anivia-target-2", 20);
    player.base = [anivia];
    game.battlefields = [battlefield("anivia-field", [first, second], opponent.id)];
    assert.equal(moveUnits(game, [anivia.instanceId], "anivia-field").ok, true);
    assert.equal(advanceUntil(game, () => first.damage === 3 && second.damage === 3), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const corsair = instance(cards.crackshotCorsair, player.id, "crackshot-corsair");
    const target = plainUnit(opponent.id, "corsair-target", 20);
    player.base = [corsair];
    game.battlefields = [battlefield("corsair-field", [target], opponent.id)];
    assert.equal(moveUnits(game, [corsair.instanceId], "corsair-field").ok, true);
    assert.equal(advanceUntil(game, () => target.damage === 1), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const ahri = instance(cards.ahriInquisitive, player.id, "ahri-inquisitive");
    const target = plainUnit(opponent.id, "ahri-inquisitive-target", 5);
    player.base = [ahri];
    game.battlefields = [battlefield("ahri-inquisitive-field", [target], opponent.id)];
    assert.equal(moveUnits(game, [ahri.instanceId], "ahri-inquisitive-field").ok, true);
    assert.equal(advanceUntil(game, () => target.temporaryMight === -2), true);
    assert.equal(currentMight(game, target), 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const drake = instance(cards.duneDrake, player.id, "dune-drake");
    const target = plainUnit(opponent.id, "dune-ready-enemy", 20);
    player.base = [drake];
    game.battlefields = [battlefield("dune-drake-field", [target], opponent.id)];
    assert.equal(moveUnits(game, [drake.instanceId], "dune-drake-field").ok, true);
    assert.equal(advanceUntil(game, () => drake.temporaryMight === 2), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const leona = instance(cards.leonaDetermined, player.id, "leona-determined");
    const target = plainUnit(opponent.id, "leona-stun-target", 20);
    player.base = [leona];
    game.battlefields = [battlefield("leona-attack-field", [target], opponent.id)];
    assert.equal(moveUnits(game, [leona.instanceId], "leona-attack-field").ok, true);
    assert.equal(advanceUntil(game, () => target.stunned === true), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const mask = instance(cards.maskOfForesight, player.id, "mask-of-foresight");
    const attacker = plainUnit(player.id, "mask-lone-attacker", 3);
    const target = plainUnit(opponent.id, "mask-enemy", 20);
    player.base = [mask, attacker];
    game.battlefields = [battlefield("mask-field", [target], opponent.id)];
    assert.equal(moveUnits(game, [attacker.instanceId], "mask-field").ok, true);
    assert.equal(advanceUntil(game, () => attacker.temporaryMight === 1), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const attacker = plainUnit(player.id, "teemo-hidden-attacker", 20);
    const teemo = instance(cards.teemoStrategist, opponent.id, "teemo-strategist");
    player.base = [attacker];
    opponent.mainDeck = Array.from({ length: 5 }, (_, index) => {
      const card = plainSpell(opponent.id, `teemo-reveal-${index}`);
      if (index < 2) card.keywords = ["Hidden"];
      return card;
    });
    game.battlefields = [battlefield("teemo-strategist-field", [teemo], opponent.id)];
    assert.equal(moveUnits(game, [attacker.instanceId], "teemo-strategist-field").ok, true);
    assert.equal(advanceUntil(game, () => attacker.damage === 2), true);
  }
});

test("move, conquer, and conquer-here effects preserve their event-specific outcomes", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const drummer = instance(cards.noxianDrummer, player.id, "noxian-drummer");
    const field = battlefield("drummer-field", [], player.id);
    player.base = [drummer];
    game.battlefields = [field];
    assert.equal(moveUnits(game, [drummer.instanceId], field.instanceId).ok, true);
    assert.equal(field.units.filter((unit) => unit.cardNumber === "OGN-273/298").length, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const sett = freeToPlay(instance(cards.settBrawler, player.id, "sett-on-play"));
    player.hand = [sett];
    assert.equal(playCard(game, sett.instanceId, "base").ok, true);
    assert.equal(sett.buffs, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const sett = instance(cards.settBrawler, player.id, "sett-conquer");
    player.base = [sett];
    game.battlefields = [battlefield("sett-conquer-field", [], opponent.id)];
    assert.equal(moveUnits(game, [sett.instanceId], "sett-conquer-field").ok, true);
    assert.equal(advanceUntil(game, () => sett.buffs === 1), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const qiyana = instance(cards.qiyanaVictorious, player.id, "qiyana-victorious");
    const drawn = plainUnit(player.id, "qiyana-conquer-draw");
    player.base = [qiyana];
    player.mainDeck = [drawn];
    game.battlefields = [battlefield("qiyana-field", [], opponent.id)];
    assert.equal(moveUnits(game, [qiyana.instanceId], "qiyana-field").ok, true);
    assert.equal(advanceUntil(game, () => player.hand.some((card) => card.instanceId === drawn.instanceId)), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const adaptatron = instance(cards.adaptatron, player.id, "adaptatron");
    const gear = plainGear(player.id, "adaptatron-gear");
    player.base = [adaptatron, gear];
    game.battlefields = [battlefield("adaptatron-field", [], opponent.id)];
    assert.equal(moveUnits(game, [adaptatron.instanceId], "adaptatron-field").ok, true);
    assert.equal(advanceUntil(game, () => adaptatron.buffs === 1), true);
    assert.equal(player.trash.some((card) => card.instanceId === gear.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const tryndamere = instance(cards.tryndamereBarbarian, player.id, "tryndamere-barbarian");
    const defender = plainUnit(opponent.id, "tryndamere-defender", 2);
    player.base = [tryndamere];
    game.battlefields = [battlefield("tryndamere-field", [defender], opponent.id)];
    assert.equal(moveUnits(game, [tryndamere.instanceId], "tryndamere-field").ok, true);
    assert.equal(advanceUntil(game, () => player.score === 2), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const conqueror = plainUnit(player.id, "zaun-conqueror");
    const discarded = plainSpell(player.id, "zaun-discard");
    const drawn = plainUnit(player.id, "zaun-draw");
    const warrens = { ...instance(cards.zaunWarrens, opponent.id, "zaun-warrens"), units: [], hidden: [], controlledBy: opponent.id };
    player.base = [conqueror];
    player.hand = [discarded];
    player.mainDeck = [drawn];
    game.battlefields = [warrens];
    assert.equal(moveUnits(game, [conqueror.instanceId], warrens.instanceId).ok, true);
    assert.equal(advanceUntil(game, () => player.hand.some((card) => card.instanceId === drawn.instanceId)), true);
    assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const conqueror = plainUnit(player.id, "sigil-conqueror");
    const resource = rune(DOMAINS.FURY, player.id, "sigil-recycled-rune");
    const sigil = { ...instance(cards.sigilOfTheStorm, opponent.id, "sigil-of-storm"), units: [], hidden: [], controlledBy: opponent.id };
    player.base = [conqueror];
    player.runes = [resource];
    game.battlefields = [sigil];
    assert.equal(moveUnits(game, [conqueror.instanceId], sigil.instanceId).ok, true);
    assert.equal(advanceUntil(game, () => player.runeDeck.some((card) => card.instanceId === resource.instanceId)), true);
    assert.equal(player.runes.length, 0);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const aurora = instance(cards.dazzlingAurora, player.id, "dazzling-aurora");
    const skippedSpell = plainSpell(player.id, "dazzling-aurora-skipped");
    const expensiveUnit = plainUnit(player.id, "dazzling-aurora-unit", 4);
    expensiveUnit.energy = 99;
    player.base = [aurora];
    player.mainDeck = [skippedSpell, expensiveUnit];

    assert.equal(endTurn(game).ok, true);
    assert.equal(player.base.some((card) => card.instanceId === expensiveUnit.instanceId), true);
    assert.equal(player.banished.some((card) => card.instanceId === expensiveUnit.instanceId), false);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const seer = freeToPlay(instance(cards.gemcraftSeer, player.id, "nocturne-gemcraft-seer"));
    const nocturne = instance(cards.nocturneHorrifying, player.id, "nocturne-horrifying");
    player.hand = [seer];
    player.mainDeck = [nocturne];
    player.runes = [rune(DOMAINS.MIND, player.id, "nocturne-energy-rune")];

    assert.equal(playCard(game, seer.instanceId, "base").ok, true);
    assert.equal(player.base.some((card) => card.instanceId === nocturne.instanceId), true);
    assert.equal(player.runes.some((card) => card.instanceId === "nocturne-energy-rune"), false);
    assert.equal(player.runeDeck.some((card) => card.instanceId === "nocturne-energy-rune"), true);
  }
});

test("Deathknell, discard, stun, and stunned-kill triggers resolve from the shared queue", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const kogMaw = instance(cards.kogMawCaustic, player.id, "kogmaw-caustic");
    const survivor = plainUnit(player.id, "kogmaw-survivor", 10);
    game.battlefields = [battlefield("kogmaw-field", [kogMaw, survivor], player.id)];
    resolveEffect(game, opponent, instance(cards.finalSpark, opponent.id, "kogmaw-final-spark"));
    assert.equal(survivor.damage, 4);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const agent = instance(cards.undercoverAgent, player.id, "undercover-agent");
    const discarded = [plainSpell(player.id, "agent-discard-1"), plainSpell(player.id, "agent-discard-2")];
    const drawn = [plainUnit(player.id, "agent-draw-1"), plainUnit(player.id, "agent-draw-2")];
    player.hand = [...discarded];
    player.mainDeck = [...drawn];
    game.battlefields = [battlefield("agent-field", [agent], player.id)];
    resolveEffect(game, opponent, instance(cards.finalSpark, opponent.id, "agent-final-spark"));
    assert.equal(discarded.every((card) => player.trash.some((entry) => entry.instanceId === card.instanceId)), true);
    assert.equal(drawn.every((card) => player.hand.some((entry) => entry.instanceId === card.instanceId)), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const evangel = instance(cards.machineEvangel, player.id, "machine-evangel");
    game.battlefields = [battlefield("evangel-field", [evangel], player.id)];
    resolveEffect(game, opponent, instance(cards.finalSpark, opponent.id, "evangel-final-spark"));
    assert.equal(player.base.filter((card) => card.cardNumber === "OGN-273/298").length, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const ekko = instance(cards.ekkoRecurrent, player.id, "ekko-recurrent");
    player.runes = [rune(DOMAINS.MIND, player.id, "ekko-rune-1"), rune(DOMAINS.MIND, player.id, "ekko-rune-2")];
    for (const resource of player.runes) resource.exhausted = true;
    game.battlefields = [battlefield("ekko-field", [ekko], player.id)];
    resolveEffect(game, opponent, instance(cards.finalSpark, opponent.id, "ekko-final-spark"));
    assert.equal(player.trash.some((card) => card.instanceId === ekko.instanceId), false);
    assert.equal(player.mainDeck.some((card) => card.instanceId === ekko.instanceId), true);
    assert.equal(player.runes.every((resource) => resource.exhausted === false), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const jinx = instance(cards.jinxRebel, player.id, "jinx-rebel");
    const enforcer = freeToPlay(instance(cards.chemtechEnforcer, player.id, "jinx-enforcer"));
    const discarded = plainSpell(player.id, "jinx-discarded-card");
    jinx.exhausted = true;
    player.base = [jinx];
    player.hand = [enforcer, discarded];
    assert.equal(playCard(game, enforcer.instanceId, "base").ok, true);
    assert.equal(jinx.exhausted, false);
    assert.equal(jinx.mightModifier, 1);
    assert.equal(jinx.temporaryMight, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const chompers = instance(cards.flameChompers, player.id, "flame-chompers");
    const enforcer = freeToPlay(instance(cards.chemtechEnforcer, player.id, "chompers-enforcer"));
    player.hand = [enforcer, chompers];
    player.runes = [rune(DOMAINS.FURY, player.id, "chompers-power-rune")];
    assert.equal(playCard(game, enforcer.instanceId, "base").ok, true);
    assert.equal(player.base.some((card) => card.instanceId === chompers.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const herald = instance(cards.eclipseHerald, player.id, "eclipse-herald");
    const enemy = plainUnit(opponent.id, "eclipse-stun-enemy", 8);
    herald.exhausted = true;
    player.base = [herald];
    game.battlefields = [battlefield("eclipse-stun-field", [enemy], opponent.id)];
    const backOff = instance(cards.backOff, player.id, "eclipse-back-off");
    backOff.declaredPlayTargets = [{ effect: "stunUnit", targetId: enemy.instanceId }];
    resolveEffect(game, player, backOff);
    assert.equal(enemy.stunned, true);
    assert.equal(herald.exhausted, false);
    assert.equal(herald.mightModifier, 1);
    assert.equal(herald.temporaryMight, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const leona = instance(cards.leonaRadiantDawn, player.id, "leona-radiant-dawn");
    const ally = plainUnit(player.id, "leona-buff-ally");
    const enemy = plainUnit(opponent.id, "leona-stun-enemy", 8);
    player.base = [ally, leona];
    game.battlefields = [battlefield("leona-stun-field", [enemy], opponent.id)];
    const backOff = instance(cards.backOff, player.id, "leona-back-off");
    backOff.declaredPlayTargets = [{ effect: "stunUnit", targetId: enemy.instanceId }];
    resolveEffect(game, player, backOff);
    assert.equal([ally, leona].some((unit) => unit.buffs === 1), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const shrine = instance(cards.solariShrine, player.id, "solari-shrine");
    const enemy = plainUnit(opponent.id, "stunned-kill-enemy", 2);
    const drawn = plainUnit(player.id, "solari-shrine-draw");
    enemy.stunned = true;
    player.base = [shrine];
    player.mainDeck = [drawn];
    game.battlefields = [battlefield("solari-shrine-field", [enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.blastOfPower, player.id, "solari-shrine-kill"));
    assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
    assert.equal(shrine.exhausted, true);
  }
});

test("previously unconsumed attack, ready, buff, and spell-kill effects execute through shared event resolvers", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const ava = instance(cards.avaAchiever, player.id, "ava-achiever");
    const hiddenUnit = plainUnit(player.id, "ava-hidden-unit", 3);
    hiddenUnit.tags = ["Hidden"];
    hiddenUnit.keywords = ["Hidden"];
    hiddenUnit.energy = 99;
    player.base = [ava];
    player.hand = [hiddenUnit];
    player.runes = [rune(DOMAINS.MIND, player.id, "ava-mind-power")];
    game.battlefields = [battlefield("ava-field", [plainUnit(opponent.id, "ava-defender", 20)], opponent.id)];

    assert.equal(moveUnits(game, [ava.instanceId], "ava-field").ok, true);
    assert.equal(advanceUntil(game, () => game.battlefields[0].units.some((unit) => unit.instanceId === hiddenUnit.instanceId)), true);
    assert.equal(player.hand.includes(hiddenUnit), false);
    assert.equal(player.runes.length, 0);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const twistedFate = instance(cards.twistedFateGambler, player.id, "twisted-fate-gambler");
    const drawn = plainSpell(player.id, "twisted-fate-draw");
    const mindRune = rune(DOMAINS.MIND, player.id, "twisted-fate-mind-rune");
    player.base = [twistedFate];
    player.mainDeck = [drawn];
    player.runeDeck = [mindRune];
    game.battlefields = [battlefield("twisted-fate-field", [plainUnit(opponent.id, "twisted-fate-defender", 20)], opponent.id)];

    assert.equal(moveUnits(game, [twistedFate.instanceId], "twisted-fate-field").ok, true);
    assert.equal(advanceUntil(game, () => player.hand.includes(drawn)), true);
    assert.equal(player.runeDeck[0].instanceId, mindRune.instanceId);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const target = plainUnit(player.id, "pirates-haven-ready-target", 2);
    const haven = instance(cards.piratesHaven, player.id, "pirates-haven");
    const wallop = instance(cards.wallop, player.id, "pirates-haven-wallop");
    target.exhausted = true;
    player.base = [target, haven];
    resolveEffect(game, player, wallop);

    assert.equal(target.exhausted, false);
    assert.equal(currentMight(game, target), 3);
    assert.equal(target.temporaryMight, 1);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const target = plainUnit(player.id, "mistfall-buff-target", 2);
    const mistfall = instance(cards.mistfall, player.id, "mistfall");
    const refuge = freeToPlay(instance(cards.spiritsRefuge, player.id, "mistfall-refuge"));
    target.exhausted = true;
    player.base = [target, mistfall];
    player.hand = [refuge];
    player.runes = [rune(DOMAINS.BODY, player.id, "mistfall-body-power")];

    assert.equal(playCard(game, refuge.instanceId, "base").ok, true);
    assert.equal(target.buffs, 1);
    assert.equal(target.exhausted, false);
    assert.equal(mistfall.exhausted, true);
    assert.equal(player.runes.length, 0);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const phoenix = instance(cards.immortalPhoenix, player.id, "immortal-phoenix");
    const victim = plainUnit(opponent.id, "phoenix-spell-victim", 2);
    player.trash = [phoenix];
    player.runes = [rune(DOMAINS.FURY, player.id, "phoenix-fury-power")];
    game.battlefields = [battlefield("phoenix-field", [victim], opponent.id)];

    resolveEffect(game, player, instance(cards.finalSpark, player.id, "phoenix-final-spark"));
    assert.equal(player.base.some((unit) => unit.instanceId === phoenix.instanceId), true);
    assert.equal(opponent.trash.some((unit) => unit.instanceId === victim.instanceId), true);
    assert.equal(player.runes.length, 0);
  }
});

test("remaining on-play effect families produce their literal shared outcomes", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const tibbers = freeToPlay(instance(cards.tibbers, player.id, "onplay-tibbers"));
    const first = plainUnit(player.id, "tibbers-friendly", 10);
    const second = plainUnit(opponent.id, "tibbers-enemy", 10);
    player.hand = [tibbers];
    game.battlefields = [battlefield("tibbers-field", [first, second], opponent.id)];
    assert.equal(playCard(game, tibbers.instanceId, "base").ok, true);
    assert.equal(first.damage, 3);
    assert.equal(second.damage, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const champion = freeToPlay(instance(cards.scrapyardChampion, player.id, "scrapyard-champion"));
    const discarded = [plainSpell(player.id, "scrapyard-discard-1"), plainSpell(player.id, "scrapyard-discard-2")];
    const drawn = [plainSpell(player.id, "scrapyard-draw-1"), plainSpell(player.id, "scrapyard-draw-2")];
    player.cardsPlayedThisTurn = 1;
    player.hand = [champion, ...discarded];
    player.mainDeck = [...drawn];
    assert.equal(playCard(game, champion.instanceId, "base").ok, true);
    assert.equal(discarded.every((card) => player.trash.includes(card)), true);
    assert.equal(drawn.every((card) => player.hand.includes(card)), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const firebrand = freeToPlay(instance(cards.ragingFirebrand, player.id, "raging-firebrand"));
    player.hand = [firebrand];
    assert.equal(playCard(game, firebrand.instanceId, "base").ok, true);
    assert.equal(player.nextSpellEnergyReduction, 5);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const shieldbearer = freeToPlay(instance(cards.solariShieldbearer, player.id, "solari-shieldbearer"));
    player.hand = [shieldbearer];
    assert.equal(playCard(game, shieldbearer.instanceId, "base").ok, true);
    assert.equal(shieldbearer.stunned, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const poro = plainUnit(player.id, "poro-herder-ally", 1);
    poro.tags = ["Poro"];
    const herder = freeToPlay(instance(cards.poroHerder, player.id, "poro-herder"));
    const drawn = plainSpell(player.id, "poro-herder-draw");
    player.base = [poro];
    player.hand = [herder];
    player.mainDeck = [drawn];
    assert.equal(playCard(game, herder.instanceId, "base").ok, true);
    assert.equal(herder.buffs, 1);
    assert.equal(player.hand.includes(drawn), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const rex = freeToPlay(instance(cards.riptideRex, player.id, "riptide-rex"));
    const enemy = plainUnit(opponent.id, "riptide-rex-target", 10);
    player.hand = [rex];
    game.battlefields = [battlefield("riptide-rex-field", [enemy], opponent.id)];
    assert.equal(playCard(game, rex.instanceId, "base").ok, true);
    assert.equal(enemy.damage, 6);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const watcher = freeToPlay(instance(cards.thousandTailedWatcher, player.id, "thousand-tailed-watcher"));
    const weak = plainUnit(opponent.id, "watcher-weak", 2);
    const strong = plainUnit(opponent.id, "watcher-strong", 5);
    player.hand = [watcher];
    opponent.base = [weak, strong];
    assert.equal(playCard(game, watcher.instanceId, "base").ok, true);
    assert.equal(currentMight(game, weak), 1);
    assert.equal(currentMight(game, strong), 2);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const ursine = freeToPlay(instance(cards.stormclawUrsine, player.id, "stormclaw-ursine"));
    const resource = rune(DOMAINS.BODY, player.id, "stormclaw-channel-rune");
    player.hand = [ursine];
    player.runeDeck = [resource];
    assert.equal(playCard(game, ursine.instanceId, "base").ok, true);
    assert.equal(player.runes.includes(resource), true);
    assert.equal(resource.exhausted, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const snapvine = freeToPlay(instance(cards.carnivorousSnapvine, player.id, "carnivorous-snapvine"));
    const enemy = plainUnit(opponent.id, "snapvine-enemy", 10);
    player.hand = [snapvine];
    game.battlefields = [battlefield("snapvine-field", [enemy], opponent.id)];
    assert.equal(playCard(game, snapvine.instanceId, "base").ok, true);
    assert.equal(enemy.damage, snapvine.might);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const bouncer = freeToPlay(instance(cards.zauniteBouncer, player.id, "zaunite-bouncer"));
    const enemy = plainUnit(opponent.id, "bouncer-enemy", 3);
    player.hand = [bouncer];
    game.battlefields = [battlefield("bouncer-field", [enemy], opponent.id)];
    assert.equal(playCard(game, bouncer.instanceId, "base").ok, true);
    assert.equal(opponent.hand.includes(enemy), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const marauder = freeToPlay(instance(cards.maddenedMarauder, player.id, "maddened-marauder"));
    const enemy = plainUnit(opponent.id, "marauder-enemy", 3);
    player.hand = [marauder];
    game.battlefields = [battlefield("marauder-field", [enemy], opponent.id)];
    assert.equal(playCard(game, marauder.instanceId, "base").ok, true);
    assert.equal(opponent.base.includes(enemy), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const mindsplitter = freeToPlay(instance(cards.mindsplitter, player.id, "mindsplitter"));
    const discarded = plainSpell(opponent.id, "mindsplitter-discard");
    player.hand = [mindsplitter];
    opponent.hand = [discarded];
    assert.equal(playCard(game, mindsplitter.instanceId, "base").ok, true);
    assert.equal(opponent.trash.includes(discarded), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const chief = freeToPlay(instance(cards.solariChief, player.id, "solari-chief"));
    const enemy = plainUnit(opponent.id, "solari-chief-enemy", 3);
    player.hand = [chief];
    opponent.base = [enemy];
    assert.equal(playCard(game, chief.instanceId, "base").ok, true);
    assert.equal(enemy.stunned, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const dragon = freeToPlay(instance(cards.harnessedDragon, player.id, "harnessed-dragon"));
    const enemy = plainUnit(opponent.id, "harnessed-dragon-enemy", 30);
    player.hand = [dragon];
    opponent.base = [enemy];
    assert.equal(playCard(game, dragon.instanceId, "base").ok, true);
    assert.equal(opponent.trash.includes(enemy), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const darius = freeToPlay(instance(cards.dariusExecutioner, player.id, "darius-executioner"));
    player.cardsPlayedThisTurn = 1;
    player.hand = [darius];
    assert.equal(playCard(game, darius.instanceId, "base").ok, true);
    assert.equal(darius.exhausted, false);
  }
});

test("global, resource, and zone-changing spell families preserve literal outcomes", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const units = [plainUnit(player.id, "decisive-unit-1", 2), plainUnit(player.id, "decisive-unit-2", 4)];
    player.base = [...units];
    resolveEffect(game, player, instance(cards.decisiveStrike, player.id, "decisive-strike"));
    assert.deepEqual(units.map((unit) => currentMight(game, unit)), [4, 6]);
    assert.deepEqual(units.map((unit) => unit.temporaryMight), [2, 2]);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const first = plainGear(player.id, "thermo-friendly-gear");
    const second = plainGear(opponent.id, "thermo-enemy-gear");
    player.base = [first];
    opponent.base = [second];
    resolveEffect(game, player, instance(cards.thermoBeam, player.id, "thermo-beam"));
    assert.equal(player.trash.includes(first), true);
    assert.equal(opponent.trash.includes(second), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const drawn = plainSpell(player.id, "find-center-draw");
    const resource = rune(DOMAINS.CALM, player.id, "find-center-rune");
    player.mainDeck = [drawn];
    player.runeDeck = [resource];
    resolveEffect(game, player, instance(cards.findYourCenter, player.id, "find-your-center"));
    assert.equal(player.hand.includes(drawn), true);
    assert.equal(player.runes.includes(resource), true);
    assert.equal(resource.exhausted, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const drawn = plainSpell(player.id, "mobilize-fallback-draw");
    player.mainDeck = [drawn];
    resolveEffect(game, player, instance(cards.mobilize, player.id, "mobilize"));
    assert.equal(player.hand.includes(drawn), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const target = plainUnit(opponent.id, "unyielding-target", 10);
    game.battlefields = [battlefield("unyielding-field", [target], opponent.id)];
    resolveEffect(game, player, instance(cards.unyieldingSpirit, player.id, "unyielding-spirit"));
    resolveEffect(game, player, instance(cards.incinerate, player.id, "unyielding-incinerate"));
    assert.equal(target.damage, 0);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const oldHands = [plainSpell(player.id, "invert-old-1"), plainSpell(opponent.id, "invert-old-2")];
    const playerDraws = Array.from({ length: 4 }, (_, index) => plainSpell(player.id, `invert-player-draw-${index}`));
    const opponentDraws = Array.from({ length: 4 }, (_, index) => plainSpell(opponent.id, `invert-opponent-draw-${index}`));
    player.hand = [oldHands[0]];
    opponent.hand = [oldHands[1]];
    player.mainDeck = [...playerDraws];
    opponent.mainDeck = [...opponentDraws];
    resolveEffect(game, player, instance(cards.invertTimelines, player.id, "invert-timelines"));
    assert.equal(player.trash.includes(oldHands[0]), true);
    assert.equal(opponent.trash.includes(oldHands[1]), true);
    assert.equal(player.hand.length, 4);
    assert.equal(opponent.hand.length, 4);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const friendly = plainUnit(player.id, "possession-friendly", 2);
    const enemy = plainUnit(opponent.id, "possession-enemy", 3);
    player.base = [friendly];
    game.battlefields = [battlefield("possession-field", [enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.possession, player.id, "possession"));
    assert.equal(player.base.includes(enemy), true);
    assert.equal(enemy.controllerId, player.id);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const friendly = plainUnit(player.id, "fight-flight-friendly", 2);
    const enemy = plainUnit(opponent.id, "fight-flight-enemy", 3);
    game.battlefields = [battlefield("fight-flight-field", [friendly, enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.fightOrFlight, player.id, "fight-or-flight"));
    assert.equal(player.base.includes(friendly), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const returned = plainUnit(player.id, "morbid-return-unit", 2);
    player.trash = [returned];
    resolveEffect(game, player, instance(cards.morbidReturn, player.id, "morbid-return"));
    assert.equal(player.hand.includes(returned), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const hidden = plainSpell(player.id, "guerilla-hidden");
    hidden.tags = ["Hidden"];
    const ordinary = plainSpell(player.id, "guerilla-ordinary");
    player.trash = [hidden, ordinary];
    resolveEffect(game, player, instance(cards.guerillaWarfare, player.id, "guerilla-warfare"));
    assert.equal(player.hand.includes(hidden), true);
    assert.equal(player.trash.includes(ordinary), true);
    assert.equal(player.hideIgnoringCostsUntilTurnSequence, game.turnSequence);
  }
});

test("targeted and multi-player spell families preserve conditional and staged outcomes", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const unit = plainUnit(player.id, "cleave-target", 2);
    player.base = [unit];
    resolveEffect(game, player, instance(cards.cleave, player.id, "cleave"));
    assert.equal(currentMight(game, unit), 2);
    unit.combatRole = "attacker";
    game.battlefields = [battlefield("cleave-field", [unit], player.id)];
    assert.equal(currentCombatMight(game, game.battlefields[0], unit, "attacker"), 5);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const unit = plainUnit(player.id, "last-stand-target", 3);
    player.base = [unit];
    resolveEffect(game, player, instance(cards.lastStand, player.id, "last-stand"));
    assert.equal(currentMight(game, unit), 6);
    assert.equal(unit.temporary, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const first = plainGear(player.id, "acceptable-friendly-gear");
    const second = plainGear(opponent.id, "acceptable-enemy-gear");
    player.base = [first];
    opponent.base = [second];
    resolveEffect(game, player, instance(cards.acceptableLosses, player.id, "acceptable-losses"));
    assert.equal(player.trash.includes(first), true);
    assert.equal(opponent.trash.includes(second), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const first = plainUnit(player.id, "cull-friendly-unit", 2);
    const second = plainUnit(opponent.id, "cull-enemy-unit", 2);
    player.base = [first];
    opponent.base = [second];
    resolveEffect(game, player, instance(cards.cullTheWeak, player.id, "cull-the-weak"));
    assert.equal(player.trash.includes(first), true);
    assert.equal(opponent.trash.includes(second), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const target = plainGear(player.id, "fading-memories-target");
    player.base = [target];
    resolveEffect(game, player, instance(cards.fadingMemories, player.id, "fading-memories"));
    assert.equal(target.temporary, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const friendly = plainUnit(player.id, "facebreaker-friendly", 3);
    const enemy = plainUnit(opponent.id, "facebreaker-enemy", 3);
    game.battlefields = [battlefield("facebreaker-field", [friendly, enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.facebreaker, player.id, "facebreaker"));
    assert.equal(friendly.stunned, true);
    assert.equal(enemy.stunned, true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const gear = plainGear(player.id, "salvage-gear");
    const drawn = plainSpell(player.id, "salvage-draw");
    player.base = [gear];
    player.mainDeck = [drawn];
    resolveEffect(game, player, instance(cards.salvage, player.id, "salvage"));
    assert.equal(player.trash.includes(gear), true);
    assert.equal(player.hand.includes(drawn), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const friendly = plainUnit(player.id, "siphon-friendly", 3);
    const enemy = plainUnit(opponent.id, "siphon-enemy", 3);
    game.battlefields = [battlefield("siphon-field", [friendly, enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.siphonPower, player.id, "siphon-power"));
    assert.equal(currentMight(game, friendly), 4);
    assert.equal(currentMight(game, enemy), 2);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const unit = plainUnit(player.id, "showstopper-unit", 2);
    player.base = [unit];
    game.battlefields = [battlefield("showstopper-field", [], opponent.id)];
    resolveEffect(game, player, instance(cards.showstopper, player.id, "showstopper"));
    assert.equal(unit.buffs, 1);
    assert.equal(game.battlefields[0].units.includes(unit), true);
  }
});

test("complex spell continuations and battlefield static permissions complete every declared stage", () => {
  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const attacker = plainUnit(player.id, "stormbringer-source", 3);
    const enemies = [plainUnit(opponent.id, "stormbringer-enemy-1", 8), plainUnit(opponent.id, "stormbringer-enemy-2", 8)];
    player.base = [attacker];
    game.battlefields = [battlefield("stormbringer-field", enemies, opponent.id)];
    resolveEffect(game, player, instance(cards.stormbringer, player.id, "stormbringer"));
    assert.deepEqual(enemies.slice(0, 2).map((unit) => unit.damage), [3, 3]);
    assert.equal(game.battlefields[0].units.includes(attacker), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const moved = plainUnit(opponent.id, "dragons-rage-moved", 3);
    const destinationEnemy = plainUnit(opponent.id, "dragons-rage-destination-enemy", 4);
    opponent.base = [destinationEnemy];
    game.battlefields = [battlefield("dragons-rage-field", [moved], opponent.id)];
    const rage = instance(cards.dragonsRage, player.id, "dragons-rage");
    rage.declaredPlayTargets = [{ effect: "moveUnitSpellTarget", targetId: moved.instanceId }];
    rage.declaredPlayChoices = [{ effect: "moveUnitSpellDestination", unitId: moved.instanceId, destinationId: "base" }];
    resolveEffect(game, player, rage);
    assert.equal(opponent.base.includes(moved), false);
    assert.equal(opponent.trash.includes(moved), true);
    assert.equal(destinationEnemy.damage, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const friendly = plainUnit(player.id, "last-breath-friendly", 3);
    const enemy = plainUnit(opponent.id, "last-breath-enemy", 8);
    friendly.exhausted = true;
    player.base = [friendly];
    game.battlefields = [battlefield("last-breath-field", [enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.lastBreath, player.id, "last-breath"));
    assert.equal(friendly.exhausted, false);
    assert.equal(enemy.damage, 3);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const friendly = plainUnit(player.id, "zenith-friendly", 3);
    const enemy = plainUnit(opponent.id, "zenith-enemy", 8);
    player.base = [friendly];
    game.battlefields = [battlefield("zenith-field", [enemy], opponent.id)];
    resolveEffect(game, player, instance(cards.zenithBlade, player.id, "zenith-blade"));
    assert.equal(enemy.stunned, true);
    assert.equal(game.battlefields[0].units.includes(friendly), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    const future = instance(cards.promisingFuture, player.id, "promising-future");
    const playerUnit = plainUnit(player.id, "promising-player-unit", 2);
    const opponentUnit = plainUnit(opponent.id, "promising-opponent-unit", 2);
    player.mainDeck = [playerUnit];
    opponent.mainDeck = [opponentUnit];
    resolveEffect(game, player, future);
    assert.equal(advanceUntil(game, () => player.base.includes(playerUnit) && opponent.base.includes(opponentUnit)), true);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const opponent = game.players[1];
    for (const candidate of [player, opponent]) {
      candidate.hand = Array.from({ length: 3 }, (_, index) => plainSpell(candidate.id, `judgment-${candidate.id}-hand-${index}`));
      candidate.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, candidate.id, `judgment-${candidate.id}-rune-${index}`));
      candidate.base = [
        ...Array.from({ length: 3 }, (_, index) => plainUnit(candidate.id, `judgment-${candidate.id}-unit-${index}`, 2)),
        ...Array.from({ length: 3 }, (_, index) => plainGear(candidate.id, `judgment-${candidate.id}-gear-${index}`))
      ];
    }
    resolveEffect(game, player, instance(cards.divineJudgment, player.id, "divine-judgment"));
    for (const candidate of [player, opponent]) {
      assert.equal(candidate.hand.length, 2);
      assert.equal(candidate.runes.length, 2);
      assert.equal(candidate.base.filter((card) => card.type === "unit").length, 2);
      assert.equal(candidate.base.filter((card) => card.type === "gear").length, 2);
      assert.equal(candidate.runeDeck.length, 1);
      assert.equal(candidate.mainDeck.length, 3);
    }
  }

  {
    const game = ruleGame({ interactive: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const opposingSpell = plainSpell(opponent.id, "mystic-reversal-target", 4);
    opposingSpell.declaredPlayTargets = [{ effect: "damageUnit", targetId: "old-target" }];
    opposingSpell.declaredPlayChoices = [{ effect: "mode", optionId: "old-mode" }];
    game.phase = "showdown";
    game.showdown = {
      battlefieldId: "mystic-reversal-field",
      attackerId: opponent.id,
      defenderId: player.id,
      turnPlayerId: opponent.id,
      priorityPlayerId: player.id,
      focusPlayerId: player.id,
      consecutivePasses: 0,
      chain: [{ card: opposingSpell, playerId: opponent.id, destination: "base", status: "pending" }]
    };
    const reversal = instance(cards.mysticReversal, player.id, "mystic-reversal");
    assert.equal(resolveEffect(game, player, reversal), true);
    assert.equal(game.pendingChoice?.effect, "gainControlOfChainSpell");
    chooseEffectOption(game, opposingSpell.instanceId);
    assert.equal(game.showdown.chain[0].playerId, player.id);
    assert.equal(opposingSpell.controllerId, player.id);
    assert.equal(game.pendingChoice?.effect, "gainControlNewChoices");
    chooseEffectOption(game, "new");
    assert.deepEqual(opposingSpell.declaredPlayTargets, []);
    assert.deepEqual(opposingSpell.declaredPlayChoices, []);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const unit = plainUnit(player.id, "forge-attach-unit", 3);
    const equipment = instance(cards.guardianAngel, player.id, "forge-attach-equipment");
    player.base = [unit, equipment];
    game.battlefields = [{ ...instance(cards.forgeOfTheFluft, player.id, "forge-of-the-fluft"), units: [], hidden: [], controlledBy: player.id }];
    assert.equal(activateCard(game, player.legend.instanceId).ok, true);
    assert.equal(unit.attachments.some((gear) => gear.instanceId === equipment.instanceId), true);
  }

  {
    const game = ruleGame({ interactive: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const saboteur = instance(cards.noxusSaboteur, player.id, "noxus-saboteur");
    const hidden = instance(cards.backOff, opponent.id, "noxus-blocked-hidden");
    hidden.hidden = true;
    const field = battlefield("noxus-saboteur-field", [saboteur], player.id);
    field.hidden = [{ card: hidden, ownerId: opponent.id, hiddenByPlayerId: opponent.id, playableFromTurnSequence: 0 }];
    game.battlefields = [field];
    game.phase = "showdown";
    game.currentPlayerId = opponent.id;
    game.showdown = {
      battlefieldId: field.instanceId,
      attackerId: opponent.id,
      defenderId: player.id,
      turnPlayerId: opponent.id,
      priorityPlayerId: opponent.id,
      focusPlayerId: opponent.id,
      consecutivePasses: 0,
      chain: []
    };
    const blocked = playCard(game, hidden.instanceId, field.instanceId);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.message, "Hidden cards cannot be revealed at that battlefield.");
    assert.equal(field.hidden[0].card.instanceId, hidden.instanceId);
  }

  {
    const game = ruleGame({ interactive: false });
    const player = game.players[0];
    const champion = instance(cards.annieStubborn, player.id, "hallowed-champion");
    player.chosenChampionName = champion.name;
    player.champion = null;
    player.trash = [champion];
    game.battlefields = [{ ...instance(cards.hallowedTomb, player.id, "hallowed-tomb"), units: [], hidden: [], controlledBy: player.id }];
    startTurn(game);
    assert.equal(player.champion?.instanceId, champion.instanceId);
    assert.equal(player.champion?.zone, "champion");
  }
});

test("Divine Judgment lets every player explicitly choose each pair to keep", () => {
  const game = ruleGame({ interactive: true });
  const expected = new Map();
  for (const candidate of game.players) {
    const hand = Array.from({ length: 3 }, (_, index) => plainSpell(candidate.id, `judgment-choice-${candidate.id}-hand-${index}`));
    const runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, candidate.id, `judgment-choice-${candidate.id}-rune-${index}`));
    const units = Array.from({ length: 3 }, (_, index) => plainUnit(candidate.id, `judgment-choice-${candidate.id}-unit-${index}`, 2));
    const gear = Array.from({ length: 3 }, (_, index) => plainGear(candidate.id, `judgment-choice-${candidate.id}-gear-${index}`));
    candidate.hand = hand;
    candidate.runes = runes;
    candidate.base = [...units, ...gear];
    expected.set(candidate.id, {
      hand: new Set(hand.slice(-2).map((card) => card.instanceId)),
      runes: new Set(runes.slice(-2).map((card) => card.instanceId)),
      units: new Set(units.slice(-2).map((card) => card.instanceId)),
      gear: new Set(gear.slice(-2).map((card) => card.instanceId))
    });
  }

  resolveEffect(game, game.players[0], instance(cards.divineJudgment, game.players[0].id, "divine-judgment-explicit"));
  let choices = 0;
  while (game.pendingChoice?.effect === "divineJudgmentKeep" && choices < 20) {
    const option = game.pendingChoice.options.at(-1);
    assert.ok(option);
    chooseEffectOption(game, option.id);
    choices += 1;
  }
  assert.equal(choices, 16);
  assert.equal(game.pendingChoice, null);
  for (const candidate of game.players) {
    const keep = expected.get(candidate.id);
    assert.deepEqual(new Set(candidate.hand.map((card) => card.instanceId)), keep.hand);
    assert.deepEqual(new Set(candidate.runes.map((card) => card.instanceId)), keep.runes);
    assert.deepEqual(new Set(candidate.base.filter((card) => card.type === "unit").map((card) => card.instanceId)), keep.units);
    assert.deepEqual(new Set(candidate.base.filter((card) => card.type === "gear").map((card) => card.instanceId)), keep.gear);
    assert.equal(candidate.mainDeck.length, 3);
    assert.equal(candidate.runeDeck.length, 1);
  }
});

test("Divine Judgment lets each Rune owner explicitly order simultaneous recycling", () => {
  const game = ruleGame({ interactive: true });
  for (const candidate of game.players) {
    candidate.hand = [];
    candidate.base = [];
    candidate.runes = Array.from({ length: 4 }, (_, index) =>
      rune(DOMAINS.CALM, candidate.id, `judgment-order-${candidate.id}-${index}`));
    candidate.runeDeck = [];
  }

  resolveEffect(game, game.players[0], instance(cards.divineJudgment, game.players[0].id, "divine-judgment-rune-order"));
  while (game.pendingChoice?.effect === "divineJudgmentKeep") {
    assert.equal(chooseEffectOption(game, game.pendingChoice.options[0].id).ok, true);
  }
  const expected = {};
  while (game.pendingChoice?.effect === "divineJudgmentRuneOrder") {
    const playerId = game.pendingChoice.playerId;
    expected[playerId] ||= [];
    const option = game.pendingChoice.options.at(-1);
    expected[playerId].push(option.cardId);
    assert.equal(chooseEffectOption(game, option.id).ok, true);
  }

  assert.equal(game.pendingChoice, null);
  for (const candidate of game.players) {
    assert.deepEqual(candidate.runeDeck.map((runeCard) => runeCard.instanceId), expected[candidate.id]);
  }
});
