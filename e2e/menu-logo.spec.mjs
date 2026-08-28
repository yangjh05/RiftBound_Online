import { expect, test } from "@playwright/test";

test("main menu logo keeps its full line box in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 697 });
  await page.goto("/");

  const logo = page.locator(".menu-hero h1");
  await expect(logo).toHaveText("Riftbound");
  const metrics = await logo.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      fontSize: Number.parseFloat(style.fontSize),
      overflow: style.overflow,
      scrollHeight: element.scrollHeight
    };
  });

  expect(metrics.overflow).toBe("visible");
  expect(metrics.clientHeight).toBeGreaterThanOrEqual(metrics.fontSize);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + Math.ceil(metrics.fontSize * 0.08));
});
