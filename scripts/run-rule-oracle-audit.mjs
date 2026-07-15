import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RULE_ORACLE_CHECKS,
  captureRuleState,
  evaluateRuleState,
  evaluateRuleTransition
} from "./rules-oracle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "artifacts", "rule-oracle-report.json");

const mutants = [
  stateMutant("duplicate-zone", "single-zone", (game) => game.players[0].trash.push(game.players[0].hand[0])),
  stateMutant("foreign-base-control", "base-control", (game) => { game.players[0].base[0].controllerId = "p2"; }),
  stateMutant("facedown-over-capacity", "facedown-capacity", (game) => {
    game.battlefields[0].hidden.push(hiddenCard("hidden-2", "p1"));
  }),
  stateMutant("facedown-controller-mismatch", "facedown-control", (game) => { game.battlefields[0].controlledBy = "p2"; }),
  stateMutant("missing-legend", "legend-zone", (game) => { game.players[0].legend = null; }),
  stateMutant("non-board-damage", "non-board-reset", (game) => { game.players[0].trash.push(unit("damaged-trash", "p1", { damage: 2 })); }),
  stateMutant("token-in-trash", "token-zone", (game) => { game.players[0].trash.push(unit("trash-token", "p1", { tags: ["Token", "Recruit"] })); }),
  stateMutant("lethal-unit-remains", "lethal-unit", (game) => { game.players[0].base[0].damage = game.players[0].base[0].might; }),
  stateMutant("wrong-battlefield-control", "battlefield-control", (game) => { game.battlefields[0].controlledBy = "p2"; }),
  stateMutant("opposition-without-combat", "opposition-stages-combat", (game) => {
    game.battlefields[0].units.push(unit("enemy-opposition", "p2"));
  }),
  stateMutant("foreign-owned-hand-card", "owned-zone", (game) => { game.players[0].hand[0].ownerId = "p2"; }),
  stateMutant("negative-damage", "damage-state", (game) => { game.players[0].base[0].damage = -1; }),
  stateMutant("stacked-buffs", "buff-state", (game) => { game.players[0].base[0].buffs = 2; }),
  stateMutant("rune-in-main-deck-zone", "zone-type", (game) => {
    game.players[0].mainDeck.push(card("miszoned-rune", "p1", "rune"));
  }),
  stateMutant("unknown-card-controller", "player-reference", (game) => { game.players[0].base[0].controllerId = "ghost"; }),
  stateMutant("two-simultaneous-chains", "chain-state", (game) => {
    game.actionChain = { chain: [], priorityPlayerId: "p1" };
    game.showdown = { chain: [], battlefieldId: "field-1", priorityPlayerId: "p1" };
    game.phase = "showdown";
  }),
  stateMutant("delayed-ability-loses-controller", "delayed-ability-state", (game) => {
    game.delayedAbilities = [{
      id: "oracle-delayed-invalid",
      abilityClass: "triggered",
      condition: "unitTakesDamage",
      controllerId: "missing-player",
      createdTurnSequence: 0,
      expiresAfterTurnSequence: 1,
      targetId: "base-unit",
      targetZoneChangeCounter: 0,
      linkedSetId: "oracle-delayed-linked-set"
    }];
  }),
  stateMutant("replacement-source-applied-twice", "replacement-event-state", (game) => {
    game.players[0].base[0].lastReplacementEvent = {
      rootEventId: "oracle-replacement-root",
      eventId: "oracle-replacement-event",
      appliedReplacementKeys: ["source-1", "source-1"],
      modifications: {}
    };
  }),
  stateMutant("cleanup-cause-rule-mismatch", "cleanup-request-state", (game) => {
    game.cleanupOutstanding = true;
    game.cleanupRequestTrace = [{
      sequence: 1,
      ruleId: "319.8",
      cause: "object-status-change",
      duringCleanup: false,
      duringResolution: false
    }];
  }),
  stateMutant("orphaned-start-turn-task", "turn-task-continuation", (game) => {
    game.startTurnProcess = { playerId: "p1", step: "channel" };
    game.pendingChoice = { playerId: "p1", data: {} };
  }),
  stateMutant("attached-card-with-nonboard-parent", "attachment-state", (game) => {
    game.players[0].hand[0].attachments = [card("orphaned-attachment", "p1", "gear")];
  }),
  stateMutant("negative-player-xp", "numeric-state", (game) => { game.players[0].xp = -1; }),
  stateMutant("combat-damage-offers-last-unit-early", "combat-damage-assignment-priority", (game) => {
    const normal = unit("assignment-normal", "p2", { might: 2 });
    const caitlyn = unit("assignment-last", "p2", {
      might: 3,
      effects: [{ timing: "static", kind: "combatDamageAssignmentLast" }]
    });
    game.battlefields[0].units = [normal, caitlyn];
    game.pendingChoice = {
      effect: "combatDamage",
      options: [{ cardId: normal.instanceId }, { cardId: caitlyn.instanceId }],
      data: {
        battlefieldId: game.battlefields[0].instanceId,
        targetPlayerId: "p2",
        role: "attacker",
        remaining: 4
      }
    };
  }),
  transitionMutant("move-without-exhaust-cost", "standard-move-cost", (game) => {
    const moving = game.players[0].base.shift();
    game.battlefields[0].units.push(moving);
  }, { kind: "standardMove", unitIds: ["base-unit"], ok: true }),
  transitionMutant("countered-card-counted-as-played", "resolved-play-accounting", (game) => {
    game.players[0].cardsPlayedThisTurn += 1;
  }, { kind: "cardResolution", playerId: "p1", resolved: false, countered: true }),
  transitionMutant("resolved-card-not-counted", "resolved-play-accounting", () => {}, {
    kind: "cardResolution", playerId: "p1", resolved: true, countered: false
  }),
  transitionMutant("burn-out-without-point", "burn-out-sequence", (game) => {
    game.players[0].burnOuts = 1;
    game.players[0].trash = [];
  }, { kind: "burnOut", playerId: "p1", opponentId: "p2", expectedCount: 1 }, (game) => {
    game.players[0].trash = [card("burn-out-trash", "p1", "spell")];
  }),
  transitionMutant("previous-turn-might-not-expired", "turn-expiration", (game) => {
    game.turnSequence += 1;
  }, { kind: "turnExpiration", ok: true }, (game) => {
    game.players[0].base[0].temporaryMight = 2;
    game.players[0].base[0].mightModifier = 2;
  }),
  transitionMutant("turn-scoped-player-flag-not-expired", "turn-expiration", (game) => {
    game.turnSequence += 1;
  }, { kind: "turnExpiration", ok: true }, (game) => {
    game.players[0].killDamagedUnitsThisTurn = true;
  }),
  transitionMutant("rune-pool-not-emptied", "turn-expiration", (game) => {
    game.turnSequence += 1;
  }, { kind: "turnExpiration", ok: true }, (game) => {
    game.players[0].runePool = { energy: [{ id: "leftover-energy" }], power: [] };
  }),
  transitionMutant("showdown-incorrectly-empties-rune-pool", "rune-pool-boundary", (game) => {
    game.players[0].runePool = { energy: [], power: [] };
  }, { kind: "showdownCompletion", ok: true }, (game) => {
    game.players[0].runePool = { energy: [{ id: "stored-energy" }], power: [{ id: "stored-power" }] };
  }),
  transitionMutant("recall-clears-buff", "recall-preserves-board-state", (game) => {
    const recalled = game.battlefields[0].units.shift();
    recalled.buffs = 0;
    game.players[0].base.push(recalled);
  }, { kind: "recall", unitIds: ["field-unit"], healIds: [], exhaustIds: [], ok: true }, (game) => {
    const recalled = game.battlefields[0].units[0];
    recalled.buffs = 1;
    recalled.attachments = [card("recall-gear", "p1", "gear")];
  }),
  transitionMutant("next-player-orders-triggers-before-turn-player", "simultaneous-trigger-order", () => {}, {
    kind: "triggerBatch",
    turnOrder: ["p1", "p2"],
    controllerCounts: { p1: 2, p2: 2 },
    chooserOrder: ["p2", "p1"],
    resolutionControllerOrder: ["p2", "p1"],
    ok: true
  }),
  transitionMutant("replacement-source-autoselected", "replacement-effect-order", () => {}, {
    kind: "replacementSequence",
    applicableReplacementCount: 2,
    sourceChoiceOffered: false,
    simultaneousQualifiedEventCount: 1,
    eventChoiceOffered: false,
    ok: true
  }),
  transitionMutant("simultaneous-replacement-event-autoselected", "replacement-effect-order", () => {}, {
    kind: "replacementSequence",
    applicableReplacementCount: 1,
    sourceChoiceOffered: false,
    simultaneousQualifiedEventCount: 2,
    eventChoiceOffered: false,
    ok: true
  }),
  transitionMutant("stunned-survives-ending-step-boundary", "stunned-ending-boundary", () => {}, {
    kind: "endingStepBegin",
    stunnedIdsBefore: ["base-unit"],
    stunnedIdsAfter: ["base-unit"],
    ok: true
  }),
  transitionMutant("modified-victory-score-ignored-by-conquest", "winning-score-threshold", () => {}, {
    kind: "conquestScore",
    scoreBefore: 7,
    scoreAfter: 7,
    victoryScore: 9,
    scoredAllBattlefields: false,
    drawDelta: 1,
    ok: true
  })
];

const valid = baseGame();
const validViolations = evaluateRuleState(valid).violations;
const results = mutants.map((mutant) => mutant.run());
const survivors = results.filter((result) => result.status !== "killed");
const coveredChecks = new Set(results.filter((result) => result.status === "killed").map((result) => result.expectedCheckId));
const report = {
  generatedAt: new Date().toISOString(),
  sourceRulesVersion: "2026-03-30",
  summary: {
    rules: RULE_ORACLE_CHECKS.length,
    mutants: results.length,
    killed: results.length - survivors.length,
    survived: survivors.length,
    validStateViolations: validViolations.length
  },
  uncoveredChecks: RULE_ORACLE_CHECKS.map((entry) => entry.checkId).filter((checkId) => !coveredChecks.has(checkId)),
  results
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

if (validViolations.length || survivors.length || report.uncoveredChecks.length) {
  console.error(`Core Rules oracle audit failed. Report: ${path.relative(ROOT, REPORT_PATH)}`);
  if (validViolations.length) console.error(`Valid control state produced: ${validViolations.map((entry) => entry.checkId).join(", ")}`);
  if (survivors.length) console.error(`Surviving mutants: ${survivors.map((entry) => entry.id).join(", ")}`);
  if (report.uncoveredChecks.length) console.error(`Checks without a dedicated mutant: ${report.uncoveredChecks.join(", ")}`);
  process.exit(1);
}

console.log(`Core Rules oracle killed ${report.summary.killed}/${report.summary.mutants} rule-violation mutants across ${report.summary.rules} independent checks. Report: ${path.relative(ROOT, REPORT_PATH)}`);

function stateMutant(id, expectedCheckId, mutate) {
  return {
    id,
    expectedCheckId,
    run() {
      const game = baseGame();
      mutate(game);
      const violations = evaluateRuleState(game).violations;
      return result(id, expectedCheckId, violations);
    }
  };
}

function transitionMutant(id, expectedCheckId, mutate, context, setup = null) {
  return {
    id,
    expectedCheckId,
    run() {
      const game = baseGame();
      if (setup) setup(game);
      const before = captureRuleState(game);
      mutate(game);
      const violations = evaluateRuleTransition(before, game, context).violations;
      return result(id, expectedCheckId, violations);
    }
  };
}

function result(id, expectedCheckId, violations) {
  return {
    id,
    expectedCheckId,
    status: violations.some((entry) => entry.checkId === expectedCheckId) ? "killed" : "survived",
    detectedChecks: [...new Set(violations.map((entry) => entry.checkId))]
  };
}

function baseGame() {
  const p1 = player("p1");
  const p2 = player("p2");
  const field = {
    instanceId: "field-1",
    name: "Oracle Battlefield",
    type: "battlefield",
    ownerId: "p1",
    controllerId: "p1",
    controlledBy: "p1",
    effects: [],
    units: [unit("field-unit", "p1")],
    hidden: [hiddenCard("hidden-1", "p1")]
  };
  p1.hand.push(card("hand-card", "p1", "spell"));
  p1.base.push(unit("base-unit", "p1"));
  return {
    players: [p1, p2],
    phase: "action",
    currentPlayerId: "p1",
    turnSequence: 1,
    battlefields: [field],
    pendingChoice: null,
    pendingPayment: null,
    actionChain: null,
    showdown: null,
    triggerQueue: [],
    triggerQueueContinuation: null,
    stagedEvents: [],
    operations: []
  };
}

function player(id) {
  return {
    id,
    legend: card(`legend-${id}`, id, "legend"),
    champion: null,
    availableChampions: [],
    availableBattlefields: [],
    mainDeck: [],
    runeDeck: [],
    hand: [],
    base: [],
    runes: [],
    trash: [],
    banished: [],
    cardsPlayedThisTurn: 0,
    score: 0
  };
}

function card(instanceId, ownerId, type, extra = {}) {
  return {
    instanceId,
    name: instanceId,
    type,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachments: [],
    effects: [],
    tags: [],
    ...extra
  };
}

function unit(instanceId, ownerId, extra = {}) {
  return card(instanceId, ownerId, "unit", { might: 2, ...extra });
}

function hiddenCard(instanceId, ownerId) {
  return { card: card(instanceId, ownerId, "spell"), ownerId, hiddenByPlayerId: ownerId };
}
