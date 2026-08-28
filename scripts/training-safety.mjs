import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_DIM, MAX_ACTIONS, STATE_DIM } from "../src/ai/neural/encoding.mjs";
import { TEACHER_LABEL_VERSION } from "../src/ai/neural/teacher-contract.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFETY_VERSION = 1;
const FINGERPRINT_ROOTS = [
  "src/engine.mjs",
  "src/engine",
  "src/cards.mjs",
  "src/cards",
  "src/card-pools.mjs",
  "src/effects",
  "src/rules",
  "src/ai/actions.mjs",
  "src/ai/action-tactics.mjs",
  "src/ai/belief.mjs",
  "src/ai/deck-memory.mjs",
  "src/ai/observation.mjs",
  "src/ai/human-data.mjs",
  "src/ai/hand-opportunity.mjs",
  "src/ai/mulligan.mjs",
  "src/ai/payment-planner.mjs",
  "src/ai/policy.mjs",
  "src/ai/resource-reservation.mjs",
  "src/ai/resource-strategy.mjs",
  "src/ai/rollout.mjs",
  "src/ai/training-decks.mjs",
  "src/ai/neural"
];

export function computeEngineFingerprint(root = PROJECT_ROOT) {
  const hash = createHash("sha256");
  hash.update(`riftbound-engine-semantics-v${SAFETY_VERSION}\n`);
  for (const relative of listTrainingFingerprintFiles(root)) {
    hash.update(`${relative}\0`);
    hash.update(readFileSync(path.join(root, relative)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function listTrainingFingerprintFiles(root = PROJECT_ROOT) {
  return collectFiles(root).map((relative) => relative.replaceAll("\\", "/"));
}

export function inspectTrainingPreflight(root = PROJECT_ROOT) {
  const failures = [];
  const enginePath = path.join(root, "src/engine.mjs");
  const source = readFileSync(enginePath, "utf8");
  const unsafePatterns = [
    /applyChoiceEffect\(\s*game\s*,\s*(\w+)\s*,\s*\1\.options(?:\[0\]|\.at\(-1\))\s*\)/g,
    /applyChoiceEffect\(\s*game\s*,\s*(\w+)\s*,\s*options\[0\]\s*\)/g,
    /applyChoiceEffect\(\s*game\s*,\s*\{[\s\S]{0,600}?\}\s*,\s*options\[0\]\s*\)/g
  ];
  const unsafeCount = unsafePatterns.reduce((sum, pattern) => sum + [...source.matchAll(pattern)].length, 0);
  if (unsafeCount) failures.push(`공용 자동 선택 경계를 우회한 호출이 ${unsafeCount}개 있습니다.`);
  const unprovenancedCalls = findUnprovenancedChoiceCalls(source);
  if (unprovenancedCalls.length) failures.push(`선택 해석 출처를 명시하지 않은 호출이 ${unprovenancedCalls.length}개 있습니다.`);
  if (!source.includes("function applyAutomaticChoiceEffect")) failures.push("공용 자동 선택 경계가 없습니다.");
  if (!source.includes("automatic-choice-prevented")) failures.push("대화형 자동 선택 방지 장치가 없습니다.");

  const ledgerPath = path.join(root, "spec/rules/verification-ledger-2026-03-30.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  if (ledger.completionGate?.readyForAiTraining !== true) failures.push("규칙 검증 저장소의 AI 학습 허용 게이트가 닫혀 있습니다.");

  return {
    version: SAFETY_VERSION,
    passed: failures.length === 0,
    failures,
    engineFingerprint: computeEngineFingerprint(root)
  };
}

export function assertTrainingPreflight(root = PROJECT_ROOT) {
  const result = inspectTrainingPreflight(root);
  if (!result.passed) throw new Error(`AI 학습 사전 검증 실패: ${result.failures.join(" ")}`);
  return result;
}

export function validateTrainingTrajectories(trajectories, engineFingerprint) {
  const failures = [];
  for (let index = 0; index < (trajectories || []).length; index += 1) {
    const trajectory = trajectories[index];
    const key = `${trajectory.gameId || "game"}:${trajectory.playerId || index}`;
    if (trajectory.completed !== true) failures.push(`${key}: 완료되지 않은 게임의 궤적은 학습에 사용할 수 없습니다.`);
    if (trajectory.engineFingerprint !== engineFingerprint) failures.push(`${key}: 엔진 지문이 없거나 현재 엔진과 다릅니다.`);
    if (trajectory.decisionSafetyVersion !== SAFETY_VERSION) failures.push(`${key}: 선택 안전 버전이 올바르지 않습니다.`);
    if (trajectory.decisionSafetyViolations?.length) failures.push(`${key}: 선택 안전 위반이 기록되어 있습니다.`);
    if (!trajectory.steps?.length) failures.push(`${key}: 학습 단계가 없습니다.`);
    for (let stepIndex = 0; stepIndex < (trajectory.steps || []).length; stepIndex += 1) {
      const step = trajectory.steps[stepIndex];
      if (Number(trajectory.learningTargetVersion) >= 3) {
        if (!Number.isFinite(step.behaviorTemperature) || step.behaviorTemperature < 0.05) {
          failures.push(`${key}:${stepIndex}: behavior temperature is missing or invalid.`);
        }
        if (![1, -1].includes(Number(step.terminalOutcome))) {
          failures.push(`${key}:${stepIndex}: terminal outcome is missing or invalid.`);
        }
      }
      if (Number(trajectory.learningTargetVersion) >= 7
        && !/^info-v1-[0-9a-f]{8}$/.test(String(step.informationSetHash || ""))) {
        failures.push(`${key}:${stepIndex}: public information-set hash is missing or invalid.`);
      }
      if (step.decisionType === "sideboard") continue;
      if (!step.selectedActionKey || !step.legalActionKeys?.includes(step.selectedActionKey)) {
        failures.push(`${key}:${stepIndex}: 선택 행동을 당시 합법 행동 목록에서 확인할 수 없습니다.`);
      }
      if (step.legalActionKeys?.length !== step.originalLegalCount) {
        failures.push(`${key}:${stepIndex}: 합법 행동 목록이 잘렸거나 손상되었습니다.`);
      }
      if (failures.length >= 100) return failures;
    }
  }
  return failures;
}

export function migrateCompatibleTrainingTrajectory(trajectory, engineFingerprint, options = {}) {
  if (!trajectory || trajectory.completed !== true || !trajectory.engineFingerprint) return null;
  if (!(trajectory.steps || []).every((step) => step.state?.length === STATE_DIM
    && step.actions?.length === MAX_ACTIONS * ACTION_DIM
    && Number.isInteger(step.selectedIndex)
    && step.selectedIndex >= 0
    && step.selectedIndex < Math.max(1, step.legalCount || 0))) return null;
  const migrated = structuredClone(trajectory);
  const fromEngineFingerprint = migrated.engineFingerprint;
  let strippedTeacherSteps = 0;
  for (const step of migrated.steps || []) {
    step.behaviorTemperature = Math.max(0.05,
      Number(step.behaviorTemperature)
      || Number(options.behaviorTemperature)
      || 1);
    if (step.imitation === true || step.teacherLabelVersion === TEACHER_LABEL_VERSION) continue;
    if (stripStaleTeacherSupervision(step)) strippedTeacherSteps += 1;
  }
  if (Number.isFinite(Number(options.learningTargetVersion))) {
    migrated.learningTargetVersion = Number(options.learningTargetVersion);
  }
  const terminalOutcome = migrated.won === true ? 1 : migrated.won === false ? -1
    : Number(migrated.terminalOutcome);
  if (Number.isFinite(terminalOutcome) && terminalOutcome !== 0) {
    migrated.terminalOutcome = terminalOutcome;
    recomputePureOutcomeTargets(migrated.steps, terminalOutcome, options);
  }
  migrated.engineFingerprint = engineFingerprint;
  migrated.replayCompatibility = {
    version: 2,
    fromEngineFingerprint,
    toEngineFingerprint: engineFingerprint,
    reason: "State/action dimensions and decision-safety contract are unchanged; behavior temperature and pure terminal targets were restored."
  };
  migrated.teacherSupervisionCompatibility = {
    version: 1,
    requiredLabelVersion: TEACHER_LABEL_VERSION,
    strippedTeacherSteps,
    policyReturnsPreserved: false,
    reason: strippedTeacherSteps
      ? "Stale simulation-teacher labels were removed while actual PPO actions and returns were preserved."
      : "No stale simulation-teacher supervision was present."
  };
  return validateTrainingTrajectories([migrated], engineFingerprint).length ? null : migrated;
}

function recomputePureOutcomeTargets(steps, terminalOutcome, options = {}) {
  const gamma = Math.max(0, Math.min(1, Number(options.gamma) || 0.997));
  const lambda = Math.max(0, Math.min(1, Number(options.gaeLambda) || 0.95));
  const longLambda = Math.max(lambda,
    Math.min(1, Number(options.longHorizonLambda) || lambda));
  const longWeight = Math.max(0,
    Math.min(1, Number(options.longHorizonWeight) || 0));
  let shortGae = 0;
  let longGae = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const terminal = index === steps.length - 1;
    const reward = terminal ? terminalOutcome : 0;
    const nextValue = terminal ? 0 : Number(steps[index + 1].value) || 0;
    const value = Number(steps[index].value) || 0;
    const delta = reward + gamma * nextValue - value;
    shortGae = delta + gamma * lambda * (terminal ? 0 : shortGae);
    longGae = delta + gamma * longLambda * (terminal ? 0 : longGae);
    const mixedAdvantage = shortGae * (1 - longWeight) + longGae * longWeight;
    steps[index].shortHorizonReturn = shortGae + value;
    steps[index].longHorizonReturn = longGae + value;
    steps[index].advantage = mixedAdvantage;
    steps[index].return = mixedAdvantage + value;
    steps[index].terminalOutcome = terminalOutcome;
  }
}

export function stripStaleTeacherSupervision(step) {
  if (!step || step.imitation === true || step.teacherLabelVersion === TEACHER_LABEL_VERSION) return false;
  let changed = false;
  for (const key of Object.keys(step)) {
    if (!key.startsWith("teacher")) continue;
    delete step[key];
    changed = true;
  }
  if (String(step.turningPoint || "").startsWith("teacher-")) {
    step.turningPoint = null;
    changed = true;
  }
  return changed;
}

export function assertTrainingTrajectories(trajectories, engineFingerprint) {
  const failures = validateTrainingTrajectories(trajectories, engineFingerprint);
  if (failures.length) throw new Error(`AI 학습 궤적 안전 검증 실패: ${failures.slice(0, 5).join(" ")}`);
  return true;
}

function collectFiles(root) {
  const files = [];
  for (const relative of FINGERPRINT_ROOTS) visit(relative);
  return [...new Set(files)].sort();

  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = statSync(absolute);
    if (stat.isFile()) {
      files.push(relative);
      return;
    }
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(child);
    }
  }
}

function findUnprovenancedChoiceCalls(source) {
  const failures = [];
  const needle = "applyChoiceEffect(";
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) >= 0) {
    const prefix = source.slice(Math.max(0, offset - 20), offset);
    if (/function\s+$/.test(prefix)) {
      offset += needle.length;
      continue;
    }
    let parentheses = 1;
    let braces = 0;
    let brackets = 0;
    let commas = 0;
    let quote = null;
    let escaped = false;
    let index = offset + needle.length;
    for (; index < source.length && parentheses > 0; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") { quote = character; continue; }
      if (character === "(") parentheses += 1;
      else if (character === ")") parentheses -= 1;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (character === "[") brackets += 1;
      else if (character === "]") brackets -= 1;
      else if (character === "," && parentheses === 1 && braces === 0 && brackets === 0) commas += 1;
    }
    if (commas < 3) failures.push(offset);
    offset = Math.max(index, offset + needle.length);
  }
  return failures;
}
