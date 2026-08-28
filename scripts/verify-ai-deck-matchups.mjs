import { createGame } from "../src/engine.mjs";
import { decklists } from "../src/cards.mjs";
import { activeActorId, applyAiAction, enumerateAiPolicyActions } from "../src/ai/actions.mjs";
import { scoreActions } from "../src/ai/policy.mjs";
import { seededRandom } from "../src/ai/neural/selfplay.mjs";

const options = parseArgs(process.argv.slice(2));
const targetId = options.target || "proving-grounds-master-yi";
const opponentIds = String(options.opponents || "proving-grounds-annie,origins-kaisa,origins-sett,origins-leona").split(",").filter(Boolean);
const gamesPerMatchup = Math.max(2, Number(options.gamesPerMatchup || 4));
const maxActions = Math.max(100, Number(options.maxActions || 1200));
const seed = Number(options.seed || 20260719);
const decksById = new Map(Object.values(decklists).map((deck) => [deck.id, deck]));
const target = requireDeck(targetId);
let targetWins = 0;
let completed = 0;

for (let opponentIndex = 0; opponentIndex < opponentIds.length; opponentIndex += 1) {
  const opponent = requireDeck(opponentIds[opponentIndex]);
  for (let gameIndex = 0; gameIndex < gamesPerMatchup; gameIndex += 1) {
    const targetSeat = gameIndex % 2;
    const firstPlayerId = Math.floor(gameIndex / 2) % 2 ? "p2" : "p1";
    const gameSeed = (seed + opponentIndex * 104729 + Math.floor(gameIndex / 4) * 130363) >>> 0;
    const pair = targetSeat === 0 ? [target, opponent] : [opponent, target];
    const game = createGame({ decks: pair, firstPlayerId, interactive: true, manualActionChainPriority: true, decisionSafety: "strict", random: seededRandom(gameSeed), randomSeed: gameSeed });
    const actionCounts = [new Map(), new Map()];
    const playedCards = [new Map(), new Map()];
    const maxRunes = [0, 0];
    let actionCount = 0;
    for (; actionCount < maxActions && game.phase !== "complete"; actionCount += 1) {
      const actorId = activeActorId(game);
      const seat = game.players.findIndex((player) => player.id === actorId);
      const selected = scoreActions(game, actorId, enumerateAiPolicyActions(game, actorId))[0]?.action;
      const playedCardName = ["beginPlayCard", "beginPlayChampion"].includes(selected?.kind) ? selectedCardName(game, selected.cardId) : null;
      if (!selected || !applyAiAction(game, selected, actorId)?.ok) break;
      game.players.forEach((player, index) => { maxRunes[index] = Math.max(maxRunes[index], player.runes.length); });
      increment(actionCounts[seat], selected.kind);
      if (playedCardName) increment(playedCards[seat], playedCardName);
    }
    const targetPlayerId = `p${targetSeat + 1}`;
    completed += game.phase === "complete" ? 1 : 0;
    targetWins += game.winnerId === targetPlayerId ? 1 : 0;
    console.log(`${target.id} ${game.players[targetSeat].score}:${game.players[1 - targetSeat].score} ${opponent.id} | winner=${game.winnerId || "none"} targetSeat=p${targetSeat + 1} first=${firstPlayerId} actions=${actionCount} turn=${game.turnNumber} runes=${game.players[targetSeat].runes.length}/${maxRunes[targetSeat]} champion=${game.players[targetSeat].champion?.zone} moves=${actionCounts[targetSeat].get("moveUnit") || 0}`);
    console.log(`  target plays: ${[...playedCards[targetSeat]].map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`);
  }
}

console.log(`\nTarget result: ${targetWins}/${completed} wins (${completed}/${opponentIds.length * gamesPerMatchup} completed)`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) parsed[toCamelCase(args[index].slice(2))] = args[index + 1];
  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function requireDeck(id) {
  const deck = decksById.get(id);
  if (!deck) throw new Error(`Unknown deck: ${id}`);
  return deck;
}

function increment(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function selectedCardName(game, cardId) {
  for (const player of game.players) {
    const card = [player.champion, ...player.hand, ...player.base, ...player.trash, ...(player.banished || [])].find((candidate) => candidate?.instanceId === cardId);
    if (card) return card.name;
  }
  for (const field of game.battlefields) {
    const card = field.units.find((candidate) => candidate.instanceId === cardId);
    if (card) return card.name;
  }
  return cardId || "unknown";
}
