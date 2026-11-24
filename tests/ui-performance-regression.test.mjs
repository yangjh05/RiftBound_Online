import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const aiTurnWorkerSource = readFileSync(new URL("../src/ai/turn-worker.mjs", import.meta.url), "utf8");

function sourceSection(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return appSource.slice(start, end);
}

test("game rendering reuses revision-scoped UI actions instead of enumerating the AI action space", () => {
  const cacheSource = sourceSection("function legalActionsForCurrentUi", "function indexUiLegalActions");
  const renderSource = sourceSection("function renderApp", "function isTutorialGame");

  assert.match(cacheSource, /cachedUiLegalGame === game/);
  assert.match(cacheSource, /cachedUiLegalRevision === gameStateRevision/);
  assert.match(cacheSource, /cachedUiLegalViewerId === viewerId/);
  assert.match(cacheSource, /enumerateUiLegalActions\(game, viewerId\)/);
  assert.match(renderSource, /legalActionsForCurrentUi\(nextViewerPlayerId\)/);
  assert.match(renderSource, /indexUiLegalActions\(uiLegalActions\)/);
  assert.doesNotMatch(renderSource, /enumerateAiPolicyActions\s*\(|enumerateLegalActions\s*\(/);
  assert.doesNotMatch(appSource, /\benumerateLegalActions\s*\(/);
});

test("render bookkeeping never scans every descendant in the app", () => {
  const scrollSource = sourceSection("function captureScrollState", "function restoreScrollState");
  const renderSource = sourceSection("function render()", "const FOCUS_DATA_KEYS");
  const appRenderSource = sourceSection("function renderApp", "function isTutorialGame");

  assert.doesNotMatch(appSource, /querySelectorAll\s*\(\s*["'`]\*["'`]\s*\)/);
  assert.match(scrollSource, /querySelectorAll\("\[data-scroll-key\]"\)/);
  assert.doesNotMatch(scrollSource, /getComputedStyle|getBoundingClientRect/);
  assert.doesNotMatch(renderSource, /captureTabletopGeometry\(/);
  assert.match(appRenderSource, /uiMotion\.transfers\.some/);
  assert.match(appRenderSource, /currentRenderPreviousGeometry = captureTabletopGeometry\(\)/);
});

test("scroll restoration stays bounded to recent entries in a bounded set of screen scopes", () => {
  const scrollSource = sourceSection("function captureScrollState", "function scrollNodeSignature");

  assert.match(appSource, /const SCROLL_STATE_SCOPE_LIMIT = \d+;/);
  assert.match(appSource, /const SCROLL_STATE_ENTRY_LIMIT = \d+;/);
  assert.match(appSource, /const shellScrollStateByScope = new Map\(\);/);
  assert.match(scrollSource, /rememberBoundedScrollState\(ownerScope, state\)/);
  assert.match(scrollSource, /while \(entries\.size > SCROLL_STATE_ENTRY_LIMIT\)/);
  assert.match(scrollSource, /while \(shellScrollStateByScope\.size > SCROLL_STATE_SCOPE_LIMIT\)/);
  assert.match(scrollSource, /shellScrollStateByScope\.get\(ownerScope\) \|\| \{\}/);
  assert.match(scrollSource, /startsWith\("layout\.phase-"\) \? "layout"/);
  assert.doesNotMatch(scrollSource, /return \{ \.\.\.shellScrollState, \.\.\.state \}/);
});

test("routine diagnostic events are coalesced and persisted off the input path", () => {
  const persistenceSource = sourceSection("function persistGameDiagnostic", "function forgetPersistedGameDiagnostic");
  const commandSource = sourceSection("function recordDiagnosticCommand", "function recordDiagnosticCommandAttempt");
  const attemptSource = sourceSection("function recordDiagnosticCommandAttempt", "function recordDiagnosticUiBreadcrumb");
  const breadcrumbSource = sourceSection("function recordDiagnosticUiBreadcrumb", "function recordDiagnosticOnlineSnapshot");

  assert.match(persistenceSource, /window\.setTimeout/);
  assert.match(persistenceSource, /requestIdleCallback/);
  assert.match(persistenceSource, /requestIdleCallback !== "function"[\s\S]*?DIAGNOSTIC_BOUNDARY_ONLY[\s\S]*?return true/);
  assert.doesNotMatch(
    persistenceSource,
    /requestIdleCallback\([\s\S]*?\},\s*\{\s*timeout/,
    "large diagnostic snapshots must never be forced into a busy gameplay frame"
  );
  assert.match(persistenceSource, /if \(immediate\) return flushGameDiagnosticPersistence\(\)/);
  for (const routineRecorder of [commandSource, attemptSource, breadcrumbSource]) {
    assert.match(routineRecorder, /persistGameDiagnostic\(\)/);
    assert.doesNotMatch(routineRecorder, /persistGameDiagnostic\(\{\s*immediate:\s*true\s*\}\)/);
    assert.doesNotMatch(routineRecorder, /flushGameDiagnosticPersistence|saveGameReproductionLogToStorage|localStorage\.setItem/);
  }
});

test("routine diagnostic state checkpoints are coalesced while final and crash boundaries stay exact", () => {
  const checkpointSource = sourceSection(
    "function scheduleDiagnosticStateCheckpoint",
    "function persistGameDiagnostic"
  );
  const commandSource = sourceSection("function recordDiagnosticCommand", "function recordDiagnosticCommandAttempt");
  const onlineSource = sourceSection("function recordDiagnosticOnlineSnapshot", "function ensureGameDiagnosticFinalized");
  const finalizeSource = sourceSection("function ensureGameDiagnosticFinalized", "function reproductionRandomSeeds");
  const errorSource = sourceSection("function reportUiException", "function errorMessage");

  assert.match(checkpointSource, /pendingDiagnosticStateCheckpoint\s*=\s*\{/);
  assert.match(checkpointSource, /flushPendingDiagnosticStateCheckpoint\(\)/);
  assert.ok(
    checkpointSource.indexOf("flushPendingDiagnosticStateCheckpoint()")
      < checkpointSource.indexOf("saveGameReproductionLogToStorage"),
    "the newest state must be checkpointed before the idle persistence write"
  );
  assert.match(commandSource, /delete diagnosticOutcome\.state/);
  assert.match(commandSource, /scheduleDiagnosticStateCheckpoint\(game, "command"\)/);
  assert.match(commandSource, /stateAlreadyRecorded: recordsFinalState/);
  assert.match(onlineSource, /scheduleDiagnosticStateCheckpoint\(game, "online-snapshot"\)/);
  assert.match(onlineSource, /stateAlreadyRecorded: recordsFinalState/);
  assert.match(finalizeSource, /stateAlreadyRecorded \? undefined : game/);
  assert.ok(
    finalizeSource.indexOf('game?.phase !== "complete"')
      < finalizeSource.indexOf("gameDiagnostic.summary?.()"),
    "incomplete games must exit before constructing even the bounded summary fallback"
  );
  assert.match(errorSource, /recordUiError[\s\S]*discardPendingDiagnosticStateCheckpoint\(\)[\s\S]*persistGameDiagnostic\(\{ immediate: true \}\)/);
});

test("AI coaching analyzes only human decisions in a background worker", () => {
  const dispatchSource = sourceSection("function dispatchGameCommand", "function onlineCommandSessionIsCurrent");
  const replaySource = sourceSection("function queueReplayAnalysis", "function completeAiReplay");
  const aiTurnSource = sourceSection("function scheduleAiTurn", "function cancelScheduledAiTurn");

  assert.match(dispatchSource, /aiReplay\?\.humanPlayerId === actorId[\s\S]*isStrategicAction\(resolvedCommand\)[\s\S]*!replayAnalysisWorkerUnavailable[\s\S]*typeof Worker === "function"/);
  assert.match(dispatchSource, /if \(result\?\.ok && game\.phase === "complete"\) completeAiReplay\(\)/);
  assert.match(replaySource, /actorId !== replay\.humanPlayerId/);
  assert.match(replaySource, /!isStrategicAction\(command\)/);
  assert.match(replaySource, /new Worker\(new URL\("\.\/ai\/replay-worker\.mjs"/);
  assert.match(replaySource, /stateAlreadyCloned: true/);
  assert.match(replaySource, /watchdog = window\.setTimeout/);
  assert.match(replaySource, /sort\(\(left, right\) => left\.order - right\.order\)/);
  assert.doesNotMatch(replaySource, /analyzeReplayDecisionPayload\(/);
  assert.match(aiTurnSource, /if \(game\.phase === "complete"\) completeAiReplay\(\)/);
  assert.doesNotMatch(aiTurnSource, /cloneGame\(game\)|queueReplayAnalysis\(/);
});

test("AI gameplay enumerates policy actions and payment plans outside the UI thread", () => {
  const aiTurnSource = sourceSection("function scheduleAiTurn", "function isOnlineGame");
  const requestSource = sourceSection("function requestAiTurnDecision", "function configureAiTurnWorkerNeural");
  const cancelSource = sourceSection("function cancelScheduledAiTurn", "function isOnlineGame");

  assert.match(aiTurnSource, /requestAiTurnDecision\(/);
  assert.match(aiTurnSource, /new Worker\(new URL\("\.\/ai\/turn-worker\.mjs"/);
  assert.match(aiTurnSource, /worker\.postMessage\(createAiTurnWorkerRequest/);
  assert.match(aiTurnSource, /disposeAiTurnWorker/);
  assert.match(aiTurnSource, /configureAiTurnWorkerNeural/);
  assert.match(aiTurnWorkerSource, /neuralSession\.decideEncoded/);
  assert.doesNotMatch(aiTurnSource, /neuralAiSession|decideEncoded|inferStep\s*\(/);
  assert.doesNotMatch(aiTurnSource, /enumerateAiPolicyActions\s*\(|resolvePlannedPayment\s*\(|choosePolicyAction\s*\(/);
  assert.match(requestSource, /AI_TURN_DECISION_TIMEOUT_MS/);
  assert.match(cancelSource, /if \(pending\)[\s\S]*resetAiTurnWorkerSession\(\)/);
});

test("completed AI replays finalize before pending analysis is cancelled or a new game starts", () => {
  const settleSource = sourceSection("function settleReplayAnalysesWithoutCoaching", "function finishReplayAnalysisUpdate");
  const persistenceSource = sourceSection("function persistCurrentAiReplay", "function completeAiReplay");
  const completeSource = sourceSection("function completeAiReplay", "function scheduleAiTurn");
  const freshGameSource = sourceSection("function startFreshLocalGame", "function startGameFromMenu");
  const exitSource = sourceSection("function exitCompletedGame", "function updateGamePresentation");

  assert.match(settleSource, /pending\.gameBefore = null/);
  assert.match(settleSource, /drainReplayAnalysisResults\(replay\)/);
  assert.match(settleSource, /completeAiReplay\(\)/);
  assert.match(freshGameSource, /settleReplayAnalysesWithoutCoaching\(aiReplay\)/);
  assert.match(freshGameSource, /aiReplay = createAiReplay\(game/);
  assert.match(exitSource, /settleReplayAnalysesWithoutCoaching\(aiReplay\)/);
  assert.match(persistenceSource, /state\.savedReport === requestedReport/);
  assert.match(persistenceSource, /state\.promise\.catch\(\(\) => false\)\.then\(\(\) => persistCurrentAiReplay\(replay\)\)/);
  assert.match(completeSource, /persistCurrentAiReplay\(replay\)\.catch/);
});

test("local commands canonicalize without replaying the engine on a clone", () => {
  const resolverSource = sourceSection("function resolveCurrentGameCommand", "function queueReplayAnalysis");

  assert.match(resolverSource, /canonicalizeActionCommand\(game, command, actorId\)/);
  assert.doesNotMatch(resolverSource, /resolveLegalAction\(game, command, actorId\)/);
});

test("focus restoration measures only the matching control", () => {
  const restoreSource = sourceSection("function restoreFocusState", "function topUiModal");

  assert.match(restoreSource, /candidates\.find\(\(node\) => focusStateMatches\(node, state\)\)/);
  assert.match(restoreSource, /elementCanReceiveFocus\(candidate\)/);
  assert.doesNotMatch(restoreSource, /focusableElements\(scope\)/);
});

test("online rendering waits for animation completion without frame polling", () => {
  const waitSource = sourceSection("function renderAfterTabletopFlights", "function resolveCurrentGameCommand");

  assert.match(waitSource, /Promise\.allSettled/);
  assert.match(waitSource, /animation\.finished/);
  assert.doesNotMatch(waitSource, /setTimeout\(finish,\s*32\)/);
});

test("room polling reserves its interval before a multiplayer rerender", () => {
  const refreshSource = sourceSection("async function refreshRooms", "async function connectDefaultMultiplayer");
  const connectSource = sourceSection("async function connectDefaultMultiplayer", "function connectDefaultMultiplayerOperationOwnsState");
  const releaseIndex = refreshSource.lastIndexOf("finishOnlineOperationLoading(operation)");
  const scheduleIndex = refreshSource.lastIndexOf("scheduleNextRoomRefresh();");
  const renderIndex = refreshSource.lastIndexOf("render();");

  assert.ok(releaseIndex >= 0);
  assert.ok(scheduleIndex >= 0);
  assert.ok(renderIndex >= 0);
  assert.ok(releaseIndex < scheduleIndex, "the loading guard must be released before scheduling");
  assert.ok(scheduleIndex < renderIndex, "the rerender must observe the scheduled poll timer");

  const connectReleaseIndex = connectSource.lastIndexOf("finishOnlineOperationLoading(operation)");
  const connectScheduleIndex = connectSource.lastIndexOf("scheduleNextRoomRefresh();");
  const connectRenderIndex = connectSource.lastIndexOf("render();");
  assert.ok(connectReleaseIndex < connectScheduleIndex);
  assert.ok(connectScheduleIndex < connectRenderIndex);
});

test("same-revision renders retain expensive card usability and chain-tree caches", () => {
  const renderSource = sourceSection("function render()", "const FOCUS_DATA_KEYS");
  const usableSource = sourceSection("function isUsableCard", "function canSelectForBatchMove");
  const chainSource = sourceSection("function currentChainTreeItems", "function chainPresentationItemsMatch");

  assert.doesNotMatch(renderSource, /usableCardCache\s*=\s*new WeakMap/);
  assert.match(usableSource, /usableCardCacheRevision !== gameStateRevision/);
  assert.match(usableSource, /usableCardCacheContext !== cacheContext/);
  assert.match(chainSource, /chainTreeCacheRevision === gameStateRevision/);
  assert.match(chainSource, /cacheChainTreeItems/);
});

test("foreground multiplayer operations abort an obsolete room poll", () => {
  const loadingSource = sourceSection("function beginOnlineOperationLoading", "function finishOnlineOperationLoading");

  assert.match(loadingSource, /roomRefreshController\?\.abort\(\)/);
  assert.match(loadingSource, /roomRefreshController = null/);
});
