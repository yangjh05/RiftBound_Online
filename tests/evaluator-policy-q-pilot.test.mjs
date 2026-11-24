import test from "node:test";
import assert from "node:assert/strict";
import { POLICY_Q_PILOT, policyQPilotStatus, reusablePolicyQPilot } from "../scripts/evaluator-policy-q-pilot.mjs";
import { EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS } from "../scripts/evaluator-bootstrap.mjs";

const candidate = (loss = 0.6) => ({
  architecture: { id: "structured-set-v2-128" },
  evaluatorTraining: { history: [{ samples: 90, batches: 3, loss, rankingLoss: 0.6, outcomeLoss: 0.2 }] },
  trainingLeafValueRanking: { accuracy: 0.8 },
  leafValueRanking: { accuracy: 0.55, decisions: 24 }
});

test("Policy-Q pilot accepts finite leaf-only training without requiring an unrelated action head", () => {
  const status = policyQPilotStatus([candidate()]);
  assert.equal(status.status, "pipeline-valid");
  assert.equal(status.failed, false);
  assert.equal(status.candidates[0].overfitWarning, true);
  assert.equal(status.officialSelectionEligible, false);
  assert.equal(status.confirmationEligible, false);
  assert.equal(status.finalAuditEligible, false);
  assert.equal(POLICY_Q_PILOT.requirement.minimumLeafValuePairs, 120);
  assert.equal(EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training.minimumLeafValuePairs, 1500);
});

test("pilot distinguishes missing evidence from a measured non-finite training failure", () => {
  assert.equal(policyQPilotStatus([]).status, "insufficient-evidence");
  assert.equal(policyQPilotStatus([{ evaluatorTraining: { history: [] } }]).failed, false);
  assert.equal(policyQPilotStatus([candidate(NaN)]).failed, true);
  assert.equal(policyQPilotStatus([candidate(NaN), candidate()]).failed, false);
  assert.equal(policyQPilotStatus([{ ...candidate(), leafValueRanking: {} }]).status, "insufficient-evidence");
});

test("pilot reuse is bound to its data, model, successful execution and diagnostic contract", () => {
  const report = { checkpointId: POLICY_Q_PILOT.id, bootstrapDatasetKey: "data", sourceModelHash: "model",
    diagnosticOnly: true, completedAt: "today", status: { status: "pipeline-valid" } };
  assert.equal(reusablePolicyQPilot(report, "data", "model"), true);
  for (const patch of [{ diagnosticOnly: false }, { completedAt: null }, { status: { status: "insufficient-evidence" } },
    { bootstrapDatasetKey: "other" }, { sourceModelHash: "other" }, { checkpointId: "official" }]) {
    assert.equal(reusablePolicyQPilot({ ...report, ...patch }, "data", "model"), false);
  }
});
