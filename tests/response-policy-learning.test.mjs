import test from 'node:test';
import assert from 'node:assert/strict';
import {cards,decklists} from '../src/cards.mjs';
import {createGame} from '../src/engine.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {enumerateAiPolicyActions,actionKey} from '../src/ai/actions.mjs';
import {responseProfileCatalog,publicResponseBelief,previewResponseExchange,recommendPublicResponseAction,
  RESPONSE_POLICY_CONTRACT,responsePolicyDigest,commitResponsePolicy} from '../scripts/response-policy-learning.mjs';

const context=decks=>{const profiles=responseProfileCatalog(decks);return {contract:RESPONSE_POLICY_CONTRACT,
  profiles,catalogHash:responsePolicyDigest(profiles),maximumCandidates:4,maximumResponses:3,maximumStates:192,maximumReviewsPerGame:8};};
const deck=id=>Object.values(decklists).find(d=>d.id===id);
function combat({counter=false}={}){
  const setup=tacticalPosition({attacker:true,enemyMight:3});const {game,actor,opponent}=setup;
  actor.hand=counter?[{...structuredClone(cards.defy),instanceId:'counter',ownerId:'p1',controllerId:'p1',zone:'hand'}]:[];
  actor.runes.forEach(r=>r.domain='Calm');
  opponent.hand=[{...structuredClone(cards.discipline),instanceId:'private-card',ownerId:'p2',controllerId:'p2'}];
  opponent.runes=actor.runes.map((r,i)=>({...r,instanceId:`opp-${i}`,ownerId:'p2',controllerId:'p2',domain:'Fury'}));
  const move=enumerateAiPolicyActions(game,'p1').find(a=>a.kind==='moveUnit'&&a.destinationId==='field');
  assert.ok(move);return {...setup,move};
}

test('new public catalogue includes authored variants and does not inspect private deck identity',()=>{
  const original=deck('proving-grounds-annie'),added=structuredClone(original);
  added.id='public-new-annie';added.main[0]=structuredClone(cards.hextechRay);
  const ctx=context([original,added]);const game=createGame({decks:[added,added],interactive:true,randomSeed:177});
  const opponent=game.players[1];opponent.hand=opponent.mainDeck.splice(0,5);
  const belief=publicResponseBelief(game,'p1',ctx);
  assert.ok(belief.candidates.some(c=>c.cardNumber===cards.hextechRay.cardNumber&&c.probability>0));
  const changed=structuredClone(game);changed.players[1].deckId='secret-changed';
  changed.players[1].hand=changed.players[1].hand.map((c,i)=>({...cards.defy,instanceId:`secret-${i}`,ownerId:'p2'}));
  changed.players[1].mainDeck.reverse();
  assert.deepEqual(publicResponseBelief(changed,'p1',ctx),belief);
  assert.equal(belief.catalogComplete,false);assert.equal(belief.scope,'conditional-on-public-catalogue');
});

test('unsupported public cards lower confidence instead of treating the sole catalogue list as certain',()=>{
  const d=deck('proving-grounds-annie'),game=createGame({decks:[d,d],interactive:true,randomSeed:2});
  game.players[1].trash.push({...structuredClone(cards.hextechRay),instanceId:'public-ray',ownerId:'p2',controllerId:'p2'});
  const belief=publicResponseBelief(game,'p1',context([d]));
  assert.equal(belief.confidence,'low');assert.ok(belief.unsupportedObservedCards.includes(cards.hextechRay.cardNumber));
});

test('opening combat permits an Action response on an empty chain after movement',()=>{
  const {game,move}=combat(),before=structuredClone(game);
  const pass=previewResponseExchange(game,'p1',move),hit=previewResponseExchange(game,'p1',move,cards.hextechRay);
  assert.ok(pass.searchComplete&&hit.searchComplete);assert.equal(game.showdown,null);
  assert.equal(hit.available,true);assert.equal(hit.availableWindow,'open-combat');
  assert.equal(hit.opponentUsesCard,true);assert.ok(hit.score<pass.score);
  assert.deepEqual(game,before);
});

test('own affordable counter changes the evaluated response outcome',()=>{
  const {game,move}=combat({counter:true});
  const without=previewResponseExchange(game,'p1',move,cards.hextechRay,{allowCounter:false});
  const withCounter=previewResponseExchange(game,'p1',move,cards.hextechRay);
  assert.ok(without.searchComplete&&withCounter.searchComplete);
  assert.ok(withCounter.countersConsidered>0);assert.ok(withCounter.score>without.score);
});

test('public board response abilities are considered even when the opponent has no hand cards',()=>{
  const {game,actor,opponent,field,move}=combat();actor.hand=[];opponent.hand=[];
  opponent.base=[{...structuredClone(field.units[0]),instanceId:'public-ability',might:0,energy:2,exhausted:false,
    effects:[{timing:'activated',abilityId:'ping',kind:'dealDamageUnit',target:'enemyUnit',amount:3,
      exhaust:true,abilityKeywords:['Reaction']}]}];
  const result=previewResponseExchange(game,'p1',move);
  assert.equal(result.searchComplete,true);assert.equal(result.opponentUsesAbility,true);
  const without=structuredClone(game);without.players[1].base[0].effects=[];
  assert.ok(result.score<previewResponseExchange(without,'p1',move).score);
});

test('opponent passes when spending a card produces no benefit, and unavailable payments are not assumed',()=>{
  const {game,actor,opponent,field,move}=combat();actor.base[0].might=8;field.units[0].might=1;
  const expensive={...structuredClone(cards.hextechRay),energy:7,power:[]};
  const baseline=previewResponseExchange(game,'p1',move),waste=previewResponseExchange(game,'p1',move,expensive);
  assert.ok(waste.searchComplete);assert.equal(waste.available,true);assert.equal(waste.opponentUsesCard,false);
  assert.equal(waste.score,baseline.score);
  opponent.runes=[];
  const unavailable=previewResponseExchange(game,'p1',move,cards.hextechRay);
  assert.ok(unavailable.searchComplete);assert.equal(unavailable.available,false);
});

test('counterfactual search is independent of private opponent cards, and exhausted search stays unknown',()=>{
  const {game,move}=combat({counter:true}),changed=structuredClone(game);
  changed.players[1].hand=[{...cards.hextechRay,instanceId:'different-secret',ownerId:'p2'}];
  changed.players[1].mainDeck.reverse();
  assert.deepEqual(previewResponseExchange(game,'p1',move,cards.hextechRay),previewResponseExchange(changed,'p1',move,cards.hextechRay));
  const partial=previewResponseExchange(game,'p1',move,cards.hextechRay,{maximumStates:1});
  assert.equal(partial.searchComplete,false);assert.equal(partial.score,null);assert.equal(partial.unresolvedReason,'search-budget');
});

test('action-specific response comparisons reach a soft policy lesson with explicit hand/use diagnostics',()=>{
  const {game,opponent,move}=combat();
  opponent.legend=structuredClone(cards.kaiSaDaughterOfTheVoid);
  const d=structuredClone(deck('origins-kaisa'));d.main=Array.from({length:40},()=>structuredClone(cards.hextechRay));
  const ctx=context([d]);const actions=enumerateAiPolicyActions(game,'p1');
  const decision={action:move,legalActions:actions,legalCount:actions.length,probabilities:actions.map(()=>1/actions.length)};
  const lesson=recommendPublicResponseAction(game,'p1',decision,null,ctx);
  assert.ok(lesson);assert.equal(lesson.responsePolicyLesson,true);assert.equal(lesson.winProbabilityLabel,false);
  assert.ok(actions.some(a=>actionKey(a)===actionKey(lesson.action)));
  const movement=lesson.responseReview.comparisons.find(c=>c.action.kind==='moveUnit');
  assert.equal(movement.responses[0].playableAfterAction,true);assert.equal(movement.responses[0].opponentChoosesUse,true);
  assert.ok(movement.score<movement.noHandResponseScore);
});

test('new response protocol is prospective and immutable',()=>{
  const p={...context([deck('origins-kaisa')]),afterIteration:85},state={iteration:85};
  commitResponsePolicy(state,p);assert.ok(state.responsePolicyLearningHash);
  assert.throws(()=>commitResponsePolicy(state,null));assert.throws(()=>commitResponsePolicy(state,{...p,afterIteration:86}));
  assert.throws(()=>commitResponsePolicy({iteration:86},p));
});
