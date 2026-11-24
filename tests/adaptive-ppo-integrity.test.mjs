import test from "node:test";
import assert from "node:assert/strict";
import { decklists } from "../src/cards.mjs";
import { createGame } from "../src/engine.mjs";
import { resolveTrainingDecks } from "../src/ai/training-decks.mjs";
import { activeActorId, enumerateLegalActions } from "../src/ai/actions.mjs";
import { createNeuralModel, createNeuralSession, serializeNeuralModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import { trainRecurrentPpo } from "../src/ai/neural/trainer.mjs";
import { adaptiveFiniteEpochGuard } from "../scripts/adaptive-policy-q-evidence.mjs";

test("the real PPO trainer rolls back a bad batch even when its epoch average is finite", async () => {
  const decks = resolveTrainingDecks(decklists, "origins-era", ["origins-sett", "origins-kaisa"]);
  const game = createGame({ decks, interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game), model = createNeuralModel();
  let trained;
  try {
    const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
    const trajectory = { gameId: "finite-batch-rollback", playerId: actorId, completed: true, deckId: decks[0].id,
      steps: [{ state: decision.stateEncoding, actions: decision.actionEncoding, selectedIndex: decision.selectedIndex,
        legalCount: decision.legalCount, oldLogProbability: decision.logProbability, value: decision.value,
        beliefTarget: new Float32Array(decision.belief.length), initialMemory: decision.initialMemory, advantage: 1, return: 1 }] };
    const before = serializeNeuralModel(model).weights, guard = adaptiveFiniteEpochGuard();
    let checked = false;
    trained = await trainRecurrentPpo(model, [trajectory], { epochs: 2, batchSize: 1, learningRate: 0.01,
      ...guard, onBatch(item) {
        // The trainer's mean omits NaN; mutate its reported raw metric to
        // exercise that real aggregation path while weights remain finite.
        item.metrics.loss = NaN;
        guard.onBatch(item);
      }, epochGuard(item) {
        assert.equal(Number.isFinite(item.metrics.meanLoss), true);
        checked = true;
        return guard.epochGuard(item);
      } });
    assert.equal(checked, true);
    assert.equal(trained.epochGuards[0].passed, false);
    assert.equal(model.metadata.epochs, 0);
    assert.deepEqual(serializeNeuralModel(model).weights, before);
  } finally { trained?.optimizer.dispose(); disposeNeuralModel(model); }
});
