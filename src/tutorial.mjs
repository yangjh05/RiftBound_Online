import {
  chooseEffectOption,
  createGame,
  endTurn,
  passShowdown
} from "./engine.mjs";
import { cards, decklists, DOMAINS, makeRune } from "./cards.mjs";

export const TUTORIAL_IDS = Object.freeze({
  firstVictory: "first-victory",
  combat: "combat-damage",
  spell: "spell-targeting",
  power: "energy-and-power"
});

export const TUTORIAL_CATALOG = Object.freeze([
  {
    id: TUTORIAL_IDS.firstVictory,
    order: 1,
    title: "첫 승리",
    englishTitle: "Your First Victory",
    summary: "카드를 사용하고 전장을 정복해 8점 승리까지 진행합니다.",
    englishSummary: "Play a unit, conquer a battlefield, and reach 8 points.",
    focus: "오리진 덱 · 손패 · 룬 · 이동 · 점수",
    englishFocus: "Hand · Runes · Movement · Scoring",
    duration: "약 3분"
  },
  {
    id: TUTORIAL_IDS.combat,
    order: 2,
    title: "전투와 피해 배분",
    englishTitle: "Combat and Damage",
    summary: "점령된 전장에 진입하고 결전 피해를 직접 배분합니다.",
    englishSummary: "Enter an occupied battlefield and assign combat damage.",
    focus: "오리진 덱 · 결전 · 공격 · 방어 · 피해",
    englishFocus: "Showdown · Attack · Defend · Damage",
    duration: "약 2분"
  },
  {
    id: TUTORIAL_IDS.spell,
    order: 3,
    title: "주문과 대상 지정",
    englishTitle: "Spells and Targets",
    summary: "피해 주문의 대상을 고르고 룬을 지불해 해결합니다.",
    englishSummary: "Choose a target, pay for a damage spell, and resolve it.",
    focus: "오리진 덱 · 주문 · 대상 · 체인 · 처치",
    englishFocus: "Spells · Targets · Chain · Kills",
    duration: "약 2분"
  },
  {
    id: TUTORIAL_IDS.power,
    order: 4,
    title: "에너지와 파워",
    englishTitle: "Energy and Power",
    summary: "에너지 소진과 속성 파워 재활용의 차이를 배웁니다.",
    englishSummary: "Learn the difference between exhausting for Energy and recycling for Power.",
    focus: "오리진 덱 · 비용 · 속성 · 소진 · 재활용",
    englishFocus: "Costs · Domains · Exhaust · Recycle",
    duration: "약 2분"
  }
]);

export const TUTORIAL_CARD_IDS = Object.freeze({
  handUnit: "tutorial-hand-unit",
  readyUnit: "tutorial-ready-unit",
  battlefield: "tutorial-battlefield",
  runes: ["tutorial-rune-1", "tutorial-rune-2"],
  combat: Object.freeze({
    attacker: "tutorial-combat-attacker",
    defender: "tutorial-combat-defender",
    battlefield: "tutorial-combat-battlefield"
  }),
  spell: Object.freeze({
    card: "tutorial-spell-card",
    target: "tutorial-spell-target",
    battlefield: "tutorial-spell-battlefield",
    runes: ["tutorial-spell-rune-1", "tutorial-spell-rune-2"]
  }),
  power: Object.freeze({
    card: "tutorial-power-card",
    battlefield: "tutorial-power-battlefield",
    runes: [
      "tutorial-power-rune-1",
      "tutorial-power-rune-2",
      "tutorial-power-rune-3",
      "tutorial-power-rune-4",
      "tutorial-power-rune-5"
    ]
  })
});

const TUTORIAL_PLAYER_ID = "p1";
const TUTORIAL_OPPONENT_ID = "p2";

const FIRST_VICTORY_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 7, "첫 승리까지 함께 해볼까요?", "리프트바운드는 전장을 차지해 8점을 먼저 만드는 게임입니다. 이번 연습에서는 카드 사용, 룬 지불, 이동, 결전과 전장 유지를 직접 해봅니다.", "아래의 시작 버튼을 눌러 주세요.", "연습 시작"),
  openHand: lessonStep("open-hand", 2, 7, "먼저 손패를 확인하세요", "화면 아래의 손패 버튼에는 지금 사용할 수 있는 카드가 들어 있습니다.", "금색으로 표시된 ‘손패’ 버튼을 눌러 주세요."),
  playUnit: lessonStep("play-unit", 3, 7, "유닛을 기지에 배치하세요", "오리진의 Ravenbloom Student는 에너지 2가 필요합니다. 손패의 카드에서 ‘기지에 사용’을 선택하세요.", "금색으로 표시된 카드 사용 버튼을 눌러 주세요."),
  selectRunes: lessonStep("select-runes", 4, 7, "룬으로 에너지를 지불하세요", "준비된 룬 하나를 소진하면 에너지 1을 냅니다. 두 룬에서 각각 ‘에너지’를 선택하세요.", "룬 2개를 에너지로 선택하면 결제를 확정할 수 있습니다."),
  confirmPayment: lessonStep("confirm-payment", 4, 7, "결제를 확정하세요", "필요한 에너지 2가 모두 선택되었습니다. 확정하면 유닛이 기지에 들어옵니다. 새로 사용한 유닛은 이번 턴에 이동할 수 없습니다.", "‘확정’ 버튼을 눌러 주세요."),
  selectMover: lessonStep("select-mover", 5, 7, "준비된 유닛을 선택하세요", "기지에는 방금 사용한 소진 유닛과 처음부터 준비되어 있던 유닛이 있습니다. 이동하려면 준비된 Stalwart Poro를 선택해야 합니다.", "금색 테두리의 준비된 유닛을 눌러 주세요."),
  moveUnit: lessonStep("move-unit", 5, 7, "빈 전장으로 이동하세요", "유닛을 전장으로 보내면 소진되고 결전이 시작됩니다. 상대 유닛이 없어도 양쪽이 대응할 기회를 가집니다.", "‘전장 1로 이동’을 눌러 주세요."),
  passShowdown: lessonStep("pass-showdown", 6, 7, "결전에서 패스하세요", "지금은 추가할 행동이 없습니다. 패스하면 상대도 자동으로 패스하고, 결전이 끝난 뒤 빈 전장을 정복합니다.", "금색으로 표시된 ‘패스’ 버튼을 눌러 주세요."),
  endTurn: lessonStep("end-turn", 7, 7, "정복 점수를 얻었습니다", "전장을 정복해 7점이 되었습니다. 턴을 종료하면 훈련 상대의 턴이 자동으로 지나가고, 다음 내 턴 시작에 전장 유지 점수를 얻습니다.", "‘턴 종료’를 눌러 마지막 점수를 확인하세요."),
  complete: lessonStep("complete", 7, 7, "첫 승리를 완성했습니다!", "정복으로 1점, 다음 턴에 전장을 유지해서 1점을 얻어 8점에 도달했습니다. 이제 실제 게임에서도 ‘유닛 배치 → 이동 → 결전 → 전장 유지’의 흐름을 활용할 수 있습니다.", "다른 튜토리얼을 선택하거나 이 과정을 다시 연습할 수 있습니다.")
});

const COMBAT_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 5, "점령된 전장에서 싸워봅시다", "상대가 차지한 전장에 유닛을 보내면 결전이 열립니다. 양쪽이 패스하면 각 플레이어가 자신의 총 위력만큼 상대 유닛에게 피해를 배분합니다.", "시작 버튼을 눌러 전투를 연습하세요.", "전투 시작"),
  selectAttacker: lessonStep("select-attacker", 2, 5, "공격할 유닛을 선택하세요", "오리진 덱의 Stalwart Poro는 준비 상태입니다. 준비된 유닛만 전장으로 이동할 수 있습니다.", "금색으로 표시된 Stalwart Poro를 선택하세요."),
  moveAttacker: lessonStep("move-attacker", 3, 5, "상대 전장으로 이동하세요", "상대 Ravenbloom Student가 있는 전장으로 진입하면 결전이 시작됩니다.", "‘전장 1로 이동’을 선택하세요."),
  passShowdown: lessonStep("pass-showdown", 4, 5, "행동을 마치고 패스하세요", "결전 중에는 행동이나 반응을 추가할 수 있습니다. 이번에는 바로 패스해 피해 배분 단계로 넘어갑니다.", "‘패스’ 버튼을 눌러 주세요."),
  assignDamage: lessonStep("assign-combat-damage", 5, 5, "전투 피해를 배분하세요", "내 유닛들의 총 위력 2를 상대 유닛에게 배분합니다. 위력 2인 상대에게 2 피해를 주면 처치할 수 있습니다.", "Ravenbloom Student를 선택하세요."),
  complete: lessonStep("complete", 5, 5, "전투 피해 배분을 마쳤습니다!", "상대도 동시에 피해를 배분해 두 유닛이 함께 처치되었습니다. 결전에서는 공격과 방어 양쪽의 위력, 피해 우선순위와 생존 여부를 함께 계산해야 합니다.", "튜토리얼 메뉴에서 다음 과정을 선택할 수 있습니다.")
});

const SPELL_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 6, "주문으로 상대 유닛을 처치해봅시다", "주문은 해결된 뒤 폐기장으로 가며, 대상이 필요한 주문은 비용을 지불하기 전에 합법적인 대상을 먼저 선언합니다.", "시작 버튼을 눌러 주문 사용을 연습하세요.", "주문 연습 시작"),
  openHand: lessonStep("open-hand", 2, 6, "손패의 주문을 확인하세요", "이번 손패에는 상대 유닛에게 2 피해를 주는 Incinerate가 있습니다.", "‘손패’ 버튼을 눌러 주세요."),
  playSpell: lessonStep("play-spell", 3, 6, "Incinerate를 사용하세요", "주문은 기지에 남지 않습니다. 화면의 ‘사용’ 버튼을 누르면 먼저 대상을 정합니다.", "금색으로 표시된 주문 사용 버튼을 누르세요."),
  chooseTarget: lessonStep("choose-spell-target", 4, 6, "주문의 대상을 지정하세요", "피해를 받을 상대 Ravenbloom Student를 선택합니다. 대상은 주문을 체인에 올릴 때 확정됩니다.", "상대 Ravenbloom Student를 선택하세요."),
  selectRunes: lessonStep("select-runes", 5, 6, "에너지 2를 지불하세요", "Incinerate의 에너지 비용은 2입니다. 준비된 두 룬을 에너지로 선택하세요.", "두 룬에서 각각 ‘에너지’를 선택하세요."),
  confirmPayment: lessonStep("confirm-payment", 5, 6, "주문 비용을 확정하세요", "비용을 모두 골랐습니다. 확정하면 주문이 체인에 올라가고 양쪽이 대응할 기회를 얻습니다.", "‘확정’ 버튼을 눌러 주세요."),
  complete: lessonStep("complete", 6, 6, "주문이 해결되었습니다!", "양쪽이 자동으로 패스해 Incinerate가 2 피해를 주었고, 위력 2인 Ravenbloom Student가 처치되었습니다. 해결된 주문은 내 폐기장으로 이동했습니다.", "튜토리얼 메뉴에서 다음 과정을 선택할 수 있습니다.")
});

const POWER_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 6, "에너지와 파워의 차이를 배워봅시다", "에너지는 룬을 소진하고, 파워는 필요한 속성의 룬을 메인 덱 아래로 재활용합니다. 하나의 룬은 같은 비용에서 에너지와 파워를 함께 낼 수도 있습니다.", "시작 버튼을 눌러 복합 비용을 연습하세요.", "비용 연습 시작"),
  openHand: lessonStep("open-hand", 2, 6, "손패의 챔피언 유닛을 확인하세요", "Annie, Fiery는 에너지 5와 격노 파워 1이 모두 필요합니다.", "‘손패’ 버튼을 눌러 주세요."),
  playUnit: lessonStep("play-power-unit", 3, 6, "Annie를 기지에 사용하세요", "복합 비용은 에너지와 파워를 모두 충족해야 결제를 확정할 수 있습니다.", "‘기지에 사용’을 선택하세요."),
  selectEnergy: lessonStep("select-power-energy", 4, 6, "먼저 에너지 5를 선택하세요", "준비된 격노 룬 다섯 개를 각각 에너지로 선택합니다. 에너지로 사용한 룬은 소진됩니다.", "다섯 룬의 ‘에너지’를 모두 선택하세요."),
  selectPower: lessonStep("select-domain-power", 5, 6, "격노 파워 1을 선택하세요", "이제 격노 룬 하나에서 ‘격노 파워’를 선택하세요. 같은 룬이 에너지로 선택되어 있어도 파워로 함께 사용할 수 있습니다.", "아무 격노 룬 하나의 ‘격노 파워’를 선택하세요."),
  confirmPayment: lessonStep("confirm-payment", 5, 6, "복합 비용을 확정하세요", "에너지 5와 격노 파워 1을 모두 충족했습니다. 확정하면 파워로 낸 룬은 덱 아래로 재활용되고 나머지 룬은 소진됩니다.", "‘확정’ 버튼을 눌러 주세요."),
  complete: lessonStep("complete", 6, 6, "에너지와 파워 지불을 마쳤습니다!", "Annie가 기지에 들어왔습니다. 에너지는 준비 상태를 소비하고, 파워는 속성 조건을 확인한 뒤 룬 자체를 재활용한다는 차이를 기억하세요.", "튜토리얼 메뉴에서 다른 과정을 선택할 수 있습니다.")
});

function lessonStep(id, number, total, title, body, hint, actionLabel = null) {
  return Object.freeze({ id, number, total, title, body, hint, actionLabel });
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
    mightModifier: 0,
    attachments: []
  };
}

function battlefield(card, ownerId, instanceId, controlledBy = null, units = []) {
  return Object.assign(instance(card, ownerId, instanceId), { controlledBy, units, hidden: [] });
}

function createTutorialShell(tutorialId) {
  const game = createGame({
    interactive: true,
    firstPlayerId: TUTORIAL_PLAYER_ID,
    manualActionChainPriority: true,
    randomSeed: 20260718,
    decks: [decklists.originsLeona, decklists.originsKaisa]
  });
  const player = game.players.find((candidate) => candidate.id === TUTORIAL_PLAYER_ID);
  const opponent = game.players.find((candidate) => candidate.id === TUTORIAL_OPPONENT_ID);

  player.name = "연습생";
  player.score = 0;
  player.hand = [];
  player.base = [];
  player.runes = [];
  player.turnScoredBattlefields = [];
  player.cardsPlayedThisTurn = 0;
  player.drawCountThisTurn = 0;

  opponent.name = "훈련 상대";
  opponent.score = 0;
  opponent.hand = [];
  opponent.base = [];
  opponent.runes = [];
  opponent.turnScoredBattlefields = [];

  Object.assign(game, {
    battlefields: [],
    phase: "action",
    firstPlayerId: player.id,
    currentPlayerId: player.id,
    turnPlayerId: player.id,
    turnOrder: [player.id, opponent.id],
    turnNumber: 2,
    turnSequence: 3,
    selectedCardId: null,
    tutorial: {
      id: tutorialId,
      active: true,
      introDismissed: false,
      completed: false,
      playerId: player.id,
      opponentId: opponent.id
    },
    log: [`튜토리얼: ${TUTORIAL_CATALOG.find((entry) => entry.id === tutorialId)?.title || "기초 연습"}`]
  });

  return { game, player, opponent };
}

function buildFirstVictoryTutorial() {
  const { game, player, opponent } = createTutorialShell(TUTORIAL_IDS.firstVictory);
  player.score = 6;
  player.hand = [instance(cards.ravenbloomStudent, player.id, TUTORIAL_CARD_IDS.handUnit)];
  player.base = [instance(cards.stalwartPoro, player.id, TUTORIAL_CARD_IDS.readyUnit)];
  player.runes = [
    instance(makeRune(DOMAINS.CALM), player.id, TUTORIAL_CARD_IDS.runes[0]),
    instance(makeRune(DOMAINS.BODY), player.id, TUTORIAL_CARD_IDS.runes[1])
  ];
  game.battlefields = [battlefield(cards.reckonersArena, player.id, TUTORIAL_CARD_IDS.battlefield)];
  game.turnNumber = 3;
  game.turnSequence = 5;
  game.selectedCardId = TUTORIAL_CARD_IDS.handUnit;
  opponent.score = 0;
  return game;
}

function buildCombatTutorial() {
  const { game, player, opponent } = createTutorialShell(TUTORIAL_IDS.combat);
  const defender = instance(cards.ravenbloomStudent, opponent.id, TUTORIAL_CARD_IDS.combat.defender);
  player.base = [instance(cards.stalwartPoro, player.id, TUTORIAL_CARD_IDS.combat.attacker)];
  game.battlefields = [battlefield(
    cards.reckonersArena,
    player.id,
    TUTORIAL_CARD_IDS.combat.battlefield,
    opponent.id,
    [defender]
  )];
  return game;
}

function buildSpellTutorial() {
  const { game, player, opponent } = createTutorialShell(TUTORIAL_IDS.spell);
  const target = instance(cards.ravenbloomStudent, opponent.id, TUTORIAL_CARD_IDS.spell.target);
  player.hand = [instance(cards.incinerate, player.id, TUTORIAL_CARD_IDS.spell.card)];
  player.runes = TUTORIAL_CARD_IDS.spell.runes.map((id) => instance(makeRune(DOMAINS.FURY), player.id, id));
  game.battlefields = [battlefield(
    cards.reckonersArena,
    player.id,
    TUTORIAL_CARD_IDS.spell.battlefield,
    opponent.id,
    [target]
  )];
  game.selectedCardId = TUTORIAL_CARD_IDS.spell.card;
  return game;
}

function buildPowerTutorial() {
  const { game, player } = createTutorialShell(TUTORIAL_IDS.power);
  player.hand = [instance(cards.annieFiery, player.id, TUTORIAL_CARD_IDS.power.card)];
  player.runes = TUTORIAL_CARD_IDS.power.runes.map((id) => instance(makeRune(DOMAINS.FURY), player.id, id));
  game.battlefields = [battlefield(cards.reckonersArena, player.id, TUTORIAL_CARD_IDS.power.battlefield)];
  game.selectedCardId = TUTORIAL_CARD_IDS.power.card;
  return game;
}

export function createTutorialGame(tutorialId = TUTORIAL_IDS.firstVictory) {
  switch (tutorialId) {
    case TUTORIAL_IDS.combat: return buildCombatTutorial();
    case TUTORIAL_IDS.spell: return buildSpellTutorial();
    case TUTORIAL_IDS.power: return buildPowerTutorial();
    case TUTORIAL_IDS.firstVictory: return buildFirstVictoryTutorial();
    default: throw new Error(`Unknown tutorial: ${tutorialId}`);
  }
}

function selectedEnergyCount(game) {
  return (game.pendingPayment?.energyRuneIds?.length || 0)
    + (game.pendingPayment?.poolEnergyIds?.length || 0);
}

function selectedPowerCount(game) {
  return (game.pendingPayment?.powerRuneIds?.length || 0)
    + (game.pendingPayment?.poolPowerIds?.length || 0);
}

function firstVictoryStep(game, handOpen) {
  const player = tutorialPlayer(game);
  const field = game.battlefields.find((candidate) => candidate.instanceId === TUTORIAL_CARD_IDS.battlefield);
  if (game.phase === "complete" || game.tutorial.completed) return FIRST_VICTORY_STEPS.complete;
  if (game.pendingPayment) {
    const required = Math.max(0, Number(game.pendingPayment.energyCost) || 0);
    return selectedEnergyCount(game) >= required ? FIRST_VICTORY_STEPS.confirmPayment : FIRST_VICTORY_STEPS.selectRunes;
  }
  if (player?.hand.some((card) => card.instanceId === TUTORIAL_CARD_IDS.handUnit)) {
    return handOpen ? FIRST_VICTORY_STEPS.playUnit : FIRST_VICTORY_STEPS.openHand;
  }
  if (game.phase === "showdown") return FIRST_VICTORY_STEPS.passShowdown;
  if (field?.controlledBy === player?.id) return FIRST_VICTORY_STEPS.endTurn;
  if (player?.base.some((card) => card.instanceId === TUTORIAL_CARD_IDS.handUnit)) {
    return game.selectedCardId === TUTORIAL_CARD_IDS.readyUnit ? FIRST_VICTORY_STEPS.moveUnit : FIRST_VICTORY_STEPS.selectMover;
  }
  return FIRST_VICTORY_STEPS.openHand;
}

function combatStep(game) {
  if (game.tutorial.completed) return COMBAT_STEPS.complete;
  if (game.pendingChoice?.effect === "combatDamage") return COMBAT_STEPS.assignDamage;
  if (game.phase === "showdown") return COMBAT_STEPS.passShowdown;
  const player = tutorialPlayer(game);
  const attackerAtBase = player?.base.some((card) => card.instanceId === TUTORIAL_CARD_IDS.combat.attacker);
  if (attackerAtBase) {
    return game.selectedCardId === TUTORIAL_CARD_IDS.combat.attacker
      ? COMBAT_STEPS.moveAttacker
      : COMBAT_STEPS.selectAttacker;
  }
  return COMBAT_STEPS.complete;
}

function spellStep(game, handOpen) {
  if (game.tutorial.completed) return SPELL_STEPS.complete;
  if (game.pendingChoice?.effect === "declarePlayTarget") return SPELL_STEPS.chooseTarget;
  if (game.pendingPayment) {
    const required = Math.max(0, Number(game.pendingPayment.energyCost) || 0);
    return selectedEnergyCount(game) >= required ? SPELL_STEPS.confirmPayment : SPELL_STEPS.selectRunes;
  }
  const player = tutorialPlayer(game);
  if (player?.hand.some((card) => card.instanceId === TUTORIAL_CARD_IDS.spell.card)) {
    return handOpen ? SPELL_STEPS.playSpell : SPELL_STEPS.openHand;
  }
  return SPELL_STEPS.complete;
}

function powerStep(game, handOpen) {
  if (game.tutorial.completed) return POWER_STEPS.complete;
  if (game.pendingPayment) {
    if (selectedEnergyCount(game) < 5) return POWER_STEPS.selectEnergy;
    if (selectedPowerCount(game) < 1) return POWER_STEPS.selectPower;
    return POWER_STEPS.confirmPayment;
  }
  const player = tutorialPlayer(game);
  if (player?.hand.some((card) => card.instanceId === TUTORIAL_CARD_IDS.power.card)) {
    return handOpen ? POWER_STEPS.playUnit : POWER_STEPS.openHand;
  }
  return POWER_STEPS.complete;
}

function tutorialPlayer(game) {
  return game.players.find((candidate) => candidate.id === game.tutorial.playerId);
}

export function tutorialStep(game, { handOpen = false } = {}) {
  if (!game?.tutorial?.active) return null;
  const welcome = {
    [TUTORIAL_IDS.firstVictory]: FIRST_VICTORY_STEPS.welcome,
    [TUTORIAL_IDS.combat]: COMBAT_STEPS.welcome,
    [TUTORIAL_IDS.spell]: SPELL_STEPS.welcome,
    [TUTORIAL_IDS.power]: POWER_STEPS.welcome
  }[game.tutorial.id];
  if (!game.tutorial.introDismissed) return welcome || FIRST_VICTORY_STEPS.welcome;

  switch (game.tutorial.id) {
    case TUTORIAL_IDS.combat: return combatStep(game);
    case TUTORIAL_IDS.spell: return spellStep(game, handOpen);
    case TUTORIAL_IDS.power: return powerStep(game, handOpen);
    default: return firstVictoryStep(game, handOpen);
  }
}

function allowsFirstVictoryAction(step, action, data) {
  switch (step.id) {
    case "open-hand": return action === "toggle-hand";
    case "play-unit": return action === "begin-play" && data.card === TUTORIAL_CARD_IDS.handUnit && data.destination === "base";
    case "select-runes": return action === "pay-rune" && TUTORIAL_CARD_IDS.runes.includes(data.rune) && data.mode === "energy";
    case "confirm-payment": return (action === "pay-rune" && TUTORIAL_CARD_IDS.runes.includes(data.rune) && data.mode === "energy") || action === "confirm-payment";
    case "select-mover": return action === "select-card" && data.card === TUTORIAL_CARD_IDS.readyUnit;
    case "move-unit": return action === "move" && data.unit === TUTORIAL_CARD_IDS.readyUnit && data.destination === TUTORIAL_CARD_IDS.battlefield;
    case "pass-showdown": return action === "pass-showdown";
    case "end-turn": return action === "end-turn";
    default: return false;
  }
}

function allowsCombatAction(step, action, data) {
  switch (step.id) {
    case "select-attacker": return action === "select-card" && data.card === TUTORIAL_CARD_IDS.combat.attacker;
    case "move-attacker": return action === "move" && data.unit === TUTORIAL_CARD_IDS.combat.attacker && data.destination === TUTORIAL_CARD_IDS.combat.battlefield;
    case "pass-showdown": return action === "pass-showdown";
    case "assign-combat-damage": return action === "choose-effect" && data.choice === TUTORIAL_CARD_IDS.combat.defender;
    default: return false;
  }
}

function allowsSpellAction(step, action, data) {
  switch (step.id) {
    case "open-hand": return action === "toggle-hand";
    case "play-spell": return action === "begin-play" && data.card === TUTORIAL_CARD_IDS.spell.card;
    case "choose-spell-target": return action === "choose-effect" && data.choice === TUTORIAL_CARD_IDS.spell.target;
    case "select-runes": return action === "pay-rune" && TUTORIAL_CARD_IDS.spell.runes.includes(data.rune) && data.mode === "energy";
    case "confirm-payment": return (action === "pay-rune" && TUTORIAL_CARD_IDS.spell.runes.includes(data.rune) && data.mode === "energy") || action === "confirm-payment";
    default: return false;
  }
}

function allowsPowerAction(step, action, data) {
  switch (step.id) {
    case "open-hand": return action === "toggle-hand";
    case "play-power-unit": return action === "begin-play" && data.card === TUTORIAL_CARD_IDS.power.card && data.destination === "base";
    case "select-power-energy": return action === "pay-rune" && TUTORIAL_CARD_IDS.power.runes.includes(data.rune) && data.mode === "energy";
    case "select-domain-power": return action === "pay-rune" && TUTORIAL_CARD_IDS.power.runes.includes(data.rune) && data.mode === "power";
    case "confirm-payment": return action === "confirm-payment" || (action === "pay-rune" && TUTORIAL_CARD_IDS.power.runes.includes(data.rune));
    default: return false;
  }
}

export function tutorialActionAllowed(game, action, data = {}, ui = {}) {
  const step = tutorialStep(game, ui);
  if (!step) return true;
  if (["tutorial-next", "tutorial-exit", "tutorial-restart"].includes(action)) return true;

  switch (game.tutorial.id) {
    case TUTORIAL_IDS.combat: return allowsCombatAction(step, action, data);
    case TUTORIAL_IDS.spell: return allowsSpellAction(step, action, data);
    case TUTORIAL_IDS.power: return allowsPowerAction(step, action, data);
    default: return allowsFirstVictoryAction(step, action, data);
  }
}

function resolveTutorialActionChain(game) {
  let guard = 0;
  while (game.actionChain && guard < 8) {
    const result = passShowdown(game, game.actionChain.priorityPlayerId);
    if (!result.ok) break;
    guard += 1;
  }
}

function completeCombatTutorialIfReady(game, command) {
  if (command.kind === "chooseEffectOption"
    && game.pendingChoice?.effect === "combatDamage"
    && game.pendingChoice.playerId === game.tutorial.opponentId) {
    chooseEffectOption(game, TUTORIAL_CARD_IDS.combat.attacker);
  }
  const player = tutorialPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id === game.tutorial.opponentId);
  if (player?.trash.some((card) => card.instanceId === TUTORIAL_CARD_IDS.combat.attacker)
    && opponent?.trash.some((card) => card.instanceId === TUTORIAL_CARD_IDS.combat.defender)) {
    game.tutorial.completed = true;
  }
}

function completeCardLessonIfReady(game) {
  const player = tutorialPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id === game.tutorial.opponentId);
  if (game.tutorial.id === TUTORIAL_IDS.spell
    && !game.actionChain
    && opponent?.trash.some((card) => card.instanceId === TUTORIAL_CARD_IDS.spell.target)) {
    game.tutorial.completed = true;
  }
  if (game.tutorial.id === TUTORIAL_IDS.power
    && !game.actionChain
    && player?.base.some((card) => card.instanceId === TUTORIAL_CARD_IDS.power.card)) {
    game.tutorial.completed = true;
  }
}

export function advanceTutorialAfterCommand(game, command, result) {
  if (!game?.tutorial?.active || !result?.ok) return;

  if (command.kind === "confirmPayment") resolveTutorialActionChain(game);

  if (command.kind === "passShowdown"
    && game.phase === "showdown"
    && game.showdown?.priorityPlayerId === game.tutorial.opponentId) {
    passShowdown(game, game.tutorial.opponentId);
  }

  if (game.tutorial.id === TUTORIAL_IDS.combat) completeCombatTutorialIfReady(game, command);
  if ([TUTORIAL_IDS.spell, TUTORIAL_IDS.power].includes(game.tutorial.id)) completeCardLessonIfReady(game);

  if (command.kind === "endTurn"
    && game.phase === "action"
    && game.turnPlayerId === game.tutorial.opponentId) {
    endTurn(game);
  }

  if (game.phase === "complete" && game.winnerId === game.tutorial.playerId) {
    game.tutorial.completed = true;
  }
}

export function tutorialProgress(step) {
  if (!step) return { current: 0, total: 1, percent: 0 };
  const total = Math.max(1, Number(step.total) || 1);
  const current = Math.max(1, Math.min(total, Number(step.number) || 1));
  return { current, total, percent: Math.round((current / total) * 100) };
}
