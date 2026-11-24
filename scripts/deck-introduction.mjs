import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from './adaptive-policy-q-contract.mjs';
import {readTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {assertLegalTrainingDeck,trainingDeckKey} from '../src/ai/legal-decks.mjs';
import {evaluationConditionSchedule,scheduledEvaluationMatrixPair} from '../src/ai/neural/selfplay.mjs';

export const DECK_INTRODUCTION_CONTRACT='prospective-evaluated-deck-introduction-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};

export function validateDeckIntroduction(p,search,engineFingerprint){
  assert.equal(p.contract,DECK_INTRODUCTION_CONTRACT);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.equal(p.engineFingerprint,engineFingerprint);
  assert.equal(p.deckSearchProtocolHash,digest(search));
  assert.deepEqual(p.share,{numerator:1,denominator:10,blockGames:8});
  assert.equal(p.automaticExpansion,false);assert.equal(p.mergeWeights,false);
  assertLegalTrainingDeck(p.deck,search.poolId);
  assert.ok(!search.anchors.some(d=>d.id===p.deck.id));
  assert.deepEqual(p.opponentDeckIds,search.anchors.map(d=>d.id));
  assert.equal(new Set(p.opponentDeckIds).size,p.opponentDeckIds.length);
  assert.ok(p.opponentDeckIds.length>=2);
  const g=p.gate;
  assert.ok(path.isAbsolute(g.directory));assert.ok(Number.isSafeInteger(g.iteration)&&g.iteration>0);
  assert.ok(Number.isSafeInteger(g.candidateGeneration)&&g.candidateGeneration>g.sourceGeneration);
  for(const key of ['configSha256','planSha256','candidateSha256','initialSha256'])assert.match(g[key],/^[a-f0-9]{64}$/);
  assert.equal(g.regressionRule,'four-negative-blocks-and-25pp-v1');
  return p;
}
export async function readDeckIntroduction(root,search,engineFingerprint){
  let p;try{p=JSON.parse((await fs.readFile(path.join(root,'deck-introduction-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  return validateDeckIntroduction(p,search,engineFingerprint);
}
export function commitDeckIntroduction(state,p){
  const value=p?digest(p):null;
  if(state.deckIntroductionProtocolHash)assert.equal(value,state.deckIntroductionProtocolHash,'Deck introduction changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Deck introduction must start prospectively.');state.deckIntroductionProtocolHash=value;}
  if(state.deckIntroduction){
    assert.equal(state.deckIntroduction.protocolHash,value);
    assert.ok(state.deckIntroduction.firstIteration>p.afterIteration);
    assert.equal(state.deckIntroduction.gateHash,digest(state.deckIntroduction.gate));
    assert.equal(state.deckIntroduction.gate.status,'approved');
  }
}

export function assertPilotIntroductionGame(summary,job,index,gate,reviewHash){
  const {candidateSeat,firstPlayerId}=evaluationConditionSchedule(index);
  const pair=job.kind==='mirror'?job.decks:
    scheduledEvaluationMatrixPair(job.decks,Math.floor(index/4),job.seed);
  const deckIds=job.kind==='mirror'?[pair[0].id,pair[0].id]:
    (candidateSeat===0?pair:[pair[1],pair[0]]).map(d=>d.id);
  const expected={candidateSeat,firstPlayerId,gameSeed:(job.seed+Math.floor(index/(job.kind==='mirror'?8:4))*104729)>>>0,
    evaluationMode:job.mode,streamAssignment:job.kind==='mirror'?Math.floor(index/4):0,deckIds,decisionReviewHash:reviewHash};
  for(const [key,value] of Object.entries(expected))assert.deepEqual(summary[key],value,`Pilot evaluation ${key} changed`);
  assert.equal(summary.completed,true);assert.ok(!summary.invalid&&!summary.adjudicated&&summary.counted!==false);
  assert.ok(['p1','p2'].includes(summary.winnerId));
  assert.ok(!summary.decisionSafetyViolations?.length);
  assert.equal(summary.aiSeats?.length,2);
  for(let seat=0;seat<2;seat++)assert.equal(summary.aiSeats[seat].generation,
    seat===candidateSeat&&!job.baseline?gate.candidateGeneration:gate.sourceGeneration);
  assert.ok(summary.decisionReviewStats?.every(s=>s.errors===0),'Pilot reviewer failed');
  return summary;
}

// This is an admission check for a small curriculum trial, not a statistical
// promotion or a proof that the specialist is better than the current main AI.
export function summarizeIntroductionGate(schedule,records,deckId){
  assert.equal(schedule.length,40);assert.equal(records.length,320);
  assert.equal(schedule.filter(j=>j.kind==='mirror').length,8);
  assert.equal(new Set(schedule.map(j=>j.id)).size,40);
  const cells=new Map(),mirror={games:0,wins:0};
  for(const [jobIndex,job] of schedule.entries()){
    assert.ok(['mirror','cross'].includes(job.kind));
    if(job.kind==='mirror'){
      for(const s of records.slice(jobIndex*8,jobIndex*8+8)){mirror.games++;mirror.wins+=Number(s.winnerId===`p${s.candidateSeat+1}`);}
      continue;
    }
    if(job.baseline)continue;
    const prior=schedule[jobIndex-1];
    assert.equal(prior.kind,'cross');assert.equal(prior.baseline,true);
    assert.equal(prior.seed,job.seed);assert.equal(prior.opponentId,job.opponentId);assert.deepEqual(prior.decks,job.decks);
    const blockDeltas=new Map();
    for(let i=0;i<8;i++){
      const a=records[(jobIndex-1)*8+i],b=records[jobIndex*8+i];
      for(const key of ['deckIds','gameSeed','candidateSeat','firstPlayerId','streamAssignment'])assert.deepEqual(a[key],b[key]);
      const role=b.deckIds[b.candidateSeat]===deckId?'introduced-deck':'existing-deck';
      const key=`${job.opponentId}:${role}`;
      const cell=cells.get(key)||{opponentId:job.opponentId,role,games:0,beforeWins:0,afterWins:0,blockDeltas:[]};
      cells.set(key,cell);cell.games++;
      const before=Number(a.winnerId===`p${a.candidateSeat+1}`),after=Number(b.winnerId===`p${b.candidateSeat+1}`);
      cell.beforeWins+=before;cell.afterWins+=after;
      blockDeltas.set(key,(blockDeltas.get(key)||0)+after-before);
    }
    for(const [key,delta] of blockDeltas)cells.get(key).blockDeltas.push(delta/4);
  }
  assert.equal(cells.size,8);
  const rows=[...cells.values()].map(c=>{
    assert.equal(c.games,16);assert.equal(c.blockDeltas.length,4);
    const delta=(c.afterWins-c.beforeWins)/c.games;
    return {...c,delta,largeConsistentRegression:delta<=-0.25&&c.blockDeltas.every(d=>d<0)};
  });
  const reasons=rows.filter(c=>c.largeConsistentRegression).map(c=>`${c.opponentId}:${c.role}:consistent-regression`);
  if(mirror.wins<mirror.games/2)reasons.push('mirror-below-starting-model');
  return {status:reasons.length?'held':'approved',reasons,mirror,rows,games:320,
    regressionRule:'four-negative-blocks-and-25pp-v1',promotionEligible:false};
}

export async function inspectIntroductionGate(p){
  const g=p.gate,root=g.directory,folder=path.join(root,'evaluations',String(g.iteration).padStart(6,'0'));
  const result=await optional(path.join(folder,'result.json.gz'));
  if(!result)return {status:'waiting',reason:'pilot-evaluation-incomplete'};
  const readBound=async(file,sha)=>{const bytes=await fs.readFile(file);assert.equal(hash(bytes),sha,`${path.basename(file)} changed`);return bytes;};
  const config=JSON.parse(await readBound(path.join(root,'config.json'),g.configSha256));
  assert.equal(config.engineFingerprint,p.engineFingerprint);assert.equal(trainingDeckKey(config.deck),trainingDeckKey(p.deck));
  await readBound(path.join(folder,'plan.json.gz'),g.planSha256);
  const candidatePath=path.join(root,'iterations',String(g.iteration).padStart(6,'0'),'candidate.json.gz');
  await readBound(candidatePath,g.candidateSha256);await readBound(config.initialPath,g.initialSha256);
  const plan=await readTrajectoryArchive(path.join(folder,'plan.json.gz'));
  assert.equal(plan.configHash,digest(config));assert.equal(result.configHash,plan.configHash);
  assert.equal(plan.iteration,g.iteration);assert.equal(result.trainingGames,g.iteration*32);
  assert.equal(result.continuationHash,plan.continuationHash);assert.equal(path.resolve(result.candidatePath),path.resolve(candidatePath));
  assert.equal(result.status,'periodic-evaluation-complete');
  assert.equal(plan.schedule.length,40);assert.equal(result.summaries.length,320);
  const records=[],proof=[];
  // The review hash saved in summaries is the digest of the frozen reviewer.
  const reviewHash=digest(plan.review);
  for(const job of plan.schedule)for(let i=0;i<8;i++){
    const file=path.join(folder,`${job.id}-${i}.json`),bytes=await fs.readFile(file);
    const s=assertPilotIntroductionGame(JSON.parse(bytes),job,i,g,reviewHash);
    assert.deepEqual(result.summaries[records.length],{...s,pilotKind:job.kind,beforeTraining:job.baseline,opponentId:job.opponentId||null});
    records.push(s);proof.push({file:path.basename(file),sha256:hash(bytes)});
  }
  return {...summarizeIntroductionGate(plan.schedule,records,p.deck.id),
    resultSha256:hash(await fs.readFile(path.join(folder,'result.json.gz'))),planSha256:g.planSha256,
    recordsHash:digest(proof),candidateSha256:g.candidateSha256};
}

export async function resolveDeckIntroduction(p,activation,iteration,{inspect=inspectIntroductionGate}={}){
  if(!p||iteration<=p.afterIteration)return {status:'inactive',activation:null};
  if(activation){assert.equal(activation.protocolHash,digest(p));return {status:'active',activation};}
  let gate;
  try{gate=await inspect(p);}catch(e){return {status:'held',reason:`Evaluation verification failed: ${e.message}`,activation:null};}
  if(gate.status!=='approved')return {...gate,activation:null};
  return {status:'active',activation:{protocolHash:digest(p),firstIteration:iteration,
    gate,gateHash:digest(gate),activatedAt:new Date().toISOString()}};
}

export function introduceDeckInPlan(plan,p,activation){
  if(!activation)return plan;
  assert.ok(p&&plan.iteration>=activation.firstIteration);assert.equal(activation.protocolHash,digest(p));
  assert.equal(plan.games,32);assert.ok(plan.deckSearch);
  assert.equal(plan.deckSearch.protocolHash,p.deckSearchProtocolHash);
  const next=structuredClone(plan),search=next.deckSearch;
  const n=plan.iteration-activation.firstIteration;
  const first=Math.floor((n*4+9)/10),end=Math.floor(((n+1)*4+9)/10);
  const gameIndexes=[],opponentIds=[];
  for(let ordinal=first;ordinal<end;ordinal++){
    const block=ordinal%4,opponentId=p.opponentDeckIds[ordinal%p.opponentDeckIds.length];
    assert.ok(search.population.some(d=>d.id===opponentId));opponentIds.push(opponentId);
    for(let offset=0;offset<8;offset++){
      const gameIndex=block*8+offset;gameIndexes.push(gameIndex);
      search.assignments[gameIndex]={gameIndex,mode:'introduced-deck',testedDeckId:p.deck.id,
        pairIds:[p.deck.id,opponentId],sourceBehaviorHash:plan.sourceBehaviorHash};
    }
  }
  if(gameIndexes.length){
    assert.ok(!search.population.some(d=>d.id===p.deck.id));search.population.push(structuredClone(p.deck));
  }
  next.deckIntroduction={contract:DECK_INTRODUCTION_CONTRACT,protocolHash:digest(p),gateHash:activation.gateHash,
    firstIteration:activation.firstIteration,share:p.share,deckId:p.deck.id,gameIndexes,opponentIds};
  return next;
}

export function assertDeckIntroductionPlan(plan,p,activation){
  if(!activation||plan.iteration<activation.firstIteration){assert.ok(!plan.deckIntroduction);return;}
  const m=plan.deckIntroduction;assert.ok(m,'Missing frozen deck introduction');
  assert.equal(m.protocolHash,digest(p));assert.equal(m.gateHash,activation.gateHash);
  assert.equal(m.firstIteration,activation.firstIteration);assert.equal(m.deckId,p.deck.id);
  assert.deepEqual(m.share,p.share);
  const n=plan.iteration-activation.firstIteration,first=Math.floor((n*4+9)/10),end=Math.floor(((n+1)*4+9)/10);
  const indexes=[],opponents=[];
  for(let ordinal=first;ordinal<end;ordinal++){
    const opponent=p.opponentDeckIds[ordinal%p.opponentDeckIds.length];opponents.push(opponent);
    for(let offset=0;offset<8;offset++){
      const index=(ordinal%4)*8+offset;indexes.push(index);
      assert.deepEqual(plan.deckSearch.assignments[index],{gameIndex:index,mode:'introduced-deck',testedDeckId:p.deck.id,
        pairIds:[p.deck.id,opponent],sourceBehaviorHash:plan.sourceBehaviorHash});
    }
  }
  assert.deepEqual(m.gameIndexes,indexes);assert.deepEqual(m.opponentIds,opponents);
  if(indexes.length)assert.equal(trainingDeckKey(plan.deckSearch.population.find(d=>d.id===p.deck.id)),trainingDeckKey(p.deck));
  for(const a of plan.deckSearch.assignments)if(!indexes.includes(a.gameIndex))assert.ok(!a.pairIds.includes(p.deck.id));
}
