import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import { effectDefinition, effectKey } from "../src/effects/registry.mjs";
import { effectIsEnabledByMutation } from "../src/effects/runtime.mjs";
import {
  activateCard,
  applyDamage,
  beginPlayCard,
  beginPlayCardFromTrash,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmPayment,
  createGame,
  currentCombatMight,
  currentMight,
  currentPlayer,
  endTurn,
  moveUnit,
  passShowdown,
  playCard,
  playChampion,
  resolveEffect,
  selectBattlefield,
  selectChampion,
  skipMulligan,
  startTurn,
  togglePaymentPoolEnergy,
  togglePaymentRune
} from "../src/engine.mjs";
import { translateCardName, translateCardText } from "../src/i18n.mjs";
import { OFFICIAL_TOKEN_DEFINITIONS } from "../src/rules/tokens.mjs";
import { cardStatusItems } from "../src/ui/card-status.mjs";

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

function settleAllChains(game) {
  for (let guard = 0; guard < 80; guard += 1) {
    if (game.pendingChoice || game.pendingPayment) break;
    const chain = game.showdown || game.actionChain;
    if (!chain) break;
    assert.equal(passShowdown(game, chain.priorityPlayerId).ok, true);
  }
}

function prepareShurikenFlipFlowChain() {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const flowSpell = instance(cards.ven140shurikenFlip, player.id, "shuriken-flow");
  flowSpell.effects = flowSpell.effects.map((effect) => effect.kind === "playSelfFromTrash"
    ? { ...effect, replacementEnergy: 0, replacementPower: [] }
    : effect);
  const movingUnit = instance(cards.lonelyPoro, player.id, "shuriken-mover");
  const damageTarget = instance(cards.lonelyPoro, opponent.id, "shuriken-target");
  const targetField = game.battlefields.find((field) => field.controlledBy === opponent.id) || game.battlefields[0];
  const destination = game.battlefields.find((field) => field.controlledBy === player.id)
    || game.battlefields.find((field) => field.instanceId !== targetField.instanceId);

  player.hand = [];
  player.trash = [flowSpell];
  player.base = [movingUnit];
  player.runes = [];
  targetField.units = [damageTarget];

  assert.equal(beginPlayCardFromTrash(game, flowSpell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, damageTarget.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, movingUnit.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  const chainItem = game.actionChain?.chain.find((item) => item.card?.instanceId === flowSpell.instanceId);
  assert.equal(chainItem?.status, "finalized");
  assert.equal(flowSpell.playedForFlowCost, true);
  return { game, player, opponent, flowSpell };
}

function confirmAllTriggerOrderChoices(game) {
  assert.equal(game.pendingChoice?.effect, "triggerOrder");
  for (const option of game.pendingChoice.options.filter((candidate) => !candidate.confirmTriggerOrder)) {
    assert.equal(chooseEffectOption(game, option.id).ok, true);
  }
  assert.equal(chooseEffectOption(game, "confirm-trigger-order").ok, true);
}

async function vendettaKoreanText() {
  return JSON.parse(await readFile(new URL("../spec/cards/vendetta-ko-text.json", import.meta.url), "utf8"));
}

test("all 166 Vendetta cards have registered behavior, official art, and authored Korean UI text", async () => {
  const vendetta = Object.values(cards).filter((card) => card.set === "Vendetta");
  const koreanText = await vendettaKoreanText();
  assert.equal(vendetta.length, 166);
  assert.equal(new Set(vendetta.map((card) => card.cardNumber)).size, 166);
  assert.equal(Object.keys(koreanText).length, 166);

  for (const card of vendetta) {
    assert.match(card.cardNumber, /^VEN-\d{3}\/166$/u, card.name);
    assert.match(card.image, /^https:\/\/cmsassets\.rgpub\.io\//u, card.name);
    assert.ok(koreanText[card.cardNumber], `${card.cardNumber} is missing authored Korean rules text`);
    assert.notEqual(translateCardName(card, "ko"), card.name, `${card.cardNumber} is missing a Korean name`);
    assert.equal(translateCardText(card, "ko"), `비공식 번역\n${koreanText[card.cardNumber]}`);
    for (const effect of card.effects || []) {
      assert.ok(effectDefinition(effect), `${card.cardNumber} lacks ${effectKey(effect)} definition`);
      assert.equal(effectIsEnabledByMutation(effect), true, `${card.cardNumber} disables ${effectKey(effect)}`);
    }
  }
});

test("Shuriken Flip played for Flow is banished after normal resolution", () => {
  const { game, player, flowSpell } = prepareShurikenFlipFlowChain();

  settleAllChains(game);

  assert.equal(player.banished.some((card) => card.instanceId === flowSpell.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === flowSpell.instanceId), false);
});

test("a finalized Shuriken Flip played for Flow is banished when countered", () => {
  const { game, player, opponent, flowSpell } = prepareShurikenFlipFlowChain();
  const counter = instance({ ...cards.defy, energy: 0, power: [] }, opponent.id, "shuriken-defy");
  counter.declaredPlayTargets = [{ effect: "counterChainCard", targetId: flowSpell.instanceId }];

  assert.equal(resolveEffect(game, opponent, counter), false);

  assert.equal(player.banished.some((card) => card.instanceId === flowSpell.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === flowSpell.instanceId), false);
  assert.equal(game.actionChain.chain.some((item) => item.card?.instanceId === flowSpell.instanceId), false);
});

test("Abandon cannot return a finalized Flow spell to hand", () => {
  const { game, player, opponent, flowSpell } = prepareShurikenFlipFlowChain();
  const abandon = instance({ ...cards.unl131abandon, energy: 0, power: [] }, opponent.id, "shuriken-abandon");
  abandon.declaredPlayTargets = [{ effect: "unleashedChainSpell", targetId: flowSpell.instanceId }];

  resolveEffect(game, opponent, abandon);

  assert.equal(player.banished.some((card) => card.instanceId === flowSpell.instanceId), true);
  assert.equal(player.hand.some((card) => card.instanceId === flowSpell.instanceId), false);
  assert.equal(player.trash.some((card) => card.instanceId === flowSpell.instanceId), false);
});

test("Lightning Rush draws one looked-at card, trashes the rest, and does not banish a hand play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const rush = instance({ ...cards.ven156lightningRush, energy: 0, power: [] }, player.id, "lightning-rush-hand");
  const first = instance(cards.charm, player.id, "lightning-rush-first");
  const second = instance(cards.gust, player.id, "lightning-rush-second");
  const third = instance(cards.flash, player.id, "lightning-rush-third");
  player.hand = [rush];
  player.mainDeck = [first, second, third];

  assert.equal(playCard(game, rush.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "chooseTopDeck");
  assert.equal(game.pendingChoice?.data?.trashRest, true);
  assert.equal(game.pendingChoice?.options.some((option) => option.id === "decline"), true);
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === first.instanceId), true);
  assert.deepEqual(player.trash.map((card) => card.instanceId).sort(),
    [rush.instanceId, second.instanceId, third.instanceId].sort());
  assert.equal(player.banished.some((card) => card.instanceId === rush.instanceId), false);
  assert.equal(player.mainDeck.length, 0);
});

test("Vendetta declarative costs preserve Baccai and Curator's exact printed restrictions", () => {
  const baccai = cards.ven001baccaiSandspinner;
  const empower = baccai.effects.find((effect) => effect.kind === "empowerSelf");
  const discount = baccai.effects.find((effect) => effect.kind === "costModifier");
  assert.equal(empower?.costEnergy, 5);
  assert.equal(empower?.costOptions, undefined, "Baccai has one printed Empower cost, not a mode choice");
  assert.deepEqual({ energy: discount?.energy, requiresRunesAtMost: discount?.requiresRunesAtMost }, {
    energy: -3,
    requiresRunesAtMost: 4
  });

  const curator = cards.ven145curatorOfTheSands;
  const observer = curator.effects.find((effect) => effect.timing === "cardOrAbilityPlayed");
  assert.deepEqual(observer?.cardTypes, ["unit", "gear"]);
  assert.equal(observer?.includeActivatedAbilities, true);
  assert.equal(observer?.minEnergy, 7);
});

test("Vendetta tokens expose canonical identity, Korean text, and Shadow Clone's attack ability", () => {
  const tentacle = OFFICIAL_TOKEN_DEFINITIONS.tentacle;
  const shadow = OFFICIAL_TOKEN_DEFINITIONS.shadowClone;
  assert.deepEqual({ type: tentacle?.type, might: tentacle?.might, tags: tentacle?.tags }, {
    type: "unit", might: 1, tags: ["Bilgewater"]
  });
  assert.equal(translateCardName(tentacle, "ko"), "촉수");
  assert.match(translateCardText(tentacle, "ko"), /비공식 번역/u);
  assert.deepEqual({ type: shadow?.type, might: shadow?.might }, { type: "unit", might: 0 });
  assert.ok(shadow.effects.some((effect) => effectKey(effect) === "attack:banishOwnTrashUnitGiveSelfKeyword"));
  assert.ok(effectDefinition(shadow.effects[0]));
});

test("Punching Poro discards exactly one card as its Empower activation cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const poro = instance(cards.ven007punchingPoro, player.id, "ven-punching-poro");
  const discarded = instance(cards.charm, player.id, "ven-punching-discard");
  player.base = [poro];
  player.hand = [discarded];

  assert.equal(activateCard(game, poro.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedDiscard");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [discarded.instanceId]);
  assert.equal(chooseEffectOption(game, discarded.instanceId).ok, true);
  assert.equal(game.pendingPayment?.energyCost, 0);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(poro.empoweredCount, 1);
  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  assert.ok(cardStatusItems(poro).some((status) => status.kind === "empowered"));
});

test("Legion Marauder presents and pays either printed Empower cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const marauder = instance(cards.ven074legionMarauder, player.id, "ven-legion-marauder");
  const body = rune(DOMAINS.BODY, player.id, "ven-legion-body");
  player.base = [marauder];
  player.runes = [body];
  player.energy = 1;

  assert.equal(activateCard(game, marauder.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedCostOption");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["cost-0", "cost-1"]);
  assert.equal(chooseEffectOption(game, "cost-1").ok, true);
  assert.equal(game.pendingPayment?.energyCost, 0);
  assert.deepEqual(game.pendingPayment?.powerCost, [{ domain: DOMAINS.BODY, amount: 1 }]);
  assert.equal(togglePaymentRune(game, body.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(marauder.empoweredCount, 1);
  assert.equal(player.runes.length, 0, "a basic rune paid for Power is recycled after it is exhausted");
});

test("Risen Altar lets the user choose whether it reduces Energy or Power", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const altar = {
    ...instance(cards.ven163risenAltar, player.id, "ven-risen-altar"),
    controlledBy: player.id,
    units: [],
    hidden: []
  };
  const dame = instance(cards.ven079dameTheDespoiler, player.id, "ven-dame");
  altar.units = [dame];
  game.battlefields[0] = altar;
  player.runes = Array.from({ length: 5 }, (_, index) =>
    rune(DOMAINS.BODY, player.id, `ven-dame-body-${index + 1}`));

  assert.equal(activateCard(game, dame.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareActivatedEmpowerDiscount");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["energy", "power"]);
  assert.equal(chooseEffectOption(game, "energy").ok, true);
  assert.equal(game.pendingPayment?.energyCost, 4);
  assert.deepEqual(game.pendingPayment?.powerCost, [{ domain: DOMAINS.BODY, amount: 1 }]);
});

test("Hextech Formula and Platewyrm Egg enter exhausted, and Formula can choose enemy gear", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const formula = instance({ ...cards.ven062hextechFormula, energy: 0, power: [] }, player.id, "ven-formula");
  const egg = instance({ ...cards.ven075platewyrmEgg, energy: 0, power: [] }, player.id, "ven-egg");
  player.hand = [formula, egg];

  assert.equal(playCard(game, formula.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(formula.exhausted, true);
  assert.equal(playCard(game, egg.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(egg.exhausted, true);

  formula.exhausted = false;
  const enemyGear = instance(cards.guardianAngel, opponent.id, "ven-enemy-gear");
  opponent.base = [enemyGear];
  assert.equal(activateCard(game, formula.instanceId).ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "empower");
  assert.ok(game.pendingChoice.options.some((option) => option.cardId === enemyGear.instanceId));
});

test("Gangplank pays two Body Power and replaces only enemy chosen disable effects", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const gangplank = instance(cards.ven086gangplankNaval, player.id, "ven-gangplank");
  game.battlefields[0].units = [gangplank];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "ven-gangplank-body-1"),
    rune(DOMAINS.BODY, player.id, "ven-gangplank-body-2")
  ];

  assert.equal(activateCard(game, gangplank.instanceId).ok, true);
  assert.equal(game.pendingPayment?.energyCost, 0);
  assert.deepEqual(game.pendingPayment?.powerCost, [{ domain: DOMAINS.BODY, amount: 2 }]);
  for (const body of player.runes) assert.equal(togglePaymentRune(game, body.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(gangplank.empoweredCount, 1);

  const hostileReturn = instance({ ...cards.rebuke, energy: 0, power: [] }, opponent.id, "ven-hostile-return");
  opponent.hand = [hostileReturn];
  game.currentPlayerId = opponent.id;
  game.turnPlayerId = opponent.id;
  assert.equal(beginPlayCard(game, hostileReturn.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, gangplank.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(game.battlefields[0].units.some((card) => card.instanceId === gangplank.instanceId), true);
  assert.equal(currentMight(game, gangplank), (gangplank.might || 0) + 3);
  assert.equal(gangplank.temporaryMight, 3);

  gangplank.stunned = true;
  const redundantStun = instance({ ...cards.backOff, energy: 0, power: [] }, opponent.id, "ven-redundant-stun");
  opponent.hand = [redundantStun];
  assert.equal(beginPlayCard(game, redundantStun.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, gangplank.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(gangplank.temporaryMight, 3,
    "an already-stunned unit has no new Stun event for Gangplank to replace");
});

test("Wild Claw recycles every looked card when its optional play is declined", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const looked = [
    instance(cards.lonelyPoro, player.id, "ven-wild-1"),
    instance(cards.stalwartPoro, player.id, "ven-wild-2"),
    instance(cards.charm, player.id, "ven-wild-3"),
    instance(cards.gust, player.id, "ven-wild-4"),
    instance(cards.guardianAngel, player.id, "ven-wild-5")
  ];
  player.mainDeck = [...looked];
  const wildClaw = instance(cards.ven089wildClaw, player.id, "ven-wild-claw");

  assert.equal(resolveEffect(game, player, wildClaw), true);
  assert.ok(game.pendingChoice.options.some((option) => option.id === "decline"));
  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.deepEqual(new Set(player.mainDeck.map((card) => card.instanceId)), new Set(looked.map((card) => card.instanceId)));
  assert.equal(player.mainDeck.length, 5);
});

test("Wild Claw can spend Unit-only generated Energy on its reduced Unit play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const selected = instance({ ...cards.lonelyPoro, energy: 6, power: [] }, player.id, "ven-wild-unit-energy");
  player.mainDeck = [
    selected,
    instance(cards.stalwartPoro, player.id, "ven-wild-energy-2"),
    instance(cards.charm, player.id, "ven-wild-energy-3"),
    instance(cards.gust, player.id, "ven-wild-energy-4"),
    instance(cards.guardianAngel, player.id, "ven-wild-energy-5")
  ];
  player.runes = [];
  player.runePool = {
    energy: [{
      id: "ven-wild-unit-only-energy",
      type: "energy",
      domains: ["Any"],
      restriction: "unitOrUnitAbility"
    }],
    power: []
  };
  const wildClaw = instance(cards.ven089wildClaw, player.id, "ven-wild-energy-claw");

  assert.equal(resolveEffect(game, player, wildClaw), true);
  assert.ok(game.pendingChoice.options.some((option) => option.cardId === selected.instanceId));
  assert.equal(chooseEffectOption(game, selected.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "decline").ok, true,
    "declining Empower should continue to the reduced-cost payment");
  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.cardId, selected.instanceId);
  assert.equal(game.pendingPayment?.energyCost, 1);
  assert.equal(togglePaymentPoolEnergy(game, "ven-wild-unit-only-energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
});

test("Vendetta card-play observers honor first, another, non-token, and outside-hand conditions", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const heron = instance(cards.ven044astralHeron, player.id, "ven-heron");
  const leader = instance(cards.ven121reluctantLeader, player.id, "ven-leader");
  const heart = instance(cards.ven155heartOfTheTempest, player.id, "ven-heart");
  field.units = [heron];
  player.base = [leader, heart];

  const first = instance({ ...cards.guardianAngel, energy: 0, power: [] }, player.id, "ven-first-card");
  player.hand = [first];
  assert.equal(playCard(game, first.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(player.nextCardEnergyReduction, 2);
  assert.equal(player.nextCardPowerReduction, 2);
  assert.equal(heart.empoweredCount || 0, 0, "a card played from hand does not empower Heart of the Tempest");

  const otherUnit = instance({ ...cards.lonelyPoro, energy: 0, power: [] }, player.id, "ven-other-unit");
  player.hand = [otherUnit];
  assert.equal(playCard(game, otherUnit.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(leader.temporaryMight, 2);
  assert.equal(player.nextCardEnergyReduction, 0, "Astral Heron triggers only for the first card of the turn");

  const champion = instance({ ...cards.annieFiery, energy: 0, power: [] }, player.id, "ven-outside-hand-champion");
  champion.zone = "champion";
  player.champion = champion;
  player.championPlayed = false;
  assert.equal(playChampion(game, "base").ok, true);
  settleAllChains(game);
  if (game.pendingChoice?.effect === "triggerOrder") {
    confirmAllTriggerOrderChoices(game);
    settleAllChains(game);
  }
  assert.equal(heart.empoweredCount, 1, JSON.stringify({
    message: "playing from the Champion Zone is playing outside the hand",
    championOutsideHand: champion.playingFromOutsideHand,
    cardsPlayed: player.cardsPlayedThisTurn,
    log: game.log.slice(-16)
  }));
});

test("Pit Crew readies when Patched Porobot is played as a unit and gear", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const crew = instance(cards.pitCrew, player.id, "ven-pit-crew");
  const porobot = instance({
    ...cards.ven058patchedPorobot,
    energy: 0,
    power: []
  }, player.id, "ven-patched-porobot");
  crew.exhausted = true;
  player.base = [crew];
  player.hand = [porobot];

  assert.equal(playCard(game, porobot.instanceId, "base").ok, true);
  assert.equal(crew.exhausted, false);
});

test("every card-play Gear observer treats Patched Porobot as Gear", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const jayce = instance(cards.ven068jayceBrilliantInventor, player.id, "ven-jayce-unit-gear");
  const exhausted = instance(cards.lonelyPoro, player.id, "ven-jayce-unit-gear-target");
  const porobot = instance({
    ...cards.ven058patchedPorobot,
    energy: 0,
    power: []
  }, player.id, "ven-jayce-played-unit-gear");
  exhausted.exhausted = true;
  player.base = [jayce, exhausted];
  player.hand = [porobot];

  assert.equal(playCard(game, porobot.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice?.effect, "readyPermanent");
  assert.ok(game.pendingChoice.options.some((option) => option.cardId === exhausted.instanceId));
  assert.equal(chooseEffectOption(game, exhausted.instanceId).ok, true);
  settleAllChains(game);
  assert.equal(exhausted.exhausted, false);
});

test("killing Patched Porobot as Gear uses the complete Unit death path", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const detonate = instance({ ...cards.sfd005detonate, energy: 0, power: [] }, player.id, "unit-gear-detonate");
  const porobot = instance(cards.ven058patchedPorobot, opponent.id, "unit-gear-detonate-target");
  const drawOne = instance(cards.charm, opponent.id, "unit-gear-detonate-draw-1");
  const drawTwo = instance(cards.gust, opponent.id, "unit-gear-detonate-draw-2");
  player.hand = [detonate];
  opponent.hand = [];
  opponent.base = [porobot];
  opponent.mainDeck = [drawOne, drawTwo];

  assert.equal(beginPlayCard(game, detonate.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.ok(game.pendingChoice.options.some((option) => option.cardId === porobot.instanceId));
  assert.equal(chooseEffectOption(game, porobot.instanceId).ok, true);
  if (game.pendingPayment) assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);

  assert.equal(opponent.base.some((card) => card.instanceId === porobot.instanceId), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === porobot.instanceId), true);
  assert.deepEqual(new Set(opponent.hand.map((card) => card.instanceId)), new Set([drawOne.instanceId, drawTwo.instanceId]));
  assert.equal(game.unitsDiedThisTurn, 1);
});

test("Jayce observes only the first non-token gear and offers every exhausted object", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const jayce = instance(cards.ven068jayceBrilliantInventor, player.id, "ven-jayce");
  const friendlyUnit = instance(cards.lonelyPoro, player.id, "ven-jayce-friendly");
  const enemyGear = instance(cards.guardianAngel, opponent.id, "ven-jayce-enemy-gear");
  friendlyUnit.exhausted = true;
  enemyGear.exhausted = true;
  player.base = [jayce, friendlyUnit];
  opponent.base = [enemyGear];

  const firstGear = instance({ ...cards.guardianAngel, energy: 0, power: [] }, player.id, "ven-jayce-first-gear");
  player.hand = [firstGear];
  assert.equal(playCard(game, firstGear.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice?.effect, "readyPermanent", JSON.stringify(game.pendingChoice));
  assert.deepEqual(new Set(game.pendingChoice.options.map((option) => option.cardId)),
    new Set([friendlyUnit.instanceId, enemyGear.instanceId]));
  assert.equal(chooseEffectOption(game, enemyGear.instanceId).ok, true);
  settleAllChains(game);
  assert.equal(enemyGear.exhausted, false, JSON.stringify({
    pendingChoice: game.pendingChoice,
    actionChain: game.actionChain,
    readyEvents: game.readyEvents,
    log: game.log.slice(-16)
  }));

  const secondGear = instance({ ...cards.guardianAngel, energy: 0, power: [] }, player.id, "ven-jayce-second-gear");
  player.hand = [secondGear];
  assert.equal(playCard(game, secondGear.instanceId, "base").ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice, null, "the second non-token gear does not trigger Jayce again");
});

test("Akali starts a non-combat showdown when her move trigger kills the last opposing unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const battlefield = game.battlefields[0];
  const akali = instance(cards.ven021akaliDeadlyWeapon, player.id, "ven-akali-move");
  const enemy = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "ven-akali-last-enemy");
  player.base = [akali];
  battlefield.units = [enemy];
  battlefield.controlledBy = opponent.id;

  assert.equal(moveUnit(game, akali.instanceId, battlefield.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice?.effect, "damageMovedLocation");
  assert.equal(chooseEffectOption(game, enemy.instanceId).ok, true);

  assert.equal(battlefield.units.some((unit) => unit.instanceId === enemy.instanceId), false);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown?.combat, false);
  assert.equal(game.showdown?.attackerId, player.id);
  assert.equal(battlefield.controlledBy, opponent.id);
  assert.equal(player.score, 0);
});

test("Heart of the Tempest grants Assault 2 in rules calculation and Korean status UI", () => {
  const game = createGame({ interactive: false });
  finishSetup(game);
  const player = currentPlayer(game);
  const battlefield = game.battlefields[0];
  const heart = instance(cards.ven155heartOfTheTempest, player.id, "ven-heart-assault");
  const target = instance(cards.lonelyPoro, player.id, "ven-heart-assault-target");
  heart.empoweredCount = 1;
  player.legend = heart;
  battlefield.units = [target];
  battlefield.controlledBy = player.id;

  assert.equal(activateCard(game, heart.instanceId).ok, true);
  assert.equal(target.temporaryKeywordAmounts?.assault, 2);
  assert.equal(currentCombatMight(game, battlefield, target, "attacker"), (target.might || 0) + 2);
  const keywordStatus = cardStatusItems(target, {
    locale: "ko",
    keywordLabel: (keyword) => keyword === "Assault" ? "맹공" : keyword
  }).find((status) => status.kind === "keywords");
  assert.match(keywordStatus?.badge || "", /맹공 2/u);
});

test("Shadow Clone can banish a trash unit on attack and gains Assault 4 for the turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const shadowDefinition = OFFICIAL_TOKEN_DEFINITIONS.shadowClone;
  const shadow = instance(shadowDefinition, player.id, "ven-shadow-clone");
  const fuel = instance(cards.lonelyPoro, player.id, "ven-shadow-fuel");
  const defender = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "ven-shadow-defender");
  player.base = [shadow];
  player.trash = [fuel];
  field.units = [defender];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, shadow.instanceId, field.instanceId).ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.data?.operation, "banishOwnTrashUnitGiveSelfKeyword");
  assert.equal(chooseEffectOption(game, fuel.instanceId).ok, true);
  assert.equal(player.banished.some((card) => card.instanceId === fuel.instanceId), true);
  assert.ok(shadow.temporaryKeywords?.includes("Assault"));
  assert.equal(shadow.temporaryKeywordAmounts?.assault, 4);
});

test("Vendetta Beginning, score, and end-turn effects are connected to their shared phase events", () => {
  const beginningGame = createGame();
  finishSetup(beginningGame);
  const beginningPlayer = currentPlayer(beginningGame);
  const beginningOpponent = beginningGame.players.find((candidate) => candidate.id !== beginningPlayer.id);
  const baccai = instance(cards.ven005forsakenBaccai, beginningPlayer.id, "ven-beginning-baccai");
  beginningPlayer.base = [baccai];
  beginningPlayer.runes = [];
  beginningOpponent.runes = [rune(DOMAINS.FURY, beginningOpponent.id, "ven-beginning-opponent-rune")];
  startTurn(beginningGame);
  assert.equal(baccai.temporaryMight, 1, "Forsaken Baccai gets its Beginning Phase bonus");

  const scoreGame = createGame();
  finishSetup(scoreGame);
  const scorePlayer = currentPlayer(scoreGame);
  const illaoi = instance(cards.ven109illaoiProphetOfTheGreatKraken, scorePlayer.id, "ven-score-illaoi");
  scoreGame.battlefields[0].controlledBy = scorePlayer.id;
  scoreGame.battlefields[0].units = [illaoi];
  startTurn(scoreGame);
  assert.ok(scorePlayer.base.some((card) => card.tokenKind === "tentacle"),
    "Illaoi plays a Tentacle when she scores by holding");

  const endingGame = createGame();
  finishSetup(endingGame);
  const endingPlayer = currentPlayer(endingGame);
  const glowstone = instance(cards.ven133glowstone, endingPlayer.id, "ven-ending-glowstone");
  const survivor = instance({ ...cards.ven043steelPaws, might: 9 }, endingPlayer.id, "ven-ending-survivor");
  endingPlayer.base = [glowstone, survivor];
  assert.equal(endTurn(endingGame).ok, true);
  assert.ok(endingPlayer.trash.some((card) => card.instanceId === glowstone.instanceId));
  assert.ok(endingGame.damageEvents.some((event) => event.targetId === survivor.instanceId),
    "Glowstone deals 5 before the next turn's ready-step healing clears marked damage");
});

test("Vendetta ready, conquer, and combat-end effects resolve through live game events", () => {
  const readyGame = createGame();
  finishSetup(readyGame);
  const readyPlayer = currentPlayer(readyGame);
  const feline = instance(cards.ven071fretfulFeline, readyPlayer.id, "ven-ready-feline");
  feline.exhausted = true;
  readyPlayer.base = [feline];
  startTurn(readyGame);
  assert.equal(feline.exhausted, false);
  assert.equal(feline.temporaryMight, 2, "Fretful Feline triggers when the ready step readies it");

  const makeConquerGame = (card, instanceId) => {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const source = instance(card, player.id, instanceId);
    const ally = instance(cards.lonelyPoro, player.id, `${instanceId}-ally`);
    const field = game.battlefields[0];
    player.base = [source];
    field.units = [ally];
    field.controlledBy = opponent.id;
    return { game, player, source, field };
  };

  const nasusState = makeConquerGame(cards.ven046nasusAscended, "ven-conquer-nasus");
  nasusState.source.empoweredCount = 1;
  const nasusScore = nasusState.player.score;
  assert.equal(moveUnit(nasusState.game, nasusState.source.instanceId, nasusState.field.instanceId).ok, true);
  settleAllChains(nasusState.game);
  assert.equal(nasusState.player.score, nasusScore + 2,
    "Empowered Nasus scores once for conquering and once for his triggered ability");

  const zedState = makeConquerGame(cards.ven112zedWithoutASound, "ven-conquer-zed");
  assert.equal(moveUnit(zedState.game, zedState.source.instanceId, zedState.field.instanceId).ok, true);
  settleAllChains(zedState.game);
  assert.ok(zedState.player.base.some((card) => card.tokenKind === "shadowClone"),
    "Zed's conquer trigger plays the official Shadow Clone token to base");

  const combatGame = createGame({ interactive: true });
  finishSetup(combatGame);
  const attacker = currentPlayer(combatGame);
  const defender = combatGame.players.find((candidate) => candidate.id !== attacker.id);
  const harmless = instance({ ...cards.lonelyPoro, might: 0, effects: [] }, attacker.id, "ven-combat-harmless");
  const affectionate = instance(cards.ven024affectionatePoro, defender.id, "ven-combat-affectionate");
  const field = combatGame.battlefields[0];
  attacker.base = [harmless];
  defender.hand = [];
  field.units = [affectionate];
  field.controlledBy = defender.id;
  const expectedDraw = defender.mainDeck[0]?.instanceId;
  assert.equal(moveUnit(combatGame, harmless.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(combatGame, combatGame.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(combatGame, combatGame.showdown.priorityPlayerId).ok, true);
  while (combatGame.pendingChoice?.effect === "combatDamage") {
    assert.equal(chooseEffectOption(combatGame, combatGame.pendingChoice.options[0].id).ok, true);
  }
  settleAllChains(combatGame);
  assert.equal(defender.hand[0]?.instanceId, expectedDraw,
    "Affectionate Poro draws after surviving a combat without being dealt damage that turn");
});

test("Mask Mother discard and Nasus enemy-death triggers keep their payment, location, and once-per-turn rules", () => {
  const discardGame = createGame({ interactive: true });
  finishSetup(discardGame);
  const discardPlayer = currentPlayer(discardGame);
  const poro = instance(cards.ven007punchingPoro, discardPlayer.id, "ven-mask-discard-poro");
  const mask = instance(cards.ven094maskMother, discardPlayer.id, "ven-mask-discard-card");
  const ally = instance(cards.lonelyPoro, discardPlayer.id, "ven-mask-discard-ally");
  discardPlayer.base = [poro, ally];
  discardPlayer.hand = [mask];
  const maskEnergyRune = rune(DOMAINS.MIND, discardPlayer.id, "ven-mask-energy-rune");
  discardPlayer.runes = [maskEnergyRune];
  assert.equal(activateCard(discardGame, poro.instanceId).ok, true);
  assert.equal(chooseEffectOption(discardGame, mask.instanceId).ok, true);
  assert.equal(confirmPayment(discardGame).ok, true);
  assert.equal(discardGame.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(discardGame, "use-optional-trigger").ok, true);
  assert.equal(discardGame.pendingChoice?.data?.targetEffect, "payEnergyBuff");
  assert.equal(chooseEffectOption(discardGame, ally.instanceId).ok, true);
  assert.equal(discardGame.pendingPayment?.source, "triggeredAbility",
    "Mask Mother's Energy is paid while its triggered ability is Pending");
  assert.equal(togglePaymentRune(discardGame, maskEnergyRune.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(discardGame).ok, true);
  settleAllChains(discardGame);
  assert.equal(maskEnergyRune.exhausted, true, JSON.stringify({
    pendingChoice: discardGame.pendingChoice,
    actionChain: discardGame.actionChain,
    log: discardGame.log.slice(-20)
  }));
  assert.equal(ally.temporaryMight, 2);

  const deathGame = createGame({ interactive: true });
  finishSetup(deathGame);
  const deathPlayer = currentPlayer(deathGame);
  const deathOpponent = deathGame.players.find((candidate) => candidate.id !== deathPlayer.id);
  const nasus = instance(cards.ven063nasusGuardianOfKnowledge, deathPlayer.id, "ven-death-nasus");
  const elsewhere = instance({ ...cards.lonelyPoro, might: 1 }, deathOpponent.id, "ven-death-elsewhere");
  const hereOne = instance({ ...cards.lonelyPoro, might: 1 }, deathOpponent.id, "ven-death-here-one");
  const hereTwo = instance({ ...cards.lonelyPoro, might: 1 }, deathOpponent.id, "ven-death-here-two");
  deathGame.battlefields[0].units = [nasus];
  deathGame.battlefields[1].units = [elsewhere];
  deathPlayer.runeDeck = [
    rune(DOMAINS.MIND, deathPlayer.id, "ven-death-channel-one"),
    rune(DOMAINS.MIND, deathPlayer.id, "ven-death-channel-two")
  ];
  const initialRuneCount = deathPlayer.runes.length;
  const playDamage = (target, id) => {
    const spell = instance({
      ...cards.incinerate,
      energy: 0,
      power: [],
      effects: [{ timing: "spell", kind: "dealDamageUnit", target: "battlefieldUnit", amount: 2 }]
    }, deathPlayer.id, id);
    deathPlayer.hand = [spell];
    const begun = beginPlayCard(deathGame, spell.instanceId, "base");
    assert.equal(begun.ok, true, JSON.stringify({ begun, pendingChoice: deathGame.pendingChoice,
      actionChain: deathGame.actionChain, log: deathGame.log.slice(-16) }));
    assert.equal(chooseEffectOption(deathGame, target.instanceId).ok, true);
    assert.equal(confirmPayment(deathGame).ok, true);
    settleAllChains(deathGame);
  };
  playDamage(elsewhere, "ven-death-spell-away");
  assert.equal(deathPlayer.runes.length, initialRuneCount, "an enemy dying elsewhere does not trigger Nasus");
  deathGame.battlefields[0].units.push(hereOne);
  playDamage(hereOne, "ven-death-spell-here-one");
  assert.equal(deathPlayer.runes.length, initialRuneCount + 1, "the first enemy death here channels one rune");
  deathGame.battlefields[0].units.push(hereTwo);
  playDamage(hereTwo, "ven-death-spell-here-two");
  assert.equal(deathPlayer.runes.length, initialRuneCount + 1, "Nasus triggers only once each turn");
});

test("Vendetta optional non-resource trigger costs are paid while Pending and resolve only afterward", () => {
  const profiteerGame = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(profiteerGame);
  const profiteerPlayer = currentPlayer(profiteerGame);
  const profiteerOpponent = profiteerGame.players.find((candidate) => candidate.id !== profiteerPlayer.id);
  const disempowerCost = instance(cards.lonelyPoro, profiteerPlayer.id, "ven-profiteer-cost");
  const empowerTarget = instance(cards.stalwartPoro, profiteerPlayer.id, "ven-profiteer-target");
  disempowerCost.empoweredCount = 1;
  profiteerPlayer.legend.empoweredCount = 1;
  profiteerPlayer.base = [disempowerCost, empowerTarget];
  const profiteer = instance({ ...cards.ven082profiteer, energy: 0, power: [] }, profiteerPlayer.id, "ven-profiteer");
  profiteerPlayer.hand = [profiteer];

  assert.equal(playCard(profiteerGame, profiteer.instanceId, "base").ok, true);
  settleAllChains(profiteerGame);
  assert.equal(profiteerGame.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(profiteerGame, "use-optional-trigger").ok, true);
  assert.equal(profiteerGame.pendingChoice?.data?.targetEffect, "empower",
    "Profiteer declares the effect target before paying its disempower cost");
  assert.equal(chooseEffectOption(profiteerGame, empowerTarget.instanceId).ok, true);
  assert.equal(profiteerGame.pendingChoice?.effect, "declareTriggerCost");
  assert.deepEqual(new Set(profiteerGame.pendingChoice.options
    .filter((option) => option.cardId)
    .map((option) => option.cardId)), new Set([
    disempowerCost.instanceId,
    profiteerPlayer.legend.instanceId
  ]), "an Empowered friendly legend is a legal disempower cost permanent");
  profiteerOpponent.hand = [instance({ ...cards.discipline, energy: 0, power: [] },
    profiteerOpponent.id, "ven-profiteer-response")];
  assert.equal(chooseEffectOption(profiteerGame, disempowerCost.instanceId).ok, true);
  assert.equal(disempowerCost.empoweredCount, 0, "the cost is paid before the trigger finalizes");
  assert.equal(empowerTarget.empoweredCount || 0, 0, "the effect has not resolved while Pending");
  settleAllChains(profiteerGame);
  assert.equal(empowerTarget.empoweredCount, 1);

  const burnGame = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(burnGame);
  const burnPlayer = currentPlayer(burnGame);
  const burnOpponent = burnGame.players.find((candidate) => candidate.id !== burnPlayer.id);
  const disciple = instance(cards.ven095shadowOrderDisciple, burnPlayer.id, "ven-burn-disciple");
  const burned = burnPlayer.mainDeck[0];
  burnPlayer.base = [disciple];
  burnGame.battlefields[0].controlledBy = burnPlayer.id;
  assert.equal(moveUnit(burnGame, disciple.instanceId, burnGame.battlefields[0].instanceId).ok, true);
  assert.equal(burnGame.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(burnGame, "use-optional-trigger").ok, true);
  assert.equal(burnGame.pendingChoice?.effect, "declareTriggerCost");
  burnOpponent.hand = [instance({ ...cards.discipline, energy: 0, power: [] },
    burnOpponent.id, "ven-burn-response")];
  assert.equal(chooseEffectOption(burnGame, "pay-trigger-cost").ok, true);
  assert.ok(burnPlayer.trash.some((card) => card.instanceId === burned.instanceId),
    "Burn 1 is paid before the movement trigger finalizes");
  assert.equal(disciple.temporaryMight || 0, 0);
  settleAllChains(burnGame);
  assert.equal(disciple.temporaryMight, 1);

  const banishGame = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(banishGame);
  const prefectPlayer = currentPlayer(banishGame);
  const gearPlayer = banishGame.players.find((candidate) => candidate.id !== prefectPlayer.id);
  const prefect = instance(cards.ven102ravenbloomPrefect, prefectPlayer.id, "ven-prefect");
  prefectPlayer.base = [prefect];
  const playedGear = instance({ ...cards.guardianAngel, energy: 0, power: [] }, gearPlayer.id, "ven-prefect-gear");
  const prefectResponse = instance({ ...cards.discipline, energy: 0, power: [] },
    gearPlayer.id, "ven-prefect-response");
  gearPlayer.hand = [playedGear, prefectResponse];
  banishGame.currentPlayerId = gearPlayer.id;
  banishGame.turnPlayerId = gearPlayer.id;
  assert.equal(playCard(banishGame, playedGear.instanceId, "base").ok, true);
  settleAllChains(banishGame);
  assert.equal(banishGame.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(banishGame, "use-optional-trigger").ok, true);
  assert.equal(banishGame.pendingChoice?.effect, "declareTriggerCost");
  assert.equal(chooseEffectOption(banishGame, "pay-trigger-cost").ok, true);
  assert.ok(prefectPlayer.banished.some((card) => card.instanceId === prefect.instanceId),
    "Ravenbloom Prefect banishes itself before its trigger finalizes");
  assert.ok(gearPlayer.base.some((card) => card.instanceId === playedGear.instanceId));
  settleAllChains(banishGame);
  assert.ok(gearPlayer.banished.some((card) => card.instanceId === playedGear.instanceId));
});

test("Bottled Constellation selects and kills exactly three other permanents as its trigger cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const constellation = instance(cards.ven067bottledConstellation, player.id, "ven-constellation");
  const unitOne = instance(cards.lonelyPoro, player.id, "ven-constellation-unit-1");
  const unitTwo = instance(cards.stalwartPoro, player.id, "ven-constellation-unit-2");
  const gear = instance(cards.guardianAngel, player.id, "ven-constellation-gear");
  player.base = [constellation, unitOne, unitTwo, gear];
  const scoreBefore = player.score;

  startTurn(game);
  assert.equal(game.pendingChoice?.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  for (const [index, card] of [unitOne, unitTwo, gear].entries()) {
    assert.equal(game.pendingChoice?.effect, "declareTriggerCost");
    assert.equal(game.pendingChoice.options.some((option) => option.cardId === constellation.instanceId), false,
      "the Constellation itself is not a legal cost object");
    assert.equal(chooseEffectOption(game, card.instanceId).ok, true);
    if (index < 2) assert.equal(player.score, scoreBefore, "the incomplete cost cannot resolve the score effect");
  }
  settleAllChains(game);
  assert.equal(player.score, scoreBefore + 1);
  assert.ok(player.base.some((card) => card.instanceId === constellation.instanceId));
  for (const card of [unitOne, unitTwo, gear]) {
    assert.ok(player.trash.some((candidate) => candidate.instanceId === card.instanceId));
  }
});

test("Siphoning Strike watches its target for the rest of the turn, not only for its own damage event", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const target = instance({ ...cards.lonelyPoro, might: 6 }, opponent.id, "ven-siphoning-target");
  game.battlefields[0].units = [target];
  player.runes = [];
  player.runeDeck = [rune(DOMAINS.MIND, player.id, "ven-siphoning-channel")];
  const siphoning = instance({ ...cards.ven146siphoningStrike, energy: 0, power: [] }, player.id, "ven-siphoning-strike");
  player.hand = [siphoning];
  assert.equal(beginPlayCard(game, siphoning.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(target.damage, 4);
  assert.equal(player.runes.length, 0);

  const followup = instance({
    ...cards.incinerate,
    energy: 0,
    power: [],
    effects: [{ timing: "spell", kind: "dealDamageUnit", target: "battlefieldUnit", amount: 2 }]
  }, player.id, "ven-siphoning-followup");
  player.hand = [followup];
  assert.equal(beginPlayCard(game, followup.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(player.runes.length, 1);
  assert.equal(player.runes[0].exhausted, true);
});

test("Vendetta FAQ Might replacements apply to swaps and only to an actual negative-Might event", () => {
  const gangplankGame = createGame({ interactive: true });
  finishSetup(gangplankGame);
  const caster = currentPlayer(gangplankGame);
  const opponent = gangplankGame.players.find((candidate) => candidate.id !== caster.id);
  const small = instance({ ...cards.lonelyPoro, might: 2 }, opponent.id, "ven-swap-small");
  const gangplank = instance(cards.ven086gangplankNaval, opponent.id, "ven-swap-gangplank");
  gangplank.empoweredCount = 1;
  gangplankGame.battlefields[0].units = [small, gangplank];
  const switcheroo = instance({ ...cards.sfd145switcheroo, energy: 0, power: [] }, caster.id, "ven-switcheroo-gangplank");
  caster.hand = [switcheroo];

  assert.equal(beginPlayCard(gangplankGame, switcheroo.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(gangplankGame, small.instanceId).ok, true);
  assert.equal(chooseEffectOption(gangplankGame, gangplank.instanceId).ok, true);
  assert.equal(confirmPayment(gangplankGame).ok, true);
  settleAllChains(gangplankGame);
  assert.equal(currentMight(gangplankGame, small), 6);
  assert.equal(currentMight(gangplankGame, gangplank), 9,
    "Gangplank replaces the swap's -4 event with +3");

  const minimumGame = createGame({ interactive: true });
  finishSetup(minimumGame);
  const minimumCaster = currentPlayer(minimumGame);
  const minimumOpponent = minimumGame.players.find((candidate) => candidate.id !== minimumCaster.id);
  const minimumGangplank = instance({ ...cards.ven086gangplankNaval, might: 1 }, minimumOpponent.id,
    "ven-minimum-gangplank");
  minimumGangplank.empoweredCount = 1;
  minimumGame.battlefields[0].units = [minimumGangplank];
  const stupefy = instance({ ...cards.stupefy, energy: 0, power: [] }, minimumCaster.id, "ven-stupefy-minimum");
  minimumCaster.hand = [stupefy];
  assert.equal(beginPlayCard(minimumGame, stupefy.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(minimumGame, minimumGangplank.instanceId).ok, true);
  assert.equal(confirmPayment(minimumGame).ok, true);
  settleAllChains(minimumGame);
  assert.equal(currentMight(minimumGame, minimumGangplank), 1,
    "the minimum prevents a negative-Might event, so Gangplank has nothing to replace");

  const melGame = createGame({ interactive: true });
  finishSetup(melGame);
  const melCaster = currentPlayer(melGame);
  const mel = instance(cards.ven069melNewlyAwakened, melCaster.id, "ven-swap-mel");
  mel.empoweredCount = 1;
  const low = instance({ ...cards.lonelyPoro, might: 2 }, melCaster.id, "ven-swap-low");
  const high = instance({ ...cards.stalwartPoro, might: 6 }, melCaster.id, "ven-swap-high");
  melCaster.base = [mel];
  melGame.battlefields[0].units = [low, high];
  const melSwitcheroo = instance({ ...cards.sfd145switcheroo, energy: 0, power: [] }, melCaster.id,
    "ven-switcheroo-mel");
  melCaster.hand = [melSwitcheroo];
  assert.equal(beginPlayCard(melGame, melSwitcheroo.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(melGame, low.instanceId).ok, true);
  assert.equal(chooseEffectOption(melGame, high.instanceId).ok, true);
  assert.equal(confirmPayment(melGame).ok, true);
  settleAllChains(melGame);
  assert.equal(currentMight(melGame, high), 1, "Mel adds another -1 to the chosen swap reduction");
});

test("Temporal Breach preserves the exact original location and exposes Dragon Roost's paid destination", () => {
  const foreignBaseGame = createGame({ interactive: true });
  finishSetup(foreignBaseGame);
  const owner = currentPlayer(foreignBaseGame);
  const controller = foreignBaseGame.players.find((candidate) => candidate.id !== owner.id);
  const borrowed = instance(cards.lonelyPoro, owner.id, "ven-temporal-borrowed");
  borrowed.controllerId = controller.id;
  controller.base = [borrowed];
  const breach = instance(cards.ven066temporalBreach, owner.id, "ven-temporal-foreign-base");
  breach.declaredPlayTargets = [{ effect: "banishReplay", targetId: borrowed.instanceId }];
  resolveEffect(foreignBaseGame, owner, breach);
  assert.ok(owner.banished.some((card) => card.instanceId === borrowed.instanceId));
  assert.equal(owner.base.some((card) => card.instanceId === borrowed.instanceId), false,
    "another player's base is not silently changed to the owner's base");

  const roostGame = createGame({ interactive: true });
  finishSetup(roostGame);
  const dragonOwner = currentPlayer(roostGame);
  const roost = {
    ...instance(cards.ven157dragonRoost, dragonOwner.id, "ven-dragon-roost"),
    units: [], hidden: [], controlledBy: null
  };
  roostGame.battlefields[0] = roost;
  const dragon = instance(cards.sfd015perchedGrimwyrm, dragonOwner.id, "ven-temporal-dragon");
  dragon.effects = dragon.effects.filter((effect) => effect.kind !== "playDestinationRestriction");
  dragonOwner.base = [dragon];
  dragonOwner.runes = [
    rune(DOMAINS.FURY, dragonOwner.id, "ven-roost-power-1"),
    rune(DOMAINS.MIND, dragonOwner.id, "ven-roost-power-2")
  ];
  const dragonBreach = instance(cards.ven066temporalBreach, dragonOwner.id, "ven-temporal-roost");
  dragonBreach.declaredPlayTargets = [{ effect: "banishReplay", targetId: dragon.instanceId }];
  resolveEffect(roostGame, dragonOwner, dragonBreach);
  assert.equal(roostGame.pendingChoice?.playerId, dragonOwner.id);
  const roostOption = roostGame.pendingChoice.options.find((option) => option.destination === roost.instanceId);
  assert.ok(roostOption, "the owner can choose the paid Dragon Roost permission instead of the original base");
  assert.equal(chooseEffectOption(roostGame, roostOption.id).ok, true);
  settleAllChains(roostGame);
  assert.equal(roostGame.pendingPayment?.powerCost.reduce((sum, cost) => sum + cost.amount, 0), 2);
  for (const powerRune of dragonOwner.runes) {
    assert.equal(togglePaymentRune(roostGame, powerRune.instanceId, "power").ok, true);
  }
  assert.equal(confirmPayment(roostGame).ok, true);
  settleAllChains(roostGame);
  assert.ok(roost.units.some((card) => card.instanceId === dragon.instanceId));

  const restrictedGame = createGame({ interactive: true });
  finishSetup(restrictedGame);
  const restrictedOwner = currentPlayer(restrictedGame);
  const restrictedRoost = {
    ...instance(cards.ven157dragonRoost, restrictedOwner.id, "ven-restricted-roost"),
    units: [], hidden: [], controlledBy: null
  };
  restrictedGame.battlefields[0] = restrictedRoost;
  const grimwyrm = instance(cards.sfd015perchedGrimwyrm, restrictedOwner.id, "ven-restricted-grimwyrm");
  restrictedOwner.base = [grimwyrm];
  restrictedOwner.runes = [
    rune(DOMAINS.FURY, restrictedOwner.id, "ven-restricted-power-1"),
    rune(DOMAINS.MIND, restrictedOwner.id, "ven-restricted-power-2")
  ];
  const restrictedBreach = instance(cards.ven066temporalBreach, restrictedOwner.id, "ven-restricted-breach");
  restrictedBreach.declaredPlayTargets = [{ effect: "banishReplay", targetId: grimwyrm.instanceId }];
  resolveEffect(restrictedGame, restrictedOwner, restrictedBreach);
  assert.ok(restrictedOwner.banished.some((card) => card.instanceId === grimwyrm.instanceId),
    "Dragon Roost cannot override Perched Grimwyrm's conquered-battlefield restriction");
});

test("Heisho waives every Deflect cost once any choice is there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const heisho = {
    ...instance(cards.ven158heishoShellOfTheWorld, player.id, "ven-heisho"),
    units: [], hidden: [], controlledBy: opponent.id
  };
  game.battlefields[0] = heisho;
  const here = instance({ ...cards.lonelyPoro, keywords: ["Deflect"], keywordAmounts: { Deflect: 2 } },
    opponent.id, "ven-heisho-target");
  const elsewhere = instance({ ...cards.stalwartPoro, keywords: ["Deflect"], keywordAmounts: { Deflect: 2 } },
    opponent.id, "ven-deflect-elsewhere");
  heisho.units = [here];
  game.battlefields[1].units = [elsewhere];
  const rain = instance({ ...cards.icathianRain, energy: 0, power: [] }, player.id, "ven-heisho-rain");
  player.hand = [rain];
  player.runes = [];

  assert.equal(beginPlayCard(game, rain.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, here.instanceId).ok, true);
  for (let index = 0; index < 5; index += 1) {
    const result = chooseEffectOption(game, elsewhere.instanceId);
    assert.equal(result.ok, true, JSON.stringify({ index, result, pendingChoice: game.pendingChoice, log: game.log.slice(-12) }));
  }
  assert.deepEqual(game.pendingPayment?.powerCost, [],
    "Heisho ignores Deflect for all six choices, including targets at another battlefield");
});

test("Kennen's conquer target is mandatory when a trash spell exists", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const kennen = instance(cards.ven113kennenStormOfShuriken, player.id, "ven-kennen");
  const trashSpell = instance(cards.charm, player.id, "ven-kennen-trash-spell");
  player.base = [kennen];
  player.trash = [trashSpell];
  const field = game.battlefields[0];
  field.controlledBy = opponent.id;
  assert.equal(moveUnit(game, kennen.instanceId, field.instanceId).ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.data?.targetEffect, "grantTrashFlow");
  assert.equal(game.pendingChoice?.options.some((option) => option.id === "decline"), false);
  assert.deepEqual(game.pendingChoice?.options.map((option) => option.cardId), [trashSpell.instanceId]);
});

test("Shady Spectacles copies only copiable values, restores the unit, and refreshes copied abilities on reattach", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const equipped = instance({ ...cards.lonelyPoro, might: 3 }, player.id, "ven-spectacles-equipped");
  equipped.exhausted = true;
  equipped.damage = 2;
  equipped.buffs = 1;
  equipped.mightModifier = 2;
  equipped.empoweredCount = 1;
  const template = instance(cards.ven125hungryWolf, player.id, "ven-spectacles-template");
  const spectacles = instance(cards.ven137shadySpectacles, player.id, "ven-spectacles");
  spectacles.effects = spectacles.effects.map((effect) => effect.timing === "activated"
    ? { ...effect, costEnergy: 0, costPower: [{ domain: DOMAINS.ANY, amount: 0 }] }
    : effect);
  player.base = [equipped, template, spectacles];
  player.runes = [
    rune(DOMAINS.ORDER, player.id, "ven-spectacles-order-1"),
    rune(DOMAINS.ORDER, player.id, "ven-spectacles-order-2")
  ];

  const attachAndCopy = () => {
    assert.equal(activateCard(game, spectacles.instanceId).ok, true);
    assert.equal(game.pendingChoice?.effect, "declareActivatedTarget");
    assert.equal(chooseEffectOption(game, equipped.instanceId).ok, true);
    if (game.pendingPayment) assert.equal(confirmPayment(game).ok, true);
    settleAllChains(game);
    assert.equal(game.pendingChoice?.data?.operation, "copyEquippedUnit", JSON.stringify({
      pendingChoice: game.pendingChoice,
      actionChain: game.actionChain,
      attachments: equipped.attachments,
      spectacles: { attachedToId: spectacles.attachedToId, effects: spectacles.effects },
      log: game.log.slice(-30)
    }));
    assert.equal(chooseEffectOption(game, template.instanceId).ok, true);
    settleAllChains(game);
  };

  attachAndCopy();
  assert.equal(equipped.name, template.name);
  assert.equal(equipped.exhausted, true, "ready/exhausted state is not copied");
  assert.equal(equipped.damage, 2, "marked damage is not copied");
  assert.equal(equipped.buffs, 1, "buffs are not copied");
  assert.equal(equipped.mightModifier, 2, "Might modifiers are not copied");
  assert.equal(equipped.empoweredCount, 1, "Empowered status is not copied");
  assert.ok(equipped.attachments.some((card) => card.instanceId === spectacles.instanceId));

  player.enemyUnitChosenTurnSequence = game.turnSequence || 0;
  assert.equal(activateCard(game, equipped.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  const firstGeneration = equipped.copiedCharacteristicsGeneration;
  assert.equal(activateCard(game, equipped.instanceId).ok, false, "the copied once-per-turn ability is spent");

  const carrier = instance(cards.stalwartPoro, player.id, "ven-spectacles-carrier");
  player.base.push(carrier);
  const reattacher = instance(cards.sfd193grandmasterAtArms, player.id, "ven-spectacles-reattacher");
  reattacher.zone = "legend";
  reattacher.effects = reattacher.effects.map((effect) => effect.kind === "attachControlledEquipment"
    ? { ...effect, costEnergy: 0, exhaust: false }
    : effect);
  player.legend = reattacher;
  const reattachAndCopy = (attachmentTarget, copyTarget) => {
    assert.equal(activateCard(game, reattacher.instanceId).ok, true);
    assert.equal(game.pendingChoice?.data?.targetEffect, "attachControlledEquipment");
    assert.equal(chooseEffectOption(game, spectacles.instanceId).ok, true);
    assert.equal(game.pendingChoice?.data?.targetEffect, "forgeAttachTarget");
    assert.equal(chooseEffectOption(game, attachmentTarget.instanceId).ok, true);
    if (game.pendingPayment) assert.equal(confirmPayment(game).ok, true);
    settleAllChains(game);
    assert.equal(game.pendingChoice?.data?.operation, "copyEquippedUnit");
    assert.equal(chooseEffectOption(game, copyTarget.instanceId).ok, true);
    settleAllChains(game);
  };

  reattachAndCopy(carrier, equipped);
  reattachAndCopy(equipped, template);
  assert.ok(equipped.copiedCharacteristicsGeneration > firstGeneration,
    "detaching and reattaching creates a fresh copied ability instance");
  assert.equal(activateCard(game, equipped.instanceId).ok, true,
    "the newly copied once-per-turn ability can be used again in the same turn");
  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);

  const otherUnit = instance(cards.stalwartPoro, player.id, "ven-spectacles-other-unit");
  player.base.push(otherUnit);
  reattachAndCopy(otherUnit, equipped);
  assert.equal(equipped.name, "Lonely Poro", "moving the gear restores the former equipped unit");
});

test("Rebuttal can remake one choice while retaining another legal choice", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const originalPlayer = currentPlayer(game);
  const rebuttalPlayer = game.players.find((candidate) => candidate.id !== originalPlayer.id);
  const positive = instance({ ...cards.lonelyPoro, might: 2 }, originalPlayer.id, "ven-rebuttal-positive");
  const negative = instance({ ...cards.stalwartPoro, might: 4 }, originalPlayer.id, "ven-rebuttal-negative");
  const replacement = instance({ ...cards.ven043steelPaws, might: 3 }, rebuttalPlayer.id, "ven-rebuttal-replacement");
  originalPlayer.base = [positive, negative];
  rebuttalPlayer.base = [replacement];
  const dance = instance({ ...cards.sfd196defiantDance, energy: 0, power: [] }, originalPlayer.id,
    "ven-rebuttal-dance");
  originalPlayer.hand = [dance];
  const rebuttal = instance({ ...cards.ven152rebuttal, energy: 0, power: [] }, rebuttalPlayer.id,
    "ven-rebuttal-card");
  rebuttalPlayer.hand = [rebuttal];
  rebuttalPlayer.runes = [rune(DOMAINS.MIND, rebuttalPlayer.id, "ven-rebuttal-power")];

  assert.equal(beginPlayCard(game, dance.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, positive.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, negative.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(passShowdown(game, originalPlayer.id).ok, true);
  assert.equal(beginPlayCard(game, rebuttal.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, dance.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.data?.operation, "rebuttalResolve", JSON.stringify({
    pendingChoice: game.pendingChoice,
    actionChain: game.actionChain,
    log: game.log.slice(-20)
  }));
  assert.equal(chooseEffectOption(game, "control").ok, true);
  assert.equal(game.pendingChoice?.effect, "gainControlNewChoices");
  assert.equal(chooseEffectOption(game, "new").ok, true);
  assert.equal(game.pendingChoice?.effect, "gainControlChoiceSelection");
  const positiveChoice = game.pendingChoice.options.find((option) => option.targetId === positive.instanceId);
  assert.ok(positiveChoice);
  assert.equal(chooseEffectOption(game, positiveChoice.id).ok, true);
  assert.equal(chooseEffectOption(game, "confirm-controlled-choices").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, replacement.instanceId).ok, true);
  settleAllChains(game);
  assert.equal(currentMight(game, positive), 2, "the remade positive target is no longer affected");
  assert.equal(currentMight(game, negative), 2, "the retained negative target remains chosen");
  assert.equal(currentMight(game, replacement), 5, "the newly chosen positive target gets +2");
});

test("Rebuttal keeps Rampage's paid additional cost for its new controller and remade targets", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const originalPlayer = currentPlayer(game);
  const rebuttalPlayer = game.players.find((candidate) => candidate.id !== originalPlayer.id);
  const originalUnit = instance({ ...cards.stalwartPoro, might: 3 }, originalPlayer.id,
    "ven-rampage-original-unit");
  const rebuttalUnit = instance({ ...cards.stalwartPoro, might: 3 }, rebuttalPlayer.id,
    "ven-rampage-rebuttal-unit");
  originalPlayer.base = [originalUnit];
  rebuttalPlayer.base = [rebuttalUnit];
  originalPlayer.runes = [rune(DOMAINS.BODY, originalPlayer.id, "ven-rampage-paid-power")];
  rebuttalPlayer.runes = [rune(DOMAINS.MIND, rebuttalPlayer.id, "ven-rebuttal-control-power")];
  const rampage = instance({ ...cards.ven083rampage, energy: 0, power: [] }, originalPlayer.id,
    "ven-controlled-rampage");
  const rebuttal = instance({ ...cards.ven152rebuttal, energy: 0, power: [] }, rebuttalPlayer.id,
    "ven-rampage-rebuttal");
  originalPlayer.hand = [rampage];
  rebuttalPlayer.hand = [rebuttal];

  assert.equal(beginPlayCard(game, rampage.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "powerAdditionalCost");
  assert.equal(chooseEffectOption(game, "pay-power").ok, true);
  assert.equal(chooseEffectOption(game, originalUnit.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, rebuttalUnit.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "ven-rampage-paid-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(rampage.paidAdditionalCost, true);

  if (game.actionChain?.priorityPlayerId === originalPlayer.id) {
    assert.equal(passShowdown(game, originalPlayer.id).ok, true);
  }
  assert.equal(game.actionChain?.priorityPlayerId, rebuttalPlayer.id);
  assert.equal(beginPlayCard(game, rebuttal.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, rampage.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  settleAllChains(game);
  assert.equal(game.pendingChoice?.data?.operation, "rebuttalResolve");
  assert.equal(chooseEffectOption(game, "control").ok, true);
  assert.equal(game.pendingChoice?.effect, "gainControlNewChoices");
  assert.equal(chooseEffectOption(game, "new").ok, true);

  for (const entryId of game.pendingChoice.options
    .filter((option) => option.kind === "target")
    .map((option) => option.id)) {
    assert.equal(chooseEffectOption(game, entryId).ok, true);
  }
  assert.equal(chooseEffectOption(game, "confirm-controlled-choices").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget", JSON.stringify(game.pendingChoice));
  assert.equal(chooseEffectOption(game, rebuttalUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, originalUnit.instanceId).ok, true);

  settleAllChains(game);
  assert.equal(currentMight(game, rebuttalUnit), 5,
    "the original player's paid Body cost gives the new controller's friendly unit +2 Might");
  assert.equal(rebuttalUnit.damage, 3);
  assert.equal(originalPlayer.trash.some((card) => card.instanceId === originalUnit.instanceId), true);
});

test("Applied Researchers and Shock Blast let the player choose cost-reduction order", () => {
  function paymentAfterChoosing(firstSourceName) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    const researchers = instance(cards.ven055appliedResearchers, player.id,
      `ven-cost-order-researchers-${firstSourceName}`);
    researchers.empoweredCount = 1;
    const shockBlast = instance(cards.ven059shockBlast, player.id,
      `ven-cost-order-shock-${firstSourceName}`);
    const target = instance(cards.stalwartPoro, opponent.id,
      `ven-cost-order-target-${firstSourceName}`);
    player.base = [researchers];
    player.hand = [shockBlast];
    game.battlefields[0].units = [target];

    assert.equal(beginPlayCard(game, shockBlast.instanceId, "base").ok, true);
    assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
    assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
    assert.equal(game.pendingChoice?.effect, "costModifierOrder");
    const first = game.pendingChoice.options.find((option) => option.label.includes(firstSourceName));
    assert.ok(first, `the UI exposes ${firstSourceName} as a separate cost modifier`);
    assert.equal(chooseEffectOption(game, first.id).ok, true);
    assert.ok(game.pendingPayment);
    return game.pendingPayment;
  }

  const researchersFirst = paymentAfterChoosing("Applied Researchers");
  assert.equal(researchersFirst.energyCost, 0,
    "the minimum-1 Researchers reduction can be applied before Shock Blast's self reduction");
  assert.deepEqual(researchersFirst.powerCost, []);

  const shockFirst = paymentAfterChoosing("Shock Blast");
  assert.equal(shockFirst.energyCost, 1,
    "applying Shock Blast first leaves the Researchers minimum of 1 in force");
  assert.deepEqual(shockFirst.powerCost, []);
});

test("Ki Barrier and Lotus Trap let the unit controller order prevention and doubling", () => {
  function damageAfterChoosing(order) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const target = instance({ ...cards.stalwartPoro, might: 20 }, player.id,
      `ven-damage-order-target-${order}`);
    const lotus = instance(cards.unl013lotusTrap, player.id, `ven-damage-order-lotus-${order}`);
    const barrier = instance(cards.ven126kiBarrier, player.id, `ven-damage-order-barrier-${order}`);
    lotus.declaredPlayTargets = [{ effect: "unleashedUnit", targetId: target.instanceId }];
    barrier.declaredPlayTargets = [{ effect: "preventNextDamage", targetId: target.instanceId }];
    player.base = [target];

    resolveEffect(game, player, lotus);
    assert.equal(target.damageMultiplier, 2);
    assert.equal(resolveEffect(game, player, barrier), true);
    assert.equal(game.pendingChoice?.effect, "damageReplacementOrder");
    assert.equal(game.pendingChoice?.playerId, player.id);
    assert.equal(chooseEffectOption(game, order).ok, true);
    return applyDamage(game, player, target, target, 4, { origin: "combat" });
  }

  assert.equal(damageAfterChoosing("preventThenMultiply"), 0);
  assert.equal(damageAfterChoosing("multiplyThenPrevent"), 1);
});
