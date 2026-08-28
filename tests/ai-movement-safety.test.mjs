import test from "node:test";
import assert from "node:assert/strict";
import { cards, decklists } from "../src/cards.mjs";
import { createGame } from "../src/engine.mjs";
import { actionKey, applyAiAction, enumerateAiPolicyActions, enumerateLegalActions } from "../src/ai/actions.mjs";
import { movementProfile, tacticalActionProfile, temporaryCommitmentProfile } from "../src/ai/action-tactics.mjs";

const decks = Object.values(decklists);

function makeUnit(template, playerId, instanceId, might, extra = {}) {
  return {
    ...structuredClone(template),
    instanceId,
    ownerId: playerId,
    controllerId: playerId,
    zone: "base",
    type: "unit",
    might,
    damage: 0,
    buffs: 0,
    mightModifier: 0,
    exhausted: false,
    attachments: [],
    effects: [],
    keywords: [],
    ...extra
  };
}

function createActionGame({ friendlyMight = [2, 2], enemyMight = 3, enemyExtra = {}, hand = [] } = {}) {
  const game = createGame({
    decks: decks.slice(0, 2),
    firstPlayerId: "p1",
    interactive: true,
    manualActionChainPriority: true
  });
  const actor = game.players[0];
  const opponent = game.players[1];
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
  actor.base = friendlyMight.map((might, index) =>
    makeUnit(cards.lonelyPoro, actor.id, `friendly-${index + 1}`, might));
  actor.hand = hand;
  actor.runes = [];
  opponent.base = [];
  game.battlefields = actor.availableBattlefields.map((template, index) => ({
    ...structuredClone(template),
    instanceId: `test-field-${index + 1}`,
    ownerId: null,
    controllerId: null,
    effects: [],
    units: [],
    hidden: [],
    controlledBy: null
  }));
  const field = game.battlefields[0];
  field.effects = [];
  field.hidden = [];
  field.controlledBy = opponent.id;
  field.units = [makeUnit(cards.deadbloomPredator, opponent.id, "enemy", enemyMight, {
    zone: "battlefield",
    ...enemyExtra
  })];
  for (const other of game.battlefields.slice(1)) {
    other.effects = [];
    other.hidden = [];
    other.units = [];
    other.controlledBy = null;
  }
  return { game, actor, opponent, field };
}

function freeCard(template, playerId, instanceId) {
  return {
    ...structuredClone(template),
    instanceId,
    ownerId: playerId,
    controllerId: playerId,
    zone: "hand",
    energy: 0,
    power: []
  };
}

function battlefieldUnit(template, playerId, instanceId, might = template.might) {
  return makeUnit(template, playerId, instanceId, might, {
    zone: "battlefield",
    effects: structuredClone(template.effects || []),
    keywords: [...(template.keywords || [])]
  });
}

test("shared movement preflight preserves the authoritative legal action set", () => {
  const cases = [];

  const baseCase = createActionGame({ friendlyMight: [2, 3, 4] });
  cases.push(baseCase);

  const mixedCase = createActionGame({ friendlyMight: [2, 3] });
  const movingFromField = mixedCase.actor.base.shift();
  movingFromField.zone = "battlefield";
  movingFromField.keywords = ["Ganking"];
  mixedCase.game.battlefields[1].units.push(movingFromField);
  mixedCase.game.battlefields[1].controlledBy = mixedCase.actor.id;
  mixedCase.actor.base[0].exhausted = true;
  cases.push(mixedCase);

  const immobileCase = createActionGame({ friendlyMight: [2, 3] });
  immobileCase.actor.base[0].cantMoveThisTurn = true;
  immobileCase.actor.base[1].exhausted = true;
  cases.push(immobileCase);

  for (const { game, actor } of cases) {
    const reference = enumerateLegalActions(game, actor.id).map(actionKey).sort();
    const optimized = enumerateLegalActions(game, actor.id, {
      useSharedStandardMoveLegality: true
    }).map(actionKey).sort();
    assert.deepEqual(optimized, reference);
  }
});

test("AI rejects a no-impact solo attack while retaining the simultaneous breakthrough", () => {
  const { game, actor, field } = createActionGame();
  const solo = { kind: "moveUnit", unitId: "friendly-1", destinationId: field.instanceId };
  const batch = { kind: "moveUnits", unitIds: ["friendly-1", "friendly-2"], destinationId: field.instanceId };
  const soloProfile = movementProfile(game, actor.id, solo);
  const batchProfile = movementProfile(game, actor.id, batch);

  assert.equal(soloProfile.noOpponentImpact, true);
  assert.equal(soloProfile.canRemoveEnemyNoResponse, false);
  assert.equal(batchProfile.movingUnitCount, 2);
  assert.equal(batchProfile.canRemoveEnemyNoResponse, true);
  assert.equal(batchProfile.noOpponentImpact, false);

  const actions = enumerateAiPolicyActions(game, actor.id);
  assert.equal(actions.some((action) => action.kind === "moveUnit"
    && action.unitId === solo.unitId && action.destinationId === field.instanceId), false);
  assert.equal(actions.some((action) => action.kind === "moveUnits"
    && action.destinationId === field.instanceId
    && action.unitIds.length === 2), true);
});

test("AI retains a weak-looking attack when a payable Reaction creates an enemy removal threat", () => {
  const reaction = {
    ...structuredClone(cards.discipline),
    instanceId: "combat-reaction",
    ownerId: "p1",
    controllerId: "p1",
    zone: "hand",
    energy: 0,
    power: [],
    effects: [{ timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2, temporary: true }]
  };
  const { game, actor, field } = createActionGame({ friendlyMight: [1], enemyMight: 3, hand: [reaction] });
  const attack = { kind: "moveUnit", unitId: "friendly-1", destinationId: field.instanceId };
  const profile = movementProfile(game, actor.id, attack);

  assert.equal(profile.canRemoveEnemyNoResponse, false);
  assert.equal(profile.tacticalRemovalPossible, true);
  assert.deepEqual(profile.tacticalFollowupCardNumbers, [reaction.cardNumber]);
  assert.equal(enumerateAiPolicyActions(game, actor.id).some((action) =>
    action.kind === "moveUnit" && action.unitId === "friendly-1"
      && action.destinationId === field.instanceId), true);
});

test("temporary-only resource commitments require a response or breakthrough purpose", () => {
  const temporarySpell = {
    ...structuredClone(cards.primalStrength),
    instanceId: "temporary-spell",
    ownerId: "p1",
    controllerId: "p1",
    zone: "hand",
    energy: 0,
    power: [],
    type: "spell",
    text: "Give a friendly unit +2 Might this turn.",
    effects: [{ timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2, temporary: true }]
  };
  const weak = createActionGame({ friendlyMight: [1], enemyMight: 5, hand: [temporarySpell] });
  const play = { kind: "beginPlayCard", cardId: temporarySpell.instanceId };
  assert.deepEqual(temporaryCommitmentProfile(weak.game, weak.actor.id, play), {
    isTemporaryCommitment: true,
    clearPurpose: false,
    reason: "no-current-turn-payoff"
  });

  const breakthrough = createActionGame({ friendlyMight: [1], enemyMight: 3, hand: [temporarySpell] });
  assert.equal(temporaryCommitmentProfile(breakthrough.game, breakthrough.actor.id, play).clearPurpose, true);

  weak.game.actionChain = {
    priorityPlayerId: weak.actor.id,
    chain: [{
      playerId: weak.opponent.id,
      card: {
        instanceId: "enemy-removal",
        controllerId: weak.opponent.id,
        effects: [{ timing: "spell", kind: "damage", target: "friendlyUnit", amount: 3 }]
      }
    }]
  };
  assert.equal(temporaryCommitmentProfile(weak.game, weak.actor.id, play).clearPurpose, true);

  weak.game.actionChain.chain[0].card.effects = [{ timing: "spell", kind: "killUnit", target: "friendlyUnit" }];
  assert.equal(temporaryCommitmentProfile(weak.game, weak.actor.id, play).clearPurpose, false,
    "ordinary Might cannot answer unconditional removal");

  const saveSpell = {
    ...temporarySpell,
    instanceId: "temporary-save",
    text: "The next time a friendly unit would die this turn, save it.",
    effects: [{ timing: "spell", kind: "saveFriendlyUnitThisTurn", temporary: true }]
  };
  weak.actor.hand.push(saveSpell);
  assert.equal(temporaryCommitmentProfile(weak.game, weak.actor.id,
    { kind: "beginPlayCard", cardId: saveSpell.instanceId }).clearPurpose, true);
});

test("movement safety uses dynamic Might instead of rejecting a real static-effect breakthrough", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [1], enemyMight: 4 });
  actor.score = 4;
  actor.base[0].effects = [{ timing: "static", kind: "selfMightByPoints" }];
  const action = { kind: "moveUnit", unitId: actor.base[0].instanceId, destinationId: field.instanceId };
  const profile = movementProfile(game, actor.id, action);
  assert.equal(profile.attackingMight, 5);
  assert.equal(profile.canRemoveEnemyNoResponse, true);
  assert.equal(profile.noOpponentImpact, false);
});

test("temporary buff target choices keep the breakthrough unit and reject a wasted target", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [1, 1], enemyMight: 3 });
  actor.base[1].exhausted = true;
  const source = {
    ...structuredClone(cards.primalStrength),
    instanceId: "pending-temporary-buff",
    ownerId: actor.id,
    controllerId: actor.id,
    text: "Give a friendly unit +2 Might this turn.",
    effects: [{ timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2, temporary: true }]
  };
  game.pendingChoice = {
    playerId: actor.id,
    card: source,
    options: actor.base.map((unit) => ({ id: unit.instanceId, cardId: unit.instanceId })),
    data: { currentDeclaration: { spec: source.effects[0] } },
    finishSpell: false,
    optional: false
  };
  game.actionChain = { priorityPlayerId: actor.id, chain: [{ playerId: actor.id, card: source }] };

  const actions = enumerateAiPolicyActions(game, actor.id);
  assert.equal(actions.some((action) => action.kind === "chooseEffectOption"
    && action.optionId === actor.base[0].instanceId), true);
  assert.equal(actions.some((action) => action.kind === "chooseEffectOption"
    && action.optionId === actor.base[1].instanceId), false);
  assert.equal(field.units.some((unit) => unit.controllerId !== actor.id), true);
});

test("AI does not end the turn while an expiring buff creates a clean immediate breakthrough", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [3], enemyMight: 4, enemyExtra: { stunned: true } });
  actor.base[0].mightModifier = 1;
  actor.base[0].temporaryMight = 1;
  const attack = { kind: "moveUnit", unitId: actor.base[0].instanceId, destinationId: field.instanceId };
  const profile = movementProfile(game, actor.id, attack);
  assert.equal(profile.temporaryCreatesCleanBreakthrough, true);

  const actions = enumerateAiPolicyActions(game, actor.id);
  assert.equal(actions.some((action) => action.kind === "endTurn"), false);
  assert.equal(actions.some((action) => action.kind === "moveUnit"
    && action.destinationId === field.instanceId), true);
});

test("AI does not end the turn while a risk-free scoring or removal move is available", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [4], enemyMight: 2 });
  const attack = { kind: "moveUnit", unitId: actor.base[0].instanceId, destinationId: field.instanceId };
  const profile = movementProfile(game, actor.id, attack);
  assert.equal(profile.strictlyBeneficial, true);
  const actions = enumerateAiPolicyActions(game, actor.id);
  assert.equal(actions.some((action) => action.kind === "endTurn"), false);
  assert.equal(actions.some((action) => action.kind === "moveUnit"
    && action.destinationId === field.instanceId), true);
});

test("AI removes an effect target that is strictly worse than an aligned target", () => {
  const { game, actor, opponent } = createActionGame({ friendlyMight: [2], enemyMight: 2 });
  const source = {
    ...structuredClone(cards.primalStrength),
    instanceId: "lasting-choice-source",
    ownerId: actor.id,
    controllerId: actor.id,
    effects: [{ timing: "spell", kind: "modifyMight", target: "unit", amount: 2 }]
  };
  const friendly = actor.base[0];
  const enemy = game.battlefields[0].units[0];
  game.pendingChoice = {
    playerId: actor.id,
    card: source,
    options: [friendly, enemy].map((unit) => ({ id: unit.instanceId, cardId: unit.instanceId })),
    data: { currentDeclaration: { spec: source.effects[0] } },
    optional: false
  };
  game.actionChain = { priorityPlayerId: actor.id, chain: [{ playerId: actor.id, card: source }] };
  const actions = enumerateAiPolicyActions(game, actor.id);
  assert.equal(actions.some((action) => action.kind === "chooseEffectOption" && action.optionId === friendly.instanceId), true);
  assert.equal(actions.some((action) => action.kind === "chooseEffectOption" && action.optionId === enemy.instanceId), false);
  assert.equal(opponent.id, enemy.controllerId);
});

test("AI keeps a backwards-looking target when a lost showdown makes Draw the only material payoff", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [2], enemyMight: 2 });
  const source = {
    ...structuredClone(cards.primalStrength),
    instanceId: "draw-tradeoff-source",
    ownerId: actor.id,
    controllerId: actor.id,
    effects: [{ timing: "spell", kind: "modifyMight", target: "unit", amount: 2, temporary: true, draw: 1 }]
  };
  const friendly = actor.base[0];
  const enemy = game.battlefields[0].units[0];
  game.phase = "showdown";
  game.showdown = { battlefieldId: field.instanceId, priorityPlayerId: actor.id };
  game.pendingChoice = {
    playerId: actor.id,
    card: source,
    options: [friendly, enemy].map((unit) => ({ id: unit.instanceId, cardId: unit.instanceId })),
    data: { currentDeclaration: { spec: source.effects[0] } },
    optional: false
  };
  game.actionChain = { priorityPlayerId: actor.id, chain: [{ playerId: actor.id, card: source }] };
  const actions = enumerateAiPolicyActions(game, actor.id);
  assert.equal(actions.some((action) => action.kind === "chooseEffectOption" && action.optionId === enemy.instanceId), true);
});

test("AI rejects self-only damage declarations even when the spell draws", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [] });
  const kaiSa = battlefieldUnit(cards.kaiSaSurvivor, actor.id, "self-only-kaisa", 4);
  const spell = freeCard(cards.voidSeeker, actor.id, "self-only-void-seeker");
  field.units = [kaiSa];
  field.controlledBy = actor.id;
  actor.hand = [spell];

  assert.equal(enumerateLegalActions(game, actor.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === spell.instanceId), true,
  "the engine still treats the rules-legal self target as a legal command");
  assert.equal(enumerateAiPolicyActions(game, actor.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === spell.instanceId), false,
  "Draw 1 does not excuse spending Void Seeker to kill a healthy friendly Kai'Sa");
});

test("AI rejects a self-only Hextech Ray before committing to its mandatory target", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [] });
  const yordle = battlefieldUnit(cards.lecturingYordle, actor.id, "self-only-yordle", 2);
  const spell = freeCard(cards.hextechRay, actor.id, "self-only-hextech-ray");
  field.units = [yordle];
  field.controlledBy = actor.id;
  actor.hand = [spell];

  assert.equal(enumerateLegalActions(game, actor.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === spell.instanceId), true);
  assert.equal(enumerateAiPolicyActions(game, actor.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === spell.instanceId), false);
});

test("AI retains removal against an enemy and an explicit friendly Deathknell sacrifice", () => {
  const enemyCase = createActionGame({ friendlyMight: [] });
  const enemySpell = freeCard(cards.hextechRay, enemyCase.actor.id, "enemy-target-hextech-ray");
  enemyCase.actor.hand = [enemySpell];
  assert.equal(enumerateAiPolicyActions(enemyCase.game, enemyCase.actor.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === enemySpell.instanceId), true);

  const sacrificeCase = createActionGame({ friendlyMight: [] });
  const sentry = battlefieldUnit(cards.watchfulSentry, sacrificeCase.actor.id, "deathknell-sentry", 1);
  const sacrificeSpell = freeCard(cards.hextechRay, sacrificeCase.actor.id, "deathknell-hextech-ray");
  sacrificeCase.field.units = [sentry];
  sacrificeCase.field.controlledBy = sacrificeCase.actor.id;
  sacrificeCase.actor.hand = [sacrificeSpell];
  assert.equal(enumerateAiPolicyActions(sacrificeCase.game, sacrificeCase.actor.id).some((action) =>
    action.kind === "beginPlayCard" && action.cardId === sacrificeSpell.instanceId), true,
  "an explicit Deathknell keeps the sacrifice line available for the teacher to value");
});

test("a mandatory bad continuation remains executable if the game is already committed", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [] });
  const yordle = battlefieldUnit(cards.lecturingYordle, actor.id, "forced-self-yordle", 2);
  const spell = freeCard(cards.hextechRay, actor.id, "forced-self-hextech-ray");
  field.units = [yordle];
  field.controlledBy = actor.id;
  actor.hand = [spell];

  assert.equal(applyAiAction(game, {
    kind: "beginPlayCard",
    cardId: spell.instanceId,
    destination: "base"
  }, actor.id).ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  const forced = enumerateAiPolicyActions(game, actor.id);
  assert.equal(forced.length, 1);
  assert.deepEqual(forced[0], { kind: "chooseEffectOption", optionId: yordle.instanceId });
  assert.equal(tacticalActionProfile(game, actor.id, forced[0]).clearlySelfDestructive, true);
});

test("returning from a controlled battlefield to base remains available for regrouping", () => {
  const { game, actor, field } = createActionGame({ friendlyMight: [], enemyMight: 2 });
  const regroupingUnit = makeUnit(cards.lonelyPoro, actor.id, "regrouping-unit", 2, { zone: "battlefield" });
  field.units = [regroupingUnit];
  field.controlledBy = actor.id;
  const action = { kind: "moveUnit", unitId: regroupingUnit.instanceId, destinationId: "base" };
  assert.equal(movementProfile(game, actor.id, action).noOpponentImpact, false);
  assert.equal(enumerateAiPolicyActions(game, actor.id).some((candidate) =>
    candidate.kind === "moveUnit" && candidate.unitId === regroupingUnit.instanceId
      && candidate.destinationId === "base"), true);
});
