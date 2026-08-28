import { readFile } from "node:fs/promises";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { championMatchesLegend } from "../src/engine/setup.mjs";
import { applyResolvedSideboardSwap, enumerateSideboardActions } from "../src/ai/neural/selfplay.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const regression = verifySideboardRegression();
const requestedFailure = args.failure ? path.resolve(args.failure) : path.resolve(args["data-dir"] || "data/ai", "failures", "latest.json");
const failure = await readFailure(requestedFailure);
const failureVerification = failure ? verifyFailureArtifact(failure) : null;
const passed = regression.passed && (!failureVerification || failureVerification.verifiable);

console.log(JSON.stringify({
  passed,
  regression,
  failure: failureVerification ? { path: requestedFailure, ...failureVerification } : { path: requestedFailure, found: false }
}, null, 2));

if (!passed) process.exitCode = 1;

function verifySideboardRegression() {
  const deck = structuredClone(Object.values(decklists).find((candidate) => candidate.id === "proving-grounds-annie"));
  if (!deck) return { passed: false, reason: "Annie regression fixture is incomplete." };
  const champion = deck.main.find((card) => championMatchesLegend(card, deck.legend));
  const incoming = deck.sideboard.find((card) => !championMatchesLegend(card, deck.legend));
  if (!champion || !incoming) return { passed: false, reason: "Annie regression fixture is incomplete." };
  const action = { kind: "sideboardSwap", outCardNumber: champion.cardNumber, inCardNumber: incoming.cardNumber };
  const before = deck.main.map((card) => card.cardNumber);
  const exposed = enumerateSideboardActions(deck).some((candidate) => candidate.kind === "sideboardSwap"
    && candidate.outCardNumber === action.outCardNumber && candidate.inCardNumber === action.inCardNumber);
  const applied = applyResolvedSideboardSwap(deck, action);
  const preserved = deck.main.some((card) => championMatchesLegend(card, deck.legend));
  return {
    passed: !exposed && !applied && preserved && JSON.stringify(before) === JSON.stringify(deck.main.map((card) => card.cardNumber)),
    deckId: deck.id,
    rejectedAction: action,
    exposed,
    applied,
    startingChampionPreserved: preserved
  };
}

function verifyFailureArtifact(failure) {
  const diagnostic = failure.error?.diagnostic || failure.diagnostic;
  const match = diagnostic?.match;
  if (!diagnostic) return { found: true, verifiable: false, reason: "Failure has no diagnostic payload." };
  const result = {
    found: true,
    verifiable: true,
    phase: failure.phase || null,
    error: failure.error?.message || null,
    diagnosticKind: diagnostic.kind || null
  };
  if (!match?.initialDecks || !Array.isArray(match.sideboardHistory)) return result;
  const replayDecks = match.initialDecks.map((deck) => structuredClone(deck));
  let rejectedSwaps = 0;
  for (const entry of match.sideboardHistory) {
    if (!applyResolvedSideboardSwap(replayDecks[entry.seat], entry.action)) rejectedSwaps += 1;
  }
  result.sideboardReplay = {
    swaps: match.sideboardHistory.length,
    rejectedSwaps,
    startingChampionsPreserved: replayDecks.every((deck) => deck.main.some((card) => championMatchesLegend(card, deck.legend)))
  };
  return result;
}

async function readFailure(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return null; }
}
