import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cards, decklists, DOMAINS, makeRune, rawDecklists } from "../src/cards.mjs";
import { DECK_RULES, validateDeckRecord } from "../src/decks/rules.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";
import { applyGameCommand } from "../server/commands.mjs";
import { validateStableGameState } from "../scripts/semantic-oracle.mjs";
import { referenceZone, resolveCleanupReference } from "../scripts/reference-rules.mjs";
import { OFFICIAL_TOKEN_DEFINITIONS, officialTokenKinds } from "../src/rules/tokens.mjs";
import { applyAiAction, enumerateLegalActions, planPaymentActions, resolveLegalAction } from "../src/ai/actions.mjs";
import {
  activateCard,
  applyDamage,
  beginPlayChampion,
  beginPlayCard,
  cancelPayment,
  chooseFirstPlayer,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmPayment,
  createGame,
  currentCombatMight,
  currentMight,
  currentPlayer,
  declineEffectChoice,
  draw,
  endTurn,
  hideCard,
  isChosenChampion,
  legalActivatedAbilityOptions,
  legalCardPlayDestinations,
  legalChampionPlayDestinations,
  legalPaymentPoolEnergyOptions,
  moveUnit,
  moveUnits,
  passShowdown,
  paymentConfirmationLegality,
  preventNextDamage,
  predictCards,
  playToken,
  playUnitToken,
  playCard,
  resolveEffect,
  rollFirstPlayer,
  selectBattlefield,
  selectChampion,
  confirmMulligan,
  skipMulligan,
  startTurn,
  replaceBattlefieldWithToken,
  scheduleAdditionalTurn,
  surrender,
  swapBackBattlefieldToken,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentPoolPower,
  togglePaymentRune,
  unitDamageState
} from "../src/engine.mjs";

function instance(card, ownerId, id = "test-card") {
  return {
    ...structuredClone(card),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    mightModifier: 0
  };
}

function rune(domain, ownerId, id) {
  return {
    ...makeRune(domain),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0
  };
}

function finalizedTriggerItem(card, playerId, id) {
  return {
    id,
    itemType: "trigger",
    card,
    playerId,
    status: "finalized",
    trigger: {
      id: `${id}-trigger`,
      kind: "testNoopTrigger",
      playerId,
      sourceCardId: card.instanceId,
      status: "finalized"
    }
  };
}

function selectAndConfirmTriggerOrder(game, optionIds = null) {
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  const triggerOptions = game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder);
  const ids = optionIds || triggerOptions.filter((option) => !option.optionalTrigger).map((option) => option.id);
  for (const optionId of ids) {
    assert.equal(chooseEffectOption(game, optionId).ok, true);
    assert.equal(game.pendingChoice?.effect, "triggerOrder");
  }
  const confirm = game.pendingChoice.options.find((option) => option.confirmTriggerOrder);
  assert.ok(confirm, "confirmation is available after every mandatory trigger is selected");
  assert.equal(confirm.disabled, false);
  assert.equal(chooseEffectOption(game, confirm.id).ok, true);
}

test("activated ability timing keywords do not make their source cards Action or Reaction cards", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const source = instance(cards.lonelyPoro, opponent.id, "ability-timing-chain-source");
  const luxInHand = instance({ ...cards.luxCrownguard, energy: 0, power: [] }, player.id, "ability-timing-lux-hand");
  const luxOnBoard = instance(cards.luxCrownguard, player.id, "ability-timing-lux-board");
  player.hand = [luxInHand];
  player.base = [luxOnBoard];
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [finalizedTriggerItem(source, opponent.id, "ability-timing-existing-item")]
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, luxInHand.instanceId, "base").ok, false, "the unit card itself is not Reaction");
  assert.equal(activateCard(game, luxOnBoard.instanceId).ok, true, "the activated ability is Reaction");
  assert.equal(luxOnBoard.exhausted, true);
  assert.equal(player.runePool.energy.length, 2);
});

test("ordinary Legend activated abilities use their controller's neutral open action timing", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const legend = instance(cards.missFortuneBountyHunter, player.id, "ordinary-legend-ability");
  const target = instance(cards.lonelyPoro, player.id, "ordinary-legend-target");
  player.legend = legend;
  player.base = [target];

  assert.equal(activateCard(game, legend.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.ok(target.temporaryKeywords?.includes("Ganking"));
  assert.equal(legend.exhausted, true);
});

test("Action belongs to Malzahar's ability rather than the unit card", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const malzahar = instance(cards.malzaharFanatic, player.id, "action-ability-malzahar");
  const handCopy = instance({ ...cards.malzaharFanatic, energy: 0, power: [] }, player.id, "action-card-malzahar");
  const sacrifice = instance(cards.lonelyPoro, player.id, "action-ability-sacrifice");
  player.base = [malzahar, sacrifice];
  player.hand = [handCopy];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: game.battlefields[0].instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(beginPlayCard(game, handCopy.instanceId, "base").ok, false, "the unit card itself is not Action");
  assert.equal(activateCard(game, malzahar.instanceId).ok, true, "the ability is Action during an open showdown");
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, sacrifice.instanceId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === sacrifice.instanceId), false,
    "the printed Kill cost is paid before the Action ability finalizes");
  assert.equal(player.trash.some((card) => card.instanceId === sacrifice.instanceId), true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === sacrifice.instanceId), false);
  assert.equal(malzahar.exhausted, true);
});

test("activated ability use conditions are checked before paying costs or exhausting the source", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const caitlyn = instance(cards.caitlynPatrolling, player.id, "condition-caitlyn");
  const target = instance(cards.vilemaw, player.id, "condition-caitlyn-target");
  const sunDisc = instance(cards.sunDisc, player.id, "condition-sun-disc");
  player.base = [caitlyn, sunDisc];
  game.battlefields[0].controlledBy = player.id;
  game.battlefields[0].units = [target];

  assert.equal(activateCard(game, caitlyn.instanceId).ok, false, "Caitlyn must be at a battlefield");
  assert.equal(caitlyn.exhausted, false);
  assert.equal(activateCard(game, sunDisc.instanceId).ok, false, "Legion must already be satisfied");
  assert.equal(sunDisc.exhausted, false);

  player.base = [sunDisc];
  game.battlefields[0].units = [caitlyn, target];
  assert.equal(activateCard(game, caitlyn.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, caitlyn.might);

  player.cardsPlayedThisTurn = 1;
  assert.equal(activateCard(game, sunDisc.instanceId).ok, true);
  assert.equal(sunDisc.exhausted, true);
});

test("every activated ability explicitly declares whether exhausting its source is a cost", () => {
  const activatedEffects = Object.values(cards).flatMap((card) =>
    (card.effects || [])
      .filter((effect) => effect.timing === "activated")
      .map((effect) => ({ card, effect }))
  );

  assert.ok(activatedEffects.length > 0);
  for (const { card, effect } of activatedEffects) {
    assert.equal(typeof effect.exhaust, "boolean",
      `${card.cardNumber} ${card.name} must explicitly declare exhaust: true|false`);
  }

  const settEffects = activatedEffects.filter(({ card }) => card.name === "Sett, Brawler");
  assert.equal(settEffects.length, 2);
  assert.equal(settEffects.every(({ effect }) => effect.exhaust === false), true);
});

test("continuous static effects apply without exhausting their source or affected units", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const yi = instance(cards.masterYiMeditative, player.id, "static-ready-yi");
  const garen = instance(cards.garenCommander, player.id, "static-ready-garen");
  const ally = instance(cards.lonelyPoro, player.id, "static-ready-ally");
  const field = game.battlefields[0];
  player.runes = Array.from({ length: 8 }, (_, index) =>
    rune(DOMAINS.CALM, player.id, `static-ready-rune-${index}`));
  player.base = [yi];
  field.units = [garen, ally];
  field.controlledBy = player.id;

  assert.equal(currentMight(game, yi), 8, "Master Yi's rune-threshold static effect applies");
  assert.equal(currentMight(game, ally), 3, "Garen's friendly-unit static effect applies");
  assert.equal(yi.exhausted, false);
  assert.equal(garen.exhausted, false);
  assert.equal(ally.exhausted, false);
});

test("activated ability UI and engine both reject every external-target kind when no legal target exists", () => {
  const cases = [
    { card: cards.guardianAngel, label: "Equip", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-equip")) },
    { card: cards.ironBallista, label: "battlefield damage", addTarget: (game, player) => game.battlefields[0].units.push(instance(cards.lonelyPoro, player.id, "target-damage")) },
    { card: cards.orbOfRegret, label: "unit Might", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-might")) },
    { card: cards.malzaharFanatic, label: "kill permanent cost", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-kill-cost")) },
    { card: cards.arenaBar, label: "exhausted friendly unit", addTarget: (game, player) => {
      const target = instance(cards.lonelyPoro, player.id, "target-exhausted");
      target.exhausted = true;
      player.base.push(target);
    } },
    { card: cards.packOfWonders, label: "another permanent or Hidden card", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-return")) },
    { card: cards.theSyren, label: "friendly battlefield unit", addTarget: (game, player) => game.battlefields[0].units.push(instance(cards.lonelyPoro, player.id, "target-recall")) },
    { card: cards.baitedHook, label: "friendly unit sacrifice", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-sacrifice")) },
    { card: cards.yasuoUnforgiven, label: "friendly unit move", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-move")) },
    { card: cards.teemoSwiftScout, label: "owned tagged unit", addTarget: (game, player) => {
      const target = instance(cards.lonelyPoro, player.id, "target-tagged");
      target.tags = ["Teemo"];
      player.base.push(target);
    } },
    { card: cards.missFortuneBountyHunter, label: "keyword unit", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-keyword")) },
    { card: cards.unlicensedArmory, label: "friendly death-save unit", addTarget: (game, player) => player.base.push(instance(cards.lonelyPoro, player.id, "target-save")) }
  ];

  for (const [index, entry] of cases.entries()) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const source = instance(entry.card, player.id, `target-gate-source-${index}`);
    player.base = entry.card.type === "legend" ? [] : [source];
    player.legend = entry.card.type === "legend" ? source : player.legend;
    player.champion = null;
    player.hand = [instance(cards.charm, player.id, `target-gate-hand-${index}`)];
    player.trash = Array.from({ length: 3 }, (_, trashIndex) =>
      instance(cards.lonelyPoro, player.id, `target-gate-trash-${index}-${trashIndex}`));
    player.runes = [DOMAINS.FURY, DOMAINS.CALM, DOMAINS.MIND, DOMAINS.BODY, DOMAINS.CHAOS, DOMAINS.ORDER]
      .map((domain, runeIndex) => rune(domain, player.id, `target-gate-rune-${index}-${runeIndex}`));
    opponent.base = [];
    for (const battlefield of game.battlefields) {
      battlefield.units = [];
      battlefield.controlledBy = null;
    }

    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), [], `${entry.label} must be hidden without a target`);
    const rejected = activateCard(game, source.instanceId);
    assert.equal(rejected.ok, false, `${entry.label} must also be rejected by the engine`);
    assert.equal(game.pendingChoice, null, `${entry.label} must not open a dead-end choice`);
    assert.equal(game.pendingPayment, null, `${entry.label} must not open a dead-end payment`);
    assert.equal(game.actionChain, null, `${entry.label} must not create a Pending Chain item`);

    entry.addTarget(game, player);
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1, `${entry.label} becomes available with a legal target`);
  }
});

test("Trinity Force activation sends its exact Equip ability id through the shared command gate", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const unit = instance(cards.lonelyPoro, player.id, "trinity-command-unit");
  const trinity = instance(cards.trinityForce, player.id, "trinity-command-gear");
  player.base = [unit, trinity];
  player.runes = [rune(DOMAINS.BODY, player.id, "trinity-command-rune")];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = null;
  game.pendingChoice = null;
  game.pendingPayment = null;

  const [ability] = legalActivatedAbilityOptions(game, trinity.instanceId);
  assert.equal(ability?.kind, "equip");
  const room = { game, hostPlayerId: player.id };
  assert.equal(applyGameCommand(room, player.id, { kind: "activateCard", cardId: trinity.instanceId }).ok, true,
    "a legacy UI command may be completed only when one legal ability matches");
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [unit.instanceId]);
});

test("a Master Yi carrying Trinity Force can use an explicitly requested standard move", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const yi = instance(cards.masterYiMeditative, player.id, "trinity-master-yi");
  const trinity = instance(cards.trinityForce, player.id, "trinity-master-yi-gear");
  trinity.attachedToId = yi.instanceId;
  yi.attachments = [trinity];
  const field = {
    ...instance(player.availableBattlefields[0], player.id, "trinity-master-yi-field"),
    units: [],
    hidden: [],
    controlledBy: null
  };
  player.base = [yi];
  game.battlefields = [field];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = null;
  game.pendingChoice = null;
  game.pendingPayment = null;

  const command = { kind: "moveUnit", unitId: yi.instanceId, destinationId: field.instanceId };
  assert.deepEqual(resolveLegalAction(game, command, player.id), command,
    "an explicit single-unit move is validated by the move resolver itself");
  assert.equal(applyGameCommand({ game, hostPlayerId: player.id }, player.id, command).ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === yi.instanceId), true);
  assert.equal(yi.attachments[0].instanceId, trinity.instanceId);
  assert.equal(yi.exhausted, true);
});

test("an omitted ability id is rejected when more than one legal activation matches", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const basicRune = rune(DOMAINS.BODY, player.id, "ambiguous-command-rune");
  player.runes = [basicRune];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = null;
  game.pendingChoice = null;
  game.pendingPayment = null;

  assert.equal(legalActivatedAbilityOptions(game, basicRune.instanceId).length, 2);
  assert.equal(applyGameCommand({ game, hostPlayerId: player.id }, player.id, {
    kind: "activateCard",
    cardId: basicRune.instanceId
  }).ok, false);
});

test("activated ability availability enforces resource, non-resource, state, and Forge prerequisites", () => {
  const makeGame = (cardDefinition, id) => {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const source = instance(cardDefinition, player.id, id);
    player.base = cardDefinition.type === "legend" ? [] : [source];
    if (cardDefinition.type === "legend") player.legend = source;
    player.champion = null;
    player.hand = [];
    player.trash = [];
    player.runes = [];
    for (const battlefield of game.battlefields) {
      battlefield.units = [];
      battlefield.controlledBy = null;
    }
    return { game, player, source };
  };

  {
    const { game, player, source } = makeGame(cards.viDestructive, "gate-vi");
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    player.trash.push(instance(cards.charm, player.id, "gate-vi-trash"));
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1);
  }

  {
    const { game, player, source } = makeGame(cards.garbageGrabber, "gate-grabber");
    player.runes = [rune(DOMAINS.MIND, player.id, "gate-grabber-energy")];
    player.trash = [
      instance(cards.charm, player.id, "gate-grabber-trash-1"),
      instance(cards.gust, player.id, "gate-grabber-trash-2")
    ];
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    player.trash.push(instance(cards.flash, player.id, "gate-grabber-trash-3"));
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1);
  }

  {
    const { game, player, source } = makeGame(cards.treasureTrove, "gate-trove");
    player.runes = [rune(DOMAINS.CALM, player.id, "gate-wrong-power")];
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    player.runes.push(rune(DOMAINS.CHAOS, player.id, "gate-right-power"));
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1);
  }

  {
    const { game, source } = makeGame(cards.settBrawler, "gate-sett");
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    source.buffs = 1;
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1);
    source.exhausted = true;
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1,
      "Sett's buff-spend ability has no exhaust cost and remains usable while exhausted");
  }

  {
    const { game, player, source } = makeGame(cards.sunDisc, "gate-legion");
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    player.cardsPlayedThisTurn = 1;
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1);
  }

  {
    const { game, source } = makeGame(cards.udyrWildman, "gate-udyr");
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    source.buffs = 1;
    assert.equal(legalActivatedAbilityOptions(game, source.instanceId).length, 1);
    source.udyrModesTurnSequence = game.turnSequence || 0;
    source.udyrModesChosen = ["damage", "stun", "ready", "ganking"];
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
  }

  {
    const { game, player, source } = makeGame(cards.missFortuneBountyHunter, "gate-forge");
    const forge = instance(cards.forgeOfTheFluft, player.id, "gate-forge-field");
    forge.units = [];
    forge.hidden = [];
    forge.controlledBy = player.id;
    game.battlefields[0] = forge;
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    const equipment = instance(cards.guardianAngel, player.id, "gate-forge-equipment");
    player.base.push(equipment);
    assert.deepEqual(legalActivatedAbilityOptions(game, source.instanceId), []);
    player.base.push(instance(cards.lonelyPoro, player.id, "gate-forge-unit"));
    const forgeOption = legalActivatedAbilityOptions(game, source.instanceId).find((option) => option.kind === "forge");
    assert.ok(forgeOption);
    assert.equal(activateCard(game, source.instanceId, forgeOption.id).ok, true);
    assert.equal(game.pendingChoice?.effect, "forgeAttachGear");
    assert.equal(chooseEffectOption(game, equipment.instanceId).ok, true);
    assert.equal(game.pendingChoice?.effect, "forgeAttachTarget");
    assert.equal(chooseEffectOption(game, "gate-forge-unit").ok, true);
    const unit = player.base.find((card) => card.instanceId === "gate-forge-unit");
    assert.equal(unit.attachments.some((card) => card.instanceId === equipment.instanceId), true);
    assert.equal(source.exhausted, true);
  }
});

test("Unlicensed Armory requires and pays a hand discard instead of recycling trash", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const armory = instance(cards.unlicensedArmory, player.id, "discard-armory");
  const target = instance(cards.lonelyPoro, player.id, "discard-armory-target");
  const trashCard = instance(cards.gust, player.id, "discard-armory-trash");
  const handCard = instance(cards.charm, player.id, "discard-armory-hand");
  player.base = [armory, target];
  player.hand = [];
  player.trash = [trashCard];

  assert.deepEqual(legalActivatedAbilityOptions(game, armory.instanceId), [], "trash cannot pay a discard cost");
  player.hand = [handCard];
  assert.equal(legalActivatedAbilityOptions(game, armory.instanceId).length, 1);
  assert.equal(activateCard(game, armory.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedDiscard");
  assert.equal(chooseEffectOption(game, handCard.instanceId).ok, true);
  assert.equal(game.pendingPayment?.discardCost, 1);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === handCard.instanceId), false);
  assert.equal(player.trash.some((card) => card.instanceId === handCard.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === trashCard.instanceId), true);
  assert.equal(target.saveWithRuneDomain, DOMAINS.FURY);
  assert.equal(armory.exhausted, true);
});

test("Sett spends his buff during activation finalization before the Might effect resolves", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sett = instance(cards.settBrawler, player.id, "sett-activation-cost");
  sett.buffs = 1;
  player.base = [sett];

  assert.equal(activateCard(game, sett.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, sett.instanceId).ok, true);
  assert.equal(sett.buffs, 0, "the buff is paid before either player gets a response window");
  assert.equal(sett.exhausted, false, "spending Sett's buff does not exhaust him");
  assert.equal(sett.mightModifier, 0, "the +4 Might instruction still waits on the Chain");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(sett.mightModifier, 4);
  assert.equal(sett.exhausted, false);
});

test("cleanup recalls unattached Gear and board objects from the wrong controller's base", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const looseGear = instance(cards.ironBallista, player.id, "cleanup-loose-gear");
  const foreignPermanent = instance(cards.lonelyPoro, opponent.id, "cleanup-foreign-permanent");
  foreignPermanent.controllerId = player.id;
  const foreignRune = rune(DOMAINS.CALM, opponent.id, "cleanup-foreign-rune");
  foreignRune.controllerId = player.id;
  game.battlefields[0].units = [looseGear];
  opponent.base = [foreignPermanent];
  opponent.runes = [foreignRune];

  assert.equal(endTurn(game).ok, true);

  assert.equal(game.battlefields[0].units.some((card) => card.instanceId === looseGear.instanceId), false);
  assert.equal(player.base.some((card) => card.instanceId === looseGear.instanceId), true);
  assert.equal(opponent.base.some((card) => card.instanceId === foreignPermanent.instanceId), false);
  assert.equal(player.base.some((card) => card.instanceId === foreignPermanent.instanceId), true);
  assert.equal(opponent.runes.some((card) => card.instanceId === foreignRune.instanceId), false);
  assert.equal(player.runes.some((card) => card.instanceId === foreignRune.instanceId), true);
});

test("Open-state cleanup removes control when the controller has no unit without awarding it to an occupant", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [instance(cards.lonelyPoro, opponent.id, "cleanup-remaining-opponent")];

  assert.equal(endTurn(game).ok, true);
  assert.equal(field.controlledBy, null,
    "rule 187.4.c removes the absent controller but does not establish control for the remaining player");
});

test("cleanup assigns combat designations before lethal damage uses Shield Might", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defenderPlayer = game.players.find((candidate) => candidate.id !== attacker.id);
  const source = instance(cards.lonelyPoro, attacker.id, "shield-cleanup-source");
  const defender = instance(cards.stalwartPoro, defenderPlayer.id, "shield-cleanup-defender");
  defender.damage = defender.might;
  const field = game.battlefields[0];
  field.units = [source, defender];
  game.phase = "showdown";
  game.currentPlayerId = defenderPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defenderPlayer.id,
    combat: true,
    focusPlayerId: attacker.id,
    priorityPlayerId: defenderPlayer.id,
    consecutivePasses: 1,
    chainSequence: 1,
    suppressFocusPassOnEmpty: true,
    chain: [finalizedTriggerItem(source, attacker.id, "shield-cleanup-chain-item")]
  };

  assert.equal(defender.combatRole, undefined);
  assert.equal(passShowdown(game, defenderPlayer.id).ok, true);

  assert.equal(defender.combatRole, "defender", "rule 323.2 assigns the role before lethal cleanup");
  assert.equal(field.units.some((unit) => unit.instanceId === defender.instanceId), true);
  assert.equal(defenderPlayer.trash.some((card) => card.instanceId === defender.instanceId), false);
});

test("a choice in a multi-effect card explicitly continues the remaining effects before finishing the spell", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const target = instance(cards.lonelyPoro, player.id, "effect-sequence-target");
  const spell = instance({
    ...cards.findYourCenter,
    name: "Effect Sequence Test",
    effects: [
      { timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 1 },
      { timing: "spell", kind: "channelRunes", amount: 1, exhausted: true }
    ]
  }, player.id, "effect-sequence-spell");
  player.base = [target];
  player.runes = [];
  player.runeDeck = [rune(DOMAINS.CALM, player.id, "effect-sequence-rune")];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(game.pendingChoice?.effect, "modifyMight");
  assert.equal(player.runes.length, 0);

  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.mightModifier, 1);
  assert.equal(player.runes.some((card) => card.instanceId === "effect-sequence-rune"), true);
  assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), true);
});

test("triggers created during an effect wait until every instruction and draw has finished", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const jewel = instance(cards.frigidJewel, player.id, "effect-trigger-jewel");
  const target = instance(cards.lonelyPoro, player.id, "effect-trigger-target");
  const spell = instance({
    ...cards.findYourCenter,
    name: "Deferred Trigger Test",
    effects: [
      { timing: "spell", kind: "draw", amount: 3 },
      { timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 1 }
    ]
  }, player.id, "effect-trigger-spell");
  player.base = [jewel, target];
  player.hand = [];
  player.mainDeck = [
    instance(cards.charm, player.id, "effect-trigger-draw-1"),
    instance(cards.gust, player.id, "effect-trigger-draw-2"),
    instance(cards.flash, player.id, "effect-trigger-draw-3")
  ];
  player.drawCountThisTurn = 0;

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(player.hand.length, 3, "the third draw is still part of the resolving instruction");
  assert.equal(game.pendingChoice?.effect, "modifyMight", "the later spell instruction owns the current choice");

  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "secondDrawBuff", "the nested trigger is played only after the spell finishes");
  assert.equal(game.pendingChoice?.data?.declareTrigger, true);
  assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), true);

  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.mightModifier, 3);
});

test("lethal damage waits for every later instruction in the same Chain item", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const target = instance(cards.lonelyPoro, player.id, "deferred-lethal-sequence-target");
  const spell = instance({
    ...cards.findYourCenter,
    name: "Deferred Lethal Sequence Test",
    effects: [
      { timing: "spell", kind: "dealDamageUnit", target: "friendlyUnit", amount: 3 },
      { timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2 }
    ]
  }, player.id, "deferred-lethal-sequence-spell");
  player.base = [target];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(game.pendingChoice?.effect, "damageUnit");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "modifyMight");
  assert.equal(target.damage, 3);
  assert.equal(player.base.some((card) => card.instanceId === target.instanceId), true,
    "cleanup cannot kill the unit between instructions of one Chain item");

  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, 3);
  assert.equal(target.mightModifier, 2);
  assert.equal(player.base.some((card) => card.instanceId === target.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), true);
});

test("Disintegrate draws only when its own damage event kills the unit", () => {
  const lethalGame = createGame({ interactive: true });
  finishSetup(lethalGame);
  const lethalPlayer = currentPlayer(lethalGame);
  const lethalOpponent = lethalGame.players.find((candidate) => candidate.id !== lethalPlayer.id);
  const lethalTarget = instance(cards.lonelyPoro, lethalOpponent.id, "disintegrate-lethal-target");
  const lethalDraw = instance(cards.flash, lethalPlayer.id, "disintegrate-lethal-draw");
  lethalGame.battlefields[0].units = [lethalTarget];
  lethalGame.battlefields[0].controlledBy = lethalOpponent.id;
  lethalPlayer.mainDeck = [lethalDraw];

  assert.equal(resolveEffect(lethalGame, lethalPlayer,
    instance(cards.disintegrate, lethalPlayer.id, "disintegrate-lethal-spell")), true);
  assert.equal(chooseEffectOption(lethalGame, lethalTarget.instanceId).ok, true);
  assert.equal(lethalOpponent.trash.some((card) => card.instanceId === lethalTarget.instanceId), true);
  assert.equal(lethalPlayer.hand.some((card) => card.instanceId === lethalDraw.instanceId), true);

  const nonlethalGame = createGame({ interactive: true });
  finishSetup(nonlethalGame);
  const nonlethalPlayer = currentPlayer(nonlethalGame);
  const nonlethalOpponent = nonlethalGame.players.find((candidate) => candidate.id !== nonlethalPlayer.id);
  const nonlethalTarget = instance(cards.vilemaw, nonlethalOpponent.id, "disintegrate-nonlethal-target");
  const withheldDraw = instance(cards.flash, nonlethalPlayer.id, "disintegrate-withheld-draw");
  nonlethalGame.battlefields[0].units = [nonlethalTarget];
  nonlethalGame.battlefields[0].controlledBy = nonlethalOpponent.id;
  nonlethalPlayer.mainDeck = [withheldDraw];

  assert.equal(resolveEffect(nonlethalGame, nonlethalPlayer,
    instance(cards.disintegrate, nonlethalPlayer.id, "disintegrate-nonlethal-spell")), true);
  assert.equal(chooseEffectOption(nonlethalGame, nonlethalTarget.instanceId).ok, true);
  assert.equal(nonlethalGame.battlefields[0].units.some((card) => card.instanceId === nonlethalTarget.instanceId), true);
  assert.equal(nonlethalPlayer.hand.some((card) => card.instanceId === withheldDraw.instanceId), false);
});

test("Annie, Stubborn explicitly returns a chosen spell, not a unit, from trash", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const annie = instance(cards.annieStubborn, player.id, "annie-stubborn");
  const spell = instance(cards.confront, player.id, "annie-spell");
  const unit = instance(cards.lonelyPoro, player.id, "annie-unit");
  player.hand = [annie];
  player.trash = [unit, spell];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `annie-rune-${index}`));

  assert.equal(beginPlayCard(game, annie.instanceId, "base").ok, true);
  for (const runeCard of player.runes.slice(0, 4)) assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  assert.equal(togglePaymentRune(game, player.runes[4].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "returnTrashUnitToHand");
  assert.equal(game.pendingChoice?.data.cardType, "spell");
  assert.deepEqual(game.pendingChoice?.options.map((option) => option.cardId), [spell.instanceId]);

  assert.equal(chooseEffectOption(game, spell.instanceId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === spell.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === unit.instanceId), true);
});

test("Pit Rookie can buff another friendly unit but never itself", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const rookie = instance(cards.pitRookie, player.id, "pit-rookie-source");
  const friendly = instance(cards.lonelyPoro, player.id, "pit-rookie-friendly");
  const enemy = instance(cards.lonelyPoro, opponent.id, "pit-rookie-enemy");
  player.hand = [rookie];
  player.base = [friendly];
  opponent.base = [enemy];
  player.runes = Array.from({ length: 2 }, (_, index) => rune(DOMAINS.BODY, player.id, `pit-rookie-rune-${index}`));

  assert.equal(beginPlayCard(game, rookie.instanceId, "base").ok, true);
  for (const runeCard of player.runes) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice?.effect, "buffUnit");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [friendly.instanceId]);
  assert.equal(chooseEffectOption(game, friendly.instanceId).ok, true);
  assert.equal(friendly.buffs, 1);
  assert.equal(rookie.buffs, 0);
});

test("multiplayer Kinkou Monk can pass its remaining optional buff target", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const monk = instance(cards.kinkouMonk, player.id, "kinkou-pass-source");
  const first = instance(cards.lonelyPoro, player.id, "kinkou-pass-first");
  const second = instance(cards.lonelyPoro, player.id, "kinkou-pass-second");
  player.hand = [monk];
  player.base = [first, second];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.BODY, player.id, `kinkou-pass-rune-${index}`));
  const room = {
    game,
    hostPlayerId: player.id,
    seats: Object.fromEntries(game.players.map((candidate) => [candidate.id, { ready: true }]))
  };

  assert.equal(applyGameCommand(room, player.id, {
    kind: "beginPlayCard",
    cardId: monk.instanceId,
    destination: "base"
  }).ok, true);
  for (const runeCard of player.runes.slice(0, 4)) {
    assert.equal(applyGameCommand(room, player.id, {
      kind: "togglePaymentRune",
      runeId: runeCard.instanceId,
      mode: "energy"
    }).ok, true);
  }
  assert.equal(applyGameCommand(room, player.id, {
    kind: "togglePaymentRune",
    runeId: player.runes[4].instanceId,
    mode: "power"
  }).ok, true);
  assert.equal(applyGameCommand(room, player.id, { kind: "confirmPayment" }).ok, true);

  for (let guard = 0; !game.pendingChoice && game.actionChain && guard < 8; guard += 1) {
    const actorId = game.actionChain.priorityPlayerId;
    assert.equal(applyGameCommand(room, actorId, { kind: "passShowdown" }).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "buffUnit");
  assert.equal(applyGameCommand(room, player.id, {
    kind: "chooseEffectOption",
    optionId: first.instanceId
  }).ok, true);
  assert.equal(game.pendingChoice?.effect, "buffUnit");

  const clientGame = snapshotForPlayer(room, player.id).game;
  assert.deepEqual(resolveLegalAction(clientGame, { kind: "declineEffectChoice" }, player.id), {
    kind: "declineEffectChoice"
  });
  assert.equal(applyGameCommand(room, player.id, { kind: "declineEffectChoice" }).ok, true);

  for (let guard = 0; game.actionChain && guard < 8; guard += 1) {
    const actorId = game.actionChain.priorityPlayerId;
    const result = applyGameCommand(room, actorId, { kind: "passShowdown" });
    assert.equal(result.ok, true, `${result.message || "pass rejected"}; pending=${game.pendingChoice?.effect || "none"}; priority=${actorId}`);
  }
  assert.equal(first.buffs, 1);
  assert.equal(second.buffs, 0);
  assert.equal(monk.buffs, 0);
});

test("every declared unit-token effect creates the right unique tokens in the right state and zone", () => {
  const tokenCards = new Map(Object.values(cards).flatMap((card) => [card.cardNumber, card.collectorNumber, card.id].filter(Boolean).map((number) => [number, card])));
  const declarations = Object.values(cards).flatMap((card) => (card.effects || [])
    .filter((effect) => effect.kind === "playUnitToken")
    .map((effect) => ({ card, effect })));
  assert.ok(declarations.length >= 10, "expected all registered token generators to be covered");

  for (const { card, effect } of declarations) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const source = instance(card, player.id, `token-source-${card.id}-${effect.timing}`);
    const battlefield = game.battlefields[0];
    battlefield.controlledBy = player.id;
    battlefield.units = [];
    let explicitDestination = null;
    if (effect.destination === "sourceBattlefield") battlefield.units.push(source);
    if (effect.destination === "movedBattlefield") explicitDestination = battlefield.instanceId;
    if (effect.destination === "showdownBattlefield") explicitDestination = battlefield.instanceId;
    if (effect.destination === "hiddenBattlefield") source.hiddenBattlefieldId = battlefield.instanceId;

    const beforeIds = new Set([...player.base, ...battlefield.units].map((entry) => entry.instanceId));
    assert.equal(playUnitToken(game, player, source, effect, explicitDestination), true, `${card.name} should generate tokens`);
    const generated = [...player.base, ...battlefield.units].filter((entry) => !beforeIds.has(entry.instanceId));
    const expectedSource = tokenCards.get(effect.tokenCardNumber || "OGN-273/298");
    assert.ok(expectedSource, `${card.name} references a registered token`);
    assert.equal(generated.length, effect.count || 1, `${card.name} token count`);
    assert.equal(new Set(generated.map((entry) => entry.instanceId)).size, generated.length, `${card.name} token IDs are unique`);
    for (const token of generated) {
      assert.equal(token.id, expectedSource.id, `${card.name} token identity`);
      assert.equal(token.ownerId, player.id, `${card.name} token owner`);
      assert.equal(token.controllerId, player.id, `${card.name} token controller`);
      assert.equal(token.exhausted, !Boolean(effect.ready), `${card.name} ready state`);
      assert.equal(token.damage, 0, `${card.name} token starts undamaged`);
      assert.equal(token.stunned, false, `${card.name} token starts unstunned`);
    }
    const battlefieldDestination = ["sourceBattlefield", "movedBattlefield", "showdownBattlefield", "hiddenBattlefield"].includes(effect.destination);
    assert.equal(generated.every((token) => battlefield.units.includes(token)), battlefieldDestination, `${card.name} destination`);
    assert.equal(generated.every((token) => player.base.includes(token)), !battlefieldDestination, `${card.name} base destination`);
  }
});

test("the official token registry exactly implements every Core Rules 184 token", () => {
  assert.deepEqual(officialTokenKinds(), [
    "recruit", "sprite", "sandSoldier", "mech", "gold", "reflection", "bird", "brush", "baronPit"
  ]);
  const expectedUnits = {
    recruit: { might: 1, tags: ["Recruit"], keywords: [] },
    sprite: { might: 3, tags: ["Fae"], keywords: ["Temporary"] },
    sandSoldier: { might: 2, tags: ["Shurima"], keywords: [] },
    mech: { might: 3, tags: ["Mech"], keywords: [] },
    reflection: { might: 0, tags: [], keywords: [] },
    bird: { might: 1, tags: ["Bird"], keywords: ["Deflect"] }
  };
  for (const [kind, expected] of Object.entries(expectedUnits)) {
    const token = OFFICIAL_TOKEN_DEFINITIONS[kind];
    assert.equal(token.type, "unit");
    assert.equal(token.isToken, true);
    assert.deepEqual(token.domains, []);
    assert.equal(token.energy, 0);
    assert.deepEqual({ might: token.might, tags: token.tags, keywords: token.keywords }, expected);
  }
  assert.equal(OFFICIAL_TOKEN_DEFINITIONS.gold.type, "gear");
  assert.equal(OFFICIAL_TOKEN_DEFINITIONS.gold.effects[0].kind, "addPower");
  assert.equal(OFFICIAL_TOKEN_DEFINITIONS.brush.type, "battlefield");
  assert.equal(OFFICIAL_TOKEN_DEFINITIONS.baronPit.type, "battlefield");
});

test("Gold kills and exhausts itself as an Add Reaction cost, then universal Power pays a colored cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.base = [];
  player.runePool = { energy: [], power: [] };
  assert.equal(playToken(game, player, player.legend, { tokenKind: "gold" }), true);
  const gold = player.base.find((card) => card.name === "Gold");
  assert.ok(gold);
  assert.equal(gold.exhausted, false, "gear tokens enter ready by default");

  assert.equal(activateCard(game, gold.instanceId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === gold.instanceId), false);
  assert.equal(player.trash.some((card) => card.instanceId === gold.instanceId), false, "a killed token ceases outside the board");
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.power[0].domain, DOMAINS.ANY);

  const paid = instance({
    ...cards.lonelyPoro,
    id: "TEST-POOL-POWER-CARD",
    cardNumber: "TEST-POOL-POWER-CARD/001",
    collectorNumber: "TEST-POOL-POWER-CARD/001",
    name: "Rules Test Pool Power Card",
    energy: 0,
    power: [{ domain: DOMAINS.BODY, amount: 1 }]
  }, player.id, "pool-power-card");
  player.hand = [paid];
  assert.equal(beginPlayCard(game, paid.instanceId, "base").ok, true);
  assert.equal(togglePaymentPoolPower(game, player.runePool.power[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runePool.power.length, 0);
  assert.equal(player.base.some((card) => card.instanceId === paid.instanceId), true);
});

test("Basic Runes bank Energy by exhausting and matching Power by recycling, including while exhausted", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const energyRune = rune(DOMAINS.BODY, player.id, "basic-energy-rune");
  const powerRune = rune(DOMAINS.BODY, player.id, "basic-power-rune");
  powerRune.exhausted = true;
  player.runes = [energyRune, powerRune];
  player.runeDeck = [];
  player.runePool = { energy: [], power: [] };

  const energyActivation = activateCard(game, energyRune.instanceId, `${energyRune.instanceId}:basic-rune-energy`);
  assert.equal(energyActivation.ok, true, energyActivation.message);
  assert.equal(game.pendingChoice, null, "an explicitly selected Rune ability resolves without a mode dialog");
  assert.equal(energyRune.exhausted, true);
  assert.equal(player.runePool.energy.length, 1);
  assert.equal(player.runePool.energy[0].sourceCardId, energyRune.instanceId);

  assert.equal(activateCard(game, powerRune.instanceId, `${powerRune.instanceId}:basic-rune-power`).ok, true,
    "recycling for Power does not require the Rune to be ready");
  assert.equal(player.runes.some((candidate) => candidate.instanceId === powerRune.instanceId), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === powerRune.instanceId), true);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.power[0].domain, DOMAINS.BODY);
});

test("AI exposes the Rune Power ability independently from its Energy ability", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const powerRune = rune(DOMAINS.BODY, player.id, "ai-basic-power-rune");
  player.runes = [powerRune];
  player.runeDeck = [];
  player.runePool = { energy: [], power: [] };

  const legal = enumerateLegalActions(game, player.id).filter((action) =>
    action.kind === "activateCard" && action.cardId === powerRune.instanceId);
  assert.deepEqual(new Set(legal.map((action) => action.abilityId)), new Set([
    `${powerRune.instanceId}:basic-rune-energy`,
    `${powerRune.instanceId}:basic-rune-power`
  ]));
  const powerAction = legal.find((action) => action.abilityId === `${powerRune.instanceId}:basic-rune-power`);
  assert.equal(applyAiAction(game, powerAction, player.id).ok, true);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.energy.length, 0);
});

test("recycling a Rune selected for Energy clears the stale selection and adds Power", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const selectedRune = rune(DOMAINS.BODY, player.id, "selected-energy-then-power-rune");
  const replacementRune = rune(DOMAINS.BODY, player.id, "replacement-energy-rune");
  const paidCard = instance({
    ...cards.lonelyPoro,
    name: "Resource Transaction Test Unit",
    energy: 1,
    power: []
  }, player.id, "resource-transaction-card");
  player.hand = [paidCard];
  player.runes = [selectedRune, replacementRune];
  player.runeDeck = [];
  player.runePool = { energy: [], power: [] };

  assert.equal(beginPlayCard(game, paidCard.instanceId, "base").ok, true);
  assert.equal(togglePaymentRune(game, selectedRune.instanceId, "energy").ok, true);
  assert.deepEqual(game.pendingPayment.energyRuneIds, [selectedRune.instanceId]);

  const activation = activateCard(game, selectedRune.instanceId, `${selectedRune.instanceId}:basic-rune-power`);
  assert.equal(activation.ok, true, activation.message);
  assert.deepEqual(game.pendingPayment.energyRuneIds, [], "a recycled Rune cannot remain selected for Energy");
  assert.equal(player.runes.some((candidate) => candidate.instanceId === selectedRune.instanceId), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === selectedRune.instanceId), true);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.power[0].domain, DOMAINS.BODY);

  assert.equal(togglePaymentRune(game, replacementRune.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true, "the original payment remains recoverable after recycling");
});

test("the shared payment confirmation gate rejects every incomplete cost before Cast is enabled", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const paidCard = instance({ ...cards.lonelyPoro, energy: 0, power: [] }, player.id, "shared-payment-gate-card");
  const oneRune = rune(DOMAINS.BODY, player.id, "shared-payment-gate-rune");
  const noBuffUnit = instance(cards.lonelyPoro, player.id, "shared-payment-gate-no-buff");
  player.hand = [paidCard];
  player.base = [noBuffUnit];
  player.runes = [oneRune];

  const basePayment = {
    playerId: player.id,
    cardId: paidCard.instanceId,
    source: "hand",
    destination: "base",
    energyCost: 0,
    powerCost: [],
    energyRuneIds: [],
    powerRuneIds: [],
    poolEnergyIds: [],
    poolPowerIds: [],
    declaredChoices: [],
    declaredTargets: []
  };
  const expectRejectedByUiAndEngine = (payment, label) => {
    game.pendingPayment = structuredClone(payment);
    const before = structuredClone(game.pendingPayment);
    assert.equal(paymentConfirmationLegality(game).ok, false, label);
    assert.deepEqual(game.pendingPayment, before, `${label}: checking button state must be pure`);
    assert.equal(confirmPayment(structuredClone(game)).ok, false, `${label}: the engine must agree with the button gate`);
  };

  expectRejectedByUiAndEngine({
    ...basePayment,
    discardCost: 1,
    discardCardIds: []
  }, "an unselected discard cost");
  expectRejectedByUiAndEngine({
    ...basePayment,
    recycleTrashCost: 1,
    recycleTrashCardIds: []
  }, "an unselected recycle cost");
  expectRejectedByUiAndEngine({
    ...basePayment,
    energyCost: 2,
    energyRuneIds: [oneRune.instanceId, oneRune.instanceId]
  }, "the same Rune selected twice for Energy");
  expectRejectedByUiAndEngine({
    ...basePayment,
    declaredChoices: [{ effect: "friendlyBuffAdditionalCost", unitId: noBuffUnit.instanceId }]
  }, "a no-longer-available Buff cost");
});

test("Firestorm has no Cast action unless its full Energy and Fury Power cost can be completed", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const firestorm = instance(cards.firestorm, player.id, "unaffordable-firestorm");
  field.units = [instance(cards.lonelyPoro, opponent.id, "firestorm-enemy-target")];
  field.controlledBy = opponent.id;
  player.hand = [firestorm];
  player.runes = [rune(DOMAINS.FURY, player.id, "firestorm-only-energy")];
  player.runePool = { energy: [], power: [] };

  assert.deepEqual(legalCardPlayDestinations(game, firestorm.instanceId), []);
  assert.equal(enumerateLegalActions(game, player.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === firestorm.instanceId), false);
  assert.equal(beginPlayCard(game, firestorm.instanceId, "base").ok, false);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.hand.includes(firestorm), true);

  player.runes.push(...Array.from({ length: 5 }, (_, index) =>
    rune(DOMAINS.BODY, player.id, `firestorm-energy-${index + 2}`)));
  assert.deepEqual(legalCardPlayDestinations(game, firestorm.instanceId), ["base"]);
  assert.equal(beginPlayCard(game, firestorm.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
});

test("spell-only Energy that can be added during payment keeps an otherwise payable Cast action", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const firestorm = instance(cards.firestorm, player.id, "lux-payable-firestorm");
  const lux = instance(cards.luxCrownguard, player.id, "firestorm-energy-lux");
  field.units = [instance(cards.lonelyPoro, opponent.id, "lux-firestorm-enemy-target")];
  field.controlledBy = opponent.id;
  player.hand = [firestorm];
  player.base = [lux];
  player.runes = [
    rune(DOMAINS.FURY, player.id, "lux-firestorm-fury"),
    rune(DOMAINS.BODY, player.id, "lux-firestorm-energy-2"),
    rune(DOMAINS.CALM, player.id, "lux-firestorm-energy-3"),
    rune(DOMAINS.MIND, player.id, "lux-firestorm-energy-4")
  ];
  player.runePool = { energy: [], power: [] };

  assert.deepEqual(legalCardPlayDestinations(game, firestorm.instanceId), ["base"]);
  assert.equal(enumerateLegalActions(game, player.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === firestorm.instanceId), true);
});

test("Channel is one recorded action and printed exhausted Channel effects enter runes exhausted", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const first = rune(DOMAINS.BODY, player.id, "channel-action-rune-1");
  const second = rune(DOMAINS.BODY, player.id, "channel-action-rune-2");
  player.runes = [];
  player.runeDeck = [first, second];
  const catalyst = instance({ ...cards.catalystOfAeons, energy: 0, power: [] }, player.id, "channel-action-catalyst");

  assert.equal(resolveEffect(game, player, catalyst), false);
  assert.deepEqual(player.runes.map((runeCard) => runeCard.instanceId), [first.instanceId, second.instanceId]);
  assert.deepEqual(player.runes.map((runeCard) => runeCard.exhausted), [true, true]);
  assert.deepEqual(player.runes.map((runeCard) => runeCard.zoneChangeCounter), [1, 1]);
  assert.deepEqual(game.channelEvents.at(-1).runeIds, [first.instanceId, second.instanceId]);
  assert.equal(game.channelEvents.at(-1).exhausted, true);
  assert.equal(game.channelEvents.at(-1).responsiblePlayerId, player.id);
  assert.equal(game.channelEvents.at(-1).sourceCardId, catalyst.instanceId);
});

test("an effect that channels for a returned unit's owner uses that owner and enters the rune exhausted", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const borrowed = instance(cards.lonelyPoro, owner.id, "retreat-borrowed-unit");
  borrowed.controllerId = player.id;
  field.units = [borrowed];
  owner.runeDeck = [rune(DOMAINS.MIND, owner.id, "retreat-owner-rune")];
  owner.runes = [];
  const retreat = instance({ ...cards.retreat, energy: 0, power: [] }, player.id, "retreat-owner-channel");

  assert.equal(resolveEffect(game, player, retreat), true);
  assert.equal(game.pendingChoice?.effect, "returnUnitToHand");
  assert.equal(chooseEffectOption(game, borrowed.instanceId).ok, true);
  assert.equal(owner.hand.some((card) => card.instanceId === borrowed.instanceId), true);
  assert.equal(borrowed.controllerId, owner.id);
  assert.equal(owner.runes[0].instanceId, "retreat-owner-rune");
  assert.equal(owner.runes[0].exhausted, true);
  assert.equal(game.channelEvents.at(-1).playerId, owner.id);
  assert.equal(game.channelEvents.at(-1).responsiblePlayerId, player.id);
});

test("Retreat resolves through manual Chain passes after returning a played friendly champion", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = player.champion;
  target.zone = "played";
  player.championPlayed = true;
  const retreat = instance(cards.retreat, player.id, "retreat-manual-chain");
  player.base = [target];
  player.hand = [retreat];
  player.runes = [rune(DOMAINS.MIND, player.id, "retreat-payment-rune")];
  player.runeDeck = [rune(DOMAINS.MIND, player.id, "retreat-channeled-rune")];
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "retreat-enemy-unit")];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, target.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");

  assert.equal(beginPlayCard(game, retreat.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "retreat-payment-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.ok(game.showdown);

  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);

  assert.ok(game.showdown, "combat continues after Retreat resolves");
  assert.equal(player.base.some((card) => card.instanceId === target.instanceId), false);
  assert.equal(player.hand.some((card) => card.instanceId === target.instanceId), true);
  assert.equal(player.champion, null);
  assert.equal(player.runes.some((card) => card.instanceId === "retreat-channeled-rune" && card.exhausted), true);
  assert.equal(player.trash.some((card) => card.instanceId === retreat.instanceId), true);
});

test("Brush and Baron Pit battlefield tokens share the Replace framework and their printed movement and Might rules", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const original = game.battlefields[0];
  const poro = instance(cards.lonelyPoro, player.id, "brush-poro");
  original.units = [poro];
  original.controlledBy = player.id;

  const brush = replaceBattlefieldWithToken(game, original.instanceId, "brush", player.id);
  assert.ok(brush);
  assert.equal(player.banished.some((card) => card.instanceId === original.instanceId && card.replacedInBanishment), true);
  assert.equal(currentMight(game, poro), poro.might + 1);
  const restored = swapBackBattlefieldToken(game, brush.instanceId);
  assert.equal(restored.instanceId, original.instanceId);
  assert.equal(game.battlefields[0].instanceId, original.instanceId,
    "the restored battlefield must replace the token in the shared battlefield list");
  assert.equal(game.battlefields.some((field) => field.instanceId === brush.instanceId), false);
  assert.deepEqual(restored.units.map((unit) => unit.instanceId), [poro.instanceId]);
  assert.equal(player.banished.some((card) => card.instanceId === original.instanceId), false);

  const sourceField = game.battlefields[0];
  const targetField = game.battlefields[1];
  const mover = instance(cards.lonelyPoro, player.id, "baron-anywhere-mover");
  sourceField.units = [mover];
  sourceField.controlledBy = player.id;
  targetField.units = [];
  targetField.controlledBy = player.id;
  const baron = replaceBattlefieldWithToken(game, targetField.instanceId, "baronPit", player.id);
  assert.ok(baron);
  assert.equal(moveUnit(game, mover.instanceId, baron.instanceId).ok, true,
    "Baron Pit permits a non-Ganking unit to move there from another battlefield");
  assert.equal(baron.units.some((unit) => unit.instanceId === mover.instanceId), true);
});

test("Brush offers its optional swap-back trigger only after its controller actually scores", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const original = game.battlefields[0];
  original.controlledBy = player.id;
  original.units = [];
  const brush = replaceBattlefieldWithToken(game, original.instanceId, "brush", player.id);
  assert.ok(brush);

  startTurn(game);
  assert.equal(player.score, 1);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(game.pendingChoice?.card?.instanceId, brush.instanceId);
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.battlefields.some((field) => field.instanceId === brush.instanceId), false);
  assert.equal(game.battlefields.some((field) => field.instanceId === original.instanceId), true);
  assert.equal(player.banished.some((card) => card.instanceId === original.instanceId), false);
});

test("all special token triggers reference valid tokens with explicit quantities", () => {
  const tokenNumbers = new Set(Object.values(cards).filter((card) => card.tags?.includes("Token"))
    .flatMap((card) => [card.cardNumber, card.collectorNumber, card.id]));
  const effects = Object.values(cards).flatMap((card) => (card.effects || []).map((effect) => ({ card, effect })))
    .filter(({ effect }) => ["opponentTurnRecruit", "playRecruitOnOtherFriendlyNonRecruitDeath"].includes(effect.kind));
  assert.ok(effects.length >= 2);
  for (const { card, effect } of effects) {
    assert.ok(tokenNumbers.has(effect.tokenCardNumber || "OGN-273/298"), `${card.name} token reference`);
    assert.ok((effect.count || 1) > 0, `${card.name} token quantity`);
  }
});

test("ready Temporary Sprite tokens die at their controller's next Beginning Phase before scoring", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const source = instance(cards.spriteMother, player.id, "temporary-sprite-source");
  assert.equal(playUnitToken(game, player, source, cards.spriteMother.effects[0], "base"), true);
  const sprite = player.base.find((card) => card.name === "Sprite");
  assert.ok(sprite);
  assert.equal(sprite.exhausted, false);

  startTurn(game);
  assert.equal(player.base.some((card) => card.instanceId === sprite.instanceId), false);
  assert.equal(player.trash.some((card) => card.instanceId === sprite.instanceId), false);
});

function finishSetup(game) {
  game.setupRandomValues = game.players.map(() => 0);
  finishChampionSelection(game);
  while (game.phase === "battlefield-select") {
    const player = game.players.find((candidate) => candidate.id === game.setupPlayerId);
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  while (game.phase === "mulligan") {
    skipMulligan(game);
  }
}

function finishChampionSelection(game) {
  if (game.phase === "first-player") confirmFirstPlayer(game);
  while (game.phase === "champion-select") {
    const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
    selectChampion(game, player.id, player.availableChampions[0].instanceId);
  }
}

function expectedDeckSize(deck) {
  const extraChampionCards = deck.champion ? Math.max(1, deck.championCount || 1) : 0;
  return deck.main.length + extraChampionCards - 1;
}

function initialMainDeckSize(game, playerIndex) {
  const player = game.players[playerIndex];
  return expectedDeckSize(playerIndex === 0 ? decklists.keenanXiong : decklists.drowsy) + 1 - player.availableChampions.length;
}

function scoreCells(leftScore, rightScore) {
  const labels = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1];
  return labels.map((label, index) => ({
    label,
    leftActive: leftScore > 0 && leftScore === index + 1,
    rightActive: rightScore > 0 && rightScore === labels.length - index
  }));
}

function payPendingEnergy(game, runeIds) {
  for (const runeId of runeIds) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
}

function hideWithRune(game, cardId, battlefieldId, runeId) {
  assert.equal(hideCard(game, cardId, battlefieldId).ok, true);
  assert.equal(game.pendingPayment?.source, "hideCard");
  assert.equal(togglePaymentRune(game, runeId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
}

test("game starts with the supplied deck seats and first-player confirmation", () => {
  const game = createGame({ interactive: true });

  assert.equal(game.phase, "first-player");
  assert.equal(game.firstPlayerId, "p1");
  assert.deepEqual(game.turnOrder, ["p1", "p2"]);
  assert.equal(game.players[0].name, "Calm/Body Master Yi");
  assert.equal(game.players[1].name, "Mind/Chaos Diana");
  assert.equal(game.players[0].mainDeck.length, initialMainDeckSize(game, 0));
  assert.equal(game.players[1].mainDeck.length, initialMainDeckSize(game, 1));
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.players[0].availableChampions.length, 1);
  assert.deepEqual(game.players[0].availableChampions.map((card) => card.name), ["Master Yi, Tempered"]);
  assert.deepEqual(game.players[1].availableChampions.map((card) => card.name), ["Diana, Lunari"]);
  assert.equal(game.players[0].availableBattlefields.length, 3);
  assert.equal(game.players[0].legend.name, "Master Yi, Wuju Bladesman");
  assert.equal(game.players[0].champion, null);
  assert.equal(game.players[1].legend.name, "Diana, Scorn of the Moon");
  assert.equal(game.players[1].champion, null);
  assert.ok(game.players[0].legend.image.includes("exburst.dev/riftbound/cards"));
  assert.ok(game.players[1].availableChampions[0].image.includes("UNL-079-219.webp"));

  assert.equal(confirmFirstPlayer(game).ok, true);
  assert.equal(game.phase, "champion-select");
  assert.equal(game.championSelectPlayerId, "p1");
});

test("random play order uses one die per player, rerolls ties, and lets the high roller choose", () => {
  const game = createGame({ interactive: true, randomFirstPlayer: true, randomSeed: 1 });

  assert.equal(game.firstPlayerId, null);
  assert.equal(game.firstPlayerDecision.rollerId, "p1");
  assert.equal(rollFirstPlayer(game, "p2").ok, false);
  assert.equal(rollFirstPlayer(game, "p1").value, 1);
  assert.equal(game.firstPlayerDecision.rollerId, "p2");
  assert.deepEqual(enumerateLegalActions(game, "p2"), [{ kind: "rollFirstPlayer" }]);

  const tied = rollFirstPlayer(game, "p2");
  assert.equal(tied.tie, true);
  assert.equal(game.firstPlayerDecision.round, 2);
  assert.deepEqual(game.firstPlayerDecision.previousRolls, { p1: 1, p2: 1 });
  assert.deepEqual(game.firstPlayerDecision.rolls, { p1: null, p2: null });

  assert.equal(rollFirstPlayer(game, "p1").value, 4);
  const winningRoll = rollFirstPlayer(game, "p2");
  assert.equal(winningRoll.value, 1);
  assert.equal(winningRoll.winnerId, "p1");
  assert.equal(game.firstPlayerDecision.status, "choosing");
  assert.deepEqual(enumerateLegalActions(game, "p1"), [
    { kind: "chooseFirstPlayer", playerId: "p1" },
    { kind: "chooseFirstPlayer", playerId: "p2" }
  ]);
  assert.equal(chooseFirstPlayer(game, "p2", "p2").ok, false);

  assert.equal(chooseFirstPlayer(game, "p1", "p2").ok, true);
  assert.equal(game.phase, "champion-select");
  assert.equal(game.firstPlayerId, "p2");
  assert.deepEqual(game.turnOrder, ["p2", "p1"]);
  assert.equal(game.championSelectPlayerId, "p2");
});

test("registered cards and generated runes have real unique card numbers", () => {
  const registeredNumbers = Object.values(cards).map((card) => card.cardNumber);
  assert.equal(registeredNumbers.length, new Set(registeredNumbers).size);
  assert.equal(cards.charm.cardNumber, "OGN-043/298");
  assert.equal(cards.masterYiWujuBladesman.cardNumber, "OGS-019/024");
  assert.equal(cards.stalwartPoro.cardNumber, "OGN-052/298");

  assert.equal(makeRune(DOMAINS.FURY).cardNumber, "OGN-007/298");
  assert.equal(makeRune(DOMAINS.CALM).cardNumber, "OGN-042/298");
  assert.equal(makeRune(DOMAINS.MIND).cardNumber, "OGN-089/298");
  assert.equal(makeRune(DOMAINS.BODY).cardNumber, "OGN-126/298");
  assert.equal(makeRune(DOMAINS.CHAOS).cardNumber, "OGN-166/298");
  assert.equal(makeRune(DOMAINS.ORDER).cardNumber, "OGN-214/298");
});

test("all 24 Proving Grounds cards are registered with playable card data", () => {
  const ogsCards = Object.values(cards)
    .filter((card) => card.cardNumber.startsWith("OGS-"))
    .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber));
  assert.equal(ogsCards.length, 24);
  assert.deepEqual(
    ogsCards.map((card) => card.cardNumber),
    Array.from({ length: 24 }, (_, index) => `OGS-${String(index + 1).padStart(3, "0")}/024`)
  );
  for (const card of ogsCards) {
    assert.ok(card.name);
    assert.ok(card.image);
    assert.ok(Array.isArray(card.effects));
    if (["unit", "spell", "gear"].includes(card.type)) assert.ok(Number.isFinite(card.energy));
    if (card.type === "unit") assert.ok(Number.isFinite(card.might));
  }
});

test("Proving Grounds costs and stats match the published card data", () => {
  const expected = {
    "OGS-001/024": [5, 4, "Fury:1"],
    "OGS-002/024": [6, null, "Fury:1"],
    "OGS-003/024": [2, null, ""],
    "OGS-004/024": [5, 4, "Calm:1"],
    "OGS-005/024": [6, 6, "Calm:1"],
    "OGS-006/024": [6, 5, "Mind:1"],
    "OGS-007/024": [6, 5, "Body:1"],
    "OGS-008/024": [6, null, "Body:1"],
    "OGS-009/024": [7, 6, "Body:1"],
    "OGS-010/024": [4, 3, "Chaos:1"],
    "OGS-011/024": [2, null, ""],
    "OGS-012/024": [6, null, "Order:1"],
    "OGS-013/024": [6, 5, "Order:1"],
    "OGS-014/024": [4, 2, ""],
    "OGS-015/024": [6, null, ""],
    "OGS-016/024": [6, 5, "Order:1"],
    "OGS-017/024": [null, null, ""],
    "OGS-018/024": [8, 7, "Fury:1,Chaos:1"],
    "OGS-019/024": [null, null, ""],
    "OGS-020/024": [4, null, ""],
    "OGS-021/024": [null, null, ""],
    "OGS-022/024": [8, null, ""],
    "OGS-023/024": [null, null, ""],
    "OGS-024/024": [5, null, "Body:1"]
  };

  for (const [cardNumber, [energy, might, power]] of Object.entries(expected)) {
    const card = Object.values(cards).find((candidate) => candidate.cardNumber === cardNumber);
    assert.ok(card, `${cardNumber} should be registered`);
    assert.equal(card.energy ?? null, energy, `${cardNumber} energy`);
    assert.equal(card.might ?? null, might, `${cardNumber} might`);
    assert.equal((card.power || []).map((cost) => `${cost.domain}:${cost.amount}`).join(","), power, `${cardNumber} power`);
  }
  assert.equal(cards.whirlwind.energy, 4);
  assert.deepEqual(cards.whirlwind.power, [{ domain: DOMAINS.CHAOS, amount: 1 }]);
});

test("Annie, Fiery requires both 5 Energy and 1 Fury Power", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const annie = instance(cards.annieFiery, player.id, "annie-fiery-cost");
  player.hand = [annie];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.FURY, player.id, `annie-fiery-rune-${index}`));

  assert.equal(beginPlayCard(game, annie.instanceId, "base").ok, true);
  for (const runeCard of player.runes.slice(0, 5)) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, false);
  assert.ok(game.pendingPayment);

  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === annie.instanceId), true);
});

test("Incinerate sends a unit with lethal damage to its owner's trash", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = instance(cards.lonelyPoro, opponent.id, "incinerate-lethal-target");
  const incinerate = instance(cards.incinerate, player.id, "incinerate-lethal-spell");
  const field = game.battlefields[0];
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [incinerate];
  player.runes = Array.from({ length: 2 }, (_, index) => rune(DOMAINS.FURY, player.id, `incinerate-rune-${index}`));

  assert.equal(beginPlayCard(game, incinerate.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  for (const runeCard of player.runes) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(opponent.trash.some((card) => card.instanceId === target.instanceId), true);
  assert.equal(opponent.base.some((card) => card.instanceId === target.instanceId), false);
  assert.equal(field.units.some((card) => card.instanceId === target.instanceId), false);
});

test("Annie's static Bonus Damage never exhausts Annie or the damaged unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const annie = instance(cards.annieFiery, player.id, "static-bonus-annie");
  const target = instance({ ...cards.masterYiMeditative, might: 10, effects: [] }, opponent.id, "static-bonus-target");
  const incinerate = instance(cards.incinerate, player.id, "static-bonus-incinerate");
  const field = game.battlefields[0];
  player.base = [annie];
  player.hand = [incinerate];
  player.runes = Array.from({ length: 2 }, (_, index) => rune(DOMAINS.FURY, player.id, `static-bonus-rune-${index}`));
  field.units = [target];
  field.controlledBy = opponent.id;

  assert.equal(beginPlayCard(game, incinerate.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  for (const runeCard of player.runes) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(target.damage, 3, "Incinerate deals 2 plus Annie's one static Bonus Damage");
  assert.equal(annie.exhausted, false, "a static effect has no implicit Exhaust cost");
  assert.equal(target.exhausted, false, "marking damage does not alter the target's Ready state");
  assert.deepEqual(game.exhaustEvents?.flatMap((event) => event.cardIds) || [],
    player.runes.map((card) => card.instanceId), "only the Energy payment exhausts cards");
});

test("decklists are stored by collector card number before resolving card objects", () => {
  assert.equal(rawDecklists.keenanXiong.legend, "OGS-019/024");
  assert.deepEqual(rawDecklists.keenanXiong.battlefields, ["SFD-208/221", "OGN-290/298", "OGN-295/298"]);
  assert.equal(rawDecklists.keenanXiong.main.some(([cardNumber]) => cardNumber === "OGN-043/298"), true);
  assert.equal(rawDecklists.drowsy.legend, "UNL-197/219");
  assert.equal(rawDecklists.drowsy.main.some(([cardNumber]) => cardNumber === "OGN-095/298"), true);
  assert.equal(decklists.keenanXiong.legend.name, "Master Yi, Wuju Bladesman");
  assert.equal(decklists.drowsy.main.some((card) => card.cardNumber === "SFD-146/221"), true);
});

test("default raw decklists satisfy the centralized deck construction rules", () => {
  const cardByNumber = (cardNumber) => Object.values(cards).find((card) => card.cardNumber === cardNumber) || null;

  for (const [deckId, deck] of Object.entries(rawDecklists)) {
    const validation = validateDeckRecord(deck, cardByNumber);
    assert.deepEqual(validation.messages, [], deckId);
    assert.equal(validation.playable, true, deckId);
    assert.equal(deck.runes.reduce((total, [, count]) => total + count, 0), DECK_RULES.runeExact);
    assert.equal(deck.battlefields.length, DECK_RULES.battlefieldsExact);
  }
});

test("deck validation enforces the combined Signature limit and Legend champion identity", () => {
  const cardByNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number) || null;
  const base = structuredClone(rawDecklists.provingGroundsMasterYi);
  const highlander = cardByNumber("OGS-020/024");
  const decisiveStrike = cardByNumber("OGS-024/024");
  assert.ok(highlander && decisiveStrike);

  const tooMany = structuredClone(base);
  tooMany.main = tooMany.main.filter(([number]) => number !== highlander.cardNumber);
  tooMany.main.push([highlander.cardNumber, 2], [highlander.collectorNumber, 2]);
  const tooManyValidation = validateDeckRecord(tooMany, cardByNumber);
  assert.equal(tooManyValidation.playable, false);
  assert.ok(tooManyValidation.messages.some((message) => message.includes("Signature") && message.includes("합계")));

  const wrongChampion = structuredClone(base);
  wrongChampion.main = wrongChampion.main.filter(([number]) => number !== highlander.cardNumber);
  wrongChampion.main.push([decisiveStrike.cardNumber, 1]);
  const wrongChampionValidation = validateDeckRecord(wrongChampion, cardByNumber);
  assert.equal(wrongChampionValidation.playable, false);
  assert.ok(wrongChampionValidation.messages.some((message) => message.includes("챔피언 태그")));
});

test("deck validation requires a real Champion card and rejects off-identity runes", () => {
  const cardByNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number) || null;
  const noChampion = structuredClone(rawDecklists.provingGroundsMasterYi);
  noChampion.main = noChampion.main.filter(([number]) => {
    const card = cardByNumber(number);
    return !card?.isChampion && !card?.tags?.includes("Champion");
  });
  const noChampionValidation = validateDeckRecord(noChampion, cardByNumber);
  assert.equal(noChampionValidation.playable, false);
  assert.ok(noChampionValidation.messages.some((message) => message.includes("Champion Unit") && message.includes("Main Deck")));

  const sideboardOnlyChampion = structuredClone(rawDecklists.provingGroundsMasterYi);
  const championEntries = sideboardOnlyChampion.main.filter(([number]) => {
    const card = cardByNumber(number);
    return card?.isChampion || card?.tags?.includes("Champion");
  });
  sideboardOnlyChampion.main = sideboardOnlyChampion.main.filter(([number]) => {
    const card = cardByNumber(number);
    return !card?.isChampion && !card?.tags?.includes("Champion");
  });
  sideboardOnlyChampion.sideboard = championEntries;
  const sideboardOnlyValidation = validateDeckRecord(sideboardOnlyChampion, cardByNumber);
  assert.equal(sideboardOnlyValidation.playable, false);
  assert.ok(sideboardOnlyValidation.messages.some((message) => message.includes("Champion Unit") && message.includes("Main Deck")));

  const wrongRunes = structuredClone(rawDecklists.provingGroundsMasterYi);
  wrongRunes.runes = [[DOMAINS.CALM, 6], [DOMAINS.FURY, 6]];
  const wrongRunesValidation = validateDeckRecord(wrongRunes, cardByNumber);
  assert.equal(wrongRunesValidation.playable, false);
  assert.ok(wrongRunesValidation.messages.some((message) => message.includes("Domain Identity")));
});

test("deck validation enforces Main Deck identity, matching Chosen Champions, and unique Battlefields", () => {
  const cardByNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number) || null;
  const base = structuredClone(rawDecklists.provingGroundsMasterYi);

  const offIdentity = structuredClone(base);
  offIdentity.main[0][0] = cards.firestorm.cardNumber;
  const offIdentityValidation = validateDeckRecord(offIdentity, cardByNumber);
  assert.equal(offIdentityValidation.playable, false);
  assert.ok(offIdentityValidation.messages.some((message) => message.includes(cards.firestorm.name) && message.includes("Domain Identity")));

  const noMatchingChampion = structuredClone(base);
  noMatchingChampion.main = noMatchingChampion.main.map(([number, count]) => {
    const card = cardByNumber(number);
    return (card?.tags || []).includes("Master Yi") ? [cards.rengarTrophyHunter.cardNumber, count] : [number, count];
  });
  const noMatchingChampionValidation = validateDeckRecord(noMatchingChampion, cardByNumber);
  assert.equal(noMatchingChampionValidation.playable, false);
  assert.ok(noMatchingChampionValidation.messages.some((message) => message.includes("Champion Unit")));

  const duplicateBattlefields = structuredClone(base);
  duplicateBattlefields.battlefields = Array(3).fill(base.battlefields[0]);
  const duplicateBattlefieldValidation = validateDeckRecord(duplicateBattlefields, cardByNumber);
  assert.equal(duplicateBattlefieldValidation.playable, false);
  assert.ok(duplicateBattlefieldValidation.messages.some((message) => message.includes("Battlefield") && message.includes("once")));

  const tooManyCopies = structuredClone(base);
  tooManyCopies.main[0][1] = 4;
  tooManyCopies.main[1][1] -= 1;
  const tooManyCopiesValidation = validateDeckRecord(tooManyCopies, cardByNumber);
  assert.equal(tooManyCopiesValidation.playable, false);
  assert.ok(tooManyCopiesValidation.messages.some((message) => message.includes("at most 3")));
});

test("deck validation enforces the Unique one-copy rule across Main Deck and Sideboard", () => {
  const registeredCard = (number) => Object.values(cards).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number) || null;
  const deck = structuredClone(rawDecklists.provingGroundsMasterYi);
  const sourceEntry = deck.main.find(([number, count]) => count >= 3
    && !registeredCard(number)?.isChampion
    && !registeredCard(number)?.tags?.includes("Champion"));
  assert.ok(sourceEntry);
  const source = registeredCard(sourceEntry[0]);
  const unique = { ...structuredClone(source), id: "TEST-UNIQUE", cardNumber: "TEST-UNIQUE/001", collectorNumber: "TEST-UNIQUE/001", name: "Rules Test Unique", keywords: [...(source.keywords || []), "Unique"] };
  sourceEntry[1] -= 2;
  deck.main.push([unique.cardNumber, 1]);
  deck.sideboard = [...(deck.sideboard || []), [unique.cardNumber, 1]];
  const cardByNumber = (number) => number === unique.cardNumber ? unique : registeredCard(number);

  const validation = validateDeckRecord(deck, cardByNumber);

  assert.equal(validation.playable, false);
  assert.ok(validation.messages.some((message) => message.includes("Unique") && message.includes("only one")));
});

test("choice effect handling uses the registered resolver table", () => {
  const source = fs.readFileSync(new URL("../src/engine.mjs", import.meta.url), "utf8");

  assert.match(source, /const CHOICE_RESOLVERS = new Map/);
  assert.doesNotMatch(source, /choice\.effect ===/);
});

test("confirmed random first player controls setup and turn order", () => {
  const game = createGame({ interactive: true, firstPlayerId: "p2" });

  assert.equal(game.phase, "first-player");
  assert.equal(game.firstPlayerId, "p2");
  assert.deepEqual(game.turnOrder, ["p2", "p1"]);
  assert.equal(confirmFirstPlayer(game).ok, true);
  assert.equal(game.championSelectPlayerId, "p2");

  finishSetup(game);
  assert.equal(game.phase, "action");
  assert.equal(currentPlayer(game).id, "p2");
  assert.equal(game.players.find((player) => player.id === "p2").runes.length, 2);
  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, "p1");
  assert.equal(game.players.find((player) => player.id === "p1").runes.length, 3);
});

test("score rail maps both players onto the 1-8-1 track", () => {
  let cells = scoreCells(1, 1);
  assert.equal(cells[0].leftActive, true);
  assert.equal(cells[14].rightActive, true);

  cells = scoreCells(8, 8);
  assert.equal(cells[7].leftActive, true);
  assert.equal(cells[7].rightActive, true);

  cells = scoreCells(3, 6);
  assert.equal(cells[2].leftActive, true);
  assert.equal(cells[9].rightActive, true);
});

test("both players choose a battlefield before the first turn starts", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);

  assert.equal(game.phase, "action");
  assert.equal(game.battlefields.length, 2);
  assert.equal(player.runes.length, 2);
  assert.equal(player.hand.length, 5);
});

test("players choose starting champions before battlefield selection and opening draw", () => {
  const game = createGame({ interactive: true, battlefieldSelectionMode: "manual" });
  assert.equal(confirmFirstPlayer(game).ok, true);
  const first = game.players[0];
  const second = game.players[1];
  assert.deepEqual(first.availableChampions.map((card) => card.tags.find((tag) => tag === "Master Yi")), ["Master Yi"]);
  assert.deepEqual(second.availableChampions.map((card) => card.tags.find((tag) => tag === "Diana")), ["Diana"]);
  const firstChampionId = first.availableChampions[0].instanceId;
  const secondChampionId = second.availableChampions[0].instanceId;

  assert.equal(selectChampion(game, first.id, firstChampionId).ok, true);
  assert.equal(first.champion.instanceId, firstChampionId);
  assert.equal(first.mainDeck.length, expectedDeckSize(decklists.keenanXiong));
  assert.equal(game.phase, "champion-select");
  assert.equal(game.championSelectPlayerId, second.id);

  assert.equal(selectChampion(game, second.id, secondChampionId).ok, true);
  assert.equal(second.champion.instanceId, secondChampionId);
  assert.equal(game.phase, "battlefield-select");
  assert.equal(game.setupPlayerId, first.id);
  assert.equal(first.hand.length, 4);
  assert.equal(second.hand.length, 4);
  assert.equal(first.mainDeck.length, expectedDeckSize(decklists.keenanXiong) - 4);
  assert.equal(second.mainDeck.length, expectedDeckSize(decklists.drowsy) - 4);
});

test("starting champion leaves the champion zone after being played and cannot be played again", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const champion = player.champion;
  player.runes = [
    rune(DOMAINS.CALM, player.id, "champion-energy-1"),
    rune(DOMAINS.CALM, player.id, "champion-energy-2"),
    rune(DOMAINS.CALM, player.id, "champion-energy-3"),
    rune(DOMAINS.CALM, player.id, "champion-energy-4"),
    rune(DOMAINS.CALM, player.id, "champion-energy-5")
  ];

  assert.equal(champion.zone, "champion");
  assert.equal(player.championPlayed, false);
  assert.equal(beginPlayChampion(game, "base").ok, true);
  for (const runeCard of player.runes.slice(0, champion.energy || 0)) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  for (const requirement of champion.power || []) {
    const runeCard = player.runes.find((candidate) => !game.pendingPayment.powerRuneIds.includes(candidate.instanceId) && candidate.domain === requirement.domain);
    assert.ok(runeCard);
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "power").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.championPlayed, true);
  assert.equal(champion.zone, "played");
  assert.equal(player.base.includes(champion), true);

  const replay = beginPlayChampion(game, "base");
  assert.equal(replay.ok, false);
  assert.equal(replay.message, "Champion has already been played.");
});

test("same-name copies of the chosen champion count as chosen champions", () => {
  const masterYiDeck = structuredClone(decklists.provingGroundsMasterYi);
  const honedIndex = masterYiDeck.main
    .map((card, index) => ({ card, index }))
    .find(({ card }) => card.name === "Master Yi, Honed")?.index;
  const secondIndex = masterYiDeck.main.findIndex((card, index) => index !== honedIndex && !card.isChampion);
  const replaceIndexes = [honedIndex, secondIndex];
  assert.equal(replaceIndexes.every((index) => Number.isInteger(index) && index >= 0), true);
  const honedCard = structuredClone(masterYiDeck.main[honedIndex]);
  for (const index of replaceIndexes) masterYiDeck.main[index] = structuredClone(cards.masterYiMeditative);
  const thirdIndex = masterYiDeck.main.findIndex((card, index) => !replaceIndexes.includes(index) && !card.isChampion);
  assert.ok(thirdIndex >= 0);
  masterYiDeck.main[thirdIndex] = honedCard;
  const game = createGame({ interactive: true, decks: [masterYiDeck, decklists.drowsy] });
  assert.equal(confirmFirstPlayer(game).ok, true);
  const player = game.players[0];
  const masterYiChoice = player.availableChampions.find((card) => card.name === "Master Yi, Meditative");
  assert.ok(masterYiChoice);

  assert.equal(selectChampion(game, player.id, masterYiChoice.instanceId).ok, true);
  assert.equal(player.chosenChampionName, "Master Yi, Meditative");
  const extraMasterYi = player.mainDeck.find((card) => card.name === "Master Yi, Meditative");
  const otherChampion = player.mainDeck.find((card) => card.name === "Master Yi, Honed");

  assert.ok(extraMasterYi);
  assert.ok(otherChampion);
  assert.equal(isChosenChampion(game, player.id, player.champion), true);
  assert.equal(isChosenChampion(game, player.id, extraMasterYi), true);
  assert.equal(isChosenChampion(game, player.id, otherChampion), false);
});

test("battlefield selection leads to mulligans before the first turn", () => {
  const game = createGame({ interactive: true, battlefieldSelectionMode: "manual" });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }

  assert.equal(game.phase, "mulligan");
  assert.equal(game.mulligan.playerId, game.players[0].id);
  assert.equal(currentPlayer(game).id, game.players[0].id);
  assert.equal(game.players[0].runes.length, 0);
});

test("a player can mulligan up to two selected hand cards to the deck bottom and draw that many", () => {
  const game = createGame({ interactive: true, battlefieldSelectionMode: "manual" });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  const player = game.players[0];
  const kept = instance(cards.charm, player.id, "mulligan-kept");
  const firstBottom = instance(cards.defy, player.id, "mulligan-bottom-one");
  const secondBottom = instance(cards.discipline, player.id, "mulligan-bottom-two");
  const extra = instance(cards.clockworkKeeper, player.id, "mulligan-extra");
  const firstDraw = instance(cards.lonelyPoro, player.id, "mulligan-draw-one");
  const secondDraw = instance(cards.scuttleCrab, player.id, "mulligan-draw-two");
  const remainingDeck = instance(cards.stalwartPoro, player.id, "mulligan-remaining");
  player.hand = [kept, firstBottom, secondBottom, extra];
  player.mainDeck = [firstDraw, secondDraw, remainingDeck];

  assert.equal(toggleMulliganCard(game, firstBottom.instanceId).ok, true);
  assert.equal(toggleMulliganCard(game, secondBottom.instanceId).ok, true);
  assert.equal(toggleMulliganCard(game, extra.instanceId).ok, false);
  assert.equal(confirmMulligan(game).ok, true);

  assert.deepEqual(player.hand.map((card) => card.instanceId), [
    "mulligan-kept",
    "mulligan-extra",
    "mulligan-draw-one",
    "mulligan-draw-two"
  ]);
  assert.equal(player.mainDeck[0].instanceId, "mulligan-remaining");
  assert.deepEqual(player.mainDeck.slice(1).map((card) => card.instanceId).sort(), [
    "mulligan-bottom-one",
    "mulligan-bottom-two"
  ]);
  assert.equal(game.phase, "mulligan");
  assert.equal(game.mulligan.playerId, game.players[1].id);
});

test("mulligan draws only the number of cards returned", () => {
  const game = createGame({ interactive: true, battlefieldSelectionMode: "manual" });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  const player = game.players[0];
  const kept = instance(cards.charm, player.id, "one-mulligan-kept");
  const bottom = instance(cards.defy, player.id, "one-mulligan-bottom");
  const extraOne = instance(cards.discipline, player.id, "one-mulligan-extra-one");
  const extraTwo = instance(cards.clockworkKeeper, player.id, "one-mulligan-extra-two");
  const drawCard = instance(cards.lonelyPoro, player.id, "one-mulligan-draw");
  const remainingDeck = instance(cards.scuttleCrab, player.id, "one-mulligan-remaining");
  player.hand = [kept, bottom, extraOne, extraTwo];
  player.mainDeck = [drawCard, remainingDeck];

  assert.equal(toggleMulliganCard(game, bottom.instanceId).ok, true);
  assert.equal(confirmMulligan(game).ok, true);

  assert.deepEqual(player.hand.map((card) => card.instanceId), [
    "one-mulligan-kept",
    "one-mulligan-extra-one",
    "one-mulligan-extra-two",
    "one-mulligan-draw"
  ]);
  assert.deepEqual(player.mainDeck.map((card) => card.instanceId), [
    "one-mulligan-remaining",
    "one-mulligan-bottom"
  ]);
});

test("skipping both mulligans starts the first turn without changing opening hands", () => {
  const game = createGame({ interactive: true, battlefieldSelectionMode: "manual" });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  const firstHand = game.players[0].hand.map((card) => card.instanceId);
  const secondHand = game.players[1].hand.map((card) => card.instanceId);

  assert.equal(skipMulligan(game).ok, true);
  assert.equal(skipMulligan(game).ok, true);

  assert.equal(game.phase, "action");
  assert.deepEqual(game.players[0].hand.slice(0, firstHand.length).map((card) => card.instanceId), firstHand);
  assert.equal(game.players[0].hand.length, firstHand.length + 1);
  assert.deepEqual(game.players[1].hand.map((card) => card.instanceId), secondHand);
  assert.equal(game.players[0].runes.length, 2);
});

test("Duel setup randomly selects and simultaneously places one Battlefield per player", () => {
  const game = createGame({ interactive: true, format: "duel", random: () => 0.999999 });
  const expected = Object.fromEntries(game.players.map((player) => [
    player.id,
    player.availableBattlefields.at(-1).cardNumber
  ]));

  finishChampionSelection(game);

  assert.equal(game.sanctionedFormat, "duel");
  assert.equal(game.phase, "mulligan");
  assert.equal(game.battlefields.length, 2);
  assert.deepEqual(Object.fromEntries(game.battlefields.map((field) => [field.ownerId, field.cardNumber])), expected);
  assert.ok(game.players.every((player) => player.availableBattlefields.length === 2));
});

test("Predict X lets its player recycle any subset and explicitly reorder every card left on top", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const source = player.legend;
  const first = instance(cards.lonelyPoro, player.id, "predict-x-first");
  const second = instance(cards.charm, player.id, "predict-x-second");
  const third = instance(cards.flash, player.id, "predict-x-third");
  const rest = instance(cards.stalwartPoro, player.id, "predict-x-rest");
  player.mainDeck = [first, second, third, rest];

  assert.equal(predictCards(game, player, source, 3), true);
  assert.equal(game.pendingChoice.effect, "predictMultipleRecycle");
  assert.equal(chooseEffectOption(game, `recycle:${second.instanceId}`).ok, true);
  assert.equal(chooseEffectOption(game, "done").ok, true);
  assert.equal(game.pendingChoice.effect, "predictMultipleOrder");
  assert.equal(chooseEffectOption(game, third.instanceId).ok, true);

  assert.deepEqual(player.mainDeck.map((card) => card.instanceId), [
    third.instanceId,
    first.instanceId,
    rest.instanceId,
    second.instanceId
  ]);
  assert.equal(game.pendingChoice, null);
});

test("Match setup excludes every Battlefield that player already used in the Match", () => {
  const unavailable = Object.fromEntries(createGame().players.map((player) => [
    player.id,
    [player.availableBattlefields[0].cardNumber]
  ]));
  const game = createGame({ interactive: true, format: "match", unavailableBattlefields: unavailable });

  assert.equal(game.sanctionedFormat, "match");
  for (const player of game.players) {
    assert.equal(player.availableBattlefields.length, 2);
    assert.equal(player.availableBattlefields.some((field) => unavailable[player.id].includes(field.cardNumber)), false);
  }
  finishChampionSelection(game);
  assert.equal(game.phase, "battlefield-select");
});

test("spells with mandatory targets cannot be started without legal targets", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const charm = instance(cards.charm, player.id, "targetless-charm");
  const enemyBaseUnit = instance(cards.lonelyPoro, opponent.id, "enemy-base-unit");
  player.hand = [charm];
  opponent.base = [];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "charm-calm"),
    rune(DOMAINS.BODY, player.id, "charm-any")
  ];

  assert.equal(beginPlayCard(game, charm.instanceId, "base").ok, false);
  assert.equal(game.pendingPayment, null);

  const challenge = instance(cards.challenge, player.id, "targetless-challenge");
  const friendly = instance(cards.lonelyPoro, player.id, "challenge-friendly");
  player.hand = [challenge];
  player.base = [friendly];
  assert.equal(beginPlayCard(game, challenge.instanceId, game.battlefields[0].instanceId).ok, false,
    "every mandatory declaration step must have a legal completion before the card enters the Chain");
  assert.equal(player.hand.some((card) => card.instanceId === challenge.instanceId), true);
  assert.equal(game.actionChain, null);

  player.hand = [charm];
  opponent.base = [enemyBaseUnit];
  assert.equal(beginPlayCard(game, charm.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, enemyBaseUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, game.battlefields[0].instanceId).ok, true);
  assert.equal(game.pendingPayment.cardId, charm.instanceId);
  assert.equal(cancelPayment(game).ok, true);

  const battlefield = game.battlefields[0];
  const enemyBattlefieldUnit = instance(cards.lonelyPoro, opponent.id, "enemy-battlefield-unit");
  battlefield.units.push(enemyBattlefieldUnit);
  battlefield.controlledBy = opponent.id;

  assert.equal(beginPlayCard(game, charm.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, enemyBattlefieldUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(game.pendingPayment.cardId, charm.instanceId);
});

test("a required declaration that cannot open rolls back before the response window", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const hiddenBlade = instance(cards.hiddenBlade, player.id, "orphan-hidden-blade");
  const deflectTarget = instance(cards.poutyPoro, opponent.id, "orphan-deflect-target");
  const battlefield = game.battlefields[0];
  player.hand = [hiddenBlade];
  player.runes = [rune(DOMAINS.ORDER, player.id, "orphan-rune")];
  player.runePool = {
    energy: [
      { id: "orphan-energy-1", type: "energy", domains: [DOMAINS.ORDER], restriction: null },
      { id: "orphan-energy-2", type: "energy", domains: [DOMAINS.ORDER], restriction: null }
    ],
    power: []
  };
  battlefield.units = [deflectTarget];
  battlefield.controlledBy = opponent.id;

  assert.equal(beginPlayCard(game, hiddenBlade.instanceId, "base").ok, false);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.hand.some((card) => card.instanceId === hiddenBlade.instanceId), true);
});

test("moonfall can be played when Ruin Runner is the only enemy unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const friendly = instance(cards.lonelyPoro, player.id, "moonfall-friendly");
  const ruinRunner = instance(cards.ruinRunner, opponent.id, "moonfall-ruin-runner");
  game.battlefields[0].units = [friendly];
  opponent.base = [ruinRunner];
  player.hand = [instance(cards.moonfall, player.id, "moonfall-immune-target")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `moonfall-rune-${index}`));

  assert.equal(beginPlayCard(game, "moonfall-immune-target", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, game.battlefields[0].instanceId).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment.cardId, "moonfall-immune-target");
});

test("a player can surrender immediately and awards the game to the opponent", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);

  assert.equal(surrender(game, player.id).ok, true);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, opponent.id);
  assert.equal(game.surrenderedPlayerId, player.id);
});

test("Traveling Merchant resumes movement and starts combat after its discard-draw choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const merchant = instance(cards.travelingMerchant, player.id, "moving-merchant");
  const discarded = instance(cards.confront, player.id, "merchant-discard");
  const drawn = instance(cards.lonelyPoro, player.id, "merchant-draw");
  const defender = instance(cards.lonelyPoro, opponent.id, "merchant-defender");
  const battlefield = game.battlefields[0];
  player.base = [merchant];
  player.hand = [discarded];
  player.mainDeck = [drawn];
  battlefield.units = [defender];
  battlefield.controlledBy = opponent.id;

  assert.equal(moveUnit(game, merchant.instanceId, battlefield.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "discardCard");
  assert.equal(game.showdown, null);
  assert.equal(chooseEffectOption(game, discarded.instanceId).ok, true);

  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown?.combat, true);
  assert.equal(game.showdown?.battlefieldId, battlefield.instanceId);
  assert.equal(game.showdown?.attackerId, player.id);
});

test("Traveling Merchant starts combat after discard-trigger chains finish", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const merchant = instance(cards.travelingMerchant, player.id, "trigger-moving-merchant");
  const scrapheap = instance(cards.scrapheap, player.id, "merchant-scrapheap");
  const firstDraw = instance(cards.lonelyPoro, player.id, "merchant-first-draw");
  const secondDraw = instance(cards.confront, player.id, "merchant-trigger-draw");
  const defender = instance(cards.lonelyPoro, opponent.id, "trigger-merchant-defender");
  const battlefield = game.battlefields[0];
  player.base = [merchant];
  player.hand = [scrapheap];
  player.mainDeck = [firstDraw, secondDraw];
  battlefield.units = [defender];
  battlefield.controlledBy = opponent.id;

  assert.equal(moveUnit(game, merchant.instanceId, battlefield.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, scrapheap.instanceId).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === firstDraw.instanceId), true);
  assert.equal(player.hand.some((card) => card.instanceId === secondDraw.instanceId), true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown?.battlefieldId, battlefield.instanceId);
});

test("Traveling Merchant's move trigger opens an action-chain response window before it resolves", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const merchant = instance(cards.travelingMerchant, player.id, "responsive-moving-merchant");
  const discarded = instance(cards.lonelyPoro, player.id, "responsive-merchant-discard");
  const reactionTarget = instance(cards.lonelyPoro, opponent.id, "responsive-reaction-target");
  const reaction = instance(cards.discipline, opponent.id, "responsive-discipline");
  const battlefield = game.battlefields[0];
  player.base = [merchant];
  player.hand = [discarded];
  opponent.base = [reactionTarget];
  opponent.hand = [reaction];
  opponent.runes = [
    rune(DOMAINS.CALM, opponent.id, "responsive-rune-one"),
    rune(DOMAINS.CALM, opponent.id, "responsive-rune-two")
  ];
  battlefield.units = [];
  battlefield.controlledBy = opponent.id;

  assert.equal(moveUnit(game, merchant.instanceId, battlefield.instanceId).ok, true);

  assert.ok(game.actionChain, "the mandatory move trigger is placed Pending on the action chain");
  assert.equal(game.actionChain.priorityPlayerId, player.id,
    "the trigger controller receives the first chance to add to the Chain");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.actionChain.priorityPlayerId, opponent.id,
    "the opponent receives priority while their Reaction is legal");
  assert.equal(game.pendingChoice, null,
    "the Merchant discard choice cannot open before the move trigger resolves");
  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), false);
});

test("one multi-card Discard action waits for every private choice and records one responsible event", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const source = instance({
    ...cards.lonelyPoro,
    name: "Rules Test Discard Two",
    energy: 0,
    power: [],
    effects: [
      { timing: "onPlay", kind: "discard", amount: 2 },
      { timing: "discard", kind: "readySelfMight", amount: 1, temporary: true }
    ]
  }, player.id, "discard-two-source");
  const first = instance(cards.lonelyPoro, player.id, "discard-two-first");
  const second = instance(cards.confront, player.id, "discard-two-second");
  player.hand = [source, first, second];

  assert.equal(playCard(game, source.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "discardCard");
  player.champion = source;
  player.championPlayed = true;
  source.zone = "played";
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === first.instanceId), true,
    "the cards remain in hand until every card in the simultaneous action is chosen");
  assert.equal(game.discardEvents, undefined);
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);

  assert.deepEqual(game.discardEvents.at(-1).cardIds, [first.instanceId, second.instanceId]);
  assert.equal(game.discardEvents.at(-1).responsiblePlayerId, player.id);
  assert.equal(player.discardedCardsThisTurn, 2);
  assert.equal(player.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(source.mightModifier, 1,
    "one board object is not observed twice through both the Champion reference and Base location");
});

test("a ready unit moving to an empty battlefield starts a non-combat showdown before conquest", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.hand = [instance(cards.lonelyPoro, player.id)];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "r1"),
    rune(DOMAINS.CALM, player.id, "r2")
  ];

  assert.equal(playCard(game, player.hand[0].instanceId, "base").ok, true);
  const unit = player.base[0];
  unit.exhausted = false;

  assert.equal(moveUnit(game, unit.instanceId, game.battlefields[0].instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, false);
  assert.equal(game.showdown.attackerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(game.currentPlayerId, player.id);
  assert.equal(passShowdown(game, opponent.id).ok, false);
  assert.equal(player.score, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(game.battlefields[0].controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("multiple ready units can make one standard move to an empty battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const first = instance(cards.lonelyPoro, player.id, "batch-empty-first");
  const second = instance(cards.stalwartPoro, player.id, "batch-empty-second");
  player.base = [first, second];

  assert.equal(moveUnits(game, [first.instanceId, second.instanceId], game.battlefields[0].instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, false);
  assert.equal(game.battlefields[0].units.length, 2);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
  assert.deepEqual(game.exhaustEvents.at(-1).cardIds, [first.instanceId, second.instanceId]);
  assert.equal(game.exhaustEvents.at(-1).reason, "standard-move-cost");
  assert.equal(game.exhaustEvents.at(-1).cost, true);
  assert.equal(game.exhaustEvents.at(-1).responsiblePlayerId, player.id);
  assert.equal(player.base.length, 0);
  assert.equal(player.score, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.battlefields[0].controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("a standard move must change every selected unit's location", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const baseUnit = instance(cards.travelingMerchant, player.id, "same-location-base-unit");
  const battlefieldUnit = instance(cards.yasuoWindrider, player.id, "same-location-battlefield-unit");
  const field = game.battlefields[0];
  player.base = [baseUnit];
  field.units = [battlefieldUnit];
  field.controlledBy = player.id;

  const moveEventsBefore = game.moveEvents?.length || 0;
  const baseResult = moveUnit(game, baseUnit.instanceId, "base");
  assert.equal(baseResult.ok, false);
  assert.match(baseResult.message, /must change the unit's location/i);
  assert.equal(baseUnit.exhausted, false);
  assert.equal(baseUnit.movesThisTurn, undefined);
  assert.equal(game.moveEvents?.length || 0, moveEventsBefore);
  assert.equal(enumerateLegalActions(game, player.id).some((action) =>
    action.kind === "moveUnit"
    && action.unitId === baseUnit.instanceId
    && action.destinationId === "base"), false);

  const battlefieldResult = moveUnit(game, battlefieldUnit.instanceId, field.instanceId);
  assert.equal(battlefieldResult.ok, false);
  assert.match(battlefieldResult.message, /must change the unit's location/i);
  assert.equal(battlefieldUnit.exhausted, false);
  assert.equal(battlefieldUnit.movesThisTurn, undefined);
  assert.equal(field.units.includes(battlefieldUnit), true);
});

test("moving into an enemy battlefield starts a showdown before combat damage", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.lonelyPoro, player.id, "attacker");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "defender");
  const field = game.battlefields[0];
  player.base = [unit];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, field.instanceId);
  assert.equal(game.showdown.combat, true);
  assert.equal(game.showdown.attackerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(game.currentPlayerId, player.id);
  assert.equal(passShowdown(game, opponent.id).ok, false);
  assert.equal(field.units.length, 2);
  assert.equal(unit.combatRole, "attacker");
  assert.equal(enemy.combatRole, "defender");
  assert.equal(player.score, 0);
  assert.equal(enemy.damage, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  const combatCards = [...field.units, ...player.base, ...opponent.base, ...player.trash, ...opponent.trash];
  assert.equal(combatCards.some((card) => card.combatRole), false);
});

test("multiple ready units can make one standard move into a combat showdown", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const first = instance(cards.lonelyPoro, player.id, "batch-combat-first");
  const second = instance(cards.stalwartPoro, player.id, "batch-combat-second");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "batch-combat-defender");
  const field = game.battlefields[0];
  player.base = [first, second];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnits(game, [first.instanceId, second.instanceId], field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, field.instanceId);
  assert.equal(game.showdown.combat, true);
  assert.equal(field.units.length, 3);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
  assert.equal(player.base.length, 0);
  assert.equal(player.score, 0);
  assert.equal(enemy.damage, 0);
});

test("turn player chooses the order when multiple combats are staged", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const firstField = game.battlefields[0];
  const secondField = game.battlefields[1];
  firstField.units = [
    instance(cards.lonelyPoro, player.id, "staged-a-attacker"),
    instance(cards.ravenbloomStudent, opponent.id, "staged-a-defender")
  ];
  secondField.units = [
    instance(cards.stalwartPoro, player.id, "staged-b-attacker"),
    instance(cards.ravenbloomStudent, opponent.id, "staged-b-defender")
  ];
  firstField.controlledBy = opponent.id;
  secondField.controlledBy = opponent.id;
  firstField.contestedBy = player.id;
  secondField.contestedBy = player.id;

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice.effect, "stagedEvent");
  assert.equal(game.pendingChoice.options.length, 2);
  const secondOption = game.pendingChoice.options.find((option) => option.cardId === secondField.instanceId);
  assert.ok(secondOption);

  assert.equal(chooseEffectOption(game, secondOption.id).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, secondField.instanceId);
  assert.equal(game.stagedEvents.length, 1);
  assert.equal(game.stagedEvents[0].battlefieldId, firstField.instanceId);
});

test("cleanup downgrades an invalid staged combat to the remaining contested showdown before Ending", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "staged-downgrade-attacker");
  const stunned = instance(cards.ravenbloomStudent, player.id, "staged-downgrade-stunned");
  stunned.stunned = true;
  player.base = [stunned];
  field.effects = [];
  field.units = [attacker];
  field.controlledBy = opponent.id;
  field.contestedBy = player.id;
  game.stagedEvents = [{
    id: `staged-combat-${field.instanceId}-${player.id}`,
    type: "combat",
    battlefieldId: field.instanceId,
    attackerId: player.id,
    defenderId: opponent.id
  }];

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, field.instanceId);
  assert.equal(game.showdown.combat, false);
  assert.equal(stunned.stunned, true, "the Ending Step cannot begin while the staged Showdown is outstanding");
  assert.equal(game.pendingEndTurnPlayerId, player.id);
});

test("a showdown opened while priority differs preserves the real turn owner", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const turnPlayer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== turnPlayer.id);
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, turnPlayer.id, "canonical-turn-attacker");
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "canonical-turn-rune")];
  opponent.runes[0].exhausted = true;
  field.units = [attacker];
  field.controlledBy = opponent.id;
  field.contestedBy = turnPlayer.id;
  game.stagedEvents = [{
    id: `staged-showdown-${field.instanceId}-${turnPlayer.id}`,
    type: "showdown",
    battlefieldId: field.instanceId,
    attackerId: turnPlayer.id,
    defenderId: opponent.id
  }];

  // This is the state reached after a response window: priority may belong to
  // another player, but it must not replace the actual turn owner.
  game.turnPlayerId = turnPlayer.id;
  game.currentPlayerId = opponent.id;
  assert.equal(endTurn(game).ok, true);
  assert.equal(game.showdown?.turnPlayerId, turnPlayer.id);

  for (let guard = 0; game.showdown && guard < 8; guard += 1) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }

  assert.equal(game.turnSequence >= 2, true, "only the requested end turn advances the turn");
  assert.equal(game.turnPlayerId, opponent.id);
  assert.equal(opponent.runes[0].exhausted, false, "the genuine next turn performs its Ready step");
});

test("effect priority cannot replace the actual turn owner outside a showdown", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const turnOwner = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== turnOwner.id);
  const action = instance({ ...cards.lonelyPoro, energy: 0, power: [] }, turnOwner.id, "canonical-action-owner");
  turnOwner.hand = [action];

  // A resolving opponent effect may temporarily hold currentPlayerId.  It must
  // neither gain the neutral action nor become the restoration target for the
  // chain opened by the real turn owner.
  game.turnPlayerId = turnOwner.id;
  game.currentPlayerId = opponent.id;
  assert.equal(beginPlayCard(game, action.instanceId, "base").ok, true);
  assert.equal(game.actionChain?.turnPlayerId, turnOwner.id);
  assert.equal(game.actionChain?.priorityPlayerId, turnOwner.id);
  assert.equal(confirmPayment(game).ok, true);

  for (let guard = 0; game.actionChain && guard < 8; guard += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(game.actionChain, null);
  assert.equal(game.turnPlayerId, turnOwner.id);
  assert.equal(game.currentPlayerId, turnOwner.id);
});

test("interactive combat damage is assigned by players after showdown passes", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "manual-combat-attacker");
  const defender = instance(cards.ravenbloomStudent, opponent.id, "manual-combat-defender");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.playerId, player.id);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["manual-combat-defender"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, "manual-combat-defender").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.playerId, opponent.id);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["manual-combat-attacker"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, "manual-combat-attacker").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.phase, "action");
  assert.equal(field.units.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "manual-combat-attacker"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "manual-combat-defender"), true);
});

test("manual combat damage ends after every opposing unit has lethal damage assigned", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "excess-combat-attacker");
  attacker.might = 4;
  const defender = instance(cards.lonelyPoro, opponent.id, "excess-combat-defender");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, defender.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.playerId, opponent.id,
    "the remaining attacker damage does not reopen the lethally assigned defender");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [attacker.instanceId]);
  assert.equal(field.combatExcessDamageByPlayer[player.id], 2,
    "remaining damage is assigned automatically without another UI choice");

  assert.equal(chooseEffectOption(game, attacker.instanceId).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.trash.some((card) => card.instanceId === defender.instanceId), true);
});

test("manual combat damage must assign lethal damage to Tank units first", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "tank-combat-attacker");
  attacker.might = 4;
  const tank = instance(cards.lonelyPoro, opponent.id, "tank-combat-tank");
  tank.keywords = [...(tank.keywords || []), "Tank"];
  const normal = instance(cards.ravenbloomStudent, opponent.id, "tank-combat-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [tank, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["tank-combat-tank"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, "tank-combat-tank").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["tank-combat-normal"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
});

test("manual combat damage assigns Backline units only after non-Backline units", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "backline-combat-attacker");
  attacker.might = 6;
  const backline = instance(cards.lonelyPoro, opponent.id, "backline-combat-unit");
  backline.keywords = [...(backline.keywords || []), "Backline"];
  const normal = instance(cards.ravenbloomStudent, opponent.id, "backline-combat-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [backline, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [normal.instanceId]);
  assert.equal(chooseEffectOption(game, normal.instanceId).ok, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [backline.instanceId]);
});

test("a unit with both Tank and Backline may satisfy either exclusionary assignment rule", () => {
  const setup = (suffix) => {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const attacker = instance(cards.lonelyPoro, player.id, `dual-priority-attacker-${suffix}`);
    attacker.might = 4;
    const dual = instance(cards.lonelyPoro, opponent.id, `dual-priority-unit-${suffix}`);
    dual.keywords = ["Tank", "Backline"];
    const ordinary = instance(cards.lonelyPoro, opponent.id, `dual-priority-ordinary-${suffix}`);
    const field = game.battlefields[0];
    player.base = [attacker];
    field.units = [dual, ordinary];
    field.controlledBy = opponent.id;
    assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
    assert.equal(passShowdown(game, player.id).ok, true);
    assert.equal(passShowdown(game, opponent.id).ok, true);
    return { game, dual, ordinary };
  };

  {
    const { game, dual, ordinary } = setup("last");
    assert.deepEqual(new Set(game.pendingChoice.options.map((option) => option.id)), new Set([dual.instanceId, ordinary.instanceId]));
    assert.equal(chooseEffectOption(game, ordinary.instanceId).ok, true);
    assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [dual.instanceId]);
  }
  {
    const { game, dual, ordinary } = setup("first");
    assert.equal(chooseEffectOption(game, dual.instanceId).ok, true);
    assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [ordinary.instanceId]);
  }
});

test("numeric keyword values from separate sources are summed", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.legend.effects = [];
  const unit = instance(cards.lonelyPoro, player.id, "stacked-keyword-unit");
  unit.might = 2;
  unit.keywords = ["Assault", "Assault", "Shield", "Shield"];
  unit.text = "[Assault 2]\n[Assault 3]\n[Shield 1]\n[Shield 2]";
  const field = game.battlefields[0];
  field.units = [unit];

  assert.equal(currentCombatMight(game, field, unit, "attacker"), 7);
  assert.equal(currentCombatMight(game, field, unit, "defender"), 5);
});

test("Vision is a shared keyword trigger and each granted instance predicts separately", () => {
  const run = ({ printedVision = false, seerAura = false }) => {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const played = instance({
      ...(printedVision ? cards.mysticPoro : cards.lonelyPoro),
      id: `TEST-VISION-${printedVision ? "PRINTED" : "GRANTED"}`,
      cardNumber: `TEST-VISION-${printedVision ? "PRINTED" : "GRANTED"}/001`,
      collectorNumber: `TEST-VISION-${printedVision ? "PRINTED" : "GRANTED"}/001`,
      name: `Rules Test ${printedVision ? "Printed" : "Granted"} Vision Unit`,
      energy: 0,
      power: []
    }, player.id, `vision-played-${printedVision}-${seerAura}`);
    const top = instance(cards.lonelyPoro, player.id, `vision-top-${printedVision}-${seerAura}`);
    const middle = instance(cards.lonelyPoro, player.id, `vision-middle-${printedVision}-${seerAura}`);
    const bottom = instance(cards.lonelyPoro, player.id, `vision-bottom-${printedVision}-${seerAura}`);
    player.hand = [played];
    player.mainDeck = [top, middle, bottom];
    player.base = seerAura ? [instance(cards.gemcraftSeer, player.id, `vision-seer-${printedVision}`)] : [];

    assert.equal(playCard(game, played.instanceId, "base").ok, true);
    return player.mainDeck.map((card) => card.instanceId);
  };

  assert.deepEqual(run({ printedVision: true, seerAura: false }), ["vision-middle-true-false", "vision-bottom-true-false", "vision-top-true-false"]);
  assert.deepEqual(run({ printedVision: false, seerAura: true }), ["vision-middle-false-true", "vision-bottom-false-true", "vision-top-false-true"]);
  assert.deepEqual(run({ printedVision: true, seerAura: true }), ["vision-bottom-true-true", "vision-top-true-true", "vision-middle-true-true"]);
});

test("manual combat damage assigns Caitlyn, Patrolling after ordinary units", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "last-combat-attacker");
  attacker.might = 6;
  const caitlyn = instance(cards.caitlynPatrolling, opponent.id, "last-combat-caitlyn");
  const normal = instance(cards.ravenbloomStudent, opponent.id, "last-combat-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [caitlyn, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [normal.instanceId]);

  assert.equal(chooseEffectOption(game, normal.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [caitlyn.instanceId]);
});

test("combat damage can be assigned to units that enemy spells and abilities cannot choose", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "choice-limit-attacker");
  attacker.might = 4;
  const protectedUnit = instance(cards.ruinRunner, opponent.id, "choice-limit-protected");
  const normal = instance(cards.ravenbloomStudent, opponent.id, "choice-limit-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [protectedUnit, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["choice-limit-normal"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
  assert.equal(chooseEffectOption(game, "choice-limit-normal").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["choice-limit-protected"]);
});

test("combat damage can hit a zero Might Scuttle Crab", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const attacker = instance(cards.lonelyPoro, player.id, "zero-might-attacker");
  const scuttle = instance(cards.scuttleCrab, opponent.id, "zero-might-scuttle");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [scuttle];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [scuttle.instanceId]);
  assert.equal(game.pendingChoice.options[0].amount, 1);
});

test("combat damage assigns one lethal damage to a negative Might unit before another unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const attacker = instance(cards.lonelyPoro, player.id, "negative-might-attacker");
  const negative = instance(cards.lonelyPoro, opponent.id, "negative-might-defender");
  const ordinary = instance(cards.ravenbloomStudent, opponent.id, "ordinary-might-defender");
  negative.mightModifier = -3;
  ordinary.might = 3;
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [negative, ordinary];
  field.controlledBy = opponent.id;

  assert.equal(currentMight(game, negative), -1);
  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [negative.instanceId]);
  assert.equal(game.pendingChoice.options[0].amount, 1);

  assert.equal(chooseEffectOption(game, negative.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [ordinary.instanceId]);
});

test("manual combat damage uses summed might of units at that battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const firstAttacker = instance(cards.lonelyPoro, player.id, "summed-might-attacker-one");
  const secondAttacker = instance(cards.lonelyPoro, player.id, "summed-might-attacker-two");
  const firstDefender = instance(cards.lonelyPoro, opponent.id, "summed-might-defender-one");
  const secondDefender = instance(cards.ravenbloomStudent, opponent.id, "summed-might-defender-two");
  const field = game.battlefields[0];
  player.base = [];
  field.units = [firstAttacker, secondAttacker, firstDefender, secondDefender];
  field.controlledBy = opponent.id;
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.data.remaining, 4);
  assert.equal(game.pendingChoice.options.find((option) => option.id === "summed-might-defender-one").amount, 2);

  assert.equal(chooseEffectOption(game, "summed-might-defender-one").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.data.remaining, 2);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["summed-might-defender-two"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
});

test("manual combat lethal uses target current might after showdown effects", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.vilemaw, player.id, "current-might-vilemaw");
  const defender = instance(cards.ravenbloomStudent, opponent.id, "current-might-defender");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["current-might-defender"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
});

test("automatic combat damage uses the same legal lethal assignment rules", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "auto-combat-attacker");
  attacker.might = 4;
  const protectedUnit = instance(cards.ruinRunner, opponent.id, "auto-combat-protected");
  const normal = instance(cards.ravenbloomStudent, opponent.id, "auto-combat-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [protectedUnit, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "auto-combat-normal"), true);
  assert.equal(field.units.some((card) => card.instanceId === "auto-combat-protected"), true);
}
);

test("combat special cleanup heals an aura survivor before the next normal cleanup", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const commander = instance(cards.garenCommander, player.id, "cascade-commander");
  const poro = instance(cards.lonelyPoro, player.id, "cascade-poro");
  const activeDefender = instance(cards.lonelyPoro, opponent.id, "cascade-active-defender");
  const stunnedDefender = instance(cards.lonelyPoro, opponent.id, "cascade-stunned-defender");
  activeDefender.might = 7;
  stunnedDefender.might = 10;
  stunnedDefender.stunned = true;
  const field = game.battlefields[0];
  field.units = [commander, poro, activeDefender, stunnedDefender];
  field.controlledBy = opponent.id;
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [],
    combat: true
  };
  const expected = resolveCleanupReference({
    combat: true,
    attackerId: player.id,
    units: [
      { id: commander.instanceId, controllerId: player.id, might: 5, damage: 5, auraOtherFriendlyMight: 1 },
      { id: poro.instanceId, controllerId: player.id, might: 2, damage: 2 },
      { id: activeDefender.instanceId, controllerId: opponent.id, might: 7, damage: 7 },
      { id: stunnedDefender.instanceId, controllerId: opponent.id, might: 10, damage: 1 }
    ]
  });

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);

  assert.equal(player.trash.some((card) => card.instanceId === commander.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === poro.instanceId), false);
  assert.equal(referenceZone(expected, commander.instanceId), "trash");
  assert.equal(referenceZone(expected, poro.instanceId), "base");
  assert.equal(player.base.some((card) => card.instanceId === poro.instanceId), true);
  assert.equal(poro.damage, 0);
  assert.equal(field.units.some((card) => card.instanceId === stunnedDefender.instanceId), true);
  const simultaneousHeal = game.healEvents?.find((event) => event.reason === "combat-special-cleanup");
  assert.deepEqual(new Set(simultaneousHeal?.unitIds), new Set([poro.instanceId, stunnedDefender.instanceId]));
  assert.deepEqual(simultaneousHeal?.amounts, {
    [poro.instanceId]: 2,
    [stunnedDefender.instanceId]: 1
  });
  const combatResult = game.combatResultEvents?.at(-1);
  assert.equal(combatResult?.playerResults[player.id], "lost");
  assert.equal(combatResult?.playerResults[opponent.id], "won");
  assert.equal(combatResult?.unitResults[stunnedDefender.instanceId], "won");
});

test("Master Yi's lone-defender Might changes remaining health without changing marked damage", () => {
  const makeCombat = (damage, { secondDefender = false } = {}) => {
    const game = createGame();
    finishSetup(game);
    const attackerPlayer = currentPlayer(game);
    const defenderPlayer = game.players.find((candidate) => candidate.id !== attackerPlayer.id);
    defenderPlayer.legend = instance(cards.masterYiWujuBladesman, defenderPlayer.id, `yi-legend-${damage}-${secondDefender}`);
    const attacker = instance({ ...cards.lonelyPoro, might: 0, effects: [] }, attackerPlayer.id, `yi-attacker-${damage}-${secondDefender}`);
    const yi = instance({ ...cards.masterYiHoned, effects: [] }, defenderPlayer.id, `yi-defender-${damage}-${secondDefender}`);
    yi.damage = damage;
    const ally = secondDefender
      ? instance({ ...cards.lonelyPoro, might: 10, effects: [] }, defenderPlayer.id, `yi-ally-${damage}`)
      : null;
    const field = game.battlefields[0];
    field.units = [attacker, yi, ally].filter(Boolean);
    field.controlledBy = defenderPlayer.id;
    game.phase = "showdown";
    game.currentPlayerId = attackerPlayer.id;
    game.showdown = {
      battlefieldId: field.instanceId,
      turnPlayerId: attackerPlayer.id,
      attackerId: attackerPlayer.id,
      defenderId: defenderPlayer.id,
      priorityPlayerId: attackerPlayer.id,
      consecutivePasses: 0,
      chain: [],
      combat: true
    };
    return { game, attackerPlayer, defenderPlayer, field, yi };
  };

  {
    const { game, attackerPlayer, defenderPlayer, field, yi } = makeCombat(3);
    assert.deepEqual(unitDamageState(game, yi), { might: 6, damage: 3, remaining: 3 });
    assert.deepEqual(unitDamageState(game, yi, { battlefield: field, role: "defender" }),
      { might: 8, damage: 3, remaining: 5 });
    assert.equal(yi.damage, 3, "the conditional +2 Might does not heal or remove marked damage");
    assert.equal(passShowdown(game, attackerPlayer.id).ok, true);
    assert.equal(passShowdown(game, defenderPlayer.id).ok, true);
    assert.equal(yi.damage, 0);
    assert.deepEqual(unitDamageState(game, yi), { might: 6, damage: 0, remaining: 6 });
  }

  {
    const { game, attackerPlayer, defenderPlayer, yi } = makeCombat(7);
    assert.equal(passShowdown(game, attackerPlayer.id).ok, true);
    assert.equal(passShowdown(game, defenderPlayer.id).ok, true);
    assert.equal(defenderPlayer.trash.some((card) => card.instanceId === yi.instanceId), false,
      `7 damage survives while the lone defender has 8 Might: ${JSON.stringify({
        role: yi.combatRole,
        damage: yi.damage,
        fieldUnits: game.battlefields[0].units.map((card) => card.instanceId),
        trash: defenderPlayer.trash.map((card) => card.instanceId),
        healEvents: game.healEvents,
        log: game.log.slice(-12)
      })}`);
    assert.equal(yi.damage, 0, "the surviving defender heals before the combat role is removed");
    assert.equal(currentMight(game, yi), 6);
  }

  {
    const { game, attackerPlayer, defenderPlayer, yi } = makeCombat(8);
    assert.equal(passShowdown(game, attackerPlayer.id).ok, true);
    assert.equal(passShowdown(game, defenderPlayer.id).ok, true);
    assert.equal(defenderPlayer.trash.some((card) => card.instanceId === yi.instanceId), true,
      "8 marked damage is lethal even with the lone-defender +2 Might");
  }

  {
    const { game, attackerPlayer, defenderPlayer, yi } = makeCombat(7, { secondDefender: true });
    assert.equal(passShowdown(game, attackerPlayer.id).ok, true);
    assert.equal(passShowdown(game, defenderPlayer.id).ok, true);
    assert.equal(defenderPlayer.trash.some((card) => card.instanceId === yi.instanceId), true,
      "another friendly defender immediately removes the lone-defender +2 Might");
  }
});

test("combat assignment deals damage simultaneously and creates normal damage events", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = game.battlefields[0];
  const attackingUnit = instance({ ...cards.lonelyPoro, might: 1, effects: [] }, attacker.id, "combat-event-attacker");
  const defendingUnit = instance({ ...cards.missFortuneCaptain, might: 4, effects: [] }, defender.id, "combat-event-defender");
  const guillotine = instance(cards.noxianGuillotine, attacker.id, "combat-event-guillotine");
  attacker.base = [attackingUnit];
  field.controlledBy = defender.id;
  field.units = [defendingUnit];

  assert.equal(resolveEffect(game, attacker, guillotine), true);
  assert.equal(chooseEffectOption(game, defendingUnit.instanceId).ok, true);
  assert.equal(moveUnit(game, attackingUnit.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game).ok, true);
  assert.equal(passShowdown(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "combatDamage");

  assert.equal(chooseEffectOption(game, defendingUnit.instanceId).ok, true);
  assert.equal(defendingUnit.damage, 0, "assignment is not damage until both players finish assigning");
  assert.equal(game.pendingChoice?.effect, "combatDamage");
  while (game.pendingChoice?.effect === "combatDamage") {
    assert.equal(chooseEffectOption(game, attackingUnit.instanceId).ok, true);
    assert.equal(defendingUnit.damage, 0, "damage remains unmarked throughout the assignment procedure");
  }

  const combatDamageEvent = game.damageEvents?.find((event) => event.targetId === defendingUnit.instanceId);
  assert.ok(combatDamageEvent, JSON.stringify({
    damageEvents: game.damageEvents,
    pendingChoice: game.pendingChoice?.effect,
    combatCleanupProcess: game.combatCleanupProcess,
    battlefieldUnits: field.units.map((unit) => unit.instanceId),
    recentLog: game.log?.slice(-8)
  }));
  assert.equal(combatDamageEvent?.origin, "combat");
  assert.deepEqual(combatDamageEvent?.sourceCardIds, [attackingUnit.instanceId]);
  for (let guard = 0; (game.showdown || game.actionChain) && !game.pendingChoice && guard < 10; guard += 1) {
    const chain = game.showdown || game.actionChain;
    assert.equal(passShowdown(game, chain.priorityPlayerId).ok, true);
  }
  assert.equal(defender.trash.some((card) => card.instanceId === defendingUnit.instanceId), true,
    "the delayed next-damage trigger observes combat damage and resolves after combat cleanup");
});

test("finite Prevent values are consumed by matching damage and increase combat lethal assignment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = game.battlefields[0];
  const attackingUnit = instance({ ...cards.missFortuneCaptain, might: 5, effects: [] }, attacker.id, "prevent-attacker");
  const defendingUnit = instance({ ...cards.lonelyPoro, might: 2, effects: [] }, defender.id, "prevent-defender");
  defendingUnit.stunned = true;
  attacker.base = [attackingUnit];
  field.controlledBy = defender.id;
  field.units = [defendingUnit];
  assert.equal(preventNextDamage(game, defendingUnit, 3, { source: "combat" }), true);

  assert.equal(moveUnit(game, attackingUnit.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game).ok, true);
  assert.equal(passShowdown(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "combatDamage");
  const targetOption = game.pendingChoice.options.find((option) => option.cardId === defendingUnit.instanceId);
  assert.equal(targetOption.amount, 5, "three prevention plus two Might requires five assigned damage for lethal");
  assert.equal(chooseEffectOption(game, targetOption.id).ok, true);
  assert.equal(defender.trash.some((card) => card.instanceId === defendingUnit.instanceId), true);
  const event = game.damageEvents?.find((candidate) => candidate.targetId === defendingUnit.instanceId);
  assert.equal(event?.origin, "combat");
});

test("Prevent applies only to its declared source and retains an unspent remainder", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = instance({ ...cards.missFortuneCaptain, might: 10, effects: [] }, opponent.id, "prevent-source-target");
  const spell = instance(cards.incinerate, player.id, "prevent-source-spell");
  const ability = instance(cards.ironBallista, player.id, "prevent-source-ability");
  opponent.base = [target];
  assert.equal(preventNextDamage(game, target, 3, { source: "spell" }), true);

  assert.equal(applyDamage(game, player, ability, target, 2, { origin: "ability" }), 2);
  assert.equal(applyDamage(game, player, spell, target, 2, { origin: "spell" }), 0);
  assert.equal(applyDamage(game, player, spell, target, 2, { origin: "spell" }), 1);
  assert.equal(target.damage, 3);
  assert.equal(target.damagePreventions, undefined);
});

test("Bonus Damage is added only after the underlying Deal action remains valid", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const rayTarget = instance({ ...cards.lonelyPoro, might: 10, effects: [] }, opponent.id, "bonus-prevent-ray-target");
  const seekerTarget = instance({ ...cards.lonelyPoro, might: 10, effects: [] }, opponent.id, "bonus-prevent-seeker-target");
  const voidGate = {
    ...instance(cards.voidGate, player.id, "bonus-prevent-void-gate"),
    controlledBy: null,
    units: [rayTarget, seekerTarget],
    hidden: []
  };
  game.battlefields = [voidGate];
  assert.equal(preventNextDamage(game, rayTarget, 3), true);
  assert.equal(preventNextDamage(game, seekerTarget, 3), true);

  assert.equal(applyDamage(game, player, instance(cards.hextechRay, player.id, "bonus-ray"), rayTarget, 3), 0,
    "a fully prevented base Deal never receives Void Gate's Bonus Damage");
  assert.equal(rayTarget.damage, 0);
  assert.equal(applyDamage(game, player, instance(cards.voidSeeker, player.id, "bonus-seeker"), seekerTarget, 4), 2,
    "one valid base damage remains, then Void Gate adds one Bonus Damage");
  assert.equal(seekerTarget.damage, 2);
});

test("showdown chain resolves after both players pass", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.ruinRunner, player.id, "chain-attacker");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "chain-defender");
  const field = game.battlefields[0];
  player.base = [unit];
  player.hand = [instance(cards.alphaStrike, player.id, "alpha-strike")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "r1"),
    rune(DOMAINS.BODY, player.id, "r2"),
    rune(DOMAINS.BODY, player.id, "r3"),
    rune(DOMAINS.BODY, player.id, "r4")
  ];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(playCard(game, "alpha-strike", "base").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(opponent.base.length, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown.chain.length, 1,
    "Alpha Strike's reflexive XP instruction becomes its own Chain Item");
  assert.equal(game.showdown.chain[0].trigger.kind, "reflexiveGameAction");
  assert.equal(field.units.some((candidate) => candidate.instanceId === enemy.instanceId), false);
  assert.equal(opponent.trash[0].name, "Ravenbloom Student");

  const reflexiveFirstPlayer = game.showdown.priorityPlayerId;
  const reflexiveSecondPlayer = game.players.find((candidate) => candidate.id !== reflexiveFirstPlayer).id;
  assert.equal(passShowdown(game, reflexiveFirstPlayer).ok, true);
  assert.equal(passShowdown(game, reflexiveSecondPlayer).ok, true);
  assert.equal(game.showdown.chain.length, 0);

  const settlementFirstPlayer = game.showdown.priorityPlayerId;
  const settlementSecondPlayer = game.players.find((candidate) => candidate.id !== settlementFirstPlayer).id;
  assert.equal(passShowdown(game, settlementFirstPlayer).ok, true);
  assert.equal(passShowdown(game, settlementSecondPlayer).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("interactive showdown spells can enter manual payment and join the chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.ruinRunner, player.id, "interactive-chain-attacker");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "interactive-chain-defender");
  const field = game.battlefields[0];
  player.base = [unit];
  player.hand = [instance(cards.alphaStrike, player.id, "interactive-alpha-strike")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r1"),
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r2"),
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r3"),
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r4")
  ];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(beginPlayCard(game, "interactive-alpha-strike", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "interactive-chain-attacker").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  const alphaTarget = game.pendingChoice.options.find((option) => option.cardId === "interactive-chain-defender");
  assert.ok(alphaTarget);
  assert.equal(alphaTarget.amount, undefined, "split targets are chosen before damage amounts are divided");
  assert.equal(chooseEffectOption(game, alphaTarget.id).ok, true);
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.equal(game.pendingPayment.cardName, "Alpha Strike");

  for (const runeId of ["interactive-alpha-r1", "interactive-alpha-r2", "interactive-alpha-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "interactive-alpha-r4", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.showdown.chain[0].card.instanceId, "interactive-alpha-strike");
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.deepEqual(game.showdown.chain[0].card.declaredPlayTargets, [
    { effect: "alphaStrike", targetId: "interactive-chain-attacker" },
    { effect: "alphaStrikeDamageTarget", targetId: "interactive-chain-defender" }
  ]);
});

test("showdown chain pending items finalize before the top item resolves", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const first = instance(cards.lonelyPoro, player.id, "pending-chain-first");
  const second = instance(cards.stalwartPoro, opponent.id, "pending-chain-second");
  field.units = [
    instance(cards.ruinRunner, player.id, "pending-chain-attacker"),
    instance(cards.ravenbloomStudent, opponent.id, "pending-chain-defender")
  ];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [
      { card: first, playerId: player.id, destination: "base", status: "pending" },
      { card: second, playerId: opponent.id, destination: "base", status: "pending" }
    ]
  };

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].card.instanceId, "pending-chain-first");
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(opponent.base.some((unit) => unit.instanceId === "pending-chain-second"), true);
});

test("interactive targetless spells resolve without creating target choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "targetless-area-enemy");
  const field = game.battlefields[0];
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "interactive-unchecked-power")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "unchecked-r1"),
    rune(DOMAINS.MIND, player.id, "unchecked-r2"),
    rune(DOMAINS.MIND, player.id, "unchecked-r3"),
    rune(DOMAINS.MIND, player.id, "unchecked-r4"),
    rune(DOMAINS.MIND, player.id, "unchecked-r5"),
    rune(DOMAINS.MIND, player.id, "unchecked-r6"),
    rune(DOMAINS.MIND, player.id, "unchecked-r7"),
    rune(DOMAINS.MIND, player.id, "unchecked-r8"),
    rune(DOMAINS.MIND, player.id, "unchecked-r9")
  ];

  assert.equal(beginPlayCard(game, "interactive-unchecked-power", "base").ok, true);
  for (const runeId of ["unchecked-r1", "unchecked-r2", "unchecked-r3", "unchecked-r4", "unchecked-r5", "unchecked-r6", "unchecked-r7"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "unchecked-r8", "power").ok, true);
  assert.equal(togglePaymentRune(game, "unchecked-r9", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.length, 0);
  assert.equal(opponent.trash[0].instanceId, "targetless-area-enemy");
});

test("interactive play requires manual rune payment and creates target choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "manual-target");
  const field = game.battlefields[0];
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.charm, player.id, "manual-charm")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "manual-energy"),
    rune(DOMAINS.CALM, player.id, "manual-power")
  ];

  assert.equal(beginPlayCard(game, "manual-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [enemy.instanceId]);
  assert.equal(chooseEffectOption(game, enemy.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(game.pendingPayment.cardName, "Charm");
  assert.equal(togglePaymentRune(game, "manual-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "manual-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "manual-energy" && candidate.exhausted), true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "manual-power"), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "manual-power"), true);
  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.length, 0);
  assert.equal(opponent.base[0].name, "Ravenbloom Student");
  assert.equal(game.effectFlash.targetIds.includes(enemy.instanceId), true);
});

test("charm can move an enemy unit between battlefields", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const source = game.battlefields[0];
  const destination = game.battlefields[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "charm-battlefield-move-target");
  const friendly = instance(cards.lonelyPoro, player.id, "charm-destination-defender");
  source.units = [enemy];
  source.effects = [];
  source.controlledBy = opponent.id;
  destination.units = [friendly];
  destination.effects = [];
  destination.controlledBy = player.id;
  player.hand = [instance(cards.charm, player.id, "battlefield-charm")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "battlefield-charm-energy"),
    rune(DOMAINS.CALM, player.id, "battlefield-charm-power")
  ];

  assert.equal(beginPlayCard(game, "battlefield-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "charm-battlefield-move-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "battlefield-charm-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "battlefield-charm-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(source.units.some((unit) => unit.instanceId === enemy.instanceId), false);
  assert.equal(destination.units.some((unit) => unit.instanceId === enemy.instanceId), true);
  assert.equal(game.showdown?.attackerId, opponent.id);
  assert.equal(game.showdown?.defenderId, player.id);
});

test("ride the wind can move a friendly unit between battlefields and ready it", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const source = game.battlefields[0];
  const destination = game.battlefields[1];
  const unit = instance(cards.lonelyPoro, player.id, "ride-battlefield-unit");
  unit.exhausted = true;
  source.units = [unit];
  source.controlledBy = player.id;
  player.hand = [instance(cards.rideTheWind, player.id, "ride-battlefield-spell")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "ride-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "ride-energy-two"),
    rune(DOMAINS.CHAOS, player.id, "ride-power")
  ];

  assert.equal(beginPlayCard(game, "ride-battlefield-spell", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "ride-battlefield-unit").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-two", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(source.units.some((candidate) => candidate.instanceId === unit.instanceId), false);
  assert.equal(destination.units.some((candidate) => candidate.instanceId === unit.instanceId), true);
  assert.equal(unit.exhausted, false);
});

test("ride the wind stages the moved defender's empty-battlefield showdown until the original combat finishes", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const attackingPlayer = currentPlayer(game);
  const defendingPlayer = game.players.find((candidate) => candidate.id !== attackingPlayer.id);
  const originalField = game.battlefields[0];
  const emptyField = game.battlefields[1];
  const attacker = instance(cards.lonelyPoro, attackingPlayer.id, "ride-sequence-attacker");
  const defender = instance(cards.ravenbloomStudent, defendingPlayer.id, "ride-sequence-defender");
  const ride = instance({ ...cards.rideTheWind, energy: 0, power: [] }, defendingPlayer.id, "ride-sequence-spell");
  originalField.effects = [];
  originalField.units = [defender];
  originalField.controlledBy = defendingPlayer.id;
  emptyField.effects = [];
  emptyField.units = [];
  emptyField.controlledBy = null;
  attackingPlayer.base = [attacker];
  defendingPlayer.hand = [ride];
  attackingPlayer.legend.effects = [];
  defendingPlayer.legend.effects = [];
  attackingPlayer.score = 0;
  defendingPlayer.score = 0;
  const originalTurnSequence = game.turnSequence;

  assert.equal(moveUnit(game, attacker.instanceId, originalField.instanceId).ok, true);
  assert.equal(game.showdown.battlefieldId, originalField.instanceId);
  assert.equal(game.showdown.priorityPlayerId, attackingPlayer.id);
  assert.equal(passShowdown(game, attackingPlayer.id).ok, true);
  assert.equal(game.showdown.priorityPlayerId, defendingPlayer.id);

  assert.equal(beginPlayCard(game, ride.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, defender.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, emptyField.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (game.showdown?.battlefieldId === originalField.instanceId && game.showdown.chain.length) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }

  assert.equal(game.showdown.battlefieldId, originalField.instanceId, "the original combat remains active");
  assert.equal(originalField.units.includes(defender), false);
  assert.equal(emptyField.units.includes(defender), true);
  assert.equal(defender.exhausted, false);
  assert.equal(emptyField.controlledBy, null, "the destination is not conquered before its showdown");
  assert.equal(emptyField.contestedBy, defendingPlayer.id);
  assert.equal(game.stagedEvents.some((event) => event.type === "showdown"
    && event.battlefieldId === emptyField.instanceId
    && event.attackerId === defendingPlayer.id), true);
  assert.equal(attackingPlayer.score, 0);
  assert.equal(defendingPlayer.score, 0);

  while (game.showdown?.battlefieldId === originalField.instanceId) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }
  assert.equal(originalField.controlledBy, attackingPlayer.id);
  assert.equal(attackingPlayer.score, 1);
  assert.equal(attacker.damage, 0, "combat damage is skipped when no defender remains");
  assert.equal(game.showdown?.battlefieldId, emptyField.instanceId);
  assert.equal(game.showdown?.combat, false);
  assert.equal(game.showdown?.turnPlayerId, attackingPlayer.id,
    "an off-turn attacker does not become the turn player");
  assert.equal(game.showdown?.focusPlayerId, defendingPlayer.id);
  assert.equal(game.showdown?.priorityPlayerId, defendingPlayer.id);
  assert.equal(defendingPlayer.score, 0);

  while (game.showdown?.battlefieldId === emptyField.instanceId) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }
  assert.equal(emptyField.controlledBy, defendingPlayer.id);
  assert.equal(defendingPlayer.score, 1, "a player can conquer during the opponent's turn");
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, attackingPlayer.id,
    "the game returns to the actual turn player after the off-turn showdown");
  assert.equal(game.turnSequence, originalTurnSequence, "a showdown does not advance the turn");
  assert.equal(game.pendingEndTurnPlayerId, undefined);

  const nextHandBefore = defendingPlayer.hand.length;
  const nextDeckBefore = defendingPlayer.mainDeck.length;
  assert.equal(endTurn(game).ok, true);
  assert.equal(game.currentPlayerId, defendingPlayer.id);
  assert.equal(game.turnSequence, originalTurnSequence + 1);
  assert.equal(defendingPlayer.hand.length, nextHandBefore + 1, "the real next turn draws one card");
  assert.equal(defendingPlayer.mainDeck.length, nextDeckBefore - 1);
});

test("gear cannot be declared with a battlefield play destination", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const gear = instance({ ...cards.trinityForce, energy: 0, power: [], effects: [] }, player.id, "illegal-field-gear");
  player.hand = [gear];

  assert.deepEqual(legalCardPlayDestinations(game, gear.instanceId), ["base"]);
  assert.equal(beginPlayCard(game, gear.instanceId, field.instanceId).ok, false);
  assert.equal(player.hand.includes(gear), true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain, null);
});

test("manual Power payment can use an already exhausted rune", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "exhausted-power-target");
  const field = game.battlefields[0];
  const exhaustedPower = rune(DOMAINS.CALM, player.id, "exhausted-power-rune");
  exhaustedPower.exhausted = true;
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.charm, player.id, "exhausted-power-charm")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "exhausted-power-energy"),
    exhaustedPower
  ];

  assert.equal(beginPlayCard(game, "exhausted-power-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "exhausted-power-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(togglePaymentRune(game, "exhausted-power-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "exhausted-power-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "exhausted-power-rune"), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "exhausted-power-rune"), true);
});

test("simultaneous Power recycling follows chosen order, owner destination, and token cessation", () => {
  const paymentCard = (ownerId, id, amount = 1) => instance({
    ...cards.lonelyPoro,
    id: `TEST-POWER-RECYCLE-${amount}`,
    cardNumber: `TEST-POWER-RECYCLE-${amount}/001`,
    collectorNumber: `TEST-POWER-RECYCLE-${amount}/001`,
    name: "Rules Test Power Recycle",
    domains: [],
    energy: 0,
    power: [{ domain: DOMAINS.ANY, amount }],
    effects: []
  }, ownerId, id);

  {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const first = rune(DOMAINS.BODY, player.id, "power-order-first");
    const second = rune(DOMAINS.CALM, player.id, "power-order-second");
    const unused = rune(DOMAINS.FURY, player.id, "power-order-unused");
    player.hand = [paymentCard(player.id, "power-order-card", 2)];
    player.runes = [first, second, unused];
    player.runeDeck = [];

    assert.equal(beginPlayCard(game, "power-order-card", "base").ok, true);
    assert.equal(togglePaymentRune(game, second.instanceId, "power").ok, true);
    assert.equal(togglePaymentRune(game, first.instanceId, "power").ok, true);
    assert.equal(confirmPayment(game).ok, true);
    assert.deepEqual(player.runeDeck.map((card) => card.instanceId), [second.instanceId, first.instanceId]);
  }

  {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const owner = game.players.find((candidate) => candidate.id !== player.id);
    const foreignRune = rune(DOMAINS.BODY, owner.id, "foreign-controlled-rune");
    foreignRune.controllerId = player.id;
    player.hand = [paymentCard(player.id, "foreign-power-card")];
    player.runes = [foreignRune];
    player.runeDeck = [];
    owner.runeDeck = [];

    assert.equal(beginPlayCard(game, "foreign-power-card", "base").ok, true);
    assert.equal(togglePaymentRune(game, foreignRune.instanceId, "power").ok, true);
    assert.equal(confirmPayment(game).ok, true);
    assert.equal(player.runeDeck.length, 0);
    assert.deepEqual(owner.runeDeck.map((card) => card.instanceId), [foreignRune.instanceId]);
  }

  {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const tokenRune = rune(DOMAINS.BODY, player.id, "token-power-rune");
    tokenRune.isToken = true;
    player.hand = [paymentCard(player.id, "token-power-card")];
    player.runes = [tokenRune];
    player.runeDeck = [];

    assert.equal(beginPlayCard(game, "token-power-card", "base").ok, true);
    assert.equal(togglePaymentRune(game, tokenRune.instanceId, "power").ok, true);
    assert.equal(confirmPayment(game).ok, true);
    assert.equal(player.runes.length, 0);
    assert.equal(player.runeDeck.length, 0);
  }
});

test("automatic Power costs use shared owner and token recycle rules", () => {
  const run = ({ token = false }) => {
    const game = createGame({ interactive: false });
    finishSetup(game);
    const player = currentPlayer(game);
    const owner = game.players.find((candidate) => candidate.id !== player.id);
    const paidRune = rune(DOMAINS.BODY, owner.id, token ? "automatic-token-rune" : "automatic-foreign-rune");
    paidRune.controllerId = player.id;
    paidRune.isToken = token;
    const target = instance(cards.lonelyPoro, owner.id, token ? "automatic-token-target" : "automatic-foreign-target");
    target.keywords = ["Deflect"];
    const field = game.battlefields[0];
    field.units = [target];
    field.controlledBy = owner.id;
    player.runes = [paidRune];
    player.runeDeck = [];
    owner.runeDeck = [];

    resolveEffect(game, player, instance({ ...cards.incinerate, energy: 0, power: [] }, player.id, `automatic-power-spell-${token}`));
    return { player, owner, paidRune };
  };

  const foreign = run({ token: false });
  assert.equal(foreign.player.runes.length, 0);
  assert.equal(foreign.player.runeDeck.length, 0);
  assert.deepEqual(foreign.owner.runeDeck.map((card) => card.instanceId), [foreign.paidRune.instanceId]);

  const token = run({ token: true });
  assert.equal(token.player.runes.length, 0);
  assert.equal(token.player.runeDeck.length, 0);
  assert.equal(token.owner.runeDeck.length, 0);
});

test("deflect asks the user which rune to pay before resolving the effect", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const stupefy = instance(cards.stupefy, player.id, "stupefy");
  const vex = instance(cards.vexApathetic, opponent.id, "vex");
  const energyRune = rune(DOMAINS.CALM, player.id, "energy-rune");
  const deflectRune = rune(DOMAINS.BODY, player.id, "deflect-rune");

  player.hand = [stupefy];
  player.runes = [energyRune, deflectRune];
  player.runeDeck = [];
  opponent.base = [vex];

  assert.equal(beginPlayCard(game, stupefy.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [vex.instanceId]);
  assert.equal(chooseEffectOption(game, vex.instanceId).ok, true);
  assert.equal(game.pendingPayment.powerCost.some((cost) => cost.domain === "Any" && cost.amount === 1), true);
  assert.equal(togglePaymentRune(game, energyRune.instanceId, "energy").ok, true);
  assert.equal(togglePaymentRune(game, deflectRune.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(vex.mightModifier, -1);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === deflectRune.instanceId), false);
  assert.equal(player.runeDeck.at(-1).instanceId, deflectRune.instanceId);
  assert.equal(game.pendingChoice, null);
});

test("multiple Deflect instances sum their values into one additional play cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = instance(cards.lonelyPoro, opponent.id, "stacked-deflect-target");
  target.keywords = ["Deflect", "Deflect"];
  target.text = "[Deflect 2]\n[Deflect 3]";
  player.hand = [instance(cards.stupefy, player.id, "stacked-deflect-spell")];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.MIND, player.id, `stacked-deflect-rune-${index}`));
  opponent.base = [target];

  assert.equal(beginPlayCard(game, "stacked-deflect-spell", "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment.powerCost.some((cost) => cost.domain === "Any" && cost.amount === 5), true);
});

test("manual payment can recycle the same rune used for Energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  game.battlefields[0].units = [instance(cards.ravenbloomStudent, opponent.id, "single-rune-target")];
  game.battlefields[0].controlledBy = opponent.id;
  player.hand = [instance(cards.charm, player.id, "single-rune-charm")];
  player.runes = [rune(DOMAINS.CALM, player.id, "shared-rune")];

  assert.equal(beginPlayCard(game, "single-rune-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "single-rune-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(togglePaymentRune(game, "shared-rune", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "shared-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "shared-rune"), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "shared-rune"), true);
});

test("manual payment rejects runes that do not match the card Power color", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  game.battlefields[0].units = [instance(cards.ravenbloomStudent, opponent.id, "calm-power-target")];
  game.battlefields[0].controlledBy = opponent.id;
  const calmPowerCharm = instance({
    ...cards.charm,
    name: "Calm Power Charm",
    power: [{ domain: DOMAINS.CALM, amount: 1 }]
  }, player.id, "calm-power-charm");
  player.hand = [calmPowerCharm];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "wrong-power"),
    rune(DOMAINS.CALM, player.id, "right-power")
  ];

  assert.equal(beginPlayCard(game, "calm-power-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "calm-power-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(togglePaymentRune(game, "wrong-power", "power").ok, false);
  assert.equal(togglePaymentRune(game, "right-power", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "right-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "right-power"), true);
});

test("activated gear effects do not resolve as play effects", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  player.hand = [instance(cards.guardianAngel, player.id, "guardian-angel-gear")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "gear-r1"),
    rune(DOMAINS.CALM, player.id, "gear-r2")
  ];

  assert.equal(playCard(game, "guardian-angel-gear", "base").ok, true);
  assert.equal(player.base[0].name, "Guardian Angel");
  assert.equal(game.pendingChoice, null);
});

test("hidden cards are paid to a controlled battlefield and revealed into showdown", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  player.hand = [instance(cards.backOff, player.id, "hidden-back-off")];
  player.runes = [rune(DOMAINS.CALM, player.id, "hide-power")];

  hideWithRune(game, "hidden-back-off", field.instanceId, "hide-power");
  assert.equal(player.hand.length, 0);
  assert.equal(field.hidden.length, 1);
  assert.equal(player.runes.length, 0);

  const attacker = instance(cards.ravenbloomStudent, opponent.id, "hidden-attacker");
  const defender = instance(cards.lonelyPoro, player.id, "hidden-defender");
  field.units = [attacker, defender];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, "hidden-back-off", field.instanceId).ok, false);
  assert.equal(field.hidden.length, 1);

  game.turnSequence += 1;
  assert.equal(beginPlayCard(game, "hidden-back-off", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareHiddenPlayTarget");
  assert.equal(chooseEffectOption(game, "hidden-attacker").ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(game.showdown.chain[0].card.name, "Back Off");
  assert.deepEqual(game.showdown.chain[0].card.declaredPlayTargets, [
    { effect: "stunUnit", targetId: "hidden-attacker" }
  ]);
});

test("Hidden can move the Chosen Champion from the Champion Zone and preserves its identity when played", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const champion = player.champion;
  const field = game.battlefields[0];
  champion.keywords = [...new Set([...(champion.keywords || []), "Hidden"])];
  champion.effects = [];
  champion.energy = 0;
  champion.power = [];
  field.controlledBy = player.id;
  player.runes = [rune(DOMAINS.CALM, player.id, "hidden-champion-rune")];

  hideWithRune(game, champion.instanceId, field.instanceId, "hidden-champion-rune");

  assert.equal(champion.zone, "hidden");
  assert.equal(player.championPlayed, false);
  assert.equal(field.hidden[0].card.instanceId, champion.instanceId);
  assert.deepEqual(legalChampionPlayDestinations(game), [], "the empty Champion Zone cannot play its former card");

  const room = {
    roomId: "HIDDEN-CHAMPION",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true }, p2: { ready: true } },
    game,
    createdAt: 0,
    updatedAt: 0
  };
  const opponentSnapshot = snapshotForPlayer(room, opponent.id).game;
  const hiddenChampionView = opponentSnapshot.players.find((candidate) => candidate.id === player.id).champion;
  assert.equal(hiddenChampionView.redacted, true);
  assert.equal(hiddenChampionView.zone, "hidden");

  game.turnSequence += 1;
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    combat: false,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(beginPlayCard(game, champion.instanceId, field.instanceId).ok, true);
  assert.equal(champion.zone, "chain");
  assert.equal(player.championPlayed, false);
  assert.equal(field.units.some((unit) => unit.instanceId === champion.instanceId), false);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(champion.zone, "played");
  assert.equal(player.championPlayed, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(field.units.some((unit) => unit.instanceId === champion.instanceId), true);
});

test("Bandle Tree allows one additional hidden card for its controller", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.name = "Bandle Tree";
  field.controlledBy = player.id;
  field.effects = structuredClone(cards.bandleTree.effects);
  player.hand = [
    instance(cards.backOff, player.id, "bandle-hidden-1"),
    instance(cards.standUnited, player.id, "bandle-hidden-2"),
    instance(cards.backOff, player.id, "bandle-hidden-3")
  ];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "bandle-hide-power-1"),
    rune(DOMAINS.CALM, player.id, "bandle-hide-power-2"),
    rune(DOMAINS.CALM, player.id, "bandle-hide-power-3")
  ];

  hideWithRune(game, "bandle-hidden-1", field.instanceId, "bandle-hide-power-1");
  hideWithRune(game, "bandle-hidden-2", field.instanceId, "bandle-hide-power-2");
  assert.equal(hideCard(game, "bandle-hidden-3", field.instanceId).ok, false);
  assert.equal(field.hidden.length, 2);
});

test("Cleanup lets the Facedown Zone controller choose cards discarded after its capacity decreases", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance(cards.backOff, player.id, "overflow-hidden-first");
  const second = instance(cards.packOfWonders, player.id, "overflow-hidden-second");
  first.hidden = true;
  second.hidden = true;
  field.controlledBy = player.id;
  field.units = [instance(cards.lonelyPoro, player.id, "overflow-field-controller")];
  field.hidden = [
    { ownerId: player.id, hiddenByPlayerId: player.id, card: first },
    { ownerId: player.id, hiddenByPlayerId: player.id, card: second }
  ];

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "cleanupFacedownOverflow");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId).sort(), [first.instanceId, second.instanceId].sort());
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);

  assert.equal(field.hidden.length, 1);
  assert.equal(field.hidden[0].card.instanceId, second.instanceId);
  assert.equal(player.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(first.hidden, false);
});

test("back off draws only when played from hand, not from hidden", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const target = instance(cards.ravenbloomStudent, opponent.id, "back-off-target");
  opponent.base = [target];
  const drawCard = instance(cards.charm, player.id, "back-off-draw");
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.backOff, player.id, "hand-back-off")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "back-off-r1"),
    rune(DOMAINS.CALM, player.id, "back-off-r2"),
    rune(DOMAINS.CALM, player.id, "back-off-r3")
  ];

  assert.equal(playCard(game, "hand-back-off", "base").ok, true);
  assert.equal(target.stunned, true);
  assert.equal(player.hand.some((card) => card.instanceId === "back-off-draw"), true);

  const field = game.battlefields[0];
  const hiddenBackOff = instance(cards.backOff, player.id, "revealed-back-off");
  hiddenBackOff.playedFromHidden = true;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  field.units = [target, instance(cards.lonelyPoro, player.id, "back-off-defender")];
  player.mainDeck = [instance(cards.charm, player.id, "hidden-back-off-no-draw")];
  const handCountBefore = player.hand.length;

  assert.equal(resolveEffect(game, player, hiddenBackOff), true);
  assert.equal(game.pendingChoice.effect, "stunUnit");
  assert.equal(chooseEffectOption(game, "back-off-target").ok, true);
  assert.equal(player.hand.length, handCountBefore);
});

test("hidden spell targets are restricted to the battlefield where the card was hidden", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const hiddenBackOff = instance(cards.backOff, player.id, "restricted-hidden-back-off");
  hiddenBackOff.playedFromHidden = true;
  hiddenBackOff.hiddenBattlefieldId = game.battlefields[0].instanceId;
  const localTarget = instance(cards.ravenbloomStudent, opponent.id, "local-hidden-target");
  const remoteTarget = instance(cards.ravenbloomStudent, opponent.id, "remote-hidden-target");
  game.battlefields[0].units = [localTarget];
  game.battlefields[1].units = [remoteTarget];

  assert.equal(resolveEffect(game, player, hiddenBackOff), true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["local-hidden-target"]);
});

test("hidden cards are trashed during cleanup when their controller loses the battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  player.hand = [instance(cards.backOff, player.id, "cleanup-hidden-back-off")];
  player.runes = [rune(DOMAINS.CALM, player.id, "cleanup-hide-power")];

  hideWithRune(game, "cleanup-hidden-back-off", field.instanceId, "cleanup-hide-power");
  assert.equal(field.hidden.length, 1);

  field.controlledBy = opponent.id;
  assert.equal(endTurn(game).ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "cleanup-hidden-back-off"), true);
  assert.equal(game.revealEvents.at(-1).zone, "facedown");
  assert.deepEqual(game.revealEvents.at(-1).cardIds, ["cleanup-hidden-back-off"]);
});

test("a facedown card remains while its controller still controls the battlefield even if its owner differs", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const owner = currentPlayer(game);
  const controller = game.players.find((candidate) => candidate.id !== owner.id);
  const field = game.battlefields[0];
  const hiddenCard = instance(cards.backOff, owner.id, "controlled-hidden-back-off");
  hiddenCard.controllerId = controller.id;
  hiddenCard.hidden = true;
  field.controlledBy = controller.id;
  field.units = [instance(cards.lonelyPoro, controller.id, "controlled-hidden-occupant")];
  field.hidden = [{
    card: hiddenCard,
    ownerId: owner.id,
    hiddenByPlayerId: owner.id,
    playableFromTurnSequence: (game.turnSequence || 0) + 1
  }];

  assert.equal(endTurn(game).ok, true);
  assert.equal(field.hidden.some((item) => item.card.instanceId === hiddenCard.instanceId), true);
  assert.equal(owner.trash.some((card) => card.instanceId === hiddenCard.instanceId), false);
});

test("Ready Step does not clear Stunned after the next Ending Step has already begun", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "ready-step-stunned-unit");
  unit.stunned = true;
  player.base = [unit];

  startTurn(game);

  assert.equal(unit.stunned, true);
});

test("Ready Step readies every controlled non-spell object including a Battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.exhausted = true;

  startTurn(game);

  assert.equal(field.exhausted, false);
  assert.equal(game.readyEvents.at(-1).cardIds.includes(field.instanceId), true);
});

test("cleanup repeats after lethal units change battlefield control and invalidates hidden cards", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [instance(cards.lonelyPoro, player.id, "cleanup-loop-poro")];
  player.hand = [
    instance(cards.backOff, player.id, "cleanup-loop-hidden"),
    instance(cards.uncheckedPower, player.id, "cleanup-loop-boardwipe")
  ];
  player.mainDeck = [instance(cards.charm, player.id, "cleanup-loop-draw")];
  player.runes = Array.from({ length: 10 }, (_, index) => rune(DOMAINS.MIND, player.id, `cleanup-loop-r${index}`));

  hideWithRune(game, "cleanup-loop-hidden", field.instanceId, "cleanup-loop-r0");
  assert.equal(field.hidden.length, 1);
  assert.equal(playCard(game, "cleanup-loop-boardwipe", "base").ok, true);

  assert.equal(field.units.length, 0);
  assert.equal(field.controlledBy, null);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "cleanup-loop-hidden"), true);
});

test("cleanup finishes hidden removal before resolving deathknell draw choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [instance(cards.lonelyPoro, player.id, "cleanup-pending-poro")];
  player.base = [
    instance(cards.frigidJewel, player.id, "cleanup-pending-jewel"),
    instance(cards.clockworkKeeper, player.id, "cleanup-pending-target")
  ];
  player.drawCountThisTurn = 1;
  player.mainDeck = [instance(cards.charm, player.id, "cleanup-pending-draw")];
  player.hand = [
    instance(cards.backOff, player.id, "cleanup-pending-hidden"),
    instance(cards.uncheckedPower, player.id, "cleanup-pending-boardwipe")
  ];
  player.runes = Array.from({ length: 10 }, (_, index) => rune(DOMAINS.MIND, player.id, `cleanup-pending-r${index}`));

  hideWithRune(game, "cleanup-pending-hidden", field.instanceId, "cleanup-pending-r0");
  assert.equal(playCard(game, "cleanup-pending-boardwipe", "base").ok, true);

  assert.equal(field.units.length, 0);
  assert.equal(field.controlledBy, null);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "cleanup-pending-hidden"), true);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
});

test("simultaneous cleanup deaths are removed before other-unit death triggers are evaluated", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const victim = instance(cards.lonelyPoro, opponent.id, "simultaneous-viktor-victim");
  victim.effects = [];
  const viktor = instance(cards.viktorLeader, opponent.id, "simultaneous-viktor-source");
  field.units = [victim, viktor];
  field.controlledBy = opponent.id;
  player.hand = [instance({
    id: "test-simultaneous-sweep",
    name: "Simultaneous Rules Sweep",
    type: "spell",
    energy: 0,
    power: [],
    tags: [],
    keywords: [],
    effects: [{ timing: "spell", kind: "dealDamageAllBattlefieldUnits", amount: 20 }]
  }, player.id, "simultaneous-rules-sweep")];

  assert.equal(playCard(game, "simultaneous-rules-sweep", "base").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === victim.instanceId), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === viktor.instanceId), true);
  assert.equal(opponent.base.some((card) => (card.tags || []).includes("Recruit")), false);
});

test("a spell-killed Immortal Phoenix can trigger from trash after its simultaneous death", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const phoenix = instance(cards.immortalPhoenix, player.id, "simultaneous-immortal-phoenix");
  const enemy = instance(cards.lonelyPoro, opponent.id, "simultaneous-phoenix-enemy");
  field.units = [phoenix, enemy];
  field.controlledBy = opponent.id;
  player.runes = [rune(DOMAINS.FURY, player.id, "phoenix-return-power")];
  player.hand = [instance({
    id: "test-phoenix-sweep",
    name: "Phoenix Rules Sweep",
    type: "spell",
    energy: 0,
    power: [],
    tags: [],
    keywords: [],
    effects: [{ timing: "spell", kind: "dealDamageAllBattlefieldUnits", amount: 20 }]
  }, player.id, "phoenix-rules-sweep")];

  assert.equal(playCard(game, "phoenix-rules-sweep", "base").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === phoenix.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === phoenix.instanceId), false);
});

test("a direct spell Kill is attributed to its controller for Immortal Phoenix", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const phoenix = instance(cards.immortalPhoenix, player.id, "direct-kill-immortal-phoenix");
  const victim = instance(cards.lonelyPoro, opponent.id, "direct-kill-phoenix-victim");
  const spell = instance({
    ...cards.hiddenBlade,
    name: "Rules Test Direct Kill",
    energy: 0,
    power: [],
    effects: [{ timing: "spell", kind: "killUnit", target: "battlefieldUnit" }]
  }, player.id, "direct-kill-phoenix-spell");
  game.battlefields[0].units = [victim];
  game.battlefields[0].controlledBy = opponent.id;
  player.trash = [phoenix];
  player.runes = [rune(DOMAINS.FURY, player.id, "direct-kill-phoenix-power")];

  assert.equal(resolveEffect(game, player, spell), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === victim.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === phoenix.instanceId), true);
  assert.equal(game.killEvents.at(-1)?.origin, "spell");
  assert.equal(game.killEvents.at(-1)?.responsiblePlayerId, player.id);
});

test("Quick-Draw uses its shared play trigger to attach without activating Equip", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "quick-draw-unit");
  const gear = instance({
    ...cards.trinityForce,
    id: "TEST-QUICK-DRAW",
    cardNumber: "TEST-QUICK-DRAW/001",
    collectorNumber: "TEST-QUICK-DRAW/001",
    name: "Rules Test Quick-Draw Gear",
    energy: 0,
    keywords: ["Equip", "Quick-Draw"],
    text: "[Quick-Draw]\n[Equip] Body Power"
  }, player.id, "quick-draw-gear");
  player.base = [unit];
  player.hand = [gear];
  player.runes = [];

  assert.equal(beginPlayCard(game, gear.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === gear.instanceId), false);
  while (!game.pendingChoice && game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "quickDrawAttach");
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  while (game.actionChain && !game.pendingChoice && !game.pendingPayment) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(unit.attachments.some((card) => card.instanceId === gear.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === gear.instanceId), false);
});

test("Quick-Draw can be played and attached with Reaction timing by the player holding showdown priority", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const turnPlayer = currentPlayer(game);
  const reactingPlayer = game.players.find((candidate) => candidate.id !== turnPlayer.id);
  const unit = instance(cards.lonelyPoro, reactingPlayer.id, "quick-draw-reaction-unit");
  const gear = instance({
    ...cards.trinityForce,
    id: "TEST-QUICK-DRAW-REACTION",
    cardNumber: "TEST-QUICK-DRAW-REACTION/001",
    collectorNumber: "TEST-QUICK-DRAW-REACTION/001",
    name: "Rules Test Reaction Quick-Draw Gear",
    energy: 0,
    power: [],
    keywords: ["Equip", "Quick-Draw"],
    text: "[Quick-Draw]\n[Equip] Body Power"
  }, reactingPlayer.id, "quick-draw-reaction-gear");
  reactingPlayer.base = [unit];
  reactingPlayer.hand = [gear];
  reactingPlayer.runes = [];
  const field = game.battlefields[0];
  game.phase = "showdown";
  game.currentPlayerId = reactingPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: turnPlayer.id,
    attackerId: turnPlayer.id,
    defenderId: reactingPlayer.id,
    combat: false,
    focusPlayerId: reactingPlayer.id,
    priorityPlayerId: reactingPlayer.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(beginPlayCard(game, gear.instanceId, "base").ok, true);
  assert.equal(game.pendingPayment?.cardId, gear.instanceId);
  assert.equal(confirmPayment(game).ok, true);
  let steps = 0;
  while (!(unit.attachments || []).some((card) => card.instanceId === gear.instanceId) && steps < 16) {
    if (game.pendingChoice?.effect === "quickDrawAttach") {
      assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
      steps += 1;
      continue;
    }
    assert.equal(game.phase, "showdown");
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    steps += 1;
  }

  assert.equal((unit.attachments || []).some((card) => card.instanceId === gear.instanceId), true);
  assert.equal(reactingPlayer.base.some((card) => card.instanceId === gear.instanceId), false);
});

test("Weaponmaster declares Equipment, pays its Equip cost, and attaches through the shared keyword resolver", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const akshan = instance(cards.akshanMischievous, player.id, "weaponmaster-akshan");
  const equipment = instance(cards.trinityForce, player.id, "weaponmaster-equipment");
  player.base = [equipment];
  player.hand = [akshan];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `weaponmaster-rune-${index}`));

  assert.equal(beginPlayCard(game, akshan.instanceId, "base").ok, true);
  for (const runeCard of player.runes) assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (!game.pendingChoice && game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "weaponmasterEquipment");
  assert.equal(chooseEffectOption(game, equipment.instanceId).ok, true);
  while (game.actionChain && !game.pendingChoice && !game.pendingPayment) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingPayment?.source, "weaponmaster");
  assert.equal(game.pendingPayment.powerCost[0].domain, DOMAINS.BODY);
  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(akshan.attachments.some((card) => card.instanceId === equipment.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === equipment.instanceId), false);
});

test("Weaponmaster discounts one universal Power rather than one Energy", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const weaponmaster = instance({
    ...cards.akshanMischievous,
    name: "Universal Weaponmaster",
    energy: 0,
    power: [],
    effects: [],
    keywords: ["Weaponmaster"]
  }, player.id, "universal-weaponmaster");
  const equipment = instance({
    ...cards.trinityForce,
    name: "Universal Equipment",
    effects: [
      { timing: "activated", kind: "equip", domain: "Any", amount: 1 },
      { timing: "static", kind: "attachedMight", textSection: "mightBonus", amount: 2 }
    ]
  }, player.id, "universal-equipment");
  player.base = [equipment];
  player.hand = [weaponmaster];
  player.runes = [];

  assert.equal(playCard(game, weaponmaster.instanceId, "base").ok, true);
  assert.deepEqual((weaponmaster.attachments || []).map((card) => card.instanceId), [equipment.instanceId],
    "the single Any Power Equip cost is reduced to zero");
});

test("Weaponmaster may choose Equipment without Equip and leaves it in its current location", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const weaponmaster = instance({
    ...cards.akshanMischievous,
    id: "TEST-WEAPONMASTER-NO-EQUIP",
    cardNumber: "TEST-WEAPONMASTER-NO-EQUIP/001",
    collectorNumber: "TEST-WEAPONMASTER-NO-EQUIP/001",
    name: "Rules Test Weaponmaster",
    energy: 0,
    power: [],
    effects: [],
    keywords: ["Weaponmaster"]
  }, player.id, "weaponmaster-no-equip-unit");
  const equipment = instance({
    ...cards.trinityForce,
    id: "TEST-EQUIPMENT-NO-EQUIP",
    cardNumber: "TEST-EQUIPMENT-NO-EQUIP/001",
    collectorNumber: "TEST-EQUIPMENT-NO-EQUIP/001",
    name: "Rules Test Equipment Without Equip",
    effects: [],
    tags: ["Equipment"]
  }, player.id, "weaponmaster-no-equip-gear");
  player.base = [equipment];
  player.hand = [weaponmaster];
  player.runes = [];

  assert.equal(beginPlayCard(game, weaponmaster.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (!game.pendingChoice && game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "weaponmasterEquipment");
  assert.equal(chooseEffectOption(game, equipment.instanceId).ok, true);
  let steps = 0;
  while (game.actionChain && !game.pendingChoice && !game.pendingPayment && steps < 8) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    steps += 1;
  }

  assert.equal(game.pendingPayment, null);
  assert.equal(player.base.some((card) => card.instanceId === equipment.instanceId), true);
  assert.equal((weaponmaster.attachments || []).length, 0);
});

test("Weaponmaster leaves Equipment in place when its discounted Equip cost cannot be paid", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const weaponmaster = instance({
    ...cards.akshanMischievous,
    id: "TEST-WEAPONMASTER-UNPAID",
    cardNumber: "TEST-WEAPONMASTER-UNPAID/001",
    collectorNumber: "TEST-WEAPONMASTER-UNPAID/001",
    name: "Rules Test Unpaid Weaponmaster",
    energy: 0,
    power: [],
    effects: [],
    keywords: ["Weaponmaster"]
  }, player.id, "weaponmaster-unpaid-unit");
  const equipment = instance(cards.trinityForce, player.id, "weaponmaster-unpaid-gear");
  player.base = [equipment];
  player.hand = [weaponmaster];
  player.runes = [];

  assert.equal(beginPlayCard(game, weaponmaster.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (!game.pendingChoice && game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(chooseEffectOption(game, equipment.instanceId).ok, true);
  let steps = 0;
  while (!game.pendingPayment && game.actionChain && steps < 8) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    steps += 1;
  }
  assert.equal(game.pendingPayment?.source, "weaponmaster");
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(cancelPayment(game).ok, true);
  while (game.actionChain && !game.pendingChoice && !game.pendingPayment && steps < 16) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    steps += 1;
  }

  assert.equal(player.base.some((card) => card.instanceId === equipment.instanceId), true);
  assert.equal((weaponmaster.attachments || []).length, 0);
});

test("multiple Weaponmaster instances resolve separately even when they choose the same Equipment", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const weaponmaster = instance({
    ...cards.akshanMischievous,
    id: "TEST-DOUBLE-WEAPONMASTER",
    cardNumber: "TEST-DOUBLE-WEAPONMASTER/001",
    collectorNumber: "TEST-DOUBLE-WEAPONMASTER/001",
    name: "Rules Test Double Weaponmaster",
    energy: 0,
    power: [],
    effects: [],
    keywords: ["Weaponmaster", "Weaponmaster"]
  }, player.id, "double-weaponmaster-unit");
  const equipment = instance(cards.trinityForce, player.id, "double-weaponmaster-gear");
  player.base = [equipment];
  player.hand = [weaponmaster];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "double-weaponmaster-rune-1"),
    rune(DOMAINS.BODY, player.id, "double-weaponmaster-rune-2")
  ];

  assert.equal(playCard(game, weaponmaster.instanceId, "base").ok, true);
  assert.deepEqual((weaponmaster.attachments || []).map((card) => card.instanceId), [equipment.instanceId]);
  assert.equal(player.runes.length, 0, "each Weaponmaster instance pays the Equip Power cost separately");
  assert.equal(player.runeDeck.filter((card) => card.instanceId.startsWith("double-weaponmaster-rune-")).length, 2);
  assert.equal(game.log.filter((entry) => entry.includes("attaches Trinity Force")).length, 1,
    "attaching an already attached card to the same Top-Most card has no effect");
  assert.equal(game.attachmentEvents.filter((event) => event.action === "attach").length, 1);
});

test("attaching Equipment to a new Top-Most card records the required Detach first", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const oldTopMost = instance(cards.lonelyPoro, player.id, "reattach-old-top");
  const weaponmaster = instance({ ...cards.akshanMischievous, energy: 0, power: [] }, player.id, "reattach-weaponmaster");
  const equipment = instance(cards.trinityForce, player.id, "reattach-equipment");
  oldTopMost.attachments = [equipment];
  equipment.attachedToId = oldTopMost.instanceId;
  player.base = [oldTopMost];
  player.hand = [weaponmaster];
  player.runes = [rune(DOMAINS.BODY, player.id, "reattach-power")];

  assert.equal(playCard(game, weaponmaster.instanceId, "base").ok, true);
  assert.deepEqual(oldTopMost.attachments, []);
  assert.deepEqual(weaponmaster.attachments.map((card) => card.instanceId), [equipment.instanceId]);
  assert.deepEqual(game.attachmentEvents.map((event) => event.action), ["detach", "attach"]);
  assert.equal(game.attachmentEvents[0].topMostCardId, oldTopMost.instanceId);
  assert.equal(game.attachmentEvents[1].topMostCardId, weaponmaster.instanceId);
});

test("activated equipment attaches only after explicit activation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "equip-target");
  const gear = instance(cards.guardianAngel, player.id, "guardian-equip");
  player.base = [unit, gear];
  player.runes = [rune(DOMAINS.CALM, player.id, "equip-power")];

  assert.equal(activateCard(game, "guardian-equip").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "equip-target").ok, true);
  assert.equal(game.pendingPayment?.source, "activatedAbility");
  assert.deepEqual(game.pendingPayment?.powerCost, [{ domain: DOMAINS.CALM, amount: 1 }]);
  assert.equal(togglePaymentRune(game, "equip-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(unit.attachments[0].name, "Guardian Angel");
  assert.equal(gear.exhausted, false, "Equip does not add an Exhaust cost that is absent from the printed ability");
  assert.equal(player.base.some((card) => card.instanceId === "guardian-equip"), false);
});

test("attached Rules Text is inactive while Effect Text is appended to the Top-Most card", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "effect-text-top-most");
  const gear = instance({
    ...cards.guardianAngel,
    id: "TEST-EFFECT-TEXT-GEAR",
    cardNumber: "TEST-EFFECT-TEXT-GEAR/001",
    collectorNumber: "TEST-EFFECT-TEXT-GEAR/001",
    name: "Rules Test Effect Text Gear",
    effects: [
      ...structuredClone(cards.guardianAngel.effects),
      { timing: "activated", kind: "draw", amount: 1, exhaust: false, textSection: "effect" }
    ]
  }, player.id, "effect-text-gear");
  const drawn = instance(cards.charm, player.id, "effect-text-draw");
  player.base = [unit, gear];
  player.mainDeck = [drawn];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "effect-text-equip-power"),
    rune(DOMAINS.CALM, player.id, "effect-text-rules-probe-power")
  ];

  assert.equal(activateCard(game, gear.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "effect-text-equip-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(gear.attachedToId, unit.instanceId);
  assert.equal(activateCard(game, gear.instanceId).ok, false, "the attached Gear's printed Equip text is inactive");
  assert.equal(activateCard(game, unit.instanceId).ok, true, "the attached Gear's Effect Text is appended to the Top-Most Unit");
  for (let passes = 0; game.actionChain && !game.pendingChoice && !game.pendingPayment && passes < 8; passes += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
});

test("Equip cannot be started when its activation Power cannot be paid", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "unpaid-equip-target");
  const gear = instance(cards.guardianAngel, player.id, "unpaid-equip-gear");
  player.base = [unit, gear];
  player.runes = [];

  assert.deepEqual(legalActivatedAbilityOptions(game, gear.instanceId), []);
  assert.equal(activateCard(game, gear.instanceId).ok, false);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.base.some((card) => card.instanceId === gear.instanceId), true);
  assert.equal((unit.attachments || []).length, 0);
});

test("automatic activated Power payment recycles the paid rune", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const gear = instance({
    ...cards.treasureTrove,
    id: "TEST-AUTOMATIC-POWER-ABILITY",
    cardNumber: "TEST-AUTOMATIC-POWER-ABILITY/001",
    collectorNumber: "TEST-AUTOMATIC-POWER-ABILITY/001",
    name: "Rules Test Automatic Power Ability",
    effects: cards.treasureTrove.effects.filter((effect) => effect.timing === "activated")
  }, player.id, "automatic-power-ability");
  const powerRune = rune(DOMAINS.CHAOS, player.id, "automatic-ability-power");
  player.base = [gear];
  player.runes = [powerRune];
  player.runeDeck = [];

  assert.equal(activateCard(game, gear.instanceId).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === gear.instanceId), true);
  assert.equal(player.runes.some((card) => card.instanceId === powerRune.instanceId), false);
  assert.equal(player.runeDeck.some((card) => card.instanceId === powerRune.instanceId), true);
});

test("ordinary activated abilities use the action Chain before resolving", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const ballista = instance(cards.ironBallista, player.id, "activated-chain-ballista");
  const target = instance(cards.lonelyPoro, opponent.id, "activated-chain-target");
  target.might = 5;
  player.base = [ballista];
  player.hand = [instance({
    ...cards.charm,
    id: "TEST-ACTIVATED-CHAIN-CONTROLLER-REACTION",
    cardNumber: "TEST-ACTIVATED-CHAIN-CONTROLLER-REACTION/001",
    collectorNumber: "TEST-ACTIVATED-CHAIN-CONTROLLER-REACTION/001",
    name: "Rules Test Controller Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, player.id, "activated-chain-controller-reaction")];
  opponent.hand = [instance({
    ...cards.charm,
    id: "TEST-ACTIVATED-CHAIN-REACTION",
    cardNumber: "TEST-ACTIVATED-CHAIN-REACTION/001",
    collectorNumber: "TEST-ACTIVATED-CHAIN-REACTION/001",
    name: "Rules Test Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, opponent.id, "activated-chain-reaction")];
  game.battlefields[0].units = [target];
  game.battlefields[0].controlledBy = opponent.id;

  assert.equal(activateCard(game, ballista.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(game.actionChain?.chain?.[0]?.itemType, "activated");
  assert.equal(game.actionChain?.chain?.[0]?.status, "pending");
  assert.equal(game.actionChain?.chain?.[0]?.playOptions?.declarationsComplete, false);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, 0);
  assert.equal(game.actionChain?.chain?.[0]?.itemType, "activated");
  assert.equal(game.actionChain?.chain?.[0]?.status, "finalized");
  assert.equal(game.actionChain?.priorityPlayerId, player.id);
  assert.equal(game.actionChain?.consecutivePasses, 0);
  assert.equal(passShowdown(game, player.id).ok, true);
  const finalPass = passShowdown(game, opponent.id);
  assert.equal(finalPass.ok, true, finalPass.message);

  assert.equal(target.damage, 2);
  assert.equal(game.actionChain, null);
});

test("cancelling an activated ability cost removes its Pending item without paying or exhausting", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const trove = instance(cards.treasureTrove, player.id, "cancel-activated-trove");
  const powerRune = rune(DOMAINS.CHAOS, player.id, "cancel-activated-rune");
  player.base = [trove];
  player.runes = [powerRune];
  player.runeDeck = [];

  assert.equal(activateCard(game, trove.instanceId).ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(game.actionChain.chain[0].status, "pending");
  assert.equal(trove.exhausted, false);

  assert.equal(cancelPayment(game).ok, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.base.some((card) => card.instanceId === trove.instanceId), true);
  assert.equal(trove.exhausted, false);
  assert.equal(player.runes.some((card) => card.instanceId === powerRune.instanceId), true);
  assert.equal(player.runeDeck.length, 0);
});

test("an activated ability legality failure rolls back its complete Pending transaction", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const syren = instance(cards.theSyren, player.id, "rollback-activated-syren");
  const target = instance(cards.lonelyPoro, player.id, "rollback-activated-target");
  const paymentRune = rune(DOMAINS.CALM, player.id, "rollback-activated-rune");
  player.base = [syren];
  player.runes = [paymentRune];
  game.battlefields[0].units = [target];
  game.battlefields[0].controlledBy = player.id;

  assert.equal(activateCard(game, syren.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment?.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, paymentRune.instanceId, "energy").ok, true);

  game.battlefields[0].units = [];
  target.zoneChangeCounter = (target.zoneChangeCounter || 0) + 1;
  player.hand.push(target);
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(paymentRune.exhausted, false, "resource payment is undone when Check Legality fails");
  assert.equal(syren.exhausted, false);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain, null);
});

test("attached gear recalls to base when its unit leaves the board", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, player.id, "gear-cleanup-unit");
  const gear = instance(cards.trinityForce, player.id, "gear-cleanup-trinity");
  unit.attachments = [gear];
  field.units = [unit];
  field.controlledBy = player.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "gear-cleanup-spell")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `gear-cleanup-rune-${index}`));

  assert.equal(playCard(game, "gear-cleanup-spell", "base").ok, true);

  assert.equal(field.units.some((card) => card.instanceId === "gear-cleanup-unit"), false);
  assert.equal(player.trash.some((card) => card.instanceId === "gear-cleanup-unit"), true);
  assert.equal(player.base.some((card) => card.instanceId === "gear-cleanup-trinity"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "gear-cleanup-trinity"), false);
});

test("disarming rake may kill a chosen gear when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const gear = instance(cards.guardianAngel, opponent.id, "rake-target-gear");
  opponent.base = [gear];
  player.hand = [instance(cards.disarmingRake, player.id, "explicit-rake")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `rake-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-rake", "base").ok, true);
  for (const runeId of ["rake-r0", "rake-r1", "rake-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "rake-r0", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(game.actionChain?.chain.length || 0, 0,
    "an optional trigger is not Pending until its controller places it");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "trashGear");

  assert.equal(chooseEffectOption(game, "rake-target-gear").ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === "rake-target-gear"), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === "rake-target-gear"), true);
});

test("disarming rake does not trigger when there is no legal gear target", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.hand = [instance(cards.disarmingRake, player.id, "targetless-rake")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `targetless-rake-r${index}`));

  assert.equal(beginPlayCard(game, "targetless-rake", "base").ok, true);
  for (const runeId of ["targetless-rake-r0", "targetless-rake-r1", "targetless-rake-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "targetless-rake-r0", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.base.some((card) => card.instanceId === "targetless-rake"), true);
});

test("on-play triggers use the declared target and do not retarget at resolution", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const declaredGear = instance(cards.guardianAngel, opponent.id, "declared-rake-gear");
  const otherGear = instance(cards.trinityForce, opponent.id, "other-rake-gear");
  opponent.base = [declaredGear, otherGear];
  player.hand = [instance(cards.disarmingRake, player.id, "retarget-rake")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `retarget-rake-r${index}`));

  assert.equal(beginPlayCard(game, "retarget-rake", "base").ok, true);
  for (const runeId of ["retarget-rake-r0", "retarget-rake-r1", "retarget-rake-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "retarget-rake-r0", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "trashGear");

  opponent.base = opponent.base.filter((card) => card.instanceId !== "declared-rake-gear");
  opponent.hand.push(declaredGear);

  assert.equal(chooseEffectOption(game, "declared-rake-gear").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "declared-rake-gear"), true);
  assert.equal(opponent.base.some((card) => card.instanceId === "other-rake-gear"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "declared-rake-gear"), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === "other-rake-gear"), false);
});

test("en garde gives an additional might when the unit is alone there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "en-garde-unit");
  player.base = [unit];
  player.hand = [instance(cards.enGarde, player.id, "explicit-en-garde")];
  player.runes = [rune(DOMAINS.CALM, player.id, "en-garde-rune")];

  assert.equal(beginPlayCard(game, "explicit-en-garde", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["en-garde-unit"]);
  assert.equal(chooseEffectOption(game, "en-garde-unit").ok, true);
  assert.equal(togglePaymentRune(game, "en-garde-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(unit.mightModifier, 2);
});

test("whiteflame protector gives a chosen unit plus eight might when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const target = instance(cards.ravenbloomStudent, opponent.id, "whiteflame-target");
  opponent.base = [target];
  player.hand = [instance(cards.whiteflameProtector, player.id, "explicit-whiteflame")];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.CALM, player.id, `whiteflame-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-whiteflame", "base").ok, true);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(togglePaymentRune(game, `whiteflame-r${index}`, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "whiteflame-r0", "power").ok, true);
  assert.equal(togglePaymentRune(game, "whiteflame-r1", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "modifyMight");

  assert.equal(chooseEffectOption(game, "whiteflame-target").ok, true);
  assert.equal(target.mightModifier, 8);
});

test("rebuke returns a battlefield unit to its owner's hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.ravenbloomStudent, opponent.id, "rebuke-target");
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.rebuke, player.id, "explicit-rebuke")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "rebuke-r0"),
    rune(DOMAINS.CHAOS, player.id, "rebuke-r1")
  ];

  assert.equal(beginPlayCard(game, "explicit-rebuke", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "rebuke-target").ok, true);
  for (const runeId of ["rebuke-r0", "rebuke-r1"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
    assert.equal(togglePaymentRune(game, runeId, "power").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "rebuke-target"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "rebuke-target"), true);
});

test("a token returned from a battlefield ceases to exist instead of entering its owner's hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const token = instance(cards.sprite, opponent.id, "returned-sprite-token");
  token.isToken = true;
  field.units = [token];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.gust, player.id, "token-return-gust")];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "token-return-rune")];

  assert.equal(beginPlayCard(game, "token-return-gust", "base").ok, true);
  assert.equal(chooseEffectOption(game, token.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "token-return-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(field.units.some((unit) => unit.instanceId === token.instanceId), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === token.instanceId), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === token.instanceId), false);
});

test("turn to dust declares a gear target and can target attached gear", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "temporary-gear-carrier");
  const attachedGear = instance(cards.guardianAngel, player.id, "attached-temporary-gear");
  const baseGear = instance(cards.trinityForce, player.id, "base-temporary-gear");
  unit.attachments = [attachedGear];
  player.base = [unit, baseGear];
  player.hand = [instance(cards.turnToDust, player.id, "turn-dust")];
  player.runes = [rune(DOMAINS.MIND, player.id, "dust-r1"), rune(DOMAINS.MIND, player.id, "dust-r2")];

  assert.equal(beginPlayCard(game, "turn-dust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId).sort(), [
    "attached-temporary-gear",
    "base-temporary-gear"
  ]);
  assert.equal(chooseEffectOption(game, "attached-temporary-gear").ok, true);
  assert.equal(togglePaymentRune(game, "dust-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "dust-r2", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(attachedGear.temporary, true);
  assert.equal(baseGear.temporary, undefined);
  assert.equal(unit.attachments.some((card) => card.instanceId === "attached-temporary-gear"), true);
});

test("turn to dust does not retarget if the declared gear is gone at resolution", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const declaredGear = instance(cards.guardianAngel, player.id, "declared-dust-gear");
  const otherGear = instance(cards.trinityForce, player.id, "other-dust-gear");
  player.base = [declaredGear, otherGear];
  player.hand = [instance(cards.turnToDust, player.id, "retarget-dust")];
  player.runes = [rune(DOMAINS.MIND, player.id, "retarget-dust-r1"), rune(DOMAINS.MIND, player.id, "retarget-dust-r2")];
  opponent.hand = [instance(cards.flash, opponent.id, "dust-response")];
  opponent.runes = [rune(DOMAINS.CHAOS, opponent.id, "dust-response-r1"), rune(DOMAINS.CHAOS, opponent.id, "dust-response-r2")];

  assert.equal(beginPlayCard(game, "retarget-dust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "declared-dust-gear").ok, true);
  assert.equal(togglePaymentRune(game, "retarget-dust-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "retarget-dust-r2", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.ok(game.actionChain);

  player.base = player.base.filter((card) => card.instanceId !== "declared-dust-gear");
  player.hand.push(declaredGear);

  while (game.actionChain && !game.pendingChoice && !game.pendingPayment) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(declaredGear.temporary, undefined);
  assert.equal(otherGear.temporary, undefined);
  assert.equal(player.hand.some((card) => card.instanceId === "declared-dust-gear"), true);
  assert.equal(player.base.some((card) => card.instanceId === "other-dust-gear"), true);
});

test("temporary gear is killed at the controller's beginning phase", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const gear = instance(cards.guardianAngel, player.id, "temporary-beginning-gear");
  gear.temporary = true;
  player.base = [gear];

  startTurn(game);

  assert.equal(player.base.some((card) => card.instanceId === "temporary-beginning-gear"), false);
  assert.equal(player.trash.some((card) => card.instanceId === "temporary-beginning-gear"), true);
});

test("arena's greatest first beginning point resolves through the trigger queue", () => {
  const game = createGame();
  finishSetup(game);
  const firstPlayer = currentPlayer(game);
  const nextPlayer = game.players.find((player) => player.id !== firstPlayer.id);
  game.battlefields[0] = {
    ...instance(cards.theArenasGreatest, firstPlayer.id, "arena-trigger-field"),
    controlledBy: null,
    units: [],
    hidden: []
  };
  const scoreBefore = nextPlayer.score;

  assert.equal(endTurn(game).ok, true);

  assert.equal(currentPlayer(game).id, nextPlayer.id);
  assert.equal(nextPlayer.score, scoreBefore + 1);
  assert.equal(nextPlayer.firstBeginningPointAwarded, true);
  assert.equal(game.scoreEvents.at(-1)?.kind, "effect");
  assert.equal(game.scoreEvents.at(-1)?.sourceName, cards.theArenasGreatest.name);
  assert.equal(game.scoreEvents.at(-1)?.reason, "firstBeginningEffect");
  assert.equal(game.triggerQueue.length, 0);
});

test("lonely poro deathknell draws a card and does not score points", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const poro = instance(cards.lonelyPoro, player.id, "lonely-deathknell");
  const drawCard = instance(cards.clockworkKeeper, player.id, "drawn-by-poro");
  field.units = [poro];
  field.controlledBy = player.id;
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.uncheckedPower, player.id, "poro-boardwipe")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "wipe-r1"),
    rune(DOMAINS.MIND, player.id, "wipe-r2"),
    rune(DOMAINS.MIND, player.id, "wipe-r3"),
    rune(DOMAINS.MIND, player.id, "wipe-r4"),
    rune(DOMAINS.MIND, player.id, "wipe-r5"),
    rune(DOMAINS.MIND, player.id, "wipe-r6"),
    rune(DOMAINS.MIND, player.id, "wipe-r7"),
    rune(DOMAINS.MIND, player.id, "wipe-r8"),
    rune(DOMAINS.MIND, player.id, "wipe-r9")
  ];
  const scoreBefore = player.score;

  assert.equal(playCard(game, "poro-boardwipe", "base").ok, true);
  assert.equal(player.score, scoreBefore);
  assert.equal(player.hand.some((card) => card.instanceId === "drawn-by-poro"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "lonely-deathknell"), true);
});

test("sabotage reveals non-unit cards from opponent hand and recycles the chosen card", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const spell = instance(cards.stackedDeck, opponent.id, "opponent-spell");
  const unit = instance(cards.ravenbloomStudent, opponent.id, "opponent-unit");
  opponent.hand = [spell, unit];
  player.hand = [instance(cards.sabotage, player.id, "explicit-sabotage")];
  player.runes = [rune(DOMAINS.BODY, player.id, "sabotage-rune")];

  assert.equal(beginPlayCard(game, "explicit-sabotage", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, opponent.id).ok, true);
  assert.equal(togglePaymentRune(game, "sabotage-rune", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "sabotage-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "sabotage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["opponent-spell", "opponent-unit"]);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-spell").disabled, false);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-unit").disabled, true);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-spell").card.image, spell.image);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-unit").card.image, unit.image);
  assert.equal(chooseEffectOption(game, "opponent-unit").ok, false);

  assert.equal(chooseEffectOption(game, "opponent-spell").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "opponent-spell"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "opponent-unit"), true);
  assert.equal(opponent.mainDeck.at(-1).instanceId, "opponent-spell");
});

test("Karma Channeler triggers once when one or more cards are recycled but not when a Rune is recycled", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const karma = instance(cards.karmaChanneler, player.id, "karma-recycle-observer");
  const target = instance(cards.lonelyPoro, player.id, "karma-recycle-target");
  const opponentSpell = instance(cards.stackedDeck, opponent.id, "karma-opponent-spell");
  const paymentRune = rune(DOMAINS.BODY, player.id, "karma-sabotage-rune");
  player.base = [karma, target];
  player.hand = [instance(cards.sabotage, player.id, "karma-sabotage")];
  player.runes = [paymentRune];
  opponent.hand = [opponentSpell];

  assert.equal(beginPlayCard(game, "karma-sabotage", "base").ok, true);
  assert.equal(chooseEffectOption(game, opponent.id).ok, true);
  assert.equal(togglePaymentRune(game, paymentRune.instanceId, "energy").ok, true);
  assert.equal(togglePaymentRune(game, paymentRune.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(target.buffs, 0, "recycling a Rune for Power must not trigger Karma");

  assert.equal(chooseEffectOption(game, opponentSpell.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "buffUnit");
  assert.equal(game.pendingChoice?.data?.declareTrigger, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  for (let guard = 0; game.actionChain && !game.pendingChoice && guard < 8; guard += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(target.buffs, 1);
  assert.equal(opponent.mainDeck.at(-1).instanceId, opponentSpell.instanceId);
});

test("multiplayer snapshots reveal real hand and facedown card art while intel is active", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const viewer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== viewer.id);
  const handCard = instance(cards.stackedDeck, opponent.id, "intel-hand-card");
  const hiddenCard = instance(cards.backOff, opponent.id, "intel-hidden-card");
  opponent.hand = [handCard];
  game.battlefields[0].hidden = [{
    ownerId: opponent.id,
    hiddenByPlayerId: opponent.id,
    playableFromTurnSequence: game.turnSequence,
    card: hiddenCard
  }];
  game.revealedIntel = [{
    viewerId: viewer.id,
    ownerId: opponent.id,
    sourceCardId: "test-source",
    sourceName: "Test reveal",
    expiresAtTurnSequence: game.turnSequence
  }];

  const room = {
    roomId: "TEST",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true, deckRecord: { name: "Viewer" } }, p2: { ready: true, deckRecord: { name: "Opponent" } } },
    game,
    createdAt: 0,
    updatedAt: 0
  };
  const snapshot = snapshotForPlayer(room, viewer.id);
  const snapshotOpponent = snapshot.game.players.find((player) => player.id === opponent.id);
  const snapshotHidden = snapshot.game.battlefields[0].hidden[0].card;

  assert.equal(snapshotOpponent.hand[0].name, handCard.name);
  assert.equal(snapshotOpponent.hand[0].image, handCard.image);
  assert.equal(snapshotOpponent.hand[0].redacted, undefined);
  assert.equal(snapshotHidden.name, hiddenCard.name);
  assert.equal(snapshotHidden.image, hiddenCard.image);
  assert.equal(snapshotHidden.redacted, undefined);
});

test("multiplayer snapshots expose public zones and counts while redacting private and secret cards", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const viewer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== viewer.id);
  const handCard = instance(cards.stackedDeck, opponent.id, "privacy-hand");
  const deckCard = instance(cards.charm, opponent.id, "privacy-main-deck");
  const runeCard = rune(DOMAINS.CALM, opponent.id, "privacy-rune-deck");
  const trashCard = instance(cards.defy, opponent.id, "privacy-trash");
  const banishedCard = instance(cards.discipline, opponent.id, "privacy-banishment");
  const baseCard = instance(cards.lonelyPoro, opponent.id, "privacy-base");
  const battlefieldCard = instance(cards.scuttleCrab, opponent.id, "privacy-battlefield");
  const hiddenCard = instance(cards.backOff, opponent.id, "privacy-facedown");
  opponent.hand = [handCard];
  opponent.mainDeck = [deckCard];
  opponent.runeDeck = [runeCard];
  opponent.trash = [trashCard];
  opponent.banished = [banishedCard];
  opponent.base = [baseCard];
  game.battlefields[0].units = [battlefieldCard];
  game.battlefields[0].hidden = [{ ownerId: opponent.id, hiddenByPlayerId: opponent.id, card: hiddenCard }];
  const room = {
    roomId: "PRIVACY",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true, deckRecord: { name: "Viewer" } }, p2: { ready: true, deckRecord: { name: "Opponent" } } },
    game,
    createdAt: 0,
    updatedAt: 0
  };

  const snapshot = snapshotForPlayer(room, viewer.id).game;
  const redactedOpponent = snapshot.players.find((player) => player.id === opponent.id);
  assert.equal(redactedOpponent.hand.length, 1);
  assert.equal(redactedOpponent.hand[0].redacted, true);
  assert.equal(redactedOpponent.mainDeck[0].redacted, true);
  assert.equal(redactedOpponent.runeDeck[0].redacted, true);
  assert.equal(redactedOpponent.trash[0].instanceId, trashCard.instanceId);
  assert.equal(redactedOpponent.banished[0].instanceId, banishedCard.instanceId);
  assert.equal(redactedOpponent.base[0].instanceId, baseCard.instanceId);
  assert.equal(snapshot.battlefields[0].units[0].instanceId, battlefieldCard.instanceId);
  assert.equal(snapshot.battlefields[0].hidden[0].card.redacted, true);
});

test("facedown privacy follows the card controller rather than its owner", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const owner = currentPlayer(game);
  const controller = game.players.find((candidate) => candidate.id !== owner.id);
  const hiddenCard = instance(cards.backOff, owner.id, "controller-private-facedown");
  hiddenCard.controllerId = controller.id;
  hiddenCard.hidden = true;
  game.battlefields[0].hidden = [{
    ownerId: owner.id,
    hiddenByPlayerId: owner.id,
    playableFromTurnSequence: game.turnSequence,
    card: hiddenCard
  }];
  const room = {
    roomId: "CONTROLLER-PRIVACY",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true, deckRecord: { name: "Owner" } }, p2: { ready: true, deckRecord: { name: "Controller" } } },
    game,
    createdAt: 0,
    updatedAt: 0
  };

  const ownerView = snapshotForPlayer(room, owner.id).game.battlefields[0].hidden[0].card;
  const controllerView = snapshotForPlayer(room, controller.id).game.battlefields[0].hidden[0].card;

  assert.equal(ownerView.redacted, true);
  assert.equal(controllerView.instanceId, hiddenCard.instanceId);
  assert.equal(controllerView.redacted, undefined);
});

test("multiplayer snapshots hide opponent battlefield choices until setup selection finishes", () => {
  const game = createGame({ interactive: true, format: "match" });
  finishChampionSelection(game);
  const viewer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== viewer.id);
  const room = {
    roomId: "TEST",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true, deckRecord: { name: "Viewer" } }, p2: { ready: true, deckRecord: { name: "Opponent" } } },
    game,
    createdAt: 0,
    updatedAt: 0
  };

  const snapshot = snapshotForPlayer(room, viewer.id);
  const snapshotOpponent = snapshot.game.players.find((player) => player.id === opponent.id);

  assert.equal(snapshotOpponent.availableBattlefields[0].name, "Hidden Card");
  assert.equal(snapshotOpponent.availableBattlefields[0].image, "");
  assert.equal(snapshotOpponent.availableBattlefields[0].redacted, true);

  assert.equal(selectBattlefield(game, viewer.id, viewer.availableBattlefields[0].instanceId).ok, true);
  const opponentView = snapshotForPlayer(room, opponent.id).game;
  const hiddenViewer = opponentView.players.find((player) => player.id === viewer.id);
  assert.equal(hiddenViewer.selectedBattlefieldId, "hidden-battlefield-selection");
  assert.equal(opponentView.setupBattlefieldSelections, undefined);
  assert.equal(opponentView.battlefields.length, 0);
});

test("first mate readies another exhausted friendly unit only", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const exhausted = instance(cards.lonelyPoro, player.id, "ready-target");
  exhausted.exhausted = true;
  player.base = [exhausted];
  player.hand = [instance(cards.firstMate, player.id, "explicit-first-mate")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "mate-r1"),
    rune(DOMAINS.BODY, player.id, "mate-r2"),
    rune(DOMAINS.BODY, player.id, "mate-r3")
  ];

  assert.equal(beginPlayCard(game, "explicit-first-mate", "base").ok, true);
  for (const runeCard of player.runes) assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "readyUnit");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["ready-target"]);

  assert.equal(chooseEffectOption(game, "ready-target").ok, true);
  assert.equal(exhausted.exhausted, false);
});

test("scuttle crab draws on play and gains xp on deathknell", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const drawCard = instance(cards.charm, player.id, "scuttle-draw");
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.scuttleCrab, player.id, "explicit-scuttle")];
  opponent.hand = [instance(cards.gust, opponent.id, "scuttle-revealed-hand")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "scuttle-r1"),
    rune(DOMAINS.CALM, player.id, "scuttle-r2")
  ];

  assert.equal(playCard(game, "explicit-scuttle", "base").ok, true);
  const scuttle = player.base.find((card) => card.name === "Scuttle Crab");
  assert.equal(player.hand.some((card) => card.instanceId === "scuttle-draw"), true);
  const xpBefore = player.xp;
  scuttle.damage = 1;
  player.mainDeck = [instance(cards.lonelyPoro, player.id, "scuttle-turn-draw")];

  startTurn(game);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, "scuttle-revealed-hand");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(player.xp, xpBefore + 1);
  assert.equal(player.trash.some((card) => card.name === "Scuttle Crab"), true);
  assert.equal(game.revealedIntel.some((item) =>
    item.viewerId === player.id
    && item.ownerId === opponent.id
    && item.expiresAtTurnSequence === game.turnSequence
  ), true);

  endTurn(game);
  assert.equal(game.revealedIntel.some((item) => item.viewerId === player.id && item.ownerId === opponent.id), false);
});

test("deathknell queue resumes after a draw-triggered choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const fieldA = game.battlefields[0];
  const fieldB = game.battlefields[1];
  for (const field of game.battlefields) field.effects = [];
  const poro = instance(cards.lonelyPoro, player.id, "queued-poro");
  const scuttle = instance(cards.scuttleCrab, player.id, "queued-scuttle");
  const jewel = instance(cards.frigidJewel, player.id, "queued-jewel");
  const target = instance(cards.clockworkKeeper, player.id, "queued-jewel-target");
  fieldA.units = [poro];
  fieldB.units = [scuttle];
  player.base = [jewel, target];
  player.drawCountThisTurn = 1;
  player.mainDeck = [instance(cards.charm, player.id, "queued-death-draw")];
  player.hand = [instance(cards.uncheckedPower, player.id, "queued-boardwipe")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "queued-wipe-r1"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r2"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r3"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r4"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r5"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r6"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r7"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r8"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r9")
  ];
  const xpBefore = player.xp;

  assert.equal(playCard(game, "queued-boardwipe", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "triggerOrder");
  const triggerOptions = game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder);
  const poroLast = triggerOptions.find((option) => option.cardId === poro.instanceId);
  assert.ok(poroLast);
  selectAndConfirmTriggerOrder(game, [
    ...triggerOptions.filter((option) => option.id !== poroLast.id).map((option) => option.id),
    poroLast.id
  ]);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);

  assert.equal(chooseEffectOption(game, "queued-jewel-target").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.triggerQueue.length, 0);
  assert.equal(player.xp, xpBefore + 1);
  assert.equal(target.mightModifier, 2);
  assert.equal(target.temporaryMight, 2);
});

test("pending end turn resumes after lonely poro deathknell draw choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  for (const battlefield of game.battlefields) battlefield.effects = [];
  field.units = [instance(cards.lonelyPoro, player.id, "end-turn-poro")];
  player.base = [
    instance(cards.frigidJewel, player.id, "end-turn-jewel"),
    instance(cards.clockworkKeeper, player.id, "end-turn-target")
  ];
  player.drawCountThisTurn = 1;
  player.mainDeck = [instance(cards.charm, player.id, "end-turn-draw")];
  player.hand = [instance(cards.uncheckedPower, player.id, "end-turn-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `end-turn-rune-${index}`));

  assert.equal(playCard(game, "end-turn-boardwipe", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");

  game.pendingEndTurnPlayerId = player.id;
  game.currentPlayerId = opponent.id;
  assert.equal(chooseEffectOption(game, "end-turn-target").ok, true);

  assert.equal(game.pendingEndTurnPlayerId, undefined);
  assert.equal(game.currentPlayerId, opponent.id);
  assert.equal(game.phase, "action");
});

test("clockwork keeper draws only when its optional calm power is selected and paid", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const drawCard = instance(cards.charm, player.id, "clockwork-draw");
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.clockworkKeeper, player.id, "explicit-clockwork")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "clockwork-energy-one"),
    rune(DOMAINS.CALM, player.id, "clockwork-energy-two"),
    rune(DOMAINS.CALM, player.id, "clockwork-power")
  ];

  assert.equal(beginPlayCard(game, "explicit-clockwork", "base").ok, true);
  assert.equal(game.pendingPayment.optionalPowerEffects.length, 1);
  assert.equal(toggleOptionalPaymentEffect(game, game.pendingPayment.optionalPowerEffects[0].id).ok, true);
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.CALM, amount: 1 }]);
  assert.equal(togglePaymentRune(game, "clockwork-energy-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "clockwork-energy-two", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "clockwork-power", "power").ok, true);

  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "clockwork-draw"), true);
  assert.equal(player.runeDeck.at(-1).instanceId, "clockwork-power");
  assert.equal(player.runes.some((card) => card.instanceId === "clockwork-power"), false);
});

test("stalwart poro shield applies only while defending", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.ravenbloomStudent, opponent.id, "shield-attacker");
  const defender = instance(cards.stalwartPoro, player.id, "shield-defender");
  field.units = [attacker, defender];
  field.controlledBy = player.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, false);
  field.units = [attacker, defender];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: opponent.id,
    consecutivePasses: 0,
    chain: []
  };
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "shield-defender"), false);
});

test("ravenbloom student gets might when its controller plays a spell", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const student = instance(cards.ravenbloomStudent, player.id, "explicit-student");
  player.base = [student];
  player.hand = [instance(cards.stackedDeck, player.id, "student-spell")];
  player.mainDeck = [
    instance(cards.charm, player.id, "top-1"),
    instance(cards.gust, player.id, "top-2"),
    instance(cards.flash, player.id, "top-3")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "student-rune")];

  assert.equal(playCard(game, "student-spell", "base").ok, true);
  assert.equal(student.mightModifier, 1);
});

test("one player explicitly orders all abilities triggered by the same spell-play event", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const lux = instance(cards.luxIlluminated, player.id, "ordered-lux");
  const student = instance(cards.ravenbloomStudent, player.id, "ordered-student");
  const legend = instance(cards.luxLadyOfLuminosity, player.id, "ordered-lux-legend");
  const spell = instance({
    ...cards.stackedDeck,
    name: "Ordered Trigger Spell",
    energy: 5,
    power: [],
    effects: []
  }, player.id, "ordered-trigger-spell");
  const drawn = instance(cards.lonelyPoro, player.id, "ordered-trigger-draw");
  player.legend = legend;
  player.base = [lux, student];
  player.hand = [spell];
  player.mainDeck = [drawn];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.MIND, player.id, `ordered-trigger-rune-${index}`));
  game.players.find((candidate) => candidate.id !== player.id).hand = [];

  assert.equal(playCard(game, spell.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.deepEqual(
    new Set(game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder).map((option) => option.cardId)),
    new Set([lux.instanceId, student.instanceId, legend.instanceId])
  );

  const first = game.pendingChoice.options.find((option) => option.cardId === legend.instanceId);
  assert.equal(chooseEffectOption(game, first.id).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.equal(game.pendingChoice.options.find((option) => option.id === first.id).selectionOrder, 1);
  const blockedConfirm = game.pendingChoice.options.find((option) => option.confirmTriggerOrder);
  assert.equal(blockedConfirm.disabled, true);
  assert.equal(chooseEffectOption(game, blockedConfirm.id).ok, false);
  assert.equal(chooseEffectOption(game, first.id).ok, true, "selecting the same trigger again cancels it");
  assert.equal(game.pendingChoice.options.find((option) => option.id === first.id).selected, false);
  assert.equal(chooseEffectOption(game, first.id).ok, true);
  const second = game.pendingChoice.options.find((option) => option.cardId === lux.instanceId);
  assert.equal(chooseEffectOption(game, second.id).ok, true);
  assert.equal(game.pendingChoice.options.find((option) => option.confirmTriggerOrder).disabled, true,
    "confirmation stays disabled while a mandatory trigger is missing");
  const third = game.pendingChoice.options.find((option) => option.cardId === student.instanceId);
  assert.equal(chooseEffectOption(game, third.id).ok, true);
  const confirm = game.pendingChoice.options.find((option) => option.confirmTriggerOrder);
  assert.ok(confirm);
  assert.equal(chooseEffectOption(game, confirm.id).ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
  assert.equal(lux.temporaryMight, 3);
  assert.equal(student.temporaryMight, 1);
});

test("the turn player orders their simultaneous triggers before the next player", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const attackers = [0, 1].map((index) => instance(cards.ahriInquisitive, player.id, `turn-order-attacker-${index}`));
  const attackerIds = attackers.map((unit) => unit.instanceId);
  const defenders = [0, 1].map((index) => instance(cards.ahriInquisitive, opponent.id, `turn-order-defender-${index}`));
  const field = game.battlefields[0];
  player.base = attackers;
  field.controlledBy = opponent.id;
  field.units = defenders;

  assert.equal(moveUnits(game, attackerIds, field.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.equal(game.pendingChoice.playerId, player.id);
  assert.deepEqual(
    new Set(game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder).map((option) => option.cardId)),
    new Set(attackerIds)
  );
});

test("master yi tempered gains ganking only at level 6 xp", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = game.battlefields[0];
  const second = game.battlefields[1];
  const yi = instance(cards.masterYiTempered, player.id, "tempered-level");
  yi.exhausted = false;
  first.units = [yi];
  first.controlledBy = player.id;
  second.controlledBy = player.id;

  assert.equal(moveUnit(game, "tempered-level", second.instanceId).ok, false);
  yi.exhausted = false;
  player.xp = 6;
  assert.equal(moveUnit(game, "tempered-level", second.instanceId).ok, true);
  assert.equal(second.units.some((unit) => unit.instanceId === "tempered-level"), true);

  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  yi.controllerId = opponent.id;
  yi.exhausted = false;
  first.controlledBy = opponent.id;
  game.turnPlayerId = opponent.id;
  game.currentPlayerId = opponent.id;
  opponent.xp = 0;
  assert.equal(moveUnit(game, yi.instanceId, first.instanceId).ok, false,
    "Level must immediately use the new controller's XP, not the owner's XP");
  opponent.xp = 6;
  assert.equal(moveUnit(game, yi.instanceId, first.instanceId).ok, true);
});

test("Hunt grants its summed value on both conquer and hold", () => {
  const makeHunter = (ownerId, id) => {
    const hunter = instance(cards.masterYiTempered, ownerId, id);
    hunter.keywords = ["Hunt", "Hunt"];
    hunter.text = "[Hunt 2]\n[Hunt 3]";
    return hunter;
  };

  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const hunter = makeHunter(player.id, "hunt-conquer-unit");
    const field = game.battlefields[0];
    player.xp = 0;
    player.base = [hunter];
    field.units = [];
    field.controlledBy = null;

    assert.equal(moveUnit(game, hunter.instanceId, field.instanceId).ok, true);
    assert.equal(passShowdown(game, player.id).ok, true);
    assert.equal(passShowdown(game, opponent.id).ok, true);
    assert.equal(player.xp, 5);
  }

  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const hunter = makeHunter(player.id, "hunt-hold-unit");
    const field = game.battlefields[0];
    player.xp = 0;
    field.units = [hunter];
    field.controlledBy = player.id;

    startTurn(game);
    assert.equal(player.xp, 5);
  }
});

test("Ambush grants Reaction only while playing to a battlefield with a friendly unit", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  field.units = [instance(cards.ravenbloomStudent, opponent.id, "ambush-enemy")];
  field.controlledBy = opponent.id;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.vilemaw, player.id, "ambush-vilemaw")];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.CALM, player.id, `vile-r${index}`));

  assert.equal(playCard(game, "ambush-vilemaw", field.instanceId).ok, false);

  player.hand = [instance(cards.rengarTrophyHunter, player.id, "ambush-rengar")];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.BODY, player.id, `rengar-r${index}`));
  assert.equal(playCard(game, "ambush-rengar", field.instanceId).ok, false,
    "Rengar's separate destination permission does not broaden Ambush's conditional Reaction timing");
  assert.equal(field.units.some((unit) => unit.instanceId === "ambush-rengar"), false);
  assert.equal(game.showdown.chain.length, 0);
});

test("Rengar can be played normally to a battlefield containing only enemy units", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "rengar-enemy-only-unit")];
  field.controlledBy = opponent.id;
  player.hand = [
    instance(cards.vilemaw, player.id, "normal-vilemaw"),
    instance(cards.rengarTrophyHunter, player.id, "normal-rengar")
  ];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `normal-rengar-r${index}`));

  assert.equal(beginPlayCard(game, "normal-vilemaw", field.instanceId).ok, false,
    "Ambush alone does not permit entry where its controller has no unit");
  assert.equal(beginPlayCard(game, "normal-rengar", field.instanceId).ok, true);
  assert.equal(game.pendingPayment?.cardId, "normal-rengar");
  assert.equal(game.pendingPayment?.destination, field.instanceId);
});

test("explicit Might bonuses stack according to their card text", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "buff-cap-target");
  player.base = [unit];
  player.hand = [
    instance(cards.punchFirst, player.id, "buff-cap-one"),
    instance(cards.punchFirst, player.id, "buff-cap-two")
  ];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "buff-r1"),
    rune(DOMAINS.BODY, player.id, "buff-r2"),
    rune(DOMAINS.BODY, player.id, "buff-r3"),
    rune(DOMAINS.BODY, player.id, "buff-r4"),
    rune(DOMAINS.BODY, player.id, "buff-r5"),
    rune(DOMAINS.BODY, player.id, "buff-r6")
  ];

  assert.equal(playCard(game, "buff-cap-one", "base").ok, true);
  assert.equal(unit.mightModifier, 5);
  assert.equal(playCard(game, "buff-cap-two", "base").ok, true);
  assert.equal(unit.mightModifier, 10);
});

test("deflect can be paid with the rune already spent for energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const deflectUnit = instance(cards.vexApathetic, opponent.id, "deflect-target");
  const plainUnit = instance(cards.ravenbloomStudent, opponent.id, "plain-target");
  opponent.base = [deflectUnit, plainUnit];
  player.hand = [instance(cards.stupefy, player.id, "deflect-stupefy")];
  player.runes = [rune(DOMAINS.MIND, player.id, "only-energy")];

  assert.equal(beginPlayCard(game, "deflect-stupefy", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["deflect-target", "plain-target"]);
  assert.equal(chooseEffectOption(game, "deflect-target").ok, true);
  assert.equal(togglePaymentRune(game, "only-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "only-energy", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(deflectUnit.mightModifier, -1);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "only-energy"), true);
});

test("choosing a deflect target pays additional power when the effect resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const deflectUnit = instance(cards.vexApathetic, opponent.id, "paid-deflect-target");
  opponent.base = [deflectUnit];
  player.hand = [instance(cards.stupefy, player.id, "paid-deflect-stupefy")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "spell-energy"),
    rune(DOMAINS.MIND, player.id, "deflect-power")
  ];

  assert.equal(beginPlayCard(game, "paid-deflect-stupefy", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["paid-deflect-target"]);
  assert.equal(chooseEffectOption(game, "paid-deflect-target").ok, true);
  assert.equal(togglePaymentRune(game, "spell-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "deflect-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(deflectUnit.mightModifier, -1);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "deflect-power"), true);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "spell-energy"), false);
});

test("existential dread can repeat its stun effect and return an already stunned attacker", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.ravenbloomStudent, opponent.id, "repeat-attacker");
  field.units = [attacker, instance(cards.lonelyPoro, player.id, "repeat-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.existentialDread, player.id, "repeat-dread")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "dread-power"),
    rune(DOMAINS.CHAOS, player.id, "dread-repeat-1"),
    rune(DOMAINS.CHAOS, player.id, "dread-repeat-2")
  ];

  assert.equal(beginPlayCard(game, "repeat-dread", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "repeat-attacker").ok, true);
  assert.equal(chooseEffectOption(game, "repeat-count-1").ok, true);
  assert.equal(chooseEffectOption(game, "repeat-attacker").ok, true);
  for (const runeId of ["dread-power", "dread-repeat-1", "dread-repeat-2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "dread-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.some((unit) => unit.instanceId === "repeat-attacker"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "repeat-attacker"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "repeat-dread"), true);
});

test("hard bargain can repeat to counter multiple spells on the showdown chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const firstSpell = instance(cards.stackedDeck, opponent.id, "repeat-chain-one");
  const secondSpell = instance(cards.gust, opponent.id, "repeat-chain-two");
  field.units = [
    instance(cards.lonelyPoro, opponent.id, "bargain-attacker"),
    instance(cards.ravenbloomStudent, player.id, "bargain-defender")
  ];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [
      { card: firstSpell, playerId: opponent.id, destination: "base" },
      { card: secondSpell, playerId: opponent.id, destination: "base" }
    ]
  };
  game.currentPlayerId = player.id;
  opponent.runes = [];
  player.hand = [instance(cards.hardBargain, player.id, "repeat-bargain")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "bargain-energy-1"),
    rune(DOMAINS.CHAOS, player.id, "bargain-energy-2"),
    rune(DOMAINS.CHAOS, player.id, "bargain-repeat-1"),
    rune(DOMAINS.CHAOS, player.id, "bargain-repeat-2")
  ];

  assert.equal(beginPlayCard(game, "repeat-bargain", field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "repeat-chain-one").ok, true);
  assert.equal(chooseEffectOption(game, "repeat-count-1").ok, true);
  assert.equal(chooseEffectOption(game, "repeat-chain-two").ok, true);
  for (const runeId of ["bargain-energy-1", "bargain-energy-2", "bargain-repeat-1", "bargain-repeat-2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "repeat-chain-one"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "repeat-chain-two"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "repeat-bargain"), true);
});

test("counter spells declare their chain target before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const chainSpell = instance(cards.gust, opponent.id, "declared-chain-gust");
  field.units = [
    instance(cards.lonelyPoro, opponent.id, "declared-chain-attacker"),
    instance(cards.ravenbloomStudent, player.id, "declared-chain-defender")
  ];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{ card: chainSpell, playerId: opponent.id, destination: "base", state: "finalized" }]
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.hardBargain, player.id, "declared-bargain")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "declared-bargain-one"),
    rune(DOMAINS.CHAOS, player.id, "declared-bargain-two")
  ];

  assert.equal(beginPlayCard(game, "declared-bargain", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["declared-chain-gust"]);
  assert.equal(chooseEffectOption(game, "declared-chain-gust").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "repeat-count-0").ok, true);
  assert.equal(game.pendingPayment.cardId, "declared-bargain");
  assert.equal(togglePaymentRune(game, "declared-bargain-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "declared-bargain-two", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.showdown.chain.at(-1).card.instanceId, "declared-bargain");
  assert.deepEqual(game.showdown.chain.at(-1).card.declaredPlayTargets, [
    { effect: "counterUnlessPay", targetId: "declared-chain-gust" }
  ]);
});

test("Defy counters a spell that entered the Chain with a new zone identity", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const targetSpell = instance(cards.gust, opponent.id, "defy-real-chain-target");
  targetSpell.zoneChangeCounter = 1;
  const defy = instance(cards.defy, player.id, "defy-real-chain-source");
  player.hand = [defy];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "defy-energy-rune"),
    rune(DOMAINS.CALM, player.id, "defy-power-rune")
  ];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{
      id: "defy-target-chain-item",
      itemType: "card",
      card: targetSpell,
      playerId: opponent.id,
      destination: field.instanceId,
      status: "finalized"
    }]
  };

  assert.equal(beginPlayCard(game, defy.instanceId, field.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, targetSpell.instanceId).ok, true);
  assert.equal(game.pendingPayment?.cardId, defy.instanceId);
  assert.equal(togglePaymentRune(game, "defy-energy-rune", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "defy-power-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.deepEqual(defy.declaredTargetIdentities, [{
    effect: "counterChainCard",
    targetId: targetSpell.instanceId,
    zoneChangeCounter: 1
  }]);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);

  assert.equal(opponent.trash.some((card) => card.instanceId === targetSpell.instanceId), true,
    "Defy must counter the same spell object after it moved from hand to the Chain");
  assert.equal(game.showdown.chain.some((item) => item.card?.instanceId === targetSpell.instanceId), false);
  assert.equal(game.log.some((entry) => entry.includes("declared target is no longer legal")), false);
});

test("hard bargain declares its initial and Repeat targets before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const first = instance(cards.gust, opponent.id, "repeat-declaration-first");
  const second = instance(cards.stackedDeck, opponent.id, "repeat-declaration-second");
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 2,
    chain: [
      { id: "repeat-chain-first", itemType: "card", card: first, playerId: opponent.id, destination: "base", status: "finalized" },
      { id: "repeat-chain-second", itemType: "card", card: second, playerId: opponent.id, destination: "base", status: "finalized" }
    ]
  };
  game.currentPlayerId = player.id;
  const bargain = instance(cards.hardBargain, player.id, "repeat-declaration-bargain");
  player.hand = [bargain];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `repeat-declaration-rune-${index}`));

  assert.equal(beginPlayCard(game, bargain.instanceId, field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["repeat-count-0", "repeat-count-1"]);
  assert.equal(chooseEffectOption(game, "repeat-count-1").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);

  assert.equal(game.pendingPayment.energyCost, 4);
  assert.deepEqual(game.pendingPayment.declaredTargets, [
    { effect: "counterUnlessPay", targetId: first.instanceId },
    { effect: "counterUnlessPay", targetId: second.instanceId }
  ]);
});

test("star-crossed requires explicit friendly and enemy unit choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const friendly = instance(cards.lonelyPoro, player.id, "star-friendly");
  const firstEnemy = instance(cards.ravenbloomStudent, opponent.id, "star-enemy-one");
  const secondEnemy = instance(cards.vexCheerless, opponent.id, "star-enemy-two");
  friendly.damage = 1;
  friendly.buffs = 1;
  friendly.mightModifier = 1;
  friendly.stunned = true;
  friendly.exhausted = true;
  friendly.attachments = [instance(cards.trinityForce, player.id, "star-trinity")];
  secondEnemy.damage = 1;
  secondEnemy.buffs = 1;
  player.base = [friendly];
  opponent.base = [firstEnemy, secondEnemy];
  player.hand = [instance(cards.starCrossed, player.id, "explicit-star")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `star-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-star", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["star-friendly"]);

  assert.equal(chooseEffectOption(game, "star-friendly").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["star-enemy-one", "star-enemy-two"]);

  assert.equal(chooseEffectOption(game, "star-enemy-two").ok, true);
  for (const runeId of ["star-r0", "star-r1", "star-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "star-r3", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "star-friendly"), false);
  assert.equal(player.hand.some((card) => card.instanceId === "star-friendly"), true);
  const returnedFriendly = player.hand.find((card) => card.instanceId === "star-friendly");
  assert.equal(returnedFriendly.damage, 0);
  assert.equal(returnedFriendly.buffs, 0);
  assert.equal(returnedFriendly.mightModifier, 0);
  assert.equal(returnedFriendly.stunned, false);
  assert.equal(returnedFriendly.exhausted, false);
  assert.deepEqual(returnedFriendly.attachments, []);
  assert.equal(player.base.some((card) => card.instanceId === "star-trinity"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "star-trinity"), false);
  assert.equal(opponent.base.some((card) => card.instanceId === "star-enemy-one"), true);
  assert.equal(opponent.base.some((card) => card.instanceId === "star-enemy-two"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "star-enemy-two"), true);
  const returnedEnemy = opponent.hand.find((card) => card.instanceId === "star-enemy-two");
  assert.equal(returnedEnemy.damage, 0);
  assert.equal(returnedEnemy.buffs, 0);
});

test("moonfall explicitly chooses the battlefield and optional enemy move", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const destination = game.battlefields[0];
  const friendly = instance(cards.lonelyPoro, player.id, "moon-friendly");
  const enemyAlreadyThere = instance(cards.ravenbloomStudent, opponent.id, "moon-local-enemy");
  const movedEnemy = instance(cards.vexCheerless, opponent.id, "moon-moved-enemy");
  destination.units = [friendly, enemyAlreadyThere];
  destination.controlledBy = null;
  opponent.base = [movedEnemy];
  player.hand = [instance(cards.moonfall, player.id, "explicit-moonfall")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `moon-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-moonfall", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [destination.instanceId]);

  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.ok(game.pendingChoice.options.some((option) => option.cardId === "moon-moved-enemy"));

  assert.equal(chooseEffectOption(game, "moon-moved-enemy").ok, true);
  for (const runeId of ["moon-r0", "moon-r1", "moon-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "moon-r3", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(opponent.base.some((unit) => unit.instanceId === "moon-moved-enemy"), false);
  assert.equal(destination.units.some((unit) => unit.instanceId === "moon-moved-enemy"), true);
  assert.equal(movedEnemy.movesThisTurn, 1);
  assert.deepEqual(game.moveEvents.at(-1), {
    ...game.moveEvents.at(-1),
    cardId: movedEnemy.instanceId,
    responsiblePlayerId: player.id,
    destinationType: "battlefield",
    destinationId: destination.instanceId
  });
  assert.equal(enemyAlreadyThere.mightModifier, -2);
  assert.equal(movedEnemy.mightModifier, -2);
  assert.equal(enemyAlreadyThere.temporaryMight, -2);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, destination.instanceId);
  assert.equal(game.showdown.attackerId, player.id);
  assert.equal(game.showdown.combat, true);

  startTurn(game);
  assert.equal(enemyAlreadyThere.mightModifier, 0);
  assert.equal(movedEnemy.mightModifier, 0);
  assert.equal(enemyAlreadyThere.temporaryMight, undefined);
});

test("non-combat showdown becomes combat when an opposing Action unit enters during it", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const friendly = instance(cards.lonelyPoro, player.id, "noncombat-friendly");
  field.units = [friendly];
  field.controlledBy = null;
  player.base = [friendly];
  const actionInvader = instance({
    ...cards.rengarTrophyHunter,
    tags: ["Action"],
    keywords: ["Action"],
    effects: cards.rengarTrophyHunter.effects
  }, opponent.id, "noncombat-action-invader");
  opponent.hand = [actionInvader];
  opponent.runes = [
    rune(DOMAINS.BODY, opponent.id, "rengar-r1"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r2"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r3"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r4"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r5"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r6")
  ];
  field.units = [];
  friendly.exhausted = false;

  assert.equal(moveUnit(game, friendly.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, false);
  assert.equal(friendly.damage, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(playCard(game, actionInvader.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(field.units.some((unit) => unit.instanceId === actionInvader.instanceId), false);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.showdown.combat, true);
  assert.equal(game.showdown.defenderId, opponent.id);
  assert.equal(field.units.some((unit) => unit.instanceId === actionInvader.instanceId), true);

  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
});

test("a non-combat showdown upgrade checks attack triggers exactly at the new designation", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((player) => player.id !== attacker.id);
  const field = game.battlefields[0];
  const crackshot = instance(cards.crackshotCorsair, attacker.id, "upgrade-attack-crackshot");
  const invader = instance({
    ...cards.rengarTrophyHunter,
    id: "TEST-UPGRADE-ACTION-UNIT",
    name: "Rules Test Upgrade Action Unit",
    tags: ["Action"],
    keywords: ["Action"],
    energy: 0,
    power: [],
    effects: cards.rengarTrophyHunter.effects
  }, defender.id, "upgrade-attack-invader");
  attacker.base = [crackshot];
  defender.hand = [invader];
  field.units = [];
  field.controlledBy = null;

  assert.equal(moveUnit(game, crackshot.instanceId, field.instanceId).ok, true);
  assert.equal(game.showdown.combat, false);
  assert.equal(passShowdown(game, attacker.id).ok, true);
  assert.equal(playCard(game, invader.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);

  assert.equal(game.showdown.combat, true);
  assert.equal(game.pendingChoice?.card?.instanceId, crackshot.instanceId,
    "gaining Attacker during the upgrade evaluates the attack trigger");
  assert.equal(game.pendingChoice?.data?.targetEffect, "damageUnit");
  assert.equal(game.showdown.chain.filter((item) => item.trigger?.sourceCardId === crackshot.instanceId).length, 1);
  assert.equal(crackshot.combatTriggerChecks?.[game.showdown.combatId]?.attacker, true,
    "the combat remembers that this role's condition was already checked");
});

test("losing and regaining a combat role does not check that role twice in one combat", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((player) => player.id !== attacker.id);
  const field = game.battlefields[0];
  const duneDrake = instance(cards.duneDrake, attacker.id, "role-regain-dune-drake");
  const enemy = instance(cards.lonelyPoro, defender.id, "role-regain-enemy");
  const makeAction = (owner, id) => instance({
    ...cards.flash,
    id: `TEST-${id}`,
    name: `Rules Test ${id}`,
    tags: ["Action"],
    keywords: [],
    energy: 0,
    power: [],
    effects: []
  }, owner.id, id);
  attacker.base = [duneDrake];
  defender.base = [];
  attacker.hand = [makeAction(attacker, "role-regain-action-a")];
  defender.hand = [makeAction(defender, "role-regain-action-b")];
  field.units = [enemy];
  field.controlledBy = defender.id;

  assert.equal(moveUnit(game, duneDrake.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(duneDrake.temporaryMight, 2);

  const resolveEmptyAction = () => {
    const priority = game.players.find((player) => player.id === game.showdown.priorityPlayerId);
    const action = priority.hand[0];
    assert.ok(action);
    assert.equal(playCard(game, action.instanceId, "base").ok, true);
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  };

  duneDrake.controllerId = defender.id;
  resolveEmptyAction();
  assert.equal(duneDrake.combatRole, "defender");

  duneDrake.controllerId = attacker.id;
  resolveEmptyAction();
  assert.equal(duneDrake.combatRole, "attacker");
  assert.equal(duneDrake.temporaryMight, 2,
    "the attacker trigger is not checked again after the same role is regained in this combat");
});

test("showdown movement still checks conquest after units leave the battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.legend.effects = [];
  opponent.legend.effects = [];
  const moonfallField = game.battlefields[0];
  const escapeField = game.battlefields[1];
  moonfallField.effects = [];
  escapeField.effects = [];
  const playerUnit = instance(cards.lonelyPoro, player.id, "moonfall-friendly");
  const enemyUnit = instance(cards.ravenbloomStudent, opponent.id, "moonfall-enemy");

  moonfallField.units = [playerUnit];
  moonfallField.controlledBy = player.id;
  escapeField.units = [];
  escapeField.controlledBy = null;
  opponent.base = [enemyUnit];
  player.hand = [instance(cards.moonfall, player.id, "conquest-moonfall")];
  opponent.hand = [instance(cards.rideTheWind, opponent.id, "conquest-ride")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "moonfall-energy-1"),
    rune(DOMAINS.MIND, player.id, "moonfall-energy-2"),
    rune(DOMAINS.CHAOS, player.id, "moonfall-energy-3"),
    rune(DOMAINS.CHAOS, player.id, "moonfall-power")
  ];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "ride-energy-1"),
    rune(DOMAINS.CHAOS, opponent.id, "ride-energy-2"),
    rune(DOMAINS.CHAOS, opponent.id, "ride-power")
  ];

  assert.equal(beginPlayCard(game, "conquest-moonfall", "base").ok, true);
  assert.equal(chooseEffectOption(game, moonfallField.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, enemyUnit.instanceId).ok, true);
  for (const id of ["moonfall-energy-1", "moonfall-energy-2", "moonfall-energy-3"]) {
    assert.equal(togglePaymentRune(game, id, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "moonfall-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.phase, "showdown");

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(beginPlayCard(game, "conquest-ride", escapeField.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, enemyUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, escapeField.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-2", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);

  assert.equal(escapeField.controlledBy, null,
    "an effect move to an empty battlefield waits for its staged showdown");
  assert.equal(opponent.score, 0);
  assert.equal(moonfallField.controlledBy, player.id);

  while (game.showdown?.battlefieldId === moonfallField.instanceId) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }
  assert.equal(game.showdown?.battlefieldId, escapeField.instanceId);
  assert.equal(game.showdown?.focusPlayerId, opponent.id);
  assert.equal(moonfallField.controlledBy, player.id);

  while (game.showdown?.battlefieldId === escapeField.instanceId) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }
  assert.equal(game.phase, "action");
  assert.equal(moonfallField.controlledBy, player.id);
  assert.equal(escapeField.controlledBy, opponent.id);
  assert.equal(opponent.score, 1);
});

test("combat showdown skips combat damage if the attacking side leaves after reactions", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.legend.effects = [];
  opponent.legend.effects = [];
  const field = game.battlefields[0];
  field.effects = [];
  const attacker = instance(cards.lonelyPoro, player.id, "escape-combat-attacker");
  const defender = instance(cards.ravenbloomStudent, opponent.id, "escape-combat-defender");
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;
  opponent.hand = [instance(cards.gust, opponent.id, "escape-combat-gust")];
  opponent.runes = [rune(DOMAINS.CHAOS, opponent.id, "escape-combat-rune")];

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, true);
  assert.equal(passShowdown(game, player.id).ok, true);

  assert.equal(beginPlayCard(game, "escape-combat-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, attacker.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "escape-combat-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === attacker.instanceId), true);
  assert.equal(field.units.some((unit) => unit.instanceId === defender.instanceId), true);

  let settlePasses = 0;
  while (game.showdown && !game.pendingChoice && !game.pendingPayment && settlePasses < 8) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    settlePasses += 1;
  }
  assert.equal(game.showdown, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.phase, "action");
  assert.equal(field.controlledBy, opponent.id);
  assert.equal(player.trash.some((card) => card.instanceId === attacker.instanceId), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === defender.instanceId), false);
});

test("a battlefield can only score once for the same player each turn", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const holder = instance(cards.lonelyPoro, player.id, "single-score-holder");
  const second = instance(cards.ravenbloomStudent, player.id, "single-score-second");
  field.units = [holder];
  field.controlledBy = player.id;
  player.base = [second];

  startTurn(game);
  assert.equal(player.score, 1);

  assert.equal(moveUnit(game, holder.instanceId, "base").ok, true);
  assert.equal(field.controlledBy, null);
  assert.equal(moveUnit(game, second.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);

  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("the same unit can leave and reconquer a battlefield without scoring or triggering conquer twice", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const sett = instance(cards.settBrawler, player.id, "same-field-reconquer-sett");
  player.base = [sett];
  field.units = [];
  field.controlledBy = null;

  assert.equal(moveUnit(game, sett.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(player.score, 1);
  assert.equal(sett.buffs, 1, "the first conquest triggers Sett once");

  sett.exhausted = false;
  assert.equal(moveUnit(game, sett.instanceId, "base").ok, true);
  assert.equal(field.controlledBy, null);
  sett.exhausted = false;
  assert.equal(moveUnit(game, sett.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);

  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1, "the same battlefield cannot score twice for one player in one turn");
  assert.equal(sett.buffs, 1, "a non-scoring reconquest does not trigger Conquer abilities again");
  assert.deepEqual(player.turnScoredBattlefields, [field.instanceId]);
  assert.equal(game.scoreEvents.filter((event) => event.battlefieldId === field.instanceId).length, 1);
});

test("combat awards conquest when defenders take an uncontrolled battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const attackerPlayer = currentPlayer(game);
  const defenderPlayer = game.players[1];
  const attacker = instance(cards.lonelyPoro, attackerPlayer.id, "defender-score-attacker");
  const defender = instance(cards.ravenbloomStudent, defenderPlayer.id, "defender-score-defender");
  const field = game.battlefields[0];
  attacker.might = 1;
  defender.might = 3;
  field.units = [attacker, defender];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: attackerPlayer.id,
    attackerId: attackerPlayer.id,
    defenderId: defenderPlayer.id,
    priorityPlayerId: attackerPlayer.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(passShowdown(game, attackerPlayer.id).ok, true);
  assert.equal(passShowdown(game, defenderPlayer.id).ok, true);

  assert.equal(field.controlledBy, defenderPlayer.id);
  assert.equal(defenderPlayer.score, 1);
  assert.equal(attackerPlayer.base.some((unit) => unit.instanceId === attacker.instanceId), false);
});

test("alpha strike explicitly allocates damage among battlefield enemies", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const striker = instance(cards.masterYiTempered, player.id, "alpha-striker");
  const firstEnemy = instance(cards.ravenbloomStudent, opponent.id, "alpha-enemy-one");
  const secondEnemy = instance(cards.lonelyPoro, opponent.id, "alpha-enemy-two");
  field.units = [striker, firstEnemy, secondEnemy];
  field.controlledBy = null;
  player.hand = [instance(cards.alphaStrike, player.id, "explicit-alpha")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `alpha-r${index}`));
  const xpBefore = player.xp;

  assert.equal(playCard(game, "explicit-alpha", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "splitDamageAllocation");
  assert.ok(game.pendingChoice.options.some((option) => option.id === "alpha-enemy-one:2"));

  assert.equal(chooseEffectOption(game, "alpha-enemy-one:2").ok, true);
  assert.equal(firstEnemy.damage, 0, "damage division is committed only after every amount is chosen");
  assert.equal(opponent.trash.some((card) => card.instanceId === firstEnemy.instanceId), false);
  assert.equal(game.pendingChoice.effect, "splitDamageAllocation");
  assert.equal(chooseEffectOption(game, "alpha-enemy-two:2").ok, true);
  assert.equal(firstEnemy.damage, 0);
  assert.equal(secondEnemy.damage, 0);
  assert.equal(opponent.trash.some((card) => card.instanceId === firstEnemy.instanceId), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === secondEnemy.instanceId), true);
  assert.equal(player.xp, xpBefore + 2);
});

test("Bonus Damage increases one split total and its target limit without being added per allocation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const volibear = instance(cards.volibearFurious, player.id, "bonus-split-volibear");
  const annie = instance(cards.annieFiery, player.id, "bonus-split-annie");
  const enemies = Array.from({ length: 6 }, (_, index) => instance({
    ...cards.lonelyPoro,
    might: 10,
    effects: []
  }, opponent.id, `bonus-split-enemy-${index + 1}`));
  player.base = [volibear, annie];
  field.units = [...enemies];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, volibear.instanceId, field.instanceId).ok, true);
  for (const enemy of enemies) {
    assert.equal(game.pendingChoice?.data?.targetEffect, "splitDamageEnemyHere");
    const targetOption = game.pendingChoice.options.find((option) => option.cardId === enemy.instanceId);
    assert.ok(targetOption);
    assert.equal(chooseEffectOption(game, targetOption.id).ok, true);
  }
  assert.equal(game.pendingChoice, null);
  assert.deepEqual(game.showdown.chain[0].trigger.data.declaredTargets.map((target) => target.targetId),
    enemies.map((enemy) => enemy.instanceId));

  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  for (const enemy of enemies) {
    assert.equal(game.pendingChoice?.effect, "splitDamageAllocation");
    const oneDamage = game.pendingChoice.options.find((option) => option.cardId === enemy.instanceId && option.amount === 1);
    assert.ok(oneDamage);
    assert.equal(chooseEffectOption(game, oneDamage.id).ok, true);
  }

  assert.deepEqual(enemies.map((enemy) => enemy.damage), [1, 1, 1, 1, 1, 1]);
});

test("hard bargain lets the targeted spell controller decide whether to pay energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const chainSpell = instance(cards.gust, opponent.id, "bargain-pay-target");
  field.units = [
    instance(cards.lonelyPoro, opponent.id, "pay-attacker"),
    instance(cards.ravenbloomStudent, player.id, "pay-defender")
  ];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{ card: chainSpell, playerId: opponent.id, destination: "base" }]
  };
  game.currentPlayerId = player.id;
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "pay-energy-one"),
    rune(DOMAINS.CHAOS, opponent.id, "pay-energy-two")
  ];
  player.hand = [instance(cards.hardBargain, player.id, "pay-bargain")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "pay-bargain-one"),
    rune(DOMAINS.CHAOS, player.id, "pay-bargain-two")
  ];

  assert.equal(playCard(game, "pay-bargain", field.instanceId).ok, true);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "counterUnlessPayDecision");

  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  payPendingEnergy(game, ["pay-energy-one", "pay-energy-two"]);
  assert.equal(game.showdown.chain.some((item) => item.card.instanceId === "bargain-pay-target"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "bargain-pay-target"), false);
  assert.equal(opponent.runes.every((runeCard) => runeCard.exhausted), true);
});

test("targeted spell does not retarget if declared unit leaves before resolution", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const declared = instance(cards.lonelyPoro, opponent.id, "stale-gust-target");
  const other = instance(cards.ravenbloomStudent, opponent.id, "stale-gust-other");
  const gust = instance(cards.gust, player.id, "stale-gust");
  gust.declaredPlayTargets = [{ effect: "returnUnitToHand", targetId: declared.instanceId }];
  field.units = [declared, other];
  field.controlledBy = opponent.id;
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [{ id: "stale-gust-chain", itemType: "card", card: gust, playerId: player.id, destination: "base", status: "finalized" }]
  };
  field.units = field.units.filter((unit) => unit.instanceId !== declared.instanceId);
  opponent.base.push(declared);

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.base.some((unit) => unit.instanceId === declared.instanceId), true);
  assert.equal(opponent.hand.some((unit) => unit.instanceId === declared.instanceId), false);
  assert.equal(field.units.some((unit) => unit.instanceId === other.instanceId), true);
});

test("diana lunari pays its trigger cost while Pending before the showdown response window", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-revealed-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-energy")];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-attacker", field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.showdown.chain[0].status, "pending");
  assert.equal(game.pendingPayment.source, "triggeredAbility");
  assert.equal(game.pendingPayment.playerId, opponent.id);
  assert.equal(opponent.runes[0].exhausted, false);

  payPendingEnergy(game, ["diana-energy"]);
  assert.equal(opponent.runes[0].exhausted, true);
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.runes[0].exhausted, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-revealed-spell"), true);
});

test("diana lunari showdown trigger can be declined", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-decline-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-decline-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-decline-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-decline-energy")];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-decline-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(chooseEffectOption(game, "decline-optional-trigger").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(opponent.runes[0].exhausted, false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-decline-spell"), false);
  assert.equal(game.showdown.priorityPlayerId, player.id,
    "removing a Pending trigger does not pass Focus under rule 346.1");
});

test("optional triggered ability placement proceeds directly to its cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const vayne = instance(cards.vayneHunter, player.id, "vayne-optional-cost");
  player.base = [vayne];
  player.runes = [rune(DOMAINS.FURY, player.id, "vayne-optional-energy")];
  field.controlledBy = opponent.id;
  field.units = [];

  assert.equal(moveUnit(game, vayne.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice, null,
    "the optional placement decision is not repeated as a resolution-time use decision");
  assert.equal(game.pendingPayment?.source, "triggeredAbility");
  assert.equal(togglePaymentRune(game, "vayne-optional-energy", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === vayne.instanceId), true);
});

test("declining a nested optional trigger cost resumes the interrupted action Chain", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.legend = instance(cards.volibearRelentlessStorm, player.id, "nested-trigger-volibear");
  const firstAurora = instance(cards.dazzlingAurora, player.id, "nested-trigger-aurora-one");
  const secondAurora = instance(cards.dazzlingAurora, player.id, "nested-trigger-aurora-two");
  const mightyUnit = instance({ ...cards.magmaWurm, energy: 0, power: [] }, player.id, "nested-trigger-mighty-unit");
  player.base = [firstAurora, secondAurora];
  player.mainDeck = [mightyUnit];

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  selectAndConfirmTriggerOrder(game);
  assert.equal(game.actionChain?.chain.length, 2);

  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice?.effect, "declareTriggerCost");
  assert.equal(chooseEffectOption(game, "decline-trigger-cost").ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain?.chain.length, 1);
  assert.equal(game.actionChain?.priorityPlayerId, player.id,
    "the remaining finalized item regains Priority after the nested trigger cost is declined");
});

test("a placed triggered ability can still decline its cost while Pending", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-cost-decline-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-cost-decline-trigger");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-cost-decline-energy")];

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingPayment.source, "triggeredAbility");
  assert.equal(game.showdown.chain[0].status, "pending");

  assert.equal(cancelPayment(game).ok, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(opponent.runes[0].exhausted, false);
  assert.equal(game.showdown.priorityPlayerId, player.id);
});

test("diana lunari showdown trigger opens manual payment for generated energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-pool-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-pool-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-pool-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [];
  opponent.runePool = {
    energy: [{
      id: "diana-pool-energy",
      type: "energy",
      domains: [DOMAINS.MIND, DOMAINS.CHAOS],
      sourceCardId: opponent.legend.instanceId,
      sourceName: opponent.legend.name,
      restriction: "showdown"
    }],
    power: []
  };
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-pool-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment.source, "triggeredAbility");
  assert.equal(togglePaymentPoolEnergy(game, "diana-pool-energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.runePool.energy.length, 0);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-pool-spell"), true);
});

test("diana lunari showdown trigger works through multiplayer commands", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const room = { game, hostPlayerId: "p1" };
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-online-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-online-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-online-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-online-energy")];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-online-attacker", field.instanceId).ok, true);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "chooseEffectOption", optionId: "use-optional-trigger" }).ok, true);
  assert.equal(game.pendingPayment.source, "triggeredAbility");
  assert.equal(game.pendingPayment.playerId, opponent.id);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "togglePaymentRune", runeId: "diana-online-energy", mode: "energy" }).ok, true);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "confirmPayment" }).ok, true);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "passShowdown" }).ok, true);
  assert.equal(applyGameCommand(room, player.id, { kind: "passShowdown" }).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(applyGameCommand(room, opponent.id, { kind: "chooseEffectOption", optionId: "keep" }).ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(applyGameCommand(room, opponent.id, { kind: "chooseEffectOption", optionId: "continue" }).ok, true);
  assert.equal(opponent.runes[0].exhausted, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-online-spell"), true);
});

test("scorn of the moon adds showdown energy without becoming a chain item", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "scorn-chain-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "scorn-chain-diana");
  const revealedSpell = instance(cards.gust, opponent.id, "scorn-chain-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [];
  opponent.mainDeck = [revealedSpell];
  opponent.legend.exhausted = false;

  assert.equal(moveUnit(game, "scorn-chain-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.currentPlayerId, opponent.id);
  assert.equal(game.pendingPayment.source, "triggeredAbility");

  assert.equal(activateCard(game, opponent.legend.instanceId).ok, true);
  assert.equal(opponent.runePool.energy.length, 1);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(opponent.legend.exhausted, true);
  assert.equal(togglePaymentPoolEnergy(game, opponent.runePool.energy[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(game.showdown.priorityPlayerId, opponent.id);

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "scorn-chain-spell"), true);
});

test("generated energy must be selected for effect energy payments", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "generated-pay-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "generated-pay-diana");
  const revealedSpell = instance(cards.gust, opponent.id, "generated-pay-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [];
  opponent.runePool.energy = [{
    id: "generated-effect-energy",
    type: "energy",
    domains: cards.dianaScornOfTheMoon.domains,
    sourceCardId: opponent.legend.instanceId,
    sourceName: opponent.legend.name,
    restriction: "showdown"
  }];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "generated-pay-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].status, "pending");
  assert.equal(game.pendingPayment.source, "triggeredAbility");
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "generated-effect-energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(opponent.runePool.energy.length, 0);
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "generated-pay-spell"), true);
});

test("spell-only add Power abilities follow reaction windows and exhaust their legend", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.legend = instance(cards.kaiSaDaughterOfTheVoid, player.id, "daughter-open");

  assert.equal(activateCard(game, "daughter-open").ok, true);
  assert.equal(player.legend.exhausted, true);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.power[0].restriction, "spell");

  player.legend.exhausted = false;
  player.runePool.power = [];
  const opponent = game.players[1];
  game.turnPlayerId = opponent.id;
  game.currentPlayerId = opponent.id;
  assert.equal(activateCard(game, "daughter-open").ok, false);

  game.actionChain = {
    turnPlayerId: opponent.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{ card: instance(cards.gust, opponent.id, "daughter-chain-spell"), playerId: opponent.id, destination: "base", status: "finalized" }],
    chainSequence: 1
  };
  game.currentPlayerId = player.id;
  assert.equal(activateCard(game, "daughter-open").ok, true);
  assert.equal(player.legend.exhausted, true);
  assert.equal(player.runePool.power.length, 1);
});

test("Reaction cards and abilities use the Priority player instead of the turn player", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const turnPlayer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== turnPlayer.id);
  const addSource = instance(cards.luxCrownguard, opponent.id, "priority-add-source");
  const reaction = instance({
    ...cards.gust,
    id: "TEST-PRIORITY-REACTION",
    cardNumber: "TEST-PRIORITY-REACTION/001",
    collectorNumber: "TEST-PRIORITY-REACTION/001",
    name: "Rules Test Priority Reaction",
    energy: 0,
    power: [],
    effects: []
  }, opponent.id, "priority-reaction-card");
  opponent.base = [addSource];
  opponent.hand = [reaction];
  opponent.runePool = { energy: [], power: [] };
  game.phase = "action";
  game.currentPlayerId = turnPlayer.id;
  game.actionChain = {
    turnPlayerId: turnPlayer.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: opponent.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{
      id: "priority-existing-item",
      itemType: "card",
      card: instance(cards.lonelyPoro, turnPlayer.id, "priority-existing-card"),
      playerId: turnPlayer.id,
      destination: "base",
      status: "finalized"
    }]
  };

  assert.equal(activateCard(game, addSource.instanceId).ok, true);
  assert.equal(opponent.runePool.energy.length, 2);
  assert.equal(game.currentPlayerId, turnPlayer.id, "Priority does not rewrite turn ownership");
  assert.equal(game.actionChain.priorityPlayerId, opponent.id);

  const reactionResult = beginPlayCard(game, reaction.instanceId, "base");
  assert.equal(reactionResult.ok, true, reactionResult.message);
  if (game.pendingPayment) {
    assert.equal(game.pendingPayment.playerId, opponent.id);
    assert.equal(confirmPayment(game).ok, true);
  }
  assert.equal(game.actionChain.chain.some((item) => item.card?.instanceId === reaction.instanceId && item.playerId === opponent.id), true);
});

test("Shen Kinkou remains on the Chain after Finalize until both players pass", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const turnPlayer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== turnPlayer.id);
  const shen = instance({ ...cards.shenKinkou, energy: 0, power: [] }, opponent.id, "shen-processing-queue");
  opponent.hand = [shen];
  game.actionChain = {
    turnPlayerId: turnPlayer.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: opponent.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{
      id: "shen-processing-bottom",
      itemType: "card",
      card: instance(cards.gust, turnPlayer.id, "shen-processing-bottom-card"),
      playerId: turnPlayer.id,
      destination: "base",
      status: "finalized"
    }]
  };

  assert.equal(beginPlayCard(game, shen.instanceId, "base").ok, true);
  const pendingShen = game.actionChain.chain.find((item) => item.card?.instanceId === shen.instanceId);
  assert.ok(pendingShen, "the internal play procedure remains Pending only until its costs are confirmed");
  assert.equal(pendingShen.status, "pending");
  assert.equal(pendingShen.playerId, opponent.id);

  assert.equal(confirmPayment(game).ok, true);
  assert.equal(pendingShen.status, "finalized");
  assert.equal(opponent.base.some((card) => card.instanceId === shen.instanceId), false);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === shen.instanceId), true,
    "a Unit enters the board only after its finalized Chain item resolves");
});

test("spell-only generated Power can pay spells but not unit costs", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.legend = instance(cards.kaiSaDaughterOfTheVoid, player.id, "daughter-resource");
  player.hand = [instance({
    ...cards.lonelyPoro,
    energy: 0,
    power: [{ domain: DOMAINS.ANY, amount: 1 }]
  }, player.id, "daughter-unit")];
  player.runes = [];

  assert.equal(activateCard(game, "daughter-resource").ok, true);
  const spellOnlyPowerId = player.runePool.power[0].id;
  assert.equal(beginPlayCard(game, "daughter-unit", "base").ok, false,
    "a Unit with no complete payment route has no playable Cast action");
  assert.equal(game.pendingPayment, null);

  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "daughter-spell-target");
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [instance({
    ...cards.gust,
    energy: 0,
    power: [{ domain: DOMAINS.ANY, amount: 1 }]
  }, player.id, "daughter-gust")];

  assert.equal(beginPlayCard(game, "daughter-gust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "daughter-spell-target").ok, true);
  assert.equal(togglePaymentPoolPower(game, spellOnlyPowerId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runePool.power.length, 0);
});

test("generated spell Power expires and does not leak into later turns", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.legend = instance(cards.kaiSaDaughterOfTheVoid, player.id, "daughter-expire");

  assert.equal(activateCard(game, "daughter-expire").ok, true);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.power[0].restriction, "spell");

  assert.equal(endTurn(game).ok, true);
  assert.equal(player.runePool.power.length, 0);
  assert.equal(opponent.runePool.energy.length, 0);
  assert.equal(game.currentPlayerId, opponent.id);
});

test("payment only allows compatible generated energy when multiple pool energies exist", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.runes = [];
  player.runePool.energy = [
    {
      id: "pool-spell-only",
      type: "energy",
      domains: [DOMAINS.MIND],
      sourceCardId: "daughter",
      sourceName: "Daughter Energy",
      restriction: "spell"
    },
    {
      id: "pool-showdown-only",
      type: "energy",
      domains: [DOMAINS.CHAOS],
      sourceCardId: "scorn",
      sourceName: "Scorn Energy",
      restriction: "showdown"
    },
    {
      id: "pool-unrestricted",
      type: "energy",
      domains: [DOMAINS.CALM],
      sourceCardId: "test",
      sourceName: "Open Energy",
      restriction: null
    },
    {
      id: "pool-unrestricted-two",
      type: "energy",
      domains: [DOMAINS.BODY],
      sourceCardId: "test-two",
      sourceName: "Open Energy Two",
      restriction: null
    }
  ];

  player.hand = [instance(cards.lonelyPoro, player.id, "mixed-energy-unit")];
  assert.equal(beginPlayCard(game, "mixed-energy-unit", "base").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, "pool-spell-only").ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "pool-showdown-only").ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "pool-unrestricted").ok, true);
  assert.equal(confirmPayment(game).ok, false);

  game.pendingPayment = null;
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "mixed-energy-target")];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.gust, player.id, "mixed-energy-gust")];

  assert.equal(beginPlayCard(game, "mixed-energy-gust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "mixed-energy-target").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, "pool-showdown-only").ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "pool-spell-only").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runePool.energy.some((resource) => resource.id === "pool-spell-only"), false);
  assert.equal(player.runePool.energy.some((resource) => resource.id === "pool-unrestricted"), true);
});

test("showdown energy is tracked in the rune pool and can pay spell energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "pool-gust-target");
  field.units = [target, instance(cards.ravenbloomStudent, dianaPlayer.id, "pool-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    focusPlayerId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = dianaPlayer.id;
  dianaPlayer.hand = [instance(cards.gust, dianaPlayer.id, "pool-gust")];
  dianaPlayer.runes = [];

  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(game.showdown.chain.length, 0);
  assert.deepEqual(dianaPlayer.runePool.energy[0].domains, cards.dianaScornOfTheMoon.domains);
  assert.equal(dianaPlayer.runePool.energy[0].restriction, "showdown");
  assert.equal(dianaPlayer.runes.some((runeCard) => runeCard.temporaryResource), false);
  assert.equal(game.showdown.priorityPlayerId, dianaPlayer.id);

  assert.equal(beginPlayCard(game, "pool-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(togglePaymentPoolEnergy(game, dianaPlayer.runePool.energy[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(dianaPlayer.runePool.energy.length, 0);
  assert.equal(game.showdown.chain[0].card.instanceId, "pool-gust");
});

test("showdown-restricted generated energy persists but becomes unusable when showdown ends", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "expire-showdown-attacker")];
  game.phase = "showdown";
  game.currentPlayerId = dianaPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    combat: false,
    focusPlayerId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(dianaPlayer.runePool.energy[0].restriction, "showdown");

  assert.equal(passShowdown(game, dianaPlayer.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown, null);
  assert.equal(game.phase, "action");
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(dianaPlayer.runePool.energy[0].restriction, "showdown");
});

test("generated energy cannot bypass additional power costs from showdown modifiers", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  const vex = instance(cards.vexCheerless, opponent.id, "generated-cost-vex");
  const target = instance(cards.lonelyPoro, opponent.id, "generated-cost-target");
  field.units = [vex, target, instance(cards.ravenbloomStudent, dianaPlayer.id, "generated-cost-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.currentPlayerId = dianaPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    combat: true,
    focusPlayerId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };
  dianaPlayer.hand = [instance(cards.gust, dianaPlayer.id, "generated-cost-gust")];
  dianaPlayer.runes = [];

  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  dianaPlayer.runePool.energy.push({
    id: "generated-cost-extra-energy",
    type: "energy",
    domains: [DOMAINS.CHAOS],
    sourceCardId: "test-extra-energy",
    sourceName: "Extra Generated Energy",
    restriction: "showdown"
  });
  assert.deepEqual(legalCardPlayDestinations(game, "generated-cost-gust"), [],
    "generated Energy cannot make a spell playable while its added Power cost is unpaid");
  assert.equal(beginPlayCard(game, "generated-cost-gust", field.instanceId).ok, false);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.showdown.chain.length, 0);
});

test("scorn of the moon can add energy during showdown payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "payment-scorn-target");
  field.units = [target, instance(cards.ravenbloomStudent, dianaPlayer.id, "payment-scorn-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    focusPlayerId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = dianaPlayer.id;
  dianaPlayer.hand = [instance(cards.gust, dianaPlayer.id, "payment-scorn-gust")];
  dianaPlayer.runes = [];
  dianaPlayer.legend.exhausted = false;

  assert.equal(beginPlayCard(game, "payment-scorn-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment.cardId, "payment-scorn-gust");
  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  assert.equal(game.pendingPayment.cardId, "payment-scorn-gust");
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(dianaPlayer.legend.exhausted, true);
  assert.equal(togglePaymentPoolEnergy(game, dianaPlayer.runePool.energy[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.showdown.chain[0].card.instanceId, "payment-scorn-gust");
});

test("showdown start choices resume remaining battlefield defend triggers", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "resume-conservatory"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  const attacker = instance(cards.lonelyPoro, player.id, "resume-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "resume-diana");
  const dianaSpell = instance(cards.gust, opponent.id, "resume-diana-spell");
  const conservatorySpell = instance(cards.stupefy, opponent.id, "resume-conservatory-spell");
  player.base = [attacker];
  field.units = [diana];
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "resume-diana-energy")];
  opponent.mainDeck = [dianaSpell, conservatorySpell];

  assert.equal(moveUnit(game, "resume-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  const dianaTrigger = game.pendingChoice.options.find((option) => option.cardId === diana.instanceId);
  const conservatoryFirst = game.pendingChoice.options.find((option) => option.cardId === field.instanceId);
  assert.equal(dianaTrigger.optionalTrigger, true);
  selectAndConfirmTriggerOrder(game, [dianaTrigger.id, conservatoryFirst.id]);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment.source, "triggeredAbility");
  assert.equal(game.showdown.chain.length, 2);
  assert.equal(game.showdown.chain.every((item) => item.status === "pending"), true);
  payPendingEnergy(game, ["resume-diana-energy"]);
  assert.equal(game.showdown.chain.every((item) => item.status === "finalized"), true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "resume-diana-spell"), true);

  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.hand.some((card) => card.instanceId === "resume-conservatory-spell"), true);
});

test("eclipse asks whether to recycle the predicted card after modifying might", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const target = instance(cards.ravenbloomStudent, opponent.id, "eclipse-target");
  const predicted = instance(cards.gust, player.id, "eclipse-predicted");
  opponent.base = [target];
  player.mainDeck = [predicted, instance(cards.flash, player.id, "eclipse-second")];
  player.hand = [instance(cards.eclipse, player.id, "explicit-eclipse")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "eclipse-r1"),
    rune(DOMAINS.MIND, player.id, "eclipse-r2"),
    rune(DOMAINS.MIND, player.id, "eclipse-r3")
  ];

  assert.equal(playCard(game, "explicit-eclipse", "base").ok, true);
  assert.equal(target.mightModifier, -4);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "recycle").ok, true);
  assert.equal(player.mainDeck.at(-1).instanceId, "eclipse-predicted");
  assert.equal(player.trash.some((card) => card.instanceId === "explicit-eclipse"), true);
});

test("hwei move trigger asks which card to discard and applies the type bonus", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const hwei = instance(cards.hweiBroodingPainter, player.id, "moving-hwei");
  const drawn = instance(cards.charm, player.id, "hwei-drawn-card");
  const discardUnit = instance(cards.lonelyPoro, player.id, "hwei-discard-unit");
  player.base = [hwei];
  player.hand = [discardUnit];
  player.mainDeck = [drawn];

  assert.equal(moveUnit(game, "moving-hwei", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "hweiDiscard");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["hwei-discard-unit", "hwei-drawn-card"]);

  assert.equal(chooseEffectOption(game, "hwei-discard-unit").ok, true);
  assert.equal(hwei.mightModifier, 3);
  assert.equal(hwei.temporaryMight, 3);
  assert.equal(player.trash.some((card) => card.instanceId === "hwei-discard-unit"), true);
  assert.equal(player.discardedCardsThisTurn, 1);
  assert.deepEqual(game.discardEvents.at(-1).cardIds, ["hwei-discard-unit"]);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("hwei gear discard lets the player choose up to two runes to ready", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const hwei = instance(cards.hweiBroodingPainter, player.id, "gear-hwei");
  const drawn = instance(cards.charm, player.id, "gear-hwei-drawn");
  const gear = instance(cards.guardianAngel, player.id, "hwei-discard-gear");
  const firstRune = rune(DOMAINS.MIND, player.id, "hwei-ready-one");
  const secondRune = rune(DOMAINS.MIND, player.id, "hwei-ready-two");
  firstRune.exhausted = true;
  secondRune.exhausted = true;
  player.base = [hwei];
  player.hand = [gear];
  player.mainDeck = [drawn];
  player.runes = [firstRune, secondRune];

  assert.equal(moveUnit(game, "gear-hwei", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "hweiDiscard");
  assert.equal(chooseEffectOption(game, "hwei-discard-gear").ok, true);
  assert.equal(game.pendingChoice.effect, "readyRunes");

  assert.equal(chooseEffectOption(game, "hwei-ready-one").ok, true);
  assert.equal(firstRune.exhausted, false);
  assert.equal(secondRune.exhausted, true);
  assert.equal(game.pendingChoice.effect, "readyRunes");

  assert.equal(chooseEffectOption(game, "done").ok, true);
  assert.equal(secondRune.exhausted, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("Hwei triggers after an effect moves him and the resulting showdown waits for that trigger", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sourceField = game.battlefields[0];
  const destination = game.battlefields[1];
  const hwei = instance(cards.hweiBroodingPainter, player.id, "effect-moved-hwei");
  const enemy = instance(cards.lonelyPoro, opponent.id, "effect-move-enemy");
  const discard = instance(cards.lonelyPoro, player.id, "effect-hwei-discard");
  sourceField.units = [hwei];
  sourceField.controlledBy = player.id;
  destination.units = [enemy];
  destination.controlledBy = opponent.id;
  player.hand = [discard];
  player.mainDeck = [instance(cards.charm, player.id, "effect-hwei-draw")];

  assert.equal(resolveEffect(game, player, instance(cards.rideTheWind, player.id, "effect-ride-hwei")), true);
  assert.equal(game.pendingChoice.effect, "moveUnitSpellTarget");
  assert.equal(chooseEffectOption(game, hwei.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "moveUnitSpellDestination");
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff",
    "the parent spell's simultaneous battlefield trigger is declared before its move trigger resolves");
  assert.equal(chooseEffectOption(game, hwei.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "hweiDiscard");
  assert.equal(game.phase, "action");
  assert.equal(game.showdown, null);

  assert.equal(chooseEffectOption(game, discard.instanceId).ok, true);
  assert.equal(hwei.mightModifier, 4,
    "Hwei receives both the battlefield's +1 and his own +3 move-trigger bonus");
  assert.equal(hwei.temporaryMight, 4);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, destination.instanceId);
  assert.equal(game.showdown.attackerId, player.id);
});

test("frigid jewel asks which friendly unit gets the second-draw buff", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const jewel = instance(cards.frigidJewel, player.id, "explicit-jewel");
  const first = instance(cards.lonelyPoro, player.id, "jewel-first-unit");
  const second = instance(cards.ravenbloomStudent, player.id, "jewel-second-unit");
  player.base = [jewel, first, second];
  player.mainDeck = [
    instance(cards.charm, player.id, "jewel-draw-one"),
    instance(cards.gust, player.id, "jewel-draw-two")
  ];
  player.drawCountThisTurn = 0;

  draw(player, 1, game);
  assert.equal(game.pendingChoice, null);
  draw(player, 1, game);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["jewel-first-unit", "jewel-second-unit"]);

  assert.equal(chooseEffectOption(game, "jewel-second-unit").ok, true);
  assert.equal(first.mightModifier, 0);
  assert.equal(second.mightModifier, 2);
  assert.equal(second.temporaryMight, 2);
});

test("frigid jewel uses the declared second-draw target and does not retarget", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const jewel = instance(cards.frigidJewel, player.id, "retarget-jewel");
  const declared = instance(cards.lonelyPoro, player.id, "jewel-declared-unit");
  const other = instance(cards.ravenbloomStudent, player.id, "jewel-other-unit");
  player.base = [jewel, declared, other];
  player.mainDeck = [
    instance(cards.charm, player.id, "jewel-retarget-draw-one"),
    instance(cards.gust, player.id, "jewel-retarget-draw-two")
  ];

  draw(player, 2, game);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);

  player.base = player.base.filter((card) => card.instanceId !== "jewel-declared-unit");
  player.hand.push(declared);

  assert.equal(chooseEffectOption(game, "jewel-declared-unit").ok, true);
  assert.equal(declared.mightModifier, 0);
  assert.equal(other.mightModifier, 0);
});

test("abandoned hall asks which local unit gets the spell-play might bonus after the spell resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "hall-first-unit");
  const second = instance(cards.scuttleCrab, player.id, "hall-second-unit");
  const hall = {
    ...instance(cards.abandonedHall, player.id, "explicit-hall"),
    controlledBy: player.id,
    units: [first, second],
    hidden: []
  };
  game.battlefields = [hall];
  player.hand = [instance(cards.stackedDeck, player.id, "hall-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "hall-top-one"),
    instance(cards.gust, player.id, "hall-top-two"),
    instance(cards.flash, player.id, "hall-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "hall-spell-rune")];

  assert.equal(playCard(game, "hall-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
  assert.equal(chooseEffectOption(game, "hall-top-one").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["hall-first-unit", "hall-second-unit", "decline"]);

  assert.equal(chooseEffectOption(game, "hall-second-unit").ok, true);
  assert.equal(first.mightModifier, 0);
  assert.equal(second.mightModifier, 1);
  assert.equal(second.temporaryMight, 1);
  assert.equal(game.pendingChoice, null);
});

test("battlefield spell triggers use their declared target and do not retarget", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const declared = instance(cards.lonelyPoro, player.id, "hall-declared-unit");
  const other = instance(cards.scuttleCrab, player.id, "hall-other-unit");
  const hall = {
    ...instance(cards.abandonedHall, player.id, "retarget-hall"),
    controlledBy: player.id,
    units: [declared, other],
    hidden: []
  };
  game.battlefields = [hall];
  player.hand = [instance(cards.stackedDeck, player.id, "retarget-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "retarget-top-one"),
    instance(cards.gust, player.id, "retarget-top-two"),
    instance(cards.flash, player.id, "retarget-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "retarget-rune")];

  assert.equal(playCard(game, "retarget-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
  assert.equal(chooseEffectOption(game, "retarget-top-one").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);

  hall.units = hall.units.filter((unit) => unit.instanceId !== "hall-declared-unit");
  player.hand.push(declared);

  assert.equal(chooseEffectOption(game, "hall-declared-unit").ok, true);
  assert.equal(declared.mightModifier, 0);
  assert.equal(other.mightModifier, 0);
  assert.equal(game.pendingChoice, null);
});

test("declining all spell-play battlefield triggers leaves the resolved spell completed", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "hall-decline-unit");
  const hall = {
    ...instance(cards.abandonedHall, player.id, "decline-hall"),
    controlledBy: player.id,
    units: [unit],
    hidden: []
  };
  game.battlefields = [hall];
  player.hand = [instance(cards.stackedDeck, player.id, "decline-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "decline-top-one"),
    instance(cards.gust, player.id, "decline-top-two"),
    instance(cards.flash, player.id, "decline-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "decline-rune")];

  assert.equal(playCard(game, "decline-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
  assert.equal(chooseEffectOption(game, "decline-top-one").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(unit.mightModifier, 0);
  assert.equal(game.pendingChoice, null);
});

test("multiple spell-play battlefield triggers queue after the spell resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const firstUnit = instance(cards.lonelyPoro, player.id, "hall-queue-first-unit");
  const secondUnit = instance(cards.scuttleCrab, player.id, "hall-queue-second-unit");
  const firstHall = {
    ...instance(cards.abandonedHall, player.id, "hall-queue-one"),
    controlledBy: player.id,
    units: [firstUnit],
    hidden: []
  };
  const secondHall = {
    ...instance(cards.abandonedHall, player.id, "hall-queue-two"),
    controlledBy: player.id,
    units: [secondUnit],
    hidden: []
  };
  game.battlefields = [firstHall, secondHall];
  player.hand = [instance(cards.stackedDeck, player.id, "hall-queue-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "hall-queue-top-one"),
    instance(cards.gust, player.id, "hall-queue-top-two"),
    instance(cards.flash, player.id, "hall-queue-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "hall-queue-rune")];

  assert.equal(playCard(game, "hall-queue-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
  assert.equal(chooseEffectOption(game, "hall-queue-top-one").ok, true);
  assert.equal(game.pendingChoice.effect, "triggerOrder");
  const firstHallTrigger = game.pendingChoice.options.find((option) => option.cardId === firstHall.instanceId);
  selectAndConfirmTriggerOrder(game, [
    firstHallTrigger.id,
    ...game.pendingChoice.options
      .filter((option) => !option.confirmTriggerOrder && option.id !== firstHallTrigger.id)
      .map((option) => option.id)
  ]);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["hall-queue-second-unit", "decline"]);

  assert.equal(chooseEffectOption(game, "hall-queue-second-unit").ok, true);
  assert.equal(firstUnit.mightModifier, 0);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["hall-queue-first-unit", "decline"]);

  assert.equal(chooseEffectOption(game, "hall-queue-first-unit").ok, true);
  assert.equal(firstUnit.mightModifier, 1);
  assert.equal(secondUnit.mightModifier, 1);
  assert.equal(game.pendingChoice, null);
});

test("unselected optional simultaneous triggers are not placed on the chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "optional-order-conservatory"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  const attacker = instance(cards.lonelyPoro, player.id, "optional-order-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "optional-order-diana");
  player.base = [attacker];
  field.units = [diana];
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "optional-order-energy")];
  opponent.mainDeck = [instance(cards.gust, opponent.id, "optional-order-reveal")];

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  const optionalDiana = game.pendingChoice.options.find((option) => option.cardId === diana.instanceId);
  const mandatoryConservatory = game.pendingChoice.options.find((option) => option.cardId === field.instanceId);
  assert.equal(optionalDiana.optionalTrigger, true);
  assert.equal(mandatoryConservatory.optionalTrigger, false);
  selectAndConfirmTriggerOrder(game, [mandatoryConservatory.id]);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].trigger.sourceCardId, field.instanceId);
  assert.equal(opponent.runes[0].exhausted, false);
});

test("the dreaming tree draws when a spell first chooses a friendly unit there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "dreaming-tree-unit");
  const field = {
    ...instance(cards.theDreamingTree, player.id, "explicit-dreaming-tree"),
    controlledBy: player.id,
    units: [unit],
    hidden: []
  };
  const drawn = instance(cards.flash, player.id, "dreaming-tree-draw");
  game.battlefields = [field];
  player.hand = [instance(cards.enGarde, player.id, "dreaming-tree-en-garde")];
  player.mainDeck = [drawn];
  player.runes = [rune(DOMAINS.CALM, player.id, "dreaming-tree-rune")];

  assert.equal(beginPlayCard(game, "dreaming-tree-en-garde", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "dreaming-tree-unit").ok, true);
  assert.equal(togglePaymentRune(game, "dreaming-tree-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  let triggerPasses = 0;
  while (game.actionChain && !game.pendingChoice && !game.pendingPayment
    && !player.hand.some((card) => card.instanceId === "dreaming-tree-draw") && triggerPasses < 8) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    triggerPasses += 1;
  }

  assert.equal(player.hand.some((card) => card.instanceId === "dreaming-tree-draw"), true);
  assert.equal(field.spellFriendlyTargetDrawnThisTurn[player.id], true);
});

test("targon's peak readies runes at end of turn, not immediately on conquer", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const peak = {
    ...instance(cards.targonsPeak, player.id, "explicit-peak"),
    controlledBy: null,
    units: [],
    hidden: []
  };
  const unit = instance(cards.lonelyPoro, player.id, "peak-conqueror");
  const firstRune = rune(DOMAINS.CHAOS, player.id, "peak-rune-one");
  const secondRune = rune(DOMAINS.CHAOS, player.id, "peak-rune-two");
  firstRune.exhausted = true;
  secondRune.exhausted = true;
  game.battlefields = [peak];
  player.base = [unit];
  player.runes = [firstRune, secondRune];

  assert.equal(moveUnit(game, "peak-conqueror", "explicit-peak").ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(player.score, 1);
  assert.equal(firstRune.exhausted, true);
  assert.equal(secondRune.exhausted, true);
  assert.equal(player.endTurnReadyRunes, 2);

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice.effect, "readyRune");
  assert.equal(chooseEffectOption(game, "peak-rune-two").ok, true);
  assert.equal(firstRune.exhausted, true);
  assert.equal(secondRune.exhausted, true,
    "the rune is only declared while the trigger finalizes");
  assert.equal(game.pendingChoice.effect, "readyRune");
  assert.equal(chooseEffectOption(game, "peak-rune-one").ok, true);
  assert.equal(firstRune.exhausted, false);
  assert.equal(secondRune.exhausted, false);
  assert.equal(player.endTurnReadyRunes, 0);
});

test("ravenbloom conservatory puts the defending player's revealed spell into hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const conservatory = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "explicit-conservatory"),
    controlledBy: opponent.id,
    units: [instance(cards.lonelyPoro, opponent.id, "conservatory-defender")],
    hidden: []
  };
  const attacker = instance(cards.lonelyPoro, player.id, "conservatory-attacker");
  const revealedSpell = instance(cards.gust, opponent.id, "conservatory-revealed");
  game.battlefields = [conservatory];
  player.base = [attacker];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "conservatory-attacker", "explicit-conservatory").ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, "conservatory-revealed");
  assert.equal(opponent.hand.some((card) => card.instanceId === "conservatory-revealed"), false);
  assert.equal(opponent.mainDeck[0]?.instanceId, "conservatory-revealed",
    "a Revealed card remains in its Main Deck until the Reveal effect moves it");
  assert.deepEqual(game.revealEvents?.at(-1)?.cardIds, ["conservatory-revealed"]);
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "conservatory-revealed"), true);
  assert.equal(opponent.mainDeck.some((card) => card.instanceId === "conservatory-revealed"), false);
});

test("top-deck self abilities pause a Reveal and then resume its original continuation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attackerPlayer = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attackerPlayer.id);
  const conservatory = {
    ...instance(cards.ravenbloomConservatory, defender.id, "observed-conservatory"),
    controlledBy: defender.id,
    units: [instance(cards.lonelyPoro, defender.id, "observed-defender")],
    hidden: []
  };
  const attacker = instance(cards.lonelyPoro, attackerPlayer.id, "observed-attacker");
  const nocturne = instance(cards.nocturneHorrifying, defender.id, "observed-nocturne");
  const next = instance(cards.gust, defender.id, "observed-next-card");
  game.battlefields = [conservatory];
  attackerPlayer.base = [attacker];
  defender.mainDeck = [nocturne, next];
  defender.runes = [];

  assert.equal(moveUnit(game, attacker.instanceId, conservatory.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice?.effect, "observedTopDeckSelfAbility");
  assert.equal(chooseEffectOption(game, "leave").ok, true);
  assert.equal(game.pendingChoice?.effect, "acknowledgeReveal");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, nocturne.instanceId);
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.deepEqual(defender.mainDeck.map((card) => card.instanceId), [next.instanceId, nocturne.instanceId]);
});

test("ravenbloom conservatory does not trigger for a non-combat showdown", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const conservatory = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "noncombat-conservatory"),
    controlledBy: opponent.id,
    units: [],
    hidden: []
  };
  const attacker = instance(cards.lonelyPoro, player.id, "noncombat-conservatory-unit");
  const top = instance(cards.gust, opponent.id, "noncombat-conservatory-top");
  game.battlefields = [conservatory];
  player.base = [attacker];
  opponent.mainDeck = [top];

  assert.equal(moveUnit(game, attacker.instanceId, conservatory.instanceId).ok, true);
  assert.equal(game.showdown.combat, false);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.mainDeck[0].instanceId, top.instanceId);
});

test("kha'zix gains might and xp when attacking an isolated enemy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const khazix = instance(cards.khazixMutatingHorror, player.id, "isolated-khazix");
  field.units = [instance(cards.lonelyPoro, opponent.id, "isolated-enemy")];
  field.controlledBy = opponent.id;
  player.base = [khazix];
  const xpBefore = player.xp;

  assert.equal(moveUnit(game, "isolated-khazix", field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(khazix.mightModifier, 2);
  assert.equal(khazix.temporaryMight, 2);
  assert.equal(player.xp, xpBefore + 2);
  assert.equal(game.showdown.focusPlayerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
});

test("tideturner can swap its location with another controlled unit when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, player.id, "tideturner-target");
  const sameLocation = instance(cards.scuttleCrab, player.id, "tideturner-same-location");
  field.units = [target];
  field.controlledBy = player.id;
  player.base = [sameLocation];
  player.hand = [instance(cards.tideturner, player.id, "explicit-tideturner")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "tideturner-r1"),
    rune(DOMAINS.CHAOS, player.id, "tideturner-r2")
  ];

  assert.equal(playCard(game, "explicit-tideturner", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "tideturnerSwap");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["tideturner-target"]);
  assert.equal(game.pendingChoice.options.some((option) => option.cardId === sameLocation.instanceId), false,
    "the July 24 rules only allow a controlled unit at another location");

  assert.equal(chooseEffectOption(game, "tideturner-target").ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "explicit-tideturner"), true);
  assert.equal(player.base.some((unit) => unit.instanceId === "tideturner-target"), true);
  const swapMoveEvents = game.moveEvents.slice(-2);
  assert.deepEqual(new Set(swapMoveEvents.map((event) => event.cardId)),
    new Set(["explicit-tideturner", "tideturner-target"]));
  assert.equal(new Set(swapMoveEvents.map((event) => event.simultaneousBatchId)).size, 1,
    "both instructed Moves form one simultaneous movement batch");
  assert.equal(swapMoveEvents.every((event) => event.responsiblePlayerId === player.id), true);
});

test("vex cheerless modifies showdown spell costs for both players", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const vex = instance(cards.vexCheerless, player.id, "cost-vex");
  field.units = [vex, instance(cards.lonelyPoro, opponent.id, "cost-enemy")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.eclipse, player.id, "friendly-eclipse")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "friendly-cost-one"),
    rune(DOMAINS.MIND, player.id, "friendly-cost-two")
  ];

  assert.equal(beginPlayCard(game, "friendly-eclipse", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "cost-enemy").ok, true);
  assert.equal(game.pendingPayment.energyCost, 2);
  assert.deepEqual(game.pendingPayment.powerCost, []);

  game.pendingPayment = null;
  game.pendingChoice = null;
  game.currentPlayerId = opponent.id;
  game.showdown.focusPlayerId = opponent.id;
  game.showdown.priorityPlayerId = opponent.id;
  opponent.hand = [instance(cards.gust, opponent.id, "enemy-gust")];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "enemy-cost-one"),
    rune(DOMAINS.CHAOS, opponent.id, "enemy-cost-two"),
    rune(DOMAINS.CHAOS, opponent.id, "enemy-cost-power")
  ];

  assert.equal(beginPlayCard(game, "enemy-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "cost-enemy").ok, true);
  assert.equal(game.pendingPayment.energyCost, 2);
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.ANY, amount: 1 }]);
});

test("vex apathetic puts her trigger on the chain for an opposing unit played at another battlefield", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const vexField = game.battlefields[0];
  const destination = game.battlefields[1];
  const vex = instance(cards.vexApathetic, opponent.id, "apathetic-vex");
  const playedUnit = instance({ ...cards.lonelyPoro, energy: 0, power: [] }, player.id, "vex-other-field-unit");
  vexField.units = [vex];
  vexField.controlledBy = opponent.id;
  destination.units = [];
  destination.controlledBy = player.id;
  player.hand = [playedUnit];
  opponent.hand = [instance({ ...cards.gust, energy: 0, power: [] }, opponent.id, "vex-trigger-response")];

  assert.equal(beginPlayCard(game, playedUnit.instanceId, destination.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  let passGuard = 0;
  while (!destination.units.some((unit) => unit.instanceId === playedUnit.instanceId) && passGuard < 4) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    passGuard += 1;
  }
  assert.equal(destination.units.some((unit) => unit.instanceId === playedUnit.instanceId), true);
  assert.equal(playedUnit.stunned, false, "the triggered ability has not resolved yet");
  assert.equal(game.actionChain?.chain.length, 1);
  assert.equal(game.actionChain.chain[0].itemType, "trigger");
  assert.equal(game.actionChain.chain[0].trigger.kind, "opponentPlaysUnitStunAndCantMove");

  passGuard = 0;
  while (!playedUnit.stunned && game.actionChain && passGuard < 4) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    passGuard += 1;
  }
  assert.equal(playedUnit.stunned, true);
  assert.equal(playedUnit.cantMoveThisTurn, true);
});

test("fizz plays a trash spell only if its power cost can be paid and recycles it after resolving", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const alphaTarget = instance(cards.ravenbloomStudent, opponent.id, "fizz-alpha-target");
  game.battlefields[0].units = [alphaTarget];
  player.hand = [instance(cards.fizzTrickster, player.id, "explicit-fizz")];
  const alpha = instance(cards.alphaStrike, player.id, "fizz-alpha");
  player.trash = [
    alpha,
    instance(cards.uncheckedPower, player.id, "too-expensive-trash-spell")
  ];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "fizz-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "fizz-energy-two"),
    rune(DOMAINS.CHAOS, player.id, "fizz-power"),
    rune(DOMAINS.CALM, player.id, "trash-power")
  ];

  assert.equal(playCard(game, "explicit-fizz", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashSpell");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["fizz-alpha"]);

  assert.equal(chooseEffectOption(game, "fizz-alpha").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["explicit-fizz"]);
  assert.equal(["fizz-energy-one", "fizz-energy-two", "fizz-power", "trash-power"]
    .filter((id) => player.runeDeck.some((card) => card.instanceId === id)).length, 1);

  assert.equal(chooseEffectOption(game, "explicit-fizz").ok, true);
  const declaredTarget = game.pendingChoice.options.find((option) => option.cardId === alphaTarget.instanceId);
  assert.ok(declaredTarget);
  assert.equal(declaredTarget.amount, undefined);
  assert.equal(chooseEffectOption(game, declaredTarget.id).ok, true);
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.equal(game.pendingPayment.source, "effectPlay");
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.ANY, amount: 1, allowedDomains: [DOMAINS.CALM, DOMAINS.BODY] }]);
  assert.equal(togglePaymentRune(game, "trash-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(["fizz-energy-one", "fizz-energy-two", "fizz-power", "trash-power"]
    .filter((id) => player.runeDeck.some((card) => card.instanceId === id)).length, 2);
  assert.equal(game.pendingChoice.effect, "splitDamageAllocation");
  assert.equal(chooseEffectOption(game, game.pendingChoice.options[0].id).ok, true);

  assert.equal(player.mainDeck.at(-1).instanceId, "fizz-alpha");
  assert.equal(player.trash.some((card) => card.instanceId === "fizz-alpha"), false);
});

test("fizz skips payment for a trash spell with no power cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "fizz-gust-target");
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.fizzTrickster, player.id, "zero-cost-fizz")];
  player.trash = [instance(cards.gust, player.id, "zero-cost-gust")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r1"),
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r2"),
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r3"),
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r4")
  ];

  assert.equal(playCard(game, "zero-cost-fizz", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashSpell");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["zero-cost-gust"]);
  assert.equal(chooseEffectOption(game, "zero-cost-gust").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "fizz-gust-target").ok, true);
  assert.equal(game.pendingPayment.source, "effectPlay");
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "fizz-gust-target"), true);
  assert.equal(player.mainDeck.at(-1).instanceId, "zero-cost-gust");
});

test("reinforce shows every looked-at card before the player chooses a unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const reinforce = instance({ ...cards.reinforce, energy: 0, power: [] }, player.id, "inspect-reinforce");
  const unit = instance(cards.lonelyPoro, player.id, "inspect-reinforce-unit");
  const otherCards = [
    instance(cards.gust, player.id, "inspect-reinforce-1"),
    instance(cards.charm, player.id, "inspect-reinforce-2"),
    instance(cards.flash, player.id, "inspect-reinforce-3"),
    instance(cards.eclipse, player.id, "inspect-reinforce-4")
  ];
  player.hand = [reinforce];
  player.mainDeck = [otherCards[0], unit, ...otherCards.slice(1)];

  assert.equal(playCard(game, reinforce.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playLookedAtUnit");
  assert.equal(game.pendingChoice.data.revealedCards.length, 5);
  assert.deepEqual(game.pendingChoice.options.filter((option) => option.cardId).map((option) => option.cardId), [unit.instanceId]);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), false);

  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(otherCards.every((card) => player.mainDeck.some((candidate) => candidate.instanceId === card.instanceId)), true);
});

test("look effects resolve every observed top-deck self ability before presenting their own choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const reinforce = instance({ ...cards.reinforce, energy: 0, power: [] }, player.id, "observed-reinforce");
  const nocturne = instance(cards.nocturneHorrifying, player.id, "reinforce-nocturne");
  const unit = instance(cards.lonelyPoro, player.id, "reinforce-following-unit");
  player.hand = [reinforce];
  player.mainDeck = [nocturne, unit, instance(cards.gust, player.id, "reinforce-filler")];
  player.runes = [];

  assert.equal(playCard(game, reinforce.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "observedTopDeckSelfAbility");
  assert.equal(chooseEffectOption(game, "banish").ok, true);
  assert.equal(player.banished.some((card) => card.instanceId === nocturne.instanceId), true);
  assert.equal(game.pendingChoice?.effect, "playLookedAtUnit");
  assert.deepEqual(game.pendingChoice.options.filter((option) => option.cardId).map((option) => option.cardId), [unit.instanceId]);
});

test("blind fury waits for the player to inspect and choose a revealed opponent card", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const blindFury = instance({ ...cards.blindFury, energy: 0, power: [] }, player.id, "inspect-blind-fury");
  const revealed = instance(cards.lonelyPoro, opponent.id, "inspect-opponent-top");
  player.hand = [blindFury];
  opponent.mainDeck = [revealed];

  assert.equal(playCard(game, blindFury.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playRevealedOpponentTopDeck");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, revealed.instanceId);
  assert.equal(player.base.some((card) => card.instanceId === revealed.instanceId), false);
  assert.equal(opponent.mainDeck[0]?.instanceId, revealed.instanceId,
    "the opponent's revealed top card remains in its original zone during the choice");

  assert.equal(chooseEffectOption(game, revealed.instanceId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === revealed.instanceId), true);
  assert.deepEqual(game.banishEvents.at(-1).destinations, [{
    cardId: revealed.instanceId,
    ownerId: opponent.id,
    ceasedToExist: false
  }]);
  assert.equal(game.banishEvents.at(-1).responsiblePlayerId, player.id);
});

test("Banish uses the owner's zone and linked event before a later instructed play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const future = instance(cards.promisingFuture, player.id, "banish-promising-future");
  const opponentCard = instance(cards.annieFiery, opponent.id, "banish-opponent-card");
  const playerCard = instance(cards.lonelyPoro, player.id, "banish-player-card");
  opponent.mainDeck = [opponentCard];
  player.mainDeck = [playerCard];
  opponent.runes = [];
  player.runes = [];

  assert.equal(resolveEffect(game, player, future), true);
  assert.equal(game.pendingChoice?.effect, "promisingFutureChoose");
  assert.equal(game.pendingChoice.playerId, player.id,
    "players choose starting with the turn player");
  assert.equal(chooseEffectOption(game, playerCard.instanceId).ok, true);

  assert.equal(player.mainDeck.some((card) => card.instanceId === playerCard.instanceId), false);
  assert.equal(player.banished.some((card) => card.instanceId === playerCard.instanceId), true);
  assert.equal(opponent.banished.some((card) => card.instanceId === playerCard.instanceId), false);
  assert.deepEqual(game.banishEvents.at(-1).cardIds, [playerCard.instanceId]);
  assert.equal(game.banishEvents.at(-1).responsiblePlayerId, player.id);
  assert.equal(game.pendingChoice?.effect, "promisingFutureChoose");
  assert.equal(game.pendingChoice.playerId, opponent.id);
});

test("Promising Future finalizes instructed plays from the next player and lets each decline Power", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const future = instance(cards.promisingFuture, player.id, "vendetta-promising-future");
  const playerCard = instance(cards.annieFiery, player.id, "vendetta-player-card");
  const opponentCard = instance(cards.annieFiery, opponent.id, "vendetta-opponent-card");
  player.mainDeck = [playerCard];
  opponent.mainDeck = [opponentCard];
  player.runes = [rune(DOMAINS.FURY, player.id, "vendetta-player-power")];
  opponent.runes = [rune(DOMAINS.FURY, opponent.id, "vendetta-opponent-power")];

  assert.equal(resolveEffect(game, player, future), true);
  assert.equal(chooseEffectOption(game, playerCard.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, opponentCard.instanceId).ok, true);

  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.playerId, opponent.id,
    "the next player's instructed play finalizes first");
  assert.equal(game.pendingPayment?.cardId, opponentCard.instanceId);
  assert.equal(cancelPayment(game).ok, true);
  assert.equal(opponent.banished.some((card) => card.instanceId === opponentCard.instanceId), true);
  assert.equal(opponent.runes[0].instanceId, "vendetta-opponent-power");

  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.playerId, player.id);
  assert.equal(game.pendingPayment?.cardId, playerCard.instanceId);
  assert.equal(cancelPayment(game).ok, true);
  assert.equal(player.banished.some((card) => card.instanceId === playerCard.instanceId), true);
  assert.equal(player.runes[0].instanceId, "vendetta-player-power");
});

test("the harrowing plays a trash unit after paying its power cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const harrowing = instance({ ...cards.theHarrowing, energy: 0, power: [] }, player.id, "test-harrowing");
  const trashUnit = instance(cards.rengarTrophyHunter, player.id, "harrowing-rengar");
  player.hand = [harrowing];
  player.trash = [trashUnit];
  player.runes = [rune(DOMAINS.BODY, player.id, "harrowing-power")];

  assert.equal(playCard(game, "test-harrowing", "base").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "harrowing-rengar"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "harrowing-rengar"), false);
  assert.equal(player.runes.some((card) => card.instanceId === "harrowing-power"), false);
  assert.equal(player.runeDeck.some((card) => card.instanceId === "harrowing-power"), true);
});

test("spectral matron ignores the chosen trash unit's power cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const matron = instance({ ...cards.spectralMatron, energy: 0, power: [] }, player.id, "test-matron");
  const trashUnit = instance({ ...cards.rengarTrophyHunter, energy: 3 }, player.id, "matron-rengar");
  player.hand = [matron];
  player.trash = [trashUnit];
  player.runes = [];

  assert.equal(playCard(game, "test-matron", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashUnit");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["matron-rengar"]);

  assert.equal(chooseEffectOption(game, "matron-rengar").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "matron-rengar"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "matron-rengar"), false);
});

test("kadregrin draws for each friendly mighty unit when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const kadregrin = instance({ ...cards.kadregrinTheInfernal, energy: 0, power: [] }, player.id, "test-kadregrin");
  const mighty = instance(cards.rengarTrophyHunter, player.id, "mighty-friend");
  const small = instance(cards.lonelyPoro, player.id, "small-friend");
  mighty.mightModifier = 2;
  player.hand = [kadregrin];
  player.base = [mighty, small];
  player.mainDeck = [
    instance(cards.gust, player.id, "kadregrin-draw-one"),
    instance(cards.charm, player.id, "kadregrin-draw-two"),
    instance(cards.flash, player.id, "kadregrin-draw-three")
  ];

  assert.equal(playCard(game, "test-kadregrin", "base").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.deepEqual(player.hand.map((card) => card.instanceId), ["kadregrin-draw-one", "kadregrin-draw-two"]);
});

test("brynhir prevents opponents from playing cards for the rest of the turn", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.hand = [instance(cards.brynhirThundersong, player.id, "explicit-brynhir")];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.FURY, player.id, `brynhir-rune-${index}`));
  opponent.hand = [instance(cards.lonelyPoro, opponent.id, "brynhir-blocked-poro")];
  opponent.runes = [rune(DOMAINS.CALM, opponent.id, "brynhir-opponent-rune")];

  assert.equal(playCard(game, "explicit-brynhir", "base").ok, true);
  game.currentPlayerId = opponent.id;

  assert.equal(playCard(game, "brynhir-blocked-poro", "base").ok, false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "brynhir-blocked-poro"), true);
});

test("sona readies up to four friendly runes at end of turn while at a battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const sona = instance(cards.sonaHarmonious, player.id, "explicit-sona");
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [sona];
  player.runes = Array.from({ length: 5 }, (_, index) => {
    const item = rune(DOMAINS.CALM, player.id, `sona-rune-${index}`);
    item.exhausted = true;
    return item;
  });

  assert.equal(endTurn(game).ok, true);

  assert.equal(player.runes.filter((candidate) => !candidate.exhausted).length, 4);
});

test("sona chooses rune targets while its end-turn trigger finalizes", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const sona = instance(cards.sonaHarmonious, player.id, "finalize-target-sona");
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [sona];
  player.runes = Array.from({ length: 3 }, (_, index) => {
    const item = rune(DOMAINS.CALM, player.id, `finalize-target-rune-${index}`);
    item.exhausted = true;
    return item;
  });

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "readyRune");
  assert.equal(chooseEffectOption(game, "finalize-target-rune-0").ok, true);
  assert.equal(chooseEffectOption(game, "finalize-target-rune-1").ok, true);
  assert.equal(chooseEffectOption(game, "finish-ready-runes").ok, true);

  assert.equal(player.runes.every((candidate) => candidate.exhausted), true,
    "declaring the targets does not resolve the ready instruction");
  const sonaTrigger = game.actionChain?.chain.find((item) => item.trigger?.sourceCardId === sona.instanceId)?.trigger;
  assert.deepEqual(sonaTrigger?.data?.declaredTargets.map((target) => target.targetId),
    ["finalize-target-rune-0", "finalize-target-rune-1"]);
});

test("stunned status expires before end-of-turn triggered abilities enter the chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sona = instance(cards.sonaHarmonious, player.id, "ending-step-sona");
  const stunned = instance(cards.ravenbloomStudent, player.id, "ending-step-stunned");
  stunned.stunned = true;
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [sona];
  player.base = [stunned];
  player.runes = [rune(DOMAINS.CALM, player.id, "ending-step-own-rune")];
  player.runes[0].exhausted = true;
  opponent.hand = [instance(cards.gust, opponent.id, "ending-step-response")];
  opponent.runes = [rune(DOMAINS.CALM, opponent.id, "ending-step-response-rune")];

  assert.equal(endTurn(game).ok, true);
  assert.ok(game.actionChain, "the end-turn trigger should still be waiting on the chain");
  assert.equal(stunned.stunned, false);
});

test("blitzcrank may move an enemy unit to his battlefield when played there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const blitzcrank = instance({ ...cards.blitzcrankImpassive, energy: 0, power: [] }, player.id, "explicit-blitzcrank");
  const enemy = instance(cards.lonelyPoro, opponent.id, "blitzcrank-enemy");
  field.controlledBy = player.id;
  player.hand = [blitzcrank];
  opponent.base = [enemy];

  assert.equal(playCard(game, "explicit-blitzcrank", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "moveUnitToSourceBattlefield");

  assert.equal(chooseEffectOption(game, "blitzcrank-enemy").ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === "blitzcrank-enemy"), false);
  assert.equal(field.units.some((card) => card.instanceId === "blitzcrank-enemy"), true);
});

test("an effect that moves an enemy unit attributes the Move to the effect controller", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const destination = game.battlefields[0];
  const observerField = game.battlefields[1];
  const blitzcrank = instance({ ...cards.blitzcrankImpassive, energy: 0, power: [] }, player.id, "responsible-blitzcrank");
  const merchant = instance(cards.travelingMerchant, opponent.id, "responsible-merchant");
  const volibear = instance(cards.volibearImposing, opponent.id, "responsible-volibear");
  destination.controlledBy = player.id;
  observerField.controlledBy = opponent.id;
  observerField.units = [volibear];
  player.hand = [blitzcrank];
  opponent.base = [merchant];
  opponent.hand = [instance(cards.lonelyPoro, opponent.id, "responsible-discard")];
  opponent.mainDeck = [
    instance(cards.charm, opponent.id, "responsible-observer-draw"),
    instance(cards.flash, opponent.id, "responsible-merchant-draw")
  ];

  assert.equal(playCard(game, blitzcrank.instanceId, destination.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(chooseEffectOption(game, merchant.instanceId).ok, true);

  const moveEvent = game.moveEvents.at(-1);
  assert.equal(moveEvent.cardId, merchant.instanceId);
  assert.equal(moveEvent.responsiblePlayerId, player.id,
    "the player resolving Blitzcrank's effect is responsible even though the opponent controls the moved unit");
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.equal(game.pendingChoice?.playerId, opponent.id,
    "the moved unit and observer triggers remain controlled by their sources' controller");
  assert.deepEqual(new Set(game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder).map((option) => option.cardId)),
    new Set([merchant.instanceId, volibear.instanceId]));
});

test("blitzcrank returns to hand when he holds a battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const blitzcrank = instance(cards.blitzcrankImpassive, player.id, "holding-blitzcrank");
  field.controlledBy = player.id;
  field.units = [blitzcrank];

  startTurn(game);

  assert.equal(player.hand.some((card) => card.instanceId === "holding-blitzcrank"), true);
  assert.equal(field.units.some((card) => card.instanceId === "holding-blitzcrank"), false);
});

test("vi recycles one trash card to gain might without exhausting", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const vi = instance(cards.viDestructive, player.id, "explicit-vi");
  const keptTrash = instance(cards.charm, player.id, "vi-kept-trash");
  const recycledTrash = instance(cards.lonelyPoro, player.id, "vi-trash");
  const field = game.battlefields[0];
  field.units = [vi];
  field.controlledBy = player.id;
  player.base = [];
  player.trash = [keptTrash, recycledTrash];

  assert.equal(activateCard(game, "explicit-vi").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "explicit-vi").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedRecycleTrash");
  assert.equal(chooseEffectOption(game, recycledTrash.instanceId).ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);

  assert.equal(vi.mightModifier, 1);
  assert.equal(vi.exhausted, false);
  assert.deepEqual(player.trash.map((card) => card.instanceId), [keptTrash.instanceId]);
  assert.equal(player.mainDeck.some((card) => card.instanceId === recycledTrash.instanceId), true);
});

test("cancelling a battlefield activation payment removes its Pending Chain item", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const vi = instance(cards.viDestructive, player.id, "cancel-battlefield-vi");
  const trash = instance(cards.lonelyPoro, player.id, "cancel-battlefield-vi-trash");
  field.units = [vi];
  field.controlledBy = player.id;
  player.base = [];
  player.trash = [trash];

  assert.equal(activateCard(game, vi.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, vi.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, trash.instanceId).ok, true);
  assert.equal(game.pendingPayment?.source, "activatedAbility");
  assert.equal(cancelPayment(game).ok, true);

  assert.equal(game.pendingPayment, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.trash.some((card) => card.instanceId === trash.instanceId), true);
  assert.equal(vi.activationProcess, undefined);
});

test("Main Deck recycling uses each card owner and recycled tokens cease to exist", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const vi = instance(cards.viDestructive, player.id, "recycle-owner-vi");
  const foreignCard = instance(cards.lonelyPoro, opponent.id, "recycle-foreign-card");
  const tokenCard = instance(cards.lonelyPoro, player.id, "recycle-token-card");
  tokenCard.isToken = true;
  player.base = [vi];
  player.trash = [foreignCard, tokenCard];

  const recycleWithVi = (cardId) => {
    assert.equal(activateCard(game, vi.instanceId).ok, true);
    assert.equal(chooseEffectOption(game, vi.instanceId).ok, true);
    assert.equal(chooseEffectOption(game, cardId).ok, true);
    assert.equal(confirmPayment(game).ok, true);
  };

  recycleWithVi(foreignCard.instanceId);
  assert.equal(opponent.mainDeck.some((card) => card.instanceId === foreignCard.instanceId), true);
  assert.equal(player.mainDeck.some((card) => card.instanceId === foreignCard.instanceId), false);

  recycleWithVi(tokenCard.instanceId);
  assert.equal(player.trash.some((card) => card.instanceId === tokenCard.instanceId), false);
  assert.equal(player.mainDeck.some((card) => card.instanceId === tokenCard.instanceId), false);
  assert.equal(opponent.mainDeck.some((card) => card.instanceId === tokenCard.instanceId), false);
});

test("garbage grabber recycles trash and pays one energy to draw", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const grabber = instance(cards.garbageGrabber, player.id, "explicit-garbage-grabber");
  const drawn = instance(cards.flash, player.id, "garbage-draw");
  player.base = [grabber];
  player.mainDeck = [drawn];
  player.trash = [
    instance(cards.lonelyPoro, player.id, "garbage-trash-1"),
    instance(cards.charm, player.id, "garbage-trash-2"),
    instance(cards.gust, player.id, "garbage-trash-3")
  ];
  player.runes = [rune(DOMAINS.MIND, player.id, "garbage-rune")];

  assert.equal(activateCard(game, "explicit-garbage-grabber").ok, true);
  for (const cardId of ["garbage-trash-3", "garbage-trash-1", "garbage-trash-2"]) {
    assert.equal(game.pendingChoice.effect, "declareActivatedRecycleTrash");
    assert.equal(chooseEffectOption(game, cardId).ok, true);
  }
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, "garbage-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === "garbage-draw"), true);
  assert.equal(player.trash.length, 0);
  assert.equal(grabber.exhausted, true);
});

test("wraith of echoes draws only for the first other friendly unit death each turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const wraith = instance(cards.wraithOfEchoes, player.id, "explicit-wraith");
  const first = instance(cards.lonelyPoro, player.id, "wraith-first-victim");
  const second = instance(cards.scuttleCrab, player.id, "wraith-second-victim");
  player.base = [wraith, first, second];
  player.hand = [
    instance({ ...cards.vengeance, energy: 0, power: [] }, player.id, "wraith-vengeance-1"),
    instance({ ...cards.vengeance, energy: 0, power: [] }, player.id, "wraith-vengeance-2")
  ];
  player.mainDeck = [
    instance(cards.flash, player.id, "wraith-draw-1"),
    instance(cards.gust, player.id, "wraith-draw-2")
  ];

  assert.equal(beginPlayCard(game, "wraith-vengeance-1", "base").ok, true);
  assert.equal(chooseEffectOption(game, "wraith-first-victim").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "wraith-draw-1"), true);

  assert.equal(beginPlayCard(game, "wraith-vengeance-2", "base").ok, true);
  assert.equal(chooseEffectOption(game, "wraith-second-victim").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "wraith-draw-2"), false);
});

test("volibear imposing draws when an opponent moves to a different battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const volibear = instance(cards.volibearImposing, player.id, "explicit-volibear-imposing");
  const mover = instance(cards.lonelyPoro, opponent.id, "volibear-opponent-mover");
  const firstField = game.battlefields[0];
  const secondField = game.battlefields[1];
  firstField.controlledBy = player.id;
  firstField.units = [volibear];
  secondField.controlledBy = opponent.id;
  secondField.units = [];
  opponent.base = [mover];
  player.mainDeck = [instance(cards.flash, player.id, "volibear-draw")];
  game.turnPlayerId = opponent.id;
  game.currentPlayerId = opponent.id;

  assert.equal(moveUnit(game, "volibear-opponent-mover", secondField.instanceId).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === "volibear-draw"), true);
});

test("yasuo windrider scores on the third move in a turn", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const yasuo = instance(cards.yasuoWindrider, player.id, "explicit-yasuo-windrider");
  const [firstField, secondField] = game.battlefields;
  firstField.controlledBy = player.id;
  secondField.controlledBy = player.id;
  player.base = [yasuo];
  player.score = 0;

  assert.equal(moveUnit(game, "explicit-yasuo-windrider", firstField.instanceId).ok, true);
  assert.equal(player.score, 0);
  yasuo.exhausted = false;

  assert.equal(moveUnit(game, "explicit-yasuo-windrider", "base").ok, true);
  assert.equal(player.score, 0);
  yasuo.exhausted = false;

  assert.equal(moveUnit(game, "explicit-yasuo-windrider", secondField.instanceId).ok, true);
  assert.equal(player.score, 1);
});

test("ember monk gains might when a card is played from hidden", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const monk = instance(cards.emberMonk, player.id, "explicit-ember-monk");
  const hiddenSpell = instance(cards.consultThePast, player.id, "ember-hidden-consult");
  const enemy = instance(cards.lonelyPoro, opponent.id, "ember-enemy");
  field.controlledBy = player.id;
  field.units = [monk];
  player.hand = [hiddenSpell];
  player.runes = [rune(DOMAINS.MIND, player.id, "ember-hide-power")];

  hideWithRune(game, "ember-hidden-consult", field.instanceId, "ember-hide-power");
  game.turnSequence += 1;
  field.controlledBy = null;
  field.units = [monk, enemy];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, "ember-hidden-consult", field.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  let triggerPasses = 0;
  while (game.showdown && !game.pendingChoice && monk.mightModifier < 2 && triggerPasses < 8) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    triggerPasses += 1;
  }
  assert.equal(monk.mightModifier, 2);
  assert.equal(monk.temporaryMight, 2);
});

test("time warp grants an extra turn and banishes itself", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  player.hand = [instance(cards.timeWarp, player.id, "explicit-time-warp")];
  player.runes = Array.from({ length: 14 }, (_, index) => rune(DOMAINS.MIND, player.id, `time-warp-r${index}`));

  assert.equal(playCard(game, "explicit-time-warp", "base").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "explicit-time-warp"), false);
  assert.equal(player.banished.some((card) => card.instanceId === "explicit-time-warp"), true);

  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, player.id);
});

test("multiple Additional Turns resolve newest-first and then resume the untouched regular turn order", () => {
  const game = createGame();
  finishSetup(game);
  const regularPlayer = currentPlayer(game);
  const nextRegularPlayer = game.players.find((candidate) => candidate.id !== regularPlayer.id);

  assert.equal(scheduleAdditionalTurn(game, nextRegularPlayer.id), true);
  assert.equal(scheduleAdditionalTurn(game, regularPlayer.id), true);
  assert.deepEqual(game.additionalTurnQueue, [regularPlayer.id, nextRegularPlayer.id]);

  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, regularPlayer.id);
  assert.equal(game.currentTurnIsAdditional, true);

  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, nextRegularPlayer.id);
  assert.equal(game.currentTurnIsAdditional, true);

  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, nextRegularPlayer.id,
    "the queued extra turns do not consume or reorder the next regular turn");
  assert.equal(game.currentTurnIsAdditional, undefined);
});

test("convergent mutation increases a friendly unit to another friendly unit's might", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const low = instance(cards.lonelyPoro, player.id, "mutation-low");
  const high = instance(cards.lonelyPoro, player.id, "mutation-high");
  high.mightModifier = 4;
  player.base = [low, high];
  player.hand = [instance(cards.convergentMutation, player.id, "explicit-convergent-mutation")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.MIND, player.id, `mutation-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-convergent-mutation", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "mutation-low").ok, true);
  assert.equal(chooseEffectOption(game, "mutation-high").ok, true);
  assert.equal(togglePaymentRune(game, "mutation-r0", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "mutation-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "mutation-r2", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(low.mightModifier, 4);
  assert.equal(low.temporaryMight, 4);
});

test("portal rescue replays a friendly unit to base ignoring its cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, player.id, "portal-rescue-unit");
  const gear = instance(cards.guardianAngel, player.id, "portal-rescue-gear");
  unit.buffs = 1;
  unit.mightModifier = 1;
  unit.damage = 1;
  unit.attachments = [gear];
  gear.attachedToId = unit.instanceId;
  field.controlledBy = player.id;
  field.units = [unit];
  player.hand = [instance(cards.portalRescue, player.id, "explicit-portal-rescue")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.MIND, player.id, `portal-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-portal-rescue", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "portal-rescue-unit").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r0", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r2", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r3", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.some((candidate) => candidate.instanceId === "portal-rescue-unit"), false);
  assert.equal(player.base.some((candidate) => candidate.instanceId === "portal-rescue-unit"), true);
  assert.equal(player.base.some((candidate) => candidate.instanceId === "portal-rescue-gear"), true,
    "cleanup recalls Gear that detached at the Battlefield");
  assert.deepEqual(game.attachmentEvents?.at(-1), {
    id: "attachment-1",
    action: "detach",
    attachedCardId: "portal-rescue-gear",
    topMostCardId: "portal-rescue-unit",
    destinationType: "battlefield",
    destinationId: field.instanceId,
    turnSequence: game.turnSequence
  });
  assert.equal(unit.buffs, 0);
  assert.equal(unit.mightModifier, 0);
  assert.equal(unit.damage, 0);
  assert.equal(unit.exhausted, true);
});

test("miss fortune captain readies another exhausted friendly card only on her first move each turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const missFortune = instance(cards.missFortuneCaptain, player.id, "explicit-miss-fortune");
  const ally = instance(cards.lonelyPoro, player.id, "miss-fortune-ally");
  ally.exhausted = true;
  field.controlledBy = player.id;
  player.base = [missFortune, ally];

  assert.equal(moveUnit(game, "explicit-miss-fortune", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "readyAnotherExhausted");
  assert.equal(chooseEffectOption(game, "miss-fortune-ally").ok, true);
  assert.equal(ally.exhausted, false);
  assert.equal(field.units.some((unit) => unit.instanceId === "explicit-miss-fortune"), true);

  missFortune.exhausted = false;
  ally.exhausted = true;
  assert.equal(moveUnit(game, "explicit-miss-fortune", "base").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(ally.exhausted, true);
});

test("Miss Fortune Captain enters ready only when her Body Accelerate cost is selected and paid", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const missFortune = instance(cards.missFortuneCaptain, player.id, "accelerated-miss-fortune");
  player.hand = [missFortune];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `mf-accelerate-r${index}`));

  assert.equal(beginPlayCard(game, missFortune.instanceId, "base").ok, true);
  const accelerate = game.pendingPayment.optionalPowerEffects.find((effect) => effect.kind === "accelerate");
  assert.equal(accelerate.domain, DOMAINS.BODY);
  assert.equal(toggleOptionalPaymentEffect(game, accelerate.id).ok, true);
  assert.equal(game.pendingPayment.energyCost, 6);
  for (const runeId of ["mf-accelerate-r0", "mf-accelerate-r1", "mf-accelerate-r2", "mf-accelerate-r3", "mf-accelerate-r4", "mf-accelerate-r5"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "mf-accelerate-r4", "power").ok, true);
  assert.equal(togglePaymentRune(game, "mf-accelerate-r5", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.find((card) => card.instanceId === missFortune.instanceId)?.exhausted, false);
});

test("Accelerate derives exactly one Power from Domain identity instead of reminder text", () => {
  const requirementFor = (domains, id) => {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    player.hand = [instance({
      ...cards.lonelyPoro,
      id: `TEST-ACCELERATE-${id}`,
      cardNumber: `TEST-ACCELERATE-${id}/001`,
      collectorNumber: `TEST-ACCELERATE-${id}/001`,
      name: `Rules Test Accelerate ${id}`,
      domains,
      keywords: ["Accelerate", "Accelerate"],
      text: "Accelerate (You may pay 9 Fury.)",
      energy: 0,
      power: [],
      effects: []
    }, player.id, `accelerate-${id}`)];
    assert.equal(beginPlayCard(game, `accelerate-${id}`, "base").ok, true);
    const accelerate = game.pendingPayment.optionalPowerEffects.filter((effect) => effect.kind === "accelerate");
    assert.equal(accelerate.length, 1, "multiple Accelerate instances are redundant");
    assert.equal(accelerate[0].energyCost, 1);
    assert.equal(accelerate[0].requirements[0].amount, 1);
    return accelerate[0].requirements[0].domain;
  };

  assert.equal(requirementFor([DOMAINS.BODY], "single"), DOMAINS.BODY);
  assert.equal(requirementFor([DOMAINS.BODY, DOMAINS.CALM], "multi"), DOMAINS.ANY);
  assert.equal(requirementFor([], "domainless"), DOMAINS.ANY);
});

test("Seal of Strength adds the Body Power needed to play Miss Fortune Captain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const seal = instance(cards.sealOfStrength, player.id, "miss-fortune-seal");
  const missFortune = instance(cards.missFortuneCaptain, player.id, "sealed-miss-fortune");
  player.base = [seal];
  player.hand = [missFortune];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.BODY, player.id, `mf-seal-r${index}`));

  assert.equal(beginPlayCard(game, missFortune.instanceId, "base").ok, true);
  assert.equal(activateCard(game, seal.instanceId).ok, true);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(player.runePool.power[0].domain, DOMAINS.BODY);
  const generatedPowerId = player.runePool.power[0].id;
  assert.equal(enumerateLegalActions(game, player.id).some((action) =>
    action.kind === "togglePaymentPoolPower" && action.powerId === generatedPowerId), true,
  "generated Power must cross the same legal-command boundary as the payment UI");
  assert.equal(applyGameCommand({ game, hostPlayerId: player.id }, player.id, {
    kind: "togglePaymentPoolPower",
    powerId: generatedPowerId
  }).ok, true);
  for (const runeCard of player.runes) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === missFortune.instanceId), true);
});

test("online authorization and AI payment planning allow Add Energy during payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const addSource = instance(cards.energyConduit, player.id, "planned-payment-energy-conduit");
  const card = instance({ ...cards.lonelyPoro, energy: 1, power: [] }, player.id, "planned-payment-card");
  player.base = [addSource];
  player.hand = [card];
  player.runes = [];

  const play = { kind: "beginPlayCard", cardId: card.instanceId, destination: "base" };
  assert.deepEqual(resolveLegalAction(game, play, player.id), play,
    "online authorization must not reject a legal payment window based on a planner limitation");
  assert.equal(enumerateLegalActions(game, player.id).some((action) =>
    action.kind === play.kind && action.cardId === play.cardId && action.destination === play.destination), true);
  assert.equal(applyAiAction(game, play, player.id).ok, true);

  let firstPaymentAction = true;
  for (let step = 0; game.pendingPayment && step < 6; step += 1) {
    const plan = planPaymentActions(game);
    assert.ok(plan);
    if (firstPaymentAction) {
      assert.equal(plan[0].kind, "activateCard");
      assert.equal(plan[0].cardId, addSource.instanceId);
      firstPaymentAction = false;
    }
    const result = applyAiAction(game, plan[0], player.id);
    assert.equal(result.ok, true, `${JSON.stringify(plan[0])}: ${result.message || "failed"}`);
  }

  assert.equal(game.pendingPayment, null);
  assert.equal(player.base.some((candidate) => candidate.instanceId === card.instanceId), true);
  assert.equal(addSource.exhausted, true);
});

test("Teemo Swift Scout returns an owned Teemo from the Champion Zone or board to hand", () => {
  for (const origin of ["champion", "board"]) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const legend = instance(cards.teemoSwiftScout, player.id, `teemo-return-legend-${origin}`);
    const target = instance(cards.teemoScout, player.id, `teemo-return-target-${origin}`);
    target.tags = [...new Set([...(target.tags || []), "Teemo"])];
    target.zone = origin === "champion" ? "champion" : "played";
    player.legend = legend;
    player.champion = target;
    player.championPlayed = origin === "board";
    player.base = origin === "board" ? [target] : [];
    if (origin === "board") {
      target.mightModifier = 3;
      target.temporaryMight = 3;
    }
    player.runes = [rune(DOMAINS.MIND, player.id, `teemo-return-rune-${origin}`)];

    assert.equal(activateCard(game, legend.instanceId).ok, true);
    assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
    assert.equal(game.pendingChoice.options.some((option) => option.cardId === target.instanceId), true,
      `the Teemo in the ${origin} zone must be a legal target`);
    assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
    assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "energy").ok, true);
    assert.equal(confirmPayment(game).ok, true);

    assert.equal(player.champion, null);
    assert.equal(player.championPlayed, false);
    assert.equal(player.base.some((candidate) => candidate.instanceId === target.instanceId), false);
    assert.equal(player.hand.some((candidate) => candidate.instanceId === target.instanceId), true,
      `the Teemo from the ${origin} zone must move to hand`);
    assert.equal(target.mightModifier, 0);
    assert.equal(target.temporaryMight, undefined);
  }
});

test("Ember Monk and Noxus Saboteur do not count as printed Hidden cards for Teemo", () => {
  assert.equal(cards.emberMonk.keywords.includes("Hidden"), false);
  assert.equal(cards.noxusSaboteur.keywords.includes("Hidden"), false);
});

test("activated ability targeting opens an explicit Deflect rune choice", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const ballista = instance(cards.ironBallista, player.id, "explicit-deflect-ballista");
  const target = instance(cards.lonelyPoro, opponent.id, "explicit-deflect-target");
  target.keywords = ["Deflect"];
  target.might = 5;
  const chosenRune = rune(DOMAINS.FURY, player.id, "explicit-deflect-chosen-rune");
  const preservedRune = rune(DOMAINS.MIND, player.id, "explicit-deflect-preserved-rune");
  player.base = [ballista];
  player.runes = [chosenRune, preservedRune];
  player.runeDeck = [];
  game.battlefields[0].units = [target];
  game.battlefields[0].controlledBy = opponent.id;

  const activation = activateCard(game, ballista.instanceId);
  assert.equal(activation.ok, true, activation.message);
  assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "payDeflect");
  assert.deepEqual(player.runes.map((candidate) => candidate.instanceId), [chosenRune.instanceId, preservedRune.instanceId],
    "declaring the target must not auto-select a Power source");

  assert.equal(chooseEffectOption(game, chosenRune.instanceId).ok, true);
  assert.equal(ballista.exhausted, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === chosenRune.instanceId), false);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === preservedRune.instanceId), true);
  assert.equal(player.runeDeck.at(-1)?.instanceId, chosenRune.instanceId);
  assert.equal(target.damage, 0, "the finalized activation still waits on the normal action Chain");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(target.damage, 2, game.log.join("\n"));
});

test("explicit Deflect payment can spend generated Power", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const ballista = instance(cards.ironBallista, player.id, "generated-deflect-ballista");
  const target = instance(cards.lonelyPoro, opponent.id, "generated-deflect-target");
  target.keywords = ["Deflect"];
  player.base = [ballista];
  player.runes = [];
  player.runePool.power = [{
    id: "generated-deflect-power",
    instanceId: "generated-deflect-power",
    type: "power",
    domain: DOMAINS.ANY,
    sourceName: "Generated Power",
    expiresAt: "endOfTurn"
  }];
  game.battlefields[0].units = [target];
  game.battlefields[0].controlledBy = opponent.id;

  assert.equal(activateCard(game, ballista.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "payDeflect");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["generated-deflect-power"]);
  assert.equal(chooseEffectOption(game, "generated-deflect-power").ok, true);
  assert.equal(player.runePool.power.length, 0);
  assert.equal(ballista.exhausted, true);
});

test("selected generated Energy can always be deselected without making an implicit payment choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const card = instance({ ...cards.lonelyPoro, energy: 1, power: [] }, player.id, "pool-deselect-card");
  player.hand = [card];
  player.runePool.energy = [{
    id: "pool-deselect-energy",
    type: "energy",
    domains: [DOMAINS.BODY],
    sourceName: cards.energyConduit.name,
    restriction: null
  }];

  assert.equal(beginPlayCard(game, card.instanceId, "base").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, "pool-deselect-energy").ok, true);
  assert.deepEqual(game.pendingPayment.poolEnergyIds, ["pool-deselect-energy"]);
  assert.equal(legalPaymentPoolEnergyOptions(game)[0].canToggle, true);
  assert.equal(togglePaymentPoolEnergy(game, "pool-deselect-energy").ok, true);
  assert.deepEqual(game.pendingPayment.poolEnergyIds, []);
});

test("generated resources declare Energy, Power, and restrictions through shared Add effects", () => {
  const unrestrictedEnergy = [
    cards.energyConduit,
    cards.dariusHandOfNoxus,
    cards.dariusHandOfNoxus2,
    cards.dariusHandOfNoxus3
  ];
  for (const card of unrestrictedEnergy) {
    const effect = card.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addEnergy");
    assert.ok(effect, `${card.name} should use addEnergy`);
    assert.equal(effect.restriction, null, `${card.name} Energy should be unrestricted`);
  }

  for (const card of [
    cards.sealOfDiscord,
    cards.sealOfFocus,
    cards.sealOfInsight,
    cards.sealOfRage,
    cards.sealOfStrength,
    cards.sealOfUnity,
    cards.malzaharFanatic
  ]) {
    const effect = card.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addPower");
    assert.ok(effect, `${card.name} should use addPower`);
    assert.equal(effect.restriction || null, null, `${card.name} Power should be unrestricted`);
  }

  for (const card of [cards.kaiSaDaughterOfTheVoid, cards.kaiSaDaughterOfTheVoid2, cards.kaiSaDaughterOfTheVoid3]) {
    const effect = card.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addPower");
    assert.equal(effect?.restriction, "spell");
  }
  const dianaEffect = cards.dianaScornOfTheMoon.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addEnergy");
  assert.equal(dianaEffect?.restriction, "showdown");
});

test("Miss Fortune Captain can pay Accelerate from the Champion Zone", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.champion = instance(cards.missFortuneCaptain, player.id, "champion-zone-miss-fortune");
  player.champion.zone = "champion";
  player.championPlayed = false;
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `mf-champion-r${index}`));

  assert.equal(beginPlayChampion(game, "base").ok, true);
  const accelerate = game.pendingPayment.optionalPowerEffects.find((effect) => effect.kind === "accelerate");
  assert.equal(accelerate.domain, DOMAINS.BODY);
  assert.equal(toggleOptionalPaymentEffect(game, accelerate.id).ok, true);
  assert.equal(game.pendingPayment.energyCost, 6);
  for (const runeId of ["mf-champion-r0", "mf-champion-r1", "mf-champion-r2", "mf-champion-r3", "mf-champion-r4", "mf-champion-r5"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "mf-champion-r4", "power").ok, true);
  assert.equal(togglePaymentRune(game, "mf-champion-r5", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.find((card) => card.instanceId === "champion-zone-miss-fortune")?.exhausted, false);
});

test("Volibear legend trigger opens an action chain and asks before exhausting", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.legend = instance(cards.volibearRelentlessStorm, player.id, "volibear-chain-legend");
  const mighty = instance(cards.lonelyPoro, player.id, "volibear-mighty-unit");
  mighty.energy = 0;
  mighty.power = [];
  mighty.might = 5;
  player.hand = [mighty, instance({
    ...cards.charm,
    id: "TEST-VOLIBEAR-CONTROLLER-REACTION",
    cardNumber: "TEST-VOLIBEAR-CONTROLLER-REACTION/001",
    collectorNumber: "TEST-VOLIBEAR-CONTROLLER-REACTION/001",
    name: "Rules Test Volibear Controller Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, player.id, "volibear-controller-reaction")];
  const responseUnit = instance(cards.lonelyPoro, opponent.id, "volibear-response-unit");
  game.battlefields[0].units = [responseUnit];
  game.battlefields[0].controlledBy = opponent.id;
  opponent.hand = [instance(cards.flash, opponent.id, "volibear-chain-response")];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "volibear-response-r1"),
    rune(DOMAINS.CHAOS, opponent.id, "volibear-response-r2")
  ];

  assert.equal(beginPlayCard(game, mighty.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(game.actionChain?.chain.length || 0, 0);
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.ok(game.actionChain);
  assert.equal(game.actionChain.chain[0].itemType, "trigger");
  assert.equal(game.actionChain.chain[0].status, "pending");
  assert.equal(game.actionChain.chain[0].playOptions.declarationsComplete, false);
  assert.equal(player.legend.exhausted, false);
  assert.equal(game.pendingChoice.effect, "declareTriggerCost");

  assert.equal(chooseEffectOption(game, "pay-trigger-cost").ok, true);
  assert.equal(player.legend.exhausted, true);
  assert.equal(game.actionChain.chain[0].status, "finalized");
  assert.equal(game.actionChain.priorityPlayerId, player.id);
  assert.equal(game.pendingChoice, null);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
});

test("whirlwind lets each player return a unit to hand starting with the next player", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const friendly = instance(cards.lonelyPoro, player.id, "whirlwind-friendly");
  const enemy = instance(cards.lonelyPoro, opponent.id, "whirlwind-enemy");
  player.base = [friendly];
  opponent.base = [enemy];
  player.hand = [instance(cards.whirlwind, player.id, "explicit-whirlwind")];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `whirlwind-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-whirlwind", "base").ok, true);
  for (const runeId of ["whirlwind-r0", "whirlwind-r1", "whirlwind-r2", "whirlwind-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "whirlwind-r4", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "eachPlayerReturnUnitToHand");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(chooseEffectOption(game, "whirlwind-enemy").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "whirlwind-enemy"), true);
  assert.equal(game.pendingChoice.playerId, player.id);
  assert.equal(chooseEffectOption(game, "whirlwind-friendly").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "whirlwind-friendly"), true);
});

test("party favors lets the opponent choose cards so both players draw", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.hand = [instance(cards.partyFavors, player.id, "explicit-party-favors")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `party-r${index}`));
  player.mainDeck = [instance(cards.flash, player.id, "party-player-draw")];
  opponent.mainDeck = [instance(cards.flash, opponent.id, "party-opponent-draw")];

  assert.equal(beginPlayCard(game, "explicit-party-favors", "base").ok, true);
  for (const runeId of ["party-r0", "party-r1", "party-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "partyFavors");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(chooseEffectOption(game, "cards").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "party-player-draw"), true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "party-opponent-draw"), true);
});

test("get excited discards a card and deals its energy as damage", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.missFortuneCaptain, opponent.id, "get-excited-target");
  field.controlledBy = opponent.id;
  field.units = [target];
  player.hand = [
    instance(cards.getExcited, player.id, "explicit-get-excited"),
    instance(cards.portalRescue, player.id, "get-excited-discard")
  ];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.FURY, player.id, `get-excited-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-get-excited", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "get-excited-target").ok, true);
  assert.equal(togglePaymentRune(game, "get-excited-r0", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "get-excited-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "get-excited-r2", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "discardEnergyDamage");

  assert.equal(chooseEffectOption(game, "get-excited-discard").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(target.damage, 3);
  assert.equal(player.trash.some((card) => card.instanceId === "get-excited-discard"), true);
});

test("karthus eternal makes friendly deathknell trigger an additional time", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const karthus = instance(cards.karthusEternal, player.id, "explicit-karthus");
  const poro = instance(cards.lonelyPoro, player.id, "karthus-poro");
  field.units = [poro];
  field.controlledBy = player.id;
  player.base = [karthus];
  player.mainDeck = [
    instance(cards.flash, player.id, "karthus-draw-1"),
    instance(cards.flash, player.id, "karthus-draw-2")
  ];
  player.hand = [instance(cards.uncheckedPower, player.id, "karthus-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `karthus-r${index}`));

  assert.equal(playCard(game, "karthus-boardwipe", "base").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "karthus-draw-1"), true);
  assert.equal(player.hand.some((card) => card.instanceId === "karthus-draw-2"), true);
});

test("sett the boss saves a buffed friendly unit by paying a rune and spending its buff", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const sett = instance(cards.settTheBoss, player.id, "explicit-sett-boss");
  const unit = instance(cards.lonelyPoro, player.id, "sett-saved-unit");
  unit.buffs = 1;
  field.units = [unit];
  field.controlledBy = player.id;
  player.legend = sett;
  player.runes = [rune(DOMAINS.BODY, player.id, "sett-save-rune")];
  player.hand = [instance(cards.uncheckedPower, player.id, "sett-boardwipe")];
  player.runes.push(...Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `sett-wipe-r${index}`)));

  assert.equal(playCard(game, "sett-boardwipe", "base").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "sett-saved-unit"), false);
  assert.equal(player.base.some((card) => card.instanceId === "sett-saved-unit"), true);
  assert.equal(field.units.some((card) => card.instanceId === "sett-saved-unit"), false);
  assert.equal(unit.buffs, 0);
  assert.equal(unit.damage, 0);
  assert.equal(unit.exhausted, true);
  assert.equal(sett.exhausted, true);
  assert.equal(player.runeDeck.some((card) => card.instanceId === "sett-save-rune"), true);
});

test("sett's optional death replacement can be explicitly declined", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const sett = instance(cards.settTheBoss, player.id, "decline-sett-boss");
  const unit = instance(cards.lonelyPoro, player.id, "decline-sett-unit");
  unit.buffs = 1;
  field.units = [unit];
  field.controlledBy = player.id;
  player.legend = sett;
  player.runes = [
    rune(DOMAINS.BODY, player.id, "decline-sett-save-rune"),
    ...Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `decline-sett-wipe-rune-${index}`))
  ];
  player.hand = [instance(cards.uncheckedPower, player.id, "decline-sett-wipe")];

  assert.equal(playCard(game, "decline-sett-wipe", "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource");
  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(sett.exhausted, false);
  assert.equal(player.runes.some((card) => card.instanceId === "decline-sett-save-rune"), true);
});

test("a mandatory card replacement applies automatically even when the affected unit has a different owner", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const controller = currentPlayer(game);
  const owner = game.players.find((player) => player.id !== controller.id);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, owner.id, "decline-zhonya-unit");
  unit.controllerId = controller.id;
  const zhonya = instance(cards.zhonyasHourglass, controller.id, "decline-zhonya-source");
  field.units = [unit];
  field.controlledBy = controller.id;
  controller.base = [zhonya];
  controller.hand = [instance({ ...cards.uncheckedPower, energy: 0, power: [] }, controller.id, "decline-zhonya-wipe")];

  assert.equal(playCard(game, "decline-zhonya-wipe", "base").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(owner.trash.some((card) => card.instanceId === unit.instanceId), false);
  assert.equal(controller.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(controller.trash.some((card) => card.instanceId === zhonya.instanceId), true);
});

test("the affected object's owner orders multiple mandatory replacement effects", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const controller = currentPlayer(game);
  const owner = game.players.find((player) => player.id !== controller.id);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, owner.id, "owner-orders-replacement-unit");
  unit.controllerId = controller.id;
  const first = instance(cards.zhonyasHourglass, controller.id, "owner-orders-replacement-first");
  const second = instance(cards.zhonyasHourglass, controller.id, "owner-orders-replacement-second");
  field.units = [unit];
  field.controlledBy = controller.id;
  controller.base = [first, second];
  controller.hand = [instance({ ...cards.uncheckedPower, energy: 0, power: [] }, controller.id, "owner-orders-replacement-wipe")];

  assert.equal(playCard(game, "owner-orders-replacement-wipe", "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource");
  assert.equal(game.pendingChoice?.playerId, owner.id);
  assert.equal(game.pendingChoice.options.some((option) => option.id === "decline"), false);
  assert.equal(chooseEffectOption(game, `card:${second.instanceId}`).ok, true);
  assert.equal(controller.trash.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(controller.base.some((card) => card.instanceId === unit.instanceId), true);
});

test("a replacement applies only once across the events that replace its original event", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const target = instance(cards.lonelyPoro, player.id, "replacement-chain-target");
  const first = instance({ ...cards.zhonyasHourglass, type: "unit", might: 1 }, player.id, "replacement-chain-first");
  const second = instance({ ...cards.zhonyasHourglass, type: "unit", might: 1 }, player.id, "replacement-chain-second");
  const third = instance({ ...cards.zhonyasHourglass, type: "unit", might: 1 }, player.id, "replacement-chain-third");
  const spell = instance({
    ...cards.vengeance,
    name: "Rules Test Replacement Chain",
    effects: [{
      timing: "spell",
      kind: "killUnit",
      target: "friendlyUnit",
      eventModifications: { ready: true, temporary: true }
    }]
  }, player.id, "replacement-chain-spell");
  player.base = [target, first, second, third];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource");
  assert.equal(chooseEffectOption(game, `card:${first.instanceId}`).ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource",
    "the replacement action opens its own ordered replacement sequence without losing the outer continuation");
  assert.equal(chooseEffectOption(game, `card:${second.instanceId}`).ok, true);

  assert.equal(player.base.some((card) => card.instanceId === target.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === first.instanceId), true,
    "the second replacement replaces the first source's death");
  assert.equal(player.base.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === third.instanceId), true,
    "the last unapplied replacement source dies");
  assert.deepEqual(first.lastReplacementEvent?.appliedReplacementKeys,
    [`card:${first.instanceId}`, `card:${second.instanceId}`]);
  assert.deepEqual(second.lastReplacementEvent?.appliedReplacementKeys,
    [`card:${first.instanceId}`, `card:${second.instanceId}`, `card:${third.instanceId}`]);
  assert.deepEqual(target.lastReplacementEvent?.appliedReplacementKeys, [`card:${first.instanceId}`]);
  for (const saved of [target, first, second]) {
    assert.equal(saved.exhausted, false, "a relevant ready modification is inherited by replacement events");
    assert.equal(saved.temporary, true, "a relevant Temporary modification is inherited by replacement events");
  }
});

test("a simultaneous replacement event can be declined without consuming its source", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance({ ...cards.lonelyPoro, might: 1, effects: [] }, player.id, "decline-event-first");
  const second = instance({ ...cards.lonelyPoro, might: 1, effects: [] }, player.id, "decline-event-second");
  const sett = instance(cards.settTheBoss, player.id, "decline-event-sett");
  first.buffs = 1;
  second.buffs = 1;
  field.units = [first, second];
  field.controlledBy = player.id;
  player.legend = sett;
  player.runes = [rune(DOMAINS.BODY, player.id, "decline-event-sett-rune")];
  player.hand = [instance({ ...cards.uncheckedPower, energy: 0, power: [] }, player.id, "decline-event-wipe")];

  assert.equal(playCard(game, "decline-event-wipe", "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementEvent");
  assert.ok(game.pendingChoice.options.some((option) => option.id === "decline"));
  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(sett.exhausted, false);
  assert.equal(game.deathReplacementPreference, undefined);
});

test("a direct Kill resumes its owning spell after an optional death replacement choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const sett = instance(cards.settTheBoss, player.id, "direct-kill-sett");
  const unit = instance(cards.lonelyPoro, player.id, "direct-kill-target");
  const spell = instance({
    ...cards.vengeance,
    name: "Direct Kill Continuation Test",
    effects: [{ timing: "spell", kind: "killUnit", target: "friendlyUnit" }]
  }, player.id, "direct-kill-spell");
  unit.buffs = 1;
  player.legend = sett;
  player.base = [unit];
  player.runes = [rune(DOMAINS.BODY, player.id, "direct-kill-sett-rune")];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(game.pendingChoice?.effect, "killUnit");
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource");

  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), true,
    "the interrupted spell must finish after the replacement decision");
  assert.equal(game.deathReplacementPreference, undefined);
});

test("a prepared death payment resumes the interrupted direct Kill exactly once", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, player.id, "prepared-direct-kill-target");
  const preparation = instance({
    ...cards.findYourCenter,
    name: "Prepared Death Test",
    effects: [{ timing: "spell", kind: "saveFriendlyUnitThisTurn", target: "friendlyUnit", domain: DOMAINS.CALM }]
  }, player.id, "prepared-direct-kill-setup");
  const killSpell = instance({
    ...cards.vengeance,
    name: "Prepared Direct Kill Test",
    effects: [{ timing: "spell", kind: "killUnit", target: "friendlyUnit" }]
  }, player.id, "prepared-direct-kill-spell");
  field.units = [unit];
  field.controlledBy = player.id;
  player.runes = [rune(DOMAINS.CALM, player.id, "prepared-direct-kill-rune")];

  assert.equal(resolveEffect(game, player, preparation), true);
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(resolveEffect(game, player, killSpell), true);
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "preparedDeathRecallPayment");

  assert.equal(chooseEffectOption(game, "pay-death-recall").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(unit.exhausted, true);
  assert.equal(unit.damage, 0);
  assert.equal(player.trash.filter((card) => card.instanceId === killSpell.instanceId).length, 1);
  assert.equal(game.pendingChoice, null);
});

test("sett the boss readies when his controller conquers", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const sett = instance(cards.settTheBoss, player.id, "ready-sett-boss");
  const mover = instance(cards.lonelyPoro, player.id, "sett-conquer-mover");
  const holder = instance(cards.lonelyPoro, player.id, "sett-conquer-holder");
  const field = game.battlefields[0];
  sett.exhausted = true;
  player.legend = sett;
  player.base = [mover];
  field.controlledBy = opponent.id;
  field.units = [holder];

  assert.equal(moveUnit(game, "sett-conquer-mover", field.instanceId).ok, true);
  assert.equal(sett.exhausted, false);
});

test("sett the boss does not create a no-op conquer trigger while already ready", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sett = instance(cards.settTheBoss, player.id, "ready-sett-noop");
  const mover = instance(cards.lonelyPoro, player.id, "ready-sett-noop-mover");
  const holder = instance(cards.lonelyPoro, player.id, "ready-sett-noop-holder");
  const field = game.battlefields[0];
  player.legend = sett;
  player.base = [mover];
  field.controlledBy = opponent.id;
  field.units = [holder];

  assert.equal(moveUnit(game, mover.instanceId, field.instanceId).ok, true);
  assert.equal(player.score, 1);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.actionChain, null);
});

test("trifarian gloryseeker buffs itself only when Legion is satisfied", () => {
  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const gloryseeker = instance({ ...cards.trifarianGloryseeker, energy: 0, power: [] }, player.id, "gloryseeker-without-legion");
    player.hand = [gloryseeker];

    assert.equal(playCard(game, gloryseeker.instanceId, "base").ok, true);
    assert.equal(gloryseeker.buffs, 0, "the first card played this turn does not satisfy Legion");
  }

  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const gloryseeker = instance({ ...cards.trifarianGloryseeker, energy: 0, power: [] }, player.id, "gloryseeker-with-legion");
    player.cardsPlayedThisTurn = 1;
    player.hand = [gloryseeker];

    assert.equal(playCard(game, gloryseeker.instanceId, "base").ok, true);
    assert.equal(gloryseeker.buffs, 1, "a prior card played this turn satisfies Legion");
  }
});

test("cithria and trifarian gloryseeker put their play buffs on the same chain", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const cithria = instance(cards.cithriaOfCloudfield, player.id, "same-chain-cithria");
  const gloryseeker = instance({ ...cards.trifarianGloryseeker, energy: 0, power: [] }, player.id, "same-chain-gloryseeker");
  player.base = [cithria];
  player.cardsPlayedThisTurn = 1;
  player.hand = [gloryseeker];
  opponent.hand = [instance({ ...cards.gust, energy: 0, power: [] }, opponent.id, "same-chain-response")];

  assert.equal(beginPlayCard(game, gloryseeker.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (!game.pendingChoice && game.actionChain?.chain.some((item) => item.itemType === "card")) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.deepEqual(
    new Set(game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder).map((option) => option.cardId)),
    new Set([cithria.instanceId, gloryseeker.instanceId])
  );
  const cithriaTrigger = game.pendingChoice.options.find((option) => option.cardId === cithria.instanceId);
  const gloryseekerTrigger = game.pendingChoice.options.find((option) => option.cardId === gloryseeker.instanceId);
  assert.equal(chooseEffectOption(game, cithriaTrigger.id).ok, true);
  assert.equal(chooseEffectOption(game, gloryseekerTrigger.id).ok, true);
  assert.deepEqual(
    game.pendingChoice.data.triggerOrderState.groups[0].orderedTriggers.map((trigger) => trigger.sourceCardId),
    [cithria.instanceId, gloryseeker.instanceId]
  );
  assert.equal(chooseEffectOption(game, "confirm-trigger-order").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.actionChain?.chain.length, 2);
  assert.deepEqual(
    game.actionChain.chain.map((item) => item.trigger.sourceCardId),
    [cithria.instanceId, gloryseeker.instanceId],
    "the last selected trigger is the last Chain item and therefore resolves first"
  );
  assert.equal(cithria.buffs, 0);
  assert.equal(gloryseeker.buffs, 0);

  let passGuard = 0;
  while (game.actionChain && passGuard < 8) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    passGuard += 1;
  }
  assert.equal(game.actionChain, null);
  assert.equal(cithria.buffs, 1);
  assert.equal(gloryseeker.buffs, 1);
});

test("noxus hopeful's Legion discount applies only to itself", () => {
  {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const hopeful = instance(cards.noxusHopeful, player.id, "discounted-noxus-hopeful");
    player.cardsPlayedThisTurn = 1;
    player.hand = [hopeful];

    assert.equal(beginPlayCard(game, hopeful.instanceId, "base").ok, true);
    assert.equal(game.pendingPayment?.energyCost, 2);
  }

  {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const hopeful = instance(cards.noxusHopeful, player.id, "in-play-noxus-hopeful");
    const otherCard = instance({ ...cards.lonelyPoro, energy: 2, power: [] }, player.id, "other-two-cost-card");
    player.cardsPlayedThisTurn = 1;
    player.base = [hopeful];
    player.hand = [otherCard];

    assert.equal(beginPlayCard(game, otherCard.instanceId, "base").ok, true);
    assert.equal(game.pendingPayment?.energyCost, 2);
  }
});

test("a player orders simultaneous conquer triggers before they enter the action chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sett = instance(cards.settTheBoss, player.id, "ordered-conquer-sett");
  const mover = instance(cards.lonelyPoro, player.id, "ordered-conquer-mover");
  const holders = [0, 1, 2].map((index) => instance(cards.lonelyPoro, player.id, `ordered-conquer-holder-${index}`));
  const draws = [
    instance(cards.charm, player.id, "ordered-conquer-draw-one"),
    instance(cards.flash, player.id, "ordered-conquer-draw-two")
  ];
  const field = game.battlefields[0];
  sett.exhausted = true;
  player.legend = instance(cards.garenMightOfDemacia, player.id, "ordered-conquer-garen");
  player.base = [sett, mover];
  player.mainDeck = [...draws];
  field.controlledBy = opponent.id;
  field.units = holders;

  assert.equal(moveUnit(game, mover.instanceId, field.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.deepEqual(
    new Set(game.pendingChoice.options.filter((option) => !option.confirmTriggerOrder).map((option) => option.cardId)),
    new Set([sett.instanceId, player.legend.instanceId])
  );
  const garenFirst = game.pendingChoice.options.find((option) => option.cardId === player.legend.instanceId);
  selectAndConfirmTriggerOrder(game, [
    ...game.pendingChoice.options
      .filter((option) => !option.confirmTriggerOrder && option.id !== garenFirst.id)
      .map((option) => option.id),
    garenFirst.id
  ]);

  assert.equal(game.pendingChoice, null);
  assert.equal(sett.exhausted, false);
  assert.equal(draws.every((card) => player.hand.some((candidate) => candidate.instanceId === card.instanceId)), true);
});

test("reckoner's arena triggers conquer abilities of units there when held", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.kaiSaSurvivor, player.id, "reckoner-kaisa");
  const field = {
    ...instance(cards.reckonersArena, player.id, "explicit-reckoner-arena"),
    controlledBy: player.id,
    hidden: [],
    units: [unit]
  };
  game.battlefields[0] = field;
  player.mainDeck = [instance(cards.flash, player.id, "reckoner-draw")];

  startTurn(game);

  assert.equal(player.hand.some((card) => card.instanceId === "reckoner-draw"), true);
});

test("Kai'Sa Survivor places her conquest draw on the action Chain before drawing", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const kaiSa = instance(cards.kaiSaSurvivor, player.id, "kaisa-conquer-chain");
  const drawCard = instance(cards.flash, player.id, "kaisa-conquer-chain-draw");
  const field = game.battlefields[0];
  player.base = [kaiSa];
  player.mainDeck = [drawCard];
  field.controlledBy = opponent.id;
  field.units = [];

  assert.equal(moveUnit(game, kaiSa.instanceId, field.instanceId).ok, true);
  assert.ok(game.showdown, "moving to the empty enemy battlefield starts a Showdown");
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === drawCard.instanceId), false,
    "the conquest draw must wait for its trigger to resolve");
  assert.equal(game.actionChain?.chain.length, 1);
  assert.equal(game.actionChain.chain[0].itemType, "trigger");
  assert.equal(game.actionChain.chain[0].trigger.kind, "scoreDraw");
  assert.equal(game.actionChain.chain[0].trigger.sourceCardId, kaiSa.instanceId);

  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === drawCard.instanceId), true);
});

test("baited hook kills a friendly unit and plays a top deck unit within might range", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const hook = instance(cards.baitedHook, player.id, "explicit-baited-hook");
  const sacrifice = instance(cards.ravenbloomStudent, player.id, "baited-sacrifice");
  const inherentlyTooLarge = instance(cards.blazingScorcher, player.id, "baited-recycled-unit");
  inherentlyTooLarge.mightModifier = -100;
  player.base = [hook, sacrifice];
  player.runes = [rune(DOMAINS.ORDER, player.id, "baited-order-rune")];
  player.mainDeck = [
    instance(cards.lonelyPoro, player.id, "baited-played-unit"),
    inherentlyTooLarge
  ];

  assert.equal(activateCard(game, "explicit-baited-hook").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "baited-sacrifice").ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, "baited-order-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "baitedHookTopDeck");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["baited-played-unit", "decline"]);
  assert.equal(chooseEffectOption(game, "baited-played-unit").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "baited-played-unit"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "baited-sacrifice"), true);
  assert.equal(player.mainDeck.some((card) => card.instanceId === "baited-recycled-unit"), true);
  assert.equal(hook.exhausted, true);
});

test("baited hook cannot play a top-deck unit when its chosen unit's death is replaced", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const hook = instance(cards.baitedHook, player.id, "replaced-baited-hook");
  const chosenUnit = instance(cards.ravenbloomStudent, player.id, "replaced-baited-unit");
  const hourglass = instance(cards.zhonyasHourglass, player.id, "replaced-baited-hourglass");
  player.base = [hook, chosenUnit, hourglass];
  player.runes = [rune(DOMAINS.ORDER, player.id, "replaced-baited-power")];
  player.mainDeck = [instance(cards.lonelyPoro, player.id, "replaced-baited-top-unit")];

  assert.equal(activateCard(game, hook.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, chosenUnit.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "replaced-baited-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice?.effect, "baitedHookTopDeck");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["decline"]);
  assert.equal(player.base.some((card) => card.instanceId === chosenUnit.instanceId), true);
  assert.equal(chosenUnit.exhausted, true);
  assert.equal(game.killEvents?.some((event) => event.targetId === chosenUnit.instanceId) || false, false);
});

test("pack of wonders returns another friendly hidden card to hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const pack = instance(cards.packOfWonders, player.id, "explicit-pack-wonders");
  const hidden = instance(cards.backOff, player.id, "pack-hidden-card");
  field.controlledBy = player.id;
  player.base = [pack];
  player.hand = [hidden];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "pack-hide-rune")];

  hideWithRune(game, "pack-hidden-card", field.instanceId, "pack-hide-rune");
  assert.equal(activateCard(game, "explicit-pack-wonders").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");

  assert.equal(chooseEffectOption(game, "pack-hidden-card").ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.hand.some((card) => card.instanceId === "pack-hidden-card"), true);
  assert.equal(game.revealEvents.at(-1).zone, "facedown",
    "a facedown card is revealed to all players before entering a private hand");
  assert.deepEqual(game.revealEvents.at(-1).cardIds, ["pack-hidden-card"]);
  assert.equal(pack.exhausted, true);
});

test("attached cards keep their own controller when the Top-Most card changes control", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const pack = instance(cards.packOfWonders, player.id, "attachment-control-pack");
  const unit = instance(cards.lonelyPoro, player.id, "attachment-control-unit");
  const gear = instance(cards.guardianAngel, player.id, "attachment-control-gear");
  unit.controllerId = opponent.id;
  unit.attachments = [gear];
  gear.attachedToId = unit.instanceId;
  field.units = [unit];
  field.controlledBy = opponent.id;
  player.base = [pack];

  assert.equal(activateCard(game, pack.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(game.pendingChoice.options.some((option) => option.cardId === gear.instanceId), true,
    "the original controller can still choose its attached Gear");
  assert.equal(game.pendingChoice.options.some((option) => option.cardId === unit.instanceId), false,
    "control of the Top-Most card changed independently");
  assert.equal(chooseEffectOption(game, gear.instanceId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === gear.instanceId), true);
  assert.equal((unit.attachments || []).length, 0);
});

test("Udyr declares an unused mode and its target before activation resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const udyr = instance(cards.udyrWildman, player.id, "timed-udyr");
  const target = instance(cards.ravenbloomStudent, opponent.id, "udyr-damage-target");
  udyr.buffs = 1;
  player.base = [udyr];
  game.battlefields[0].units = [target];

  assert.equal(activateCard(game, udyr.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareUdyrMode");
  assert.equal(chooseEffectOption(game, "damage").ok, true);
  assert.equal(game.pendingChoice.effect, "declareUdyrTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, 0);
  assert.equal(opponent.trash.some((card) => card.instanceId === target.instanceId), true);
  assert.equal(udyr.buffs, 0);
  assert.equal(udyr.exhausted, false);
  assert.equal(udyr.udyrModesChosen.includes("damage"), true);
});

test("vanguard helm buffs another friendly unit when a buffed friendly unit dies", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const helm = instance(cards.vanguardHelm, player.id, "explicit-vanguard-helm");
  const victim = instance(cards.ravenbloomStudent, player.id, "helm-victim");
  const ally = instance(cards.lonelyPoro, player.id, "helm-ally");
  victim.buffs = 1;
  field.controlledBy = player.id;
  field.units = [victim];
  player.base = [helm, ally];
  player.hand = [instance(cards.uncheckedPower, player.id, "helm-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `helm-r${index}`));

  assert.equal(playCard(game, "helm-boardwipe", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "buffUnit");
  assert.equal(chooseEffectOption(game, "helm-ally").ok, true);
  assert.equal(ally.buffs, 1);
});

test("wildclaw shaman spends a friendly buff to buff and ready itself", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const donor = instance(cards.lonelyPoro, player.id, "wildclaw-donor");
  donor.buffs = 1;
  player.base = [donor];
  player.hand = [instance(cards.wildclawShaman, player.id, "explicit-wildclaw")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `wildclaw-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-wildclaw", "base").ok, true);
  for (const runeId of ["wildclaw-r0", "wildclaw-r1", "wildclaw-r2", "wildclaw-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  const shaman = player.base.find((card) => card.instanceId === "explicit-wildclaw");
  shaman.exhausted = true;
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "declareTriggerCost");

  assert.equal(chooseEffectOption(game, "wildclaw-donor").ok, true);
  assert.equal(donor.buffs, 0);
  assert.equal(shaman.buffs, 1);
  assert.equal(shaman.exhausted, false);
});

test("king's edict has the next player choose an uncontrolled unit to kill", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.lonelyPoro, opponent.id, "edict-enemy");
  opponent.base = [enemy];
  player.hand = [instance(cards.kingsEdict, player.id, "explicit-kings-edict")];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.ORDER, player.id, `edict-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-kings-edict", "base").ok, true);
  for (const runeId of ["edict-r0", "edict-r1", "edict-r2", "edict-r3", "edict-r4", "edict-r5"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "edict-r6", "power").ok, true);
  assert.equal(togglePaymentRune(game, "edict-r7", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "eachOtherPlayerKillUncontrolledUnit");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(chooseEffectOption(game, "edict-enemy").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "edict-enemy"), true);
});

test("overt operation spends buffs to ready then buffs friendly units", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "overt-first");
  const second = instance(cards.lonelyPoro, player.id, "overt-second");
  first.buffs = 1;
  first.exhausted = true;
  second.exhausted = true;
  player.base = [first, second];
  player.hand = [instance(cards.overtOperation, player.id, "explicit-overt")];
  player.runes = Array.from({ length: 7 }, (_, index) => rune(DOMAINS.BODY, player.id, `overt-r${index}`));

  assert.equal(playCard(game, "explicit-overt", "base").ok, true);
  assert.equal(first.exhausted, false);
  assert.equal(first.buffs, 1);
  assert.equal(second.exhausted, true);
  assert.equal(second.buffs, 1);
  assert.deepEqual(game.readyEvents.at(-1).cardIds, [first.instanceId]);
});

test("Ready actions share one event and trigger friendly-unit Ready abilities", () => {
  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const haven = instance(cards.piratesHaven, player.id, "ready-step-haven");
    const exhausted = instance(cards.lonelyPoro, player.id, "ready-step-unit");
    const alreadyReady = instance(cards.lonelyPoro, player.id, "already-ready-unit");
    exhausted.exhausted = true;
    player.base = [haven, exhausted, alreadyReady];
    player.mainDeck = [instance(cards.lonelyPoro, player.id, "ready-step-draw")];

    startTurn(game);

    assert.equal(exhausted.exhausted, false);
    assert.equal(exhausted.temporaryMight, 1);
    assert.equal(alreadyReady.temporaryMight, undefined);
    const event = game.readyEvents.find((candidate) => candidate.reason === "ready-step");
    assert.deepEqual(event.cardIds, [exhausted.instanceId]);
    assert.equal(event.responsiblePlayerId, player.id);
  }

  {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const haven = instance(cards.piratesHaven, player.id, "overt-haven");
    const selected = instance(cards.lonelyPoro, player.id, "overt-selected");
    const declined = instance(cards.lonelyPoro, player.id, "overt-declined");
    selected.exhausted = true;
    selected.buffs = 1;
    declined.exhausted = true;
    declined.buffs = 1;
    const spell = instance(cards.overtOperation, player.id, "overt-explicit-choice");
    player.base = [haven, selected, declined];

    assert.equal(resolveEffect(game, player, spell), true);
    assert.equal(game.pendingChoice.effect, "spendBuffsReadyThenBuffFriendlyUnits");
    assert.equal(chooseEffectOption(game, selected.instanceId).ok, true);
    assert.equal(selected.exhausted, true, "the Ready action waits until the optional subset is complete");
    assert.equal(chooseEffectOption(game, "done").ok, true);

    assert.equal(selected.exhausted, false);
    assert.equal(selected.temporaryMight, 1);
    assert.equal(declined.exhausted, true);
    assert.deepEqual(game.readyEvents.at(-1).cardIds, [selected.instanceId]);
  }
});

test("Draw completes its full amount before every simultaneous second-draw trigger resolves", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const firstJewel = instance(cards.frigidJewel, player.id, "draw-jewel-one");
  const secondJewel = instance(cards.frigidJewel, player.id, "draw-jewel-two");
  const target = instance(cards.lonelyPoro, player.id, "draw-trigger-target");
  player.base = [firstJewel, secondJewel, target];
  player.hand = [];
  player.drawCountThisTurn = 0;
  player.mainDeck = [
    instance(cards.lonelyPoro, player.id, "draw-one"),
    instance(cards.lonelyPoro, player.id, "draw-two"),
    instance(cards.lonelyPoro, player.id, "draw-three")
  ];

  assert.equal(draw(player, 3, game), true);

  assert.deepEqual(player.hand.map((card) => card.instanceId), ["draw-one", "draw-two", "draw-three"]);
  assert.equal(target.temporaryMight, 4, "each Frigid Jewel creates its own trigger");
  assert.deepEqual(game.drawEvents.at(-1), {
    ...game.drawEvents.at(-1),
    requested: 3,
    cardIds: ["draw-one", "draw-two", "draw-three"],
    burnOutCount: 0,
    responsiblePlayerId: player.id
  });
});

test("stealthy pursuer may move with a friendly unit from the same battlefield", () => {
  for (const initiallyExhausted of [false, true]) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const firstField = game.battlefields[0];
    const secondField = game.battlefields[1];
    const mover = instance(cards.lonelyPoro, player.id, "pursuer-mover");
    mover.keywords = ["Ganking"];
    const pursuer = instance(cards.stealthyPursuer, player.id, "explicit-pursuer");
    pursuer.exhausted = initiallyExhausted;
    firstField.controlledBy = player.id;
    secondField.controlledBy = player.id;
    firstField.units = [mover, pursuer];

    assert.equal(moveUnit(game, "pursuer-mover", secondField.instanceId).ok, true);
    assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
    assert.equal(game.actionChain?.chain.length || 0, 0,
      "the Pursuer trigger is not Pending until its controller chooses to use it");
    assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
    assert.equal(secondField.units.some((unit) => unit.instanceId === "explicit-pursuer"), true);
    assert.equal(pursuer.exhausted, initiallyExhausted,
      "the triggered Move neither exhausts nor readies the Pursuer");
  }
});

test("the turn player controls an uncontrolled battlefield's move trigger during a showdown", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const turnPlayer = currentPlayer(game);
  const priorityPlayer = game.players.find((candidate) => candidate.id !== turnPlayer.id);
  const field = game.battlefields[0];
  const movedUnit = instance(cards.lonelyPoro, turnPlayer.id, "uncontrolled-move-trigger-unit");
  field.name = cards.backAlleyBar.name;
  field.effects = structuredClone(cards.backAlleyBar.effects);
  field.controlledBy = null;
  field.units = [movedUnit];
  game.phase = "showdown";
  game.currentPlayerId = priorityPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: turnPlayer.id,
    attackerId: turnPlayer.id,
    defenderId: priorityPlayer.id,
    combat: false,
    focusPlayerId: priorityPlayer.id,
    priorityPlayerId: priorityPlayer.id,
    consecutivePasses: 0,
    chain: [],
    chainSequence: 0,
    playerIds: [turnPlayer.id, priorityPlayer.id]
  };
  const spell = instance(cards.fightOrFlight, priorityPlayer.id, "uncontrolled-move-trigger-spell");

  assert.equal(resolveEffect(game, priorityPlayer, spell), true);
  assert.equal(game.pendingChoice.effect, "returnUnitToBase");
  assert.equal(chooseEffectOption(game, movedUnit.instanceId).ok, true);

  const triggerItem = game.showdown.chain.find((item) => item.trigger?.sourceCardId === field.instanceId);
  assert.ok(triggerItem);
  assert.equal(triggerItem.trigger.kind, "onMoveEffect");
  assert.equal(triggerItem.playerId, turnPlayer.id);
  assert.equal(triggerItem.trigger.playerId, turnPlayer.id);
});

test("imperial decree kills units that take damage this turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.missFortuneCaptain, opponent.id, "decree-target");
  field.controlledBy = opponent.id;
  field.units = [target];
  player.hand = [
    instance(cards.imperialDecree, player.id, "explicit-decree"),
    instance(cards.getExcited, player.id, "decree-get-excited"),
    instance(cards.portalRescue, player.id, "decree-discard")
  ];
  player.runes = Array.from({ length: 10 }, (_, index) => rune(index === 9 ? DOMAINS.FURY : DOMAINS.ORDER, player.id, `decree-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-decree", "base").ok, true);
  for (const runeId of ["decree-r0", "decree-r1", "decree-r2", "decree-r3", "decree-r4"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "decree-r5", "power").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r6", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(beginPlayCard(game, "decree-get-excited", "base").ok, true);
  assert.equal(chooseEffectOption(game, "decree-target").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r7", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r8", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r9", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "discardEnergyDamage");
  assert.equal(chooseEffectOption(game, "decree-discard").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "decree-target"), true);
});

test("albus ferros spends friendly buffs to channel exhausted runes", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "albus-first");
  const second = instance(cards.lonelyPoro, player.id, "albus-second");
  first.buffs = 1;
  second.buffs = 1;
  player.base = [first, second];
  player.hand = [instance(cards.albusFerros, player.id, "explicit-albus")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.ORDER, player.id, `albus-r${index}`));
  const runeCount = player.runes.length;

  assert.equal(playCard(game, "explicit-albus", "base").ok, true);
  assert.equal(first.buffs, 0);
  assert.equal(second.buffs, 0);
  assert.equal(player.runes.length, runeCount + 2);
  assert.equal(player.runes.slice(-2).every((card) => card.exhausted), true);
});

test("malzahar fanatic pays its Kill cost and immediately finalizes the non-reactive Add ability", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const malzahar = instance(cards.malzaharFanatic, player.id, "explicit-malzahar");
  const victim = instance(cards.lonelyPoro, player.id, "malzahar-victim");
  player.base = [malzahar, victim];
  player.hand = [instance({ ...cards.flash, energy: 0, power: [], effects: [] }, player.id, "malzahar-player-response")];
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  opponent.hand = [instance({ ...cards.flash, energy: 0, power: [], effects: [] }, opponent.id, "malzahar-opponent-response")];
  const runeCount = player.runes.length;
  const powerCount = player.runePool.power.length;

  assert.equal(activateCard(game, "explicit-malzahar").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "malzahar-victim").ok, true);
  assert.equal(game.actionChain, null, "Add abilities leave the Chain during Finalize");
  assert.equal(player.base.some((card) => card.instanceId === "malzahar-victim"), false,
    "Malzahar pays the Kill cost before Finalize");
  assert.equal(player.trash.some((card) => card.instanceId === "malzahar-victim"), true);
  assert.equal(player.runes.length, runeCount);

  assert.equal(player.runes.length, runeCount);
  assert.equal(player.runePool.power.length, powerCount + 2);
  assert.equal(player.runePool.power.slice(-2).every((resource) => resource.domain === DOMAINS.ANY), true);
  assert.equal(malzahar.exhausted, true);
});

test("Malzahar resumes his activation after a prepared Kill-cost replacement choice", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const malzahar = instance(cards.malzaharFanatic, player.id, "malzahar-replacement-source");
  const victim = instance(cards.lonelyPoro, player.id, "malzahar-replacement-victim");
  const paymentRune = rune(DOMAINS.FURY, player.id, "malzahar-replacement-rune");
  victim.saveWithRuneUntilTurnSequence = game.turnSequence || 0;
  victim.saveWithRuneDomain = DOMAINS.FURY;
  victim.saveWithRuneSourceName = cards.unlicensedArmory.name;
  player.base = [malzahar, victim];
  player.runes = [paymentRune];

  assert.equal(activateCard(game, malzahar.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, victim.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "preparedDeathRecallPayment");
  assert.equal(game.actionChain?.chain[0]?.status, "pending",
    "the activated ability must remain pending while its Kill cost opens a replacement choice");

  assert.equal(chooseEffectOption(game, "pay-death-recall").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(player.base.some((card) => card.instanceId === victim.instanceId), true);
  assert.equal(victim.exhausted, true);
  assert.equal(player.runes.some((card) => card.instanceId === paymentRune.instanceId), false);
  assert.equal(game.actionChain, null,
    "the original Add activation must resume, finalize, and leave the Chain exactly once after the replacement");
  assert.equal(malzahar.exhausted, true);

  assert.equal(player.runes.length, 0, "the Rune paid to save the victim remains recycled");
  assert.equal(player.runePool.power.length, 2, "Malzahar adds 2 Any Power on resolution");
});

test("noxian guillotine kills the chosen unit when it later takes damage", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.missFortuneCaptain, opponent.id, "guillotine-target");
  field.controlledBy = opponent.id;
  field.units = [target];
  player.hand = [
    instance(cards.noxianGuillotine, player.id, "explicit-guillotine"),
    instance(cards.getExcited, player.id, "guillotine-get-excited"),
    instance(cards.portalRescue, player.id, "guillotine-discard")
  ];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.FURY, player.id, `guillotine-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-guillotine", "base").ok, true);
  assert.equal(chooseEffectOption(game, "guillotine-target").ok, true);
  for (const runeId of ["guillotine-r0", "guillotine-r1", "guillotine-r2", "guillotine-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "guillotine-r4", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(beginPlayCard(game, "guillotine-get-excited", "base").ok, true);
  assert.equal(chooseEffectOption(game, "guillotine-target").ok, true);
  assert.equal(togglePaymentRune(game, "guillotine-r5", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "guillotine-r6", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "guillotine-r7", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(chooseEffectOption(game, "guillotine-discard").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "guillotine-target"), true);
});

test("ravenborn tome gives the next spell bonus damage", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const tome = instance(cards.ravenbornTome, player.id, "explicit-ravenborn-tome");
  const spell = instance(cards.hextechRay, player.id, "ravenborn-ray");
  const target = instance(cards.missFortuneCaptain, opponent.id, "ravenborn-target");
  game.battlefields[0].controlledBy = opponent.id;
  game.battlefields[0].units = [target];
  player.base = [tome];

  assert.equal(activateCard(game, "explicit-ravenborn-tome").ok, true);
  assert.equal(tome.exhausted, true);
  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(game.pendingChoice.effect, "damageUnit");
  assert.equal(chooseEffectOption(game, "ravenborn-target").ok, true);
  assert.equal(target.damage, 4);
  assert.equal(player.nextSpellBonusDamage, 0);
});

test("independent Ravenborn Tome delayed passives stack after their sources leave", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const firstTome = instance(cards.ravenbornTome, player.id, "stacked-ravenborn-one");
  const secondTome = instance(cards.ravenbornTome, player.id, "stacked-ravenborn-two");
  const target = instance({ ...cards.missFortuneCaptain, might: 9 }, opponent.id, "stacked-ravenborn-target");
  const spell = instance(cards.hextechRay, player.id, "stacked-ravenborn-ray");
  player.base = [firstTome, secondTome];
  game.battlefields[0].units = [target];
  game.battlefields[0].controlledBy = opponent.id;

  assert.equal(activateCard(game, firstTome.instanceId).ok, true);
  assert.equal(activateCard(game, secondTome.instanceId).ok, true);
  assert.equal(player.nextSpellBonusDamage, 2);
  player.base = [];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, 5);
  assert.equal(player.nextSpellBonusDamage, 0);
});

test("kai'sa evolutionary plays a low-cost trash spell after conquering", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const kaisa = instance(cards.kaiSaEvolutionary, player.id, "explicit-evolutionary-kaisa");
  const spell = instance(cards.confront, player.id, "kaisa-confront");
  const drawCard = instance(cards.lonelyPoro, player.id, "kaisa-draw");
  const field = {
    ...instance(cards.reckonersArena, player.id, "kaisa-reckoners-arena"),
    controlledBy: player.id,
    hidden: [],
    units: [kaisa]
  };
  game.battlefields[0] = field;
  field.controlledBy = player.id;
  player.trash = [spell];
  player.mainDeck = [drawCard];
  player.runes = [rune(DOMAINS.FURY, player.id, "kaisa-existing-fury")];
  player.score = 3;
  const runeDeckBeforeStart = player.runeDeck.length;

  startTurn(game);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashSpell");
  assert.equal(player.hand.some((card) => card.instanceId === "kaisa-draw"), false);
  assert.equal(player.runeDeck.length, runeDeckBeforeStart);
  assert.equal(chooseEffectOption(game, "kaisa-confront").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "kaisa-draw"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "kaisa-confront"), false);
  assert.equal(player.hand.some((card) => card.instanceId === "kaisa-confront"), true);
  assert.equal(player.mainDeck.some((card) => card.instanceId === "kaisa-confront"), false);
});

test("later other-unit death triggers resolve above an earlier Deathknell event", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const viktor = instance(cards.viktorLeader, player.id, "explicit-viktor-leader");
  const victim = instance(cards.lonelyPoro, player.id, "viktor-victim");
  const spell = instance(cards.hextechRay, player.id, "viktor-ray");
  game.battlefields[0].controlledBy = player.id;
  game.battlefields[0].units = [victim];
  player.base = [viktor];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, "viktor-victim").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "viktor-victim"), true);
  assert.notEqual(game.pendingChoice?.effect, "triggerOrder");
  assert.equal(player.base.some((card) => card.name === "Recruit" && card.controllerId === player.id), true);
});

test("units killed simultaneously do not become alone because cleanup removed an ally first", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "simultaneous-poro-one");
  const second = instance(cards.lonelyPoro, player.id, "simultaneous-poro-two");
  const spell = instance(cards.uncheckedPower, player.id, "simultaneous-poro-wipe");
  const deckBefore = [
    instance(cards.charm, player.id, "simultaneous-no-draw-one"),
    instance(cards.flash, player.id, "simultaneous-no-draw-two")
  ];
  game.battlefields[0].controlledBy = player.id;
  game.battlefields[0].units = [first, second];
  player.hand = [spell];
  player.mainDeck = [...deckBefore];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `simultaneous-wipe-rune-${index}`));

  assert.equal(playCard(game, spell.instanceId, "base").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(player.mainDeck.length, deckBefore.length);
});

test("viktor leader ignores friendly recruit deaths", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const viktor = instance(cards.viktorLeader, player.id, "explicit-viktor-no-recruit");
  const recruit = instance(cards.recruit, player.id, "viktor-recruit");
  const spell = instance(cards.hextechRay, player.id, "viktor-recruit-ray");
  game.battlefields[0].controlledBy = player.id;
  game.battlefields[0].units = [recruit];
  player.base = [viktor];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, "viktor-recruit").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "viktor-recruit"), false);
  assert.equal(player.base.filter((card) => card.name === "Recruit").length, 0);
});

test("void gate adds bonus damage to units at that battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = {
    ...instance(cards.voidGate, player.id, "explicit-void-gate"),
    controlledBy: opponent.id,
    hidden: [],
    units: [instance(cards.missFortuneCaptain, opponent.id, "void-gate-target")]
  };
  game.battlefields[0] = field;
  const spell = instance(cards.hextechRay, player.id, "void-gate-ray");

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, "void-gate-target").ok, true);
  assert.equal(field.units[0].damage, 4);
});

test("akshan weaponmaster returns temporarily controlled enemy equipment when he leaves play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const equipment = instance(cards.guardianAngel, opponent.id, "enemy-equipment");
  opponent.base = [equipment];
  player.hand = [instance(cards.akshanMischievous, player.id, "explicit-akshan")];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `akshan-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-akshan", "base").ok, true);
  assert.equal(game.pendingPayment.optionalPowerEffects.length, 1);
  assert.equal(toggleOptionalPaymentEffect(game, game.pendingPayment.optionalPowerEffects[0].id).ok, true);
  for (const runeId of ["akshan-r0", "akshan-r1", "akshan-r2", "akshan-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "akshan-r4", "power").ok, true);
  assert.equal(togglePaymentRune(game, "akshan-r5", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  const akshan = player.base.find((card) => card.instanceId === "explicit-akshan");
  assert.equal(game.pendingChoice.effect, "triggerOrder");
  const stealTrigger = game.pendingChoice.options.find((option) => option.effectKind === "stealEnemyGear" && option.cardId === akshan.instanceId);
  assert.ok(stealTrigger);
  selectAndConfirmTriggerOrder(game, [
    ...game.pendingChoice.options
      .filter((option) => !option.confirmTriggerOrder && option.id !== stealTrigger.id)
      .map((option) => option.id),
    stealTrigger.id
  ]);
  assert.equal(game.pendingChoice.effect, "stealEnemyGear");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["enemy-equipment"]);

  assert.equal(chooseEffectOption(game, "enemy-equipment").ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === "enemy-equipment"), false);
  assert.equal(player.base.some((card) => card.instanceId === "enemy-equipment"), false);
  assert.equal(akshan.attachments.some((card) => card.instanceId === "enemy-equipment"), true);
  assert.equal(player.runeDeck.filter((card) => card.instanceId.startsWith("akshan-r")).length, 2);

  const field = game.battlefields[0];
  player.base = player.base.filter((card) => card.instanceId !== akshan.instanceId);
  field.units = [akshan];
  field.controlledBy = player.id;
  akshan.damage = 12;
  startTurn(game);
  assert.equal(opponent.base.some((card) => card.instanceId === "enemy-equipment"), true);
  assert.equal(player.base.some((card) => card.instanceId === "enemy-equipment"), false);
});

test("akshan weaponmaster does not steal gear without paying the additional body power", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const equipment = instance(cards.guardianAngel, opponent.id, "unpaid-enemy-equipment");
  opponent.base = [equipment];
  player.hand = [instance(cards.akshanMischievous, player.id, "unpaid-akshan")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `unpaid-akshan-r${index}`));

  assert.equal(beginPlayCard(game, "unpaid-akshan", "base").ok, true);
  for (const runeId of ["unpaid-akshan-r0", "unpaid-akshan-r1", "unpaid-akshan-r2", "unpaid-akshan-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.base.some((card) => card.instanceId === "unpaid-enemy-equipment"), true);
});

test("each zhonya's hourglass can replace one friendly unit death", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance(cards.lonelyPoro, player.id, "zhonya-saved-one");
  const second = instance(cards.scuttleCrab, player.id, "zhonya-saved-two");
  const firstZhonya = instance(cards.zhonyasHourglass, player.id, "zhonya-one");
  const secondZhonya = instance(cards.zhonyasHourglass, player.id, "zhonya-two");
  const attached = instance(cards.guardianAngel, player.id, "zhonya-attached-gear");
  first.buffs = 1;
  first.mightModifier = 2;
  first.temporaryMight = 2;
  first.attachments = [attached];
  field.units = [first, second];
  field.controlledBy = player.id;
  player.base = [firstZhonya, secondZhonya];
  player.hand = [instance(cards.uncheckedPower, player.id, "zhonya-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `zhonya-r${index}`));

  assert.equal(playCard(game, "zhonya-boardwipe", "base").ok, true);
  assert.equal(field.units.length, 0);
  assert.equal(player.base.some((card) => card.instanceId === "zhonya-saved-one"), true);
  assert.equal(player.base.some((card) => card.instanceId === "zhonya-saved-two"), true);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
  assert.equal(first.damage, 0);
  assert.equal(first.buffs, 1);
  assert.equal(first.mightModifier, 2);
  assert.equal(first.temporaryMight, 2);
  assert.deepEqual(first.attachments.map((card) => card.instanceId), [attached.instanceId]);
  assert.equal(player.trash.some((card) => card.instanceId === "zhonya-one"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "zhonya-two"), true);
});

test("a multi-Kill trigger resumes every remaining unit after a death replacement choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = game.battlefields[0];
  const warwick = instance(cards.warwickHunter, attacker.id, "multi-kill-warwick");
  const firstVictim = instance(cards.lonelyPoro, defender.id, "multi-kill-victim-one");
  const secondVictim = instance(cards.ravenbloomStudent, defender.id, "multi-kill-victim-two");
  const firstZhonya = instance(cards.zhonyasHourglass, defender.id, "multi-kill-zhonya-one");
  const secondZhonya = instance(cards.zhonyasHourglass, defender.id, "multi-kill-zhonya-two");
  firstVictim.damage = 1;
  secondVictim.damage = 1;
  attacker.base = [warwick];
  defender.base = [firstZhonya, secondZhonya];
  field.controlledBy = defender.id;
  field.units = [firstVictim, secondVictim];

  assert.equal(moveUnit(game, warwick.instanceId, field.instanceId).ok, true);
  let passes = 0;
  while (!game.pendingChoice && game.showdown && passes < 4) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    passes += 1;
  }
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource");
  const firstReplacement = game.pendingChoice.options.find((option) => option.cardId === firstZhonya.instanceId);
  assert.ok(firstReplacement);

  assert.equal(chooseEffectOption(game, firstReplacement.id).ok, true);
  assert.equal(defender.base.some((card) => card.instanceId === firstVictim.instanceId), true);
  assert.equal(defender.base.some((card) => card.instanceId === secondVictim.instanceId), true,
    "the second Kill must resume after resolving the first replacement choice");
  assert.equal(defender.trash.some((card) => card.instanceId === firstZhonya.instanceId), true);
  assert.equal(defender.trash.some((card) => card.instanceId === secondZhonya.instanceId), true);
});

test("a player chooses which simultaneous death one zhonya replaces", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance({ ...cards.lonelyPoro, name: "First lethal unit", might: 1, effects: [] }, player.id, "zhonya-order-first");
  const second = instance({ ...cards.lonelyPoro, name: "Second lethal unit", might: 1, effects: [] }, player.id, "zhonya-order-second");
  const zhonya = instance(cards.zhonyasHourglass, player.id, "zhonya-order-source");
  field.units = [first, second];
  field.controlledBy = player.id;
  player.base = [zhonya];
  player.hand = [instance(cards.uncheckedPower, player.id, "zhonya-order-wipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `zhonya-order-rune-${index}`));

  assert.equal(playCard(game, "zhonya-order-wipe", "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementEvent");
  assert.deepEqual(new Set(game.pendingChoice.options.map((option) => option.cardId).filter(Boolean)), new Set([first.instanceId, second.instanceId]));
  assert.equal(game.pendingChoice.options.some((option) => option.id === "decline"), false,
    "Zhonya's mandatory replacement cannot be declined");
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === zhonya.instanceId), true);
});

test("a simultaneous event choice retains its selected replacement source", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance({ ...cards.lonelyPoro, name: "First replacement unit", might: 1, effects: [] }, player.id, "replacement-source-first");
  const second = instance({ ...cards.lonelyPoro, name: "Second replacement unit", might: 1, effects: [] }, player.id, "replacement-source-second");
  const firstZhonya = instance(cards.zhonyasHourglass, player.id, "replacement-source-zhonya-1");
  const secondZhonya = instance(cards.zhonyasHourglass, player.id, "replacement-source-zhonya-2");
  field.units = [first, second];
  field.controlledBy = player.id;
  player.base = [firstZhonya, secondZhonya];
  player.hand = [instance(cards.uncheckedPower, player.id, "replacement-source-wipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `replacement-source-rune-${index}`));

  assert.equal(playCard(game, "replacement-source-wipe", "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "deathReplacementEvent");
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.equal(game.pendingChoice, null,
    "choosing the event for a specific replacement source must not ask for that source again");
  assert.equal(player.base.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === firstZhonya.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === secondZhonya.instanceId), true);
});

test("Falling Star declares both targets before its response window and resolves both damage instructions", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = instance({ ...cards.lonelyPoro, might: 10 }, opponent.id, "falling-star-repeated-target");
  const spell = instance(cards.fallingStar, player.id, "falling-star-repeated-spell");
  opponent.base = [target];
  player.hand = [spell];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.FURY, player.id, `falling-star-rune-${index}`));

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(game.pendingChoice.options.some((option) => option.cardId === target.instanceId), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.ok(game.pendingPayment);
  assert.deepEqual(game.pendingPayment.declaredTargets.map((declaration) => declaration.targetId), [target.instanceId, target.instanceId]);
  assert.equal(game.pendingPayment.powerCost.reduce((sum, cost) => sum + cost.amount, 0), 2);
  for (const runeCard of player.runes.slice(0, 2)) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "power").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.ok(game.actionChain, "both targets are fixed before the spell enters the Chain");
  assert.equal(game.pendingChoice, null);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice, null, "resolving the first damage cannot open another target or reaction choice");
  assert.equal(target.damage, 6);
});

test("Falling Star charges Deflect once for each time the same unit is chosen", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = instance(cards.vexApathetic, opponent.id, "falling-star-deflect-target");
  const spell = instance(cards.fallingStar, player.id, "falling-star-deflect-spell");
  opponent.base = [target];
  player.hand = [spell];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.FURY, player.id, `falling-star-deflect-rune-${index}`));

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.ok(game.pendingPayment);
  assert.equal(game.pendingPayment.powerCost.reduce((sum, cost) => sum + cost.amount, 0), 4);
});

test("a spell replayed from trash is recycled exactly once after its Chain resolution", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const fizz = instance(cards.fizzTrickster, player.id, "trash-replay-fizz");
  const spell = instance(cards.turnToDust, player.id, "trash-replay-spell");
  player.hand = [fizz];
  player.trash = [spell];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `trash-replay-rune-${index}`));

  assert.equal(playCard(game, fizz.instanceId, "base").ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice?.effect, "playTrashSpell");
  assert.equal(chooseEffectOption(game, spell.instanceId).ok, true);
  assert.equal(game.actionChain?.chain.length, 1);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);

  assert.equal(player.mainDeck.filter((card) => card.instanceId === spell.instanceId).length, 1);
  assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), false);
});

test("attack designation cleanup kills a unit made lethal by Ahri's Might reduction", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = game.battlefields[0];
  const sett = instance(cards.settKingpin, attacker.id, "ahri-lethal-attacker");
  const blocker = instance(cards.lonelyPoro, defender.id, "ahri-lethal-blocker");
  defender.legend = instance(cards.ahriNineTailedFox, defender.id, "ahri-lethal-legend");
  sett.damage = 4;
  attacker.base = [sett];
  field.units = [blocker];
  field.controlledBy = defender.id;

  assert.equal(moveUnit(game, sett.instanceId, field.instanceId).ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === sett.instanceId), true,
    "Ahri's reduction waits on the showdown chain");
  assert.equal(game.showdown?.chain.some((item) =>
    item.trigger?.kind === "attackOrDefendModifyUnit" && item.trigger.sourceCardId === "ahri-lethal-legend"), true);
  for (let guard = 0; field.units.some((unit) => unit.instanceId === sett.instanceId) && game.showdown && guard < 10; guard += 1) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }
  assert.equal(field.units.some((unit) => unit.instanceId === sett.instanceId), false);
  assert.equal(attacker.trash.some((card) => card.instanceId === sett.instanceId), true);
});

test("Star-Crossed finishes normally when no enemy unit exists", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const spell = instance(cards.starCrossed, player.id, "star-crossed-no-enemy");
  player.base = [instance(cards.lonelyPoro, player.id, "star-crossed-friendly")];
  opponent.base = [];
  for (const field of game.battlefields) field.units = [];

  assert.doesNotThrow(() => resolveEffect(game, player, spell));
  assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), true);
});

test("spell effects deal damage and check lethal state", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "enemy-unit");
  const field = game.battlefields[0];
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "unchecked-power")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "r1"),
    rune(DOMAINS.MIND, player.id, "r2"),
    rune(DOMAINS.MIND, player.id, "r3"),
    rune(DOMAINS.MIND, player.id, "r4"),
    rune(DOMAINS.MIND, player.id, "r5"),
    rune(DOMAINS.MIND, player.id, "r6"),
    rune(DOMAINS.MIND, player.id, "r7"),
    rune(DOMAINS.CHAOS, player.id, "r8"),
    rune(DOMAINS.CHAOS, player.id, "r9")
  ];

  assert.equal(playCard(game, "unchecked-power", "base").ok, true);
  assert.equal(field.units.length, 0);
  assert.equal(opponent.trash[0].name, "Ravenbloom Student");
});

test("a self-buff spell trigger does not modify its source after that source leaves the board", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const student = instance(cards.ravenbloomStudent, player.id, "departed-ravenbloom-student");
  const field = game.battlefields[0];
  field.units = [student];
  field.controlledBy = player.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "self-clearing-unchecked-power")];
  player.runes = Array.from({ length: 9 }, (_, index) =>
    rune(index < 2 ? DOMAINS.MIND : DOMAINS.CHAOS, player.id, `self-clearing-rune-${index}`));

  assert.equal(playCard(game, "self-clearing-unchecked-power", "base").ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === student.instanceId), false);
  assert.equal(player.trash.some((card) => card.instanceId === student.instanceId), true);
  assert.equal(student.mightModifier, 0);
  assert.equal(student.temporaryMight, undefined);
});

test("the winning point cannot come from a single conquest", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "unit-win-limit");
  player.base = [unit];
  player.score = 7;
  player.mainDeck = [instance(cards.clockworkKeeper, player.id, "draw-card")];
  const handBefore = player.hand.length;

  assert.equal(moveUnit(game, unit.instanceId, game.battlefields[0].instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(player.score, 7);
  assert.equal(player.hand.length, handBefore + 1);
  assert.equal(game.phase, "action");
});

test("Conquer and Hunt trigger exactly when the battlefield is scored", () => {
  const makeHunter = (ownerId, id) => {
    const hunter = instance(cards.masterYiTempered, ownerId, id);
    hunter.keywords = ["Hunt"];
    hunter.text = "[Hunt 2]";
    return hunter;
  };

  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const field = game.battlefields[0];
    const hunter = makeHunter(player.id, "already-scored-hunter");
    player.base = [hunter];
    player.xp = 0;
    player.turnScoredBattlefields.push(field.instanceId);
    field.controlledBy = opponent.id;
    field.units = [];

    assert.equal(moveUnit(game, hunter.instanceId, field.instanceId).ok, true);
    assert.equal(passShowdown(game, player.id).ok, true);
    assert.equal(passShowdown(game, opponent.id).ok, true);
    assert.equal(player.xp, 0,
      "changing control of an already-scored battlefield is not another Conquer score event");
  }

  {
    const game = createGame();
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const field = game.battlefields[0];
    const hunter = makeHunter(player.id, "winning-conquer-hunter");
    player.base = [hunter];
    player.score = 7;
    player.xp = 0;
    player.mainDeck = [instance(cards.clockworkKeeper, player.id, "winning-conquer-draw")];
    field.controlledBy = null;
    field.units = [];

    assert.equal(moveUnit(game, hunter.instanceId, field.instanceId).ok, true);
    assert.equal(passShowdown(game, player.id).ok, true);
    assert.equal(passShowdown(game, opponent.id).ok, true);
    assert.equal(player.score, 7);
    assert.equal(player.xp, 2,
      "a winning Conquer replaced with a draw is still a scored Conquer for triggered abilities");
  }
});

test("holding a battlefield can score the winning point", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, player.id, "holder")];
  field.controlledBy = player.id;
  player.score = 7;

  startTurn(game);

  assert.equal(player.score, 8);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
});

test("aspirant's climb increases the points needed to win", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = {
    ...instance(cards.aspirantsClimb, player.id, "explicit-aspirants-climb"),
    controlledBy: player.id,
    hidden: [],
    units: [instance(cards.lonelyPoro, player.id, "aspirants-holder")]
  };
  game.battlefields[0] = field;
  player.score = 7;

  startTurn(game);

  assert.equal(player.score, 8);
  assert.equal(game.phase, "action");

  startTurn(game);

  assert.equal(player.score, 9);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
});

test("aspirant's climb also raises the conquest winning-point threshold", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const climb = {
    ...instance(cards.aspirantsClimb, player.id, "conquest-threshold-climb"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = climb;
  const target = game.battlefields[1];
  target.controlledBy = null;
  target.units = [];
  const unit = instance(cards.lonelyPoro, player.id, "conquest-threshold-unit");
  player.base = [unit];
  player.score = 7;
  player.hand = [];
  player.mainDeck = [instance(cards.charm, player.id, "conquest-threshold-no-draw")];

  assert.equal(moveUnit(game, unit.instanceId, target.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(player.score, 8);
  assert.equal(player.hand.length, 0);
  assert.equal(player.mainDeck.length, 1);
});

test("back-alley bar buffs a unit that moves from it", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "bar-unit");
  const field = {
    ...instance(cards.backAlleyBar, player.id, "explicit-back-alley"),
    controlledBy: player.id,
    hidden: [],
    units: [unit]
  };
  game.battlefields[0] = field;

  assert.equal(moveUnit(game, "bar-unit", "base").ok, true);
  assert.equal(unit.mightModifier, 1);
  assert.equal(unit.temporaryMight, 1);
  assert.equal(player.base.some((card) => card.instanceId === "bar-unit"), true);
});

test("monastery of hirana pays its Buff trigger cost before the draw resolves", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.lonelyPoro, player.id, "monastery-unit");
  const drawn = instance(cards.gust, player.id, "monastery-draw");
  const field = {
    ...instance(cards.monasteryOfHirana, opponent.id, "explicit-monastery"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  unit.buffs = 1;
  game.battlefields[0] = field;
  player.base = [unit];
  player.hand = [instance({
    ...cards.charm,
    id: "TEST-MONASTERY-REACTION",
    cardNumber: "TEST-MONASTERY-REACTION/001",
    collectorNumber: "TEST-MONASTERY-REACTION/001",
    name: "Rules Test Monastery Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, player.id, "monastery-controller-reaction")];
  opponent.hand = [];
  player.mainDeck = [drawn];

  assert.equal(moveUnit(game, "monastery-unit", "explicit-monastery").ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "declareTriggerCost");
  assert.equal(game.actionChain.chain.at(-1).status, "pending");

  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(unit.buffs, 0);
  assert.equal(player.hand.some((card) => card.instanceId === "monastery-draw"), false);
  assert.equal(game.actionChain.chain.at(-1).status, "finalized");

  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "monastery-draw"), true);
});

test("monastery of hirana does not offer its optional trigger without a friendly Buff", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const unit = instance(cards.lonelyPoro, player.id, "unbuffed-monastery-unit");
  const field = {
    ...instance(cards.monasteryOfHirana, opponent.id, "unbuffed-monastery"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  player.base = [unit];

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);

  assert.equal(player.score, 1);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.actionChain, null);
});

test("multiplayer JSON snapshots finish a buffed Monastery of Hirana conquest", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const unit = instance(cards.lonelyPoro, player.id, "online-monastery-unit");
  unit.buffs = 1;
  const field = {
    ...instance(cards.monasteryOfHirana, opponent.id, "online-monastery"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  player.base = [unit];
  player.hand = [];
  opponent.hand = [];
  const room = {
    roomId: "HIRANA-ONLINE",
    status: "playing",
    hostPlayerId: "p1",
    sideboardingEnabled: false,
    match: null,
    seats: { p1: { ready: true }, p2: { ready: true } },
    game,
    commandSeq: 0,
    createdAt: 0,
    updatedAt: 0
  };

  assert.equal(applyGameCommand(room, player.id, {
    kind: "moveUnit",
    unitId: unit.instanceId,
    destinationId: field.instanceId
  }).ok, true);

  for (let pass = 0; pass < 2; pass += 1) {
    const actorId = game.showdown.priorityPlayerId;
    const clientGame = snapshotForPlayer(room, actorId).game;
    const clientPlayer = clientGame.players.find((candidate) => candidate.id === actorId);
    assert.equal(Array.isArray(clientPlayer.turnScoredBattlefields), true);
    assert.equal(clientGame.authoritativeActorId, actorId);
    assert.doesNotThrow(() => resolveLegalAction(clientGame, { kind: "passShowdown" }, actorId));
    assert.equal(applyGameCommand(room, actorId, { kind: "passShowdown" }).ok, true);
  }

  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(game.pendingChoice.playerId, player.id);
  assert.equal(player.turnScoredBattlefields.includes(field.instanceId), true);
  const opponentView = snapshotForPlayer(room, opponent.id).game;
  assert.equal(opponentView.pendingChoice, null);
  assert.equal(opponentView.authoritativeActorId, player.id,
    "the opponent must still know whose private decision is blocking play");
});

test("multiplayer command resolution does not execute unrelated broken card candidates", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = null;
  game.pendingChoice = null;
  game.pendingPayment = null;
  game.battlefields = [];
  player.hand = [instance({
    ...cards.charm,
    effects: {}
  }, player.id, "unrelated-malformed-card")];

  assert.deepEqual(resolveLegalAction(game, { kind: "endTurn" }, player.id), { kind: "endTurn" });
});

test("multiplayer batch movement accepts the explicitly selected unit set in any click order", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const target = game.battlefields[0];
  target.units = [];
  target.controlledBy = null;
  player.base = Array.from({ length: 5 }, (_, index) =>
    instance(cards.lonelyPoro, player.id, `online-batch-${index + 1}`));
  const selectedIds = player.base.slice(0, 4).reverse().map((unit) => unit.instanceId);
  const command = { kind: "moveUnits", unitIds: selectedIds, destinationId: target.instanceId };

  assert.deepEqual(resolveLegalAction(game, command, player.id), command);
  assert.equal(applyGameCommand({ game, hostPlayerId: player.id }, player.id, command).ok, true);
  assert.deepEqual(target.units.map((unit) => unit.instanceId).sort(), [...selectedIds].sort());
});

test("the candlelit sanctum recycles selected top deck cards after conquest", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.lonelyPoro, player.id, "sanctum-unit");
  const top = instance(cards.charm, player.id, "sanctum-top");
  const second = instance(cards.gust, player.id, "sanctum-second");
  const third = instance(cards.flash, player.id, "sanctum-third");
  const field = {
    ...instance(cards.theCandlelitSanctum, opponent.id, "explicit-sanctum"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  player.base = [unit];
  player.mainDeck = [top, second, third];

  assert.equal(moveUnit(game, "sanctum-unit", "explicit-sanctum").ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(game.pendingChoice.effect, "recycleTopDeck");

  assert.equal(chooseEffectOption(game, "recycle-0").ok, true);
  assert.deepEqual(player.mainDeck.map((card) => card.instanceId), ["sanctum-second", "sanctum-third", "sanctum-top"]);
});

test("the syren pays one energy and recalls a friendly battlefield unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "syren-unit");
  const syren = instance(cards.theSyren, player.id, "explicit-syren");
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [unit];
  player.base = [syren];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "syren-rune")];

  assert.equal(activateCard(game, "explicit-syren").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "syren-unit").ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, "syren-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(player.base.some((card) => card.instanceId === "syren-unit"), true);
  assert.equal(field.units.length, 0);
  assert.equal(unit.exhausted, false, "an effect Move preserves the moved unit's Ready state");
  assert.equal(syren.exhausted, true);
});

test("effect Moves use the shared movement event and send controlled units to their controller's base", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== player.id);
  const unit = instance(cards.yasuoWindrider, owner.id, "controlled-effect-mover");
  unit.controllerId = player.id;
  unit.movesThisTurn = 2;
  const syren = instance(cards.theSyren, player.id, "effect-move-syren");
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [unit];
  player.base = [syren];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "effect-move-rune")];
  player.score = 0;

  assert.equal(activateCard(game, syren.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "effect-move-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(owner.base.some((card) => card.instanceId === unit.instanceId), false);
  assert.equal(unit.exhausted, false);
  assert.equal(unit.movesThisTurn, 3);
  assert.equal(player.score, 1);
  assert.equal(game.moveEvents.at(-1).destinationType, "base");
  assert.equal(game.moveEvents.at(-1).destinationId, player.id,
    "the Move action itself reaches the current controller's base before Cleanup");
});

test("the grand plaza wins when held with seven friendly units", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const units = Array.from({ length: 7 }, (_, index) => instance(cards.lonelyPoro, player.id, `plaza-unit-${index}`));
  const field = {
    ...instance(cards.theGrandPlaza, player.id, "explicit-grand-plaza"),
    controlledBy: player.id,
    hidden: [],
    units
  };
  game.battlefields[0] = field;

  startTurn(game);

  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
});

test("fortified position gives a defending unit shield 2", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const defender = instance(cards.lonelyPoro, opponent.id, "fortified-defender");
  const attacker = instance(cards.lonelyPoro, player.id, "fortified-attacker");
  const field = {
    ...instance(cards.fortifiedPosition, opponent.id, "explicit-fortified"),
    controlledBy: opponent.id,
    hidden: [],
    units: [defender]
  };
  game.battlefields[0] = field;
  player.base = [attacker];

  assert.equal(moveUnit(game, "fortified-attacker", "explicit-fortified").ok, true);
  assert.equal(game.pendingChoice.effect, "giveKeyword");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.equal(chooseEffectOption(game, "fortified-defender").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(defender.temporaryKeywords.includes("Shield"), true);
  assert.equal(defender.temporaryShieldAmount, 2);
});

test("reaver's row can recall a friendly defender to base", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const defender = instance(cards.lonelyPoro, opponent.id, "reaver-defender");
  const attacker = instance(cards.lonelyPoro, player.id, "reaver-attacker");
  const field = {
    ...instance(cards.reaversRow, opponent.id, "explicit-reavers-row"),
    controlledBy: opponent.id,
    hidden: [],
    units: [defender]
  };
  game.battlefields[0] = field;
  player.base = [attacker];

  assert.equal(moveUnit(game, "reaver-attacker", "explicit-reavers-row").ok, true);
  assert.equal(game.pendingChoice.effect, "returnUnitToBase");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.equal(chooseEffectOption(game, "reaver-defender").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "reaver-defender"), false);
  assert.equal(opponent.base.some((unit) => unit.instanceId === "reaver-defender"), true);
});

test("vilemaw's lair prevents units from moving from there to base", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = {
    ...instance(cards.vilemawsLair, player.id, "explicit-vilemaw-lair"),
    controlledBy: player.id,
    hidden: [],
    units: [instance(cards.lonelyPoro, player.id, "lair-unit")]
  };
  game.battlefields[0] = field;

  const result = moveUnit(game, "lair-unit", "base");

  assert.equal(result.ok, false);
  assert.match(result.message, /prevents units from moving to base/);
  assert.equal(field.units.some((unit) => unit.instanceId === "lair-unit"), true);
  assert.equal(player.base.some((unit) => unit.instanceId === "lair-unit"), false);
});

test("vilemaw's lair prevents Flash from moving units there to base", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = {
    ...instance(cards.vilemawsLair, player.id, "flash-vilemaw-lair"),
    controlledBy: player.id,
    hidden: [],
    units: [instance(cards.lonelyPoro, player.id, "flash-lair-unit")]
  };
  game.battlefields[0] = field;
  player.hand = [instance(cards.flash, player.id, "flash-blocked-by-lair")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "flash-lair-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "flash-lair-energy-two")
  ];

  const result = beginPlayCard(game, "flash-blocked-by-lair", "base");

  assert.equal(result.ok, true);
  assert.equal(game.pendingPayment.cardId, "flash-blocked-by-lair");
  assert.equal(field.units.some((unit) => unit.instanceId === "flash-lair-unit"), true);
});

test("Flash declares up to two friendly battlefield units before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance(cards.lonelyPoro, player.id, "flash-first-target");
  const second = instance(cards.ravenbloomStudent, player.id, "flash-second-target");
  field.units = [first, second];
  field.controlledBy = player.id;
  player.hand = [instance(cards.flash, player.id, "flash-declared-targets")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "flash-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "flash-energy-two")
  ];

  assert.equal(beginPlayCard(game, "flash-declared-targets", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "flash-first-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "flash-second-target").ok, true);
  assert.equal(game.pendingPayment.cardId, "flash-declared-targets");
  assert.deepEqual(game.pendingPayment.declaredTargets.map((target) => target.targetId), ["flash-first-target", "flash-second-target"]);

  assert.equal(togglePaymentRune(game, "flash-energy-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "flash-energy-two", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((unit) => unit.instanceId === "flash-first-target"), true);
  assert.equal(player.base.some((unit) => unit.instanceId === "flash-second-target"), true);
});

test("Meditation chooses and pays its optional exhaust cost before resolving", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "meditation-cost-unit");
  player.base = [unit];
  player.hand = [instance(cards.meditation, player.id, "timed-meditation")];
  player.mainDeck = [
    instance(cards.lonelyPoro, player.id, "meditation-draw-one"),
    instance(cards.scuttleCrab, player.id, "meditation-draw-two")
  ];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "meditation-rune-one"),
    rune(DOMAINS.CALM, player.id, "meditation-rune-two")
  ];

  assert.equal(beginPlayCard(game, "timed-meditation", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "meditation-rune-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "meditation-rune-two", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(unit.exhausted, true);
  assert.equal(player.hand.length, 2);
});

test("Fox-Fire declares its battlefield and complete unit set before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const first = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "fox-fire-first");
  const second = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "fox-fire-second");
  const spared = instance({ ...cards.ravenbloomStudent, might: 4 }, opponent.id, "fox-fire-spared");
  field.units = [first, second, spared];
  player.hand = [instance({ ...cards.foxFire, energy: 0, power: [] }, player.id, "timed-fox-fire")];

  assert.equal(beginPlayCard(game, "timed-fox-fire", "base").ok, true);
  assert.equal(chooseEffectOption(game, field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(field.units.some((card) => card.instanceId === spared.instanceId), true);
});

test("Bullet Time fixes its battlefield and exact Rune cards before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "bullet-time-enemy");
  field.units = [enemy];
  player.hand = [instance({ ...cards.bulletTime, energy: 0, power: [] }, player.id, "timed-bullet-time")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.BODY, player.id, `bullet-time-rune-${index}`));

  assert.equal(beginPlayCard(game, "timed-bullet-time", "base").ok, true);
  assert.equal(chooseEffectOption(game, field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "bullet-time-rune-0").ok, true);
  assert.equal(chooseEffectOption(game, "bullet-time-rune-2").ok, true);
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(enemy.damage, 0);
  assert.equal(opponent.trash.some((card) => card.instanceId === enemy.instanceId), true);
  assert.deepEqual(player.runes.map((candidate) => candidate.instanceId), ["bullet-time-rune-1"]);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "bullet-time-rune-0"), true);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "bullet-time-rune-2"), true);
});

test("permanent additional costs are paid before the permanent enters play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const victim = instance(cards.lonelyPoro, player.id, "patron-cost-victim");
  player.base = [victim];
  player.hand = [instance({ ...cards.cruelPatron, energy: 0, power: [] }, player.id, "timed-cruel-patron")];

  assert.equal(beginPlayCard(game, "timed-cruel-patron", "base").ok, true);
  assert.equal(chooseEffectOption(game, victim.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === victim.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === "timed-cruel-patron"), true);
});

test("a replaced Kill additional cost remains paid and resumes the card-play process", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const victim = instance(cards.lonelyPoro, player.id, "replaced-cost-victim");
  const firstZhonya = instance(cards.zhonyasHourglass, player.id, "replaced-cost-zhonya-one");
  const secondZhonya = instance(cards.zhonyasHourglass, player.id, "replaced-cost-zhonya-two");
  const patron = instance({ ...cards.cruelPatron, energy: 0, power: [] }, player.id, "replaced-cost-patron");
  player.base = [victim, firstZhonya, secondZhonya];
  player.hand = [patron];

  assert.equal(beginPlayCard(game, patron.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, victim.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingChoice?.effect, "deathReplacementSource");

  const firstReplacement = game.pendingChoice.options.find((option) => option.cardId === firstZhonya.instanceId);
  assert.ok(firstReplacement);
  assert.equal(chooseEffectOption(game, firstReplacement.id).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === victim.instanceId), true);
  assert.equal(victim.exhausted, true);
  assert.equal(player.trash.some((card) => card.instanceId === firstZhonya.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === patron.instanceId), true,
    "rule 357.2.a treats the replaced death cost as paid and completes the play");
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
});

test("Brazen Buccaneer applies its declared discard cost reduction", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const discarded = instance(cards.lonelyPoro, player.id, "buccaneer-cost-card");
  player.hand = [
    instance({ ...cards.brazenBuccaneer, energy: 2 }, player.id, "timed-brazen-buccaneer"),
    discarded
  ];

  assert.equal(beginPlayCard(game, "timed-brazen-buccaneer", "base").ok, true);
  assert.equal(chooseEffectOption(game, discarded.instanceId).ok, true);
  assert.equal(game.pendingPayment.energyCost, 0);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === "timed-brazen-buccaneer"), true);
});

test("non-showdown chain returns to the turn player when the chain empties", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const source = instance(cards.stackedDeck, player.id, "neutral-chain-spell");
  player.base = [source];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [finalizedTriggerItem(source, player.id, "neutral-chain-item")]
  };

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, player.id);
});

test("non-showdown chain gives Priority to the newest remaining item's controller", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const first = instance(cards.stackedDeck, opponent.id, "neutral-chain-first");
  const second = instance(cards.flash, player.id, "neutral-chain-second");
  game.manualActionChainPriority = true;
  opponent.hand = [instance({ ...cards.flash, effects: [] }, opponent.id, "neutral-chain-response")];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "neutral-chain-response-rune-1"),
    rune(DOMAINS.CHAOS, opponent.id, "neutral-chain-response-rune-2")
  ];
  player.base = [first];
  opponent.base = [second];
  const emptyControlledField = game.battlefields[1];
  emptyControlledField.units = [];
  emptyControlledField.controlledBy = player.id;
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 2,
    chain: [
      finalizedTriggerItem(first, opponent.id, "neutral-chain-bottom"),
      finalizedTriggerItem(second, player.id, "neutral-chain-top")
    ]
  };

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.ok(game.actionChain);
  assert.equal(game.actionChain.chain.length, 1);
  assert.equal(game.actionChain.priorityPlayerId, opponent.id);
  assert.equal(game.currentPlayerId, opponent.id);
  assert.equal(emptyControlledField.controlledBy, player.id,
    "rule 323.6 does not remove control while the remaining Chain keeps the turn Closed");

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(emptyControlledField.controlledBy, null,
    "the next Open-state cleanup removes control from the empty battlefield");
});

test("hard bargain can declare a Sabotage on an action chain", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sabotage = instance(cards.sabotage, opponent.id, "action-chain-sabotage");
  const bargain = instance(cards.hardBargain, player.id, "action-chain-bargain");
  player.hand = [bargain];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "action-chain-bargain-rune-1"),
    rune(DOMAINS.CHAOS, player.id, "action-chain-bargain-rune-2")
  ];
  game.actionChain = {
    turnPlayerId: opponent.id,
    playerIds: [opponent.id, player.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{ card: sabotage, playerId: opponent.id, destination: "base", state: "finalized" }]
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, bargain.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [sabotage.instanceId]);
});

test("non-showdown unit on-play trigger chain empties back to the turn player only", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const unit = instance(cards.clockworkKeeper, player.id, "onplay-chain-unit");
  player.base = [unit];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [finalizedTriggerItem(unit, player.id, "onplay-chain-item")]
  };

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(game.currentPlayerId, player.id);
});

test("a Showdown Chain opened by a triggered ability does not pass Focus when it empties", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const source = instance(cards.lonelyPoro, attacker.id, "showdown-empty-source");
  game.battlefields[0].units = [source];
  game.phase = "showdown";
  game.currentPlayerId = defender.id;
  game.showdown = {
    battlefieldId: game.battlefields[0].instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: attacker.id,
    priorityPlayerId: defender.id,
    consecutivePasses: 1,
    chainSequence: 1,
    suppressFocusPassOnEmpty: true,
    chain: [finalizedTriggerItem(source, attacker.id, "showdown-empty-item")]
  };

  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.ok(game.showdown);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(game.showdown.focusPlayerId, attacker.id);
  assert.equal(game.showdown.priorityPlayerId, attacker.id);
});

test("a Showdown Chain opened by a played card passes Focus when it empties", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const spell = instance({ ...cards.incinerate, effects: [] }, attacker.id, "showdown-card-focus-item");
  game.phase = "showdown";
  game.currentPlayerId = defender.id;
  game.showdown = {
    battlefieldId: game.battlefields[0].instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: attacker.id,
    priorityPlayerId: defender.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [{
      id: "showdown-card-focus-chain-item",
      itemType: "card",
      card: spell,
      playerId: attacker.id,
      destination: "base",
      status: "finalized"
    }]
  };

  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.ok(game.showdown);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(game.showdown.focusPlayerId, defender.id);
  assert.equal(game.showdown.priorityPlayerId, defender.id);
});

test("showdown chain keeps Focus but gives Priority to the newest remaining item's controller", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const first = instance(cards.lonelyPoro, attacker.id, "showdown-remain-first");
  const second = instance(cards.flash, defender.id, "showdown-remain-second");
  game.battlefields[0].units = [first, second];
  game.phase = "showdown";
  game.currentPlayerId = defender.id;
  game.showdown = {
    battlefieldId: game.battlefields[0].instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: defender.id,
    priorityPlayerId: defender.id,
    consecutivePasses: 1,
    chainSequence: 2,
    chain: [
      finalizedTriggerItem(first, attacker.id, "showdown-remain-bottom"),
      finalizedTriggerItem(second, defender.id, "showdown-remain-top")
    ]
  };

  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.ok(game.showdown);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.focusPlayerId, defender.id);
  assert.equal(game.showdown.priorityPlayerId, attacker.id);
});

test("showdown resolves when both players pass without starting a new chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = game.battlefields[0];
  game.phase = "showdown";
  game.currentPlayerId = attacker.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: attacker.id,
    priorityPlayerId: attacker.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(passShowdown(game, attacker.id).ok, true);
  assert.equal(game.showdown.priorityPlayerId, defender.id);
  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.equal(game.showdown, null);
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, attacker.id);
});

test("semantic lifecycle oracle rejects an orphaned continuation operation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  game.operations.push({ id: "mutant-orphan", kind: "move", status: "pending", data: {} });

  assert.throws(() => validateStableGameState(game), /stable game has pending operations/);
});

test("semantic lifecycle oracle accepts an operation owned by the current choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  game.operations.push({ id: "owned-operation", kind: "move", status: "pending", data: {} });
  game.pendingChoice = {
    id: "owned-choice",
    playerId: game.currentPlayerId,
    card: { name: "Synthetic choice" },
    effect: "synthetic",
    options: [{ id: "continue", label: "Continue" }],
    data: { afterMove: { operationId: "owned-operation" } }
  };

  assert.doesNotThrow(() => validateStableGameState(game));
});

test("a death-trigger ordering choice owns and resumes an interrupted additional-cost payment", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const patron = instance({ ...cards.cruelPatron, energy: 0 }, player.id, "death-cost-patron");
  const evangel = instance(cards.machineEvangel, player.id, "death-cost-evangel");
  player.legend = instance(cards.viktorLeader, player.id, "death-cost-viktor");
  player.base = [evangel];
  player.hand = [patron];

  assert.equal(beginPlayCard(game, patron.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "killFriendlyUnitAdditionalCost");
  assert.equal(chooseEffectOption(game, evangel.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  assert.equal(game.actionChain.chain.find((item) => item.card === patron)?.playOptions?.declarationsComplete, false);
  assert.doesNotThrow(() => validateStableGameState(game));

  selectAndConfirmTriggerOrder(game);
  const pendingPatron = game.actionChain?.chain.find((item) => item.card === patron);
  assert.ok(player.base.includes(patron) || pendingPatron?.playOptions?.declarationsComplete === true);
  assert.equal(game.pendingPayment, null);
  assert.doesNotThrow(() => validateStableGameState(game));
});

test("semantic lifecycle oracle accepts a Pending card owned by a nested continuation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const card = instance(cards.hiddenBlade, player.id, "nested-owned-pending-card");
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    continuation: null,
    chain: [{
      id: "nested-owned-pending-item",
      itemType: "card",
      card,
      playerId: player.id,
      destination: "base",
      status: "pending",
      playOptions: {
        declarationsComplete: false,
        playProcess: { source: "hand" }
      }
    }]
  };
  game.pendingChoice = {
    id: "nested-owner-choice",
    playerId: player.id,
    card,
    effect: "triggerOrder",
    options: [{ id: "continue", label: "Continue" }],
    data: {
      triggerOrderState: {
        continuation: {
          kind: "resumeAfterTriggerPlacement",
          continuation: {
            kind: "resumeConfirmedPayment",
            payment: { playProcess: { chainItemId: "nested-owned-pending-item" } }
          }
        }
      }
    }
  };

  assert.doesNotThrow(() => validateStableGameState(game));
});

test("semantic lifecycle oracle rejects a Pending card with no declaration owner", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const card = instance(cards.hiddenBlade, player.id, "orphaned-pending-card");
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    continuation: null,
    chain: [{
      id: "orphaned-pending-item",
      itemType: "card",
      card,
      playerId: player.id,
      destination: "base",
      status: "pending",
      playOptions: {
        declarationsComplete: false,
        playProcess: { source: "hand" }
      }
    }]
  };

  assert.throws(() => validateStableGameState(game), /incomplete declarations without a choice or payment owner/);
  assert.equal(passShowdown(game, player.id).ok, false);
  assert.equal(game.actionChain.consecutivePasses, 0);
});

test("semantic flow oracle rejects opposing units without a staged combat", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  game.battlefields[0].units = [
    instance(cards.lonelyPoro, attacker.id, "mutant-attacker"),
    instance(cards.lonelyPoro, defender.id, "mutant-defender")
  ];
  game.stagedEvents = [];

  assert.throws(() => validateStableGameState(game), /have no showdown or staged combat/);
});

test("printed multi-part card text is fully represented by shared effects", () => {
  const expected = new Map([
    [cards.ironBallista.cardNumber, ["static:entersExhausted", "activated:dealDamageUnit"]],
    [cards.peakGuardian.cardNumber, ["onPlay:buffSelfThenOtherFriendlyHere"]],
    [cards.mageseekerWarden.cardNumber, ["static:opponentsUnitsOnlyToBase", "static:opponentsCannotReadyByEffects"]],
    [cards.forgeOfTheFuture.cardNumber, ["onPlay:playUnitToken", "activated:recycleCardsFromTrashes"]],
    [cards.teemoSwiftScout.cardNumber, ["static:hideWithEnergyInsteadOfPower", "activated:returnOwnedTagUnitToHand"]],
    [cards.saiScout.cardNumber, ["static:canEnterOpenBattlefield"]]
  ]);
  for (const card of Object.values(cards)) {
    const pairs = expected.get(card.cardNumber);
    if (!pairs) continue;
    assert.deepEqual(card.effects.map((effect) => `${effect.timing}:${effect.kind}`), pairs, `${card.name} must implement every printed clause`);
  }
});

test("Iron Ballista enters exhausted and Peak Guardian buffs every other friendly unit at its battlefield", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  const ally = instance(cards.lonelyPoro, player.id, "peak-guardian-ally");
  field.units = [ally];
  const guardian = instance({ ...cards.peakGuardian, energy: 0, power: [] }, player.id, "peak-guardian-source");
  const ballista = instance({ ...cards.ironBallista, energy: 0, power: [] }, player.id, "exhausted-ballista");
  player.hand = [guardian, ballista];
  player.runes = [];

  assert.equal(playCard(game, guardian.instanceId, field.instanceId).ok, true);
  assert.equal(guardian.buffs, 1);
  assert.equal(ally.buffs, 1);
  assert.equal(playCard(game, ballista.instanceId, "base").ok, true);
  assert.equal(ballista.exhausted, true);
});

test("Mageseeker Warden prevents opposing spells and abilities from readying units or gear", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const warden = instance(cards.mageseekerWarden, opponent.id, "ready-lock-warden");
  const target = instance(cards.lonelyPoro, player.id, "ready-lock-target");
  target.exhausted = true;
  game.battlefields[0].units = [warden];
  game.battlefields[0].controlledBy = opponent.id;
  player.base = [target];
  const readySpell = instance({
    ...cards.wallop,
    name: "Ready Lock Test",
    effects: [{ timing: "spell", kind: "readyUnitAny" }]
  }, player.id, "ready-lock-spell");

  assert.equal(resolveEffect(game, player, readySpell), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.exhausted, true);
});

test("Teemo's legend ability lets its controller choose Energy instead of Power to hide", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  player.legend = instance(cards.teemoSwiftScout, player.id, "hide-energy-teemo");
  field.controlledBy = player.id;
  const hiddenCard = instance({ ...cards.backOff, energy: 0, power: [] }, player.id, "hide-energy-card");
  player.hand = [hiddenCard];

  assert.equal(hideCard(game, hiddenCard.instanceId, field.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "chooseHideCost");
  assert.equal(chooseEffectOption(game, "energy").ok, true);
  assert.equal(game.pendingPayment?.energyCost, 1);
  assert.deepEqual(game.pendingPayment?.powerCost, []);
});

test("Forge of the Future kills itself and can recycle up to four cards across all trashes", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const forge = instance(cards.forgeOfTheFuture, player.id, "future-forge-source");
  const ownTrash = instance(cards.lonelyPoro, player.id, "future-forge-own-trash");
  const enemyTrash = instance(cards.gust, opponent.id, "future-forge-enemy-trash");
  player.base = [forge];
  player.trash = [ownTrash];
  opponent.trash = [enemyTrash];

  assert.equal(activateCard(game, forge.instanceId).ok, true);
  assert.equal(player.base.includes(forge), false);
  assert.equal(player.trash.includes(forge), true, "killing the Forge is an activation cost");
  assert.equal(game.pendingChoice?.effect, "recycleCardsFromTrashes");
  assert.equal(game.pendingChoice.options.some((option) => option.id === enemyTrash.instanceId), true);
  assert.equal(chooseEffectOption(game, enemyTrash.instanceId).ok, true);
  assert.equal(opponent.trash.includes(enemyTrash), false);
  assert.equal(opponent.mainDeck.includes(enemyTrash), true, "a recycled enemy card returns to its owner's Main Deck");
  assert.equal(declineEffectChoice(game).ok, true, "up to four allows stopping after any number");
  assert.equal(player.trash.includes(ownTrash), true);
});

test("Sai Scout can be played directly to an open battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.units = [];
  field.controlledBy = null;
  const scout = instance({ ...cards.saiScout, energy: 0, power: [] }, player.id, "sai-open-field");
  player.hand = [scout];

  assert.equal(legalCardPlayDestinations(game, scout.instanceId).includes(field.instanceId), true);
});
