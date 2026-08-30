import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards, rawDecklists, DOMAINS } from "../src/cards.mjs";
import { validateDeckRecord } from "../src/decks/rules.mjs";
import { EFFECT_TIMINGS, effectDefinition, effectKey } from "../src/effects/registry.mjs";
import { cardHasType } from "../src/cards/shared.mjs";
import { OFFICIAL_TOKEN_DEFINITIONS, officialTokenKinds } from "../src/rules/tokens.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(root, "src", "cards");
const cardsIndexPath = path.join(root, "src", "cards.mjs");

const VALID_TYPES = new Set(["unit", "spell", "gear", "battlefield", "legend", "rune"]);
const VALID_DOMAINS = new Set(Object.values(DOMAINS));
const VALID_TIMINGS = new Set(EFFECT_TIMINGS);
const MIGHT_MODIFIER_KINDS = new Set([
  "buffAndUntargetable",
  "burnBuffFromBurnedUnit",
  "burnBuffSelf",
  "doubleMightGrantReadyAbility",
  "battlefieldBuffUnitHere",
  "buffMovedUnit",
  "doubleMightTemporary",
  "doubleSelfMight",
  "drawDiscardTypeBonus",
  "duelFriendlyEnemy",
  "enGarde",
  "enemyAttacksControlledBattlefieldMightReduction",
  "fromHiddenBuffSelf",
  "gainMightKeywordsIfPowerSpent",
  "gainMightKeywordsIfXpGainedThisTurn",
  "giveKeyword",
  "highCostSpellBuffSelf",
  "ifEnemyAloneBuffAndXp",
  "matchFriendlyMight",
  "modifyEnemyHere",
  "modifyEnemyUnits",
  "modifyAnotherFriendly",
  "modifyFriendlyAlone",
  "modifyFriendlyUnits",
  "modifyMight",
  "modifyMightByDistinctTags",
  "modifySelfIfFewerRunes",
  "matchChosenUnitMightPlus",
  "moveEnemyToFriendlyBattlefieldBuffIfExactlyTwo",
  "payEnergyModifyFriendly",
  "readySelfMight",
  "replaceChosenDisableWithBuff",
  "returnFriendlyOrWeakenEnemy",
  "revealTopDrawUnitElseTrashBuffSelf",
  "modifyNamedTagUnit",
  "selfMightIfHighCostSpellPlayed",
  "modifyTwoUnitsOpposite",
  "payPowerModifySelfMight",
  "modifySelfWhenChosenOrReadied",
  "modifySelfIfReadyEnemyHere",
  "modifySelfMight",
  "moonfall",
  "readyFriendlyUnitMightThisTurn",
  "readySelfMight",
  "secondCardMightReadySelf",
  "selfBuff",
  "siphonPower"
  ,"heroicCharge"
  ,"curtainCall"
  ,"payEnergyModifyUnitHere"
]);

const errors = [];
const warnings = [];

function error(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function expect(condition, message) {
  if (!condition) error(message);
}

function cardLabel(key, card) {
  return `${key} (${card?.name || "unnamed"})`;
}

const indexSource = fs.readFileSync(cardsIndexPath, "utf8");
const registeredImportFiles = new Set(
  [...indexSource.matchAll(/import\s+\w+\s+from\s+"\.\/cards\/([^"]+\.mjs)";/g)].map((match) => match[1])
);

for (const file of fs.readdirSync(cardsDir).filter((name) => name.endsWith(".mjs"))) {
  if (file === "shared.mjs" || file.startsWith("_")) continue;
  const source = fs.readFileSync(path.join(cardsDir, file), "utf8");
  if (!source.includes("export default card(")) continue;
  if (!registeredImportFiles.has(file)) error(`Card file src/cards/${file} exports a card but is not imported in src/cards.mjs.`);
}

const seenNumbers = new Map();
const seenIds = new Map();
const cardByNumberMap = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
for (const [key, card] of Object.entries(cards)) {
  const label = cardLabel(key, card);
  expect(card && typeof card === "object", `${label}: card export must be an object.`);
  expect(typeof card.id === "string" && card.id.length > 0, `${label}: missing id.`);
  expect(typeof card.cardNumber === "string" && card.cardNumber.length > 0, `${label}: missing normalized cardNumber.`);
  expect(typeof card.collectorNumber === "string" && card.collectorNumber.length > 0, `${label}: missing collectorNumber.`);
  expect(typeof card.name === "string" && card.name.length > 0, `${label}: missing name.`);
  expect(VALID_TYPES.has(card.type), `${label}: invalid type '${card.type}'.`);
  expect(typeof card.set === "string" && card.set.length > 0, `${label}: missing set.`);
  expect(typeof card.rarity === "string" && card.rarity.length > 0, `${label}: missing rarity.`);
  expect(typeof card.text === "string", `${label}: text must be a string.`);
  if (card.type !== "rune") expect(typeof card.image === "string" && card.image.length > 0, `${label}: non-rune cards must have an image URL.`);
  expect(Array.isArray(card.domains), `${label}: domains must be an array.`);
  expect(Array.isArray(card.tags), `${label}: tags must be an array.`);
  expect(Array.isArray(card.keywords), `${label}: keywords must be an array.`);
  expect(Array.isArray(card.power), `${label}: power must be an array.`);
  expect(Array.isArray(card.effects), `${label}: effects must be an array.`);

  const hasTurnLimitedMightText = /(?:Might this turn|this turn[^.\n]*Might)/i.test(card.text || "");
  const mightModifierEffects = (card.effects || []).filter((effect) => MIGHT_MODIFIER_KINDS.has(effect.kind) && effect.buff !== true);
  if (hasTurnLimitedMightText) {
    const hasConditionScopedMight = (card.effects || []).some((effect) => effect.kind === "attachedThisTurnMight");
    expect(hasConditionScopedMight || mightModifierEffects.some((effect) => effect.temporary === true), `${label}: text grants a turn-limited Might modifier, but no matching temporary or condition-scoped effect is declared.`);
    for (const effect of mightModifierEffects) {
      expect(effect.temporary === true, `${label}: '${effectKey(effect)}' changes Might under turn-limited text and must declare temporary: true.`);
    }
  }

  if (card.implementationReference) {
    const reference = cardByNumberMap.get(card.implementationReference);
    expect(reference, `${label}: implementationReference '${card.implementationReference}' does not identify a registered card.`);
    expect(reference?.cardNumber !== card.cardNumber, `${label}: implementationReference cannot point to itself.`);
    expect(reference?.type === card.type, `${label}: implementationReference must have the same card type.`);
    for (const [index, effect] of (card.effects || []).entries()) {
      const shared = reference?.effects?.some((candidate) => candidate.timing === effect.timing && candidate.kind === effect.kind);
      expect(shared, `${label}: effects[${index}] '${effectKey(effect)}' is not implemented by reference card ${reference?.name || card.implementationReference}. Use a matching reference or register a new behavior explicitly.`);
    }
  }
  if (card.implementationReferences !== undefined) {
    expect(card.implementationReferences && typeof card.implementationReferences === "object" && !Array.isArray(card.implementationReferences), `${label}: implementationReferences must be an effect-pair to card-number object.`);
    for (const [pair, referenceNumber] of Object.entries(card.implementationReferences || {})) {
      const reference = cardByNumberMap.get(referenceNumber);
      const ownEffect = (card.effects || []).find((effect) => effectKey(effect) === pair);
      expect(ownEffect, `${label}: implementationReferences contains unused effect pair '${pair}'.`);
      expect(reference, `${label}: implementationReferences '${pair}' points to unknown card '${referenceNumber}'.`);
      expect(reference?.cardNumber !== card.cardNumber, `${label}: implementationReferences '${pair}' cannot point to itself.`);
      expect(reference?.type === card.type, `${label}: implementationReferences '${pair}' must point to the same card type.`);
      expect(reference?.effects?.some((effect) => effectKey(effect) === pair), `${label}: reference card ${reference?.name || referenceNumber} does not implement '${pair}'.`);
    }
  }

  if (card.type === "unit") expect(Number.isFinite(card.might), `${label}: units must declare numeric might.`);
  if (["unit", "spell", "gear"].includes(card.type)) expect(Number.isFinite(card.energy), `${label}: ${card.type} cards must declare numeric energy.`);
  if (card.type === "battlefield" || card.type === "legend") {
    if (card.energy !== undefined) warn(`${label}: ${card.type} usually should not have energy.`);
  }

  for (const domain of card.domains || []) {
    expect(VALID_DOMAINS.has(domain), `${label}: invalid domain '${domain}'.`);
  }
  for (const [index, cost] of (card.power || []).entries()) {
    expect(cost && typeof cost === "object", `${label}: power[${index}] must be an object.`);
    expect(VALID_DOMAINS.has(cost.domain), `${label}: power[${index}] has invalid domain '${cost?.domain}'.`);
    expect(Number.isFinite(cost.amount) && cost.amount >= 0, `${label}: power[${index}] must have non-negative numeric amount.`);
  }
  for (const [index, effect] of (card.effects || []).entries()) {
    const definition = effectDefinition(effect);
    const pair = effectKey(effect);
    expect(typeof effect?.timing === "string" && effect.timing.length > 0, `${label}: effects[${index}] missing timing.`);
    expect(typeof effect?.kind === "string" && effect.kind.length > 0, `${label}: effects[${index}] missing kind.`);
    expect(VALID_TIMINGS.has(effect?.timing), `${label}: effects[${index}] has unknown timing '${effect?.timing}'.`);
    expect(definition, `${label}: effects[${index}] uses unsupported effect '${pair}'. Add engine support in src/effects/registry.mjs and src/engine.mjs before registering this card.`);
    expect(["rules", "effect", "mightBonus"].includes(effect.textSection || "rules"), `${label}: effects[${index}].textSection must be rules, effect, or mightBonus.`);
    if (effect.textSection === "mightBonus") expect(effect.kind === "attachedMight", `${label}: only attachedMight may use the mightBonus text section.`);
    if (effect.temporary !== undefined) expect(typeof effect.temporary === "boolean", `${label}: effects[${index}].temporary must be boolean.`);
    if (effect.timing === "activated") {
      expect(typeof effect.exhaust === "boolean",
        `${label}: effects[${index}] activated abilities must explicitly declare exhaust: true|false.`);
    }
    if (effect.timing === "static" && definition?.abilityClass === "passive") {
      expect(effect.exhaust === undefined,
        `${label}: effects[${index}] passive static effects cannot exhaust their source as an implicit cost.`);
    }
    if (definition?.sourceTypes?.length) {
      expect(definition.sourceTypes.some((type) => cardHasType(card, type)), `${label}: effects[${index}] '${pair}' is only valid on ${definition.sourceTypes.join(", ")} cards, not ${(card.types || [card.type]).join("/")}.`);
    }
    if (effect?.timing === "onMove" && definition) {
      expect(["sync", "choice"].includes(definition.flow), `${label}: effects[${index}] '${pair}' must declare flow: sync|choice in the effect registry.`);
      expect(["inline", "afterMove"].includes(definition.continuation), `${label}: effects[${index}] '${pair}' must declare its movement continuation policy.`);
      if (definition.flow === "choice") {
        expect(definition.continuation === "afterMove", `${label}: choice-based onMove effect '${pair}' must resume through afterMove.`);
      }
    }
    validateEffectPayload(label, index, effect, definition, card.type);
  }

  const previousNumber = seenNumbers.get(card.cardNumber);
  if (previousNumber) error(`${label}: duplicate cardNumber ${card.cardNumber}; already used by ${previousNumber}.`);
  seenNumbers.set(card.cardNumber, label);
  const previousId = seenIds.get(card.id);
  if (previousId && previousId !== label) warn(`${label}: duplicate id ${card.id}; also used by ${previousId}. Use collectorNumber/cardNumber for true uniqueness.`);
  seenIds.set(card.id, label);
}

for (const [deckId, deck] of Object.entries(rawDecklists)) {
  const validation = validateDeckRecord(deck, (cardNumber) => cardByNumberMap.get(cardNumber) || null);
  for (const message of validation.messages) error(`${deckId}: ${message}`);
  expect(deck.legend, `${deckId}: missing legend card number.`);
  expect(Array.isArray(deck.battlefields), `${deckId}: battlefields must be an array.`);
  expect(Array.isArray(deck.main), `${deckId}: main must be an array.`);
  expect(Array.isArray(deck.runes), `${deckId}: runes must be an array.`);
  for (const [cardNumber, count] of deck.main || []) {
    expect(seenNumbers.has(cardNumber), `${deckId}: unknown main deck card number ${cardNumber}.`);
    expect(Number.isInteger(count) && count > 0, `${deckId}: invalid count for ${cardNumber}.`);
  }
  for (const cardNumber of deck.battlefields || []) expect(seenNumbers.has(cardNumber), `${deckId}: unknown battlefield card number ${cardNumber}.`);
  if (deck.legend) expect(seenNumbers.has(deck.legend), `${deckId}: unknown legend card number ${deck.legend}.`);
}

const expectedOfficialTokens = ["recruit", "sprite", "sandSoldier", "mech", "gold", "reflection", "bird", "brush", "baronPit"];
expect(JSON.stringify(officialTokenKinds().filter((kind) => expectedOfficialTokens.includes(kind))) === JSON.stringify(expectedOfficialTokens),
  "Official token registry must retain the nine Core Rules 184 token definitions in rule order.");
expect(["tentacle", "shadowClone"].every((kind) => officialTokenKinds().includes(kind)),
  "Official token registry must contain the Vendetta Tentacle and Shadow Clone definitions.");
for (const [key, token] of Object.entries(OFFICIAL_TOKEN_DEFINITIONS)) {
  const label = `official token ${key} (${token.name})`;
  expect(token.isToken === true, `${label}: must be marked as a token Game Object.`);
  expect(token.energy === 0 || token.energy === undefined, `${label}: tokens have no cost and are treated as cost 0.`);
  expect(Array.isArray(token.domains) && token.domains.length === 0, `${label}: tokens must be domainless.`);
  for (const [index, effect] of (token.effects || []).entries()) {
    const definition = effectDefinition(effect);
    expect(definition, `${label}: effects[${index}] uses unsupported effect '${effectKey(effect)}'.`);
    expect(definition?.sourceTypes?.includes(token.type), `${label}: effects[${index}] is invalid for ${token.type}.`);
    validateEffectPayload(label, index, effect, definition, token.type);
  }
}
const goldToken = OFFICIAL_TOKEN_DEFINITIONS.gold;
expect(goldToken?.effects?.some((effect) => effect.timing === "activated"
  && effect.kind === "addPower"
  && effect.resourceKind === "gold"),
"Gold must identify its shared Add Power ability as a Gold resource so global Gold modifiers can apply without card-number branches.");

for (const warning of warnings) console.warn(`Warning: ${warning}`);
if (errors.length) {
  console.error(`Card validation failed with ${errors.length} error(s):`);
  for (const item of errors) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Validated ${Object.keys(cards).length} cards, ${registeredImportFiles.size} card imports, and ${Object.keys(rawDecklists).length} decklists.`);

function validateEffectPayload(label, index, effect, definition, sourceType = null) {
  if (effect.kind === "costModifier") {
    expect([undefined, "card", "self", "activatedAbility"].includes(effect.appliesTo),
      `${label}: effects[${index}].appliesTo must be card, self, or activatedAbility.`);
    if (effect.abilityKind !== undefined) {
      expect(effect.appliesTo === "activatedAbility",
        `${label}: effects[${index}].abilityKind is only valid for an activatedAbility cost modifier.`);
      expect(typeof effect.abilityKind === "string" && effect.abilityKind.length > 0,
        `${label}: effects[${index}].abilityKind must be a non-empty string.`);
    }
    if (effect.sourceType !== undefined) {
      expect(effect.appliesTo === "activatedAbility",
        `${label}: effects[${index}].sourceType is only valid for an activatedAbility cost modifier.`);
      expect(VALID_TYPES.has(effect.sourceType),
        `${label}: effects[${index}].sourceType is invalid '${effect.sourceType}'.`);
    }
    if (effect.sourceTag !== undefined) {
      expect(effect.appliesTo === "activatedAbility" && typeof effect.sourceTag === "string" && effect.sourceTag.length > 0,
        `${label}: effects[${index}].sourceTag must be a non-empty activatedAbility source tag.`);
    }
  }
  if (effect.abilityKeywords !== undefined) {
    expect(Array.isArray(effect.abilityKeywords), `${label}: effects[${index}].abilityKeywords must be an array.`);
    const allowed = new Set(["Action", "Reaction"]);
    for (const keyword of effect.abilityKeywords || []) {
      expect(allowed.has(keyword), `${label}: effects[${index}].abilityKeywords contains unsupported timing keyword '${keyword}'.`);
    }
    expect(new Set(effect.abilityKeywords || []).size === (effect.abilityKeywords || []).length,
      `${label}: effects[${index}].abilityKeywords must not contain duplicates.`);
  }
  if (effect.killSelfCost !== undefined) {
    expect(effect.killSelfCost === true && effect.timing === "activated" && sourceType === "gear",
      `${label}: effects[${index}].killSelfCost is only supported by activated gear abilities.`);
  }
  if (effect.killFriendlyPermanentCost !== undefined) {
    expect(effect.killFriendlyPermanentCost === true && effect.timing === "activated" && effect.kind === "addPower",
      `${label}: effects[${index}].killFriendlyPermanentCost is only supported by the shared activated Add Power cost contract.`);
  }
  if (effect.killFriendlyUnitCost !== undefined) {
    expect(effect.killFriendlyUnitCost === true && effect.timing === "activated",
      `${label}: effects[${index}].killFriendlyUnitCost is only supported by activated abilities.`);
  }
  if (effect.recycleSelfCost !== undefined) {
    expect(effect.recycleSelfCost === true && effect.timing === "activated" && effect.kind === "addPower" && sourceType === "rune",
      `${label}: effects[${index}].recycleSelfCost is only supported by the shared activated Rune Add Power cost contract.`);
  }
  if (effect.sourceLocation !== undefined) {
    expect(["base", "battlefield"].includes(effect.sourceLocation),
      `${label}: effects[${index}].sourceLocation must be base or battlefield.`);
  }
  if (effect.costRecycleTrashType !== undefined) {
    expect(effect.timing === "activated" && (effect.costRecycleTrash || 0) > 0,
      `${label}: effects[${index}].costRecycleTrashType requires an activated recycle-trash cost.`);
    expect(VALID_TYPES.has(effect.costRecycleTrashType),
      `${label}: effects[${index}].costRecycleTrashType is invalid '${effect.costRecycleTrashType}'.`);
  }
  if (effect.requiresCardTypePlayedThisTurn !== undefined) {
    expect(effect.timing === "activated" && VALID_TYPES.has(effect.requiresCardTypePlayedThisTurn),
      `${label}: effects[${index}].requiresCardTypePlayedThisTurn must name a valid card type on an activated ability.`);
  }
  if (effect.optionalReadyPower !== undefined) {
    expect(effect.timing === "spell" && effect.kind === "playUnitToken" && Array.isArray(effect.optionalReadyPower),
      `${label}: effects[${index}].optionalReadyPower is only valid on spell:playUnitToken.`);
    for (const [powerIndex, requirement] of (effect.optionalReadyPower || []).entries()) {
      validatePowerRequirement(label, `effects[${index}].optionalReadyPower[${powerIndex}]`, requirement);
    }
  }
  if (effect.additionalPower) validatePowerRequirement(label, `effects[${index}].additionalPower`, effect.additionalPower);
  if (effect.costOptions !== undefined) {
    expect(effect.timing === "activated" && Array.isArray(effect.costOptions) && effect.costOptions.length > 1,
      `${label}: effects[${index}].costOptions must contain multiple activated-ability cost choices.`);
    for (const [optionIndex, option] of (effect.costOptions || []).entries()) {
      expect(Number.isInteger(option.energy || 0) && (option.energy || 0) >= 0,
        `${label}: effects[${index}].costOptions[${optionIndex}].energy must be a non-negative integer.`);
      for (const [powerIndex, requirement] of (option.power || []).entries()) {
        validatePowerRequirement(label, `effects[${index}].costOptions[${optionIndex}].power[${powerIndex}]`, requirement);
      }
    }
  }
  if (effect.repeatCost !== undefined) {
    expect(effect.repeatCost && typeof effect.repeatCost === "object" && !Array.isArray(effect.repeatCost),
      `${label}: effects[${index}].repeatCost must be an object.`);
    if (effect.repeatCost?.energy !== undefined) {
      expect(Number.isFinite(effect.repeatCost.energy) && effect.repeatCost.energy >= 0,
        `${label}: effects[${index}].repeatCost.energy must be non-negative numeric.`);
    }
    expect(Array.isArray(effect.repeatCost?.power || []),
      `${label}: effects[${index}].repeatCost.power must be an array when present.`);
    for (const [powerIndex, requirement] of (effect.repeatCost?.power || []).entries()) {
      validatePowerRequirement(label, `effects[${index}].repeatCost.power[${powerIndex}]`, requirement);
    }
  }
  if (effect.domain) expect(VALID_DOMAINS.has(effect.domain), `${label}: effects[${index}].domain is invalid '${effect.domain}'.`);
  if (effect.domains) {
    expect(Array.isArray(effect.domains), `${label}: effects[${index}].domains must be an array.`);
    for (const domain of effect.domains || []) expect(VALID_DOMAINS.has(domain), `${label}: effects[${index}].domains contains invalid domain '${domain}'.`);
  }
  for (const numericField of ["amount", "draw", "xp", "max", "maxEnergy", "maxPower", "maxMight", "repeatCostEnergy", "friendlyEnergy", "enemyEnergy", "friendlyPower", "enemyPower", "minEnergy", "minPower", "minMight"]) {
    if (effect[numericField] !== undefined) {
      expect(Number.isFinite(effect[numericField]), `${label}: effects[${index}].${numericField} must be numeric.`);
    }
  }
  if (definition?.targetProvider && effect.target !== undefined) {
    expect(typeof effect.target === "string", `${label}: effects[${index}].target must be a string when present.`);
  }
}

function validatePowerRequirement(label, field, requirement) {
  expect(requirement && typeof requirement === "object", `${label}: ${field} must be an object.`);
  expect(VALID_DOMAINS.has(requirement?.domain), `${label}: ${field}.domain has invalid domain '${requirement?.domain}'.`);
  expect(Number.isFinite(requirement?.amount) && requirement.amount >= 0, `${label}: ${field}.amount must be non-negative numeric.`);
}
