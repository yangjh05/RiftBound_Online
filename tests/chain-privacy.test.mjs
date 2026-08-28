import test from "node:test";
import assert from "node:assert/strict";

import { makeRune } from "../src/cards.mjs";
import {
  beginPlayCard,
  cancelPayment,
  confirmPayment,
  createGame,
  currentPlayer,
  togglePaymentRune
} from "../src/engine.mjs";
import {
  chainItemVisibleToViewer,
  gameLogVisibleToViewer,
  handCountVisibleToViewer,
  pendingHandChainItem
} from "../src/rules/visibility.mjs";
import { snapshotPresentationGame } from "../src/presentation.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";

function card(ownerId, instanceId, name = "Secret Pending Card") {
  return {
    id: "privacy-test-card",
    instanceId,
    ownerId,
    controllerId: ownerId,
    name,
    type: "spell",
    tags: ["Action"],
    keywords: [],
    text: "PRIVATE-CARD-TEXT",
    image: "private-card.png",
    energy: 1,
    power: [],
    effects: []
  };
}

function player(id, hand = []) {
  return {
    id,
    name: id,
    hand,
    mainDeck: [],
    runeDeck: [],
    availableChampions: [],
    availableBattlefields: [],
    champion: null,
    legend: null,
    base: [],
    runes: [],
    trash: [],
    banished: [],
    turnScoredBattlefields: []
  };
}

function roomFor(game) {
  return {
    roomId: "CHAIN-PRIVACY",
    status: "playing",
    hostPlayerId: "p1",
    seats: {
      p1: { ready: true, deckRecord: { name: "P1" } },
      p2: { ready: true, deckRecord: { name: "P2" } }
    },
    game,
    createdAt: 0,
    updatedAt: 0
  };
}

function privatePendingItem(secretCard) {
  return {
    id: "private-pending-item",
    itemType: "card",
    playerId: secretCard.ownerId,
    card: secretCard,
    destination: "private-destination",
    status: "pending",
    playOptions: {
      declarationsComplete: false,
      playProcess: {
        source: "hand",
        privateLogSnapshot: ["Public event before the pending play."]
      }
    }
  };
}

test("pending hand cards are private to their player until Finalize", () => {
  const secret = card("p1", "private-card-instance");
  const item = privatePendingItem(secret);
  const game = {
    players: [player("p1"), player("p2")],
    actionChain: { chain: [item] },
    showdown: null,
    log: ["p1 declares PRIVATE-TARGET for Secret Pending Card.", "Public event before the pending play."]
  };

  assert.equal(pendingHandChainItem(item), true);
  assert.equal(chainItemVisibleToViewer(item, "p1"), true);
  assert.equal(chainItemVisibleToViewer(item, "p2"), false);
  assert.deepEqual(gameLogVisibleToViewer(game, "p2"), ["Public event before the pending play."]);
  assert.deepEqual(gameLogVisibleToViewer(game, "p1"), game.log);
  assert.equal(handCountVisibleToViewer(game, game.players[0], "p2"), 1);

  delete item.playOptions.playProcess.privateLogSnapshot;
  assert.deepEqual(gameLogVisibleToViewer(game, "p2"), [], "missing privacy metadata must fail closed");

  item.status = "finalized";
  assert.equal(chainItemVisibleToViewer(item, "p2"), true);
  assert.deepEqual(gameLogVisibleToViewer(game, "p2"), game.log);
  assert.equal(handCountVisibleToViewer(game, game.players[0], "p2"), 0);
});

test("opponent snapshots omit pending hand cards, declarations, and transient logs", () => {
  const secret = card("p1", "private-card-instance");
  const remaining = card("p1", "remaining-hand-card", "Another Hidden Card");
  const item = privatePendingItem(secret);
  const game = {
    phase: "action",
    turnSequence: 1,
    currentPlayerId: "p1",
    players: [player("p1", [remaining]), player("p2")],
    battlefields: [],
    actionChain: {
      chain: [item],
      priorityPlayerId: "p1"
    },
    showdown: null,
    pendingChoice: {
      playerId: "p1",
      card: secret,
      prompt: "Choose PRIVATE-TARGET.",
      options: [{ id: "private-option", cardId: "PRIVATE-TARGET" }]
    },
    pendingPayment: null,
    log: ["p1 declares PRIVATE-TARGET for Secret Pending Card.", "Public event before the pending play."],
    selectedCardId: secret.instanceId,
    triggerQueue: [],
    triggerQueueContinuation: null,
    stagedEvents: [],
    revealedIntel: []
  };
  const room = roomFor(game);

  const ownerView = snapshotForPlayer(room, "p1").game;
  const opponentView = snapshotForPlayer(room, "p2").game;
  const opponentP1 = opponentView.players.find((candidate) => candidate.id === "p1");
  const serializedOpponentView = JSON.stringify(opponentView);

  assert.equal(ownerView.actionChain.chain[0].card.instanceId, secret.instanceId);
  assert.equal(ownerView.pendingChoice.card.instanceId, secret.instanceId);
  assert.deepEqual(opponentView.actionChain.chain, []);
  assert.equal(opponentView.pendingChoice, null);
  assert.equal(opponentP1.hand.length, 2, "the private Pending card still counts as an opponent hand card");
  assert.equal(opponentP1.hand.every((candidate) => candidate.redacted), true);
  assert.deepEqual(opponentView.log, ["Public event before the pending play."]);
  assert.equal(serializedOpponentView.includes(secret.instanceId), false);
  assert.equal(serializedOpponentView.includes(secret.name), false);
  assert.equal(serializedOpponentView.includes(secret.text), false);
  assert.equal(serializedOpponentView.includes("PRIVATE-TARGET"), false);

  item.status = "finalized";
  item.playOptions.declarationsComplete = true;
  delete item.playOptions.playProcess.privateLogSnapshot;
  game.pendingChoice = null;
  const finalizedOpponentView = snapshotForPlayer(room, "p2").game;
  const finalizedP1 = finalizedOpponentView.players.find((candidate) => candidate.id === "p1");
  assert.equal(finalizedOpponentView.actionChain.chain[0].card.instanceId, secret.instanceId);
  assert.equal(finalizedP1.hand.length, 1);
  assert.equal(finalizedOpponentView.log[0].includes(secret.name), true);
});

test("presentation snapshots hide opponent Pending cards and keep the public hand count", () => {
  const secret = card("p1", "presentation-private-card");
  const item = privatePendingItem(secret);
  const game = {
    phase: "action",
    players: [player("p1"), player("p2")],
    battlefields: [],
    actionChain: { chain: [item] },
    showdown: null,
    log: ["Secret Pending Card selected PRIVATE-TARGET.", "Public event before the pending play."]
  };

  const ownerView = snapshotPresentationGame(game, undefined, "p1");
  const opponentView = snapshotPresentationGame(game, undefined, "p2");
  assert.deepEqual(ownerView.chain.map((entry) => entry.name), [secret.name]);
  assert.deepEqual(opponentView.chain, []);
  assert.equal(opponentView.players.find((entry) => entry.id === "p1").handCount, 1);
  assert.equal(opponentView.logHead, "Public event before the pending play.");
});

test("engine restores a cancelled private play and publishes it only after Finalize", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  game.phase = "action";
  game.turnSequence = 1;
  const actor = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== actor.id);
  const secret = card(actor.id, "engine-private-card");
  const readyRune = {
    ...makeRune("Body"),
    instanceId: "engine-private-rune",
    ownerId: actor.id,
    controllerId: actor.id,
    exhausted: false
  };
  actor.hand = [secret];
  actor.runes = [readyRune];
  game.log = ["Public event before the pending play."];
  const room = roomFor(game);

  assert.equal(beginPlayCard(game, secret.instanceId, "base").ok, true);
  assert.equal(game.actionChain.chain[0].status, "pending");
  assert.deepEqual(
    game.actionChain.chain[0].playOptions.playProcess.privateLogSnapshot,
    ["Public event before the pending play."]
  );
  const privateOpponentView = snapshotForPlayer(room, opponent.id).game;
  const serializedPrivateOpponentView = JSON.stringify(privateOpponentView);
  assert.equal(privateOpponentView.actionChain.chain.length, 0);
  assert.equal(
    privateOpponentView.players.find((candidate) => candidate.id === actor.id).hand.length,
    1
  );
  assert.equal(serializedPrivateOpponentView.includes(secret.instanceId), false);
  assert.equal(serializedPrivateOpponentView.includes(secret.name), false);
  assert.equal(serializedPrivateOpponentView.includes(secret.text), false);
  assert.equal(cancelPayment(game).ok, true);
  assert.equal(actor.hand[0].instanceId, secret.instanceId);
  assert.equal(game.actionChain, null);
  assert.deepEqual(game.log, ["Public event before the pending play."]);

  assert.equal(beginPlayCard(game, secret.instanceId, "base").ok, true);
  assert.equal(togglePaymentRune(game, readyRune.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  const finalized = game.actionChain.chain.find((entry) => entry.card?.instanceId === secret.instanceId);
  assert.equal(finalized.status, "finalized");
  assert.equal("privateLogSnapshot" in finalized.playOptions.playProcess, false);
  assert.equal(snapshotForPlayer(room, opponent.id).game.actionChain.chain[0].card.instanceId, secret.instanceId);
});
