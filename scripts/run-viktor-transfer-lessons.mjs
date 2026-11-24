import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {SPECIALIST_LESSONS, lessonHash, selectVerifiedSpecialistLessons, assertLessonRecord, splitVerifiedLessons} from './verified-specialist-lessons.mjs';

const [planFile, mode = 'report'] = process.argv.slice(2);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const plan = read(planFile), root = path.dirname(path.resolve(planFile)), planHash = lessonHash(plan);
assert.equal(plan.contract, SPECIALIST_LESSONS);
assert.ok(['run', 'preflight', 'report'].includes(mode));
for (const [file, hash] of Object.entries(plan.executionFiles))
  assert.equal(sha(path.join(path.dirname(fileURLToPath(import.meta.url)), file)), hash, 'Frozen collector changed.');
const load = file => import(pathToFileURL(path.join(plan.runtimeDirectory, file)).href);
const {renameWithRetrySync} = await load('scripts/file-replace.mjs');
const {readTrajectoryArchive, writeTrajectoryArchive} = await load('src/ai/neural/archive.mjs');
const write = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); renameWithRetrySync(tmp, file); };
const status = (stage, extra = {}) => write(path.join(root, mode === 'preflight' ? 'preflight.json' : 'controller.json'),
  {planHash, pid: process.pid, at: new Date().toISOString(), stage, ...extra});
const recordFile = job => path.join(root, 'families', `${job.id}.json.gz`);
const readRecords = async () => {
  const records = [];
  for (const job of plan.schedule) if (fs.existsSync(recordFile(job)))
    records.push(assertLessonRecord(await readTrajectoryArchive(recordFile(job)), plan, job));
  return records;
};
async function report() {
  const records = await readRecords(), split = splitVerifiedLessons(records, plan.protectedValidation.keys);
  const result = {contract: SPECIALIST_LESSONS, planHash, at: new Date().toISOString(),
    completedFamilies: records.length, targetFamilies: plan.schedule.length,
    failedFamilies: records.filter(r => r.failure).map(r => ({id: r.job.id, failure: r.failure})),
    teacherAccepted: records.reduce((n, r) => n + r.selection.teacherAccepted, 0),
    verifiedSpecialistMatches: records.reduce((n, r) => n + r.samples.length, 0),
    training: split.training.length, validation: split.validation.length, duplicateInputsExcluded: split.excluded,
    diagnostics: records.reduce((d, r) => {for (const [k, v] of Object.entries(r.selection)) d[k] = (d[k] || 0) + v; return d;}, {}),
    trainingStarted: false, mainWeightsChanged: false, specialistParityEstablished: false,
    scope: 'Verified opening/growth corrections only; not a demonstration of complete Viktor skill',
    files: records.map(r => ({path: recordFile(r.job), sha256: sha(recordFile(r.job))}))};
  write(path.join(root, 'report.json'), result);
  if (records.length === plan.schedule.length) await writeTrajectoryArchive(path.join(root, 'lessons.json.gz'),
    {contract: SPECIALIST_LESSONS, planHash, models: plan.models, ...split, sourceFiles: result.files});
  return result;
}
if (mode === 'report') { console.log(JSON.stringify(await report())); }
else {
  const {withFileLock} = await load('scripts/file-lock.mjs');
  await withFileLock(path.join(root, 'controller.lock'), async () => {
    const models = {};
    const reservationFile = path.join(plan.mainRunDirectory, 'side-training-reservation.json');
    try {
      status('verifying-inputs');
      assert.equal(os.getPriority(process.pid), os.constants.priority.PRIORITY_NORMAL);
      assert.equal(sha(plan.runtimeManifest.path), plan.runtimeManifest.sha256);
      for (const item of read(plan.runtimeManifest.path))
        assert.equal(sha(path.join(plan.runtimeDirectory, item.path)), item.sha256, `Runtime changed: ${item.path}`);
      const {computeEngineFingerprint} = await load('scripts/training-safety.mjs');
      assert.equal(computeEngineFingerprint(), plan.engineFingerprint);
      const {deserializeNeuralModel, disposeNeuralModel, inferStep} = await load('src/ai/neural/model.mjs');
      const {assertAdaptiveCheckpoint} = await load('scripts/adaptive-policy-q-evidence.mjs');
      const {assertLegalTrainingDeck} = await load('src/ai/legal-decks.mjs');
      const {assertLessonSample} = await load('scripts/tactical-lesson-learning.mjs');
      const {resolveLessonMemory} = await load('scripts/lesson-memory-context.mjs');
      const {createSupplyGame, collectSupplyPrefix, LESSON_SUPPLY_LIMITS} = await load('scripts/tactical-lesson-supply.mjs');
      const {TACTICAL_TEACHING_REVISION} = await load('scripts/response-aware-demonstration.mjs');
      const {activeActorId, enumerateAiPolicyActions} = await load('src/ai/actions.mjs');
      const {encodeState, encodeActionSet, ACTION_DIM} = await load('src/ai/neural/encoding.mjs');
      assert.equal(plan.teachingRevision, TACTICAL_TEACHING_REVISION);
      assert.deepEqual(plan.limits, LESSON_SUPPLY_LIMITS);
      assert.equal(plan.responseContext.catalogHash, lessonHash(plan.responseContext.profiles));
      assert.equal(new Set(plan.schedule.map(j => j.seed)).size, plan.schedule.length);
      for (const deck of Object.values(plan.decks)) assertLegalTrainingDeck(deck);
      for (const job of plan.schedule) assert.ok(!plan.protectedSeeds.includes(job.seed), 'Evaluation seed reused.');
      for (const [name, identity] of Object.entries(plan.models)) {
        assert.equal(sha(identity.path), identity.sha256);
        const payload = await readTrajectoryArchive(identity.path), checkpoint = payload.candidateCheckpoint || payload.checkpoint || payload;
        assertAdaptiveCheckpoint(checkpoint); models[name] = deserializeNeuralModel(checkpoint);
        assert.equal(models[name].generation, identity.generation);
      }
      try {
        const job = plan.schedule[0], game = createSupplyGame(job.deckIds.map(id => plan.decks[id]), job.seed, job.chooser);
        const id = activeActorId(game), state = encodeState(game, id), actions = encodeActionSet(game, id, enumerateAiPolicyActions(game, id));
        for (const model of Object.values(models)) {
          const result = inferStep(model, state, actions.encoded.slice(0, actions.legalCount * ACTION_DIM), actions.legalCount);
          assert.ok(result.logits.length === actions.legalCount && result.logits.every(Number.isFinite));
        }
        if (mode === 'preflight') { status('passed', {models: plan.models, runtimeFilesVerified: read(plan.runtimeManifest.path).length}); return; }
        const choose = sample => {
          assertLessonSample(sample, sample.lessonRole);
          const step = sample.steps[0], output = {};
          for (const [name, model] of Object.entries(models)) {
            const memory = resolveLessonMemory(model, sample);
            const {logits} = inferStep(model, step.state, step.actions, step.legalCount, memory);
            assert.ok(logits.every(Number.isFinite));
            output[name] = logits.reduce((best, value, i) => value > logits[best] ? i : best, 0);
          }
          return output;
        };
        fs.mkdirSync(path.join(root, 'families'), {recursive: true});
        for (const job of plan.schedule) {
          assert.equal(lessonHash(read(reservationFile)), plan.reservationHash, 'Capacity reservation changed.');
          if (fs.existsSync(recordFile(job))) { assertLessonRecord(await readTrajectoryArchive(recordFile(job)), plan, job); continue; }
          if (fs.existsSync(path.join(root, 'stop.request.json'))) { status('paused'); return; }
          status('collecting', {family: job.id, role: job.role});
          const prefix = collectSupplyPrefix({game: createSupplyGame(job.deckIds.map(id => plan.decks[id]), job.seed, job.chooser),
            model: models.parent, paymentModel: models.parent, role: job.role, familyId: job.id, deckIds: job.deckIds,
            engineFingerprint: plan.engineFingerprint, origin: 'fresh-independent-parent-trajectory',
            protocol: plan.limits, responseContext: plan.responseContext});
          const selected = selectVerifiedSpecialistLessons(prefix, job, plan, choose);
          const record = {planHash, job, teachingRevision: plan.teachingRevision, failure: prefix.failure,
            diagnostics: prefix.diagnostics, selection: selected.diagnostics, samples: selected.samples};
          record.recordHash = lessonHash(record);
          assertLessonRecord(record, plan, job);
          await writeTrajectoryArchive(recordFile(job), record);
          const progress = await report();
          status('family-saved', {family: job.id, completedFamilies: progress.completedFamilies,
            training: progress.training, validation: progress.validation, failedFamilies: progress.failedFamilies.length});
          globalThis.gc?.();
        }
        const result = await report(); status('completed', {completedFamilies: result.completedFamilies, training: result.training, validation: result.validation});
      } finally { for (const model of Object.values(models)) disposeNeuralModel(model); }
    } catch (error) { status('failed', {error: error.stack || String(error)}); throw error; }
    finally {
      if (mode === 'run') {
        const current = read(reservationFile);
        if (lessonHash(current) === plan.reservationHash) {
          const own = current.additionalReservations.filter(r => path.resolve(r.directory) === root);
          assert.equal(own.length, 1); assert.equal(own[0].slots, 1);
          const next = {...current, slots: current.slots - 1,
            additionalReservations: current.additionalReservations.filter(r => path.resolve(r.directory) !== root)};
          if (!next.additionalReservations.length) delete next.additionalReservations;
          write(reservationFile, next);
          write(path.join(root, 'reservation-release.json'), {released: true, at: new Date().toISOString()});
        } else write(path.join(root, 'reservation-release.json'), {released: false, reason: 'Another reservation changed; preserve it for explicit reconciliation.'});
      }
    }
  }, {timeoutMs: 1000});
}
