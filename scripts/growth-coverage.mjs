import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const inputKey=s=>digest(s.steps.map(t=>{
 assert.ok(Array.isArray(t.state)||ArrayBuffer.isView(t.state),'Decode archived state before computing input identity.');
 assert.ok(Array.isArray(t.actions)||ArrayBuffer.isView(t.actions),'Decode archived actions before computing input identity.');
 return [Array.from(t.state),Array.from(t.actions),t.legalCount];
}));
export function selectGrowthTraining(record,{deckId,protectedKeys,seen}){
 assert.equal(record.role,'training');assert.equal(record.policyOnly,true);assert.equal(record.terminalLabels,false);
 if(record.failure){assert.equal(record.samples.length,0);throw Error(`Collection failed: ${record.failure}`);}
 const accepted=[],counts={wrongDeck:0,notGrowth:0,protected:0,duplicate:0};
 for(const sample of record.samples){
  assert.equal(sample.lessonRole,'training');assert.equal(sample.lessonSource.role,'training');
  assert.equal(sample.lessonSource.proof.thresholdsUnchanged,true);
  assert.equal(sample.memoryContext?.contract,'complete-actor-observation-prefix-v1');
  assert.equal(sample.memoryContext.fromReset,true);assert.equal(sample.memoryContext.playerId,sample.playerId);
  assert.equal(sample.steps.length,1);assert.equal(sample.steps[0].imitation,true);assert.equal(sample.steps[0].winProbabilityLabel,false);
  if(sample.deckId!==deckId){counts.wrongDeck++;continue;}
  if(!sample.steps[0].growthLesson){counts.notGrowth++;continue;}
  const key=inputKey(sample);
  if(protectedKeys.has(key)){counts.protected++;continue;}
  if(seen.has(key)){counts.duplicate++;continue;}
  seen.add(key);accepted.push(sample);
 }
 return {accepted,counts};
}
