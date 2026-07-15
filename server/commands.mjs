import {
  activateCard,
  beginPlayCard,
  beginPlayChampion,
  cancelPayment,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmMulligan,
  confirmPayment,
  declineEffectChoice,
  endTurn,
  hideCard,
  moveUnit,
  moveUnits,
  passShowdown,
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

export function applyGameCommand(room, playerId, command) {
  if (!room?.game) return reject("Game has not started.");
  if (!playerId) return reject("Unknown player.");
  if (!command || typeof command.kind !== "string") return reject("Invalid command.");

  const authorization = authorizeCommand(room, room.game, playerId, command);
  if (!authorization.ok) return authorization;

  const game = room.game;
  switch (command.kind) {
    case "confirmFirstPlayer":
      return confirmFirstPlayer(game);
    case "selectChampion":
      return selectChampion(game, playerId, command.cardId);
    case "selectBattlefield":
      return selectBattlefield(game, playerId, command.battlefieldId);
    case "toggleMulliganCard":
      return toggleMulliganCard(game, command.cardId);
    case "confirmMulligan":
      return confirmMulligan(game);
    case "skipMulligan":
      return skipMulligan(game);
    case "beginPlayCard":
      return beginPlayCard(game, command.cardId, command.destination);
    case "beginPlayChampion":
      return beginPlayChampion(game, command.destination);
    case "hideCard":
      return hideCard(game, command.cardId, command.destination);
    case "moveUnit":
      return moveUnit(game, command.unitId, command.destinationId);
    case "moveUnits":
      return moveUnits(game, command.unitIds, command.destinationId);
    case "activateCard":
      return activateCard(game, command.cardId);
    case "togglePaymentRune":
      return togglePaymentRune(game, command.runeId, command.mode);
    case "togglePaymentPoolEnergy":
      return togglePaymentPoolEnergy(game, command.energyId);
    case "togglePaymentPoolPower":
      return togglePaymentPoolPower(game, command.powerId);
    case "toggleOptionalPaymentEffect":
      return toggleOptionalPaymentEffect(game, command.effectId);
    case "confirmPayment":
      return confirmPayment(game);
    case "cancelPayment":
      return cancelPayment(game);
    case "chooseEffectOption":
      return chooseEffectOption(game, command.optionId);
    case "declineEffectChoice":
      return declineEffectChoice(game);
    case "passShowdown":
      return passShowdown(game, playerId);
    case "endTurn":
      return endTurn(game);
    case "surrender":
      return surrender(game, playerId);
    default:
      return reject(`Unsupported command: ${command.kind}`);
  }
}

function authorizeCommand(room, game, playerId, command) {
  if (!game.players.some((player) => player.id === playerId)) return reject("You are not seated in this game.");

  if (command.kind === "confirmFirstPlayer") {
    if (playerId !== (room.hostPlayerId || "p1")) return reject("Only the room host can confirm the first player.");
    return game.phase === "first-player" ? ok() : reject("First player is already confirmed.");
  }

  if (command.kind === "surrender") return game.phase !== "complete" ? ok() : reject("The game is already complete.");

  const expected = expectedActorId(game, command);
  if (!expected) return reject("No player can act right now.");
  if (expected !== playerId) return reject("It is not your turn or focus.");
  return ok();
}

function expectedActorId(game, command) {
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
