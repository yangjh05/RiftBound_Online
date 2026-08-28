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

test("battlefields with the same name show their selecting player seats", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await completeLocalSetup(page);
  await page.evaluate(() => {
    const [first, second] = window.__riftboundGame.battlefields;
    second.name = first.name;
    second.cardNumber = first.cardNumber;
    window.__riftboundRender();
  });

  const names = page.locator(".battlefield-head h2");
  await expect(names).toHaveCount(2);
  expect(await names.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringContaining("P1"),
    expect.stringContaining("P2")
  ]));
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

test("trigger order confirmation stays visible with many selected triggers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await openLocalApp(page);
  await page.evaluate(() => {
    const selected = Array.from({ length: 8 }, (_, index) =>
      `<li><b>Forced trigger ${index + 1}</b><span>A long triggered effect description</span></li>`).join("");
    const options = Array.from({ length: 8 }, (_, index) => `
      <div class="choice-option-wrap trigger-order-option-wrap">
        <button type="button" class="choice-option trigger-order-option is-selected">
          <strong class="trigger-order-rank">Selected as ${index + 1}</strong>
          <span class="choice-card-name">Forced trigger ${index + 1}</span>
          <small class="trigger-order-effect">A long triggered effect description</small>
        </button>
      </div>
    `).join("");
    document.querySelector("#app").innerHTML = `
      <section class="choice-panel modal-panel trigger-order-panel">
        <div class="section-head trigger-order-head">
          <div>
            <h2>Order simultaneous triggers</h2>
            <span>8 of 8 selected</span>
            <p class="choice-instruction trigger-order-instruction">Choose the placement order.</p>
          </div>
          <div class="trigger-order-confirm">
            <button type="button" class="primary">Confirm trigger order</button>
          </div>
        </div>
        <div class="trigger-order-track">${selected}</div>
        <div class="trigger-order-selected"><strong>Chain placement order</strong><ol>${selected}</ol></div>
        <div class="choice-grid trigger-order-grid">${options}</div>
      </section>
    `;
  });

  const panel = page.locator(".trigger-order-panel");
  const confirm = page.locator(".trigger-order-confirm .primary");
  await expect(confirm).toBeVisible();
  const bounds = await page.evaluate(() => {
    const panelRect = document.querySelector(".trigger-order-panel").getBoundingClientRect();
    const confirmRect = document.querySelector(".trigger-order-confirm .primary").getBoundingClientRect();
    return {
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      confirmTop: confirmRect.top,
      confirmBottom: confirmRect.bottom
    };
  });
  expect(bounds.confirmTop).toBeGreaterThanOrEqual(bounds.panelTop);
  expect(bounds.confirmBottom).toBeLessThanOrEqual(bounds.panelBottom);
  await expect(panel).toBeVisible();
});

test("AI generation selection only enables trained AI decks", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await page.route("**/api/ai/generations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      generations: [
        { generation: 0, kind: "bundled", gamesTrained: 256, engineCompatible: true, trainingDeckIds: ["origins-sett", "proving-grounds-annie", "origins-kaisa", "proving-grounds-master-yi", "origins-leona"] },
        { generation: 6, kind: "learner", gamesTrained: 643, activeLearner: true, engineCompatible: true, trainingDeckIds: ["origins-sett", "proving-grounds-annie", "origins-kaisa", "proving-grounds-master-yi", "origins-leona"] }
      ]
    })
  }));

  await openLocalApp(page);
  const generation = page.locator('[data-action="menu-ai-generation"]');
  await expect(generation).toBeVisible();
  await expect(generation).toHaveValue("0");
  await expect(generation.locator("option")).toHaveCount(2);
  await generation.selectOption("6");
  await expect(generation).toHaveValue("6");
  await expect(page.locator('[data-action="menu-ai"]')).toBeDisabled();
  await expect(page.locator(".ai-deck-warning")).toBeVisible();

  const aiDeck = page.locator('[data-action="menu-active-deck"][data-slot="1"]');
  await aiDeck.selectOption("default-proving-grounds-lux");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await expect(page.locator('[data-action="menu-ai"]')).toBeDisabled();
  await expect(page.locator(".ai-deck-warning")).toBeVisible();

  await aiDeck.selectOption("default-origins-kaisa");
  await expect(page.locator('[data-action="menu-ai"]')).toBeEnabled();
  await expect(page.locator(".ai-deck-warning")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("the shipped browser runtime loads a trained AI model", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  const aiDeck = page.locator('[data-action="menu-active-deck"][data-slot="1"]');
  await aiDeck.selectOption("default-origins-kaisa");

  const startAi = page.locator('[data-action="menu-ai"]');
  await expect(startAi).toBeEnabled();
  await startAi.click();

  await expect(page.locator('[data-action="roll-first-player"]')).toBeVisible({ timeout: 30_000 });
  expect(pageErrors).toEqual([]);
});

test("tutorial button opens four Origins lessons and launches the first lesson", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await page.locator('[data-action="menu-tutorial"]').click();
  await expect(page.locator(".tutorial-course-card")).toHaveCount(4);
  await expect(page.locator(".tutorial-menu-header")).toContainText(/오리진|Origins/u);
  await expect(page.locator('[data-tutorial="first-victory"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="combat-damage"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="spell-targeting"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="energy-and-power"]')).toBeVisible();

  await page.locator('[data-tutorial="first-victory"]').click();
  await expect(page.locator(".tutorial-panel")).toBeVisible();
  const originsState = await page.evaluate(() => ({
    tutorialId: window.__riftboundGame.tutorial.id,
    legendNumbers: window.__riftboundGame.players.map((player) => player.legend.cardNumber),
    deckIsOrigins: window.__riftboundGame.players.every((player) =>
      player.mainDeck.every((card) => /^(?:OGN|OGS)-/u.test(card.cardNumber)))
  }));
  expect(originsState).toEqual({
    tutorialId: "first-victory",
    legendNumbers: ["OGN-261/298", "OGN-299/298"],
    deckIsOrigins: true
  });

  await page.locator('[data-action="tutorial-exit"]').click();
  await expect(page.locator(".tutorial-course-card")).toHaveCount(4);
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
