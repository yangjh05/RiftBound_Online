import test from "node:test";
import assert from "node:assert/strict";

import { cards, rawDecklists } from "../src/cards.mjs";
import { createGame, confirmFirstPlayer, selectChampion } from "../src/engine.mjs";
import { DECK_FORMATS, DECK_RULES, validateDeckRecord } from "../src/decks/rules.mjs";
import { normalizeSubmittedDeck, validateSubmittedDeck } from "../server/decks.mjs";
import {
  beginNextMatchGame,
  createMatchState,
  recordMatchGame,
  submitSideboardConfiguration,
  validateSideboardConfiguration
} from "../src/match.mjs";

const allCards = Object.values(cards);
const cardByNumber = (number) => allCards.find((card) => [card.cardNumber, card.collectorNumber, card.id].includes(number)) || null;

test("tournament decks require exactly 40 Main Deck cards and at most 8 Sideboard cards", () => {
  const deck = structuredClone(rawDecklists.originsKaisa);
  assert.equal(deck.main.reduce((sum, [, count]) => sum + count, 0), DECK_RULES.tournamentMainExact);
  assert.equal(validateDeckRecord(deck, cardByNumber).playable, true);
  const [sideNumber, sideCount] = deck.sideboard[0];
  assert.ok(sideCount > 0);
  deck.sideboard[0][1] -= 1;
  deck.main.push([sideNumber, 1]);
  assert.equal(validateDeckRecord(deck, cardByNumber).playable, false);
  assert.ok(validateDeckRecord(deck, cardByNumber).messages.some((message) => message.includes("tournament") && message.includes("exactly")));
  assert.equal(validateDeckRecord(deck, cardByNumber, { format: DECK_FORMATS.CORE }).playable, true);

  const undersized = structuredClone(rawDecklists.originsKaisa);
  undersized.main[0][1] -= 1;
  assert.equal(validateDeckRecord(undersized, cardByNumber).playable, false);
  assert.ok(validateDeckRecord(undersized, cardByNumber).messages.some((message) => message.includes("tournament") && message.includes("exactly")));
  assert.equal(validateSubmittedDeck(normalizeSubmittedDeck(undersized)).playable, false);
  assert.equal(validateDeckRecord(undersized, cardByNumber, { format: DECK_FORMATS.CORE }).playable, false);
  assert.ok(validateDeckRecord(undersized, cardByNumber, { format: DECK_FORMATS.CORE }).messages.some((message) => message.includes("at least")));
});

test("sideboarding preserves the registered pool and immutable deck zones", () => {
  const registered = structuredClone(rawDecklists.originsKaisa);
  const candidate = structuredClone(registered);
  const [sideNumber] = candidate.sideboard[0];
  const [mainNumber] = candidate.main[0];
  candidate.main[0][1] -= 1;
  candidate.sideboard.push([mainNumber, 1]);
  candidate.sideboard[0][1] -= 1;
  candidate.main.push([sideNumber, 1]);
  assert.equal(validateSideboardConfiguration(registered, candidate, cardByNumber).playable, true);
  candidate.battlefields.reverse();
  assert.equal(validateSideboardConfiguration(registered, candidate, cardByNumber).playable, true);
  candidate.battlefields[0] = registered.battlefields[0];
  assert.equal(validateSideboardConfiguration(registered, candidate, cardByNumber).playable, false);
});

test("best-of-three sideboard match lets the loser choose first and ends at two wins", () => {
  const decks = [rawDecklists.originsKaisa, rawDecklists.provingGroundsMasterYi].map((deck) => structuredClone(deck));
  const match = createMatchState({ decks, sideboardingEnabled: true });
  assert.equal(recordMatchGame(match, { winnerId: "p1", firstPlayerId: "p1", battlefields: { p1: decks[0].battlefields[0], p2: decks[1].battlefields[0] } }).complete, false);
  assert.equal(match.phase, "sideboarding");
  assert.equal(match.firstPlayerChooserId, "p2");
  assert.equal(submitSideboardConfiguration(match, "p1", decks[0], cardByNumber).ok, true);
  assert.equal(submitSideboardConfiguration(match, "p2", decks[1], cardByNumber, "p2").ready, true);
  const next = beginNextMatchGame(match);
  assert.equal(next.firstPlayerId, "p2");
  assert.deepEqual(next.unavailableBattlefields, {
    p1: [decks[0].battlefields[0]],
    p2: [decks[1].battlefields[0]]
  });
  assert.equal(recordMatchGame(match, { winnerId: "p1", firstPlayerId: "p2" }).complete, true);
  assert.equal(match.winnerId, "p1");
});

test("draws prohibit sideboarding and lock both previous Battlefields", () => {
  const decks = [rawDecklists.originsKaisa, rawDecklists.provingGroundsMasterYi].map((deck) => structuredClone(deck));
  const fields = { p1: decks[0].battlefields[1], p2: decks[1].battlefields[2] };
  const match = createMatchState({ decks, sideboardingEnabled: true });
  recordMatchGame(match, { winnerId: null, firstPlayerId: "p2", battlefields: fields });
  assert.equal(match.phase, "between-games");
  assert.deepEqual(match.lockedBattlefields, fields);
  assert.equal(submitSideboardConfiguration(match, "p1", decks[0], cardByNumber).ok, true);
  assert.equal(submitSideboardConfiguration(match, "p2", decks[1], cardByNumber).ready, true);
  const next = beginNextMatchGame(match);
  assert.deepEqual(next.lockedBattlefields, fields);

  const resolvedDecks = decks.map((deck) => ({
    ...deck,
    legend: cardByNumber(deck.legend),
    battlefields: deck.battlefields.map(cardByNumber),
    main: deck.main.flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number))),
    sideboard: (deck.sideboard || []).flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number))),
    runes: []
  }));
  const game = createGame({ decks: resolvedDecks, firstPlayerId: next.firstPlayerId, lockedBattlefields: next.lockedBattlefields });
  confirmFirstPlayer(game);
  while (game.phase === "champion-select") {
    const player = game.players.find((entry) => entry.id === game.championSelectPlayerId);
    const legendTags = new Set(player.legend.tags || []);
    const champion = player.availableChampions.find((entry) => (entry.tags || []).some((tag) => legendTags.has(tag)));
    assert.equal(selectChampion(game, player.id, champion.instanceId).ok, true);
  }
  assert.deepEqual(Object.fromEntries(game.battlefields.map((field) => [field.ownerId, field.cardNumber])), fields);
  assert.equal(game.phase, "mulligan");
});
