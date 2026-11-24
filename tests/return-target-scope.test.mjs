import test from 'node:test';
import assert from 'node:assert/strict';
import {cards,DOMAINS,makeRune} from '../src/cards.mjs';
import {beginPlayCard,chooseEffectOption,confirmFirstPlayer,createGame,currentPlayer,
  confirmPayment,declineEffectChoice,moveUnit,passShowdown,resolveEffect,selectBattlefield,selectChampion,skipMulligan,togglePaymentRune} from '../src/engine.mjs';

function instance(card,ownerId,id) {
  return {...structuredClone(card),instanceId:id,ownerId,controllerId:ownerId,
    exhausted:false,damage:0,stunned:false,buffs:0,mightModifier:0};
}

function position(key,kind) {
  const game=createGame({interactive:true,manualActionChainPriority:true});
  game.setupRandomValues=game.players.map(()=>0);
  confirmFirstPlayer(game);
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
  const source=instance({...cards[key],energy:0,power:[]},player.id,'source');
  // Resolve the printed effect in isolation without unrelated entry triggers.
  if(kind)source.effects=source.effects.filter(s=>s.kind===kind);
  const unit=(id,owner=player.id,more={})=>instance({...cards.lonelyPoro,...more},owner,id);
  const friendlyBase=unit('friendly-base'),enemyBase=unit('enemy-base',enemy.id);
  const friendly=unit('friendly-field'),opposing=unit('enemy-field',enemy.id);
  player.base=[friendlyBase];enemy.base=[enemyBase];
  game.battlefields[0].units=[friendly,opposing];
  game.battlefields[1].units=[unit('other-enemy',enemy.id)];
  player.hand=[source];
  return {game,player,enemy,source,unit,friendlyBase,enemyBase,friendly,opposing};
}

const targets=game=>(game.pendingChoice?.options||[]).filter(o=>o.cardId).map(o=>o.cardId).sort();

function playSourceAtField({game,player,source}) {
  // Entry permission is unrelated to the target contract being tested.
  source.keywords.push('Reaction');
  game.battlefields[0].controlledBy=player.id;
  assert.equal(beginPlayCard(game,source.instanceId,game.battlefields[0].instanceId).ok,true);
  for(let i=0;i<12&&!game.pendingChoice;i++){
    if(game.pendingPayment)assert.equal(confirmPayment(game).ok,true);
    else if(game.actionChain)assert.equal(passShowdown(game,game.actionChain.priorityPlayerId).ok,true);
    else break;
  }
  assert.ok(game.pendingChoice?.data.declareTrigger,'targets are declared before trigger resolution');
}

function finishChain(game) {
  for(let i=0;i<30&&game.actionChain;i++){
    assert.equal(game.pendingChoice,null,'a declared target must not prompt for a replacement');
    assert.equal(passShowdown(game,game.actionChain.priorityPlayerId).ok,true);
  }
  assert.equal(game.actionChain,null);
}

test('Retreat declaration and resolution only allow friendly units, including the base',()=>{
  for(const declaration of [true,false]){
    const {game,player,source,opposing}=position('retreat');
    if(declaration)assert.equal(beginPlayCard(game,source.instanceId,'base').ok,true);
    else assert.equal(resolveEffect(game,player,source),true);
    assert.deepEqual(targets(game),['friendly-base','friendly-field']);
    assert.equal(chooseEffectOption(game,opposing.instanceId).ok,false);
  }
});

test('Retreat cannot be cast when only enemy units exist',()=>{
  const {game,player,source}=position('retreat');
  player.base=[];
  for(const f of game.battlefields)f.units=f.units.filter(u=>u.controllerId!==player.id);
  assert.equal(beginPlayCard(game,source.instanceId,'base').ok,false);
  assert.equal(game.pendingPayment,null);
  assert.ok(player.hand.includes(source));
});

test('Retreat rechecks control at resolution and neither retargets nor channels for an illegal target',()=>{
  const {game,player,enemy,source,friendly}=position('retreat');
  source.declaredPlayTargets=[{effect:'returnUnitToHand',targetId:friendly.instanceId}];
  friendly.controllerId=enemy.id;
  const before=enemy.runes.length;
  resolveEffect(game,player,source);
  assert.equal(game.pendingChoice,null);
  assert.ok(game.battlefields[0].units.includes(friendly));
  assert.equal(enemy.runes.length,before);
});

test('Grim Apothecary permits itself and friendly battlefield units, with an optional continuation',()=>{
  const {game,player,source}=position('unl021grimApothecary');
  playSourceAtField({game,player,source});
  assert.deepEqual(targets(game),['friendly-field','source']);
  assert.equal(game.pendingChoice.optional,true);
  assert.equal(declineEffectChoice(game).ok,true);
  assert.equal(game.pendingChoice,null);
});

test('Windsinger enforces another unit and the Might limit and remains optional',()=>{
  const {game,player,source,opposing}=position('sfd138windsinger');
  opposing.might=4;
  playSourceAtField({game,player,source});
  assert.deepEqual(targets(game),['friendly-field','other-enemy']);
  assert.equal(game.pendingChoice.optional,true);
});

test('Zaunite Bouncer cannot return itself',()=>{
  const {game,player,source}=position('zauniteBouncer');
  playSourceAtField({game,player,source});
  assert.deepEqual(targets(game),['enemy-field','friendly-field','other-enemy']);
});

test('Ocean Drake allows either base but excludes all Dragons',()=>{
  const {game,player,source,opposing}=position('ven115oceanDrake','returnBattlefieldUnitToHand');
  opposing.tags=['Dragon'];
  playSourceAtField({game,player,source});
  assert.deepEqual(targets(game),['enemy-base','friendly-base','friendly-field','other-enemy']);
  assert.equal(game.pendingChoice.optional,true);
});

test('Janna only returns an enemy from her own battlefield',()=>{
  const {game,player,source}=position('sfd053jannaSavior','returnUnitToBase');
  playSourceAtField({game,player,source});
  assert.deepEqual(targets(game),['enemy-field']);
});

test('Gust keeps its battlefield and Might restrictions in declaration and resolution',()=>{
  for(const declaration of [true,false]){
    const {game,player,source,opposing}=position('gust');opposing.might=4;
    if(declaration)assert.equal(beginPlayCard(game,source.instanceId,'base').ok,true);
    else resolveEffect(game,player,source);
    assert.deepEqual(targets(game),['friendly-field','other-enemy']);
  }
});

test('friendly battlefield return rechecks controller when its trigger resolves',()=>{
  const p=position('unl021grimApothecary');
  playSourceAtField(p);
  assert.equal(chooseEffectOption(p.game,p.friendly.instanceId).ok,true);
  p.friendly.controllerId=p.enemy.id;
  finishChain(p.game);
  assert.ok(p.game.battlefields[0].units.includes(p.friendly));
});

test('Windsinger cannot return a declared unit whose Might grew beyond the limit',()=>{
  const p=position('sfd138windsinger');
  playSourceAtField(p);
  assert.equal(chooseEffectOption(p.game,p.opposing.instanceId).ok,true);
  p.opposing.might=4;
  finishChain(p.game);
  assert.ok(p.game.battlefields[0].units.includes(p.opposing));
});

test('Ocean Drake actually returns an enemy base unit through its declared trigger',()=>{
  const p=position('ven115oceanDrake','returnBattlefieldUnitToHand');
  playSourceAtField(p);
  assert.equal(chooseEffectOption(p.game,p.enemyBase.instanceId).ok,true);
  finishChain(p.game);
  assert.ok(p.enemy.hand.some(c=>c.instanceId===p.enemyBase.instanceId));
});

test('Decree of Insight declares and resolves only enemy Body units',()=>{
  for(const declaration of [true,false]){
    const p=position('ven061decreeOfInsight');
    p.friendly.domains=[DOMAINS.BODY];p.opposing.domains=[DOMAINS.BODY];
    p.friendlyBase.domains=[DOMAINS.MIND];p.enemyBase.domains=[DOMAINS.MIND];
    p.game.battlefields[1].units[0].domains=[DOMAINS.MIND];
    if(declaration)assert.equal(beginPlayCard(p.game,p.source.instanceId,'base').ok,true);
    else resolveEffect(p.game,p.player,p.source);
    assert.deepEqual(targets(p.game),['enemy-field']);
  }
});

test('Mischievous Marai declares only an enemy at its own battlefield',()=>{
  const p=position('unl003mischievousMarai');
  playSourceAtField(p);
  assert.deepEqual(targets(p.game),['enemy-field']);
  assert.equal(chooseEffectOption(p.game,p.opposing.instanceId).ok,true);
  p.opposing.controllerId=p.player.id;
  finishChain(p.game);
  assert.equal(p.opposing.damage,0,'resolution also rejects a target that became friendly');
});

test('Masa cannot stun an enemy in the base during declaration or resolution',()=>{
  const p=position('ven120masaCrashingThunder');
  // Test targeting independently of the optional additional payment.
  delete p.source.effects[0].requiresPaidAdditionalCost;
  delete p.source.additionalCost;
  p.source.text='When you play me, stun an enemy unit at a battlefield.';
  playSourceAtField(p);
  assert.deepEqual(targets(p.game),['enemy-field','other-enemy']);
  assert.equal(chooseEffectOption(p.game,p.opposing.instanceId).ok,true);
  p.game.battlefields[0].units=p.game.battlefields[0].units.filter(u=>u!==p.opposing);
  p.enemy.base.push(p.opposing);
  finishChain(p.game);
  assert.equal(p.opposing.stunned,false);
});

test('Decree of Focus checks the enemy domain, not the friendly target domain',()=>{
  for(const declaration of [true,false]){
    const p=position('ven040decreeOfFocus');
    p.friendly.domains=[DOMAINS.MIND];p.opposing.domains=[DOMAINS.FURY];
    assert.equal(moveUnit(p.game,p.friendlyBase.instanceId,p.game.battlefields[0].instanceId).ok,true);
    if(declaration)assert.equal(beginPlayCard(p.game,p.source.instanceId,'base').ok,true);
    else resolveEffect(p.game,p.player,p.source);
    assert.deepEqual(targets(p.game),['friendly-base','friendly-field']);
  }
});

test('Thwonk only stuns attacking units in both declaration and resolution',()=>{
  for(const declaration of [true,false]){
    const p=position('sfd040thwonk');
    assert.equal(moveUnit(p.game,p.friendlyBase.instanceId,p.game.battlefields[0].instanceId).ok,true);
    if(declaration){
      assert.equal(beginPlayCard(p.game,p.source.instanceId,'base').ok,true);
      // Repeat payment is optional and independent of its target restriction.
      if(p.game.pendingChoice?.data.targetEffect==='repeatCost')assert.equal(chooseEffectOption(p.game,'skip').ok,true);
    }else resolveEffect(p.game,p.player,p.source);
    assert.deepEqual(targets(p.game),['friendly-base','friendly-field']);
  }
});

test('imported Action spells retain timing through payment but cannot respond to an occupied chain',()=>{
  const p=position('sfd164dragUnder');
  p.source.energy=1;
  p.player.runes=[instance(makeRune(DOMAINS.ORDER),p.player.id,'payment-rune')];
  assert.equal(moveUnit(p.game,p.friendlyBase.instanceId,p.game.battlefields[0].instanceId).ok,true);
  assert.equal(beginPlayCard(p.game,p.source.instanceId,'base').ok,true);
  assert.equal(chooseEffectOption(p.game,p.opposing.instanceId).ok,true);
  assert.ok(p.game.pendingPayment);
  assert.equal(togglePaymentRune(p.game,'payment-rune','energy').ok,true);
  assert.equal(confirmPayment(p.game).ok,true);
  const second=instance({...cards.sfd164dragUnder,energy:0,power:[]},p.player.id,'second');
  p.player.hand.push(second);
  assert.equal(beginPlayCard(p.game,second.instanceId,'base').ok,false,'Action does not grant Reaction');
});

test('Action on a permanent activated ability does not permit playing the permanent in combat',()=>{
  for(const key of ['unl045forgottenSignpost','unl161diviningShells','unl194shadow','ven112zedWithoutASound']){
    const p=position(key);
    assert.equal(moveUnit(p.game,p.friendlyBase.instanceId,p.game.battlefields[0].instanceId).ok,true);
    assert.equal(beginPlayCard(p.game,p.source.instanceId,'base').ok,false,key);
  }
});
