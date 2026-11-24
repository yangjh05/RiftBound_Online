import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';
import {inputKey,digest} from './deck-league-contract.mjs';
import {assertLessonSample,lessonInputKey} from './tactical-lesson-learning.mjs';
import {approvedTeacherAdvice} from './viktor-candidate-learning.mjs';
import {RESOURCE_COLLECTION_TEACHER} from './on-policy-resource-lessons.mjs';
import {RESOURCE_DEPLOYMENT_TEACHER} from './resource-deployment-learning.mjs';

export function appendVerifiedResourceLessons(base,previous,records,{deckId,engineFingerprint,protectedKeys,maximumActive=32,rotateWorkingSet=false,iteration=0}){
  const bank=structuredClone(previous?.bank||base.bank);
  assert.deepEqual(bank.validation,base.bank.validation,'Resource collection changed held-out lessons');
  assert.deepEqual(bank.training.slice(0,base.bank.training.length),base.bank.training,'Original training prefix changed');
  const held=new Set([...protectedKeys,...bank.validation.flatMap(s=>[inputKey(s),lessonInputKey(s)])]);
  const seen=new Set(bank.training.map(inputKey)),decisions=[];
  let active=bank.training.length-base.bank.training.length;
  for(const record of records){
    const capture=record.result.verifiedTrainingLessons;if(!capture)continue;
    assert.equal(capture.contract,'on-policy-resource-collection-v1');assert.equal(capture.role,'training');
    assert.equal(capture.completed,true);assert.equal(capture.extraGames,0);assert.equal(capture.policyActionsModified,false);
    assert.ok(capture.teacherCriteriaUnchanged===true||capture.teacherCriteriaUnchanged===false&&capture.teacherContract===RESOURCE_COLLECTION_TEACHER);
    for(const s of capture.samples){
      assertLessonSample(s,'training');assert.equal(s.deckId,deckId);assert.equal(s.engineFingerprint,engineFingerprint);
      assert.equal(s.gameId,capture.sourceGameId);assert.equal(s.lessonSource.origin,'completed-own-policy-resource-opportunity');
      assert.equal(s.lessonSource.role,'training');
      if(s.lessonSource.proof.thresholdsUnchanged!==true){
        assert.equal(capture.teacherContract,RESOURCE_COLLECTION_TEACHER);
        assert.equal(s.lessonSource.proof.thresholdsUnchanged,false);
        assert.equal(s.lessonSource.proof.teacherContract,RESOURCE_DEPLOYMENT_TEACHER);
      }
      assert.equal(s.steps.length,1);const step=s.steps[0],proof=s.correctionProof;
      assert.equal(step.localResourceLesson,true);assert.equal(step.winProbabilityLabel,false);assert.equal(proof.completeActorPrefix,true);assert.equal(proof.independentTeacher,true);
      assert.equal(proof.verifiedTarget,step.selectedIndex);assert.notEqual(proof.parentChoice,step.selectedIndex);
      assert.ok(approvedTeacherAdvice({action:{key:step.selectedActionKey},weight:step.advantage,localResourceLesson:true,
        comparison:s.lessonSource.proof.comparison,review:s.lessonSource.proof.review},step.legalActionKeys[proof.parentChoice],a=>a.key));
      const key=inputKey(s);let disposition;
      if(held.has(key)||held.has(lessonInputKey(s)))disposition='protected-input';
      else if(seen.has(key))disposition='duplicate';
      else if(!rotateWorkingSet&&active>=maximumActive)disposition='active-bank-capacity';
      else{disposition='admitted';bank.training.push(structuredClone(s));seen.add(key);active++;}
      decisions.push({key,disposition,game:{path:record.path,sha256:record.sha256},gameId:s.gameId});
    }
  }
  // Keep every admitted proof and its regression obligation. Only gradient
  // work rotates: half recent cases, half a deterministic circular history.
  // No validation labels, outcomes or evaluation failures inform selection.
  const resources=bank.training.slice(base.bank.training.length),working=rotateWorkingSet?rotatingResourceWorkingSet(resources,maximumActive,iteration):resources;
  return {bank,...(rotateWorkingSet?{permanentTraining:structuredClone(previous?.permanentTraining||previous?.bank.training||base.bank.training),workingTraining:[...bank.training.slice(0,base.bank.training.length),...working],
    workingSetContract:'training-only-preserved-archive-rotation-v1',workingResourceLessons:working.length}:{}),
    decisions,activeResourceLessons:active,distinctResourceGames:new Set(resources.map(s=>s.gameId)).size,
    originalValidationUnchanged:true,originalTrainingPrefixUnchanged:true,teacherCriteriaUnchanged:records.every(r=>r.result.verifiedTrainingLessons?.teacherCriteriaUnchanged!==false),
    teacherContract:RESOURCE_COLLECTION_TEACHER,extraGames:0};
}

export function rotatingResourceWorkingSet(samples,maximum,iteration){
  assert.ok(Number.isSafeInteger(maximum)&&maximum>0&&Number.isSafeInteger(iteration)&&iteration>=0);
  if(samples.length<=maximum)return samples.slice();
  const recent=Math.ceil(maximum/2),selected=samples.slice(-recent),seen=new Set(selected.map(inputKey));
  for(let j=0;selected.length<maximum&&j<samples.length;j++){
    const sample=samples[(iteration*17+j)%samples.length],key=inputKey(sample);
    if(!seen.has(key)){seen.add(key);selected.push(sample);}
  }
  return selected;
}

export async function retainOnPolicyResourceBank({directory,profileId,iteration,base,records,source,planHash,...options}){
  const root=path.join(directory,'resource-training-r1',profileId),file=path.join(root,String(iteration).padStart(6,'0')+'.json.gz'),pointer=path.join(root,'active.json');
  const games=records.map(({path,sha256})=>({path,sha256}));games.forEach(verifyArtifact);
  let result;
  if(fs.existsSync(file)){
    result=await readTrajectoryArchive(file);assert.equal(result.planHash,planHash);assert.deepEqual(result.games,games);assert.deepEqual(result.source,source);
    assert.deepEqual(result.baseHash,digest(base));
  }else{
    const previousRef=fs.existsSync(pointer)?json(pointer):null;
    const previous=previousRef?await readTrajectoryArchive(verifyArtifact(previousRef)):null;
    if(previous)assert.ok(previous.iteration<iteration,'Resource bank cannot move backwards');
    result={contract:'retained-on-policy-resource-bank-v1',profileId,iteration,planHash,source,games,baseHash:digest(base),previous:previousRef,
      ...appendVerifiedResourceLessons(base,previous,records,{...options,iteration})};
    await writeTrajectoryArchive(file,result);
  }
  const reference={path:file,sha256:sha(file)};atomic(pointer,reference);
  return {payload:{...base,bank:result.bank},permanentTraining:result.permanentTraining||result.bank.training,workingTraining:result.workingTraining||result.bank.training,reference,report:{activeResourceLessons:result.activeResourceLessons,workingResourceLessons:result.workingResourceLessons??result.activeResourceLessons,distinctResourceGames:result.distinctResourceGames,
    admitted:result.decisions.filter(d=>d.disposition==='admitted').length,extraGames:0,originalValidationUnchanged:true,
    teacherCriteriaUnchanged:result.teacherCriteriaUnchanged,teacherContract:result.teacherContract}};
}
