import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

function capturePageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openLocalApp(page) {
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
}

async function completeLocalSetup(page) {
  await page.locator('[data-action="menu-start"]').click();
  for (let step = 0; step < 20; step += 1) {
    const chooseOrder = page.locator('[data-action="choose-first-player"]:enabled');
    if (await chooseOrder.count()) {
      await chooseOrder.first().click();
      break;
    }
    const roll = page.locator('[data-action="roll-first-player"]:enabled');
    await expect(roll).toHaveCount(1);
      await roll.click();
  }
  await expect(page.locator(".initial-sideboarding-shell")).toBeVisible();
  for (let index = 0; index < 2; index += 1) {
    const lockIn = page.locator('[data-action="sideboard-submit"]:enabled');
    await expect(lockIn).toHaveCount(1);
    await lockIn.click();
  }
  await expect(page.locator(".champion-setup")).toBeVisible();

  for (let index = 0; index < 2; index += 1) {
    const champion = page.locator('[data-action="choose-champion"]:enabled');
    await expect(champion).toHaveCount(1);
    await champion.click();
  }

  for (let index = 0; index < 2; index += 1) {
    const battlefield = page.locator('[data-action="choose-battlefield"]:enabled');
    if (await battlefield.count() === 0) break;
    await battlefield.first().click();
  }

  for (let index = 0; index < 2; index += 1) {
    const keepHand = page.locator('[data-action="skip-mulligan"]');
    await expect(keepHand).toHaveCount(1);
    await keepHand.click();
  }

  await expect(page.locator(".board-panel")).toBeVisible();
}

async function openLocalMultiplayer(page) {
  await page.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await page.locator('[data-action="menu-multiplayer"]').click();
  await expect(page.locator('[data-action="online-create"]')).toBeVisible();
}

async function roomCode(page) {
  const currentRoomPanel = page.locator(".multiplayer-panel").filter({
    has: page.locator('[data-action="online-leave"]')
  });
  await expect(currentRoomPanel).toHaveCount(1);
  const heading = await currentRoomPanel.locator("h2").textContent();
  const match = String(heading).match(/\b([A-Z2-9]{4})\b/u);
  expect(match, `room heading did not contain a room code: ${heading}`).not.toBeNull();
  return match[1];
}

async function clickFirstEnabledAcross(pages, selector) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const enabled = page.locator(`${selector}:enabled`);
      if (!await enabled.count()) continue;
      try {
        await enabled.first().click({ timeout: 1_000 });
        return page;
      } catch {
        // Online snapshots can transfer control between the count and click.
      }
    }
    await pages[0].waitForTimeout(50);
  }
  throw new Error(`No enabled ${selector} control was found`);
}

test("local game reaches the real board without a browser runtime error", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await completeLocalSetup(page);

  await expect(page.locator('[data-action="surrender"]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("local surrender preserves a reproduction log and requires a ten-character description before upload", async ({ page }) => {
  let submittedReport = null;
  await page.route("**/api/bug-reports", async (route) => {
    submittedReport = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reportId: "11111111-1111-4111-8111-111111111111",
        submittedAt: "2026-09-02T00:00:00.000Z"
      })
    });
  });

  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.locator('[data-action="surrender"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();

  const reportPanel = page.locator(".game-bug-report");
  await expect(reportPanel).toContainText("Send this game's reproduction log?");
  await reportPanel.locator('[data-action="bug-report-open"]').click();
  const description = reportPanel.locator('[data-action="bug-report-description"]');
  await expect(description).toHaveAttribute("minlength", "10");
  await expect(description).toHaveAttribute("placeholder", /at least 10 characters/u);
  await description.fill("too short");
  await expect(reportPanel.locator('[data-action="bug-report-submit"]')).toBeDisabled();
  await description.fill("The surrender result did not look correct.");
  await reportPanel.locator('[data-action="bug-report-submit"]').click();

  await expect(reportPanel).toContainText("Log submitted");
  expect(submittedReport.description).toBe("The surrender result did not look correct.");
  expect(submittedReport.log.finalization.reason).toBe("surrender");
  expect(submittedReport.log.commands.at(-1).command.kind).toBe("surrender");
});

test("a UI error after a submitted game report opens a separate follow-up report without changing the first submission", async ({ page }) => {
  const submissions = [];
  await page.route("**/api/bug-reports", async (route) => {
    submissions.push(route.request().postDataJSON());
    const index = submissions.length;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reportId: index === 1
          ? "33333333-3333-4333-8333-333333333333"
          : "44444444-4444-4444-8444-444444444444",
        submittedAt: `2026-09-02T00:00:0${index}.000Z`
      })
    });
  });

  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.locator('[data-action="surrender"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();
  const reportPanel = page.locator(".game-bug-report");
  await reportPanel.locator('[data-action="bug-report-open"]').click();
  await reportPanel.locator('[data-action="bug-report-description"]').fill("The original surrender report description.");
  await reportPanel.locator('[data-action="bug-report-submit"]').click();
  await expect(reportPanel).toContainText("Log submitted");
  const firstSubmission = structuredClone(submissions[0]);

  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("follow-up UI failure after submission"),
      message: "follow-up UI failure after submission"
    }));
  });
  await page.locator("[data-ui-exception-stop]").click();
  await expect(page.locator(".emergency-game-stop .game-bug-report")).toContainText(
    "A new UI error was captured. Send an additional report?"
  );
  await expect(page.locator(".emergency-game-stop .game-bug-report")).toContainText(
    "Your earlier submission or decision is unchanged"
  );
  await page.locator('[data-action="bug-report-open"]').click();
  await page.locator('[data-action="bug-report-description"]').fill("The follow-up UI failure happened on the result screen.");
  await page.locator('[data-action="bug-report-submit"]').click();
  await expect(page.locator(".emergency-game-stop .game-bug-report")).toContainText("Log submitted");

  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(firstSubmission);
  expect(submissions[0].log.finalization.reason).toBe("surrender");
  expect(submissions[0].log.ui.errors.some((entry) => entry.error.message.includes("follow-up UI failure"))).toBe(false);
  expect(submissions[1].log.logId).toBe(submissions[0].log.logId);
  expect(submissions[1].log.finalization.reason).toBe("ui-error");
  expect(submissions[1].log.ui.errors.some((entry) => entry.error.message.includes("follow-up UI failure"))).toBe(true);
  expect(submissions[1].log.events.some((entry) =>
    entry.type === "bug-report-follow-up-after-ui-error"
      && entry.detail.previousChoice === "submitted"
      && entry.detail.previousEndReason === "surrender"
      && entry.detail.previousReportId === "33333333-3333-4333-8333-333333333333")).toBe(true);
});

test("a UI error after declining the completed-game report opens a fresh report decision", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.locator('[data-action="surrender"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();
  await page.locator('[data-action="bug-report-decline"]').click();
  await expect(page.locator(".game-bug-report")).toContainText("This game's log will not be sent");

  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("follow-up UI failure after decline"),
      message: "follow-up UI failure after decline"
    }));
  });
  await page.locator("[data-ui-exception-stop]").click();
  const followUpPanel = page.locator(".emergency-game-stop .game-bug-report");
  await expect(followUpPanel).toContainText("A new UI error was captured. Send an additional report?");
  await expect(followUpPanel.locator('[data-action="bug-report-open"]')).toBeEnabled();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")));
  expect(saved.finalization.reason).toBe("ui-error");
  expect(saved.events.some((entry) =>
    entry.type === "bug-report-follow-up-after-ui-error"
      && entry.detail.previousChoice === "declined")).toBe(true);
});

test("a failed main report request preserves the description and restores report choices", async ({ page }) => {
  await page.route("**/api/bug-reports", (route) => route.abort("timedout"));
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.locator('[data-action="surrender"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();

  const reportPanel = page.locator(".game-bug-report");
  await reportPanel.locator('[data-action="bug-report-open"]').click();
  const description = reportPanel.locator('[data-action="bug-report-description"]');
  await description.fill("Keep this description after the request failure.");
  await reportPanel.locator('[data-action="bug-report-submit"]').click();
  await expect(reportPanel.locator(".game-bug-report-error")).toContainText(
    "Your description is preserved; please retry"
  );
  await expect(description).toHaveValue("Keep this description after the request failure.");
  await expect(reportPanel.locator('[data-action="bug-report-submit"]')).toBeEnabled();
  await expect(reportPanel.locator('[data-action="bug-report-decline"]')).toBeEnabled();
  await expect(reportPanel.locator('[data-action="bug-report-cancel"]')).toBeEnabled();
  await reportPanel.locator('[data-action="bug-report-decline"]').click();
  await expect(page.locator(".result-modal").locator('[data-action="new-game"]')).toBeEnabled();
});

test("an incomplete 2xx report receipt preserves the log and description for retry", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/bug-reports", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(requests === 1
        ? {
          ok: true,
          reportId: "77777777-7777-4777-8777-777777777777"
        }
        : {
          ok: true,
          reportId: "77777777-7777-4777-8777-777777777777",
          submittedAt: "2026-09-02T00:00:07.000Z"
        })
    });
  });
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.locator('[data-action="surrender"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();

  const reportPanel = page.locator(".game-bug-report");
  await reportPanel.locator('[data-action="bug-report-open"]').click();
  const description = reportPanel.locator('[data-action="bug-report-description"]');
  const reportDescription = "Keep this report after an incomplete success receipt.";
  await description.fill(reportDescription);
  const logId = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).logId);

  await reportPanel.locator('[data-action="bug-report-submit"]').click();
  await expect(reportPanel.locator(".game-bug-report-error")).toContainText(
    "Your description is preserved; please retry"
  );
  await expect(description).toHaveValue(reportDescription);
  await expect(reportPanel.locator('[data-action="bug-report-submit"]')).toBeEnabled();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).logId)).toBe(logId);

  await reportPanel.locator('[data-action="bug-report-submit"]').click();
  await expect(reportPanel).toContainText("Log submitted");
  expect(requests).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem("riftbound.gameDiagnostic.v1"))).toBeNull();
});

test("an in-progress single game starts one fresh local game after declining its surrender report", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  const previousLogId = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).logId);

  await page.locator(".tabletop-topbar").locator('[data-action="new-game"]').click();
  await expect(page.locator(".game-exit-modal")).toBeVisible();
  await page.locator('[data-action="confirm-game-exit"]').click();
  await expect(page.locator(".game-bug-report")).toContainText("Send this game's reproduction log?");
  await page.locator('[data-action="bug-report-decline"]').click();

  await expect(page.locator(".first-player-screen")).toBeVisible();
  const restarted = await page.evaluate(() => ({
    phase: window.__riftboundGame.phase,
    log: JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1"))
  }));
  expect(restarted.phase).toBe("first-player");
  expect(restarted.log.logId).not.toBe(previousLogId);
  expect(restarted.log.finalization).toBeNull();
  expect(restarted.log.metadata.sideboardingEnabled).toBe(false);
  expect(restarted.log.metadata.startedFromPostReportContinuation).toBe(true);
  expect(restarted.log.metadata.postReportContinuationId).toBeTruthy();

  await page.waitForTimeout(300);
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).logId)).toBe(restarted.log.logId);
});

test("an in-progress sideboarding match starts one fresh match after submitting its surrender report", async ({ page }) => {
  const submissions = [];
  await page.route("**/api/bug-reports", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reportId: "55555555-5555-4555-8555-555555555555",
        submittedAt: "2026-09-02T00:00:05.000Z"
      })
    });
  });
  await openLocalApp(page);
  await page.locator('[data-action="settings-sideboarding"]').check();
  await page.locator('[data-action="menu-start"]').click();
  const previousLogId = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).logId);

  await page.locator(".tabletop-topbar").locator('[data-action="new-game"]').click();
  await page.locator('[data-action="confirm-game-exit"]').click();
  await expect(page.locator(".sideboarding-screen .game-bug-report")).toContainText(
    "Send this game's reproduction log?"
  );
  await page.locator('[data-action="bug-report-open"]').click();
  await page.locator('[data-action="bug-report-description"]').fill(
    "Start a fresh match after this in-progress game was replaced."
  );
  await page.locator('[data-action="bug-report-submit"]').click();

  await expect(page.locator(".champion-setup")).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0].log.finalization.reason).toBe("surrender");
  expect(submissions[0].log.commands.at(-1).command).toMatchObject({
    kind: "surrender",
    source: "new-game-request"
  });
  const restarted = await page.evaluate(() => ({
    phase: window.__riftboundGame.phase,
    log: JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1"))
  }));
  expect(restarted.phase).toBe("champion-select");
  expect(restarted.log.logId).not.toBe(previousLogId);
  expect(restarted.log.finalization).toBeNull();
  expect(restarted.log.metadata.gameNumber).toBe(1);
  expect(restarted.log.metadata.sideboardingEnabled).toBe(true);
  expect(restarted.log.metadata.startedFromPostReportContinuation).toBe(true);

  await page.waitForTimeout(300);
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).logId)).toBe(restarted.log.logId);
});

test("a forced UI error can stop the game and recover its unsent log after reload", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("forced reproduction test error"),
      message: "forced reproduction test error"
    }));
  });
  await expect(page.locator(".ui-exception-banner")).toContainText("UI Exception");
  await page.locator("[data-ui-exception-stop]").click();
  await expect(page.locator(".emergency-game-stop")).toContainText("The game was stopped after a UI error");
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("riftbound.gameDiagnostic.v1")))).toBe(true);

  await page.reload();
  await expect(page.locator(".main-menu .game-bug-report")).toContainText("An interrupted game log is available");
  await expect(page.locator('[data-action="menu-start"]')).toBeDisabled();
  await expect(page.locator('[data-action="menu-ai"]')).toBeDisabled();
  await expect(page.locator('[data-action="menu-multiplayer"]')).toBeDisabled();
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")));
  expect(recovered.finalization.reason).toBe("ui-error");
  expect(recovered.ui.errors.some((entry) => entry.error.message.includes("forced reproduction test error"))).toBe(true);
});

test("the bootstrap crash guard can submit a preserved log without the main UI", async ({ page }) => {
  let submittedReport = null;
  await page.route("**/api/bug-reports", async (route) => {
    submittedReport = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reportId: "22222222-2222-4222-8222-222222222222",
        submittedAt: "2026-09-02T01:02:03.000Z"
      })
    });
  });
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.evaluate(() => window.__riftboundEarlyCrashGuard.show(new Error("bootstrap failed"), true));

  const guard = page.locator("#riftbound-early-crash-guard");
  await expect(guard).toContainText("UI 초기화 오류로 게임을 중단했습니다");
  const description = guard.locator("#early-crash-description");
  await description.fill("부트스트랩 오류 재현 설명입니다.");
  await guard.locator("[data-crash-submit]").click();
  await expect(guard.locator("[data-crash-status]")).toContainText("로그를 전송했습니다");
  expect(submittedReport.description).toBe("부트스트랩 오류 재현 설명입니다.");
  expect(submittedReport.log.finalization.reason).toBe("ui-error");
  expect(submittedReport.metadata.bootstrapCrash).toBe(true);
});

test("the bootstrap crash guard does not claim an online stop succeeded when the server rejects it", async ({ page }) => {
  await page.route("**/api/rooms/ROOM42/commands", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, message: "stop unavailable" })
  }));
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.evaluate(() => {
    const key = "riftbound.gameDiagnostic.v1";
    const log = JSON.parse(localStorage.getItem(key));
    log.metadata = {
      ...log.metadata,
      mode: "online",
      roomId: "ROOM42",
      gameNumber: 1,
      diagnosticGameId: "ROOM42:1"
    };
    localStorage.setItem(key, JSON.stringify(log));
    localStorage.setItem("riftbound.onlineSeat.v1", JSON.stringify({
      mode: "online",
      roomId: "ROOM42",
      playerId: "p1",
      playerToken: "seat-secret",
      gameNumber: 1,
      diagnosticGameId: "ROOM42:1"
    }));
    window.__riftboundEarlyCrashGuard.show(new Error("bootstrap online failure"), true);
  });

  const guard = page.locator("#riftbound-early-crash-guard");
  await expect(guard.locator("[data-crash-title]")).toContainText("서버 경기 중단을 확인하지 못했습니다");
  await expect(guard.locator("[data-crash-stop-retry]")).toBeVisible();
  await guard.locator("[data-crash-preserve-local]").click();
  await expect(guard.locator("[data-crash-title]")).toContainText("서버 경기 중단 없이 로그만 보존했습니다");
  await expect(guard.locator("[data-crash-stop-status]")).toContainText("계속 진행 중일 수 있습니다");
  await expect(guard.locator("[data-crash-reload]")).toBeEnabled();
});

test("an unavailable game cannot bypass UI-error finalization through the main-menu action", async ({ page }) => {
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await page.evaluate(() => {
    window.__riftboundGame.players = null;
    window.__riftboundRender();
  });
  await expect(page.locator(".tabletop-state-unavailable")).toBeVisible();
  await page.locator('[data-action="return-menu-after-ui-error"]').click();
  await expect(page.locator(".emergency-game-stop")).toContainText("The game was stopped after a UI error");
  const finalization = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("riftbound.gameDiagnostic.v1")).finalization);
  expect(finalization.reason).toBe("ui-error");
  await page.locator('[data-action="bug-report-decline"]').click();
  await page.locator('[data-action="bug-report-return-menu"]').click();
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
});

test("Frigid Touch and Long Sword chain rendering tolerates a serialized empty effect entry", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await page.locator('[data-action="settings-language"]').selectOption("ko");
  await completeLocalSetup(page);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const opponent = game.players[1];
    const makeChainCard = (instanceId, cardNumber, name, type, keywords, effects) => ({
      id: cardNumber,
      cardNumber,
      instanceId,
      ownerId: opponent.id,
      controllerId: opponent.id,
      name,
      type,
      tags: type === "gear" ? ["Equipment"] : [],
      keywords,
      effects
    });
    const longSword = makeChainCard(
      "frigid-touch-regression-long-sword",
      "SFD-022/221",
      "Long Sword",
      "gear",
      ["Quick-Draw", "Equip"],
      [null, { timing: "activated", kind: "equip" }]
    );
    const frigidTouch = makeChainCard(
      "frigid-touch-regression-spell",
      "SFD-066/221",
      "Frigid Touch",
      "spell",
      ["Reaction", "Repeat"],
      [null, { timing: "spell", kind: "modifyMight", amount: -2, temporary: true }]
    );
    game.phase = "showdown";
    game.actionChain = null;
    game.showdown = {
      battlefieldId: game.battlefields[0].instanceId,
      turnPlayerId: game.players[0].id,
      attackerId: game.players[0].id,
      defenderId: opponent.id,
      focusPlayerId: game.players[0].id,
      chainSequence: 2,
      chainOpenedBy: "card",
      priorityPlayerId: game.players[0].id,
      consecutivePasses: 0,
      chain: [
        { id: "chain-1", itemType: "card", card: longSword, playerId: opponent.id, status: "finalized" },
        { id: "chain-2", itemType: "card", card: frigidTouch, playerId: opponent.id, status: "finalized" }
      ]
    };
    window.__riftboundRender();
  });

  await expect(page.locator(".chain-zone-item")).toHaveCount(2);
  await expect(page.locator(".chain-zone-item").filter({ hasText: "혹한의 손길" })).toHaveCount(1);
  await expect(page.locator(".chain-zone-item").filter({ hasText: "롱소드" })).toHaveCount(1);
  await expect(page.locator(".ui-exception-banner")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("every registered card renders its Korean library, detail, and full-card views", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openLocalApp(page);

  const audit = await page.evaluate(() => {
    const numbers = window.__riftboundCardRenderAuditNumbers();
    const failures = [];
    for (const number of numbers) {
      const rendered = window.__riftboundCardRenderAudit(number);
      if (!rendered) {
        failures.push(`${number}: no render result`);
        continue;
      }
      const host = document.createElement("div");
      host.innerHTML = `${rendered.libraryHtml}${rendered.detailHtml}${rendered.modalHtml}`;
      const library = host.querySelector(".library-card");
      const detail = host.querySelector(".deck-preview-card");
      const modal = host.querySelector(".full-card-modal");
      const badMarkup = /undefined|\[object Object\]|NaN/u.test(host.innerHTML);
      if (!library || library.dataset.cardNumber !== number) failures.push(`${number}: library card`);
      if (library?.querySelector("strong")?.textContent?.trim() !== rendered.name.trim()) failures.push(`${number}: library name`);
      if (!detail || detail.querySelector("h2")?.textContent?.trim() !== rendered.name.trim()) failures.push(`${number}: detail name`);
      if (detail?.querySelector("p")?.textContent?.trim() !== rendered.text.trim()) failures.push(`${number}: detail text`);
      if (!detail?.querySelector(".deck-detail-actions button")) failures.push(`${number}: detail action`);
      if (!modal || modal.querySelector("h2")?.textContent?.trim() !== rendered.name.trim()) failures.push(`${number}: modal name`);
      if (modal?.querySelector(".full-card-copy > p")?.textContent?.trim() !== rendered.text.trim()) failures.push(`${number}: modal text`);
      if (rendered.image && [...host.querySelectorAll("img")].some((image) => !image.alt.trim())) failures.push(`${number}: image alt`);
      if (rendered.image && [library, detail, modal].some((view) => view?.querySelector("img")?.getAttribute("src") !== rendered.image)) failures.push(`${number}: localized image`);
      if (!rendered.name.trim() || !rendered.type.trim() || badMarkup) failures.push(`${number}: localized render contract`);
    }
    return { count: numbers.length, failures };
  });

  expect(audit.count).toBe(990);
  expect(audit.failures).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("battlefields with the same name show their selecting player seats", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await completeLocalSetup(page);
  await page.evaluate(() => {
    const [first, second] = window.__riftboundGame.battlefields;
    second.name = first.name;
    second.cardNumber = first.cardNumber;
    window.__riftboundRender();
  });

  const names = page.locator(".battlefield-head h2");
  await expect(names).toHaveCount(2);
  expect(await names.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringContaining("P1"),
    expect.stringContaining("P2")
  ]));
  expect(pageErrors).toEqual([]);
});

test("sign-up stores a modified default as an account deck and login restores it", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  let serverDeckStore = { decks: [], activeDeckIds: [] };
  const user = { id: "e2e-account-user", accountId: "deckkeeper", createdAt: Date.now() };

  await page.route("**/api/auth/signup", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, token: "e2e-token", user, deckStore: serverDeckStore })
  }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, token: "e2e-token-2", user, deckStore: serverDeckStore })
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true })
  }));
  await page.route("**/api/account/decks", async (route) => {
    if (route.request().method() === "PUT") {
      serverDeckStore = route.request().postDataJSON().deckStore;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, deckStore: serverDeckStore })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, deckStore: serverDeckStore })
    });
  });

  await openLocalApp(page);
  await page.locator('[data-action="auth-mode"][data-mode="signup"]').click();
  await page.locator('[data-action="auth-account-id"]').fill("deckkeeper");
  await page.locator('[data-action="auth-password"]').fill("password-123");
  await page.locator('[data-action="auth-password-confirm"]').fill("password-123");
  await page.locator('[data-action="auth-submit"]').click();
  await expect(page.locator(".account-panel.signed-in")).toContainText("deckkeeper");

  await page.locator('[data-action="menu-decks"]').click();
  await page.locator('.deck-slot[data-deck^="default-"]').first().click();
  await expect(page.locator(".deck-owner-badge.default")).toBeVisible();
  await page.locator('[data-action="deck-name"]').fill("계정에 저장된 덱");
  await page.locator('[data-action="deck-save"]').click();
  await expect(page.locator(".deck-owner-badge.personal")).toBeVisible();
  await expect.poll(() => serverDeckStore.decks.some((deck) => deck.name === "계정에 저장된 덱")).toBe(true);
  expect(serverDeckStore.decks.some((deck) => deck.id.startsWith("default-"))).toBe(false);

  await page.locator('[data-action="menu-home"]').click();
  await page.locator('[data-action="auth-logout"]').click();
  await expect(page.locator(".account-panel.signed-out")).toBeVisible();
  await page.locator('[data-action="auth-account-id"]').fill("deckkeeper");
  await page.locator('[data-action="auth-password"]').fill("password-123");
  await page.locator('[data-action="auth-submit"]').click();
  await expect(page.locator(".account-panel.signed-in")).toContainText("deckkeeper");
  await expect(page.locator('[data-action="menu-active-deck"][data-slot="0"]')).toContainText("계정에 저장된 덱");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="menu-decks"]').click();
  const restoredDeck = page.locator('.deck-slot[data-deck^="deck-"]').filter({ hasText: "계정에 저장된 덱" });
  await expect(restoredDeck).toHaveCount(1);
  await restoredDeck.click();
  await page.locator('[data-action="deck-toggle-tools"]').click();
  await expect(page.locator('[data-action="deck-delete-request"]')).toBeVisible();
  await page.locator('[data-action="deck-delete-request"]').click();
  await expect(page.locator(".deck-delete-dialog")).toContainText("계정에 저장된 덱");
  await page.locator('[data-action="deck-delete-cancel"]').click();
  await expect(page.locator(".deck-delete-dialog")).toHaveCount(0);

  await page.locator('[data-action="deck-delete-request"]').click();
  await page.locator('[data-action="deck-delete-confirm"]').click();
  await expect(restoredDeck).toHaveCount(0);
  await expect(page.locator(".deck-owner-badge.default")).toBeVisible();
  await expect(page.locator('[data-action="deck-delete-request"]')).toHaveCount(0);
  await expect.poll(() => serverDeckStore.decks.some((deck) => deck.name === "계정에 저장된 덱")).toBe(false);
  expect(serverDeckStore.activeDeckIds.every((id) => id.startsWith("default-"))).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-action="menu-home"]').click();
  await page.locator('[data-action="auth-logout"]').click();
  await page.locator('[data-action="auth-account-id"]').fill("deckkeeper");
  await page.locator('[data-action="auth-password"]').fill("password-123");
  await page.locator('[data-action="auth-submit"]').click();
  await page.locator('[data-action="menu-decks"]').click();
  await expect(page.locator('.deck-slot[data-deck^="deck-"]').filter({ hasText: "계정에 저장된 덱" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("deck editor keeps the requested two-row header and a usable compact layout", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await openLocalApp(page);
  await page.locator('[data-action="menu-decks"]').click();
  await page.locator('.deck-slot[data-deck^="default-"]').first().click();

  const desktop = await page.locator(".deck-editor-panel").evaluate((panel) => {
    const element = (selector) => panel.querySelector(selector);
    const box = (target) => {
      const rect = target.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
    };
    const header = element(".deck-editor-top");
    const nameRow = element(".deck-name-row");
    const owner = element(".deck-owner-badge");
    const validity = element(".valid-pill, .invalid-pill");
    const actions = element(".deck-editor-actions");
    const buttons = [...actions.querySelectorAll("button")].map(box);
    const grid = element(".deck-editor-grid");

    return {
      panel: box(panel),
      header: box(header),
      nameRow: box(nameRow),
      owner: box(owner),
      validity: box(validity),
      actions: box(actions),
      buttons,
      grid: box(grid),
      headerFits: header.scrollWidth <= header.clientWidth + 1,
      ownerFits: owner.scrollWidth <= owner.clientWidth + 1,
      validityFits: validity.scrollWidth <= validity.clientWidth + 1,
      viewportHeight: innerHeight
    };
  });

  expect(desktop.owner.height).toBeLessThanOrEqual(30);
  expect(desktop.validity.height).toBeLessThanOrEqual(30);
  expect(desktop.ownerFits).toBe(true);
  expect(desktop.validityFits).toBe(true);
  expect(desktop.headerFits).toBe(true);
  expect(desktop.actions.top).toBeGreaterThanOrEqual(desktop.nameRow.bottom);
  expect(desktop.buttons.every((button) => Math.abs(button.top - desktop.buttons[0].top) <= 1)).toBe(true);
  expect(Math.abs(desktop.buttons.at(-1).right - desktop.actions.right)).toBeLessThanOrEqual(1);
  expect(desktop.header.height).toBeLessThanOrEqual(145);
  expect(desktop.grid.height / desktop.panel.height).toBeGreaterThanOrEqual(0.8);
  expect(desktop.grid.bottom).toBeLessThanOrEqual(desktop.viewportHeight + 1);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.locator(".deck-mobile-tabs")).toBeVisible();
  await expect(page.locator(".deck-editor-panel")).toBeInViewport();
  await page.locator('[data-action="deck-mobile-tab"][data-tab="cards"]').click();
  await expect(page.locator(".card-search-panel")).toBeVisible();
  await expect(page.locator(".deck-list-panel")).toBeHidden();

  const compactFits = await page.locator(".deck-builder-screen").evaluate((screen) => ({
    screen: screen.scrollWidth <= screen.clientWidth + 1,
    panel: screen.querySelector(".deck-editor-panel").scrollWidth
      <= screen.querySelector(".deck-editor-panel").clientWidth + 1,
    header: screen.querySelector(".deck-editor-top").scrollWidth
      <= screen.querySelector(".deck-editor-top").clientWidth + 1
  }));
  expect(compactFits).toEqual({ screen: true, panel: true, header: true });
});

test("short desktop deck details scroll to both add-card actions", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 600 });
  await openLocalApp(page);
  await page.locator('[data-action="menu-decks"]').click();
  await page.locator('[data-action="deck-new"]').click();
  await page.locator('[data-action="deck-search"]').fill("Kharox");
  await expect(page.locator(".library-card")).toHaveCount(1);
  await page.locator(".library-card").first().click();

  const detail = page.locator(".deck-card-detail");
  const mainButton = page.locator('[data-action="deck-add-main"]');
  const sideboardButton = page.locator('[data-action="deck-add-sideboard"]');
  await expect(mainButton).toBeEnabled();
  await expect(sideboardButton).toBeEnabled();
  await expect.poll(() => detail.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  expect(await detail.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await mainButton.click();
  await expect(mainButton).toContainText("1/3");
  await sideboardButton.click();
  await expect(sideboardButton).toContainText("1/3");

  const actionsFit = await detail.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll(".deck-detail-actions button")];
    return element.scrollTop > 0 && buttons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    });
  });
  expect(actionsFit).toBe(true);
});

test("deck builder copies exported text and imports pasted text as a new deck", async ({ page, context }) => {
  const pageErrors = capturePageErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLocalApp(page);
  await page.locator('[data-action="menu-decks"]').click();

  await page.locator('[data-action="deck-export-open"]').click();
  const exportField = page.locator('textarea[data-action="deck-transfer-text"]');
  await expect(exportField).toBeVisible();
  await expect(exportField).toHaveAttribute("readonly", "");
  const exported = await exportField.inputValue();
  expect(exported).toMatch(/^Legend:\n1 .+\n\nChampion:\n1 .+\n\nMainDeck:/u);
  expect(exported).toContain("\n\nBattlefields:\n");
  expect(exported).toContain("\n\nRune Pool:\n");
  expect(exported).toContain("\n\nSideboard:\n");
  await page.locator('[data-action="deck-export-copy"]').click();
  await expect(page.locator(".deck-transfer-message.success")).toContainText("Copied all deck text");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/gu, "\n")).toBe(exported.replace(/\r\n/gu, "\n"));
  await page.locator('[data-action="deck-transfer-close"]').last().click();

  await page.locator('[data-action="deck-import-open"]').click();
  const importField = page.locator('textarea[data-action="deck-transfer-text"]');
  await importField.fill(exported);
  await page.locator('[data-action="deck-import-confirm"]').click();

  await expect(page.locator('[data-action="deck-name"]')).toHaveValue(/ Deck$/u);
  await expect(page.locator(".deck-transfer-notice.success")).toContainText("Created a new deck");
  await expect(page.locator(".main-deck-block .deck-zone-title span")).toHaveText("40/40");
  expect(pageErrors).toEqual([]);
});

test("deck import shows the full placeholder format and keeps actions visible after many errors", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 640 });
  await openLocalApp(page);
  await page.locator('[data-action="menu-decks"]').click();
  await page.locator('[data-action="deck-import-open"]').click();

  const field = page.locator('textarea[data-action="deck-transfer-text"]');
  const placeholder = await field.getAttribute("placeholder");
  for (const section of ["Legend:", "Champion:", "MainDeck:", "Battlefields:", "Rune Pool:", "Sideboard:"]) {
    expect(placeholder).toContain(section);
  }

  await field.fill(`Unknown Section:
not a quantity

Legend:
2 Missing Legend

Champion:
0 Missing Champion

MainDeck:
three First Mate
1 Definitely Not A Card`);
  const confirm = page.locator('[data-action="deck-import-confirm"]');
  await confirm.click();

  const error = page.locator(".deck-transfer-message.error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("more error");
  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeInViewport();
  expect((await error.textContent()).length).toBeLessThan(700);
  expect(pageErrors).toEqual([]);
});

test("a battlefield token added during play appears as an accessible third battlefield", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalApp(page);
  await completeLocalSetup(page);
  await page.evaluate(() => {
    const template = window.__riftboundGame.battlefields[0];
    window.__riftboundGame.battlefields.push({
      ...structuredClone(template),
      id: "BARON-PIT",
      cardNumber: "TOKEN-BARON-PIT",
      collectorNumber: "TOKEN-BARON-PIT",
      instanceId: "e2e-baron-pit",
      name: "Baron Pit",
      units: [],
      hidden: [],
      controlledBy: null,
      contestedBy: null,
      isToken: true,
      translations: {
        ko: {
          name: "내셔 남작 둥지",
          text: "유닛은 어디서든 이곳으로 이동할 수 있습니다."
        }
      }
    });
    window.__riftboundRender();
  });

  const fields = page.locator(".battlefield.location-column");
  await expect(fields).toHaveCount(3);
  const pit = page.locator('[data-card-id="e2e-baron-pit"]');
  await expect(pit).toBeVisible();
  await expect(pit.locator(".battlefield-head h2")).toHaveText("Baron Pit");
  const scrollState = await page.locator(".location-band").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
  expect(pageErrors).toEqual([]);
});

test("mobile viewport keeps the setup and board controls inside the page", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await openLocalApp(page);
  await expect(page.locator('[data-action="menu-start"]')).toBeInViewport();
  await completeLocalSetup(page);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  await expect(page.locator('[data-action="surrender"]')).toBeInViewport();
  expect(pageErrors).toEqual([]);
});

test("trigger order confirmation stays visible with many selected triggers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await openLocalApp(page);
  await page.evaluate(() => {
    const selected = Array.from({ length: 8 }, (_, index) =>
      `<li><b>Forced trigger ${index + 1}</b><span>A long triggered effect description</span></li>`).join("");
    const options = Array.from({ length: 8 }, (_, index) => `
      <div class="choice-option-wrap trigger-order-option-wrap">
        <button type="button" class="choice-option trigger-order-option is-selected">
          <strong class="trigger-order-rank">Selected as ${index + 1}</strong>
          <span class="choice-card-name">Forced trigger ${index + 1}</span>
          <small class="trigger-order-effect">A long triggered effect description</small>
        </button>
      </div>
    `).join("");
    document.querySelector("#app").innerHTML = `
      <section class="choice-panel modal-panel trigger-order-panel">
        <div class="section-head trigger-order-head">
          <div>
            <h2>Order simultaneous triggers</h2>
            <span>8 of 8 selected</span>
            <p class="choice-instruction trigger-order-instruction">Choose the placement order.</p>
          </div>
          <div class="trigger-order-confirm">
            <button type="button" class="primary">Confirm trigger order</button>
          </div>
        </div>
        <div class="trigger-order-track">${selected}</div>
        <div class="trigger-order-selected"><strong>Chain placement order</strong><ol>${selected}</ol></div>
        <div class="choice-grid trigger-order-grid">${options}</div>
      </section>
    `;
  });

  const panel = page.locator(".trigger-order-panel");
  const confirm = page.locator(".trigger-order-confirm .primary");
  await expect(confirm).toBeVisible();
  const bounds = await page.evaluate(() => {
    const panelRect = document.querySelector(".trigger-order-panel").getBoundingClientRect();
    const confirmRect = document.querySelector(".trigger-order-confirm .primary").getBoundingClientRect();
    return {
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      confirmTop: confirmRect.top,
      confirmBottom: confirmRect.bottom
    };
  });
  expect(bounds.confirmTop).toBeGreaterThanOrEqual(bounds.panelTop);
  expect(bounds.confirmBottom).toBeLessThanOrEqual(bounds.panelBottom);
  await expect(panel).toBeVisible();
});

test("mobile choice modal keeps its header visible and every long-list option reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await openLocalApp(page);
  await page.evaluate(() => {
    const options = Array.from({ length: 24 }, (_, index) => `
      <div class="choice-option-wrap">
        <button type="button" class="choice-option text-choice-option" data-long-choice="${index + 1}">
          <span>Vendetta option ${index + 1} with a descriptive label</span>
        </button>
      </div>
    `).join("");
    document.querySelector("#app").innerHTML = `
      <section class="choice-panel modal-panel">
        <div class="section-head"><div><h2>Choose a Vendetta target</h2><span>Choose one card</span></div></div>
        <label class="choice-search"><span>Search choices</span><input value="" /></label>
        <div class="choice-grid">${options}</div>
      </section>
    `;
  });

  const panel = page.locator(".choice-panel");
  const grid = page.locator(".choice-grid");
  const last = page.locator('[data-long-choice="24"]');
  await expect(panel.locator("h2")).toBeInViewport();
  const initial = await grid.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
  expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
  await grid.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await expect(last).toBeInViewport();
  const bounds = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
});

test("AI generation selection only enables trained AI decks", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await page.route("**/api/ai/generations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      generations: [
        { generation: 0, kind: "bundled", gamesTrained: 256, engineCompatible: true, trainingDeckIds: ["origins-sett", "proving-grounds-annie", "origins-kaisa", "proving-grounds-master-yi", "origins-leona"] },
        { generation: 6, kind: "learner", gamesTrained: 643, activeLearner: true, engineCompatible: true, trainingDeckIds: ["origins-sett", "proving-grounds-annie", "origins-kaisa", "proving-grounds-master-yi", "origins-leona"] }
      ]
    })
  }));

  await openLocalApp(page);
  const generation = page.locator('[data-action="menu-ai-generation"]');
  await expect(generation).toBeVisible();
  await expect(generation).toHaveValue("0");
  await expect(generation.locator("option")).toHaveCount(2);
  await generation.selectOption("6");
  await expect(generation).toHaveValue("6");
  await expect(page.locator('[data-action="menu-ai"]')).toBeDisabled();
  await expect(page.locator(".ai-deck-warning")).toBeVisible();

  const aiDeck = page.locator('[data-action="menu-active-deck"][data-slot="1"]');
  await aiDeck.selectOption("default-proving-grounds-lux");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await expect(page.locator('[data-action="menu-ai"]')).toBeDisabled();
  await expect(page.locator(".ai-deck-warning")).toBeVisible();

  await aiDeck.selectOption("default-origins-kaisa");
  await expect(page.locator('[data-action="menu-ai"]')).toBeEnabled();
  await expect(page.locator(".ai-deck-warning")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("the shipped browser runtime loads a trained AI model", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  const aiDeck = page.locator('[data-action="menu-active-deck"][data-slot="1"]');
  await aiDeck.selectOption("default-origins-kaisa");

  const startAi = page.locator('[data-action="menu-ai"]');
  await expect(startAi).toBeEnabled();
  await startAi.click();

  await expect(page.locator('[data-action="roll-first-player"]')).toBeVisible({ timeout: 30_000 });
  expect(pageErrors).toEqual([]);
});

test("a same-generation catalog refresh cannot cancel AI startup", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  let releaseCatalog;
  let releaseCheckpoint;
  let markCheckpointRequested;
  const catalogGate = new Promise((resolve) => { releaseCatalog = resolve; });
  const checkpointGate = new Promise((resolve) => { releaseCheckpoint = resolve; });
  const checkpointRequested = new Promise((resolve) => { markCheckpointRequested = resolve; });

  await page.route("**/api/ai/generations", async (route) => {
    await catalogGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        generations: [{
          generation: 0,
          kind: "learner",
          gamesTrained: 256,
          activeLearner: true,
          engineCompatible: true,
          trainingDeckIds: [
            "origins-sett",
            "proving-grounds-annie",
            "origins-kaisa",
            "proving-grounds-master-yi",
            "origins-leona"
          ]
        }]
      })
    });
  });
  await page.route("**/src/ai/checkpoints/neural-champion.json", async (route) => {
    markCheckpointRequested();
    await checkpointGate;
    await route.continue();
  });

  await openLocalApp(page);
  await page.locator('[data-action="menu-active-deck"][data-slot="1"]').selectOption("default-origins-kaisa");
  await page.locator('[data-action="menu-ai"]').click();
  await checkpointRequested;

  const catalogResponse = page.waitForResponse("**/api/ai/generations");
  releaseCatalog();
  await catalogResponse;
  await expect(page.locator('[data-action="menu-ai-generation"] option:checked')).toContainText(/learner|현재 learner/u);
  releaseCheckpoint();

  await expect(page.locator('[data-action="roll-first-player"]')).toBeVisible({ timeout: 30_000 });
  expect(pageErrors).toEqual([]);
});

test("AI turn Worker runs legal-action enumeration off the page thread", async ({ page }) => {
  const pageErrors = capturePageErrors(page);
  await openLocalApp(page);
  await page.locator('[data-action="menu-start"]').click();
  await expect(page.locator('[data-action="roll-first-player"]')).toBeVisible();

  const result = await page.evaluate(async () => {
    const { activeActorId } = await import("/src/ai/actions.mjs");
    const { createAiTurnWorkerRequest } = await import("/src/ai/turn-protocol.mjs");
    const worker = new Worker(new URL("/src/ai/turn-worker.mjs", location.origin), { type: "module" });
    try {
      const requestId = "e2e-ai-turn-worker";
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("AI turn Worker timed out.")), 15_000);
        worker.addEventListener("message", (event) => {
          if (event.data?.requestId !== requestId) return;
          clearTimeout(timer);
          resolve(event.data);
        });
        worker.addEventListener("error", (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || "AI turn Worker failed."));
        });
        worker.postMessage(createAiTurnWorkerRequest({
          requestId,
          game: window.__riftboundGame,
          actorId: activeActorId(window.__riftboundGame),
          selectionMode: "policy"
        }));
      });
      return {
        ok: response.ok,
        kind: response.decision?.kind,
        selectedKind: response.decision?.selected?.action?.kind
      };
    } finally {
      worker.terminate();
    }
  });

  expect(result.ok).toBe(true);
  expect(result.kind).toBe("policy");
  expect(result.selectedKind).toEqual(expect.any(String));
  expect(pageErrors).toEqual([]);
});

test("tutorial button opens four Origins lessons and launches the first lesson", async ({ page }) => {
  const pageErrors = capturePageErrors(page);

  await openLocalApp(page);
  await page.locator('[data-action="menu-tutorial"]').click();
  await expect(page.locator(".tutorial-course-card")).toHaveCount(4);
  await expect(page.locator(".tutorial-menu-header")).toContainText(/오리진|Origins/u);
  await expect(page.locator('[data-tutorial="first-victory"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="combat-damage"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="spell-targeting"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="energy-and-power"]')).toBeVisible();

  await page.locator('[data-tutorial="first-victory"]').click();
  await expect(page.locator(".tutorial-panel")).toBeVisible();
  const originsState = await page.evaluate(() => ({
    tutorialId: window.__riftboundGame.tutorial.id,
    legendNumbers: window.__riftboundGame.players.map((player) => player.legend.cardNumber),
    deckIsOrigins: window.__riftboundGame.players.every((player) =>
      player.mainDeck.every((card) => /^(?:OGN|OGS)-/u.test(card.cardNumber)))
  }));
  expect(originsState).toEqual({
    tutorialId: "first-victory",
    legendNumbers: ["OGN-261/298", "OGN-299/298"],
    deckIsOrigins: true
  });

  await page.locator('[data-action="tutorial-exit"]').click();
  await expect(page.locator(".tutorial-course-card")).toHaveCount(4);
  expect(pageErrors).toEqual([]);
});

test("crowded battlefield lanes can scroll to every unit", async ({ page }) => {
  // Test fixtures are intentionally not served by the public static allowlist.
  // Load this trusted local fixture into an already-originated page instead.
  await page.goto("/");
  const fixture = await readFile(
    new URL("../tests/fixtures/battlefield-scroll-preview.html", import.meta.url),
    "utf8"
  );
  await page.setContent(fixture, { waitUntil: "load" });

  for (const testId of ["opponent-lane", "player-lane"]) {
    const lane = page.getByTestId(testId);
    const initial = await lane.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      scrollLeft: node.scrollLeft
    }));
    expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
    expect(initial.scrollLeft).toBe(0);

    await lane.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    const scrolled = await lane.evaluate((node) => node.scrollLeft);
    expect(scrolled).toBeGreaterThan(0);
  }
});

test("two isolated browser sessions can start, reconnect to, and complete an online game", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostErrors = capturePageErrors(host);
  const guestErrors = capturePageErrors(guest);

  try {
    await openLocalMultiplayer(host);
    await host.locator('[data-action="online-create"]').click();
    await expect(host.locator('[data-action="online-submit-deck"]')).toBeEnabled();
    const code = await roomCode(host);

    await openLocalMultiplayer(guest);
    await guest.locator('[data-action="online-code-input"]').fill(code);
    await guest.locator('[data-action="online-join-code"]').click();
    await expect(guest.locator('[data-action="online-submit-deck"]')).toBeEnabled();

    await host.locator('[data-action="online-submit-deck"]').click();
    await guest.locator('[data-action="online-submit-deck"]').click();
    await expect(host.locator('[data-action="online-ready"]')).toBeEnabled();
    await expect(guest.locator('[data-action="online-ready"]')).toBeEnabled();
    await host.locator('[data-action="online-ready"]').click();
    await guest.locator('[data-action="online-ready"]').click();

    await expect(host.locator(".first-player-screen")).toBeVisible();
    await expect(guest.locator(".first-player-screen")).toBeVisible();

    await expect(host.locator('[data-action="roll-first-player"]')).toBeEnabled();
    await expect(guest.locator('[data-action="roll-first-player"]')).toBeDisabled();
    await host.locator('[data-action="roll-first-player"]').click();
    await expect(guest.locator('[data-action="roll-first-player"]')).toBeEnabled();

    await guest.reload();
    await expect(guest.locator(".first-player-screen")).toBeVisible();
    expect(await roomCodeFromStorage(guest)).toBe(code);

    for (let step = 0; step < 20; step += 1) {
      const hostChoice = host.locator('[data-action="choose-first-player"]:enabled');
      const guestChoice = guest.locator('[data-action="choose-first-player"]:enabled');
      const hostRoll = host.locator('[data-action="roll-first-player"]:enabled');
      const guestRoll = guest.locator('[data-action="roll-first-player"]:enabled');
      await expect.poll(async () => (await hostChoice.count()) + (await guestChoice.count())
        + (await hostRoll.count()) + (await guestRoll.count())).toBeGreaterThan(0);
      if (await hostChoice.count()) {
        await hostChoice.first().click();
        break;
      }
      if (await guestChoice.count()) {
        await guestChoice.first().click();
        break;
      }
      if (await hostRoll.count()) await hostRoll.click();
      else await guestRoll.click();
    }
    await expect(host.locator(".initial-sideboarding-shell")).toBeVisible();
    await expect(guest.locator(".initial-sideboarding-shell")).toBeVisible();
    await expect(host.locator(".sideboarding-setup-card")).toHaveCount(4);
    await expect(host.locator(".sideboarding-setup-pending")).toHaveCount(2);

    const firstSingleGameSideCard = host.locator(".sideboarding-column").nth(1).locator('[data-action="sideboard-view-card"]').first();
    await firstSingleGameSideCard.click();
    await expect(host.locator(".sideboarding-card-preview")).toBeVisible();
    await host.locator('[data-action="sideboard-close-card"]').click();

    await host.locator(".sideboarding-column").nth(1).locator('[data-action="sideboard-move"]:enabled').first().click();
    await expect(host.locator(".sideboarding-column").first().locator(".deck-zone-title span")).toContainText("41/40");
    await expect(host.locator(".sideboarding-validation")).toContainText("Sideboard in and sideboard out counts must match");
    await expect(host.locator(".sideboarding-validation")).not.toContainText("[object Object]");
    await expect(host.locator('[data-action="sideboard-submit"]')).toBeDisabled();
    await host.locator('[data-action="sideboard-reset"]').click();
    await expect(host.locator('[data-action="sideboard-submit"]')).toBeEnabled();

    await host.locator('[data-action="sideboard-submit"]').click();
    await guest.locator('[data-action="sideboard-submit"]').click();
    await expect(host.locator(".champion-setup")).toBeVisible();
    await expect(guest.locator(".champion-setup")).toBeVisible();

    await guest.locator('[data-action="surrender"]').click();
    await guest.locator('[data-action="confirm-game-exit"]').click();
    await expect(host.locator('[data-action="exit-completed-game"]')).toBeVisible();
    await expect(guest.locator('[data-action="exit-completed-game"]')).toBeVisible();

    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("official best-of-three UI follows first-game and prior-loser setup order", async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostErrors = capturePageErrors(host);
  const guestErrors = capturePageErrors(guest);
  const pages = [host, guest];
  const expectPublicSetupLoadouts = async () => {
    for (const page of pages) {
      const screen = page.locator(".first-player-screen");
      for (const role of ["legend", "champion", "battlefield"]) {
        await expect(screen.locator(`[data-setup-role="${role}"].revealed`)).toHaveCount(2);
      }
      await expect(screen.locator(".first-player-loadout-card.unavailable, .private-setup-waiting")).toHaveCount(0);
    }
  };

  try {
    await host.route("**/build-info.json", (route) => route.fulfill({ status: 404, body: "Not found" }));
    await host.goto("/");
    await host.locator('[data-action="settings-sideboarding"]').check();
    await host.locator('[data-action="menu-multiplayer"]').click();
    await host.locator('[data-action="online-create"]').click();
    const code = await roomCode(host);

    await openLocalMultiplayer(guest);
    await guest.locator('[data-action="online-code-input"]').fill(code);
    await guest.locator('[data-action="online-join-code"]').click();
    await host.locator('[data-action="online-submit-deck"]').click();
    await guest.locator('[data-action="online-submit-deck"]').click();
    await host.locator('[data-action="online-ready"]').click();
    await guest.locator('[data-action="online-ready"]').click();

    await expect(host.locator(".champion-setup")).toBeVisible();
    await expect(guest.locator(".champion-setup")).toBeVisible();
    await expect(host.locator(".first-player-screen")).toHaveCount(0);
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-champion"]');
    }
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-battlefield"]');
    }

    await expect(host.locator(".first-player-screen")).toBeVisible();
    await expect(guest.locator(".first-player-screen")).toBeVisible();
    await expectPublicSetupLoadouts();
    const beforePlayOrder = await host.evaluate(() => ({
      phase: window.__riftboundGame.phase,
      battlefieldCount: window.__riftboundGame.battlefields.length,
      handCounts: window.__riftboundGame.players.map((player) => player.hand.length),
      method: window.__riftboundGame.firstPlayerDecision?.method
    }));
    expect(beforePlayOrder).toEqual({
      phase: "first-player",
      battlefieldCount: 2,
      handCounts: [0, 0],
      method: "roll"
    });

    let chosePlayOrder = false;
    for (let step = 0; step < 30; step += 1) {
      const beforeDecision = await host.evaluate(() => JSON.stringify({
        phase: window.__riftboundGame.phase,
        decision: window.__riftboundGame.firstPlayerDecision
      }));
      await clickFirstEnabledAcross(
        pages,
        ':is([data-action="choose-first-player"], [data-action="roll-first-player"])'
      );
      await expect.poll(async () => host.evaluate(() => JSON.stringify({
        phase: window.__riftboundGame.phase,
        decision: window.__riftboundGame.firstPlayerDecision
      }))).not.toBe(beforeDecision);
      if (await host.evaluate(() => window.__riftboundGame.phase === "mulligan")) {
        chosePlayOrder = true;
        break;
      }
    }
    expect(chosePlayOrder).toBe(true);

    await expect(host.locator(".mulligan")).toBeVisible();
    await expect(guest.locator(".mulligan")).toBeVisible();
    const opening = await host.evaluate(() => ({
      phase: window.__riftboundGame.phase,
      firstPlayerId: window.__riftboundGame.firstPlayerId,
      mulliganPlayerId: window.__riftboundGame.mulligan?.playerId,
      handCounts: window.__riftboundGame.players.map((player) => player.hand.length)
    }));
    expect(opening.phase).toBe("mulligan");
    expect(opening.mulliganPlayerId).toBe(opening.firstPlayerId);
    expect(opening.handCounts).toEqual([4, 4]);

    const firstMulliganPage = await clickFirstEnabledAcross(pages, '[data-action="skip-mulligan"]');
    const firstSeat = await firstMulliganPage.evaluate(() => JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1") || "null")?.playerId);
    expect(firstSeat).toBe(opening.firstPlayerId);
    await expect.poll(
      async () => firstMulliganPage.evaluate(() => window.__riftboundGame.mulligan?.playerId),
      { timeout: 15_000 }
    ).not.toBe(firstSeat);
    await clickFirstEnabledAcross(pages, '[data-action="skip-mulligan"]');
    await expect(host.locator(".board-panel")).toBeVisible();
    await expect(guest.locator(".board-panel")).toBeVisible();
    expect(await host.evaluate(() => window.__riftboundGame.currentPlayerId)).toBe(opening.firstPlayerId);

    const usedBattlefields = await host.evaluate(() => Object.fromEntries(
      window.__riftboundGame.battlefields.map((field) => [field.ownerId, field.cardNumber])
    ));
    const guestSeat = await guest.evaluate(() => JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1") || "null")?.playerId);
    await guest.locator('[data-action="surrender"]').click();
    await guest.locator('[data-action="confirm-game-exit"]').click();
    await expect(host.locator(".sideboarding-screen")).toBeVisible();
    await expect(guest.locator(".sideboarding-screen")).toBeVisible();
    await host.locator('[data-action="bug-report-decline"]').click();
    await guest.locator('[data-action="bug-report-decline"]').click();
    await host.locator('[data-action="sideboard-submit"]').click();
    await guest.locator('[data-action="sideboard-submit"]').click();

    await expect(host.locator(".champion-setup")).toBeVisible();
    await expect(guest.locator(".champion-setup")).toBeVisible();
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-champion"]');
    }
    await expect.poll(async () => host.evaluate(() => window.__riftboundGame.phase)).toBe("battlefield-select");
    const remainingBattlefields = {
      p1: await host.evaluate(() => window.__riftboundGame.players.find((player) => player.id === "p1")?.availableBattlefields.map((field) => field.cardNumber)),
      p2: await guest.evaluate(() => window.__riftboundGame.players.find((player) => player.id === "p2")?.availableBattlefields.map((field) => field.cardNumber))
    };
    expect(remainingBattlefields.p1).not.toContain(usedBattlefields.p1);
    expect(remainingBattlefields.p2).not.toContain(usedBattlefields.p2);
    for (let index = 0; index < 2; index += 1) {
      await clickFirstEnabledAcross(pages, '[data-action="choose-battlefield"]');
    }

    await expect(host.locator(".first-player-screen")).toBeVisible();
    await expect(guest.locator(".first-player-screen")).toBeVisible();
    await expectPublicSetupLoadouts();
    const nextDecision = await host.evaluate(() => ({
      method: window.__riftboundGame.firstPlayerDecision?.method,
      chooserId: window.__riftboundGame.firstPlayerDecision?.chooserId,
      handCounts: window.__riftboundGame.players.map((player) => player.hand.length)
    }));
    expect(nextDecision).toEqual({ method: "designated", chooserId: guestSeat, handCounts: [0, 0] });
    await expect(host.locator('[data-action="choose-first-player"]:enabled')).toHaveCount(0);
    await expect(guest.locator('[data-action="choose-first-player"]:enabled')).toHaveCount(2);
    const selectedNextFirstPlayer = await guest.locator('[data-action="choose-first-player"]:enabled').first().getAttribute("data-player");
    await guest.locator('[data-action="choose-first-player"]:enabled').first().click();
    await expect(host.locator(".mulligan")).toBeVisible();
    await expect(guest.locator(".mulligan")).toBeVisible();
    expect(await host.evaluate(() => window.__riftboundGame.mulligan?.playerId)).toBe(selectedNextFirstPlayer);
    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

async function roomCodeFromStorage(page) {
  return page.evaluate(() => {
    const seat = JSON.parse(localStorage.getItem("riftbound.onlineSeat.v1") || "null");
    return seat?.roomId || "";
  });
}
