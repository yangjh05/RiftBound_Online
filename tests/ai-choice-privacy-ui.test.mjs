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
  assert.match(appSource, /const showPaymentStage = decisionVisibleToViewer\(game\.pendingPayment\)/);
  assert.match(appSource, /const showChoiceStage = decisionVisibleToViewer\(game\.pendingChoice\)/);
  assert.match(appSource, /\$\{showPaymentStage \? paymentPanel\(\) : ""\}/);
  assert.match(appSource, /const showPendingChoice = decisionVisibleToViewer\(game\.pendingChoice\)/);
  assert.match(appSource, /\$\{sidePanelChoice \? choicePanel\(\) : ""\}/);
});

test("private setup choices stay hidden while revealed play-order loadouts remain public", () => {
  assert.match(appSource, /function setupSelectionVisibleToViewer\(playerId\)/);
  assert.doesNotMatch(appSource, /if \(isChoosing && !setupSelectionVisibleToViewer\(chooser\?\.id\)\)/);
  assert.match(appSource, /function firstPlayerLoadout\(player\)/);
  assert.match(appSource, /data-setup-role="\$\{key\}"/);
  assert.match(appSource, /if \(!setupSelectionVisibleToViewer\(selectingPlayer\?\.id\)\) \{\s*return privateSetupWaitingPanel\(selectingPlayer\);/);
  assert.match(appSource, /return privateSetupWaitingPanel\(selectingPlayer, "champion-setup"\);/);
  assert.match(appSource, /\|\| !setupSelectionVisibleToViewer\(player\?\.id\)\) \{/);
  assert.match(appSource, /const visiblePlayers = game\.players\.filter\(\(player\) => player\.id === viewerPlayerId\(\)\)/);
  assert.match(appSource, /function privateSetupWaitingPanel\(player, panelClass = ""\)/);
});
