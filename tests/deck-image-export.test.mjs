import test from "node:test";
import assert from "node:assert/strict";
import { cards, makeRune, rawDecklists } from "../src/cards.mjs";
import { deckImageChampionCandidates, deckImageFilename, deckImageLayout, deckImageModel, sortDeckImageCards } from "../src/decks/image-export.mjs";
import { createDeckCardImageHandler, deckCardImageSource } from "../server/deck-card-images.mjs";

const byNumber = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
const options = { cardByNumber: (number) => byNumber.get(number), runeByKey: makeRune, locale: "ko" };

test("export presets prioritize type, numeric cost or domain and keep copies together without mutating the deck", () => {
  const fixture = [
    { cardNumber: "spell", name: "Spell", type: "spell", energy: 1, domains: ["Fury"] },
    { cardNumber: "unit-10", name: "Unit Ten", type: "unit", energy: 10, domains: ["Calm"] },
    { cardNumber: "gear", name: "Gear", type: "gear", energy: 0, domains: ["Mind"] },
    { cardNumber: "unit-2", name: "Unit Two", type: "unit", energy: 2, domains: ["Chaos"] }
  ];
  const input = [...fixture, fixture[3]];
  const original = structuredClone(input);
  const ids = (sort) => sortDeckImageCards(input, sort).map((card) => card.cardNumber);
  assert.deepEqual(ids("type"), ["unit-2", "unit-2", "unit-10", "gear", "spell"]);
  assert.deepEqual(ids("cost"), ["gear", "spell", "unit-2", "unit-2", "unit-10"]);
  assert.deepEqual(ids("domain"), ["spell", "unit-10", "gear", "unit-2", "unit-2"]);
  assert.deepEqual(ids("unknown"), ids("type"));
  assert.deepEqual(input, original);
  const lookup = new Map(fixture.map((card) => [card.cardNumber, card]));
  const deck = { main: [["spell", 2], ["gear", 1]], sideboard: [["unit-10", 1], ["unit-2", 2]] };
  const model = deckImageModel(deck, { ...options, cardByNumber: (id) => lookup.get(id), sort: "cost" });
  assert.deepEqual(model.main.map((card) => card.cardNumber), ["gear", "spell", "spell"]);
  assert.deepEqual(model.sideboard.map((card) => card.cardNumber), ["unit-2", "unit-2", "unit-10"]);
  assert.deepEqual(deck.main, [["spell", 2], ["gear", 1]]);
});

test("cost ties use power cost, and dual-domain and neutral cards sort consistently", () => {
  const make = (id, domains, power = []) => ({ cardNumber: id, name: id, type: "unit", energy: 2, domains, power });
  const input = [make("neutral", []), make("dual-b", ["Chaos", "Fury"]), make("single", ["Fury"]), make("dual-a", ["Fury", "Chaos"]), make("power", ["Fury"], [{ domain: "Fury", amount: 1 }])];
  assert.deepEqual(sortDeckImageCards(input, "domain").map((card) => card.cardNumber), ["single", "power", "dual-a", "dual-b", "neutral"]);
  assert.equal(sortDeckImageCards(input, "cost").at(-1).cardNumber, "power");
  const runes = deckImageModel({ runes: [["Order", 2], ["Fury", 4], ["Calm", 6]] }, options).runes;
  assert.deepEqual(runes.map(({ card, count }) => [card.domains[0], count]), [["Fury", 4], ["Calm", 6], ["Order", 2]]);
});

test("Champion-first automatically selects the only eligible card and preserves the rest of the sort", () => {
  const deck = structuredClone(rawDecklists.provingGroundsAnnie);
  const original = structuredClone(deck);
  assert.deepEqual(deckImageChampionCandidates(deck, options).map((card) => card.cardNumber), ["OGS-010/024"]);
  for (const sort of ["type", "cost", "domain"]) {
    const normal = deckImageModel(deck, { ...options, sort });
    const pinned = deckImageModel(deck, { ...options, sort, championFirst: true });
    assert.equal(pinned.main[0].cardNumber, "OGS-010/024");
    assert.equal(pinned.main.length, 40);
    assert.deepEqual(pinned.main.slice(1), normal.main.filter((card) => card.cardNumber !== "OGS-010/024"));
    assert.deepEqual(pinned.sideboard, normal.sideboard);
  }
  assert.deepEqual(deck, original);
});

test("multiple Champion copies form one candidate; distinct eligible cards require the user's choice", () => {
  const deck = { legend: "OGS-017/024", main: [["OGS-001/024", 3], ["OGS-010/024", 2], ["OGN-004/298", 2], ["OGS-009/024", 1]], sideboard: [["OGS-010/024", 1]] };
  const original = structuredClone(deck);
  assert.deepEqual(deckImageChampionCandidates(deck, options).map((card) => card.cardNumber), ["OGS-001/024", "OGS-010/024"]);
  assert.throws(() => deckImageModel(deck, { ...options, championFirst: true }), /챔피언을 선택/u);
  assert.throws(() => deckImageModel(deck, { ...options, championFirst: true, championNumber: "OGS-009/024" }), /챔피언을 선택/u);
  const normal = deckImageModel(deck, options);
  for (const championNumber of ["OGS-001/024", "OGS-010/024"]) {
    const pinned = deckImageModel(deck, { ...options, championFirst: true, championNumber });
    const rest = [...normal.main];
    rest.splice(rest.findIndex((card) => card.cardNumber === championNumber), 1);
    assert.equal(pinned.main[0].cardNumber, championNumber);
    assert.equal(pinned.main.length, 8);
    assert.deepEqual(pinned.main.slice(1), rest);
    assert.deepEqual(pinned.sideboard, normal.sideboard);
  }
  assert.deepEqual(deck, original);
});

test("sideboard-only, zero-count and mismatched Champions are not offered; drafts without candidates still export", () => {
  const deck = { legend: "OGS-017/024", main: [["OGS-009/024", 1], ["OGN-004/298", 2]], sideboard: [["OGS-010/024", 1]] };
  assert.deepEqual(deckImageChampionCandidates(deck, options), []);
  assert.deepEqual(deckImageChampionCandidates({ ...deck, main: [["OGS-010/024", 0]] }, options), []);
  assert.deepEqual(deckImageChampionCandidates({ ...deck, legend: "" }, options), []);
  assert.deepEqual(deckImageModel(deck, { ...options, championFirst: true }), deckImageModel(deck, options));
  assert.throws(() => deckImageModel(deck, { ...options, championFirst: true, championNumber: "OGS-010/024" }), /챔피언을 선택/u);
});

test("deck image expands all registered copies, includes the Champion once and summarizes Runes", () => {
  const deck = structuredClone(rawDecklists.provingGroundsMasterYi);
  const original = structuredClone(deck);
  const model = deckImageModel(deck, options);
  assert.equal(model.main.length, 40);
  assert.equal(model.sideboard.length, 8);
  assert.equal(model.main.filter((card) => card.cardNumber === "OGS-009/024").length, 1);
  assert.equal(model.main.filter((card) => card.cardNumber === "OGN-043/298").length, 3);
  assert.equal(model.battlefields.length, 3);
  assert.equal(model.runes.length, 2);
  assert.equal(model.runeCount, 12);
  assert.deepEqual(model.runes.map((entry) => entry.count), [6, 6]);
  assert.deepEqual(deck, original);
});

test("Rune printings retain their selected card and empty drafts can still be exported", () => {
  const rune = Object.values(cards).filter((card) => card.type === "rune").at(-1);
  const model = deckImageModel({ main: [], runes: [[rune.cardNumber, 1]] }, options);
  assert.equal(model.runes[0].card.cardNumber, rune.cardNumber);
  const layout = deckImageLayout(model);
  assert.ok(layout.height > 0 && layout.height < 1500);
  assert.equal(layout.width, 2000);
});

test("deck image rejects unknown cards and unreasonable counts instead of silently omitting them", () => {
  assert.throws(() => deckImageModel({ main: [["unknown", 1]] }, options), /unknown/u);
  assert.throws(() => deckImageModel({ main: [["OGS-009/024", 1.5]] }, options));
  assert.throws(() => deckImageModel({ main: [["OGS-009/024", 201]] }, options));
  assert.throws(() => deckImageModel({ runes: [["Calm", -1]] }, options));
});

test("different printings of the same Rune share one quantity label", () => {
  const printings = Object.values(cards).filter((card) => card.type === "rune" && card.name === "Calm Rune");
  assert.ok(printings.length > 1);
  const model = deckImageModel({ runes: [[printings[0].cardNumber, 5], [printings[1].cardNumber, 7]] }, options);
  assert.equal(model.runes.length, 1);
  assert.equal(model.runes[0].count, 12);
});

test("additional rows grow the image without clipping the final card or footer", () => {
  const model = deckImageModel(rawDecklists.provingGroundsMasterYi, options);
  const standard = deckImageLayout(model);
  const extended = deckImageLayout({ ...model, main: [...model.main, model.main[0]] });
  assert.ok(extended.height > standard.height + 250);
  assert.ok(extended.sections[1].y > standard.sections[1].y);
  assert.ok(extended.height > extended.runeY + extended.runeHeight);
});

test("PNG filenames retain Korean names and remove filesystem delimiters", () => {
  assert.equal(deckImageFilename('마스터 이: 덱/테스트?'), 'Riftbound-마스터 이_ 덱_테스트_.png');
  assert.equal(deckImageFilename('...'), 'Riftbound-deck.png');
});

function request(handler, path, method = "GET") {
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  return handler({ url: path, method }, response).then((handled) => ({ ...response, handled }));
}

test("card image endpoint resolves registered localized art and refuses arbitrary proxy URLs", async () => {
  let calls = 0;
  const handler = createDeckCardImageHandler({ fetchImage: async () => { calls++; throw new Error("unexpected fetch"); } });
  const url = new URL(deckCardImageSource("OGS-019/024", "ko"));
  assert.equal(url.hostname, "cmsassets.rgpub.io");
  assert.equal(url.searchParams.get("w"), "640");
  assert.equal((await request(handler, "/api/deck-card-image?card=https://localhost/private")).status, 404);
  assert.equal((await request(handler, "/api/deck-card-image?url=https://example.org")).status, 404);
  assert.equal((await request(handler, "/api/deck-card-image?card=OGS-019/024", "POST")).status, 405);
  assert.equal((await request(handler, "/api/rooms")).handled, false);
  assert.equal(calls, 0);
});

test("card image requests deduplicate downloads, cache successful images and keep failures retryable", async () => {
  let calls = 0;
  const handler = createDeckCardImageHandler({ fetchImage: async (_source, settings) => {
    calls++;
    assert.equal(settings.redirect, "error");
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (calls === 1) return new Response("Unavailable", { status: 503 });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  } });
  const path = "/api/deck-card-image?card=OGS-019/024&locale=ko";
  assert.equal((await request(handler, path)).status, 502);
  const results = await Promise.all([request(handler, path), request(handler, path)]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(results[0].headers["access-control-allow-origin"], "*");
  assert.deepEqual([...results[0].body], [1, 2, 3]);
  await request(handler, path);
  assert.equal(calls, 2);
});

test("image endpoint refuses non-image responses and oversized bodies", async () => {
  for (const headers of [{ "content-type": "text/html" }, { "content-type": "image/png", "content-length": String(7 * 1024 * 1024) }]) {
    const handler = createDeckCardImageHandler({ fetchImage: async () => new Response("bad", { headers }) });
    assert.equal((await request(handler, "/api/deck-card-image?card=OGS-019/024")).status, 502);
  }
});
