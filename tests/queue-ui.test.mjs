import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("processing queue renders the exact activated ability before the full localized card text", () => {
  assert.match(appSource, /class="chain-zone-effect"/);
  assert.match(appSource, /function chainItemEffectText\(item\)/);
  assert.match(appSource, /item\?\.itemType !== "activated"/);
  assert.match(appSource, /Array\.isArray\(item\.specs\)/);
  assert.match(appSource, /function activatedChainSpecLabel\(spec\)/);
  assert.match(appSource, /class="chain-selected-ability"/);
});

test("processing queue items wrap readable text instead of forcing one-line ellipsis", () => {
  assert.match(styles, /\.chain-zone-effect\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.chain-zone-item span,[\s\S]*\.chain-zone-item small\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.chain-zone-item\s*\{[\s\S]*min-height:\s*128px/);
});

test("Pending hand plays are visible only to their player until Finalize", () => {
  assert.match(appSource, /function chainItemVisibleInTree\(item\)/);
  assert.match(appSource, /return chainItemVisibleToViewer\(item, viewerPlayerId\(\)\);/);
  assert.match(appSource, /item\?\.destination/);
});

test("private opponent resolutions never expose an enabled duplicate response control", () => {
  assert.match(appSource, /function responsePromptInfo\(\)/);
  assert.match(appSource, /!viewerCanAct\(\)/);
  assert.match(appSource, /function passControlButton\(\{ disabled = false \} = \{\}\)/);
  assert.match(appSource, /game\?\.pendingChoice \|\| game\?\.pendingPayment \|\| !viewerCanAct\(\)/);
  assert.equal((appSource.match(/data-action="pass-showdown"/g) || []).length, 1);
});

test("repeated damage choices display their progress and whether targets can repeat", () => {
  assert.match(appSource, /function repeatedDamageProgress\(choice\)/);
  assert.match(appSource, /choice\.data\?\.repeatTotal/);
  assert.match(appSource, /selectRepeatedTargetsOnPlay/);
  assert.match(appSource, /selectedForCurrentStep/);
  assert.match(appSource, /choice\.data\?\.allowRepeatedTargets/);
  assert.match(appSource, /class="choice-repeat-progress"/);
  assert.match(styles, /\.choice-repeat-progress\s*\{/);
});

test("processing queue can collapse so the battlefield remains visible", () => {
  assert.match(appSource, /let chainZoneCollapsed = false/);
  assert.match(appSource, /data-action="toggle-chain-zone"/);
  assert.match(appSource, /aria-expanded="\$\{chainZoneCollapsed \? "false" : "true"\}"/);
  assert.match(appSource, /data-scroll-key="chain-stack"/);
  assert.match(styles, /\.chain-zone\.is-collapsed\s*\{[\s\S]*right:\s*auto/);
  assert.match(styles, /\.chain-zone\.is-collapsed\s*\{[\s\S]*width:\s*min\(360px, calc\(100% - 24px\)\)/);
});
