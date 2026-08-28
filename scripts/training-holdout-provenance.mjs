export const HOLDOUT_PROVENANCE_VERSION = 1;

export function holdoutProvenanceKey(collectionKey, gameId) {
  if (!collectionKey || !gameId) return null;
  return `${String(collectionKey)}\u0000${String(gameId)}`;
}

export function currentHoldoutProvenanceEntries(collectionKey, partitions = {}) {
  const roles = {
    retention: partitions.retention,
    "calibration-fit": partitions.calibrationFit,
    "calibration-test": partitions.calibrationTest,
    "evaluator-certification-audit": partitions.evaluatorAudit
  };
  const byKey = new Map();
  for (const [role, trajectories] of Object.entries(roles)) {
    for (const trajectory of trajectories || []) {
      const key = holdoutProvenanceKey(collectionKey, trajectory.gameId);
      if (!key) continue;
      const existing = byKey.get(key) || {
        collectionKey,
        gameId: trajectory.gameId,
        roles: []
      };
      if (!existing.roles.includes(role)) existing.roles.push(role);
      existing.roles.sort();
      byKey.set(key, existing);
    }
  }
  return [...byKey.values()].sort(compareProvenanceEntries);
}

export function mergeHoldoutProvenance(existing, additions, options = {}) {
  const engineFingerprint = options.engineFingerprint || existing?.engineFingerprint || null;
  const byKey = new Map();
  for (const entry of [...(existing?.entries || []), ...(additions || [])]) {
    const key = holdoutProvenanceKey(entry?.collectionKey, entry?.gameId);
    if (!key) continue;
    const previous = byKey.get(key) || {
      collectionKey: entry.collectionKey,
      gameId: entry.gameId,
      roles: []
    };
    previous.roles = [...new Set([
      ...(previous.roles || []),
      ...(entry.roles || [])
    ])].sort();
    byKey.set(key, previous);
  }
  const completeCollections = [...new Set([
    ...(existing?.completeCollections || []),
    ...(options.completeCollections || [])
  ])].sort();
  const observedCollections = new Set([
    ...(existing?.observedCollections || []),
    ...(options.observedCollections || []),
    ...[...byKey.values()].map((entry) => entry.collectionKey)
  ]);
  return {
    version: HOLDOUT_PROVENANCE_VERSION,
    engineFingerprint,
    entries: [...byKey.values()].sort(compareProvenanceEntries),
    completeCollections,
    observedCollections: [...observedCollections].sort()
  };
}

export function filterTrainingEligibleReplayEntries(entries, provenance, options = {}) {
  const expectedEngineFingerprint = options.engineFingerprint || null;
  const denied = new Set((provenance?.entries || [])
    .map((entry) => holdoutProvenanceKey(entry.collectionKey, entry.gameId))
    .filter(Boolean));
  const completeCollections = new Set(provenance?.completeCollections || []);
  const eligible = [];
  const rejected = [];
  for (const entry of entries || []) {
    let reason = null;
    const key = holdoutProvenanceKey(entry?.sourceCollectionKey, entry?.sourceGameId);
    if (!key) reason = "missing-source-provenance";
    else if (expectedEngineFingerprint
      && entry.sourceEngineFingerprint
      && entry.sourceEngineFingerprint !== expectedEngineFingerprint) {
      reason = "source-engine-mismatch";
    } else if (!completeCollections.has(entry.sourceCollectionKey)) {
      // Old buffers predate complete five-way partition provenance. Keeping
      // one of those entries would make it impossible to prove it was not a
      // retention/calibration/audit game, so fail closed.
      reason = "unverified-source-partition";
    } else if (denied.has(key)) {
      reason = "global-holdout-provenance";
    }
    if (reason) rejected.push({ ...entry, rejectionReason: reason });
    else eligible.push(entry);
  }
  return { eligible, rejected };
}

function compareProvenanceEntries(left, right) {
  return String(left.collectionKey).localeCompare(String(right.collectionKey))
    || String(left.gameId).localeCompare(String(right.gameId));
}
