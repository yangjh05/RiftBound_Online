import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { DEFAULT_AI_MODEL } from "../src/ai/policy.mjs";
import { deckLeaderboard } from "../src/ai/deckbuilding.mjs";
import { evaluateModel, runSelfPlayTraining } from "../src/ai/training.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const games = Math.max(1, Number(args.games) || 100);
const maxActions = Math.max(80, Number(args["max-actions"]) || 500);
const evaluationGames = Math.max(2, Number(args["evaluation-games"]) || 20);
const output = path.resolve(args.output || "src/ai/checkpoints/champion.json");
const seed = (Number(args.seed) || Date.now()) >>> 0;
let state = seed || 1;
const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
const champion = await loadModel(output);
const decks = Object.values(decklists);

console.log(`Training generation ${champion.generation + 1} for ${games} self-play games across ${decks.length} seed decks...`);
const trained = runSelfPlayTraining({
  model: champion,
  decks,
  games,
  maxActions,
  random,
  temperature: Number(args.temperature) || 0.85,
  evolveEvery: Math.max(2, Number(args["evolve-every"]) || 10),
  maxPopulation: Math.max(decks.length, Number(args.population) || decks.length * 2)
});
const evaluation = evaluateModel(trained.model, champion, decks, { games: evaluationGames, maxActions, random });
const promoted = evaluation.promoted || args["force-promote"] === "true" || champion.gamesTrained === 0;
if (promoted) {
  trained.model.metadata.promoted = true;
  trained.model.metadata.evaluation = evaluation;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(trained.model, null, 2)}\n`, "utf8");
}
const leaderboard = deckLeaderboard(trained.model).slice(0, 10);
console.log(JSON.stringify({ seed, promoted, evaluation, output, leaderboard }, null, 2));

async function loadModel(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return structuredClone(DEFAULT_AI_MODEL); }
}
