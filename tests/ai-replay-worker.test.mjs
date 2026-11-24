import test from "node:test";
import assert from "node:assert/strict";
import { decklists } from "../src/cards.mjs";
import { activeActorId, applyAiAction } from "../src/ai/actions.mjs";
import {
  REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES,
  appendAnalyzedReplayDecision,
  createAiReplay,
  createReplayAnalysisWorkerRequest,
  handleReplayAnalysisWorkerRequest
} from "../src/ai/replay.mjs";
import { registerReplayAnalysisWorker } from "../src/ai/replay-worker.mjs";
import { createGame } from "../src/engine.mjs";

const decks = Object.values(decklists).slice(0, 2);

test("replay analysis Worker returns a lean decision and lets the main thread retain its state snapshot", () => {
  const gameBefore = createGame({ decks, interactive: true, manualActionChainPriority: true });
  advanceToMulligan(gameBefore);
  const actorId = activeActorId(gameBefore);
  const command = { kind: "skipMulligan" };
  const request = createReplayAnalysisWorkerRequest({
    requestId: "decision-1",
    gameBefore,
    actorId,
    command
  });

  // The helper must not eagerly clone the large game. postMessage performs the
  // only main-to-Worker structured clone.
  assert.equal(request.gameBefore, gameBefore);
  const response = handleReplayAnalysisWorkerRequest(request);
  assert.equal(response.type, REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.result);
  assert.equal(response.requestId, "decision-1");
  assert.equal(response.ok, true);
  assert.equal(response.decision.actorId, actorId);
  assert.equal(response.decision.command, command);
  assert.equal(response.decision.analysis.category, "mulligan");
  assert.ok(response.decision.trainingSample.legalCount > 0);
  assert.equal(Object.hasOwn(response.decision, "gameState"), false);
  assert.equal(Object.hasOwn(response.decision, "sequence"), false);
  assert.deepEqual(structuredClone(response), response);

  const replay = createAiReplay(gameBefore, { humanPlayerId: actorId });
  const appended = appendAnalyzedReplayDecision(replay, response.decision, gameBefore, {
    stateAlreadyCloned: true
  });
  assert.equal(appended.sequence, 1);
  assert.equal(appended.gameState, gameBefore);
  assert.equal(replay.decisions[0], appended);

  const clonedStateReplay = createAiReplay(gameBefore, { humanPlayerId: actorId });
  const clonedStateDecision = appendAnalyzedReplayDecision(clonedStateReplay, response.decision, gameBefore);
  assert.notEqual(clonedStateDecision.gameState, gameBefore);
  assert.deepEqual(clonedStateDecision.gameState, gameBefore);
});

test("replay analysis Worker reports validation and analysis failures as structured messages", () => {
  const invalid = handleReplayAnalysisWorkerRequest({
    type: "unknown",
    requestId: "bad-request"
  });
  assert.deepEqual(invalid, {
    type: REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.error,
    requestId: "bad-request",
    ok: false,
    error: {
      code: "UNSUPPORTED_MESSAGE",
      name: "TypeError",
      message: "Unsupported replay analysis message type: unknown."
    }
  });

  const failed = handleReplayAnalysisWorkerRequest(createReplayAnalysisWorkerRequest({
    requestId: 2,
    gameBefore: { phase: "action" },
    actorId: "p1",
    command: { kind: "endTurn" }
  }));
  assert.equal(failed.type, REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.error);
  assert.equal(failed.requestId, 2);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "REPLAY_ANALYSIS_FAILED");
  assert.equal(typeof failed.error.name, "string");
  assert.equal(typeof failed.error.message, "string");
  assert.equal(Object.hasOwn(failed.error, "stack"), false);
});

test("replay retains full state only for a bounded set of highest-regret decisions", () => {
  const replay = { decisions: [] };
  const states = Array.from({ length: 12 }, (_, index) => ({ marker: index }));

  for (let index = 0; index < states.length; index += 1) {
    appendAnalyzedReplayDecision(replay, {
      actorId: "p1",
      command: { kind: "endTurn", marker: index },
      turnNumber: index + 1,
      phase: "action",
      analysis: { regret: index },
      trainingSample: null
    }, states[index], { stateAlreadyCloned: true });
  }

  assert.equal(replay.decisions.length, 12);
  assert.equal(replay.decisions.filter((decision) => decision.gameState).length, 10);
  assert.deepEqual(replay.decisions
    .filter((decision) => decision.gameState)
    .map((decision) => decision.gameState.marker), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("replay Worker registration posts one response per incoming message", () => {
  let listener = null;
  const posted = [];
  const scope = {
    addEventListener(type, callback) {
      assert.equal(type, "message");
      listener = callback;
    },
    postMessage(message) {
      posted.push(message);
    }
  };

  assert.equal(registerReplayAnalysisWorker(scope), true);
  listener({ data: null });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.error);
  assert.equal(posted[0].error.code, "INVALID_REQUEST");
  assert.equal(registerReplayAnalysisWorker({}), false);
});

function advanceToMulligan(game) {
  assert.equal(applyAiAction(game, { kind: "confirmFirstPlayer" }, activeActorId(game)).ok, true);
  while (game.phase === "champion-select") {
    const actorId = activeActorId(game);
    const player = game.players.find((candidate) => candidate.id === actorId);
    assert.equal(applyAiAction(game, {
      kind: "selectChampion",
      cardId: player.availableChampions[0].instanceId
    }, actorId).ok, true);
  }
  while (game.phase === "battlefield-select") {
    const actorId = activeActorId(game);
    const player = game.players.find((candidate) => candidate.id === actorId);
    assert.equal(applyAiAction(game, {
      kind: "selectBattlefield",
      battlefieldId: player.availableBattlefields[0].instanceId
    }, actorId).ok, true);
  }
  assert.equal(game.phase, "mulligan");
}
