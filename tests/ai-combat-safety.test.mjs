import test from 'node:test';
import assert from 'node:assert/strict';
import {cards,decklists} from '../src/cards.mjs';
import {createGame,currentMight} from '../src/engine.mjs';
import * as api from '../src/ai/actions.mjs';
import {reviewCombatContinuations,hasCombatSacrificePayoff} from '../src/ai/combat-safety.mjs';

function setup({spell=true,death=false,cost=1,commit=false,move=true}={}) {
 const game=createGame({decks:Object.values(decklists).slice(0,2),firstPlayerId:'p1',interactive:true,manualActionChainPriority:true,randomSeed:123});
 const [actor,enemy]=game.players;
 const unit=(id,owner,might,extra={})=>({...structuredClone(cards.lonelyPoro),instanceId:id,ownerId:owner,controllerId:owner,might,damage:0,buffs:0,mightModifier:0,effects:[],keywords:[],attachments:[],exhausted:false,...extra});
 for(const p of game.players){p.legend.effects=[];p.base=[];p.hand=[];p.runes=[];p.champion=null;}
 game.phase='action';game.currentPlayerId='p1';game.turnPlayerId='p1';game.pendingChoice=null;game.pendingPayment=null;game.actionChain=null;game.showdown=null;game.stagedEvents=[];
 actor.base=[unit('attacker','p1',3,death?{effects:[{timing:'death',kind:'draw',amount:1}],keywords:['Deathknell']}: {})];
 const field={...structuredClone(actor.availableBattlefields[0]),instanceId:'field',effects:[],hidden:[],controlledBy:'p2',units:[unit('defender','p2',4)]};
 game.battlefields=[field];
 if(spell)actor.hand=[{...structuredClone(cards.stupefy),instanceId:'spell',ownerId:'p1',controllerId:'p1',energy:cost,power:[]}];
 actor.runes=[{instanceId:'r1',ownerId:'p1',controllerId:'p1',type:'rune',domain:'Mind',exhausted:false,effects:[],keywords:[]}];
 const attack={kind:'moveUnit',unitId:'attacker',destinationId:'field'};
 if(move)assert.equal(api.applyAiAction(game,attack,'p1',{skipCombatPlan:!commit}).ok,true);
 return {game,actor,enemy,field,attack};
}
const review=game=>reviewCombatContinuations(game,api.activeActorId(game),api.enumerateAiPolicyActions(game),api);

test('a no-response trade is only a comparison question and never removes pass',()=>{
 const {game}=setup();const before=JSON.stringify(game),legal=api.enumerateAiPolicyActions(game);
 const result=review(game);
 assert.equal(result.evidenceKind,'conditional-no-response-preview');
 assert.equal(result.correctionEligible,false);
 assert.equal(result.hardExclusionEligible,false);
 assert.equal(result.opponentResponsesCompared,false);
 assert.equal(result.resourceOpportunityCostCompared,false);
 assert.ok(result.requiredActions.some(a=>a.kind==='passShowdown'));
 assert.ok(result.requiredActions.some(a=>a.kind==='beginPlayCard'));
 assert.deepEqual(api.enumerateAiPolicyActions(game),legal);
 assert.equal(JSON.stringify(game),before);
});
test('no payable continuation yields no manufactured recommendation',()=>{
 const {game,actor}=setup();actor.runes=[];
 assert.equal(review(game),null);
 assert.ok(api.enumerateAiPolicyActions(game).some(a=>a.kind==='passShowdown'));
});
test('pending targets and chains remain under policy control',()=>{
 const {game,enemy}=setup();
 enemy.base.push({...structuredClone(game.battlefields[0].units[0]),instanceId:'irrelevant',might:2});
 assert.ok(api.applyAiAction(game,{kind:'beginPlayCard',cardId:'spell',destination:'base'},'p1').ok);
 assert.equal(review(game),null);
 assert.ok(api.enumerateAiPolicyActions(game).some(a=>a.optionId==='irrelevant'));
});
test('opponent hidden hand and unknown future draw identities cannot affect preview',()=>{
 const left=setup().game,right=api.cloneGame(left);
 right.players[1].hand=[structuredClone(cards.hextechRay),structuredClone(cards.retreat)];
 right.players[0].mainDeck=right.players[0].mainDeck.map(c=>({...c,name:'different unknown identity',effects:[],keywords:[]}));
 assert.deepEqual(review(left),review(right));
 assert.deepEqual(api.enumerateAiPolicyActions(left),api.enumerateAiPolicyActions(right));
});
test('changed combat is inspected again and complex continuations fail open',()=>{
 const {game,field}=setup();assert.ok(review(game));
 field.units.find(u=>u.controllerId==='p2').might=2;
 assert.equal(review(game),null);
 game.players[0].hand[0].effects[0].condition='unknown';
 assert.equal(review(game),null);
});
test('a real opposing reaction invalidates the no-response trade prediction',()=>{
 const {game,enemy,field}=setup();
 const hypothesis=review(game);
 assert.ok(hypothesis.comparisons.some(c=>c.outcomes.some(o=>o.enemyLost.length===1)));
 enemy.hand.push({...structuredClone(cards.discipline),instanceId:'counter',ownerId:'p2',controllerId:'p2',energy:0,power:[],effects:[{timing:'spell',kind:'modifyMight',target:'friendlyUnit',amount:2,temporary:true}]});
 assert.ok(api.enumerateAiPolicyActions(game).some(a=>a.kind==='passShowdown'));
 assert.ok(api.applyAiAction(game,{kind:'beginPlayCard',cardId:'spell',destination:'base'},'p1').ok);
 assert.ok(api.applyAiAction(game,{kind:'chooseEffectOption',optionId:'defender'},'p1').ok);
 while(game.pendingPayment)for(const a of api.planPaymentActions(game))assert.ok(api.applyAiAction(game,a,api.activeActorId(game)).ok);
 assert.ok(api.applyAiAction(game,{kind:'passShowdown'},'p1').ok);
 assert.ok(api.applyAiAction(game,{kind:'beginPlayCard',cardId:'counter',destination:'base'},'p2').ok);
 assert.ok(api.applyAiAction(game,{kind:'chooseEffectOption',optionId:'defender'},'p2').ok);
 for(let i=0;i<40&&(game.showdown||game.pendingChoice||game.pendingPayment);i++){
  const id=api.activeActorId(game);
  if(game.pendingPayment){for(const a of api.planPaymentActions(game))assert.ok(api.applyAiAction(game,a,api.activeActorId(game)).ok);continue;}
  const a=game.pendingChoice?api.enumerateLegalActions(game,id).find(a=>a.kind==='chooseEffectOption'):{kind:'passShowdown'};
  assert.ok(api.applyAiAction(game,a,id).ok);
 }
 assert.ok(field.units.some(u=>u.instanceId==='defender'));
 assert.ok(!field.units.some(u=>u.instanceId==='attacker'));
 assert.ok(currentMight(game,field.units.find(u=>u.instanceId==='defender'))>=4);
});
test('known death payouts and generic graveyard scaling preserve sacrifice moves',()=>{
 const {game,actor,field}=setup({death:true});
 assert.ok(hasCombatSacrificePayoff(game,actor.id,field.units));
 const attacker=field.units.find(u=>u.controllerId===actor.id);
 attacker.effects=[];attacker.keywords=[];
 actor.base.push({instanceId:'generic-payoff',controllerId:actor.id,type:'unit',effects:[{timing:'static',kind:'selfMightByTrash'}]});
 assert.ok(hasCombatSacrificePayoff(game,actor.id,field.units));
});
test('a terminal engine win can exclude alternatives before any opponent response',()=>{
 const {game,actor,field}=setup();
 field.units=field.units.filter(u=>u.controllerId===actor.id);
 field.controlledBy=null;actor.score=7;
 game.showdown.consecutivePasses=1;
 const pass={kind:'passShowdown'},preview=api.cloneGame(game);
 assert.ok(api.applyAiAction(preview,pass,'p1').ok);
 assert.equal(preview.winnerId,'p1');
 assert.equal(preview.phase,'complete');
 assert.deepEqual(api.enumerateAiPolicyActions(game),[pass]);
 assert.ok(api.enumerateLegalActions(game).length>1,'human legal actions remain intact');
});

const contains=(actions,action)=>actions.some(a=>api.actionKey(a)===api.actionKey(action));

test('an unsupported no-payoff loss is excluded before moving, while human legality stays intact',()=>{
 const {game,attack}=setup({spell:false,move:false});
 const before=JSON.stringify(game);
 assert.equal(contains(api.enumerateAiPolicyActions(game),attack),false);
 assert.equal(contains(api.enumerateLegalActions(game),attack),true);
 assert.equal(JSON.stringify(game),before,'enumeration does not store an intent');
});

test('an unaffordable supporting spell cannot justify a losing attack',()=>{
 const {game,actor,attack}=setup({move:false});actor.runes=[];
 assert.equal(contains(api.enumerateAiPolicyActions(game),attack),false);
});

test('an already-finished play trigger is not an excuse for an unsupported loss',()=>{
 const {game,actor,attack}=setup({move:false,spell:false});
 actor.base[0].effects=[{timing:'onPlay',kind:'draw',amount:1}];
 assert.equal(contains(api.enumerateAiPolicyActions(game),attack),false);
});

test('choosing a supported attack requires its spell and meaningful target through serialization',()=>{
 const {game,actor,enemy,attack}=setup({move:false});
 enemy.base.push({...structuredClone(game.battlefields[0].units[0]),instanceId:'irrelevant',might:2});
 assert.equal(contains(api.enumerateAiPolicyActions(game),attack),true);
 assert.ok(api.applyAiAction(game,attack,'p1').ok);
 assert.equal(game.aiCombatCommitment.kind,'supported-attack');
 const restored=JSON.parse(JSON.stringify(game));
 assert.deepEqual(api.enumerateAiPolicyActions(restored),[{kind:'beginPlayCard',cardId:'spell',destination:'base'}]);
 assert.ok(api.enumerateLegalActions(restored).some(a=>a.kind==='passShowdown'));
 assert.ok(api.applyAiAction(restored,api.enumerateAiPolicyActions(restored)[0],'p1').ok);
 assert.deepEqual(api.enumerateAiPolicyActions(restored),[{kind:'chooseEffectOption',optionId:'defender'}]);
 assert.ok(api.applyAiAction(restored,api.enumerateAiPolicyActions(restored)[0],'p1').ok);
 assert.equal(restored.aiCombatCommitment,undefined);
 assert.ok(api.planPaymentActions(restored).length);
 for(const a of api.planPaymentActions(restored))assert.ok(api.applyAiAction(restored,a,api.activeActorId(restored)).ok);
 assert.equal(restored.players[0].hand.some(c=>c.instanceId==='spell'),false);
 assert.equal(actor.hand.some(c=>c.instanceId==='spell'),true,'separate state remains independent');
});

test('public state changes release a previous support obligation',()=>{
 const {game,field}=setup({commit:true});
 assert.equal(api.enumerateAiPolicyActions(game).some(a=>a.kind==='passShowdown'),false);
 field.units.find(u=>u.controllerId==='p2').might=20;
 assert.ok(api.enumerateAiPolicyActions(game).some(a=>a.kind==='passShowdown'));
});

test('opponent reactions release the plan instead of forcing more expenditure',()=>{
 const {game,enemy,attack}=setup({move:false});
 // Advance priority through the engine without the policy wrapper, as an
 // external caller could. A hidden card alone must not invalidate a plan.
 enemy.hand=[{...structuredClone(cards.discipline),instanceId:'counter',ownerId:'p2',controllerId:'p2',energy:0,power:[]}];
 assert.ok(api.applyAiAction(game,attack,'p1').ok);
 assert.ok(game.aiCombatCommitment);
 assert.ok(api.applyAiAction(game,{kind:'passShowdown'},'p1',{skipCombatPlan:true}).ok);
 assert.ok(api.applyAiAction(game,{kind:'beginPlayCard',cardId:'counter',destination:'base'},'p2').ok);
 assert.equal(game.aiCombatCommitment,undefined);
 assert.ok(api.applyAiAction(game,{kind:'chooseEffectOption',optionId:'defender'},'p2').ok);
 while(game.pendingPayment)for(const a of api.planPaymentActions(game))assert.ok(api.applyAiAction(game,a,api.activeActorId(game)).ok);
 assert.ok(api.applyAiAction(game,{kind:'passShowdown'},'p2').ok);
 assert.equal(api.activeActorId(game),'p1');
 assert.ok(api.enumerateAiPolicyActions(game).some(a=>a.kind==='passShowdown'));
});

test('a sacrifice payout keeps both the attack and reserve option',()=>{
 const {game,attack}=setup({move:false,death:true});
 assert.equal(contains(api.enumerateAiPolicyActions(game),attack),true);
 assert.ok(api.applyAiAction(game,attack,'p1').ok);
 assert.equal(game.aiCombatCommitment,undefined);
 assert.ok(api.enumerateAiPolicyActions(game).some(a=>a.kind==='passShowdown'));
});

test('unknown trigger and multi-spell setups are not falsely called no-payoff losses',()=>{
 const trigger=setup({move:false,spell:false});
 trigger.actor.base[0].effects=[{timing:'attackOrDefend',kind:'draw',amount:1}];
 assert.ok(contains(api.enumerateAiPolicyActions(trigger.game),trigger.attack));
 const combo=setup({move:false});
 combo.field.units[0].might=5;
 combo.actor.hand[0].energy=0;delete combo.actor.hand[0].effects[0].draw;
 combo.actor.hand.push({...structuredClone(combo.actor.hand[0]),instanceId:'spell-two'});
 assert.ok(contains(api.enumerateAiPolicyActions(combo.game),combo.attack));
});

test('support planning and its active mask ignore hidden card identities',()=>{
 const {game,enemy,attack}=setup({move:false});
 enemy.hand=[{...structuredClone(cards.discipline),instanceId:'secret-one'}];
 const other=api.cloneGame(game);
 other.players[1].hand=[{...structuredClone(cards.hextechRay),instanceId:'secret-two'}];
 other.players[0].mainDeck.reverse();
 assert.deepEqual(api.enumerateAiPolicyActions(game),api.enumerateAiPolicyActions(other));
 assert.ok(api.applyAiAction(game,attack,'p1').ok);
 assert.ok(api.applyAiAction(other,attack,'p1').ok);
 assert.deepEqual(game.aiCombatCommitment,other.aiCombatCommitment);
 assert.deepEqual(api.enumerateAiPolicyActions(game),api.enumerateAiPolicyActions(other));
});
