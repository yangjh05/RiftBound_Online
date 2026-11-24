import { expect, test } from "@playwright/test";

const GAME_LOG_KEY = "riftbound.gameDiagnostic.v1";
const ONLINE_SEAT_KEY = "riftbound.onlineSeat.v1";

async function openLocalApp(page) {
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
}

async function surrenderCurrentGame(page) {
  await page.locator('[data-action="surrender"]').click();
  await page.locator('.game-exit-modal [data-action="confirm-game-exit"]').click();
}

async function openLocalMultiplayer(page) {
  await page.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await page.locator('[data-action="menu-multiplayer"]').click();
  await expect(page.locator('[data-action="online-create"]')).toBeVisible();
}

async function roomCode(page) {
  const roomPanel = page.locator(".multiplayer-panel").filter({
    has: page.locator('[data-action="online-leave"]')
  });
  const heading = await roomPanel.locator("h2").textContent();
  const match = String(heading).match(/\b([A-Z2-9]{4})\b/u);
  expect(match, `room heading did not contain a room code: ${heading}`).not.toBeNull();
  return match[1];
}

test("a completed local game keeps a permanent route back to the main menu", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="settings-sideboarding"]').uncheck();
  await page.locator('[data-action="menu-start"]').click();
  await surrenderCurrentGame(page);

  const result = page.locator(".match-result-modal");
  await expect(result).toBeVisible();
  await expect(result.locator('[data-action="exit-completed-game"]')).toContainText(/Main menu|메인 메뉴/u);
  await expect(result.locator('[data-action="exit-completed-game"]')).toBeInViewport();

  await result.locator('[data-action="exit-completed-game"]').click();
  await expect(result).toBeVisible();
  await expect(result.locator(".game-bug-report")).toBeVisible();
  await expect(page.locator(".main-menu")).toHaveCount(0);

  await result.locator('[data-action="bug-report-decline"]').click();
  await result.locator('[data-action="review-result"]').click();
  await expect(result).toHaveCount(0);

  const permanentExit = page.locator('.tabletop-topbar [data-action="exit-completed-game"]');
  await expect(permanentExit).toBeVisible();
  await permanentExit.click();
  await expect(page.locator('.main-menu [data-action="menu-start"]')).toBeEnabled();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
});

test("declining a report cannot be resurrected by result-review breadcrumbs after reload", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await surrenderCurrentGame(page);
  const result = page.locator(".match-result-modal");
  await expect(result).toBeVisible();
  await result.locator('[data-action="bug-report-decline"]').click();
  await result.locator('[data-action="review-result"]').click();
  await expect(result).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();

  await page.reload();
  await expect(page.locator('.main-menu [data-action="menu-start"]')).toBeEnabled();
  await expect(page.locator(".main-menu .game-bug-report")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
});

test("a local best-of-three sideboarding screen can abandon the match safely", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="settings-sideboarding"]').check();
  await page.locator('[data-action="menu-start"]').click();
  await surrenderCurrentGame(page);

  const sideboarding = page.locator(".sideboarding-screen");
  const exit = sideboarding.locator('[data-action="exit-completed-game"]');
  await expect(sideboarding).toBeVisible();
  await expect(exit).toBeVisible();

  await exit.click();
  await expect(sideboarding).toBeVisible();
  await sideboarding.locator('[data-action="bug-report-decline"]').click();
  await exit.click();

  await expect(page.locator('.main-menu [data-action="menu-start"]')).toBeEnabled();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
});

test("mobile Back keeps a reviewed result inside the app and then returns to the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?presentation=result");

  const result = page.locator(".match-result-modal");
  await expect(result).toBeVisible();
  await expect(result.locator('[data-action="exit-completed-game"]')).toBeInViewport();
  expect(await page.evaluate(() => window.__riftboundDismissTopUiLayer())).toBe(true);
  await expect(result).toHaveCount(0);

  const permanentExit = page.locator('.tabletop-topbar [data-action="exit-completed-game"]');
  await expect(permanentExit).toBeVisible();
  await expect(permanentExit).toBeInViewport();
  expect(await page.evaluate(() => window.__riftboundDismissTopUiLayer())).toBe(true);
  await expect(page.locator('.main-menu [data-action="menu-start"]')).toBeEnabled();
});

test("an online result can return to the multiplayer lobby after battlefield review", async ({ browser }) => {
  test.setTimeout(70_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let releaseHeldLeave = null;

  try {
    await openLocalMultiplayer(host);
    await host.locator('[data-action="online-create"]').click();
    const code = await roomCode(host);

    await openLocalMultiplayer(guest);
    await guest.locator('[data-action="online-code-input"]').fill(code);
    await guest.locator('[data-action="online-join-code"]').click();
    await host.locator('[data-action="online-submit-deck"]').click();
    await guest.locator('[data-action="online-submit-deck"]').click();
    await host.locator('[data-action="online-ready"]').click();
    await guest.locator('[data-action="online-ready"]').click();

    await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
    await surrenderCurrentGame(guest);
    const result = guest.locator(".match-result-modal");
    await expect(result).toBeVisible();
    await result.locator('[data-action="bug-report-decline"]').click();
    await result.locator('[data-action="review-result"]').click();

    const permanentExit = guest.locator('.tabletop-topbar [data-action="exit-completed-game"]');
    await expect(permanentExit).toContainText(/Return to lobby|로비로 돌아가기/u);
    await guest.route("**/api/rooms/*/leave", async (route) => {
      await new Promise((resolve) => {
        releaseHeldLeave = async () => {
          await route.continue();
          resolve();
        };
      });
    });
    await guest.clock.install();
    await permanentExit.click();
    await expect.poll(() => Boolean(releaseHeldLeave)).toBe(true);
    await guest.clock.fastForward(8_100);

    await expect(guest.locator('[data-action="online-create"]')).toBeVisible();
    await expect(guest.locator('[data-action="online-leave"]')).toHaveCount(0);
    await expect.poll(() => guest.evaluate((key) => localStorage.getItem(key), ONLINE_SEAT_KEY)).toBeNull();
    await expect.poll(() => guest.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
    // A closed EventSource may already have a snapshot callback queued. Keep
    // observing beyond the first null value so a late callback cannot silently
    // resurrect the completed game's diagnostic after the lobby is visible.
    await guest.waitForTimeout(750);
    await expect.poll(() => guest.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
    await releaseHeldLeave?.();
    releaseHeldLeave = null;
    await expect(guest.locator('[data-action="online-leave"]')).toHaveCount(0);
  } finally {
    await releaseHeldLeave?.().catch(() => {});
    await hostContext.close();
    await guestContext.close();
  }
});
