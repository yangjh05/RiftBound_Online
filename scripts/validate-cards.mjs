import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards, rawDecklists, DOMAINS } from "../src/cards.mjs";
import { validateDeckRecord } from "../src/decks/rules.mjs";
import { EFFECT_TIMINGS, effectDefinition, effectKey } from "../src/effects/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(root, "src", "cards");
const cardsIndexPath = path.join(root, "src", "cards.mjs");

const VALID_TYPES = new Set(["unit", "spell", "gear", "battlefield", "legend", "rune"]);
const VALID_DOMAINS = new Set(Object.values(DOMAINS));
const VALID_TIMINGS = new Set(EFFECT_TIMINGS);

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
    if (definition?.sourceTypes?.length) {
      expect(definition.sourceTypes.includes(card.type), `${label}: effects[${index}] '${pair}' is only valid on ${definition.sourceTypes.join(", ")} cards, not ${card.type}.`);
    }
    if (effect?.timing === "onMove" && definition) {
      expect(["sync", "choice"].includes(definition.flow), `${label}: effects[${index}] '${pair}' must declare flow: sync|choice in the effect registry.`);
      expect(["inline", "afterMove"].includes(definition.continuation), `${label}: effects[${index}] '${pair}' must declare its movement continuation policy.`);
      if (definition.flow === "choice") {
        expect(definition.continuation === "afterMove", `${label}: choice-based onMove effect '${pair}' must resume through afterMove.`);
      }
    }
    validateEffectPayload(label, index, effect, definition);
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

for (const warning of warnings) console.warn(`Warning: ${warning}`);
if (errors.length) {
  console.error(`Card validation failed with ${errors.length} error(s):`);
  for (const item of errors) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Validated ${Object.keys(cards).length} cards, ${registeredImportFiles.size} card imports, and ${Object.keys(rawDecklists).length} decklists.`);

function validateEffectPayload(label, index, effect, definition) {
  if (effect.additionalPower) validatePowerRequirement(label, `effects[${index}].additionalPower`, effect.additionalPower);
  if (effect.domain) expect(VALID_DOMAINS.has(effect.domain), `${label}: effects[${index}].domain is invalid '${effect.domain}'.`);
  if (effect.domains) {
    expect(Array.isArray(effect.domains), `${label}: effects[${index}].domains must be an array.`);
    for (const domain of effect.domains || []) expect(VALID_DOMAINS.has(domain), `${label}: effects[${index}].domains contains invalid domain '${domain}'.`);
  }
  for (const numericField of ["amount", "draw", "xp", "max", "maxEnergy", "maxPower", "maxMight", "repeatCostEnergy", "friendlyEnergy", "enemyEnergy", "friendlyPower", "enemyPower", "minEnergy", "minMight"]) {
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
