export const LEAF_AUDIT_SCHEDULE_CONTRACT = "precommitted-leaf-audit-looks-v1";

export function leafAuditStages(maximum = 128) {
  if (!Number.isInteger(maximum) || maximum < 32 || maximum > 1024) {
    throw new Error("Sequential leaf audit maximum must be an integer from 32 to 1024.");
  }
  return [...new Set([32, 64, 128, 512, 1024].filter(n => n <= maximum).concat(maximum))];
}

export function leafAuditSchedule(maximum = 128) {
  const stages = leafAuditStages(maximum);
  return { version: 5, contract: LEAF_AUDIT_SCHEDULE_CONTRACT,
    stages, finalSimulations: maximum, familyWiseConfidence: 0.99,
    perStageConfidence: 1 - 0.01 / stages.length,
    evidenceSeedUse: "one-precommitted-bank-prefixes-v1",
    confidenceSpending: "bonferroni-precommitted-looks-v1" };
}

export function validLeafAuditSchedule(schedule, attempted) {
  if (schedule?.version !== 5 || schedule.contract !== LEAF_AUDIT_SCHEDULE_CONTRACT) return false;
  let expected;
  try { expected = leafAuditSchedule(schedule.finalSimulations); } catch { return false; }
  return Object.entries(expected).every(([key, value]) =>
    JSON.stringify(schedule[key]) === JSON.stringify(value))
    && expected.stages.includes(attempted) && schedule.completedStage === attempted;
}

export function leafAuditStoppingDecision(audit, schedule, options = {}) {
  const attempted = Number(audit?.attemptedPairs) || 0;
  if (!schedule.stages.includes(attempted)) throw new Error("Audit inspected outside its precommitted looks.");
  const fullyObserved = audit.samples === attempted
    && audit.determinizationAudit?.complete === true;
  const effect = Number(options.minimumEffect ?? 0.01);
  const margin = Number(options.equivalenceMargin ?? 0.01);
  if (fullyObserved && audit.confidence >= schedule.perStageConfidence) {
    if (audit.lowerBound > effect || audit.upperBound < -effect) {
      return { stop: true, outcome: "decisive" };
    }
    if (audit.lowerBound >= -margin && audit.upperBound <= margin) {
      return { stop: true, outcome: "equivalent" };
    }
  }
  return { stop: attempted === schedule.finalSimulations,
    outcome: attempted === schedule.finalSimulations ? "budget-exhausted-uncertain" : "continue" };
}
