import test from 'node:test';import assert from 'node:assert/strict';
import {assertLessonAugmentation,inputKey} from '../scripts/deck-league-contract.mjs';
const sample=(i,role='training')=>({deckId:'own',lessonRole:role,lessonSource:{role,proof:{kind:'growth',thresholdsUnchanged:true}},
 memoryContext:{contract:'complete-actor-observation-prefix-v1',fromReset:true,states:[[1]]},
 steps:[{state:[i],actions:[1,2],legalCount:2,growthLesson:true,winProbabilityLabel:false}]});
test('adding growth replay preserves every original training and validation case and rejects protected or unproven labels',()=>{
 const original={bank:{training:[sample(1)],validation:[sample(2,'validation')]}},extra=sample(3);
 const augmented={bank:{training:[...original.bank.training,extra],validation:original.bank.validation}};
 assert.equal(assertLessonAugmentation(original,augmented,'own',new Set([inputKey(sample(2))])),1);
 assert.throws(()=>assertLessonAugmentation(original,augmented,'own',new Set([inputKey(extra)])),/Protected/);
 for(const mutate of [
  a=>a.bank.training.shift(),a=>a.bank.validation.pop(),a=>a.bank.training[1].lessonRole='validation',
  a=>a.bank.training[1].lessonSource.proof.thresholdsUnchanged=false,a=>a.bank.training[1].deckId='other',
  a=>a.bank.training[1]=structuredClone(a.bank.training[0])
 ]){const changed=structuredClone(augmented);mutate(changed);assert.throws(()=>assertLessonAugmentation(original,changed,'own',new Set()));}
});
