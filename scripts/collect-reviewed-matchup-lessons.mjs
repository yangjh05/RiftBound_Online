import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';
import {digest,inputKey,unwrap} from './deck-league-contract.mjs';

const root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve('data/ai/conversation-integration-20261014');
const evidence=path.join(out,'certified-evidence'),manifest=json(path.join(evidence,'manifest.json'));
assert.equal(manifest.definitionMismatch.length,0);assert.ok(manifest.replays.every(r=>r.completed));
const runtime=manifest.replayRuntime,load=f=>import(pathToFileURL(path.join(runtime.directory,f)).href);
const ref=f=>({path:f,sha256:sha(f)});
verifyArtifact(runtime.manifest);for(const f of json(runtime.manifest.path))assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256);
const c=json(path.join(root,'config.json')),state=json(path.join(root,'state.json'));
const positions=v8.deserialize(fs.readFileSync(path.join(evidence,'candidate-positions.bin')));
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const Enc=await load('src/ai/neural/encoding.mjs'),A=await load('src/ai/actions.mjs');
const {lessonMemoryContext,resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
const {recommendLocalResourceDemonstration}=await load('scripts/local-policy-learning.mjs');
const {recommendSafeTacticalAction,recommendResponseAwareAction}=await load('scripts/response-aware-demonstration.mjs');
const {acceptedSupplyAdvice}=await load('scripts/tactical-lesson-supply.mjs');
const {approvedTeacherAdvice}=await load('scripts/viktor-candidate-learning.mjs');
const {assertLessonSample}=await load('scripts/tactical-lesson-learning.mjs');
const {responseProfileCatalog}=await load('scripts/response-policy-learning.mjs');
const initial=JSON.parse(zlib.gunzipSync(fs.readFileSync(manifest.sourceFiles.find(f=>f.path.endsWith('before-0.json.gz')).path)));
const sourceDecks=initial.players.map(p=>{
  const main=[...p.mainDeck,...p.hand,p.champion||p.availableChampions[0]].filter(Boolean);
  assert.equal(main.length,40);
  const record={legend:p.legend.name,main:main.map(c=>c.id).sort(),runes:p.runeDeck.map(c=>c.id).sort(),battlefields:p.availableBattlefields.map(c=>c.id).sort()};
  return {id:'conversation-deck-'+digest(record),playerName:p.name,legend:p.legend,main,runes:p.runeDeck,battlefields:p.availableBattlefields,record};
});
const responseContext={...json('data/ai/viktor-growth-replay-candidate-20261006/config.json').responseContext,
  profiles:responseProfileCatalog([...c.profiles.map(p=>p.deck),...sourceDecks])};
responseContext.catalogHash=digest(responseContext.profiles);atomic(path.join(out,'public-response-catalog.json'),responseContext);
const protection=await read(path.join(root,'input-protection-live.json.gz')),protectedInputs=new Set(protection.protected);
const models={},banks={},added={},seen={},modelRefs={},results=[];
for(const id of ['kaisa','viktor']){
  modelRefs[id]=state.profiles[id].learner;models[id]=deserialize(unwrap(await read(verifyArtifact(modelRefs[id]))));
  banks[id]=await read(verifyArtifact(c.profiles.find(p=>p.id===id).lessons));added[id]=[];seen[id]=new Set(banks[id].bank.training.map(inputKey));
}
try{
for(const [index,p]of positions.entries()){
  assert.equal(p.memoryContextCertified,true);assert.equal(p.completeReplay,true);
  const id=p.actor==='p1'?'kaisa':'viktor',model=models[id],targetProfile=c.profiles.find(x=>x.id===id),deck=sourceDecks[p.actor==='p1'?0:1];
  assert.equal(deck.legend.name,targetProfile.deck.legend.name);
  const set=Enc.encodeActionSet(p.game,p.actor,A.enumerateAiPolicyActions(p.game,p.actor));
  const memoryContext=lessonMemoryContext(p.actor,p.observationPrefix);
  const initialMemory=resolveLessonMemory(model,{playerId:p.actor,memoryContext,steps:[]});
  const stateEncoding=Enc.encodeState(p.game,p.actor);assert.deepEqual(Array.from(stateEncoding),p.publicState);
  const logits=inferStep(model,stateEncoding,set.encoded,set.legalCount,initialMemory).logits;
  assert.ok(logits.every(Number.isFinite));const selected=logits.indexOf(Math.max(...logits));
  const decision={action:set.actions[selected],legalActions:set.actions,legalCount:set.legalCount,stateEncoding,actionEncoding:set.encoded,initialMemory,selectedIndex:selected};
  let advice=p.game.phase==='mulligan'?acceptedSupplyAdvice(p.game,p.actor,decision,{responseContext}):recommendLocalResourceDemonstration(p.game,p.actor,decision);
  if(!advice&&['action','showdown'].includes(p.game.phase)){
    const fallback=recommendSafeTacticalAction(p.game,p.actor,set.actions,{selectedAction:decision.action});
    advice=fallback?.growthLesson?acceptedSupplyAdvice(p.game,p.actor,decision,{responseContext}):
      recommendResponseAwareAction(p.game,p.actor,decision,fallback,{responseContext});
  }
  const report={key:p.key,profileId:id,sourceBranch:p.branch,manualAction:p.action,baseline:decision.action,accepted:false};
  const approved=advice?.supplyProof?.thresholdsUnchanged===true||approvedTeacherAdvice(advice,A.actionKey(decision.action),A.actionKey);
  if(approved){
    const target=set.actions.findIndex(a=>A.actionKey(a)===A.actionKey(advice.action));assert.ok(target>=0&&target!==selected);
    const proof={kind:'reviewed-public-teacher-v1',thresholdsUnchanged:true,globalOptimalityClaim:false,
      baseline:decision.action,advice,completeLegalReplay:true,publicInputsOnly:true,manualChoiceIsNotLabel:true};
    const sample={gameId:manifest.familyId,playerId:p.actor,deckId:deck.id,lessonRole:'training',imitation:true,
      contract:'reviewed-matchup-policy-curriculum-v1',engineFingerprint:runtime.engineFingerprint,memoryContext,
      transfer:{targetProfileId:id,targetDeckId:targetProfile.deck.id,sourceDeck:deck.record,sourceLegend:deck.legend.name,targetLegend:targetProfile.deck.legend.name},
      lessonSource:{familyId:manifest.familyId,role:'training',origin:'reviewed-human-game-public-teacher',positionKey:p.key,
        allBranchesTrainingOnly:true,proof},
      steps:[{state:Array.from(stateEncoding),actions:Array.from(set.encoded.slice(0,set.legalCount*Enc.ACTION_DIM)),initialMemory:Array.from(initialMemory),
        selectedIndex:target,legalCount:set.legalCount,oldLogProbability:0,behaviorTemperature:1,advantage:advice.weight,return:0,value:0,
        beliefTarget:Array.from(new Float32Array(Enc.CARD_BINS)),selectedActionKey:A.actionKey(advice.action),legalActionKeys:set.actions.map(A.actionKey),
        imitation:true,winProbabilityLabel:false,...Object.fromEntries(['mulliganLesson','growthLesson','localResourceLesson','responsePolicyLesson'].filter(k=>advice[k]).map(k=>[k,true]))}]};
    assertLessonSample(sample,'training');const key=inputKey(sample);
    if(protectedInputs.has(key))report.rejection='protected-input';
    else if(seen[id].has(key))report.rejection='duplicate-input';
    else{seen[id].add(key);added[id].push(sample);Object.assign(report,{accepted:true,inputKey:key,target:advice.action,teacherKind:Object.keys(sample.steps[0]).filter(k=>k.endsWith('Lesson')&&sample.steps[0][k]),manualAgreement:A.actionKey(advice.action)===A.actionKey(p.action)});}
  }else report.rejection='unchanged-public-teacher-did-not-certify-correction';
  results.push(report);
  fs.appendFileSync(path.join(out,'position-review.jsonl'),JSON.stringify(report)+'\n');
  if(index%20===0)console.log(JSON.stringify({reviewed:index+1,total:positions.length,accepted:Object.fromEntries(Object.entries(added).map(([id,s])=>[id,s.length]))}));
}
const additions={};
for(const id of ['kaisa','viktor']){
  if(!added[id].length)continue;
  const original=banks[id],bank={...original.bank,training:[...original.bank.training,...added[id]],validation:original.bank.validation};
  bank.samplesHash=digest([bank.training,bank.validation]);
  const file=path.join(out,id+'-lessons.json.gz');await write(file,{...original,bank});
  const audit=path.join(out,id+'-lesson-audit.json');atomic(audit,{completed:true,modelWeightsChanged:false,acceptedTraining:added[id].length,
    originalTraining:original.bank.training.length,validationPreserved:true,model:modelRefs[id],runtime,sourceEvidence:ref(path.join(evidence,'manifest.json')),
    review:ref(path.join(out,'position-review.jsonl')),sourceDeck:sourceDecks[id==='kaisa'?0:1].record,allBranchesOneTrainingFamily:true,terminalLabels:false,
    sourceDeckIsTargetTrainingDeck:false,teacherThresholdsUnchanged:true});
  additions[id]={originalSha256:c.profiles.find(p=>p.id===id).lessons.sha256,augmented:ref(file),audit:ref(audit)};
}
atomic(path.join(out,'lesson-additions.json'),additions);
atomic(path.join(out,'curriculum.json'),{contract:'reviewed-matchup-policy-curriculum-v1',completed:true,liveTrainingActivated:false,
  positions:positions.length,accepted:Object.fromEntries(Object.entries(added).map(([id,s])=>[id,s.length])),
  evidence:ref(path.join(evidence,'manifest.json')),rawReviews:ref(path.join(evidence,'source-reviews.json.gz')),
  positionReviews:ref(path.join(out,'position-review.jsonl')),publicResponseCatalog:ref(path.join(out,'public-response-catalog.json')),
  runtime,modelRefs,reviewCorrections:manifest.reviewCorrections,provisionalClaimsSupplyPositionsOnly:true,terminalLabels:false,
  allBranchesOneTrainingFamily:true,allCasesAccountedFor:results.length===positions.length,sourceDecks:sourceDecks.map(d=>({id:d.id,record:d.record}))});
console.log(JSON.stringify({completed:true,accepted:Object.fromEntries(Object.entries(added).map(([id,s])=>[id,s.length]))}));
}finally{Object.values(models).forEach(dispose);}
