import { trainingTestDirectory } from "./helpers/training-temp.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { decklists } from "../src/cards.mjs";
import { repairTrainingDeck, mutateLegalTrainingDeck, trainingDeckRecord } from "../src/ai/legal-decks.mjs";
import { dashboardDeck, dashboardSearchPlan, summarizeDashboardDeckSearch } from "../server/training-dashboard-decks.mjs";
import { createDashboardReader } from "../server/training-dashboard-data.mjs";

const original = Object.values(decklists).find(deck => deck.id === "proving-grounds-master-yi");
const anchor = repairTrainingDeck(original);
const control = repairTrainingDeck(Object.values(decklists).find(deck => deck.id === "keenan-xiong"));
const variant = { ...mutateLegalTrainingDeck(anchor, {}, () => .35), searchMode: "local", seedAnchorId: anchor.id };
const protocol = { anchors: [anchor, control], poolId: "origins-era", afterIteration: 202,
  mixture: { anchor: .5, local: .25, broad: .25 } };
const plan = { iteration: 204, games: 32, utility: { validationGameIndexes: [1, 9, 17, 25] },
  deckSearch: { poolId: "origins-era", population: [anchor, control, variant],
    assignments: [{ mode: "anchor", testedDeckId: anchor.id }, { mode: "local", testedDeckId: variant.id }] } };
const report = { iteration: 203, decks: [anchor, control].map((deck, i) => ({ id: deck.id,
  deck: trainingDeckRecord(deck), games: i ? 0 : 14, winRate: i ? .5 : .53, opponentsSeen: i ? 0 : 2, mode: "anchor" })) };
const state = { deckSearch: { iteration: 203, candidates: [], stats: { [anchor.id]: { wins: 8,
  opponents: { [anchor.legend.cardNumber]: { games: 14, wins: 8 } } } } }, freshEvidence: [
  { archivePath: "/run/iterations/000202/games/0.json.gz", role: "training" },
  { archivePath: "/run/iterations/000203/games/0.json.gz", role: "training" },
  { archivePath: "C:\\run\\iterations\\000203\\games\\1.json.gz", role: "validation" },
  { archivePath: "/run/iterations/000204/games/0.json.gz", role: "training" }
] };

test("deck display exposes Korean card lists, legal Origins composition, and actual Aurora counts", () => {
  const first = dashboardDeck(anchor), second = dashboardDeck(control);
  assert.equal(first.auroraCount, 3);
  assert.equal(second.auroraCount, 0);
  assert.equal(first.highCostCount, 12);
  assert.equal(second.highCostCount, 3);
  assert.equal(second.quality, "repaired-main-unverified");
  assert.equal(first.legal, true);
  assert.equal(second.legal, true);
  assert.equal(first.mainCount, 40);
  assert.ok(first.legendName.includes("마스터 이"));
  assert.ok(first.zones.main.every(card => card.name && card.number && card.count > 0));
});

test("search summary separates committed scores, pending candidates and held-out games", () => {
  const snapshot = JSON.stringify({ state, protocol, plan, report });
  const result = summarizeDashboardDeckSearch({ protocol, state, plan: dashboardSearchPlan(plan), report, history: [report], currentGames: 3 });
  assert.equal(result.completedIterations, 1);
  assert.equal(result.committedGames, 2);
  assert.equal(result.trainingGames, 1);
  assert.equal(result.heldOutGames, 1);
  assert.equal(result.currentGames, 3);
  assert.equal(result.scoreIteration, 203);
  assert.equal(result.decks.find(d => d.id === control.id).score, null, "A neutral prior with zero games is not a measured 50%.");
  assert.equal(result.decks.find(d => d.id === variant.id).pending, true);
  assert.equal(result.decks.find(d => d.id === variant.id).score, null);
  assert.equal(result.decks.find(d => d.id === anchor.id).score, .53);
  assert.equal(result.history[0].points.find(d => d.id === control.id).score, null);
  assert.equal(JSON.stringify({ state, protocol, plan, report }), snapshot);
  assert.deepEqual(summarizeDashboardDeckSearch({}), { enabled: false });
  assert.equal(summarizeDashboardDeckSearch({ protocol, state, report: null }).reportPending, true);
});

test("dashboard reads real search manifests and distinct legal evaluation IDs without loading model weights or writing data", async t => {
  const root = await trainingTestDirectory(t, "dashboard-decks");
  const put = async (file, value) => {
    const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.endsWith(".gz") ? gzipSync(JSON.stringify(value)) : JSON.stringify(value));
  };
  await put("config.json", { deckIds: [original.id], gamesPerIteration: 32, epochs: 4 });
  await put("learner.json.gz", { checkpoint: { generation: 1014, weights: { secret: "NEVER EXPOSE" } } });
  await put("champion.json.gz", { checkpoint: { generation: 982 } });
  await put("state.json.gz", { ...state, iteration: 203, learnerPath: path.join(root, "learner.json.gz"), championPath: path.join(root, "champion.json.gz") });
  await put("status.json", { stage: "fast-selfplay", iteration: 204, pid: 42, at: new Date().toISOString() });
  await put("deck-search-protocol.json", protocol);
  await put("iterations/000204/plan.json.gz", plan);
  await put("iterations/000203/deck-search-report.json.gz", report);
  await put("iterations/000204/games/0.json.gz", { trajectories: "SHOULD NOT BE READ" });
  await put("evaluations/000053/request.json.gz", { decks: [anchor], candidatePath: path.join(root, "learner.json.gz"),
    plan: { ordinal: 53, blocks: 5, deckIds: [anchor.id] } });
  await put("evaluations/000053/games/0.json", { completed: true, candidateSeat: 0, winnerId: "p1", deckIds: [anchor.id, anchor.id] });
  await put("evaluations/000053/result.json.gz", { decision: { outcome: "not-promoted", promoted: false } });
  await writeFile(path.join(root, "events.jsonl"), JSON.stringify({ stage: "candidate-policy-training", iteration: 204,
    epoch: 1, epochs: 4, meanLoss: .2, at: new Date().toISOString() }) + "\n");
  const before = await readFile(path.join(root, "state.json.gz"));
  const reader = createDashboardReader({ dataRoot: root, runDirectory: root, getProcesses: () => [{ pid: 42, commandLine: `node ${root}/config.json` }] });
  const value = await reader();
  assert.equal(value.deckSearch.currentGames, 1);
  assert.equal(value.deckSearch.decks.length, 3);
  assert.ok(value.decks.some(d => d.id === anchor.id && d.name.includes("합법 기준")));
  assert.equal(value.evaluations[0].deckConfiguration, "origins-legal");
  assert.equal(value.losses[0].loss, .2);
  assert.ok(!JSON.stringify(value).includes("NEVER EXPOSE"));
  assert.ok(!JSON.stringify(value).includes("SHOULD NOT BE READ"));
  assert.deepEqual(await readFile(path.join(root, "state.json.gz")), before);
});
