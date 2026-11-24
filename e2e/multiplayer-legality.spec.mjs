import { expect, test } from "@playwright/test";
import { rawDecklists } from "../src/cards.mjs";

async function openApp(page, deck = null) {
  await page.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.addInitScript((record) => {
    localStorage.setItem("riftbound.settings.v1", JSON.stringify({ locale: "ko" }));
    if (record) localStorage.setItem("riftbound.deckStore.v1", JSON.stringify({ decks: [record], activeDeckIds: [record.id, "default-drowsy"] }));
  }, deck);
  await page.goto("/");
  await expect(page.locator('[data-action="menu-multiplayer"]')).toBeVisible();
}

function roomPanel(page) {
  return page.locator(".multiplayer-panel").filter({ has: page.locator('[data-action="online-leave"]') });
}

test("selected room rules reach the guest and default decks start a game with bans enabled", async ({ page, browser }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.locator('[data-action="menu-active-deck"][data-slot="0"]').selectOption("default-proving-grounds-annie");
  await page.locator('[data-action="menu-multiplayer"]').click();
  await page.locator('[data-action="online-pool"]').selectOption("spiritforged-era");
  await page.locator('[data-action="online-banlist"]').selectOption("on");
  await page.locator('[data-action="online-create"]').click();
  await expect(roomPanel(page).locator(".room-rules-summary")).toHaveText("스피릿포지드 출시 환경 · 금제 적용");
  await expect(page.locator(".room-deck-status")).toContainText("금제 예외");
  await expect(page.locator('[data-action="online-submit-deck"]')).toBeEnabled();
  const code = (await roomPanel(page).locator("h2").textContent()).match(/\b[A-Z2-9]{4}\b/u)[0];
  await page.screenshot({ path: testInfo.outputPath("room-rules.png"), fullPage: true });

  const guest = await browser.newPage();
  await openApp(guest);
  await guest.locator('[data-action="menu-active-deck"][data-slot="0"]').selectOption("default-proving-grounds-master-yi");
  await guest.locator('[data-action="menu-multiplayer"]').click();
  await expect(guest.locator(`.room-list-item[data-room="${code}"] .room-rules-summary`)).toContainText("금제 적용");
  expect(await guest.locator(`.room-list-item[data-room="${code}"]`).evaluate((button) => {
    const label = button.querySelector(".room-rules-summary").getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return label.top >= bounds.top && label.bottom <= bounds.bottom;
  })).toBe(true);
  await guest.locator('[data-action="online-code-input"]').fill(code);
  await guest.locator('[data-action="online-join-code"]').click();
  await expect(roomPanel(guest).locator(".room-rules-summary")).toHaveText("스피릿포지드 출시 환경 · 금제 적용");
  await page.locator('[data-action="online-submit-deck"]').click();
  await guest.locator('[data-action="online-submit-deck"]').click();
  await page.locator('[data-action="online-ready"]').click();
  await guest.locator('[data-action="online-ready"]').click();
  await expect(page.locator(".first-player-screen")).toBeVisible();
  await expect(guest.locator(".first-player-screen")).toBeVisible();
  expect(errors).toEqual([]);
  await guest.close();
});

test("personal banned decks show a reason and remain usable in rooms without bans", async ({ page }) => {
  await openApp(page, { ...rawDecklists.provingGroundsAnnie, id: "personal-banned", name: "금제 확인 덱" });
  await page.locator('[data-action="menu-multiplayer"]').click();
  await page.locator('[data-action="online-banlist"]').selectOption("on");
  await page.locator('[data-action="online-create"]').click();
  await expect(page.locator('[data-action="online-submit-deck"]')).toBeDisabled();
  await expect(page.locator(".room-deck-status")).toContainText("금제 적용 방에서 사용할 수 없는 카드");
  await page.locator('[data-action="online-banlist"]').selectOption("off");
  await expect(roomPanel(page).locator(".room-rules-summary")).toContainText("금제 적용");
  await expect(page.locator('[data-action="online-submit-deck"]')).toBeDisabled();
  await page.locator('[data-action="online-leave"]').click();
  await page.locator('[data-action="online-create"]').click();
  await expect(roomPanel(page).locator(".room-rules-summary")).toContainText("금제 미적용");
  await expect(page.locator('[data-action="online-submit-deck"]')).toBeEnabled();
  await page.locator('[data-action="online-submit-deck"]').click();
  await expect(page.locator('[data-action="online-ready"]')).toBeEnabled();
});

test("deck editor displays banned and unbanned card information without blocking editing", async ({ page }, testInfo) => {
  await openApp(page);
  await page.locator('[data-action="menu-decks"]').click();
  await page.locator('.deck-slot[data-deck^="default-"]').first().click();
  await page.locator('[data-action="deck-search"]').fill("Stacked Deck");
  const banned = page.locator('.library-card[data-card-number="OGN-183/298"]');
  await expect(banned.locator(".card-ban-badge")).toHaveText("금지");
  await banned.click();
  await expect(page.locator(".card-ban-status")).toHaveText("금지 카드");
  await expect(page.locator(".card-ban-context")).toContainText("2026-09-18");
  await expect(page.locator(".card-ban-context")).toContainText("AI 대전은 예외");
  await expect(page.locator('[data-action="deck-save"]')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("banned-card-info.png"), fullPage: true });
  await page.locator('[data-action="deck-search"]').fill("Flash");
  await page.locator('.library-card[data-card-number="OGS-011/024"]').click();
  await expect(page.locator(".card-ban-status")).toHaveText("금지 아님");
});

test("narrow screens expose room settings and enforce the chosen environment without bans", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.locator('[data-action="menu-multiplayer"]').click();
  await page.locator('[data-action="online-pool"]').selectOption("origins-era");
  await page.locator('[data-action="online-create"]').click();
  await expect(roomPanel(page).locator(".room-rules-summary")).toContainText("오리진 출시 환경 · 금제 미적용");
  await expect(page.locator('[data-action="online-submit-deck"]')).toBeDisabled();
  await expect(page.locator(".room-deck-status")).toContainText("선택 환경에 포함되지 않은 카드");
  expect(await page.locator(".multiplayer-screen").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.locator('[data-action="online-pool"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("room-rules-mobile.png"), fullPage: true });
});
