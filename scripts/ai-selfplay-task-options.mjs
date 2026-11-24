import { NATURAL_MIXTURE_SELECTION, naturalLeafSamplingChannel }
  from "../src/ai/neural/natural-leaf-sampling.mjs";
import { assertLegalTrainingDeck, trainingDeckKey } from "../src/ai/legal-decks.mjs";
import {LEAGUE_COLLECTION} from './league-selfplay-contract.mjs';

// Only per-game collection settings may override the initialized worker.
// Model tensors, base seeds and output directories stay frozen. The optional
// engine RNG seed is derived from the assigned task, never supplied arbitrarily.
export function selfPlayTaskOptions(baseOptions, task) {
  const overrides = task?.optionOverrides;
  const merged = { ...baseOptions };
  if (overrides && typeof overrides === "object") {
    for (const key of [
      "deckCurriculum", "resultHandoff", "teacherLeafAuditFocusPhaseBands",
      "teacherActionAuditFocusPhaseBands", "teacherActionAuditFocusActionClasses",
      "evidenceSamplingFrame", "teacherLeafAuditSimulations", "teacherLeafAuditPairBudget",
      "detachedIndependentLeafAudit", "maxActions", "deterministicGameRandomness", "learnFirstPlayerChoice"
    ]) {
      if (Object.hasOwn(overrides, key)) merged[key] = overrides[key];
    }
    if (overrides.deckSearchAssignment) {
      const assignment = overrides.deckSearchAssignment;
      if (assignment.contract !== "legal-seeded-deck-search-v1"
        || assignment.poolId !== "origins-era"
        || !Array.isArray(assignment.decks) || ![1, 2].includes(assignment.decks.length)
        || JSON.stringify(assignment.configurationKeys) !== JSON.stringify(assignment.decks.map(trainingDeckKey))) {
        throw new Error("Invalid frozen deck search assignment.");
      }
      for (const deck of assignment.decks) assertLegalTrainingDeck(deck, assignment.poolId);
      merged.decks = assignment.decks;
      merged.deckSearchAssignment = assignment;
      merged.balancedPairings = true;
      merged.mirrorFraction = assignment.decks.length === 1 ? 1 : 0;
      merged.bestOfThreeFraction = 0;
      merged.deckCurriculum = null;
      merged.deckSeatScheduleVersion = "deck-seat-schedule-v2";
    }
    if(overrides.leagueGameAssignment){
      const a=overrides.leagueGameAssignment;
      if(a.contract!==LEAGUE_COLLECTION||!Number.isInteger(a.opponentIndex)||a.opponentIndex<0
        ||a.opponentIndex>=(baseOptions.league?.length||0)||![0,1].includes(a.learnerSeat))
        throw new Error('Invalid frozen league assignment.');
      merged.leagueGameAssignment=a;
      merged.leagueSamplingWeights=baseOptions.league.map((_,i)=>i===a.opponentIndex?1:0);
      // Curriculum must not silently filter the committed opponent pool.
      merged.deckCurriculum=null;
    }
  }
  if (merged.maxActions != null && (!Number.isInteger(merged.maxActions) || merged.maxActions < 1)) {
    throw new Error("Invalid per-task action budget.");
  }
  if (merged.learnFirstPlayerChoice != null && typeof merged.learnFirstPlayerChoice !== 'boolean') {
    throw new Error('Invalid first-player choice collection setting.');
  }
  if (merged.deterministicGameRandomness === true) {
    if (!Number.isInteger(task.seed) || !Number.isInteger(task.gameIndex) || task.gameIndex < 0) {
      throw new Error("Deterministic game collection requires an assigned task seed and index.");
    }
    // Xorshift's zero state is absorbing, so give that rare seed a nonzero state.
    merged.randomSeed = ((task.seed + task.gameIndex * 130363) >>> 0) || 1;
  }
  const simulations = Number(merged.teacherLeafAuditSimulations ?? 128);
  if (!Number.isInteger(simulations) || simulations < 0 || simulations > 1024) {
    throw new Error("Invalid per-task leaf audit simulation budget.");
  }
  merged.teacherLeafAuditSimulations = simulations;
  const planned = merged.evidenceSamplingFrame?.plannedFinalSimulations;
  if (planned != null && Number(planned) !== simulations) {
    throw new Error(`Leaf audit precision mismatch: planned ${planned}, applied ${simulations}.`);
  }
  if (merged.teacherLeafAuditPairBudget != null) {
    const budget = Number(merged.teacherLeafAuditPairBudget);
    if (!Number.isInteger(budget) || budget < 0) {
      throw new Error("Invalid per-task leaf audit pair budget.");
    }
    merged.teacherLeafAuditPairBudget = budget;
  }
  return merged;
}

export function selfPlayAppliedAuditSettings(options) {
  return {
    version: 1,
    maxActions: options.maxActions ?? null,
    gameRandomSeed: options.randomSeed ?? null,
    learnFirstPlayerChoice: options.learnFirstPlayerChoice === true,
    teacherLeafAuditSimulations: options.teacherLeafAuditSimulations,
    teacherLeafAuditPairBudget: options.teacherLeafAuditPairBudget ?? null,
    detachedIndependentLeafAudit: options.detachedIndependentLeafAudit === true,
    distribution: options.evidenceSamplingFrame?.distribution || null,
    samplingContract: options.evidenceSamplingFrame?.candidateSelection || null,
    samplingChannel: options.evidenceSamplingFrame?.candidateSelection === NATURAL_MIXTURE_SELECTION
      ? naturalLeafSamplingChannel(options.evidenceSamplingFrame.taskManifestHash) : null,
    taskManifestHash: options.evidenceSamplingFrame?.taskManifestHash || null
  };
}
