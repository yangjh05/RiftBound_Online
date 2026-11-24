const energy=c=>Math.max(0,Number(c.energy)||0);
const ramp=c=>(c.effects||[]).some(e=>['channelRunes','channelRunesOrDraw'].includes(e.kind));
const earlyUnit=c=>c.type==='unit'&&energy(c)<=3;

// Opening-hand comparison integrates all one/two-card replacements from the
// owner's known deck composition. It never looks at the shuffled draw order.
export function openingDevelopmentAdvice(game,actorId,actions,selectedAction=null){
  if(game.phase!=='mulligan'||game.mulligan?.playerId!==actorId)return null;
  const p=game.players.find(p=>p.id===actorId),deck=p.mainDeck;
  if(!deck.length||deck.some(c=>!c.type||c.type==='unknown'))return null;
  const pool=[...p.hand,...deck],unitDeck=pool.filter(earlyUnit).length>=6;
  const quality=hand=>{
    const units=hand.filter(earlyUnit).length,ramps=hand.filter(c=>ramp(c)&&energy(c)<=4).length;
    const development=unitDeck?units:units+ramps;
    const names=new Map();for(const c of hand)names.set(c.cardNumber,(names.get(c.cardNumber)||0)+1);
    return hand.reduce((n,c)=>n+1-Math.max(0,energy(c)-3)*0.38
      +(earlyUnit(c)?0.5:0)+(ramp(c)&&energy(c)<=4?0.45:0),0)
      -Math.max(0,1-development)*3-Math.max(0,2-development)*0.5
      -[...names.values()].reduce((n,k)=>n+Math.max(0,k-1)*0.15,0);
  };
  const comparisons=[];
  for(const action of actions.filter(a=>a.kind==='submitMulligan')){
    const ids=new Set(action.cardIds),kept=p.hand.filter(c=>!ids.has(c.instanceId));
    let sum=0,count=0;
    if(ids.size===0){sum=quality(kept);count=1;}
    else for(let i=0;i<deck.length;i++){
      if(ids.size===1){sum+=quality([...kept,deck[i]]);count++;}
      else if(ids.size===2)for(let j=i+1;j<deck.length;j++){sum+=quality([...kept,deck[i],deck[j]]);count++;}
    }
    if(count)comparisons.push({action,score:sum/count});
  }
  comparisons.sort((a,b)=>b.score-a.score||a.action.cardIds.length-b.action.cardIds.length);
  const best=comparisons[0],key=a=>[...(a?.cardIds||[])].sort().join('|');
  const original=comparisons.find(c=>key(c.action)===key(selectedAction));
  if(!best||!original||best.score-original.score<0.75)return null;
  return {action:best.action,continuation:[best.action],weight:0.5,comparison:'opening-development',
    comparisons,gain:best.score-original.score,mulliganLesson:true,searchComplete:true,
    correctionEligible:false,winProbabilityLabel:false,opponentResponsesCompared:false};
}

export function actionHasDeferredDevelopment(game,actorId,action){
  const p=game.players.find(p=>p.id===actorId),c=p?.hand.find(c=>c.instanceId===action?.cardId);
  return action?.kind==='beginPlayCard'&&c?.effects?.some(e=>
    ['channelRunes','channelRunesOrDraw','draw','drawCards','predict','search'].includes(e.kind)||e.draw>0);
}
