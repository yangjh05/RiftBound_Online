import test from "node:test";
import assert from "node:assert/strict";
import { createGame, chooseEffectOption } from "../src/engine.mjs";
import { actionKey, auditDecisionBoundary, enumerateLegalActions, resolveLegalAction } from "../src/ai/actions.mjs";
import { classifyBootstrapTermination } from "../scripts/bootstrap-run-state.mjs";
import { inspectTrainingPreflight, listTrainingFingerprintFiles, validateTrainingTrajectories } from "../scripts/training-safety.mjs";

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
