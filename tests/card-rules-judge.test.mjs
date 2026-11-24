import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cards } from "../src/cards.mjs";
import {
  analyzePublishedSourceCoverage,
  buildCardContracts,
  deriveTextRuleFindings,
  judgeCardRules,
  runCardMutationAudit
} from "../scripts/card-rules-judge.mjs";
import { runCardRuleBehaviorProbes } from "../scripts/card-rules-probes.mjs";
import {
  analyzeCardBehaviorCoverage,
  buildBehaviorCoverageBaseline,
  validateBehaviorCoverageBaseline,
  validateNewCardImplementationReferences
} from "../scripts/card-rules-coverage.mjs";

test("card rules judge behavior probes match independent literal outcomes", async () => {
  const probes = await runCardRuleBehaviorProbes();
  assert.equal(probes.length >= 10, true);
  assert.deepEqual(probes.filter((probe) => !probe.ok), []);
});

test("text judge distinguishes removed card and activated-ability Reaction semantics", () => {
  const lux = structuredClone(cards.luxCrownguard);
  lux.effects[0].abilityKeywords = [];
  assert.equal(deriveTextRuleFindings(lux).some((finding) => finding.code === "TEXT_MISSING_REACTION_ABILITY_TRAIT"), true);

  const highlander = structuredClone(cards.highlander);
  highlander.tags = highlander.tags.filter((tag) => tag !== "Reaction");
  highlander.keywords = highlander.keywords.filter((keyword) => keyword !== "Reaction");
  assert.equal(deriveTextRuleFindings(highlander).some((finding) => finding.code === "TEXT_MISSING_REACTION_TRAIT"), true);
});

test("text judge catches removed attack and token-destination semantics", () => {
  const volibear = structuredClone(cards.volibearFurious2);
  volibear.effects = volibear.effects.filter((effect) => effect.kind !== "splitDamageEnemyHere");
  assert.equal(deriveTextRuleFindings(volibear).some((finding) => finding.code === "TEXT_MISSING_ATTACK_TRIGGER"), true);

  const recruit = structuredClone(cards.recruitTheVanguard);
  recruit.effects[0].destination = "base";
  assert.equal(deriveTextRuleFindings(recruit).some((finding) => finding.code === "TEXT_TOKEN_DESTINATION_MISMATCH"), true);
});

test("text judge catches published numeric parameter drift", () => {
  const duel = structuredClone(cards.gentlemensDuel);
  duel.effects[0].amount = 2;
  assert.equal(deriveTextRuleFindings(duel).some((finding) => finding.code === "TEXT_DUEL_PARAMETER_MISMATCH"), true);

  const leona = structuredClone(cards.leonaZealot);
  leona.effects.find((effect) => effect.kind === "enterReadyIfOpponentNearVictory").points = 2;
  assert.equal(deriveTextRuleFindings(leona).some((finding) => finding.code === "TEXT_MISSING_NEAR_VICTORY_READY"), true);
});

test("frozen contracts catch card cost and effect drift", async () => {
  const annie = structuredClone(cards.annieFiery);
  const contracts = buildCardContracts([cards.annieFiery]);
  annie.energy = 4;
  annie.effects[0].amount = 2;
  const report = await judgeCardRules({
    cardPool: [annie],
    contracts,
    runBehaviorProbes: false
  });
  assert.equal(report.findings.some((finding) => finding.code === "CONTRACT_ENERGY_DRIFT"), true);
  assert.equal(report.findings.some((finding) => finding.code === "CONTRACT_EFFECTS_DRIFT"), true);
});

test("every registered card contract kills automatic identity, text, cost, and behavior mutants", () => {
  const cardPool = Object.values(cards);
  const audit = runCardMutationAudit(cardPool, buildCardContracts(cardPool));
  assert.equal(audit.attempted >= cardPool.length * 4, true);
  assert.equal(audit.killed, audit.attempted);
  assert.deepEqual(audit.survivors, []);
});

test("coverage gate accepts complete evidence and rejects an unprobed new effect", async () => {
  const cardPool = Object.values(cards);
  const probes = await runCardRuleBehaviorProbes();
  const coverage = analyzeCardBehaviorCoverage(cardPool, probes);
  const baseline = buildBehaviorCoverageBaseline(coverage);
  assert.equal(coverage.contractOnlyEffectCount, 0);
  assert.deepEqual(validateBehaviorCoverageBaseline(coverage, baseline), []);

  const newEffectCoverage = structuredClone(coverage);
  newEffectCoverage.usedEffectKeys.push("spell:unreviewedMutation");
  assert.equal(validateBehaviorCoverageBaseline(newEffectCoverage, baseline)
    .some((error) => error.includes("has no independent behavior probe")), true);
});

test("new cards reusing a shared effect must cite a previously reviewed card", async () => {
  const cardPool = Object.values(cards);
  const probes = await runCardRuleBehaviorProbes();
  const baseline = buildBehaviorCoverageBaseline(analyzeCardBehaviorCoverage(cardPool, probes));
  const newCard = structuredClone(cards.incinerate);
  newCard.cardNumber = "TST-001/001";
  delete newCard.implementationReference;
  delete newCard.implementationReferences;
  assert.equal(validateNewCardImplementationReferences([...cardPool, newCard], baseline).length, 1);

  newCard.implementationReferences = { "spell:dealDamageUnit": cards.incinerate.cardNumber };
  assert.deepEqual(validateNewCardImplementationReferences([...cardPool, newCard], baseline), []);
});

test("architecture judge rejects direct damage and printed-Might bypasses", async () => {
  const engineSource = `${fs.readFileSync(new URL("../src/engine.mjs", import.meta.url), "utf8")}
function mutantDamage(unit) { unit.damage += 1; }
function mutantBracketDamage(unit) { unit["damage"] += 1; }
function mutantMight(unit) { return effectiveMight(unit); }
function mutantPrintedMight(unit) { return unit.might; }
function mutantNameBranch(card) { return card.name.includes("Annie"); }
function mutantChoice(game) { game.pendingChoice = { id: "bad" }; }
function mutantZoneWriter(player, card) { player.trash.push(card); }`;
  const report = await judgeCardRules({
    cardPool: [cards.annieFiery],
    contracts: buildCardContracts([cards.annieFiery]),
    engineSource,
    runBehaviorProbes: false
  });
  assert.equal(report.findings.some((finding) => finding.code === "ENGINE_DAMAGE_PIPELINE_BYPASS"), true);
  assert.equal(report.findings.some((finding) => finding.code === "ENGINE_CURRENT_MIGHT_BYPASS"), true);
  assert.equal(report.findings.some((finding) => finding.code === "ENGINE_PRINTED_MIGHT_BYPASS"), true);
  assert.equal(report.findings.some((finding) => finding.code === "ENGINE_CARD_IDENTITY_BRANCH"), true);
  assert.equal(report.findings.some((finding) => finding.code === "ENGINE_CHOICE_CONTINUATION_CONTRACT"), true);
  assert.equal(report.findings.some((finding) => finding.code === "ENGINE_WRITER_BASELINE_REGRESSION"), true);
});

test("judge reports authoritative-source limits instead of claiming full rules proof", () => {
  const coverage = analyzePublishedSourceCoverage(Object.values(cards));
  assert.equal(coverage.metadataVerifiedCardCount, Object.keys(cards).length);
  assert.equal(coverage.unverifiedCardCount, 0);
  assert.match(coverage.scope, /executable behavior still requires separate probes/i);
});
