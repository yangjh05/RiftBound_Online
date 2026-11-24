import path from 'node:path';
import {createHash} from 'node:crypto';
import {leagueEvaluationJobs} from '../scripts/league-evaluation-schedule.mjs';

export const START_COMPARISON = 'paired-champion-current-learning-v1';
export const LEAGUE_COMPARISON = 'isolated-paired-league-policy-v1';
export const EXPERIMENT_CONTRACTS = [START_COMPARISON, LEAGUE_COMPARISON];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();
export const sameRun = (a, b) => Boolean(a && b && normalized(a) === normalized(b));
const model = value => {
  const checkpoint = value?.checkpoint || value?.candidateCheckpoint || value;
  return {generation: checkpoint?.generation ?? null};
};
const candidateSummary = value => ({...model(value), beforeHash:value.beforeBehaviorHash, afterHash:value.afterBehaviorHash,
  guards:(value.epochGuards || []).map(g => ({passed:g.passed === true, finite:g.finitePassed,
    lessons:g.lessonRetention?.passed, training:g.lessonRetention?.training?.passed,
    validation:g.lessonRetention?.validation?.passed}))});
const rowsSummary = value => ({planHash:value.planHash, summaries:(value.summaries || []).filter(Boolean).map(s => ({
  completed:s.completed, invalid:s.invalid, adjudicated:s.adjudicated, counted:s.counted,
  candidateSeat:s.candidateSeat, winnerId:s.winnerId, deckIds:s.deckIds}))});

// Status timestamps can stay unchanged during a long game. Require both PID
// and the run path, and include only descendants of that verified controller.
export function learningProcesses(processes, status, root) {
  const parent = processes.find(p => p.pid === status?.pid && String(p.commandLine || '').replaceAll('\\','/').toLowerCase().includes(normalized(root)));
  if (!parent) return [];
  const ids = new Set([parent.pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of processes) if (ids.has(p.parentPid) && !ids.has(p.pid)) {ids.add(p.pid); changed = true;}
  }
  return processes.filter(p => ids.has(p.pid));
}

export function experimentScore(rows) {
  const valid = rows.filter(s => s?.completed && !s.invalid && !s.adjudicated && s.counted !== false
    && [0,1].includes(s.candidateSeat) && ['p1','p2'].includes(s.winnerId));
  const wins = valid.filter(s => s.winnerId === `p${s.candidateSeat + 1}`).length;
  return {games:valid.length, wins, losses:valid.length-wins, invalid:rows.length-valid.length,
    winRate:valid.length ? wins/valid.length : null};
}

export async function readLearningAnchor({root, state, read}) {
  const protocol = await read(path.join(root,'learner-anchor-protocol.json'));
  if (!protocol) return {enabled:false};
  const anchor = state.learnerAnchor;
  const branchStart = anchor?.branchStartIteration ?? protocol.afterIteration;
  const elapsed = Math.max(0,state.iteration - branchStart);
  const inferior = anchor?.inferiorEvaluations || [];
  return {enabled:true, initialized:Boolean(anchor), committedIteration:state.iteration,
    branchStartIteration:branchStart, elapsedIterations:elapsed,
    maximumUnverifiedIterations:protocol.maximumUnverifiedIterations,
    inferiorEvaluations:inferior.map(e => ({iteration:e.iteration,upperBound:e.upperBound})),
    minimumInferiorEvaluations:protocol.minimumInferiorEvaluations,
    returnEligible:Boolean(anchor && elapsed >= protocol.maximumUnverifiedIterations && inferior.length >= protocol.minimumInferiorEvaluations
      && !sameRun(state.learnerPath,anchor.anchorPath)),
    model:anchor?.anchorPath ? await read(anchor.anchorPath,model) : null,
    comparisonDirectory:protocol.comparisonDirectory, comparisonConfigHash:protocol.comparisonConfigHash,
    consumedComparisons:anchor?.consumedComparisons || [],
    history:(anchor?.history || []).slice(-8).map(e => ({at:e.at,iteration:e.iteration,reason:e.reason,
      difference:e.evidence?.comparison?.difference}))};
}

export async function readLearningExperiment({root, config, status, read, list, processes}) {
  const starting = config.contract === START_COMPARISON;
  const configHash = digest(config);
  const state = await read(path.join(root,'state.json.gz'));
  if (state && state.configHash !== configHash) throw new Error('Comparison configuration mismatch');
  const live = learningProcesses(processes,status,root);
  const names = starting ? ['champion-start','current-start'] : ['league','selfplay'];
  const arms = [];
  const initialHashes = {};
  for (const name of names) {
    const initialPath = starting ? config.initials[name].path : config.initial.path;
    const initial = await read(initialPath,model);
    const iterations = [];
    for (let i=1;i<=config.iterations;i++) {
      const dir = path.join(root,name,'iterations',String(i).padStart(6,'0'));
      // Never inflate gameplay trajectories for a progress counter. Indices
      // finish out of order, so neither max(index) nor status.gameIndex is a count.
      const games = (await list(path.join(dir,'games'))).filter(e => /^\d+\.json\.gz$/.test(e.name)).length;
      const plan = await read(path.join(dir,'plan.json.gz'),p => ({sourceHash:p.sourceBehaviorHash,opponentHashes:p.leagueCollection?.behaviorHashes}));
      if (i===1) { initialHashes[name]=plan?.sourceHash; initialHashes.opponent ||= plan?.opponentHashes?.[1]; }
      const saved = await read(path.join(dir,'candidate.json.gz'),candidateSummary);
      const active = status?.arm === name && status?.iteration === i && !saved;
      // The live journal exposes guard results without reading the enormous
      // optimizer checkpoint at every refresh. Saved candidates are projected
      // once per file revision; no weights are retained or sent to the browser.
      const guards = saved?.guards || [];
      iterations.push({iteration:i,games,target:config.gamesPerIteration,committed:Boolean(saved),active:active && live.length>0,
        epoch:saved ? guards.length : active ? status.epoch ?? null : null,
        accepted:saved ? guards.filter(g=>g.passed).length : null,
        rejected:saved ? guards.filter(g=>!g.passed).length : null,
        lessonGuardsPassed:saved ? guards.length>0 && guards.every(g=>!g.passed || g.lessons===true) : null,
        generation:saved?.generation ?? null, changed:saved ? saved.beforeHash !== saved.afterHash : null});
    }
    const committed = iterations.filter(i=>i.committed);
    arms.push({id:name,initialGeneration:initial?.generation ?? null,generation:committed.at(-1)?.generation ?? initial?.generation ?? null,
      cycles:iterations,completedIterations:committed.length,games:iterations.reduce((n,i)=>n+i.games,0),
      trainedGames:committed.reduce((n,i)=>n+i.games,0),targetGames:config.iterations*config.gamesPerIteration,
      acceptedEpochs:committed.reduce((n,i)=>n+i.accepted,0),attemptedEpochs:committed.reduce((n,i)=>n+i.epoch,0),
      behaviorHash:state?.arms?.[name]?.behaviorHash ?? initialHashes[name]});
  }
  const changes = await read(path.join(root,'policy-change.json.gz'),x=>x.changes);
  const screen = await read(path.join(root,'screen.json.gz'),x=>({selected:x.selected,
    scores:Object.fromEntries(Object.entries(x.rows).map(([name,rows])=>[name,experimentScore(rows)]))}));
  const result = await read(path.join(root,'result.json'),x=>({status:x.status,selected:x.selected,confirmation:x.confirmation,arms:x.arms,comparison:x.comparison}));
  const selection = await read(path.join(root,'screen-selection.json.gz'));
  const confirmation = await read(path.join(root,'confirmation.json.gz'),x=>({status:x.status,selected:x.selected,confirmation:x.confirmation}));
  const coverage = starting ? await read(path.join(root,'contextual-lessons.json.gz'),x=>x.memoryCoverage) : null;
  async function evaluationEntry(name, stage, candidateHash, opponentHash) {
    const jobs = leagueEvaluationJobs(config,stage);
    const binding = starting ? {configHash,stage,candidateHash,opponentHash,jobs,review:config.evaluationReview}
      : {configHash,arm:name,candidateHash,opponentHash,role:'evaluation',jobs};
    const bindingHash = digest(binding);
    const directory = starting ? path.join(root,'comparison',stage,bindingHash) : path.join(root,'evaluation',name);
    const rows=[];
    let completeJobs=0;
    if(candidateHash && opponentHash) for (const job of jobs) {
      const saved = await read(path.join(directory,`${job.index}.json.gz`),rowsSummary);
      const progress = saved || await read(path.join(directory,`${job.index}.partial.json`),rowsSummary);
      if (progress && progress.planHash!==bindingHash) throw new Error('Evaluation binding mismatch');
      if (saved) completeJobs++;
      if(progress) rows.push(...progress.summaries);
    }
    return {id:name,stage,...experimentScore(rows),target:jobs.reduce((n,j)=>n+j.games,0),
      completeJobs,totalJobs:jobs.length,complete:completeJobs===jobs.length};
  }
  const evaluations = [];
  for (const arm of arms) {
    if(starting) {
      evaluations.push(await evaluationEntry(`${arm.id}-initial`,'screen',initialHashes[arm.id],initialHashes.opponent));
      const skipped = changes && !(changes[arm.id]?.acceptedEpochs>0 && changes[arm.id]?.meanTotalVariation>=config.minimumMeanPolicyChange);
      const row = skipped ? {id:arm.id,stage:'screen',...experimentScore([]),target:leagueEvaluationJobs(config).reduce((n,j)=>n+j.games,0),skipped:true}
        : await evaluationEntry(arm.id,'screen',arm.completedIterations===config.iterations?arm.behaviorHash:null,initialHashes.opponent);
      evaluations.push(row);
    } else evaluations.push(await evaluationEntry(arm.id,'screen',arm.behaviorHash,initialHashes.opponent));
  }
  if(!starting) evaluations.unshift(await evaluationEntry('baseline','screen',initialHashes[names[0]],initialHashes.opponent));
  if(starting && selection) {
    evaluations.push(await evaluationEntry(selection.selected.arm,'confirmation',selection.candidateHash,initialHashes.opponent));
    evaluations.push(await evaluationEntry('current-start-initial','confirmation',initialHashes['current-start'],initialHashes.opponent));
  }
  const trained = arms.every(a=>a.completedIterations===config.iterations);
  const terminal = result?.status || (state?.completed ? state.resultStatus || 'completed' : null);
  const outcome = confirmation || result;
  return {id:path.basename(root),directory:root,contract:config.contract,configHash,starting,
    running:live.length>0,processes:live.length,workerLimit:config.workerProcesses,
    stage:status?.stage || 'waiting',updatedAt:status?.at || null,error:status?.stage==='failed'?status.error:null,
    activeArm:status?.arm || null,activeIteration:status?.iteration || null,terminal,
    phase:terminal?'complete':selection?'confirmation':trained?'screen':'training',
    iterations:config.iterations,gamesPerIteration:config.gamesPerIteration,epochs:config.epochs,
    deckCount:config.decks.length,opponentMixture:(config.opponentCycle || []).map(i=>['self','champion','historical'][i]),
    arms:arms.map(a=>({...a,behaviorHash:undefined,change:changes?.[a.id] || null})),coverage,evaluations,
    selected:selection?.selected || screen?.selected || result?.selected || null,
    confirmation:outcome?.confirmation || null,
    promotionEligible:false,mainTrainingWeightsUpdated:false};
}
