import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {applyAiAction,enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {previewTacticalAction,recommendPublicTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {planPublicTurn,turnCandidatePriority} from '../src/ai/turn-planner.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
const card=(source,id,owner='p1')=>({...structuredClone(source),instanceId:id,ownerId:owner,controllerId:owner,
 damage:0,buffs:0,mightModifier:0,attachments:[],exhausted:false});
const play=id=>({kind:'beginPlayCard',cardId:id,destination:'base'});

function combo({might=7,damage=0,runes=8,followup=true}={}){
 const p=tacticalPosition({enemyMight:might,enemyCost:7});
 p.actor.hand=[card(cards.smokeScreen,'weaken'),...(followup?[card(cards.fallingStar,'damage')]:[])];
 p.actor.runes=p.actor.runes.slice(0,runes);p.actor.runes.forEach((r,i)=>r.domain=i%2?'Mind':'Fury');
 p.field.units[0].damage=damage;p.opponent.score=6;p.actor.score=3;
 return p;
}

test('weakening then damage is available and taught even without any friendly attacker',()=>{
 const {game}=combo(),before=JSON.stringify(game),legal=enumerateAiPolicyActions(game,'p1');
 assert.ok(legal.some(a=>a.cardId==='weaken'));
 const plan=planPublicTurn(game,'p1',play('weaken'),{previewTacticalAction});
 assert.ok(plan?.steps.some(a=>a.cardId==='damage'));
 assert.equal(plan.game.players[1].trash.some(c=>c.instanceId==='enemy'),true);
 const advice=recommendPublicTacticalAction(game,'p1',legal);
 assert.ok(advice);assert.ok(advice.continuation.some(a=>a.cardId==='weaken'));
 assert.ok(advice.continuation.some(a=>a.cardId==='damage'));
 assert.equal(advice.winProbabilityLabel,false);
 assert.equal(JSON.stringify(game),before);
});

test('weakening an already damaged enemy can remove it without spending a damage spell',()=>{
 const {game}=combo({might:7,damage:3,followup:false});
 assert.ok(enumerateAiPolicyActions(game,'p1').some(a=>a.cardId==='weaken'));
 const outcome=previewTacticalAction(game,'p1',play('weaken'),{returnGame:true});
 assert.equal(outcome.game.players[1].trash.some(c=>c.instanceId==='enemy'),true);
});

test('temporary weakening with neither affordable removal nor combat payoff stays excluded',()=>{
 for(const settings of [{followup:false},{runes:2},{might:20}]){
  const {game}=combo(settings);
  assert.ok(!enumerateAiPolicyActions(game,'p1').some(a=>a.cardId==='weaken'),JSON.stringify(settings));
 }
});

test('a damage spell that already kills does not justify wasting a weakening card first',()=>{
 const {game}=combo({might:3});
 assert.ok(!enumerateAiPolicyActions(game,'p1').some(a=>a.cardId==='weaken'));
 assert.equal(recommendPublicTacticalAction(game,'p1',enumerateAiPolicyActions(game,'p1'))?.action.cardId,'damage');
});

test('joint removal and combat allocation keeps the second removal spell in hand',()=>{
 const {game,actor,opponent,field}=tacticalPosition();
 field.instanceId='small-field';field.units=[card(cards.poutyPoro,'small','p2')];
 game.battlefields.push({...structuredClone(field),instanceId:'large-field',units:[card(cards.noxusHopeful,'large','p2')]});
 actor.base=[card(cards.noxusHopeful,'attacker'),card(cards.lecturingYordle,'capturer')];
 actor.hand=[card(cards.voidSeeker,'seeker'),card(cards.fallingStar,'reserve')];
 actor.legend=card(cards.kaiSaDaughterOfTheVoid,'legend');
 actor.runes.forEach(r=>r.domain='Mind');opponent.score=4;
 const outcome=planPublicTurn(game,'p1',play('seeker'),{previewTacticalAction});
 assert.ok(outcome.steps.some(a=>a.optionId==='large'));
 assert.ok(outcome.game.players[0].hand.some(c=>c.instanceId==='reserve'));
 assert.ok(outcome.game.battlefields.every(f=>f.controlledBy==='p1'));
 assert.ok(outcome.game.players[1].trash.some(c=>c.instanceId==='small'));
 assert.ok(outcome.game.players[1].trash.some(c=>c.instanceId==='large'));
 assert.equal(outcome.opponentResponsesCompared,false);
});

test('a lethal spell declaration stays ahead of redundant movement candidates before target selection',()=>{
 const {game,actor,field}=tacticalPosition({enemyMight:4});
 actor.hand=[card(cards.voidSeeker,'seeker')];
 actor.base=Array.from({length:5},(_,i)=>card(cards.noxusHopeful,`unit${i}`));
 const legal=enumerateAiPolicyActions(game,'p1');
 assert.ok(legal.filter(a=>['moveUnit','moveUnits'].includes(a.kind)).length>8);
 const ranked=legal.map(action=>({action,score:turnCandidatePriority(game,'p1',action)}))
   .sort((a,b)=>b.score-a.score).slice(0,8);
 assert.ok(ranked.some(({action})=>action.cardId==='seeker'));
});
