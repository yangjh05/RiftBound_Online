import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");

test("non-Rune activation buttons preserve the exact legal ability id", () => {
  assert.match(appSource, /return abilities\.map\(\(ability\) => \{[\s\S]{0,500}?data-action="activate-card"[\s\S]{0,200}?data-ability="\$\{ability\.id\}"/);
});

test("payment-window Add buttons preserve the exact legal ability id", () => {
  assert.match(appSource, /options\.map\(\(\{ card, ability \}\) => `[\s\S]{0,300}?data-action="activate-card"[\s\S]{0,200}?data-ability="\$\{ability\.id\}"/);
});

test("the payment step uses the board Runes directly and keeps both payment modes visible", () => {
  const paymentPanelSource = appSource.slice(appSource.indexOf("function paymentPanel"), appSource.indexOf("function paymentDisplayCard"));
  assert.match(paymentPanelSource, /class="payment-stage-banner payment-panel"/);
  assert.match(paymentPanelSource, /Click or tap a Rune to pay Energy/);
  assert.match(paymentPanelSource, /press Shift\+Enter on a Rune to pay Power/);
  assert.match(paymentPanelSource, /Legend, Seal, or another resource ability/);
  assert.match(appSource, /function directRunePaymentState\(rune, playerId\)/);
  assert.match(appSource, /"payment-rune-choice"[\s\S]{0,500}?"is-energy-selected"[\s\S]{0,200}?"is-power-selected"/);
  assert.match(appSource, /data-action="\$\{payment\.active \? "pay-rune" : "select-card"\}"/);
  assert.match(appSource, /data-direct-payment-rune="\$\{payment\.active\}"/);
  assert.doesNotMatch(appSource, /function paymentRuneSection/);
});

test("click, context, touch-hold, and keyboard inputs pay with board Runes", () => {
  assert.match(appSource, /button\[data-direct-payment-rune='true'\]\[data-rune\]/);
  assert.match(appSource, /runeButton\?\.dataset\?\.paymentPower !== "true"/);
  assert.match(appSource, /togglePaymentRune\(game, runeId, "power"\)/);
  assert.match(appSource, /aria-keyshortcuts=\\"Shift\+Enter\\"/);
  assert.match(appSource, /action === "pay-rune"[\s\S]{0,280}?button\.dataset\.paymentEnergy === "true"/);
});

test("the slim payment step remains on the board instead of opening a floating modal", () => {
  const gamePanelSource = appSource.slice(appSource.indexOf("function gamePanel"), appSource.indexOf("function closeTabletopSheets"));
  assert.match(gamePanelSource, /table-command-layer[\s\S]{0,180}?showPaymentStage \? paymentPanel\(\)/);
  const floatingSource = appSource.slice(appSource.indexOf("function gameFloatingPanels"), appSource.indexOf("function closeTabletopSheets"));
  assert.doesNotMatch(floatingSource, /paymentPanel\(\)/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf("function paymentPanel"), appSource.indexOf("function paymentDisplayCard")), /aria-modal="true"|data-ui-modal/);
});

test("the generated-Energy payment UI uses the engine's shared legal options", () => {
  assert.match(appSource, /function poolEnergyControls[\s\S]{0,180}?legalPaymentPoolEnergyOptions\(game\)/);
});

test("the cast button uses the engine's complete payment confirmation legality", () => {
  assert.match(appSource, /const paymentReady = paymentConfirmationLegality\(game\)\.ok;/);
  assert.doesNotMatch(appSource, /function paymentCanConfirm\(/);
});

test("an invalid suspended payment keeps a cancel-only recovery control visible", () => {
  const paymentSource = appSource.slice(appSource.indexOf("function paymentPanel"), appSource.indexOf("function paymentDisplayCard"));
  assert.match(appSource, /!currentPaymentIssue && !resumeLegality\.ok/);
  assert.match(paymentSource, /paymentResumeLegality\(game, payment\)/);
  assert.match(paymentSource, /data-invalid-resume-payment[\s\S]{0,800}?data-action="cancel-payment"/);
});

test("a missing payment player reaches the payment panel's recovery button", () => {
  assert.match(appSource, /const canRenderRecoveryPayment =[\s\S]{0,300}?!playerIds\.has\(candidate\.pendingPayment\.playerId\)/);
  const paymentSource = appSource.slice(appSource.indexOf("function paymentPanel"), appSource.indexOf("function paymentDisplayCard"));
  assert.match(paymentSource, /if \(!player\)[\s\S]{0,900}?data-action="cancel-payment"/);
});

test("Basic Rune ADD abilities are not duplicated above their direct payment controls", () => {
  assert.match(appSource, /function activatedAddResources[\s\S]{0,420}?card\.type !== "rune"/);
});

test("online commands are validated only by the authoritative server game", () => {
  const onlineBranch = appSource.slice(
    appSource.indexOf("// Online snapshots are intentionally redacted"),
    appSource.indexOf("function resolveCurrentGameCommand")
  );
  assert.match(
    onlineBranch,
    /const resolvedCommand = command\.kind === "surrender"[\s\S]{0,160}?guardedOnlineSurrenderCommand\(command, commandSession\)[\s\S]{0,80}?: command;/
  );
  assert.match(onlineBranch, /sendOnlineCommand\(commandSession\.roomId, commandSession\.playerToken, resolvedCommand\)/);
  assert.doesNotMatch(onlineBranch, /resolveLegalAction\(/);
});

test("online action gating uses the actor published by the authoritative snapshot", () => {
  assert.match(appSource, /function activePlayerId\(\) \{\s*if \(isOnlineGame\(\) && game\.authoritativeActorId\) return game\.authoritativeActorId;/);
});

test("play, hide, champion, and move controls use the cached UI legal-action manifest", () => {
  assert.match(appSource, /cachedUiLegalActions = enumerateUiLegalActions\(game, viewerId\);/);
  assert.match(appSource, /if \(viewerCanAct\(\)\) uiLegalActions = legalActionsForCurrentUi\(nextViewerPlayerId\);/);
  assert.match(appSource, /indexUiLegalActions\(uiLegalActions\);/);
  assert.match(appSource, /function uiCardActions\(cardId\)/);
  assert.match(appSource, /function uiUnitMoveDestinationIds\(unitId\)/);
  assert.match(appSource, /action\.kind === "beginPlayCard"/);
  assert.match(appSource, /action\.kind === "hideCard"/);
  assert.match(appSource, /action\?\.kind === "beginPlayChampion"/);
  assert.match(appSource, /action\?\.kind === "moveUnit"/);
  assert.doesNotMatch(appSource, /\benumerateLegalActions\s*\(/);
  assert.doesNotMatch(appSource, /function canPayCard\(/);
});
