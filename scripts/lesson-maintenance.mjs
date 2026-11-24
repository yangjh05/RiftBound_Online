import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {trainBehaviorCloningBatch,inferStep} from '../src/ai/neural/model.mjs';
import {packPpoBatch} from '../src/ai/neural/trainer.mjs';
import {resolveLessonMemory,contextualLessonSamples} from './lesson-memory-context.mjs';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {LESSON_FLAGS,assertLessonSample,lessonTypes,lessonInputKey,tacticalLessonDigest,
  measureLessonTypes,tacticalLessonGuard} from './tactical-lesson-learning.mjs';

export const LESSON_MAINTENANCE_CONTRACT='prospective-ppo-lesson-retention-v1';
const heads=['stateProjection','actionProjection','actionBias'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export async function readLessonMaintenance(root){
  let p;try{p=JSON.parse(await readFile(path.join(root,'lesson-maintenance-protocol.json'),'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  assert.equal(p.contract,LESSON_MAINTENANCE_CONTRACT);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.equal(p.roundsPerEpoch,2);assert.equal(p.maximumStep,.0003);assert.equal(p.backtracks,6);
  assert.equal(p.validationProbabilityFloorRatio,.99);
  assert.match(p.lessonProtocolHash,/^[a-f0-9]{64}$/);assert.match(p.evaluationManifestSha256,/^[a-f0-9]{64}$/);
  assert.ok(path.isAbsolute(p.evaluationRuntime));assert.ok(path.isAbsolute(p.evaluationManifest));
  return p;
}
export function commitLessonMaintenance(state,p){
  const hash=p?tacticalLessonDigest(p):null;
  if(state.lessonMaintenanceHash)assert.equal(hash,state.lessonMaintenanceHash,'Lesson maintenance changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Lesson maintenance must start prospectively.');
    assert.equal(p.lessonProtocolHash,state.tacticalLessonLearningHash);state.lessonMaintenanceHash=hash;}
}
// A learning update cannot silently change the running match's rule/review
// implementation. Its old executable and every dependency remain pinned.
export async function maintenanceEvaluationRuntime(p){
  if(!p)return null;
  const bytes=await readFile(p.evaluationManifest);assert.equal(sha(bytes),p.evaluationManifestSha256);
  for(const item of JSON.parse(bytes)){
    const relative=path.relative(p.evaluationRuntime,path.resolve(p.evaluationRuntime,item.path));
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
    assert.equal(sha(await readFile(path.join(p.evaluationRuntime,item.path))),item.sha256,item.path);
  }
  const review=await import(pathToFileURL(path.join(p.evaluationRuntime,'scripts/evaluation-decision-review.mjs')));
  return {entry:path.join(p.evaluationRuntime,'scripts/train-adaptive-policy-q.mjs'),readReview:review.readEvaluationReviewRollout};
}

export const snapshotLessonHeads=model=>Object.fromEntries(heads.map(name=>[name,model.layers[name].getWeights().map(w=>w.clone())]));
export const restoreLessonHeads=(model,snapshot)=>{for(const [name,weights] of Object.entries(snapshot))model.layers[name].setWeights(weights);};
export const disposeLessonHeads=snapshot=>{for(const weights of Object.values(snapshot))weights.forEach(w=>w.dispose());};

export function measureLessonRetention(model,samples){
  // Reuse the very same forward result for loss and choice retention. A
  // second inference cannot add evidence and doubled every validation pass.
  const decisions=new Map();
  const types=measureLessonTypes(model,samples,{onDecision:(sample,correct)=>decisions.set(sample,correct)});
  return {types,correct:samples.map(sample=>{
    if(decisions.has(sample))return decisions.get(sample);
    const s=sample.steps[0],logits=inferStep(model,s.state,s.actions,s.legalCount,resolveLessonMemory(model,sample)).logits;
    assert.ok(logits.every(Number.isFinite));return logits.indexOf(Math.max(...logits))===s.selectedIndex;
  })};
}
export function lessonSafetyGuard(before,after){
  const failures=[];let lossBefore=0,lossAfter=0,count=0;
  if(before.correct.length!==after.correct.length)failures.push('coverage');
  else if(before.correct.some((correct,i)=>correct&&!after.correct[i]))failures.push('previously-correct-choice');
  for(const type of Object.keys(LESSON_FLAGS)){
    const a=before.types[type],b=after.types[type];
    if(!a||!b||a.decisions!==b.decisions){failures.push(`${type}:coverage`);continue;}
    if(!a.decisions)continue;
    if(!Number.isFinite(a.policyLoss)||!Number.isFinite(b.policyLoss)){failures.push(`${type}:nonfinite`);continue;}
    // A fixed one-percent geometric target-probability margin is a confidence
    // tolerance, never permission to lose a previously correct decision.
    if(b.policyLoss>a.policyLoss-Math.log(.99)+1e-7)failures.push(`${type}:confidence`);
    lossBefore+=a.policyLoss;lossAfter+=b.policyLoss;count++;
  }
  if(count&&lossAfter>lossBefore+1e-7)failures.push('balanced-loss');
  return {passed:!failures.length,failures};
}

// Minimum-norm convex combination of normalized task gradients. The result
// must be a descent direction for EVERY training type; a conflicting average
// is never applied merely because a larger category overwhelms a smaller one.
export function commonGradientWeights(gram){
  const n=gram.length;if(!n)return [];
  assert.ok(gram.every(row=>row.length===n&&row.every(Number.isFinite)));
  let weights=Array(n).fill(1/n);
  for(let step=0;step<128;step++){
    const dots=gram.map(row=>row.reduce((s,x,j)=>s+x*weights[j],0));
    const norm=dots.reduce((s,x,i)=>s+x*weights[i],0),minimum=Math.min(...dots),index=dots.indexOf(minimum);
    if(norm-minimum<1e-10)break;
    const denominator=norm-2*minimum+gram[index][index];
    if(denominator<=1e-14)break;
    const rate=Math.max(0,Math.min(1,(norm-minimum)/denominator));
    weights=weights.map((x,i)=>(1-rate)*x+(i===index?rate:0));
  }
  const dots=gram.map(row=>row.reduce((s,x,j)=>s+x*weights[j],0));
  return dots.some(x=>x < -1e-8)?null:weights;
}

function typeGradient(model,samples){
  const sums=new Map();let count=0;
  // Accumulate a true mean at one fixed set of weights. No Adam moments or
  // serial minibatch updates can let the final lesson type overwrite others.
  for(let start=0;start<samples.length;start+=8){
    const items=contextualLessonSamples(model,samples.slice(start,start+8)).map(s=>({...s,steps:s.steps.map(step=>({...step,advantage:1}))}));
    const recorder={minimize(fn,_returnCost,variables){
      const {value,grads}=tf.variableGrads(fn,variables);
      try{for(const variable of variables){
        const gradient=grads[variable.name];assert.ok(gradient,'Missing lesson gradient');
        const data=gradient.dataSync();assert.ok(data.every(Number.isFinite),'Nonfinite lesson gradient');
        if(!sums.has(variable.name))sums.set(variable.name,{variable,values:new Float64Array(data.length)});
        const sum=sums.get(variable.name).values;for(let i=0;i<data.length;i++)sum[i]+=data[i]*items.length;
      }}finally{Object.values(grads).forEach(g=>g.dispose());}
      return value;
    }};
    const metrics=trainBehaviorCloningBatch(model,packPpoBatch(items),recorder,{policyInitializationOnly:true,
      valueCoefficient:0,beliefCoefficient:0,entropyCoefficient:0});
    assert.ok(Number.isFinite(metrics.loss));count+=items.length;
  }
  let norm=0;for(const {values} of sums.values())for(let i=0;i<values.length;i++){values[i]/=count;norm+=values[i]**2;}
  norm=Math.sqrt(norm);
  if(norm<1e-12)return null;
  for(const {values} of sums.values())for(let i=0;i<values.length;i++)values[i]/=norm;
  return sums;
}

export function commonLessonStep(model,bank,{maximumStep=.0003,backtracks=6}={}){
  for(const s of bank.training)assertLessonSample(s,'training');
  const held=new Set([...(bank.protectedValidationKeys||[]),...bank.validation.map(lessonInputKey)]);
  assert.ok(bank.training.every(s=>!held.has(lessonInputKey(s))),'Training bank overlaps protected validation.');
  const groups=Object.keys(LESSON_FLAGS).map(type=>bank.training.filter(s=>lessonTypes(s).includes(type))).filter(a=>a.length);
  const gradients=groups.map(group=>typeGradient(model,group)).filter(Boolean);
  const dot=(a,b)=>{let total=0;for(const [name,{values}] of a){const other=b.get(name).values;for(let i=0;i<values.length;i++)total+=values[i]*other[i];}return total;};
  const weights=commonGradientWeights(gradients.map(a=>gradients.map(b=>dot(a,b))));
  if(!weights?.length)return {applied:false,reason:'no-common-training-descent'};
  const direction=new Map();let maximum=0;
  for(const [name,{variable,values}] of gradients[0]){
    const combined=new Float32Array(values.length);
    for(let i=0;i<combined.length;i++){combined[i]=gradients.reduce((sum,g,k)=>sum+weights[k]*g.get(name).values[i],0);maximum=Math.max(maximum,Math.abs(combined[i]));}
    direction.set(name,{variable,values:combined,original:variable.clone()});
  }
  const before=measureLessonTypes(model,bank.training);let result={applied:false,reason:'no-safe-training-step'};
  try{
    if(maximum<1e-12)return result;
    for(let attempt=0;attempt<backtracks;attempt++){
      const step=maximumStep*2**(-attempt)/maximum;
      for(const {variable,values,original} of direction.values())tf.tidy(()=>variable.assign(tf.sub(original,tf.mul(tf.tensor(values,variable.shape),step))));
      const after=measureLessonTypes(model,bank.training),guard=tacticalLessonGuard(before,after);
      if(guard.passed&&Object.keys(LESSON_FLAGS).some(t=>after[t].decisions&&after[t].policyLoss<before[t].policyLoss-1e-8)){
        result={applied:true,attempts:attempt+1,weights,trainingGuard:guard};return result;
      }
    }
    return result;
  }finally{
    if(!result.applied)for(const {variable,original} of direction.values())variable.assign(original);
    for(const {original} of direction.values())original.dispose();
  }
}

export async function freezePpoLessons(root,directory,iteration,p,engineFingerprint){
  if(!p||iteration<=p.afterIteration)return null;
  const file=path.join(directory,'ppo-lesson-bank.json.gz'),protocolHash=tacticalLessonDigest(p);
  let saved=await optional(file);
  if(!saved){
    const folders=(await readdir(path.join(root,'tactical-refresh'))).filter(n=>/^\d{6}$/.test(n)&&Number(n)<=iteration).sort().reverse();
    for(const folder of folders){
      const source=path.join(root,'tactical-refresh',folder,'lesson-bank.json.gz');
      if(!await optional(path.join(root,'tactical-refresh',folder,'checkpoint.json.gz')))continue;
      const bank=await optional(source);if(!bank)continue;
      assert.equal(bank.engineFingerprint,engineFingerprint);assert.equal(bank.protocolHash,p.lessonProtocolHash);
      assert.equal(bank.samplesHash,tacticalLessonDigest([bank.training,bank.validation]));
      saved={contract:LESSON_MAINTENANCE_CONTRACT,iteration,protocolHash,source,sourceSha256:sha(await readFile(source)),bank};
      await writeTrajectoryArchive(file,saved);break;
    }
    assert.ok(saved,'No completed, verified lesson bank is available for retention.');
  }
  assert.equal(saved.contract,LESSON_MAINTENANCE_CONTRACT);assert.equal(saved.protocolHash,protocolHash);assert.equal(saved.iteration,iteration);
  assert.equal(sha(await readFile(saved.source)),saved.sourceSha256,'Retention source changed.');
  assert.equal(tacticalLessonDigest(saved.bank),tacticalLessonDigest(await readTrajectoryArchive(saved.source)),'Frozen retention bank changed.');
  for(const s of saved.bank.training)assertLessonSample(s,'training');
  for(const s of saved.bank.validation)assertLessonSample(s,'validation');
  assert.equal(saved.bank.samplesHash,tacticalLessonDigest([saved.bank.training,saved.bank.validation]));
  return saved;
}

export function ppoLessonRetention(model,sourceModel,frozen,p){
  if(!frozen)return null;
  const bank=frozen.bank,before=measureLessonRetention(sourceModel,bank.validation),trainingBefore=measureLessonTypes(sourceModel,bank.training);
  let report=null;
  return {
    beforeEpochGuard(){
      const rounds=[];
      for(let i=0;i<p.roundsPerEpoch;i++)rounds.push(commonLessonStep(model,bank,p));
      report={contract:LESSON_MAINTENANCE_CONTRACT,source:frozen.source,sourceSha256:frozen.sourceSha256,
        rounds,before,after:measureLessonRetention(model,bank.validation),trainingBefore,trainingAfter:measureLessonTypes(model,bank.training),heldOutLabelsTrained:false};
    },
    epochGuard(){
      assert.ok(report,'Lesson rehearsal was not executed.');
      const validation=lessonSafetyGuard(before,report.after),training=tacticalLessonGuard(trainingBefore,report.trainingAfter);
      return {passed:validation.passed&&training.passed,validation,training,report};
    }
  };
}
