import assert from "node:assert/strict";
import test from "node:test";

import {
  TABLETOP_DRAW_STAGGER_MS,
  TABLETOP_STATE_MOTION_DURATION_MS,
  TABLETOP_STATE_MOTION_EASING,
  TABLETOP_TRANSFER_DURATION_MS,
  TABLETOP_TRANSFER_EASING,
  buildBurnOutDrawTransfers,
  buildPrivateDeckTransfers,
  buildPrivateHandBoardTransfers,
  buildPrivateHandChainTransfers,
  buildPrivateHiddenChainTransfers,
  buildTabletopTransfers,
  classifyTabletopTransfer,
  clearTabletopStateMotions,
  runTabletopStateMotionAnimations,
  tabletopStateMotionKeyframes
} from "../src/ui/tabletop-motion.mjs";

const at = (zone, locationId = "", extra = {}) => ({ playerId: "p1", zone, locationId, ...extra });

test("tabletop motion timing preserves the physical card cadence", () => {
  assert.equal(TABLETOP_TRANSFER_DURATION_MS, 280);
  assert.equal(TABLETOP_DRAW_STAGGER_MS, 82);
  assert.equal(TABLETOP_TRANSFER_EASING, "cubic-bezier(.22,.9,.2,1)");
  assert.equal(TABLETOP_STATE_MOTION_DURATION_MS, 220);
  assert.equal(TABLETOP_STATE_MOTION_EASING, "cubic-bezier(.2,.8,.2,1)");
});

test("tabletop transfer classifier distinguishes every physical game movement", () => {
  assert.equal(classifyTabletopTransfer(at("mainDeck"), at("hand")), "draw");
  assert.equal(classifyTabletopTransfer(at("mainDeck"), at("trash")), "burn");
  assert.equal(classifyTabletopTransfer(at("trash"), at("banished")), "flow");
  assert.equal(classifyTabletopTransfer(at("hand"), at("battlefield", "field-a")), "play");
  assert.equal(classifyTabletopTransfer(at("chain"), at("attachment", "unit-a")), "play");
  assert.equal(classifyTabletopTransfer(at("attachment", "unit-a"), at("battlefield", "field-a")), "move");
  assert.equal(classifyTabletopTransfer(at("attachment", "unit-a"), at("trash")), "defeat");
  assert.equal(classifyTabletopTransfer(at("base", "base"), at("battlefield", "field-a")), "move");
  assert.equal(classifyTabletopTransfer(at("battlefield", "field-a"), at("battlefield", "field-b")), "move");
  assert.equal(classifyTabletopTransfer(at("trash"), at("mainDeck")), "recycle");
  assert.equal(classifyTabletopTransfer(at("runes"), at("runeDeck")), "recycle");
});

test("same-location exhausted changes become explicit exhaust and ready state transfers", () => {
  const ready = at("battlefield", "field-a", { exhausted: false });
  const spent = at("battlefield", "field-a", { exhausted: true });
  assert.equal(classifyTabletopTransfer(ready, spent), "exhaust");
  assert.equal(classifyTabletopTransfer(spent, ready), "ready");
  assert.equal(classifyTabletopTransfer(at("legend", "", { exhausted: false }), at("legend", "", { exhausted: true })), "exhaust");
  assert.equal(classifyTabletopTransfer(at("champion", "", { exhausted: true }), at("champion", "", { exhausted: false })), "ready");
  assert.equal(classifyTabletopTransfer(ready, { ...ready }), "");

  const previous = new Map([["unit-a", ready]]);
  const current = new Map([["unit-a", spent]]);
  assert.deepEqual(buildTabletopTransfers(previous, current).map((transfer) => transfer.kind), ["exhaust"]);
  assert.deepEqual(tabletopStateMotionKeyframes(buildTabletopTransfers(previous, current)[0]), [
    { transform: "rotate(0deg) scale(1)" },
    { transform: "rotate(90deg) scale(0.76)" }
  ]);
});

function fakeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    has: (name) => values.has(name)
  };
}

function fakeAnimationLayer() {
  const listeners = new Map();
  const layer = {
    dataset: {},
    classList: fakeClassList(),
    isConnected: true,
    calls: [],
    animate(keyframes, options) {
      const animation = {
        cancelled: false,
        addEventListener(type, listener) { listeners.set(type, listener); },
        cancel() { animation.cancelled = true; listeners.get("cancel")?.(); },
        finish() { listeners.get("finish")?.(); }
      };
      layer.calls.push({ keyframes, options, animation });
      return animation;
    }
  };
  return layer;
}

function fakeCardNode(cardId, selector, layer) {
  return {
    dataset: { cardId },
    classList: fakeClassList(),
    isConnected: true,
    querySelectorAll(candidate) { return candidate === selector ? [layer] : []; }
  };
}

test("state motion targets card, rune, and attachment orientation layers and clears render-wait markers", () => {
  const cardLayer = fakeAnimationLayer();
  const identityLayer = fakeAnimationLayer();
  const runeLayer = fakeAnimationLayer();
  const attachmentLayer = fakeAnimationLayer();
  const nodes = [
    fakeCardNode("unit-a", ".card-exhaust-layer", cardLayer),
    fakeCardNode("legend-a", ".card-exhaust-layer", identityLayer),
    fakeCardNode("rune-a", ".rune-orientation-layer", runeLayer),
    fakeCardNode("gear-a", ".attachment-orientation-layer", attachmentLayer)
  ];
  const root = { querySelectorAll: (selector) => selector === "[data-card-id]" ? nodes : [] };
  const transfers = [
    { id: "unit-a", kind: "exhaust", from: at("battlefield", "field-a", { exhausted: false }), to: at("battlefield", "field-a", { exhausted: true }) },
    { id: "legend-a", kind: "exhaust", from: at("legend", "", { exhausted: false }), to: at("legend", "", { exhausted: true }) },
    { id: "rune-a", kind: "ready", from: at("runes", "", { exhausted: true }), to: at("runes", "", { exhausted: false }) },
    { id: "gear-a", kind: "exhaust", from: at("attachment", "unit-a", { exhausted: false }), to: at("attachment", "unit-a", { exhausted: true }) }
  ];
  const runs = runTabletopStateMotionAnimations(transfers, {
    root,
    reducedMotion: false,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {}
  });

  assert.equal(runs.length, 4);
  assert.equal(cardLayer.calls[0].options.duration, TABLETOP_STATE_MOTION_DURATION_MS);
  assert.equal(cardLayer.calls[0].options.easing, TABLETOP_STATE_MOTION_EASING);
  assert.equal(cardLayer.calls[0].keyframes.at(-1).transform, "rotate(90deg) scale(0.76)");
  assert.equal(identityLayer.calls[0].keyframes.at(-1).transform, "rotate(90deg) scale(0.76)");
  assert.equal(runeLayer.calls[0].keyframes.at(-1).transform, "rotate(0deg) scale(1)");
  assert.equal(attachmentLayer.calls[0].keyframes.at(-1).transform, "rotate(90deg) scale(0.68)");
  assert.equal(nodes.every((node) => node.dataset.tabletopStateMotionMarker), true);
  assert.equal(cardLayer.dataset.tabletopStateMotion, "exhaust");
  assert.equal(runeLayer.dataset.tabletopStateMotion, "ready");

  for (const layer of [cardLayer, identityLayer, runeLayer, attachmentLayer]) layer.calls[0].animation.finish();
  assert.equal(nodes.every((node) => !("tabletopStateMotionMarker" in node.dataset)), true);
  assert.equal([cardLayer, identityLayer, runeLayer, attachmentLayer].every((layer) => !("tabletopStateMotion" in layer.dataset)), true);
});

test("clearing state motion cancels WAAPI runs and removes every pending DOM marker", () => {
  const layer = fakeAnimationLayer();
  const node = fakeCardNode("unit-clear", ".card-exhaust-layer", layer);
  const markedSelector = ".tabletop-state-motion, [data-tabletop-state-motion], [data-tabletop-state-motion-marker]";
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-card-id]") return [node];
      if (selector === markedSelector) return [node, layer];
      return [];
    }
  };
  const clearedTimers = [];
  const [run] = runTabletopStateMotionAnimations([{
    id: "unit-clear",
    kind: "exhaust",
    from: at("base", "base", { exhausted: false }),
    to: at("base", "base", { exhausted: true })
  }], {
    root,
    reducedMotion: false,
    setTimeoutFn: () => 77,
    clearTimeoutFn: (timer) => clearedTimers.push(timer)
  });
  assert.equal(node.dataset.tabletopStateMotion, "exhaust");
  assert.equal(layer.dataset.tabletopStateMotionMarker != null, true);

  clearTabletopStateMotions(root);
  assert.equal(run.animation.cancelled, true);
  assert.deepEqual(clearedTimers, [77]);
  assert.equal("tabletopStateMotion" in node.dataset, false);
  assert.equal("tabletopStateMotionMarker" in layer.dataset, false);
  assert.equal(node.classList.has("tabletop-state-motion"), false);
  assert.equal(layer.classList.has("state-motion-exhaust"), false);
});

test("Burn Out recasts a visible trash-to-hand move as a privacy-preserving deck draw", () => {
  const card = {
    id: "recycled-card",
    kind: "transfer",
    from: at("trash", "", { faceVisible: true, image: "recycled.png", name: "Recycled" }),
    to: at("hand", "", { faceVisible: true, image: "recycled.png", name: "Recycled" }),
    faceVisible: true,
    image: "recycled.png",
    name: "Recycled",
    order: 0
  };
  const result = buildBurnOutDrawTransfers(
    [card],
    new Map([["p1", { burnOuts: 0, handIds: new Set() }]]),
    new Map([["p1", { burnOuts: 1, handIds: new Set([card.id]) }]]),
    new Map([[card.id, card.from]]),
    new Map([[card.id, card.to]])
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "draw");
  assert.equal(result[0].from.zone, "mainDeck");
  assert.equal(result[0].burnOut, true);
  assert.equal(result[0].faceVisible, true);
  assert.equal(result[0].image, card.image);
  assert.equal(result[0].name, card.name);
});

test("Burn Out synthesizes only an exact set of newly added face-down opponent hand aliases", () => {
  const previousPlayers = new Map([["p2", {
    burnOuts: 0,
    deckCount: 0,
    handIds: new Set(["redacted-hand-p2-0"])
  }]]);
  const currentPlayers = new Map([["p2", {
    burnOuts: 1,
    deckCount: 3,
    handIds: new Set(["redacted-hand-p2-0", "redacted-hand-p2-1", "redacted-hand-p2-2"])
  }]]);
  const previousLocations = new Map([
    ["redacted-hand-p2-0", { playerId: "p2", zone: "hand", index: 0, faceVisible: false }],
    ["public-trash-a", { playerId: "p2", zone: "trash", index: 0, faceVisible: true }]
  ]);
  const currentLocations = new Map([
    ["redacted-hand-p2-0", { playerId: "p2", zone: "hand", index: 0, faceVisible: false }],
    ["redacted-hand-p2-1", { playerId: "p2", zone: "hand", index: 1, faceVisible: false }],
    ["redacted-hand-p2-2", { playerId: "p2", zone: "hand", index: 2, faceVisible: false }],
    ["redacted-main-p2-0", { playerId: "p2", zone: "mainDeck", index: 0, faceVisible: false }]
  ]);
  const transfers = buildBurnOutDrawTransfers(
    [], previousPlayers, currentPlayers, previousLocations, currentLocations
  );
  assert.deepEqual(transfers.map((transfer) => transfer.id), ["redacted-hand-p2-1", "redacted-hand-p2-2"]);
  assert.equal(transfers.every((transfer) => transfer.kind === "draw"
    && transfer.from.zone === "mainDeck"
    && transfer.faceVisible === false
    && !transfer.image
    && !transfer.name
    && transfer.synthetic), true);

  const ambiguousPlayers = new Map([["p2", {
    burnOuts: 1,
    deckCount: 3,
    handIds: new Set(["redacted-hand-p2-0", "redacted-hand-p2-1", "redacted-hand-p2-2", "redacted-hand-p2-3"])
  }]]);
  assert.deepEqual(buildBurnOutDrawTransfers(
    [], previousPlayers, ambiguousPlayers, previousLocations, currentLocations
  ), []);
});

test("tabletop transfer builder is sparse-safe and never exposes a hidden face", () => {
  assert.deepEqual(buildTabletopTransfers(undefined, undefined), []);
  const previous = new Map([
    ["secret", at("mainDeck", "", { faceVisible: false, image: "secret.png", name: "Secret" })]
  ]);
  const current = new Map([
    ["secret", at("hand", "", { faceVisible: false, image: "", name: "", index: 2 })]
  ]);
  const [transfer] = buildTabletopTransfers(previous, current);
  assert.equal(transfer.kind, "draw");
  assert.equal(transfer.faceVisible, false);
  assert.equal(transfer.order, 2);
});

test("private opponent hand placeholders connect to newly public hand-chain cards without revealing the flight", () => {
  const placeholderId = "redacted-pending-hand-p2-0";
  const cardId = "public-chain-card";
  const previous = new Map([[placeholderId, { playerId: "p2", zone: "hand", index: 4, faceVisible: false }]]);
  const current = new Map([[cardId, { playerId: "p2", zone: "chain", locationId: "chain-1", index: 0, faceVisible: true }]]);
  const transfers = buildPrivateHandChainTransfers(
    previous,
    current,
    [],
    [{ id: "chain-1", cardId, playerId: "p2", type: "card", sourceZone: "hand", order: 0 }],
    "p1"
  );
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].fromCardId, placeholderId);
  assert.equal(transfers[0].toCardId, cardId);
  assert.equal(transfers[0].kind, "play");
  assert.equal(transfers[0].faceVisible, false);
  assert.equal(transfers[0].image, "");
});

test("private hand-chain synthesis fails closed when anonymous and public counts do not match", () => {
  const previous = new Map([
    ["redacted-pending-hand-p2-0", { playerId: "p2", zone: "hand", index: 0, faceVisible: false }],
    ["redacted-pending-hand-p2-1", { playerId: "p2", zone: "hand", index: 1, faceVisible: false }]
  ]);
  const current = new Map([["chain-card", { playerId: "p2", zone: "chain", faceVisible: true }]]);
  assert.deepEqual(buildPrivateHandChainTransfers(
    previous,
    current,
    [],
    [{ id: "chain-1", cardId: "chain-card", playerId: "p2", type: "card", sourceZone: "hand" }],
    "p1"
  ), []);
});

test("private pending hand aliases connect to newly public board cards without revealing the flight", () => {
  const placeholderId = "redacted-pending-hand-p2-0";
  const previous = new Map([[placeholderId, {
    playerId: "p2",
    zone: "hand",
    index: 3,
    faceVisible: false
  }]]);

  for (const [cardId, destination] of [
    ["public-unit", { playerId: "p2", cardType: "unit", zone: "base", locationId: "base", index: 0, faceVisible: true, image: "unit.png", name: "Unit" }],
    ["public-gear", { playerId: "p2", cardType: "gear", zone: "attachment", locationId: "public-unit", index: 0, faceVisible: true, image: "gear.png", name: "Gear" }]
  ]) {
    const transfers = buildPrivateHandBoardTransfers(previous, new Map([[cardId, destination]]), "p1");
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].fromCardId, placeholderId);
    assert.equal(transfers[0].toCardId, cardId);
    assert.equal(transfers[0].kind, "play");
    assert.equal(transfers[0].faceVisible, false);
    assert.equal(transfers[0].image, "");
    assert.equal(transfers[0].name, "");
    assert.equal(transfers[0].synthetic, true);
  }
});

test("private hand-to-board synthesis fails closed for ambiguous, hidden, own-seat, or already claimed cards", () => {
  const previous = new Map([
    ["redacted-pending-hand-p2-0", { playerId: "p2", zone: "hand", index: 0, faceVisible: false }],
    ["redacted-pending-hand-p2-1", { playerId: "p2", zone: "hand", index: 1, faceVisible: false }]
  ]);
  const oneDestination = new Map([[
    "public-unit",
    { playerId: "p2", cardType: "unit", zone: "base", locationId: "base", index: 0, faceVisible: true }
  ]]);
  assert.deepEqual(buildPrivateHandBoardTransfers(previous, oneDestination, "p1"), []);

  const onePlaceholder = new Map([[...previous.entries()][0]]);
  const twoDestinations = new Map([
    ["public-unit", { playerId: "p2", cardType: "unit", zone: "base", locationId: "base", index: 0, faceVisible: true }],
    ["public-token", { playerId: "p2", cardType: "unit", zone: "battlefield", locationId: "field-a", index: 0, faceVisible: true }]
  ]);
  assert.deepEqual(buildPrivateHandBoardTransfers(onePlaceholder, twoDestinations, "p1"), []);
  assert.deepEqual(buildPrivateHandBoardTransfers(onePlaceholder, oneDestination, "p2"), []);
  assert.deepEqual(buildPrivateHandBoardTransfers(onePlaceholder, new Map([[
    "hidden-card",
    { playerId: "p2", zone: "hidden", locationId: "field-a", index: 0, faceVisible: false }
  ]]), "p1"), []);
  assert.deepEqual(buildPrivateHandBoardTransfers(onePlaceholder, new Map([[
    "new-battlefield",
    { playerId: "p2", cardType: "battlefield", zone: "battlefield", locationId: "new-battlefield", index: 0, faceVisible: true }
  ]]), "p1"), []);
  assert.deepEqual(buildPrivateHandBoardTransfers(onePlaceholder, oneDestination, "p1", [{ id: "public-unit" }]), []);
});

test("opaque opponent deck aliases still produce private draw and burn flights", () => {
  const previous = new Map([
    ["redacted-main-p2-0", { playerId: "p2", zone: "mainDeck", index: 0, faceVisible: false }],
    ["redacted-main-p2-1", { playerId: "p2", zone: "mainDeck", index: 1, faceVisible: false }]
  ]);
  const current = new Map([
    ["redacted-hand-p2-0", { playerId: "p2", zone: "hand", index: 0, faceVisible: false }],
    ["public-trash-card", { playerId: "p2", zone: "trash", index: 0, faceVisible: true }]
  ]);
  const transfers = buildPrivateDeckTransfers(previous, current, "p1");
  assert.deepEqual(transfers.map((transfer) => transfer.kind).sort(), ["burn", "draw"]);
  assert.equal(transfers.every((transfer) => transfer.faceVisible === false && !transfer.image && !transfer.name), true);
});

test("opaque deck synthesis refuses ambiguous unmatched movements", () => {
  const previous = new Map([
    ["redacted-main-p2-0", { playerId: "p2", zone: "mainDeck", index: 0, faceVisible: false }],
    ["redacted-main-p2-1", { playerId: "p2", zone: "mainDeck", index: 1, faceVisible: false }]
  ]);
  const current = new Map([["redacted-hand-p2-0", { playerId: "p2", zone: "hand", index: 0, faceVisible: false }]]);
  assert.deepEqual(buildPrivateDeckTransfers(previous, current, "p1"), []);
});

test("opaque hand and deck aliases animate effect-played cards onto the Chain without revealing the flight", () => {
  const previous = new Map([
    ["redacted-hand-p2-2", { playerId: "p2", zone: "hand", index: 2, faceVisible: false }],
    ["redacted-main-p2-4", { playerId: "p2", zone: "mainDeck", index: 4, faceVisible: false }]
  ]);
  const current = new Map([
    ["effect-hand-card", { playerId: "p1", zone: "chain", locationId: "chain-hand", index: 0, faceVisible: true }],
    ["effect-deck-card", { playerId: "p1", zone: "chain", locationId: "chain-deck", index: 1, faceVisible: true }]
  ]);
  const transfers = buildPrivateHiddenChainTransfers(previous, current, [], [
    { id: "chain-hand", cardId: "effect-hand-card", playerId: "p1", sourcePlayerId: "p2", sourceZone: "hand", type: "card", order: 0 },
    { id: "chain-deck", cardId: "effect-deck-card", playerId: "p1", sourcePlayerId: "p2", sourceZone: "mainDeck", type: "card", order: 1 }
  ], "p1");
  assert.deepEqual(transfers.map((transfer) => transfer.fromCardId), ["redacted-hand-p2-2", "redacted-main-p2-4"]);
  assert.equal(transfers.every((transfer) => transfer.kind === "play" && transfer.faceVisible === false && !transfer.image && !transfer.name), true);
});
