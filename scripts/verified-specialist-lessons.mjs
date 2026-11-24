import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const SPECIALIST_LESSONS = 'independently-verified-specialist-lessons-v1';
export const lessonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Intentionally exclude label, player ID and recurrent memory: changing any of
// these must not allow the same observable decision into both dataset roles.
export const publicInputKey = sample => lessonHash(sample.steps.map(s => [Array.from(s.state), Array.from(s.actions), s.legalCount]));

export function assertCompleteLesson(sample, job) {
  assert.equal(sample.gameId, job.id);
  assert.equal(sample.lessonRole, job.role);
  assert.equal(sample.lessonSource.familyId, job.id);
  assert.equal(sample.lessonSource.role, job.role);
  assert.equal(sample.lessonSource.proof.thresholdsUnchanged, true);
  assert.equal(sample.memoryContext?.contract, 'complete-actor-observation-prefix-v1');
  assert.equal(sample.memoryContext.playerId, sample.playerId);
  assert.equal(sample.memoryContext.fromReset, true);
  assert.ok(Array.isArray(sample.memoryContext.states));
  assert.ok(sample.memoryContext.states.length <= sample.lessonSource.actionCount);
  assert.equal(sample.steps.length, 1);
  const step = sample.steps[0];
  assert.equal(step.imitation, true);
  assert.equal(step.winProbabilityLabel, false);
  assert.ok(step.mulliganLesson || step.growthLesson);
  assert.ok(Number.isInteger(step.selectedIndex) && step.selectedIndex >= 0 && step.selectedIndex < step.legalCount);
}

export function selectVerifiedSpecialistLessons(prefix, job, plan, choose) {
  assert.equal(prefix.familyId, job.id); assert.equal(prefix.role, job.role);
  assert.equal(prefix.terminalLabels, false); assert.equal(prefix.policyOnly, true);
  assert.equal(prefix.teachingRevision, plan.teachingRevision);
  const diagnostics = {teacherAccepted: prefix.samples.length, wrongDeck: 0, specialistDisagreed: 0, parentAlreadyCorrect: 0};
  if (prefix.failure) {
    assert.equal(prefix.samples.length, 0, 'Failed prefixes must discard every label.');
    return {samples: [], diagnostics};
  }
  const samples = [];
  for (const sample of prefix.samples) {
    assertCompleteLesson(sample, job);
    assert.equal(sample.engineFingerprint, plan.engineFingerprint);
    if (sample.deckId !== plan.deckId) { diagnostics.wrongDeck++; continue; }
    const target = sample.steps[0].selectedIndex;
    const {parent, specialist} = choose(sample);
    for (const index of [parent, specialist]) assert.ok(Number.isInteger(index) && index >= 0 && index < sample.steps[0].legalCount);
    if (specialist !== target) { diagnostics.specialistDisagreed++; continue; }
    if (parent === target) { diagnostics.parentAlreadyCorrect++; continue; }
    samples.push({...sample, transferProof: {contract: SPECIALIST_LESSONS,
      parentSha256: plan.models.parent.sha256, specialistSha256: plan.models.specialist.sha256,
      parentChoice: parent, specialistChoice: specialist, independentlyVerifiedTarget: target,
      memoriesReconstructedSeparately: true, specialistChoiceAloneIsNotProof: true}});
  }
  return {samples, diagnostics};
}

export function assertLessonRecord(record, plan, job) {
  const {recordHash, ...body} = record;
  assert.equal(recordHash, lessonHash(body), 'Lesson record content changed.');
  assert.equal(record.planHash, lessonHash(plan), 'Lesson record belongs to another frozen plan.');
  assert.deepEqual(record.job, job, 'Lesson family, seed, seat or role changed.');
  assert.equal(record.teachingRevision, plan.teachingRevision);
  if (record.failure) assert.equal(record.samples.length, 0);
  for (const sample of record.samples) {
    assertCompleteLesson(sample, job);
    assert.equal(sample.deckId, plan.deckId);
    assert.equal(sample.engineFingerprint, plan.engineFingerprint);
    const p = sample.transferProof;
    assert.equal(p.contract, SPECIALIST_LESSONS);
    assert.equal(p.parentSha256, plan.models.parent.sha256);
    assert.equal(p.specialistSha256, plan.models.specialist.sha256);
    assert.equal(p.memoriesReconstructedSeparately, true);
    assert.equal(p.specialistChoiceAloneIsNotProof, true);
    assert.equal(p.specialistChoice, sample.steps[0].selectedIndex);
    assert.equal(p.independentlyVerifiedTarget, sample.steps[0].selectedIndex);
    assert.notEqual(p.parentChoice, sample.steps[0].selectedIndex);
  }
  return record;
}

export function splitVerifiedLessons(records, protectedValidationKeys = []) {
  const all = records.flatMap(r => r.samples);
  const validationKeys = new Set([...protectedValidationKeys,
    ...all.filter(s => s.lessonRole === 'validation').map(publicInputKey)]);
  const seen = new Set(), training = [], validation = [];
  let excluded = 0;
  for (const sample of all) {
    const key = publicInputKey(sample), role = sample.lessonRole;
    assert.ok(['training', 'validation'].includes(role));
    if ((role === 'training' && validationKeys.has(key)) || seen.has(`${role}:${key}`)) { excluded++; continue; }
    seen.add(`${role}:${key}`); (role === 'training' ? training : validation).push(sample);
  }
  return {training, validation, excluded};
}
