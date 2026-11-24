import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DECK_LEAGUE,digest,trainingPlan,scopedLessons,evaluationJobs,evaluationDecision,assertEvaluationRows,isEvaluationChoice,inputKey,protectEvaluationInputs,partitionTrainingTrajectories,skippedTrainingCheckpoint} from '../scripts/deck-league-contract.mjs';
import {extendLeagueRuntime,LEAGUE_RUNTIME_EXTENSIONS} from '../scripts/deck-league-runtime.mjs';
import {selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
const profiles=Array.from({length:7},(_,i)=>({id:`deck-${i}`,deck:{id:`own-${i}`}}));
const c={contract:DECK_LEAGUE,seed:13,profiles,gamesPerOpponent:4,evaluation:{screenBlocks:2,confirmationBlocks:16,alpha:.05,maximumMatchupRegression:.1,minimumMeanImprovement:.02}};
const opponents=profiles.map(p=>({profileId:p.id,deckId:p.deck.id,behaviorHash:p.id,sha256:digest(p)}));

test('forced transitions cannot poison the policy evaluation holdout; real choices still do',()=>{
 assert.equal(isEvaluationChoice({legalCount:1}),false);
 assert.equal(isEvaluationChoice({legalCount:2}),true);
 assert.equal(isEvaluationChoice({legalCount:11}),true);
 assert.equal(isEvaluationChoice(null),false);
});
test('evaluation detects contamination without converting past training into holdout, including resume',()=>{
 const trained=new Set(['trained']),held=new Set(['original-held']);
 assert.deepEqual(protectEvaluationInputs(['trained','fresh-choice','original-held'],held,trained),['trained']);
 assert.deepEqual([...held],['original-held','fresh-choice']);
 assert.deepEqual(protectEvaluationInputs(['trained','fresh-choice'],held,trained),['trained']);
 assert.equal(held.has('trained'),false);
});
test('real protected choices exclude the entire trajectory and empty admission preserves weights and Adam',()=>{
 const step=n=>({state:new Float32Array([n]),actions:new Float32Array([1,2,0,0]),legalCount:2});
 const blocked=step(2),held=new Set([inputKey({steps:[{...blocked,actions:[1,2]}]})]);
 const trajectories=[{steps:[step(1),blocked]},{steps:[step(3)]}];
 const a=partitionTrainingTrajectories(trajectories,held,1);
 assert.deepEqual(a.excluded,[0]);assert.deepEqual(a.eligible,[trajectories[1]]);
 assert.equal(a.used.has(inputKey({steps:[{...step(1),actions:[1,2]}]})),false);
 assert.equal(a.overlaps[0].keys.length,1);
 const empty=partitionTrainingTrajectories([trajectories[0]],held,1);
 assert.equal(empty.used.size,0);assert.equal(empty.eligible.length,0);
 const payload={checkpoint:{generation:12,weights:[1,2]},optimizerState:{m:[3],v:[4],iteration:25}},before=structuredClone(payload);
 const skipped=skippedTrainingCheckpoint(payload,{games:1},'same-hash',empty.excluded);
 assert.deepEqual(skipped.checkpoint,before.checkpoint);assert.deepEqual(skipped.optimizerState,before.optimizerState);
 assert.equal(skipped.trainingGames,0);assert.deepEqual(skipped.epochGuards,[]);assert.equal(skipped.beforeBehaviorHash,skipped.afterBehaviorHash);
 assert.deepEqual(payload,before);
 assert.throws(()=>skippedTrainingCheckpoint(payload,{games:2},'same-hash',[0,0]));
});
test('each specialist gets all opponents, frozen weights, and exactly its own deck',()=>{
 const plan=trainingPlan(c,profiles[2],1,{path:'own',behaviorHash:'abc',sha256:'def'},opponents);
 assert.equal(plan.games,28);assert.equal(plan.deckSearch.fixedLearnerDeckId,'own-2');
 for(let g=0;g<28;g++){assert.equal(plan.deckSearch.assignments[g].pairIds[0],'own-2');assert.equal(plan.leagueCollection.opponentIndexes[g],Math.floor(g/4));}
 assert.notEqual(plan.seed,trainingPlan(c,profiles[3],1,{},opponents).seed);
});
const sample=(deckId,role,n)=>({deckId,lessonRole:role,steps:[{state:[n],actions:[1],legalCount:1}]});
test('deck retention is scoped while all held input roles stay protected',()=>{
 const bank={training:[sample('a','training',1),sample('b','training',2)],validation:[sample('a','validation',3),sample('b','validation',4)]};
 const own=scopedLessons({bank},'a');assert.equal(own.bank.training.length,1);assert.equal(own.bank.validation.length,1);
 assert.throws(()=>scopedLessons({bank:{...bank,validation:[...bank.validation,sample('b','validation',1)]}},'a'),/Protected/);
});
test('evaluation is subject-deck only, seats and first player cannot be swapped silently',()=>{
 const job=evaluationJobs(c,profiles[2],4,'screen',opponents)[0];
 const rows=Array.from({length:4},(_,i)=>({candidateSeat:i%2,firstPlayerId:i<2?'p1':'p2',gameSeed:job.seed,
 evaluationMode:'fixed-subject-deck-v1',deckIds:i%2?[job.opponentDeckId,job.subjectDeckId]:[job.subjectDeckId,job.opponentDeckId],decisionReviewHash:'review',completed:true,winnerId:'p1'}));
 assertEvaluationRows(rows,job,'review');rows[0].deckIds.reverse();assert.throws(()=>assertEvaluationRows(rows,job,'review'));
});
test('matched confirmation uses seed blocks and does not promote a tie',()=>{
 const records=evaluationJobs(c,profiles[0],4,'confirmation',opponents).map(job=>({job,rows:Array.from({length:4},(_,i)=>({candidateSeat:i%2,winnerId:i<2?`p${i%2+1}`:`p${2-i%2}`}))}));
 const r=evaluationDecision(c,'confirmation',records);assert.equal(r.promoted,false);assert.equal(r.blocks.length,112);
 assert.throws(()=>evaluationDecision(c,'confirmation',[...records,records[0]]),/Duplicate/);
});
test('runtime extension is limited to opt-in scheduling and preserves existing branches',()=>{
 for(const file of LEAGUE_RUNTIME_EXTENSIONS){const before=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
   const after=extendLeagueRuntime(file,before);assert.notEqual(after,before);
   assert.ok(after.includes(file.endsWith('selfplay.mjs')?'fixed-subject-deck-v1':'fixedLearnerDeckId'));
 }
});
test('fleet coordinator and descendants count toward the shared cap',()=>{
 const root='C:/project';const processes=[{pid:1,parentPid:0,commandLine:'node C:/project/execution/train-deck-league.mjs config'},
 {pid:2,parentPid:1,commandLine:'node worker.mjs'},{pid:3,parentPid:0,commandLine:'node C:/other/train-deck-league.mjs'},
 {pid:4,parentPid:0,commandLine:'node C:/project/collection/run-deck-league-growth.mjs config'}];
 assert.deepEqual(selectTrainingProcesses(processes,root).map(p=>p.pid),[1,2,4]);
});
