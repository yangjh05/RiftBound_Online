import { currentMight } from '../engine.mjs';

export function isReadyEntrySetup(card) {
  return card?.type === 'spell' && card.effects?.some(effect =>
    effect.timing === 'spell' && effect.kind === 'unitsEnterReadyThisTurn');
}

export function actionUnit(game, actorId, action) {
  const player = game.players.find(p => p.id === actorId);
  const card = action.kind === 'beginPlayChampion' ? player?.champion
    : action.kind === 'beginPlayCard' ? player?.hand.find(c => c.instanceId === action.cardId) : null;
  return card?.type === 'unit' ? card : null;
}

// Compare the same two paid actions in both orders. A trigger bonus alone is
// not an exception: its usable payoff must exceed the ready unit's best
// inspected continuation. End the turn in both branches so unused temporary
// bonuses expire. These are public, no-response tactical preferences, not
// proofs about hidden responses or an exhaustive search of future turns.
// Draw-only setup use stays available; unaffordable or unresolved pairs stay
// with the policy instead of pretending that an unverified order dominates.
export function filterReadyEntryOrder(game, actorId, actions, api) {
  const player = game.players.find(p => p.id === actorId);
  if (!player || game.phase !== 'action' || game.currentPlayerId !== actorId
    || game.pendingChoice || game.pendingPayment || game.showdown || game.actionChain
    || player.unitsEnterReadyThisTurn || player.nextUnitEnterReady) return actions;
  const setup = actions.find(a => a.kind === 'beginPlayCard'
    && isReadyEntrySetup(player.hand.find(c => c.instanceId === a.cardId)));
  if (!setup) return actions;
  const units = actions.filter(a => actionUnit(game, actorId, a)).slice(0, 6);
  if (!units.length) return actions;
  const preview = (source, action) => api.previewTacticalAction(source, actorId, action,
    { returnGame: true, skipReadyEntryOrdering: true, maximumStates: 64 });
  const setupFirst = preview(game, setup);
  if (!setupFirst?.game || !setupFirst.searchComplete) return actions;
  const excluded = new Set();
  for (const action of units) {
    const unit = actionUnit(game, actorId, action);
    const readyResult = preview(setupFirst.game, action);
    const unitFirst = preview(game, action);
    if (!readyResult?.game || !readyResult.searchComplete || !unitFirst?.game || !unitFirst.searchComplete) continue;
    const exhaustedResult = preview(unitFirst.game, setup);
    if (!exhaustedResult?.game || !exhaustedResult.searchComplete) continue;
    const ready = boardUnit(readyResult.game, unit.instanceId);
    const exhausted = boardUnit(exhaustedResult.game, unit.instanceId);
    if (!ready || !exhausted || ready.exhausted || !exhausted.exhausted) continue;
    const readyOutcome = bestTurnOutcome(readyResult.game, actorId, api);
    const unitOnlyOutcome = bestTurnOutcome(unitFirst.game, actorId, api);
    // Having the setup in hand must not force paying for it. Keep the option
    // to play only the unit when readiness cannot repay the additional cost.
    if (!readyOutcome || !unitOnlyOutcome || readyOutcome.score <= unitOnlyOutcome.score + 1e-6) continue;
    if (comparisonState(readyResult.game, actorId, unit.instanceId)
      !== comparisonState(exhaustedResult.game, actorId, unit.instanceId)) {
      const reverseOutcome = bestTurnOutcome(exhaustedResult.game, actorId, api);
      if (!reverseOutcome || reverseOutcome.score > readyOutcome.score + 1e-6) continue;
    }
    excluded.add(api.actionKey(action));
  }
  return actions.filter(a => !excluded.has(api.actionKey(a)));
}

function bestTurnOutcome(game, actorId, api) {
  const followups = api.enumerateAiPolicyActions(game, actorId, {skipReadyEntryOrdering:true})
    .filter(a => ['moveUnit', 'moveUnits', 'activateCard'].includes(a.kind));
  // Do not silently truncate alternatives and call the comparison complete.
  if (followups.length > 16) return null;
  let best = null;
  for (const action of [{kind:'endTurn'}, ...followups]) {
    const outcome = api.previewTacticalAction(game, actorId, action, {
      maximumStates:128, finishTurn:true, skipReadyEntryOrdering:true
    });
    if (!outcome?.searchComplete) return null;
    if (!best || outcome.score > best.score) best = outcome;
  }
  return best;
}

function boardUnit(game, id) {
  return [...game.players.flatMap(p => p.base), ...game.battlefields.flatMap(f => f.units)]
    .find(c => c.instanceId === id);
}

function comparisonState(game, actorId, readyId) {
  const sort = values => [...values].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const card = c => c ? {
    ...c, exhausted: c.instanceId === readyId ? false : c.exhausted,
    calculatedMight: c.type === 'unit' ? currentMight(game,c) : null
  } : null;
  const hand = p => p.id === actorId ? sort(p.hand.map(c => c.type === 'unknown'
    ? {type:'unknown'} : card(c))) : p.hand.length;
  return JSON.stringify({phase:game.phase,winner:game.winnerId,
    players:game.players.map(p => ({id:p.id,score:p.score,xp:p.xp,
      hand:hand(p),deckCount:p.mainDeck.length,legend:card(p.legend),champion:card(p.champion),
      championPlayed:p.championPlayed,base:sort(p.base.map(card)),trash:sort(p.trash.map(card)),
      banished:sort((p.banished||[]).map(card)),runes:sort(p.runes.map(card)),runePool:p.runePool,
      cardsPlayedThisTurn:p.cardsPlayedThisTurn,spellsPlayedThisTurn:p.spellsPlayedThisTurn,
      unitsPlayedThisTurn:p.unitsPlayedThisTurn,unitsEnterReadyThisTurn:p.unitsEnterReadyThisTurn,
      nextUnitEnterReady:p.nextUnitEnterReady,nextSpellBonusDamage:p.nextSpellBonusDamage,
      turnScoredBattlefields:p.turnScoredBattlefields})),
    fields:game.battlefields.map(f=>({...f,units:sort(f.units.map(card))})),
    delayedAbilities:game.delayedAbilities,stagedEvents:game.stagedEvents,
    pendingChoice:game.pendingChoice,pendingPayment:game.pendingPayment});
}
