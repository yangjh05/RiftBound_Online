import test from "node:test";
import assert from "node:assert/strict";
import { battlefieldDisplayName, battlefieldSeatNumber } from "../src/ui/battlefield-labels.mjs";

function duplicateBattlefieldGame() {
  const first = { instanceId: "field-p1", ownerId: "p1", name: "The Grand Plaza" };
  const second = { instanceId: "field-p2", ownerId: "p2", name: "The Grand Plaza" };
  return {
    players: [
      { id: "p1", selectedBattlefieldId: first.instanceId },
      { id: "p2", selectedBattlefieldId: second.instanceId }
    ],
    battlefields: [first, second]
  };
}

test("duplicate battlefield names include the selecting player's seat", () => {
  const game = duplicateBattlefieldGame();
  assert.equal(battlefieldDisplayName(game, game.battlefields[0], "대광장"), "대광장 · P1");
  assert.equal(battlefieldDisplayName(game, game.battlefields[1], "대광장"), "대광장 · P2");
});

test("unique battlefield names remain unchanged", () => {
  const game = duplicateBattlefieldGame();
  game.battlefields[1].name = "Navori Fighting Pit";
  assert.equal(battlefieldDisplayName(game, game.battlefields[0], "대광장"), "대광장");
});

test("seat detection falls back to the selected battlefield and then board order", () => {
  const game = duplicateBattlefieldGame();
  delete game.battlefields[1].ownerId;
  assert.equal(battlefieldSeatNumber(game, game.battlefields[1]), 2);
  game.players[1].selectedBattlefieldId = null;
  assert.equal(battlefieldSeatNumber(game, game.battlefields[1]), 2);
});
