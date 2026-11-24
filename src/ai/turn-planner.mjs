import {activeActorId,actionKey,enumerateAiPolicyActions} from './actions.mjs';
import {tacticalActionProfile} from './action-tactics.mjs';
import {actionUnit} from './ready-entry-order.mjs';
import {currentMight} from '../engine.mjs';

const PLAY=new Set(['beginPlayCard','beginPlayChampion','beginPlayCardFromTrash']);
const MOVE=new Set(['moveUnit','moveUnits']);
const HOLD=new Set(['endTurn','passShowdown','declineEffectChoice']);

export function turnCandidatePriority(game,actorId,action){
  const p=tacticalActionProfile(game,actorId,action);
  const unit=actionUnit(game,actorId,action);
  const actor=game.players.find(p=>p.id===actorId);
  const source=actor.hand.find(c=>c.instanceId===action.cardId);
  const damage=source?.type==='spell'?Math.max(0,...(source.effects||[])
    .filter(e=>/damage/i.test(e.kind)).map(e=>Number(e.amount)||0)):0;
  const killable=damage?[...game.players.flatMap(p=>p.base),...game.battlefields.flatMap(f=>f.units)]
    .filter(c=>c.type==='unit'&&c.controllerId!==actorId&&currentMight(game,c)-(c.damage||0)<=damage):[];
  // Declaration actions do not yet have a target profile. Without this
  // public potential, a crowd of movement candidates can evict a lethal
  // spell before its real target/cost continuations are ever compared.
  const removalPriority=killable.length?3+Math.min(2,killable.length)
    +Math.max(...killable.map(c=>Number(c.energy)||0))/10:0;
  // Cheap setup is worth inspecting when it can enable a real Legion cost
  // reduction. The final comparison pays both orders through the engine.
  const legionSetup=PLAY.has(action.kind)&&!actor.cardsPlayedThisTurn
    && actor.hand.some(c=>c.instanceId!==action.cardId && c.effects?.some(e=>
      e.kind==='costModifier'&&e.requiresLegion&&e.energy<0));
  return Number(p.controlGain)*4+Number(p.canRemoveEnemyNoResponse)*3+(p.targetImpact||0)
    +removalPriority+(unit?Math.min(1,(unit.might||0)/8):0)+(legionSetup?2/(1+(unit?.energy||1)):0);
}

// A bounded, public, no-response search used to teach the policy. Every leaf
// pays real costs and ends the turn, so an unused temporary debuff disappears.
// It supplies preferences, never proof labels or a hard mask on alternatives.
export function planPublicTurn(source,actorId,first,api,{
  followupDepth=2,beamWidth=3,maximumFollowups=6,maximumExpansions=36,evaluateEndpoint=null,
  compareEndpoints=(a,b)=>a.score-b.score
}={}){
  const atomic=(game,action,finishTurn=false)=>api.previewTacticalAction(game,actorId,action,{
    maximumStates:96,returnGame:true,returnOutcomes:true,finishTurn,skipReadyEntryOrdering:true
  });
  const root=atomic(source,first);
  if(!root)return null;
  let expanded=1,continuationExpansions=0,truncated=!root.searchComplete,best=null;
  let frontier=(root.outcomes||[root]).map(o=>({...o,used:new Set([actionKey(first)])}));
  const ownTurn=source.currentPlayerId===actorId;
  function endpoint(node){
    if(node.game.phase==='complete'||!ownTurn||activeActorId(node.game)!==actorId)return node;
    const result=atomic(node.game,{kind:'endTurn'},true);expanded++;
    if(!result)return null;
    if(!result.searchComplete)truncated=true;
    return {...result,steps:[...node.steps,...result.steps]};
  }
  for(let depth=0;frontier.length&&depth<=followupDepth;depth++){
    frontier.sort((a,b)=>b.score-a.score);
    if(frontier.length>Math.max(8,beamWidth)){truncated=true;frontier=frontier.slice(0,Math.max(8,beamWidth));}
    for(const node of frontier){
      let end=endpoint(node);
      // Compare every retained end-of-turn plan on the same defensive
      // horizon; evaluating only the already selected all-in leaf cannot
      // recover a resource-preserving continuation of the same first card.
      if(end && evaluateEndpoint){
        const assessment=evaluateEndpoint(end.game);
        if(!assessment || !Number.isFinite(assessment.score)){truncated=true;continue;}
        end={...end,noResponseScore:end.score,score:assessment.score,endpointAssessment:assessment};
      }
      if(end&&(!best||compareEndpoints(end,best)>1e-8))best=end;
    }
    if(depth===followupDepth||!ownTurn||HOLD.has(first.kind))break;
    // Preserve several target/payment outcomes. Immediate material alone is
    // insufficient: readiness may pay off only after a subsequent move.
    frontier.sort((a,b)=>b.score-a.score);
    if(frontier.length>beamWidth)truncated=true;
    frontier=frontier.slice(0,beamWidth);
    const next=[];
    for(const node of frontier){
      if(node.game.phase==='complete'||activeActorId(node.game)!==actorId)continue;
      const legal=enumerateAiPolicyActions(node.game,actorId,{skipReadyEntryOrdering:true})
        .filter(a=>!HOLD.has(a.kind)&&!node.used.has(actionKey(a))
          && (PLAY.has(a.kind)||MOVE.has(a.kind)||a.kind==='activateCard'))
        .map(action=>({action,priority:turnCandidatePriority(node.game,actorId,action)}))
        .sort((a,b)=>b.priority-a.priority);
      if(legal.length>maximumFollowups)truncated=true;
      for(const {action} of legal.slice(0,maximumFollowups)){
        if(continuationExpansions>=maximumExpansions){truncated=true;break;}
        const result=atomic(node.game,action);expanded++;continuationExpansions++;
        if(!result){truncated=true;continue;}
        if(!result.searchComplete)truncated=true;
        for(const outcome of result.outcomes||[result])next.push({...outcome,
          steps:[...node.steps,...outcome.steps],used:new Set([...node.used,actionKey(action)])});
      }
    }
    frontier=next;
  }
  return best?{...best,expanded,searchComplete:!truncated,
    searchScope:'bounded-public-turn',opponentResponsesCompared:false}:null;
}
