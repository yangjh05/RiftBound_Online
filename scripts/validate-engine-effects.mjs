import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECT_DEFINITIONS } from "../src/effects/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineSource = fs.readFileSync(path.join(root, "src", "engine.mjs"), "utf8");
const errors = [];

const effectResolverKeys = parseMapKeys("EFFECT_RESOLVERS", "resolveEffect");
const choiceResolverKeys = parseMapKeys("CHOICE_RESOLVERS", "DEFLECTABLE_CHOICE_EFFECTS");
const triggerResolverKeys = parseMapKeys("TRIGGER_RESOLVERS", "resolveQueuedTrigger");
const onMoveResolverKeys = parseMapKeys("ON_MOVE_EFFECT_RESOLVERS", "function triggerMoveEffects");

for (const [key, definition] of Object.entries(EFFECT_DEFINITIONS)) {
  if (["activated", "onPlay", "spell"].includes(definition.timing) && !effectResolverKeys.has(key)) {
    errors.push(`${key} is registered in src/effects/registry.mjs but has no EFFECT_RESOLVERS entry in src/engine.mjs.`);
  }
  if (definition.timing === "onMove") validateOnMoveContract(key, definition);
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
