import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABILITY_ACTIVE_ZONES,
  ABILITY_CLASSES,
  EFFECT_DEFINITIONS
} from "../src/effects/registry.mjs";
import { cards } from "../src/cards.mjs";
import { CARD_REACTION_PERMISSION_KINDS, keywordBehaviorEffectSpecs } from "../src/rules/keywords.mjs";
import { OFFICIAL_TOKEN_DEFINITIONS } from "../src/rules/tokens.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineSource = fs.readFileSync(path.join(root, "src", "engine.mjs"), "utf8");
const errors = [];

const effectResolverKeys = parseMapKeys("EFFECT_RESOLVERS", "resolveEffect");
const choiceResolverKeys = parseMapKeys("CHOICE_RESOLVERS", "DEFLECTABLE_CHOICE_EFFECTS");
const triggerResolverKeys = parseMapKeys("TRIGGER_RESOLVERS", "resolveQueuedTrigger");
const onMoveResolverKeys = parseMapKeys("ON_MOVE_EFFECT_RESOLVERS", "function triggerMoveEffects");
const usedEffectKeys = new Set(Object.values(cards).flatMap((card) => [
  ...(card.effects || []),
  ...keywordBehaviorEffectSpecs(card)
].map((effect) => `${effect.timing}:${effect.kind}`)));
for (const token of Object.values(OFFICIAL_TOKEN_DEFINITIONS)) {
  for (const effect of token.effects || []) usedEffectKeys.add(`${effect.timing}:${effect.kind}`);
}

const reviewedReactionPermissionKinds = ["reaction", "quick-draw", "hidden", "ambush"];
const reviewedNonTargetSpellResolutionChoices = new Map([
  ["chooseTopDeck", "the Main Deck is secret and the choice occurs on resolution"],
  ["eachOtherPlayerKillUncontrolledUnit", "the affected other player chooses on resolution"],
  ["eachPlayerReturnUnitToHand", "each affected player chooses on resolution"]
]);
if (JSON.stringify(CARD_REACTION_PERMISSION_KINDS) !== JSON.stringify(reviewedReactionPermissionKinds)) {
  errors.push("Card Reaction timing permissions changed; add a Core Rules 338.1.a.3 boundary test and review the shared timing contract.");
}
if (!engineSource.includes("function cardHasReactionTimingPermission(")) {
  errors.push("Card Reaction timing exceptions must route through cardHasReactionTimingPermission().");
}

for (const [key, definition] of Object.entries(EFFECT_DEFINITIONS)) {
  validateAbilityContract(key, definition);
  if (["activated", "onPlay", "spell"].includes(definition.timing) && !effectResolverKeys.has(key)) {
    errors.push(`${key} is registered in src/effects/registry.mjs but has no EFFECT_RESOLVERS entry in src/engine.mjs.`);
  }
  if (definition.timing === "onMove") validateOnMoveContract(key, definition);
  if (definition.timing === "spell" && definition.targetProvider && !definition.declaration
    && !reviewedNonTargetSpellResolutionChoices.has(definition.kind)) {
    errors.push(`${key} has a target provider but no play-time declaration or reviewed Core Rules 355 non-target resolution exception.`);
  }
  if (definition.timing === "spell" && definition.declaration
    && reviewedNonTargetSpellResolutionChoices.has(definition.kind)) {
    errors.push(`${key} cannot be both a play-time target declaration and a reviewed non-target resolution choice.`);
  }
  if (usedEffectKeys.has(key)
    && !effectResolverKeys.has(key)
    && !["activated", "onPlay", "spell", "onMove"].includes(definition.timing)
    && !engineSource.includes(`"${definition.kind}"`)) {
    errors.push(`${key} is used by a card but its kind is never consumed by src/engine.mjs.`);
  }
}

for (const key of effectResolverKeys) {
  if (!EFFECT_DEFINITIONS[key]) {
    errors.push(`${key} has an EFFECT_RESOLVERS entry but is not registered in src/effects/registry.mjs.`);
  }
}

if (engineSource.includes("choice.effect ===")) {
  errors.push("Choice effects must route through CHOICE_RESOLVERS, not legacy choice.effect if-chains.");
}

if (engineSource.includes("function cardHasEffect(") || engineSource.includes("cardHasEffect(")) {
  errors.push("Effect lookup must use timing-aware helpers, not cardHasEffect(kind).");
}

if (!choiceResolverKeys.size) errors.push("CHOICE_RESOLVERS was not found or has no entries.");
if (!triggerResolverKeys.size) errors.push("TRIGGER_RESOLVERS was not found or has no entries.");

if (errors.length) {
  console.error(`Engine effect validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validated ${effectResolverKeys.size} effect resolvers, ${choiceResolverKeys.size} choice resolvers, and ${triggerResolverKeys.size} trigger resolvers.`);

function validateOnMoveContract(key, definition) {
  if (!["sync", "choice"].includes(definition.flow)) {
    errors.push(`${key} must declare flow: sync|choice in src/effects/registry.mjs.`);
    return;
  }
  if (definition.flow === "choice" && definition.continuation !== "afterMove") {
    errors.push(`${key} opens a choice and must declare continuation: afterMove.`);
  }
  if (!onMoveResolverKeys.has(definition.kind)) {
    errors.push(`${key} is registered but has no ON_MOVE_EFFECT_RESOLVERS entry.`);
    return;
  }
  if (definition.flow === "choice") {
    const resolverName = parseResolverName("ON_MOVE_EFFECT_RESOLVERS", definition.kind);
    const resolverStart = resolverName ? engineSource.indexOf(`function ${resolverName}(`) : -1;
    const resolverWindow = resolverStart >= 0 ? engineSource.slice(resolverStart, resolverStart + 1800) : "";
    if (!resolverWindow.includes("afterMove")) {
      errors.push(`${key} opens a choice but its shared resolver does not preserve afterMove.`);
    }
  }
}

function validateAbilityContract(key, definition) {
  if (!ABILITY_CLASSES.includes(definition.abilityClass)) {
    errors.push(`${key} must declare a recognized Core Rules 361 ability class.`);
  }
  if (!Array.isArray(definition.activeZones) || !definition.activeZones.length) {
    errors.push(`${key} must declare at least one active zone.`);
  } else {
    for (const zone of definition.activeZones) {
      if (!ABILITY_ACTIVE_ZONES.includes(zone)) errors.push(`${key} declares unknown active zone ${zone}.`);
    }
  }
  const requiredClassByTiming = {
    activated: "activated",
    replacement: "replacement",
    spell: "instruction",
    keyword: "keyword"
  };
  const requiredClass = requiredClassByTiming[definition.timing];
  if (requiredClass && definition.abilityClass !== requiredClass) {
    errors.push(`${key} must be classified as ${requiredClass}, not ${definition.abilityClass}.`);
  }
  if (definition.optionalTrigger && definition.abilityClass !== "triggered") {
    errors.push(`${key} declares optional trigger placement but is not a triggered ability.`);
  }
  if (definition.triggerCost && definition.abilityClass !== "triggered") {
    errors.push(`${key} declares a trigger cost but is not a triggered ability.`);
  }
  if (definition.abilityClass === "activated" && !definition.activeZones.includes("board")) {
    errors.push(`${key} must be active on the Board for the registered two-player card pool.`);
  }
  if (definition.abilityClass === "replacement" && !definition.activeZones.includes("board")) {
    errors.push(`${key} must be active on the Board unless a self-described outside-zone replacement is registered.`);
  }
  if (definition.abilityClass === "instruction" && !definition.activeZones.includes("chain")) {
    errors.push(`${key} spell instructions must be active while their source is on the Chain.`);
  }
  if (definition.abilityClass === "triggered"
    && !definition.activeZones.includes("board")
    && !definition.activeZones.some((zone) => ["trash", "mainDeck"].includes(zone))) {
    errors.push(`${key} outside-Board trigger must explicitly name its self-described zone.`);
  }
}

function parseResolverName(mapName, key) {
  const start = engineSource.indexOf(`const ${mapName}`);
  const end = engineSource.indexOf("]);", start);
  const block = engineSource.slice(start, end);
  return block.match(new RegExp(`\\[\"${key}\",\\s*(\\w+)\\]`))?.[1] || null;
}

function parseMapKeys(startMarker, endMarker) {
  const start = engineSource.indexOf(`const ${startMarker}`);
  const end = engineSource.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return new Set();
  const block = engineSource.slice(start, end);
  return new Set([...block.matchAll(/\["([^"]+)"/g)].map((match) => match[1]));
}
