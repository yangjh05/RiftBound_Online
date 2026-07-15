import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cards } from "../src/cards.mjs";
import { RULE_ORACLE_CHECKS } from "./rules-oracle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = path.join(ROOT, "spec", "rules", "core-rules-2026-03-30.json");
const RULES_CATALOG_PATH = path.join(ROOT, "spec", "rules", "core-rules-catalog-2026-03-30.json");
const RULE_FAMILIES_PATH = path.join(ROOT, "spec", "rules", "core-rules-families-2026-03-30.json");
const VERIFICATION_LEDGER_PATH = path.join(ROOT, "spec", "rules", "verification-ledger-2026-03-30.json");
const INTERPRETATION_SETUP_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "interpretation-and-deck-setup-2026-03-30.json");
const TURN_TASKS_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "turn-tasks-and-cleanup-2026-03-30.json");
const CHAINS_SHOWDOWNS_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "chains-and-showdowns-2026-03-30.json");
const OBJECTS_ZONES_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "objects-zones-resources-and-control-2026-03-30.json");
const CORE_ACTIONS_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "core-zone-and-movement-actions-2026-03-30.json");
const COMBAT_SCORING_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "combat-scoring-layers-and-ending-2026-03-30.json");
const KEYWORD_SEMANTICS_LEDGER_PATH = path.join(ROOT, "spec", "rules", "workstreams", "keyword-semantics-2026-03-30.json");
const OGS_PATH = path.join(ROOT, "spec", "cards", "ogs-official-2026-07-14.json");
const OFFICIAL_GALLERY_PATH = path.join(ROOT, "spec", "cards", "official-gallery-2026-07-14.json");

export const ruleContracts = readJson(RULES_PATH);
export const coreRulesCatalog = readJson(RULES_CATALOG_PATH);
export const coreRuleFamilies = readJson(RULE_FAMILIES_PATH);
export const verificationLedger = readJson(VERIFICATION_LEDGER_PATH);
export const interpretationSetupVerificationLedger = readJson(INTERPRETATION_SETUP_LEDGER_PATH);
export const turnTasksVerificationLedger = readJson(TURN_TASKS_LEDGER_PATH);
export const chainsShowdownsVerificationLedger = readJson(CHAINS_SHOWDOWNS_LEDGER_PATH);
export const objectsZonesVerificationLedger = readJson(OBJECTS_ZONES_LEDGER_PATH);
export const coreActionsVerificationLedger = readJson(CORE_ACTIONS_LEDGER_PATH);
export const combatScoringVerificationLedger = readJson(COMBAT_SCORING_LEDGER_PATH);
export const keywordSemanticsVerificationLedger = readJson(KEYWORD_SEMANTICS_LEDGER_PATH);
export const verificationWorkstreamLedgers = Object.freeze([
  interpretationSetupVerificationLedger,
  turnTasksVerificationLedger,
  chainsShowdownsVerificationLedger,
  objectsZonesVerificationLedger,
  coreActionsVerificationLedger,
  combatScoringVerificationLedger,
  keywordSemanticsVerificationLedger
]);
export const officialOgsSnapshot = readJson(OGS_PATH);
export const officialGallerySnapshot = readJson(OFFICIAL_GALLERY_PATH);

export function validateRuleContracts(contracts = ruleContracts) {
  const errors = [
    ...validateCoreRulesCatalog(coreRulesCatalog),
    ...validateRuleFamilies(coreRuleFamilies, coreRulesCatalog),
    ...validateVerificationLedger(verificationLedger, coreRuleFamilies, coreRulesCatalog),
    ...verificationWorkstreamLedgers.flatMap((ledger) =>
      validateWorkstreamLedger(ledger, verificationLedger, coreRulesCatalog))
  ];
  if (verificationLedger.completionGate?.readyForAiTraining) {
    for (const ledger of verificationWorkstreamLedgers) {
      if (ledger.cases.some((verificationCase) => verificationCase.status !== "verified")) {
        errors.push(`AI-training gate is open while ${ledger.workstreamId} leaf cases remain unresolved`);
      }
    }
  }
  if (!contracts.rulesVersion) errors.push("rulesVersion is missing");
  if (contracts.source?.authority !== "Riot Games / Riftbound") errors.push("Core Rules source is not authoritative");
  if (!/^https:\/\/.*\.pdf$/i.test(contracts.source?.url || "")) errors.push("Core Rules PDF URL is invalid");
  if (!/^[A-F0-9]{64}$/.test(contracts.source?.sha256 || "")) errors.push("Core Rules SHA-256 is invalid");

  const ids = new Set();
  const registeredOracleChecks = new Set(RULE_ORACLE_CHECKS.map((entry) => entry.checkId));
  const catalogIds = new Set(coreRulesCatalog.clauses.map((clause) => clause.id));
  const contractedOracleChecks = new Set();
  const testSources = testSourceCorpus();
  for (const contract of contracts.contracts || []) {
    if (!contract.id || ids.has(contract.id)) errors.push(`duplicate or missing rule id: ${contract.id || "<missing>"}`);
    ids.add(contract.id);
    for (const ruleId of referencedRuleIds(contract.id)) {
      if (!catalogIds.has(ruleId)) errors.push(`${contract.id} references rule ${ruleId}, which is absent from the official catalog`);
    }
    if (!contract.summary) errors.push(`${contract.id} has no summary`);
    if (!contract.boundaryAxes?.length) errors.push(`${contract.id} has no boundary axes`);
    if (!contract.evidenceTests?.length) errors.push(`${contract.id} has no executable evidence`);
    for (const testName of contract.evidenceTests || []) {
      if (!testSources.includes(`test("${testName}"`)) errors.push(`${contract.id} references missing test: ${testName}`);
    }
    for (const checkId of contract.oracleChecks || []) {
      if (!registeredOracleChecks.has(checkId)) errors.push(`${contract.id} references unknown oracle check: ${checkId}`);
      contractedOracleChecks.add(checkId);
    }
  }
  for (const checkId of registeredOracleChecks) {
    if (!contractedOracleChecks.has(checkId)) errors.push(`runtime oracle check has no official rules contract: ${checkId}`);
  }
  for (const oracle of RULE_ORACLE_CHECKS) {
    for (const ruleId of referencedRuleIds(oracle.ruleId)) {
      if (!catalogIds.has(ruleId)) errors.push(`runtime oracle ${oracle.checkId} references rule ${ruleId}, which is absent from the official catalog`);
    }
  }
  for (const category of ["lethal-threshold", "cleanup-fixed-point", "lethal-destination", "combat-cleanup-order", "death-replacement"]) {
    if (!(contracts.contracts || []).some((contract) => contract.category === category)) errors.push(`missing required rule category: ${category}`);
  }
  return errors;
}

export function validateWorkstreamLedger(
  ledger = turnTasksVerificationLedger,
  progressLedger = verificationLedger,
  catalog = coreRulesCatalog
) {
  const errors = [];
  if (ledger.schemaVersion !== 1) errors.push(`${ledger.workstreamId || "workstream"} ledger schema version is unsupported`);
  if (ledger.rulesVersion !== catalog.rulesVersion) errors.push(`${ledger.workstreamId || "workstream"} ledger version differs from the official catalog`);
  if (!(progressLedger.remainingWorkstreams || []).some((workstream) => workstream.id === ledger.workstreamId)) {
    errors.push(`${ledger.workstreamId || "<missing>"} has no parent verification workstream`);
  }
  const ranges = ledger.ranges || (ledger.range ? [ledger.range] : []);
  if (!ranges.length || ranges.some((range) => !validMajorRange(range))) {
    errors.push(`${ledger.workstreamId || "workstream"} has an invalid rule range`);
  }
  const expectedLeaves = (catalog.clauses || []).filter((clause) => {
    const major = Number(clause.id.split(".")[0]);
    return clause.leaf && ranges.some(([first, last]) => major >= first && major <= last);
  });
  const expectedIds = new Set(expectedLeaves.map((clause) => clause.id));
  const assignments = new Map([...expectedIds].map((ruleId) => [ruleId, []]));
  const testSources = testSourceCorpus();
  const caseIds = new Set();
  const validStatuses = new Set(["verified", "partial", "unverified"]);
  const validDispositions = new Set(["structural", "executable", "other-mode"]);
  for (const verificationCase of ledger.cases || []) {
    if (!verificationCase.id || caseIds.has(verificationCase.id)) errors.push(`duplicate or missing ${ledger.workstreamId} case id: ${verificationCase.id || "<missing>"}`);
    caseIds.add(verificationCase.id);
    if (!validStatuses.has(verificationCase.status)) errors.push(`${verificationCase.id} has an invalid case status`);
    if (!validDispositions.has(verificationCase.disposition)) errors.push(`${verificationCase.id} has an invalid case disposition`);
    const caseRanges = verificationCase.ruleRanges || [];
    if (caseRanges.some((range) => !validMajorRange(range))) errors.push(`${verificationCase.id} has an invalid case rule range`);
    const expandedRuleIds = [...new Set([
      ...(verificationCase.ruleIds || []),
      ...expectedLeaves.filter((clause) => {
        const major = Number(clause.id.split(".")[0]);
        return caseRanges.some(([first, last]) => major >= first && major <= last);
      }).map((clause) => clause.id)
    ])];
    if (!expandedRuleIds.length) errors.push(`${verificationCase.id} has no leaf rule ids`);
    if (verificationCase.status !== "unverified" && !verificationCase.evidenceTests?.length) {
      errors.push(`${verificationCase.id} has no executable or structural evidence`);
    }
    for (const testName of verificationCase.evidenceTests || []) {
      if (!testSources.includes(`test("${testName}"`)) errors.push(`${verificationCase.id} references missing test: ${testName}`);
    }
    if (!verificationCase.remaining) errors.push(`${verificationCase.id} has no remaining-work record`);
    if (verificationCase.status === "verified" && !/^None\b/.test(verificationCase.remaining)) {
      errors.push(`${verificationCase.id} is verified but still records unfinished behavior`);
    }
    for (const ruleId of expandedRuleIds) {
      if (!expectedIds.has(ruleId)) {
        errors.push(`${verificationCase.id} references ${ruleId}, which is not a leaf in this workstream's rule ranges`);
        continue;
      }
      assignments.get(ruleId).push(verificationCase.id);
    }
  }
  for (const [ruleId, owners] of assignments) {
    if (owners.length === 0) errors.push(`${ledger.workstreamId} leaf ${ruleId} has no verification case`);
    if (owners.length > 1) errors.push(`${ledger.workstreamId} leaf ${ruleId} belongs to multiple cases: ${owners.join(", ")}`);
  }

  const parent = (progressLedger.remainingWorkstreams || []).find((workstream) => workstream.id === ledger.workstreamId);
  const hasUnresolvedCases = (ledger.cases || []).some((verificationCase) => verificationCase.status !== "verified");
  if (hasUnresolvedCases && parent?.status === "verified") errors.push(`${ledger.workstreamId} parent is verified while leaf cases remain unresolved`);
  return errors;
}

function validMajorRange(range) {
  return Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] <= range[1];
}

export function validateVerificationLedger(
  ledger = verificationLedger,
  familyLedger = coreRuleFamilies,
  catalog = coreRulesCatalog
) {
  const errors = [];
  if (ledger.rulesVersion !== catalog.rulesVersion) errors.push("Rules verification ledger version differs from the official catalog");
  if (ledger.sourceSha256 !== catalog.source?.sha256) errors.push("Rules verification ledger PDF hash differs from the official catalog");
  if (ledger.schemaVersion !== 1) errors.push("Rules verification ledger schema version is unsupported");

  const officialLeaves = (catalog.clauses || []).filter((clause) => clause.leaf);
  const duelLeaves = officialLeaves.filter((clause) => clause.modeScope !== "other-mode");
  const otherModeLeaves = officialLeaves.filter((clause) => clause.modeScope === "other-mode");
  const expectedScope = {
    catalogClauses: catalog.clauses?.length || 0,
    catalogLeaves: officialLeaves.length,
    duelApplicableLeaves: duelLeaves.length,
    otherModeLeaves: otherModeLeaves.length
  };
  for (const [field, expected] of Object.entries(expectedScope)) {
    if (ledger.scope?.[field] !== expected) errors.push(`Rules verification ledger ${field} expected ${expected}, got ${ledger.scope?.[field] ?? "missing"}`);
  }

  for (const status of ["verified", "partial", "unverified"]) {
    if (!ledger.statusDefinitions?.[status]) errors.push(`Rules verification ledger has no definition for ${status}`);
  }
  if (typeof ledger.completionGate?.readyForAiTraining !== "boolean") errors.push("Rules verification ledger has no boolean AI-training gate");
  if (!ledger.completionGate?.requirements?.length) errors.push("Rules verification ledger has no completion requirements");

  const catalogIds = new Set((catalog.clauses || []).map((clause) => clause.id));
  const testSources = testSourceCorpus();
  const milestoneIds = new Set();
  for (const milestone of ledger.verifiedMilestones || []) {
    if (!milestone.id || milestoneIds.has(milestone.id)) errors.push(`duplicate or missing verified milestone id: ${milestone.id || "<missing>"}`);
    milestoneIds.add(milestone.id);
    if (!milestone.ruleIds?.length) errors.push(`${milestone.id} has no official rule ids`);
    for (const ruleId of milestone.ruleIds || []) {
      if (!catalogIds.has(ruleId)) errors.push(`${milestone.id} references rule ${ruleId}, which is absent from the official catalog`);
    }
    if (!milestone.summary) errors.push(`${milestone.id} has no verification summary`);
    if (!milestone.evidenceTests?.length) errors.push(`${milestone.id} has no executable evidence`);
    for (const testName of milestone.evidenceTests || []) {
      if (!testSources.includes(`test("${testName}"`)) errors.push(`${milestone.id} references missing test: ${testName}`);
    }
    if (!milestone.anchors?.length) errors.push(`${milestone.id} has no implementation anchor`);
    for (const anchor of milestone.anchors || []) validateLedgerAnchor(errors, milestone.id, anchor);
  }

  const validStatuses = new Set(["verified", "partial", "unverified"]);
  const workstreamIds = new Set();
  const knownFamilyIds = new Set((familyLedger.families || []).map((family) => family.id));
  const familyOwners = new Map([...knownFamilyIds].map((familyId) => [familyId, []]));
  for (const workstream of ledger.remainingWorkstreams || []) {
    if (!workstream.id || workstreamIds.has(workstream.id)) errors.push(`duplicate or missing rules workstream id: ${workstream.id || "<missing>"}`);
    workstreamIds.add(workstream.id);
    if (!Number.isInteger(workstream.priority) || workstream.priority < 0) errors.push(`${workstream.id} has an invalid priority`);
    if (!validStatuses.has(workstream.status)) errors.push(`${workstream.id} has an invalid verification status: ${workstream.status || "<missing>"}`);
    for (const field of ["verifiedSoFar", "remaining", "exitCriteria"]) {
      if (!workstream[field]) errors.push(`${workstream.id} has no ${field} record`);
    }
    const localFamilyIds = new Set();
    for (const familyId of workstream.familyIds || []) {
      if (localFamilyIds.has(familyId)) errors.push(`${workstream.id} repeats rule family ${familyId}`);
      localFamilyIds.add(familyId);
      if (!knownFamilyIds.has(familyId)) {
        errors.push(`${workstream.id} references unknown rule family ${familyId}`);
        continue;
      }
      familyOwners.get(familyId).push(workstream.id);
    }
  }
  for (const [familyId, owners] of familyOwners) {
    if (owners.length === 0) errors.push(`rule family ${familyId} has no verification workstream`);
    if (owners.length > 1) errors.push(`rule family ${familyId} belongs to multiple verification workstreams: ${owners.join(", ")}`);
  }

  const unresolvedWorkstreams = (ledger.remainingWorkstreams || []).filter((workstream) => workstream.status !== "verified");
  if (unresolvedWorkstreams.length > 0 && ledger.completionGate?.readyForAiTraining) {
    errors.push("AI-training gate is open while rules verification workstreams remain unresolved");
  }
  if ((ledger.remainingWorkstreams || []).length === 0) errors.push("Rules verification ledger has no remaining-workstream inventory");
  return errors;
}

export function validateRuleFamilies(ledger = coreRuleFamilies, catalog = coreRulesCatalog) {
  const errors = [];
  if (ledger.rulesVersion !== catalog.rulesVersion) errors.push("Core Rules family ledger version differs from the official catalog");
  if (ledger.sourceSha256 !== catalog.source?.sha256) errors.push("Core Rules family ledger PDF hash differs from the official catalog");
  if (ledger.scope !== "duel-applicable-leaf-clauses") errors.push("Core Rules family ledger has an unsupported scope");
  const testSources = testSourceCorpus();
  const registeredOracleChecks = new Set(RULE_ORACLE_CHECKS.map((entry) => entry.checkId));
  const familyIds = new Set();
  const applicableLeaves = catalog.clauses.filter((clause) => clause.leaf && clause.modeScope !== "other-mode");
  const assignments = new Map(applicableLeaves.map((clause) => [clause.id, []]));
  for (const family of ledger.families || []) {
    if (!family.id || familyIds.has(family.id)) errors.push(`duplicate or missing rule family id: ${family.id || "<missing>"}`);
    familyIds.add(family.id);
    if (!Array.isArray(family.range) || family.range.length !== 2
      || !family.range.every(Number.isInteger) || family.range[0] > family.range[1]) {
      errors.push(`${family.id} has an invalid major-rule range`);
      continue;
    }
    if (!['executable', 'structural'].includes(family.disposition)) errors.push(`${family.id} has an invalid disposition`);
    if (!family.evidenceTests?.length) errors.push(`${family.id} has no executable evidence test`);
    for (const testName of family.evidenceTests || []) {
      if (!testSources.includes(`test("${testName}"`)) errors.push(`${family.id} references missing test: ${testName}`);
    }
    if (!family.anchors?.length) errors.push(`${family.id} has no implementation anchor`);
    for (const anchor of family.anchors || []) {
      const anchorPath = path.resolve(ROOT, anchor.file || "");
      if (!anchor.file || !fs.existsSync(anchorPath) || !fs.statSync(anchorPath).isFile()) {
        errors.push(`${family.id} references missing implementation file: ${anchor.file || "<missing>"}`);
        continue;
      }
      if (!anchor.symbol || !fs.readFileSync(anchorPath, "utf8").includes(anchor.symbol)) {
        errors.push(`${family.id} implementation anchor is stale: ${anchor.file}#${anchor.symbol || "<missing>"}`);
      }
    }
    for (const checkId of family.oracleChecks || []) {
      if (!registeredOracleChecks.has(checkId)) errors.push(`${family.id} references unknown oracle check: ${checkId}`);
    }
    const matched = applicableLeaves.filter((clause) => {
      const major = Number(clause.id.split(".")[0]);
      return major >= family.range[0] && major <= family.range[1];
    });
    if (matched.length !== family.expectedLeaves) {
      errors.push(`${family.id} expected ${family.expectedLeaves} leaves but matches ${matched.length}`);
    }
    for (const clause of matched) assignments.get(clause.id).push(family.id);
  }
  for (const [ruleId, owners] of assignments) {
    if (owners.length === 0) errors.push(`official duel leaf ${ruleId} has no rule family`);
    if (owners.length > 1) errors.push(`official duel leaf ${ruleId} belongs to multiple rule families: ${owners.join(", ")}`);
  }
  return errors;
}

export function validateCoreRulesCatalog(catalog = coreRulesCatalog) {
  const errors = [];
  if (catalog.rulesVersion !== "2026-03-30") errors.push("Core Rules catalog version is not 2026-03-30");
  if (catalog.source?.authority !== "Riot Games / Riftbound") errors.push("Core Rules catalog source is not authoritative");
  if (catalog.source?.sha256 !== ruleContracts.source?.sha256) errors.push("Core Rules catalog PDF hash differs from the executable contract source");
  if (catalog.source?.pageCount !== 98) errors.push(`Core Rules catalog expected 98 pages, got ${catalog.source?.pageCount ?? "missing"}`);
  const clauses = catalog.clauses || [];
  const ids = new Set();
  for (const clause of clauses) {
    if (!/^\d{3}(?:(?:\.\d+)|(?:\.[a-z]))*$/.test(clause.id || "")) errors.push(`invalid catalog rule id: ${clause.id || "<missing>"}`);
    if (ids.has(clause.id)) errors.push(`duplicate catalog rule id: ${clause.id}`);
    ids.add(clause.id);
    if (!clause.text) errors.push(`${clause.id} has no official rule text`);
    if (!Number.isInteger(clause.page) || clause.page < 1 || clause.page > 98) errors.push(`${clause.id} has invalid source page ${clause.page}`);
    const expectedLeaf = !clauses.some((candidate) => candidate.id?.startsWith(`${clause.id}.`));
    if (clause.leaf !== expectedLeaf) errors.push(`${clause.id} has stale leaf classification`);
  }
  const leafCount = clauses.filter((clause) => clause.leaf).length;
  const duelApplicable = clauses.filter((clause) => clause.modeScope !== "other-mode");
  if (catalog.inventory?.clauseCount !== clauses.length) errors.push("Core Rules catalog clause count is stale");
  if (catalog.inventory?.leafClauseCount !== leafCount) errors.push("Core Rules catalog leaf count is stale");
  if (catalog.inventory?.duelApplicableClauseCount !== duelApplicable.length) errors.push("Core Rules catalog duel clause count is stale");
  if (catalog.inventory?.duelApplicableLeafClauseCount !== duelApplicable.filter((clause) => clause.leaf).length) errors.push("Core Rules catalog duel leaf count is stale");
  const normalizedText = clauses.map((clause) => `${clause.id}\t${clause.text}`).join("\n");
  const normalizedHash = crypto.createHash("sha256").update(normalizedText).digest("hex").toUpperCase();
  if (catalog.source?.normalizedTextSha256 !== normalizedHash) errors.push("Core Rules catalog normalized text hash is stale");
  return errors;
}

export function analyzeRuleCatalogCoverage(contracts = ruleContracts, catalog = coreRulesCatalog) {
  const contractedIds = new Set((contracts.contracts || []).flatMap((contract) => referencedRuleIds(contract.id)));
  const applicable = catalog.clauses.filter((clause) => clause.modeScope !== "other-mode");
  const applicableLeaves = applicable.filter((clause) => clause.leaf);
  const familyCoveredIds = new Set();
  for (const family of coreRuleFamilies.families || []) {
    for (const clause of applicableLeaves) {
      const major = Number(clause.id.split(".")[0]);
      if (major >= family.range[0] && major <= family.range[1]) familyCoveredIds.add(clause.id);
    }
  }
  return {
    catalogClauseCount: catalog.clauses.length,
    catalogLeafClauseCount: catalog.inventory.leafClauseCount,
    duelApplicableClauseCount: applicable.length,
    duelApplicableLeafClauseCount: applicableLeaves.length,
    contractedCatalogClauseCount: applicable.filter((clause) => contractedIds.has(clause.id)).length,
    contractedLeafClauseCount: applicableLeaves.filter((clause) => contractedIds.has(clause.id)).length,
    uncontractedLeafClauseCount: applicableLeaves.filter((clause) => !contractedIds.has(clause.id)).length,
    familyCount: coreRuleFamilies.families?.length || 0,
    familyCoveredLeafClauseCount: familyCoveredIds.size,
    familyUncoveredLeafClauseCount: applicableLeaves.filter((clause) => !familyCoveredIds.has(clause.id)).length,
    contractedRuleIds: [...contractedIds].sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
  };
}

export function referencedRuleIds(value) {
  return String(value || "")
    .split("/")
    .flatMap((part) => part.replace(/^RB-/, "").split(/-(?=\d{3}(?:\.|$))/))
    .filter(Boolean);
}

export function comparePublishedCards(cardPool = Object.values(cards), snapshot = officialOgsSnapshot) {
  const errors = [];
  const byNumber = new Map(cardPool.map((card) => [card.cardNumber, card]));
  for (const expected of snapshot.cards || []) {
    const actual = byNumber.get(expected.cardNumber);
    if (!actual) {
      errors.push(`${expected.cardNumber} is not registered`);
      continue;
    }
    compare(errors, expected.cardNumber, "type", actual.type, expected.type);
    compare(errors, expected.cardNumber, "Energy", actual.energy ?? null, expected.energy ?? null);
    compare(errors, expected.cardNumber, "Might", actual.might ?? null, expected.might ?? null);
    compare(errors, expected.cardNumber, "Power total", totalPower(actual.power), expected.powerAmount || 0);
    compare(errors, expected.cardNumber, "domains", [...(actual.domains || [])].sort(), [...(expected.domains || [])].sort());
    for (const superType of expected.superTypes || []) {
      if (!(actual.tags || []).includes(superType)) errors.push(`${expected.cardNumber} is missing supertype tag ${superType}`);
    }
    for (const tag of expected.tags || []) {
      if (!(actual.tags || []).includes(tag)) errors.push(`${expected.cardNumber} is missing published tag ${tag}`);
    }
  }
  return errors;
}

export function validatePublishedCards() {
  const errors = [];
  if (officialOgsSnapshot.source?.authority !== "Riot Games / Riftbound") errors.push("OGS snapshot source is not authoritative");
  if (officialOgsSnapshot.cards?.length !== 24) errors.push(`OGS snapshot contains ${officialOgsSnapshot.cards?.length || 0} cards instead of 24`);
  errors.push(...comparePublishedCards());
  if (officialGallerySnapshot.source?.authority !== "Riot Games / Riftbound") errors.push("official gallery snapshot source is not authoritative");
  if (officialGallerySnapshot.source?.url !== "https://playriftbound.com/en-us/card-gallery/") errors.push("official gallery snapshot URL is invalid");
  if (!/^[A-F0-9]{64}$/.test(officialGallerySnapshot.source?.nextDataSha256 || "")) errors.push("official gallery snapshot SHA-256 is invalid");
  if (officialGallerySnapshot.scope?.requestedRegisteredCardCount !== Object.values(cards).length) {
    errors.push(`official gallery snapshot targets ${officialGallerySnapshot.scope?.requestedRegisteredCardCount || 0} cards instead of ${Object.values(cards).length}`);
  }
  errors.push(...compareOfficialGalleryCards());
  return errors;
}

export function compareOfficialGalleryCards(cardPool = Object.values(cards), snapshot = officialGallerySnapshot) {
  const errors = [];
  const officialByNumber = new Map((snapshot.cards || []).map((card) => [card.cardNumber, card]));
  for (const actual of cardPool) {
    const sourceNumber = officialByNumber.has(actual.cardNumber)
      ? actual.cardNumber
      : functionalVariantSource(actual.cardNumber, officialByNumber);
    const expected = officialByNumber.get(sourceNumber);
    if (!expected) {
      errors.push(`${actual.cardNumber} has no official gallery record or functional variant source`);
      continue;
    }
    compare(errors, actual.cardNumber, "type", actual.type, expected.type);
    compare(errors, actual.cardNumber, "Energy", normalizedEnergy(actual), normalizedEnergy(expected));
    if (actual.type === "unit") compare(errors, actual.cardNumber, "Might", actual.might ?? null, expected.might ?? null);
    compare(errors, actual.cardNumber, "Power total", totalPower(actual.power), expected.powerAmount || 0);
    compare(errors, actual.cardNumber, "domains", [...(actual.domains || [])].sort(), [...(expected.domains || [])].sort());
    const ignoredTags = ignoredOfficialValues(snapshot, expected.cardNumber, "tags");
    for (const superType of expected.superTypes || []) {
      if (!(actual.tags || []).includes(superType)) errors.push(`${actual.cardNumber} is missing official supertype tag ${superType}`);
    }
    for (const tag of expected.tags || []) {
      if (ignoredTags.has(tag)) continue;
      if (!(actual.tags || []).includes(tag)) errors.push(`${actual.cardNumber} is missing official tag ${tag}`);
    }
  }
  return errors;
}

function testSourceCorpus() {
  return fs.readdirSync(path.join(ROOT, "tests"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => fs.readFileSync(path.join(ROOT, "tests", entry.name), "utf8"))
    .join("\n");
}

function validateLedgerAnchor(errors, ownerId, anchor) {
  const separator = typeof anchor === "string" ? anchor.lastIndexOf("#") : -1;
  if (separator <= 0 || separator === anchor.length - 1) {
    errors.push(`${ownerId} has an invalid implementation anchor: ${anchor || "<missing>"}`);
    return;
  }
  const file = anchor.slice(0, separator);
  const symbol = anchor.slice(separator + 1);
  const anchorPath = path.resolve(ROOT, file);
  if (!fs.existsSync(anchorPath) || !fs.statSync(anchorPath).isFile()) {
    errors.push(`${ownerId} references missing implementation file: ${file}`);
    return;
  }
  if (!fs.readFileSync(anchorPath, "utf8").includes(symbol)) {
    errors.push(`${ownerId} implementation anchor is stale: ${anchor}`);
  }
}

function totalPower(costs = []) {
  return costs.reduce((sum, cost) => sum + (cost.amount || 0), 0);
}

function functionalVariantSource(cardNumber, officialByNumber) {
  const match = /^(OGN-\d+)[bs]\/298$/i.exec(cardNumber || "");
  if (!match) return null;
  const sourceNumber = `${match[1]}/298`;
  return officialByNumber.has(sourceNumber) ? sourceNumber : null;
}

function normalizedEnergy(card) {
  const tokenOrRune = ["rune", "token"].includes(card.type)
    || card.isToken
    || [...(card.tags || []), ...(card.superTypes || [])].includes("Token");
  if (tokenOrRune && (card.energy == null || card.energy === 0)) return null;
  return card.energy ?? null;
}

function ignoredOfficialValues(snapshot, cardNumber, field) {
  const anomaly = (snapshot.knownSourceAnomalies || [])
    .find((entry) => entry.cardNumber === cardNumber && entry.field === field);
  return new Set(anomaly?.ignoredValues || []);
}

function compare(errors, cardNumber, field, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${cardNumber} ${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run() {
  const errors = [...validateRuleContracts(), ...validatePublishedCards()];
  if (errors.length) {
    console.error(`Rule contract validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const catalogCoverage = analyzeRuleCatalogCoverage();
  const workstreamCounts = Object.fromEntries(["verified", "partial", "unverified"].map((status) => [
    status,
    (verificationLedger.remainingWorkstreams || []).filter((workstream) => workstream.status === status).length
  ]));
  const trainingGate = verificationLedger.completionGate.readyForAiTraining ? "open" : "blocked";
  const leafCaseCounts = Object.fromEntries(["verified", "partial", "unverified"].map((status) => [
    status,
    verificationWorkstreamLedgers.reduce((total, ledger) =>
      total + ledger.cases.filter((verificationCase) => verificationCase.status === status).length, 0)
  ]));
  console.log(`Validated ${ruleContracts.contracts.length} focused contracts, ${catalogCoverage.familyCount} exhaustive inventory families, and ${RULE_ORACLE_CHECKS.length} runtime oracle checks against ${catalogCoverage.catalogClauseCount} official clauses (${catalogCoverage.familyCoveredLeafClauseCount}/${catalogCoverage.duelApplicableLeafClauseCount} duel leaves inventoried); verified milestones: ${verificationLedger.verifiedMilestones.length}; verification workstreams: ${workstreamCounts.verified} verified, ${workstreamCounts.partial} partial, ${workstreamCounts.unverified} unverified; exhaustive leaf cases: ${leafCaseCounts.verified} verified, ${leafCaseCounts.partial} partial, ${leafCaseCounts.unverified} unverified; AI-training gate ${trainingGate}; ${officialGallerySnapshot.cards.length}/${Object.values(cards).length} direct official gallery records.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) run();
