import { cards } from "../src/cards.mjs";
import {
  activateCard,
  beginPlayCard,
  chooseEffectOption,
  createGame,
  currentMight,
  declineEffectChoice,
  confirmPayment,
  hideCard,
  moveUnits,
  passShowdown,
  playCard,
  resolveEffect,
  startTurn,
  togglePaymentRune
} from "../src/engine.mjs";

const PROBE_EFFECT_COVERAGE = Object.freeze({
  FIRESTORM_FIELD_CHOICE_AND_BONUS: ["spell:dealDamageAllEnemyUnitsAtBattlefield", "static:globalBonusDamage"],
  SPELL_ABILITY_DAMAGE_PREVENTION: [],
  DAMAGE_USES_SOURCE_CONTROLLER: ["spell:dealDamageUnit", "static:globalBonusDamage"],
  GENTLEMENS_DUEL_MODIFIER: ["spell:duelFriendlyEnemy"],
  RECRUIT_TOKEN_DESTINATIONS: ["spell:playUnitToken"],
  CONQUER_EVENT_OCCURS_ONCE: ["conquer:drawIfUnitsAtBattlefield"],
  REACTION_ENERGY_DURING_PAYMENT: ["activated:addEnergy"],
  BASE_LOCATION_MIGHT_AURA: ["static:otherFriendlyHereMight"],
  RUNE_THRESHOLD_CURRENT_MIGHT: ["static:runeThresholdMight"],
  FROZEN_VARIANT_EFFECT_PARITY: ["attackOrDefend:splitDamageEnemyHere"],
  VOLIBEAR_SPLIT_DAMAGE_RESOLVES: ["attackOrDefend:splitDamageEnemyHere"],
  VAYNE_CONQUER_PAYMENT: ["conquer:payEnergyReturnSelfToHand"],
  TRASH_CONQUER_RETURN: ["battlefieldControl:discardReturnSelfFromTrash"],
  WARWICK_ATTACK_KILLS_DAMAGED: ["attackOrDefend:killDamagedEnemiesHere"],
  LEONA_NEAR_VICTORY_READY: ["static:enterReadyIfOpponentNearVictory"],
  VILEMAW_HOLD_DRAWS: ["hold:draw"],
  RECKONER_HOLD_TRIGGERS_CONQUER: ["hold:triggerConquerAbilitiesHere"],
  MASTER_YI_HUNT_GAINS_XP: ["keyword:huntGainXp"],
  BASIC_RUNE_ADDS_MATCHING_POWER: ["activated:addPower"],
  VISION_PREDICTS_ON_PLAY: ["keyword:predict"],
  FRIENDLY_VISION_AURA: ["static:otherFriendlyUnitsGainKeywords"],
  RECYCLE_TRIGGER_BUFFS: ["recycle:buffFriendlyUnit"],
  QUICK_DRAW_ATTACHES_ON_PLAY: ["keyword:quickDrawAttach"],
  WEAPONMASTER_ATTACHES_WITH_DISCOUNT: ["keyword:weaponmaster"],
  VILEMAW_SUPPRESSES_WEAKER_DAMAGE: ["static:suppressWeakerEnemyCombatDamage"],
  COMBAT_DAMAGE_LAST_PRIORITY: ["static:combatDamageAssignmentLast"],
  PIRATES_HAVEN_READY_MIGHT: ["static:readyFriendlyUnitMightThisTurn"],
  MISTFALL_BUFF_READY: ["static:buffFriendlyUnitPayExhaustReady"],
  LONELY_PORO_DEATHKNELL_ALONE: ["death:drawIfAlone"],
  PLAYED_EVENT_REQUIRES_RESOLUTION: [
    "cardPlayed:highCostSpellBuffSelf",
    "cardPlayed:highCostSpellDraw",
    "spellPlayed:selfBuff",
    "spell:counterSpell"
  ],
  PRINTED_MULTI_PART_EFFECTS: [
    "activated:recycleCardsFromTrashes",
    "onPlay:buffSelfThenOtherFriendlyHere",
    "static:entersExhausted",
    "static:hideWithEnergyInsteadOfPower",
    "static:opponentsCannotReadyByEffects"
  ]
});

// These probes intentionally exercise the public engine API. Expected values are
// literal outcomes derived from card text and core-rule contracts, never from the
// helper that performs the behavior under test.
export async function runCardRuleBehaviorProbes() {
  return [
    probe("FIRESTORM_FIELD_CHOICE_AND_BONUS", { choice: "dealDamageAllEnemyUnitsAtBattlefield", chosenDamage: 4, otherDamage: 0 }, firestormChoiceAndBonus,
      "Annie, Fiery at base; cast Firestorm; choose the first of two battlefields."),
    probe("SPELL_ABILITY_DAMAGE_PREVENTION", { damage: 0 }, preventedAreaDamage,
      "Enable this-turn spell/ability prevention; cast Firestorm at an enemy unit."),
    probe("DAMAGE_USES_SOURCE_CONTROLLER", { damage: 3 }, sourceControllerBonus,
      "Give player 1 Annie, pass current priority to player 2, then resolve player 1 Incinerate."),
    probe("GENTLEMENS_DUEL_MODIFIER", { friendlyMightBeforeStrike: 5, enemyDamage: 5 }, gentlemensDuel,
      "Choose a printed-2 friendly unit, then an enemy unit for Gentlemen's Duel."),
    probe("RECRUIT_TOKEN_DESTINATIONS", { choiceCount: 4, base: 2, battlefield: 2 }, recruitDestinations,
      "Resolve Recruit the Vanguard and alternate each token between base and a controlled battlefield."),
    probe("CONQUER_EVENT_OCCURS_ONCE", { cardsDrawn: 2, score: 1 }, garenConquerOnce,
      "Move four units together into an opponent-controlled empty battlefield and finish its non-combat showdown."),
    probe("REACTION_ENERGY_DURING_PAYMENT", { activationOk: true, exhausted: true, spellEnergy: 2 }, luxDuringSpellPayment,
      "Begin paying for Incinerate, then activate Lux, Crownguard during the pending spell payment."),
    probe("BASE_LOCATION_MIGHT_AURA", { currentMight: 3 }, baseMightAura,
      "Place Garen, Commander and another printed-2 friendly unit together at base."),
    probe("RUNE_THRESHOLD_CURRENT_MIGHT", { currentMight: 8 }, runeThresholdMight,
      "Control Master Yi, Meditative with eight runes."),
    probe("FROZEN_VARIANT_EFFECT_PARITY", { baseAmount: 5, variantAmount: 5 }, variantEffectParity,
      "Compare the normal and showcase Volibear, Furious attack effect contracts."),
    probe("VOLIBEAR_SPLIT_DAMAGE_RESOLVES", { choice: "splitDamageEnemyHere", damage: 5 }, volibearSplitDamage,
      "Attack with Volibear, Furious and allocate all five triggered damage to one durable enemy."),
    probe("VAYNE_CONQUER_PAYMENT", { returned: true, runeExhausted: true }, vayneConquerPayment,
      "Conquer with Vayne, Hunter, accept the Energy payment, and verify the paid return to hand."),
    probe("TRASH_CONQUER_RETURN", { returned: true, discarded: true }, trashConquerReturn,
      "Conquer while Super Mega Death Rocket! is in trash, then explicitly choose a card to discard."),
    probe("WARWICK_ATTACK_KILLS_DAMAGED", { killed: true }, warwickKillsDamaged,
      "Attack with Warwick, Hunter into a battlefield containing a damaged enemy and resolve the attack trigger."),
    probe("LEONA_NEAR_VICTORY_READY", { enteredReady: true }, leonaNearVictory,
      "Play Leona, Zealot while an opponent is three points from the current Victory Score."),
    probe("VILEMAW_HOLD_DRAWS", { drawn: 2 }, vilemawHoldDraw,
      "Begin a turn while holding Vilemaw's battlefield and distinguish its hold draw from the normal turn draw."),
    probe("RECKONER_HOLD_TRIGGERS_CONQUER", { drawn: 2 }, reckonerHoldConquer,
      "Hold Reckoner's Arena with Kai'Sa, Survivor and distinguish the repeated conquer draw from the normal turn draw."),
    probe("MASTER_YI_HUNT_GAINS_XP", { xp: 2 }, masterYiHuntGainXp,
      "Begin a turn holding a battlefield with Master Yi, Tempered and verify Hunt grants two XP."),
    probe("BASIC_RUNE_ADDS_MATCHING_POWER", { activationChoice: true, recycled: true, power: "Body" }, basicRuneAddsMatchingPower,
      "Activate a ready Body Rune, choose its recycle ability, and verify one matching Power is banked."),
    probe("VISION_PREDICTS_ON_PLAY", { order: ["probe-vision-middle", "probe-vision-bottom", "probe-vision-top"] }, visionPredictsOnPlay,
      "Play a printed-Vision unit and verify the shared keyword trigger predicts the top card."),
    probe("FRIENDLY_VISION_AURA", { order: ["probe-aura-middle", "probe-aura-bottom", "probe-aura-top"] }, friendlyVisionAura,
      "Control Gemcraft Seer, play another friendly unit, and verify the shared aura grants its Vision trigger."),
    probe("RECYCLE_TRIGGER_BUFFS", { choice: "buffUnit", buffs: 1, ownerDeck: true }, recycleTriggerBuffs,
      "Control Karma, Channeler, recycle an opponent-owned card, and resolve the resulting friendly-unit Buff trigger."),
    probe("QUICK_DRAW_ATTACHES_ON_PLAY", { attached: true, remainsAtBase: false }, quickDrawAttachesOnPlay,
      "Play synthetic Quick-Draw Equipment while controlling a unit and verify its shared trigger attaches it."),
    probe("WEAPONMASTER_ATTACHES_WITH_DISCOUNT", { attached: true, runesRemaining: 3 }, weaponmasterAttachesWithDiscount,
      "Play Akshan, Mischievous while controlling Trinity Force and verify Weaponmaster pays the discounted Equip cost without activating Equip."),
    probe("VILEMAW_SUPPRESSES_WEAKER_DAMAGE", { assigner: "defender" }, vilemawSuppressesWeakerDamage,
      "Attack a defending Vilemaw with a weaker unit and verify the weaker attacker receives no damage-assignment step."),
    probe("COMBAT_DAMAGE_LAST_PRIORITY", { firstTarget: "probe-last-normal", secondTarget: "probe-last-caitlyn" }, combatDamageLastPriority,
      "Attack Caitlyn, Patrolling and an ordinary unit together; the ordinary unit must receive lethal combat damage first."),
    probe("PIRATES_HAVEN_READY_MIGHT", { exhausted: false, might: 3, temporary: 1 }, piratesHavenReadyMight,
      "Ready an exhausted printed-2 friendly unit with Wallop while controlling Pirate's Haven."),
    probe("MISTFALL_BUFF_READY", { buffed: 1, ready: true, mistfallExhausted: true, runes: 0 }, mistfallBuffReady,
      "Buff an exhausted friendly unit with Arena Bar, then pay Body and exhaust Mistfall to ready it."),
    probe("LONELY_PORO_DEATHKNELL_ALONE", { killed: true, drawn: 1 }, lonelyPoroDeathknellAlone,
      "Kill a Lonely Poro while it is the only friendly unit at its location, then resolve its Deathknell draw."),
    probe("PRINTED_MULTI_PART_EFFECTS", {
      ballistaExhausted: true,
      guardianBuffs: [1, 1],
      readyPrevented: true,
      hideEnergyCost: 1,
      forgeKilled: true,
      enemyCardRecycled: true,
      forgeStoppedEarly: true
    }, printedMultiPartEffects,
    "Exercise every formerly omitted clause on Iron Ballista, Peak Guardian, Mageseeker Warden, Teemo, and Forge of the Future."),
    probe("PLAYED_EVENT_REQUIRES_RESOLUTION", {
      pending: { count: 0, luxMight: 0, ravenMight: 0, drawn: 0 },
      countered: { count: 0, luxMight: 0, ravenMight: 0, drawn: 0, chainCount: 0, inOwnerTrash: true },
      resolved: { count: 1, luxMight: 3, ravenMight: 1, drawn: 1 }
    }, playedEventRequiresResolution,
    "Put a high-cost spell on the Chain twice: counter the first copy and fully resolve the second while Lux and Ravenbloom Student observe it.")
  ];
}

function probe(id, expected, execute, reproduction) {
  try {
    const actual = execute();
    return {
      id,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
      message: `${id} did not match its independent expected outcome.`,
      covers: PROBE_EFFECT_COVERAGE[id] || [],
      expected,
      actual,
      reproduction
    };
  } catch (error) {
    return {
      id,
      ok: false,
      message: `${id} threw while reproducing the rule scenario: ${error?.message || error}`,
      covers: PROBE_EFFECT_COVERAGE[id] || [],
      expected,
      actual: { error: error?.stack || String(error) },
      reproduction
    };
  }
}

function firestormChoiceAndBonus() {
  const { game, player, opponent } = ruleGame();
  const annie = instance(cards.annieFiery, player.id, "probe-annie");
  const spell = instance(cards.firestorm, player.id, "probe-firestorm");
  const chosen = durableUnit(opponent.id, "probe-firestorm-chosen");
  const other = durableUnit(opponent.id, "probe-firestorm-other");
  player.base = [annie];
  game.battlefields = [
    battlefield("probe-field-1", opponent.id, [chosen]),
    battlefield("probe-field-2", opponent.id, [other])
  ];
  resolveEffect(game, player, spell);
  const choice = game.pendingChoice?.effect || null;
  chooseEffectOption(game, "probe-field-1");
  return { choice, chosenDamage: chosen.damage, otherDamage: other.damage };
}

function preventedAreaDamage() {
  const { game, player, opponent } = ruleGame();
  const spell = instance(cards.firestorm, player.id, "probe-prevented-firestorm");
  const target = durableUnit(opponent.id, "probe-prevented-target");
  game.preventSpellAbilityDamageUntilTurnSequence = game.turnSequence;
  game.battlefields = [battlefield("probe-prevented-field", opponent.id, [target])];
  resolveEffect(game, player, spell);
  chooseEffectOption(game, "probe-prevented-field");
  return { damage: target.damage };
}

function sourceControllerBonus() {
  const { game, player, opponent } = ruleGame();
  const annie = instance(cards.annieFiery, player.id, "probe-source-annie");
  const spell = instance(cards.incinerate, player.id, "probe-source-incinerate");
  const target = durableUnit(opponent.id, "probe-source-target");
  player.base = [annie];
  game.currentPlayerId = opponent.id;
  game.battlefields = [battlefield("probe-source-field", opponent.id, [target])];
  resolveEffect(game, player, spell);
  chooseEffectOption(game, target.instanceId);
  return { damage: target.damage };
}

function gentlemensDuel() {
  const { game, player, opponent } = ruleGame();
  const friendly = plainUnit(player.id, "probe-duel-friendly", 2);
  const enemy = plainUnit(opponent.id, "probe-duel-enemy", 10);
  const spell = instance(cards.gentlemensDuel, player.id, "probe-duel");
  player.base = [friendly];
  opponent.base = [enemy];
  resolveEffect(game, player, spell);
  chooseEffectOption(game, friendly.instanceId);
  const friendlyMightBeforeStrike = currentMight(game, friendly);
  chooseEffectOption(game, enemy.instanceId);
  return { friendlyMightBeforeStrike, enemyDamage: enemy.damage };
}

function recruitDestinations() {
  const { game, player } = ruleGame();
  const spell = instance(cards.recruitTheVanguard, player.id, "probe-recruit-spell");
  game.battlefields = [battlefield("probe-recruit-field", player.id)];
  resolveEffect(game, player, spell);
  let choiceCount = 0;
  for (const destination of ["base", "probe-recruit-field", "base", "probe-recruit-field"]) {
    if (game.pendingChoice?.effect === "playUnitTokenDestination") choiceCount += 1;
    chooseEffectOption(game, destination);
  }
  return { choiceCount, base: player.base.length, battlefield: game.battlefields[0].units.length };
}

function garenConquerOnce() {
  const { game, player, opponent } = ruleGame();
  player.legend = instance(cards.garenMightOfDemacia, player.id, "probe-garen-legend");
  player.mainDeck = Array.from({ length: 6 }, (_, index) => plainUnit(player.id, `probe-garen-deck-${index}`, 1));
  player.base = Array.from({ length: 4 }, (_, index) => plainUnit(player.id, `probe-garen-unit-${index}`, 1));
  game.battlefields = [battlefield("probe-garen-field", opponent.id)];
  const before = player.mainDeck.length;
  moveUnits(game, player.base.map((unit) => unit.instanceId), "probe-garen-field");
  passShowdown(game);
  passShowdown(game);
  return { cardsDrawn: before - player.mainDeck.length, score: player.score };
}

function luxDuringSpellPayment() {
  const { game, player, opponent } = ruleGame();
  const lux = instance(cards.luxCrownguard, player.id, "probe-lux");
  const spell = instance(cards.incinerate, player.id, "probe-lux-spell");
  const target = durableUnit(opponent.id, "probe-lux-target");
  player.base = [lux];
  player.hand = [spell];
  game.battlefields = [battlefield("probe-lux-field", opponent.id, [target])];
  beginPlayCard(game, spell.instanceId, "base");
  chooseEffectOption(game, target.instanceId);
  const result = activateCard(game, lux.instanceId);
  return { activationOk: result.ok, exhausted: lux.exhausted, spellEnergy: player.runePool.energy.length };
}

function baseMightAura() {
  const { game, player } = ruleGame();
  const garen = instance(cards.garenCommander, player.id, "probe-aura-garen");
  const unit = plainUnit(player.id, "probe-aura-unit", 2);
  player.base = [garen, unit];
  return { currentMight: currentMight(game, unit) };
}

function runeThresholdMight() {
  const { game, player } = ruleGame();
  const yi = instance(cards.masterYiMeditative, player.id, "probe-rune-yi");
  player.base = [yi];
  player.runes = Array.from({ length: 8 }, (_, index) => ({ instanceId: `probe-rune-${index}`, domain: "Calm", exhausted: false }));
  return { currentMight: currentMight(game, yi) };
}

function variantEffectParity() {
  const amount = (card) => card.effects.find((effect) => effect.timing === "attackOrDefend" && effect.kind === "splitDamageEnemyHere")?.amount ?? null;
  return { baseAmount: amount(cards.volibearFurious), variantAmount: amount(cards.volibearFurious2) };
}

function volibearSplitDamage() {
  const { game, player, opponent } = ruleGame();
  const volibear = instance(cards.volibearFurious, player.id, "probe-volibear-split");
  const enemy = plainUnit(opponent.id, "probe-volibear-split-enemy", 20);
  player.base = [volibear];
  game.battlefields = [battlefield("probe-volibear-split-field", opponent.id, [enemy])];
  moveUnits(game, [volibear.instanceId], game.battlefields[0].instanceId);
  const choice = game.pendingChoice?.effect || null;
  const target = game.pendingChoice?.options?.find((option) => option.cardId === enemy.instanceId);
  if (target) chooseEffectOption(game, target.id);
  const finishTargets = game.pendingChoice?.options?.find((option) => option.id === "finish-split-targets");
  if (finishTargets) chooseEffectOption(game, finishTargets.id);
  for (let index = 0; index < 2 && !game.pendingChoice && game.phase === "showdown"; index += 1) passShowdown(game);
  const allocation = game.pendingChoice?.options?.find((option) => option.amount === 5);
  if (allocation) chooseEffectOption(game, allocation.id);
  if (game.phase === "showdown") passShowdown(game);
  if (game.phase === "showdown") passShowdown(game);
  return { choice, damage: enemy.damage || 0 };
}

function vilemawHoldDraw() {
  const { game, player } = ruleGame();
  const vilemaw = instance(cards.vilemaw, player.id, "probe-vilemaw-hold");
  game.battlefields = [battlefield("probe-vilemaw-hold-field", player.id, [vilemaw])];
  player.mainDeck = [plainUnit(player.id, "probe-vilemaw-hold-draw", 1), plainUnit(player.id, "probe-vilemaw-turn-draw", 1)];
  startTurn(game);
  return { drawn: player.hand.length };
}

function reckonerHoldConquer() {
  const { game, player } = ruleGame();
  const kaiSa = instance(cards.kaiSaSurvivor, player.id, "probe-reckoner-kaisa");
  game.battlefields = [{
    ...instance(cards.reckonersArena, player.id, "probe-reckoner-field"),
    controlledBy: player.id,
    hidden: [],
    units: [kaiSa]
  }];
  player.mainDeck = [plainUnit(player.id, "probe-reckoner-conquer-draw", 1), plainUnit(player.id, "probe-reckoner-turn-draw", 1)];
  startTurn(game);
  return { drawn: player.hand.length };
}

function masterYiHuntGainXp() {
  const { game, player } = ruleGame();
  const yi = instance(cards.masterYiTempered, player.id, "probe-master-yi-hunt");
  game.battlefields = [battlefield("probe-master-yi-hunt-field", player.id, [yi])];
  startTurn(game);
  return { xp: player.xp };
}

function basicRuneAddsMatchingPower() {
  const { game, player } = ruleGame();
  const rune = instance(cards.bodyRune, player.id, "probe-basic-body-rune");
  player.runes = [rune];
  player.runeDeck = [];
  const activated = activateCard(game, rune.instanceId);
  const powerOption = game.pendingChoice?.options?.find((option) => option.id === `${rune.instanceId}:basic-rune-power`);
  const chosen = powerOption ? chooseEffectOption(game, powerOption.id) : { ok: false };
  return {
    activationChoice: activated.ok === true && chosen.ok === true,
    recycled: !player.runes.some((card) => card.instanceId === rune.instanceId)
      && player.runeDeck.some((card) => card.instanceId === rune.instanceId),
    power: player.runePool.power[0]?.domain || null
  };
}

function visionPredictsOnPlay() {
  return visionOrder({
    played: cards.mysticPoro,
    prefix: "probe-vision",
    aura: false
  });
}

function friendlyVisionAura() {
  return visionOrder({
    played: cards.lonelyPoro,
    prefix: "probe-aura",
    aura: true
  });
}

function recycleTriggerBuffs() {
  const { game, player, opponent } = ruleGame();
  const karma = instance(cards.karmaChanneler, player.id, "probe-karma-recycle");
  const target = plainUnit(player.id, "probe-karma-target", 2);
  const recycled = instance(cards.stackedDeck, opponent.id, "probe-karma-opponent-card");
  const spell = instance(cards.sabotage, player.id, "probe-karma-sabotage");
  player.base = [karma, target];
  opponent.hand = [recycled];
  resolveEffect(game, player, spell);
  chooseEffectOption(game, recycled.instanceId);
  const choice = game.pendingChoice?.effect || null;
  chooseEffectOption(game, target.instanceId);
  for (let guard = 0; game.actionChain && !game.pendingChoice && guard < 8; guard += 1) {
    passShowdown(game, game.actionChain.priorityPlayerId);
  }
  return {
    choice,
    buffs: target.buffs || 0,
    ownerDeck: opponent.mainDeck.some((card) => card.instanceId === recycled.instanceId)
  };
}

function visionOrder({ played, prefix, aura }) {
  const { game, player } = ruleGame();
  game.interactive = false;
  const unit = instance({ ...played, energy: 0, power: [] }, player.id, `${prefix}-played`);
  const top = plainUnit(player.id, `${prefix}-top`, 1);
  const middle = plainUnit(player.id, `${prefix}-middle`, 1);
  const bottom = plainUnit(player.id, `${prefix}-bottom`, 1);
  player.base = aura ? [instance(cards.gemcraftSeer, player.id, `${prefix}-seer`)] : [];
  player.hand = [unit];
  player.mainDeck = [top, middle, bottom];
  const result = playCard(game, unit.instanceId, "base");
  if (!result.ok) throw new Error(`Vision probe play was rejected: ${result.message || "unknown error"}`);
  return { order: player.mainDeck.map((card) => card.instanceId) };
}

function quickDrawAttachesOnPlay() {
  const { game, player } = ruleGame();
  game.interactive = false;
  const unit = plainUnit(player.id, "probe-quick-draw-unit", 2);
  const gear = instance({
    ...cards.trinityForce,
    id: "PROBE-QUICK-DRAW",
    cardNumber: "PROBE-QUICK-DRAW/001",
    collectorNumber: "PROBE-QUICK-DRAW/001",
    name: "Probe Quick-Draw Equipment",
    energy: 0,
    power: [],
    keywords: ["Equip", "Quick-Draw"],
    text: "[Quick-Draw]\n[Equip] Body Power"
  }, player.id, "probe-quick-draw-equipment");
  player.base = [unit];
  player.hand = [gear];
  playCard(game, gear.instanceId, "base");
  return {
    attached: unit.attachments.some((card) => card.instanceId === gear.instanceId),
    remainsAtBase: player.base.some((card) => card.instanceId === gear.instanceId)
  };
}

function weaponmasterAttachesWithDiscount() {
  const { game, player } = ruleGame();
  game.interactive = false;
  const akshan = instance(cards.akshanMischievous, player.id, "probe-weaponmaster-akshan");
  const equipment = instance(cards.trinityForce, player.id, "probe-weaponmaster-equipment");
  player.base = [equipment];
  player.hand = [akshan];
  player.runes = Array.from({ length: 4 }, (_, index) => ({
    instanceId: `probe-weaponmaster-rune-${index}`,
    ownerId: player.id,
    controllerId: player.id,
    type: "rune",
    domain: "Body",
    exhausted: false
  }));
  playCard(game, akshan.instanceId, "base");
  return {
    attached: akshan.attachments.some((card) => card.instanceId === equipment.instanceId),
    runesRemaining: player.runes.length
  };
}

function vilemawSuppressesWeakerDamage() {
  const { game, player, opponent } = ruleGame();
  const attacker = plainUnit(player.id, "probe-vilemaw-weak-attacker", 2);
  const vilemaw = instance(cards.vilemaw, opponent.id, "probe-vilemaw-defender");
  player.base = [attacker];
  game.battlefields = [battlefield("probe-vilemaw-combat-field", opponent.id, [vilemaw])];
  moveUnits(game, [attacker.instanceId], game.battlefields[0].instanceId);
  if (game.phase === "showdown") passShowdown(game);
  if (game.phase === "showdown") passShowdown(game);
  return { assigner: game.pendingChoice?.playerId === opponent.id ? "defender" : "attacker" };
}

function combatDamageLastPriority() {
  const { game, player, opponent } = ruleGame();
  const attacker = plainUnit(player.id, "probe-last-attacker", 6);
  const caitlyn = instance(cards.caitlynPatrolling, opponent.id, "probe-last-caitlyn");
  const normal = plainUnit(opponent.id, "probe-last-normal", 2);
  player.base = [attacker];
  game.battlefields = [battlefield("probe-last-field", opponent.id, [caitlyn, normal])];
  moveUnits(game, [attacker.instanceId], game.battlefields[0].instanceId);
  passShowdown(game);
  passShowdown(game);
  const firstTarget = game.pendingChoice?.options?.[0]?.id || null;
  chooseEffectOption(game, firstTarget);
  const secondTarget = game.pendingChoice?.options?.[0]?.id || null;
  return { firstTarget, secondTarget };
}

function vayneConquerPayment() {
  const { game, player, opponent } = ruleGame();
  const vayne = instance(cards.vayneHunter, player.id, "probe-vayne");
  player.base = [vayne];
  player.runes = [{ instanceId: "probe-vayne-rune", domain: "Fury", exhausted: false }];
  game.battlefields = [battlefield("probe-vayne-field", opponent.id)];
  moveUnits(game, [vayne.instanceId], "probe-vayne-field");
  passShowdown(game);
  passShowdown(game);
  if (game.pendingChoice?.effect === "declareOptionalTrigger") {
    chooseEffectOption(game, "use-optional-trigger");
  }
  togglePaymentRune(game, "probe-vayne-rune", "energy");
  confirmPayment(game);
  return {
    returned: player.hand.some((card) => card.instanceId === vayne.instanceId),
    runeExhausted: player.runes[0]?.exhausted === true
  };
}

function trashConquerReturn() {
  const { game, player, opponent } = ruleGame();
  const unit = plainUnit(player.id, "probe-rocket-conqueror", 2);
  const rocket = instance(cards.superMegaDeathRocket, player.id, "probe-rocket");
  const discarded = plainUnit(player.id, "probe-rocket-discard", 1);
  player.base = [unit];
  player.trash = [rocket];
  player.hand = [discarded];
  game.battlefields = [battlefield("probe-rocket-field", opponent.id)];
  moveUnits(game, [unit.instanceId], "probe-rocket-field");
  passShowdown(game);
  passShowdown(game);
  if (game.pendingChoice?.effect === "declareOptionalTrigger") {
    chooseEffectOption(game, "use-optional-trigger");
  }
  chooseEffectOption(game, discarded.instanceId);
  return {
    returned: player.hand.some((card) => card.instanceId === rocket.instanceId),
    discarded: player.trash.some((card) => card.instanceId === discarded.instanceId)
  };
}

function warwickKillsDamaged() {
  const { game, player, opponent } = ruleGame();
  const warwick = instance(cards.warwickHunter, player.id, "probe-warwick");
  const enemy = plainUnit(opponent.id, "probe-warwick-enemy", 10);
  enemy.damage = 1;
  player.base = [warwick];
  game.battlefields = [battlefield("probe-warwick-field", opponent.id, [enemy])];
  moveUnits(game, [warwick.instanceId], "probe-warwick-field");
  passShowdown(game);
  passShowdown(game);
  return { killed: opponent.trash.some((card) => card.instanceId === enemy.instanceId) };
}

function leonaNearVictory() {
  const { game, player, opponent } = ruleGame();
  game.interactive = false;
  opponent.score = game.victoryScore - 3;
  const leona = instance(cards.leonaZealot, player.id, "probe-leona");
  player.hand = [leona];
  player.runes = Array.from({ length: 6 }, (_, index) => ({ instanceId: `probe-leona-rune-${index}`, domain: "Calm", exhausted: false }));
  playCard(game, leona.instanceId, "base");
  return { enteredReady: player.base.find((card) => card.instanceId === leona.instanceId)?.exhausted === false };
}

function piratesHavenReadyMight() {
  const { game, player } = ruleGame();
  const target = plainUnit(player.id, "probe-pirates-haven-target", 2);
  const haven = instance(cards.piratesHaven, player.id, "probe-pirates-haven");
  const wallop = instance(cards.wallop, player.id, "probe-pirates-haven-wallop");
  target.exhausted = true;
  player.base = [target, haven];
  resolveEffect(game, player, wallop);
  chooseEffectOption(game, target.instanceId);
  return {
    exhausted: target.exhausted,
    might: currentMight(game, target),
    temporary: target.temporaryMight || 0
  };
}

function mistfallBuffReady() {
  const { game, player } = ruleGame();
  const target = plainUnit(player.id, "probe-mistfall-target", 2);
  const bar = instance(cards.arenaBar, player.id, "probe-mistfall-arena-bar");
  const mistfall = instance(cards.mistfall, player.id, "probe-mistfall");
  target.exhausted = true;
  player.base = [target, bar, mistfall];
  player.runes = [{ instanceId: "probe-mistfall-body-rune", domain: "Body", exhausted: false }];
  activateCard(game, bar.instanceId);
  chooseEffectOption(game, target.instanceId);
  if (game.pendingChoice?.effect === "declareOptionalTrigger") {
    chooseEffectOption(game, "use-optional-trigger");
  }
  togglePaymentRune(game, "probe-mistfall-body-rune", "power");
  confirmPayment(game);
  return {
    buffed: target.buffs || 0,
    ready: target.exhausted === false,
    mistfallExhausted: mistfall.exhausted === true,
    runes: player.runes.length
  };
}

function lonelyPoroDeathknellAlone() {
  const { game, player, opponent } = ruleGame();
  const poro = instance(cards.lonelyPoro, player.id, "probe-lonely-poro");
  const spell = instance(cards.incinerate, opponent.id, "probe-lonely-poro-incinerate");
  const drawn = plainUnit(player.id, "probe-lonely-poro-draw", 1);
  game.battlefields = [battlefield("probe-lonely-poro-field", player.id, [poro])];
  player.mainDeck = [drawn];

  resolveEffect(game, opponent, spell);
  const chosen = chooseEffectOption(game, poro.instanceId);
  if (!chosen.ok) throw new Error(`Incinerate target was rejected: ${chosen.error || "unknown error"}`);
  let safety = 0;
  while (game.actionChain && safety < 10) {
    const passed = passShowdown(game, game.actionChain.priorityPlayerId);
    if (!passed.ok) throw new Error(`Deathknell Chain pass was rejected: ${passed.error || "unknown error"}`);
    safety += 1;
  }
  if (game.actionChain) throw new Error("Deathknell Chain did not settle within 10 passes");
  return {
    killed: player.trash.some((card) => card.instanceId === poro.instanceId),
    drawn: player.hand.filter((card) => card.instanceId === drawn.instanceId).length
  };
}

function printedMultiPartEffects() {
  const entry = ruleGame();
  entry.game.interactive = false;
  const field = battlefield("probe-multi-entry-field", entry.player.id, [plainUnit(entry.player.id, "probe-multi-ally", 2)]);
  entry.game.battlefields = [field];
  const ally = field.units[0];
  const guardian = instance({ ...cards.peakGuardian, energy: 0, power: [] }, entry.player.id, "probe-multi-guardian");
  const ballista = instance({ ...cards.ironBallista, energy: 0, power: [] }, entry.player.id, "probe-multi-ballista");
  entry.player.hand = [guardian, ballista];
  playCard(entry.game, guardian.instanceId, field.instanceId);
  playCard(entry.game, ballista.instanceId, "base");

  const readyLock = ruleGame();
  const warden = instance(cards.mageseekerWarden, readyLock.opponent.id, "probe-multi-warden");
  const readyTarget = plainUnit(readyLock.player.id, "probe-multi-ready-target", 2);
  readyTarget.exhausted = true;
  readyLock.game.battlefields = [battlefield("probe-multi-warden-field", readyLock.opponent.id, [warden])];
  readyLock.player.base = [readyTarget];
  const readySpell = instance({
    ...cards.wallop,
    effects: [{ timing: "spell", kind: "readyUnitAny" }]
  }, readyLock.player.id, "probe-multi-ready-spell");
  resolveEffect(readyLock.game, readyLock.player, readySpell);
  chooseEffectOption(readyLock.game, readyTarget.instanceId);

  const hiding = ruleGame();
  const hideField = battlefield("probe-multi-hide-field", hiding.player.id, []);
  hiding.game.battlefields = [hideField];
  hiding.player.legend = instance(cards.teemoSwiftScout, hiding.player.id, "probe-multi-teemo");
  const hiddenCard = instance({ ...cards.backOff, energy: 0, power: [] }, hiding.player.id, "probe-multi-hidden-card");
  hiding.player.hand = [hiddenCard];
  hideCard(hiding.game, hiddenCard.instanceId, hideField.instanceId);
  chooseEffectOption(hiding.game, "energy");

  const recycling = ruleGame();
  const forge = instance(cards.forgeOfTheFuture, recycling.player.id, "probe-multi-forge");
  const ownTrash = plainUnit(recycling.player.id, "probe-multi-own-trash", 1);
  const enemyTrash = plainUnit(recycling.opponent.id, "probe-multi-enemy-trash", 1);
  recycling.player.base = [forge];
  recycling.player.trash = [ownTrash];
  recycling.opponent.trash = [enemyTrash];
  activateCard(recycling.game, forge.instanceId);
  chooseEffectOption(recycling.game, enemyTrash.instanceId);
  const stopped = declineEffectChoice(recycling.game);

  return {
    ballistaExhausted: ballista.exhausted,
    guardianBuffs: [guardian.buffs || 0, ally.buffs || 0],
    readyPrevented: readyTarget.exhausted,
    hideEnergyCost: hiding.game.pendingPayment?.energyCost || 0,
    forgeKilled: recycling.player.trash.some((card) => card.instanceId === forge.instanceId),
    enemyCardRecycled: recycling.opponent.mainDeck.some((card) => card.instanceId === enemyTrash.instanceId),
    forgeStoppedEarly: stopped.ok && recycling.player.trash.some((card) => card.instanceId === ownTrash.instanceId)
  };
}

function playedEventRequiresResolution() {
  const setup = (suffix) => {
    const { game, player, opponent } = ruleGame();
    game.manualActionChainPriority = true;
    player.legend = instance(cards.luxLadyOfLuminosity, player.id, `probe-played-lux-legend-${suffix}`);
    const lux = instance(cards.luxIlluminated, player.id, `probe-played-lux-${suffix}`);
    const raven = instance(cards.ravenbloomStudent, player.id, `probe-played-raven-${suffix}`);
    const spell = instance(cards.stackedDeck, player.id, `probe-played-spell-${suffix}`);
    spell.energy = 5;
    spell.power = [];
    spell.effects = [];
    player.base = [lux, raven];
    player.hand = [spell];
    player.mainDeck = [plainUnit(player.id, `probe-played-draw-${suffix}`, 1)];
    player.runes = Array.from({ length: 5 }, (_, index) => ({
      instanceId: `probe-played-rune-${suffix}-${index}`,
      ownerId: player.id,
      controllerId: player.id,
      domain: "Mind",
      exhausted: false
    }));
    player.cardsPlayedThisTurn = 0;
    return { game, player, opponent, lux, raven, spell };
  };
  const snapshot = ({ player, lux, raven }, initialDeckSize) => ({
    count: player.cardsPlayedThisTurn || 0,
    luxMight: lux.temporaryMight || 0,
    ravenMight: raven.temporaryMight || 0,
    drawn: initialDeckSize - player.mainDeck.length
  });

  const counteredGame = setup("countered");
  playCard(counteredGame.game, counteredGame.spell.instanceId, "base");
  const pending = snapshot(counteredGame, 1);
  const counter = instance(cards.defy, counteredGame.opponent.id, "probe-played-counter");
  counter.effects = counter.effects.map((effect) => ({ ...effect, maxEnergy: 9, maxPower: 9 }));
  resolveEffect(counteredGame.game, counteredGame.opponent, counter);
  chooseEffectOption(counteredGame.game, counteredGame.spell.instanceId);
  const countered = {
    ...snapshot(counteredGame, 1),
    chainCount: counteredGame.game.actionChain?.chain?.length || 0,
    inOwnerTrash: counteredGame.player.trash.some((card) => card.instanceId === counteredGame.spell.instanceId)
  };

  const resolvedGame = setup("resolved");
  playCard(resolvedGame.game, resolvedGame.spell.instanceId, "base");
  let steps = 0;
  while (steps < 30) {
    if (resolvedGame.game.pendingChoice?.effect === "triggerOrder") {
      const nextMandatory = resolvedGame.game.pendingChoice.options
        .find((option) => !option.confirmTriggerOrder && !option.optionalTrigger && !option.selected);
      const confirmOrder = resolvedGame.game.pendingChoice.options.find((option) => option.confirmTriggerOrder);
      chooseEffectOption(resolvedGame.game, (nextMandatory || confirmOrder)?.id);
      steps += 1;
      continue;
    }
    if (resolvedGame.game.actionChain && !resolvedGame.game.pendingChoice && !resolvedGame.game.pendingPayment) {
      passShowdown(resolvedGame.game, resolvedGame.game.actionChain.priorityPlayerId);
      steps += 1;
      continue;
    }
    break;
  }
  const resolved = snapshot(resolvedGame, 1);
  return { pending, countered, resolved };
}

function ruleGame() {
  const game = createGame({ interactive: true });
  const [player, opponent] = game.players;
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.firstPlayerId = player.id;
  game.turnSequence = 1;
  game.battlefields = [];
  for (const candidate of game.players) {
    candidate.score = 0;
    candidate.xp = 0;
    candidate.hand = [];
    candidate.base = [];
    candidate.mainDeck = [];
    candidate.runeDeck = [];
    candidate.runes = [];
    candidate.trash = [];
    candidate.banished = [];
    candidate.turnScoredBattlefields = [];
  }
  return { game, player, opponent };
}

function instance(card, ownerId, instanceId) {
  return {
    ...structuredClone(card),
    instanceId,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachments: []
  };
}

function plainUnit(ownerId, instanceId, might) {
  return instance({
    id: instanceId,
    cardNumber: instanceId,
    collectorNumber: instanceId,
    name: instanceId,
    type: "unit",
    tags: [],
    keywords: [],
    effects: [],
    might
  }, ownerId, instanceId);
}

function durableUnit(ownerId, instanceId) {
  return plainUnit(ownerId, instanceId, 10);
}

function battlefield(instanceId, controlledBy = null, units = []) {
  return {
    id: instanceId,
    cardNumber: instanceId,
    collectorNumber: instanceId,
    instanceId,
    name: instanceId,
    type: "battlefield",
    controlledBy,
    units,
    hidden: [],
    effects: []
  };
}
