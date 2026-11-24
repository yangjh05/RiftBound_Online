import { normalizeCountEntries, validateDeckRecord } from "./decks/rules.mjs";

export const MATCH_WINS_REQUIRED = 2;

export function createMatchState({ decks, sideboardingEnabled = false, setupProcedure = null } = {}) {
  const registeredDecks = (decks || []).map(cloneDeck);
  return {
    sideboardingEnabled: Boolean(sideboardingEnabled),
    setupProcedure: setupProcedure || (sideboardingEnabled ? "match" : "core-duel"),
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
    lastGameWasDraw: false,
    initialSideboarding: false,
    initialSetup: null
  };
}

export function beginInitialSideboarding(match, { firstPlayerId = null, battlefields = {} } = {}) {
  if (!match || match.phase !== "playing" || match.gameNumber !== 1) {
    return failure("The match is not ready for initial sideboarding.");
  }
  if (match.setupProcedure !== "single-game-sideboard" || match.sideboardingEnabled) {
    return failure("This match does not use the single-game sideboarding procedure.");
  }
  if (!["p1", "p2"].includes(firstPlayerId)) return failure("The first player is required before sideboarding.");
  if (["p1", "p2"].some((playerId) => !battlefields?.[playerId])) {
    return failure("Both random Battlefields must be revealed before sideboarding.");
  }
  match.phase = "initial-sideboarding";
  match.initialSideboarding = true;
  match.initialSetup = {
    firstPlayerId,
    battlefields: { p1: battlefields.p1, p2: battlefields.p2 }
  };
  match.submissions = { p1: false, p2: false };
  return { ok: true };
}

export function recordMatchGame(match, { winnerId = null, firstPlayerId = null, battlefields = {} } = {}) {
  if (!match || match.phase !== "playing") return failure("The match is not playing a game.");
  const isDraw = !winnerId;
  if (winnerId && !["p1", "p2"].includes(winnerId)) return failure("Unknown game winner.");
  if (isDraw && !["p1", "p2"].includes(firstPlayerId)) {
    return failure("The previous play order is required after a drawn game.");
  }
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
  if (!match.sideboardingEnabled || (winnerId && match.wins[winnerId] >= match.winsRequired)) {
    match.phase = "complete";
    match.winnerId = winnerId;
    return { ok: true, complete: true };
  }

  match.phase = match.sideboardingEnabled ? "sideboarding" : "between-games";
  match.submissions = { p1: false, p2: false };
  // A Battlefield used in a drawn game remains available, but is not forced as
  // the next selection. Only Battlefields from games with a winner are spent.
  match.lockedBattlefields = null;
  match.firstPlayerChooserId = winnerId ? opponentId(winnerId) : null;
  match.nextFirstPlayerId = isDraw ? firstPlayerId : null;
  return { ok: true, complete: false };
}

export function submitSideboardConfiguration(match, playerId, deck, cardByNumber) {
  if (!match || !["initial-sideboarding", "sideboarding", "between-games"].includes(match.phase)) return failure("The match is not accepting sideboard configurations.");
  const index = playerId === "p1" ? 0 : playerId === "p2" ? 1 : -1;
  if (index < 0) return failure("Unknown player.");
  if (match.submissions?.[playerId]) return failure("That player has already locked in their sideboard.");
  const validation = validateSideboardConfiguration(match.registeredDecks[index], deck, cardByNumber);
  if (!validation.playable) return failure(validation.messages.join(" "));
  match.currentDecks[index] = cloneDeck(deck);
  match.submissions[playerId] = true;
  if (match.submissions.p1 && match.submissions.p2) {
    match.phase = match.initialSideboarding ? "ready-initial-game" : "ready-next-game";
  }
  return { ok: true, ready: ["ready-initial-game", "ready-next-game"].includes(match.phase) };
}

export function beginNextMatchGame(match) {
  if (!match || !["ready-initial-game", "ready-next-game"].includes(match.phase)) return failure("Both players have not finished sideboarding.");
  const initialSideboardingComplete = match.phase === "ready-initial-game";
  if (!initialSideboardingComplete) match.gameNumber += 1;
  match.phase = "playing";
  match.submissions = { p1: false, p2: false };
  const initialSetup = initialSideboardingComplete ? match.initialSetup : null;
  match.initialSideboarding = false;
  return {
    ok: true,
    decks: match.currentDecks.map(cloneDeck),
    firstPlayerId: initialSetup?.firstPlayerId || match.nextFirstPlayerId,
    firstPlayerChooserId: initialSideboardingComplete ? null : match.firstPlayerChooserId,
    lockedBattlefields: initialSetup?.battlefields || null,
    unavailableBattlefields: initialSideboardingComplete ? null : structuredClone(match.usedBattlefields),
    initialSideboardingComplete
  };
}

export function validateSideboardConfiguration(registered, candidate, cardByNumber) {
  const validation = validateDeckRecord(candidate, cardByNumber);
  const messages = [...validation.messages];
  const exchange = sideboardExchangeCounts(registered, candidate);
  if (exchange.in !== exchange.out) {
    messages.push(`Sideboard in and sideboard out counts must match (${exchange.in}/${exchange.out}).`);
  }
  if (candidate?.legend !== registered?.legend) messages.push("Champion Legend cannot change during a match.");
  if (!sameList(candidate?.battlefields, registered?.battlefields)) messages.push("Registered Battlefields cannot change during a match.");
  if (!sameEntries(candidate?.runes, registered?.runes)) messages.push("Rune Deck cannot change during a match.");
  const registeredPool = normalizeCountEntries([...(registered?.main || []), ...(registered?.sideboard || [])]);
  const candidatePool = normalizeCountEntries([...(candidate?.main || []), ...(candidate?.sideboard || [])]);
  if (!sameEntries(registeredPool, candidatePool)) messages.push("Main Deck and Sideboard must contain the same registered card pool.");
  return { playable: messages.length === 0, messages };
}

export function sideboardExchangeCounts(baseline, candidate) {
  const original = new Map(normalizeCountEntries(baseline?.main));
  const current = new Map(normalizeCountEntries(candidate?.main));
  const cardNumbers = new Set([...original.keys(), ...current.keys()]);
  let sideboardOut = 0;
  let sideboardIn = 0;
  for (const cardNumber of cardNumbers) {
    const delta = (current.get(cardNumber) || 0) - (original.get(cardNumber) || 0);
    if (delta < 0) sideboardOut += -delta;
    if (delta > 0) sideboardIn += delta;
  }
  return { in: sideboardIn, out: sideboardOut };
}

export function resetMatchDecks(match) {
  match.currentDecks = match.registeredDecks.map(cloneDeck);
  return match.currentDecks;
}

function cloneDeck(deck) {
  return structuredClone(deck || {});
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
