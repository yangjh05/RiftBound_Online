import {
  deserializeNeuralModel,
  serializeNeuralModel
} from "../src/ai/neural/model.mjs";
import { trainingPrecisionCheckpointGames } from "./evaluator-bootstrap-collection-window.mjs";

export const EVALUATOR_BOOTSTRAP_STAGE_HANDOFF_VERSION = 2;
export const EVALUATOR_BOOTSTRAP_STAGE_MAX_ATTEMPTS = 3;

export function evaluatorBootstrapStageAttemptDecision({
  result,
  attempt,
  maximumAttempts = EVALUATOR_BOOTSTRAP_STAGE_MAX_ATTEMPTS,
  shutdownRequested = false
} = {}) {
  if (result?.ok === true) return "complete";
  if (result?.ok === false) return "failed";
  if (shutdownRequested !== true
    && Number.isInteger(attempt)
    && attempt < Math.max(1, Number(maximumAttempts) || 1)) {
    return "retry";
  }
  return "failed";
}

export function serializeEvaluatorBootstrapStageRequest(options, metadata = {}) {
  const checkpoint = options?.stopWhenEvidenceCheckpoint;
  const waveGames = Number(
    checkpoint?.requirement?.shadowActionEffectDemand?.requestedGames
  );
  if (checkpoint?.role === "training" && Number.isInteger(waveGames)
    && waveGames > 0) {
    // This boundary is shared by every caller, including resumed Shadow runs.
    options = {
      ...options,
      extensionGames: Math.min(waveGames, 64),
      rollingWindowGames: trainingPrecisionCheckpointGames(options)
        || Math.min(waveGames, 32)
    };
  }
  const {
    onAuditProgress: _onAuditProgress,
    collection = {},
    ...serializableOptions
  } = options || {};
  const {
    model,
    league = [],
    teacherEvaluatorModels = [],
    onStopRequested: _onStopRequested,
    ...serializableCollection
  } = collection;
  if (!model) {
    throw new Error("Evaluator-bootstrap stage handoff requires a model.");
  }
  const checkpointTable = [];
  const checkpointReferences = new Map();
  const checkpointReference = (candidate) => {
    if (checkpointReferences.has(candidate)) {
      return checkpointReferences.get(candidate);
    }
    const reference = checkpointTable.length;
    checkpointTable.push(serializeNeuralModel(candidate));
    checkpointReferences.set(candidate, reference);
    return reference;
  };
  return {
    version: EVALUATOR_BOOTSTRAP_STAGE_HANDOFF_VERSION,
    createdAt: new Date().toISOString(),
    metadata,
    options: {
      ...serializableOptions,
      collection: {
        ...serializableCollection,
        checkpointTable,
        modelCheckpointReference: checkpointReference(model),
        leagueCheckpointReferences: league.map(checkpointReference),
        teacherEvaluatorCheckpointReferences:
          teacherEvaluatorModels.map(checkpointReference)
      }
    }
  };
}

export function hydrateEvaluatorBootstrapStageRequest(request, callbacks = {}) {
  if (request?.version !== EVALUATOR_BOOTSTRAP_STAGE_HANDOFF_VERSION) {
    throw new Error("Unsupported evaluator-bootstrap stage handoff version.");
  }
  const collection = request.options?.collection || {};
  if (!Array.isArray(collection.checkpointTable)
    || !Number.isInteger(collection.modelCheckpointReference)) {
    throw new Error("Evaluator-bootstrap stage handoff is missing its model.");
  }
  const {
    checkpointTable,
    modelCheckpointReference,
    leagueCheckpointReferences = [],
    teacherEvaluatorCheckpointReferences = [],
    ...serializableCollection
  } = collection;
  const hydratedCheckpoints = checkpointTable.map((item) =>
    deserializeNeuralModel(item));
  const referencedCheckpoint = (reference) => {
    if (!Number.isInteger(reference) || !hydratedCheckpoints[reference]) {
      throw new Error("Evaluator-bootstrap stage handoff has an invalid model reference.");
    }
    return hydratedCheckpoints[reference];
  };
  return {
    ...request.options,
    onAuditProgress: callbacks.onAuditProgress,
    collection: {
      ...serializableCollection,
      model: referencedCheckpoint(modelCheckpointReference),
      league: leagueCheckpointReferences.map(referencedCheckpoint),
      teacherEvaluatorModels:
        teacherEvaluatorCheckpointReferences.map(referencedCheckpoint),
      onStopRequested: callbacks.onStopRequested
    }
  };
}
