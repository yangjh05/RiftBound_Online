import { readFile, readdir, mkdir, appendFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { uptime } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { decklists } from "../src/cards.mjs";
import { resolveTrainingDecks } from "../src/ai/training-decks.mjs";
import { deserializeNeuralModel, serializeNeuralModel as serializeUncheckedModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import { neuralBehaviorHash, neuralArtifactHash } from "../src/ai/neural/evaluator-certification.mjs";
import { attachEvaluatorArchitecture } from "../src/ai/neural/evaluator-architecture.mjs";
import { trainEvaluatorFromAuditEvidence, trainRecurrentPpo, restoreAdamOptimizer,
  createLeafValueRankingAuditAccumulator, accumulateLeafValueRankingAudit, finalizeLeafValueRankingAudit }
  from "../src/ai/neural/trainer.mjs";
import { seededRandom, evaluateNeuralModels } from "../src/ai/neural/selfplay.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { collectAdaptiveSelfPlay } from "./adaptive-selfplay-collection.mjs";
import { pruneCommittedAdaptiveEpochs } from "./adaptive-storage-maintenance.mjs";
import { verifyAdaptiveCheckpointTransfer } from "./adaptive-checkpoint-transfer.mjs";
import { ensureTacticalBaseline,compareWithTacticalBaseline } from "./tactical-baseline-bootstrap.mjs";
import {ensureTacticalPolicyRefresh,readTacticalRefreshProtocol} from './tactical-policy-refresh.mjs';
import { ensureLivePolicyCorrection, readLivePolicyProtocol, commitLivePolicyProtocol } from './live-policy-correction.mjs';
import { readPolicyQUtilityProtocol, commitPolicyQUtilityProtocol, utilityPlan, adaptiveGameRole,
  assertUtilityEvidenceDisjoint, freshUtilityEvidence, utilityAuditRecords } from './policy-q-utility.mjs';
import { evaluateShadowUtility } from './shadow-q-utility.mjs';
import { adaptiveAuditSamplingRole } from './adaptive-audit-role.mjs';
import { loadEvaluatorBootstrap, partitionEvaluatorBootstrapRecords } from "./evaluator-bootstrap.mjs";
import { splitAdaptiveLegacyRecords, assertAdaptiveEvidenceSplit, assertAdaptiveTrainingEntries,
  assertAdaptiveGame, assertAdaptiveCheckpoint, adaptiveFiniteEpochGuard } from "./adaptive-policy-q-evidence.mjs";
import { computeEngineFingerprint, assertTrainingTrajectories } from "./training-safety.mjs";
import { prepareDetachedLeafAuditJobs, runDetachedLeafAuditJobs, applyDetachedLeafEvidence } from "./detached-leaf-audit.mjs";
import { ADAPTIVE_POLICY_Q_CONTRACT, digest, adaptiveWorkerBudget, adaptiveTrainingReadiness, adaptiveEvidenceWindow, frozenMatchPlan,
  frozenMatchDecision, sequentialMatchPlan, boundedMatchPlan, mixedMatchPlan, assertFrozenMatchPlan, selectSavedStateJobs } from "./adaptive-policy-q-contract.mjs";
import { withFileLock } from "./file-lock.mjs";
import { createAuditPool } from "./detached-action-audit-coordinator.mjs";
import { renameWithRetry, renameWithRetrySync } from "./file-replace.mjs";
import { readLiveFileLockOwner } from "./file-lock.mjs";
import { loadLiveGameEvidence, assertLiveGameEvidence, evaluateLiveGameRegressions } from "./live-game-curriculum.mjs";
import { createNeuralSession } from "../src/ai/neural/model.mjs";
import { readFrozenEvaluationGames, decideFrozenEvaluation, verifyFrozenEvaluationResult,
  reserveAdaptiveEvaluation, promotionWriteAction, assertEvaluationRollout, readEvaluationRollout, evaluateFrozenRounds,
  readEvaluationEfficiency, readBoundedEvaluationRollout, commitBoundedEvaluationRollout,
  readMixedEvaluationRollout, commitMixedEvaluationRollout } from "./adaptive-policy-q-evaluation.mjs";
import {SEQUENTIAL_MATCH_CONTRACT,BOUNDED_MATCH_CONTRACT,isSequentialMatchPlan} from './sequential-match-statistics.mjs';
import {MIXED_MATCH_CONTRACT,isMixedMatchPlan} from './mixed-match-schedule.mjs';
import {evaluateMixedNeuralModels} from './mixed-match-evaluation.mjs';
import { readDeckSearchProtocol, commitDeckSearchProtocol, createDeckSearchPlan,
  deckSearchTaskOptions, learnDeckSearch, deckSearchReport, primaryDeckSearchAnchors } from './adaptive-deck-search.mjs';
import { assertLegalTrainingDeck } from '../src/ai/legal-decks.mjs';

const here = fileURLToPath(import.meta.url);
const optional = async file => { try { return await readTrajectoryArchive(file); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const json = async file => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const seed = () => randomBytes(4).readUInt32LE() || 1;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const modelFrom = payload => {
  const checkpoint = payload.candidateCheckpoint || payload.checkpoint || payload;
  assertAdaptiveCheckpoint(checkpoint);
  return deserializeNeuralModel(checkpoint);
};
const serializeNeuralModel = model => {
  const checkpoint = serializeUncheckedModel(model);
  assertAdaptiveCheckpoint(checkpoint);
  return checkpoint;
};

export async function freezeLegacyEvidence(config, previous = null) {
  const bootstrap = await loadEvaluatorBootstrap(config.bootstrapDirectory, config.datasetKey, { readOnly: true });
  const partitions = partitionEvaluatorBootstrapRecords(bootstrap.records,
    { seed: `bootstrap-${config.datasetKey}`, deckIds: config.deckIds, minimumRepresentativeCalibrationGames: 0 });
  const old = await json(path.join(config.bootstrapDirectory, "stage-gates", "policy-q-shadow-split-v1.json"));
  return splitAdaptiveLegacyRecords(partitions.training, { previous, initialSplit: old.split,
    seed: `${config.datasetKey}:fixed-training-validation-v3`, engineFingerprint: config.engineFingerprint });
}

async function* evidenceBatches(entries, fingerprint, role = "training") {
  for (const entry of entries) {
    if (entry.liveGameEvidence) await assertLiveGameEvidence(entry, role, fingerprint);
    const payload = await readTrajectoryArchive(entry.archivePath);
    const result = payload.result || payload;
    if (result.summaries?.length && result.summaries.every(summary => summary.teacherEvaluatorMode === "heuristic-only")) {
      for (const trajectory of result.trajectories || []) trajectory.fixedShadowContinuation = "heuristic-only-v1";
    }
    if (payload.datasetKey && entry.datasetKey && payload.datasetKey !== entry.datasetKey) throw new Error("Evidence lineage mismatch.");
    if (entry.sidecars) for (const file of entry.sidecars) {
      const evidence = await readTrajectoryArchive(file);
      if (evidence.sourceArchivePath !== entry.archivePath) throw new Error("Sidecar source changed.");
      if (createHash("sha256").update(await readFile(entry.archivePath)).digest("hex") !== evidence.sourceHash) {
        throw new Error("Sidecar source contents changed.");
      }
      applyDetachedLeafEvidence(result, evidence);
    }
    assertTrainingTrajectories(result.trajectories, fingerprint);
    yield result.trajectories;
  }
}

// Apply reviewed live-game evidence once at a new run's checkpoint boundary.
// Freeze the exact inputs before training, including across interrupted starts.
// The actor policy is unchanged here; subsequent fresh PPO games update it.
export async function initializeLiveGameEvaluator(config, model, status = async () => {}) {
  if (!config.liveGameCurriculumDirectory) return null;
  const file = path.join(config.directory, "initial-live-game-plan.json.gz");
  const sourceArtifactHash = neuralArtifactHash(model);
  let plan = await optional(file);
  if (!plan) {
    const evidence = await loadLiveGameEvidence(config.liveGameCurriculumDirectory, config.engineFingerprint);
    plan = { contract: "initial-live-game-evaluator-v1", engineFingerprint: config.engineFingerprint,
      sourceArtifactHash, training: evidence.training, validation: evidence.validation };
    await writeTrajectoryArchive(file, plan);
  }
  if (plan.contract !== "initial-live-game-evaluator-v1" || plan.engineFingerprint !== config.engineFingerprint
    || plan.sourceArtifactHash !== sourceArtifactHash) throw new Error("Initial live-game plan changed.");
  for (const entry of plan.validation) await assertLiveGameEvidence(entry, "validation", config.engineFingerprint);
  if (!plan.training.length) return { planHash: digest(plan), status: "no-audited-training-games", training: null };
  const actorHash = neuralBehaviorHash(model);
  await status("initial-live-game-q-training", { trainingGames: plan.training.length, validationGames: plan.validation.length });
  const training = await trainEvaluatorFromAuditEvidence(model,
    () => evidenceBatches(plan.training, config.engineFingerprint), {
      epochs: 1, batchSize: 32, learningRate: 0.0001,
      engineFingerprint: config.engineFingerprint, certificationRole: "training", trainFixedContinuationShadowQ: true,
      onEpoch: metrics => status("initial-live-game-q-training", { metrics }) });
  if (!(training.samples > 0) || !training.history.length || training.history.some(epoch => !Number.isFinite(epoch.loss))
    || neuralBehaviorHash(model) !== actorHash) throw new Error("Initial live-game evaluator update failed its guards.");
  return { planHash: digest(plan), status: "trained", training, sourceArtifactHash,
    candidateArtifactHash: neuralArtifactHash(model), policyWeightsUpdated: false, promotionEligible: false };
}

async function launchEvaluation(requestFile, shouldStop) {
  const directory = path.dirname(requestFile), output = path.join(directory, "result.json.gz");
  const lock = path.join(directory, "evaluation.lock");
  let child = null, childError = null, exited = false;
  if (!existsSync(output) && !await readLiveFileLockOwner(lock)) {
    child = fork(here, ["--evaluate", requestFile], { windowsHide: true,
      execArgv: process.execArgv, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("error", error => { childError = error; exited = true; });
    child.on("exit", code => { exited = true;
      if (code !== 0) childError = new Error(`Frozen evaluation exited ${code}.`); });
  }
  while (!existsSync(output)) {
    if (shouldStop()) {
      // The frozen worker owns its own lock and game files. Let a replacement
      // controller adopt it without keeping this stopped parent alive.
      if (child) { if (child.connected) child.disconnect(); child.unref(); }
      return false;
    }
    if ((!child || exited) && !await readLiveFileLockOwner(lock)) {
      throw childError || new Error("Frozen evaluation stopped before saving a result.");
    }
    await delay(1000);
  }
  return true;
}

export async function runFrozenEvaluation(requestFile) {
  return withFileLock(path.join(path.dirname(requestFile), "evaluation.lock"), async () => {
  // Also protect direct --evaluate restarts: a closed request must never run
  // additional games or overwrite its verified administrative/statistical result.
  if (await optional(path.join(path.dirname(requestFile), 'result.json.gz'))) {
    return (await verifyFrozenEvaluationResult(requestFile)).result;
  }
  const request = await readTrajectoryArchive(requestFile);
  if (request.decks) for (const deck of request.decks) assertLegalTrainingDeck(deck, request.deckPoolId);
  const config = await json(path.resolve(path.dirname(requestFile), "..", "..", "config.json"));
  if (computeEngineFingerprint() !== config.engineFingerprint) throw new Error("Evaluation engine changed.");
  const candidate = modelFrom(await readTrajectoryArchive(request.candidatePath));
  const champion = modelFrom(await readTrajectoryArchive(request.opponentPath));
  try {
    if (neuralArtifactHash(candidate) !== request.plan.candidateHash
      || neuralArtifactHash(champion) !== request.plan.opponentHash) throw new Error("Frozen model changed.");
    const directory = path.join(path.dirname(requestFile), "games");
    await mkdir(directory, { recursive: true });
    const summaries = await readFrozenEvaluationGames(requestFile, request);
    const failed = summaries.some(s => s && (s.invalid || !s.completed || s.adjudicated));
    if (failed) {
      await writeTrajectoryArchive(path.join(path.dirname(requestFile), "result.json.gz"),
        { plan: request.plan, decision: decideFrozenEvaluation(request, summaries), summaryDigest: digest(summaries) });
      return;
    }
    const sequential = isSequentialMatchPlan(request.plan);
    let latestSequentialDecision = sequential ? decideFrozenEvaluation(request, summaries) : null;
    // A bounded engine evaluation call finishes one full deck rotation.
    // Existing summaries are reused with their original identities and seeds.
    // No engine/action or on-policy training fingerprint needs to change.
    const {summaries: committedSummaries, decision} = await evaluateFrozenRounds(request, summaries,
    ({targetGames, resumedSummaries}) => {
    const evaluateModels = isMixedMatchPlan(request.plan) ? evaluateMixedNeuralModels : evaluateNeuralModels;
    const evaluation = evaluateModels(candidate, champion,
      request.decks || resolveTrainingDecks(decklists, "origins-era", request.plan.deckIds), {
        plan: request.plan,
        games: targetGames, seed: request.plan.seed, maxActions: 2400,
        evaluationMode: request.plan.evaluationMode, greedy: true, temperature: 0.05,
        resumedSummaries,
        onGameComplete: ({ game, summary, resumed }) => {
          const file = path.join(directory, `${game - 1}.json`);
          if (existsSync(file) && !resumed) throw new Error("Existing frozen game was not safely reusable.");
          if (!existsSync(file)) {
            summary.evaluationRequestHash = digest(request);
            writeFileSync(`${file}.tmp`, JSON.stringify(summary)); renameWithRetrySync(`${file}.tmp`, file);
          }
          if (resumed && game !== request.plan.blocks * 8) return;
          const progressFile = path.join(path.dirname(requestFile), "progress.json");
          writeFileSync(`${progressFile}.tmp`, JSON.stringify({ game,
            games: request.plan.blocks * 8, candidateHash: request.plan.candidateHash,
            ...(sequential ? {purpose: request.purpose, decision: latestSequentialDecision} : {}), at: new Date().toISOString() }));
          renameWithRetrySync(`${progressFile}.tmp`, progressFile);
        }
      });
    return evaluation.summaries;
    }, async ({summaries: roundSummaries, decision: roundDecision}) => {
    if (sequential) {
      latestSequentialDecision = roundDecision;
      const progressFile = path.join(path.dirname(requestFile), 'progress.json');
      await writeFile(`${progressFile}.tmp`, JSON.stringify({game: roundSummaries.length,
        games: request.plan.blocks * 8, candidateHash: request.plan.candidateHash, purpose: request.purpose,
        decision: roundDecision, at: new Date().toISOString()}));
      await renameWithRetry(`${progressFile}.tmp`, progressFile);
    }
    });
    await writeTrajectoryArchive(path.join(path.dirname(requestFile), "result.json.gz"),
      { plan: request.plan, decision, summaryDigest: digest(committedSummaries) });
  } finally { disposeNeuralModel(candidate); disposeNeuralModel(champion); }
  }, { timeoutMs: 1000 });
}

export async function runAdaptiveTraining(config) {
  if (config.contract !== ADAPTIVE_POLICY_Q_CONTRACT || config.maximumWorkers !== 16) throw new Error("Unsupported adaptive run contract.");
  if (computeEngineFingerprint() !== config.engineFingerprint) throw new Error("Adaptive engine fingerprint changed; review before resuming.");
  const transferredEvidence = await verifyAdaptiveCheckpointTransfer(config);
  const root = path.resolve(config.directory);
  await mkdir(root, { recursive: true });
  return withFileLock(path.join(root, "controller.lock"), async () => {
    let statusQueue = Promise.resolve();
    const status = (stage, detail = {}) => {
      const value = { contract: config.contract, pid: process.pid, stage, at: new Date().toISOString(), ...detail };
      statusQueue = statusQueue.then(async () => {
        await writeTrajectoryArchive(path.join(root, "status.json.gz"), value);
        const statusTemporary = path.join(root, `status.json.tmp-${process.pid}`);
        await writeFile(statusTemporary, JSON.stringify(value, null, 2));
        await renameWithRetry(statusTemporary, path.join(root, "status.json"));
        await appendFile(path.join(root, "events.jsonl"), `${JSON.stringify(value)}\n`);
      });
      return statusQueue;
    };
    const exitedLegacyPids = new Set();
    let legacyDrainComplete = false;
    const legacyAlive = pid => {
      // PID numbers can be reused after a reboot. Such processes never own
      // this run's legacy games and must not block a resumed controller.
      if (config.legacyBootTimeMs && Math.abs(Date.now() - uptime() * 1000 - config.legacyBootTimeMs) > 60000) return false;
      if (exitedLegacyPids.has(pid)) return false;
      if (alive(pid)) return true;
      exitedLegacyPids.add(pid); return false;
    };
    const budget = () => {
      // Independent old evaluations / explicit live-game audits can outlive a
      // checkpoint transfer. Reserve their slots until those processes exit.
      const external = (config.externalWorkerPids || []).filter(legacyAlive).length;
      if (legacyDrainComplete) return adaptiveWorkerBudget(external, config.maximumWorkers);
      let legacy = (config.legacyWorkerPids || []).filter(legacyAlive).length;
      if ((config.legacyCoordinatorPids || []).some(legacyAlive)) {
        try {
          const progressPath = path.resolve(config.bootstrapDirectory, "..", "..", "progress", "latest.json");
          const progress = JSON.parse(readFileSync(progressPath, "utf8"));
          // Include replacement children too if a legacy worker recovered.
          legacy = Math.max(legacy, progress.workerPool?.active?.length || 0);
        } catch { legacy = Math.max(legacy, 16); }
      }
      return adaptiveWorkerBudget(legacy + external, config.maximumWorkers);
    };
    const waitCapacity = async kind => {
      while (!budget()[kind]) {
        if (existsSync(path.join(root, "stop.request.json"))) { stopping = true; return 0; }
        await status("legacy-games-draining", { budget: budget() }); await delay(15000);
      }
      return budget()[kind];
    };
    const statePath = path.join(root, "state.json.gz");
    let state = await optional(statePath);
    if (!state) {
      state = { contract: config.contract, configHash: digest(config), iteration: 0,
        learnerPath: path.resolve(config.learnerPath), championPath: path.resolve(config.championPath),
        evaluationOrdinal: config.checkpointTransfer?.evaluationOrdinal || 0,
        evaluationQueue: [], freshEvidence: [], completedAudits: [],
        legacyDrainImported: Boolean(transferredEvidence),
        legacy: transferredEvidence || await freezeLegacyEvidence(config) };
      await writeTrajectoryArchive(statePath, state);
    } else if (state.configHash !== digest(config)) throw new Error("Immutable adaptive configuration changed.");
    const rollout = await readEvaluationRollout(root);
    commitBoundedEvaluationRollout(state, await readBoundedEvaluationRollout(root));
    const refreshProtocol=await readTacticalRefreshProtocol(root);
    commitLivePolicyProtocol(state, await readLivePolicyProtocol(root));
    const utilityProtocol = await readPolicyQUtilityProtocol(root);
    commitPolicyQUtilityProtocol(state, utilityProtocol);
    const deckSearchProtocol = await readDeckSearchProtocol(root);
    commitDeckSearchProtocol(state, deckSearchProtocol);
    commitMixedEvaluationRollout(state, await readMixedEvaluationRollout(root));
    if(state.tacticalRefreshProtocolHash && !refreshProtocol) throw new Error('Tactical refresh protocol removed.');
    if(refreshProtocol){
      if(state.tacticalRefreshProtocolHash && state.tacticalRefreshProtocolHash!==digest(refreshProtocol)) throw new Error('Active tactical refresh protocol changed.');
      state.tacticalRefreshProtocolHash=digest(refreshProtocol);
    }
    const efficiencyProtocol=await readEvaluationEfficiency(root);
    if(state.evaluationEfficiencyHash && !efficiencyProtocol) throw new Error('Evaluation efficiency protocol removed.');
    if(efficiencyProtocol){
      if(state.evaluationEfficiencyHash && state.evaluationEfficiencyHash!==digest(efficiencyProtocol)) throw new Error('Active evaluation efficiency rollout changed.');
      state.evaluationEfficiencyHash=digest(efficiencyProtocol);
    }
    if (rollout) {
      assertEvaluationRollout(rollout);
      const baselineHash = createHash('sha256').update(await readFile(rollout.growthBaselinePath)).digest('hex');
      if (baselineHash !== rollout.growthBaselineSha256) throw new Error('Frozen growth baseline changed.');
      if (state.evaluationProtocolHash && state.evaluationProtocolHash !== digest(rollout)) throw new Error('Active evaluation rollout changed.');
      state.evaluationProtocolHash = digest(rollout);
      await writeTrajectoryArchive(statePath, state);
    }
    assertAdaptiveEvidenceSplit(state.legacy);
    legacyDrainComplete = state.legacyDrainImported === true;
    // Validate the committed history too: two disjoint lists today do not
    // prove that a held-out game was never used by an earlier update.
    if (existsSync(path.join(root, "iterations"))) for (const name of await readdir(path.join(root, "iterations"))) {
      const plan = await optional(path.join(root, "iterations", name, "plan.json.gz"));
      if (plan) assertAdaptiveTrainingEntries(plan.qEvidence, state.legacy);
    }
    // All controller writes are serialized: audit/evaluation callbacks cannot
    // overwrite a newer learner pointer with an older state snapshot.
    let saveQueue = Promise.resolve();
    const save = () => {
      const snapshot = structuredClone(state);
      saveQueue = saveQueue.then(() => writeTrajectoryArchive(statePath, snapshot));
      return saveQueue;
    };
    if (state.evaluationQueueContract !== "latest-pending-candidate-v1") {
      const started = [];
      for (const file of state.evaluationQueue) {
        const directory = path.dirname(file);
        if (existsSync(path.join(directory, "progress.json")) || existsSync(path.join(directory, "result.json.gz"))
          || await readLiveFileLockOwner(path.join(directory, "evaluation.lock"))) started.push(file);
        else {
          (state.supersededEvaluations ||= []).push({ requestFile: file, reason: "superseded-before-start",
            at: new Date().toISOString() });
        }
      }
      state.evaluationQueue = started;
      state.pendingEvaluationCandidate = state.iteration > 0 ? state.learnerPath : null;
      state.evaluationQueueContract = "latest-pending-candidate-v1";
      await save();
    }
    const freezePendingEvaluation = async () => {
      const protocol = await readEvaluationRollout(root);
      if (protocol) {
        assertEvaluationRollout(protocol);
        const hash = createHash('sha256').update(await readFile(protocol.growthBaselinePath)).digest('hex');
        if (hash !== protocol.growthBaselineSha256) throw new Error('Frozen growth baseline changed.');
        if (state.evaluationProtocolHash && state.evaluationProtocolHash !== digest(protocol)) throw new Error('Active evaluation rollout changed.');
        state.evaluationProtocolHash = digest(protocol);
      }
      const efficiency=await readEvaluationEfficiency(root);
      if(state.evaluationEfficiencyHash && !efficiency) throw new Error('Evaluation efficiency protocol removed.');
      if(efficiency){
        if(state.evaluationEfficiencyHash && state.evaluationEfficiencyHash!==digest(efficiency)) throw new Error('Active evaluation efficiency rollout changed.');
        state.evaluationEfficiencyHash=digest(efficiency);
      }
      const bounded = await readBoundedEvaluationRollout(root);
      commitBoundedEvaluationRollout(state, bounded);
      const mixed = await readMixedEvaluationRollout(root);
      commitMixedEvaluationRollout(state, mixed);
      const reservation = reserveAdaptiveEvaluation(state, seed(), protocol,efficiency,bounded,mixed);
      if (!reservation) return;
      await save();
      const candidate = modelFrom(await readTrajectoryArchive(reservation.candidatePath));
      const incumbentPath = reservation.incumbentPath;
      const champion = modelFrom(incumbentPath.endsWith(".gz")
        ? await readTrajectoryArchive(incumbentPath) : await json(incumbentPath));
      try {
        const directory = path.join(root, "evaluations", String(reservation.ordinal).padStart(6, "0"));
        await mkdir(directory, { recursive: true });
        const opponentPath = path.join(directory, "opponent.json.gz");
        const requestFile = path.join(directory, "request.json.gz");
        const existing = await optional(requestFile);
        if (existing) {
          assertFrozenMatchPlan(existing.plan);
          if (existing.candidatePath !== reservation.candidatePath || existing.incumbentPath !== incumbentPath
            || existing.plan.ordinal !== reservation.ordinal || existing.plan.seed !== (reservation.seed || 1)
            || existing.plan.candidateHash !== neuralArtifactHash(candidate)
            || existing.plan.opponentHash !== neuralArtifactHash(champion)
            || (reservation.protocol && (existing.purpose !== reservation.purpose
              || existing.protocolHash !== digest(reservation.protocol)
              || existing.plan.contract !== (reservation.mixed ? MIXED_MATCH_CONTRACT : reservation.bounded ? BOUNDED_MATCH_CONTRACT : SEQUENTIAL_MATCH_CONTRACT)))
            || (reservation.bounded && (existing.boundedProtocolHash !== digest(reservation.bounded)
              || existing.plan.purpose !== reservation.purpose))
            || (reservation.mixed && (existing.mixedProtocolHash !== digest(reservation.mixed)
              || digest(existing.plan.deckIds) !== digest(reservation.mixed.deckIds)))
            || digest(existing.plan.futilityPolicy || null)!==digest(reservation.efficiency?.futilityPolicy || null)) throw new Error("Reserved frozen evaluation changed.");
        } else {
          await writeTrajectoryArchive(opponentPath, { checkpoint: serializeNeuralModel(champion) });
          const factory = reservation.mixed ? mixedMatchPlan : reservation.bounded ? boundedMatchPlan : reservation.protocol ? sequentialMatchPlan : frozenMatchPlan;
          const maximumBlocks = reservation.protocol
            ? (reservation.purpose === 'tactical-baseline-progress' ? reservation.protocol.growthMaximumBlocks : reservation.protocol.maximumBlocks)
            : config.evaluationBlocks || 128;
          let evaluationDecks = deckSearchProtocol && state.iteration > deckSearchProtocol.afterIteration
            ? primaryDeckSearchAnchors(deckSearchProtocol, resolveTrainingDecks(decklists, "origins-era", config.deckIds)) : null;
          if (reservation.mixed) {
            evaluationDecks = reservation.mixed.deckIds.map(id => deckSearchProtocol?.anchors.find(deck => deck.id === id));
            if (evaluationDecks.some(deck=>!deck) || new Set(evaluationDecks.map(deck=>deck.legend.cardNumber)).size !== 5) {
              throw new Error('Mixed evaluation requires frozen legal decks covering all five legends.');
            }
            for (const deck of evaluationDecks) assertLegalTrainingDeck(deck,deckSearchProtocol.poolId);
          }
          const plan = factory({ candidateHash: neuralArtifactHash(candidate), opponentHash: neuralArtifactHash(champion),
            ordinal: reservation.ordinal, deckIds: evaluationDecks?.map(deck => deck.id) || config.deckIds, maximumBlocks,
            randomSeed: reservation.seed,...(reservation.bounded ? {purpose:reservation.purpose} : {}),
            ...(reservation.efficiency ? {futilityPolicy:reservation.efficiency.futilityPolicy} : {}) });
          await writeTrajectoryArchive(requestFile, { candidatePath: reservation.candidatePath, opponentPath, incumbentPath, plan,
            ...(evaluationDecks ? { decks: evaluationDecks, deckPoolId: deckSearchProtocol.poolId } : {}),
            ...(reservation.protocol ? {purpose: reservation.purpose, protocolHash: digest(reservation.protocol)} : {}),
            ...(reservation.bounded ? {boundedProtocolHash:digest(reservation.bounded)} : {}),
            ...(reservation.mixed ? {mixedProtocolHash:digest(reservation.mixed)} : {}) });
        }
        if (!state.evaluationQueue.includes(requestFile)) state.evaluationQueue.push(requestFile);
        state.evaluationReservation = null;
        await save();
      } finally { disposeNeuralModel(candidate); disposeNeuralModel(champion); }
    };
    let stopping = false, backgroundError = null;
    let auditProgressQueue = Promise.resolve(), lastAuditProgressAt = 0;
    const reportAuditPool = progress => {
      const now = Date.now();
      if (!progress.workerPoolScale && now - lastAuditProgressAt < 5000) return;
      lastAuditProgressAt = now;
      const snapshot = { ...progress, budget: budget(), at: new Date(now).toISOString() };
      auditProgressQueue = auditProgressQueue.then(async () => {
        const file = path.join(root, "audit-progress.json");
        const temporary = `${file}.tmp-${process.pid}`;
        await writeFile(temporary, JSON.stringify(snapshot, null, 2));
        await renameWithRetry(temporary, file);
      }).catch(error => { backgroundError = error; stopping = true; });
    };
    const auditPump = async () => {
      let pool = null;
      const active = new Map();
      try {
      while (!stopping) {
        const capacity = budget().audit;
        const completed = new Set(state.completedAudits);
        const jobs = [];
        for (const record of state.freshEvidence) {
          if (record.usableAuditCount == null && record.sidecars?.length) {
            record.usableAuditCount = 0;
            for (const file of record.sidecars) if ((await readTrajectoryArchive(file)).reference) record.usableAuditCount++;
          }
          if (record.bankScanned) continue;
          const prepared = await prepareDetachedLeafAuditJobs(record, {
            directory: path.join(root, "state-bank"), engineFingerprint: config.engineFingerprint,
            continuationHash: "heuristic-only-v1" });
          record.auditPlans = prepared.map(job => path.join(job.plan.root, "plan.json.gz"));
          record.bankScanned = true;
        }
        if (capacity) for (const record of utilityAuditRecords(state.freshEvidence)) for (const file of record.auditPlans || []) {
          if (jobs.length >= 32) break;
          const expectedId = path.basename(path.dirname(file));
          if (completed.has(expectedId) || active.has(expectedId)) continue;
          const plan = await readTrajectoryArchive(file);
          if (plan.candidateId !== expectedId) throw new Error("Audit plan path identity changed.");
          if (completed.has(plan.candidateId) || active.has(plan.candidateId)) continue;
          const payload = await readTrajectoryArchive(plan.candidatePath);
          jobs.push({ plan, snapshot: payload.candidate, role: record.role || 'training' });
        }
        const room = Math.max(0, 8 - active.size);
        const activeHeld = [...active.values()].filter(work => work.auditRole === 'validation').length;
        const heldJobs = selectSavedStateJobs(jobs.filter(job => job.role === 'validation'), Math.min(Math.max(0, 2 - activeHeld), room));
        // Reserve request slots, not idle CPU workers: the six existing worker
        // processes keep consuming training shards until a holdout arrives.
        const trainingRoom = utilityProtocol ? Math.max(0, 6 - (active.size - activeHeld)) : room;
        const chosen = [...heldJobs, ...selectSavedStateJobs(jobs.filter(job => job.role !== 'validation'),
          Math.min(trainingRoom, room - heldJobs.length))];
        if (chosen.length) {
          pool ||= await createAuditPool({ processes: 6, initialProcesses: Math.min(2, capacity),
            dynamicProcessLimit: () => budget().audit, onProgress: reportAuditPool,
            engineFingerprint: config.engineFingerprint, teacherEvaluatorMode: "heuristic-only",
            minimumFreeMemoryBytes: 4 * 1024 ** 3 });
          for (const job of chosen) {
          const work = runDetachedLeafAuditJobs([job], { pool, processes: capacity, engineFingerprint: config.engineFingerprint,
            auditRole: job.role,
            shouldStop: () => stopping,
            teacherEvaluatorMode: "heuristic-only", minimumFreeMemoryBytes: 4 * 1024 ** 3,
            onProgress: checkpoint => { void appendFile(path.join(root, "audit-events.jsonl"),
              `${JSON.stringify({ candidateId: checkpoint.candidateId, completedStage: checkpoint.completedStage,
                outcome: checkpoint.outcome, at: checkpoint.at })}\n`).catch(error => { backgroundError = error; stopping = true; }); } }).then(async ([evidence]) => {
            if (!evidence?.finished) return;
            const record = state.freshEvidence.find(entry => entry.archivePath === job.plan.sourceArchivePath);
            const file = path.join(job.plan.root, "evidence.json.gz");
            if (!(record.sidecars ||= []).includes(file)) {
              record.sidecars.push(file);
              record.usableAuditCount = (record.usableAuditCount || 0) + (evidence.reference ? 1 : 0);
            }
            record.auditCompletedAt = Date.now();
            if (!state.completedAudits.includes(job.plan.candidateId)) state.completedAudits.push(job.plan.candidateId);
            await save();
          }).catch(error => { backgroundError = error; stopping = true; })
            .finally(() => active.delete(job.plan.candidateId));
          work.auditRole = job.role;
          active.set(job.plan.candidateId, work);
          }
          await save();
        }
        await Promise.race([delay(10000), ...active.values()]);
      }
      } finally {
        if (pool) await pool.close({ pause: true });
        await Promise.all(active.values());
      }
    };
    const evaluationPump = async () => {
      while (!stopping) {
        if (!state.evaluationQueue.length && budget().evaluation) await freezePendingEvaluation();
        if (stopping) break;
        const requestFile = state.evaluationQueue[0];
        if (!requestFile || !budget().evaluation) { await delay(10000); continue; }
        const outputPath = path.join(path.dirname(requestFile), "result.json.gz");
        if (!await optional(outputPath)) {
          await status("frozen-evaluation-running", { requestFile, budget: budget() });
          if (!await launchEvaluation(requestFile, () => stopping)) break;
        }
        const { result, request } = await verifyFrozenEvaluationResult(requestFile);
        // A stale opponent comparison cannot replace a newer champion.
        if (result.decision.promoted && request.incumbentPath === state.championPath) {
          const payload = await readTrajectoryArchive(request.candidatePath);
          const check = modelFrom(payload);
          const unchanged = neuralArtifactHash(check) === request.plan.candidateHash;
          disposeNeuralModel(check);
          if (!unchanged) throw new Error("Promoted candidate changed after evaluation.");
          if (config.deployedChampionPath) {
            const current = modelFrom(await json(config.deployedChampionPath));
            const action = promotionWriteAction(neuralArtifactHash(current), request.plan);
            disposeNeuralModel(current);
            if (action === "write") {
              const temporary = `${config.deployedChampionPath}.adaptive-${process.pid}.tmp`;
              await writeFile(temporary, JSON.stringify(payload.checkpoint));
              await renameWithRetry(temporary, config.deployedChampionPath);
            }
          }
          state.championPath = request.candidatePath;
          await writeTrajectoryArchive(path.join(root, "champion.json.gz"), payload);
          await status("champion-promoted", { decision: result.decision, candidatePath: request.candidatePath });
        }
        if (request.purpose === 'tactical-baseline-progress') {
          state.lastGrowthEvaluation = {...result.decision, candidatePath: request.candidatePath};
        } else state.lastEvaluation = { ...result.decision, candidatePath: request.candidatePath };
        state.evaluationQueue.shift();
        await save();
        await status("frozen-evaluation-completed", { requestFile, decision: result.decision,
          pendingEvaluations: state.evaluationQueue.length });
      }
    };
    const background = [auditPump(), evaluationPump()].map(p => p.catch(error => { backgroundError = error; stopping = true; }));
    const originalDecks = resolveTrainingDecks(decklists, "origins-era", config.deckIds);
    const decks = deckSearchProtocol ? primaryDeckSearchAnchors(deckSearchProtocol, originalDecks) : originalDecks;
    const curriculumConfig = deckSearchProtocol ? { ...config, deckIds: decks.map(deck => deck.id),
      deckSearchPoolId: deckSearchProtocol.poolId } : config;
    try {
      if (!await waitCapacity("trainer")) return;
      // Train the existing training-only evidence immediately, without waiting
      // for a rare-cell precision quota or opening protected partitions.
      const initialQ = path.join(root, "initial-q.json.gz");
      if (transferredEvidence && !await optional(initialQ)) {
        const source = modelFrom(await readTrajectoryArchive(state.learnerPath));
        source.metadata = { ...source.metadata, experimentalLearner: true,
          evaluatorCertification: null, checkpointTransfer: config.checkpointTransfer,
          engineFingerprint: config.engineFingerprint };
        const liveGameInitialization = await initializeLiveGameEvaluator(config, source, status);
        await writeTrajectoryArchive(initialQ, { checkpoint: serializeNeuralModel(source),
          training: null, transferredWeights: true, promotionEligible: false,
          sourceSplitHash: transferredEvidence.sourceSplitHash, liveGameInitialization });
        disposeNeuralModel(source);
        await status("checkpoint-transferred-new-action-set", {
          sourceRunDirectory: config.checkpointTransfer.sourceRunDirectory,
          oldTrajectoriesRelabeled: false, validationStatus: transferredEvidence.validationStatus });
      }
      if (!await optional(initialQ)) {
        const source = modelFrom(await json(state.learnerPath));
        attachEvaluatorArchitecture(source, "structured-set-v2-128", { seed: 20260914 });
        await status("initial-q-training", { trainingGames: state.legacy.training.length,
          validationGames: state.legacy.validation.length, budget: budget() });
        const training = await trainEvaluatorFromAuditEvidence(source,
          () => evidenceBatches(adaptiveEvidenceWindow(state.legacy.training, 1, 64), config.engineFingerprint), {
            epochs: 3, batchSize: 32, learningRate: 0.0001,
            engineFingerprint: config.engineFingerprint, certificationRole: "training", trainFixedContinuationShadowQ: true,
            onEpoch: metrics => status("initial-q-training", { metrics }) });
        if (!adaptiveTrainingReadiness({ games: state.legacy.training.length, samples: training.samples }).ready
          || training.history.some(epoch => !Number.isFinite(epoch.loss))) {
          throw new Error("Initial Q update did not produce sufficient finite training samples.");
        }
        await writeTrajectoryArchive(initialQ, { checkpoint: serializeNeuralModel(source), training,
          promotionEligible: false, sourceSplitHash: state.legacy.sourceSplitHash });
        disposeNeuralModel(source);
      }
      const baselinePath = await ensureTacticalBaseline(config,initialQ,decks,status);
      while (!stopping && !existsSync(path.join(root, "stop.request.json"))) {
        if (backgroundError) throw backgroundError;
        if (!state.legacyDrainImported && !(config.legacyCoordinatorPids || []).some(legacyAlive)) {
          state.legacy = await freezeLegacyEvidence(config, state.legacy);
          state.legacyDrainImported = true;
          legacyDrainComplete = true;
          await save();
        }
        const iteration = state.iteration + 1;
        const directory = path.join(root, "iterations", String(iteration).padStart(6, "0"));
        await mkdir(path.join(directory, "games"), { recursive: true });
        let plan = await optional(path.join(directory, "plan.json.gz"));
        if (!plan) {
          const refreshed = await ensureTacticalPolicyRefresh(curriculumConfig,state.iteration === 0 ? baselinePath : state.learnerPath,
            iteration,decks,status,state.tacticalRefreshProtocolHash, {
              processes: await waitCapacity("selfplay"), dynamicProcessLimit: () => budget().selfplay
            });
          const input = await ensureLivePolicyCorrection(curriculumConfig, refreshed, iteration, decks, status,
            state.livePolicyProtocolHash, { processes: await waitCapacity('selfplay'),
              dynamicProcessLimit: () => budget().selfplay,
              utilityProtocol, freshEvidence: state.freshEvidence,
              shouldStop: () => stopping || existsSync(path.join(root, 'stop.request.json')) });
          if (stopping || existsSync(path.join(root, 'stop.request.json'))) break;
          const source = modelFrom(await readTrajectoryArchive(input));
          const liveGames = await loadLiveGameEvidence(config.liveGameCurriculumDirectory, config.engineFingerprint, { iteration });
          const fresh = freshUtilityEvidence(state.freshEvidence);
          plan = { iteration, sourcePath: input, sourceBehaviorHash: neuralBehaviorHash(source),
            gameRandomnessContract: "seeded-engine-game-v1",
            seed: seed(), games: config.gamesPerIteration || 32,
            utility: utilityPlan(utilityProtocol, iteration, config.gamesPerIteration || 32),
            qEvidence: [...adaptiveEvidenceWindow(state.legacy.training, iteration, 96),
              ...adaptiveEvidenceWindow(fresh.training, iteration, 16),
              ...fresh.training
                .sort((a, b) => b.auditCompletedAt - a.auditCompletedAt).slice(0, 16),
              ...liveGames.training],
            validationEvidence: [...structuredClone(state.legacy.validation), ...liveGames.validation,
              ...fresh.validation.slice(-64)],
            legacySplitHash: digest(state.legacy), epochSeed: seed() };
          plan.deckSearch = createDeckSearchPlan(deckSearchProtocol, state.deckSearch, plan);
          disposeNeuralModel(source);
          plan.qEvidence = [...new Map(plan.qEvidence.map(entry => [entry.archivePath, entry])).values()];
          // Detach sidecar lists from the live audit queue before training;
          // later audit completions belong to the next committed update.
          plan = structuredClone(plan);
          await writeTrajectoryArchive(path.join(directory, "plan.json.gz"), plan);
        }
        const learner = modelFrom(await readTrajectoryArchive(plan.sourcePath));
        assertAdaptiveTrainingEntries(plan.qEvidence, state.legacy);
        assertUtilityEvidenceDisjoint(plan.qEvidence, plan.validationEvidence || []);
        if (neuralBehaviorHash(learner) !== plan.sourceBehaviorHash) throw new Error("On-policy collection source changed.");
        const candidatePath = path.join(directory, "candidate.json.gz");
        if (!await optional(candidatePath)) {
          const existing = (await readdir(path.join(directory, "games"))).filter(name => name.endsWith(".json.gz"));
          const processes = await waitCapacity("selfplay");
          if (!processes) { disposeNeuralModel(learner); break; }
          await status("fast-selfplay", { iteration, collected: existing.length, target: plan.games, budget: budget() });
          let lastPoolStatusAt = 0;
          await collectAdaptiveSelfPlay({ directory, plan, model: learner, decks, workers: 1,
            processes, initialProcesses: processes, maximumProcesses: 8, memoryAwareInitialProcesses: true,
            dynamicProcessLimit: () => budget().selfplay,
            dynamicScaling: true, minimumFreeMemoryBytes: 4 * 1024 ** 3,
            releaseIdleOnStop: true, awaitWorkerExit: true,
            games: plan.games, seed: plan.seed,
            maxActions: 2400, maximumTaskDurationMs: 0, bestOfThreeFraction: 0, mirrorFraction: 0.5,
            teacherEvaluatorMode: "heuristic-only", teacherFraction: 0.05, teacherBudget: 2,
            teacherCriticalBudget: 0, teacherUrgentBudget: 0, teacherScreenSimulations: 2,
            teacherConfirmationSimulations: 4, teacherConfirmationMaxSimulations: 4,
            teacherDepth: 10, teacherCandidates: 3, teacherLeafAuditSimulations: 128,
            captureProductionLeafAudit: true, captureIndependentLeafAudit: true,
            detachedIndependentLeafAudit: true, teacherLeafAuditPairBudget: 1,
            stopTeacherAfterLeafAuditBudget: true, engineFingerprint: config.engineFingerprint,
            retainResults: false, resolveTaskOptions: ({ task }) => {
              const taskIndex = task.gameIndex;
              const role = adaptiveGameRole(plan, taskIndex);
              const natural = role === 'validation' || taskIndex % 2 === 0;
              const auditMaximum = role === 'validation' ? plan.utility.validationAuditSimulations
                : taskIndex % 32 === 19 ? 1024 : taskIndex % 16 === 1 ? 512 : 128;
              const frame = { version: 1, contract: "leaf-audit-sampling-frame-v1",
                datasetKey: `${config.datasetKey}:adaptive:${iteration}`, taskIndex, certificationRole: adaptiveAuditSamplingRole(role),
                distribution: natural ? "natural-distribution" : "prespecified-stratified",
                candidateSelection: natural ? "hash-priority-mixture-reservoir-policy-decision-v1" : "teacher-selected-policy-decision-pair-v1",
                selectionProbability: null, targeted: !natural, plannedFinalSimulations: auditMaximum };
              return { optionOverrides: { ...deckSearchTaskOptions(plan.deckSearch, taskIndex),
                learnFirstPlayerChoice: [0,7].includes(taskIndex % 8),
                evidenceSamplingFrame: { ...frame, taskManifestHash: digest(frame) },
                teacherLeafAuditSimulations: auditMaximum,
                teacherLeafAuditFocusPhaseBands: natural ? [] : [["mulligan", "early", "mid", "late"][Math.floor(taskIndex / 2) % 4]] } };
            },
            onWorkerHeartbeat: pool => {
              if (Date.now() - lastPoolStatusAt < 10000) return;
              lastPoolStatusAt = Date.now();
              return status("fast-selfplay", { iteration, workerPool: pool });
            },
            onRejectedGame: failure => status(failure.recoverable ? "selfplay-action-budget-extended" : "selfplay-game-rejected",
              { iteration, ...failure }),
            onGameComplete: async ({ gameIndex, result }) => {
              const archivePath = path.join(directory, "games", `${gameIndex}.json.gz`);
              if (!state.freshEvidence.some(entry => entry.archivePath === archivePath)) {
                state.freshEvidence.push({ archivePath, datasetKey: `${config.datasetKey}:adaptive:${iteration}`,
                  role: adaptiveGameRole(plan, gameIndex) });
                await save();
              }
              await status("fast-selfplay-game-saved", { iteration, gameIndex,
                completed: result.summary?.completed ?? result.summaries?.every(s => s.completed),
                pendingLeafStates: result.pendingLeafAudit?.candidates?.length || 0 });
            }
          });
          const trajectories = [];
          for (let game = 0; game < plan.games; game++) {
            const archivePath = path.join(directory, "games", `${game}.json.gz`);
            const result = await readTrajectoryArchive(archivePath);
            assertAdaptiveGame(result, plan, game);
            if (!state.freshEvidence.some(entry => entry.archivePath === archivePath)) {
              state.freshEvidence.push({ archivePath, datasetKey: `${config.datasetKey}:adaptive:${iteration}`,
                role: adaptiveGameRole(plan, game) });
            }
            const record = state.freshEvidence.find(entry => entry.archivePath === archivePath);
            if ((record.role || 'training') !== adaptiveGameRole(plan, game)) throw new Error('Committed game role changed.');
            if (adaptiveGameRole(plan, game) === 'validation') continue;
            for (const trajectory of result.trajectories || []) {
              if (trajectory.sourcePolicyBehaviorHash !== plan.sourceBehaviorHash) throw new Error("Off-policy game rejected from PPO.");
              trajectories.push(trajectory);
            }
          }
          await save();
          assertTrainingTrajectories(trajectories, config.engineFingerprint);
          if (new Set(trajectories.map(t => t.gameId)).size < Math.min(16, plan.games)) {
            throw new Error("Too few naturally completed independent games for this PPO update.");
          }
          let candidate = modelFrom(await readTrajectoryArchive(plan.sourcePath));
          const epochFile = path.join(directory, "epoch.json.gz");
          const resume = await optional(epochFile);
          const random = seededRandom(plan.epochSeed);
          let optimizer;
          if (resume) {
            disposeNeuralModel(candidate); candidate = modelFrom(resume);
            optimizer = await restoreAdamOptimizer(resume.optimizerState, 0.0001);
            if (resume.randomState != null) random.setState(resume.randomState);
          }
          await status("candidate-policy-training", { iteration, games: plan.games });
          const trained = await trainRecurrentPpo(candidate, trajectories, {
            epochs: config.epochs || 4, batchSize: 16, learningRate: 0.0001,
            random, optimizer, resumeState: resume?.selectionState, teacherConsumptionPolicy: "record-only-v1",
            ...(plan.utility ? { beliefCoefficient: plan.utility.beliefCoefficient } : {}),
            anchorModels: [{ model: learner, weight: 1 }], anchorCoefficient: 0.05,
            ...adaptiveFiniteEpochGuard(),
            selectBestEpoch: false, gamesObserved: new Set(trajectories.map(t => t.gameId)).size,
            onEpochCheckpoint: item => writeTrajectoryArchive(epochFile, { ...item, checkpoint: serializeNeuralModel(candidate) }),
            onEpoch: metrics => status("candidate-policy-training", { iteration, ...metrics }) });
          trained.optimizer.dispose();
          if (trained.epochGuards.some(guard => !guard.passed)) {
            throw new Error("Adaptive PPO rejected non-finite epoch metrics; candidate was not committed.");
          }
          trajectories.length = 0;
          await status("candidate-q-training", { iteration, evidenceGames: plan.qEvidence.length });
          const qTraining = plan.qEvidence.length ? await trainEvaluatorFromAuditEvidence(candidate,
            () => evidenceBatches(plan.qEvidence, config.engineFingerprint), {
              epochs: 1, batchSize: 32, learningRate: 0.0001,
              engineFingerprint: config.engineFingerprint, certificationRole: "training", trainFixedContinuationShadowQ: true })
            : { samples: 0, history: [], status: "awaiting-new-contract-audit-evidence", policyWeightsUpdated: false };
          if (qTraining.history.some(epoch => [epoch.loss, epoch.rankingLoss, epoch.outcomeLoss,
            epoch.meanPreferredMargin].some(value => !Number.isFinite(value)))) {
            throw new Error("Adaptive Q update produced non-finite metrics; candidate was not committed.");
          }
          const accumulator = createLeafValueRankingAuditAccumulator();
          for await (const batch of evidenceBatches(plan.validationEvidence || state.legacy.validation, config.engineFingerprint, "validation")) {
            accumulateLeafValueRankingAudit(candidate, batch, accumulator, { engineFingerprint: config.engineFingerprint });
          }
          const shadow = finalizeLeafValueRankingAudit(accumulator);
          const shadowUtility = plan.utility ? await evaluateShadowUtility(candidate,
            evidenceBatches((plan.validationEvidence || []).filter(entry => entry.role === 'validation'),
              config.engineFingerprint, 'validation'), config.engineFingerprint) : null;
          if (!(plan.validationEvidence || state.legacy.validation).length) {
            shadow.validationStatus = "unavailable-no-held-out-evidence";
          }
          candidate.metadata = { ...candidate.metadata, adaptiveContract: config.contract,
            experimentalLearner: true, evaluatorCertification: null,
            ...(plan.deckSearch ? { deckSearch: { contract: plan.deckSearch.contract,
              poolId: plan.deckSearch.poolId, protocolHash: plan.deckSearch.protocolHash,
              population: plan.deckSearch.population.length, independentlyCertifiedBestDeck: false } } : {}),
            ...(plan.utility ? { policyQUtility: { contract: plan.utility.contract,
              protocolHash: plan.utility.protocolHash, beliefCoefficient: plan.utility.beliefCoefficient,
              ppoGames: plan.games - plan.utility.validationGameIndexes.length,
              heldOutGames: plan.utility.validationGameIndexes.length }, shadowUtility } : {}),
            shadowQContinuation: "heuristic-only-v1", shadowQActorCorrectionsAuthorized: false };
          const liveGameRegression = config.liveGameCurriculumDirectory
            ? await evaluateLiveGameRegressions(config.liveGameCurriculumDirectory, config.engineFingerprint,
              (game, actorId, actions) => createNeuralSession(candidate).decide(game, actorId, actions, { greedy: true }).action,
              { entries: (plan.validationEvidence || []).filter(entry => entry.liveGameEvidence) })
            : null;
          await writeTrajectoryArchive(candidatePath, { checkpoint: serializeNeuralModel(candidate),
            qTraining, shadow, shadowUtility, liveGameRegression, validationSplitHash: plan.legacySplitHash || digest(state.legacy), sourceBehaviorHash: plan.sourceBehaviorHash,
            candidateBehaviorHash: neuralBehaviorHash(candidate), promotionEligible: false });
          disposeNeuralModel(candidate);
        }
        disposeNeuralModel(learner);
        let nextDeckSearch = null;
        if (plan.deckSearch) {
          const results = [];
          for (let game = 0; game < plan.games; game++) {
            const result = await readTrajectoryArchive(path.join(directory, "games", `${game}.json.gz`));
            assertAdaptiveGame(result, plan, game);
            results.push({ summary: result.summaries?.[0] || result.summary,
              deckSearchConfigurationKeys: result.deckSearchConfigurationKeys,
              trajectories: result.trajectories.map(({ playerId, deckId }) => ({ playerId, deckId })) });
          }
          nextDeckSearch = learnDeckSearch(state.deckSearch, plan, results);
          await writeTrajectoryArchive(path.join(directory, "deck-search-report.json.gz"),
            deckSearchReport(nextDeckSearch, plan.deckSearch));
        }
        // Publish these fields without an await between them: background audit
        // saves must never persist next-iteration deck stats with the old cursor.
        if (nextDeckSearch) state.deckSearch = nextDeckSearch;
        state.learnerPath = candidatePath;
        state.iteration = iteration;
        // Only the running test is frozen. Replace the waiting candidate with
        // the newest learner; reserve statistical error budget when it starts.
        state.pendingEvaluationCandidate = candidatePath;
        await save();
        await status("candidate-saved-learning-continues", { iteration, candidatePath,
          championPath: state.championPath, pendingEvaluations: state.evaluationQueue.length,
          lastEvaluation: state.lastEvaluation || null, completedAudits: state.completedAudits.length });
        // The durable candidate + state make older PPO restart files redundant.
        // Cleanup failure must not discard the successful training update.
        await pruneCommittedAdaptiveEpochs(root).catch(error => {
          console.warn(`Intermediate checkpoint cleanup deferred: ${error.message}`);
        });
        const baselineComparison = await compareWithTacticalBaseline(config,candidatePath,baselinePath,decks,iteration,status);
        if (baselineComparison) {
          state.lastBaselineComparison = {...baselineComparison,summaries:undefined};
          await save();
        }
        globalThis.gc?.();
      }
      if (backgroundError) throw backgroundError;
    } catch (error) {
      await status("training-failed", { iteration: state.iteration + 1, error: error.message,
        code: error.code || null, diagnostic: error.diagnostic || null }).catch(() => {});
      throw error;
    } finally {
      stopping = true;
      await Promise.all(background);
      await auditProgressQueue;
      await saveQueue;
      await statusQueue;
    }
  }, { timeoutMs: 1000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  await import("./ai-training-priority.cjs");
  if (process.argv[2] === "--evaluate") await runFrozenEvaluation(path.resolve(process.argv[3]));
  else {
    const config = await json(path.resolve(process.argv[2]));
    await runAdaptiveTraining(config);
  }
}
