import {cards,decklists} from '../../src/cards.mjs';
import {createGame} from '../../src/engine.mjs';

export function tacticalPosition({spellCost=1,enemyCost=5,enemyMight=3,enemy=true,attacker=false}={}){
 const game=createGame({decks:Object.values(decklists).slice(0,2),firstPlayerId:'p1',interactive:true,
   manualActionChainPriority:true,randomSeed:9481});
 for(const p of game.players){p.legend.effects=[];p.base=[];p.hand=[];p.trash=[];p.champion=null;p.runes=[];}
 game.phase='action';game.currentPlayerId='p1';game.turnPlayerId='p1';game.pendingChoice=null;
 game.pendingPayment=null;game.actionChain=null;game.showdown=null;game.stagedEvents=[];
 const unit=(id,owner,might,energy)=>({...structuredClone(cards.lonelyPoro),instanceId:id,
   ownerId:owner,controllerId:owner,might,energy,damage:0,buffs:0,mightModifier:0,
   effects:[],keywords:[],attachments:[],exhausted:false});
 const [actor,opponent]=game.players;
 const field={...structuredClone(actor.availableBattlefields[0]),instanceId:'field',effects:[],hidden:[],
   controlledBy:enemy?'p2':null,units:enemy?[unit('enemy','p2',enemyMight,enemyCost)]:[]};
 game.battlefields=[field];
 actor.hand=[{...structuredClone(cards.hextechRay),instanceId:'removal',ownerId:'p1',controllerId:'p1',energy:spellCost,power:[]}];
 actor.runes=Array.from({length:8},(_,i)=>({instanceId:`r${i}`,ownerId:'p1',controllerId:'p1',type:'rune',domain:'Fury',exhausted:false,effects:[],keywords:[]}));
 if(attacker)actor.base=[unit('attacker','p1',4,3)];
 return {game,actor,opponent,field};
}
