import { expect, test } from "@playwright/test";

function capturePageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openLocalApp(page) {
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
}

async function completeLocalSetup(page) {
  await page.locator('[data-action="menu-start"]').click();
  for (let step = 0; step < 20; step += 1) {
    const chooseOrder = page.locator('[data-action="choose-first-player"]:enabled');
    if (await chooseOrder.count()) {
      await chooseOrder.first().click();
      break;
    }
    const roll = page.locator('[data-action="roll-first-player"]:enabled');
    await expect(roll).toHaveCount(1);
    await roll.click();
  }
  await expect(page.locator(".champion-setup")).toBeVisible();

  for (let index = 0; index < 2; index += 1) {
    const champion = page.locator('[data-action="choose-champion"]:enabled');
    await expect(champion).toHaveCount(1);
    await champion.click();
  }

  for (let index = 0; index < 2; index += 1) {
    const battlefield = page.locator('[data-action="choose-battlefield"]:enabled');
    if (await battlefield.count() === 0) break;
    await battlefield.first().click();
  }

  for (let index = 0; index < 2; index += 1) {
    const keepHand = page.locator('[data-action="skip-mulligan"]');
    await expect(keepHand).toHaveCount(1);
    await keepHand.click();
  }

  await expect(page.locator(".board-panel")).toBeVisible();
}

async function openLocalMultiplayer(page) {
  await page.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await page.locator('[data-action="menu-multiplayer"]').click();
  await expect(page.locator('[data-action="online-create"]')).toBeVisible();
}

async function roomCode(page) {
  const currentRoomPanel = page.locator(".multiplayer-panel").filter({
    has: page.locator('[data-action="online-leave"]')
  });
  await expect(currentRoomPanel).toHaveCount(1);
  const heading = await currentRoomPanel.locator("h2").textContent();
  const match = String(heading).match(/\b([A-Z2-9]{4})\b/u);
  expect(match, `room heading did not contain a room code: ${heading}`).not.toBeNull();
  return match[1];
}

test("local game reaches the real board without a browser runtime error", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await completeLocalSetup(page);

  await expect(page.locator('[data-action="surrender"]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("mobile viewport keeps the setup and board controls inside the page", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await openLocalApp(page);
  await expect(page.locator('[data-action="menu-start"]')).toBeInViewport();
  await completeLocalSetup(page);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  await expect(page.locator('[data-action="surrender"]')).toBeInViewport();
  expect(pageErrors).toEqual([]);
});

test("crowded battlefield lanes can scroll to every unit", async ({ page }) => {
  await page.goto("/tests/fixtures/battlefield-scroll-preview.html");

  for (const testId of ["opponent-lane", "player-lane"]) {
    const lane = page.getByTestId(testId);
    const initial = await lane.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      scrollLeft: node.scrollLeft
    }));
    expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
    expect(initial.scrollLeft).toBe(0);

    await lane.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    const scrolled = await lane.evaluate((node) => node.scrollLeft);
    expect(scrolled).toBeGreaterThan(0);
  }
});

test("two isolated browser sessions can start, reconnect to, and complete an online game", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostErrors = capturePageErrors(host);
  const guestErrors = capturePageErrors(guest);

  try {
    await openLocalMultiplayer(host);
    await host.locator('[data-action="online-create"]').click();
    await expect(host.locator('[data-action="online-submit-deck"]')).toBeEnabled();
    const code = await roomCode(host);

    await openLocalMultiplayer(guest);
    await guest.locator('[data-action="online-code-input"]').fill(code);
    await guest.locator('[data-action="online-join-code"]').click();
    await expect(guest.locator('[data-action="online-submit-deck"]')).toBeEnabled();

    await host.locator('[data-action="online-submit-deck"]').click();
    await guest.locator('[data-action="online-submit-deck"]').click();
    await expect(host.locator('[data-action="online-ready"]')).toBeEnabled();
    await expect(guest.locator('[data-action="online-ready"]')).toBeEnabled();
    await host.locator('[data-action="online-ready"]').click();
    await guest.locator('[data-action="online-ready"]').click();

    await expect(host.locator(".first-player-screen")).toBeVisible();
    await expect(guest.locator(".first-player-screen")).toBeVisible();

    await expect(host.locator('[data-action="roll-first-player"]')).toBeEnabled();
    await expect(guest.locator('[data-action="roll-first-player"]')).toBeDisabled();
    await host.locator('[data-action="roll-first-player"]').click();
    await expect(guest.locator('[data-action="roll-first-player"]')).toBeEnabled();

    await guest.reload();
    await expect(guest.locator(".first-player-screen")).toBeVisible();
    expect(await roomCodeFromStorage(guest)).toBe(code);

    for (let step = 0; step < 20; step += 1) {
      const hostChoice = host.locator('[data-action="choose-first-player"]:enabled');
      const guestChoice = guest.locator('[data-action="choose-first-player"]:enabled');
      const hostRoll = host.locator('[data-action="roll-first-player"]:enabled');
      const guestRoll = guest.locator('[data-action="roll-first-player"]:enabled');
      await expect.poll(async () => (await hostChoice.count()) + (await guestChoice.count())
        + (await hostRoll.count()) + (await guestRoll.count())).toBeGreaterThan(0);
      if (await hostChoice.count()) {
        await hostChoice.first().click();
        break;
      }
      if (await guestChoice.count()) {
        await guestChoice.first().click();
        break;
      }
      if (await hostRoll.count()) await hostRoll.click();
      else await guestRoll.click();
    }
    await expect(host.locator(".champion-setup")).toBeVisible();
    await expect(guest.locator(".champion-setup")).toBeVisible();

    await guest.locator('[data-action="surrender"]').click();
    await guest.locator('[data-action="confirm-game-exit"]').click();
    await expect(host.locator('[data-action="confirm-online-result"]')).toBeVisible();
    await expect(guest.locator('[data-action="confirm-online-result"]')).toBeVisible();

    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

async function roomCodeFromStorage(page) {
  return page.evaluate(() => {
    const seat = JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1") || "null");
    return seat?.roomId || "";
  });
}
