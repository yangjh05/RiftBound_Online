import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {createGame,confirmFirstPlayer,selectChampion,selectBattlefield,skipMulligan,
  currentPlayer,beginPlayCard,resolveEffect,chooseEffectOption} from '../src/engine.mjs';

function position({includeSpell=true,includeAbilities=false,showdown=false}={}) {
  const game=createGame({interactive:true,manualActionChainPriority:true});
  game.setupRandomValues=game.players.map(()=>0);confirmFirstPlayer(game);
  while(game.phase==='champion-select'){
    const p=game.players.find(p=>p.id===game.championSelectPlayerId);
    selectChampion(game,p.id,p.availableChampions[0].instanceId);
  }
  while(game.phase==='battlefield-select'){
    const p=game.players.find(p=>p.id===game.setupPlayerId);
    selectBattlefield(game,p.id,p.availableBattlefields[0].instanceId);
  }
  while(game.phase==='mulligan')skipMulligan(game);
  const player=currentPlayer(game),enemy=game.players.find(p=>p!==player);
  const instance=(card,id,owner)=>({...structuredClone(card),instanceId:id,ownerId:owner,
    controllerId:owner,zoneChangeCounter:3});
  const spell=instance(cards.windWall,'shared-source',enemy.id);
  const source=instance({...cards.windWall,energy:0,power:[],effects:[{timing:'spell',kind:'counterSpell',includeAbilities}]},'counter',player.id);
  player.hand=[source];enemy.trash=[spell];
  const chain=[{id:'trigger-a',itemType:'trigger',status:'finalized',playerId:enemy.id,card:spell},
    {id:'trigger-b',itemType:'trigger',status:'finalized',playerId:enemy.id,card:spell}];
  if(includeSpell)chain.push({id:'spell-item',itemType:'card',status:'finalized',playerId:enemy.id,card:spell});
  game.actionChain={chain,priorityPlayerId:player.id,passes:0};
  if(showdown){game.phase='showdown';game.showdown={chain,priorityPlayerId:player.id,
    focusPlayerId:player.id,attackerId:player.id,defenderId:enemy.id,
    turnPlayerId:player.id,battlefieldId:game.battlefields[0].instanceId,
    consecutivePasses:0,chainSequence:2};game.actionChain=null;}
  return {game,player,enemy,source,spell,chain};
}

for(const showdown of [false,true]) {
  test(`spell declaration ignores two abilities with the same spell source (${showdown?'showdown':'action'})`,()=>{
    const {game,source}=position({showdown});
    assert.equal(beginPlayCard(game,source.instanceId,'base').ok,true);
    assert.deepEqual(game.pendingChoice.options.map(o=>o.id),['shared-source']);
    assert.equal(game.decisionSafetyViolations?.length||0,0);
  });
  test(`a spell counter cannot be played on an ability-only chain (${showdown?'showdown':'action'})`,()=>{
    const {game,source}=position({includeSpell:false,showdown});
    assert.equal(beginPlayCard(game,source.instanceId,'base').ok,false);
    assert.equal(game.pendingChoice,null);
  });
}

test('resolution selects the actual spell and preserves abilities of that same source',()=>{
  const {game,player,source,chain}=position();
  resolveEffect(game,player,source);
  assert.deepEqual(game.pendingChoice.options.map(o=>o.id),['shared-source']);
  assert.equal(chooseEffectOption(game,'shared-source').ok,true);
  assert.deepEqual(chain.map(i=>i.id),['trigger-a','trigger-b']);
});

test('an explicit ability counter uses separate item identities and never trashes its source',()=>{
  const {game,player,enemy,source,spell,chain}=position({includeAbilities:true});
  resolveEffect(game,player,source);
  assert.deepEqual(game.pendingChoice.options.map(o=>o.id),['trigger-a','trigger-b','shared-source']);
  const zone=spell.zoneChangeCounter;
  assert.equal(chooseEffectOption(game,'trigger-b').ok,true);
  assert.deepEqual(chain.map(i=>i.id),['trigger-a','spell-item']);
  assert.equal(spell.zoneChangeCounter,zone);
  assert.equal(enemy.trash.filter(c=>c.instanceId===spell.instanceId).length,1);
});

test('a declared ability remains distinguishable when its source has another ability',()=>{
  const {game,player,source,chain}=position({includeAbilities:true});
  source.declaredPlayTargets=[{effect:'counterChainCard',targetId:'trigger-b',zoneChangeCounter:3}];
  resolveEffect(game,player,source);
  assert.equal(game.pendingChoice,null);
  assert.deepEqual(chain.map(i=>i.id),['trigger-a','spell-item']);
});
