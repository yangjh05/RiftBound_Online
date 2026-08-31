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

async function clickFirstEnabledAcross(pages, selector) {
  await expect.poll(async () => {
    const counts = await Promise.all(pages.map((page) => page.locator(`${selector}:enabled`).count()));
    return counts.reduce((sum, count) => sum + count, 0);
  }).toBeGreaterThan(0);
  for (const page of pages) {
    const enabled = page.locator(`${selector}:enabled`);
    if (await enabled.count()) {
      await enabled.first().click();
      return page;
    }
  }
  throw new Error(`No enabled ${selector} control was found`);
}

test("local game reaches the real board without a browser runtime error", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await completeLocalSetup(page);

  await expect(page.locator('[data-action="surrender"]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Frigid Touch and Long Sword chain rendering tolerates a serialized empty effect entry", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await page.locator('[data-action="settings-language"]').selectOption("ko");
  await completeLocalSetup(page);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const opponent = game.players[1];
    const makeChainCard = (instanceId, cardNumber, name, type, keywords, effects) => ({
      id: cardNumber,
      cardNumber,
      instanceId,
      ownerId: opponent.id,
      controllerId: opponent.id,
      name,
      type,
      tags: type === "gear" ? ["Equipment"] : [],
      keywords,
      effects
    });
    const longSword = makeChainCard(
      "frigid-touch-regression-long-sword",
      "SFD-022/221",
      "Long Sword",
      "gear",
      ["Quick-Draw", "Equip"],
      [null, { timing: "activated", kind: "equip" }]
    );
    const frigidTouch = makeChainCard(
      "frigid-touch-regression-spell",
      "SFD-066/221",
      "Frigid Touch",
      "spell",
      ["Reaction", "Repeat"],
      [null, { timing: "spell", kind: "modifyMight", amount: -2, temporary: true }]
    );
    game.phase = "showdown";
    game.actionChain = null;
    game.showdown = {
      battlefieldId: game.battlefields[0].instanceId,
      turnPlayerId: game.players[0].id,
      attackerId: game.players[0].id,
      defenderId: opponent.id,
      focusPlayerId: game.players[0].id,
      chainSequence: 2,
      chainOpenedBy: "card",
      priorityPlayerId: game.players[0].id,
      consecutivePasses: 0,
      chain: [
        { id: "chain-1", itemType: "card", card: longSword, playerId: opponent.id, status: "finalized" },
        { id: "chain-2", itemType: "card", card: frigidTouch, playerId: opponent.id, status: "finalized" }
      ]
    };
    window.__riftboundRender();
  });

  await expect(page.locator(".chain-zone-item")).toHaveCount(2);
  await expect(page.locator(".chain-zone-item").filter({ hasText: "혹한의 손길" })).toHaveCount(1);
  await expect(page.locator(".chain-zone-item").filter({ hasText: "롱소드" })).toHaveCount(1);
  await expect(page.locator(".ui-exception-banner")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("every registered card renders its Korean library, detail, and full-card views", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openLocalApp(page);

  const audit = await page.evaluate(() => {
    const numbers = window.__riftboundCardRenderAuditNumbers();
    const failures = [];
    for (const number of numbers) {
      const rendered = window.__riftboundCardRenderAudit(number);
      if (!rendered) {
        failures.push(`${number}: no render result`);
        continue;
      }
      const host = document.createElement("div");
      host.innerHTML = `${rendered.libraryHtml}${rendered.detailHtml}${rendered.modalHtml}`;
      const library = host.querySelector(".library-card");
      const detail = host.querySelector(".deck-preview-card");
      const modal = host.querySelector(".full-card-modal");
      const badMarkup = /undefined|\[object Object\]|NaN/u.test(host.innerHTML);
      if (!library || library.dataset.cardNumber !== number) failures.push(`${number}: library card`);
      if (library?.querySelector("strong")?.textContent?.trim() !== rendered.name.trim()) failures.push(`${number}: library name`);
      if (!detail || detail.querySelector("h2")?.textContent?.trim() !== rendered.name.trim()) failures.push(`${number}: detail name`);
      if (detail?.querySelector("p")?.textContent?.trim() !== rendered.text.trim()) failures.push(`${number}: detail text`);
      if (!detail?.querySelector(".deck-detail-actions button")) failures.push(`${number}: detail action`);
      if (!modal || modal.querySelector("h2")?.textContent?.trim() !== rendered.name.trim()) failures.push(`${number}: modal name`);
      if (modal?.querySelector(".full-card-copy > p")?.textContent?.trim() !== rendered.text.trim()) failures.push(`${number}: modal text`);
      if (rendered.image && [...host.querySelectorAll("img")].some((image) => !image.alt.trim())) failures.push(`${number}: image alt`);
      if (!rendered.name.trim() || !rendered.type.trim() || badMarkup) failures.push(`${number}: localized render contract`);
    }
    return { count: numbers.length, failures };
  });

  expect(audit.count).toBe(989);
  expect(audit.failures).toEqual([]);
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

test("sign-up stores a modified default as an account deck and login restores it", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  let serverDeckStore = { decks: [], activeDeckIds: [] };
  const user = { id: "e2e-account-user", accountId: "deckkeeper", createdAt: Date.now() };

  await page.route("**/api/auth/signup", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, token: "e2e-token", user, deckStore: serverDeckStore })
  }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, token: "e2e-token-2", user, deckStore: serverDeckStore })
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true })
  }));
  await page.route("**/api/account/decks", async (route) => {
    if (route.request().method() === "PUT") {
      serverDeckStore = route.request().postDataJSON().deckStore;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, deckStore: serverDeckStore })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, deckStore: serverDeckStore })
    });
  });

  await openLocalApp(page);
  await page.locator('[data-action="auth-mode"][data-mode="signup"]').click();
  await page.locator('[data-action="auth-account-id"]').fill("deckkeeper");
  await page.locator('[data-action="auth-password"]').fill("password-123");
  await page.locator('[data-action="auth-password-confirm"]').fill("password-123");
  await page.locator('[data-action="auth-submit"]').click();
  await expect(page.locator(".account-panel.signed-in")).toContainText("deckkeeper");

  await page.locator('[data-action="menu-decks"]').click();
  await page.locator('.deck-slot[data-deck^="default-"]').first().click();
  await expect(page.locator(".deck-owner-badge.default")).toBeVisible();
  await page.locator('[data-action="deck-name"]').fill("계정에 저장된 덱");
  await page.locator('[data-action="deck-save"]').click();
  await expect(page.locator(".deck-owner-badge.personal")).toBeVisible();
  await expect.poll(() => serverDeckStore.decks.some((deck) => deck.name === "계정에 저장된 덱")).toBe(true);
  expect(serverDeckStore.decks.some((deck) => deck.id.startsWith("default-"))).toBe(false);

  await page.locator('[data-action="menu-home"]').click();
  await page.locator('[data-action="auth-logout"]').click();
  await expect(page.locator(".account-panel.signed-out")).toBeVisible();
  await page.locator('[data-action="auth-account-id"]').fill("deckkeeper");
  await page.locator('[data-action="auth-password"]').fill("password-123");
  await page.locator('[data-action="auth-submit"]').click();
  await expect(page.locator(".account-panel.signed-in")).toContainText("deckkeeper");
  await expect(page.locator('[data-action="menu-active-deck"][data-slot="0"]')).toContainText("계정에 저장된 덱");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="menu-decks"]').click();
  const restoredDeck = page.locator('.deck-slot[data-deck^="deck-"]').filter({ hasText: "계정에 저장된 덱" });
  await expect(restoredDeck).toHaveCount(1);
  await restoredDeck.click();
  await expect(page.locator('[data-action="deck-delete-request"]')).toBeVisible();
  await page.locator('[data-action="deck-delete-request"]').click();
  await expect(page.locator(".deck-delete-dialog")).toContainText("계정에 저장된 덱");
  await page.locator('[data-action="deck-delete-cancel"]').click();
  await expect(page.locator(".deck-delete-dialog")).toHaveCount(0);

  await page.locator('[data-action="deck-delete-request"]').click();
  await page.locator('[data-action="deck-delete-confirm"]').click();
  await expect(restoredDeck).toHaveCount(0);
  await expect(page.locator(".deck-owner-badge.default")).toBeVisible();
  await expect(page.locator('[data-action="deck-delete-request"]')).toHaveCount(0);
  await expect.poll(() => serverDeckStore.decks.some((deck) => deck.name === "계정에 저장된 덱")).toBe(false);
  expect(serverDeckStore.activeDeckIds.every((id) => id.startsWith("default-"))).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-action="menu-home"]').click();
  await page.locator('[data-action="auth-logout"]').click();
  await page.locator('[data-action="auth-account-id"]').fill("deckkeeper");
  await page.locator('[data-action="auth-password"]').fill("password-123");
  await page.locator('[data-action="auth-submit"]').click();
  await page.locator('[data-action="menu-decks"]').click();
  await expect(page.locator('.deck-slot[data-deck^="deck-"]').filter({ hasText: "계정에 저장된 덱" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("deck builder copies exported text and imports pasted text as a new deck", async ({ page, context }) => {
  const pageErrors = capturePageErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLocalApp(page);
  await page.locator('[data-action="menu-decks"]').click();

  await page.locator('[data-action="deck-export-open"]').click();
  const exportField = page.locator('textarea[data-action="deck-transfer-text"]');
  await expect(exportField).toBeVisible();
  await expect(exportField).toHaveAttribute("readonly", "");
  const exported = await exportField.inputValue();
  expect(exported).toMatch(/^Legend:\n1 .+\n\nChampion:\n1 .+\n\nMainDeck:/u);
  expect(exported).toContain("\n\nBattlefields:\n");
  expect(exported).toContain("\n\nRune Pool:\n");
  expect(exported).toContain("\n\nSideboard:\n");
  await page.locator('[data-action="deck-export-copy"]').click();
  await expect(page.locator(".deck-transfer-message.success")).toContainText("Copied all deck text");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/gu, "\n")).toBe(exported.replace(/\r\n/gu, "\n"));
  await page.locator('[data-action="deck-transfer-close"]').last().click();

  await page.locator('[data-action="deck-import-open"]').click();
  const importField = page.locator('textarea[data-action="deck-transfer-text"]');
  await importField.fill(exported);
  await page.locator('[data-action="deck-import-confirm"]').click();

  await expect(page.locator('[data-action="deck-name"]')).toHaveValue(/ Deck$/u);
  await expect(page.locator(".deck-transfer-notice.success")).toContainText("Created a new deck");
  await expect(page.locator(".main-deck-block .deck-zone-title span")).toHaveText("40/40");
  expect(pageErrors).toEqual([]);
});

test("a battlefield token added during play appears as an accessible third battlefield", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalApp(page);
  await completeLocalSetup(page);
  await page.evaluate(() => {
    const template = window.__riftboundGame.battlefields[0];
    window.__riftboundGame.battlefields.push({
      ...structuredClone(template),
      id: "BARON-PIT",
      cardNumber: "TOKEN-BARON-PIT",
      collectorNumber: "TOKEN-BARON-PIT",
      instanceId: "e2e-baron-pit",
      name: "Baron Pit",
      units: [],
      hidden: [],
      controlledBy: null,
      contestedBy: null,
      isToken: true,
      translations: {
        ko: {
          name: "내셔 남작 둥지",
          text: "유닛은 어디서든 이곳으로 이동할 수 있습니다."
        }
      }
    });
    window.__riftboundRender();
  });

  const fields = page.locator(".battlefield.location-column");
  await expect(fields).toHaveCount(3);
  const pit = page.locator('[data-card-id="e2e-baron-pit"]');
  await expect(pit).toBeVisible();
  await expect(pit.locator(".battlefield-head h2")).toHaveText("Baron Pit");
  const scrollState = await page.locator(".location-band").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
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

test("mobile choice modal keeps its header visible and every long-list option reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await openLocalApp(page);
  await page.evaluate(() => {
    const options = Array.from({ length: 24 }, (_, index) => `
      <div class="choice-option-wrap">
        <button type="button" class="choice-option text-choice-option" data-long-choice="${index + 1}">
          <span>Vendetta option ${index + 1} with a descriptive label</span>
        </button>
      </div>
    `).join("");
    document.querySelector("#app").innerHTML = `
      <section class="choice-panel modal-panel">
        <div class="section-head"><div><h2>Choose a Vendetta target</h2><span>Choose one card</span></div></div>
        <label class="choice-search"><span>Search choices</span><input value="" /></label>
        <div class="choice-grid">${options}</div>
      </section>
    `;
  });

  const panel = page.locator(".choice-panel");
  const grid = page.locator(".choice-grid");
  const last = page.locator('[data-long-choice="24"]');
  await expect(panel.locator("h2")).toBeInViewport();
  const initial = await grid.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
  expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
  await grid.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await expect(last).toBeInViewport();
  const bounds = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
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

test("official best-of-three UI follows first-game and prior-loser setup order", async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostErrors = capturePageErrors(host);
  const guestErrors = capturePageErrors(guest);
  const pages = [host, guest];

  try {
    await host.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
    await host.goto("/");
    await host.locator('[data-action="settings-sideboarding"]').check();
    await host.locator('[data-action="menu-multiplayer"]').click();
    await host.locator('[data-action="online-create"]').click();
    const code = await roomCode(host);

    await openLocalMultiplayer(guest);
    await guest.locator('[data-action="online-code-input"]').fill(code);
    await guest.locator('[data-action="online-join-code"]').click();
    await host.locator('[data-action="online-submit-deck"]').click();
    await guest.locator('[data-action="online-submit-deck"]').click();
    await host.locator('[data-action="online-ready"]').click();
    await guest.locator('[data-action="online-ready"]').click();

    await expect(host.locator(".champion-setup")).toBeVisible();
    await expect(guest.locator(".champion-setup")).toBeVisible();
    await expect(host.locator(".first-player-screen")).toHaveCount(0);
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-champion"]');
    }
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-battlefield"]');
    }

    await expect(host.locator(".first-player-screen")).toBeVisible();
    await expect(guest.locator(".first-player-screen")).toBeVisible();
    const beforePlayOrder = await host.evaluate(() => ({
      phase: window.__riftboundGame.phase,
      battlefieldCount: window.__riftboundGame.battlefields.length,
      handCounts: window.__riftboundGame.players.map((player) => player.hand.length),
      method: window.__riftboundGame.firstPlayerDecision?.method
    }));
    expect(beforePlayOrder).toEqual({
      phase: "first-player",
      battlefieldCount: 2,
      handCounts: [0, 0],
      method: "roll"
    });

    let chosePlayOrder = false;
    for (let step = 0; step < 30; step += 1) {
      const beforeDecision = await host.evaluate(() => JSON.stringify({
        phase: window.__riftboundGame.phase,
        decision: window.__riftboundGame.firstPlayerDecision
      }));
      await clickFirstEnabledAcross(
        pages,
        ':is([data-action="choose-first-player"], [data-action="roll-first-player"])'
      );
      await expect.poll(async () => host.evaluate(() => JSON.stringify({
        phase: window.__riftboundGame.phase,
        decision: window.__riftboundGame.firstPlayerDecision
      }))).not.toBe(beforeDecision);
      if (await host.evaluate(() => window.__riftboundGame.phase === "mulligan")) {
        chosePlayOrder = true;
        break;
      }
    }
    expect(chosePlayOrder).toBe(true);

    await expect(host.locator(".mulligan")).toBeVisible();
    await expect(guest.locator(".mulligan")).toBeVisible();
    const opening = await host.evaluate(() => ({
      phase: window.__riftboundGame.phase,
      firstPlayerId: window.__riftboundGame.firstPlayerId,
      mulliganPlayerId: window.__riftboundGame.mulligan?.playerId,
      handCounts: window.__riftboundGame.players.map((player) => player.hand.length)
    }));
    expect(opening.phase).toBe("mulligan");
    expect(opening.mulliganPlayerId).toBe(opening.firstPlayerId);
    expect(opening.handCounts).toEqual([4, 4]);

    const firstMulliganPage = await clickFirstEnabledAcross(pages, '[data-action="skip-mulligan"]');
    const firstSeat = await firstMulliganPage.evaluate(() => JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1") || "null")?.playerId);
    expect(firstSeat).toBe(opening.firstPlayerId);
    await clickFirstEnabledAcross(pages, '[data-action="skip-mulligan"]');
    await expect(host.locator(".board-panel")).toBeVisible();
    await expect(guest.locator(".board-panel")).toBeVisible();
    expect(await host.evaluate(() => window.__riftboundGame.currentPlayerId)).toBe(opening.firstPlayerId);

    const usedBattlefields = await host.evaluate(() => Object.fromEntries(
      window.__riftboundGame.battlefields.map((field) => [field.ownerId, field.cardNumber])
    ));
    const guestSeat = await guest.evaluate(() => JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1") || "null")?.playerId);
    await guest.locator('[data-action="surrender"]').click();
    await guest.locator('[data-action="confirm-game-exit"]').click();
    await expect(host.locator(".sideboarding-screen")).toBeVisible();
    await expect(guest.locator(".sideboarding-screen")).toBeVisible();
    await host.locator('[data-action="sideboard-submit"]').click();
    await guest.locator('[data-action="sideboard-submit"]').click();

    await expect(host.locator(".champion-setup")).toBeVisible();
    await expect(guest.locator(".champion-setup")).toBeVisible();
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-champion"]');
    }
    await expect.poll(async () => host.evaluate(() => window.__riftboundGame.phase)).toBe("battlefield-select");
    const remainingBattlefields = {
      p1: await host.evaluate(() => window.__riftboundGame.players.find((player) => player.id === "p1")?.availableBattlefields.map((field) => field.cardNumber)),
      p2: await guest.evaluate(() => window.__riftboundGame.players.find((player) => player.id === "p2")?.availableBattlefields.map((field) => field.cardNumber))
    };
    expect(remainingBattlefields.p1).not.toContain(usedBattlefields.p1);
    expect(remainingBattlefields.p2).not.toContain(usedBattlefields.p2);
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-battlefield"]');
    }

    await expect(host.locator(".first-player-screen")).toBeVisible();
    await expect(guest.locator(".first-player-screen")).toBeVisible();
    const nextDecision = await host.evaluate(() => ({
      method: window.__riftboundGame.firstPlayerDecision?.method,
      chooserId: window.__riftboundGame.firstPlayerDecision?.chooserId,
      handCounts: window.__riftboundGame.players.map((player) => player.hand.length)
    }));
    expect(nextDecision).toEqual({ method: "designated", chooserId: guestSeat, handCounts: [0, 0] });
    await expect(host.locator('[data-action="choose-first-player"]:enabled')).toHaveCount(0);
    await expect(guest.locator('[data-action="choose-first-player"]:enabled')).toHaveCount(2);
    const selectedNextFirstPlayer = await guest.locator('[data-action="choose-first-player"]:enabled').first().getAttribute("data-player");
    await guest.locator('[data-action="choose-first-player"]:enabled').first().click();
    await expect(host.locator(".mulligan")).toBeVisible();
    await expect(guest.locator(".mulligan")).toBeVisible();
    expect(await host.evaluate(() => window.__riftboundGame.mulligan?.playerId)).toBe(selectedNextFirstPlayer);
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
