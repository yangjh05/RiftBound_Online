import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {moveUnits,currentCombatMight,passShowdown,actingPlayer} from '../src/engine.mjs';
import {movementProfile} from '../src/ai/action-tactics.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';

const effectCard=kind=>Object.values(cards).find(c=>c.effects?.some(e=>e.kind===kind));
function compare({attackerEffects=[],defenderEffects=[],extraAttacker=false,fieldEffects=[],support=false}={}){
  const {game,actor,field}=tacticalPosition({attacker:true,enemyMight:4});
  actor.base[0].might=3;
  actor.legend.effects=[];game.players[1].legend.effects=[];
  actor.base[0].effects=attackerEffects;actor.base[0].keywords=[];
  field.units[0].effects=defenderEffects;field.units[0].keywords=[];
  field.effects=fieldEffects;
  if(extraAttacker)actor.base.push({...structuredClone(actor.base[0]),instanceId:'second',effects:[],might:1});
  const ids=actor.base.filter(c=>c.type==='unit').map(c=>c.instanceId);
  if(support)actor.base.push({...structuredClone(actor.base[0]),instanceId:'support',effects:[{timing:'static',kind:'otherFriendlyHereMight',amount:5}]});
  const action={kind:'moveUnits',unitIds:ids,destinationId:field.instanceId};
  const before=structuredClone(game),profile=movementProfile(game,actor.id,action);
  assert.deepEqual(game,before,'projection must not mutate the live board');
  const actual=structuredClone(game);
  assert.ok(moveUnits(actual,ids,field.instanceId).ok);
  const destination=actual.battlefields.find(f=>f.instanceId===field.instanceId);
  const might=side=>destination.units.filter(u=>(u.controllerId===actor.id)===side)
    .reduce((n,u)=>n+(u.stunned?0:currentCombatMight(actual,destination,u,side?'attacker':'defender')),0);
  assert.equal(profile.attackingMight,might(true));
  assert.equal(profile.defendingMight,might(false));
  assert.equal(profile.movingMight,might(true));
  return {profile,actual};
}

test('destination projection assigns the whole attacking group before resolving conditional Might',()=>{
  const card=effectCard('selfMightWhileAttackingWithAnother');
  compare({attackerEffects:card.effects,extraAttacker:true});
});
test('destination projection includes both sides of one-on-one doubling',()=>{
  const card=effectCard('doubleMightOneOnOneCombat');
  compare({attackerEffects:card.effects});
  const {profile}=compare({defenderEffects:card.effects});
  assert.equal(profile.enemyLethalThreshold,8);
});
test('one-on-one doubling stops applying against a group',()=>{
  compare({defenderEffects:effectCard('doubleMightOneOnOneCombat').effects,extraAttacker:true});
});
test('aura left in base cannot buff movers at their destination',()=>compare({support:true}));
test('destination battlefield Might modifiers affect movers and defenders',()=>{
  compare({fieldEffects:[{timing:'static',kind:'unitsHereMight',amount:-1}]});
});

test('a defending legend debuff is resolved before projecting attack damage',()=>{
  const {game,actor,opponent,field}=tacticalPosition({attacker:true,enemyMight:4});
  opponent.legend.effects=structuredClone(effectCard('enemyAttacksControlledBattlefieldMightReduction').effects);
  const action={kind:'moveUnit',unitId:'attacker',destinationId:field.instanceId};
  const before=structuredClone(game),profile=movementProfile(game,actor.id,action);
  const actual=structuredClone(game);assert.ok(moveUnits(actual,['attacker'],field.instanceId).ok);
  for(let i=0;i<20&&(actual.showdown?.chain?.length||actual.actionChain);i++)
    assert.ok(passShowdown(actual,actingPlayer(actual).id).ok);
  const moved=actual.battlefields[0].units.find(u=>u.instanceId==='attacker');
  assert.equal(profile.attackingMight,currentCombatMight(actual,actual.battlefields[0],moved,'attacker'));
  assert.equal(profile.attackingMight,3);
  assert.equal(profile.canRemoveEnemyNoResponse,false);
  assert.deepEqual(game,before);
});

test('an unresolved entry target is neither a proven gain nor a proven pointless move',()=>{
  const {game,actor,field}=tacticalPosition({attacker:true,enemyMight:6});
  actor.base[0].effects=structuredClone(cards.leonaDetermined.effects);
  const profile=movementProfile(game,actor.id,{kind:'moveUnit',unitId:'attacker',destinationId:field.instanceId});
  assert.equal(profile.movementTriggersUnresolved,true);
  assert.equal(profile.strictlyBeneficial,false);
  assert.equal(profile.noOpponentImpact,false);
});
