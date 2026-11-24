import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {enumerateAiPolicyActions,cloneGame,actionKey} from '../src/ai/actions.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {isReusablePowerGear,recommendResourceDeployment,approvedResourceDeploymentReview} from '../scripts/resource-deployment-learning.mjs';
import {localResourceDecision,recommendLocalResourceDemonstration} from '../scripts/local-policy-learning.mjs';
import {approvedTeacherAdvice} from '../scripts/viktor-candidate-learning.mjs';
const instance=(c,id)=>({...structuredClone(c),instanceId:id,ownerId:'p1',controllerId:'p1',damage:0,buffs:0,mightModifier:0,attachments:[],exhausted:false});
function position({runes=3,exhausted=0,unit=cards.daringPoro}={}){
  const {game,actor,opponent}=tacticalPosition({enemy:false});
  actor.hand=[instance(cards.sealOfUnity,'source'),instance(unit,'unit')];
  actor.runes=actor.runes.slice(0,runes).map((r,i)=>({...r,domain:'Order',exhausted:i<exhausted}));
  game.turnSequence=5;game.turnNumber=3;actor.hasTakenFirstTurn=true;opponent.hasTakenFirstTurn=true;
  actor.cardsPlayedThisTurn=0;
  return {game,actor,opponent};
}
const decision=(game,id='source')=>({action:{kind:'beginPlayCard',cardId:id,destination:'base'},legalActions:enumerateAiPolicyActions(game,'p1')});
const advice=(game,id)=>recommendResourceDeployment(game,'p1',decision(game,id));
test('energy development before a power source saves one usable energy with the same final board',()=>{
  const {game}=position(),before=JSON.stringify(game),result=advice(game);
  assert.equal(result?.action.cardId,'unit');assert.equal(result.comparison,'verified-resource-deployment-order');
  const p=result.review.resourceDeploymentProof;
  assert.equal(p.alternative.energy-p.baseline.energy,1);assert.deepEqual(p.alternative.runes,p.baseline.runes);
  assert.equal(JSON.stringify(game),before);assert.equal(result.winProbabilityLabel,false);assert.equal(result.correctionEligible,false);
  assert.equal(localResourceDecision(game,'p1',decision(game).action),true);
  assert.deepEqual(recommendLocalResourceDemonstration(game,'p1',decision(game)),result);
  assert.equal(approvedTeacherAdvice(result,actionKey(decision(game).action),actionKey),true);
});
test('a source before a power-cost unit retains a rune when energy was already spent',()=>{
  const {game}=position({runes:6,exhausted:2,unit:cards.machineEvangel}),result=advice(game,'unit');
  // Machine Evangel needs five energy; keep four ready plus an existing pool.
  assert.equal(result,null);
  const p=position({runes:7,exhausted:2,unit:cards.machineEvangel});
  const actual=advice(p.game,'unit');assert.equal(actual?.action.cardId,'source');
  assert.equal(Object.values(actual.review.resourceDeploymentProof.alternative.runes).reduce((a,b)=>a+b,0),
    Object.values(actual.review.resourceDeploymentProof.baseline.runes).reduce((a,b)=>a+b,0)+1);
});
test('idle power is deferred when next-turn energy deployment preserves one extra energy',()=>{
  const {game}=position({runes:3,exhausted:3}),result=advice(game);
  assert.equal(result?.action.kind,'endTurn');assert.equal(result.comparison,'verified-idle-power-source-delay');
  assert.equal(result.review.resourceDeploymentProof.alternative.energy-result.review.resourceDeploymentProof.baseline.energy,1);
  assert.equal(result.review.resourceDeploymentProof.noKnownPowerDemand,true);
});
test('known reaction power, Legion payoffs, existing power sources, and current attacks block the delay label',()=>{
  for(const change of [
    p=>p.actor.hand.push(instance(cards.hiddenBlade,'reaction')),
    p=>p.actor.hand.push(instance(cards.vanguardCaptain,'legion')),
    p=>p.actor.base.push(instance(cards.sealOfUnity,'existing')),
    p=>p.actor.base.push(instance(cards.daringPoro,'attacker'))
  ]){const p=position({runes:3,exhausted:3});change(p);assert.notEqual(advice(p.game)?.comparison,'verified-idle-power-source-delay');}
});
test('producer identification generalizes by effect and refuses restricted or costly abilities',()=>{
  const c=structuredClone(cards.sealOfUnity);c.name='Unrelated name';c.cardNumber='TEST';assert.equal(isReusablePowerGear(c),true);
  for(const effect of [{restriction:'spell'},{killSelfCost:true},{requiresLegion:true},{costEnergy:1},{energyCost:1}]){
    const changed=structuredClone(c);Object.assign(changed.effects[0],effect);assert.equal(isReusablePowerGear(changed),false);
  }
  const p=position();p.actor.runes[0].effects=[{timing:'static',kind:'unmodeled-rune-effect'}];
  assert.equal(advice(p.game),null);
});
test('teacher cannot certify partial branches or invented proof records',()=>{
  const {game}=position();assert.equal(recommendResourceDeployment(game,'p1',decision(game),{maximumPreviews:1}),null);
  const result=advice(game);assert.equal(approvedResourceDeploymentReview({...result.review,partialSearch:true},result.comparison),false);
  assert.equal(approvedTeacherAdvice({...result,review:{applied:true}},actionKey(decision(game).action),actionKey),false);
});
test('unknown opponent hand, hidden cards, and deck order cannot alter the timing label',()=>{
  const {game,opponent}=position({runes:3,exhausted:3});opponent.hand=[instance(cards.fallingStar,'secret')];
  const changed=cloneGame(game);changed.players[1].hand=[instance(cards.singularity,'different-secret')];
  for(const p of changed.players){p.mainDeck.reverse();p.runeDeck.reverse();}
  assert.deepEqual(advice(changed),advice(game));
});

test('completed on-policy capture admits the new proof with explicit teacher version and unchanged validation',async()=>{
  const {createOnPolicyResourceCollector,RESOURCE_COLLECTION_TEACHER}=await import('../scripts/on-policy-resource-lessons.mjs');
  const {appendVerifiedResourceLessons}=await import('../scripts/on-policy-resource-bank.mjs');
  const {encodeState,encodeActionSet}=await import('../src/ai/neural/encoding.mjs');
  const {game}=position(),set=encodeActionSet(game,'p1',enumerateAiPolicyActions(game,'p1'));
  const index=set.actions.findIndex(a=>a.cardId==='source');
  const d={...decision(game),legalActions:set.actions,selectedIndex:index,legalCount:set.legalCount,
    stateEncoding:encodeState(game,'p1'),actionEncoding:set.encoded};
  const collector=createOnPolicyResourceCollector({contract:'on-policy-resource-collection-v1',role:'training',maximumReviews:2,
    learnerSeat:0,gameId:'timing-fixture',deckId:'fixture',engineFingerprint:'fixture'},
    {resolveLessonMemory:()=>[],inferStep:()=>({logits:set.actions.map((_,i)=>i===index?1:0)})});
  collector.consider(game,'p1',d,[]);const capture=collector.finish(true,{});
  assert.equal(capture.samples.length,1);assert.equal(capture.diagnostics.deploymentReviews,1);assert.equal(capture.diagnostics.deploymentProved,1);
  assert.equal(capture.teacherCriteriaUnchanged,false);assert.equal(capture.teacherContract,RESOURCE_COLLECTION_TEACHER);
  const base={bank:{training:[],validation:[]}};
  const result=appendVerifiedResourceLessons(base,null,[{path:'fixture',sha256:'fixture',result:{verifiedTrainingLessons:capture}}],
    {deckId:'fixture',engineFingerprint:'fixture',protectedKeys:new Set()});
  assert.equal(result.decisions[0].disposition,'admitted');assert.deepEqual(result.bank.validation,base.bank.validation);
  assert.equal(result.teacherCriteriaUnchanged,false);assert.equal(result.bank.training[0].steps[0].winProbabilityLabel,false);
  const forged=structuredClone(capture);forged.teacherContract='unknown';
  assert.throws(()=>appendVerifiedResourceLessons(base,null,[{result:{verifiedTrainingLessons:forged}}],{protectedKeys:new Set()}));
});
