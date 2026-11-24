import { cards } from '../src/cards.mjs';
import { actionKey,activeActorId,applyAiAction,cloneGame,enumerateAiPolicyActions,enumerateLegalActions } from '../src/ai/actions.mjs';
import { opponentResponseProfile,reactionReserveProfile } from '../src/ai/resource-strategy.mjs';
import {planPublicTurn,turnCandidatePriority} from '../src/ai/turn-planner.mjs';
import { previewTacticalAction, previewTacticalResponse, publicTacticalValue, recommendPublicTacticalAction } from '../src/ai/tactical-baseline.mjs';

const byNumber = new Map(Object.values(cards).map(card => [card.cardNumber, card]));
export const RESPONSE_DEMONSTRATION_CONTRACT = 'bounded-action-response-demonstration-v1';

// Inspect a public attack on the next turn and the resources left to answer
// it. Hidden opponent identities have already been redacted by the public
// turn preview. Unsupported trigger/choice lines return unknown.
export function previewPublicReserveHorizon(source,actorId,{maximumAttacks=2,maximumDefenses=4}={}) {
  const base=publicTacticalValue(source,actorId),opponent=activeActorId(source);
  if(source.phase==='complete')return {score:base,attacks:0};
  if(!opponent||opponent===actorId||source.pendingChoice||source.pendingPayment||source.showdown||source.actionChain)return null;
  const allAttacks=enumerateLegalActions(source,opponent).filter(a=>['moveUnit','moveUnits'].includes(a.kind)
    && source.battlefields.some(f=>f.instanceId===a.destinationId&&f.units.some(u=>u.controllerId===actorId)));
  const attacks=allAttacks.slice(0,maximumAttacks);
  let worst=base,reviewed=0,complete=allAttacks.length===attacks.length;
  for(const attack of attacks){
    const g=cloneGame(source);
    if(!applyAiAction(g,attack,opponent,{skipCombatPlan:true}).ok||g.pendingChoice||g.pendingPayment)continue;
    if(g.showdown&&activeActorId(g)===opponent)applyAiAction(g,{kind:'passShowdown'},opponent,{skipCombatPlan:true});
    if(!g.showdown||activeActorId(g)!==actorId||g.pendingChoice||g.pendingPayment||g.showdown.chain?.length)continue;
    const legal=enumerateAiPolicyActions(g,actorId),hold=legal.find(a=>a.kind==='passShowdown');
    const choices=[hold,...legal.filter(a=>a!==hold).sort((a,b)=>turnCandidatePriority(g,actorId,b)-turnCandidatePriority(g,actorId,a))]
      .filter(Boolean).slice(0,maximumDefenses);
    if(choices.length<legal.length)complete=false;
    const outcomes=choices.map(a=>previewTacticalAction(g,actorId,a,{maximumStates:64}));
    if(!outcomes.length||outcomes.some(o=>!o?.searchComplete))continue;
    reviewed++;worst=Math.min(worst,Math.max(...outcomes.map(o=>o.score)));
  }
  return {score:base+0.5*(worst-base),attacks:reviewed,searchComplete:complete&&reviewed===attacks.length,
    assumptions:['public-board-attacks','bounded-defensive-responses','no-additional-opponent-spell'],winProbabilityLabel:false};
}

export function recommendReserveAwareAction(game,actorId,decision,fallback=null){
  if(game.phase!=='action'||game.showdown||game.actionChain||game.pendingChoice||game.pendingPayment
    ||game.currentPlayerId!==actorId)return null;
  const ownUnits=game.players.find(p=>p.id===actorId).base.some(c=>c.type==='unit')
    ||game.battlefields.some(f=>f.units.some(c=>c.controllerId===actorId));
  if(!ownUnits && !reactionReserveProfile(game,actorId).reactionCards)return null;
  const hold=decision.legalActions.find(a=>a.kind==='endTurn');if(!hold)return null;
  const alternatives=decision.legalActions.filter(a=>['moveUnit','moveUnits','beginPlayCard','beginPlayChampion'].includes(a.kind))
    .sort((a,b)=>turnCandidatePriority(game,actorId,b)-turnCandidatePriority(game,actorId,a));
  const choices=[...new Map([decision.action,fallback?.action,hold,...alternatives].filter(Boolean)
    .map(a=>[actionKey(a),a])).values()].slice(0,5);
  if(choices.length<2)return null;
  const compared=[];
  for(const action of choices){
    const turn=planPublicTurn(game,actorId,action,{previewTacticalAction},{maximumExpansions:12,
      evaluateEndpoint:end=>previewPublicReserveHorizon(end,actorId)});
    if(!turn?.game)return null;
    const horizon=turn.endpointAssessment;if(!horizon)return null;
    compared.push({action,score:horizon.score,attacks:horizon.attacks,
      continuation:turn.steps,searchComplete:turn.searchComplete && horizon.searchComplete});
  }
  if(!compared.some(c=>c.attacks))return null;
  compared.sort((a,b)=>b.score-a.score);const best=compared[0],worst=compared.at(-1);
  if(best.score-worst.score<0.25)return null;
  return {contract:RESPONSE_DEMONSTRATION_CONTRACT,action:best.action,continuation:[best.action],
    weight:Math.min(0.4,0.1+(best.score-worst.score)/20),opponentResponsesCompared:true,
    responseReview:{comparisons:compared,probabilityModel:'public-attack-stress-comparison',searchScope:'next-turn-public-attack-and-defense'},
    correctionEligible:false,winProbabilityLabel:false};
}

// Shared by generated games and submitted-game imitation. Keeping separate
// teachers here previously dropped reserve lessons from the live-data path.
export function recommendTacticalDemonstration(game,actorId,decision,{responseAware=true}={}) {
  const fallback=recommendPublicTacticalAction(game,actorId,decision.legalActions,{selectedAction:decision.action});
  return (responseAware ? recommendResponseAwareAction(game,actorId,decision,fallback) : null)||fallback;
}

export function responseMixtureScore(noResponseScore, responses) {
  if (!Number.isFinite(noResponseScore) || responses.some(r => !Number.isFinite(r.score)
    || !Number.isFinite(r.probability) || r.probability < 0 || r.probability > 1)) return null;
  const mass = responses.reduce((sum, r) => sum + r.probability, 0);
  if (!mass) return noResponseScore;
  // Named single-response approximation: hand marginals are not mutually
  // exclusive, so neither sum(p) nor this mixture is an exact win probability.
  const any = 1 - responses.reduce((none, r) => none * (1 - r.probability), 1);
  return (1 - any) * noResponseScore + any * responses.reduce((sum, r) =>
    sum + r.probability / mass * Math.min(noResponseScore, r.score), 0);
}

export function recommendResponseAwareAction(game, actorId, decision, fallback = null,
  { maximumCandidates = 4, maximumResponses = 2 } = {}) {
  if (!['action', 'showdown'].includes(game.phase) || decision.legalCount < 2
    || game.pendingPayment || game.pendingChoice?.effect === 'triggerOrder') return null;
  const reserve=recommendReserveAwareAction(game,actorId,decision,fallback);
  if(reserve)return reserve;
  // A single-exchange comparison cannot fairly override a multi-action plan.
  if(fallback?.searchScope==='bounded-public-turn' && fallback.continuation.length>1)return null;
  const responses = opponentResponseProfile(game, actorId, {}, { includeCandidates: true }).responses
    .filter(r => r.payable && r.probability > 0).slice(0, maximumResponses);
  if (!responses.length) return null;
  const ranked = decision.legalActions.map((action, i) => ({ action, p: decision.probabilities[i] }))
    .sort((a, b) => b.p - a.p);
  const hold = decision.legalActions.find(a => ['passShowdown', 'endTurn', 'declineEffectChoice'].includes(a.kind));
  const selected = [decision.action, fallback?.action, hold, ...ranked.map(r => r.action)].filter(Boolean);
  const candidates = [...new Map(selected.map(a => [actionKey(a), a])).values()].slice(0, maximumCandidates);
  const comparisons = [];
  for (const action of candidates) {
    const baseline = previewTacticalAction(game, actorId, action, { maximumStates: 96 });
    if (!baseline?.searchComplete) return null;
    const outcomes = [];
    for (const response of responses) {
      const result = previewTacticalResponse(game, actorId, action, byNumber.get(response.cardNumber), { maximumStates: 256 });
      if (!result?.searchComplete) return null; // An unknown branch must not become a harmless pass.
      outcomes.push({ cardNumber: response.cardNumber, probability: response.probability, score: result.score });
    }
    comparisons.push({ action, noResponseScore: baseline.score, responses: outcomes,
      score: responseMixtureScore(baseline.score, outcomes) });
  }
  comparisons.sort((a, b) => b.score - a.score || actionKey(a.action).localeCompare(actionKey(b.action)));
  const best = comparisons[0], current = comparisons.find(c => actionKey(c.action) === actionKey(decision.action));
  const worst = comparisons.at(-1);
  if (!best || !current || best.score - worst.score < 0.25) return null;
  return { contract: RESPONSE_DEMONSTRATION_CONTRACT, action: best.action, continuation: [best.action],
    weight: Math.min(0.5, 0.15 + (best.score - worst.score) / 16),
    gain: best.score - publicTacticalValue(game, actorId), gainOverHold: hold
      ? best.score - comparisons.find(c => actionKey(c.action) === actionKey(hold)).score : null,
    gainOverCurrent: best.score - current.score, opponentResponsesCompared: true,
    responseReview: { comparisons, probabilityModel: 'approximate-single-response-mixture',
      searchScope: 'bounded-current-exchange', candidateCoverage: candidates.length / decision.legalCount },
    correctionEligible: false, winProbabilityLabel: false };
}
