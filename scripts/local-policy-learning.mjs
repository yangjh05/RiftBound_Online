import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {actionKey} from '../src/ai/actions.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {resourceDeploymentDecision,recommendResourceDeployment} from './resource-deployment-learning.mjs';

export const LOCAL_POLICY_LEARNING_CONTRACT='prospective-local-resource-learning-v1';
export const localPolicyDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readLocalPolicyLearning(root){
  let p;
  try{p=JSON.parse((await readFile(path.join(root,'local-policy-learning-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  assert.equal(p.contract,LOCAL_POLICY_LEARNING_CONTRACT);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.equal(p.everyIterations,8);assert.equal(p.maximumLiveSamples,32);
  assert.equal(p.maximumResourceReviewsPerGame,24);assert.equal(p.allDeckAnchors,true);
  assert.equal(p.noGlobalOrDeckAccuracyDrop,true);
  return p;
}
export function commitLocalPolicyLearning(state,p){
  const hash=p?localPolicyDigest(p):null;
  if(state.localPolicyLearningHash)assert.equal(hash,state.localPolicyLearningHash,'Local policy learning changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Local policy learning must be prospective.');state.localPolicyLearningHash=hash;}
}
export function localPolicyRefreshSchedule(protocol,local,iteration,deckIds){
  if(!local || iteration<=local.afterIteration || (iteration-local.afterIteration-1)%local.everyIterations)return null;
  assert.ok([5,6].includes(deckIds.length)&&new Set(deckIds).size===deckIds.length);
  return deckIds.flatMap((deckId,deckIndex)=>[0,1].map(partition=>{
    const index=deckIndex*2+partition;
    return {index,deckId,partition:partition?'validation':'training',
      seed:(protocol.seed+Math.imul(iteration,104729)+Math.imul(index+1,13007))>>>0,
      localResourceLessons:true};
  }));
}

// Each game receives a turn before another position from that game. Rotate
// within each game as well: a large first report must not monopolize audits.
export function rotatingLiveAuditPairs(pairs,{round=1,maximumGames=8,maximumComparisons=32}={}){
  assert.ok(Number.isSafeInteger(round)&&round>=1);
  const groups=new Map(),seen=new Set();
  for(const pair of pairs){
    if(pair.entry.role!=='training')continue;
    const id=pair.entry.sourceGameId,descriptor=pair.snapshot.descriptor;
    const key=JSON.stringify([id,descriptor.informationSetHash,actionKey(descriptor.selectedAction),actionKey(descriptor.recommendedAction)]);
    if(seen.has(key))continue;seen.add(key);
    if(!groups.has(id))groups.set(id,[]);groups.get(id).push(pair);
  }
  const ids=[...groups.keys()].sort();if(!ids.length)return [];
  const start=((round-1)*maximumGames)%ids.length;
  const active=[...ids.slice(start),...ids.slice(0,start)].slice(0,maximumGames);
  const stride=Math.ceil(maximumComparisons/active.length);
  const lists=active.map(id=>{
    const list=groups.get(id),offset=((round-1)*stride)%list.length;
    return [...list.slice(offset),...list.slice(0,offset)];
  });
  const result=[];
  for(let i=0;i<Math.max(...lists.map(l=>l.length))&&result.length<maximumComparisons;i++)
    for(const list of lists)if(list[i]&&result.length<maximumComparisons)result.push(list[i]);
  return result;
}

export function localResourceDecision(game,actorId,action){
  if(resourceDeploymentDecision(game,actorId,action))return true;
  if(action?.kind!=='beginPlayCard')return false;
  const card=game.players.find(p=>p.id===actorId)?.hand.find(c=>c.instanceId===action.cardId);
  return card?.type==='spell'||Boolean(card?.effects?.some(e=>e.kind==='costModifier'&&e.requiresLegion&&e.energy<0));
}
export function recommendLocalResourceDemonstration(game,actorId,decision){
  if(!localResourceDecision(game,actorId,decision.action))return null;
  const deployment=recommendResourceDeployment(game,actorId,decision);
  if(deployment)return deployment;
  const result=reviewRuntimeTacticalAction(game,actorId,decision,decision.legalActions,{now:()=>0});
  const review=result.review;
  // Soft imitation of local public savings, never a terminal victory label.
  // Losing terminal tie-breaks are deliberately excluded from this lesson.
  if(!review.applied || !['same-result-less-spending','verified-card-order-savings'].includes(review.reason)
    || review.comparisons?.some(c=>Math.abs(c.score)===1000))return null;
  return {action:result.selection.action,continuation:[result.selection.action],weight:0.5,
    comparison:review.reason,localResourceLesson:true,review,
    correctionEligible:false,winProbabilityLabel:false,opponentResponsesCompared:false};
}

export function tacticalSelectionGuard(before,after){
  const failures=[];
  const valid=m=>m&&m.decisions>0&&Number.isFinite(m.policyLoss)&&Number.isFinite(m.decisionAccuracy);
  if(!valid(before)||!valid(after))return {passed:false,failures:['missing-or-nonfinite-validation']};
  if(after.decisions!==before.decisions)failures.push('changed-validation-count');
  if(after.policyLoss>before.policyLoss+1e-8)failures.push('global-loss');
  if(after.decisionAccuracy+1e-8<before.decisionAccuracy)failures.push('global-choices');
  const ids=Object.keys(before.perDeck||{}).sort();
  if(JSON.stringify(ids)!==JSON.stringify(Object.keys(after.perDeck||{}).sort()))failures.push('changed-deck-coverage');
  for(const id of ids){
    const a=before.perDeck[id],b=after.perDeck?.[id];
    if(!valid(a)||!valid(b)||a.decisions!==b.decisions)failures.push(`deck-validation:${id}`);
    else if(b.decisionAccuracy+1e-8<a.decisionAccuracy)failures.push(`deck-choices:${id}`);
  }
  return {passed:!failures.length,failures};
}
