import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const tabletopStyles = await readFile(new URL("../src/tabletop.css", import.meta.url), "utf8");

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
  assert.match(appSource, /chosen\.map\(triggerOrderSelectedItem\)/);
  assert.match(styles, /\.trigger-order-track\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/);
  assert.match(styles, /\.trigger-order-grid \.trigger-order-option-wrap\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;[^}]*height:\s*100%;/);
  assert.match(styles, /\.choice-option\.trigger-order-option\.is-selected/);
  assert.match(styles, /\.trigger-order-confirm/);
  assert.match(styles, /\.choice-option \.trigger-order-effect\s*\{[^}]*overflow-y:\s*auto;[^}]*-webkit-line-clamp:\s*unset/);
});

test("trigger order confirmation, selected order, and full-card actions remain reachable", () => {
  const headerStart = appSource.indexOf('<div class="section-head trigger-order-head">');
  const confirmStart = appSource.indexOf('<div class="trigger-order-confirm">', headerStart);
  const headerEnd = appSource.indexOf("</div>", confirmStart);
  const trackStart = appSource.indexOf('<div class="trigger-order-track"', headerStart);
  assert.ok(headerStart >= 0 && confirmStart > headerStart && headerEnd > confirmStart);
  assert.ok(trackStart > confirmStart, "the confirmation action is rendered before scrollable trigger content");
  assert.match(styles, /\.modal-panel\.trigger-order-panel\s*\{[^}]*height:\s*min\(88dvh,\s*760px\);[^}]*max-height:\s*calc\(100dvh - 24px\);[^}]*overflow:\s*hidden;/);
  assert.match(styles, /\.trigger-order-selected ol\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/);
  assert.match(styles, /\.choice-grid\.trigger-order-grid\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*max-height:\s*none;[^}]*overflow-x:\s*auto;/);
  assert.match(tabletopStyles, /:has\(\.floating-panels > \.trigger-order-panel\) \.chain-pod\s*\{[^}]*visibility:\s*hidden !important;/);
  assert.match(tabletopStyles, /\.floating-panels\.has-blocking-decision > \.trigger-order-panel\s*\{[^}]*height:\s*100% !important;[^}]*max-height:\s*100% !important;/);
  assert.match(styles, /\.modal-panel\.full-card-modal\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/);
  assert.match(styles, /\.full-card-modal \.full-card-copy\s*\{[^}]*overflow-y:\s*auto;/);
});
