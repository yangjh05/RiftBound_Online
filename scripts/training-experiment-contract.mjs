export const AB_EXPERIMENT_MANIFEST_VERSION = 3;
export const TEACHER_CONSUMPTION_POLICIES = Object.freeze({
  A: "record-only-v1",
  B: "strict-v8",
  C: "strict-v8"
});

export function teacherConsumptionPolicyForRun(runContract) {
  const normalized = String(runContract || "C").toUpperCase();
  const policy = TEACHER_CONSUMPTION_POLICIES[normalized];
  if (!policy) throw new Error(`Unknown training run contract: ${runContract}`);
  return policy;
}

export function collectionContractForRun(runContract) {
  return ["A", "B"].includes(String(runContract || "").toUpperCase()) ? "AB" : "C";
}

export function diagnosticArtifactRole(runContract) {
  return ["A", "B"].includes(String(runContract || "").toUpperCase())
    ? "diagnostic-only"
    : "official-candidate";
}

export function teacherDoseStatusForRun(runContract, mass = {}) {
  const normalized = String(runContract || "C").toUpperCase();
  const total = Number(mass.totalPolicyConnectedMass) || 0;
  if (normalized === "B") {
    return total <= 0 ? "inconclusive-zero-dose" : "teacher-dose-observed";
  }
  if (normalized !== "C") return "not-applicable";
  if (total <= 0) return "ppo-only-zero-teacher-dose";
  if ((Number(mass.certifiedEvaluatorPolicyMass) || 0) > 0) {
    return "certified-evaluator-dose-observed";
  }
  if ((Number(mass.terminalConfirmedPolicyMass) || 0) > 0) {
    return "terminal-confirmed-dose-observed";
  }
  if ((Number(mass.proofPolicyMass) || 0) > 0) {
    return "engine-proof-dose-observed";
  }
  return "verified-teacher-dose-observed";
}

export function createAbExperimentClaim(options = {}) {
  const experimentId = normalizeExperimentId(options.experimentId);
  return {
    version: AB_EXPERIMENT_MANIFEST_VERSION,
    experimentId,
    engineFingerprint: options.engineFingerprint || null,
    learningTargetVersion: Number(options.learningTargetVersion) || 0,
    sourceModelHash: options.sourceModelHash || null,
    sourceChampionHash: options.sourceChampionHash || null,
    sourceOptimizerHash: options.sourceOptimizerHash || null,
    sourceConfigurationHash: options.sourceConfigurationHash || null,
    sourceSeed: Number(options.sourceSeed) >>> 0,
    generationSeed: Number(options.generationSeed) >>> 0,
    curriculumIteration: Math.max(1, Number(options.curriculumIteration) || 1),
    games: Math.max(1, Number(options.games) || 1),
    trainingDeckIds: [...(options.trainingDeckIds || [])],
    collectionContract: "AB",
    teacherConsumptionPolicies: {
      A: TEACHER_CONSUMPTION_POLICIES.A,
      B: TEACHER_CONSUMPTION_POLICIES.B
    },
    collectionKey: options.collectionKey || null,
    createdAt: options.createdAt || new Date().toISOString()
  };
}

export function compareAbExperimentManifest(manifest, claim) {
  const fields = [
    "version",
    "experimentId",
    "engineFingerprint",
    "learningTargetVersion",
    "sourceModelHash",
    "sourceChampionHash",
    "sourceOptimizerHash",
    "sourceConfigurationHash",
    "sourceSeed",
    "generationSeed",
    "curriculumIteration",
    "games",
    "collectionContract"
  ];
  const mismatches = fields.filter((field) => manifest?.[field] !== claim?.[field]);
  if (JSON.stringify(manifest?.trainingDeckIds || []) !== JSON.stringify(claim?.trainingDeckIds || [])) {
    mismatches.push("trainingDeckIds");
  }
  return {
    compatible: mismatches.length === 0,
    mismatches
  };
}

export function compareAbTrainingContract(manifest, claim) {
  const fields = [
    "trainingControlHash",
    "inputDataHash",
    "ppoBatchOrderFingerprint"
  ];
  const mismatches = fields.filter((field) =>
    manifest?.[field] != null
    && claim?.[field] != null
    && manifest[field] !== claim[field]);
  return {
    compatible: mismatches.length === 0,
    mismatches
  };
}

export function protectedFinalAuditGamesForRun(runContract, requestedGames, enabled = true) {
  if (String(runContract || "C").toUpperCase() !== "C" || !enabled) return 0;
  return Math.max(104, Math.ceil((Number(requestedGames) || 104) / 8) * 8);
}

export function officialCandidateCheckpointEligible(checkpoint) {
  const metadata = checkpoint?.metadata || {};
  return metadata.runContract === "C"
    && metadata.artifactRole !== "diagnostic-only"
    && metadata.engineValidationStatus !== "diagnostic-only";
}

export function normalizeExperimentId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(normalized)) {
    throw new Error(
      "Run A/B requires --experiment-id with 3-64 letters, digits, underscores, or hyphens."
    );
  }
  return normalized;
}
