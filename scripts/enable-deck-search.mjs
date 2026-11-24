import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decklists } from "../src/cards.mjs";
import { resolveTrainingDecks } from "../src/ai/training-decks.mjs";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { readLiveFileLockOwner } from "./file-lock.mjs";
import { createDeckSearchProtocol, readDeckSearchProtocol } from "./adaptive-deck-search.mjs";

export async function enableDeckSearch(directory) {
  const root = path.resolve(directory);
  assert.equal(await readLiveFileLockOwner(path.join(root, "controller.lock")), null,
    "Finish and stop the active controller at a saved iteration before enabling deck search.");
  const existing = await readDeckSearchProtocol(root);
  if (existing) return existing;
  const config = JSON.parse((await readFile(path.join(root, "config.json"), "utf8")).replace(/^\uFEFF/, ""));
  const state = await readTrajectoryArchive(path.join(root, "state.json.gz"));
  const pending = path.join(root, "iterations", String(state.iteration + 1).padStart(6, "0"), "plan.json.gz");
  try { await access(pending); throw new Error("Finish the pending frozen iteration before changing the deck curriculum."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const protocol = createDeckSearchProtocol(resolveTrainingDecks(decklists, "origins-era", config.deckIds), state.iteration);
  await writeFile(path.join(root, "deck-search-protocol.json"), JSON.stringify(protocol, null, 2), { flag: "wx" });
  return protocol;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/enable-deck-search.mjs <adaptive-run-directory>");
  const protocol = await enableDeckSearch(process.argv[2]);
  console.log(JSON.stringify({ contract: protocol.contract, afterIteration: protocol.afterIteration,
    poolId: protocol.poolId, anchors: protocol.anchors.map(deck => ({ id: deck.id, name: deck.playerName,
      legend: deck.legend.name, replacedCards: deck.seedRepair.length, seedQuality: deck.seedQuality })) }, null, 2));
}
