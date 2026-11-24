import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootstrapLeafActionEffectPopulationRisk } from "../src/ai/neural/trainer.mjs";
import { POLICY_Q_SHADOW_READINESS_GRID as grid, expandPolicyQShadowReadinessRequirement,
  policyQShadowReadinessGridHash, POLICY_Q_SHADOW_READINESS_CONTRACT }
  from "../scripts/evaluator-policy-q-readiness.mjs";
import { policyQPrecisionTarget, policyQPrecisionDemandItem, precisionRetryCollectionGames,
  precisionTargetFromMeasuredRisk } from "../scripts/evaluator-policy-q-precision.mjs";
import { policyQShadowEvidencePreflight } from "../scripts/evaluator-policy-q-evidence.mjs";
import { serializeEvaluatorBootstrapStageRequest } from "../scripts/evaluator-bootstrap-stage-handoff.mjs";
import { createNeuralModel } from "../src/ai/neural/model.mjs";

const natural = grid.performanceRequirements.phaseActionEffect.natural;
function zeroLoss(n) {
  return bootstrapLeafActionEffectPopulationRisk(Array.from({length:n}, (_,i) => ({
    gameId:`game-${i}`, conservativeRegretUpperBounds:[0], conservativeRegretWeights:[1]
  })), {populationRiskBootstrapSamples:500});
}
function inventory(n = 200) {
  return Object.fromEntries(["overall","mulligan","early","mid","late"].map(phase => [phase,
    Object.fromEntries(["natural","targeted"].map(distribution => [distribution, {
      comparisons:n, contributingGames:n, riskAssessedComparisons:n,
      riskAssessedContributingGames:n, decisiveComparisons:n,
      decisiveContributingGames:n, effectiveGames:n, decisiveEffectiveGames:n
    }]))]));
}

test("natural planning reference agrees with production unobserved-tail correction", () => {
  const target = policyQPrecisionTarget(natural, "natural");
  assert.equal(target.independentGames,85);
  assert.equal(policyQPrecisionTarget(grid.performanceRequirements.regretAlternative,"natural").independentGames,119);
  assert.ok(zeroLoss(8).worstTenPercentCvar.upperBound > natural.maximumWorstTenPercentCvar);
  assert.ok(zeroLoss(target.independentGames-1).worstTenPercentCvar.upperBound > natural.maximumWorstTenPercentCvar);
  assert.ok(zeroLoss(target.independentGames).worstTenPercentCvar.upperBound <= natural.maximumWorstTenPercentCvar);
});

test("decisive target uses the actual two-sided game confidence radius", () => {
  const requirement=grid.performanceRequirements.phaseActionEffect.targeted;
  const n=policyQPrecisionTarget(requirement,"targeted").independentGames;
  assert.equal(n,47);
  const margin=requirement.minimumDecisiveAccuracy-requirement.minimumDecisiveAccuracyLowerBound;
  assert.ok(Math.sqrt(Math.log(40)/(2*n)) < margin);
  assert.ok(Math.sqrt(Math.log(40)/(2*(n-1))) >= margin);
});

test("old 4-game minimum cannot launch model search; adequate support does not certify performance", () => {
  assert.equal(policyQShadowEvidencePreflight(inventory(8)).sufficient,false);
  const result=policyQShadowEvidencePreflight(inventory());
  assert.equal(result.sufficient,true);
  assert.equal(result.sufficientForPerformance,false);
  assert.equal(result.performanceAssessed,false);
  assert.equal(result.passed,undefined);
});

test("many comparisons or low-effective-weight games cannot hide a precision deficit", () => {
  const data=inventory();
  data.early.natural.comparisons=100000;
  data.early.natural.riskAssessedComparisons=100000;
  data.early.natural.effectiveGames=3;
  const result=policyQShadowEvidencePreflight(data);
  assert.equal(result.sufficient,false);
  assert.equal(result.diagnosticDemand.items.find(i=>i.deficientPhaseBand==='early').additionalValidationGames,82);
});

test("validation deficits are converted with measured yield, not summed as raw games", () => {
  const item=policyQPrecisionDemandItem({evidenceKind:'action-effect',auditDistribution:'natural-distribution',phaseBand:'early'},
    grid,{riskAssessedContributingGames:10,effectiveGames:10},100);
  assert.equal(item.additionalValidationGames,75);
  assert.equal(item.estimatedCollectionGames,3750);
  assert.equal(item.requiredAdditionalGamesUnit,'collection-games');
  assert.equal(precisionRetryCollectionGames([item,item]),256);
  const unknown=policyQPrecisionDemandItem({auditDistribution:'natural-distribution',phaseBand:'early'},grid,{},100);
  assert.equal(unknown.estimatedCollectionGames,null);
  assert.equal(unknown.requiredAdditionalGames,64);
});

test("requested weak deck/seat phases cannot disappear into aggregate evidence", () => {
  const demand={items:[{deckSeat:'origins-kaisa:p2',phaseBand:'early',auditDistribution:'natural-distribution'}]};
  const result=policyQShadowEvidencePreflight(inventory(),grid,{demand});
  const missing=result.diagnosticDemand.items.find(i=>i.deckSeat==='origins-kaisa:p2'&&i.auditDistribution==='natural-distribution');
  assert.equal(result.sufficient,false);
  assert.equal(missing.targetValidationGames,85);
  assert.equal(missing.additionalValidationGames,85);
});

test("met precision targets and weak strata persist through later data-only checkpoints", () => {
  const data=inventory();
  data['origins-kaisa:p2::early']=structuredClone(data.early);
  data.mid.natural.effectiveGames=3;
  const first=policyQShadowEvidencePreflight(data,grid,{demand:{items:[{
    deckSeat:'origins-kaisa:p2',phaseBand:'early',auditDistribution:'natural-distribution',targetValidationGames:180
  }]}});
  assert.ok(!first.diagnosticDemand.items.some(i=>i.deckSeat==='origins-kaisa:p2'));
  const next=expandPolicyQShadowReadinessRequirement({minimumGames:1},1,first,grid,{trainingAudit:{acceptedGames:200}});
  data['origins-kaisa:p2::early'].natural.riskAssessedContributingGames=100;
  const second=policyQShadowEvidencePreflight(data,grid,{demand:next.shadowActionEffectDemand});
  const gap=second.diagnosticDemand.items.find(i=>i.deckSeat==='origins-kaisa:p2');
  assert.equal(gap.targetValidationGames,180);
  assert.equal(gap.additionalValidationGames,80);
});

test("a measured confidence gap expands the target without claiming to repair bad performance", () => {
  const target=policyQPrecisionTarget(natural,'natural');
  const summary={populationRiskBootstrap:{contributingGames:100,
    meanRegret:{pointEstimate:0.1,upperBound:0.6}}};
  assert.ok(precisionTargetFromMeasuredRisk(summary,target,natural)>100);
  summary.populationRiskBootstrap.meanRegret={pointEstimate:0.9,upperBound:1};
  assert.equal(precisionTargetFromMeasuredRisk(summary,target,natural),85);
});

test("precision collection queues the full checkpoint using Training counts", () => {
  const item=policyQPrecisionDemandItem({evidenceKind:'action-effect',auditDistribution:'natural-distribution',phaseBand:'early'},
    grid,{riskAssessedContributingGames:10,effectiveGames:10},100);
  const requirement=expandPolicyQShadowReadinessRequirement({minimumGames:200,minimumLeafValuePairs:1500},1,
    {diagnosticDemand:{items:[item]}},grid,{trainingAudit:{acceptedGames:1584}});
  assert.equal(requirement.minimumGames,1840);
  assert.equal(requirement.minimumLeafValuePairs,1500);
  const request=serializeEvaluatorBootstrapStageRequest({
    stopWhenEvidenceCheckpoint:{role:'training',requirement},collection:{model:createNeuralModel()}});
  assert.equal(request.options.rollingWindowGames,256);
  assert.equal(request.options.extensionGames,64);
  assert.equal(request.options.stopWhenEvidenceCheckpoint.requirement.minimumGames,1840);
});

test("the actual Shadow stage releases datasets and exits before training on insufficient precision", async () => {
  const source=fs.readFileSync(new URL('../scripts/train-neural-ai.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function runPolicyQShadowReadinessStage(');
  const end=source.indexOf('\n}',start)+2;
  assert.ok(start>=0 && end>start);
  const checkpoints=[],released=[];
  const datasets={training:{},validation:{},anchorValidation:{},split:{
    trainingEvidence:{sufficient:true},validationEvidence:{sufficient:true}}};
  const dependencies={POLICY_Q_SHADOW_READINESS_GRID:grid,POLICY_Q_SHADOW_READINESS_CONTRACT,
    policyQShadowReadinessGridHash,path,readCheckpoint:async()=>null,
    materializeEvaluatorEarlyDiagnosticDatasets:async()=>datasets,
    writeCheckpoint:async(file,value)=>checkpoints.push({file,value}),
    iterateIndependentTrajectoryDataset:()=>[],collectPolicyQEvidenceInventory:async()=>inventory(8),
    policyQShadowEvidencePreflight,releaseTrajectoryDatasets:(...args)=>released.push(...args),
    trainEvaluatorDevelopmentStage:()=>{throw new Error('Model training must not run');}};
  const run=new Function(...Object.keys(dependencies),`return (${source.slice(start,end)});`)(...Object.values(dependencies));
  const result=await run({dataRoot:'unused',bootstrap:{datasetKey:'test'},progress:{write(){}},collectionRequirement:{}});
  assert.equal(result.evidenceOnly,true);
  assert.equal(result.diagnosticInvalid,false);
  assert.equal(result.performanceAssessed,false);
  assert.equal(result.evidencePreflight.modelTrainingStarted,false);
  assert.equal(released.length,3);
  assert.equal(checkpoints.at(-1).value.contract,'policy-q-shadow-evidence-preflight-v3');
});
