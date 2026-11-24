import { readFile, readdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { forecastEvaluation, estimateEvaluationEnd, estimateTrainingEnd, normalizeTrainingStage, evaluationPrefixLength } from "./training-dashboard-forecast.mjs";
import { dashboardDeck, dashboardSearchPlan, summarizeDashboardDeckSearch } from "./training-dashboard-decks.mjs";
import {evaluationRoundGames,isMixedMatchPlan} from '../scripts/mixed-match-schedule.mjs';
import { PILOT_CONTRACT, readDashboardPilot } from './training-dashboard-pilot.mjs';
import {summarizePolicyLossEvent} from './training-dashboard-loss.mjs';
import {EXPERIMENT_CONTRACTS, sameRun, readLearningAnchor, readLearningExperiment} from './training-dashboard-learning.mjs';

const unzip = promisify(gunzip);
const list = async directory => { try { return await readdir(directory, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return []; throw e; } };
const numeric = value => Number.isFinite(value) ? value : null;
export const DECK_NAMES = { "origins-sett": "세트", "proving-grounds-annie": "애니", "origins-kaisa": "카이사", "proving-grounds-master-yi": "마스터 이", "origins-leona": "레오나" };

function createReader() {
  const cache = new Map();
  return async function read(file, project = value => value, onStat = null) {
    if (!file) return null;
    let info;
    try { info = await stat(file); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
    onStat?.(info);
    const key = `${info.mtimeMs}:${info.size}`;
    if (cache.get(file)?.key === key) return cache.get(file).value;
    const bytes = await readFile(file);
    const value = project(JSON.parse((file.endsWith(".gz") ? (await unzip(bytes)).toString("utf8") : bytes.toString("utf8")).replace(/^\uFEFF/, "")));
    cache.set(file, { key, value });
    if (cache.size > 20000) cache.delete(cache.keys().next().value);
    return value;
  };
}

export function checkpointSummary(payload) {
  const c = payload?.checkpoint || payload?.candidateCheckpoint || payload;
  return c ? { generation: numeric(c.generation), gamesTrained: numeric(c.gamesTrained), trainedAt: c.metadata?.trainedAt || null } : null;
}

export function summarizeGames(games, names = {}) {
  let wins = 0, losses = 0, draws = 0, invalid = 0;
  const decks = {}, trend = [], matchups = {}, groups = {};
  games.forEach((game, index) => {
    if (!game.completed || game.invalid || game.adjudicated || game.counted === false || ![0, 1].includes(game.candidateSeat)) { invalid++; return; }
    const deckId = game.deckIds?.[game.candidateSeat] || "unknown";
    const deck = decks[deckId] ||= { id: deckId, name: names[deckId] || DECK_NAMES[deckId] || deckId, games: 0, wins: 0, losses: 0, draws: 0 };
    const opponentId=game.deckIds?.[1-game.candidateSeat] || 'unknown';
    const ids=[deckId,opponentId].sort(), key=JSON.stringify(ids), kind=deckId===opponentId?'mirror':'cross';
    const pair=matchups[key] ||= {id:key,deckIds:ids,name:ids.map(id=>names[id]||DECK_NAMES[id]||id).join(' ↔ '),kind,games:0,wins:0,losses:0,draws:0};
    const group=groups[kind] ||= {kind,games:0,wins:0,losses:0,draws:0};
    for(const item of [pair,group]) {
      item.games++;
      if(!game.winnerId)item.draws++;
      else if(game.winnerId===`p${game.candidateSeat+1}`)item.wins++;
      else item.losses++;
    }
    deck.games++;
    if (!game.winnerId) { draws++; deck.draws++; }
    else if (game.winnerId === `p${game.candidateSeat + 1}`) { wins++; deck.wins++; }
    else { losses++; deck.losses++; }
    const valid = wins + losses + draws;
    // Keep the live curve compact, while always retaining its newest point.
    if (valid === 1 || valid % Math.max(1, Math.ceil(games.length / 160)) === 0 || index === games.length - 1) trend.push({ x: valid, y: wins / valid });
  });
  const valid = wins + losses + draws;
  return { played: games.length, valid, wins, losses, draws, invalid, winRate: valid ? wins / valid : null,
    score: valid ? (wins + draws / 2) / valid : null, trend,
    matchups:Object.values(matchups).map(d=>({...d,winRate:d.wins/d.games})),
    groups:Object.fromEntries(Object.entries(groups).map(([k,d])=>[k,{...d,winRate:d.wins/d.games}])),
    decks: Object.values(decks).map(d => ({ ...d, winRate: d.wins / d.games, score: (d.wins + d.draws / 2) / d.games })) };
}

// Follow only the few run-directory levels, never the large trajectory/model trees.
export async function discoverTrainingRuns(dataRoot) {
  const found = [];
  const visit = async (directory, depth) => {
    const entries = await list(directory);
    if (entries.some(e => e.name === "config.json") && entries.some(e => e.name === "state.json.gz")) { found.push(directory); return; }
    if (depth === 0) return;
    for (const entry of entries) if (entry.isDirectory() && !/^(iterations|evaluations|state-bank|evaluator-bootstrap|progress|resume|learner|runs|inputs|games|replays|selfplay-replays|tactical-refresh|node_modules|test.*)$/.test(entry.name)) await visit(path.join(directory, entry.name), depth - 1);
  };
  await visit(dataRoot, 3);
  return found;
}

function eventReader() {
  let currentFile, offset = 0, pending = "", training = null, damagedLines = 0;
  const losses = new Map(), counts = new Map(), activity = [];
  const cycles = new Map();
  return async file => {
    if (file !== currentFile) { currentFile = file; offset = 0; pending = ""; training = null; damagedLines = 0; losses.clear(); counts.clear(); cycles.clear(); activity.length = 0; }
    let handle;
    try {
      handle = await open(file, "r");
      const info = await handle.stat();
      if (info.size < offset) { offset = 0; pending = ""; training = null; damagedLines = 0; losses.clear(); counts.clear(); cycles.clear(); activity.length = 0; }
      while (offset < info.size) {
        const buffer = Buffer.alloc(Math.min(info.size - offset, 1024 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        offset += bytesRead;
        // Events contain Korean text: preserve incomplete UTF-8 bytes across chunks.
        pending += buffer.subarray(0, bytesRead).toString("latin1");
        const lines = pending.split("\n"); pending = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          // A system crash can leave a torn or zero-filled line. Keep the
          // original log, report the gap, and continue with later valid events.
          let event;
          try { event = JSON.parse(Buffer.from(line, "latin1").toString("utf8")); }
          catch (error) { if (!(error instanceof SyntaxError)) throw error; damagedLines++; continue; }
          if (!event || typeof event !== "object" || Array.isArray(event)) { damagedLines++; continue; }
          const phase = normalizeTrainingStage(event.stage), at = Date.parse(event.at);
          if (event.iteration != null && Number.isFinite(at) && ["fast-selfplay", "candidate-policy-training", "candidate-q-training", "tactical-refresh-collection", "tactical-refresh-training", "candidate-saved-learning-continues"].includes(phase)) {
            const cycle = cycles.get(event.iteration) || { iteration: event.iteration, phases: {} };
            if (phase === "candidate-saved-learning-continues") cycle.end = at;
            else cycle.phases[phase] ??= at;
            cycles.set(event.iteration, cycle);
            if (cycles.size > 128) cycles.delete(cycles.keys().next().value);
          }
          if (event.iteration != null && !event.stage?.startsWith("frozen-evaluation") && event.stage !== "champion-promoted") training = event;
          const policyLoss = event.metrics?.meanLoss ?? event.meanLoss;
          if (event.stage === "candidate-policy-training" && Number.isFinite(policyLoss)) losses.set(event.iteration, summarizePolicyLossEvent(event,losses.get(event.iteration)));
          if (event.stage === "fast-selfplay-game-saved" && event.completed) {
            const minute = event.at?.slice(0, 16); counts.set(minute, (counts.get(minute) || 0) + 1);
          }
          if (["champion-promoted", "frozen-evaluation-completed", "training-failed", "candidate-saved-learning-continues"].includes(event.stage)) {
            activity.push({ stage: event.stage, iteration: event.iteration, at: event.at, outcome: event.decision?.outcome });
            if (activity.length > 12) activity.shift();
          }
        }
      }
      return { training, damagedLines, cycles: [...cycles.values()], losses: [...losses.values()].slice(-120), throughput: [...counts].slice(-60).map(([at, games]) => ({ at, games })), activity: [...activity].reverse() };
    } catch (e) { if (e.code !== "ENOENT") throw e; return { training: null, losses: [], throughput: [], activity: [] }; }
    finally { await handle?.close(); }
  };
}

export function createDashboardReader({ dataRoot, runDirectory = null, getProcesses = () => [] }) {
  const read = createReader(), learningRead = createReader(), anchorRead = createReader(), events = eventReader();
  const forecasts = new Map();
  let directories = [], discoveredAt = 0;
  async function evaluation(root, name) {
    const directory = path.join(root, "evaluations", name);
    const request = await read(path.join(directory, "request.json.gz"));
    if (!request) return null;
    const [result, progress, entries] = await Promise.all([
      read(path.join(directory, "result.json.gz")), read(path.join(directory, "progress.json")), list(path.join(directory, "games"))
    ]);
    const files = entries.filter(e => /^\d+\.json$/.test(e.name)).sort((a, b) => parseInt(a.name) - parseInt(b.name));
    const games = [], completionTimes = [];
    // Bounded I/O concurrency keeps the dashboard from flooding training's disk queue.
    for (let i = 0; i < files.length; i += 24) await Promise.all(files.slice(i, i + 24).map(async f => {
      games[parseInt(f.name)]=await read(path.join(directory,'games',f.name),undefined,
        info=>{if(!result)completionTimes.push(info.mtimeMs);});
    }));
    const names = Object.fromEntries((request.decks || []).map(deck => [deck.id,
      `${dashboardDeck(deck).legendName}${request.decks.some(other=>other.id!==deck.id && other.legend?.cardNumber===deck.legend?.cardNumber)
        ? (dashboardDeck(deck).auroraCount ? ' · 오로라' : ' · 비오로라') : ''} · 합법 기준`]));
    const stats = summarizeGames(games.filter(Boolean), names), first = games.find(Boolean);
    const decision = result?.decision || progress?.decision || null;
    const purpose = request.purpose || "champion-promotion";
    let forecast = null;
    if (!result) {
      const roundGames = request.plan.deckIds?.length ? evaluationRoundGames(request.plan) : 8;
      const key = `${directory}:${Math.floor(evaluationPrefixLength(games) / roundGames)}`;
      if (!forecasts.has(key)) {
        forecasts.set(key, forecastEvaluation(request.plan, games));
        if (forecasts.size > 16) forecasts.delete(forecasts.keys().next().value);
      }
      forecast = forecasts.get(key);
    }
    return { id: name, ordinal: request.plan.ordinal, purpose, deckConfiguration: request.decks ? "origins-legal" : "legacy",
      running:!result && getProcesses().some(p=>String(p.commandLine || '').replaceAll('\\','/').toLowerCase().includes(path.join(directory,'request.json.gz').replaceAll('\\','/').toLowerCase())),
      evaluationFormat:isMixedMatchPlan(request.plan)?'balanced-mirror-and-cross':'mirror',
      decisionReview:request.decisionReview||null,
      forecast, completionTimes,
      generation: first?.aiSeats?.find(s => s.role === "candidate")?.generation ?? (await read(request.candidatePath, checkpointSummary))?.generation ?? null,
      opponentGeneration: first?.aiSeats?.find(s => s.role === "champion")?.generation ?? null,
      ...stats, maximumGames: request.plan.blocks * 8,
      ordinaryGames: purpose === 'tactical-baseline-progress' ? request.plan.blocks * 8 : request.plan.budgetPolicy?.ordinaryGames || request.plan.blocks * 8,
      minimumWinRate: request.plan.minimumObservedWinRate ?? null,
      regressionFloor: request.plan.regressionFloor ?? null,
      finished: Boolean(result), updatedAt: progress?.at || null,
      outcome: result ? decision?.outcome || (decision?.promoted ? "passed" : "not-promoted") : "running",
      promoted: purpose === "champion-promotion" && decision?.promoted === true,
      decision: decision ? { score: numeric(decision.score), lowerBound: numeric(decision.lowerBound), upperBound: numeric(decision.upperBound),
        evaluatedGames: decision.evaluatedGames ?? decision.games ?? null, confidence: numeric(decision.confidence),
        regressionGuardsPassed: decision.observedRegressionGuardsPassed ?? null, method: decision.method || request.plan.contract } : null };
  }
  const finishedEvaluations = new Map();
  const loadedEvaluations = new Set();
  return async function snapshot() {
    if (!directories.length || Date.now() - discoveredAt > 15000) {
      directories = await discoverTrainingRuns(dataRoot);
      if (runDirectory && !directories.includes(path.resolve(runDirectory))) directories.push(path.resolve(runDirectory));
      discoveredAt = Date.now();
    }
    const runs = await Promise.all(directories.map(async root => ({ root, status: await read(path.join(root, "status.json")),
      config: await read(path.join(root, 'config.json')) })));
    const candidates = runs.filter(run => run.config?.contract !== PILOT_CONTRACT && !EXPERIMENT_CONTRACTS.includes(run.config?.contract)
      && (!runDirectory || run.root === path.resolve(runDirectory)));
    const processes = getProcesses();
    const live = value => processes.some(p => p.pid === value.status?.pid && (
      p.commandLine?.replaceAll("\\", "/").toLowerCase().includes(value.root.replaceAll("\\", "/").toLowerCase())
      || p.commandLine?.replaceAll("\\", "/").toLowerCase().includes(path.relative(path.dirname(path.dirname(dataRoot)), value.root).replaceAll("\\", "/").toLowerCase())
    ));
    candidates.sort((a, b) => Number(live(b)) - Number(live(a)) || String(b.status?.at || "").localeCompare(String(a.status?.at || "")));
    const selected = candidates[0];
    if (!selected) return { available: false, fetchedAt: new Date().toISOString(), message: "학습 기록을 기다리고 있습니다." };
    const { root, status } = selected;
    const [state, config, log, entries] = await Promise.all([read(path.join(root, "state.json.gz")), read(path.join(root, "config.json")), events(path.join(root, "events.jsonl")), list(path.join(root, "evaluations"))]);
    const [learner, champion] = await Promise.all([read(state.learnerPath, checkpointSummary), read(state.championPath, checkpointSummary)]);
    const training = log.training || status || {};
    const iteration = training.iteration ?? state.iteration + 1;
    const gamesDirectory = path.join(root, "iterations", String(iteration).padStart(6, "0"), "games");
    const completedGames = (await list(gamesDirectory)).filter(e => /^\d+\.json\.gz$/.test(e.name)).length;
    const stage = training.stage || status?.stage;
    const learningWarnings = [], experiments = [];
    let learningAnchor = {enabled:false};
    try { learningAnchor = await readLearningAnchor({root,state,read:anchorRead}); }
    catch(error) { learningWarnings.push(`학습 기준점 기록 확인 실패 (${error.code || error.message})`); }
    const experimentRuns = runs.filter(run=>EXPERIMENT_CONTRACTS.includes(run.config?.contract) && sameRun(run.config.mainRunDirectory,root));
    if(learningAnchor.comparisonDirectory && !experimentRuns.some(r=>sameRun(r.root,learningAnchor.comparisonDirectory))) {
      const directory=learningAnchor.comparisonDirectory;
      const c=await learningRead(path.join(directory,'config.json'));
      if(c && EXPERIMENT_CONTRACTS.includes(c.contract) && sameRun(c.mainRunDirectory,root)) experimentRuns.push({root:directory,config:c,status:await learningRead(path.join(directory,'status.json'))});
    }
    for(const run of experimentRuns) {
      try { experiments.push(await readLearningExperiment({...run,read:learningRead,list,processes})); }
      catch(error) { learningWarnings.push(`${path.basename(run.root)} 비교 학습 기록 확인 실패 (${error.code || error.message})`); }
    }
    experiments.sort((a,b)=>Number(sameRun(b.directory,learningAnchor.comparisonDirectory))-Number(sameRun(a.directory,learningAnchor.comparisonDirectory)));
    const reservation=await read(path.join(root,'side-training-reservation.json'));
    const protocol = await read(path.join(root, "deck-search-protocol.json"));
    const pilotWarnings = [], pilots = [];
    for (const run of runs.filter(run => run.config?.contract === PILOT_CONTRACT)) {
      try {
        pilots.push(await readDashboardPilot({ ...run, read, list, processes, mainRoot: root, mainConfig: config, mainState: state, protocol }));
      } catch (error) {
        pilotWarnings.push(`${path.basename(run.root)} 별도 학습 기록을 읽지 못했습니다. 다음 갱신에서 다시 확인합니다. (${error.code || error.name})`);
      }
    }
    pilots.sort((a, b) => Number(b.related) - Number(a.related) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    let deckSearch = { enabled: false };
    if (protocol) {
      const committedIteration = state.deckSearch?.iteration ?? protocol.afterIteration;
      const iterationRoot = number => path.join(root, "iterations", String(number).padStart(6, "0"));
      const plan = await read(path.join(iterationRoot(iteration), "plan.json.gz"), dashboardSearchPlan);
      const report = committedIteration > protocol.afterIteration
        ? await read(path.join(iterationRoot(committedIteration), "deck-search-report.json.gz")) : null;
      const history = [];
      // Small reports only, bounded concurrency and a bounded chart history.
      const first = Math.max(protocol.afterIteration + 1, committedIteration - 39);
      for (let start = first; start <= committedIteration; start += 4) {
        const batch = await Promise.all(Array.from({ length: Math.min(4, committedIteration - start + 1) }, (_, offset) =>
          read(path.join(iterationRoot(start + offset), "deck-search-report.json.gz"))));
        history.push(...batch.filter(Boolean));
      }
      deckSearch = summarizeDashboardDeckSearch({ protocol, state, plan, report, history,
        currentGames: plan ? completedGames : 0 });
    }
    const isLearning = ["candidate-policy-training", "candidate-q-training", "tactical-refresh-training"].includes(stage);
    const isCommitted = iteration <= state.iteration;
    const allEvaluations = [];
    const evaluationEntries=entries.filter(e=>e.isDirectory() && /^\d+$/.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name));
    // Prioritize the current match and last result. Historical thousands of
    // small game files are restored in bounded batches, without blocking live
    // status on a cold start or reporting a partial history as complete.
    const loadNow=new Set([...evaluationEntries].reverse().filter(e=>!loadedEvaluations.has(path.join(root,e.name))).slice(0,2).map(e=>e.name));
    for (const entry of evaluationEntries) {
      const key = path.join(root, entry.name);
      if(!loadedEvaluations.has(key) && !loadNow.has(entry.name))continue;
      const item = finishedEvaluations.get(key) || await evaluation(root, entry.name);
      if (item) { loadedEvaluations.add(key); allEvaluations.push(item); if (item.finished) finishedEvaluations.set(key, item); }
    }
    const current = allEvaluations.findLast(e => e.running) || allEvaluations.at(-1) || null;
    const target = stage === "tactical-refresh-collection" ? training.games : config.gamesPerIteration || 32;
    const phaseTotal = stage?.startsWith('live-policy-audit') || stage==='learner-anchor-selected' ? null : isLearning ? (stage === "candidate-q-training" ? null : training.epochs || config.epochs) : target;
    const phaseDone = isLearning ? (stage === "candidate-q-training" ? null : training.epoch || 0)
      : stage === "tactical-refresh-collection" ? training.game || 0 : completedGames;
    return { available: true, fetchedAt: new Date().toISOString(), runName: path.basename(root),
      running: live(selected), updatedAt: status?.at || null, stale: Date.now() - Date.parse(status?.at || 0) > 120000,
      learner, champion, deckSearch, pilots, learningAnchor, experiments,
      resources:{processCount:processes.length,maximum:config.maximumWorkers ?? null,sideReserved:reservation?.slots ?? 0},
      evaluations: allEvaluations.map(({ completionTimes, ...item }) => ({ ...item,
        timing: estimateEvaluationEnd({ completionTimes, ...item, running: item.running }) })), currentEvaluationId: current?.id || null,
      totalEvaluationGames: allEvaluations.reduce((sum, e) => sum + e.played, 0),
      evaluationHistory:{loaded:allEvaluations.length,total:evaluationEntries.length,complete:allEvaluations.length===evaluationEntries.length},
      decks: [...new Map([...(config.deckIds || []).map(id => ({ id, name: DECK_NAMES[id] || id })),
        ...allEvaluations.flatMap(item => item.decks.map(deck => ({ id: deck.id, name: deck.name })))].map(deck => [deck.id, deck])).values()],
      losses: log.losses, throughput: log.throughput, activity: log.activity,
      warnings: [...(log.damagedLines ? [`손상된 진행 기록 ${log.damagedLines}줄을 제외하고 표시합니다. 학습 추이 일부가 누락될 수 있습니다.`] : []), ...pilotWarnings, ...learningWarnings],
      progress: { stage, iteration, generation: learner?.generation == null ? null : learner.generation + (isCommitted ? 0 : 1),
        completedGames, targetGames: target, phaseDone, phaseTotal, phaseProgress: phaseTotal ? Math.min(1, phaseDone / phaseTotal) : null,
        phaseUnit: isLearning ? "epoch" : "경기", gamesSaved: state.freshEvidence?.length || 0,
        timing: estimateTrainingEnd({ current: log.cycles?.find(c => c.iteration === iteration), completed: log.cycles?.filter(c => c.end) || [], stage,
          running: live(selected), committed: isCommitted }),
        completedAudits: state.completedAudits?.length || 0, pendingEvaluation: Boolean(state.pendingEvaluationCandidate),
        error: status?.stage === "training-failed" ? status.error : null }
    };
  };
}
