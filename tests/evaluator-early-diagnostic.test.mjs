import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapStratifiedGameAccuracyInterval,
  evaluatorEarlyDiagnosticStatus,
  splitEvaluatorEarlyDiagnosticRecords
} from "../scripts/evaluator-early-diagnostic.mjs";

function accuracyRanking(correct, games, prefix, leaf = false) {
  const interval = bootstrapStratifiedGameAccuracyInterval(
    Array.from({ length: games }, (_, index) => ({
      gameId: `${prefix}-${index}`,
      stratum: "deck-a:p1",
      correct: index < correct ? 1 : 0,
      decisions: 1
    })),
    { samples: 500 }
  );
  return leaf
    ? {
      accuracy: interval.mean,
      accuracyUpperBound: interval.upperBound,
      accuracyInterval: interval
    }
    : {
      neuralAccuracy: interval.mean,
      neuralAccuracyUpperBound: interval.upperBound,
      neuralAccuracyInterval: interval
    };
}

function weakCandidate(replica, validationGames, anchorAction, anchorLeaf) {
  return {
    architecture: { id: "flat-v1-64" },
    replica,
    evaluatorTraining: { history: [{
      samples: 100,
      batches: 4,
      loss: 0.4,
      rankingLoss: 0.2,
      outcomeLoss: 0.2
    }] },
    trainingActionRanking: { neuralAccuracy: 0.55 },
    trainingLeafValueRanking: { accuracy: 0.54 },
    actionRanking: accuracyRanking(
      Math.floor(validationGames / 3),
      validationGames,
      `validation-action-${replica}-${validationGames}`
    ),
    leafValueRanking: accuracyRanking(
      Math.floor(validationGames / 3),
      validationGames,
      `validation-leaf-${replica}-${validationGames}`,
      true
    ),
    anchorActionRanking: anchorAction,
    anchorLeafValueRanking: anchorLeaf
  };
}

test("growing shadow validation can fail only after a fixed-anchor warning", () => {
  const anchorAction = accuracyRanking(4, 12, "anchor-action");
  const anchorLeaf = accuracyRanking(4, 12, "anchor-leaf", true);
  const first = evaluatorEarlyDiagnosticStatus([
    weakCandidate(0, 12, anchorAction, anchorLeaf)
  ], {
    checkpointId: "first-real-interval",
    checkpointOrdinal: 0,
    validationEvidenceSufficient: true
  });
  assert.equal(first.failed, false);
  assert.equal(first.strongFailureObserved, false);
  assert.equal(first.shadowValidationWarningObserved, true);
  assert.equal(first.cumulativeValidationFailureObserved, false);

  const second = evaluatorEarlyDiagnosticStatus([
    weakCandidate(0, 60, anchorAction, anchorLeaf),
    weakCandidate(1, 60, anchorAction, anchorLeaf)
  ], {
    checkpointId: "second-real-interval",
    checkpointOrdinal: 1,
    previous: first,
    validationEvidenceSufficient: true
  });
  assert.equal(second.cumulativeValidationFailureObserved, true);
  assert.equal(second.replicaCoverageComplete, true);
  assert.equal(second.improvementFromPreviousCheckpoint, 0);
  assert.equal(second.failed, true);
  assert.deepEqual(second.reasons, [
    "repeated-action-shadow-validation-failure-with-no-anchor-improvement",
    "repeated-leaf-shadow-validation-failure-with-no-anchor-improvement"
  ]);
});

test("different weak heads on validation and anchor cannot combine into a failure", () => {
  const candidate = (replica) => ({
    architecture: { id: "flat-v1-64" },
    replica,
    evaluatorTraining: { history: [{
      samples: 100,
      batches: 4,
      loss: 0.4,
      rankingLoss: 0.2,
      outcomeLoss: 0.2
    }] },
    trainingActionRanking: { neuralAccuracy: 0.55 },
    trainingLeafValueRanking: { accuracy: 0.54 },
    actionRanking: accuracyRanking(24, 60, `mixed-validation-action-${replica}`),
    leafValueRanking: accuracyRanking(
      42,
      60,
      `mixed-validation-leaf-${replica}`,
      true
    ),
    anchorActionRanking: accuracyRanking(
      9,
      12,
      `mixed-anchor-action-${replica}`
    ),
    anchorLeafValueRanking: accuracyRanking(
      4,
      12,
      `mixed-anchor-leaf-${replica}`,
      true
    )
  });
  const first = evaluatorEarlyDiagnosticStatus([candidate(0)], {
    checkpointId: "mixed-head-first",
    checkpointOrdinal: 0,
    validationEvidenceSufficient: true
  });
  const second = evaluatorEarlyDiagnosticStatus([
    candidate(0),
    candidate(1)
  ], {
    checkpointId: "mixed-head-second",
    checkpointOrdinal: 1,
    previous: first,
    validationEvidenceSufficient: true
  });

  assert.equal(first.heads.action.pointFailureObserved, false);
  assert.equal(first.heads.leaf.pointFailureObserved, false);
  assert.equal(second.heads.action.repeatedFailure, false);
  assert.equal(second.heads.leaf.repeatedFailure, false);
  assert.equal(second.repeatedModelFailure, false);
  assert.equal(second.failed, false);
  assert.deepEqual(second.reasons, []);
});

test("fixed anchor stays frozen while cumulative shadow validation grows", () => {
  const firstRecords = Array.from({ length: 40 }, (_, gameIndex) => ({
    datasetKey: "diagnostic",
    workerIndex: gameIndex % 4,
    gameIndex,
    samplingMode: gameIndex % 2
      ? "action-ranking-audit"
      : "leaf-audit"
  }));
  const first = splitEvaluatorEarlyDiagnosticRecords(firstRecords, {
    seed: "longitudinal",
    validationFraction: 0.3
  });
  const expanded = splitEvaluatorEarlyDiagnosticRecords([
    ...firstRecords,
    ...Array.from({ length: 110 }, (_, index) => ({
      datasetKey: "diagnostic",
      workerIndex: index % 4,
      gameIndex: index + 40,
      samplingMode: index % 2
        ? "action-ranking-audit"
        : "leaf-audit"
    }))
  ], {
    seed: "longitudinal",
    validationFraction: 0.35,
    previousSplit: first
  });
  assert.deepEqual(
    expanded.anchorValidationRecordKeys,
    first.anchorValidationRecordKeys
  );
  assert.equal(
    expanded.validationRecordKeys.length
      > first.validationRecordKeys.length,
    true
  );
  assert.equal(
    first.trainingRecordKeys.every((key) =>
      expanded.trainingRecordKeys.includes(key)),
    true
  );
});
