import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const mobileSource = await readFile(new URL("../src/mobile.mjs", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../src/i18n.mjs", import.meta.url), "utf8");

test("completed games expose one guarded exit action in the result, topbar, and sideboarding views", () => {
  assert.match(appSource, /function exitCompletedGame\(\)/u);
  assert.ok((appSource.match(/data-action="exit-completed-game"/gu) || []).length >= 3);
  assert.match(appSource, /if \(!bugReportDecisionResolved\(\)\) \{[\s\S]*?resultDismissed = false;/u);
  assert.match(appSource, /forgetPersistedGameDiagnostic\(\);\s*gameDiagnostic = null;\s*if \(isOnlineGame\(\)\)/u);
  assert.match(appSource, /if \(isOnlineGame\(\)\) \{[\s\S]*?onlineLeaveRoom\(\);/u);
  assert.match(appSource, /async function onlineLeaveRoom\(\) \{[\s\S]*?closeOnlineEvents\(\);[\s\S]*?await boundedOnlineLeaveRequest\(leaveOnlineRoom/u);
  assert.match(appSource, /function boundedOnlineLeaveRequest\(request, timeoutMs = 8_000\)[\s\S]*?Promise\.race\(\[request, timeout\]\)/u);
  assert.match(appSource, /let onlineEventGeneration = 0;/u);
  assert.match(appSource, /function closeOnlineEvents\(\) \{[\s\S]*?onlineEventGeneration \+= 1;[\s\S]*?events\?\.close\(\);/u);
  assert.match(appSource, /const eventGeneration = onlineEventGeneration;[\s\S]*?open\(\) \{\s*if \(eventGeneration !== onlineEventGeneration\) return;[\s\S]*?snapshot\(snapshot\) \{\s*if \(eventGeneration !== onlineEventGeneration\) return;[\s\S]*?error\(message\) \{\s*if \(eventGeneration !== onlineEventGeneration\) return;/u);
  assert.match(appSource, /appView = "menu";[\s\S]*?resetGameUiState\(\);/u);
});

test("finished-game Back handling exits through the guarded action before the native app closes", () => {
  const completedExit = mobileSource.indexOf('clickFirst(["exit-completed-game"])');
  const nativeExit = mobileSource.indexOf("NativeApp.exitApp()");
  assert.ok(completedExit >= 0);
  assert.ok(nativeExit > completedExit);
  assert.match(appSource, /game\?\.phase === "complete" \|\| matchIsBetweenGames\(\)/u);
  assert.match(appSource, /window\.__riftboundDismissTopUiLayer = \(\) => \{[\s\S]*?exitCompletedGame\(\);[\s\S]*?return true;/u);
});

test("surrender confirmation describes the result screen instead of promising an immediate menu exit", () => {
  assert.match(i18nSource, /surrenderConfirmDetail: "현재 게임을 종료하고 결과 화면으로 이동합니다\."/u);
  assert.match(i18nSource, /surrenderConfirmDetail: "This ends the current game and opens the result screen\."/u);
});

test("online command and leave callbacks retain explicit session ownership", () => {
  assert.match(appSource, /let onlineSessionGeneration = 0;/u);
  assert.match(appSource, /function invalidateOnlineSession\(\) \{[\s\S]*?onlineSessionGeneration \+= 1;[\s\S]*?online\.commandPending = null;/u);
  assert.match(appSource, /const commandSession = \{[\s\S]*?generation: onlineSessionGeneration,[\s\S]*?roomId: online\.roomId,[\s\S]*?playerToken: online\.playerToken,[\s\S]*?diagnosticRecorder: gameDiagnostic/u);
  assert.match(appSource, /onlineCommandSessionIsCurrent\(commandSession\)[\s\S]*?gameDiagnostic !== commandSession\.diagnosticRecorder/u);
  assert.match(appSource, /online\.commandPending !== commandPending\) return;[\s\S]*?online\.commandPending = null;/u);
  assert.match(appSource, /const commandPending = \{[\s\S]*?diagnosticIdentityCaptured: commandSession\.diagnosticIdentityCaptured,[\s\S]*?diagnosticGameId: commandSession\.diagnosticGameId,[\s\S]*?gameNumber: commandSession\.gameNumber/u);
  assert.match(appSource, /const descriptor = onlineDiagnosticDescriptor\(snapshot\);\s*retireOnlineCommandPendingForDescriptor\(descriptor\);/u);
  assert.match(appSource, /function retireOnlineCommandPendingForDescriptor\(descriptor\)[\s\S]*?onlineDiagnosticIdentityMatchesDescriptor\(pending, descriptor\)[\s\S]*?online\.commandPending = null;/u);
  assert.doesNotMatch(appSource, /resolvedCommand\.kind === "restartGame"\) onlineDiagnosticGameKey = ""/u);
  assert.match(appSource, /onlineLeaveOperation\.departureGeneration === onlineSessionGeneration[\s\S]*?return onlineLeaveOperation\.promise;/u);
  assert.match(appSource, /stillLeavingCapturedSeat = onlineSessionGeneration === departureGeneration[\s\S]*?if \(!stillLeavingCapturedSeat\) return;[\s\S]*?clearOnlineSeat\(\);/u);
  assert.match(appSource, /const owner = emergencyStopState === "failed"[\s\S]*?generation: onlineSessionGeneration,[\s\S]*?playerToken: online\.playerToken,[\s\S]*?diagnosticRecorder: gameDiagnostic,[\s\S]*?const operation = \{\s*id: \+\+emergencyStopOperationSequence,\s*\.\.\.owner,\s*owner,/u);
  assert.match(appSource, /if \(!emergencyStopOperationIsCurrent\(operation\)\) return;[\s\S]*?operation\.diagnosticRecorder\?\.recordCommand/u);
  assert.match(appSource, /let emergencyStopOwner = null;/u);
  assert.match(appSource, /function confirmEmergencyOnlineStopFromSnapshot\(owner, descriptor, stateAlreadyRecorded\) \{\s*if \(!emergencyStopOwnerIsCurrent\(owner\)\s*\|\| !onlineDiagnosticIdentityMatchesDescriptor\(owner, descriptor\)\) return false;/u);
  assert.doesNotMatch(appSource, /function confirmEmergencyOnlineStopFromSnapshot\([^)]*=/u);
  assert.match(appSource, /function retireEmergencyOnlineStopOwner\(reason\)[\s\S]*?emergencyStopOwner = null;[\s\S]*?sessionInvalidatedBeforeConfirmation: reason === "session-invalidated"[\s\S]*?diagnosticChangedBeforeConfirmation: reason === "diagnostic-changed"/u);
  assert.match(appSource, /bugReportUi\.recovered = preservesCurrentRecorder && !bugReportDecisionResolved\(\);\s*if \(bugReportUi\.recovered\) appView = "menu";/u);
  assert.match(appSource, /const emergencyOwner = emergencyStopOwner;[\s\S]*?onlineDiagnosticIdentityMatchesDescriptor\(emergencyOwner, descriptor\)[\s\S]*?const diagnosticStateRecorded = recordDiagnosticOnlineSnapshot\(snapshot, \{ deferFinalization: true \}\);[\s\S]*?confirmEmergencyOnlineStopFromSnapshot\(emergencyOwner, descriptor, diagnosticStateRecorded\)/u);
  assert.match(appSource, /onlineSeatRequestOperation !== operation\) return;[\s\S]*?applyOnlineSeatResult\(result\);/u);
  assert.match(appSource, /function runOnlineRoomMutation\(kind, request\)[\s\S]*?generation: onlineSessionGeneration,[\s\S]*?onlineRoomMutationOperationIsCurrent\(operation\)/u);
});

test("recovered online diagnostics gate navigation and retain mismatched complete snapshots", () => {
  assert.match(appSource, /else if \(!diagnosticMatchesOnlineDescriptor\(restoredLog, descriptor\)\) \{\s*stagePendingOnlineDiagnostic\(snapshot, descriptor\);/u);
  assert.doesNotMatch(appSource, /!diagnosticMatchesOnlineDescriptor\(restoredLog, descriptor\) && game\.phase !== "complete"/u);
  assert.match(appSource, /let onlineDiagnosticRecoveryInProgress = Boolean\(gameDiagnostic && restoredGameDiagnosticCanResume\);/u);
  assert.match(appSource, /function diagnosticNavigationBlocked\(\)[\s\S]*?onlineDiagnosticRecoveryInProgress[\s\S]*?currentDiagnosticSnapshot\(\)\?\.finalization && !bugReportDecisionResolved\(\)/u);
  assert.match(appSource, /onlineDiagnosticRecoveryInProgress[\s\S]*?!diagnosticMatchesOnlineDescriptor\(restoredLog, descriptor\)[\s\S]*?failRestoredOnlineDiagnosticRecovery\([\s\S]*?stagePendingOnlineDiagnostic\(snapshot, descriptor\)/u);
  assert.match(appSource, /function resetStaleOnlineSeat\(message\)[\s\S]*?failRestoredOnlineDiagnosticRecovery\([\s\S]*?bugReportUi\.recovered = true;[\s\S]*?appView = recoveredDiagnosticFailed \|\| diagnosticNavigationBlocked\(\) \? "menu" : "multiplayer";/u);
  for (const action of ["online-create", "online-join-room", "online-join-code", "online-submit-deck", "online-ready"]) {
    assert.match(appSource, new RegExp(`diagnosticNavigationBlocked\\(\\)[\\s\\S]*?"${action}"`, "u"));
  }
  for (const functionName of [
    "startGameFromMenu", "startAiGameFromMenu", "onlineCreateRoom", "onlineJoinRoom",
    "onlineSubmitDeck", "onlineReady", "runOnlineRoomMutation"
  ]) {
    assert.match(
      appSource,
      new RegExp(`(?:async )?function ${functionName}\\([^)]*\\) \\{\\s*if \\(diagnosticNavigationBlocked\\(\\)`, "u")
    );
  }
  assert.match(appSource, /function retireTutorialDiagnosticForTransition\(\)[\s\S]*?metadata\?\.mode !== "tutorial"[\s\S]*?GAME_REPRODUCTION_END_REASONS\.NORMAL[\s\S]*?clearGameDiagnosticReloadMarker\(\);\s*forgetPersistedGameDiagnostic\(\);\s*gameDiagnostic = null;/u);
  assert.match(appSource, /function startTutorial\([^)]*\) \{\s*retireTutorialDiagnosticForTransition\(\);\s*if \(diagnosticNavigationBlocked\(\)\) return;/u);
  assert.match(appSource, /function exitTutorial\(\) \{\s*retireTutorialDiagnosticForTransition\(\);\s*if \(diagnosticNavigationBlocked\(\)\) return;/u);
  assert.match(appSource, /function connectDefaultMultiplayer\(\) \{\s*if \(diagnosticNavigationBlocked\(\) \|\| !bugReportDecisionResolved\(\)/u);
  assert.match(appSource, /data-action="diagnostic-recovery-abandon"/u);
  assert.match(appSource, /function abandonRestoredOnlineDiagnosticRecovery\(\)[\s\S]*?recoveryFailure: "connection-unavailable"[\s\S]*?invalidateOnlineSession\(\);\s*closeOnlineEvents\(\);/u);
  assert.match(appSource, /if \(logDiagnosticGameId \|\| descriptorDiagnosticGameId\) \{\s*return Boolean\(logDiagnosticGameId\)[\s\S]*?&& logDiagnosticGameId === descriptorDiagnosticGameId;/u);
  assert.match(appSource, /const logGameNumber = Number\(metadata\.gameNumber\);[\s\S]*?Number\.isInteger\(logGameNumber\)[\s\S]*?logGameNumber > 0[\s\S]*?logGameNumber === descriptorGameNumber;/u);
  assert.match(appSource, /function saveOnlineSeat\(\)[\s\S]*?diagnosticGameId: online\.diagnosticGameId \|\| null,[\s\S]*?gameNumber: online\.gameNumber \|\| null/u);
  assert.match(appSource, /online\.room = snapshot\.room;[\s\S]*?online\.diagnosticGameId = String\([\s\S]*?snapshotGameNumber[\s\S]*?saveOnlineSeat\(\);/u);
});

test("online surrender and delayed multiplayer operations retain exact game ownership", () => {
  assert.match(appSource, /function guardedOnlineSurrenderCommand\(command, identity\)[\s\S]*?diagnosticIdentityCaptured !== true[\s\S]*?expectedDiagnosticGameId[\s\S]*?expectedGameNumber/u);
  assert.match(appSource, /command: guardedOnlineSurrenderCommand\([\s\S]*?sendOnlineCommand\(operation\.roomId, operation\.playerToken, operation\.command\)/u);
  assert.match(appSource, /const resolvedCommand = command\.kind === "surrender"\s*\? guardedOnlineSurrenderCommand\(command, commandSession\)/u);
  assert.doesNotMatch(appSource, /catch \(stopError\)[\s\S]{0,350}game\?\.phase === "complete"/u);
  assert.match(appSource, /kind: "connect-default",[\s\S]*?generation: onlineSessionGeneration,[\s\S]*?diagnosticRecorder: gameDiagnostic,[\s\S]*?startView: appView/u);
  assert.match(appSource, /finally \{[\s\S]*?if \(onlineRefreshOperation === operation\) onlineRefreshOperation = null;\s*const releasedLoading = finishOnlineOperationLoading\(operation\);/u);
});

test("UI-error reloads cannot be marked as ordinary resumable navigation", () => {
  assert.match(appSource, /function markResumableOnlineReload\(\) \{\s*if \(onlineDiagnosticRecoveryInProgress\s*\|\| emergencyReportActive\s*\|\| \["stopping", "failed"\]\.includes\(emergencyStopState\)\) \{\s*clearGameDiagnosticReloadMarker\(\);\s*return;/u);
  assert.match(appSource, /emergencyReportActive = true;\s*clearGameDiagnosticReloadMarker\(\);/u);
});

test("resolved report decisions cannot be repersisted by later UI breadcrumbs", () => {
  assert.match(appSource, /function persistGameDiagnostic\(\{ immediate = false \} = \{\}\) \{\s*if \(!gameDiagnostic\) return false;\s*if \(\["submitted", "declined"\]\.includes\(bugReportUi\.choice\)\) \{\s*forgetPersistedGameDiagnostic\(\);\s*return true;/u);
  assert.match(appSource, /function reopenResolvedBugReportAfterUiError\(\)[\s\S]*?bugReportUi = createBugReportUiState\(false\);/u);
});
