import { expect, test } from "@playwright/test";

const GAME_LOG_KEY = "riftbound.gameDiagnostic.v1";
const ONLINE_SEAT_KEY = "riftbound.onlineSeat.v1";

async function openLocalMultiplayer(page) {
  await page.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await page.locator('[data-action="menu-multiplayer"]').click();
  await expect(page.locator('[data-action="online-create"]')).toBeVisible();
}

async function roomCode(page) {
  const roomPanel = page.locator(".multiplayer-panel").filter({
    has: page.locator('[data-action="online-leave"]')
  });
  const heading = await roomPanel.locator("h2").textContent();
  const match = String(heading).match(/\b([A-Z2-9]{4})\b/u);
  expect(match, `room heading did not contain a room code: ${heading}`).not.toBeNull();
  return match[1];
}

async function createAndJoinRoom(host, guest) {
  await host.locator('[data-action="online-create"]').click();
  const code = await roomCode(host);
  await guest.locator('[data-action="online-code-input"]').fill(code);
  await guest.locator('[data-action="online-join-code"]').click();
  await expect(guest.locator('[data-action="online-leave"]')).toBeVisible();
  return code;
}

async function readyOnlineGame(host, guest) {
  await host.locator('[data-action="online-submit-deck"]').click();
  await guest.locator('[data-action="online-submit-deck"]').click();
  await host.locator('[data-action="online-ready"]').click();
  await guest.locator('[data-action="online-ready"]').click();
  await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
}

async function requestSurrender(page) {
  await page.locator('[data-action="surrender"]').click();
  await page.locator('.game-exit-modal [data-action="confirm-game-exit"]').click();
}

async function requestEmergencyUiStop(page, marker) {
  await page.evaluate((message) => {
    const error = new Error(message);
    window.dispatchEvent(new ErrorEvent("error", { error, message }));
  }, marker);
  const stop = page.locator("[data-ui-exception-stop]");
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.locator(".emergency-game-stop-screen")).toBeVisible();
}

async function deferRequests(page, pattern, options = {}) {
  const entries = [];
  await page.route(pattern, async (route) => {
    if (options.method && route.request().method() !== options.method) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => {
      entries.push({ route, resolve, released: false });
    });
  });
  return {
    count() {
      return entries.length;
    },
    async waitForCount(count) {
      await expect.poll(() => entries.length).toBe(count);
    },
    async release(index, response = { status: 200, body: JSON.stringify({ ok: true }) }) {
      const entry = entries[index];
      expect(entry, `deferred request ${index} was not captured`).toBeTruthy();
      if (entry.released) return;
      entry.released = true;
      await entry.route.fulfill({
        contentType: "application/json",
        ...response
      });
      entry.resolve();
    },
    async forward(index) {
      const entry = entries[index];
      expect(entry, `deferred request ${index} was not captured`).toBeTruthy();
      if (entry.released) return;
      entry.released = true;
      await entry.route.continue();
      entry.resolve();
    },
    async releaseAll() {
      for (let index = 0; index < entries.length; index += 1) {
        if (entries[index].released) continue;
        try {
          await this.release(index);
        } catch {
          entries[index].resolve();
        }
      }
    }
  };
}

async function deferServerResponses(page, pattern, options = {}) {
  const entries = [];
  await page.route(pattern, async (route) => {
    if (options.method && route.request().method() !== options.method) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => {
      entries.push({ route, response, resolve, released: false });
    });
  });
  return {
    async waitForCount(count) {
      await expect.poll(() => entries.length).toBe(count);
    },
    async release(index, override = null) {
      const entry = entries[index];
      expect(entry, `deferred response ${index} was not captured`).toBeTruthy();
      if (entry.released) return;
      entry.released = true;
      await entry.route.fulfill(override || { response: entry.response });
      entry.resolve();
    },
    async releaseAll() {
      for (let index = 0; index < entries.length; index += 1) {
        if (entries[index].released) continue;
        try {
          await this.release(index);
        } catch {
          entries[index].resolve();
        }
      }
    }
  };
}

test("seat acquisition is single-flight across rapid create and join requests", async ({ page }) => {
  test.setTimeout(40_000);
  await openLocalMultiplayer(page);
  await page.locator('[data-action="online-code-input"]').fill("ABCD");
  const seats = await deferRequests(page, "**/api/rooms**", { method: "POST" });

  try {
    await page.locator('[data-action="online-create"]').click();
    await seats.waitForCount(1);
    await expect(page.locator('[data-action="online-create"]')).toBeDisabled();
    await expect(page.locator('[data-action="online-join-code"]')).toBeDisabled();
    await expect(page.locator('[data-action="online-code-input"]')).toBeDisabled();

    // dispatchEvent deliberately bypasses the disabled control's native click
    // suppression to exercise the callback-level single-flight guard too.
    await page.evaluate(() => {
      for (const action of ["online-create", "online-join-code"]) {
        document.querySelector(`[data-action="${action}"]`)
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    await page.waitForTimeout(400);
    expect(seats.count()).toBe(1);

    await seats.release(0, {
      status: 500,
      body: JSON.stringify({ ok: false, message: "held seat request released" })
    });
    await expect(page.locator('[data-action="online-create"]')).toBeEnabled();
  } finally {
    await seats.releaseAll();
  }
});

for (const mutation of [
  { kind: "submit-deck", action: "online-submit-deck", endpoint: "deck", outcome: "success" },
  { kind: "ready", action: "online-ready", endpoint: "ready", outcome: "failure" }
]) {
  test(`a stale ${mutation.kind} ${mutation.outcome} cannot overwrite a replacement seat`, async ({ page }) => {
    test.setTimeout(55_000);
    await openLocalMultiplayer(page);
    await page.locator('[data-action="online-create"]').click();
    const oldCode = await roomCode(page);
    if (mutation.kind === "ready") {
      await page.locator('[data-action="online-submit-deck"]').click();
      await expect(page.locator('[data-action="online-ready"]')).toBeEnabled();
    }
    const requests = await deferRequests(page, `**/api/rooms/*/${mutation.endpoint}`, { method: "POST" });

    try {
      await page.locator(`[data-action="${mutation.action}"]`).click();
      await requests.waitForCount(1);
      await page.locator('[data-action="online-leave"]').click();
      await expect(page.locator('[data-action="online-leave"]')).toHaveCount(0);

      await page.locator('[data-action="online-create"]').click();
      const newCode = await roomCode(page);
      expect(newCode).not.toBe(oldCode);
      const newSeat = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY);

      if (mutation.outcome === "success") {
        await requests.release(0, {
          status: 200,
          body: JSON.stringify({
            ok: true,
            room: { roomId: oldCode, status: "lobby", playerCount: 1, seats: {}, sideboardingEnabled: false }
          })
        });
      } else {
        await requests.release(0, {
          status: 500,
          body: JSON.stringify({ ok: false, message: "late old room mutation failure" })
        });
      }
      await page.waitForTimeout(400);

      await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY))
        .toEqual(newSeat);
      await expect(page.locator(".multiplayer-panel", { hasText: newCode }).filter({
        has: page.locator('[data-action="online-leave"]')
      })).toBeVisible();
      await expect(page.getByText("late old room mutation failure", { exact: false })).toHaveCount(0);
    } finally {
      await requests.releaseAll();
    }
  });
}

test("double leave is single-flight and its late completion cannot clear a newly joined seat", async ({ page }) => {
  test.setTimeout(50_000);
  await openLocalMultiplayer(page);
  await page.locator('[data-action="online-create"]').click();
  await expect(page.locator('[data-action="online-leave"]')).toBeVisible();
  const oldSeat = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY);
  const leaves = await deferRequests(page, "**/api/rooms/*/leave");

  try {
    await page.locator('[data-action="online-leave"]').click();
    await page.locator('[data-action="online-leave"]').click();
    await leaves.waitForCount(1);

    await page.locator('[data-action="online-create"]').click();
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key))?.roomId, ONLINE_SEAT_KEY))
      .not.toBe(oldSeat.roomId);
    await expect(page.locator('[data-action="online-create"]')).toBeEnabled();
    const newSeat = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY);
    await expect(page.locator('[data-action="online-leave"]')).toBeVisible();

    await leaves.release(0);
    await page.waitForTimeout(400);

    expect(leaves.count()).toBe(1);
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY))
      .toEqual(newSeat);
    await expect(page.locator('[data-action="online-leave"]')).toBeVisible();
  } finally {
    await leaves.releaseAll();
  }
});

test("a held multiplayer leave times out locally and returns to the lobby", async ({ page }) => {
  test.setTimeout(30_000);
  await openLocalMultiplayer(page);
  await page.locator('[data-action="online-create"]').click();
  await expect(page.locator('[data-action="online-leave"]')).toBeVisible();
  const leaves = await deferRequests(page, "**/api/rooms/*/leave");

  try {
    await page.clock.install();
    await page.locator('[data-action="online-leave"]').click();
    await leaves.waitForCount(1);
    await page.clock.fastForward(8_100);

    await expect(page.locator('[data-action="online-create"]')).toBeVisible();
    await expect(page.locator('[data-action="online-leave"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ONLINE_SEAT_KEY)).toBeNull();
    await expect(page.locator('.online-leave-notice[role="alert"]')).toBeVisible();

    await leaves.release(0);
    await expect(page.locator('[data-action="online-leave"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ONLINE_SEAT_KEY)).toBeNull();
  } finally {
    await leaves.releaseAll();
  }
});

test("a failed in-game emergency stop can be preserved and gates every replacement action", async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let commands = null;

  try {
    await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
    const code = await createAndJoinRoom(host, guest);
    await readyOnlineGame(host, guest);

    commands = await deferRequests(guest, "**/api/rooms/*/commands");
    await guest.evaluate(() => {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.dataset.action = "stop-after-ui-error";
      document.querySelector("#app").appendChild(stop);
      stop.click();
    });
    await expect(guest.locator(".emergency-game-stop-screen")).toBeVisible();
    await commands.waitForCount(1);
    await commands.release(0, {
      status: 500,
      body: JSON.stringify({ ok: false, message: "forced emergency failure" })
    });
    await expect(guest.locator('[data-action="bug-report-retry-online-stop"]')).toBeVisible();

    await guest.locator('[data-action="bug-report-preserve-local"]').click();
    await expect(guest.locator('.emergency-game-stop-screen .game-bug-report')).toBeVisible();
    await guest.locator('[data-action="bug-report-return-menu"]').click();
    const recoveredReport = guest.locator('.main-menu .game-bug-report');
    await expect(recoveredReport).toBeVisible();
    await expect(guest.locator(".emergency-game-stop-screen")).toHaveCount(0);
    const oldDiagnostic = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
    expect(oldDiagnostic?.finalization?.details?.locallyPreservedOnly).toBe(true);
    expect(oldDiagnostic?.finalization?.details?.serverStopConfirmed).toBe(false);
    expect(oldDiagnostic?.finalization?.details?.confirmedByAuthoritativeSnapshot).not.toBe(true);
    expect((oldDiagnostic?.events || []).some((event) => event.type === "online-ui-error-stop-confirmed-by-snapshot"))
      .toBe(false);

    let blockedOnlineRequests = 0;
    await guest.route("**/api/rooms**", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      blockedOnlineRequests += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "recovered report gate failed" })
      });
    });
    await guest.evaluate((roomId) => {
      const app = document.querySelector("#app");
      for (const action of ["online-create", "online-join-room", "online-join-code", "online-submit-deck", "online-ready"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action;
        button.dataset.room = roomId;
        app.appendChild(button);
        button.click();
        button.remove();
      }
    }, code);
    await guest.waitForTimeout(250);
    expect(blockedOnlineRequests).toBe(0);
    await guest.unroute("**/api/rooms**");

    await recoveredReport.locator('[data-action="bug-report-decline"]').click();
    await expect(recoveredReport).toHaveCount(0);
    await guest.reload();
    await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
    const persistedSeat = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), ONLINE_SEAT_KEY);
    expect(persistedSeat?.diagnosticGameId).toBeTruthy();
    expect(persistedSeat?.gameNumber).toBe(1);

    await requestSurrender(host);
    await expect(guest.locator(".match-result-modal")).toBeVisible();
    await expect(guest.locator(".emergency-game-stop-screen")).toHaveCount(0);
  } finally {
    if (commands) await commands.releaseAll();
    await hostContext.close();
    await guestContext.close();
  }
});

test("a recovered log missing the current diagnostic id stages the completed snapshot", async ({ browser }) => {
  test.setTimeout(70_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
    await createAndJoinRoom(host, guest);
    await readyOnlineGame(host, guest);
    await requestSurrender(host);
    await expect(guest.locator(".match-result-modal")).toBeVisible();
    const currentSeat = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), ONLINE_SEAT_KEY);
    expect(currentSeat?.diagnosticGameId).toBeTruthy();
    expect(currentSeat?.gameNumber).toBe(1);

    await guest.evaluate((key) => {
      const log = JSON.parse(localStorage.getItem(key) || "null");
      delete log.metadata.diagnosticGameId;
      localStorage.setItem(key, JSON.stringify(log));
    }, GAME_LOG_KEY);
    await guest.reload();

    const recoveredReport = guest.locator('.main-menu .game-bug-report');
    await expect(recoveredReport).toBeVisible();
    await recoveredReport.locator('[data-action="bug-report-decline"]').click();
    await expect(guest.locator(".match-result-modal")).toBeVisible();
    await expect(guest.locator(".emergency-game-stop-screen")).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

for (const lateOutcome of ["success", "failure"]) {
  test(`a late old-session command ${lateOutcome} cannot mutate the rejoined game's diagnostic or pending owner`, async ({ browser }) => {
    test.setTimeout(100_000);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const partnerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const partner = await partnerContext.newPage();
    let commands = null;

    try {
      await Promise.all([
        openLocalMultiplayer(host),
        openLocalMultiplayer(guest),
        openLocalMultiplayer(partner)
      ]);
      await createAndJoinRoom(host, guest);
      await readyOnlineGame(host, guest);

      commands = await deferRequests(guest, "**/api/rooms/*/commands");
      await requestSurrender(guest);
      await commands.waitForCount(1);

      await requestSurrender(host);
      const result = guest.locator(".match-result-modal");
      await expect(result).toBeVisible();
      await result.locator('[data-action="bug-report-decline"]').click();
      await result.locator('[data-action="exit-completed-game"]').click();
      await expect(guest.locator('[data-action="online-create"]')).toBeVisible();
      await expect(guest.locator('[data-action="online-leave"]')).toHaveCount(0);

      await createAndJoinRoom(guest, partner);
      await readyOnlineGame(guest, partner);
      await requestSurrender(guest);
      await commands.waitForCount(2);

      if (lateOutcome === "success") {
        await commands.release(0);
      } else {
        await commands.release(0, {
          status: 500,
          body: JSON.stringify({ ok: false, message: "late old-session failure" })
        });
      }
      await guest.waitForTimeout(400);

      const completedSurrenders = await guest.evaluate((key) => {
        const log = JSON.parse(localStorage.getItem(key) || "null");
        return (log?.commands || []).filter((entry) => entry.command?.kind === "surrender");
      }, GAME_LOG_KEY);
      expect(completedSurrenders).toEqual([]);
      await expect(guest.getByText("late old-session failure", { exact: false })).toHaveCount(0);

      // The second request owns commandPending in the new session. A third UI
      // attempt must remain blocked after the old promise settles.
      await requestSurrender(guest);
      await guest.waitForTimeout(400);
      expect(commands.count()).toBe(2);
    } finally {
      if (commands) await commands.releaseAll();
      await hostContext.close();
      await guestContext.close();
      await partnerContext.close();
    }
  });
}

for (const lateRestartOutcome of ["success", "failure"]) {
  test(`a new-game snapshot retires the previous restart command before its late HTTP ${lateRestartOutcome}`, async ({ browser }) => {
    test.setTimeout(100_000);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    let responses = null;

    try {
      await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
      await createAndJoinRoom(host, guest);
      await readyOnlineGame(host, guest);
      await requestSurrender(guest);

      const result = guest.locator(".match-result-modal");
      await expect(result).toBeVisible();
      await result.locator('[data-action="bug-report-decline"]').click();
      await result.locator('[data-action="review-result"]').click();
      await expect(result).toHaveCount(0);

      responses = await deferServerResponses(guest, "**/api/rooms/*/commands", { method: "POST" });
      await guest.locator('.tabletop-topbar [data-action="new-game"]').click();
      await guest.locator('.game-exit-modal [data-action="confirm-game-exit"]').click();
      await responses.waitForCount(1);

      // The server has already published the replacement game's SSE snapshot,
      // while the browser-side fetch remains unresolved behind the route above.
      await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
      await expect(guest.locator(".tabletop-topbar .status-processing")).toHaveCount(0);
      await expect(guest.getByText("서버 응답을 기다리는 중입니다", { exact: true })).toHaveCount(0);

      await responses.release(0, lateRestartOutcome === "failure" ? {
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "late restart response failure" })
      } : null);
      await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
      await expect(guest.getByText("late restart response failure", { exact: false })).toHaveCount(0);
      const currentCommands = await guest.evaluate((key) => {
        const log = JSON.parse(localStorage.getItem(key) || "null");
        return (log?.commands || []).map((entry) => entry.command?.kind);
      }, GAME_LOG_KEY);
      expect(currentCommands).not.toContain("restartGame");
    } finally {
      if (responses) await responses.releaseAll();
      await hostContext.close();
      await guestContext.close();
    }
  });
}

test("a repeated completed-game snapshot cannot recreate a declined report while restart is queued", async ({ browser }) => {
  test.setTimeout(100_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let restartRequests = null;
  let hostDeckRecord = null;

  try {
    await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
    await host.route("**/api/rooms/*/deck", async (route) => {
      hostDeckRecord = route.request().postDataJSON()?.deckRecord || hostDeckRecord;
      await route.continue();
    });
    await createAndJoinRoom(host, guest);
    await readyOnlineGame(host, guest);
    expect(hostDeckRecord).toBeTruthy();
    await requestSurrender(guest);

    const result = guest.locator(".match-result-modal");
    await expect(result).toBeVisible();
    await result.locator('[data-action="bug-report-decline"]').click();
    await result.locator('[data-action="review-result"]').click();
    await expect.poll(() => guest.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
    const completedSeat = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY);

    restartRequests = await deferRequests(guest, "**/api/rooms/*/commands", { method: "POST" });
    await guest.locator('.tabletop-topbar [data-action="new-game"]').click();
    await guest.locator('.game-exit-modal [data-action="confirm-game-exit"]').click();
    await restartRequests.waitForCount(1);

    // Publish the exact same completed game while restartGame is still waiting
    // to reach the server. It must not be mistaken for a replacement game.
    const republishStatus = await host.evaluate(async ({ seatKey, deckRecord }) => {
      const seat = JSON.parse(localStorage.getItem(seatKey));
      const response = await fetch(`/api/rooms/${encodeURIComponent(seat.roomId)}/deck`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerToken: seat.playerToken, deckRecord })
      });
      return response.status;
    }, { seatKey: ONLINE_SEAT_KEY, deckRecord: hostDeckRecord });
    expect(republishStatus).toBe(200);
    await guest.waitForTimeout(400);
    expect(await guest.evaluate((key) => localStorage.getItem(key), GAME_LOG_KEY)).toBeNull();
    await expect(guest.locator(".main-menu .game-bug-report")).toHaveCount(0);

    await restartRequests.forward(0);
    await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
    await expect(guest.locator(".main-menu .game-bug-report")).toHaveCount(0);
    const replacement = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key)), GAME_LOG_KEY);
    expect(replacement?.finalization).toBeNull();
    expect(replacement?.metadata?.diagnosticGameId).toBeTruthy();
    expect(replacement?.metadata?.diagnosticGameId).not.toBe(completedSeat?.diagnosticGameId);
  } finally {
    if (restartRequests) await restartRequests.releaseAll();
    await hostContext.close();
    await guestContext.close();
  }
});

test("resumable diagnostic recovery blocks every new-game entry and can be preserved when offline", async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
    await createAndJoinRoom(host, guest);
    await readyOnlineGame(host, guest);
    const before = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
    expect(before?.logId).toBeTruthy();
    expect(before?.finalization).toBeNull();
    await guest.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await guest.route("**/api/rooms/*/events?*", (route) => route.abort());
    await guest.reload();

    const recovery = guest.locator(".diagnostic-recovery-wait");
    await expect(recovery).toBeVisible();
    for (const action of ["menu-start", "menu-ai", "menu-multiplayer", "menu-tutorial"]) {
      await expect(guest.locator(`[data-action="${action}"]`)).toBeDisabled();
    }
    await guest.evaluate(() => {
      for (const action of ["menu-start", "menu-ai", "menu-multiplayer", "menu-tutorial", "tutorial-select"]) {
        const button = document.createElement("button");
        button.dataset.action = action;
        button.dataset.tutorial = "first-victory";
        document.querySelector("#app").appendChild(button);
        button.click();
        button.remove();
      }
    });
    await guest.waitForTimeout(250);
    const stillPreserved = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
    expect(stillPreserved?.logId).toBe(before.logId);
    expect(stillPreserved?.finalization).toBeNull();

    const seatBeforeAbandon = await guest.evaluate((key) => localStorage.getItem(key), ONLINE_SEAT_KEY);
    await recovery.locator('[data-action="diagnostic-recovery-abandon"]').click();
    await expect(guest.locator('[data-action="bug-report-open"]')).toBeVisible();
    const recovered = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
    expect(recovered?.logId).toBe(before.logId);
    expect(recovered?.finalization?.reason).toBe("ui-error");
    expect(recovered?.finalization?.details?.recoveryFailure).toBe("connection-unavailable");
    expect(recovered?.finalization?.details?.recoveryAbandonedByUser).toBe(true);
    await expect.poll(() => guest.evaluate((key) => localStorage.getItem(key), ONLINE_SEAT_KEY))
      .toBe(seatBeforeAbandon);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("a resumable recorder only accepts an exact diagnostic snapshot and stages a mismatched game", async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
    await createAndJoinRoom(host, guest);
    await readyOnlineGame(host, guest);
    await guest.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await guest.evaluate((key) => {
      const log = JSON.parse(localStorage.getItem(key) || "null");
      log.metadata.diagnosticGameId = "stale-diagnostic-game";
      localStorage.setItem(key, JSON.stringify(log));
    }, GAME_LOG_KEY);
    await guest.reload();

    const report = guest.locator('.main-menu [data-action="bug-report-open"]');
    await expect(report).toBeVisible();
    const recovered = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
    expect(recovered?.metadata?.diagnosticGameId).toBe("stale-diagnostic-game");
    expect(recovered?.finalization?.reason).toBe("ui-error");
    expect(recovered?.finalization?.details?.recoveryFailure).toBe("diagnostic-identity-mismatch");

    await guest.locator('.main-menu [data-action="bug-report-decline"]').click();
    await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
    const replacement = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
    expect(replacement?.metadata?.diagnosticGameId).not.toBe("stale-diagnostic-game");
    expect(replacement?.finalization).toBeNull();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("a delayed lobby fetch cannot replace a completed SSE game report or leave loading stuck", async ({ browser }) => {
  test.setTimeout(100_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let releaseEvents = null;
  let rooms = null;

  try {
    await Promise.all([openLocalMultiplayer(host), openLocalMultiplayer(guest)]);
    await createAndJoinRoom(host, guest);
    await readyOnlineGame(host, guest);
    // Commit the in-memory diagnostic before deliberately deleting its stored
    // recovery copy. Otherwise the real reload boundary correctly writes a
    // still-dirty checkpoint back while this test is trying to suppress it.
    await guest.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await guest.evaluate((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem("riftbound.gameDiagnosticReload.v1");
    }, GAME_LOG_KEY);

    let releaseEventRequest;
    const eventRequestReleased = new Promise((resolve) => { releaseEventRequest = resolve; });
    releaseEvents = releaseEventRequest;
    await guest.route("**/api/rooms/*/events?*", async (route) => {
      await eventRequestReleased;
      await route.continue();
    });
    rooms = await deferRequests(guest, "**/api/rooms", { method: "GET" });
    await guest.reload();
    await expect(guest.locator('[data-action="menu-multiplayer"]')).toBeVisible();
    await guest.locator('[data-action="menu-multiplayer"]').click();
    await rooms.waitForCount(1);

    releaseEvents();
    await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
    await requestSurrender(host);
    await expect(guest.locator(".match-result-modal")).toBeVisible();

    await rooms.release(0, {
      status: 200,
      body: JSON.stringify({ ok: true, rooms: [] })
    });
    await guest.waitForTimeout(400);
    await expect(guest.locator(".match-result-modal")).toBeVisible();
    await expect(guest.locator(".main-menu")).toHaveCount(0);
    await expect(guest.getByText("멀티플레이 서버에 연결 중입니다.", { exact: false })).toHaveCount(0);
  } finally {
    releaseEvents?.();
    if (rooms) await rooms.releaseAll();
    await hostContext.close();
    await guestContext.close();
  }
});

for (const lateOutcome of ["success", "failure"]) {
  test(`a late old-session emergency stop ${lateOutcome} cannot close or finalize the rejoined game`, async ({ browser }) => {
    test.setTimeout(100_000);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const partnerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const partner = await partnerContext.newPage();
    let commands = null;

    try {
      await Promise.all([
        openLocalMultiplayer(host),
        openLocalMultiplayer(guest),
        openLocalMultiplayer(partner)
      ]);
      await createAndJoinRoom(host, guest);
      await readyOnlineGame(host, guest);

      commands = await deferRequests(guest, "**/api/rooms/*/commands");
      await requestEmergencyUiStop(guest, `old emergency ${lateOutcome}`);
      await commands.waitForCount(1);

      // The authoritative snapshot wins before the held stop response.
      await requestSurrender(host);
      const emergency = guest.locator(".emergency-game-stop-screen");
      await expect(emergency.locator('[data-action="bug-report-decline"]')).toBeVisible();
      await emergency.locator('[data-action="bug-report-decline"]').click();
      await emergency.locator('[data-action="bug-report-return-menu"]').click();
      await guest.locator('[data-action="menu-multiplayer"]').click();
      await expect(guest.locator('[data-action="online-leave"]')).toBeVisible();
      await guest.locator('[data-action="online-leave"]').click();
      await expect(guest.locator('[data-action="online-leave"]')).toHaveCount(0);

      await createAndJoinRoom(guest, partner);
      await readyOnlineGame(guest, partner);
      const newSeat = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY);

      if (lateOutcome === "success") {
        await commands.release(0);
      } else {
        await commands.release(0, {
          status: 500,
          body: JSON.stringify({ ok: false, message: "late emergency stop failure" })
        });
      }
      await guest.waitForTimeout(400);

      const diagnostic = await guest.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), GAME_LOG_KEY);
      expect(diagnostic?.finalization).toBeNull();
      expect((diagnostic?.commands || []).filter((entry) => entry.command?.source === "ui-error-stop")).toEqual([]);
      expect((diagnostic?.events || []).filter((entry) => entry.type === "online-ui-error-stop")).toEqual([]);
      await expect(guest.locator(".emergency-game-stop-screen")).toHaveCount(0);
      await expect(guest.locator(".first-player-screen, .champion-setup")).toBeVisible();
      await expect.poll(() => guest.evaluate((key) => JSON.parse(localStorage.getItem(key)), ONLINE_SEAT_KEY))
        .toEqual(newSeat);

      // A new authoritative event must still arrive; a late old success must
      // not have closed the new room's EventSource.
      await requestSurrender(partner);
      await expect(guest.locator(".match-result-modal")).toBeVisible();
    } finally {
      if (commands) await commands.releaseAll();
      await hostContext.close();
      await guestContext.close();
      await partnerContext.close();
    }
  });
}
