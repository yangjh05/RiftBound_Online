import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertReviewedTeacherLesson} from './reviewed-training-contract.mjs';

export const DECK_LEAGUE = 'independent-deck-league-v1';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const inputKey = sample => digest(sample.steps.map(s => [Array.from(s.state), Array.from(s.actions), s.legalCount]));
export const seedFor = (config, ...parts) => (parseInt(digest([DECK_LEAGUE,config.seed,...parts]).slice(0,8),16)>>>0)||1;
export const unwrap = payload => payload.candidateCheckpoint || payload.checkpoint || payload;

export const MATCH_INDEPENDENCE='prospective-independent-match-evaluation-v1';
export function validateMatchProtocol(p,config,profileId,iteration){
  assert.equal(p.contract,MATCH_INDEPENDENCE);assert.equal(p.configHash,digest(config));
  assert.ok(Number.isInteger(p.afterIterations[profileId])&&iteration>p.afterIterations[profileId],
    'A prospective evaluation protocol cannot relabel an already frozen candidate.');
  assert.equal(p.unit,'fresh-seed-blocks-and-frozen-models');
  assert.equal(p.stateOverlap,'diagnostic-only');assert.equal(p.evaluationDataTraining,false);
  assert.equal(p.existingProtectedInputsPreserved,true);assert.equal(p.correctionCriteriaUnchanged,true);
  assert.deepEqual(p.criteria,config.evaluation);return p;
}
export function evaluationOverlapDecision(decision,overlapCount,protocol=null){
  if(overlapCount&&!protocol)return {...decision,promoted:false,eligible:false,reason:'training-input-overlap'};
  return decision;
}

export function assertLessonAugmentation(original,augmented,deckId,protectedInputs,reviewedTeacher=null){
  const before=original.bank,after=augmented.bank;
  assert.deepEqual(after.validation,before.validation,'Protected corrections cannot be edited.');
  assert.deepEqual(after.training.slice(0,before.training.length),before.training,'Original training lessons cannot be replaced.');
  const added=after.training.slice(before.training.length);assert.ok(added.length>0);
  const seen=new Set(before.training.map(inputKey));
  for(const sample of added){
    assert.equal(sample.lessonRole,'training');assert.equal(sample.lessonSource.role,'training');
    if(sample.lessonSource.proof.kind==='reviewed-public-teacher-v1')assertReviewedTeacherLesson(sample,deckId,reviewedTeacher);
    else{assert.equal(sample.deckId,deckId);assert.equal(sample.lessonSource.proof.thresholdsUnchanged,true);
      assert.equal(sample.lessonSource.proof.kind,'growth');assert.equal(sample.steps[0].growthLesson,true);}
    assert.equal(sample.memoryContext.contract,'complete-actor-observation-prefix-v1');assert.equal(sample.memoryContext.fromReset,true);
    assert.equal(sample.steps.length,1);assert.equal(sample.steps[0].winProbabilityLabel,false);
    const key=inputKey(sample);assert.ok(!protectedInputs.has(key),'Protected correction entered growth replay.');assert.ok(!seen.has(key));seen.add(key);
  }
  return added.length;
}

// A forced one-action state is not a policy choice and is often identical in
// every game. It cannot certify policy generalization or make every new seed
// a duplicate evaluation. Genuine choices retain exact input-role protection.
export const isEvaluationChoice = selected => Number.isInteger(selected?.legalCount)&&selected.legalCount>1;

// First admission owns an input's role. Seeing an already trained input in an
// evaluation invalidates that evaluation; it cannot turn training into holdout.
export function protectEvaluationInputs(keys,protectedInputs,trainedInputs){
  const conflicts=[];
  for(const key of keys){
    if(trainedInputs.has(key)){conflicts.push(key);continue;}
    protectedInputs.add(key);
  }
  return conflicts;
}

export function partitionTrainingTrajectories(trajectories,protectedInputs,actionDim){
  const eligible=[],excluded=[],used=new Set(),overlaps=[];
  trajectories.forEach((t,index)=>{
    const keys=t.steps.map(s=>inputKey({steps:[{...s,actions:Array.from(s.actions).slice(0,s.legalCount*actionDim)}]}));
    const blocked=[...new Set(keys.filter(k=>protectedInputs.has(k)))];
    if(blocked.length){excluded.push(index);overlaps.push({trajectory:index,keys:blocked});}
    else{eligible.push(t);keys.forEach(k=>used.add(k));}
  });
  return {eligible,excluded,used,overlaps};
}

export function skippedTrainingCheckpoint(payload,plan,behaviorHash,excluded){
  assert.equal(excluded.length,plan.games);
  assert.equal(new Set(excluded).size,plan.games);
  assert.ok(excluded.every(i=>Number.isInteger(i)&&i>=0&&i<plan.games));
  return {checkpoint:unwrap(payload),optimizerState:payload.optimizerState,planHash:digest(plan),
    beforeBehaviorHash:behaviorHash,afterBehaviorHash:behaviorHash,epochGuards:[],
    collectedGames:plan.games,trainingGames:0,excluded,
    skippedReason:'all-trajectories-overlap-protected-inputs',at:new Date().toISOString()};
}

export function validateLeague(config) {
  assert.equal(config.contract,DECK_LEAGUE);
  assert.equal(config.maximumProcesses,16);
  assert.equal(config.priority,'normal');
  assert.ok(Number.isInteger(config.workerProcesses)&&config.workerProcesses>=1&&config.workerProcesses<=8);
  assert.equal(config.profiles.length,7);
  assert.equal(new Set(config.profiles.map(p=>p.id)).size,7);
  assert.equal(new Set(config.profiles.map(p=>p.deck.id)).size,7);
  for(const p of config.profiles){assert.match(p.id,/^[a-z][a-z0-9-]+$/);assert.match(p.initial.sha256,/^[a-f0-9]{64}$/);assert.equal(p.deckHash,digest(p.deck));}
  assert.ok(config.rotation.length>=7&&config.rotation.every(id=>config.profiles.some(p=>p.id===id)));
  assert.ok(config.profiles.every(p=>config.rotation.includes(p.id)));
  assert.equal(config.gamesPerOpponent,4); assert.equal(config.epochs,4);
  assert.equal(config.evaluation.everyIterations,4);
  assert.equal(config.evaluation.screenBlocks,2); assert.equal(config.evaluation.confirmationBlocks,16);
  assert.equal(config.evaluation.alpha,.05);assert.equal(config.evaluation.maximumMatchupRegression,.10);
  assert.equal(config.evaluation.minimumMeanImprovement,.02);
  return config;
}

// Each four-game block crosses learner seat and first player. The ordered
// pair is explicit; a specialist never trains the opposite deck by accident.
export function trainingPlan(config,profile,iteration,source,opponents) {
  assert.equal(opponents.length,config.profiles.length);
  const games=opponents.length*config.gamesPerOpponent;
  const seed=seedFor(config,profile.id,'train',iteration),protectedSeeds=new Set(config.protectedSeeds||[]);
  for(let g=0;g<games;g++)assert.ok(!protectedSeeds.has((seed+g*130363)>>>0),'Previously committed seed reused.');
  return {contract:DECK_LEAGUE,role:'training',configHash:digest(config),profileId:profile.id,
    iteration,sourcePath:source.path,sourceBehaviorHash:source.behaviorHash,sourceSha256:source.sha256,
    games,seed,epochSeed:seedFor(config,profile.id,'epoch',iteration),
    opponents,gameRandomnessContract:'seeded-engine-game-v1',
    deckSearch:{contract:'legal-seeded-deck-search-v1',poolId:'origins-era',protocolHash:digest(config.profiles.map(p=>p.deck)),
      sourceBehaviorHash:source.behaviorHash,fixedLearnerDeckId:profile.deck.id,
      population:config.profiles.map(p=>p.deck),candidates:[],assignments:Array.from({length:games},(_,g)=>({
        gameIndex:g,mode:'deck-specialist',testedDeckId:profile.deck.id,
        pairIds:[profile.deck.id,opponents[Math.floor(g/4)].deckId]}))},
    leagueCollection:{contract:'frozen-learner-only-league-v1',behaviorHashes:opponents.map(p=>p.behaviorHash),
      opponentIndexes:Array.from({length:games},(_,g)=>Math.floor(g/4))}};
}

export function scopedLessons(frozen,deckId) {
  // Unidentified legacy cases remain protected globally, but cannot be
  // attributed to a specialist without evidence of its own deck.
  const bank=frozen.bank;
  const training=bank.training.filter(s=>s.deckId===deckId);
  const validation=bank.validation.filter(s=>s.deckId===deckId);
  assert.ok(training.length&&validation.length,'Missing deck-specific correction coverage.');
  const protectedInputs=new Set(bank.validation.map(inputKey));
  assert.ok(training.every(s=>!protectedInputs.has(inputKey(s))),'Protected input entered rehearsal.');
  return {...frozen,bank:{...bank,training,validation,samplesHash:digest([training,validation])}};
}

export function evaluationJobs(config,profile,iteration,phase,opponents) {
  assert.ok(['screen','confirmation'].includes(phase));
  const blocks=phase==='screen'?config.evaluation.screenBlocks:config.evaluation.confirmationBlocks;
  const jobs=opponents.flatMap((opponent,o)=>Array.from({length:blocks},(_,block)=>
    ['candidate','incumbent'].map(subject=>({id:`${o}-${block}-${subject}`,subject,
      opponent,block,seed:seedFor(config,profile.id,'evaluation',iteration,phase,o,block),
      subjectDeckId:profile.deck.id,opponentDeckId:opponent.deckId,games:4})))).flat();
  assert.ok(jobs.every(j=>!(config.protectedSeeds||[]).includes(j.seed)),'Previously committed evaluation seed reused.');
  return jobs;
}

export function assertEvaluationRows(rows,job,reviewHash) {
  assert.equal(rows.length,4);
  rows.forEach((r,i)=>{
    assert.equal(r.candidateSeat,i%2);assert.equal(r.firstPlayerId,Math.floor(i/2)%2?'p2':'p1');
    assert.equal(r.gameSeed,job.seed);assert.equal(r.evaluationMode,'fixed-subject-deck-v1');
    assert.equal(r.deckIds[r.candidateSeat],job.subjectDeckId);
    assert.equal(r.deckIds[1-r.candidateSeat],job.opponentDeckId);
    assert.equal(r.decisionReviewHash,reviewHash);
    assert.ok(r.completed&&!r.invalid&&!r.adjudicated&&r.counted!==false&&['p1','p2'].includes(r.winnerId));
  });
}

// Independent seed BLOCKS, not individual correlated seats, are the units.
// The confirmation uses a fixed, stratified paired bootstrap. Its interval is
// approximate, not a distribution-free guarantee. An inconclusive fixed-budget
// result keeps the incumbent; no sample extension or favorable checkpoint pick.
export function evaluationDecision(config,phase,records) {
  const paired=new Map();
  for(const {job,rows} of records){const key=`${job.opponent.profileId}:${job.block}`;
    const item=paired.get(key)||{opponent:job.opponent.profileId,block:job.block};
    assert.equal(item[job.subject],undefined,'Duplicate evaluation subject.');
    item[job.subject]=rows.filter(r=>r.winnerId===`p${r.candidateSeat+1}`).length/4;paired.set(key,item);}
  const blocks=[...paired.values()].map(b=>{assert.ok(Number.isFinite(b.candidate)&&Number.isFinite(b.incumbent));return {...b,difference:b.candidate-b.incumbent};});
  const expected=phase==='screen'?config.evaluation.screenBlocks:config.evaluation.confirmationBlocks;
  assert.equal(blocks.length,config.profiles.length*expected);
  const mean=blocks.reduce((s,b)=>s+b.difference,0)/blocks.length;
  const byOpponent=config.profiles.map(p=>{const b=blocks.filter(x=>x.opponent===p.id);assert.equal(b.length,expected);
    return {profileId:p.id,blocks:b.length,candidateRate:b.reduce((s,x)=>s+x.candidate,0)/b.length,
      incumbentRate:b.reduce((s,x)=>s+x.incumbent,0)/b.length,difference:b.reduce((s,x)=>s+x.difference,0)/b.length};});
  const alpha=config.evaluation.alpha;
  let randomState=0x17c0d3a9;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  const groups=config.profiles.map(p=>blocks.filter(b=>b.opponent===p.id));
  const draws=Array.from({length:10000},()=>groups.reduce((total,g)=>total+
    g.reduce(sum=>sum+g[Math.floor(random()*g.length)].difference,0)/g.length,0)/groups.length).sort((a,b)=>a-b);
  const lower=draws[Math.floor(alpha*(draws.length-1))],upper=draws[Math.floor((1-alpha)*(draws.length-1))];
  if(phase==='screen')return {phase,mean,lower,upper,byOpponent,blocks,promoted:false,
    intervalIsApproximate:true,eligible:mean>=config.evaluation.minimumMeanImprovement&&byOpponent.every(x=>x.difference>=-.25)};
  // Evidence of aggregate improvement is required for promotion. Per-matchup
  // observed guard supplements the aggregate bound; it is NOT a claim that
  // every matchup has independently demonstrated non-inferiority.
  const promoted=lower>0&&mean>=config.evaluation.minimumMeanImprovement
    &&byOpponent.every(x=>x.difference>=-config.evaluation.maximumMatchupRegression);
  return {phase,mean,lower,upper,confidence:1-alpha,byOpponent,blocks,promoted,
    perMatchupNonInferiorityEstablished:false,bootstrapReplicates:10000,intervalIsApproximate:true,
    method:'stratified-paired-seed-block-percentile-bootstrap-with-observed-matchup-guard'};
}
