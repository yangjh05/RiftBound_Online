import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recoveredTransferSource,assessTransferReadiness,verifyAdoptedSource} from '../scripts/viktor-transfer-readiness.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const protocol={afterIteration:480,maximumUnverifiedIterations:32,minimumInferiorEvaluations:2,comparisonConfigHash:'fixed'};
const state=()=>({iteration:512,learnerPath:'unproven-generation-9000',championPath:'champion',
  learnerAnchor:{protocolHash:digest(protocol),anchorPath:'champion',branchStartIteration:480,history:[]}});
const comparison=()=>({complete:true,completedGames:320,targetGames:320,mirror:{games:64,winRate:.75},
  rows:Array.from({length:4},()=>({role:'viktor',pairedGames:16,completedBlockDeltas:[.25,.25,.25,.25]}))});
const rollback=()=>({iteration:512,adoptedPath:'adopted',learnerPath:'champion',reason:'bounded-branch-repeatedly-inferior',sha256:'hash',
  evidence:{evaluations:[{iteration:486,candidatePath:'a',upperBound:.48},{iteration:499,candidatePath:'b',upperBound:.49}]}});
const recovered=()=>{const s=state();s.learnerAnchor.anchorPath='adopted';s.learnerAnchor.history=[rollback()];return s;};
const check=(s=state(),c=comparison(),resources={count:16,allNormal:true},confirmation=null)=>assessTransferReadiness({
  comparison:c,state:s,anchorProtocol:protocol,originalChampionPath:'champion',confirmation,resources});

test('a new generation and specialist advantage do not bypass recovery',()=>{
  const result=check();assert.equal(result.readyForLessonPlan,false);
  assert.deepEqual(result.reasons,['validated-recovery-not-applied']);
});
test('recovery alone never bypasses an incomplete or unsupported comparison',()=>{
  const partial=comparison();partial.complete=false;partial.completedGames=160;
  assert.equal(check(recovered(),partial).readyForLessonPlan,false);
  const weak=comparison();weak.rows.forEach(r=>r.completedBlockDeltas.fill(0));
  assert.equal(check(recovered(),weak).readyForLessonPlan,false);
});
test('a distinct, conclusive bounded recovery permits planning but never model mutation',()=>{
  const r=check(recovered());assert.equal(r.readyForLessonPlan,true);
  assert.equal(r.recovery.source.path,'adopted');assert.equal(r.mainWeightsMayChange,false);
  assert.equal(r.trainingStarted,false);assert.equal(r.specialistParityEstablished,false);
});
test('duplicate failures, uncertain outcomes and an early return do not qualify',()=>{
  for(const change of [r=>r.evidence.evaluations[1].candidatePath='a',r=>r.evidence.evaluations[1].upperBound=.51,
    r=>r.iteration=511,r=>r.evidence.evaluations[0].iteration=479]){
    const s=recovered();change(s.learnerAnchor.history[0]);assert.equal(check(s).readyForLessonPlan,false);
  }
});
test('confirmed recovery must already be adopted and match the exact accepted experiment',()=>{
  const s=state(),confirmation={configHash:'fixed',candidatePath:'candidate',confirmation:{accepted:true}};
  const record={adoptedPath:'adopted',learnerPath:'candidate',reason:'fresh-paired-confirmation',
    evidence:{configHash:'fixed',comparison:confirmation.confirmation}};
  assert.equal(check(s,comparison(),undefined,confirmation).readyForLessonPlan,false);
  s.learnerAnchor.anchorPath='adopted';s.learnerAnchor.history=[record];
  assert.equal(check(s,comparison(),undefined,confirmation).readyForLessonPlan,true);
  assert.throws(()=>check(s,comparison(),undefined,{...confirmation,configHash:'different'}));
});
test('a real new champion can be a source, but an unadopted learner cannot',()=>{
  const s=state();s.championPath='new-champion';assert.equal(check(s).readyForLessonPlan,false);
  s.learnerAnchor.anchorPath='new-champion';assert.equal(check(s).readyForLessonPlan,true);
  assert.throws(()=>recoveredTransferSource(s,{...protocol,afterIteration:0},'champion',null));
});
test('resource or priority violations prevent a new lesson plan',()=>{
  assert.equal(check(recovered(),comparison(),{count:17,allNormal:true}).readyForLessonPlan,false);
  assert.equal(check(recovered(),comparison(),{count:12,allNormal:false}).readyForLessonPlan,false);
});
test('a source hash, adoption evidence or checkpoint-weight mismatch fails closed',()=>{
  const source={path:'adopted',record:rollback()},original={checkpoint:{generation:1163,weights:[1,2]}};
  const {adoptedPath,...evidence}=source.record;
  const adopted={anchorEvidence:evidence,checkpoint:{generation:1820,weights:[1,2],metadata:{
    learnerAnchorSource:{path:'champion',generation:1163,sha256:'hash'}}}};
  verifyAdoptedSource(source,adopted,original,'hash');
  assert.throws(()=>verifyAdoptedSource(source,adopted,original,'changed'));
  const changed=structuredClone(adopted);changed.checkpoint.weights[0]=9;
  assert.throws(()=>verifyAdoptedSource(source,changed,original,'hash'));
  const forged=structuredClone(adopted);forged.anchorEvidence.reason='other';
  assert.throws(()=>verifyAdoptedSource(source,forged,original,'hash'));
});
