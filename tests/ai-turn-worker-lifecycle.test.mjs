import test from "node:test";
import assert from "node:assert/strict";

import { activeActorId } from "../src/ai/actions.mjs";
import {
  AI_TURN_WORKER_MESSAGE_TYPES,
  createAiTurnNeuralConfigureRequest,
  createAiTurnNeuralResetRequest,
  createAiTurnWorkerRequest
} from "../src/ai/turn-protocol.mjs";
import { registerAiTurnWorker } from "../src/ai/turn-worker.mjs";
import { decklists } from "../src/cards.mjs";
import { createGame } from "../src/engine.mjs";

const decks = Object.values(decklists).slice(0, 2);

test("AI turn Worker serializes configure, decide, reset, and decide messages", async () => {
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const events = [];
  let resets = 0;
  let decisionsSinceReset = 0;
  const { scope, dispatch } = fakeWorkerScope(events);
  const neural = {
    deserializeNeuralModel(checkpoint) {
      events.push({ kind: "deserialize", checkpoint: checkpoint.id });
      return { id: checkpoint.id };
    },
    createNeuralSession(model) {
      return {
        reset() {
          resets += 1;
          decisionsSinceReset = 0;
          events.push({ kind: "reset", model: model.id });
        },
        decideEncoded(_actorId, prepared) {
          decisionsSinceReset += 1;
          events.push({ kind: "decide", model: model.id, decisionsSinceReset });
          return { action: prepared.actions[0], probability: 1, value: 0 };
        }
      };
    },
    disposeNeuralModel() {}
  };
  registerAiTurnWorker(scope, { neural });

  dispatch(createAiTurnNeuralConfigureRequest({
    requestId: "config",
    descriptorKey: "generation-1",
    checkpointBuffer: encodedCheckpoint("model-1", 1),
    expectedGeneration: 1
  }));
  dispatch(createAiTurnWorkerRequest({
    requestId: "before-reset",
    game,
    actorId,
    selectionMode: "neural"
  }));
  dispatch(createAiTurnNeuralResetRequest());
  dispatch(createAiTurnWorkerRequest({
    requestId: "after-reset",
    game,
    actorId,
    selectionMode: "neural"
  }));
  await flushWorkerQueue();

  assert.equal(resets, 1);
  assert.deepEqual(
    events.filter((entry) => entry.kind !== "post").map((entry) => entry.kind),
    ["deserialize", "decide", "reset", "decide"]
  );
  assert.deepEqual(
    events.filter((entry) => entry.kind === "decide").map((entry) => entry.decisionsSinceReset),
    [1, 1]
  );
  assert.deepEqual(
    events.filter((entry) => entry.kind === "post").map((entry) => [entry.message.type, entry.message.requestId]),
    [
      [AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured, "config"],
      [AI_TURN_WORKER_MESSAGE_TYPES.result, "before-reset"],
      [AI_TURN_WORKER_MESSAGE_TYPES.result, "after-reset"]
    ]
  );
});

test("AI turn Worker disposes only the superseded neural model", async () => {
  const disposed = [];
  let deserializeCount = 0;
  const posted = [];
  const { scope, dispatch } = fakeWorkerScope(posted, { rawPosts: true });
  const neural = {
    deserializeNeuralModel(checkpoint) {
      deserializeCount += 1;
      return { id: checkpoint.id };
    },
    createNeuralSession() {
      return { reset() {}, decideEncoded() { return null; } };
    },
    disposeNeuralModel(model) {
      disposed.push(model.id);
    }
  };
  registerAiTurnWorker(scope, { neural });

  dispatch(createAiTurnNeuralConfigureRequest({
    requestId: "first",
    descriptorKey: "same",
    checkpointBuffer: encodedCheckpoint("model-1", 1),
    expectedGeneration: 1
  }));
  dispatch(createAiTurnNeuralConfigureRequest({
    requestId: "same-key",
    descriptorKey: "same",
    checkpointBuffer: encodedCheckpoint("must-not-load", 1),
    expectedGeneration: 1
  }));
  dispatch(createAiTurnNeuralConfigureRequest({
    requestId: "replacement",
    descriptorKey: "next",
    checkpointBuffer: encodedCheckpoint("model-2", 2),
    expectedGeneration: 2
  }));
  await flushWorkerQueue();

  assert.equal(deserializeCount, 2);
  assert.deepEqual(disposed, ["model-1"]);
  assert.deepEqual(posted.map((message) => message.requestId), ["first", "same-key", "replacement"]);
  assert.ok(posted.every((message) => message.ok));
});

test("AI turn Worker recovers its FIFO after a neural inference failure", async () => {
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const posted = [];
  const { scope, dispatch } = fakeWorkerScope(posted, { rawPosts: true });
  const neural = {
    deserializeNeuralModel() { return {}; },
    createNeuralSession() {
      return {
        reset() {},
        decideEncoded() { throw new Error("synthetic inference failure"); }
      };
    },
    disposeNeuralModel() {}
  };
  registerAiTurnWorker(scope, { neural });

  dispatch(createAiTurnNeuralConfigureRequest({
    requestId: "config",
    descriptorKey: "generation-1",
    checkpointBuffer: encodedCheckpoint("model-1", 1),
    expectedGeneration: 1
  }));
  dispatch(createAiTurnWorkerRequest({
    requestId: "neural-failure",
    game,
    actorId,
    selectionMode: "neural"
  }));
  dispatch(createAiTurnWorkerRequest({
    requestId: "policy-after-failure",
    game,
    actorId,
    selectionMode: "policy"
  }));
  await flushWorkerQueue();

  const failed = posted.find((message) => message.requestId === "neural-failure");
  const recovered = posted.find((message) => message.requestId === "policy-after-failure");
  assert.equal(failed?.ok, false);
  assert.match(failed?.error || "", /synthetic inference failure/);
  assert.equal(recovered?.ok, true);
  assert.equal(typeof recovered?.decision?.selected?.action?.kind, "string");
});

function fakeWorkerScope(output, { rawPosts = false } = {}) {
  let listener = null;
  return {
    scope: {
      addEventListener(type, callback) {
        assert.equal(type, "message");
        listener = callback;
      },
      postMessage(message) {
        if (rawPosts) output.push(message);
        else output.push({ kind: "post", message });
      }
    },
    dispatch(message) {
      assert.ok(listener, "the Worker message listener must be registered first");
      listener({ data: message });
    }
  };
}

async function flushWorkerQueue() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function encodedCheckpoint(id, generation) {
  return new TextEncoder().encode(JSON.stringify({ id, generation })).buffer;
}
