import { spawnSync } from "node:child_process";
import { decklists } from "../src/cards.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const decks = Object.values(decklists);
const policies = ["random", "first", "last", "accept", "decline"];
const requested = Math.max(decks.length * 2, Number(args.scenarios) || 80);
const maxActions = Math.max(50, Number(args["max-actions"]) || 500);
const baseSeed = (Number(args.seed) || 20260713) >>> 0;
const scenarios = generateScenarios(requested, baseSeed);
const startedAt = Date.now();

for (let index = 0; index < scenarios.length; index += 1) {
  const scenario = scenarios[index];
  const commandArgs = ["scripts/fuzz-games.mjs", "--games", "1", "--max-actions", String(maxActions), "--seed", String(scenario.seed),
    "--deck-a", scenario.deckA, "--deck-b", scenario.deckB, "--first-player", scenario.firstPlayer, "--choice-policy", scenario.policy];
  const run = spawnSync(process.execPath, commandArgs, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (run.status !== 0) {
    console.error(JSON.stringify({ scenario, replay: `node ${commandArgs.join(" ")}` }, null, 2));
    if (run.stdout) console.error(run.stdout);
    if (run.stderr) console.error(run.stderr);
    process.exit(1);
  }
  if ((index + 1) % 10 === 0 || index + 1 === scenarios.length) console.log(`Scenario progress: ${index + 1}/${scenarios.length}`);
}

console.log(`Passed ${scenarios.length} generated scenarios covering ${decks.length} decks in both seats, ${policies.length} choice policies, and both first-player positions (${((Date.now() - startedAt) / 1000).toFixed(1)}s).`);

function generateScenarios(count, seed) {
  const output = [];
  let state = seed || 1;
  const nextSeed = () => (state = (state * 1664525 + 1013904223) >>> 0);
  // The first two rounds guarantee that every deck appears in each seat.
  for (let index = 0; index < decks.length; index += 1) {
    output.push(make(index, (index * 5 + 3) % decks.length));
    output.push(make((index * 7 + 1) % decks.length, index));
  }
  // Remaining scenarios use coprime rotations to spread ordered matchups without clustering.
  for (let index = output.length; index < count; index += 1) {
    const a = index % decks.length;
    let b = (a + 1 + ((index * 7) % (decks.length - 1))) % decks.length;
    if (b === a) b = (b + 1) % decks.length;
    output.push(make(a, b));
  }
  return output.slice(0, count);

  function make(a, b) {
    const index = output.length;
    return {
      id: `scenario-${String(index + 1).padStart(3, "0")}`,
      deckA: decks[a].id,
      deckB: decks[b].id,
      firstPlayer: index % 2 ? "p2" : "p1",
      policy: policies[index % policies.length],
      seed: nextSeed()
    };
  }
}
