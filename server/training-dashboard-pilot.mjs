import path from 'node:path';
import {createHash} from 'node:crypto';
import { dashboardDeck, dashboardSearchPlan } from './training-dashboard-decks.mjs';
import { estimateEvaluationEnd } from './training-dashboard-forecast.mjs';
import { validatePilotContinuation, pilotEvaluationSpec } from '../scripts/deck-pilot-continuation.mjs';

export const PILOT_CONTRACT = 'isolated-fixed-deck-pilot-v1';
const normalizedPath = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();
const samePath = (a, b) => Boolean(a && b && normalizedPath(a) === normalizedPath(b));
const emptyScore = () => ({ games: 0, wins: 0, losses: 0, draws: 0, winRate: null });
const validGame = game => game?.completed && !game.invalid && !game.adjudicated && game.counted !== false
  && [0, 1].includes(game.candidateSeat) && [null, undefined, 'p1', 'p2'].includes(game.winnerId);
const gameSummary = game => ({ completed: game.completed, invalid: game.invalid, adjudicated: game.adjudicated,
  counted: game.counted, candidateSeat: game.candidateSeat, winnerId: game.winnerId, deckIds: game.deckIds });
const modelSummary = payload => {
  const model = payload?.checkpoint || payload?.candidateCheckpoint || payload;
  return { generation: Number.isFinite(model?.generation) ? model.generation : null };
};

export function pilotProcessGroup(processes, pid, root) {
  const controller = processes.find(p => p.pid === pid && String(p.commandLine || '').replaceAll('\\', '/').toLowerCase().includes(normalizedPath(root)));
  if (!controller) return [];
  const selected = new Set([pid]);
  let changed;
  do {
    changed = false;
    for (const p of processes) if (selected.has(p.parentPid) && !selected.has(p.pid)) { selected.add(p.pid); changed = true; }
  } while (changed);
  return processes.filter(p => selected.has(p.pid));
}

// This is the fixed pilot's saved-file convention, not a training scheduler.
// Before/after and candidate deck ownership must never be pooled together.
export function summarizePilotEvaluation(entries, config) {
  const mirror = emptyScore(), rows = config.opponentDecks.flatMap(deck => {
    const descriptor = dashboardDeck(deck);
    const duplicate = config.opponentDecks.filter(d => d.legend?.cardNumber === deck.legend?.cardNumber).length > 1;
    const name = descriptor.legendName.split(',')[0] + (duplicate ? descriptor.auroraCount ? ' · 오로라' : ' · 비오로라' : '');
    return ['pilot', 'opponent'].map(role => ({ opponentId: deck.id, name, role, before: emptyScore(), after: emptyScore(), delta: null }));
  });
  let played = 0, invalid = 0;
  const add = (score, game) => {
    score.games++;
    if (!game.winnerId) score.draws++;
    else if (game.winnerId === `p${game.candidateSeat + 1}`) score.wins++;
    else score.losses++;
    score.winRate = score.wins / score.games;
  };
  for (const { name, game } of entries) {
    const mirrorMatch = /^mirror-([0-7])-([0-7])\.json$/.test(name);
    const cross = name.match(/^cross-(\d+)-([0-3])-(before|after)-([0-7])\.json$/);
    if (!mirrorMatch && (!cross || !config.opponentDecks[Number(cross[1])])) continue;
    if (!validGame(game)) { invalid++; continue; }
    const candidateId = game.deckIds?.[game.candidateSeat], otherId = game.deckIds?.[1 - game.candidateSeat];
    if (mirrorMatch) {
      if (candidateId !== config.deck.id || otherId !== config.deck.id) { invalid++; continue; }
      add(mirror, game);
    } else {
      const opponentId = config.opponentDecks[Number(cross[1])].id;
      if (!((candidateId === config.deck.id && otherId === opponentId) || (candidateId === opponentId && otherId === config.deck.id))) { invalid++; continue; }
      const row = rows.find(r => r.opponentId === opponentId && r.role === (candidateId === config.deck.id ? 'pilot' : 'opponent'));
      add(row[cross[3]], game);
    }
    played++;
  }
  // Each side of a cross matchup has 16 games after all four paired blocks.
  // Partial, differently composed samples cannot establish a before/after delta.
  for (const row of rows) if (row.before.games === 16 && row.after.games === 16) row.delta = row.after.winRate - row.before.winRate;
  return { played, invalid, target: 64 + config.opponentDecks.length * 64, mirror, rows };
}

// Completed plans are immutable. Cache their small totals per reader, so an
// endless run does not reread its whole history on every dashboard poll.
const introductionProgress = new WeakMap();
export async function readIntroductionProgress({ read, list, root, state, intro, firstIteration }) {
  let cache = introductionProgress.get(read);
  if (!cache) { cache = new Map(); introductionProgress.set(read, cache); }
  const key = `${root}:${intro.hash}:${firstIteration}`;
  const completed = state?.iteration || 0;
  let progress = cache.get(key);
  if (!progress || completed < progress.throughIteration) {
    progress = { throughIteration: firstIteration - 1, completedGames: 0, trainingGames: 0, validationGames: 0 };
    cache.set(key, progress);
  }
  const directory = iteration => path.join(root, 'iterations', String(iteration).padStart(6, '0'));
  const matches = plan => plan?.deckIntroduction?.protocolHash === intro.hash
    && plan.deckIntroduction.firstIteration === firstIteration && plan.deckIntroduction.deckId === intro.deckId
    && Array.isArray(plan.deckIntroduction.gameIndexes);
  // Rebuilding hundreds of compressed plans on cold start used to block the
  // whole API for minutes. Advance a bounded cursor on each refresh, and keep
  // complete=false until every committed plan has actually been checked.
  const throughThisRead = Math.min(completed, progress.throughIteration + 16);
  for (let iteration = progress.throughIteration + 1; iteration <= throughThisRead; iteration++) {
    const plan = await read(path.join(directory(iteration), 'plan.json.gz'), dashboardSearchPlan);
    if (!matches(plan)) break; // Missing/mismatched records remain unknown; retry next poll.
    const indexes = new Set(plan.deckIntroduction.gameIndexes);
    const validation = plan.validationGameIndexes.filter(index => indexes.has(index)).length;
    // The controller commits state.iteration only after validating every game
    // and saving the updated model. A collected-but-uncommitted batch is not trained.
    progress.completedGames += indexes.size;
    progress.validationGames += validation;
    progress.trainingGames += indexes.size - validation;
    progress.throughIteration = iteration;
  }
  let currentCollected = 0, currentPlanned = 0;
  const next = Math.max(firstIteration, completed + 1);
  const currentPlan = await read(path.join(directory(next), 'plan.json.gz'), dashboardSearchPlan);
  if (matches(currentPlan)) {
    const indexes = new Set(currentPlan.deckIntroduction.gameIndexes);
    currentPlanned = indexes.size;
    if (currentPlanned) currentCollected = (await list(path.join(directory(next), 'games')))
      .filter(file => /^(0|[1-9]\d*)\.json\.gz$/.test(file.name) && indexes.has(parseInt(file.name))).length;
  }
  return { ...progress, complete: progress.throughIteration >= completed,
    currentIteration: next, currentCollected, currentPlanned };
}

export async function readDashboardPilot({ root, config, status, read, list, processes, mainRoot, mainConfig, mainState, protocol }) {
  const state = await read(path.join(root, 'state.json.gz'));
  const continuation = validatePilotContinuation(config,
    await read(path.join(root, 'continuous-training-protocol.json')), state || {});
  const descriptor = dashboardDeck(config.deck);
  const group = pilotProcessGroup(processes, status?.pid, root);
  const running = group.length > 0;
  const iterations = [];
  const completedIterations = state?.iteration || 0;
  const currentIteration = Math.max(completedIterations, status?.iteration || completedIterations + 1);
  const latestIteration = continuation ? currentIteration : config.iterations;
  const savedModel = await read(state?.learnerPath, modelSummary);
  const savedGeneration = savedModel?.generation ?? config.sourceGeneration + completedIterations;
  // The durable cursor only advances after all games and the model validate.
  // Read the recent window, keeping dashboard cost bounded for an endless run.
  const firstIteration = continuation ? Math.max(1, latestIteration - 7) : 1;
  for (let iteration = firstIteration; iteration <= latestIteration; iteration++) {
    const directory = path.join(root, 'iterations', String(iteration).padStart(6, '0'));
    const files = (await list(path.join(directory, 'games'))).filter(e => /^(0|[1-9]\d*)\.json\.gz$/.test(e.name)
      && parseInt(e.name) < config.gamesPerIteration);
    iterations.push({ iteration, collected: files.length, trained: iteration <= (state?.iteration || 0), target: config.gamesPerIteration });
  }
  const trainingComplete = !continuation && completedIterations === config.iterations;
  const evaluationRounds = [config.iterations];
  if (continuation) {
    const rounds = (await list(path.join(root, 'evaluations'))).filter(e => e.isDirectory() && /^\d+$/.test(e.name)).map(e => Number(e.name))
      .filter(i => Number.isSafeInteger(i) && i > config.iterations && i <= completedIterations
        && pilotEvaluationSpec(config, i, continuation));
    evaluationRounds.push(...rounds);
  }
  async function evaluationAt(evaluationIteration) {
  const spec = pilotEvaluationSpec(config, evaluationIteration, continuation);
  const entries = [], completionTimes = [], directory = path.join(root, spec.directory);
  const files = (await list(directory)).filter(e => /^(mirror-\d+|cross-\d+-\d+-(before|after))-\d+\.json$/.test(e.name));
  let unreadable = 0;
  for (let i = 0; i < files.length; i += 8) await Promise.all(files.slice(i, i + 8).map(async file => {
    try {
      let mtime;
      const game = await read(path.join(directory, file.name), gameSummary, info => { mtime = info.mtimeMs; });
      if (game) { entries.push({ name: file.name, game }); if (validGame(game)) completionTimes.push(mtime); }
    } catch (error) {
      // Individual game files are written directly; retry an incomplete write on
      // the next poll without losing either the main run or other pilot results.
      if (error instanceof SyntaxError || error.code === 'ENOENT') unreadable++;
      else throw error;
    }
  }));
  const evaluation = summarizePilotEvaluation(entries, spec.full ? config : { ...config, opponentDecks: [] });
  evaluation.iteration = evaluationIteration;
  const candidate = await read(path.join(root, 'iterations', String(evaluationIteration).padStart(6, '0'), 'candidate.json.gz'), modelSummary);
  evaluation.generation = candidate?.generation ?? config.sourceGeneration + evaluationIteration;
  evaluation.kind = spec.full ? 'full' : 'mirror';
  evaluation.unreadable = unreadable;
  const result = await read(path.join(spec.initial ? root : directory, 'result.json.gz'), value => ({ status: value.status, trainingGames: value.trainingGames,
    evaluationGames: value.summaries?.length || 0, mainTrainingWeightsUpdated: value.mainTrainingWeightsUpdated }));
  const evaluationComplete = ['diagnostic-complete-awaiting-review', 'periodic-evaluation-complete'].includes(result?.status);
  evaluation.complete = evaluationComplete;
  evaluation.timing = estimateEvaluationEnd({ completionTimes, played: evaluation.played,
    ordinaryGames: evaluation.target, maximumGames: evaluation.target, finished: evaluationComplete,
    running: running && status?.stage === 'evaluation' && currentIteration === evaluationIteration });
  return { evaluation, result };
  }
  const latestEvaluationIteration = Math.max(...evaluationRounds);
  const latestCrossIteration = Math.max(...evaluationRounds.filter(i => pilotEvaluationSpec(config, i, continuation).full));
  const { evaluation, result } = await evaluationAt(latestEvaluationIteration);
  // A later mirror-only evaluation must not erase the last cross-deck comparison.
  const crossEvaluation = latestCrossIteration === latestEvaluationIteration ? evaluation : (await evaluationAt(latestCrossIteration)).evaluation;
  const complete = !continuation && evaluation.complete;
  const nextRound = every => continuation.afterIteration
    + (Math.floor(Math.max(0, completedIterations - continuation.afterIteration) / every) + 1) * every;
  const nextEvaluationIteration = continuation ? nextRound(continuation.evaluationEveryIterations) : config.iterations;
  const currentBatch = iterations.find(i => i.iteration === currentIteration);
  const related = samePath(config.mainRunDirectory, mainRoot);
  const intro=related?await read(path.join(mainRoot,'deck-introduction-protocol.json'),p=>({
    contract:p.contract,deckId:p.deck?.id,directory:p.gate?.directory,gateIteration:p.gate?.iteration,share:p.share,
    hash:createHash('sha256').update(JSON.stringify(p)).digest('hex')})):null;
  const introStatus=intro?await read(path.join(mainRoot,'deck-introduction-status.json.gz')):null;
  const matchingIntro=intro?.contract==='prospective-evaluated-deck-introduction-v1'
    &&intro.deckId===config.deck.id&&samePath(intro.directory,root);
  const matchedStatus=matchingIntro&&introStatus?.protocolHash===intro.hash?introStatus:null;
  const integration=matchingIntro?{status:matchedStatus?.status==='active'?'active':matchedStatus?.status==='held'?'held':'waiting',
    fraction:intro.share.numerator/intro.share.denominator,gateIteration:intro.gateIteration,
    firstIteration:matchedStatus?.activation?.firstIteration||null,reason:matchedStatus?.reason||null,
    reasons:matchedStatus?.reasons||[]}:null;
  if (integration?.status === 'active') {
    integration.activatedAt = matchedStatus.activation?.activatedAt || null;
    integration.mainSourceGeneration = matchedStatus.activation?.mainSourceGeneration ?? null;
    if (Number.isSafeInteger(integration.firstIteration) && integration.firstIteration > 0) {
      integration.progress = await readIntroductionProgress({ read, list, root: mainRoot, state: mainState,
        intro, firstIteration: integration.firstIteration });
    }
  }
  const mainConfigured = related && ((mainConfig.deckIds || []).some(id => id === config.presetId || id === config.deck.id)
    || (protocol?.anchors || []).some(deck => dashboardDeck(deck).legendId === descriptor.legendId)||integration?.status==='active');
  const reservation = await read(path.join(mainRoot, 'side-training-reservation.json'));
  return {
    runName: path.basename(root), name: descriptor.legendName.split(',')[0], related, running,
    stale: !status?.at || Date.now() - Date.parse(status.at) > 120000, updatedAt: status?.at || null,
    stage: status?.stage || 'prepared', error: status?.error || null, sourceGeneration: config.sourceGeneration,
    deck: descriptor, presetId: config.presetId, source: /^https?:\/\//.test(config.deck.source || '') ? config.deck.source : null,
    continuous: Boolean(continuation),
    schedule: continuation ? { afterIteration: continuation.afterIteration,
      mirrorEveryGames: continuation.evaluationEveryIterations * config.gamesPerIteration,
      crossEveryGames: continuation.crossEvaluationEveryIterations * config.gamesPerIteration,
      nextCrossIteration: nextRound(continuation.crossEvaluationEveryIterations),
      nextEvaluationKind: pilotEvaluationSpec(config, nextEvaluationIteration, continuation).full ? 'full' : 'mirror' } : null,
    training: { iterations, completedIterations, targetIterations: continuation ? null : config.iterations,
      collected: completedIterations * config.gamesPerIteration + iterations.filter(i => !i.trained).reduce((sum, i) => sum + i.collected, 0),
      trained: completedIterations * config.gamesPerIteration,
      target: continuation ? null : config.iterations * config.gamesPerIteration, complete: trainingComplete,
      nextEvaluationIteration, currentIteration, generation: savedGeneration + (currentIteration > completedIterations ? 1 : 0), savedGeneration,
      currentGames: currentBatch?.collected || 0, gamesPerIteration: config.gamesPerIteration,
      epoch: status?.metrics?.epoch ?? null },
    workers: { processes: group.length, collectors: group.filter(p => /ai-selfplay-worker-process\.mjs/.test(p.commandLine || '')).length,
      limit: config.workerProcesses, reservedSlots: samePath(reservation?.directory, root) ? reservation.slots : 0,
      memoryBackpressured: Boolean(status?.workerPool?.memoryBackpressured) },
    evaluation, crossEvaluation, complete, mainConfigured, integration, automaticPromotion: config.automaticPromotion === true,
    result: result || null
  };
}
