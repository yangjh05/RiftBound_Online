// Policy consistency, not a claim about optimal play against hidden responses.
// A plain losing attack needs a concrete support line before it is selected.
export function inspectAttackPlan(game, actorId, action, movement, api) {
  if (!movement?.isMovement || movement.destinationType !== 'battlefield'
    || movement.canRemoveEnemyNoResponse || !movement.enemyCanRemoveFriendly
    || game.showdown || game.actionChain || game.pendingChoice || game.pendingPayment) return null;
  if (uncertainAttackPayoff(game, actorId, api)) return null;
  const preview = api.cloneGame(game);
  if (!api.applyAiAction(preview, action, actorId)?.ok || !preview.showdown
    || preview.showdown.attackerId !== actorId || preview.pendingChoice
    || preview.pendingPayment || preview.showdown.chain?.length) return null;
  const field = preview.battlefields.find(f => f.instanceId === action.destinationId);
  const baseline = api.previewCombatLines(preview, actorId, {kind:'passShowdown'}, field, api);
  const own = field.units.filter(u => u.controllerId === actorId);
  const seat = preview.players.findIndex(p => p.id === actorId);
  if (!baseline.length || baseline.some(o => o.ownLost.length !== own.length
    || o.enemyLost.length || o.control === actorId
    || o.scores[seat] !== game.players[seat].score)) return null;

  const legal = api.enumerateLegalActions(preview, actorId)
    .filter(a => !api.isMechanicalResourceActivation(preview,a));
  const plays = legal.filter(a => a.kind === 'beginPlayCard');
  const actor = preview.players[seat];
  const simple = plays.filter(a => api.simpleCombatSpell(actor.hand.find(c => c.instanceId === a.cardId)));
  const unknown = plays.length !== simple.length || simple.length > 6
    || legal.some(a => !['passShowdown','beginPlayCard'].includes(a.kind));
  const branches = [];
  let unresolved = false;
  for (const play of simple.slice(0, 6)) {
    const outcomes = api.previewCombatLines(preview, actorId, play, field, api);
    if (!outcomes.length) unresolved = true;
    for (const outcome of outcomes) {
      // Merely rescuing some attackers does not justify sending them into a
      // loss in the first place. Require an actual attack payoff. Its price
      // and opponent response risk remain the policy's task.
      if ((outcome.enemyLost.length || outcome.control === actorId
        || outcome.scores[seat] > game.players[seat].score)
        && outcome.scores[seat] >= game.players[seat].score) {
        branches.push({steps:outcome.continuation, outcome});
      }
    }
  }
  if (branches.length) return {version:1,kind:'supported-attack',actorId,
    battlefieldId:field.instanceId,turnSequence:game.turnSequence,branches,
    opponentResponseRiskUnresolved:true,resourceOpportunityCostCompared:false};
  // Multiple spells, unhandled abilities, draws and unresolved choices may
  // combine into a line outside this bounded single-spell search.
  if (unknown || unresolved || simple.length > 1
    || simple.some(a => actor.hand.find(c => c.instanceId === a.cardId).effects.some(e => e.draw))) return null;
  return {version:1,kind:'unsupported-loss',actorId,battlefieldId:field.instanceId};
}

function uncertainAttackPayoff(game, actorId, api) {
  const actor = game.players.find(p => p.id === actorId);
  const publicCards = game.players.flatMap(p => [p.legend,
    p.champion?.zone === 'played' ? p.champion : null,...(p.base || [])])
    .concat(game.battlefields.flatMap(f => [f,...f.units])).filter(Boolean);
  if (api.hasCombatSacrificePayoff(game, actorId, publicCards)) return true;
  // Own known hand/trash may reward a death or allow resurrection later.
  if ([...(actor.hand || []),...(actor.trash || [])].some(c => (c.effects || []).some(e =>
    /trash|graveyard|death|slain|reviv|resurrect/i.test(JSON.stringify(e))))) return true;
  // Do not label trigger/ability setups as pointless merely because their
  // numerical combat estimate loses. Unhandled context stays with the policy.
  const unrelatedTimings = new Set(['static','combatStatic','levelStatic','spell','activate','activated',
    'onPlay','chosen','beginning','firstBeginning','mainStart','endTurn','hold',
    'cardHidden','cardPlayed','cardOrAbilityPlayed','spellPlayed','opponentCardPlayed','opponentPlaysUnit','unitPlayedHere']);
  return publicCards.some(c => [c,...(c.attachments || [])].some(s =>
    (s.effects || []).some(e => !unrelatedTimings.has(e.timing))));
}

export function filterCommittedCombatActions(game, actorId, actions, api) {
  const plan = game.aiCombatCommitment;
  if (!validCommitment(game, actorId, plan)) return actions;
  const keys = new Set(plan.branches.map(b => api.actionKey(b.steps[0])));
  const matching = actions.filter(a => keys.has(api.actionKey(a)));
  // A plan made before a real change never fabricates an illegal continuation.
  return matching.length ? matching : actions;
}

export function advanceCombatCommitment(game, actorId, action, previous, wasValid, api) {
  if (!previous) return;
  if (!wasValid || !game.showdown || game.phase === 'complete'
    || (actorId !== previous.actorId && action.kind !== 'passShowdown')) {
    delete game.aiCombatCommitment; return;
  }
  if (actorId === previous.actorId) {
    const branches = previous.branches.filter(b => api.actionKey(b.steps[0]) === api.actionKey(action))
      .map(b => ({...b,steps:b.steps.slice(1)}));
    if (!branches.length || branches.some(b => !b.steps.length)) {
      delete game.aiCombatCommitment; return;
    }
    game.aiCombatCommitment = {...previous,branches,stateKey:combatCommitmentStateKey(game,previous.actorId)};
  } else if (previous.stateKey !== combatCommitmentStateKey(game,previous.actorId)) {
    delete game.aiCombatCommitment;
  }
}

export function validCommitment(game, actorId, plan = game.aiCombatCommitment) {
  return Boolean(plan?.actorId === actorId && plan.branches?.length
    && plan.turnSequence === game.turnSequence
    && plan.battlefieldId === game.showdown?.battlefieldId
    && plan.stateKey === combatCommitmentStateKey(game, actorId));
}

export function combatCommitmentStateKey(game, actorId) {
  // Ignore pass counters/history and all unknown identities. Detect public
  // board/resource changes even when a caller uses an engine API directly.
  return JSON.stringify({turnSequence:game.turnSequence,phase:game.phase,
    players:game.players.map(p => ({id:p.id,score:p.score,legend:p.legend,
      champion:p.champion,base:p.base,runes:p.runes,runePool:p.runePool,trash:p.trash,
      hand:p.id === actorId ? p.hand : p.hand.length,deckSize:p.mainDeck.length})),
    fields:game.battlefields.map(f => ({...f,hidden:(f.hidden || []).map(h =>
      (h.card?.controllerId || h.ownerId) === actorId ? h : {ownerId:h.ownerId,hidden:true})})),
    showdown:game.showdown ? {battlefieldId:game.showdown.battlefieldId,
      attackerId:game.showdown.attackerId,defenderId:game.showdown.defenderId,combat:game.showdown.combat} : null,
    chain:game.showdown?.chain || [],actionChain:game.actionChain,
    pendingChoice:game.pendingChoice,pendingPayment:game.pendingPayment});
}
