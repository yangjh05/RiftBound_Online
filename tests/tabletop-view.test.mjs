import assert from "node:assert/strict";
import test from "node:test";

import {
  asList,
  fanCardStyle,
  safeCount,
  tabletopSeatView,
  topDiscardCard
} from "../src/ui/tabletop-view.mjs";

test("tabletop seat view normalizes an entirely undefined player", () => {
  const seat = tabletopSeatView(undefined);

  assert.equal(seat.id, "");
  assert.equal(seat.side, "bottom");
  assert.equal(seat.legend, null);
  assert.equal(seat.champion, null);
  assert.deepEqual(seat.hand, []);
  assert.deepEqual(seat.visibleHandCards, []);
  assert.deepEqual(seat.mainDeck, []);
  assert.deepEqual(seat.runeDeck, []);
  assert.deepEqual(seat.runes, []);
  assert.deepEqual(seat.trash, []);
  assert.deepEqual(seat.banished, []);
  assert.deepEqual(seat.base, []);
  assert.deepEqual(seat.runeResources, {
    energy: { usable: 0, total: 0 },
    power: { usable: 0, total: 0 }
  });
  assert.deepEqual(seat.counts, {
    hand: 0,
    mainDeck: 0,
    runeDeck: 0,
    runes: 0,
    trash: 0,
    banished: 0,
    base: 0
  });
  assert.equal(seat.xp, 0);
  assert.equal(seat.burnOuts, 0);
});

test("tabletop seat view filters sparse collections and keeps private hand data private", () => {
  const hand = [
    { instanceId: "visible", name: "Visible" },
    undefined,
    { instanceId: "redacted", name: "Secret", redacted: true }
  ];
  const player = {
    id: "p1",
    hand,
    mainDeck: "not-an-array",
    runeDeck: [null, { instanceId: "rune-deck-card" }],
    runes: undefined,
    trash: [undefined, { instanceId: "trash-card" }],
    banished: null,
    base: [{ instanceId: "base-card" }],
    xp: Number.NaN,
    burnOuts: -4
  };

  const privateSeat = tabletopSeatView(player, { side: "top", visibleHandCount: 7, revealHand: false });
  assert.equal(privateSeat.side, "top");
  assert.equal(privateSeat.counts.hand, 7);
  assert.equal(privateSeat.hand.length, 2);
  assert.deepEqual(privateSeat.visibleHandCards, []);
  assert.equal(privateSeat.counts.mainDeck, 0);
  assert.equal(privateSeat.counts.runeDeck, 1);
  assert.equal(privateSeat.counts.trash, 1);
  assert.equal(privateSeat.counts.base, 1);
  assert.equal(privateSeat.xp, 0);
  assert.equal(privateSeat.burnOuts, 0);

  const revealedSeat = tabletopSeatView(player, { side: "top", revealHand: true });
  assert.deepEqual(revealedSeat.visibleHandCards.map((card) => card.instanceId), ["visible"]);
});

test("count and fan helpers never serialize undefined, NaN, or an object string", () => {
  assert.equal(safeCount(undefined), 0);
  assert.equal(safeCount(Number.NaN, 3), 3);
  assert.equal(safeCount(-10), 0);
  assert.equal(safeCount(3.9), 3);
  assert.deepEqual(asList([null, false, { id: "card" }]), [{ id: "card" }]);
  assert.deepEqual(asList({ length: 2 }), []);

  for (const input of [
    [undefined, undefined],
    [Number.NaN, Number.NaN],
    [-10, -4],
    [0, 1],
    [4, 9]
  ]) {
    const style = fanCardStyle(input[0], input[1]);
    assert.doesNotMatch(style, /undefined|NaN|\[object Object\]/u);
    assert.match(style, /^--fan-index:\d+;--fan-count:\d+;--fan-angle:-?\d+\.\d{2}deg;--fan-rise:\d+\.\d{2}px$/u);
  }
});

test("top discard card ignores empty and sparse pile entries", () => {
  assert.equal(topDiscardCard(undefined), null);
  assert.equal(topDiscardCard([null, undefined]), null);
  assert.deepEqual(topDiscardCard([{ id: "first" }, null, { id: "last" }]), { id: "last" });
});

test("rune resource summaries preserve restricted and legacy totals without throwing", () => {
  const seat = tabletopSeatView({
    id: "p1",
    runePool: {
      energy: [
        { id: "open-energy" },
        { id: "spell-energy", restriction: "spell" },
        { id: "broken-energy", restriction: "broken" }
      ],
      power: ["Body", { id: "showdown-power", domain: "Mind", restriction: "showdown" }]
    }
  }, {
    energyUsable: (resource) => {
      if (resource.id === "broken-energy") throw new TypeError("fixture");
      return resource.restriction !== "spell";
    },
    powerUsable: (resource) => !resource.restriction
  });

  assert.deepEqual(seat.runeResources.energy, { usable: 1, total: 3 });
  assert.deepEqual(seat.runeResources.power, { usable: 1, total: 2 });
  assert.deepEqual(
    tabletopSeatView({ id: "p2", runePool: { energy: 2, power: ["Chaos"] } }).runeResources,
    { energy: { usable: 2, total: 2 }, power: { usable: 1, total: 1 } }
  );
});
