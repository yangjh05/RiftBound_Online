import { expect, test } from "@playwright/test";

const TABLE_ZONES = [
  "hand",
  "main-deck",
  "rune-deck",
  "trash",
  "banished",
  "base",
  "legend",
  "champion",
  "runes"
];

const REQUIRED_GAME_ACTIONS = [
  "toggle-log",
  "surrender",
  "new-game",
  "toggle-graveyard",
  "toggle-banished"
];

const INVALID_RENDER_VALUE = /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function captureRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const source = message.location().url;
      failures.push(`console.error${source ? ` (${source})` : ""}: ${message.text()}`);
    }
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

async function installRichBoardFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const cloneCard = (source, instanceId, ownerId, overrides = {}) => ({
      ...structuredClone(source || {}),
      id: source?.id || instanceId,
      cardNumber: source?.cardNumber || `E2E-${instanceId}`,
      instanceId,
      ownerId,
      controllerId: ownerId,
      name: source?.name || instanceId,
      translations: source?.translations || { ko: { name: instanceId, text: "회귀 테스트 카드" } },
      ...overrides
    });
    const cardsFor = (player) => [
      ...player.hand,
      ...player.mainDeck,
      ...player.base,
      ...player.trash,
      ...(player.banished || [])
    ];
    const unitSource = (player) => cardsFor(player).find((card) => card?.type === "unit") || cardsFor(player)[0];
    const gearSource = (player) => cardsFor(player).find((card) => card?.type === "gear") || cardsFor(player)[0];
    const runeSource = (player) => player.runes[0] || player.runeDeck[0];
    const fixture = { players: [], battlefieldCount: game.battlefields.length };

    game.phase = "action";
    game.currentPlayerId = game.players[0].id;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.triggerQueue = [];
    game.selectedCardId = null;

    for (const [index, player] of game.players.entries()) {
      const gear = cloneCard(gearSource(player), `e2e-gear-${index}`, player.id, {
        type: "gear",
        name: `Regression Gear ${index + 1}`,
        might: 2 + index,
        empoweredCount: 1,
        maxEmpowerCount: 2,
        exhausted: index === 1,
        damage: 0,
        attachments: []
      });
      const unit = cloneCard(unitSource(player), `e2e-unit-${index}`, player.id, {
        type: "unit",
        name: `Regression Unit ${index + 1}`,
        might: 5,
        damage: index + 1,
        buffs: 2,
        mightModifier: 2,
        temporaryMight: 1,
        temporaryKeywords: ["Shield"],
        temporaryKeywordAmounts: { shield: 2 },
        cantMoveThisTurn: true,
        exhausted: index === 0,
        stunned: true,
        attachments: [gear]
      });
      player.base = [unit];

      const firstRune = cloneCard(runeSource(player), `e2e-rune-${index}-ready`, player.id, {
        type: "rune",
        domain: runeSource(player)?.domain || "Body",
        exhausted: false
      });
      const secondRune = cloneCard(runeSource(player), `e2e-rune-${index}-spent`, player.id, {
        type: "rune",
        domain: runeSource(player)?.domain || "Body",
        exhausted: true
      });
      player.runes = [firstRune, secondRune];

      const trashCard = cloneCard(cardsFor(player)[0], `e2e-trash-${index}`, player.id, {
        name: `Regression Trash ${index + 1}`
      });
      const banishedCard = cloneCard(cardsFor(player)[1] || cardsFor(player)[0], `e2e-banished-${index}`, player.id, {
        name: `Regression Banished ${index + 1}`
      });
      player.trash = [trashCard];
      player.banished = [banishedCard];
      player.runePool = {
        energy: [
          { id: `e2e-energy-${index}`, domains: ["Any"], sourceName: "Regression Energy" },
          { id: `e2e-showdown-energy-${index}`, domains: ["Any"], sourceName: "Regression Showdown Energy", restriction: "showdown" }
        ],
        power: [
          { id: `e2e-power-${index}`, domain: "Body", sourceName: "Regression Power" },
          { id: `e2e-showdown-power-${index}`, domain: "Body", sourceName: "Regression Showdown Power", restriction: "showdown" }
        ]
      };
      player.burnOuts = index + 1;
      player.xp = index + 2;
      if (player.champion) {
        player.champion.zone = "champion";
        player.championPlayed = false;
      }

      fixture.players.push({
        id: player.id,
        hand: player.hand.length,
        mainDeck: player.mainDeck.length,
        runeDeck: player.runeDeck.length,
        trash: player.trash.length,
        banished: player.banished.length,
        base: player.base.length,
        legend: player.legend ? 1 : 0,
        champion: player.champion ? 1 : 0,
        runes: player.runes.length,
        xp: player.xp,
        burnOuts: player.burnOuts,
        unitId: unit.instanceId,
        unitDamage: unit.damage,
        unitExhausted: unit.exhausted,
        unitStunned: unit.stunned,
        gearId: gear.instanceId,
        gearMight: gear.might,
        gearExhausted: gear.exhausted,
        readyRuneId: firstRune.instanceId,
        spentRuneId: secondRune.instanceId,
        handNames: player.hand.map((card) => card.name)
      });
    }

    const battlefield = game.battlefields[0];
    battlefield.units = game.players.map((player, index) => cloneCard(unitSource(player), `e2e-field-unit-${index}`, player.id, {
      type: "unit",
      name: `Regression Field Unit ${index + 1}`,
      might: 4,
      damage: index,
      exhausted: index === 1,
      attachments: []
    }));
    battlefield.hidden ||= [];

    window.__riftboundRender();
    return fixture;
  });
}

async function assertNoRuntimeOrUndefinedErrors(page, failures) {
  await expect(page.locator(".ui-exception-banner")).toHaveCount(0);
  const invalidRender = await page.locator("body").evaluate((body) => {
    const invalid = /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu;
    const invalidAttribute = [...body.querySelectorAll(".tabletop-layout, .tabletop-layout *")]
      .flatMap((element) => [...element.attributes])
      .find((attribute) => invalid.test(attribute.value));
    return {
      text: invalid.exec(body.innerText)?.[0] || "",
      attribute: invalidAttribute ? `${invalidAttribute.name}=${invalidAttribute.value}` : ""
    };
  });
  expect(invalidRender.text).toBe("");
  expect(invalidRender.attribute).toBe("");
  expect(failures).toEqual([]);
}

async function installPaymentFocusFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.mainDeck[0];
    const readyRune = player.runes.find((rune) => !rune.exhausted) || player.runes[0];
    player.runePool = { energy: [], power: [] };
    readyRune.exhausted = false;
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.showdown = null;
    game.actionChain = null;
    game.pendingChoice = null;
    game.pendingPayment = {
      id: "e2e-focus-payment",
      playerId: player.id,
      cardId: card.instanceId,
      cardName: card.name,
      source: "playCard",
      destination: "base",
      energyCost: 1,
      basePowerCost: [],
      powerCost: [],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      xpCost: 0,
      optionalPowerEffects: []
    };
    window.__riftboundRender();
    return { playerId: player.id, cardId: card.instanceId, runeId: readyRune.instanceId };
  });
}

async function installShowdownFixture(page) {
  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const [attacker, defender] = game.players;
    const battlefield = game.battlefields[0];
    game.phase = "showdown";
    game.currentPlayerId = attacker.id;
    game.actionChain = null;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.showdown = {
      battlefieldId: battlefield.instanceId,
      turnPlayerId: attacker.id,
      attackerId: attacker.id,
      defenderId: defender.id,
      focusPlayerId: attacker.id,
      priorityPlayerId: attacker.id,
      consecutivePasses: 0,
      chainSequence: 1,
      chainOpenedBy: "e2e-regression",
      combat: true,
      chain: []
    };
    window.__riftboundRender();
  });
}

async function expectMalformedStateToFailClosed(page, scenario) {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await page.evaluate((name) => {
    const game = window.__riftboundGame;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    const validPayment = (player, card, overrides = {}) => ({
      id: "e2e-valid-payment-shape",
      playerId: player.id,
      cardId: card.instanceId,
      cardName: card.name,
      source: "playCard",
      destination: "base",
      energyCost: 0,
      basePowerCost: [],
      powerCost: [],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      optionalPowerEffects: [],
      ...overrides
    });
    const validChoice = (player, card, overrides = {}) => ({
      id: "e2e-valid-choice-shape",
      playerId: player.id,
      card,
      effect: "tabletopRegressionChoice",
      options: [{ id: "continue", label: "Continue" }],
      optional: false,
      data: {},
      ...overrides
    });

    if (name === "champion-select-player") {
      game.phase = "champion-select";
      game.championSelectPlayerId = "missing-player";
    }
    if (name === "champion-select-legend") {
      game.phase = "champion-select";
      game.championSelectPlayerId = game.players[0].id;
      game.players[0].legend = null;
    }
    if (name === "battlefield-select-player") {
      game.phase = "battlefield-select";
      game.setupPlayerId = "missing-player";
    }
    if (name === "battlefield-select-champion") {
      game.phase = "battlefield-select";
      game.setupPlayerId = game.players[0].id;
      game.players[0].champion = null;
    }
    if (name === "mulligan-player") {
      game.phase = "mulligan";
      game.mulligan = { playerId: "missing-player", selectedCardIds: [] };
    }
    if (name === "action-current-player") {
      game.phase = "action";
      game.currentPlayerId = "missing-player";
    }
    if (name === "extra-player-seat") {
      game.phase = "action";
      game.players.push(structuredClone(game.players[0]));
      game.players[2].id = "p3";
    }
    if (name === "duplicate-player-seat") {
      game.phase = "action";
      game.players[1].id = game.players[0].id;
    }
    if (name === "null-hidden-zone") {
      game.phase = "action";
      game.battlefields[0].hidden = null;
    }
    if (name === "invalid-unit-controller") {
      game.phase = "action";
      const card = structuredClone(game.players[0].hand[0] || game.players[0].base[0]);
      card.instanceId = "e2e-invalid-controller-unit";
      card.controllerId = "missing-player";
      game.battlefields[0].units.push(card);
    }
    if (name === "invalid-hidden-controller") {
      game.phase = "action";
      const card = structuredClone(game.players[0].hand[0] || game.players[0].base[0]);
      card.instanceId = "e2e-invalid-controller-hidden";
      card.controllerId = null;
      card.ownerId = null;
      game.battlefields[0].hidden.push({ card, hiddenByPlayerId: "missing-player" });
    }
    if (name === "invalid-revealed-intel") {
      game.phase = "action";
      game.revealedIntel = {};
    }
    if (name === "invalid-revealed-intel-entry") {
      game.phase = "action";
      game.revealedIntel = [null];
    }
    if (name === "invalid-score-events") {
      game.phase = "action";
      game.scoreEvents = {};
    }
    if (name === "invalid-effect-flash-targets") {
      game.phase = "action";
      game.effectFlash = { sourceId: "e2e-invalid-source", targetIds: {}, stamp: 1 };
    }
    if (name === "invalid-effect-flash-source") {
      game.phase = "action";
      game.effectFlash = { sourceId: {}, targetIds: [], stamp: 1 };
    }
    if (name === "invalid-effect-flash-message") {
      game.phase = "action";
      game.effectFlash = { sourceId: "e2e-invalid-source", targetIds: [], message: {}, stamp: 1 };
    }
    if (name === "invalid-effect-flash-stamp") {
      game.phase = "action";
      game.effectFlash = { sourceId: "e2e-invalid-source", targetIds: [], stamp: {} };
    }
    if (name === "invalid-turn-order") {
      game.phase = "action";
      game.turnOrder = {};
    }
    if (name === "invalid-ai-declined-intents") {
      game.phase = "action";
      game.aiDeclinedIntents = { turnSequence: game.turnSequence, keys: {} };
    }
    if (name === "invalid-first-player-roller") {
      game.phase = "first-player";
      game.firstPlayerId = null;
      game.firstPlayerDecision = {
        method: "roll",
        status: "rolling",
        round: 1,
        rollerId: "missing-player",
        rolls: { p1: null, p2: null },
        previousRolls: null,
        winnerId: null,
        chooserId: null
      };
    }
    if (name === "invalid-battlefield-effects") {
      game.phase = "action";
      game.battlefields[0].effects = {};
    }
    if (name === "invalid-staged-events") {
      game.phase = "action";
      game.stagedEvents = {};
    }
    if (name === "invalid-event-collection") {
      game.phase = "action";
      game.exhaustEvents = {};
    }
    if (name === "invalid-process-collection") {
      game.phase = "action";
      game.damageKillFollowups = { length: 1 };
    }
    if (name === "invalid-cleanup-trigger-batches") {
      game.phase = "action";
      game.cleanupPendingTriggerBatches = { length: 1 };
    }
    if (name === "invalid-trigger-queue-continuation") {
      game.phase = "action";
      game.triggerQueueContinuation = { kind: "triggerContinuationSequence", continuations: {} };
    }
    if (name === "invalid-deferred-trigger-continuations") {
      game.phase = "action";
      game.deferredTriggerContinuations = {};
    }
    if (name === "invalid-card-instance-id") {
      game.phase = "action";
      game.players[0].hand[0].instanceId = {};
    }
    if (name === "invalid-card-text") {
      game.phase = "action";
      const card = game.players[0].hand[0] || game.players[0].legend;
      card.text = { invalid: true };
      delete card.translations;
      game.selectedCardId = card.instanceId;
    }
    if (name === "invalid-card-translation-text") {
      game.phase = "action";
      const card = game.players[0].hand[0] || game.players[0].legend;
      card.translations = { ko: { name: card.name, text: { invalid: true } } };
      game.selectedCardId = card.instanceId;
    }
    if (name === "duplicate-authoritative-card-id") {
      game.phase = "action";
      game.players[1].hand[0].instanceId = game.players[0].hand[0].instanceId;
    }
    if (name === "invalid-effect-ability-keywords") {
      game.phase = "action";
      game.players[0].hand[0].effects = [{ timing: "activated", kind: "addEnergy", abilityKeywords: {} }];
    }
    if (name === "invalid-effect-keywords") {
      game.phase = "action";
      game.players[0].hand[0].effects = [{ timing: "levelStatic", kind: "gainKeywords", level: 0, keywords: {} }];
    }
    if (name === "invalid-effect-selector-lists") {
      game.phase = "action";
      game.players[0].hand[0].effects = [{ timing: "static", kind: "friendlyMatchingUnitsMight", amount: 1, names: { length: 1 } }];
    }
    if (name === "invalid-card-additional-cost-tags") {
      game.phase = "action";
      game.players[0].hand[0].additionalCost = { kind: "killFriendlyTaggedUnit", tags: {} };
    }
    if (name === "invalid-effect-cost-options") {
      game.phase = "action";
      game.players[0].hand[0].effects = [{
        timing: "activated",
        kind: "empowerSelf",
        costOptions: [{ energy: 0, power: {} }]
      }];
    }
    if (name === "invalid-trigger-kind") {
      game.phase = "action";
      game.triggerQueue = [{ id: "e2e-invalid-trigger", playerId: game.players[0].id, kind: {}, data: {} }];
    }
    if (name === "invalid-trigger-specs") {
      game.phase = "action";
      game.triggerQueue = [{ id: "e2e-invalid-trigger-specs", playerId: game.players[0].id, kind: "effectSpecs", data: { specs: {} } }];
    }
    if (name === "invalid-trigger-order-kind") {
      const player = game.players[0];
      const trigger = { id: "e2e-order-trigger", playerId: player.id, kind: {}, sourceCardId: player.legend.instanceId, data: {} };
      game.phase = "action";
      game.pendingChoice = {
        id: "e2e-invalid-trigger-order",
        playerId: player.id,
        card: player.legend,
        effect: "triggerOrder",
        options: [{ id: "trigger:e2e-order-trigger", label: "Trigger" }],
        data: { triggerOrderState: { groupIndex: 0, groups: [{ playerId: player.id, triggers: [trigger], orderedTriggers: [] }] } }
      };
    }
    if (name === "invalid-log-entry") {
      game.phase = "action";
      game.log = [{}];
    }
    if (name === "missing-choice-data") {
      game.phase = "action";
      game.pendingChoice = {
        id: "e2e-missing-choice-data",
        playerId: game.players[0].id,
        card: game.battlefields[0],
        effect: "combatDamage",
        options: [{ id: "continue", label: "Continue" }],
        data: null
      };
    }
    if (name === "missing-choice-player") {
      game.phase = "action";
      game.pendingChoice = {
        id: "e2e-missing-choice-player",
        card: game.players[0].legend,
        effect: "genericChoice",
        options: [{ id: "continue", label: "Continue" }],
        data: {}
      };
    }
    if (name === "missing-choice-card") {
      const player = game.players[0];
      game.phase = "action";
      game.pendingChoice = { id: "e2e-missing-choice-card", playerId: player.id, card: null, effect: "genericChoice", options: [{ id: "continue", label: "Continue" }], data: {} };
    }
    if (name === "duplicate-choice-option") {
      const player = game.players[0];
      game.phase = "action";
      game.pendingChoice = { id: "e2e-duplicate-choice", playerId: player.id, card: player.legend, effect: "genericChoice", options: [{ id: "same", label: "One" }, { id: "same", label: "Two" }], data: {} };
    }
    if (name === "invalid-choice-card-ids") {
      const player = game.players[0];
      game.phase = "action";
      game.pendingChoice = { id: "e2e-invalid-choice-card-ids", playerId: player.id, card: player.legend, effect: "genericChoice", options: [{ id: "continue", label: "Continue", cardIds: {} }], data: {} };
    }
    if (name === "required-choice-no-options") {
      const player = game.players[0];
      game.phase = "action";
      game.pendingChoice = { id: "e2e-empty-choice", playerId: player.id, card: player.legend, effect: "genericChoice", options: [], optional: false, data: {} };
    }
    if (name === "falsey-choice-state") {
      game.phase = "action";
      game.pendingChoice = false;
    }
    if (name === "missing-pay-deflect-data") {
      const player = game.players[0];
      game.phase = "action";
      game.pendingChoice = { id: "e2e-deflect", playerId: player.id, card: player.legend, effect: "payDeflect", options: [{ id: "e2e-power-source", label: "Rune", cardId: "e2e-power-source" }], data: null };
    }
    if (name === "incomplete-combat-damage") {
      const player = game.players[0];
      game.phase = "action";
      game.pendingChoice = { id: "e2e-combat", playerId: player.id, card: game.battlefields[0], effect: "combatDamage", options: [{ id: "continue", label: "Continue" }], data: { targetInfos: [] } };
    }
    if (name === "invalid-choice-effect-sequence") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingChoice = validChoice(player, card, {
        effectSequenceContinuation: { playerId: player.id, card, specs: null, finishSpell: false }
      });
    }
    if (name === "invalid-choice-game-effect-resolution") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingChoice = validChoice(player, card, {
        gameEffectResolution: {
          context: { chainKind: null, finalized: false, pendingTriggerBatches: {} }
        }
      });
    }
    if (name === "invalid-divine-judgment-keep-data") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingChoice = validChoice(player, card, {
        effect: "divineJudgmentKeep",
        options: [{ id: "keep", label: "Keep", cardId: card.instanceId, card }],
        data: {
          playerIds: game.players.map((candidate) => candidate.id),
          playerIndex: 0,
          categoryIndex: 3,
          selectedIds: [],
          kept: null,
          finishSpell: false,
          fromShowdownChain: false
        }
      });
    }
    if (name === "invalid-divine-judgment-rune-order-data") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      const rune = player.runes[0] || player.runeDeck[0] || card;
      game.phase = "action";
      game.pendingChoice = validChoice(player, card, {
        effect: "divineJudgmentRuneOrder",
        options: [{ id: rune.instanceId, label: rune.name, cardId: rune.instanceId, card: rune }],
        data: {
          playerIds: game.players.map((candidate) => candidate.id),
          playerIndex: game.players.length,
          categoryIndex: 0,
          selectedIds: [],
          kept: {},
          finishSpell: false,
          fromShowdownChain: false,
          runeOrderPlayerIndex: 0,
          runeRecycleOrder: [],
          selectedRuneOrderIds: []
        }
      });
    }
    if (name === "invalid-rune-pool-energy-entry") {
      game.phase = "action";
      game.players[0].runePool = { energy: [null], power: [] };
    }
    if (name === "oversized-rune-pool-energy") {
      game.phase = "action";
      game.players[0].runePool = { energy: 4294967296, power: [] };
    }
    if (name === "invalid-rune-pool-power-entry") {
      game.phase = "action";
      game.players[0].runePool = { energy: [], power: [{ id: {}, domain: "Fury" }] };
    }
    if (name === "invalid-chain-target-ids") {
      const player = game.players[0];
      const card = structuredClone(player.hand[0] || player.mainDeck[0]);
      card.instanceId = "e2e-invalid-chain-target-card";
      game.phase = "action";
      game.actionChain = {
        turnPlayerId: player.id,
        priorityPlayerId: player.id,
        playerIds: game.players.map((candidate) => candidate.id),
        consecutivePasses: 0,
        chainSequence: 1,
        chain: [{ id: "e2e-invalid-chain-target-item", itemType: "card", playerId: player.id, card, destination: "base", targetIds: {}, status: "finalized" }]
      };
    }
    if (name === "invalid-chain-status") {
      const player = game.players[0];
      const card = structuredClone(player.hand[0]);
      card.instanceId = "e2e-invalid-chain-status-card";
      game.phase = "action";
      game.actionChain = { turnPlayerId: player.id, priorityPlayerId: player.id, playerIds: game.players.map((candidate) => candidate.id), consecutivePasses: 0, chainSequence: 1, chain: [{ id: "e2e-invalid-chain-status", itemType: "card", playerId: player.id, card, destination: "base", status: "bogus" }] };
    }
    if (name === "missing-chain-trigger") {
      const player = game.players[0];
      const card = structuredClone(player.legend);
      card.instanceId = "e2e-missing-chain-trigger-card";
      game.phase = "action";
      game.actionChain = { turnPlayerId: player.id, priorityPlayerId: player.id, playerIds: game.players.map((candidate) => candidate.id), consecutivePasses: 0, chainSequence: 1, chain: [{ id: "e2e-missing-chain-trigger", itemType: "trigger", playerId: player.id, card, status: "finalized", trigger: null }] };
    }
    if (name === "invalid-chain-record-target") {
      game.phase = "action";
      game.players[0].hand[0].declaredPlayTargets = [{ effect: "damageUnit", targetId: {} }];
    }
    if (name === "invalid-rule-trace") {
      game.phase = "action";
      game.ruleTaskTrace = {};
    }
    if (name === "missing-champion-pool") {
      game.phase = "action";
      game.players[0].availableChampions = undefined;
    }
    if (name === "missing-battlefield-pool") {
      game.phase = "action";
      game.players[0].availableBattlefields = undefined;
    }
    if (name === "card-power-entry") {
      game.phase = "action";
      game.players[0].hand[0].power = [null];
    }
    if (name === "payment-player") {
      const card = game.players[0].hand[0] || game.players[0].mainDeck[0];
      game.phase = "action";
      game.pendingPayment = {
        id: "e2e-invalid-payment",
        playerId: "missing-player",
        cardId: card.instanceId,
        cardName: card.name,
        source: "playCard",
        destination: "base",
        energyCost: 1,
        basePowerCost: [],
        powerCost: [],
        declaredTargets: [],
        declaredChoices: [],
        deflectTargetIds: [],
        energyRuneIds: [],
        poolEnergyIds: [],
        powerRuneIds: [],
        poolPowerIds: [],
        optionalPowerEffects: []
      };
    }
    if (name === "payment-power-cost") {
      const player = game.players[0];
      const card = player.hand[0] || player.mainDeck[0];
      game.phase = "action";
      game.pendingPayment = {
        id: "e2e-invalid-payment-cost",
        playerId: player.id,
        cardId: card.instanceId,
        cardName: card.name,
        source: "playCard",
        destination: "base",
        energyCost: 1,
        basePowerCost: [],
        powerCost: {},
        declaredTargets: [],
        declaredChoices: [],
        deflectTargetIds: [],
        energyRuneIds: [],
        poolEnergyIds: [],
        powerRuneIds: [],
        poolPowerIds: [],
        optionalPowerEffects: []
      };
    }
    if (name === "payment-power-entry") {
      const player = game.players[0];
      const card = player.hand[0] || player.mainDeck[0];
      game.phase = "action";
      game.pendingPayment = {
        id: "e2e-invalid-payment-entry",
        playerId: player.id,
        cardId: card.instanceId,
        cardName: card.name,
        source: "playCard",
        destination: "base",
        energyCost: 1,
        basePowerCost: [],
        powerCost: [null],
        declaredTargets: [],
        declaredChoices: [],
        deflectTargetIds: [],
        energyRuneIds: [],
        poolEnergyIds: [],
        powerRuneIds: [],
        poolPowerIds: [],
        optionalPowerEffects: []
      };
    }
    if (name === "payment-rune-pool-power") {
      const player = game.players[0];
      const card = player.hand[0] || player.mainDeck[0];
      game.phase = "action";
      player.runePool = { energy: [], power: {} };
      game.pendingPayment = {
        id: "e2e-invalid-rune-pool",
        playerId: player.id,
        cardId: card.instanceId,
        cardName: card.name,
        source: "playCard",
        destination: "base",
        energyCost: 1,
        basePowerCost: [],
        powerCost: [],
        declaredTargets: [],
        declaredChoices: [],
        deflectTargetIds: [],
        energyRuneIds: [],
        poolEnergyIds: [],
        powerRuneIds: [],
        poolPowerIds: [],
        optionalPowerEffects: []
      };
    }
    if (name === "missing-payment-power-runes") {
      const player = game.players[0];
      const card = player.hand[0];
      game.phase = "action";
      game.pendingPayment = validPayment(player, card);
      delete game.pendingPayment.powerRuneIds;
    }
    if (name === "invalid-triggered-payment-triggers") {
      const player = game.players[0];
      const card = player.hand[0];
      const trigger = { id: "e2e-payment-trigger", playerId: player.id, kind: "effectSpecs", sourceCardId: card.instanceId, data: {} };
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, {
        source: "triggeredAbility",
        triggeredAbility: { sourceCard: card, trigger, triggers: {}, descriptor: { kind: "power" }, mode: "queue", continuation: null }
      });
    }
    if (name === "invalid-replacement-power-cost") {
      const player = game.players[0];
      const card = player.hand[0];
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, { costContext: { additionalPower: [], replacementPowerCost: {} } });
    }
    if (name === "missing-effect-payment") {
      const player = game.players[0];
      const card = player.hand[0];
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, { source: "effectEnergy", effectPayment: null });
    }
    if (name === "invalid-repeat-spell-spec") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, {
        source: "effectEnergy",
        effectPayment: {
          kind: "repeatSpell",
          sourcePlayerId: player.id,
          sourceCard: card,
          repeatSpec: null,
          finishSpell: false,
          fromShowdownChain: false
        }
      });
    }
    if (name === "invalid-repeat-spell-source-player") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, {
        source: "effectEnergy",
        effectPayment: {
          kind: "repeatSpell",
          sourcePlayerId: "missing-player",
          sourceCard: card,
          repeatSpec: { timing: "spell", kind: "draw", amount: 1 },
          finishSpell: false,
          fromShowdownChain: false
        }
      });
    }
    if (name === "invalid-payment-effect-sequence") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, {
        effectSequenceContinuation: { playerId: player.id, card, specs: null, finishSpell: false }
      });
    }
    if (name === "invalid-payment-game-effect-resolution") {
      const player = game.players[0];
      const card = player.hand[0] || player.legend;
      game.phase = "action";
      game.pendingPayment = validPayment(player, card, {
        gameEffectResolution: {
          context: { chainKind: null, finalized: false, pendingTriggerBatches: {} }
        }
      });
    }
    if (name === "choice-and-payment") {
      game.phase = "action";
      game.pendingChoice = {};
      game.pendingPayment = {};
    }
    window.__riftboundRender();
  }, scenario);

  await expect(page.locator(".tabletop-state-unavailable"), `${scenario} must render the fail-closed state`).toBeVisible({ timeout: 2_000 });
  await expect(page.locator(".tabletop-board"), `${scenario} must not render an interactive board`).toHaveCount(0);
  await expect(page.locator(".ui-exception-banner"), `${scenario} must not escape through the exception banner`).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(INVALID_RENDER_VALUE);
  expect(runtimeFailures, `${scenario} emitted a runtime failure`).toEqual([]);
}

async function installReplayRoute(page, replay) {
  const summary = {
    id: replay.id,
    createdAt: replay.createdAt,
    completedAt: replay.completedAt,
    generation: 1,
    models: [
      { playerId: "p1", generation: 1, role: "AI" },
      { playerId: "p2", generation: 1, role: "AI" }
    ],
    decks: [
      { playerId: "p1", id: "e2e-deck-p1", name: "E2E P1" },
      { playerId: "p2", id: "e2e-deck-p2", name: "E2E P2" }
    ],
    winnerId: "p1",
    scores: [8, 4],
    turns: 3,
    actionCount: 1
  };
  await page.route(/\/api\/ai\/selfplay-replays(?:\/[^/?#]+)?(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const payload = url.pathname.endsWith(`/${replay.id}`)
      ? { replay }
      : { replays: [summary] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(payload)
    });
  });
}

async function openReadOnlyReplay(page) {
  await openReadyBoard(page);
  await installRichBoardFixture(page);
  const replay = await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const source = player.hand[0] || player.mainDeck[0];
    const chainCard = {
      ...structuredClone(source),
      instanceId: "e2e-replay-chain-card",
      ownerId: player.id,
      controllerId: player.id,
      name: "Replay Chain Regression Card"
    };
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.selectedCardId = null;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.showdown = null;
    game.triggerQueue = [];
    game.actionChain = {
      playerId: player.id,
      turnPlayerId: player.id,
      priorityPlayerId: player.id,
      playerIds: game.players.map((candidate) => candidate.id),
      consecutivePasses: 0,
      chainSequence: 1,
      chainOpenedBy: "e2e-replay",
      chain: [{
        id: "e2e-replay-chain-item",
        itemType: "card",
        playerId: player.id,
        card: chainCard,
        destination: "base",
        status: "finalized"
      }]
    };
    return {
      id: "e2e-tabletop-read-only-replay",
      createdAt: "2026-08-30T00:00:00.000Z",
      completedAt: "2026-08-30T00:01:00.000Z",
      frames: [{
        sequence: 0,
        actorId: null,
        action: null,
        turnNumber: game.turnNumber || 1,
        phase: game.phase,
        game: JSON.parse(JSON.stringify(game))
      }]
    };
  });

  await installReplayRoute(page, replay);
  await page.reload();
  await expect(page.locator('[data-action="menu-replays"]')).toBeVisible();
  await page.locator('[data-action="menu-replays"]').click();
  await expect(page.locator(`[data-action="replay-open"][data-replay-id="${replay.id}"]`)).toBeVisible();
  await page.locator(`[data-action="replay-open"][data-replay-id="${replay.id}"]`).click();
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator(".replay-playback-controls")).toBeVisible();
  return replay;
}

async function assertPersistentTable(page, fixture) {
  const table = page.locator(".tabletop-board");
  await expect(table).toBeVisible();
  await expect(page.locator(".score-track")).toBeVisible();
  await expect(page.locator(".score-track .score-cell")).toHaveCount(15);
  await expect(page.locator(".context-action-dock .action-context")).toBeVisible();
  await expect(table.locator('.table-seat[data-side="top"]')).toHaveCount(1);
  await expect(table.locator('.table-seat[data-side="bottom"]')).toHaveCount(1);
  await expect(table.locator('[data-zone="battlefields"]')).toHaveAttribute("data-count", String(fixture.battlefieldCount));
  await expect(table.locator(".battlefield-head h2")).toHaveCount(fixture.battlefieldCount);
  await expect(table.locator(".battlefield-head span")).toHaveCount(fixture.battlefieldCount);
  await expect(page.locator(".table-action-rail")).toBeVisible();

  for (const player of fixture.players) {
    const seat = table.locator(`.table-seat[data-player-id="${player.id}"]`);
    await expect(seat).toHaveCount(1);
    for (const zone of TABLE_ZONES) {
      const node = zone === "hand"
        ? table.locator(`[data-zone="hand"][data-player-id="${player.id}"]`)
        : seat.locator(`[data-zone="${zone}"]`);
      await expect(node, `${player.id} is missing ${zone}`).toHaveCount(1);
      const fixtureKey = zone.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      await expect(node, `${player.id} ${zone} count is stale`).toHaveAttribute("data-count", String(player[fixtureKey]));
    }

    await expect(table.locator(`[data-zone="hand"][data-player-id="${player.id}"] [data-hand-card]`)).toHaveCount(player.hand);
    await expect(seat.locator('[data-zone="runes"] [data-rune-card]')).toHaveCount(player.runes);
    await expect(seat.locator(".xp-stat")).toContainText(String(player.xp));
    await expect(seat.locator(".burnout-stat")).toContainText(String(player.burnOuts));
    await expect(seat.locator(".champion-control")).toHaveCount(player.champion ? 1 : 0);
    await expect(seat.locator(".pile-main-deck .pile-label")).toBeVisible();
    await expect(seat.locator(".pile-trash .pile-label")).toBeVisible();
    await expect(seat.locator(".pile-banished .pile-label")).toBeVisible();
    const unit = seat.locator(`[data-card-id="${player.unitId}"]`);
    await expect(unit).toHaveClass(/physical-board-card/u);
    await expect(unit).toHaveAttribute("data-current-might", /^-?\d+$/u);
    await expect(unit).toHaveAttribute("data-remaining-health", /^\d+$/u);
    await expect(unit).toHaveAttribute("data-damage", String(player.unitDamage));
    await expect(unit).toHaveAttribute("data-exhausted", String(player.unitExhausted));
    await expect(unit).toHaveAttribute("data-stunned", String(player.unitStunned));
    await expect(unit).toHaveAttribute("aria-label", player.unitExhausted ? /탈진|Exhausted/iu : /준비|Ready/iu);
    await expect(unit).toHaveAttribute("title", player.unitExhausted ? /탈진|Exhausted/iu : /준비|Ready/iu);
    const face = unit.locator(".card-face-layer");
    const overlay = face.locator(":scope > .unit-board-overlay");
    await expect(overlay).toHaveCount(1);
    await expect(overlay.locator(":scope > .unit-current-might")).toHaveText(String(await unit.getAttribute("data-current-might")));
    await expect(overlay.locator(":scope > .unit-remaining-health")).toHaveText(String(await unit.getAttribute("data-remaining-health")));
    await expect(face).not.toContainText(/준비|탈진|Ready|Exhausted/iu);
    const secondaryStatuses = overlay.locator(":scope > .unit-state-badges");
    await expect(secondaryStatuses).toHaveCount(1);
    await expect(secondaryStatuses).toHaveAttribute("aria-label", /기절|Stunned/iu);
    await expect(unit.locator(".primary-card-state, .card-state-hud.unit-stats")).toHaveCount(0);
    await expect(seat.locator(`[data-card-id="${player.gearId}"]`)).toHaveCount(1);
    const gear = seat.locator(`.attached-gear[data-card-id="${player.gearId}"]`);
    await expect(gear).toHaveAttribute("data-current-might", String(player.gearMight));
    await expect(gear).toHaveAttribute("data-exhausted", String(player.gearExhausted));
    await expect(gear).toHaveAttribute("title", player.gearExhausted ? /탈진|Exhausted/iu : /준비|Ready/iu);
    await expect(gear.locator(".attachment-orientation-layer")).toHaveCount(1);
    await expect(gear.locator(".attached-gear-board-overlay .attached-gear-might")).toContainText(String(player.gearMight));
    await expect(gear.locator(".attached-gear-board-overlay .unit-state-badges")).toHaveCount(1);
    await expect(gear.locator(".attached-gear-readiness, .attached-gear-state")).toHaveCount(0);
    await expect(gear).not.toContainText(/준비|탈진|Ready|Exhausted/iu);
    await expect(seat.locator(`[data-rune-card][data-card="${player.readyRuneId}"]`)).not.toHaveClass(/exhausted|spent/u);
    await expect(seat.locator(`[data-rune-card][data-card="${player.spentRuneId}"]`)).toHaveClass(/exhausted|spent/u);
  }

  const topSeat = table.locator('.table-seat[data-side="top"]');
  const topPlayerId = await topSeat.getAttribute("data-player-id");
  const topFixture = fixture.players.find((player) => player.id === topPlayerId);
  const topHand = table.locator(`[data-zone="hand"][data-player-id="${topPlayerId}"]`);
  await expect(topHand.locator("[data-hand-card]")).toHaveCount(topFixture.hand);
  for (const privateName of topFixture.handNames) {
    await expect(topHand).not.toContainText(privateName);
  }

  for (const action of REQUIRED_GAME_ACTIONS) {
    await expect(page.locator(`[data-action="${action}"]`).first(), `missing action: ${action}`).toHaveCount(1);
  }
}

async function boardCardCornerPresentation(page, cardId) {
  return page.locator(`[data-card-id="${cardId}"]`).first().evaluate((card) => {
    const layer = card.querySelector(":scope > .card-exhaust-layer");
    const might = layer?.querySelector(".unit-current-might");
    const health = layer?.querySelector(".unit-remaining-health");
    if (!layer || !might || !health) return null;
    const layerRect = layer.getBoundingClientRect();
    const mightRect = might.getBoundingClientRect();
    const healthRect = health.getBoundingClientRect();
    const matrix = getComputedStyle(layer).transform;
    const angle = matrix === "none"
      ? 0
      : Math.atan2(new DOMMatrixReadOnly(matrix).b, new DOMMatrixReadOnly(matrix).a) * 180 / Math.PI;
    const relativeCenter = (rect) => ({
      x: rect.left + rect.width / 2 - (layerRect.left + layerRect.width / 2),
      y: rect.top + rect.height / 2 - (layerRect.top + layerRect.height / 2)
    });
    return {
      angle,
      might: relativeCenter(mightRect),
      health: relativeCenter(healthRect)
    };
  });
}

test("tabletop board retains every persistent zone, count, card state, and game action", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installRichBoardFixture(page);

  await assertPersistentTable(page, fixture);
  const readyUnit = fixture.players.find((player) => !player.unitExhausted);
  expect(readyUnit).toBeTruthy();
  await page.waitForTimeout(250);
  const readyCorners = await boardCardCornerPresentation(page, readyUnit.unitId);
  expect(readyCorners).not.toBeNull();
  expect(Math.abs(readyCorners.angle)).toBeLessThan(1);
  expect(readyCorners.might.x).toBeGreaterThan(0);
  expect(readyCorners.might.y).toBeGreaterThan(0);
  expect(readyCorners.health.x).toBeLessThan(0);
  expect(readyCorners.health.y).toBeGreaterThan(0);

  await page.evaluate(({ playerId, cardId }) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    const card = player?.base?.find((candidate) => candidate.instanceId === cardId);
    if (!card) throw new Error(`Missing board card ${cardId}`);
    card.exhausted = true;
    window.__riftboundRender();
  }, { playerId: readyUnit.id, cardId: readyUnit.unitId });
  const exhaustedUnit = page.locator(`[data-card-id="${readyUnit.unitId}"]`).first();
  await expect(exhaustedUnit).toHaveAttribute("data-exhausted", "true");
  await page.waitForTimeout(250);
  const exhaustedCorners = await boardCardCornerPresentation(page, readyUnit.unitId);
  expect(exhaustedCorners).not.toBeNull();
  expect(Math.abs(Math.abs(exhaustedCorners.angle) - 90)).toBeLessThan(1);
  expect(exhaustedCorners.might.x).toBeLessThan(0);
  expect(exhaustedCorners.might.y).toBeGreaterThan(0);
  expect(exhaustedCorners.health.x).toBeLessThan(0);
  expect(exhaustedCorners.health.y).toBeLessThan(0);
  await expect(page.locator('.table-action-rail [data-action="end-turn"]')).toBeVisible();

  const ownSeat = page.locator('.table-seat[data-side="bottom"]');
  const ownPlayerId = await ownSeat.getAttribute("data-player-id");
  const ownHand = page.locator(`[data-zone="hand"][data-player-id="${ownPlayerId}"]`);
  const ownHandCard = ownHand.locator("[data-hand-card]").last();
  const ownHandCardId = await ownHandCard.getAttribute("data-card-id");
  await expect(ownHandCard).toBeInViewport();
  const fanGeometry = await ownHand.locator("[data-hand-card]").evaluateAll((cards) => cards.map((card) => {
    const rect = card.getBoundingClientRect();
    return { left: rect.left, width: rect.width, transform: getComputedStyle(card).transform };
  }));
  expect(new Set(fanGeometry.map((card) => card.transform)).size).toBeGreaterThan(1);
  expect(fanGeometry.some((card, index) => index > 0 && card.left - fanGeometry[index - 1].left < fanGeometry[index - 1].width)).toBe(true);
  const liftBefore = await ownHandCard.boundingBox();
  await ownHandCard.hover();
  await page.waitForTimeout(240);
  const liftAfter = await ownHandCard.boundingBox();
  expect(liftBefore).not.toBeNull();
  expect(liftAfter).not.toBeNull();
  expect(liftAfter.y).toBeLessThan(liftBefore.y - 8);
  await ownHandCard.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(ownHandCardId);
  await expect(ownHandCard).toHaveClass(/selected-card/u);
  await expect(ownHand).toBeVisible();

  const inspector = page.locator(".inspector.inspector-panel");
  if (!await inspector.isVisible()) {
    await page.locator('[data-action="toggle-inspector"]:not([disabled])').first().click();
  }
  await expect(inspector).toBeVisible();
  await expect(inspector.locator(".card-status-panel")).toBeVisible();
  await expect(ownHand).toBeVisible();

  await inspector.locator('[data-action="view-full-card"]').click();
  await expect(page.locator(".full-card-modal")).toBeVisible();
  await page.locator('[data-action="close-full-card"]').click();
  await expect(page.locator(".full-card-modal")).toHaveCount(0);

  await page.locator('.table-action-rail [data-action="toggle-inspector"]').click();
  await expect(inspector).not.toBeVisible();

  const ownFixture = fixture.players.find((player) => player.id === ownPlayerId);
  const runeOrientation = await page.evaluate(({ readyId, spentId }) => {
    const angle = (id) => {
      const layer = document.querySelector(`[data-card-id="${CSS.escape(id)}"] .rune-orientation-layer`);
      const transform = layer ? getComputedStyle(layer).transform : "none";
      if (transform === "none") return 0;
      const matrix = new DOMMatrixReadOnly(transform);
      return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    };
    return { ready: angle(readyId), spent: angle(spentId) };
  }, { readyId: ownFixture.readyRuneId, spentId: ownFixture.spentRuneId });
  expect(Math.abs(runeOrientation.ready)).toBeLessThan(1);
  expect(Math.abs(Math.abs(runeOrientation.spent) - 90)).toBeLessThan(1);
  const ownUnit = ownSeat.locator(`[data-card-id="${ownFixture.unitId}"]`);
  const ownAttachedGear = ownSeat.locator(`.attached-gear[data-card-id="${ownFixture.gearId}"]`);
  await ownAttachedGear.click({ position: { x: 24, y: 18 } });
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(ownFixture.gearId);
  await ownUnit.click({ position: { x: 8, y: 8 }, timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(ownFixture.unitId);
  await expect(page.locator(".context-action-dock .action-context")).toContainText("Regression Unit");
  // Selecting a physical card now opens its inspector directly. The toolbar
  // button remains the explicit close/reopen control rather than a required
  // second step after every card click.
  await expect(inspector).toBeVisible();
  await expect(inspector.locator('[data-action="toggle-attachments"]')).toBeVisible();
  await inspector.locator('[data-action="toggle-attachments"]').click();
  await expect(inspector.locator(`[data-card="${ownFixture.gearId}"]`)).toBeVisible();
  const expandedGear = inspector.locator(`.attached-gear-card[data-card-id="${ownFixture.gearId}"]`);
  await expect(expandedGear.locator(".attachment-orientation-layer")).toHaveCount(1);
  await expect(expandedGear.locator(".attached-gear-might")).toContainText(String(ownFixture.gearMight));
  await expect(expandedGear.locator(".attached-gear-readiness")).toContainText(
    ownFixture.gearExhausted ? /탈진|Exhausted|EXH/iu : /준비|Ready|RDY/iu
  );
  await expect(expandedGear.locator(".attached-gear-readiness")).toContainText(/강화|Empowered/iu);

  const ownRuneSummary = ownSeat.locator(".rune-summary");
  await expect(ownRuneSummary.locator(".rune-count.generated")).toContainText("+2 · 1/2");
  await expect(ownRuneSummary.locator(".rune-count.power-pool")).toContainText("2 · 1/2");
  await expect(ownRuneSummary.locator(".rune-count.generated")).toHaveClass(/partly-restricted/u);
  await page.evaluate((playerId) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    player.runePool.energy = [{
      id: "e2e-unit-only-energy",
      domains: ["Any"],
      sourceName: "Unit-only Energy",
      restriction: "unitOrUnitAbility"
    }];
    window.__riftboundRender();
  }, ownPlayerId);
  await expect(ownSeat.locator(".rune-count.generated")).toContainText("+1 · 0/1");
  await expect(ownSeat.locator(".rune-count.generated")).toHaveClass(/partly-restricted/u);

  await page.locator('[data-action="toggle-graveyard"]').first().click();
  await expect(page.locator(".graveyard-panel")).toBeVisible();
  await page.locator('[data-action="close-graveyard"]').click({ timeout: 5_000 });
  await expect(page.locator(".graveyard-panel")).toHaveCount(0);
  await page.locator('[data-action="toggle-banished"]').first().click();
  await expect(page.locator(".banished-panel")).toBeVisible();
  await page.locator('[data-action="close-banished"]').click({ timeout: 5_000 });
  await expect(page.locator(".banished-panel")).toHaveCount(0);

  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("Gear-only generated Power is enabled only for Gear and unknown restrictions stay disabled", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installRichBoardFixture(page);
  const playerId = await page.locator('.table-seat[data-side="bottom"]').getAttribute("data-player-id");

  const ids = await page.evaluate((activePlayerId) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === activePlayerId);
    const unitSource = player.base.find((card) => card.type === "unit") || player.hand[0] || player.legend;
    const gearSource = unitSource.attachments?.find((card) => card.type === "gear") || player.hand[0] || player.legend;
    const payableUnit = {
      ...structuredClone(unitSource),
      instanceId: "e2e-gear-power-unit",
      ownerId: player.id,
      controllerId: player.id,
      type: "unit",
      energy: 0,
      power: [{ domain: "Any", amount: 1 }],
      attachments: []
    };
    const payableGear = {
      ...structuredClone(gearSource),
      instanceId: "e2e-gear-power-gear",
      ownerId: player.id,
      controllerId: player.id,
      type: "gear",
      energy: 0,
      power: [{ domain: "Any", amount: 1 }],
      attachments: []
    };
    player.hand.push(payableUnit, payableGear);
    player.runePool.power = [
      {
        id: "e2e-gear-only-power",
        type: "power",
        domain: "Any",
        sourceCardId: "e2e-fire-below",
        sourceName: "Fire Below the Mountain",
        restriction: "gear"
      },
      {
        id: "e2e-unknown-power",
        type: "power",
        domain: "Any",
        sourceCardId: "e2e-unknown-source",
        sourceName: "Unknown Restricted Power",
        restriction: "future-unknown-restriction"
      }
    ];
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.pendingPayment = {
      id: "e2e-gear-power-payment",
      playerId: player.id,
      cardId: payableUnit.instanceId,
      cardName: payableUnit.name,
      source: "playCard",
      destination: "base",
      energyCost: 0,
      basePowerCost: [{ domain: "Any", amount: 1 }],
      powerCost: [{ domain: "Any", amount: 1 }],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      xpCost: 0,
      optionalPowerEffects: []
    };
    window.__riftboundRender();
    return { unitId: payableUnit.instanceId, gearId: payableGear.instanceId };
  }, playerId);

  const gearPowerButton = page.locator('[data-action="pay-pool-power"][data-power="e2e-gear-only-power"]');
  const unknownPowerButton = page.locator('[data-action="pay-pool-power"][data-power="e2e-unknown-power"]');
  await expect(gearPowerButton).toBeDisabled();
  await expect(unknownPowerButton).toBeDisabled();
  await expect(page.locator(`.table-seat[data-player-id="${playerId}"] .rune-count.power-pool`)).toContainText("2 · 0/2");

  await page.evaluate(({ activePlayerId, gearId }) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === activePlayerId);
    const gear = player.hand.find((card) => card.instanceId === gearId);
    game.pendingPayment.cardId = gear.instanceId;
    game.pendingPayment.cardName = gear.name;
    window.__riftboundRender();
  }, { activePlayerId: playerId, gearId: ids.gearId });

  await expect(gearPowerButton).toBeEnabled();
  await expect(unknownPowerButton).toBeDisabled();
  const powerSummary = page.locator(`.table-seat[data-player-id="${playerId}"] .rune-count.power-pool`);
  await expect(powerSummary).toContainText("2 · 1/2");
  await expect(powerSummary).toHaveClass(/partly-restricted/u);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("a deployed Champion stays as a labeled reference and is physical only in its actual zone", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installRichBoardFixture(page);
  const bottomPlayerId = await page.locator('.table-seat[data-side="bottom"]').getAttribute("data-player-id");
  const champion = await page.evaluate((playerId) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    const card = player.champion;
    player.trash = player.trash.filter((candidate) => candidate.instanceId !== card.instanceId);
    for (const field of game.battlefields) {
      field.units = field.units.filter((candidate) => candidate.instanceId !== card.instanceId);
      field.hidden = field.hidden.filter((item) => item.card.instanceId !== card.instanceId);
    }
    card.zone = "trash";
    player.championPlayed = true;
    player.trash.push(card);
    window.__riftboundRender();
    return { id: card.instanceId, playerId };
  }, bottomPlayerId);

  const seat = page.locator(`.table-seat[data-player-id="${champion.playerId}"]`);
  const championSlot = seat.locator('[data-zone="champion"]');
  await expect(championSlot).toHaveAttribute("data-count", "0");
  await expect(championSlot).toHaveAttribute("data-reference-zone", "trash");
  await expect(championSlot.locator('.champion-away-reference')).toContainText(/폐기|Trash/iu);
  await expect(championSlot.locator(`[data-card-id="${champion.id}"]`)).toHaveCount(0);

  await seat.locator('[data-action="toggle-graveyard"]').click();
  await expect(page.locator(`.graveyard-panel [data-card-id="${champion.id}"]`)).toBeVisible();
  await page.locator('[data-action="close-graveyard"]').click();

  await page.evaluate(({ playerId, championId }) => {
    const game = window.__riftboundGame;
    const player = game.players.find((candidate) => candidate.id === playerId);
    const card = player.champion;
    player.trash = player.trash.filter((candidate) => candidate.instanceId !== championId);
    card.zone = "chain";
    game.actionChain = {
      playerId,
      turnPlayerId: game.currentPlayerId,
      priorityPlayerId: playerId,
      playerIds: game.players.map((candidate) => candidate.id),
      consecutivePasses: 0,
      chainSequence: 1,
      chainOpenedBy: "e2e-champion-reference",
      chain: [{ id: "e2e-champion-chain-item", itemType: "card", playerId, card, destination: "base", status: "pending" }]
    };
    window.__riftboundRender();
  }, { playerId: champion.playerId, championId: champion.id });

  await expect(championSlot).toHaveAttribute("data-reference-zone", "chain");
  await expect(championSlot.locator('.champion-away-reference')).toContainText(/체인|Chain/iu);
  await expect(championSlot.locator(`[data-card-id="${champion.id}"]`)).toHaveCount(0);
  await expect(page.locator(`.chain-zone-item[data-card-id="${champion.id}"]`)).toBeVisible();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("tabletop board remains complete and safe through showdown, Chain, payment, and choice overlays", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installRichBoardFixture(page);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const [attacker, defender] = game.players;
    const battlefield = game.battlefields[0];
    const chainCard = structuredClone(attacker.hand[0] || attacker.mainDeck[0]);
    chainCard.instanceId = "e2e-chain-card";
    chainCard.ownerId = attacker.id;
    chainCard.controllerId = attacker.id;
    const triggerCard = structuredClone(defender.hand[0] || defender.mainDeck[0]);
    triggerCard.instanceId = "e2e-trigger-card";
    triggerCard.ownerId = defender.id;
    triggerCard.controllerId = defender.id;
    game.phase = "showdown";
    game.actionChain = null;
    game.showdown = {
      battlefieldId: battlefield.instanceId,
      turnPlayerId: attacker.id,
      attackerId: attacker.id,
      defenderId: defender.id,
      focusPlayerId: attacker.id,
      priorityPlayerId: attacker.id,
      consecutivePasses: 0,
      chainSequence: 1,
      chainOpenedBy: "card",
      combat: true,
      chain: [
        { id: "e2e-chain-item", itemType: "card", playerId: attacker.id, card: chainCard, destination: "base", status: "finalized" },
        {
          id: "e2e-trigger-item",
          itemType: "trigger",
          playerId: defender.id,
          card: triggerCard,
          trigger: {
            id: "e2e-trigger",
            kind: "effectSpecs",
            playerId: defender.id,
            sourceCardId: triggerCard.instanceId,
            data: {}
          },
          status: "pending"
        }
      ]
    };
    game.pendingPayment = null;
    game.pendingChoice = null;
    window.__riftboundRender();
  });

  await assertPersistentTable(page, fixture);
  await expect(page.locator(".chain-zone")).toBeVisible();
  await expect(page.locator(".chain-zone-item")).toHaveCount(2);
  await expect(page.locator('.context-action-dock [data-action="pass-showdown"]')).toBeVisible();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.mainDeck[0];
    game.phase = "action";
    game.showdown = null;
    game.actionChain = null;
    game.pendingChoice = null;
    game.pendingPayment = {
      id: "e2e-payment",
      playerId: player.id,
      cardId: card.instanceId,
      cardName: card.name,
      source: "playCard",
      destination: "base",
      energyCost: 2,
      basePowerCost: [],
      powerCost: [],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      xpCost: 0,
      optionalPowerEffects: []
    };
    window.__riftboundRender();
  });

  await expect(page.locator(".payment-panel")).toBeVisible();
  await expect(page.locator('[data-action="cancel-payment"]')).toBeVisible();
  await expect(page.locator('[data-action="confirm-payment"]')).toBeVisible();
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator('.persistent-hand[data-side="bottom"], .hand-drawer.persistent-hand')).toBeVisible();
  await expect(page.locator('.table-seat[data-side="bottom"] [data-zone="runes"]')).toBeVisible();
  await page.locator('[data-action="cancel-payment"]').click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment)).toBeNull();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.mainDeck[0];
    game.pendingPayment = null;
    game.pendingChoice = {
      id: "e2e-choice",
      playerId: player.id,
      card,
      effect: "tabletopRegressionChoice",
      prompt: "Choose a regression option.",
      options: [
        { id: "first", label: "First option" },
        { id: "second", label: "Second option" }
      ],
      optional: true,
      data: {}
    };
    window.__riftboundRender();
  });

  await expect(page.locator(".choice-panel")).toBeVisible();
  await expect(page.locator('[data-action="choose-effect"]')).toHaveCount(2);
  await expect(page.locator('[data-action="decline-effect"]')).toBeVisible();
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator('.persistent-hand[data-side="bottom"], .hand-drawer.persistent-hand')).toBeVisible();
  await page.locator('[data-action="decline-effect"]').click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingChoice)).toBeNull();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("primary turn and showdown controls dispatch through the rebuilt action rail", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);

  // Beginning-phase battlefield triggers can legitimately open a response
  // window before the first action. Resolve that window through the rebuilt
  // action rail instead of treating a correctly disabled End Turn as a fault.
  for (let passCount = 0; passCount < 6; passCount += 1) {
    const endTurn = page.locator('.table-action-rail [data-action="end-turn"]:enabled');
    if (await endTurn.count()) break;
    const pass = page.locator('.context-action-dock [data-action="pass-showdown"]:enabled');
    await expect(pass).toHaveCount(1);
    await pass.click();
  }

  // currentPlayerId follows Chain priority, so a Beginning trigger on the new
  // turn can immediately give it back to the previous player.  turnPlayerId is
  // the authoritative turn owner and is the stable signal for End Turn.
  const turnBefore = await page.evaluate(() => {
    const game = window.__riftboundGame;
    return game.turnPlayerId || game.currentPlayerId;
  });
  await page.locator('.table-action-rail [data-action="end-turn"]:enabled').click();
  await expect.poll(() => page.evaluate(() => {
    const game = window.__riftboundGame;
    return game.turnPlayerId || game.currentPlayerId;
  })).not.toBe(turnBefore);

  await installShowdownFixture(page);
  const passControl = page.locator('.priority-response-controls [data-action="pass-showdown"]:enabled');
  await expect(passControl).toHaveCount(1);
  const priorityBeforePass = await page.evaluate(() => window.__riftboundGame.showdown?.priorityPlayerId);
  await passControl.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.showdown?.consecutivePasses)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.showdown?.priorityPlayerId)).not.toBe(priorityBeforePass);
  await expect(page.locator('.priority-response-controls [data-action="pass-showdown"]:enabled')).toHaveCount(1);
  await expect(page.locator('.priority-response-controls [data-action="pass-showdown"]')).toContainText(/1\/2/u);
  await page.locator('.priority-response-controls [data-action="pass-showdown"]:enabled').click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.showdown)).toBeNull();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("tabletop renderer defaults optional collections without leaking undefined values", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);

  const sparse = await page.evaluate(() => {
    const game = window.__riftboundGame;
    game.phase = "action";
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.triggerQueue = undefined;
    game.revealedIntel = undefined;
    for (const player of game.players) {
      player.banished = undefined;
      player.runePool = undefined;
      player.burnOuts = undefined;
    }
    for (const battlefield of game.battlefields) battlefield.hidden = [];
    window.__riftboundRender();
    return {
      battlefieldCount: game.battlefields.length,
      players: game.players.map((player) => ({
        id: player.id,
        hand: player.hand.length,
        mainDeck: player.mainDeck.length,
        runeDeck: player.runeDeck.length,
        trash: player.trash.length,
        banished: 0,
        base: player.base.length,
        legend: player.legend ? 1 : 0,
        champion: player.champion ? 1 : 0,
        runes: player.runes.length,
        handNames: player.hand.map((card) => card.name)
      }))
    };
  });

  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator('[data-zone="battlefields"]')).toHaveAttribute("data-count", String(sparse.battlefieldCount));
  for (const player of sparse.players) {
    const seat = page.locator(`.table-seat[data-player-id="${player.id}"]`);
    for (const zone of TABLE_ZONES) {
      const fixtureKey = zone.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      const node = zone === "hand"
        ? page.locator(`.tabletop-board [data-zone="hand"][data-player-id="${player.id}"]`)
        : seat.locator(`[data-zone="${zone}"]`);
      await expect(node).toHaveAttribute("data-count", String(player[fixtureKey]));
    }
  }
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("mobile tabletop keeps the permanent hand and primary action reachable", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyBoard(page);

  const bottomSeat = page.locator('.table-seat[data-side="bottom"]');
  const playerId = await bottomSeat.getAttribute("data-player-id");
  const hand = page.locator(`[data-zone="hand"][data-player-id="${playerId}"]`);
  const actionRail = page.locator(".table-action-rail");
  await expect(hand).toBeVisible();
  await expect(hand).toBeInViewport();
  await expect(hand.locator("[data-hand-card]")).toHaveCount(Number(await hand.getAttribute("data-count")));
  await expect(actionRail).toBeVisible();
  await expect(actionRail).toBeInViewport();
  await expect(page.locator('.context-action-dock').locator('[data-action="end-turn"], [data-action="pass-showdown"]')).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(horizontalOverflow.scrollWidth).toBeLessThanOrEqual(horizontalOverflow.clientWidth + 1);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("low-height replay uses a readable side rail without covering the battlefield", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await openReadOnlyReplay(page);

  const mat = page.locator(".battlefield-mat");
  const replay = page.locator(".replay-playback-controls");
  const actionRail = page.locator(".table-action-rail");
  const [matRect, replayRect, actionRect] = await Promise.all([
    mat.boundingBox(), replay.boundingBox(), actionRail.boundingBox()
  ]);
  expect(matRect).not.toBeNull();
  expect(replayRect).not.toBeNull();
  expect(actionRect).not.toBeNull();
  expect(replayRect.x).toBeGreaterThanOrEqual(matRect.x + matRect.width + 1);
  expect(actionRect.x).toBeGreaterThanOrEqual(replayRect.x + replayRect.width + 1);

  const controls = replay.locator('.replay-transport button, .replay-timeline, .replay-view-options button, .replay-view-options select');
  await expect(controls).toHaveCount(9);
  const centerHits = await controls.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === node || node.contains(hit);
  }));
  expect(centerHits.every(Boolean)).toBe(true);

  const coreFontSizes = await page.locator([
    ".tabletop-layout .player-stats > *",
    ".tabletop-layout .pile-label",
    ".tabletop-layout .pile-count",
    ".tabletop-layout .rune-count",
    ".tabletop-layout .unit-board-overlay .unit-current-might",
    ".tabletop-layout .unit-board-overlay .unit-remaining-health",
    ".tabletop-layout .owner-chip"
  ].join(", ")).evaluateAll((nodes) => nodes
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((node) => Number.parseFloat(getComputedStyle(node).fontSize)));
  expect(coreFontSizes.length).toBeGreaterThan(0);
  expect(Math.min(...coreFontSizes)).toBeGreaterThanOrEqual(7.9);

  const matWidthBeforeSheet = matRect.width;
  await page.locator('.tabletop-topbar [data-action="toggle-log"]').click();
  await expect(page.locator(".log-drawer")).toBeVisible();
  await expect(replay).not.toBeVisible();
  const expandedMat = await mat.boundingBox();
  expect(expandedMat.width).toBeGreaterThan(matWidthBeforeSheet + 40);
  await page.locator('.tabletop-topbar [data-action="toggle-log"]').click();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("keyboard selection and payment toggles preserve logical focus across full renders", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installRichBoardFixture(page);

  const ownHand = page.locator('.persistent-hand[data-zone="hand"]');
  const handCard = ownHand.locator("[data-hand-card][data-card-id]").last();
  const cardId = await handCard.getAttribute("data-card-id");
  await handCard.focus();
  await expect(handCard).toBeFocused();
  await handCard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(cardId);
  await expect(ownHand.locator(`[data-hand-card][data-card-id="${cardId}"]`), "hand Enter must restore focus to the same logical card").toBeFocused();

  const payment = await installPaymentFocusFixture(page);
  const paymentRune = page.locator(`[data-action="pay-rune"][data-rune="${payment.runeId}"][data-mode="energy"]`);
  await expect(paymentRune).toBeVisible();
  await paymentRune.focus();
  await expect(paymentRune).toBeFocused();
  await paymentRune.press("Enter");
  const rerenderedPaymentRune = page.locator(`[data-action="pay-rune"][data-rune="${payment.runeId}"][data-mode="energy"]`);
  await expect(rerenderedPaymentRune).toHaveAttribute("aria-pressed", "true");
  await expect(rerenderedPaymentRune, "payment Rune toggle must restore focus to the same logical control").toBeFocused();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("blocking game dialog focuses its first control, traps Tab, and restores its opener on Escape", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);

  const opener = page.locator('.tabletop-topbar [data-action="surrender"]');
  await opener.focus();
  await opener.click();

  const dialog = page.locator('.game-exit-modal[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();
  const focusable = dialog.locator(FOCUSABLE_SELECTOR);
  await expect(focusable).toHaveCount(2);
  const first = focusable.first();
  const last = focusable.last();
  await expect(first, "dialog entry must move focus to its first actionable control").toBeFocused();

  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first, "Tab from the last dialog control must wrap to the first").toBeFocused();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last, "Shift+Tab from the first dialog control must wrap to the last").toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener, "Escape must return focus to the control that opened the dialog").toBeFocused();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("setup screens become inert while a blocking dialog is open", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.goto("/");
  await page.locator('[data-action="menu-start"]').click();
  const setupSurface = page.locator(".tabletop-layout > :not(.tabletop-overlay-root)").first();
  await expect(setupSurface).toBeVisible();
  const phaseBefore = await page.evaluate(() => window.__riftboundGame.phase);

  await page.locator('.tabletop-topbar [data-action="new-game"]').click();
  const dialog = page.locator('.game-exit-modal[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();
  await expect(setupSurface).toHaveAttribute("inert", "");
  await expect(setupSurface).toHaveAttribute("aria-hidden", "true");
  await expect(dialog.locator('[data-action="cancel-game-exit"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(FOCUSABLE_SELECTOR).last()).toBeFocused();
  expect(await page.evaluate(() => window.__riftboundGame.phase)).toBe(phaseBefore);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(setupSurface).not.toHaveAttribute("inert", "");
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("390px tabletop exposes game actions, XP, Rune readiness, pool totals, combat health, and pile labels", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyBoard(page);
  const fixture = await installRichBoardFixture(page);
  await installShowdownFixture(page);

  const gameMenu = page.locator('[data-action="toggle-game-menu"]:visible');
  if (await gameMenu.count()) await gameMenu.first().click();
  const mobileActionContracts = [
    { label: "toggle-log", selector: '[data-action="toggle-log"]:visible' },
    { label: "surrender", selector: '[data-action="surrender"]:visible' },
    { label: "exit/new-game", selector: ':is([data-action="new-game"], [data-action="return-menu"], [data-action="replay-exit"], [data-action="tutorial-exit"]):visible' }
  ];
  for (const contract of mobileActionContracts) {
    await expect.soft(
      page.locator(contract.selector).first(),
      `390px must expose ${contract.label} directly or inside the game menu`
    ).toBeVisible({ timeout: 2_000 });
  }

  for (const player of fixture.players) {
    const seat = page.locator(`.table-seat[data-player-id="${player.id}"]`);
    await expect.soft(seat.locator(".xp-stat"), `${player.id} XP must stay visible at 390px`).toBeVisible({ timeout: 2_000 });

    const runeSummary = seat.locator(".rune-summary");
    await expect.soft(runeSummary, `${player.id} Rune summary must stay visible at 390px`).toBeVisible({ timeout: 2_000 });
    await expect.soft(runeSummary, `${player.id} Rune summary must expose ready/total`).toContainText("1/2", { timeout: 2_000 });
    await expect.soft(runeSummary.locator(".rune-count.generated"), `${player.id} generated Energy pool total must stay visible`).toBeVisible({ timeout: 2_000 });
    await expect.soft(runeSummary.locator(".rune-count.power-pool"), `${player.id} generated Power pool total must stay visible`).toBeVisible({ timeout: 2_000 });

    await expect.soft(seat.locator('.pile-trash .pile-label'), `${player.id} trash label must stay visible at 390px`).toBeVisible({ timeout: 2_000 });
    await expect.soft(seat.locator('.pile-banished .pile-label'), `${player.id} banished label must stay visible at 390px`).toBeVisible({ timeout: 2_000 });

    const attachedGear = seat.locator(`.attached-gear[data-card-id="${player.gearId}"]`);
    await expect.soft(attachedGear, `${player.id} attached gear must remain directly selectable at 390px`).toBeVisible({ timeout: 2_000 });
    await expect.soft(attachedGear).toHaveAttribute("title", /강화|Empowered/iu);
    const compactGearPresentation = await attachedGear.evaluate((element) => {
      const might = element.querySelector(".attached-gear-board-overlay .attached-gear-might");
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        aspectRatio: rect.width / Math.max(1, rect.height),
        mightFontSize: might ? Number.parseFloat(getComputedStyle(might).fontSize) : 0,
        mightClientWidth: might?.clientWidth || 0,
        mightScrollWidth: might?.scrollWidth || 0,
        readinessCount: element.querySelectorAll(".attached-gear-readiness, .attached-gear-state").length
      };
    });
    expect.soft(compactGearPresentation.width, `${player.id} attached gear must keep a usable compact hit target`).toBeGreaterThanOrEqual(30);
    expect.soft(compactGearPresentation.height, `${player.id} attached gear must not collapse inside its strip`).toBeGreaterThanOrEqual(42);
    expect.soft(compactGearPresentation.aspectRatio, `${player.id} attached gear must preserve a portrait card ratio`).toBeGreaterThan(0.66);
    expect.soft(compactGearPresentation.aspectRatio, `${player.id} attached gear must preserve a portrait card ratio`).toBeLessThan(0.76);
    expect.soft(compactGearPresentation.mightFontSize, `${player.id} attached gear Might corner must remain legible`).toBeGreaterThanOrEqual(7);
    expect.soft(compactGearPresentation.mightScrollWidth, `${player.id} attached gear Might must not be ellipsized`).toBeLessThanOrEqual(compactGearPresentation.mightClientWidth + 1);
    expect.soft(compactGearPresentation.readinessCount, `${player.id} attached gear must communicate readiness only by orientation`).toBe(0);
  }

  const mobileTextSizes = await page.locator("body").evaluate((root) => {
    const fontSize = (selector) => {
      const element = root.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };
    return {
      topbarStatus: fontSize(".tabletop-topbar .status-detail"),
      zoneCaption: fontSize(".table-seat .zone-caption")
    };
  });
  expect.soft(mobileTextSizes.topbarStatus, "mobile topbar status must remain legible").toBeGreaterThanOrEqual(7);
  expect.soft(mobileTextSizes.zoneCaption, "mobile zone captions must remain legible").toBeGreaterThanOrEqual(7);

  const damagedUnit = page.locator(`[data-card-id="${fixture.players[0].unitId}"][data-damage="${fixture.players[0].unitDamage}"]`);
  await expect.soft(
    damagedUnit.locator(".card-face-layer .unit-remaining-health").first(),
    "remaining health must stay visible in the card corner at 390px"
  ).toBeVisible({ timeout: 2_000 });
  await expect.soft(
    page.locator('[data-card-id^="e2e-field-unit-"] .card-face-layer .unit-current-might').first(),
    "current Might must stay visible during showdown at 390px"
  ).toBeVisible({ timeout: 2_000 });

  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("valid Divine Judgment and repeat-spell pending states remain renderable", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installRichBoardFixture(page);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.legend;
    game.currentPlayerId = player.id;
    game.pendingPayment = null;
    game.pendingChoice = {
      id: "e2e-valid-divine-judgment-keep",
      playerId: player.id,
      card,
      effect: "divineJudgmentKeep",
      options: [{ id: card.instanceId, label: card.name, cardId: card.instanceId, card }],
      optional: false,
      data: {
        playerIds: game.players.map((candidate) => candidate.id),
        playerIndex: 0,
        categoryIndex: 3,
        selectedIds: [],
        kept: {
          [player.id]: {
            units: [],
            gear: [],
            runes: player.runes.map((rune) => rune.instanceId)
          }
        },
        finishSpell: false,
        fromShowdownChain: false
      }
    };
    window.__riftboundRender();
  });
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator(".tabletop-state-unavailable")).toHaveCount(0);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.legend;
    const kept = Object.fromEntries(game.players.map((candidate) => [candidate.id, {
      units: [],
      gear: [],
      runes: [],
      hand: candidate.hand.slice(0, 2).map((keptCard) => keptCard.instanceId)
    }]));
    game.pendingPayment = null;
    game.pendingChoice = {
      id: "e2e-valid-divine-judgment-rune-order",
      playerId: player.id,
      card,
      effect: "divineJudgmentRuneOrder",
      options: player.runes.map((rune) => ({
        id: rune.instanceId,
        label: rune.name,
        cardId: rune.instanceId,
        card: rune
      })),
      optional: false,
      data: {
        playerIds: game.players.map((candidate) => candidate.id),
        playerIndex: game.players.length,
        categoryIndex: 0,
        selectedIds: [],
        kept,
        finishSpell: false,
        fromShowdownChain: false,
        runeOrderPlayerIndex: 0,
        runeRecycleOrder: {},
        selectedRuneOrderIds: []
      }
    };
    window.__riftboundRender();
  });
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator(".tabletop-state-unavailable")).toHaveCount(0);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.legend;
    game.pendingChoice = null;
    game.pendingPayment = {
      id: "e2e-valid-repeat-spell-payment",
      playerId: player.id,
      cardId: card.instanceId,
      cardName: card.name,
      source: "effectEnergy",
      destination: "base",
      energyCost: 0,
      basePowerCost: [],
      powerCost: [],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      optionalPowerEffects: [],
      effectPayment: {
        kind: "repeatSpell",
        sourcePlayerId: player.id,
        sourceCard: card,
        repeatSpec: { timing: "spell", kind: "draw", amount: 1 },
        finishSpell: false,
        fromShowdownChain: false
      }
    };
    window.__riftboundRender();
  });
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator(".tabletop-state-unavailable")).toHaveCount(0);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("a suspended activated payment without its source payload renders cancel-only recovery", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const source = player.legend;
    const paymentFields = {
      destination: "base",
      energyCost: 1,
      xpCost: 0,
      recycleTrashCost: 0,
      discardCost: 0,
      basePowerCost: [],
      powerCost: [],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      optionalPowerEffects: []
    };
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.pendingPayment = {
      id: "e2e-invalid-resume-child",
      playerId: player.id,
      cardId: source.instanceId,
      cardName: source.name,
      source: "activatedAbility",
      ...paymentFields,
      activatedAbility: {
        sourceCard: source,
        specs: [{ timing: "activated", kind: "addEnergy", amount: 1 }]
      },
      resumePayment: {
        id: "e2e-invalid-resume-parent",
        playerId: player.id,
        cardId: source.instanceId,
        cardName: source.name,
        source: "activatedAbility",
        ...paymentFields
      }
    };
    window.__riftboundRender();
  });

  const recovery = page.locator("[data-invalid-resume-payment]");
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator(".tabletop-state-unavailable")).toHaveCount(0);
  await expect(recovery).toBeVisible();
  await expect(recovery.locator('[data-action="cancel-payment"]')).toBeVisible();
  await expect(recovery.locator('[data-action="confirm-payment"]')).toHaveCount(0);
  await recovery.locator('[data-action="cancel-payment"]').click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment)).toBeNull();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("a payment with a missing payer remains cancelable from its recovery banner", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const card = game.players[0].hand[0] || game.players[0].mainDeck[0];
    game.phase = "action";
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.pendingPayment = {
      id: "e2e-missing-payment-player",
      playerId: "missing-player",
      cardId: card.instanceId,
      cardName: card.name,
      source: "playCard",
      destination: "base",
      energyCost: 1,
      basePowerCost: [],
      powerCost: [],
      declaredTargets: [],
      declaredChoices: [],
      deflectTargetIds: [],
      energyRuneIds: [],
      poolEnergyIds: [],
      powerRuneIds: [],
      poolPowerIds: [],
      optionalPowerEffects: []
    };
    window.__riftboundRender();
  });

  const recovery = page.locator(".payment-stage-error");
  await expect(page.locator(".tabletop-board")).toBeVisible();
  await expect(page.locator(".tabletop-state-unavailable")).toHaveCount(0);
  await expect(recovery).toBeVisible();
  await recovery.locator('[data-action="cancel-payment"]').click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment)).toBeNull();
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

for (const scenario of [
  "champion-select-player",
  "champion-select-legend",
  "battlefield-select-player",
  "battlefield-select-champion",
  "mulligan-player",
  "action-current-player",
  "extra-player-seat",
  "duplicate-player-seat",
  "null-hidden-zone",
  "invalid-unit-controller",
  "invalid-hidden-controller",
  "invalid-revealed-intel",
  "invalid-revealed-intel-entry",
  "invalid-score-events",
  "invalid-effect-flash-targets",
  "invalid-effect-flash-source",
  "invalid-effect-flash-message",
  "invalid-effect-flash-stamp",
  "invalid-turn-order",
  "invalid-ai-declined-intents",
  "invalid-first-player-roller",
  "invalid-battlefield-effects",
  "invalid-staged-events",
  "invalid-event-collection",
  "invalid-process-collection",
  "invalid-cleanup-trigger-batches",
  "invalid-trigger-queue-continuation",
  "invalid-deferred-trigger-continuations",
  "invalid-card-instance-id",
  "invalid-card-text",
  "invalid-card-translation-text",
  "duplicate-authoritative-card-id",
  "invalid-effect-ability-keywords",
  "invalid-effect-keywords",
  "invalid-effect-selector-lists",
  "invalid-card-additional-cost-tags",
  "invalid-effect-cost-options",
  "invalid-trigger-kind",
  "invalid-trigger-specs",
  "invalid-trigger-order-kind",
  "invalid-log-entry",
  "missing-choice-data",
  "missing-choice-player",
  "missing-choice-card",
  "duplicate-choice-option",
  "invalid-choice-card-ids",
  "required-choice-no-options",
  "falsey-choice-state",
  "missing-pay-deflect-data",
  "incomplete-combat-damage",
  "invalid-choice-effect-sequence",
  "invalid-choice-game-effect-resolution",
  "invalid-divine-judgment-keep-data",
  "invalid-divine-judgment-rune-order-data",
  "invalid-rune-pool-energy-entry",
  "oversized-rune-pool-energy",
  "invalid-rune-pool-power-entry",
  "invalid-chain-target-ids",
  "invalid-chain-status",
  "missing-chain-trigger",
  "invalid-chain-record-target",
  "invalid-rule-trace",
  "missing-champion-pool",
  "missing-battlefield-pool",
  "card-power-entry",
  "payment-power-cost",
  "payment-power-entry",
  "payment-rune-pool-power",
  "missing-payment-power-runes",
  "invalid-triggered-payment-triggers",
  "invalid-replacement-power-cost",
  "missing-effect-payment",
  "invalid-repeat-spell-spec",
  "invalid-repeat-spell-source-player",
  "invalid-payment-effect-sequence",
  "invalid-payment-game-effect-resolution",
  "choice-and-payment"
]) {
  test(`malformed game state fails closed: ${scenario}`, async ({ page }) => {
    await expectMalformedStateToFailClosed(page, scenario);
  });
}

test("an unavailable frame releases invisible UI history guards", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installRichBoardFixture(page);
  const handCard = page.locator('.persistent-hand [data-hand-card]').last();
  await handCard.click();
  const inspectorToggle = page.locator('.table-action-rail [data-action="toggle-inspector"]');
  const inspector = page.locator('.inspector.inspector-panel');
  if (!await inspector.isVisible()) await inspectorToggle.click();
  await expect(inspector).toBeVisible();
  await inspector.locator('[data-action="view-full-card"]').click();
  await expect(page.locator('.full-card-modal')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.history.state?.riftboundUiLayer === true)).toBe(true);

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    game.players[0].hand[0].power = [null];
    window.__riftboundRender();
  });
  await expect(page.locator('.phase-unavailable')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.history.state?.riftboundUiLayer === true)).toBe(false);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("replay viewer switching hides private decisions, hand cards, and stale motion", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installRichBoardFixture(page);
  const fixture = await page.evaluate(() => {
    const game = window.__riftboundGame;
    const [player, opponent] = game.players;
    const source = opponent.hand[0] || opponent.mainDeck[0];
    const secretName = "E2E PRIVATE OPPONENT CARD";
    const secret = {
      ...structuredClone(source),
      instanceId: "e2e-private-opponent-card",
      ownerId: opponent.id,
      controllerId: opponent.id,
      name: secretName,
      translations: {
        ...(source.translations || {}),
        ko: { ...(source.translations?.ko || {}), name: secretName, text: "비공개 카드" },
        en: { ...(source.translations?.en || {}), name: secretName, text: "Private card" }
      }
    };
    if (opponent.hand.length) opponent.hand[0] = secret;
    else opponent.hand.push(secret);
    const choiceCard = player.hand[0] || player.mainDeck[0];
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.actionChain = null;
    game.showdown = null;
    game.pendingPayment = null;
    game.pendingChoice = {
      id: "e2e-private-replay-choice",
      playerId: player.id,
      card: choiceCard,
      effect: "e2ePrivateChoice",
      prompt: "E2E PRIVATE P1 DECISION",
      options: [{ id: "private-option", label: "E2E PRIVATE P1 OPTION" }],
      optional: true,
      data: {}
    };
    return {
      playerId: player.id,
      opponentId: opponent.id,
      secretName,
      replay: {
        id: "e2e-private-viewer-replay",
        createdAt: "2026-08-30T00:00:00.000Z",
        completedAt: "2026-08-30T00:01:00.000Z",
        frames: [{
          sequence: 0,
          actorId: opponent.id,
          action: { kind: "beginPlayCard", cardId: secret.instanceId },
          turnNumber: game.turnNumber || 1,
          phase: game.phase,
          game: JSON.parse(JSON.stringify(game))
        }]
      }
    };
  });

  await installReplayRoute(page, fixture.replay);
  await page.reload();
  await page.locator('[data-action="menu-replays"]').click();
  await page.locator(`[data-action="replay-open"][data-replay-id="${fixture.replay.id}"]`).click();
  await expect(page.locator(".choice-panel")).toContainText("E2E PRIVATE P1 OPTION");
  await expect(page.locator(".choice-panel")).toHaveAttribute("inert", "");
  await expect(page.locator(".choice-panel")).toHaveAttribute("aria-readonly", "true");
  await expect(page.locator(".replay-now-playing")).not.toContainText(fixture.secretName);
  await expect(page.locator('[data-card-id="e2e-private-opponent-card"]')).toHaveCount(0);

  await page.evaluate(() => {
    const layer = document.createElement("div");
    layer.className = "tabletop-card-flight-layer";
    layer.innerHTML = '<span class="tabletop-card-flight">stale-private-flight</span>';
    document.body.appendChild(layer);
  });
  await page.locator(`[data-action="replay-viewer"][data-player="${fixture.opponentId}"]`).click();
  await expect(page.locator(".choice-panel")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("E2E PRIVATE P1 OPTION");
  await expect(page.locator(".replay-now-playing")).toContainText(fixture.secretName);
  await expect(page.locator(".tabletop-card-flight-layer")).toHaveCount(0);
  await expect(page.locator('[data-card-id="e2e-private-opponent-card"]').first()).toBeVisible();
  await expect(page.locator(".tabletop-board")).toHaveClass(/acting-top/u);
  await expect(page.locator(".score-track .score-name").first()).toHaveText(
    await page.locator('.table-seat[data-side="bottom"] .player-summary h2').innerText()
  );

  await page.locator(`[data-action="replay-viewer"][data-player="${fixture.playerId}"]`).click();
  await expect(page.locator(".choice-panel")).toContainText("E2E PRIVATE P1 OPTION");
  await expect(page.locator(".replay-now-playing")).not.toContainText(fixture.secretName);
  await expect(page.locator(".tabletop-board")).toHaveClass(/acting-bottom/u);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("invalid replay frames fail closed before they can produce an undefined error", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const replay = await page.evaluate(() => ({
    id: "e2e-invalid-frame-replay",
    createdAt: "2026-08-30T00:00:00.000Z",
    completedAt: "2026-08-30T00:01:00.000Z",
    frames: [{
      sequence: 0,
      actorId: null,
      action: null,
      turnNumber: window.__riftboundGame.turnNumber || 1,
      phase: window.__riftboundGame.phase,
      game: JSON.parse(JSON.stringify(window.__riftboundGame))
    }, { sequence: 1, game: null }]
  }));
  await installReplayRoute(page, replay);
  await page.reload();
  await page.locator('[data-action="menu-replays"]').click();
  await page.locator(`[data-action="replay-open"][data-replay-id="${replay.id}"]`).click();
  await expect(page.locator('[role="alert"]')).toContainText(/frame 1|프레임 1/iu);
  await expect(page.locator(".tabletop-board")).toHaveCount(0);
  expect(runtimeFailures).toEqual([]);
});

test("browser Back exits a replay to the replay library", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadOnlyReplay(page);
  await expect.poll(() => page.evaluate(() => window.history.state?.riftboundUiLayer === true)).toBe(true);
  await page.evaluate(() => window.history.back());
  await expect(page.locator('.replay-browser-screen')).toBeVisible();
  await expect(page.locator('.replay-playback-controls')).toHaveCount(0);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("replay keeps inspector, Chain inspection, full-card preview, and pile sheets available without mutating game state", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadOnlyReplay(page);

  const before = await page.evaluate(() => {
    const game = window.__riftboundGame;
    return {
      phase: game.phase,
      turnNumber: game.turnNumber,
      hand: game.players.map((player) => player.hand.length),
      trash: game.players.map((player) => player.trash.length),
      banished: game.players.map((player) => (player.banished || []).length),
      chain: game.actionChain?.chain?.length || 0
    };
  });

  const handCard = page.locator('.persistent-hand [data-hand-card][data-card-id]').last();
  const handCardId = await handCard.getAttribute("data-card-id");
  await handCard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.selectedCardId)).toBe(handCardId);
  const inspector = page.locator(".inspector.inspector-panel");
  const inspectorToggle = page.locator('.table-action-rail [data-action="toggle-inspector"]');
  if (!await inspector.isVisible()) await inspectorToggle.click();
  await expect(inspector, "replay must allow opening the read-only card inspector").toBeVisible();

  const chainItem = page.locator('[data-action="inspect-chain-effect"][data-chain-item-id="e2e-replay-chain-item"]');
  await expect(chainItem).toBeVisible();
  await chainItem.press("Enter");
  const chainContext = page.locator(".chain-context-panel.showing-targets");
  await expect.soft(chainContext, "replay must allow inspecting a Chain item's context").toBeVisible({ timeout: 2_000 });
  const chainPreview = chainContext.locator('[data-action="view-chain-card"]');
  await expect.soft(chainPreview, "replay Chain context must retain its full-card action").toBeVisible({ timeout: 2_000 });
  if (await chainPreview.isVisible()) {
    await chainPreview.press("Enter");
    await expect.soft(page.locator(".full-card-modal"), "replay Chain cards must support read-only full-card preview").toBeVisible({ timeout: 2_000 });
    const layerOrder = await page.evaluate(() => ({
      preview: Number.parseInt(getComputedStyle(document.querySelector(".full-card-modal")).zIndex, 10) || 0,
      replay: Number.parseInt(getComputedStyle(document.querySelector(".replay-playback-controls")).zIndex, 10) || 0
    }));
    expect(layerOrder.preview).toBeGreaterThan(layerOrder.replay);
    if (await page.locator('[data-action="close-full-card"]').isVisible()) {
      await page.locator('[data-action="close-full-card"]').press("Enter");
      await expect(page.locator(".full-card-modal")).toHaveCount(0);
    }
  }

  const bottomSeat = page.locator('.table-seat[data-side="bottom"]');
  await bottomSeat.locator('[data-action="toggle-graveyard"]').press("Enter");
  await expect(page.locator(".graveyard-panel:not(.banished-panel)"), "replay trash pile must remain inspectable").toBeVisible();
  await page.locator('[data-action="close-graveyard"]').press("Enter");
  await bottomSeat.locator('[data-action="toggle-banished"]').press("Enter");
  await expect(page.locator(".banished-panel"), "replay banished pile must remain inspectable").toBeVisible();
  await page.locator('[data-action="close-banished"]').press("Enter");
  await expect(page.locator('[data-action="replay-exit"]:visible'), "replay must retain an accessible exit action").toBeVisible();

  const after = await page.evaluate(() => {
    const game = window.__riftboundGame;
    return {
      phase: game.phase,
      turnNumber: game.turnNumber,
      hand: game.players.map((player) => player.hand.length),
      trash: game.players.map((player) => player.trash.length),
      banished: game.players.map((player) => (player.banished || []).length),
      chain: game.actionChain?.chain?.length || 0
    };
  });
  expect(after).toEqual(before);
  await assertNoRuntimeOrUndefinedErrors(page, runtimeFailures);
});

test("tabletop regression source does not contain an accidental undefined interpolation", async ({ page }) => {
  await page.goto("/");
  const html = await page.locator("html").evaluate((node) => node.outerHTML);
  expect(html).not.toMatch(INVALID_RENDER_VALUE);
});
