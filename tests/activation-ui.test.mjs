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

test("the payment UI presents Rune payment instructions once and keeps selection state on the controls", () => {
  assert.match(appSource, /function paymentRuneSection[\s\S]{0,900}?Energy exhausts a Rune; Power recycles it/);
  assert.match(appSource, /class="\$\{energySelected \? "selected" : ""\}"[\s\S]{0,250}?aria-pressed="\$\{energySelected\}"/);
  assert.match(appSource, /class="\$\{powerSelected \? "selected" : ""\}"[\s\S]{0,250}?aria-pressed="\$\{powerSelected\}"/);
  assert.doesNotMatch(appSource, /<strong>\$\{t\("(?:energySelected|powerSelected)"/);
});

test("the generated-Energy payment UI uses the engine's shared legal options", () => {
  assert.match(appSource, /function poolEnergyControls[\s\S]{0,180}?legalPaymentPoolEnergyOptions\(game\)/);
});

test("the cast button uses the engine's complete payment confirmation legality", () => {
  assert.match(appSource, /const paymentReady = paymentConfirmationLegality\(game\)\.ok;/);
  assert.doesNotMatch(appSource, /function paymentCanConfirm\(/);
});

test("Basic Rune ADD abilities are not duplicated above their direct payment controls", () => {
  assert.match(appSource, /function activatedAddResources[\s\S]{0,420}?card\.type !== "rune"/);
});

test("online commands are validated only by the authoritative server game", () => {
  const onlineBranch = appSource.slice(
    appSource.indexOf("// Online snapshots are intentionally redacted"),
    appSource.indexOf("function resolveCurrentGameCommand")
  );
  assert.match(onlineBranch, /const resolvedCommand = command;/);
  assert.doesNotMatch(onlineBranch, /resolveLegalAction\(/);
});

test("online action gating uses the actor published by the authoritative snapshot", () => {
  assert.match(appSource, /function activePlayerId\(\) \{\s*if \(isOnlineGame\(\) && game\.authoritativeActorId\) return game\.authoritativeActorId;/);
});

test("play, hide, champion, and move controls use the shared legal-action manifest", () => {
  assert.match(appSource, /if \(viewerCanAct\(\)\) uiLegalActions = enumerateLegalActions\(game, nextViewerPlayerId\);/);
  assert.match(appSource, /action\.kind === "beginPlayCard"/);
  assert.match(appSource, /action\.kind === "hideCard"/);
  assert.match(appSource, /action\.kind === "beginPlayChampion"/);
  assert.match(appSource, /action\.kind === "moveUnit"/);
  assert.doesNotMatch(appSource, /function canPayCard\(/);
});
