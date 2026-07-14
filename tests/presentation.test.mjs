import test from "node:test";
import assert from "node:assert/strict";

import {
  advancePresentation,
  createPresentationState,
  rankPresentationHighlights
} from "../src/presentation.mjs";

test("a score that erases a two-point deficit is presented as a comeback", () => {
  const state = createPresentationState();
  advancePresentation(state, snapshot({ scores: [2, 5], turnSequence: 3 }), "p1");
  const result = advancePresentation(state, snapshot({ scores: [5, 5], turnSequence: 4 }), "p1");

  assert.equal(result.impact.kind, "comeback");
  assert.equal(result.highlights[0].kind, "comeback");
  assert.match(result.highlights[0].titleKo, /뒤집/);
  assert.ok(result.cues.some((cue) => cue.kind === "comeback"));
});

test("multiple disposed units in one transition create a battlefield sweep highlight", () => {
  const state = createPresentationState();
  const units = [
    unit("u1", "p2", 3),
    unit("u2", "p2", 4),
    unit("u3", "p2", 2)
  ];
  advancePresentation(state, snapshot({ units, turnSequence: 5 }), "p1");
  const result = advancePresentation(state, snapshot({ units: [], trash: { p2: ["u1", "u2", "u3"] }, turnSequence: 6 }), "p1");

  assert.equal(result.impact.kind, "sweep");
  assert.equal(result.highlights[0].kind, "sweep");
  assert.equal(result.highlights[0].count, 3);
  assert.ok(result.cues.some((cue) => cue.kind === "multi-kill"));
});

test("match completion emits a viewer-relative victory cue and ranks the finisher first", () => {
  const state = createPresentationState();
  advancePresentation(state, snapshot({ scores: [7, 6], turnSequence: 9 }), "p1");
  const result = advancePresentation(state, snapshot({ scores: [8, 6], phase: "complete", winnerId: "p1", turnSequence: 10 }), "p1");

  assert.equal(result.impact.kind, "victory");
  assert.ok(result.cues.some((cue) => cue.kind === "victory"));
  const ranked = rankPresentationHighlights(state.highlights);
  assert.equal(ranked[0].kind, "victory");
  assert.equal(ranked[0].playerId, "p1");
});

function snapshot({
  scores = [0, 0],
  phase = "action",
  winnerId = null,
  units = [],
  trash = {},
  turnSequence = 1
} = {}) {
  return {
    gameKey: "match-1",
    phase,
    turnNumber: Math.max(1, Math.ceil(turnSequence / 2)),
    turnSequence,
    currentPlayerId: "p1",
    winnerId,
    victoryScore: 8,
    players: [
      player("p1", "Alpha", scores[0], trash.p1 || []),
      player("p2", "Beta", scores[1], trash.p2 || [])
    ],
    units,
    chain: [],
    showdownId: null,
    effectStamp: 0,
    effectMessage: "",
    logHead: winnerId ? `Alpha wins at ${scores[0]} points.` : "",
    surrenderedPlayerId: null
  };
}

function player(id, name, score, trashIds) {
  return { id, name, score, xp: 0, handCount: 5, trashIds, banishedIds: [] };
}

function unit(id, playerId, might) {
  return { id, playerId, name: id, might, damage: 0, location: "field" };
}
