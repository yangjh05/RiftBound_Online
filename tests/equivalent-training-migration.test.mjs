import test from "node:test";
import assert from "node:assert/strict";
import { migrateCompatibleTrainingTrajectory } from "../scripts/training-safety.mjs";
import { STATE_DIM, ACTION_DIM } from "../src/ai/neural/encoding.mjs";
import { migratedEvaluatorBootstrapAllocationState } from "../scripts/migrate-compatible-evaluator-bootstrap.mjs";

function trajectory() {
  return {
    gameId: "equivalent", playerId: "p1", completed: true, won: true,
    engineFingerprint: "sha256:old", learningTargetVersion: 9,
    decisionSafetyVersion: 1, decisionSafetyViolations: [],
    steps: [{ state: new Float32Array(STATE_DIM), actions: new Float32Array(ACTION_DIM),
      selectedIndex: 0, legalCount: 1, originalLegalCount: 1,
      legalActionKeys: ["endTurn"], selectedActionKey: "endTurn",
      behaviorTemperature: 0.85, terminalOutcome: 1, informationSetHash: "info-v1-00000001",
      value: 0.3, return: 0.125, advantage: -0.175,
      shortHorizonReturn: 0.75, longHorizonReturn: -0,
      teacherLabelVersion: 1, teacherConfidence: 0.731,
      leafValueReference: { pairs: [{ correctValue: 0.875, comparedValue: 0.25 }] } }]
  };
}

test("verified equivalent migration preserves every saved numerical target and supervision field", () => {
  const source = trajectory();
  const migrated = migrateCompatibleTrainingTrajectory(source, "sha256:new", {
    preserveEquivalentTargets: true, verifiedEquivalentSemantics: true, learningTargetVersion: 9,
    longHorizonLambda: 0.985, behaviorTemperature: 0.5
  });
  assert.ok(migrated);
  assert.deepEqual(migrated.steps, source.steps);
  assert.equal(migrated.replayCompatibility.policyReturnsPreserved, true);
  migrated.steps[0].return = 7;
  assert.equal(source.steps[0].return, 0.125);
  assert.equal(source.engineFingerprint, "sha256:old");
});

test("exact target preservation refuses missing proof, changed target version and unsafe source", () => {
  const options = { preserveEquivalentTargets: true, verifiedEquivalentSemantics: true, learningTargetVersion: 9 };
  assert.equal(migrateCompatibleTrainingTrajectory(trajectory(), "new", { ...options, verifiedEquivalentSemantics: false }), null);
  assert.equal(migrateCompatibleTrainingTrajectory(trajectory(), "new", { ...options, learningTargetVersion: 10 }), null);
  const unsafe = trajectory();
  unsafe.steps[0].selectedActionKey = "different";
  assert.equal(migrateCompatibleTrainingTrajectory(unsafe, "new", options), null);
});

test("equivalent evaluator migration keeps the existing deck and seat schedule boundary", () => {
  const source = { datasetKey: "old", deckSeatSchedule: { version: "deck-seat-schedule-v2", boundaryGameIndex: 0 } };
  const target = migratedEvaluatorBootstrapAllocationState(source, {
    targetDatasetKey: "new", migratedGames: 360, preserveEquivalentTargets: true
  });
  assert.deepEqual(target.deckSeatSchedule, source.deckSeatSchedule);
  assert.notEqual(target.deckSeatSchedule, source.deckSeatSchedule);
});
