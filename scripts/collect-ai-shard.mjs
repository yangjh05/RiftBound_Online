import { readFile } from "node:fs/promises";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { deckAllowedInPool } from "../src/card-pools.mjs";
import { deserializeNeuralModel } from "../src/ai/neural/model.mjs";
import { collectParallelSelfPlay } from "../src/ai/neural/selfplay.mjs";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { buildMetaPreset } from "../src/ai/meta-presets.mjs";
import { applyMetaSnapshot } from "../src/ai/meta.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const checkpointPath = path.resolve(args.checkpoint || "src/ai/checkpoints/neural-champion.json");
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
const model = deserializeNeuralModel(checkpoint);
const shardIndex = Math.max(0, Number(args["shard-index"]) || 0);
const shardCount = Math.max(1, Number(args["shard-count"]) || 1);
if (shardIndex >= shardCount) throw new Error("shard-index must be smaller than shard-count");
const poolId = args["card-pool"] || model.knowledge?.cardPoolId || "origins-era";
if (!model.knowledge?.externalMeta) applyMetaSnapshot(model.knowledge, buildMetaPreset("origins-houston-2025"));
const decks = Object.values(decklists).filter((deck) => deckAllowedInPool(deck, poolId));
const result = await collectParallelSelfPlay({
  games: Math.max(1, Number(args.games) || 64),
  workers: Math.max(1, Number(args.workers) || 4),
  decks,
  model,
  meta: model.knowledge,
  matchFraction: Number(args["match-fraction"]) || 0.25,
  maxActions: Math.max(80, Number(args["max-actions"]) || 600),
  seed: ((Number(args.seed) || 20251207) + shardIndex * 1000003) >>> 0
});
const output = path.resolve(args.output || `data/ai/shards/generation-${String(model.generation + 1).padStart(5, "0")}-shard-${String(shardIndex).padStart(3, "0")}-of-${String(shardCount).padStart(3, "0")}.json.gz`);
await writeTrajectoryArchive(output, { version: 1, modelGeneration: model.generation, targetGeneration: model.generation + 1, cardPoolId: poolId, shardIndex, shardCount, createdAt: new Date().toISOString(), ...result });
console.log(JSON.stringify({ output, shardIndex, shardCount, trajectories: result.trajectories.length, summaries: result.summaries.length }));
