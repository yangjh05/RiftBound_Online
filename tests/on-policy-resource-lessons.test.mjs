import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
const load=file=>import(pathToFileURL(path.join(runtime,file)));
test('resource opportunities never change play and invoke the unchanged teacher only after completion',{skip:!runtime},async()=>{
 const {createOnPolicyResourceCollector}=await load('scripts/on-policy-resource-lessons.mjs');
 for(const completed of [true,false]){
  let reviews=0;const game={phase:'action',marker:1},decision={action:{kind:'costly'},legalActions:[{kind:'costly'},{kind:'saving'}],selectedIndex:0,legalCount:2,stateEncoding:[1],actionEncoding:[1,2]};
  const collector=createOnPolicyResourceCollector({contract:'on-policy-resource-collection-v1',role:'training',maximumReviews:1,learnerSeat:0,gameId:'own',deckId:'own',engineFingerprint:'engine'},
   {cloneAiState:structuredClone,actionKey:a=>a.kind,ACTION_DIM:1,CARD_BINS:1,localResourceDecision:()=>true,
    lessonMemoryContext:(playerId,states)=>({playerId,states:structuredClone(states),fromReset:true}),resolveLessonMemory:()=>[0],inferStep:()=>({logits:[1,0]}),
    recommendLocalResourceDemonstration:snapshot=>{reviews++;snapshot.marker=99;return{action:{kind:'saving'},weight:.5,localResourceLesson:true,review:{applied:true}};},
    approvedTeacherAdvice:()=>true,assertLessonSample:(s,role)=>assert.equal(s.lessonRole,role)});
  const before=structuredClone({game,decision});collector.consider(game,'p1',decision,[[0]]);collector.consider(game,'p1',decision,[[0]]);
  assert.equal(reviews,0);assert.deepEqual({game,decision},before);
  const result=collector.finish(completed,{});assert.equal(reviews,completed?1:0);assert.deepEqual({game,decision},before);
  assert.equal(result.extraGames,0);assert.equal(result.policyActionsModified,false);assert.equal(result.samples.length,completed?1:0);
  assert.equal(result.diagnostics.uniqueOpportunities,1);
  if(completed){assert.equal(result.samples[0].steps[0].winProbabilityLabel,false);assert.deepEqual(result.samples[0].memoryContext.states,[[0]]);}
  assert.throws(()=>collector.finish(completed,{}));
 }
});
test('resource capture cannot bypass incomplete or terminal teacher proofs',{skip:!runtime},async()=>{
 const {createOnPolicyResourceCollector}=await load('scripts/on-policy-resource-lessons.mjs');
 for(const terminal of [false,true]){
  const collector=createOnPolicyResourceCollector({contract:'on-policy-resource-collection-v1',role:'training',maximumReviews:1,learnerSeat:0,gameId:'own',deckId:'own'},
   {cloneAiState:structuredClone,actionKey:a=>a.kind,ACTION_DIM:1,localResourceDecision:()=>true,
    lessonMemoryContext:(playerId,states)=>({playerId,states}),recommendLocalResourceDemonstration:()=>({action:{kind:'saving'},weight:.5,localResourceLesson:true,comparison:'same-result-less-spending',review:{applied:true,partialSearch:!terminal,comparisons:[{score:terminal?1000:1}]}})});
  collector.consider({},'p1',{action:{kind:'costly'},legalActions:[{kind:'costly'},{kind:'saving'}],selectedIndex:0,legalCount:2,stateEncoding:[1],actionEncoding:[1,2]},[]);
  const result=collector.finish(true,{});assert.equal(result.samples.length,0);assert.equal(result.diagnostics.rejected,1);
 }
});
test('worker resource collection is restricted to the committed learner and training engine',{skip:!runtime},async()=>{
 const {selfPlayTaskOptions}=await load('scripts/ai-selfplay-task-options.mjs');
 const base={engineFingerprint:'engine',league:[{}],decks:[{id:'own'},{id:'other'}]},assignment={contract:'frozen-learner-only-league-collection-v1',opponentIndex:0,learnerSeat:0};
 // Use the actual frozen contract rather than a permissive fixture alias.
 const {LEAGUE_COLLECTION}=await load('scripts/league-selfplay-contract.mjs');assignment.contract=LEAGUE_COLLECTION;
 const capture={contract:'on-policy-resource-collection-v1',role:'training',maximumReviews:2,learnerSeat:0,deckId:'own',gameId:'own',engineFingerprint:'engine'};
 const run=c=>selfPlayTaskOptions(base,{optionOverrides:{leagueGameAssignment:assignment,trainingResourceCollection:c}});
 assert.deepEqual(run(capture).trainingResourceCollection,capture);
 for(const c of [{...capture,role:'validation'},{...capture,engineFingerprint:'other'},{...capture,learnerSeat:1},{...capture,maximumReviews:25}])assert.throws(()=>run(c));
});
test('real precommitted league tasks bind resource capture after seat scheduling, not canonical deck order',{skip:!runtime},async()=>{
 const {json}=await import('../scripts/deck-league-io.mjs');
 const {selfPlayTaskOptions}=await load('scripts/ai-selfplay-task-options.mjs'),{leagueGameAssignment}=await load('scripts/league-selfplay-contract.mjs');
 const {deckSearchTaskOptions}=await load('scripts/adaptive-deck-search.mjs');
 const plan=json(path.resolve('data/ai/deck-league-20261007/profiles/annie/iterations/000120/plan.json'));
 const base={engineFingerprint:plan.trainingRuntime.engineFingerprint,league:plan.opponents.map(()=>({})),decks:json(path.resolve('data/ai/deck-league-20261007/config.json')).profiles.map(p=>p.deck)};
 for(let g=0;g<28;g++){
  const deck=deckSearchTaskOptions(plan.deckSearch,g),assignment=leagueGameAssignment(plan,g),capture={contract:'on-policy-resource-collection-v1',role:'training',maximumReviews:2,
   learnerSeat:assignment.learnerSeat,deckId:deck.deckSearchAssignment.fixedLearnerDeckId,engineFingerprint:base.engineFingerprint,gameId:`annie:120:${g}`};
  const options=selfPlayTaskOptions(base,{optionOverrides:{...deck,leagueGameAssignment:assignment,trainingResourceCollection:capture}});
  assert.deepEqual(options.trainingResourceCollection,capture);
 }
});
