import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { freemem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { serializeNeuralModel } from "../src/ai/neural/model.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import {
  compactIndependentActionAuditStageDiagnostic,
  compareActionAuditRaceEntries,
  finalizeIndependentActionAuditBatches,
  independentActionAuditEvidenceFromBatches,
  independentActionAuditFutilityReasons,
  independentActionAuditProtocolMixtureEvidence,
  independentActionAuditSeedBank,
  independentActionAuditStageFailureReasons,
  mergeIndependentActionAuditSeedBatches,
  mergeIndependentActionAuditProtocolBatches
} from "../src/ai/neural/teacher.mjs";
import {
  actionRankingAuditHasStructuredV2Companions,
  createActionRankingAuditReference
} from "../src/ai/neural/action-ranking-reference.mjs";
import {
  benjaminiHochbergCorrection,
  createActionEvidenceSeedCommitment,
  oneSidedNormalPValue,
  summarizeActionEvidenceEfficiency,
  validActionEvidenceProtocolManifest
} from "../src/ai/neural/evidence-protocol.mjs";
import { createEvaluatorBootstrapResultIndex } from "./evaluator-bootstrap-index.mjs";
import {
  selfPlayChildExecArgv,
  selfPlayProcessEnvironment,
  selfPlayDynamicCapacityLimit
} from "./ai-selfplay-process-pool.mjs";
import {
  independentActionAuditNearMissRescueEligible
} from "./action-audit-rescue.mjs";
import {
  createActionAuditOptionsHandoff,
  discardActionAuditOptionsHandoff
} from "./ai-action-audit-options-handoff.mjs";
import {
  readValidatedActionAuditSeedBatchOutput,
  serializableActionAuditTask
} from "./ai-action-audit-task-contract.mjs";
import {
  createRemoteActionAuditPool,
  remoteActionAuditConfiguration,
  remoteActionAuditTaskShare
} from "./ai-action-audit-remote-pool.mjs";
import {
  replaceEvaluatorBootstrapArchiveAndSummary
} from "./evaluator-bootstrap-transaction.mjs";

const WORKER_PATH = fileURLToPath(
  new URL("./ai-action-audit-worker-process.mjs", import.meta.url)
);
const COORDINATOR_CONTRACT = "detached-action-audit-coordinator-v1";
// Keep evidence checkpoints at 8/16/24/32 and 16/32/48/64 pairs. Dense
// candidate stages may group a few already-precommitted seeds to amortize
// archive hydration and IPC, but sparse finalist stages retain one seed per
// task so the full pool can still participate.
const MAXIMUM_SEED_CHUNK_SIZE = 4;
const LEGACY_SEED_CHUNK_SIZE = 4;
const MINIMUM_QUEUED_TASKS_PER_PROCESS = 2;
const MAXIMUM_CONCURRENT_SEED_TASKS_PER_ENTRY = 16;
// The narrowest non-final checkpoint adds eight paired seeds per surviving
// game (selection 16 -> 24 and 24 -> 32). Keep enough games in a fine-mode
// role chunk to fill the requested pool without speculatively evaluating a
// seed beyond an existing statistical checkpoint.
const FINAL_CHECKPOINT_TASKS_PER_GAME = 16;
const DEFAULT_FINALIST_RATE_PER_GAME = 0.2;
const MAXIMUM_FINE_ROLE_CHUNK_GAMES = 6;
const PIPELINE_MICRO_CHUNK_GAMES = 2;
// Seed batches do not retain full game trajectories, so they can safely live
// longer than self-play workers. RSS still forces an immediate replacement.
const WORKER_RECYCLE_TASKS = 64;
const WORKER_RECYCLE_RSS_BYTES = 1_200 * 1024 * 1024;
const DEFAULT_MINIMUM_FREE_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_DYNAMIC_WORKER_HEADROOM_BYTES = WORKER_RECYCLE_RSS_BYTES;
const DEFAULT_DYNAMIC_SCALE_INTERVAL_MS = 10_000;
const DEFAULT_DYNAMIC_SCALE_HEALTHY_SAMPLES = 2;
const NEAR_MISS_RESCUE_BANK = "near-miss-final-v1";
const NEAR_MISS_RESCUE_MAXIMUM_LOWER_BOUND_GAP = 0.03;

export async function runDetachedActionAuditCoordinator(options = {}) {
  if (detachedAuditStopRequested(options)) {
    return detachedAuditPausedSummary([], "before-prepare");
  }
  const prepared = [];
  for (const record of options.records || []) {
    const payload = await readTrajectoryArchive(record.archivePath);
    const result = payload?.result || payload;
    if (result?.pendingActionAudit?.executionContract
      !== "global-seed-batch-queue-v1") continue;
    prepared.push(await prepareGamePlan(record, payload, result, options));
  }
  if (prepared.length === 0) {
    return {
      version: 1,
      contract: COORDINATOR_CONTRACT,
      games: 0,
      candidates: 0,
      references: 0,
      pairedSeedsCompleted: 0
    };
  }
  if (detachedAuditStopRequested(options)) {
    return detachedAuditPausedSummary(prepared, "after-prepare");
  }

  let references = 0;
  let pairedSeedsCompleted = 0;
  let completedGames = 0;
  let skippedTargetSatisfied = 0;
  const reportProgress = options.onProgress;
  const pool = await createDistributedActionAuditPool({
    ...options,
    onProgress: (progress) => reportProgress?.({
      ...progress,
      games: completedGames,
      totalGames: prepared.length,
      skippedTargetSatisfied,
      references,
      totalPairedSeedsCompleted: pairedSeedsCompleted
    }),
    processes: detachedActionAuditProcessCount(
      prepared,
      Number(options.processes) || 16
    )
  });
  const configuredRoleChunkGames = Math.max(
    0,
    Math.floor(Number(options.roleChunkGames) || 0)
  );
  const gamesByRole = new Map();
  for (const game of prepared) {
    const role = game.record.certificationRole || "unassigned";
    if (!gamesByRole.has(role)) gamesByRole.set(role, []);
    gamesByRole.get(role).push(game);
  }
  try {
    for (const [role, roleGames] of gamesByRole) {
      for (let offset = 0; offset < roleGames.length;) {
        if (typeof options.shouldContinueCertificationRole === "function"
          && options.shouldContinueCertificationRole(role) === false) {
          const skippedGames = roleGames.slice(offset);
          for (const game of skippedGames) {
            markActionAuditGameSkippedTargetSatisfied(game);
            const payload = await readTrajectoryArchive(
              game.record.archivePath
            );
            const result = payload?.result || payload;
            const finalized = finalizeGamePlan(game, result);
            await persistFinalizedEvaluatorBootstrapGame(
              game,
              payload,
              result,
              finalized
            );
            completedGames += 1;
            skippedTargetSatisfied += 1;
          }
          options.onProgress?.({
            stage: "detached-action-audit-target-satisfied",
            role,
            games: completedGames,
            totalGames: prepared.length,
            skippedTargetSatisfied,
            references,
            pairedSeedsCompleted
          });
          break;
        }
        const liveChunkGames = Math.max(
          1,
          Math.floor(Number(
            typeof options.resolveRoleChunkGames === "function"
              ? options.resolveRoleChunkGames({
                role,
                offset,
                remainingGames: roleGames.length - offset,
                completedGames,
                references,
                processCount: pool.processCount
              })
              : configuredRoleChunkGames
          ) || detachedActionAuditFineRoleChunkGames(
            pool.processCount,
            null,
            options.roleChunkContext?.[role] || options.roleChunkContext
          ))
        );
        const chunk = roleGames.slice(offset, offset + liveChunkGames);
        const pipelineChunks = detachedActionAuditPipelineChunks(chunk);
        const pausePoints = await Promise.all(
          pipelineChunks.map((pipelineChunk) =>
            runDetachedAuditStages(pipelineChunk, pool, options))
        );
        const pausedAt = pausePoints.find(Boolean) || null;
        if (pausedAt) {
          return {
            ...detachedAuditPausedSummary(chunk, pausedAt),
            completedGames,
            skippedTargetSatisfied,
            references,
            pairedSeedsCompleted
          };
        }
        for (const game of chunk) {
          const payload = await readTrajectoryArchive(
            game.record.archivePath
          );
          const result = payload?.result || payload;
          const finalized = finalizeGamePlan(game, result);
          references += finalized.references;
          pairedSeedsCompleted += finalized.pairedSeedsCompleted;
          await persistFinalizedEvaluatorBootstrapGame(
            game,
            payload,
            result,
            finalized
          );
          completedGames += 1;
        }
        offset += chunk.length;
        options.onProgress?.({
          stage: "detached-action-audit-role-checkpoint",
          role,
          games: completedGames,
          totalGames: prepared.length,
          skippedTargetSatisfied,
          references,
          pairedSeedsCompleted
        });
      }
    }
  } finally {
    await pool.close();
  }
  options.onProgress?.({
    stage: "detached-action-audit-complete",
    games: completedGames,
    totalGames: prepared.length,
    skippedTargetSatisfied,
    references,
    pairedSeedsCompleted
  });
  return {
    version: 1,
    contract: COORDINATOR_CONTRACT,
    games: completedGames,
    totalGames: prepared.length,
    skippedTargetSatisfied,
    candidates: prepared.reduce(
      (sum, game) => sum + game.entries.length,
      0
    ),
    references,
    pairedSeedsCompleted
  };
}

async function runDetachedAuditStages(games, pool, options) {
  await runSelectionPilot(games, pool, options);
  if (detachedAuditStopRequested(options)) return "selection-8";
  const protocolGames = games.filter(gameUsesPrecommittedEvidenceProtocol);
  const legacyGames = games.filter(
    (game) => !gameUsesPrecommittedEvidenceProtocol(game)
  );
  if (legacyGames.length > 0) {
    await runSelectionSixteen(legacyGames, pool, options);
    if (detachedAuditStopRequested(options)) return "selection-16";
    await runSelectionFinalists(legacyGames, pool, options);
  }
  if (protocolGames.length > 0) {
    await runPrecommittedSelectionFinalists(protocolGames, pool, options);
  }
  if (detachedAuditStopRequested(options)) return "selection-32";
  await runFinalConfirmation(games, pool, options);
  if (detachedAuditStopRequested(options)) return "final-64";
  await runNearMissFinalRescue(games, pool, options);
  if (detachedAuditStopRequested(options)) return "near-miss-rescue";
  await runPromisingRunnerUpFallback(games, pool, options);
  return null;
}

function detachedAuditStopRequested(options) {
  return Boolean(
    options.stopRequestPath
    && existsSync(options.stopRequestPath)
  );
}

function detachedAuditPausedSummary(prepared, checkpoint) {
  return {
    version: 1,
    contract: COORDINATOR_CONTRACT,
    paused: true,
    checkpoint,
    games: prepared.length,
    candidates: prepared.reduce(
      (sum, game) => sum + game.entries.length,
      0
    ),
    references: prepared.reduce(
      (sum, game) => sum + game.entries.filter((entry) => entry.audit).length,
      0
    ),
    pairedSeedsCompleted: prepared.reduce(
      (sum, game) => sum + game.entries.reduce(
        (entrySum, entry) =>
          entrySum
          + entry.selectionResults.length
          + entry.finalResults.length
          + entry.rescueFinalResults.length,
        0
      ),
      0
    )
  };
}

async function prepareGamePlan(record, payload, result, options) {
  const pending = result.pendingActionAudit;
  const root = path.join(
    options.directory,
    "detached-action-audit",
    coordinateKey(record)
  );
  await mkdir(root, { recursive: true });
  const entries = [];
  for (const snapshot of pending.candidates || []) {
    const candidateId = digest([
      record.datasetKey,
      record.workerIndex,
      record.gameIndex,
      snapshot.auditKey
    ]);
    const candidatePath = path.join(root, `${candidateId}.candidate.json.gz`);
    const evidenceProtocol = snapshot.descriptor?.evidenceProtocolManifest;
    const protocolEligible = validActionEvidenceProtocolManifest(
      evidenceProtocol
    );
    const selectionSeeds = independentActionAuditSeedBank(
      snapshot,
      "selection",
      32
    );
    const finalSeeds = independentActionAuditSeedBank(
      snapshot,
      "final-v2",
      protocolEligible ? 128 : 64,
      selectionSeeds
    );
    const rescueFinalSeeds = independentActionAuditSeedBank(
      snapshot,
      NEAR_MISS_RESCUE_BANK,
      protocolEligible ? 128 : 64,
      [...selectionSeeds, ...finalSeeds]
    );
    if (protocolEligible) {
      snapshot.descriptor.evidenceCommitment =
        createActionEvidenceSeedCommitment(evidenceProtocol, {
          auditKey: snapshot.descriptor.auditKey,
          informationSetHash: snapshot.descriptor.informationSetHash,
          pilotSeeds: selectionSeeds.slice(0, 8),
          selectionSeeds,
          finalSeeds,
          excludedSeeds: snapshot.descriptor.occupiedAuditSeeds,
          rolloutsStarted: false
        });
    }
    if (!existsSync(candidatePath) || protocolEligible) {
      await writeTrajectoryArchive(candidatePath, {
        version: 1,
        contract: "detached-action-audit-candidate-v1",
        candidateId,
        candidate: snapshot,
        modelSeatSources: pending.modelSeatSources || []
      });
    }
    entries.push({
      candidate: snapshot,
      candidateId,
      datasetKey: record.datasetKey,
      candidatePath,
      sourceArchivePath: record.archivePath,
      root,
      selectionSeeds,
      finalSeeds,
      rescueFinalSeeds,
      selectionResults: [],
      selectionProtocolResults: [],
      finalResults: [],
      finalProtocolResults: [],
      rescueFinalResults: [],
      rescueFinalProtocolResults: [],
      selectionEvidence: null,
      finalEvidence: null,
      rescueFinalEvidence: null,
      computeUsage: {
        cpuMilliseconds: 0,
        gpuMilliseconds: 0,
        wallMilliseconds: 0,
        seedBatches: 0,
        policyPairSeedEvaluations: 0
      },
      diagnostic: {
        version: 3,
        contract: "independent-terminal-action-audit-diagnostic-v3",
        auditKey: snapshot.descriptor.auditKey,
        samplingFrame: structuredClone(
          snapshot.descriptor.samplingFrame || null
        ),
        evidenceProtocolHash:
          snapshot.descriptor.evidenceProtocolManifest?.protocolHash || null,
        status: "candidate-pending",
        gateReasons: [],
        racing: {
          version: 1,
          contract: "candidate-racing-8-16-32-64-v1",
          execution: "global-seed-batch-queue-v1",
          source: snapshot.selectionSource || "priority",
          stratum: structuredClone(snapshot.stratum || null),
          cheapPriority: structuredClone(
            snapshot.descriptor.priority || null
          ),
          checkpoints: []
        },
        selection: null,
        final: null
      }
    });
  }
  await restoreExistingActionAuditSeedBatches(root, entries);
  return {
    record,
    root,
    entries,
    pilotSurvivors: [],
    sixteenSurvivors: [],
    finalist: null,
    primaryFinalist: null
  };
}

export async function restoreExistingActionAuditSeedBatches(
  root,
  entries = []
) {
  const byCandidate = new Map(
    (entries || []).map((entry) => [entry.candidateId, entry])
  );
  if (byCandidate.size === 0) return 0;
  const batchesByEntryBank = new Map();
  let restored = 0;
  const names = await readdir(root).catch(() => []);
  for (const name of names) {
    if (!name.endsWith(".seed-batch.json.gz")) continue;
    const outputPath = path.join(root, name);
    try {
      const payload = await readTrajectoryArchive(outputPath);
      const entry = byCandidate.get(payload?.candidateId);
      const bank = payload?.bank;
      if (!entry
        || !["selection", "final-v2", NEAR_MISS_RESCUE_BANK]
          .includes(bank)) continue;
      const seeds = Array.from(
        payload?.seeds || [],
        (seed) => Number(seed) >>> 0
      );
      const allowedSeeds = new Set(entrySeeds(entry, bank));
      if (seeds.length === 0
        || seeds.some((seed) => !allowedSeeds.has(seed))) continue;
      const expectedProtocolPairIds = actionEvidenceProtocolPairIds(entry);
      const payloadProtocolPairIds = Array.from(
        payload?.protocolResults || [],
        (item) => `${item?.continuationId || ""}::${item?.opponentId || ""}`
      ).sort();
      if (expectedProtocolPairIds.length > 0
        && (payloadProtocolPairIds.length === 0
          || payloadProtocolPairIds.some((id) =>
            !expectedProtocolPairIds.includes(id)))) continue;
      if (expectedProtocolPairIds.length === 0
        && payloadProtocolPairIds.length > 0) continue;
      const legacyTaskId = seedBatchTaskId(entry.candidateId, bank, seeds);
      const pairTaskId = seedBatchTaskId(
        entry.candidateId,
        bank,
        seeds,
        payloadProtocolPairIds
      );
      if (payload?.taskId !== legacyTaskId && payload?.taskId !== pairTaskId) {
        continue;
      }
      const task = {
        taskId: payload.taskId,
        candidateId: entry.candidateId,
        candidatePath: entry.candidatePath || outputPath,
        outputPath,
        bank,
        seeds,
        evidenceProtocolHash: entry.candidate?.descriptor
          ?.evidenceProtocolManifest?.protocolHash || null,
        protocolPairIds: payloadProtocolPairIds,
        maximumSteps: Math.max(
          1,
          Number(entry.candidate?.descriptor?.search?.maximumSteps) || 1
        )
      };
      const validated = await readValidatedActionAuditSeedBatchOutput(
        task,
        outputPath
      );
      accumulateEntryComputeUsage(entry, validated.computeUsage);
      const key = `${entry.candidateId}:${bank}`;
      const target = batchesByEntryBank.get(key) || [];
      target.push(validated);
      batchesByEntryBank.set(key, target);
      restored += 1;
    } catch {
      // A partial or obsolete file is not evidence. Its exact task path will be
      // validated and replaced if the scheduler needs those seeds again.
    }
  }
  for (const entry of entries || []) {
    for (const bank of ["selection", "final-v2", NEAR_MISS_RESCUE_BANK]) {
      const batches = batchesByEntryBank.get(`${entry.candidateId}:${bank}`);
      if (!batches?.length) continue;
      const protocolMerged = mergeIndependentActionAuditProtocolBatches(
        batches
      );
      const merged = primaryOrLegacyActionAuditResults(
        entry,
        batches,
        protocolMerged
      );
      const evidence = actionAuditStageEvidence(
        entry,
        merged,
        protocolMerged
      );
      if (bank === "selection") {
        entry.selectionResults = merged;
        entry.selectionProtocolResults = protocolMerged;
        entry.selectionEvidence = evidence;
      } else if (bank === NEAR_MISS_RESCUE_BANK) {
        entry.rescueFinalResults = merged;
        entry.rescueFinalProtocolResults = protocolMerged;
        entry.rescueFinalEvidence = evidence;
      } else {
        entry.finalResults = merged;
        entry.finalProtocolResults = protocolMerged;
        entry.finalEvidence = evidence;
      }
    }
  }
  return restored;
}

async function runSelectionPilot(games, pool, options) {
  const entries = games.flatMap((game) => game.entries);
  await runEntryStage(entries, pool, {
    bank: "selection",
    targetPairs: 8,
    maximumSteps: options.maximumSteps
  });
  for (const game of games) {
    const survivors = [];
    for (const entry of game.entries) {
      const reasons = independentActionAuditFutilityReasons(
        entry.selectionEvidence,
        {
          targetPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection")
        }
      );
      appendCheckpoint(entry, 8, "selection", reasons);
      if (reasons.length === 0) survivors.push(entry);
      else entry.diagnostic.status = "racing-futile-after-8";
    }
    const rankedSurvivors = survivors.sort(compareActionAuditRaceEntries);
    game.pilotSurvivors = rankedSurvivors.slice(0, 2);
    const continuationConflict = rankedSurvivors.find((entry) =>
      entryUsesPrecommittedEvidenceProtocol(entry)
        && actionAuditProtocolDirectionsConflict(entry));
    if (continuationConflict
      && !game.pilotSurvivors.includes(continuationConflict)) {
      game.pilotSurvivors[game.pilotSurvivors.length - 1] =
        continuationConflict;
      continuationConflict.diagnostic.racing.preservedReason =
        "continuation-direction-conflict";
    }
    const retained = new Set(game.pilotSurvivors);
    for (const entry of game.entries) {
      if (entry.diagnostic.status === "candidate-pending"
        && !retained.has(entry)) {
        entry.diagnostic.status = "racing-eliminated-after-8";
      }
    }
  }
}

function actionAuditProtocolDirectionsConflict(entry) {
  const means = (entry.selectionProtocolResults || []).flatMap((item) => {
    const evidence = independentActionAuditEvidenceFromBatches(
      entry.candidate,
      item.results || []
    );
    const mean = Number(evidence?.terminalEvidence?.mean);
    return Number.isFinite(mean) ? [mean] : [];
  });
  return means.some((value) => value > 0)
    && means.some((value) => value < 0);
}

async function runSelectionSixteen(games, pool, options) {
  const entries = games.flatMap((game) => game.pilotSurvivors);
  await runEntryStage(entries, pool, {
    bank: "selection",
    targetPairs: 16,
    maximumSteps: options.maximumSteps
  });
  for (const game of games) {
    game.sixteenSurvivors = [];
    for (const entry of game.pilotSurvivors) {
      const reasons = independentActionAuditFutilityReasons(
        entry.selectionEvidence,
        {
          targetPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection")
        }
      );
      appendCheckpoint(entry, 16, "selection", reasons);
      if (reasons.length === 0) game.sixteenSurvivors.push(entry);
      else entry.diagnostic.status = "racing-futile-after-16";
    }
    game.sixteenSurvivors.sort(compareActionAuditRaceEntries);
  }
}

async function runPrecommittedSelectionFinalists(games, pool, options) {
  const candidates = games.flatMap((game) => game.pilotSurvivors);
  await runEntryStage(candidates, pool, {
    bank: "selection",
    targetPairs: 32,
    maximumSteps: options.maximumSteps
  });
  for (const game of games) {
    const preliminary = [];
    for (const entry of game.pilotSurvivors) {
      const reasons = independentActionAuditStageFailureReasons(
        entry.selectionEvidence,
        {
          attemptedPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection"),
          minimumEffect: 0
        }
      );
      appendCheckpoint(entry, 32, "selection", reasons);
      const terminal = entry.selectionEvidence?.terminalEvidence || {};
      const selectionSamples = Math.max(
        0,
        Number(terminal.samples) || 0
      );
      const reportedStandardError = Math.max(
        0,
        Number(terminal.standardError) || 0
      );
      const pValue = oneSidedNormalPValue(
        terminal.mean,
        reportedStandardError > 0
          ? reportedStandardError
          : selectionSamples > 1
            ? 1 / Math.sqrt(selectionSamples)
            : 1,
        0
      );
      preliminary.push({ entry, reasons, pValue });
    }
    const manifest = game.pilotSurvivors[0]?.candidate?.descriptor
      ?.evidenceProtocolManifest;
    const discoveries = benjaminiHochbergCorrection(
      preliminary.map(({ entry, pValue }) => ({
        id: entry.candidateId,
        pValue: pValue ?? 1
      })),
      Number(manifest?.statistics?.discoveryFalseDiscoveryRate) || 0.05
    );
    const discoveryById = new Map(
      discoveries.map((item) => [item.id, item])
    );
    const passed = [];
    for (const item of preliminary) {
      const discovery = discoveryById.get(item.entry.candidateId);
      item.entry.diagnostic.multipleTesting = {
        version: 1,
        contract: "action-evidence-candidate-discovery-v1",
        correction: "benjamini-hochberg-fdr",
        familySize: discovery?.familySize || preliminary.length,
        pValue: discovery?.pValue ?? null,
        adjustedPValue: discovery?.adjustedPValue ?? null,
        rejected: discovery?.rejected === true
      };
      const reasons = [...item.reasons];
      if (discovery?.rejected !== true) {
        reasons.push("candidate-not-discovered-after-bh-fdr");
      }
      if (reasons.length === 0) passed.push(item.entry);
      else item.entry.diagnostic.status = "selection-failed";
    }
    const ranked = passed.sort(compareActionAuditRaceEntries);
    game.sixteenSurvivors = ranked;
    game.finalist = ranked[0] || null;
    game.primaryFinalist = game.finalist;
    for (const entry of ranked.slice(1)) {
      entry.diagnostic.status = "racing-eliminated-after-32";
    }
  }
}

async function runSelectionFinalists(games, pool, options) {
  const unresolved = new Set(
    games.filter((game) => game.sixteenSurvivors.length > 0)
  );
  const maximumRank = Math.max(
    0,
    ...games.map((game) => game.sixteenSurvivors.length)
  );
  for (let rank = 0; rank < maximumRank && unresolved.size > 0; rank += 1) {
    const candidates = [...unresolved]
      .map((game) => game.sixteenSurvivors[rank])
      .filter(Boolean);
    await runEntryStage(candidates, pool, {
      bank: "selection",
      targetPairs: 24,
      maximumSteps: options.maximumSteps
    });
    const afterTwentyFour = [];
    for (const entry of candidates) {
      const reasons = independentActionAuditFutilityReasons(
        entry.selectionEvidence,
        {
          targetPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection")
        }
      );
      appendCheckpoint(entry, 24, "selection", reasons);
      if (reasons.length === 0) afterTwentyFour.push(entry);
      else entry.diagnostic.status = "racing-futile-after-24";
    }
    await runEntryStage(afterTwentyFour, pool, {
      bank: "selection",
      targetPairs: 32,
      maximumSteps: options.maximumSteps
    });
    for (const game of [...unresolved]) {
      const entry = game.sixteenSurvivors[rank];
      if (!entry) {
        unresolved.delete(game);
        continue;
      }
      if (!afterTwentyFour.includes(entry)) continue;
      const reasons = independentActionAuditStageFailureReasons(
        entry.selectionEvidence,
        {
          attemptedPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection")
        }
      );
      appendCheckpoint(entry, 32, "selection", reasons);
      if (reasons.length === 0) {
        game.finalist = entry;
        game.primaryFinalist = entry;
        unresolved.delete(game);
      } else {
        entry.diagnostic.status = "selection-failed";
      }
    }
  }
  for (const game of games) {
    if (!game.finalist) continue;
    for (const entry of game.sixteenSurvivors) {
      if (entry !== game.finalist
        && entry.diagnostic.status === "candidate-pending") {
        entry.diagnostic.status = "racing-eliminated-after-16";
      }
    }
  }
}

async function runFinalConfirmation(games, pool, options) {
  const finalists = games.map((game) => game.finalist).filter(Boolean);
  const groups = [
    {
      entries: finalists.filter(entryUsesPrecommittedEvidenceProtocol),
      finalPairs: 128,
      minimumTerminalPairs: 64,
      checkpoints: [32, 64, 96, 128]
    },
    {
      entries: finalists.filter(
        (entry) => !entryUsesPrecommittedEvidenceProtocol(entry)
      ),
      finalPairs: 64,
      minimumTerminalPairs: 32,
      checkpoints: [16, 32, 48, 64]
    }
  ];
  for (const group of groups) {
    let active = group.entries;
    for (const targetPairs of group.checkpoints) {
      if (active.length === 0) break;
      await runEntryStage(active, pool, {
        bank: "final-v2",
        targetPairs,
        maximumSteps: options.maximumSteps
      });
      const next = [];
      for (const entry of active) {
        const minimumEffect = group.finalPairs === 128
          ? Number(entry.candidate.descriptor.evidenceProtocolManifest
            ?.statistics?.minimumTrainingEffect) || 0
          : 0;
        const reasons = targetPairs === group.finalPairs
          ? independentActionAuditStageFailureReasons(entry.finalEvidence, {
            attemptedPairs: group.finalPairs,
            minimumTerminalPairs: group.minimumTerminalPairs,
            seedBanksDisjoint: seedBanksDisjoint(entry, "final-v2"),
            minimumEffect
          })
          : independentActionAuditFutilityReasons(entry.finalEvidence, {
            targetPairs: group.finalPairs,
            minimumTerminalPairs: group.minimumTerminalPairs,
            seedBanksDisjoint: seedBanksDisjoint(entry, "final-v2")
          });
        appendCheckpoint(entry, targetPairs, "final-v2", reasons);
        if (reasons.length === 0) next.push(entry);
        else {
          entry.diagnostic.status = targetPairs === group.finalPairs
            ? "final-failed"
            : `racing-futile-final-${targetPairs}`;
        }
      }
      active = next;
    }
    for (const entry of active) {
      const finalized = finalizeIndependentActionAuditBatches(
        entry.candidate,
        {
          selectionResults: entry.selectionResults,
          protocolSelectionResults: entry.selectionProtocolResults,
          finalResults: entry.finalResults,
          protocolFinalResults: entry.finalProtocolResults,
          computeUsage: summarizeEntryComputeUsage(entry)
        }
      );
      entry.audit = finalized.audit;
      entry.finalized = finalized;
      entry.diagnostic.status = finalized.audit
        ? "verified"
        : "final-failed";
      if (!finalized.audit) {
        entry.diagnostic.final ||= {};
        entry.diagnostic.final.failureReasons = finalized.failureReasons;
      }
    }
  }
}

async function runNearMissFinalRescue(games, pool, options) {
  let active = games
    .map((game) => game.finalist)
    .filter((entry) =>
      !entry?.audit
      && !entryUsesPrecommittedEvidenceProtocol(entry)
      && independentActionAuditNearMissRescueEligible(
        entry?.diagnostic,
        {
          maximumLowerBoundGap:
            NEAR_MISS_RESCUE_MAXIMUM_LOWER_BOUND_GAP
        }
      ));
  for (const entry of active) {
    entry.diagnostic.nearMissRescue = {
      version: 1,
      contract: "independent-near-miss-final-rescue-v1",
      maximumInitialLowerBoundGap:
        NEAR_MISS_RESCUE_MAXIMUM_LOWER_BOUND_GAP,
      originalFinal: structuredClone(entry.diagnostic.final),
      usesOriginalEvidenceForAcceptance: false,
      seedBank: NEAR_MISS_RESCUE_BANK,
      checkpoints: [],
      status: "pending"
    };
  }
  for (const targetPairs of [16, 32, 48, 64]) {
    if (active.length === 0) break;
    await runEntryStage(active, pool, {
      bank: NEAR_MISS_RESCUE_BANK,
      targetPairs,
      maximumSteps: options.maximumSteps
    });
    const next = [];
    for (const entry of active) {
      const seedBanksDisjointForRescue =
        seedBanksDisjoint(entry, NEAR_MISS_RESCUE_BANK);
      const reasons = targetPairs === 64
        ? independentActionAuditStageFailureReasons(
          entry.rescueFinalEvidence,
          {
            attemptedPairs: 64,
            minimumTerminalPairs: 32,
            seedBanksDisjoint: seedBanksDisjointForRescue
          }
        )
        : independentActionAuditFutilityReasons(
          entry.rescueFinalEvidence,
          {
            targetPairs: 64,
            minimumTerminalPairs: 32,
            seedBanksDisjoint: seedBanksDisjointForRescue
          }
        );
      appendRescueCheckpoint(entry, targetPairs, reasons);
      if (reasons.length === 0) next.push(entry);
      else {
        entry.diagnostic.nearMissRescue.status = targetPairs === 64
          ? "failed"
          : `futile-after-${targetPairs}`;
        entry.diagnostic.status = targetPairs === 64
          ? "near-miss-rescue-failed"
          : `near-miss-rescue-futile-after-${targetPairs}`;
      }
    }
    active = next;
  }
  for (const entry of active) {
    const finalized = finalizeIndependentActionAuditBatches(
      entry.candidate,
      {
        selectionResults: entry.selectionResults,
        protocolSelectionResults: entry.selectionProtocolResults,
        finalResults: entry.rescueFinalResults,
        protocolFinalResults: entry.rescueFinalProtocolResults,
        computeUsage: summarizeEntryComputeUsage(entry)
      }
    );
    entry.audit = finalized.audit;
    entry.finalized = finalized;
    entry.diagnostic.nearMissRescue.status = finalized.audit
      ? "verified"
      : "failed";
    entry.diagnostic.status = finalized.audit
      ? "verified-near-miss-rescue"
      : "near-miss-rescue-failed";
    if (finalized.audit) {
      entry.diagnostic.final = structuredClone(
        entry.diagnostic.nearMissRescue.final
      );
    } else {
      entry.diagnostic.nearMissRescue.failureReasons =
        finalized.failureReasons;
    }
  }
}

async function runPromisingRunnerUpFallback(games, pool, options) {
  const fallbackGames = [];
  for (const game of games) {
    if (game.finalist?.audit) continue;
    const runnerUp = game.sixteenSurvivors.find((entry) =>
      entry !== game.primaryFinalist
      && entry.diagnostic.status === "racing-eliminated-after-16"
      && Number(entry.selectionEvidence?.terminalEvidence?.lowerBound) > 0);
    if (!runnerUp) continue;
    runnerUp.diagnostic.status = "candidate-pending";
    runnerUp.diagnostic.runnerUpFallback = {
      version: 1,
      contract: "positive-lower-bound-runner-up-fallback-v1",
      reason: "primary-finalist-produced-no-reference",
      status: "selection-pending"
    };
    const selectionPassed = await completeRunnerUpSelection(
      runnerUp,
      pool,
      options
    );
    if (!selectionPassed) continue;
    runnerUp.diagnostic.runnerUpFallback.status =
      "final-confirmation-pending";
    game.finalist = runnerUp;
    fallbackGames.push(game);
  }
  if (fallbackGames.length === 0) return;
  await runFinalConfirmation(fallbackGames, pool, options);
  for (const game of fallbackGames) {
    const entry = game.finalist;
    entry.diagnostic.runnerUpFallback.status = entry.audit
      ? "verified"
      : "failed";
    if (entry.audit) {
      entry.diagnostic.status = "verified-runner-up-fallback";
    }
  }
}

async function completeRunnerUpSelection(entry, pool, options) {
  const checkpoints = entryUsesPrecommittedEvidenceProtocol(entry)
    ? [32]
    : [24, 32];
  for (const targetPairs of checkpoints) {
    await runEntryStage([entry], pool, {
      bank: "selection",
      targetPairs,
      maximumSteps: options.maximumSteps
    });
    const reasons = targetPairs === 32
      ? independentActionAuditStageFailureReasons(
        entry.selectionEvidence,
        {
          attemptedPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection")
        }
      )
      : independentActionAuditFutilityReasons(
        entry.selectionEvidence,
        {
          targetPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: seedBanksDisjoint(entry, "selection")
        }
      );
    appendCheckpoint(entry, targetPairs, "selection", reasons);
    if (reasons.length > 0) {
      entry.diagnostic.status = targetPairs === 32
        ? "runner-up-selection-failed"
        : "runner-up-selection-futile-after-24";
      entry.diagnostic.runnerUpFallback.status = "selection-failed";
      return false;
    }
  }
  return true;
}

async function runEntryStage(entries, pool, options) {
  const plans = entries.flatMap((entry) => {
    const seeds = entrySeeds(entry, options.bank);
    const pairIds = actionEvidenceProtocolPairIds(entry);
    if (pairIds.length === 0) {
      const existing = collectedSeeds(entryResults(entry, options.bank));
      return [{
        entry,
        protocolPairIds: [],
        needed: seeds
          .slice(0, options.targetPairs)
          .filter((seed) => !existing.has(seed))
      }];
    }
    const byPair = new Map(entryProtocolResults(entry, options.bank).map(
      (item) => [
        `${item.continuationId}::${item.opponentId}`,
        collectedSeeds(item.results || [])
      ]
    ));
    return pairIds.map((protocolPairId) => {
      const existing = byPair.get(protocolPairId) || new Set();
      return {
        entry,
        protocolPairIds: [protocolPairId],
        needed: seeds
          .slice(0, options.targetPairs)
          .filter((seed) => !existing.has(seed))
      };
    });
  });
  const seedCount = plans.reduce(
    (sum, plan) => sum + plan.needed.length,
    0
  );
  const preferredChunkSize = actionAuditAdaptiveSeedChunkSize(
    seedCount,
    pool.processCount
  );
  const tasks = [];
  for (const { entry, protocolPairIds, needed } of plans) {
    const chunkPath = (chunk) => path.join(
      entry.root,
      `${seedBatchTaskId(
        entry.candidateId,
        options.bank,
        chunk,
        protocolPairIds
      )}`
        + ".seed-batch.json.gz"
    );
    const chunks = actionAuditSeedTaskChunks(needed, {
      preferredChunkSize,
      legacyChunkAvailable(chunk) {
        return existsSync(chunkPath(chunk));
      },
      singleChunkAvailable(chunk) {
        return existsSync(chunkPath(chunk));
      }
    });
    for (const chunk of chunks) {
      const taskId = seedBatchTaskId(
        entry.candidateId,
        options.bank,
        chunk,
        protocolPairIds
      );
      tasks.push({
        taskId,
        candidateId: entry.candidateId,
        datasetKey: entry.datasetKey,
        informationSetHash:
          entry.candidate?.descriptor?.informationSetHash || null,
        engineFingerprint: entry.candidate?.engineFingerprint || null,
        evidenceProtocolHash: entry.candidate?.descriptor
          ?.evidenceProtocolManifest?.protocolHash || null,
        protocolPairIds,
        candidatePath: entry.candidatePath,
        sourceArchivePath: entry.sourceArchivePath,
        bank: options.bank,
        seeds: chunk,
        maximumSteps: options.maximumSteps,
        outputPath: path.join(
          entry.root,
          `${taskId}.seed-batch.json.gz`
        ),
        entry
      });
    }
  }
  const outputs = await pool.run(tasks, {
    stage: `${options.bank}-${options.targetPairs}`,
    pairedSeeds: tasks.reduce(
      (sum, task) => sum + task.seeds.length,
      0
    )
  });
  const byEntry = new Map();
  for (const output of outputs) {
    const target = byEntry.get(output.task.entry) || [];
    target.push(await readValidatedActionAuditSeedBatchOutput(
      output.task,
      output.outputPath
    ));
    byEntry.set(output.task.entry, target);
  }
  for (const entry of entries) {
    const newBatches = byEntry.get(entry) || [];
    const priorProtocol = entryProtocolResults(entry, options.bank);
    const protocolMerged = mergeIndependentActionAuditProtocolBatches([
      { protocolResults: priorProtocol },
      ...newBatches
    ]);
    const merged = primaryOrLegacyActionAuditResults(
      entry,
      [
        { results: entryResults(entry, options.bank) },
        ...newBatches
      ],
      protocolMerged
    );
    const evidence = actionAuditStageEvidence(
      entry,
      merged,
      protocolMerged
    );
    for (const output of newBatches) {
      accumulateEntryComputeUsage(entry, output.computeUsage);
    }
    if (options.bank === "selection") {
      entry.selectionResults = merged;
      entry.selectionProtocolResults = protocolMerged;
      entry.selectionEvidence = evidence;
    } else if (options.bank === NEAR_MISS_RESCUE_BANK) {
      entry.rescueFinalResults = merged;
      entry.rescueFinalProtocolResults = protocolMerged;
      entry.rescueFinalEvidence = evidence;
    } else {
      entry.finalResults = merged;
      entry.finalProtocolResults = protocolMerged;
      entry.finalEvidence = evidence;
    }
  }
}

function actionEvidenceProtocolPairIds(entry) {
  const manifest = entry?.candidate?.descriptor?.evidenceProtocolManifest;
  if (!validActionEvidenceProtocolManifest(manifest)) return [];
  return manifest.continuationPool.members.flatMap((continuation) =>
    manifest.opponentPool.members.map((opponent) =>
      `${continuation.id}::${opponent.id}`)).sort();
}

function primaryOrLegacyActionAuditResults(entry, batches, protocolResults) {
  const pairIds = actionEvidenceProtocolPairIds(entry);
  if (pairIds.length === 0) {
    return mergeIndependentActionAuditSeedBatches(batches);
  }
  const primary = (protocolResults || []).find((item) =>
    `${item.continuationId}::${item.opponentId}` === pairIds[0]);
  return primary?.results || [];
}

function actionAuditStageEvidence(entry, results, protocolResults) {
  if (actionEvidenceProtocolPairIds(entry).length > 0) {
    return independentActionAuditProtocolMixtureEvidence(
      entry.candidate,
      protocolResults
    );
  }
  return independentActionAuditEvidenceFromBatches(entry.candidate, results);
}

function gameUsesPrecommittedEvidenceProtocol(game) {
  return (game?.entries || []).some(entryUsesPrecommittedEvidenceProtocol);
}

function entryUsesPrecommittedEvidenceProtocol(entry) {
  return validActionEvidenceProtocolManifest(
    entry?.candidate?.descriptor?.evidenceProtocolManifest
  );
}

function accumulateEntryComputeUsage(entry, usage = {}) {
  entry.computeUsage ||= {
    cpuMilliseconds: 0,
    gpuMilliseconds: 0,
    wallMilliseconds: 0,
    seedBatches: 0,
    policyPairSeedEvaluations: 0
  };
  entry.computeUsage.cpuMilliseconds +=
    Math.max(0, Number(usage?.cpuMilliseconds) || 0);
  entry.computeUsage.gpuMilliseconds +=
    Math.max(0, Number(usage?.gpuMilliseconds) || 0);
  entry.computeUsage.wallMilliseconds +=
    Math.max(0, Number(usage?.wallMilliseconds) || 0);
  entry.computeUsage.seedBatches += Math.max(
    0,
    Number(usage?.seedBatches) || (usage ? 1 : 0)
  );
  entry.computeUsage.policyPairSeedEvaluations += Math.max(
    0,
    Number(usage?.pairedSeeds) || 0
  );
}

function summarizeEntryComputeUsage(entry) {
  return {
    ...summarizeActionEvidenceEfficiency({
      validIndependentEvidence: 1,
      cpuMilliseconds: entry?.computeUsage?.cpuMilliseconds,
      gpuMilliseconds: entry?.computeUsage?.gpuMilliseconds,
      wallMilliseconds: entry?.computeUsage?.wallMilliseconds
    }),
    seedBatches: Number(entry?.computeUsage?.seedBatches) || 0,
    policyPairSeedEvaluations:
      Number(entry?.computeUsage?.policyPairSeedEvaluations) || 0,
    logicalPairedSeeds:
      collectedSeeds(entry?.selectionResults).size
      + collectedSeeds(entry?.finalResults).size
      + collectedSeeds(entry?.rescueFinalResults).size,
    pairedSeeds:
      collectedSeeds(entry?.selectionResults).size
      + collectedSeeds(entry?.finalResults).size
      + collectedSeeds(entry?.rescueFinalResults).size
  };
}

export function detachedActionAuditProcessCount(
  prepared = [],
  requestedProcesses = 16
) {
  const candidateCount = (prepared || []).reduce(
    (sum, game) => sum + Math.max(0, Number(game?.entries?.length) || 0),
    0
  );
  return Math.max(
    1,
    Math.min(
      Math.max(1, Math.floor(Number(requestedProcesses) || 1)),
      Math.max(
        1,
        candidateCount * MAXIMUM_CONCURRENT_SEED_TASKS_PER_ENTRY
      )
    )
  );
}

export function detachedActionAuditFineRoleChunkGames(
  requestedProcesses = 16,
  configuredGames = null,
  options = {}
) {
  const configured = Math.floor(Number(configuredGames));
  if (Number.isFinite(configured) && configured > 0) return configured;
  const processes = Math.max(
    1,
    Math.floor(Number(requestedProcesses) || 1)
  );
  const finalistRate = Math.max(
    0.05,
    Math.min(
      1,
      Number(options.finalistRate) || DEFAULT_FINALIST_RATE_PER_GAME
    )
  );
  const saturationGames = Math.max(
    1,
    Math.min(
      MAXIMUM_FINE_ROLE_CHUNK_GAMES,
      Math.ceil(
        processes / (finalistRate * FINAL_CHECKPOINT_TASKS_PER_GAME)
      )
    )
  );
  const hasRemainingEvidenceEstimate =
    options.remainingEvidenceUnits !== undefined
    && options.remainingEvidenceUnits !== null;
  const remainingEvidenceUnits = hasRemainingEvidenceEstimate
    ? Math.max(
      0,
      Math.floor(Number(options.remainingEvidenceUnits) || 0)
    )
    : Number.POSITIVE_INFINITY;
  const completionCap = remainingEvidenceUnits <= 1
    ? 1
    : remainingEvidenceUnits <= 3
      ? 2
      : remainingEvidenceUnits <= 6
        ? 3
        : MAXIMUM_FINE_ROLE_CHUNK_GAMES;
  return Math.max(1, Math.min(saturationGames, completionCap));
}

export function detachedActionAuditPipelineChunks(games = [], options = {}) {
  const normalized = Array.from(games || []);
  const configured = Math.floor(Number(options.microChunkGames));
  const microChunkGames = Math.max(
    1,
    Number.isFinite(configured) && configured > 0
      ? configured
      : PIPELINE_MICRO_CHUNK_GAMES
  );
  const chunks = [];
  for (let offset = 0; offset < normalized.length; offset += microChunkGames) {
    chunks.push(normalized.slice(offset, offset + microChunkGames));
  }
  return chunks;
}

export function actionAuditAdaptiveSeedChunkSize(
  seedCount,
  processCount,
  options = {}
) {
  const seeds = Math.max(0, Math.floor(Number(seedCount) || 0));
  const processes = Math.max(1, Math.floor(Number(processCount) || 1));
  const minimumTasks = Math.max(
    processes,
    Math.floor(
      Number(options.minimumTasks)
        || processes * MINIMUM_QUEUED_TASKS_PER_PROCESS
    )
  );
  for (const chunkSize of [MAXIMUM_SEED_CHUNK_SIZE, 2, 1]) {
    if (Math.ceil(seeds / chunkSize) >= minimumTasks) return chunkSize;
  }
  return 1;
}

export function actionAuditSeedTaskChunks(seeds = [], options = {}) {
  const normalized = Array.from(seeds || [], (seed) => Number(seed) >>> 0);
  const preferredChunkSize = [4, 2, 1].includes(
    Math.floor(Number(options.preferredChunkSize))
  )
    ? Math.floor(Number(options.preferredChunkSize))
    : 1;
  const chunks = [];
  for (
    let offset = 0;
    offset < normalized.length;
    offset += LEGACY_SEED_CHUNK_SIZE
  ) {
    const legacyChunk = normalized.slice(
      offset,
      offset + LEGACY_SEED_CHUNK_SIZE
    );
    if (legacyChunk.length > 1
      && options.legacyChunkAvailable?.(legacyChunk) === true) {
      chunks.push(legacyChunk);
      continue;
    }
    for (let seedOffset = 0; seedOffset < legacyChunk.length;) {
      const singleton = legacyChunk.slice(seedOffset, seedOffset + 1);
      if (options.singleChunkAvailable?.(singleton) === true) {
        chunks.push(singleton);
        seedOffset += 1;
        continue;
      }
      let availableBefore = legacyChunk.length;
      for (let next = seedOffset + 1; next < legacyChunk.length; next += 1) {
        if (options.singleChunkAvailable?.(
          legacyChunk.slice(next, next + 1)
        ) === true) {
          availableBefore = next;
          break;
        }
      }
      const size = Math.max(
        1,
        Math.min(
          preferredChunkSize,
          availableBefore - seedOffset,
          legacyChunk.length - seedOffset
        )
      );
      chunks.push(legacyChunk.slice(seedOffset, seedOffset + size));
      seedOffset += size;
    }
  }
  return chunks;
}

export function markActionAuditGameSkippedTargetSatisfied(game) {
  for (const entry of game?.entries || []) {
    if (entry?.audit) continue;
    entry.diagnostic ||= {};
    entry.diagnostic.status = "skipped-target-satisfied";
    entry.diagnostic.gateReasons = ["certification-role-target-satisfied"];
  }
  return game;
}

export function seedBatchTaskId(candidateId, bank, seeds, protocolPairIds = []) {
  const pairs = Array.from(protocolPairIds || [], String).sort();
  return pairs.length > 0
    ? digest([
      candidateId,
      bank,
      "policy-pairs",
      ...pairs,
      "seeds",
      ...(seeds || [])
    ])
    : digest([candidateId, bank, ...(seeds || [])]);
}

function entrySeeds(entry, bank) {
  if (bank === "selection") return entry.selectionSeeds;
  if (bank === NEAR_MISS_RESCUE_BANK) return entry.rescueFinalSeeds;
  return entry.finalSeeds;
}

function entryResults(entry, bank) {
  if (bank === "selection") return entry.selectionResults;
  if (bank === NEAR_MISS_RESCUE_BANK) {
    return entry.rescueFinalResults;
  }
  return entry.finalResults;
}

function entryProtocolResults(entry, bank) {
  if (bank === "selection") return entry.selectionProtocolResults || [];
  if (bank === NEAR_MISS_RESCUE_BANK) {
    return entry.rescueFinalProtocolResults || [];
  }
  return entry.finalProtocolResults || [];
}

function appendCheckpoint(entry, attemptedPairs, bank, reasons) {
  const results = bank === "selection"
    ? entry.selectionResults
    : entry.finalResults;
  const evidence = bank === "selection"
    ? entry.selectionEvidence
    : entry.finalEvidence;
  const compact = compactIndependentActionAuditStageDiagnostic(
    evidence,
    [...collectedSeeds(results)],
    reasons
  );
  entry.diagnostic.racing.checkpoints.push({
    bank,
    attemptedPairs,
    ...compact
  });
  if (bank === "selection") entry.diagnostic.selection = compact;
  else entry.diagnostic.final = compact;
}

function appendRescueCheckpoint(entry, attemptedPairs, reasons) {
  const compact = compactIndependentActionAuditStageDiagnostic(
    entry.rescueFinalEvidence,
    [...collectedSeeds(entry.rescueFinalResults)],
    reasons
  );
  entry.diagnostic.nearMissRescue.checkpoints.push({
    bank: NEAR_MISS_RESCUE_BANK,
    attemptedPairs,
    ...compact
  });
  entry.diagnostic.nearMissRescue.final = compact;
}

function finalizeGamePlan(game, result) {
  let references = 0;
  let pairedSeedsCompleted = 0;
  const diagnosticCounts = {};
  const failureReasons = {};
  for (const entry of game.entries) {
    pairedSeedsCompleted += collectedSeeds(entry.selectionResults).size;
    pairedSeedsCompleted += collectedSeeds(entry.finalResults).size;
    pairedSeedsCompleted +=
      collectedSeeds(entry.rescueFinalResults).size;
    const step = findRecordedStep(
      result.trajectories,
      entry.candidate.recordedStepLocator
    );
    if (!step) continue;
    entry.diagnostic.computeUsage = summarizeEntryComputeUsage(entry);
    step.actionRankingAuditDiagnostic =
      structuredClone(entry.diagnostic);
    const status = entry.diagnostic.status || "unknown";
    diagnosticCounts[status] = (diagnosticCounts[status] || 0) + 1;
    for (const checkpoint of entry.diagnostic.racing.checkpoints || []) {
      for (const reason of checkpoint.failureReasons || []) {
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      }
    }
    if (!entry.audit) continue;
    const descriptor = entry.candidate.descriptor;
    const structuredV2CompanionsPresent =
      actionRankingAuditHasStructuredV2Companions(entry.audit, {
        informationSetHash: step.informationSetHash,
        engineFingerprint: entry.candidate.engineFingerprint
      });
    step.actionRankingAuditReference = createActionRankingAuditReference({
      audit: entry.audit,
      informationSetHash: step.informationSetHash,
      informationSetHashVersion: 1,
      requireStructuredV2: true,
      engineFingerprint: entry.candidate.engineFingerprint,
      correctIndex: descriptor.recommendedIndex,
      comparedIndex: descriptor.selectedIndex,
      correctActionKey:
        step.legalActionKeys?.[descriptor.recommendedIndex],
      comparedActionKey:
        step.legalActionKeys?.[descriptor.selectedIndex]
    });
    if (step.actionRankingAuditReference) references += 1;
    else {
      if (!structuredV2CompanionsPresent) {
        entry.diagnostic.gateReasons ||= [];
        entry.diagnostic.gateReasons.push(
          "structured-v2-companion-missing"
        );
        failureReasons["structured-v2-companion-missing"] =
          (failureReasons["structured-v2-companion-missing"] || 0) + 1;
      }
      diagnosticCounts["reference-contract-rejected"] =
        (diagnosticCounts["reference-contract-rejected"] || 0) + 1;
    }
  }
  const summary = result.summaries?.[0];
  if (summary) {
    summary.teacherActionAuditAttempts = game.entries.length;
    summary.teacherActionAuditReferences = references;
    summary.teacherActionAuditCandidatesDiscovered = game.entries.length;
    summary.teacherActionAuditCandidatesExpandedTo16 =
      game.entries.filter((entry) =>
        collectedSeeds(entry.selectionResults).size >= 16).length;
    summary.teacherActionAuditCandidatesExpandedTo32 =
      game.entries.filter((entry) =>
        collectedSeeds(entry.selectionResults).size >= 32).length;
    summary.teacherActionAuditFinalCandidates =
      game.entries.filter((entry) =>
        collectedSeeds(entry.finalResults).size > 0).length;
    summary.teacherActionAuditPairedSeedsCompleted =
      pairedSeedsCompleted;
    summary.teacherActionAuditDiagnosticCounts = diagnosticCounts;
    summary.teacherActionAuditFailureReasons = failureReasons;
    summary.teacherActionAuditExecution =
      "global-seed-batch-queue-v1";
  }
  result.pendingActionAudit = null;
  return { references, pairedSeedsCompleted };
}

export async function persistFinalizedEvaluatorBootstrapGame(
  game,
  payload,
  result,
  finalized,
  options = {}
) {
  const nextPayload = payload?.result
    ? { ...payload, result }
    : result;
  const summary = JSON.parse(
    await readFile(game.record.summaryPath, "utf8")
  );
  summary.resultIndex = createEvaluatorBootstrapResultIndex(
    result
  );
  summary.detachedActionAudit = {
    version: 1,
    contract: COORDINATOR_CONTRACT,
    references: finalized.references,
    pairedSeedsCompleted: finalized.pairedSeedsCompleted,
    completedAt: new Date().toISOString()
  };
  const committed = await replaceEvaluatorBootstrapArchiveAndSummary({
    archivePath: game.record.archivePath,
    summaryPath: game.record.summaryPath,
    payload: nextPayload,
    summary,
    afterArchiveReplace: options.afterArchiveReplace
  });
  game.record.resultIndex = committed.summary.resultIndex;
}

function findRecordedStep(trajectories, locator) {
  const trajectory = (trajectories || []).find(
    (item) => item.playerId === locator?.actorId
  );
  if (!trajectory) return null;
  return (trajectory.steps || []).find((step) =>
    step.informationSetHash === locator?.informationSetHash
      && Number(step.selectedIndex) === Number(locator?.selectedIndex))
    || (trajectory.steps || []).find((step) =>
      step.informationSetHash === locator?.informationSetHash)
    || null;
}

function collectedSeeds(serializedResults = []) {
  return new Set((serializedResults || []).flatMap(
    (result) => Array.from(
      result?.samples || result?.simulationSeeds || [],
      (sample) => typeof sample === "object"
        ? Number(sample?.simulationSeed) >>> 0
        : Number(sample) >>> 0
    )
  ));
}

function seedBanksDisjoint(entry, bank) {
  const descriptorSeeds = new Set(
    (entry.candidate.descriptor.occupiedAuditSeeds || [])
      .map((seed) => Number(seed) >>> 0)
  );
  const selection = collectedSeeds(entry.selectionResults);
  const final = collectedSeeds(entry.finalResults);
  const rescue = collectedSeeds(entry.rescueFinalResults);
  const current = bank === "selection"
    ? selection
    : bank === NEAR_MISS_RESCUE_BANK
      ? rescue
      : final;
  for (const seed of current) {
    if (descriptorSeeds.has(seed)) return false;
    if (bank !== "selection" && selection.has(seed)) return false;
    if (bank === NEAR_MISS_RESCUE_BANK && final.has(seed)) return false;
  }
  return true;
}

export async function createAuditPool(options) {
  const maximumProcessCount = Math.max(1, Number(options.processes) || 1);
  const processLimit = () => selfPlayDynamicCapacityLimit(options, maximumProcessCount);
  const initialProcessCount = Math.max(
    1,
    Math.min(
      maximumProcessCount,
      Number(options.initialProcesses) || maximumProcessCount
    )
  );
  const minimumFreeMemoryBytes = Math.max(
    0,
    Number.isFinite(Number(options.minimumFreeMemoryBytes))
      ? Number(options.minimumFreeMemoryBytes)
      : DEFAULT_MINIMUM_FREE_MEMORY_BYTES
  );
  const freeMemory = typeof options.freeMemoryProvider === "function"
    ? options.freeMemoryProvider
    : freemem;
  const childOptions = options.preparedActionAuditWorkerOptions
    ? validatePreparedActionAuditWorkerOptions(
      options.preparedActionAuditWorkerOptions
    )
    : actionAuditWorkerOptions(options);
  const optionsHandoff =
    await createActionAuditOptionsHandoff(childOptions);
  const environment = selfPlayProcessEnvironment(
    maximumProcessCount,
    { ...process.env, ...options.workerEnvironment }
  );
  const slots = [];
  const retiringSlotIndexes = new Set();
  const slotShouldRetire = (slot) =>
    actionAuditSlotRetirementRequested(slot, retiringSlotIndexes);
  const spawnManagedAuditSlot = async (index) => {
    const slot = await spawnAuditSlot(index, optionsHandoff, environment, options.workerPath);
    slot.retireRequested = slotShouldRetire(slot);
    return slot;
  };
  let closed = false;
  try {
    for (let index = 0; index < initialProcessCount; index += 1) {
      if (index >= processLimit()) break;
      // Spawn progressively. An already-created idle worker must never consume
      // the reserve that the scheduler then waits to recover before assigning
      // that same worker a task.
      if (index > 0
        && freeMemory() < minimumFreeMemoryBytes + WORKER_RECYCLE_RSS_BYTES) {
        break;
      }
      const memoryAvailable = await waitForMemoryAvailability(
        (progress) => options.onProgress?.(progress),
        minimumFreeMemoryBytes,
        freeMemory,
        () => index >= processLimit()
      );
      if (!memoryAvailable || index >= processLimit()) break;
      slots.push(await spawnManagedAuditSlot(index));
    }
  } catch (error) {
    await Promise.all(slots.map((slot) => shutdownSlot(slot).catch(() => {})));
    await discardActionAuditOptionsHandoff(optionsHandoff);
    throw error;
  }
  let queue = [];
  const waiters = [];
  const workerLoops = [];
  let scaleTimer = null;
  let scaleChangeInFlight = null;
  let healthyScaleSamples = 0;
  let lastScaleChangeAt = 0;
  let desiredProcessCount = slots.length;
  const scaleIntervalMs = Math.max(
    1_000,
    Number(options.dynamicScaleIntervalMs)
      || DEFAULT_DYNAMIC_SCALE_INTERVAL_MS
  );
  const healthySamplesRequired = Math.max(
    1,
    Number(options.dynamicScaleHealthySamples)
      || DEFAULT_DYNAMIC_SCALE_HEALTHY_SAMPLES
  );
  const workerHeadroomBytes = Math.max(
    256 * 1024 * 1024,
    Number(options.dynamicWorkerHeadroomBytes)
      || DEFAULT_DYNAMIC_WORKER_HEADROOM_BYTES
  );
  const requireObservedWorkerRssForScaleUp =
    options.requireObservedWorkerRssForScaleUp === true;
  const liveSlots = () => slots.filter(Boolean);
  const wakeWorkers = () => {
    while (waiters.length > 0 && (closed
      || queue.length > 0
      || liveSlots().some(slotShouldRetire))) {
      waiters.shift()?.();
    }
  };
  const waitForQueuedTask = async (slot) => {
    while (!closed && !slotShouldRetire(slot)) {
      reconcileCapacity();
      if (slotShouldRetire(slot)) break;
      const item = takePreferredActionAuditTask(
        queue,
        slot.lastCandidateId
      );
      if (item) return item;
      await new Promise((resolve) => waiters.push(resolve));
    }
    return null;
  };
  const reportRequest = (request, extra = {}) => options.onProgress?.({
    stage: request.progress.stage || "seed-batch",
    completedSeedBatches: request.completedCount,
    totalSeedBatches: request.totalTasks,
    pairedSeedsCompleted: request.pairedSeedsCompleted,
    pairedSeedsPlanned: request.pairedSeedsPlanned,
    activeProcesses: liveSlots().filter((slot) => slot.task).length,
    processCount: liveSlots().length,
    desiredProcessCount,
    initialProcessCount,
    maximumProcessCount,
    dynamicMaximumProcessCount: processLimit(),
    workers: liveSlots().map(slot => ({ processId: slot.child.pid,
      taskId: slot.task?.taskId || null, retiring: slotShouldRetire(slot) })),
    pipelineRequests: new Set(
      queue.map((item) => item.request).filter((item) => !item.failed)
    ).size,
    ...extra
  });
  const failRequest = (request, error) => {
    if (request.failed || request.settled) return;
    request.failed = true;
    request.settled = true;
    queue = queue.filter((item) => item.request !== request);
    request.reject(error);
  };
  const completeRequestTask = (request, task, taskResult) => {
    if (request.failed || request.settled) return;
    request.output.push({ task, outputPath: taskResult.outputPath });
    request.pairedSeedsCompleted += task.seeds.length;
    request.completedCount += 1;
    request.remaining -= 1;
    reportRequest(request, {
      lastCompletedTaskId: task.taskId,
      workerRssBytes: Number(taskResult.workerRssBytes) || null
    });
    if (request.remaining === 0) {
      request.settled = true;
      request.resolve(request.output);
    }
  };
  const runWorkerLoop = async (slotIndex) => {
    let slot = slots[slotIndex];
    try {
      while (!closed && !slotShouldRetire(slot)) {
        const item = await waitForQueuedTask(slot);
        if (!item) break;
        const { task, request } = item;
        if (request.failed || request.settled) continue;
        slot.pendingRequest = request;
        const memoryAvailable = await waitForMemoryAvailability(
          (progress) => reportRequest(request, progress),
          minimumFreeMemoryBytes,
          freeMemory,
          () => closed || slotShouldRetire(slot)
        );
        if (!memoryAvailable || closed || slotShouldRetire(slot)) {
          slot.pendingRequest = null;
          if (!closed && !request.failed && !request.settled) {
            queue.unshift(item);
            wakeWorkers();
          }
          break;
        }
        let taskResult = null;
        let lastError = null;
        for (let attempt = 0; attempt <= 2; attempt += 1) {
          try {
            const pendingResult = runSlotTask(slot, task);
            reportRequest(request, { lastAssignedTaskId: task.taskId });
            taskResult = await pendingResult;
            break;
          } catch (error) {
            lastError = error;
            await shutdownSlot(slot).catch(() => {});
            if (attempt >= 2) break;
            slot = await spawnManagedAuditSlot(slotIndex);
            slots[slotIndex] = slot;
          }
        }
        if (!taskResult) {
          slot.pendingRequest = null;
          failRequest(request, lastError);
          if (!closed && !slotShouldRetire(slot)) {
            slot = await spawnManagedAuditSlot(slotIndex);
            slots[slotIndex] = slot;
          }
          if (slotShouldRetire(slot)) break;
          continue;
        }
        slot.lastCandidateId = task.candidateId;
        slot.lastRssBytes = Number(taskResult.workerRssBytes) || 0;
        slot.pendingRequest = null;
        slot.tasksCompleted = (Number(slot.tasksCompleted) || 0) + 1;
        completeRequestTask(request, task, taskResult);
        scheduleScaleCheck();
        if (slot.tasksCompleted >= WORKER_RECYCLE_TASKS
          || Number(taskResult.workerRssBytes) >= WORKER_RECYCLE_RSS_BYTES) {
          await shutdownSlot(slot).catch(() => {});
          if (closed || slotShouldRetire(slot)) break;
          slot = await spawnManagedAuditSlot(slotIndex);
          slots[slotIndex] = slot;
          reportRequest(request, { recycledWorker: slotIndex });
        }
      }
    } finally {
      slot.pendingRequest = null;
      await shutdownSlot(slot).catch(() => {});
      if (slots[slotIndex] === slot) slots[slotIndex] = null;
      retiringSlotIndexes.delete(slotIndex);
      scheduleScaleCheck(0);
    }
  };
  const currentRequest = () => queue.find((item) =>
    !item.request.failed && !item.request.settled)?.request
    || liveSlots().find((slot) =>
      slot.pendingRequest
      && !slot.pendingRequest.failed
      && !slot.pendingRequest.settled)?.pendingRequest
    || null;
  const startWorker = async () => {
    if (liveSlots().length >= processLimit()) return false;
    const slotIndex = slots.findIndex((slot) => slot == null);
    const index = slotIndex >= 0 ? slotIndex : slots.length;
    retiringSlotIndexes.delete(index);
    const slot = await spawnManagedAuditSlot(index);
    if (closed) {
      await shutdownSlot(slot).catch(() => {});
      return false;
    }
    slots[index] = slot;
    workerLoops.push(runWorkerLoop(index));
    const request = currentRequest();
    if (request) {
      reportRequest(request, {
        workerPoolScale: "up",
        scaledWorker: index
      });
    }
    wakeWorkers();
    return true;
  };
  const retireWorkerAfterCurrentTask = (minimum = 1) => {
    const candidates = [...liveSlots()]
      .filter((slot) => !slotShouldRetire(slot))
      .reverse();
    const slot = candidates.find((candidate) =>
      !candidate.task && !candidate.pendingRequest)
      || candidates.find((candidate) => !candidate.task)
      || candidates[0];
    if (!slot || desiredProcessCount <= minimum) return false;
    desiredProcessCount -= 1;
    retiringSlotIndexes.add(slot.index);
    slot.retireRequested = true;
    const request = currentRequest();
    if (request) {
      reportRequest(request, {
        workerPoolScale: "down",
        retiredWorker: slot.index
      });
    }
    wakeWorkers();
    return true;
  };
  function reconcileCapacity() {
    const limit = processLimit();
    while (desiredProcessCount > limit && retireWorkerAfterCurrentTask(0)) {}
    return limit;
  }
  const performScaleCheck = async () => {
    if (closed || scaleChangeInFlight) return;
    const dynamicMaximum = reconcileCapacity();
    if (dynamicMaximum === 0) { healthyScaleSamples = 0; return; }
    const workers = liveSlots();
    const freeMemoryBytes = freeMemory();
    const eligibleWorkers = workers.filter((slot) =>
      !slotShouldRetire(slot));
    const idleWorkers = eligibleWorkers.filter((slot) =>
      !slot.task && !slot.pendingRequest).length;
    if (freeMemoryBytes < minimumFreeMemoryBytes) {
      healthyScaleSamples = 0;
      if (Date.now() - lastScaleChangeAt >= scaleIntervalMs
        && retireWorkerAfterCurrentTask()) {
        lastScaleChangeAt = Date.now();
      }
      return;
    }
    const observedWorkerRssBytes = workers.reduce(
      (maximum, slot) => Math.max(
        maximum,
        Number(slot.lastRssBytes) || 0
      ),
      0
    );
    const effectiveWorkerHeadroomBytes = Math.max(
      workerHeadroomBytes,
      Math.ceil(observedWorkerRssBytes * 1.25)
    );
    const shouldGrow = actionAuditPoolShouldScaleUp({
      currentProcesses: Math.max(desiredProcessCount, workers.length),
      maximumProcesses: dynamicMaximum,
      queuedTasks: queue.length,
      idleProcesses: idleWorkers,
      freeMemoryBytes,
      minimumFreeMemoryBytes,
      workerHeadroomBytes: effectiveWorkerHeadroomBytes,
      workerRssObserved:
        !requireObservedWorkerRssForScaleUp || observedWorkerRssBytes > 0
    });
    healthyScaleSamples = shouldGrow ? healthyScaleSamples + 1 : 0;
    if (!shouldGrow
      || healthyScaleSamples < healthySamplesRequired
      || Date.now() - lastScaleChangeAt < scaleIntervalMs) return;
    healthyScaleSamples = 0;
    desiredProcessCount += 1;
    scaleChangeInFlight = startWorker();
    try {
      const started = await scaleChangeInFlight;
      if (!started) desiredProcessCount -= 1;
      lastScaleChangeAt = Date.now();
    } catch (error) {
      desiredProcessCount = Math.max(0, desiredProcessCount - 1);
      throw error;
    } finally {
      scaleChangeInFlight = null;
    }
  };
  function scheduleScaleCheck(delayMs = scaleIntervalMs) {
    if (closed || scaleTimer) return;
    scaleTimer = setTimeout(() => {
      scaleTimer = null;
      void performScaleCheck()
        .catch((error) => {
          const request = currentRequest();
          if (request) {
            reportRequest(request, {
              workerPoolScale: "error",
              workerPoolScaleError: error?.message || String(error)
            });
          }
        })
        .finally(() => {
          if (!closed && (queue.length > 0
            || typeof options.dynamicProcessLimit === "function"
            || freeMemory() < minimumFreeMemoryBytes
            || liveSlots().length !== desiredProcessCount)) {
            scheduleScaleCheck();
          }
        });
    }, Math.max(0, delayMs));
    scaleTimer.unref?.();
  }
  workerLoops.push(...slots.map((_, index) => runWorkerLoop(index)));
  if (typeof options.dynamicProcessLimit === "function") scheduleScaleCheck();
  return {
    get processCount() {
      return liveSlots().length;
    },
    get desiredProcessCount() {
      return desiredProcessCount;
    },
    async run(tasks = [], progress = {}) {
      if (closed) throw new Error("Detached action-audit pool is closed.");
      if (tasks.length === 0) return [];
      const cached = [];
      const pending = [];
      for (const task of tasks) {
        if (!existsSync(task.outputPath)) {
          pending.push(task);
          continue;
        }
        try {
          await readValidatedActionAuditSeedBatchOutput(
            task,
            task.outputPath
          );
          cached.push({ task, outputPath: task.outputPath });
        } catch {
          await rm(task.outputPath, { force: true }).catch(() => {});
          pending.push(task);
        }
      }
      if (pending.length === 0) return cached;
      return new Promise((resolve, reject) => {
        const request = {
          progress,
          output: [...cached],
          totalTasks: tasks.length,
          completedCount: cached.length,
          pairedSeedsCompleted: cached.reduce(
            (sum, item) => sum + item.task.seeds.length,
            0
          ),
          pairedSeedsPlanned:
            Number(progress.pairedSeeds)
              || tasks.reduce((sum, task) => sum + task.seeds.length, 0),
          remaining: pending.length,
          failed: false,
          settled: false,
          resolve,
          reject
        };
        for (const task of pending) {
          queue.push({
            task,
            request,
            candidateId: task.candidateId
          });
        }
        reportRequest(request);
        wakeWorkers();
        scheduleScaleCheck(0);
      });
    },
    async close(closeOptions = {}) {
      if (closed) return;
      closed = true;
      if (scaleTimer) clearTimeout(scaleTimer);
      scaleTimer = null;
      if (scaleChangeInFlight) {
        await scaleChangeInFlight.catch(() => {});
      }
      const closingError = new Error("Detached action-audit pool closed.");
      if (closeOptions.pause) closingError.code = "AUDIT_POOL_PAUSED";
      for (const request of new Set(queue.map((item) => item.request))) {
        failRequest(request, closingError);
      }
      queue = [];
      wakeWorkers();
      await Promise.allSettled(workerLoops);
      await Promise.all(liveSlots().map((slot) => shutdownSlot(slot)));
      await discardActionAuditOptionsHandoff(optionsHandoff);
    }
  };
}

export async function createDistributedActionAuditPool(options = {}) {
  const localPool = await createAuditPool(options);
  const configuration = remoteActionAuditConfiguration(options);
  if (!configuration) return localPool;
  const remoteOptionsHandoff = await createActionAuditOptionsHandoff(
    actionAuditWorkerOptions(options)
  );
  let remotePool = null;
  try {
    remotePool = await createRemoteActionAuditPool({
      ...options,
      configuration,
      optionsHandoff: remoteOptionsHandoff,
      projectRoot: process.cwd(),
      engineFingerprint: options.engineFingerprint || null,
      onProgress: options.onProgress
    });
  } catch (error) {
    await discardActionAuditOptionsHandoff(remoteOptionsHandoff);
    options.onProgress?.({
      stage: "remote-action-audit-unavailable",
      remoteHost: configuration.host,
      remoteError: error?.message || String(error),
      remoteFallback: "local"
    });
    return localPool;
  }
  let remoteHealthy = true;
  let remoteCredit = 0;
  let closed = false;
  let remoteBacklog = 0;
  let remoteParityVerified = false;
  let remoteParityInFlight = null;
  return {
    get processCount() {
      return localPool.processCount
        + (remoteHealthy ? remotePool.processCount : 0);
    },
    get desiredProcessCount() {
      return localPool.desiredProcessCount
        + (remoteHealthy ? remotePool.desiredProcessCount : 0);
    },
    async run(tasks = [], progress = {}) {
      if (closed) throw new Error("Distributed action-audit pool is closed.");
      if (!remoteHealthy || tasks.length === 0) {
        return localPool.run(tasks, progress);
      }
      if (!remoteParityVerified) {
        remoteParityInFlight ||= verifyRemoteParity(tasks, progress);
        await remoteParityInFlight;
        remoteParityInFlight = null;
        if (!remoteHealthy) return localPool.run(tasks, progress);
      }
      if (remoteBacklog >= Math.max(2, remotePool.processCount * 2)) {
        return localPool.run(tasks, progress);
      }
      const share = remoteActionAuditTaskShare(
        tasks.length,
        localPool.processCount,
        remotePool.maximumProcessCount,
        remoteCredit
      );
      remoteCredit = share.credit;
      const remoteTaskCount = share.remoteTasks;
      if (remoteTaskCount <= 0) return localPool.run(tasks, progress);
      const { remoteTasks, localTasks } = partitionRemoteActionAuditTasks(
        tasks,
        remoteTaskCount
      );
      remoteBacklog += remoteTasks.length;
      const localPromise = localPool.run(localTasks, progress);
      const remotePromise = remotePool.run(remoteTasks, progress)
        .catch(async (error) => {
          remoteHealthy = false;
          options.onProgress?.({
            stage: "remote-action-audit-fallback",
            remoteHost: configuration.host,
            remoteError: error?.message || String(error),
            remoteFallbackTasks: remoteTasks.length
          });
          await remotePool.close().catch(() => {});
          return localPool.run(remoteTasks, progress);
        })
        .finally(() => {
          remoteBacklog = Math.max(0, remoteBacklog - remoteTasks.length);
        });
      const [localOutputs, remoteOutputs] = await Promise.all([
        localPromise,
        remotePromise
      ]);
      return [...localOutputs, ...remoteOutputs];
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        localPool.close(),
        remotePool.close()
      ]);
      await discardActionAuditOptionsHandoff(remoteOptionsHandoff);
    }
  };

  async function verifyRemoteParity(tasks, progress) {
    const { remoteTasks: [sourceTask] } = partitionRemoteActionAuditTasks(
      tasks,
      1
    );
    if (!sourceTask) return;
    const parityId = randomUUID();
    const parityTaskId = `remote-parity-${sourceTask.taskId}`;
    const parityBase = {
      ...sourceTask,
      taskId: parityTaskId,
      seeds: [sourceTask.seeds[0]]
    };
    const localParityTask = {
      ...parityBase,
      outputPath: `${sourceTask.outputPath}.local-parity-${parityId}.json.gz`
    };
    const remoteParityTask = {
      ...parityBase,
      outputPath: `${sourceTask.outputPath}.remote-parity-${parityId}.json.gz`
    };
    try {
      const [[localOutput], [remoteOutput]] = await Promise.all([
        localPool.run([localParityTask], {
          ...progress,
          stage: "remote-parity-local"
        }),
        remotePool.run([remoteParityTask], {
          ...progress,
          stage: "remote-parity-aws"
        })
      ]);
      const [localPayload, remotePayload] = await Promise.all([
        readTrajectoryArchive(localOutput.outputPath),
        readTrajectoryArchive(remoteOutput.outputPath)
      ]);
      if (!isDeepStrictEqual(localPayload, remotePayload)) {
        const error = new Error(
          "Local and remote action-audit raw outcomes failed exact parity."
        );
        error.code = "REMOTE_ACTION_AUDIT_PARITY_MISMATCH";
        throw error;
      }
      remoteParityVerified = true;
      options.onProgress?.({
        stage: "remote-action-audit-parity-verified",
        remoteHost: configuration.host,
        candidateId: sourceTask.candidateId,
        seed: sourceTask.seeds[0]
      });
    } catch (error) {
      remoteHealthy = false;
      options.onProgress?.({
        stage: "remote-action-audit-parity-failed",
        remoteHost: configuration.host,
        remoteError: error?.message || String(error),
        remoteFallback: "local"
      });
      await remotePool.close().catch(() => {});
    } finally {
      await Promise.all([
        rm(localParityTask.outputPath, { force: true }),
        rm(remoteParityTask.outputPath, { force: true })
      ]).catch(() => {});
    }
  }
}

export function partitionRemoteActionAuditTasks(tasks = [], remoteCount = 0) {
  const count = Math.max(
    0,
    Math.min(tasks.length, Math.floor(Number(remoteCount) || 0))
  );
  const ranked = tasks.map((task, index) => ({
    index,
    rank: digest([
      task.candidateId,
      task.bank,
      ...(task.seeds || []),
      task.taskId
    ])
  })).sort((left, right) =>
    left.rank.localeCompare(right.rank) || left.index - right.index);
  const remoteIndexes = new Set(
    ranked.slice(0, count).map((item) => item.index)
  );
  return {
    remoteTasks: tasks.filter((_, index) => remoteIndexes.has(index)),
    localTasks: tasks.filter((_, index) => !remoteIndexes.has(index))
  };
}

export function actionAuditSlotRetirementRequested(
  slot,
  retiringSlotIndexes = null
) {
  if (!slot) return false;
  return slot.retireRequested === true
    || retiringSlotIndexes?.has?.(slot.index) === true;
}

export function actionAuditPoolShouldScaleUp(options = {}) {
  const currentProcesses = Math.max(
    0,
    Math.floor(Number(options.currentProcesses) || 0)
  );
  const maximumProcesses = Math.max(
    1,
    Math.floor(Number(options.maximumProcesses) || 1)
  );
  const queuedTasks = Math.max(
    0,
    Math.floor(Number(options.queuedTasks) || 0)
  );
  const idleProcesses = Math.max(
    0,
    Math.floor(Number(options.idleProcesses) || 0)
  );
  const freeMemoryBytes = Math.max(0, Number(options.freeMemoryBytes) || 0);
  const minimumFreeMemoryBytes = Math.max(
    0,
    Number(options.minimumFreeMemoryBytes) || 0
  );
  const workerHeadroomBytes = Math.max(
    0,
    Number(options.workerHeadroomBytes)
      || DEFAULT_DYNAMIC_WORKER_HEADROOM_BYTES
  );
  return currentProcesses < maximumProcesses
    && queuedTasks > idleProcesses
    && options.workerRssObserved !== false
    && freeMemoryBytes >= minimumFreeMemoryBytes + workerHeadroomBytes;
}

export function takePreferredActionAuditTask(
  pending = [],
  preferredCandidateId = null
) {
  if (!Array.isArray(pending) || pending.length === 0) return null;
  // Precommitted holdouts must not sit behind thousands of old training
  // shards. Preempt only between durable shards; never interrupt a rollout.
  const heldIndex = pending.findIndex(item => (item.task || item).auditRole === 'validation');
  if (heldIndex >= 0) {
    const sameHeld = preferredCandidateId ? pending.findIndex(item => item.candidateId === preferredCandidateId
      && (item.task || item).auditRole === 'validation') : -1;
    return pending.splice(sameHeld >= 0 ? sameHeld : heldIndex, 1)[0];
  }
  const preferredIndex = preferredCandidateId
    ? pending.findIndex((task) => task?.candidateId === preferredCandidateId)
    : -1;
  const index = preferredIndex >= 0 ? preferredIndex : 0;
  return pending.splice(index, 1)[0] || null;
}

function spawnAuditSlot(index, options, environment, workerPath = WORKER_PATH) {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      env: environment,
      execArgv: selfPlayChildExecArgv(),
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      windowsHide: true
    });
    const slot = {
      index,
      child,
      task: null,
      resolve: null,
      reject: null,
      tasksCompleted: 0
    };
    const fail = (error) => {
      if (slot.reject) {
        const rejectTask = slot.reject;
        slot.resolve = null;
        slot.reject = null;
        slot.task = null;
        rejectTask(error);
      } else {
        reject(error);
      }
    };
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      if (code === 0 || child.killed) return;
      fail(new Error(
        `Action-audit worker ${index} exited (${code}, ${signal || "none"}).`
      ));
    });
    child.on("message", (message) => {
      if (message?.type === "ready") {
        resolve(slot);
        return;
      }
      if (message?.type === "audit-seed-batch-complete") {
        const resolveTask = slot.resolve;
        slot.resolve = null;
        slot.reject = null;
        slot.task = null;
        resolveTask?.(message);
        return;
      }
      if (message?.type === "error") {
        const error = new Error(
          message.error?.message || "Action-audit worker failed."
        );
        error.stack = message.error?.stack || error.stack;
        error.code = message.error?.code || null;
        error.task = message.task || slot.task;
        fail(error);
      }
    });
    child.send({ type: "initialize", ...options });
  });
}

export const ACTION_AUDIT_WORKER_OPTIONS_CONTRACT =
  "action-audit-worker-options-v1";

export function actionAuditWorkerOptions(options = {}) {
  const teacherEvaluatorMode =
    options.teacherEvaluatorMode || "certified-neural-ensemble";
  const usesNeuralEvaluation = teacherEvaluatorMode !== "heuristic-only";
  const evidenceProtocolManifest = validActionEvidenceProtocolManifest(
    options.evidenceProtocolManifest
  ) ? structuredClone(options.evidenceProtocolManifest) : null;
  const usesNeuralPolicies = usesNeuralEvaluation
    || evidenceProtocolManifest !== null;
  return {
    contract: ACTION_AUDIT_WORKER_OPTIONS_CONTRACT,
    model: usesNeuralPolicies
      ? serializeNeuralModel(options.model)
      : null,
    league: usesNeuralPolicies
      ? (options.league || []).map(serializeNeuralModel)
      : [],
    teacherEvaluatorModels: usesNeuralEvaluation
      ? (options.teacherEvaluatorModels || []).map(serializeNeuralModel)
      : [],
    teacherEvaluatorMode,
    evidenceProtocolManifest,
    engineFingerprint: options.engineFingerprint || null
  };
}

export function validatePreparedActionAuditWorkerOptions(options = {}) {
  if (options.contract !== ACTION_AUDIT_WORKER_OPTIONS_CONTRACT) {
    throw new Error("Prepared action-audit worker options use an unknown contract.");
  }
  const teacherEvaluatorMode = String(options.teacherEvaluatorMode || "");
  const league = Array.isArray(options.league) ? options.league : null;
  const teacherEvaluatorModels = Array.isArray(options.teacherEvaluatorModels)
    ? options.teacherEvaluatorModels
    : null;
  if (!teacherEvaluatorMode || !league || !teacherEvaluatorModels) {
    throw new Error("Prepared action-audit worker options are incomplete.");
  }
  const protocolEnabled = validActionEvidenceProtocolManifest(
    options.evidenceProtocolManifest
  );
  const checkpoints = teacherEvaluatorMode === "heuristic-only"
    ? protocolEnabled
      ? [options.model, ...league]
      : [...league, ...teacherEvaluatorModels]
    : [options.model, ...league, ...teacherEvaluatorModels];
  if (teacherEvaluatorMode === "heuristic-only"
    && !protocolEnabled
    && options.model !== null) {
    throw new Error("Heuristic-only action-audit options cannot include a model.");
  }
  for (const checkpoint of checkpoints) {
    if (!checkpoint
      || typeof checkpoint !== "object"
      || !checkpoint.weights
      || checkpoint.layers) {
      throw new Error(
        "Prepared action-audit worker options must contain serialized checkpoints."
      );
    }
  }
  return options;
}

function runSlotTask(slot, task) {
  return new Promise((resolve, reject) => {
    slot.task = task;
    slot.resolve = resolve;
    slot.reject = reject;
    slot.child.send({
      type: "run-audit-seed-batch",
      task: serializableActionAuditTask(task)
    }, (error) => {
      if (!error) return;
      slot.task = null;
      slot.resolve = null;
      slot.reject = null;
      reject(error);
    });
  });
}

function shutdownSlot(slot) {
  return new Promise((resolve) => {
    if (!slot?.child || slot.child.killed || !slot.child.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      slot.child.kill();
      resolve();
    }, 5000);
    timer.unref?.();
    slot.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    slot.child.send({ type: "shutdown" });
  });
}

async function waitForMemoryAvailability(
  report,
  minimumFreeMemoryBytes = DEFAULT_MINIMUM_FREE_MEMORY_BYTES,
  freeMemory = freemem,
  shouldCancel = () => false
) {
  let notified = false;
  while (freeMemory() < minimumFreeMemoryBytes) {
    if (shouldCancel()) return false;
    if (!notified) {
      report({
        memoryBackpressured: true,
        freeMemoryBytes: freeMemory(),
        minimumFreeMemoryBytes
      });
      notified = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (shouldCancel()) return false;
  if (notified) {
    report({
      memoryBackpressured: false,
      freeMemoryBytes: freeMemory(),
      minimumFreeMemoryBytes
    });
  }
  return true;
}

function coordinateKey(record) {
  return `worker-${String(record.workerIndex).padStart(3, "0")}`
    + `-game-${String(record.gameIndex).padStart(5, "0")}`;
}

function digest(parts) {
  return createHash("sha256")
    .update(parts.map((part) => String(part)).join("\0"))
    .digest("hex");
}
