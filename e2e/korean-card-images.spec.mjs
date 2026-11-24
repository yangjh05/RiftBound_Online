import { expect, test } from "@playwright/test";
import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";

test("language setting switches card art and preserves the Korean-exclusive Ahri printing", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('[data-action="menu-decks"]')).toBeVisible();
  const ahri = Object.values(cards).find((card) => card.cardNumber === "OGN-255/298");
  const koreanArt = CARD_KO_TRANSLATIONS[ahri.cardNumber].koImageUrl;
  for (const [locale, expectedImage] of [["ko", koreanArt], ["en", ahri.image], ["ko", koreanArt]]) {
    await page.locator('[data-action="settings-language"]').selectOption(locale);
    await page.locator('[data-action="menu-decks"]').click();
    await page.locator('[data-action="deck-search"]').fill(locale === "ko" ? "구미호" : "Nine-Tailed Fox");
    const normal = page.locator('.library-card[data-card-number="OGN-255/298"]');
    await expect(normal.locator("img")).toHaveAttribute("src", expectedImage);
    await normal.click();
    await expect(page.locator(".deck-preview-card img")).toHaveAttribute("src", expectedImage);
    const korea = page.locator('.library-card[data-card-number="OGN-303a/298"]');
    await expect(korea.locator("img")).toHaveAttribute("src", cards.ahriNineTailedFoxKorea.image);
    await korea.click();
    await expect(page.locator(".deck-preview-card img")).toHaveAttribute("src", cards.ahriNineTailedFoxKorea.image);
    if (locale === "ko") {
      await expect(page.locator(".deck-preview-card p")).toContainText("공식 번역 오역");
      await expect(page.locator(".deck-preview-card p")).toContainText("이번 턴");
    }
    await page.locator('[data-action="menu-home"]').click();
  }
  expect(errors).toEqual([]);
});
