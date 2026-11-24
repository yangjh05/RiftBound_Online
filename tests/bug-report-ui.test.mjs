import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const crashGuardSource = await readFile(new URL("../src/crash-guard.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mobileIndexSource = await readFile(new URL("../mobile/index.html", import.meta.url), "utf8");
const mobileSource = await readFile(new URL("../src/mobile.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("completed games expose an explicit reproduction-log choice with a required ten-character description", () => {
  assert.match(appSource, /이 경기의 재현 로그를 서버에 전송할까요/u);
  assert.match(appSource, /data-action="bug-report-decline"/u);
  assert.match(appSource, /data-action="bug-report-open"/u);
  assert.match(appSource, /data-action="bug-report-description" required minlength="10" maxlength="2000"/u);
  assert.match(appSource, /앞뒤 공백을 제외하고 최소 10자 이상/u);
  assert.match(appSource, /function gameResultModal[\s\S]*?\$\{gameBugReportPanel\(\)\}/u);
  assert.match(appSource, /function sideboardingView[\s\S]*?\$\{gameBugReportPanel\(\)\}/u);
});

test("UI failures retain a direct stop path on desktop and mobile", () => {
  assert.match(appSource, /data-ui-exception-stop/u);
  assert.match(appSource, /data-action="stop-after-ui-error"/u);
  assert.match(appSource, /async function stopGameAfterUiError/u);
  assert.match(appSource, /else dispatchGameCommand\(\{ kind: "surrender" \}, \(\) => surrender\(game, viewerPlayerId\(\)\)\)/u);
  assert.match(mobileSource, /visibleAction\("stop-after-ui-error"\)/u);
  assert.match(styles, /\.emergency-game-stop-screen/u);
  assert.match(styles, /\.game-bug-report textarea/u);
  assert.ok(indexSource.indexOf("./src/crash-guard.js") < indexSource.indexOf("./src/app.mjs"));
  assert.ok(mobileIndexSource.indexOf("../src/crash-guard.js") < mobileIndexSource.indexOf("../src/mobile.mjs"));
  assert.match(crashGuardSource, /window\.addEventListener\("error"/u);
  assert.match(crashGuardSource, /early-crash-description/u);
  assert.match(crashGuardSource, /\/api\/bug-reports/u);
});

test("diagnostics cover local commands, AI turns, online snapshots, and persisted crash recovery", () => {
  assert.match(appSource, /recordDiagnosticCommand\(resolvedCommand/u);
  assert.match(appSource, /recordDiagnosticCommand\(selected\.action/u);
  assert.match(appSource, /recordDiagnosticOnlineSnapshot\(snapshot\)/u);
  assert.match(appSource, /recordDiagnosticCommandAttempt\(resolvedCommand/u);
  assert.match(appSource, /diagnosticGameId: descriptor\.diagnosticGameId/u);
  assert.match(appSource, /await \(diagnosticServerReady \|\|= configureDiagnosticServer\(\)\)/u);
  assert.match(appSource, /restoreGameReproductionLogFromStorage/u);
  assert.match(appSource, /configureBugReportServer\(configuredBugReportServer\(clientBuildInfo\)\)/u);
});

test("failed online UI-error stops remain retryable and can be preserved locally without a false success", () => {
  assert.match(appSource, /emergencyStopState = "failed"/u);
  assert.match(appSource, /data-action="bug-report-retry-online-stop"/u);
  assert.match(appSource, /data-action="bug-report-preserve-local"/u);
  assert.match(appSource, /서버의 경기는 계속 진행 중일 수 있습니다/u);
  assert.match(appSource, /online-ui-error-stop-confirmed-by-snapshot/u);
  assert.match(appSource, /boundedUiErrorText\(value, 4096/u);
  assert.match(appSource, /return-menu-after-ui-error/u);
  assert.match(crashGuardSource, /result\.ok !== true/u);
  assert.match(crashGuardSource, /data-crash-stop-retry/u);
  assert.match(crashGuardSource, /data-crash-preserve-local/u);
  assert.match(crashGuardSource, /\[truncated\]/u);
});

test("a UI error after a resolved report decision opens a distinct follow-up report", () => {
  assert.match(appSource, /function reopenResolvedBugReportAfterUiError/u);
  assert.match(appSource, /\["submitted", "declined"\]\.includes\(bugReportUi\.choice\)/u);
  assert.match(appSource, /bug-report-follow-up-after-ui-error/u);
  assert.match(appSource, /followUpAfterUiError = true/u);
  assert.match(appSource, /A new UI error was captured\. Send an additional report\?/u);
  assert.match(appSource, /Your earlier submission or decision is unchanged/u);
});

test("main bug report submission failures become retryable after a bounded request", () => {
  assert.match(appSource, /bugReportUi\.status = "failed"/u);
  assert.match(appSource, /bugReportUi\.status === "submitting" \? "disabled" : ""/u);
  assert.match(appSource, /The log could not be sent\. Your description is preserved; please retry/u);
});

test("an in-progress new-game request resumes exactly once after the report decision", () => {
  assert.match(appSource, /function queueNewGameAfterReportDecision/u);
  assert.match(appSource, /function continuePendingPostReportActionIfReady/u);
  assert.match(appSource, /continuation\.status = "starting";\s*pendingPostReportAction = null;/u);
  assert.match(appSource, /game !== continuation\.sourceGame/u);
  assert.match(appSource, /activeLogId !== continuation\.diagnosticLogId/u);
  assert.match(appSource, /continuePendingPostReportActionIfReady\(\)/u);
  assert.match(appSource, /function startFreshLocalGame/u);
  assert.match(appSource, /startedFromPostReportContinuation: true/u);
});
