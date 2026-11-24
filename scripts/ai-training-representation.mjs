import { createHash } from "node:crypto";
import { STATE_DIM, ACTION_DIM, CARD_BINS, CARD_VOCABULARY, MAX_ACTIONS } from "../src/ai/neural/encoding.mjs";

// Capture the representation loaded by this process, not a later disk revision.
export const SELF_PLAY_REPRESENTATION = Object.freeze({
  contract: "self-play-representation-v1", stateDim: STATE_DIM, actionDim: ACTION_DIM,
  cardBins: CARD_BINS, maxActions: MAX_ACTIONS,
  vocabularyHash: createHash("sha256").update(JSON.stringify(CARD_VOCABULARY)).digest("hex")
});

function mismatch(message, diagnostic) {
  const error = new Error(`AI training representation mismatch: ${message}`);
  error.code = "AI_REPRESENTATION_MISMATCH";
  error.diagnostic = diagnostic;
  return error;
}

export function assertSelfPlayRepresentation(received, expected = SELF_PLAY_REPRESENTATION) {
  for (const key of Object.keys(expected)) {
    if (received?.[key] !== expected[key]) {
      throw mismatch(`worker/controller ${key} differs`, { field: key, expected: expected[key], received: received?.[key] ?? null });
    }
  }
}

export function assertTrajectoryRepresentation(trajectories, expected = SELF_PLAY_REPRESENTATION) {
  for (const trajectory of trajectories) {
    if (!Array.isArray(trajectory.steps) || !trajectory.steps.length) {
      throw mismatch("trajectory has no decision steps", { gameId: trajectory.gameId, playerId: trajectory.playerId });
    }
    for (const [index, step] of trajectory.steps.entries()) {
      const identity = { gameId: trajectory.gameId, playerId: trajectory.playerId, step: index };
      if (step.state?.length !== expected.stateDim) {
        throw mismatch(`state has ${step.state?.length ?? "no"} inputs, expected ${expected.stateDim}`,
          { ...identity, field: "state", expected: expected.stateDim, received: step.state?.length ?? null });
      }
      const legal = step.legalCount;
      if (!Number.isInteger(legal) || legal < 1 || legal > expected.maxActions
        || ![legal * expected.actionDim, expected.maxActions * expected.actionDim].includes(step.actions?.length)) {
        throw mismatch("action feature layout differs", { ...identity, field: "actions", legalCount: legal,
          actionDim: expected.actionDim, received: step.actions?.length ?? null });
      }
      if (step.beliefTarget != null && step.beliefTarget.length !== expected.cardBins) {
        throw mismatch("belief vocabulary size differs", { ...identity, field: "beliefTarget",
          expected: expected.cardBins, received: step.beliefTarget.length ?? null });
      }
    }
  }
}
