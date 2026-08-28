import { FOCUSED_TRAINING_DECK_IDS } from "./training-decks.mjs";

export const AI_GENERATIONS = Object.freeze([
  Object.freeze({
    generation: 0,
    checkpoint: "./ai/checkpoints/neural-champion.json",
    trainingDeckIds: FOCUSED_TRAINING_DECK_IDS
  })
]);

export const DEFAULT_AI_GENERATION = AI_GENERATIONS.at(-1).generation;

export function aiGenerationDescriptor(value) {
  const generation = Number(value);
  return AI_GENERATIONS.find((entry) => entry.generation === generation) || null;
}

export function normalizeAiGeneration(value) {
  return aiGenerationDescriptor(value)?.generation ?? DEFAULT_AI_GENERATION;
}

export function sameDeckConfiguration(left, right) {
  if (!left || !right || left.legend !== right.legend) return false;
  return sameValues(left.battlefields, right.battlefields)
    && sameCountEntries(left.main, right.main)
    && sameCountEntries(left.sideboard, right.sideboard)
    && sameCountEntries(left.runes, right.runes);
}

function sameValues(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

function sameCountEntries(left, right) {
  const normalize = (entries) => (entries || [])
    .filter(([, count]) => Number(count) > 0)
    .map(([id, count]) => [String(id), Number(count)])
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
