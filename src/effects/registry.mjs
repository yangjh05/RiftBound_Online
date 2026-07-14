export const EFFECT_TIMINGS = Object.freeze([
  "activated",
  "attackOrDefend",
  "battlefieldControl",
  "beginning",
  "combatStatic",
  "conquer",
  "conquerHere",
  "cardPlayed",
  "death",
  "discard",
  "discarded",
  "defendHere",
  "endTurn",
  "firstBeginning",
  "hold",
  "keyword",
  "levelStatic",
  "onMove",
  "onPlay",
  "opponentPlaysUnit",
  "replacement",
  "score",
  "secondDrawEachTurn",
  "showdownBeginsHere",
  "spell",
  "spellPlayed",
  "stun",
  "enemyKilled",
  "static"
]);

export const TARGET_PROVIDERS = Object.freeze({
  ALL_UNITS: "allUnits",
  TARGETABLE_UNITS: "targetableUnits",
  BATTLEFIELD_UNITS: "battlefieldUnits",
  CHAIN_SPELLS: "chainSpells",
  OPPONENT_NON_UNIT_HAND: "opponentNonUnitHand",
  TOP_DECK: "topDeck",
  ALL_GEAR: "allGear",
  ALPHA_STRIKE: "alphaStrike",
  FRIENDLY_AND_ENEMY_UNITS: "friendlyAndEnemyUnits",
  MOONFALL: "moonfall",
  BATTLEFIELDS: "battlefields",
  OPPONENTS: "opponents"
});

export const SPELL_TARGET_DECLARATIONS = Object.freeze({
  moveUnit: {
    choiceEffect: "moveUnitSpellTarget",
    destinationEffect: "moveUnitSpellDestination",
    requiresDestination: true,
    provider: TARGET_PROVIDERS.ALL_UNITS,
    scopeByTarget: { friendlyUnit: "friendly" },
    defaultScope: "enemy"
  },
  moveFriendlyAndReady: {
    choiceEffect: "moveUnitSpellTarget",
    destinationEffect: "moveUnitSpellDestination",
    requiresDestination: true,
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  moveFriendlyUnitsToBase: {
    choiceEffect: "returnUnitToBase",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "friendlyBattlefield",
    minTargets: 0,
    maxTargets: 2,
    multi: true
  },
  modifyMight: {
    choiceEffect: "modifyMight",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    scopeByTarget: { friendlyUnit: "friendly" },
    defaultScope: "any"
  },
  stunUnit: {
    choiceEffect: "stunUnit",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    scopeByTarget: { unit: "any" },
    defaultScope: "enemy"
  },
  stunOrReturnAttackingEnemy: {
    choiceEffect: "stunUnit",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    defaultScope: "attackingEnemy"
  },
  returnBattlefieldUnitToHand: {
    choiceEffect: "returnUnitToHand",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "battlefield"
  },
  counterSpell: {
    choiceEffect: "counterChainCard",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS,
    defaultScope: "enemySpell"
  },
  counterUnlessPayEnergy: {
    choiceEffect: "counterUnlessPay",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS,
    defaultScope: "enemySpell"
  },
  dealDamageUnit: {
    choiceEffect: "damageUnit",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    scopeByTarget: { unit: "any", enemyUnit: "enemy", battlefieldUnit: "battlefield", enemyBattlefieldUnit: "enemyBattlefield" },
    defaultScope: "battlefield"
  },
  killUnit: {
    choiceEffect: "killUnit",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    scopeByTarget: { unit: "any", enemyUnit: "enemy", battlefieldUnit: "battlefield", enemyBattlefieldUnit: "enemyBattlefield" },
    defaultScope: "any"
  },
  killGear: {
    choiceEffect: "trashGear",
    provider: TARGET_PROVIDERS.ALL_GEAR,
    defaultScope: "any"
  },
  giveTemporaryGear: {
    choiceEffect: "markTemporaryGear",
    provider: TARGET_PROVIDERS.ALL_GEAR,
    defaultScope: "any"
  },
  giveKeyword: {
    choiceEffect: "giveKeyword",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    scopeByTarget: { friendlyUnit: "friendly" },
    defaultScope: "any"
  },
  doubleMightTemporary: {
    choiceEffect: "doubleMightTemporary",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  enGarde: {
    choiceEffect: "enGarde",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  readyUnitAny: {
    choiceEffect: "readyUnitAny",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "any"
  },
  possession: {
    choiceEffect: "possession",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "enemyBattlefield"
  },
  standUnited: {
    choiceEffect: "standUnited",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  returnUnitToBase: {
    choiceEffect: "returnUnitToBase",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    scopeByTarget: { friendlyBattlefield: "friendlyBattlefield", enemyBattlefield: "enemyBattlefield" },
    defaultScope: "battlefield"
  },
  moveFriendlyUnitsToBase: {
    choiceEffect: "returnUnitToBase",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "friendlyBattlefield"
  },
  alphaStrike: {
    steps: [
      { choiceEffect: "alphaStrike", provider: TARGET_PROVIDERS.ALPHA_STRIKE, defaultScope: "friendly" },
      { choiceEffect: "alphaStrikeDamage", provider: "alphaStrikeAllocation", multi: true, allocation: true }
    ]
  },
  discardEnergyDamageUnit: {
    choiceEffect: "damageUnit",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    defaultScope: "battlefield"
  },
  gainControlOfSpell: {
    choiceEffect: "counterChainCard",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS,
    defaultScope: "enemySpell"
  },
  banishFriendlyUnitPlayToBase: {
    choiceEffect: "banishFriendlyUnitPlayToBase",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  killOnNextDamageOrNowIfLegion: {
    choiceEffect: "killOnNextDamageOrNowIfLegion",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    defaultScope: "any"
  },
  matchFriendlyMight: {
    steps: [
      { choiceEffect: "matchFriendlyMightTarget", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "matchFriendlyMightSource", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", excludePreviouslyDeclared: true }
    ]
  },
  duelFriendlyEnemy: {
    steps: [
      { choiceEffect: "duelFriendlyEnemy", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "duelEnemy", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy" }
    ]
  },
  returnFriendlyAndEnemyToHand: {
    steps: [
      { choiceEffect: "starCrossed", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "starCrossedEnemy", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy" }
    ]
  },
  facebreaker: {
    steps: [
      { choiceEffect: "facebreakerFriendly", provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, defaultScope: "friendlyBattlefield", requiresEnemyAtSameBattlefield: true },
      { choiceEffect: "facebreakerEnemy", provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, defaultScope: "enemyBattlefield", sameBattlefieldAsPrevious: true }
    ]
  },
  moonfall: {
    steps: [
      { choiceEffect: "moonfall", provider: TARGET_PROVIDERS.BATTLEFIELDS, friendlyOccupied: true },
      { choiceEffect: "moonfallMove", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy", optional: true, outsidePreviouslyDeclaredBattlefield: true }
    ]
  },
  lastBreath: {
    steps: [
      { choiceEffect: "lastBreathSource", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "lastBreathEnemy", provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, defaultScope: "enemyBattlefield" }
    ]
  },
  zenithBlade: {
    steps: [
      { choiceEffect: "zenithBladeEnemy", provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, defaultScope: "enemyBattlefield" },
      { choiceEffect: "zenithBladeFriendly", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", optional: true }
    ]
  },
  showstopper: {
    steps: [
      { choiceEffect: "showstopperUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", baseOnly: true },
      { choiceEffect: "showstopperDestination", provider: TARGET_PROVIDERS.BATTLEFIELDS }
    ]
  },
  stormbringer: {
    steps: [
      { choiceEffect: "stormbringerUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", baseOnly: true },
      { choiceEffect: "stormbringerDestination", provider: TARGET_PROVIDERS.BATTLEFIELDS }
    ]
  },
  siphonPower: {
    choiceEffect: "siphonPowerBattlefield",
    provider: TARGET_PROVIDERS.BATTLEFIELDS
  },
  damageEnemyUnitsAtBattlefieldByReadyRunes: {
    steps: [
      { choiceEffect: "damageEnemyUnitsAtBattlefieldByReadyRunes", provider: TARGET_PROVIDERS.BATTLEFIELDS },
      { choiceEffect: "runeDamagePaymentRune", provider: "readyRunes", optional: true, multi: true }
    ]
  },
  killBattlefieldUnitsTotalMightMax: {
    steps: [
      { choiceEffect: "killBattlefieldUnitsTotalMightMax", provider: TARGET_PROVIDERS.BATTLEFIELDS },
      { choiceEffect: "killBattlefieldUnitsSelection", provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, sameBattlefieldAsPrevious: true, optional: true, maxTotalMightFromSpec: true, multi: true }
    ]
  },
  dragonsRage: {
    choiceEffect: "moveUnitSpellTarget",
    destinationEffect: "moveUnitSpellDestination",
    requiresDestination: true,
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "enemy"
  },
  recycleOpponentNonUnit: {
    choiceEffect: "sabotageOpponent",
    provider: TARGET_PROVIDERS.OPPONENTS
  },
  returnHiddenTrashToHand: {
    choiceEffect: "returnHiddenTrashToHand",
    provider: "friendlyHiddenTrash",
    minTargets: 0,
    maxTargets: 2,
    multi: true
  },
  playUnitFromTrash: {
    choiceEffect: "playTrashUnit",
    provider: "friendlyTrashUnits"
  },
  returnTrashUnitToHand: {
    choiceEffect: "returnTrashUnitToHand",
    provider: "friendlyTrashUnits"
  },
  giveTemporaryUnitOrGear: {
    choiceEffect: "markTemporaryPermanent",
    provider: "battlefieldUnitsOrGear"
  }
});

const effectDefinitions = [
  effect("activated", "equip", { sourceTypes: ["gear"] }),
  effect("activated", "buffUnit", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "dealDamageUnit", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("activated", "draw", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("activated", "giveKeyword", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "modifyMight", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "returnUnitToBase", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("activated", "returnFriendlyPermanentOrHiddenToHand", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "baitedHook", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "killFriendlyPermanentChannelRune", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "killSelf", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("activated", "nextUnitEnterReady", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("activated", "nextSpellBonusDamage", { sourceTypes: ["gear"], targetless: true }),
  effect("activated", "moveFriendlyUnit", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "returnOwnedTagUnitToHand", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "playUnitToken", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("activated", "addEnergy", { sourceTypes: ["legend", "gear", "unit"], targetless: true }),
  effect("attackOrDefend", "ifEnemyAloneBuffAndXp", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "dealDamageEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "splitDamageEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "dealDamageAllEnemiesHere", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "modifySelfIfReadyEnemyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "modifyFriendlyAlone", { sourceTypes: ["gear", "unit"], targetless: true }),
  effect("attackOrDefend", "modifyEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "stunEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "playHiddenFromHand", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "damageEnemyByHiddenTopDeck", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "runeDeckGambit", { sourceTypes: ["unit"], targetless: true }),
  effect("battlefieldControl", "legendAttachEquipment", { sourceTypes: ["battlefield"], targetless: true }),
  effect("beginning", "drawIfHandSizeAtMost", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("beginning", "drawIfControlsHidden", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("beginning", "recycleTrash", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("combatStatic", "spellCostModifier", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "anotherUnitBuffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "gearReadySelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "opponentTurnRecruit", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "secondCardMightReadySelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "fromHiddenBuffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "exhaustSelfChannelOnMightyUnit", { sourceTypes: ["legend"], targetless: true }),
  effect("cardPlayed", "highCostSpellBuffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "highCostSpellDraw", { sourceTypes: ["legend"], targetless: true }),
  effect("buff", "exhaustPayReadyBuffedUnit", { sourceTypes: ["gear"], targetless: true }),
  effect("conquerHere", "readyRunesEndTurn", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "discardDraw", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "recycleRunes", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "spendBuffDraw", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "recycleTopDeck", { sourceTypes: ["battlefield"], targetless: true }),
  effect("death", "drawIfAlone", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "draw", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "channelRunes", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "discardDraw", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "dealDamageAllHere", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "playUnitToken", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "gainXp", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "revealOpponentHand", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "recycleSelfReadyRunes", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "drawOnFirstOtherFriendlyUnitDeath", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "playRecruitOnOtherFriendlyNonRecruitDeath", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "buffAnotherFriendlyOnBuffedUnitDeath", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("endTurn", "readyRunesIfAtBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("endTurn", "readyRunes", { sourceTypes: ["legend"], targetless: true }),
  effect("endTurn", "playTopDeckUnitIgnoreCost", { sourceTypes: ["gear"], targetless: true }),
  effect("discard", "readySelfMight", { sourceTypes: ["unit"], targetless: true }),
  effect("discarded", "draw", { sourceTypes: ["unit", "gear", "spell"], targetless: true }),
  effect("defendHere", "revealTopSpellToHandElseRecycle", { sourceTypes: ["battlefield"], targetless: true }),
  effect("defendHere", "giveShieldHere", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("defendHere", "returnFriendlyUnitHereToBase", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("firstBeginning", "gainPoint", { sourceTypes: ["battlefield"], targetless: true }),
  effect("firstBeginning", "channelRunes", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "draw", { sourceTypes: ["unit", "battlefield"], targetless: true }),
  effect("hold", "gainPoint", { sourceTypes: ["unit", "battlefield"], targetless: true }),
  effect("hold", "channelRunes", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "buffUnitHere", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("hold", "returnChosenChampionToZone", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "playUnitToken", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "winIfFriendlyUnitsAtLeast", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "triggerConquerAbilitiesHere", { sourceTypes: ["battlefield"], targetless: true }),
  effect("keyword", "ambush", { sourceTypes: ["unit"], targetless: true }),
  effect("levelStatic", "gainKeywords", { sourceTypes: ["unit"], targetless: true }),
  effect("onMove", "drawDiscardTypeBonus", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "discardDraw", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "playUnitToken", { sourceTypes: ["unit"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "buffMovedUnit", { sourceTypes: ["battlefield"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "drawWhenOpponentMovesToOtherBattlefield", { sourceTypes: ["unit"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "scoreOnNthMoveEachTurn", { sourceTypes: ["unit"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "readyAnotherExhaustedFirstTimeEachTurn", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "moveWithFriendlyFromSameBattlefield", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" }),
  effect("onPlay", "draw", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "drawPerFriendlyMightyUnit", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "buffUnit", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "buffSelfDrawIfControlTag", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "channelRunes", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "discard", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "dealDamageUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "discardDraw", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "killGear", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("onPlay", "killUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "duelEnemy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "modifyMight", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "nextSpellEnergyReduction", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "optionalPowerDraw", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "playSpellFromTrashMaxEnergy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS }),
  effect("onPlay", "playUnitFromTrash", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "playUnitToken", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "predict", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "readySelf", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "readyUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "returnBattlefieldUnitToHand", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("onPlay", "returnTrashUnitToHand", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "discardOpponentHand", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "returnUnitToBase", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("onPlay", "stunUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "stunOrKillEnemy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "modifySelfMight", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "spendFriendlyBuffBuffSelfReady", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "spendBuffsChannelRunes", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "preventOpponentsPlayCardsThisTurn", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "moveEnemyToThisBattlefield", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "stealEnemyGear", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("onPlay", "swapWithControlledUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("opponentPlaysUnit", "stunAndCantMove", { sourceTypes: ["unit"], targetless: true }),
  effect("replacement", "saveFriendlyUnitByKillingThis", { sourceTypes: ["gear"], targetless: true }),
  effect("replacement", "saveBuffedFriendlyUnitBySett", { sourceTypes: ["legend"], targetless: true }),
  effect("conquer", "readySelf", { sourceTypes: ["legend"], targetless: true }),
  effect("conquer", "drawIfUnitsAtBattlefield", { sourceTypes: ["legend"], targetless: true }),
  effect("conquer", "playSpellFromTrashMaxEnergy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS }),
  effect("score", "gainXp", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "buffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "draw", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "drawOrChannelRunes", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "killGearThenBuffSelf", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("score", "returnSelfToHand", { sourceTypes: ["unit"], targetless: true }),
  effect("secondDrawEachTurn", "modifyMight", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("showdownBeginsHere", "payEnergyPredictDrawSpell", { sourceTypes: ["unit"], targetless: true }),
  effect("spell", "alphaStrike", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALPHA_STRIKE, declaration: SPELL_TARGET_DECLARATIONS.alphaStrike }),
  effect("spell", "chooseTopDeck", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TOP_DECK }),
  effect("spell", "counterSpell", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterSpell }),
  effect("spell", "counterUnlessPayEnergy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterUnlessPayEnergy }),
  effect("spell", "dealDamageUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.dealDamageUnit }),
  effect("spell", "dealDamageAllBattlefieldUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "banishFriendlyUnitPlayToBase", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.banishFriendlyUnitPlayToBase }),
  effect("spell", "duelFriendlyEnemy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.duelFriendlyEnemy }),
  effect("spell", "draw", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "channelRunes", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "channelRunesOrDraw", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "discard", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "discardEnergyDamageUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.discardEnergyDamageUnit }),
  effect("spell", "extraTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "unitsEnterReadyThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "enGarde", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.enGarde }),
  effect("spell", "exhaustFriendlyUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killDamagedUnitsThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killOnNextDamageOrNowIfLegion", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killOnNextDamageOrNowIfLegion }),
  effect("spell", "preventSpellAbilityDamageThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killBattlefieldUnitsTotalMightMax", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killBattlefieldUnitsTotalMightMax }),
  effect("spell", "damageEnemyUnitsAtBattlefieldByReadyRunes", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.damageEnemyUnitsAtBattlefieldByReadyRunes }),
  effect("spell", "returnHiddenTrashToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TOP_DECK, declaration: SPELL_TARGET_DECLARATIONS.returnHiddenTrashToHand }),
  effect("spell", "playOpponentTopDeckCard", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "playTopDeckUnitFromLook", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "gainControlOfSpell", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.gainControlOfSpell }),
  effect("spell", "eachPlayerTopDeckBanishPlay", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "dragonsRage", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.dragonsRage }),
  effect("spell", "divineJudgment", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "giveTemporaryGear", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, declaration: SPELL_TARGET_DECLARATIONS.giveTemporaryGear }),
  effect("spell", "giveTemporaryUnitOrGear", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.giveTemporaryUnitOrGear }),
  effect("spell", "giveKeyword", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.giveKeyword }),
  effect("spell", "doubleMightTemporary", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.doubleMightTemporary }),
  effect("spell", "killAllGear", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killGear", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, declaration: SPELL_TARGET_DECLARATIONS.killGear }),
  effect("spell", "eachPlayerKillGear", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "eachPlayerKillUnit", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "eachOtherPlayerKillUncontrolledUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("spell", "killUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killUnit }),
  effect("spell", "discardHandDraw", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "matchFriendlyMight", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.matchFriendlyMight }),
  effect("spell", "modifyMight", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.modifyMight }),
  effect("spell", "modifyFriendlyUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "spendBuffsReadyThenBuffFriendlyUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "readyUnitAny", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.readyUnitAny }),
  effect("spell", "saveFriendlyUnitThisTurn", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("spell", "playUnitToken", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "playUnitFromTrash", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TOP_DECK, declaration: SPELL_TARGET_DECLARATIONS.playUnitFromTrash }),
  effect("onPlay", "modifyEnemyUnits", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "dealDamageAllBattlefieldUnits", { sourceTypes: ["unit"], targetless: true }),
  effect("spell", "moonfall", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.MOONFALL, declaration: SPELL_TARGET_DECLARATIONS.moonfall }),
  effect("spell", "partyFavors", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "possession", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.possession }),
  effect("spell", "lastBreath", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.lastBreath }),
  effect("spell", "zenithBlade", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.zenithBlade }),
  effect("spell", "showstopper", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.showstopper }),
  effect("spell", "stormbringer", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.stormbringer }),
  effect("spell", "siphonPower", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.siphonPower }),
  effect("spell", "standUnited", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.standUnited }),
  effect("spell", "facebreaker", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.facebreaker }),
  effect("spell", "moveFriendlyAndReady", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveFriendlyAndReady }),
  effect("spell", "moveFriendlyUnitsToBase", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveFriendlyUnitsToBase }),
  effect("spell", "moveUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveUnit }),
  effect("spell", "predict", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "recycleOpponentNonUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.OPPONENT_NON_UNIT_HAND, declaration: SPELL_TARGET_DECLARATIONS.recycleOpponentNonUnit }),
  effect("spell", "returnBattlefieldUnitToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.returnBattlefieldUnitToHand }),
  effect("spell", "eachPlayerReturnUnitToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("spell", "returnTrashUnitToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TOP_DECK, declaration: SPELL_TARGET_DECLARATIONS.returnTrashUnitToHand }),
  effect("spell", "returnUnitToBase", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.returnUnitToBase }),
  effect("spell", "returnFriendlyAndEnemyToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.returnFriendlyAndEnemyToHand }),
  effect("spell", "stunOrReturnAttackingEnemy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.stunOrReturnAttackingEnemy }),
  effect("spell", "stunUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.stunUnit }),
  effect("spellPlayed", "battlefieldBuffUnitHere", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("spellPlayed", "drawIfChoosesFriendlyUnitHereFirstTime", { sourceTypes: ["battlefield"], targetless: true }),
  effect("spellPlayed", "selfBuff", { sourceTypes: ["unit"], targetless: true }),
  effect("stun", "readySelfMight", { sourceTypes: ["unit"], targetless: true }),
  effect("stun", "buffFriendlyUnit", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("enemyKilled", "drawIfStunned", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("static", "attachedMight", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "canEnterEnemyBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "canEnterOpenBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "cannotBeChosenByEnemy", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "cantMoveFromHereToBase", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "costModifier", { sourceTypes: ["unit", "gear", "legend", "spell"], targetless: true }),
  effect("static", "discardAdditionalCostEnergyReduction", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "spendBuffsCostReduction", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "copyFriendlyActivatedAbilities", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "preventDamageAfterSecondMove", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "playFromTopReveal", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "attackingTieRecallsAllUnits", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "killFriendlyUnitsCostReduction", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "enemyAttacksControlledBattlefieldMightReduction", { sourceTypes: ["legend"], targetless: true }),
  effect("static", "exhaustPayReadyBuffedUnit", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "playSelfFromTrashWhenSpellKillsUnit", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "defendAloneMight", { sourceTypes: ["legend"], targetless: true }),
  effect("static", "deflect", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "entersReady", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "enterReadyIfOpponentControlsBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainKeywordsWhileBuffed", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainKeywordsIfDiscardedThisTurn", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainKeywordsWhileMighty", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyHereGainKeywords", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "unitsHereGainKeywords", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "bonusDamageToUnitsHere", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "selfMightByBuffedFriendlyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightByPoints", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightByTrash", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightWhileBuffed", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherBuffedFriendlyHereMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyHereMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "friendlyUnitsCanEnterOpenBattlefields", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "friendlyBuffedUnitsGainKeywords", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("static", "opponentsHiddenCantRevealHere", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "opponentsUnitsOnlyToBase", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyUnitsEnterReady", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightWhileAloneCombat", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "shield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "stunnedEnemyHereMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "unitsHereMight", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "suppressWeakerEnemyCombatDamage", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "victoryScoreModifier", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "additionalHiddenSlots", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "deathTriggersAdditionalTime", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "globalBonusDamage", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "runeThresholdMight", { sourceTypes: ["unit"], targetless: true }),
  effect("discarded", "playSelfFromTrashPayPower", { sourceTypes: ["unit"], targetless: true }),
  effect("conquer", "scoreIfExcessDamage", { sourceTypes: ["unit"], targetless: true }),
  effect("activated", "saveFriendlyUnitThisTurn", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "udyrChooseMode", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
];

export const EFFECT_DEFINITIONS = Object.freeze(Object.fromEntries(
  effectDefinitions.map((definition) => [effectKey(definition), Object.freeze(definition)])
));

export const VALID_EFFECT_PAIRS = Object.freeze(new Set(Object.keys(EFFECT_DEFINITIONS)));

export function effectKey(effect) {
  return `${effect?.timing}:${effect?.kind}`;
}

export function effectDefinition(effect) {
  return EFFECT_DEFINITIONS[effectKey(effect)] || null;
}

export function spellTargetDeclaration(effect) {
  return SPELL_TARGET_DECLARATIONS[effect?.kind] || null;
}

export function effectNeedsPlayDeclaration(effect) {
  return Boolean(effect?.timing === "spell" && spellTargetDeclaration(effect));
}

function effect(timing, kind, options = {}) {
  return {
    timing,
    kind,
    sourceTypes: options.sourceTypes || [],
    targetProvider: options.targetProvider || null,
    targetless: Boolean(options.targetless),
    declaration: options.declaration || null,
    flow: options.flow || null,
    continuation: options.continuation || null
  };
}
