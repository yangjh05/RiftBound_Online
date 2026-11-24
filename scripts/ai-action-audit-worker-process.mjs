import { existsSync } from "node:fs";
import process from "node:process";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import {
  certifiedIndependentEvaluators,
  neuralArtifactHash,
  neuralBehaviorHash
} from "../src/ai/neural/evaluator-certification.mjs";
import {
  validActionEvidenceProtocolManifest
} from "../src/ai/neural/evidence-protocol.mjs";
import { hydrateWorkerModel } from "../src/ai/neural/selfplay.mjs";
import { runIndependentActionAuditSeedBatch } from "../src/ai/neural/teacher.mjs";
import { readActionAuditOptionsHandoff } from "./ai-action-audit-options-handoff.mjs";
import { validateActionAuditTask } from "./ai-action-audit-task-contract.mjs";
import { restoreGameReferences } from "./game-state-references.mjs";

let initialized = false;
let learner = null;
let league = [];
let teacherEvaluators = [];
let commonOptions = null;
let busy = false;
const candidateCache = new Map();
const auditPolicyIdentityCache = new WeakMap();
const MAXIMUM_CACHED_CANDIDATES = Math.max(
  1,
  Math.min(
    4,
    Math.floor(Number(
      process.env.RIFTBOUND_ACTION_AUDIT_CANDIDATE_CACHE_SIZE
    ) || 2)
  )
);

process.on("message", async (message) => {
  try {
    if (message?.type === "initialize") {
      if (initialized) {
        throw new Error("Action-audit worker was initialized twice.");
      }
      commonOptions = await readActionAuditOptionsHandoff(message);
      if (commonOptions.teacherEvaluatorMode !== "heuristic-only"
        || validActionEvidenceProtocolManifest(
          commonOptions.evidenceProtocolManifest
        )) {
        learner = hydrateWorkerModel(commonOptions.model);
        league = (commonOptions.league || []).map(hydrateWorkerModel);
      }
      if (commonOptions.teacherEvaluatorMode !== "heuristic-only") {
        teacherEvaluators = (commonOptions.teacherEvaluatorModels || [])
          .map(hydrateWorkerModel);
      }
      initialized = true;
      await send({ type: "ready" });
      return;
    }
    if (message?.type === "run-audit-seed-batch") {
      if (!initialized) {
        throw new Error("Action-audit worker received work before initialization.");
      }
      if (busy) {
        throw new Error("Action-audit worker received overlapping tasks.");
      }
      busy = true;
      const wallStarted = process.hrtime.bigint();
      const cpuStarted = process.cpuUsage();
      const task = validateActionAuditTask(message.task);
      const candidate = await cachedCandidate(task.candidatePath);
      if (candidate.handoffCandidateId
        && candidate.handoffCandidateId !== task.candidateId) {
        throw new Error(
          `Action-audit task ${task.taskId} uses a different candidate ID.`
        );
      }
      if (task.engineFingerprint
        && candidate.engineFingerprint !== task.engineFingerprint) {
        throw new Error(
          `Action-audit task ${task.taskId} uses a different engine fingerprint.`
        );
      }
      if (task.informationSetHash
        && candidate.descriptor?.informationSetHash
          !== task.informationSetHash) {
        throw new Error(
          `Action-audit task ${task.taskId} uses a different information set.`
        );
      }
      const result = runIndependentActionAuditSeedBatch(candidate, {
        bank: task.bank,
        seeds: task.seeds,
        maximumSteps: task.maximumSteps,
        protocolPairIds: task.protocolPairIds
      });
      const cpuUsed = process.cpuUsage(cpuStarted);
      const wallMilliseconds = Number(
        process.hrtime.bigint() - wallStarted
      ) / 1_000_000;
      const computeUsage = {
        version: 1,
        contract: "action-audit-seed-batch-compute-v1",
        cpuMilliseconds: (cpuUsed.user + cpuUsed.system) / 1000,
        gpuMilliseconds: 0,
        wallMilliseconds,
        seedBatches: 1,
        pairedSeeds: task.seeds.length * Math.max(
          1,
          result.protocolResults?.length || 0
        )
      };
      await writeTrajectoryArchive(task.outputPath, {
        version: 1,
        contract: "detached-action-audit-seed-batch-result-v1",
        taskId: task.taskId,
        candidateId: task.candidateId,
        sourceArchivePath: task.sourceArchivePath,
        ...result,
        datasetKey: task.datasetKey || null,
        informationSetHash: task.informationSetHash || null,
        engineFingerprint:
          task.engineFingerprint || candidate.engineFingerprint || null,
        evidenceProtocolHash:
          candidate.descriptor?.evidenceProtocolManifest?.protocolHash
            || null,
        computeUsage
      });
      busy = false;
      await send({
        type: "audit-seed-batch-complete",
        taskId: task.taskId,
        outputPath: task.outputPath,
        computeUsage,
        workerRssBytes: process.memoryUsage().rss
      });
      return;
    }
    if (message?.type === "shutdown") {
      process.disconnect?.();
    }
  } catch (error) {
    busy = false;
    await send({
      type: "error",
      error: {
        message: error?.message || String(error),
        stack: error?.stack || null,
        code: error?.code || null
      },
      task: message?.task || null
    }).catch(() => {});
  }
});

function hydrateCandidate(payload) {
  const snapshot = payload?.candidate;
  if (!snapshot?.game || !snapshot?.actorId || !snapshot?.descriptor) {
    throw new Error("Detached action-audit candidate archive is invalid.");
  }
  if (snapshot.gameReferences) restoreGameReferences(snapshot.game, snapshot.gameReferences);
  const manifest = snapshot.descriptor?.evidenceProtocolManifest;
  const protocolEnabled = validActionEvidenceProtocolManifest(manifest);
  if (protocolEnabled
    && manifest.protocolHash
      !== commonOptions.evidenceProtocolManifest?.protocolHash) {
    throw new Error(
      "Detached action-audit candidate uses a different evidence protocol."
    );
  }
  if (commonOptions.teacherEvaluatorMode === "heuristic-only"
    && !protocolEnabled) {
    return {
      ...snapshot,
      handoffCandidateId: payload.candidateId || null,
      neuralModel: null,
      neuralModels: {},
      evaluatorModels: [],
      evaluatorModelsCertified: true,
      engineFingerprint:
        snapshot.engineFingerprint || commonOptions.engineFingerprint
    };
  }
  const seatModels = (payload.modelSeatSources || []).map((source) => {
    if (source?.kind === "league") {
      const selected = league[Number(source.index)];
      if (!selected) {
        throw new Error(
          `Detached action-audit league model ${source.index} is unavailable.`
        );
      }
      return selected;
    }
    return learner;
  });
  while (seatModels.length < snapshot.game.players.length) {
    seatModels.push(learner);
  }
  const neuralModels = Object.fromEntries(
    snapshot.game.players.map((player, seat) => [
      player.id,
      seatModels[seat] || learner
    ])
  );
  const actorSeat = snapshot.game.players.findIndex(
    (player) => player.id === snapshot.actorId
  );
  const actorModel = seatModels[Math.max(0, actorSeat)] || learner;
  const teacherUsesNeuralEvaluation =
    commonOptions.teacherEvaluatorMode !== "heuristic-only";
  const evaluatorPool = teacherUsesNeuralEvaluation
    ? [...new Set([
      ...teacherEvaluators,
      ...seatModels
    ].filter(Boolean))]
    : [];
  const evaluatorModels = teacherUsesNeuralEvaluation
    ? certifiedIndependentEvaluators(
      evaluatorPool,
      actorModel,
      {
        requiredPermission: "leafEvaluation",
        engineFingerprint:
          snapshot.engineFingerprint || commonOptions.engineFingerprint
      }
    ).accepted
    : [];
  const auditPolicyPairs = hydrateAuditPolicyPairs(
    snapshot,
    learner,
    league
  );
  return {
    ...snapshot,
    handoffCandidateId: payload.candidateId || null,
    neuralModel: teacherUsesNeuralEvaluation ? actorModel : null,
    neuralModels: teacherUsesNeuralEvaluation ? neuralModels : {},
    evaluatorModels,
    evaluatorModelsCertified: true,
    auditPolicyPairs,
    engineFingerprint:
      snapshot.engineFingerprint || commonOptions.engineFingerprint
  };
}

export function hydrateAuditPolicyPairs(snapshot, primary, leagueModels) {
  const manifest = snapshot.descriptor?.evidenceProtocolManifest;
  if (!validActionEvidenceProtocolManifest(manifest)) return [];
  const available = [...new Set([primary, ...(leagueModels || [])]
    .filter(Boolean))];
  const byArtifact = new Map();
  for (const model of available) {
    let identity = auditPolicyIdentityCache.get(model);
    if (!identity) {
      identity = {
        artifactHash: neuralArtifactHash(model),
        behaviorHash: neuralBehaviorHash(model)
      };
      auditPolicyIdentityCache.set(model, identity);
    }
    const { artifactHash, behaviorHash } = identity;
    if (artifactHash) byArtifact.set(artifactHash, { model, behaviorHash });
  }
  const resolveMembers = (pool, label) => (pool?.members || []).map(
    (member) => {
      const found = byArtifact.get(member.modelHash);
      if (!found || found.behaviorHash !== member.behaviorHash) {
        throw new Error(
          `Action-evidence ${label} ${member.id} does not match its frozen model hashes.`
        );
      }
      return { member, model: found.model };
    }
  );
  const continuations = resolveMembers(
    manifest.continuationPool,
    "continuation"
  );
  const opponents = resolveMembers(manifest.opponentPool, "opponent");
  if (!continuations.length || !opponents.length) {
    throw new Error("Action-evidence policy pools are empty.");
  }
  return continuations.flatMap(({ member: continuation, model }) =>
    opponents.map(({ member: opponent, model: opponentModel }) => {
      const neuralModels = Object.fromEntries(
        (snapshot.game?.players || []).map((player) => [
          player.id,
          player.id === snapshot.actorId ? model : opponentModel
        ])
      );
      return {
        continuationId: continuation.id,
        opponentId: opponent.id,
        neuralModel: model,
        neuralModels
      };
    })
  );
}

async function cachedCandidate(candidatePath) {
  if (candidateCache.has(candidatePath)) {
    const cached = candidateCache.get(candidatePath);
    candidateCache.delete(candidatePath);
    candidateCache.set(candidatePath, cached);
    return cached;
  }
  if (!existsSync(candidatePath)) {
    throw new Error(`Action-audit candidate is missing: ${candidatePath}`);
  }
  const payload = await readTrajectoryArchive(candidatePath);
  const candidate = hydrateCandidate(payload);
  candidateCache.set(candidatePath, candidate);
  while (candidateCache.size > MAXIMUM_CACHED_CANDIDATES) {
    candidateCache.delete(candidateCache.keys().next().value);
  }
  return candidate;
}

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error("Action-audit worker IPC is unavailable."));
      return;
    }
    process.send(message, (error) => error ? reject(error) : resolve());
  });
}
