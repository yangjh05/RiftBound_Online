import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { createGame } from "../src/engine.mjs";
import { activeActorId, applyAiAction } from "../src/ai/actions.mjs";
import {
  appendSpectatorReplayFrame,
  createSpectatorReplay,
  finalizeSpectatorReplay
} from "../src/ai/spectator-replay.mjs";
import {
  AI_SPECTATOR_REPLAY_TOO_LARGE,
  assertAiSpectatorReplaySize,
  isAiSpectatorReplayTooLargeError,
  listAiSpectatorReplays,
  readAiSpectatorReplay,
  storeAiSpectatorReplay
} from "../server/ai-data.mjs";

test("oversized optional spectator replays have a dedicated non-storage error", () => {
  let error = null;
  try {
    assertAiSpectatorReplaySize("12345", 4);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.equal(error.code, AI_SPECTATOR_REPLAY_TOO_LARGE);
  assert.equal(error.actualBytes, 5);
  assert.equal(error.maximumBytes, 4);
  assert.equal(error.measurement, "source");
  assert.equal(isAiSpectatorReplayTooLargeError(error), true);
  assert.equal(
    isAiSpectatorReplayTooLargeError(new Error("disk full")),
    false
  );
});

test("AI spectator replays preserve selectable metadata and board frames", async () => {
  const decks = Object.values(decklists).slice(0, 2);
  const game = createGame({ decks, firstPlayerId: "p1", interactive: true, manualActionChainPriority: true });
  const replay = createSpectatorReplay(game, {
    id: "selfplay-test",
    generation: 7,
    models: [{ playerId: "p1", generation: 7 }, { playerId: "p2", generation: 5 }],
    decks: decks.map((deck, index) => ({ playerId: `p${index + 1}`, id: deck.id, name: deck.playerName }))
  });
  const actorId = activeActorId(game);
  const action = { kind: "confirmFirstPlayer" };
  assert.equal(applyAiAction(game, action, actorId).ok, true);
  appendSpectatorReplayFrame(replay, game, actorId, action);
  game.phase = "complete";
  game.winnerId = "p1";
  game.players[0].score = 8;
  finalizeSpectatorReplay(replay, game);

  assert.equal(replay.frames.length, 3);
  assert.equal(replay.frames[0].game.players[0].mainDeck[0].effects, undefined);
  assert.equal(replay.frames[1].action.kind, "confirmFirstPlayer");
  assert.deepEqual(replay.scores, [8, 0]);

  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-spectator-replay-"));
  try {
    await storeAiSpectatorReplay(replay, directory);
    const listed = await listAiSpectatorReplays({ root: directory });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].generation, 7);
    assert.deepEqual(listed[0].decks.map((deck) => deck.id), decks.map((deck) => deck.id));
    assert.deepEqual(listed[0].scores, [8, 0]);
    const loaded = await readAiSpectatorReplay("selfplay-test", { root: directory });
    assert.equal(loaded.frames[1].action.kind, "confirmFirstPlayer");
    assert.equal(loaded.winnerId, "p1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
