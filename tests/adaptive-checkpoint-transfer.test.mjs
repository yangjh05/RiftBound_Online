import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyAdaptiveCheckpointTransfer,ADAPTIVE_CHECKPOINT_TRANSFER} from '../scripts/adaptive-checkpoint-transfer.mjs';

test('changed policy action set transfers an exact checkpoint with no relabeled evidence',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'riftbound-transfer-'));
 try {
  const source=path.join(root,'source.json'),input=path.join(root,'input.json');
  const contents='{"weights":"test-only-checkpoint-bytes"}';
  await writeFile(source,contents);await writeFile(input,contents);
  const config={learnerPath:input,engineFingerprint:'sha256:'+ 'a'.repeat(64),checkpointTransfer:{
   contract:ADAPTIVE_CHECKPOINT_TRANSFER,sourceEngineFingerprint:'sha256:'+'b'.repeat(64),
   sourceCheckpointPath:source,sourceRunDirectory:root,evaluationOrdinal:5,
   sourceCheckpointSha256:createHash('sha256').update(contents).digest('hex')}};
  const result=await verifyAdaptiveCheckpointTransfer(config);
  assert.deepEqual(result.training,[]);assert.deepEqual(result.validation,[]);
  assert.equal(result.oldTrajectoriesRelabeled,false);
  await writeFile(input,contents+' ');
  await assert.rejects(verifyAdaptiveCheckpointTransfer(config),/contents changed/);
  config.checkpointTransfer.evaluationOrdinal=-1;
  await assert.rejects(verifyAdaptiveCheckpointTransfer(config),/Invalid/);
 } finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith('riftbound-transfer-'));
  await rm(root,{recursive:true,force:true});
 }
});
test('ordinary adaptive runs retain the existing bootstrap path',async()=>{
 assert.equal(await verifyAdaptiveCheckpointTransfer({}),null);
});
