import { effectiveMight } from "../engine.mjs";
import { hiddenCardControllerId } from "../rules/zones.mjs";

export function observeGame(game, viewerId) {
  const self = game.players.find((player) => player.id === viewerId);
  const opponent = game.players.find((player) => player.id !== viewerId);
  if (!self || !opponent) return null;
  const intel = (game.revealedIntel || []).some((item) =>
    item.viewerId === viewerId && item.ownerId === opponent.id && item.expiresAtTurnSequence === game.turnSequence
  );
  return {
    viewerId,
    phase: game.phase,
    turnNumber: game.turnNumber,
    turnSequence: game.turnSequence,
    victoryScore: game.victoryScore,
    currentPlayerId: game.currentPlayerId,
    focusPlayerId: game.pendingChoice?.playerId || game.pendingPayment?.playerId || game.actionChain?.priorityPlayerId || game.showdown?.priorityPlayerId || game.currentPlayerId,
    self: publicPlayer(self, true),
    opponent: publicPlayer(opponent, intel),
    battlefields: game.battlefields.map((field) => ({
      id: field.instanceId,
      name: field.name,
      controlledBy: field.controlledBy,
      units: field.units.map(publicCard),
      hidden: (field.hidden || []).map((item) => hiddenCardControllerId(item) === viewerId || intel
        ? { ownerId: item.ownerId, card: publicCard(item.card) }
        : { ownerId: item.ownerId, card: { hidden: true } })
    })),
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

function publicPlayer(player, privateVisible) {
  return {
    id: player.id,
    score: player.score,
    xp: player.xp || 0,
    handCount: player.hand.length,
    hand: privateVisible ? player.hand.map(publicCard) : [],
    deckCount: player.mainDeck.length,
    trash: player.trash.map(publicCard),
    banished: (player.banished || []).map(publicCard),
    base: player.base.map(publicCard),
    runes: player.runes.map((rune) => ({ domain: rune.domain, exhausted: Boolean(rune.exhausted) })),
    champion: player.champion ? publicCard(player.champion) : null,
    legend: publicCard(player.legend)
  };
}

function publicCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    instanceId: card.instanceId,
    name: card.name,
    type: card.type,
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    energy: card.energy || 0,
    cardNumber: card.cardNumber || "",
    domains: [...(card.domains || [])],
    might: card.type === "unit" ? effectiveMight(card) : 0,
    damage: card.damage || 0,
    buffs: card.buffs || 0,
    mightModifier: card.mightModifier || 0,
    exhausted: Boolean(card.exhausted),
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
  return cards.reduce((sum, card) => sum + (card.might || 0) - Math.min(card.might || 0, card.damage || 0), 0);
}

function readyRunes(player) {
  return player.runes.filter((rune) => !rune.exhausted).length;
}
