import test from "node:test";
import assert from "node:assert/strict";

import {
  DOMAINS,
  cards,
  makeRune,
  rawDecklists,
  runeCardsForDomain
} from "../src/cards.mjs";
import { validateDeckRecord } from "../src/decks/rules.mjs";
import { normalizeSubmittedDeck, resolveDeckRecord } from "../server/decks.mjs";

const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
const cardByNumber = (number) => CARD_BY_NUMBER.get(number) || null;

test("every Rune domain exposes its registered card art and makeRune preserves the selected variant", () => {
  for (const domain of [DOMAINS.BODY, DOMAINS.CALM, DOMAINS.CHAOS, DOMAINS.FURY, DOMAINS.MIND, DOMAINS.ORDER]) {
    const variants = runeCardsForDomain(domain);
    assert.equal(variants.length, 3, `${domain} should have three selectable Rune card variants`);
    assert.ok(variants.every((card) => card.image && card.type === "rune"));

    const selected = variants[1];
    const rune = makeRune(selected.cardNumber);
    assert.equal(rune.cardNumber, selected.cardNumber);
    assert.equal(rune.image, selected.image);
    assert.equal(rune.domain, domain);
  }
});

test("deck validation accepts mixed Rune art variants within the Legend identity", () => {
  const source = rawDecklists.provingGroundsMasterYi;
  const calmVariant = runeCardsForDomain(DOMAINS.CALM)[1];
  const bodyVariant = runeCardsForDomain(DOMAINS.BODY)[2];
  const deck = {
    ...structuredClone(source),
    name: source.playerName,
    runes: [[calmVariant.cardNumber, 6], [bodyVariant.cardNumber, 6]]
  };

  assert.deepEqual(validateDeckRecord(deck, cardByNumber), { playable: true, messages: [] });

  const chaosVariant = runeCardsForDomain(DOMAINS.CHAOS)[0];
  deck.runes = [[calmVariant.cardNumber, 6], [chaosVariant.cardNumber, 6]];
  const invalid = validateDeckRecord(deck, cardByNumber);
  assert.equal(invalid.playable, false);
  assert.ok(invalid.messages.some((message) => message.includes("outside")));
});

test("online deck normalization migrates legacy domain counts and resolves Rune images", () => {
  const source = rawDecklists.provingGroundsMasterYi;
  const normalized = normalizeSubmittedDeck({
    ...structuredClone(source),
    name: source.playerName
  });

  assert.deepEqual(normalized.runes, [["OGN-042/298", 6], ["OGN-126/298", 6]]);
  const resolved = resolveDeckRecord(normalized);
  assert.equal(resolved.runes.length, 12);
  assert.ok(resolved.runes.every((rune) => rune.image));
  assert.equal(resolved.runes.filter((rune) => rune.domain === DOMAINS.CALM).length, 6);
  assert.equal(resolved.runes.filter((rune) => rune.domain === DOMAINS.BODY).length, 6);
});
