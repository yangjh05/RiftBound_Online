import {assertFixedChampionReferences,FIXED_CHAMPION_REFERENCE} from '../scripts/fixed-champion-reference.mjs';
import {correctionCoverage,useSecondCollectionStage} from '../scripts/lesson-coverage-budget.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {targetedReviewKind} from '../scripts/targeted-lesson-budget.mjs';
import {inputKey} from '../scripts/deck-league-contract.mjs';
import {approvedTeacherAdvice} from '../scripts/viktor-candidate-learning.mjs';
import {collectTargetedDeckLessons} from '../scripts/collect-targeted-deck-lessons.mjs';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
const load=f=>import(pathToFileURL(path.join(runtime,f)));
test('targeted budgets ignore irrelevant openings and never admit another category',()=>{
  const game={phase:'mulligan',currentPlayerId:'p1',players:[{id:'p1',hand:[]}]},d={legalCount:2};
  assert.equal(targetedReviewKind('response',game,'p1',d,0,48),null);
  game.phase='action';assert.equal(targetedReviewKind('growth',game,'p1',d,0,32),null);
  assert.equal(targetedReviewKind('response',game,'p1',d,0,48),'response');
  game.players[0].hand.push({effects:[{timing:'spell',kind:'channelRunesOrDraw'}]});
  assert.equal(targetedReviewKind('growth',game,'p1',d,0,32),'growth');
  assert.equal(targetedReviewKind('growth',game,'p1',d,32,32),null);
  game.pendingChoice={};assert.equal(targetedReviewKind('response',game,'p1',d,0,48),null);
});
test('targeted selection is not a correctness label: unchanged teacher still rejects unsupported advice',()=>{
  const key=a=>a.kind;
  assert.equal(approvedTeacherAdvice({action:{kind:'play'},weight:1,responsePolicyLesson:true},'pass',key),false);
  assert.equal(approvedTeacherAdvice({action:{kind:'play'},weight:1,growthLesson:true,review:{applied:true,gain:999}},'pass',key),false);
});
test('collector spends its dedicated budget after mulligan and reports teacher errors as failures',async()=>{
  for(const broken of [false,true]){
    const game={phase:'mulligan',players:[{id:'p1',hand:[]}],currentPlayerId:'p1'},actions=[{kind:'endTurn'},{kind:'play'}];let reviews=0;
    const config={deckId:'annie',decks:[{id:'annie'},{id:'sett'}],maxLessonActions:4,maximumVerifiedPerGame:12,maximumTeacherReviews:1,responseContext:{maximumReviewsPerGame:1}};
    const modules={
      'scripts/tactical-lesson-supply.mjs':{createSupplyGame:()=>game,acceptedSupplyAdvice:()=>{throw Error('wrong-teacher');}},
      'src/ai/neural/model.mjs':{createNeuralSession:()=>({decide:()=>({action:actions[0],legalActions:actions,selectedIndex:0,legalCount:2,stateEncoding:[0],actionEncoding:[0,1],initialMemory:[]})})},
      'src/ai/neural/encoding.mjs':{ACTION_DIM:1,CARD_BINS:1},
      'src/ai/actions.mjs':{activeActorId:()=> 'p1',enumerateAiPolicyActions:()=>actions,actionKey:a=>a.kind,
        applyAiAction:()=>{if(game.phase==='mulligan')game.phase='action';else{game.phase='complete';game.winnerId='p1';}return {ok:true};}},
      'src/ai/payment-options.mjs':{needsPaymentOptionDecision:()=>false},'src/ai/payment-planner.mjs':{},
      'scripts/response-aware-demonstration.mjs':{recommendSafeTacticalAction:()=>null,TACTICAL_TEACHING_REVISION:'fixture',
        recommendResponseAwareAction:()=>{reviews++;if(broken)throw Error('teacher-broken');return {action:actions[1],responsePolicyLesson:true,weight:1};}},
      'scripts/lesson-memory-context.mjs':{},'scripts/tactical-lesson-learning.mjs':{}
    };
    const result=await collectTargetedDeckLessons({load:async f=>{assert.ok(modules[f],f);return modules[f];},config,
      job:{id:'fixture',target:'response',role:'training',seed:1,chooser:'p1',deckIds:['annie','sett']},model:{},opponent:{}});
    assert.equal(reviews,1);assert.equal(result.diagnostics.teacherReviews,1);assert.deepEqual(result.samples,[]);
    assert.equal(result.failure,broken?'teacher-broken':null);assert.equal(result.summary.completed,!broken);
  }
});
test('individual and category regressions cannot hide behind improved aggregate loss',{skip:!runtime},async()=>{
  const {trainingRetentionGuard}=await load('scripts/individual-transactional-policy.mjs');
  const empty={decisions:0,policyLoss:0},before={correct:[true,true],types:{mulligan:empty,growth:empty,resource:{decisions:1,policyLoss:2},response:{decisions:1,policyLoss:1}}};
  const after=structuredClone(before);after.types.resource.policyLoss=1;after.correct[1]=false;
  assert.equal(trainingRetentionGuard(before,after).passed,false);
  after.correct[1]=true;after.types.response.policyLoss=1.005;
  assert.equal(trainingRetentionGuard(before,after).passed,false);
  after.types.response.policyLoss=.99;assert.equal(trainingRetentionGuard(before,after).passed,true);
});
test('individual-margin Adam commits exact moments and resumes identically',{skip:!runtime},async()=>{
  const {tf,tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
  const {createNeuralModel,serializeNeuralModel:serialize,deserializeNeuralModel:deserialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
  const {packPpoBatch,serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
  const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
  const {individualTransactionalPolicyUpdater:transactionalPolicyUpdater}=await load('scripts/individual-transactional-policy.mjs');
  const {CONSTRAINED_DEFAULTS}=await load('scripts/constrained-policy-learning.mjs');
  const {lessonInputKey}=await load('scripts/tactical-lesson-learning.mjs');
  const source=createNeuralModel(),champion=deserialize(serialize(source)),model=deserialize(serialize(source));
  let optimizer=tf.train.adam(.0001),resumed=null,resumedOptimizer=null;
  try{
    const state=Float32Array.from({length:STATE_DIM},(_,i)=>Math.sin(i)*.03),actions=new Float32Array(2*ACTION_DIM);actions[6]=1;actions[ACTION_DIM+20]=1;
    const target=inferStep(source,state,actions,2,new Float32Array(NEURAL_HIDDEN_SIZE)).logits.indexOf(Math.max(...inferStep(source,state,actions,2,new Float32Array(NEURAL_HIDDEN_SIZE)).logits));
    const make=(selected,advantage)=>({state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),legalCount:2,selectedIndex:selected,
      oldLogProbability:-Math.log(2),behaviorTemperature:1,advantage,return:0,value:0,beliefTarget:new Float32Array(CARD_BINS),imitation:false,winProbabilityLabel:true});
    const trajectory={playerId:'p1',gameId:'fixture',steps:[make(target,1),make(1-target,-1)]},batch=packPpoBatch([trajectory],{ignoreCorrectionSignals:true});
    const sample={lessonRole:'training',imitation:true,playerId:'p1',steps:[{...make(target,1),imitation:true,winProbabilityLabel:false,responsePolicyLesson:true,
      legalActionKeys:['a','b'],selectedActionKey:['a','b'][target]}]};
    const rehearsal=()=>({contract:'verified-training-policy-rehearsal-v1',coefficient:.25,batch:packPpoBatch([sample])});
    const args={trajectories:[trajectory],source,champion,trainingGroups:[{id:'original',samples:[sample]}],protectedKeys:new Set(),rehearsalForBatch:rehearsal};
    assert.throws(()=>transactionalPolicyUpdater({...args,protectedKeys:new Set([lessonInputKey(sample)])}),/Protected/);
    assert.throws(()=>transactionalPolicyUpdater({...args,protectedKeys:new Set([inputKey(sample)])}),/Protected/);
    assert.throws(()=>transactionalPolicyUpdater({...args,trainingGroups:[{id:'bad',samples:[{...sample,lessonRole:'validation'}]}]}),/boundary/);
    const options={teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,beliefCoefficient:0,anchorCoefficient:.05};
    const call=async(update,m,o,epoch)=>update({model:m,batch,chunks:[trajectory],optimizer:o,options,epoch,batchIndex:0});
    const before=await serializeOptimizer(optimizer,model.generation),reports=[];
    optimizer=(await call(transactionalPolicyUpdater({...args,onBatch:r=>reports.push(r)}),model,optimizer,1)).optimizer;
    assert.equal(reports[0].accepted,true);assert.equal(reports[0].optimizerCommitted,true);
    const accepted=await serializeOptimizer(optimizer,model.generation);
    assert.notDeepEqual(accepted,before);assert.equal(accepted.weights[0].values[0],before.weights[0].values[0]+1);
    const weights=serialize(model).weights;
    optimizer=(await call(transactionalPolicyUpdater({...args,config:{...CONSTRAINED_DEFAULTS,fractions:[]}}),model,optimizer,2)).optimizer;
    assert.deepEqual(serialize(model).weights,weights);assert.deepEqual(await serializeOptimizer(optimizer,model.generation),accepted);
    resumed=deserialize(serialize(model));resumedOptimizer=await restoreAdamOptimizer(accepted,.0001);
    optimizer=(await call(transactionalPolicyUpdater(args),model,optimizer,3)).optimizer;
    resumedOptimizer=(await call(transactionalPolicyUpdater(args),resumed,resumedOptimizer,3)).optimizer;
    assert.deepEqual(serialize(model).weights,serialize(resumed).weights);
    const a=await serializeOptimizer(optimizer,model.generation),b=await serializeOptimizer(resumedOptimizer,resumed.generation);
    assert.deepEqual(a.weights.map(x=>[x.shape,x.values]),b.weights.map(x=>[x.shape,x.values]));
  }finally{optimizer.dispose();resumedOptimizer?.dispose();[source,champion,model,resumed].filter(Boolean).forEach(dispose);}
});

test('a weakened learner cannot replace the frozen official champion or opponent panel',()=>{
  const profiles=[{id:'a'},{id:'b'}],refs=profiles.map((p,i)=>({profileId:p.id,sha256:'fixed'+i,behaviorHash:'weights'+i,deckHash:'deck'+i}));
  const c={profiles,referencePolicy:{contract:FIXED_CHAMPION_REFERENCE,learnerBaselineAllowed:false,sameEngineAndReview:true,references:refs}};
  assert.equal(assertFixedChampionReferences(c,profiles[0],refs[0],refs),true);
  assert.throws(()=>assertFixedChampionReferences(c,profiles[0],{...refs[0],sha256:'weak-learner'},refs),/baseline/);
  assert.throws(()=>assertFixedChampionReferences(c,profiles[0],refs[0],[refs[0],{...refs[1],sha256:'weaker-opponent'}]),/Opponent/);
  assert.throws(()=>assertFixedChampionReferences(c,profiles[0],refs[0],[refs[0],refs[0]]));
});
test('one fragile training choice cannot be paid for by improving another',{skip:!runtime},async()=>{
  const {choiceMargin,individualMarginGuard}=await load('scripts/individual-training-margin.mjs');
  assert.deepEqual(choiceMargin([.01,0],0),{correct:true,margin:.01});
  const before=[{key:'a',correct:true,margin:.01},{key:'b',correct:true,margin:.2}];
  assert.equal(individualMarginGuard(before,[{key:'a',correct:true,margin:.005},{key:'b',correct:true,margin:2}]).passed,false);
  assert.equal(individualMarginGuard(before,[{key:'a',correct:true,margin:.02},{key:'b',correct:true,margin:.1}]).passed,true);
  assert.equal(individualMarginGuard(before,[{key:'a',correct:false,margin:-.001},{key:'b',correct:true,margin:2}]).passed,false);
});
test('new supply triggers retain distinct review types and ignore irrelevant phases',()=>{
  const g={phase:'mulligan'},d={legalCount:2};
  assert.equal(targetedReviewKind('mulligan',g,'p1',d,0,2),'mulligan');
  assert.equal(targetedReviewKind('resource',g,'p1',d,0,2),null);
  g.phase='action';assert.equal(targetedReviewKind('mulligan',g,'p1',d,0,2),null);
  assert.equal(targetedReviewKind('resource',g,'p1',d,0,2),'resource');
});
test('collection extension depends on proved unique case coverage, never wins',()=>{
  const budget={initialGamesPerDeck:4,minimumCasesPerType:4,minimumGamesPerType:2};
  const records=Array.from({length:4},(_,i)=>({profileId:'a',target:i%2?'response':'resource',path:String(i),accepted:2,collectionStage:0,wins:0}));
  assert.equal(useSecondCollectionStage(records,'a',['response','resource'],budget),false);
  records[1].accepted=0;records[1].wins=100;
  assert.equal(useSecondCollectionStage(records,'a',['response','resource'],budget),true);
  assert.throws(()=>useSecondCollectionStage(records.slice(1),'a',['response'],budget),/partial/);
  assert.equal(correctionCoverage(records,'a',['response'],budget).byType[0].cases,2);
});
