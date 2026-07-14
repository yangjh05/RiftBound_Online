export function createPlayers(sourceDecks) {
  let nextInstanceId = 1;
  const instantiate = (card, ownerId) => ({
    ...structuredClone(card),
    instanceId: `c${nextInstanceId++}`,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachments: []
  });
  const players = [
    createPlayer("p1", sourceDecks[0], instantiate),
    createPlayer("p2", sourceDecks[1], instantiate)
  ];
  applySeatNames(players);
  return players;
}

export function isChampionCard(card) {
  return Boolean(card?.isChampion || card?.tags?.includes("Champion"));
}

export function championMatchesLegend(card, legend) {
  if (!isChampionCard(card) || !legend) return false;
  const ignored = new Set(["Champion", "Signature", "Signature Spell", "Action", "Reaction", "Unit", "Spell", "Gear"]);
  const legendTags = new Set((legend.tags || []).filter((tag) => !ignored.has(tag)));
  return (card.tags || []).some((tag) => legendTags.has(tag));
}

function createPlayer(id, deck, instantiate) {
  return {
    id,
    name: deck.playerName,
    source: deck.source,
    score: 0,
    xp: 0,
    legend: instantiate(deck.legend, id),
    champion: null,
    championPlayed: false,
    chosenChampionName: null,
    availableChampions: startingChampionCards(deck).map((card) => instantiate(card, id)),
    availableBattlefields: deck.battlefields.map((field) => instantiate(field, id)),
    selectedBattlefieldId: null,
    mainDeck: startingMainDeckCards(deck).map((card) => instantiate(card, id)),
    runeDeck: deck.runes.map((card) => instantiate(card, id)),
    hand: [],
    base: [],
    runes: [],
    trash: [],
    banished: [],
    turnScoredBattlefields: new Set(),
    cardsPlayedThisTurn: 0,
    drawCountThisTurn: 0,
    endTurnReadyRunes: 0,
    runePool: { energy: [], power: [] },
    hasTakenFirstTurn: false,
    preventedDeathsThisTurn: 0
  };
}

function championCards(deck) {
  if (Array.isArray(deck.champions)) {
    return deck.champions.flatMap(([card, count]) => Array.from({ length: count }, () => card));
  }
  if (!deck.champion) return [];
  return Array.from({ length: Math.max(1, deck.championCount || 1) }, () => deck.champion);
}

function startingChampionCards(deck) {
  return uniqueCardsById(playableDeckCards(deck).filter(isChampionCard));
}

function startingMainDeckCards(deck) {
  const pool = playableDeckCards(deck);
  for (const champion of startingChampionCards(deck)) {
    const index = pool.findIndex((card) => card.id === champion.id);
    if (index >= 0) pool.splice(index, 1);
  }
  return pool;
}

function playableDeckCards(deck) {
  return [...deck.main, ...championCards(deck)];
}

function uniqueCardsById(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

function applySeatNames(players) {
  const generated = players.map((player) => identitySeatName(player));
  const duplicateNames = new Set(generated.filter((name, index) => generated.indexOf(name) !== index));
  for (const [index, player] of players.entries()) {
    player.name = duplicateNames.has(generated[index]) ? `Player ${index + 1}` : generated[index];
  }
}

function identitySeatName(player) {
  const colors = (player.legend.domains || []).join("/");
  const legend = player.legend.name.split(",")[0];
  return `${colors} ${legend}`.trim();
}
