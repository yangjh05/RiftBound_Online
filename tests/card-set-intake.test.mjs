import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSetIntakeReport,
  canonicalNumberedSetCards,
  renderSetIntakeMarkdown
} from "../scripts/audit-card-set-intake.mjs";

const setRecord = { id: "SFD", name: "Spiritforged", collectorNumberMax: 3 };
const officialItems = [
  card("SFD-001/3", "Gold Maker", "unit", "Play a Gold gear token exhausted."),
  card("SFD-002/3", "Practice Blade", "gear", "[Quick-Draw]\n[Equip] [A]"),
  card("SFD-003/3", "Again", "spell", "[Repeat] [1]\nDraw 1."),
  card("SFD-002a/3", "Practice Blade", "gear", "[Quick-Draw]\n[Equip] [A]"),
  card("SFD-004/3", "Overnumbered", "unit", ""),
  card("OGN-001/3", "Wrong Set", "unit", "")
];

test("canonical numbered set cards exclude variants, overnumbers, and other sets", () => {
  assert.deepEqual(
    canonicalNumberedSetCards(officialItems, "SFD", 3).map((entry) => entry.cardNumber),
    ["SFD-001/3", "SFD-002/3", "SFD-003/3"]
  );
});

test("set intake report compares registered coverage and mechanic families", () => {
  const report = buildSetIntakeReport({
    galleryItems: officialItems,
    gallerySets: [setRecord],
    registeredCards: [{ cardNumber: "SFD-002/3" }],
    setId: "sfd",
    officialRulesDate: "2026-07-16",
    localRulesDate: "2026-03-30"
  });

  assert.equal(report.set.officialNumberedCards, 3);
  assert.equal(report.implementation.registered, 1);
  assert.equal(report.implementation.missing, 2);
  assert.equal(report.implementation.coveragePercent, 33.3);
  assert.deepEqual(report.mechanics.find((entry) => entry.id === "equip"), {
    id: "equip",
    label: "Equip 장비",
    official: 1,
    implemented: 1,
    missing: 0,
    cardNumbers: ["SFD-002/3"],
    implementedCardNumbers: ["SFD-002/3"]
  });
  assert.equal(report.mechanics.find((entry) => entry.id === "gold").official, 1);
  assert.equal(report.mechanics.find((entry) => entry.id === "repeat").official, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("older than")));
  assert.match(renderSetIntakeMarkdown(report), /현재 등록: 1장 \(33\.3%\)/);
});

function card(publicCode, name, type, rulesText) {
  return {
    publicCode,
    name,
    cardType: { type: [{ id: type }] },
    text: { richText: { body: rulesText.replace(/\n/g, "<br />") } }
  };
}
