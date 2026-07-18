import test from "node:test";
import assert from "node:assert/strict";

import {
  advancePresentation,
  chainCardInstanceIds,
  createPresentationState,
  rankPresentationHighlights,
  snapshotPresentationGame
} from "../src/presentation.mjs";

test("cardless showdown triggers and transient null chain entries are safe to present", () => {
  const game = {
    players: [],
    battlefields: [],
    showdown: {
      battlefieldId: "field",
      chain: [
        null,
        { id: "cardless-trigger", itemType: "trigger", playerId: "p1", card: null, trigger: { kind: "effectSpecs" } },
        { id: "card-item", itemType: "card", playerId: "p1", card: { instanceId: "chain-card", name: "Chain Card" } }
      ]
    },
    actionChain: null
  };

  assert.deepEqual(chainCardInstanceIds(game), ["chain-card"]);
  assert.doesNotThrow(() => snapshotPresentationGame(game));
  assert.deepEqual(snapshotPresentationGame(game).chain.map((item) => item.id), ["cardless-trigger", "card-item"]);
});

test("permanent play procedures are not presented as Chain cards", () => {
  const game = {
    players: [],
    battlefields: [],
    showdown: null,
    actionChain: {
      chain: [{
        id: "shen-play-procedure",
        itemType: "card",
        card: { instanceId: "shen", name: "Shen, Kinkou", type: "unit" }
      }]
    }
  };

  assert.deepEqual(chainCardInstanceIds(game), []);
  assert.deepEqual(snapshotPresentationGame(game).chain, []);
});

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

test("a point gained by a card effect is not presented as a battlefield score", () => {
  const state = createPresentationState();
  advancePresentation(state, snapshot({ scores: [2, 2], turnSequence: 5, scoreEvents: [] }), "p1");
  const result = advancePresentation(state, snapshot({
    scores: [3, 2],
    turnSequence: 6,
    scoreEvents: [{
      id: "score-event-1",
      playerId: "p1",
      amount: 1,
      kind: "effect",
      reason: "moveCountEffect",
      sourceName: "Arena's Greatest"
    }]
  }), "p1");

  assert.equal(result.highlights[0].scoreSource, "effect");
  assert.match(result.highlights[0].titleKo, /효과 득점/);
  assert.doesNotMatch(result.highlights[0].titleKo, /전장/);
  assert.match(result.highlights[0].detailKo, /효과로 얻은 점수/);
  assert.equal(result.cues.find((cue) => cue.kind === "score")?.calloutKo, "효과로 득점합니다");
});

test("match completion emits a viewer-relative victory cue and ranks the finisher first", () => {
  const state = createPresentationState();
  advancePresentation(state, snapshot({ scores: [7, 6], turnSequence: 9 }), "p1");
  const result = advancePresentation(state, snapshot({ scores: [8, 6], phase: "complete", winnerId: "p1", turnSequence: 10 }), "p1");

  assert.equal(result.impact.kind, "victory");
  assert.ok(result.cues.some((cue) => cue.kind === "victory"));
  const ranked = rankPresentationHighlights(state.highlights);
  assert.equal(ranked[0].kind, "finisher");
  assert.equal(ranked.filter((highlight) => ["victory", "finisher"].includes(highlight.kind)).length, 1,
    "the same winning score is summarized once");
  assert.equal(ranked[0].playerId, "p1");
});

function snapshot({
  scores = [0, 0],
  phase = "action",
  winnerId = null,
  units = [],
  trash = {},
  scoreEvents = [],
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
    scoreEvents,
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
