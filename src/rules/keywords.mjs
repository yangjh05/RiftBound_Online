export const STACKING_VALUE_KEYWORDS = Object.freeze(new Set([
  "assault",
  "deflect",
  "hunt",
  "shield"
]));

const REDUNDANT_KEYWORDS = Object.freeze(new Set([
  "accelerate",
  "ambush",
  "backline",
  "ganking",
  "hidden",
  "quick-draw",
  "reaction",
  "tank",
  "temporary",
  "unique"
]));

export const KEYWORD_PLAY_EFFECT_SPECS = Object.freeze([
  Object.freeze({ keyword: "Vision", timing: "keyword", kind: "predict", optional: true, repeatable: true }),
  Object.freeze({ keyword: "Quick-Draw", timing: "keyword", kind: "quickDrawAttach", optional: false }),
  Object.freeze({ keyword: "Weaponmaster", timing: "keyword", kind: "weaponmaster", optional: true, repeatable: true })
]);

export const KEYWORD_BEHAVIOR_EFFECT_SPECS = Object.freeze([
  ...KEYWORD_PLAY_EFFECT_SPECS,
  Object.freeze({ keyword: "Hunt", timing: "keyword", kind: "huntGainXp", numeric: true })
]);

export const CARD_REACTION_PERMISSION_KINDS = Object.freeze([
  "reaction",
  "quick-draw",
  "hidden",
  "ambush"
]);

export function normalizeKeyword(keyword) {
  return String(keyword || "").trim().toLowerCase();
}

export function keywordListHas(keywords, keyword) {
  const normalized = normalizeKeyword(keyword);
  return (keywords || []).some((item) => normalizeKeyword(item) === normalized);
}

export function keywordListCount(keywords, keyword) {
  const normalized = normalizeKeyword(keyword);
  return (keywords || []).filter((item) => normalizeKeyword(item) === normalized).length;
}

export function printedKeywordValue(card, keyword, fallback = 1) {
  const count = keywordListCount(card?.keywords, keyword);
  if (!count) return 0;
  const values = keywordValuesInRulesText(card?.text, keyword);
  if (!STACKING_VALUE_KEYWORDS.has(normalizeKeyword(keyword))) {
    return values[0] ?? fallback;
  }
  if (!values.length) return count * fallback;
  return values.reduce((sum, value) => sum + value, 0)
    + Math.max(0, count - values.length) * fallback;
}

export function temporaryKeywordValue(card, keyword, fallback = 1) {
  const normalized = normalizeKeyword(keyword);
  const explicit = card?.temporaryKeywordAmounts?.[normalized];
  if (explicit != null) return Math.max(0, Number(explicit) || 0);
  const count = keywordListCount(card?.temporaryKeywords, keyword);
  if (!count) return 0;
  return STACKING_VALUE_KEYWORDS.has(normalized) ? count * fallback : fallback;
}

export function addTemporaryKeyword(card, keyword, amount = null) {
  const normalized = normalizeKeyword(keyword);
  card.temporaryKeywords ||= [];
  if (REDUNDANT_KEYWORDS.has(normalized)) {
    if (!keywordListHas(card.temporaryKeywords, keyword)) card.temporaryKeywords.push(keyword);
    return;
  }
  card.temporaryKeywords.push(keyword);
  if (STACKING_VALUE_KEYWORDS.has(normalized)) {
    card.temporaryKeywordAmounts ||= {};
    card.temporaryKeywordAmounts[normalized] = (card.temporaryKeywordAmounts[normalized] || 0)
      + Math.max(0, amount == null ? 1 : Number(amount) || 0);
  }
}

export function keywordValuesInRulesText(text, keyword) {
  const escaped = String(keyword || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bracketed = new RegExp(`\\[\\s*${escaped}(?:\\s+(\\d+))?\\s*\\]`, "gi");
  const values = [];
  for (const match of String(text || "").matchAll(bracketed)) values.push(match[1] == null ? 1 : Number(match[1]));
  return values;
}

export function isInherentReaction(card) {
  // Ambush grants Reaction only while the card is being played to a
  // battlefield containing a friendly unit (Core Rules 822.1.b). Imported
  // card metadata may include the reminder-text Reaction tag, so it must not
  // be treated as unconditional here.
  return cardReactionPermissionSources(card).length > 0;
}

export function cardReactionPermissionSources(card, {
  fromHidden = false,
  ambushDestinationEligible = false
} = {}) {
  const sources = [];
  if (!keywordListHas(card?.keywords, "Ambush")) {
    if (keywordListHas(card?.tags, "Reaction") || keywordListHas(card?.keywords, "Reaction")) sources.push("reaction");
    if (keywordListHas(card?.keywords, "Quick-Draw")) sources.push("quick-draw");
  }
  if (fromHidden) sources.push("hidden");
  if (ambushDestinationEligible && keywordListHas(card?.keywords, "Ambush")) sources.push("ambush");
  return sources;
}

export function hasUniqueDeckConstraint(card) {
  return keywordListHas(card?.keywords, "Unique") || keywordListHas(card?.tags, "Unique");
}

export function keywordPlayEffectSpecs(card, { keywordCount = null } = {}) {
  const specs = [];
  for (const definition of KEYWORD_PLAY_EFFECT_SPECS) {
    const effectiveCount = keywordCount
      ? Math.max(0, Number(keywordCount(definition.keyword)) || 0)
      : keywordListCount(card?.keywords, definition.keyword);
    const count = definition.repeatable
      ? effectiveCount
      : Number(effectiveCount > 0);
    for (let index = 0; index < count; index += 1) {
      const { keyword, repeatable, ...effect } = definition;
      specs.push({ ...effect, ...(repeatable ? { instance: index + 1 } : {}) });
    }
  }
  return specs;
}

export function keywordBehaviorEffectSpecs(card) {
  const specs = [...keywordPlayEffectSpecs(card)];
  for (const definition of KEYWORD_BEHAVIOR_EFFECT_SPECS) {
    if (KEYWORD_PLAY_EFFECT_SPECS.includes(definition)) continue;
    if (!keywordListHas(card?.keywords, definition.keyword)) continue;
    const { keyword, numeric, ...effect } = definition;
    specs.push({ ...effect, ...(numeric ? { amount: printedKeywordValue(card, keyword, 1) } : {}) });
  }
  return specs;
}
