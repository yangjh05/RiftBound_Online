import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGame } from "../src/engine.mjs";
import { decklists } from "../src/cards.mjs";
import { activeActorId, actionKey, applyAiAction, enumerateAiPolicyActions } from "../src/ai/actions.mjs";
import { scoreActions, DEFAULT_AI_MODEL } from "../src/ai/policy.mjs";
import { rolloutAlternatives } from "../src/ai/rollout.mjs";
import { configureAiPerformance, snapshotAiPerformance } from "../src/ai/performance.mjs";

// Run separately with RIFTBOUND_AI_NATIVE_CLONE=1 and =0, compare resultHash
// before comparing timings. This bounded search probe is not training evidence.
const originalDate = Date.now;
const originalRandom = Math.random;
let randomState = 42;
Date.now = () => 123456789;
Math.random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const digest = createHash("sha256");
const decks = Object.values(decklists);
let transitions = 0, searches = 0;
const phases = new Set();
const turns = new Set();
configureAiPerformance({ enabled: true });
try {
  for (let seed = 1; seed <= 3; seed++) {
    const game = createGame({ decks: [decks[seed % decks.length], decks[(seed + 1) % decks.length]],
      interactive: true, manualActionChainPriority: true, randomSeed: seed });
    for (let step = 0; step < 72 && game.phase !== "complete"; step++) {
      phases.add(game.phase);
      turns.add(game.turnNumber);
      const actor = activeActorId(game);
      const actions = enumerateAiPolicyActions(game, actor);
      assert.ok(actions.length);
      const ranked = scoreActions(game, actor, actions);
      digest.update(JSON.stringify(ranked.map(({ key, score }) => ({ key, score }))));
      if (step >= 20 && step % 24 === 0 && actions.length > 1) {
        const values = rolloutAlternatives(game, actor, ranked.slice(0, 3).map((item) => item.action),
          DEFAULT_AI_MODEL, { simulations: 4, depth: 8, random: Math.random, minimumTurnTransitions: 0 });
        digest.update(JSON.stringify(values));
        searches++;
      }
      const action = ranked[0].action;
      digest.update(actionKey(action));
      assert.equal(applyAiAction(game, action, actor).ok, true);
      transitions++;
    }
    digest.update(JSON.stringify(game));
  }
} finally {
  Date.now = originalDate;
  Math.random = originalRandom;
}
console.log(JSON.stringify({ backend: process.env.RIFTBOUND_AI_NATIVE_CLONE === "1" ? "native" : "plain-data",
  resultHash: digest.digest("hex"), transitions, searches, phases: [...phases], turns: [...turns],
  performance: snapshotAiPerformance() }));
