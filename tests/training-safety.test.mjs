import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGame, chooseEffectOption } from "../src/engine.mjs";
import {
  actionKey,
  auditDecisionBoundary,
  createAiDecisionCycleGuard,
  enumerateAiPolicyActions,
  enumerateLegalActions,
  resolveLegalAction
} from "../src/ai/actions.mjs";
import { classifyBootstrapTermination } from "../scripts/bootstrap-run-state.mjs";
import { inspectTrainingPreflight, listTrainingFingerprintFiles, migrateCompatibleTrainingTrajectory, validateTrainingTrajectories } from "../scripts/training-safety.mjs";
import { ACTION_DIM, MAX_ACTIONS, STATE_DIM } from "../src/ai/neural/encoding.mjs";
import {
  combinedEpochSelectionScore,
  compareRetentionByDeck,
  evaluateDeckSafety,
  evaluateLearnerAdvance,
  robustEpochSelection,
  summarizePracticalEvaluation
} from "../scripts/training-retention.mjs";
import { balanceTrainingTrajectories, splitIndependentTrainingPartitions, splitStratifiedHoldoutTrajectories } from "../scripts/training-sampling.mjs";
import {
  collectionContractForRun,
  compareAbTrainingContract,
  createAbExperimentClaim,
  diagnosticArtifactRole,
  officialCandidateCheckpointEligible,
  protectedFinalAuditGamesForRun,
  teacherDoseStatusForRun,
  teacherConsumptionPolicyForRun
} from "../scripts/training-experiment-contract.mjs";
import {
  currentHoldoutProvenanceEntries,
  filterTrainingEligibleReplayEntries,
  mergeHoldoutProvenance
} from "../scripts/training-holdout-provenance.mjs";
import {
  deterministicTrainingTrajectoryDigest,
  deterministicValueDigest
} from "../scripts/training-input-digest.mjs";
import { withFileLock } from "../scripts/file-lock.mjs";

test("AI training preflight binds training to the guarded choice architecture", () => {
  const result = inspectTrainingPreflight();
  assert.equal(result.passed, true, result.failures.join("\n"));
  assert.match(result.engineFingerprint, /^sha256:[0-9a-f]{64}$/);
});

test("AI training fingerprint covers setup, card-pool, observation, and encoding semantics", () => {
  const files = new Set(listTrainingFingerprintFiles());
  for (const required of [
    "src/engine/setup.mjs",
    "src/card-pools.mjs",
    "src/ai/action-tactics.mjs",
    "src/ai/observation.mjs",
    "src/ai/neural/encoding.mjs"
  ]) {
    assert.equal(files.has(required), true, `missing training fingerprint source: ${required}`);
  }
});

test("logged Bootstrap preserves an explicit interruption as its terminal state", () => {
  assert.deepEqual(classifyBootstrapTermination({ exitCode: 0, signal: null }), { state: "complete", exitCode: 0 });
  assert.deepEqual(classifyBootstrapTermination({ exitCode: 7, signal: null }), { state: "failed", exitCode: 7 });
  assert.deepEqual(classifyBootstrapTermination({ exitCode: 1, signal: "SIGINT" }, "SIGINT"), { state: "interrupted", exitCode: 130 });
  assert.deepEqual(classifyBootstrapTermination({ exitCode: 1, signal: "SIGTERM" }, "SIGTERM"), { state: "interrupted", exitCode: 143 });
});

test("interactive multi-card effects preserve every explicit user choice", () => {
  const game = createGame({ interactive: true, decisionSafety: "strict" });
  const player = game.players[0];
  const [first, second] = player.mainDeck.splice(0, 2);
  player.hand.push(first, second);
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.pendingChoice = {
    id: "choice-preservation-test",
    playerId: player.id,
    card: player.legend,
    effect: "discardCard",
    prompt: "Choose two cards.",
    options: [first, second].map((card) => ({ id: card.instanceId, cardId: card.instanceId, label: card.name })),
    data: { remaining: 2, discardedIds: [] },
    finishSpell: false,
    optional: false
  };

  assert.deepEqual(auditDecisionBoundary(game), []);
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "discardCard");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [second.instanceId]);
  assert.equal(player.hand.length, 2, "첫 번째 선택만으로 자기까지 자동 진행되면 안 됩니다.");
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(player.hand.length, 0);
  assert.deepEqual(game.decisionSafety.violations, []);
});

test("pending choice options and AI/UI command actions stay in parity", () => {
  const game = createGame({ interactive: true, decisionSafety: "strict" });
  const player = game.players[0];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.pendingChoice = {
    id: "choice-action-parity",
    playerId: player.id,
    card: player.legend,
    effect: "testChoice",
    options: [{ id: "left" }, { id: "right" }, { id: "disabled", disabled: true }],
    optional: true
  };
  const keys = new Set(enumerateLegalActions(game).map(actionKey));
  assert.equal(keys.has(actionKey({ kind: "chooseEffectOption", optionId: "left" })), true);
  assert.equal(keys.has(actionKey({ kind: "chooseEffectOption", optionId: "right" })), true);
  assert.equal(keys.has(actionKey({ kind: "chooseEffectOption", optionId: "disabled" })), false);
  assert.equal(keys.has(actionKey({ kind: "declineEffectChoice" })), true);
  assert.deepEqual(auditDecisionBoundary(game), []);
});

test("trigger-order annotations do not change explicit command identity", () => {
  const game = createGame({ interactive: true, decisionSafety: "strict" });
  const player = game.players[0];
  game.phase = "action";
  game.currentPlayerId = player.id;
  const triggers = ["first", "second"].map((suffix) => ({
    id: `trigger-order-${suffix}`,
    kind: `test-${suffix}`,
    playerId: player.id,
    sourceCardId: player.legend.instanceId,
    status: "finalized"
  }));
  const state = {
    groups: [{ playerId: player.id, triggers, orderedTriggers: [] }],
    groupIndex: 0,
    mode: "queue",
    continuation: null
  };
  game.pendingChoice = {
    id: "trigger-order-command-parity",
    playerId: player.id,
    card: player.legend,
    effect: "triggerOrder",
    options: [
      ...triggers.map((trigger) => ({
        id: trigger.id,
        cardId: trigger.sourceCardId,
        optionalTrigger: false,
        selected: false
      })),
      { id: "confirm-trigger-order", confirmTriggerOrder: true, disabled: true }
    ],
    data: { triggerOrderState: state, continuation: null },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false,
    fromActionChain: false
  };

  const command = { kind: "chooseEffectOption", optionId: triggers[0].id };
  const enumerated = enumerateLegalActions(game).find((action) => action.optionId === triggers[0].id);
  assert.ok(enumerated);
  assert.equal(enumerated.triggerOrderOptional, false);
  assert.equal(actionKey(enumerated), actionKey(command));
  assert.deepEqual(auditDecisionBoundary(game), []);
  assert.equal(resolveLegalAction(game, command)?.optionId, command.optionId);

  assert.equal(chooseEffectOption(game, triggers[0].id).ok, true);
  const humanActionsAfterFirstSelection = enumerateLegalActions(game);
  const aiActionsAfterFirstSelection = enumerateAiPolicyActions(game);
  assert.equal(
    humanActionsAfterFirstSelection.some((action) => action.optionId === triggers[0].id),
    true,
    "the explicit command interface must preserve the ability to revise a trigger order"
  );
  assert.equal(
    aiActionsAfterFirstSelection.some((action) => action.optionId === triggers[0].id),
    false,
    "the AI policy must not toggle an already selected mandatory trigger"
  );
  assert.equal(aiActionsAfterFirstSelection.some((action) => action.optionId === triggers[1].id), true);
  assert.deepEqual(auditDecisionBoundary(game), []);
  assert.equal(chooseEffectOption(game, triggers[1].id).ok, true);
  const confirm = { kind: "chooseEffectOption", optionId: "confirm-trigger-order" };
  assert.equal(game.pendingChoice.options.find((option) => option.confirmTriggerOrder)?.disabled, false);
  assert.deepEqual(enumerateAiPolicyActions(game).map((action) => action.optionId), ["confirm-trigger-order"]);
  assert.equal(resolveLegalAction(game, confirm)?.optionId, confirm.optionId);
  assert.deepEqual(auditDecisionBoundary(game), []);
});

test("AI decision-cycle guard reports a repeated unchanged choice state", () => {
  const game = createGame({ interactive: true, decisionSafety: "strict" });
  const player = game.players[0];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.pendingChoice = {
    id: "repeated-choice-state",
    playerId: player.id,
    card: player.legend,
    effect: "triggerOrder",
    options: [{ id: "trigger-a", selected: false }],
    optional: false
  };

  const guard = createAiDecisionCycleGuard(2);
  assert.equal(guard.inspect(game), null);
  game.pendingChoice.options[0].selected = true;
  assert.equal(guard.inspect(game), null);
  game.pendingChoice.options[0].selected = false;
  assert.equal(guard.inspect(game), null);
  game.pendingChoice.options[0].selected = true;
  assert.equal(guard.inspect(game), null);
  game.pendingChoice.options[0].selected = false;
  assert.equal(guard.inspect(game)?.kind, "ai-decision-cycle");

  game.pendingChoice = null;
  assert.equal(guard.inspect(game), null);
});

test("AI decision-cycle guard also reports an unchanged full game state", () => {
  const game = createGame({ interactive: true, decisionSafety: "strict" });
  const guard = createAiDecisionCycleGuard(2);
  assert.equal(guard.inspect(game), null);
  assert.equal(guard.inspect(game), null);
  assert.equal(guard.inspect(game)?.kind, "ai-decision-cycle");
  game.turnSequence = (game.turnSequence || 0) + 1;
  assert.equal(guard.inspect(game), null, "advancing the turn starts a fresh progress scope");
});

test("the shared command resolver never infers a player's target or effect choice", () => {
  const game = createGame({ interactive: true, decisionSafety: "strict" });
  const player = game.players[0];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.pendingChoice = {
    id: "no-implicit-choice",
    playerId: player.id,
    card: player.legend,
    effect: "testChoice",
    options: [{ id: "only-option" }],
    optional: false
  };

  assert.equal(resolveLegalAction(game, { kind: "chooseEffectOption" }), null);
  assert.equal(resolveLegalAction(game, {
    kind: "chooseEffectOption",
    optionId: "only-option"
  })?.optionId, "only-option");
});

test("trajectory gate rejects stale engines and lost legal-action manifests", () => {
  const fingerprint = inspectTrainingPreflight().engineFingerprint;
  const valid = [{
    gameId: "safe-game",
    playerId: "p1",
    completed: true,
    engineFingerprint: fingerprint,
    decisionSafetyVersion: 1,
    decisionSafetyViolations: [],
    steps: [{ selectedActionKey: "a", legalActionKeys: ["a", "b"], originalLegalCount: 2 }]
  }];
  assert.deepEqual(validateTrainingTrajectories(valid, fingerprint), []);
  assert.match(validateTrainingTrajectories([{ ...valid[0], engineFingerprint: "sha256:stale" }], fingerprint)[0], /엔진 지문/);
  assert.match(validateTrainingTrajectories([{ ...valid[0], steps: [{ selectedActionKey: "a", legalActionKeys: ["b"], originalLegalCount: 2 }] }], fingerprint)[0], /합법 행동 목록/);
});

test("turning-point replay migration accepts only shape- and safety-compatible trajectories", () => {
  const fingerprint = inspectTrainingPreflight().engineFingerprint;
  const stale = {
    gameId: "old-turning-point", playerId: "p1", completed: true,
    engineFingerprint: "sha256:old", decisionSafetyVersion: 1, decisionSafetyViolations: [],
    steps: [{
      state: new Float32Array(STATE_DIM), actions: new Float32Array(MAX_ACTIONS * ACTION_DIM),
      selectedIndex: 0, legalCount: 1, selectedActionKey: "endTurn", legalActionKeys: ["endTurn"], originalLegalCount: 1,
      teacherLabelVersion: 1, teacherIndex: 0, teacherConfidence: 1,
      teacherActionValueTargets: [1], teacherActionValueWeights: [1],
      turningPoint: "teacher-critical"
    }]
  };
  const migrated = migrateCompatibleTrainingTrajectory(stale, fingerprint);
  assert.equal(migrated.engineFingerprint, fingerprint);
  assert.equal(migrated.replayCompatibility.fromEngineFingerprint, "sha256:old");
  assert.equal(migrated.teacherSupervisionCompatibility.strippedTeacherSteps, 1);
  assert.equal(migrated.steps[0].teacherConfidence, undefined);
  assert.equal(migrated.steps[0].teacherActionValueWeights, undefined);
  assert.equal(migrated.steps[0].turningPoint, null);
  assert.equal(migrateCompatibleTrainingTrajectory({ ...stale, steps: [{ ...stale.steps[0], state: new Float32Array(2) }] }, fingerprint), null);
});

test("retention guard warns on one noisy metric and rolls back only corroborated or catastrophic regressions", () => {
  const baseline = { sett: { decisionSteps: 100, decisionAccuracy: 0.67, policyLoss: 0.25 } };
  const accuracyOnly = compareRetentionByDeck(baseline, {
    sett: { decisionSteps: 100, decisionAccuracy: 0.575, policyLoss: 0.24 }
  });
  assert.equal(accuracyOnly.passed, true);
  assert.equal(accuracyOnly.warnings.length, 1);
  const corroborated = compareRetentionByDeck(baseline, {
    sett: { decisionSteps: 100, decisionAccuracy: 0.575, policyLoss: 0.4 }
  });
  assert.equal(corroborated.passed, false);
  const catastrophic = compareRetentionByDeck(baseline, {
    sett: { decisionSteps: 100, decisionAccuracy: 0.45, policyLoss: 0.2 }
  });
  assert.equal(catastrophic.passed, false);
  const correctionRegression = compareRetentionByDeck({
    sett: {
      ...baseline.sett,
      verifiedCorrectionSteps: 12,
      verifiedCorrectionAccuracy: 0.75
    }
  }, {
    sett: {
      decisionSteps: 100,
      decisionAccuracy: 0.67,
      policyLoss: 0.25,
      verifiedCorrectionSteps: 12,
      verifiedCorrectionAccuracy: 0.5
    }
  });
  assert.equal(correctionRegression.passed, false);
  assert.equal(correctionRegression.failures[0].correctionRegressed, true);
});

test("training holdout split preserves per-deck training and retention coverage", () => {
  const deckIds = ["sett", "annie", "kaisa", "master-yi", "leona"];
  const trajectories = deckIds.flatMap((deckId) => Array.from({ length: 10 }, (_, index) => ({
    gameId: `${deckId}-${index}`,
    deckId,
    completed: true,
    steps: [{}]
  })));
  const split = splitStratifiedHoldoutTrajectories(trajectories, {
    deckIds,
    seed: 20260721,
    fraction: 0.1,
    minimumPerDeck: 4,
    minimumTrainingPerDeck: 6
  });
  assert.equal(split.coverage.passed, true);
  assert.deepEqual(Object.values(split.coverage.calibrationCounts), [4, 4, 4, 4, 4]);
  assert.deepEqual(Object.values(split.coverage.trainingCounts), [6, 6, 6, 6, 6]);
  const trainingGames = new Set(split.training.map((trajectory) => trajectory.gameId));
  assert.equal(split.calibration.some((trajectory) => trainingGames.has(trajectory.gameId)), false);
});

test("training holdout split reports an underrepresented deck before PPO", () => {
  const split = splitStratifiedHoldoutTrajectories([
    ...Array.from({ length: 10 }, (_, index) => ({ gameId: `sett-${index}`, deckId: "sett" })),
    ...Array.from({ length: 7 }, (_, index) => ({ gameId: `kaisa-${index}`, deckId: "kaisa" }))
  ], {
    deckIds: ["sett", "kaisa"],
    seed: 7,
    minimumPerDeck: 4,
    minimumTrainingPerDeck: 6
  });
  assert.equal(split.coverage.passed, false);
  assert.equal(split.coverage.failures.some((failure) => failure.deckId === "kaisa"), true);
});

test("independent training partitions never reuse a game across selection or certification roles", () => {
  const deckIds = ["sett", "annie", "kaisa", "master-yi", "leona"];
  const trajectories = deckIds.flatMap((deckId) => Array.from({ length: 20 }, (_, index) => ({
    gameId: `${deckId}-${index}`,
    deckId,
    completed: true,
    steps: [{}]
  })));
  const partitions = splitIndependentTrainingPartitions(trajectories, {
    deckIds,
    seed: 20260725,
    minimumTrainingPerDeck: 6,
    minimumRetentionPerDeck: 4,
    minimumCalibrationFitPerDeck: 1,
    minimumCalibrationTestPerDeck: 1,
    minimumEvaluatorAuditPerDeck: 1
  });
  assert.equal(partitions.manifest.passed, true,
    JSON.stringify(partitions.manifest.failures));
  assert.deepEqual(partitions.manifest.overlaps, []);
  const roles = ["training", "retention", "calibrationFit", "calibrationTest", "evaluatorAudit"];
  const allGames = roles.flatMap((role) => partitions.manifest.gameIds[role]);
  assert.equal(new Set(allGames).size, allGames.length);
});

test("Run A and B share collection conditions but only B consumes strict teacher labels", () => {
  assert.equal(collectionContractForRun("A"), "AB");
  assert.equal(collectionContractForRun("B"), "AB");
  assert.equal(teacherConsumptionPolicyForRun("A"), "record-only-v1");
  assert.equal(teacherConsumptionPolicyForRun("B"), "strict-v8");
  assert.equal(diagnosticArtifactRole("B"), "diagnostic-only");
  const claim = createAbExperimentClaim({
    experimentId: "teacher-ab-001",
    engineFingerprint: "sha256:engine",
    learningTargetVersion: 7,
    sourceModelHash: "model",
    sourceChampionHash: "champion",
    sourceOptimizerHash: "adam",
    sourceConfigurationHash: "configuration",
    sourceSeed: 17,
    generationSeed: 19,
    curriculumIteration: 5,
    games: 160,
    trainingDeckIds: ["sett", "annie"]
  });
  assert.equal(claim.collectionContract, "AB");
  assert.deepEqual(claim.teacherConsumptionPolicies, {
    A: "record-only-v1",
    B: "strict-v8"
  });
  assert.equal(protectedFinalAuditGamesForRun("A", 104), 0);
  assert.equal(protectedFinalAuditGamesForRun("B", 104), 0);
  assert.equal(protectedFinalAuditGamesForRun("C", 105), 112);
  assert.equal(compareAbTrainingContract({
    trainingControlHash: "controls",
    inputDataHash: "inputs",
    ppoBatchOrderFingerprint: "order"
  }, {
    trainingControlHash: "controls",
    inputDataHash: "inputs",
    ppoBatchOrderFingerprint: "order"
  }).compatible, true);
  assert.deepEqual(compareAbTrainingContract({
    trainingControlHash: "controls",
    inputDataHash: "inputs",
    ppoBatchOrderFingerprint: "order"
  }, {
    trainingControlHash: "changed-learning-rate",
    inputDataHash: "inputs",
    ppoBatchOrderFingerprint: "order"
  }).mismatches, ["trainingControlHash"]);
  assert.equal(officialCandidateCheckpointEligible({
    metadata: {
      runContract: "B",
      artifactRole: "diagnostic-only",
      engineValidationStatus: "diagnostic-only"
    }
  }), false);
  assert.equal(officialCandidateCheckpointEligible({
    metadata: {
      runContract: "C",
      artifactRole: "official-candidate",
      engineValidationStatus: "current-engine-validated"
    }
  }), true);
});

test("Run C records whether policy updates came from PPO, proof, terminal, or certified evaluator dose", () => {
  assert.equal(teacherDoseStatusForRun("C", {
    totalPolicyConnectedMass: 0
  }), "ppo-only-zero-teacher-dose");
  assert.equal(teacherDoseStatusForRun("C", {
    totalPolicyConnectedMass: 1,
    proofPolicyMass: 1
  }), "engine-proof-dose-observed");
  assert.equal(teacherDoseStatusForRun("C", {
    totalPolicyConnectedMass: 1,
    proofPolicyMass: 0.2,
    terminalConfirmedPolicyMass: 0.8
  }), "terminal-confirmed-dose-observed");
  assert.equal(teacherDoseStatusForRun("C", {
    totalPolicyConnectedMass: 1,
    terminalConfirmedPolicyMass: 0.5,
    certifiedEvaluatorPolicyMass: 0.5
  }), "certified-evaluator-dose-observed");
  assert.equal(teacherDoseStatusForRun("B", {
    totalPolicyConnectedMass: 0
  }), "inconclusive-zero-dose");
});

test("global holdout provenance rejects current holdouts and unverifiable legacy replays", () => {
  const partitions = {
    training: [{ gameId: "train-1" }],
    retention: [{ gameId: "retention-1" }],
    calibrationFit: [{ gameId: "fit-1" }],
    calibrationTest: [{ gameId: "test-1" }],
    evaluatorAudit: [{ gameId: "audit-1" }]
  };
  const provenance = mergeHoldoutProvenance(
    null,
    currentHoldoutProvenanceEntries("collection-new", partitions),
    {
      engineFingerprint: "sha256:engine",
      completeCollections: ["collection-new"],
      observedCollections: ["collection-new", "collection-legacy"]
    }
  );
  const result = filterTrainingEligibleReplayEntries([
    {
      replayId: "allowed",
      sourceCollectionKey: "collection-new",
      sourceGameId: "train-1",
      sourceEngineFingerprint: "sha256:engine"
    },
    {
      replayId: "holdout",
      sourceCollectionKey: "collection-new",
      sourceGameId: "test-1",
      sourceEngineFingerprint: "sha256:engine"
    },
    {
      replayId: "legacy-unknown",
      sourceCollectionKey: "collection-legacy",
      sourceGameId: "maybe-holdout",
      sourceEngineFingerprint: "sha256:engine"
    },
    {
      replayId: "missing-provenance"
    }
  ], provenance, { engineFingerprint: "sha256:engine" });
  assert.deepEqual(result.eligible.map((entry) => entry.replayId), ["allowed"]);
  assert.deepEqual(result.rejected.map((entry) => [
    entry.replayId,
    entry.rejectionReason
  ]), [
    ["holdout", "global-holdout-provenance"],
    ["legacy-unknown", "unverified-source-partition"],
    ["missing-provenance", "missing-source-provenance"]
  ]);
});

test("A/B input digest covers state, valid action tensors, and teacher evidence", () => {
  const base = {
    gameId: "digest-game",
    deckId: "sett",
    steps: [{
      state: new Float32Array([1, 2, 3]),
      actions: new Float32Array(ACTION_DIM * 2),
      legalCount: 1,
      selectedIndex: 0,
      teacherConfirmation: {
        independent: true,
        lowerBound: 0.1
      }
    }]
  };
  base.steps[0].actions[7] = 0.25;
  const original = deterministicTrainingTrajectoryDigest(base);
  const stateChanged = structuredClone(base);
  stateChanged.steps[0].state[1] = 9;
  assert.notEqual(deterministicTrainingTrajectoryDigest(stateChanged), original);
  const actionChanged = structuredClone(base);
  actionChanged.steps[0].actions[7] = 0.5;
  assert.notEqual(deterministicTrainingTrajectoryDigest(actionChanged), original);
  const evidenceChanged = structuredClone(base);
  evidenceChanged.steps[0].teacherConfirmation.lowerBound = 0.2;
  assert.notEqual(deterministicTrainingTrajectoryDigest(evidenceChanged), original);
  const irrelevantPaddingChanged = structuredClone(base);
  irrelevantPaddingChanged.steps[0].actions[ACTION_DIM + 3] = 99;
  assert.equal(
    deterministicTrainingTrajectoryDigest(irrelevantPaddingChanged),
    original
  );
  assert.equal(
    deterministicValueDigest({ b: 2, a: 1 }),
    deterministicValueDigest({ a: 1, b: 2 })
  );
});

test("file lock serializes concurrent provenance-style read-modify-write sections", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-lock-"));
  const lockPath = path.join(directory, "provenance.json.lock");
  let active = 0;
  let maximumActive = 0;
  const order = [];
  try {
    await Promise.all(Array.from({ length: 4 }, (_, index) =>
      withFileLock(lockPath, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push(index);
        active -= 1;
      }, {
        timeoutMs: 5000,
        retryMs: 5
      })));
    assert.equal(maximumActive, 1);
    assert.equal(order.length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file lock immediately recovers a dead local process owner", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-dead-lock-"));
  const lockPath = path.join(directory, "stage.lock");
  try {
    await writeFile(lockPath, JSON.stringify({
      version: 2,
      token: "dead-owner",
      pid: 2147483000,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString()
    }), "utf8");
    let entered = false;
    await withFileLock(lockPath, async () => {
      entered = true;
    }, {
      timeoutMs: 1000,
      staleMs: 24 * 60 * 60 * 1000,
      retryMs: 5
    });
    assert.equal(entered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("training balance oversamples weak deck coverage without removing collected trajectories", () => {
  const source = [
    { gameId: "a-1", deckId: "a", condition: "seat-0-first" },
    { gameId: "a-2", deckId: "a", condition: "seat-0-first" },
    { gameId: "a-3", deckId: "a", condition: "seat-1-second" },
    { gameId: "b-1", deckId: "b", condition: "seat-0-first" }
  ];
  const balanced = balanceTrainingTrajectories(source, { deckIds: ["a", "b"], seed: 17 });
  assert.equal(balanced.trajectories.length, 6);
  assert.deepEqual(balanced.report.originalDeckCounts, { a: 3, b: 1 });
  assert.deepEqual(balanced.report.addedDeckCounts, { a: 0, b: 2 });
  assert.equal(source.every((item) => balanced.trajectories.includes(item)), true);
});

test("practical epoch score rewards real wins, margins, and weak-group stability", () => {
  const baseline = summarizePracticalEvaluation({
    games: 8, completed: 8, winRate: 0.5,
    deckStats: {
      a: { completed: 4, winRate: 0.5, meanScoreFor: 5, meanScoreAgainst: 5 },
      b: { completed: 4, winRate: 0.5, meanScoreFor: 5, meanScoreAgainst: 5 }
    },
    conditionStats: { first: { completed: 4, winRate: 0.5 }, second: { completed: 4, winRate: 0.5 } }
  });
  const improved = summarizePracticalEvaluation({
    games: 8, completed: 8, winRate: 0.625,
    deckStats: {
      a: { completed: 4, winRate: 0.75, meanScoreFor: 7, meanScoreAgainst: 4 },
      b: { completed: 4, winRate: 0.5, meanScoreFor: 6, meanScoreAgainst: 5 }
    },
    conditionStats: { first: { completed: 4, winRate: 0.75 }, second: { completed: 4, winRate: 0.5 } }
  });
  assert.equal(improved.score > baseline.score, true);
  assert.equal(combinedEpochSelectionScore(0.19, improved.score, baseline.score, 0.35) > 0.19, true);
});

test("epoch selection never lifts an observed weak cell and requires every configured deck", () => {
  const practical = summarizePracticalEvaluation({
    games: 20,
    completed: 20,
    winRate: 0.6,
    deckStats: {
      kaisa: { completed: 8, winRate: 0.625, meanScoreFor: 6, meanScoreAgainst: 5 },
      leona: { completed: 8, winRate: 0.625, meanScoreFor: 6.125, meanScoreAgainst: 5 },
      sett: { completed: 4, winRate: 0.5, meanScoreFor: 6, meanScoreAgainst: 5 }
    },
    conditionStats: {
      "seat-0-first": { completed: 5, winRate: 1 },
      "seat-1-second": { completed: 5, winRate: 0 },
      "seat-0-second": { completed: 5, winRate: 0.8 },
      "seat-1-first": { completed: 5, winRate: 0.6 }
    }
  }, {
    requiredDeckIds: ["kaisa", "leona", "sett", "annie", "master-yi"],
    minimumDeckGames: 8
  });
  assert.equal(practical.score < 0.5, true);
  assert.equal(practical.selectionScore, practical.score);
  assert.equal(practical.confidenceAdjustedWeakestConditionWinRate, 0);
  assert.equal(practical.coverage.passed, false);
  assert.deepEqual(practical.coverage.missingDeckIds, ["annie", "master-yi"]);
  assert.deepEqual(practical.coverage.underCoveredDeckIds, ["sett"]);
  const selection = robustEpochSelection({
    passed: true,
    baselineScore: 0.171,
    score: 0.155
  }, practical);
  assert.equal(selection.selectionEligible, false);
  assert.equal(selection.reasons.includes("incomplete-deck-coverage"), true);
  assert.equal(selection.score, practical.selectionScore);
  assert.equal(selection.observedPracticalScore, practical.score);
});

test("epoch selection treats a non-catastrophic retention drop as a tie-break diagnostic", () => {
  const selection = robustEpochSelection({
    passed: true,
    baselineScore: 0.161,
    score: 0.149
  }, {
    games: 20,
    completed: 20,
    completionRate: 1,
    invalidGames: 0,
    winRate: 0.6,
    score: 0.58
  }, {
    maximumRetentionDrop: 0.005
  });
  assert.equal(selection.selectionEligible, true);
  assert.equal(selection.retentionFloorExceeded, true);
  assert.equal(selection.score, 0.58);
  assert.equal(selection.tieBreakerScore, 0.149);
});

test("epoch selection still rejects a catastrophic per-deck retention failure", () => {
  const selection = robustEpochSelection({
    passed: false,
    baselineScore: 0.161,
    score: 0.19,
    failures: [{ deckId: "a", catastrophic: true }]
  }, {
    games: 20,
    completed: 20,
    completionRate: 1,
    invalidGames: 0,
    winRate: 0.65,
    score: 0.62
  });
  assert.equal(selection.selectionEligible, false);
  assert.equal(selection.reasons.includes("retention-guard-failed"), true);
});

test("protected final audit uses paired bootstrap support and lower-tail deck CVaR as hard gates", () => {
  const retention = { passed: true, baselineScore: 0.2, score: 0.21 };
  const basePractical = {
    score: 0.55,
    selectionScore: 0.55,
    winRate: 0.56,
    completionRate: 1,
    invalidGames: 0,
    lowerTailDeckCvar: 0.42,
    coverage: { passed: true },
    pairedEvidence: { bootstrapSupportRate: 0.82 }
  };
  const accepted = robustEpochSelection(retention, basePractical, {
    requireBootstrapEvidence: true,
    minimumBootstrapSupport: 0.75,
    minimumDeckCvar: 0.35
  });
  assert.equal(accepted.selectionEligible, true);
  const weakBootstrap = robustEpochSelection(retention, {
    ...basePractical,
    pairedEvidence: { bootstrapSupportRate: 0.61 }
  }, {
    requireBootstrapEvidence: true,
    minimumBootstrapSupport: 0.75,
    minimumDeckCvar: 0.35
  });
  assert.equal(weakBootstrap.selectionEligible, false);
  assert.equal(weakBootstrap.reasons.includes("insufficient-bootstrap-support"), true);
  const weakTail = robustEpochSelection(retention, {
    ...basePractical,
    lowerTailDeckCvar: 0.2
  }, {
    requireBootstrapEvidence: true,
    minimumBootstrapSupport: 0.75,
    minimumDeckCvar: 0.35
  });
  assert.equal(weakTail.selectionEligible, false);
  assert.equal(weakTail.reasons.includes("low-deck-cvar"), true);
});

test("learner advances only with direct evidence and without a deck collapse", () => {
  const deckIds = ["a", "b"];
  const evaluation = {
    games: 40,
    completed: 40,
    invalidGames: 0,
    winRate: 0.55,
    wilsonLowerBound: 0.39,
    seatGap: 0.1,
    conditionGap: 0.2,
    deckStats: {
      a: { completed: 20, winRate: 0.6, meanScoreFor: 6.5, meanScoreAgainst: 5 },
      b: { completed: 20, winRate: 0.5, meanScoreFor: 6, meanScoreAgainst: 5.5 }
    }
  };
  assert.equal(evaluateLearnerAdvance(evaluation, deckIds).passed, true);
  const collapsed = structuredClone(evaluation);
  collapsed.games = 44;
  collapsed.completed = 44;
  collapsed.deckStats.b = { completed: 24, winRate: 0.1, meanScoreFor: 2, meanScoreAgainst: 7 };
  const gate = evaluateLearnerAdvance(collapsed, deckIds);
  assert.equal(gate.passed, false);
  assert.equal(gate.failures.some((failure) => failure.reason === "deck-collapse"), true);
});

test("learner seat and condition safety measures regression relative to the parent baseline", () => {
  const deckIds = ["a"];
  const baseline = {
    games: 40,
    completed: 40,
    invalidGames: 0,
    winRate: 0.5,
    wilsonLowerBound: 0.36,
    seatGap: 0.4,
    conditionGap: 0.6,
    deckStats: {
      a: { completed: 40, winRate: 0.5, meanScoreFor: 5, meanScoreAgainst: 5 }
    }
  };
  const candidate = {
    ...structuredClone(baseline),
    winRate: 0.55,
    wilsonLowerBound: 0.39,
    seatGap: 0.42,
    conditionGap: 0.64,
    deckStats: {
      a: { completed: 40, winRate: 0.55, meanScoreFor: 5.5, meanScoreAgainst: 5 }
    }
  };
  const accepted = evaluateLearnerAdvance(candidate, deckIds, {
    baselineEvaluation: baseline,
    maximumSeatGapIncrease: 0.1,
    maximumConditionGapIncrease: 0.1
  });
  assert.equal(accepted.passed, true);
  assert.ok(Math.abs(accepted.seatGapIncrease - 0.02) < 1e-9);
  const regressed = evaluateLearnerAdvance({
    ...candidate,
    seatGap: 0.56,
    conditionGap: 0.75
  }, deckIds, {
    baselineEvaluation: baseline,
    maximumSeatGapIncrease: 0.1,
    maximumConditionGapIncrease: 0.1
  });
  assert.equal(regressed.passed, false);
  assert.equal(regressed.failures.some((item) =>
    item.reason === "seat-gap-regression"), true);
  assert.equal(regressed.failures.some((item) =>
    item.reason === "condition-gap-regression"), true);
});

test("learner safety detects a seat-direction flip even when the absolute gap is unchanged", () => {
  const baseline = {
    games: 40,
    completed: 40,
    invalidGames: 0,
    winRate: 0.55,
    wilsonLowerBound: 0.39,
    seatGap: 0.4,
    conditionGap: 0.4,
    seatStats: [
      { completed: 20, winRate: 0.7 },
      { completed: 20, winRate: 0.3 }
    ],
    conditionStats: {
      "seat-0-first": { completed: 10, winRate: 0.8 },
      "seat-0-second": { completed: 10, winRate: 0.6 },
      "seat-1-first": { completed: 10, winRate: 0.4 },
      "seat-1-second": { completed: 10, winRate: 0.2 }
    },
    deckStats: {
      a: { completed: 40, winRate: 0.55, meanScoreFor: 5.5, meanScoreAgainst: 5 }
    }
  };
  const candidate = {
    ...structuredClone(baseline),
    seatStats: [
      { completed: 20, winRate: 0.3 },
      { completed: 20, winRate: 0.7 }
    ],
    conditionStats: {
      "seat-0-first": { completed: 10, winRate: 0.4 },
      "seat-0-second": { completed: 10, winRate: 0.2 },
      "seat-1-first": { completed: 10, winRate: 0.8 },
      "seat-1-second": { completed: 10, winRate: 0.6 }
    }
  };
  const gate = evaluateLearnerAdvance(candidate, ["a"], {
    baselineEvaluation: baseline,
    maximumSeatWinRateDrop: 0.1,
    maximumConditionWinRateDrop: 0.15
  });
  assert.equal(gate.passed, false);
  assert.equal(gate.failures.some((failure) =>
    failure.reason === "seat-win-rate-regression"
      && failure.key === "seat-0"), true);
  assert.equal(gate.failures.some((failure) =>
    failure.reason === "condition-win-rate-regression"
      && failure.key === "seat-0-first"), true);
});

test("deck collapse boundaries trigger fresh confirmation before becoming a hard failure", () => {
  const evaluation = {
    games: 40,
    completed: 40,
    deckStats: {
      a: { completed: 8, winRate: 0.25, meanScoreFor: 4.5, meanScoreAgainst: 8 },
      b: { completed: 8, winRate: 0.5, meanScoreFor: 5, meanScoreAgainst: 5 }
    }
  };
  const provisional = evaluateDeckSafety(evaluation, ["a", "b"], {
    minimumDeckGames: 8,
    confirmationDeckGames: 24,
    minimumDeckWinRate: 0.25,
    minimumDeckScoreMargin: -3.5
  });
  assert.equal(provisional.status, "needs-confirmation");
  assert.equal(provisional.decks[0].lowWinRate, true);
  assert.equal(provisional.decks[0].lowScoreMargin, true);

  evaluation.deckStats.a.completed = 24;
  const confirmed = evaluateDeckSafety(evaluation, ["a", "b"], {
    minimumDeckGames: 8,
    confirmationDeckGames: 24,
    minimumDeckWinRate: 0.25,
    minimumDeckScoreMargin: -3.5
  });
  assert.equal(confirmed.status, "fail");
});
