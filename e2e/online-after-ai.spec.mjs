import { expect, test } from "@playwright/test";

const GAME_LOG_KEY = "riftbound.gameDiagnostic.v1";

async function openMenu(page) {
  // Keep these tests on the isolated local multiplayer server.
  await page.route("**/build-info.json", route => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
}

async function selectBundledAi(page, request) {
  const catalog = await (await request.get("/api/ai/generations")).json();
  const generation = catalog.generations.find(entry => entry.kind === "bundled").generation;
  await expect(page.locator(`[data-action="menu-ai-generation"] option[value="${generation}"]`)).toHaveCount(1);
  await page.locator('[data-action="menu-ai-generation"]').selectOption(String(generation));
  await page.locator('[data-action="menu-active-deck"][data-slot="1"]').selectOption("default-origins-kaisa");
}

async function finishAiGame(page, request) {
  await selectBundledAi(page, request);
  await page.locator('[data-action="menu-ai"]').click();
  await expect(page.locator('[data-action="roll-first-player"]')).toBeEnabled({ timeout: 120_000 });
  await page.locator('[data-action="surrender"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();
  await page.locator('[data-action="bug-report-decline"]').click();
  await page.locator('.match-result-modal [data-action="exit-completed-game"]').click();
  await expect(page.locator('[data-action="menu-multiplayer"]')).toBeEnabled();
}

async function enterMultiplayer(page) {
  await page.locator('[data-action="menu-multiplayer"]').click();
  await expect(page.locator('[data-action="online-create"]')).toBeEnabled();
}

async function readDecision(page) {
  return page.evaluate(() => window.__riftboundGame.firstPlayerDecision);
}

for (const priorAiSeat of ["host", "guest"]) {
  test(`multiplayer after AI in the same tab keeps ${priorAiSeat} dice server-authoritative`, async ({ page: host, browser, baseURL, request }) => {
    test.setTimeout(180_000);
    const guestContext = await browser.newContext({ baseURL });
    const guest = await guestContext.newPage();
    const pages = [host, guest];
    const errors = [];
    for (const page of pages) page.on("pageerror", error => errors.push(error.message));
    try {
      await Promise.all(pages.map(openMenu));
      await finishAiGame(priorAiSeat === "host" ? host : guest, request);
      await Promise.all(pages.map(enterMultiplayer));
      await host.locator('[data-action="online-create"]').click();
      // This button is already visible (disabled) before room creation. Wait
      // for the server response and persisted seat, not the lobby's layout.
      await expect(host.locator('[data-action="online-submit-deck"]')).toBeEnabled();
      const seat = await host.evaluate(() => JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1")));
      await guest.locator('[data-action="online-code-input"]').fill(seat.roomId);
      await guest.locator('[data-action="online-join-code"]').click();
      for (const page of pages) await page.locator('[data-action="online-submit-deck"]').click();
      for (const page of pages) await page.locator('[data-action="online-ready"]').click();
      for (const page of pages) {
        await expect(page.locator(".first-player-screen")).toBeVisible();
        await expect(page.locator('[data-action="coach-report"]')).toHaveCount(0);
      }
      await expect(host.locator('[data-action="roll-first-player"]')).toBeEnabled();
      await expect(guest.locator('[data-action="roll-first-player"]')).toBeDisabled();
      await host.locator('[data-action="roll-first-player"]').click();
      await expect(guest.locator('[data-action="roll-first-player"]')).toBeEnabled();
      // Observe beyond the AI scheduling delay, not just the first SSE update.
      await guest.waitForTimeout(2000);
      const awaitingGuest = await readDecision(host);
      expect(await readDecision(guest)).toEqual(awaitingGuest);
      expect(awaitingGuest.rolls.p2).toBeNull();
      await expect(guest.locator('[data-action="roll-first-player"]')).toBeEnabled();

      await guest.locator('[data-action="roll-first-player"]').click();
      await expect.poll(async () => (await readDecision(host)).rollerId).not.toBe("p2");
      await expect.poll(() => readDecision(guest)).toEqual(await readDecision(host));
      for (const page of pages) {
        // SSE can arrive before the command response is persisted to the log.
        await expect.poll(() => page.evaluate(key =>
          JSON.parse(localStorage.getItem(key)).commands.filter(entry =>
            entry.command.kind === "rollFirstPlayer" && entry.context?.online).length,
        GAME_LOG_KEY)).toBe(1);
        const commands = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).commands, GAME_LOG_KEY);
        expect(commands.some(entry => entry.context?.ai)).toBe(false);
        expect(commands.filter(entry => entry.command.kind === "rollFirstPlayer" && entry.context?.online)).toHaveLength(1);
      }
      expect(errors).toEqual([]);
    } finally {
      // A playing room deliberately retains departed seats for reconnection.
      // Complete only this test's match before leaving, including on failure.
      const seats = [];
      for (const page of pages) {
        const seat = await page.evaluate(() => JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1"))).catch(() => null);
        if (!seat?.roomId || !seat?.playerToken) continue;
        seats.push(seat);
      }
      const rooms = (await (await request.get("/api/rooms")).json()).rooms;
      for (const roomId of new Set(seats.map(seat => seat.roomId))) {
        const room = rooms.find(entry => entry.roomId === roomId);
        if (room?.status !== "playing") continue;
        const seat = seats.find(entry => entry.roomId === roomId);
        const surrender = await request.post(`/api/rooms/${roomId}/commands`, { data: {
          playerToken: seat.playerToken,
          command: { kind: "surrender", expectedDiagnosticGameId: room.diagnosticGameId,
            expectedGameNumber: room.match.gameNumber }
        } });
        expect(surrender.ok()).toBe(true);
      }
      for (const seat of seats) {
        const leave = await request.post(`/api/rooms/${seat.roomId}/leave`, { data: { playerToken: seat.playerToken } });
        expect(leave.ok()).toBe(true);
      }
      const remaining = (await (await request.get("/api/rooms")).json()).rooms;
      expect(remaining.filter(room => seats.some(seat => seat.roomId === room.roomId))).toEqual([]);
      await guestContext.close();
    }
  });
}
