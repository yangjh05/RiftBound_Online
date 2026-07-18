import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("player summary exposes the current level before scrollable zone counts", () => {
  assert.match(appSource, /class="player-stats" data-scroll-key="player-stats-\$\{player\.id\}"/);
  assert.match(appSource, /class="xp-stat">\$\{t\("level", locale\(\)\)\} \$\{player\.xp \|\| 0\}/);

  const levelIndex = appSource.indexOf('class="xp-stat"');
  const deckIndex = appSource.indexOf('class="deck-stat"', levelIndex);
  assert.ok(levelIndex >= 0 && levelIndex < deckIndex, "level should remain visible at the leading edge of the mobile scroller");
});

test("player zones preserve their own horizontal scroll positions", () => {
  assert.match(appSource, /data-scroll-key="graveyard-\$\{player\.id\}"/);
  assert.match(appSource, /data-scroll-key="banished-\$\{player\.id\}"/);
  assert.match(styles, /\.graveyard-cards\s*\{[\s\S]*?touch-action:\s*pan-x/);
  assert.match(styles, /\.player-stats\s*\{[\s\S]*?overflow-x:\s*auto[\s\S]*?touch-action:\s*pan-x/);
});

test("battlefield lanes keep every unit reachable with horizontal scrolling", () => {
  assert.match(appSource, /class="field-lane top-lane[\s\S]*?data-scroll-key="field-\$\{field\.instanceId\}-\$\{topPlayer\.id\}"[\s\S]*?class="field-lane-track"/);
  assert.match(appSource, /class="field-lane bottom-lane[\s\S]*?data-scroll-key="field-\$\{field\.instanceId\}-\$\{bottomPlayer\.id\}"[\s\S]*?class="field-lane-track"/);
  assert.match(styles, /\.field-lane\s*\{[\s\S]*?overflow-x:\s*auto[\s\S]*?overscroll-behavior-x:\s*contain[\s\S]*?scrollbar-width:\s*thin/);
  assert.match(styles, /\.top-lane\s*\{[\s\S]*?justify-content:\s*flex-start/);
  assert.match(styles, /\.field-lane-track\s*\{[\s\S]*?flex:\s*0 0 auto[\s\S]*?min-width:\s*100%/);
  assert.match(styles, /\.top-lane \.field-lane-track > :first-child\s*\{[\s\S]*?margin-inline-start:\s*auto/);
});

test("wider layouts wrap every player zone count inside the identity card", () => {
  assert.match(styles, /\.player-stats\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.player-stats > span,\s*\.player-stats > button\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0/);
});

test("desktop player summary reserves a compact visible row for Champion Zone status", () => {
  assert.match(styles, /\.player-stats > span,\s*\.player-stats > button\s*\{\s*height:\s*17px;\s*min-height:\s*17px/);
  assert.match(styles, /@media \(min-width: 601px\)[\s\S]*?\.player-summary \.champion-control\s*\{\s*min-height:\s*20px;\s*height:\s*20px/);
});
