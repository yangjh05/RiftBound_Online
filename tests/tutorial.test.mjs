import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceTutorialAfterCommand,
  createTutorialGame,
  TUTORIAL_CATALOG,
  TUTORIAL_CARD_IDS,
  TUTORIAL_IDS,
  tutorialActionAllowed,
  tutorialStep
} from "../src/tutorial.mjs";
import {
  beginPlayCard,
  chooseEffectOption,
  confirmPayment,
  endTurn,
  moveUnit,
  passShowdown,
  togglePaymentRune
} from "../src/engine.mjs";
import { cardAllowedInPool } from "../src/card-pools.mjs";

function applyTutorialCommand(game, command, apply) {
  const result = apply();
  assert.equal(result.ok, true, result.message);
  advanceTutorialAfterCommand(game, command, result);
  return result;
}

test("tutorial follows the playable card, payment, conquest, and hold scoring path", () => {
  const game = createTutorialGame();
  const player = game.players.find((candidate) => candidate.id === game.tutorial.playerId);
  const field = game.battlefields[0];

  assert.equal(tutorialStep(game).id, "welcome");
  game.tutorial.introDismissed = true;
  assert.equal(tutorialStep(game).id, "open-hand");
  assert.equal(tutorialStep(game, { handOpen: true }).id, "play-unit");

  applyTutorialCommand(game, { kind: "beginPlayCard" }, () =>
    beginPlayCard(game, TUTORIAL_CARD_IDS.handUnit, "base"));
  assert.equal(tutorialStep(game).id, "select-runes");

  for (const runeId of TUTORIAL_CARD_IDS.runes) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(tutorialStep(game).id, "confirm-payment");

  applyTutorialCommand(game, { kind: "confirmPayment" }, () => confirmPayment(game));
  assert.equal(game.actionChain, null, "the basic tutorial silently resolves the card-play Chain");
  assert.equal(tutorialStep(game).id, "select-mover");

  game.selectedCardId = TUTORIAL_CARD_IDS.readyUnit;
  assert.equal(tutorialStep(game).id, "move-unit");
  applyTutorialCommand(game, { kind: "moveUnit" }, () =>
    moveUnit(game, TUTORIAL_CARD_IDS.readyUnit, TUTORIAL_CARD_IDS.battlefield));
  assert.equal(tutorialStep(game).id, "pass-showdown");

  applyTutorialCommand(game, { kind: "passShowdown" }, () => passShowdown(game, player.id));
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 7);
  assert.equal(tutorialStep(game).id, "end-turn");

  applyTutorialCommand(game, { kind: "endTurn" }, () => endTurn(game));
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
  assert.equal(player.score, 8);
  assert.equal(game.tutorial.completed, true);
  assert.equal(tutorialStep(game).id, "complete");
});

test("tutorial only permits the action required by the current lesson", () => {
  const game = createTutorialGame();
  game.tutorial.introDismissed = true;

  assert.equal(tutorialActionAllowed(game, "toggle-hand"), true);
  assert.equal(tutorialActionAllowed(game, "end-turn"), false);

  assert.equal(tutorialActionAllowed(game, "begin-play", {
    card: TUTORIAL_CARD_IDS.handUnit,
    destination: "base"
  }, { handOpen: true }), true);
  assert.equal(tutorialActionAllowed(game, "begin-play", {
    card: TUTORIAL_CARD_IDS.handUnit,
    destination: TUTORIAL_CARD_IDS.battlefield
  }, { handOpen: true }), false);
});

test("all tutorial shells use Origins-era decks and scenario cards", () => {
  assert.equal(TUTORIAL_CATALOG.length, 4);
  for (const lesson of TUTORIAL_CATALOG) {
    const game = createTutorialGame(lesson.id);
    const cardsInTutorial = [
      ...game.battlefields,
      ...game.battlefields.flatMap((field) => field.units || []),
      ...game.players.flatMap((player) => [
        player.legend,
        player.champion,
        ...(player.mainDeck || []),
        ...(player.hand || []),
        ...(player.base || []),
        ...(player.runes || [])
      ])
    ].filter(Boolean);
    assert.equal(cardsInTutorial.length > 0, true, `${lesson.id} has cards`);
    assert.equal(cardsInTutorial.every((card) => cardAllowedInPool(card, "origins-era")), true,
      `${lesson.id} only uses Origins-era cards`);
  }
});

test("combat tutorial moves, passes, and assigns simultaneous combat damage", () => {
  const game = createTutorialGame(TUTORIAL_IDS.combat);
  const player = game.players.find((candidate) => candidate.id === game.tutorial.playerId);
  game.tutorial.introDismissed = true;

  assert.equal(tutorialStep(game).id, "select-attacker");
  game.selectedCardId = TUTORIAL_CARD_IDS.combat.attacker;
  assert.equal(tutorialStep(game).id, "move-attacker");
  applyTutorialCommand(game, { kind: "moveUnit" }, () =>
    moveUnit(game, TUTORIAL_CARD_IDS.combat.attacker, TUTORIAL_CARD_IDS.combat.battlefield));
  assert.equal(tutorialStep(game).id, "pass-showdown");

  applyTutorialCommand(game, { kind: "passShowdown" }, () => passShowdown(game, player.id));
  assert.equal(tutorialStep(game).id, "assign-combat-damage");
  applyTutorialCommand(game, { kind: "chooseEffectOption" }, () =>
    chooseEffectOption(game, TUTORIAL_CARD_IDS.combat.defender));

  assert.equal(game.tutorial.completed, true);
  assert.equal(tutorialStep(game).id, "complete");
});

test("spell tutorial declares its target, pays Energy, and resolves the Chain", () => {
  const game = createTutorialGame(TUTORIAL_IDS.spell);
  game.tutorial.introDismissed = true;

  assert.equal(tutorialStep(game).id, "open-hand");
  assert.equal(tutorialStep(game, { handOpen: true }).id, "play-spell");
  assert.equal(beginPlayCard(game, TUTORIAL_CARD_IDS.spell.card, "base").ok, true);
  assert.equal(tutorialStep(game).id, "choose-spell-target");
  assert.equal(chooseEffectOption(game, TUTORIAL_CARD_IDS.spell.target).ok, true);
  assert.equal(tutorialStep(game).id, "select-runes");
  for (const runeId of TUTORIAL_CARD_IDS.spell.runes) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(tutorialStep(game).id, "confirm-payment");
  applyTutorialCommand(game, { kind: "confirmPayment" }, () => confirmPayment(game));

  assert.equal(game.actionChain, null);
  assert.equal(game.tutorial.completed, true);
  assert.equal(tutorialStep(game).id, "complete");
});

test("Power tutorial pays five Energy and recycles one Fury Rune for Power", () => {
  const game = createTutorialGame(TUTORIAL_IDS.power);
  const player = game.players.find((candidate) => candidate.id === game.tutorial.playerId);
  game.tutorial.introDismissed = true;

  assert.equal(beginPlayCard(game, TUTORIAL_CARD_IDS.power.card, "base").ok, true);
  assert.equal(tutorialStep(game).id, "select-power-energy");
  for (const runeId of TUTORIAL_CARD_IDS.power.runes) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(tutorialStep(game).id, "select-domain-power");
  assert.equal(togglePaymentRune(game, TUTORIAL_CARD_IDS.power.runes[0], "power").ok, true);
  assert.equal(tutorialStep(game).id, "confirm-payment");
  applyTutorialCommand(game, { kind: "confirmPayment" }, () => confirmPayment(game));

  assert.equal(game.tutorial.completed, true);
  assert.equal(player.base.some((card) => card.instanceId === TUTORIAL_CARD_IDS.power.card), true);
  assert.equal(player.runes.some((rune) => rune.instanceId === TUTORIAL_CARD_IDS.power.runes[0]), false,
    "the Rune paid as Power is recycled out of the Rune zone");
});
