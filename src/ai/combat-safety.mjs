// This diagnostic identifies a question for independent comparison, never a
// correction label. attack-plan.mjs separately enforces the selected attack's
// support commitment; neither mechanism proves optimal play against responses.
import { hiddenCardIsControlledBy } from '../rules/zones.mjs';

export function reviewCombatContinuations(game, actorId, actions, api) {
  const showdown = game.showdown;
  if (!showdown || ![showdown.attackerId,showdown.defenderId].includes(actorId) || showdown.combat === false
    || game.pendingPayment || game.pendingChoice || game.phase !== 'showdown'
    || showdown.chain?.length) return null;
  const pass = actions.find(a=>a.kind==='passShowdown');
  const field = game.battlefields.find(f=>f.instanceId===showdown.battlefieldId);
  if (!pass || !field || !field.units.some(u=>u.controllerId===actorId)
    || !field.units.some(u=>u.controllerId!==actorId)) return null;
  const player = game.players.find(p=>p.id===actorId);
  const available = [...player.hand, ...game.battlefields.flatMap(f=>(f.hidden||[])
    .filter(h=>hiddenCardIsControlledBy(h,actorId)).map(h=>h.card))];
  const plays = actions.filter(a=>a.kind==='beginPlayCard'
    && simpleCombatSpell(available.find(c=>c.instanceId===a.cardId))).slice(0,6);
  if (!plays.length) return null;
  const baseline = previewCombatLines(game,actorId,pass,field,api);
  if (!baseline.length || baseline.every(o=>!o.ownLost.length && !o.hiddenLost.length)) return null;
  const comparisons = [];
  for (const action of plays) {
    const outcomes = previewCombatLines(game,actorId,action,field,api);
    if (outcomes.some(o=>baseline.every(b=>o.ownLost.length<b.ownLost.length
      || o.enemyLost.length>b.enemyLost.length || o.hiddenLost.length<b.hiddenLost.length
      || (o.control===actorId && b.control!==actorId)))) {
      const card = available.find(c=>c.instanceId===action.cardId);
      comparisons.push({action,outcomes,printedEnergy:card.energy||0,power:card.power||[]});
    }
  }
  if (!comparisons.length) return null;
  return {version:1,kind:'combat-response-versus-reserve',
    evidenceKind:'conditional-no-response-preview',assumptions:['opponent-passes','current-combat-only'],
    correctionEligible:false,hardExclusionEligible:false,opponentResponsesCompared:false,
    resourceOpportunityCostCompared:false,baseline,
    requiredActions:[pass,...comparisons.slice(0,2).map(c=>c.action)],comparisons};
}

export function simpleCombatSpell(card) {
  return card?.type==='spell' && card.effects?.length>0 && card.effects.every(e=>
    e.timing==='spell' && ['modifyMight','dealDamageUnit','damageUnit','giveKeyword',
      'returnUnitToBase','returnBattlefieldUnitToHand','killUnit','stunUnit'].includes(e.kind)
    && !e.optional && !e.condition && !e.repeat && !e.choices && !e.effects);
}

export function previewCombatLines(source,actorId,first,field,api) {
  const apply = (game,action,id) => api.applyAiAction(game,action,id,{skipCombatPlan:true});
  const initial = api.cloneGame(source);
  // Preserve hidden-zone sizes, never use their identities to rank a choice.
  for (const player of initial.players) {
    player.mainDeck = (player.mainDeck||[]).map((_,i)=>({instanceId:`guard-unknown-${player.id}-${i}`,type:'unknown',effects:[],keywords:[]}));
    if (player.id!==actorId) player.hand = (player.hand||[]).map((_,i)=>({instanceId:`guard-hand-${player.id}-${i}`,type:'unknown',effects:[],keywords:[]}));
  }
  if (!apply(initial,first,actorId)?.ok) return [];
  const queue = [{game:initial,depth:0,continuation:first.kind==='passShowdown'?[]:[first]}], results = [];
  let visited = 0;
  while (queue.length) {
    if (++visited>48) return [];
    const {game,depth,continuation} = queue.shift();
    if (depth>24 || game.phase==='complete') return [];
    if (game.pendingPayment) {
      const plan = api.planPaymentActions(game,{allowResourceActivations:false});
      if (!plan?.length) return [];
      for (const action of plan) if (!apply(game,action,game.pendingPayment?.playerId)?.ok) return [];
      queue.push({game,depth:depth+1,continuation}); continue;
    }
    if (game.pendingChoice) {
      const choice=game.pendingChoice;
      if (choice.optional || choice.options?.length>8) return [];
      const choices=(choice.options||[]).filter(o=>!o.disabled);
      if (!choices.length || (choice.playerId!==actorId && choices.length!==1)
        || !['declarePlayTarget','declareHiddenPlayTarget','combatDamage'].includes(choice.effect)) return [];
      for (const option of choices) {
        const branch=api.cloneGame(game);
        const action={kind:'chooseEffectOption',optionId:option.id};
        if (!apply(branch,action,choice.playerId)?.ok) return [];
        queue.push({game:branch,depth:depth+1,continuation:choice.playerId===actorId
          && ['declarePlayTarget','declareHiddenPlayTarget'].includes(choice.effect)?[...continuation,action]:continuation});
      }
      continue;
    }
    if (game.showdown) {
      if (game.showdown.battlefieldId!==field.instanceId
        || !apply(game,{kind:'passShowdown'},game.showdown.priorityPlayerId)?.ok) return [];
      queue.push({game,depth:depth+1,continuation}); continue;
    }
    if (game.actionChain || game.combat || game.stagedEvents?.length) return [];
    const living=new Set(game.players.flatMap(p=>p.base||[])
      .concat(game.battlefields.flatMap(f=>f.units||[])).map(u=>u.instanceId));
    results.push({continuation,ownLost:field.units.filter(u=>u.controllerId===actorId&&!living.has(u.instanceId)).map(u=>u.instanceId),
      enemyLost:field.units.filter(u=>u.controllerId!==actorId&&!living.has(u.instanceId)).map(u=>u.instanceId),
      hiddenLost:(field.hidden||[]).filter(h=>hiddenCardIsControlledBy(h,actorId)
        && !game.battlefields.some(f=>(f.hidden||[]).some(item=>item.card.instanceId===h.card.instanceId)))
        .map(h=>h.card.instanceId),
      scores:game.players.map(p=>p.score),control:game.battlefields.find(f=>f.instanceId===field.instanceId)?.controlledBy||null});
  }
  return results;
}

export function hasCombatSacrificePayoff(game,actorId,units) {
  const actor=game.players.find(p=>p.id===actorId);
  const sources=[actor?.legend,actor?.champion?.zone==='played'?actor.champion:null,
    ...(actor?.base||[]),...game.battlefields.flatMap(f=>f.units.filter(u=>u.controllerId===actorId))].filter(Boolean);
  return [...sources,...units.filter(u=>u.controllerId===actorId)].some(card=>
    [card,...(card.attachments||[])].some(source=>
      (source.keywords||[]).some(k=>/deathknell/i.test(String(k)))
      || (source.effects||[]).some(e=>/death|kill|slay/i.test(String(e.timing||''))
        || /trash|graveyard|death|slain/i.test(String(e.kind||'')))));
}
