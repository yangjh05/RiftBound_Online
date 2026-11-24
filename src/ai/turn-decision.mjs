import { enumerateAiPolicyActions } from "./actions.mjs";
import { encodeActionSet, encodeState } from "./neural/encoding.mjs";
import { choosePaymentPlan } from "./payment-planner.mjs";
import { choosePolicyAction, DEFAULT_AI_MODEL } from "./policy.mjs";
import { AI_TURN_WORKER_MESSAGE_TYPES } from "./turn-protocol.mjs";
import {needsPaymentOptionDecision} from './payment-options.mjs';

// Legal-action simulation is intentionally isolated from the browser thread.
// A mid-game board can create hundreds of movement candidates, and validating
// each one clones the full game. Only the lean action decision crosses back.
export function handleAiTurnWorkerRequest(message, options = {}) {
  const requestId = validRequestId(message?.requestId) ? message.requestId : null;
  try {
    validateRequest(message);
    const model = message.model || DEFAULT_AI_MODEL;
    if (message.game.pendingPayment && !needsPaymentOptionDecision(message.game)) {
      const plan = choosePaymentPlan(message.game, { model });
      return {
        type: AI_TURN_WORKER_MESSAGE_TYPES.result,
        requestId,
        ok: true,
        decision: {
          kind: "payment",
          // The engine's cancellation command is the authoritative recovery
          // when a declaration can no longer be paid.
          actions: plan?.actions?.length ? plan.actions : [{ kind: "cancelPayment" }]
        }
      };
    }

    const legalActions = enumerateAiPolicyActions(message.game, message.actorId);
    if (message.selectionMode === "neural") {
      const actionSet = encodeActionSet(message.game, message.actorId, legalActions);
      return {
        type: AI_TURN_WORKER_MESSAGE_TYPES.result,
        requestId,
        ok: true,
        decision: {
          kind: "neural",
          stateEncoding: encodeState(message.game, message.actorId),
          actions: actionSet.actions,
          actionEncoding: actionSet.encoded,
          legalCount: actionSet.legalCount,
          originalLegalCount: actionSet.originalLegalCount,
          truncated: actionSet.truncated
        }
      };
    }

    const selected = choosePolicyAction(message.game, message.actorId, legalActions, model, {
      temperature: message.temperature,
      ...(typeof options.random === "function" ? { random: options.random } : {})
    });
    return {
      type: AI_TURN_WORKER_MESSAGE_TYPES.result,
      requestId,
      ok: true,
      decision: {
        kind: "policy",
        selected: selected ? {
          action: selected.action,
          probability: selected.probability,
          score: selected.score
        } : null
      }
    };
  } catch (error) {
    return {
      type: AI_TURN_WORKER_MESSAGE_TYPES.result,
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function validateRequest(message) {
  if (!message || typeof message !== "object") throw new Error("AI turn request must be an object.");
  if (message.type !== AI_TURN_WORKER_MESSAGE_TYPES.decide) {
    throw new Error(`Unsupported AI turn message type: ${String(message.type || "")}.`);
  }
  if (!validRequestId(message.requestId)) throw new Error("AI turn requestId must be a string or finite number.");
  if (!message.game || typeof message.game !== "object") throw new Error("AI turn request requires a game state.");
  if (typeof message.actorId !== "string" || !message.actorId) throw new Error("AI turn request requires an actorId.");
  if (!message.model || typeof message.model !== "object") throw new Error("AI turn request requires a policy model.");
  if (!['policy', 'neural'].includes(message.selectionMode)) {
    throw new Error(`Unsupported AI selection mode: ${String(message.selectionMode || "")}.`);
  }
}

function validRequestId(value) {
  return typeof value === "string" && value.length > 0
    || typeof value === "number" && Number.isFinite(value);
}
