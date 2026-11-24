import assert from 'node:assert/strict';
// Historical pre-fix reproducer. Its assertions deliberately expect the old
// defects. Use tests/ai-training-corrections.test.mjs for post-fix verification.
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { cards, decklists } from '../../src/cards.mjs';
import { createGame, currentCombatMight, moveUnit, canStandardMoveUnits } from '../../src/engine.mjs';
import { observeGame } from '../../src/ai/observation.mjs';
import { inferOpponentDeckBelief } from '../../src/ai/belief.mjs';
import { opponentResponseProfile } from '../../src/ai/resource-strategy.mjs';
import { activeActorId, applyAiAction, enumerateAiPolicyActions, actionKey } from '../../src/ai/actions.mjs';
import { determinizeGame, determinizationStatus, rolloutAlternatives } from '../../src/ai/rollout.mjs';
import { DEFAULT_AI_MODEL } from '../../src/ai/policy.mjs';
import { ACTION_DIM, MAX_ACTIONS, STATE_DIM, CARD_VOCABULARY, cardIndex,
  encodeState, encodeAction, encodeActionSet, encodeOpponentDeckTarget } from '../../src/ai/neural/encoding.mjs';
import { createNeuralModel, forwardNeural, disposeNeuralModel } from '../../src/ai/neural/model.mjs';
import { applyGeneralizedAdvantageEstimation, seededRandom } from '../../src/ai/neural/selfplay.mjs';
import { tf, tfBackend } from '../../src/ai/neural/tf-runtime.mjs';

const out = { date: '2026-09-05', backend: tfBackend, checks: {} };
const baseGame = () => {
  const g=createGame({decks: Object.values(decklists).slice(0, 2), random: seededRandom(20260905), interactive: true, manualActionChainPriority: true});
  for(const p of g.players) {p.hand=p.mainDeck.splice(0,4);for(const c of p.hand)c.zone='hand';}
  return g;
};
const unit = (id, playerId, might = 6) => ({...structuredClone(cards.lonelyPoro), instanceId: id, ownerId: playerId, controllerId: playerId, zone: 'base', might, effects: [], tags: [], keywords: [], damage: 0, buffs: 0, mightModifier: 0, exhausted: false, attachments: []});
function actionGame() {
  const g = baseGame();
  Object.assign(g, {phase:'action', currentPlayerId:'p1', turnNumber:6, turnSequence:10, pendingChoice:null, pendingPayment:null, actionChain:null, showdown:null});
  g.battlefields=Object.values(cards).filter(c=>c.type==='battlefield').slice(0,2).map((c,i)=>({...structuredClone(c),instanceId:`audit-field-${i}`}));
  for (const p of g.players) Object.assign(p, {base:[], turnScoredBattlefields:[]});
  for (const f of g.battlefields) Object.assign(f, {units:[], hidden:[], controlledBy:null, effects:[]});
  return g;
}
function diffCount(a, b) { return a.reduce((n,x,i) => n + (x !== b[i] ? 1 : 0), 0); }

{
  const a = actionGame();
  a.players[0].score = 7;
  a.players[0].base = [unit('audit-mover','p1')];
  const b = structuredClone(a);
  b.players[0].turnScoredBattlefields = [b.battlefields[0].instanceId];
  const action = {kind:'moveUnit', unitId:'audit-mover', destinationId:a.battlefields[1].instanceId};
  const stateDifferences = diffCount(encodeState(a,'p1'), encodeState(b,'p1'));
  const actionDifferences = diffCount(encodeAction(a,'p1',action), encodeAction(b,'p1',action));
  const ra = moveUnit(a,action.unitId,action.destinationId);
  const rb = moveUnit(b,action.unitId,action.destinationId);
  assert.ok(ra.ok && rb.ok);
  for(const g of [a,b]) for(let i=0;i<8&&(g.showdown||g.actionChain)&&g.phase!=='complete';i++) assert.ok(applyAiAction(g,{kind:'passShowdown'},activeActorId(g)).ok);
  assert.equal(stateDifferences,0);
  assert.equal(actionDifferences,0);
  assert.notEqual(a.winnerId,b.winnerId);
  out.checks.scoringHistory = {stateDifferences,actionDifferences,withoutOtherFieldScored:{score:a.players[0].score,winner:a.winnerId ?? null},withOtherFieldScored:{score:b.players[0].score,winner:b.winnerId ?? null}};
}
{
  const g = actionGame();
  const u = unit('audit-damaged','p1',6);
  u.damage=5;
  g.battlefields[0].units=[u];
  out.checks.damageMight = {actualCombatMight:currentCombatMight(g,g.battlefields[0],u,'attacker'),encodedAggregateMight:encodeState(g,'p1')[11]*40,individualObservedMight:observeGame(g,'p1').battlefields[0].units[0].might};
  assert.equal(out.checks.damageMight.actualCombatMight,6);
  assert.ok(Math.abs(out.checks.damageMight.encodedAggregateMight-1)<1e-6);
}
{
  const g=actionGame();
  g.players[0].hand=[];
  g.players[0].base=Array.from({length:5},(_,i)=>({...unit(`group-${i}`,'p1',2),exhausted:i===4}));
  g.battlefields[1].units=[unit('defender','p2',7)];
  g.battlefields[1].controlledBy='p2';
  const target=g.battlefields[1].instanceId;
  const ids=g.players[0].base.slice(0,4).map(c=>c.instanceId);
  const legal=canStandardMoveUnits(g,ids,target);
  const policy=enumerateAiPolicyActions(g,'p1');
  const attacks=policy.filter(a=>a.destinationId===target&&['moveUnit','moveUnits'].includes(a.kind));
  out.checks.fourUnitMove={engineAllowsFourReadyUnits:legal,readyUnits:4,exhaustedUnits:1,attackingMight:8,defenderMight:7,availablePolicyAttacks:attacks.length};
  assert.ok(legal);
  assert.equal(attacks.length,0);
}
{
  const g=actionGame();
  g.players[0].hand=[];
  g.players[0].base=Array.from({length:10},(_,i)=>unit(`wide-${i}`,'p1',2));
  const legal=enumerateAiPolicyActions(g,'p1');
  const selected=encodeActionSet(g,'p1',legal);
  const fullKeys=legal.map(actionKey), encodedKeys=selected.actions.map(actionKey);
  const mismatches=encodedKeys.map((key,i)=>key!==fullKeys[i]?i:-1).filter(i=>i>=0);
  out.checks.actionIndexAfterCap={original:legal.length,encoded:selected.legalCount,mismatchedSlots:mismatches.length,firstMismatch:mismatches[0],recordedKey:fullKeys[mismatches[0]],actualEncodedKey:encodedKeys[mismatches[0]]};
  assert.ok(legal.length>MAX_ACTIONS);
  assert.ok(mismatches.length>0);
}
{
  const g=actionGame();
  g.players[1].mainDeck.push(...g.players[1].hand);
  g.players[1].hand=[];
  g.players[1].runes=g.players[1].runeDeck.splice(0,6);
  for (const r of g.players[1].runes) r.exhausted=false;
  const belief=inferOpponentDeckBelief(g,'p1');
  out.checks.emptyHand={handCount:0,nonzeroCardProbabilities:belief.cardProbabilities.filter(x=>x.probability>0).length,maximumCardProbability:Math.max(...belief.cardProbabilities.map(x=>x.probability)),response:opponentResponseProfile(g,'p1')};
  assert.ok(out.checks.emptyHand.nonzeroCardProbabilities>0);
  assert.ok(out.checks.emptyHand.response.responseProbability>0);
}
{
  const g=baseGame();
  const hidden=determinizationStatus(determinizeGame(g,'p1',inferOpponentDeckBelief(g,'p1'),seededRandom(1)));
  g.revealedIntel=[{viewerId:'p1',ownerId:'p2',expiresAtTurnSequence:g.turnSequence}];
  const observed=observeGame(g,'p1').opponent.hand.length;
  const revealed=determinizationStatus(determinizeGame(g,'p1',inferOpponentDeckBelief(g,'p1'),seededRandom(1)));
  out.checks.revealedHand={observed,hidden,revealed};
  assert.ok(hidden.complete);
  assert.ok(observed>0);
  assert.equal(revealed.complete,false);
}
{
  const g=baseGame();
  const card=g.players[1].hand[0];
  const before=encodeOpponentDeckTarget(g,'p1')[cardIndex(card.cardNumber)];
  g.players[1].hand.shift();
  g.actionChain={priorityPlayerId:'p1',chain:[{kind:'spell',playerId:'p2',card}]};
  const during=encodeOpponentDeckTarget(g,'p1')[cardIndex(card.cardNumber)];
  g.actionChain=null;
  g.players[1].trash.push(card);
  const after=encodeOpponentDeckTarget(g,'p1')[cardIndex(card.cardNumber)];
  out.checks.deckTargetZones={card:card.cardNumber,before,during,after};
  assert.ok(before>during);
  assert.equal(before,after);
  const chosen=g.players[1].champion;
  if(chosen){
    const beforePlay=encodeOpponentDeckTarget(g,'p1')[cardIndex(chosen.cardNumber)];
    g.players[1].base.push({...chosen,zone:'played'});
    const afterPlay=encodeOpponentDeckTarget(g,'p1')[cardIndex(chosen.cardNumber)];
    out.checks.championDeckTarget={card:chosen.cardNumber,beforePlay,afterPlay};
    assert.ok(afterPlay>beforePlay);
  }
}
{
  const all=[...new Set(Object.values(cards).map(c=>c.cardNumber).filter(Boolean))];
  const missing=all.filter(n=>!cardIndex(n));
  out.checks.vocabulary={registered:all.length,vocabulary:CARD_VOCABULARY.length,unknown:missing.length,unknownBySet:Object.fromEntries(['OGN','OGS','SFD','UNL'].map(p=>[p,missing.filter(n=>n.startsWith(p)).length])),examples:missing.slice(0,8)};
}
{
  const s=await readFile(new URL('../../scripts/train-neural-ai.mjs',import.meta.url),'utf8');
  const names=['teacherFraction','teacherBudget','teacherCriticalBudget','teacherActionAuditBudget','anchorCoefficient','turningPointReplayFraction','turningPointReplayLimit'];
  out.checks.zeroOptions={};
  for(const name of names){
    const m=s.match(new RegExp('const '+name+' = ([\\s\\S]*?);'));
    if(!m) continue;
    const args=new Proxy({}, {get(){return '0'}});
    const parsed=Function('args','return ('+m[1]+')')(args);
    out.checks.zeroOptions[name]={requested:0,actual:parsed};
    assert.ok(parsed>0);
  }
}
{
  out.checks.gaeHorizon={};
  for(const n of [1,10,50,100,200]){
    const steps=Array.from({length:n},()=>({value:0}));
    applyGeneralizedAdvantageEstimation(steps,1,.997,.95,0,0,{longLambda:.985,longWeight:.6});
    out.checks.gaeHorizon[n]={initialReturn:steps[0].return,terminalDiscountOnly:.997**(n-1)};
  }
}
{
  const checkpoint=JSON.parse(await readFile(new URL('../../src/ai/checkpoints/neural-champion.json',import.meta.url),'utf8'));
  out.checkpoint={version:checkpoint.version,generation:checkpoint.generation,gamesTrained:checkpoint.gamesTrained,algorithm:checkpoint.metadata?.algorithm,evaluatorArchitecture:checkpoint.metadata?.evaluatorArchitecture ?? null,cardPool:checkpoint.metadata?.cardPool ?? null};
}

const model=createNeuralModel();
try {
  const originalValueApply=model.layers.value.apply;
  const evaluatorInputs=[];
  model.layers.value.apply=function(input,...args){evaluatorInputs.push(Array.from(input.dataSync()).join(','));return originalValueApply.call(this,input,...args)};
  try {
    const results=rolloutAlternatives(actionGame(),'p1',[{kind:'endTurn'}],DEFAULT_AI_MODEL,{simulations:1,depth:1,evaluatorModels:[model],evaluatorModelsCertified:true,random:seededRandom(77)});
    out.checks.duplicateEvaluator={valueCalls:evaluatorInputs.length,distinctInputs:new Set(evaluatorInputs).size,validSimulations:results[0]?.validSimulations ?? null};
    assert.ok(evaluatorInputs.length>=2);
    assert.ok(new Set(evaluatorInputs).size<evaluatorInputs.length);
  } finally {model.layers.value.apply=originalValueApply;}
  const g=actionGame();
  const state=encodeState(g,'p1');
  const actionSet=encodeActionSet(g,'p1',[{kind:'endTurn'}]);
  const run=(count)=>tf.tidy(()=>{
    const output=forwardNeural(model,tf.tensor3d(state,[1,1,STATE_DIM]),tf.tensor4d(actionSet.encoded.subarray(0,count*ACTION_DIM),[1,1,count,ACTION_DIM]));
    return {logit:output.logits.dataSync()[0],value:output.value.dataSync()[0],belief:output.belief.dataSync()[0],memory:Array.from(output.memoryState.dataSync())};
  });
  const one=run(1),full=run(MAX_ACTIONS);
  assert.ok(Math.abs(one.logit-full.logit)<1e-5);
  assert.deepEqual(one.memory,full.memory);
  const timings={1:[],192:[]};
  for(let i=0;i<12;i++)for(const count of (i%2?[192,1]:[1,192])){
    const t=performance.now();run(count);timings[count].push(performance.now()-t);
  }
  const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
  out.checks.padding={legalActions:1,computedActions:192,equivalentOutputs:true,medianOneMs:median(timings[1]),medianPaddedMs:median(timings[192]),batch4Sequence128ActionsBytes:4*128*MAX_ACTIONS*ACTION_DIM*4,actionDim:ACTION_DIM,stateDim:STATE_DIM};
  const width=model.layers.actionValue.getWeights()[0].shape[0];
  const kernel=new Float32Array(width);kernel[0]=1;kernel[width/2]=1;
  const tensors=[tf.tensor2d(kernel,[width,1]),tf.tensor1d([0])];
  model.layers.actionValue.setWeights(tensors);tensors.forEach(x=>x.dispose());
  const q=(s,a)=>tf.tidy(()=>{const x=new Float32Array(width);x[0]=s;x[width/2]=a;return model.layers.actionValue.apply(tf.tensor2d(x,[1,width])).dataSync()[0]});
  out.checks.actionValueSeparability=[-1,1].map(s=>({state:s,actionA:q(s,1),actionB:q(s,-1)}));
  assert.ok(out.checks.actionValueSeparability.every(x=>x.actionA>x.actionB));
} finally {disposeNeuralModel(model);}
{
  const a=baseGame(),b=structuredClone(a);
  [b.players[1].hand[0],b.players[1].mainDeck[5]]=[b.players[1].mainDeck[5],b.players[1].hand[0]];
  const differences=diffCount(encodeState(a,'p1'),encodeState(b,'p1'));
  assert.equal(differences,0);
  const steps=Array.from({length:10},(_,i)=>({value:(i-5)/10}));
  applyGeneralizedAdvantageEstimation(steps,1,.997,1,0,0);
  assert.ok(Math.abs(steps[0].return-.997**9)<1e-12);
  out.controls={privateHandReplacementStateDifferences:differences,gaeLambdaOneReturn:steps[0].return,gaeLambdaOneExpected:.997**9};
}
out.sourceSha256={};
for(const file of ['actions.mjs','belief.mjs','rollout.mjs','observation.mjs','neural/encoding.mjs','neural/model.mjs','neural/selfplay.mjs','neural/trainer.mjs']) {
  out.sourceSha256[`src/ai/${file}`]=createHash('sha256').update(await readFile(new URL(`../../src/ai/${file}`,import.meta.url))).digest('hex');
}
await writeFile(new URL('./ai-training-audit-2026-09-05-results.json',import.meta.url),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));

