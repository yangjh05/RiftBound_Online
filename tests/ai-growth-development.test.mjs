import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {cards,decklists} from '../src/cards.mjs';
import {enumerateAiPolicyActions,actionKey} from '../src/ai/actions.mjs';
import {conservativeGrowthProjection,createGrowthHorizonEvaluator,recommendGrowthDevelopment} from '../src/ai/growth-development.mjs';
import {previewPublicContinuation} from '../src/ai/public-continuation.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {recommendSafeTacticalAction} from '../scripts/response-aware-demonstration.mjs';
import {previewResponseExchange,recommendPublicResponseAction,responseProfileCatalog,responsePolicyDigest,
  RESPONSE_POLICY_CONTRACT} from '../scripts/response-policy-learning.mjs';
const rows=JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/ai-growth-horizon-20260927.json.gz',import.meta.url))));
const fixture=i=>structuredClone(rows.find(r=>r.index===i));
const preview=(g,id,a,options)=>previewPublicContinuation(g,id,a,{maximumStates:48,returnGame:true,...options});
const advise=(g,id,selected={kind:'endTurn'})=>recommendGrowthDevelopment(g,id,enumerateAiPolicyActions(g,id),selected,{preview});
const actor=(g,id)=>g.players.find(p=>p.id===id);
const context=game=>{
  const d=structuredClone(Object.values(decklists).find(d=>d.id==='proving-grounds-master-yi'));
  assert.ok(d);
  d.legend=structuredClone(game.players[1].legend);
  d.main=Array.from({length:40},()=>structuredClone(cards.defy));
  const profiles=responseProfileCatalog([d]);
  return {contract:RESPONSE_POLICY_CONTRACT,profiles,catalogHash:responsePolicyDigest(profiles),
    maximumCandidates:4,maximumResponses:3,maximumStates:192,maximumReviewsPerGame:8};
};

test('recorded Aurora idle turns prefer growth with a concrete next-turn deployment benefit',()=>{
  for(const [index,cardId,runes] of [[0,'c31',10],[6,'c82',9]]){
    const {game,actorId}=fixture(index),before=structuredClone(game),r=advise(game,actorId);
    assert.ok(r);assert.equal(r.action.cardId,cardId);
    const hold=r.comparisons.find(c=>c.action.kind==='endTurn'),growth=r.comparisons.find(c=>actionKey(c.action)===actionKey(r.action));
    assert.equal(growth.nextTurnRunes,runes);assert.ok(growth.readyAfterDeployment>hold.readyAfterDeployment);
    assert.equal(r.winProbabilityLabel,false);assert.deepEqual(game,before);
    if(index===6)assert.ok(growth.affordableDeployments.some(a=>a.cardId==='c99'));
    const legal=enumerateAiPolicyActions(game,actorId),probabilities=legal.map(()=>1/legal.length);
    const result=reviewRuntimeTacticalAction(game,actorId,{action:{kind:'endTurn'},legalActions:legal,probabilities},legal,
      {now:()=>0,includeGrowthDemonstrations:true});
    assert.equal(result.review.reason,'future-development');assert.equal(result.review.growthLesson,true);
    assert.equal(result.selection.probability,probabilities[result.selection.selectedIndex]);
    assert.deepEqual(result.selection.action,r.action);
  }
});

test('growth calculation is invariant to card names, private cards and unseen deck orders',()=>{
  const {game,actorId}=fixture(6),baseline=advise(game,actorId);
  for(const p of game.players){p.mainDeck.reverse();p.runeDeck.reverse();
    for(const c of [...p.hand,...p.runeDeck])c.name='renamed card';
    if(p.id!==actorId)p.hand=p.hand.map(c=>({...c,...structuredClone(cards.catalyst),instanceId:c.instanceId}));
  }
  assert.deepEqual(advise(game,actorId),baseline);
  const projected=conservativeGrowthProjection(game);
  assert.ok(projected.players.every(p=>p.runeDeck.every(c=>c.domain==='Unknown')));
  projected.players[0].runeDeck[0].keywords=['Accelerate'];
  assert.equal(conservativeGrowthProjection(projected),null);
});

test('growth never delays a legal immediate unit deployment or an available movement',()=>{
  const {game,actorId}=fixture(6),p=actor(game,actorId);
  p.champion.energy=2;assert.equal(advise(game,actorId),null);
  p.championPlayed=true;
  const unit=p.hand.find(c=>c.type==='unit');unit.energy=1;unit.power=[];
  assert.equal(advise(game,actorId),null);
  p.base.push({...structuredClone(unit),instanceId:'ready-to-score',exhausted:false});
  p.hand=p.hand.filter(c=>c!==unit);
  assert.ok(enumerateAiPolicyActions(game,actorId).some(a=>a.kind==='moveUnit'));
  assert.equal(advise(game,actorId),null);
});

test('near defeat, no remaining runes, and no known next-turn deployments produce no growth lesson',()=>{
  const {game,actorId}=fixture(6),p=actor(game,actorId),opponent=game.players.find(p=>p.id!==actorId);
  opponent.score=6;assert.equal(advise(game,actorId),null);opponent.score=0;
  const runeDeck=p.runeDeck;p.runeDeck=[];assert.equal(advise(game,actorId),null);p.runeDeck=runeDeck;
  p.championPlayed=true;p.hand=p.hand.filter(c=>!['unit','gear'].includes(c.type));
  assert.equal(advise(game,actorId),null);
});

test('growth cannot spend the last affordable response when opposing units can act',()=>{
  const {game,actorId}=fixture(0),p=actor(game,actorId);
  const catalyst=p.hand.find(c=>c.instanceId==='c31');catalyst.energy=6;
  assert.ok(enumerateAiPolicyActions(game,actorId).some(a=>a.cardId===catalyst.instanceId));
  assert.equal(advise(game,actorId),null);
});

test('future turn projection preserves our visible hand and never assumes the opponent private hand',()=>{
  const {game,actorId}=fixture(0),projected=conservativeGrowthProjection(game),opponent=game.players.find(p=>p.id!==actorId);
  const first=preview(projected,actorId,{kind:'endTurn'});assert.ok(first.searchComplete);
  const second=preview(first.game,actorId,{kind:'endTurn'},{firstActorId:opponent.id});assert.ok(second.searchComplete);
  const before=actor(game,actorId).hand.map(c=>c.instanceId),after=actor(second.game,actorId).hand;
  assert.ok(before.every(id=>after.some(c=>c.instanceId===id&&c.type!=='unknown')));
  assert.ok(actor(second.game,opponent.id).hand.every(c=>c.type==='unknown'));
  assert.ok(after.some(c=>c.type==='unknown'));
});

test('incomplete future projections cannot authorize a new action',()=>{
  const {game,actorId}=fixture(6),legal=enumerateAiPolicyActions(game,actorId),selected={kind:'endTurn'};
  assert.equal(recommendGrowthDevelopment(game,actorId,legal,selected,{preview:()=>null}),null);
  const result=reviewRuntimeTacticalAction(game,actorId,{action:selected},legal,
    {maximumPreviews:1,now:()=>0,includeGrowthDemonstrations:true});
  assert.deepEqual(result.selection.action,selected);assert.equal(result.review.applied,false);
});

test('growth lessons keep their future-horizon provenance through tactical teaching',()=>{
  const {game,actorId}=fixture(6),legal=enumerateAiPolicyActions(game,actorId);
  const lesson=recommendSafeTacticalAction(game,actorId,legal,{selectedAction:{kind:'endTurn'}});
  assert.equal(lesson.growthLesson,true);assert.equal(lesson.developmentHorizon,'next-own-turn-known-deployment');
  assert.equal(lesson.correctionEligible,false);assert.equal(lesson.winProbabilityLabel,false);
  const live=reviewRuntimeTacticalAction(game,actorId,{action:{kind:'endTurn'}},legal,{now:()=>0});
  assert.notEqual(live.review.reason,'future-development');
});

test('response minimax uses the same future endpoint, including the opponent choice to counter growth',()=>{
  const {game,actorId}=fixture(0),g=conservativeGrowthProjection(game),p=actor(g,actorId);
  const growth={kind:'beginPlayCard',cardId:'c31',destination:'base'};
  const opponent=g.players.find(p=>p.id!==actorId);opponent.runes.forEach(r=>r.exhausted=false);
  const horizon=createGrowthHorizonEvaluator(game,actorId,preview);
  const opts={evaluateLeaf:g=>horizon(g)?.score,maximumStates:192};
  const no=previewResponseExchange(g,actorId,growth,null,opts);
  const counter=previewResponseExchange(g,actorId,growth,cards.defy,opts);
  assert.ok(no.searchComplete&&counter.searchComplete);assert.equal(counter.available,true);
  assert.equal(counter.opponentUsesCard,true);assert.ok(counter.score<no.score);
  assert.equal(previewResponseExchange(g,actorId,growth,null,{evaluateLeaf:()=>null}).searchComplete,false);
  assert.ok(p.hand.some(c=>c.instanceId==='c31'));
});

test('probabilistic response lessons compare growth and hold at the same horizon',()=>{
  const {game,actorId}=fixture(0),opponent=game.players.find(p=>p.id!==actorId);
  opponent.runes.forEach(r=>r.exhausted=false);opponent.trash=[];
  const legal=enumerateAiPolicyActions(game,actorId),decision={action:{kind:'endTurn'},legalActions:legal,
    legalCount:legal.length,probabilities:legal.map(()=>1/legal.length)};
  const fallback=recommendSafeTacticalAction(game,actorId,legal,{selectedAction:decision.action});
  assert.ok(fallback?.growthLesson);
  const lesson=recommendPublicResponseAction(game,actorId,decision,fallback,context(game));
  assert.ok(lesson);assert.equal(lesson.growthLesson,true);
  assert.equal(lesson.responseReview.searchScope,'post-action-response-and-next-own-turn');
  assert.ok(lesson.responseReview.horizonPreviews<=48);assert.equal(lesson.winProbabilityLabel,false);
  assert.ok(lesson.responseReview.comparisons.some(c=>c.responses.some(r=>r.opponentChoosesUse)));
  const growth=lesson.responseReview.comparisons.find(c=>c.action.kind==='beginPlayCard');
  assert.ok(growth.score<growth.noHandResponseScore);
});
