import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable,reserveSeeds} from './deck-league-io.mjs';
import {digest,seedFor,evaluationJobs,MATCH_INDEPENDENCE,trainingPlan} from './deck-league-contract.mjs';
const root=path.resolve(process.argv[2]),c=json(path.join(root,'config.json')),base=json(c.sourceConfig.path);
assert.ok(!fs.existsSync(path.join(root,'execution.json')),'Execution already committed.');
const ref=p=>({path:path.resolve(p),sha256:sha(p)}),ledger=json(path.join(base.directory,'seed-ledger.json'));
const forbidden=[...new Set([...(base.protectedSeeds||[]),...Object.keys(ledger).map(Number)])];
const evaluationConfig={...base,directory:root,seed:c.seed,protectedSeeds:forbidden};
const protocol={contract:MATCH_INDEPENDENCE,configHash:digest(evaluationConfig),afterIterations:Object.fromEntries(base.profiles.map(p=>[p.id,0])),
  unit:'fresh-seed-blocks-and-frozen-models',stateOverlap:'diagnostic-only',evaluationDataTraining:false,
  existingProtectedInputsPreserved:true,correctionCriteriaUnchanged:true,criteria:base.evaluation};
immutable(path.join(root,'input-protocol.json'),protocol);
const corrections=c.profiles.flatMap(p=>Array.from({length:4},(_,i)=>{
  const opponent=c.opponents.find(o=>o.profileId===[p.id,'sett','kaisa','master-yi-no-aurora'][i]);
  return {id:`${p.id}-${i}`,profileId:p.id,role:'training',seed:seedFor(evaluationConfig,p.id,'correction',i),
    chooser:i%2?'p2':'p1',deckIds:i%2?[opponent.deckId,p.deck.id]:[p.deck.id,opponent.deckId],opponent};
}));
const seeds=corrections.map(j=>j.seed);
for(const p of c.profiles){
  for(let i=1;i<=c.iterations;i++){const tp=trainingPlan(evaluationConfig,p,i,p.champion,c.opponents);
    for(let g=0;g<28;g++)seeds.push((tp.seed+g*130363)>>>0);}
  for(const phase of ['screen','confirmation'])seeds.push(...new Set(evaluationJobs(evaluationConfig,p,c.iterations,phase,c.opponents).map(j=>j.seed)));
}
assert.equal(new Set(seeds).size,seeds.length,'Study seed collision.');
reserveSeeds(root,'constrained-deck-study',seeds,forbidden);
const growth=json('data/ai/deck-league-growth-20261007/config.json');
const plan={at:new Date().toISOString(),configHash:digest(c),evaluationConfig,inputProtocol:ref(path.join(root,'input-protocol.json')),
  corrections,responseConfig:growth.responseConfig,seedLedger:ref(path.join(root,'seed-ledger.json')),
  training:{profiles:3,iterations:2,games:168,epochs:4,source:'fixed-own-deck-champion',anchorWeights:{immediateSource:1,fixedChampion:1}},
  correction:{games:12,role:'permanent-training',labels:'unchanged-public-information-teacher-only',fullActorHistory:true,maximumActions:2400,
    condition:'All samples discarded on collection failure; errors fail the study rather than reporting zero supply.'},
  validation:{originalAndFixedParentGuards:'unchanged-and-separate',heldOutInputsTrained:false,
    finalCandidateOnly:true,skipUnchangedFinalCandidate:true,screenGames:112,confirmationGamesIfScreenPasses:896,
    evaluationRuntime:base.runtimeDirectory,review:base.evaluationReview,criteria:base.evaluation,
    action:'Report results; never automatically publish/promote/replace live league checkpoints.'},
  restart:{completedRecords:'verify and reuse',interruptedEpoch:'same frozen games/source/seed; no new collection',
    finishedStudy:'never rerun'},liveLeagueUnchanged:true};
immutable(path.join(root,'followup-plan.json'),plan);
const files=['run-constrained-deck-study.mjs','replay-constrained-deck-study.mjs','collect-verified-deck-lessons.mjs',
  'viktor-candidate-learning.mjs','deck-league-contract.mjs','deck-league-evaluation.mjs','deck-league-io.mjs'].map(n=>ref(path.join('scripts',n)));
immutable(path.join(root,'execution.json'),{at:new Date().toISOString(),files,plan:ref(path.join(root,'followup-plan.json'))});
atomic(path.join(root,'environment-repair.json'),{at:new Date().toISOString(),reason:'New runtime lacked node_modules junction needed for tfjs-node DLL search; silent JS fallback interrupted before any batch/checkpoint result.',
  interruptedOnlyOwnProcess:18356,sourceGamesModified:false,liveLeagueModified:false,configChanged:false,modelCodeChanged:false,
  solution:'Same dependency junction as the frozen source runtime; assert native backend in every entry point.',retrySamePlan:true});
console.log(JSON.stringify({configHash:digest(c),plan:ref(path.join(root,'followup-plan.json')),reservedSeeds:seeds.length}));
