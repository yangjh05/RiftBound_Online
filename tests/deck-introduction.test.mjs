import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {decklists} from '../src/cards.mjs';
import {resolveTrainingDecks} from '../src/ai/training-decks.mjs';
import {trainingDeckKey} from '../src/ai/legal-decks.mjs';
import {authoredTrainingDecks} from '../scripts/authored-training-decks.mjs';
import {createDeckSearchProtocol,createDeckSearchPlan,expectedDeckSearchPair,learnDeckSearch} from '../scripts/adaptive-deck-search.mjs';
import {selfPlayComparisonSchedule,evaluationConditionSchedule,scheduledEvaluationMatrixPair} from '../src/ai/neural/selfplay.mjs';
import {utilityPlan,adaptiveGameRole} from '../scripts/policy-q-utility.mjs';
import {digest} from '../scripts/adaptive-policy-q-contract.mjs';
import {pilotEvaluationSchedule} from '../scripts/train-deck-pilot.mjs';
import {writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {DECK_INTRODUCTION_CONTRACT,validateDeckIntroduction,commitDeckIntroduction,resolveDeckIntroduction,
  introduceDeckInPlan,assertDeckIntroductionPlan,assertPilotIntroductionGame,summarizeIntroductionGate,inspectIntroductionGate} from '../scripts/deck-introduction.mjs';
const search=createDeckSearchProtocol(resolveTrainingDecks(decklists,'origins-era'),0);
const deck=authoredTrainingDecks().find(d=>d.legend.name.startsWith('Viktor'));
const p={contract:DECK_INTRODUCTION_CONTRACT,afterIteration:100,engineFingerprint:'fp',deckSearchProtocolHash:digest(search),
  share:{numerator:1,denominator:10,blockGames:8},automaticExpansion:false,mergeWeights:false,deck,
  opponentDeckIds:search.anchors.map(d=>d.id),gate:{directory:path.resolve('pilot'),iteration:68,
    candidateGeneration:78,sourceGeneration:10,configSha256:'0'.repeat(64),planSha256:'0'.repeat(64),
    candidateSha256:'0'.repeat(64),initialSha256:'0'.repeat(64),regressionRule:'four-negative-blocks-and-25pp-v1'}};
const gate={status:'approved',recordsHash:'proof'};
const activation={protocolHash:digest(p),firstIteration:101,gate,gateHash:digest(gate)};
const makePlan=iteration=>{
  const plan={iteration,games:32,seed:73641+iteration,sourceBehaviorHash:'main-policy',
    utility:utilityPlan({afterIteration:0,validationEveryGames:8},iteration,32)};
  plan.deckSearch=createDeckSearchPlan(search,undefined,plan);return plan;
};

test('introduction is prospective, immutable, optional, exact-list and never an automatic weight merge',()=>{
  validateDeckIntroduction(p,search,'fp');
  const s={iteration:100};commitDeckIntroduction(s,p);commitDeckIntroduction(s,p);
  for(const changed of [null,{...p,share:{...p.share,numerator:2}}])assert.throws(()=>commitDeckIntroduction(s,changed));
  assert.throws(()=>commitDeckIntroduction({iteration:101},p));
  assert.throws(()=>validateDeckIntroduction({...p,mergeWeights:true},search,'fp'));
  assert.throws(()=>validateDeckIntroduction({...p,opponentDeckIds:p.opponentDeckIds.slice(1)},search,'fp'));
  assert.throws(()=>validateDeckIntroduction(p,search,'changed'));
  commitDeckIntroduction({...s,deckIntroduction:activation},p);
  const plan=makePlan(100);assert.equal(introduceDeckInPlan(plan,p,null),plan);assertDeckIntroductionPlan(plan,p,null);
});

test('only complete approved evaluation activates on a new iteration and restart keeps that boundary',async()=>{
  for(const status of ['waiting','held']){
    const r=await resolveDeckIntroduction(p,null,101,{inspect:async()=>({status})});
    assert.equal(r.activation,null);assert.equal(r.status,status);
  }
  const failed=await resolveDeckIntroduction(p,null,101,{inspect:async()=>{throw Error('changed evidence');}});
  assert.equal(failed.status,'held');assert.match(failed.reason,/changed evidence/);
  const r=await resolveDeckIntroduction(p,null,109,{inspect:async()=>gate});
  assert.equal(r.activation.firstIteration,109);
  const resumed=await resolveDeckIntroduction(p,r.activation,110,{inspect:async()=>{throw Error('must not redefine activation');}});
  assert.deepEqual(resumed.activation,r.activation);
  assert.equal((await resolveDeckIntroduction(p,null,100,{inspect:async()=>gate})).status,'inactive');
});

test('ten percent uses intact eight-game blocks, rotates all six decks and preserves on-policy roles and old assignments',()=>{
  let total=0,training=0,validation=0;const opponents=new Set();
  for(let i=101;i<131;i++){
    const original=makePlan(i),before=digest(original),plan=introduceDeckInPlan(original,p,activation);
    assert.equal(digest(original),before);assertDeckIntroductionPlan(plan,p,activation);
    assert.deepEqual(plan,introduceDeckInPlan(original,p,activation));
    assert.deepEqual(plan.utility,original.utility);
    assert.deepEqual(plan.deckSearch.candidates,original.deckSearch.candidates);
    const chosen=plan.deckIntroduction.gameIndexes;total+=chosen.length;
    assert.ok([0,8].includes(chosen.length));
    const conditions=new Map();
    for(let game=0;game<32;game++){
      if(!chosen.includes(game)){assert.deepEqual(plan.deckSearch.assignments[game],original.deckSearch.assignments[game]);continue;}
      assert.equal(plan.deckSearch.assignments[game].sourceBehaviorHash,plan.sourceBehaviorHash);
      const pair=expectedDeckSearchPair(plan.deckSearch,game,plan.seed),seat=pair.findIndex(d=>d.id===deck.id);
      assert.ok(seat>=0);assert.notEqual(pair[1-seat].id,deck.id);opponents.add(pair[1-seat].id);
      const condition=`${seat}:${selfPlayComparisonSchedule(game).firstPlayerId}`;
      conditions.set(condition,(conditions.get(condition)||0)+1);
      if(adaptiveGameRole(plan,game)==='validation')validation++;else training++;
    }
    if(chosen.length)assert.deepEqual([...conditions.values()],[2,2,2,2]);
    if((i-100)%5===0)assert.equal(total,(i-100)*32/10);
  }
  assert.equal(total,96);assert.equal(training,84);assert.equal(validation,12);
  assert.deepEqual([...opponents].sort(),[...p.opponentDeckIds].sort());
});

test('frozen introduction rejects missing, extra, changed deck and changed ratio assignments',()=>{
  const plan=introduceDeckInPlan(makePlan(101),p,activation);
  for(const mutate of [x=>delete x.deckIntroduction,x=>x.deckIntroduction.gameIndexes.pop(),
    x=>x.deckSearch.assignments[0].pairIds.reverse(),x=>x.deckIntroduction.share.numerator=2,
    x=>x.deckSearch.assignments[10].pairIds[0]=deck.id]){
    const changed=structuredClone(plan);mutate(changed);assert.throws(()=>assertDeckIntroductionPlan(changed,p,activation));
  }
});

test('introduction results cannot bias old deck-search rankings or opponent rotation',()=>{
  const plan=introduceDeckInPlan(makePlan(101),p,activation);
  const records=plan.deckSearch.assignments.map((_,index)=>{
    const pair=expectedDeckSearchPair(plan.deckSearch,index,plan.seed);
    return {summary:{completed:true,winnerId:'p1',firstPlayerId:'p1',deckIds:pair.map(d=>d.id)},
      deckSearchConfigurationKeys:pair.map(trainingDeckKey),trajectories:pair.map((d,seat)=>({playerId:`p${seat+1}`,deckId:d.id}))};
  });
  const a=learnDeckSearch(undefined,plan,records),changed=structuredClone(records);
  for(const i of plan.deckIntroduction.gameIndexes)changed[i].summary.winnerId='p2';
  assert.deepEqual(learnDeckSearch(undefined,plan,changed),a);assert.equal(a.stats[deck.id],undefined);
});

function evaluationFixture(){
  const config={engineFingerprint:'fp',deck,opponentDecks:search.anchors.slice(0,4),evaluationSeed:843781};
  const schedule=pilotEvaluationSchedule(config),review={contract:'fixture-review'},reviewHash=digest(review);
  const records=[];
  for(const job of schedule)for(let i=0;i<8;i++){
    const {candidateSeat,firstPlayerId}=evaluationConditionSchedule(i);
    const pair=job.kind==='mirror'?[deck,deck]:scheduledEvaluationMatrixPair(job.decks,Math.floor(i/4),job.seed);
    const ordered=candidateSeat===0?pair:[pair[1],pair[0]];
    records.push({completed:true,invalid:false,adjudicated:false,counted:true,winnerId:`p${candidateSeat+1}`,
      candidateSeat,firstPlayerId,gameSeed:(job.seed+Math.floor(i/(job.kind==='mirror'?8:4))*104729)>>>0,
      evaluationMode:job.mode,streamAssignment:job.kind==='mirror'?Math.floor(i/4):0,deckIds:ordered.map(d=>d.id),
      decisionReviewHash:reviewHash,decisionReviewStats:[{errors:0},{errors:0}],
      aiSeats:[0,1].map(seat=>({generation:seat===candidateSeat&&!job.baseline?78:10}))});
  }
  return {config,schedule,review,reviewHash,records};
}

test('evaluation admission validates every condition and holds consistent cross-role regression',()=>{
  const {schedule,records,reviewHash}=evaluationFixture();
  schedule.forEach((job,j)=>{for(let i=0;i<8;i++)assertPilotIntroductionGame(records[j*8+i],job,i,p.gate,reviewHash);});
  assert.equal(summarizeIntroductionGate(schedule,records,deck.id).status,'approved');
  for(const change of [{gameSeed:2},{candidateSeat:1},{completed:false},{invalid:true},{adjudicated:true},
    {decisionReviewHash:'wrong'},{aiSeats:[{generation:10},{generation:10}]}])
    assert.throws(()=>assertPilotIntroductionGame({...records[0],...change},schedule[0],0,p.gate,reviewHash));
  const regressed=structuredClone(records);
  for(let j=0;j<schedule.length;j++)if(schedule[j].kind==='cross'&&!schedule[j].baseline&&schedule[j].opponentId===schedule[8].opponentId)
    for(let i=0;i<8;i++)regressed[j*8+i].winnerId=`p${2-regressed[j*8+i].candidateSeat}`;
  const report=summarizeIntroductionGate(schedule,regressed,deck.id);
  assert.equal(report.status,'held');assert.equal(report.reasons.length,2);
  assert.throws(()=>summarizeIntroductionGate(schedule,records.slice(1),deck.id));
});

test('full archive gate waits, validates hashes and all 320 records, and refuses corrupt saved results',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'deck-introduction-'));
  const sha=b=>createHash('sha256').update(b).digest('hex');
  try{
    const q=structuredClone(p);q.gate.directory=root;
    assert.equal((await inspectIntroductionGate(q)).status,'waiting');
    const {config,schedule,records,review}=evaluationFixture();
    config.initialPath=path.join(root,'initial.json');
    const folder=path.join(root,'evaluations','000068'),candidate=path.join(root,'iterations','000068','candidate.json.gz');
    await fs.mkdir(folder,{recursive:true});await fs.mkdir(path.dirname(candidate),{recursive:true});
    await fs.writeFile(config.initialPath,'initial');await fs.writeFile(candidate,'candidate');
    await fs.writeFile(path.join(root,'config.json'),JSON.stringify(config));
    const frozen={configHash:digest(config),iteration:68,continuationHash:'continued',schedule,review};
    await writeTrajectoryArchive(path.join(folder,'plan.json.gz'),frozen);
    const summaries=[];
    for(let j=0;j<schedule.length;j++)for(let i=0;i<8;i++){
      const job=schedule[j],s=records[j*8+i];
      await fs.writeFile(path.join(folder,`${job.id}-${i}.json`),JSON.stringify(s));
      summaries.push({...s,pilotKind:job.kind,beforeTraining:job.baseline,opponentId:job.opponentId||null});
    }
    const result={configHash:digest(config),continuationHash:'continued',candidatePath:candidate,trainingGames:68*32,
      status:'periodic-evaluation-complete',summaries};
    const resultFile=path.join(folder,'result.json.gz');await writeTrajectoryArchive(resultFile,result);
    for(const [key,file] of Object.entries({configSha256:path.join(root,'config.json'),planSha256:path.join(folder,'plan.json.gz'),
      candidateSha256:candidate,initialSha256:config.initialPath}))q.gate[key]=sha(await fs.readFile(file));
    const report=await inspectIntroductionGate(q);assert.equal(report.status,'approved');assert.equal(report.games,320);
    result.summaries[319].gameSeed++;await writeTrajectoryArchive(resultFile,result);
    await assert.rejects(inspectIntroductionGate(q));
    const resolved=await resolveDeckIntroduction(q,null,101);assert.equal(resolved.status,'held');assert.equal(resolved.activation,null);
  }finally{assert.ok(path.basename(root).startsWith('deck-introduction-'));await fs.rm(root,{recursive:true,force:true});}
});
