import { parentPort, workerData } from "node:worker_threads";
import { decklists } from "../src/cards.mjs";
import { collectBaselineImitation } from "../src/ai/neural/imitation.mjs";
import { seededRandom } from "../src/ai/neural/selfplay.mjs";

const requested = new Set(workerData.deckIds || []);
const decks = Object.values(decklists).filter((deck) => !requested.size || requested.has(deck.id));
const result = collectBaselineImitation({
  decks,
  games: workerData.games,
  maxAttempts: workerData.maxAttempts,
  maxActions: workerData.maxActions,
  meta: workerData.meta,
  metaFraction: workerData.metaFraction,
  gameOffset: workerData.gameOffset,
  random: seededRandom(workerData.seed),
  onProgress(progress) {
    if (progress.completed === progress.targetGames || progress.attempted % 4 === 0) {
      parentPort.postMessage({ kind: "progress", workerIndex: workerData.workerIndex, progress });
    }
  }
});

parentPort.postMessage({ kind: "result", workerIndex: workerData.workerIndex, result });
