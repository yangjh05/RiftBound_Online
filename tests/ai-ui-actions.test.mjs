import test from "node:test";
import assert from "node:assert/strict";
import { cards, decklists, makeRune } from "../src/cards.mjs";
import { createGame } from "../src/engine.mjs";
import {
  actionKey,
  applyAiAction,
  canonicalizeActionCommand,
  cloneGame,
  enumerateLegalActions,
  enumerateUiLegalActions,
  enumerateUiMoveUnitsActions,
  resolveLegalAction
} from "../src/ai/actions.mjs";
import {
  configureAiPerformance,
  resetAiPerformance,
  snapshotAiPerformance
} from "../src/ai/performance.mjs";

const decks = Object.values(decklists);
const UI_ACTION_KINDS = new Set([
  "beginPlayCard",
  "beginPlayCardFromTrash",
  "beginPlayChampion",
  "hideCard",
  "moveUnit",
  "moveUnits"
]);

test("UI legal actions preserve declaration and solo-move parity without AI preview clones", () => {
  const { game, actor } = createActionGame({ unitCount: 2 });
  actor.hand = [cardInstance(cards.lonelyPoro, actor.id, "ui-hand-card", "hand", {
    energy: 0,
    power: [],
    effects: []
  })];
  actor.trash = [cardInstance(cards.lonelyPoro, actor.id, "ui-trash-card", "trash", {
    energy: 0,
    power: [],
    effects: [{
      timing: "static",
      kind: "playSelfFromTrash",
      replacementEnergy: 0,
      replacementPower: []
    }]
  })];
  actor.champion = cardInstance(actor.availableChampions[0], actor.id, "ui-champion", "champion", {
    energy: 0,
    power: [],
    effects: []
  });
  actor.championPlayed = false;

  const reference = enumerateLegalActions(game, actor.id)
    .filter((action) => UI_ACTION_KINDS.has(action.kind) && action.kind !== "moveUnits")
    .map(actionKey)
    .sort();

  configureAiPerformance(true);
  try {
    resetAiPerformance();
    const actual = enumerateUiLegalActions(game, actor.id);
    const performance = snapshotAiPerformance();

    assert.deepEqual(actual.map(actionKey).sort(), reference);
    assert.equal(actual.every((action) => UI_ACTION_KINDS.has(action.kind)), true);
    assert.equal(actual.some((action) => action.kind === "moveUnits"), false,
      "the default UI query must not prebuild batch-move combinations");
    assert.equal(performance.cloneCalls, 0,
      "prevalidated hand/trash/champion plays and solo moves must stay read-only");
    for (const action of actual) {
      assert.equal(applyAiAction(cloneGame(game), action, actor.id).ok, true);
    }
  } finally {
    configureAiPerformance(false);
  }
});

test("UI batch movement enumerates only the exact selected unit set", () => {
  const { game, actor } = createActionGame({ unitCount: 5 });
  const pair = actor.base.slice(0, 2).map((unit) => unit.instanceId);
  const pairReference = enumerateLegalActions(game, actor.id)
    .filter((action) => action.kind === "moveUnits"
      && action.unitIds.length === pair.length
      && pair.every((unitId) => action.unitIds.includes(unitId)))
    .map(actionKey)
    .sort();
  const pairActions = enumerateUiMoveUnitsActions(game, pair, actor.id);

  assert.deepEqual(pairActions.map(actionKey).sort(), pairReference);

  const selected = actor.base.slice(0, 4).map((unit) => unit.instanceId);
  const exactActions = enumerateUiMoveUnitsActions(game, selected, actor.id);
  assert.equal(exactActions.length, game.battlefields.length);
  assert.equal(exactActions.every((action) => action.unitIds.length === selected.length
    && action.unitIds.every((unitId, index) => unitId === selected[index])), true);
  assert.equal(exactActions.every((action) => applyAiAction(cloneGame(game), action, actor.id).ok), true);
  assert.deepEqual(enumerateUiLegalActions(game, actor.id, { moveUnitIds: selected })
    .filter((action) => action.kind === "moveUnits"), exactActions);
  assert.equal(enumerateUiLegalActions(game, actor.id).some((action) => action.kind === "moveUnits"), false);
});

test("UI legal actions retain authoritative preview checks for hide and Hidden play", () => {
  const hideGame = createActionGame({ unitCount: 0 });
  const hideField = hideGame.game.battlefields[0];
  for (const field of hideGame.game.battlefields) field.controlledBy = hideGame.actor.id;
  hideGame.actor.hand = [cardInstance(cards.consultThePast, hideGame.actor.id, "ui-hide-card", "hand")];
  hideGame.actor.champion = cardInstance(hideGame.actor.availableChampions[0], hideGame.actor.id, "ui-hide-champion", "champion", {
    keywords: [...new Set([...(hideGame.actor.availableChampions[0].keywords || []), "Hidden"])],
    effects: []
  });
  hideGame.actor.championPlayed = false;
  hideGame.actor.runes = [runeInstance("Mind", hideGame.actor.id, "ui-hide-rune")];

  assertActionKindParity(hideGame.game, hideGame.actor.id, "hideCard");
  configureAiPerformance(true);
  resetAiPerformance();
  const hideActions = enumerateUiLegalActions(hideGame.game, hideGame.actor.id)
    .filter((action) => action.kind === "hideCard");
  assert.equal(hideActions.some((action) => action.cardId === "ui-hide-card"), true);
  assert.equal(hideActions.some((action) => action.cardId === "ui-hide-champion"), true);
  assert.equal(snapshotAiPerformance().applyCalls, 1,
    "equivalent Hidden source/destination pairs should share one authoritative preview");
  configureAiPerformance(false);

  hideGame.actor.runes = [];
  assertActionKindParity(hideGame.game, hideGame.actor.id, "hideCard");
  assert.equal(enumerateUiLegalActions(hideGame.game, hideGame.actor.id)
    .some((action) => action.kind === "hideCard"), false);

  const hiddenGame = createActionGame({ unitCount: 0 });
  const hiddenField = hiddenGame.game.battlefields[0];
  const hiddenCard = cardInstance(cards.consultThePast, hiddenGame.actor.id, "ui-hidden-card", "hidden", {
    hidden: true,
    hiddenBattlefieldId: hiddenField.instanceId
  });
  hiddenField.controlledBy = hiddenGame.actor.id;
  hiddenField.hidden = [{
    card: hiddenCard,
    ownerId: hiddenGame.actor.id,
    hiddenByPlayerId: hiddenGame.actor.id,
    playableFromTurnSequence: hiddenGame.game.turnSequence
  }];
  hiddenGame.game.phase = "showdown";
  hiddenGame.game.showdown = {
    battlefieldId: hiddenField.instanceId,
    attackerId: hiddenGame.actor.id,
    defenderId: hiddenGame.opponent.id,
    focusPlayerId: hiddenGame.actor.id,
    priorityPlayerId: hiddenGame.actor.id,
    chain: [],
    passedPlayerIds: [],
    consecutivePasses: 0,
    combat: true
  };

  assertActionKindParity(hiddenGame.game, hiddenGame.actor.id, "beginPlayCard");
  assert.equal(enumerateUiLegalActions(hiddenGame.game, hiddenGame.actor.id)
    .some((action) => action.kind === "beginPlayCard" && action.cardId === hiddenCard.instanceId), true);
});

test("exact command resolution previews only the matching candidate", () => {
  const { game, actor } = createActionGame({ unitCount: 0 });
  actor.hand = Array.from({ length: 6 }, (_, index) =>
    cardInstance(cards.lonelyPoro, actor.id, `resolver-card-${index}`, "hand", {
      energy: 0,
      power: [],
      effects: []
    }));
  const command = { kind: "beginPlayCard", cardId: "resolver-card-3", destination: "base" };

  configureAiPerformance(true);
  try {
    resetAiPerformance();
    assert.deepEqual(resolveLegalAction(game, command, actor.id), command);
    assert.equal(snapshotAiPerformance().cloneCalls, 1);
    assert.equal(snapshotAiPerformance().applyCalls, 1);

    resetAiPerformance();
    assert.equal(resolveLegalAction(game, { ...command, destination: "missing-field" }, actor.id), null);
    assert.equal(snapshotAiPerformance().cloneCalls, 0,
      "a command with no exact candidate must not preview unrelated same-kind actions");
    assert.equal(snapshotAiPerformance().applyCalls, 0,
      "a command with no exact candidate must not simulate unrelated same-kind actions");
  } finally {
    configureAiPerformance(false);
  }
});

test("local command canonicalization never clones or executes the game", () => {
  const { game, actor } = createActionGame({ unitCount: 0 });
  actor.hand = [cardInstance(cards.lonelyPoro, actor.id, "canonical-card", "hand", {
    energy: 0,
    power: [],
    effects: []
  })];
  const command = { kind: "beginPlayCard", cardId: "canonical-card", destination: "base" };

  configureAiPerformance(true);
  try {
    resetAiPerformance();
    assert.deepEqual(canonicalizeActionCommand(game, command, actor.id), command);
    assert.equal(snapshotAiPerformance().cloneCalls, 0);
    assert.equal(snapshotAiPerformance().applyCalls, 0);

    assert.equal(canonicalizeActionCommand(game, { ...command, destination: "missing-field" }, actor.id), null);
    assert.equal(snapshotAiPerformance().cloneCalls, 0);
    assert.equal(snapshotAiPerformance().applyCalls, 0);
  } finally {
    configureAiPerformance(false);
  }
});

test("zero-card mulligan confirmation remains canonical and executable", () => {
  const { game, actor } = createActionGame({ unitCount: 0 });
  game.phase = "mulligan";
  game.mulligan = { playerId: actor.id, selectedCardIds: [] };

  assert.deepEqual(canonicalizeActionCommand(game, { kind: "confirmMulligan" }, actor.id), {
    kind: "confirmMulligan"
  });
});

function createActionGame({ unitCount = 0 } = {}) {
  const game = createGame({
    decks: decks.slice(0, 2),
    firstPlayerId: "p1",
    interactive: true,
    manualActionChainPriority: true
  });
  const [actor, opponent] = game.players;
  actor.legend.effects = [];
  opponent.legend.effects = [];
  game.phase = "action";
  game.currentPlayerId = actor.id;
  game.turnPlayerId = actor.id;
  game.pendingChoice = null;
  game.pendingPayment = null;
  game.actionChain = null;
  game.showdown = null;
  game.stagedEvents = [];
  actor.hand = [];
  actor.trash = [];
  actor.runes = [];
  actor.base = Array.from({ length: unitCount }, (_, index) =>
    cardInstance(cards.lonelyPoro, actor.id, `ui-mover-${index + 1}`, "base", { effects: [] }));
  opponent.base = [];
  game.battlefields = actor.availableBattlefields.map((template, index) => ({
    ...structuredClone(template),
    instanceId: `ui-field-${index + 1}`,
    ownerId: null,
    controllerId: null,
    effects: [],
    units: [],
    hidden: [],
    controlledBy: null
  }));
  return { game, actor, opponent };
}

function cardInstance(template, playerId, instanceId, zone, overrides = {}) {
  return {
    ...structuredClone(template),
    instanceId,
    ownerId: playerId,
    controllerId: playerId,
    zone,
    exhausted: false,
    stunned: false,
    damage: 0,
    buffs: 0,
    mightModifier: 0,
    attachments: [],
    ...overrides
  };
}

function runeInstance(domain, playerId, instanceId) {
  return {
    ...structuredClone(makeRune(domain)),
    instanceId,
    ownerId: playerId,
    controllerId: playerId,
    zone: "runes",
    exhausted: false
  };
}

function assertActionKindParity(game, actorId, kind) {
  const reference = enumerateLegalActions(game, actorId)
    .filter((action) => action.kind === kind)
    .map(actionKey)
    .sort();
  const actual = enumerateUiLegalActions(game, actorId)
    .filter((action) => action.kind === kind)
    .map(actionKey)
    .sort();
  assert.deepEqual(actual, reference);
}
