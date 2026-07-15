const unitToken = (id, name, might, tags = [], keywords = [], text = "") => ({
  id: `TOKEN-${id}`,
  cardNumber: `TOKEN-${id}`,
  collectorNumber: `TOKEN-${id}`,
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
  effects: [],
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

export const OFFICIAL_TOKEN_DEFINITIONS = Object.freeze({
  recruit: unitToken("RECRUIT", "Recruit", 1, ["Recruit"]),
  sprite: unitToken(
    "SPRITE",
    "Sprite",
    3,
    ["Fae"],
    ["Temporary"],
    "TEMPORARY (Kill me at the start of my controller's Beginning Phase, before scoring.)"
  ),
  sandSoldier: unitToken("SAND-SOLDIER", "Sand Soldier", 2, ["Shurima"]),
  mech: unitToken("MECH", "Mech", 3, ["Mech"]),
  gold: {
    id: "TOKEN-GOLD",
    cardNumber: "TOKEN-GOLD",
    collectorNumber: "TOKEN-GOLD",
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
      abilityKeywords: ["Reaction"],
      exhaust: true,
      killSelfCost: true,
      nonReactive: true
    }],
    isToken: true
  },
  reflection: unitToken("REFLECTION", "Reflection", 0),
  bird: unitToken("BIRD", "Bird", 1, ["Bird"], ["Deflect"], "DEFLECT"),
  brush: battlefieldToken(
    "BRUSH",
    "Brush",
    "Bird, Cat, Dog, Poro, and Ivern units here have +1 Might. When you score here, you may replace this with the battlefield it replaced.",
    [
      { timing: "static", kind: "taggedUnitsHereMight", tags: ["Bird", "Cat", "Dog", "Poro", "Ivern"], amount: 1 },
      { timing: "score", kind: "swapBackReplacedBattlefield", optional: true }
    ]
  ),
  baronPit: battlefieldToken(
    "BARON-PIT",
    "Baron Pit",
    "Units can move here from anywhere.",
    [{ timing: "static", kind: "unitsCanMoveHereFromAnywhere" }]
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
