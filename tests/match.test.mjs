import test from "node:test";
import assert from "node:assert/strict";

import { cards, decklists, rawDecklists } from "../src/cards.mjs";
import { enumerateLegalActions } from "../src/ai/actions.mjs";
import {
  chooseFirstPlayer,
  confirmFirstPlayer,
  createGame,
  currentPlayer,
  endTurn,
  rollFirstPlayer,
  selectBattlefield,
  selectChampion,
  skipMulligan
} from "../src/engine.mjs";
import { DECK_FORMATS, DECK_RULES, validateDeckRecord } from "../src/decks/rules.mjs";
import { normalizeSubmittedDeck, resolveDeckRecord, validateSubmittedDeck } from "../server/decks.mjs";
import {
  beginInitialSideboarding,
  beginNextMatchGame,
  createMatchState,
  recordMatchGame,
  sideboardExchangeCounts,
  submitSideboardConfiguration,
  validateSideboardConfiguration
} from "../src/match.mjs";

const allCards = Object.values(cards);
const cardByNumber = (number) => allCards.find((card) => [card.cardNumber, card.collectorNumber, card.id].includes(number)) || null;

test("tournament decks require exactly 40 Main Deck cards and at most 10 Sideboard cards", () => {
  const deck = structuredClone(rawDecklists.originsKaisa);
  assert.equal(deck.main.reduce((sum, [, count]) => sum + count, 0), DECK_RULES.tournamentMainExact);
  assert.equal(validateDeckRecord(deck, cardByNumber).playable, true);
  const mainNumbers = new Set(deck.main.map(([number]) => number));
  const sideEntry = deck.sideboard.find(([number]) => !mainNumbers.has(number));
  assert.ok(sideEntry);
  const [sideNumber, sideCount] = sideEntry;
  assert.ok(sideCount > 0);
  deck.sideboard.splice(deck.sideboard.indexOf(sideEntry), 1);
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
  const mainNumbers = new Set(candidate.main.map(([number]) => number));
  const sideEntry = candidate.sideboard.find(([number]) => !mainNumbers.has(number));
  assert.ok(sideEntry);
  const [sideNumber] = sideEntry;
  const [mainNumber] = candidate.main[0];
  candidate.main[0][1] -= 1;
  candidate.sideboard.push([mainNumber, 1]);
  candidate.sideboard.splice(candidate.sideboard.indexOf(sideEntry), 1);
  candidate.main.push([sideNumber, 1]);
  assert.equal(validateSideboardConfiguration(registered, candidate, cardByNumber).playable, true);
  candidate.battlefields.reverse();
  assert.equal(validateSideboardConfiguration(registered, candidate, cardByNumber).playable, true);
  candidate.battlefields[0] = registered.battlefields[0];
  assert.equal(validateSideboardConfiguration(registered, candidate, cardByNumber).playable, false);
});

test("single-game tournament setup reveals random Battlefields before sideboarding and preserves setup through Champion reveal", () => {
  const decks = [rawDecklists.originsMissFortune, rawDecklists.originsKaisa].map((deck) => structuredClone(deck));
  const match = createMatchState({
    decks,
    sideboardingEnabled: false,
    setupProcedure: "single-game-sideboard"
  });
  const pregame = createGame({
    decks: decks.map(resolveDeckRecord),
    format: "duel",
    setupProcedure: "single-game-sideboard",
    firstPlayerId: "p2",
    interactive: true,
    randomSeed: 31,
    playerRandomSeeds: { p1: 41, p2: 59 }
  });
  assert.equal(pregame.phase, "sideboarding");
  assert.equal(pregame.firstPlayerId, "p2");
  assert.equal(pregame.battlefields.length, 2);
  assert.deepEqual(pregame.players.map((player) => player.champion), [null, null]);
  assert.deepEqual(pregame.players.map((player) => player.hand.length), [0, 0]);
  const revealedBattlefields = Object.fromEntries(pregame.players.map((player) => [
    player.id,
    pregame.battlefields.find((field) => field.ownerId === player.id).cardNumber
  ]));
  assert.equal(beginInitialSideboarding(match, {
    firstPlayerId: pregame.firstPlayerId,
    battlefields: revealedBattlefields
  }).ok, true);
  assert.equal(match.phase, "initial-sideboarding");
  assert.equal(submitSideboardConfiguration(match, "p1", decks[0], cardByNumber).ready, false);
  assert.equal(submitSideboardConfiguration(match, "p1", decks[0], cardByNumber).ok, false, "a locked sideboard cannot be replaced before the opponent submits");
  assert.equal(submitSideboardConfiguration(match, "p2", decks[1], cardByNumber).ready, true);
  const next = beginNextMatchGame(match);
  assert.equal(match.gameNumber, 1, "initial sideboarding does not start game two");
  assert.equal(next.initialSideboardingComplete, true);
  assert.equal(next.firstPlayerId, "p2");
  assert.deepEqual(next.lockedBattlefields, revealedBattlefields);

  const game = createGame({
    decks: next.decks.map(resolveDeckRecord),
    format: "duel",
    setupProcedure: "single-game-sideboard",
    initialSideboardingComplete: true,
    firstPlayerId: next.firstPlayerId,
    lockedBattlefields: next.lockedBattlefields,
    interactive: true
  });
  assert.equal(game.phase, "champion-select");
  assert.deepEqual(Object.fromEntries(game.battlefields.map((field) => [field.ownerId, field.cardNumber])), revealedBattlefields);
  const firstSelector = game.players.find((player) => player.id === game.championSelectPlayerId);
  assert.equal(selectChampion(game, firstSelector.id, firstSelector.availableChampions[0].instanceId).ok, true);
  assert.deepEqual(game.players.map((player) => player.champion), [null, null], "the first locked Champion is not revealed early");
  const secondSelector = game.players.find((player) => player.id === game.championSelectPlayerId);
  assert.equal(selectChampion(game, secondSelector.id, secondSelector.availableChampions[0].instanceId).ok, true);
  assert.equal(game.players.every((player) => player.champion?.zone === "champion"), true);
  assert.equal(game.phase, "mulligan");
  assert.deepEqual(game.players.map((player) => player.hand.length), [4, 4]);
  assert.equal(game.mulligan.playerId, "p2");
});

test("a drawn single game completes instead of entering an unreachable second sideboarding cycle", () => {
  const decks = [rawDecklists.originsMissFortune, rawDecklists.originsKaisa].map((deck) => structuredClone(deck));
  const match = createMatchState({
    decks,
    sideboardingEnabled: false,
    setupProcedure: "single-game-sideboard"
  });
  const result = recordMatchGame(match, {
    winnerId: null,
    firstPlayerId: "p1",
    battlefields: { p1: decks[0].battlefields[0], p2: decks[1].battlefields[0] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.equal(match.phase, "complete");
  assert.equal(match.winnerId, null);
  assert.equal(match.gameNumber, 1);
});

test("sideboard exchange counts allow either edit order but reject an unfinished imbalance", () => {
  const registered = structuredClone(rawDecklists.originsKaisa);
  const draft = structuredClone(registered);
  const [mainNumber] = draft.main[0];
  const sideEntry = draft.sideboard.find(([number]) => !draft.main.some(([main]) => main === number));
  assert.ok(sideEntry);
  const [sideNumber] = sideEntry;
  draft.main[0][1] -= 1;
  if (draft.main[0][1] === 0) draft.main.splice(0, 1);
  draft.sideboard.push([mainNumber, 1]);
  assert.deepEqual(sideboardExchangeCounts(registered, draft), { in: 0, out: 1 });
  assert.equal(validateSideboardConfiguration(registered, draft, cardByNumber).playable, false);
  sideEntry[1] -= 1;
  if (sideEntry[1] === 0) draft.sideboard.splice(draft.sideboard.indexOf(sideEntry), 1);
  draft.main.push([sideNumber, 1]);
  assert.deepEqual(sideboardExchangeCounts(registered, draft), { in: 1, out: 1 });
  assert.equal(validateSideboardConfiguration(registered, draft, cardByNumber).playable, true);
});

test("best-of-three sideboard match lets the loser choose first and ends at two wins", () => {
  const decks = [rawDecklists.originsKaisa, rawDecklists.provingGroundsMasterYi].map((deck) => structuredClone(deck));
  const match = createMatchState({ decks, sideboardingEnabled: true });
  assert.equal(recordMatchGame(match, { winnerId: "p1", firstPlayerId: "p1", battlefields: { p1: decks[0].battlefields[0], p2: decks[1].battlefields[0] } }).complete, false);
  assert.equal(match.phase, "sideboarding");
  assert.equal(match.firstPlayerChooserId, "p2");
  assert.equal(submitSideboardConfiguration(match, "p1", decks[0], cardByNumber).ok, true);
  assert.equal(submitSideboardConfiguration(match, "p2", decks[1], cardByNumber).ready, true);
  const next = beginNextMatchGame(match);
  assert.equal(next.firstPlayerId, null);
  assert.equal(next.firstPlayerChooserId, "p2");
  assert.deepEqual(next.unavailableBattlefields, {
    p1: [decks[0].battlefields[0]],
    p2: [decks[1].battlefields[0]]
  });
  assert.equal(recordMatchGame(match, { winnerId: "p1", firstPlayerId: "p2" }).complete, true);
  assert.equal(match.winnerId, "p1");
});

test("draws retain play order, allow sideboarding, and leave the drawn Battlefields available", () => {
  const decks = [rawDecklists.originsKaisa, rawDecklists.provingGroundsMasterYi].map((deck) => structuredClone(deck));
  const fields = { p1: decks[0].battlefields[1], p2: decks[1].battlefields[2] };
  const match = createMatchState({ decks, sideboardingEnabled: true });
  recordMatchGame(match, { winnerId: null, firstPlayerId: "p2", battlefields: fields });
  assert.equal(match.phase, "sideboarding");
  assert.equal(match.lockedBattlefields, null);
  assert.equal(submitSideboardConfiguration(match, "p1", decks[0], cardByNumber).ok, true);
  assert.equal(submitSideboardConfiguration(match, "p2", decks[1], cardByNumber).ready, true);
  const next = beginNextMatchGame(match);
  assert.equal(next.firstPlayerId, "p2");
  assert.equal(next.firstPlayerChooserId, null);
  assert.equal(next.lockedBattlefields, null);
  assert.deepEqual(next.unavailableBattlefields, { p1: [], p2: [] });

  const resolvedDecks = decks.map((deck) => ({
    ...deck,
    legend: cardByNumber(deck.legend),
    battlefields: deck.battlefields.map(cardByNumber),
    main: deck.main.flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number))),
    sideboard: (deck.sideboard || []).flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number))),
    runes: []
  }));
  const game = createGame({
    decks: resolvedDecks,
    format: "match",
    battlefieldSelectionMode: "manual",
    firstPlayerId: next.firstPlayerId,
    unavailableBattlefields: next.unavailableBattlefields
  });
  while (game.phase === "champion-select") {
    const player = game.players.find((entry) => entry.id === game.championSelectPlayerId);
    const legendTags = new Set(player.legend.tags || []);
    const champion = player.availableChampions.find((entry) => (entry.tags || []).some((tag) => legendTags.has(tag)));
    assert.equal(selectChampion(game, player.id, champion.instanceId).ok, true);
  }
  for (const player of game.players) {
    const battlefield = player.availableBattlefields.find((field) => field.cardNumber === fields[player.id]);
    assert.ok(battlefield, "a Battlefield from the drawn game remains selectable");
    assert.equal(selectBattlefield(game, player.id, battlefield.instanceId).ok, true);
  }
  assert.deepEqual(Object.fromEntries(game.battlefields.map((field) => [field.ownerId, field.cardNumber])), fields);
  assert.equal(game.phase, "mulligan");
  assert.equal(game.mulligan.playerId, "p2");
  assert.equal(game.players.every((player) => player.hand.length === 4), true);
});

test("official match setup reveals Battlefields before play order, opening hands, and first-player mulligans", () => {
  const game = createGame({
    decks: [decklists.keenanXiong, decklists.drowsy],
    format: "match",
    battlefieldSelectionMode: "manual",
    randomFirstPlayer: true,
    randomSeed: 17,
    interactive: true
  });

  assert.equal(game.phase, "champion-select");
  assert.equal(game.firstPlayerId, null);
  assert.equal(game.battlefields.length, 0);
  assert.deepEqual(game.players.map((player) => player.hand.length), [0, 0]);
  assert.equal(game.players.every((player) => player.legend && !player.champion), true);

  for (const player of game.players) {
    assert.equal(game.championSelectPlayerId, player.id);
    assert.equal(selectChampion(game, player.id, player.availableChampions[0].instanceId).ok, true);
  }
  assert.equal(game.phase, "battlefield-select");
  assert.equal(game.players.every((player) => player.champion?.zone === "champion"), true);
  assert.deepEqual(game.players.map((player) => player.hand.length), [0, 0]);

  const firstField = game.players[0].availableBattlefields[0];
  assert.equal(selectBattlefield(game, "p1", firstField.instanceId).ok, true);
  assert.equal(game.battlefields.length, 0, "the first private selection is not revealed early");
  const secondField = game.players[1].availableBattlefields[0];
  assert.equal(selectBattlefield(game, "p2", secondField.instanceId).ok, true);
  assert.equal(game.battlefields.length, 2);
  assert.equal(game.phase, "first-player");
  assert.equal(game.setupDecksShuffled, true);
  assert.deepEqual(game.players.map((player) => player.hand.length), [0, 0]);

  let safety = 0;
  while (game.firstPlayerDecision.status === "rolling" && safety < 20) {
    assert.equal(rollFirstPlayer(game, game.firstPlayerDecision.rollerId).ok, true);
    safety += 1;
  }
  assert.equal(game.firstPlayerDecision.status, "choosing");
  const designatedPlayerId = game.firstPlayerDecision.chooserId;
  assert.equal(chooseFirstPlayer(game, designatedPlayerId, "p2").ok, true);
  assert.equal(game.phase, "mulligan");
  assert.deepEqual(game.players.map((player) => player.hand.length), [4, 4]);
  assert.equal(game.mulligan.playerId, "p2");

  assert.equal(skipMulligan(game).ok, true);
  assert.equal(game.mulligan.playerId, "p1");
  assert.equal(skipMulligan(game).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(currentPlayer(game).id, "p2");
  assert.equal(game.players.find((player) => player.id === "p2").runes.length, 2);
  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, "p1");
  assert.equal(game.players.find((player) => player.id === "p1").runes.length, 3);
});

test("the previous loser chooses the next play order only after both Battlefields are revealed", () => {
  const game = createGame({
    decks: [decklists.keenanXiong, decklists.drowsy],
    format: "match",
    battlefieldSelectionMode: "manual",
    firstPlayerChooserId: "p2",
    interactive: true
  });

  for (const player of game.players) {
    assert.equal(selectChampion(game, player.id, player.availableChampions[0].instanceId).ok, true);
  }
  for (const player of game.players) {
    assert.equal(selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId).ok, true);
  }
  assert.equal(game.phase, "first-player");
  assert.equal(game.firstPlayerDecision.method, "designated");
  assert.equal(game.firstPlayerDecision.chooserId, "p2");
  assert.deepEqual(enumerateLegalActions(game, "p2"), [
    { kind: "chooseFirstPlayer", playerId: "p1" },
    { kind: "chooseFirstPlayer", playerId: "p2" }
  ]);
  assert.equal(confirmFirstPlayer(game).ok, false, "a host cannot bypass the designated player's choice");
  assert.equal(chooseFirstPlayer(game, "p1", "p1").ok, false);
  assert.equal(chooseFirstPlayer(game, "p2", "p1").ok, true);
  assert.equal(game.firstPlayerId, "p1");
  assert.equal(game.mulligan.playerId, "p1");
});
