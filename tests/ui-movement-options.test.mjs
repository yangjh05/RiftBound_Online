import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { legalMoveDestinationIds, sharedLegalMoveDestinationIds } from "../src/ui/movement-options.mjs";

const appSource = readFileSync(fileURLToPath(new URL("../src/app.mjs", import.meta.url)), "utf8");

test("movement buttons use the engine-enumerated legal destinations", () => {
  const legalActions = [
    { kind: "moveUnit", unitId: "ganking-field-unit", destinationId: "field-2" },
    { kind: "moveUnit", unitId: "base-unit", destinationId: "field-1" },
    { kind: "moveUnit", unitId: "base-unit", destinationId: "field-2" },
    { kind: "endTurn" }
  ];

  assert.deepEqual(legalMoveDestinationIds(legalActions, "ganking-field-unit"), ["field-2"]);
  assert.match(appSource, /legalMoveDestinationIds\(uiLegalActions, card\.instanceId\)/);
});

test("a base unit and a Ganking battlefield unit share a standard-move destination", () => {
  const legalActions = [
    { kind: "moveUnit", unitId: "ganking-field-unit", destinationId: "base" },
    { kind: "moveUnit", unitId: "ganking-field-unit", destinationId: "field-2" },
    { kind: "moveUnit", unitId: "base-unit", destinationId: "field-1" },
    { kind: "moveUnit", unitId: "base-unit", destinationId: "field-2" }
  ];

  assert.deepEqual(
    sharedLegalMoveDestinationIds(legalActions, ["base-unit", "ganking-field-unit"]),
    ["field-2"]
  );
  assert.match(appSource, /sharedLegalMoveDestinationIds\([\s\S]*?uiLegalActions/);
});
