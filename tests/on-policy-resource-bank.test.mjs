import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
const load=file=>import(pathToFileURL(path.join(runtime,file)));
test('retained resource bank preserves original lessons and excludes protected or unproved samples',{skip:!runtime},async()=>{
 const {appendVerifiedResourceLessons}=await load('scripts/on-policy-resource-bank.mjs');
 const {inputKey}=await load('scripts/deck-league-contract.mjs');
 const sample=(n,role='training')=>({playerId:'p1',gameId:'own',deckId:'own',engineFingerprint:'engine',lessonRole:role,imitation:true,
  memoryContext:{contract:'complete-actor-observation-prefix-v1',playerId:'p1',fromReset:true,states:[]},
  lessonSource:{role:'training',origin:'completed-own-policy-resource-opportunity',proof:{thresholdsUnchanged:true,comparison:'same-result-less-spending',review:{applied:true,partialSearch:false,comparisons:[{score:1}]}}},
  correctionProof:{parentChoice:0,verifiedTarget:1,completeActorPrefix:true,independentTeacher:true},
  steps:[{state:[n],actions:[1,2],initialMemory:[0],legalCount:2,selectedIndex:1,selectedActionKey:'saving',legalActionKeys:['costly','saving'],
   advantage:.5,return:0,value:0,imitation:true,winProbabilityLabel:false,localResourceLesson:true}]});
 const base={bank:{training:[sample(0)],validation:[sample(1,'validation')]}},fresh=sample(2),protectedSample=sample(3);
 const capture=samples=>[{path:'fixture',sha256:'fixture',result:{verifiedTrainingLessons:{contract:'on-policy-resource-collection-v1',role:'training',sourceGameId:'own',completed:true,extraGames:0,policyActionsModified:false,teacherCriteriaUnchanged:true,samples}}}];
 const options={deckId:'own',engineFingerprint:'engine',protectedKeys:new Set([inputKey(protectedSample)]),maximumActive:2};
 const before=structuredClone(base),result=appendVerifiedResourceLessons(base,null,capture([fresh,protectedSample,sample(1),sample(2)]),options);
 assert.deepEqual(base,before);assert.deepEqual(result.bank.validation,base.bank.validation);assert.deepEqual(result.bank.training.slice(0,1),base.bank.training);
 assert.deepEqual(result.decisions.map(d=>d.disposition),['admitted','protected-input','protected-input','duplicate']);
 const next=appendVerifiedResourceLessons(base,result,capture([sample(4),sample(5)]),options);
 assert.equal(next.activeResourceLessons,2);assert.deepEqual(next.decisions.map(d=>d.disposition),['admitted','active-bank-capacity']);
 const bad=sample(9);bad.lessonSource.proof.review.partialSearch=true;assert.throws(()=>appendVerifiedResourceLessons(base,null,capture([bad]),options));
 const terminal=sample(8);terminal.lessonSource.proof.review.comparisons[0].score=1000;assert.throws(()=>appendVerifiedResourceLessons(base,null,capture([terminal]),options));
 const rotated=appendVerifiedResourceLessons(base,next,capture([sample(5),sample(6),protectedSample]),{...options,rotateWorkingSet:true,iteration:10});
 assert.deepEqual(rotated.bank.training.slice(0,next.bank.training.length),next.bank.training);
 assert.deepEqual(rotated.permanentTraining,next.bank.training);assert.deepEqual(rotated.bank.validation,base.bank.validation);
 assert.equal(rotated.activeResourceLessons,4);assert.equal(rotated.workingResourceLessons,2);
 assert.equal(rotated.decisions.at(-1).disposition,'protected-input');assert.equal(rotated.workingTraining.length,3);
 assert.ok(rotated.workingTraining.some(s=>inputKey(s)===inputKey(sample(6))));
 const later=appendVerifiedResourceLessons(base,rotated,capture([]),{...options,rotateWorkingSet:true,iteration:11});
 assert.deepEqual(later.bank,rotated.bank);assert.deepEqual(later.permanentTraining,next.bank.training);
 assert.notDeepEqual(later.workingTraining,rotated.workingTraining);
});
