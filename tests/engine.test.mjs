import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cards, decklists, DOMAINS, makeRune, rawDecklists } from "../src/cards.mjs";
import { DECK_RULES, validateDeckRecord } from "../src/decks/rules.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";
import { applyGameCommand } from "../server/commands.mjs";
import { validateStableGameState } from "../scripts/semantic-oracle.mjs";
import {
  activateCard,
  beginPlayChampion,
  beginPlayCard,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmPayment,
  createGame,
  currentPlayer,
  draw,
  endTurn,
  hideCard,
  isChosenChampion,
  moveUnit,
  moveUnits,
  passShowdown,
  playUnitToken,
  playCard,
  resolveEffect,
  selectBattlefield,
  selectChampion,
  confirmMulligan,
  skipMulligan,
  startTurn,
  surrender,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentRune
} from "../src/engine.mjs";

function instance(card, ownerId, id = "test-card") {
  return {
    ...structuredClone(card),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0
  };
}

function rune(domain, ownerId, id) {
  return {
    ...makeRune(domain),
    instanceId: id,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0
  };
}

function finalizedTriggerItem(card, playerId, id) {
  return {
    id,
    itemType: "trigger",
    card,
    playerId,
    status: "finalized",
    trigger: {
      id: `${id}-trigger`,
      kind: "testNoopTrigger",
      playerId,
      sourceCardId: card.instanceId,
      status: "finalized"
    }
  };
}

test("Annie, Stubborn explicitly returns a chosen spell, not a unit, from trash", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const annie = instance(cards.annieStubborn, player.id, "annie-stubborn");
  const spell = instance(cards.confront, player.id, "annie-spell");
  const unit = instance(cards.lonelyPoro, player.id, "annie-unit");
  player.hand = [annie];
  player.trash = [unit, spell];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `annie-rune-${index}`));

  assert.equal(beginPlayCard(game, annie.instanceId, "base").ok, true);
  for (const runeCard of player.runes) assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice?.effect, "returnTrashUnitToHand");
  assert.equal(game.pendingChoice?.data.cardType, "spell");
  assert.deepEqual(game.pendingChoice?.options.map((option) => option.cardId), [spell.instanceId]);

  assert.equal(chooseEffectOption(game, spell.instanceId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === spell.instanceId), true);
  assert.equal(player.trash.some((card) => card.instanceId === unit.instanceId), true);
});

test("every declared unit-token effect creates the right unique tokens in the right state and zone", () => {
  const tokenCards = new Map(Object.values(cards).flatMap((card) => [card.cardNumber, card.collectorNumber, card.id].filter(Boolean).map((number) => [number, card])));
  const declarations = Object.values(cards).flatMap((card) => (card.effects || [])
    .filter((effect) => effect.kind === "playUnitToken")
    .map((effect) => ({ card, effect })));
  assert.ok(declarations.length >= 10, "expected all registered token generators to be covered");

  for (const { card, effect } of declarations) {
    const game = createGame({ interactive: true });
    finishSetup(game);
    const player = currentPlayer(game);
    const source = instance(card, player.id, `token-source-${card.id}-${effect.timing}`);
    const battlefield = game.battlefields[0];
    battlefield.controlledBy = player.id;
    battlefield.units = [];
    let explicitDestination = null;
    if (effect.destination === "sourceBattlefield") battlefield.units.push(source);
    if (effect.destination === "movedBattlefield") explicitDestination = battlefield.instanceId;
    if (effect.destination === "showdownBattlefield") game.showdown = { battlefieldId: battlefield.instanceId };
    if (effect.destination === "hiddenBattlefield") source.hiddenBattlefieldId = battlefield.instanceId;

    const beforeIds = new Set([...player.base, ...battlefield.units].map((entry) => entry.instanceId));
    assert.equal(playUnitToken(game, player, source, effect, explicitDestination), true, `${card.name} should generate tokens`);
    const generated = [...player.base, ...battlefield.units].filter((entry) => !beforeIds.has(entry.instanceId));
    const expectedSource = tokenCards.get(effect.tokenCardNumber || "OGN-273/298");
    assert.ok(expectedSource, `${card.name} references a registered token`);
    assert.equal(generated.length, effect.count || 1, `${card.name} token count`);
    assert.equal(new Set(generated.map((entry) => entry.instanceId)).size, generated.length, `${card.name} token IDs are unique`);
    for (const token of generated) {
      assert.equal(token.id, expectedSource.id, `${card.name} token identity`);
      assert.equal(token.ownerId, player.id, `${card.name} token owner`);
      assert.equal(token.controllerId, player.id, `${card.name} token controller`);
      assert.equal(token.exhausted, !Boolean(effect.ready), `${card.name} ready state`);
      assert.equal(token.damage, 0, `${card.name} token starts undamaged`);
      assert.equal(token.stunned, false, `${card.name} token starts unstunned`);
    }
    const battlefieldDestination = ["sourceBattlefield", "movedBattlefield", "showdownBattlefield", "hiddenBattlefield"].includes(effect.destination);
    assert.equal(generated.every((token) => battlefield.units.includes(token)), battlefieldDestination, `${card.name} destination`);
    assert.equal(generated.every((token) => player.base.includes(token)), !battlefieldDestination, `${card.name} base destination`);
  }
});

test("all special token triggers reference valid tokens with explicit quantities", () => {
  const tokenNumbers = new Set(Object.values(cards).filter((card) => card.tags?.includes("Token"))
    .flatMap((card) => [card.cardNumber, card.collectorNumber, card.id]));
  const effects = Object.values(cards).flatMap((card) => (card.effects || []).map((effect) => ({ card, effect })))
    .filter(({ effect }) => ["opponentTurnRecruit", "playRecruitOnOtherFriendlyNonRecruitDeath"].includes(effect.kind));
  assert.ok(effects.length >= 2);
  for (const { card, effect } of effects) {
    assert.ok(tokenNumbers.has(effect.tokenCardNumber || "OGN-273/298"), `${card.name} token reference`);
    assert.ok((effect.count || 1) > 0, `${card.name} token quantity`);
  }
});

test("ready Temporary Sprite tokens die at their controller's next Beginning Phase before scoring", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const source = instance(cards.spriteMother, player.id, "temporary-sprite-source");
  assert.equal(playUnitToken(game, player, source, cards.spriteMother.effects[0], "base"), true);
  const sprite = player.base.find((card) => card.name === "Sprite");
  assert.ok(sprite);
  assert.equal(sprite.exhausted, false);

  startTurn(game);
  assert.equal(player.base.some((card) => card.instanceId === sprite.instanceId), false);
  assert.equal(player.trash.some((card) => card.instanceId === sprite.instanceId), true);
});

function finishSetup(game) {
  finishChampionSelection(game);
  while (game.phase === "battlefield-select") {
    const player = game.players.find((candidate) => candidate.id === game.setupPlayerId);
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  while (game.phase === "mulligan") {
    skipMulligan(game);
  }
}

function finishChampionSelection(game) {
  if (game.phase === "first-player") confirmFirstPlayer(game);
  while (game.phase === "champion-select") {
    const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
    selectChampion(game, player.id, player.availableChampions[0].instanceId);
  }
}

function expectedDeckSize(deck) {
  const extraChampionCards = deck.champion ? Math.max(1, deck.championCount || 1) : 0;
  return deck.main.length + extraChampionCards - 1;
}

function initialMainDeckSize(game, playerIndex) {
  const player = game.players[playerIndex];
  return expectedDeckSize(playerIndex === 0 ? decklists.keenanXiong : decklists.drowsy) + 1 - player.availableChampions.length;
}

function scoreCells(leftScore, rightScore) {
  const labels = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1];
  return labels.map((label, index) => ({
    label,
    leftActive: leftScore > 0 && leftScore === index + 1,
    rightActive: rightScore > 0 && rightScore === labels.length - index
  }));
}

function payPendingEnergy(game, runeIds) {
  for (const runeId of runeIds) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
}

function hideWithRune(game, cardId, battlefieldId, runeId) {
  assert.equal(hideCard(game, cardId, battlefieldId).ok, true);
  assert.equal(game.pendingPayment?.source, "hideCard");
  assert.equal(togglePaymentRune(game, runeId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
}

test("game starts with the supplied deck seats and first-player confirmation", () => {
  const game = createGame({ interactive: true });

  assert.equal(game.phase, "first-player");
  assert.equal(game.firstPlayerId, "p1");
  assert.deepEqual(game.turnOrder, ["p1", "p2"]);
  assert.equal(game.players[0].name, "Calm/Body Master Yi");
  assert.equal(game.players[1].name, "Mind/Chaos Diana");
  assert.equal(game.players[0].mainDeck.length, initialMainDeckSize(game, 0));
  assert.equal(game.players[1].mainDeck.length, initialMainDeckSize(game, 1));
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.players[0].availableChampions.length, 3);
  assert.deepEqual(game.players[0].availableChampions.map((card) => card.name), [
    "Akshan, Mischievous",
    "Master Yi, Tempered",
    "Rengar, Trophy Hunter"
  ]);
  assert.deepEqual(game.players[1].availableChampions.map((card) => card.name), [
    "Diana, Lunari",
    "Fizz, Trickster",
    "Hwei, Brooding Painter",
    "Kha'Zix, Mutating Horror",
    "Vex, Apathetic",
    "Vex, Cheerless"
  ]);
  assert.equal(game.players[0].availableBattlefields.length, 3);
  assert.equal(game.players[0].legend.name, "Master Yi, Wuju Bladesman");
  assert.equal(game.players[0].champion, null);
  assert.equal(game.players[1].legend.name, "Diana, Scorn of the Moon");
  assert.equal(game.players[1].champion, null);
  assert.ok(game.players[0].legend.image.includes("exburst.dev/riftbound/cards"));
  assert.ok(game.players[1].availableChampions[0].image.includes("UNL-079-219.webp"));

  assert.equal(confirmFirstPlayer(game).ok, true);
  assert.equal(game.phase, "champion-select");
  assert.equal(game.championSelectPlayerId, "p1");
});

test("registered cards and generated runes have real unique card numbers", () => {
  const registeredNumbers = Object.values(cards).map((card) => card.cardNumber);
  assert.equal(registeredNumbers.length, new Set(registeredNumbers).size);
  assert.equal(cards.charm.cardNumber, "OGN-043/298");
  assert.equal(cards.masterYiWujuBladesman.cardNumber, "OGS-019/024");
  assert.equal(cards.stalwartPoro.cardNumber, "OGN-052/298");

  assert.equal(makeRune(DOMAINS.FURY).cardNumber, "OGN-007/298");
  assert.equal(makeRune(DOMAINS.CALM).cardNumber, "OGN-042/298");
  assert.equal(makeRune(DOMAINS.MIND).cardNumber, "OGN-089/298");
  assert.equal(makeRune(DOMAINS.BODY).cardNumber, "OGN-126/298");
  assert.equal(makeRune(DOMAINS.CHAOS).cardNumber, "OGN-166/298");
  assert.equal(makeRune(DOMAINS.ORDER).cardNumber, "OGN-214/298");
});

test("all 24 Proving Grounds cards are registered with playable card data", () => {
  const ogsCards = Object.values(cards)
    .filter((card) => card.cardNumber.startsWith("OGS-"))
    .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber));
  assert.equal(ogsCards.length, 24);
  assert.deepEqual(
    ogsCards.map((card) => card.cardNumber),
    Array.from({ length: 24 }, (_, index) => `OGS-${String(index + 1).padStart(3, "0")}/024`)
  );
  for (const card of ogsCards) {
    assert.ok(card.name);
    assert.ok(card.image);
    assert.ok(Array.isArray(card.effects));
    if (["unit", "spell", "gear"].includes(card.type)) assert.ok(Number.isFinite(card.energy));
    if (card.type === "unit") assert.ok(Number.isFinite(card.might));
  }
});

test("decklists are stored by collector card number before resolving card objects", () => {
  assert.equal(rawDecklists.keenanXiong.legend, "OGS-019/024");
  assert.deepEqual(rawDecklists.keenanXiong.battlefields, ["SFD-208/221", "OGN-290/298", "OGN-295/298"]);
  assert.equal(rawDecklists.keenanXiong.main.some(([cardNumber]) => cardNumber === "OGN-043/298"), true);
  assert.equal(rawDecklists.drowsy.legend, "UNL-197/219");
  assert.equal(rawDecklists.drowsy.main.some(([cardNumber]) => cardNumber === "OGN-095/298"), true);
  assert.equal(decklists.keenanXiong.legend.name, "Master Yi, Wuju Bladesman");
  assert.equal(decklists.drowsy.main.some((card) => card.cardNumber === "SFD-146/221"), true);
});

test("default raw decklists satisfy the centralized deck construction rules", () => {
  const cardByNumber = (cardNumber) => Object.values(cards).find((card) => card.cardNumber === cardNumber) || null;

  for (const [deckId, deck] of Object.entries(rawDecklists)) {
    const validation = validateDeckRecord(deck, cardByNumber);
    assert.deepEqual(validation.messages, [], deckId);
    assert.equal(validation.playable, true, deckId);
    assert.equal(deck.runes.reduce((total, [, count]) => total + count, 0), DECK_RULES.runeExact);
    assert.equal(deck.battlefields.length, DECK_RULES.battlefieldsExact);
  }
});

test("deck validation enforces the combined Signature limit and Legend champion identity", () => {
  const cardByNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number) || null;
  const base = structuredClone(rawDecklists.provingGroundsMasterYi);
  const highlander = cardByNumber("OGS-020/024");
  const decisiveStrike = cardByNumber("OGS-024/024");
  assert.ok(highlander && decisiveStrike);

  const tooMany = structuredClone(base);
  tooMany.main = tooMany.main.filter(([number]) => number !== highlander.cardNumber);
  tooMany.main.push([highlander.cardNumber, 2], [highlander.collectorNumber, 2]);
  const tooManyValidation = validateDeckRecord(tooMany, cardByNumber);
  assert.equal(tooManyValidation.playable, false);
  assert.ok(tooManyValidation.messages.some((message) => message.includes("Signature") && message.includes("합계")));

  const wrongChampion = structuredClone(base);
  wrongChampion.main = wrongChampion.main.filter(([number]) => number !== highlander.cardNumber);
  wrongChampion.main.push([decisiveStrike.cardNumber, 1]);
  const wrongChampionValidation = validateDeckRecord(wrongChampion, cardByNumber);
  assert.equal(wrongChampionValidation.playable, false);
  assert.ok(wrongChampionValidation.messages.some((message) => message.includes("챔피언 태그")));
});

test("deck validation requires a real Champion card and rejects off-identity runes", () => {
  const cardByNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number) || null;
  const noChampion = structuredClone(rawDecklists.provingGroundsMasterYi);
  noChampion.main = noChampion.main.filter(([number]) => {
    const card = cardByNumber(number);
    return !card?.isChampion && !card?.tags?.includes("Champion");
  });
  const noChampionValidation = validateDeckRecord(noChampion, cardByNumber);
  assert.equal(noChampionValidation.playable, false);
  assert.ok(noChampionValidation.messages.some((message) => message.includes("실제 Champion")));

  const wrongRunes = structuredClone(rawDecklists.provingGroundsMasterYi);
  wrongRunes.runes = [[DOMAINS.CALM, 6], [DOMAINS.FURY, 6]];
  const wrongRunesValidation = validateDeckRecord(wrongRunes, cardByNumber);
  assert.equal(wrongRunesValidation.playable, false);
  assert.ok(wrongRunesValidation.messages.some((message) => message.includes("Domain Identity")));
});

test("choice effect handling uses the registered resolver table", () => {
  const source = fs.readFileSync(new URL("../src/engine.mjs", import.meta.url), "utf8");

  assert.match(source, /const CHOICE_RESOLVERS = new Map/);
  assert.doesNotMatch(source, /choice\.effect ===/);
});

test("confirmed random first player controls setup and turn order", () => {
  const game = createGame({ interactive: true, firstPlayerId: "p2" });

  assert.equal(game.phase, "first-player");
  assert.equal(game.firstPlayerId, "p2");
  assert.deepEqual(game.turnOrder, ["p2", "p1"]);
  assert.equal(confirmFirstPlayer(game).ok, true);
  assert.equal(game.championSelectPlayerId, "p2");

  finishSetup(game);
  assert.equal(game.phase, "action");
  assert.equal(currentPlayer(game).id, "p2");
  assert.equal(game.players.find((player) => player.id === "p2").runes.length, 2);
  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, "p1");
  assert.equal(game.players.find((player) => player.id === "p1").runes.length, 3);
});

test("score rail maps both players onto the 1-8-1 track", () => {
  let cells = scoreCells(1, 1);
  assert.equal(cells[0].leftActive, true);
  assert.equal(cells[14].rightActive, true);

  cells = scoreCells(8, 8);
  assert.equal(cells[7].leftActive, true);
  assert.equal(cells[7].rightActive, true);

  cells = scoreCells(3, 6);
  assert.equal(cells[2].leftActive, true);
  assert.equal(cells[9].rightActive, true);
});

test("both players choose a battlefield before the first turn starts", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);

  assert.equal(game.phase, "action");
  assert.equal(game.battlefields.length, 2);
  assert.equal(player.runes.length, 2);
  assert.equal(player.hand.length, 5);
});

test("players choose starting champions before battlefield selection and opening draw", () => {
  const game = createGame({ interactive: true });
  assert.equal(confirmFirstPlayer(game).ok, true);
  const first = game.players[0];
  const second = game.players[1];
  const firstChampionId = first.availableChampions[1].instanceId;
  const secondChampionId = second.availableChampions[2].instanceId;

  assert.equal(selectChampion(game, first.id, firstChampionId).ok, true);
  assert.equal(first.champion.instanceId, firstChampionId);
  assert.equal(first.mainDeck.length, expectedDeckSize(decklists.keenanXiong));
  assert.equal(game.phase, "champion-select");
  assert.equal(game.championSelectPlayerId, second.id);

  assert.equal(selectChampion(game, second.id, secondChampionId).ok, true);
  assert.equal(second.champion.instanceId, secondChampionId);
  assert.equal(game.phase, "battlefield-select");
  assert.equal(game.setupPlayerId, first.id);
  assert.equal(first.hand.length, 4);
  assert.equal(second.hand.length, 4);
  assert.equal(first.mainDeck.length, expectedDeckSize(decklists.keenanXiong) - 4);
  assert.equal(second.mainDeck.length, expectedDeckSize(decklists.drowsy) - 4);
});

test("starting champion leaves the champion zone after being played and cannot be played again", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const champion = player.champion;
  player.runes = [
    rune(DOMAINS.CALM, player.id, "champion-energy-1"),
    rune(DOMAINS.CALM, player.id, "champion-energy-2"),
    rune(DOMAINS.CALM, player.id, "champion-energy-3"),
    rune(DOMAINS.CALM, player.id, "champion-energy-4"),
    rune(DOMAINS.CALM, player.id, "champion-energy-5")
  ];

  assert.equal(champion.zone, "champion");
  assert.equal(player.championPlayed, false);
  assert.equal(beginPlayChampion(game, "base").ok, true);
  for (const runeCard of player.runes.slice(0, champion.energy || 0)) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  for (const requirement of champion.power || []) {
    const runeCard = player.runes.find((candidate) => !game.pendingPayment.powerRuneIds.includes(candidate.instanceId) && candidate.domain === requirement.domain);
    assert.ok(runeCard);
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "power").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.championPlayed, true);
  assert.equal(champion.zone, "played");
  assert.equal(player.base.includes(champion), true);

  const replay = beginPlayChampion(game, "base");
  assert.equal(replay.ok, false);
  assert.equal(replay.message, "Champion has already been played.");
});

test("same-name copies of the chosen champion count as chosen champions", () => {
  const game = createGame({ interactive: true });
  assert.equal(confirmFirstPlayer(game).ok, true);
  const player = game.players[0];
  const rengarChoice = player.availableChampions.find((card) => card.name === "Rengar, Trophy Hunter");
  assert.ok(rengarChoice);

  assert.equal(selectChampion(game, player.id, rengarChoice.instanceId).ok, true);
  assert.equal(player.chosenChampionName, "Rengar, Trophy Hunter");
  const extraRengar = player.mainDeck.find((card) => card.name === "Rengar, Trophy Hunter");
  const otherChampion = player.mainDeck.find((card) => card.name === "Akshan, Mischievous");

  assert.ok(extraRengar);
  assert.ok(otherChampion);
  assert.equal(isChosenChampion(game, player.id, player.champion), true);
  assert.equal(isChosenChampion(game, player.id, extraRengar), true);
  assert.equal(isChosenChampion(game, player.id, otherChampion), false);
});

test("battlefield selection leads to mulligans before the first turn", () => {
  const game = createGame({ interactive: true });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }

  assert.equal(game.phase, "mulligan");
  assert.equal(game.mulligan.playerId, game.players[0].id);
  assert.equal(currentPlayer(game).id, game.players[0].id);
  assert.equal(game.players[0].runes.length, 0);
});

test("a player can mulligan up to two selected hand cards to the deck bottom and draw that many", () => {
  const game = createGame({ interactive: true });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  const player = game.players[0];
  const kept = instance(cards.charm, player.id, "mulligan-kept");
  const firstBottom = instance(cards.defy, player.id, "mulligan-bottom-one");
  const secondBottom = instance(cards.discipline, player.id, "mulligan-bottom-two");
  const extra = instance(cards.clockworkKeeper, player.id, "mulligan-extra");
  const firstDraw = instance(cards.lonelyPoro, player.id, "mulligan-draw-one");
  const secondDraw = instance(cards.scuttleCrab, player.id, "mulligan-draw-two");
  const remainingDeck = instance(cards.stalwartPoro, player.id, "mulligan-remaining");
  player.hand = [kept, firstBottom, secondBottom, extra];
  player.mainDeck = [firstDraw, secondDraw, remainingDeck];

  assert.equal(toggleMulliganCard(game, firstBottom.instanceId).ok, true);
  assert.equal(toggleMulliganCard(game, secondBottom.instanceId).ok, true);
  assert.equal(toggleMulliganCard(game, extra.instanceId).ok, false);
  assert.equal(confirmMulligan(game).ok, true);

  assert.deepEqual(player.hand.map((card) => card.instanceId), [
    "mulligan-kept",
    "mulligan-extra",
    "mulligan-draw-one",
    "mulligan-draw-two"
  ]);
  assert.equal(player.mainDeck[0].instanceId, "mulligan-remaining");
  assert.deepEqual(player.mainDeck.slice(1).map((card) => card.instanceId).sort(), [
    "mulligan-bottom-one",
    "mulligan-bottom-two"
  ]);
  assert.equal(game.phase, "mulligan");
  assert.equal(game.mulligan.playerId, game.players[1].id);
});

test("mulligan draws only the number of cards returned", () => {
  const game = createGame({ interactive: true });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  const player = game.players[0];
  const kept = instance(cards.charm, player.id, "one-mulligan-kept");
  const bottom = instance(cards.defy, player.id, "one-mulligan-bottom");
  const extraOne = instance(cards.discipline, player.id, "one-mulligan-extra-one");
  const extraTwo = instance(cards.clockworkKeeper, player.id, "one-mulligan-extra-two");
  const drawCard = instance(cards.lonelyPoro, player.id, "one-mulligan-draw");
  const remainingDeck = instance(cards.scuttleCrab, player.id, "one-mulligan-remaining");
  player.hand = [kept, bottom, extraOne, extraTwo];
  player.mainDeck = [drawCard, remainingDeck];

  assert.equal(toggleMulliganCard(game, bottom.instanceId).ok, true);
  assert.equal(confirmMulligan(game).ok, true);

  assert.deepEqual(player.hand.map((card) => card.instanceId), [
    "one-mulligan-kept",
    "one-mulligan-extra-one",
    "one-mulligan-extra-two",
    "one-mulligan-draw"
  ]);
  assert.deepEqual(player.mainDeck.map((card) => card.instanceId), [
    "one-mulligan-remaining",
    "one-mulligan-bottom"
  ]);
});

test("skipping both mulligans starts the first turn without changing opening hands", () => {
  const game = createGame({ interactive: true });
  finishChampionSelection(game);
  for (const player of game.players) {
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  const firstHand = game.players[0].hand.map((card) => card.instanceId);
  const secondHand = game.players[1].hand.map((card) => card.instanceId);

  assert.equal(skipMulligan(game).ok, true);
  assert.equal(skipMulligan(game).ok, true);

  assert.equal(game.phase, "action");
  assert.deepEqual(game.players[0].hand.slice(0, firstHand.length).map((card) => card.instanceId), firstHand);
  assert.equal(game.players[0].hand.length, firstHand.length + 1);
  assert.deepEqual(game.players[1].hand.map((card) => card.instanceId), secondHand);
  assert.equal(game.players[0].runes.length, 2);
});

test("spells with mandatory targets cannot be started without legal targets", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const charm = instance(cards.charm, player.id, "targetless-charm");
  const enemyBaseUnit = instance(cards.lonelyPoro, opponent.id, "enemy-base-unit");
  player.hand = [charm];
  opponent.base = [];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "charm-calm"),
    rune(DOMAINS.BODY, player.id, "charm-any")
  ];

  assert.equal(beginPlayCard(game, charm.instanceId, "base").ok, false);
  assert.equal(game.pendingPayment, null);

  opponent.base = [enemyBaseUnit];
  assert.equal(beginPlayCard(game, charm.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, enemyBaseUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, game.battlefields[0].instanceId).ok, true);
  assert.equal(game.pendingPayment.cardId, charm.instanceId);
  game.pendingPayment = null;
  game.pendingChoice = null;

  const battlefield = game.battlefields[0];
  const enemyBattlefieldUnit = instance(cards.lonelyPoro, opponent.id, "enemy-battlefield-unit");
  battlefield.units.push(enemyBattlefieldUnit);
  battlefield.controlledBy = opponent.id;

  assert.equal(beginPlayCard(game, charm.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, enemyBattlefieldUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(game.pendingPayment.cardId, charm.instanceId);
});

test("moonfall can be played when Ruin Runner is the only enemy unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const friendly = instance(cards.lonelyPoro, player.id, "moonfall-friendly");
  const ruinRunner = instance(cards.ruinRunner, opponent.id, "moonfall-ruin-runner");
  game.battlefields[0].units = [friendly];
  opponent.base = [ruinRunner];
  player.hand = [instance(cards.moonfall, player.id, "moonfall-immune-target")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `moonfall-rune-${index}`));

  assert.equal(beginPlayCard(game, "moonfall-immune-target", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, game.battlefields[0].instanceId).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment.cardId, "moonfall-immune-target");
});

test("a player can surrender immediately and awards the game to the opponent", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);

  assert.equal(surrender(game, player.id).ok, true);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, opponent.id);
  assert.equal(game.surrenderedPlayerId, player.id);
});

test("Traveling Merchant resumes movement and starts combat after its discard-draw choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const merchant = instance(cards.travelingMerchant, player.id, "moving-merchant");
  const discarded = instance(cards.confront, player.id, "merchant-discard");
  const drawn = instance(cards.lonelyPoro, player.id, "merchant-draw");
  const defender = instance(cards.lonelyPoro, opponent.id, "merchant-defender");
  const battlefield = game.battlefields[0];
  player.base = [merchant];
  player.hand = [discarded];
  player.mainDeck = [drawn];
  battlefield.units = [defender];
  battlefield.controlledBy = opponent.id;

  assert.equal(moveUnit(game, merchant.instanceId, battlefield.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "discardCard");
  assert.equal(game.showdown, null);
  assert.equal(chooseEffectOption(game, discarded.instanceId).ok, true);

  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown?.combat, true);
  assert.equal(game.showdown?.battlefieldId, battlefield.instanceId);
  assert.equal(game.showdown?.attackerId, player.id);
});

test("Traveling Merchant starts combat after discard-trigger chains finish", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const merchant = instance(cards.travelingMerchant, player.id, "trigger-moving-merchant");
  const scrapheap = instance(cards.scrapheap, player.id, "merchant-scrapheap");
  const firstDraw = instance(cards.lonelyPoro, player.id, "merchant-first-draw");
  const secondDraw = instance(cards.confront, player.id, "merchant-trigger-draw");
  const defender = instance(cards.lonelyPoro, opponent.id, "trigger-merchant-defender");
  const battlefield = game.battlefields[0];
  player.base = [merchant];
  player.hand = [scrapheap];
  player.mainDeck = [firstDraw, secondDraw];
  battlefield.units = [defender];
  battlefield.controlledBy = opponent.id;

  assert.equal(moveUnit(game, merchant.instanceId, battlefield.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, scrapheap.instanceId).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === firstDraw.instanceId), true);
  assert.equal(player.hand.some((card) => card.instanceId === secondDraw.instanceId), true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown?.battlefieldId, battlefield.instanceId);
});

test("a ready unit moving to an empty battlefield starts a non-combat showdown before conquest", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.hand = [instance(cards.lonelyPoro, player.id)];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "r1"),
    rune(DOMAINS.CALM, player.id, "r2")
  ];

  assert.equal(playCard(game, player.hand[0].instanceId, "base").ok, true);
  const unit = player.base[0];
  unit.exhausted = false;

  assert.equal(moveUnit(game, unit.instanceId, game.battlefields[0].instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, false);
  assert.equal(game.showdown.attackerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(game.currentPlayerId, player.id);
  assert.equal(passShowdown(game, opponent.id).ok, false);
  assert.equal(player.score, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(game.battlefields[0].controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("multiple ready units can make one standard move to an empty battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const first = instance(cards.lonelyPoro, player.id, "batch-empty-first");
  const second = instance(cards.stalwartPoro, player.id, "batch-empty-second");
  player.base = [first, second];

  assert.equal(moveUnits(game, [first.instanceId, second.instanceId], game.battlefields[0].instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, false);
  assert.equal(game.battlefields[0].units.length, 2);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
  assert.equal(player.base.length, 0);
  assert.equal(player.score, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.battlefields[0].controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("moving into an enemy battlefield starts a showdown before combat damage", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.lonelyPoro, player.id, "attacker");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "defender");
  const field = game.battlefields[0];
  player.base = [unit];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, field.instanceId);
  assert.equal(game.showdown.combat, true);
  assert.equal(game.showdown.attackerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(game.currentPlayerId, player.id);
  assert.equal(passShowdown(game, opponent.id).ok, false);
  assert.equal(field.units.length, 2);
  assert.equal(unit.combatRole, "attacker");
  assert.equal(enemy.combatRole, "defender");
  assert.equal(player.score, 0);
  assert.equal(enemy.damage, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  const combatCards = [...field.units, ...player.base, ...opponent.base, ...player.trash, ...opponent.trash];
  assert.equal(combatCards.some((card) => card.combatRole), false);
});

test("multiple ready units can make one standard move into a combat showdown", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const first = instance(cards.lonelyPoro, player.id, "batch-combat-first");
  const second = instance(cards.stalwartPoro, player.id, "batch-combat-second");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "batch-combat-defender");
  const field = game.battlefields[0];
  player.base = [first, second];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnits(game, [first.instanceId, second.instanceId], field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, field.instanceId);
  assert.equal(game.showdown.combat, true);
  assert.equal(field.units.length, 3);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
  assert.equal(player.base.length, 0);
  assert.equal(player.score, 0);
  assert.equal(enemy.damage, 0);
});

test("turn player chooses the order when multiple combats are staged", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const firstField = game.battlefields[0];
  const secondField = game.battlefields[1];
  firstField.units = [
    instance(cards.lonelyPoro, player.id, "staged-a-attacker"),
    instance(cards.ravenbloomStudent, opponent.id, "staged-a-defender")
  ];
  secondField.units = [
    instance(cards.stalwartPoro, player.id, "staged-b-attacker"),
    instance(cards.ravenbloomStudent, opponent.id, "staged-b-defender")
  ];
  firstField.controlledBy = opponent.id;
  secondField.controlledBy = opponent.id;
  firstField.contestedBy = player.id;
  secondField.contestedBy = player.id;

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice.effect, "stagedEvent");
  assert.equal(game.pendingChoice.options.length, 2);
  const secondOption = game.pendingChoice.options.find((option) => option.cardId === secondField.instanceId);
  assert.ok(secondOption);

  assert.equal(chooseEffectOption(game, secondOption.id).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, secondField.instanceId);
  assert.equal(game.stagedEvents.length, 1);
  assert.equal(game.stagedEvents[0].battlefieldId, firstField.instanceId);
});

test("interactive combat damage is assigned by players after showdown passes", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "manual-combat-attacker");
  const defender = instance(cards.ravenbloomStudent, opponent.id, "manual-combat-defender");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.playerId, player.id);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["manual-combat-defender"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, "manual-combat-defender").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.playerId, opponent.id);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["manual-combat-attacker"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, "manual-combat-attacker").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.phase, "action");
  assert.equal(field.units.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "manual-combat-attacker"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "manual-combat-defender"), true);
});

test("manual combat damage must assign lethal damage to Tank units first", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "tank-combat-attacker");
  attacker.might = 4;
  const tank = instance(cards.lonelyPoro, opponent.id, "tank-combat-tank");
  tank.keywords = [...(tank.keywords || []), "Tank"];
  const normal = instance(cards.ravenbloomStudent, opponent.id, "tank-combat-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [tank, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["tank-combat-tank"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);

  assert.equal(chooseEffectOption(game, "tank-combat-tank").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["tank-combat-normal"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
});

test("combat damage can be assigned to units that enemy spells and abilities cannot choose", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "choice-limit-attacker");
  attacker.might = 4;
  const protectedUnit = instance(cards.ruinRunner, opponent.id, "choice-limit-protected");
  const normal = instance(cards.ravenbloomStudent, opponent.id, "choice-limit-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [protectedUnit, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["choice-limit-normal"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
  assert.equal(chooseEffectOption(game, "choice-limit-normal").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["choice-limit-protected"]);
});

test("combat damage can hit a zero Might Scuttle Crab", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const attacker = instance(cards.lonelyPoro, player.id, "zero-might-attacker");
  const scuttle = instance(cards.scuttleCrab, opponent.id, "zero-might-scuttle");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [scuttle];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), [scuttle.instanceId]);
  assert.equal(game.pendingChoice.options[0].amount, 1);
});

test("manual combat damage uses summed might of units at that battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const firstAttacker = instance(cards.lonelyPoro, player.id, "summed-might-attacker-one");
  const secondAttacker = instance(cards.lonelyPoro, player.id, "summed-might-attacker-two");
  const firstDefender = instance(cards.lonelyPoro, opponent.id, "summed-might-defender-one");
  const secondDefender = instance(cards.ravenbloomStudent, opponent.id, "summed-might-defender-two");
  const field = game.battlefields[0];
  player.base = [];
  field.units = [firstAttacker, secondAttacker, firstDefender, secondDefender];
  field.controlledBy = opponent.id;
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.data.remaining, 4);
  assert.equal(game.pendingChoice.options.find((option) => option.id === "summed-might-defender-one").amount, 2);

  assert.equal(chooseEffectOption(game, "summed-might-defender-one").ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.equal(game.pendingChoice.data.remaining, 2);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["summed-might-defender-two"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
});

test("manual combat lethal uses target current might after showdown effects", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.vilemaw, player.id, "current-might-vilemaw");
  const defender = instance(cards.ravenbloomStudent, opponent.id, "current-might-defender");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["current-might-defender"]);
  assert.equal(game.pendingChoice.options[0].amount, 2);
});

test("automatic combat damage uses the same legal lethal assignment rules", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const attacker = instance(cards.lonelyPoro, player.id, "auto-combat-attacker");
  attacker.might = 4;
  const protectedUnit = instance(cards.ruinRunner, opponent.id, "auto-combat-protected");
  const normal = instance(cards.ravenbloomStudent, opponent.id, "auto-combat-normal");
  const field = game.battlefields[0];
  player.base = [attacker];
  field.units = [protectedUnit, normal];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "auto-combat-normal"), true);
  assert.equal(field.units.some((card) => card.instanceId === "auto-combat-protected"), true);
}
);

test("showdown chain resolves after both players pass", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.ruinRunner, player.id, "chain-attacker");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "chain-defender");
  const field = game.battlefields[0];
  player.base = [unit];
  player.hand = [instance(cards.alphaStrike, player.id, "alpha-strike")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "r1"),
    rune(DOMAINS.BODY, player.id, "r2"),
    rune(DOMAINS.BODY, player.id, "r3"),
    rune(DOMAINS.BODY, player.id, "r4")
  ];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(playCard(game, "alpha-strike", "base").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].status, "pending");
  assert.equal(opponent.base.length, 0);

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(field.units.some((candidate) => candidate.instanceId === enemy.instanceId), false);
  assert.equal(opponent.trash[0].name, "Ravenbloom Student");

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("interactive showdown spells can enter manual payment and join the chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.ruinRunner, player.id, "interactive-chain-attacker");
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "interactive-chain-defender");
  const field = game.battlefields[0];
  player.base = [unit];
  player.hand = [instance(cards.alphaStrike, player.id, "interactive-alpha-strike")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r1"),
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r2"),
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r3"),
    rune(DOMAINS.BODY, player.id, "interactive-alpha-r4")
  ];
  field.units = [enemy];
  field.controlledBy = opponent.id;

  assert.equal(moveUnit(game, unit.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(beginPlayCard(game, "interactive-alpha-strike", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "interactive-chain-attacker").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  const alphaAllocation = game.pendingChoice.options.find((option) => option.cardId === "interactive-chain-defender" && option.amount === unit.might);
  assert.ok(alphaAllocation);
  assert.equal(chooseEffectOption(game, alphaAllocation.id).ok, true);
  assert.equal(game.pendingPayment.cardName, "Alpha Strike");

  for (const runeId of ["interactive-alpha-r1", "interactive-alpha-r2", "interactive-alpha-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "interactive-alpha-r4", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.showdown.chain[0].card.instanceId, "interactive-alpha-strike");
  assert.equal(game.showdown.chain[0].status, "pending");
  assert.deepEqual(game.showdown.chain[0].card.declaredPlayTargets, [
    { effect: "alphaStrike", targetId: "interactive-chain-attacker" },
    { effect: "alphaStrikeDamage", targetId: "interactive-chain-defender", amount: alphaAllocation.amount }
  ]);
});

test("showdown chain pending items finalize before the top item resolves", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const first = instance(cards.lonelyPoro, player.id, "pending-chain-first");
  const second = instance(cards.stalwartPoro, opponent.id, "pending-chain-second");
  field.units = [
    instance(cards.ruinRunner, player.id, "pending-chain-attacker"),
    instance(cards.ravenbloomStudent, opponent.id, "pending-chain-defender")
  ];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [
      { card: first, playerId: player.id, destination: "base", status: "pending" },
      { card: second, playerId: opponent.id, destination: "base", status: "pending" }
    ]
  };

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].card.instanceId, "pending-chain-first");
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(opponent.base.some((unit) => unit.instanceId === "pending-chain-second"), true);
});

test("interactive targetless spells resolve without creating target choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "targetless-area-enemy");
  const field = game.battlefields[0];
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "interactive-unchecked-power")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "unchecked-r1"),
    rune(DOMAINS.MIND, player.id, "unchecked-r2"),
    rune(DOMAINS.MIND, player.id, "unchecked-r3"),
    rune(DOMAINS.MIND, player.id, "unchecked-r4"),
    rune(DOMAINS.MIND, player.id, "unchecked-r5"),
    rune(DOMAINS.MIND, player.id, "unchecked-r6"),
    rune(DOMAINS.MIND, player.id, "unchecked-r7"),
    rune(DOMAINS.MIND, player.id, "unchecked-r8"),
    rune(DOMAINS.MIND, player.id, "unchecked-r9")
  ];

  assert.equal(beginPlayCard(game, "interactive-unchecked-power", "base").ok, true);
  for (const runeId of ["unchecked-r1", "unchecked-r2", "unchecked-r3", "unchecked-r4", "unchecked-r5", "unchecked-r6", "unchecked-r7"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "unchecked-r8", "power").ok, true);
  assert.equal(togglePaymentRune(game, "unchecked-r9", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.length, 0);
  assert.equal(opponent.trash[0].instanceId, "targetless-area-enemy");
});

test("interactive play requires manual rune payment and creates target choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "manual-target");
  const field = game.battlefields[0];
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.charm, player.id, "manual-charm")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "manual-energy"),
    rune(DOMAINS.CALM, player.id, "manual-power")
  ];

  assert.equal(beginPlayCard(game, "manual-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [enemy.instanceId]);
  assert.equal(chooseEffectOption(game, enemy.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(game.pendingPayment.cardName, "Charm");
  assert.equal(togglePaymentRune(game, "manual-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "manual-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "manual-energy" && candidate.exhausted), true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "manual-power"), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "manual-power"), true);
  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.length, 0);
  assert.equal(opponent.base[0].name, "Ravenbloom Student");
  assert.equal(game.effectFlash.targetIds.includes(enemy.instanceId), true);
});

test("charm can move an enemy unit between battlefields", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const source = game.battlefields[0];
  const destination = game.battlefields[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "charm-battlefield-move-target");
  const friendly = instance(cards.lonelyPoro, player.id, "charm-destination-defender");
  source.units = [enemy];
  source.effects = [];
  source.controlledBy = opponent.id;
  destination.units = [friendly];
  destination.effects = [];
  destination.controlledBy = player.id;
  player.hand = [instance(cards.charm, player.id, "battlefield-charm")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "battlefield-charm-energy"),
    rune(DOMAINS.CALM, player.id, "battlefield-charm-power")
  ];

  assert.equal(beginPlayCard(game, "battlefield-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "charm-battlefield-move-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "battlefield-charm-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "battlefield-charm-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(source.units.some((unit) => unit.instanceId === enemy.instanceId), false);
  assert.equal(destination.units.some((unit) => unit.instanceId === enemy.instanceId), true);
  assert.equal(game.showdown?.attackerId, opponent.id);
  assert.equal(game.showdown?.defenderId, player.id);
});

test("ride the wind can move a friendly unit between battlefields and ready it", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const source = game.battlefields[0];
  const destination = game.battlefields[1];
  const unit = instance(cards.lonelyPoro, player.id, "ride-battlefield-unit");
  unit.exhausted = true;
  source.units = [unit];
  source.controlledBy = player.id;
  player.hand = [instance(cards.rideTheWind, player.id, "ride-battlefield-spell")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "ride-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "ride-energy-two"),
    rune(DOMAINS.CHAOS, player.id, "ride-power")
  ];

  assert.equal(beginPlayCard(game, "ride-battlefield-spell", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "ride-battlefield-unit").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-two", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(source.units.some((candidate) => candidate.instanceId === unit.instanceId), false);
  assert.equal(destination.units.some((candidate) => candidate.instanceId === unit.instanceId), true);
  assert.equal(unit.exhausted, false);
});

test("manual Power payment can use an already exhausted rune", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "exhausted-power-target");
  const field = game.battlefields[0];
  const exhaustedPower = rune(DOMAINS.CALM, player.id, "exhausted-power-rune");
  exhaustedPower.exhausted = true;
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.charm, player.id, "exhausted-power-charm")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "exhausted-power-energy"),
    exhaustedPower
  ];

  assert.equal(beginPlayCard(game, "exhausted-power-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "exhausted-power-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(togglePaymentRune(game, "exhausted-power-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "exhausted-power-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "exhausted-power-rune"), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "exhausted-power-rune"), true);
});

test("deflect asks the user which rune to pay before resolving the effect", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const stupefy = instance(cards.stupefy, player.id, "stupefy");
  const vex = instance(cards.vexApathetic, opponent.id, "vex");
  const energyRune = rune(DOMAINS.CALM, player.id, "energy-rune");
  const deflectRune = rune(DOMAINS.BODY, player.id, "deflect-rune");

  player.hand = [stupefy];
  player.runes = [energyRune, deflectRune];
  player.runeDeck = [];
  opponent.base = [vex];

  assert.equal(beginPlayCard(game, stupefy.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [vex.instanceId]);
  assert.equal(chooseEffectOption(game, vex.instanceId).ok, true);
  assert.equal(game.pendingPayment.powerCost.some((cost) => cost.domain === "Any" && cost.amount === 1), true);
  assert.equal(togglePaymentRune(game, energyRune.instanceId, "energy").ok, true);
  assert.equal(togglePaymentRune(game, deflectRune.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(vex.buffs, -1);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === deflectRune.instanceId), false);
  assert.equal(player.runeDeck.at(-1).instanceId, deflectRune.instanceId);
  assert.equal(game.pendingChoice, null);
});

test("manual payment can recycle the same rune used for Energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  game.battlefields[0].units = [instance(cards.ravenbloomStudent, opponent.id, "single-rune-target")];
  game.battlefields[0].controlledBy = opponent.id;
  player.hand = [instance(cards.charm, player.id, "single-rune-charm")];
  player.runes = [rune(DOMAINS.CALM, player.id, "shared-rune")];

  assert.equal(beginPlayCard(game, "single-rune-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "single-rune-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(togglePaymentRune(game, "shared-rune", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "shared-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runes.some((candidate) => candidate.instanceId === "shared-rune"), false);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "shared-rune"), true);
});

test("manual payment rejects runes that do not match the card Power color", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  game.battlefields[0].units = [instance(cards.ravenbloomStudent, opponent.id, "calm-power-target")];
  game.battlefields[0].controlledBy = opponent.id;
  const calmPowerCharm = instance({
    ...cards.charm,
    name: "Calm Power Charm",
    power: [{ domain: DOMAINS.CALM, amount: 1 }]
  }, player.id, "calm-power-charm");
  player.hand = [calmPowerCharm];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "wrong-power"),
    rune(DOMAINS.CALM, player.id, "right-power")
  ];

  assert.equal(beginPlayCard(game, "calm-power-charm", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "calm-power-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(togglePaymentRune(game, "wrong-power", "power").ok, false);
  assert.equal(togglePaymentRune(game, "right-power", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "right-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "right-power"), true);
});

test("activated gear effects do not resolve as play effects", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  player.hand = [instance(cards.guardianAngel, player.id, "guardian-angel-gear")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "gear-r1"),
    rune(DOMAINS.CALM, player.id, "gear-r2")
  ];

  assert.equal(playCard(game, "guardian-angel-gear", "base").ok, true);
  assert.equal(player.base[0].name, "Guardian Angel");
  assert.equal(game.pendingChoice, null);
});

test("hidden cards are paid to a controlled battlefield and revealed into showdown", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  player.hand = [instance(cards.backOff, player.id, "hidden-back-off")];
  player.runes = [rune(DOMAINS.CALM, player.id, "hide-power")];

  hideWithRune(game, "hidden-back-off", field.instanceId, "hide-power");
  assert.equal(player.hand.length, 0);
  assert.equal(field.hidden.length, 1);
  assert.equal(player.runes.length, 0);

  const attacker = instance(cards.ravenbloomStudent, opponent.id, "hidden-attacker");
  const defender = instance(cards.lonelyPoro, player.id, "hidden-defender");
  field.units = [attacker, defender];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, "hidden-back-off", field.instanceId).ok, false);
  assert.equal(field.hidden.length, 1);

  game.turnSequence += 1;
  assert.equal(beginPlayCard(game, "hidden-back-off", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareHiddenPlayTarget");
  assert.equal(chooseEffectOption(game, "hidden-attacker").ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(game.showdown.chain[0].card.name, "Back Off");
  assert.deepEqual(game.showdown.chain[0].card.declaredPlayTargets, [
    { effect: "stunUnit", targetId: "hidden-attacker" }
  ]);
});

test("Bandle Tree allows one additional hidden card for its controller", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.name = "Bandle Tree";
  field.controlledBy = player.id;
  field.effects = structuredClone(cards.bandleTree.effects);
  player.hand = [
    instance(cards.backOff, player.id, "bandle-hidden-1"),
    instance(cards.standUnited, player.id, "bandle-hidden-2"),
    instance(cards.backOff, player.id, "bandle-hidden-3")
  ];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "bandle-hide-power-1"),
    rune(DOMAINS.CALM, player.id, "bandle-hide-power-2"),
    rune(DOMAINS.CALM, player.id, "bandle-hide-power-3")
  ];

  hideWithRune(game, "bandle-hidden-1", field.instanceId, "bandle-hide-power-1");
  hideWithRune(game, "bandle-hidden-2", field.instanceId, "bandle-hide-power-2");
  assert.equal(hideCard(game, "bandle-hidden-3", field.instanceId).ok, false);
  assert.equal(field.hidden.length, 2);
});

test("back off draws only when played from hand, not from hidden", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const target = instance(cards.ravenbloomStudent, opponent.id, "back-off-target");
  opponent.base = [target];
  const drawCard = instance(cards.charm, player.id, "back-off-draw");
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.backOff, player.id, "hand-back-off")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "back-off-r1"),
    rune(DOMAINS.CALM, player.id, "back-off-r2"),
    rune(DOMAINS.CALM, player.id, "back-off-r3")
  ];

  assert.equal(playCard(game, "hand-back-off", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "stunUnit");
  assert.equal(chooseEffectOption(game, "back-off-target").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "back-off-draw"), true);

  const field = game.battlefields[0];
  const hiddenBackOff = instance(cards.backOff, player.id, "revealed-back-off");
  hiddenBackOff.playedFromHidden = true;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  field.units = [target, instance(cards.lonelyPoro, player.id, "back-off-defender")];
  player.mainDeck = [instance(cards.charm, player.id, "hidden-back-off-no-draw")];
  const handCountBefore = player.hand.length;

  assert.equal(resolveEffect(game, player, hiddenBackOff), true);
  assert.equal(game.pendingChoice.effect, "stunUnit");
  assert.equal(chooseEffectOption(game, "back-off-target").ok, true);
  assert.equal(player.hand.length, handCountBefore);
});

test("hidden spell targets are restricted to the battlefield where the card was hidden", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const hiddenBackOff = instance(cards.backOff, player.id, "restricted-hidden-back-off");
  hiddenBackOff.playedFromHidden = true;
  hiddenBackOff.hiddenBattlefieldId = game.battlefields[0].instanceId;
  const localTarget = instance(cards.ravenbloomStudent, opponent.id, "local-hidden-target");
  const remoteTarget = instance(cards.ravenbloomStudent, opponent.id, "remote-hidden-target");
  game.battlefields[0].units = [localTarget];
  game.battlefields[1].units = [remoteTarget];

  assert.equal(resolveEffect(game, player, hiddenBackOff), true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["local-hidden-target"]);
});

test("hidden cards are trashed during cleanup when their owner loses the battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  player.hand = [instance(cards.backOff, player.id, "cleanup-hidden-back-off")];
  player.runes = [rune(DOMAINS.CALM, player.id, "cleanup-hide-power")];

  hideWithRune(game, "cleanup-hidden-back-off", field.instanceId, "cleanup-hide-power");
  assert.equal(field.hidden.length, 1);

  field.controlledBy = opponent.id;
  assert.equal(endTurn(game).ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "cleanup-hidden-back-off"), true);
});

test("cleanup repeats after lethal units change battlefield control and invalidates hidden cards", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [instance(cards.lonelyPoro, player.id, "cleanup-loop-poro")];
  player.hand = [
    instance(cards.backOff, player.id, "cleanup-loop-hidden"),
    instance(cards.uncheckedPower, player.id, "cleanup-loop-boardwipe")
  ];
  player.mainDeck = [instance(cards.charm, player.id, "cleanup-loop-draw")];
  player.runes = Array.from({ length: 10 }, (_, index) => rune(DOMAINS.MIND, player.id, `cleanup-loop-r${index}`));

  hideWithRune(game, "cleanup-loop-hidden", field.instanceId, "cleanup-loop-r0");
  assert.equal(field.hidden.length, 1);
  assert.equal(playCard(game, "cleanup-loop-boardwipe", "base").ok, true);

  assert.equal(field.units.length, 0);
  assert.equal(field.controlledBy, null);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "cleanup-loop-hidden"), true);
});

test("cleanup finishes hidden removal before resolving deathknell draw choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [instance(cards.lonelyPoro, player.id, "cleanup-pending-poro")];
  player.base = [
    instance(cards.frigidJewel, player.id, "cleanup-pending-jewel"),
    instance(cards.clockworkKeeper, player.id, "cleanup-pending-target")
  ];
  player.drawCountThisTurn = 1;
  player.mainDeck = [instance(cards.charm, player.id, "cleanup-pending-draw")];
  player.hand = [
    instance(cards.backOff, player.id, "cleanup-pending-hidden"),
    instance(cards.uncheckedPower, player.id, "cleanup-pending-boardwipe")
  ];
  player.runes = Array.from({ length: 10 }, (_, index) => rune(DOMAINS.MIND, player.id, `cleanup-pending-r${index}`));

  hideWithRune(game, "cleanup-pending-hidden", field.instanceId, "cleanup-pending-r0");
  assert.equal(playCard(game, "cleanup-pending-boardwipe", "base").ok, true);

  assert.equal(field.units.length, 0);
  assert.equal(field.controlledBy, null);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.trash.some((card) => card.instanceId === "cleanup-pending-hidden"), true);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
});

test("activated equipment attaches only after explicit activation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "equip-target");
  const gear = instance(cards.guardianAngel, player.id, "guardian-equip");
  player.base = [unit, gear];
  player.runes = [rune(DOMAINS.CALM, player.id, "equip-power")];

  assert.equal(activateCard(game, "guardian-equip").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "equip-target").ok, true);
  assert.equal(unit.attachments[0].name, "Guardian Angel");
  assert.equal(player.base.some((card) => card.instanceId === "guardian-equip"), false);
});

test("attached gear recalls to base when its unit leaves the board", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, player.id, "gear-cleanup-unit");
  const gear = instance(cards.trinityForce, player.id, "gear-cleanup-trinity");
  unit.attachments = [gear];
  field.units = [unit];
  field.controlledBy = player.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "gear-cleanup-spell")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `gear-cleanup-rune-${index}`));

  assert.equal(playCard(game, "gear-cleanup-spell", "base").ok, true);

  assert.equal(field.units.some((card) => card.instanceId === "gear-cleanup-unit"), false);
  assert.equal(player.trash.some((card) => card.instanceId === "gear-cleanup-unit"), true);
  assert.equal(player.base.some((card) => card.instanceId === "gear-cleanup-trinity"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "gear-cleanup-trinity"), false);
});

test("disarming rake may kill a chosen gear when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const gear = instance(cards.guardianAngel, opponent.id, "rake-target-gear");
  opponent.base = [gear];
  player.hand = [instance(cards.disarmingRake, player.id, "explicit-rake")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `rake-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-rake", "base").ok, true);
  for (const runeId of ["rake-r0", "rake-r1", "rake-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "rake-r0", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "trashGear");

  assert.equal(chooseEffectOption(game, "rake-target-gear").ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === "rake-target-gear"), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === "rake-target-gear"), true);
});

test("disarming rake does not trigger when there is no legal gear target", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.hand = [instance(cards.disarmingRake, player.id, "targetless-rake")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `targetless-rake-r${index}`));

  assert.equal(beginPlayCard(game, "targetless-rake", "base").ok, true);
  for (const runeId of ["targetless-rake-r0", "targetless-rake-r1", "targetless-rake-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "targetless-rake-r0", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(game.actionChain, null);
  assert.equal(player.base.some((card) => card.instanceId === "targetless-rake"), true);
});

test("on-play triggers use the declared target and do not retarget at resolution", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const declaredGear = instance(cards.guardianAngel, opponent.id, "declared-rake-gear");
  const otherGear = instance(cards.trinityForce, opponent.id, "other-rake-gear");
  opponent.base = [declaredGear, otherGear];
  player.hand = [instance(cards.disarmingRake, player.id, "retarget-rake")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `retarget-rake-r${index}`));

  assert.equal(beginPlayCard(game, "retarget-rake", "base").ok, true);
  for (const runeId of ["retarget-rake-r0", "retarget-rake-r1", "retarget-rake-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "retarget-rake-r0", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "trashGear");

  opponent.base = opponent.base.filter((card) => card.instanceId !== "declared-rake-gear");
  opponent.hand.push(declaredGear);

  assert.equal(chooseEffectOption(game, "declared-rake-gear").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "declared-rake-gear"), true);
  assert.equal(opponent.base.some((card) => card.instanceId === "other-rake-gear"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "declared-rake-gear"), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === "other-rake-gear"), false);
});

test("en garde gives an additional might when the unit is alone there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "en-garde-unit");
  player.base = [unit];
  player.hand = [instance(cards.enGarde, player.id, "explicit-en-garde")];
  player.runes = [rune(DOMAINS.CALM, player.id, "en-garde-rune")];

  assert.equal(beginPlayCard(game, "explicit-en-garde", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["en-garde-unit"]);
  assert.equal(chooseEffectOption(game, "en-garde-unit").ok, true);
  assert.equal(togglePaymentRune(game, "en-garde-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(unit.buffs, 2);
});

test("whiteflame protector gives a chosen unit plus eight might when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const target = instance(cards.ravenbloomStudent, opponent.id, "whiteflame-target");
  opponent.base = [target];
  player.hand = [instance(cards.whiteflameProtector, player.id, "explicit-whiteflame")];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.CALM, player.id, `whiteflame-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-whiteflame", "base").ok, true);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(togglePaymentRune(game, `whiteflame-r${index}`, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "whiteflame-r0", "power").ok, true);
  assert.equal(togglePaymentRune(game, "whiteflame-r1", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "modifyMight");

  assert.equal(chooseEffectOption(game, "whiteflame-target").ok, true);
  assert.equal(target.buffs, 8);
});

test("rebuke returns a battlefield unit to its owner's hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.ravenbloomStudent, opponent.id, "rebuke-target");
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.rebuke, player.id, "explicit-rebuke")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "rebuke-r0"),
    rune(DOMAINS.CHAOS, player.id, "rebuke-r1")
  ];

  assert.equal(beginPlayCard(game, "explicit-rebuke", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "rebuke-target").ok, true);
  for (const runeId of ["rebuke-r0", "rebuke-r1"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
    assert.equal(togglePaymentRune(game, runeId, "power").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "rebuke-target"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "rebuke-target"), true);
});

test("turn to dust declares a gear target and can target attached gear", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "temporary-gear-carrier");
  const attachedGear = instance(cards.guardianAngel, player.id, "attached-temporary-gear");
  const baseGear = instance(cards.trinityForce, player.id, "base-temporary-gear");
  unit.attachments = [attachedGear];
  player.base = [unit, baseGear];
  player.hand = [instance(cards.turnToDust, player.id, "turn-dust")];
  player.runes = [rune(DOMAINS.MIND, player.id, "dust-r1"), rune(DOMAINS.MIND, player.id, "dust-r2")];

  assert.equal(beginPlayCard(game, "turn-dust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId).sort(), [
    "attached-temporary-gear",
    "base-temporary-gear"
  ]);
  assert.equal(chooseEffectOption(game, "attached-temporary-gear").ok, true);
  assert.equal(togglePaymentRune(game, "dust-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "dust-r2", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(attachedGear.temporary, true);
  assert.equal(baseGear.temporary, undefined);
  assert.equal(unit.attachments.some((card) => card.instanceId === "attached-temporary-gear"), true);
});

test("turn to dust does not retarget if the declared gear is gone at resolution", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const declaredGear = instance(cards.guardianAngel, player.id, "declared-dust-gear");
  const otherGear = instance(cards.trinityForce, player.id, "other-dust-gear");
  player.base = [declaredGear, otherGear];
  player.hand = [instance(cards.turnToDust, player.id, "retarget-dust")];
  player.runes = [rune(DOMAINS.MIND, player.id, "retarget-dust-r1"), rune(DOMAINS.MIND, player.id, "retarget-dust-r2")];
  opponent.hand = [instance(cards.flash, opponent.id, "dust-response")];
  opponent.runes = [rune(DOMAINS.CHAOS, opponent.id, "dust-response-r1"), rune(DOMAINS.CHAOS, opponent.id, "dust-response-r2")];

  assert.equal(beginPlayCard(game, "retarget-dust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "declared-dust-gear").ok, true);
  assert.equal(togglePaymentRune(game, "retarget-dust-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "retarget-dust-r2", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.ok(game.actionChain);

  player.base = player.base.filter((card) => card.instanceId !== "declared-dust-gear");
  player.hand.push(declaredGear);

  while (game.actionChain && !game.pendingChoice && !game.pendingPayment) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(declaredGear.temporary, undefined);
  assert.equal(otherGear.temporary, undefined);
  assert.equal(player.hand.some((card) => card.instanceId === "declared-dust-gear"), true);
  assert.equal(player.base.some((card) => card.instanceId === "other-dust-gear"), true);
});

test("temporary gear is killed at the controller's beginning phase", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const gear = instance(cards.guardianAngel, player.id, "temporary-beginning-gear");
  gear.temporary = true;
  player.base = [gear];

  startTurn(game);

  assert.equal(player.base.some((card) => card.instanceId === "temporary-beginning-gear"), false);
  assert.equal(player.trash.some((card) => card.instanceId === "temporary-beginning-gear"), true);
});

test("arena's greatest first beginning point resolves through the trigger queue", () => {
  const game = createGame();
  finishSetup(game);
  const firstPlayer = currentPlayer(game);
  const nextPlayer = game.players.find((player) => player.id !== firstPlayer.id);
  game.battlefields[0] = {
    ...instance(cards.theArenasGreatest, firstPlayer.id, "arena-trigger-field"),
    controlledBy: null,
    units: [],
    hidden: []
  };
  const scoreBefore = nextPlayer.score;

  assert.equal(endTurn(game).ok, true);

  assert.equal(currentPlayer(game).id, nextPlayer.id);
  assert.equal(nextPlayer.score, scoreBefore + 1);
  assert.equal(nextPlayer.firstBeginningPointAwarded, true);
  assert.equal(game.triggerQueue.length, 0);
});

test("lonely poro deathknell draws a card and does not score points", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const poro = instance(cards.lonelyPoro, player.id, "lonely-deathknell");
  const drawCard = instance(cards.clockworkKeeper, player.id, "drawn-by-poro");
  field.units = [poro];
  field.controlledBy = player.id;
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.uncheckedPower, player.id, "poro-boardwipe")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "wipe-r1"),
    rune(DOMAINS.MIND, player.id, "wipe-r2"),
    rune(DOMAINS.MIND, player.id, "wipe-r3"),
    rune(DOMAINS.MIND, player.id, "wipe-r4"),
    rune(DOMAINS.MIND, player.id, "wipe-r5"),
    rune(DOMAINS.MIND, player.id, "wipe-r6"),
    rune(DOMAINS.MIND, player.id, "wipe-r7"),
    rune(DOMAINS.MIND, player.id, "wipe-r8"),
    rune(DOMAINS.MIND, player.id, "wipe-r9")
  ];
  const scoreBefore = player.score;

  assert.equal(playCard(game, "poro-boardwipe", "base").ok, true);
  assert.equal(player.score, scoreBefore);
  assert.equal(player.hand.some((card) => card.instanceId === "drawn-by-poro"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "lonely-deathknell"), true);
});

test("sabotage reveals non-unit cards from opponent hand and recycles the chosen card", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const spell = instance(cards.stackedDeck, opponent.id, "opponent-spell");
  const unit = instance(cards.ravenbloomStudent, opponent.id, "opponent-unit");
  opponent.hand = [spell, unit];
  player.hand = [instance(cards.sabotage, player.id, "explicit-sabotage")];
  player.runes = [rune(DOMAINS.BODY, player.id, "sabotage-rune")];

  assert.equal(beginPlayCard(game, "explicit-sabotage", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, opponent.id).ok, true);
  assert.equal(togglePaymentRune(game, "sabotage-rune", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "sabotage-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "sabotage");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["opponent-spell", "opponent-unit"]);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-spell").disabled, false);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-unit").disabled, true);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-spell").card.image, spell.image);
  assert.equal(game.pendingChoice.options.find((option) => option.cardId === "opponent-unit").card.image, unit.image);
  assert.equal(chooseEffectOption(game, "opponent-unit").ok, false);

  assert.equal(chooseEffectOption(game, "opponent-spell").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "opponent-spell"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "opponent-unit"), true);
  assert.equal(opponent.mainDeck.at(-1).instanceId, "opponent-spell");
});

test("multiplayer snapshots reveal real hand and facedown card art while intel is active", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const viewer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== viewer.id);
  const handCard = instance(cards.stackedDeck, opponent.id, "intel-hand-card");
  const hiddenCard = instance(cards.backOff, opponent.id, "intel-hidden-card");
  opponent.hand = [handCard];
  game.battlefields[0].hidden = [{
    ownerId: opponent.id,
    hiddenByPlayerId: opponent.id,
    playableFromTurnSequence: game.turnSequence,
    card: hiddenCard
  }];
  game.revealedIntel = [{
    viewerId: viewer.id,
    ownerId: opponent.id,
    sourceCardId: "test-source",
    sourceName: "Test reveal",
    expiresAtTurnSequence: game.turnSequence
  }];

  const room = {
    roomId: "TEST",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true, deckRecord: { name: "Viewer" } }, p2: { ready: true, deckRecord: { name: "Opponent" } } },
    game,
    createdAt: 0,
    updatedAt: 0
  };
  const snapshot = snapshotForPlayer(room, viewer.id);
  const snapshotOpponent = snapshot.game.players.find((player) => player.id === opponent.id);
  const snapshotHidden = snapshot.game.battlefields[0].hidden[0].card;

  assert.equal(snapshotOpponent.hand[0].name, handCard.name);
  assert.equal(snapshotOpponent.hand[0].image, handCard.image);
  assert.equal(snapshotOpponent.hand[0].redacted, undefined);
  assert.equal(snapshotHidden.name, hiddenCard.name);
  assert.equal(snapshotHidden.image, hiddenCard.image);
  assert.equal(snapshotHidden.redacted, undefined);
});

test("multiplayer snapshots hide opponent battlefield choices until setup selection finishes", () => {
  const game = createGame({ interactive: true });
  finishChampionSelection(game);
  const viewer = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== viewer.id);
  const room = {
    roomId: "TEST",
    status: "playing",
    hostPlayerId: "p1",
    seats: { p1: { ready: true, deckRecord: { name: "Viewer" } }, p2: { ready: true, deckRecord: { name: "Opponent" } } },
    game,
    createdAt: 0,
    updatedAt: 0
  };

  const snapshot = snapshotForPlayer(room, viewer.id);
  const snapshotOpponent = snapshot.game.players.find((player) => player.id === opponent.id);

  assert.equal(snapshotOpponent.availableBattlefields[0].name, "Hidden Card");
  assert.equal(snapshotOpponent.availableBattlefields[0].image, "");
  assert.equal(snapshotOpponent.availableBattlefields[0].redacted, true);
});

test("first mate readies another exhausted friendly unit only", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const exhausted = instance(cards.lonelyPoro, player.id, "ready-target");
  exhausted.exhausted = true;
  player.base = [exhausted];
  player.hand = [instance(cards.firstMate, player.id, "explicit-first-mate")];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "mate-r1"),
    rune(DOMAINS.BODY, player.id, "mate-r2"),
    rune(DOMAINS.BODY, player.id, "mate-r3")
  ];

  assert.equal(beginPlayCard(game, "explicit-first-mate", "base").ok, true);
  for (const runeCard of player.runes) assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "readyUnit");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["ready-target"]);

  assert.equal(chooseEffectOption(game, "ready-target").ok, true);
  assert.equal(exhausted.exhausted, false);
});

test("scuttle crab draws on play and gains xp on deathknell", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const drawCard = instance(cards.charm, player.id, "scuttle-draw");
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.scuttleCrab, player.id, "explicit-scuttle")];
  opponent.hand = [instance(cards.gust, opponent.id, "scuttle-revealed-hand")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "scuttle-r1"),
    rune(DOMAINS.CALM, player.id, "scuttle-r2")
  ];

  assert.equal(playCard(game, "explicit-scuttle", "base").ok, true);
  const scuttle = player.base.find((card) => card.name === "Scuttle Crab");
  assert.equal(player.hand.some((card) => card.instanceId === "scuttle-draw"), true);
  const xpBefore = player.xp;
  scuttle.damage = 1;

  startTurn(game);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, "scuttle-revealed-hand");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(player.xp, xpBefore + 1);
  assert.equal(player.trash.some((card) => card.name === "Scuttle Crab"), true);
  assert.equal(game.revealedIntel.some((item) =>
    item.viewerId === player.id
    && item.ownerId === opponent.id
    && item.expiresAtTurnSequence === game.turnSequence
  ), true);

  endTurn(game);
  assert.equal(game.revealedIntel.some((item) => item.viewerId === player.id && item.ownerId === opponent.id), false);
});

test("deathknell queue resumes after a draw-triggered choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const fieldA = game.battlefields[0];
  const fieldB = game.battlefields[1];
  for (const field of game.battlefields) field.effects = [];
  const poro = instance(cards.lonelyPoro, player.id, "queued-poro");
  const scuttle = instance(cards.scuttleCrab, player.id, "queued-scuttle");
  const jewel = instance(cards.frigidJewel, player.id, "queued-jewel");
  const target = instance(cards.clockworkKeeper, player.id, "queued-jewel-target");
  fieldA.units = [poro];
  fieldB.units = [scuttle];
  player.base = [jewel, target];
  player.drawCountThisTurn = 1;
  player.mainDeck = [instance(cards.charm, player.id, "queued-death-draw")];
  player.hand = [instance(cards.uncheckedPower, player.id, "queued-boardwipe")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "queued-wipe-r1"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r2"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r3"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r4"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r5"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r6"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r7"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r8"),
    rune(DOMAINS.MIND, player.id, "queued-wipe-r9")
  ];
  const xpBefore = player.xp;

  assert.equal(playCard(game, "queued-boardwipe", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);

  assert.equal(chooseEffectOption(game, "queued-jewel-target").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.triggerQueue.length, 0);
  assert.equal(player.xp, xpBefore + 1);
  assert.equal(target.buffs, 2);
});

test("pending end turn resumes after lonely poro deathknell draw choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  for (const battlefield of game.battlefields) battlefield.effects = [];
  field.units = [instance(cards.lonelyPoro, player.id, "end-turn-poro")];
  player.base = [
    instance(cards.frigidJewel, player.id, "end-turn-jewel"),
    instance(cards.clockworkKeeper, player.id, "end-turn-target")
  ];
  player.drawCountThisTurn = 1;
  player.mainDeck = [instance(cards.charm, player.id, "end-turn-draw")];
  player.hand = [instance(cards.uncheckedPower, player.id, "end-turn-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `end-turn-rune-${index}`));

  assert.equal(playCard(game, "end-turn-boardwipe", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");

  game.pendingEndTurnPlayerId = player.id;
  game.currentPlayerId = opponent.id;
  assert.equal(chooseEffectOption(game, "end-turn-target").ok, true);

  assert.equal(game.pendingEndTurnPlayerId, undefined);
  assert.equal(game.currentPlayerId, opponent.id);
  assert.equal(game.phase, "action");
});

test("clockwork keeper draws only when its optional calm power is selected and paid", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const drawCard = instance(cards.charm, player.id, "clockwork-draw");
  player.mainDeck = [drawCard];
  player.hand = [instance(cards.clockworkKeeper, player.id, "explicit-clockwork")];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "clockwork-energy-one"),
    rune(DOMAINS.CALM, player.id, "clockwork-energy-two"),
    rune(DOMAINS.CALM, player.id, "clockwork-power")
  ];

  assert.equal(beginPlayCard(game, "explicit-clockwork", "base").ok, true);
  assert.equal(game.pendingPayment.optionalPowerEffects.length, 1);
  assert.equal(toggleOptionalPaymentEffect(game, game.pendingPayment.optionalPowerEffects[0].id).ok, true);
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.CALM, amount: 1 }]);
  assert.equal(togglePaymentRune(game, "clockwork-energy-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "clockwork-energy-two", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "clockwork-power", "power").ok, true);

  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "clockwork-draw"), true);
  assert.equal(player.runeDeck.at(-1).instanceId, "clockwork-power");
  assert.equal(player.runes.some((card) => card.instanceId === "clockwork-power"), false);
});

test("stalwart poro shield applies only while defending", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.ravenbloomStudent, opponent.id, "shield-attacker");
  const defender = instance(cards.stalwartPoro, player.id, "shield-defender");
  field.units = [attacker, defender];
  field.controlledBy = player.id;

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, false);
  field.units = [attacker, defender];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: opponent.id,
    consecutivePasses: 0,
    chain: []
  };
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "shield-defender"), false);
});

test("ravenbloom student gets might when its controller plays a spell", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const student = instance(cards.ravenbloomStudent, player.id, "explicit-student");
  player.base = [student];
  player.hand = [instance(cards.stackedDeck, player.id, "student-spell")];
  player.mainDeck = [
    instance(cards.charm, player.id, "top-1"),
    instance(cards.gust, player.id, "top-2"),
    instance(cards.flash, player.id, "top-3")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "student-rune")];

  assert.equal(playCard(game, "student-spell", "base").ok, true);
  assert.equal(student.buffs, 1);
});

test("master yi tempered gains ganking only at level 6 xp", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = game.battlefields[0];
  const second = game.battlefields[1];
  const yi = instance(cards.masterYiTempered, player.id, "tempered-level");
  yi.exhausted = false;
  first.units = [yi];
  first.controlledBy = player.id;
  second.controlledBy = player.id;

  assert.equal(moveUnit(game, "tempered-level", second.instanceId).ok, false);
  yi.exhausted = false;
  player.xp = 6;
  assert.equal(moveUnit(game, "tempered-level", second.instanceId).ok, true);
  assert.equal(second.units.some((unit) => unit.instanceId === "tempered-level"), true);
});

test("ambush requires a friendly unit unless the card says otherwise", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  field.units = [instance(cards.ravenbloomStudent, opponent.id, "ambush-enemy")];
  field.controlledBy = opponent.id;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.vilemaw, player.id, "ambush-vilemaw")];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.CALM, player.id, `vile-r${index}`));

  assert.equal(playCard(game, "ambush-vilemaw", field.instanceId).ok, false);

  player.hand = [instance(cards.rengarTrophyHunter, player.id, "ambush-rengar")];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.BODY, player.id, `rengar-r${index}`));
  assert.equal(playCard(game, "ambush-rengar", field.instanceId).ok, true);
  assert.equal(game.showdown.chain[0].card.name, "Rengar, Trophy Hunter");
});

test("Rengar can be played normally to a battlefield containing only enemy units", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "rengar-enemy-only-unit")];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.rengarTrophyHunter, player.id, "normal-rengar")];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `normal-rengar-r${index}`));

  assert.equal(beginPlayCard(game, "normal-rengar", field.instanceId).ok, true);
  assert.equal(game.pendingPayment?.cardId, "normal-rengar");
  assert.equal(game.pendingPayment?.destination, field.instanceId);
});

test("explicit Might bonuses stack according to their card text", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "buff-cap-target");
  player.base = [unit];
  player.hand = [
    instance(cards.punchFirst, player.id, "buff-cap-one"),
    instance(cards.punchFirst, player.id, "buff-cap-two")
  ];
  player.runes = [
    rune(DOMAINS.BODY, player.id, "buff-r1"),
    rune(DOMAINS.BODY, player.id, "buff-r2"),
    rune(DOMAINS.BODY, player.id, "buff-r3"),
    rune(DOMAINS.BODY, player.id, "buff-r4"),
    rune(DOMAINS.BODY, player.id, "buff-r5"),
    rune(DOMAINS.BODY, player.id, "buff-r6")
  ];

  assert.equal(playCard(game, "buff-cap-one", "base").ok, true);
  assert.equal(unit.buffs, 5);
  assert.equal(playCard(game, "buff-cap-two", "base").ok, true);
  assert.equal(unit.buffs, 10);
});

test("deflect can be paid with the rune already spent for energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const deflectUnit = instance(cards.vexApathetic, opponent.id, "deflect-target");
  const plainUnit = instance(cards.ravenbloomStudent, opponent.id, "plain-target");
  opponent.base = [deflectUnit, plainUnit];
  player.hand = [instance(cards.stupefy, player.id, "deflect-stupefy")];
  player.runes = [rune(DOMAINS.MIND, player.id, "only-energy")];

  assert.equal(beginPlayCard(game, "deflect-stupefy", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["deflect-target", "plain-target"]);
  assert.equal(chooseEffectOption(game, "deflect-target").ok, true);
  assert.equal(togglePaymentRune(game, "only-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "only-energy", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(deflectUnit.buffs, -1);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "only-energy"), true);
});

test("choosing a deflect target pays additional power when the effect resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const deflectUnit = instance(cards.vexApathetic, opponent.id, "paid-deflect-target");
  opponent.base = [deflectUnit];
  player.hand = [instance(cards.stupefy, player.id, "paid-deflect-stupefy")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "spell-energy"),
    rune(DOMAINS.MIND, player.id, "deflect-power")
  ];

  assert.equal(beginPlayCard(game, "paid-deflect-stupefy", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["paid-deflect-target"]);
  assert.equal(chooseEffectOption(game, "paid-deflect-target").ok, true);
  assert.equal(togglePaymentRune(game, "spell-energy", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "deflect-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(deflectUnit.buffs, -1);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "deflect-power"), true);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "spell-energy"), false);
});

test("existential dread can repeat its stun effect and return an already stunned attacker", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.ravenbloomStudent, opponent.id, "repeat-attacker");
  field.units = [attacker, instance(cards.lonelyPoro, player.id, "repeat-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.existentialDread, player.id, "repeat-dread")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "dread-power"),
    rune(DOMAINS.CHAOS, player.id, "dread-repeat-1"),
    rune(DOMAINS.CHAOS, player.id, "dread-repeat-2")
  ];

  assert.equal(playCard(game, "repeat-dread", field.instanceId).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "stunUnit");

  assert.equal(chooseEffectOption(game, "repeat-attacker").ok, true);
  assert.equal(attacker.stunned, true);
  assert.equal(game.pendingChoice.effect, "repeatSpell");

  assert.equal(chooseEffectOption(game, "repeat").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  payPendingEnergy(game, ["dread-repeat-1", "dread-repeat-2"]);
  assert.equal(game.pendingChoice.effect, "stunUnit");
  assert.equal(chooseEffectOption(game, "repeat-attacker").ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "repeat-attacker"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "repeat-attacker"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "repeat-dread"), true);
});

test("hard bargain can repeat to counter multiple spells on the showdown chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const firstSpell = instance(cards.stackedDeck, opponent.id, "repeat-chain-one");
  const secondSpell = instance(cards.gust, opponent.id, "repeat-chain-two");
  field.units = [
    instance(cards.lonelyPoro, opponent.id, "bargain-attacker"),
    instance(cards.ravenbloomStudent, player.id, "bargain-defender")
  ];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [
      { card: firstSpell, playerId: opponent.id, destination: "base" },
      { card: secondSpell, playerId: opponent.id, destination: "base" }
    ]
  };
  game.currentPlayerId = player.id;
  opponent.runes = [];
  player.hand = [instance(cards.hardBargain, player.id, "repeat-bargain")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "bargain-energy-1"),
    rune(DOMAINS.CHAOS, player.id, "bargain-energy-2"),
    rune(DOMAINS.CHAOS, player.id, "bargain-repeat-1"),
    rune(DOMAINS.CHAOS, player.id, "bargain-repeat-2")
  ];

  assert.equal(playCard(game, "repeat-bargain", field.instanceId).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "counterUnlessPay");

  assert.equal(chooseEffectOption(game, "repeat-chain-one").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "repeat-chain-one"), true);
  assert.equal(game.pendingChoice.effect, "repeatSpell");

  assert.equal(chooseEffectOption(game, "repeat").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  payPendingEnergy(game, ["bargain-repeat-1", "bargain-repeat-2"]);
  assert.equal(game.pendingChoice.effect, "counterUnlessPay");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["repeat-chain-two"]);
  assert.equal(chooseEffectOption(game, "repeat-chain-two").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "repeat-chain-two"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "repeat-bargain"), true);
});

test("counter spells declare their chain target before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const chainSpell = instance(cards.gust, opponent.id, "declared-chain-gust");
  field.units = [
    instance(cards.lonelyPoro, opponent.id, "declared-chain-attacker"),
    instance(cards.ravenbloomStudent, player.id, "declared-chain-defender")
  ];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{ card: chainSpell, playerId: opponent.id, destination: "base", state: "finalized" }]
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.hardBargain, player.id, "declared-bargain")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "declared-bargain-one"),
    rune(DOMAINS.CHAOS, player.id, "declared-bargain-two")
  ];

  assert.equal(beginPlayCard(game, "declared-bargain", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["declared-chain-gust"]);
  assert.equal(chooseEffectOption(game, "declared-chain-gust").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "repeat-count-0").ok, true);
  assert.equal(game.pendingPayment.cardId, "declared-bargain");
  assert.equal(togglePaymentRune(game, "declared-bargain-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "declared-bargain-two", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.showdown.chain.at(-1).card.instanceId, "declared-bargain");
  assert.deepEqual(game.showdown.chain.at(-1).card.declaredPlayTargets, [
    { effect: "counterUnlessPay", targetId: "declared-chain-gust" }
  ]);
});

test("star-crossed requires explicit friendly and enemy unit choices", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const friendly = instance(cards.lonelyPoro, player.id, "star-friendly");
  const firstEnemy = instance(cards.ravenbloomStudent, opponent.id, "star-enemy-one");
  const secondEnemy = instance(cards.vexCheerless, opponent.id, "star-enemy-two");
  friendly.damage = 1;
  friendly.buffs = 2;
  friendly.stunned = true;
  friendly.exhausted = true;
  friendly.attachments = [instance(cards.trinityForce, player.id, "star-trinity")];
  secondEnemy.damage = 1;
  secondEnemy.buffs = 1;
  player.base = [friendly];
  opponent.base = [firstEnemy, secondEnemy];
  player.hand = [instance(cards.starCrossed, player.id, "explicit-star")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `star-r${index}`));

  assert.equal(playCard(game, "explicit-star", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "starCrossed");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["star-friendly"]);

  assert.equal(chooseEffectOption(game, "star-friendly").ok, true);
  assert.equal(game.pendingChoice.effect, "starCrossedEnemy");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["star-enemy-one", "star-enemy-two"]);

  assert.equal(chooseEffectOption(game, "star-enemy-two").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "star-friendly"), false);
  assert.equal(player.hand.some((card) => card.instanceId === "star-friendly"), true);
  const returnedFriendly = player.hand.find((card) => card.instanceId === "star-friendly");
  assert.equal(returnedFriendly.damage, 0);
  assert.equal(returnedFriendly.buffs, 0);
  assert.equal(returnedFriendly.stunned, false);
  assert.equal(returnedFriendly.exhausted, false);
  assert.deepEqual(returnedFriendly.attachments, []);
  assert.equal(player.base.some((card) => card.instanceId === "star-trinity"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "star-trinity"), false);
  assert.equal(opponent.base.some((card) => card.instanceId === "star-enemy-one"), true);
  assert.equal(opponent.base.some((card) => card.instanceId === "star-enemy-two"), false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "star-enemy-two"), true);
  const returnedEnemy = opponent.hand.find((card) => card.instanceId === "star-enemy-two");
  assert.equal(returnedEnemy.damage, 0);
  assert.equal(returnedEnemy.buffs, 0);
});

test("moonfall explicitly chooses the battlefield and optional enemy move", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const destination = game.battlefields[0];
  const friendly = instance(cards.lonelyPoro, player.id, "moon-friendly");
  const enemyAlreadyThere = instance(cards.ravenbloomStudent, opponent.id, "moon-local-enemy");
  const movedEnemy = instance(cards.vexCheerless, opponent.id, "moon-moved-enemy");
  destination.units = [friendly, enemyAlreadyThere];
  destination.controlledBy = null;
  opponent.base = [movedEnemy];
  player.hand = [instance(cards.moonfall, player.id, "explicit-moonfall")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `moon-r${index}`));

  assert.equal(playCard(game, "explicit-moonfall", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "moonfall");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [destination.instanceId]);

  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "moonfallMove");
  assert.ok(game.pendingChoice.options.some((option) => option.cardId === "moon-moved-enemy"));

  assert.equal(chooseEffectOption(game, "moon-moved-enemy").ok, true);
  assert.equal(opponent.base.some((unit) => unit.instanceId === "moon-moved-enemy"), false);
  assert.equal(destination.units.some((unit) => unit.instanceId === "moon-moved-enemy"), true);
  assert.equal(enemyAlreadyThere.buffs, -2);
  assert.equal(movedEnemy.buffs, -2);
  assert.equal(enemyAlreadyThere.temporaryMight, -2);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, destination.instanceId);
  assert.equal(game.showdown.attackerId, player.id);
  assert.equal(game.showdown.combat, true);

  startTurn(game);
  assert.equal(enemyAlreadyThere.buffs, 0);
  assert.equal(movedEnemy.buffs, 0);
  assert.equal(enemyAlreadyThere.temporaryMight, undefined);
});

test("non-combat showdown becomes combat when an opposing unit enters during it", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const friendly = instance(cards.lonelyPoro, player.id, "noncombat-friendly");
  field.units = [friendly];
  field.controlledBy = null;
  player.base = [friendly];
  opponent.hand = [instance(cards.rengarTrophyHunter, opponent.id, "noncombat-rengar")];
  opponent.runes = [
    rune(DOMAINS.BODY, opponent.id, "rengar-r1"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r2"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r3"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r4"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r5"),
    rune(DOMAINS.BODY, opponent.id, "rengar-r6")
  ];
  field.units = [];
  friendly.exhausted = false;

  assert.equal(moveUnit(game, friendly.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, false);
  assert.equal(friendly.damage, 0);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(playCard(game, "noncombat-rengar", field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, true);
  assert.equal(game.showdown.defenderId, opponent.id);
  assert.equal(field.units.some((unit) => unit.instanceId === "noncombat-rengar"), true);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "combatDamage");
});

test("showdown movement still checks conquest after units leave the battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const moonfallField = game.battlefields[0];
  const escapeField = game.battlefields[1];
  const playerUnit = instance(cards.lonelyPoro, player.id, "moonfall-friendly");
  const enemyUnit = instance(cards.ravenbloomStudent, opponent.id, "moonfall-enemy");

  moonfallField.units = [playerUnit];
  moonfallField.controlledBy = player.id;
  escapeField.units = [];
  escapeField.controlledBy = null;
  opponent.base = [enemyUnit];
  player.hand = [instance(cards.moonfall, player.id, "conquest-moonfall")];
  opponent.hand = [instance(cards.rideTheWind, opponent.id, "conquest-ride")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "moonfall-energy-1"),
    rune(DOMAINS.MIND, player.id, "moonfall-energy-2"),
    rune(DOMAINS.CHAOS, player.id, "moonfall-energy-3"),
    rune(DOMAINS.CHAOS, player.id, "moonfall-power")
  ];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "ride-energy-1"),
    rune(DOMAINS.CHAOS, opponent.id, "ride-energy-2"),
    rune(DOMAINS.CHAOS, opponent.id, "ride-power")
  ];

  assert.equal(beginPlayCard(game, "conquest-moonfall", "base").ok, true);
  assert.equal(chooseEffectOption(game, moonfallField.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, enemyUnit.instanceId).ok, true);
  for (const id of ["moonfall-energy-1", "moonfall-energy-2", "moonfall-energy-3"]) {
    assert.equal(togglePaymentRune(game, id, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "moonfall-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.phase, "showdown");

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(beginPlayCard(game, "conquest-ride", escapeField.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, enemyUnit.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareMoveDestination");
  assert.equal(chooseEffectOption(game, escapeField.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-energy-2", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "ride-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);

  assert.equal(escapeField.controlledBy, opponent.id);
  assert.equal(opponent.score, 1);
  assert.equal(moonfallField.controlledBy, player.id);

  assert.equal(passShowdown(game, game.currentPlayerId).ok, true);
  assert.equal(passShowdown(game, game.currentPlayerId).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(moonfallField.controlledBy, player.id);
});

test("combat showdown skips combat damage if the attacking side leaves after reactions", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "escape-combat-attacker");
  const defender = instance(cards.ravenbloomStudent, opponent.id, "escape-combat-defender");
  player.base = [attacker];
  field.units = [defender];
  field.controlledBy = opponent.id;
  opponent.hand = [instance(cards.gust, opponent.id, "escape-combat-gust")];
  opponent.runes = [rune(DOMAINS.CHAOS, opponent.id, "escape-combat-rune")];

  assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.combat, true);
  assert.equal(passShowdown(game, player.id).ok, true);

  assert.equal(beginPlayCard(game, "escape-combat-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, attacker.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "escape-combat-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === attacker.instanceId), true);
  assert.equal(field.units.some((unit) => unit.instanceId === defender.instanceId), true);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.phase, "action");
  assert.equal(field.controlledBy, opponent.id);
  assert.equal(player.trash.some((card) => card.instanceId === attacker.instanceId), false);
  assert.equal(opponent.trash.some((card) => card.instanceId === defender.instanceId), false);
});

test("a battlefield can only score once for the same player each turn", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const holder = instance(cards.lonelyPoro, player.id, "single-score-holder");
  const second = instance(cards.ravenbloomStudent, player.id, "single-score-second");
  field.units = [holder];
  field.controlledBy = player.id;
  player.base = [second];

  startTurn(game);
  assert.equal(player.score, 1);

  assert.equal(moveUnit(game, holder.instanceId, "base").ok, true);
  assert.equal(field.controlledBy, null);
  assert.equal(moveUnit(game, second.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);

  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("combat awards conquest when defenders take an uncontrolled battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const attackerPlayer = currentPlayer(game);
  const defenderPlayer = game.players[1];
  const attacker = instance(cards.lonelyPoro, attackerPlayer.id, "defender-score-attacker");
  const defender = instance(cards.ravenbloomStudent, defenderPlayer.id, "defender-score-defender");
  const field = game.battlefields[0];
  attacker.might = 1;
  defender.might = 3;
  field.units = [attacker, defender];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: attackerPlayer.id,
    attackerId: attackerPlayer.id,
    defenderId: defenderPlayer.id,
    priorityPlayerId: attackerPlayer.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(passShowdown(game, attackerPlayer.id).ok, true);
  assert.equal(passShowdown(game, defenderPlayer.id).ok, true);

  assert.equal(field.controlledBy, defenderPlayer.id);
  assert.equal(defenderPlayer.score, 1);
  assert.equal(attackerPlayer.base.some((unit) => unit.instanceId === attacker.instanceId), false);
});

test("alpha strike explicitly allocates damage among battlefield enemies", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const striker = instance(cards.masterYiTempered, player.id, "alpha-striker");
  const firstEnemy = instance(cards.ravenbloomStudent, opponent.id, "alpha-enemy-one");
  const secondEnemy = instance(cards.lonelyPoro, opponent.id, "alpha-enemy-two");
  field.units = [striker, firstEnemy, secondEnemy];
  field.controlledBy = null;
  player.hand = [instance(cards.alphaStrike, player.id, "explicit-alpha")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `alpha-r${index}`));
  const xpBefore = player.xp;

  assert.equal(playCard(game, "explicit-alpha", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "alphaStrike");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["alpha-striker"]);

  assert.equal(chooseEffectOption(game, "alpha-striker").ok, true);
  assert.equal(game.pendingChoice.effect, "alphaStrikeDamage");
  assert.ok(game.pendingChoice.options.some((option) => option.id === "alpha-enemy-one:2"));

  assert.equal(chooseEffectOption(game, "alpha-enemy-one:2").ok, true);
  assert.equal(firstEnemy.damage, 2);
  assert.equal(game.pendingChoice.effect, "alphaStrikeDamage");
  assert.equal(chooseEffectOption(game, "alpha-enemy-two:2").ok, true);
  assert.equal(secondEnemy.damage, 2);
  assert.equal(player.xp, xpBefore + 2);
});

test("hard bargain lets the targeted spell controller decide whether to pay energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const chainSpell = instance(cards.gust, opponent.id, "bargain-pay-target");
  field.units = [
    instance(cards.lonelyPoro, opponent.id, "pay-attacker"),
    instance(cards.ravenbloomStudent, player.id, "pay-defender")
  ];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{ card: chainSpell, playerId: opponent.id, destination: "base" }]
  };
  game.currentPlayerId = player.id;
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "pay-energy-one"),
    rune(DOMAINS.CHAOS, opponent.id, "pay-energy-two")
  ];
  player.hand = [instance(cards.hardBargain, player.id, "pay-bargain")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "pay-bargain-one"),
    rune(DOMAINS.CHAOS, player.id, "pay-bargain-two")
  ];

  assert.equal(playCard(game, "pay-bargain", field.instanceId).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "counterUnlessPay");
  assert.equal(chooseEffectOption(game, "bargain-pay-target").ok, true);
  assert.equal(game.pendingChoice.effect, "counterUnlessPayDecision");

  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  payPendingEnergy(game, ["pay-energy-one", "pay-energy-two"]);
  assert.equal(game.showdown.chain.some((item) => item.card.instanceId === "bargain-pay-target"), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "bargain-pay-target"), false);
  assert.equal(opponent.runes.every((runeCard) => runeCard.exhausted), true);
});

test("targeted spell does not retarget if declared unit leaves before resolution", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const field = game.battlefields[0];
  const declared = instance(cards.lonelyPoro, opponent.id, "stale-gust-target");
  const other = instance(cards.ravenbloomStudent, opponent.id, "stale-gust-other");
  const gust = instance(cards.gust, player.id, "stale-gust");
  gust.declaredPlayTargets = [{ effect: "returnUnitToHand", targetId: declared.instanceId }];
  field.units = [declared, other];
  field.controlledBy = opponent.id;
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [{ id: "stale-gust-chain", itemType: "card", card: gust, playerId: player.id, destination: "base", status: "finalized" }]
  };
  field.units = field.units.filter((unit) => unit.instanceId !== declared.instanceId);
  opponent.base.push(declared);

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.base.some((unit) => unit.instanceId === declared.instanceId), true);
  assert.equal(opponent.hand.some((unit) => unit.instanceId === declared.instanceId), false);
  assert.equal(field.units.some((unit) => unit.instanceId === other.instanceId), true);
});

test("diana lunari showdown trigger asks before paying energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-revealed-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-energy")];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-attacker", field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.pendingChoice, null);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.showdown.chain[0].status, "pending");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");
  assert.equal(opponent.runes[0].exhausted, false);

  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  assert.deepEqual(game.pendingPayment.powerRuneIds, []);
  payPendingEnergy(game, ["diana-energy"]);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.runes[0].exhausted, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-revealed-spell"), true);
});

test("diana lunari showdown trigger can be declined", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-decline-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-decline-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-decline-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-decline-energy")];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-decline-attacker", field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");

  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(opponent.runes[0].exhausted, false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-decline-spell"), false);
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
});

test("diana lunari showdown trigger opens manual payment for generated energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-pool-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-pool-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-pool-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [];
  opponent.runePool = {
    energy: [{
      id: "diana-pool-energy",
      type: "energy",
      domains: [DOMAINS.MIND, DOMAINS.CHAOS],
      sourceCardId: opponent.legend.instanceId,
      sourceName: opponent.legend.name,
      restriction: "showdown"
    }],
    power: []
  };
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-pool-attacker", field.instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");

  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  assert.equal(game.pendingPayment.effectPayment.kind, "showdownPredictDrawSpell");
  assert.equal(togglePaymentPoolEnergy(game, "diana-pool-energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.runePool.energy.length, 0);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-pool-spell"), true);
});

test("diana lunari showdown trigger works through multiplayer commands", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const room = { game, hostPlayerId: "p1" };
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "diana-online-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "diana-online-trigger");
  const revealedSpell = instance(cards.gust, opponent.id, "diana-online-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "diana-online-energy")];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "diana-online-attacker", field.instanceId).ok, true);
  assert.equal(applyGameCommand(room, player.id, { kind: "passShowdown" }).ok, true);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "passShowdown" }).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(applyGameCommand(room, opponent.id, { kind: "chooseEffectOption", optionId: "pay" }).ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  assert.equal(game.pendingPayment.playerId, opponent.id);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "togglePaymentRune", runeId: "diana-online-energy", mode: "energy" }).ok, true);
  assert.equal(applyGameCommand(room, opponent.id, { kind: "confirmPayment" }).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(applyGameCommand(room, opponent.id, { kind: "chooseEffectOption", optionId: "keep" }).ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(applyGameCommand(room, opponent.id, { kind: "chooseEffectOption", optionId: "continue" }).ok, true);
  assert.equal(opponent.runes[0].exhausted, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "diana-online-spell"), true);
});

test("scorn of the moon adds showdown energy without becoming a chain item", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "scorn-chain-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "scorn-chain-diana");
  const revealedSpell = instance(cards.gust, opponent.id, "scorn-chain-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [];
  opponent.mainDeck = [revealedSpell];
  opponent.legend.exhausted = false;

  assert.equal(moveUnit(game, "scorn-chain-attacker", field.instanceId).ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.showdown.priorityPlayerId, player.id);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(activateCard(game, opponent.legend.instanceId).ok, true);
  assert.equal(opponent.runePool.energy.length, 1);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(opponent.legend.exhausted, true);

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");
  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  assert.equal(togglePaymentPoolEnergy(game, opponent.runePool.energy[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "scorn-chain-spell"), true);
});

test("generated energy must be selected for effect energy payments", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const attacker = instance(cards.lonelyPoro, player.id, "generated-pay-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "generated-pay-diana");
  const revealedSpell = instance(cards.gust, opponent.id, "generated-pay-spell");
  player.base = [attacker];
  field.units = [diana];
  field.controlledBy = opponent.id;
  opponent.runes = [];
  opponent.runePool.energy = [{
    id: "generated-effect-energy",
    type: "energy",
    domains: cards.dianaScornOfTheMoon.domains,
    sourceCardId: opponent.legend.instanceId,
    sourceName: opponent.legend.name,
    restriction: "showdown"
  }];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "generated-pay-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");
  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "generated-effect-energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(opponent.runePool.energy.length, 0);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "generated-pay-spell"), true);
});

test("spell-only add energy abilities follow reaction windows and exhaust their legend", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.legend = instance(cards.kaiSaDaughterOfTheVoid, player.id, "daughter-open");

  assert.equal(activateCard(game, "daughter-open").ok, true);
  assert.equal(player.legend.exhausted, true);
  assert.equal(player.runePool.energy.length, 1);
  assert.equal(player.runePool.energy[0].restriction, "spell");

  player.legend.exhausted = false;
  player.runePool.energy = [];
  const opponent = game.players[1];
  game.currentPlayerId = opponent.id;
  assert.equal(activateCard(game, "daughter-open").ok, false);

  game.actionChain = {
    turnPlayerId: opponent.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{ card: instance(cards.gust, opponent.id, "daughter-chain-spell"), playerId: opponent.id, destination: "base", status: "finalized" }],
    chainSequence: 1
  };
  game.currentPlayerId = player.id;
  assert.equal(activateCard(game, "daughter-open").ok, true);
  assert.equal(player.legend.exhausted, true);
  assert.equal(player.runePool.energy.length, 1);
});

test("spell-only generated energy can pay spells but not unit costs", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.legend = instance(cards.kaiSaDaughterOfTheVoid, player.id, "daughter-resource");
  player.hand = [instance(cards.lonelyPoro, player.id, "daughter-unit")];
  player.runes = [];

  assert.equal(activateCard(game, "daughter-resource").ok, true);
  const spellOnlyEnergyId = player.runePool.energy[0].id;
  assert.equal(beginPlayCard(game, "daughter-unit", "base").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, spellOnlyEnergyId).ok, false);
  assert.equal(confirmPayment(game).ok, false);
  game.pendingPayment = null;

  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "daughter-spell-target");
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.gust, player.id, "daughter-gust")];

  assert.equal(beginPlayCard(game, "daughter-gust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "daughter-spell-target").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, spellOnlyEnergyId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runePool.energy.length, 0);
});

test("generated spell energy expires and does not leak into later turns", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.legend = instance(cards.kaiSaDaughterOfTheVoid, player.id, "daughter-expire");

  assert.equal(activateCard(game, "daughter-expire").ok, true);
  assert.equal(player.runePool.energy.length, 1);
  assert.equal(player.runePool.energy[0].restriction, "spell");

  assert.equal(endTurn(game).ok, true);
  assert.equal(player.runePool.energy.length, 0);
  assert.equal(opponent.runePool.energy.length, 0);
  assert.equal(game.currentPlayerId, opponent.id);
});

test("payment only allows compatible generated energy when multiple pool energies exist", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.runes = [];
  player.runePool.energy = [
    {
      id: "pool-spell-only",
      type: "energy",
      domains: [DOMAINS.MIND],
      sourceCardId: "daughter",
      sourceName: "Daughter Energy",
      restriction: "spell"
    },
    {
      id: "pool-showdown-only",
      type: "energy",
      domains: [DOMAINS.CHAOS],
      sourceCardId: "scorn",
      sourceName: "Scorn Energy",
      restriction: "showdown"
    },
    {
      id: "pool-unrestricted",
      type: "energy",
      domains: [DOMAINS.CALM],
      sourceCardId: "test",
      sourceName: "Open Energy",
      restriction: null
    }
  ];

  player.hand = [instance(cards.lonelyPoro, player.id, "mixed-energy-unit")];
  assert.equal(beginPlayCard(game, "mixed-energy-unit", "base").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, "pool-spell-only").ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "pool-showdown-only").ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "pool-unrestricted").ok, true);
  assert.equal(confirmPayment(game).ok, false);

  game.pendingPayment = null;
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "mixed-energy-target")];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.gust, player.id, "mixed-energy-gust")];

  assert.equal(beginPlayCard(game, "mixed-energy-gust", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "mixed-energy-target").ok, true);
  assert.equal(togglePaymentPoolEnergy(game, "pool-showdown-only").ok, false);
  assert.equal(togglePaymentPoolEnergy(game, "pool-spell-only").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.runePool.energy.some((resource) => resource.id === "pool-spell-only"), false);
  assert.equal(player.runePool.energy.some((resource) => resource.id === "pool-unrestricted"), true);
});

test("showdown energy is tracked in the rune pool and can pay spell energy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "pool-gust-target");
  field.units = [target, instance(cards.ravenbloomStudent, dianaPlayer.id, "pool-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = dianaPlayer.id;
  dianaPlayer.hand = [instance(cards.gust, dianaPlayer.id, "pool-gust")];
  dianaPlayer.runes = [];

  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(game.showdown.chain.length, 0);
  assert.deepEqual(dianaPlayer.runePool.energy[0].domains, cards.dianaScornOfTheMoon.domains);
  assert.equal(dianaPlayer.runePool.energy[0].restriction, "showdown");
  assert.equal(dianaPlayer.runes.some((runeCard) => runeCard.temporaryResource), false);
  assert.equal(game.showdown.priorityPlayerId, dianaPlayer.id);

  assert.equal(beginPlayCard(game, "pool-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(togglePaymentPoolEnergy(game, dianaPlayer.runePool.energy[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(dianaPlayer.runePool.energy.length, 0);
  assert.equal(game.showdown.chain[0].card.instanceId, "pool-gust");
});

test("showdown generated energy expires when showdown ends", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, opponent.id, "expire-showdown-attacker")];
  game.phase = "showdown";
  game.currentPlayerId = dianaPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    combat: false,
    focusPlayerId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(dianaPlayer.runePool.energy[0].restriction, "showdown");

  assert.equal(passShowdown(game, dianaPlayer.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown, null);
  assert.equal(game.phase, "action");
  assert.equal(dianaPlayer.runePool.energy.length, 0);
});

test("generated energy cannot bypass additional power costs from showdown modifiers", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  const vex = instance(cards.vexCheerless, opponent.id, "generated-cost-vex");
  const target = instance(cards.lonelyPoro, opponent.id, "generated-cost-target");
  field.units = [vex, target, instance(cards.ravenbloomStudent, dianaPlayer.id, "generated-cost-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.currentPlayerId = dianaPlayer.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    combat: true,
    focusPlayerId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };
  dianaPlayer.hand = [instance(cards.gust, dianaPlayer.id, "generated-cost-gust")];
  dianaPlayer.runes = [];

  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  dianaPlayer.runePool.energy.push({
    id: "generated-cost-extra-energy",
    type: "energy",
    domains: [DOMAINS.CHAOS],
    sourceCardId: "test-extra-energy",
    sourceName: "Extra Generated Energy",
    restriction: "showdown"
  });
  assert.equal(beginPlayCard(game, "generated-cost-gust", field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "generated-cost-target").ok, true);
  assert.equal(game.pendingPayment.energyCost, 2);
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.ANY, amount: 1 }]);
  assert.equal(togglePaymentPoolEnergy(game, dianaPlayer.runePool.energy[0].id).ok, true);
  assert.equal(togglePaymentPoolEnergy(game, "generated-cost-extra-energy").ok, true);
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(game.showdown.chain.length, 0);
});

test("scorn of the moon can add energy during showdown payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const dianaPlayer = game.players[1];
  const opponent = game.players[0];
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "payment-scorn-target");
  field.units = [target, instance(cards.ravenbloomStudent, dianaPlayer.id, "payment-scorn-defender")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: dianaPlayer.id,
    priorityPlayerId: dianaPlayer.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = dianaPlayer.id;
  dianaPlayer.hand = [instance(cards.gust, dianaPlayer.id, "payment-scorn-gust")];
  dianaPlayer.runes = [];
  dianaPlayer.legend.exhausted = false;

  assert.equal(beginPlayCard(game, "payment-scorn-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment.cardId, "payment-scorn-gust");
  assert.equal(activateCard(game, dianaPlayer.legend.instanceId).ok, true);
  assert.equal(game.pendingPayment.cardId, "payment-scorn-gust");
  assert.equal(dianaPlayer.runePool.energy.length, 1);
  assert.equal(dianaPlayer.legend.exhausted, true);
  assert.equal(togglePaymentPoolEnergy(game, dianaPlayer.runePool.energy[0].id).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.showdown.chain[0].card.instanceId, "payment-scorn-gust");
});

test("showdown start choices resume remaining battlefield defend triggers", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "resume-conservatory"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  const attacker = instance(cards.lonelyPoro, player.id, "resume-attacker");
  const diana = instance(cards.dianaLunari, opponent.id, "resume-diana");
  const dianaSpell = instance(cards.gust, opponent.id, "resume-diana-spell");
  const conservatorySpell = instance(cards.stupefy, opponent.id, "resume-conservatory-spell");
  player.base = [attacker];
  field.units = [diana];
  opponent.runes = [rune(DOMAINS.MIND, opponent.id, "resume-diana-energy")];
  opponent.mainDeck = [dianaSpell, conservatorySpell];

  assert.equal(moveUnit(game, "resume-attacker", field.instanceId).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.showdown.chain.length, 2);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "resume-diana-spell"), true);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "showdownPredictDrawSpell");

  assert.equal(chooseEffectOption(game, "pay").ok, true);
  assert.equal(game.pendingPayment.source, "effectEnergy");
  payPendingEnergy(game, ["resume-diana-energy"]);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "keep").ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.hand.some((card) => card.instanceId === "resume-conservatory-spell"), true);
});

test("eclipse asks whether to recycle the predicted card after modifying might", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const target = instance(cards.ravenbloomStudent, opponent.id, "eclipse-target");
  const predicted = instance(cards.gust, player.id, "eclipse-predicted");
  opponent.base = [target];
  player.mainDeck = [predicted, instance(cards.flash, player.id, "eclipse-second")];
  player.hand = [instance(cards.eclipse, player.id, "explicit-eclipse")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "eclipse-r1"),
    rune(DOMAINS.MIND, player.id, "eclipse-r2"),
    rune(DOMAINS.MIND, player.id, "eclipse-r3")
  ];

  assert.equal(playCard(game, "explicit-eclipse", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "modifyMight");
  assert.equal(chooseEffectOption(game, "eclipse-target").ok, true);
  assert.equal(target.buffs, -4);
  assert.equal(game.pendingChoice.effect, "predictChoice");
  assert.equal(chooseEffectOption(game, "recycle").ok, true);
  assert.equal(player.mainDeck.at(-1).instanceId, "eclipse-predicted");
  assert.equal(player.trash.some((card) => card.instanceId === "explicit-eclipse"), true);
});

test("hwei move trigger asks which card to discard and applies the type bonus", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const hwei = instance(cards.hweiBroodingPainter, player.id, "moving-hwei");
  const drawn = instance(cards.charm, player.id, "hwei-drawn-card");
  const discardUnit = instance(cards.lonelyPoro, player.id, "hwei-discard-unit");
  player.base = [hwei];
  player.hand = [discardUnit];
  player.mainDeck = [drawn];

  assert.equal(moveUnit(game, "moving-hwei", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "hweiDiscard");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["hwei-discard-unit", "hwei-drawn-card"]);

  assert.equal(chooseEffectOption(game, "hwei-discard-unit").ok, true);
  assert.equal(hwei.buffs, 3);
  assert.equal(player.trash.some((card) => card.instanceId === "hwei-discard-unit"), true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("hwei gear discard lets the player choose up to two runes to ready", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const hwei = instance(cards.hweiBroodingPainter, player.id, "gear-hwei");
  const drawn = instance(cards.charm, player.id, "gear-hwei-drawn");
  const gear = instance(cards.guardianAngel, player.id, "hwei-discard-gear");
  const firstRune = rune(DOMAINS.MIND, player.id, "hwei-ready-one");
  const secondRune = rune(DOMAINS.MIND, player.id, "hwei-ready-two");
  firstRune.exhausted = true;
  secondRune.exhausted = true;
  player.base = [hwei];
  player.hand = [gear];
  player.mainDeck = [drawn];
  player.runes = [firstRune, secondRune];

  assert.equal(moveUnit(game, "gear-hwei", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "hweiDiscard");
  assert.equal(chooseEffectOption(game, "hwei-discard-gear").ok, true);
  assert.equal(game.pendingChoice.effect, "readyRunes");

  assert.equal(chooseEffectOption(game, "hwei-ready-one").ok, true);
  assert.equal(firstRune.exhausted, false);
  assert.equal(secondRune.exhausted, true);
  assert.equal(game.pendingChoice.effect, "readyRunes");

  assert.equal(chooseEffectOption(game, "done").ok, true);
  assert.equal(secondRune.exhausted, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(field.controlledBy, player.id);
  assert.equal(player.score, 1);
});

test("Hwei triggers after an effect moves him and the resulting showdown waits for that trigger", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sourceField = game.battlefields[0];
  const destination = game.battlefields[1];
  const hwei = instance(cards.hweiBroodingPainter, player.id, "effect-moved-hwei");
  const enemy = instance(cards.lonelyPoro, opponent.id, "effect-move-enemy");
  const discard = instance(cards.lonelyPoro, player.id, "effect-hwei-discard");
  sourceField.units = [hwei];
  sourceField.controlledBy = player.id;
  destination.units = [enemy];
  destination.controlledBy = opponent.id;
  player.hand = [discard];
  player.mainDeck = [instance(cards.charm, player.id, "effect-hwei-draw")];

  assert.equal(resolveEffect(game, player, instance(cards.rideTheWind, player.id, "effect-ride-hwei")), true);
  assert.equal(game.pendingChoice.effect, "moveUnitSpellTarget");
  assert.equal(chooseEffectOption(game, hwei.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "moveUnitSpellDestination");
  assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "hweiDiscard");
  assert.equal(game.phase, "action");
  assert.equal(game.showdown, null);

  assert.equal(chooseEffectOption(game, discard.instanceId).ok, true);
  assert.equal(hwei.buffs, 3);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.battlefieldId, destination.instanceId);
  assert.equal(game.showdown.attackerId, player.id);
});

test("frigid jewel asks which friendly unit gets the second-draw buff", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const jewel = instance(cards.frigidJewel, player.id, "explicit-jewel");
  const first = instance(cards.lonelyPoro, player.id, "jewel-first-unit");
  const second = instance(cards.ravenbloomStudent, player.id, "jewel-second-unit");
  player.base = [jewel, first, second];
  player.mainDeck = [
    instance(cards.charm, player.id, "jewel-draw-one"),
    instance(cards.gust, player.id, "jewel-draw-two")
  ];
  player.drawCountThisTurn = 0;

  draw(player, 1, game);
  assert.equal(game.pendingChoice, null);
  draw(player, 1, game);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["jewel-first-unit", "jewel-second-unit"]);

  assert.equal(chooseEffectOption(game, "jewel-second-unit").ok, true);
  assert.equal(first.buffs, 0);
  assert.equal(second.buffs, 2);
});

test("frigid jewel uses the declared second-draw target and does not retarget", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const jewel = instance(cards.frigidJewel, player.id, "retarget-jewel");
  const declared = instance(cards.lonelyPoro, player.id, "jewel-declared-unit");
  const other = instance(cards.ravenbloomStudent, player.id, "jewel-other-unit");
  player.base = [jewel, declared, other];
  player.mainDeck = [
    instance(cards.charm, player.id, "jewel-retarget-draw-one"),
    instance(cards.gust, player.id, "jewel-retarget-draw-two")
  ];

  draw(player, 2, game);
  assert.equal(game.pendingChoice.effect, "secondDrawBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);

  player.base = player.base.filter((card) => card.instanceId !== "jewel-declared-unit");
  player.hand.push(declared);

  assert.equal(chooseEffectOption(game, "jewel-declared-unit").ok, true);
  assert.equal(declared.buffs, 0);
  assert.equal(other.buffs, 0);
});

test("abandoned hall asks which local unit gets the spell-play might bonus before the spell resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "hall-first-unit");
  const second = instance(cards.scuttleCrab, player.id, "hall-second-unit");
  const hall = {
    ...instance(cards.abandonedHall, player.id, "explicit-hall"),
    controlledBy: player.id,
    units: [first, second],
    hidden: []
  };
  game.battlefields = [hall];
  player.hand = [instance(cards.stackedDeck, player.id, "hall-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "hall-top-one"),
    instance(cards.gust, player.id, "hall-top-two"),
    instance(cards.flash, player.id, "hall-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "hall-spell-rune")];

  assert.equal(playCard(game, "hall-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["hall-first-unit", "hall-second-unit", "decline"]);

  assert.equal(chooseEffectOption(game, "hall-second-unit").ok, true);
  assert.equal(first.buffs, 0);
  assert.equal(second.buffs, 1);
  assert.equal(second.temporaryMight, 1);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
});

test("battlefield spell triggers use their declared target and do not retarget", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const declared = instance(cards.lonelyPoro, player.id, "hall-declared-unit");
  const other = instance(cards.scuttleCrab, player.id, "hall-other-unit");
  const hall = {
    ...instance(cards.abandonedHall, player.id, "retarget-hall"),
    controlledBy: player.id,
    units: [declared, other],
    hidden: []
  };
  game.battlefields = [hall];
  player.hand = [instance(cards.stackedDeck, player.id, "retarget-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "retarget-top-one"),
    instance(cards.gust, player.id, "retarget-top-two"),
    instance(cards.flash, player.id, "retarget-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "retarget-rune")];

  assert.equal(playCard(game, "retarget-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);

  hall.units = hall.units.filter((unit) => unit.instanceId !== "hall-declared-unit");
  player.hand.push(declared);

  assert.equal(chooseEffectOption(game, "hall-declared-unit").ok, true);
  assert.equal(declared.buffs, 0);
  assert.equal(other.buffs, 0);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
});

test("declining all spell-play battlefield triggers resumes the original spell", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "hall-decline-unit");
  const hall = {
    ...instance(cards.abandonedHall, player.id, "decline-hall"),
    controlledBy: player.id,
    units: [unit],
    hidden: []
  };
  game.battlefields = [hall];
  player.hand = [instance(cards.stackedDeck, player.id, "decline-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "decline-top-one"),
    instance(cards.gust, player.id, "decline-top-two"),
    instance(cards.flash, player.id, "decline-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "decline-rune")];

  assert.equal(playCard(game, "decline-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(unit.buffs, 0);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
});

test("multiple spell-play battlefield triggers queue before the spell resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const firstUnit = instance(cards.lonelyPoro, player.id, "hall-queue-first-unit");
  const secondUnit = instance(cards.scuttleCrab, player.id, "hall-queue-second-unit");
  const firstHall = {
    ...instance(cards.abandonedHall, player.id, "hall-queue-one"),
    controlledBy: player.id,
    units: [firstUnit],
    hidden: []
  };
  const secondHall = {
    ...instance(cards.abandonedHall, player.id, "hall-queue-two"),
    controlledBy: player.id,
    units: [secondUnit],
    hidden: []
  };
  game.battlefields = [firstHall, secondHall];
  player.hand = [instance(cards.stackedDeck, player.id, "hall-queue-stacked-deck")];
  player.mainDeck = [
    instance(cards.charm, player.id, "hall-queue-top-one"),
    instance(cards.gust, player.id, "hall-queue-top-two"),
    instance(cards.flash, player.id, "hall-queue-top-three")
  ];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "hall-queue-rune")];

  assert.equal(playCard(game, "hall-queue-stacked-deck", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["hall-queue-first-unit", "decline"]);

  assert.equal(chooseEffectOption(game, "hall-queue-first-unit").ok, true);
  assert.equal(firstUnit.buffs, 0);
  assert.equal(game.pendingChoice.effect, "battlefieldSpellBuff");
  assert.equal(game.pendingChoice.data.declareTrigger, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["hall-queue-second-unit", "decline"]);

  assert.equal(chooseEffectOption(game, "hall-queue-second-unit").ok, true);
  assert.equal(firstUnit.buffs, 1);
  assert.equal(secondUnit.buffs, 1);
  assert.equal(game.pendingChoice.effect, "chooseTopDeck");
});

test("the dreaming tree draws when a spell first chooses a friendly unit there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "dreaming-tree-unit");
  const field = {
    ...instance(cards.theDreamingTree, player.id, "explicit-dreaming-tree"),
    controlledBy: player.id,
    units: [unit],
    hidden: []
  };
  const drawn = instance(cards.flash, player.id, "dreaming-tree-draw");
  game.battlefields = [field];
  player.hand = [instance(cards.enGarde, player.id, "dreaming-tree-en-garde")];
  player.mainDeck = [drawn];
  player.runes = [rune(DOMAINS.CALM, player.id, "dreaming-tree-rune")];

  assert.equal(beginPlayCard(game, "dreaming-tree-en-garde", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "dreaming-tree-unit").ok, true);
  assert.equal(togglePaymentRune(game, "dreaming-tree-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === "dreaming-tree-draw"), true);
  assert.equal(field.spellFriendlyTargetDrawnThisTurn[player.id], true);
});

test("targon's peak readies runes at end of turn, not immediately on conquer", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const peak = {
    ...instance(cards.targonsPeak, player.id, "explicit-peak"),
    controlledBy: null,
    units: [],
    hidden: []
  };
  const unit = instance(cards.lonelyPoro, player.id, "peak-conqueror");
  const firstRune = rune(DOMAINS.CHAOS, player.id, "peak-rune-one");
  const secondRune = rune(DOMAINS.CHAOS, player.id, "peak-rune-two");
  firstRune.exhausted = true;
  secondRune.exhausted = true;
  game.battlefields = [peak];
  player.base = [unit];
  player.runes = [firstRune, secondRune];

  assert.equal(moveUnit(game, "peak-conqueror", "explicit-peak").ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(player.score, 1);
  assert.equal(firstRune.exhausted, true);
  assert.equal(secondRune.exhausted, true);
  assert.equal(player.endTurnReadyRunes, 2);

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.pendingChoice.effect, "readyRunes");
  assert.equal(chooseEffectOption(game, "peak-rune-two").ok, true);
  assert.equal(firstRune.exhausted, true);
  assert.equal(secondRune.exhausted, false);
  assert.equal(game.pendingChoice.effect, "readyRunes");
  assert.equal(chooseEffectOption(game, "peak-rune-one").ok, true);
  assert.equal(firstRune.exhausted, false);
  assert.equal(secondRune.exhausted, false);
  assert.equal(player.endTurnReadyRunes, 0);
});

test("ravenbloom conservatory puts the defending player's revealed spell into hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const conservatory = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "explicit-conservatory"),
    controlledBy: opponent.id,
    units: [instance(cards.lonelyPoro, opponent.id, "conservatory-defender")],
    hidden: []
  };
  const attacker = instance(cards.lonelyPoro, player.id, "conservatory-attacker");
  const revealedSpell = instance(cards.gust, opponent.id, "conservatory-revealed");
  game.battlefields = [conservatory];
  player.base = [attacker];
  opponent.mainDeck = [revealedSpell];

  assert.equal(moveUnit(game, "conservatory-attacker", "explicit-conservatory").ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "acknowledgeReveal");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, "conservatory-revealed");
  assert.equal(opponent.hand.some((card) => card.instanceId === "conservatory-revealed"), false);
  assert.equal(chooseEffectOption(game, "continue").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "conservatory-revealed"), true);
  assert.equal(opponent.mainDeck.some((card) => card.instanceId === "conservatory-revealed"), false);
});

test("ravenbloom conservatory does not trigger for a non-combat showdown", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const conservatory = {
    ...instance(cards.ravenbloomConservatory, opponent.id, "noncombat-conservatory"),
    controlledBy: opponent.id,
    units: [],
    hidden: []
  };
  const attacker = instance(cards.lonelyPoro, player.id, "noncombat-conservatory-unit");
  const top = instance(cards.gust, opponent.id, "noncombat-conservatory-top");
  game.battlefields = [conservatory];
  player.base = [attacker];
  opponent.mainDeck = [top];

  assert.equal(moveUnit(game, attacker.instanceId, conservatory.instanceId).ok, true);
  assert.equal(game.showdown.combat, false);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.mainDeck[0].instanceId, top.instanceId);
});

test("kha'zix gains might and xp when attacking an isolated enemy", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const khazix = instance(cards.khazixMutatingHorror, player.id, "isolated-khazix");
  field.units = [instance(cards.lonelyPoro, opponent.id, "isolated-enemy")];
  field.controlledBy = opponent.id;
  player.base = [khazix];
  const xpBefore = player.xp;

  assert.equal(moveUnit(game, "isolated-khazix", field.instanceId).ok, true);
  assert.equal(game.phase, "showdown");
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(khazix.buffs, 2);
  assert.equal(player.xp, xpBefore + 2);
});

test("tideturner can swap its location with another controlled unit when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, player.id, "tideturner-target");
  field.units = [target];
  field.controlledBy = player.id;
  player.hand = [instance(cards.tideturner, player.id, "explicit-tideturner")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "tideturner-r1"),
    rune(DOMAINS.CHAOS, player.id, "tideturner-r2")
  ];

  assert.equal(playCard(game, "explicit-tideturner", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "tideturnerSwap");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["tideturner-target"]);

  assert.equal(chooseEffectOption(game, "tideturner-target").ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "explicit-tideturner"), true);
  assert.equal(player.base.some((unit) => unit.instanceId === "tideturner-target"), true);
});

test("vex cheerless modifies showdown spell costs for both players", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const vex = instance(cards.vexCheerless, player.id, "cost-vex");
  field.units = [vex, instance(cards.lonelyPoro, opponent.id, "cost-enemy")];
  field.controlledBy = null;
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;
  player.hand = [instance(cards.eclipse, player.id, "friendly-eclipse")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "friendly-cost-one"),
    rune(DOMAINS.MIND, player.id, "friendly-cost-two")
  ];

  assert.equal(beginPlayCard(game, "friendly-eclipse", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "cost-enemy").ok, true);
  assert.equal(game.pendingPayment.energyCost, 2);
  assert.deepEqual(game.pendingPayment.powerCost, []);

  game.pendingPayment = null;
  game.pendingChoice = null;
  game.currentPlayerId = opponent.id;
  game.showdown.priorityPlayerId = opponent.id;
  opponent.hand = [instance(cards.gust, opponent.id, "enemy-gust")];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "enemy-cost-one"),
    rune(DOMAINS.CHAOS, opponent.id, "enemy-cost-two"),
    rune(DOMAINS.CHAOS, opponent.id, "enemy-cost-power")
  ];

  assert.equal(beginPlayCard(game, "enemy-gust", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "cost-enemy").ok, true);
  assert.equal(game.pendingPayment.energyCost, 2);
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.ANY, amount: 1 }]);
});

test("vex apathetic stuns and locks an opposing unit played to her battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const vex = instance(cards.vexApathetic, opponent.id, "apathetic-vex");
  field.units = [vex];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.rengarTrophyHunter, player.id, "vex-rengar")];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.BODY, player.id, `vex-rengar-r${index}`));

  assert.equal(playCard(game, "vex-rengar", field.instanceId).ok, true);
  const rengar = field.units.find((unit) => unit.instanceId === "vex-rengar");
  assert.equal(rengar.stunned, true);
  assert.equal(rengar.cantMoveThisTurn, true);
});

test("fizz plays a trash spell only if its power cost can be paid and recycles it after resolving", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const alphaTarget = instance(cards.ravenbloomStudent, opponent.id, "fizz-alpha-target");
  game.battlefields[0].units = [alphaTarget];
  player.hand = [instance(cards.fizzTrickster, player.id, "explicit-fizz")];
  const alpha = instance(cards.alphaStrike, player.id, "fizz-alpha");
  player.trash = [
    alpha,
    instance(cards.uncheckedPower, player.id, "too-expensive-trash-spell")
  ];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "fizz-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "fizz-energy-two"),
    rune(DOMAINS.CHAOS, player.id, "fizz-power"),
    rune(DOMAINS.CALM, player.id, "trash-power")
  ];

  assert.equal(playCard(game, "explicit-fizz", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashSpell");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["fizz-alpha"]);

  assert.equal(chooseEffectOption(game, "fizz-alpha").ok, true);
  assert.equal(game.pendingChoice.effect, "declareTrashSpellTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["explicit-fizz"]);
  assert.equal(["fizz-energy-one", "fizz-energy-two", "fizz-power", "trash-power"]
    .filter((id) => player.runeDeck.some((card) => card.instanceId === id)).length, 1);

  assert.equal(chooseEffectOption(game, "explicit-fizz").ok, true);
  const allocation = game.pendingChoice.options
    .filter((option) => option.cardId === alphaTarget.instanceId)
    .at(-1);
  assert.ok(allocation);
  assert.equal(chooseEffectOption(game, allocation.id).ok, true);
  assert.equal(game.pendingPayment.source, "trashSpell");
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.ANY, amount: 1, allowedDomains: [DOMAINS.CALM, DOMAINS.BODY] }]);
  assert.equal(togglePaymentRune(game, "trash-power", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(["fizz-energy-one", "fizz-energy-two", "fizz-power", "trash-power"]
    .filter((id) => player.runeDeck.some((card) => card.instanceId === id)).length, 2);

  assert.equal(player.mainDeck.at(-1).instanceId, "fizz-alpha");
  assert.equal(player.trash.some((card) => card.instanceId === "fizz-alpha"), false);
});

test("fizz skips payment for a trash spell with no power cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.lonelyPoro, opponent.id, "fizz-gust-target");
  field.units = [target];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.fizzTrickster, player.id, "zero-cost-fizz")];
  player.trash = [instance(cards.gust, player.id, "zero-cost-gust")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r1"),
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r2"),
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r3"),
    rune(DOMAINS.CHAOS, player.id, "zero-fizz-r4")
  ];

  assert.equal(playCard(game, "zero-cost-fizz", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashSpell");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["zero-cost-gust"]);
  assert.equal(chooseEffectOption(game, "zero-cost-gust").ok, true);
  assert.equal(game.pendingChoice.effect, "declareTrashSpellTarget");
  assert.equal(chooseEffectOption(game, "fizz-gust-target").ok, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(opponent.hand.some((card) => card.instanceId === "fizz-gust-target"), true);
  assert.equal(player.mainDeck.at(-1).instanceId, "zero-cost-gust");
});

test("reinforce shows every looked-at card before the player chooses a unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const reinforce = instance({ ...cards.reinforce, energy: 0, power: [] }, player.id, "inspect-reinforce");
  const unit = instance(cards.lonelyPoro, player.id, "inspect-reinforce-unit");
  const otherCards = [
    instance(cards.gust, player.id, "inspect-reinforce-1"),
    instance(cards.charm, player.id, "inspect-reinforce-2"),
    instance(cards.flash, player.id, "inspect-reinforce-3"),
    instance(cards.eclipse, player.id, "inspect-reinforce-4")
  ];
  player.hand = [reinforce];
  player.mainDeck = [otherCards[0], unit, ...otherCards.slice(1)];

  assert.equal(playCard(game, reinforce.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playLookedAtUnit");
  assert.equal(game.pendingChoice.data.revealedCards.length, 5);
  assert.deepEqual(game.pendingChoice.options.filter((option) => option.cardId).map((option) => option.cardId), [unit.instanceId]);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), false);

  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(otherCards.every((card) => player.mainDeck.some((candidate) => candidate.instanceId === card.instanceId)), true);
});

test("blind fury waits for the player to inspect and choose a revealed opponent card", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const blindFury = instance({ ...cards.blindFury, energy: 0, power: [] }, player.id, "inspect-blind-fury");
  const revealed = instance(cards.lonelyPoro, opponent.id, "inspect-opponent-top");
  player.hand = [blindFury];
  opponent.mainDeck = [revealed];

  assert.equal(playCard(game, blindFury.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playRevealedOpponentTopDeck");
  assert.equal(game.pendingChoice.data.revealedCards[0].instanceId, revealed.instanceId);
  assert.equal(player.base.some((card) => card.instanceId === revealed.instanceId), false);

  assert.equal(chooseEffectOption(game, revealed.instanceId).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === revealed.instanceId), true);
});

test("the harrowing plays a trash unit after paying its power cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const harrowing = instance({ ...cards.theHarrowing, energy: 0, power: [] }, player.id, "test-harrowing");
  const trashUnit = instance(cards.rengarTrophyHunter, player.id, "harrowing-rengar");
  player.hand = [harrowing];
  player.trash = [trashUnit];
  player.runes = [rune(DOMAINS.BODY, player.id, "harrowing-power")];

  assert.equal(playCard(game, "test-harrowing", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashUnit");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["harrowing-rengar"]);

  assert.equal(chooseEffectOption(game, "harrowing-rengar").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "harrowing-rengar"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "harrowing-rengar"), false);
  assert.equal(player.runes.some((card) => card.instanceId === "harrowing-power"), false);
  assert.equal(player.runeDeck.some((card) => card.instanceId === "harrowing-power"), true);
});

test("spectral matron ignores the chosen trash unit's power cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const matron = instance({ ...cards.spectralMatron, energy: 0, power: [] }, player.id, "test-matron");
  const trashUnit = instance({ ...cards.rengarTrophyHunter, energy: 3 }, player.id, "matron-rengar");
  player.hand = [matron];
  player.trash = [trashUnit];
  player.runes = [];

  assert.equal(playCard(game, "test-matron", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "playTrashUnit");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["matron-rengar"]);

  assert.equal(chooseEffectOption(game, "matron-rengar").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "matron-rengar"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "matron-rengar"), false);
});

test("kadregrin draws for each friendly mighty unit when played", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const kadregrin = instance({ ...cards.kadregrinTheInfernal, energy: 0, power: [] }, player.id, "test-kadregrin");
  const mighty = instance(cards.rengarTrophyHunter, player.id, "mighty-friend");
  const small = instance(cards.lonelyPoro, player.id, "small-friend");
  mighty.buffs = 2;
  player.hand = [kadregrin];
  player.base = [mighty, small];
  player.mainDeck = [
    instance(cards.gust, player.id, "kadregrin-draw-one"),
    instance(cards.charm, player.id, "kadregrin-draw-two"),
    instance(cards.flash, player.id, "kadregrin-draw-three")
  ];

  assert.equal(playCard(game, "test-kadregrin", "base").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.deepEqual(player.hand.map((card) => card.instanceId), ["kadregrin-draw-one", "kadregrin-draw-two"]);
});

test("brynhir prevents opponents from playing cards for the rest of the turn", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.hand = [instance(cards.brynhirThundersong, player.id, "explicit-brynhir")];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.FURY, player.id, `brynhir-rune-${index}`));
  opponent.hand = [instance(cards.lonelyPoro, opponent.id, "brynhir-blocked-poro")];
  opponent.runes = [rune(DOMAINS.CALM, opponent.id, "brynhir-opponent-rune")];

  assert.equal(playCard(game, "explicit-brynhir", "base").ok, true);
  game.currentPlayerId = opponent.id;

  assert.equal(playCard(game, "brynhir-blocked-poro", "base").ok, false);
  assert.equal(opponent.hand.some((card) => card.instanceId === "brynhir-blocked-poro"), true);
});

test("sona readies up to four friendly runes at end of turn while at a battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const sona = instance(cards.sonaHarmonious, player.id, "explicit-sona");
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [sona];
  player.runes = Array.from({ length: 5 }, (_, index) => {
    const item = rune(DOMAINS.CALM, player.id, `sona-rune-${index}`);
    item.exhausted = true;
    return item;
  });

  assert.equal(endTurn(game).ok, true);

  assert.equal(player.runes.filter((candidate) => !candidate.exhausted).length, 4);
});

test("blitzcrank may move an enemy unit to his battlefield when played there", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const blitzcrank = instance({ ...cards.blitzcrankImpassive, energy: 0, power: [] }, player.id, "explicit-blitzcrank");
  const enemy = instance(cards.lonelyPoro, opponent.id, "blitzcrank-enemy");
  field.controlledBy = player.id;
  player.hand = [blitzcrank];
  opponent.base = [enemy];

  assert.equal(playCard(game, "explicit-blitzcrank", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "moveUnitToSourceBattlefield");

  assert.equal(chooseEffectOption(game, "blitzcrank-enemy").ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === "blitzcrank-enemy"), false);
  assert.equal(field.units.some((card) => card.instanceId === "blitzcrank-enemy"), true);
});

test("blitzcrank returns to hand when he holds a battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const blitzcrank = instance(cards.blitzcrankImpassive, player.id, "holding-blitzcrank");
  field.controlledBy = player.id;
  field.units = [blitzcrank];

  startTurn(game);

  assert.equal(player.hand.some((card) => card.instanceId === "holding-blitzcrank"), true);
  assert.equal(field.units.some((card) => card.instanceId === "holding-blitzcrank"), false);
});

test("vi recycles one trash card to gain might without exhausting", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const vi = instance(cards.viDestructive, player.id, "explicit-vi");
  player.base = [vi];
  player.trash = [instance(cards.lonelyPoro, player.id, "vi-trash")];

  assert.equal(activateCard(game, "explicit-vi").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "explicit-vi").ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);

  assert.equal(vi.buffs, 1);
  assert.equal(vi.exhausted, false);
  assert.equal(player.trash.length, 0);
});

test("garbage grabber recycles trash and pays one energy to draw", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const grabber = instance(cards.garbageGrabber, player.id, "explicit-garbage-grabber");
  const drawn = instance(cards.flash, player.id, "garbage-draw");
  player.base = [grabber];
  player.mainDeck = [drawn];
  player.trash = [
    instance(cards.lonelyPoro, player.id, "garbage-trash-1"),
    instance(cards.charm, player.id, "garbage-trash-2"),
    instance(cards.gust, player.id, "garbage-trash-3")
  ];
  player.runes = [rune(DOMAINS.MIND, player.id, "garbage-rune")];

  assert.equal(activateCard(game, "explicit-garbage-grabber").ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, "garbage-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === "garbage-draw"), true);
  assert.equal(player.trash.length, 0);
  assert.equal(grabber.exhausted, true);
});

test("wraith of echoes draws only for the first other friendly unit death each turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const wraith = instance(cards.wraithOfEchoes, player.id, "explicit-wraith");
  const first = instance(cards.lonelyPoro, player.id, "wraith-first-victim");
  const second = instance(cards.scuttleCrab, player.id, "wraith-second-victim");
  player.base = [wraith, first, second];
  player.hand = [
    instance({ ...cards.vengeance, energy: 0, power: [] }, player.id, "wraith-vengeance-1"),
    instance({ ...cards.vengeance, energy: 0, power: [] }, player.id, "wraith-vengeance-2")
  ];
  player.mainDeck = [
    instance(cards.flash, player.id, "wraith-draw-1"),
    instance(cards.gust, player.id, "wraith-draw-2")
  ];

  assert.equal(beginPlayCard(game, "wraith-vengeance-1", "base").ok, true);
  assert.equal(chooseEffectOption(game, "wraith-first-victim").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "wraith-draw-1"), true);

  assert.equal(beginPlayCard(game, "wraith-vengeance-2", "base").ok, true);
  assert.equal(chooseEffectOption(game, "wraith-second-victim").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "wraith-draw-2"), false);
});

test("volibear imposing draws when an opponent moves to a different battlefield", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const volibear = instance(cards.volibearImposing, player.id, "explicit-volibear-imposing");
  const mover = instance(cards.lonelyPoro, opponent.id, "volibear-opponent-mover");
  const firstField = game.battlefields[0];
  const secondField = game.battlefields[1];
  firstField.controlledBy = player.id;
  firstField.units = [volibear];
  secondField.controlledBy = opponent.id;
  secondField.units = [];
  opponent.base = [mover];
  player.mainDeck = [instance(cards.flash, player.id, "volibear-draw")];
  game.currentPlayerId = opponent.id;

  assert.equal(moveUnit(game, "volibear-opponent-mover", secondField.instanceId).ok, true);

  assert.equal(player.hand.some((card) => card.instanceId === "volibear-draw"), true);
});

test("yasuo windrider scores on the third move in a turn", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const yasuo = instance(cards.yasuoWindrider, player.id, "explicit-yasuo-windrider");
  const [firstField, secondField] = game.battlefields;
  firstField.controlledBy = player.id;
  secondField.controlledBy = player.id;
  player.base = [yasuo];
  player.score = 0;

  assert.equal(moveUnit(game, "explicit-yasuo-windrider", firstField.instanceId).ok, true);
  assert.equal(player.score, 0);
  yasuo.exhausted = false;

  assert.equal(moveUnit(game, "explicit-yasuo-windrider", "base").ok, true);
  assert.equal(player.score, 0);
  yasuo.exhausted = false;

  assert.equal(moveUnit(game, "explicit-yasuo-windrider", secondField.instanceId).ok, true);
  assert.equal(player.score, 1);
});

test("ember monk gains might when a card is played from hidden", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const monk = instance(cards.emberMonk, player.id, "explicit-ember-monk");
  const hiddenSpell = instance(cards.consultThePast, player.id, "ember-hidden-consult");
  const enemy = instance(cards.lonelyPoro, opponent.id, "ember-enemy");
  field.controlledBy = player.id;
  field.units = [monk];
  player.hand = [hiddenSpell];
  player.runes = [rune(DOMAINS.MIND, player.id, "ember-hide-power")];

  hideWithRune(game, "ember-hidden-consult", field.instanceId, "ember-hide-power");
  game.turnSequence += 1;
  field.controlledBy = null;
  field.units = [monk, enemy];
  game.phase = "showdown";
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: opponent.id,
    attackerId: opponent.id,
    defenderId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, "ember-hidden-consult", field.instanceId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(monk.buffs, 2);
});

test("time warp grants an extra turn and banishes itself", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  player.hand = [instance(cards.timeWarp, player.id, "explicit-time-warp")];
  player.runes = Array.from({ length: 14 }, (_, index) => rune(DOMAINS.MIND, player.id, `time-warp-r${index}`));

  assert.equal(playCard(game, "explicit-time-warp", "base").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "explicit-time-warp"), false);
  assert.equal(player.banished.some((card) => card.instanceId === "explicit-time-warp"), true);

  assert.equal(endTurn(game).ok, true);
  assert.equal(currentPlayer(game).id, player.id);
});

test("convergent mutation increases a friendly unit to another friendly unit's might", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const low = instance(cards.lonelyPoro, player.id, "mutation-low");
  const high = instance(cards.lonelyPoro, player.id, "mutation-high");
  high.buffs = 4;
  player.base = [low, high];
  player.hand = [instance(cards.convergentMutation, player.id, "explicit-convergent-mutation")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.MIND, player.id, `mutation-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-convergent-mutation", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "mutation-low").ok, true);
  assert.equal(chooseEffectOption(game, "mutation-high").ok, true);
  assert.equal(togglePaymentRune(game, "mutation-r0", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "mutation-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "mutation-r2", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(low.buffs, 4);
});

test("portal rescue replays a friendly unit to base ignoring its cost", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const unit = instance(cards.lonelyPoro, player.id, "portal-rescue-unit");
  unit.buffs = 2;
  unit.damage = 1;
  field.controlledBy = player.id;
  field.units = [unit];
  player.hand = [instance(cards.portalRescue, player.id, "explicit-portal-rescue")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.MIND, player.id, `portal-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-portal-rescue", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "portal-rescue-unit").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r0", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r2", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "portal-r3", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(field.units.some((candidate) => candidate.instanceId === "portal-rescue-unit"), false);
  assert.equal(player.base.some((candidate) => candidate.instanceId === "portal-rescue-unit"), true);
  assert.equal(unit.buffs, 0);
  assert.equal(unit.damage, 0);
  assert.equal(unit.exhausted, true);
});

test("miss fortune captain readies another exhausted friendly card only on her first move each turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const missFortune = instance(cards.missFortuneCaptain, player.id, "explicit-miss-fortune");
  const ally = instance(cards.lonelyPoro, player.id, "miss-fortune-ally");
  ally.exhausted = true;
  field.controlledBy = player.id;
  player.base = [missFortune, ally];

  assert.equal(moveUnit(game, "explicit-miss-fortune", field.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "readyAnotherExhausted");
  assert.equal(chooseEffectOption(game, "miss-fortune-ally").ok, true);
  assert.equal(ally.exhausted, false);
  assert.equal(field.units.some((unit) => unit.instanceId === "explicit-miss-fortune"), true);

  missFortune.exhausted = false;
  ally.exhausted = true;
  assert.equal(moveUnit(game, "explicit-miss-fortune", "base").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(ally.exhausted, true);
});

test("Miss Fortune Captain enters ready only when her Body Accelerate cost is selected and paid", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const missFortune = instance(cards.missFortuneCaptain, player.id, "accelerated-miss-fortune");
  player.hand = [missFortune];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `mf-accelerate-r${index}`));

  assert.equal(beginPlayCard(game, missFortune.instanceId, "base").ok, true);
  const accelerate = game.pendingPayment.optionalPowerEffects.find((effect) => effect.kind === "accelerate");
  assert.equal(accelerate.domain, DOMAINS.BODY);
  assert.equal(toggleOptionalPaymentEffect(game, accelerate.id).ok, true);
  for (const runeId of ["mf-accelerate-r0", "mf-accelerate-r1", "mf-accelerate-r2", "mf-accelerate-r3", "mf-accelerate-r4"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "mf-accelerate-r4", "power").ok, true);
  assert.equal(togglePaymentRune(game, "mf-accelerate-r5", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.find((card) => card.instanceId === missFortune.instanceId)?.exhausted, false);
});

test("Seal of Strength can add the fifth Energy needed to play Miss Fortune Captain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const seal = instance(cards.sealOfStrength, player.id, "miss-fortune-seal");
  const missFortune = instance(cards.missFortuneCaptain, player.id, "sealed-miss-fortune");
  player.base = [seal];
  player.hand = [missFortune];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `mf-seal-r${index}`));

  assert.equal(beginPlayCard(game, missFortune.instanceId, "base").ok, true);
  assert.equal(activateCard(game, seal.instanceId).ok, true);
  assert.equal(player.runePool.energy.length, 1);
  assert.equal(player.runePool.energy[0].restriction, null);
  assert.equal(togglePaymentPoolEnergy(game, player.runePool.energy[0].id).ok, true);
  for (const runeCard of player.runes) {
    assert.equal(togglePaymentRune(game, runeCard.instanceId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, player.runes[0].instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === missFortune.instanceId), true);
});

test("generated Energy cards declare their usage restrictions through the shared addEnergy effect", () => {
  const unrestricted = [
    cards.sealOfDiscord,
    cards.sealOfFocus,
    cards.sealOfInsight,
    cards.sealOfRage,
    cards.sealOfStrength,
    cards.sealOfUnity,
    cards.energyConduit,
    cards.dariusHandOfNoxus,
    cards.dariusHandOfNoxus2,
    cards.dariusHandOfNoxus3
  ];
  for (const card of unrestricted) {
    const effect = card.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addEnergy");
    assert.ok(effect, `${card.name} should use addEnergy`);
    assert.equal(effect.restriction, null, `${card.name} Energy should be unrestricted`);
  }

  for (const card of [cards.kaiSaDaughterOfTheVoid, cards.kaiSaDaughterOfTheVoid2, cards.kaiSaDaughterOfTheVoid3]) {
    const effect = card.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addEnergy");
    assert.equal(effect?.restriction, "spell");
  }
  const dianaEffect = cards.dianaScornOfTheMoon.effects.find((candidate) => candidate.timing === "activated" && candidate.kind === "addEnergy");
  assert.equal(dianaEffect?.restriction, "showdown");
});

test("Miss Fortune Captain can pay Accelerate from the Champion Zone", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  player.champion = instance(cards.missFortuneCaptain, player.id, "champion-zone-miss-fortune");
  player.champion.zone = "champion";
  player.championPlayed = false;
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `mf-champion-r${index}`));

  assert.equal(beginPlayChampion(game, "base").ok, true);
  const accelerate = game.pendingPayment.optionalPowerEffects.find((effect) => effect.kind === "accelerate");
  assert.equal(accelerate.domain, DOMAINS.BODY);
  assert.equal(toggleOptionalPaymentEffect(game, accelerate.id).ok, true);
  for (const runeId of ["mf-champion-r0", "mf-champion-r1", "mf-champion-r2", "mf-champion-r3", "mf-champion-r4"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "mf-champion-r4", "power").ok, true);
  assert.equal(togglePaymentRune(game, "mf-champion-r5", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.find((card) => card.instanceId === "champion-zone-miss-fortune")?.exhausted, false);
});

test("Volibear legend trigger opens an action chain and asks before exhausting", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.legend = instance(cards.volibearRelentlessStorm, player.id, "volibear-chain-legend");
  const mighty = instance(cards.lonelyPoro, player.id, "volibear-mighty-unit");
  mighty.energy = 0;
  mighty.power = [];
  mighty.might = 5;
  player.hand = [mighty];
  const responseUnit = instance(cards.lonelyPoro, opponent.id, "volibear-response-unit");
  game.battlefields[0].units = [responseUnit];
  game.battlefields[0].controlledBy = opponent.id;
  opponent.hand = [instance(cards.flash, opponent.id, "volibear-chain-response")];
  opponent.runes = [
    rune(DOMAINS.CHAOS, opponent.id, "volibear-response-r1"),
    rune(DOMAINS.CHAOS, opponent.id, "volibear-response-r2")
  ];

  assert.equal(beginPlayCard(game, mighty.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.ok(game.actionChain);
  assert.equal(game.actionChain.chain[0].itemType, "trigger");
  assert.equal(game.actionChain.priorityPlayerId, opponent.id);
  assert.equal(player.legend.exhausted, false);

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.pendingChoice.effect, "cardPlayedLegendTrigger");
  assert.equal(chooseEffectOption(game, "decline").ok, true);
  assert.equal(player.legend.exhausted, false);
});

test("whirlwind lets each player return a unit to hand starting with the next player", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const friendly = instance(cards.lonelyPoro, player.id, "whirlwind-friendly");
  const enemy = instance(cards.lonelyPoro, opponent.id, "whirlwind-enemy");
  player.base = [friendly];
  opponent.base = [enemy];
  player.hand = [instance(cards.whirlwind, player.id, "explicit-whirlwind")];
  player.runes = Array.from({ length: 5 }, (_, index) => rune(DOMAINS.CHAOS, player.id, `whirlwind-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-whirlwind", "base").ok, true);
  for (const runeId of ["whirlwind-r0", "whirlwind-r1", "whirlwind-r2", "whirlwind-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "whirlwind-r4", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "eachPlayerReturnUnitToHand");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(chooseEffectOption(game, "whirlwind-enemy").ok, true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "whirlwind-enemy"), true);
  assert.equal(game.pendingChoice.playerId, player.id);
  assert.equal(chooseEffectOption(game, "whirlwind-friendly").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "whirlwind-friendly"), true);
});

test("party favors lets the opponent choose cards so both players draw", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  player.hand = [instance(cards.partyFavors, player.id, "explicit-party-favors")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.CALM, player.id, `party-r${index}`));
  player.mainDeck = [instance(cards.flash, player.id, "party-player-draw")];
  opponent.mainDeck = [instance(cards.flash, opponent.id, "party-opponent-draw")];

  assert.equal(beginPlayCard(game, "explicit-party-favors", "base").ok, true);
  for (const runeId of ["party-r0", "party-r1", "party-r2"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "partyFavors");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(chooseEffectOption(game, "cards").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "party-player-draw"), true);
  assert.equal(opponent.hand.some((card) => card.instanceId === "party-opponent-draw"), true);
});

test("get excited discards a card and deals its energy as damage", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.missFortuneCaptain, opponent.id, "get-excited-target");
  field.controlledBy = opponent.id;
  field.units = [target];
  player.hand = [
    instance(cards.getExcited, player.id, "explicit-get-excited"),
    instance(cards.portalRescue, player.id, "get-excited-discard")
  ];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.FURY, player.id, `get-excited-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-get-excited", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "get-excited-target").ok, true);
  assert.equal(togglePaymentRune(game, "get-excited-r0", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "get-excited-r1", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "get-excited-r2", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "discardEnergyDamage");

  assert.equal(chooseEffectOption(game, "get-excited-discard").ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(target.damage, 3);
  assert.equal(player.trash.some((card) => card.instanceId === "get-excited-discard"), true);
});

test("karthus eternal makes friendly deathknell trigger an additional time", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const karthus = instance(cards.karthusEternal, player.id, "explicit-karthus");
  const poro = instance(cards.lonelyPoro, player.id, "karthus-poro");
  field.units = [poro];
  field.controlledBy = player.id;
  player.base = [karthus];
  player.mainDeck = [
    instance(cards.flash, player.id, "karthus-draw-1"),
    instance(cards.flash, player.id, "karthus-draw-2")
  ];
  player.hand = [instance(cards.uncheckedPower, player.id, "karthus-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `karthus-r${index}`));

  assert.equal(playCard(game, "karthus-boardwipe", "base").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "karthus-draw-1"), true);
  assert.equal(player.hand.some((card) => card.instanceId === "karthus-draw-2"), true);
});

test("sett the boss saves a buffed friendly unit by paying a rune and spending its buff", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const sett = instance(cards.settTheBoss, player.id, "explicit-sett-boss");
  const unit = instance(cards.lonelyPoro, player.id, "sett-saved-unit");
  unit.buffs = 1;
  field.units = [unit];
  field.controlledBy = player.id;
  player.legend = sett;
  player.runes = [rune(DOMAINS.BODY, player.id, "sett-save-rune")];
  player.hand = [instance(cards.uncheckedPower, player.id, "sett-boardwipe")];
  player.runes.push(...Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `sett-wipe-r${index}`)));

  assert.equal(playCard(game, "sett-boardwipe", "base").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "sett-saved-unit"), false);
  assert.equal(player.base.some((card) => card.instanceId === "sett-saved-unit"), true);
  assert.equal(field.units.some((card) => card.instanceId === "sett-saved-unit"), false);
  assert.equal(unit.buffs, 0);
  assert.equal(unit.damage, 0);
  assert.equal(unit.exhausted, true);
  assert.equal(sett.exhausted, true);
  assert.equal(player.runeDeck.some((card) => card.instanceId === "sett-save-rune"), true);
});

test("sett the boss readies when his controller conquers", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const sett = instance(cards.settTheBoss, player.id, "ready-sett-boss");
  const mover = instance(cards.lonelyPoro, player.id, "sett-conquer-mover");
  const holder = instance(cards.lonelyPoro, player.id, "sett-conquer-holder");
  const field = game.battlefields[0];
  sett.exhausted = true;
  player.legend = sett;
  player.base = [mover];
  field.controlledBy = opponent.id;
  field.units = [holder];

  assert.equal(moveUnit(game, "sett-conquer-mover", field.instanceId).ok, true);
  assert.equal(sett.exhausted, false);
});

test("reckoner's arena triggers conquer abilities of units there when held", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.kaiSaSurvivor, player.id, "reckoner-kaisa");
  const field = {
    ...instance(cards.reckonersArena, player.id, "explicit-reckoner-arena"),
    controlledBy: player.id,
    hidden: [],
    units: [unit]
  };
  game.battlefields[0] = field;
  player.mainDeck = [instance(cards.flash, player.id, "reckoner-draw")];

  startTurn(game);

  assert.equal(player.hand.some((card) => card.instanceId === "reckoner-draw"), true);
});

test("baited hook kills a friendly unit and plays a top deck unit within might range", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const hook = instance(cards.baitedHook, player.id, "explicit-baited-hook");
  const sacrifice = instance(cards.ravenbloomStudent, player.id, "baited-sacrifice");
  player.base = [hook, sacrifice];
  player.runes = [rune(DOMAINS.ORDER, player.id, "baited-order-rune")];
  player.mainDeck = [
    instance(cards.lonelyPoro, player.id, "baited-played-unit"),
    instance(cards.blazingScorcher, player.id, "baited-recycled-unit")
  ];

  assert.equal(activateCard(game, "explicit-baited-hook").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "baited-sacrifice").ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, "baited-order-rune", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "baitedHookTopDeck");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.id), ["baited-played-unit", "decline"]);
  assert.equal(chooseEffectOption(game, "baited-played-unit").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === "baited-played-unit"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "baited-sacrifice"), true);
  assert.equal(player.mainDeck.some((card) => card.instanceId === "baited-recycled-unit"), true);
  assert.equal(hook.exhausted, true);
});

test("pack of wonders returns another friendly hidden card to hand", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const pack = instance(cards.packOfWonders, player.id, "explicit-pack-wonders");
  const hidden = instance(cards.backOff, player.id, "pack-hidden-card");
  field.controlledBy = player.id;
  player.base = [pack];
  player.hand = [hidden];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "pack-hide-rune")];

  hideWithRune(game, "pack-hidden-card", field.instanceId, "pack-hide-rune");
  assert.equal(activateCard(game, "explicit-pack-wonders").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");

  assert.equal(chooseEffectOption(game, "pack-hidden-card").ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.hand.some((card) => card.instanceId === "pack-hidden-card"), true);
  assert.equal(pack.exhausted, true);
});

test("Udyr declares an unused mode and its target before activation resolves", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const udyr = instance(cards.udyrWildman, player.id, "timed-udyr");
  const target = instance(cards.ravenbloomStudent, opponent.id, "udyr-damage-target");
  udyr.buffs = 1;
  player.base = [udyr];
  game.battlefields[0].units = [target];

  assert.equal(activateCard(game, udyr.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "declareUdyrMode");
  assert.equal(chooseEffectOption(game, "damage").ok, true);
  assert.equal(game.pendingChoice.effect, "declareUdyrTarget");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(target.damage, 2);
  assert.equal(udyr.buffs, 0);
  assert.equal(udyr.exhausted, false);
  assert.equal(udyr.udyrModesChosen.includes("damage"), true);
});

test("vanguard helm buffs another friendly unit when a buffed friendly unit dies", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const helm = instance(cards.vanguardHelm, player.id, "explicit-vanguard-helm");
  const victim = instance(cards.ravenbloomStudent, player.id, "helm-victim");
  const ally = instance(cards.lonelyPoro, player.id, "helm-ally");
  victim.buffs = 1;
  field.controlledBy = player.id;
  field.units = [victim];
  player.base = [helm, ally];
  player.hand = [instance(cards.uncheckedPower, player.id, "helm-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `helm-r${index}`));

  assert.equal(playCard(game, "helm-boardwipe", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "buffUnit");
  assert.equal(chooseEffectOption(game, "helm-ally").ok, true);
  assert.equal(ally.buffs, 1);
});

test("wildclaw shaman spends a friendly buff to buff and ready itself", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const donor = instance(cards.lonelyPoro, player.id, "wildclaw-donor");
  donor.buffs = 1;
  player.base = [donor];
  player.hand = [instance(cards.wildclawShaman, player.id, "explicit-wildclaw")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `wildclaw-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-wildclaw", "base").ok, true);
  for (const runeId of ["wildclaw-r0", "wildclaw-r1", "wildclaw-r2", "wildclaw-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);
  const shaman = player.base.find((card) => card.instanceId === "explicit-wildclaw");
  shaman.exhausted = true;
  assert.equal(game.pendingChoice.effect, "spendFriendlyBuffBuffSelfReady");

  assert.equal(chooseEffectOption(game, "wildclaw-donor").ok, true);
  assert.equal(donor.buffs, 0);
  assert.equal(shaman.buffs, 1);
  assert.equal(shaman.exhausted, false);
});

test("king's edict has the next player choose an uncontrolled unit to kill", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.lonelyPoro, opponent.id, "edict-enemy");
  opponent.base = [enemy];
  player.hand = [instance(cards.kingsEdict, player.id, "explicit-kings-edict")];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.ORDER, player.id, `edict-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-kings-edict", "base").ok, true);
  for (const runeId of ["edict-r0", "edict-r1", "edict-r2", "edict-r3", "edict-r4", "edict-r5"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "edict-r6", "power").ok, true);
  assert.equal(togglePaymentRune(game, "edict-r7", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "eachOtherPlayerKillUncontrolledUnit");
  assert.equal(game.pendingChoice.playerId, opponent.id);

  assert.equal(chooseEffectOption(game, "edict-enemy").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "edict-enemy"), true);
});

test("overt operation spends buffs to ready then buffs friendly units", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "overt-first");
  const second = instance(cards.lonelyPoro, player.id, "overt-second");
  first.buffs = 1;
  first.exhausted = true;
  second.exhausted = true;
  player.base = [first, second];
  player.hand = [instance(cards.overtOperation, player.id, "explicit-overt")];
  player.runes = Array.from({ length: 7 }, (_, index) => rune(DOMAINS.BODY, player.id, `overt-r${index}`));

  assert.equal(playCard(game, "explicit-overt", "base").ok, true);
  assert.equal(first.exhausted, false);
  assert.equal(first.buffs, 1);
  assert.equal(second.exhausted, true);
  assert.equal(second.buffs, 1);
});

test("stealthy pursuer may move with a friendly unit from the same battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const firstField = game.battlefields[0];
  const secondField = game.battlefields[1];
  const mover = instance(cards.yasuoWindrider, player.id, "pursuer-mover");
  const pursuer = instance(cards.stealthyPursuer, player.id, "explicit-pursuer");
  firstField.controlledBy = player.id;
  secondField.controlledBy = player.id;
  firstField.units = [mover, pursuer];

  assert.equal(moveUnit(game, "pursuer-mover", secondField.instanceId).ok, true);
  assert.equal(game.pendingChoice.effect, "moveWithFriendlyFromSameBattlefield");
  assert.equal(chooseEffectOption(game, "move").ok, true);
  assert.equal(secondField.units.some((unit) => unit.instanceId === "explicit-pursuer"), true);
  assert.equal(pursuer.exhausted, true);
});

test("imperial decree kills units that take damage this turn", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.missFortuneCaptain, opponent.id, "decree-target");
  field.controlledBy = opponent.id;
  field.units = [target];
  player.hand = [
    instance(cards.imperialDecree, player.id, "explicit-decree"),
    instance(cards.getExcited, player.id, "decree-get-excited"),
    instance(cards.portalRescue, player.id, "decree-discard")
  ];
  player.runes = Array.from({ length: 10 }, (_, index) => rune(index === 9 ? DOMAINS.FURY : DOMAINS.ORDER, player.id, `decree-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-decree", "base").ok, true);
  for (const runeId of ["decree-r0", "decree-r1", "decree-r2", "decree-r3", "decree-r4"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "decree-r5", "power").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r6", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(beginPlayCard(game, "decree-get-excited", "base").ok, true);
  assert.equal(chooseEffectOption(game, "decree-target").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r7", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r8", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "decree-r9", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice.effect, "discardEnergyDamage");
  assert.equal(chooseEffectOption(game, "decree-discard").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "decree-target"), true);
});

test("albus ferros spends friendly buffs to channel exhausted runes", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "albus-first");
  const second = instance(cards.lonelyPoro, player.id, "albus-second");
  first.buffs = 1;
  second.buffs = 2;
  player.base = [first, second];
  player.hand = [instance(cards.albusFerros, player.id, "explicit-albus")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.ORDER, player.id, `albus-r${index}`));
  const runeCount = player.runes.length;

  assert.equal(playCard(game, "explicit-albus", "base").ok, true);
  assert.equal(first.buffs, 0);
  assert.equal(second.buffs, 0);
  assert.equal(player.runes.length, runeCount + 3);
  assert.equal(player.runes.slice(-3).every((card) => card.exhausted), true);
});

test("malzahar fanatic kills a friendly permanent to channel a rune exhausted", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const malzahar = instance(cards.malzaharFanatic, player.id, "explicit-malzahar");
  const victim = instance(cards.lonelyPoro, player.id, "malzahar-victim");
  player.base = [malzahar, victim];
  const runeCount = player.runes.length;

  assert.equal(activateCard(game, "explicit-malzahar").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "malzahar-victim").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "malzahar-victim"), true);
  assert.equal(player.runes.length, runeCount + 1);
  assert.equal(player.runes.at(-1).exhausted, true);
  assert.equal(malzahar.exhausted, true);
});

test("noxian guillotine kills the chosen unit when it later takes damage", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const target = instance(cards.missFortuneCaptain, opponent.id, "guillotine-target");
  field.controlledBy = opponent.id;
  field.units = [target];
  player.hand = [
    instance(cards.noxianGuillotine, player.id, "explicit-guillotine"),
    instance(cards.getExcited, player.id, "guillotine-get-excited"),
    instance(cards.portalRescue, player.id, "guillotine-discard")
  ];
  player.runes = Array.from({ length: 8 }, (_, index) => rune(DOMAINS.FURY, player.id, `guillotine-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-guillotine", "base").ok, true);
  assert.equal(chooseEffectOption(game, "guillotine-target").ok, true);
  for (const runeId of ["guillotine-r0", "guillotine-r1", "guillotine-r2", "guillotine-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "guillotine-r4", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(beginPlayCard(game, "guillotine-get-excited", "base").ok, true);
  assert.equal(chooseEffectOption(game, "guillotine-target").ok, true);
  assert.equal(togglePaymentRune(game, "guillotine-r5", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "guillotine-r6", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "guillotine-r7", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(chooseEffectOption(game, "guillotine-discard").ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === "guillotine-target"), true);
});

test("ravenborn tome gives the next spell bonus damage", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const tome = instance(cards.ravenbornTome, player.id, "explicit-ravenborn-tome");
  const spell = instance(cards.hextechRay, player.id, "ravenborn-ray");
  const target = instance(cards.missFortuneCaptain, opponent.id, "ravenborn-target");
  game.battlefields[0].controlledBy = opponent.id;
  game.battlefields[0].units = [target];
  player.base = [tome];

  assert.equal(activateCard(game, "explicit-ravenborn-tome").ok, true);
  assert.equal(tome.exhausted, true);
  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(game.pendingChoice.effect, "damageUnit");
  assert.equal(chooseEffectOption(game, "ravenborn-target").ok, true);
  assert.equal(target.damage, 4);
  assert.equal(player.nextSpellBonusDamage, 0);
});

test("kai'sa evolutionary plays a low-cost trash spell after conquering", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const kaisa = instance(cards.kaiSaEvolutionary, player.id, "explicit-evolutionary-kaisa");
  const spell = instance(cards.confront, player.id, "kaisa-confront");
  const drawCard = instance(cards.lonelyPoro, player.id, "kaisa-draw");
  const field = {
    ...instance(cards.reckonersArena, player.id, "kaisa-reckoners-arena"),
    controlledBy: player.id,
    hidden: [],
    units: [kaisa]
  };
  game.battlefields[0] = field;
  field.controlledBy = player.id;
  player.trash = [spell];
  player.mainDeck = [drawCard];
  player.score = 3;

  startTurn(game);
  assert.equal(game.pendingChoice.effect, "playTrashSpell");
  assert.equal(chooseEffectOption(game, "kaisa-confront").ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === "kaisa-draw"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "kaisa-confront"), false);
  assert.equal(player.mainDeck.some((card) => card.instanceId === "kaisa-confront"), true);
});

test("viktor leader creates a recruit when another non-recruit friendly unit dies", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const viktor = instance(cards.viktorLeader, player.id, "explicit-viktor-leader");
  const victim = instance(cards.lonelyPoro, player.id, "viktor-victim");
  const spell = instance(cards.hextechRay, player.id, "viktor-ray");
  game.battlefields[0].controlledBy = player.id;
  game.battlefields[0].units = [victim];
  player.base = [viktor];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, "viktor-victim").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "viktor-victim"), true);
  assert.equal(player.base.some((card) => card.name === "Recruit" && card.controllerId === player.id), true);
});

test("viktor leader ignores friendly recruit deaths", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const viktor = instance(cards.viktorLeader, player.id, "explicit-viktor-no-recruit");
  const recruit = instance(cards.recruit, player.id, "viktor-recruit");
  const spell = instance(cards.hextechRay, player.id, "viktor-recruit-ray");
  game.battlefields[0].controlledBy = player.id;
  game.battlefields[0].units = [recruit];
  player.base = [viktor];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, "viktor-recruit").ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === "viktor-recruit"), true);
  assert.equal(player.base.filter((card) => card.name === "Recruit").length, 0);
});

test("void gate adds bonus damage to units at that battlefield", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = {
    ...instance(cards.voidGate, player.id, "explicit-void-gate"),
    controlledBy: opponent.id,
    hidden: [],
    units: [instance(cards.missFortuneCaptain, opponent.id, "void-gate-target")]
  };
  game.battlefields[0] = field;
  const spell = instance(cards.hextechRay, player.id, "void-gate-ray");

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, "void-gate-target").ok, true);
  assert.equal(field.units[0].damage, 4);
});

test("akshan weaponmaster returns temporarily controlled enemy equipment when he leaves play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const equipment = instance(cards.guardianAngel, opponent.id, "enemy-equipment");
  opponent.base = [equipment];
  player.hand = [instance(cards.akshanMischievous, player.id, "explicit-akshan")];
  player.runes = Array.from({ length: 6 }, (_, index) => rune(DOMAINS.BODY, player.id, `akshan-r${index}`));

  assert.equal(beginPlayCard(game, "explicit-akshan", "base").ok, true);
  assert.equal(game.pendingPayment.optionalPowerEffects.length, 1);
  assert.equal(toggleOptionalPaymentEffect(game, game.pendingPayment.optionalPowerEffects[0].id).ok, true);
  for (const runeId of ["akshan-r0", "akshan-r1", "akshan-r2", "akshan-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(togglePaymentRune(game, "akshan-r4", "power").ok, true);
  assert.equal(togglePaymentRune(game, "akshan-r5", "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  const akshan = player.base.find((card) => card.instanceId === "explicit-akshan");
  assert.equal(game.pendingChoice.effect, "stealEnemyGear");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), ["enemy-equipment"]);

  assert.equal(chooseEffectOption(game, "enemy-equipment").ok, true);
  assert.equal(opponent.base.some((card) => card.instanceId === "enemy-equipment"), false);
  assert.equal(player.base.some((card) => card.instanceId === "enemy-equipment"), false);
  assert.equal(akshan.attachments.some((card) => card.instanceId === "enemy-equipment"), true);
  assert.equal(player.runeDeck.filter((card) => card.instanceId.startsWith("akshan-r")).length, 2);

  const field = game.battlefields[0];
  player.base = player.base.filter((card) => card.instanceId !== akshan.instanceId);
  field.units = [akshan];
  field.controlledBy = player.id;
  akshan.damage = 12;
  startTurn(game);
  assert.equal(opponent.base.some((card) => card.instanceId === "enemy-equipment"), true);
  assert.equal(player.base.some((card) => card.instanceId === "enemy-equipment"), false);
});

test("akshan weaponmaster does not steal gear without paying the additional body power", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const equipment = instance(cards.guardianAngel, opponent.id, "unpaid-enemy-equipment");
  opponent.base = [equipment];
  player.hand = [instance(cards.akshanMischievous, player.id, "unpaid-akshan")];
  player.runes = Array.from({ length: 4 }, (_, index) => rune(DOMAINS.BODY, player.id, `unpaid-akshan-r${index}`));

  assert.equal(beginPlayCard(game, "unpaid-akshan", "base").ok, true);
  for (const runeId of ["unpaid-akshan-r0", "unpaid-akshan-r1", "unpaid-akshan-r2", "unpaid-akshan-r3"]) {
    assert.equal(togglePaymentRune(game, runeId, "energy").ok, true);
  }
  assert.equal(confirmPayment(game).ok, true);

  assert.equal(game.pendingChoice, null);
  assert.equal(opponent.base.some((card) => card.instanceId === "unpaid-enemy-equipment"), true);
});

test("each zhonya's hourglass can replace one friendly unit death", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance(cards.lonelyPoro, player.id, "zhonya-saved-one");
  const second = instance(cards.scuttleCrab, player.id, "zhonya-saved-two");
  const firstZhonya = instance(cards.zhonyasHourglass, player.id, "zhonya-one");
  const secondZhonya = instance(cards.zhonyasHourglass, player.id, "zhonya-two");
  field.units = [first, second];
  field.controlledBy = player.id;
  player.base = [firstZhonya, secondZhonya];
  player.hand = [instance(cards.uncheckedPower, player.id, "zhonya-boardwipe")];
  player.runes = Array.from({ length: 9 }, (_, index) => rune(DOMAINS.MIND, player.id, `zhonya-r${index}`));

  assert.equal(playCard(game, "zhonya-boardwipe", "base").ok, true);
  assert.equal(field.units.length, 0);
  assert.equal(player.base.some((card) => card.instanceId === "zhonya-saved-one"), true);
  assert.equal(player.base.some((card) => card.instanceId === "zhonya-saved-two"), true);
  assert.equal(first.exhausted, true);
  assert.equal(second.exhausted, true);
  assert.equal(player.trash.some((card) => card.instanceId === "zhonya-one"), true);
  assert.equal(player.trash.some((card) => card.instanceId === "zhonya-two"), true);
});

test("spell effects deal damage and check lethal state", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "enemy-unit");
  const field = game.battlefields[0];
  field.units = [enemy];
  field.controlledBy = opponent.id;
  player.hand = [instance(cards.uncheckedPower, player.id, "unchecked-power")];
  player.runes = [
    rune(DOMAINS.MIND, player.id, "r1"),
    rune(DOMAINS.MIND, player.id, "r2"),
    rune(DOMAINS.MIND, player.id, "r3"),
    rune(DOMAINS.MIND, player.id, "r4"),
    rune(DOMAINS.MIND, player.id, "r5"),
    rune(DOMAINS.MIND, player.id, "r6"),
    rune(DOMAINS.MIND, player.id, "r7"),
    rune(DOMAINS.CHAOS, player.id, "r8"),
    rune(DOMAINS.CHAOS, player.id, "r9")
  ];

  assert.equal(playCard(game, "unchecked-power", "base").ok, true);
  assert.equal(field.units.length, 0);
  assert.equal(opponent.trash[0].name, "Ravenbloom Student");
});

test("the winning point cannot come from a single conquest", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "unit-win-limit");
  player.base = [unit];
  player.score = 7;
  player.mainDeck = [instance(cards.clockworkKeeper, player.id, "draw-card")];
  const handBefore = player.hand.length;

  assert.equal(moveUnit(game, unit.instanceId, game.battlefields[0].instanceId).ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, game.players[1].id).ok, true);
  assert.equal(player.score, 7);
  assert.equal(player.hand.length, handBefore + 1);
  assert.equal(game.phase, "action");
});

test("holding a battlefield can score the winning point", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  field.units = [instance(cards.lonelyPoro, player.id, "holder")];
  field.controlledBy = player.id;
  player.score = 7;

  startTurn(game);

  assert.equal(player.score, 8);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
});

test("aspirant's climb increases the points needed to win", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = {
    ...instance(cards.aspirantsClimb, player.id, "explicit-aspirants-climb"),
    controlledBy: player.id,
    hidden: [],
    units: [instance(cards.lonelyPoro, player.id, "aspirants-holder")]
  };
  game.battlefields[0] = field;
  player.score = 7;

  startTurn(game);

  assert.equal(player.score, 8);
  assert.equal(game.phase, "action");

  startTurn(game);

  assert.equal(player.score, 9);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
});

test("back-alley bar buffs a unit that moves from it", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "bar-unit");
  const field = {
    ...instance(cards.backAlleyBar, player.id, "explicit-back-alley"),
    controlledBy: player.id,
    hidden: [],
    units: [unit]
  };
  game.battlefields[0] = field;

  assert.equal(moveUnit(game, "bar-unit", "base").ok, true);
  assert.equal(unit.buffs, 1);
  assert.equal(player.base.some((card) => card.instanceId === "bar-unit"), true);
});

test("monastery of hirana can spend the conquering unit's buff to draw", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.lonelyPoro, player.id, "monastery-unit");
  const drawn = instance(cards.gust, player.id, "monastery-draw");
  const field = {
    ...instance(cards.monasteryOfHirana, opponent.id, "explicit-monastery"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  unit.buffs = 1;
  game.battlefields[0] = field;
  player.base = [unit];
  player.mainDeck = [drawn];

  assert.equal(moveUnit(game, "monastery-unit", "explicit-monastery").ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "spendBuffDraw");

  assert.equal(chooseEffectOption(game, "draw").ok, true);
  assert.equal(unit.buffs, 0);
  assert.equal(player.hand.some((card) => card.instanceId === "monastery-draw"), true);
});

test("the candlelit sanctum recycles selected top deck cards after conquest", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const unit = instance(cards.lonelyPoro, player.id, "sanctum-unit");
  const top = instance(cards.charm, player.id, "sanctum-top");
  const second = instance(cards.gust, player.id, "sanctum-second");
  const third = instance(cards.flash, player.id, "sanctum-third");
  const field = {
    ...instance(cards.theCandlelitSanctum, opponent.id, "explicit-sanctum"),
    controlledBy: opponent.id,
    hidden: [],
    units: []
  };
  game.battlefields[0] = field;
  player.base = [unit];
  player.mainDeck = [top, second, third];

  assert.equal(moveUnit(game, "sanctum-unit", "explicit-sanctum").ok, true);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "recycleTopDeck");

  assert.equal(chooseEffectOption(game, "recycle-0").ok, true);
  assert.deepEqual(player.mainDeck.map((card) => card.instanceId), ["sanctum-second", "sanctum-third", "sanctum-top"]);
});

test("the syren pays one energy and recalls a friendly battlefield unit", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "syren-unit");
  const syren = instance(cards.theSyren, player.id, "explicit-syren");
  const field = game.battlefields[0];
  field.controlledBy = player.id;
  field.units = [unit];
  player.base = [syren];
  player.runes = [rune(DOMAINS.CHAOS, player.id, "syren-rune")];

  assert.equal(activateCard(game, "explicit-syren").ok, true);
  assert.equal(game.pendingChoice.effect, "declareActivatedTarget");
  assert.equal(chooseEffectOption(game, "syren-unit").ok, true);
  assert.equal(game.pendingPayment.source, "activatedAbility");
  assert.equal(togglePaymentRune(game, "syren-rune", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(player.base.some((card) => card.instanceId === "syren-unit"), true);
  assert.equal(field.units.length, 0);
  assert.equal(syren.exhausted, true);
});

test("the grand plaza wins when held with seven friendly units", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const units = Array.from({ length: 7 }, (_, index) => instance(cards.lonelyPoro, player.id, `plaza-unit-${index}`));
  const field = {
    ...instance(cards.theGrandPlaza, player.id, "explicit-grand-plaza"),
    controlledBy: player.id,
    hidden: [],
    units
  };
  game.battlefields[0] = field;

  startTurn(game);

  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, player.id);
});

test("fortified position gives a defending unit shield 2", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const defender = instance(cards.lonelyPoro, opponent.id, "fortified-defender");
  const attacker = instance(cards.lonelyPoro, player.id, "fortified-attacker");
  const field = {
    ...instance(cards.fortifiedPosition, opponent.id, "explicit-fortified"),
    controlledBy: opponent.id,
    hidden: [],
    units: [defender]
  };
  game.battlefields[0] = field;
  player.base = [attacker];

  assert.equal(moveUnit(game, "fortified-attacker", "explicit-fortified").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "giveKeyword");

  assert.equal(chooseEffectOption(game, "fortified-defender").ok, true);
  assert.equal(defender.temporaryKeywords.includes("Shield"), true);
  assert.equal(defender.temporaryShieldAmount, 2);
});

test("reaver's row can recall a friendly defender to base", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const defender = instance(cards.lonelyPoro, opponent.id, "reaver-defender");
  const attacker = instance(cards.lonelyPoro, player.id, "reaver-attacker");
  const field = {
    ...instance(cards.reaversRow, opponent.id, "explicit-reavers-row"),
    controlledBy: opponent.id,
    hidden: [],
    units: [defender]
  };
  game.battlefields[0] = field;
  player.base = [attacker];

  assert.equal(moveUnit(game, "reaver-attacker", "explicit-reavers-row").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.pendingChoice.effect, "returnUnitToBase");

  assert.equal(chooseEffectOption(game, "reaver-defender").ok, true);
  assert.equal(field.units.some((unit) => unit.instanceId === "reaver-defender"), false);
  assert.equal(opponent.base.some((unit) => unit.instanceId === "reaver-defender"), true);
});

test("vilemaw's lair prevents units from moving from there to base", () => {
  const game = createGame();
  finishSetup(game);
  const player = currentPlayer(game);
  const field = {
    ...instance(cards.vilemawsLair, player.id, "explicit-vilemaw-lair"),
    controlledBy: player.id,
    hidden: [],
    units: [instance(cards.lonelyPoro, player.id, "lair-unit")]
  };
  game.battlefields[0] = field;

  const result = moveUnit(game, "lair-unit", "base");

  assert.equal(result.ok, false);
  assert.match(result.message, /prevents units from moving to base/);
  assert.equal(field.units.some((unit) => unit.instanceId === "lair-unit"), true);
  assert.equal(player.base.some((unit) => unit.instanceId === "lair-unit"), false);
});

test("vilemaw's lair prevents Flash from moving units there to base", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = {
    ...instance(cards.vilemawsLair, player.id, "flash-vilemaw-lair"),
    controlledBy: player.id,
    hidden: [],
    units: [instance(cards.lonelyPoro, player.id, "flash-lair-unit")]
  };
  game.battlefields[0] = field;
  player.hand = [instance(cards.flash, player.id, "flash-blocked-by-lair")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "flash-lair-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "flash-lair-energy-two")
  ];

  const result = beginPlayCard(game, "flash-blocked-by-lair", "base");

  assert.equal(result.ok, true);
  assert.equal(game.pendingPayment.cardId, "flash-blocked-by-lair");
  assert.equal(field.units.some((unit) => unit.instanceId === "flash-lair-unit"), true);
});

test("Flash declares up to two friendly battlefield units before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const field = game.battlefields[0];
  const first = instance(cards.lonelyPoro, player.id, "flash-first-target");
  const second = instance(cards.ravenbloomStudent, player.id, "flash-second-target");
  field.units = [first, second];
  field.controlledBy = player.id;
  player.hand = [instance(cards.flash, player.id, "flash-declared-targets")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "flash-energy-one"),
    rune(DOMAINS.CHAOS, player.id, "flash-energy-two")
  ];

  assert.equal(beginPlayCard(game, "flash-declared-targets", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "flash-first-target").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, "flash-second-target").ok, true);
  assert.equal(game.pendingPayment.cardId, "flash-declared-targets");
  assert.deepEqual(game.pendingPayment.declaredTargets.map((target) => target.targetId), ["flash-first-target", "flash-second-target"]);

  assert.equal(togglePaymentRune(game, "flash-energy-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "flash-energy-two", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((unit) => unit.instanceId === "flash-first-target"), true);
  assert.equal(player.base.some((unit) => unit.instanceId === "flash-second-target"), true);
});

test("Meditation chooses and pays its optional exhaust cost before resolving", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const unit = instance(cards.lonelyPoro, player.id, "meditation-cost-unit");
  player.base = [unit];
  player.hand = [instance(cards.meditation, player.id, "timed-meditation")];
  player.mainDeck = [
    instance(cards.lonelyPoro, player.id, "meditation-draw-one"),
    instance(cards.scuttleCrab, player.id, "meditation-draw-two")
  ];
  player.runes = [
    rune(DOMAINS.CALM, player.id, "meditation-rune-one"),
    rune(DOMAINS.CALM, player.id, "meditation-rune-two")
  ];

  assert.equal(beginPlayCard(game, "timed-meditation", "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(togglePaymentRune(game, "meditation-rune-one", "energy").ok, true);
  assert.equal(togglePaymentRune(game, "meditation-rune-two", "energy").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(unit.exhausted, true);
  assert.equal(player.hand.length, 2);
});

test("Fox-Fire declares its battlefield and complete unit set before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const first = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "fox-fire-first");
  const second = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "fox-fire-second");
  const spared = instance({ ...cards.ravenbloomStudent, might: 4 }, opponent.id, "fox-fire-spared");
  field.units = [first, second, spared];
  player.hand = [instance({ ...cards.foxFire, energy: 0, power: [] }, player.id, "timed-fox-fire")];

  assert.equal(beginPlayCard(game, "timed-fox-fire", "base").ok, true);
  assert.equal(chooseEffectOption(game, field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === second.instanceId), true);
  assert.equal(field.units.some((card) => card.instanceId === spared.instanceId), true);
});

test("Bullet Time fixes its battlefield and exact Rune cards before payment", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players[1];
  const field = game.battlefields[0];
  const enemy = instance(cards.ravenbloomStudent, opponent.id, "bullet-time-enemy");
  field.units = [enemy];
  player.hand = [instance({ ...cards.bulletTime, energy: 0, power: [] }, player.id, "timed-bullet-time")];
  player.runes = Array.from({ length: 3 }, (_, index) => rune(DOMAINS.BODY, player.id, `bullet-time-rune-${index}`));

  assert.equal(beginPlayCard(game, "timed-bullet-time", "base").ok, true);
  assert.equal(chooseEffectOption(game, field.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "bullet-time-rune-0").ok, true);
  assert.equal(chooseEffectOption(game, "bullet-time-rune-2").ok, true);
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(enemy.damage, 2);
  assert.deepEqual(player.runes.map((candidate) => candidate.instanceId), ["bullet-time-rune-1"]);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "bullet-time-rune-0"), true);
  assert.equal(player.runeDeck.some((candidate) => candidate.instanceId === "bullet-time-rune-2"), true);
});

test("permanent additional costs are paid before the permanent enters play", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const victim = instance(cards.lonelyPoro, player.id, "patron-cost-victim");
  player.base = [victim];
  player.hand = [instance({ ...cards.cruelPatron, energy: 0, power: [] }, player.id, "timed-cruel-patron")];

  assert.equal(beginPlayCard(game, "timed-cruel-patron", "base").ok, true);
  assert.equal(chooseEffectOption(game, victim.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === victim.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === "timed-cruel-patron"), true);
});

test("Brazen Buccaneer applies its declared discard cost reduction", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const discarded = instance(cards.lonelyPoro, player.id, "buccaneer-cost-card");
  player.hand = [
    instance({ ...cards.brazenBuccaneer, energy: 2 }, player.id, "timed-brazen-buccaneer"),
    discarded
  ];

  assert.equal(beginPlayCard(game, "timed-brazen-buccaneer", "base").ok, true);
  assert.equal(chooseEffectOption(game, discarded.instanceId).ok, true);
  assert.equal(game.pendingPayment.energyCost, 0);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === discarded.instanceId), true);
  assert.equal(player.base.some((card) => card.instanceId === "timed-brazen-buccaneer"), true);
});

test("non-showdown chain returns to the turn player when the chain empties", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const source = instance(cards.stackedDeck, player.id, "neutral-chain-spell");
  player.base = [source];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [finalizedTriggerItem(source, player.id, "neutral-chain-item")]
  };

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, player.id);
});

test("non-showdown chain reopens the reaction window while chain items remain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const first = instance(cards.stackedDeck, player.id, "neutral-chain-first");
  const second = instance(cards.flash, opponent.id, "neutral-chain-second");
  game.manualActionChainPriority = true;
  player.hand = [instance(cards.flash, player.id, "neutral-chain-response")];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "neutral-chain-response-rune-1"),
    rune(DOMAINS.CHAOS, player.id, "neutral-chain-response-rune-2")
  ];
  player.base = [first];
  opponent.base = [second];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 2,
    chain: [
      finalizedTriggerItem(first, player.id, "neutral-chain-bottom"),
      finalizedTriggerItem(second, opponent.id, "neutral-chain-top")
    ]
  };

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.ok(game.actionChain);
  assert.equal(game.actionChain.chain.length, 1);
  assert.equal(game.actionChain.priorityPlayerId, player.id);
  assert.equal(game.currentPlayerId, player.id);
});

test("hard bargain can declare a Sabotage on an action chain", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const sabotage = instance(cards.sabotage, opponent.id, "action-chain-sabotage");
  const bargain = instance(cards.hardBargain, player.id, "action-chain-bargain");
  player.hand = [bargain];
  player.runes = [
    rune(DOMAINS.CHAOS, player.id, "action-chain-bargain-rune-1"),
    rune(DOMAINS.CHAOS, player.id, "action-chain-bargain-rune-2")
  ];
  game.actionChain = {
    turnPlayerId: opponent.id,
    playerIds: [opponent.id, player.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{ card: sabotage, playerId: opponent.id, destination: "base", state: "finalized" }]
  };
  game.currentPlayerId = player.id;

  assert.equal(beginPlayCard(game, bargain.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [sabotage.instanceId]);
});

test("non-showdown unit on-play trigger chain empties back to the turn player only", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const unit = instance(cards.clockworkKeeper, player.id, "onplay-chain-unit");
  player.base = [unit];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [finalizedTriggerItem(unit, player.id, "onplay-chain-item")]
  };

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(game.currentPlayerId, player.id);
});

test("showdown chain passes focus to the next player when the chain empties", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const source = instance(cards.lonelyPoro, attacker.id, "showdown-empty-source");
  game.battlefields[0].units = [source];
  game.phase = "showdown";
  game.currentPlayerId = defender.id;
  game.showdown = {
    battlefieldId: game.battlefields[0].instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: attacker.id,
    priorityPlayerId: defender.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [finalizedTriggerItem(source, attacker.id, "showdown-empty-item")]
  };

  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.ok(game.showdown);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(game.showdown.focusPlayerId, defender.id);
  assert.equal(game.showdown.priorityPlayerId, defender.id);
});

test("showdown chain keeps the current focus while chain items remain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const first = instance(cards.lonelyPoro, attacker.id, "showdown-remain-first");
  const second = instance(cards.flash, defender.id, "showdown-remain-second");
  game.battlefields[0].units = [first, second];
  game.phase = "showdown";
  game.currentPlayerId = defender.id;
  game.showdown = {
    battlefieldId: game.battlefields[0].instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: defender.id,
    priorityPlayerId: defender.id,
    consecutivePasses: 1,
    chainSequence: 2,
    chain: [
      finalizedTriggerItem(first, attacker.id, "showdown-remain-bottom"),
      finalizedTriggerItem(second, defender.id, "showdown-remain-top")
    ]
  };

  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.ok(game.showdown);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.focusPlayerId, defender.id);
  assert.equal(game.showdown.priorityPlayerId, defender.id);
});

test("showdown resolves when both players pass without starting a new chain", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = game.battlefields[0];
  game.phase = "showdown";
  game.currentPlayerId = attacker.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: false,
    focusPlayerId: attacker.id,
    priorityPlayerId: attacker.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(passShowdown(game, attacker.id).ok, true);
  assert.equal(game.showdown.priorityPlayerId, defender.id);
  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.equal(game.showdown, null);
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, attacker.id);
});

test("semantic lifecycle oracle rejects an orphaned continuation operation", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  game.operations.push({ id: "mutant-orphan", kind: "move", status: "pending", data: {} });

  assert.throws(() => validateStableGameState(game), /stable game has pending operations/);
});

test("semantic lifecycle oracle accepts an operation owned by the current choice", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  game.operations.push({ id: "owned-operation", kind: "move", status: "pending", data: {} });
  game.pendingChoice = {
    id: "owned-choice",
    playerId: game.currentPlayerId,
    card: { name: "Synthetic choice" },
    effect: "synthetic",
    options: [{ id: "continue", label: "Continue" }],
    data: { afterMove: { operationId: "owned-operation" } }
  };

  assert.doesNotThrow(() => validateStableGameState(game));
});

test("semantic flow oracle rejects opposing units without a staged combat", () => {
  const game = createGame({ interactive: true });
  finishSetup(game);
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  game.battlefields[0].units = [
    instance(cards.lonelyPoro, attacker.id, "mutant-attacker"),
    instance(cards.lonelyPoro, defender.id, "mutant-defender")
  ];
  game.stagedEvents = [];

  assert.throws(() => validateStableGameState(game), /have no showdown or staged combat/);
});
