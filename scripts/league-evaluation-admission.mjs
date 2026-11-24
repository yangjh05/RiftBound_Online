import assert from 'node:assert/strict';
import {digest} from './deck-league-contract.mjs';
export function assertDispatchOnlyLaneTransition(previous,next,previousHash){
  assert.equal(digest(previous),previousHash,'Previous evaluation lane identity changed');
  const {dispatchPolicy:oldPolicy,...oldCore}=previous,{dispatchPolicy:newPolicy,...newCore}=next;
  assert.deepEqual(newCore,oldCore,'A dispatch-only transition changed evaluation evidence or budgets');
  assert.ok(newPolicy,'Missing committed dispatch policy');
  return digest(next);
}
// Admission is fixed before seeing the candidate's evaluation outcome. Existing
// requests are never removed and learning does not wait for evaluation capacity.
export function evaluationAdmission({iteration,everyIterations,pending,profileId,changed,maximumPending=7}){
  assert.ok(Number.isInteger(iteration)&&iteration>0&&Number.isInteger(everyIterations)&&everyIterations>0);
  assert.ok(Number.isInteger(maximumPending)&&maximumPending>0&&Array.isArray(pending));
  if(iteration%everyIterations)return {admit:false,reason:'fixed-iteration-cadence'};
  if(!changed)return {admit:false,reason:'unchanged-champion-policy'};
  if(pending.some(p=>p.profileId===profileId))return {admit:false,reason:'profile-evaluation-pending'};
  if(pending.length>=maximumPending)return {admit:false,reason:'evaluation-capacity'};
  return {admit:true,reason:'fixed-cadence-and-capacity'};
}
