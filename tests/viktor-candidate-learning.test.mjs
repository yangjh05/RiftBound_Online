import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {VIKTOR_CANDIDATE,validateCandidateConfig,candidateTrainingPlan,fullLessonSchedule,candidateScreenJobs,approvedTeacherAdvice,mergeCandidateLessons,splitProtectedTrajectories,summarizeCandidateScreen,candidateReservation,inheritedCandidateTrainingKeys,digest} from '../scripts/viktor-candidate-learning.mjs';
import {publicInputKey} from '../scripts/verified-specialist-lessons.mjs';
import {selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
const config=()=>({contract:VIKTOR_CANDIDATE,seed:20261005,iterations:4,gamesPerIteration:64,epochs:4,reservedSlots:3,workerProcesses:2,
  maxLessonActions:2400,maximumVerifiedPerGame:4,maximumTeacherReviews:48,promotionEligible:false,autoIntegration:false,
  decks:['v','a','b','c','d','e','f'].map(id=>({id})),deckId:'v',crossOpponentIds:['a','b','c','d'],protectedSeeds:[]});
test('the fixed full-game supply balances both dataset roles within every matchup',()=>{
  const jobs=fullLessonSchedule(config());assert.equal(jobs.length,20);
  for(let i=0;i<5;i++){const group=jobs.filter(j=>j.index%5===i);assert.equal(group.filter(j=>j.role==='training').length,2);assert.equal(group.filter(j=>j.role==='validation').length,2);}
  assert.equal(new Set(jobs.map(j=>j.seed)).size,20);
});
test('new training, lessons and a single diagnostic screen have separate precommitted seeds',()=>{
  const c=validateCandidateConfig(config()),jobs=candidateScreenJobs(c);assert.equal(jobs.reduce((n,j)=>n+j.games,0),384);
  assert.throws(()=>validateCandidateConfig({...c,protectedSeeds:[jobs[0].seed]}),/reused/);
  assert.throws(()=>validateCandidateConfig({...c,autoIntegration:true}));
  assert.throws(()=>validateCandidateConfig({...c,iterations:5}));
});
test('the specialist only opposes Viktor and is never an imported learner trajectory',()=>{
  const c=config(),pairFor=(search,g)=>search.assignments[g].pairIds.map(id=>({id}));
  const p=candidateTrainingPlan(c,1,'source','own',['parent','specialist'],pairFor);
  assert.equal(p.games,64);assert.equal(p.leagueCollection.contract,'frozen-learner-only-league-v1');
  p.leagueCollection.opponentIndexes.forEach((index,g)=>{if(index===2)assert.equal(pairFor(p.deckSearch,g)[1-g%2].id,'v');});
  assert.deepEqual(p.leagueCollection.behaviorHashes,['own','parent','specialist']);
});
test('specialist confidence or a win cannot create a correction; uncertain response hypotheses are rejected',()=>{
  const key=a=>a.kind;
  assert.equal(approvedTeacherAdvice({action:{kind:'b'},weight:1,winner:true},'a',key),false);
  const advice={action:{kind:'b'},weight:.5,responsePolicyLesson:true,responseReview:{belief:{confidence:'catalogue-conditional',unsupportedObservedCards:[]},
    comparisons:[{action:{kind:'a'},score:0,noHandResponseScore:1,responses:[]},{action:{kind:'b'},score:.3,noHandResponseScore:.3,responses:[]}]}};
  assert.equal(approvedTeacherAdvice(advice,'a',key),true);
  advice.responseReview.belief.confidence='low';assert.equal(approvedTeacherAdvice(advice,'a',key),false);
  advice.responseReview.belief.confidence='catalogue-conditional';advice.responseReview.comparisons[1].score=.1;
  assert.equal(approvedTeacherAdvice(advice,'a',key),false);
});
test('resource corrections retain existing proof reasons and reject partial or terminal tie-breaks',()=>{
  const key=a=>a.kind,advice={action:{kind:'b'},weight:.5,localResourceLesson:true,comparison:'same-result-less-spending',review:{applied:true,comparisons:[{score:2}]}};
  assert.equal(approvedTeacherAdvice(advice,'a',key),true);
  advice.review.partialSearch=true;assert.equal(approvedTeacherAdvice(advice,'a',key),false);
  delete advice.review.partialSearch;advice.review.comparisons[0].score=1000;assert.equal(approvedTeacherAdvice(advice,'a',key),false);
});
test('old training inputs cannot masquerade as fresh validation; new validation owns same-input fresh training',()=>{
  const sample=(role,n)=>({lessonRole:role,steps:[{state:[n],actions:[n],legalCount:1}]});
  const old={bank:{training:[sample('training',1)],validation:[sample('validation',2)]}};
  const out=mergeCandidateLessons(old,[sample('validation',1),sample('training',2),sample('training',3),sample('validation',3),sample('training',4)]);
  assert.deepEqual(out.bank.training.map(s=>s.steps[0].state[0]),[1,4]);assert.deepEqual(out.bank.validation.map(s=>s.steps[0].state[0]),[2,3]);
  assert.deepEqual(out.freshCounts,{training:1,validation:1});
});
test('the transfer controller and its workers count toward shared capacity',()=>{
  const root=path.resolve('project');assert.deepEqual(selectTrainingProcesses([{pid:1,commandLine:`node ${root}/execution/train-viktor-main-candidate.mjs config.json`},
    {pid:2,parentPid:1,commandLine:'node worker.mjs'},{pid:3,commandLine:'node another-project/train-viktor-main-candidate.mjs'}],root).map(p=>p.pid),[1,2]);
});

test('later validation cannot include an input already used by a previous candidate cycle',()=>{
  const sample=(role,n)=>({lessonRole:role,steps:[{state:[n],actions:[n],legalCount:1}]});
  const old={bank:{training:[sample('training',1)],validation:[sample('validation',2)]}};
  const out=mergeCandidateLessons(old,[sample('training',3),sample('validation',3),sample('validation',4),sample('validation',5)],
    [publicInputKey(sample('training',3)),publicInputKey(sample('training',4))]);
  assert.deepEqual(out.bank.validation.map(s=>s.steps[0].state[0]),[2,5]);
  assert.deepEqual(out.bank.training.map(s=>s.steps[0].state[0]),[1,3]);
});

test('PPO excludes the whole matching trajectory while preserving archives and excluding padding from the input identity',()=>{
  const step=n=>({state:[n],actions:[n,999],legalCount:1}),trajectories=[{steps:[step(1),step(2)]},{steps:[step(3)]}];
  const protectedKeys=new Set([publicInputKey({steps:[{...step(2),actions:[2]}]})]);
  const result=splitProtectedTrajectories(trajectories,protectedKeys,1);
  assert.deepEqual(result.eligible,[trajectories[1]]);assert.equal(result.excluded[0].index,0);
  assert.equal(result.trainedKeys.length,1);assert.equal(trajectories[0].steps.length,2);
});

test('matched cross comparison reports only Viktor-role seed blocks, not the opposite deck performance',()=>{
  const rows=[];
  for(const subject of ['candidate','specialist'])for(let n=0;n<8;n++){
    const viktor=n<4,seat=n%2,deck=viktor?'v':'a',opponent=viktor?'a':'v';
    const wins=viktor?(subject==='candidate'?2:3):(subject==='candidate'?4:0);
    rows.push({group:'cross-a',subject,gameSeed:viktor?11:12,completed:true,deckIds:seat?[opponent,deck]:[deck,opponent],
      candidateSeat:seat,winnerId:`p${(n%4<wins?seat:1-seat)+1}`});
  }
  const result=summarizeCandidateScreen(rows,'v');assert.equal(result.pairedViktorBlocks.length,1);
  assert.equal(result.meanPairedViktorDifference,-.25);assert.equal(Object.keys(result.groups).length,4);
});

test('evaluation releases only the two candidate collection workers from the reserved budget',()=>{
  const c={...config(),directory:'candidate',previousReservation:{slots:3,directory:'pilot'}};
  assert.equal(candidateReservation(c,{iteration:3}).slots,6);assert.equal(candidateReservation(c,{iteration:4}).slots,4);
  assert.equal(candidateReservation(c,{iteration:4}).additionalReservations[0].slots,1);
});

test('a fresh candidate stage preserves training history and cannot relabel it as validation',()=>{
  const sample=(role,n)=>({lessonRole:role,steps:[{state:[n],actions:[n],legalCount:1}]});
  const prior=sample('training',17),held=sample('validation',18),keys=[publicInputKey(prior)];
  const history={contract:'candidate-training-input-history-v1',keys,keysHash:digest(keys)};
  const inherited=inheritedCandidateTrainingKeys(history,[held]);
  const bank={bank:{training:[],validation:[held]}};
  const next=mergeCandidateLessons(bank,[sample('validation',17),sample('validation',19)],inherited);
  assert.deepEqual(next.bank.validation.map(s=>s.steps[0].state[0]),[18,19]);
  assert.throws(()=>inheritedCandidateTrainingKeys(history,[sample('validation',17)]),/Previously trained/);
  assert.throws(()=>inheritedCandidateTrainingKeys({...history,keysHash:'changed'}),/history changed/);
  assert.throws(()=>inheritedCandidateTrainingKeys({...history,keys:[...keys,...keys],keysHash:digest([...keys,...keys])}));
});
