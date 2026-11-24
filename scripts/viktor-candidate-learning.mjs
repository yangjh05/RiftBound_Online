import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publicInputKey} from './verified-specialist-lessons.mjs';
import {approvedResourceDeploymentReview} from './resource-deployment-learning.mjs';

export const VIKTOR_CANDIDATE='bounded-viktor-main-candidate-v1';
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const candidateSeed=(c,kind,index)=>parseInt(digest([VIKTOR_CANDIDATE,c.seed,kind,index]).slice(0,8),16)>>>0;
export function candidateReservation(c,state){
  const slots=state?.iteration>=c.iterations?1:c.reservedSlots;
  return {...c.previousReservation,slots:c.previousReservation.slots+slots,
    additionalReservations:[...(c.previousReservation.additionalReservations||[]),{directory:c.directory,slots,contract:VIKTOR_CANDIDATE}]};
}

export function trainingPairs(c,iteration){
  // Half of the learner trajectories are Viktor. Every other deck gets four
  // mirror trajectories each cycle, plus its rotating cross-deck practice.
  const others=c.decks.filter(d=>d.id!==c.deckId).map(d=>d.id);
  assert.equal(others.length,6);
  const blocks=[...Array.from({length:6},()=>[c.deckId,c.deckId]),
    ...Array.from({length:4},(_,i)=>[c.deckId,c.crossOpponentIds[(i+iteration-1)%4]]),
    ...others.map(id=>[id,id])];
  return blocks.flatMap(pair=>Array.from({length:4},()=>pair));
}
export function candidateTrainingPlan(c,iteration,sourcePath,sourceBehaviorHash,opponentHashes,pairFor){
  assert.ok(iteration>=1&&iteration<=4);assert.equal(opponentHashes.length,2);
  const assignments=trainingPairs(c,iteration).map((pairIds,gameIndex)=>({gameIndex,pairIds,testedDeckId:pairIds[0],mode:pairIds[0]===pairIds[1]?'mirror':'cross'}));
  const plan={contract:VIKTOR_CANDIDATE,configHash:digest(c),iteration,sourcePath,sourceBehaviorHash,
    games:64,seed:candidateSeed(c,'ppo',iteration),epochSeed:candidateSeed(c,'epoch',iteration),
    gameRandomnessContract:'seeded-engine-game-v1',role:'training',promotionEligible:false,
    deckSearch:{contract:'legal-seeded-deck-search-v1',poolId:'origins-era',protocolHash:digest(c.decks),
      sourceBehaviorHash,population:c.decks,candidates:c.decks,assignments}};
  const opponentIndexes=assignments.map((_,g)=>{
    const opponentDeck=pairFor(plan.deckSearch,g,plan.seed)[1-g%2].id;
    const block=Math.floor(g/4);
    return opponentDeck===c.deckId?[2,1,0][(block+iteration-1)%3]:[1,1,0][(block+iteration-1)%3];
  });
  plan.leagueCollection={contract:'frozen-learner-only-league-v1',behaviorHashes:[sourceBehaviorHash,...opponentHashes],opponentIndexes};
  return plan;
}
export function fullLessonSchedule(c){
  return Array.from({length:20},(_,index)=>{
    const repeat=Math.floor(index/5),opponent=[c.deckId,...c.crossOpponentIds][index%5];
    return {id:`full-${index}`,index,iteration:repeat+1,role:(index%5+repeat)%2?'validation':'training',
      seed:candidateSeed(c,'lesson',index),deckIds:Math.floor(repeat/2)?[opponent,c.deckId]:[c.deckId,opponent],chooser:repeat%2?'p1':'p2'};
  });
}
export function candidateScreenJobs(c){
  const jobs=[];
  for(let block=0;block<8;block++)jobs.push({id:`viktor-mirror-${block}`,group:'specialist-mirror',subject:'candidate',opponent:'specialist',
    deckIds:[c.deckId],games:8,seed:(candidateSeed(c,'screen-mirror',block)|1)>>>0,mode:'same-deck-mirror-v3'});
  c.crossOpponentIds.forEach((id,index)=>{
    for(let block=0;block<2;block++)for(const subject of ['candidate','specialist'])jobs.push({id:`cross-${index}-${block}-${subject}`,
      group:`cross-${id}`,subject,opponent:'parent',deckIds:[c.deckId,id].sort(),games:8,
      seed:(candidateSeed(c,'screen-cross',index*2+block)|1)>>>0,mode:'cross-deck-matrix-v1'});
  });
  c.decks.filter(d=>d.id!==c.deckId).forEach((deck,index)=>{
    for(let block=0;block<4;block++)jobs.push({id:`retention-${index}-${block}`,group:`retention-${deck.id}`,
      subject:'candidate',opponent:'parent',deckIds:[deck.id],games:8,
      seed:candidateSeed(c,'screen-retention',index*4+block),mode:'same-deck-mirror-v3'});
  });
  return jobs;
}
export function validateCandidateConfig(c){
  assert.equal(c.contract,VIKTOR_CANDIDATE);assert.equal(c.iterations,4);assert.equal(c.gamesPerIteration,64);
  assert.equal(c.epochs,4);assert.equal(c.reservedSlots,3);assert.equal(c.workerProcesses,2);
  assert.equal(c.maxLessonActions,2400);assert.equal(c.maximumVerifiedPerGame,4);assert.equal(c.maximumTeacherReviews,48);
  assert.equal(c.promotionEligible,false);assert.equal(c.autoIntegration,false);
  assert.equal(c.decks.length,7);assert.equal(new Set(c.decks.map(d=>d.id)).size,7);
  assert.equal(c.crossOpponentIds.length,4);assert.equal(new Set(c.crossOpponentIds).size,4);
  assert.ok(c.crossOpponentIds.every(id=>id!==c.deckId&&c.decks.some(d=>d.id===id)));
  const protectedSeeds=new Set(c.protectedSeeds),used=new Set();
  const insert=seed=>{assert.ok(seed>0&&seed<=0xffffffff);assert.ok(!protectedSeeds.has(seed),'Previously committed seed reused.');assert.ok(!used.has(seed),'Training/validation/evaluation namespaces overlap.');used.add(seed);};
  for(let i=1;i<=4;i++)for(let g=0;g<64;g++)insert((candidateSeed(c,'ppo',i)+g*130363)>>>0);
  for(const job of fullLessonSchedule(c))insert(job.seed);
  const scheduled=new Set();
  for(const job of candidateScreenJobs(c))for(const seed of [job.seed,...(job.mode==='cross-deck-matrix-v1'?[(job.seed+104729)>>>0]:[])]){
    // A deliberately matched subject pair shares evaluation conditions only.
    if(scheduled.has(seed)){assert.equal(job.subject,'specialist');continue;}
    insert(seed);scheduled.add(seed);
  }
  return c;
}

// This gate can only RESTRICT the unchanged public teacher. It cannot create a
// label from a specialist choice, a planned continuation or a winning game.
export function approvedTeacherAdvice(advice,currentKey,key){
  if(!advice||!(advice.weight>0)||key(advice.action)===currentKey)return false;
  if(advice.mulliganLesson)return advice.searchComplete===true&&advice.gain>=.75;
  if(advice.growthLesson)return false; // Growth uses unchanged acceptedSupplyAdvice instead.
  if(advice.localResourceLesson&&approvedResourceDeploymentReview(advice.review,advice.comparison))return true;
  if(advice.localResourceLesson)return advice.review?.applied===true&&
    ['same-result-less-spending','verified-card-order-savings'].includes(advice.comparison)&&
    !advice.review.partialSearch&&!advice.review.comparisons?.some(c=>Math.abs(c.score)===1000);
  if(advice.responsePolicyLesson){
    const r=advice.responseReview,rows=r?.comparisons;
    if(!rows?.length||r.belief?.confidence==='low'||r.belief?.unsupportedObservedCards?.length)return false;
    if(!rows.every(c=>Number.isFinite(c.score)&&Number.isFinite(c.noHandResponseScore)&&c.responses.every(o=>Number.isFinite(o.score))))return false;
    const best=rows.find(c=>key(c.action)===key(advice.action)),current=rows.find(c=>key(c.action)===currentKey);
    return !!best&&!!current&&best.score-current.score>=.25;
  }
  return false;
}
export function mergeCandidateLessons(frozen,fresh,previouslyTrainedKeys=[]){
  const bank=frozen.bank,oldTrain=new Set(bank.training.map(publicInputKey)),oldHeld=new Set(bank.validation.map(publicInputKey));
  const usedForTraining=new Set([...oldTrain,...previouslyTrainedKeys]);
  // A newly labelled validation scene cannot erase the fact that this input
  // was already used for training. Exclude it instead of claiming it is fresh.
  const held=fresh.filter(s=>s.lessonRole==='validation'&&!usedForTraining.has(publicInputKey(s))&&!oldHeld.has(publicInputKey(s)));
  const heldKeys=new Set([...oldHeld,...held.map(publicInputKey)]),seenTrain=new Set(oldTrain),seenHeld=new Set(oldHeld);
  const training=[...bank.training],validation=[...bank.validation];
  for(const s of held){const key=publicInputKey(s);if(!seenHeld.has(key)){validation.push(s);seenHeld.add(key);}}
  for(const s of fresh.filter(s=>s.lessonRole==='training')){const key=publicInputKey(s);
    if(!heldKeys.has(key)&&!seenTrain.has(key)){training.push(s);seenTrain.add(key);}}
  return {...frozen,bank:{...bank,training,validation,samplesHash:digest([training,validation])},
    freshCounts:{training:training.length-bank.training.length,validation:validation.length-bank.validation.length}};
}

// History spans candidate stages, even when a new stage restarts from the
// original parent. An old training decision never becomes held-out evidence.
export function inheritedCandidateTrainingKeys(history,validation=[]){
  if(!history)return new Set();
  assert.equal(history.contract,'candidate-training-input-history-v1');
  assert.ok(Array.isArray(history.keys));
  assert.ok(history.keys.every(key=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)));
  assert.deepEqual(history.keys,[...new Set(history.keys)].sort());
  assert.equal(history.keysHash,digest(history.keys),'Prior training input history changed.');
  const keys=new Set(history.keys);
  for(const sample of validation)assert.ok(!keys.has(publicInputKey(sample)),'Previously trained input entered inherited validation.');
  return keys;
}

export function splitProtectedTrajectories(trajectories,protectedKeys,actionDimension){
  const eligible=[],excluded=[],trainedKeys=new Set();
  trajectories.forEach((trajectory,index)=>{
    const keys=trajectory.steps.map(step=>publicInputKey({steps:[{...step,actions:Array.from(step.actions).slice(0,step.legalCount*actionDimension)}]}));
    if(keys.some(key=>protectedKeys.has(key)))excluded.push({index,reason:'protected-validation-input'});
    else {eligible.push(trajectory);for(const key of keys)trainedKeys.add(key);}
  });
  return {eligible,excluded,trainedKeys:[...trainedKeys].sort()};
}

export function summarizeCandidateScreen(rows,viktorId){
  const groups={},paired=new Map();
  for(const row of rows){
    assert.ok(row.completed&&!row.invalid&&!row.adjudicated&&row.counted!==false);
    const deck=row.deckIds[row.candidateSeat],opponent=row.deckIds[1-row.candidateSeat];
    const key=`${row.group}:${row.subject}:${deck}`,g=groups[key]||={deckId:deck,opponentDeckId:opponent,games:0,wins:0,seedBlocks:{}};
    const win=Number(row.winnerId===`p${row.candidateSeat+1}`);g.games++;g.wins+=win;
    const b=g.seedBlocks[row.gameSeed]||={games:0,wins:0};b.games++;b.wins+=win;
    if(row.group.startsWith('cross-')&&deck===viktorId){
      const id=`${row.group}:${row.gameSeed}`,pair=paired.get(id)||{id,opponentDeckId:opponent,seed:row.gameSeed};
      const s=pair[row.subject]||={games:0,wins:0};s.games++;s.wins+=win;paired.set(id,pair);
    }
  }
  const pairedViktorBlocks=[...paired.values()].map(pair=>{
    assert.equal(pair.candidate?.games,4);assert.equal(pair.specialist?.games,4);
    return {...pair,difference:pair.candidate.wins/4-pair.specialist.wins/4};
  });
  return {groups,pairedViktorBlocks,meanPairedViktorDifference:pairedViktorBlocks.length?
    pairedViktorBlocks.reduce((n,b)=>n+b.difference,0)/pairedViktorBlocks.length:null};
}
