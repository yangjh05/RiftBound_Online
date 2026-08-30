const tokenKindFromId = (id) => String(id).toLowerCase()
  .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

const unitToken = (id, name, might, tags = [], keywords = [], text = "", effects = []) => ({
  id: `TOKEN-${id}`,
  cardNumber: `TOKEN-${id}`,
  collectorNumber: `TOKEN-${id}`,
  tokenKind: tokenKindFromId(id),
  name,
  type: "unit",
  set: "Core Rules",
  rarity: "Token",
  domains: [],
  superTypes: ["Token"],
  tags,
  keywords,
  energy: 0,
  power: [],
  might,
  text,
  effects,
  isToken: true
});

const battlefieldToken = (id, name, text, effects) => ({
  id: `TOKEN-${id}`,
  cardNumber: `TOKEN-${id}`,
  collectorNumber: `TOKEN-${id}`,
  name,
  type: "battlefield",
  set: "Core Rules",
  rarity: "Token",
  domains: [],
  superTypes: ["Token"],
  tags: [],
  keywords: [],
  power: [],
  text,
  effects,
  isToken: true
});

const withKoreanPresentation = (definition, image, name, text = "(규칙 문구 없음)") => ({
  ...definition,
  image,
  translations: {
    ko: {
      name,
      text
    }
  }
});

export const OFFICIAL_TOKEN_DEFINITIONS = Object.freeze({
  recruit: withKoreanPresentation(
    unitToken("RECRUIT", "Recruit", 1, ["Recruit"]),
    "https://cdn.piltoverarchive.com/cards/OGN-273.webp",
    "신병"
  ),
  sprite: withKoreanPresentation(
    unitToken(
      "SPRITE",
      "Sprite",
      3,
      ["Fae"],
      ["Temporary"],
      "TEMPORARY (Kill me at the start of my controller's Beginning Phase, before scoring.)"
    ),
    "https://cdn.piltoverarchive.com/cards/UNL-T07.webp",
    "스프라이트",
    "[일시적] (그 조종자의 시작 단계 시작 시, 득점 전에 이 카드를 처치합니다.)"
  ),
  sandSoldier: withKoreanPresentation(
    unitToken("SAND-SOLDIER", "Sand Soldier", 2, ["Shurima"]),
    "https://cdn.piltoverarchive.com/cards/SFD-T02.webp",
    "모래 병사"
  ),
  mech: withKoreanPresentation(
    unitToken("MECH", "Mech", 3, ["Mech"]),
    "https://cdn.piltoverarchive.com/cards/SFD-T01.webp",
    "기계"
  ),
  tentacle: withKoreanPresentation(
    unitToken("TENTACLE", "Tentacle", 1, ["Bilgewater"]),
    "https://cdn.piltoverarchive.com/cards/VEN-T06.webp",
    "촉수"
  ),
  shadowClone: withKoreanPresentation(
    unitToken(
      "SHADOW-CLONE",
      "Shadow Clone",
      0,
      [],
      [],
      "When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.",
      [{
        timing: "attack",
        kind: "banishOwnTrashUnitGiveSelfKeyword",
        keywords: ["Assault"],
        keywordAmounts: { Assault: 4 },
        temporary: true,
        optional: true
      }]
    ),
    "https://cdn.piltoverarchive.com/cards/VEN-T05.webp",
    "그림자 분신",
    "이 카드가 공격하면, 내 폐기장의 유닛 1장을 추방할 수 있습니다. 그렇게 하면, 이번 턴에 이 카드에게 [맹공 4]를 부여합니다."
  ),
  gold: withKoreanPresentation(
    {
      id: "TOKEN-GOLD",
      cardNumber: "TOKEN-GOLD",
      collectorNumber: "TOKEN-GOLD",
      tokenKind: "gold",
      name: "Gold",
      type: "gear",
      set: "Core Rules",
      rarity: "Token",
      domains: [],
      superTypes: ["Token"],
      tags: [],
      keywords: [],
      energy: 0,
      power: [],
      text: "REACTION — Kill this, Exhaust: ADD 1 universal Power.",
      effects: [{
        timing: "activated",
        kind: "addPower",
        amount: 1,
        domain: "Any",
        resourceKind: "gold",
        abilityKeywords: ["Reaction"],
        exhaust: true,
        killSelfCost: true,
        nonReactive: true
      }],
      isToken: true
    },
    "https://cdn.piltoverarchive.com/cards/UNL-T05.webp",
    "골드",
    "[반응] — 이 카드를 처치하고 탈진: 범용 힘 1을 [추가]합니다. (자원을 추가하는 스킬에는 반응할 수 없습니다.)"
  ),
  reflection: withKoreanPresentation(
    unitToken(
      "REFLECTION",
      "Reflection",
      0,
      [],
      [],
      "I become a copy of something when played. I don't get that card's play effects."
    ),
    "https://cdn.piltoverarchive.com/cards/UNL-T06.webp",
    "환영",
    "이 카드를 사용할 때 다른 대상을 복사합니다. 그 카드의 사용 효과는 얻지 않습니다."
  ),
  bird: withKoreanPresentation(
    unitToken("BIRD", "Bird", 1, ["Bird"], ["Deflect"], "DEFLECT"),
    "https://cdn.piltoverarchive.com/cards/UNL-T02.webp",
    "새",
    "[굴절] (상대가 주문 또는 스킬로 이 카드를 대상으로 선택하려면 힘 1을 지불해야 합니다.)"
  ),
  brush: withKoreanPresentation(
    battlefieldToken(
      "BRUSH",
      "Brush",
      "Bird, Cat, Dog, Poro, and Ivern units here have +1 Might. When you score here, you may replace this with the battlefield it replaced.",
      [
        { timing: "static", kind: "taggedUnitsHereMight", tags: ["Bird", "Cat", "Dog", "Poro", "Ivern"], amount: 1 },
        { timing: "score", kind: "swapBackReplacedBattlefield", optional: true }
      ]
    ),
    "https://cdn.piltoverarchive.com/cards/UNL-T03.webp",
    "수풀",
    "이곳의 새, 고양이, 개, 포로, 아이번 유닛은 위력 +1을 가집니다. 이곳에서 득점하면, 이 전장을 이 전장이 대체했던 전장으로 되돌릴 수 있습니다."
  ),
  baronPit: withKoreanPresentation(
    battlefieldToken(
      "BARON-PIT",
      "Baron Pit",
      "Units can move here from anywhere.",
      [{ timing: "static", kind: "unitsCanMoveHereFromAnywhere" }]
    ),
    "https://cdn.piltoverarchive.com/cards/UNL-T01.webp",
    "내셔 남작 둥지",
    "유닛은 어디서든 이곳으로 이동할 수 있습니다."
  )
});

const TOKEN_ALIASES = Object.freeze({
  "sand soldier": "sandSoldier",
  sandsoldier: "sandSoldier",
  "baron pit": "baronPit",
  baronpit: "baronPit"
});

export function officialTokenDefinition(kind) {
  if (!kind) return null;
  const raw = String(kind).trim();
  const key = OFFICIAL_TOKEN_DEFINITIONS[raw]
    ? raw
    : TOKEN_ALIASES[raw.toLowerCase()] || raw.toLowerCase();
  return OFFICIAL_TOKEN_DEFINITIONS[key] || null;
}

export function officialTokenKinds() {
  return Object.keys(OFFICIAL_TOKEN_DEFINITIONS);
}
