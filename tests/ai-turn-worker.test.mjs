import test from "node:test";
import assert from "node:assert/strict";

import { activeActorId } from "../src/ai/actions.mjs";
import { handleAiTurnWorkerRequest } from "../src/ai/turn-decision.mjs";
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

test("AI turn Worker performs policy enumeration and returns only the selected action", () => {
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const request = createAiTurnWorkerRequest({ requestId: "turn-1", game, actorId });

  assert.equal(request.game, game, "postMessage must perform the only main-to-Worker game clone");
  const response = handleAiTurnWorkerRequest(request, { random: () => 0 });

  assert.equal(response.type, AI_TURN_WORKER_MESSAGE_TYPES.result);
  assert.equal(response.requestId, "turn-1");
  assert.equal(response.ok, true);
  assert.equal(response.decision.kind, "policy");
  assert.equal(typeof response.decision.selected?.action?.kind, "string");
  assert.equal(Object.hasOwn(response.decision.selected, "features"), false);
  assert.equal(Object.hasOwn(response.decision, "legalActions"), false);
  assert.deepEqual(structuredClone(response), response);
});

test("AI turn Worker prepares the bounded neural encoding without cloning game states back", () => {
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const response = handleAiTurnWorkerRequest(createAiTurnWorkerRequest({
    requestId: 2,
    game,
    actorId,
    selectionMode: "neural"
  }));

  assert.equal(response.ok, true);
  assert.equal(response.decision.kind, "neural");
  assert.ok(response.decision.actions.length > 0);
  assert.ok(response.decision.actions.every((action) => typeof action.kind === "string"));
  assert.ok(response.decision.stateEncoding instanceof Float32Array);
  assert.ok(response.decision.actionEncoding instanceof Float32Array);
  assert.equal(response.decision.legalCount, response.decision.actions.length);
  assert.equal(Object.hasOwn(response.decision, "game"), false);
});

test("a neural session consumes the Worker's prepared encoding without re-enumerating the game", async () => {
  const {
    createNeuralModel,
    createNeuralSession,
    disposeNeuralModel
  } = await import("../src/ai/neural/model.mjs");
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const prepared = handleAiTurnWorkerRequest(createAiTurnWorkerRequest({
    requestId: 3,
    game,
    actorId,
    selectionMode: "neural"
  })).decision;
  const model = createNeuralModel();
  try {
    const selected = createNeuralSession(model).decideEncoded(actorId, prepared, {
      greedy: true,
      random: () => 0
    });
    assert.equal(typeof selected?.action?.kind, "string");
    assert.equal(selected.stateEncoding, prepared.stateEncoding);
    assert.equal(selected.actionEncoding, prepared.actionEncoding);
    assert.equal(selected.legalCount, prepared.legalCount);
  } finally {
    disposeNeuralModel(model);
  }
});

test("lean gameplay sessions preserve policy decisions and memory without auxiliary heads or history", async () => {
  const {
    createNeuralModel,
    createNeuralSession,
    disposeNeuralModel
  } = await import("../src/ai/neural/model.mjs");
  const { ACTION_DIM, MAX_ACTIONS, STATE_DIM } = await import("../src/ai/neural/encoding.mjs");
  const { tf } = await import("../src/ai/neural/tf-runtime.mjs");
  const model = createNeuralModel();
  const actionProjectionWidths = [];
  const originalActionProjectionApply = model.layers.actionProjection.apply;
  model.layers.actionProjection.apply = function measuredActionProjectionApply(...args) {
    actionProjectionWidths.push(args[0].shape[2]);
    return originalActionProjectionApply.apply(this, args);
  };
  const auxiliaryCalls = Object.fromEntries(
    ["teacherProposalValue", "value", "diagnostic", "belief"].map((name) => [name, 0])
  );
  const originalApply = new Map();
  for (const name of Object.keys(auxiliaryCalls)) {
    const layer = model.layers[name];
    originalApply.set(name, layer.apply);
    layer.apply = function countedAuxiliaryApply(...args) {
      auxiliaryCalls[name] += 1;
      return originalApply.get(name).apply(this, args);
    };
  }

  const stateEncoding = Float32Array.from(
    { length: STATE_DIM },
    (_, index) => ((index % 19) - 9) / 20
  );
  const actionEncoding = new Float32Array(MAX_ACTIONS * ACTION_DIM);
  for (let action = 0; action < 3; action += 1) {
    for (let feature = 0; feature < ACTION_DIM; feature += 1) {
      actionEncoding[action * ACTION_DIM + feature] = ((action + 1) * (feature % 7)) / 10;
    }
  }
  const prepared = {
    stateEncoding,
    actionEncoding,
    actions: [{ kind: "first" }, { kind: "second" }, { kind: "third" }],
    legalCount: 3
  };
  const full = createNeuralSession(model);
  const lean = createNeuralSession(model, { lean: true, maxHistory: 0 });
  const tensorsBefore = tf.memory().numTensors;

  try {
    for (let turn = 0; turn < 4; turn += 1) {
      const leanDecision = lean.decideEncoded("actor", prepared, { greedy: true });
      assert.deepEqual(auxiliaryCalls, {
        teacherProposalValue: turn,
        value: turn,
        diagnostic: turn,
        belief: turn
      });
      const fullDecision = full.decideEncoded("actor", prepared, { greedy: true });

      assert.equal(leanDecision.selectedIndex, fullDecision.selectedIndex);
      assert.deepEqual(leanDecision.action, fullDecision.action);
      assert.ok(Math.abs(leanDecision.probability - fullDecision.probability) < 1e-6);
      assert.deepEqual(leanDecision.nextMemory, fullDecision.nextMemory);
      assert.equal(Object.hasOwn(leanDecision, "teacherProposalValues"), false);
      assert.equal(Object.hasOwn(leanDecision, "value"), false);
      assert.equal(Object.hasOwn(leanDecision, "diagnostic"), false);
      assert.equal(Object.hasOwn(leanDecision, "belief"), false);
    }

    assert.equal(full.history("actor").length, 4);
    assert.deepEqual(lean.history("actor"), []);
    assert.deepEqual(actionProjectionWidths, [
      3, 3,
      3, 3,
      3, 3,
      3, 3
    ]);
    assert.equal(tf.memory().numTensors, tensorsBefore);
  } finally {
    model.layers.actionProjection.apply = originalActionProjectionApply;
    for (const [name, apply] of originalApply) model.layers[name].apply = apply;
    disposeNeuralModel(model);
  }
});

test("AI turn Worker owns neural inference and resets its bounded session", async () => {
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  let resets = 0;
  let neuralSessionOptions = null;
  let decodedCheckpoint = null;
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
  const neural = {
    deserializeNeuralModel(checkpoint) {
      decodedCheckpoint = checkpoint;
      return { checkpoint };
    },
    createNeuralSession(_model, options) {
      neuralSessionOptions = options;
      return {
        reset() { resets += 1; },
        decideEncoded(_actorId, prepared) {
          return { action: prepared.actions[0], probability: 0.75, value: 0.1 };
        }
      };
    },
    disposeNeuralModel() {}
  };
  assert.equal(registerAiTurnWorker(scope, { neural }), true);

  const checkpointBuffer = new TextEncoder().encode(JSON.stringify({
    version: 5,
    generation: 1,
    gamesTrained: 27,
    metadata: { stage: "test" },
    knowledge: { cardPoolId: "origins-era" }
  })).buffer;
  const configureRequest = createAiTurnNeuralConfigureRequest({
    requestId: "configure-1",
    descriptorKey: "generation-1",
    checkpointBuffer,
    expectedGeneration: 1
  });
  const transferredRequest = structuredClone(configureRequest, { transfer: [checkpointBuffer] });
  assert.equal(checkpointBuffer.byteLength, 0, "the UI relinquishes ownership instead of cloning checkpoint bytes");
  listener({ data: transferredRequest });
  await flushWorkerQueue();
  assert.equal(decodedCheckpoint.generation, 1);
  assert.equal(decodedCheckpoint.gamesTrained, 27);
  assert.deepEqual(neuralSessionOptions, { lean: true, maxHistory: 0 });
  assert.deepEqual(posted.shift(), {
    type: AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured,
    requestId: "configure-1",
    descriptorKey: "generation-1",
    checkpointMetadata: {
      generation: 1,
      gamesTrained: 27,
      metadata: { stage: "test" },
      knowledge: { cardPoolId: "origins-era" }
    },
    ok: true
  });

  listener({ data: createAiTurnWorkerRequest({
    requestId: "neural-turn-1",
    game,
    actorId,
    selectionMode: "neural"
  }) });
  await flushWorkerQueue();
  const decision = posted.shift();
  assert.equal(decision.ok, true);
  assert.equal(decision.decision.kind, "neural");
  assert.equal(typeof decision.decision.selected.action.kind, "string");
  assert.equal(Object.hasOwn(decision.decision, "stateEncoding"), false);
  assert.equal(Object.hasOwn(decision.decision, "actionEncoding"), false);

  listener({ data: createAiTurnNeuralResetRequest() });
  await flushWorkerQueue();
  assert.equal(resets, 1);
  assert.equal(posted.length, 0);
});

test("AI turn Worker rejects a raw checkpoint whose generation does not match", async () => {
  let listener = null;
  let deserializeCalls = 0;
  const posted = [];
  const scope = {
    addEventListener(_type, callback) { listener = callback; },
    postMessage(message) { posted.push(message); }
  };
  const neural = {
    deserializeNeuralModel() {
      deserializeCalls += 1;
      return {};
    }
  };
  registerAiTurnWorker(scope, { neural });
  const checkpointBuffer = new TextEncoder().encode(JSON.stringify({ generation: 2 })).buffer;
  listener({ data: createAiTurnNeuralConfigureRequest({
    requestId: "wrong-generation",
    descriptorKey: "generation-1",
    checkpointBuffer,
    expectedGeneration: 1
  }) });
  await flushWorkerQueue();

  assert.equal(deserializeCalls, 0);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured);
  assert.equal(posted[0].ok, false);
  assert.match(posted[0].error, /Expected neural generation 1, received 2/);
});

test("AI turn Worker reports invalid requests and registers one message listener", async () => {
  const invalid = handleAiTurnWorkerRequest({ type: "unknown", requestId: "bad" });
  assert.equal(invalid.type, AI_TURN_WORKER_MESSAGE_TYPES.result);
  assert.equal(invalid.requestId, "bad");
  assert.equal(invalid.ok, false);

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
  assert.equal(registerAiTurnWorker(scope), true);
  listener({ data: null });
  await flushWorkerQueue();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].ok, false);
  assert.equal(registerAiTurnWorker({}), false);
});

function flushWorkerQueue() {
  return new Promise((resolve) => setImmediate(resolve));
}
