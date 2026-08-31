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

async function assertRuntimeHealthy(page, failures) {
  await expect(page.locator(".ui-exception-banner, .tabletop-state-unavailable")).toHaveCount(0);
  const invalid = await page.locator("body").evaluate((body) => {
    const pattern = /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu;
    const badAttribute = [...body.querySelectorAll(".tabletop-layout, .tabletop-layout *")]
      .flatMap((element) => [...element.attributes])
      .find((attribute) => pattern.test(attribute.value));
    return {
      text: pattern.exec(body.innerText)?.[0] || "",
      attribute: badAttribute ? `${badAttribute.name}=${badAttribute.value}` : ""
    };
  });
  expect(invalid).toEqual({ text: "", attribute: "" });
  expect(await page.locator("body").innerText()).not.toMatch(INVALID_RENDER_VALUE);
  expect(failures).toEqual([]);
}

async function installInteractionFixture(page, scenario) {
  return page.evaluate((name) => {
    const game = window.__riftboundGame;
    const [player, opponent] = game.players;
    const allCards = (owner) => [
      ...owner.hand,
      ...owner.mainDeck,
      ...owner.base,
      ...owner.trash,
      ...(owner.banished || [])
    ];
    const cloneCard = (source, instanceId, ownerId, overrides = {}) => ({
      ...structuredClone(source || {}),
      id: source?.id || instanceId,
      cardNumber: source?.cardNumber || `E2E-${instanceId}`,
      instanceId,
      ownerId,
      controllerId: ownerId,
      name: source?.name || instanceId,
      translations: source?.translations || { ko: { name: source?.name || instanceId, text: "회귀 테스트 카드" } },
      ...overrides
    });
    const actionState = () => {
      game.phase = "action";
      game.turnPlayerId = player.id;
      game.currentPlayerId = player.id;
      game.pendingPayment = null;
      game.pendingChoice = null;
      game.actionChain = null;
      game.showdown = null;
      game.triggerQueue = [];
      game.selectedCardId = null;
      player.banished ||= [];
      opponent.banished ||= [];
    };
    actionState();

    let fixture = { playerId: player.id, opponentId: opponent.id };
    if (name === "hand-choice") {
      const card = player.hand[0] || player.mainDeck.pop();
      if (!card) throw new Error("hand-choice fixture requires a card");
      if (!player.hand.some((candidate) => candidate.instanceId === card.instanceId)) player.hand.push(card);
      const optionId = `bottom:${card.instanceId}`;
      game.pendingChoice = {
        id: "e2e-hand-card-choice",
        playerId: player.id,
        card: player.legend,
        effect: "handCardToDeck",
        prompt: "Choose a hand card for the bottom of the deck.",
        options: [{ id: optionId, label: card.name, cardId: card.instanceId, placement: "bottom" }],
        optional: false,
        data: {}
      };
      fixture = {
        ...fixture,
        cardId: card.instanceId,
        cardName: card.name,
        optionId,
        handBefore: player.hand.length,
        deckBefore: player.mainDeck.length
      };
    }

    if (name === "hand-choice-variants") {
      const card = player.hand[0] || player.mainDeck.pop();
      if (!card) throw new Error("hand-choice-variants fixture requires a card");
      if (!player.hand.some((candidate) => candidate.instanceId === card.instanceId)) player.hand.push(card);
      const topOptionId = `top:${card.instanceId}`;
      const bottomOptionId = `bottom:${card.instanceId}`;
      game.pendingChoice = {
        id: "e2e-hand-card-variant-choice",
        playerId: player.id,
        card: player.legend,
        effect: "handCardToDeck",
        prompt: "Choose whether this card goes on top or bottom of the deck.",
        options: [
          { id: topOptionId, label: `${card.name}: top of deck`, cardId: card.instanceId, placement: "top" },
          { id: bottomOptionId, label: `${card.name}: bottom of deck`, cardId: card.instanceId, placement: "bottom" }
        ],
        optional: false,
        data: {}
      };
      fixture = {
        ...fixture,
        cardId: card.instanceId,
        topOptionId,
        bottomOptionId,
        handBefore: player.hand.length,
        deckBefore: player.mainDeck.length
      };
    }

    if (name === "semantic-player-choice") {
      game.pendingChoice = {
        id: "e2e-semantic-player-choice",
        playerId: player.id,
        card: player.legend,
        effect: "vendettaChoice",
        prompt: "Choose a player represented by a semantic option.",
        options: [{
          id: opponent.id,
          label: `Choose ${opponent.name}`,
          cardId: opponent.id,
          playerId: opponent.id
        }],
        optional: false,
        data: { operation: "nameCard", spec: {} }
      };
      fixture = { ...fixture, optionId: opponent.id, sourceId: player.legend.instanceId };
    }

    if (name === "board-choice-surfaces") {
      const unitSource = allCards(player).find((card) => card?.type === "unit")
        || allCards(opponent).find((card) => card?.type === "unit");
      if (!unitSource) throw new Error("board-choice-surfaces fixture requires a Unit template");
      const battlefieldUnit = cloneCard(unitSource, "e2e-board-choice-unit", player.id, {
        type: "unit",
        name: "Board Choice Unit",
        might: 5,
        damage: 0,
        attachments: [],
        effects: []
      });
      const baseUnit = cloneCard(unitSource, "e2e-base-choice-unit", player.id, {
        type: "unit",
        name: "Base Choice Unit",
        might: 5,
        damage: 0,
        attachments: [],
        effects: []
      });
      const rune = player.runes.at(-1) || player.runeDeck.pop();
      if (!rune) throw new Error("board-choice-surfaces fixture requires a Rune");
      if (!player.runes.some((candidate) => candidate.instanceId === rune.instanceId)) player.runes.push(rune);
      player.base.push(baseUnit);
      game.battlefields[0].units.push(battlefieldUnit);
      const choices = [
        { key: "unit", card: battlefieldUnit },
        { key: "base", card: baseUnit },
        { key: "battlefield", card: game.battlefields[0] },
        { key: "rune", card: rune }
      ].map(({ key, card }) => ({
        key,
        cardId: card.instanceId,
        optionId: `board-choice:${key}:${card.instanceId}`,
        label: card.name || key
      }));
      game.pendingChoice = {
        id: "e2e-board-choice-surfaces",
        playerId: player.id,
        card: player.legend,
        effect: "vendettaChoice",
        prompt: "Choose one physical object on the board.",
        options: choices.map((choice) => ({
          id: choice.optionId,
          label: choice.label,
          cardId: choice.cardId
        })),
        optional: false,
        data: { operation: "nameCard", spec: {} }
      };
      fixture = { ...fixture, choices };
    }

    if (name === "chain-card-choice") {
      const chainSource = allCards(player)[0] || allCards(opponent)[0];
      if (!chainSource) throw new Error("chain-card-choice fixture requires a card template");
      const firstChainCard = cloneCard(chainSource, "e2e-chain-choice-first", player.id, {
        name: "First Chain Choice Card"
      });
      const exactChainCard = cloneCard(chainSource, "e2e-chain-choice-exact", opponent.id, {
        name: "Exact Chain Choice Card"
      });
      game.actionChain = {
        turnPlayerId: player.id,
        priorityPlayerId: player.id,
        playerIds: game.players.map((candidate) => candidate.id),
        consecutivePasses: 0,
        chainSequence: 2,
        chainOpenedBy: "e2e-chain-card-choice",
        chain: [
          {
            id: "e2e-chain-choice-item-first",
            itemType: "card",
            playerId: player.id,
            card: firstChainCard,
            destination: "base",
            status: "finalized"
          },
          {
            id: "e2e-chain-choice-item-exact",
            itemType: "card",
            playerId: opponent.id,
            card: exactChainCard,
            destination: "base",
            status: "finalized"
          }
        ]
      };
      fixture = {
        ...fixture,
        sourceId: player.legend.instanceId,
        firstCardId: firstChainCard.instanceId,
        exactCardId: exactChainCard.instanceId,
        firstOptionId: `chain-option:${firstChainCard.instanceId}`,
        exactOptionId: `chain-option:${exactChainCard.instanceId}`
      };
    }

    if (name === "repeat-board-choice") {
      const unitSource = allCards(opponent).find((card) => card?.type === "unit")
        || allCards(player).find((card) => card?.type === "unit");
      if (!unitSource) throw new Error("repeat-board-choice fixture requires a Unit template");
      const target = cloneCard(unitSource, "e2e-repeat-choice-target", opponent.id, {
        type: "unit",
        name: "Repeated Damage Target",
        might: 12,
        damage: 0,
        attachments: [],
        effects: []
      });
      for (const battlefield of game.battlefields) battlefield.units = [];
      game.battlefields[0].units = [target];
      game.pendingChoice = {
        id: "e2e-repeat-board-choice",
        playerId: player.id,
        card: player.legend,
        effect: "damageUnit",
        prompt: "Choose the second target for repeated damage.",
        options: [{ id: target.instanceId, label: target.name, cardId: target.instanceId }],
        optional: false,
        data: {
          amount: 2,
          repeatTotal: 3,
          remaining: 2,
          allowRepeatedTargets: true
        }
      };
      fixture = { ...fixture, targetId: target.instanceId };
    }

    if (name === "disclosed-deck-preview") {
      const card = player.mainDeck[0];
      if (!card) throw new Error("disclosed-deck-preview fixture requires a Main Deck card");
      const optionId = `revealed-main-deck:${card.instanceId}`;
      game.pendingChoice = {
        id: "e2e-disclosed-deck-preview",
        playerId: player.id,
        card: player.legend,
        effect: "chooseTopDeck",
        prompt: "Inspect the disclosed Main Deck card.",
        options: [{ id: optionId, label: card.name, cardId: card.instanceId }],
        optional: false,
        data: { revealedIds: [card.instanceId] }
      };
      fixture = { ...fixture, cardId: card.instanceId, cardName: card.name, optionId };
    }

    if (name === "pile-choice") {
      while (player.trash.length < 2 && player.mainDeck.length) player.trash.push(player.mainDeck.pop());
      if (!player.banished.length && player.mainDeck.length) player.banished.push(player.mainDeck.pop());
      const pileCards = player.trash.slice(0, 2);
      if (pileCards.length < 2) throw new Error("pile-choice fixture requires two Trash cards");
      game.pendingChoice = {
        id: "e2e-pile-card-choice",
        playerId: player.id,
        card: player.legend,
        effect: "handCardToDeck",
        prompt: "Choose a card from the pile.",
        options: pileCards.map((card, index) => ({
          id: `pile-option-${index}`,
          label: card.name,
          cardId: card.instanceId
        })),
        optional: false,
        data: {}
      };
      fixture = {
        ...fixture,
        trashIds: pileCards.map((card) => card.instanceId),
        banishedId: player.banished[0]?.instanceId || ""
      };
    }

    if (name === "inspector") {
      const card = player.hand[0] || player.mainDeck.pop();
      if (!card) throw new Error("inspector fixture requires a card");
      if (!player.hand.some((candidate) => candidate.instanceId === card.instanceId)) player.hand.push(card);
      const longText = [
        "LONG_RULE_START — This line must remain visible in the inspector.",
        ...Array.from({ length: 36 }, (_, index) => `Continuous regression rule paragraph ${index + 1}: preserve every word and line.`),
        "LONG_RULE_END — No rule text may be clamped away."
      ].join("\n");
      card.name = "Long Rules Regression Card";
      card.text = longText;
      card.translations = {
        ...(card.translations || {}),
        ko: { ...(card.translations?.ko || {}), name: "긴 규칙 회귀 카드", text: longText },
        en: { ...(card.translations?.en || {}), name: "Long Rules Regression Card", text: longText }
      };
      fixture = { ...fixture, cardId: card.instanceId, longText };
    }

    if (name === "reaction") {
      game.actionChain = {
        turnPlayerId: player.id,
        priorityPlayerId: player.id,
        playerIds: game.players.map((candidate) => candidate.id),
        consecutivePasses: 0,
        chainSequence: 1,
        chainOpenedBy: "e2e-response-group",
        chain: []
      };
    }

    if (name === "rune") {
      const rune = player.runes.at(-1) || player.runeDeck.pop();
      if (!rune) throw new Error("rune fixture requires a Rune");
      if (!player.runes.some((candidate) => candidate.instanceId === rune.instanceId)) player.runes.push(rune);
      rune.exhausted = true;
      rune.effects = [
        ...(Array.isArray(rune.effects) ? rune.effects : []),
        { timing: "activated", kind: "addPower", amount: 1, domain: rune.domain || "Any", exhaust: false }
      ];
      fixture = { ...fixture, runeId: rune.instanceId };
    }

    if (name === "split-damage") {
      const unitSource = allCards(opponent).find((card) => card?.type === "unit")
        || allCards(player).find((card) => card?.type === "unit");
      if (!unitSource) throw new Error("split-damage fixture requires a Unit template");
      const target = cloneCard(unitSource, "e2e-split-damage-target", opponent.id, {
        type: "unit",
        name: "Split Damage Regression Target",
        might: 20,
        damage: 0,
        buffs: 0,
        mightModifier: 0,
        temporaryMight: 0,
        exhausted: false,
        stunned: false,
        attachments: [],
        keywords: [],
        effects: []
      });
      for (const battlefield of game.battlefields) battlefield.units = [];
      game.battlefields[0].units = [target];
      const optionOne = `${target.instanceId}:1`;
      const optionThree = `${target.instanceId}:3`;
      game.pendingChoice = {
        id: "e2e-split-damage-choice",
        playerId: player.id,
        card: player.legend,
        effect: "splitDamageAllocation",
        prompt: "Assign three regression damage.",
        options: [
          { id: optionOne, label: `${target.name}: 1 damage`, cardId: target.instanceId, amount: 1 },
          { id: optionThree, label: `${target.name}: 3 damage`, cardId: target.instanceId, amount: 3 }
        ],
        optional: false,
        finishSpell: false,
        data: {
          splitDamage: {
            config: { amount: 3, damageOrigin: "ability", markMessage: "Regression split damage resolves." },
            targetIds: [target.instanceId],
            remainingTargetIds: [target.instanceId],
            remainingDamage: 3,
            allocations: []
          }
        }
      };
      fixture = { ...fixture, targetId: target.instanceId, optionOne, optionThree };
    }

    if (name === "damage-history") {
      const unitSource = allCards(opponent).find((card) => card?.type === "unit")
        || allCards(player).find((card) => card?.type === "unit");
      if (!unitSource) throw new Error("damage-history fixture requires a Unit template");
      const assignedTarget = cloneCard(unitSource, "e2e-damage-history-assigned", opponent.id, {
        type: "unit",
        name: "Already Assigned Target",
        might: 10,
        damage: 0,
        attachments: [],
        effects: []
      });
      const remainingTarget = cloneCard(unitSource, "e2e-damage-history-remaining", opponent.id, {
        type: "unit",
        name: "Remaining Damage Target",
        might: 10,
        damage: 0,
        attachments: [],
        effects: []
      });
      for (const battlefield of game.battlefields) battlefield.units = [];
      game.battlefields[0].units = [assignedTarget, remainingTarget];
      game.pendingChoice = {
        id: "e2e-combat-damage-history",
        playerId: player.id,
        card: player.legend,
        effect: "combatDamage",
        prompt: "Assign the remaining combat damage.",
        options: [{
          id: remainingTarget.instanceId,
          label: remainingTarget.name,
          cardId: remainingTarget.instanceId,
          amount: 2
        }],
        optional: false,
        data: {
          battlefieldId: game.battlefields[0].instanceId,
          attackerId: player.id,
          defenderId: opponent.id,
          assigningPlayerId: player.id,
          targetPlayerId: opponent.id,
          role: "attacker",
          attackerTotal: 5,
          defenderTotal: 0,
          remaining: 2,
          assignments: [{
            targetId: assignedTarget.instanceId,
            amount: 3,
            assigningPlayerId: player.id,
            role: "attacker"
          }],
          targetInfos: [{ cardId: remainingTarget.instanceId, amount: 2, lethalNow: false }]
        }
      };
      fixture = {
        ...fixture,
        assignedTargetId: assignedTarget.instanceId,
        remainingTargetId: remainingTarget.instanceId,
        battlefieldId: game.battlefields[0].instanceId
      };
    }

    if (name === "drag") {
      const unitSource = allCards(player).find((card) => card?.type === "unit");
      if (!unitSource) throw new Error("drag fixture requires a Unit template");
      const card = cloneCard(unitSource, "e2e-drag-play-unit", player.id, {
        type: "unit",
        name: "Drag Play Regression Unit",
        energy: 0,
        power: [],
        tags: [],
        keywords: [],
        effects: [],
        attachments: [],
        additionalCost: null,
        exhausted: false,
        stunned: false
      });
      player.hand.push(card);
      fixture = {
        ...fixture,
        cardId: card.instanceId,
        battlefieldIds: game.battlefields.map((battlefield) => battlefield.instanceId)
      };
    }

    window.__riftboundRender();
    return fixture;
  }, scenario);
}

test("hand choices stage, toggle, and confirm the exact card option", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "hand-choice");

  const handChoice = page.locator(".choice-stage-bar.hand-choice-stage");
  const card = page.locator(`[data-zone="hand"][data-player-id="${fixture.playerId}"] [data-hand-card][data-card-id="${fixture.cardId}"]`);
  const confirm = handChoice.locator('[data-action="confirm-staged-choice"]');
  await expect(handChoice).toBeVisible();
  await expect(page.locator(".choice-panel, .choice-zone-drawer")).toHaveCount(0);
  await expect(card).toHaveAttribute("data-choice", fixture.optionId);
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(confirm).toBeDisabled();

  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(card).toHaveClass(/choice-card-staged/u);
  await expect(confirm).toBeEnabled();
  await expect(confirm).toContainText(fixture.cardName);

  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(confirm).toBeDisabled();

  await card.click();
  await confirm.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingChoice)).toBeNull();
  const resolved = await page.evaluate(({ playerId, cardId }) => {
    const player = window.__riftboundGame.players.find((candidate) => candidate.id === playerId);
    return {
      inHand: player.hand.some((candidate) => candidate.instanceId === cardId),
      deckBottom: player.mainDeck.at(-1)?.instanceId || "",
      handCount: player.hand.length,
      deckCount: player.mainDeck.length
    };
  }, { playerId: fixture.playerId, cardId: fixture.cardId });
  expect(resolved).toEqual({
    inHand: false,
    deckBottom: fixture.cardId,
    handCount: fixture.handBefore - 1,
    deckCount: fixture.deckBefore + 1
  });
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("one physical hand card exposes every option variant and confirms the exact bottom choice", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "hand-choice-variants");

  const stage = page.locator(".choice-stage-bar.hand-choice-stage");
  const variants = stage.locator(".choice-stage-variants");
  const top = variants.locator(`button[data-action="stage-choice-option"][data-choice="${fixture.topOptionId}"]`);
  const bottom = variants.locator(`button[data-action="stage-choice-option"][data-choice="${fixture.bottomOptionId}"]`);
  const card = page.locator(`[data-zone="hand"][data-player-id="${fixture.playerId}"] [data-hand-card][data-card-id="${fixture.cardId}"]`);
  const confirm = stage.locator('[data-action="confirm-staged-choice"]');
  await expect(stage).toBeVisible();
  await expect(card).toHaveClass(/choice-card-selectable/u);
  await expect(confirm).toBeDisabled();

  await card.click();
  await expect(variants).toBeVisible();
  await expect(top).toBeVisible();
  await expect(bottom).toBeVisible();
  await expect(top).toHaveAttribute("aria-pressed", "true");
  await expect(bottom).toHaveAttribute("aria-pressed", "false");
  await expect(confirm).toBeEnabled();

  await bottom.click();
  await expect(bottom).toHaveClass(/is-active/u);
  await expect(bottom).toHaveAttribute("aria-pressed", "true");
  await expect(top).toHaveAttribute("aria-pressed", "false");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const resolved = await page.evaluate(({ playerId, cardId }) => {
    const player = window.__riftboundGame.players.find((candidate) => candidate.id === playerId);
    return {
      pendingChoice: window.__riftboundGame.pendingChoice,
      inHand: player.hand.some((candidate) => candidate.instanceId === cardId),
      deckTop: player.mainDeck[0]?.instanceId || "",
      deckBottom: player.mainDeck.at(-1)?.instanceId || "",
      handCount: player.hand.length,
      deckCount: player.mainDeck.length
    };
  }, { playerId: fixture.playerId, cardId: fixture.cardId });
  expect(resolved).toEqual({
    pendingChoice: null,
    inHand: false,
    deckTop: expect.any(String),
    deckBottom: fixture.cardId,
    handCount: fixture.handBefore - 1,
    deckCount: fixture.deckBefore + 1
  });
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("semantic player options whose cardId is a player id remain selectable in the fallback panel", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "semantic-player-choice");

  const panel = page.locator(".choice-panel.choice-resolution-panel");
  const option = panel.locator(`button[data-action="choose-effect"][data-choice="${fixture.optionId}"]`);
  await expect(panel).toBeVisible();
  await expect(page.locator(".choice-stage-bar, .choice-zone-drawer")).toHaveCount(0);
  await expect(option).toBeVisible();
  await expect(option).toBeEnabled();
  await expect(option).toContainText(/Choose|선택/iu);
  await option.click();

  const resolved = await page.evaluate(({ sourceId, optionId }) => {
    const source = window.__riftboundGame.players
      .map((player) => player.legend)
      .find((card) => card?.instanceId === sourceId);
    return {
      pendingChoice: window.__riftboundGame.pendingChoice,
      namedCard: source?.namedCard || ""
    };
  }, { sourceId: fixture.sourceId, optionId: fixture.optionId });
  expect(resolved).toEqual({ pendingChoice: null, namedCard: fixture.optionId });
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("board unit, base, battlefield, and Rune choices expose selectable and staged states", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "board-choice-surfaces");

  const stage = page.locator(".choice-stage-bar.board-choice-stage");
  const confirm = stage.locator('[data-action="confirm-staged-choice"]');
  await expect(stage).toBeVisible();
  await expect(confirm).toBeDisabled();

  for (const choice of fixture.choices) {
    const card = choice.key === "rune"
      ? page.locator(`[data-rune-card][data-card-id="${choice.cardId}"]`)
      : choice.key === "battlefield"
        ? page.locator(`article.battlefield[data-card-id="${choice.cardId}"]`)
        : page.locator(`[data-card-id="${choice.cardId}"][role="button"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/choice-card-selectable/u);
    await expect(card).not.toHaveClass(/choice-card-staged/u);

    await card.click();
    await expect(card).toHaveClass(/choice-card-staged/u);
    await expect(confirm).toBeEnabled();

    await card.click();
    await expect(card).not.toHaveClass(/choice-card-staged/u);
    await expect(confirm).toBeDisabled();
  }
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingChoice?.id)).toBe("e2e-board-choice-surfaces");
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("collapsed Chain card choices use the wide drawer and confirm the exact option", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "chain-card-choice");

  const chain = page.locator(".chain-zone.chain-pod");
  const chainToggle = chain.locator('[data-action="toggle-chain-zone"]');
  await expect(chain).toBeVisible();
  await expect(chainToggle).toHaveAttribute("aria-expanded", "true");
  await chainToggle.click();
  await expect(chain).toHaveClass(/is-collapsed/u);
  await expect(chainToggle).toHaveAttribute("aria-expanded", "false");

  await page.evaluate((data) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === data.playerId);
    const cards = game.actionChain.chain.map((item) => item.card);
    game.pendingChoice = {
      id: "e2e-collapsed-chain-card-choice",
      playerId: data.playerId,
      card: player.legend,
      effect: "vendettaChoice",
      prompt: "Choose the exact card from the collapsed Chain.",
      options: [
        { id: data.firstOptionId, label: cards[0].name, cardId: data.firstCardId },
        { id: data.exactOptionId, label: cards[1].name, cardId: data.exactCardId }
      ],
      optional: false,
      data: { operation: "nameCard", spec: {} }
    };
    window.__riftboundRender();
  }, fixture);

  const drawer = page.locator(".table-command-layer > .choice-zone-drawer");
  const exact = drawer.locator(
    `.choice-drawer-card[data-action="stage-choice-card"][data-choice="${fixture.exactOptionId}"]`
  );
  const confirm = drawer.locator('[data-action="confirm-staged-choice"]');
  await expect(chain).toHaveClass(/is-collapsed/u);
  await expect(page.locator(".choice-stage-bar, .choice-panel")).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".choice-drawer-card")).toHaveCount(2);
  await expect(exact).toBeVisible();
  await expect(confirm).toBeDisabled();

  await exact.click();
  await expect(exact).toHaveAttribute("aria-pressed", "true");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const resolved = await page.evaluate(({ sourceId }) => {
    const source = window.__riftboundGame.players
      .map((player) => player.legend)
      .find((card) => card?.instanceId === sourceId);
    return {
      pendingChoice: window.__riftboundGame.pendingChoice,
      namedCard: source?.namedCard || ""
    };
  }, fixture);
  expect(resolved).toEqual({ pendingChoice: null, namedCard: fixture.exactOptionId });
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("inline repeated damage choices show progress and repeated-target guidance", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "repeat-board-choice");

  const stage = page.locator(".choice-stage-bar.board-choice-stage");
  const target = page.locator(`[data-card-id="${fixture.targetId}"][role="button"]`);
  const progress = stage.locator(".choice-repeat-progress");
  await expect(stage).toBeVisible();
  await expect(target).toHaveClass(/choice-card-selectable/u);
  await expect(progress).toBeVisible();
  await expect(progress.locator("strong")).toContainText(/2\/3/u);
  await expect(progress).toContainText(/같은 유닛을 다시 선택할 수 있습니다|The same unit may be selected again/iu);

  await page.evaluate(() => {
    window.__riftboundGame.pendingChoice.data.allowRepeatedTargets = false;
    window.__riftboundRender();
  });
  await expect(progress.locator("strong")).toContainText(/2\/3/u);
  await expect(progress).toContainText(/이전에 선택한 유닛은 다시 선택할 수 없습니다|Previously selected units cannot be selected again/iu);
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("the hand can still be toggled while a hand-card choice is pending", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installInteractionFixture(page, "hand-choice");

  const hand = page.locator('.persistent-hand[data-side="bottom"], .hand-drawer.persistent-hand');
  const toggle = hand.locator('[data-action="toggle-hand"]');
  await expect(page.locator(".choice-stage-bar.hand-choice-stage")).toBeVisible();
  await expect(toggle).toBeVisible();
  const classBefore = await hand.getAttribute("class");
  const expandedBefore = await toggle.getAttribute("aria-expanded");
  await toggle.click();
  await expect.poll(() => hand.getAttribute("class")).not.toBe(classBefore);
  await expect(toggle).toHaveAttribute("aria-expanded", expandedBefore === "true" ? "false" : "true");
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingChoice?.id)).toBe("e2e-hand-card-choice");
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("every disclosed Main Deck choice shape keeps its full-card preview through sanitize and render", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "disclosed-deck-preview");

  const drawer = page.locator(".table-command-layer > .choice-zone-drawer");
  await expect(drawer).toBeVisible();
  const modal = page.locator(".full-card-modal");
  for (const disclosure of [
    { key: "revealedIds", array: true },
    { key: "topCardIds", array: true },
    { key: "topCardId", array: false }
  ]) {
    await page.evaluate(({ cardId, key, array }) => {
      window.__riftboundGame.pendingChoice.data = { [key]: array ? [cardId] : cardId };
      window.__riftboundRender();
    }, { cardId: fixture.cardId, ...disclosure });

    const choice = drawer.locator(`.choice-drawer-card[data-choice="${fixture.optionId}"]`);
    const view = drawer.locator(`[data-action="view-choice-card"][data-card-id="${fixture.cardId}"]`);
    await expect(choice).toBeVisible();
    await expect(view).toBeVisible();
    await view.click();
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(fixture.cardName);
    await page.evaluate(() => window.__riftboundRender());
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(fixture.cardName);
    await modal.locator('[data-action="close-full-card"]').click();
    await expect(modal).toHaveCount(0);
  }
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingChoice?.id)).toBe("e2e-disclosed-deck-preview");
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("pile choices use the lower drawer and normal piles stay compact and inspectable", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "pile-choice");

  const drawer = page.locator(".table-command-layer > .choice-zone-drawer");
  const hand = page.locator('.persistent-hand[data-side="bottom"], .hand-drawer.persistent-hand');
  await expect(drawer).toBeVisible();
  await expect(page.locator(".choice-panel")).toHaveCount(0);
  await expect(drawer.locator(".choice-drawer-card")).toHaveCount(2);
  const [drawerBox, handBox] = await Promise.all([drawer.boundingBox(), hand.boundingBox()]);
  expect(drawerBox).not.toBeNull();
  expect(handBox).not.toBeNull();
  expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(handBox.y + 8);

  const firstChoice = drawer.locator(".choice-drawer-card").first();
  await firstChoice.click();
  await expect(firstChoice).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.locator('[data-action="confirm-staged-choice"]')).toBeEnabled();

  const collapse = drawer.locator('[data-action="toggle-choice-drawer"]');
  await collapse.click();
  await expect(drawer).toHaveClass(/is-collapsed/u);
  await expect(collapse).toHaveAttribute("aria-expanded", "false");
  await expect(drawer.locator(".choice-drawer-track")).toHaveCount(0);
  await collapse.click();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.locator(".choice-drawer-track")).toBeVisible();

  await page.evaluate(() => {
    window.__riftboundGame.pendingChoice = null;
    window.__riftboundRender();
  });
  const seat = page.locator(`.table-seat[data-player-id="${fixture.playerId}"]`);
  await seat.locator('[data-action="toggle-graveyard"]').click();
  const trashPanel = page.locator(".graveyard-panel:not(.banished-panel)");
  const trashCard = trashPanel.locator(`.pile-browser-card[data-card-id="${fixture.trashIds[0]}"]`);
  await expect(trashPanel).toBeVisible();
  await expect(trashCard).toHaveAttribute("role", "button");
  await expect(trashCard.locator(".pile-browser-art")).toHaveCount(1);
  await expect(trashCard.locator(".pile-browser-copy > strong")).not.toBeEmpty();
  const compactBox = await trashCard.boundingBox();
  expect(compactBox).not.toBeNull();
  expect(compactBox.height).toBeLessThanOrEqual(82);
  expect(compactBox.width).toBeGreaterThan(compactBox.height);
  await page.locator('[data-action="close-graveyard"]').click();

  await seat.locator('[data-action="toggle-banished"]').click();
  const banishedPanel = page.locator(".banished-panel");
  await expect(banishedPanel.locator(".pile-browser-entry .pile-browser-card")).toHaveCount(1);
  await expect(banishedPanel.locator(".pile-browser-copy")).toBeVisible();
  await page.locator('[data-action="close-banished"]').click();

  await seat.locator('[data-action="toggle-graveyard"]').click();
  await trashPanel.locator(`.pile-browser-card[data-card-id="${fixture.trashIds[0]}"]`).click();
  await expect(trashPanel).toHaveCount(0);
  await expect(page.locator(".inspector.inspector-panel")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(fixture.trashIds[0]);
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("card selection toggles the inspector and preserves long rules text", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "inspector");

  const card = page.locator(`[data-zone="hand"][data-player-id="${fixture.playerId}"] [data-hand-card][data-card-id="${fixture.cardId}"]`);
  const inspector = page.locator(".inspector.inspector-panel");
  await card.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(fixture.cardId);
  await expect(inspector).toBeVisible();
  await expect(page.locator(".tabletop-layout")).toHaveClass(/inspector-open/u);

  const rules = inspector.locator(".inspector-rules-text");
  await expect(rules).toContainText("LONG_RULE_START");
  await expect(rules).toContainText("Continuous regression rule paragraph 36");
  await expect(rules).toContainText("LONG_RULE_END");
  const layout = await inspector.evaluate((panel) => {
    const toolbar = panel.querySelector(".inspector-toolbar");
    const text = panel.querySelector(".inspector-text");
    const rulesText = panel.querySelector(".inspector-rules-text");
    const toolbarRect = toolbar.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const rulesStyle = getComputedStyle(rulesText);
    const textStyle = getComputedStyle(text);
    return {
      toolbarBeforeText: toolbarRect.bottom <= textRect.bottom,
      rulesMaxHeight: rulesStyle.maxHeight,
      rulesOverflowY: rulesStyle.overflowY,
      lineClamp: rulesStyle.getPropertyValue("-webkit-line-clamp"),
      textOverflowY: textStyle.overflowY,
      fullTextPresent: rulesText.textContent.includes("LONG_RULE_END")
    };
  });
  expect(layout.toolbarBeforeText).toBe(true);
  expect(layout.rulesMaxHeight).toBe("none");
  expect(layout.rulesOverflowY).toBe("visible");
  expect(["none", "unset", ""]).toContain(layout.lineClamp);
  expect(["auto", "scroll"]).toContain(layout.textOverflowY);
  expect(layout.fullTextPresent).toBe(true);

  await card.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBeNull();
  await expect(inspector).toHaveCount(0);

  await card.click();
  await expect(inspector).toBeVisible();
  await inspector.locator('.inspector-toolbar [data-action="toggle-inspector"]').click();
  await expect(inspector).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(fixture.cardId);
  await page.locator('.table-action-rail [data-action="toggle-inspector"]:not([disabled])').click();
  await expect(inspector).toBeVisible();
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("reaction and pass controls form one priority decision group", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installInteractionFixture(page, "reaction");

  const group = page.locator('.action-command-list > .priority-response-controls[role="group"]');
  await expect(group).toBeVisible();
  await expect(group).toHaveAttribute("aria-label", /반응 또는 패스|React or pass/iu);
  await expect(group.locator('[data-action="toggle-hand"]')).toHaveCount(1);
  await expect(group.locator('[data-action="pass-showdown"]')).toHaveCount(1);
  await expect(page.locator('.table-action-rail [data-action="pass-showdown"]')).toHaveCount(0);
  await expect(page.locator('[data-action="pass-showdown"]')).toHaveCount(1);

  const hand = page.locator('.persistent-hand[data-side="bottom"], .hand-drawer.persistent-hand');
  const handClassBefore = await hand.getAttribute("class");
  await group.locator('[data-action="toggle-hand"]').click();
  await expect.poll(() => hand.getAttribute("class")).not.toBe(handClassBefore);

  await page.locator('.priority-response-controls [data-action="pass-showdown"]:enabled').click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.actionChain?.consecutivePasses)).toBe(1);
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("exhausted Runes rely on their card pose without duplicate state wording", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "rune");

  const rune = page.locator(`.table-seat[data-player-id="${fixture.playerId}"] [data-rune-card][data-card-id="${fixture.runeId}"]`);
  await expect(rune).toHaveClass(/spent/u);
  await expect(rune.locator(".rune-recycle-ready")).toHaveCount(0);
  await expect(rune).not.toContainText(/탈진|Exhausted|재활용 가능|Can recycle/iu);
  await page.waitForTimeout(250);
  const angle = await rune.locator(".rune-orientation-layer").evaluate((layer) => {
    const transform = getComputedStyle(layer).transform;
    if (transform === "none") return 0;
    const matrix = new DOMMatrixReadOnly(transform);
    return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  });
  expect(Math.abs(Math.abs(angle) - 90)).toBeLessThan(1);
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("split damage assignment dispatches the selected amount option id", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "split-damage");

  const panel = page.locator(".alpha-strike-panel.damage-assignment-drawer");
  const input = panel.locator(`input[data-alpha-target="${fixture.targetId}"]`);
  await expect(panel).toBeVisible();
  await expect(input).toHaveAttribute("data-allowed-amounts", "1 3");
  await expect(input).toHaveValue("3");
  await panel.locator(`[data-action="adjust-alpha-damage"][data-target="${fixture.targetId}"][data-delta="-1"]`).click();
  await expect(input).toHaveValue("1");
  await panel.locator(`[data-action="adjust-alpha-damage"][data-target="${fixture.targetId}"][data-delta="1"]`).click();
  await expect(input).toHaveValue("3");
  await panel.locator(`[data-action="assign-alpha-strike"][data-target="${fixture.targetId}"]`).click();

  const resolved = await page.evaluate((targetId) => {
    const game = window.__riftboundGame;
    const target = game.battlefields.flatMap((battlefield) => battlefield.units)
      .find((card) => card.instanceId === targetId)
      || game.players.flatMap((player) => player.trash).find((card) => card.instanceId === targetId);
    return {
      pendingChoice: game.pendingChoice,
      targetDamage: target?.damage,
      targetId: target?.instanceId || ""
    };
  }, fixture.targetId);
  expect(resolved.pendingChoice).toBeNull();
  expect(resolved.targetId).toBe(fixture.targetId);
  expect(resolved.targetDamage).toBe(3);
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("combat and split damage drawers preserve prior assignment history", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "damage-history");

  const historyChip = (targetId, amount) => page.locator(
    `.damage-assignment-history .damage-assignment-chip[data-target-id="${targetId}"][data-amount="${amount}"]`
  );
  const combatPanel = page.locator(".combat-damage-panel.damage-assignment-drawer");
  await expect(combatPanel).toBeVisible();
  await expect(combatPanel.locator(".damage-assignment-history")).toBeVisible();
  await expect(historyChip(fixture.assignedTargetId, 3)).toBeVisible();
  await expect(historyChip(fixture.assignedTargetId, 3)).toContainText("Already Assigned Target");

  await page.evaluate(({ playerId, assignedTargetId, remainingTargetId }) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    game.pendingChoice = {
      id: "e2e-split-damage-history",
      playerId,
      card: player.legend,
      effect: "splitDamageAllocation",
      prompt: "Assign the remaining split damage.",
      options: [{
        id: `${remainingTargetId}:2`,
        label: "Remaining Damage Target: 2 damage",
        cardId: remainingTargetId,
        amount: 2
      }],
      optional: false,
      data: {
        splitDamage: {
          config: { amount: 5, damageOrigin: "ability" },
          targetIds: [assignedTargetId, remainingTargetId],
          remainingTargetIds: [remainingTargetId],
          remainingDamage: 2,
          allocations: [{ targetId: assignedTargetId, amount: 3 }]
        }
      }
    };
    window.__riftboundRender();
  }, {
    playerId: fixture.playerId,
    assignedTargetId: fixture.assignedTargetId,
    remainingTargetId: fixture.remainingTargetId
  });

  const alphaPanel = page.locator(".alpha-strike-panel.damage-assignment-drawer");
  await expect(alphaPanel).toBeVisible();
  await expect(alphaPanel.locator(".damage-assignment-history")).toBeVisible();
  await expect(historyChip(fixture.assignedTargetId, 3)).toBeVisible();
  await expect(historyChip(fixture.assignedTargetId, 3)).toContainText("Already Assigned Target");
  await assertRuntimeHealthy(page, runtimeFailures);
});

test("hand drag exposes only legal destinations and rejects a forged drop target", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installInteractionFixture(page, "drag");

  let card = page.locator(`[data-zone="hand"][data-player-id="${fixture.playerId}"] [data-hand-card][data-card-id="${fixture.cardId}"]`);
  const destinations = String(await card.getAttribute("data-play-destinations")).split(/\s+/u).filter(Boolean);
  expect(destinations).toContain("base");
  await expect(card).toHaveAttribute("draggable", "true");

  let legalBase = page.locator(`.table-seat[data-player-id="${fixture.playerId}"] [data-zone="base"] [data-play-destination="base"]`);
  let forgedBase = page.locator(`.table-seat[data-player-id="${fixture.opponentId}"] [data-zone="base"] .base-row`);
  await forgedBase.evaluate((node) => node.setAttribute("data-play-destination", "forged-opponent-base"));
  await card.dispatchEvent("dragstart");
  await expect(page.locator("#app")).toHaveClass(/is-dragging-card/u);
  await expect(card).toHaveClass(/drag-source-active/u);
  await expect(legalBase).toHaveClass(/is-legal-drop/u);
  await expect(forgedBase).not.toHaveClass(/is-legal-drop/u);
  await forgedBase.dispatchEvent("dragover");
  await expect(forgedBase).not.toHaveClass(/drag-over|drop-target-active/u);
  await forgedBase.dispatchEvent("drop");

  const rejected = await page.evaluate(({ playerId, cardId }) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    return {
      inHand: player.hand.some((candidate) => candidate.instanceId === cardId),
      pendingCardId: game.pendingPayment?.cardId || ""
    };
  }, { playerId: fixture.playerId, cardId: fixture.cardId });
  expect(rejected).toEqual({ inHand: true, pendingCardId: "" });
  await expect(page.locator("#app")).not.toHaveClass(/is-dragging-card/u);

  card = page.locator(`[data-zone="hand"][data-player-id="${fixture.playerId}"] [data-hand-card][data-card-id="${fixture.cardId}"]`);
  legalBase = page.locator(`.table-seat[data-player-id="${fixture.playerId}"] [data-zone="base"] [data-play-destination="base"]`);
  await card.dispatchEvent("dragstart");
  await legalBase.dispatchEvent("dragover");
  await expect(legalBase).toHaveClass(/drag-over/u);
  await expect(legalBase).toHaveClass(/drop-target-active/u);
  await legalBase.dispatchEvent("drop");

  const accepted = await page.evaluate(({ playerId, cardId }) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    return {
      inHand: player.hand.some((candidate) => candidate.instanceId === cardId),
      pendingCardId: game.pendingPayment?.cardId || "",
      destination: game.pendingPayment?.destination || "",
      chainHasCard: Boolean(game.actionChain?.chain?.some((item) => item.card?.instanceId === cardId))
    };
  }, { playerId: fixture.playerId, cardId: fixture.cardId });
  expect(accepted.inHand).toBe(false);
  expect(accepted.pendingCardId).toBe(fixture.cardId);
  expect(accepted.destination).toBe("base");
  expect(accepted.chainHasCard).toBe(true);
  await expect(page.locator("#app")).not.toHaveClass(/is-dragging-card/u);
  await assertRuntimeHealthy(page, runtimeFailures);
});
