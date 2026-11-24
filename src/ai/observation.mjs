import { currentMight, effectiveMight } from "../engine.mjs";
import { hiddenCardControllerId } from "../rules/zones.mjs";
import { validMulliganBottomEntries } from "./deck-memory.mjs";

export function opponentPrivateInformationVisible(game, viewerId, ownerId) {
  return (game.revealedIntel || []).some((item) => item.viewerId === viewerId
    && item.ownerId === ownerId && item.expiresAtTurnSequence === game.turnSequence);
}

export function observeGame(game, viewerId, options = {}) {
  const self = game.players.find((player) => player.id === viewerId);
  const opponent = game.players.find((player) => player.id !== viewerId);
  if (!self || !opponent) return null;
  const includeExtendedContext = options.includeExtendedContext !== false;
  const intel = opponentPrivateInformationVisible(game, viewerId, opponent.id);
  return {
    viewerId,
    phase: game.phase,
    turnNumber: game.turnNumber,
    turnSequence: game.turnSequence,
    victoryScore: game.victoryScore,
    currentPlayerId: game.currentPlayerId,
    focusPlayerId: game.pendingChoice?.playerId || game.pendingPayment?.playerId || game.actionChain?.priorityPlayerId || game.showdown?.priorityPlayerId || game.currentPlayerId,
    self: publicPlayer(game, self, true, true),
    opponent: publicPlayer(game, opponent, intel, false),
    battlefields: game.battlefields.map((field) => ({
      id: field.instanceId,
      name: field.name,
      cardNumber: field.cardNumber || "",
      controlledBy: field.controlledBy,
      units: field.units.map((card) => publicCard(card, game, true)),
      hidden: (field.hidden || []).map((item) => hiddenCardControllerId(item) === viewerId || intel
        ? { ownerId: item.ownerId, card: publicCard(item.card, game) }
        : { ownerId: item.ownerId, card: { hidden: true } })
    })),
    chainCards: includeExtendedContext ? [
      ...(game.actionChain?.chain || []),
      ...(game.showdown?.chain || [])
    ].filter((item) => item?.card).map((item) => publicCard(item.card, game)) : [],
    responseObservations: includeExtendedContext
      ? (game.responseObservations || []).map((event) => ({
      id: event.id,
      outcome: event.outcome,
      chainKind: event.chainKind,
      sourceItemId: event.sourceItemId,
      sourcePlayerId: event.sourcePlayerId,
      responderId: event.responderId,
      sourceCardNumber: event.sourceCardNumber,
      sourceType: event.sourceType,
      probeStrength: event.probeStrength,
      responderHandCount: event.responderHandCount,
      responderRunes: (event.responderRunes || []).map((rune) => ({ ...rune })),
      responderPoolEnergy: event.responderPoolEnergy || 0,
      responderPoolPowerDomains: [...(event.responderPoolPowerDomains || [])],
      turnSequence: event.turnSequence || 0,
        turnNumber: event.turnNumber || 1
      }))
      : [],
    turnEvents: includeExtendedContext ? publicTurnEvents(game, viewerId) : [],
    showdown: game.showdown ? {
      battlefieldId: game.showdown.battlefieldId,
      attackerId: game.showdown.attackerId,
      defenderId: game.showdown.defenderId,
      priorityPlayerId: game.showdown.priorityPlayerId,
      chainSize: game.showdown.chain?.length || 0
    } : null,
    actionChainSize: game.actionChain?.chain?.length || 0
  };
}

function publicTurnEvents(game, viewerId) {
  return (game.publicTurnEvents || [])
    .filter((event) =>
      Number(event.turnNumber) === Number(game.turnNumber)
      && Number(event.turnSequence) === Number(game.turnSequence))
    .map((event) => {
      const identitiesVisible = event.visibility !== "owner-private-identities"
        || event.actorId === viewerId;
      return {
        id: event.id || null,
        sequence: Number(event.sequence) || 0,
        kind: event.kind || null,
        actionKind: event.actionKind || null,
        outcome: event.outcome || null,
        actorId: event.actorId || null,
        sourcePlayerId: event.sourcePlayerId || null,
        sourceCardId: identitiesVisible ? event.sourceCardId || null : null,
        sourceCardNumber:
          identitiesVisible ? event.sourceCardNumber || null : null,
        sourceType: identitiesVisible ? event.sourceType || null : null,
        sourceObjectIds:
          identitiesVisible ? [...(event.sourceObjectIds || [])] : [],
        targetObjectIds:
          identitiesVisible ? [...(event.targetObjectIds || [])] : [],
        objectIds: identitiesVisible ? [...(event.objectIds || [])] : [],
        cardNumbers:
          identitiesVisible ? [...(event.cardNumbers || [])] : [],
        destinationId: event.destinationId || null,
        optionId: event.optionId || null,
        chainKind: event.chainKind || null,
        chainItemType: event.chainItemType || null,
        count: Math.max(0, Number(event.count) || 0),
        phase: event.phase || null,
        turnSequence: Number(event.turnSequence) || 0,
        turnNumber: Number(event.turnNumber) || 1,
        identitiesVisible
      };
    });
}

function publicPlayer(game, player, privateVisible, includePrivateKnowledge = false) {
  const knownBottomEntries = includePrivateKnowledge
    ? validMulliganBottomEntries(player)
    : [];
  const mulliganBottomEntries = knownBottomEntries.filter(({ entry }) =>
    !entry.reason || entry.reason === "mulligan"
  );
  const knownBottomCardsAhead = knownBottomEntries.length
    ? Math.min(...knownBottomEntries.map(({ index }) => index))
    : null;
  const mulliganBottomCardsAhead = mulliganBottomEntries.length
    ? Math.min(...mulliganBottomEntries.map(({ index }) => index))
    : null;
  return {
    id: player.id,
    score: player.score,
    turnScoredBattlefields: [...(player.turnScoredBattlefields || [])],
    unitsEnterReadyThisTurn: Boolean(player.unitsEnterReadyThisTurn),
    nextUnitEnterReady: Boolean(player.nextUnitEnterReady),
    xp: player.xp || 0,
    handCount: player.hand.length,
    handVisible: privateVisible,
    hand: privateVisible ? player.hand.map((card) => publicCard(card, game)) : [],
    deckCount: player.mainDeck.length,
    mulliganBottomCards: mulliganBottomEntries.map(({ card }) => publicCard(card)),
    mulliganBottomCardsAhead,
    knownBottomCards: knownBottomEntries.map(({ card }) => publicCard(card)),
    knownBottomCardsAhead,
    trash: player.trash.map((card) => publicCard(card, game)),
    banished: (player.banished || []).map((card) => publicCard(card, game)),
    base: player.base.map((card) => publicCard(card, game, true)),
    runes: player.runes.map((rune) => ({ domain: rune.domain, exhausted: Boolean(rune.exhausted) })),
    champion: player.champion ? publicCard(player.champion, game, player.champion.zone === "played") : null,
    availableChampions: (player.availableChampions || []).map((card) => publicCard(card, game)),
    legend: publicCard(player.legend, game, true)
  };
}

function publicCard(card, game = null, liveMight = false) {
  if (!card) return null;
  return {
    id: card.id,
    instanceId: card.instanceId,
    name: card.name,
    type: card.type,
    isToken: Boolean(card.isToken),
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    energy: card.energy || 0,
    cardNumber: card.cardNumber || "",
    domains: [...(card.domains || [])],
    might: card.type === "unit" ? (liveMight && game ? currentMight(game, card) : effectiveMight(card)) : 0,
    damage: card.damage || 0,
    buffs: card.buffs || 0,
    mightModifier: card.mightModifier || 0,
    exhausted: Boolean(card.exhausted),
    stunned: Boolean(card.stunned),
    attachments: (card.attachments || []).map((attachment) => publicCard(attachment, game)),
    tags: [...(card.tags || [])],
    keywords: [...(card.keywords || [])]
  };
}

export function stateFeatures(observation) {
  if (!observation) return {};
  const mine = observation.self;
  const theirs = observation.opponent;
  const myUnits = observation.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === mine.id));
  const enemyUnits = observation.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === theirs.id));
  const myControlled = observation.battlefields.filter((field) => field.controlledBy === mine.id).length;
  const enemyControlled = observation.battlefields.filter((field) => field.controlledBy === theirs.id).length;
  return {
    bias: 1,
    scoreDiff: (mine.score - theirs.score) / Math.max(1, observation.victoryScore),
    handDiff: (mine.handCount - theirs.handCount) / 10,
    boardMightDiff: (sumMight(myUnits) - sumMight(enemyUnits)) / 20,
    baseMightDiff: (sumMight(mine.base) - sumMight(theirs.base)) / 20,
    readyRuneDiff: (readyRunes(mine) - readyRunes(theirs)) / 12,
    battlefieldControlDiff: (myControlled - enemyControlled) / Math.max(1, observation.battlefields.length),
    myTurn: observation.currentPlayerId === mine.id ? 1 : 0,
    showdown: observation.phase === "showdown" ? 1 : 0,
    nearVictory: mine.score >= observation.victoryScore - 2 ? 1 : 0,
    nearDefeat: theirs.score >= observation.victoryScore - 2 ? 1 : 0
  };
}

function sumMight(cards) {
  return cards.reduce((sum, card) => sum + Math.max(0, card.might || 0), 0);
}

function readyRunes(player) {
  return player.runes.filter((rune) => !rune.exhausted).length;
}
