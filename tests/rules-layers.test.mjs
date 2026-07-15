import test from "node:test";
import assert from "node:assert/strict";
import { cards } from "../src/cards.mjs";
import { createGame, currentMight } from "../src/engine.mjs";
import {
  evaluateLayeredCharacteristics,
  orderLayerEffects,
  resolveLayeredNumber
} from "../src/rules/layers.mjs";

function instance(card, ownerId, id) {
  return {
    ...structuredClone(card),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    mightModifier: 0,
    attachments: []
  };
}

test("numeric layers apply assignment, all increases, then all decreases", () => {
  assert.equal(resolveLayeredNumber({
    printed: 9,
    assignment: 2,
    modifiers: [-5, 3, -1, 4]
  }), 3);
});

test("ability layers repeat to a fixed point after arithmetic enables an ability", () => {
  const state = evaluateLayeredCharacteristics({
    printed: { might: 4, keywords: [], tags: [] },
    effects: [
      { id: "mighty-keywords", layer: "ability", operation: "grant", property: "keywords", value: "Shield", applies: (current) => current.might >= 5 },
      { id: "buff", layer: "arithmetic", operation: "add", property: "might", value: 1, timestamp: 1 }
    ]
  });

  assert.equal(state.might, 5);
  assert.deepEqual(state.keywords, ["Shield"]);
});

test("same-layer dependencies override timestamp ordering and cycles are rejected", () => {
  const first = { id: "first", layer: "trait", timestamp: 10 };
  const dependent = { id: "dependent", layer: "trait", timestamp: 1, dependsOn: ["first"] };
  assert.deepEqual(orderLayerEffects([dependent, first]).map((effect) => effect.id), ["first", "dependent"]);
  assert.throws(() => orderLayerEffects([
    { id: "a", dependsOn: ["b"] },
    { id: "b", dependsOn: ["a"] }
  ]), /Cyclic layer dependency/);
});

test("production Might calculation does not clamp decreases before later increases", () => {
  const game = createGame();
  const player = game.players[0];
  const unit = instance(cards.lonelyPoro, player.id, "layered-production-unit");
  unit.might = 2;
  unit.mightModifier = -5;
  const battlefield = {
    instanceId: "layered-production-field",
    name: "Layered Production Field",
    type: "battlefield",
    controllerId: player.id,
    controlledBy: player.id,
    hidden: [],
    effects: [{ timing: "static", kind: "unitsHereMight", amount: 3 }],
    units: [unit]
  };
  game.battlefields = [battlefield];

  assert.equal(currentMight(game, unit), 0);
});
