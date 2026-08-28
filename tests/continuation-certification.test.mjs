import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_DIM,
  MAX_ACTIONS,
  STATE_DIM
} from "../src/ai/neural/encoding.mjs";
import { createNeuralModel } from "../src/ai/neural/model.mjs";
import { tf } from "../src/ai/neural/tf-runtime.mjs";
import {
  createContinuationDiversityCertificates,
  createContinuationStrengthCertificate,
  createFixedContinuationBehaviorProbe,
  selectCertifiedIndependentContinuationPool,
  validFixedContinuationBehaviorProbe
} from "../src/ai/neural/continuation-certification.mjs";

function decisivePolicy(sign) {
  const model = createNeuralModel();
  const stateWeights = model.layers.stateProjection.getWeights();
  const stateKernel = tf.zerosLike(stateWeights[0]);
  const stateBiasValues = new Float32Array(stateWeights[1].size);
  stateBiasValues[0] = 1;
  const stateBias = tf.tensor(stateBiasValues, stateWeights[1].shape);
  model.layers.stateProjection.setWeights([stateKernel, stateBias]);

  const actionWeights = model.layers.actionProjection.getWeights();
  const actionKernelValues = new Float32Array(actionWeights[0].size);
  actionKernelValues[0] = sign * 5;
  const actionKernel = tf.tensor(actionKernelValues, actionWeights[0].shape);
  const actionBias = tf.zerosLike(actionWeights[1]);
  model.layers.actionProjection.setWeights([actionKernel, actionBias]);

  const biasWeights = model.layers.actionBias.getWeights();
  const zeroBiasWeights = biasWeights.map((weight) => tf.zerosLike(weight));
  model.layers.actionBias.setWeights(zeroBiasWeights);
  [
    stateKernel,
    stateBias,
    actionKernel,
    actionBias,
    ...zeroBiasWeights
  ].forEach((tensor) => tensor.dispose());
  return model;
}

function probeTrajectories() {
  const actions = new Float32Array(MAX_ACTIONS * ACTION_DIM);
  actions[0] = 1;
  actions[ACTION_DIM] = -1;
  return Array.from({ length: 20 }, (_, index) => ({
    gameId: `probe-game-${index}`,
    deckId: `deck-${index % 2}`,
    playerId: index % 2 ? "p2" : "p1",
    steps: [{
      informationSetHash: `information-${index}`,
      state: new Float32Array(STATE_DIM),
      actions,
      legalCount: 2
    }]
  }));
}

function winningEvaluation() {
  const summaries = Array.from({ length: 40 }, (_, index) => ({
    candidateSeat: index % 2,
    firstPlayerId: index % 2 ? "p2" : "p1",
    gameSeed: index + 1,
    deckIds: ["deck-a", "deck-a"],
    completed: true,
    invalid: false,
    winnerId: index % 2 ? "p2" : "p1"
  }));
  return {
    completed: 40,
    invalidGames: 0,
    winRate: 1,
    wilsonLowerBound: 0.91,
    summaries
  };
}

test("paired strength and fixed public behavior certificates form the robust pool", () => {
  const engineFingerprint = "sha256:continuation-engine";
  const first = decisivePolicy(1);
  const second = decisivePolicy(-1);
  first.metadata.engineFingerprint = engineFingerprint;
  second.metadata.engineFingerprint = engineFingerprint;
  const probe = createFixedContinuationBehaviorProbe(probeTrajectories(), {
    engineFingerprint,
    maximumStates: 16
  });
  assert.equal(validFixedContinuationBehaviorProbe(probe, {
    engineFingerprint
  }), true);
  first.metadata.actionEvidenceStrengthCertificate =
    createContinuationStrengthCertificate(first, winningEvaluation(), {
      engineFingerprint,
      independentHoldout: true,
      evaluationMode: "same-deck-mirror-v3",
      leagueEvaluation: winningEvaluation(),
      seedManifestDigest: "sha256:seeds"
    });
  second.metadata.actionEvidenceStrengthCertificate =
    createContinuationStrengthCertificate(second, winningEvaluation(), {
      engineFingerprint,
      independentHoldout: true,
      evaluationMode: "same-deck-mirror-v3",
      leagueEvaluation: winningEvaluation(),
      seedManifestDigest: "sha256:seeds"
    });
  second.metadata.actionEvidenceDiversityCertificates =
    createContinuationDiversityCertificates([first, second], probe, {
      engineFingerprint,
      minimumDisagreementRate: 0.08,
      minimumJsDivergence: 0.001
    });
  assert.equal(
    second.metadata.actionEvidenceDiversityCertificates[0]
      .behaviorallyIndependent,
    true
  );
  const selected = selectCertifiedIndependentContinuationPool(
    [first, second],
    { engineFingerprint }
  );
  assert.equal(selected.ready, true);
  assert.equal(selected.models.length, 2);
  assert.equal(selected.probeDigest, probe.probeDigest);

  const unpaired = createContinuationStrengthCertificate(
    decisivePolicy(1),
    winningEvaluation(),
    {
      engineFingerprint,
      independentHoldout: true,
      evaluationMode: "cross-deck-matrix-v1",
      leagueEvaluation: winningEvaluation(),
      seedManifestDigest: "sha256:unpaired-seeds"
    }
  );
  assert.equal(unpaired.pairedSeeds, false);
  assert.equal(unpaired.eligible, false);
});
