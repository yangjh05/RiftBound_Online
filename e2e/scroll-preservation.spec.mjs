import { expect, test } from "@playwright/test";

async function settleScroll(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function positionControl(control, screenFraction = 0.5) {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate((node, fraction) => {
    const screen = node.closest("main");
    screen.scrollTop += node.getBoundingClientRect().top - screen.getBoundingClientRect().top - screen.clientHeight * fraction;
    return screen.scrollTop;
  }, screenFraction);
}

for (const viewport of [{ width: 1280, height: 600 }, { width: 390, height: 650 }]) {
  test(`menu settings preserve scroll and focus through repeated updates at ${viewport.width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
    const screen = page.locator(".main-menu");
    const toggle = page.locator('[data-action="settings-sideboarding"]');
    const position = await positionControl(toggle);
    expect(position).toBeGreaterThan(20);
    for (let count = 0; count < 3; count += 1) {
      const checked = await toggle.isChecked();
      await toggle.click();
      await expect(toggle).toBeChecked({ checked: !checked });
      await settleScroll(page);
      await expect.poll(() => screen.evaluate((node) => node.scrollTop)).toBeCloseTo(position, 0);
      await expect(toggle).toBeFocused();
    }

    const deck = page.locator('[data-action="menu-active-deck"][data-slot="0"]');
    const deckPosition = await positionControl(deck, 0.2);
    expect(deckPosition).toBeGreaterThan(0);
    const replacement = await deck.locator("option").evaluateAll((options) => options.find((option) => !option.selected).value);
    await deck.selectOption(replacement);
    await settleScroll(page);
    await expect(deck).toHaveValue(replacement);
    await expect.poll(() => screen.evaluate((node) => node.scrollTop)).toBeCloseTo(deckPosition, 0);

    // A deliberate scroll to the top must replace the old saved position.
    await screen.evaluate((node) => { node.scrollTop = 0; });
    const language = page.locator('[data-action="settings-language"]');
    await language.selectOption(await language.inputValue() === "en" ? "ko" : "en");
    await settleScroll(page);
    await expect.poll(() => screen.evaluate((node) => node.scrollTop)).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`screen navigation restores each screen's own scroll at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
    const menu = page.locator(".main-menu");
    for (const [action, screenClass, back] of [
      ["menu-tutorial", ".tutorial-menu-screen", "tutorial-menu-back"],
      ["menu-decks", ".deck-builder-screen", "menu-home"]
    ]) {
      const button = page.locator(`[data-action="${action}"]`);
      const position = await positionControl(button);
      expect(position).toBeGreaterThan(20);
      await button.click();
      await expect(page.locator(screenClass)).toBeVisible();
      await settleScroll(page);
      expect(await page.locator(screenClass).evaluate((node) => node.scrollTop)).toBe(0);
      await page.locator(`[data-action="${back}"]`).click();
      await expect(menu).toBeVisible();
      await settleScroll(page);
      await expect.poll(() => menu.evaluate((node) => node.scrollTop)).toBeCloseTo(position, 0);
    }
  });
}
