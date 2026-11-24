import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {specialistLessonReviewGate} from './deck-pilot-comparison.mjs';

export const RECOVERY_FIRST_TRANSFER = 'recovery-before-viktor-transfer-v1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const unwrap = value => value.candidateCheckpoint || value.checkpoint || value;
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const readArchive = async file => JSON.parse(gunzipSync(await fs.readFile(file)));
const optional = async (read, file) => read(file).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

// A newer learner is not a validated source. Wait for the existing trainer's
// boundary adoption, or a real champion promotion; never edit its live state.
export function recoveredTransferSource(state, protocol, originalChampionPath, confirmation) {
  const anchor = state.learnerAnchor;
  if (!anchor) return null;
  assert.equal(anchor.protocolHash, digest(protocol), 'Recovery protocol changed');
  if (state.championPath !== originalChampionPath && anchor.anchorPath === state.championPath)
    return {kind:'promoted-champion', path:state.championPath};
  const history = anchor.history || [];
  const index = history.findLastIndex(record => record.adoptedPath === anchor.anchorPath);
  if (index < 0) return null;
  const record = history[index];
  if (record.reason === 'fresh-paired-confirmation') {
    if (!confirmation?.confirmation?.accepted) return null;
    assert.equal(record.evidence.configHash, protocol.comparisonConfigHash);
    assert.equal(confirmation.configHash, protocol.comparisonConfigHash);
    assert.equal(confirmation.candidatePath, record.learnerPath);
    assert.deepEqual(record.evidence.comparison, confirmation.confirmation);
  } else if (record.reason === 'bounded-branch-repeatedly-inferior') {
    const start = index ? history[index - 1].iteration : protocol.afterIteration;
    if (record.iteration - start < protocol.maximumUnverifiedIterations) return null;
    const failures = record.evidence?.evaluations || [];
    const paths = new Set(failures.filter(e => e.iteration > start && e.iteration <= record.iteration
      && Number.isFinite(e.upperBound) && e.upperBound < .5 && e.candidatePath).map(e => e.candidatePath));
    if (paths.size < protocol.minimumInferiorEvaluations) return null;
  } else return null;
  return {kind:record.reason, path:record.adoptedPath, record};
}

export function assessTransferReadiness({comparison, state, anchorProtocol, originalChampionPath, confirmation, resources}) {
  const lessonGate = specialistLessonReviewGate(comparison);
  const source = recoveredTransferSource(state, anchorProtocol, originalChampionPath, confirmation);
  const reasons = [];
  if (!comparison.complete) reasons.push('comparison-incomplete');
  else if (!lessonGate.eligibleForLessonReview) reasons.push('specialist-advantage-not-established');
  if (!source) reasons.push('validated-recovery-not-applied');
  if (!(Number.isInteger(resources.count) && resources.count >= 0 && resources.count <= 16 && resources.allNormal))
    reasons.push('resource-or-priority-check-failed');
  return {contract:RECOVERY_FIRST_TRANSFER, readyForLessonPlan:reasons.length === 0, reasons,
    comparison:{completedGames:comparison.completedGames,targetGames:comparison.targetGames,lessonGate},
    recovery:{applied:Boolean(source),source}, resources,
    // Readiness is not permission to train on arbitrary specialist moves,
    // mutate main weights, or claim specialist-level skill.
    mainWeightsMayChange:false, specialistParityEstablished:false, trainingStarted:false};
}

export function verifyAdoptedSource(source, adopted, original, sourceBytesHash) {
  assert.equal(source.record.sha256, sourceBytesHash, 'Recovery source artifact changed');
  const {adoptedPath, ...evidence} = source.record;
  assert.equal(adoptedPath, source.path);
  assert.deepEqual(adopted.anchorEvidence, evidence, 'Adoption evidence changed');
  const old = unwrap(original), current = unwrap(adopted);
  const expected = structuredClone(old);
  expected.generation = current.generation;
  expected.metadata = {...expected.metadata, learnerAnchorSource:{path:source.record.learnerPath,
    generation:old.generation,sha256:sourceBytesHash}};
  assert.deepEqual(current, expected, 'Adopted checkpoint differs from verified source');
}

export async function inspectTransferReadiness(protocolPath) {
  const p = await readJson(protocolPath);
  assert.equal(p.contract, RECOVERY_FIRST_TRANSFER);
  const plan = await readJson(path.join(p.viktorComparisonDirectory,'plan.json'));
  assert.equal(digest(plan),p.viktorComparisonPlanHash,'Frozen comparison plan changed');
  for (const [name, hash] of Object.entries(plan.executionFiles))
    assert.equal(sha(await fs.readFile(path.join(p.comparisonToolsDirectory,name))),hash);
  const comparisonTools = await import(pathToFileURL(path.join(p.comparisonToolsDirectory,'deck-pilot-comparison.mjs')));
  const records = [];
  for (const job of plan.schedule) for (let index=0;index<8;index++) {
    const record = await optional(readJson,path.join(p.viktorComparisonDirectory,'games',`${job.id}-${index}.json`));
    if (record) records.push(record);
  }
  // Rebuild from actual records; a stale or edited report cannot open the gate.
  const comparison = comparisonTools.summarizeComparison(plan,records);
  assert.deepEqual(specialistLessonReviewGate(comparison),comparisonTools.specialistLessonReviewGate(comparison),
    'Lesson eligibility rules changed from the frozen comparison');
  for (const model of Object.values(plan.models))
    assert.equal(sha(await fs.readFile(path.join(p.viktorComparisonDirectory,model.file))),model.sha256);
  const anchorProtocol = await readJson(path.join(p.mainRunDirectory,'learner-anchor-protocol.json'));
  assert.equal(digest(anchorProtocol),p.anchorProtocolHash);
  const state = await readArchive(path.join(p.mainRunDirectory,'state.json.gz'));
  assert.equal(sha(await fs.readFile(p.originalChampionPath)),p.originalChampionSha256,'Original champion artifact changed');
  const confirmation = await optional(readArchive,path.join(anchorProtocol.comparisonDirectory,'confirmation.json.gz'));
  const {listNodeProcesses,selectTrainingProcesses} = await import('../server/training-dashboard-priority.mjs');
  const {getPriority,constants} = await import('node:os');
  const processes = selectTrainingProcesses(await listNodeProcesses(),p.project);
  const resources = {count:processes.length,maximum:16,allNormal:processes.every(proc => {
    try {return getPriority(proc.pid) === constants.priority.PRIORITY_NORMAL;} catch {return false;}
  })};
  const result = assessTransferReadiness({comparison,state,anchorProtocol,originalChampionPath:p.originalChampionPath,confirmation,resources});
  const source = result.recovery.source;
  if (source) {
    const bytes = await fs.readFile(source.path), adopted = JSON.parse(gunzipSync(bytes));
    if (source.record) {
      const originalBytes = await fs.readFile(source.record.learnerPath);
      verifyAdoptedSource(source,adopted,JSON.parse(gunzipSync(originalBytes)),sha(originalBytes));
      if (source.kind === 'fresh-paired-confirmation') {
        // Reuse the same frozen verifier as the trainer's accepted adoption.
        const manifest = await fs.readFile(plan.runtimeManifest.path);
        assert.equal(sha(manifest),plan.runtimeManifest.sha256);
        for (const item of JSON.parse(manifest))
          assert.equal(sha(await fs.readFile(path.join(plan.runtimeDirectory,item.path))),item.sha256,
            `Frozen recovery verifier changed: ${item.path}`);
        const {assertAnchorEvaluationSchedule,confirmLearningAnchor} = await import(pathToFileURL(
          path.join(plan.runtimeDirectory,'scripts/learning-anchor-selection.mjs')));
        const config = await readJson(path.join(anchorProtocol.comparisonDirectory,'config.json'));
        assert.equal(digest(config),anchorProtocol.comparisonConfigHash);
        assertAnchorEvaluationSchedule(config,confirmation.candidateRows);
        assertAnchorEvaluationSchedule(config,confirmation.referenceRows);
        assert.deepEqual(confirmLearningAnchor(confirmation.candidateRows,confirmation.referenceRows),confirmation.confirmation);
      }
    }
    result.recovery.source = {kind:source.kind,path:source.path,sha256:sha(bytes),generation:unwrap(adopted).generation};
  }
  const starting = await readArchive(path.join(anchorProtocol.comparisonDirectory,'state.json.gz'));
  assert.equal(starting.configHash,anchorProtocol.comparisonConfigHash);
  return {...result,checkedAt:new Date().toISOString(),protocolHash:digest(p),
    startingPointComparison:{completed:starting.completed === true,resultStatus:starting.resultStatus || null},
    main:{committedIteration:state.iteration,branchStartIteration:state.learnerAnchor.branchStartIteration,
      iterationsSinceStart:state.iteration-state.learnerAnchor.branchStartIteration,
      requiredIterations:anchorProtocol.maximumUnverifiedIterations,
      conclusiveInferiorEvaluations:state.learnerAnchor.inferiorEvaluations.length,
      requiredInferiorEvaluations:anchorProtocol.minimumInferiorEvaluations}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  assert.ok(file,'Usage: node scripts/viktor-transfer-readiness.mjs <recovery-first-protocol.json>');
  const output = path.join(path.dirname(path.resolve(file)),'recovery-readiness.json');
  try {
    const result = await inspectTransferReadiness(file);
    const temporary = `${output}.tmp-${process.pid}`;
    await fs.writeFile(temporary,JSON.stringify(result,null,2));
    const {renameWithRetrySync} = await import('./file-replace.mjs');
    renameWithRetrySync(temporary,output);
    console.log(JSON.stringify(result));
  } catch (error) {
    // Replace any previous ready result on failure instead of leaving a stale permission.
    const result = {contract:RECOVERY_FIRST_TRANSFER,checkedAt:new Date().toISOString(),readyForLessonPlan:false,
      mainWeightsMayChange:false,trainingStarted:false,error:error.message};
    await fs.writeFile(output,JSON.stringify(result,null,2));
    console.error(JSON.stringify(result));process.exitCode=1;
  }
}
