import test from "node:test";
import assert from "node:assert/strict";
import { cloneAiState } from "../src/ai/clone-state.mjs";
import { createGame } from "../src/engine.mjs";
import { decklists } from "../src/cards.mjs";
import { actionKey, activeActorId, applyAiAction, cloneGame, enumerateAiPolicyActions } from "../src/ai/actions.mjs";

function withSameExternalClockAndRandom(fn) {
  const originalClock = Date.now, originalRandom = Math.random;
  let state = 1;
  Date.now = () => 123456;
  Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  try { return fn(); } finally { Date.now = originalClock; Math.random = originalRandom; }
}

test("AI clone preserves cycles, aliases, sparse arrays and numeric edge cases", () => {
  const card = { might: 4, health: undefined, nan: NaN, negativeZero: -0, infinity: Infinity, big: 1n };
  const array = new Array(4);
  array[2] = card;
  array.note = "extra";
  const source = { card, board: [card], array, dictionary: Object.assign(Object.create(null), { x: 1 }) };
  source.self = source;
  Object.defineProperty(source, "__proto__", { value: card, enumerable: true });
  Object.defineProperty(source, "notEnumerable", { value: 7 });
  source[Symbol("private")] = 10;
  const copy = cloneAiState(source);
  assert.deepEqual(copy, structuredClone(source));
  assert.equal(copy.card, copy.board[0]);
  assert.equal(copy.card, copy.array[2]);
  assert.equal(copy.card, copy.__proto__);
  assert.equal(copy.self, copy);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  copy.card.might = 1;
  assert.equal(source.card.might, 4);
  assert.equal(cloneAiState(source).card.might, 4);
});

test("AI clone falls back for exotic graphs without losing cross-boundary aliases", () => {
  const shared = { count: 1 };
  const source = { shared, map: new Map([[shared, shared]]), set: new Set([shared]), time: new Date(0), values: new Float32Array([1, 2]) };
  const copy = cloneAiState(source);
  assert.deepEqual(copy, structuredClone(source));
  assert.equal(copy.map.get(copy.shared), copy.shared);
  assert.ok(copy.set.has(copy.shared));
  copy.values[0] = 9;
  assert.equal(source.values[0], 1);
});

test("AI clone invokes accessor fallback once and preserves native rejection of uncloneable values", () => {
  let reads = 0;
  const source = { get value() { reads++; return 42; }, later: new Set([1]) };
  assert.equal(cloneAiState(source).value, 42);
  assert.equal(reads, 1);
  assert.throws(() => cloneAiState({ callback() {} }), { name: "DataCloneError" });
  assert.throws(() => cloneAiState({ symbol: Symbol("x") }), { name: "DataCloneError" });
});

test("AI branch cloning matches native clone across legal actions and state transitions", () => {
  const decks = Object.values(decklists);
  const phases = new Set();
  for (let seed = 1; seed <= 3; seed++) {
    const game = createGame({ decks: [decks[seed % decks.length], decks[(seed + 1) % decks.length]], interactive: true, manualActionChainPriority: true, randomSeed: seed });
    for (let step = 0; step < 36 && game.phase !== "complete"; step++) {
      phases.add(game.phase);
      const native = structuredClone(game);
      const fast = cloneGame(game);
      assert.deepEqual(fast, native);
      const actor = activeActorId(game);
      const actions = enumerateAiPolicyActions(game, actor);
      assert.ok(actions.length);
      assert.deepEqual(enumerateAiPolicyActions(fast, actor).map(actionKey), actions.map(actionKey));
      for (const action of actions.slice(0, 4)) {
        const left = structuredClone(game), right = cloneGame(game);
        assert.deepEqual(withSameExternalClockAndRandom(() => applyAiAction(right, action, actor)),
          withSameExternalClockAndRandom(() => applyAiAction(left, action, actor)));
        assert.deepEqual(right, left);
      }
      const action = actions.find((a) => ["confirmMulligan", "skipMulligan"].includes(a.kind))
        || actions[(step * 7 + seed) % actions.length];
      assert.equal(applyAiAction(game, action, actor).ok, true);
      assert.deepEqual(native, structuredClone(fast), "branches must not mutate the source or one another");
    }
  }
  assert.ok(phases.has("action"));
});
