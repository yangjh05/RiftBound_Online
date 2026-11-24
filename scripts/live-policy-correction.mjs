import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { actionKey } from '../src/ai/actions.mjs';
import { readTrajectoryArchive, writeTrajectoryArchive } from '../src/ai/neural/archive.mjs';
import { createNeuralSession, deserializeNeuralModel, serializeNeuralModel, disposeNeuralModel,
  trainPpoBatch } from '../src/ai/neural/model.mjs';
import { neuralArtifactHash, neuralBehaviorHash } from '../src/ai/neural/evaluator-certification.mjs';
import { CARD_BINS } from '../src/ai/neural/encoding.mjs';
import { createActionEvidenceProtocolManifest, createActionEvidenceSeedCommitment } from '../src/ai/neural/evidence-protocol.mjs';
import { createActionRankingAuditReference } from '../src/ai/neural/action-ranking-reference.mjs';
import { independentActionAuditSeedBank,
  mergeIndependentActionAuditProtocolBatches, independentActionAuditEvidenceFromBatches,
  finalizeIndependentActionAuditBatches } from '../src/ai/neural/teacher.mjs';
import { pairedBinaryDifferenceInterval } from '../src/ai/neural/paired-action-effect-statistics.mjs';
import { packPpoBatch, policyConditionedActionCorrectionTrajectories } from '../src/ai/neural/trainer.mjs';
import { tf } from '../src/ai/neural/tf-runtime.mjs';
import { evaluateNeuralModels } from '../src/ai/neural/selfplay.mjs';
import { decklists } from '../src/cards.mjs';
import { resolveTrainingDecks } from '../src/ai/training-decks.mjs';
import { createAuditPool } from './detached-action-audit-coordinator.mjs';
import { readValidatedActionAuditSeedBatchOutput } from './ai-action-audit-task-contract.mjs';
import { collectTacticalRefreshGames } from './tactical-policy-refresh.mjs';
import { LIVE_GAME_CONTRACT, liveGameRole } from './live-game-curriculum.mjs';
import { selectShadowQProposals } from './shadow-q-utility.mjs';

export const LIVE_POLICY_CONTRACT = 'prospective-live-policy-correction-v1';
export const livePolicyDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashFile = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const optional = async file => { try { return await readTrajectoryArchive(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const checkpoint = payload => payload.candidateCheckpoint || payload.checkpoint || payload;

export async function readLivePolicyProtocol(root) {
  let protocol;
  try { protocol = JSON.parse((await readFile(path.join(root, 'live-policy-protocol.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assert.equal(protocol.contract, LIVE_POLICY_CONTRACT);
  assert.ok(Number.isInteger(protocol.afterIteration) && protocol.afterIteration >= 0);
  assert.equal(protocol.everyIterations, 32);
  assert.ok(Number.isInteger(protocol.seed) && protocol.seed > 0 && protocol.seed <= 0xffffffff);
  assert.equal(protocol.maximumGames, 8);
  assert.equal(protocol.maximumComparisons, 32);
  assert.equal(protocol.selectionPairs, 32);
  assert.equal(protocol.finalPairs, 128);
  assert.equal(protocol.comparisonGames, 40);
  return protocol;
}

export function commitLivePolicyProtocol(state, protocol) {
  const hash = protocol ? livePolicyDigest(protocol) : null;
  if (state.livePolicyProtocolHash) assert.equal(hash, state.livePolicyProtocolHash, 'Active live policy protocol changed or removed.');
  else if (protocol) {
    assert.ok(protocol.afterIteration >= state.iteration, 'Live policy corrections must start prospectively.');
    state.livePolicyProtocolHash = hash;
  }
}

export function livePolicyScheduled(protocol, iteration) {
  return Boolean(protocol && iteration > protocol.afterIteration
    && (iteration - protocol.afterIteration - 1) % protocol.everyIterations === 0);
}

// Only complete, exact-seed terminal pairs count. No cutoff values, partial
// outcomes, repeated looks, or reversing the hypothesis after seeing results.
// Bonferroni covers every precommitted comparison, including screened failures.
export function confirmedLivePolicyEffect(evidence, seeds, familySize, minimumEffect = 0.02) {
  const pairs = evidence?.terminalEvidence?.outcomePairs || [];
  const seen = pairs.map(pair => pair.simulationSeed);
  const valid = Number.isInteger(familySize) && familySize > 0 && familySize <= 32
    && new Set(seeds).size === seeds.length && new Set(seen).size === seen.length
    && seen.length === seeds.length && seen.every(seed => seeds.includes(seed))
    && evidence?.determinizationAudit?.complete === true
    && evidence?.terminalEvidence?.attemptedPairs === seeds.length
    && evidence?.terminalEvidence?.terminalPairs === seeds.length;
  const interval = valid ? pairedBinaryDifferenceInterval(pairs.map(pair => ({
    leftOutcome: pair.recommendedOutcome ?? pair.leftOutcome,
    rightOutcome: pair.selectedOutcome ?? pair.rightOutcome
  })), 1 - 0.01 / familySize) : null;
  return { eligible: Boolean(interval && interval.lowerBound > minimumEffect), interval,
    reason: !valid ? 'incomplete-or-invalid-terminal-pairs' : !interval ? 'invalid-outcomes'
      : interval.lowerBound > minimumEffect ? 'confirmed' : 'uncertain', familySize, minimumEffect };
}

async function freezeSources(bank, fingerprint, protocol) {
  const index = await readTrajectoryArchive(path.join(bank, 'manifest.json.gz'));
  assert.equal(index.engineFingerprint, fingerprint);
  const entries = index.entries.filter(entry => entry.role === 'training')
    .sort((a, b) => a.sourceGameId.localeCompare(b.sourceGameId)).slice(0, protocol.maximumGames);
  const pairs = [];
  for (const entry of entries) {
    assert.equal(liveGameRole(entry.sourceGameId), 'training');
    assert.equal(await hashFile(entry.archivePath), entry.archiveHash, 'Live curriculum archive changed.');
    const source = await readTrajectoryArchive(entry.archivePath);
    assert.equal(source.contract, LIVE_GAME_CONTRACT);
    assert.equal(source.role, 'training');
    assert.equal(source.sourceGameId, entry.sourceGameId);
    assert.equal(source.engineFingerprint, fingerprint);
    for (const snapshot of source.pendingLeafAudit?.candidates || []) {
      if (pairs.length >= protocol.maximumComparisons) break;
      const trajectory = source.trajectories.find(t => t.playerId === snapshot.actorId);
      const step = trajectory?.steps[snapshot.recordedStepLocator.stepIndex];
      assert.equal(step?.informationSetHash, snapshot.descriptor.informationSetHash);
      pairs.push({ entry, snapshot, trajectory: { ...trajectory, steps: [step] } });
    }
  }
  return pairs;
}

function continuationProtocol(model) {
  const member = { id: 'frozen-current-policy', modelHash: neuralArtifactHash(model),
    behaviorHash: neuralBehaviorHash(model), strength: 1, weight: 1,
    behaviorallyIndependent: false, searchEnabled: false };
  return createActionEvidenceProtocolManifest({ scope: 'targeted-submitted-games-local-policy-correction',
    continuationPool: [member], opponentPool: [member], minimumStrongEffect: 0.02,
    searchContractHash: livePolicyDigest('symmetric-neural-continuation-terminal-only-depth24-v1'),
    searchTriggerRuleHash: livePolicyDigest('both-paired-branches-always-v1'),
    chanceScheduleVersion: 'paired-determinization-fixed-seed-v1' });
}

async function preparePlan(root, inputPath, model, config, protocol, iteration, runtime = {}) {
  const identity = { contract: LIVE_POLICY_CONTRACT, protocolHash: livePolicyDigest(protocol), iteration,
    sourcePath: path.resolve(inputPath), sourceSha256: await hashFile(inputPath),
    artifactHash: neuralArtifactHash(model), behaviorHash: neuralBehaviorHash(model), engineFingerprint: config.engineFingerprint };
  const file = path.join(root, 'plan.json.gz'), existing = await optional(file);
  if (existing) {
    for (const [key, value] of Object.entries(identity)) assert.equal(existing[key], value, `Live policy plan changed: ${key}`);
    for (const job of existing.jobs) {
      assert.equal(await hashFile(job.entry.archivePath), job.entry.archiveHash);
      assert.equal(await hashFile(job.candidatePath), job.candidateHash);
    }
    return existing;
  }
  const submitted = await freezeSources(config.liveGameCurriculumDirectory, config.engineFingerprint, protocol);
  const qProposals = await selectShadowQProposals(model, runtime.freshEvidence || [], runtime.utilityProtocol, config.engineFingerprint);
  const sources = [...qProposals, ...submitted].slice(0, protocol.maximumComparisons);
  const manifest = continuationProtocol(model), jobs = [];
  for (const pair of sources) {
    const snapshot = structuredClone(pair.snapshot);
    // A new experiment identity prevents accidental reuse of heuristic-only
    // audits or seeds from an earlier policy. The original archive is untouched.
    const candidateId = livePolicyDigest([identity, snapshot.auditKey, protocol.seed]);
    snapshot.auditKey = snapshot.descriptor.auditKey = candidateId;
    snapshot.descriptor.evidenceProtocolManifest = manifest;
    snapshot.descriptor.samplingFrame = { candidateSelection: pair.entry.proposalSource || 'all-prespecified-submitted-pairs-v1',
      distribution: pair.entry.proposalSource ? 'targeted-training-game' : 'targeted-submitted-game',
      targeted: true, selectionProbability: null };
    const selectionSeeds = independentActionAuditSeedBank(snapshot, 'live-policy-selection-v1', 32);
    const finalSeeds = independentActionAuditSeedBank(snapshot, 'live-policy-final-v1', 128, selectionSeeds);
    snapshot.descriptor.evidenceCommitment = createActionEvidenceSeedCommitment(manifest, {
      auditKey: candidateId, informationSetHash: snapshot.descriptor.informationSetHash,
      pilotSeeds: selectionSeeds.slice(0, 8), selectionSeeds, finalSeeds, rolloutsStarted: false });
    const candidatePath = path.join(root, 'candidates', `${candidateId}.json.gz`);
    await writeTrajectoryArchive(candidatePath, { contract: 'detached-action-audit-candidate-v1',
      candidateId, candidate: snapshot, modelSeatSources: [] });
    jobs.push({ candidateId, candidatePath, candidateHash: await hashFile(candidatePath),
      entry: pair.entry, trajectory: pair.trajectory, selectionSeeds, finalSeeds });
  }
  const plan = { ...identity, manifest, jobs, seed: protocol.seed, qProposals: qProposals.length,
    holdoutSchedule: config.deckIds.flatMap((deckId, deckIndex) => [0, 1].map(seat => ({
      index: deckIndex * 2 + seat, deckId, partition: 'validation',
      seed: (protocol.seed + Math.imul(iteration, 104729) + Math.imul(deckIndex * 2 + seat + 1, 13007)) >>> 0 }))),
    comparisonGames: protocol.comparisonGames,
    comparisonSeed: (protocol.seed + Math.imul(iteration, 65537)) >>> 0,
    correction: { epochs: 1, learningRate: 0.00005, batchSize: 8, maximumCorrections: 32,
      meanKlLimit: 0.01, maximumKlLimit: 0.05, accuracyDropLimit: 0.02, lossIncreaseLimit: 0.02 },
    promotionEligible: false, populationPerformanceClaim: false };
  await writeTrajectoryArchive(file, plan);
  return plan;
}

async function auditPlan(plan, root, model, runtime, status) {
  const references = [], reports = [], familySize = plan.jobs.length;
  if (!familySize) return { references, reports };
  const pool = await createAuditPool({ model, evidenceProtocolManifest: plan.manifest,
    teacherEvaluatorMode: 'heuristic-only', engineFingerprint: plan.engineFingerprint,
    processes: Math.min(4, runtime.processes || 1), initialProcesses: Math.min(2, runtime.processes || 1),
    dynamicProcessLimit: runtime.dynamicProcessLimit, minimumFreeMemoryBytes: 4 * 1024 ** 3,
    onProgress: progress => { void status('live-policy-audit-workers', { iteration: plan.iteration, ...progress }); } });
  try {
    for (const job of plan.jobs) {
      const snapshot = (await readTrajectoryArchive(job.candidatePath)).candidate;
      const batches = {};
      for (const bank of ['selection', 'final']) {
        if (runtime.shouldStop?.()) return { paused: true, references, reports };
        const seeds = job[`${bank}Seeds`], tasks = [];
        for (let offset = 0; offset < seeds.length; offset += 4) {
          const shard = seeds.slice(offset, offset + 4), taskId = livePolicyDigest([job.candidateId, bank, shard]);
          tasks.push({ taskId, candidateId: job.candidateId, candidatePath: job.candidatePath,
            sourceArchivePath: job.entry.archivePath, datasetKey: LIVE_POLICY_CONTRACT,
            engineFingerprint: plan.engineFingerprint, informationSetHash: snapshot.descriptor.informationSetHash,
            evidenceProtocolHash: plan.manifest.protocolHash,
            protocolPairIds: ['frozen-current-policy::frozen-current-policy'],
            bank, seeds: shard, maximumSteps: 1200, outputPath: path.join(root, 'batches', `${taskId}.json.gz`) });
        }
        await status('live-policy-audit', { iteration: plan.iteration, pair: reports.length + 1, pairs: familySize, bank });
        const outputs = await pool.run(tasks, { stage: 'live-policy-audit', candidateId: job.candidateId, bank });
        batches[bank] = await Promise.all(outputs.map(output => readValidatedActionAuditSeedBatchOutput(output.task, output.outputPath)));
        const results = mergeIndependentActionAuditProtocolBatches(batches[bank])[0]?.results || [];
        const evidence = independentActionAuditEvidenceFromBatches(snapshot, results);
        const effect = confirmedLivePolicyEffect(evidence, seeds, bank === 'final' ? familySize : 1,
          bank === 'final' ? 0.02 : 0);
        if (!effect.eligible) {
          reports.push({ candidateId: job.candidateId, sequence: job.trajectory.steps[0].sequence,
            status: `${bank}-${effect.reason}`, ...effect });
          break;
        }
        if (bank === 'final') {
          const finalized = finalizeIndependentActionAuditBatches(snapshot, {
            selectionResults: mergeIndependentActionAuditProtocolBatches(batches.selection)[0]?.results || [], finalResults: results,
            protocolSelectionResults: mergeIndependentActionAuditProtocolBatches(batches.selection),
            protocolFinalResults: mergeIndependentActionAuditProtocolBatches(batches.final) });
          const step = job.trajectory.steps[0];
          const reference = createActionRankingAuditReference({ audit: finalized.audit,
            informationSetHash: step.informationSetHash, comparedIndex: step.selectedIndex,
            correctIndex: step.legalActionKeys.indexOf(actionKey(snapshot.descriptor.recommendedAction)),
            comparedActionKey: actionKey(snapshot.descriptor.selectedAction),
            correctActionKey: actionKey(snapshot.descriptor.recommendedAction),
            engineFingerprint: plan.engineFingerprint, requireStructuredV2: true });
          reports.push({ candidateId: job.candidateId, sequence: step.sequence,
            status: reference ? 'confirmed-reference' : 'reference-rejected', ...effect });
          if (reference) references.push({ ...job.trajectory, fixedShadowContinuation: null,
            livePolicyEvidence: { contract: LIVE_POLICY_CONTRACT, sourceArchiveHash: job.entry.archiveHash,
              continuationModelHash: plan.artifactHash, candidateId: job.candidateId },
            steps: [{ ...step, actionRankingAuditReference: reference }] });
        }
      }
      await writeTrajectoryArchive(path.join(root, 'audit-progress.json.gz'), { reports, finished: reports.length === familySize });
    }
    return { references, reports };
  } finally { await pool.close(); }
}

export function measureLivePolicy(model, samples) {
  return samples.map(sample => {
    const step = sample.steps[0];
    const actorId = sample.playerId || 'p1';
    const decision = createNeuralSession(model, { lean: true,
      initialMemories: { [actorId]: step.initialMemory } }).decideEncoded(actorId, {
      stateEncoding: step.state, actionEncoding: step.actions, actions: step.legalActionKeys,
      legalCount: step.legalCount }, { greedy: true });
    return { probabilities: decision.probabilities, selectedIndex: decision.selectedIndex,
      expectedIndex: step.teacherIndex ?? step.selectedIndex };
  });
}

export function livePolicyRegressionGuard(before, after, limits) {
  assert.equal(before.length, after.length);
  if (!before.length) return { passed: false, reason: 'no-independent-regression-positions' };
  const kls = before.map((old, index) => {
    const next = after[index];
    assert.equal(old.probabilities.length, next.probabilities.length);
    return old.probabilities.reduce((sum, p, action) => sum + p * Math.log(Math.max(1e-12, p)
      / Math.max(1e-12, next.probabilities[action])), 0);
  });
  const loss = rows => rows.reduce((sum, row) => sum - Math.log(Math.max(1e-12, row.probabilities[row.expectedIndex])), 0) / rows.length;
  const accuracy = rows => rows.filter(row => row.expectedIndex === row.selectedIndex).length / rows.length;
  const metrics = { positions: before.length, meanKl: kls.reduce((a, b) => a + b, 0) / kls.length,
    maximumKl: Math.max(...kls), accuracyBefore: accuracy(before), accuracyAfter: accuracy(after),
    lossBefore: loss(before), lossAfter: loss(after) };
  return { ...metrics, passed: Object.values(metrics).every(Number.isFinite)
    && metrics.meanKl <= limits.meanKlLimit && metrics.maximumKl <= limits.maximumKlLimit
    && metrics.accuracyAfter >= metrics.accuracyBefore - limits.accuracyDropLimit
    && metrics.lossAfter <= metrics.lossBefore + limits.lossIncreaseLimit };
}

// Evidence authorization is reused verbatim. Logged decisions NEVER receive
// invented PPO behavior probabilities. Packing placeholders are local tensors
// with PPO/value/belief losses disabled; only verified preference + anchor KL run.
export function fitLivePolicyCorrections(source, evidence, holdout, limits) {
  const corrections = policyConditionedActionCorrectionTrajectories(evidence, { enabled: true,
    currentPolicyHash: neuralBehaviorHash(source), currentPolicyArtifactHash: neuralArtifactHash(source),
    maximumCorrections: limits.maximumCorrections });
  if (!corrections.length) return { checkpoint: serializeNeuralModel(source), outcome: 'no-authorized-corrections', corrections: 0 };
  assert.ok(holdout.length >= 32, 'Independent regression positions are required before an actor update.');
  const trainingGameIds = new Set(evidence.map(item => item.gameId));
  assert.ok(holdout.every(item => item.partition === 'validation' && !trainingGameIds.has(item.gameId)), 'Holdout/train overlap.');
  const model = deserializeNeuralModel(serializeNeuralModel(source)), optimizer = tf.train.adam(limits.learningRate);
  const before = measureLivePolicy(source, holdout), correctionBefore = measureLivePolicy(source, corrections);
  const chunks = corrections.map(trajectory => ({ ...trajectory, steps: trajectory.steps.map(step => ({ ...step,
    advantage: 0, return: 0, oldLogProbability: 0, beliefTarget: new Float32Array(CARD_BINS) })) }));
  const history = [];
  try {
    for (let start = 0; start < chunks.length; start += limits.batchSize) {
      history.push(trainPpoBatch(model, packPpoBatch(chunks.slice(start, start + limits.batchSize)), optimizer, {
        policyCoefficient: 0, valueCoefficient: 0, actionValueCoefficient: 0, diagnosticCoefficient: 0, beliefCoefficient: 0,
        entropyCoefficient: 0, teacherCoefficient: 0.3, teacherRankingCoefficient: 0.3,
        teacherDistillationCoefficient: 0, teacherActionValueCoefficient: 0,
        anchorModels: [{ model: source, weight: 1 }], anchorCoefficient: 0.1 }));
    }
    assert.ok(history.every(row => Object.values(row).filter(value => typeof value === 'number').every(Number.isFinite)), 'Non-finite actor update.');
    const guard = livePolicyRegressionGuard(before, measureLivePolicy(model, holdout), limits);
    const localGuard = livePolicyRegressionGuard(correctionBefore, measureLivePolicy(model, corrections),
      { ...limits, accuracyDropLimit: 0, lossIncreaseLimit: 0 });
    const accepted = guard.passed && localGuard.passed && localGuard.lossAfter < localGuard.lossBefore;
    return { checkpoint: serializeNeuralModel(accepted ? model : source), corrections: corrections.length,
      outcome: accepted ? 'actor-updated' : 'rejected-by-regression-guard', guard, localGuard, history,
      behaviorChanged: accepted && neuralBehaviorHash(source) !== neuralBehaviorHash(model) };
  } finally { optimizer.dispose(); disposeNeuralModel(model); }
}

async function runComparisonChild(requestPath, status) {
  await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--compare', requestPath], {
      windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', progress => { void status('live-policy-on-off-comparison', progress); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Live policy comparison exited ${code}`)));
  });
}

export async function ensureLivePolicyCorrection(config, inputPath, iteration, decks, status = async () => {}, expectedHash = null, runtime = {}) {
  const protocol = await readLivePolicyProtocol(config.directory);
  if (expectedHash) assert.equal(protocol && livePolicyDigest(protocol), expectedHash);
  if (!livePolicyScheduled(protocol, iteration)) return inputPath;
  assert.ok(config.liveGameCurriculumDirectory, 'Live policy curriculum directory is required.');
  const root = path.join(config.directory, 'live-policy', String(iteration).padStart(6, '0'));
  await mkdir(root, { recursive: true });
  const model = deserializeNeuralModel(checkpoint(await readTrajectoryArchive(inputPath)));
  try {
    const plan = await preparePlan(root, inputPath, model, config, protocol, iteration, runtime);
    const output = path.join(root, 'checkpoint.json.gz'), reportFile = path.join(root, 'report.json.gz');
    let report = await optional(reportFile);
    if (report) {
      assert.equal(report.planHash, livePolicyDigest(plan));
      assert.equal(report.outputHash, await hashFile(output));
      assert.equal(report.auditHash, await hashFile(path.join(root, 'audit.json.gz')));
      return output;
    }
    let audit = await optional(path.join(root, 'audit.json.gz'));
    if (audit) assert.equal(audit.planHash, livePolicyDigest(plan));
    else {
      audit = await auditPlan(plan, root, model, runtime, status);
      if (audit.paused || runtime.shouldStop?.()) return inputPath;
      audit.planHash = livePolicyDigest(plan);
      await writeTrajectoryArchive(path.join(root, 'audit.json.gz'), audit);
    }
    let fit = { checkpoint: serializeNeuralModel(model), corrections: 0, outcome: 'no-confirmed-alternatives' };
    if (audit.references.length) {
      const games = await collectTacticalRefreshGames({ ...runtime, root: path.join(root, 'independent-regression'),
        model, decks, schedule: plan.holdoutSchedule, engineFingerprint: plan.engineFingerprint,
        protocolHash: livePolicyDigest(plan), sourceSha256: plan.sourceSha256, iteration, status });
      const holdout = games.filter(game => game.summary.completed).flatMap(game => game.samples.map(sample => ({
        ...sample, partition: 'validation', gameId: `live-policy-holdout:${plan.iteration}:${game.gameIndex}:${sample.gameId}` })));
      // Deterministic, evenly spaced cap; never rank holdouts by the update's errors.
      const sampled = holdout.length <= 256 ? holdout : Array.from({ length: 256 }, (_, index) => holdout[Math.floor(index * holdout.length / 256)]);
      fit = sampled.length >= 32 ? fitLivePolicyCorrections(model, audit.references, sampled, plan.correction)
        : { ...fit, outcome: 'insufficient-independent-regression', regressionPositions: sampled.length };
    }
    const metadata = { contract: LIVE_POLICY_CONTRACT, planHash: livePolicyDigest(plan),
      sourceSha256: plan.sourceSha256, sourceBehaviorHash: plan.behaviorHash, outcome: fit.outcome,
      qProposals: plan.qProposals || 0,
      corrections: fit.corrections, engineFingerprint: plan.engineFingerprint, promotionEligible: false };
    fit.checkpoint.metadata = { ...fit.checkpoint.metadata, livePolicyCorrection: metadata,
      evaluatorCertification: null, evaluatorCertificate: null };
    await writeTrajectoryArchive(output, { ...metadata, checkpoint: fit.checkpoint });
    const comparisonPath = path.join(root, 'on-off-comparison.json.gz');
    if (fit.outcome === 'actor-updated') {
      const requestPath = path.join(root, 'comparison-request.json.gz');
      await writeTrajectoryArchive(requestPath, { ...metadata, candidatePath: output, candidateHash: await hashFile(output),
        sourcePath: plan.sourcePath, deckIds: config.deckIds, seed: plan.comparisonSeed,
        ...(config.deckSearchPoolId ? { decks, deckPoolId: config.deckSearchPoolId } : {}),
        games: plan.comparisonGames, outputPath: comparisonPath });
      await runComparisonChild(requestPath, status);
    }
    report = { ...metadata, outputHash: await hashFile(output), reports: audit.reports,
      guard: fit.guard || null, localGuard: fit.localGuard || null, history: fit.history || [],
      auditHash: await hashFile(path.join(root, 'audit.json.gz')),
      policyWeightsUpdated: fit.behaviorChanged === true,
      comparison: fit.outcome === 'actor-updated' ? await readTrajectoryArchive(comparisonPath)
        : { status: 'not-run-identical-policy', promotionEligible: false } };
    await writeTrajectoryArchive(reportFile, report);
    await status('live-policy-correction-ready', { iteration, ...metadata, policyWeightsUpdated: report.policyWeightsUpdated });
    return output;
  } finally { disposeNeuralModel(model); }
}

if (process.argv[2] === '--compare' && path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const request = await readTrajectoryArchive(path.resolve(process.argv[3]));
  assert.equal(await hashFile(request.sourcePath), request.sourceSha256);
  assert.equal(await hashFile(request.candidatePath), request.candidateHash);
  const source = deserializeNeuralModel(checkpoint(await readTrajectoryArchive(request.sourcePath)));
  const candidate = deserializeNeuralModel(checkpoint(await readTrajectoryArchive(request.candidatePath)));
  try {
    const decks = request.decks || resolveTrainingDecks(decklists, 'origins-era', request.deckIds);
    if (request.decks) {
      const { assertLegalTrainingDeck } = await import('../src/ai/legal-decks.mjs');
      for (const deck of decks) assertLegalTrainingDeck(deck, request.deckPoolId);
    }
    const result = evaluateNeuralModels(candidate, source, decks, { games: request.games, seed: request.seed,
      maxActions: 2400, evaluationMode: 'same-deck-mirror-v3', greedy: true, temperature: 0.05,
      onGameComplete: ({ game }) => process.send?.({ game, games: request.games }) });
    const valid = result.summaries.length === request.games
      && result.summaries.every(summary => summary.completed && !summary.invalid && !summary.adjudicated);
    const completed = result.summaries.filter(summary => summary.completed && !summary.invalid && !summary.adjudicated);
    const wins = completed.filter(summary => summary.winnerId === `p${summary.candidateSeat + 1}`).length;
    await writeTrajectoryArchive(request.outputPath, { contract: 'same-source-live-correction-on-off-diagnostic-v1',
      candidateHash: request.candidateHash, sourceSha256: request.sourceSha256, games: result.summaries.length,
      valid, completed: completed.length, wins, losses: completed.length - wins, summaries: result.summaries,
      promotionEligible: false, conclusiveStrengthImprovement: false });
  } finally { disposeNeuralModel(source); disposeNeuralModel(candidate); }
}
