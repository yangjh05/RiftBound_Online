export const EFFECT_TIMINGS = Object.freeze([
  "activated",
  "activatedAbilityUsed",
  "attackOrDefend",
  "attached",
  "battlefieldControl",
  "becomesEmpowered",
  "beginning",
  "buffSpent",
  "chosen",
  "combatStatic",
  "combatEnd",
  "combatWin",
  "conquer",
  "conquerHere",
  "cardPlayed",
  "cardHidden",
  "death",
  "defend",
  "discard",
  "discarded",
  "defendHere",
  "endTurn",
  "mainStart",
  "firstBeginning",
  "friendlyDeath",
  "hold",
  "keyword",
  "levelStatic",
  "onMove",
  "onPlay",
  "attack",
  "becomesMighty",
  "enemyDeath",
  "opponentPlaysUnit",
  "opponentCardPlayed",
  "opponentScore",
  "recycle",
  "runeRecycled",
  "ready",
  "replacement",
  "score",
  "secondDrawEachTurn",
  "mightThreshold",
  "ownedCardBanished",
  "cardOrAbilityPlayed",
  "otherEmpowered",
  "showdownBeginsHere",
  "spell",
  "spellPlayed",
  "stun",
  "unitPlayedHere",
  "unitReturnedToHand",
  "enemyKilled",
  "static"
]);

export const ABILITY_CLASSES = Object.freeze([
  "activated",
  "triggered",
  "passive",
  "replacement",
  "instruction",
  "keyword"
]);

export const ABILITY_ACTIVE_ZONES = Object.freeze([
  "board",
  "chain",
  "mainDeck",
  "trash",
  "playable",
  "rules"
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
  OPPONENTS: "opponents",
  RUNES: "runes",
  EXHAUSTED_NON_SPELL_OBJECTS: "exhaustedNonSpellObjects",
  ALL_PERMANENTS: "allPermanents",
  READYABLE_OBJECTS: "readyableObjects"
});

export const SPELL_TARGET_DECLARATIONS = Object.freeze({
  moveEnemyToSameControllerLocation: {
    steps: [
      { choiceEffect: "moveEnemySameControllerTarget", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy" },
      { choiceEffect: "moveEnemySameControllerDestination", provider: "sameControllerLocations" }
    ]
  },
  returnGearToHand: {
    choiceEffect: "returnGearToHand",
    provider: TARGET_PROVIDERS.ALL_GEAR
  },
  swapMightSameBattlefield: {
    steps: [
      { choiceEffect: "swapMightFirst", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "any" },
      { choiceEffect: "swapMightSecond", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "any", sameLocationAsPrevious: true, excludePreviouslyDeclared: true }
    ]
  },
  killBattlefieldUnitRewardTokens: {
    choiceEffect: "killRewardTarget",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "battlefield"
  },
  killFriendlyBuffAnotherByMight: {
    steps: [
      { choiceEffect: "killFriendlyForMight", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "buffAnotherAfterKill", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", excludePreviouslyDeclared: true }
    ]
  },
  preventNextDamage: {
    choiceEffect: "preventNextDamage",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "any"
  },
  modifyTwoUnitsOpposite: {
    steps: [
      { choiceEffect: "modifyPositiveUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "any" },
      { choiceEffect: "modifyNegativeUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "any", excludePreviouslyDeclared: true }
    ]
  },
  counterSpellBuffFriendlyByEnergy: {
    steps: [
      { choiceEffect: "counterBuffFriendly", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "counterBuffSpell", provider: TARGET_PROVIDERS.CHAIN_SPELLS, defaultScope: "enemySpell" }
    ]
  },
  moveAttachGrantConquerRecall: {
    steps: [
      { choiceEffect: "moveAttachUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "moveAttachDestination", provider: "moveDestinationsForFirst" },
      { choiceEffect: "moveAttachEquipment", provider: "optionalControlledEquipment", optional: true, minTargets: 0 }
    ]
  },
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
    scopeByTarget: {
      friendlyUnit: "friendly",
      friendlyUnitAgainstOrChosenByEnemyDomain: "friendly"
    },
    defaultScope: "any"
  },
  stunUnit: {
    choiceEffect: "stunUnit",
    provider: TARGET_PROVIDERS.TARGETABLE_UNITS,
    scopeByTarget: { unit: "any", attackingUnit: "attacking" },
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
    defaultScope: "spell",
    includeFriendly: true
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
  strikeDown: {
    steps: [
      { choiceEffect: "strikeDownFriendly", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", requiresAttachedEquipment: true },
      { choiceEffect: "strikeDownEnemy", provider: TARGET_PROVIDERS.TARGETABLE_UNITS, defaultScope: "enemy" },
      { choiceEffect: "strikeDownEquipment", provider: TARGET_PROVIDERS.ALL_GEAR, equipmentOnly: true, attachedToFirstDeclared: true }
    ]
  },
  playHandUnitToControlledBattlefieldReduced: {
    steps: [
      { choiceEffect: "playReducedHandUnit", provider: "friendlyHandUnits" },
      { choiceEffect: "playReducedUnitDestination", provider: "controlledBattlefields" }
    ]
  },
  rocketBarrage: {
    steps: [
      { choiceEffect: "rocketBarrageMode", provider: "rocketBarrageModes" },
      { choiceEffect: "rocketBarrageTarget", provider: "rocketBarrageTargets" }
    ]
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
  moveAnyFriendlyUnitsAtBattlefieldToBase: {
    choiceEffect: "returnUnitToBase",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "friendlyBattlefield",
    minTargets: 0,
    multi: true,
    sameBattlefieldAsPrevious: true
  },
  attachOrDetachEquipment: {
    steps: [
      { choiceEffect: "attachOrDetachUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "any" },
      { choiceEffect: "attachOrDetachEquipment", provider: TARGET_PROVIDERS.ALL_GEAR, sameControllerAsPrevious: true, equipmentOnly: true }
    ]
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
  saveFriendlyUnitThisTurn: {
    choiceEffect: "saveFriendlyUnitThisTurn",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
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
      { choiceEffect: "alphaStrikeDamageTarget", provider: "alphaStrikeTargets", multi: true, minTargets: 1, maxTargetsFromSelectedMight: true }
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
      {
        choiceEffect: "zenithBladeEnemy",
        provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
        defaultScope: "enemyBattlefield",
        captureTargetBattlefieldChoiceEffect: "zenithBladeDestination"
      },
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
  dealDamageAllEnemyUnitsAtBattlefield: {
    choiceEffect: "dealDamageAllEnemyUnitsAtBattlefield",
    provider: TARGET_PROVIDERS.BATTLEFIELDS
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
  },
  banishFriendlyUnitOwnerPlayBattlefield: {
    choiceEffect: "unleashedFriendlyUnit",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  boneSkewer: {
    choiceEffect: "unleashedBattlefield",
    provider: TARGET_PROVIDERS.BATTLEFIELDS
  },
  callToBattle: {
    steps: [
      { choiceEffect: "unleashedFriendlyUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "unleashedControlledBattlefield", provider: TARGET_PROVIDERS.BATTLEFIELDS, controlledByPlayer: true },
      { choiceEffect: "unleashedOpponent", provider: TARGET_PROVIDERS.OPPONENTS }
    ]
  },
  counterEnemyEffectChoosingFriendlyOnly: {
    choiceEffect: "unleashedChainItem",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS
  },
  counterSpellAndPreventControllerSpells: {
    choiceEffect: "unleashedChainSpell",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS
  },
  counterSpellOrPlayTokens: {
    steps: [
      { choiceEffect: "unleashedCounterOrTokensMode", provider: "unleashedCounterOrTokensModes" },
      { choiceEffect: "unleashedOptionalChainSpell", provider: TARGET_PROVIDERS.CHAIN_SPELLS, optionalByPreviousMode: "tokens" }
    ]
  },
  counterSpellToHand: {
    choiceEffect: "unleashedChainSpell",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS,
    includeFriendly: true
  },
  crescentStrike: {
    choiceEffect: "unleashedEnemyBattlefieldUnit",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "enemyBattlefield"
  },
  curtainCall: {
    steps: [
      { choiceEffect: "repeatCount", provider: "unleashedCurtainRepeatCost", repeatCostIndex: 0 },
      { choiceEffect: "repeatCount", provider: "unleashedCurtainRepeatCost", repeatCostIndex: 1 },
      { choiceEffect: "repeatCount", provider: "unleashedCurtainRepeatCost", repeatCostIndex: 2 },
      { choiceEffect: "unleashedCurtainModes", provider: "unleashedCurtainModes", multi: true, minTargets: 1, maxTargets: 4 },
      { choiceEffect: "unleashedCurtainTargets", provider: "unleashedCurtainTargetByMode", targetIndex: 0 },
      { choiceEffect: "unleashedCurtainTargets", provider: "unleashedCurtainTargetByMode", targetIndex: 1 },
      { choiceEffect: "unleashedCurtainTargets", provider: "unleashedCurtainTargetByMode", targetIndex: 2 }
    ]
  },
  dancingGrenade: {
    choiceEffect: "unleashedUnit",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  doubleDamageToUnitThisTurn: {
    choiceEffect: "unleashedUnit",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  duelAnyUnits: {
    steps: [
      { choiceEffect: "unleashedFirstUnit", provider: TARGET_PROVIDERS.ALL_UNITS },
      { choiceEffect: "unleashedSecondUnit", provider: TARGET_PROVIDERS.ALL_UNITS, excludePreviouslyDeclared: true }
    ]
  },
  heroicCharge: {
    steps: [
      { choiceEffect: "unleashedFriendlyUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "unleashedEnemySameLocation", provider: TARGET_PROVIDERS.TARGETABLE_UNITS, defaultScope: "enemy", sameLocationAsPrevious: true }
    ]
  },
  isolate: {
    choiceEffect: "unleashedEnemyBattlefieldUnit",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "enemyBattlefield"
  },
  killUnitThenReplaySelfIfWeak: {
    choiceEffect: "unleashedBattlefieldUnit",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "battlefield"
  },
  modifyMightByDistinctTags: {
    choiceEffect: "unleashedUnit",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  moveEnemyGroup: {
    steps: [
      { choiceEffect: "unleashedEnemyGroup", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy", multi: true, minTargets: 1 },
      { choiceEffect: "unleashedMoveDestination", provider: "sameControllerLocations" }
    ]
  },
  moveEnemyThenStunAtLevel: {
    steps: [
      { choiceEffect: "unleashedMoveEnemy", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy" },
      { choiceEffect: "unleashedMoveDestination", provider: "moveDestinationsForFirst" },
      { choiceEffect: "unleashedStunEnemy", provider: TARGET_PROVIDERS.TARGETABLE_UNITS, defaultScope: "enemy", optionalAtLevel: 6 }
    ]
  },
  moveFriendlyThenEnemy: {
    steps: [
      { choiceEffect: "unleashedMoveFriendly", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "unleashedFriendlyDestination", provider: "moveDestinationsForFirst" },
      { choiceEffect: "unleashedMoveEnemy", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy" },
      { choiceEffect: "unleashedEnemyDestination", provider: "moveDestinationsForPrevious" }
    ]
  },
  ownerPutUnitTopOrBottomDeck: {
    choiceEffect: "unleashedEnemyBattlefieldUnit",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "enemyBattlefield"
  },
  playReflectionCopy: {
    choiceEffect: "unleashedUnit",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  playTrashUnitWithinKilledCost: {
    choiceEffect: "unleashedTrashUnit",
    provider: "friendlyTrashUnits"
  },
  stareDown: {
    steps: [
      { choiceEffect: "unleashedFriendlyUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "unleashedBattlefield", provider: TARGET_PROVIDERS.BATTLEFIELDS }
    ]
  },
  swapFriendlyUnitLocations: {
    steps: [
      { choiceEffect: "unleashedFirstFriendlyUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "unleashedSecondFriendlyUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly", excludePreviouslyDeclared: true }
    ]
  },
  readyUnitGiveKeyword: {
    choiceEffect: "readyAndKeyword",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  buffAndUntargetable: {
    choiceEffect: "buffAndUntargetable",
    provider: TARGET_PROVIDERS.ALL_UNITS,
    defaultScope: "friendly"
  },
  moveControlledUnitToControlledBattlefieldBuff: {
    steps: [
      { choiceEffect: "chooseMoveControlledUnit", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "chooseMoveControlledDestination", provider: "controlledBattlefields" }
    ]
  },
  temporaryEmpowerMode: {
    steps: [
      { choiceEffect: "vendettaTemporaryEmpowerMode", provider: "vendettaTemporaryEmpowerModes" },
      { choiceEffect: "vendettaTemporaryEmpowerTarget", provider: TARGET_PROVIDERS.ALL_PERMANENTS, modeChoiceEffect: "vendettaTemporaryEmpowerMode", requiresEmpoweredForMode: "disempower" }
    ]
  },
  returnFriendlyOrWeakenEnemy: {
    steps: [
      { choiceEffect: "vendettaReturnOrWeakenMode", provider: "vendettaReturnOrWeakenModes" },
      { choiceEffect: "vendettaReturnOrWeakenTarget", provider: TARGET_PROVIDERS.ALL_UNITS, modeChoiceEffect: "vendettaReturnOrWeakenMode", friendlyMode: "return", enemyMode: "weaken" }
    ]
  },
  banishUnitReplaySameLocation: {
    choiceEffect: "banishReplay",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "battlefield"
  },
  revealOpponentHandRecycleDomainCard: {
    choiceEffect: "vendettaRevealOpponent",
    provider: TARGET_PROVIDERS.OPPONENTS
  },
  banishWeakElseReturnUnit: {
    choiceEffect: "banishWeakElseReturn",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "battlefield"
  },
  returnEnemyDomainUnitsTotalMight: {
    choiceEffect: "returnEnemyDomainMulti",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "enemyBattlefield",
    requiredDomainFromSpec: true,
    maxTotalMightFromSpec: true,
    multi: true,
    optional: true,
    minTargets: 0
  },
  setBaseMight: {
    choiceEffect: "setBaseMight",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  disempowerThenKillWeak: {
    choiceEffect: "disempowerKillWeak",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  killEnemyDomainUnitOrGear: {
    choiceEffect: "killPermanent",
    provider: TARGET_PROVIDERS.ALL_PERMANENTS,
    defaultScope: "enemy",
    requiredDomainFromSpec: true
  },
  optionalDamageEnemyThenMoveFriendly: {
    steps: [
      { choiceEffect: "optionalDamageThenMove", provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, defaultScope: "enemyBattlefield", optional: true },
      { choiceEffect: "optionalDamageMoveFriendly", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "optionalDamageMoveDestination", provider: "moveDestinationsForPrevious" }
    ]
  },
  doubleMightGrantReadyAbility: {
    choiceEffect: "doubleMightGrantReady",
    provider: TARGET_PROVIDERS.ALL_UNITS
  },
  damageUnitDeathChannel: {
    choiceEffect: "damageDeathChannel",
    provider: TARGET_PROVIDERS.BATTLEFIELD_UNITS,
    defaultScope: "battlefield"
  },
  moveEnemyToFriendlyBattlefieldBuffIfExactlyTwo: {
    steps: [
      { choiceEffect: "chooseEnemyMoveToFriendly", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy" },
      { choiceEffect: "chooseEnemyMoveFriendlyDestination", provider: TARGET_PROVIDERS.BATTLEFIELDS, friendlyOccupied: true }
    ]
  },
  readyPermanentsAndRunes: {
    choiceEffect: "readyObject",
    provider: TARGET_PROVIDERS.READYABLE_OBJECTS,
    multi: true,
    optional: true,
    minTargets: 0,
    maxTargets: 4
  },
  rebuttal: {
    choiceEffect: "rebuttalTarget",
    provider: TARGET_PROVIDERS.CHAIN_SPELLS,
    includeFriendly: true
  },
  killEnemyWeakerThanFriendly: {
    steps: [
      { choiceEffect: "chooseFriendlyForExecution", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "friendly" },
      { choiceEffect: "killExecutionTarget", provider: TARGET_PROVIDERS.ALL_UNITS, defaultScope: "enemy", lessMightThanPrevious: true }
    ]
  }
});

const effectDefinitions = [
  effect("activated", "equip", { sourceTypes: ["gear"] }),
  effect("activated", "empowerSelf", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("activated", "buffUnit", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "dealDamageUnit", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("activated", "draw", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("activated", "giveKeyword", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "modifyMight", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "returnUnitToBase", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("activated", "returnFriendlyPermanentOrHiddenToHand", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "baitedHook", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "killSelf", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("activated", "recycleCardsFromTrashes", { sourceTypes: ["gear"], targetless: true }),
  effect("activated", "nextUnitEnterReady", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("activated", "nextSpellBonusDamage", { sourceTypes: ["gear"], targetless: true }),
  effect("activated", "moveFriendlyUnit", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "returnOwnedTagUnitToHand", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "playUnitToken", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("activated", "playToken", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("activated", "swapWithControlledUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "addEnergy", { sourceTypes: ["legend", "gear", "unit", "rune"], targetless: true, resolvesOnFinalize: true, addsResources: true }),
  effect("activated", "addPower", { sourceTypes: ["legend", "gear", "unit", "rune"], targetless: true, resolvesOnFinalize: true, addsResources: true }),
  effect("activated", "gainPoint", { sourceTypes: ["legend", "gear", "unit"], targetless: true }),
  effect("activated", "moveSelfToBase", { sourceTypes: ["unit"], targetless: true }),
  effect("activated", "grantNextSpellRepeatEqualCost", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("activated", "convertPowerToEnergy", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("activated", "convertEnergyToPower", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("activated", "playUnitsBanishedWithSelf", { sourceTypes: ["gear"], targetless: true }),
  effect("attackOrDefend", "ifEnemyAloneBuffAndXp", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "dealDamageEnemyHere", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "payPowerModifySelfMight", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, triggerCost: { kind: "power" } }),
  effect("attackOrDefend", "playEquipmentFromHandIgnoreCostAttachSelf", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, flow: "choice", continuation: "triggerQueue" }),
  effect("attached", "chooseUnusedMode", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("attached", "payEnergyDraw", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("attackOrDefend", "splitDamageEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "dealDamageAllEnemiesHere", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("attackOrDefend", "killDamagedEnemiesHere", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "modifySelfIfReadyEnemyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "modifyFriendlyAlone", { sourceTypes: ["gear", "unit"], targetless: true }),
  effect("attackOrDefend", "modifyEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "stunEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "playHiddenFromHand", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, triggerCost: { kind: "power", choose: "hiddenCard" } }),
  effect("attackOrDefend", "damageEnemyByHiddenTopDeck", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("attackOrDefend", "runeDeckGambit", { sourceTypes: ["unit"], targetless: true }),
  effect("attackOrDefend", "killSelfMoveAttackerToBase", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true }),
  effect("battlefieldControl", "legendAttachEquipment", { sourceTypes: ["battlefield"], targetless: true }),
  effect("battlefieldControl", "discardReturnSelfFromTrash", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "triggerQueue", optionalTrigger: true, triggerCost: { kind: "discardCard" }, activeZones: ["trash"] }),
  effect("beginning", "drawIfHandSizeAtMost", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("beginning", "burn", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("beginning", "drawIfControlsHidden", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("beginning", "recycleTrash", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("combatStatic", "spellCostModifier", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "anotherUnitBuffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "gearReadySelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "opponentTurnRecruit", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "secondCardMightReadySelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "fromHiddenBuffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "exhaustSelfChannelOnMightyUnit", { sourceTypes: ["legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }),
  effect("cardPlayed", "opponentTurnExhaustSelfPlayToken", { sourceTypes: ["unit", "gear", "legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }),
  effect("cardPlayed", "highPowerCardDraw", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("cardPlayed", "fromHiddenPlayToken", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("chosen", "draw", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("chosen", "payEnergyExhaustDraw", {
    sourceTypes: ["unit", "gear", "legend"],
    targetless: true,
    optionalTrigger: true,
    triggerCost: { kind: "energyAndExhaustSource" }
  }),
  effect("chosen", "payPowerExhaustReady", {
    sourceTypes: ["unit", "gear", "legend"],
    targetless: true,
    optionalTrigger: true,
    triggerCost: { kind: "powerAndExhaustSource" }
  }),
  effect("activatedAbilityUsed", "modifySelfMight", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("buffSpent", "playToken", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("cardPlayed", "highCostSpellBuffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("cardPlayed", "highCostSpellDraw", { sourceTypes: ["legend"], targetless: true }),
  effect("conquerHere", "readyRunesEndTurn", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "discardDraw", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "recycleRunes", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "spendBuffDraw", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true, triggerCost: { kind: "spendFriendlyBuff" } }),
  effect("conquerHere", "recycleTopDeck", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "payEnergyReturnFriendlyPlayUnitToken", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("conquerHere", "payEnergyReadyLegend", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("conquerHere", "millTopDeck", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "drawPerOtherControlledBattlefield", { sourceTypes: ["battlefield"], targetless: true }),
  effect("conquerHere", "payEnergyDrawIfMighty", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("conquerHere", "payEnergyPlayToken", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("conquerHere", "readyGearThenOptionalDetach", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true }),
  effect("death", "drawIfAlone", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "draw", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "channelRunes", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "discardDraw", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "dealDamageAllHere", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "playUnitToken", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "playToken", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "banishSelf", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "opponentGainPointIfCombat", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "playUnitFromTrash", { sourceTypes: ["unit", "gear"], targetless: true, optionalTrigger: true }),
  effect("death", "drawIfMighty", { sourceTypes: ["unit"], targetless: true }),
  effect("defend", "moveSelfToBattlefield", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true }),
  effect("friendlyDeath", "exhaustDrawThenHandToDeck", {
    sourceTypes: ["gear", "unit", "legend"],
    targetless: true,
    optionalTrigger: true,
    triggerCost: { kind: "exhaustSource" }
  }),
  effect("attack", "revealTopBanishPlayRecycleRest", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true }),
  effect("attack", "moveFriendlyTokensHere", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true }),
  effect("becomesMighty", "payPowerReadyUnit", {
    sourceTypes: ["unit", "gear", "legend"],
    targetless: true,
    optionalTrigger: true,
    triggerCost: { kind: "power", whenEffectHasCost: true }
  }),
  effect("becomesMighty", "exhaustChannelRunes", {
    sourceTypes: ["unit", "gear", "legend"],
    targetless: true,
    optionalTrigger: true,
    triggerCost: { kind: "exhaustSource" }
  }),
  effect("runeRecycled", "exhaustPlayToken", { sourceTypes: ["legend", "unit", "gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }),
  effect("enemyDeath", "readySelf", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("death", "gainXp", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "revealOpponentHand", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.OPPONENTS }),
  effect("death", "recycleSelfReadyRunes", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("death", "drawOnFirstOtherFriendlyUnitDeath", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "playRecruitOnOtherFriendlyNonRecruitDeath", { sourceTypes: ["unit"], targetless: true }),
  effect("death", "buffAnotherFriendlyOnBuffedUnitDeath", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("endTurn", "readyRunesIfAtBattlefield", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.RUNES }),
  effect("endTurn", "readyRunes", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.RUNES }),
  effect("endTurn", "playTopDeckUnitIgnoreCost", { sourceTypes: ["gear"], targetless: true }),
  effect("endTurn", "unattachSelfDamage", { sourceTypes: ["gear"], targetless: true }),
  effect("discard", "readySelfMight", { sourceTypes: ["unit"], targetless: true }),
  effect("discarded", "draw", { sourceTypes: ["unit", "gear", "spell"], targetless: true, activeZones: ["trash"] }),
  effect("recycle", "buffFriendlyUnit", { sourceTypes: ["unit", "gear", "legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("defendHere", "revealTopSpellToHandElseRecycle", { sourceTypes: ["battlefield"], targetless: true }),
  effect("defendHere", "giveShieldHere", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("defendHere", "returnFriendlyUnitHereToBase", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, optionalTrigger: true }),
  effect("firstBeginning", "gainPoint", { sourceTypes: ["battlefield"], targetless: true }),
  effect("firstBeginning", "channelRunes", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "draw", { sourceTypes: ["unit", "battlefield"], targetless: true }),
  effect("hold", "gainPoint", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true }),
  effect("hold", "channelRunes", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true }),
  effect("hold", "buffUnitHere", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("hold", "returnChosenChampionToZone", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true }),
  effect("hold", "returnTrashCardToHand", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true, flow: "choice", continuation: "triggerQueue", optionalTrigger: true }),
  effect("hold", "chooseTopDeck", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("hold", "playUnitToken", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true }),
  effect("hold", "playToken", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true }),
  effect("hold", "winIfFriendlyUnitsAtLeast", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "triggerConquerAbilitiesHere", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "exhaustPlayToken", { sourceTypes: ["legend", "unit", "gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }),
  effect("hold", "payPowerGainPoint", { sourceTypes: ["battlefield", "unit", "gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "power" } }),
  effect("hold", "eachPlayerChannelRunes", { sourceTypes: ["battlefield"], targetless: true }),
  effect("hold", "playUnitFromTrash", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue", optionalTrigger: true }),
  effect("keyword", "quickDrawAttach", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("keyword", "weaponmaster", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("keyword", "predict", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("keyword", "huntGainXp", { sourceTypes: ["unit"], targetless: true }),
  effect("levelStatic", "gainKeywords", { sourceTypes: ["unit"], targetless: true }),
  effect("onMove", "drawDiscardTypeBonus", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "draw", { sourceTypes: ["unit", "gear"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "revealTopDrawTypeElseRecycle", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "modifyAnotherFriendly", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "discardDraw", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "playUnitToken", { sourceTypes: ["unit", "gear"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "playToken", { sourceTypes: ["unit"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "buffMovedUnit", { sourceTypes: ["battlefield"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "drawWhenOpponentMovesToOtherBattlefield", { sourceTypes: ["unit"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "scoreOnNthMoveEachTurn", { sourceTypes: ["unit"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onMove", "readyAnotherExhaustedFirstTimeEachTurn", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.EXHAUSTED_NON_SPELL_OBJECTS, flow: "choice", continuation: "afterMove" }),
  effect("onMove", "moveWithFriendlyFromSameBattlefield", {
    sourceTypes: ["unit"],
    targetless: true,
    flow: "choice",
    continuation: "afterMove",
    optionalTrigger: true,
    triggerCost: { kind: "power", whenEffectHasCost: true }
  }),
  effect("onMove", "modifySelfMight", { sourceTypes: ["unit", "gear"], targetless: true, flow: "sync", continuation: "inline" }),
  effect("onPlay", "draw", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "chooseTopDeck", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "giveKeyword", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "healFriendlyUnitsHere", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "drawPerFriendlyMightyUnit", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "buffUnit", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "buffSelfDrawIfControlTag", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "channelRunes", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "discard", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "dealDamageUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "discardDraw", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "killGear", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, optionalTrigger: true }),
  effect("onPlay", "killUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "duelEnemy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "modifyMight", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "nextSpellEnergyReduction", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "optionalPowerDraw", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "playSpellFromTrashMaxEnergy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, optionalTrigger: true }),
  effect("onPlay", "playUnitFromTrash", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "playUnitToken", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "playToken", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("onPlay", "readySelf", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "readyOrExhaustLegend", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "readyUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("onPlay", "returnBattlefieldUnitToHand", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("onPlay", "returnTrashUnitToHand", { sourceTypes: ["unit"], targetProvider: "friendlyTrashUnits" }),
  effect("onPlay", "returnTrashCardToHand", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "discardOpponentHand", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.OPPONENTS }),
  effect("onPlay", "returnUnitToBase", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("onPlay", "stunUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "stunOrKillEnemy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("onPlay", "modifySelfMight", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "buffSelfThenOtherFriendlyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "spendFriendlyBuffBuffSelfReady", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true, triggerCost: { kind: "spendFriendlyBuff" } }),
  effect("onPlay", "spendBuffsChannelRunes", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "preventOpponentsPlayCardsThisTurn", { sourceTypes: ["unit"], targetless: true }),
  effect("onPlay", "moveEnemyToThisBattlefield", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true }),
  effect("onPlay", "stealEnemyGear", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("onPlay", "moveFriendlyUnitsToOpenBattlefield", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "eachPlayerMayPlayTokenAndMatchOpponents", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "killFriendlyGearThenPlayHandGear", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, optionalTrigger: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "chooseDrawOrBuffSelf", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "swapWithControlledUnit", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true }),
  effect("onPlay", "returnFriendlyAndEnemyToHand", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "attachSelfToFriendlyHereIfFromHidden", { sourceTypes: ["gear"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("onPlay", "readyFriendlyUnits", { sourceTypes: ["gear", "unit"], targetless: true }),
  effect("onPlay", "modifyFriendlyUnits", { sourceTypes: ["unit"], targetless: true }),
  effect("opponentPlaysUnit", "stunAndCantMove", { sourceTypes: ["unit"], targetless: true }),
  effect("replacement", "saveFriendlyUnitByKillingThis", { sourceTypes: ["gear"], targetless: true }),
  effect("replacement", "saveBuffedFriendlyUnitBySett", { sourceTypes: ["legend"], targetless: true }),
  effect("conquer", "readySelf", { sourceTypes: ["legend", "unit"], targetless: true }),
  effect("conquer", "drawIfUnitsAtBattlefield", { sourceTypes: ["legend"], targetless: true }),
  effect("conquer", "playSpellFromTrashMaxEnergy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, optionalTrigger: true }),
  effect("conquer", "playToken", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("conquer", "recycleFriendlyUnitPlayTrashMechReduced", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, flow: "choice", continuation: "triggerQueue" }),
  effect("conquer", "buffSelf", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("conquer", "channelRunes", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("conquer", "dealDamageEnemyBaseIfPreviouslyUncontrolled", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS }),
  effect("conquer", "dealExcessDamageEnemy", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, optionalTrigger: true }),
  effect("conquer", "exhaustRevealTopBanishPlayRecycleRest", { sourceTypes: ["legend", "unit", "gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }),
  effect("conquer", "payEnergyReadySelf", { sourceTypes: ["legend", "unit", "gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("conquer", "moveSelfToBase", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "buffSelf", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "draw", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "drawOrChannelRunes", { sourceTypes: ["unit"], targetless: true }),
  effect("score", "killGearThenBuffSelf", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("score", "swapBackReplacedBattlefield", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true }),
  effect("score", "returnSelfToHand", { sourceTypes: ["unit"], targetless: true }),
  effect("secondDrawEachTurn", "modifyMight", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("showdownBeginsHere", "payEnergyPredictDrawSpell", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("spell", "alphaStrike", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALPHA_STRIKE, declaration: SPELL_TARGET_DECLARATIONS.alphaStrike }),
  effect("spell", "attachOrDetachEquipment", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, declaration: SPELL_TARGET_DECLARATIONS.attachOrDetachEquipment }),
  effect("spell", "chooseTopDeck", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TOP_DECK }),
  effect("spell", "counterSpell", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterSpell }),
  effect("spell", "counterUnlessPayEnergy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterUnlessPayEnergy }),
  effect("spell", "dealDamageUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.dealDamageUnit }),
  effect("spell", "rocketBarrage", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.rocketBarrage }),
  effect("spell", "repeatCardEffects", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" }),
  effect("spell", "strikeDown", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.strikeDown }),
  effect("spell", "playHandUnitToControlledBattlefieldReduced", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.playHandUnitToControlledBattlefieldReduced }),
  effect("spell", "drawPerFriendlyMightyUnit", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "moveEnemyToSameControllerLocation", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveEnemyToSameControllerLocation }),
  effect("spell", "returnGearToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, declaration: SPELL_TARGET_DECLARATIONS.returnGearToHand }),
  effect("spell", "swapMightSameBattlefield", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.swapMightSameBattlefield }),
  effect("spell", "returnAllUnitsAndGearToHand", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killBattlefieldUnitRewardTokens", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killBattlefieldUnitRewardTokens }),
  effect("spell", "killFriendlyBuffAnotherByMight", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killFriendlyBuffAnotherByMight }),
  effect("spell", "buffFriendlyUnitsPlayedThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "moveAttachGrantConquerRecall", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveAttachGrantConquerRecall }),
  effect("spell", "revealTopBanishPlayDrawRest", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" }),
  effect("spell", "preventNextDamage", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.preventNextDamage }),
  effect("spell", "modifyTwoUnitsOpposite", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.modifyTwoUnitsOpposite }),
  effect("spell", "banishSelfAfterResolve", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "counterSpellBuffFriendlyByEnergy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterSpellBuffFriendlyByEnergy }),
  effect("spell", "readyFriendlyUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "dealDamageAllBattlefieldUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "dealDamageAllEnemyUnitsAtBattlefield", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELDS, declaration: SPELL_TARGET_DECLARATIONS.dealDamageAllEnemyUnitsAtBattlefield }),
  effect("spell", "banishFriendlyUnitPlayToBase", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.banishFriendlyUnitPlayToBase }),
  effect("spell", "duelFriendlyEnemy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.duelFriendlyEnemy }),
  effect("spell", "draw", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "channelRunes", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "channelRunesOrDraw", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "discardEnergyDamageUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.discardEnergyDamageUnit }),
  effect("spell", "extraTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "unitsEnterReadyThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "enGarde", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.enGarde }),
  effect("spell", "exhaustFriendlyUnits", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killDamagedUnitsThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killOnNextDamageOrNowIfLegion", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killOnNextDamageOrNowIfLegion }),
  effect("spell", "preventSpellAbilityDamageThisTurn", { sourceTypes: ["spell"], targetless: true }),
  effect("spell", "killBattlefieldUnitsTotalMightMax", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killBattlefieldUnitsTotalMightMax }),
  effect("spell", "damageEnemyUnitsAtBattlefieldByReadyRunes", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" }),
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
  effect("spell", "spendBuffsReadyThenBuffFriendlyUnits", {
    sourceTypes: ["spell"],
    targetless: true,
    flow: "choice",
    continuation: "finishSpell"
  }),
  effect("spell", "readyUnitAny", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.readyUnitAny }),
  effect("spell", "saveFriendlyUnitThisTurn", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.saveFriendlyUnitThisTurn }),
  effect("spell", "playUnitToken", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" }),
  effect("spell", "playToken", { sourceTypes: ["spell"], targetless: true }),
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
  effect("spell", "moveAnyFriendlyUnitsAtBattlefieldToBase", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveAnyFriendlyUnitsAtBattlefieldToBase }),
  effect("spell", "moveUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveUnit }),
  effect("spell", "recycleOpponentNonUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.OPPONENT_NON_UNIT_HAND, declaration: SPELL_TARGET_DECLARATIONS.recycleOpponentNonUnit }),
  effect("spell", "returnBattlefieldUnitToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.returnBattlefieldUnitToHand }),
  effect("spell", "eachPlayerReturnUnitToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS }),
  effect("spell", "returnTrashUnitToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TOP_DECK, declaration: SPELL_TARGET_DECLARATIONS.returnTrashUnitToHand }),
  effect("spell", "returnUnitToBase", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.returnUnitToBase }),
  effect("spell", "returnFriendlyAndEnemyToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.returnFriendlyAndEnemyToHand }),
  effect("spell", "stunOrReturnAttackingEnemy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.stunOrReturnAttackingEnemy }),
  effect("spell", "stunUnit", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.stunUnit }),
  effect("spellPlayed", "battlefieldBuffUnitHere", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true }),
  effect("spellPlayed", "drawIfChoosesFriendlyUnitHereFirstTime", { sourceTypes: ["battlefield"], targetless: true }),
  effect("spellPlayed", "selfBuff", { sourceTypes: ["unit"], targetless: true }),
  effect("stun", "readySelfMight", { sourceTypes: ["unit"], targetless: true }),
  effect("stun", "buffFriendlyUnit", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("enemyKilled", "drawIfStunned", { sourceTypes: ["gear", "unit", "legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }),
  effect("static", "attachedMight", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "attachedThisTurnMight", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "doubleAttachedBaseMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainTags", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "doesNotDealCombatDamage", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightPerFriendlyGear", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "doubleMightOneOnOneCombat", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyNonHandUnitsHaveAccelerate", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "opponentsCannotGainPoints", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "copyAttachedUnitText", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "readySelfWhenBuffed", { sourceTypes: ["unit"], targetless: true, abilityClass: "triggered" }),
  effect("static", "modifySelfWhenChosenOrReadied", { sourceTypes: ["unit"], targetless: true, abilityClass: "triggered" }),
  effect("combatWin", "playToken", { sourceTypes: ["unit"], targetless: true }),
  effect("combatWin", "draw", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("combatWin", "gainPoint", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("static", "canEnterEnemyBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "canEnterOpenBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "cannotBeChosenByEnemy", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "cantMoveFromHereToBase", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "unitsCannotMoveToBase", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "costModifier", { sourceTypes: ["unit", "gear", "legend", "spell"], targetless: true, activeZones: ["board", "playable"] }),
  effect("static", "assaultPerEnemyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfTargetSpellCostReduction", { sourceTypes: ["unit", "gear", "legend", "spell"], targetless: true }),
  effect("static", "gainMightKeywordsIfPowerSpent", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "optionalAdditionalCostReduction", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "selfMightWhileAnotherFriendlyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "friendlyTokensEnterReady", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "friendlyEquipmentGrantKeywords", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("static", "goldAdditionalEnergyNearVictory", { sourceTypes: ["legend", "unit", "gear"], targetless: true }),
  effect("static", "cannotScoreHereBeforeTurn", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "repeatCostReduction", { sourceTypes: ["battlefield", "legend", "unit", "gear"], targetless: true }),
  effect("static", "firstFriendlyGearCostReduction", { sourceTypes: ["battlefield", "legend", "unit", "gear"], targetless: true }),
  effect("replacement", "saveLowerMightFriendlyHereByRecall", { sourceTypes: ["unit"], targetless: true }),
  effect("activated", "attachControlledEquipment", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_GEAR }),
  effect("static", "spendBuffsCostReduction", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "copyFriendlyActivatedAbilities", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "preventDamageAfterSecondMove", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "combatDamageAssignmentLast", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "playFromTopReveal", { sourceTypes: ["unit"], targetless: true, activeZones: ["mainDeck"] }),
  effect("static", "attackingTieRecallsAllUnits", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "killFriendlyUnitsCostReduction", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "enemyAttacksControlledBattlefieldMightReduction", { sourceTypes: ["legend"], targetless: true }),
  effect("static", "readyFriendlyUnitMightThisTurn", { sourceTypes: ["gear"], targetless: true }),
  effect("static", "buffFriendlyUnitPayExhaustReady", { sourceTypes: ["gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "powerAndExhaustSource" }, abilityClass: "triggered" }),
  effect("static", "playSelfFromTrashWhenSpellKillsUnit", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, triggerCost: { kind: "power" }, abilityClass: "triggered", activeZones: ["trash"] }),
  effect("static", "defendAloneMight", { sourceTypes: ["legend"], targetless: true }),
  effect("static", "entersReady", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "entersExhausted", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("static", "empoweredMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "empoweredKeywords", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "friendlyEmpoweredMight", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("becomesEmpowered", "effectSpecs", { sourceTypes: ["unit", "gear", "legend"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("static", "hideWithEnergyInsteadOfPower", { sourceTypes: ["legend"], targetless: true }),
  effect("static", "enterReadyIfOpponentControlsBattlefield", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "conditionalEnterReady", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "enterReadyIfOpponentNearVictory", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainKeywordsWhileBuffed", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainKeywords", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "gainKeywordsIfDiscardedThisTurn", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "gainKeywordsWhileMighty", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyUnitsGainKeywords", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "friendlyMatchingUnitsGainKeywords", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "friendlyMatchingCardsGainKeywords", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "otherFriendlyHereGainKeywords", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("static", "holdConquerInterchange", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("static", "unitsHereGainKeywords", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "bonusDamageToUnitsHere", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "selfMightByBuffedFriendlyHere", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightByPoints", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightByTrash", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightWhileBuffed", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherBuffedFriendlyHereMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyHereMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "friendlyMatchingUnitsMight", { sourceTypes: ["unit", "gear", "legend"], targetless: true }),
  effect("static", "friendlyUnitsCanEnterOpenBattlefields", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "friendlyBuffedUnitsGainKeywords", { sourceTypes: ["gear", "unit", "legend"], targetless: true }),
  effect("static", "opponentsHiddenCantRevealHere", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "opponentsUnitsOnlyToBase", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "opponentsCannotReadyByEffects", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "otherFriendlyUnitsEnterReady", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "selfMightWhileAloneCombat", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "stunnedEnemyHereMight", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "unitsHereMight", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "taggedUnitsHereMight", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "unitsCanMoveHereFromAnywhere", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "playDestinationRestriction", { sourceTypes: ["unit", "battlefield"], targetless: true, activeZones: ["playable", "board"] }),
  effect("static", "unitsCannotBePlayedHere", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "suppressWeakerEnemyCombatDamage", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "victoryScoreModifier", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "additionalHiddenSlots", { sourceTypes: ["battlefield"], targetless: true }),
  effect("static", "deathTriggersAdditionalTime", { sourceTypes: ["unit"], targetless: true }),
  effect("static", "globalBonusDamage", { sourceTypes: ["unit", "gear"], targetless: true }),
  effect("static", "runeThresholdMight", { sourceTypes: ["unit"], targetless: true }),
  effect("discarded", "playSelfFromTrashPayPower", { sourceTypes: ["unit"], targetless: true, optionalTrigger: true, triggerCost: { kind: "power" }, activeZones: ["trash"] }),
  effect("conquer", "scoreIfExcessDamage", { sourceTypes: ["unit"], targetless: true }),
  effect("conquer", "payEnergyReturnSelfToHand", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue", optionalTrigger: true, triggerCost: { kind: "energy" } }),
  effect("conquer", "discardDraw", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" }),
  effect("conquer", "playUnitFromTrash", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue", optionalTrigger: true }),
  effect("replacement", "recycleTopBeforeReveal", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "reveal" }),
  effect("activated", "saveFriendlyUnitThisTurn", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "udyrChooseMode", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS }),
  effect("activated", "forgeAttachEquipment", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_GEAR, flow: "choice", continuation: "effectSequence" })
  ,effect("activated", "doubleSelfMight", { sourceTypes: ["unit"], targetless: true })
  ,effect("activated", "giveFriendlyHereKeywords", { sourceTypes: ["unit"], targetless: true })
  ,effect("activated", "modifyNamedTagUnit", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("activated", "moveExhaustedFriendlyToBase", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS })
  ,effect("activated", "moveSelfToWeakerOccupiedEnemyBattlefield", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELDS })
  ,effect("activated", "moveToExhaustedUnitLocation", { sourceTypes: ["gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("activated", "playUnitBanishedWithSelf", { sourceTypes: ["gear"], targetless: true })
  ,effect("activated", "readySelf", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("activated", "predictDrawGainXp", { sourceTypes: ["gear"], targetless: true, flow: "choice", continuation: "effectSequence" })
  ,effect("activated", "readyUnit", { sourceTypes: ["gear", "legend", "unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("activated", "returnFriendlyUnitAndPlayGold", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS })
  ,effect("activated", "stunAttackingEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS })
  ,effect("attack", "defenderKillUnitHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS })
  ,effect("attack", "payEnergyModifyUnitHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true, triggerCost: { kind: "energy" } })
  ,effect("attack", "payEnergyMoveEnemyHereToBase", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, optionalTrigger: true, triggerCost: { kind: "energy" } })
  ,effect("attack", "spendXpDealSelfMight", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, optionalTrigger: true, triggerCost: { kind: "xp" } })
  ,effect("attack", "stunEnemyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS })
  ,effect("attack", "stunEnemyHereIfControlsAllTags", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS })
  ,effect("attackOrDefend", "modifyOtherFriendlyHere", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("beginning", "dealDamageUnitsHere", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("beginning", "killFriendlyUnitHereDraw", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, optionalTrigger: true })
  ,effect("beginning", "playUnitToken", { sourceTypes: ["unit", "gear", "legend", "battlefield"], targetless: true })
  ,effect("beginning", "winIfExactHandAndBattlefieldUnits", { sourceTypes: ["gear"], targetless: true })
  ,effect("cardHidden", "readySelf", { sourceTypes: ["unit"], targetless: true })
  ,effect("cardPlayed", "banishHighCostSpellUntilFour", { sourceTypes: ["legend"], targetless: true, optionalTrigger: true })
  ,effect("cardPlayed", "dealDamageEnemy", { sourceTypes: ["unit", "gear", "legend"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS })
  ,effect("cardPlayed", "exhaustSelfDraw", { sourceTypes: ["gear", "unit", "legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } })
  ,effect("cardPlayed", "modifyMight", { sourceTypes: ["legend", "unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("cardPlayed", "modifySelfMight", { sourceTypes: ["unit"], targetless: true })
  ,effect("cardPlayed", "payEnergyGainXp", { sourceTypes: ["gear", "unit", "legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } })
  ,effect("cardPlayed", "readyRunes", { sourceTypes: ["unit", "gear", "legend"], targetProvider: TARGET_PROVIDERS.RUNES })
  ,effect("cardPlayed", "readySelf", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("combatWin", "gainXp", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("conquer", "buffUnit", { sourceTypes: ["unit", "gear", "legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("conquer", "discardExhaustPlayReflectionCopy", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true, triggerCost: { kind: "discardAndExhaustSource" } })
  ,effect("conquer", "exhaustSelfReadyUnitIfExcess", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } })
  ,effect("conquer", "exhaustSelfReplaceBattlefield", { sourceTypes: ["legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } })
  ,effect("conquer", "modifyMight", { sourceTypes: ["unit", "gear", "legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS })
  ,effect("conquer", "drawIfExcessDamage", { sourceTypes: ["gear"], targetless: true })
  ,effect("conquer", "scoreIfControlsAllTags", { sourceTypes: ["unit"], targetless: true })
  ,effect("conquerHere", "playUnitToken", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("death", "dealDamageUnit", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS })
  ,effect("death", "drawIfNotAlone", { sourceTypes: ["unit"], targetless: true })
  ,effect("death", "playHandUnitToBaseIgnoreEnergy", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" })
  ,effect("death", "predict", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" })
  ,effect("death", "repeatOnPlayEffects", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("enemyDeath", "playToken", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("friendlyDeath", "eachOpponentKillUnit", { sourceTypes: ["gear", "unit", "legend"], targetless: true })
  ,effect("friendlyDeath", "gainXp", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("friendlyDeath", "modifySelfMight", { sourceTypes: ["unit"], targetless: true })
  ,effect("hold", "buffAllUnitsHere", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true })
  ,effect("hold", "delayedAddPower", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true })
  ,effect("hold", "delayedMoveEnemyHere", { sourceTypes: ["unit", "gear", "battlefield"], targetless: true, optionalTrigger: true })
  ,effect("hold", "discardExhaustPlayReflectionCopy", { sourceTypes: ["legend"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true, triggerCost: { kind: "discardAndExhaustSource" } })
  ,effect("hold", "exhaustSelfDraw", { sourceTypes: ["legend", "unit", "gear"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } })
  ,effect("hold", "exhaustSelfReplaceBattlefield", { sourceTypes: ["legend"], targetless: true, optionalTrigger: true, triggerCost: { kind: "exhaustSource" } })
  ,effect("hold", "gainXp", { sourceTypes: ["unit", "gear", "legend", "battlefield"], targetless: true })
  ,effect("hold", "burn", { sourceTypes: ["unit", "gear", "legend", "battlefield"], targetless: true })
  ,effect("hold", "grantNextSpellRepeatEqualBaseCost", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("hold", "nextUnitReadyAndBuff", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("hold", "nonTokenUnitCostIncreaseThisTurn", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("hold", "returnUnitToBase", { sourceTypes: ["battlefield", "unit", "gear"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, optionalTrigger: true })
  ,effect("hold", "scoreIfControlsAllTags", { sourceTypes: ["unit"], targetless: true })
  ,effect("hold", "searchTopUnitThenBuffIfTags", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" })
  ,effect("levelStatic", "entersReady", { sourceTypes: ["unit"], targetless: true })
  ,effect("levelStatic", "modifySelfMight", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("onMove", "addEnergyAndPower", { sourceTypes: ["unit", "gear"], targetless: true, flow: "sync", continuation: "inline" })
  ,effect("onMove", "exhaustSelfStunMovedEnemy", { sourceTypes: ["gear", "unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, flow: "choice", continuation: "afterMove", optionalTrigger: true, triggerCost: { kind: "exhaustSource" } })
  ,effect("onMove", "gainXp", { sourceTypes: ["unit", "gear"], targetless: true, flow: "sync", continuation: "inline" })
  ,effect("onMove", "moveEnemyToThisBattlefield", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, flow: "choice", continuation: "afterMove", optionalTrigger: true })
  ,effect("onMove", "moveWeakerEnemyHereToBattlefield", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, flow: "choice", continuation: "afterMove", optionalTrigger: true })
  ,effect("onMove", "searchTopDeck", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "afterMove" })
  ,effect("onPlay", "banishOpponentHandUntilHold", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.OPPONENTS, flow: "choice", continuation: "triggerQueue" })
  ,effect("onPlay", "banishTrashUnitsWithSelf", { sourceTypes: ["gear"], targetless: true })
  ,effect("onPlay", "dealDamageUpToOneEnemyEachLocation", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, flow: "choice", continuation: "triggerQueue" })
  ,effect("onPlay", "eachPlayerKillUnit", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" })
  ,effect("onPlay", "gainXp", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("onPlay", "burn", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("onPlay", "gainXpPerFriendlyUnit", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("onPlay", "giveOtherFriendlyHereKeywords", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("onPlay", "moveUnit", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, optionalTrigger: true })
  ,effect("onPlay", "opponentPlayUnitToken", { sourceTypes: ["unit", "gear"], targetProvider: TARGET_PROVIDERS.OPPONENTS, flow: "choice", continuation: "triggerQueue" })
  ,effect("onPlay", "playReflectionCopies", { sourceTypes: ["unit", "gear"], targetless: true })
  ,effect("onPlay", "readySelfGainXpIfOpponentNearVictory", { sourceTypes: ["unit"], targetless: true })
  ,effect("onPlay", "returnUnitsToHandByMight", { sourceTypes: ["unit"], targetless: true })
  ,effect("onPlay", "revealHandSpendXpDiscard", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.OPPONENTS, flow: "choice", continuation: "triggerQueue", optionalTrigger: true })
  ,effect("onPlay", "searchTopDeck", { sourceTypes: ["unit", "gear"], targetless: true, flow: "choice", continuation: "triggerQueue" })
  ,effect("onPlay", "searchTopUnitThenBuffIfTags", { sourceTypes: ["unit"], targetless: true, flow: "choice", continuation: "triggerQueue" })
  ,effect("opponentScore", "draw", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("replacement", "addBattlefieldTokenAndEnter", { sourceTypes: ["unit"], targetless: true })
  ,effect("replacement", "additionalTokenCopy", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("replacement", "battlefieldCombatDeathRecall", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("replacement", "chooseTagAsPlayed", { sourceTypes: ["unit", "gear", "legend"], targetless: true, flow: "choice", continuation: "play" })
  ,effect("spell", "banishFriendlyUnitOwnerPlayBattlefield", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.banishFriendlyUnitOwnerPlayBattlefield })
  ,effect("spell", "boneSkewer", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELDS, declaration: SPELL_TARGET_DECLARATIONS.boneSkewer })
  ,effect("spell", "callToBattle", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.callToBattle })
  ,effect("spell", "counterEnemyEffectChoosingFriendlyOnly", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterEnemyEffectChoosingFriendlyOnly })
  ,effect("spell", "counterSpellAndPreventControllerSpells", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterSpellAndPreventControllerSpells })
  ,effect("spell", "counterSpellOrPlayTokens", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterSpellOrPlayTokens })
  ,effect("spell", "counterSpellToHand", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.CHAIN_SPELLS, declaration: SPELL_TARGET_DECLARATIONS.counterSpellToHand })
  ,effect("spell", "crescentStrike", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.crescentStrike })
  ,effect("spell", "curtainCall", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.TARGETABLE_UNITS, declaration: SPELL_TARGET_DECLARATIONS.curtainCall })
  ,effect("spell", "dancingGrenade", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.dancingGrenade })
  ,effect("spell", "discardThenDraw", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" })
  ,effect("spell", "burn", { sourceTypes: ["spell"], targetless: true })
  ,effect("spell", "doubleDamageToUnitThisTurn", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.doubleDamageToUnitThisTurn })
  ,effect("spell", "duelAnyUnits", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.duelAnyUnits })
  ,effect("spell", "heroicCharge", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.FRIENDLY_AND_ENEMY_UNITS, declaration: SPELL_TARGET_DECLARATIONS.heroicCharge })
  ,effect("spell", "isolate", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.isolate })
  ,effect("spell", "killAllUnits", { sourceTypes: ["spell"], targetless: true })
  ,effect("spell", "killUnitThenReplaySelfIfWeak", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.killUnitThenReplaySelfIfWeak })
  ,effect("spell", "modifyMightByDistinctTags", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.modifyMightByDistinctTags })
  ,effect("spell", "moveEnemyGroup", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveEnemyGroup })
  ,effect("spell", "moveEnemyThenStunAtLevel", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveEnemyThenStunAtLevel })
  ,effect("spell", "moveFriendlyThenEnemy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.moveFriendlyThenEnemy })
  ,effect("spell", "ownerPutUnitTopOrBottomDeck", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, declaration: SPELL_TARGET_DECLARATIONS.ownerPutUnitTopOrBottomDeck })
  ,effect("spell", "playReflectionCopy", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.playReflectionCopy })
  ,effect("spell", "playTrashUnitWithinKilledCost", { sourceTypes: ["spell"], targetProvider: "friendlyTrashUnits", declaration: SPELL_TARGET_DECLARATIONS.playTrashUnitWithinKilledCost })
  ,effect("spell", "recycleOpponentTrashOrDraw", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" })
  ,effect("spell", "searchTopDeck", { sourceTypes: ["spell"], targetless: true, flow: "choice", continuation: "finishSpell" })
  ,effect("spell", "stareDown", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.stareDown })
  ,effect("spell", "swapFriendlyUnitLocations", { sourceTypes: ["spell"], targetProvider: TARGET_PROVIDERS.ALL_UNITS, declaration: SPELL_TARGET_DECLARATIONS.swapFriendlyUnitLocations })
  ,effect("spellPlayed", "predictIfHighCost", { sourceTypes: ["battlefield", "unit", "gear", "legend"], targetless: true })
  ,effect("static", "alternatePlayCost", { sourceTypes: ["unit", "spell", "gear"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "ambushToAdditionalCostUnitBattlefield", { sourceTypes: ["unit"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "anyDamageIsLethal", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "canEnterEnemyAloneBattlefield", { sourceTypes: ["unit"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "cannotBeReadied", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "cannotMoveSelfToBase", { sourceTypes: ["unit"], targetless: true })
  ,effect("static", "conquerTriggersAdditionalTime", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "costReductionByDistinctTags", { sourceTypes: ["unit", "spell", "gear"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "defendingAloneUnitsHereMight", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("static", "entersReadyIfBattlefieldDestination", { sourceTypes: ["unit"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "friendlySpellsGainRepeatInShowdown", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "friendlyTokenUnitsGainKeywords", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "friendlyTokenUnitsMight", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "friendlyUnitsCanEnterEnemyAloneBattlefields", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "friendlyUnitsEnterReady", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "friendlyUnitsMight", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "gainMightKeywordsIfXpGainedThisTurn", { sourceTypes: ["unit"], targetless: true })
  ,effect("static", "holdTriggersAdditionalTime", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "killedUnitCostReduction", { sourceTypes: ["unit"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "levelCostTiers", { sourceTypes: ["unit", "spell", "gear"], targetless: true, activeZones: ["playable"] })
  ,effect("static", "opponentMultiMovePowerTaxHere", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "otherFriendlyUnitsMight", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "playSelfFromTrash", { sourceTypes: ["unit", "spell", "gear"], targetless: true, activeZones: ["trash"] })
  ,effect("static", "protectWeakerFriendlyHereFromEnemyChoices", { sourceTypes: ["unit"], targetless: true })
  ,effect("static", "selfMightIfHighCostSpellPlayed", { sourceTypes: ["unit"], targetless: true })
  ,effect("static", "selfMightPerFriendlyTemporaryHere", { sourceTypes: ["unit"], targetless: true })
  ,effect("static", "selfMightWhileAttackingWithAnother", { sourceTypes: ["unit"], targetless: true })
  ,effect("static", "suppressTemporaryTriggersHere", { sourceTypes: ["unit", "gear", "legend"], targetless: true })
  ,effect("static", "temporaryUnitsHereGainKeywords", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("static", "unitsHereGainActivatedAbility", { sourceTypes: ["battlefield"], targetless: true })
  ,effect("stun", "moveSelfToStunnedEnemyBattlefield", { sourceTypes: ["unit"], targetProvider: TARGET_PROVIDERS.BATTLEFIELDS, optionalTrigger: true })
  ,effect("unitPlayedHere", "moveOtherFriendlyHereToBase", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, optionalTrigger: true })
  ,effect("unitPlayedHere", "payEnergyBuffPlayedUnit", { sourceTypes: ["battlefield"], targetProvider: TARGET_PROVIDERS.BATTLEFIELD_UNITS, optionalTrigger: true, triggerCost: { kind: "energy" } })
  ,effect("unitReturnedToHand", "payEnergyChannelRune", { sourceTypes: ["battlefield"], targetless: true, optionalTrigger: true, triggerCost: { kind: "energy" } })
  ,...[
    ["onMove", "burnPlayer", ["unit"]],
    ["static", "ignoreTankHere", ["unit"]],
    ["beginning", "modifySelfIfFewerRunes", ["unit"]],
    ["attack", "payPowerGiveSelfKeyword", ["unit"]],
    ["attack", "banishOwnTrashUnitGiveSelfKeyword", ["unit"]],
    ["spell", "readyUnitGiveKeyword", ["spell"]],
    ["static", "cannotBeCountered", ["spell"]],
    ["onPlay", "dealMarkedDamage", ["unit"]],
    ["static", "friendlyUnitsMightByEmpoweredSource", ["gear", "unit", "legend"]],
    ["attack", "dealDamageAllEnemiesHere", ["unit"]],
    ["attack", "readyAnotherFriendly", ["unit"]],
    ["onMove", "dealDamageAtMovedLocations", ["unit"]],
    ["onPlay", "banishHandTrashBurn", ["unit", "gear"]],
    ["static", "skipDrawPhase", ["unit", "gear", "legend"]],
    ["static", "playCardsFromTrash", ["unit", "gear", "legend"]],
    ["replacement", "banishNonDeckTrashCards", ["unit", "gear", "legend"]],
    ["combatEnd", "drawIfNoDamageThisTurn", ["unit"]],
    ["static", "preventEnemySpellAbilityDamage", ["unit"]],
    ["combatEnd", "empowerSelfIfParticipated", ["unit"]],
    ["spell", "buffAndUntargetable", ["spell"]],
    ["onMove", "revealTopDrawUnitElseTrashBuffSelf", ["unit"]],
    ["spell", "moveControlledUnitToControlledBattlefieldBuff", ["spell"]],
    ["spell", "temporaryEmpowerMode", ["spell"]],
    ["static", "limitStartChannelHere", ["unit"]],
    ["onPlay", "disempowerOrKillEnemyGear", ["unit"]],
    ["attack", "dealDamageEnemyHerePerAttachment", ["unit"]],
    ["cardPlayed", "discountNextCard", ["unit"]],
    ["static", "opponentSpellCostIncreaseByEmpowered", ["gear"]],
    ["conquer", "gainPoint", ["unit", "gear", "legend"]],
    ["becomesEmpowered", "predict", ["unit", "gear", "legend"]],
    ["spell", "returnFriendlyOrWeakenEnemy", ["spell"]],
    ["replacement", "earlyBattlefieldScoreDraw", ["unit", "gear", "legend"]],
    ["static", "friendlySpellCostReduction", ["unit", "gear", "legend"]],
    ["spell", "predict", ["spell"]],
    ["activated", "empowerOtherGear", ["gear"]],
    ["enemyDeath", "channelRunes", ["unit", "gear", "legend"]],
    ["static", "costReductionPerControlledType", ["unit", "spell", "gear"]],
    ["spell", "banishUnitReplaySameLocation", ["spell"]],
    ["mainStart", "killThreeFriendlyPermanentsGainPoint", ["gear"]],
    ["onPlay", "readyAnotherExhausted", ["unit", "gear"]],
    ["cardPlayed", "readyAnotherExhausted", ["unit", "gear", "legend"]],
    ["static", "friendlySpellsAbilitiesCantBeCountered", ["unit", "gear", "legend"]],
    ["replacement", "additionalNegativeMight", ["unit", "gear", "legend"]],
    ["ready", "modifySelfMight", ["unit"]],
    ["static", "assaultPerFriendlyGear", ["unit"]],
    ["attackOrDefend", "matchChosenUnitMightPlus", ["unit"]],
    ["conquer", "killGearUpToSelfMight", ["unit"]],
    ["onPlay", "disempowerFriendlyEmpowerTarget", ["unit", "gear"]],
    ["static", "preventDamageOutsideCombat", ["unit"]],
    ["spell", "revealOpponentHandRecycleDomainCard", ["spell"]],
    ["replacement", "replaceChosenDisableWithBuff", ["unit"]],
    ["ready", "chooseSelfKeyword", ["unit"]],
    ["spell", "lookTopPlayUnitOrGearReducedThenEmpower", ["spell"]],
    ["spell", "eachPlayerKeepChosenUnitKillRest", ["spell"]],
    ["attack", "moveEnemyUnitsHereToBase", ["unit"]],
    ["activated", "modifySelfMight", ["unit", "gear", "legend"]],
    ["mightThreshold", "empowerSelf", ["unit"]],
    ["discarded", "payEnergyModifyFriendly", ["unit", "gear"]],
    ["onMove", "burnBuffSelf", ["unit"]],
    ["static", "costReductionPerSameNameInTrash", ["unit", "spell", "gear"]],
    ["static", "selfMightPerOtherSameNameHere", ["unit"]],
    ["static", "unlimitedDeckCopies", ["unit", "spell", "gear"]],
    ["static", "friendlyFlowCostReduction", ["unit", "gear", "legend"]],
    ["onPlay", "empowerHereUntilEndTurn", ["unit", "gear"]],
    ["onPlay", "banishTrashCardGiveKeyword", ["unit", "gear"]],
    ["opponentCardPlayed", "banishSelfAndPlayedCard", ["unit", "gear", "legend"]],
    ["spell", "returnTrashUnitsToOwnersHands", ["spell"]],
    ["becomesEmpowered", "playTrashUnitToBase", ["unit", "gear", "legend"]],
    ["spell", "banishWeakElseReturnUnit", ["spell"]],
    ["spell", "returnEnemyDomainUnitsTotalMight", ["spell"]],
    ["onPlay", "burnBuffFromBurnedUnit", ["gear", "unit"]],
    ["beginning", "burnBuffFromBurnedUnit", ["gear", "unit", "legend"]],
    ["score", "playUnitToken", ["unit", "gear", "legend"]],
    ["static", "selfMightPerFriendlyTokenUnit", ["unit"]],
    ["becomesEmpowered", "banishEnemyBattlefieldUnit", ["unit", "gear", "legend"]],
    ["onMove", "eachPlayerDiscardOrDraw", ["unit"]],
    ["conquer", "playUnitToken", ["unit", "gear", "legend"]],
    ["activated", "swapWithControlledToken", ["unit"]],
    ["conquer", "grantTrashSpellFlowThisTurn", ["unit", "gear", "legend"]],
    ["becomesEmpowered", "opponentBurnPlayTheirTrashUnit", ["unit", "gear", "legend"]],
    ["spell", "setBaseMight", ["spell"]],
    ["static", "conditionalShield", ["unit"]],
    ["activated", "readySelfMight", ["unit"]],
    ["spell", "disempowerThenKillWeak", ["spell"]],
    ["spell", "killEnemyDomainUnitOrGear", ["spell"]],
    ["onPlay", "nameCard", ["unit", "gear"]],
    ["static", "opponentsCannotPlayNamedCard", ["unit", "gear", "legend"]],
    ["activated", "giveControlRecallSelf", ["gear", "unit"]],
    ["endTurn", "killSelfDamageControlledUnits", ["gear", "unit"]],
    ["onPlay", "payEnergyStunUnit", ["unit", "gear"]],
    ["attack", "payEnergyStunUnit", ["unit"]],
    ["attack", "killWeakerEnemyHere", ["unit"]],
    ["replacement", "copyOtherFriendlyOnAttach", ["gear"]],
    ["activated", "moveShowdownFriendlyToBaseReadyIfEmpowered", ["legend", "unit", "gear"]],
    ["spell", "optionalDamageEnemyThenMoveFriendly", ["spell"]],
    ["spell", "doubleMightGrantReadyAbility", ["spell"]],
    ["ownedCardBanished", "empowerSelf", ["unit", "gear", "legend"]],
    ["activated", "discardThenDraw", ["unit", "gear", "legend"]],
    ["cardOrAbilityPlayed", "exhaustSelfReadyRunes", ["unit", "gear", "legend"]],
    ["spell", "damageUnitDeathChannel", ["spell"]],
    ["spell", "moveEnemyToFriendlyBattlefieldBuffIfExactlyTwo", ["spell"]],
    ["activated", "readyGear", ["unit", "gear", "legend"]],
    ["spell", "readyPermanentsAndRunes", ["spell"]],
    ["otherEmpowered", "empowerSelf", ["unit", "gear", "legend"]],
    ["spell", "rebuttal", ["spell"]],
    ["spell", "killEnemyWeakerThanFriendly", ["spell"]],
    ["cardPlayed", "empowerSelf", ["unit", "gear", "legend"]],
    ["static", "dragonRoostPlayPermission", ["battlefield"]],
    ["static", "ignoreDeflectHere", ["battlefield"]],
    ["combatStatic", "reactionCostIncrease", ["battlefield"]],
    ["static", "firstFriendlyGearAbilityCostReduction", ["battlefield"]],
    ["conquerHere", "payEnergyDraw", ["battlefield"]],
    ["static", "empowerAbilityCostReductionHere", ["battlefield"]],
    ["static", "friendlyTargetSpellCostReductionHere", ["battlefield"]],
    ["static", "selfMightIfStunnedEnemyHere", ["unit"]],
    ["static", "selfMightWhileExactlyOneOtherFriendlyHere", ["gear"]],
    ["static", "cannotBeMovedByEnemy", ["gear"]],
    ["showdownBeginsHere", "addEnergyToAttackerDefender", ["battlefield"]]
  ].map(([timing, kind, sourceTypes]) => {
    const onMoveSync = timing === "onMove" && kind === "revealTopDrawUnitElseTrashBuffSelf";
    const onMoveChoice = timing === "onMove" && !onMoveSync;
    const declaration = timing === "spell" ? SPELL_TARGET_DECLARATIONS[kind] : null;
    const triggerTargetProvider = ({
      "attack:dealDamageEnemyHerePerAttachment": TARGET_PROVIDERS.ALL_UNITS,
      "attack:killWeakerEnemyHere": TARGET_PROVIDERS.ALL_UNITS,
      "attack:payEnergyStunUnit": TARGET_PROVIDERS.ALL_UNITS,
      "attack:readyAnotherFriendly": TARGET_PROVIDERS.ALL_UNITS,
      "attackOrDefend:matchChosenUnitMightPlus": TARGET_PROVIDERS.ALL_UNITS,
      "becomesEmpowered:banishEnemyBattlefieldUnit": TARGET_PROVIDERS.BATTLEFIELD_UNITS,
      "becomesEmpowered:opponentBurnPlayTheirTrashUnit": TARGET_PROVIDERS.OPPONENTS,
      "becomesEmpowered:playTrashUnitToBase": "friendlyTrashUnits",
      "cardOrAbilityPlayed:exhaustSelfReadyRunes": TARGET_PROVIDERS.RUNES,
      "cardPlayed:readyAnotherExhausted": TARGET_PROVIDERS.EXHAUSTED_NON_SPELL_OBJECTS,
      "conquer:grantTrashSpellFlowThisTurn": "friendlyTrashSpells",
      "conquer:killGearUpToSelfMight": TARGET_PROVIDERS.ALL_GEAR,
      "discarded:payEnergyModifyFriendly": TARGET_PROVIDERS.ALL_UNITS,
      "onMove:dealDamageAtMovedLocations": TARGET_PROVIDERS.BATTLEFIELD_UNITS,
      "onPlay:banishTrashCardGiveKeyword": "allTrashCards",
      "onPlay:dealMarkedDamage": TARGET_PROVIDERS.ALL_UNITS,
      "onPlay:disempowerFriendlyEmpowerTarget": TARGET_PROVIDERS.ALL_PERMANENTS,
      "onPlay:disempowerOrKillEnemyGear": TARGET_PROVIDERS.ALL_GEAR,
      "onPlay:empowerHereUntilEndTurn": TARGET_PROVIDERS.ALL_PERMANENTS,
      "onPlay:nameCard": "cardNames",
      "onPlay:payEnergyStunUnit": TARGET_PROVIDERS.ALL_UNITS,
      "onPlay:readyAnotherExhausted": TARGET_PROVIDERS.EXHAUSTED_NON_SPELL_OBJECTS
    })[`${timing}:${kind}`] || null;
    const optionalTrigger = new Set([
      "attack:moveEnemyUnitsHereToBase",
      "attack:payEnergyStunUnit",
      "attack:payPowerGiveSelfKeyword",
      "becomesEmpowered:playTrashUnitToBase",
      "cardPlayed:readyAnotherExhausted",
      "conquer:killGearUpToSelfMight",
      "conquerHere:payEnergyDraw",
      "discarded:payEnergyModifyFriendly",
      "mainStart:killThreeFriendlyPermanentsGainPoint",
      "onMove:burnBuffSelf",
      "onMove:dealDamageAtMovedLocations",
      "onPlay:disempowerFriendlyEmpowerTarget",
      "onPlay:empowerHereUntilEndTurn",
      "onPlay:payEnergyStunUnit",
      "onPlay:readyAnotherExhausted",
      "onPlay:returnBattlefieldUnitToHand",
      "opponentCardPlayed:banishSelfAndPlayedCard"
    ]).has(`${timing}:${kind}`);
    const triggerCost = ({
      "attack:payEnergyStunUnit": { kind: "energy" },
      "attack:payPowerGiveSelfKeyword": { kind: "power" },
      "conquerHere:payEnergyDraw": { kind: "energy" },
      "discarded:payEnergyModifyFriendly": { kind: "energy" },
      "mainStart:killThreeFriendlyPermanentsGainPoint": {
        kind: "killFriendlyPermanents",
        choose: "otherFriendlyUnitOrGear",
        amount: 3
      },
      "onMove:burnBuffSelf": { kind: "burn", amount: 1 },
      "onPlay:disempowerFriendlyEmpowerTarget": {
        kind: "disempowerControlled",
        choose: "controlledEmpoweredPermanent"
      },
      "onPlay:payEnergyStunUnit": { kind: "energy" },
      "opponentCardPlayed:banishSelfAndPlayedCard": { kind: "banishSource" }
    })[`${timing}:${kind}`] || null;
    return effect(timing, kind, {
      sourceTypes,
      ...(declaration
        ? { targetProvider: declaration.provider || declaration.steps?.[0]?.provider, declaration }
        : triggerTargetProvider ? { targetProvider: triggerTargetProvider } : { targetless: true }),
      ...(onMoveSync ? { flow: "sync", continuation: "inline" } : {}),
      ...(onMoveChoice ? { flow: "choice", continuation: "afterMove" } : {}),
      ...(optionalTrigger ? { optionalTrigger: true } : {}),
      ...(triggerCost ? { triggerCost } : {}),
      ...(timing === "cardOrAbilityPlayed" && kind === "exhaustSelfReadyRunes"
        ? { optionalTrigger: true, triggerCost: { kind: "exhaustSource" } }
        : {}),
      ...(timing === "attack" && kind === "banishOwnTrashUnitGiveSelfKeyword"
        ? { optionalTrigger: true, flow: "choice", continuation: "triggerQueue" }
        : {})
    });
  })
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
  const declaration = SPELL_TARGET_DECLARATIONS[effect?.kind] || null;
  if (!declaration || !effect?.selectRepeatedTargetsOnPlay || (effect.repeat || 1) < 2) return declaration;
  // Errata'd multi-instruction spells choose every target before the Chain
  // response window opens, while still using the shared target declaration.
  return {
    ...declaration,
    multi: true,
    minTargets: effect.minTargets ?? effect.repeat,
    maxTargets: effect.maxTargets ?? effect.repeat,
    allowRepeatedTargets: Boolean(effect.allowRepeatedTargets)
  };
}

export function effectNeedsPlayDeclaration(effect) {
  return Boolean(effect?.timing === "spell" && spellTargetDeclaration(effect));
}

function effect(timing, kind, options = {}) {
  const abilityClass = options.abilityClass || defaultAbilityClass(timing);
  const activeZones = options.activeZones || defaultActiveZones(abilityClass);
  return {
    timing,
    kind,
    abilityClass,
    activeZones: Object.freeze([...activeZones]),
    sourceTypes: options.sourceTypes || [],
    targetProvider: options.targetProvider || null,
    targetless: Boolean(options.targetless),
    declaration: options.declaration || null,
    flow: options.flow || null,
    continuation: options.continuation || null,
    optionalTrigger: Boolean(options.optionalTrigger),
    triggerCost: options.triggerCost ? Object.freeze(structuredClone(options.triggerCost)) : null,
    resolvesOnFinalize: Boolean(options.resolvesOnFinalize),
    addsResources: Boolean(options.addsResources)
  };
}

function defaultAbilityClass(timing) {
  if (timing === "activated") return "activated";
  if (timing === "replacement") return "replacement";
  if (timing === "spell") return "instruction";
  if (timing === "keyword") return "keyword";
  if (["static", "combatStatic", "levelStatic"].includes(timing)) return "passive";
  return "triggered";
}

function defaultActiveZones(abilityClass) {
  if (abilityClass === "instruction") return ["chain"];
  if (abilityClass === "keyword") return ["rules"];
  return ["board"];
}
