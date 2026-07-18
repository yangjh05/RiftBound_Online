import test from "node:test";
import assert from "node:assert/strict";
import { resolveBoardClickTarget } from "../src/ui/board-click.mjs";

function element(attributes = {}, parent = null) {
  const node = {
    attributes,
    parent,
    closest(selector) {
      for (let candidate = this; candidate; candidate = candidate.parent) {
        if (selector === "button" && candidate.attributes.button) return candidate;
        if (selector === "[data-card-id]" && candidate.attributes.cardId) return candidate;
        if (selector === "[data-zone-action]" && candidate.attributes.zoneAction) return candidate;
      }
      return null;
    },
    contains(candidate) {
      for (let current = candidate; current; current = current.parent) {
        if (current === this) return true;
      }
      return false;
    }
  };
  return node;
}

test("a highlighted battlefield lane wins over its enclosing battlefield card", () => {
  const battlefield = element({ cardId: "field-1" });
  const lane = element({ zoneAction: "move" }, battlefield);
  const laneTrack = element({}, lane);

  assert.deepEqual(resolveBoardClickTarget(laneTrack), {
    button: null,
    cardNode: null,
    targetZone: lane
  });
});

test("a unit inside a highlighted lane remains the selected click target", () => {
  const battlefield = element({ cardId: "field-1" });
  const lane = element({ zoneAction: "move" }, battlefield);
  const unit = element({ cardId: "unit-1" }, lane);
  const unitBody = element({}, unit);

  assert.deepEqual(resolveBoardClickTarget(unitBody), {
    button: null,
    cardNode: unit,
    targetZone: null
  });
});

test("buttons keep priority over cards and highlighted lanes", () => {
  const battlefield = element({ cardId: "field-1" });
  const lane = element({ zoneAction: "move" }, battlefield);
  const unit = element({ cardId: "unit-1" }, lane);
  const button = element({ button: true }, unit);

  assert.deepEqual(resolveBoardClickTarget(button), {
    button,
    cardNode: null,
    targetZone: null
  });
});
