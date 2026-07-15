import { normalizeCountEntries, validateDeckRecord } from "./decks/rules.mjs";

export const MATCH_WINS_REQUIRED = 2;

export function createMatchState({ decks, sideboardingEnabled = false } = {}) {
  const registeredDecks = (decks || []).map(cloneDeck);
  return {
    sideboardingEnabled: Boolean(sideboardingEnabled),
    winsRequired: sideboardingEnabled ? MATCH_WINS_REQUIRED : 1,
    gameNumber: 1,
    wins: { p1: 0, p2: 0 },
    phase: "playing",
    winnerId: null,
    registeredDecks,
    currentDecks: registeredDecks.map(cloneDeck),
    submissions: { p1: false, p2: false },
    nextFirstPlayerId: null,
    firstPlayerChooserId: null,
    previousBattlefields: { p1: null, p2: null },
    usedBattlefields: { p1: [], p2: [] },
    lockedBattlefields: null,
    lastGameWasDraw: false
  };
}

export function recordMatchGame(match, { winnerId = null, firstPlayerId = null, battlefields = {} } = {}) {
  if (!match || match.phase !== "playing") return failure("The match is not playing a game.");
  const isDraw = !winnerId;
  if (winnerId && !["p1", "p2"].includes(winnerId)) return failure("Unknown game winner.");
  if (winnerId) match.wins[winnerId] += 1;
  match.previousBattlefields = {
    p1: battlefields.p1 || null,
    p2: battlefields.p2 || null
  };
  if (!isDraw) {
    for (const playerId of ["p1", "p2"]) {
      const battlefield = match.previousBattlefields[playerId];
      if (battlefield && !match.usedBattlefields[playerId].includes(battlefield)) {
        match.usedBattlefields[playerId].push(battlefield);
      }
    }
  }
  match.lastGameWasDraw = isDraw;
  if (winnerId && match.wins[winnerId] >= match.winsRequired) {
    match.phase = "complete";
    match.winnerId = winnerId;
    return { ok: true, complete: true };
  }

  match.phase = match.sideboardingEnabled && !isDraw ? "sideboarding" : "between-games";
  match.submissions = { p1: false, p2: false };
  match.lockedBattlefields = isDraw ? { ...match.previousBattlefields } : null;
  match.firstPlayerChooserId = winnerId ? opponentId(winnerId) : null;
  match.nextFirstPlayerId = isDraw ? firstPlayerId : null;
  return { ok: true, complete: false };
}

export function submitSideboardConfiguration(match, playerId, deck, cardByNumber, firstPlayerId = null) {
  if (!match || !["sideboarding", "between-games"].includes(match.phase)) return failure("The match is not between games.");
  const index = playerId === "p1" ? 0 : playerId === "p2" ? 1 : -1;
  if (index < 0) return failure("Unknown player.");
  if (match.phase === "between-games" && !sameDeck(deck, match.currentDecks[index])) return failure("Sideboarding is not allowed after a drawn game.");
  const validation = validateSideboardConfiguration(match.registeredDecks[index], deck, cardByNumber);
  if (!validation.playable) return failure(validation.messages.join(" "));
  if (match.firstPlayerChooserId === playerId) {
    if (!["p1", "p2"].includes(firstPlayerId)) return failure("The previous game loser must choose who plays first.");
    match.nextFirstPlayerId = firstPlayerId;
  }
  match.currentDecks[index] = cloneDeck(deck);
  match.submissions[playerId] = true;
  if (match.submissions.p1 && match.submissions.p2 && match.nextFirstPlayerId) match.phase = "ready-next-game";
  return { ok: true, ready: match.phase === "ready-next-game" };
}

export function beginNextMatchGame(match) {
  if (!match || match.phase !== "ready-next-game") return failure("Both players have not finished sideboarding.");
  match.gameNumber += 1;
  match.phase = "playing";
  match.submissions = { p1: false, p2: false };
  return {
    ok: true,
    decks: match.currentDecks.map(cloneDeck),
    firstPlayerId: match.nextFirstPlayerId,
    lockedBattlefields: match.lockedBattlefields ? { ...match.lockedBattlefields } : null,
    unavailableBattlefields: structuredClone(match.usedBattlefields)
  };
}

export function validateSideboardConfiguration(registered, candidate, cardByNumber) {
  const validation = validateDeckRecord(candidate, cardByNumber);
  const messages = [...validation.messages];
  if (candidate?.legend !== registered?.legend) messages.push("Champion Legend cannot change during a match.");
  if (!sameList(candidate?.battlefields, registered?.battlefields)) messages.push("Registered Battlefields cannot change during a match.");
  if (!sameEntries(candidate?.runes, registered?.runes)) messages.push("Rune Deck cannot change during a match.");
  const registeredPool = normalizeCountEntries([...(registered?.main || []), ...(registered?.sideboard || [])]);
  const candidatePool = normalizeCountEntries([...(candidate?.main || []), ...(candidate?.sideboard || [])]);
  if (!sameEntries(registeredPool, candidatePool)) messages.push("Main Deck and Sideboard must contain the same registered card pool.");
  return { playable: messages.length === 0, messages };
}

export function resetMatchDecks(match) {
  match.currentDecks = match.registeredDecks.map(cloneDeck);
  return match.currentDecks;
}

function cloneDeck(deck) {
  return structuredClone(deck || {});
}

function sameDeck(left, right) {
  return JSON.stringify(cloneComparableDeck(left)) === JSON.stringify(cloneComparableDeck(right));
}

function cloneComparableDeck(deck) {
  return {
    legend: deck?.legend || "",
    battlefields: [...(deck?.battlefields || [])].sort(),
    main: sortedEntries(deck?.main),
    sideboard: sortedEntries(deck?.sideboard),
    runes: sortedEntries(deck?.runes)
  };
}

function sameList(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sameEntries(left = [], right = []) {
  return JSON.stringify(sortedEntries(left)) === JSON.stringify(sortedEntries(right));
}

function sortedEntries(entries = []) {
  return normalizeCountEntries(entries).sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function opponentId(playerId) {
  return playerId === "p1" ? "p2" : "p1";
}

function failure(message) {
  return { ok: false, message };
}
