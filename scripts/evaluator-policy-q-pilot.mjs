// This small training-only experiment checks that gradients and ranking work.
// It never selects a formal schedule or grants evaluator/policy certification.
export const POLICY_Q_PILOT = Object.freeze({
  id: "policy-q-pipeline-120-v1",
  replicas: 1,
  epochs: 3,
  requirement: Object.freeze({
    minimumGames: 80,
    minimumReferenceGames: 80,
    minimumLeafValuePairs: 120,
    minimumLeafValueReferenceGames: 80,
    minimumStructuredV2LeafValuePairs: 120,
    minimumStructuredV2LeafValueReferenceGames: 80,
    minimumActionReferences: 0,
    minimumActionReferenceGames: 0,
    minimumStructuredV2ActionReferences: 0,
    minimumStructuredV2ActionReferenceGames: 0
  }),
  trainingRequirement: Object.freeze({
    minimumActionReferences: 0,
    minimumStructuredV2ActionReferences: 0,
    minimumLeafValuePairs: 50,
    minimumStructuredV2LeafValuePairs: 50
  })
});

export function policyQPilotStatus(candidates = []) {
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const summaries = candidates.map((candidate) => {
    const history = candidate.evaluatorTraining?.history || [];
    const trainingAccuracy = candidate.trainingLeafValueRanking?.accuracy;
    const validationAccuracy = candidate.leafValueRanking?.accuracy;
    return {
      architecture: candidate.architecture?.id,
      history,
      pipelineValid: history.length > 0 && history.every((epoch) =>
        epoch.samples > 0 && epoch.batches > 0
        && [epoch.loss, epoch.rankingLoss, epoch.outcomeLoss].every(finite)),
      trainingAccuracy: finite(trainingAccuracy) ? trainingAccuracy : null,
      validationAccuracy: finite(validationAccuracy) ? validationAccuracy : null,
      validationPairs: candidate.leafValueRanking?.decisions ?? null,
      rankingValid: finite(trainingAccuracy) && finite(validationAccuracy)
        && Number(candidate.leafValueRanking?.decisions) > 0,
      overfitWarning: finite(trainingAccuracy) && finite(validationAccuracy)
        && trainingAccuracy - validationAccuracy > 0.2
    };
  });
  const failed = summaries.length > 0 && summaries.every((item) =>
    item.history.length > 0 && !item.pipelineValid);
  return {
    version: 1,
    diagnosticOnly: true,
    officialSelectionEligible: false,
    confirmationEligible: false,
    finalAuditEligible: false,
    failed,
    status: failed ? "pipeline-invalid"
      : summaries.length > 0 && summaries.every((item) => item.pipelineValid && item.rankingValid)
        ? "pipeline-valid" : "insufficient-evidence",
    // Small, mutable training validation cannot establish playing strength.
    strengthConclusion: "requires-formal-shadow-and-protected-evaluation",
    candidates: summaries
  };
}

export function reusablePolicyQPilot(report, datasetKey, sourceModelHash) {
  return report?.checkpointId === POLICY_Q_PILOT.id
    && report?.bootstrapDatasetKey === datasetKey
    && report?.sourceModelHash === sourceModelHash
    && report?.diagnosticOnly === true
    && report?.status?.status === "pipeline-valid"
    && Boolean(report?.completedAt);
}
