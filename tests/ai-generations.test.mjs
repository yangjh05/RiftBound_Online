import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_GENERATIONS,
  DEFAULT_AI_GENERATION,
  aiGenerationDescriptor,
  normalizeAiGeneration,
  sameDeckConfiguration
} from "../src/ai/generations.mjs";
import { FOCUSED_TRAINING_DECK_IDS } from "../src/ai/training-decks.mjs";

test("AI generation catalog exposes the installed checkpoint and its five-deck scope", () => {
  assert.equal(DEFAULT_AI_GENERATION, 0);
  assert.equal(AI_GENERATIONS.length, 1);
  assert.deepEqual(AI_GENERATIONS[0].trainingDeckIds, FOCUSED_TRAINING_DECK_IDS);
  assert.equal(AI_GENERATIONS[0].trainingDeckIds.length, 5);
  assert.equal(aiGenerationDescriptor("0"), AI_GENERATIONS[0]);
  assert.equal(aiGenerationDescriptor("99"), null);
  assert.equal(normalizeAiGeneration("99"), DEFAULT_AI_GENERATION);
});

test("AI deck eligibility compares the complete gameplay configuration", () => {
  const trained = {
    legend: "legend",
    battlefields: ["field-b", "field-a"],
    main: [["card-a", 3], ["card-b", 1]],
    sideboard: [["card-c", 2]],
    runes: [["rune-a", 6], ["rune-b", 6]]
  };
  const reorderedCopy = {
    ...trained,
    battlefields: ["field-a", "field-b"],
    main: [["card-b", 1], ["card-a", 3]],
    runes: [["rune-b", 6], ["rune-a", 6]]
  };

  assert.equal(sameDeckConfiguration(trained, reorderedCopy), true);
  assert.equal(sameDeckConfiguration(trained, {
    ...reorderedCopy,
    main: [["card-b", 1], ["card-a", 2]]
  }), false);
});
