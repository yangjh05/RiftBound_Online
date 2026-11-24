import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {readTrajectoryArchive as read,writeTrajectoryArchive as write} from '../src/ai/neural/archive.mjs';
import {digest} from '../scripts/adaptive-policy-q-contract.mjs';
import {pairedAnchorComparison,selectScreenCandidate,confirmLearningAnchor} from '../scripts/learning-anchor-selection.mjs';
import {LEARNER_ANCHOR,commitLearnerAnchor,recordLearnerAnchorEvaluation,shouldReturnToAnchor,applyLearnerAnchor} from '../scripts/learner-anchor.mjs';
import {STARTING_POINT_EXPERIMENT,experimentArms,experimentInitial,leagueExperimentPlan,leagueEvaluationJobs,validateLeagueExperiment} from '../scripts/league-policy-experiment.mjs';
import {authoredTrainingDecks} from '../scripts/authored-training-decks.mjs';
const rows=(wins,n=224)=>Array.from({length:n},(_,i)=>({completed:true,winnerId:i<wins?`p${i%2+1}`:`p${2-i%2}`,
  candidateSeat:i%2,firstPlayerId:i%4<2?'p1':'p2',gameSeed:123+Math.floor(i/4),evaluationMode:'cross-deck-matrix-v1',
  decisionReviewHash:'fixed',deckIds:['deck','deck']}));
test('screen never advances unchanged, rejected or non-improving candidates; fresh confirmation counts seeds, not seats',()=>{
  const data={a:rows(140),'a-initial':rows(100),b:rows(150),'b-initial':rows(100)};
  const changes={a:{acceptedEpochs:1,meanTotalVariation:.01},b:{acceptedEpochs:0,meanTotalVariation:.02}};
  assert.equal(selectScreenCandidate(['a','b'],data,changes,.001).arm,'a');
  assert.equal(selectScreenCandidate(['a'],data,{a:{acceptedEpochs:4,meanTotalVariation:.0001}},.001),null);
  const result=confirmLearningAnchor(data.a,data['a-initial']);assert.equal(result.clusters,56);assert.equal(result.accepted,true);assert.equal(result.promotionEligible,false);
  assert.equal(confirmLearningAnchor(rows(115),rows(113)).accepted,false);
  assert.equal(confirmLearningAnchor(rows(16,16),rows(0,16)).accepted,false);
  const corrupt=rows(140);corrupt[0].gameSeed++;assert.throws(()=>pairedAnchorComparison(corrupt,data.a));
  const invalid=rows(140);invalid[0].adjudicated=true;assert.throws(()=>confirmLearningAnchor(invalid,data.a));
  assert.throws(()=>pairedAnchorComparison(data.a.slice(1),data['a-initial'].slice(1)));
});
test('continuation waits for bounded budget and two distinct conclusive failures, preserving evaluations and the champion',()=>{
  const p={contract:LEARNER_ANCHOR,afterIteration:10,maximumUnverifiedIterations:32,minimumInferiorEvaluations:2,
    comparisonDirectory:path.resolve('data/ai/test-comparison'),comparisonConfigHash:'a'.repeat(64)};
  const state={iteration:10,championPath:'champion',learnerPath:'latest',evaluationQueue:['running'],pendingEvaluationCandidate:'frozen'};
  commitLearnerAnchor(state,p);assert.equal(state.learnerAnchor.protocolHash,digest(p));
  const request=i=>({candidatePath:path.resolve(`data/iterations/${String(i).padStart(6,'0')}/candidate.json.gz`),incumbentPath:'champion'});
  recordLearnerAnchorEvaluation(state,request(9),{upperBound:.4});assert.equal(state.learnerAnchor.inferiorEvaluations.length,0);
  recordLearnerAnchorEvaluation(state,request(12),{upperBound:.51});assert.equal(state.learnerAnchor.inferiorEvaluations.length,0);
  recordLearnerAnchorEvaluation(state,request(12),{upperBound:.49});recordLearnerAnchorEvaluation(state,request(12),{upperBound:.49});
  state.iteration=100;assert.equal(shouldReturnToAnchor(state,p),false);
  recordLearnerAnchorEvaluation(state,request(20),{upperBound:.48});state.iteration=41;assert.equal(shouldReturnToAnchor(state,p),false);
  state.iteration=42;assert.equal(shouldReturnToAnchor(state,p),true);
  assert.deepEqual(state.evaluationQueue,['running']);assert.equal(state.pendingEvaluationCandidate,'frozen');assert.equal(state.championPath,'champion');
  recordLearnerAnchorEvaluation(state,request(42),{promoted:true},true);assert.equal(shouldReturnToAnchor(state,p),false);
  assert.throws(()=>commitLearnerAnchor(state,{...p,maximumUnverifiedIterations:1}));
});
test('starting models differ, but both arms share deck blocks, seeds, learner seats and opponent roles',()=>{
  const c={contract:STARTING_POINT_EXPERIMENT,initials:{'champion-start':{path:'champion'},'current-start':{path:'current'}},
    iterations:4,gamesPerIteration:32,epochs:4,reservedSlots:3,workerProcesses:2,promotionEligible:false,
    decks:authoredTrainingDecks().slice(0,2),opponents:[{role:'champion'},{role:'historical-champion'}],opponentCycle:[1,1,2,0],
    seed:173701,evaluationSeed:3177777,confirmationSeed:73371111,screenGamesPerPair:8,confirmationGamesPerPair:8,minimumMeanPolicyChange:.001};
  validateLeagueExperiment(c);const arms=experimentArms(c);
  assert.notEqual(experimentInitial(c,arms[0]).path,experimentInitial(c,arms[1]).path);
  for(let i=1;i<=4;i++){
    const a=leagueExperimentPlan(c,arms[0],i,'a','champion',['champion','old']),b=leagueExperimentPlan(c,arms[1],i,'b','current',['champion','old']);
    assert.equal(a.seed,b.seed);assert.deepEqual(a.deckSearch.assignments,b.deckSearch.assignments);
    assert.deepEqual(a.leagueCollection.opponentIndexes,b.leagueCollection.opponentIndexes);
  }
  assert.ok(leagueEvaluationJobs(c).every(j=>j.games===8));assert.ok(leagueEvaluationJobs(c,'confirmation').every(j=>j.games===8));
  assert.ok(leagueEvaluationJobs(c).filter(j=>j.decks.length===2).every(j=>j.seed%2===1));
});
test('bounded rollback writes a new lineage artifact without changing either source or the frozen match',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'anchor-adoption-'));
  try{
    const champion=path.join(dir,'champion.json.gz'),latest=path.join(dir,'latest.json.gz');
    await write(champion,{checkpoint:{generation:11,metadata:{},weights:{proof:[1,2,3]}}});
    await write(latest,{checkpoint:{generation:49,metadata:{},weights:{proof:[4,5,6]}}});
    const p={contract:LEARNER_ANCHOR,afterIteration:1,maximumUnverifiedIterations:32,minimumInferiorEvaluations:2,
      comparisonDirectory:path.join(dir,'data/comparison'),comparisonConfigHash:'a'.repeat(64)};
    const state={iteration:1,championPath:champion,learnerPath:latest,evaluationQueue:['frozen'],pendingEvaluationCandidate:latest};
    commitLearnerAnchor(state,p);state.iteration=33;state.learnerAnchor.inferiorEvaluations=[{iteration:10},{iteration:20}];
    const change=await applyLearnerAnchor(state,p,'fingerprint');
    assert.equal(change.reason,'bounded-branch-repeatedly-inferior');assert.notEqual(state.learnerPath,champion);
    const adopted=await read(state.learnerPath);assert.equal(adopted.checkpoint.generation,50);
    assert.deepEqual(adopted.checkpoint.weights,{proof:[1,2,3]});
    assert.equal((await read(champion)).checkpoint.generation,11);assert.equal((await read(latest)).checkpoint.generation,49);
    assert.deepEqual(state.evaluationQueue,['frozen']);assert.equal(state.pendingEvaluationCandidate,latest);
    assert.equal(state.championPath,champion);assert.equal(await applyLearnerAnchor(state,p,'fingerprint'),null);
  }finally{await rm(dir,{recursive:true,force:true});}
});
