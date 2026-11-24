import { expect, test } from "@playwright/test";

import { TUTORIAL_CARD_IDS, TUTORIAL_IDS } from "../src/tutorial.mjs";

function capturePageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openTutorial(page, tutorialId, { language = "ko" } = {}) {
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await page.locator('[data-action="settings-language"]').selectOption(language);
  await page.locator('[data-action="menu-tutorial"]').click();

  const uiMap = page.locator(".tutorial-ui-map");
  if (language === "ko") {
    await expect(uiMap).toContainText("중앙 보드");
    await expect(uiMap).toContainText("하단 명령 바");
    await expect(uiMap).toContainText("오른쪽 보조 기능");
  } else {
    await expect(uiMap).toContainText("Center board");
    await expect(uiMap).toContainText("Bottom command bar");
    await expect(uiMap).toContainText("Right utility rail");
    await expect(page.locator(`.tutorial-course-card:has([data-action="tutorial-select"][data-tutorial="${tutorialId}"])`))
      .toContainText("About");
  }

  await page.locator(`[data-action="tutorial-select"][data-tutorial="${tutorialId}"]`).click();
  await expectStep(page, "welcome");
  const begin = page.locator('.tutorial-panel [data-action="tutorial-next"]');
  await expect(begin).toBeFocused();
  await begin.click();
}

async function expectStep(page, stepId) {
  await expect(page.locator(`.tutorial-panel[data-tutorial-step="${stepId}"]`)).toBeVisible();
}

async function clickTutorialTarget(page, selector, options = {}) {
  const target = page.locator(`${selector}:visible`);
  await expect(target).toHaveCount(1);
  await expect(target).toHaveClass(/tutorial-target/u);
  await expect(target).not.toHaveAttribute("aria-disabled", "true");
  await target.click(options);
}

async function tapTutorialTarget(page, selector) {
  const target = page.locator(`${selector}:visible`);
  await expect(target).toHaveCount(1);
  await expect(target).toHaveClass(/tutorial-target/u);
  await expect(target).not.toHaveAttribute("aria-disabled", "true");
  const hitTest = await target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      ownsCenter: Boolean(hit && node.contains(hit)),
      hit: hit ? `${hit.tagName}.${hit.className}` : "none",
      pointerEvents: getComputedStyle(node).pointerEvents,
      ancestors: [...function* parents(current) {
        let parent = current.parentElement;
        while (parent && parent !== document.body) {
          const parentRect = parent.getBoundingClientRect();
          yield {
            node: `${parent.tagName}.${parent.className}`,
            pointerEvents: getComputedStyle(parent).pointerEvents,
            zIndex: getComputedStyle(parent).zIndex,
            box: [parentRect.left, parentRect.top, parentRect.width, parentRect.height]
          };
          parent = parent.parentElement;
        }
      }(node)]
    };
  });
  expect(hitTest, `tutorial target must own its center hit point: ${JSON.stringify(hitTest)}`).toMatchObject({
    ownsCenter: true,
    pointerEvents: "auto"
  });
  await target.tap();
}

async function completeFirstVictory(page, { verifyCurrentUi = false } = {}) {
  await expectStep(page, "open-hand");
  if (verifyCurrentUi) {
    const lockedUnit = page.locator(`[data-card-id="${TUTORIAL_CARD_IDS.readyUnit}"][role="button"]`);
    await expect(lockedUnit).toHaveAttribute("aria-disabled", "true");
    await expect(lockedUnit).toHaveAttribute("tabindex", "-1");
    const selectedBeforeLockedKey = await page.evaluate(() => window.__riftboundGame.selectedCardId);
    await lockedUnit.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true
    })));
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(selectedBeforeLockedKey);
  }
  await clickTutorialTarget(page, '.hand-focus-toggle[data-action="toggle-hand"]');

  await expectStep(page, "play-unit");
  const playUnit = `[data-action="begin-play"][data-card="${TUTORIAL_CARD_IDS.handUnit}"][data-destination="base"]`;
  if (verifyCurrentUi) await expect(page.locator(playUnit)).toContainText("기지에 사용");
  await clickTutorialTarget(page, playUnit);

  await expectStep(page, "select-runes");
  for (const runeId of TUTORIAL_CARD_IDS.runes) {
    await clickTutorialTarget(page, `[data-direct-payment-rune="true"][data-rune="${runeId}"]`);
  }

  await expectStep(page, "confirm-payment");
  if (verifyCurrentUi) await expect(page.locator('[data-action="confirm-payment"]')).toContainText("확인");
  await clickTutorialTarget(page, '[data-action="confirm-payment"]');

  await expectStep(page, "select-mover");
  await clickTutorialTarget(page, `[data-card-id="${TUTORIAL_CARD_IDS.readyUnit}"][role="button"]`);

  await expectStep(page, "move-unit");
  const move = `[data-action="move"][data-unit="${TUTORIAL_CARD_IDS.readyUnit}"][data-destination="${TUTORIAL_CARD_IDS.battlefield}"]`;
  if (verifyCurrentUi) await expect(page.locator(move)).toContainText("1번 전장으로 이동");
  await clickTutorialTarget(page, move);

  await expectStep(page, "pass-showdown");
  if (verifyCurrentUi) await expect(page.locator('[data-action="pass-showdown"]')).toContainText("포커스 패스");
  await clickTutorialTarget(page, '[data-action="pass-showdown"]');

  await expectStep(page, "end-turn");
  await clickTutorialTarget(page, '.table-action-rail [data-action="end-turn"]');

  await expectStep(page, "complete");
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.players
    .find((player) => player.id === window.__riftboundGame.tutorial.playerId)?.score)).toBe(8);
}

test("short desktop tutorial menu wheel-scrolls to the final lesson", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await page.locator('[data-action="menu-tutorial"]').click();

  const screen = page.locator(".tutorial-menu-screen");
  const lastLesson = page.locator(
    `[data-action="tutorial-select"][data-tutorial="${TUTORIAL_IDS.power}"]`
  );
  await expect(screen).toHaveCSS("overflow-y", "auto");
  await expect.poll(() => screen.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await screen.hover();
  await page.mouse.wheel(0, 10_000);
  await expect.poll(() => screen.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(lastLesson).toBeInViewport();
  await lastLesson.click();
  await expectStep(page, "welcome");
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.tutorial.id)).toBe(TUTORIAL_IDS.power);
  expect(pageErrors).toEqual([]);
});

test("English locale uses the current UI labels throughout the tutorial panel", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openTutorial(page, TUTORIAL_IDS.firstVictory, { language: "en" });

  await expectStep(page, "open-hand");
  const panel = page.locator(".tutorial-panel");
  await expect(panel).toContainText("Open your Hand at the bottom");
  await expect(panel).toContainText("Play Action");
  await expect(panel).not.toContainText(/[가-힣]/u);
  await expect(page.locator("body")).toContainText("Trainee");
  expect(pageErrors).toEqual([]);
});

test("first victory tutorial follows the current hand, command bar, board, and utility rail", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openTutorial(page, TUTORIAL_IDS.firstVictory);
  await completeFirstVictory(page, { verifyCurrentUi: true });

  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem("riftbound.gameDiagnostic.v1") || "null"
  )?.finalization?.reason)).toBe("normal");
  const completedLogId = await page.evaluate(() => JSON.parse(
    localStorage.getItem("riftbound.gameDiagnostic.v1") || "null"
  )?.logId || null);
  expect(completedLogId).not.toBeNull();
  await page.locator('.tutorial-panel [data-action="tutorial-restart"]').click();
  await expectStep(page, "welcome");
  await expect.poll(() => page.evaluate(() => {
    const tutorial = window.__riftboundGame.tutorial;
    const trainee = window.__riftboundGame.players.find((player) => player.id === tutorial.playerId);
    return {
      id: tutorial.id,
      introDismissed: tutorial.introDismissed,
      completed: tutorial.completed,
      score: trainee?.score
    };
  })).toEqual({
    id: TUTORIAL_IDS.firstVictory,
    introDismissed: false,
    completed: false,
    score: 6
  });
  await expect(page.locator('.tutorial-panel [data-action="tutorial-next"]')).toBeFocused();
  await expect.poll(() => page.evaluate((previousLogId) => {
    const diagnostic = JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1") || "null");
    return {
      hasNewLog: Boolean(diagnostic?.logId && diagnostic.logId !== previousLogId),
      finalization: diagnostic?.finalization || null
    };
  }, completedLogId)).toEqual({ hasNewLog: true, finalization: null });
  expect(pageErrors).toEqual([]);
});

test("completed tutorial exits cleanly and starts the next lesson", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openTutorial(page, TUTORIAL_IDS.firstVictory);
  await completeFirstVictory(page);

  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem("riftbound.gameDiagnostic.v1") || "null"
  )?.finalization?.reason)).toBe("normal");
  await page.locator('.tutorial-panel [data-action="tutorial-exit"]').click();
  await expect(page.locator(".tutorial-menu-screen")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("riftbound.gameDiagnostic.v1"))).toBeNull();

  await page.locator(
    `[data-action="tutorial-select"][data-tutorial="${TUTORIAL_IDS.combat}"]`
  ).click();
  await expectStep(page, "welcome");
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.tutorial.id)).toBe(TUTORIAL_IDS.combat);
  await page.locator('.tutorial-panel [data-action="tutorial-next"]').click();
  await expectStep(page, "select-attacker");
  expect(pageErrors).toEqual([]);
});

test("combat tutorial uses board-card selection and the current damage drawer", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openTutorial(page, TUTORIAL_IDS.combat);

  await expectStep(page, "select-attacker");
  await clickTutorialTarget(page, `[data-card-id="${TUTORIAL_CARD_IDS.combat.attacker}"][role="button"]`);

  await expectStep(page, "move-attacker");
  const move = `[data-action="move"][data-unit="${TUTORIAL_CARD_IDS.combat.attacker}"][data-destination="${TUTORIAL_CARD_IDS.combat.battlefield}"]`;
  await expect(page.locator(move)).toContainText("1번 전장으로 이동");
  await clickTutorialTarget(page, move);

  await expectStep(page, "pass-showdown");
  await expect(page.locator('[data-action="pass-showdown"]')).toContainText("포커스 패스");
  await clickTutorialTarget(page, '[data-action="pass-showdown"]');

  await expectStep(page, "assign-combat-damage");
  await expect(page.locator(".combat-damage-panel")).toContainText("전투 피해 배정");
  await clickTutorialTarget(page,
    `.combat-damage-panel [data-action="choose-effect"][data-card-id="${TUTORIAL_CARD_IDS.combat.defender}"]`);

  await expectStep(page, "complete");
  expect(pageErrors).toEqual([]);
});

test("spell tutorial stages a board target and confirms it before payment", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openTutorial(page, TUTORIAL_IDS.spell);

  await expectStep(page, "open-hand");
  await clickTutorialTarget(page, '.hand-focus-toggle[data-action="toggle-hand"]');

  await expectStep(page, "play-spell");
  const cast = `[data-action="begin-play"][data-card="${TUTORIAL_CARD_IDS.spell.card}"]`;
  await expect(page.locator(cast)).toContainText("시전");
  await clickTutorialTarget(page, cast);

  await expectStep(page, "choose-spell-target");
  await expect(page.locator(".chain-pod")).toHaveClass(/is-collapsed/u);
  await clickTutorialTarget(page, `[data-card-id="${TUTORIAL_CARD_IDS.spell.target}"][role="button"]`);

  await expectStep(page, "confirm-spell-target");
  const confirmTarget = '[data-action="confirm-staged-choice"]';
  await expect(page.locator(confirmTarget)).toContainText("확인 · 레이븐블룸 학생");
  await clickTutorialTarget(page, confirmTarget);

  await expectStep(page, "select-runes");
  for (const runeId of TUTORIAL_CARD_IDS.spell.runes) {
    await clickTutorialTarget(page, `[data-direct-payment-rune="true"][data-rune="${runeId}"]`);
  }

  await expectStep(page, "confirm-payment");
  await clickTutorialTarget(page, '[data-action="confirm-payment"]');
  await expectStep(page, "complete");
  expect(pageErrors).toEqual([]);
});

test("energy and Power tutorial supports pointer and keyboard Power payment on the Rune row", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openTutorial(page, TUTORIAL_IDS.power);

  await expectStep(page, "open-hand");
  await clickTutorialTarget(page, '.hand-focus-toggle[data-action="toggle-hand"]');

  await expectStep(page, "play-power-unit");
  const playUnit = `[data-action="begin-play"][data-card="${TUTORIAL_CARD_IDS.power.card}"][data-destination="base"]`;
  await clickTutorialTarget(page, playUnit);

  await expectStep(page, "select-power-energy");
  const firstPowerRune = page.locator(
    `[data-direct-payment-rune="true"][data-rune="${TUTORIAL_CARD_IDS.power.runes[0]}"]:visible`
  );
  await expect(firstPowerRune).not.toHaveAttribute("aria-keyshortcuts", "Shift+Enter");
  await expect(firstPowerRune).not.toHaveAttribute("title", /Shift\+Enter/u);
  await expect(page.locator("#payment-stage-help")).not.toContainText("힘");
  for (const runeId of TUTORIAL_CARD_IDS.power.runes) {
    await clickTutorialTarget(page, `[data-direct-payment-rune="true"][data-rune="${runeId}"]`);
  }

  await expectStep(page, "select-domain-power");
  await expect(page.locator(".tutorial-panel")).toContainText("힘");
  const powerRuneId = TUTORIAL_CARD_IDS.power.runes[0];
  const powerRuneSelector = `[data-direct-payment-rune="true"][data-rune="${powerRuneId}"]`;
  const powerRune = page.locator(`${powerRuneSelector}:visible`);
  await expect(powerRune).toHaveAttribute("aria-keyshortcuts", "Shift+Enter");
  await expect(powerRune).not.toHaveAttribute("title", /에너지로 탈진/u);
  await expect(page.locator("#payment-stage-help")).toContainText("Shift+Enter");
  await expect(page.locator("#payment-stage-help")).not.toContainText("에너지");
  await clickTutorialTarget(page,
    powerRuneSelector,
    { button: "right" });
  await expect.poll(() => page.evaluate((runeId) => ({
    energy: window.__riftboundGame.pendingPayment?.energyRuneIds?.includes(runeId) || false,
    power: window.__riftboundGame.pendingPayment?.powerRuneIds?.includes(runeId) || false
  }), powerRuneId)).toEqual({ energy: true, power: true });

  await expectStep(page, "confirm-payment");
  await powerRune.focus();
  await powerRune.press("Shift+Enter");
  await expectStep(page, "select-domain-power");
  await expect.poll(() => page.evaluate((runeId) =>
    window.__riftboundGame.pendingPayment?.powerRuneIds?.includes(runeId) || false, powerRuneId)).toBe(false);
  await powerRune.focus();
  await powerRune.press("Shift+Enter");
  await expectStep(page, "confirm-payment");
  await clickTutorialTarget(page, '[data-action="confirm-payment"]');
  await expectStep(page, "complete");
  expect(pageErrors).toEqual([]);
});

test.describe("mobile tutorial controls", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });

test("mobile spell tutorial keeps the board target and payment Runes tappable", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openTutorial(page, TUTORIAL_IDS.spell);
  await tapTutorialTarget(page, '.action-window-toggle[data-action="toggle-hand"]');
  await tapTutorialTarget(page, `[data-action="begin-play"][data-card="${TUTORIAL_CARD_IDS.spell.card}"]`);

  await expectStep(page, "choose-spell-target");
  await expect(page.locator('.chain-pod [data-action="toggle-chain-zone"]')).toBeDisabled();
  await tapTutorialTarget(page, `[data-card-id="${TUTORIAL_CARD_IDS.spell.target}"][role="button"]`);
  await tapTutorialTarget(page, '[data-action="confirm-staged-choice"]');

  for (const runeId of TUTORIAL_CARD_IDS.spell.runes) {
    await tapTutorialTarget(page, `[data-direct-payment-rune="true"][data-rune="${runeId}"]`);
  }
  await tapTutorialTarget(page, '[data-action="confirm-payment"]');
  await expectStep(page, "complete");
  expect(pageErrors).toEqual([]);
});

test("mobile Power tutorial supports touch-and-hold Power payment", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openTutorial(page, TUTORIAL_IDS.power);
  await tapTutorialTarget(page, '.action-window-toggle[data-action="toggle-hand"]');
  await tapTutorialTarget(page,
    `[data-action="begin-play"][data-card="${TUTORIAL_CARD_IDS.power.card}"][data-destination="base"]`);

  for (const runeId of TUTORIAL_CARD_IDS.power.runes) {
    await tapTutorialTarget(page, `[data-direct-payment-rune="true"][data-rune="${runeId}"]`);
  }

  await expectStep(page, "select-domain-power");
  const powerRuneId = TUTORIAL_CARD_IDS.power.runes[0];
  const powerRune = page.locator(`[data-direct-payment-rune="true"][data-rune="${powerRuneId}"]:visible`);
  await expect(powerRune).toHaveClass(/tutorial-target/u);
  const box = await powerRune.boundingBox();
  expect(box).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
  });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();

  await expect.poll(() => page.evaluate((runeId) => ({
    energy: window.__riftboundGame.pendingPayment?.energyRuneIds?.includes(runeId) || false,
    power: window.__riftboundGame.pendingPayment?.powerRuneIds?.includes(runeId) || false
  }), powerRuneId)).toEqual({ energy: true, power: true });
  await tapTutorialTarget(page, '[data-action="confirm-payment"]');
  await expectStep(page, "complete");
  expect(pageErrors).toEqual([]);
});
});
