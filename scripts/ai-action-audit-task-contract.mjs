import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";

export const ACTION_AUDIT_SEED_BATCH_CONTRACT =
  "independent-action-audit-seed-batch-v1";
export const REMOTE_ACTION_AUDIT_PROTOCOL_VERSION = 1;

export function serializableActionAuditTask(task = {}) {
  const { entry, ...serializable } = task;
  return serializable;
}

export function validateActionAuditTask(task = {}) {
  if (!task.taskId || !task.candidateId || !task.candidatePath
    || !task.outputPath || !task.bank) {
    throw new Error("Action-audit task is missing a required identifier or path.");
  }
  if (!Array.isArray(task.seeds) || task.seeds.length === 0) {
    throw new Error(`Action-audit task ${task.taskId} has no seeds.`);
  }
  const normalizedSeeds = task.seeds.map((seed) => {
    const numericSeed = Number(seed);
    if (!Number.isInteger(numericSeed)
      || numericSeed < 0
      || numericSeed > 0xffff_ffff) {
      throw new Error(
        `Action-audit task ${task.taskId} contains an invalid uint32 seed.`
      );
    }
    return numericSeed >>> 0;
  });
  if (new Set(normalizedSeeds).size !== normalizedSeeds.length) {
    throw new Error(`Action-audit task ${task.taskId} contains duplicate seeds.`);
  }
  if (task.informationSetHash !== undefined
    && task.informationSetHash !== null
    && !String(task.informationSetHash).trim()) {
    throw new Error(`Action-audit task ${task.taskId} has an empty information-set hash.`);
  }
  const maximumSteps = Number(task.maximumSteps);
  if (!Number.isInteger(maximumSteps) || maximumSteps < 1) {
    throw new Error(
      `Action-audit task ${task.taskId} has an invalid maximum step count.`
    );
  }
  const protocolPairIds = Array.from(
    task.protocolPairIds || [],
    String
  ).sort();
  if (new Set(protocolPairIds).size !== protocolPairIds.length
    || protocolPairIds.some((id) => !id.includes("::"))) {
    throw new Error(
      `Action-audit task ${task.taskId} has invalid protocol pair IDs.`
    );
  }
  if (task.evidenceProtocolHash && protocolPairIds.length === 0) {
    throw new Error(
      `Action-audit task ${task.taskId} is missing protocol pair IDs.`
    );
  }
  return {
    ...task,
    seeds: normalizedSeeds,
    maximumSteps,
    protocolPairIds
  };
}

export async function readValidatedActionAuditSeedBatchOutput(
  task,
  outputPath
) {
  const expected = validateActionAuditTask(task);
  const payload = await readTrajectoryArchive(outputPath);
  const actualSeeds = Array.from(
    payload?.seeds || [],
    (seed) => Number(seed) >>> 0
  );
  if (payload?.contract !== ACTION_AUDIT_SEED_BATCH_CONTRACT
    || payload?.taskId !== expected.taskId
    || payload?.candidateId !== expected.candidateId
    || payload?.bank !== expected.bank
    || actualSeeds.length !== expected.seeds.length
    || actualSeeds.some((seed, index) => seed !== expected.seeds[index])
    || !optionalFieldMatches(payload, expected, "datasetKey")
    || !optionalFieldMatches(payload, expected, "informationSetHash")
    || !optionalFieldMatches(payload, expected, "engineFingerprint")
    || !optionalFieldMatches(payload, expected, "evidenceProtocolHash")
    || !validProtocolResultSeeds(
      payload?.protocolResults,
      expected.seeds,
      expected.protocolPairIds
    )) {
    throw new Error(
      `Detached action-audit seed batch does not match task ${expected.taskId}.`
    );
  }
  return payload;
}

function validProtocolResultSeeds(
  protocolResults,
  expectedSeeds,
  expectedPairIds = []
) {
  if (protocolResults === undefined) return expectedPairIds.length === 0;
  if (!Array.isArray(protocolResults)) return false;
  if (protocolResults.some((item) =>
    !item?.continuationId || !item?.opponentId)) return false;
  const pairIds = protocolResults.map((item) =>
    `${item?.continuationId || ""}::${item?.opponentId || ""}`).sort();
  if (new Set(pairIds).size !== pairIds.length
    || pairIds.length !== expectedPairIds.length
    || pairIds.some((id, index) => id !== expectedPairIds[index])) {
    return false;
  }
  return protocolResults.every((item) =>
    Array.isArray(item?.results)
      && item.results.length > 0
      && item.results.every((result) => {
        const seeds = Array.from(
          result?.simulationSeeds || [],
          (seed) => Number(seed) >>> 0
        ).sort((left, right) => left - right);
        const expected = [...expectedSeeds].sort(
          (left, right) => left - right
        );
        return seeds.length === expectedSeeds.length
          && seeds.every((seed, index) => seed === expected[index]);
      }));
}

function optionalFieldMatches(payload, expected, key) {
  const expectedValue = expected?.[key];
  if (expectedValue === undefined || expectedValue === null) return true;
  return payload?.[key] === expectedValue;
}
