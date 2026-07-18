import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

test("reveal confirmation keeps its card list scrollable and its confirm action visible", () => {
  assert.match(appSource, /class="actions reveal-confirmation-actions"/);

  const panel = cssRule(".modal-panel.choice-panel.reveal-confirmation-panel");
  assert.match(panel, /display:\s*flex/);
  assert.match(panel, /flex-direction:\s*column/);
  assert.match(panel, /overflow:\s*hidden/);

  const cards = cssRule(".reveal-confirmation-panel .revealed-card-grid");
  assert.match(cards, /flex:\s*1 1 auto/);
  assert.match(cards, /min-height:\s*0/);

  const actions = cssRule(".reveal-confirmation-actions");
  assert.match(actions, /flex:\s*0 0 auto/);
});
