import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {tacticalLessonDigest,measureLessonTypes,tacticalLessonGuard} from './tactical-lesson-learning.mjs';
import {commonLessonStep,measureLessonRetention,lessonSafetyGuard} from './lesson-maintenance.mjs';
import {jointPpoLessonRetention,trainingMarginReferences,restoreTrainingChoiceMargins,interpolateEpochWeights,additionalAcceptance} from './joint-policy-learning.mjs';

export const PPO_BLOCK_RECOVERY='prospective-ppo-block-recovery-v1';
export function validatePpoBlockRecovery(p){
  assert.equal(p.contract,PPO_BLOCK_RECOVERY);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.match(p.jointLearningHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(p.repairFractions,[0,.125,.25,.5,1]);
  assert.equal(p.optimizerPolicy,'restore-epoch-start-on-projection');
  return p;
}
export async function readPpoBlockRecovery(root){
  let p;try{p=JSON.parse(await readFile(path.join(root,'ppo-block-recovery-protocol.json'),'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}return validatePpoBlockRecovery(p);
}
export function commitPpoBlockRecovery(state,p){
  const hash=p?tacticalLessonDigest(validatePpoBlockRecovery(p)):null;
  if(state.ppoBlockRecoveryHash)assert.equal(hash,state.ppoBlockRecoveryHash,'PPO block recovery changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Recovery must start prospectively.');
    assert.equal(p.jointLearningHash,state.jointPolicyLearningHash);state.ppoBlockRecoveryHash=hash;}
}
const snapshot=model=>Object.fromEntries(Object.entries(model.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const restore=(model,s)=>{for(const [n,w]of Object.entries(s))model.layers[n].setWeights(w);};
const release=s=>Object.values(s).flat().forEach(w=>w.dispose());
// These are ALL action-scoring layers, including the Q head contributing to
// logits. The GRU remains trainable. This does not replace labels or weaken
// the held-out gate; it tries a distinct, bounded training-only direction.
const actionHeads=['stateProjection','actionProjection','actionBias','actionValue'];
export function blockPpoLessonRetention(model,source,frozen,maintenance,joint,p,{additionalGuard=null}={}){
  validatePpoBlockRecovery(p);assert.equal(p.jointLearningHash,tacticalLessonDigest(joint));
  const normal=jointPpoLessonRetention(model,source,frozen,maintenance,joint,{additionalGuard}),bank=frozen.bank;
  let references=null,result=null;
  return {
    policyRehearsalForBatch:normal.policyRehearsalForBatch,
    beforeEpochGuard(args){
      const raw=snapshot(model),attempts=[],rounds=[];let memoryStart,corrected,marginRetention=null;
      try{
        normal.beforeEpochGuard(args);const ordinary=normal.epochGuard();
        result={...ordinary,report:{...ordinary.report,blockRecovery:{contract:p.contract,protocolHash:tacticalLessonDigest(p),mode:'joint',attempts}}};
        if(ordinary.passed)return {restoreEpochOptimizer:ordinary.report.appliedPpoFraction<1};
        const {before,trainingBefore}=ordinary.report;
        references??=trainingMarginReferences(source,bank);
        restore(model,raw);
        for(const n of actionHeads)model.layers[n].setWeights(args.epochStartWeights[n]);
        memoryStart=snapshot(model);
        // First test the unmodified memory proposal; compute supplemental
        // TRAINING gradients only if it actually needs a retention repair.
        for(const fraction of p.repairFractions){
          if(fraction>0){
            if(!corrected){
              restore(model,memoryStart);
              for(let i=0;i<maintenance.roundsPerEpoch;i++)rounds.push(commonLessonStep(model,bank,maintenance));
              marginRetention=restoreTrainingChoiceMargins(model,bank,references,joint);corrected=snapshot(model);
            }
            interpolateEpochWeights(model,memoryStart,corrected,fraction);
          }
          const trainingAfter=measureLessonTypes(model,bank.training),training=tacticalLessonGuard(trainingBefore,trainingAfter);
          const lostTrainingChoices=training.passed?trainingMarginReferences(model,bank).filter((r,i)=>references[i].correct&&!r.correct).length:null;
          // A failed training check cannot become a validation search.
          if(!training.passed||lostTrainingChoices){attempts.push({repairFraction:fraction,passed:false,training,lostTrainingChoices,validation:null});continue;}
          const after=measureLessonRetention(model,bank.validation),validation=lessonSafetyGuard(before,after);
          const acceptance=additionalAcceptance({passed:validation.passed},additionalGuard),{passed}=acceptance;
          attempts.push({repairFraction:fraction,...acceptance,training,lostTrainingChoices,validation});
          if(passed){
            result={...acceptance,validation,training,report:{...ordinary.report,...acceptance,after,trainingAfter,validation,training,
              appliedPpoFraction:null,heldOutLabelsTrained:false,blockRecovery:{contract:p.contract,protocolHash:tacticalLessonDigest(p),
                mode:'memory-with-training-repair',repairFraction:fraction,rounds,marginRetention,attempts,optimizerRestored:true}}};
            return {restoreEpochOptimizer:true};
          }
        }
        // Leave rejection to the trainer's atomic model/Adam/RNG rollback.
        return {restoreEpochOptimizer:false};
      }finally{release(raw);if(memoryStart)release(memoryStart);if(corrected)release(corrected);}
    },
    epochGuard(){assert.ok(result);return result;}
  };
}
