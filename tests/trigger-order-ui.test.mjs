import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("simultaneous triggers use a dedicated ordering panel instead of a generic card-target prompt", () => {
  assert.match(appSource, /if \(choice\.effect === "triggerOrder"\) return triggerOrderPanel\(choice\)/);
  assert.match(appSource, /function triggerOrderPanel\(choice\)/);
  assert.match(appSource, /triggerOrderProgress/);
  assert.match(appSource, /triggerOrderHelp/);
});

test("trigger ordering exposes chosen positions and the effect text of every remaining option", () => {
  assert.match(appSource, /group\?\.orderedTriggers \|\| \[\]/);
  assert.match(appSource, /class="trigger-order-step \$\{trigger \? "is-chosen" : current \? "is-current" : "is-pending"\}"/);
  assert.match(appSource, /class="trigger-order-effect">\$\{triggerOrderEffectText\(trigger, option\)\}/);
  assert.match(styles, /\.trigger-order-track\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styles, /\.trigger-order-grid \.trigger-order-option-wrap\s*\{[\s\S]*width:\s*300px/);
  assert.match(styles, /\.choice-option \.trigger-order-effect\s*\{[\s\S]*-webkit-line-clamp:\s*5/);
});
