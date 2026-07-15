import { decklists } from "../src/cards.mjs";
import {
  activateCard, beginPlayCard, beginPlayChampion, cancelPayment, chooseEffectOption,
  confirmFirstPlayer, confirmPayment, createGame, declineEffectChoice, endTurn,
  moveUnit, passShowdown, selectBattlefield, selectChampion, skipMulligan,
  toggleOptionalPaymentEffect, togglePaymentPoolEnergy, togglePaymentRune
} from "../src/engine.mjs";
import {
  captureInteractionState, captureResolutionContract, causalInteractionCoverageKeys, semanticCoverageKey,
  validateResolutionContract, validateSemanticChoice, validateStableGameState
} from "./semantic-oracle.mjs";
import { captureRuleState, createRuleOracleSession } from "./rules-oracle.mjs";

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
const causalCoverage = new Map();
const rulesOracle = createRuleOracleSession();
Math.random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);

for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  const gameSeed = state;
  const decks = [forcedDeckA || pick(allDecks), forcedDeckB || pick(allDecks)];
  const game = createGame({ decks, firstPlayerId: args["first-player"] === "p2" ? "p2" : args["first-player"] === "p1" ? "p1" : null, interactive: true, manualActionChainPriority: true });
  const trace = [];
  try {
    for (let action = 0; action < maxActions && game.phase !== "complete"; action += 1) {
      assertInvariants(game);
      const interactionBefore = captureInteractionState(game);
      const rulesBefore = captureRuleState(game);
      const description = step(game);
      trace.push(description);
      rulesOracle.checkTransition(rulesBefore, game, { action: description });
      for (const key of causalInteractionCoverageKeys(interactionBefore, game, description.split(":")[0])) {
        causalCoverage.set(key, (causalCoverage.get(key) || 0) + 1);
      }
    }
    assertInvariants(game);
  } catch (error) {
    console.error(JSON.stringify({
      seed,
      gameSeed,
      gameIndex,
      decks: decks.map((deck) => deck.id),
      trace,
      state: diagnosticGameState(game),
      error: error.stack
    }, null, 2));
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  const covered = [...semanticCoverage.entries()].sort((a, b) => b[1] - a[1]);
  const transitionCount = [...causalCoverage.keys()].filter((key) => key.startsWith("cause|")).length;
  const interactionCount = [...causalCoverage.keys()].filter((key) => key.startsWith("interaction|")).length;
  const ruleReport = rulesOracle.report();
  const ruleEvaluations = ruleReport.rules.reduce((sum, rule) => sum + rule.evaluations, 0);
  console.log(`Fuzzed ${games} games across ${allDecks.length} decks (seed ${seed}); semantically checked ${covered.length} card/effect paths across ${covered.reduce((sum, [, count]) => sum + count, 0)} choices; evaluated ${ruleReport.rules.length} Core Rules checks ${ruleEvaluations} times; observed ${transitionCount} action-to-state transitions in ${interactionCount} active-effect contexts.`);
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
  rulesOracle.checkState(game);
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

function diagnosticGameState(game) {
  const card = (value) => value ? { id: value.instanceId, name: value.name, status: value.status } : null;
  return {
    phase: game.phase,
    currentPlayerId: game.currentPlayerId,
    pendingChoice: game.pendingChoice ? {
      id: game.pendingChoice.id,
      effect: game.pendingChoice.effect,
      playerId: game.pendingChoice.playerId,
      card: card(game.pendingChoice.card)
    } : null,
    pendingPayment: game.pendingPayment ? {
      source: game.pendingPayment.source,
      playerId: game.pendingPayment.playerId,
      card: card(game.pendingPayment.card)
    } : null,
    actionChain: game.actionChain ? {
      phase: game.actionChain.phase,
      priorityPlayerId: game.actionChain.priorityPlayerId,
      chain: game.actionChain.chain.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        status: item.status,
        playerId: item.playerId,
        card: card(item.card),
        sourceCard: card(item.sourceCard)
      }))
    } : null,
    showdown: game.showdown ? {
      battlefieldId: game.showdown.battlefieldId,
      priorityPlayerId: game.showdown.priorityPlayerId,
      chain: (game.showdown.chain || []).map((item) => ({ id: item.id, status: item.status, card: card(item.card) }))
    } : null,
    operations: (game.operations || []).map((operation) => ({ id: operation.id, kind: operation.kind, status: operation.status })),
    players: game.players.map((player) => ({
      id: player.id,
      hand: player.hand.map(card),
      base: player.base.map(card),
      trash: player.trash.map(card)
    })),
    battlefields: game.battlefields.map((field) => ({
      id: field.instanceId,
      name: field.name,
      units: field.units.map(card)
    }))
  };
}
