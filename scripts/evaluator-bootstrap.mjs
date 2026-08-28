import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import {
  ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
  ACTION_RANKING_AUDIT_REFERENCE_VERSION,
  ACTION_RANKING_REFERENCE_CONTRACT,
  ACTION_RANKING_REFERENCE_VERSION,
  LEAF_VALUE_REFERENCE_CONTRACT,
  LEAF_VALUE_REFERENCE_VERSION,
  validActionRankingAuditReference,
  validActionRankingReference,
  validIndependentLeafValueReference,
  validLeafValueReference
} from "../src/ai/neural/action-ranking-reference.mjs";
import { collectProcessPoolSelfPlay } from "./ai-selfplay-process-pool.mjs";
import {
  detachedActionAuditFineRoleChunkGames,
  runDetachedActionAuditCoordinator
} from "./detached-action-audit-coordinator.mjs";
import {
  adoptSelfPlayResultHandoff
} from "./ai-selfplay-result-handoff.mjs";
import {
  createEvaluatorBootstrapResultIndex,
  validEvaluatorBootstrapResultIndex
} from "./evaluator-bootstrap-index.mjs";
import {
  commitEvaluatorBootstrapSummary,
  evaluatorBootstrapSummaryMatchesArchive
} from "./evaluator-bootstrap-transaction.mjs";
import { renameWithRetry } from "./file-replace.mjs";
import {
  EVALUATOR_AUDIT_CORE_ACTION_CLASSES,
  EVALUATOR_AUDIT_PHASE_BANDS,
  EVALUATOR_AUDIT_STRATUM_VERSION,
  normalizeEvaluatorAuditStratum,
  reclassifyTrajectoryAuditStrata
} from "../src/ai/neural/audit-strata.mjs";
import {
  STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
  STRUCTURED_EVIDENCE_SCHEMA_VERSION,
  validPublicStructuredEvidenceSnapshot
} from "../src/ai/neural/structured-evidence.mjs";
import {
  ACTION_EVIDENCE_GRADES,
  actionEvidenceRequirement,
  summarizeActionEvidenceEfficiency,
  validActionEvidenceProtocolManifest
} from "../src/ai/neural/evidence-protocol.mjs";

export const EVALUATOR_CERTIFICATION_PARTITIONS = Object.freeze([
  "development",
  "confirmation",
  "final-audit"
]);
export const EVALUATOR_TRAINING_PARTITION = "training";
export const EVALUATOR_EVIDENCE_PARTITIONS = Object.freeze([
  EVALUATOR_TRAINING_PARTITION,
  ...EVALUATOR_CERTIFICATION_PARTITIONS
]);

function evaluatorEvidencePartitionsForAudit(audit, options = {}) {
  const available = Object.hasOwn(
    audit?.certificationPartitions || {},
    EVALUATOR_TRAINING_PARTITION
  )
    ? EVALUATOR_EVIDENCE_PARTITIONS
    : EVALUATOR_CERTIFICATION_PARTITIONS;
  const active = Array.isArray(options.activeEvidenceRoles)
    ? new Set(options.activeEvidenceRoles.map(String))
    : null;
  return active
    ? available.filter((role) => active.has(role))
    : available;
}
export const EVALUATOR_BOOTSTRAP_SAMPLING_CONTRACT =
  "purpose-separated-calibration-leaf-action-racing-v4";
export const EVALUATOR_BOOTSTRAP_SAMPLING_MODES = Object.freeze({
  calibration: "calibration-only",
  leaf: "leaf-audit",
  action: "action-ranking-audit"
});
export const EVALUATOR_BOOTSTRAP_DECK_SEAT_SCHEDULE =
  "deck-seat-schedule-v2";
export const EVALUATOR_BOOTSTRAP_LEAF_ROLE_SCHEDULE =
  "leaf-certification-role-schedule-v1";
export const EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS = Object.freeze({
  actionReferencesPerPhase: 5,
  actionReferenceGamesPerPhase: 5,
  leafValuePairsPerPhase: 12,
  leafValueReferenceGamesPerPhase: 4
});
export const EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES =
  EVALUATOR_AUDIT_CORE_ACTION_CLASSES;
export const EVALUATOR_BOOTSTRAP_ACTION_BULK_WINDOW_GAMES = 48;
export const EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS = Object.freeze({
  actionReferencesPerCoreClass: 5,
  actionReferenceGamesPerCoreClass: 5,
  actionReferencesPerDeckPhase: 1,
  actionReferenceGamesPerDeckPhase: 1,
  leafValuePairsPerDeckPhase: 1,
  leafValueReferenceGamesPerDeckPhase: 1,
  requiredDeckPhases: ["mulligan", "early", "mid", "late"]
});
export const EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS = Object.freeze({
  training: Object.freeze({
    minimumGames: 300,
    minimumActionReferences: 450,
    minimumActionReferenceGames: 300,
    minimumLeafValuePairs: 1500,
    minimumLeafValueReferenceGames: 200,
    minimumStructuredV2ActionReferences: 450,
    minimumStructuredV2ActionReferenceGames: 300,
    minimumStructuredV2LeafValuePairs: 1500,
    minimumStructuredV2LeafValueReferenceGames: 200,
    minimumActionReferencesPerDeckSeat: 25,
    minimumLeafValuePairsPerDeckSeat: 20,
    minimumActionReferencesByPhase: Object.freeze({
      mulligan: 80,
      early: 80,
      mid: 150,
      late: 100
    }),
    minimumActionReferenceGamesByPhase: Object.freeze({
      mulligan: 50,
      early: 50,
      mid: 100,
      late: 70
    }),
    minimumLeafValuePairsByPhase: Object.freeze({
      mulligan: 20,
      early: 50,
      mid: 100,
      late: 50
    }),
    minimumLeafValueReferenceGamesByPhase: Object.freeze({
      mulligan: 10,
      early: 20,
      mid: 30,
      late: 20
    }),
    minimumActionReferencesPerCoreClass: 40,
    minimumActionReferenceGamesPerCoreClass: 30,
    minimumActionReferencesPerDeckPhase: 10,
    minimumActionReferenceGamesPerDeckPhase: 8,
    minimumLeafValuePairsPerDeckPhase: 20,
    minimumLeafValueReferenceGamesPerDeckPhase: 8
  }),
  development: Object.freeze({
    minimumGames: 150,
    minimumActionReferences: 220,
    minimumActionReferenceGames: 150,
    minimumLeafValuePairs: 400,
    minimumLeafValueReferenceGames: 100,
    minimumStructuredV2ActionReferences: 220,
    minimumStructuredV2ActionReferenceGames: 150,
    minimumStructuredV2LeafValuePairs: 400,
    minimumStructuredV2LeafValueReferenceGames: 100,
    minimumActionReferencesPerDeckSeat: 10,
    minimumLeafValuePairsPerDeckSeat: 8,
    minimumActionReferencesByPhase: Object.freeze({
      mulligan: 50,
      early: 50,
      mid: 60,
      late: 50
    }),
    minimumActionReferenceGamesByPhase: Object.freeze({
      mulligan: 30,
      early: 30,
      mid: 40,
      late: 30
    }),
    minimumLeafValuePairsByPhase: Object.freeze({
      mulligan: 20,
      early: 20,
      mid: 30,
      late: 20
    }),
    minimumLeafValueReferenceGamesByPhase: Object.freeze({
      mulligan: 5,
      early: 5,
      mid: 8,
      late: 5
    }),
    minimumActionReferencesPerCoreClass: 25,
    minimumActionReferenceGamesPerCoreClass: 18,
    minimumActionReferencesPerDeckPhase: 5,
    minimumActionReferenceGamesPerDeckPhase: 4,
    minimumLeafValuePairsPerDeckPhase: 8,
    minimumLeafValueReferenceGamesPerDeckPhase: 4
  }),
  confirmation: Object.freeze({
    minimumGames: 170,
    minimumActionReferences: 250,
    minimumActionReferenceGames: 170,
    minimumLeafValuePairs: 400,
    minimumLeafValueReferenceGames: 100,
    minimumStructuredV2ActionReferences: 250,
    minimumStructuredV2ActionReferenceGames: 170,
    minimumStructuredV2LeafValuePairs: 400,
    minimumStructuredV2LeafValueReferenceGames: 100,
    minimumActionReferencesPerDeckSeat: 12,
    minimumLeafValuePairsPerDeckSeat: 8,
    minimumActionReferencesByPhase: Object.freeze({
      mulligan: 50,
      early: 50,
      mid: 70,
      late: 50
    }),
    minimumActionReferenceGamesByPhase: Object.freeze({
      mulligan: 30,
      early: 30,
      mid: 45,
      late: 30
    }),
    minimumLeafValuePairsByPhase: Object.freeze({
      mulligan: 20,
      early: 20,
      mid: 30,
      late: 20
    }),
    minimumLeafValueReferenceGamesByPhase: Object.freeze({
      mulligan: 5,
      early: 5,
      mid: 8,
      late: 5
    }),
    minimumActionReferencesPerCoreClass: 30,
    minimumActionReferenceGamesPerCoreClass: 20,
    minimumActionReferencesPerDeckPhase: 5,
    minimumActionReferenceGamesPerDeckPhase: 4,
    minimumLeafValuePairsPerDeckPhase: 8,
    minimumLeafValueReferenceGamesPerDeckPhase: 4
  }),
  "final-audit": Object.freeze({
    minimumGames: 180,
    minimumActionReferences: 280,
    minimumActionReferenceGames: 180,
    minimumLeafValuePairs: 500,
    minimumLeafValueReferenceGames: 120,
    minimumStructuredV2ActionReferences: 280,
    minimumStructuredV2ActionReferenceGames: 180,
    minimumStructuredV2LeafValuePairs: 500,
    minimumStructuredV2LeafValueReferenceGames: 120,
    minimumActionReferencesPerDeckSeat: 15,
    minimumLeafValuePairsPerDeckSeat: 10,
    minimumActionReferencesByPhase: Object.freeze({
      mulligan: 50,
      early: 50,
      mid: 80,
      late: 50
    }),
    minimumActionReferenceGamesByPhase: Object.freeze({
      mulligan: 35,
      early: 35,
      mid: 50,
      late: 35
    }),
    minimumLeafValuePairsByPhase: Object.freeze({
      mulligan: 25,
      early: 25,
      mid: 40,
      late: 25
    }),
    minimumLeafValueReferenceGamesByPhase: Object.freeze({
      mulligan: 8,
      early: 8,
      mid: 10,
      late: 8
    }),
    minimumActionReferencesPerCoreClass: 30,
    minimumActionReferenceGamesPerCoreClass: 22,
    minimumActionReferencesPerDeckPhase: 6,
    minimumActionReferenceGamesPerDeckPhase: 5,
    minimumLeafValuePairsPerDeckPhase: 10,
    minimumLeafValueReferenceGamesPerDeckPhase: 5
  })
});

export const EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS = Object.freeze(
  Object.fromEntries(Object.entries(
    EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS
  ).map(([role, requirement]) => {
    const structuredLeafTargets = {
      training: { pairs: 400, games: 80 },
      development: { pairs: 150, games: 30 },
      confirmation: { pairs: 150, games: 30 },
      "final-audit": { pairs: 200, games: 40 }
    }[role];
    // Policy-Q's protected partitions must contain enough independent games
    // for the formal action-effect audit, not merely enough leaf pairs.  The
    // formal gate still enforces the stricter targeted/natural contributing-
    // game and confidence-width contracts; these floors prevent opening an
    // expensive protected partition with only a few dozen candidate audits.
    const protectedGameTargets = {
      training: requirement.minimumLeafValueReferenceGames,
      development: 200,
      confirmation: 220,
      "final-audit": 300
    };
    return [role, Object.freeze({
    ...requirement,
    minimumGames: protectedGameTargets[role],
    minimumActionReferences: 0,
    minimumActionReferenceGames: 0,
    minimumStructuredV2ActionReferences: 0,
    minimumStructuredV2ActionReferenceGames: 0,
    minimumActionReferencesPerDeckSeat: 0,
    minimumActionReferencesByPhase: Object.freeze({}),
    minimumActionReferenceGamesByPhase: Object.freeze({}),
    minimumActionReferencesPerCoreClass: 0,
    minimumActionReferenceGamesPerCoreClass: 0,
    minimumActionReferencesPerDeckPhase: 0,
    minimumActionReferenceGamesPerDeckPhase: 0,
    minimumStructuredV2LeafValuePairs: role === "training"
      ? 1500
      : structuredLeafTargets.pairs,
    minimumStructuredV2LeafValueReferenceGames: role === "training"
      ? 200
      : structuredLeafTargets.games,
    minimumLeafValuePairsByPhase: role === "training"
      ? Object.freeze({
        mulligan: 250,
        early: 250,
        mid: 250,
        late: 250
      })
      : requirement.minimumLeafValuePairsByPhase,
    minimumLeafValueReferenceGamesByPhase: role === "training"
      ? Object.freeze({
        mulligan: 80,
        early: 80,
        mid: 80,
        late: 80
      })
      : requirement.minimumLeafValueReferenceGamesByPhase,
    terminalRobustMinimum: 0,
    continuationConsistentMinimum: 0,
    independentOpeningStateMinimum: 0,
    naturalDistributionAuditMinimum: 0,
    decisiveCoverageMinimum: 0,
    minimumDeckSeatCoverage: 0,
    nearEquivalentMinimum: 0
    })];
  }))
);

export function evaluatorBootstrapEvidenceRequirement(role, options = {}) {
  const configured = options.completionPartitionRequirements?.[role]
    || options.evidencePartitionRequirements?.[role];
  const base = configured || {
    minimumGames: Math.max(
      20,
      Number(options.minimumCertificationPartitionGames) || 20
    ),
    minimumActionReferences: Math.max(
      50,
      Number(options.minimumCertificationPartitionActionReferences)
        || Number(options.minimumActionReferences)
        || 50
    ),
    minimumActionReferenceGames: Math.max(
      20,
      Number(options.minimumCertificationPartitionActionReferenceGames)
        || Number(options.minimumActionReferenceGames)
        || 20
    ),
    minimumLeafValuePairs: Math.max(
      50,
      Number(options.minimumCertificationPartitionLeafValuePairs)
        || Number(options.minimumLeafValuePairs)
        || 50
    ),
    minimumLeafValueReferenceGames: Math.max(
      20,
      Number(options.minimumCertificationPartitionLeafValueReferenceGames)
        || Number(options.minimumLeafValueReferenceGames)
        || 20
    ),
    minimumStructuredV2ActionReferences: Math.max(
      50,
      Number(options.minimumStructuredV2ActionReferences) || 50
    ),
    minimumStructuredV2ActionReferenceGames: Math.max(
      20,
      Number(options.minimumStructuredV2ActionReferenceGames) || 20
    ),
    minimumStructuredV2LeafValuePairs: Math.max(
      50,
      Number(options.minimumStructuredV2LeafValuePairs) || 50
    ),
    minimumStructuredV2LeafValueReferenceGames: Math.max(
      20,
      Number(options.minimumStructuredV2LeafValueReferenceGames) || 20
    ),
    minimumActionReferencesPerDeckSeat: Math.max(
      1,
      Number(options.minimumActionReferencesPerDeckSeat) || 1
    ),
    minimumLeafValuePairsPerDeckSeat: Math.max(
      1,
      Number(options.minimumLeafValuePairsPerDeckSeat) || 1
    ),
    minimumActionReferencesByPhase: null,
    minimumActionReferenceGamesByPhase: null,
    minimumLeafValuePairsByPhase: null,
    minimumLeafValueReferenceGamesByPhase: null,
    minimumActionReferencesPerCoreClass:
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferencesPerCoreClass,
    minimumActionReferenceGamesPerCoreClass:
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferenceGamesPerCoreClass,
    minimumActionReferencesPerDeckPhase:
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferencesPerDeckPhase,
    minimumActionReferenceGamesPerDeckPhase:
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferenceGamesPerDeckPhase,
    minimumLeafValuePairsPerDeckPhase:
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .leafValuePairsPerDeckPhase,
    minimumLeafValueReferenceGamesPerDeckPhase:
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .leafValueReferenceGamesPerDeckPhase
  };
  const protocolRequirement = options.ignoreActionEvidenceProtocolRequirements
    !== true && validActionEvidenceProtocolManifest(
    options.evidenceProtocolManifest
  )
    ? actionEvidenceRequirement(role, options.evidenceProtocolManifest)
    : null;
  return protocolRequirement
    ? { ...base, ...protocolRequirement }
    : base;
}

export function evaluatorBootstrapRuntimeAuditOptions(options = {}, base = {}) {
  const checkpointRole = String(
    options.stopWhenEvidenceCheckpoint?.role || ""
  );
  const checkpointRequirement =
    options.stopWhenEvidenceCheckpoint?.requirement;
  const evidencePartitionRequirements = {
    ...(base.evidencePartitionRequirements || {}),
    ...(options.evidencePartitionRequirements || {})
  };
  let completionPartitionRequirements =
    options.completionPartitionRequirements
      ? { ...options.completionPartitionRequirements }
      : null;
  if (checkpointRole && checkpointRequirement) {
    // A stop checkpoint is also the live collection contract.  Previously it
    // was consulted only by the return gate, while sampling mode and role-plan
    // demand continued to use the smaller base certification requirement.  If
    // that base requirement was already complete, the pool received zero
    // tasks and the collector eventually reported three false stalled rounds.
    const target = completionPartitionRequirements
      || evidencePartitionRequirements;
    target[checkpointRole] = maximumEvaluatorEvidenceRequirement(
      target[checkpointRole],
      checkpointRequirement
    );
  }
  return {
    ...base,
    completionPartitionRequirements,
    evidencePartitionRequirements,
    ignoreActionEvidenceProtocolRequirements:
      options.ignoreActionEvidenceProtocolRequirements === true,
    collectionScope: options.collectionScope || null
  };
}

function maximumEvaluatorEvidenceRequirement(base = {}, requested = {}) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(requested || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = result[key] && typeof result[key] === "object"
        && !Array.isArray(result[key])
        ? result[key]
        : {};
      result[key] = maximumEvaluatorEvidenceRequirement(existing, value);
      continue;
    }
    if (Number.isFinite(Number(value))) {
      result[key] = Math.max(Number(result[key]) || 0, Number(value));
      continue;
    }
    if (!(key in result)) result[key] = value;
  }
  return result;
}

export function evaluatorBootstrapEvidenceRolesComplete(
  audit,
  roles = []
) {
  const requiredRoles = [...new Set((roles || []).map(String))];
  return requiredRoles.length > 0
    && requiredRoles.every((role) =>
      audit?.certificationPartitions?.[role]?.complete === true);
}

export function evaluatorBootstrapEvidenceCheckpointComplete(
  audit,
  checkpoint = null
) {
  const role = String(checkpoint?.role || "");
  const requirement = checkpoint?.requirement;
  const partition = audit?.certificationPartitions?.[role];
  if (!role || !requirement || !partition) return false;
  const scalarRequirements = [
    ["acceptedGames", "minimumGames"],
    ["actionReferenceCount", "minimumActionReferences"],
    ["actionReferenceGameCount", "minimumActionReferenceGames"],
    ["leafValuePairCount", "minimumLeafValuePairs"],
    ["leafValueReferenceGameCount", "minimumLeafValueReferenceGames"],
    ["structuredV2ActionReferenceCount", "minimumStructuredV2ActionReferences"],
    ["structuredV2ActionReferenceGameCount", "minimumStructuredV2ActionReferenceGames"],
    ["structuredV2LeafValuePairCount", "minimumStructuredV2LeafValuePairs"],
    ["structuredV2LeafValueReferenceGameCount", "minimumStructuredV2LeafValueReferenceGames"]
  ];
  if (scalarRequirements.some(([actualKey, requiredKey]) =>
    Number(partition[actualKey] || 0)
      < Number(requirement[requiredKey] || 0))) return false;
  const mappedRequirements = [
    ["actionReferencePhaseCoverage", "minimumActionReferencesByPhase"],
    ["actionReferencePhaseGameCount", "minimumActionReferenceGamesByPhase"],
    ["leafValuePhaseCoverage", "minimumLeafValuePairsByPhase"],
    ["leafValuePhaseReferenceGameCount", "minimumLeafValueReferenceGamesByPhase"],
    ["structuredV2ActionReferencePhaseCoverage", "minimumActionReferencesByPhase"],
    ["structuredV2ActionReferencePhaseGameCount", "minimumActionReferenceGamesByPhase"],
    ["structuredV2LeafValuePhaseCoverage", "minimumLeafValuePairsByPhase"],
    ["structuredV2LeafValuePhaseReferenceGameCount", "minimumLeafValueReferenceGamesByPhase"]
  ];
  for (const [actualKey, requiredKey] of mappedRequirements) {
    for (const [key, minimum] of Object.entries(
      requirement[requiredKey] || {}
    )) {
      if (Number(partition[actualKey]?.[key] || 0) < Number(minimum || 0)) {
        return false;
      }
    }
  }
  const minimumCoreClass = Math.max(
    0,
    Number(requirement.minimumActionReferencesPerCoreClass) || 0
  );
  if (minimumCoreClass > 0 && EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.some(
    (actionClass) =>
      Number(partition.actionReferenceActionClassCoverage?.[actionClass] || 0)
        < minimumCoreClass
      || Number(
        partition.structuredV2ActionReferenceActionClassCoverage?.[actionClass]
          || 0
      ) < minimumCoreClass
  )) return false;
  const minimumCoreClassGames = Math.max(
    0,
    Number(requirement.minimumActionReferenceGamesPerCoreClass) || 0
  );
  if (minimumCoreClassGames > 0
    && EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.some((actionClass) =>
      Number(partition.actionReferenceActionClassGameCount?.[actionClass] || 0)
        < minimumCoreClassGames
      || Number(
        partition.structuredV2ActionReferenceActionClassGameCount?.[
          actionClass
        ] || 0
      ) < minimumCoreClassGames)) return false;
  const minimumActionDeckSeat = Math.max(
    0,
    Number(requirement.minimumActionReferencesPerDeckSeat) || 0
  );
  const minimumLeafDeckSeat = Math.max(
    0,
    Number(requirement.minimumLeafValuePairsPerDeckSeat) || 0
  );
  const requiredDeckSeats = (checkpoint.deckIds || []).length > 0
    ? checkpoint.deckIds.flatMap((deckId) => [
      `${deckId}:p1`,
      `${deckId}:p2`
    ])
    : Object.keys(partition.gameCoverage || {});
  if (minimumActionDeckSeat > 0 && requiredDeckSeats.some((key) =>
    Number(partition.structuredV2ActionReferenceCoverage?.[key] || 0)
      < minimumActionDeckSeat)) return false;
  if (minimumLeafDeckSeat > 0 && requiredDeckSeats.some((key) =>
    Number(partition.structuredV2LeafValueCoverage?.[key] || 0)
      < minimumLeafDeckSeat)) return false;
  const requiredDeckPhases = (checkpoint.deckIds || []).flatMap((deckId) =>
    ["mulligan", "early", "mid", "late"].map(
      (phase) => `${deckId}::${phase}`
    ));
  const deckPhaseRequirements = [
    [
      "structuredV2ActionReferenceDeckPhaseCoverage",
      "minimumActionReferencesPerDeckPhase"
    ],
    [
      "structuredV2ActionReferenceDeckPhaseGameCount",
      "minimumActionReferenceGamesPerDeckPhase"
    ],
    [
      "structuredV2LeafValueDeckPhaseCoverage",
      "minimumLeafValuePairsPerDeckPhase"
    ],
    [
      "structuredV2LeafValueDeckPhaseReferenceGameCount",
      "minimumLeafValueReferenceGamesPerDeckPhase"
    ]
  ];
  for (const [actualKey, requiredKey] of deckPhaseRequirements) {
    const minimum = Math.max(0, Number(requirement[requiredKey]) || 0);
    if (minimum > 0 && requiredDeckPhases.some((key) =>
      Number(partition[actualKey]?.[key] || 0) < minimum)) return false;
  }
  if (Number(partition.actionEvidenceGradeCounts?.[
    ACTION_EVIDENCE_GRADES.terminalRobust
  ] || 0) < Number(requirement.terminalRobustMinimum || 0)) return false;
  if (Number(partition.actionEvidenceGradeCounts?.[
    ACTION_EVIDENCE_GRADES.continuationConsistent
  ] || 0) < Number(
    requirement.continuationConsistentMinimum || 0
  )) return false;
  if (Number(partition.actionEvidenceIndependentOpeningStateCount || 0)
    < Number(requirement.independentOpeningStateMinimum || 0)) return false;
  const natural = partition.naturalDistributionActionAudit || {};
  if (Number(natural.states || 0)
    < Number(requirement.naturalDistributionAuditMinimum || 0)) return false;
  if (Number(requirement.naturalDistributionAuditMinimum || 0) > 0
    && !(Number(natural.decisiveCoverage)
      >= Number(requirement.decisiveCoverageMinimum || 0))) return false;
  if (Number(natural.nearEquivalent || 0)
    < Number(requirement.nearEquivalentMinimum || 0)) return false;
  const minimumNaturalDeckSeat = Math.max(
    0,
    Number(requirement.minimumDeckSeatCoverage) || 0
  );
  if (minimumNaturalDeckSeat > 0 && requiredDeckSeats.some((key) =>
    Number(natural.strata?.[`deck-seat:${key}`]?.states || 0)
      < minimumNaturalDeckSeat)) return false;
  return true;
}

export function detachedActionAuditIsEnabled(
  completedLogicalGames,
  boundaryGames = 320
) {
  return Math.max(0, Number(completedLogicalGames) || 0)
    >= Math.max(320, Number(boundaryGames) || 320);
}

export function evaluatorBootstrapActionAuditProcesses(
  processes = 1,
  requestedProcesses = processes
) {
  const processLimit = Math.max(1, Number(processes) || 1);
  return Math.max(
    1,
    Math.min(
      processLimit,
      Number(requestedProcesses) || processLimit
    )
  );
}

export function evaluatorBootstrapMaximumActionAuditProcesses(
  fallbackProcesses = 1,
  requestedProcesses = undefined
) {
  const fallback = Math.max(
    1,
    Math.floor(Number(fallbackProcesses) || 1)
  );
  if (requestedProcesses === undefined
    || requestedProcesses === null
    || requestedProcesses === "") return fallback;
  return Math.max(
    1,
    Math.floor(Number(requestedProcesses) || fallback)
  );
}

export function evaluatorBootstrapResumeTaskLimit(
  requestedTaskLimit,
  allocation,
  completedLogical,
  samplingMode
) {
  const requested = Math.max(
    0,
    Math.floor(Number(requestedTaskLimit) || 0)
  );
  const window = allocation?.activeCollectionWindow;
  if (window?.version !== 1
    || window.samplingMode !== samplingMode
    || !Number.isFinite(Number(window.startCompletedLogical))
    || !Number.isFinite(Number(window.targetCompletedLogical))
    || Number(window.targetCompletedLogical)
      < Number(window.startCompletedLogical)
    || Number(completedLogical) < Number(window.startCompletedLogical)
    || Number(completedLogical) >= Number(window.targetCompletedLogical)) {
    return requested;
  }
  return Math.min(
    requested,
    Math.max(
      0,
      Number(window.targetCompletedLogical) - Number(completedLogical)
    )
  );
}

export function evaluatorBootstrapFocusDeckSeats(coverageKeys = []) {
  const seats = {};
  for (const rawKey of coverageKeys || []) {
    const [deckId, seat] = String(rawKey).split(":");
    if (!deckId || deckId === "unknown"
      || !["p1", "p2"].includes(seat)) continue;
    seats[deckId] ||= [];
    if (!seats[deckId].includes(seat)) seats[deckId].push(seat);
  }
  return Object.fromEntries(Object.entries(seats).map(
    ([deckId, values]) => [deckId, values.sort()]
  ));
}

export function prioritizedMissingAuditPhaseBands(phaseBands = []) {
  const missing = new Set(
    (phaseBands || []).filter((phase) =>
      EVALUATOR_AUDIT_PHASE_BANDS.includes(phase))
  );
  // Late and mid decisions are the expensive, historically under-sampled
  // strata. Focus one band at a time so an early six-pair budget cannot starve
  // a later band in the same game.
  return ["late", "mid", "early", "mulligan"].filter((phase) =>
    missing.has(phase)).slice(0, 1);
}

export function evaluatorBootstrapDiagnosticFocus(
  demand,
  role,
  samplingMode
) {
  if (![1, 2, 3].includes(Number(demand?.version))
    || demand?.priority !== "warning-only"
    || demand?.officialEvidenceRuleChanged === true
    || String(demand?.role || "") !== String(role || "")) {
    return { items: [], phaseBands: [], actionClasses: [], deckSeats: [] };
  }
  const evidenceKinds = samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
    ? new Set(["action"])
    : samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
      ? new Set(["leaf", "action-effect"])
      : new Set();
  const defaultEvidenceKind = samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
    ? "action"
    : samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
      ? "leaf"
      : null;
  if (!defaultEvidenceKind) {
    return { items: [], phaseBands: [], actionClasses: [], deckSeats: [] };
  }
  const items = (demand.items || []).filter(
    (item) => evidenceKinds.has(item?.evidenceKind)
  ).map((item) => ({
    evidenceKind: item.evidenceKind || defaultEvidenceKind,
    reason: item.reason || "diagnostic-priority",
    auditDistribution: ["targeted-decisive", "natural-distribution"]
      .includes(item.auditDistribution)
        ? item.auditDistribution
        : null,
    missingMetric: item.missingMetric || null,
    requiredAdditionalGames: Math.max(
      0,
      Math.ceil(Number(item.requiredAdditionalGames) || 0)
    ),
    phaseBand: EVALUATOR_AUDIT_PHASE_BANDS.includes(item.phaseBand)
      ? item.phaseBand
      : null,
    actionClass: item.evidenceKind === "action"
      && EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.includes(item.actionClass)
        ? item.actionClass
        : null,
    deckSeat: validDiagnosticDeckSeat(item.deckSeat)
      ? item.deckSeat
      : null
  })).filter((item) =>
    item.phaseBand || item.actionClass || item.deckSeat);
  return {
    items,
    phaseBands: [...new Set(items.map((item) => item.phaseBand)
      .filter((phase) => EVALUATOR_AUDIT_PHASE_BANDS.includes(phase)))],
    actionClasses: defaultEvidenceKind === "action"
      ? [...new Set(items.map((item) => item.actionClass)
        .filter((actionClass) =>
          EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.includes(actionClass)))]
      : [],
    deckSeats: [...new Set(items.map((item) => item.deckSeat)
      .filter(Boolean))]
  };
}

export function evaluatorBootstrapDiagnosticTaskFocus(focus, taskIndex) {
  const items = focus?.items || [];
  const index = Math.max(0, Math.floor(Number(taskIndex) || 0));
  if (!items.length || index % 4 === 3) return null;
  const diagnosticOrdinal = index - Math.floor(index / 4);
  return items[diagnosticOrdinal % items.length] || null;
}

function validDiagnosticDeckSeat(value) {
  const [deckId, seat] = String(value || "").split(":");
  return Boolean(deckId && deckId !== "unknown"
    && (seat === "p1" || seat === "p2"));
}

function deckPhaseFocusCoverage(deckPhaseKeys = []) {
  return (deckPhaseKeys || []).flatMap((rawKey) => {
    const [deckId] = String(rawKey).split("::");
    return deckId && deckId !== "unknown"
      ? [`${deckId}:p1`, `${deckId}:p2`]
      : [];
  });
}

function deckPhaseFocusBands(deckPhaseKeys = []) {
  return (deckPhaseKeys || []).map((rawKey) =>
    String(rawKey).split("::")[1]
  ).filter(Boolean);
}

export function evaluatorBootstrapSamplingNeeds(audit, options = {}) {
  const policyQOnly = options.collectionScope === "policy-q";
  const minimumActionReferences = Math.max(
    50,
    Number(options.minimumActionReferences ?? options.minimumReferences) || 50
  );
  const minimumLeafValuePairs = Math.max(
    50,
    Number(options.minimumLeafValuePairs ?? options.minimumReferences) || 50
  );
  const minimumActionReferenceGames = Math.max(
    20,
    Number(options.minimumActionReferenceGames
      ?? options.minimumReferenceGames) || 20
  );
  const minimumLeafValueReferenceGames = Math.max(
    20,
    Number(options.minimumLeafValueReferenceGames
      ?? options.minimumReferenceGames) || 20
  );
  const minimumRepresentativeCalibrationGames = Math.max(
    100,
    Number(options.minimumRepresentativeCalibrationGames) || 100
  );
  const partitions = Object.entries(audit?.certificationPartitions || {});
  const partitionNeedsAction = !policyQOnly && partitions.some(([role, partition]) => {
    const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
    return Number(partition.acceptedGames) < requirement.minimumGames
      || Number(partition.actionReferenceCount)
        < requirement.minimumActionReferences
      || Number(partition.actionReferenceGameCount)
        < requirement.minimumActionReferenceGames
      || Number(partition.structuredV2ActionReferenceCount)
        < requirement.minimumStructuredV2ActionReferences
      || Number(partition.structuredV2ActionReferenceGameCount)
        < requirement.minimumStructuredV2ActionReferenceGames
      || (partition.missingActionReferenceCoverage || []).length > 0
      || (partition.missingActionReferencePhaseCoverage || []).length > 0
      || (partition.missingActionReferenceActionClassCoverage || []).length > 0
      || (partition.missingActionReferenceDeckPhaseCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferenceCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferencePhaseCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferenceActionClassCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferenceDeckPhaseCoverage || []).length > 0;
  });
  const partitionNeedsLeaf = partitions.some(([role, partition]) => {
    const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
    return Number(partition.acceptedGames) < requirement.minimumGames
      || Number(partition.leafValuePairCount)
        < requirement.minimumLeafValuePairs
      || Number(partition.leafValueReferenceGameCount)
        < requirement.minimumLeafValueReferenceGames
      || Number(partition.structuredV2LeafValuePairCount)
        < requirement.minimumStructuredV2LeafValuePairs
      || Number(partition.structuredV2LeafValueReferenceGameCount)
        < requirement.minimumStructuredV2LeafValueReferenceGames
      || (partition.missingLeafValueCoverage || []).length > 0
      || (partition.missingLeafValuePhaseCoverage || []).length > 0
      || (partition.missingLeafValueDeckPhaseCoverage || []).length > 0
      || (partition.missingStructuredV2LeafValueCoverage || []).length > 0
      || (partition.missingStructuredV2LeafValuePhaseCoverage || []).length > 0
      || (partition.missingStructuredV2LeafValueDeckPhaseCoverage || []).length > 0;
  });
  return {
    calibration: Number(audit?.representativeCalibrationGames)
      < minimumRepresentativeCalibrationGames,
    action: !policyQOnly && (Number(audit?.actionReferenceCount) < minimumActionReferences
      || Number(audit?.structuredV2ActionReferenceCount)
        < Number(options.minimumStructuredV2ActionReferences || 0)
      || Number(audit?.actionReferenceGameCount)
        < minimumActionReferenceGames
      || (audit?.missingActionReferenceCoverage || []).length > 0
      || (audit?.missingActionReferencePhaseCoverage || []).length > 0
      || (audit?.missingActionReferenceActionClassCoverage || []).length > 0
      || (audit?.missingActionReferenceDeckPhaseCoverage || []).length > 0
      || (audit?.missingStructuredV2ActionReferenceCoverage || []).length > 0
      || (audit?.missingStructuredV2ActionReferencePhaseCoverage || []).length > 0
      || (audit?.missingStructuredV2ActionReferenceActionClassCoverage || []).length > 0
      || (audit?.missingStructuredV2ActionReferenceDeckPhaseCoverage || []).length > 0
      || partitionNeedsAction),
    leaf: Number(audit?.leafValuePairCount) < minimumLeafValuePairs
      || Number(audit?.structuredV2LeafValuePairCount)
        < Number(options.minimumStructuredV2LeafValuePairs || 0)
      || Number(audit?.leafValueReferenceGameCount)
        < minimumLeafValueReferenceGames
      || (audit?.missingLeafValueCoverage || []).length > 0
      || (audit?.missingLeafValuePhaseCoverage || []).length > 0
      || (audit?.missingLeafValueDeckPhaseCoverage || []).length > 0
      || (audit?.missingStructuredV2LeafValueCoverage || []).length > 0
      || (audit?.missingStructuredV2LeafValuePhaseCoverage || []).length > 0
      || (audit?.missingStructuredV2LeafValueDeckPhaseCoverage || []).length > 0
      || partitionNeedsLeaf
  };
}

export function evaluatorBootstrapSamplingMode(
  audit,
  completedLogical,
  batchGames,
  options = {}
) {
  const needs = evaluatorBootstrapSamplingNeeds(audit, options);
  const modes = [
    needs.calibration
      ? EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration
      : null,
    needs.leaf ? EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf : null,
    needs.action ? EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action : null
  ].filter(Boolean);
  if (!modes.length) return null;
  const round = Math.floor(
    Math.max(0, Number(completedLogical) || 0)
      / Math.max(1, Number(batchGames) || 1)
  );
  return modes[round % modes.length];
}

export function evaluatorBootstrapSamplingModeNeedsWork(
  samplingMode,
  audit,
  options = {}
) {
  const needs = evaluatorBootstrapSamplingNeeds(audit, options);
  if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration) {
    return needs.calibration;
  }
  if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf) {
    return needs.leaf;
  }
  if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action) {
    return needs.action;
  }
  throw new Error(`Unknown evaluator bootstrap sampling mode: ${samplingMode}`);
}

export function evaluatorBootstrapActionCertificationRole(
  audit,
  options = {}
) {
  return evaluatorEvidencePartitionsForAudit(audit, options).find((role) => {
    const partition = audit?.certificationPartitions?.[role];
    const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
    return !partition
      || Number(partition.acceptedGames) < requirement.minimumGames
      || Number(partition.actionReferenceCount)
        < requirement.minimumActionReferences
      || Number(partition.actionReferenceGameCount)
        < requirement.minimumActionReferenceGames
      || Number(partition.structuredV2ActionReferenceCount)
        < requirement.minimumStructuredV2ActionReferences
      || Number(partition.structuredV2ActionReferenceGameCount)
        < requirement.minimumStructuredV2ActionReferenceGames
      || (partition.missingActionReferenceCoverage || []).length > 0
      || (partition.missingActionReferencePhaseCoverage || []).length > 0
      || (partition.missingActionReferenceActionClassCoverage || []).length > 0
      || (partition.missingActionReferenceDeckPhaseCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferenceCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferencePhaseCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferenceActionClassCoverage || []).length > 0
      || (partition.missingStructuredV2ActionReferenceDeckPhaseCoverage || []).length > 0;
  }) || null;
}

export function evaluatorBootstrapActionRoleGameDemand(
  partition,
  options = {},
  role = partition?.role || null
) {
  const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
  const minimumActionReferences = requirement.minimumActionReferences;
  const minimumActionReferenceGames = requirement.minimumActionReferenceGames;
  const minimumGames = requirement.minimumGames;
  const acceptedGames = Math.max(0, Number(partition?.acceptedGames) || 0);
  const references = Math.min(Math.max(
    0,
    Number(partition?.actionReferenceCount) || 0
  ), Math.max(
    0,
    Number(partition?.structuredV2ActionReferenceCount) || 0
  ));
  const referenceGames = Math.min(Math.max(
    0,
    Number(partition?.actionReferenceGameCount) || 0
  ), Math.max(
    0,
    Number(partition?.structuredV2ActionReferenceGameCount) || 0
  ));
  const actionGames = Math.max(
    0,
    Number(
      partition?.samplingModes?.[
        EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
      ]
    ) || 0
  );
  const defaultYield = Math.max(
    0.01,
    Math.min(1, Number(options.defaultActionReferenceYield) || 1 / 8)
  );
  const referenceYield = actionGames > 0
    ? Math.max(0.01, Math.min(1, references / actionGames))
    : defaultYield;
  const referenceGameYield = actionGames > 0
    ? Math.max(0.01, Math.min(1, referenceGames / actionGames))
    : defaultYield;
  const missingCoverage = new Set([
    ...(partition?.missingActionReferenceCoverage || []),
    ...(partition?.missingStructuredV2ActionReferenceCoverage || [])
  ]).size;
  const missingPhaseCoverage = new Set([
    ...(partition?.missingActionReferencePhaseCoverage || []),
    ...(partition?.missingStructuredV2ActionReferencePhaseCoverage || [])
  ]).size;
  const missingActionClassCoverage = new Set([
    ...(partition?.missingActionReferenceActionClassCoverage || []),
    ...(partition?.missingStructuredV2ActionReferenceActionClassCoverage || [])
  ]).size;
  const missingDeckPhaseCoverage = new Set([
    ...(partition?.missingActionReferenceDeckPhaseCoverage || []),
    ...(partition?.missingStructuredV2ActionReferenceDeckPhaseCoverage || [])
  ]).size;
  const referenceGap = Math.max(0, minimumActionReferences - references);
  const referenceGameGap = Math.max(
    0,
    minimumActionReferenceGames - referenceGames
  );
  const demand = Math.max(
    Math.max(0, minimumGames - acceptedGames),
    Math.ceil(referenceGap / referenceYield),
    Math.ceil(referenceGameGap / referenceGameYield),
    missingCoverage > 0
      ? Math.ceil(missingCoverage / referenceYield)
      : 0,
    missingPhaseCoverage > 0
      ? Math.ceil(missingPhaseCoverage / referenceYield)
      : 0,
    missingActionClassCoverage > 0
      ? Math.ceil(missingActionClassCoverage / referenceYield)
      : 0,
    missingDeckPhaseCoverage > 0
      ? Math.ceil(missingDeckPhaseCoverage / referenceYield)
      : 0
  );
  return {
    complete: demand === 0,
    demand,
    actionGames,
    referenceYield,
    referenceGameYield,
    referenceGap,
    referenceGameGap,
    missingCoverage,
    missingPhaseCoverage,
    missingActionClassCoverage,
    missingDeckPhaseCoverage
  };
}

export function evaluatorBootstrapDetachedActionRoleChunkGames(
  partition,
  options = {},
  role = partition?.role || null,
  requestedProcesses = 16,
  configuredGames = null
) {
  const demand = evaluatorBootstrapActionRoleGameDemand(
    partition,
    options,
    role
  );
  const finalistAttempts = Math.max(
    0,
    Number(partition?.actionAuditRacing?.finalAttempted) || 0
  );
  const actionGames = Math.max(0, Number(demand.actionGames) || 0);
  return detachedActionAuditFineRoleChunkGames(
    requestedProcesses,
    configuredGames,
    {
      finalistRate: actionGames > 0
        ? finalistAttempts / actionGames
        : undefined,
      remainingEvidenceUnits: Math.max(
        Number(demand.demand) || 0,
        Number(demand.referenceGap) || 0,
        Number(demand.referenceGameGap) || 0,
        Number(demand.missingCoverage) || 0,
        Number(demand.missingPhaseCoverage) || 0,
        Number(demand.missingActionClassCoverage) || 0,
        Number(demand.missingDeckPhaseCoverage) || 0
      )
    }
  );
}

function evaluatorBootstrapPartitionFocuses(partition, evidenceKind, count) {
  const limit = Math.max(0, Math.floor(Number(count) || 0));
  const action = evidenceKind === "action";
  const coverageKeys = [...new Set([
    ...(action
      ? partition?.missingStructuredV2ActionReferenceCoverage || []
      : partition?.missingStructuredV2LeafValueCoverage || []),
    ...(action
      ? partition?.missingActionReferenceCoverage || []
      : partition?.missingLeafValueCoverage || [])
  ])];
  const deckPhaseKeys = [...new Set([
    ...(action
      ? partition?.missingStructuredV2ActionReferenceDeckPhaseCoverage || []
      : partition?.missingStructuredV2LeafValueDeckPhaseCoverage || []),
    ...(action
      ? partition?.missingActionReferenceDeckPhaseCoverage || []
      : partition?.missingLeafValueDeckPhaseCoverage || [])
  ])];
  const phases = [...new Set([
    ...(action
      ? partition?.missingStructuredV2ActionReferencePhaseCoverage || []
      : partition?.missingStructuredV2LeafValuePhaseCoverage || []),
    ...(action
      ? partition?.missingActionReferencePhaseCoverage || []
      : partition?.missingLeafValuePhaseCoverage || [])
  ])].filter((phase) => EVALUATOR_AUDIT_PHASE_BANDS.includes(phase));
  const actionClasses = action
    ? [...new Set([
      ...(partition?.missingStructuredV2ActionReferenceActionClassCoverage || []),
      ...(partition?.missingActionReferenceActionClassCoverage || [])
    ])].filter((actionClass) =>
      EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.includes(actionClass))
    : [];
  const focusItems = [];
  for (const rawKey of deckPhaseKeys) {
    const [deckId, phaseBand] = String(rawKey).split("::");
    if (!deckId || !EVALUATOR_AUDIT_PHASE_BANDS.includes(phaseBand)) continue;
    const matchingSeats = coverageKeys.filter((key) =>
      String(key).startsWith(`${deckId}:`));
    if (matchingSeats.length > 0) {
      for (const deckSeat of matchingSeats) {
        focusItems.push({
          deckPhaseKey: rawKey,
          deckId,
          deckSeat,
          phaseBand
        });
      }
    } else {
      focusItems.push({ deckPhaseKey: rawKey, deckId, phaseBand });
    }
  }
  for (const deckSeat of coverageKeys) {
    const [deckId, seat] = String(deckSeat).split(":");
    if (!deckId || !["p1", "p2"].includes(seat)) continue;
    focusItems.push({ deckId, deckSeat });
  }
  for (const phaseBand of phases) {
    focusItems.push({ phaseBand });
  }
  for (const actionClass of actionClasses) {
    focusItems.push({ actionClass });
  }
  const deduplicated = [...new Map(focusItems.map((item) => [
    JSON.stringify(item),
    item
  ])).values()];
  if (deduplicated.length === 0) {
    return Array.from({ length: limit }, () => null);
  }
  return Array.from({ length: limit }, (_, taskIndex) =>
    deduplicated[taskIndex % deduplicated.length]);
}

export function evaluatorBootstrapActionCertificationRolePlan(
  audit,
  taskLimit,
  options = {}
) {
  const limit = Math.max(0, Math.floor(Number(taskLimit) || 0));
  const primaryRole = evaluatorBootstrapActionCertificationRole(
    audit,
    options
  );
  const roles = [];
  const focuses = [];
  const allocations = {};
  if (!primaryRole || limit === 0) {
    return { primaryRole, roles, focuses, allocations, prefetchedRoles: [] };
  }
  const partitionRoles = evaluatorEvidencePartitionsForAudit(audit, options);
  const startIndex = partitionRoles.indexOf(primaryRole);
  for (const role of partitionRoles.slice(startIndex)) {
    if (roles.length >= limit) break;
    const demand = evaluatorBootstrapActionRoleGameDemand(
      audit?.certificationPartitions?.[role],
      options,
      role
    ).demand;
    const count = Math.min(limit - roles.length, Math.max(0, demand));
    if (count <= 0) continue;
    allocations[role] = count;
    roles.push(...Array.from({ length: count }, () => role));
    focuses.push(...evaluatorBootstrapPartitionFocuses(
      audit?.certificationPartitions?.[role],
      "action",
      count
    ));
  }
  if (options.fillActionPlanCapacity === true && roles.length < limit) {
    const paddingRole = [...partitionRoles.slice(startIndex)].reverse().find(
      (role) => !evaluatorBootstrapActionRoleGameDemand(
        audit?.certificationPartitions?.[role],
        options,
        role
      ).complete
    ) || primaryRole;
    const padding = limit - roles.length;
    allocations[paddingRole] = (allocations[paddingRole] || 0) + padding;
    roles.push(...Array.from({ length: padding }, () => paddingRole));
    focuses.push(...evaluatorBootstrapPartitionFocuses(
      audit?.certificationPartitions?.[paddingRole],
      "action",
      padding
    ));
  }
  return {
    primaryRole,
    roles,
    focuses,
    allocations,
    prefetchedRoles: Object.keys(allocations)
      .filter((role) => role !== primaryRole)
  };
}

function evaluatorBootstrapActionEvidenceSnapshot(audit, options = {}) {
  let actionReferenceCount = 0;
  let actionReferenceGameCount = 0;
  let remainingEvidenceUnits = 0;
  let estimatedGameDemand = 0;
  for (const role of evaluatorEvidencePartitionsForAudit(audit, options)) {
    const partition = audit?.certificationPartitions?.[role];
    const demand = evaluatorBootstrapActionRoleGameDemand(
      partition,
      options,
      role
    );
    actionReferenceCount += Math.max(
      0,
      Number(partition?.actionReferenceCount) || 0
    );
    actionReferenceGameCount += Math.max(
      0,
      Number(partition?.actionReferenceGameCount) || 0
    );
    remainingEvidenceUnits += Math.max(
      demand.referenceGap,
      demand.referenceGameGap,
      demand.missingCoverage,
      demand.missingPhaseCoverage,
      demand.missingActionClassCoverage,
      demand.missingDeckPhaseCoverage
    );
    estimatedGameDemand += demand.demand;
  }
  return {
    actionReferenceCount,
    actionReferenceGameCount,
    remainingEvidenceUnits,
    estimatedGameDemand
  };
}

export function evaluatorBootstrapActionCollectionStrategy(
  audit,
  maximumTaskLimit,
  options = {}
) {
  const capacity = Math.max(0, Math.floor(Number(maximumTaskLimit) || 0));
  const bulkGames = Math.max(
    1,
    Math.floor(
      Number(options.actionBulkCollectionGames)
        || EVALUATOR_BOOTSTRAP_ACTION_BULK_WINDOW_GAMES
    )
  );
  const fineGames = Math.max(
    1,
    Math.floor(Number(options.actionFineCollectionGames) || 1)
  );
  const snapshot = evaluatorBootstrapActionEvidenceSnapshot(audit, options);
  const previousBulkEvidenceYield = Math.max(
    0,
    Number(options.lastActionBulkBatch?.evidenceUnitsGained) || 0
  );
  // Once a full window has measured the real yield, switch to fine-grained
  // collection only when the remaining evidence is strictly smaller than
  // what that full window produced. Before a measured bulk window exists,
  // the empirical per-game demand estimate provides the same boundary.
  const fineCollection = previousBulkEvidenceYield > 0
    ? snapshot.remainingEvidenceUnits < previousBulkEvidenceYield
    : snapshot.estimatedGameDemand < bulkGames;
  const mode = fineCollection ? "fine" : "bulk";
  const taskLimit = Math.min(
    capacity,
    mode === "bulk"
      ? bulkGames
      : Math.min(
        fineGames,
        Math.max(0, snapshot.estimatedGameDemand)
      )
  );
  const rolePlan = evaluatorBootstrapActionCertificationRolePlan(
    audit,
    taskLimit,
    {
      ...options,
      fillActionPlanCapacity: mode === "bulk"
    }
  );
  return {
    version: 1,
    mode,
    taskLimit: rolePlan.roles.length,
    bulkGames,
    fineGames,
    previousBulkEvidenceYield,
    ...snapshot,
    rolePlan
  };
}

function completedEvaluatorBootstrapActionBatch(
  collectionWindow,
  audit,
  completedLogical,
  options = {}
) {
  if (collectionWindow?.samplingMode
      !== EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
    || collectionWindow.actionCollectionStrategy?.version !== 1
    || Number(completedLogical)
      < Number(collectionWindow.targetCompletedLogical)) {
    return null;
  }
  const before = collectionWindow.actionEvidenceSnapshot || {};
  const after = evaluatorBootstrapActionEvidenceSnapshot(audit, options);
  const referenceGain = Math.max(
    0,
    after.actionReferenceCount
      - (Number(before.actionReferenceCount) || 0)
  );
  const referenceGameGain = Math.max(
    0,
    after.actionReferenceGameCount
      - (Number(before.actionReferenceGameCount) || 0)
  );
  return {
    version: 1,
    mode: collectionWindow.actionCollectionStrategy.mode,
    scheduledGames: Math.max(
      0,
      Number(collectionWindow.targetCompletedLogical)
        - Number(collectionWindow.startCompletedLogical)
    ),
    completedGames: Math.max(
      0,
      Number(completedLogical)
        - Number(collectionWindow.startCompletedLogical)
    ),
    referenceGain,
    referenceGameGain,
    evidenceUnitsGained: Math.max(referenceGain, referenceGameGain),
    remainingEvidenceUnitsBefore:
      Number(before.remainingEvidenceUnits) || 0,
    remainingEvidenceUnitsAfter: after.remainingEvidenceUnits,
    completedAt: new Date().toISOString()
  };
}

export function evaluatorBootstrapLeafCertificationRole(
  audit,
  options = {}
) {
  return evaluatorEvidencePartitionsForAudit(audit, options).find((role) => {
    const partition = audit?.certificationPartitions?.[role];
    const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
    return !partition
      || Number(partition.acceptedGames) < requirement.minimumGames
      || Number(partition.leafValuePairCount)
        < requirement.minimumLeafValuePairs
      || Number(partition.leafValueReferenceGameCount)
        < requirement.minimumLeafValueReferenceGames
      || Number(partition.structuredV2LeafValuePairCount)
        < requirement.minimumStructuredV2LeafValuePairs
      || Number(partition.structuredV2LeafValueReferenceGameCount)
        < requirement.minimumStructuredV2LeafValueReferenceGames
      || (partition.missingLeafValueCoverage || []).length > 0
      || (partition.missingLeafValuePhaseCoverage || []).length > 0
      || (partition.missingLeafValueDeckPhaseCoverage || []).length > 0
      || (partition.missingStructuredV2LeafValueCoverage || []).length > 0
      || (partition.missingStructuredV2LeafValuePhaseCoverage || []).length > 0
      || (partition.missingStructuredV2LeafValueDeckPhaseCoverage || []).length > 0;
  }) || null;
}

export function evaluatorBootstrapLeafRoleGameDemand(
  partition,
  options = {},
  role = partition?.role || null
) {
  const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
  const minimumLeafValuePairs = requirement.minimumLeafValuePairs;
  const minimumLeafValueReferenceGames =
    requirement.minimumLeafValueReferenceGames;
  const minimumGames = requirement.minimumGames;
  const acceptedGames = Math.max(0, Number(partition?.acceptedGames) || 0);
  const pairs = Math.min(
    Math.max(0, Number(partition?.leafValuePairCount) || 0),
    Math.max(0, Number(partition?.structuredV2LeafValuePairCount) || 0)
  );
  const referenceGames = Math.min(Math.max(
    0,
    Number(partition?.leafValueReferenceGameCount) || 0
  ), Math.max(
    0,
    Number(partition?.structuredV2LeafValueReferenceGameCount) || 0
  ));
  const leafGames = Math.max(
    0,
    Number(
      partition?.samplingModes?.[
        EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
      ]
    ) || 0
  );
  const defaultPairYield = Math.max(
    0.01,
    Number(options.defaultLeafValuePairYield) || 1
  );
  const pairYield = leafGames > 0
    ? Math.max(0.01, pairs / leafGames)
    : defaultPairYield;
  const defaultReferenceGameYield = Math.max(
    0.01,
    Math.min(1, Number(options.defaultLeafReferenceGameYield) || 0.5)
  );
  const referenceGameYield = leafGames > 0
    ? Math.max(0.01, Math.min(1, referenceGames / leafGames))
    : defaultReferenceGameYield;
  // Deck/phase gaps are rarer than a generic leaf reference. Estimate them
  // independently so one missing Sett-late cell does not reserve an entire
  // old 160-game rolling window, while still scheduling several attempts.
  const coverageYield = Math.max(
    0.01,
    Math.min(1, Number(options.defaultLeafCoverageYield) || 0.25)
  );
  const missingCoverage = new Set([
    ...(partition?.missingLeafValueCoverage || []),
    ...(partition?.missingStructuredV2LeafValueCoverage || [])
  ]).size;
  const missingPhaseCoverage = new Set([
    ...(partition?.missingLeafValuePhaseCoverage || []),
    ...(partition?.missingStructuredV2LeafValuePhaseCoverage || [])
  ]).size;
  const missingDeckPhaseCoverage = new Set([
    ...(partition?.missingLeafValueDeckPhaseCoverage || []),
    ...(partition?.missingStructuredV2LeafValueDeckPhaseCoverage || [])
  ]).size;
  const phaseDemands = mappedLeafEvidenceGameDemands(
    partition,
    requirement.minimumLeafValuePairsByPhase,
    requirement.minimumLeafValueReferenceGamesByPhase,
    "leafValuePhaseCoverage",
    "structuredV2LeafValuePhaseCoverage",
    "leafValuePhaseReferenceGameCount",
    "structuredV2LeafValuePhaseReferenceGameCount",
    defaultPairYield
  );
  const phaseDemand = Object.values(phaseDemands)
    .reduce((sum, value) => sum + value, 0);
  const deckPhaseKeys = new Set([
    ...Object.keys(partition?.leafValueDeckPhaseCoverage || {}),
    ...Object.keys(partition?.structuredV2LeafValueDeckPhaseCoverage || {}),
    ...(partition?.missingLeafValueDeckPhaseCoverage || []),
    ...(partition?.missingStructuredV2LeafValueDeckPhaseCoverage || [])
  ]);
  const deckPhaseDemands = mappedLeafEvidenceGameDemands(
    partition,
    Object.fromEntries([...deckPhaseKeys].map((key) => [
      key,
      requirement.minimumLeafValuePairsPerDeckPhase
    ])),
    Object.fromEntries([...deckPhaseKeys].map((key) => [
      key,
      requirement.minimumLeafValueReferenceGamesPerDeckPhase
    ])),
    "leafValueDeckPhaseCoverage",
    "structuredV2LeafValueDeckPhaseCoverage",
    "leafValueDeckPhaseReferenceGameCount",
    "structuredV2LeafValueDeckPhaseReferenceGameCount",
    defaultPairYield
  );
  const deckPhaseDemand = Object.values(deckPhaseDemands)
    .reduce((sum, value) => sum + value, 0);
  const pairGap = Math.max(0, minimumLeafValuePairs - pairs);
  const referenceGameGap = Math.max(
    0,
    minimumLeafValueReferenceGames - referenceGames
  );
  const demand = Math.max(
    Math.max(0, minimumGames - acceptedGames),
    Math.ceil(pairGap / pairYield),
    Math.ceil(referenceGameGap / referenceGameYield),
    phaseDemand,
    deckPhaseDemand,
    missingCoverage > 0
      ? Math.ceil(missingCoverage / coverageYield)
      : 0,
    missingPhaseCoverage > 0
      ? Math.ceil(missingPhaseCoverage / coverageYield)
      : 0,
    missingDeckPhaseCoverage > 0
      ? Math.ceil(missingDeckPhaseCoverage / coverageYield)
      : 0
  );
  return {
    complete: demand === 0,
    demand,
    leafGames,
    pairYield,
    referenceGameYield,
    coverageYield,
    pairGap,
    referenceGameGap,
    missingCoverage,
    missingPhaseCoverage,
    missingDeckPhaseCoverage,
    phaseDemand,
    deckPhaseDemand,
    phaseDemands,
    deckPhaseDemands
  };
}

function mappedLeafEvidenceGameDemand(
  partition,
  pairRequirements = {},
  gameRequirements = {},
  legacyPairKey,
  structuredPairKey,
  legacyGameKey,
  structuredGameKey,
  defaultPairYield = 1
) {
  return Object.values(mappedLeafEvidenceGameDemands(
    partition,
    pairRequirements,
    gameRequirements,
    legacyPairKey,
    structuredPairKey,
    legacyGameKey,
    structuredGameKey,
    defaultPairYield
  )).reduce((sum, value) => sum + value, 0);
}

function mappedLeafEvidenceGameDemands(
  partition,
  pairRequirements = {},
  gameRequirements = {},
  legacyPairKey,
  structuredPairKey,
  legacyGameKey,
  structuredGameKey,
  defaultPairYield = 1
) {
  const keys = new Set([
    ...Object.keys(pairRequirements || {}),
    ...Object.keys(gameRequirements || {})
  ]);
  const demands = {};
  for (const key of keys) {
    const requiredPairs = Math.max(
      0,
      Number(pairRequirements?.[key]) || 0
    );
    const requiredGames = Math.max(
      0,
      Number(gameRequirements?.[key]) || 0
    );
    if (requiredPairs === 0 && requiredGames === 0) continue;
    const pairs = Math.min(
      Math.max(0, Number(partition?.[legacyPairKey]?.[key]) || 0),
      Math.max(0, Number(partition?.[structuredPairKey]?.[key]) || 0)
    );
    const games = Math.min(
      Math.max(0, Number(partition?.[legacyGameKey]?.[key]) || 0),
      Math.max(0, Number(partition?.[structuredGameKey]?.[key]) || 0)
    );
    const pairYield = games > 0
      ? Math.max(0.01, pairs / games)
      : Math.max(0.01, Number(defaultPairYield) || 1);
    demands[key] = Math.max(
      Math.ceil(Math.max(0, requiredPairs - pairs) / pairYield),
      Math.max(0, requiredGames - games)
    );
  }
  return demands;
}

function weightedDemandKeys(demands = {}, count = 0) {
  const limit = Math.max(0, Math.floor(Number(count) || 0));
  const entries = Object.entries(demands)
    .map(([key, demand]) => ({
      key,
      demand: Math.max(0, Number(demand) || 0),
      assigned: 0
    }))
    .filter((entry) => entry.demand > 0);
  const result = [];
  for (let index = 0; index < limit && entries.length > 0; index += 1) {
    // D'Hondt-style weighted round robin keeps short batches proportional to
    // the actual remaining game deficit instead of treating every missing
    // phase as equally incomplete.
    entries.sort((left, right) =>
      (right.demand / (right.assigned + 1))
        - (left.demand / (left.assigned + 1))
      || left.key.localeCompare(right.key));
    const selected = entries[0];
    selected.assigned += 1;
    result.push(selected.key);
  }
  return result;
}

function evaluatorBootstrapLeafPartitionFocuses(
  partition,
  count,
  demandEvidence
) {
  const limit = Math.max(0, Math.floor(Number(count) || 0));
  const phaseDemands = { ...(demandEvidence?.phaseDemands || {}) };
  const deckPhaseDemands = { ...(demandEvidence?.deckPhaseDemands || {}) };
  const deckPhaseDemandsByPhase = {};
  for (const [deckPhaseKey, demand] of Object.entries(deckPhaseDemands)) {
    const phaseBand = String(deckPhaseKey).split("::")[1];
    if (!EVALUATOR_AUDIT_PHASE_BANDS.includes(phaseBand)) continue;
    deckPhaseDemandsByPhase[phaseBand] =
      (deckPhaseDemandsByPhase[phaseBand] || 0)
      + Math.max(0, Number(demand) || 0);
  }
  const effectivePhaseDemands = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phaseBand) => [
      phaseBand,
      Math.max(
        Math.max(0, Number(phaseDemands[phaseBand]) || 0),
        Math.max(0, Number(deckPhaseDemandsByPhase[phaseBand]) || 0)
      )
    ])
  );
  const phaseSchedule = weightedDemandKeys(effectivePhaseDemands, limit);
  if (phaseSchedule.length === 0) {
    return evaluatorBootstrapPartitionFocuses(partition, "leaf", limit);
  }

  const deckPhaseSchedules = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phaseBand) => {
      const phaseTaskCount = phaseSchedule
        .filter((scheduledPhase) => scheduledPhase === phaseBand).length;
      const matchingDemands = Object.fromEntries(
        Object.entries(deckPhaseDemands).filter(([deckPhaseKey]) =>
          String(deckPhaseKey).endsWith(`::${phaseBand}`))
      );
      const totalDeckPhaseDemand = Object.values(matchingDemands)
        .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
      const effectivePhaseDemand = Math.max(
        1,
        Number(effectivePhaseDemands[phaseBand]) || 0
      );
      const deckPhaseTaskCount = Math.min(
        phaseTaskCount,
        Math.ceil(phaseTaskCount * totalDeckPhaseDemand / effectivePhaseDemand)
      );
      return [
        phaseBand,
        weightedDemandKeys(matchingDemands, deckPhaseTaskCount)
      ];
    })
  );

  return phaseSchedule.map((phaseBand) => {
    const deckPhaseKey = deckPhaseSchedules[phaseBand]?.shift() || null;
    if (!deckPhaseKey) return { phaseBand };
    const [deckId] = String(deckPhaseKey).split("::");
    return { deckPhaseKey, deckId, phaseBand };
  });
}

export function evaluatorBootstrapLeafCertificationRolePlan(
  audit,
  taskLimit,
  options = {}
) {
  const limit = Math.max(0, Math.floor(Number(taskLimit) || 0));
  const primaryRole = evaluatorBootstrapLeafCertificationRole(audit, options);
  const roles = [];
  const focuses = [];
  const allocations = {};
  if (!primaryRole || limit === 0) {
    return {
      primaryRole,
      roles,
      focuses,
      allocations,
      prefetchedRoles: []
    };
  }
  const partitionRoles = evaluatorEvidencePartitionsForAudit(audit, options);
  const startIndex = partitionRoles.indexOf(primaryRole);
  for (const role of partitionRoles.slice(startIndex)) {
    if (roles.length >= limit) break;
    const partition = audit?.certificationPartitions?.[role];
    const demandEvidence = evaluatorBootstrapLeafRoleGameDemand(
      partition,
      options,
      role
    );
    const count = Math.min(
      limit - roles.length,
      Math.max(0, demandEvidence.demand)
    );
    if (count <= 0) continue;
    allocations[role] = count;
    roles.push(...Array.from({ length: count }, () => role));
    const roleFocuses = evaluatorBootstrapLeafPartitionFocuses(
      partition,
      count,
      demandEvidence
    );
    // Protected Policy-Q roles need enough independent natural games for the
    // game-cluster population and tail bounds. Reserve two thirds for the
    // precommitted Bernoulli frame while retaining at least one task for every
    // requested atomic targeted focus.
    if (["development", "confirmation", "final-audit"].includes(role)) {
      const focusKey = (focus) => focus?.deckPhaseKey
        || JSON.stringify(focus || null);
      const remainingByFocus = new Map();
      for (const focus of roleFocuses) {
        const key = focusKey(focus);
        remainingByFocus.set(key, (remainingByFocus.get(key) || 0) + 1);
      }
      let naturalRemaining = Math.floor(roleFocuses.length * 2 / 3);
      for (let index = roleFocuses.length - 1;
        index >= 0 && naturalRemaining > 0;
        index -= 1) {
        const key = focusKey(roleFocuses[index]);
        if ((remainingByFocus.get(key) || 0) <= 1) continue;
        roleFocuses[index] = { naturalDistribution: true };
        remainingByFocus.set(key, remainingByFocus.get(key) - 1);
        naturalRemaining -= 1;
      }
    }
    focuses.push(...roleFocuses);
  }
  return {
    primaryRole,
    roles,
    focuses,
    allocations,
    prefetchedRoles: Object.keys(allocations)
      .filter((role) => role !== primaryRole)
  };
}

export function evaluatorBootstrapCollectionOptions(
  samplingMode,
  collection = {}
) {
  const calibrationOnly =
    samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration;
  const leafAudit =
    samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf;
  const actionAudit =
    samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action;
  if (!calibrationOnly && !leafAudit && !actionAudit) {
    throw new Error(`Unknown evaluator bootstrap sampling mode: ${samplingMode}`);
  }
  return {
    // The evaluator bootstrap counts independent physical games. A BO3 costs
    // two or three full games while contributing only one logical sample, so
    // action-ranking evidence is collected from deterministic single games.
    // PPO, league play and deployment evaluation keep their own BO3 setting.
    bestOfThreeFraction: actionAudit
      ? 0
      : collection.bestOfThreeFraction ?? 0.25,
    teacherFraction: calibrationOnly
      ? 0
      : Math.max(0.75, Number(collection.teacherFraction) || 0.12),
    teacherBudget: calibrationOnly
      ? 0
      : actionAudit
        ? Math.min(
          24,
          Math.max(20, Number(collection.teacherBudget) || 24)
        )
        : Math.max(48, Number(collection.teacherBudget) || 16),
    teacherCriticalBudget: calibrationOnly
      ? 0
      : Math.max(16, Number(collection.teacherCriticalBudget) || 8),
    teacherUrgentBudget: calibrationOnly
      ? 0
      : Math.max(8, Number(collection.teacherUrgentBudget) || 4),
    captureProductionLeafAudit: leafAudit || actionAudit,
    captureIndependentLeafAudit: leafAudit,
    captureIndependentActionAudit: actionAudit,
    // Action-audit games retain five cheap, diverse candidates and run the
    // expensive terminal audit only after the game-level candidate race.
    deferIndependentActionAudit: actionAudit,
    teacherActionAuditCandidatePoolSize: actionAudit ? 5 : 0,
    teacherActionAuditBudget: actionAudit ? 1 : 0,
    teacherActionAuditMaximumQueries: actionAudit ? 24 : 0,
    teacherActionAuditReducedQueryFraction: actionAudit ? 0.35 : 0,
    teacherActionAuditSaturationQueries: actionAudit ? 8 : 0,
    stopTeacherAfterActionAuditBudget: false,
    // Certification is game-clustered. Spend one expensive targeted audit in
    // each game instead of six correlated audits from the same trajectory.
    teacherLeafAuditPairBudget: leafAudit ? 1 : 0,
    stopTeacherAfterLeafAuditBudget: leafAudit,
    evidenceProtocolManifest:
      actionAudit && collection.evidenceProtocolManifest
        ? structuredClone(collection.evidenceProtocolManifest)
        : null,
    evidenceSamplingFrame: actionAudit || leafAudit
      ? structuredClone(collection.evidenceSamplingFrame || {
        distribution: leafAudit
          ? "prespecified-stratified"
          : "stratified-training",
        candidateSelection: actionAudit
          ? "mixed-priority-and-blind"
          : "policy-decision-pair"
      })
      : null,
    postmortemReviews: 0
  };
}

export async function collectEvaluatorBootstrap(options) {
  assertEvaluatorBootstrapContinuationLineage(options.continuationLineage);
  const minimumGames = Math.max(100, Number(options.minimumGames) || 100);
  const minimumActionReferences = Math.max(
    50,
    Number(options.minimumActionReferences ?? options.minimumReferences) || 50
  );
  const minimumLeafValuePairs = Math.max(
    50,
    Number(options.minimumLeafValuePairs ?? options.minimumReferences) || 50
  );
  const minimumActionReferenceGames = Math.max(
    20,
    Number(options.minimumActionReferenceGames ?? options.minimumReferenceGames) || 20
  );
  const minimumLeafValueReferenceGames = Math.max(
    20,
    Number(options.minimumLeafValueReferenceGames ?? options.minimumReferenceGames) || 20
  );
  const minimumRepresentativeCalibrationGames = Math.max(
    100,
    Number(options.minimumRepresentativeCalibrationGames) || 100
  );
  const minimumActionReferencesPerDeckSeat = Math.max(
    1,
    Number(options.minimumActionReferencesPerDeckSeat
      ?? options.minimumReferencesPerDeckSeat) || 1
  );
  const minimumLeafValuePairsPerDeckSeat = Math.max(
    1,
    Number(options.minimumLeafValuePairsPerDeckSeat
      ?? options.minimumReferencesPerDeckSeat) || 1
  );
  const invalidRetryLimit = Math.max(1, Number(options.invalidRetryLimit) || 3);
  const baseMaximumGames = Math.max(
    minimumGames,
    Number(options.maximumGames) || 320
  );
  const extensionGames = Math.max(
    40,
    Number(options.extensionGames) || 160
  );
  const maximumTotalGames = Math.max(
    baseMaximumGames,
    Number(options.maximumTotalGames) || 1280
  );
  const continueUntilComplete = options.continueUntilComplete === true;
  const batchGames = Math.max(4, Number(options.batchGames) || 8);
  const detachedActionAuditBoundaryGames = Math.max(
    320,
    Number(options.detachedActionAuditBoundaryGames) || 320
  );
  const datasetKey = evaluatorBootstrapDatasetKey(options);
  const directory = path.join(options.dataRoot, "evaluator-bootstrap", datasetKey);
  let stalledRounds = 0;
  let loaded = await loadEvaluatorBootstrap(directory, datasetKey);
  let allocation = await loadBootstrapAllocation(
    directory,
    datasetKey,
    baseMaximumGames
  );
  const expandedAllocation = nextEvaluatorBootstrapAllocation(
    allocation,
    completedLogicalGames(loaded, invalidRetryLimit),
    {
      extensionGames,
      maximumTotalGames,
      continueUntilComplete
    }
  );
  if (expandedAllocation !== allocation) {
    allocation = expandedAllocation;
    await writeBootstrapAllocation(directory, allocation);
  }
  while (true) {
    const auditOptions = evaluatorBootstrapRuntimeAuditOptions(options, {
      deckIds: options.deckIds,
      evidenceProtocolManifest:
        options.evidenceProtocolManifest
        || options.collection?.evidenceProtocolManifest
        || null,
      evidencePartitionRequirements:
        options.evidencePartitionRequirements || null,
      activeEvidenceRoles: Array.isArray(options.activeEvidenceRoles)
        ? [...options.activeEvidenceRoles]
        : null,
      minimumGames,
      minimumActionReferences,
      minimumLeafValuePairs,
      minimumActionReferenceGames,
      minimumLeafValueReferenceGames,
      minimumRepresentativeCalibrationGames,
      minimumActionReferencesPerDeckSeat,
      minimumLeafValuePairsPerDeckSeat,
      minimumActionReferencesPerPhase:
        EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferencesPerPhase,
      minimumActionReferenceGamesPerPhase:
        EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferenceGamesPerPhase,
      minimumLeafValuePairsPerPhase:
        EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.leafValuePairsPerPhase,
      minimumLeafValueReferenceGamesPerPhase:
        EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.leafValueReferenceGamesPerPhase,
      invalidRetryLimit,
      partitionSeed: `bootstrap-${datasetKey}`
    });
    const audit = summarizeEvaluatorBootstrap(loaded, auditOptions);
    options.onAuditProgress?.({
      datasetKey,
      ...audit,
      allocatedGames: allocation.allocatedGames,
      allocationStatus: allocation.status,
      activeEvidenceRoles: Array.isArray(options.activeEvidenceRoles)
        ? [...options.activeEvidenceRoles]
        : null,
      evidenceCheckpointId:
        options.stopWhenEvidenceCheckpoint?.id || null,
      evidenceStageRoles: Array.isArray(options.stopWhenEvidenceRolesComplete)
        ? [...options.stopWhenEvidenceRolesComplete]
        : null
    });
    const completedLogical = completedLogicalGames(loaded, invalidRetryLimit);
    const detachedActionAuditEnabled = detachedActionAuditIsEnabled(
      completedLogical,
      detachedActionAuditBoundaryGames
    );
    if (allocation.deckSeatSchedule?.version
      !== EVALUATOR_BOOTSTRAP_DECK_SEAT_SCHEDULE) {
      allocation = {
        ...allocation,
        deckSeatSchedule: {
          version: EVALUATOR_BOOTSTRAP_DECK_SEAT_SCHEDULE,
          boundaryGameIndex: completedLogical,
          activatedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      await writeBootstrapAllocation(directory, allocation);
    }
    const deckSeatScheduleBoundaryGameIndex =
      Number(allocation.deckSeatSchedule.boundaryGameIndex);
    if (evaluatorBootstrapEvidenceCheckpointComplete(
      audit,
      options.stopWhenEvidenceCheckpoint
    )) {
      return {
        ...loaded,
        directory,
        datasetKey,
        audit: bootstrapAllocationAudit(
          {
            ...audit,
            evidenceCheckpointComplete: true,
            evidenceCheckpointId:
              options.stopWhenEvidenceCheckpoint?.id || null,
            continuationLineage:
              structuredClone(options.continuationLineage)
          },
          allocation,
          maximumTotalGames,
          extensionGames,
          continueUntilComplete
        )
      };
    }
    if (evaluatorBootstrapEvidenceRolesComplete(
      audit,
      options.stopWhenEvidenceRolesComplete
    )) {
      allocation = {
        ...allocation,
        status: "evidence-stage-complete",
        evidenceStageRoles: [...options.stopWhenEvidenceRolesComplete],
        updatedAt: new Date().toISOString()
      };
      await writeBootstrapAllocation(directory, allocation);
      return {
        ...loaded,
        directory,
        datasetKey,
        audit: bootstrapAllocationAudit(
          {
            ...audit,
            evidenceStageComplete: true,
            evidenceStageRoles: [...options.stopWhenEvidenceRolesComplete],
            continuationLineage:
              structuredClone(options.continuationLineage)
          },
          allocation,
          maximumTotalGames,
          extensionGames,
          continueUntilComplete
        )
      };
    }
    if (audit.complete) {
      allocation = {
        ...allocation,
        status: "complete",
        updatedAt: new Date().toISOString()
      };
      await writeBootstrapAllocation(directory, allocation);
      return {
        ...loaded,
        directory,
        datasetKey,
        audit: bootstrapAllocationAudit(
          {
            ...audit,
            continuationLineage:
              structuredClone(options.continuationLineage)
          },
          allocation,
          maximumTotalGames,
          extensionGames,
          continueUntilComplete
        )
      };
    }
    if (completedLogical >= allocation.allocatedGames) {
      if (continueUntilComplete
        || allocation.allocatedGames < maximumTotalGames) {
        allocation = {
          ...allocation,
          status: "collecting",
          allocatedGames: continueUntilComplete
            ? Number(allocation.allocatedGames) + extensionGames
            : Math.min(
              maximumTotalGames,
              Number(allocation.allocatedGames) + extensionGames
            ),
          expansions: (Number(allocation.expansions) || 0) + 1,
          updatedAt: new Date().toISOString()
        };
        await writeBootstrapAllocation(directory, allocation);
        continue;
      }
      allocation = {
        ...allocation,
        status: "exhausted-incomplete",
        updatedAt: new Date().toISOString()
      };
      await writeBootstrapAllocation(directory, allocation);
      return {
        ...loaded,
        directory,
        datasetKey,
        audit: bootstrapAllocationAudit(
          {
            ...audit,
            continuationLineage:
              structuredClone(options.continuationLineage)
          },
          allocation,
          maximumTotalGames,
          extensionGames,
          continueUntilComplete
        )
      };
    }
    // Keep a deterministic queue longer than the physical process count.
    // The pool asks shouldAssignNext after every persisted game and closes the
    // queue as soon as this evidence role is complete. This removes the
    // 12-game straggler barrier without changing any game coordinate or seed.
    const rollingWindowGames = Math.max(
      Number(options.processes) || 1,
      Number(options.rollingWindowGames)
        || allocation.allocatedGames - completedLogical
    );
    const completedGameIndexes = completedGameIndexMap(
      loaded.records,
      loaded.invalidRecords,
      invalidRetryLimit
    );
    const before = loaded.records.length + loaded.invalidRecords.length;
    const samplingMode = evaluatorBootstrapSamplingMode(
      audit,
      completedLogical,
      batchGames,
      auditOptions
    );
    if (!samplingMode) {
      throw new Error(
        "Evaluator bootstrap is incomplete but has no remaining sampling mode."
      );
    }
    if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
      && allocation.leafRoleSchedule?.version
        !== EVALUATOR_BOOTSTRAP_LEAF_ROLE_SCHEDULE) {
      allocation = {
        ...allocation,
        leafRoleSchedule: {
          version: EVALUATOR_BOOTSTRAP_LEAF_ROLE_SCHEDULE,
          boundaryGameIndex: completedLogical,
          activatedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      await writeBootstrapAllocation(directory, allocation);
    }
    // Detached games already contain every candidate snapshot required for
    // the expensive seed audit. Audit those persisted candidates before
    // collecting another window; otherwise a restart could collect dozens of
    // redundant games while an older pending window was already sufficient.
    if (detachedActionAuditEnabled
      && samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action) {
      const pendingRecords = await pendingDetachedActionAuditRecords(
        loaded.records
      );
      if (pendingRecords.length > 0) {
        const pendingCollectionMode =
          allocation.activeCollectionWindow?.actionCollectionStrategy?.mode
            || "fine";
        const liveRecords = [...loaded.records];
        const liveInvalidRecords = [...loaded.invalidRecords];
        const pendingRole = evaluatorBootstrapActionCertificationRole(
          audit,
          auditOptions
        );
        const detached = await runDetachedActionAuditCoordinator({
          records: pendingRecords,
          directory,
          datasetKey,
          model: options.collection.model,
          league: options.collection.league || [],
          teacherEvaluatorModels:
            options.collection.teacherEvaluatorModels || [],
          teacherEvaluatorMode:
            options.collection.teacherEvaluatorMode
              || "certified-neural-ensemble",
          evidenceProtocolManifest:
            options.collection.evidenceProtocolManifest || null,
          engineFingerprint: options.engineFingerprint,
          processes: Math.max(
            1,
            Number(options.maximumDetachedActionAuditProcesses)
              || Number(options.detachedActionAuditProcesses)
              || Number(options.processes)
              || 1
          ),
          initialProcesses: evaluatorBootstrapActionAuditProcesses(
            Math.max(
              1,
              Number(options.maximumDetachedActionAuditProcesses)
                || Number(options.detachedActionAuditProcesses)
                || Number(options.processes)
                || 1
            ),
            Number(options.detachedActionAuditInitialProcesses)
              || Number(options.processes)
              || 1
          ),
          minimumFreeMemoryBytes: options.minimumFreeMemoryBytes,
          maximumSteps:
            options.collection.teacherActionAuditMaximumSteps || 1200,
          stopRequestPath: options.collection.stopRequestPath || null,
          onProgress: (detachedProgress) => options.onAuditProgress?.({
            datasetKey,
            ...summarizeEvaluatorBootstrap({
              records: liveRecords,
              invalidRecords: liveInvalidRecords
            }, auditOptions),
            allocatedGames: allocation.allocatedGames,
            allocationStatus: allocation.status,
            samplingMode,
            certificationRole: pendingRole,
            actionCollectionStrategy: {
              mode: pendingCollectionMode,
              taskLimit: pendingRecords.length
            },
            detachedActionAudit: detachedProgress,
            workerPool: {
              backend: "child-process-pool",
              completedTasks: 0,
              totalTasks: 0,
              active: [],
              phase: "pending-audit-first"
            }
          }),
          shouldContinueCertificationRole: (role) => {
            if (pendingCollectionMode === "bulk") return true;
            const liveAudit = summarizeEvaluatorBootstrap({
              records: liveRecords,
              invalidRecords: liveInvalidRecords
            }, auditOptions);
            return !evaluatorBootstrapActionRoleGameDemand(
              liveAudit.certificationPartitions?.[role],
              auditOptions,
              role
            ).complete;
          },
          roleChunkGames: Math.max(
            1,
            pendingCollectionMode === "bulk"
              ? Number(
                allocation.activeCollectionWindow
                  ?.actionCollectionStrategy?.bulkGames
              ) || EVALUATOR_BOOTSTRAP_ACTION_BULK_WINDOW_GAMES
              : detachedActionAuditFineRoleChunkGames(
                evaluatorBootstrapActionAuditProcesses(
                  options.processes,
                  options.detachedActionAuditProcesses
                ),
                options.detachedActionAuditRoleChunkGames
              )
          ),
          resolveRoleChunkGames:
            pendingCollectionMode === "bulk"
              ? null
              : ({ role }) => {
                const liveAudit = summarizeEvaluatorBootstrap({
                  records: liveRecords,
                  invalidRecords: liveInvalidRecords
                }, auditOptions);
                return evaluatorBootstrapDetachedActionRoleChunkGames(
                  liveAudit.certificationPartitions?.[role],
                  auditOptions,
                  role,
                  evaluatorBootstrapActionAuditProcesses(
                    options.processes,
                    options.detachedActionAuditProcesses
                  ),
                  options.detachedActionAuditRoleChunkGames
                );
              }
        });
        loaded = await loadEvaluatorBootstrap(directory, datasetKey);
        const completedPendingBatch = completedEvaluatorBootstrapActionBatch(
          allocation.activeCollectionWindow,
          summarizeEvaluatorBootstrap(loaded, auditOptions),
          completedLogicalGames(loaded, invalidRetryLimit),
          auditOptions
        );
        if (completedPendingBatch) {
          allocation = {
            ...allocation,
            lastActionCollectionBatch: completedPendingBatch,
            lastActionBulkBatch: completedPendingBatch.mode === "bulk"
              ? completedPendingBatch
              : allocation.lastActionBulkBatch || null,
            activeCollectionWindow: null,
            updatedAt: new Date().toISOString()
          };
          await writeBootstrapAllocation(directory, allocation);
        }
        if (detached.paused === true) {
          const request = await readEvaluatorBootstrapStopRequest(
            options.collection.stopRequestPath
          );
          allocation = {
            ...allocation,
            status: "paused",
            updatedAt: new Date().toISOString()
          };
          await writeBootstrapAllocation(directory, allocation);
          return {
            ...loaded,
            directory,
            datasetKey,
            audit: bootstrapAllocationAudit({
              ...summarizeEvaluatorBootstrap(loaded, auditOptions),
              paused: true,
              stopRequestedAt: request?.requestedAt || null,
              stopHandoffId: request?.handoffId || null,
              pendingGames: pendingRecords.length,
              continuationLineage:
                structuredClone(options.continuationLineage)
            }, allocation, maximumTotalGames, extensionGames,
            continueUntilComplete)
          };
        }
        // Recompute role/phase demand from the newly committed references
        // before reserving any more games.
        continue;
      }
    }
    const actionBulkWindowGames = Math.max(
      1,
      Math.floor(
        Number(options.actionBulkCollectionGames)
          || EVALUATOR_BOOTSTRAP_ACTION_BULK_WINDOW_GAMES
      )
    );
    const requestedTaskLimit = Math.min(
      detachedActionAuditEnabled
      && samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
        ? Math.max(
          Number(options.processes) || 1,
          Math.min(
            rollingWindowGames,
            Math.max(
              actionBulkWindowGames,
              (Number(options.processes) || 1) * Math.max(
                2,
                Number(options.actionPrefetchPoolWaves) || 4
              )
            )
          )
        )
        : rollingWindowGames,
      allocation.allocatedGames - completedLogical
    );
    const resumableTaskCapacity = evaluatorBootstrapResumeTaskLimit(
      requestedTaskLimit,
      allocation,
      completedLogical,
      samplingMode
    );
    const continuingCollectionWindow =
      allocation.activeCollectionWindow?.version === 1
      && allocation.activeCollectionWindow.samplingMode === samplingMode
      && Number(completedLogical)
        >= Number(allocation.activeCollectionWindow.startCompletedLogical)
      && Number(completedLogical)
        < Number(allocation.activeCollectionWindow.targetCompletedLogical);
    let actionCollectionStrategy = null;
    if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
      && detachedActionAuditEnabled) {
      actionCollectionStrategy = evaluatorBootstrapActionCollectionStrategy(
        audit,
        resumableTaskCapacity,
        {
          ...auditOptions,
          actionBulkCollectionGames: actionBulkWindowGames,
          actionFineCollectionGames:
            Number(options.actionFineCollectionGames) || 1,
          lastActionBulkBatch: allocation.lastActionBulkBatch || null
        }
      );
      const persisted = continuingCollectionWindow
        ? allocation.activeCollectionWindow?.actionCollectionStrategy
        : null;
      if (persisted?.version === 1
        && ["bulk", "fine"].includes(persisted.mode)) {
        const persistedLimit = Math.min(
          resumableTaskCapacity,
          persisted.mode === "bulk"
            ? Math.max(1, Number(persisted.bulkGames) || actionBulkWindowGames)
            : Math.max(1, Number(persisted.fineGames) || 1)
        );
        const rolePlan = evaluatorBootstrapActionCertificationRolePlan(
          audit,
          persistedLimit,
          {
            ...auditOptions,
            fillActionPlanCapacity: persisted.mode === "bulk"
          }
        );
        actionCollectionStrategy = {
          ...actionCollectionStrategy,
          ...persisted,
          taskLimit: rolePlan.roles.length,
          rolePlan
        };
      }
    }
    const taskLimit = actionCollectionStrategy?.taskLimit
      ?? resumableTaskCapacity;
    if (!continuingCollectionWindow) {
      const actionEvidenceSnapshot =
        samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
          ? evaluatorBootstrapActionEvidenceSnapshot(audit, auditOptions)
          : null;
      allocation = {
        ...allocation,
        status: "collecting",
        activeCollectionWindow: {
          version: 1,
          samplingMode,
          startCompletedLogical: completedLogical,
          targetCompletedLogical: completedLogical + taskLimit,
          actionCollectionStrategy: actionCollectionStrategy
            ? {
              version: actionCollectionStrategy.version,
              mode: actionCollectionStrategy.mode,
              bulkGames: actionCollectionStrategy.bulkGames,
              fineGames: actionCollectionStrategy.fineGames,
              previousBulkEvidenceYield:
                actionCollectionStrategy.previousBulkEvidenceYield,
              remainingEvidenceUnits:
                actionCollectionStrategy.remainingEvidenceUnits,
              estimatedGameDemand:
                actionCollectionStrategy.estimatedGameDemand
            }
            : null,
          actionEvidenceSnapshot,
          createdAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      await writeBootstrapAllocation(directory, allocation);
    }
    const modeCollectionOptions = evaluatorBootstrapCollectionOptions(
      samplingMode,
      options.collection
    );
    if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
      && detachedActionAuditEnabled) {
      modeCollectionOptions.detachedIndependentActionAudit = true;
    }
    const actionCertificationRole =
      samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
        ? evaluatorBootstrapActionCertificationRole(audit, auditOptions)
        : null;
    const actionCertificationRolePlan =
      samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
      && detachedActionAuditEnabled
        ? actionCollectionStrategy?.rolePlan
          || evaluatorBootstrapActionCertificationRolePlan(
            audit,
            taskLimit,
            auditOptions
          )
        : null;
    const leafCertificationRole =
      samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
        ? evaluatorBootstrapLeafCertificationRole(audit, auditOptions)
        : null;
    const configuredLeafRolePlanWaves = Number(options.leafRolePlanWaves);
    const leafRolePlanLimit = Number.isFinite(configuredLeafRolePlanWaves)
      && configuredLeafRolePlanWaves > 0
        ? Math.min(
          taskLimit,
          Math.max(
            Number(options.processes) || 1,
            (Number(options.processes) || 1)
              * Math.floor(configuredLeafRolePlanWaves)
          )
        )
        : taskLimit;
    const leafCertificationRolePlan =
      samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
        ? evaluatorBootstrapLeafCertificationRolePlan(
          audit,
          leafRolePlanLimit,
          auditOptions
        )
        : null;
    const certificationRole =
      actionCertificationRole || leafCertificationRole || null;
    const certificationRolePlan =
      actionCertificationRolePlan || leafCertificationRolePlan;
    const certificationRoles = certificationRolePlan?.roles
      || Array.from({ length: taskLimit }, () => certificationRole);
    const certificationFocuses = certificationRolePlan?.focuses
      || Array.from({ length: certificationRoles.length }, () => null);
    // A rolling window is only a capacity ceiling. Do not pad a short
    // evidence-demand plan with extra games: those filler games used to keep
    // auditing a partition after its remaining reference/stratum gap was
    // already covered.
    const scheduledTaskLimit = certificationRolePlan
      ? certificationRoles.length
      : taskLimit;
    const roleDiagnosticFocus = Object.fromEntries(
      [...new Set(certificationRoles.filter(Boolean))].map((role) => [
        role,
        evaluatorBootstrapDiagnosticFocus(
          options.diagnosticDemand,
          role,
          samplingMode
        )
      ])
    );
    const roleDeckCurricula = Object.fromEntries(
      [...new Set(certificationRoles.filter(Boolean))].map((role) => {
        const partition = audit.certificationPartitions?.[role];
        const missingCoverage =
          samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
            ? [
              ...(partition?.missingStructuredV2ActionReferenceCoverage || []),
              ...(partition?.missingActionReferenceCoverage || []),
              ...deckPhaseFocusCoverage(
                partition?.missingStructuredV2ActionReferenceDeckPhaseCoverage
                  || []
              ),
              ...deckPhaseFocusCoverage(
                partition?.missingActionReferenceDeckPhaseCoverage || []
              )
            ]
            : [
              ...(partition?.missingStructuredV2LeafValueCoverage || []),
              ...(partition?.missingLeafValueCoverage || []),
              ...deckPhaseFocusCoverage(
                partition?.missingStructuredV2LeafValueDeckPhaseCoverage || []
              ),
              ...deckPhaseFocusCoverage(
                partition?.missingLeafValueDeckPhaseCoverage || []
              )
            ];
        const focusDeckSeats = evaluatorBootstrapFocusDeckSeats(
          missingCoverage
        );
        const focusDeckIds = Object.keys(focusDeckSeats);
        return [role, focusDeckIds.length
          ? {
            focusDeckIds,
            focusDeckSeats,
            focusFraction: 0.75,
            reason:
              `evaluator-bootstrap-missing-${samplingMode}`
              + `-${role}-deck-seat-or-diagnostic-focus`
          }
          : options.collection.deckCurriculum || null];
      })
    );
    const rolePhaseFocus = Object.fromEntries(
      [...new Set(certificationRoles.filter(Boolean))].map((role) => [
        role,
        prioritizedMissingAuditPhaseBands([
          ...(samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
            ? [
              ...(audit.certificationPartitions?.[role]
                ?.missingStructuredV2ActionReferencePhaseCoverage || []),
              ...(audit.certificationPartitions?.[role]
                ?.missingActionReferencePhaseCoverage || [])
            ]
            : [
              ...(audit.certificationPartitions?.[role]
                ?.missingStructuredV2LeafValuePhaseCoverage || []),
              ...(audit.certificationPartitions?.[role]
                ?.missingLeafValuePhaseCoverage || [])
            ]),
          ...deckPhaseFocusBands(
            samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
              ? [
                ...(audit.certificationPartitions?.[role]
                  ?.missingStructuredV2ActionReferenceDeckPhaseCoverage || []),
                ...(audit.certificationPartitions?.[role]
                  ?.missingActionReferenceDeckPhaseCoverage || [])
              ]
              : [
                ...(audit.certificationPartitions?.[role]
                  ?.missingStructuredV2LeafValueDeckPhaseCoverage || []),
                ...(audit.certificationPartitions?.[role]
                  ?.missingLeafValueDeckPhaseCoverage || [])
              ]
          )
        ])
      ])
    );
    const actionRoleActionClassFocus = Object.fromEntries(
      [...new Set(certificationRoles.filter(Boolean))].map((role) => [
        role,
        [...new Set([
          ...(audit.certificationPartitions?.[role]
            ?.missingStructuredV2ActionReferenceActionClassCoverage || []),
          ...(audit.certificationPartitions?.[role]
            ?.missingActionReferenceActionClassCoverage || [])
        ])]
      ])
    );
    if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action) {
      modeCollectionOptions.teacherActionAuditFocusPhaseBands =
        rolePhaseFocus[actionCertificationRole] || [];
      modeCollectionOptions.teacherActionAuditFocusActionClasses =
        actionRoleActionClassFocus[actionCertificationRole] || [];
    } else if (samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf) {
      modeCollectionOptions.teacherLeafAuditFocusPhaseBands =
        rolePhaseFocus[leafCertificationRole] || [];
    }
    const missingFocusCoverage =
      samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
        ? [
          ...(audit.certificationPartitions?.[actionCertificationRole]
            ?.missingStructuredV2ActionReferenceCoverage || []),
          ...(audit.certificationPartitions?.[actionCertificationRole]
            ?.missingActionReferenceCoverage || []),
          ...deckPhaseFocusCoverage(
            audit.certificationPartitions?.[actionCertificationRole]
              ?.missingStructuredV2ActionReferenceDeckPhaseCoverage || []
          ),
          ...deckPhaseFocusCoverage(
            audit.certificationPartitions?.[actionCertificationRole]
              ?.missingActionReferenceDeckPhaseCoverage || []
          )
        ]
        : samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
          ? [
            ...(audit.certificationPartitions?.[leafCertificationRole]
              ?.missingStructuredV2LeafValueCoverage || []),
            ...(audit.certificationPartitions?.[leafCertificationRole]
              ?.missingLeafValueCoverage || []),
            ...deckPhaseFocusCoverage(
              audit.certificationPartitions?.[leafCertificationRole]
                ?.missingStructuredV2LeafValueDeckPhaseCoverage || []
            ),
            ...deckPhaseFocusCoverage(
              audit.certificationPartitions?.[leafCertificationRole]
                ?.missingLeafValueDeckPhaseCoverage || []
            )
          ]
          : [];
    const missingFocusDeckSeats =
      evaluatorBootstrapFocusDeckSeats(missingFocusCoverage);
    const missingFocusDeckIds = Object.keys(missingFocusDeckSeats);
    const liveRecords = [...loaded.records];
    const liveInvalidRecords = [...loaded.invalidRecords];
    const detachedAuditRecords =
      detachedActionAuditEnabled
      && samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
        ? await pendingDetachedActionAuditRecords(loaded.records)
        : [];
    const hasDiagnosticTaskFocus = Object.values(roleDiagnosticFocus).some(
      (focus) => (focus?.items || []).length > 0
    );
    let liveWorkerPool = null;
    const collected = await collectProcessPoolSelfPlay({
      ...options.collection,
      ...modeCollectionOptions,
      games: allocation.allocatedGames,
      workers: options.workers,
      processes: options.processes,
      // The memory-isolation preflight supplies the safe initial pool while
      // this separate ceiling preserves spare CPU capacity for long leaf
      // audits. The process pool grows only after repeated healthy-memory
      // samples and retires workers after their current game under pressure.
      maximumProcesses: Math.max(
        1,
        Number(options.maximumSelfPlayProcesses)
          || Number(options.processes)
          || 1
      ),
      dynamicScaling: options.dynamicSelfPlayScaling !== false,
      dynamicScaleIntervalMs: options.dynamicSelfPlayScaleIntervalMs,
      dynamicScaleHealthySamples:
        options.dynamicSelfPlayScaleHealthySamples,
      dynamicWorkerHeadroomBytes:
        options.dynamicSelfPlayWorkerHeadroomBytes,
      taskLimit: scheduledTaskLimit,
      completedGameIndexes,
      deckSeatScheduleVersion: EVALUATOR_BOOTSTRAP_DECK_SEAT_SCHEDULE,
      deckSeatScheduleBoundaryGameIndex,
      deckCurriculum: missingFocusDeckIds.length
        ? {
          focusDeckIds: missingFocusDeckIds,
          focusDeckSeats: missingFocusDeckSeats,
          focusFraction: 0.75,
          reason:
            `evaluator-bootstrap-missing-${samplingMode}-deck-seat-coverage`
        }
        : options.collection.deckCurriculum || null,
      captureReplays: false,
      retainResults: false,
      streamResultHandoff: true,
      resultHandoff: {
        kind: "evaluator-bootstrap",
        datasetKey,
        samplingMode,
        certificationRole
      },
      resolveTaskOptions:
        certificationRolePlan || hasDiagnosticTaskFocus
          ? ({ taskIndex }) => {
            const taskCertificationRole =
              certificationRoles[taskIndex] || certificationRole;
            const taskFocus = certificationFocuses[taskIndex] || null;
            const diagnosticFocus = evaluatorBootstrapDiagnosticTaskFocus(
              roleDiagnosticFocus[taskCertificationRole],
              taskIndex
            );
            const naturalDistributionTask =
              diagnosticFocus
                ? diagnosticFocus.auditDistribution === "natural-distribution"
                : taskFocus?.naturalDistribution === true;
            const samplingFrameBase = {
              version: 1,
              contract: "leaf-audit-sampling-frame-v1",
              datasetKey,
              taskIndex,
              certificationRole: taskCertificationRole,
              distribution: naturalDistributionTask
                ? "natural-distribution"
                : "prespecified-stratified",
              scope:
                options.collection.evidenceProtocolManifest?.scope || null,
              candidateSelection: naturalDistributionTask
                ? "hash-priority-reservoir-policy-decision-v1"
                : "teacher-selected-policy-decision-pair-v1",
              selectionProbability: null,
              targeted: !naturalDistributionTask
            };
            const samplingTaskManifestHash = createHash("sha256")
              .update(JSON.stringify(samplingFrameBase))
              .digest("hex");
            const [diagnosticDeckId, diagnosticSeat] = String(
              diagnosticFocus?.deckSeat || ""
            ).split(":");
            const [taskFocusDeckId, taskFocusSeat] = String(
              taskFocus?.deckSeat || ""
            ).split(":");
            const diagnosticDeckCurriculum = diagnosticDeckId
              && ["p1", "p2"].includes(diagnosticSeat)
                ? {
                  focusDeckIds: [diagnosticDeckId],
                  focusDeckSeats: {
                    [diagnosticDeckId]: [diagnosticSeat]
                  },
                  focusFraction: 1,
                  reason:
                    `evaluator-bootstrap-${samplingMode}`
                    + `-${taskCertificationRole}-diagnostic-atomic-focus`
                }
                : null;
            const taskDeckCurriculum = diagnosticDeckCurriculum
              || (taskFocusDeckId && ["p1", "p2"].includes(taskFocusSeat)
              ? {
                focusDeckIds: [taskFocusDeckId],
                focusDeckSeats: {
                  [taskFocusDeckId]: [taskFocusSeat]
                },
                focusFraction: 1,
                reason:
                  `evaluator-bootstrap-${samplingMode}`
                  + `-${taskCertificationRole}-v2-atomic-deck-seat-focus`
              }
              : taskFocus?.deckId
              ? {
                focusDeckIds: [taskFocus.deckId],
                focusDeckSeats: {
                  [taskFocus.deckId]: ["p1", "p2"]
                },
                focusFraction: 1,
                reason:
                  `evaluator-bootstrap-${samplingMode}`
                  + `-${taskCertificationRole}-${taskFocus.deckPhaseKey}`
              }
              : roleDeckCurricula[taskCertificationRole]
                ?? options.collection.deckCurriculum
                ?? null);
            return {
              optionOverrides: {
                deckCurriculum: taskDeckCurriculum,
                teacherActionAuditFocusPhaseBands:
                  samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
                    ? diagnosticFocus?.phaseBand
                      ? [diagnosticFocus.phaseBand]
                      : taskFocus?.phaseBand
                        ? [taskFocus.phaseBand]
                      : rolePhaseFocus[taskCertificationRole] || []
                    : [],
                teacherActionAuditFocusActionClasses:
                  samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
                    ? diagnosticFocus?.actionClass
                      ? [diagnosticFocus.actionClass]
                      : taskFocus?.actionClass
                        ? [taskFocus.actionClass]
                      : actionRoleActionClassFocus[taskCertificationRole] || []
                    : [],
                teacherLeafAuditFocusPhaseBands:
                  samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
                    ? diagnosticFocus?.phaseBand
                      ? [diagnosticFocus.phaseBand]
                      : taskFocus?.phaseBand
                      ? [taskFocus.phaseBand]
                      : rolePhaseFocus[taskCertificationRole] || []
                    : [],
                ...(samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
                  && naturalDistributionTask
                  ? { teacherLeafAuditPairBudget: 1 }
                  : {}),
                evidenceSamplingFrame:
                  samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
                    || samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
                    ? samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
                      ? {
                        ...samplingFrameBase,
                        taskManifestHash: samplingTaskManifestHash
                      }
                      : {
                        distribution: "prespecified-stratified",
                        certificationRole: taskCertificationRole,
                        scope:
                          options.collection.evidenceProtocolManifest?.scope
                          || null,
                        candidateSelection:
                          "mixed-priority-and-evaluator-blind",
                        targeted: true
                      }
                    : null,
                resultHandoff: {
                  kind: "evaluator-bootstrap",
                  datasetKey,
                  samplingMode,
                  certificationRole: taskCertificationRole
                }
              },
              taskContext: {
                samplingMode,
                certificationRole: taskCertificationRole,
                auditFocus: taskFocus,
                diagnosticFocus,
                prefetched:
                  taskCertificationRole !== certificationRole
              }
            };
          }
          : null,
      maximumGamesPerProcess: Math.max(
        1,
        Number(options.maximumGamesPerProcess) || 4
      ),
      maximumWorkerRssBytes: Math.max(
        256 * 1024 * 1024,
        Number(options.maximumWorkerRssBytes)
          || Math.round(1.2 * 1024 * 1024 * 1024)
      ),
      maximumTaskRetries: Math.max(
        0,
        Number.isFinite(Number(options.maximumTaskRetries))
          ? Number(options.maximumTaskRetries)
          : 2
      ),
      minimumFreeMemoryBytes: Math.max(
        0,
        Number.isFinite(Number(options.minimumFreeMemoryBytes))
          ? Number(options.minimumFreeMemoryBytes)
          : 4 * 1024 * 1024 * 1024
      ),
      shouldAssignNext: ({ assignedTasks }) => {
        if (actionCollectionStrategy?.mode === "bulk") return true;
        const liveAudit = summarizeEvaluatorBootstrap({
          records: liveRecords,
          invalidRecords: liveInvalidRecords
        }, auditOptions);
        const keepAssigning = evaluatorBootstrapSamplingModeNeedsWork(
          samplingMode,
          liveAudit,
          auditOptions
        );
        const nextCertificationRole =
          certificationRoles[assignedTasks] || certificationRole;
        const targetRoleStillNeedsWork =
          samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
            ? !evaluatorBootstrapActionRoleGameDemand(
              liveAudit.certificationPartitions?.[nextCertificationRole],
              auditOptions,
              nextCertificationRole
            ).complete
            : samplingMode === EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
              ? !evaluatorBootstrapLeafRoleGameDemand(
                liveAudit.certificationPartitions?.[nextCertificationRole],
                auditOptions,
                nextCertificationRole
              ).complete
              : true;
        return keepAssigning && targetRoleStillNeedsWork
          ? true
          : {
            continue: false,
            reason: `${samplingMode}-evidence-target-satisfied`
          };
      },
      onWorkerHeartbeat: (workerPool) => {
        liveWorkerPool = workerPool;
        options.onAuditProgress?.({
          datasetKey,
          ...summarizeEvaluatorBootstrap({
            records: liveRecords,
            invalidRecords: liveInvalidRecords
          }, auditOptions),
          allocatedGames: allocation.allocatedGames,
          allocationStatus: allocation.status,
          samplingMode,
          certificationRole,
          certificationRolePlan:
            certificationRolePlan?.allocations || null,
          actionCollectionStrategy: actionCollectionStrategy
            ? {
              mode: actionCollectionStrategy.mode,
              taskLimit: actionCollectionStrategy.taskLimit,
              remainingEvidenceUnits:
                actionCollectionStrategy.remainingEvidenceUnits,
              previousBulkEvidenceYield:
                actionCollectionStrategy.previousBulkEvidenceYield
            }
            : null,
          workerPool
        });
      },
      onTaskRetry: (retry) => {
        options.onAuditProgress?.({
          datasetKey,
          ...summarizeEvaluatorBootstrap({
            records: liveRecords,
            invalidRecords: liveInvalidRecords
          }, auditOptions),
          allocatedGames: allocation.allocatedGames,
          allocationStatus: allocation.status,
          samplingMode,
          certificationRole,
          certificationRolePlan:
            certificationRolePlan?.allocations || null,
          workerPool: liveWorkerPool,
          taskRetry: retry
        });
      },
      onGameHandoff: async (game) => {
        const summary = game.resultSummary;
        const expectedCertificationRole =
          game.taskContext?.certificationRole
          ?? certificationRole
          ?? null;
        const accepted = summary?.version === 1
          && summary.kind === "evaluator-bootstrap"
          && summary.datasetKey === datasetKey
          && Number(summary.workerIndex) === Number(game.workerIndex)
          && Number(summary.gameIndex) === Number(game.gameIndex)
          && summary.samplingMode === samplingMode
          && (summary.certificationRole || null)
            === expectedCertificationRole
          && validEvaluatorBootstrapResultIndex(summary.resultIndex)
          && summary.resultIndex.valid === true;
        if (!accepted) {
          const invalidIdentity =
            `worker-${game.workerIndex}-game-${game.gameIndex}-${Date.now()}`;
          const archivePath = path.join(
            directory,
            "invalid",
            `${invalidIdentity}.json.gz`
          );
          const summaryPath = path.join(
            directory,
            "invalid",
            `${invalidIdentity}.summary.json`
          );
          await adoptSelfPlayResultHandoff(
            game.resultHandoff,
            archivePath,
            summaryPath
          );
          liveInvalidRecords.push({
            version: 2,
            datasetKey,
            workerIndex: game.workerIndex,
            gameIndex: game.gameIndex,
            samplingMode,
            certificationRole: expectedCertificationRole,
            deckSeatScheduleVersion:
              EVALUATOR_BOOTSTRAP_DECK_SEAT_SCHEDULE,
            deckSeatScheduleBoundaryGameIndex,
            archivePath,
            summaryPath,
            resultIndex: summary?.resultIndex || null
          });
          options.onAuditProgress?.({
            datasetKey,
            ...summarizeEvaluatorBootstrap({
              records: liveRecords,
              invalidRecords: liveInvalidRecords
            }, auditOptions),
            allocatedGames: allocation.allocatedGames,
            allocationStatus: allocation.status,
            samplingMode,
            certificationRole,
            certificationRolePlan:
              certificationRolePlan?.allocations || null,
            workerPool: liveWorkerPool
          });
          return;
        }
        const identity =
          `worker-${String(game.workerIndex).padStart(3, "0")}`
          + `-game-${String(game.gameIndex).padStart(5, "0")}`;
        const archivePath = path.join(directory, `${identity}.json.gz`);
        const summaryPath = path.join(directory, `${identity}.summary.json`);
        await adoptSelfPlayResultHandoff(
          game.resultHandoff,
          archivePath,
          summaryPath
        );
        const record = {
          version: 2,
          datasetKey,
          workerIndex: game.workerIndex,
          gameIndex: game.gameIndex,
          samplingMode,
          certificationRole: expectedCertificationRole,
          deckSeatScheduleVersion:
            EVALUATOR_BOOTSTRAP_DECK_SEAT_SCHEDULE,
          deckSeatScheduleBoundaryGameIndex,
          archivePath,
          summaryPath,
          resultIndex: summary.resultIndex
        };
        liveRecords.push(record);
        if (modeCollectionOptions.detachedIndependentActionAudit === true) {
          detachedAuditRecords.push(record);
        }
        options.onAuditProgress?.({
          datasetKey,
          ...summarizeEvaluatorBootstrap({
            records: liveRecords,
            invalidRecords: liveInvalidRecords
          }, auditOptions),
          allocatedGames: allocation.allocatedGames,
          allocationStatus: allocation.status,
          samplingMode,
          certificationRole,
          certificationRolePlan:
            certificationRolePlan?.allocations || null,
          workerPool: liveWorkerPool
        });
      },
      loadCollectedResults: async () => {
        const current = await loadEvaluatorBootstrap(directory, datasetKey);
        return {
          trajectories: [],
          summaries: [],
          deckLearning: {},
          workerStats: {
            backend: "evaluator-bootstrap",
            acceptedGames: current.records.length
          }
        };
      }
    });
    // The detached coordinator starts only after the game pool has drained.
    // Keep a terminal game-pool snapshot so audit heartbeats cannot carry a
    // stale final worker PID forward.
    liveWorkerPool = {
      ...(liveWorkerPool || {
        backend: "child-process-pool",
        totalTasks: scheduledTaskLimit
      }),
      completedTasks: Math.max(
        Number(liveWorkerPool?.completedTasks) || 0,
        Number(collected.workerStats?.collectedGames) || 0
      ),
      active: [],
      phase: collected.workerStats?.stoppedAtGameBoundary === true
        ? "collection-paused"
        : "collection-complete"
    };
    let detachedAuditResult = null;
    if (detachedAuditRecords.length > 0) {
      detachedAuditResult = await runDetachedActionAuditCoordinator({
        records: detachedAuditRecords,
        directory,
        datasetKey,
        model: options.collection.model,
        league: options.collection.league || [],
        teacherEvaluatorModels:
          options.collection.teacherEvaluatorModels || [],
        teacherEvaluatorMode:
          options.collection.teacherEvaluatorMode
            || "certified-neural-ensemble",
        evidenceProtocolManifest:
          options.collection.evidenceProtocolManifest || null,
        engineFingerprint: options.engineFingerprint,
        processes: Math.max(
          1,
          Number(options.maximumDetachedActionAuditProcesses)
            || Number(options.detachedActionAuditProcesses)
            || Number(options.processes)
            || 1
        ),
        initialProcesses: evaluatorBootstrapActionAuditProcesses(
          Math.max(
            1,
            Number(options.maximumDetachedActionAuditProcesses)
              || Number(options.detachedActionAuditProcesses)
              || Number(options.processes)
              || 1
          ),
          Number(options.detachedActionAuditInitialProcesses)
            || Number(options.processes)
            || 1
        ),
        minimumFreeMemoryBytes: options.minimumFreeMemoryBytes,
        maximumSteps:
          options.collection.teacherActionAuditMaximumSteps || 1200,
        stopRequestPath: options.collection.stopRequestPath || null,
        onProgress: (detached) => options.onAuditProgress?.({
          datasetKey,
          ...summarizeEvaluatorBootstrap({
            records: liveRecords,
            invalidRecords: liveInvalidRecords
          }, auditOptions),
          allocatedGames: allocation.allocatedGames,
          allocationStatus: allocation.status,
          samplingMode,
          certificationRole: actionCertificationRole,
          certificationRolePlan:
            actionCertificationRolePlan?.allocations || null,
          actionCollectionStrategy: actionCollectionStrategy
            ? {
              mode: actionCollectionStrategy.mode,
              taskLimit: actionCollectionStrategy.taskLimit,
              remainingEvidenceUnits:
                actionCollectionStrategy.remainingEvidenceUnits,
              previousBulkEvidenceYield:
                actionCollectionStrategy.previousBulkEvidenceYield
            }
            : null,
          detachedActionAudit: detached,
          workerPool: liveWorkerPool
        }),
        shouldContinueCertificationRole: (role) => {
          if (actionCollectionStrategy?.mode === "bulk") return true;
          const liveAudit = summarizeEvaluatorBootstrap({
            records: liveRecords,
            invalidRecords: liveInvalidRecords
          }, auditOptions);
          return !evaluatorBootstrapActionRoleGameDemand(
            liveAudit.certificationPartitions?.[role],
            auditOptions,
            role
          ).complete;
        },
        roleChunkGames: Math.max(
          1,
          actionCollectionStrategy?.mode === "bulk"
            ? actionCollectionStrategy.bulkGames
            : detachedActionAuditFineRoleChunkGames(
              evaluatorBootstrapActionAuditProcesses(
                options.processes,
                options.detachedActionAuditProcesses
              ),
              options.detachedActionAuditRoleChunkGames
            )
        ),
        resolveRoleChunkGames:
          actionCollectionStrategy?.mode === "bulk"
            ? null
            : ({ role }) => {
              const liveAudit = summarizeEvaluatorBootstrap({
                records: liveRecords,
                invalidRecords: liveInvalidRecords
              }, auditOptions);
              return evaluatorBootstrapDetachedActionRoleChunkGames(
                liveAudit.certificationPartitions?.[role],
                auditOptions,
                role,
                evaluatorBootstrapActionAuditProcesses(
                  options.processes,
                  options.detachedActionAuditProcesses
                ),
                options.detachedActionAuditRoleChunkGames
              );
            }
      });
    }
    loaded = await loadEvaluatorBootstrap(directory, datasetKey);
    const collectionPaused =
      collected.workerStats?.stoppedAtGameBoundary === true
      || detachedAuditResult?.paused === true;
    const completedActionBatch = collectionPaused
      ? null
      : completedEvaluatorBootstrapActionBatch(
        allocation.activeCollectionWindow,
        summarizeEvaluatorBootstrap(loaded, auditOptions),
        completedLogicalGames(loaded, invalidRetryLimit),
        auditOptions
      );
    allocation = {
      ...allocation,
      status: collectionPaused
        ? "paused"
        : "collecting",
      lastActionCollectionBatch:
        completedActionBatch || allocation.lastActionCollectionBatch || null,
      lastActionBulkBatch: completedActionBatch?.mode === "bulk"
        ? completedActionBatch
        : allocation.lastActionBulkBatch || null,
      activeCollectionWindow: collectionPaused
        ? allocation.activeCollectionWindow
        : null,
      updatedAt: new Date().toISOString()
    };
    await writeBootstrapAllocation(directory, allocation);
    if (collected.workerStats?.stoppedAtGameBoundary === true) {
      const pausedAudit = summarizeEvaluatorBootstrap(loaded, auditOptions);
      return {
        ...loaded,
        directory,
        datasetKey,
        audit: bootstrapAllocationAudit({
          ...pausedAudit,
          paused: true,
          stopRequestedAt: collected.workerStats.stopRequestedAt || null,
          stopHandoffId: collected.workerStats.stopHandoffId || null,
          pendingGames: collected.workerStats.pendingTasks,
          continuationLineage:
            structuredClone(options.continuationLineage)
        }, allocation, maximumTotalGames, extensionGames,
        continueUntilComplete)
      };
    }
    stalledRounds = loaded.records.length + loaded.invalidRecords.length === before
      ? stalledRounds + 1
      : 0;
    if (stalledRounds >= 3) {
      throw new Error(
        "Evaluator bootstrap could not produce a valid game after three consecutive batches."
      );
    }
  }
}

export function nextEvaluatorBootstrapAllocation(
  allocation,
  completedLogical,
  options = {}
) {
  const extensionGames = Math.max(40, Number(options.extensionGames) || 160);
  const maximumTotalGames = Math.max(
    Number(allocation?.allocatedGames) || 0,
    Number(options.maximumTotalGames) || 1280
  );
  const continueUntilComplete = options.continueUntilComplete === true;
  if (allocation?.status !== "exhausted-incomplete"
    || Number(completedLogical) < Number(allocation?.allocatedGames)
    || (!continueUntilComplete
      && Number(allocation?.allocatedGames) >= maximumTotalGames)) {
    return allocation;
  }
  return {
    ...allocation,
    status: "collecting",
    allocatedGames: continueUntilComplete
      ? Number(allocation.allocatedGames) + extensionGames
      : Math.min(
        maximumTotalGames,
        Number(allocation.allocatedGames) + extensionGames
      ),
    expansions: (Number(allocation.expansions) || 0) + 1,
    updatedAt: new Date().toISOString()
  };
}

function bootstrapAllocationAudit(
  audit,
  allocation,
  maximumTotalGames,
  extensionGames,
  continueUntilComplete = false
) {
  const canExtend = continueUntilComplete
    || allocation.allocatedGames < maximumTotalGames;
  return {
    ...audit,
    allocation: {
      version: 1,
      status: allocation.status,
      allocatedGames: allocation.allocatedGames,
      expansions: Number(allocation.expansions) || 0,
      maximumTotalGames: continueUntilComplete ? null : maximumTotalGames,
      continueUntilComplete,
      deckSeatSchedule: allocation.deckSeatSchedule || null,
      leafRoleSchedule: allocation.leafRoleSchedule || null,
      canExtend,
      nextExtensionGames: canExtend
        ? (continueUntilComplete
          ? extensionGames
          : Math.min(
            extensionGames,
            maximumTotalGames - allocation.allocatedGames
          ))
        : 0
    }
  };
}

export function summarizeEvaluatorBootstrap(dataset, options = {}) {
  const records = dataset?.records || [];
  let actionReferenceCount = 0;
  let leafValuePairCount = 0;
  let structuredV2ActionReferenceCount = 0;
  let structuredV2LeafValuePairCount = 0;
  const actionReferenceGames = new Set();
  const leafValueReferenceGames = new Set();
  const structuredV2ActionReferenceGames = new Set();
  const structuredV2LeafValueReferenceGames = new Set();
  const gameCoverage = {};
  const actionReferenceCoverage = {};
  const leafValueCoverage = {};
  const actionReferencePhaseCoverage = {};
  const actionReferenceActionClassCoverage = {};
  const leafValuePhaseCoverage = {};
  const actionReferenceDeckPhaseCoverage = {};
  const leafValueDeckPhaseCoverage = {};
  const structuredV2ActionReferenceCoverage = {};
  const structuredV2ActionReferencePhaseCoverage = {};
  const structuredV2ActionReferenceActionClassCoverage = {};
  const structuredV2ActionReferenceDeckPhaseCoverage = {};
  const structuredV2LeafValueCoverage = {};
  const structuredV2LeafValuePhaseCoverage = {};
  const structuredV2LeafValueDeckPhaseCoverage = {};
  const actionReferencePhaseGames = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, new Set()])
  );
  const leafValuePhaseGames = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, new Set()])
  );
  const structuredV2ActionReferencePhaseGames = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, new Set()])
  );
  const structuredV2LeafValuePhaseGames = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, new Set()])
  );
  const actionReferenceActionClassGames = Object.fromEntries(
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map(
      (actionClass) => [actionClass, new Set()]
    )
  );
  const actionReferenceDeckPhaseGames = {};
  const leafValueDeckPhaseGames = {};
  const structuredV2ActionReferenceActionClassGames = Object.fromEntries(
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map(
      (actionClass) => [actionClass, new Set()]
    )
  );
  const structuredV2ActionReferenceDeckPhaseGames = {};
  const structuredV2LeafValueDeckPhaseGames = {};
  const seenActionReferences = new Set();
  const actionEvidenceGradeCounts = {};
  const actionEvidenceStatisticalStrengthCounts = {};
  const actionEvidenceContinuationScopeCounts = {};
  const actionEvidenceDispositionCounts = {};
  const actionEvidenceProvenanceStatusCounts = {};
  const actionEvidencePairwiseRegretAccumulator =
    createActionEvidencePairwiseRegretAccumulator();
  const actionEvidenceOpeningStates = new Set();
  const actionEvidenceOpeningStatesByGrade = {};
  const naturalDistributionActionAuditAccumulator =
    createNaturalDistributionAuditAccumulator();
  const leafActionEffectAuditAccumulator =
    createLeafActionEffectAuditSummaryAccumulator();
  const actionEvidenceComputeUsage = {
    cpuMilliseconds: 0,
    gpuMilliseconds: 0,
    wallMilliseconds: 0
  };
  const actionAuditRacing = {
    discovered: 0,
    pilotAttempted: 0,
    expandedTo16: 0,
    expandedTo32: 0,
    finalAttempted: 0,
    pairedSeedsCompleted: 0,
    teacherQueries: 0,
    candidatePoolChanges: 0,
    queriesSuppressed: 0,
    references: 0
  };
  let logicalGames = 0;
  let physicalGames = 0;
  for (const record of records) {
    const index = validEvaluatorBootstrapResultIndex(record.resultIndex)
      ? record.resultIndex
      : createEvaluatorBootstrapResultIndex(record.result);
    mergeNumericCounts(gameCoverage, index.gameCoverage);
    mergeNumericCounts(leafValueCoverage, index.leafValueCoverage);
    mergeNumericCounts(leafValuePhaseCoverage, index.leafValuePhaseCoverage);
    mergeNumericCounts(
      leafValueDeckPhaseCoverage,
      index.leafValueDeckPhaseCoverage
    );
    mergeNumericCounts(
      structuredV2LeafValueCoverage,
      index.structuredV2LeafValueCoverage
    );
    mergeNumericCounts(
      structuredV2LeafValuePhaseCoverage,
      index.structuredV2LeafValuePhaseCoverage
    );
    mergeNumericCounts(
      structuredV2LeafValueDeckPhaseCoverage,
      index.structuredV2LeafValueDeckPhaseCoverage
    );
    leafValuePairCount += Number(index.leafValuePairCount) || 0;
    structuredV2LeafValuePairCount +=
      Number(index.structuredV2LeafValuePairCount) || 0;
    logicalGames += Math.max(1, Number(index.logicalGames) || 1);
    physicalGames += Math.max(1, Number(index.physicalGames) || 1);
    for (const key of Object.keys(actionAuditRacing)) {
      actionAuditRacing[key] +=
        Number(index.actionAuditRacing?.[key]) || 0;
    }
    mergeNaturalDistributionAuditAccumulator(
      naturalDistributionActionAuditAccumulator,
      index.naturalDistributionActionAudit
    );
    mergeLeafActionEffectAuditSummary(
      leafActionEffectAuditAccumulator,
      index.leafActionEffectAudit
    );
    actionEvidenceComputeUsage.cpuMilliseconds += Math.max(
      0,
      Number(index.actionEvidenceComputeEfficiency?.cpuSeconds) || 0
    ) * 1000;
    actionEvidenceComputeUsage.gpuMilliseconds += Math.max(
      0,
      Number(index.actionEvidenceComputeEfficiency?.gpuSeconds) || 0
    ) * 1000;
    actionEvidenceComputeUsage.wallMilliseconds += Math.max(
      0,
      Number(index.actionEvidenceComputeEfficiency?.wallSeconds) || 0
    ) * 1000;
    let gameHasActionReference = false;
    let gameHasStructuredV2ActionReference = false;
    const gameKey = `${record.workerIndex}:${record.gameIndex}`;
    const structuredV2ActionIdentities = new Set(
      index.structuredV2ActionReferenceIdentities || []
    );
    for (const item of index.actionReferenceIdentities || []) {
      if (!item?.identity || seenActionReferences.has(item.identity)) continue;
      seenActionReferences.add(item.identity);
      actionReferenceCount += 1;
      const evidenceGrade = item.evidenceGrade
        || ACTION_EVIDENCE_GRADES.legacyTerminalConditioned;
      const assessment = item.evidenceAssessment || {};
      const statisticalStrength = assessment.statisticalStrength
        || item.statisticalStrength
        || "unknown";
      const continuationScope = assessment.continuationScope
        || item.continuationScope
        || "unknown";
      const disposition = assessment.disposition
        || item.disposition
        || "inconclusive";
      const provenanceStatus = assessment.provenanceStatus
        || item.provenanceStatus
        || "unknown";
      actionEvidenceStatisticalStrengthCounts[statisticalStrength] =
        (actionEvidenceStatisticalStrengthCounts[statisticalStrength] || 0) + 1;
      actionEvidenceContinuationScopeCounts[continuationScope] =
        (actionEvidenceContinuationScopeCounts[continuationScope] || 0) + 1;
      actionEvidenceDispositionCounts[disposition] =
        (actionEvidenceDispositionCounts[disposition] || 0) + 1;
      actionEvidenceProvenanceStatusCounts[provenanceStatus] =
        (actionEvidenceProvenanceStatusCounts[provenanceStatus] || 0) + 1;
      accumulateActionEvidencePairwiseRegret(
        actionEvidencePairwiseRegretAccumulator,
        assessment,
        item.phaseBand
      );
      if (item.inProtocolScope !== false) {
        actionEvidenceGradeCounts[evidenceGrade] =
          (actionEvidenceGradeCounts[evidenceGrade] || 0) + 1;
        if ([
          ACTION_EVIDENCE_GRADES.terminalRobust,
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ].includes(evidenceGrade)) {
          const openingStateId = item.openingStateId || item.identity;
          actionEvidenceOpeningStates.add(openingStateId);
          actionEvidenceOpeningStatesByGrade[evidenceGrade] ||= new Set();
          actionEvidenceOpeningStatesByGrade[evidenceGrade].add(
            openingStateId
          );
        }
      }
      if (structuredV2ActionIdentities.has(item.identity)) {
        structuredV2ActionReferenceCount += 1;
        gameHasStructuredV2ActionReference = true;
        structuredV2ActionReferenceCoverage[item.coverageKey] =
          (structuredV2ActionReferenceCoverage[item.coverageKey] || 0) + 1;
      }
      const phase = item.phaseBand || "unknown";
      const actionClass = item.actionClass || "other";
      const deckId = item.deckId
        || String(item.coverageKey || "unknown")
          .replace(/:(?:p1|p2)$/, "");
      const deckPhaseKey = `${deckId}::${phase}`;
      actionReferenceCoverage[item.coverageKey] =
        (actionReferenceCoverage[item.coverageKey] || 0) + 1;
      actionReferencePhaseCoverage[phase] =
        (actionReferencePhaseCoverage[phase] || 0) + 1;
      actionReferenceActionClassCoverage[actionClass] =
        (actionReferenceActionClassCoverage[actionClass] || 0) + 1;
      actionReferenceDeckPhaseCoverage[deckPhaseKey] =
        (actionReferenceDeckPhaseCoverage[deckPhaseKey] || 0) + 1;
      actionReferencePhaseGames[phase]?.add(gameKey);
      actionReferenceActionClassGames[actionClass]?.add(gameKey);
      if (!actionReferenceDeckPhaseGames[deckPhaseKey]) {
        actionReferenceDeckPhaseGames[deckPhaseKey] = new Set();
      }
      actionReferenceDeckPhaseGames[deckPhaseKey].add(gameKey);
      if (structuredV2ActionIdentities.has(item.identity)) {
        structuredV2ActionReferencePhaseCoverage[phase] =
          (structuredV2ActionReferencePhaseCoverage[phase] || 0) + 1;
        structuredV2ActionReferenceActionClassCoverage[actionClass] =
          (structuredV2ActionReferenceActionClassCoverage[actionClass] || 0)
          + 1;
        structuredV2ActionReferenceDeckPhaseCoverage[deckPhaseKey] =
          (structuredV2ActionReferenceDeckPhaseCoverage[deckPhaseKey] || 0)
          + 1;
        structuredV2ActionReferencePhaseGames[phase]?.add(gameKey);
        structuredV2ActionReferenceActionClassGames[actionClass]?.add(gameKey);
        if (!structuredV2ActionReferenceDeckPhaseGames[deckPhaseKey]) {
          structuredV2ActionReferenceDeckPhaseGames[deckPhaseKey] = new Set();
        }
        structuredV2ActionReferenceDeckPhaseGames[deckPhaseKey].add(gameKey);
      }
      gameHasActionReference = true;
    }
    const gameHasLeafValueReference =
      Number(index.leafValuePairCount) > 0;
    const gameHasStructuredV2LeafValueReference =
      Number(index.structuredV2LeafValuePairCount) > 0;
    for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
      if (Number(index.leafValuePhaseCoverage?.[phase]) > 0) {
        leafValuePhaseGames[phase].add(gameKey);
      }
      if (Number(index.structuredV2LeafValuePhaseCoverage?.[phase]) > 0) {
        structuredV2LeafValuePhaseGames[phase].add(gameKey);
      }
    }
    for (const [deckPhaseKey, pairs] of Object.entries(
      index.leafValueDeckPhaseCoverage || {}
    )) {
      if (!(Number(pairs) > 0)) continue;
      if (!leafValueDeckPhaseGames[deckPhaseKey]) {
        leafValueDeckPhaseGames[deckPhaseKey] = new Set();
      }
      leafValueDeckPhaseGames[deckPhaseKey].add(gameKey);
    }
    for (const [deckPhaseKey, pairs] of Object.entries(
      index.structuredV2LeafValueDeckPhaseCoverage || {}
    )) {
      if (!(Number(pairs) > 0)) continue;
      if (!structuredV2LeafValueDeckPhaseGames[deckPhaseKey]) {
        structuredV2LeafValueDeckPhaseGames[deckPhaseKey] = new Set();
      }
      structuredV2LeafValueDeckPhaseGames[deckPhaseKey].add(gameKey);
    }
    if (gameHasActionReference) actionReferenceGames.add(gameKey);
    if (gameHasLeafValueReference) leafValueReferenceGames.add(gameKey);
    if (gameHasStructuredV2ActionReference) {
      structuredV2ActionReferenceGames.add(gameKey);
    }
    if (gameHasStructuredV2LeafValueReference) {
      structuredV2LeafValueReferenceGames.add(gameKey);
    }
  }
  const requiredCoverage = (options.deckIds || []).flatMap((deckId) => [
    `${deckId}:p1`,
    `${deckId}:p2`
  ]);
  const minimumActionReferencesPerDeckSeat = Math.max(
    1,
    Number(options.minimumActionReferencesPerDeckSeat
      ?? options.minimumReferencesPerDeckSeat) || 1
  );
  const minimumLeafValuePairsPerDeckSeat = Math.max(
    1,
    Number(options.minimumLeafValuePairsPerDeckSeat
      ?? options.minimumReferencesPerDeckSeat) || 1
  );
  const minimumActionReferencesPerPhase = Math.max(
    EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferencesPerPhase,
    Number(options.minimumActionReferencesPerPhase)
      || EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferencesPerPhase
  );
  const minimumActionReferenceGamesPerPhase = Math.max(
    EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferenceGamesPerPhase,
    Number(options.minimumActionReferenceGamesPerPhase)
      || EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferenceGamesPerPhase
  );
  const minimumLeafValuePairsPerPhase = Math.max(
    EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.leafValuePairsPerPhase,
    Number(options.minimumLeafValuePairsPerPhase)
      || EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.leafValuePairsPerPhase
  );
  const minimumLeafValueReferenceGamesPerPhase = Math.max(
    EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.leafValueReferenceGamesPerPhase,
    Number(options.minimumLeafValueReferenceGamesPerPhase)
      || EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.leafValueReferenceGamesPerPhase
  );
  const minimumActionReferencesByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        minimumActionReferencesPerPhase,
        Number(options.minimumActionReferencesByPhase?.[phase]) || 0
      )
    ])
  );
  const minimumActionReferenceGamesByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        minimumActionReferenceGamesPerPhase,
        Number(options.minimumActionReferenceGamesByPhase?.[phase]) || 0
      )
    ])
  );
  const minimumLeafValuePairsByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        minimumLeafValuePairsPerPhase,
        Number(options.minimumLeafValuePairsByPhase?.[phase]) || 0
      )
    ])
  );
  const minimumLeafValueReferenceGamesByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        minimumLeafValueReferenceGamesPerPhase,
        Number(options.minimumLeafValueReferenceGamesByPhase?.[phase]) || 0
      )
    ])
  );
  const minimumActionReferencesPerCoreClass = Math.max(
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .actionReferencesPerCoreClass,
    Number(options.minimumActionReferencesPerCoreClass) || 0
  );
  const minimumActionReferenceGamesPerCoreClass = Math.max(
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .actionReferenceGamesPerCoreClass,
    Number(options.minimumActionReferenceGamesPerCoreClass) || 0
  );
  const minimumActionReferencesPerDeckPhase = Math.max(
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .actionReferencesPerDeckPhase,
    Number(options.minimumActionReferencesPerDeckPhase) || 0
  );
  const minimumActionReferenceGamesPerDeckPhase = Math.max(
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .actionReferenceGamesPerDeckPhase,
    Number(options.minimumActionReferenceGamesPerDeckPhase) || 0
  );
  const minimumLeafValuePairsPerDeckPhase = Math.max(
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .leafValuePairsPerDeckPhase,
    Number(options.minimumLeafValuePairsPerDeckPhase) || 0
  );
  const minimumLeafValueReferenceGamesPerDeckPhase = Math.max(
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .leafValueReferenceGamesPerDeckPhase,
    Number(options.minimumLeafValueReferenceGamesPerDeckPhase) || 0
  );
  const actionReferencePhaseGameCount = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      actionReferencePhaseGames[phase].size
    ])
  );
  const leafValuePhaseReferenceGameCount = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      leafValuePhaseGames[phase].size
    ])
  );
  const structuredV2ActionReferencePhaseGameCount = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      structuredV2ActionReferencePhaseGames[phase].size
    ])
  );
  const structuredV2LeafValuePhaseReferenceGameCount = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      structuredV2LeafValuePhaseGames[phase].size
    ])
  );
  const actionReferenceActionClassGameCount = Object.fromEntries(
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map((actionClass) => [
      actionClass,
      actionReferenceActionClassGames[actionClass].size
    ])
  );
  const actionReferenceDeckPhaseGameCount = Object.fromEntries(
    Object.entries(actionReferenceDeckPhaseGames).map(([key, games]) => [
      key,
      games.size
    ])
  );
  const structuredV2ActionReferenceActionClassGameCount = Object.fromEntries(
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map((actionClass) => [
      actionClass,
      structuredV2ActionReferenceActionClassGames[actionClass].size
    ])
  );
  const structuredV2ActionReferenceDeckPhaseGameCount = Object.fromEntries(
    Object.entries(structuredV2ActionReferenceDeckPhaseGames)
      .map(([key, games]) => [key, games.size])
  );
  const leafValueDeckPhaseReferenceGameCount = Object.fromEntries(
    Object.entries(leafValueDeckPhaseGames).map(([key, games]) => [
      key,
      games.size
    ])
  );
  const structuredV2LeafValueDeckPhaseReferenceGameCount = Object.fromEntries(
    Object.entries(structuredV2LeafValueDeckPhaseGames)
      .map(([key, games]) => [key, games.size])
  );
  const missingActionReferencePhaseCoverage =
    EVALUATOR_AUDIT_PHASE_BANDS.filter((phase) =>
      (Number(actionReferencePhaseCoverage[phase]) || 0)
        < minimumActionReferencesByPhase[phase]
      || (Number(actionReferencePhaseGameCount[phase]) || 0)
        < minimumActionReferenceGamesByPhase[phase]);
  const missingLeafValuePhaseCoverage = EVALUATOR_AUDIT_PHASE_BANDS.filter(
    (phase) => (Number(leafValuePhaseCoverage[phase]) || 0)
        < minimumLeafValuePairsByPhase[phase]
      || (Number(leafValuePhaseReferenceGameCount[phase]) || 0)
        < minimumLeafValueReferenceGamesByPhase[phase]
  );
  const missingStructuredV2ActionReferencePhaseCoverage =
    EVALUATOR_AUDIT_PHASE_BANDS.filter((phase) =>
      (Number(structuredV2ActionReferencePhaseCoverage[phase]) || 0)
        < minimumActionReferencesByPhase[phase]
      || (Number(structuredV2ActionReferencePhaseGameCount[phase]) || 0)
        < minimumActionReferenceGamesByPhase[phase]);
  const missingStructuredV2LeafValuePhaseCoverage =
    EVALUATOR_AUDIT_PHASE_BANDS.filter((phase) =>
      (Number(structuredV2LeafValuePhaseCoverage[phase]) || 0)
        < minimumLeafValuePairsByPhase[phase]
      || (Number(structuredV2LeafValuePhaseReferenceGameCount[phase]) || 0)
        < minimumLeafValueReferenceGamesByPhase[phase]);
  const missingActionReferenceActionClassCoverage =
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.filter((actionClass) =>
      (Number(actionReferenceActionClassCoverage[actionClass]) || 0)
        < minimumActionReferencesPerCoreClass
      || (Number(actionReferenceActionClassGameCount[actionClass]) || 0)
        < minimumActionReferenceGamesPerCoreClass);
  const missingStructuredV2ActionReferenceActionClassCoverage =
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.filter((actionClass) =>
      (Number(structuredV2ActionReferenceActionClassCoverage[actionClass]) || 0)
        < minimumActionReferencesPerCoreClass
      || (Number(
        structuredV2ActionReferenceActionClassGameCount[actionClass]
      ) || 0) < minimumActionReferenceGamesPerCoreClass);
  const requiredDeckPhaseCoverage = (options.deckIds || []).flatMap(
    (deckId) => EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      .requiredDeckPhases.map((phase) => `${deckId}::${phase}`)
  );
  const missingActionReferenceDeckPhaseCoverage =
    requiredDeckPhaseCoverage.filter((key) =>
      (Number(actionReferenceDeckPhaseCoverage[key]) || 0)
        < minimumActionReferencesPerDeckPhase
      || (Number(actionReferenceDeckPhaseGameCount[key]) || 0)
        < minimumActionReferenceGamesPerDeckPhase);
  const missingLeafValueDeckPhaseCoverage = requiredDeckPhaseCoverage.filter(
    (key) => (Number(leafValueDeckPhaseCoverage[key]) || 0)
        < minimumLeafValuePairsPerDeckPhase
      || (Number(leafValueDeckPhaseReferenceGameCount[key]) || 0)
        < minimumLeafValueReferenceGamesPerDeckPhase
  );
  const missingStructuredV2ActionReferenceDeckPhaseCoverage =
    requiredDeckPhaseCoverage.filter((key) =>
      (Number(structuredV2ActionReferenceDeckPhaseCoverage[key]) || 0)
        < minimumActionReferencesPerDeckPhase
      || (Number(structuredV2ActionReferenceDeckPhaseGameCount[key]) || 0)
        < minimumActionReferenceGamesPerDeckPhase);
  const missingStructuredV2LeafValueDeckPhaseCoverage =
    requiredDeckPhaseCoverage.filter((key) =>
      (Number(structuredV2LeafValueDeckPhaseCoverage[key]) || 0)
        < minimumLeafValuePairsPerDeckPhase
      || (Number(
        structuredV2LeafValueDeckPhaseReferenceGameCount[key]
      ) || 0) < minimumLeafValueReferenceGamesPerDeckPhase);
  const missingGameCoverage = requiredCoverage.filter((key) => !(gameCoverage[key] > 0));
  const missingActionReferenceCoverage = requiredCoverage.filter((key) =>
    (Number(actionReferenceCoverage[key]) || 0)
      < minimumActionReferencesPerDeckSeat);
  const missingLeafValueCoverage = requiredCoverage.filter((key) =>
    (Number(leafValueCoverage[key]) || 0)
      < minimumLeafValuePairsPerDeckSeat);
  const missingStructuredV2ActionReferenceCoverage = requiredCoverage.filter(
    (key) => (Number(structuredV2ActionReferenceCoverage[key]) || 0)
      < minimumActionReferencesPerDeckSeat
  );
  const missingStructuredV2LeafValueCoverage = requiredCoverage.filter(
    (key) => (Number(structuredV2LeafValueCoverage[key]) || 0)
      < minimumLeafValuePairsPerDeckSeat
  );
  const acceptedGames = records.length;
  const bootstrapPartitions = options.includeCertificationPartitions === false
    ? null
    : partitionEvaluatorBootstrapRecords(records, {
      ...options,
      seed: options.partitionSeed || "evaluator-certification-split-v1"
    });
  const representativeCalibrationGames = bootstrapPartitions
    ? bootstrapPartitions.calibration.length
    : records.filter((record) =>
      record.samplingMode === "uniform-balanced").length;
  const actionReferenceGameCount = actionReferenceGames.size;
  const leafValueReferenceGameCount = leafValueReferenceGames.size;
  const structuredV2ActionReferenceGameCount =
    structuredV2ActionReferenceGames.size;
  const structuredV2LeafValueReferenceGameCount =
    structuredV2LeafValueReferenceGames.size;
  const naturalDistributionActionAudit =
    finalizeNaturalDistributionAuditAccumulator(
      naturalDistributionActionAuditAccumulator
    );
  const actionEvidenceComputeEfficiency =
    summarizeActionEvidenceEfficiency({
      validIndependentEvidence:
        (actionEvidenceGradeCounts[
          ACTION_EVIDENCE_GRADES.terminalRobust
        ] || 0)
        + (actionEvidenceGradeCounts[
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ] || 0),
      ...actionEvidenceComputeUsage
    });
  const minimumGamesFloor = Math.max(
    0,
    Number(options.minimumGamesFloor ?? 100) || 0
  );
  const minimumReferenceFloor = Math.max(
    0,
    Number(options.minimumReferenceFloor ?? 50) || 0
  );
  const minimumReferenceGamesFloor = Math.max(
    0,
    Number(options.minimumReferenceGamesFloor ?? 20) || 0
  );
  const minimumCalibrationFloor = Math.max(
    0,
    Number(options.minimumCalibrationFloor ?? 100) || 0
  );
  const requiresStructuredV2Action = Math.max(
    Number(options.minimumStructuredV2ActionReferences) || 0,
    Number(options.minimumStructuredV2ActionReferenceGames) || 0
  ) > 0;
  const requiresStructuredV2Leaf = Math.max(
    Number(options.minimumStructuredV2LeafValuePairs) || 0,
    Number(options.minimumStructuredV2LeafValueReferenceGames) || 0
  ) > 0;
  const requiredTerminalRobust = Math.max(
    0,
    Number(options.terminalRobustMinimum) || 0
  );
  const requiredContinuationConsistent = Math.max(
    0,
    Number(options.continuationConsistentMinimum) || 0
  );
  const requiredIndependentOpeningStates = Math.max(
    0,
    Number(options.independentOpeningStateMinimum) || 0
  );
  const requiredNaturalDistributionAudits = Math.max(
    0,
    Number(options.naturalDistributionAuditMinimum) || 0
  );
  const requiredNearEquivalent = Math.max(
    0,
    Number(options.nearEquivalentMinimum) || 0
  );
  const requiredNaturalDeckSeat = Math.max(
    0,
    Number(options.minimumDeckSeatCoverage) || 0
  );
  const actionEvidenceProtocolComplete =
    Number(actionEvidenceGradeCounts[
      ACTION_EVIDENCE_GRADES.terminalRobust
    ] || 0) >= requiredTerminalRobust
    && Number(actionEvidenceGradeCounts[
      ACTION_EVIDENCE_GRADES.continuationConsistent
    ] || 0) >= requiredContinuationConsistent
    && actionEvidenceOpeningStates.size >= requiredIndependentOpeningStates
    && Number(naturalDistributionActionAudit.states || 0)
      >= requiredNaturalDistributionAudits
    && Number(naturalDistributionActionAudit.nearEquivalent || 0)
      >= requiredNearEquivalent
    && (requiredNaturalDistributionAudits === 0
      || Number(naturalDistributionActionAudit.decisiveCoverage)
        >= Number(options.decisiveCoverageMinimum || 0))
    && (requiredNaturalDeckSeat === 0
      || requiredCoverage.every((key) => Number(
        naturalDistributionActionAudit.strata?.[`deck-seat:${key}`]?.states
      ) >= requiredNaturalDeckSeat));
  const aggregateComplete = acceptedGames >= Math.max(
    minimumGamesFloor,
    Number(options.minimumGames) || 0
  )
    && representativeCalibrationGames >= Math.max(
      minimumCalibrationFloor,
      Number(options.minimumRepresentativeCalibrationGames) || 0
    )
    && actionReferenceCount >= Math.max(
      minimumReferenceFloor,
      Number(options.minimumActionReferences ?? options.minimumReferences) || 0
    )
    && leafValuePairCount >= Math.max(
      minimumReferenceFloor,
      Number(options.minimumLeafValuePairs ?? options.minimumReferences) || 0
    )
    && actionReferenceGameCount >= Math.max(
      minimumReferenceGamesFloor,
      Number(options.minimumActionReferenceGames
        ?? options.minimumReferenceGames) || 0
    )
    && leafValueReferenceGameCount >= Math.max(
      minimumReferenceGamesFloor,
      Number(options.minimumLeafValueReferenceGames
        ?? options.minimumReferenceGames) || 0
    )
    && structuredV2ActionReferenceCount >= Math.max(
      0,
      Number(options.minimumStructuredV2ActionReferences) || 0
    )
    && structuredV2LeafValuePairCount >= Math.max(
      0,
      Number(options.minimumStructuredV2LeafValuePairs) || 0
    )
    && structuredV2ActionReferenceGameCount >= Math.max(
      0,
      Number(options.minimumStructuredV2ActionReferenceGames) || 0
    )
    && structuredV2LeafValueReferenceGameCount >= Math.max(
      0,
      Number(options.minimumStructuredV2LeafValueReferenceGames) || 0
    )
    && missingGameCoverage.length === 0
    && missingActionReferenceCoverage.length === 0
    && missingLeafValueCoverage.length === 0
    && missingActionReferencePhaseCoverage.length === 0
    && missingLeafValuePhaseCoverage.length === 0
    && missingActionReferenceActionClassCoverage.length === 0
    && missingActionReferenceDeckPhaseCoverage.length === 0
    && missingLeafValueDeckPhaseCoverage.length === 0
    && (!requiresStructuredV2Action
      || (missingStructuredV2ActionReferenceCoverage.length === 0
        && missingStructuredV2ActionReferencePhaseCoverage.length === 0
        && missingStructuredV2ActionReferenceActionClassCoverage.length === 0
        && missingStructuredV2ActionReferenceDeckPhaseCoverage.length === 0))
    && (!requiresStructuredV2Leaf
      || (missingStructuredV2LeafValueCoverage.length === 0
        && missingStructuredV2LeafValuePhaseCoverage.length === 0
        && missingStructuredV2LeafValueDeckPhaseCoverage.length === 0))
    && actionEvidenceProtocolComplete;
  const certificationPartitions = options.includeCertificationPartitions === false
    ? null
    : summarizeEvaluatorCertificationPartitions(
      bootstrapPartitions,
      options
    );
  const complete = aggregateComplete
    && (!certificationPartitions
      || Object.values(certificationPartitions).every(
        (partition) => partition.complete
      ));
  return {
    version: 7,
    complete,
    aggregateComplete,
    actionEvidenceProtocolComplete,
    evidenceProtocol: options.evidenceProtocolManifest
      ? structuredClone(options.evidenceProtocolManifest)
      : null,
    acceptedGames,
    invalidGames: 0,
    rejectedInvalidAttempts: dataset?.invalidRecords?.length || 0,
    exhaustedInvalidCoordinates: exhaustedInvalidCoordinateCount(
      dataset?.invalidRecords,
      Math.max(1, Number(options.invalidRetryLimit) || 3)
    ),
    // Compatibility alias with an explicit unit. New callers must use the
    // separate actionReferenceCount and leafValuePairCount fields.
    referenceCount: actionReferenceCount,
    referenceCountUnit: "action-reference",
    actionReferenceCount,
    actionEvidenceGradeCounts,
    actionEvidenceStatisticalStrengthCounts,
    actionEvidenceContinuationScopeCounts,
    actionEvidenceDispositionCounts,
    actionEvidenceProvenanceStatusCounts,
    actionEvidenceObservedPairGap: finalizeActionEvidencePairwiseRegret(
      actionEvidencePairwiseRegretAccumulator
    ),
    actionEvidencePairwiseRegret: finalizeActionEvidencePairwiseRegret(
      actionEvidencePairwiseRegretAccumulator
    ),
    actionEvidenceIndependentOpeningStateCount:
      actionEvidenceOpeningStates.size,
    actionEvidenceIndependentOpeningStates: Object.fromEntries(
      Object.entries(actionEvidenceOpeningStatesByGrade).map(
        ([grade, states]) => [grade, states.size]
      )
    ),
    naturalDistributionActionAudit,
    leafActionEffectAudit: finalizeLeafActionEffectAuditSummary(
      leafActionEffectAuditAccumulator
    ),
    actionEvidenceComputeEfficiency,
    leafValuePairCount,
    structuredV2ActionReferenceCount,
    structuredV2LeafValuePairCount,
    actionAuditRacing,
    logicalGames,
    physicalGames,
    contributingGames: actionReferenceGameCount,
    actionReferenceGameCount,
    leafValueReferenceGameCount,
    structuredV2ActionReferenceGameCount,
    structuredV2LeafValueReferenceGameCount,
    representativeCalibrationGames,
    coverage: gameCoverage,
    gameCoverage,
    referenceCoverage: actionReferenceCoverage,
    actionReferenceCoverage,
    leafValueCoverage,
    structuredV2ActionReferenceCoverage,
    structuredV2LeafValueCoverage,
    stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION,
    actionReferencePhaseCoverage,
    actionReferencePhaseGameCount,
    actionReferenceActionClassCoverage,
    actionReferenceActionClassGameCount,
    actionReferenceDeckPhaseCoverage,
    actionReferenceDeckPhaseGameCount,
    leafValuePhaseCoverage,
    leafValuePhaseReferenceGameCount,
    leafValueDeckPhaseCoverage,
    leafValueDeckPhaseReferenceGameCount,
    structuredV2ActionReferencePhaseCoverage,
    structuredV2ActionReferencePhaseGameCount,
    structuredV2ActionReferenceActionClassCoverage,
    structuredV2ActionReferenceActionClassGameCount,
    structuredV2ActionReferenceDeckPhaseCoverage,
    structuredV2ActionReferenceDeckPhaseGameCount,
    structuredV2LeafValuePhaseCoverage,
    structuredV2LeafValuePhaseReferenceGameCount,
    structuredV2LeafValueDeckPhaseCoverage,
    structuredV2LeafValueDeckPhaseReferenceGameCount,
    minimumActionReferencesPerPhase,
    minimumActionReferenceGamesPerPhase,
    minimumLeafValuePairsPerPhase,
    minimumLeafValueReferenceGamesPerPhase,
    minimumActionReferencesByPhase,
    minimumActionReferenceGamesByPhase,
    minimumLeafValuePairsByPhase,
    minimumLeafValueReferenceGamesByPhase,
    minimumActionReferencesPerCoreClass,
    minimumActionReferenceGamesPerCoreClass,
    minimumActionReferencesPerDeckPhase,
    minimumActionReferenceGamesPerDeckPhase,
    minimumLeafValuePairsPerDeckPhase,
    minimumLeafValueReferenceGamesPerDeckPhase,
    missingActionReferencePhaseCoverage,
    missingLeafValuePhaseCoverage,
    missingActionReferenceActionClassCoverage,
    missingActionReferenceDeckPhaseCoverage,
    missingLeafValueDeckPhaseCoverage,
    missingStructuredV2ActionReferencePhaseCoverage,
    missingStructuredV2LeafValuePhaseCoverage,
    missingStructuredV2ActionReferenceActionClassCoverage,
    missingStructuredV2ActionReferenceDeckPhaseCoverage,
    missingStructuredV2LeafValueDeckPhaseCoverage,
    minimumActionReferencesPerDeckSeat,
    minimumLeafValuePairsPerDeckSeat,
    missingCoverage: missingGameCoverage,
    missingGameCoverage,
    missingReferenceCoverage: missingActionReferenceCoverage,
    missingActionReferenceCoverage,
    missingLeafValueCoverage,
    missingStructuredV2ActionReferenceCoverage,
    missingStructuredV2LeafValueCoverage,
    certificationPartitions,
    samplingModes: records.reduce((result, record) => {
      const mode = record.samplingMode || "unknown";
      result[mode] = (result[mode] || 0) + 1;
      return result;
    }, {}),
    excludedFrom: [
      "ppo",
      "epoch-selection-retention",
      "calibration-fit"
    ],
    usedFor: [
      "evaluator-certification-audit",
      "action-ranking-audit",
      "leaf-value-paired-ranking-audit"
    ]
  };
}

export function partitionEvaluatorCertificationRecords(records, options = {}) {
  const roles = [...EVALUATOR_EVIDENCE_PARTITIONS];
  const assignments = Object.fromEntries(roles.map((role) => [role, []]));
  const seed = String(options.seed || "evaluator-certification-split-v1");
  const ordered = [...(records || [])].map((record) => ({
    record,
    key: `${record.workerIndex}:${record.gameIndex}`
  }))
    .sort((left, right) =>
      stablePartitionHash(`${seed}:${left.key}`)
        - stablePartitionHash(`${seed}:${right.key}`)
        || left.key.localeCompare(right.key));
  for (const item of ordered) {
    const explicitRole = item.record.certificationRole;
    if (roles.includes(explicitRole)) {
      assignments[explicitRole].push(item.record);
      continue;
    }
    // Role assignment depends only on the immutable game coordinate. Adding
    // future bootstrap games can never move an existing game to another
    // partition and therefore cannot create cross-role archive overlap.
    const role = roles[
      stablePartitionHash(`${seed}:role:${item.key}`) % roles.length
    ];
    assignments[role].push(item.record);
  }
  return assignments;
}

export function partitionEvaluatorBootstrapRecords(records, options = {}) {
  const seed = String(options.seed || "evaluator-certification-split-v1");
  // Calibration-only games never run teacher or terminal audit work. Retain
  // the legacy uniform-balanced name for archived v8 datasets, while every new
  // purpose-separated dataset uses the explicit calibration-only role.
  const calibration = (records || [])
    .filter((record) => [
      "uniform-balanced",
      EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration
    ].includes(record.samplingMode))
    .map((record) => ({
      record,
      key: `${record.workerIndex}:${record.gameIndex}`
    }))
    .sort((left, right) =>
      stablePartitionHash(`${seed}:calibration:${left.key}`)
        - stablePartitionHash(`${seed}:calibration:${right.key}`)
        || left.key.localeCompare(right.key))
    .map((item) => item.record);
  const calibrationRecords = new Set(calibration);
  const certificationRecords = (records || [])
    .filter((record) => !calibrationRecords.has(record));
  return {
    calibration,
    ...partitionEvaluatorCertificationRecords(certificationRecords, {
      ...options,
      seed
    })
  };
}

function summarizeEvaluatorCertificationPartitions(partitions, options = {}) {
  return Object.fromEntries(EVALUATOR_EVIDENCE_PARTITIONS.map((role) => {
    const requirement = evaluatorBootstrapEvidenceRequirement(role, options);
    const audit = summarizeEvaluatorBootstrap({
      records: partitions[role],
      invalidRecords: []
    }, {
      ...options,
      includeCertificationPartitions: false,
      minimumGames: requirement.minimumGames,
      minimumActionReferences: requirement.minimumActionReferences,
      minimumLeafValuePairs: requirement.minimumLeafValuePairs,
      minimumActionReferenceGames: requirement.minimumActionReferenceGames,
      minimumLeafValueReferenceGames:
        requirement.minimumLeafValueReferenceGames,
      minimumStructuredV2ActionReferences:
        requirement.minimumStructuredV2ActionReferences,
      minimumStructuredV2ActionReferenceGames:
        requirement.minimumStructuredV2ActionReferenceGames,
      minimumStructuredV2LeafValuePairs:
        requirement.minimumStructuredV2LeafValuePairs,
      minimumStructuredV2LeafValueReferenceGames:
        requirement.minimumStructuredV2LeafValueReferenceGames,
      minimumActionReferencesPerDeckSeat:
        requirement.minimumActionReferencesPerDeckSeat,
      minimumLeafValuePairsPerDeckSeat:
        requirement.minimumLeafValuePairsPerDeckSeat,
      minimumActionReferencesByPhase:
        requirement.minimumActionReferencesByPhase,
      minimumActionReferenceGamesByPhase:
        requirement.minimumActionReferenceGamesByPhase,
      minimumLeafValuePairsByPhase:
        requirement.minimumLeafValuePairsByPhase,
      minimumLeafValueReferenceGamesByPhase:
        requirement.minimumLeafValueReferenceGamesByPhase,
      minimumActionReferencesPerCoreClass:
        requirement.minimumActionReferencesPerCoreClass,
      minimumActionReferenceGamesPerCoreClass:
        requirement.minimumActionReferenceGamesPerCoreClass,
      minimumActionReferencesPerDeckPhase:
        requirement.minimumActionReferencesPerDeckPhase,
      minimumActionReferenceGamesPerDeckPhase:
        requirement.minimumActionReferenceGamesPerDeckPhase,
      minimumLeafValuePairsPerDeckPhase:
        requirement.minimumLeafValuePairsPerDeckPhase,
      minimumLeafValueReferenceGamesPerDeckPhase:
        requirement.minimumLeafValueReferenceGamesPerDeckPhase,
      terminalRobustMinimum: requirement.terminalRobustMinimum,
      continuationConsistentMinimum:
        requirement.continuationConsistentMinimum,
      independentOpeningStateMinimum:
        requirement.independentOpeningStateMinimum,
      naturalDistributionAuditMinimum:
        requirement.naturalDistributionAuditMinimum,
      decisiveCoverageMinimum: requirement.decisiveCoverageMinimum,
      minimumDeckSeatCoverage: requirement.minimumDeckSeatCoverage,
      nearEquivalentMinimum: requirement.nearEquivalentMinimum,
      minimumRepresentativeCalibrationGames: 0,
      minimumGamesFloor: 0,
      minimumReferenceFloor: 0,
      minimumReferenceGamesFloor: 0,
      minimumCalibrationFloor: 0
    });
    return [role, {
      ...audit,
      role,
      requirement,
      gameKeys: partitions[role].map((record) =>
        `${record.workerIndex}:${record.gameIndex}`)
    }];
  }));
}

function stablePartitionHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function summarizeEvaluatorCertificationTrajectories(
  trajectories,
  options = {}
) {
  const games = new Map();
  for (const [index, trajectory] of (trajectories || []).entries()) {
    const gameId = trajectory?.gameId || `trajectory-${index}`;
    if (!games.has(gameId)) games.set(gameId, []);
    games.get(gameId).push(trajectory);
  }
  return summarizeEvaluatorBootstrap({
    records: [...games.entries()].map(([gameId, gameTrajectories], index) => ({
      workerIndex: "audit",
      gameIndex: gameId || index,
      samplingMode: gameTrajectories[0]?.evaluatorBootstrapSamplingMode
        || "certification-dataset",
      result: { trajectories: gameTrajectories }
    })),
    invalidRecords: []
  }, options);
}

export function selectEvaluatorCertificationGames(groupedGames, options = {}) {
  const maximumGames = Math.max(1, Number(options.maximumGames) || 1000);
  const sorted = [...(groupedGames || [])].sort(([left], [right]) =>
    String(left).localeCompare(String(right)));
  if (sorted.length <= maximumGames) return sorted;
  const deckIds = options.deckIds || [];
  const requiredCoverage = deckIds.flatMap((deckId) => [
    `${deckId}:p1`,
    `${deckId}:p2`
  ]);
  const summaries = sorted.map(([gameId, trajectories]) => ({
    gameId,
    trajectories,
    ...summarizeCertificationGame(trajectories)
  }));
  const selected = new Map();
  const addBest = (predicate, score) => {
    if (selected.size >= maximumGames) return;
    const candidates = summaries
      .filter((item) => !selected.has(item.gameId) && predicate(item))
      .sort((left, right) =>
        score(right) - score(left)
          || String(left.gameId).localeCompare(String(right.gameId)));
    if (candidates.length) selected.set(candidates[0].gameId, candidates[0]);
  };
  // Formal v2 companions are the scarcest records and are required by the
  // structured-v2 candidates. Preserve them before legacy aggregate density.
  for (const item of summaries
    .filter((candidate) =>
      candidate.structuredV2ActionReferences > 0
      || candidate.structuredV2LeafPairs > 0)
    .sort((left, right) =>
      right.structuredV2ActionReferences
        - left.structuredV2ActionReferences
      || right.structuredV2LeafPairs - left.structuredV2LeafPairs
      || String(left.gameId).localeCompare(String(right.gameId)))) {
    if (selected.size >= maximumGames) break;
    selected.set(item.gameId, item);
  }
  // Preserve at least one action reference and one production-leaf pair for
  // every required deck/seat before spending capacity on dense games.
  for (const coverageKey of requiredCoverage) {
    addBest(
      (item) => item.actionCoverage.has(coverageKey),
      (item) => item.actionReferences * 100 + item.leafPairs
    );
  }
  for (const coverageKey of requiredCoverage) {
    addBest(
      (item) => item.leafCoverage.has(coverageKey),
      (item) => item.leafPairs * 100 + item.actionReferences
    );
  }
  // A bounded certification dataset must preserve the temporal support that
  // made the bootstrap complete. Otherwise truncation could silently discard
  // the only late-game examples and make the downstream phase audit blind.
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    addBest(
      (item) => item.actionPhases.has(phase),
      (item) => item.actionReferences * 100 + item.leafPairs
    );
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    addBest(
      (item) => item.leafPhases.has(phase),
      (item) => item.leafPairs * 100 + item.actionReferences
    );
  }
  for (const item of summaries
    .filter((candidate) => !selected.has(candidate.gameId))
    .sort((left, right) =>
      right.actionReferences - left.actionReferences
        || right.leafPairs - left.leafPairs
        || String(left.gameId).localeCompare(String(right.gameId)))) {
    if (selected.size >= maximumGames) break;
    selected.set(item.gameId, item);
  }
  return [...selected.values()]
    .sort((left, right) => String(left.gameId).localeCompare(String(right.gameId)))
    .map((item) => [item.gameId, item.trajectories]);
}

export function selectBalancedEvaluatorBootstrapRecords(
  records,
  options = {}
) {
  const evidenceRequirement = options.evidenceRequirement || null;
  const maximumRecords = Math.max(
    1,
    Number(options.maximumRecords) || Number.MAX_SAFE_INTEGER
  );
  const targetReferences = Math.max(0,
    evidenceRequirement
      && Object.hasOwn(evidenceRequirement, "minimumActionReferences")
      ? Number(evidenceRequirement.minimumActionReferences) || 0
      : Number(options.targetActionReferences) || 50
  );
  const targetActionReferenceGames = Math.max(
    0,
    Number(evidenceRequirement?.minimumActionReferenceGames) || 0
  );
  const targetLeafPairs = Math.max(
    0,
    Number(evidenceRequirement?.minimumLeafValuePairs) || 0
  );
  const targetLeafReferenceGames = Math.max(
    0,
    Number(evidenceRequirement?.minimumLeafValueReferenceGames) || 0
  );
  const targetStructuredV2References = Math.max(
    0,
    Number(evidenceRequirement?.minimumStructuredV2ActionReferences) || 0
  );
  const targetStructuredV2ActionGames = Math.max(
    0,
    Number(evidenceRequirement?.minimumStructuredV2ActionReferenceGames) || 0
  );
  const targetStructuredV2LeafPairs = Math.max(
    0,
    Number(evidenceRequirement?.minimumStructuredV2LeafValuePairs) || 0
  );
  const targetStructuredV2LeafGames = Math.max(
    0,
    Number(evidenceRequirement?.minimumStructuredV2LeafValueReferenceGames) || 0
  );
  const targetGames = Math.max(
    0,
    Number(evidenceRequirement?.minimumGames) || 0
  );
  const targetTerminalRobust = Math.max(
    0,
    Number(evidenceRequirement?.terminalRobustMinimum) || 0
  );
  const targetContinuationConsistent = Math.max(
    0,
    Number(evidenceRequirement?.continuationConsistentMinimum) || 0
  );
  const targetIndependentOpeningStates = Math.max(
    0,
    Number(evidenceRequirement?.independentOpeningStateMinimum) || 0
  );
  const targetNaturalStates = Math.max(
    0,
    Number(evidenceRequirement?.naturalDistributionAuditMinimum) || 0
  );
  const targetNearEquivalent = Math.max(
    0,
    Number(evidenceRequirement?.nearEquivalentMinimum) || 0
  );
  const targetNaturalDeckSeat = Math.max(
    0,
    Number(evidenceRequirement?.minimumDeckSeatCoverage) || 0
  );
  const requiresActionEvidence = targetReferences > 0
    || targetActionReferenceGames > 0
    || targetStructuredV2References > 0
    || targetStructuredV2ActionGames > 0
    || targetTerminalRobust > 0
    || targetContinuationConsistent > 0
    || targetIndependentOpeningStates > 0
    || targetNaturalStates > 0;
  const minimumActionReferencesPerDeckSeat = Math.max(
    0,
    requiresActionEvidence
      ? Number(evidenceRequirement?.minimumActionReferencesPerDeckSeat) || 1
      : 0
  );
  const minimumLeafPairsPerDeckSeat = Math.max(
    0,
    Number(evidenceRequirement?.minimumLeafValuePairsPerDeckSeat) || 0
  );
  const minimumActionReferencesByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        0,
        requiresActionEvidence ? (
        Number(evidenceRequirement?.minimumActionReferencesByPhase?.[phase])
          || Number(options.minimumActionReferencesPerPhase)
          || EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferencesPerPhase
        ) : 0
      )
    ])
  );
  const minimumActionGamesByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        0,
        requiresActionEvidence ? (
        Number(
          evidenceRequirement?.minimumActionReferenceGamesByPhase?.[phase]
        )
          || Number(options.minimumActionReferenceGamesPerPhase)
          || EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS.actionReferenceGamesPerPhase
        ) : 0
      )
    ])
  );
  const minimumLeafPairsByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        0,
        Number(evidenceRequirement?.minimumLeafValuePairsByPhase?.[phase]) || 0
      )
    ])
  );
  const minimumLeafGamesByPhase = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      Math.max(
        0,
        Number(
          evidenceRequirement?.minimumLeafValueReferenceGamesByPhase?.[phase]
        ) || 0
      )
    ])
  );
  const minimumActionReferencesPerCoreClass = Math.max(
    0,
    requiresActionEvidence
      ? Number(evidenceRequirement?.minimumActionReferencesPerCoreClass)
        || EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
          .actionReferencesPerCoreClass
      : 0
  );
  const minimumActionGamesPerCoreClass = Math.max(
    0,
    requiresActionEvidence
      ? Number(evidenceRequirement?.minimumActionReferenceGamesPerCoreClass)
        || EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
          .actionReferenceGamesPerCoreClass
      : 0
  );
  const minimumActionReferencesPerDeckPhase = Math.max(
    0,
    requiresActionEvidence
      ? Number(evidenceRequirement?.minimumActionReferencesPerDeckPhase)
        || EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
          .actionReferencesPerDeckPhase
      : 0
  );
  const minimumActionGamesPerDeckPhase = Math.max(
    0,
    requiresActionEvidence
      ? Number(evidenceRequirement?.minimumActionReferenceGamesPerDeckPhase)
        || EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
          .actionReferenceGamesPerDeckPhase
      : 0
  );
  const minimumLeafPairsPerDeckPhase = Math.max(
    0,
    Number(evidenceRequirement?.minimumLeafValuePairsPerDeckPhase) || 0
  );
  const minimumLeafGamesPerDeckPhase = Math.max(
    0,
    Number(evidenceRequirement?.minimumLeafValueReferenceGamesPerDeckPhase)
      || 0
  );
  const seed = String(options.seed || "balanced-action-records-v1");
  const stableRecords = [...(records || [])].sort((left, right) =>
    stablePartitionHash(
      `${seed}:${left.workerIndex}:${left.gameIndex}`
    ) - stablePartitionHash(
      `${seed}:${right.workerIndex}:${right.gameIndex}`
    )
      || Number(left.workerIndex) - Number(right.workerIndex)
      || Number(left.gameIndex) - Number(right.gameIndex));
  const selected = new Set();
  const seenActionReferences = new Set();
  const actionReferenceGames = new Set();
  const leafReferenceGames = new Set();
  const structuredV2ActionGames = new Set();
  const structuredV2LeafGames = new Set();
  const phaseCounts = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, 0])
  );
  const phaseGameCounts = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, 0])
  );
  const classCounts = Object.fromEntries(
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map(
      (actionClass) => [actionClass, 0]
    )
  );
  const classGameCounts = Object.fromEntries(
    EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map(
      (actionClass) => [actionClass, 0]
    )
  );
  const deckPhaseCounts = {};
  const deckPhaseGameCounts = {};
  const leafPhaseCounts = {};
  const leafPhaseGameCounts = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, 0])
  );
  const leafDeckPhaseCounts = {};
  const leafDeckPhaseGameCounts = {};
  const actionCoverageCounts = {};
  const leafCoverageCounts = {};
  const evidenceGradeCounts = {};
  const independentOpeningStates = new Set();
  const naturalDeckSeatCounts = {};
  let selectedReferences = 0;
  let selectedLeafPairs = 0;
  let selectedStructuredV2References = 0;
  let selectedStructuredV2LeafPairs = 0;
  let selectedNaturalStates = 0;
  let selectedNearEquivalent = 0;

  const identities = (record) =>
    record.resultIndex?.actionReferenceIdentities || [];
  const recordKey = (record) =>
    `${record.workerIndex}:${record.gameIndex}`;
  const unseenIdentities = (record, predicate = () => true) =>
    identities(record).filter((item) =>
      item?.identity
      && !seenActionReferences.has(item.identity)
      && predicate(item));
  const add = (record) => {
    if (!record || selected.has(record) || selected.size >= maximumRecords) {
      return false;
    }
    selected.add(record);
    const key = recordKey(record);
    const items = unseenIdentities(record);
    const structuredV2Identities = new Set(
      record.resultIndex?.structuredV2ActionReferenceIdentities || []
    );
    selectedReferences += items.length;
    if (items.length > 0) actionReferenceGames.add(key);
    const structuredV2Items = items.filter((item) =>
      structuredV2Identities.has(item.identity));
    selectedStructuredV2References += structuredV2Items.length;
    if (structuredV2Items.length > 0) structuredV2ActionGames.add(key);
    const recordPhases = new Set();
    const recordClasses = new Set();
    const recordDeckPhases = new Set();
    for (const item of items) {
      seenActionReferences.add(item.identity);
      if (item.inProtocolScope !== false) {
        const grade = item.evidenceGrade
          || ACTION_EVIDENCE_GRADES.legacyTerminalConditioned;
        evidenceGradeCounts[grade] =
          (evidenceGradeCounts[grade] || 0) + 1;
        if ([
          ACTION_EVIDENCE_GRADES.terminalRobust,
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ].includes(grade)) {
          independentOpeningStates.add(item.openingStateId || item.identity);
        }
      }
      phaseCounts[item.phaseBand] = (phaseCounts[item.phaseBand] || 0) + 1;
      recordPhases.add(item.phaseBand);
      classCounts[item.actionClass] = (classCounts[item.actionClass] || 0) + 1;
      recordClasses.add(item.actionClass);
      const deckId = item.deckId
        || String(item.coverageKey || "unknown").replace(/:(?:p1|p2)$/, "");
      const deckPhaseKey = `${deckId}::${item.phaseBand}`;
      deckPhaseCounts[deckPhaseKey] =
        (deckPhaseCounts[deckPhaseKey] || 0) + 1;
      recordDeckPhases.add(deckPhaseKey);
      actionCoverageCounts[item.coverageKey] =
        (actionCoverageCounts[item.coverageKey] || 0) + 1;
    }
    for (const phase of recordPhases) {
      phaseGameCounts[phase] = (phaseGameCounts[phase] || 0) + 1;
    }
    for (const actionClass of recordClasses) {
      classGameCounts[actionClass] =
        (classGameCounts[actionClass] || 0) + 1;
    }
    for (const deckPhaseKey of recordDeckPhases) {
      deckPhaseGameCounts[deckPhaseKey] =
        (deckPhaseGameCounts[deckPhaseKey] || 0) + 1;
    }
    const index = record.resultIndex || {};
    const leafPairs = Math.max(0, Number(index.leafValuePairCount) || 0);
    selectedLeafPairs += leafPairs;
    const structuredV2LeafPairs = Math.max(
      0,
      Number(index.structuredV2LeafValuePairCount) || 0
    );
    selectedStructuredV2LeafPairs += structuredV2LeafPairs;
    if (structuredV2LeafPairs > 0) structuredV2LeafGames.add(key);
    if (leafPairs > 0) leafReferenceGames.add(key);
    const natural = index.naturalDistributionActionAudit || {};
    selectedNaturalStates += Math.max(0, Number(natural.states) || 0);
    selectedNearEquivalent += Math.max(
      0,
      Number(natural.nearEquivalent) || 0
    );
    for (const coverageKey of requiredCoverage) {
      naturalDeckSeatCounts[coverageKey] =
        (naturalDeckSeatCounts[coverageKey] || 0)
        + Math.max(
          0,
          Number(natural.strata?.[`deck-seat:${coverageKey}`]?.states) || 0
        );
    }
    for (const [coverageKey, count] of Object.entries(
      index.leafValueCoverage || {}
    )) {
      leafCoverageCounts[coverageKey] =
        (leafCoverageCounts[coverageKey] || 0) + (Number(count) || 0);
    }
    for (const [phase, count] of Object.entries(
      index.leafValuePhaseCoverage || {}
    )) {
      if (!(Number(count) > 0)) continue;
      leafPhaseCounts[phase] =
        (leafPhaseCounts[phase] || 0) + Number(count);
      leafPhaseGameCounts[phase] =
        (leafPhaseGameCounts[phase] || 0) + 1;
    }
    for (const [deckPhaseKey, count] of Object.entries(
      index.leafValueDeckPhaseCoverage || {}
    )) {
      if (!(Number(count) > 0)) continue;
      leafDeckPhaseCounts[deckPhaseKey] =
        (leafDeckPhaseCounts[deckPhaseKey] || 0) + Number(count);
      leafDeckPhaseGameCounts[deckPhaseKey] =
        (leafDeckPhaseGameCounts[deckPhaseKey] || 0) + 1;
    }
    return true;
  };
  const choose = (predicate, score) => stableRecords
    .filter((record) => !selected.has(record) && predicate(record))
    .sort((left, right) => score(right) - score(left)
      || Number(left.workerIndex) - Number(right.workerIndex)
      || Number(left.gameIndex) - Number(right.gameIndex))[0] || null;

  const requiredCoverage = (options.deckIds || []).flatMap((deckId) => [
    `${deckId}:p1`,
    `${deckId}:p2`
  ]);
  const addForGrade = (grade, target) => {
    while ((evidenceGradeCounts[grade] || 0) < target) {
      const candidate = choose(
        (record) => unseenIdentities(record, (item) =>
          item.inProtocolScope !== false
          && item.evidenceGrade === grade).length > 0,
        (record) => unseenIdentities(record, (item) =>
          item.inProtocolScope !== false
          && item.evidenceGrade === grade).length
      );
      if (!add(candidate)) break;
    }
  };
  addForGrade(ACTION_EVIDENCE_GRADES.terminalRobust, targetTerminalRobust);
  addForGrade(
    ACTION_EVIDENCE_GRADES.continuationConsistent,
    targetContinuationConsistent
  );
  while (independentOpeningStates.size < targetIndependentOpeningStates) {
    const candidate = choose(
      (record) => unseenIdentities(record, (item) =>
        item.inProtocolScope !== false
        && [
          ACTION_EVIDENCE_GRADES.terminalRobust,
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ].includes(item.evidenceGrade)
        && !independentOpeningStates.has(
          item.openingStateId || item.identity
        )).length > 0,
      (record) => unseenIdentities(record, (item) =>
        item.inProtocolScope !== false
        && [
          ACTION_EVIDENCE_GRADES.terminalRobust,
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ].includes(item.evidenceGrade)
        && !independentOpeningStates.has(
          item.openingStateId || item.identity
        )).length
    );
    if (!add(candidate)) break;
  }
  while (selectedNaturalStates < targetNaturalStates
    || selectedNearEquivalent < targetNearEquivalent) {
    const candidate = choose(
      (record) => Number(
        record.resultIndex?.naturalDistributionActionAudit?.states
      ) > 0,
      (record) => Number(
        record.resultIndex?.naturalDistributionActionAudit?.states
      ) || 0
    );
    if (!add(candidate)) break;
  }
  for (const coverageKey of requiredCoverage) {
    while ((naturalDeckSeatCounts[coverageKey] || 0)
      < targetNaturalDeckSeat) {
      const candidate = choose(
        (record) => Number(
          record.resultIndex?.naturalDistributionActionAudit?.strata?.[
            `deck-seat:${coverageKey}`
          ]?.states
        ) > 0,
        (record) => Number(
          record.resultIndex?.naturalDistributionActionAudit?.strata?.[
            `deck-seat:${coverageKey}`
          ]?.states
        ) || 0
      );
      if (!add(candidate)) break;
    }
  }
  for (const coverageKey of requiredCoverage) {
    while ((actionCoverageCounts[coverageKey] || 0)
      < minimumActionReferencesPerDeckSeat) {
      if (!add(choose(
        (record) => unseenIdentities(record, (item) =>
          item.coverageKey === coverageKey).length > 0,
        (record) => unseenIdentities(record, (item) =>
          item.coverageKey === coverageKey).length
      ))) break;
    }
    while ((leafCoverageCounts[coverageKey] || 0)
      < minimumLeafPairsPerDeckSeat) {
      if (!add(choose(
        (record) => Number(
          record.resultIndex?.leafValueCoverage?.[coverageKey]
        ) > 0,
        (record) => Number(
          record.resultIndex?.leafValueCoverage?.[coverageKey]
        ) || 0
      ))) break;
    }
  }
  const requiredDeckPhases = (options.deckIds || []).flatMap((deckId) =>
    EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS.requiredDeckPhases.map(
      (phase) => `${deckId}::${phase}`
    ));
  for (const deckPhaseKey of requiredDeckPhases) {
    while ((deckPhaseCounts[deckPhaseKey] || 0)
        < minimumActionReferencesPerDeckPhase
      || (deckPhaseGameCounts[deckPhaseKey] || 0)
        < minimumActionGamesPerDeckPhase) {
      const candidate = choose(
        (record) => unseenIdentities(record, (item) => {
          const deckId = item.deckId
            || String(item.coverageKey || "unknown")
              .replace(/:(?:p1|p2)$/, "");
          return `${deckId}::${item.phaseBand}` === deckPhaseKey;
        }).length > 0,
        (record) => unseenIdentities(record, (item) => {
          const deckId = item.deckId
            || String(item.coverageKey || "unknown")
              .replace(/:(?:p1|p2)$/, "");
          return `${deckId}::${item.phaseBand}` === deckPhaseKey;
        }).length
      );
      if (!add(candidate)) break;
    }
    while ((leafDeckPhaseCounts[deckPhaseKey] || 0)
        < minimumLeafPairsPerDeckPhase
      || (leafDeckPhaseGameCounts[deckPhaseKey] || 0)
        < minimumLeafGamesPerDeckPhase) {
      const candidate = choose(
        (record) => Number(
          record.resultIndex?.leafValueDeckPhaseCoverage?.[deckPhaseKey]
        ) > 0,
        (record) => Number(
          record.resultIndex?.leafValueDeckPhaseCoverage?.[deckPhaseKey]
        ) || 0
      );
      if (!add(candidate)) break;
    }
  }
  for (const actionClass of EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES) {
    while ((classCounts[actionClass] || 0)
        < minimumActionReferencesPerCoreClass
      || (classGameCounts[actionClass] || 0)
        < minimumActionGamesPerCoreClass) {
      const candidate = choose(
        (record) => unseenIdentities(record, (item) =>
          item.actionClass === actionClass).length > 0,
        (record) => unseenIdentities(record, (item) =>
          item.actionClass === actionClass).length
      );
      if (!add(candidate)) break;
    }
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    while ((phaseCounts[phase] || 0) < minimumActionReferencesByPhase[phase]
      || (phaseGameCounts[phase] || 0) < minimumActionGamesByPhase[phase]) {
      const candidate = choose(
        (record) => unseenIdentities(record, (item) =>
          item.phaseBand === phase).length > 0,
        (record) => unseenIdentities(record, (item) =>
          item.phaseBand === phase).length
      );
      if (!add(candidate)) break;
    }
    while ((leafPhaseCounts[phase] || 0) < minimumLeafPairsByPhase[phase]
      || (leafPhaseGameCounts[phase] || 0) < minimumLeafGamesByPhase[phase]) {
      const candidate = choose(
        (record) => Number(
          record.resultIndex?.leafValuePhaseCoverage?.[phase]
        ) > 0,
        (record) => Number(
          record.resultIndex?.leafValuePhaseCoverage?.[phase]
        ) || 0
      );
      if (!add(candidate)) break;
    }
  }
  // Preserve the formal v2 population before filling aggregate v1-compatible
  // quotas. Old migrated evidence is useful for flat/set-v1 pretraining, but
  // it must not consume the bounded dataset capacity needed by candidates
  // whose official development and holdouts require v2 provenance.
  while (selectedStructuredV2References < targetStructuredV2References
    || structuredV2ActionGames.size < targetStructuredV2ActionGames) {
    const candidate = choose(
      (record) => (record.resultIndex
        ?.structuredV2ActionReferenceIdentities || []).some((identity) =>
          !seenActionReferences.has(identity)),
      (record) => (record.resultIndex
        ?.structuredV2ActionReferenceIdentities || []).filter((identity) =>
          !seenActionReferences.has(identity)).length
    );
    if (!add(candidate)) break;
  }
  while (selectedStructuredV2LeafPairs < targetStructuredV2LeafPairs
    || structuredV2LeafGames.size < targetStructuredV2LeafGames) {
    const candidate = choose(
      (record) => Number(
        record.resultIndex?.structuredV2LeafValuePairCount
      ) > 0,
      (record) => Number(
        record.resultIndex?.structuredV2LeafValuePairCount
      ) || 0
    );
    if (!add(candidate)) break;
  }
  while (selectedReferences < targetReferences
    || actionReferenceGames.size < targetActionReferenceGames) {
    const candidate = choose(
      (record) => unseenIdentities(record).length > 0,
      (record) => unseenIdentities(record).length
    );
    if (!add(candidate)) break;
  }
  while (selectedLeafPairs < targetLeafPairs
    || leafReferenceGames.size < targetLeafReferenceGames) {
    const candidate = choose(
      (record) => Number(record.resultIndex?.leafValuePairCount) > 0,
      (record) => Number(record.resultIndex?.leafValuePairCount) || 0
    );
    if (!add(candidate)) break;
  }
  while (selected.size < targetGames) {
    const candidate = choose(
      () => true,
      (record) => Number(record.resultIndex?.actionReferenceCount || 0) * 10
        + Number(record.resultIndex?.leafValuePairCount || 0)
    );
    if (!add(candidate)) break;
  }

  return [...selected]
    .sort((left, right) =>
      Number(left.workerIndex) - Number(right.workerIndex)
      || Number(left.gameIndex) - Number(right.gameIndex));
}

function summarizeCertificationGame(trajectories) {
  let actionReferences = 0;
  let leafPairs = 0;
  let structuredV2ActionReferences = 0;
  let structuredV2LeafPairs = 0;
  const actionCoverage = new Set();
  const leafCoverage = new Set();
  const actionPhases = new Set();
  const leafPhases = new Set();
  for (const trajectory of trajectories || []) {
    const coverageKey = `${trajectory?.deckId || "unknown"}:${normalizedTrajectorySeat(trajectory)}`;
    for (const step of trajectory?.steps || []) {
      const reference = evaluatorActionReference(step);
      const validActionReference = Boolean(reference);
      if (reference) {
        actionReferences += 1;
        if ((reference.evaluatorStatePairs || []).every((pair) =>
          validPublicStructuredEvidenceSnapshot(
            pair.recommendedStructuredState,
            {
              informationSetHash: step.informationSetHash
            }
          )
          && validPublicStructuredEvidenceSnapshot(
            pair.selectedStructuredState,
            {
              informationSetHash: step.informationSetHash
            }
          )
          && pair.recommendedStructuredState.engineFingerprint
            === pair.selectedStructuredState.engineFingerprint)) {
          structuredV2ActionReferences += 1;
        }
        actionCoverage.add(coverageKey);
        actionPhases.add(normalizeEvaluatorAuditStratum({
          stored: reference.auditStratum,
          state: step.state,
          recommendedAction: reference.correctActionKey,
          selectedAction: reference.comparedActionKey,
          legalActions: step.legalActionKeys,
          deckId: trajectory.deckId,
          seat: normalizedTrajectorySeat(trajectory)
        }).phaseBand);
      }
      const leafReferences = [
        validIndependentLeafValueReference(step.leafValueAuditReference)
          ? step.leafValueAuditReference
          : null,
        validActionRankingReference(step.actionRankingReference, {
          informationSetHash: step.informationSetHash,
          legalActionKeys: step.legalActionKeys
        })
          ? step.actionRankingReference?.leafValueReference
          : null
      ].filter(validLeafValueReference);
      for (const leafReference of leafReferences) {
        leafPairs += leafReference.pairs.length;
        structuredV2LeafPairs += (leafReference.pairs || []).filter((pair) =>
          validPublicStructuredEvidenceSnapshot(
            pair.correctStructuredState,
            { informationSetHash: step.informationSetHash }
          )
          && validPublicStructuredEvidenceSnapshot(
            pair.comparedStructuredState,
            { informationSetHash: step.informationSetHash }
          )
          && pair.correctStructuredState.engineFingerprint
            === pair.comparedStructuredState.engineFingerprint).length;
        leafCoverage.add(coverageKey);
        leafPhases.add(normalizeEvaluatorAuditStratum({
          stored: leafReference.auditStratum,
          state: step.state,
          recommendedAction: step.recommendedActionKey,
          selectedAction: step.selectedActionKey,
          legalActions: step.legalActionKeys,
          deckId: trajectory.deckId,
          seat: normalizedTrajectorySeat(trajectory)
        }).phaseBand);
      }
    }
  }
  return {
    actionReferences,
    leafPairs,
    structuredV2ActionReferences,
    structuredV2LeafPairs,
    actionCoverage,
    leafCoverage,
    actionPhases,
    leafPhases
  };
}

export function evaluatorBootstrapDatasetDescriptor(options) {
  const continuationLineage = options.continuationLineage || {};
  return {
    version: 15,
    engineFingerprint: options.engineFingerprint,
    learningTargetVersion: options.learningTargetVersion,
    teacherLabelVersion: options.teacherLabelVersion,
    continuationLineageVersion:
      Number(continuationLineage.version) || 0,
    continuationPolicyHash:
      continuationLineage.continuationPolicyHash || null,
    opponentPoolHash:
      continuationLineage.opponentPoolHash || null,
    teacherEvaluatorPoolHash:
      continuationLineage.teacherEvaluatorPoolHash || null,
    deckConfigurationHash:
      continuationLineage.deckConfigurationHash || null,
    seed: options.collection?.seed,
    maxActions: options.collection?.maxActions,
    temperature: options.collection?.temperature,
    mirrorFraction: options.collection?.mirrorFraction,
    bestOfThreeFraction: options.collection?.bestOfThreeFraction,
    balancedPairings: options.collection?.balancedPairings === true,
    pairingMode: options.collection?.balancedPairings === true
      ? "balanced-pairings"
      : "population-pairings",
    teacherEvaluatorMode: options.collection?.teacherEvaluatorMode || null,
    teacherFraction: options.collection?.teacherFraction,
    teacherBudget: options.collection?.teacherBudget,
    teacherCriticalBudget: options.collection?.teacherCriticalBudget,
    teacherUrgentBudget: options.collection?.teacherUrgentBudget,
    continuationSamplingContract: EVALUATOR_BOOTSTRAP_SAMPLING_CONTRACT,
    evidenceProtocol: options.evidenceProtocolManifest
      ? structuredClone(options.evidenceProtocolManifest)
      : null,
    minimumRepresentativeCalibrationGames: Math.max(
      100,
      Number(options.minimumRepresentativeCalibrationGames) || 100
    ),
    evidencePartitionContract: {
      version: 3,
      structuredEvidence: {
        schemaVersion: STRUCTURED_EVIDENCE_SCHEMA_VERSION,
        encoderFingerprint: STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
        formalHoldoutsRequireV2: true
      },
      training: EVALUATOR_TRAINING_PARTITION,
      certification: [...EVALUATOR_CERTIFICATION_PARTITIONS],
      all: [...EVALUATOR_EVIDENCE_PARTITIONS],
      requirements: Object.fromEntries(
        EVALUATOR_EVIDENCE_PARTITIONS.map((role) => [
          role,
          evaluatorBootstrapEvidenceRequirement(role, {
            ...options,
            completionPartitionRequirements: null,
            ignoreActionEvidenceProtocolRequirements: false
          })
        ])
      )
    },
    auditStrata: {
      version: EVALUATOR_AUDIT_STRATUM_VERSION,
      phaseBands: [...EVALUATOR_AUDIT_PHASE_BANDS],
      coreActionClasses: [...EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES],
      requirements: {
        ...EVALUATOR_BOOTSTRAP_PHASE_REQUIREMENTS,
        ...EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
      }
    },
    samplingModes: {
      calibration: {
        name: EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration,
        teacherFraction: 0,
        captureIndependentActionAudit: false,
        captureIndependentLeafAudit: false
      },
      leaf: {
        name: EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf,
        captureIndependentActionAudit: false,
        captureIndependentLeafAudit: true,
        teacherLeafAuditPairBudget: 1,
        stopTeacherAfterLeafAuditBudget: true
      },
      action: {
        name: EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action,
        bestOfThreeFraction: 0,
        deferIndependentActionAudit: true,
        teacherActionAuditCandidatePoolSize: 5,
        teacherActionAuditBudget: 1,
        teacherActionAuditMaximumQueries: 24,
        teacherActionAuditReducedQueryFraction: 0.35,
        teacherActionAuditSaturationQueries: 8,
        stopTeacherAfterActionAuditBudget: false,
        candidateRacingContract: options.evidenceProtocolManifest
          ? "candidate-racing-precommitted-8-32-128-v1"
          : "candidate-racing-8-16-32-64-v1",
        pilotPairs: 8,
        semifinalPairs: 16,
        selectionCheckpointPairs: [8, 16, 24, 32],
        selectionPairs: 32,
        finalCheckpointPairs: options.evidenceProtocolManifest
          ? [32, 64, 96, 128]
          : [16, 32, 48, 64],
        finalPairs: options.evidenceProtocolManifest ? 128 : 64,
        captureIndependentLeafAudit: false
      }
    },
    deckIds: [...(options.deckIds || [])],
    teacherScreenSimulations: options.collection?.teacherScreenSimulations,
    teacherConfirmationSimulations: options.collection?.teacherConfirmationSimulations,
    teacherConfirmationMaxSimulations: options.collection?.teacherConfirmationMaxSimulations,
    teacherDepth: options.collection?.teacherDepth,
    teacherCandidates: options.collection?.teacherCandidates,
    teacherLeafAuditSimulations:
      options.collection?.teacherLeafAuditSimulations,
    actionRankingReferenceVersion: ACTION_RANKING_REFERENCE_VERSION,
    actionRankingReferenceContract: ACTION_RANKING_REFERENCE_CONTRACT,
    actionRankingAuditReferenceVersion:
      ACTION_RANKING_AUDIT_REFERENCE_VERSION,
    actionRankingAuditReferenceContract:
      ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
    captureIndependentActionAudit:
      options.collection?.captureIndependentActionAudit === true,
    deferIndependentActionAudit:
      options.collection?.deferIndependentActionAudit === true,
    teacherActionAuditCandidatePoolSize:
      Number(options.collection?.teacherActionAuditCandidatePoolSize) || 0,
    captureIndependentLeafAudit:
      options.collection?.captureIndependentLeafAudit !== false,
    teacherActionAuditBudget:
      Number(options.collection?.teacherActionAuditBudget) || 0,
    teacherActionAuditMaximumQueries:
      Number(options.collection?.teacherActionAuditMaximumQueries) || 0,
    teacherActionAuditReducedQueryFraction:
      Number(options.collection?.teacherActionAuditReducedQueryFraction) || 0,
    teacherActionAuditSaturationQueries:
      Number(options.collection?.teacherActionAuditSaturationQueries) || 0,
    teacherActionAuditMaximumSteps:
      Number(options.collection?.teacherActionAuditMaximumSteps) || 0,
    leafValueReferenceVersion: LEAF_VALUE_REFERENCE_VERSION,
    leafValueReferenceContract: LEAF_VALUE_REFERENCE_CONTRACT
  };
}

export function evaluatorBootstrapDatasetKey(options) {
  const descriptor = evaluatorBootstrapDatasetDescriptor(options);
  return createHash("sha256")
    .update(JSON.stringify(descriptor))
    .digest("hex");
}

function assertEvaluatorBootstrapContinuationLineage(lineage) {
  const missing = [
    "continuationPolicyHash",
    "opponentPoolHash",
    "teacherEvaluatorPoolHash",
    "deckConfigurationHash"
  ].filter((key) => typeof lineage?.[key] !== "string"
    || lineage[key].length === 0);
  if (Number(lineage?.version) < 1 || missing.length > 0) {
    throw new Error(
      "Evaluator bootstrap requires frozen continuation lineage hashes: "
      + (missing.length ? missing.join(", ") : "version")
    );
  }
}

function evaluatorActionReference(step) {
  const auditReference = step?.actionRankingAuditReference;
  if (validActionRankingAuditReference(auditReference, {
    informationSetHash: step?.informationSetHash,
    legalActionKeys: step?.legalActionKeys
  })) return auditReference;
  return null;
}

function stableActionReferenceIdentity(reference) {
  return [
    reference.contract,
    reference.informationSetHash,
    reference.correctActionKey,
    reference.comparedActionKey
  ].join("|");
}

function mergeNumericCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + (Number(value) || 0);
  }
  return target;
}

function createLeafActionEffectAuditSummaryAccumulator() {
  return {
    comparisons: 0,
    targeted: 0,
    natural: 0,
    decisive: 0,
    nearEquivalent: 0,
    inconclusive: 0,
    totalPairedSamples: 0,
    weightedIntervalWidth: 0,
    phaseBands: {}
  };
}

function mergeLeafActionEffectAuditSummary(target, source = {}) {
  const comparisons = Math.max(0, Number(source.comparisons) || 0);
  target.comparisons += comparisons;
  for (const key of [
    "targeted", "natural", "decisive", "nearEquivalent", "inconclusive"
  ]) target[key] += Math.max(0, Number(source[key]) || 0);
  target.totalPairedSamples += Math.max(
    0,
    Number(source.totalPairedSamples) || 0
  );
  if (Number.isFinite(Number(source.meanIntervalWidth))) {
    target.weightedIntervalWidth +=
      Number(source.meanIntervalWidth) * comparisons;
  }
  for (const [phase, summary] of Object.entries(source.phaseBands || {})) {
    target.phaseBands[phase] ||= createLeafActionEffectAuditSummaryAccumulator();
    mergeLeafActionEffectAuditSummary(target.phaseBands[phase], summary);
  }
}

function finalizeLeafActionEffectAuditSummary(value) {
  return {
    comparisons: value.comparisons,
    targeted: value.targeted,
    natural: value.natural,
    decisive: value.decisive,
    nearEquivalent: value.nearEquivalent,
    inconclusive: value.inconclusive,
    totalPairedSamples: value.totalPairedSamples,
    meanIntervalWidth: value.comparisons > 0
      ? value.weightedIntervalWidth / value.comparisons
      : null,
    phaseBands: Object.fromEntries(
      Object.entries(value.phaseBands).map(([phase, summary]) => [
        phase,
        finalizeLeafActionEffectAuditSummary(summary)
      ])
    )
  };
}

function createNaturalDistributionAuditAccumulator() {
  return {
    states: 0,
    independentOpeningStates: 0,
    decisive: 0,
    predictions: 0,
    correctPredictions: 0,
    nearEquivalent: 0,
    inconclusive: 0,
    measuredRegretStates: 0,
    regretTotal: 0,
    regretValues: [],
    measuredObservedPairGapStates: 0,
    observedPairGapTotal: 0,
    strata: {}
  };
}

function createActionEvidencePairwiseRegretAccumulator() {
  return {
    comparisons: 0,
    observedRegretComparisons: 0,
    totalObservedRegret: 0,
    byScope: {},
    byPhase: {}
  };
}

function accumulateActionEvidencePairwiseRegret(
  target,
  assessment = {},
  phaseBand = "unknown"
) {
  target.comparisons += 1;
  const scope = String(
    assessment.observedPairGapScope
      || assessment.pairwiseRegretScope
      || "unknown"
  );
  const phase = String(phaseBand || "unknown");
  target.byScope[scope] ||= emptyPairwiseRegretBucket();
  target.byPhase[phase] ||= emptyPairwiseRegretBucket();
  target.byScope[scope].comparisons += 1;
  target.byPhase[phase].comparisons += 1;
  const observedPairGap = assessment.observedPairGap
    ?? assessment.pairwiseRegret;
  if (observedPairGap == null) return;
  const regret = Number(observedPairGap);
  if (!Number.isFinite(regret)) return;
  target.observedRegretComparisons += 1;
  target.totalObservedRegret += Math.max(0, regret);
  for (const bucket of [target.byScope[scope], target.byPhase[phase]]) {
    bucket.observedRegretComparisons += 1;
    bucket.totalObservedRegret += Math.max(0, regret);
  }
}

function emptyPairwiseRegretBucket() {
  return {
    comparisons: 0,
    observedRegretComparisons: 0,
    totalObservedRegret: 0
  };
}

function finalizeActionEvidencePairwiseRegret(target) {
  const finalizeBuckets = (buckets) => Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [key, {
      ...bucket,
      meanObservedPairwiseRegret: bucket.observedRegretComparisons > 0
        ? bucket.totalObservedRegret / bucket.observedRegretComparisons
        : null
    }])
  );
  return {
    version: 1,
    contract: "selected-action-observed-pair-gap-summary-v1",
    populationEstimate: false,
    comparisons: target.comparisons,
    observedRegretComparisons: target.observedRegretComparisons,
    totalObservedRegret: target.totalObservedRegret,
    meanObservedPairwiseRegret: target.observedRegretComparisons > 0
      ? target.totalObservedRegret / target.observedRegretComparisons
      : null,
    meanObservedPairGap: target.observedRegretComparisons > 0
      ? target.totalObservedRegret / target.observedRegretComparisons
      : null,
    byScope: finalizeBuckets(target.byScope),
    byPhase: finalizeBuckets(target.byPhase)
  };
}

function mergeNaturalDistributionAuditAccumulator(target, summary = {}) {
  const states = Math.max(0, Number(summary?.states) || 0);
  target.states += states;
  target.independentOpeningStates += Math.max(
    0,
    Number(summary?.independentOpeningStates) || 0
  );
  target.decisive += Math.max(0, Number(summary?.decisive) || 0);
  target.predictions += Math.max(0, Number(summary?.predictions) || 0);
  target.correctPredictions += Math.max(
    0,
    Number(summary?.correctPredictions) || 0
  );
  target.nearEquivalent += Math.max(
    0,
    Number(summary?.nearEquivalent) || 0
  );
  target.inconclusive += Math.max(
    0,
    Number(summary?.inconclusive) || 0
  );
  const regretValues = Array.isArray(summary?.measuredRegretValues)
    ? summary.measuredRegretValues.map(Number).filter(Number.isFinite)
      .map((value) => Math.max(0, Math.min(1, value)))
    : [];
  target.regretValues.push(...regretValues);
  target.measuredRegretStates += regretValues.length;
  target.regretTotal += regretValues.reduce((sum, value) => sum + value, 0);
  const measuredPairGaps = Math.max(
    0,
    Number(summary?.measuredObservedPairGapStates) || 0
  );
  target.measuredObservedPairGapStates += measuredPairGaps;
  target.observedPairGapTotal += measuredPairGaps * Math.max(
    0,
    Number(summary?.conditionalMeanObservedPairGap) || 0
  );
  for (const [key, value] of Object.entries(summary?.strata || {})) {
    const bucket = target.strata[key] || {
      states: 0,
      decisive: 0,
      correct: 0,
      predictions: 0,
      measuredRegretStates: 0,
      regret: 0
    };
    for (const field of [
      "states",
      "decisive",
      "correct",
      "predictions",
      "measuredRegretStates",
      "regret"
    ]) {
      bucket[field] += Math.max(0, Number(value?.[field]) || 0);
    }
    target.strata[key] = bucket;
  }
}

function finalizeNaturalDistributionAuditAccumulator(target) {
  const ratio = (numerator, denominator) =>
    denominator > 0 ? numerator / denominator : null;
  const strata = Object.fromEntries(Object.entries(target.strata).map(
    ([key, value]) => [key, {
      ...value,
      decisiveCoverage: ratio(value.decisive, value.states),
      conditionalAccuracy: ratio(value.correct, value.predictions),
      observedRegretCoverage: ratio(
        value.measuredRegretStates,
        value.states
      ),
      conditionalExpectedRegret: ratio(
        value.regret,
        value.measuredRegretStates
      ),
      expectedRegret: value.measuredRegretStates === value.states
        ? ratio(value.regret, value.states)
        : null,
      conservativePopulationRegretLowerBound: ratio(
        value.regret,
        value.states
      ),
      conservativePopulationRegretUpperBound: ratio(
        value.regret + value.states - value.measuredRegretStates,
        value.states
      )
    }]
  ));
  return {
    version: 2,
    contract: "natural-distribution-action-audit-summary-v2",
    states: target.states,
    independentOpeningStates: target.independentOpeningStates,
    decisive: target.decisive,
    decisiveCoverage: ratio(target.decisive, target.states),
    predictions: target.predictions,
    correctPredictions: target.correctPredictions,
    conditionalAccuracy: ratio(
      target.correctPredictions,
      target.predictions
    ),
    nearEquivalent: target.nearEquivalent,
    nearEquivalentRate: ratio(target.nearEquivalent, target.states),
    inconclusive: target.inconclusive,
    inconclusiveRate: ratio(target.inconclusive, target.states),
    measuredRegretStates: target.measuredRegretStates,
    measuredRegretValues: target.regretValues,
    observedRegretCoverage: ratio(
      target.measuredRegretStates,
      target.states
    ),
    conditionalExpectedRegret: ratio(
      target.regretTotal,
      target.measuredRegretStates
    ),
    conditionalExpectedRegretInterval:
      naturalRegretHoeffdingInterval(target.regretValues),
    expectedRegret: target.measuredRegretStates === target.states
      ? ratio(target.regretTotal, target.states)
      : null,
    conservativePopulationRegretLowerBound: ratio(
      target.regretTotal,
      target.states
    ),
    conservativePopulationRegretUpperBound: ratio(
      target.regretTotal + target.states - target.measuredRegretStates,
      target.states
    ),
    regretTailRisk: naturalRegretTailRisk(target.regretValues),
    measuredObservedPairGapStates: target.measuredObservedPairGapStates,
    observedPairGapCoverage: ratio(
      target.measuredObservedPairGapStates,
      target.states
    ),
    conditionalMeanObservedPairGap: ratio(
      target.observedPairGapTotal,
      target.measuredObservedPairGapStates
    ),
    observedPairGapPopulationEstimate: false,
    strata,
    weakestStrata: Object.entries(strata)
      .filter(([, value]) => value.predictions > 0)
      .sort((left, right) =>
        left[1].conditionalAccuracy - right[1].conditionalAccuracy
          || finiteNaturalMetric(right[1].conditionalExpectedRegret)
            - finiteNaturalMetric(left[1].conditionalExpectedRegret))
      .slice(0, 10)
      .map(([key, value]) => ({ key, ...value }))
  };
}

function naturalRegretTailRisk(values = []) {
  const finite = values.map(Number).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!finite.length) return {
    measuredStates: 0,
    aboveThreePercentRate: null,
    aboveFivePercentRate: null,
    worstTenPercentCvar: null
  };
  const descending = [...finite].sort((left, right) => right - left);
  const tailCount = Math.max(1, Math.ceil(descending.length * 0.1));
  return {
    measuredStates: finite.length,
    aboveThreePercentRate: finite.filter((value) => value >= 0.03).length
      / finite.length,
    aboveFivePercentRate: finite.filter((value) => value >= 0.05).length
      / finite.length,
    worstTenPercentCvar: descending.slice(0, tailCount)
      .reduce((sum, value) => sum + value, 0) / tailCount
  };
}

function naturalRegretHoeffdingInterval(values = [], confidence = 0.95) {
  const finite = values.map(Number).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!finite.length) return {
    method: "opening-state-hoeffding-v1",
    confidence,
    states: 0,
    mean: null,
    lowerBound: null,
    upperBound: null
  };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const radius = Math.sqrt(Math.log(2 / (1 - confidence)) / (2 * finite.length));
  return {
    method: "opening-state-hoeffding-v1",
    confidence,
    states: finite.length,
    mean,
    lowerBound: Math.max(0, mean - radius),
    upperBound: Math.min(1, mean + radius)
  };
}

function finiteNaturalMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : -Infinity;
}

export async function loadEvaluatorBootstrap(directory, datasetKey) {
  const records = [];
  const invalidRecords = [];
  try {
    const names = (await readdir(directory))
      .filter((name) => /^worker-\d+-game-\d+\.json\.gz$/.test(name))
      .sort();
    for (const name of names) {
      try {
        const archivePath = path.join(directory, name);
        const summaryPath = bootstrapSummaryPath(archivePath);
        const record = await loadOrCreateBootstrapSummaryRecord(
          archivePath,
          summaryPath,
          datasetKey
        );
        if (!record || record.resultIndex?.valid !== true) continue;
        records.push(record);
      } catch {}
    }
  } catch {}
  try {
    const names = (await readdir(path.join(directory, "invalid")))
      .filter((name) => /\.json\.gz$/.test(name))
      .sort();
    for (const name of names) {
      try {
        const archivePath = path.join(directory, "invalid", name);
        const summaryPath = bootstrapSummaryPath(archivePath);
        const record = await loadOrCreateBootstrapSummaryRecord(
          archivePath,
          summaryPath,
          datasetKey,
          { allowInvalid: true }
        );
        if (!record) continue;
        invalidRecords.push(record);
      } catch {}
    }
  } catch {}
  return {
    records,
    invalidRecords,
    trajectories: [],
    summaries: []
  };
}

export async function materializeEvaluatorBootstrapRecords(records = []) {
  const materialized = [];
  for await (const record of iterateEvaluatorBootstrapRecords(records)) {
    materialized.push(record);
  }
  return materialized;
}

export async function* iterateEvaluatorBootstrapRecords(records = []) {
  for (const record of records) {
    if (record?.result) {
      yield record;
      continue;
    }
    const payload = await readTrajectoryArchive(record.archivePath);
    const result = payload?.result || payload;
    if (!result || !Array.isArray(result.trajectories)) continue;
    for (const trajectory of result.trajectories) {
      trajectory.evaluatorBootstrapSamplingMode ||= record.samplingMode;
      trajectory.evaluatorBootstrapCertificationRole ||=
        record.certificationRole || null;
      reclassifyTrajectoryAuditStrata(trajectory);
    }
    yield {
      version: 2,
      datasetKey: record.datasetKey,
      workerIndex: record.workerIndex,
      gameIndex: record.gameIndex,
      samplingMode: record.samplingMode,
      certificationRole: record.certificationRole || null,
      archivePath: record.archivePath,
      summaryPath: record.summaryPath,
      resultIndex: record.resultIndex,
      result
    };
  }
}

async function loadOrCreateBootstrapSummaryRecord(
  archivePath,
  summaryPath,
  datasetKey,
  options = {}
) {
  try {
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    if (summary?.version === 1
      && summary.kind === "evaluator-bootstrap"
      && summary.datasetKey === datasetKey
      && validEvaluatorBootstrapResultIndex(summary.resultIndex)
      && await evaluatorBootstrapSummaryMatchesArchive(
        archivePath,
        summaryPath,
        summary
      )
      && (options.allowInvalid === true || summary.resultIndex.valid === true)) {
      return {
        version: 2,
        datasetKey,
        workerIndex: Number(summary.workerIndex),
        gameIndex: Number(summary.gameIndex),
        samplingMode: summary.samplingMode,
        certificationRole: summary.certificationRole || null,
        archivePath,
        summaryPath,
        detachedActionAuditComplete:
          summary.detachedActionAudit?.version === 1,
        resultIndex: summary.resultIndex
      };
    }
  } catch {}

  // Legacy evaluator-bootstrap archives wrapped the full result inside a
  // record. Convert only one archive at a time and retain just the compact
  // index, so resume memory is bounded by the largest individual game.
  const payload = await readTrajectoryArchive(archivePath);
  const legacyRecord = payload?.result ? payload : null;
  if (legacyRecord && legacyRecord.datasetKey !== datasetKey) return null;
  const result = legacyRecord?.result || payload;
  const resultIndex = createEvaluatorBootstrapResultIndex(result);
  if (options.allowInvalid !== true && resultIndex.valid !== true) return null;
  const coordinate = parseBootstrapCoordinate(archivePath);
  const summary = {
    version: 1,
    kind: "evaluator-bootstrap",
    datasetKey,
    workerIndex: Number(legacyRecord?.workerIndex ?? coordinate?.workerIndex),
    gameIndex: Number(legacyRecord?.gameIndex ?? coordinate?.gameIndex),
    samplingMode:
      legacyRecord?.samplingMode
      || result?.trajectories?.[0]?.evaluatorBootstrapSamplingMode
      || "unknown",
    certificationRole:
      legacyRecord?.certificationRole
      || result?.trajectories?.[0]?.evaluatorBootstrapCertificationRole
      || null,
    archiveFormat: legacyRecord ? "record-v1" : "result-v1",
    resultIndex
  };
  if (!Number.isFinite(summary.workerIndex)
    || !Number.isFinite(summary.gameIndex)) return null;
  await commitEvaluatorBootstrapSummary({
    archivePath,
    summaryPath,
    summary
  });
  return {
    version: 2,
    datasetKey,
    workerIndex: summary.workerIndex,
    gameIndex: summary.gameIndex,
    samplingMode: summary.samplingMode,
    certificationRole: summary.certificationRole || null,
    archivePath,
    summaryPath,
    detachedActionAuditComplete:
      summary.detachedActionAudit?.version === 1,
    resultIndex
  };
}

export async function pendingDetachedActionAuditRecords(records = []) {
  const pending = [];
  for (const record of records || []) {
    if (record.samplingMode
      !== EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
      || record.detachedActionAuditComplete === true
      || Number(record.resultIndex?.actionAuditRacing?.pilotAttempted) > 0
      || Number(record.resultIndex?.actionAuditRacing?.pairedSeedsCompleted) > 0
      || Number(record.resultIndex?.actionReferenceCount) > 0) {
      continue;
    }
    const payload = await readTrajectoryArchive(record.archivePath);
    const result = payload?.result || payload;
    if (result?.pendingActionAudit?.executionContract
      !== "global-seed-batch-queue-v1"
      || !Array.isArray(result.pendingActionAudit.candidates)
      || result.pendingActionAudit.candidates.length === 0) {
      continue;
    }
    pending.push(record);
  }
  return pending;
}

function bootstrapSummaryPath(archivePath) {
  return archivePath.replace(/\.json\.gz$/, ".summary.json");
}

async function readEvaluatorBootstrapStopRequest(stopRequestPath) {
  if (!stopRequestPath) return null;
  try {
    return JSON.parse(
      (await readFile(stopRequestPath, "utf8")).replace(/^\uFEFF/, "")
    );
  } catch {
    return null;
  }
}

function parseBootstrapCoordinate(archivePath) {
  const match = path.basename(archivePath).match(
    /^worker-(\d+)-game-(\d+)(?:-\d+)?\.json\.gz$/
  );
  if (!match) return null;
  return {
    workerIndex: Number(match[1]),
    gameIndex: Number(match[2])
  };
}

export function completedGameIndexMap(records, invalidRecords = [], invalidRetryLimit = 3) {
  const output = new Map();
  for (const record of records || []) {
    if (!output.has(record.workerIndex)) output.set(record.workerIndex, new Set());
    output.get(record.workerIndex).add(record.gameIndex);
  }
  const invalidCounts = invalidCoordinateCounts(invalidRecords);
  for (const [key, attempts] of invalidCounts) {
    if (attempts < invalidRetryLimit) continue;
    const [workerIndex, gameIndex] = key.split(":").map(Number);
    if (!output.has(workerIndex)) output.set(workerIndex, new Set());
    output.get(workerIndex).add(gameIndex);
  }
  return output;
}

function normalizedTrajectorySeat(trajectory) {
  if (trajectory?.playerId === "p1" || trajectory?.playerId === "p2") {
    return trajectory.playerId;
  }
  if (Number(trajectory?.playerSeat) === 0) return "p1";
  if (Number(trajectory?.playerSeat) === 1) return "p2";
  return "unknown";
}

function invalidCoordinateCounts(records = []) {
  const counts = new Map();
  for (const record of records) {
    const key = `${Number(record.workerIndex)}:${Number(record.gameIndex)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function exhaustedInvalidCoordinateCount(records = [], invalidRetryLimit = 3) {
  return [...invalidCoordinateCounts(records).values()]
    .filter((attempts) => attempts >= invalidRetryLimit).length;
}

function completedLogicalGames(dataset, invalidRetryLimit) {
  return (dataset?.records?.length || 0)
    + exhaustedInvalidCoordinateCount(dataset?.invalidRecords, invalidRetryLimit);
}

function validBootstrapGame(result) {
  const summaries = result?.summaries || [];
  return summaries.length > 0
    && summaries.every((summary) =>
      summary.completed === true
        && summary.invalid !== true
        && summary.naturallyCompleted !== false);
}

async function loadBootstrapAllocation(directory, datasetKey, initialGames) {
  try {
    const value = JSON.parse(
      await readFile(path.join(directory, "bootstrap-state.json"), "utf8")
    );
    if (value?.version === 1
      && value.datasetKey === datasetKey
      && Number(value.allocatedGames) >= initialGames) {
      return value;
    }
  } catch {}
  return {
    version: 1,
    datasetKey,
    status: "collecting",
    allocatedGames: initialGames,
    expansions: 0,
    updatedAt: new Date().toISOString()
  };
}

async function writeBootstrapAllocation(directory, allocation) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, "bootstrap-state.json");
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  let persistedMigration = null;
  try {
    const previous = JSON.parse(await readFile(filename, "utf8"));
    if (previous?.datasetKey === allocation?.datasetKey
      && previous.compatibilityMigration?.toDatasetKey
        === allocation?.datasetKey) {
      persistedMigration = previous.compatibilityMigration;
    }
  } catch {}
  const persistedAllocation = allocation?.compatibilityMigration
    || persistedMigration == null
    ? allocation
    : {
      ...allocation,
      compatibilityMigration: persistedMigration
    };
  await writeFile(
    temporary,
    `${JSON.stringify(persistedAllocation, null, 2)}\n`,
    "utf8"
  );
  await renameWithRetry(temporary, filename);
}
