import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cards } from "../src/cards.mjs";
import { effectKey } from "../src/effects/registry.mjs";
import { keywordBehaviorEffectSpecs } from "../src/rules/keywords.mjs";
import { parseArgs, writeJson } from "./card-script-utils.mjs";
import { runCardRuleBehaviorProbes } from "./card-rules-probes.mjs";
import {
  analyzeCardBehaviorCoverage,
  buildBehaviorCoverageBaseline,
  COVERAGE_BASELINE_PATH,
  readBehaviorCoverageBaseline,
  validateBehaviorCoverageBaseline,
  validateNewCardImplementationReferences
} from "./card-rules-coverage.mjs";
import {
  analyzeEngineWriterInventory,
  buildEngineWriterBaseline,
  ENGINE_WRITER_BASELINE_PATH,
  validateEngineWriterBaseline
} from "./engine-writer-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "spec", "cards", "card-behavior-contracts.json");
const DEFAULT_REPORT_PATH = path.join(ROOT, "artifacts", "card-rules-report.json");
const ENGINE_PATH = path.join(ROOT, "src", "engine.mjs");
const OFFICIAL_OGS_PATH = path.join(ROOT, "spec", "cards", "ogs-official-2026-07-14.json");
const OFFICIAL_GALLERY_PATH = path.join(ROOT, "spec", "cards", "official-gallery-2026-07-14.json");
const CORE_RULES_PATH = path.join(ROOT, "spec", "rules", "core-rules-2026-03-30.json");
const CORE_RULES_CATALOG_PATH = path.join(ROOT, "spec", "rules", "core-rules-catalog-2026-03-30.json");
const CORE_RULE_FAMILIES_PATH = path.join(ROOT, "spec", "rules", "core-rules-families-2026-03-30.json");

const NUMBER_WORDS = Object.freeze({
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
});

const CARD_TRAIT_RULES = Object.freeze([
  ["Reaction", /(?:^|\n)\s*(?:\[\s*)?REACTION(?:\s*\])?\s*(?:\n|$)/im],
  ["Action", /(?:^|\n)\s*(?:\[\s*)?ACTION(?:\s*\])?\s*(?:\n|$)/im]
]);

const ABILITY_TRAIT_RULES = Object.freeze([
  ["Reaction", /\[\s*Reaction\s*\]\s*\[\s*>\s*\]|(?:Tap|Exhaust)\s*:\s*(?:\[\s*)?Reaction\b/i],
  ["Action", /\[\s*Action\s*\]\s*\[\s*>\s*\]|(?:Tap|Exhaust)\s*:\s*(?:\[\s*)?Action\b/i]
]);

const KEYWORD_RULES = Object.freeze([
  ["Accelerate", "accelerate"],
  ["Assault", "assault"],
  ["Ambush", "ambush"],
  ["Backline", "backline"],
  ["Deflect", "deflect"],
  ["Equip", "equip"],
  ["Ganking", "ganking"],
  ["Hidden", "hidden"],
  ["Hunt", "hunt"],
  ["Quick-Draw", "quick-draw"],
  ["Repeat", "repeat"],
  ["Shield", "shield"],
  ["Tank", "tank"],
  ["Temporary", "temporary"],
  ["Unique", "unique"],
  ["Vision", "vision"],
  ["Weaponmaster", "weaponmaster"]
]);

const TEXT_TRIGGER_RULES = Object.freeze([
  { id: "ON_PLAY", pattern: /\bWhen (?:you play (?:me|this)|I'm played)\b/i, timings: ["onPlay"] },
  { id: "CONQUER", pattern: /\bWhen I conquer\b/i, timings: ["conquer", "score"] },
  { id: "HOLD", pattern: /\bWhen I hold\b/i, timings: ["hold", "score"] },
  { id: "MOVE", pattern: /\bWhen I move\b|\bWhen you move me\b/i, timings: ["onMove"] },
  { id: "BEGINNING", pattern: /\bAt the beginning of your turn\b/i, timings: ["beginning", "firstBeginning"] },
  { id: "END_TURN", pattern: /\bAt the end of your turn\b/i, timings: ["endTurn"] },
  { id: "SCORE", pattern: /\bWhen I score\b/i, timings: ["score"] }
]);

export async function judgeCardRules(options = {}) {
  const cardPool = options.cardPool || Object.values(cards);
  const officialCardSnapshots = options.officialCardSnapshots ?? readOfficialCardSnapshots();
  const engineSource = options.engineSource ?? fs.readFileSync(ENGINE_PATH, "utf8");
  const contracts = options.contracts ?? readContracts();
  const findings = [];
  const mutationAudit = options.runMutationAudit === false
    ? { attempted: 0, killed: 0, survived: 0, survivors: [] }
    : runCardMutationAudit(cardPool, contracts);
  for (const survivor of mutationAudit.survivors) {
    findings.push(finding({
      severity: "error",
      code: "JUDGE_MUTATION_SURVIVED",
      scope: survivor.cardNumber,
      message: `${survivor.cardNumber}: ${survivor.mutation} mutation was not detected by the frozen contract.`
    }));
  }

  findings.push(...validateCardContracts(cardPool, contracts));
  for (const card of cardPool) {
    const published = publishedCardRecord(card.cardNumber, officialCardSnapshots);
    findings.push(...deriveTextRuleFindings({
      ...card,
      text: published?.rulesText ? normalizePublishedRulesText(published.rulesText) : card.text
    }));
  }
  findings.push(...validateEngineArchitecture(engineSource));
  const engineWriterInventory = analyzeEngineWriterInventory(engineSource);
  for (const message of validateEngineWriterBaseline(engineWriterInventory, options.engineWriterBaseline)) {
    findings.push(finding({ severity: "error", code: "ENGINE_WRITER_BASELINE_REGRESSION", scope: "architecture", message }));
  }

  let probes = [];
  let coverage = null;
  const coverageBaseline = options.coverageBaseline ?? readBehaviorCoverageBaseline();
  if (options.runBehaviorProbes !== false) {
    probes = await runCardRuleBehaviorProbes();
    for (const probe of probes) {
      if (probe.ok) continue;
      findings.push(finding({
        severity: "error",
        code: `BEHAVIOR_${probe.id}`,
        scope: "engine",
        message: probe.message,
        expected: probe.expected,
        actual: probe.actual,
        reproduction: probe.reproduction
      }));
    }
    coverage = analyzeCardBehaviorCoverage(cardPool, probes, { testSource: options.testSource });
    for (const message of validateBehaviorCoverageBaseline(coverage, coverageBaseline)) {
      findings.push(finding({ severity: "error", code: "BEHAVIOR_COVERAGE_REGRESSION", scope: "coverage", message }));
    }
    for (const message of validateNewCardImplementationReferences(cardPool, coverageBaseline)) {
      findings.push(finding({ severity: "error", code: "NEW_CARD_REFERENCE_MISSING", scope: "coverage", message }));
    }
  }

  const publishedSourceCoverage = analyzePublishedSourceCoverage(cardPool, officialCardSnapshots);
  const coreRuleCoverage = analyzeCoreRuleCoverage(options.coreRuleContracts);
  findings.sort(compareFindings);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cardCount: cardPool.length,
    contractCount: contracts?.cards?.length || 0,
    mutationAudit,
    engineWriterInventory,
    behaviorCoverage: coverage,
    publishedSourceCoverage,
    coreRuleCoverage,
    risks: buildRiskRegister(coverage, publishedSourceCoverage, coreRuleCoverage),
    checkedRuleFamilies: [
      "frozen-card-contracts",
      "text-derived-traits-and-keywords",
      "text-derived-trigger-timing",
      "text-derived-parameter-values",
      "shared-engine-architecture",
      "reviewed-state-writer-inventory",
      "independent-behavior-probes",
      "published-source-provenance"
    ],
    summary: summarize(findings),
    findings
  };
}

export function runCardMutationAudit(cardPool, contracts) {
  const expectedByNumber = new Map((contracts?.cards || []).map((contract) => [contract.cardNumber, contract]));
  const survivors = [];
  let attempted = 0;
  let killed = 0;
  for (const card of cardPool) {
    const expected = expectedByNumber.get(card.cardNumber);
    if (!expected) continue;
    for (const mutation of cardMutations(card)) {
      attempted += 1;
      const actual = cardContract(mutation.card);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) killed += 1;
      else survivors.push({ cardNumber: card.cardNumber, mutation: mutation.id });
    }
  }
  return { attempted, killed, survived: survivors.length, survivors };
}

export function analyzePublishedSourceCoverage(cardPool, snapshots) {
  const sourceSnapshots = snapshots ?? readOfficialCardSnapshots();
  const metadataByNumber = new Map();
  for (const snapshot of sourceSnapshots) {
    for (const card of snapshot.cards || []) {
      metadataByNumber.set(card.cardNumber, {
        authority: snapshot.source?.authority || null,
        title: snapshot.source?.title || null,
        url: snapshot.source?.url || null,
        rulesText: card.rulesText || null
      });
    }
  }
  const directVerifiedCardNumbers = cardPool
    .filter((card) => metadataByNumber.has(card.cardNumber))
    .map((card) => card.cardNumber);
  const derivedVariantCardNumbers = cardPool
    .filter((card) => !metadataByNumber.has(card.cardNumber) && publishedCardRecord(card.cardNumber, sourceSnapshots))
    .map((card) => card.cardNumber);
  const metadataVerifiedCardNumbers = [...directVerifiedCardNumbers, ...derivedVariantCardNumbers]
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const unverifiedCardNumbers = cardPool
    .filter((card) => !publishedCardRecord(card.cardNumber, sourceSnapshots))
    .map((card) => card.cardNumber)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const rulesTextVerifiedCardNumbers = cardPool
    .filter((card) => publishedCardRecord(card.cardNumber, sourceSnapshots)?.rulesText)
    .map((card) => card.cardNumber)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  return {
    schemaVersion: 1,
    scope: "official printed metadata and rules text; executable behavior still requires separate probes",
    cardCount: cardPool.length,
    metadataVerifiedCardCount: metadataVerifiedCardNumbers.length,
    directMetadataVerifiedCardCount: directVerifiedCardNumbers.length,
    derivedVariantCardCount: derivedVariantCardNumbers.length,
    rulesTextVerifiedCardCount: rulesTextVerifiedCardNumbers.length,
    unverifiedCardCount: unverifiedCardNumbers.length,
    metadataVerifiedCardNumbers,
    directVerifiedCardNumbers,
    derivedVariantCardNumbers,
    rulesTextVerifiedCardNumbers,
    unverifiedCardNumbers,
    sources: sourceSnapshots.map((snapshot) => snapshot.source).filter(Boolean)
  };
}

export function analyzeCoreRuleCoverage(contracts) {
  const source = contracts ?? readJsonIfExists(CORE_RULES_PATH) ?? { contracts: [] };
  const catalog = readJsonIfExists(CORE_RULES_CATALOG_PATH) ?? { clauses: [], inventory: {} };
  const familySource = readJsonIfExists(CORE_RULE_FAMILIES_PATH) ?? { families: [] };
  const contractedCatalogIds = new Set((source.contracts || []).flatMap((contract) => referencedRuleIds(contract.id)));
  const applicableClauses = (catalog.clauses || []).filter((clause) => clause.modeScope !== "other-mode");
  const applicableLeaves = applicableClauses.filter((clause) => clause.leaf);
  const familyCoveredLeafIds = new Set(applicableLeaves
    .filter((clause) => (familySource.families || []).some((family) => ruleFamilyContains(family, clause.id)))
    .map((clause) => clause.id));
  const coveredLeafIds = new Set([...contractedCatalogIds, ...familyCoveredLeafIds]);
  return {
    schemaVersion: 2,
    scope: "focused executable contracts plus exhaustive rule-family evidence; traceability is complete but is not a mathematical proof of defect-free behavior",
    rulesVersion: source.rulesVersion || null,
    explicitContractCount: source.contracts?.length || 0,
    exhaustiveFamilyCount: familySource.families?.length || 0,
    ruleIds: (source.contracts || []).map((contract) => contract.id),
    categories: [...new Set((source.contracts || []).map((contract) => contract.category))].sort(),
    catalogClauseCount: catalog.inventory?.clauseCount || catalog.clauses?.length || 0,
    catalogLeafClauseCount: catalog.inventory?.leafClauseCount || 0,
    duelApplicableClauseCount: applicableClauses.length,
    duelApplicableLeafClauseCount: applicableLeaves.length,
    contractedCatalogClauseCount: applicableClauses.filter((clause) => contractedCatalogIds.has(clause.id)).length,
    focusedContractLeafClauseCount: applicableLeaves.filter((clause) => contractedCatalogIds.has(clause.id)).length,
    familyCoveredLeafClauseCount: familyCoveredLeafIds.size,
    contractedLeafClauseCount: applicableLeaves.filter((clause) => coveredLeafIds.has(clause.id)).length,
    uncontractedLeafClauseCount: applicableLeaves.filter((clause) => !coveredLeafIds.has(clause.id)).length,
    contractedCatalogRuleIds: [...contractedCatalogIds].sort((left, right) => left.localeCompare(right, "en", { numeric: true })),
    source: source.source || null
  };
}

function ruleFamilyContains(family, ruleId) {
  const root = Number(String(ruleId || "").split(".")[0]);
  return Number.isInteger(root)
    && Array.isArray(family?.range)
    && root >= Number(family.range[0])
    && root <= Number(family.range[1]);
}

function buildRiskRegister(coverage, publishedSourceCoverage, coreRuleCoverage) {
  const risks = [];
  if (coverage?.contractOnlyEffectCount) {
    risks.push({
      code: "CONTRACT_ONLY_EFFECT_FAMILIES",
      count: coverage.contractOnlyEffectCount,
      effectKeys: coverage.contractOnlyEffectKeys
    });
  }
  if (coverage?.usedEffectCount > coverage?.independentEffectCount) {
    const independent = new Set(coverage.independentEffectKeys);
    risks.push({
      code: "INDEPENDENT_PROBE_MISSING",
      count: coverage.usedEffectCount - coverage.independentEffectCount,
      effectKeys: coverage.usedEffectKeys.filter((key) => !independent.has(key))
    });
  }
  if (publishedSourceCoverage.unverifiedCardCount) {
    risks.push({
      code: "AUTHORITATIVE_CARD_METADATA_MISSING",
      count: publishedSourceCoverage.unverifiedCardCount,
      cardNumbers: publishedSourceCoverage.unverifiedCardNumbers
    });
  }
  if (coreRuleCoverage.uncontractedLeafClauseCount) {
    risks.push({
      code: "CORE_RULE_MODEL_PARTIAL",
      count: coreRuleCoverage.uncontractedLeafClauseCount,
      ruleIds: coreRuleCoverage.ruleIds,
      message: `${coreRuleCoverage.contractedLeafClauseCount}/${coreRuleCoverage.duelApplicableLeafClauseCount} duel-applicable leaf clauses have executable or exhaustive-family evidence.`
    });
  } else {
    risks.push({
      code: "CORE_RULE_EVIDENCE_LIMITATION",
      count: coreRuleCoverage.duelApplicableLeafClauseCount,
      message: "Every duel-applicable leaf is assigned to executable family evidence, but finite tests and oracles cannot prove that no defect exists in every reachable game state."
    });
  }
  return risks;
}

function referencedRuleIds(value) {
  return String(value || "")
    .split("/")
    .flatMap((part) => part.replace(/^RB-/, "").split(/-(?=\d{3}(?:\.|$))/))
    .filter(Boolean);
}

function cardMutations(card) {
  const mutations = [];
  const text = structuredClone(card);
  text.text = `${text.text || ""} [MUTATED]`;
  mutations.push({ id: "rules-text", card: text });

  const identity = structuredClone(card);
  identity.name = `${identity.name} Mutated`;
  mutations.push({ id: "identity", card: identity });

  const cost = structuredClone(card);
  cost.energy = Number.isFinite(cost.energy) ? cost.energy + 1 : 0;
  mutations.push({ id: "cost", card: cost });

  const behavior = structuredClone(card);
  if (behavior.effects?.length) {
    const effect = behavior.effects[0];
    const numericKey = Object.keys(effect).find((key) => typeof effect[key] === "number");
    if (numericKey) effect[numericKey] += 1;
    else effect.kind = `${effect.kind}Mutated`;
  } else if (behavior.additionalCost) {
    behavior.additionalCost.kind = `${behavior.additionalCost.kind}Mutated`;
  } else {
    behavior.tags = [...(behavior.tags || []), "Mutation"];
  }
  mutations.push({ id: "behavior", card: behavior });

  if (card.additionalCost) {
    const additionalCost = structuredClone(card);
    additionalCost.additionalCost.kind = `${additionalCost.additionalCost.kind}Mutated`;
    mutations.push({ id: "additional-cost", card: additionalCost });
  }
  return mutations;
}

export function deriveTextRuleFindings(card) {
  const findings = [];
  const text = normalizeRulesText(card.text || "");
  const label = `${card.cardNumber} ${card.name}`;
  const effects = cardBehaviorEffects(card);

  if (!effects.length && !card.additionalCost && card.type !== "rune" && text && text !== "-" && !isKeywordOnlyRulesText(card, text)) {
    findings.push(cardFinding(card, "TEXT_UNMAPPED_RULES", `${label}: meaningful rules text has neither a shared effect nor a declarative additional cost.`));
  }

  for (const [trait, pattern] of CARD_TRAIT_RULES) {
    if (!pattern.test(text) || hasTrait(card, trait)) continue;
    findings.push(cardFinding(card, `TEXT_MISSING_${trait.toUpperCase()}_TRAIT`, `${label}: card text declares ${trait}, but tags/keywords do not.`));
  }

  for (const [trait, pattern] of ABILITY_TRAIT_RULES) {
    if (!pattern.test(text) || effects.some((effect) => effect.timing === "activated" && hasAbilityTrait(effect, trait))) continue;
    findings.push(cardFinding(card, `TEXT_MISSING_${trait.toUpperCase()}_ABILITY_TRAIT`, `${label}: activated ability text declares ${trait}, but the activated effect does not.`));
  }

  for (const rule of TEXT_TRIGGER_RULES) {
    if (!rule.pattern.test(text) || effects.some((effect) => rule.timings.includes(effect.timing)
      || (rule.id === "ON_PLAY" && effect.timing === "keyword" && ["predict", "quickDrawAttach", "weaponmaster"].includes(effect.kind))
      || (effect.timing === "keyword" && effect.kind === "huntGainXp" && ["CONQUER", "HOLD"].includes(rule.id)))) continue;
    findings.push(cardFinding(card, `TEXT_MISSING_${rule.id}_TIMING`, `${label}: trigger sentence has no compatible shared timing (${rule.timings.join(" or ")}).`));
  }

  for (const [keyword] of KEYWORD_RULES) {
    const amount = leadingKeywordAmount(text, keyword);
    if (amount == null || hasKeyword(card, keyword)) continue;
    findings.push(cardFinding(card, `TEXT_MISSING_${keyword.toUpperCase()}_KEYWORD`, `${label}: card text declares ${keyword}, but keywords do not.`));
  }

  const unconditionalEnterReady = /(?:^|\n)\s*I enter ready\s*\.?\s*(?:\n|$)/im.test(text);
  if (unconditionalEnterReady && !hasEffect(effects, "static", "entersReady")) {
    findings.push(cardFinding(card, "TEXT_MISSING_ENTERS_READY", `${label}: unconditional enter-ready text has no static:entersReady effect.`));
  }
  if (/(?:^|\n)\s*This enters exhausted\s*\.?/im.test(text)
    && !hasEffect(effects, "static", "entersExhausted")) {
    findings.push(cardFinding(card, "TEXT_MISSING_ENTERS_EXHAUSTED", `${label}: unconditional enter-exhausted text has no static:entersExhausted effect.`));
  }
  if (/You may play me to an open battlefield/i.test(text)
    && !hasEffect(effects, "static", "canEnterOpenBattlefield")) {
    findings.push(cardFinding(card, "TEXT_MISSING_OPEN_BATTLEFIELD_ENTRY", `${label}: open-battlefield play permission has no shared static effect.`));
  }
  if (/You may pay (?:Energy )?1 to hide a card with \[?Hidden\]? instead of/i.test(text)
    && !hasEffect(effects, "static", "hideWithEnergyInsteadOfPower")) {
    findings.push(cardFinding(card, "TEXT_MISSING_HIDE_ENERGY_ALTERNATIVE", `${label}: alternate Energy hide cost has no shared static effect.`));
  }
  if (/spells and abilities can't ready enemy units and gear/i.test(text)
    && !hasEffect(effects, "static", "opponentsCannotReadyByEffects")) {
    findings.push(cardFinding(card, "TEXT_MISSING_ENEMY_READY_LOCK", `${label}: enemy ready restriction has no shared static effect.`));
  }
  if (/buff me\. Then, if I am at a battlefield, buff all other friendly units there/i.test(text)
    && !hasEffect(effects, "onPlay", "buffSelfThenOtherFriendlyHere")) {
    findings.push(cardFinding(card, "TEXT_MISSING_GROUP_BUFF", `${label}: self-then-allies buff text has no matching shared on-play effect.`));
  }
  const recycleFromTrashes = /Kill this:\s*Recycle up to (\d+) cards from trashes/i.exec(text);
  if (recycleFromTrashes) {
    const effect = effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "recycleCardsFromTrashes");
    if (!effect || effect.amount !== Number(recycleFromTrashes[1]) || effect.killSelfCost !== true) {
      findings.push(cardFinding(card, "TEXT_RECYCLE_TRASHES_MISMATCH", `${label}: self-kill recycle ability is not represented exactly.`, {
        amount: Number(recycleFromTrashes[1]),
        killSelfCost: true
      }, effect || null));
    }
  }
  if (/If an opponent controls a battlefield, I enter ready/i.test(text)
    && !hasEffect(effects, "static", "enterReadyIfOpponentControlsBattlefield")) {
    findings.push(cardFinding(card, "TEXT_MISSING_CONTROLLED_BATTLEFIELD_READY", `${label}: conditional enter-ready text has no matching shared static effect.`));
  }
  const nearVictory = /If an opponent's score is within (\d+) points? of the Victory Score, I enter ready/i.exec(text);
  if (nearVictory) {
    const effect = effects.find((candidate) => candidate.timing === "static" && candidate.kind === "enterReadyIfOpponentNearVictory");
    if (!effect || effect.points !== Number(nearVictory[1])) {
      findings.push(cardFinding(card, "TEXT_MISSING_NEAR_VICTORY_READY", `${label}: near-victory enter-ready condition is not represented with the published threshold.`, Number(nearVictory[1]), effect?.points ?? null));
    }
  }

  if (/\bWhen I attack\b/i.test(text) && !effects.some((effect) => effect.timing === "attackOrDefend" && (!effect.role || effect.role === "attacker"))) {
    findings.push(cardFinding(card, "TEXT_MISSING_ATTACK_TRIGGER", `${label}: attack trigger text has no attacker attackOrDefend effect.`));
  }
  if (/\bWhen I defend\b/i.test(text) && !effects.some((effect) => effect.timing === "attackOrDefend" && (!effect.role || effect.role === "defender"))) {
    findings.push(cardFinding(card, "TEXT_MISSING_DEFEND_TRIGGER", `${label}: defend trigger text has no defender attackOrDefend effect.`));
  }
  if (/\bWhen you conquer, you may discard 1 to return this from your trash to your hand\b/i.test(text)
    && !hasEffect(effects, "battlefieldControl", "discardReturnSelfFromTrash")) {
    findings.push(cardFinding(card, "TEXT_MISSING_TRASH_CONQUER_TRIGGER", `${label}: trash-zone conquer trigger has no battlefieldControl:discardReturnSelfFromTrash effect.`));
  }
  if (/\bWhen I conquer, you may pay 1 to return me to my owner's hand\b/i.test(text)
    && !hasEffect(effects, "conquer", "payEnergyReturnSelfToHand")) {
    findings.push(cardFinding(card, "TEXT_MISSING_CONQUER_RETURN", `${label}: paid conquer return has no conquer:payEnergyReturnSelfToHand effect.`));
  }
  if (/\bWhen I attack, kill all damaged enemy units here\b/i.test(text)
    && !hasEffect(effects, "attackOrDefend", "killDamagedEnemiesHere")) {
    findings.push(cardFinding(card, "TEXT_MISSING_ATTACK_KILL_DAMAGED", `${label}: attack kill-all-damaged text has no shared attack effect.`));
  }

  const splitDamage = /When I attack, deal (\d+) damage split among any number of enemy units here/i.exec(text);
  if (splitDamage) {
    const effect = effects.find((candidate) => candidate.timing === "attackOrDefend" && candidate.kind === "splitDamageEnemyHere");
    if (!effect || effect.amount !== Number(splitDamage[1])) {
      findings.push(cardFinding(card, "TEXT_SPLIT_DAMAGE_MISMATCH", `${label}: split-damage amount does not match the card text.`, Number(splitDamage[1]), effect?.amount ?? null));
    }
  }

  const duel = /Give a friendly unit \+(\d+) Might this turn\. Then it and an enemy unit deal damage equal to their Mights to each other/i.exec(text);
  if (duel) {
    const effect = effects.find((candidate) => candidate.timing === "spell" && candidate.kind === "duelFriendlyEnemy");
    if (!effect || effect.amount !== Number(duel[1]) || effect.temporary !== true) {
      findings.push(cardFinding(card, "TEXT_DUEL_PARAMETER_MISMATCH", `${label}: duel Might modifier is not represented exactly.`, { amount: Number(duel[1]), temporary: true }, effect || null));
    }
  }

  const tokenMatch = /Play\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^.\n]*?unit tokens?/i.exec(text);
  if (tokenMatch) {
    const count = parseNumber(tokenMatch[1]);
    const tokenEffect = effects.find((candidate) => candidate.kind === "playUnitToken" || candidate.tokenCardNumber);
    if (!tokenEffect || (tokenEffect.count || 1) !== count) {
      findings.push(cardFinding(card, "TEXT_TOKEN_COUNT_MISMATCH", `${label}: token count does not match the card text.`, count, tokenEffect?.count || (tokenEffect ? 1 : null)));
    }
  }
  if (/They can be played to your base or to battlefields you control/i.test(text)) {
    const tokenEffect = effects.find((candidate) => candidate.kind === "playUnitToken" || candidate.tokenCardNumber);
    if (tokenEffect?.destination !== "chooseEachBaseOrControlledBattlefield") {
      findings.push(cardFinding(card, "TEXT_TOKEN_DESTINATION_MISMATCH", `${label}: token placement choices are not represented by the shared destination contract.`, "chooseEachBaseOrControlledBattlefield", tokenEffect?.destination ?? null));
    }
  }

  return dedupeFindings(findings);
}

export function cardContract(card) {
  return {
    cardNumber: card.cardNumber,
    name: card.name,
    set: card.set || null,
    rarity: card.rarity || null,
    textSha256: hash(normalizeRulesText(card.text || "")),
    type: card.type,
    domains: [...(card.domains || [])],
    energy: card.energy ?? null,
    power: (card.power || []).map((requirement) => ({ domain: requirement.domain, amount: requirement.amount })),
    might: card.might ?? null,
    isChampion: Boolean(card.isChampion),
    additionalCost: normalizeContractValue(card.additionalCost ?? null),
    traits: [...new Set([...(card.tags || []), ...(card.keywords || [])])].sort(),
    effects: cardBehaviorEffects(card).map(normalizeEffectContract)
  };
}

function cardBehaviorEffects(card) {
  return [...(card.effects || []), ...keywordBehaviorEffectSpecs(card)];
}

export function buildCardContracts(cardPool = Object.values(cards)) {
  return {
    schemaVersion: 1,
    source: "Frozen repository card semantics; refresh only after published text and behavior review",
    cards: [...cardPool]
      .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber, "en", { numeric: true }))
      .map(cardContract)
  };
}

function validateCardContracts(cardPool, contracts) {
  const findings = [];
  const actualByNumber = new Map(cardPool.map((card) => [card.cardNumber, card]));
  const expectedByNumber = new Map((contracts?.cards || []).map((contract) => [contract.cardNumber, contract]));
  for (const card of cardPool) {
    const expected = expectedByNumber.get(card.cardNumber);
    if (!expected) {
      findings.push(cardFinding(card, "CONTRACT_MISSING_CARD", `${card.cardNumber} ${card.name}: no frozen semantic contract exists.`));
      continue;
    }
    const actual = cardContract(card);
    for (const field of ["name", "set", "rarity", "textSha256", "type", "domains", "energy", "power", "might", "isChampion", "additionalCost", "traits", "effects"]) {
      if (JSON.stringify(actual[field]) === JSON.stringify(expected[field])) continue;
      findings.push(cardFinding(card, `CONTRACT_${field.toUpperCase()}_DRIFT`, `${card.cardNumber} ${card.name}: ${field} differs from the reviewed semantic contract.`, expected[field], actual[field]));
    }
  }
  for (const contract of contracts?.cards || []) {
    if (!actualByNumber.has(contract.cardNumber)) {
      findings.push(finding({ severity: "error", code: "CONTRACT_ORPHAN_CARD", scope: contract.cardNumber, message: `${contract.cardNumber}: contract exists for an unregistered card.` }));
    }
  }
  return findings;
}

export function validateEngineArchitecture(source) {
  const findings = [];
  const functions = sourceFunctions(source);
  const allowedDamageWriters = new Set(["applyDamage", "assignCombatDamage", "resolveCombatDamageChoice"]);
  for (const occurrence of damageWriteOccurrences(source)) {
    if (isDamageReset(occurrence.text)) continue;
    const owner = enclosingFunction(functions, occurrence.index)?.name || "<module>";
    if (allowedDamageWriters.has(owner)) continue;
    findings.push(finding({
      severity: "error",
      code: "ENGINE_DAMAGE_PIPELINE_BYPASS",
      scope: `src/engine.mjs:${lineNumber(source, occurrence.index)}`,
      message: `${owner} writes damage outside the shared damage pipeline.`
    }));
  }

  const allowedEffectiveMightReaders = new Set([
    "effectiveMight",
    "currentMight",
    "currentMightForMightyCondition",
    "currentCombatMight"
  ]);
  for (const occurrence of source.matchAll(/\beffectiveMight\s*\(/g)) {
    const owner = enclosingFunction(functions, occurrence.index)?.name || "<module>";
    if (allowedEffectiveMightReaders.has(owner)) continue;
    findings.push(finding({
      severity: "error",
      code: "ENGINE_CURRENT_MIGHT_BYPASS",
      scope: `src/engine.mjs:${lineNumber(source, occurrence.index)}`,
      message: `${owner} reads printed/attached Might without the shared current-Might rules.`
    }));
  }

  const entityNames = new Set(["unit", "target", "source", "candidate", "friendly", "enemy", "attacker", "defender", "card", "champion", "gear"]);
  for (const occurrence of source.matchAll(/\b([A-Za-z_$][\w$]*)\.might\b/g)) {
    if (!entityNames.has(occurrence[1])) continue;
    const owner = enclosingFunction(functions, occurrence.index)?.name || "<module>";
    if (["effectiveMight", "currentMight", "currentCombatMight", "printedMight"].includes(owner)) continue;
    findings.push(finding({
      severity: "error",
      code: "ENGINE_PRINTED_MIGHT_BYPASS",
      scope: `src/engine.mjs:${lineNumber(source, occurrence.index)}`,
      message: `${owner} reads ${occurrence[1]}.might instead of the shared current-Might calculation.`
    }));
  }

  const cardNameBranches = [
    ...source.matchAll(/(?:name|cardNumber)\s*(?:===?|!==?)\s*["'][^"']+["']/g),
    ...source.matchAll(/["'][^"']+["']\s*(?:===?|!==?)\s*[^;\n]*(?:name|cardNumber)\b/g),
    ...source.matchAll(/\.(?:name|cardNumber)\.(?:includes|startsWith|endsWith)\s*\(\s*["'][^"']+["']/g),
    ...source.matchAll(/switch\s*\([^)]*\.(?:name|cardNumber)\s*\)/g)
  ];
  for (const occurrence of cardNameBranches) {
    findings.push(finding({
      severity: "error",
      code: "ENGINE_CARD_IDENTITY_BRANCH",
      scope: `src/engine.mjs:${lineNumber(source, occurrence.index)}`,
      message: "Shared rules may not branch on a card name or card number."
    }));
  }

  for (const literal of assignedObjectLiterals(source, /game\.pendingChoice\s*=\s*\{/g)) {
    if (/\.\.\.[A-Za-z_$][\w$]*/.test(literal.body)) continue;
    const missing = ["finishSpell", "optional", "fromShowdownChain"]
      .filter((key) => !new RegExp(`\\b${key}\\s*(?::|,|$)`, "m").test(literal.body));
    if (!missing.length) continue;
    findings.push(finding({
      severity: "error",
      code: "ENGINE_CHOICE_CONTINUATION_CONTRACT",
      scope: `src/engine.mjs:${lineNumber(source, literal.index)}`,
      message: `pendingChoice does not explicitly own ${missing.join(", ")}.`
    }));
  }
  return dedupeFindings(findings);
}

function damageWriteOccurrences(source) {
  const occurrences = [];
  const patterns = [
    /\.damage\s*(?:\+=|-=|\*=|\/=|=(?!=)|\+\+|--)[^;\n]*/g,
    /\[\s*["']damage["']\s*\]\s*(?:\+=|-=|\*=|\/=|=(?!=)|\+\+|--)[^;\n]*/g,
    /Object\.assign\s*\([^;\n]*\{[^}\n]*\bdamage\s*:[^}\n]*\}/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) occurrences.push({ index: match.index, text: match[0] });
  }
  return [...new Map(occurrences.map((item) => [item.index, item])).values()].sort((left, right) => left.index - right.index);
}

function isDamageReset(text) {
  return /(?:\.damage|\[\s*["']damage["']\s*\])\s*=\s*0\b/.test(text)
    || /\bdamage\s*:\s*0\b/.test(text);
}

function assignedObjectLiterals(source, assignmentPattern) {
  const literals = [];
  for (const match of source.matchAll(assignmentPattern)) {
    const start = source.indexOf("{", match.index);
    const end = matchingBrace(source, start);
    if (end > start) literals.push({ index: match.index, body: source.slice(start + 1, end) });
  }
  return literals;
}

function matchingBrace(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (character === "\\") { escaped = true; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (["\"", "'", "`"].includes(character)) { quote = character; continue; }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function sourceFunctions(source) {
  const rows = [...source.matchAll(/(?:^|\n)(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)]
    .map((match) => ({ name: match[1], start: match.index + match[0].lastIndexOf("function") }));
  for (let index = 0; index < rows.length; index += 1) rows[index].end = rows[index + 1]?.start ?? source.length;
  return rows;
}

function enclosingFunction(functions, index) {
  return functions.find((item) => item.start <= index && index < item.end) || null;
}

function normalizeEffectContract(effect) {
  return Object.fromEntries(Object.entries(effect)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => {
      const order = ["timing", "kind"];
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
      return left.localeCompare(right);
    }));
}

function normalizeContractValue(value) {
  if (Array.isArray(value)) return value.map(normalizeContractValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeContractValue(item)]));
  }
  return value;
}

function isKeywordOnlyRulesText(card, normalizedText) {
  if (!(card.keywords || []).length) return false;
  let remaining = normalizedText
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:action|reaction)\b/gi, " ")
    .replace(/\bplay any time, even before spells and abilities resolve, including to a battlefield you control\b/gi, " ");
  for (const keyword of card.keywords || []) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remaining = remaining.replace(new RegExp(`\\b${escaped}\\b(?:\\s+\\d+)?`, "gi"), " ");
  }
  return !remaining.replace(/[^a-z0-9]+/gi, "").trim();
}

function normalizeRulesText(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function leadingKeywordAmount(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*(?:\\[\\s*)?${escaped}(?:\\s+(\\d+))?(?:\\s*\\])?\\b`, "i").exec(text);
  if (!match) return null;
  return Number(match[1] || 1);
}

function hasKeyword(card, keyword) {
  return (card.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase());
}

function hasTrait(card, trait) {
  return [...(card.tags || []), ...(card.keywords || [])].some((item) => item.toLowerCase() === trait.toLowerCase());
}

function hasAbilityTrait(effect, trait) {
  return (effect.abilityKeywords || []).some((item) => item.toLowerCase() === trait.toLowerCase());
}

function hasEffect(effects, timing, kind) {
  return effects.some((effect) => effect.timing === timing && effect.kind === kind);
}

function parseNumber(value) {
  const normalized = String(value).toLowerCase();
  return /^\d+$/.test(normalized) ? Number(normalized) : NUMBER_WORDS[normalized] || 0;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readContracts() {
  if (!fs.existsSync(CONTRACT_PATH)) return { schemaVersion: 1, cards: [] };
  return JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
}

function readOfficialCardSnapshots() {
  return [readJsonIfExists(OFFICIAL_OGS_PATH), readJsonIfExists(OFFICIAL_GALLERY_PATH)].filter(Boolean);
}

function publishedCardRecord(cardNumber, snapshots = readOfficialCardSnapshots()) {
  const records = new Map();
  for (const snapshot of snapshots || []) {
    for (const card of snapshot.cards || []) records.set(card.cardNumber, card);
  }
  if (records.has(cardNumber)) return records.get(cardNumber);
  const variant = /^(OGN-\d+)[bs]\/298$/i.exec(cardNumber || "");
  return variant ? records.get(`${variant[1]}/298`) || null : null;
}

function normalizePublishedRulesText(text) {
  return String(text)
    .replace(/:rb_might:/gi, "Might")
    .replace(/:rb_exhaust:/gi, "Exhaust")
    .replace(/:rb_energy_(\d+):/gi, "$1 Energy")
    .replace(/:rb_rune_[a-z_]+:/gi, "Power")
    .replace(/:rb_rune_rainbow:/gi, "Power");
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function cardFinding(card, code, message, expected, actual) {
  return finding({ severity: "error", code, scope: card.cardNumber, cardNumber: card.cardNumber, cardName: card.name, message, expected, actual });
}

function finding(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.scope}:${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareFindings(left, right) {
  return `${left.scope}:${left.code}`.localeCompare(`${right.scope}:${right.code}`, "en", { numeric: true });
}

function summarize(findings) {
  const byCode = {};
  const bySeverity = {};
  for (const item of findings) {
    byCode[item.code] = (byCode[item.code] || 0) + 1;
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
  }
  return { total: findings.length, errors: bySeverity.error || 0, warnings: bySeverity.warning || 0, byCode };
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args["update-contracts"]) {
    writeJson(CONTRACT_PATH, buildCardContracts());
    console.log(`Updated frozen card contracts for ${Object.keys(cards).length} cards.`);
    return;
  }
  if (args["update-architecture"]) {
    const engineSource = fs.readFileSync(ENGINE_PATH, "utf8");
    const inventory = analyzeEngineWriterInventory(engineSource);
    writeJson(ENGINE_WRITER_BASELINE_PATH, buildEngineWriterBaseline(inventory));
    const count = Object.values(inventory.categories).reduce((sum, signatures) => sum + Object.values(signatures).reduce((inner, value) => inner + value, 0), 0);
    console.log(`Updated reviewed engine writer baseline for ${count} direct state writes.`);
    return;
  }
  if (args["update-coverage"]) {
    const probes = await runCardRuleBehaviorProbes();
    const coverage = analyzeCardBehaviorCoverage(Object.values(cards), probes);
    const failures = probes.filter((probe) => !probe.ok).map((probe) => `${probe.id}: ${probe.message}`);
    const baseline = readBehaviorCoverageBaseline();
    const currentEffectKeys = new Set(coverage.usedEffectKeys);
    const removedEffectKeys = new Set((baseline.usedEffectKeys || []).filter((key) => !currentEffectKeys.has(key)));
    const coverageErrors = validateBehaviorCoverageBaseline(coverage, baseline)
      .filter((message) => !args["allow-effect-removal"] || ![...removedEffectKeys].some((key) => message.includes(key)));
    const gateErrors = [
      ...failures,
      ...coverageErrors,
      ...validateNewCardImplementationReferences(Object.values(cards), baseline)
    ];
    if (gateErrors.length) {
      console.error(`Refusing to update behavior coverage baseline (${gateErrors.length} gate error(s)):`);
      for (const error of gateErrors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    writeJson(COVERAGE_BASELINE_PATH, buildBehaviorCoverageBaseline(coverage));
    console.log(`Updated behavior coverage baseline for ${coverage.usedEffectCount} used effect pairs.`);
    return;
  }
  const report = await judgeCardRules();
  const reportPath = args.output ? path.resolve(ROOT, String(args.output)) : DEFAULT_REPORT_PATH;
  writeJson(reportPath, report);
  if (report.findings.length) {
    console.error(`Card rules judge found ${report.findings.length} violation(s). Report: ${path.relative(ROOT, reportPath)}`);
    for (const item of report.findings.slice(0, 80)) console.error(`- [${item.code}] ${item.scope}: ${item.message}`);
    if (report.findings.length > 80) console.error(`- ... ${report.findings.length - 80} more in the JSON report.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Card rules judge verified ${report.cardCount} cards, killed ${report.mutationAudit.killed}/${report.mutationAudit.attempted} card mutants, and covered ${report.behaviorCoverage.coveredEffectCount}/${report.behaviorCoverage.usedEffectCount} effect pairs with focused behavior evidence. Report: ${path.relative(ROOT, reportPath)}`);
  if (report.behaviorCoverage.contractOnlyEffectCount) console.log(`${report.behaviorCoverage.contractOnlyEffectCount} effect pairs remain contract-only risks in the report.`);
  console.log(`Authoritative printed metadata is snapshotted for ${report.publishedSourceCoverage.metadataVerifiedCardCount}/${report.cardCount} cards; ${report.coreRuleCoverage.exhaustiveFamilyCount} exhaustive families cover ${report.coreRuleCoverage.familyCoveredLeafClauseCount}/${report.coreRuleCoverage.duelApplicableLeafClauseCount} duel-applicable Core Rules leaves, with ${report.coreRuleCoverage.explicitContractCount} focused contracts.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await run();
