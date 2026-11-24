import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {trainingTestDirectory} from './helpers/training-temp.mjs';
import {createDashboardReader} from '../server/training-dashboard-data.mjs';
import {START_COMPARISON,learningProcesses,experimentScore,readLearningExperiment,readLearningAnchor} from '../server/training-dashboard-learning.mjs';
import {leagueEvaluationJobs} from '../scripts/league-evaluation-schedule.mjs';
import {selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
import {readIntroductionProgress} from '../server/training-dashboard-pilot.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function write(file,x){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,file.endsWith('.gz')?gzipSync(JSON.stringify(x)):JSON.stringify(x));}
async function read(file,project=x=>x){try{const b=await readFile(file);return project(JSON.parse(file.endsWith('.gz')?gunzipSync(b):b));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function list(dir){return readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});}
const game=(extra={})=>({completed:true,candidateSeat:0,winnerId:'p1',deckIds:['a','a'],...extra});
async function fixture(t){
  const root=await trainingTestDirectory(t,'dashboard-learning'),main=path.join(root,'main'),exp=path.join(root,'comparison');
  const config={contract:START_COMPARISON,mainRunDirectory:main,directory:exp,iterations:4,gamesPerIteration:32,epochs:4,workerProcesses:2,
    initials:{'champion-start':{path:path.join(exp,'champion.gz')},'current-start':{path:path.join(exp,'current.gz')}},
    decks:[{id:'a'},{id:'b'},{id:'c'}],opponentCycle:[1,1,2,0],evaluationSeed:7,confirmationSeed:99,screenGamesPerPair:8,confirmationGamesPerPair:8,minimumMeanPolicyChange:.001,evaluationReview:{enabled:true}};
  const status={pid:12,arm:'champion-start',iteration:1,stage:'collection',at:'2026-01-01T00:00:00Z'};
  await write(path.join(exp,'config.json'),config);await write(path.join(exp,'status.json'),status);
  for(const item of Object.values(config.initials))await write(item.path,{checkpoint:{generation:10,weights:{secret:'must-not-leak'}}});
  const processes=[{pid:12,commandLine:`node trainer.mjs "${exp}/config.json"`},{pid:13,parentPid:12},{pid:14,parentPid:13}];
  const snapshot=()=>readLearningExperiment({root:exp,config,status,read,list,processes});
  return {root,main,exp,config,status,processes,snapshot};
}

test('comparison reports out-of-order saved files, separate same-generation branches, and committed epochs only',async t=>{
  const f=await fixture(t);const dir=path.join(f.exp,'champion-start/iterations/000001');
  await write(path.join(dir,'plan.json.gz'),{sourceBehaviorHash:'before',leagueCollection:{behaviorHashes:['before','opponent','old']}});
  for(const i of [0,7,31])await write(path.join(dir,`games/${i}.json.gz`),{largeTrajectory:'not-needed'});
  const before=await f.snapshot();
  assert.equal(before.running,true);assert.equal(before.processes,3);assert.equal(before.arms[0].games,3);assert.equal(before.arms[0].trainedGames,0);
  assert.equal(before.arms[0].generation,before.arms[1].generation);assert.equal(before.arms[1].games,0);
  await write(path.join(dir,'candidate.json.gz'),{checkpoint:{generation:11,weights:{secret:'must-not-leak'}},beforeBehaviorHash:'before',afterBehaviorHash:'after',epochGuards:[{passed:true,lessonRetention:{passed:true}},{passed:false}]});
  const after=await f.snapshot();assert.equal(after.arms[0].acceptedEpochs,1);assert.equal(after.arms[0].attemptedEpochs,2);
  assert.equal(after.arms[0].trainedGames,3);assert.equal(after.arms[0].cycles[0].changed,true);
  assert.equal(JSON.stringify(after).includes('must-not-leak'),false);
  assert.equal(JSON.stringify(after).includes('largeTrajectory'),false);
});

test('partial comparison evaluations refresh, completed jobs override partials, and wrong bindings fail',async t=>{
  const f=await fixture(t),arm='champion-start';
  await write(path.join(f.exp,arm,'iterations/000001/plan.json.gz'),{sourceBehaviorHash:'before',leagueCollection:{behaviorHashes:['before','opponent']}});
  const jobs=leagueEvaluationJobs(f.config),binding={configHash:hash(f.config),stage:'screen',candidateHash:'before',opponentHash:'opponent',jobs,review:f.config.evaluationReview};
  const dir=path.join(f.exp,'comparison/screen',hash(binding));
  await write(path.join(dir,'0.partial.json'),{planHash:hash(binding),summaries:[game(),game({winnerId:'p2'})]});
  let entry=(await f.snapshot()).evaluations[0];assert.equal(entry.games,2);assert.equal(entry.winRate,.5);assert.equal(entry.complete,false);
  await write(path.join(dir,'0.json.gz'),{planHash:hash(binding),summaries:Array.from({length:8},()=>game())});
  entry=(await f.snapshot()).evaluations[0];assert.equal(entry.games,8);assert.equal(entry.winRate,1);assert.equal(entry.completeJobs,1);
  await write(path.join(dir,'0.json.gz'),{planHash:'wrong',summaries:[game()]});
  await assert.rejects(f.snapshot(),/binding mismatch/);
});

test('invalid experiment rows never count as wins and PID reuse cannot imply running',()=>{
  const s=experimentScore([game(),game({invalid:true}),game({counted:false}),game({winnerId:null}),game({candidateSeat:4}),game({completed:false}),game({adjudicated:true})]);
  assert.equal(s.games,1);assert.equal(s.invalid,6);assert.equal(experimentScore([]).winRate,null);
  assert.deepEqual(learningProcesses([{pid:1,commandLine:'node unrelated.js'}],{pid:1},path.resolve('data/run')),[]);
});

test('both comparison controllers remain visible without child workers and other checkouts stay excluded',()=>{
  const root=path.resolve('project');
  const list=[{pid:1,commandLine:`node ${root}/runtime/scripts/train-league-policy-experiment.mjs config.json`},
    {pid:2,parentPid:1,commandLine:'node child.mjs'},
    {pid:3,commandLine:`node ${root}-other/scripts/train-league-policy-experiment.mjs config.json`},
    {pid:4,commandLine:`node ${root}/run-deck-pilot-comparison.mjs plan.json serial`},
    {pid:5,commandLine:`node ${root}-other/run-deck-pilot-comparison.mjs plan.json serial`}];
  assert.deepEqual(selectTrainingProcesses(list,root).map(p=>p.pid),[1,2,4]);
});

test('anchor requires both gates and never reports result-file completion as adoption',async t=>{
  const f=await fixture(t);const model=f.config.initials['champion-start'].path;
  await write(path.join(f.main,'learner-anchor-protocol.json'),{afterIteration:10,maximumUnverifiedIterations:32,minimumInferiorEvaluations:2,comparisonDirectory:f.exp});
  const state={iteration:42,learnerPath:'new-model',learnerAnchor:{anchorPath:model,branchStartIteration:10,inferiorEvaluations:[{iteration:20,upperBound:.4}],history:[]}};
  assert.equal((await readLearningAnchor({root:f.main,state,read})).returnEligible,false);
  state.learnerAnchor.inferiorEvaluations.push({iteration:25,upperBound:.49});
  let result=await readLearningAnchor({root:f.main,state,read});assert.equal(result.returnEligible,true);assert.deepEqual(result.history,[]);
  state.iteration=41;assert.equal((await readLearningAnchor({root:f.main,state,read})).returnEligible,false);
});

test('a newer live experiment cannot replace main selection; missing early experiment state is still discovered through anchor',async t=>{
  const f=await fixture(t),model=f.config.initials['champion-start'].path;
  await write(path.join(f.main,'config.json'),{gamesPerIteration:32,maximumWorkers:16});
  await write(path.join(f.main,'state.json.gz'),{iteration:1,learnerPath:model,championPath:model});
  await write(path.join(f.main,'status.json'),{pid:4,stage:'live-policy-audit',at:new Date().toISOString()});
  await write(path.join(f.main,'learner-anchor-protocol.json'),{afterIteration:1,comparisonDirectory:f.exp,maximumUnverifiedIterations:32,minimumInferiorEvaluations:2});
  const reader=createDashboardReader({dataRoot:f.root,getProcesses:()=>[{pid:4,commandLine:`node "${f.main}/config.json"`},...f.processes]});
  let s=await reader();assert.equal(s.runName,'main');assert.equal(s.experiments.length,1);assert.equal(s.progress.phaseProgress,null);
  await write(path.join(f.exp,'state.json.gz'),{configHash:hash(f.config),arms:{}});
  s=await createDashboardReader({dataRoot:f.root,getProcesses:()=>f.processes})();
  assert.equal(s.runName,'main');assert.equal(s.running,false);assert.equal(s.experiments[0].running,true);
});

test('screen and confirmation metadata preserve distinct seeds, counts and actual pair coverage',()=>{
  const c={contract:START_COMPARISON,decks:Array.from({length:7},(_,i)=>({id:String(i)})),evaluationSeed:41,confirmationSeed:63,screenGamesPerPair:8,confirmationGamesPerPair:8};
  const screen=leagueEvaluationJobs(c),confirmation=leagueEvaluationJobs(c,'confirmation');
  assert.equal(screen.length,14);assert.equal(confirmation.length,28);assert.equal(screen.reduce((n,j)=>n+j.games,0),112);
  assert.equal(confirmation.reduce((n,j)=>n+j.games,0),224);
  assert.ok(screen.filter(j=>j.decks.length===2).every(j=>j.seed%2===1));
  assert.equal(new Set([...screen,...confirmation].map(j=>j.seed)).size,42);
});

test('cold introduction history is bounded per refresh, explicitly partial, and converges without double counting',async()=>{
  let reads=0;
  const read=async()=>{reads++;return {deckIntroduction:{protocolHash:'h',firstIteration:1,deckId:'v',gameIndexes:[0,1]},validationGameIndexes:[1]};};
  const options={read,list:async()=>[],root:'main',state:{iteration:100},intro:{hash:'h',deckId:'v'},firstIteration:1};
  let result=await readIntroductionProgress(options);
  assert.equal(reads,17);assert.equal(result.throughIteration,16);assert.equal(result.complete,false);assert.equal(result.completedGames,32);
  for(let i=0;i<6;i++)result=await readIntroductionProgress(options);
  assert.equal(result.complete,true);assert.equal(result.throughIteration,100);
  assert.equal(result.completedGames,200);assert.equal(result.trainingGames,100);assert.equal(result.validationGames,100);
  assert.equal((await readIntroductionProgress(options)).completedGames,200);
});

test('cold evaluation history shows the latest matches first and restores old matches without duplicate totals',async t=>{
  const f=await fixture(t),model=f.config.initials['champion-start'].path;
  await write(path.join(f.main,'config.json'),{gamesPerIteration:32});
  await write(path.join(f.main,'state.json.gz'),{iteration:1,learnerPath:model,championPath:model});
  await write(path.join(f.main,'status.json'),{stage:'fast-selfplay'});
  for(let i=1;i<=6;i++){
    const dir=path.join(f.main,'evaluations',String(i).padStart(6,'0'));
    await write(path.join(dir,'request.json.gz'),{plan:{ordinal:i,blocks:1},candidatePath:model});
    await write(path.join(dir,'games/0.json'),game());
    await write(path.join(dir,'result.json.gz'),{decision:{outcome:'inconclusive'}});
  }
  const reader=createDashboardReader({dataRoot:f.root,runDirectory:f.main});
  let s=await reader();assert.deepEqual(s.evaluations.map(e=>e.ordinal),[5,6]);
  assert.equal(s.evaluationHistory.complete,false);assert.equal(s.evaluationHistory.total,6);assert.equal(s.currentEvaluationId,'000006');
  s=await reader();assert.equal(s.evaluations.length,4);assert.equal(s.totalEvaluationGames,4);
  s=await reader();assert.equal(s.evaluationHistory.complete,true);assert.equal(s.totalEvaluationGames,6);
  assert.equal((await reader()).totalEvaluationGames,6);
});
