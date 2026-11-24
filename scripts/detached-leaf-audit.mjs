import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { actionKey } from "../src/ai/actions.mjs";
import { hydrateActionAuditRolloutResults, pairedIndependentTerminalActionAudit,
  pairedEvaluatorLeafStateEvidence, pairedTerminalLeafValueEvidence } from "../src/ai/rollout.mjs";
import { independentActionAuditSeedBank, mergeIndependentActionAuditSeedBatches } from "../src/ai/neural/teacher.mjs";
import { teacherLeafValueAuditReference } from "../src/ai/neural/selfplay.mjs";
import { validIndependentLeafValueReference, validLeafActionEffectComparison } from "../src/ai/neural/action-ranking-reference.mjs";
import { leafAuditSchedule, leafAuditStoppingDecision } from "../src/ai/neural/leaf-audit-schedule.mjs";
import { createAuditPool } from "./detached-action-audit-coordinator.mjs";
import { readValidatedActionAuditSeedBatchOutput } from "./ai-action-audit-task-contract.mjs";
import assert from "node:assert/strict";
import { compatibleLeafAuditSamplingFrame, AUDIT_ROLE_COMPATIBILITY } from "./adaptive-audit-role.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileDigest = async file => createHash("sha256").update(await readFile(file)).digest("hex");
const readOptional = async file => { try { return await readTrajectoryArchive(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const canonicalPlanPaths = plan => ({ ...plan, root: path.resolve(plan.root),
  candidatePath: path.resolve(plan.candidatePath) });

export async function prepareDetachedLeafAuditJobs(record, options) {
  if (!options.continuationHash) throw new Error("Missing detached continuation identity.");
  const payload = await readTrajectoryArchive(record.archivePath);
  const result = payload.result || payload;
  if (result.pendingLeafAudit?.contract !== "detached-leaf-audit-state-bank-v1") return [];
  const sourceHash = await fileDigest(record.archivePath);
  const jobs = [];
  for (const snapshot of result.pendingLeafAudit.candidates) {
    if (snapshot.descriptor?.contract !== "detached-leaf-audit-candidate-v1"
      || snapshot.engineFingerprint !== options.engineFingerprint) throw new Error("Detached leaf source mismatch.");
    const locator = snapshot.recordedStepLocator;
    const sources = (result.trajectories || []).filter(trajectory => trajectory.playerId === locator?.actorId
      && trajectory.steps?.[locator.stepIndex]?.informationSetHash === locator.informationSetHash
      && trajectory.steps?.[locator.stepIndex]?.selectedIndex === locator.selectedIndex);
    if (sources.length !== 1 || !sources[0].gameId) throw new Error("Detached leaf locator has no unique source game.");
    const candidateId = digest([sourceHash, snapshot.auditKey, options.continuationHash,
      "detached-leaf-audit-v1"]);
    const root = path.resolve(options.directory, candidateId);
    const schedule = leafAuditSchedule(snapshot.descriptor.maximumSimulations);
    const candidatePath = path.join(root, "candidate.json.gz");
    const plan = { version: 1, contract: "detached-leaf-audit-plan-v1", candidateId,
      sourceHash, sourceArchivePath: path.resolve(record.archivePath),
      datasetKey: record.datasetKey, continuationHash: options.continuationHash,
      engineFingerprint: options.engineFingerprint, informationSetHash: snapshot.descriptor.informationSetHash,
      candidatePath, schedule, sourceGameId: sources[0].gameId,
      seeds: independentActionAuditSeedBank(snapshot, "detached-leaf-prefix-v1", schedule.finalSimulations),
      locator: snapshot.recordedStepLocator, root };
    await mkdir(root, { recursive: true });
    const existing = await readOptional(path.join(root, "plan.json.gz"));
    // CLI imports may have used relative paths before a run config pins an
    // absolute directory. Equivalent file locations do not change the seeds
    // or evidence contract; keep the original saved plan untouched.
    if (existing && digest(canonicalPlanPaths(existing)) !== digest(plan)) throw new Error("Leaf audit commitment changed on resume.");
    if (!existing || !await readOptional(candidatePath)) {
      await writeTrajectoryArchive(candidatePath, { version: 1,
        contract: "detached-action-audit-candidate-v1", candidateId, candidate: snapshot });
      await writeTrajectoryArchive(path.join(root, "plan.json.gz"), plan);
    }
    jobs.push({ plan, snapshot });
  }
  return jobs;
}

export function finalizeDetachedLeafEvidence(snapshot, batches, schedule, completedStage) {
  const sampling = compatibleLeafAuditSamplingFrame(snapshot.descriptor.samplingFrame);
  const results = hydrateActionAuditRolloutResults(mergeIndependentActionAuditSeedBatches(batches));
  const descriptor = snapshot.descriptor;
  const keyed = new Map(results.map(result => [actionKey(result.action), result]));
  const first = keyed.get(actionKey(descriptor.recommendedAction));
  const second = keyed.get(actionKey(descriptor.selectedAction));
  const pairedAudit = pairedIndependentTerminalActionAudit(first, second,
    { confidence: schedule.perStageConfidence });
  const stopping = leafAuditStoppingDecision(pairedAudit, schedule);
  const evaluatorStatePairs = pairedEvaluatorLeafStateEvidence(first, second,
    { maximumPairs: completedStage });
  const comparison = {
    version: 1, contract: "paired-action-effect-leaf-audit-v1",
    recommendedActionKey: actionKey(descriptor.recommendedAction),
    comparedActionKey: actionKey(descriptor.selectedAction),
    decisiveEffectThreshold: 0.01, nearEquivalentMargin: 0.01, minimumNearEquivalentSamples: 32,
    provenance: { version: 1, informationSetHash: descriptor.informationSetHash,
      engineFingerprint: snapshot.engineFingerprint, independentSeedContract: true,
      determinizationRequired: true, sequentialAuditContract: { ...schedule, completedStage },
      ...(sampling.compatibility ? { samplingRoleCompatibility: sampling.compatibility } : {}) },
    samplingFrame: sampling.frame, pairedAudit, evaluatorStatePairs
  };
  const reference = validLeafActionEffectComparison(comparison)
    ? teacherLeafValueAuditReference({
      independentLeafActionEffectComparison: comparison,
      independentLeafValuePairs: pairedTerminalLeafValueEvidence(first, second, { maximumPairs: 1 })
    }, { game: snapshot.game, deckId: snapshot.deckId, seat: snapshot.seat,
      recommendedAction: descriptor.recommendedAction,
      selectedAction: descriptor.selectedAction, legalActions: snapshot.legalActions }) : null;
  return { stopping, pairedAudit, reference: validIndependentLeafValueReference(reference) ? reference : null };
}

export function detachedLeafSeedBatchTasks(plan, from, to, auditRole = 'training') {
  const tasks = [];
  for (let offset = from; offset < to; offset += 4) {
    const seeds = plan.seeds.slice(offset, Math.min(offset + 4, to));
    const taskId = digest([plan.candidateId, 'final-leaf-v1', seeds]);
    tasks.push({ taskId, candidateId: plan.candidateId, candidatePath: plan.candidatePath, auditRole,
      sourceArchivePath: plan.sourceArchivePath, datasetKey: plan.datasetKey,
      engineFingerprint: plan.engineFingerprint, informationSetHash: plan.informationSetHash,
      bank: 'final-leaf-v1', seeds, maximumSteps: 1200,
      outputPath: path.join(plan.root, `${taskId}.batch.json.gz`) });
  }
  return tasks;
}

// Reconstruct only from the already committed seed shards. No new rollout,
// relabeling of source games, changed seed bank, or promotion authorization.
export async function rebuildHeldOutLeafEvidence(plan, snapshot, existing) {
  assert.equal(existing?.contract, 'detached-leaf-evidence-v1');
  assert.equal(existing.finished, true);
  for (const key of ['candidateId', 'sourceHash', 'sourceArchivePath', 'sourceGameId']) {
    assert.equal(existing[key], plan[key], `Held-out evidence ${key} changed.`);
  }
  assert.equal(digest(existing.locator), digest(plan.locator));
  assert.equal(digest(existing.schedule), digest(plan.schedule));
  assert.ok(plan.schedule.stages.includes(existing.completedStage));
  assert.equal(await fileDigest(plan.sourceArchivePath), plan.sourceHash, 'Held-out source archive changed.');
  if (existing.reference) {
    assert.ok(validIndependentLeafValueReference(existing.reference));
    return { evidence: existing, changed: false };
  }
  assert.equal(snapshot.descriptor.samplingFrame?.certificationRole, 'validation');
  const sampling = compatibleLeafAuditSamplingFrame(snapshot.descriptor.samplingFrame);
  const batches = [];
  for (const task of detachedLeafSeedBatchTasks(plan, 0, existing.completedStage, 'validation')) {
    batches.push(await readValidatedActionAuditSeedBatchOutput(task, task.outputPath));
  }
  const assessed = finalizeDetachedLeafEvidence(snapshot, batches, plan.schedule, existing.completedStage);
  assert.equal(assessed.stopping.stop, true);
  assert.equal(assessed.stopping.outcome, existing.outcome, 'Completed outcome classification changed.');
  if (!assessed.reference) return { evidence: existing, changed: false };
  return { changed: true, evidence: { ...existing, reference: assessed.reference,
    roleRecovery: { contract: AUDIT_ROLE_COMPATIBILITY, at: new Date().toISOString(),
      originalReferenceWasNull: true, ...sampling.compatibility, completedSeedBatches: batches.length,
      sourceGamesPreserved: true, committedSeedsPreserved: true, newRollouts: 0 } } };
}

export async function runDetachedLeafAuditJobs(jobs, options) {
  if (!jobs.length) return [];
  const pool = options.pool || await createAuditPool({ ...options,
    teacherEvaluatorMode: options.teacherEvaluatorMode || "heuristic-only",
    processes: Math.min(16, options.processes || 6), initialProcesses: Math.min(2, options.processes || 6) });
  try {
    return await Promise.all(jobs.map(async ({ plan, snapshot }) => {
      const output = path.join(plan.root, "evidence.json.gz");
      const existing = await readOptional(output);
      if (existing) {
        if (existing.contract !== "detached-leaf-evidence-v1" || existing.finished !== true
          || existing.candidateId !== plan.candidateId || existing.sourceHash !== plan.sourceHash
          || existing.sourceArchivePath !== plan.sourceArchivePath || existing.sourceGameId !== plan.sourceGameId
          || digest(existing.locator) !== digest(plan.locator) || digest(existing.schedule) !== digest(plan.schedule)
          || !plan.schedule.stages.includes(existing.completedStage)
          || (existing.reference && !validIndependentLeafValueReference(existing.reference)))
          throw new Error("Leaf audit evidence lineage mismatch.");
        return existing;
      }
      let prior = 0;
      const batches = [];
      for (const stage of plan.schedule.stages) {
        if (options.shouldStop?.()) return { candidateId: plan.candidateId, paused: true, finished: false };
        // Each pair reuses its determinization across the two actions. A
        // completed four-seed shard is durable before further work is issued.
        const tasks = detachedLeafSeedBatchTasks(plan, prior, stage, options.auditRole || 'training');
        let outputs;
        try { outputs = await pool.run(tasks, { stage: "detached-leaf-audit", candidateId: plan.candidateId }); }
        catch (error) {
          if (error.code === "AUDIT_POOL_PAUSED" && options.shouldStop?.()) {
            return { candidateId: plan.candidateId, paused: true, finished: false };
          }
          throw error;
        }
        for (const item of outputs) batches.push(await readValidatedActionAuditSeedBatchOutput(item.task, item.outputPath));
        const assessed = finalizeDetachedLeafEvidence(snapshot, batches, plan.schedule, stage);
        const checkpoint = { version: 1, contract: "detached-leaf-evidence-v1",
          candidateId: plan.candidateId, sourceHash: plan.sourceHash,
          sourceArchivePath: plan.sourceArchivePath, sourceGameId: plan.sourceGameId,
          locator: plan.locator, completedStage: stage, schedule: plan.schedule,
          reference: assessed.reference, outcome: assessed.stopping.outcome,
          finished: assessed.stopping.stop, at: new Date().toISOString() };
        await writeTrajectoryArchive(path.join(plan.root, "progress.json.gz"), checkpoint);
        options.onProgress?.(checkpoint);
        if (assessed.stopping.stop) {
          await writeTrajectoryArchive(output, checkpoint);
          return checkpoint;
        }
        prior = stage;
      }
      throw new Error("Leaf audit ended without a terminal budget decision.");
    }));
  } finally { if (!options.pool) await pool.close(); }
}

export function applyDetachedLeafEvidence(result, evidence) {
  const locator = evidence.locator;
  if (!evidence.sourceGameId || !result.trajectories?.some(item => item.gameId === evidence.sourceGameId)) {
    throw new Error("Leaf evidence source game mismatch.");
  }
  const sources = result.trajectories.filter(item => item.gameId === evidence.sourceGameId && item.playerId === locator.actorId);
  if (sources.length !== 1) throw new Error("Leaf evidence requires exactly one source trajectory.");
  const trajectory = sources[0];
  const step = trajectory?.steps?.[locator.stepIndex];
  if (!step || step.informationSetHash !== locator.informationSetHash
    || step.selectedIndex !== locator.selectedIndex) throw new Error("Leaf evidence step locator mismatch.");
  if (!evidence.reference) return false;
  if (!validIndependentLeafValueReference(evidence.reference)) throw new Error("Invalid detached leaf evidence.");
  step.leafValueAuditReference = evidence.reference;
  if (step.naturalLeafAuditSamplingObservation) step.naturalLeafAuditSamplingObservation.status = "audited";
  return true;
}
