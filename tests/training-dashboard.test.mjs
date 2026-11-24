import { trainingTestDirectory } from "./helpers/training-temp.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createDashboardReader, summarizeGames } from "../server/training-dashboard-data.mjs";
import { createPriorityController, selectTrainingProcesses, PRIORITIES } from "../server/training-dashboard-priority.mjs";
import { startDashboard } from "../scripts/ai-dashboard.mjs";
import {boundedMatchPlan,frozenMatchExpectedGame} from '../scripts/adaptive-policy-q-contract.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = t => trainingTestDirectory(t, "dashboard");
async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, file.endsWith(".gz") ? gzipSync(JSON.stringify(value)) : JSON.stringify(value));
}
const game = (extra = {}) => ({ completed: true, counted: true, candidateSeat: 0, winnerId: "p1", deckIds: ["origins-sett", "origins-sett"],
  aiSeats: [{ role: "candidate", generation: 9 }, { role: "champion", generation: 6 }], ...extra });

test("evaluation statistics exclude invalid games and distinguish wins from draw-adjusted score", () => {
  const result = summarizeGames([game(), game({ candidateSeat: 1, winnerId: "p2", deckIds: ["origins-sett", "origins-kaisa"] }),
    game({ winnerId: "p2" }), game({ winnerId: null }), game({ invalid: true }), game({ completed: false }), game({ adjudicated: true }), game({ counted: false })]);
  assert.deepEqual([result.played, result.valid, result.wins, result.losses, result.draws, result.invalid], [8, 4, 2, 1, 1, 4]);
  assert.equal(result.winRate, .5); assert.equal(result.score, .625);
  assert.equal(result.decks.find(d => d.id === "origins-kaisa").winRate, 1);
  assert.equal(result.trend.at(-1).y, .5);
  assert.equal(summarizeGames([]).winRate, null);
});

test("process selection isolates this checkout and follows only its training descendants", () => {
  const root = path.resolve("C:/projects/riftbound");
  const processes = [
    { pid: 1, commandLine: `node scripts/train-adaptive-policy-q.mjs "${root}/data/config.json"` },
    { pid: 2, parentPid: 1, commandLine: "node worker.mjs" },
    { pid: 3, parentPid: 2, commandLine: "node child.mjs" },
    { pid: 4, commandLine: `node ${root}/scripts/ai-dashboard.mjs` },
    { pid: 5, commandLine: `node ${root}-other/scripts/train-adaptive-policy-q.mjs config.json` },
    { pid: 6, commandLine: `node ${root}/scripts/dev-server.mjs` },
    { pid: 7, commandLine: `node ${root}/scripts/ai-selfplay-worker-process.mjs` },
    { pid: 8, commandLine: "node scripts/train-adaptive-policy-q.mjs data/ai/run/config.json" },
    { pid: 9, parentPid: 8, commandLine: `node ${root}/scripts/ai-selfplay-worker-process.mjs` }
  ];
  assert.deepEqual(selectTrainingProcesses(processes, root).map(p => p.pid), [1, 2, 3, 7, 8, 9]);
});

test("saved priority applies to current and newly created training workers", async t => {
  const root = await temporary(t), settingsFile = path.join(root, "priority.json");
  const processes = [{ pid: 1, commandLine: `node ${root}/scripts/train-adaptive-policy-q.mjs config.json` }];
  const actual = new Map([[1, PRIORITIES.normal]]);
  const control = createPriorityController({ projectRoot: root, settingsFile, supported: true, listProcesses: async () => processes,
    getPriority: pid => actual.get(pid), setPriority: (pid, value) => actual.set(pid, value) });
  const initial = await control.set("below-normal");
  assert.equal(initial.errors.length, 0); assert.equal(actual.get(1), PRIORITIES["below-normal"]);
  processes.push({ pid: 2, parentPid: 1, commandLine: "node worker.mjs" }); actual.set(2, PRIORITIES.normal);
  await control.refresh(); assert.equal(actual.get(2), PRIORITIES["below-normal"]);
  assert.equal(JSON.parse(await readFile(settingsFile)).priority, "below-normal");
  await assert.rejects(control.set("realtime"));
  assert.equal(JSON.parse(await readFile(settingsFile)).priority, "below-normal");
});

test("priority permissions and silent OS downgrades are reported without killing training", async t => {
  const root = await temporary(t);
  const control = createPriorityController({ projectRoot: root, supported: true,
    listProcesses: async () => [{ pid: 1, commandLine: `node ${root}/scripts/train-adaptive-policy-q.mjs` }, { pid: 2, parentPid: 1 }],
    getPriority: () => PRIORITIES.normal, setPriority: pid => { if (pid === 2) throw new Error("Access denied"); } });
  const result = await control.set("high");
  assert.equal(result.errors.length, 2); assert.equal(result.requested, "high");
});

test("preload passes the persisted priority to new descendants even with stale inherited environment", async t => {
  const root = await temporary(t), settingsFile = path.join(root, "priority.json");
  await json(settingsFile, { priority: "below-normal" });
  const hook = path.join(projectRoot, "scripts/ai-training-priority.cjs");
  const script = `const fs=require('node:fs'),os=require('node:os'),cp=require('node:child_process');
    const before=os.getPriority();
    fs.writeFileSync(process.env.RIFTBOUND_AI_PROCESS_PRIORITY_FILE,JSON.stringify({priority:'low'}));
    const next=JSON.parse(cp.execFileSync(process.execPath,['-e','console.log(JSON.stringify({priority:require("node:os").getPriority(),requested:process.env.RIFTBOUND_AI_PROCESS_PRIORITY}))'],{encoding:'utf8',windowsHide:true,timeout:90000}));
    console.log(JSON.stringify({before,next}));`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--require", hook, "-e", script], {
    windowsHide: true, timeout: 120000, env: { ...process.env, NODE_OPTIONS: "", RIFTBOUND_AI_PROCESS_PRIORITY: "high", RIFTBOUND_AI_PROCESS_PRIORITY_FILE: settingsFile }
  });
  const result = JSON.parse(stdout);
  assert.equal(result.before, PRIORITIES["below-normal"]);
  assert.equal(result.next.priority, PRIORITIES.low);
  assert.equal(result.next.requested, "low");
});

test("dashboard follows the live run, tails events, keeps evaluation purposes separate and never writes training data", async t => {
  const root = await temporary(t), active = path.join(root, "runs-group", "adaptive-active"), old = path.join(root, "adaptive-old");
  for (const directory of [active, old]) {
    await json(path.join(directory, "config.json"), { gamesPerIteration: 2, epochs: 4, deckIds: ["origins-sett"] });
    await json(path.join(directory, "learner.json.gz"), { checkpoint: { generation: 10, gamesTrained: 64, weights: { private: "do not expose" } } });
    await json(path.join(directory, "champion.json.gz"), { checkpoint: { generation: 6, gamesTrained: 32 } });
    await json(path.join(directory, "state.json.gz"), { iteration: 2, learnerPath: path.join(directory, "learner.json.gz"), championPath: path.join(directory, "champion.json.gz"), freshEvidence: [{}, {}] });
    await json(path.join(directory, "status.json"), { pid: directory === active ? 123 : 456, stage: "frozen-evaluation-running", at: directory === active ? "2026-09-15T12:00:00Z" : "2026-09-16T12:00:00Z" });
  }
  const eventPath = path.join(active, "events.jsonl");
  await writeFile(eventPath, JSON.stringify({ stage: "fast-selfplay", iteration: 3, at: "2026-09-15T12:00:00Z" }) + "\n");
  await json(path.join(active, "iterations/000003/games/0.json.gz"), {});
  for (const [name, purpose] of [["000001", "champion-promotion"], ["000002", "tactical-baseline-progress"]]) {
    const directory = path.join(active, "evaluations", name);
    await json(path.join(directory, "request.json.gz"), { purpose, plan: { ordinal: Number(name), blocks: 5, minimumObservedWinRate: .52 }, candidatePath: path.join(active, "learner.json.gz") });
    await json(path.join(directory, "games/0.json"), game());
    if (name === "000001") await json(path.join(directory, "result.json.gz"), { decision: { promoted: true, outcome: "passed", score: 1, lowerBound: .6, upperBound: 1 } });
    else await json(path.join(directory, "progress.json"), { game: 1, decision: { promoted: true, outcome: "passed" }, at: "2026-09-15T12:00:00Z" });
  }
  const reader = createDashboardReader({ dataRoot: root, getProcesses: () => [{ pid: 123, commandLine: `node ${active}/config.json` }] });
  const before = await readdir(active);
  const result = await reader();
  assert.equal(result.runName, "adaptive-active"); assert.equal(result.running, true);
  assert.equal(result.progress.generation, 11); assert.equal(result.progress.phaseProgress, .5);
  assert.equal(result.evaluations[0].promoted, true); assert.equal(result.evaluations[1].promoted, false);
  assert.equal(result.currentEvaluationId, "000002"); assert.equal(result.totalEvaluationGames, 2);
  assert.equal(JSON.stringify(result).includes("do not expose"), false);
  // Incomplete final writes must wait for their newline instead of failing JSON parsing.
  const next = JSON.stringify({ stage: "candidate-policy-training", iteration: 3, epoch: 2, epochs: 4, metrics: { meanLoss: .25 }, at: "2026-09-15T12:01:00Z" });
  await appendFile(eventPath, next.slice(0, 20)); assert.equal((await reader()).progress.stage, "fast-selfplay");
  await appendFile(eventPath, next.slice(20) + "\n");
  const updated = await reader(); assert.equal(updated.progress.phaseProgress, .5); assert.equal(updated.progress.phaseUnit, "epoch");
  assert.equal(updated.losses[0].loss, .25); assert.deepEqual(await readdir(active), before);

  // A reboot-damaged line must not prevent later events in the same read from
  // appearing, or silently disappear from the warning on subsequent refreshes.
  const recovered = JSON.stringify({ stage: "candidate-q-training", iteration: 3, at: "2026-09-15T12:02:00Z" });
  await appendFile(eventPath, "\0".repeat(4096) + '{"stage":\nnull\n' + recovered + "\n");
  const preserved = await readFile(eventPath);
  const recoveredSnapshot = await reader();
  assert.equal(recoveredSnapshot.progress.stage, "candidate-q-training");
  assert.equal(recoveredSnapshot.warnings.length, 1);
  assert.match(recoveredSnapshot.warnings[0], /2줄/);
  assert.equal(recoveredSnapshot.totalEvaluationGames, 2);
  assert.deepEqual((await reader()).warnings, recoveredSnapshot.warnings);
  assert.deepEqual(await readFile(eventPath), preserved);
  // A replaced/truncated log starts a fresh parser and warning count.
  await writeFile(eventPath, recovered + "\n");
  assert.deepEqual((await reader()).warnings, []);
});

test("empty training folders are a waiting state rather than made-up zero statistics", async t => {
  const reader = createDashboardReader({ dataRoot: await temporary(t) });
  const result = await reader(); assert.equal(result.available, false); assert.equal(result.learner, undefined);
});

test('dashboard retains sparse file indices and refreshes forecasts after the missing game arrives',async t=>{
  const root=await temporary(t),model=path.join(root,'model.json.gz'),directory=path.join(root,'evaluations/000001');
  await json(model,{checkpoint:{generation:1}});
  await json(path.join(root,'config.json'),{gamesPerIteration:32,deckIds:['a','b','c','d','e']});
  await json(path.join(root,'state.json.gz'),{iteration:1,learnerPath:model,championPath:model});
  await json(path.join(root,'status.json'),{pid:123,stage:'fast-selfplay',at:new Date().toISOString()});
  const plan=boundedMatchPlan({candidateHash:'candidate',opponentHash:'opponent',ordinal:1,
    deckIds:['a','b','c','d','e'],randomSeed:42,purpose:'champion-promotion'});
  await json(path.join(directory,'request.json.gz'),{plan,purpose:'champion-promotion',candidatePath:model});
  const make=i=>{const expected=frozenMatchExpectedGame(plan,i);return game({...expected,invalid:false,adjudicated:false,winnerId:`p${expected.candidateSeat+1}`});};
  for(let i=0;i<201;i++)if(i!==1)await json(path.join(directory,`games/${i}.json`),make(i));
  const reader=createDashboardReader({dataRoot:root,runDirectory:root,getProcesses:()=>[{pid:123,commandLine:`node ${root}/config.json`}]});
  const sparse=(await reader()).evaluations[0];assert.equal(sparse.played,200);assert.equal(sparse.forecast.status,'collecting');
  assert.equal(sparse.forecast.sourceGames,0);
  await json(path.join(directory,'games/1.json'),make(1));
  const complete=(await reader()).evaluations[0];assert.equal(complete.played,201);assert.equal(complete.forecast.status,'estimated');
  assert.equal(complete.forecast.sourceGames,200);
});

test("local HTTP control checks host, origin, token, supported priorities and asset allowlist", async t => {
  let requested = "normal", calls = 0;
  const controller = { processes: [], get status() { return { requested, supported: true, processes: [], errors: [] }; },
    refresh: async t => {}, set: async value => { requested = value; calls++; return controller.status; } };
  const { server, url } = await startDashboard({ projectRoot, port: 0, priorityController: controller,readLeagueSnapshot:async()=>null,
    readSnapshot: async () => ({ available: false, fetchedAt: new Date().toISOString() }) });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const page = await fetch(url); assert.equal(page.status, 200); assert.match(await page.text(), /AI 학습 현황/);
  for (const asset of ["/dashboard.mjs", "/structure.mjs", "/dashboard.css"]) assert.equal((await fetch(url + asset)).status, 200);
  const stateResponse = await fetch(url + "/api/state"), state = await stateResponse.json();
  assert.equal(stateResponse.headers.get("cache-control"), "no-store"); assert.ok(state.token);
  const send = (headers, body = { priority: "high" }) => fetch(url + "/api/priority", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await send({})).status, 403);
  assert.equal((await send({ Origin: "https://unrelated.example", "X-Dashboard-Token": state.token })).status, 403);
  // Node fetch rewrites Host; use a raw request to exercise DNS-rebinding checks.
  const rejectedHost = await new Promise((resolve, reject) => {
    const req = http.get(url + "/api/state", { headers: { Host: "attacker.example" } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
  });
  assert.equal(rejectedHost, 403);
  assert.equal((await fetch(url + "/api/state", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  const headers = { Origin: url, "X-Dashboard-Token": state.token };
  assert.equal((await send(headers, { priority: "realtime" })).status, 400); assert.equal(calls, 0);
  assert.equal((await send(headers, { priority: "normal", excess: "x".repeat(1200) })).status, 413);
  const changed = await send(headers, { priority: "below-normal" }); assert.equal(changed.status, 200);
  assert.equal((await changed.json()).requested, "below-normal"); assert.equal(calls, 1);
  assert.equal((await fetch(url + "/data/ai/process-priority.json")).status, 404);
});
