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
    summary: "하단 손패와 명령 바를 사용해 전장을 정복하고 8점 승리까지 진행합니다.",
    englishSummary: "Play a unit, conquer a battlefield, and reach 8 points.",
    focus: "오리진 덱 · 손패 · 명령 바 · 이동 · 득점",
    englishFocus: "Hand · Runes · Movement · Scoring",
    duration: "약 3분",
    englishDuration: "About 3 min"
  },
  {
    id: TUTORIAL_IDS.combat,
    order: 2,
    title: "전투와 피해 배정",
    englishTitle: "Combat and Damage",
    summary: "명령 바에서 결전을 열고 전투 피해 배정 화면을 사용합니다.",
    englishSummary: "Enter an occupied battlefield and assign combat damage.",
    focus: "오리진 덱 · 결전 · 공격 · 방어 · 피해",
    englishFocus: "Showdown · Attack · Defend · Damage",
    duration: "약 2분",
    englishDuration: "About 2 min"
  },
  {
    id: TUTORIAL_IDS.spell,
    order: 3,
    title: "주문과 대상 지정",
    englishTitle: "Spells and Targets",
    summary: "보드에서 주문 대상을 선택·확인하고 룬 비용을 지불합니다.",
    englishSummary: "Choose a target, pay for a damage spell, and resolve it.",
    focus: "오리진 덱 · 주문 · 대상 · 체인 · 처치",
    englishFocus: "Spells · Targets · Chain · Kills",
    duration: "약 2분",
    englishDuration: "About 2 min"
  },
  {
    id: TUTORIAL_IDS.power,
    order: 4,
    title: "에너지와 힘",
    englishTitle: "Energy and Power",
    summary: "클릭·짧게 누르기로 에너지를, 오른쪽 클릭·길게 누르기로 힘을 지불합니다.",
    englishSummary: "Learn the difference between exhausting for Energy and recycling for Power.",
    focus: "오리진 덱 · 비용 지불 바 · 에너지 · 힘 · 재활용",
    englishFocus: "Costs · Domains · Exhaust · Recycle",
    duration: "약 2분",
    englishDuration: "About 2 min"
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
  welcome: lessonStep("welcome", 1, 7, "첫 승리까지 함께 해볼까요?", "리프트바운드는 전장을 차지해 8점을 먼저 만드는 게임입니다. 실제 대전 화면처럼 상대 영역은 위, 전장은 중앙, 내 룬·기지·손패는 아래에 있습니다. 카드 사용부터 점거 득점까지 차례로 연습합니다.", "안내 패널 아래의 ‘연습 시작’을 눌러 주세요.", "연습 시작"),
  openHand: lessonStep("open-hand", 2, 7, "화면 아래 손패를 펼치세요", "손패는 화면 맨 아래에 항상 보입니다. 손패 머리글의 ‘손패’ 버튼이나 명령 바의 ‘행동 사용’을 누르면 카드가 더 크게 펼쳐져 선택하기 쉬워집니다.", "하단 손패의 ‘손패’ 또는 명령 바의 ‘행동 사용’을 눌러 주세요."),
  playUnit: lessonStep("play-unit", 3, 7, "명령 바에서 유닛을 사용하세요", "손패 카드를 선택하면 손패 바로 위 명령 바에 가능한 행동이 표시됩니다. 에너지 2가 필요한 레이븐블룸 학생이 이미 선택되어 있습니다.", "하단 명령 바의 ‘기지에 사용’을 눌러 주세요."),
  selectRunes: lessonStep("select-runes", 4, 7, "룬 카드로 에너지를 지불하세요", "비용 지불 바가 열렸습니다. 준비된 룬 1장을 클릭하거나 짧게 누르면 탈진하고 에너지 1을 냅니다.", "내 룬 영역에서 강조된 룬 2장을 차례로 클릭하거나 짧게 눌러 주세요."),
  confirmPayment: lessonStep("confirm-payment", 4, 7, "비용 지불을 확인하세요", "에너지 2를 모두 골라 비용 지불 바의 버튼이 ‘확인’으로 바뀌었습니다. 확인하면 유닛이 기지에 들어오며, 새로 사용한 유닛은 이번 턴에 이동할 수 없습니다.", "비용 지불 바의 ‘확인’을 눌러 주세요."),
  selectMover: lessonStep("select-mover", 5, 7, "내 기지의 준비된 유닛을 선택하세요", "보드 아래쪽 내 기지에는 방금 사용한 탈진 유닛과 처음부터 준비되어 있던 유닛이 있습니다. 이동할 강직한 포로 카드를 선택하세요.", "내 기지에서 금색으로 강조된 강직한 포로 카드를 눌러 주세요."),
  moveUnit: lessonStep("move-unit", 5, 7, "명령 바에서 개방 전장으로 이동하세요", "유닛을 선택하면 손패 위 명령 바에 이동 목적지가 표시됩니다. 개방 전장으로 이동하면 유닛이 탈진하고 결전이 시작됩니다.", "하단 명령 바의 ‘1번 전장으로 이동’을 눌러 주세요."),
  passShowdown: lessonStep("pass-showdown", 6, 7, "결전의 포커스를 넘기세요", "결전 명령 바의 버튼은 상황에 따라 이름이 바뀝니다. 지금은 추가 행동이 없으므로 ‘포커스 패스’를 누르면 훈련 상대도 자동으로 패스하고 개방 전장을 정복합니다.", "하단 명령 바에서 금색으로 강조된 ‘포커스 패스’를 눌러 주세요."),
  endTurn: lessonStep("end-turn", 7, 7, "오른쪽 메뉴에서 턴을 종료하세요", "전장을 정복해 7점이 되었습니다. 턴을 종료하면 훈련 상대의 턴이 자동으로 지나가고, 다음 내 턴 시작에 점거 점수를 얻습니다.", "화면 오른쪽 세로 보조 메뉴의 ‘턴 종료’를 눌러 주세요."),
  complete: lessonStep("complete", 7, 7, "첫 승리를 완성했습니다!", "정복으로 1점, 다음 턴 점거로 1점을 얻어 8점에 도달했습니다. 실제 게임에서도 ‘유닛 사용 → 이동 → 결전 → 점거’ 흐름과 하단 명령 바를 활용할 수 있습니다.", "다른 튜토리얼을 선택하거나 이 과정을 다시 연습할 수 있습니다.")
});

const COMBAT_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 5, "상대가 점거한 전장에서 싸워봅시다", "상대가 점거한 전장에 유닛을 보내면 결전이 열립니다. 양쪽이 패스하면 화면 아래에 전투 피해 배정 화면이 열립니다.", "안내 패널 아래의 ‘전투 시작’을 눌러 주세요.", "전투 시작"),
  selectAttacker: lessonStep("select-attacker", 2, 5, "내 기지에서 공격할 유닛을 선택하세요", "보드 아래쪽 내 기지의 강직한 포로는 준비 상태입니다. 준비된 유닛만 전장으로 이동할 수 있습니다.", "내 기지에서 금색으로 강조된 강직한 포로 카드를 눌러 주세요."),
  moveAttacker: lessonStep("move-attacker", 3, 5, "명령 바에서 상대 전장으로 이동하세요", "유닛을 선택하면 손패 위 명령 바에 이동 목적지가 표시됩니다. 레이븐블룸 학생이 있는 전장으로 진입하면 결전이 시작됩니다.", "하단 명령 바의 ‘1번 전장으로 이동’을 눌러 주세요."),
  passShowdown: lessonStep("pass-showdown", 4, 5, "결전의 포커스를 넘기세요", "결전 중에는 행동이나 반응을 추가할 수 있습니다. 이번에는 ‘포커스 패스’를 눌러 훈련 상대의 패스까지 진행하고 피해 배정 단계로 넘어갑니다.", "하단 명령 바에서 금색으로 강조된 ‘포커스 패스’를 눌러 주세요."),
  assignDamage: lessonStep("assign-combat-damage", 5, 5, "전투 피해를 배정하세요", "화면 아래 ‘전투 피해 배정’ 화면에서 내 총 위력 2를 적 유닛에게 배정합니다. 위력 2인 적 유닛에게 2의 피해를 입히면 처치할 수 있습니다.", "피해 배정 화면의 레이븐블룸 학생 카드를 눌러 주세요."),
  complete: lessonStep("complete", 5, 5, "전투 피해 배정을 마쳤습니다!", "상대도 동시에 피해를 배정해 두 유닛이 함께 처치되었습니다. 결전에서는 공격자와 방어자 양쪽의 위력, 피해 우선순위와 생존 여부를 함께 계산해야 합니다.", "튜토리얼 메뉴에서 다음 과정을 선택할 수 있습니다.")
});

const SPELL_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 6, "주문으로 적 유닛을 처치해봅시다", "주문은 해결된 뒤 폐기장으로 갑니다. 대상이 필요한 주문은 보드에서 카드를 선택한 뒤 하단 대상 선택 바에서 확인하고, 그다음 비용을 지불합니다.", "안내 패널 아래의 ‘주문 연습 시작’을 눌러 주세요.", "주문 연습 시작"),
  openHand: lessonStep("open-hand", 2, 6, "화면 아래 손패를 펼치세요", "이번 손패에는 적 유닛에게 2의 피해를 입히는 소각이 있습니다. 손패 머리글의 ‘손패’ 또는 명령 바의 ‘행동 사용’으로 펼칠 수 있습니다.", "하단 손패의 ‘손패’ 또는 명령 바의 ‘행동 사용’을 눌러 주세요."),
  playSpell: lessonStep("play-spell", 3, 6, "명령 바에서 소각을 시전하세요", "주문 카드를 선택하면 손패 위 명령 바에 ‘시전’이 표시됩니다. 주문은 기지에 남지 않으며, 비용 지불 전에 대상을 먼저 정합니다.", "하단 명령 바에서 금색으로 강조된 ‘시전’을 눌러 주세요."),
  chooseTarget: lessonStep("choose-spell-target", 4, 6, "보드에서 주문 대상을 선택하세요", "중앙 보드에서 피해를 받을 적 레이븐블룸 학생 카드를 선택합니다. 선택한 대상은 화면 아래 대상 선택 바에 표시됩니다.", "보드에서 금색으로 강조된 레이븐블룸 학생 카드를 눌러 주세요."),
  confirmTarget: lessonStep("confirm-spell-target", 4, 6, "선택한 주문 대상을 확인하세요", "화면 아래 대상 선택 바에 레이븐블룸 학생이 선택되어 있습니다. 확인해야 대상 선언이 끝나고 비용 지불로 넘어갑니다.", "대상 선택 바의 ‘확인 · 레이븐블룸 학생’을 눌러 주세요."),
  selectRunes: lessonStep("select-runes", 5, 6, "룬 카드로 에너지 2를 지불하세요", "소각의 에너지 비용은 2입니다. 내 룬 영역에서 준비된 룬 2장을 차례로 클릭하거나 짧게 눌러 주세요.", "금색으로 강조된 룬 2장을 클릭하거나 짧게 눌러 주세요."),
  confirmPayment: lessonStep("confirm-payment", 5, 6, "주문 비용 지불을 확인하세요", "비용을 모두 골라 비용 지불 바의 버튼이 ‘확인’으로 바뀌었습니다. 확인하면 주문이 체인에 올라가고 양쪽이 대응할 기회를 얻습니다.", "비용 지불 바의 ‘확인’을 눌러 주세요."),
  complete: lessonStep("complete", 6, 6, "주문이 해결되었습니다!", "양쪽이 자동으로 패스해 소각이 2의 피해를 입혔고, 위력 2인 레이븐블룸 학생이 처치되었습니다. 해결된 주문은 내 폐기장으로 이동했습니다.", "튜토리얼 메뉴에서 다음 과정을 선택할 수 있습니다.")
});

const POWER_STEPS = Object.freeze({
  welcome: lessonStep("welcome", 1, 6, "에너지와 힘의 차이를 배워봅시다", "에너지는 룬을 탈진하고, 힘은 필요한 영역의 룬을 룬 덱 아래로 재활용합니다. 하나의 룬은 같은 비용에서 에너지와 힘을 함께 낼 수도 있습니다.", "안내 패널 아래의 ‘비용 연습 시작’을 눌러 주세요.", "비용 연습 시작"),
  openHand: lessonStep("open-hand", 2, 6, "화면 아래 손패를 펼치세요", "애니, 화염은 에너지 5와 분노 힘 1이 모두 필요합니다. 손패 머리글의 ‘손패’ 또는 명령 바의 ‘행동 사용’으로 펼칠 수 있습니다.", "하단 손패의 ‘손패’ 또는 명령 바의 ‘행동 사용’을 눌러 주세요."),
  playUnit: lessonStep("play-power-unit", 3, 6, "명령 바에서 애니, 화염을 사용하세요", "복합 비용은 에너지와 힘을 모두 충족해야 합니다. 애니, 화염이 이미 선택되어 있으므로 손패 위 명령 바에서 사용할 수 있습니다.", "하단 명령 바의 ‘기지에 사용’을 눌러 주세요."),
  selectEnergy: lessonStep("select-power-energy", 4, 6, "에너지 5를 선택하세요", "내 룬 영역의 준비된 분노 룬 5장을 차례로 클릭하거나 짧게 누릅니다. 에너지로 선택한 룬은 비용을 확인할 때 탈진합니다.", "금색으로 강조된 분노 룬 5장을 클릭하거나 짧게 눌러 주세요."),
  selectPower: lessonStep("select-domain-power", 5, 6, "분노 힘 1을 선택하세요", "같은 룬이 에너지로 선택되어 있어도 힘으로 함께 사용할 수 있습니다. PC에서는 오른쪽 클릭, 터치 화면에서는 길게 누르세요. 키보드에서는 룬에 초점을 두고 Shift+Enter를 누르면 됩니다.", "강조된 분노 룬 1장을 오른쪽 클릭하거나 길게 누르거나, 키보드에서 Shift+Enter를 눌러 주세요."),
  confirmPayment: lessonStep("confirm-payment", 5, 6, "복합 비용 지불을 확인하세요", "에너지 5와 분노 힘 1을 모두 충족해 비용 지불 바의 버튼이 ‘확인’으로 바뀌었습니다. 힘으로 낸 룬은 룬 덱 아래로 재활용되고 나머지 룬은 탈진합니다.", "비용 지불 바의 ‘확인’을 눌러 주세요."),
  complete: lessonStep("complete", 6, 6, "에너지와 힘 지불을 마쳤습니다!", "애니, 화염이 기지에 들어왔습니다. 에너지는 룬의 준비 상태를 소비하고, 힘은 영역 조건을 확인한 뒤 룬 자체를 룬 덱으로 재활용한다는 차이를 기억하세요.", "튜토리얼 메뉴에서 다른 과정을 선택할 수 있습니다.")
});

const ENGLISH_TUTORIAL_STEPS = Object.freeze({
  [TUTORIAL_IDS.firstVictory]: Object.freeze({
    welcome: englishLessonStep(
      "Let’s earn your first victory",
      "Riftbound is a race to 8 points by conquering and holding battlefields. The opponent’s area is at the top, the battlefields are in the center, and your Runes, Base, and Hand are at the bottom. You’ll practice playing a card, moving a unit, winning a Showdown, and scoring for holding a battlefield.",
      "Select ‘Start Practice’ below the guide panel.",
      "Start Practice"
    ),
    "open-hand": englishLessonStep(
      "Open your Hand at the bottom",
      "Your Hand stays visible along the bottom edge. Select ‘Hand’ in its header or ‘Play Action’ in the command bar to expand your cards and make them easier to choose.",
      "Select ‘Hand’ at the bottom or ‘Play Action’ in the command bar."
    ),
    "play-unit": englishLessonStep(
      "Play a unit from the command bar",
      "When you select a card in your Hand, its available commands appear in the bar just above it. Ravenbloom Student, which costs 2 Energy, is already selected.",
      "Select the highlighted ‘Play to Base’ command."
    ),
    "select-runes": englishLessonStep(
      "Pay Energy with your Runes",
      "The payment bar is open. Clicking or tapping a ready Rune selects it for 1 Energy; that Rune exhausts when you confirm the payment.",
      "Click or tap the two highlighted Runes in your Rune area."
    ),
    "confirm-payment": englishLessonStep(
      "Confirm the payment",
      "You have selected all 2 Energy, so the button in the payment bar now reads ‘Confirm.’ The unit will enter your Base, and a unit played this turn cannot move during the same turn.",
      "Select ‘Confirm’ in the payment bar."
    ),
    "select-mover": englishLessonStep(
      "Select the ready unit in your Base",
      "Your Base now contains the exhausted unit you just played and a unit that began ready. Select Stalwart Poro as the unit to move.",
      "Select the highlighted Stalwart Poro in your Base."
    ),
    "move-unit": englishLessonStep(
      "Move to the open battlefield",
      "Once the unit is selected, its destinations appear in the command bar above your Hand. Moving into the open battlefield exhausts the unit and begins a Showdown.",
      "Select ‘Move to Field 1’ in the command bar."
    ),
    "pass-showdown": englishLessonStep(
      "Pass the Showdown focus",
      "The Showdown command changes with the current state. You have no more actions to add, so selecting ‘Pass Focus’ lets the training opponent pass as well and allows you to conquer the open battlefield.",
      "Select the highlighted ‘Pass Focus’ command."
    ),
    "end-turn": englishLessonStep(
      "End the turn from the right rail",
      "Conquering the battlefield raised your score to 7. When you end the turn, the training opponent’s turn passes automatically, and you score for holding the battlefield at the start of your next turn.",
      "Select ‘End Turn’ on the right utility rail."
    ),
    complete: englishLessonStep(
      "You earned your first victory!",
      "You gained 1 point for conquering and 1 point for holding the battlefield, reaching 8 points. In a full match, you can use the same play → move → Showdown → hold sequence from the command bar.",
      "Choose another lesson or practice this one again."
    )
  }),
  [TUTORIAL_IDS.combat]: Object.freeze({
    welcome: englishLessonStep(
      "Fight at a battlefield your opponent holds",
      "Moving a unit into a battlefield held by your opponent begins a Showdown. After both players pass, the Combat damage assignment drawer opens at the bottom of the screen.",
      "Select ‘Start Combat’ below the guide panel.",
      "Start Combat"
    ),
    "select-attacker": englishLessonStep(
      "Select the unit that will attack",
      "Stalwart Poro in your Base is ready. Only ready units can move to a battlefield.",
      "Select the highlighted Stalwart Poro in your Base."
    ),
    "move-attacker": englishLessonStep(
      "Move into the opponent’s battlefield",
      "After selecting the unit, its destination appears in the command bar above your Hand. Entering the battlefield occupied by Ravenbloom Student begins a Showdown.",
      "Select ‘Move to Field 1’ in the command bar."
    ),
    "pass-showdown": englishLessonStep(
      "Pass the Showdown focus",
      "Players may add actions or reactions during a Showdown. For this lesson, select ‘Pass Focus’; the training opponent will also pass, advancing the game to combat damage assignment.",
      "Select the highlighted ‘Pass Focus’ command."
    ),
    "assign-combat-damage": englishLessonStep(
      "Assign combat damage",
      "In the Combat damage assignment drawer at the bottom, assign your unit’s total 2 Might to the opposing Ravenbloom Student. Dealing 2 damage to this 2-Might unit defeats it.",
      "Select Ravenbloom Student in the combat damage drawer."
    ),
    complete: englishLessonStep(
      "Combat damage is assigned",
      "Your opponent assigned damage at the same time, so both units were defeated. In combat, consider each side’s Might, damage assignment order, and which units will survive.",
      "Choose the next lesson from the tutorial menu."
    )
  }),
  [TUTORIAL_IDS.spell]: Object.freeze({
    welcome: englishLessonStep(
      "Defeat an enemy unit with a spell",
      "A spell moves to the Trash after it resolves. For a spell that needs a target, first select a card on the board, confirm it in the target bar at the bottom, and then pay the spell’s cost.",
      "Select ‘Start Spell Practice’ below the guide panel.",
      "Start Spell Practice"
    ),
    "open-hand": englishLessonStep(
      "Open your Hand at the bottom",
      "Your Hand contains Incinerate, a spell that deals 2 damage to an enemy unit. Expand your Hand with ‘Hand’ in its header or ‘Play Action’ in the command bar.",
      "Select ‘Hand’ at the bottom or ‘Play Action’ in the command bar."
    ),
    "play-spell": englishLessonStep(
      "Cast Incinerate from the command bar",
      "When you select a spell in your Hand, ‘Cast’ appears in the command bar above it. Spells do not remain in your Base, and this spell requires you to declare its target before paying.",
      "Select the highlighted ‘Cast’ command."
    ),
    "choose-spell-target": englishLessonStep(
      "Choose the spell’s target on the board",
      "Select the opposing Ravenbloom Student on the center board. The selected card will appear in the target confirmation bar at the bottom.",
      "Select the highlighted Ravenbloom Student on the board."
    ),
    "confirm-spell-target": englishLessonStep(
      "Confirm the spell’s target",
      "Ravenbloom Student is now staged in the target confirmation bar. Confirming it completes the target declaration and advances to payment.",
      "Select ‘Confirm · Ravenbloom Student’ in the target confirmation bar."
    ),
    "select-runes": englishLessonStep(
      "Pay 2 Energy with your Runes",
      "Incinerate costs 2 Energy. Click or tap two ready Runes in your Rune area to select them for payment.",
      "Click or tap the two highlighted Runes."
    ),
    "confirm-payment": englishLessonStep(
      "Confirm the spell’s payment",
      "You have selected the full cost, so the button in the payment bar now reads ‘Confirm.’ Confirming adds the spell to the Chain and gives both players a chance to respond.",
      "Select ‘Confirm’ in the payment bar."
    ),
    complete: englishLessonStep(
      "The spell resolved",
      "Both players passed automatically, so Incinerate dealt 2 damage and defeated the 2-Might Ravenbloom Student. The resolved spell then moved to your Trash.",
      "Choose the next lesson from the tutorial menu."
    )
  }),
  [TUTORIAL_IDS.power]: Object.freeze({
    welcome: englishLessonStep(
      "Learn the difference between Energy and Power",
      "Paying Energy exhausts Runes, while paying Power recycles Runes of the required domain to the bottom of your Rune Deck. A single Rune may contribute both Energy and Power toward the same cost.",
      "Select ‘Start Payment Practice’ below the guide panel.",
      "Start Payment Practice"
    ),
    "open-hand": englishLessonStep(
      "Open your Hand at the bottom",
      "Annie, Fiery costs 5 Energy and 1 Fury Power. Expand your Hand with ‘Hand’ in its header or ‘Play Action’ in the command bar.",
      "Select ‘Hand’ at the bottom or ‘Play Action’ in the command bar."
    ),
    "play-power-unit": englishLessonStep(
      "Play Annie, Fiery from the command bar",
      "A combined cost must satisfy both its Energy and Power requirements. Annie, Fiery is already selected, so its play command is available above your Hand.",
      "Select the highlighted ‘Play to Base’ command."
    ),
    "select-power-energy": englishLessonStep(
      "Select 5 Energy",
      "Click or tap the five ready Fury Runes in your Rune area. Runes selected for Energy exhaust when you confirm the payment.",
      "Click or tap all five highlighted Fury Runes."
    ),
    "select-domain-power": englishLessonStep(
      "Select 1 Fury Power",
      "A Rune already selected for Energy can also pay Power toward the same cost. Right-click it on a PC, touch and hold it on a touch screen, or focus it and press Shift+Enter with a keyboard.",
      "Use right-click, touch and hold, or Shift+Enter on one highlighted Fury Rune."
    ),
    "confirm-payment": englishLessonStep(
      "Confirm the combined payment",
      "You have satisfied both 5 Energy and 1 Fury Power, so the payment button now reads ‘Confirm.’ The Rune used for Power is recycled to the bottom of your Rune Deck, while the remaining selected Runes exhaust.",
      "Select ‘Confirm’ in the payment bar."
    ),
    complete: englishLessonStep(
      "Energy and Power are paid",
      "Annie, Fiery entered your Base. Remember the difference: Energy uses a Rune’s ready state, while Power checks its domain and recycles the Rune itself to the Rune Deck.",
      "Choose another lesson from the tutorial menu."
    )
  })
});

const TUTORIAL_STEP_SETS = Object.freeze({
  [TUTORIAL_IDS.firstVictory]: FIRST_VICTORY_STEPS,
  [TUTORIAL_IDS.combat]: COMBAT_STEPS,
  [TUTORIAL_IDS.spell]: SPELL_STEPS,
  [TUTORIAL_IDS.power]: POWER_STEPS
});

function lessonStep(id, number, total, title, body, hint, actionLabel = null) {
  return Object.freeze({ id, number, total, title, body, hint, actionLabel });
}

function englishLessonStep(title, body, hint, actionLabel = null) {
  return Object.freeze({ title, body, hint, actionLabel });
}

export function localizeTutorialStep(step, tutorialId, language = "ko") {
  if (!step || language === "ko") return step;
  const copy = ENGLISH_TUTORIAL_STEPS[tutorialId]?.[step.id];
  return copy ? Object.freeze({ ...step, ...copy }) : step;
}

export function tutorialLessonSteps(tutorialId, language = "ko") {
  return Object.values(TUTORIAL_STEP_SETS[tutorialId] || [])
    .map((step) => localizeTutorialStep(step, tutorialId, language));
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

function spellStep(game, handOpen, stagedChoiceId) {
  if (game.tutorial.completed) return SPELL_STEPS.complete;
  if (game.pendingChoice?.effect === "declarePlayTarget") {
    return stagedChoiceId === TUTORIAL_CARD_IDS.spell.target
      ? SPELL_STEPS.confirmTarget
      : SPELL_STEPS.chooseTarget;
  }
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
    const requiredEnergy = Math.max(0, Number(game.pendingPayment.energyCost) || 0);
    const requiredPower = (game.pendingPayment.powerCost || [])
      .reduce((total, requirement) => total + Math.max(0, Number(requirement?.amount) || 0), 0);
    if (selectedEnergyCount(game) < requiredEnergy) return POWER_STEPS.selectEnergy;
    if (selectedPowerCount(game) < requiredPower) return POWER_STEPS.selectPower;
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

export function tutorialStep(game, { handOpen = false, stagedChoiceId = null } = {}) {
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
    case TUTORIAL_IDS.spell: return spellStep(game, handOpen, stagedChoiceId);
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
    case "confirm-spell-target": return action === "choose-effect" && data.choice === TUTORIAL_CARD_IDS.spell.target;
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
