import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("processing queue renders localized effect text directly in each item", () => {
  assert.match(appSource, /class="chain-zone-effect"/);
  assert.match(appSource, /function chainItemEffectText\(item\)/);
  assert.match(appSource, /return source \? cardText\(source\)/);
});

test("processing queue items wrap readable text instead of forcing one-line ellipsis", () => {
  assert.match(styles, /\.chain-zone-effect\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.chain-zone-item span,[\s\S]*\.chain-zone-item small\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.chain-zone-item\s*\{[\s\S]*min-height:\s*128px/);
});

test("declared unit plays remain visible in the Chain tree with their destination", () => {
  assert.match(appSource, /function chainItemVisibleInTree\(item\)/);
  assert.match(appSource, /return Boolean\(item\);/);
  assert.match(appSource, /item\?\.destination/);
});

test("private opponent resolutions do not render response controls", () => {
  assert.match(appSource, /function responsePromptInfo\(\)/);
  assert.match(appSource, /!viewerCanAct\(\)/);
  assert.match(appSource, /data-action="pass-showdown" \$\{viewerCanAct\(\) \? "" : "disabled"\}/);
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
