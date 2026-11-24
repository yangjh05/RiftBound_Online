import { trainingTestDirectory } from "./helpers/training-temp.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createDashboardReader } from '../server/training-dashboard-data.mjs';
import { PILOT_CONTRACT, summarizePilotEvaluation, pilotProcessGroup } from '../server/training-dashboard-pilot.mjs';
import { selectTrainingProcesses } from '../server/training-dashboard-priority.mjs';
import { CONTINUOUS_PILOT_CONTRACT } from '../scripts/deck-pilot-continuation.mjs';
import { digest } from '../scripts/adaptive-policy-q-contract.mjs';

const deck = (id, legend) => ({ id, legend, main: [], runes: [], battlefields: [], sideboard: [] });
const config = { contract: PILOT_CONTRACT, deck: deck('viktor', 'OGN-265/298'), presetId: 'viktor-preset',
  opponentDecks: [deck('sett', 'OGN-269/298')], iterations: 4, gamesPerIteration: 32, workerProcesses: 2, sourceGeneration: 1490 };
const game = (extra = {}) => ({ completed: true, candidateSeat: 0, winnerId: 'p1', deckIds: ['viktor', 'sett'], ...extra });
async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, file.endsWith('.gz') ? gzipSync(JSON.stringify(value)) : JSON.stringify(value));
}
async function fixture(t) {
  const root = await trainingTestDirectory(t, 'pilot-dashboard');
  const main = path.join(root, 'main'), pilot = path.join(root, 'pilot');
  await json(path.join(main, 'config.json'), { gamesPerIteration: 32, deckIds: ['sett'] });
  await json(path.join(main, 'state.json.gz'), { iteration: 1 });
  await json(path.join(main, 'status.json'), { pid: 10, at: '2026-09-28T00:00:00Z', stage: 'fast-selfplay', iteration: 2 });
  await json(path.join(pilot, 'config.json'), { ...config, mainRunDirectory: main });
  await json(path.join(pilot, 'state.json.gz'), { iteration: 0 });
  await json(path.join(pilot, 'status.json'), { pid: 20, at: new Date().toISOString(), stage: 'mirror-collection', iteration: 1 });
  await json(path.join(main, 'side-training-reservation.json'), { directory: pilot, slots: 3 });
  const processes = [{ pid: 10, commandLine: `node ${main}/config.json` }, { pid: 20, commandLine: `node ${pilot}/config.json` },
    { pid: 21, parentPid: 20, commandLine: `node ${root}/scripts/ai-selfplay-worker-process.mjs` }];
  const reader = createDashboardReader({ dataRoot: root, getProcesses: () => processes });
  return { root, main, pilot, processes, reader };
}

test('pilot statistics separate candidate deck ownership, pretraining baseline, and mirror results', () => {
  const entries = [
    { name: 'mirror-0-0.json', game: game({ deckIds: ['viktor', 'viktor'] }) },
    { name: 'cross-0-0-before-0.json', game: game() },
    { name: 'cross-0-0-after-0.json', game: game({ winnerId: 'p2' }) },
    { name: 'cross-0-0-after-1.json', game: game({ candidateSeat: 1, winnerId: 'p2' }) },
    { name: 'cross-0-0-after-2.json', game: game({ candidateSeat: 1, winnerId: null }) },
    { name: 'cross-0-0-after-3.json', game: game({ invalid: true }) },
    { name: 'cross-0-0-after-4.json', game: game({ completed: false }) },
    { name: 'cross-0-0-after-5.json', game: game({ deckIds: ['wrong', 'sett'] }) },
    { name: 'cross-0-0-after-6.json', game: game({ adjudicated: true }) },
    { name: 'cross-0-0-after-7.json', game: game({ counted: false }) },
    { name: 'cross-99-0-after-0.json', game: game() }
  ];
  const result = summarizePilotEvaluation(entries, config);
  assert.equal(result.played, 5); assert.equal(result.invalid, 5); assert.equal(result.target, 128);
  assert.equal(result.mirror.winRate, 1);
  assert.equal(result.rows[0].before.winRate, 1); assert.equal(result.rows[0].after.winRate, 0);
  assert.equal(result.rows[1].after.winRate, .5); assert.equal(result.rows[1].after.draws, 1);
  assert.equal(result.rows[0].delta, null); assert.equal(result.rows[1].before.winRate, null);
});

test('before/after delta waits for each complete paired role sample', () => {
  const entries = [];
  for (const phase of ['before', 'after']) for (let block = 0; block < 4; block++) for (let i = 0; i < 8; i++) {
    const seat = i % 2;
    entries.push({ name: `cross-0-${block}-${phase}-${i}.json`, game: game({ candidateSeat: seat,
      winnerId: phase === 'after' ? `p${seat + 1}` : `p${2 - seat}` }) });
  }
  const complete = summarizePilotEvaluation(entries, config);
  assert.equal(complete.rows[0].delta, 1); assert.equal(complete.rows[1].delta, 1);
  entries.pop();
  const partial = summarizePilotEvaluation(entries, config);
  assert.equal(partial.rows[0].delta, 1); assert.equal(partial.rows[1].delta, null);
});

test('newer live pilot never replaces the main run and collection is not counted as trained', async t => {
  const { main, pilot, reader } = await fixture(t);
  for (let i = 0; i < 32; i++) await json(path.join(pilot, 'iterations/000001/games', `${i}.json.gz`), {});
  await json(path.join(pilot, 'iterations/000001/games/32.json.gz'), {});
  await json(path.join(pilot, 'iterations/000001/games/3.json.gz.tmp'), {});
  const before = await readFile(path.join(pilot, 'state.json.gz'));
  const names = await readdir(pilot), data = await reader(), p = data.pilots[0];
  assert.equal(data.runName, 'main'); assert.equal(data.running, true);
  assert.equal(p.running, true); assert.equal(p.training.collected, 32); assert.equal(p.training.trained, 0);
  assert.equal(p.training.target, 128); assert.equal(p.training.complete, false);
  assert.equal(p.evaluation.played, 0); assert.equal(p.evaluation.mirror.winRate, null);
  assert.deepEqual(p.workers, { processes: 2, collectors: 1, limit: 2, reservedSlots: 3, memoryBackpressured: false });
  assert.equal(p.mainConfigured, false); assert.equal(p.complete, false);
  assert.deepEqual(await readdir(pilot), names); assert.deepEqual(await readFile(path.join(pilot, 'state.json.gz')), before);
  await json(path.join(pilot, 'state.json.gz'), { iteration: 1, padding: 'new durable checkpoint cursor' });
  assert.equal((await reader()).pilots[0].training.trained, 32);
  const pinned = createDashboardReader({ dataRoot: path.dirname(main), runDirectory: main });
  assert.equal((await pinned()).pilots.length, 1);
});

test('partially written evaluation file is retried and never breaks the main dashboard', async t => {
  const { pilot, reader } = await fixture(t);
  const file = path.join(pilot, 'evaluation/cross-0-0-after-0.json');
  await json(file, game()); await writeFile(file, '{"completed":');
  const partial = await reader();
  assert.equal(partial.available, true); assert.equal(partial.pilots[0].evaluation.unreadable, 1);
  assert.equal(partial.pilots[0].evaluation.played, 0);
  await json(file, game());
  const complete = await reader();
  assert.equal(complete.pilots[0].evaluation.unreadable, 0); assert.equal(complete.pilots[0].evaluation.played, 1);
});

test('scheduled introduction stays pending until the committed main curriculum activates',async t=>{
  const {main,pilot,reader}=await fixture(t);
  const p={contract:'prospective-evaluated-deck-introduction-v1',deck:{id:'viktor'},gate:{directory:pilot,iteration:68},
    share:{numerator:1,denominator:10,blockGames:8}};
  await json(path.join(main,'deck-introduction-protocol.json'),p);
  let view=(await reader()).pilots[0];assert.equal(view.mainConfigured,false);assert.equal(view.integration.status,'waiting');
  assert.equal(view.integration.fraction,.1);assert.equal(view.integration.gateIteration,68);
  await json(path.join(main,'deck-introduction-status.json.gz'),{status:'active',protocolHash:'other',activation:{firstIteration:150}});
  view=(await reader()).pilots[0];assert.equal(view.mainConfigured,false);assert.equal(view.integration.status,'waiting');
  await json(path.join(main,'deck-introduction-status.json.gz'),{status:'active',protocolHash:digest(p),activation:{firstIteration:150}});
  view=(await reader()).pilots[0];assert.equal(view.mainConfigured,true);assert.equal(view.integration.firstIteration,150);
  await json(path.join(main,'deck-introduction-status.json.gz'),{status:'held',protocolHash:digest(p),reason:'invalid game'});
  view=(await reader()).pilots[0];assert.equal(view.mainConfigured,false);assert.equal(view.integration.status,'held');
});

test('stopped or reused PID cannot imply a running pilot; finishing the diagnostic never implies main integration', async t => {
  const { pilot, main, processes, reader } = await fixture(t);
  processes[1].commandLine = 'node another-project/config.json';
  await json(path.join(pilot, 'state.json.gz'), { iteration: 4 });
  await json(path.join(pilot, 'result.json.gz'), { status: 'diagnostic-complete-awaiting-review', trainingGames: 128,
    mainTrainingWeightsUpdated: false, summaries: [] });
  const p = (await reader()).pilots[0];
  assert.equal(p.running, false); assert.equal(p.workers.processes, 0);
  assert.equal(p.training.trained, 128); assert.equal(p.complete, true); assert.equal(p.mainConfigured, false);
  await json(path.join(main, 'config.json'), { gamesPerIteration: 32, deckIds: ['sett', 'viktor-preset'] });
  assert.equal((await reader()).pilots[0].mainConfigured, true);
});

test('main introduction counts committed training and protected games separately from in-flight collection', async t => {
  const { main, pilot, reader } = await fixture(t);
  const protocol = { contract: 'prospective-evaluated-deck-introduction-v1', deck: { id: 'viktor' },
    gate: { directory: pilot, iteration: 68 }, share: { numerator: 1, denominator: 10, blockGames: 8 } };
  const hash = digest(protocol), activatedAt = '2026-09-30T03:02:44.162Z';
  await json(path.join(main, 'deck-introduction-protocol.json'), protocol);
  await json(path.join(main, 'deck-introduction-status.json.gz'), { status: 'active', protocolHash: hash,
    activation: { firstIteration: 2, activatedAt, mainSourceGeneration: 1609 } });
  const plan = iteration => ({ iteration, games: 32, deckSearch: { population: [], assignments: [] },
    utility: { validationGameIndexes: [7, 15, 23, 31] },
    deckIntroduction: { protocolHash: hash, firstIteration: 2, deckId: 'viktor', gameIndexes: [0,1,2,3,4,5,6,7] } });
  await json(path.join(main, 'iterations/000002/plan.json.gz'), plan(2));
  for (const index of [0,1,2,7,8]) await json(path.join(main, `iterations/000002/games/${index}.json.gz`), {});
  await json(path.join(main, 'iterations/000002/games/3.json.gz.tmp'), {});
  let integration = (await reader()).pilots[0].integration;
  assert.equal(integration.activatedAt, activatedAt);
  assert.equal(integration.mainSourceGeneration, 1609);
  assert.equal(integration.progress.completedGames, 0);
  assert.equal(integration.progress.trainingGames, 0);
  assert.equal(integration.progress.currentCollected, 4);
  assert.equal(integration.progress.currentPlanned, 8);
  await json(path.join(main, 'state.json.gz'), { iteration: 2 });
  integration = (await reader()).pilots[0].integration;
  assert.equal(integration.progress.completedGames, 8);
  assert.equal(integration.progress.trainingGames, 7);
  assert.equal(integration.progress.validationGames, 1);
  assert.equal(integration.progress.complete, true);
  assert.equal((await reader()).pilots[0].integration.progress.completedGames, 8); // Polling cannot double-count.
  await json(path.join(main, 'state.json.gz'), { iteration: 3 });
  const changed = plan(3); changed.deckIntroduction.protocolHash = 'other';
  await json(path.join(main, 'iterations/000003/plan.json.gz'), changed);
  integration = (await reader()).pilots[0].integration;
  assert.equal(integration.progress.complete, false);
  assert.equal(integration.progress.completedGames, 8);
  await json(path.join(main, 'iterations/000003/plan.json.gz'), plan(3));
  integration = (await reader()).pilots[0].integration;
  assert.equal(integration.progress.complete, true);
  assert.equal(integration.progress.completedGames, 16);
  assert.equal(integration.progress.trainingGames, 14);
  assert.equal(integration.progress.validationGames, 2);
  await json(path.join(main, 'state.json.gz'), { iteration: 1 });
  assert.equal((await reader()).pilots[0].integration.progress.completedGames, 0);
});

test('pilot priority scope includes its controller before any worker starts and subsequent descendants', () => {
  const root = path.resolve('dashboard-project');
  const processes = [
    { pid: 1, commandLine: `node ${root}/frozen/scripts/train-deck-pilot.mjs ${root}/data/pilot/config.json` },
    { pid: 2, parentPid: 1, commandLine: 'node child.mjs' },
    { pid: 3, commandLine: `node ${root}-other/scripts/train-deck-pilot.mjs` },
    { pid: 4, commandLine: `node ${root}/scripts/ai-dashboard.mjs` }
  ];
  assert.deepEqual(selectTrainingProcesses(processes, root).map(p => p.pid), [1, 2]);
  assert.deepEqual(pilotProcessGroup(processes, 1, path.join(root, 'data/pilot')).map(p => p.pid), [1, 2]);
  assert.deepEqual(pilotProcessGroup(processes, 1, path.join(root, 'other-pilot')), []);
});

test('completed initial diagnostic cannot mark continuous training complete, and later evaluations stay separate', async t => {
  const { pilot, main, reader } = await fixture(t);
  const protocol = { contract: CONTINUOUS_PILOT_CONTRACT, configHash: digest({ ...config, mainRunDirectory: main }),
    afterIteration: 4, evaluationEveryIterations: 16, crossEvaluationEveryIterations: 64, automaticPromotion: false };
  await json(path.join(pilot, 'continuous-training-protocol.json'), protocol);
  await json(path.join(pilot, 'state.json.gz'), { iteration: 4, continuationHash: digest(protocol) });
  await json(path.join(pilot, 'status.json'), { pid: 20, at: new Date().toISOString(), stage: 'mirror-collection', iteration: 5 });
  await json(path.join(pilot, 'result.json.gz'), { status: 'diagnostic-complete-awaiting-review', trainingGames: 128, summaries: [] });
  for (let i = 1; i <= 4; i++) for (let g = 0; g < 32; g++) await json(path.join(pilot, `iterations/${String(i).padStart(6,'0')}/games/${g}.json.gz`), {});
  await json(path.join(pilot, 'iterations/000005/games/0.json.gz'), {});
  await json(path.join(pilot, 'evaluation/mirror-0-0.json'), game({ deckIds: ['viktor','viktor'] }));
  let p = (await reader()).pilots[0];
  assert.equal(p.continuous, true); assert.equal(p.complete, false); assert.equal(p.training.complete, false);
  assert.equal(p.training.target, null); assert.equal(p.training.targetIterations, null);
  assert.equal(p.training.collected, 129); assert.equal(p.training.trained, 128);
  assert.equal(p.training.currentIteration, 5); assert.equal(p.training.nextEvaluationIteration, 20);
  assert.equal(p.training.generation, 1495); assert.equal(p.training.savedGeneration, 1494);
  assert.equal(p.training.currentGames, 1); assert.equal(p.training.gamesPerIteration, 32);
  assert.deepEqual(p.schedule, { afterIteration: 4, mirrorEveryGames: 512, crossEveryGames: 2048,
    nextCrossIteration: 68, nextEvaluationKind: 'mirror' });
  assert.equal(p.evaluation.complete, true); assert.equal(p.evaluation.iteration, 4);
  await json(path.join(pilot, 'state.json.gz'), { iteration: 20, continuationHash: digest(protocol) });
  await json(path.join(pilot, 'status.json'), { pid: 20, at: new Date().toISOString(), stage: 'evaluation', iteration: 20 });
  await json(path.join(pilot, 'evaluations/000020/mirror-0-0.json'), game({ deckIds: ['viktor','viktor'], winnerId: 'p2' }));
  p = (await reader()).pilots[0];
  assert.equal(p.training.trained, 640); assert.equal(p.training.nextEvaluationIteration, 36);
  assert.equal(p.evaluation.iteration, 20); assert.equal(p.evaluation.complete, false);
  assert.equal(p.evaluation.target, 64); assert.equal(p.evaluation.played, 1);
  assert.equal(p.evaluation.mirror.winRate, 0); assert.deepEqual(p.evaluation.rows, []);
  assert.equal(p.training.iterations.length, 8); assert.equal(p.complete, false);
  assert.equal(p.training.iterations.at(-1).iteration, 20);
  assert.equal(p.training.collected, 640); // Old archives outside the window are represented by the durable cursor.
  assert.equal(p.crossEvaluation.iteration, 4); assert.equal(p.crossEvaluation.mirror.winRate, 1);
  assert.equal(p.crossEvaluation.rows.length, 2);
});

test('continuous dashboard uses saved model generation and schedules full cross evaluation at the protocol boundary', async t => {
  const { pilot, main, reader } = await fixture(t);
  const protocol = { contract: CONTINUOUS_PILOT_CONTRACT, configHash: digest({ ...config, mainRunDirectory: main }),
    afterIteration: 4, evaluationEveryIterations: 16, crossEvaluationEveryIterations: 64, automaticPromotion: false };
  await json(path.join(pilot, 'continuous-training-protocol.json'), protocol);
  const learnerPath = path.join(pilot, 'iterations/000067/candidate.json.gz');
  await json(learnerPath, { checkpoint: { generation: 2000, weights: { secret: 'not dashboard data' } } });
  await json(path.join(pilot, 'state.json.gz'), { iteration: 67, learnerPath, continuationHash: digest(protocol) });
  await json(path.join(pilot, 'status.json'), { pid: 20, at: new Date().toISOString(), stage: 'mirror-collection', iteration: 68 });
  await json(path.join(pilot, 'iterations/000068/games/0.json.gz'), {});
  await json(path.join(pilot, 'evaluations/000052/mirror-0-0.json'), game({ deckIds: ['viktor', 'viktor'] }));
  // A numeric regular file is not an evaluation directory.
  await json(path.join(pilot, 'evaluations/000068'), {});
  const p = (await reader()).pilots[0];
  assert.equal(p.training.generation, 2001); assert.equal(p.training.savedGeneration, 2000);
  assert.equal(p.training.nextEvaluationIteration, 68); assert.equal(p.schedule.nextEvaluationKind, 'full');
  assert.equal(p.schedule.nextCrossIteration, 68); assert.equal(p.training.collected, 67 * 32 + 1);
  assert.equal(p.evaluation.iteration, 52); assert.equal(p.crossEvaluation.iteration, 4);
  assert.equal(JSON.stringify(p).includes('not dashboard data'), false);
});
