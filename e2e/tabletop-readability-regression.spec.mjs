import { expect, test } from "@playwright/test";

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MAX_ALLOWED_OVERLAP_PX = 1;
const MIN_IDENTITY_HEIGHT_PX = 72;
const MIN_PORTRAIT_RATIO = 0.62;
const MAX_PORTRAIT_RATIO = 0.82;
const MIN_FUNCTIONAL_FONT_PX = 11;
const MIN_DECORATIVE_FONT_PX = 10;
const MIN_CHAIN_EFFECT_HEIGHT_PX = 112;

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
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.addInitScript(() => {
    const key = "riftbound.settings.v1";
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch {
      saved = {};
    }
    localStorage.setItem(key, JSON.stringify({ ...saved, locale: "ko" }));
  });
  await page.goto("/");
  await expect(page.locator('[data-action="menu-start"]')).toBeEnabled();
  await page.locator('[data-action="menu-start"]').click();

  for (let rollCount = 0; rollCount < 30; rollCount += 1) {
    const chooseFirst = page.locator('[data-action="choose-first-player"]:enabled');
    if (await chooseFirst.count()) {
      await chooseFirst.first().click();
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
    if (!await battlefield.count()) break;
    await battlefield.first().click();
  }
  for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
    const keepHand = page.locator('[data-action="skip-mulligan"]');
    await expect(keepHand).toHaveCount(1);
    await keepHand.click();
  }

  await expect(page.locator(".tabletop-board")).toBeVisible();
}

async function installReadabilityFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const cloneCard = (source, instanceId, ownerId, overrides = {}) => {
      const localizedName = overrides.localizedName || overrides.name || instanceId;
      const localizedText = overrides.localizedText || "가독성 검증용 카드 효과입니다.";
      const cardOverrides = { ...overrides };
      delete cardOverrides.localizedName;
      delete cardOverrides.localizedText;
      const sourceTranslations = structuredClone(source?.translations || {});
      return {
        ...structuredClone(source || {}),
        id: source?.id || instanceId,
        cardNumber: `READABILITY-${instanceId}`,
        collectorNumber: `READABILITY-${instanceId}`,
        instanceId,
        ownerId,
        controllerId: ownerId,
        name: overrides.name || source?.name || instanceId,
        translations: {
          ...sourceTranslations,
          ko: {
            ...(sourceTranslations.ko || {}),
            name: localizedName,
            text: localizedText
          }
        },
        ...cardOverrides
      };
    };
    const allCards = (player) => [
      ...player.hand,
      ...player.mainDeck,
      ...player.base,
      ...player.trash,
      ...(player.banished || [])
    ].filter(Boolean);
    const unitSource = (player) => allCards(player).find((card) => card.type === "unit") || allCards(player)[0] || player.legend;
    const gearSource = (player) => allCards(player).find((card) => card.type === "gear") || allCards(player)[0] || player.legend;
    const runeSource = (player) => player.runes[0] || player.runeDeck[0];

    game.phase = "action";
    game.currentPlayerId = game.players[0].id;
    game.turnPlayerId = game.players[0].id;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.actionChain = null;
    game.showdown = null;
    game.triggerQueue = [];
    game.selectedCardId = null;

    const fixture = { players: [], fieldUnits: [], battlefieldIds: [] };
    for (const [index, player] of game.players.entries()) {
      if (player.champion) {
        player.champion.zone = "champion";
        player.champion.exhausted = false;
        player.championPlayed = false;
      }

      const gear = cloneCard(gearSource(player), `readability-gear-${index}`, player.id, {
        type: "gear",
        name: `Readability Gear ${index + 1}`,
        localizedName: `가독성 장비 ${index + 1}`,
        might: 2,
        empoweredCount: 1,
        maxEmpowerCount: 2,
        exhausted: index === 1,
        attachments: []
      });
      const baseUnit = cloneCard(unitSource(player), `readability-base-unit-${index}`, player.id, {
        type: "unit",
        name: `Readability Base Unit ${index + 1}`,
        localizedName: `가독성 검증 기지 유닛 ${index + 1}`,
        might: 5,
        damage: index + 2,
        buffs: 2,
        mightModifier: 1,
        temporaryMight: 1,
        temporaryKeywords: ["Shield"],
        temporaryKeywordAmounts: { shield: 2 },
        cantMoveThisTurn: true,
        exhausted: index === 0,
        stunned: index === 0,
        attachments: [gear]
      });
      player.base = [baseUnit];

      const readyRune = cloneCard(runeSource(player), `readability-rune-ready-${index}`, player.id, {
        type: "rune",
        domain: runeSource(player)?.domain || "Body",
        exhausted: false
      });
      const spentRune = cloneCard(runeSource(player), `readability-rune-spent-${index}`, player.id, {
        type: "rune",
        domain: runeSource(player)?.domain || "Body",
        exhausted: true
      });
      player.runes = [readyRune, spentRune];

      const trashSource = allCards(player)[0] || player.legend;
      const banishedSource = allCards(player)[1] || trashSource;
      player.trash = [cloneCard(trashSource, `readability-trash-${index}`, player.id, {
        name: `Readability Trash ${index + 1}`,
        localizedName: `가독성 폐기 카드 ${index + 1}`
      })];
      player.banished = [cloneCard(banishedSource, `readability-banished-${index}`, player.id, {
        name: `Readability Banished ${index + 1}`,
        localizedName: `가독성 추방 카드 ${index + 1}`
      })];
      player.runePool = {
        energy: [{ id: `readability-energy-${index}`, domains: ["Any"], sourceName: "Readability Energy" }],
        power: [{ id: `readability-power-${index}`, domain: "Body", sourceName: "Readability Power" }]
      };

      fixture.players.push({
        id: player.id,
        legendId: player.legend?.instanceId || "",
        championId: player.champion?.instanceId || "",
        baseUnitId: baseUnit.instanceId,
        baseUnitName: `가독성 검증 기지 유닛 ${index + 1}`,
        baseUnitDamage: baseUnit.damage,
        baseUnitExhausted: baseUnit.exhausted,
        baseUnitStunned: baseUnit.stunned,
        gearId: gear.instanceId,
        gearMight: gear.might,
        gearExhausted: gear.exhausted,
        handCardId: player.hand[0]?.instanceId || ""
      });
    }

    for (const [fieldIndex, battlefield] of game.battlefields.entries()) {
      const battlefieldName = `가독성 검증 전장 ${fieldIndex + 1} — 충분히 읽히는 장소 제목`;
      const translations = structuredClone(battlefield.translations || {});
      battlefield.cardNumber = `READABILITY-BATTLEFIELD-${fieldIndex}`;
      battlefield.collectorNumber = `READABILITY-BATTLEFIELD-${fieldIndex}`;
      battlefield.name = battlefieldName;
      battlefield.translations = {
        ...translations,
        ko: {
          ...(translations.ko || {}),
          name: battlefieldName
        }
      };
      battlefield.hidden = [];
      battlefield.units = game.players.map((player, playerIndex) => {
        const unit = cloneCard(unitSource(player), `readability-field-unit-${fieldIndex}-${playerIndex}`, player.id, {
          type: "unit",
          name: `Readability Field Unit ${fieldIndex + 1}-${playerIndex + 1}`,
          localizedName: `가독성 검증 전장 유닛 ${fieldIndex + 1}-${playerIndex + 1}`,
          might: 4 + playerIndex,
          damage: playerIndex + 1,
          buffs: 1,
          mightModifier: 1,
          exhausted: playerIndex === 1,
          stunned: playerIndex === 0,
          attachments: []
        });
        fixture.fieldUnits.push({
          id: unit.instanceId,
          name: `가독성 검증 전장 유닛 ${fieldIndex + 1}-${playerIndex + 1}`,
          damage: unit.damage,
          exhausted: unit.exhausted,
          stunned: unit.stunned
        });
        return unit;
      });
      fixture.battlefieldIds.push(battlefield.instanceId);
    }

    window.__riftboundRender();
    return fixture;
  });
}

async function installReadableChainFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const [attacker, defender] = game.players;
    const battlefield = game.battlefields[0];
    const source = attacker.hand[0] || attacker.mainDeck[0] || attacker.legend;
    const sourceTranslations = structuredClone(source.translations || {});
    const card = {
      ...structuredClone(source),
      cardNumber: "READABILITY-CHAIN-CARD",
      collectorNumber: "READABILITY-CHAIN-CARD",
      instanceId: "readability-chain-card",
      ownerId: attacker.id,
      controllerId: attacker.id,
      name: "Readable Chain Regression",
      text: "Draw 1.\nScore 1 point.",
      translations: {
        ...sourceTranslations,
        ko: {
          ...(sourceTranslations.ko || {}),
          name: "체인 효과 가독성 검증 카드",
          text: "이 효과는 체인 창에서 출처, 대상, 처리 순서와 함께 전부 읽을 수 있어야 합니다. 긴 한국어 문장도 중간에서 잘리거나 다른 버튼에 가려지면 안 됩니다. 사용자는 효과를 확인한 뒤 정확히 하나의 패스 버튼으로 우선권을 넘길 수 있어야 합니다."
        }
      }
    };

    game.phase = "showdown";
    game.currentPlayerId = attacker.id;
    game.turnPlayerId = attacker.id;
    game.actionChain = null;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.triggerQueue = [];
    game.showdown = {
      battlefieldId: battlefield.instanceId,
      turnPlayerId: attacker.id,
      attackerId: attacker.id,
      defenderId: defender.id,
      focusPlayerId: attacker.id,
      priorityPlayerId: attacker.id,
      consecutivePasses: 0,
      chainSequence: 1,
      chainOpenedBy: "readability-regression",
      combat: true,
      chain: [{
        id: "readability-chain-item",
        itemType: "activated",
        playerId: attacker.id,
        card,
        specs: [{
          timing: "activated",
          kind: "gainPoint",
          abilityId: "score",
          amount: 1
        }],
        status: "pending"
      }]
    };
    window.__riftboundRender();
    return { cardId: card.instanceId, effectText: card.translations.ko.text, selectedAbility: "Score" };
  });
}

async function installReadableTriggerOrderFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const sources = [player.legend, player.champion].filter(Boolean);
    const triggers = sources.map((source, index) => ({
      id: `readability-trigger-order-${index}`,
      playerId: player.id,
      kind: "onPlay",
      sourceCardId: source.instanceId,
      sourceCardSnapshot: structuredClone(source),
      data: {}
    }));
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.turnPlayerId = player.id;
    game.actionChain = null;
    game.showdown = null;
    game.triggerQueue = [];
    game.pendingPayment = null;
    game.pendingChoice = {
      id: "readability-trigger-order-choice",
      playerId: player.id,
      card: player.legend,
      effect: "triggerOrder",
      prompt: "동시에 유발된 효과의 처리 순서를 선택하세요.",
      options: [
        ...triggers.map((trigger) => ({
          id: trigger.id,
          label: trigger.sourceCardSnapshot?.translations?.ko?.name || trigger.sourceCardSnapshot?.name || "트리거",
          cardId: trigger.sourceCardId,
          optionalTrigger: false,
          selected: false
        })),
        {
          id: "confirm-readability-trigger-order",
          label: "순서 확정",
          confirmTriggerOrder: true,
          disabled: true
        }
      ],
      optional: false,
      data: {
        triggerOrderState: {
          groupIndex: 0,
          groups: [{ playerId: player.id, triggers, orderedTriggers: [] }]
        }
      }
    };
    window.__riftboundRender();
    return { optionCount: triggers.length };
  });
}

async function installSnapshotOnlyTriggerFixture(page, mode) {
  return page.evaluate((chainMode) => {
    const game = window.__riftboundGame;
    const [actor, opponent] = game.players;
    const battlefield = game.battlefields[0];
    const source = actor.hand[0] || actor.mainDeck[0] || actor.legend;
    const sourceTranslations = structuredClone(source.translations || {});
    const snapshot = {
      ...structuredClone(source),
      cardNumber: "READABILITY-SNAPSHOT-SOURCE",
      collectorNumber: "READABILITY-SNAPSHOT-SOURCE",
      instanceId: "readability-snapshot-only-source",
      ownerId: actor.id,
      controllerId: actor.id,
      name: "Snapshot Trigger Source",
      text: "Snapshot-only trigger source text.",
      translations: {
        ...sourceTranslations,
        ko: {
          ...(sourceTranslations.ko || {}),
          name: "스냅샷 전용 발동원",
          text: "발동원이 이미 영역을 떠났더라도 이 카드의 실제 효과 원문과 선언된 대상을 체인에서 확인할 수 있어야 합니다."
        }
      }
    };
    const trigger = {
      id: `readability-snapshot-trigger-${chainMode}`,
      kind: "onPlay",
      playerId: actor.id,
      sourceCardId: snapshot.instanceId,
      sourceCardSnapshot: snapshot,
      targetIds: [battlefield.instanceId],
      status: "pending"
    };
    const item = {
      id: `readability-snapshot-item-${chainMode}`,
      itemType: "trigger",
      playerId: actor.id,
      card: { instanceId: trigger.id, name: trigger.kind },
      trigger,
      targetIds: [battlefield.instanceId],
      status: "pending"
    };

    game.currentPlayerId = actor.id;
    game.turnPlayerId = actor.id;
    game.pendingPayment = null;
    game.pendingChoice = null;
    game.triggerQueue = [];
    game.actionChain = null;
    game.showdown = null;
    if (chainMode === "queue") {
      game.phase = "action";
      game.triggerQueue = [trigger];
    } else if (chainMode === "action") {
      game.phase = "action";
      game.actionChain = {
        turnPlayerId: actor.id,
        priorityPlayerId: actor.id,
        playerIds: game.players.map((player) => player.id),
        consecutivePasses: 0,
        chainSequence: 1,
        chainOpenedBy: "readability-snapshot",
        chain: [item]
      };
    } else {
      game.phase = "showdown";
      game.showdown = {
        battlefieldId: battlefield.instanceId,
        turnPlayerId: actor.id,
        attackerId: actor.id,
        defenderId: opponent.id,
        focusPlayerId: actor.id,
        priorityPlayerId: actor.id,
        consecutivePasses: 0,
        chainSequence: 1,
        chainOpenedBy: "readability-snapshot",
        combat: true,
        chain: [item]
      };
    }
    window.__riftboundRender();
    return {
      sourceId: snapshot.instanceId,
      sourceName: snapshot.translations.ko.name,
      effectText: snapshot.translations.ko.text,
      targetName: battlefield.translations?.ko?.name || battlefield.name
    };
  }, mode);
}

async function installReadablePaymentFixture(page) {
  return page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const card = player.hand[0] || player.mainDeck[0] || player.legend;
    const readyRune = player.runes.find((rune) => !rune.exhausted) || player.runes[0];
    if (readyRune) readyRune.exhausted = false;
    if (player.runePool?.power?.[0]) player.runePool.power[0].domain = readyRune?.domain || "Any";
    if (player.runePool?.energy && !player.runePool.energy.some((resource) => resource?.id === "readability-legacy-energy")) {
      player.runePool.energy.push({ id: "readability-legacy-energy", domains: null });
    }
    game.pendingChoice = null;
    game.pendingPayment = {
      id: "readability-payment",
      playerId: player.id,
      cardId: card.instanceId,
      cardName: card.name,
      source: "playCard",
      destination: "base",
      energyCost: 2,
      basePowerCost: [],
      powerCost: [{ domain: readyRune?.domain || "Any", amount: 1 }],
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
    return { playerId: player.id, runeId: readyRune?.instanceId || "" };
  });
}

function overlapDepth(first, second) {
  return {
    x: Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)),
    y: Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y))
  };
}

function expectNoVisualOverlap(first, second, label) {
  const overlap = overlapDepth(first, second);
  expect.soft(
    overlap.x <= MAX_ALLOWED_OVERLAP_PX || overlap.y <= MAX_ALLOWED_OVERLAP_PX,
    `${label} overlaps by ${overlap.x.toFixed(2)}×${overlap.y.toFixed(2)}px`
  ).toBe(true);
}

function expectContained(inner, outer, label) {
  expect.soft(inner.x, `${label} clips on the left`).toBeGreaterThanOrEqual(outer.x - MAX_ALLOWED_OVERLAP_PX);
  expect.soft(inner.y, `${label} clips on the top`).toBeGreaterThanOrEqual(outer.y - MAX_ALLOWED_OVERLAP_PX);
  expect.soft(inner.x + inner.width, `${label} clips on the right`).toBeLessThanOrEqual(outer.x + outer.width + MAX_ALLOWED_OVERLAP_PX);
  expect.soft(inner.y + inner.height, `${label} clips on the bottom`).toBeLessThanOrEqual(outer.y + outer.height + MAX_ALLOWED_OVERLAP_PX);
}

async function visibleBox(locator, label) {
  await expect(locator, `${label} must be visible`).toBeVisible();
  let box = null;
  await expect.poll(async () => {
    box = await locator.boundingBox();
    return Boolean(box);
  }, { message: `${label} must have stable measurable geometry` }).toBe(true);
  return box;
}

async function assertNoLiteralInvalidValues(page, runtimeFailures) {
  await expect(page.locator(".ui-exception-banner")).toHaveCount(0);
  const invalidValues = await page.locator("body").evaluate((body) => {
    const invalid = /(?:^|\W)undefined(?:\W|$)|(?:^|\W)NaN(?:\W|$)|\[object Object\]/iu;
    const badAttributes = [...body.querySelectorAll(".tabletop-layout, .tabletop-layout *")]
      .flatMap((element) => [...element.attributes]
        .filter((attribute) => invalid.test(attribute.value))
        .map((attribute) => `${element.tagName.toLowerCase()}.${element.className || ""} ${attribute.name}=${attribute.value}`));
    return {
      text: invalid.exec(body.innerText)?.[0] || "",
      attributes: badAttributes
    };
  });
  expect(invalidValues.text).toBe("");
  expect(invalidValues.attributes).toEqual([]);
  expect(runtimeFailures).toEqual([]);
}

async function assertDesktopTypography(page) {
  const contracts = [
    { selector: ".tabletop-topbar .status-detail", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".table-seat .player-summary h2", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".table-seat .player-stats > *", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".table-card-pile .pile-label", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".table-card-pile .pile-count", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".rune-summary .rune-count", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".rune-card-chip .rune-card-caption", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".battlefield-head h2", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".battlefield-head span", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".unit-board-overlay .unit-current-might", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".unit-board-overlay .unit-remaining-health", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".unit-state-badge", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".context-action-dock .action-context .bar-label", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".context-action-dock .action-context strong", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".context-action-dock .action-context span:last-child", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".table-action-rail button", minimum: MIN_FUNCTIONAL_FONT_PX },
    { selector: ".identity-zone > .zone-caption", minimum: MIN_DECORATIVE_FONT_PX },
    { selector: ".base-zone > .zone-caption", minimum: MIN_DECORATIVE_FONT_PX },
    { selector: ".field-lane .lane-label", minimum: MIN_DECORATIVE_FONT_PX }
  ];

  const violations = await page.evaluate((rules) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    return rules.flatMap(({ selector, minimum }) => {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      if (!nodes.length) return [`${selector}: no visible element`];
      return nodes.flatMap((node) => {
        const size = Number.parseFloat(getComputedStyle(node).fontSize);
        return size + 0.01 < minimum
          ? [`${selector}: ${size.toFixed(2)}px < ${minimum}px (${node.textContent.trim().slice(0, 40)})`]
          : [];
      });
    });
  }, contracts);
  expect.soft(violations, `desktop typography violations:\n${violations.join("\n")}`).toEqual([]);

  const inheritedViolations = await page.evaluate(({ functionalMinimum, decorativeMinimum }) => {
    const root = document.querySelector(".tabletop-layout");
    if (!root) return [".tabletop-layout: missing"];
    const decorativeSelector = ".zone-caption, .zone-label, .lane-label";
    const ignoredSelector = "[aria-hidden='true'], .sr-only, .visually-hidden";
    const candidates = [...root.querySelectorAll("button, label, h1, h2, h3, h4, p, strong, b, em, small, span")];
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight;
    };
    return candidates.flatMap((element) => {
      if (!visible(element) || element.closest(ignoredSelector)) return [];
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .trim();
      if (!ownText) return [];
      const minimum = element.closest(decorativeSelector) ? decorativeMinimum : functionalMinimum;
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (Number.isFinite(size) && size + 0.01 >= minimum) return [];
      const identity = [element.tagName.toLowerCase(), ...element.classList].join(".");
      return [`${identity}: ${Number.isFinite(size) ? size.toFixed(2) : "invalid"}px < ${minimum}px (${ownText.slice(0, 40)})`];
    });
  }, {
    functionalMinimum: MIN_FUNCTIONAL_FONT_PX,
    decorativeMinimum: MIN_DECORATIVE_FONT_PX
  });
  expect.soft(inheritedViolations, `resolved desktop typography violations:\n${inheritedViolations.join("\n")}`).toEqual([]);
}

async function assertIdentityGeometry(page) {
  const identityCards = page.locator('.table-seat :is([data-zone="legend"], [data-zone="champion"]) .identity-button');
  await expect(identityCards).toHaveCount(4);
  const violations = await identityCards.evaluateAll((cards, limits) => cards.flatMap((card) => {
    const rect = card.getBoundingClientRect();
    const ratio = rect.width / Math.max(1, rect.height);
    const zone = card.closest("[data-zone]")?.getAttribute("data-zone") || "identity";
    const seat = card.closest("[data-player-id]")?.getAttribute("data-player-id") || "unknown";
    const errors = [];
    if (rect.height + 0.01 < limits.minimumHeight) errors.push(`${seat}/${zone}: height ${rect.height.toFixed(2)}px`);
    if (ratio < limits.minimumRatio || ratio > limits.maximumRatio) errors.push(`${seat}/${zone}: ratio ${ratio.toFixed(3)}`);
    return errors;
  }), {
    minimumHeight: MIN_IDENTITY_HEIGHT_PX,
    minimumRatio: MIN_PORTRAIT_RATIO,
    maximumRatio: MAX_PORTRAIT_RATIO
  });
  expect.soft(violations, `identity geometry violations:\n${violations.join("\n")}`).toEqual([]);
}

async function assertCardStateContract(page, card) {
  const locator = page.locator(`[data-card-id="${card.id}"]`).first();
  await expect(locator).toBeVisible();
  await expect(locator).toHaveClass(/physical-board-card/u);
  await expect(locator).toHaveAttribute("data-current-might", /^-?\d+$/u);
  await expect(locator).toHaveAttribute("data-remaining-health", /^\d+$/u);
  await expect(locator).toHaveAttribute("data-damage", String(card.damage));
  await expect(locator).toHaveAttribute("data-exhausted", String(card.exhausted));
  await expect(locator).toHaveAttribute("data-stunned", String(card.stunned));
  await expect(locator).toHaveAttribute("aria-label", new RegExp(card.name, "iu"));
  await expect(locator).toHaveAttribute("aria-label", card.exhausted ? /탈진|Exhausted/iu : /준비|Ready/iu);
  await expect(locator).toHaveAttribute("title", card.exhausted ? /탈진|Exhausted/iu : /준비|Ready/iu);
  const face = locator.locator(":scope > .card-exhaust-layer > .card-face-layer");
  await expect(face).toBeVisible();
  const overlay = face.locator(":scope > .unit-board-overlay");
  await expect(overlay).toBeVisible();
  const currentMight = await locator.getAttribute("data-current-might");
  const remainingHealth = await locator.getAttribute("data-remaining-health");
  await expect(overlay.locator(":scope > .unit-current-might")).toHaveText(String(currentMight));
  await expect(overlay.locator(":scope > .unit-remaining-health")).toHaveText(String(remainingHealth));
  await expect(face).not.toContainText(/준비|탈진|Ready|Exhausted/iu);
  await expect(locator.locator(".primary-card-state, .card-state-hud.unit-stats")).toHaveCount(0);
  const secondaryStatuses = overlay.locator(":scope > .unit-state-badges");
  await expect(secondaryStatuses).toBeVisible();
  await expect(secondaryStatuses).toHaveAttribute("aria-label", /\S/u);
  if (card.stunned) await expect(secondaryStatuses).toHaveAttribute("aria-label", /기절|Stunned/iu);
  await expect(locator.locator(".owner-chip")).toBeVisible();

  const clipping = await face.evaluate((cardFace) => ({
    clientWidth: cardFace.clientWidth,
    scrollWidth: cardFace.scrollWidth,
    clientHeight: cardFace.clientHeight,
    scrollHeight: cardFace.scrollHeight
  }));
  expect(clipping.scrollWidth, `${card.id} card-face overlay must not clip horizontally`).toBeLessThanOrEqual(clipping.clientWidth + 1);
  expect(clipping.scrollHeight, `${card.id} card-face overlay must not clip vertically`).toBeLessThanOrEqual(clipping.clientHeight + 1);
}

test("desktop tabletop reserves readable identity, board, command, hand, battlefield, and state regions", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installReadabilityFixture(page);

  await assertIdentityGeometry(page);
  await assertDesktopTypography(page);

  const board = await visibleBox(page.locator(".board-panel"), "board region");
  const command = await visibleBox(page.locator(".context-action-dock"), "command region");
  const hand = await visibleBox(page.locator(".persistent-hand.hand-drawer"), "hand region");
  expectNoVisualOverlap(board, command, "board and command regions");
  expectNoVisualOverlap(board, hand, "board and hand regions");
  expectNoVisualOverlap(command, hand, "command and hand regions");

  for (const battlefieldId of fixture.battlefieldIds) {
    const battlefield = page.locator(`.battlefield[data-card-id="${battlefieldId}"]`);
    const center = await visibleBox(battlefield.locator(".field-center"), `${battlefieldId} center`);
    const image = await visibleBox(battlefield.locator(".field-image"), `${battlefieldId} image`);
    const title = await visibleBox(battlefield.locator(".battlefield-head"), `${battlefieldId} title`);
    expectNoVisualOverlap(image, title, `${battlefieldId} image and title`);
    expectContained(image, center, `${battlefieldId} image`);
    expectContained(title, center, `${battlefieldId} title`);

    const presentation = await battlefield.evaluate((root) => {
      const art = root.querySelector(".field-image .card-art");
      const heading = root.querySelector(".battlefield-head h2");
      return {
        objectFit: art ? getComputedStyle(art).objectFit : "",
        headingClientWidth: heading?.clientWidth || 0,
        headingScrollWidth: heading?.scrollWidth || 0,
        headingClientHeight: heading?.clientHeight || 0,
        headingScrollHeight: heading?.scrollHeight || 0
      };
    });
    expect.soft(["contain", "scale-down"], `${battlefieldId} art must preserve the whole card`).toContain(presentation.objectFit);
    expect.soft(presentation.headingScrollWidth, `${battlefieldId} title must not be ellipsized`).toBeLessThanOrEqual(presentation.headingClientWidth + 1);
    expect.soft(presentation.headingScrollHeight, `${battlefieldId} title must not be vertically clipped`).toBeLessThanOrEqual(presentation.headingClientHeight + 1);
  }

  for (const fieldUnit of fixture.fieldUnits) {
    const unit = page.locator(`[data-card-id="${fieldUnit.id}"]`).first();
    const lane = unit.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' field-lane ')][1]");
    const unitBox = await visibleBox(unit, `${fieldUnit.id} card`);
    const laneBox = await visibleBox(lane, `${fieldUnit.id} lane`);
    expectContained(unitBox, laneBox, `${fieldUnit.id} card inside its battlefield lane`);
    await assertCardStateContract(page, fieldUnit);
  }

  for (const player of fixture.players) {
    await assertCardStateContract(page, {
      id: player.baseUnitId,
      name: player.baseUnitName,
      damage: player.baseUnitDamage,
      exhausted: player.baseUnitExhausted,
      stunned: player.baseUnitStunned
    });
    const gear = page.locator(`[data-card-id="${player.gearId}"]`).first();
    await expect(gear, `${player.gearId} attachment must remain visible`).toBeVisible();
    await expect(gear).toHaveAttribute("data-current-might", String(player.gearMight));
    await expect(gear).toHaveAttribute("data-exhausted", String(player.gearExhausted));
    await expect(gear).toHaveAttribute("title", player.gearExhausted ? /탈진|Exhausted/iu : /준비|Ready/iu);
    await expect(gear.locator(".attached-gear-board-overlay .attached-gear-might")).toHaveCount(0);
    await expect(gear.locator(".attached-gear-board-overlay .unit-state-badges")).toBeVisible();
    await expect(gear.locator(".attached-gear-state, .attached-gear-readiness")).toHaveCount(0);
    await expect(gear).not.toContainText(/준비|탈진|Ready|Exhausted/iu);
  }

  const detailGear = page.locator(`[data-card-id="${fixture.players[0].gearId}"]`).first();
  await detailGear.click();
  const gearInspector = page.locator(".inspector.inspector-panel");
  await expect(gearInspector).toBeVisible();
  await expect(gearInspector.locator(".inspector-text > strong")).toContainText(`위력 ${fixture.players[0].gearMight}`);

  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("inspector, trash, and banished panes never cover the command row or permanent hand", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);

  const commandLocator = page.locator(".context-action-dock");
  const handLocator = page.locator(".persistent-hand.hand-drawer");
  const bottomSeat = page.locator('.table-seat[data-side="bottom"]');
  const handCard = page.locator('.persistent-hand.hand-drawer [data-hand-card]').first();
  await handCard.click();

  const inspector = page.locator(".inspector.inspector-panel");
  if (!await inspector.isVisible()) {
    await page.locator('[data-action="toggle-inspector"]:visible:not([disabled])').first().click();
  }
  const inspectorBox = await visibleBox(inspector, "inspector pane");
  expectNoVisualOverlap(inspectorBox, await visibleBox(commandLocator, "command row"), "inspector and command row");
  expectNoVisualOverlap(inspectorBox, await visibleBox(handLocator, "permanent hand"), "inspector and permanent hand");

  await bottomSeat.locator('[data-action="toggle-graveyard"]').click();
  const trash = page.locator(".graveyard-panel:not(.banished-panel)");
  const trashBox = await visibleBox(trash, "trash pane");
  expectNoVisualOverlap(trashBox, await visibleBox(commandLocator, "command row"), "trash pane and command row");
  expectNoVisualOverlap(trashBox, await visibleBox(handLocator, "permanent hand"), "trash pane and permanent hand");
  await trash.locator('[data-action="close-graveyard"]').click();

  await bottomSeat.locator('[data-action="toggle-banished"]').click();
  const banished = page.locator(".banished-panel");
  const banishedBox = await visibleBox(banished, "banished pane");
  expectNoVisualOverlap(banishedBox, await visibleBox(commandLocator, "command row"), "banished pane and command row");
  expectNoVisualOverlap(banishedBox, await visibleBox(handLocator, "permanent hand"), "banished pane and permanent hand");

  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("an active Chain keeps its full effect readable and exposes exactly one enabled pass action", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);
  const chain = await installReadableChainFixture(page);

  const item = page.locator(`.chain-zone-item.chain-zone-active[data-card-id="${chain.cardId}"]`);
  await visibleBox(item, "active Chain item");

  const effect = item.locator(".chain-active-effect-text");
  const effectBox = await visibleBox(effect, "active Chain effect");
  expect.soft(effectBox.height, "active Chain effect must reserve readable vertical space").toBeGreaterThanOrEqual(MIN_CHAIN_EFFECT_HEIGHT_PX - MAX_ALLOWED_OVERLAP_PX);
  await expect(effect).toContainText(chain.effectText);
  await expect(effect.locator(".chain-selected-ability")).toContainText(chain.selectedAbility);
  const effectVisibility = await effect.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
  }));
  expect.soft(effectVisibility.fontSize).toBeGreaterThanOrEqual(MIN_FUNCTIONAL_FONT_PX);
  expect.soft(effectVisibility.scrollWidth, "Chain effect must not clip horizontally").toBeLessThanOrEqual(effectVisibility.clientWidth + 1);
  expect.soft(effectVisibility.scrollHeight, "Chain effect must not be line-clamped or clipped").toBeLessThanOrEqual(effectVisibility.clientHeight + 1);

  const activePassButtons = page.locator('button[data-action="pass-showdown"]:visible:not([disabled])');
  const activePassCount = await activePassButtons.count();
  expect.soft(activePassCount, "only one visible enabled pass-showdown action may exist").toBe(1);
  if (activePassCount > 0) await expect(activePassButtons.first()).toBeInViewport();

  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("an active Chain floats over the board center without covering right-side sheets or actions", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);
  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const selected = player.hand[0] || player.base[0] || player.legend;
    game.selectedCardId = selected?.instanceId || null;
    window.__riftboundRender();
  });

  const clearChain = () => page.evaluate(() => {
    const game = window.__riftboundGame;
    game.phase = "action";
    game.actionChain = null;
    game.showdown = null;
    game.triggerQueue = [];
    window.__riftboundRender();
  });
  const assertFloatingChain = async (panel, label, existingChain = null) => {
    const chain = existingChain || await installReadableChainFixture(page);
    const chainPanel = page.locator(".chain-pod");
    const chainItem = page.locator(`.chain-zone-item[data-card-id="${chain.cardId}"]`);
    const chainBox = await visibleBox(chainPanel, `Chain with ${label}`);
    const panelBox = await visibleBox(panel, label);
    const railBox = await visibleBox(page.locator(".table-action-rail"), "right action rail");
    const boardBox = await visibleBox(page.locator(".tabletop-board"), "tabletop board");
    expectNoVisualOverlap(chainBox, panelBox, `Chain and ${label}`);
    expectNoVisualOverlap(chainBox, railBox, "Chain and right action rail");
    expectNoVisualOverlap(panelBox, railBox, `${label} and right action rail`);
    expectContained(chainBox, boardBox, "Chain inside tabletop board");
    const availableCenter = boardBox.x + (railBox.x - boardBox.x) / 2;
    const chainCenter = chainBox.x + chainBox.width / 2;
    expect.soft(Math.abs(chainCenter - availableCenter), "Chain must be centered in the board area left of the action rail").toBeLessThanOrEqual(12);
    await expect(chainItem, `Chain item must remain visible with ${label}`).toBeVisible();
  };

  await clearChain();
  const inspectorChain = await installReadableChainFixture(page);
  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const selected = player.hand[0] || player.base[0] || player.legend;
    game.selectedCardId = selected?.instanceId || null;
    window.__riftboundRender();
  });
  await page.locator('.table-action-rail [data-action="toggle-inspector"]:not([disabled])').click();
  const inspector = page.locator(".inspector.inspector-panel");
  await assertFloatingChain(inspector, "Card Info", inspectorChain);
  await inspector.locator('[data-action="toggle-inspector"]').click();

  await clearChain();
  const logChain = await installReadableChainFixture(page);
  await page.locator('.tabletop-topbar [data-action="toggle-log"]').click();
  const log = page.locator(".log-drawer");
  await assertFloatingChain(log, "log", logChain);
  await log.locator('[data-action="toggle-log"]').click();

  await clearChain();
  const bottomSeat = page.locator('.table-seat[data-side="bottom"]');
  await bottomSeat.locator('[data-action="toggle-graveyard"]').click();
  const trash = page.locator(".graveyard-panel:not(.banished-panel)");
  await assertFloatingChain(trash, "Trash");
  await trash.locator('[data-action="close-graveyard"]').click();

  await clearChain();
  await bottomSeat.locator('[data-action="toggle-banished"]').click();
  const banished = page.locator(".banished-panel");
  await assertFloatingChain(banished, "Banished");
  await banished.locator('[data-action="close-banished"]').click();

  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("complex trigger-order choices float over the board without covering the right action rail", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);
  const fixture = await installReadableTriggerOrderFixture(page);

  const panel = page.locator(".floating-panels.has-blocking-decision > .trigger-order-panel");
  const panelBox = await visibleBox(panel, "trigger-order choice panel");
  const railBox = await visibleBox(page.locator(".table-action-rail"), "right action rail");
  const boardBox = await visibleBox(page.locator(".tabletop-board"), "tabletop board");
  expectNoVisualOverlap(panelBox, railBox, "trigger-order panel and right action rail");
  expectContained(panelBox, boardBox, "trigger-order panel inside tabletop board");
  const availableCenter = boardBox.x + (railBox.x - boardBox.x) / 2;
  const panelCenter = panelBox.x + panelBox.width / 2;
  expect.soft(Math.abs(panelCenter - availableCenter), "trigger-order panel must be centered in the board area left of the action rail").toBeLessThanOrEqual(12);
  await expect(panel.locator(".trigger-order-option")).toHaveCount(fixture.optionCount);
  await expect(panel.locator(".trigger-order-effect")).toHaveCount(fixture.optionCount);
  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("snapshot-only triggers retain their source, full text, and target in every Chain path", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);

  for (const mode of ["queue", "action", "showdown"]) {
    const expected = await installSnapshotOnlyTriggerFixture(page, mode);
    const item = page.locator(`.chain-zone-item[data-card-id="${expected.sourceId}"]`);
    await expect(item, `${mode} snapshot trigger must render`).toBeVisible();
    await expect(item.locator(".chain-zone-copy > strong")).toContainText(expected.sourceName);
    await expect(item.locator(".chain-zone-source")).toContainText(expected.sourceName);
    await expect(item.locator(".chain-zone-target")).toContainText(expected.targetName);
    await expect(item.locator(".chain-active-effect-text, .chain-zone-effect")).toContainText(expected.effectText);
    await assertNoLiteralInvalidValues(page, runtimeFailures);
  }
});

test("a Chain item stays visible through a resolving card choice and clears only after resolution", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);
  const chain = await installReadableChainFixture(page);
  await expect(page.locator(`.chain-zone-item[data-card-id="${chain.cardId}"]`)).toBeVisible();

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    const item = game.showdown.chain[0];
    game.showdown.chain = [];
    game.pendingChoice = {
      id: "readability-resolving-choice",
      playerId: item.playerId,
      card: structuredClone(item.card),
      effect: "genericChoice",
      prompt: "Choose while this Chain item resolves.",
      options: [{ id: "continue", label: "Continue" }],
      optional: false,
      data: {},
      fromShowdownChain: true,
      gameEffectResolution: {
        context: { chainKind: "showdown", pendingTriggerBatches: [], finalized: false }
      }
    };
    window.__riftboundRender();
  });

  const resolving = page.locator(`.chain-zone-item.status-resolving[data-card-id="${chain.cardId}"]`);
  await expect(resolving).toBeVisible();
  await expect(resolving.locator(".chain-zone-copy > strong")).toContainText("체인 효과 가독성 검증 카드");

  await page.evaluate(() => {
    const game = window.__riftboundGame;
    game.pendingChoice = null;
    game.triggerQueue = [];
    game.triggerQueueContinuation = null;
    delete game.resolvingChainContext;
    delete game.resolvingGameEffect;
    window.__riftboundRender();
  });
  await expect(page.locator(`.chain-zone-item[data-card-id="${chain.cardId}"]`)).toHaveCount(0);
  await expect(page.locator(".chain-zone .response-prompt")).toBeVisible();
  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("Chain and in-board payment keep the playmat, right actions, and direct Rune controls accessible", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  const fixture = await installReadabilityFixture(page);
  await installReadableChainFixture(page);

  for (const viewport of [{ width: 1280, height: 720 }, DESKTOP_VIEWPORT]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.__riftboundRender());

    const mat = page.locator(".battlefield-mat");
    const matBox = await visibleBox(mat, `${viewport.width} battlefield mat`);
    const matOverflow = await mat.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect.soft(matOverflow.scrollWidth, `${viewport.width} battlefield mat must not require horizontal scrolling`).toBeLessThanOrEqual(matOverflow.clientWidth + 1);
    expect.soft(matOverflow.scrollHeight, `${viewport.width} battlefield mat must not clip a lane vertically`).toBeLessThanOrEqual(matOverflow.clientHeight + 1);

    for (const battlefieldId of fixture.battlefieldIds) {
      const battlefieldBox = await visibleBox(
        page.locator(`.battlefield[data-card-id="${battlefieldId}"]`),
        `${viewport.width} ${battlefieldId}`
      );
      expectContained(battlefieldBox, matBox, `${viewport.width} ${battlefieldId} inside playmat`);
    }
    for (const fieldUnit of fixture.fieldUnits) {
      const unitBox = await visibleBox(page.locator(`[data-card-id="${fieldUnit.id}"]`).first(), `${viewport.width} ${fieldUnit.id}`);
      expectContained(unitBox, matBox, `${viewport.width} ${fieldUnit.id} inside playmat`);
    }

    const chainBox = await visibleBox(page.locator(".chain-pod"), `${viewport.width} Chain panel`);
    const boardBoxWithChain = await visibleBox(page.locator(".tabletop-board"), `${viewport.width} tabletop board`);
    const railBox = await visibleBox(page.locator(".table-action-rail"), `${viewport.width} right action rail`);
    expectContained(chainBox, boardBoxWithChain, `${viewport.width} Chain inside tabletop board`);
    expectNoVisualOverlap(chainBox, railBox, `${viewport.width} Chain and right action rail`);

    const paymentFixture = await installReadablePaymentFixture(page);
    const payment = page.locator(".payment-stage-banner");
    const paymentBox = await visibleBox(payment, `${viewport.width} payment stage`);
    const boardBox = await visibleBox(page.locator(".tabletop-board"), `${viewport.width} board with payment`);
    expectContained(paymentBox, boardBox, `${viewport.width} payment stage inside board`);
    await expect(payment).toContainText(/비용 지불 단계|PAYMENT STEP/u);
    await expect(page.locator(".floating-panels > .payment-panel")).toHaveCount(0);
    await expect(page.locator(".pay-rune")).toHaveCount(0);

    const directRune = page.locator(`[data-direct-payment-rune="true"][data-rune="${paymentFixture.runeId}"]`);
    const generatedEnergy = page.locator('[data-action="pay-pool-energy"]').first();
    const generatedPower = page.locator('[data-action="pay-pool-power"]').first();
    await expect(directRune).toBeVisible();
    await expect(directRune).toHaveClass(/can-pay-energy/u);
    await expect(directRune).toHaveClass(/can-pay-power/u);
    await expect(generatedEnergy).toBeVisible();
    await expect(generatedPower).toBeVisible();
    await generatedEnergy.click();
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.poolEnergyIds.length)).toBe(1);
    await directRune.click();
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.energyRuneIds.length)).toBe(1);
    await generatedPower.click();
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.poolPowerIds.length)).toBe(1);
    await expect(page.locator('[data-action="confirm-payment"]')).toBeEnabled();
    await generatedPower.click();
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.poolPowerIds.length)).toBe(0);
    const rerenderedRune = page.locator(`[data-direct-payment-rune="true"][data-rune="${paymentFixture.runeId}"]`);
    await rerenderedRune.click({ button: "right" });
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.powerRuneIds.length)).toBe(1);
    await page.locator('[data-action="cancel-payment"]').click();
    await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment)).toBeNull();
  }

  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("Legend and Seal resource abilities remain usable inside the in-board payment step", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);
  const fixture = await page.evaluate(() => {
    const game = window.__riftboundGame;
    const player = game.players[0];
    const paidCard = player.hand[0] || player.mainDeck[0];
    const legend = player.legend;
    legend.controllerId = player.id;
    legend.ownerId = player.id;
    legend.exhausted = false;
    legend.effects = [{
      timing: "activated",
      exhaust: true,
      kind: "addEnergy",
      amount: 1,
      domains: ["Any"],
      restriction: null,
      nonReactive: true,
      abilityKeywords: ["Reaction"]
    }];

    const sealSeed = player.base[0] || player.hand[1] || paidCard;
    const seal = {
      ...structuredClone(sealSeed),
      instanceId: "readability-payment-seal",
      cardNumber: "READABILITY-PAYMENT-SEAL",
      collectorNumber: "READABILITY-PAYMENT-SEAL",
      ownerId: player.id,
      controllerId: player.id,
      type: "gear",
      name: "Seal of Strength",
      exhausted: false,
      attachedToId: null,
      attachments: [],
      effects: [{
        timing: "activated",
        exhaust: true,
        kind: "addPower",
        amount: 1,
        domain: "Body",
        restriction: null,
        nonReactive: true,
        abilityKeywords: ["Reaction"]
      }],
      translations: {
        ...(structuredClone(sealSeed?.translations || {})),
        ko: { name: "힘의 문장", text: "탈진: 신체 힘 1을 추가합니다." }
      }
    };
    player.base.push(seal);
    player.runePool = { energy: [], power: [] };
    player.cardsPlayedThisTurn = Math.max(1, player.cardsPlayedThisTurn || 0);
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.turnPlayerId = player.id;
    game.actionChain = null;
    game.showdown = null;
    game.pendingChoice = null;
    game.pendingPayment = {
      id: "readability-source-payment",
      playerId: player.id,
      cardId: paidCard.instanceId,
      cardName: paidCard.name,
      source: "playCard",
      destination: "base",
      energyCost: 1,
      basePowerCost: [{ domain: "Body", amount: 1 }],
      powerCost: [{ domain: "Body", amount: 1 }],
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
    return { legendId: legend.instanceId, sealId: seal.instanceId };
  });

  const legendResource = page.locator(`[data-action="activate-card"][data-card="${fixture.legendId}"]`);
  const sealResource = page.locator(`[data-action="activate-card"][data-card="${fixture.sealId}"]`);
  await expect(legendResource).toBeVisible();
  await expect(sealResource).toBeVisible();

  await legendResource.click();
  await expect.poll(() => page.evaluate(() => ({
    pending: Boolean(window.__riftboundGame.pendingPayment),
    energy: window.__riftboundGame.players[0].runePool.energy.length
  }))).toEqual({ pending: true, energy: 1 });
  const generatedEnergy = page.locator('[data-action="pay-pool-energy"]').first();
  await expect(generatedEnergy).toContainText(/에너지|Energy/u);
  await generatedEnergy.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.poolEnergyIds.length)).toBe(1);

  await sealResource.click();
  await expect.poll(() => page.evaluate(() => ({
    pending: Boolean(window.__riftboundGame.pendingPayment),
    power: window.__riftboundGame.players[0].runePool.power.length
  }))).toEqual({ pending: true, power: 1 });
  const generatedPower = page.locator('[data-action="pay-pool-power"]').first();
  await expect(generatedPower).toContainText(/힘|Power/u);
  await expect(generatedPower).toContainText(/문장|Seal/u);
  await generatedPower.click();
  await expect.poll(() => page.evaluate(() => window.__riftboundGame.pendingPayment.poolPowerIds.length)).toBe(1);
  await expect(page.locator('[data-action="confirm-payment"]')).toBeEnabled();
  await assertNoLiteralInvalidValues(page, runtimeFailures);
});

test("rich board and Chain fixtures never render invalid placeholders or runtime errors", async ({ page }) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await openReadyBoard(page);
  await installReadabilityFixture(page);
  await assertNoLiteralInvalidValues(page, runtimeFailures);
  await installReadableChainFixture(page);
  await assertNoLiteralInvalidValues(page, runtimeFailures);
});
