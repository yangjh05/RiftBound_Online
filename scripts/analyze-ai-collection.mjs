import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.dataDir) throw new Error("--data-dir is required.");

const generation = Number(options.generation || 2);
const gamesRoot = path.join(options.dataDir, "resume", `generation-${String(generation).padStart(5, "0")}`, "games");
const gameDirectories = await findGameDirectories(gamesRoot);
const manifests = await Promise.all(gameDirectories.map(async (directory) => ({
  directory,
  manifest: JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
})));
const collectionKey = options.collectionKey || manifests
  .slice()
  .sort((left, right) => String(right.manifest.createdAt).localeCompare(String(left.manifest.createdAt)))[0]?.manifest.collectionKey;
const deckStats = new Map();
const gameRows = [];

for (const { directory, manifest } of manifests) {
  if (manifest.collectionKey !== collectionKey) continue;
  const summary = manifest.summaries?.[0];
  if (!summary?.completed || !Array.isArray(summary.scores) || !Array.isArray(summary.deckIds)) continue;

  const actionCounts = [new Map(), new Map()];
  const valueComparisons = [{ count: 0, sumGap: 0, preferredAction: 0 }, { count: 0, sumGap: 0, preferredAction: 0 }];
  for (const trajectory of manifest.trajectories || []) {
    const playerIndex = summary.deckIds.findIndex((_, index) => `p${index + 1}` === trajectory.metadata?.playerId);
    if (playerIndex < 0) continue;
    for (const chunkName of trajectory.chunks || []) {
      const chunk = await readTrajectoryArchive(path.join(directory, chunkName));
      for (const step of chunk.steps || []) {
        const action = parseAction(step.selectedActionKey);
        increment(actionCounts[playerIndex], action.kind || "unknown");
        if (Number.isFinite(step.selectedActionValue) && Number.isFinite(step.stopActionValue)) {
          const gap = step.selectedActionValue - step.stopActionValue;
          valueComparisons[playerIndex].count += 1;
          valueComparisons[playerIndex].sumGap += gap;
          valueComparisons[playerIndex].preferredAction += gap > 0 ? 1 : 0;
        }
      }
    }
  }

  const row = {
    worker: manifest.workerIndex,
    game: manifest.gameIndex,
    decks: summary.deckIds,
    scores: summary.scores,
    winner: summary.winnerId,
    actions: summary.actions,
    firstPlayer: summary.firstPlayerId,
    actionCounts,
    valueComparisons
  };
  gameRows.push(row);

  for (let seat = 0; seat < 2; seat += 1) {
    const deckId = summary.deckIds[seat];
    const stats = deckStats.get(deckId) || { games: 0, wins: 0, scoresFor: 0, scoresAgainst: 0, actions: new Map(), valueComparison: { count: 0, sumGap: 0, preferredAction: 0 } };
    stats.games += 1;
    stats.wins += summary.winnerId === `p${seat + 1}` ? 1 : 0;
    stats.scoresFor += summary.scores[seat];
    stats.scoresAgainst += summary.scores[1 - seat];
    mergeCounts(stats.actions, actionCounts[seat]);
    stats.valueComparison.count += valueComparisons[seat].count;
    stats.valueComparison.sumGap += valueComparisons[seat].sumGap;
    stats.valueComparison.preferredAction += valueComparisons[seat].preferredAction;
    deckStats.set(deckId, stats);
  }
}

console.log(`Generation ${generation}: ${gameRows.length} completed games (collection ${collectionKey})`);
for (const [deckId, stats] of [...deckStats].sort(([left], [right]) => left.localeCompare(right))) {
  const totalDecisions = sumCounts(stats.actions);
  console.log(`\n${deckId}: ${stats.wins}/${stats.games} wins, score ${stats.scoresFor}:${stats.scoresAgainst}, ${totalDecisions} recorded decisions`);
  console.log(formatCounts(stats.actions, totalDecisions));
  if (stats.valueComparison.count) console.log(`action-vs-stop value gap=${(stats.valueComparison.sumGap / stats.valueComparison.count).toFixed(4)}, action preferred=${(stats.valueComparison.preferredAction / stats.valueComparison.count * 100).toFixed(1)}% (${stats.valueComparison.count} comparisons)`);
}

if (options.games) {
  console.log("\nGames");
  for (const row of gameRows.sort((left, right) => left.worker - right.worker || left.game - right.game)) {
    console.log(`worker ${row.worker} game ${row.game}: ${row.decks[0]} ${row.scores[0]}:${row.scores[1]} ${row.decks[1]} (${row.winner}, first ${row.firstPlayer}, ${row.actions} actions)`);
    for (let seat = 0; seat < 2; seat += 1) {
      const total = sumCounts(row.actionCounts[seat]);
      console.log(`  p${seat + 1} ${formatCounts(row.actionCounts[seat], total)}`);
    }
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--games") parsed.games = true;
    else if (token.startsWith("--")) parsed[toCamelCase(token.slice(2))] = args[index + 1], index += 1;
  }
  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function findGameDirectories(root) {
  const directories = [];
  for (const worker of await readdir(root, { withFileTypes: true })) {
    if (!worker.isDirectory()) continue;
    const workerDirectory = path.join(root, worker.name);
    for (const game of await readdir(workerDirectory, { withFileTypes: true })) {
      if (game.isDirectory()) directories.push(path.join(workerDirectory, game.name));
    }
  }
  return directories;
}

function parseAction(key) {
  try {
    return JSON.parse(key);
  } catch {
    return { kind: "invalid" };
  }
}

function increment(counts, key, amount = 1) {
  counts.set(key, (counts.get(key) || 0) + amount);
}

function mergeCounts(target, source) {
  for (const [key, count] of source) increment(target, key, count);
}

function sumCounts(counts) {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

function formatCounts(counts, total) {
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([kind, count]) => `${kind}=${count} (${total ? (count / total * 100).toFixed(1) : "0.0"}%)`)
    .join(", ");
}
