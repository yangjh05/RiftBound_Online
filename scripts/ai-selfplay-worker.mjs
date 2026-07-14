import { parentPort, workerData } from "node:worker_threads";
import { decklists } from "../src/cards.mjs";
import { collectSequential, hydrateWorkerModel } from "../src/ai/neural/selfplay.mjs";

const allDecks = Object.values(decklists);
const requested = new Set(workerData.deckIds || []);
const decks = requested.size ? allDecks.filter((deck) => requested.has(deck.id)) : allDecks;
const model = hydrateWorkerModel(workerData.model);
const league = (workerData.league || []).map(hydrateWorkerModel);
const result = collectSequential({
  games: workerData.games,
  decks,
  model,
  league,
  meta: workerData.meta,
  matchFraction: workerData.matchFraction,
  shapingWeight: workerData.shapingWeight,
  seed: workerData.seed,
  maxActions: workerData.maxActions,
  temperature: workerData.temperature
});

parentPort.postMessage(result);
