import { createHash } from "node:crypto";

export const NATURAL_MIXTURE_SELECTION =
  "hash-priority-mixture-reservoir-policy-decision-v1";
export const NATURAL_MIXTURE_CHANNELS = Object.freeze({
  population: 0.25, mulligan: 0.5, early: 0.25
});

// The channel is committed before play. The population channel gives every
// decision positive inclusion probability, including unknown/setup phases.
export function naturalLeafSamplingChannel(parentTaskManifestHash) {
  const draw = createHash("sha256")
    .update(`${parentTaskManifestHash}:natural-mixture-channel-v1`)
    .digest().readUInt32BE(0) / 0x100000000;
  return draw < 0.25 ? "population" : draw < 0.75 ? "mulligan" : "early";
}

export function naturalLeafMixtureSamplingFrame(parent, phaseCounts, phaseBand) {
  const counts = Object.fromEntries(
    ["mulligan", "early", "mid", "late", "unknown"]
      .map(phase => [phase, Number(phaseCounts[phase]) || 0])
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total || !counts[phaseBand]) throw new Error("Missing natural sampling population");
  const frame = {
    version: 3,
    contract: "natural-leaf-audit-sampling-frame-v3",
    datasetKey: parent.datasetKey,
    taskIndex: parent.taskIndex,
    certificationRole: parent.certificationRole,
    scope: parent.scope || null,
    distribution: "natural-distribution",
    candidateSelection: NATURAL_MIXTURE_SELECTION,
    parentTaskManifestHash: parent.taskManifestHash,
    ...(parent.plannedFinalSimulations != null
      ? { plannedFinalSimulations: parent.plannedFinalSimulations } : {}),
    samplingChannel: naturalLeafSamplingChannel(parent.taskManifestHash),
    channelProbabilities: { ...NATURAL_MIXTURE_CHANNELS },
    phaseDecisionCounts: counts,
    selectedPhaseBand: phaseBand,
    eligibleDecisions: total,
    // A decision can be selected through either the population channel or
    // its phase channel. Use their SUM, not the conditional channel chance.
    selectionProbability: 0.25 / total
      + (phaseBand === "mulligan" ? 0.5 / counts.mulligan : 0)
      + (phaseBand === "early" ? 0.25 / counts.early : 0),
    weighting: "inverse-propensity-per-decision-v1"
  };
  return { ...frame, taskManifestHash: createHash("sha256")
    .update(JSON.stringify(frame)).digest("hex") };
}
