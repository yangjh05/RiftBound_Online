import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readTrajectoryArchive as read,writeTrajectoryArchive as write} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {neuralBehaviorHash} from '../src/ai/neural/evaluator-certification.mjs';
import {digest} from './adaptive-policy-q-contract.mjs';
import {confirmLearningAnchor,assertAnchorEvaluationSchedule} from './learning-anchor-selection.mjs';

export const LEARNER_ANCHOR='bounded-validated-learner-continuation-v1';
export function validateLearnerAnchor(p){
  assert.equal(p.contract,LEARNER_ANCHOR);assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.equal(p.maximumUnverifiedIterations,32);assert.equal(p.minimumInferiorEvaluations,2);
  assert.ok(path.isAbsolute(p.comparisonDirectory));assert.match(p.comparisonConfigHash,/^[a-f0-9]{64}$/);return p;
}
export async function readLearnerAnchor(root){
  try{return validateLearnerAnchor(JSON.parse(await fs.readFile(path.join(root,'learner-anchor-protocol.json'),'utf8')));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function commitLearnerAnchor(state,p){
  if(!p){assert.ok(!state.learnerAnchor,'Learner anchor protocol removed.');return;}
  const hash=digest(validateLearnerAnchor(p));
  if(state.learnerAnchor)assert.equal(state.learnerAnchor.protocolHash,hash);
  else{assert.ok(p.afterIteration>=state.iteration);state.learnerAnchor={protocolHash:hash,
    anchorPath:state.championPath,branchStartIteration:p.afterIteration,inferiorEvaluations:[],consumedComparisons:[]};}
}
export function recordLearnerAnchorEvaluation(state,request,decision,promoted=false){
  const a=state.learnerAnchor;if(!a)return;
  if(promoted){a.anchorPath=request.candidatePath;a.branchStartIteration=state.iteration;a.inferiorEvaluations=[];return;}
  const iteration=Number(request.candidatePath.match(/[\\/]iterations[\\/](\d+)[\\/]/)?.[1]);
  if(!Number.isSafeInteger(iteration)||iteration<=a.branchStartIteration||!(decision.upperBound<.5)
    ||request.incumbentPath!==state.championPath)return;
  if(!a.inferiorEvaluations.some(e=>e.candidatePath===request.candidatePath))
    a.inferiorEvaluations.push({candidatePath:request.candidatePath,iteration,upperBound:decision.upperBound});
}
export function shouldReturnToAnchor(state,p){
  const a=state.learnerAnchor;
  return Boolean(a&&state.iteration-a.branchStartIteration>=p.maximumUnverifiedIterations
    &&a.inferiorEvaluations.length>=p.minimumInferiorEvaluations&&state.learnerPath!==a.anchorPath);
}
const unwrap=p=>p.candidateCheckpoint||p.checkpoint||p;
async function behavior(file){const m=deserializeNeuralModel(unwrap(await read(file)));try{return neuralBehaviorHash(m);}finally{disposeNeuralModel(m);}}
// Called only before an iteration plan exists. It never edits in-flight
// collection sources, frozen evaluations, champion files or old checkpoints.
export async function applyLearnerAnchor(state,p,engineFingerprint){
  if(!p||state.iteration<p.afterIteration)return null;
  const a=state.learnerAnchor,root=p.comparisonDirectory;
  const startingChampion=state.championPath,startingBranch=a.branchStartIteration;
  const confirmation=await read(path.join(root,'confirmation.json.gz')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  let replacement=null,reason=null,evidence=null,consumed=null;
  if(confirmation&&!a.consumedComparisons.includes(confirmation.configHash)){
    assert.equal(confirmation.configHash,p.comparisonConfigHash);
    const config=JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));assert.equal(digest(config),p.comparisonConfigHash);
    assert.equal(confirmation.engineFingerprint,engineFingerprint);assert.equal(confirmation.promotionEligible,false);
    assertAnchorEvaluationSchedule(config,confirmation.candidateRows);assertAnchorEvaluationSchedule(config,confirmation.referenceRows);
    assert.equal(confirmation.referencePath,config.initials['current-start'].path);
    assert.ok(['champion-start','current-start'].includes(confirmation.selected?.arm));
    const comparisonState=await read(path.join(root,'state.json.gz'));
    assert.equal(comparisonState.configHash,p.comparisonConfigHash);
    assert.equal(comparisonState.arms[confirmation.selected.arm].learnerPath,confirmation.candidatePath);
    const verified=confirmLearningAnchor(confirmation.candidateRows,confirmation.referenceRows);
    assert.equal(digest(verified),digest(confirmation.confirmation));
    const championPath=state.championPath;
    if(verified.accepted&&confirmation.championHash===await behavior(championPath)){
      assert.equal(await behavior(confirmation.candidatePath),confirmation.candidateHash);
      assert.equal(state.championPath,championPath,'Champion changed during anchor verification.');
      replacement=confirmation.candidatePath;reason='fresh-paired-confirmation';evidence={configHash:confirmation.configHash,comparison:verified};
    }
    consumed=confirmation.configHash;
  }
  if(!replacement&&shouldReturnToAnchor(state,p)){replacement=a.anchorPath;reason='bounded-branch-repeatedly-inferior';evidence={evaluations:[...a.inferiorEvaluations]};}
  if(!replacement){if(consumed)a.consumedComparisons.push(consumed);return null;}
  const record={at:new Date().toISOString(),iteration:state.iteration,previousLearnerPath:state.learnerPath,
    learnerPath:replacement,reason,evidence,promotionEligible:false};
  // Keep an artifact digest for forensic attribution, not a generation label.
  record.sha256=createHash('sha256').update(await fs.readFile(replacement)).digest('hex');
  const original=await read(replacement),previous=unwrap(await read(state.learnerPath)),checkpoint=structuredClone(unwrap(original));
  checkpoint.metadata={...checkpoint.metadata,learnerAnchorSource:{path:replacement,generation:checkpoint.generation,sha256:record.sha256}};
  checkpoint.generation=Math.max(previous.generation,checkpoint.generation)+1;
  const adopted=path.join(path.dirname(p.comparisonDirectory),'learner-anchor-adoptions',
    `${state.iteration}-${record.sha256.slice(0,16)}.json.gz`);
  await write(adopted,{checkpoint,anchorEvidence:record,promotionEligible:false});
  // A concurrently completed promotion takes precedence over this proposal.
  if(state.championPath!==startingChampion||a.branchStartIteration!==startingBranch)return null;
  record.adoptedPath=adopted;
  if(consumed)a.consumedComparisons.push(consumed);
  state.learnerPath=adopted;a.anchorPath=adopted;a.branchStartIteration=state.iteration;a.inferiorEvaluations=[];
  a.history=[...(a.history||[]),record];return record;
}
