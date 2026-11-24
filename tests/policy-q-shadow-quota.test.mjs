import test from "node:test";
import assert from "node:assert/strict";
import { expandPolicyQShadowReadinessRequirement, POLICY_Q_SHADOW_READINESS_GRID }
  from "../scripts/evaluator-policy-q-readiness.mjs";
import { evaluatorBootstrapEvidenceCheckpointComplete }
  from "../scripts/evaluator-bootstrap.mjs";
import { serializeEvaluatorBootstrapStageRequest, hydrateEvaluatorBootstrapStageRequest }
  from "../scripts/evaluator-bootstrap-stage-handoff.mjs";
import { createNeuralModel } from "../src/ai/neural/model.mjs";

const base={minimumGames:200,minimumLeafValuePairs:1500};
const readiness={diagnosticDemand:{items:[{evidenceKind:"action-effect",requiredAdditionalGames:40}]}};
const expand=options=>expandPolicyQShadowReadinessRequirement(base,1,readiness,POLICY_Q_SHADOW_READINESS_GRID,options);

test("32-game Shadow retry uses Training, excluding 215 calibration games",()=>{
  const requirement=expand({trainingAudit:{acceptedGames:1354},currentAcceptedGames:1569});
  assert.equal(requirement.minimumGames,1386);
  assert.equal(requirement.shadowActionEffectDemand.collectionFloorGames,1354);
  assert.equal(requirement.shadowActionEffectDemand.role,"training");
  assert.equal(requirement.minimumLeafValuePairs,1500);
  const checkpoint={role:"training",requirement};
  const audit={acceptedGames:1600,certificationPartitions:{training:{acceptedGames:1385,leafValuePairCount:1500}}};
  assert.equal(evaluatorBootstrapEvidenceCheckpointComplete(audit,checkpoint),false);
  audit.certificationPartitions.training.acceptedGames++;
  assert.equal(evaluatorBootstrapEvidenceCheckpointComplete(audit,checkpoint),true);
  audit.certificationPartitions.training.leafValuePairCount=1499;
  assert.equal(evaluatorBootstrapEvidenceCheckpointComplete(audit,checkpoint),false);
});

test("missing or invalid Training counts fail instead of silently using the aggregate",()=>{
  for(const options of [{},{currentAcceptedGames:1569},{trainingAudit:{acceptedGames:-1}},
    {trainingAudit:{acceptedGames:NaN}},{trainingAudit:{acceptedGames:1.5}}]){
    assert.throws(()=>expand(options),/training partition game count/);
  }
});

test("Shadow wave size survives the real stage handoff while protected roles keep their limits",()=>{
  const model=createNeuralModel();
  const requirement=expand({trainingAudit:{acceptedGames:1354}});
  const options={extensionGames:160,rollingWindowGames:160,
    stopWhenEvidenceCheckpoint:{role:"training",requirement},collection:{model}};
  const restored=hydrateEvaluatorBootstrapStageRequest(serializeEvaluatorBootstrapStageRequest(options));
  assert.equal(restored.rollingWindowGames,32);
  assert.equal(restored.extensionGames,32);
  assert.equal(restored.stopWhenEvidenceCheckpoint.requirement.minimumGames,1386);
  assert.equal(options.rollingWindowGames,160);
  const protectedOptions={...options,stopWhenEvidenceCheckpoint:{role:"development",requirement}};
  const protectedRequest=serializeEvaluatorBootstrapStageRequest(protectedOptions);
  assert.equal(protectedRequest.options.rollingWindowGames,160);
  assert.equal(protectedRequest.options.extensionGames,160);
});
