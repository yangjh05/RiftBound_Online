export const DOMAINS = {
  BODY: "Body",
  CALM: "Calm",
  CHAOS: "Chaos",
  FURY: "Fury",
  MIND: "Mind",
  ORDER: "Order",
  ANY: "Any"
};

export const RUNE_COLORS = {
  [DOMAINS.BODY]: "#e07a2f",
  [DOMAINS.CALM]: "#4fa96b",
  [DOMAINS.CHAOS]: "#8f45c7",
  [DOMAINS.FURY]: "#d94a38",
  [DOMAINS.MIND]: "#3f8fce",
  [DOMAINS.ORDER]: "#d7b544",
  [DOMAINS.ANY]: "#e9e2d1"
};

export function normalizeCardNumber(data) {
  const source = data.cardNumber || data.collectorNumber || "";
  const match = String(source).match(/^([A-Z]{3}-[A-Z0-9]+[a-z]?\/\d+)/);
  if (match) return match[1];
  const id = data.id || "";
  const total = String(data.collectorNumber || "").match(/\/(\d+)/)?.[1];
  return id && total ? `${id}/${total}` : id;
}

export function card(data) {
  const cardNumber = normalizeCardNumber(data);
  const basicRuneDomain = data.type === "rune" && data.tags?.includes("Basic Rune")
    ? data.domains?.[0]
    : null;
  const implicitBasicRuneEffects = basicRuneDomain && !(data.effects || []).length
    ? [
        {
          timing: "activated",
          kind: "addEnergy",
          abilityId: "basic-rune-energy",
          amount: 1,
          exhaust: true,
          abilityKeywords: ["Reaction"]
        },
        {
          timing: "activated",
          kind: "addPower",
          abilityId: "basic-rune-power",
          amount: 1,
          domain: basicRuneDomain,
          exhaust: false,
          recycleSelfCost: true,
          abilityKeywords: ["Reaction"]
        }
      ]
    : null;
  return {
    domains: [],
    keywords: [],
    tags: [],
    power: [],
    cardNumber,
    ...data,
    effects: implicitBasicRuneEffects || data.effects || []
  };
}
