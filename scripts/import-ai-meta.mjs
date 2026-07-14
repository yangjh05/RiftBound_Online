import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeMetaSnapshot } from "../src/ai/meta.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
if (!args.input) throw new Error("Usage: npm run ai:meta:import -- --input <meta.json> [--source name]");
const output = path.resolve(args.output || "data/ai/meta/current.json");
const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8"));
const snapshot = normalizeMetaSnapshot(payload, { source: args.source });
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, decks: snapshot.decks.length, games: snapshot.games, cards: Object.keys(snapshot.cardStats).length }));
