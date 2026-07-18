import {
  activateCard,
  beginPlayCard,
  beginPlayChampion,
  cancelPayment,
  chooseFirstPlayer,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmMulligan,
  confirmPayment,
  declineEffectChoice,
  endTurn,
  firstPlayerDecisionActorId,
  hideCard,
  moveUnit,
  moveUnits,
  passShowdown,
  rollFirstPlayer,
  selectBattlefield,
  selectChampion,
  surrender,
  skipMulligan,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentPoolPower,
  togglePaymentRune
} from "../src/engine.mjs";
import { resolveLegalAction } from "../src/ai/actions.mjs";

export function applyGameCommand(room, playerId, command) {
  if (!room?.game) return reject("Game has not started.");
  if (!playerId) return reject("Unknown player.");
  if (!command || typeof command.kind !== "string") return reject("Invalid command.");

  const authorization = authorizeCommand(room, room.game, playerId, command);
  if (!authorization.ok) return authorization;

  const game = room.game;
  const resolvedCommand = authorization.command || command;
  switch (resolvedCommand.kind) {
    case "rollFirstPlayer":
      return rollFirstPlayer(game, playerId);
    case "chooseFirstPlayer":
      return chooseFirstPlayer(game, playerId, resolvedCommand.playerId);
    case "confirmFirstPlayer":
      return confirmFirstPlayer(game);
    case "selectChampion":
      return selectChampion(game, playerId, resolvedCommand.cardId);
    case "selectBattlefield":
      return selectBattlefield(game, playerId, resolvedCommand.battlefieldId);
    case "toggleMulliganCard":
      return toggleMulliganCard(game, resolvedCommand.cardId);
    case "confirmMulligan":
      return confirmMulligan(game);
    case "skipMulligan":
      return skipMulligan(game);
    case "beginPlayCard":
      return beginPlayCard(game, resolvedCommand.cardId, resolvedCommand.destination);
    case "beginPlayChampion":
      return beginPlayChampion(game, resolvedCommand.destination);
    case "hideCard":
      return hideCard(game, resolvedCommand.cardId, resolvedCommand.destination);
    case "moveUnit":
      return moveUnit(game, resolvedCommand.unitId, resolvedCommand.destinationId);
    case "moveUnits":
      return moveUnits(game, resolvedCommand.unitIds, resolvedCommand.destinationId);
    case "activateCard":
      return activateCard(game, resolvedCommand.cardId, resolvedCommand.abilityId);
    case "togglePaymentRune":
      return togglePaymentRune(game, resolvedCommand.runeId, resolvedCommand.mode);
    case "togglePaymentPoolEnergy":
      return togglePaymentPoolEnergy(game, resolvedCommand.energyId);
    case "togglePaymentPoolPower":
      return togglePaymentPoolPower(game, resolvedCommand.powerId);
    case "toggleOptionalPaymentEffect":
      return toggleOptionalPaymentEffect(game, resolvedCommand.effectId);
    case "confirmPayment":
      return confirmPayment(game);
    case "cancelPayment":
      return cancelPayment(game);
    case "chooseEffectOption":
      return chooseEffectOption(game, resolvedCommand.optionId);
    case "declineEffectChoice":
      return declineEffectChoice(game);
    case "passShowdown":
      return passShowdown(game, playerId);
    case "endTurn":
      return endTurn(game);
    case "surrender":
      return surrender(game, playerId);
    default:
      return reject(`Unsupported command: ${resolvedCommand.kind}`);
  }
}

function authorizeCommand(room, game, playerId, command) {
  if (!game.players.some((player) => player.id === playerId)) return reject("You are not seated in this game.");

  if (command.kind === "surrender") return game.phase !== "complete" ? ok() : reject("The game is already complete.");

  const expected = expectedActorId(game, command);
  if (!expected) return reject("No player can act right now.");
  if (expected !== playerId) return reject("It is not your turn or focus.");
  const resolvedCommand = resolveLegalAction(game, command, playerId);
  if (!resolvedCommand) return reject("That action is not legal or is ambiguous in the current game state.");
  return { ...ok(), command: resolvedCommand };
}

function expectedActorId(game, command) {
  if (game.phase === "first-player") return firstPlayerDecisionActorId(game);
  if (game.pendingChoice) return game.pendingChoice.playerId;
  if (game.pendingPayment) return game.pendingPayment.playerId;
  if (game.phase === "champion-select") return game.championSelectPlayerId;
  if (game.phase === "battlefield-select") return game.setupPlayerId;
  if (game.phase === "mulligan") return game.mulligan?.playerId || null;
  if (game.phase === "showdown") return game.showdown?.priorityPlayerId || null;
  if (game.actionChain) return game.actionChain.priorityPlayerId;
  if (game.phase === "action") return game.currentPlayerId;
  if (command.kind === "selectChampion") return game.championSelectPlayerId;
  if (command.kind === "selectBattlefield") return game.setupPlayerId;
  return null;
}

function ok() {
  return { ok: true };
}

function reject(message) {
  return { ok: false, message };
}
