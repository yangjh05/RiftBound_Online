import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {rotatingLiveAuditPairs,recommendLocalResourceDemonstration,tacticalSelectionGuard,localPolicyRefreshSchedule,
  commitLocalPolicyLearning,LOCAL_POLICY_LEARNING_CONTRACT} from '../scripts/local-policy-learning.mjs';
import {restoreGameReferences} from '../scripts/game-state-references.mjs';
import {liveGameDecisionComparisons} from '../scripts/live-game-curriculum.mjs';
import {enumerateAiPolicyActions,actionKey} from '../src/ai/actions.mjs';
import {createNeuralModel,createNeuralSession,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {trainBehaviorCloning} from '../src/ai/neural/trainer.mjs';
import {ACTION_DIM,CARD_BINS} from '../src/ai/neural/encoding.mjs';

const saved=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/ai-live-kaisa-20260926.json.gz',import.meta.url)))).states;
const fixture=n=>{const s=structuredClone(saved.find(s=>s.n===n));return {...s,game:restoreGameReferences(s.state,s.references)};};
const decision=s=>({action:s.action,legalActions:enumerateAiPolicyActions(s.game,'p2')});

test('audit rotation balances source games, reaches later states, deduplicates, and excludes validation',()=>{
 const pairs=[];
 for(let g=0;g<5;g++)for(let i=0;i<32;i++)pairs.push({entry:{sourceGameId:`game-${g}`,role:'training'},snapshot:{descriptor:{
  informationSetHash:`${g}:${i}`,selectedAction:{kind:'endTurn'},recommendedAction:{kind:'passShowdown'}}}});
 const withNoise=[...pairs,...pairs.slice(0,10),{...pairs[0],entry:{sourceGameId:'held-out',role:'validation'}}];
 const first=rotatingLiveAuditPairs(withNoise),second=rotatingLiveAuditPairs(withNoise,{round:2});
 assert.equal(first.length,32);assert.equal(new Set(first.map(p=>p.entry.sourceGameId)).size,5);
 assert.notDeepEqual(first,second);assert.deepEqual(rotatingLiveAuditPairs(withNoise),first);
 const seen=new Set();for(let round=1;round<=32;round++)for(const p of rotatingLiveAuditPairs(withNoise,{round}))seen.add(p.snapshot.descriptor.informationSetHash);
 assert.equal(seen.size,160);assert.ok(!first.some(p=>p.entry.role==='validation'));
});

test('refresh covers both Yi lists with disjoint fresh train/validation seeds',()=>{
 const p={contract:LOCAL_POLICY_LEARNING_CONTRACT,afterIteration:76,everyIterations:8};
 const ids=['a','b','c','d','yi-aurora','yi-no-aurora'],base={seed:1777};
 assert.equal(localPolicyRefreshSchedule(base,p,76,ids),null);
 const schedule=localPolicyRefreshSchedule(base,p,77,ids);assert.equal(schedule.length,12);
 for(const id of ids)assert.deepEqual(schedule.filter(s=>s.deckId===id).map(s=>s.partition),['training','validation']);
 assert.equal(new Set(schedule.map(s=>s.seed)).size,12);
 assert.equal(localPolicyRefreshSchedule(base,p,78,ids),null);
 assert.ok(localPolicyRefreshSchedule(base,p,85,ids).every(s=>!schedule.some(a=>a.seed===s.seed)));
 const state={iteration:76};commitLocalPolicyLearning(state,p);commitLocalPolicyLearning(state,p);
 assert.throws(()=>commitLocalPolicyLearning(state,null));assert.throws(()=>commitLocalPolicyLearning({iteration:77},p));
});

test('loss improvement cannot mask global or per-deck selection regression',()=>{
 const m=(a,loss=1)=>({decisionAccuracy:a,policyLoss:loss,decisions:100});
 const before={...m(.6),perDeck:{a:m(.6),b:m(.6)}};
 assert.equal(tacticalSelectionGuard(before,{...m(.59,.8),perDeck:before.perDeck}).passed,false);
 assert.equal(tacticalSelectionGuard(before,{...m(.7,.8),perDeck:{a:m(.59,.8),b:m(.81,.8)}}).passed,false);
 assert.equal(tacticalSelectionGuard(before,{...m(.61,.8),perDeck:{a:m(.6,.8),b:m(.62,.8)}}).passed,true);
 assert.equal(tacticalSelectionGuard(before,{...before,perDeck:{a:m(.6)}}).passed,false);
});

test('resource lessons teach same-result savings, keep useful damage/draw legal, and never label a win',()=>{
 for(const n of [178,206]){
  const s=fixture(n),before=JSON.stringify(s.game),lesson=recommendLocalResourceDemonstration(s.game,'p2',decision(s));
  assert.equal(lesson?.localResourceLesson,true);assert.equal(lesson.winProbabilityLabel,false);
  assert.equal(lesson.correctionEligible,false);assert.equal(JSON.stringify(s.game),before);
  const comparisons=liveGameDecisionComparisons(s.game,'p2',s.action,{localResourceLessons:true});
  assert.ok(comparisons.some(c=>c.category==='public-resource-savings'&&actionKey(c.alternative)===actionKey(lesson.action)));
 }
 const useful=fixture(206);
 useful.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c21').might=3;
 useful.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c98').might=6;
 assert.equal(recommendLocalResourceDemonstration(useful.game,'p2',decision(useful)),null);
 const terminal=fixture(307);assert.equal(recommendLocalResourceDemonstration(terminal.game,'p2',decision(terminal)),null);
});

test('local saving labels train real action probabilities without updating recurrent/value/belief heads',()=>{
 const model=createNeuralModel({seed:9901});let optimizer;
 const weights=()=>JSON.stringify(['gru','value','actionValue','belief','diagnostic','teacherProposalValue']
  .map(name=>model.layers[name].getWeights().map(t=>Array.from(t.dataSync()))));
 try{
  const beforeWeights=weights(),items=[];
  for(const n of [178,206]){
   const s=fixture(n),legal=enumerateAiPolicyActions(s.game,'p2'),d=createNeuralSession(model).decide(s.game,'p2',legal,{greedy:true});
   const advice=recommendLocalResourceDemonstration(s.game,'p2',{...d,action:s.action});assert.ok(advice);
   const index=d.legalActions.findIndex(a=>actionKey(a)===actionKey(advice.action));assert.ok(index>=0);
   items.push({s,legal,index,before:d.probabilities[index],sample:{gameId:`resource-${n}`,playerId:'p2',imitation:true,steps:[{
    state:d.stateEncoding,actions:d.actionEncoding.slice(0,d.legalCount*ACTION_DIM),initialMemory:d.initialMemory,
    selectedIndex:index,legalCount:d.legalCount,legalActionKeys:d.legalActions.map(actionKey),advantage:.5,
    return:0,value:0,beliefTarget:new Float32Array(CARD_BINS),imitation:true,winProbabilityLabel:false,localResourceLesson:true}]}});
  }
  const result=trainBehaviorCloning(model,items.map(i=>i.sample),{epochs:12,batchSize:8,sequenceLength:1,
   learningRate:.001,auxiliary:true,policyInitializationOnly:true,valueCoefficient:0,beliefCoefficient:0,random:()=>.5});
  optimizer=result.optimizer;
  for(const item of items)assert.ok(createNeuralSession(model).decide(item.s.game,'p2',item.legal,{greedy:true}).probabilities[item.index]>item.before+.005);
  assert.equal(weights(),beforeWeights);
 }finally{optimizer?.dispose();disposeNeuralModel(model);}
});
