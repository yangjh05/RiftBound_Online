function effects(value){
  if(!value||typeof value!=='object')return [];
  return [...(value.kind?[value]:[]),...Object.values(value).flatMap(v=>
    v&&typeof v==='object'?effects(v):[])];
}
const enemies=(game,actorId)=>new Set([...game.players.flatMap(p=>p.base),
  ...game.battlefields.flatMap(f=>f.units)].filter(c=>c.type==='unit'&&c.controllerId!==actorId).map(c=>c.instanceId));

// Rescue a temporary debuff from the no-payoff mask only after a real paid
// engine continuation demonstrates removal. This is an opportunity test, not
// a guarantee against reactions. No card-name branches or invented damage.
export function hasPublicRemovalCombo(game,actorId,action,preview){
  if(!['beginPlayCard','activateCard','chooseEffectOption'].includes(action.kind))return false;
  const actor=game.players.find(p=>p.id===actorId);
  const source=game.pendingChoice?.card||actor.hand.find(c=>c.instanceId===action.cardId);
  if(!effects(source?.effects).some(e=>/might|weaken|reduce/i.test(e.kind)&&Number(e.amount)<0))return false;
  const before=enemies(game,actorId);
  if(!before.size)return false;
  const options={maximumStates:64,returnGame:true,returnOutcomes:true,
    skipReadyEntryOrdering:true,skipTemporaryPurpose:true};
  const first=preview(game,actorId,action,options);
  if(!first)return false;
  for(const outcome of first.outcomes||[first]){
    const after=enemies(outcome.game,actorId);
    if([...before].some(id=>!after.has(id)))return true;
    const damageCards=outcome.game.players.find(p=>p.id===actorId).hand.filter(c=>c.type==='spell'
      && effects(c.effects).some(e=>/damage/i.test(e.kind))).slice(0,6);
    for(const card of damageCards){
      const next={kind:'beginPlayCard',cardId:card.instanceId,destination:'base'};
      const combined=preview(outcome.game,actorId,next,options);
      if(!combined)continue;
      const removed=new Set((combined.outcomes||[combined]).flatMap(o=>{
        const living=enemies(o.game,actorId);return [...before].filter(id=>!living.has(id));
      }));
      if(!removed.size)continue;
      // If damage alone removes that target, the debuff has not demonstrated
      // a necessary payoff. Declaration choices cannot restart another spell.
      const alone=game.pendingChoice?null:preview(game,actorId,next,options);
      for(const o of alone?.outcomes|| (alone?[alone]:[])){
        const living=enemies(o.game,actorId);for(const id of removed)if(!living.has(id))removed.delete(id);
      }
      if(removed.size)return true;
    }
  }
  return false;
}
