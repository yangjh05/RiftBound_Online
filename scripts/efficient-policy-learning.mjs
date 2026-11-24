import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readTrajectoryArchive as read,writeTrajectoryArchive as write} from '../src/ai/neural/archive.mjs';
import {tacticalLessonDigest,tacticalLessonGuard} from './tactical-lesson-learning.mjs';
import {measureLessonRetention,lessonSafetyGuard} from './lesson-maintenance.mjs';
import {policyRehearsalSchedule,interpolateEpochWeights,JOINT_POLICY_LEARNING,additionalAcceptance} from './joint-policy-learning.mjs';
import {blockPpoLessonRetention} from './ppo-block-recovery.mjs';
import {trainingLossDirections,applyTrainingProjection} from './ppo-training-projection.mjs';

export const EFFICIENT_POLICY_LEARNING='prospective-training-conflict-projection-v1';
export function validateEfficientPolicyLearning(p){
 assert.equal(p.contract,EFFICIENT_POLICY_LEARNING);assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
 for(const key of ['jointLearningHash','blockRecoveryHash'])assert.match(p[key],/^[a-f0-9]{64}$/);
 assert.equal(p.minimumDescentRatio,.01);assert.deepEqual(p.fractions,[1,.5,.25,.125,.0625,.03125,.015625]);
 assert.equal(p.refreshFailuresBeforeSkip,2);assert.equal(p.maximumConsecutiveRefreshSkips,1);return p;
}
export async function readEfficientPolicyLearning(root){
 let p;try{p=JSON.parse(await readFile(path.join(root,'efficient-policy-learning-protocol.json'),'utf8'));}
 catch(e){if(e.code==='ENOENT')return null;throw e;}return validateEfficientPolicyLearning(p);
}
export function commitEfficientPolicyLearning(state,p){
 const hash=p?tacticalLessonDigest(validateEfficientPolicyLearning(p)):null;
 if(state.efficientPolicyLearningHash)assert.equal(hash,state.efficientPolicyLearningHash,'Efficient learning changed or removed.');
 else if(p){assert.ok(p.afterIteration>=state.iteration,'Efficient learning must start prospectively.');
  assert.equal(p.jointLearningHash,state.jointPolicyLearningHash);assert.equal(p.blockRecoveryHash,state.ppoBlockRecoveryHash);state.efficientPolicyLearningHash=hash;}
}
const snapshot=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const restore=(m,s)=>{for(const [n,w]of Object.entries(s))m.layers[n].setWeights(w);};
const release=s=>Object.values(s).flat().forEach(w=>w.dispose());
export function efficientPpoLessonRetention(model,source,frozen,maintenance,joint,block,p,{legacyRecovery=true,maximumProjectionNormRatio=Infinity,additionalGuard=null}={}){
 validateEfficientPolicyLearning(p);assert.equal(p.jointLearningHash,tacticalLessonDigest(joint));assert.equal(p.blockRecoveryHash,tacticalLessonDigest(block));
 const bank=frozen.bank,rehearsal=policyRehearsalSchedule(bank,joint,model),before=measureLessonRetention(source,bank.validation),trainingBefore=measureLessonRetention(source,bank.training);
 let result=null,fallback=null;
 return {
  policyRehearsalForBatch:rehearsal,
  beforeEpochGuard(args){
   assert.ok(args.epochStartWeights);const raw=snapshot(model),started=performance.now(),attempts=[];let projected;
   try{
    restore(model,args.epochStartWeights);
    const directions=trainingLossDirections(model,bank);
    restore(model,raw);
    const projection=applyTrainingProjection(model,args.epochStartWeights,raw,directions);
    if(projection.feasible&&projection.projectedNorm<=maximumProjectionNormRatio*projection.stepNorm){
     projected=snapshot(model);
     for(const fraction of p.fractions){
      interpolateEpochWeights(model,args.epochStartWeights,projected,fraction);
      const trainingAfter=measureLessonRetention(model,bank.training),training=tacticalLessonGuard(trainingBefore.types,trainingAfter.types);
      const lost=trainingBefore.correct.filter((x,i)=>x&&!trainingAfter.correct[i]).length;
      if(!training.passed||lost){attempts.push({fraction,passed:false,training,lostTrainingChoices:lost,validation:null});continue;}
      const after=measureLessonRetention(model,bank.validation),validation=lessonSafetyGuard(before,after);
      const acceptance=additionalAcceptance({passed:validation.passed},additionalGuard),{passed}=acceptance;
      attempts.push({fraction,...acceptance,training,lostTrainingChoices:lost,validation});
      if(passed){
       result={...acceptance,validation,training,report:{contract:JOINT_POLICY_LEARNING,protocolHash:tacticalLessonDigest(joint),source:frozen.source,sourceSha256:frozen.sourceSha256,
        before,after,trainingBefore:trainingBefore.types,trainingAfter:trainingAfter.types,validation,training,...acceptance,heldOutLabelsTrained:false,
        rehearsalCoefficient:joint.rehearsalCoefficient,appliedPpoFraction:null,
        efficiency:{contract:p.contract,protocolHash:tacticalLessonDigest(p),mode:'training-projected-adam',fraction,projection,attempts,seconds:(performance.now()-started)/1000,optimizerRestored:true}}};
       return {restoreEpochOptimizer:true};
      }
     }
    }
    if(!legacyRecovery){
     const after=measureLessonRetention(model,bank.validation),trainingAfter=measureLessonRetention(model,bank.training);
     const training=tacticalLessonGuard(trainingBefore.types,trainingAfter.types),validation=lessonSafetyGuard(before,after);
     result={passed:false,training,validation,report:{contract:JOINT_POLICY_LEARNING,protocolHash:tacticalLessonDigest(joint),source:frozen.source,sourceSha256:frozen.sourceSha256,
      before,after,trainingBefore:trainingBefore.types,trainingAfter:trainingAfter.types,training,validation,passed:false,heldOutLabelsTrained:false,
      efficiency:{contract:p.contract,protocolHash:tacticalLessonDigest(p),mode:'training-projection-rejected',projection,attempts,seconds:(performance.now()-started)/1000}}};
     return {restoreEpochOptimizer:false};
    }
    // The previous bounded recovery remains available for directions which
    // this training-only approximation cannot safely recover.
    restore(model,raw);
    fallback??=blockPpoLessonRetention(model,source,frozen,maintenance,joint,block,{additionalGuard});
    const optimizer=fallback.beforeEpochGuard(args);result=fallback.epochGuard();
    result={...result,report:{...result.report,efficiency:{contract:p.contract,protocolHash:tacticalLessonDigest(p),mode:'legacy-recovery',projection,attempts,seconds:(performance.now()-started)/1000}}};
    return optimizer;
   }finally{release(raw);if(projected)release(projected);}
  },
  epochGuard(){assert.ok(result);return result;}
 };
}
const optional=async file=>{try{return await read(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
// Only supplemental demonstration collection can skip one slot. Ordinary
// PPO games, held-out checks, existing lessons and live-game audits continue.
// The next slot after a skip is mandatory, regardless of previous outcomes.
export function supplementalRefreshDecision({mandatory=false,started=false,previousSkipped=false,recent=[]}={}){
 if(mandatory)return {collect:true,reason:'mandatory-initial-coverage'};
 if(started)return {collect:true,reason:'resume-existing-refresh'};
 if(previousSkipped)return {collect:true,reason:'refresh-after-single-skip'};
 if(recent.length<2)return {collect:true,reason:'insufficient-history'};
 if(recent.slice(0,2).every(r=>r.outcome==='no-held-out-fit-improvement'&&r.bestEpoch===0))return {collect:false,reason:'two-refreshes-without-policy-update'};
 return {collect:true,reason:'recent-refresh-benefit-or-incomplete-coverage'};
}
export async function decideSupplementalRefresh(root,iteration,sourcePath,p,{mandatory=false}={}){
 validateEfficientPolicyLearning(p);assert.ok(iteration>p.afterIteration);
 const file=path.join(root,'learning-efficiency',String(iteration).padStart(6,'0')+'.json.gz'),sourceSha256=await hash(sourcePath),protocolHash=tacticalLessonDigest(p);
 const saved=await optional(file);
 if(saved){assert.equal(saved.protocolHash,protocolHash);assert.equal(saved.sourceSha256,sourceSha256);assert.equal(saved.iteration,iteration);return saved;}
 const entries=await readdir(path.join(root,'learning-efficiency')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 const previousName=entries.filter(n=>/^\d{6}\.json\.gz$/.test(n)&&Number(n.slice(0,6))<iteration).sort().at(-1);
 const previous=previousName?await read(path.join(root,'learning-efficiency',previousName)):null;
 const refreshRoot=path.join(root,'tactical-refresh');
 const existing=await readdir(path.join(refreshRoot,String(iteration).padStart(6,'0'))).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 const names=(await readdir(refreshRoot).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n=>/^\d{6}$/.test(n)&&Number(n)<iteration).sort().reverse(),recent=[];
 for(const name of names){if(recent.length>=2)break;const candidate=path.join(refreshRoot,name,'checkpoint.json.gz'),r=await optional(candidate);if(r)recent.push({iteration:Number(name),file:candidate,sha256:await hash(candidate),outcome:r.outcome,bestEpoch:r.bestEpoch});}
 const decision={contract:p.contract,protocolHash,sourceSha256,iteration,at:new Date().toISOString(),recent,
  ...supplementalRefreshDecision({mandatory,started:existing.length>0,previousSkipped:previous?.collect===false,recent})};
 await write(file,decision);return decision;
}
