import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {restoreGameReferences} from '../scripts/game-state-references.mjs';
import {enumerateAiPolicyActions,actionKey,cloneGame} from '../src/ai/actions.mjs';
import {recommendPublicTacticalAction,previewTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {planPublicTurn} from '../src/ai/turn-planner.mjs';
import {liveGameDecisionComparisons,liveTacticalPositionSchedule} from '../scripts/live-game-curriculum.mjs';
import {recommendTacticalDemonstration,previewPublicReserveHorizon} from '../scripts/response-aware-demonstration.mjs';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {createNeuralModel,createNeuralSession,disposeNeuralModel,trainBehaviorCloningBatch} from '../src/ai/neural/model.mjs';
import {packPpoBatch} from '../src/ai/neural/trainer.mjs';
import {ACTION_DIM,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {tacticalRefreshRound} from '../scripts/tactical-policy-refresh.mjs';

const samples=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/ai-live-kaisa-20260925.json.gz',import.meta.url))));
const fixture=n=>{const s=structuredClone(samples.find(s=>s.sequence===n));return {...s,game:restoreGameReferences(s.game,s.references)};};
const decisionFor=(game,action)=>{const legalActions=enumerateAiPolicyActions(game,'p2');return {action,legalActions,legalCount:legalActions.length,probabilities:legalActions.map(()=>1/legalActions.length)};};

test('live Legion ordering is imported even when both battlefields are occupied',()=>{
  const {game,selected}=fixture(121),before=JSON.stringify(game);
  assert.ok(game.battlefields.every(f=>f.units.length));
  const comparisons=liveGameDecisionComparisons(game,'p2',selected);
  assert.ok(comparisons.some(c=>c.category==='card-order-discount'&&c.alternative.cardId==='c70'));
  assert.ok(comparisons.every(c=>c.hypothesisOnly));
  const advice=recommendPublicTacticalAction(game,'p2',enumerateAiPolicyActions(game,'p2'),{selectedAction:selected});
  assert.equal(advice.action.cardId,'c70');
  assert.ok(advice.continuation.some(a=>a.cardId==='c91'));
  assert.equal(advice.correctionEligible,false);
  assert.equal(JSON.stringify(game),before);
  // Classification uses effects, never a special case for the card's name.
  game.players[1].hand.find(c=>c.instanceId==='c91').name='Unseen discounted unit';
  assert.deepEqual(liveGameDecisionComparisons(game,'p2',selected).map(c=>c.category),comparisons.map(c=>c.category));
});

test('live expensive double-target removal teaches the payable cheaper spell',()=>{
  const {game,selected}=fixture(59);
  const advice=recommendTacticalDemonstration(game,'p2',decisionFor(game,selected));
  assert.equal(advice.action.cardId,'c70');
  const actual=previewTacticalAction(game,'p2',selected,{returnGame:true,maximumStates:96});
  const alternative=previewTacticalAction(game,'p2',advice.action,{returnGame:true,maximumStates:96});
  assert.equal(actual.game.players[1].runes.length,3);
  assert.equal(alternative.game.players[1].runes.length,5);
  assert.equal(alternative.game.players[1].runes.filter(r=>!r.exhausted).length,1);
  assert.equal(actual.game.battlefields[0].units.length,0);
  assert.equal(alternative.game.battlefields[0].units.length,0);
});

test('live reserve loss has a legal two-unit development alternative',()=>{
  const {game,selected}=fixture(72);
  const advice=recommendTacticalDemonstration(game,'p2',decisionFor(game,selected));
  assert.equal(advice.action.cardId,'c79');
  assert.equal(advice.winProbabilityLabel,false);
});

test('holding instead of an unused temporary cantrip becomes a policy lesson, not a hard ban',()=>{
  const {game,selected}=fixture(129);
  const advice=recommendTacticalDemonstration(game,'p2',decisionFor(game,selected));
  assert.equal(advice?.action.kind,'endTurn');
  assert.equal(advice.winProbabilityLabel,false);
  assert.equal(advice.correctionEligible,false);
  assert.ok(enumerateAiPolicyActions(game,'p2').some(a=>actionKey(a)===actionKey(selected)));
  assert.ok(liveGameDecisionComparisons(game,'p2',selected).some(c=>c.alternative.kind==='endTurn'));
});

test('exposed movement is audited as a hypothesis and compared on the next-turn horizon',()=>{
  const {game,selected}=fixture(157);
  assert.ok(liveGameDecisionComparisons(game,'p2',selected).some(c=>c.category==='public-counterattack'&&c.alternative.destinationId==='c4'));
  let assessed=0;
  const plan=planPublicTurn(game,'p2',selected,{previewTacticalAction},{maximumExpansions:4,
    evaluateEndpoint:end=>{assessed++;return previewPublicReserveHorizon(end,'p2');}});
  assert.ok(assessed>0);
  assert.ok(plan.endpointAssessment.attacks>0);
  assert.ok(plan.score<plan.noResponseScore);
  assert.equal(plan.endpointAssessment.winProbabilityLabel,false);
});

test('reserve teaching is independent of opponent hidden cards and future draws',()=>{
  const {game,selected}=fixture(129),changed=cloneGame(game);
  changed.players[0].hand.reverse();changed.players[0].mainDeck.reverse();changed.players[1].mainDeck.reverse();
  for(const c of changed.players[0].hand){c.name='PRIVATE';c.type='spell';c.energy=0;}
  assert.deepEqual(recommendTacticalDemonstration(game,'p2',decisionFor(game,selected)),
    recommendTacticalDemonstration(changed,'p2',decisionFor(changed,selected)));
});

test('live imitation rotates a deduplicated interleaved window without consuming validation games',()=>{
  const source=(id,role,ns)=>({entry:{sourceGameId:id,role},source:{pendingLeafAudit:{candidates:ns.map(n=>({descriptor:{selectionContext:{commandSequence:n}}}))}}});
  const sources=[source('old','training',[1,1,2,3,4]),source('new','training',[5,6]),source('heldout','validation',[7])];
  const get=i=>liveTacticalPositionSchedule(sources,{iteration:i,maximumSamples:2}).slice(0,2).map(x=>`${x.entry.sourceGameId}:${x.snapshot.descriptor.selectionContext.commandSequence}`);
  assert.deepEqual(get(1),['old:1','new:5']);
  assert.equal(new Set([1,2,3].flatMap(get)).size,6);
  assert.deepEqual(get(4),get(1));
  assert.throws(()=>liveTacticalPositionSchedule(sources,{iteration:0}));
  assert.deepEqual([1,9,17].map(i=>tacticalRefreshRound({afterIteration:0,everyIterations:8},i)),[1,2,3]);
  assert.deepEqual([64,72,80].map(i=>tacticalRefreshRound({afterIteration:63,everyIterations:8},i)),[1,2,3]);
});

test('verified order, removal and reserve lessons actually update policy probabilities without win/Q targets',()=>{
  const model=createNeuralModel({seed:925}),optimizer=tf.train.adam(0.001);
  const unchanged=['gru','value','actionValue','belief','diagnostic','teacherProposalValue'];
  const weights=()=>Object.fromEntries(unchanged.map(n=>[n,model.layers[n].trainableWeights.map(w=>Array.from(w.val.dataSync()))]));
  try{
    const beforeWeights=weights();
    const positions=[59,121,129].map(n=>{
      const {game,selected}=fixture(n),legal=enumerateAiPolicyActions(game,'p2');
      const advice=recommendPublicTacticalAction(game,'p2',legal,{selectedAction:selected});
      assert.ok(advice && !advice.winProbabilityLabel && !advice.correctionEligible);
      const decision=createNeuralSession(model).decide(game,'p2',legal,{greedy:true,temperature:1});
      const index=decision.legalActions.findIndex(a=>actionKey(a)===actionKey(advice.action));
      assert.ok(index>=0);
      return {game,legal,index,before:decision.probabilities[index],trajectory:{steps:[{
        state:decision.stateEncoding,actions:decision.actionEncoding.slice(0,decision.legalCount*ACTION_DIM),
        initialMemory:decision.initialMemory,selectedIndex:index,legalCount:decision.legalCount,
        oldLogProbability:0,behaviorTemperature:1,advantage:0.5,return:0,imitation:true,
        beliefTarget:new Float32Array(CARD_BINS),winProbabilityLabel:false,teacherCorrectionEligible:false,
      }]}};
    });
    const batch=packPpoBatch(positions.map(p=>p.trajectory));
    for(let i=0;i<20;i++)trainBehaviorCloningBatch(model,batch,optimizer,{policyInitializationOnly:true,entropyCoefficient:0.01});
    for(const p of positions){
      const after=createNeuralSession(model).decide(p.game,'p2',p.legal,{greedy:true,temperature:1}).probabilities[p.index];
      assert.ok(after>p.before+0.02,JSON.stringify({before:p.before,after}));
    }
    assert.deepEqual(weights(),beforeWeights);
  }finally{optimizer.dispose();disposeNeuralModel(model);}
});
