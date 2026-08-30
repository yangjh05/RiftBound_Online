import { expect, test } from "@playwright/test";

const INVALID_RENDER_VALUE = /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu;

function captureRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url;
    failures.push(`console.error${source ? ` (${source})` : ""}: ${message.text()}`);
  });
  return failures;
}

async function openReadyBoard(page) {
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await page.locator('[data-action="menu-start"]').click();

  for (let rollCount = 0; rollCount < 30; rollCount += 1) {
    const firstPlayerChoice = page.locator('[data-action="choose-first-player"]:enabled');
    if (await firstPlayerChoice.count()) {
      await firstPlayerChoice.first().click();
      break;
    }
    const roll = page.locator('[data-action="roll-first-player"]:enabled');
    await expect(roll).toHaveCount(1);
    await roll.click();
  }

  await expect(page.locator(".champion-setup")).toBeVisible();
  for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
    const champion = page.locator('[data-action="choose-champion"]:enabled');
    await expect(champion).toHaveCount(1);
    await champion.click();
  }
  for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
    const battlefield = page.locator('[data-action="choose-battlefield"]:enabled');
    if (await battlefield.count() === 0) break;
    await battlefield.first().click();
  }
  for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
    const keepHand = page.locator('[data-action="skip-mulligan"]');
    await expect(keepHand).toHaveCount(1);
    await keepHand.click();
  }

  await expect(page.locator(".tabletop-board")).toBeVisible();
}

async function primeMotionFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const opponent = game.players[1];
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.triggerQueue = [];
    game.selectedCardId = null;

    let playCard = player.hand.find((card) => card?.type === "unit");
    if (!playCard) {
      const index = player.mainDeck.findIndex((card) => card?.type === "unit");
      if (index < 0) throw new Error("motion fixture requires a Unit");
      [playCard] = player.mainDeck.splice(index, 1);
      player.hand.push(playCard);
    }
    playCard.ownerId = player.id;
    playCard.controllerId = player.id;
    playCard.exhausted = false;
    if (!player.legend || !player.champion || player.champion.zone !== "champion") {
      throw new Error("motion fixture requires physical Legend and Champion Zone cards");
    }
    player.legend.exhausted = false;
    player.champion.exhausted = false;
    let runeCard = player.runes.find(Boolean);
    if (!runeCard) {
      runeCard = player.runeDeck.pop();
      if (!runeCard) {
        runeCard = {
          ...structuredClone(playCard),
          instanceId: "e2e-motion-rune",
          type: "rune",
          domain: playCard.domains?.[0] || "Body",
          name: "Motion Rune"
        };
      }
      player.runes.push(runeCard);
    }
    runeCard.ownerId = player.id;
    runeCard.controllerId = player.id;
    runeCard.exhausted = false;
    const attachmentCard = {
      ...structuredClone(player.hand.find((card) => card.instanceId !== playCard.instanceId) || player.mainDeck[0] || playCard),
      instanceId: "e2e-motion-attachment",
      ownerId: player.id,
      controllerId: player.id,
      type: "gear",
      name: "Motion Attachment",
      exhausted: false,
      attachments: []
    };
    player.hand.push(attachmentCard);

    window.__tabletopMotionFixture = {
      playerId: player.id,
      opponentId: opponent.id,
      playCardId: playCard.instanceId,
      attachmentCardId: attachmentCard.instanceId,
      runeCardId: runeCard.instanceId,
      legendCardId: player.legend.instanceId,
      championCardId: player.champion.instanceId,
      drawId: "",
      burnId: ""
    };
    window.__riftboundRender();
    return structuredClone(window.__tabletopMotionFixture);
  });
}

async function primePrivateOpponentBoardPlay(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const viewer = game.players[0];
    const opponent = game.players[1];
    game.phase = "action";
    game.currentPlayerId = viewer.id;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;

    let sourceIndex = opponent.hand.findIndex((card) => card?.type === "unit");
    let card = sourceIndex >= 0 ? opponent.hand.splice(sourceIndex, 1)[0] : null;
    if (!card) {
      sourceIndex = opponent.mainDeck.findIndex((candidate) => candidate?.type === "unit");
      card = sourceIndex >= 0 ? opponent.mainDeck.splice(sourceIndex, 1)[0] : null;
    }
    if (!card) {
      const source = opponent.hand[0] || opponent.mainDeck[0] || opponent.legend;
      card = {
        ...structuredClone(source),
        instanceId: "e2e-private-board-card",
        type: "unit",
        attachments: []
      };
    }
    card.ownerId = opponent.id;
    card.controllerId = opponent.id;
    card.type = "unit";
    card.attachments ||= [];
    const placeholder = {
      ...structuredClone(card),
      instanceId: `redacted-pending-hand-${opponent.id}-0`,
      ownerId: opponent.id,
      controllerId: opponent.id,
      name: "Hidden card",
      image: "",
      text: "",
      translations: { ko: { name: "숨겨진 카드", text: "" } },
      redacted: true,
      attachments: []
    };
    opponent.hand.push(placeholder);
    window.__privateOpponentBoardPlay = { card, placeholderId: placeholder.instanceId };
    window.__riftboundRender();
    return {
      viewerId: viewer.id,
      opponentId: opponent.id,
      placeholderId: placeholder.instanceId,
      cardId: card.instanceId,
      cardName: card.name || "",
      cardImage: card.image || ""
    };
  });
}

async function performPrivateOpponentBoardPlay(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const fixture = window.__privateOpponentBoardPlay;
    const opponent = game.players.find((candidate) => candidate.id === fixture.card.ownerId);
    const placeholderIndex = opponent.hand.findIndex((card) => card.instanceId === fixture.placeholderId);
    if (placeholderIndex < 0) throw new Error("private board-play placeholder is missing");
    opponent.hand.splice(placeholderIndex, 1);
    opponent.base.push(fixture.card);
    window.__riftboundRender();

    const flight = document.querySelector(".tabletop-card-flight.transfer-play");
    const destination = document.querySelector(
      `.table-seat[data-player-id="${CSS.escape(opponent.id)}"] [data-zone="base"] [data-card-id="${CSS.escape(fixture.card.instanceId)}"]`
    );
    return {
      flight: flight ? {
        className: flight.className,
        text: flight.textContent || "",
        html: flight.innerHTML,
        hasBack: Boolean(flight.querySelector(".flight-card-back")),
        hasImage: Boolean(flight.querySelector("img")),
        hasName: Boolean(flight.querySelector(".flight-card-name"))
      } : null,
      destinationFound: Boolean(destination),
      destinationPending: destination?.classList.contains("tabletop-transfer-pending") || false
    };
  });
}

async function waitForFlightsToClear(page) {
  await expect(page.locator(".tabletop-card-flight")).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator(".tabletop-card-flight-layer")).toHaveCount(0, { timeout: 2_000 });
}

async function performTransition(page, kind) {
  return page.evaluate((transitionKind) => {
    const game = window.__riftboundGame;
    const fixture = window.__tabletopMotionFixture;
    const player = game.players.find((candidate) => candidate.id === fixture.playerId);
    const opponent = game.players.find((candidate) => candidate.id === fixture.opponentId);
    const field = game.battlefields[0];
    let card = null;

    if (transitionKind === "draw") {
      card = player.mainDeck.pop();
      if (!card) throw new Error("draw fixture has no Main Deck card");
      player.hand.push(card);
      fixture.drawId = card.instanceId;
    } else if (transitionKind === "opponent-draw") {
      card = opponent.mainDeck.pop();
      if (!card) throw new Error("opponent draw fixture has no Main Deck card");
      opponent.hand.push(card);
      fixture.opponentDrawId = card.instanceId;
    } else if (transitionKind === "opponent-play") {
      card = opponent.hand.pop();
      if (!card) throw new Error("opponent play fixture has no Hand card");
      game.actionChain = {
        playerId: opponent.id,
        turnPlayerId: player.id,
        priorityPlayerId: player.id,
        playerIds: game.players.map((candidate) => candidate.id),
        consecutivePasses: 0,
        chainSequence: 1,
        chainOpenedBy: "e2e-opponent-play",
        chain: [{
          id: "e2e-private-opponent-play",
          itemType: "card",
          playerId: opponent.id,
          card,
          destination: "base",
          status: "pending",
          playOptions: { playProcess: { source: "hand", privateLogSnapshot: [] } }
        }]
      };
      fixture.opponentPlayId = card.instanceId;
    } else if (transitionKind === "burn") {
      card = player.mainDeck.pop();
      if (!card) throw new Error("burn fixture has no Main Deck card");
      player.trash.push(card);
      fixture.burnId = card.instanceId;
    } else if (transitionKind === "flow") {
      const index = player.trash.findIndex((candidate) => candidate.instanceId === fixture.burnId);
      if (index < 0) throw new Error("flow fixture cannot find the burned card");
      [card] = player.trash.splice(index, 1);
      player.banished ||= [];
      player.banished.push(card);
    } else if (transitionKind === "play") {
      const index = player.hand.findIndex((candidate) => candidate.instanceId === fixture.playCardId);
      if (index < 0) throw new Error("play fixture cannot find its hand card");
      [card] = player.hand.splice(index, 1);
      card.controllerId = player.id;
      player.base.push(card);
    } else if (transitionKind === "move") {
      const index = player.base.findIndex((candidate) => candidate.instanceId === fixture.playCardId);
      if (index < 0) throw new Error("move fixture cannot find its base card");
      [card] = player.base.splice(index, 1);
      card.controllerId = player.id;
      field.units.push(card);
    } else if (transitionKind === "attach") {
      const index = player.hand.findIndex((candidate) => candidate.instanceId === fixture.attachmentCardId);
      const target = field.units.find((candidate) => candidate.instanceId === fixture.playCardId);
      if (index < 0 || !target) throw new Error("attachment fixture cannot find its cards");
      [card] = player.hand.splice(index, 1);
      target.attachments ||= [];
      target.attachments.push(card);
    } else {
      throw new Error(`unknown motion transition: ${transitionKind}`);
    }

    window.__riftboundRender();

    const expectedKind = transitionKind === "opponent-draw"
      ? "draw"
      : ["opponent-play", "attach"].includes(transitionKind) ? "play" : transitionKind;
    const flight = document.querySelector(`.tabletop-card-flight.transfer-${expectedKind}`);
    const flightAnimation = flight?.getAnimations?.()[0] || null;
    const timing = flightAnimation?.effect?.getTiming?.() || null;
    const keyframes = flightAnimation?.effect?.getKeyframes?.() || [];
    const escapedId = CSS.escape(card.instanceId);
    const destination = {
      draw: document.querySelector(`[data-zone="hand"][data-player-id="${CSS.escape(player.id)}"] [data-card-id="${escapedId}"]`),
      "opponent-draw": document.querySelector(`[data-zone="hand"][data-player-id="${CSS.escape(opponent.id)}"]`),
      "opponent-play": document.querySelector('[data-zone="chain"]'),
      burn: document.querySelector(`.table-seat[data-player-id="${CSS.escape(player.id)}"] [data-zone="trash"]`),
      flow: document.querySelector(`.table-seat[data-player-id="${CSS.escape(player.id)}"] [data-zone="banished"]`),
      play: document.querySelector(`.table-seat[data-player-id="${CSS.escape(player.id)}"] [data-zone="base"] [data-card-id="${escapedId}"]`),
      move: document.querySelector(`[data-zone="battlefields"] [data-card-id="${escapedId}"]`),
      attach: document.querySelector(`[data-zone="battlefields"] .attached-gear[data-card-id="${escapedId}"]`)
    }[transitionKind];

    return {
      kind: expectedKind,
      card: {
        id: card.instanceId,
        name: card.name || "",
        image: card.image || ""
      },
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false,
      flight: flight ? {
        className: flight.className,
        text: flight.textContent || "",
        html: flight.innerHTML,
        hasImage: Boolean(flight.querySelector("img")),
        hasName: Boolean(flight.querySelector(".flight-card-name")),
        hasBack: Boolean(flight.querySelector(".flight-card-back")),
        animation: timing ? {
          duration: timing.duration,
          delay: timing.delay,
          easing: timing.easing,
          keyframes: keyframes.map((keyframe) => ({ offset: keyframe.offset, transform: keyframe.transform }))
        } : null
      } : null,
      destination: destination ? {
        className: destination.className,
        count: destination.getAttribute("data-count"),
        hasCard: Boolean(destination.matches(`[data-card-id="${escapedId}"]`) || destination.querySelector(`[data-card-id="${escapedId}"]`)),
        anonymousHandCards: destination.querySelectorAll?.("[data-hand-card]").length || 0
      } : null,
      privateCardRenderedById: ["opponent-draw", "opponent-play"].includes(transitionKind)
        ? Boolean(document.querySelector(`.tabletop-layout [data-card-id="${escapedId}"]`))
        : null,
      badText: /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu.test(document.body.innerText)
    };
  }, kind);
}

function expectFaceUpFlight(result, kind) {
  expect(result.kind).toBe(kind);
  expect(result.reduced).toBe(false);
  expect(result.flight).not.toBeNull();
  expect(result.flight.className).toContain(`transfer-${kind}`);
  expect(result.flight.className).toContain("face-up");
  expect(result.flight.hasImage || result.flight.hasName).toBe(true);
  expect(result.flight.animation).not.toBeNull();
  expect(result.flight.animation.duration).toBe(280);
  expect(String(result.flight.animation.easing).replaceAll(" ", "")).toBe("cubic-bezier(0.22,0.9,0.2,1)");
  expect(result.flight.animation.keyframes).toHaveLength(3);
  expect(result.flight.animation.keyframes.at(-1).transform).toMatch(/translate3d\((?!0(?:px)?,\s*0(?:px)?)/u);
  expect(result.destination).not.toBeNull();
  expect(result.badText).toBe(false);
}

async function performDoubleDraw(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const fixture = window.__tabletopMotionFixture;
    const player = game.players.find((candidate) => candidate.id === fixture.playerId);
    const cards = player.mainDeck.splice(-2);
    if (cards.length !== 2) throw new Error("double-draw fixture requires two Main Deck cards");
    player.hand.push(...cards);
    window.__riftboundRender();
    return [...document.querySelectorAll(".tabletop-card-flight.transfer-draw")].map((flight) => {
      const animation = flight.getAnimations()[0];
      const timing = animation?.effect?.getTiming?.();
      return {
        className: flight.className,
        duration: timing?.duration,
        delay: timing?.delay,
        easing: timing?.easing
      };
    });
  });
}

async function performStateOrientationTransition(page, exhausted) {
  return page.evaluate(async (nextExhausted) => {
    const game = window.__riftboundGame;
    const fixture = window.__tabletopMotionFixture;
    const player = game.players.find((candidate) => candidate.id === fixture.playerId);
    const unit = game.battlefields
      .flatMap((field) => field.units)
      .find((candidate) => candidate.instanceId === fixture.playCardId);
    const rune = player.runes.find((candidate) => candidate.instanceId === fixture.runeCardId);
    const attachment = unit?.attachments?.find((candidate) => candidate.instanceId === fixture.attachmentCardId);
    const legend = player.legend?.instanceId === fixture.legendCardId ? player.legend : null;
    const champion = player.champion?.instanceId === fixture.championCardId && player.champion.zone === "champion"
      ? player.champion
      : null;
    if (!unit || !rune || !attachment || !legend || !champion) {
      throw new Error("state motion fixture cannot find unit, rune, attachment, Legend, and Champion");
    }

    unit.exhausted = nextExhausted;
    rune.exhausted = nextExhausted;
    attachment.exhausted = nextExhausted;
    legend.exhausted = nextExhausted;
    champion.exhausted = nextExhausted;
    window.__riftboundRender();

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const describe = (cardSelector, layerSelector) => {
      const card = document.querySelector(cardSelector);
      const layer = card?.querySelector(layerSelector) || null;
      const animations = [...(layer?.getAnimations?.() || [])].map((animation) => {
        const timing = animation.effect?.getTiming?.() || null;
        const keyframes = animation.effect?.getKeyframes?.() || [];
        return {
          type: animation.constructor?.name || "",
          duration: timing?.duration ?? null,
          easing: timing?.easing || "",
          transforms: keyframes.map((keyframe) => keyframe.transform || "").filter(Boolean)
        };
      });
      const stateAnimation = animations.find((animation) => animation.type === "Animation"
        && animation.duration === 220
        && animation.transforms.some((transform) => transform.includes("rotate"))) || null;
      return {
        cardFound: Boolean(card),
        layerFound: Boolean(layer),
        cardMarker: card?.dataset?.tabletopStateMotion || "",
        layerMarker: layer?.dataset?.tabletopStateMotion || "",
        cardMarkerClass: Boolean(card?.classList?.contains("tabletop-state-motion")),
        layerMarkerClass: Boolean(layer?.classList?.contains("tabletop-state-motion")),
        stateAnimation
      };
    };
    const escapedPlayerId = CSS.escape(player.id);
    return {
      exhausted: nextExhausted,
      ids: {
        unit: unit.instanceId,
        rune: rune.instanceId,
        attachment: attachment.instanceId,
        legend: legend.instanceId,
        champion: champion.instanceId
      },
      unit: describe(
        `[data-zone="battlefields"] [data-card-id="${CSS.escape(unit.instanceId)}"]`,
        ".card-exhaust-layer"
      ),
      rune: describe(
        `.table-seat[data-player-id="${escapedPlayerId}"] [data-zone="runes"] [data-card-id="${CSS.escape(rune.instanceId)}"]`,
        ".rune-orientation-layer"
      ),
      attachment: describe(
        `[data-zone="battlefields"] .attached-gear[data-card-id="${CSS.escape(attachment.instanceId)}"]`,
        ".attachment-orientation-layer"
      ),
      legend: describe(
        `.table-seat[data-player-id="${escapedPlayerId}"] [data-zone="legend"] [data-card-id="${CSS.escape(legend.instanceId)}"]`,
        ".identity-orientation-layer"
      ),
      champion: describe(
        `.table-seat[data-player-id="${escapedPlayerId}"] [data-zone="champion"] [data-card-id="${CSS.escape(champion.instanceId)}"]`,
        ".identity-orientation-layer"
      )
    };
  }, exhausted);
}

async function stateOrientationSnapshot(page, ids) {
  return page.evaluate((cardIds) => {
    const orientation = (cardId, layerSelector) => {
      const card = [...document.querySelectorAll(`[data-card-id="${CSS.escape(cardId)}"]`)]
        .find((candidate) => candidate.querySelector(layerSelector));
      const layer = card?.querySelector(layerSelector) || null;
      const transform = layer ? getComputedStyle(layer).transform : "none";
      const matrix = transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
      return {
        angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
        marker: layer?.dataset?.tabletopStateMotion || "",
        markerClass: Boolean(layer?.classList?.contains("tabletop-state-motion")),
        activeStateAnimations: [...(layer?.getAnimations?.() || [])].filter((animation) => {
          const keyframes = animation.effect?.getKeyframes?.() || [];
          return animation.constructor?.name === "Animation"
            && animation.effect?.getTiming?.().duration === 220
            && keyframes.some((keyframe) => String(keyframe.transform || "").includes("rotate"));
        }).length
      };
    };
    return {
      unit: orientation(cardIds.unit, ".card-exhaust-layer"),
      rune: orientation(cardIds.rune, ".rune-orientation-layer"),
      attachment: orientation(cardIds.attachment, ".attachment-orientation-layer"),
      legend: orientation(cardIds.legend, ".identity-orientation-layer"),
      champion: orientation(cardIds.champion, ".identity-orientation-layer")
    };
  }, ids);
}

async function primeBurnOutFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const fixture = window.__tabletopMotionFixture;
    const player = game.players.find((candidate) => candidate.id === fixture.playerId);
    const cards = player.mainDeck.splice(-2);
    if (cards.length !== 2) throw new Error("Burn Out fixture requires two Main Deck cards");
    player.trash.push(...cards);
    player.burnOuts = Math.max(0, Number(player.burnOuts) || 0);
    fixture.burnOutDrawId = cards[0].instanceId;
    fixture.burnOutRecycleId = cards[1].instanceId;
    fixture.burnOutsBefore = player.burnOuts;
    window.__riftboundRender();
    return {
      drawId: fixture.burnOutDrawId,
      recycleId: fixture.burnOutRecycleId,
      burnOutsBefore: fixture.burnOutsBefore
    };
  });
}

async function performBurnOutRecycleDraw(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const fixture = window.__tabletopMotionFixture;
    const player = game.players.find((candidate) => candidate.id === fixture.playerId);
    const takeTrashCard = (id) => {
      const index = player.trash.findIndex((card) => card.instanceId === id);
      if (index < 0) throw new Error(`Burn Out fixture cannot find trash card ${id}`);
      return player.trash.splice(index, 1)[0];
    };
    const drawCard = takeTrashCard(fixture.burnOutDrawId);
    const recycleCard = takeTrashCard(fixture.burnOutRecycleId);
    player.mainDeck.push(recycleCard);
    player.hand.push(drawCard);
    player.burnOuts = fixture.burnOutsBefore + 1;
    window.__riftboundRender();

    const describeFlight = (selector) => {
      const flight = document.querySelector(selector);
      const animation = flight?.getAnimations?.()[0] || null;
      const timing = animation?.effect?.getTiming?.() || null;
      return flight ? {
        className: flight.className,
        hasImage: Boolean(flight.querySelector("img")),
        hasName: Boolean(flight.querySelector(".flight-card-name")),
        duration: timing?.duration ?? null,
        easing: timing?.easing || ""
      } : null;
    };
    const escapedDrawId = CSS.escape(drawCard.instanceId);
    return {
      burnOuts: player.burnOuts,
      handHasDrawnCard: Boolean(document.querySelector(
        `[data-zone="hand"][data-player-id="${CSS.escape(player.id)}"] [data-card-id="${escapedDrawId}"]`
      )),
      drawFlight: describeFlight(".tabletop-card-flight.transfer-draw"),
      recycleFlight: describeFlight(".tabletop-card-flight.transfer-recycle"),
      wrongTrashToHandFlight: Boolean(document.querySelector(
        ".tabletop-card-flight.transfer-transfer, .tabletop-card-flight.transfer-recover"
      )),
      badText: /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu.test(document.body.innerText)
    };
  });
}

async function expectRuntimeHealthy(page, failures) {
  await expect(page.locator(".ui-exception-banner")).toHaveCount(0);
  const renderedText = await page.locator("body").innerText();
  expect(renderedText).not.toMatch(INVALID_RENDER_VALUE);
  expect(failures).toEqual([]);
}

test("real tabletop renders draw, burn, flow, play, move, and attachment card flights", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  await primeMotionFixture(page);
  await waitForFlightsToClear(page);

  const draw = await performTransition(page, "draw");
  expectFaceUpFlight(draw, "draw");
  expect(draw.destination.hasCard).toBe(true);
  await waitForFlightsToClear(page);

  const burn = await performTransition(page, "burn");
  expectFaceUpFlight(burn, "burn");
  expect(Number(burn.destination.count)).toBeGreaterThan(0);
  await waitForFlightsToClear(page);

  const flow = await performTransition(page, "flow");
  expectFaceUpFlight(flow, "flow");
  expect(Number(flow.destination.count)).toBeGreaterThan(0);
  await waitForFlightsToClear(page);

  const play = await performTransition(page, "play");
  expectFaceUpFlight(play, "play");
  expect(play.destination.hasCard).toBe(true);
  await waitForFlightsToClear(page);

  const move = await performTransition(page, "move");
  expectFaceUpFlight(move, "move");
  expect(move.destination.hasCard).toBe(true);
  await waitForFlightsToClear(page);

  const attach = await performTransition(page, "attach");
  expectFaceUpFlight(attach, "play");
  expect(attach.destination.hasCard).toBe(true);
  await waitForFlightsToClear(page);

  await expectRuntimeHealthy(page, runtimeFailures);
});

test("multiple draws keep the physical 82ms fan-in stagger", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  await primeMotionFixture(page);
  await waitForFlightsToClear(page);

  const flights = await performDoubleDraw(page);
  expect(flights).toHaveLength(2);
  expect(flights.map((flight) => flight.delay).sort((a, b) => a - b)).toEqual([0, 82]);
  for (const flight of flights) {
    expect(flight.className).toContain("face-up");
    expect(flight.duration).toBe(280);
    expect(String(flight.easing).replaceAll(" ", "")).toBe("cubic-bezier(0.22,0.9,0.2,1)");
  }
  await waitForFlightsToClear(page);
  await expectRuntimeHealthy(page, runtimeFailures);
});

test("unit, rune, attachment, Legend, and Champion ready and exhaust through their orientation layers", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  await primeMotionFixture(page);
  await waitForFlightsToClear(page);

  for (const transition of ["play", "move", "attach"]) {
    await performTransition(page, transition);
    await waitForFlightsToClear(page);
  }

  const exhausted = await performStateOrientationTransition(page, true);
  for (const result of [exhausted.unit, exhausted.rune, exhausted.attachment, exhausted.legend, exhausted.champion]) {
    expect(result.cardFound).toBe(true);
    expect(result.layerFound).toBe(true);
    expect(result.cardMarker).toBe("exhaust");
    expect(result.layerMarker).toBe("exhaust");
    expect(result.cardMarkerClass).toBe(true);
    expect(result.layerMarkerClass).toBe(true);
    expect(result.stateAnimation).not.toBeNull();
    expect(result.stateAnimation.duration).toBe(220);
    expect(String(result.stateAnimation.easing).replaceAll(" ", "")).toBe("cubic-bezier(0.2,0.8,0.2,1)");
    expect(result.stateAnimation.transforms[0]).toContain("rotate(0deg)");
    expect(result.stateAnimation.transforms.at(-1)).toContain("rotate(90deg)");
  }

  await expect.poll(() => stateOrientationSnapshot(page, exhausted.ids)).toMatchObject({
    unit: { marker: "", markerClass: false, activeStateAnimations: 0 },
    rune: { marker: "", markerClass: false, activeStateAnimations: 0 },
    attachment: { marker: "", markerClass: false, activeStateAnimations: 0 },
    legend: { marker: "", markerClass: false, activeStateAnimations: 0 },
    champion: { marker: "", markerClass: false, activeStateAnimations: 0 }
  });
  const spentOrientation = await stateOrientationSnapshot(page, exhausted.ids);
  for (const result of Object.values(spentOrientation)) {
    expect(Math.abs(Math.abs(result.angle) - 90)).toBeLessThan(1);
  }

  const ready = await performStateOrientationTransition(page, false);
  for (const result of [ready.unit, ready.rune, ready.attachment, ready.legend, ready.champion]) {
    expect(result.cardMarker).toBe("ready");
    expect(result.layerMarker).toBe("ready");
    expect(result.stateAnimation).not.toBeNull();
    expect(result.stateAnimation.transforms[0]).toContain("rotate(90deg)");
    expect(result.stateAnimation.transforms.at(-1)).toContain("rotate(0deg)");
  }
  await expect.poll(() => stateOrientationSnapshot(page, ready.ids)).toMatchObject({
    unit: { marker: "", markerClass: false, activeStateAnimations: 0 },
    rune: { marker: "", markerClass: false, activeStateAnimations: 0 },
    attachment: { marker: "", markerClass: false, activeStateAnimations: 0 },
    legend: { marker: "", markerClass: false, activeStateAnimations: 0 },
    champion: { marker: "", markerClass: false, activeStateAnimations: 0 }
  });
  const readyOrientation = await stateOrientationSnapshot(page, ready.ids);
  for (const result of Object.values(readyOrientation)) expect(Math.abs(result.angle)).toBeLessThan(1);

  await expectRuntimeHealthy(page, runtimeFailures);
});

test("Burn Out trash recycle is presented as a Main Deck draw into hand", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  await primeMotionFixture(page);
  await waitForFlightsToClear(page);
  const fixture = await primeBurnOutFixture(page);
  await waitForFlightsToClear(page);

  const result = await performBurnOutRecycleDraw(page);
  expect(result.burnOuts).toBe(fixture.burnOutsBefore + 1);
  expect(result.handHasDrawnCard).toBe(true);
  expect(result.drawFlight).not.toBeNull();
  expect(result.drawFlight.className).toContain("transfer-draw");
  expect(result.drawFlight.className).toContain("face-up");
  expect(result.drawFlight.hasImage || result.drawFlight.hasName).toBe(true);
  expect(result.drawFlight.duration).toBe(280);
  expect(String(result.drawFlight.easing).replaceAll(" ", "")).toBe("cubic-bezier(0.22,0.9,0.2,1)");
  expect(result.recycleFlight).not.toBeNull();
  expect(result.recycleFlight.className).toContain("transfer-recycle");
  expect(result.wrongTrashToHandFlight).toBe(false);
  expect(result.badText).toBe(false);
  await waitForFlightsToClear(page);
  await expectRuntimeHealthy(page, runtimeFailures);
});

test("opponent draw flight and hand keep the card face private", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  const fixture = await primeMotionFixture(page);
  await waitForFlightsToClear(page);

  const result = await performTransition(page, "opponent-draw");
  expect(result.kind).toBe("draw");
  expect(result.reduced).toBe(false);
  expect(result.flight).not.toBeNull();
  expect(result.flight.className).toContain("transfer-draw");
  expect(result.flight.className).toContain("face-down");
  expect(result.flight.hasBack).toBe(true);
  expect(result.flight.hasImage).toBe(false);
  expect(result.flight.hasName).toBe(false);
  expect(result.flight.text.trim()).toBe("R");
  expect(result.flight.html).not.toContain(result.card.name);
  if (result.card.image) expect(result.flight.html).not.toContain(result.card.image);
  expect(result.privateCardRenderedById).toBe(false);
  expect(result.destination).not.toBeNull();
  expect(result.destination.anonymousHandCards).toBeGreaterThan(0);
  expect(fixture.opponentId).not.toBe(fixture.playerId);
  await waitForFlightsToClear(page);

  await expectRuntimeHealthy(page, runtimeFailures);
});

test("opponent hand-to-chain play animates as a privacy-safe card back", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  await primeMotionFixture(page);
  await waitForFlightsToClear(page);

  const result = await performTransition(page, "opponent-play");
  expect(result.kind).toBe("play");
  expect(result.flight).not.toBeNull();
  expect(result.flight.className).toContain("transfer-play");
  expect(result.flight.className).toContain("face-down");
  expect(result.flight.hasBack).toBe(true);
  expect(result.flight.hasImage).toBe(false);
  expect(result.flight.hasName).toBe(false);
  expect(result.privateCardRenderedById).toBe(false);
  expect(result.destination).not.toBeNull();
  await waitForFlightsToClear(page);
  await expectRuntimeHealthy(page, runtimeFailures);
});

test("opponent pending hand cards fly face-down to their public board destination", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openReadyBoard(page);
  const fixture = await primePrivateOpponentBoardPlay(page);
  await waitForFlightsToClear(page);

  const result = await performPrivateOpponentBoardPlay(page);
  expect(result.destinationFound).toBe(true);
  expect(result.destinationPending).toBe(true);
  expect(result.flight).not.toBeNull();
  expect(result.flight.className).toContain("transfer-play");
  expect(result.flight.className).toContain("face-down");
  expect(result.flight.hasBack).toBe(true);
  expect(result.flight.hasImage).toBe(false);
  expect(result.flight.hasName).toBe(false);
  expect(result.flight.text.trim()).toBe("R");
  expect(result.flight.html).not.toContain(fixture.cardName);
  if (fixture.cardImage) expect(result.flight.html).not.toContain(fixture.cardImage);
  await waitForFlightsToClear(page);
  await expectRuntimeHealthy(page, runtimeFailures);
});

test("reduced motion skips flights and keeps a short arrival feedback path", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReadyBoard(page);
  const fixture = await primeMotionFixture(page);
  await page.waitForTimeout(160);

  const result = await performTransition(page, "play");
  expect(result.reduced).toBe(true);
  expect(result.flight).toBeNull();
  expect(result.destination).not.toBeNull();
  expect(result.destination.hasCard).toBe(true);
  expect(result.destination.className).toContain("tabletop-transfer-arrival");
  expect(result.destination.className).toContain("arrival-play");
  expect(result.badText).toBe(false);
  await expect(page.locator(".tabletop-card-flight, .tabletop-card-flight-layer")).toHaveCount(0);

  await page.waitForTimeout(160);
  await expect(page.locator(
    `.table-seat[data-player-id="${fixture.playerId}"] [data-zone="base"] [data-card-id="${result.card.id}"]`
  )).not.toHaveClass(/tabletop-transfer-arrival/u);
  await expectRuntimeHealthy(page, runtimeFailures);
});
