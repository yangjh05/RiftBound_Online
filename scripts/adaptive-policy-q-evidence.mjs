import path from "node:path";
import { createHash } from "node:crypto";
import { splitEvaluatorEarlyDiagnosticRecords } from "./evaluator-early-diagnostic.mjs";
import { assertTrajectoryRepresentation } from "./ai-training-representation.mjs";
import { assertDeckSearchGame } from "./adaptive-deck-search.mjs";

const key = entry => `${entry.datasetKey}:${entry.coordinate ?? `${entry.workerIndex}:${entry.gameIndex}`}`;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function assertAdaptiveEvidenceSplit(legacy) {
  const seen = new Set(), paths = new Set();
  for (const role of ["training", "validation"]) for (const entry of legacy[role] || []) {
    const id = key(entry), file = path.resolve(entry.archivePath);
    if (seen.has(id) || paths.has(file)) throw new Error("Adaptive training/validation overlap or duplicate.");
    seen.add(id); paths.add(file);
  }
  const validation = new Set((legacy.validation || []).map(key));
  if ((legacy.fixedAnchorKeys || []).some(id => !validation.has(id))) {
    throw new Error("Adaptive validation anchor is no longer held out.");
  }
}

export function splitAdaptiveLegacyRecords(records, { previous, initialSplit, seed, engineFingerprint }) {
  if (previous) {
    assertAdaptiveEvidenceSplit(previous);
    if (previous.engineFingerprint !== engineFingerprint) throw new Error("Adaptive legacy fingerprint changed.");
    const available = new Map(records.map(record => [key(record), path.resolve(record.archivePath)]));
    for (const entry of [...previous.training, ...previous.validation]) {
      if (available.get(key(entry)) !== path.resolve(entry.archivePath)) {
        throw new Error("A committed legacy game disappeared or changed identity.");
      }
    }
  }
  const commitment = previous ? {
    trainingRecordKeys: previous.training.map(key),
    validationRecordKeys: previous.validation.map(key)
  } : initialSplit;
  const split = splitEvaluatorEarlyDiagnosticRecords(records, { seed,
    validationFraction: initialSplit.validationFraction, previousSplit: commitment, requireStructuredV2: true });
  const entry = record => ({ archivePath: path.resolve(record.archivePath),
    coordinate: `${record.workerIndex}:${record.gameIndex}`, datasetKey: record.datasetKey });
  const result = { version: 1, contract: "preserved-training-only-shadow-split-v1",
    training: split.training.map(entry), validation: split.validation.map(entry),
    fixedAnchorKeys: previous ? [...previous.fixedAnchorKeys] : split.anchorValidationRecordKeys,
    sourceSplitHash: previous?.sourceSplitHash || digest(initialSplit), engineFingerprint };
  assertAdaptiveEvidenceSplit(result);
  return result;
}

export function assertAdaptiveTrainingEntries(entries, legacy) {
  assertAdaptiveEvidenceSplit(legacy);
  const heldOut = new Set(legacy.validation.map(entry => path.resolve(entry.archivePath)));
  const seen = new Set();
  for (const entry of entries) {
    const file = path.resolve(entry.archivePath);
    if (heldOut.has(file)) throw new Error("Held-out legacy game reached adaptive training.");
    if (seen.has(file)) throw new Error("Duplicate adaptive training game.");
    seen.add(file);
  }
}

export function assertAdaptiveGame(result, plan, gameIndex) {
  assertDeckSearchGame(result, plan, gameIndex);
  const summaries = result.summaries || (result.summary ? [result.summary] : []);
  if (summaries.length !== 1 || summaries[0].completed !== true || summaries[0].invalid
    || summaries[0].adjudicated || !["p1", "p2"].includes(summaries[0].winnerId)) {
    throw new Error("Adaptive PPO requires one naturally completed, valid game per archive.");
  }
  const trajectories = result.trajectories || [];
  if (trajectories.length !== 2 || new Set(trajectories.map(t => t.playerId)).size !== 2
    || trajectories.some(t => !["p1", "p2"].includes(t.playerId)
      || t.gameId !== `adaptive:${plan.iteration}:${gameIndex}`
      || t.sourcePolicyBehaviorHash !== plan.sourceBehaviorHash)) {
    throw new Error("Adaptive PPO game identity or behavior lineage mismatch.");
  }
  assertTrajectoryRepresentation(trajectories);
}

export function assertAdaptiveCheckpoint(checkpoint) {
  if (!checkpoint?.weights || !Object.keys(checkpoint.weights).length) throw new Error("Adaptive checkpoint has no weights.");
  for (const [layer, tensors] of Object.entries(checkpoint.weights)) {
    if (!Array.isArray(tensors) || !tensors.length) throw new Error(`Invalid adaptive layer: ${layer}`);
    for (const tensor of tensors) {
      if (!Array.isArray(tensor.shape) || tensor.shape.some(n => !Number.isInteger(n) || n < 1)
        || !(Array.isArray(tensor.values) || ArrayBuffer.isView(tensor.values))
        || tensor.values.length !== tensor.shape.reduce((a, b) => a * b, 1)
        || !tensor.values.every(Number.isFinite)) throw new Error(`Invalid or non-finite adaptive weights: ${layer}`);
    }
  }
}

// The shared metrics aggregator intentionally omits unavailable/non-finite
// diagnostics. Inspect raw batches before aggregation so a bad batch cannot
// disappear from the adaptive epoch guard.
export function adaptiveFiniteEpochGuard() {
  const failedEpochs = new Set();
  return {
    onBatch({ epoch, metrics }) {
      if (!Number.isFinite(metrics.loss) || Object.entries(metrics).some(([key, value]) =>
        (key.endsWith("Loss") || key === "gradientNorm" || key === "entropy" || key === "anchorKl")
        && !Number.isFinite(value))) failedEpochs.add(epoch);
    },
    epochGuard({ epoch, metrics }) {
      return { passed: !failedEpochs.has(epoch) && [metrics.meanLoss, metrics.meanPolicyLoss,
        metrics.meanValueLoss, metrics.meanActionValueLoss, metrics.meanGradientNorm].every(Number.isFinite) };
    }
  };
}
