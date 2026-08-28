import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { collectChainTargetIds } from "../src/ui/chain-targets.mjs";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("Chain target collection covers declared card and queued trigger targets", () => {
  assert.deepEqual(collectChainTargetIds({
    card: {
      declaredPlayTargets: [{ targetId: "unit-a" }],
      declaredPlayChoices: [{ unitId: "unit-b" }]
    },
    trigger: {
      sourceCardId: "source",
      data: {
        declaredTargets: [{ cardId: "unit-c" }],
        targetIds: ["unit-d"],
        allocations: [{ targetId: "unit-a" }]
      }
    },
    destination: "field-a"
  }), ["unit-a", "unit-b", "unit-c", "unit-d", "field-a"]);
});

test("a Chain source card id is never mistaken for its target", () => {
  assert.deepEqual(collectChainTargetIds({
    card: { instanceId: "source-card" },
    trigger: { sourceCardId: "source-card", cardId: "source-card", data: {} }
  }), []);
});

test("clicking a Chain effect opens target context and highlights its cards", () => {
  assert.match(appSource, /data-action="inspect-chain-effect"/);
  assert.match(appSource, /function inspectedChainTargetPanel\(items, responding\)/);
  assert.match(appSource, /data-action="focus-chain-target"/);
  assert.match(appSource, /inspectedChainTargetIds\.has\(cardId\)/);
  assert.match(styles, /\.chain-target-panel\s*\{/);
  assert.match(styles, /\.chain-effect-target\s*\{/);
});
