import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePolicyLossEvent as summarize} from '../server/training-dashboard-loss.mjs';
test('last rejected epoch does not erase the earlier accepted update or conflate loss components',()=>{
 const first=summarize({iteration:3,epoch:1,accepted:true,metrics:{meanLoss:.5,meanBaseLoss:.2,meanPolicyRehearsalContribution:.3}});
 const rejected={iteration:3,epoch:2,accepted:false,metrics:{meanLoss:.6,meanBaseLoss:.21,meanPolicyRehearsalContribution:.39}};
 const last=summarize(rejected,first),again=summarize(rejected,last);
 assert.equal(last.accepted,false);assert.equal(last.acceptedEpochs,1);assert.equal(last.rejectedEpochs,1);
 assert.equal(last.lastAccepted.loss,.5);assert.equal(last.baseLoss,.21);assert.equal(last.rehearsalLoss,.39);assert.deepEqual(again,last);
});
test('historical joint losses are reconstructed only when all fixed-contract components are present',()=>{
 const event={iteration:201,epoch:1,accepted:false,guard:{lessonRetention:{report:{contract:'prospective-joint-ppo-verified-lessons-v1'}}},metrics:{meanLoss:.5,
 meanPolicyLoss:0,meanValueLoss:.2,meanActionValueLoss:.4,meanDiagnosticLoss:0,meanAnchorKl:0,meanEntropy:0,meanTeacherLoss:0,meanTeacherRankingLoss:0,meanTeacherActionValueLoss:0,meanBeliefLoss:0}};
 const a=summarize(event);assert.equal(a.baseLoss,.2);assert.equal(a.rehearsalLoss,.3);assert.equal(a.origin,'reconstructed-joint-v1');
 delete event.metrics.meanValueLoss;const b=summarize(event);assert.equal(b.baseLoss,null);assert.equal(b.rehearsalLoss,null);assert.equal(b.loss,.5);
});
test('old totals do not invent acceptance or a rehearsal component',()=>{
 const a=summarize({iteration:200,epoch:1,metrics:{meanLoss:.15}});assert.equal(a.accepted,null);assert.equal(a.baseLoss,.15);assert.equal(a.rehearsalLoss,0);
 assert.equal(a.acceptedEpochs,0);assert.equal(summarize({metrics:{meanLoss:NaN}},a),a);
});
