import assert from "node:assert/strict";
import test from "node:test";

import { rawDecklists } from "../src/cards.mjs";
import {
  createRoom,
  diagnosticLogForSeat,
  getRoom,
  joinRoom,
  runCommand,
  setReady,
  submitDeck
} from "../server/rooms.mjs";

test("authoritative game diagnostics are available only to a valid room seat", () => {
  const created = createRoom();
  const joined = joinRoom(created.room.roomId);
  assert.equal(joined.ok, true);
  assert.equal(submitDeck(created.room.roomId, created.playerToken, rawDecklists.provingGroundsAnnie).ok, true);
  assert.equal(submitDeck(created.room.roomId, joined.playerToken, rawDecklists.provingGroundsMasterYi).ok, true);
  assert.equal(setReady(created.room.roomId, created.playerToken, true).ok, true);
  assert.equal(setReady(created.room.roomId, joined.playerToken, true).ok, true);

  assert.equal(diagnosticLogForSeat(created.room.roomId, "invalid-seat-token"), null);
  assert.equal(diagnosticLogForSeat("NO-SUCH-ROOM", created.playerToken), null);
  assert.equal(diagnosticLogForSeat(created.room.roomId, created.playerToken, 999), null);

  assert.equal(runCommand(created.room.roomId, created.playerToken, { kind: "rollFirstPlayer" }).ok, true);
  const hostDiagnostic = diagnosticLogForSeat(created.room.roomId, created.playerToken, 1);
  const guestDiagnostic = diagnosticLogForSeat(created.room.roomId, joined.playerToken, 1);

  assert.equal(hostDiagnostic.roomId, created.room.roomId);
  assert.equal(hostDiagnostic.gameNumber, 1);
  assert.match(hostDiagnostic.diagnosticGameId, new RegExp(`^${created.room.roomId}:\\d+$`, "u"));
  assert.equal(hostDiagnostic.playerId, "p1");
  assert.equal(guestDiagnostic.playerId, "p2");
  assert.equal(hostDiagnostic.log.metadata.mode, "online-authoritative");
  assert.equal(hostDiagnostic.log.metadata.roomId, created.room.roomId);
  assert.equal(hostDiagnostic.log.commands.at(-1).command.kind, "rollFirstPlayer");
  assert.equal(hostDiagnostic.log.commands.at(-1).status, "success");
  assert.deepEqual(hostDiagnostic.log, guestDiagnostic.log);

  const serialized = JSON.stringify({ hostDiagnostic, guestDiagnostic });
  assert.equal(serialized.includes(created.playerToken), false);
  assert.equal(serialized.includes(joined.playerToken), false);

  const missingSurrenderIdentity = runCommand(
    created.room.roomId,
    created.playerToken,
    { kind: "surrender" }
  );
  assert.equal(missingSurrenderIdentity.ok, false);
  assert.match(missingSurrenderIdentity.message, /valid current game identity/u);

  assert.equal(runCommand(created.room.roomId, created.playerToken, {
    kind: "surrender",
    expectedDiagnosticGameId: hostDiagnostic.diagnosticGameId,
    expectedGameNumber: hostDiagnostic.gameNumber
  }).ok, true);
  const completedDiagnosticId = diagnosticLogForSeat(
    created.room.roomId,
    created.playerToken,
    1
  ).diagnosticGameId;
  assert.equal(runCommand(created.room.roomId, created.playerToken, {
    kind: "restartGame",
    expectedDiagnosticGameId: completedDiagnosticId,
    expectedGameNumber: hostDiagnostic.gameNumber
  }).ok, true);
  const restartedDiagnostic = diagnosticLogForSeat(created.room.roomId, created.playerToken, 1);
  assert.notEqual(restartedDiagnostic.diagnosticGameId, completedDiagnosticId);
  assert.equal(restartedDiagnostic.gameNumber, hostDiagnostic.gameNumber);
  assert.equal(restartedDiagnostic.log.metadata.diagnosticGameId, restartedDiagnostic.diagnosticGameId);
  assert.equal(
    diagnosticLogForSeat(
      created.room.roomId,
      created.playerToken,
      1,
      completedDiagnosticId
    ).diagnosticGameId,
    completedDiagnosticId,
    "an explicit unique id must still retrieve the older game"
  );

  const restartedRoom = getRoom(created.room.roomId);
  const restartedState = {
    commandSeq: restartedRoom.commandSeq,
    diagnosticGameId: restartedRoom.diagnosticGameId,
    gameNumber: restartedRoom.match.gameNumber,
    phase: restartedRoom.game.phase,
    winnerId: restartedRoom.game.winnerId,
    surrenderedPlayerId: restartedRoom.game.surrenderedPlayerId
  };
  const delayedOldSurrender = runCommand(created.room.roomId, created.playerToken, {
    kind: "surrender",
    expectedDiagnosticGameId: completedDiagnosticId,
    expectedGameNumber: hostDiagnostic.gameNumber
  });
  assert.equal(delayedOldSurrender.ok, false);
  assert.match(delayedOldSurrender.message, /different game/u);
  assert.deepEqual({
    commandSeq: restartedRoom.commandSeq,
    diagnosticGameId: restartedRoom.diagnosticGameId,
    gameNumber: restartedRoom.match.gameNumber,
    phase: restartedRoom.game.phase,
    winnerId: restartedRoom.game.winnerId,
    surrenderedPlayerId: restartedRoom.game.surrenderedPlayerId
  }, restartedState, "a delayed surrender for the old diagnostic game must not mutate the restarted game");
  assert.equal(restartedRoom.status, "playing");

  const partialIdentity = runCommand(created.room.roomId, created.playerToken, {
    kind: "unsupported",
    expectedDiagnosticGameId: restartedDiagnostic.diagnosticGameId
  });
  assert.equal(partialIdentity.ok, false);
  assert.match(partialIdentity.message, /valid current game identity/u);
  const wrongGameNumber = runCommand(created.room.roomId, created.playerToken, {
    kind: "unsupported",
    expectedDiagnosticGameId: restartedDiagnostic.diagnosticGameId,
    expectedGameNumber: restartedDiagnostic.gameNumber + 1
  });
  assert.equal(wrongGameNumber.ok, false);
  assert.match(wrongGameNumber.message, /different game/u);
  assert.equal(
    diagnosticLogForSeat(created.room.roomId, created.playerToken, 1).log.commands.length,
    0,
    "identity-precondition failures must happen before diagnostic command recording"
  );

  for (let index = 0; index < 12; index += 1) {
    assert.equal(runCommand(created.room.roomId, created.playerToken, {
      kind: "unsupported",
      padding: "x".repeat(100_000)
    }).ok, false);
  }
  const bounded = diagnosticLogForSeat(created.room.roomId, created.playerToken, 1);
  assert.equal(bounded.log.commands.length, 12);
  assert.equal(bounded.log.commands[0].command.kind, "unsupported");
  assert.equal(Buffer.byteLength(JSON.stringify(bounded)) < 4 * 1024 * 1024, true);
});
