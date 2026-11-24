import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { detectEffectAnimations, EFFECT_ANIMATION_DURATION_MS } from "../src/ui/effect-animations.mjs";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("effect animation diff identifies draws, unit deaths, and per-unit Might changes", () => {
  const previous = snapshot({
    players: [["p1", 12, ["old-card"]]],
    boardUnits: [unit("fallen", 3), unit("buffed", 2), unit("weakened", 5)],
    chainItems: []
  });
  const current = snapshot({
    players: [["p1", 10, ["old-card", "draw-a", "draw-b"]]],
    boardUnits: [unit("buffed", 4), unit("weakened", 3)],
    trash: ["fallen"],
    chainItems: []
  });

  const result = detectEffectAnimations(previous, current);

  assert.deepEqual(result.draws, [{ playerId: "p1", count: 2 }]);
  assert.deepEqual(result.deaths.map((entry) => entry.id), ["fallen"]);
  assert.deepEqual(result.mightChanges, [
    { unitId: "buffed", delta: 2, from: 2, to: 4 },
    { unitId: "weakened", delta: -2, from: 5, to: 3 }
  ]);
  assert.ok(EFFECT_ANIMATION_DURATION_MS >= 1000);
});

test("counter animation keeps the countered target from a removed Chain pair", () => {
  const gust = { id: "gust-item", cardId: "gust", name: "Gust", playerId: "p2", sourceName: "Gust", type: "card", status: "finalized", targetIds: [] };
  const defy = { id: "defy-item", cardId: "defy", name: "Defy", playerId: "p1", sourceName: "Defy", type: "card", status: "finalized", targetIds: ["gust"] };
  const previous = snapshot({ chainItems: [gust, defy] });
  const current = snapshot({ chainItems: [], trash: ["gust", "defy"], logHead: "Defy counters Gust." });

  const result = detectEffectAnimations(previous, current);

  assert.equal(result.countered.length, 1);
  assert.equal(result.countered[0].id, "gust-item");
});

test("draw, death, Might, and counter cues are connected to animations lasting at least one second", () => {
  assert.match(appSource, /tableCardPile\(\{[\s\S]*?effect:\s*drawAnimation \? "draw" : ""/);
  assert.match(appSource, /data-effect="\$\{effect\}"/);
  assert.match(appSource, /function unitDeathGhosts\(location, playerId\)/);
  assert.match(appSource, /function unitMightCue\(card\)/);
  assert.match(appSource, /function counteredChainZoneItem\(item\)/);

  for (const animation of ["deck-count-shimmer", "unit-might-up", "unit-might-down", "unit-death-collapse", "chain-effect-countered"]) {
    const match = styles.match(new RegExp(`animation:\\s*${animation}\\s+(\\d+)ms`));
    assert.ok(match, `${animation} should be assigned to its UI target`);
    assert.ok(Number(match[1]) >= 1000, `${animation} should last at least one second`);
  }
});

test("board Might presentation uses live static-effect calculations", () => {
  assert.match(appSource, /const might = currentMight\(game, card\)/);
  assert.match(appSource, /const raw = showdownUnitStats\(card, location\) \|\| unitDamageState\(game, card, \{ might: uiCurrentMight\(card\) \}\)/);
  assert.match(appSource, /data-current-might="\$\{stats\.might\}"/);
  assert.match(appSource, /boardCardCornerOverlay\(card, stats\)/);
  assert.match(appSource, /const damageState = unitDamageState\(game, card, \{ battlefield, role \}\)/);
  assert.match(appSource, /const items = \[`\$\{t\("might", locale\(\)\)\} \$\{uiCurrentMight\(card\)\}`\]/);
  assert.match(appSource, /snapshotPresentationGame\(game, \(card\) => uiCurrentMight\(card\), viewerPlayerId\(\)\)/);
});

function snapshot({ players = [], boardUnits = [], trash = [], chainItems = [], logHead = "", effectMessage = "" } = {}) {
  return {
    players: new Map(players.map(([id, deckCount, handIds]) => [id, { deckCount, handIds: new Set(handIds) }])),
    boardUnits: new Map(boardUnits.map((entry) => [entry.id, entry])),
    trash: new Set(trash),
    chainItems,
    chainItemIds: new Set(chainItems.map((item) => item.id)),
    logHead,
    effectMessage
  };
}

function unit(id, might) {
  return { id, name: id, might, playerId: "p1", ownerId: "p1", location: "base", image: "" };
}
