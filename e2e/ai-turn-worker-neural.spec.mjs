import { expect, test } from "@playwright/test";

for (const rollWinner of ["p1", "p2"]) {
  test(`AI game completes sideboarding and mulligans when ${rollWinner} wins the roll`, async ({ page, request }) => {
    test.setTimeout(150_000);
    const errors = [];
    const catalog = await (await request.get('/api/ai/generations')).json();
    const generation = catalog.generations.find(entry => entry.kind === 'bundled').generation;
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator(`[data-action="menu-ai-generation"] option[value="${generation}"]`)).toHaveCount(1);
    await page.locator('[data-action="menu-ai-generation"]').selectOption(String(generation));
    await page.locator('[data-action="menu-active-deck"][data-slot="1"]').selectOption("default-origins-sett");
    await expect(page.locator('[data-action="menu-ai"]')).toBeEnabled();
    await page.locator('[data-action="menu-ai"]').click();
    await expect(page.locator('[data-action="roll-first-player"]')).toBeEnabled({ timeout: 120_000 });
    // Use real engine rolls and real neural Worker decisions. Only seed the dice.
    await page.evaluate(async winner => {
      const { rollFirstPlayer } = await import("/src/engine.mjs");
      const game = window.__riftboundGame;
      for (let seed = 1; seed < 10000; seed++) {
        const branch = structuredClone(game);
        branch.deterministicRandomState = seed;
        rollFirstPlayer(branch, "p1");
        rollFirstPlayer(branch, "p2");
        if (branch.firstPlayerDecision.winnerId === winner) {
          game.deterministicRandomState = seed;
          return;
        }
      }
      throw new Error("No dice seed found");
    }, rollWinner);
    await page.locator('[data-action="roll-first-player"]').click();
    if (rollWinner === "p1") {
      await expect(page.locator('[data-action="choose-first-player"][data-player="p2"]')).toBeEnabled();
      await page.locator('[data-action="choose-first-player"][data-player="p2"]').click();
    }
    await expect(page.locator(".initial-sideboarding-shell")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__riftboundGame.firstPlayerDecision.winnerId)).toBe(rollWinner);
    await page.locator('[data-action="sideboard-submit"]').click();
    await expect(page.locator('[data-action="choose-champion"]:enabled')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-action="choose-champion"]:enabled').click();
    await expect(page.locator('[data-action="skip-mulligan"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-action="skip-mulligan"]').click();
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.phase), { timeout: 30_000 }).toBe("action");
    expect(errors).toEqual([]);
  });
}

test("browser AI turn Worker configures the shipped neural model and returns a lean decision", async ({ page }) => {
  test.setTimeout(150_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await page.locator('[data-action="menu-start"]').click();
  await expect(page.locator('[data-action="roll-first-player"]')).toBeVisible();

  const result = await page.evaluate(async () => {
    const { activeActorId, applyAiAction } = await import("/src/ai/actions.mjs");
    const {
      AI_TURN_WORKER_MESSAGE_TYPES,
      createAiTurnNeuralConfigureRequest,
      createAiTurnWorkerRequest
    } = await import("/src/ai/turn-protocol.mjs");
    const checkpointBuffer = await fetch("/src/ai/checkpoints/neural-champion.json")
      .then((response) => response.arrayBuffer());
    const expectedGeneration = JSON.parse(new TextDecoder().decode(checkpointBuffer)).generation;
    const worker = new Worker(new URL("/src/ai/turn-worker.mjs", location.origin), { type: "module" });
    const waitForResponse = (requestId, expectedType, timeoutMs = 120_000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`AI turn Worker timed out for ${requestId}.`));
        }, timeoutMs);
        const onMessage = (event) => {
          if (event.data?.requestId !== requestId || event.data?.type !== expectedType) return;
          cleanup();
          resolve(event.data);
        };
        const onError = (event) => {
          cleanup();
          reject(new Error(event.message || "AI turn Worker failed."));
        };
        const cleanup = () => {
          clearTimeout(timer);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
      });

    try {
      const configurationId = "browser-neural-config";
      const configurationStartedAt = performance.now();
      const configuration = waitForResponse(
        configurationId,
        AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured
      );
      worker.postMessage(createAiTurnNeuralConfigureRequest({
        requestId: configurationId,
        descriptorKey: "shipped-neural-checkpoint",
        checkpointBuffer,
        expectedGeneration
      }), [checkpointBuffer]);
      const checkpointBufferDetached = checkpointBuffer.byteLength === 0;
      const configured = await configuration;
      if (!configured.ok) throw new Error(configured.error || "Neural Worker configuration failed.");

      const decisionId = "browser-neural-decision";
      const decisionStartedAt = performance.now();
      const decisionResponse = waitForResponse(
        decisionId,
        AI_TURN_WORKER_MESSAGE_TYPES.result
      );
      worker.postMessage(createAiTurnWorkerRequest({
        requestId: decisionId,
        game: window.__riftboundGame,
        actorId: activeActorId(window.__riftboundGame),
        selectionMode: "neural",
        temperature: 0.22
      }));
      const decision = await decisionResponse;
      const { cards } = await import('/src/cards.mjs');
      const optionalGame=structuredClone(window.__riftboundGame);
      optionalGame.phase='action';optionalGame.currentPlayerId='p1';optionalGame.turnPlayerId='p1';
      optionalGame.pendingChoice=null;optionalGame.pendingPayment=null;optionalGame.actionChain=null;
      optionalGame.showdown=null;optionalGame.stagedEvents=[];optionalGame.battlefields=[];
      for(const p of optionalGame.players){p.base=[];p.hand=[];p.champion=null;p.legend.effects=[];}
      const actor=optionalGame.players[0];
      actor.hand=[{...structuredClone(cards.thousandTailedWatcher),instanceId:'optional-unit',ownerId:'p1',controllerId:'p1'}];
      actor.runes=Array.from({length:8},(_,i)=>({instanceId:`option-r${i}`,ownerId:'p1',controllerId:'p1',
        type:'rune',domain:'Mind',effects:[],keywords:[],exhausted:false}));
      if(!applyAiAction(optionalGame,{kind:'beginPlayCard',cardId:'optional-unit',destination:'base'},'p1').ok)
        throw new Error('Optional-cost fixture did not open payment.');
      const optionalResponse=waitForResponse('browser-optional-cost',AI_TURN_WORKER_MESSAGE_TYPES.result);
      worker.postMessage(createAiTurnWorkerRequest({requestId:'browser-optional-cost',game:optionalGame,
        actorId:'p1',selectionMode:'neural',temperature:0.22}));
      const optionalDecision=await optionalResponse;
      const optionalAction=optionalDecision.decision?.selected?.action;
      if(!optionalAction||!applyAiAction(optionalGame,optionalAction,'p1').ok)throw new Error('Optional-cost decision failed.');
      const paymentResponse=waitForResponse('browser-after-option',AI_TURN_WORKER_MESSAGE_TYPES.result);
      worker.postMessage(createAiTurnWorkerRequest({requestId:'browser-after-option',game:optionalGame,
        actorId:'p1',selectionMode:'neural',temperature:0.22}));
      const paymentDecision=await paymentResponse;
      for(const action of paymentDecision.decision?.actions||[])
        if(!applyAiAction(optionalGame,action,'p1').ok)throw new Error('Rune payment after strategy failed.');
      return {
        configured: configured.ok,
        checkpointBufferDetached,
        ok: decision.ok,
        kind: decision.decision?.kind,
        selectedKind: decision.decision?.selected?.action?.kind,
        hasStateEncoding: Object.hasOwn(decision.decision || {}, "stateEncoding"),
        hasActionEncoding: Object.hasOwn(decision.decision || {}, "actionEncoding"),
        optionalKind:optionalAction.kind,
        nextKind:paymentDecision.decision?.kind,
        paymentCompleted:!optionalGame.pendingPayment,
        configurationMs: decisionStartedAt - configurationStartedAt,
        decisionMs: performance.now() - decisionStartedAt
      };
    } finally {
      worker.terminate();
    }
  });

  expect(result).toMatchObject({
    configured: true,
    checkpointBufferDetached: true,
    ok: true,
    kind: "neural",
    selectedKind: expect.any(String),
    hasStateEncoding: false,
    hasActionEncoding: false
    ,optionalKind:'choosePaymentOptions',nextKind:'payment',paymentCompleted:true
  });
  expect(result.configurationMs).toBeGreaterThan(0);
  expect(result.decisionMs).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test("AI start keeps its catalog server after account routing changes and exposes load errors", async ({ page, request }) => {
  test.setTimeout(150_000);
  const catalog = await (await request.get("/api/ai/generations")).json();
  const generation = catalog.generations.find((entry) => entry.kind === "bundled").generation;
  const remoteRequests = [];
  const modelRequests = [];
  await page.route("https://play.example.com/**", async (route) => {
    remoteRequests.push(route.request().url());
    await route.fulfill({ status: 404, json: { message: "AI generation was not found." } });
  });
  page.on("request", (incoming) => {
    if (/\/api\/ai\/generations\/\d+\/model$/u.test(incoming.url())) modelRequests.push(incoming.url());
  });
  await page.goto("/");
  await expect(page.locator(`[data-action="menu-ai-generation"] option[value="${generation}"]`)).toHaveCount(1);
  await page.locator('[data-action="settings-language"]').selectOption("ko");
  await page.locator('[data-action="menu-ai-generation"]').selectOption(String(generation));
  await page.locator('[data-action="menu-active-deck"][data-slot="1"]').selectOption("default-origins-sett");
  await page.evaluate(async () => {
    (await import("/src/net/client.mjs")).configureOnlineServer("https://play.example.com");
  });

  const modelRoute = `**/api/ai/generations/${generation}/model`;
  const unavailable = (route) => route.fulfill({ status: 404, json: { message: "AI generation was not found." } });
  await page.route(modelRoute, unavailable);
  await page.locator('[data-action="menu-ai"]').click();
  await expect(page.locator(".ai-model-status")).toContainText("AI generation was not found.");
  await page.unroute(modelRoute, unavailable);

  await page.locator('[data-action="menu-ai"]').click();
  await expect(page.locator('[data-action="roll-first-player"]').first()).toBeVisible({ timeout: 120_000 });
  expect(remoteRequests).toEqual([]);
  expect(modelRequests).toHaveLength(2);
  expect(modelRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});
