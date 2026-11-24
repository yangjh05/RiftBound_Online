import assert from 'node:assert/strict';
export function targetedReviewKind(target,game,actor,decision,used,limit){
  assert.ok(['response','growth','mulligan','resource'].includes(target));
  if(used>=limit||decision.legalCount<2)return null;
  if(target==='mulligan')return game.phase==='mulligan'?'mulligan':null;
  if(!['action','showdown'].includes(game.phase)||game.pendingPayment||game.pendingChoice)return null;
  if(target==='response'||target==='resource')return target;
  if(game.phase!=='action'||game.currentPlayerId!==actor||game.showdown||game.actionChain)return null;
  const hand=game.players.find(p=>p.id===actor)?.hand||[];
  const ramp=c=>c?.effects?.some(e=>e.timing==='spell'&&['channelRunes','channelRunesOrDraw'].includes(e.kind));
  // This is only a public/own-hand review trigger. The existing supply teacher
  // must still prove the action under its full unchanged acceptance criteria.
  return hand.some(ramp)?'growth':null;
}
