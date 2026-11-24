import test from 'node:test';
import assert from 'node:assert/strict';
import {authoredTrainingDecks} from '../scripts/authored-training-decks.mjs';
import {pilotPlan,pilotEvaluationSchedule} from '../scripts/train-deck-pilot.mjs';
import {expectedDeckSearchPair} from '../scripts/adaptive-deck-search.mjs';
import {scheduledEvaluationMatrixPair,evaluationConditionSchedule} from '../src/ai/neural/selfplay.mjs';
import {parallelEvaluationBudget} from '../scripts/parallel-evaluation.mjs';
import {CONTINUOUS_PILOT_CONTRACT,validatePilotContinuation,pilotEvaluationSpec} from '../scripts/deck-pilot-continuation.mjs';
import {digest} from '../scripts/adaptive-policy-q-contract.mjs';
const [yi,viktor]=authoredTrainingDecks();
const config={contract:'isolated-fixed-deck-pilot-v1',iterations:4,gamesPerIteration:32,
  deck:viktor,opponentDecks:[yi],seed:192938,evaluationSeed:819283};
const continuation={contract:CONTINUOUS_PILOT_CONTRACT,configHash:digest(config),afterIteration:4,
  evaluationEveryIterations:16,crossEvaluationEveryIterations:64,automaticPromotion:false};
test('pilot fixes the exact Viktor list in every on-policy game without touching ordinary search',()=>{
  const plan=pilotPlan(config,1,'source.json.gz','source-behavior');
  assert.deepEqual(plan,pilotPlan(config,1,'source.json.gz','source-behavior'));
  for(let i=0;i<32;i++)assert.deepEqual(expectedDeckSearchPair(plan.deckSearch,i,plan.seed).map(d=>d.id),[viktor.id,viktor.id]);
  assert.notEqual(plan.seed,pilotPlan(config,2,'source.json.gz','other-behavior').seed);
  assert.throws(()=>pilotPlan({...config,gamesPerIteration:16},1,'source','hash'));
});
test('pilot evaluation pairs before/after seeds and both cross-deck roles, seats and first players',()=>{
  const jobs=pilotEvaluationSchedule(config);
  assert.equal(jobs.filter(j=>j.kind==='mirror').length*8,64);
  const cross=jobs.filter(j=>j.kind==='cross');assert.equal(cross.length*8,64);
  for(let i=0;i<cross.length;i+=2){
    assert.equal(cross[i].seed,cross[i+1].seed);assert.notEqual(cross[i].baseline,cross[i+1].baseline);
    const conditions=new Set();
    for(let game=0;game<8;game++){
      const pair=scheduledEvaluationMatrixPair(cross[i].decks,Math.floor(game/4),cross[i].seed);
      assert.notEqual(pair[0].id,pair[1].id);
      const {candidateSeat,firstPlayerId}=evaluationConditionSchedule(game);
      conditions.add(`${pair[0].id}:${candidateSeat}:${firstPlayerId}`);
    }
    assert.equal(conditions.size,8);
  }
});
test('reserving the pilot coordinator and two workers keeps main allocations within sixteen',()=>{
  for(let external=0;external<=16;external++){
    const b=parallelEvaluationBudget(external+3,16,0);
    assert.ok(b.trainer+b.evaluation+b.audit+b.selfplay+3+Math.min(external,13)<=16);
  }
});
test('continuous training extends the saved lineage without changing initial plans or weakening deck validation',()=>{
  for(let i=1;i<=4;i++)assert.deepEqual(pilotPlan(config,i,'source','hash',continuation),pilotPlan(config,i,'source','hash'));
  assert.throws(()=>pilotPlan(config,5,'source','hash'));
  for(const i of [5,20,68,1000]){
    const plan=pilotPlan(config,i,'saved-candidate','hash',continuation);
    assert.equal(plan.continuationHash,digest(continuation));assert.equal(plan.sourcePath,'saved-candidate');
    for(let j=0;j<32;j++)assert.deepEqual(expectedDeckSearchPair(plan.deckSearch,j,plan.seed).map(d=>d.id),[viktor.id,viktor.id]);
  }
  const saved={iteration:5,continuationHash:digest(continuation)};
  assert.equal(validatePilotContinuation(config,continuation,saved),continuation);
  assert.throws(()=>validatePilotContinuation(config,null,saved));
  assert.throws(()=>validatePilotContinuation(config,{...continuation,evaluationEveryIterations:1},saved));
  assert.throws(()=>validatePilotContinuation(config,continuation,{iteration:5}));
  assert.throws(()=>validatePilotContinuation({...config,seed:1},continuation));
});
test('periodic evaluations use new immutable directories and seeds, then leave room for more training',()=>{
  assert.deepEqual(pilotEvaluationSpec(config,4,continuation),pilotEvaluationSpec(config,4));
  for(const i of [0,1,3,5,19,21,69,1001])assert.equal(pilotEvaluationSpec(config,i,continuation),null);
  const mirror=pilotEvaluationSpec(config,20,continuation),cross=pilotEvaluationSpec(config,68,continuation);
  assert.equal(mirror.directory,'evaluations/000020');assert.equal(mirror.full,false);
  assert.equal(cross.directory,'evaluations/000068');assert.equal(cross.full,true);
  assert.notEqual(mirror.evaluationSeed,config.evaluationSeed);assert.notEqual(mirror.evaluationSeed,cross.evaluationSeed);
  const jobs=pilotEvaluationSchedule({...config,evaluationSeed:mirror.evaluationSeed},mirror);
  assert.equal(jobs.length,8);assert.ok(jobs.every(j=>j.kind==='mirror'));
  assert.equal(pilotEvaluationSpec(config,36,continuation).directory,'evaluations/000036');
});
