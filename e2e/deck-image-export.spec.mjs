import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { rawDecklists } from "../src/cards.mjs";

const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="2079"><rect width="1488" height="2079" fill="#2b7193"/><text x="160" y="900" font-size="200" fill="white">CARD</text></svg>';

async function openDeck(page, deck) {
  if (deck) await page.addInitScript((deck) => {
    localStorage.setItem("riftbound.deckStore.v1", JSON.stringify({ decks: [deck], activeDeckIds: [deck.id, deck.id] }));
  }, deck);
  await page.route(/^https:\/\/(?:cmsassets\.rgpub\.io|exburst\.dev|cdn\.piltoverarchive\.com|static\.dotgg\.gg)\//u,
    (route) => route.fulfill({ contentType: "image/svg+xml", body: image }));
  await page.route("**/api/deck-card-image?**", (route) => route.fulfill({ contentType: "image/svg+xml", body: image }));
  await page.addInitScript(() => {
    window.exportDraws = [];
    window.exportRuneIcons = [];
    window.exportRuneBackgrounds = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (image.src?.includes("/api/deck-card-image?")) window.exportDraws.push(new URL(image.src).searchParams.get("card"));
      if (image.src?.includes("/assets/runes/")) {
        window.exportRuneIcons.push(new URL(image.src).pathname);
        window.exportRuneBackgrounds.push([...this.getImageData(Math.round(args[0] + 24), Math.round(args[1] + 24), 1, 1).data]);
      }
      return draw.call(this, image, ...args);
    };
  });
  await page.goto("/");
  await page.locator('[data-action="settings-language"]').selectOption("ko");
  await page.locator('[data-action="menu-decks"]').click();
  await page.locator(`[data-action="deck-select"][data-deck="${deck?.id || "default-proving-grounds-annie"}"]`).click();
  await page.locator('[data-action="deck-image-open"]').click();
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
}

test("deck image previews all physical copies, summarizes Runes and downloads a real PNG", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDeck(page);
  const counts = await page.evaluate(() => {
    const draws = window.exportDraws;
    return { total: draws.length, copies: draws.filter((number) => number === "OGN-004/298").length, champion: draws.filter((number) => number === "OGS-010/024").length };
  });
  expect(counts).toEqual({ total: 52, copies: 3, champion: 1 });
  await expect(page.locator(".deck-image-preview img")).toHaveAttribute("width", "2000");
  await expect(page.locator(".deck-image-dialog")).toContainText("룬은 종류별 아이콘과 개수");
  expect(await page.evaluate(() => window.exportRuneIcons)).toEqual(["/assets/runes/fury.png", "/assets/runes/chaos.png"]);
  expect(await page.evaluate(() => window.exportRuneBackgrounds.every((pixel) => pixel.slice(0, 3).every((channel) => channel < 80)))).toBe(true);
  const downloadReady = page.waitForEvent("download");
  await page.locator('[data-action="deck-image-download"]').click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toMatch(/^Riftbound-.+\.png$/u);
  const path = testInfo.outputPath("deck.png");
  await download.saveAs(path);
  const png = await readFile(path);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBe(2000);
  expect(png.readUInt32BE(20)).toBeGreaterThan(2000);
  await page.keyboard.press("Escape");
  await expect(page.locator(".deck-image-dialog")).toHaveCount(0);
  await expect(page.locator('[data-action="deck-image-open"]')).toBeFocused();
  expect(errors).toEqual([]);
});

test("Champion-first auto-selects the sole candidate, moves one copy and can be turned off", async ({ page }) => {
  await openDeck(page);
  const original = await page.evaluate(() => window.exportDraws);
  const initialStorage = await page.evaluate(() => JSON.stringify(localStorage));
  await page.evaluate(() => { window.exportDraws = []; });
  // Click the label as a phone user would, not only the checkbox's small hit target.
  await page.locator(".deck-image-champion-toggle").click();
  await expect(page.locator('[data-action="deck-image-champion-first"]')).toBeChecked();
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
  await expect(page.locator(".deck-image-champion-options")).toContainText("자동 선택");
  await expect(page.locator('[data-action="deck-image-champion"]')).toHaveCount(0);
  const pinned = await page.evaluate(() => window.exportDraws);
  expect(pinned[4]).toBe("OGS-010/024");
  expect(pinned.length).toBe(52);
  expect(pinned.filter((id) => id === "OGS-010/024")).toHaveLength(1);
  expect(pinned.slice(44)).toEqual(original.slice(44));
  await page.evaluate(() => { window.exportDraws = []; });
  await page.locator('[data-action="deck-image-champion-first"]').uncheck();
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
  expect(await page.evaluate(() => window.exportDraws)).toEqual(original);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(initialStorage);
});

test("multiple Champions wait for selection, keep that choice across sorting, and all Rune icons have no white backdrop", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const deck = structuredClone(rawDecklists.provingGroundsAnnie);
  deck.id = "export-champion-choice";
  deck.name = "챔피언 선택 테스트";
  deck.main.find(([id]) => id === "OGN-004/298")[1] -= 1;
  deck.main.push(["OGS-001/024", 1]);
  deck.runes = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"].map((domain) => [domain, 2]);
  await openDeck(page, deck);
  expect(await page.evaluate(() => window.exportRuneBackgrounds.length)).toBe(6);
  expect(await page.evaluate(() => window.exportRuneBackgrounds.every((pixel) => pixel.slice(0, 3).every((channel) => channel < 80)))).toBe(true);
  await page.locator('[data-action="deck-image-champion-first"]').check();
  const choice = page.locator('[data-action="deck-image-champion"]');
  await expect(choice).toHaveValue("");
  await expect(choice.locator("option")).toHaveCount(3);
  await expect(page.locator('[data-action="deck-image-download"]')).toBeDisabled();
  await expect(page.locator(".deck-image-preview")).toContainText("챔피언을 선택해 주세요");
  const box = await page.locator(".deck-image-dialog").boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  await expect(choice).toBeInViewport();
  for (const champion of ["OGS-001/024", "OGS-010/024"]) {
    await page.evaluate(() => { window.exportDraws = []; });
    await choice.selectOption(champion);
    await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
    expect(await page.evaluate(() => ({ first: window.exportDraws[4], count: window.exportDraws.length }))).toEqual({ first: champion, count: 52 });
  }
  await page.evaluate(() => { window.exportDraws = []; });
  await page.locator('[data-action="deck-image-sort"]').selectOption("cost");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
  expect(await page.evaluate(() => window.exportDraws[4])).toBe("OGS-010/024");
  await expect(choice).toHaveValue("OGS-010/024");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="deck-image-open"]').click();
  await expect(choice).toHaveValue("OGS-010/024");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
  await choice.selectOption("");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeDisabled();
  await page.locator('[data-action="deck-image-champion-first"]').uncheck();
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
});

test("decks without an eligible Champion can export with Champion-first disabled", async ({ page }) => {
  await openDeck(page, { id: "export-no-champion", name: "구성 중", legend: "OGS-017/024", main: [["OGN-004/298", 2]], sideboard: [["OGS-010/024", 1]] });
  await expect(page.locator('[data-action="deck-image-champion-first"]')).toBeDisabled();
  await expect(page.locator(".deck-image-champion-options")).toContainText("메인 덱에 레전드와 일치하는 챔피언이 없습니다");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
});

test("sort selection regenerates both sections, retains counts and remembers the choice", async ({ page }) => {
  await openDeck(page);
  const checkOrder = async (sort) => page.evaluate(async (sort) => {
    const { cards } = await import("/src/cards.mjs");
    const byNumber = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
    const draws = window.exportDraws;
    const domains = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
    const value = (card) => sort === "type" ? ["unit", "gear", "spell"].indexOf(card.type) : sort === "cost" ? card.energy : domains.indexOf(card.domains[0]);
    return { total: draws.length, ordered: [draws.slice(4, 44), draws.slice(44)].every((section) => section.every((id, i) => i === 0 || value(byNumber.get(section[i - 1])) <= value(byNumber.get(id)))) };
  }, sort);
  expect(await checkOrder("type")).toEqual({ total: 52, ordered: true });
  const initialStorage = await page.evaluate(() => JSON.stringify(localStorage));
  for (const sort of ["cost", "domain"]) {
    const previous = await page.locator(".deck-image-preview img").getAttribute("src");
    await page.evaluate(() => { window.exportDraws = []; });
    await page.locator('[data-action="deck-image-sort"]').selectOption(sort);
    await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
    await expect(page.locator(".deck-image-preview img")).not.toHaveAttribute("src", previous);
    expect(await checkOrder(sort)).toEqual({ total: 52, ordered: true });
  }
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(initialStorage);
  await page.keyboard.press("Escape");
  await page.locator('[data-action="deck-image-open"]').click();
  await expect(page.locator('[data-action="deck-image-sort"]')).toHaveValue("domain");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
});

test("failed card art is clearly reported and retry replaces placeholders", async ({ page }) => {
  await openDeck(page);
  await page.keyboard.press("Escape");
  await page.route("**/api/deck-card-image?**", (route) => route.fulfill({ status: 502, body: "Unavailable" }));
  await page.locator('[data-action="deck-image-open"]').click();
  await expect(page.locator(".deck-image-dialog [role=alert]")).toContainText("카드 이름으로 표시");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
  await page.route("**/api/deck-card-image?**", (route) => route.fulfill({ contentType: "image/svg+xml", body: image }));
  await page.locator('[data-action="deck-image-retry"]').click();
  await expect(page.locator('[data-action="deck-image-download"]')).toBeEnabled();
  await expect(page.locator(".deck-image-dialog [role=alert]")).toHaveCount(0);
});

test("mobile preview fits the viewport and closing during loading does not reopen it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDeck(page);
  const box = await page.locator(".deck-image-dialog").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.locator('.deck-image-dialog [data-action="deck-transfer-close"]').first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator('[data-action="deck-image-download"]')).toBeFocused();
  await page.keyboard.press("Escape");
  let unblock;
  const delayed = new Promise((resolve) => { unblock = resolve; });
  await page.route("**/api/deck-card-image?**", async (route) => {
    await delayed;
    await route.fulfill({ contentType: "image/svg+xml", body: image }).catch(() => {});
  });
  await page.locator('[data-action="deck-image-open"]').click();
  await expect(page.locator('[data-action="deck-image-download"]')).toBeDisabled();
  await page.keyboard.press("Escape");
  unblock();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".deck-image-dialog")).toHaveCount(0);
});
