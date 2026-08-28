import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts", "android-ui");
const adb = process.env.ADB_PATH || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe");
const endpoint = process.env.ANDROID_CDP_ENDPOINT || "http://127.0.0.1:9222";

await mkdir(artifacts, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap((context) => context.pages())[0];
assert.ok(page, "The Android WebView page was not available over CDP.");

const pageErrors = [];
const failedRequests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => failedRequests.push(`${request.url()} — ${request.failure()?.errorText || "failed"}`));

async function adbShell(...args) {
  return execFileAsync(adb, ["shell", ...args], { windowsHide: true });
}

async function hardwareBack() {
  await adbShell("input", "keyevent", "4");
  await page.waitForTimeout(500);
}

async function layout(label) {
  const report = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    visualViewportHeight: window.visualViewport?.height || window.innerHeight,
    screenHeight: window.screen.height
  }));
  assert.ok(report.scrollWidth <= report.viewportWidth + 1, `${label} has horizontal page overflow: ${JSON.stringify(report)}`);
  console.log(`${label}: ${JSON.stringify(report)}`);
  return report;
}

async function shot(name) {
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
}

async function deviceShot(name) {
  const remote = `/sdcard/${name}.png`;
  await adbShell("screencap", "-p", remote);
  await execFileAsync(adb, ["pull", remote, path.join(artifacts, `${name}.png`)], { windowsHide: true });
}

await page.locator('[data-action="menu-start"]').waitFor({ state: "visible" });
await page.selectOption('[data-action="settings-language"]', "ko");
await page.locator('[data-action="menu-start"]').waitFor({ state: "visible" });
await layout("menu-portrait");
await shot("01-menu-portrait");

await page.locator('[data-action="menu-tutorial"]').click();
await page.locator(".tutorial-menu-screen").waitFor({ state: "visible" });
assert.equal(await page.locator(".tutorial-course-card").count(), 4);
await layout("tutorial-menu-portrait");
await shot("02-tutorial-menu-portrait");
await hardwareBack();
await page.locator(".main-menu").waitFor({ state: "visible" });

await page.locator('[data-action="menu-decks"]').click();
await page.locator('[data-action="deck-select"]').first().click();
await page.locator(".deck-builder-screen.mobile-view-edit").waitFor({ state: "visible" });
const densityOutput = (await adbShell("wm", "density")).stdout;
const density = Number(densityOutput.match(/Physical density:\s*(\d+)/u)?.[1] || 420);
const inputBox = await page.locator(".deck-name-input").boundingBox();
assert.ok(inputBox, "Deck name input was not visible.");
await adbShell("settings", "put", "secure", "show_ime_with_hard_keyboard", "1");
await adbShell("input", "tap", String(Math.round((inputBox.x + inputBox.width / 2) * density / 160)), String(Math.round((inputBox.y + inputBox.height / 2) * density / 160)));
await page.waitForTimeout(800);
const keyboardLayout = await layout("deck-editor-keyboard");
assert.ok(keyboardLayout.visualViewportHeight < keyboardLayout.screenHeight - 100, "The Android soft keyboard did not resize the app viewport.");
await deviceShot("03-deck-editor-keyboard");
if (keyboardLayout.visualViewportHeight < keyboardLayout.screenHeight - 100) {
  await adbShell("input", "keyevent", "111");
  await page.waitForTimeout(300);
}
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.waitForTimeout(300);
await hardwareBack();
await page.locator(".deck-builder-screen.mobile-view-list").waitFor({ state: "visible" });
await hardwareBack();
await page.locator(".main-menu").waitFor({ state: "visible" });

await page.locator('[data-action="menu-start"]').click();
for (let step = 0; step < 20; step += 1) {
  const chooseOrder = page.locator('[data-action="choose-first-player"]:enabled');
  if (await chooseOrder.count()) {
    await chooseOrder.first().click();
    break;
  }
  const roll = page.locator('[data-action="roll-first-player"]:enabled');
  await roll.waitFor({ state: "visible" });
  await roll.click();
}
await page.locator(".champion-setup").waitFor({ state: "visible" });
for (let index = 0; index < 2; index += 1) await page.locator('[data-action="choose-champion"]:enabled').click();
for (let index = 0; index < 2; index += 1) {
  const battlefield = page.locator('[data-action="choose-battlefield"]:enabled');
  if (await battlefield.count() === 0) break;
  await battlefield.first().click();
}
for (let index = 0; index < 2; index += 1) await page.locator('[data-action="skip-mulligan"]').click();
await page.locator(".board-panel").waitFor({ state: "visible" });
await layout("board-portrait");
await shot("04-board-portrait");

await hardwareBack();
await page.locator(".game-exit-modal").waitFor({ state: "visible" });
await shot("05-hardware-back-confirmation");
await hardwareBack();
await page.locator(".game-exit-modal").waitFor({ state: "detached" });

await adbShell("settings", "put", "system", "accelerometer_rotation", "0");
await adbShell("settings", "put", "system", "user_rotation", "1");
await page.waitForFunction(() => innerWidth > innerHeight, null, { timeout: 10_000 });
await layout("board-landscape");
await shot("06-board-landscape");
await adbShell("settings", "put", "system", "user_rotation", "0");
await page.waitForFunction(() => innerHeight > innerWidth, null, { timeout: 10_000 });

await page.locator('[data-action="surrender"]').click();
await page.locator('[data-action="confirm-game-exit"]').click();
await page.locator(".main-menu").waitFor({ state: "visible" });

const neuralResponses = [];
page.on("response", (response) => {
  if (/neural-champion|model-.*\.js|tensorflow-.*\.js/u.test(response.url())) {
    neuralResponses.push({ url: response.url(), status: response.status() });
  }
});
await page.locator('[data-action="menu-ai"]').click();
await page.locator(".first-player-screen").waitFor({ state: "visible", timeout: 45_000 });
assert.ok(neuralResponses.some((item) => item.url.includes("neural-champion") && item.status === 200), `Neural checkpoint did not load: ${JSON.stringify(neuralResponses)}`);
assert.ok(neuralResponses.every((item) => item.status < 400), `A neural AI asset failed: ${JSON.stringify(neuralResponses)}`);
await layout("learning-ai-setup");
await shot("07-learning-ai-setup");

assert.deepEqual(pageErrors, [], `Android WebView page errors: ${pageErrors.join("\n")}`);
const relevantFailures = failedRequests.filter((entry) => !/cdn\.piltoverarchive|exburst\.dev/u.test(entry));
assert.deepEqual(relevantFailures, [], `Android WebView request failures: ${relevantFailures.join("\n")}`);
console.log(`Android UI smoke passed with ${neuralResponses.length} neural asset responses.`);
process.exit(0);
