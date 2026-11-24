import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {restoreGameReferences} from '../scripts/game-state-references.mjs';
import {actionKey,applyAiAction,enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {registerAiTurnWorker} from '../src/ai/turn-worker.mjs';
import {createAiTurnNeuralConfigureRequest,createAiTurnWorkerRequest} from '../src/ai/turn-protocol.mjs';

const samples=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/ai-live-kaisa-20260925.json.gz',import.meta.url))));
const fixture=n=>{const s=structuredClone(samples.find(s=>s.sequence===n));return {...s,game:restoreGameReferences(s.game,s.references)};};
const deterministicBudget={now:()=>0};

for(const [n,expected] of [[59,'c70'],[72,'c79'],[121,'c70']]){
  test(`AI live runtime corrects recorded choice ${n} without mutating the game or model selection`,()=>{
    const {game,selected}=fixture(n),before=JSON.stringify(game);
    const legalActions=enumerateAiPolicyActions(game,'p2');
    const input={action:selected,probability:0.9,legalActions,probabilities:legalActions.map(()=>0.125)};
    const saved=structuredClone(input);
    const result=reviewRuntimeTacticalAction(game,'p2',input,legalActions,deterministicBudget);
    assert.equal(result.selection.action.cardId||result.selection.action.kind,expected);
    assert.equal(result.review.applied,true);
    assert.equal(result.selection.probability,0.125);
    assert.equal(actionKey(legalActions[result.selection.selectedIndex]),actionKey(result.selection.action));
    assert.equal(result.review.correctionEligible,false);
    assert.equal(result.review.winProbabilityLabel,false);
    assert.ok(result.review.previews<=48);
    assert.equal(JSON.stringify(game),before);
    assert.deepEqual(input,saved);
  });
}

test('a draw spell is not suppressed solely by a one-turn resource estimate',()=>{
  const {game,selected}=fixture(129);
  const result=reviewRuntimeTacticalAction(game,'p2',{action:selected},null,deterministicBudget);
  assert.deepEqual(result.selection.action,selected);
  assert.equal(result.review.reason,'deferred-development-retained');
});

test('AI runtime reviews a public counterattack without forcing an unproven formation lesson',()=>{
  const {game,selected}=fixture(157);
  const result=reviewRuntimeTacticalAction(game,'p2',{action:selected},null,deterministicBudget);
  assert.deepEqual(result.selection.action,selected);
  assert.ok(result.review.comparisons.some(c=>c.attacks>0));
});

test('AI runtime separately reviews the removal target after its card recommendation',()=>{
  const {game}=fixture(121);
  assert.equal(applyAiAction(game,{kind:'beginPlayCard',cardId:'c70',destination:'base'},'p2').ok,true);
  assert.equal(game.pendingChoice.effect,'declarePlayTarget');
  const selected={action:{kind:'chooseEffectOption',optionId:'c10'}};
  const result=reviewRuntimeTacticalAction(game,'p2',selected,null,deterministicBudget);
  assert.equal(result.selection.action.optionId,'c27');
  assert.equal(applyAiAction(game,result.selection.action,'p2').ok,true);
});

test('AI runtime preserves the neural action when its preview or time budget expires',()=>{
  for(const options of [{maximumPreviews:0},{maximumMilliseconds:0},{maximumPreviews:1}]){
    const {game,selected}=fixture(59),input={action:selected,probability:0.9};
    const result=reviewRuntimeTacticalAction(game,'p2',input,null,options);
    assert.equal(result.selection,input);
    assert.equal(result.review.applied,false);
    assert.equal(result.review.budgetExceeded,true);
  }
});

test('AI runtime errors, payments, terminal games and wrong actors safely retain selection',()=>{
  for(const mutate of [g=>g.pendingPayment={},g=>g.phase='complete',g=>g.currentPlayerId='p1',g=>g.players=null]){
    const {game,selected}=fixture(121),input={action:selected};mutate(game);
    const result=reviewRuntimeTacticalAction(game,'p2',input,null,deterministicBudget);
    assert.equal(result.selection,input);
    assert.equal(result.review.applied,false);
  }
});

test('AI runtime order comparison ignores hidden hand and deck identities and card names',()=>{
  const original=fixture(121),changed=fixture(121);
  for(const p of changed.game.players){
    for(const c of p.mainDeck)c.name='Private unknown card';
    if(p.id!=='p2')for(const c of p.hand){c.name='Private unknown hand';c.might=999;c.energy=999;c.effects=[];}
  }
  changed.game.players[1].hand.find(c=>c.instanceId==='c91').name='Generic Legion unit';
  const a=reviewRuntimeTacticalAction(original.game,'p2',{action:original.selected},null,deterministicBudget);
  const b=reviewRuntimeTacticalAction(changed.game,'p2',{action:changed.selected},null,deterministicBudget);
  assert.deepEqual(a.selection.action,b.selection.action);
  assert.equal(a.review.gain,b.review.gain);
  assert.equal(b.review.readyResourcesSaved,2);
});

test('AI turn Worker applies the runtime correction after neural selection and returns a lean diagnostic',async()=>{
  const {game,selected}=fixture(121);let listener;
  const posted=[];
  registerAiTurnWorker({addEventListener(_type,fn){listener=fn;},postMessage(message){posted.push(message);}},
    {neural:{deserializeNeuralModel:()=>({}),disposeNeuralModel(){},createNeuralSession:()=>({reset(){},
      decideEncoded(_id,prepared){return {action:selected,probability:0.9,legalActions:prepared.actions,
        probabilities:prepared.actions.map(()=>0.125)};}})}});
  listener({data:createAiTurnNeuralConfigureRequest({requestId:'configure',descriptorKey:'test',
    checkpointBuffer:new TextEncoder().encode('{"generation":1163}').buffer,expectedGeneration:1163})});
  listener({data:createAiTurnWorkerRequest({requestId:'decide',game,actorId:'p2',selectionMode:'neural'})});
  await new Promise(resolve=>setImmediate(resolve));
  const result=posted.find(m=>m.requestId==='decide');
  assert.equal(result?.ok,true);
  assert.equal(result.decision.selected.action.cardId,'c70');
  assert.equal(result.decision.runtimeReview.applied,true);
  assert.equal(result.decision.runtimeReview.readyResourcesSaved,2);
  assert.equal(Object.hasOwn(result.decision.selected,'legalActions'),false);
  assert.equal(Object.hasOwn(result.decision,'stateEncoding'),false);
});
