import { expect, test } from "@playwright/test";

async function openReadyBoard(page) {
  await page.goto("/");
  await page.locator('[data-action="settings-language"]').selectOption("ko");
  await page.locator('[data-action="menu-start"]').click();
  for (let roll = 0; roll < 30; roll += 1) {
    const choose = page.locator('[data-action="choose-first-player"]:enabled');
    if (await choose.count()) {
      await choose.first().click();
      break;
    }
    await page.locator('[data-action="roll-first-player"]:enabled').click();
  }
  for (let index = 0; index < 2; index += 1) await page.locator('[data-action="sideboard-submit"]:enabled').click();
  for (let index = 0; index < 2; index += 1) await page.locator('[data-action="choose-champion"]:enabled').click();
  for (let index = 0; index < 2; index += 1) {
    const fields = page.locator('[data-action="choose-battlefield"]:enabled');
    if (await fields.count()) await fields.first().click();
  }
  for (let index = 0; index < 2; index += 1) await page.locator('[data-action="skip-mulligan"]').click();
  await expect(page.locator(".tabletop-board")).toBeVisible();
}

async function conquerSanctum(page, count = 3) {
  return page.evaluate(async (count) => {
    const { cards } = await import("/src/cards.mjs");
    const { moveUnit, passShowdown } = await import("/src/engine.mjs");
    const game = window.__riftboundGame;
    const playerId = document.querySelector('.table-seat[data-side="bottom"]').dataset.playerId;
    const player = game.players.find((item) => item.id === playerId);
    const opponent = game.players.find((item) => item.id !== playerId);
    const instance = (card, id) => ({
      ...structuredClone(card), instanceId: id, ownerId: player.id, controllerId: player.id,
      exhausted: false, damage: 0, movesThisTurn: 0, modifiers: [], attachments: []
    });
    Object.assign(game, {
      phase: "action", turnPlayerId: player.id, currentPlayerId: player.id,
      pendingChoice: null, pendingPayment: null, actionChain: null, showdown: null,
      triggerQueue: [], selectedCardId: null, winnerId: null
    });
    player.score = 0;
    player.turnScoredBattlefields = [];
    player.base = [instance(cards.lonelyPoro, "sanctum-unit")];
    player.mainDeck = [cards.charm, cards.gust, cards.flash].slice(0, count)
      .map((card, index) => instance(card, `sanctum-card-${index}`));
    game.battlefields[0] = {
      ...instance(cards.theCandlelitSanctum, "sanctum-field"),
      ownerId: opponent.id, controlledBy: opponent.id, hidden: [], units: []
    };
    const moved = moveUnit(game, "sanctum-unit", "sanctum-field");
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    for (let index = 0; index < 8 && !game.pendingChoice; index += 1) {
      const chain = game.actionChain || game.showdown;
      if (!chain) break;
      const passed = passShowdown(game, chain.priorityPlayerId);
      if (!passed.ok) throw new Error(JSON.stringify(passed));
    }
    if (game.pendingChoice?.effect !== "recycleTopDeck") throw new Error(`Missing recycle choice: ${game.pendingChoice?.effect || game.phase}`);
    window.__riftboundRender();
    return player.id;
  }, count);
}

async function deckOrder(page, playerId) {
  return page.evaluate((id) => window.__riftboundGame.players.find((player) => player.id === id)
    .mainDeck.map((card) => card.instanceId), playerId);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`top deck choice previews and confirms every recycle and order option at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await openReadyBoard(page);
    const panel = page.locator(".top-deck-choice-panel");
    const confirm = panel.locator('[data-action="confirm-staged-choice"]');
    const toggle = (index) => panel.locator(`[data-card-id="sanctum-card-${index}"] .top-deck-recycle-toggle`);
    for (const option of ["keep", "swap", "recycle-0", "recycle-1", "recycle-all"]) {
      const playerId = await conquerSanctum(page);
      await expect(panel).toBeVisible();
      await expect(panel.locator(".top-deck-choice-card")).toHaveCount(2);
      await expect(confirm).toHaveText("이 순서로 덱 위에 놓기");
      // A choice is only staged; undoing it or inspecting a card never resolves it.
      await toggle(0).click();
      await expect(toggle(0)).toHaveAttribute("aria-pressed", "true");
      if (option === "keep") {
        await panel.locator('[data-action="view-choice-card"]').first().click();
        await expect(page.locator('[data-action="close-full-card"]')).toBeVisible();
        await page.locator('[data-action="close-full-card"]').click();
        await expect(toggle(0)).toHaveAttribute("aria-pressed", "true");
      }
      await toggle(0).click();
      await expect(toggle(0)).toHaveAttribute("aria-pressed", "false");
      if (option === "swap") await panel.locator("[data-top-deck-swap]").click();
      if (option === "recycle-0" || option === "recycle-1") await toggle(Number(option.at(-1))).click();
      if (option === "recycle-all") {
        await panel.getByRole("button", { name: "모두 재활용하기", exact: true }).click();
        await expect(toggle(0)).toHaveAttribute("aria-pressed", "true");
        await expect(toggle(1)).toHaveAttribute("aria-pressed", "true");
        await toggle(1).click();
        await expect(confirm).toHaveText("1장 재활용 확정");
        await toggle(1).click();
        await expect(confirm).toHaveText("2장 재활용 확정");
        await expect(panel.locator(".top-deck-return-order")).toContainText("남기는 카드 없음");
      }
      expect(await deckOrder(page, playerId)).toEqual(["sanctum-card-0", "sanctum-card-1", "sanctum-card-2"]);
      await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingChoice?.effect)).toBe("recycleTopDeck");
      await expect(confirm).toBeInViewport({ ratio: 1 });
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (option === "swap") {
        await expect(panel.locator('[data-card-id="sanctum-card-1"] .top-deck-destination')).toContainText("덱 위 1번째");
        for (const image of await panel.locator(".choice-card-art").all()) await expect(image).toBeInViewport({ ratio: 0.95 });
        await expect(panel.locator(".top-deck-choice-result")).toBeInViewport({ ratio: 0.95 });
        await page.screenshot({ path: testInfo.outputPath("top-deck-choice.png") });
      }
      await confirm.click();
      await expect(panel).toHaveCount(0);
      const result = await deckOrder(page, playerId);
      const order = {
        keep: [0, 1, 2], swap: [1, 0, 2], "recycle-0": [1, 2, 0], "recycle-1": [0, 2, 1]
      };
      if (option === "recycle-all") {
        expect(result[0]).toBe("sanctum-card-2");
        expect(result.slice(1).sort()).toEqual(["sanctum-card-0", "sanctum-card-1"]);
      } else expect(result).toEqual(order[option].map((index) => `sanctum-card-${index}`));
    }
    // A one-card deck still offers keep/recycle without meaningless ordering controls.
    await conquerSanctum(page, 1);
    await expect(panel.locator(".top-deck-choice-card")).toHaveCount(1);
    await expect(panel.locator("[data-top-deck-swap]")).toHaveCount(0);
    await toggle(0).click();
    await expect(confirm).toHaveText("1장 재활용 확정");
    await confirm.click();
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
