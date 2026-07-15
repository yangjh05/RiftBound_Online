import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards as registeredCards } from "../src/cards.mjs";
import { EFFECT_DEFINITIONS, effectKey } from "../src/effects/registry.mjs";
import { keywordBehaviorEffectSpecs } from "../src/rules/keywords.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const COVERAGE_BASELINE_PATH = path.join(ROOT, "spec", "cards", "behavior-coverage-baseline.json");

export function analyzeCardBehaviorCoverage(cardPool, probes, options = {}) {
  const usedEffects = new Map();
  for (const card of cardPool) {
    for (const effect of cardBehaviorEffects(card)) {
      const key = effectKey(effect);
      if (!usedEffects.has(key)) usedEffects.set(key, []);
      usedEffects.get(key).push(card.cardNumber);
    }
  }

  const independentEffectKeys = new Set(probes.flatMap((probe) => probe.covers || []));
  const focusedTests = extractTests(options.testSource ?? readTestSource());
  const cardKeysByNumber = new Map();
  for (const [cardKey, card] of Object.entries(registeredCards)) {
    if (!cardKeysByNumber.has(card.cardNumber)) cardKeysByNumber.set(card.cardNumber, new Set());
    cardKeysByNumber.get(card.cardNumber).add(cardKey);
  }
  const focusedCards = new Map();
  for (const card of cardPool) {
    const cardKeys = cardKeysByNumber.get(card.cardNumber) || new Set();
    const evidence = focusedTests
      .filter((entry) => testNamesCard(entry.name, card) || [...cardKeys].some((cardKey) => entry.cardKeys.has(cardKey)))
      .map((entry) => entry.name);
    if (evidence.length) focusedCards.set(card.cardNumber, evidence);
  }
  const focusedEffectKeys = new Set();
  for (const card of cardPool) {
    if (!focusedCards.has(card.cardNumber)) continue;
    for (const effect of cardBehaviorEffects(card)) focusedEffectKeys.add(effectKey(effect));
  }

  const usedEffectKeys = [...usedEffects.keys()].sort();
  const coveredEffectKeys = new Set([...independentEffectKeys, ...focusedEffectKeys]);
  const contractOnlyEffectKeys = usedEffectKeys.filter((key) => !coveredEffectKeys.has(key));
  const orphanRegistryEffectKeys = Object.keys(EFFECT_DEFINITIONS).filter((key) => !usedEffects.has(key)).sort();
  const independentlyCoveredCards = cardPool.filter((card) =>
    !cardBehaviorEffects(card).length || cardBehaviorEffects(card).every((effect) => independentEffectKeys.has(effectKey(effect))));
  const integrationCoveredCards = cardPool.filter((card) =>
    !cardBehaviorEffects(card).length || cardBehaviorEffects(card).every((effect) => coveredEffectKeys.has(effectKey(effect))));

  return {
    schemaVersion: 1,
    usedEffectCount: usedEffectKeys.length,
    registeredEffectCount: Object.keys(EFFECT_DEFINITIONS).length,
    independentEffectCount: usedEffectKeys.filter((key) => independentEffectKeys.has(key)).length,
    focusedIntegrationEffectCount: usedEffectKeys.filter((key) => focusedEffectKeys.has(key)).length,
    coveredEffectCount: usedEffectKeys.filter((key) => coveredEffectKeys.has(key)).length,
    contractOnlyEffectCount: contractOnlyEffectKeys.length,
    cardCount: cardPool.length,
    independentlyCoveredCardCount: independentlyCoveredCards.length,
    integrationCoveredCardCount: integrationCoveredCards.length,
    cardNumbers: cardPool.map((card) => card.cardNumber).sort((left, right) => left.localeCompare(right, "en", { numeric: true })),
    usedEffectKeys,
    independentEffectKeys: [...independentEffectKeys].filter((key) => usedEffects.has(key)).sort(),
    focusedIntegrationEffectKeys: [...focusedEffectKeys].sort(),
    contractOnlyEffectKeys,
    orphanRegistryEffectKeys,
    focusedCardEvidence: Object.fromEntries([...focusedCards.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
}

function cardBehaviorEffects(card) {
  return [...(card.effects || []), ...keywordBehaviorEffectSpecs(card)];
}

export function validateBehaviorCoverageBaseline(coverage, baseline = readBehaviorCoverageBaseline()) {
  const errors = [];
  if (!baseline?.usedEffectKeys?.length) return ["Behavior coverage baseline is missing or empty."];
  const currentUsed = new Set(coverage.usedEffectKeys);
  const currentIndependent = new Set(coverage.independentEffectKeys);
  const currentFocused = new Set(coverage.focusedIntegrationEffectKeys);
  for (const key of baseline.usedEffectKeys || []) {
    if (!currentUsed.has(key)) errors.push(`Previously used effect ${key} disappeared; remove it from the registry/contracts deliberately before refreshing coverage.`);
  }
  for (const key of baseline.independentEffectKeys || []) {
    if (!currentIndependent.has(key)) errors.push(`Independent behavior coverage regressed for ${key}.`);
  }
  for (const key of baseline.focusedIntegrationEffectKeys || []) {
    if (!currentFocused.has(key) && !currentIndependent.has(key)) errors.push(`Focused integration coverage regressed for ${key}.`);
  }
  for (const key of coverage.usedEffectKeys) {
    if ((baseline.usedEffectKeys || []).includes(key)) continue;
    if (!currentIndependent.has(key)) errors.push(`New effect ${key} has no independent behavior probe.`);
  }
  return errors;
}

export function validateNewCardImplementationReferences(cardPool, baseline = readBehaviorCoverageBaseline()) {
  if (!baseline?.cardNumbers?.length) return [];
  const errors = [];
  const baselineCards = new Set(baseline.cardNumbers);
  const reusableEffects = new Set(baseline.usedEffectKeys || []);
  for (const card of cardPool) {
    if (baselineCards.has(card.cardNumber)) continue;
    for (const effect of card.effects || []) {
      const key = effectKey(effect);
      if (!reusableEffects.has(key)) continue;
      const referenceNumber = card.implementationReferences?.[key] || card.implementationReference;
      if (!referenceNumber) {
        errors.push(`${card.cardNumber} ${card.name}: reused effect ${key} must declare an implementation reference to a previously registered same-type card.`);
      } else if (!baselineCards.has(referenceNumber)) {
        errors.push(`${card.cardNumber} ${card.name}: reused effect ${key} references ${referenceNumber}, which was not registered in the previous reviewed baseline.`);
      }
    }
  }
  return errors;
}

export function buildBehaviorCoverageBaseline(coverage) {
  return {
    schemaVersion: 2,
    policy: "New effect pairs require independent probes; new cards reusing effects require implementation references; existing focused coverage may not regress.",
    cardNumbers: coverage.cardNumbers,
    usedEffectKeys: coverage.usedEffectKeys,
    independentEffectKeys: coverage.independentEffectKeys,
    focusedIntegrationEffectKeys: coverage.focusedIntegrationEffectKeys
  };
}

export function readBehaviorCoverageBaseline() {
  if (!fs.existsSync(COVERAGE_BASELINE_PATH)) return { schemaVersion: 1, usedEffectKeys: [] };
  return JSON.parse(fs.readFileSync(COVERAGE_BASELINE_PATH, "utf8"));
}

function readTestSource() {
  const testDir = path.join(ROOT, "tests");
  return fs.readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => fs.readFileSync(path.join(testDir, entry.name), "utf8"))
    .join("\n");
}

function extractTests(source) {
  const matches = [...source.matchAll(/\btest\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/g)];
  return matches.map((match, index) => {
    const body = source.slice(match.index, matches[index + 1]?.index ?? source.length);
    return {
      name: match[1] ?? match[2] ?? match[3],
      cardKeys: new Set([...body.matchAll(/\bcards\.([A-Za-z0-9_$]+)/g)].map((reference) => reference[1]))
    };
  });
}

function testNamesCard(testName, card) {
  return normalize(testName).includes(normalize(card.name));
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
