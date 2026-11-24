import { DEFAULT_AI_MODEL } from "./policy.mjs";

export const AI_TURN_WORKER_MESSAGE_TYPES = Object.freeze({
  configureNeural: "ai-turn-configure-neural",
  neuralConfigured: "ai-turn-neural-configured",
  resetNeural: "ai-turn-reset-neural",
  decide: "ai-turn-decide",
  result: "ai-turn-result"
});

export function createAiTurnNeuralConfigureRequest({
  requestId,
  descriptorKey,
  checkpointBuffer,
  expectedGeneration,
  expectedCheckpointSha256
} = {}) {
  return {
    type: AI_TURN_WORKER_MESSAGE_TYPES.configureNeural,
    requestId,
    descriptorKey,
    checkpointBuffer,
    expectedGeneration,
    ...(expectedCheckpointSha256?{expectedCheckpointSha256}:{})
  };
}

export function createAiTurnNeuralResetRequest() {
  return { type: AI_TURN_WORKER_MESSAGE_TYPES.resetNeural };
}

export function createAiTurnWorkerRequest({
  requestId,
  game,
  actorId,
  model = DEFAULT_AI_MODEL,
  selectionMode = "policy",
  temperature = 0.22
} = {}) {
  return {
    type: AI_TURN_WORKER_MESSAGE_TYPES.decide,
    requestId,
    game,
    actorId,
    model,
    selectionMode,
    temperature
  };
}
