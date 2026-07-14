import { decklists } from "../src/cards.mjs";
import {
  activateCard, beginPlayCard, beginPlayChampion, cancelPayment, chooseEffectOption,
  confirmFirstPlayer, confirmPayment, createGame, declineEffectChoice, endTurn,
  moveUnit, passShowdown, selectBattlefield, selectChampion, skipMulligan,
  toggleOptionalPaymentEffect, togglePaymentPoolEnergy, togglePaymentRune
} from "../src/engine.mjs";
import {
  captureResolutionContract, interactionCoverageKeys, semanticCoverageKey,
  validateResolutionContract, validateSemanticChoice, validateStableGameState
} from "./semantic-oracle.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const games = Math.max(1, Number(args.games) || 100);
const maxActions = Math.max(10, Number(args["max-actions"]) || 400);
const seed = (Number(args.seed) || Date.now()) >>> 0;
const allDecks = Object.values(decklists);
const forcedDeckA = args["deck-a"] ? allDecks.find((deck) => deck.id === args["deck-a"]) : null;
const forcedDeckB = args["deck-b"] ? allDecks.find((deck) => deck.id === args["deck-b"]) : null;
const choicePolicy = args["choice-policy"] || "random";
if (args["deck-a"] && !forcedDeckA) throw new Error(`Unknown deck-a: ${args["deck-a"]}`);
if (args["deck-b"] && !forcedDeckB) throw new Error(`Unknown deck-b: ${args["deck-b"]}`);
let state = seed || 1;
const semanticCoverage = new Map();
const interactionCoverage = new Map();
Math.random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);

for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  const gameSeed = state;
  const decks = [forcedDeckA || pick(allDecks), forcedDeckB || pick(allDecks)];
  const game = createGame({ decks, firstPlayerId: args["first-player"] === "p2" ? "p2" : args["first-player"] === "p1" ? "p1" : null, interactive: true, manualActionChainPriority: true });
  const trace = [];
  try {
    for (let action = 0; action < maxActions && game.phase !== "complete"; action += 1) {
      assertInvariants(game);
      const description = step(game);
      trace.push(description);
      for (const key of interactionCoverageKeys(game, description.split(":")[0])) {
        interactionCoverage.set(key, (interactionCoverage.get(key) || 0) + 1);
      }
    }
    assertInvariants(game);
  } catch (error) {
    console.error(JSON.stringify({ seed, gameSeed, gameIndex, decks: decks.map((deck) => deck.id), trace, error: error.stack }, null, 2));
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  const covered = [...semanticCoverage.entries()].sort((a, b) => b[1] - a[1]);
  const pairCount = [...interactionCoverage.keys()].filter((key) => key.startsWith("2|")).length;
  const tripleCount = [...interactionCoverage.keys()].filter((key) => key.startsWith("3|")).length;
  console.log(`Fuzzed ${games} games across ${allDecks.length} decks (seed ${seed}); semantically checked ${covered.length} card/effect paths across ${covered.reduce((sum, [, count]) => sum + count, 0)} choices; covered ${pairCount} effect pairs and ${tripleCount} effect triples.`);
}

function step(game) {
  if (game.phase === "first-player") return result("confirmFirstPlayer", confirmFirstPlayer(game));
  if (game.phase === "champion-select") {
    const player = byId(game, game.championSelectPlayerId);
    const card = pick(player.availableChampions);
    return result(`selectChampion:${card?.instanceId}`, selectChampion(game, player.id, card?.instanceId));
  }
  if (game.phase === "battlefield-select") {
    const player = byId(game, game.setupPlayerId);
    const field = pick(player.availableBattlefields);
    return result(`selectBattlefield:${field?.instanceId}`, selectBattlefield(game, player.id, field?.instanceId));
  }
  if (game.phase === "mulligan") return result("skipMulligan", skipMulligan(game));
  if (game.pendingChoice) {
    validateSemanticChoice(game, game.pendingChoice);
    semanticCoverage.set(semanticCoverageKey(game.pendingChoice), (semanticCoverage.get(semanticCoverageKey(game.pendingChoice)) || 0) + 1);
    const options = game.pendingChoice.options || [];
    const shouldDecline = game.pendingChoice.optional && (choicePolicy === "decline" || (choicePolicy === "random" && Math.random() < 0.25));
    if (shouldDecline) return result("declineChoice", declineEffectChoice(game));
    const option = choicePolicy === "first" || choicePolicy === "accept" ? options[0]
      : choicePolicy === "last" ? options[options.length - 1]
        : pick(options);
    const optionId = option?.id ?? option?.value ?? option;
    const contract = captureResolutionContract(game, game.pendingChoice, optionId);
    const output = chooseEffectOption(game, optionId);
    validateResolutionContract(game, contract, output);
    return result(`choose:${optionId}`, output);
  }
  if (game.pendingPayment) return payOrCancel(game);
  if (game.phase === "showdown") return result(`pass:${game.showdown.priorityPlayerId}`, passShowdown(game, game.showdown.priorityPlayerId));
  if (game.actionChain) return result(`passChain:${game.actionChain.priorityPlayerId}`, passShowdown(game, game.actionChain.priorityPlayerId));
  const player = byId(game, game.currentPlayerId);
  const destinations = ["base", ...game.battlefields.map((field) => field.instanceId)];
  const attempts = shuffle([
    ...player.hand.flatMap((card) => destinations.map((destination) => () => result(`play:${card.instanceId}:${destination}`, beginPlayCard(game, card.instanceId, destination), true))),
    ...player.base.filter((card) => card.type === "unit").flatMap((card) => game.battlefields.map((field) => () => result(`move:${card.instanceId}:${field.instanceId}`, moveUnit(game, card.instanceId, field.instanceId), true))),
    ...[player.legend, player.champion, ...player.base, ...game.battlefields.flatMap((field) => field.units)].filter(Boolean).map((card) => () => result(`activate:${card.instanceId}`, activateCard(game, card.instanceId), true)),
    () => result("playChampion:base", beginPlayChampion(game, "base"), true)
  ]);
  for (const attempt of attempts) {
    const output = attempt();
    if (!output.endsWith(":rejected")) return output;
  }
  return result("endTurn", endTurn(game));
}

function payOrCancel(game) {
  const payment = game.pendingPayment;
  if (Math.random() < 0.08) return result("cancelPayment", cancelPayment(game));
  for (const effect of payment.optionalEffects || []) toggleOptionalPaymentEffect(game, effect.id);
  for (const energy of payment.poolEnergyOptions || []) togglePaymentPoolEnergy(game, energy.id);
  const player = byId(game, payment.playerId);
  for (const rune of player.runes) {
    togglePaymentRune(game, rune.instanceId, "energy");
    togglePaymentRune(game, rune.instanceId, "power");
  }
  const paid = confirmPayment(game);
  return paid.ok ? "confirmPayment" : result("cancelUnpayable", cancelPayment(game));
}

function assertInvariants(game) {
  if (!game.players.some((player) => player.id === game.currentPlayerId)) throw new Error("Invalid current player");
  if (!Number.isInteger(game.turnNumber) || game.turnNumber < 1) throw new Error("Invalid turn number");
  for (const player of game.players) {
    if (!Number.isFinite(player.score) || player.score < 0) throw new Error(`Invalid score for ${player.id}`);
    for (const card of allTopLevelCards(game, player)) {
      if (!card.instanceId || !Number.isFinite(card.damage) || card.damage < 0) throw new Error(`Invalid card state: ${card.instanceId}`);
    }
  }
  const ids = game.players.flatMap((player) => allTopLevelCards(game, player)).map((card) => card.instanceId);
  if (ids.length !== new Set(ids).size) throw new Error("A card instance exists in multiple top-level zones");
  if (game.pendingChoice) validateSemanticChoice(game, game.pendingChoice);
  validateStableGameState(game);
}

function allTopLevelCards(game, player) {
  return [player.legend, player.champion?.zone === "champion" ? player.champion : null, ...player.availableChampions, ...player.availableBattlefields, ...player.mainDeck, ...player.runeDeck, ...player.hand, ...player.base, ...player.runes, ...player.trash, ...(player.banished || []),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.ownerId === player.id)),
    ...game.battlefields.flatMap((field) => (field.hidden || []).filter((card) => card.ownerId === player.id))].filter(Boolean);
}

function result(label, output, markRejected = false) { return `${label}${markRejected && !output?.ok ? ":rejected" : ""}`; }
function byId(game, id) { return game.players.find((player) => player.id === id); }
function pick(items) { return items[Math.floor(Math.random() * items.length)]; }
function shuffle(items) { return items.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item); }
