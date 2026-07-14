import { actionKey, enumerateLegalActions } from "./actions.mjs";
import { ACTION_DIM, CARD_BINS, MAX_ACTIONS, STATE_DIM, encodeAction, encodeOpponentDeckTarget, encodeState, selectHierarchicalActions } from "./neural/encoding.mjs";

export function encodeHumanDecisionSample(game, actorId, selectedAction, analysis) {
  const legal = selectHierarchicalActions(enumerateLegalActions(game, actorId), MAX_ACTIONS);
  const selectedKey = actionKey(selectedAction);
  const recommendedKey = analysis?.best?.key || selectedKey;
  const selectedIndex = Math.max(0, legal.findIndex((action) => actionKey(action) === selectedKey));
  const recommendedIndex = Math.max(0, legal.findIndex((action) => actionKey(action) === recommendedKey));
  return {
    version: 1,
    state: sparse(encodeState(game, actorId)),
    actions: legal.map((action) => sparse(encodeAction(game, actorId, action))),
    legalCount: legal.length,
    selectedIndex,
    recommendedIndex,
    beliefTarget: sparse(encodeOpponentDeckTarget(game, actorId)),
    regret: analysis?.regret || 0,
    quality: {
      confidence: analysis?.confidence || "low",
      simulations: analysis?.best?.simulations || 0,
      rollout: (analysis?.best?.simulations || 0) >= 8,
      intervalWidth: intervalWidth(analysis?.best?.confidenceInterval)
    }
  };
}

export function hydrateHumanReplayTrajectories(replays, options = {}) {
  const trajectories = [];
  for (const replay of replays) {
    const steps = [];
    for (const decision of replay.decisions || []) {
      if (decision.actorId !== replay.humanPlayerId) continue;
      const sample = decision.trainingSample;
      if (!sample?.legalCount) continue;
      const highQuality = sample.quality?.rollout
        && sample.quality?.confidence !== "low"
        && (sample.quality?.intervalWidth ?? 1) <= (options.maxIntervalWidth || 0.35);
      if (!highQuality) continue;
      const state = dense(sample.state, STATE_DIM);
      const actions = new Float32Array(MAX_ACTIONS * ACTION_DIM);
      sample.actions.slice(0, MAX_ACTIONS).forEach((encoded, index) => actions.set(dense(encoded, ACTION_DIM), index * ACTION_DIM));
      const won = replay.winnerId === decision.actorId ? 1 : replay.winnerId ? -1 : 0;
      steps.push({
        state,
        actions,
        selectedIndex: sample.regret >= (options.correctionThreshold || 0.03) ? sample.recommendedIndex : sample.selectedIndex,
        legalCount: sample.legalCount,
        oldLogProbability: -Math.log(Math.max(1, sample.legalCount)),
        value: 0,
        beliefTarget: dense(sample.beliefTarget, CARD_BINS),
        initialMemory: [],
        advantage: 1,
        return: won,
        source: "human-coaching"
      });
    }
    if (steps.length) trajectories.push({ gameId: replay.id, playerId: replay.humanPlayerId, human: true, steps });
  }
  return trajectories;
}

function intervalWidth(interval) { return Array.isArray(interval) && interval.length === 2 ? Math.max(0, interval[1] - interval[0]) : 1; }

function sparse(values) {
  const output = [];
  for (let index = 0; index < values.length; index += 1) if (values[index]) output.push([index, values[index]]);
  return output;
}

function dense(entries, size) {
  const output = new Float32Array(size);
  for (const [index, value] of entries || []) if (index >= 0 && index < size) output[index] = value;
  return output;
}
