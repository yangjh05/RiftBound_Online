import { expect, test } from "@playwright/test";

test("AI replay browser shows model, decks, result and plays selected frames", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  const frames = await page.evaluate(async () => {
    const { createGame } = await import("/src/engine.mjs");
    const start = createGame({ firstPlayerId: "p1", interactive: true, manualActionChainPriority: true });
    const next = structuredClone(start);
    next.phase = "action";
    next.currentPlayerId = "p1";
    next.turnNumber = 2;
    next.players[0].score = 3;
    next.log.unshift("Player 1 ends the turn.");
    next.pendingChoice = {
      playerId: "p1",
      effect: "replay-test-choice",
      card: next.players[0].mainDeck[0],
      options: [],
      optional: false,
      data: {}
    };
    const afterChoice = structuredClone(next);
    afterChoice.turnNumber = 3;
    afterChoice.pendingChoice = null;
    return [
      { sequence: 0, actorId: null, action: null, turnNumber: 1, phase: start.phase, game: start },
      { sequence: 1, actorId: "p1", action: { kind: "endTurn" }, turnNumber: 2, phase: next.phase, game: next },
      { sequence: 2, actorId: "p1", action: { kind: "chooseEffectOption" }, turnNumber: 3, phase: afterChoice.phase, game: afterChoice }
    ];
  });
  const summary = {
    id: "selfplay-e2e",
    createdAt: "2026-07-22T03:00:00.000Z",
    completedAt: "2026-07-22T03:10:00.000Z",
    generation: 12,
    models: [
      { playerId: "p1", generation: 12, role: "learner" },
      { playerId: "p2", generation: 9, role: "league" }
    ],
    decks: [
      { playerId: "p1", id: "origins-annie", name: "Annie", legend: { name: "Annie, Dark Child" } },
      { playerId: "p2", id: "origins-leona", name: "Leona", legend: { name: "Leona, Radiant Dawn" } }
    ],
    winnerId: "p1",
    scores: [8, 5],
    turns: 7,
    actionCount: 1
  };
  await page.route(/\/api\/ai\/selfplay-replays\?limit=40$/u, (route) => route.fulfill({ json: { ok: true, replays: [summary] } }));
  await page.route(/\/api\/ai\/selfplay-replays\/selfplay-e2e$/u, (route) => route.fulfill({
    json: { ok: true, replay: { ...summary, frames } }
  }));

  await page.locator('[data-action="menu-replays"]').click();
  await expect(page.locator(".replay-list-card")).toContainText("G12");
  await expect(page.locator(".replay-list-card")).toContainText("G9");
  await expect(page.locator(".replay-list-card")).toContainText("Annie");
  await expect(page.locator(".replay-list-card")).toContainText("Leona");
  await expect(page.locator(".replay-card-summary")).toContainText("8 : 5");

  await page.locator('[data-action="replay-open"]').click();
  await expect(page.locator(".replay-playback-controls")).toBeVisible();
  await expect(page.locator(".replay-now-playing")).toContainText("0/2");
  await page.locator('[data-action="replay-next"]').click();
  await expect(page.locator(".choice-panel")).toBeVisible();
  await expect(page.locator(".replay-now-playing")).toContainText("1/2");
  await page.locator('[data-action="replay-next"]').click();
  await expect(page.locator(".replay-now-playing")).toContainText("2/2");
  await page.locator('[data-action="replay-viewer"][data-player="p2"]').click();
  await expect(page.locator('[data-action="replay-viewer"][data-player="p2"]')).toHaveClass(/active/u);
  await page.locator('[data-action="replay-exit"]').click();
  await expect(page.locator(".replay-list-card")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
