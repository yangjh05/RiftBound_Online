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

test("trigger ordering exposes toggled positions, mandatory status, and disabled confirmation", () => {
  assert.match(appSource, /group\?\.orderedTriggers \|\| \[\]/);
  assert.match(appSource, /option\.selected \? "is-selected" : ""/);
  assert.match(appSource, /aria-pressed="\$\{Boolean\(option\.selected\)\}"/);
  assert.match(appSource, /triggerOrderMandatoryRemaining/);
  assert.match(appSource, /confirmOption \? `/);
  assert.match(appSource, /data-choice="\$\{confirmOption\.id\}"/);
  assert.match(appSource, /confirmOption\.disabled \? "disabled aria-disabled=/);
  assert.match(appSource, /class="trigger-order-effect">\$\{triggerOrderEffectText\(trigger, option\)\}/);
  assert.match(styles, /\.trigger-order-track\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styles, /\.trigger-order-grid \.trigger-order-option-wrap\s*\{[\s\S]*width:\s*300px/);
  assert.match(styles, /\.choice-option\.trigger-order-option\.is-selected/);
  assert.match(styles, /\.trigger-order-confirm/);
  assert.match(styles, /\.choice-option \.trigger-order-effect\s*\{[\s\S]*-webkit-line-clamp:\s*5/);
});

test("trigger order confirmation remains visible while long selections scroll", () => {
  const headerStart = appSource.indexOf('<div class="section-head trigger-order-head">');
  const confirmStart = appSource.indexOf('<div class="trigger-order-confirm">', headerStart);
  const headerEnd = appSource.indexOf("</div>", confirmStart);
  const trackStart = appSource.indexOf('<div class="trigger-order-track"', headerStart);
  assert.ok(headerStart >= 0 && confirmStart > headerStart && headerEnd > confirmStart);
  assert.ok(trackStart > confirmStart, "the confirmation action is rendered before scrollable trigger content");
  assert.match(styles, /\.modal-panel\.trigger-order-panel\s*\{[\s\S]*display:\s*flex;[\s\S]*max-height:\s*min\(86vh,\s*720px\);[\s\S]*overflow:\s*hidden;/);
  assert.match(styles, /\.trigger-order-selected\s*\{[\s\S]*max-height:\s*120px;[\s\S]*overflow-y:\s*auto;/);
  assert.match(styles, /\.choice-grid\.trigger-order-grid\s*\{[\s\S]*flex:\s*1 1 180px;[\s\S]*min-height:\s*180px;[\s\S]*max-height:\s*240px;/);
});
