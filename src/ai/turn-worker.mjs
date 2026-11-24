import { handleAiTurnWorkerRequest } from "./turn-decision.mjs";
import { AI_TURN_WORKER_MESSAGE_TYPES } from "./turn-protocol.mjs";
import { reviewRuntimeTacticalAction } from "./runtime-tactical-review.mjs";
import {verifyCheckpointBuffer} from './deck-league-routing.mjs';

export function registerAiTurnWorker(scope = globalThis, dependencies = {}) {
  if (typeof scope?.addEventListener !== "function" || typeof scope?.postMessage !== "function") return false;
  let queue = Promise.resolve();
  let neuralModel = null;
  let neuralSession = null;
  let disposeNeuralModel = null;
  let configuredDescriptorKey = "";
  let configuredCheckpointMetadata = null;

  scope.addEventListener("message", (event) => {
    // Dynamic TensorFlow loading and decisions must stay ordered. A decision
    // posted immediately after configuration cannot overtake model creation.
    queue = queue
      .then(() => handleMessage(event.data))
      .catch((error) => postFailure(event.data, error));
  });
  return true;

  async function handleMessage(message) {
    if (message?.type === AI_TURN_WORKER_MESSAGE_TYPES.configureNeural) {
      await configureNeural(message);
      return;
    }
    if (message?.type === AI_TURN_WORKER_MESSAGE_TYPES.resetNeural) {
      neuralSession?.reset();
      return;
    }

    const response = handleAiTurnWorkerRequest(message);
    if (response?.type !== AI_TURN_WORKER_MESSAGE_TYPES.result) return;
    if (response.ok && response.decision?.kind === "neural") {
      if (!neuralSession) throw new Error("AI turn neural model is not configured.");
      const selected = neuralSession.decideEncoded(message.actorId, response.decision, {
        temperature: message.temperature
      });
      const reviewed=reviewRuntimeTacticalAction(message.game,message.actorId,selected,response.decision.actions);
      response.decision = {
        kind: "neural",
        selected: leanSelection(reviewed.selection),
        runtimeReview: reviewed.review,
        originalLegalCount: response.decision.originalLegalCount,
        legalCount: response.decision.legalCount,
        truncated: response.decision.truncated
      };
    } else if(response.ok && response.decision?.kind==='policy' && response.decision.selected){
      const reviewed=reviewRuntimeTacticalAction(message.game,message.actorId,response.decision.selected);
      response.decision.selected=leanSelection(reviewed.selection);
      response.decision.runtimeReview=reviewed.review;
    }
    scope.postMessage(response);
  }

  async function configureNeural(message) {
    if (!validRequestId(message?.requestId)) throw new Error("AI turn neural configuration requires a requestId.");
    if (typeof message.descriptorKey !== "string" || !message.descriptorKey) {
      throw new Error("AI turn neural configuration requires a descriptor key.");
    }
    if (!(message.checkpointBuffer instanceof ArrayBuffer) || !message.checkpointBuffer.byteLength) {
      throw new Error("AI turn neural configuration requires a checkpoint buffer.");
    }
    await verifyCheckpointBuffer(message.checkpointBuffer,message.expectedCheckpointSha256);
    if (configuredDescriptorKey === message.descriptorKey && neuralSession) {
      scope.postMessage({
        type: AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured,
        requestId: message.requestId,
        descriptorKey: configuredDescriptorKey,
        checkpointMetadata: configuredCheckpointMetadata,
        ok: true
      });
      return;
    }

    const checkpoint = decodeNeuralCheckpoint(message.checkpointBuffer);
    const expectedGeneration = Number(message.expectedGeneration);
    if (Number.isInteger(expectedGeneration)
      && Number(checkpoint.generation) !== expectedGeneration) {
      throw new Error(`Expected neural generation ${expectedGeneration}, received ${String(checkpoint.generation)}.`);
    }
    const checkpointMetadata = lightweightCheckpointMetadata(checkpoint);
    const neural = dependencies.neural || await import("./neural/model.mjs");
    const nextModel = neural.deserializeNeuralModel(checkpoint);
    let nextSession;
    try {
      nextSession = neural.createNeuralSession(nextModel, {
        lean: true,
        maxHistory: 0
      });
    } catch (error) {
      neural.disposeNeuralModel(nextModel);
      throw error;
    }
    if (neuralModel && disposeNeuralModel) disposeNeuralModel(neuralModel);
    neuralModel = nextModel;
    neuralSession = nextSession;
    disposeNeuralModel = neural.disposeNeuralModel;
    configuredDescriptorKey = message.descriptorKey;
    configuredCheckpointMetadata = checkpointMetadata;
    scope.postMessage({
      type: AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured,
      requestId: message.requestId,
      descriptorKey: configuredDescriptorKey,
      checkpointMetadata: configuredCheckpointMetadata,
      ok: true
    });
  }

  function postFailure(message, error) {
    const configuration = message?.type === AI_TURN_WORKER_MESSAGE_TYPES.configureNeural;
    scope.postMessage({
      type: configuration
        ? AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured
        : AI_TURN_WORKER_MESSAGE_TYPES.result,
      requestId: validRequestId(message?.requestId) ? message.requestId : null,
      ...(configuration && typeof message?.descriptorKey === "string"
        ? { descriptorKey: message.descriptorKey }
        : {}),
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function decodeNeuralCheckpoint(buffer) {
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer)));
  } catch (error) {
    throw new Error(`AI turn neural checkpoint is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function lightweightCheckpointMetadata(checkpoint) {
  return {
    generation: Number(checkpoint?.generation) || 0,
    gamesTrained: Number(checkpoint?.gamesTrained) || 0,
    metadata: structuredClone(checkpoint?.metadata || {}),
    knowledge: structuredClone(checkpoint?.knowledge || {})
  };
}

function leanSelection(selected) {
  if (!selected) return null;
  return {
    action: selected.action,
    probability: selected.probability,
    ...(selected.value == null ? {} : { value: selected.value })
  };
}

function validRequestId(value) {
  return typeof value === "string" && value.length > 0
    || typeof value === "number" && Number.isFinite(value);
}

const runningInsideWorker = typeof globalThis.document === "undefined"
  && typeof globalThis.postMessage === "function";

if (runningInsideWorker) registerAiTurnWorker(globalThis);
