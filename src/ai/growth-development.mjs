import {activeActorId,actionKey,cloneGame,enumerateLegalActions} from './actions.mjs';
import {publicTacticalValue} from './tactical-baseline.mjs';
import {reactionReserveProfile} from './resource-strategy.mjs';
import {scoreRaceContext} from './score-race.mjs';

const growthCard=c=>c?.effects?.some(e=>e.timing==='spell'&&['channelRunes','channelRunesOrDraw'].includes(e.kind));
const player=(g,id)=>g.players.find(p=>p.id===id);
const ready=(g,id)=>player(g,id).runes.filter(r=>!r.exhausted).length;
const ownMain=(g,id)=>g?.phase==='action'&&activeActorId(g)===id
  &&!g.pendingChoice&&!g.pendingPayment&&!g.showdown&&!g.actionChain&&!g.combat&&!g.stagedEvents?.length;

// Conditional resource projection, not a prediction that the opponent passes.
// Only current hand/champion deployments are probed. Future draws are unknown;
// new basic runes can pay Any power but never promise an unseen colored rune.
export function conservativeGrowthProjection(source){
  const g=cloneGame(source);
  for(const p of g.players){
    if(p.runeDeck.some(r=>r.keywords?.length||!r.tags?.includes('Basic Rune')
      ||r.effects?.some(e=>!['addEnergy','addPower'].includes(e.kind)||e.amount!==1)))return null;
    p.runeDeck=p.runeDeck.map((_,i)=>({instanceId:`future-rune-${p.id}-${i}`,type:'rune',
      name:'Unseen basic rune',domain:'Unknown',domains:['Unknown'],tags:['Basic','Basic Rune'],
      effects:[{timing:'activated',kind:'addEnergy',amount:1,exhaust:true,abilityId:'basic-rune-energy',abilityKeywords:['Reaction']},
        {timing:'activated',kind:'addPower',amount:1,domain:'Unknown',recycleSelfCost:true,abilityId:'basic-rune-power',abilityKeywords:['Reaction']}],keywords:[],
      ownerId:p.id,controllerId:p.id,exhausted:false}));
  }
  return g;
}

export function createGrowthHorizonEvaluator(source,actorId,preview){
  const actor=player(source,actorId),opponent=source.players.find(p=>p.id!==actorId);
  const known=new Set([...actor.hand,...(!actor.championPlayed&&actor.champion?[actor.champion]:[])]
    .filter(c=>['unit','gear'].includes(c.type)).map(c=>c.instanceId));
  const initialReserve=reactionReserveProfile(source,actorId);
  return post=>{
    if(!known.size)return null;
    let theirTurn=post;
    if(ownMain(post,actorId)){
      const r=preview(post,actorId,{kind:'endTurn'},{returnGame:true});
      if(!r?.searchComplete)return null;
      theirTurn=r.game;
    }
    if(!ownMain(theirTurn,opponent.id))return null;
    const next=preview(theirTurn,actorId,{kind:'endTurn'},{returnGame:true,firstActorId:opponent.id});
    if(!next?.searchComplete||!ownMain(next.game,actorId))return null;
    const future=next.game,base=publicTacticalValue(future,actorId);
    const deployments=enumerateLegalActions(future,actorId).filter(a=>a.destination==='base'
      &&(a.kind==='beginPlayChampion'&&known.has(player(future,actorId).champion?.instanceId)
        ||a.kind==='beginPlayCard'&&known.has(a.cardId)));
    if(deployments.length>4)return null;
    let bestScore=base,bestDeployment=null,bestReady=ready(future,actorId);
    for(const deployment of deployments){
      const r=preview(future,actorId,deployment,{returnGame:true});
      if(!r?.searchComplete||!ownMain(r.game,actorId))return null;
      const score=publicTacticalValue(r.game,actorId);
      if(score>bestScore){bestScore=score;bestDeployment=deployment;bestReady=ready(r.game,actorId);}
    }
    const reserve=reactionReserveProfile(post,actorId);
    const reserveLoss=Math.max(0,initialReserve.reserveValue-reserve.reserveValue)*initialReserve.threat;
    return {score:bestScore-reserveLoss,searchComplete:true,
      runesAfterAction:player(post,actorId).runes.length,readyAfterAction:ready(post,actorId),
      nextTurnRunes:player(future,actorId).runes.length,nextTurnReady:ready(future,actorId),
      affordableDeployments:deployments,bestDeployment,readyAfterDeployment:bestReady,reserveLoss};
  };
}

export function recommendGrowthDevelopment(source,actorId,legal,original,{preview,maximumGrowthCards=2}={}){
  if(!preview||!ownMain(source,actorId))return null;
  const actor=player(source,actorId),opponent=source.players.find(p=>p.id!==actorId);
  if(original.kind!=='endTurn'&&!growthCard(actor.hand.find(c=>c.instanceId===original.cardId)))return null;
  const race=scoreRaceContext(source,actorId),victory=source.victoryScore||8;
  const opposingUnits=[...opponent.base,...source.battlefields.flatMap(f=>f.units)].filter(c=>c.type==='unit'&&c.controllerId===opponent.id);
  const openForOpponent=source.battlefields.filter(f=>f.controlledBy!==opponent.id).length;
  // Do not trade an immediate scoring/defensive opportunity for this horizon.
  if(race.nearVictory||opponent.score+race.opponentHeld+Math.min(openForOpponent,opposingUnits.length)>=victory-1
    ||legal.some(a=>['moveUnit','moveUnits','beginPlayChampion'].includes(a.kind)
      ||a.kind==='beginPlayCard'&&actor.hand.some(c=>c.instanceId===a.cardId&&c.type==='unit')))return null;
  const growth=legal.filter(a=>a.kind==='beginPlayCard'&&growthCard(actor.hand.find(c=>c.instanceId===a.cardId)));
  if(!growth.length||growth.length>maximumGrowthCards||!actor.runeDeck.length)return null;
  const hold=legal.find(a=>a.kind==='endTurn');if(!hold)return null;
  const projected=conservativeGrowthProjection(source);if(!projected)return null;
  const horizon=createGrowthHorizonEvaluator(source,actorId,preview);
  const initialReserve=reactionReserveProfile(source,actorId),comparisons=[];
  for(const action of [hold,...growth]){
    let post=projected;
    if(action!==hold){
      const r=preview(projected,actorId,action,{returnGame:true});
      if(!r?.searchComplete||!ownMain(r.game,actorId))return null;
      post=r.game;
      if(player(post,actorId).runes.length<=actor.runes.length)continue; // exhausted rune deck / draw-only mode
    }
    const reserve=reactionReserveProfile(post,actorId);
    if(action!==hold&&opposingUnits.length&&initialReserve.affordableReactions>0&&reserve.affordableReactions===0)continue;
    const value=horizon(post);if(!value)return null;
    comparisons.push({action,...value});
  }
  const baseline=comparisons.find(c=>c.action===hold);
  if(!baseline)return null;
  const useful=comparisons.filter(c=>c.action!==hold&&c.bestDeployment
    &&(c.affordableDeployments.some(a=>!baseline.affordableDeployments.some(b=>actionKey(a)===actionKey(b)))
      ||c.readyAfterDeployment>baseline.readyAfterDeployment));
  const best=useful.sort((a,b)=>b.score-a.score)[0],current=comparisons.find(c=>actionKey(c.action)===actionKey(original));
  if(!best||!current||best.action===current.action||best.score-current.score<0.5)return null;
  return {action:best.action,gain:best.score-current.score,comparisons,growthLesson:true,
    scope:'next-own-turn-known-deployment',opponentResponsesCompared:false,winProbabilityLabel:false,
    assumptions:['passive-opponent-resource-projection','unknown-future-main-deck-draws','no-assumed-new-colored-runes']};
}
