import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pendingDecisionVisibleToViewer } from "../src/ui/game-visibility.mjs";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");

test("AI opponent payment and choice decisions stay hidden from the human viewer", () => {
  assert.equal(pendingDecisionVisibleToViewer({
    aiMode: true,
    viewerPlayerId: "p1",
    decision: { playerId: "p2" }
  }), false);
  assert.equal(pendingDecisionVisibleToViewer({
    aiMode: true,
    viewerPlayerId: "p1",
    decision: { playerId: "p1" }
  }), true);
  assert.equal(pendingDecisionVisibleToViewer({
    aiMode: false,
    viewerPlayerId: "p1",
    decision: { playerId: "p2" }
  }), true, "local two-player games keep their existing shared-screen controls");
});

test("the game panel gates both modal types through decision ownership", () => {
  assert.match(appSource, /const showPendingPayment = pendingDecisionVisibleToViewer/);
  assert.match(appSource, /const showPendingChoice = pendingDecisionVisibleToViewer/);
  assert.match(appSource, /\$\{showPendingPayment \? paymentPanel\(\) : ""\}/);
  assert.match(appSource, /\$\{showPendingChoice \? choicePanel\(\) : ""\}/);
});

test("AI setup selections render a private waiting panel instead of opponent choices", () => {
  assert.match(appSource, /function setupSelectionVisibleToViewer\(playerId\)/);
  assert.match(appSource, /if \(isChoosing && !setupSelectionVisibleToViewer\(chooser\?\.id\)\) \{\s*return privateFirstPlayerWaitingPanel\(chooser\);/);
  assert.match(appSource, /if \(!setupSelectionVisibleToViewer\(selectingPlayer\?\.id\)\) \{\s*return privateSetupWaitingPanel\(selectingPlayer\);/);
  assert.match(appSource, /return privateSetupWaitingPanel\(selectingPlayer, "champion-setup"\);/);
  assert.match(appSource, /\|\| !setupSelectionVisibleToViewer\(player\?\.id\)\) \{/);
  assert.match(appSource, /const visiblePlayers = aiMode\s*\? game\.players\.filter\(\(player\) => player\.id === viewerPlayerId\(\)\)/);
  assert.match(appSource, /function privateSetupWaitingPanel\(player, panelClass = ""\)/);
});
