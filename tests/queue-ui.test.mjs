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
