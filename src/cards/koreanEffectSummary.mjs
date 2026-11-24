const TIMING_KO = Object.freeze({
  activated: "활성화 능력",
  activatedAbilityUsed: "도구의 활성화 능력을 사용하면",
  attached: "장착물을 부착하면",
  attack: "공격하면",
  attackOrDefend: "공격 또는 방어 시",
  beginning: "시작 단계에",
  battlefieldControl: "이 전장을 조종하는 동안",
  becomesMighty: "유닛이 [위력적]이 되면",
  buffSpent: "버프를 소모하면",
  cardPlayed: "카드를 사용하면",
  cardHidden: "카드가 숨겨지면",
  chosen: "주문이나 스킬로 선택하면",
  combatStatic: "전투 중 지속 효과",
  combatWin: "전투에서 승리하면",
  conquer: "정복하면",
  conquerHere: "이곳을 정복하면",
  death: "죽음의 종소리",
  defend: "방어하면",
  defendHere: "이곳에서 방어하면",
  enemyDeath: "적 유닛이 죽으면",
  friendlyDeath: "아군 유닛이 죽으면",
  hold: "점거하면",
  onMove: "이동하면",
  onPlay: "사용하면",
  replacement: "대체 효과",
  runeRecycled: "룬을 재활용하면",
  spell: "주문 효과",
  spellPlayed: "주문을 사용하면",
  stun: "기절하면",
  unitPlayedHere: "이곳에 유닛을 사용하면",
  unitReturnedToHand: "유닛이 손으로 돌아가면",
  static: "지속 효과"
});

const KIND_KO = Object.freeze({
  addBattlefieldTokenAndEnter: "전장에 토큰을 추가하고 그 전장에 진입합니다",
  addEnergy: "에너지 [추가]",
  addEnergyAndPower: "에너지와 힘 [추가]",
  additionalTokenCopy: "만드는 토큰을 하나 더 복사합니다",
  alphaStrike: "아군 유닛 하나가 자신의 위력만큼 피해를 나누어 입힙니다",
  alternatePlayCost: "조건을 만족하면 대체 비용으로 사용할 수 있습니다",
  ambushToAdditionalCostUnitBattlefield: "추가 비용으로 처치한 유닛의 전장에 기습할 수 있습니다",
  anyDamageIsLethal: "피해를 받은 유닛은 그 피해량과 관계없이 죽습니다",
  banishFriendlyUnitOwnerPlayBattlefield: "아군 유닛을 추방하고 소유자가 전장에 다시 사용합니다",
  banishHighCostSpellUntilFour: "비용이 높은 주문을 선택해 추방하고, 네 장이 모이면 폐기장으로 보낸 뒤 룬을 전개하고 카드를 뽑습니다",
  banishOpponentHandUntilHold: "상대가 손을 공개하면 카드 한 장을 추방하고, 그 상대가 점거할 때 손으로 되돌립니다",
  banishTrashUnitsWithSelf: "폐기장의 유닛을 자신과 함께 추방합니다",
  battlefieldBuffUnitHere: "이곳의 유닛 하나에게 버프를 부여합니다",
  battlefieldCombatDeathRecall: "이곳에서 전투 중 죽을 유닛을 회복시키고 탈진시켜 대신 귀환시킬 수 있습니다",
  boneSkewer: "상대가 손의 유닛 하나를 비용 없이 지정 전장에 사용하게 한 뒤 그 유닛을 기절시킵니다",
  buffAllUnitsHere: "이곳의 모든 아군 유닛에게 버프를 부여합니다",
  callToBattle: "아군 유닛 하나를 자신이 조종하는 전장으로 이동시킨 뒤, 상대가 자신의 유닛 하나를 그 전장으로 이동시킵니다",
  canEnterEnemyAloneBattlefield: "적 유닛이 홀로 있는 전장에도 진입할 수 있습니다",
  cannotBeReadied: "준비 상태가 될 수 없습니다",
  cannotMoveSelfToBase: "기지로 이동할 수 없습니다",
  chooseTag: "태그 하나를 선택합니다",
  chooseTagAsPlayed: "사용하면서 태그 하나를 선택해 획득합니다",
  conquerTriggersAdditionalTime: "정복 시 효과가 한 번 더 적용됩니다",
  costReductionByDistinctTags: "서로 다른 지정 태그 수만큼 비용을 줄입니다",
  counterEnemyEffectChoosingFriendlyOnly: "아군만 선택한 적 주문이나 스킬을 차단합니다",
  counterSpellAndPreventControllerSpells: "주문을 차단하고 그 조종자의 추가 주문 사용을 막습니다",
  counterSpellOrPlayTokens: "주문을 차단하거나 토큰들을 만듭니다",
  counterSpellToHand: "주문을 차단해 소유자의 손으로 돌려보냅니다",
  crescentStrike: "전장의 적 유닛 하나에게 4의 피해를 주고, 그 전장의 다른 모든 적 유닛에게 1의 피해를 줍니다",
  curtainCall: "지불한 서로 다른 반복 비용 수만큼, 카드 뽑기·전장 피해·기지 피해·전장 위력 감소 중 아직 고르지 않은 효과를 선택합니다",
  dancingGrenade: "유닛에게 피해를 주며, 그 조종자가 힘을 지불해 주문을 다시 사용할 때마다 피해가 증가합니다",
  dealDamageEnemy: "적 유닛에게 피해를 입힙니다",
  dealDamageUnitsHere: "이곳의 유닛에게 피해를 입힙니다",
  dealDamageUpToOneEnemyEachLocation: "각 장소에서 적 유닛을 최대 하나씩 선택해 피해를 입힙니다",
  defenderKillUnitHere: "방어자가 이곳의 유닛을 처치합니다",
  defendingAloneUnitsHereMight: "이곳에서 홀로 방어 중인 유닛의 위력을 변경합니다",
  delayedAddPower: "다음 행동 단계에 힘 [추가]",
  delayedMoveEnemyHere: "다음 행동 단계에 이곳의 적 유닛을 이동시킵니다",
  discard: "카드를 버립니다",
  discardExhaustPlayReflectionCopy: "카드 1장을 버리고 자신을 탈진시켜 준비 상태의 분신 유닛 토큰을 만듭니다",
  discardThenDraw: "카드를 버린 뒤 카드를 뽑습니다",
  doubleDamageToUnitThisTurn: "이번 턴 해당 유닛이 받는 피해를 두 배로 만듭니다",
  doubleSelfMight: "자신의 위력을 두 배로 만듭니다",
  drawDiscardTypeBonus: "카드를 뽑고 버린 카드 유형에 따라 추가 효과를 적용합니다",
  drawIfNotAlone: "혼자가 아니었다면 카드를 뽑습니다",
  drawIfExcessDamage: "정복할 때 초과 피해 조건을 만족했다면 카드를 뽑습니다",
  duelAnyUnits: "두 유닛이 서로 위력만큼 피해를 입힙니다",
  eachOpponentKillUnit: "각 상대가 자신의 유닛 하나를 처치합니다",
  eachPlayerKillUnit: "각 플레이어가 자신의 유닛 하나를 처치합니다",
  entersExhausted: "탈진 상태로 진입합니다",
  entersReadyIfBattlefieldDestination: "전장에 사용했다면 준비 상태로 진입합니다",
  exhaustSelfDraw: "자신을 탈진시키고 카드를 뽑습니다",
  exhaustSelfReadyUnitIfExcess: "자신을 탈진시키고 조건을 만족한 유닛을 준비시킵니다",
  exhaustSelfReplaceBattlefield: "자신을 탈진시키고 전장을 교체합니다",
  exhaustSelfStunMovedEnemy: "자신을 탈진시키고 이동한 적을 기절시킵니다",
  friendlySpellsGainRepeatInShowdown: "결전 중 아군 주문들이 반복을 획득합니다",
  friendlyTokenUnitsGainKeywords: "아군 토큰 유닛이 키워드를 획득합니다",
  friendlyTokenUnitsMight: "아군 토큰 유닛의 위력을 변경합니다",
  friendlyUnitsCanEnterEnemyAloneBattlefields: "아군 유닛이 적이 홀로 있는 전장에 진입할 수 있습니다",
  friendlyUnitsEnterReady: "아군 유닛이 준비 상태로 진입합니다",
  friendlyUnitsMight: "아군 유닛의 위력을 변경합니다",
  gainMightKeywordsIfXpGainedThisTurn: "이번 턴 XP를 얻었다면 위력과 키워드를 획득합니다",
  gainXp: "XP를 획득합니다",
  gainXpPerFriendlyUnit: "아군 유닛 수만큼 XP를 획득합니다",
  giveFriendlyHereKeywords: "이곳의 아군 유닛에게 키워드를 부여합니다",
  giveOtherFriendlyHereKeywords: "이곳의 다른 아군 유닛에게 키워드를 부여합니다",
  giveTemporaryGear: "도구 하나에 일시적을 부여합니다",
  giveTemporaryUnitOrGear: "유닛이나 도구 하나에 일시적을 부여합니다",
  grantNextSpellRepeatEqualBaseCost: "다음 주문에 기본 비용과 같은 반복 비용을 부여합니다",
  heroicCharge: "아군 유닛을 이동시키고 전투 보너스를 부여합니다",
  holdTriggersAdditionalTime: "점거 시 효과가 한 번 더 적용됩니다",
  holdConquerInterchange: "자신의 점거 효과를 정복 효과로도, 정복 효과를 점거 효과로도 적용합니다",
  ifEnemyAloneBuffAndXp: "적이 홀로 있다면 위력을 높이고 XP를 획득합니다",
  isolate: "전장의 적 유닛 하나를 기지로 이동시킨 뒤, 그 전장에 적 유닛 하나만 남으면 카드를 뽑습니다",
  killAllUnits: "모든 유닛을 처치합니다",
  killFriendlyUnitHereDraw: "이곳의 아군 유닛을 처치하고 카드를 뽑습니다",
  killUnitThenReplaySelfIfWeak: "유닛을 처치하고 조건을 만족하면 자신을 다시 사용합니다",
  killedUnitCostReduction: "추가 비용으로 처치한 유닛의 비용만큼 사용 비용을 줄입니다",
  levelCostTiers: "XP 레벨에 따라 사용 비용을 단계적으로 줄입니다",
  modifyMightByDistinctTags: "서로 다른 지정 태그 수에 따라 위력을 변경합니다",
  modifyNamedTagUnit: "선택한 태그의 유닛 위력을 변경합니다",
  modifyOtherFriendlyHere: "이곳의 다른 아군 유닛 위력을 변경합니다",
  moonfall: "전장을 선택하고 그곳의 유닛을 이동시킵니다",
  moveEnemyGroup: "같은 장소의 적 유닛 무리를 이동시킵니다",
  moveEnemyThenStunAtLevel: "적 유닛을 이동시키고 레벨 조건을 만족하면 기절시킵니다",
  moveEnemyToThisBattlefield: "적 유닛을 이 전장으로 이동시킵니다",
  moveExhaustedFriendlyToBase: "탈진한 아군 유닛을 기지로 이동시킵니다",
  moveFriendlyThenEnemy: "아군 유닛을 이동시킨 뒤 적 유닛을 이동시킵니다",
  moveOtherFriendlyHereToBase: "이곳의 다른 아군 유닛을 기지로 이동시킵니다",
  moveSelfToStunnedEnemyBattlefield: "기절한 적이 있는 전장으로 이동합니다",
  moveSelfToWeakerOccupiedEnemyBattlefield: "더 약한 적이 있는 전장으로 이동합니다",
  moveToExhaustedUnitLocation: "비용으로 탈진시킨 아군 유닛의 장소로 서로 다른 아군 유닛을 이동시킵니다",
  moveUnit: "유닛을 이동시킵니다",
  moveWeakerEnemyHereToBattlefield: "이곳의 더 약한 적을 다른 전장으로 이동시킵니다",
  nextUnitReadyAndBuff: "다음 아군 유닛이 준비 상태로 진입하고 버프를 받습니다",
  nonTokenUnitCostIncreaseThisTurn: "이번 턴 비토큰 유닛의 비용을 늘립니다",
  opponentMultiMovePowerTaxHere: "상대가 여러 유닛을 이곳으로 이동시키면 추가 힘을 요구합니다",
  opponentPlayUnitToken: "상대가 유닛 토큰을 만듭니다",
  otherFriendlyHereGainKeywords: "이곳의 다른 아군 유닛이 키워드를 획득합니다",
  otherFriendlyUnitsMight: "다른 아군 유닛의 위력을 변경합니다",
  ownerPutUnitTopOrBottomDeck: "소유자가 유닛을 주 덱 위나 아래에 놓습니다",
  payEnergyBuffPlayedUnit: "에너지를 지불해 사용된 유닛을 버프합니다",
  payEnergyChannelRune: "에너지를 지불해 룬을 전개합니다",
  payEnergyGainXp: "에너지를 지불해 XP를 획득합니다",
  payEnergyModifyUnitHere: "에너지를 지불해 이곳의 유닛 위력을 변경합니다",
  payEnergyMoveEnemyHereToBase: "에너지를 지불해 이곳의 적을 기지로 보냅니다",
  payEnergyPredictDrawSpell: "에너지를 지불해 예측하고 주문을 뽑습니다",
  playHandUnitToBaseIgnoreEnergy: "손의 유닛을 에너지 비용 없이 기지에 사용합니다",
  playReflectionCopies: "준비 상태의 분신 유닛 토큰들을 만듭니다",
  playReflectionCopy: "준비 상태의 분신 유닛 토큰 하나를 만들어 선택한 유닛의 복사본으로 만듭니다",
  playSelfFromTrash: "폐기장에서 대체 비용으로 자신을 사용할 수 있습니다",
  playTrashUnitWithinKilledCost: "처치한 유닛의 비용 이내인 폐기장 유닛을 사용합니다",
  playUnitBanishedWithSelf: "자신과 함께 추방된 유닛을 사용합니다",
  predict: "주 덱 위 카드를 예측합니다",
  predictDrawGainXp: "예측한 뒤 카드를 뽑고 XP를 획득합니다",
  predictIfHighCost: "비용이 높은 카드를 사용했다면 예측합니다",
  protectWeakerFriendlyHereFromEnemyChoices: "상대가 이곳의 더 약한 아군을 선택하지 못하게 보호합니다",
  readyRunes: "룬들을 준비시킵니다",
  readySelfGainXpIfOpponentNearVictory: "상대가 승리에 가까우면 자신을 준비시키고 XP를 획득합니다",
  readyUnitAny: "유닛 하나를 준비시킵니다",
  recycleOpponentTrashOrDraw: "상대 폐기장의 카드를 재활용하거나 대신 카드를 뽑습니다",
  repeatOnPlayEffects: "사용 효과를 다시 적용합니다",
  returnFriendlyUnitAndPlayGold: "아군 유닛을 손으로 되돌리고 골드를 만듭니다",
  returnTrashUnitToHand: "폐기장의 유닛을 손으로 되돌립니다",
  returnUnitsToHandByMight: "지정 위력 이하의 유닛을 손으로 되돌립니다",
  revealHandSpendXpDiscard: "상대 손을 공개하고 XP를 써서 카드를 버리게 합니다",
  revealOpponentHand: "상대 손을 공개합니다",
  saveFriendlyUnitThisTurn: "이번 턴 아군 유닛이 다음에 죽는 대신 회복시키고 탈진시켜 귀환시킵니다",
  scoreIfControlsAllTags: "지정 태그들을 모두 조종하면 득점합니다",
  searchTopDeck: "주 덱 위 카드들을 확인해 조건에 맞는 카드 한 장을 공개하여 뽑고 나머지를 재활용합니다",
  searchTopUnitThenBuffIfTags: "주 덱 위에서 유닛 한 장을 공개하여 뽑고 나머지를 재활용한 뒤, 태그가 맞으면 아군을 버프합니다",
  selfBuff: "자신에게 버프를 부여합니다",
  selfMightIfHighCostSpellPlayed: "이번 턴 높은 비용 주문을 사용했다면 위력을 높입니다",
  selfMightPerFriendlyTemporaryHere: "이곳의 아군 일시적 유닛 수만큼 위력을 높입니다",
  selfMightWhileAttackingWithAnother: "다른 아군과 함께 공격하는 동안 위력을 높입니다",
  spendXpDealSelfMight: "XP를 써서 자신의 위력만큼 피해를 입힙니다",
  stareDown: "아군 유닛과 전장을 선택해 그 유닛보다 위력이 낮은 모든 적 유닛을 기지로 이동시키고 XP를 획득합니다",
  stunAndCantMove: "유닛을 기절시키고 이동할 수 없게 합니다",
  stunAttackingEnemyHere: "이곳의 공격 중인 적을 기절시킵니다",
  stunEnemyHere: "이곳의 적을 기절시킵니다",
  stunEnemyHereIfControlsAllTags: "지정 태그들을 모두 조종하면 이곳의 적을 기절시킵니다",
  stunOrReturnAttackingEnemy: "공격 중인 적을 기절시키거나 손으로 되돌립니다",
  suppressTemporaryTriggersHere: "이곳의 일시적 유닛 효과가 발생하지 못하게 합니다",
  suppressWeakerEnemyCombatDamage: "더 약한 적 유닛의 전투 피해를 막습니다",
  swapFriendlyUnitLocations: "서로 다른 장소의 두 아군 유닛을 상대 유닛의 장소로 각각 이동시켜 위치를 맞바꿉니다",
  temporaryUnitsHereGainKeywords: "이곳의 일시적 유닛이 키워드를 획득합니다",
  unitsHereGainActivatedAbility: "이곳의 유닛에게 활성화 능력을 부여합니다",
  unattachSelfDamage: "이번 턴에 정복하지 못했다면 자신을 분리하고 부착되어 있던 유닛에게 피해를 입힙니다",
  winIfExactHandAndBattlefieldUnits: "손과 전장의 유닛 수가 정확히 조건과 같으면 승리합니다",
  addPower: "힘 [추가]",
  assaultPerEnemyHere: "이곳의 적 유닛 수만큼 맹공을 획득합니다",
  attachControlledEquipment: "자신이 조종하는 장착물을 아군 유닛에 부착합니다",
  attachOrDetachEquipment: "같은 조종자의 유닛과 장착물을 선택해 부착하거나 분리합니다",
  attachSelfToFriendlyHereIfFromHidden: "뒷면에서 사용했다면 이곳의 아군 유닛에 자신을 부착합니다",
  attachedMight: "부착된 유닛의 위력을 높입니다",
  attachedThisTurnMight: "이번 턴에 부착됐다면 추가 위력을 획득합니다",
  banishFriendlyUnitPlayToBase: "아군 유닛을 추방한 뒤 비용을 무시하고 기지에 다시 사용합니다",
  banishSelf: "자신을 추방합니다",
  banishSelfAfterResolve: "해결 후 이 카드를 추방합니다",
  buffFriendlyUnitsPlayedThisTurn: "이번 턴에 사용된 아군 유닛에게 버프를 부여합니다",
  buffSelf: "자신에게 버프를 부여합니다",
  buffUnit: "유닛에게 버프를 부여합니다",
  canEnterEnemyBattlefield: "적이 점유한 전장에도 사용할 수 있습니다",
  cannotBeChosenByEnemy: "적 주문과 스킬의 대상으로 선택될 수 없습니다",
  cannotScoreHereBeforeTurn: "지정된 턴 전에는 이곳에서 득점할 수 없습니다",
  channelRunes: "룬을 전개합니다",
  chooseDrawOrBuffSelf: "카드를 뽑거나 자신에게 버프를 부여합니다",
  chooseTopDeck: "주 덱 위 카드들을 확인해 조건에 맞는 카드 한 장을 공개하여 뽑고 나머지를 재활용할 수 있습니다",
  chooseUnusedMode: "이번 턴에 아직 선택하지 않은 부착 보너스 하나를 선택합니다",
  combatDamageAssignmentLast: "전투 피해를 마지막에 배정받습니다",
  conditionalEnterReady: "조건을 만족하면 준비 상태로 진입합니다",
  convertEnergyToPower: "에너지를 같은 양의 힘으로 바꿉니다",
  convertPowerToEnergy: "힘을 같은 양의 에너지로 바꿉니다",
  copyAttachedUnitText: "부착된 유닛의 규칙 문구를 장착물 효과로 복사합니다",
  costModifier: "조건에 따라 사용 비용을 변경합니다",
  counterSpell: "주문이나 스킬을 차단합니다",
  counterSpellBuffFriendlyByEnergy: "주문을 차단하고 그 에너지 비용만큼 아군 유닛의 위력을 높입니다",
  counterUnlessPayEnergy: "조종자가 에너지를 지불하지 않으면 주문을 차단합니다",
  dealDamageAllEnemiesHere: "이곳의 모든 적 유닛에게 피해를 입힙니다",
  dealDamageEnemyBaseIfPreviouslyUncontrolled: "원래 미점령이던 전장을 정복했다면 기지의 적 유닛에게 자신의 위력만큼 피해를 입힙니다",
  dealDamageEnemyHere: "이곳의 적 유닛에게 피해를 입힙니다",
  dealDamageUnit: "유닛에게 피해를 입힙니다",
  dealExcessDamageEnemy: "공격의 초과 피해만큼 적 유닛에게 피해를 입힙니다",
  discardDraw: "카드를 버린 뒤 카드를 뽑습니다",
  doesNotDealCombatDamage: "전투 피해를 입히지 않습니다",
  doubleAttachedBaseMight: "부착된 장착물의 기본 위력 보너스를 두 배로 적용합니다",
  doubleMightOneOnOneCombat: "일대일 전투에서 자신의 위력을 두 배로 만듭니다",
  draw: "카드를 뽑습니다",
  drawIfAlone: "혼자 죽었다면 카드를 뽑습니다",
  drawIfMighty: "[위력적]인 상태로 죽었다면 카드를 뽑습니다",
  drawPerFriendlyMightyUnit: "아군 [위력적] 유닛 수만큼 카드를 뽑습니다",
  drawPerOtherControlledBattlefield: "자신이나 아군이 조종하는 다른 전장 수만큼 카드를 뽑습니다",
  duelFriendlyEnemy: "아군 유닛과 적 유닛이 서로 위력만큼 피해를 입힙니다",
  eachPlayerChannelRunes: "각 플레이어가 룬을 전개합니다",
  eachPlayerMayPlayTokenAndMatchOpponents: "각 플레이어가 토큰을 만들 수 있고, 참여한 상대 수만큼 자신도 추가 토큰을 만듭니다",
  entersReady: "준비 상태로 진입합니다",
  equip: "비용을 지불해 자신을 아군 유닛에 부착합니다",
  exhaustChannelRunes: "자신을 탈진시키고 룬을 전개합니다",
  exhaustDrawThenHandToDeck: "자신을 탈진시키고 카드를 뽑은 뒤 손의 카드 한 장을 주 덱 위나 아래에 놓습니다",
  exhaustPlayToken: "자신을 탈진시키고 토큰을 만듭니다",
  exhaustRevealTopBanishPlayRecycleRest: "자신을 탈진시키고 덱 위 카드를 공개해 하나를 추방 후 사용하고 나머지는 재활용합니다",
  firstFriendlyGearCostReduction: "매 턴 첫 아군 비토큰 도구의 에너지 비용을 줄입니다",
  friendlyEquipmentGrantKeywords: "아군 장착물이 부착된 유닛에게 키워드를 부여합니다",
  friendlyMatchingCardsGainKeywords: "조건에 맞는 모든 아군 카드에 키워드를 부여합니다",
  friendlyMatchingUnitsGainKeywords: "조건에 맞는 아군 유닛에게 키워드를 부여합니다",
  friendlyMatchingUnitsMight: "조건에 맞는 아군 유닛의 위력을 변경합니다",
  friendlyTokensEnterReady: "아군 토큰이 준비 상태로 진입합니다",
  fromHiddenPlayToken: "뒷면 카드가 사용되면 토큰을 만듭니다",
  globalBonusDamage: "자신의 주문과 스킬이 추가 피해를 입힙니다",
  gainKeywords: "키워드를 획득합니다",
  gainMightKeywordsIfPowerSpent: "이번 턴에 필요한 힘을 지불했다면 위력과 키워드를 획득합니다",
  gainPoint: "점수를 획득합니다",
  gainTags: "태그를 획득합니다",
  giveKeyword: "유닛에게 키워드를 부여합니다",
  goldAdditionalEnergyNearVictory: "승리 점수에 가까우면 골드가 추가로 에너지 [추가]",
  grantNextSpellRepeatEqualCost: "이번 턴 다음 주문에 그 주문의 비용과 같은 반복 비용을 부여합니다",
  healFriendlyUnitsHere: "이곳의 아군 유닛을 회복시킵니다",
  highPowerCardDraw: "힘 비용이 높은 카드를 사용하면 카드를 뽑습니다",
  killBattlefieldUnitRewardTokens: "전장의 유닛을 처치하고 소속에 따라 골드 토큰을 만듭니다",
  killFriendlyBuffAnotherByMight: "아군 유닛을 처치하고 다른 아군 유닛의 위력을 그 유닛의 위력만큼 높입니다",
  killFriendlyGearThenPlayHandGear: "아군 도구를 처치하면 손의 도구를 에너지 비용 없이 사용할 수 있습니다",
  killGear: "도구를 처치합니다",
  killSelfMoveAttackerToBase: "자신을 처치해 공격 유닛을 기지로 이동시킵니다",
  killUnit: "유닛을 처치합니다",
  legendAttachEquipment: "아군 전설이 자신이 조종하는 장착물을 유닛에 부착할 수 있습니다",
  millTopDeck: "주 덱 위 카드를 폐기장에 놓습니다",
  modifyAnotherFriendly: "다른 아군 유닛의 위력을 이번 턴 동안 변경합니다",
  modifyFriendlyUnits: "아군 유닛의 위력을 이번 턴 동안 변경합니다",
  modifyMight: "선택한 유닛의 위력을 이번 턴 동안 변경합니다",
  modifySelfMight: "자신의 위력을 이번 턴 동안 변경합니다",
  modifySelfWhenChosenOrReadied: "자신이 선택되거나 준비되면 이번 턴 동안 위력을 높입니다",
  modifyTwoUnitsOpposite: "두 유닛의 위력을 서로 반대 방향으로 변경합니다",
  moveAnyFriendlyUnitsAtBattlefieldToBase: "한 전장의 아군 유닛을 원하는 만큼 기지로 이동시킵니다",
  moveAttachGrantConquerRecall: "아군 유닛을 이동시키고 장착물을 부착할 수 있으며, 이번 턴 정복 후 기지로 이동할 수 있게 합니다",
  moveEnemyToSameControllerLocation: "적 유닛을 같은 조종자의 다른 유닛이 있는 장소로 이동시킵니다",
  moveFriendlyTokensHere: "아군 토큰 유닛을 원하는 만큼 이 전장으로 이동시킵니다",
  moveFriendlyUnitsToOpenBattlefield: "아군 유닛을 원하는 만큼 개방 전장으로 이동시킵니다",
  moveSelfToBase: "자신을 기지로 이동시킵니다",
  moveSelfToBattlefield: "자신을 해당 전장으로 이동시킵니다",
  moveWithFriendlyFromSameBattlefield: "같은 전장의 다른 아군 유닛을 함께 이동시킵니다",
  opponentGainPointIfCombat: "전투에서 죽으면 선택한 상대가 점수를 획득합니다",
  opponentTurnExhaustSelfPlayToken: "상대 턴에 주문을 사용하면 자신을 탈진시켜 토큰을 만듭니다",
  opponentsCannotGainPoints: "상대는 점수를 얻을 수 없습니다",
  optionalAdditionalCostReduction: "선택 추가 비용을 줄입니다",
  otherFriendlyNonHandUnitsHaveAccelerate: "손 이외에서 사용하는 다른 아군 유닛에게 가속을 부여합니다",
  payEnergyDraw: "에너지를 지불해 카드를 뽑습니다",
  payEnergyDrawIfMighty: "[위력적] 유닛과 함께 정복했다면 에너지를 지불해 카드를 뽑습니다",
  payEnergyExhaustDraw: "에너지를 지불하고 자신을 탈진시켜 카드를 뽑습니다",
  payEnergyPlayToken: "에너지를 지불해 토큰을 만듭니다",
  payEnergyReadyLegend: "에너지를 지불해 전설을 준비시킵니다",
  payEnergyReadySelf: "에너지를 지불해 자신을 준비시킵니다",
  payEnergyReturnFriendlyPlayUnitToken: "에너지를 지불하고 아군 유닛을 손으로 되돌려 유닛 토큰을 만듭니다",
  payPowerExhaustReady: "힘을 지불하고 자신을 탈진시켜 유닛을 준비시킵니다",
  payPowerGainPoint: "힘을 지불해 점수를 획득합니다",
  payPowerModifySelfMight: "힘을 지불해 자신의 위력을 이번 턴 동안 높입니다",
  payPowerReadyUnit: "힘을 지불해 유닛을 준비시킵니다",
  playDestinationRestriction: "카드를 사용할 수 있는 장소가 제한됩니다",
  playEquipmentFromHandIgnoreCostAttachSelf: "손의 장착물을 비용 없이 사용한 뒤 자신에게 부착합니다",
  playFromTopReveal: "덱에서 공개되는 동안 자원 [추가]",
  playHandUnitToControlledBattlefieldReduced: "손의 유닛을 자신이 조종하는 전장에 비용을 줄여 사용합니다",
  playSpellFromTrashMaxEnergy: "폐기장의 주문을 에너지 비용 없이 사용한 뒤 재활용합니다",
  playToken: "토큰을 만듭니다",
  playUnitFromTrash: "폐기장의 유닛을 사용합니다",
  playUnitToken: "유닛 토큰을 만듭니다",
  playUnitsBanishedWithSelf: "이 카드와 함께 추방된 유닛을 비용 없이 사용합니다",
  possession: "전장의 적 유닛 조종권을 얻고 탈진시킨 뒤 자신의 기지로 귀환시킵니다",
  preventNextDamage: "이번 턴 선택한 유닛이 다음에 받을 피해를 방지합니다",
  readyFriendlyUnits: "아군 유닛을 준비시킵니다",
  readyGearThenOptionalDetach: "아군 도구를 준비시키고 장착물이라면 분리할 수 있습니다",
  readyOrExhaustLegend: "전설을 준비시키거나 탈진시킵니다",
  readySelf: "자신을 준비시킵니다",
  readySelfWhenBuffed: "버프를 받으면 자신을 준비시킵니다",
  readyUnit: "유닛을 준비시킵니다",
  recycleFriendlyUnitPlayTrashMechReduced: "다른 아군 유닛을 재활용하고 그 위력만큼 비용을 줄여 폐기장의 기계를 사용합니다",
  recycleTopBeforeReveal: "덱에서 카드를 공개하기 전에 맨 위 카드를 확인해 재활용할 수 있습니다",
  repeatCostReduction: "아군 반복 비용의 에너지 비용을 줄입니다",
  returnAllUnitsAndGearToHand: "모든 유닛과 도구를 소유자의 손으로 되돌립니다",
  returnBattlefieldUnitToHand: "전장의 유닛을 소유자의 손으로 되돌립니다",
  returnFriendlyAndEnemyToHand: "아군 유닛 하나와 적 유닛 하나를 소유자의 손으로 되돌립니다",
  returnGearToHand: "도구를 소유자의 손으로 되돌립니다",
  returnTrashCardToHand: "폐기장의 카드를 손으로 되돌립니다",
  returnUnitToBase: "유닛을 기지로 이동시킵니다",
  revealTopBanishPlayDrawRest: "덱 위 카드들을 공개해 하나를 추방 후 비용을 줄여 사용하고 나머지는 뽑습니다",
  revealTopBanishPlayRecycleRest: "덱 위 카드들을 공개해 하나를 추방 후 사용하고 나머지는 재활용합니다",
  revealTopDrawTypeElseRecycle: "덱 위 카드를 공개해 지정 유형이면 뽑고 아니면 재활용합니다",
  revealTopSpellToHandElseRecycle: "덱 위 카드를 공개해 주문이면 손에 넣고 아니면 재활용합니다",
  rocketBarrage: "기지의 유닛에게 피해를 입히거나 도구를 처치하는 모드 중 하나를 선택합니다",
  saveFriendlyUnitByKillingThis: "아군 유닛이 죽으려 하면 대신 이 카드를 처치하고 그 유닛을 회복·탈진·귀환시킵니다",
  saveLowerMightFriendlyHereByRecall: "이곳의 더 낮은 위력 아군이 죽으려 하면 대신 회복·탈진·귀환시킵니다",
  selfMightPerFriendlyGear: "아군 도구 수만큼 자신의 위력을 높입니다",
  selfMightWhileAnotherFriendlyHere: "이곳에 다른 아군 유닛이 있으면 자신의 위력을 높입니다",
  selfTargetSpellCostReduction: "자신을 선택하는 아군 주문의 비용을 줄입니다",
  spellCostModifier: "전투 중 아군 주문 비용은 줄이고 적 주문 비용은 늘립니다",
  stealEnemyGear: "적 도구를 자신의 기지로 옮겨 조종하고, 장착물이라면 자신에게 부착합니다",
  strikeDown: "장착물이 부착된 아군 유닛이 적 유닛에게 자신의 위력만큼 피해를 입힌 뒤 장착물 하나를 분리합니다",
  stunUnit: "유닛을 기절시킵니다",
  swapMightSameBattlefield: "같은 전장의 두 유닛의 위력을 이번 턴 동안 맞바꿉니다",
  swapWithControlledUnit: "자신과 조종 중인 유닛의 위치를 맞바꾸고 그 장착물 하나를 가져올 수 있습니다",
  unitsCannotBePlayedHere: "이곳에는 유닛을 사용할 수 없습니다",
  unitsCannotMoveToBase: "유닛은 기지로 이동할 수 없습니다",
  unitsEnterReadyThisTurn: "이번 턴 아군 유닛이 준비 상태로 진입합니다"
});

const KEYWORD_TEXT_KO = Object.freeze({
  Accelerate: "[가속] 추가 비용을 지불하면 준비 상태로 진입할 수 있습니다.",
  Action: "[행동] 자신의 턴 또는 결전 중에 사용할 수 있습니다.",
  Ambush: "[기습] 아군 유닛이 있는 전장에 반응으로 사용할 수 있습니다.",
  Assault: "[맹공] 공격자인 동안 위력이 증가합니다.",
  Backline: "[후방] 전투 피해를 마지막에 배정받습니다.",
  Deathknell: "[죽음의 종소리] 죽을 때 효과가 유발됩니다.",
  Deflect: "[굴절] 상대가 주문이나 스킬로 선택하려면 힘을 지불해야 합니다.",
  Equip: "[장착] 장착 비용을 지불해 아군 유닛에 부착할 수 있습니다.",
  Ganking: "[개입] 전장에서 전장으로 이동할 수 있습니다.",
  Hidden: "[숨겨짐] 힘을 지불해 뒷면으로 숨기고 나중에 에너지 0으로 반응할 수 있습니다.",
  Hunt: "[추적] 정복 또는 점거 시 XP를 획득합니다.",
  QuickDraw: "[속사] 반응으로 사용할 수 있고, 사용하면 아군 유닛에 부착합니다.",
  "Quick-Draw": "[속사] 반응으로 사용할 수 있고, 사용하면 아군 유닛에 부착합니다.",
  Reaction: "[반응] 주문과 스킬이 해결되기 전을 포함해 언제든 사용할 수 있습니다.",
  Repeat: "[반복] 추가 비용을 지불해 주문 효과를 반복할 수 있습니다.",
  Shield: "[보호막] 방어자인 동안 위력이 증가합니다.",
  Tank: "[탱커] 전투 피해를 먼저 배정받습니다.",
  Temporary: "[일시적] 조종자의 시작 단계에 득점 전에 처치됩니다.",
  Unique: "[고유] 덱에 같은 이름의 카드를 한 장만 넣을 수 있습니다.",
  Vision: "[통찰] 사용하면 주 덱 맨 위 카드를 확인해 재활용할 수 있습니다.",
  Weaponmaster: "[무기의 달인] 사용하면 장착물 하나를 힘 비용을 줄여 자신에게 장착할 수 있습니다."
});

const TARGET_KO = Object.freeze({
  unit: "유닛", anotherUnit: "다른 아군 유닛", friendlyUnit: "아군 유닛", enemyUnit: "적 유닛",
  battlefieldUnit: "전장의 유닛", enemyBattlefieldUnit: "전장의 적 유닛",
  attackingUnit: "공격 유닛", friendlyBattlefield: "아군이 있는 전장", enemyBattlefield: "적이 있는 전장",
  enemyHere: "이곳의 적 유닛", enemySpell: "적 주문", self: "자신", player: "플레이어", battlefield: "전장"
});

const TOKEN_KO = Object.freeze({
  gold: "골드 도구", mech: "기계 유닛(위력 3)", sandSoldier: "모래 병사 유닛(위력 2)",
  recruit: "신병 유닛(위력 1)", sprite: "요정 유닛(위력 3)", bird: "새 유닛(위력 1)", reflection: "분신 유닛",
  baronPit: "내셔 남작 둥지 전장", brush: "수풀 전장"
});

const DOMAIN_KO = Object.freeze({ Body: "신체", Calm: "평정", Chaos: "혼돈", Fury: "분노", Mind: "정신", Order: "질서", Any: "범용" });

export function buildUnofficialCardTranslation(card, koName, printedTextKo = "") {
  return {
    collectorNumber: card.cardNumber,
    englishName: card.name,
    koName,
    koHeader: cardHeaderKo(card, koName),
    koTypeLine: cardTypeLineKo(card),
    koText: printedTextKo ? `비공식 번역\n${printedTextKo}` : cardRulesKo(card)
  };
}

export function cardRulesKo(card) {
  const keywordLines = [...new Set(card.keywords || [])]
    .map((keyword) => keywordTextKo(card, keyword));
  const additionalCostLine = describeAdditionalCost(card.additionalCost);
  const effectLines = (card.effects || []).map(describeEffectKo).filter(Boolean);
  const lines = [...keywordLines, ...(additionalCostLine ? [additionalCostLine] : []), ...effectLines];
  const vocabulary = requiredVocabularyKo(card.text, lines.join("\n"));
  if (vocabulary) lines.push(vocabulary);
  return `비공식 번역\n${lines.length ? lines.join("\n") : "별도의 규칙 효과가 없습니다."}`;
}

export function describeEffectKo(effect) {
  if (!effect || typeof effect !== "object") return "";
  const timing = TIMING_KO[effect.timing] || "효과";
  const description = effect.kind === "possession" && effect.recallEndTurn
    ? "전장의 적 유닛 조종권을 얻어 준비시킵니다. 다른 적이 있으면 전투를 시작하고, 없으면 정복합니다. 턴 종료 시 조종권을 잃고 그 유닛을 소유자의 기지로 귀환시킵니다"
    : effect.kind === "modifySelfMight" && effect.buff
      ? "자신을 버프합니다"
    : KIND_KO[effect.kind] || camelKindKo(effect.kind);
  const details = effectDetailsKo(effect);
  return `${timing}: ${description}${details.length ? ` (${details.join(" · ")})` : ""}.`;
}

function keywordTextKo(card, keyword) {
  const amount = keywordAmountFromText(card.text, keyword);
  if (["Assault", "Shield", "Deflect", "Hunt"].includes(keyword)) {
    const base = KEYWORD_TEXT_KO[keyword] || `[${keyword}] 키워드를 가집니다.`;
    return base.replace(`[${keywordKo(keyword)}]`, `[${keywordKo(keyword)} ${amount || 1}]`);
  }
  if (keyword === "Accelerate") {
    const line = firstKeywordLine(card.text, keyword);
    const energy = /Energy\s*(\d+)/iu.exec(line)?.[1] || "1";
    const domain = Object.keys(DOMAIN_KO).find((candidate) => candidate !== "Any"
      && new RegExp(`${candidate}\\s+Power`, "iu").test(line));
    return `[가속] 추가 비용으로 에너지 ${energy}${domain ? `과 ${DOMAIN_KO[domain]} 힘 1` : ""}을 지불하면 준비 상태로 진입할 수 있습니다.`;
  }
  if (keyword === "Repeat") {
    const repeat = (card.effects || []).find((effect) => effect?.repeatCost)?.repeatCost || {};
    const parts = [];
    if (repeat.energy) parts.push(`에너지 ${repeat.energy}`);
    for (const power of repeat.power || []) parts.push(`${DOMAIN_KO[power.domain] || power.domain} 힘 ${power.amount}`);
    if (repeat.discard) parts.push(`카드 ${repeat.discard}장 버리기`);
    return `[반복]${parts.length ? ` 추가 비용(${parts.join(", ")})을 지불해` : " 추가 비용을 지불해"} 주문 효과를 반복할 수 있습니다.`;
  }
  return KEYWORD_TEXT_KO[keyword] || `[${keyword}] 키워드를 가집니다.`;
}

function firstKeywordLine(text, keyword) {
  return String(text || "").split(/\r?\n/u).find((line) => new RegExp(`\\[${keyword}(?:\\s+\\d+)?\\]`, "iu").test(line)) || "";
}

function keywordAmountFromText(text, keyword) {
  const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`\\[${escaped}(?:\\s+(\\d+))?\\]`, "iu").exec(String(text || ""));
  return match ? Number(match[1] || 1) : 1;
}

function describeAdditionalCost(cost) {
  if (!cost) return "";
  if (cost.kind === "returnFriendlyGearToHand") return "추가 비용: 아군 도구 하나를 소유자의 손으로 되돌립니다.";
  if (cost.kind === "optionalExhaustLegend") return "선택 추가 비용: 자신의 전설을 탈진시킬 수 있습니다.";
  if (cost.kind === "optionalPower" || cost.kind === "conditionalOptionalPower") {
    return `선택 추가 비용: ${DOMAIN_KO[cost.domain] || "범용"} 힘 ${cost.amount || 1}을 지불할 수 있습니다.`;
  }
  if (cost.kind === "optionalXp") return `선택 추가 비용: XP ${cost.amount || 1}을 지불할 수 있습니다.`;
  if (cost.kind === "killFriendlyUnit") return "추가 비용: 아군 유닛 하나를 처치합니다.";
  if (cost.kind === "killFriendlyTaggedUnit") return `추가 비용: 지정 태그의 아군 유닛 하나를 처치합니다 (${(cost.tags || []).map(tagKo).join(", ")}).`;
  if (cost.kind === "killFriendlyMightyUnit") return `추가 비용: 아군 [위력적] 유닛 하나를 처치합니다 (위력 ${cost.minMight || 5} 이상).`;
  if (cost.kind === "optionalKillFriendlyUnitForCostReduction") return "선택 추가 비용: 아군 유닛 하나를 처치해 사용 비용을 줄일 수 있습니다.";
  return `추가 비용: ${camelKindKo(cost.kind)}.`;
}

function effectDetailsKo(effect) {
  const details = [];
  if (effect.target) details.push(`대상 ${TARGET_KO[effect.target] || effect.target}`);
  if (Number.isFinite(effect.amount) && effect.amount !== 0) details.push(`수치 ${signed(effect.amount)}`);
  if (Number.isFinite(effect.count)) details.push(`수량 ${effect.count}`);
  if (Number.isFinite(effect.draw)) details.push(`카드 ${effect.draw}장 뽑기`);
  if (Number.isFinite(effect.discard)) details.push(`카드 ${effect.discard}장 버리기`);
  if (Number.isFinite(effect.energy)) details.push(`에너지 ${effect.energy}`);
  if (Number.isFinite(effect.costEnergy)) details.push(`에너지 비용 ${effect.costEnergy}`);
  if (Number.isFinite(effect.costXp)) details.push(`XP 비용 ${effect.costXp}`);
  if (Number.isFinite(effect.replacementEnergy)) details.push(`대체 에너지 비용 ${effect.replacementEnergy}`);
  if (Array.isArray(effect.replacementPower) && effect.replacementPower.length) {
    details.push(`대체 힘 비용 ${effect.replacementPower.map((cost) => `${DOMAIN_KO[cost.domain] || cost.domain} 힘 ${cost.amount}`).join(", ")}`);
  }
  if (Number.isFinite(effect.gainXp)) details.push(`XP ${effect.gainXp} 획득`);
  if (Number.isFinite(effect.gainXpPerKill)) details.push(`처치한 유닛 하나당 XP ${effect.gainXpPerKill} 획득`);
  if (Number.isFinite(effect.gainXpWhenTargetWinsCombat)) details.push(`그 유닛이 전투에서 승리하면 XP ${effect.gainXpWhenTargetWinsCombat} 획득`);
  if (Number.isFinite(effect.level)) details.push(`필요 XP ${effect.level}`);
  if (Number.isFinite(effect.maxEnergy)) details.push(`에너지 비용 최대 ${effect.maxEnergy}`);
  if (Number.isFinite(effect.maxMight)) details.push(`위력 최대 ${effect.maxMight}`);
  if (Number.isFinite(effect.mightyThreshold)) details.push(`[위력적] 기준 위력 ${effect.mightyThreshold}`);
  if (Number.isFinite(effect.readyCount)) details.push(`최대 ${effect.readyCount}개 준비`);
  if (Number.isFinite(effect.look)) details.push(`덱 위 ${effect.look}장 확인`);
  if (Number.isFinite(effect.repeat)) details.push(`${effect.repeat}회 처리`);
  if (Number.isFinite(effect.friendlyTokenCount)) details.push(`아군 대상 골드 ${effect.friendlyTokenCount}개`);
  if (Number.isFinite(effect.enemyTokenCount)) details.push(`적 대상 골드 ${effect.enemyTokenCount}개`);
  if (Number.isFinite(effect.costRecycleTrash)) details.push(`폐기장 카드 ${effect.costRecycleTrash}장 재활용`);
  if (Number.isFinite(effect.optionalReadyPower)) details.push(`준비 비용 힘 ${effect.optionalReadyPower}`);
  if (Array.isArray(effect.optionalReadyPower) && effect.optionalReadyPower.length) {
    details.push(`준비 비용 ${effect.optionalReadyPower.map((cost) => `${DOMAIN_KO[cost.domain] || cost.domain} 힘 ${cost.amount}`).join(", ")}`);
    details.push("선택 가능");
  }
  if (Number.isFinite(effect.withinScore)) details.push(`승리 점수와 ${effect.withinScore}점 이내`);
  if (effect.tokenKind) details.push(`토큰 ${TOKEN_KO[effect.tokenKind] || effect.tokenKind}`);
  if (Number.isFinite(effect.might)) details.push(`토큰 위력 ${effect.might}`);
  if (Array.isArray(effect.keywords) && effect.keywords.length) details.push(`키워드 ${effect.keywords.map(keywordKo).join(", ")}`);
  if (Array.isArray(effect.abilityKeywords) && effect.abilityKeywords.length) details.push(`능력 유형 ${effect.abilityKeywords.map(keywordKo).join(", ")}`);
  if (Array.isArray(effect.modes) && effect.modes.length) details.push(`선택지 ${effect.modes.map(modeKo).join(", ")}`);
  if (Array.isArray(effect.tags) && effect.tags.length) details.push(`태그 ${effect.tags.map(tagKo).join(", ")}`);
  if (["stunEnemyHereIfControlsAllTags", "scoreIfControlsAllTags"].includes(effect.kind)
    && Array.isArray(effect.tags)) details.push(`필요 태그 수 ${effect.tags.length}`);
  if (effect.domain) details.push(`${DOMAIN_KO[effect.domain] || effect.domain} 힘`);
  if (Array.isArray(effect.costPower) && effect.costPower.length) details.push(`힘 비용 ${effect.costPower.map((cost) => `${DOMAIN_KO[cost.domain] || cost.domain} ${cost.amount}`).join(", ")}`);
  if (Array.isArray(effect.tiers) && effect.tiers.length) {
    details.push(`단계 ${effect.tiers.map((tier) => `XP ${tier.level}: 에너지 ${signed(tier.energy || 0)}${tier.power?.length ? `, ${tier.power.map((cost) => `${DOMAIN_KO[cost.domain] || cost.domain} 힘 ${signed(cost.amount)}`).join(", ")}` : ""}`).join(" / ")}`);
  }
  if (Array.isArray(effect.repeatCosts) && effect.repeatCosts.length) {
    details.push(`반복 비용 ${effect.repeatCosts.map(costKo).join(" / ")}`);
  }
  if (effect.ability) details.push(`부여 능력 ${describeEffectKo(effect.ability)}`);
  const numericDetails = {
    addEnergy: "[추가] 에너지", additionalEnergy: "추가 에너지", additionalPower: "추가 힘",
    amountIfControlsFacedown: "뒷면 카드를 조종할 때 수치", amountIfFriendlyExhaustAdditionalCost: "추가 비용을 지불했을 때 수치",
    amountPerControlledBattlefield: "조종 중인 전장 하나당 수치", amountPerEnemyAtTargetBattlefield: "대상 전장의 적 하나당 수치",
    amountPerTag: "태그 하나당 수치", amountPerUnitBeyondFirst: "첫 유닛을 제외한 유닛 하나당 수치", attackingAmount: "공격 대상 수치",
    battlefieldUnits: "전장의 유닛 수", beginningAmount: "시작 단계 수치", bonusPerPriorResolution: "앞선 해결 한 번당 추가 피해",
    channel: "전개할 룬", channelOwner: "소유자가 전개할 룬", controlGearAtLeast: "필요한 도구 수",
    costDiscard: "비용으로 버릴 카드", costEnergyReductionPerFriendlyTemporary: "아군 일시적 유닛 하나당 에너지 감소",
    enemyEnergy: "적 대상 에너지", enemyPower: "적 대상 힘", energyReduction: "에너지 감소",
    energyPerCardPlayed: "이번 턴 사용한 카드 하나당 에너지 변경", energyPerFriendlyMighty: "아군 [위력적] 유닛 하나당 에너지 변경",
    energyPerHoldPoint: "이번 턴 점거 점수 하나당 에너지 변경", energyPerTag: "태그 하나당 에너지 변경", energyPerTrash: "폐기장 카드 하나당 에너지 변경",
    excessDamage: "필요 초과 피해", friendlyEnergy: "아군 대상 에너지", friendlyPower: "아군 대상 힘",
    hand: "손의 정확한 카드 수", handSizeAtMost: "손 카드 최대", levelAmount: "레벨 조건 수치", max: "최대 수량",
    maxCards: "최대 카드 수", maxPower: "힘 비용 최대", maxTargets: "최대 대상 수", maxTotalMight: "합계 위력 최대",
    minEnergy: "에너지 비용 최소", minMight: "위력 최소", minPower: "힘 비용 최소", minTargets: "최소 대상 수",
    moveNumber: "이동 횟수", otherUnitsInBaseAtLeast: "기지의 다른 유닛 최소", points: "점수", powerAtLeast: "지불한 힘 최소",
    powerPerHoldPoint: "이번 턴 점거 점수 하나당 힘 변경", predict: "예측할 카드", readyCount: "준비시킬 최대 수량",
    repeatCostEnergy: "반복 에너지", repeatCostPower: "반복 힘", replacementDraw: "대신 뽑을 카드",
    replayCostPower: "다시 사용할 힘 비용", requiresExcessDamage: "필요 초과 피해", requiresOtherFriendlyTotalMight: "다른 아군의 합계 위력 조건",
    requiresHighCostSpellPlayedThisTurn: "이번 턴 사용한 주문의 최소 에너지 비용",
    splashAmount: "추가 대상 피해", threshold: "필요 수량", turn: "턴", withinScore: "승리 점수와의 차이", xp: "XP"
  };
  for (const [key, label] of Object.entries(numericDetails)) {
    if (Number.isFinite(effect[key])) details.push(`${label} ${effect[key]}`);
  }
  if (effect.ready) details.push("준비 상태");
  if (effect.exhausted) details.push("탈진 상태");
  if (effect.killSelfCost) details.push("비용으로 자신 처치");
  if (effect.killFriendlyUnitCost) details.push("비용으로 아군 유닛 처치");
  if (effect.additionalCostKillFriendlyGear) details.push("추가 비용으로 아군 도구를 처치할 수 있음");
  if (effect.banishIfDiesThisTurn) details.push("이번 턴 죽으면 대신 추방");
  if (effect.playGoldIfDiesThisTurn || effect.playTokenOnSuccess) details.push("조건 달성 시 골드 도구 토큰 생성");
  if (effect.drawIfFromHand) details.push(`손에서 사용했다면 카드 ${effect.drawIfFromHand}장 뽑기`);
  if (effect.revealType) details.push(`공개할 유형 ${effect.revealType === "unit" ? "유닛" : effect.revealType === "spell" ? "주문" : effect.revealType}`);
  if (effect.recycleRest) details.push("나머지 재활용");
  if (effect.mayChoose) details.push("선택하지 않아도 됨");
  if (effect.temporary && (effect.tokenKind || /play(?:Unit)?Token|Reflection/iu.test(effect.kind || ""))) details.push("일시적 키워드");
  else if (effect.temporary) details.push("이번 턴까지");
  if (effect.exhaust) details.push("자신 탈진");
  if (effect.optional || effect.mayChoose || effect.replayCostPower || /^pay/iu.test(effect.kind || "")
    || ["playEquipmentFromHandIgnoreCostAttachSelf", "recycleFriendlyUnitPlayTrashMechReduced", "opponentTurnExhaustSelfPlayToken", "searchTopDeck", "searchTopUnitThenBuffIfTags", "killUnitThenReplaySelfIfWeak", "battlefieldCombatDeathRecall"].includes(effect.kind)) {
    details.push("선택 가능");
  }
  if (effect.oncePerTurn || effect.firstEachTurn) details.push("턴마다 한 번");
  if (effect.ignoreCost) details.push("비용 무시");
  if (effect.ignoreEnergyCost) details.push("에너지 비용 무시");
  if (effect.repeatCost) details.push(`반복 비용 ${costKo(effect.repeatCost)}`);
  return details;
}

function costKo(cost) {
  const parts = [];
  if (cost.energy) parts.push(`에너지 ${cost.energy}`);
  for (const power of cost.power || []) parts.push(`${DOMAIN_KO[power.domain] || power.domain} 힘 ${power.amount}`);
  if (cost.discard) parts.push(`카드 ${cost.discard}장 버리기`);
  return parts.join(", ") || "없음";
}

function cardHeaderKo(card, koName) {
  const parts = [`[${koName}]`];
  if ((card.energy || 0) > 0) parts.push(`${card.energy} 에너지`);
  for (const cost of card.power || []) {
    const domains = cost.domain === "Any" ? card.domains || [] : [cost.domain];
    const label = domains.map((domain) => DOMAIN_KO[domain] || "범용").join("/");
    parts.push(`${cost.amount} ${label} 힘`);
  }
  if (card.might != null) parts.push(`${card.might} 위력`);
  return parts.join(", ");
}

function cardTypeLineKo(card) {
  const typeKo = { unit: "유닛", spell: "주문", gear: "도구", legend: "전설", battlefield: "전장", rune: "기본 룬" };
  const rawTypes = Array.isArray(card.types) && card.types.length ? card.types : [card.type];
  const types = rawTypes.map((type) => typeKo[type]).filter(Boolean);
  if (card.isChampion && types.includes("유닛")) types[types.indexOf("유닛")] = "챔피언 유닛";
  return [...new Set(types.length ? types : ["카드"]), ...(card.tags || []).map(tagKo)].join(", ");
}

function keywordKo(keyword) {
  return ({ Accelerate: "가속", Action: "행동", Ambush: "기습", Assault: "맹공", Backline: "후방", Deathknell: "죽음의 종소리", Deflect: "굴절", Equip: "장착", Ganking: "개입", Hidden: "숨겨짐", Hunt: "추적", "Quick-Draw": "속사", Reaction: "반응", Repeat: "반복", Shield: "보호막", Tank: "탱커", Temporary: "일시적", Unique: "고유", Vision: "통찰", Weaponmaster: "무기의 달인" })[keyword] || keyword;
}

function tagKo(tag) {
  return ({
    Action: "행동", Ashe: "애쉬", Champion: "챔피언", Diana: "다이애나", Evelynn: "이블린",
    Galio: "갈리오", Hidden: "숨겨짐", Hwei: "흐웨이", Ivern: "아이번", Jhin: "진",
    Katarina: "카타리나", Kathkan: "카트칸", "Kha'Zix": "카직스", LeBlanc: "르블랑",
    Lillia: "릴리아", "Master Yi": "마스터 이", Nami: "나미", Nidalee: "니달리", Nilah: "닐라",
    Poppy: "뽀삐", Pyke: "파이크", Reaction: "반응", Signature: "시그니처", Spider: "거미",
    Syndra: "신드라", Vi: "바이", Xerath: "제라스", Yuumi: "유미", Zilean: "질리언",
    Akali: "아칼리", Akshan: "아크샨", Ambessa: "암베사", Aphelios: "아펠리오스", Azir: "아지르", "Bandle City": "밴들 시티", Bard: "바드", Bilgewater: "빌지워터", Bird: "새", Cat: "고양이", Demacia: "데마시아", Demon: "악마", Dog: "개", Dragon: "용", Draven: "드레이븐", Elite: "정예", Equipment: "장착물", Ezreal: "이즈리얼", Fae: "요정", Fiora: "피오라", Fizz: "피즈", Freljord: "프렐요드", Gangplank: "갱플랭크", Icathia: "이케시아", Illaoi: "일라오이", Ionia: "아이오니아", Irelia: "이렐리아", Ixtal: "이쉬탈", Janna: "잔나", Jax: "잭스", Jayce: "제이스", Kayle: "케일", Kennen: "케넨", Lucian: "루시안", Mech: "기계", Mel: "멜", "Mount Targon": "타곤 산", Morgana: "모르가나", Nasus: "나서스", Noxus: "녹서스", Ornn: "오른", Piltover: "필트오버", Pirate: "해적", Poro: "포로", Renekton: "레넥톤", "Rek'Sai": "렉사이", Rell: "렐", "Renata Glasc": "레나타 글라스크", Rengar: "렝가", Riven: "리븐", Rumble: "럼블", Sentinel: "감시자", Shen: "쉔", "Shadow Isles": "그림자 군도", Shurima: "슈리마", Sivir: "시비르", Soraka: "소라카", Spirit: "영혼", Swain: "스웨인", "The Void": "공허", Trifarian: "트리파르", Vex: "벡스", "Xin Zhao": "신 짜오", Yone: "요네", Yordle: "요들", Zaun: "자운", Zed: "제드"
  })[tag] || tag;
}

function modeKo(mode) {
  return ({
    readyRunes: "룬 2장 준비",
    channelRuneExhausted: "룬 1장을 탈진 상태로 전개",
    buffFriendlyUnit: "아군 유닛 하나 버프",
    draw: "카드 1장 뽑기", damageBattlefield: "전장의 유닛에게 피해 2",
    damageBase: "기지의 유닛에게 피해 3", reduceBattlefieldMight: "전장 유닛의 위력 -4"
  })[mode] || camelKindKo(mode);
}

function requiredVocabularyKo(englishText, translatedText) {
  const terms = [];
  const rules = [
    [/\bPower\b/iu, /힘/u, "힘"],
    [/\bMight\b/iu, /위력/u, "위력"],
    [/\bShowdown\b/iu, /결전/u, "결전"],
    [/(?:\brunes?\b|\brune deck\b)/iu, /룬/u, "룬"],
    [/\b(?:ready|readies)\b/iu, /준비/u, "준비"],
    [/\bexhaust(?:ed|s|ing)?\b/iu, /탈진/u, "탈진"]
  ];
  for (const [english, korean, label] of rules) {
    if (english.test(englishText || "") && !korean.test(translatedText)) terms.push(label);
  }
  return terms.length ? `관련 규칙 용어: ${terms.join(", ")}.` : "";
}

function camelKindKo(value) {
  return String(value || "효과")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/friendly/giu, "아군")
    .replace(/enemy/giu, "적")
    .replace(/unit/giu, "유닛")
    .replace(/gear/giu, "도구")
    .replace(/draw/giu, "카드 뽑기")
    .replace(/play/giu, "사용")
    .replace(/ready/giu, "준비")
    .replace(/mIght/giu, "위력")
    .trim();
}

function signed(value) {
  return Number(value) > 0 ? `+${value}` : String(value);
}
