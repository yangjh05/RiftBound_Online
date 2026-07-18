import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cardStatusItems } from "../src/ui/card-status.mjs";

test("card status UI describes every active unit modifier in Korean", () => {
  const card = {
    type: "unit",
    ownerId: "p1",
    controllerId: "p2",
    stunned: true,
    exhausted: true,
    buffs: 2,
    mightModifier: 4,
    temporaryMight: 3,
    temporaryKeywords: ["Shield", "Ganking"],
    temporaryKeywordAmounts: { shield: 2 },
    cantMoveThisTurn: true,
    temporary: true,
    damage: 2,
    damagePreventions: [{ remaining: 3, source: "any" }],
    saveWithRuneUntilTurnSequence: 4,
    saveWithRuneDomain: "Body",
    saveWithRuneSourceName: "Guardian Angel",
    attachments: [{ name: "Trinity Force" }],
    combatRole: "defender"
  };

  const statuses = cardStatusItems(card, {
    locale: "ko",
    keywordLabel: (keyword) => ({ Shield: "방패", Ganking: "급습" })[keyword] || keyword,
    cardLabel: (name) => ({ "Guardian Angel": "수호 천사", "Trinity Force": "삼위일체" })[name] || name,
    domainLabel: () => "신체"
  });
  const byKind = new Map(statuses.map((status) => [status.kind, status]));

  assert.equal(byKind.get("stunned").badge, "기절");
  assert.equal(byKind.get("buff").badge, "버프 ×2");
  assert.equal(byKind.get("temporaryMight").badge, "일시 위력 +3");
  assert.equal(byKind.get("lastingMight").badge, "위력 변경 +1");
  assert.equal(byKind.get("keywords").badge, "방패 2 · 급습");
  assert.equal(byKind.get("cannotMove").duration, "턴 종료까지");
  assert.match(byKind.get("save").detail, /신체 힘/u);
  assert.equal(byKind.get("save").source, "수호 천사");
  assert.equal(byKind.get("attachments").source, "삼위일체");
  assert.ok(byKind.has("controller"));
  assert.ok(byKind.has("defender"));
});

test("permanent and temporary Might are not double-counted", () => {
  const statuses = cardStatusItems({ mightModifier: -2, temporaryMight: -2 }, { locale: "ko" });
  assert.equal(statuses.filter((status) => status.kind === "temporaryMight").length, 1);
  assert.equal(statuses.some((status) => status.kind === "lastingMight"), false);
});

test("selecting a card opens the inspector and both detail views render status UI", async () => {
  const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
  assert.match(source, /function cardStatusBadges\(card\)/u);
  assert.match(source, /function cardStatusPanel\(card/u);
  assert.match(source, /inspectorOpen = true;/u);
  assert.match(source, /cardStatusPanel\(card, \{ compact: true \}\)/u);
  assert.match(source, /\$\{cardStatusPanel\(card\)\}/u);
});

test("player identity UI tolerates a champion returned from play to hand", async () => {
  const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
  assert.match(source, /function miniIdentity\(card, player = null\) \{\s+if \(!card\) return "";/u);
  assert.match(source, /if \(player\.legend\?\.instanceId === cardId\)/u);
});
