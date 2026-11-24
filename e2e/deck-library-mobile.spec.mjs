import { expect, test } from "@playwright/test";

const art = '<svg xmlns="http://www.w3.org/2000/svg" width="744" height="1039"><rect width="744" height="1039" fill="#306078"/><path d="M372 180L620 500 372 860 124 500Z" fill="#d5b879"/></svg>';

async function openLibrary(page) {
  await page.route(/^https:\/\/(?:cmsassets\.rgpub\.io|exburst\.dev|cdn\.piltoverarchive\.com|static\.dotgg\.gg)\//u,
    (route) => route.fulfill({ contentType: "image/svg+xml", body: art }));
  await page.goto("/");
  await page.locator('[data-action="settings-language"]').selectOption("ko");
  await page.locator('[data-action="menu-decks"]').click();
}

test("mobile deck cards keep art and text inside non-overlapping rows at phone and tablet widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('[data-action="deck-new"]').first()).toBeInViewport();
    await expect(page.locator('[data-action="deck-import-open"]')).toBeInViewport();
    const layout = await page.locator(".deck-select-panel").evaluate((panel) => {
      const rows = [...panel.querySelectorAll(".deck-slot")];
      const fits = (outer, inner) => inner.left >= outer.left && inner.right <= outer.right + 1 && inner.top >= outer.top && inner.bottom <= outer.bottom + 1;
      return {
        viewportFits: panel.getBoundingClientRect().right <= innerWidth && panel.scrollWidth <= panel.clientWidth,
        rowsFit: rows.every((row, index) => {
          const bounds = row.getBoundingClientRect();
          return bounds.height >= 130
            && fits(bounds, row.querySelector(".deck-slot-art").getBoundingClientRect())
            && fits(bounds, row.querySelector(".deck-slot-copy").getBoundingClientRect())
            && (index === 0 || bounds.top >= rows[index - 1].getBoundingClientRect().bottom);
        }),
        scrolls: panel.querySelector(".deck-slot-grid").scrollHeight > panel.querySelector(".deck-slot-grid").clientHeight
      };
    });
    expect(layout).toEqual({ viewportFits: true, rowsFit: true, scrolls: true });
  }
  await page.locator(".deck-slot").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".deck-slot").last()).toBeInViewport();
});

test("deck search, empty results and personal filters preserve a usable editor round trip", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await expect(page.locator(".deck-slot").first()).toBeVisible();
  const initialDeckIds = await page.locator(".deck-slot").evaluateAll(rows => rows.map(row => row.dataset.deck));
  const search = page.locator('[data-action="deck-list-search"]');
  await search.fill("마스터 이");
  await expect(search).toBeFocused();
  await expect(page.locator('.deck-slot[data-deck="default-proving-grounds-master-yi"]')).toBeVisible();
  await expect(page.locator('.deck-slot[data-deck="default-proving-grounds-annie"]')).toHaveCount(0);
  await search.fill("존재하지 않는 덱 검색");
  await expect(page.locator(".deck-library-empty")).toContainText("검색 결과가 없습니다");
  await page.locator('[data-action="deck-list-clear"]').click();
  await expect(search).toHaveValue("");
  await expect.poll(() => page.locator(".deck-slot").evaluateAll(rows => rows.map(row => row.dataset.deck)))
    .toEqual(initialDeckIds);
  await page.locator('#deck-list-filter-personal').click();
  await expect(page.locator('#deck-list-filter-personal')).toBeFocused();
  await expect(page.locator(".deck-library-empty")).toContainText("첫 번째 덱");
  await page.locator('[data-action="deck-new"]').first().click();
  await page.locator('[data-action="deck-name"]').fill("모바일 테스트 덱");
  await page.locator('[data-action="deck-save"]').click();
  await page.locator('[data-action="deck-mobile-list"]').click();
  await expect(page.locator(".deck-slot")).toHaveCount(1);
  await expect(page.locator(".deck-slot")).toContainText("모바일 테스트 덱");
  await page.locator(".deck-slot").click();
  await expect(page.locator('[data-action="deck-name"]')).toHaveValue("모바일 테스트 덱");
  expect(errors).toEqual([]);
});

test("mobile editor keeps cards visible and exposes secondary actions through More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await page.locator(".deck-slot").first().click();
  await expect(page.locator('[data-action="deck-image-open"]')).toBeVisible();
  await expect(page.locator('[data-action="deck-export-open"]')).toBeHidden();
  expect((await page.locator(".deck-editor-grid").boundingBox()).height).toBeGreaterThan(500);
  await page.locator('[data-action="deck-toggle-tools"]').click();
  await expect(page.locator('[data-action="deck-toggle-tools"]')).toHaveAttribute("aria-expanded", "true");
  await page.locator('[data-action="deck-export-open"]').click();
  await expect(page.locator(".deck-transfer-text")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('[data-action="deck-toggle-tools"]').click();
  await page.locator('[data-action="deck-mobile-tab"][data-tab="runes"]').click();
  await expect(page.locator(".rune-deck-block")).toBeVisible();
  await expect(page.locator(".main-deck-block")).toBeHidden();
});

test("mobile deck mutations preserve scroll for main cards and Rune variants", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await openLibrary(page);
  await page.locator('[data-action="deck-select"][data-deck="default-proving-grounds-master-yi"]').click();
  const viewport = page.locator(".deck-editor-grid");
  const row = page.locator('.main-deck-block .deck-row[data-card-number="OGN-138/298"]');
  await row.locator('[data-action="deck-remove-main"]').scrollIntoViewIfNeeded();
  const removePosition = await viewport.evaluate((element) => element.scrollTop);
  expect(removePosition).toBeGreaterThan(200);
  await row.locator('[data-action="deck-remove-main"]').click();
  await expect(row.locator("em")).toHaveText("x2");
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(removePosition, 0);

  await row.locator('[data-action="deck-card-focus"]').click();
  const add = page.locator('.deck-card-detail [data-action="deck-add-main"]');
  await add.scrollIntoViewIfNeeded();
  const addPosition = await viewport.evaluate((element) => element.scrollTop);
  expect(addPosition).toBeGreaterThan(50);
  await add.click();
  await expect(add).toBeDisabled();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(addPosition, 0);

  await page.locator('[data-action="deck-mobile-tab"][data-tab="runes"]').click();
  await page.locator('.selected-rune-list [data-action="deck-rune-remove"]').first().click();
  const runeAdd = page.locator('.rune-variant [data-action="deck-rune-add"]:enabled').last();
  await runeAdd.scrollIntoViewIfNeeded();
  const runePosition = await viewport.evaluate((element) => element.scrollTop);
  expect(runePosition).toBeGreaterThan(50);
  await runeAdd.click();
  await expect(page.locator(".rune-deck-block .deck-zone-title")).toContainText("12/12");
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(runePosition, 0);
});

for (const width of [320, 1440]) {
  test(`card detail removes from Main and Sideboard independently at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openLibrary(page);
    await page.locator('[data-action="deck-select"][data-deck="default-proving-grounds-master-yi"]').click();
    await page.locator('.main-deck-block [data-action="deck-card-focus"][data-card-number="OGN-064/298"]').click();
    const detail = page.locator(".deck-card-detail");
    const addMain = detail.locator('[data-action="deck-add-main"]');
    const addSide = detail.locator('[data-action="deck-add-sideboard"]');
    const removeMain = detail.locator('[data-action="deck-remove-main"]');
    const removeSide = detail.locator('[data-action="deck-remove-sideboard"]');
    const scroller = width < 1000 ? page.locator(".deck-editor-grid") : detail;
    await expect(addMain).toContainText("1/3");
    await expect(addSide).toContainText("1/3");
    await removeMain.scrollIntoViewIfNeeded();
    const scrollTop = await scroller.evaluate((element) => element.scrollTop);
    await removeMain.click();
    await expect(removeMain).toBeDisabled();
    await expect(addMain).toContainText("0/3");
    await expect(addSide).toContainText("1/3");
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0);
    await removeSide.click();
    await expect(removeSide).toBeDisabled();
    await expect(addSide).toContainText("0/3");
    await addMain.click();
    await addSide.click();
    await expect(removeMain).toBeEnabled();
    await expect(removeSide).toBeEnabled();
    await expect(addMain).toContainText("1/3");
    await expect(addSide).toContainText("1/3");
    const fits = await detail.locator(".deck-zone-actions").evaluateAll((groups) => groups.every((group) => {
      const buttons = [...group.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
      return buttons.every((rect) => rect.left >= 0 && rect.right <= innerWidth && rect.height >= 44) && buttons[0].right <= buttons[1].left;
    }));
    expect(fits).toBe(true);
  });
}
