import assert from 'node:assert/strict';
import {cloneAiState} from '../src/ai/clone-state.mjs';
import {actionKey} from '../src/ai/actions.mjs';
import {inferStep} from '../src/ai/neural/model.mjs';
import {ACTION_DIM,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {lessonMemoryContext,resolveLessonMemory} from './lesson-memory-context.mjs';
import {localResourceDecision,recommendLocalResourceDemonstration} from './local-policy-learning.mjs';
import {approvedTeacherAdvice} from './viktor-candidate-learning.mjs';
import {assertLessonSample} from './tactical-lesson-learning.mjs';
import {digest,inputKey} from './deck-league-contract.mjs';
import {resourceDeploymentDecision,RESOURCE_DEPLOYMENT_TEACHER} from './resource-deployment-learning.mjs';

export const RESOURCE_COLLECTION_TEACHER='local-resource-with-deployment-v2';

// Harvest opportunities in ALREADY scheduled learner games. No game, action,
// RNG draw, teacher query, validation label or game outcome selects a snapshot.
// Teacher calls occur only after completion and cannot influence play.
export function createOnPolicyResourceCollector(config,overrides={}){
  assert.equal(config.contract,'on-policy-resource-collection-v1');assert.equal(config.role,'training');
  assert.ok(Number.isInteger(config.maximumReviews)&&config.maximumReviews>0&&config.maximumReviews<=24);
  assert.ok([0,1].includes(config.learnerSeat),'Resource collection must name the single learner seat');
  const deps={cloneAiState,actionKey,inferStep,lessonMemoryContext,resolveLessonMemory,localResourceDecision,
    recommendLocalResourceDemonstration,approvedTeacherAdvice,assertLessonSample,resourceDeploymentDecision,ACTION_DIM,CARD_BINS,...overrides};
  const candidates=new Map(),seen=new Set(),diagnostics={opportunities:0,uniqueOpportunities:0,reviews:0,proved:0,rejected:0,errors:0,
    deploymentOpportunities:0,deploymentReviews:0,deploymentProved:0};
  let finished=false;
  return {
    consider(game,actorId,decision,history){
      assert.equal(finished,false);if(!deps.localResourceDecision(game,actorId,decision.action)||decision.legalCount<2)return;
      diagnostics.opportunities++;
      const context=deps.lessonMemoryContext(actorId,history),step={state:Array.from(decision.stateEncoding),actions:Array.from(decision.actionEncoding).slice(0,decision.legalCount*deps.ACTION_DIM),legalCount:decision.legalCount};
      const key=digest([inputKey({steps:[step]}),context.states]);if(seen.has(key))return;seen.add(key);diagnostics.uniqueOpportunities++;
      const priority=digest([config.gameId,key]);
      const deployment=deps.resourceDeploymentDecision(game,actorId,decision.action);if(deployment)diagnostics.deploymentOpportunities++;
      const ordered=[...candidates.entries(),[priority,{deployment}]].sort(([a],[b])=>a.localeCompare(b));
      // Reserve at most one of the existing review slots for this previously
      // omitted decision type. No extra games or teacher calls are introduced.
      const reserved=ordered.find(([,v])=>v.deployment)?.[0];
      const retained=new Set([...(reserved?[reserved]:[]),...ordered.map(([k])=>k).filter(k=>k!==reserved)].slice(0,config.maximumReviews));
      if(!retained.has(priority))return;
      const chosen={game:deps.cloneAiState(game),actorId,context,step,deployment,decision:{action:structuredClone(decision.action),legalActions:structuredClone(decision.legalActions),legalCount:decision.legalCount,selectedIndex:decision.selectedIndex}};
      candidates.set(priority,chosen);for(const k of candidates.keys())if(!retained.has(k))candidates.delete(k);
    },
    finish(completed,model){
      assert.equal(finished,false);finished=true;const samples=[];
      if(completed)for(const item of [...candidates.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v)){
        diagnostics.reviews++;
        if(item.deployment)diagnostics.deploymentReviews++;
        try{
          const {game,actorId,context,step,decision}=item,advice=deps.recommendLocalResourceDemonstration(game,actorId,decision);
          if(!advice?.localResourceLesson||!deps.approvedTeacherAdvice(advice,deps.actionKey(decision.action),deps.actionKey)){diagnostics.rejected++;continue;}
          const target=decision.legalActions.findIndex(a=>deps.actionKey(a)===deps.actionKey(advice.action));assert.ok(target>=0);
          const sample={gameId:config.gameId,playerId:actorId,deckId:config.deckId,lessonRole:'training',imitation:true,
            engineFingerprint:config.engineFingerprint,memoryContext:context,
            lessonSource:{familyId:config.gameId,role:'training',origin:'completed-own-policy-resource-opportunity',target:'resource',proof:{thresholdsUnchanged:!advice.resourceDeploymentLesson,
              ...(advice.resourceDeploymentLesson?{teacherContract:RESOURCE_DEPLOYMENT_TEACHER}:{}),globalOptimalityClaim:false,comparison:advice.comparison,review:advice.review}},
            steps:[{...step,initialMemory:[],selectedIndex:target,selectedActionKey:deps.actionKey(advice.action),legalActionKeys:decision.legalActions.map(deps.actionKey),
              oldLogProbability:0,behaviorTemperature:1,advantage:advice.weight,return:0,value:0,beliefTarget:Array.from(new Float32Array(deps.CARD_BINS)),
              imitation:true,winProbabilityLabel:false,localResourceLesson:true}]};
          const memory=deps.resolveLessonMemory(model,sample),{logits}=deps.inferStep(model,step.state,step.actions,step.legalCount,memory);
          const parentChoice=logits.indexOf(Math.max(...logits));
          if(parentChoice===target||parentChoice!==decision.selectedIndex){diagnostics.rejected++;continue;}
          sample.steps[0].initialMemory=Array.from(memory);
          sample.correctionProof={parentChoice,verifiedTarget:target,completeActorPrefix:true,separateModelMemories:true,independentTeacher:true};
          deps.assertLessonSample(sample,'training');samples.push(sample);diagnostics.proved++;if(advice.resourceDeploymentLesson)diagnostics.deploymentProved++;
        }catch(error){diagnostics.errors++;}
      }
      candidates.clear();return {contract:config.contract,role:'training',sourceGameId:config.gameId,samples,diagnostics,completed,extraGames:0,policyActionsModified:false,
        teacherCriteriaUnchanged:false,teacherContract:RESOURCE_COLLECTION_TEACHER};
    }
  };
}
