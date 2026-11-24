import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readTrajectoryArchive, writeTrajectoryArchive } from '../src/ai/neural/archive.mjs';
import { validIndependentLeafValueReference } from '../src/ai/neural/action-ranking-reference.mjs';
import { readLiveFileLockOwner, withFileLock } from './file-lock.mjs';
import { rebuildHeldOutLeafEvidence } from './detached-leaf-audit.mjs';
import { AUDIT_ROLE_COMPATIBILITY } from './adaptive-audit-role.mjs';

const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
async function backupOnce(source, target) {
  try { await copyFile(source, target, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export async function repairPolicyQValidation(directory, { apply = false, onProgress = () => {} } = {}) {
  const root = path.resolve(directory), lock = path.join(root, 'controller.lock');
  assert.equal(await readLiveFileLockOwner(lock), null, 'Stop the controller at a committed boundary before repairing evidence.');
  return withFileLock(lock, async () => {
    const stateFile = path.join(root, 'state.json.gz'), stateBeforeHash = await hash(stateFile);
    const state = await readTrajectoryArchive(stateFile);
    const backup = path.join(root, 'repairs', AUDIT_ROLE_COMPATIBILITY);
    if (apply) {
      await mkdir(backup, { recursive: true });
      await backupOnce(stateFile, path.join(backup, 'state.before.json.gz'));
    }
    const report = { contract: AUDIT_ROLE_COMPATIBILITY, at: new Date().toISOString(), applied: apply,
      iteration: state.iteration, records: 0, recoveredComparisons: 0, usableGamesBefore: 0,
      usableGamesAfter: 0, stillUnavailable: 0, newRollouts: 0, stateBeforeHash, entries: [] };
    for (const record of state.freshEvidence.filter(item => item.role === 'validation' && item.sidecars?.length)) {
      report.records++;
      if (record.usableAuditCount > 0) report.usableGamesBefore++;
      let usable = 0;
      for (const file of record.sidecars) {
        const evidence = await readTrajectoryArchive(file);
        const planFile = path.join(path.dirname(file), 'plan.json.gz');
        const plan = await readTrajectoryArchive(planFile);
        assert.equal(path.resolve(plan.sourceArchivePath), path.resolve(record.archivePath));
        assert.equal(path.resolve(file), path.join(path.resolve(plan.root), 'evidence.json.gz'));
        const payload = await readTrajectoryArchive(plan.candidatePath);
        assert.equal(payload.candidateId, plan.candidateId);
        assert.deepEqual(payload.candidate.recordedStepLocator, plan.locator);
        assert.equal(payload.candidate.engineFingerprint, plan.engineFingerprint);
        if (evidence.reference) {
          assert.ok(validIndependentLeafValueReference(evidence.reference));
          usable++; continue;
        }
        // A null result with the corrected role can legitimately have no
        // completed terminal continuations; do not invent evidence for it.
        if (payload.candidate.descriptor.samplingFrame?.certificationRole !== 'validation') {
          report.stillUnavailable++; continue;
        }
        const beforeHash = await hash(file), planHash = await hash(planFile), snapshotHash = await hash(plan.candidatePath);
        const result = await rebuildHeldOutLeafEvidence(plan, payload.candidate, evidence);
        if (result.evidence.reference) usable++;
        if (result.changed) {
          report.recoveredComparisons++;
          if (apply) {
            await backupOnce(file, path.join(backup, `${plan.candidateId}.before.json.gz`));
            assert.equal(await hash(file), beforeHash, 'Evidence changed during repair.');
            await writeTrajectoryArchive(file, result.evidence);
          }
        } else report.stillUnavailable++;
        assert.equal(await hash(planFile), planHash, 'Committed plan was modified.');
        assert.equal(await hash(plan.candidatePath), snapshotHash, 'Committed snapshot was modified.');
        report.entries.push({ file, beforeHash, afterHash: await hash(file), changed: result.changed,
          sourceHash: plan.sourceHash, planHash, snapshotHash });
      }
      if (usable > 0) report.usableGamesAfter++;
      record.usableAuditCount = usable;
      onProgress({ records: report.records, recoveredComparisons: report.recoveredComparisons });
    }
    if (apply) {
      assert.equal(await hash(stateFile), stateBeforeHash, 'State changed during offline repair.');
      await writeTrajectoryArchive(stateFile, state);
      report.stateAfterHash = await hash(stateFile);
      const reportFile = path.join(backup, `report-${Date.now()}.json`);
      await writeFile(reportFile, JSON.stringify(report, null, 2));
      report.reportFile = reportFile;
    }
    return report;
  }, { timeoutMs: 1000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Usage: node scripts/repair-policy-q-validation.mjs <run-directory> [--apply]');
  const result = await repairPolicyQValidation(process.argv[2], { apply: process.argv.includes('--apply'),
    onProgress: progress => { if (progress.records % 20 === 0) console.log(JSON.stringify({ progress })); } });
  console.log(JSON.stringify({ ...result, entries: undefined }));
}
