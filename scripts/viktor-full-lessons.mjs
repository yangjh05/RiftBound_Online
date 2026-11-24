import assert from 'node:assert/strict';
import {approvedTeacherAdvice} from './viktor-candidate-learning.mjs';

export async function collectViktorFullLessons({load,config,job,model,specialist}){
  const {createSupplyGame,acceptedSupplyAdvice}=await load('scripts/tactical-lesson-supply.mjs');
  const {createNeuralSession,inferStep}=await load('src/ai/neural/model.mjs');
  const {ACTION_DIM,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
  const {activeActorId,enumerateAiPolicyActions,actionKey,applyAiAction}=await load('src/ai/actions.mjs');
  const {needsPaymentOptionDecision}=await load('src/ai/payment-options.mjs');
  const {resolvePlannedPayment}=await load('src/ai/payment-planner.mjs');
  const {recommendSafeTacticalAction,recommendResponseAwareAction,TACTICAL_TEACHING_REVISION}=await load('scripts/response-aware-demonstration.mjs');
  const {recommendLocalResourceDemonstration,localResourceDecision}=await load('scripts/local-policy-learning.mjs');
  const {lessonMemoryContext,resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
  const {assertLessonSample}=await load('scripts/tactical-lesson-learning.mjs');
  const decks=job.deckIds.map(id=>config.decks.find(d=>d.id===id)),game=createSupplyGame(decks,job.seed,job.chooser);
  const session=createNeuralSession(model),histories=new Map(),samples=[];
  const diagnostics={positions:0,teacherReviews:0,responseReviews:0,resourceReviews:0,teacherAccepted:0,specialistDisagreed:0,matched:0};
  let failure=null;
  try{
    for(let n=0;n<config.maxLessonActions&&game.phase!=='complete';n++){
      for(let tries=0;game.pendingPayment&&!needsPaymentOptionDecision(game);tries++)
        if(tries>=10||!resolvePlannedPayment(game)?.ok)throw Error('unresolved-payment');
      const actor=activeActorId(game),legal=enumerateAiPolicyActions(game,actor);
      if(!actor||!legal.length)throw Error('no-legal-action');
      const decision=session.decide(game,actor,legal,{greedy:true,temperature:.8}),prefix=histories.get(actor)||[];
      diagnostics.positions++;
      if(decks[actor==='p1'?0:1].id===config.deckId&&samples.length<config.maximumVerifiedPerGame&&diagnostics.teacherReviews<config.maximumTeacherReviews&&decision.legalCount>1){
        diagnostics.teacherReviews++;let advice=null;
        if(game.phase==='mulligan')advice=acceptedSupplyAdvice(game,actor,decision,{responseContext:config.responseContext});
        else{
          if(diagnostics.resourceReviews<24&&localResourceDecision(game,actor,decision.action)){
            diagnostics.resourceReviews++;advice=recommendLocalResourceDemonstration(game,actor,decision);
          }
          if(!advice){
            const fallback=recommendSafeTacticalAction(game,actor,decision.legalActions,{selectedAction:decision.action});
            if(fallback?.growthLesson)advice=acceptedSupplyAdvice(game,actor,decision,{responseContext:config.responseContext});
            else if(diagnostics.responseReviews<config.responseContext.maximumReviewsPerGame&&['action','showdown'].includes(game.phase)){
              diagnostics.responseReviews++;advice=recommendResponseAwareAction(game,actor,decision,fallback,{responseContext:config.responseContext});
            }
          }
        }
        const approved=advice?.supplyProof?.thresholdsUnchanged===true||approvedTeacherAdvice(advice,actionKey(decision.action),actionKey);
        if(approved&&actionKey(advice.action)!==actionKey(decision.action)){
          diagnostics.teacherAccepted++;
          const target=decision.legalActions.findIndex(a=>actionKey(a)===actionKey(advice.action));assert.ok(target>=0);
          const memoryContext=lessonMemoryContext(actor,prefix);
          const sample={gameId:job.id,playerId:actor,deckId:config.deckId,lessonRole:job.role,imitation:true,
            contract:config.contract,engineFingerprint:config.engineFingerprint,memoryContext,
            lessonSource:{familyId:job.id,role:job.role,actionCount:n,origin:'fresh-full-parent-play',proof:{
              revision:TACTICAL_TEACHING_REVISION,thresholdsUnchanged:true,globalOptimalityClaim:false,
              teacherScope:advice.responseReview?.searchScope||advice.supplyProof?.scope||advice.comparison,
              review:advice.responseReview||advice.supplyProof||advice.review}},
            steps:[{state:Array.from(decision.stateEncoding),actions:Array.from(decision.actionEncoding.slice(0,decision.legalCount*ACTION_DIM)),
              initialMemory:Array.from(decision.initialMemory),selectedIndex:target,legalCount:decision.legalCount,
              oldLogProbability:0,behaviorTemperature:1,advantage:advice.weight,return:0,value:0,
              beliefTarget:Array.from(new Float32Array(CARD_BINS)),selectedActionKey:actionKey(advice.action),legalActionKeys:decision.legalActions.map(actionKey),
              imitation:true,winProbabilityLabel:false,
              ...Object.fromEntries(['mulliganLesson','growthLesson','localResourceLesson','responsePolicyLesson'].filter(k=>advice[k]).map(k=>[k,true]))}]};
          const choices={};for(const [name,reference] of Object.entries({parent:model,specialist})){
            const memory=resolveLessonMemory(reference,sample),step=sample.steps[0];
            const {logits}=inferStep(reference,step.state,step.actions,step.legalCount,memory);
            assert.ok(logits.every(Number.isFinite));choices[name]=logits.indexOf(Math.max(...logits));
          }
          if(choices.specialist===target&&choices.parent!==target){
            assert.equal(choices.parent,decision.selectedIndex,'Parent recurrent history differs from collection.');
            sample.transferProof={parentChoice:choices.parent,specialistChoice:target,specialistSha256:config.specialist.sha256,
              completeActorPrefix:true,separateModelMemories:true,independentTeacher:true};
            assertLessonSample(sample,job.role);samples.push(sample);diagnostics.matched++;
          }else diagnostics.specialistDisagreed++;
        }
      }
      histories.set(actor,[...prefix,Array.from(decision.stateEncoding)]);
      if(!applyAiAction(game,decision.action,actor)?.ok)throw Error(`illegal-transition:${n}`);
      if(game.decisionSafety?.violations?.length)throw Error('decision-safety-violation');
    }
    if(game.phase!=='complete'||!['p1','p2'].includes(game.winnerId))failure='incomplete-at-fixed-action-budget';
  }catch(error){failure=error.message;}
  return {job,teachingRevision:TACTICAL_TEACHING_REVISION,diagnostics,failure,samples:failure?[]:samples,
    summary:{completed:!failure,winnerId:failure?null:game.winnerId,actions:diagnostics.positions,deckIds:job.deckIds},
    policyOnly:true,terminalLabels:false};
}
