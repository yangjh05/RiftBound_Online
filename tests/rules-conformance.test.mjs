import test from "node:test";
import assert from "node:assert/strict";
import { cards, DOMAINS, makeRune } from "../src/cards.mjs";
import {
  ABILITY_ACTIVE_ZONES,
  ABILITY_CLASSES,
  EFFECT_DEFINITIONS,
  effectDefinition
} from "../src/effects/registry.mjs";
import { CARD_REACTION_PERMISSION_KINDS, cardReactionPermissionSources } from "../src/rules/keywords.mjs";
import { OFFICIAL_TOKEN_DEFINITIONS } from "../src/rules/tokens.mjs";
import {
  activateCard, applyDamage, beginPlayCard, cancelPayment, chooseEffectOption, confirmFirstPlayer, confirmPayment, createGame, currentPlayer, draw, effectiveMight, endTurn, legalCardPlayDestinations, legalChampionPlayDestinations, moveUnit, passShowdown, playCard, playChampion, playUnitToken, resolveEffect, selectBattlefield, selectChampion, startTurn, toggleOptionalPaymentEffect, togglePaymentRune
} from "../src/engine.mjs";
import {
  coreRuleFamilies,
  coreRulesCatalog,
  chainsShowdownsVerificationLedger,
  combatScoringVerificationLedger,
  coreActionsVerificationLedger,
  comparePublishedCards,
  interpretationSetupVerificationLedger,
  keywordSemanticsVerificationLedger,
  objectsZonesVerificationLedger,
  turnTasksVerificationLedger,
  verificationLedger,
  validateRuleContracts,
  validateRuleFamilies,
  validateVerificationLedger,
  validateWorkstreamLedger
} from "../scripts/validate-rule-contracts.mjs";
import { buildEffectRuleMap, validateEffectRuleMap } from "../scripts/effect-rule-map.mjs";
import { referenceOpportunityPermission, referenceShowdownExit, referenceShowdownOpening, referenceSingleChainPlacement, referenceTargetClassification, referenceZone, resolveAggregateTargetsReference, resolveChainTransitionReference, resolveCleanupReference, resolveExecuteWindowReference, resolveOutstandingTaskFeprReference, resolvePassCycleReference, resolvePlayedReference, resolvePlayLifecycleReference, resolvePostResolutionReference, resolveSplitDamageReference, resolveTurnTaskOrderReference } from "../scripts/reference-rules.mjs";
import { captureResolutionContract, validateResolutionContract } from "../scripts/semantic-oracle.mjs";
import {
  captureRuleState, evaluateRuleState, evaluateRuleTransition
} from "../scripts/rules-oracle.mjs";

function instance(card, ownerId, id) {
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

function locate(game, cardId) {
  for (const player of game.players) {
    for (const zone of ["base", "trash"]) {
      if (player[zone].some((card) => card.instanceId === cardId)) return zone;
    }
  }
  if (game.battlefields.some((field) => field.units.some((card) => card.instanceId === cardId))) return "battlefield";
  return null;
}

function testBattlefield(id, units, controlledBy) {
  return {
    instanceId: id,
    name: "Rules Conformance Battlefield",
    type: "battlefield",
    effects: [],
    units,
    hidden: [],
    controlledBy
  };
}

test("Core Rules contracts are versioned, sourced, and backed by executable evidence", () => {
  assert.deepEqual(validateRuleContracts(), []);
});

test("every registered effect declares its ability class and active zones", () => {
  for (const [key, definition] of Object.entries(EFFECT_DEFINITIONS)) {
    assert.ok(ABILITY_CLASSES.includes(definition.abilityClass), `${key} ability class`);
    assert.ok(definition.activeZones.length > 0, `${key} active zones`);
    assert.equal(definition.activeZones.every((zone) => ABILITY_ACTIVE_ZONES.includes(zone)), true, `${key} known zones`);
  }

  assert.deepEqual(effectDefinition({ timing: "activated", kind: "draw" }).activeZones, ["board"]);
  assert.deepEqual(effectDefinition({ timing: "spell", kind: "draw" }).activeZones, ["chain"]);
  assert.deepEqual(effectDefinition({ timing: "static", kind: "playFromTopReveal" }).activeZones, ["mainDeck"]);
  assert.deepEqual(effectDefinition({ timing: "static", kind: "playSelfFromTrashWhenSpellKillsUnit" }).activeZones, ["trash"]);
  assert.equal(effectDefinition({ timing: "static", kind: "buffFriendlyUnitPayExhaustReady" }).abilityClass, "triggered");
});

test("one card can carry independent ability structures without changing their classifications", () => {
  const guardianClasses = new Set(cards.guardianAngel.effects.map((effect) => effectDefinition(effect).abilityClass));
  const settClasses = new Set(cards.settTheBoss.effects.map((effect) => effectDefinition(effect).abilityClass));
  const rocketClasses = new Set(cards.superMegaDeathRocket.effects.map((effect) => effectDefinition(effect).abilityClass));

  assert.deepEqual([...guardianClasses].sort(), ["activated", "passive"]);
  assert.deepEqual([...settClasses].sort(), ["replacement", "triggered"]);
  assert.deepEqual([...rocketClasses].sort(), ["instruction", "triggered"]);
});

test("activated ability costs apply shared increases, component discounts, and discount minima", () => {
  const makeAbilitySource = (playerId, id) => instance({
    ...cards.ravenbornTome,
    id: `TEST-${id}`,
    name: `Rules Test ${id}`,
    effects: [{
      timing: "activated",
      kind: "nextSpellBonusDamage",
      amount: 1,
      costEnergy: 2
    }]
  }, playerId, id);
  const makeModifier = (playerId, id, energy, minEnergy = 0) => instance({
    ...cards.lonelyPoro,
    id: `TEST-${id}`,
    name: `Rules Test ${id}`,
    effects: [{
      timing: "static",
      kind: "costModifier",
      appliesTo: "activatedAbility",
      energy,
      minEnergy
    }]
  }, playerId, id);

  {
    const game = createGame({ interactive: true, manualActionChainPriority: true });
    const player = game.players[0];
    const source = makeAbilitySource(player.id, "ability-cost-source");
    player.base = [
      source,
      makeModifier(player.id, "ability-cost-increase", 2),
      makeModifier(player.id, "ability-cost-discount", -1)
    ];
    player.runes = Array.from({ length: 3 }, (_, index) =>
      instance(makeRune(DOMAINS.CALM), player.id, `ability-cost-rune-${index}`));
    game.phase = "action";
    game.currentPlayerId = player.id;

    assert.equal(activateCard(game, source.instanceId).ok, true);
    assert.equal(game.pendingPayment?.source, "activatedAbility");
    assert.equal(game.pendingPayment?.energyCost, 3, "the increase is applied before the discount");
    assert.equal(cancelPayment(game).ok, true);
    assert.equal(source.exhausted, false);
    assert.equal(game.actionChain, null, "cancelling restores the Pending activation transaction");
  }

  {
    const game = createGame({ interactive: true, manualActionChainPriority: true });
    const player = game.players[0];
    const source = makeAbilitySource(player.id, "ability-minimum-source");
    source.effects[0].costEnergy = 1;
    player.base = [
      source,
      makeModifier(player.id, "ability-minimum-one", -5, 1),
      makeModifier(player.id, "ability-minimum-zero", -1, 0)
    ];
    game.phase = "action";
    game.currentPlayerId = player.id;

    assert.equal(activateCard(game, source.instanceId).ok, true);
    assert.equal(game.pendingPayment, null, "a later total discount may reduce a component below an earlier minimum");
    assert.equal(source.exhausted, true);
    assert.equal(game.actionChain?.chain[0]?.status, "finalized");
  }
});

test("using an activated ability becomes true only when that ability resolves", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const source = instance(cards.ravenbornTome, player.id, "using-ability-source");
  player.base = [source];
  game.phase = "action";
  game.currentPlayerId = player.id;

  assert.equal(activateCard(game, source.instanceId).ok, true);
  assert.equal(game.actionChain?.chain[0]?.status, "finalized");
  assert.equal(game.lastResolvedActivatedAbility, undefined,
    "activation and Finalize do not satisfy a trigger that asks whether the ability was used");

  let passes = 0;
  while (game.actionChain && !game.lastResolvedActivatedAbility && passes < 2) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    passes += 1;
  }
  assert.equal(game.lastResolvedActivatedAbility?.sourceCardId, source.instanceId);
  assert.deepEqual(game.lastResolvedActivatedAbility?.abilityKinds, ["nextSpellBonusDamage"]);
});

test("Core Rules family gate rejects missing, overlapping, and stale evidence", () => {
  const missing = structuredClone(coreRuleFamilies);
  missing.families = missing.families.filter((family) => family.id !== "keyword-backline");
  assert.ok(validateRuleFamilies(missing, coreRulesCatalog).some((error) => error.includes("official duel leaf 826")));

  const overlap = structuredClone(coreRuleFamilies);
  overlap.families.push({
    ...structuredClone(overlap.families.find((family) => family.id === "keyword-backline")),
    id: "keyword-backline-duplicate"
  });
  assert.ok(validateRuleFamilies(overlap, coreRulesCatalog).some((error) => error.includes("multiple rule families")));

  const stale = structuredClone(coreRuleFamilies);
  stale.families[0].evidenceTests = ["this evidence test does not exist"];
  assert.ok(validateRuleFamilies(stale, coreRulesCatalog).some((error) => error.includes("references missing test")));
});

test("rules verification ledger opens training only after every duel workstream is verified", () => {
  assert.deepEqual(validateVerificationLedger(), []);
  assert.equal(verificationLedger.completionGate.readyForAiTraining, true);
  assert.ok(verificationLedger.verifiedMilestones.length > 0);
  assert.equal(verificationLedger.remainingWorkstreams.every((workstream) => workstream.status === "verified"), true);

  const missingFamily = structuredClone(verificationLedger);
  missingFamily.remainingWorkstreams[0].familyIds = missingFamily.remainingWorkstreams[0].familyIds.slice(1);
  assert.ok(validateVerificationLedger(missingFamily, coreRuleFamilies, coreRulesCatalog)
    .some((error) => error.includes("has no verification workstream")));

  const prematureGate = structuredClone(verificationLedger);
  prematureGate.remainingWorkstreams[0].status = "partial";
  assert.ok(validateVerificationLedger(prematureGate, coreRuleFamilies, coreRulesCatalog)
    .some((error) => error.includes("gate is open")));
});

test("turn and cleanup workstream ledger assigns every official leaf exactly once", () => {
  assert.deepEqual(validateWorkstreamLedger(), []);
  const assigned = turnTasksVerificationLedger.cases.flatMap((verificationCase) => verificationCase.ruleIds);
  assert.equal(assigned.length, 98);
  assert.equal(new Set(assigned).size, 98);

  const missingLeaf = structuredClone(turnTasksVerificationLedger);
  missingLeaf.cases[0].ruleIds = missingLeaf.cases[0].ruleIds.slice(1);
  assert.ok(validateWorkstreamLedger(missingLeaf, verificationLedger, coreRulesCatalog)
    .some((error) => error.includes("has no verification case")));
});

test("interpretation, deck construction, and setup ledger assigns every official leaf exactly once", () => {
  assert.deepEqual(validateWorkstreamLedger(interpretationSetupVerificationLedger), []);
  assert.equal(interpretationSetupVerificationLedger.cases.every((verificationCase) => verificationCase.status === "verified"), true);
});

test("Chain, Showdown, card play, and ability workstream ledger assigns every official leaf exactly once", () => {
  assert.deepEqual(validateWorkstreamLedger(chainsShowdownsVerificationLedger, verificationLedger, coreRulesCatalog), []);
  const assigned = chainsShowdownsVerificationLedger.cases.flatMap((verificationCase) => verificationCase.ruleIds);
  assert.equal(assigned.length, 285);
  assert.equal(new Set(assigned).size, 285);

  const overlappingLeaf = structuredClone(chainsShowdownsVerificationLedger);
  overlappingLeaf.cases[1].ruleIds.push(overlappingLeaf.cases[0].ruleIds[0]);
  assert.ok(validateWorkstreamLedger(overlappingLeaf, verificationLedger, coreRulesCatalog)
    .some((error) => error.includes("belongs to multiple cases")));
});

test("remaining duel workstream ledgers assign every official leaf exactly once", () => {
  for (const ledger of [
    objectsZonesVerificationLedger,
    coreActionsVerificationLedger,
    combatScoringVerificationLedger,
    keywordSemanticsVerificationLedger
  ]) {
    assert.deepEqual(validateWorkstreamLedger(ledger, verificationLedger, coreRulesCatalog), []);
    assert.equal(ledger.cases.every((verificationCase) => verificationCase.status === "verified"), true);
  }
});

test("every registered effect pair maps to official timing and semantic rule families", () => {
  const mappings = buildEffectRuleMap();
  assert.deepEqual(validateEffectRuleMap(mappings, coreRulesCatalog), []);
  assert.ok(mappings.every((entry) => entry.hasTimingFamily && entry.hasSemanticFamily));
  assert.ok(mappings.some((entry) => entry.effectKey === "keyword:quickDrawAttach"));
  assert.ok(mappings.some((entry) => entry.effectKey === "keyword:weaponmaster"));
  assert.ok(mappings.some((entry) => entry.effectKey === "keyword:huntGainXp"));
});

test("official Proving Grounds snapshot matches registered card definitions", () => {
  assert.deepEqual(comparePublishedCards(), []);
});

test("lethal threshold scenarios agree with the independent rules oracle", () => {
  for (const might of [1, 2, 3]) {
    const game = createGame({ interactive: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const target = instance(cards.lonelyPoro, opponent.id, `boundary-target-${might}`);
    const incinerate = instance(cards.incinerate, player.id, `boundary-incinerate-${might}`);
    target.might = might;
    const field = testBattlefield(`boundary-field-${might}`, [target], opponent.id);
    game.battlefields = [field];

    const expected = resolveCleanupReference({
      units: [{ id: target.instanceId, controllerId: opponent.id, might, damage: 2 }]
    });
    assert.equal(resolveEffect(game, player, incinerate), true);
    assert.equal(game.pendingChoice?.effect, "damageUnit");
    assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
    assert.equal(locate(game, target.instanceId), referenceZone(expected, target.instanceId), `Might ${might}, damage 2`);
  }
});

test("noncombat cleanup uses current Might and repeats after an aura leaves", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const commander = instance(cards.garenCommander, opponent.id, "noncombat-aura-commander");
  const target = instance(cards.lonelyPoro, opponent.id, "noncombat-aura-target");
  const incinerate = instance(cards.incinerate, player.id, "noncombat-aura-damage");
  const secondIncinerate = instance(cards.incinerate, player.id, "noncombat-aura-source-damage");
  game.battlefields = [testBattlefield("noncombat-aura-field", [commander, target], opponent.id)];

  const withAura = resolveCleanupReference({
    units: [
      { id: commander.instanceId, controllerId: opponent.id, might: 5, auraOtherFriendlyMight: 1 },
      { id: target.instanceId, controllerId: opponent.id, might: 2, damage: 2 }
    ]
  });
  assert.equal(resolveEffect(game, player, incinerate), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(locate(game, target.instanceId), referenceZone(withAura, target.instanceId));
  assert.equal(target.damage, 2);

  const withoutAura = resolveCleanupReference({
    units: [
      { id: commander.instanceId, controllerId: opponent.id, might: 5, zone: "trash", auraOtherFriendlyMight: 1 },
      { id: target.instanceId, controllerId: opponent.id, might: 2, damage: 2 }
    ]
  });
  commander.damage = 3;
  assert.equal(resolveEffect(game, player, secondIncinerate), true);
  assert.equal(chooseEffectOption(game, commander.instanceId).ok, true);
  assert.equal(locate(game, target.instanceId), referenceZone(withoutAura, target.instanceId));
  assert.equal(opponent.trash.some((card) => card.instanceId === target.instanceId), true);
});

test("semantic resolution oracle rejects undeclared damage recall", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const target = instance(cards.lonelyPoro, opponent.id, "illegal-recall-target");
  const field = testBattlefield("illegal-recall-field", [target], opponent.id);
  game.battlefields = [field];
  const contract = captureResolutionContract(game, { effect: "damageUnit", playerId: player.id }, target.instanceId);

  field.units = [];
  opponent.base.push(target);
  assert.throws(
    () => validateResolutionContract(game, contract, { ok: true }),
    /without a declared death-replacement effect/
  );
});

test("prepared death recall replaces killing without Deathknell", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const target = instance(cards.lonelyPoro, player.id, "highlander-deathknell-target");
  const highlander = instance(cards.highlander, player.id, "highlander-source");
  const incinerate = instance(cards.incinerate, player.id, "highlander-lethal-damage");
  const field = testBattlefield("highlander-field", [target], player.id);
  game.battlefields = [field];

  const expected = resolveCleanupReference({
    units: [{
      id: target.instanceId,
      controllerId: player.id,
      might: 2,
      damage: 2,
      hasDeathknell: true,
      replaceDeathWithRecall: true
    }]
  });
  const deckSizeBefore = player.mainDeck.length;

  assert.equal(resolveEffect(game, player, highlander), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(resolveEffect(game, player, incinerate), true);
  const contract = captureResolutionContract(game, game.pendingChoice, target.instanceId);
  const result = chooseEffectOption(game, target.instanceId);
  assert.equal(result.ok, true);
  assert.doesNotThrow(() => validateResolutionContract(game, contract, result));

  assert.equal(locate(game, target.instanceId), referenceZone(expected, target.instanceId));
  assert.equal(target.exhausted, true);
  assert.equal(player.trash.some((card) => card.instanceId === target.instanceId), false);
  assert.equal(player.mainDeck.length, deckSizeBefore, "Deathknell must not draw when death was replaced");
  assert.equal(expected.events.some((event) => event.kind === "deathknellCaptured"), false);
});

test("prepared death recall power payment is explicitly accepted or declined", () => {
  for (const decision of ["decline-death-recall", "pay-death-recall"]) {
    const game = createGame({ interactive: true });
    const player = game.players[0];
    const target = instance(cards.lonelyPoro, player.id, `powered-recall-${decision}`);
    const incinerate = instance(cards.incinerate, player.id, `powered-recall-damage-${decision}`);
    const furyRune = instance(makeRune(DOMAINS.FURY), player.id, `powered-recall-rune-${decision}`);
    player.runes = [furyRune];
    player.mainDeck = [instance(cards.scuttleCrab, player.id, `powered-recall-draw-${decision}`)];
    target.saveWithRuneUntilTurnSequence = game.turnSequence || 0;
    target.saveWithRuneDomain = "Fury";
    target.saveWithRuneSourceName = "Unlicensed Armory";
    game.battlefields = [testBattlefield(`powered-recall-field-${decision}`, [target], player.id)];

    assert.equal(resolveEffect(game, player, incinerate), true);
    assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
    assert.equal(game.pendingChoice?.effect, "preparedDeathRecallPayment");
    assert.equal(locate(game, target.instanceId), "battlefield");
    assert.equal(chooseEffectOption(game, decision).ok, true);

    if (decision === "pay-death-recall") {
      assert.equal(locate(game, target.instanceId), "base");
      assert.equal(target.exhausted, true);
      assert.equal(player.runeDeck.some((card) => card.instanceId === furyRune.instanceId), true);
    } else {
      assert.equal(locate(game, target.instanceId), "trash");
      assert.equal(player.runes.some((card) => card.instanceId === furyRune.instanceId), true);
    }
  }
});

test("recall preserves damage, buffs, attachments, and exhaustion while returning to base", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const unit = instance(cards.lonelyPoro, player.id, "recall-state-unit");
  const gear = instance(cards.guardianAngel, player.id, "recall-state-gear");
  unit.damage = 1;
  unit.buffs = 1;
  unit.exhausted = true;
  unit.attachments = [gear];
  const field = testBattlefield("recall-state-field", [unit], player.id);
  game.battlefields = [field];
  const spell = instance({
    ...cards.flash,
    effects: [{ timing: "spell", kind: "returnUnitToBase", target: "friendlyBattlefield" }]
  }, player.id, "recall-state-spell");

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);

  assert.equal(field.units.some((card) => card.instanceId === unit.instanceId), false);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(unit.damage, 1);
  assert.equal(unit.buffs, 1);
  assert.equal(unit.exhausted, true);
  assert.deepEqual(unit.attachments.map((card) => card.instanceId), [gear.instanceId]);
});

test("Core Rules runtime oracle rejects representative illegal states", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const foreignControlled = instance(cards.lonelyPoro, player.id, "oracle-foreign-base");
  foreignControlled.controllerId = opponent.id;
  player.base = [foreignControlled];

  const result = evaluateRuleState(game);
  assert.equal(result.violations.some((violation) => violation.checkId === "base-control"), true);
});

test("Core Rules runtime oracle rejects illegal zone, player, chain, attachment, and numeric states", () => {
  const cases = [
    ["zone-type", (game) => game.players[0].hand.push(instance(makeRune(DOMAINS.CALM), game.players[0].id, "oracle-rune-in-hand"))],
    ["player-reference", (game) => { game.players[0].base[0].controllerId = "missing-player"; }],
    ["chain-state", (game) => {
      game.phase = "showdown";
      game.actionChain = { chain: [], priorityPlayerId: game.players[0].id };
      game.showdown = { chain: [], battlefieldId: "oracle-chain-field", priorityPlayerId: game.players[0].id };
    }],
    ["attachment-state", (game) => {
      game.players[0].hand[0].attachments = [instance(cards.trinityForce, game.players[0].id, "oracle-orphaned-attachment")];
    }],
    ["numeric-state", (game) => { game.players[0].xp = -1; }]
    ,["delayed-ability-state", (game) => {
      game.delayedAbilities = [{
        id: "oracle-invalid-delayed",
        abilityClass: "triggered",
        condition: "unitTakesDamage",
        controllerId: "missing-player",
        createdTurnSequence: game.turnSequence || 0,
        expiresAfterTurnSequence: game.turnSequence || 0,
        targetId: "oracle-missing-target"
      }];
    }]
    ,["replacement-event-state", (game) => {
      game.players[0].base[0].lastReplacementEvent = {
        rootEventId: "oracle-replacement-root",
        eventId: "oracle-replacement-event",
        appliedReplacementKeys: ["same-source", "same-source"],
        modifications: {}
      };
    }]
    ,["cleanup-request-state", (game) => {
      game.cleanupOutstanding = true;
      game.cleanupRequestTrace = [{
        sequence: 1,
        ruleId: "319.8",
        cause: "object-status-change",
        duringCleanup: false,
        duringResolution: false
      }];
    }]
  ];

  for (const [checkId, mutate] of cases) {
    const game = createGame({ interactive: true });
    const player = game.players[0];
    player.base = [instance(cards.lonelyPoro, player.id, `oracle-${checkId}-base`)];
    player.hand = [instance(cards.charm, player.id, `oracle-${checkId}-hand`)];
    mutate(game);
    assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === checkId), true, checkId);
  }
});

test("Chain oracle rejects stable Pending Items and incorrect newest-controller Priority", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  game.phase = "action";
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 0,
    chain: [{ id: "oracle-pending", playerId: player.id, status: "pending" }]
  };
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "chain-state"), true);

  game.actionChain.chain[0].status = "finalized";
  assert.equal(evaluateRuleState(game).violations.some((violation) =>
    violation.checkId === "chain-state" && violation.details?.expectedPriorityPlayerId === player.id), true);

  game.actionChain.priorityPlayerId = player.id;
  assert.equal(evaluateRuleState(game).violations.some((violation) =>
    violation.checkId === "chain-state" && violation.details?.expectedPriorityPlayerId), false);
});

test("Chain finalization and post-resolution Priority follow the independent FEPR model", () => {
  const finalizationGame = createGame();
  const creator = finalizationGame.players[0];
  const nextPlayer = finalizationGame.players[1];
  const spell = instance({
    ...cards.incinerate,
    id: "TEST-FEPR-FINALIZE",
    name: "Rules Test FEPR Spell",
    energy: 0,
    power: [],
    tags: ["Action"],
    effects: []
  }, creator.id, "fepr-finalize-spell");
  creator.hand = [spell];
  finalizationGame.battlefields = [testBattlefield("fepr-finalize-field", [], null)];
  finalizationGame.phase = "showdown";
  finalizationGame.currentPlayerId = creator.id;
  finalizationGame.showdown = {
    battlefieldId: finalizationGame.battlefields[0].instanceId,
    turnPlayerId: creator.id,
    attackerId: creator.id,
    defenderId: nextPlayer.id,
    focusPlayerId: creator.id,
    priorityPlayerId: creator.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(playCard(finalizationGame, spell.instanceId, "base").ok, true);
  const finalized = resolveChainTransitionReference("finalize", {
    items: [{ playerId: creator.id, status: "pending" }],
    focusPlayerId: creator.id
  });
  assert.deepEqual(finalizationGame.showdown.chain.map((item) => item.status), finalized.items.map((item) => item.status));
  assert.equal(finalizationGame.showdown.priorityPlayerId, finalized.priorityPlayerId);

  const resolutionGame = createGame();
  const turnPlayer = resolutionGame.players[0];
  const otherPlayer = resolutionGame.players[1];
  const bottom = instance({ ...cards.incinerate, effects: [] }, otherPlayer.id, "fepr-bottom");
  const top = instance({ ...cards.incinerate, effects: [] }, turnPlayer.id, "fepr-top");
  resolutionGame.battlefields = [testBattlefield("fepr-resolve-field", [], null)];
  resolutionGame.phase = "showdown";
  resolutionGame.currentPlayerId = otherPlayer.id;
  resolutionGame.showdown = {
    battlefieldId: resolutionGame.battlefields[0].instanceId,
    turnPlayerId: turnPlayer.id,
    attackerId: turnPlayer.id,
    defenderId: otherPlayer.id,
    focusPlayerId: turnPlayer.id,
    priorityPlayerId: otherPlayer.id,
    consecutivePasses: 1,
    chain: [
      { id: "fepr-bottom-item", itemType: "card", card: bottom, playerId: otherPlayer.id, destination: "base", status: "finalized" },
      { id: "fepr-top-item", itemType: "card", card: top, playerId: turnPlayer.id, destination: "base", status: "finalized" }
    ]
  };
  resolutionGame.ruleTaskTrace = [];
  const resolved = resolveChainTransitionReference("resolve", {
    items: resolutionGame.showdown.chain,
    focusPlayerId: turnPlayer.id,
    nextPlayerId: otherPlayer.id
  });

  assert.equal(passShowdown(resolutionGame, otherPlayer.id).ok, true);
  assert.deepEqual(resolutionGame.showdown.chain.map((item) => item.id), resolved.items.map((item) => item.id));
  assert.equal(resolutionGame.showdown.focusPlayerId, resolved.focusPlayerId);
  assert.equal(resolutionGame.showdown.priorityPlayerId, resolved.priorityPlayerId);
  assert.equal(resolutionGame.ruleTaskTrace
    .filter((entry) => entry.ruleId === "323.1")
    .some((entry) => entry.resolvingChainContext || entry.resolvingGameEffect), false,
  "Cleanup may run only after the resolving Chain Item has completed in its entirety.");
});

test("Units and Gear resolve during Finalize without waiting for the Pass step", () => {
  const game = createGame();
  const player = game.players[0];
  const opponent = game.players[1];
  const field = testBattlefield("finalize-permanent-field", [], null);
  const gear = instance({
    ...cards.trinityForce,
    id: "TEST-FINALIZE-GEAR",
    name: "Rules Test Finalize Gear",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: [],
    effects: []
  }, player.id, "finalize-reaction-gear");
  game.battlefields = [field];
  player.hand = [gear];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  const expected = resolveChainTransitionReference("finalize", {
    items: [{ id: gear.instanceId, playerId: player.id, status: "pending", resolvesOnFinalize: true }],
    focusPlayerId: player.id,
    nextPlayerId: opponent.id
  });

  assert.equal(playCard(game, gear.instanceId, "base").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === gear.instanceId), true);
  assert.deepEqual(game.showdown.chain, expected.items);
  assert.equal(game.showdown.focusPlayerId, expected.focusPlayerId);
  assert.equal(game.showdown.priorityPlayerId, expected.priorityPlayerId);
});

test("Finalize repeats when an immediately played Unit creates a Pending trigger", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const field = testBattlefield("finalize-repeat-field", [], null);
  const unit = instance({
    ...cards.lonelyPoro,
    id: "TEST-FINALIZE-REPEAT-UNIT",
    name: "Rules Test Finalize Repeat Unit",
    energy: 0,
    power: [],
    might: 5,
    tags: ["Reaction"],
    effects: []
  }, player.id, "finalize-repeat-unit");
  player.legend = instance(cards.volibearRelentlessStorm, player.id, "finalize-repeat-legend");
  player.hand = [unit];
  game.battlefields = [field];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };

  assert.equal(playCard(game, unit.instanceId, "base").ok, true);
  assert.equal(player.base.some((card) => card.instanceId === unit.instanceId), true);
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.showdown.chain[0].status, "pending");
  assert.equal(game.pendingChoice.effect, "declareTriggerCost");
  assert.equal(chooseEffectOption(game, "pay-trigger-cost").ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].itemType, "trigger");
  assert.equal(game.showdown.chain[0].status, "finalized");
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(game.showdown.focusPlayerId, player.id,
    "Focus does not pass while the Chain still contains the newly finalized trigger");
});

test("only Rune Pool Add effects use the immediate-Finalize ability classification", () => {
  const registeredSpecs = [
    ...Object.values(cards).flatMap((card) => card.effects || []),
    ...Object.values(OFFICIAL_TOKEN_DEFINITIONS).flatMap((card) => card.effects || [])
  ];
  const addSpecs = registeredSpecs.filter((spec) => effectDefinition(spec)?.addsResources);
  assert.ok(addSpecs.length > 0);
  assert.equal(addSpecs.every((spec) => ["addEnergy", "addPower"].includes(spec.kind)), true);
  assert.equal(addSpecs.some((spec) => spec.kind === "addPower"), true,
    "the official Gold token's universal Power is covered by the Add classification");
  assert.equal(addSpecs.every((spec) => effectDefinition(spec)?.resolvesOnFinalize), true);

  const channelSpec = cards.malzaharFanatic.effects.find((spec) => spec.kind === "killFriendlyPermanentChannelRune");
  assert.equal(effectDefinition(channelSpec)?.addsResources, false);
  assert.equal(effectDefinition(channelSpec)?.resolvesOnFinalize, false,
    "Channeling a Rune is not the Add action of putting resources into the Rune Pool");
});

test("an Add Reaction finalizes during payment without passing Priority or Focus", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const addSource = instance(cards.luxCrownguard, player.id, "add-finalize-lux");
  const payingSpell = instance({
    ...cards.flash,
    id: "TEST-ADD-FINALIZE-PAYMENT",
    name: "Rules Test Add Payment",
    energy: 2,
    power: [],
    effects: []
  }, player.id, "add-finalize-payment");
  const bottomSource = instance(cards.lonelyPoro, opponent.id, "add-finalize-bottom-source");
  const field = testBattlefield("add-finalize-field", [], null);
  player.base = [addSource];
  player.hand = [payingSpell];
  player.runes = [];
  game.battlefields = [field];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chainOpenedBy: "card",
    chain: [{ id: "add-finalize-bottom", itemType: "trigger", card: bottomSource, playerId: opponent.id, status: "finalized" }]
  };
  const existingChain = game.showdown;

  assert.equal(beginPlayCard(game, payingSpell.instanceId, "base").ok, true);
  assert.equal(game.pendingPayment.cardId, payingSpell.instanceId);
  const sequenceBeforeAdd = game.showdown.chainSequence;
  assert.equal(activateCard(game, addSource.instanceId).ok, true);
  assert.equal(game.showdown, existingChain);
  assert.equal(game.showdown.chainSequence, sequenceBeforeAdd + 1,
    "the immediately resolving Add ability still entered the existing Chain as a Pending item");
  assert.equal(game.showdown.chain.length, 2, "the transient Add item resolves without removing either existing Chain item");
  assert.equal(game.showdown.chain[0].id, "add-finalize-bottom");
  assert.equal(game.showdown.chain[1].card.instanceId, payingSpell.instanceId);
  assert.equal(game.showdown.chain[1].status, "pending");
  assert.equal(game.pendingPayment.cardId, payingSpell.instanceId, "the interrupted payment remains owned by the original card");
  assert.equal(player.runePool.energy.length, 2);
  assert.equal(game.showdown.focusPlayerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
});

test("adding a Chain Item resets prior passes before the next Pass cycle", () => {
  const game = createGame();
  const player = game.players[0];
  const opponent = game.players[1];
  const field = testBattlefield("pass-reset-field", [], null);
  const bottom = instance({ ...cards.incinerate, effects: [] }, player.id, "pass-reset-bottom");
  const reaction = instance({
    ...cards.incinerate,
    id: "TEST-PASS-RESET-REACTION",
    name: "Rules Test Pass Reset Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, opponent.id, "pass-reset-reaction");
  opponent.hand = [reaction];
  game.battlefields = [field];
  game.phase = "showdown";
  game.currentPlayerId = opponent.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chainOpenedBy: "card",
    chain: [{ id: "pass-reset-bottom-item", itemType: "card", card: bottom, playerId: player.id, destination: "base", status: "finalized" }]
  };

  assert.equal(playCard(game, reaction.instanceId, "base").ok, true);
  assert.equal(game.showdown.consecutivePasses, 0);
  assert.equal(game.showdown.priorityPlayerId, opponent.id);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.showdown.consecutivePasses, 1);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.priorityPlayerId, player.id);
});

test("Neutral and Showdown Chains require one uninterrupted all-player Pass cycle per resolved Item", () => {
  for (const kind of ["action", "showdown"]) {
    const game = createGame({ interactive: true, manualActionChainPriority: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const bottom = instance({ ...cards.incinerate, effects: [] }, player.id, `${kind}-pass-bottom`);
    const top = instance({ ...cards.incinerate, effects: [] }, opponent.id, `${kind}-pass-top`);
    const items = [
      { id: `${kind}-pass-bottom-item`, itemType: "card", card: bottom, playerId: player.id, destination: "base", status: "finalized" },
      { id: `${kind}-pass-top-item`, itemType: "card", card: top, playerId: opponent.id, destination: "base", status: "finalized" }
    ];
    const expected = resolvePassCycleReference({
      playerIds: [player.id, opponent.id],
      priorityPlayerId: player.id,
      items: items.map((item) => ({ id: item.id, playerId: item.playerId })),
      operations: [
        { kind: "pass", playerId: player.id },
        { kind: "pass", playerId: opponent.id }
      ]
    });

    game.phase = kind === "showdown" ? "showdown" : "action";
    game.currentPlayerId = player.id;
    if (kind === "showdown") {
      const field = testBattlefield(`${kind}-pass-field`, [], null);
      game.battlefields = [field];
      game.showdown = {
        battlefieldId: field.instanceId,
        turnPlayerId: player.id,
        attackerId: player.id,
        defenderId: opponent.id,
        focusPlayerId: player.id,
        priorityPlayerId: player.id,
        consecutivePasses: 0,
        chainSequence: 2,
        chainOpenedBy: "card",
        combat: false,
        chain: items
      };
    } else {
      const responseFor = (ownerId, id) => instance({
        ...cards.incinerate,
        id: `TEST-${id}`,
        name: id,
        energy: 0,
        power: [],
        tags: ["Reaction"],
        keywords: ["Reaction"],
        effects: []
      }, ownerId, id);
      player.hand = [responseFor(player.id, "action-pass-player-response")];
      opponent.hand = [responseFor(opponent.id, "action-pass-opponent-response")];
      game.actionChain = {
        turnPlayerId: player.id,
        playerIds: [player.id, opponent.id],
        priorityPlayerId: player.id,
        consecutivePasses: 0,
        chainSequence: 2,
        chain: items
      };
    }

    assert.equal(passShowdown(game, player.id).ok, true);
    const activeAfterFirstPass = kind === "showdown" ? game.showdown : game.actionChain;
    assert.equal(activeAfterFirstPass.chain.length, 2, `${kind} must not resolve after only one player's pass`);
    assert.equal(activeAfterFirstPass.priorityPlayerId, opponent.id);

    assert.equal(passShowdown(game, opponent.id).ok, true);
    const activeAfterCycle = kind === "showdown" ? game.showdown : game.actionChain;
    assert.deepEqual(activeAfterCycle.chain.map((item) => item.id), expected.items.map((item) => item.id));
    assert.deepEqual(expected.resolvedItemIds, [`${kind}-pass-top-item`]);
    assert.equal(activeAfterCycle.consecutivePasses, expected.consecutivePasses);
    assert.equal(activeAfterCycle.priorityPlayerId, expected.priorityPlayerId);
    if (kind === "showdown") assert.equal(activeAfterCycle.focusPlayerId, player.id);
  }
});

test("adding an Action Chain Item resets prior passes through the shared Pass-cycle contract", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const bottom = instance({ ...cards.incinerate, effects: [] }, player.id, "action-pass-reset-bottom");
  const reaction = instance({
    ...cards.incinerate,
    id: "TEST-ACTION-PASS-RESET-REACTION",
    name: "Rules Test Action Pass Reset Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"],
    effects: []
  }, opponent.id, "action-pass-reset-reaction");
  const backupReaction = (ownerId, id) => instance({
    ...reaction,
    id: `TEST-${id}`,
    name: id
  }, ownerId, id);
  opponent.hand = [reaction, backupReaction(opponent.id, "action-pass-reset-opponent-backup")];
  player.hand = [backupReaction(player.id, "action-pass-reset-player-backup")];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [{
      id: "action-pass-reset-bottom-item",
      itemType: "card",
      card: bottom,
      playerId: player.id,
      destination: "base",
      status: "finalized"
    }]
  };
  const expected = resolvePassCycleReference({
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    items: [{ id: "action-pass-reset-bottom-item", playerId: player.id }],
    operations: [
      { kind: "add", playerId: opponent.id, item: { id: "action-pass-reset-reaction-item", playerId: opponent.id } },
      { kind: "pass", playerId: opponent.id },
      { kind: "pass", playerId: player.id }
    ]
  });

  assert.equal(playCard(game, reaction.instanceId, "base").ok, true);
  const reactionItem = game.actionChain.chain.at(-1);
  assert.equal(game.actionChain.consecutivePasses, 0);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain.chain.length, 2, "the pass before the response must not count toward this cycle");
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(reactionItem.card.instanceId, reaction.instanceId);
  assert.deepEqual(game.actionChain.chain.map((item) => item.id), expected.items.map((item) => item.id));
  assert.equal(game.actionChain.consecutivePasses, expected.consecutivePasses);
  assert.equal(game.actionChain.priorityPlayerId, expected.priorityPlayerId);
});

test("registered play-timing exceptions route through one reviewed Reaction permission contract", () => {
  assert.deepEqual(CARD_REACTION_PERMISSION_KINDS, ["reaction", "quick-draw", "hidden", "ambush"]);

  const ordinary = { tags: [], keywords: [] };
  const reaction = { tags: ["Reaction"], keywords: ["Reaction"] };
  const quickDraw = { tags: [], keywords: ["Quick-Draw"] };
  const hidden = { tags: [], keywords: ["Hidden"] };
  const ambushWithReminderTag = { tags: ["Reaction"], keywords: ["Ambush"] };

  assert.deepEqual(cardReactionPermissionSources(ordinary), []);
  assert.deepEqual(cardReactionPermissionSources(reaction), ["reaction"]);
  assert.deepEqual(cardReactionPermissionSources(quickDraw), ["quick-draw"]);
  assert.deepEqual(cardReactionPermissionSources(hidden), [], "Hidden in hand is not itself Reaction timing");
  assert.deepEqual(cardReactionPermissionSources(hidden, { fromHidden: true }), ["hidden"]);
  assert.deepEqual(cardReactionPermissionSources(ambushWithReminderTag), [], "Ambush reminder metadata is not unconditional Reaction");
  assert.deepEqual(cardReactionPermissionSources(ambushWithReminderTag, { ambushDestinationEligible: true }), ["ambush"]);

  for (const card of Object.values(cards)) {
    const sources = cardReactionPermissionSources(card);
    assert.equal(sources.every((source) => CARD_REACTION_PERMISSION_KINDS.includes(source)), true, card.name);
  }
});

test("cards and abilities use every first and later two-player Execute window through Finalize", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const reactionCard = (ownerId, id) => instance({
    ...cards.incinerate,
    id: `TEST-${id}`,
    name: id,
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"],
    effects: []
  }, ownerId, id);
  const reactionAbilitySource = (ownerId, id) => instance({
    ...cards.lonelyPoro,
    id: `TEST-${id}`,
    name: id,
    effects: [{
      timing: "activated",
      kind: "draw",
      amount: 1,
      exhaust: false,
      abilityKeywords: ["Reaction"]
    }]
  }, ownerId, id);
  const bottom = instance({ ...cards.incinerate, effects: [] }, player.id, "execute-window-bottom");
  const response = reactionCard(player.id, "execute-window-response");
  const backup = reactionCard(player.id, "execute-window-backup");
  const illegalOrdinary = instance({ ...cards.incinerate, energy: 0, power: [], tags: [], keywords: [], effects: [] }, opponent.id, "execute-window-ordinary");
  const playerAbility = reactionAbilitySource(player.id, "execute-window-player-ability");
  const opponentAbility = reactionAbilitySource(opponent.id, "execute-window-opponent-ability");
  player.hand = [response, backup];
  opponent.hand = [illegalOrdinary];
  player.base = [playerAbility];
  opponent.base = [opponentAbility];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{
      id: "execute-window-bottom-item",
      itemType: "card",
      card: bottom,
      playerId: player.id,
      destination: "base",
      status: "finalized"
    }]
  };
  const expected = resolveExecuteWindowReference({
    playerIds: [player.id, opponent.id],
    priorityPlayerId: player.id,
    items: [{ id: "bottom", itemType: "card", playerId: player.id, status: "finalized" }],
    operations: [
      { kind: "card", id: "same-player-card", playerId: player.id, legallyTimed: true },
      { kind: "activated", id: "same-player-ability", playerId: player.id, legallyTimed: true },
      { kind: "pass", playerId: player.id },
      { kind: "activated", id: "other-player-ability", playerId: opponent.id, legallyTimed: true },
      { kind: "pass", playerId: opponent.id }
    ]
  });

  assert.equal(playCard(game, response.instanceId, "base").ok, true, "the Chain creator may add another card before passing");
  assert.equal(game.actionChain.priorityPlayerId, player.id);
  assert.equal(activateCard(game, playerAbility.instanceId).ok, true, "the same first Execute window remains available for an ability");
  assert.equal(game.actionChain.priorityPlayerId, player.id);
  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(playCard(game, illegalOrdinary.instanceId, "base").ok, false, "a later Execute window still requires Reaction timing");
  assert.equal(activateCard(game, opponentAbility.instanceId).ok, true);
  assert.equal(game.actionChain.priorityPlayerId, opponent.id);
  assert.equal(passShowdown(game, opponent.id).ok, true);

  assert.deepEqual(game.actionChain.chain.map((item) => item.itemType), expected.items.map((item) => item.itemType));
  assert.deepEqual(game.actionChain.chain.map((item) => item.playerId), expected.items.map((item) => item.playerId));
  assert.equal(game.actionChain.chain.every((item) => item.status === "finalized"), true);
  assert.equal(game.actionChain.consecutivePasses, expected.consecutivePasses);
  assert.equal(game.actionChain.priorityPlayerId, expected.priorityPlayerId);
  assert.deepEqual(expected.trace, [
    "execute:card", "append:pending", "return:finalize",
    "execute:activated", "append:pending", "return:finalize",
    "execute:pass", "pass:next-player",
    "execute:activated", "append:pending", "return:finalize",
    "execute:pass", "pass:next-player"
  ]);
});

test("a Pending trigger created during Resolve re-enters Finalize before the next Execute window", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const lux = instance(cards.luxIlluminated, player.id, "resolve-pending-lux");
  const bottom = instance({ ...cards.incinerate, effects: [] }, opponent.id, "resolve-pending-bottom");
  const top = instance({ ...cards.incinerate, energy: 5, effects: [] }, player.id, "resolve-pending-top");
  const backup = instance({
    ...cards.incinerate,
    id: "TEST-RESOLVE-PENDING-BACKUP",
    name: "Rules Test Resolve Pending Backup",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"],
    effects: []
  }, player.id, "resolve-pending-backup");
  player.base = [lux];
  player.hand = [backup];
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: opponent.id,
    consecutivePasses: 1,
    chainSequence: 2,
    chain: [
      { id: "resolve-pending-bottom-item", itemType: "card", card: bottom, playerId: opponent.id, destination: "base", status: "finalized" },
      { id: "resolve-pending-top-item", itemType: "card", card: top, playerId: player.id, destination: "base", status: "finalized" }
    ]
  };
  const expected = resolvePostResolutionReference({
    items: [
      { id: "bottom", itemType: "card", playerId: opponent.id, status: "finalized" },
      { id: "top", itemType: "card", playerId: player.id, status: "finalized" }
    ],
    createdItems: [{ id: "lux-trigger", itemType: "trigger", playerId: player.id }]
  });

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(player.trash.some((card) => card.instanceId === top.instanceId), true);
  assert.equal(lux.temporaryMight || 0, 0, "the new trigger must not resolve in the completed top Item's Resolve step");
  assert.deepEqual(game.actionChain.chain.map((item) => item.itemType), expected.items.map((item) => item.itemType));
  assert.deepEqual(game.actionChain.chain.map((item) => item.playerId), expected.items.map((item) => item.playerId));
  assert.equal(game.actionChain.chain.every((item) => item.status === "finalized"), true);
  assert.equal(game.actionChain.priorityPlayerId, expected.priorityPlayerId);
  assert.deepEqual(expected.trace, ["resolve:newest", "execute:entire-effect", "append:pending", "return:finalize"]);
});

test("a trigger created inside an unfinished game effect is already Pending but defers its choices", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const jewel = instance(cards.frigidJewel, player.id, "enclosing-effect-jewel");
  const target = instance(cards.lonelyPoro, player.id, "enclosing-effect-target");
  const parent = instance({
    ...cards.findYourCenter,
    name: "Rules Test Enclosing Effect",
    effects: [
      { timing: "spell", kind: "draw", amount: 3 },
      { timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 1 }
    ]
  }, player.id, "enclosing-effect-parent");
  player.base = [jewel, target];
  player.hand = [];
  player.mainDeck = [
    instance(cards.charm, player.id, "enclosing-effect-draw-1"),
    instance(cards.gust, player.id, "enclosing-effect-draw-2"),
    instance(cards.flash, player.id, "enclosing-effect-draw-3")
  ];
  player.drawCountThisTurn = 0;
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{
      id: "enclosing-effect-bottom",
      itemType: "trigger",
      card: instance(cards.lonelyPoro, opponent.id, "enclosing-effect-bottom-source"),
      playerId: opponent.id,
      status: "finalized"
    }]
  };
  game.resolvingChainContext = "action";

  assert.equal(resolveEffect(game, player, parent), true);
  assert.equal(game.pendingChoice.effect, "modifyMight",
    "the enclosing effect continues instead of making the trigger's target choice");
  const pendingTrigger = game.actionChain.chain.find((item) => item.itemType === "trigger" && item.playerId === player.id);
  assert.ok(pendingTrigger, "rule 401.1 adds the trigger representation before the parent effect finishes");
  assert.equal(pendingTrigger.status, "pending");
  assert.equal(pendingTrigger.playOptions.declarationsComplete, false);
});

test("standard and effect movement give Showdown Focus to the player who applied Contested", () => {
  const scenarios = [
    { id: "uncontrolled", effectMove: false, controlled: false, enemyPresent: false },
    { id: "controlled-enemy", effectMove: false, controlled: true, enemyPresent: true },
    { id: "effect-controlled-enemy", effectMove: true, controlled: true, enemyPresent: true }
  ];

  for (const scenario of scenarios) {
    const game = createGame({ interactive: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const unit = instance(cards.lonelyPoro, player.id, `${scenario.id}-attacker`);
    const enemy = instance(cards.ravenbloomStudent, opponent.id, `${scenario.id}-defender`);
    const destination = testBattlefield(`${scenario.id}-destination`, scenario.enemyPresent ? [enemy] : [], scenario.controlled ? opponent.id : null);
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.battlefields = [destination];
    player.base = [unit];

    if (scenario.effectMove) {
      const source = testBattlefield(`${scenario.id}-source`, [unit], player.id);
      game.battlefields.unshift(source);
      player.base = [];
      assert.equal(resolveEffect(game, player, instance(cards.rideTheWind, player.id, `${scenario.id}-ride`)), true);
      assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
      assert.equal(chooseEffectOption(game, destination.instanceId).ok, true);
    } else {
      assert.equal(moveUnit(game, unit.instanceId, destination.instanceId).ok, true);
    }

    const expected = referenceShowdownOpening({
      neutralOpen: true,
      contestedAppliedBy: player.id,
      battlefieldControllerId: scenario.controlled ? opponent.id : null,
      unitControllerIds: [player.id, ...(scenario.enemyPresent ? [opponent.id] : [])]
    });
    assert.equal(game.showdown != null, expected.opens, scenario.id);
    assert.equal(game.showdown?.combat, expected.combat, scenario.id);
    assert.equal(game.showdown?.focusPlayerId, expected.focusPlayerId, scenario.id);
    assert.equal(game.showdown?.priorityPlayerId, expected.priorityPlayerId, scenario.id);
  }
});

test("Showdown exit Cleanup precedes Combat and Conquer settlement", () => {
  const makeShowdown = ({ combat, attacker, defender, field }) => {
    const game = createGame({ interactive: true });
    const player = game.players[0];
    const opponent = game.players[1];
    game.battlefields = [field];
    game.phase = "showdown";
    game.currentPlayerId = player.id;
    game.showdown = {
      battlefieldId: field.instanceId,
      turnPlayerId: player.id,
      attackerId: player.id,
      defenderId: opponent.id,
      combat,
      focusPlayerId: player.id,
      priorityPlayerId: player.id,
      consecutivePasses: 0,
      chainSequence: 0,
      chain: []
    };
    attacker.combatRole = combat ? "attacker" : undefined;
    if (defender) defender.combatRole = combat ? "defender" : undefined;
    return { game, player, opponent };
  };

  const noncombatAttacker = instance(cards.lonelyPoro, "p1", "showdown-exit-lethal-attacker");
  noncombatAttacker.damage = noncombatAttacker.might;
  const noncombatField = testBattlefield("showdown-exit-noncombat", [noncombatAttacker], null);
  noncombatField.contestedBy = "p1";
  const noncombat = makeShowdown({ combat: false, attacker: noncombatAttacker, defender: null, field: noncombatField });
  const noncombatExpected = referenceShowdownExit({
    combat: false,
    attackerId: noncombat.player.id,
    defenderId: noncombat.opponent.id,
    controlledBy: null,
    units: [{
      id: noncombatAttacker.instanceId,
      controllerId: noncombat.player.id,
      might: noncombatAttacker.might,
      damage: noncombatAttacker.damage
    }]
  });

  assert.equal(passShowdown(noncombat.game, noncombat.player.id).ok, true);
  assert.equal(noncombat.game.showdown.focusPlayerId, noncombat.opponent.id, "the first empty Pass transfers Focus");
  assert.equal(noncombat.game.showdown.priorityPlayerId, noncombat.opponent.id);
  assert.equal(passShowdown(noncombat.game, noncombat.opponent.id).ok, true);

  assert.equal(noncombat.game.showdownExitProcess, undefined);
  assert.equal(locate(noncombat.game, noncombatAttacker.instanceId), "trash");
  assert.deepEqual(noncombatField.units.map((unit) => unit.instanceId), noncombatExpected.survivors);
  assert.equal(noncombatField.controlledBy, noncombatExpected.controlledBy);
  assert.equal(noncombat.player.score, 0, "a lethally damaged unit cannot Conquer before exit Cleanup kills it");

  const combatAttacker = instance(cards.lonelyPoro, "p1", "showdown-exit-combat-attacker");
  combatAttacker.damage = combatAttacker.might;
  const combatDefender = instance(cards.stalwartPoro, "p2", "showdown-exit-combat-defender");
  const combatField = testBattlefield("showdown-exit-combat", [combatAttacker, combatDefender], "p2");
  combatField.contestedBy = "p1";
  const combatState = makeShowdown({ combat: true, attacker: combatAttacker, defender: combatDefender, field: combatField });
  const combatExpected = referenceShowdownExit({
    combat: true,
    attackerId: combatState.player.id,
    defenderId: combatState.opponent.id,
    controlledBy: combatState.opponent.id,
    units: [
      { id: combatAttacker.instanceId, controllerId: combatState.player.id, might: combatAttacker.might, damage: combatAttacker.damage },
      { id: combatDefender.instanceId, controllerId: combatState.opponent.id, might: combatDefender.might, damage: 0 }
    ]
  });

  assert.equal(passShowdown(combatState.game, combatState.player.id).ok, true);
  assert.equal(passShowdown(combatState.game, combatState.opponent.id).ok, true);

  assert.equal(combatExpected.next, "action");
  assert.deepEqual(combatField.units.map((unit) => unit.instanceId), combatExpected.survivors);
  assert.equal(combatDefender.damage, 0, "the dead attacker never reaches Combat damage");
  assert.equal(combatDefender.combatRole, undefined);
  assert.equal(combatField.controlledBy, combatExpected.controlledBy);
  assert.equal(combatState.game.stagedEvents.length, 0, "exit Cleanup cannot restage the Showdown being completed");
  assert.equal(combatState.game.phase, "action");
  assert.equal(evaluateRuleState(combatState.game).violations.some((violation) => violation.checkId === "turn-task-continuation"), false);
});

test("an Add ability that opens and empties its transient Showdown Chain does not pass Focus", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const addSource = instance(cards.luxCrownguard, player.id, "showdown-add-focus-source");
  const field = testBattlefield("showdown-add-focus-field", [], null);
  player.base = [addSource];
  game.battlefields = [field];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    combat: false,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(activateCard(game, addSource.instanceId).ok, true);
  assert.equal(game.showdown.chain.length, 0);
  assert.equal(game.showdown.focusPlayerId, player.id);
  assert.equal(game.showdown.priorityPlayerId, player.id);
  assert.equal(game.currentPlayerId, player.id);
});

test("card categories follow the independent Neutral/Showdown Open/Closed permission matrix", () => {
  const states = [
    { id: "neutral-open", state: "neutral", chainExists: false, hasPriority: true, hasFocus: true },
    { id: "neutral-closed", state: "neutral", chainExists: true, hasPriority: true, hasFocus: true },
    { id: "showdown-open", state: "showdown", chainExists: false, hasPriority: true, hasFocus: true },
    { id: "showdown-closed", state: "showdown", chainExists: true, hasPriority: true, hasFocus: false },
    { id: "showdown-open-without-focus", state: "showdown", chainExists: false, hasPriority: true, hasFocus: false },
    { id: "showdown-without-priority", state: "showdown", chainExists: false, hasPriority: false, hasFocus: true }
  ];
  const timings = ["ordinary", "action", "reaction"];
  const categories = ["unit", "gear", "spell"];

  for (const state of states) {
    for (const timing of timings) {
      for (const category of categories) {
        const game = createGame({ interactive: true, manualActionChainPriority: true });
        const player = game.players[0];
        const opponent = game.players[1];
        const card = instance({
          id: `TEST-PERMISSION-${state.id}-${timing}-${category}`,
          cardNumber: `TEST-PERMISSION-${state.id}-${timing}-${category}`,
          name: `Rules ${timing} ${category}`,
          type: category,
          tags: timing === "ordinary" ? [] : [timing === "action" ? "Action" : "Reaction"],
          keywords: timing === "ordinary" ? [] : [timing === "action" ? "Action" : "Reaction"],
          energy: 0,
          power: [],
          might: category === "unit" ? 1 : undefined,
          effects: []
        }, player.id, `permission-${state.id}-${timing}-${category}`);
        const field = testBattlefield(`permission-field-${state.id}-${timing}-${category}`, [], null);
        player.hand = [card];
        game.battlefields = [field];
        game.currentPlayerId = player.id;
        if (state.state === "showdown") {
          game.phase = "showdown";
          game.showdown = {
            battlefieldId: field.instanceId,
            turnPlayerId: player.id,
            attackerId: player.id,
            defenderId: opponent.id,
            focusPlayerId: state.hasFocus ? player.id : opponent.id,
            priorityPlayerId: state.hasPriority ? player.id : opponent.id,
            consecutivePasses: 0,
            chainSequence: state.chainExists ? 1 : 0,
            chain: state.chainExists
              ? [{ id: `permission-showdown-item-${state.id}-${timing}-${category}`, itemType: "trigger", card: instance(cards.lonelyPoro, opponent.id, `permission-showdown-source-${state.id}-${timing}-${category}`), playerId: opponent.id, status: "finalized" }]
              : []
          };
        } else {
          game.phase = "action";
          game.actionChain = state.chainExists ? {
            turnPlayerId: player.id,
            playerIds: [player.id, opponent.id],
            priorityPlayerId: player.id,
            consecutivePasses: 0,
            chainSequence: 1,
            chain: [{ id: `permission-action-item-${timing}-${category}`, itemType: "trigger", card: instance(cards.lonelyPoro, opponent.id, `permission-action-source-${timing}-${category}`), playerId: opponent.id, status: "finalized" }]
          } : null;
        }
        const expected = referenceOpportunityPermission({ ...state, timing });
        const result = beginPlayCard(game, card.instanceId, "base");
        assert.equal(result.ok, expected, `${state.id}: ${timing} ${category}`);
      }
    }
  }
});

test("activated abilities follow the same independent state permission matrix as cards", () => {
  const states = [
    { id: "neutral-open", state: "neutral", chainExists: false, hasPriority: true, hasFocus: true },
    { id: "neutral-closed", state: "neutral", chainExists: true, hasPriority: true, hasFocus: true },
    { id: "showdown-open", state: "showdown", chainExists: false, hasPriority: true, hasFocus: true },
    { id: "showdown-closed", state: "showdown", chainExists: true, hasPriority: true, hasFocus: false },
    { id: "showdown-open-without-focus", state: "showdown", chainExists: false, hasPriority: true, hasFocus: false },
    { id: "showdown-without-priority", state: "showdown", chainExists: false, hasPriority: false, hasFocus: true }
  ];

  for (const state of states) {
    for (const timing of ["ordinary", "action", "reaction"]) {
      const game = createGame({ interactive: true, manualActionChainPriority: true });
      const player = game.players[0];
      const opponent = game.players[1];
      const source = instance({
        id: `TEST-ABILITY-PERMISSION-${state.id}-${timing}`,
        cardNumber: `TEST-ABILITY-PERMISSION-${state.id}-${timing}`,
        name: `Rules ${timing} ability source`,
        type: "gear",
        tags: [],
        keywords: [],
        energy: 0,
        power: [],
        effects: [{
          timing: "activated",
          kind: "nextSpellBonusDamage",
          amount: 1,
          exhaustSelf: true,
          ...(timing === "ordinary" ? {} : { abilityKeywords: [timing === "action" ? "Action" : "Reaction"] })
        }]
      }, player.id, `ability-permission-${state.id}-${timing}`);
      const field = testBattlefield(`ability-permission-field-${state.id}-${timing}`, [], null);
      player.base = [source];
      game.battlefields = [field];
      game.currentPlayerId = player.id;
      if (state.state === "showdown") {
        game.phase = "showdown";
        game.showdown = {
          battlefieldId: field.instanceId,
          turnPlayerId: player.id,
          attackerId: player.id,
          defenderId: opponent.id,
          focusPlayerId: state.hasFocus ? player.id : opponent.id,
          priorityPlayerId: state.hasPriority ? player.id : opponent.id,
          consecutivePasses: 0,
          chainSequence: state.chainExists ? 1 : 0,
          chain: state.chainExists
            ? [{ id: `ability-showdown-item-${state.id}-${timing}`, itemType: "trigger", card: instance(cards.lonelyPoro, opponent.id, `ability-showdown-source-${state.id}-${timing}`), playerId: opponent.id, status: "finalized" }]
            : []
        };
      } else {
        game.phase = "action";
        game.actionChain = state.chainExists ? {
          turnPlayerId: player.id,
          playerIds: [player.id, opponent.id],
          priorityPlayerId: player.id,
          consecutivePasses: 0,
          chainSequence: 1,
          chain: [{ id: `ability-action-item-${timing}`, itemType: "trigger", card: instance(cards.lonelyPoro, opponent.id, `ability-action-source-${timing}`), playerId: opponent.id, status: "finalized" }]
        } : null;
      }
      const expected = referenceOpportunityPermission({ ...state, timing });
      const result = activateCard(game, source.instanceId);
      assert.equal(result.ok, expected, `${state.id}: ${timing} ability`);
    }
  }
});

test("direct and interactive card entry points share the Closed-state Reaction gate", () => {
  const game = createGame({ manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const ordinary = instance({ ...cards.charm, energy: 0, power: [], effects: [] }, player.id, "direct-closed-ordinary");
  const reaction = instance({ ...cards.flash, energy: 0, power: [], effects: [] }, player.id, "direct-closed-reaction");
  player.hand = [ordinary, reaction];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{ id: "direct-closed-bottom", itemType: "trigger", card: instance(cards.lonelyPoro, opponent.id, "direct-closed-source"), playerId: opponent.id, status: "finalized" }]
  };

  assert.deepEqual(legalCardPlayDestinations(game, ordinary.instanceId), []);
  assert.equal(playCard(game, ordinary.instanceId, "base").ok, false);
  assert.equal(player.hand.some((card) => card.instanceId === ordinary.instanceId), true);
  assert.equal(playCard(game, reaction.instanceId, "base").ok, true);
  assert.equal(game.actionChain.chain.some((item) => item.card?.instanceId === reaction.instanceId), true);
});

test("a Pending card keeps Priority with its controller before Finalize", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const reaction = instance({
    ...cards.flash,
    id: "TEST-PENDING-PRIORITY-REACTION",
    name: "Rules Test Pending Priority Reaction",
    energy: 1,
    power: [],
    effects: []
  }, player.id, "pending-priority-reaction");
  player.hand = [reaction];
  player.runes = [instance(makeRune(DOMAINS.CALM), player.id, "pending-priority-rune")];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{
      id: "pending-priority-bottom",
      itemType: "trigger",
      card: instance(cards.lonelyPoro, opponent.id, "pending-priority-source"),
      playerId: opponent.id,
      status: "finalized"
    }]
  };

  assert.equal(beginPlayCard(game, reaction.instanceId, "base").ok, true);
  assert.equal(game.pendingPayment?.cardId, reaction.instanceId);
  assert.equal(game.actionChain.chain.at(-1).status, "pending");
  assert.equal(game.actionChain.priorityPlayerId, player.id);
});

test("cards, abilities, and their triggers join the one existing Chain", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const bottomSource = instance(cards.lonelyPoro, opponent.id, "single-chain-bottom-source");
  const reactionUnit = instance({
    ...cards.lonelyPoro,
    id: "TEST-SINGLE-CHAIN-REACTION-UNIT",
    name: "Rules Test Single Chain Unit",
    energy: 0,
    power: [],
    might: 5,
    tags: ["Reaction"],
    effects: []
  }, player.id, "single-chain-reaction-unit");
  const reactionAbility = instance({
    id: "TEST-SINGLE-CHAIN-REACTION-ABILITY",
    cardNumber: "TEST-SINGLE-CHAIN-REACTION-ABILITY",
    name: "Rules Test Single Chain Ability",
    type: "gear",
    tags: [],
    keywords: [],
    energy: 0,
    power: [],
    effects: [{
      timing: "activated",
      kind: "nextSpellBonusDamage",
      amount: 1,
      abilityKeywords: ["Reaction"]
    }]
  }, player.id, "single-chain-reaction-ability");
  const mover = instance(cards.lonelyPoro, player.id, "single-chain-mover");
  player.legend = instance(cards.volibearRelentlessStorm, player.id, "single-chain-volibear");
  player.hand = [reactionUnit];
  player.base = [reactionAbility, mover];
  const field = testBattlefield("single-chain-field", [instance(cards.lonelyPoro, opponent.id, "single-chain-defender")], opponent.id);
  game.battlefields = [field];
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: [player.id, opponent.id],
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 1,
    chain: [{ id: "single-chain-bottom", itemType: "trigger", card: bottomSource, playerId: opponent.id, status: "finalized" }]
  };
  const existingChain = game.actionChain;
  const expected = referenceSingleChainPlacement({
    existingChainId: "neutral-chain",
    entries: ["card", "trigger", "ability"]
  });

  assert.equal(playCard(game, reactionUnit.instanceId, "base").ok, true);
  assert.equal(game.actionChain, existingChain, "the Reaction Unit and its play trigger must reuse the existing Chain object");
  assert.equal(game.pendingChoice.effect, "declareOptionalTrigger");
  assert.equal(chooseEffectOption(game, "use-optional-trigger").ok, true);
  assert.equal(game.pendingChoice.effect, "declareTriggerCost");
  assert.equal(chooseEffectOption(game, "pay-trigger-cost").ok, true);
  assert.equal(game.actionChain.chain.some((item) => item.itemType === "trigger" && item.playerId === player.id), true);

  assert.equal(activateCard(game, reactionAbility.instanceId).ok, true);
  assert.equal(game.actionChain, existingChain, "the Reaction ability must reuse the existing Chain object");
  assert.equal(game.actionChain.chain.some((item) => item.itemType === "activated" && item.playerId === player.id), true);
  assert.equal(Number(Boolean(game.actionChain)) + Number(Boolean(game.showdown)), expected.chainCount);
  assert.deepEqual(expected.placements.map((entry) => entry.chainId), ["neutral-chain", "neutral-chain", "neutral-chain"]);

  assert.equal(moveUnit(game, mover.instanceId, field.instanceId).ok, false,
    "a standard action cannot open a Showdown while the existing Chain keeps the turn Closed");
  assert.equal(game.actionChain, existingChain);
  assert.equal(game.showdown, null);
});

test("a legally timed Reaction Chosen Champion follows normal Chain rules from the Champion Zone", () => {
  const makeShowdown = (championCard, suffix) => {
    const game = createGame({ manualActionChainPriority: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const ally = instance(cards.lonelyPoro, player.id, `champion-timing-ally-${suffix}`);
    const champion = instance({ ...championCard, energy: 0, power: [], effects: [] }, player.id, `champion-timing-${suffix}`);
    champion.zone = "champion";
    player.champion = champion;
    player.championPlayed = false;
    const field = testBattlefield(`champion-timing-field-${suffix}`, [ally], player.id);
    game.battlefields = [field];
    game.phase = "showdown";
    game.currentPlayerId = player.id;
    game.showdown = {
      battlefieldId: field.instanceId,
      turnPlayerId: player.id,
      attackerId: player.id,
      defenderId: opponent.id,
      focusPlayerId: player.id,
      priorityPlayerId: player.id,
      consecutivePasses: 0,
      chainSequence: 0,
      chain: []
    };
    return { game, player, opponent, champion, field };
  };

  const ordinary = makeShowdown(cards.annieFiery, "ordinary");
  assert.deepEqual(legalChampionPlayDestinations(ordinary.game), []);
  assert.equal(playChampion(ordinary.game, ordinary.field.instanceId).ok, false);
  assert.equal(ordinary.player.championPlayed, false);
  assert.equal(ordinary.champion.zone, "champion");

  const reaction = makeShowdown(cards.rengarTrophyHunter, "reaction");
  assert.deepEqual(legalChampionPlayDestinations(reaction.game), [reaction.field.instanceId]);
  assert.equal(playChampion(reaction.game, reaction.field.instanceId).ok, true);
  assert.equal(reaction.player.championPlayed, true);
  assert.equal(reaction.champion.zone, "played");
  assert.equal(reaction.field.units.some((unit) => unit.instanceId === reaction.champion.instanceId), true);
  assert.equal(reaction.game.showdown.chain.length, 0, "the Unit resolves immediately during Finalize");
  assert.equal(reaction.game.showdown.focusPlayerId, reaction.opponent.id,
    "an empty card-created Showdown Chain passes Focus after immediate Finalize");
});

test("a Hidden card gains its conditional Reaction permission beginning on the next turn", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const hiddenGear = instance({ ...cards.zhonyasHourglass, energy: 0, power: [], effects: [] }, player.id, "hidden-reaction-gear");
  hiddenGear.hidden = true;
  const field = testBattlefield("hidden-reaction-field", [instance(cards.lonelyPoro, player.id, "hidden-reaction-ally")], player.id);
  field.hidden = [{
    card: hiddenGear,
    ownerId: player.id,
    hiddenByPlayerId: player.id,
    playableFromTurnSequence: 1
  }];
  game.turnSequence = 0;
  game.battlefields = [field];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.deepEqual(legalCardPlayDestinations(game, hiddenGear.instanceId), []);
  game.turnSequence = 1;
  assert.deepEqual(legalCardPlayDestinations(game, hiddenGear.instanceId), [field.instanceId]);
  assert.equal(beginPlayCard(game, hiddenGear.instanceId, field.instanceId).ok, true);
  assert.equal(field.hidden.length, 0);
  assert.equal(player.base.some((card) => card.instanceId === hiddenGear.instanceId), true);
  assert.equal(game.showdown.chain.length, 0, "Hidden Gear resolves immediately during Finalize");
  assert.equal(game.showdown.focusPlayerId, opponent.id);
});

test("Check Legality rejects Ambush when its destination loses the friendly unit before Finalize", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const ally = instance(cards.lonelyPoro, player.id, "ambush-legality-ally");
  const ambusher = instance({ ...cards.vilemaw, energy: 0, power: [], effects: [] }, player.id, "ambush-legality-card");
  const field = testBattlefield("ambush-legality-field", [ally], player.id);
  player.hand = [ambusher];
  game.battlefields = [field];
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };

  assert.equal(beginPlayCard(game, ambusher.instanceId, field.instanceId).ok, true);
  assert.equal(game.pendingPayment?.cardId, ambusher.instanceId);
  field.units = [];
  assert.equal(confirmPayment(game).ok, false);
  assert.equal(player.hand.some((card) => card.instanceId === ambusher.instanceId), true);
  assert.equal(field.units.some((card) => card.instanceId === ambusher.instanceId), false);
  assert.equal(game.showdown.chain.length, 0);
});

test("turn tasks cannot pause without an explicit continuation owner", () => {
  const game = createGame();
  game.startTurnProcess = { playerId: game.players[0].id, step: "channel" };
  game.pendingChoice = { playerId: game.players[0].id, data: {} };
  const violations = evaluateRuleState(game).violations;
  assert.ok(violations.some((violation) => violation.checkId === "turn-task-continuation"));

  game.pendingChoice.data.continuation = { kind: "continueStartTurn", playerId: game.players[0].id };
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "turn-task-continuation"), false);

  game.pendingChoice = null;
  game.startTurnProcess = null;
  game.combatCleanupProcess = {
    battlefieldId: "missing-combat-field",
    attackerId: game.players[0].id,
    defenderId: game.players[0].id,
    specialApplied: false
  };
  assert.equal(evaluateRuleState(game).violations.some((violation) =>
    violation.checkId === "turn-task-continuation" && violation.message.includes("Combat Cleanup")), true);

  game.combatCleanupProcess = null;
  game.endTurnProcess = { playerId: game.players[0].id, step: "expirationCleanup" };
  game.endingCleanupProcess = {
    playerId: game.players[1].id,
    specialApplied: false,
    itemsUnderwentFepr: false
  };
  assert.equal(evaluateRuleState(game).violations.some((violation) =>
    violation.checkId === "turn-task-continuation" && violation.message.includes("Ending Cleanup")), true);
});

test("the independent HOT/FEPR model resumes every interrupted stage exactly once", () => {
  for (const stage of ["handle", "finalize", "execute", "pass", "resolve"]) {
    const expected = resolveOutstandingTaskFeprReference({
      taskKind: `${stage}-task`,
      taskCreatedAt: stage,
      pendingItemIds: [`${stage}-item`]
    });
    assert.equal(expected.taskRuns, 1, stage);
    assert.deepEqual(
      expected.trace.slice(expected.trace.indexOf(`${stage}:enter`), expected.trace.indexOf(`${stage}:exit`) + 1),
      [
        `${stage}:enter`,
        `${stage}:pause`,
        `task:${stage}-task:start`,
        `task:${stage}-task:complete`,
        `${stage}:resume`,
        `${stage}:exit`
      ],
      stage
    );
    assert.deepEqual(expected.items, [{ id: `${stage}-item`, status: "resolved" }], stage);
    assert.equal(expected.next, "turn-player-priority", stage);
  }

  const resolveReentry = resolveOutstandingTaskFeprReference({
    taskKind: "cleanup",
    taskCreatedAt: "resolve",
    pendingItemIds: ["older-item"],
    pendingItemCreatedDuringResolve: "new-pending-item",
    phase: "ending"
  });
  assert.equal(resolveReentry.trace.filter((entry) => entry === "finalize:enter").length, 2);
  assert.equal(resolveReentry.trace.filter((entry) => entry === "resolve:enter").length, 2);
  assert.deepEqual(resolveReentry.items, [
    { id: "older-item", status: "resolved" },
    { id: "new-pending-item", status: "resolved" }
  ]);
  assert.equal(resolveReentry.next, "advance-turn-structure");
});

test("Start and Ending Tasks survive Chain Pass, Resolve, and choice re-entry without skip or duplication", () => {
  const reactionCard = (ownerId, id) => instance({
    ...cards.incinerate,
    id: "TEST-HOT-FEPR-REACTION",
    name: "Rules Test Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, ownerId, id);

  const startGame = createGame({ interactive: true, manualActionChainPriority: true });
  const startPlayer = currentPlayer(startGame);
  const startOpponent = startGame.players.find((player) => player.id !== startPlayer.id);
  startGame.phase = "action";
  startGame.battlefields = [];
  startPlayer.legend = instance(cards.jinxLooseCannon, startPlayer.id, "hot-fepr-jinx");
  startPlayer.hand = [reactionCard(startPlayer.id, "hot-fepr-start-response")];
  startOpponent.hand = [reactionCard(startOpponent.id, "hot-fepr-start-opponent-response")];
  startPlayer.mainDeck = [
    instance(cards.lonelyPoro, startPlayer.id, "hot-fepr-start-trigger-draw"),
    instance(cards.lonelyPoro, startPlayer.id, "hot-fepr-start-turn-draw")
  ];
  startPlayer.runeDeck = [
    instance(makeRune(DOMAINS.CALM), startPlayer.id, "hot-fepr-start-rune-1"),
    instance(makeRune(DOMAINS.CALM), startPlayer.id, "hot-fepr-start-rune-2")
  ];
  startGame.ruleTaskTrace = [];

  startTurn(startGame);

  assert.deepEqual(startGame.startTurnProcess, { playerId: startPlayer.id, step: "scoring" });
  assert.deepEqual(startGame.actionChain?.continuation, { kind: "continueStartTurn", playerId: startPlayer.id });
  assert.deepEqual(startGame.actionChain?.chain.map((item) => [item.trigger?.kind, item.status]), [["beginningDraw", "finalized"]]);
  assert.equal(startPlayer.hand.length, 1, "the Beginning trigger has not resolved yet");
  assert.equal(startPlayer.runes.length, 0, "Channel has not been skipped ahead to");
  assert.equal(startGame.ruleTaskTrace.filter((entry) => entry.ruleId === "315.2.a.1").length, 1);
  assert.equal(evaluateRuleState(startGame).violations.some((violation) => violation.checkId === "turn-task-continuation"), false);

  assert.equal(passShowdown(startGame, startGame.actionChain.priorityPlayerId).ok, true);
  assert.equal(startGame.startTurnProcess.step, "scoring");
  assert.equal(startPlayer.runes.length, 0);
  assert.equal(passShowdown(startGame, startGame.actionChain.priorityPlayerId).ok, true);

  assert.equal(startGame.actionChain, null);
  assert.equal(startGame.startTurnProcess, undefined);
  assert.equal(startPlayer.hand.length, 3, "Jinx's draw and the normal turn draw each happen once");
  assert.equal(startPlayer.runes.length, 2, "Channel happens once after the Chain finishes");
  for (const ruleId of ["315.2.a.1", "315.2.b.2", "315.3.b", "315.4.b", "315.4.d"]) {
    assert.equal(startGame.ruleTaskTrace.filter((entry) => entry.ruleId === ruleId).length, 1, ruleId);
  }

  const endingGame = createGame({ interactive: true, manualActionChainPriority: true });
  const endingPlayer = currentPlayer(endingGame);
  const nextPlayer = endingGame.players.find((player) => player.id !== endingPlayer.id);
  endingGame.phase = "action";
  endingGame.battlefields = [];
  endingPlayer.legend = instance(cards.annieDarkChild, endingPlayer.id, "hot-fepr-annie");
  endingPlayer.hand = [reactionCard(endingPlayer.id, "hot-fepr-ending-response")];
  nextPlayer.hand = [reactionCard(nextPlayer.id, "hot-fepr-ending-opponent-response")];
  nextPlayer.mainDeck = [instance(cards.lonelyPoro, nextPlayer.id, "hot-fepr-next-turn-draw")];
  nextPlayer.runeDeck = [
    instance(makeRune(DOMAINS.CALM), nextPlayer.id, "hot-fepr-next-rune-1"),
    instance(makeRune(DOMAINS.CALM), nextPlayer.id, "hot-fepr-next-rune-2")
  ];
  endingPlayer.runes = [
    instance(makeRune(DOMAINS.FURY), endingPlayer.id, "hot-fepr-ending-rune-1"),
    instance(makeRune(DOMAINS.CHAOS), endingPlayer.id, "hot-fepr-ending-rune-2")
  ];
  for (const rune of endingPlayer.runes) rune.exhausted = true;
  endingGame.ruleTaskTrace = [];

  assert.equal(endTurn(endingGame).ok, true);
  assert.deepEqual(endingGame.endTurnProcess, { playerId: endingPlayer.id, step: "expiration" });
  assert.deepEqual(endingGame.actionChain?.continuation, { kind: "continueEndTurn", playerId: endingPlayer.id });
  assert.deepEqual(endingGame.actionChain?.chain.map((item) => [item.trigger?.kind, item.status]), [["endTurnReadyRunes", "finalized"]]);
  assert.deepEqual(endingPlayer.runes.map((rune) => rune.exhausted), [true, true]);

  assert.equal(passShowdown(endingGame, endingGame.actionChain.priorityPlayerId).ok, true);
  assert.equal(endingGame.endTurnProcess.step, "expiration");
  assert.equal(passShowdown(endingGame, endingGame.actionChain.priorityPlayerId).ok, true);
  assert.equal(endingGame.pendingChoice?.effect, "readyRunes");
  assert.equal(endingGame.endTurnProcess.step, "expiration");
  assert.equal(chooseEffectOption(endingGame, "hot-fepr-ending-rune-1").ok, true);
  assert.equal(endingGame.pendingChoice?.effect, "readyRunes");
  assert.equal(chooseEffectOption(endingGame, "done").ok, true);

  assert.equal(endingGame.actionChain, null);
  assert.equal(endingGame.endTurnProcess, undefined);
  assert.equal(endingGame.pendingEndTurnPlayerId, undefined);
  assert.equal(endingGame.currentPlayerId, nextPlayer.id);
  assert.deepEqual(endingPlayer.runes.map((rune) => rune.exhausted), [false, true]);
  for (const ruleId of ["317.1.a", "317.2.a", "317.2.f", "317.3"]) {
    assert.equal(endingGame.ruleTaskTrace.filter((entry) => entry.ruleId === ruleId).length, 1, ruleId);
  }
  assert.equal(evaluateRuleState(endingGame).violations.some((violation) => violation.checkId === "turn-task-continuation"), false);
});

test("start, cleanup, and Ending tasks follow the independent official order", () => {
  const startGame = createGame();
  const startPlayer = currentPlayer(startGame);
  startGame.phase = "action";
  startGame.battlefields = [];
  startPlayer.mainDeck = [instance(cards.lonelyPoro, startPlayer.id, "task-order-start-draw")];
  startPlayer.runeDeck = [
    instance(makeRune(DOMAINS.CALM), startPlayer.id, "task-order-start-rune-1"),
    instance(makeRune(DOMAINS.CALM), startPlayer.id, "task-order-start-rune-2")
  ];
  startGame.ruleTaskTrace = [];

  startTurn(startGame);

  const startRuleIds = startGame.ruleTaskTrace
    .map((entry) => entry.ruleId)
    .filter((ruleId) => ruleId.startsWith("315."));
  assert.deepEqual(startRuleIds, resolveTurnTaskOrderReference("start"));
  const cleanupRuleIds = startGame.ruleTaskTrace.map((entry) => entry.ruleId);
  const cleanupStart = cleanupRuleIds.indexOf("323.1");
  assert.notEqual(cleanupStart, -1);
  assert.deepEqual(
    cleanupRuleIds.slice(cleanupStart, cleanupStart + resolveTurnTaskOrderReference("cleanup").length),
    resolveTurnTaskOrderReference("cleanup")
  );

  const endingGame = createGame();
  const endingPlayer = currentPlayer(endingGame);
  const nextPlayer = endingGame.players.find((player) => player.id !== endingPlayer.id);
  endingGame.phase = "action";
  endingGame.battlefields = [];
  endingPlayer.mainDeck = [instance(cards.lonelyPoro, endingPlayer.id, "task-order-ending-own-draw")];
  nextPlayer.mainDeck = [instance(cards.lonelyPoro, nextPlayer.id, "task-order-ending-next-draw")];
  nextPlayer.runeDeck = [
    instance(makeRune(DOMAINS.CALM), nextPlayer.id, "task-order-ending-rune-1"),
    instance(makeRune(DOMAINS.CALM), nextPlayer.id, "task-order-ending-rune-2")
  ];
  endingGame.ruleTaskTrace = [];

  assert.equal(endTurn(endingGame).ok, true);
  const endingRuleIds = endingGame.ruleTaskTrace
    .map((entry) => entry.ruleId)
    .filter((ruleId) => ruleId === "423.1.a.2" || ruleId.startsWith("317."));
  assert.deepEqual(endingRuleIds, resolveTurnTaskOrderReference("ending"));
});

test("Channel Phase channels as many runes as possible when fewer than two remain", () => {
  const game = createGame();
  const player = currentPlayer(game);
  game.phase = "action";
  game.battlefields = [];
  player.runes = [];
  player.runeDeck = [instance(makeRune(DOMAINS.CALM), player.id, "short-channel-only-rune")];
  player.mainDeck = [instance(cards.lonelyPoro, player.id, "short-channel-draw")];

  startTurn(game);

  assert.deepEqual(player.runes.map((rune) => rune.instanceId), ["short-channel-only-rune"]);
  assert.equal(player.runeDeck.length, 0);
});

test("every Cleanup request cause is recorded at its shared engine boundary", () => {
  const games = [];

  const chainGame = createGame({ interactive: true, manualActionChainPriority: true });
  const chainPlayer = currentPlayer(chainGame);
  const spell = instance({
    ...cards.incinerate,
    id: "TEST-CLEANUP-CAUSE-SPELL",
    name: "Cleanup Cause Spell",
    energy: 0,
    power: [],
    effects: []
  }, chainPlayer.id, "cleanup-cause-spell");
  chainGame.phase = "action";
  chainGame.battlefields = [];
  chainPlayer.hand = [spell];
  assert.equal(beginPlayCard(chainGame, spell.instanceId, "base").ok, true);
  assert.equal(confirmPayment(chainGame).ok, true);
  while (chainGame.actionChain) {
    assert.equal(passShowdown(chainGame, chainGame.actionChain.priorityPlayerId).ok, true);
  }
  games.push(chainGame);

  const boardGame = createGame();
  const boardPlayer = currentPlayer(boardGame);
  boardGame.phase = "action";
  boardGame.battlefields = [];
  assert.equal(playUnitToken(boardGame, boardPlayer, boardPlayer.legend, {
    tokenCardNumber: "OGN-273/298",
    destination: "base"
  }), true);
  games.push(boardGame);

  const moveGame = createGame({ interactive: true });
  const movePlayer = currentPlayer(moveGame);
  const mover = instance(cards.lonelyPoro, movePlayer.id, "cleanup-cause-mover");
  const target = instance(cards.stalwartPoro, movePlayer.id, "cleanup-cause-damage-target");
  const field = testBattlefield("cleanup-cause-field", [], null);
  moveGame.phase = "action";
  moveGame.currentPlayerId = movePlayer.id;
  moveGame.battlefields = [field];
  movePlayer.base = [mover, target];
  applyDamage(moveGame, movePlayer, movePlayer.legend, target, 1);
  assert.equal(moveUnit(moveGame, mover.instanceId, field.instanceId).ok, true);
  assert.equal(passShowdown(moveGame, moveGame.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(moveGame, moveGame.showdown.priorityPlayerId).ok, true);
  games.push(moveGame);

  const traces = games.flatMap((game) => game.cleanupRequestTrace || []);
  for (let suffix = 1; suffix <= 8; suffix += 1) {
    assert.ok(traces.some((entry) => entry.ruleId === `319.${suffix}`), `RB 319.${suffix}`);
  }
  for (const game of games) {
    assert.equal(evaluateRuleState(game).violations.some((violation) =>
      violation.checkId === "cleanup-request-state"), false);
  }
});

test("Ending Expiration repeats exactly once after a Pending item undergoes FEPR", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = currentPlayer(game);
  const nextPlayer = game.players.find((candidate) => candidate.id !== player.id);
  game.phase = "action";
  game.battlefields = [];
  nextPlayer.mainDeck = [instance(cards.lonelyPoro, nextPlayer.id, "expiration-repeat-next-draw")];
  nextPlayer.runeDeck = [
    instance(makeRune(DOMAINS.CALM), nextPlayer.id, "expiration-repeat-rune-1"),
    instance(makeRune(DOMAINS.CALM), nextPlayer.id, "expiration-repeat-rune-2")
  ];
  game.pendingEndTurnPlayerId = player.id;
  game.endTurnProcess = { playerId: player.id, step: "expirationCleanup" };
  game.endingCleanupProcess = { playerId: player.id, specialApplied: false, itemsUnderwentFepr: false };
  game.ruleTaskTrace = [
    { sequence: 1, ruleId: "423.1.a.2", task: "clear-stunned-at-ending-step" },
    { sequence: 2, ruleId: "317.1.a", task: "ending-effects" },
    { sequence: 3, ruleId: "317.2.a", task: "ending-special-cleanup" }
  ];
  game.nextRuleTaskSequence = 3;
  game.cleanupPendingTriggerBatches = [{
    mode: "actionChain",
    continuation: { kind: "continueEndTurn", playerId: player.id },
    triggers: [{
      id: "expiration-repeat-trigger",
      kind: "reflexiveGameAction",
      playerId: player.id,
      sourceCardId: player.legend.instanceId,
      simultaneousBatchId: "expiration-repeat-batch",
      data: { action: "gainXp", amount: 1 }
    }]
  }];

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.endingCleanupProcess?.itemsUnderwentFepr, true);
  assert.ok(game.actionChain?.chain.some((item) => item.trigger?.id === "expiration-repeat-trigger"));
  while (game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  const endingRuleIds = game.ruleTaskTrace
    .map((entry) => entry.ruleId)
    .filter((ruleId) => ruleId === "423.1.a.2" || ruleId.startsWith("317."));
  assert.deepEqual(endingRuleIds, resolveTurnTaskOrderReference("ending", { expirationRepeats: 1 }));
  assert.equal(game.currentPlayerId, nextPlayer.id);
});

test("duel verification explicitly classifies team-only turn clauses as out of scope", () => {
  const teamOnly = coreRulesCatalog.clauses.filter((clause) =>
    ["315.2.b.3", "316.2.b.1"].includes(clause.id));
  assert.equal(createGame().mode, "duel");
  assert.deepEqual(teamOnly.map((clause) => clause.modeScope), ["other-mode", "other-mode"]);
});

test("Cleanup corrects every missing, opposite, and misplaced combat designation", () => {
  const game = createGame({ interactive: true });
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const wrongAttacker = instance(cards.lonelyPoro, attacker.id, "designation-wrong-attacker");
  wrongAttacker.combatRole = "defender";
  const missingDefender = instance(cards.stalwartPoro, defender.id, "designation-missing-defender");
  const offField = instance(cards.lonelyPoro, attacker.id, "designation-off-field");
  offField.combatRole = "attacker";
  const inBase = instance(cards.lonelyPoro, defender.id, "designation-in-base");
  inBase.combatRole = "defender";
  const combatField = testBattlefield("designation-combat-field", [wrongAttacker, missingDefender], defender.id);
  const otherField = testBattlefield("designation-other-field", [offField], attacker.id);
  defender.base = [inBase];
  game.battlefields = [combatField, otherField];
  game.phase = "showdown";
  game.currentPlayerId = defender.id;
  game.showdown = {
    battlefieldId: combatField.instanceId,
    turnPlayerId: attacker.id,
    attackerId: attacker.id,
    defenderId: defender.id,
    combat: true,
    focusPlayerId: attacker.id,
    priorityPlayerId: defender.id,
    consecutivePasses: 1,
    chainSequence: 1,
    chain: [{
      id: "designation-trigger-item",
      itemType: "trigger",
      card: attacker.legend,
      playerId: attacker.id,
      trigger: {
        id: "designation-trigger",
        kind: "reflexiveGameAction",
        playerId: attacker.id,
        sourceCardId: attacker.legend.instanceId,
        data: { action: "gainXp", amount: 0 }
      },
      status: "finalized"
    }]
  };

  assert.equal(passShowdown(game, defender.id).ok, true);
  assert.equal(wrongAttacker.combatRole, "attacker");
  assert.equal(missingDefender.combatRole, "defender");
  assert.equal(offField.combatRole, undefined);
  assert.equal(inBase.combatRole, undefined);
});

test("a Combat-only staged task begins Combat before the pending Ending Step", () => {
  const game = createGame({ interactive: true });
  const attacker = currentPlayer(game);
  const defender = game.players.find((candidate) => candidate.id !== attacker.id);
  const field = testBattlefield("combat-only-staged-field", [
    instance(cards.lonelyPoro, attacker.id, "combat-only-attacker"),
    instance(cards.stalwartPoro, defender.id, "combat-only-defender")
  ], defender.id);
  field.contestedBy = attacker.id;
  game.phase = "action";
  game.battlefields = [field];
  game.stagedEvents = [{
    id: `staged-combat-${field.instanceId}-${attacker.id}`,
    type: "combat",
    battlefieldId: field.instanceId,
    attackerId: attacker.id,
    defenderId: defender.id
  }];

  assert.equal(endTurn(game).ok, true);
  assert.equal(game.showdown?.combat, true);
  assert.equal(game.showdown?.battlefieldId, field.instanceId);
  assert.equal(game.pendingEndTurnPlayerId, attacker.id);
  assert.equal(game.endTurnProcess, undefined);
});

test("Ending expiration removes turn-limited Might and empties Rune Pools", () => {
  const game = createGame({ interactive: false });
  const player = game.players[0];
  const unit = instance(cards.lonelyPoro, player.id, "oracle-expiring-unit");
  unit.mightModifier = 2;
  unit.temporaryMight = 2;
  unit.damage = 1;
  player.base = [unit];
  player.runePool = { energy: [{ id: "oracle-expiring-energy" }], power: [{ id: "oracle-expiring-power" }] };
  game.phase = "action";
  game.currentPlayerId = player.id;
  game.battlefields = [];
  const before = captureRuleState(game);

  assert.equal(endTurn(game).ok, true);
  assert.equal(unit.mightModifier, 0);
  assert.equal(unit.temporaryMight, undefined);
  assert.equal(unit.damage, 0);
  assert.deepEqual(player.runePool, { energy: [], power: [] });
  assert.equal(evaluateRuleTransition(before, game, { kind: "turnExpiration", ok: true }).violations.length, 0);
});

test("Ending expiration clears every shared this-turn flag before the opponent's turn", () => {
  const game = createGame();
  game.phase = "action";
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  player.mainDeck = [instance(cards.lonelyPoro, player.id, "expiration-own-draw")];
  opponent.mainDeck = [instance(cards.lonelyPoro, opponent.id, "expiration-opponent-draw")];
  const unit = instance(cards.lonelyPoro, opponent.id, "expiration-opponent-unit");
  game.battlefields = [testBattlefield("expiration-field", [unit], opponent.id)];
  player.killDamagedUnitsThisTurn = true;
  player.unitsEnterReadyThisTurn = true;
  player.nextSpellEnergyReduction = 3;
  unit.temporaryKeywords = ["Ganking"];
  unit.cantMoveThisTurn = true;
  game.delayedAbilities = [{
    id: "expiration-delayed-ability",
    abilityClass: "triggered",
    condition: "unitTakesDamage",
    targetId: unit.instanceId,
    targetZoneChangeCounter: unit.zoneChangeCounter || 0,
    expiresAfterTurnSequence: game.turnSequence || 0
  }];

  const before = captureRuleState(game);
  assert.equal(endTurn(game).ok, true);
  assert.equal(player.killDamagedUnitsThisTurn, false);
  assert.equal(player.unitsEnterReadyThisTurn, false);
  assert.equal(player.nextSpellEnergyReduction, 0);
  assert.equal(unit.temporaryKeywords, undefined);
  assert.equal(unit.cantMoveThisTurn, false);
  assert.equal(game.delayedAbilities, undefined);
  assert.deepEqual(evaluateRuleTransition(before, game, { kind: "turnExpiration", ok: true }).violations, []);
});

test("Rune Pools persist through a Showdown and expire only at rules-defined boundaries", () => {
  const game = createGame({ interactive: true });
  game.phase = "showdown";
  const player = game.players[0];
  const opponent = game.players[1];
  const field = testBattlefield("rune-pool-showdown", [
    instance(cards.lonelyPoro, player.id, "rune-pool-attacker")
  ], opponent.id);
  game.battlefields = [field];
  player.runePool = { energy: [{ id: "stored-energy" }], power: [{ id: "stored-power" }] };
  opponent.runePool = { energy: [{ id: "opponent-energy" }], power: [] };
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    combat: false,
    chain: [],
    priorityPlayerId: player.id,
    focusPlayerId: player.id,
    consecutivePasses: 0
  };
  game.currentPlayerId = player.id;
  const beforeShowdownCompletion = captureRuleState(game);

  assert.equal(passShowdown(game, player.id).ok, true);
  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.phase, "action");
  assert.equal(player.runePool.energy.length, 1);
  assert.equal(player.runePool.power.length, 1);
  assert.equal(opponent.runePool.energy.length, 1);
  assert.deepEqual(evaluateRuleTransition(beforeShowdownCompletion, game, {
    kind: "showdownCompletion",
    ok: true
  }).violations, []);

  assert.equal(endTurn(game).ok, true);
  assert.deepEqual(player.runePool, { energy: [], power: [] });
  assert.deepEqual(opponent.runePool, { energy: [], power: [] });
});

test("Burn Out recycles trash, awards a point, and resumes the interrupted draw", () => {
  const game = createGame();
  game.phase = "action";
  const player = game.players[0];
  const opponent = game.players[1];
  player.mainDeck = [];
  player.hand = [];
  player.trash = [
    instance(cards.lonelyPoro, player.id, "burn-out-one"),
    instance(cards.scuttleCrab, player.id, "burn-out-two")
  ];
  opponent.score = 0;
  const before = captureRuleState(game);

  assert.equal(draw(player, 2, game), false);
  assert.deepEqual(new Set(player.hand.map((card) => card.instanceId)), new Set(["burn-out-one", "burn-out-two"]));
  assert.equal(player.trash.length, 0);
  assert.equal(opponent.score, 1);
  assert.equal(player.burnOuts, 1);
  assert.deepEqual(evaluateRuleTransition(before, game, {
    kind: "burnOut",
    playerId: player.id,
    opponentId: opponent.id,
    expectedCount: 1
  }).violations, []);
});

test("an empty deck and empty trash repeatedly burns out until the opponent wins", () => {
  const game = createGame();
  game.phase = "action";
  const player = game.players[0];
  const opponent = game.players[1];
  player.mainDeck = [];
  player.trash = [];
  opponent.score = game.victoryScore - 1;

  assert.equal(draw(player, 1, game), false);
  assert.equal(game.phase, "complete");
  assert.equal(game.winnerId, opponent.id);
  assert.equal(opponent.score, game.victoryScore);
});

test("Core Rules transition oracle rejects a Standard Move without its exhaust cost", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const moving = instance(cards.lonelyPoro, player.id, "oracle-unpaid-move");
  const field = testBattlefield("oracle-move-field", [], null);
  player.base = [moving];
  game.battlefields = [field];
  const before = captureRuleState(game);

  player.base = [];
  field.units.push(moving);
  const result = evaluateRuleTransition(before, game, {
    kind: "standardMove",
    unitIds: [moving.instanceId],
    ok: true
  });
  assert.equal(result.violations.some((violation) => violation.checkId === "standard-move-cost"), true);
});

test("Buff objects remain distinct from ordinary Might modifiers", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const unit = instance(cards.lonelyPoro, player.id, "buff-separation-unit");
  const spell = instance(cards.enGarde, player.id, "buff-separation-spell");
  player.base = [unit];

  assert.equal(resolveEffect(game, player, spell), true);
  assert.equal(chooseEffectOption(game, unit.instanceId).ok, true);
  assert.equal(unit.buffs, 0);
  assert.equal(unit.mightModifier, 2);
  assert.equal(effectiveMight(unit), unit.might + 2);

  unit.buffs = 1;
  assert.equal(effectiveMight(unit), unit.might + 3);
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "buff-state"), false);

  unit.buffs = 2;
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "buff-state"), true);

  const lee = instance(cards.leeSinAscetic, player.id, "unlimited-buff-unit");
  lee.buffs = 3;
  player.base = [lee];
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "buff-state"), false);
});

test("resolved and countered card plays agree with the independent 419.4 oracle", () => {
  const makePlayGame = (suffix) => {
    const game = createGame({ interactive: true });
    const player = game.players[0];
    const opponent = game.players[1];
    const observer = instance(cards.luxIlluminated, player.id, `played-observer-${suffix}`);
    observer.effects = observer.effects.map((effect) => effect.kind === "highCostSpellBuffSelf"
      ? { ...effect, minEnergy: 1 }
      : effect);
    const spell = instance(cards.charm, player.id, `played-spell-${suffix}`);
    spell.effects = [];
    spell.power = [];
    spell.energy = 1;
    player.base = [observer];
    player.hand = [spell];
    player.runes = [instance(makeRune(DOMAINS.CHAOS), player.id, `played-rune-${suffix}`)];
    player.cardsPlayedThisTurn = 0;
    game.phase = "action";
    game.currentPlayerId = player.id;
    game.manualActionChainPriority = true;
    return { game, player, opponent, observer, spell };
  };

  {
    const { game, player, opponent, observer, spell } = makePlayGame("countered");
    const before = captureRuleState(game);
    assert.equal(playCard(game, spell.instanceId).ok, true);
    assert.equal(player.cardsPlayedThisTurn, 0, "a pending Chain item is not yet played");
    assert.equal(observer.temporaryMight || 0, 0, "played triggers wait for successful resolution");

    const defy = instance(cards.defy, opponent.id, "played-counter-defy");
    assert.equal(resolveEffect(game, opponent, defy), true);
    assert.equal(chooseEffectOption(game, spell.instanceId).ok, true);

    const expected = resolvePlayedReference({ resolution: "countered" });
    assert.equal(player.cardsPlayedThisTurn, expected.cardsPlayedThisTurn);
    assert.equal(observer.temporaryMight || 0, 0);
    assert.equal(player.trash.some((card) => card.instanceId === spell.instanceId), true);
    const transition = evaluateRuleTransition(before, game, {
      kind: "cardResolution",
      playerId: player.id,
      resolved: false,
      countered: true
    });
    assert.deepEqual(transition.violations, []);
  }

  {
    const { game, player, observer, spell } = makePlayGame("resolved");
    const before = captureRuleState(game);
    assert.equal(playCard(game, spell.instanceId).ok, true);
    let passes = 0;
    while (game.actionChain && !game.pendingChoice && !game.pendingPayment && passes < 8) {
      assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
      passes += 1;
    }

    const expected = resolvePlayedReference({ resolution: "resolved" });
    assert.equal(player.cardsPlayedThisTurn, expected.cardsPlayedThisTurn);
    assert.equal(observer.temporaryMight, 3);
    const transition = evaluateRuleTransition(before, game, {
      kind: "cardResolution",
      playerId: player.id,
      resolved: true,
      countered: false
    });
    assert.deepEqual(transition.violations, []);
  }
});

test("cards and tokens follow the independent complete play lifecycle", () => {
  const reactionCard = (ownerId, id) => instance({
    ...cards.incinerate,
    id: "TEST-PLAY-LIFECYCLE-REACTION",
    name: "Rules Test Reaction",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    effects: []
  }, ownerId, id);

  const spellGame = createGame({ interactive: true, manualActionChainPriority: true });
  const spellPlayer = currentPlayer(spellGame);
  const spellOpponent = spellGame.players.find((player) => player.id !== spellPlayer.id);
  const spell = instance({
    ...cards.incinerate,
    id: "TEST-PLAY-LIFECYCLE-SPELL",
    name: "Rules Test Lifecycle Spell",
    energy: 0,
    power: [],
    effects: []
  }, spellPlayer.id, "play-lifecycle-spell");
  spellGame.phase = "action";
  spellGame.battlefields = [];
  spellPlayer.hand = [spell, reactionCard(spellPlayer.id, "play-lifecycle-own-response")];
  spellOpponent.hand = [reactionCard(spellOpponent.id, "play-lifecycle-opponent-response")];
  const spellExpected = resolvePlayLifecycleReference({ objectKind: "spell" });

  assert.equal(beginPlayCard(spellGame, spell.instanceId, "base").ok, true);
  assert.equal(spellGame.pendingPayment?.cardId, spell.instanceId);
  assert.equal(confirmPayment(spellGame).ok, true);
  assert.equal(spellGame.actionChain?.chain[0].status, "finalized");
  assert.equal(spellPlayer.cardsPlayedThisTurn, 0, "Finalized is not yet Played before spell resolution completes");
  assert.equal(spellPlayer.trash.includes(spell), false);
  assert.equal(passShowdown(spellGame, spellGame.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(spellGame, spellGame.actionChain.priorityPlayerId).ok, true);
  assert.equal(spellPlayer.cardsPlayedThisTurn, spellExpected.cardOrdinalDelta);
  assert.equal(spellPlayer.trash.includes(spell), true);

  const permanentGame = createGame({ interactive: true });
  const permanentPlayer = currentPlayer(permanentGame);
  const unit = instance({
    ...cards.lonelyPoro,
    id: "TEST-PLAY-LIFECYCLE-UNIT",
    name: "Rules Test Lifecycle Unit",
    energy: 0,
    power: [],
    effects: []
  }, permanentPlayer.id, "play-lifecycle-unit");
  permanentGame.phase = "action";
  permanentGame.battlefields = [];
  permanentPlayer.hand = [unit];
  const permanentExpected = resolvePlayLifecycleReference({ objectKind: "permanent" });

  assert.equal(beginPlayCard(permanentGame, unit.instanceId, "base").ok, true);
  assert.equal(confirmPayment(permanentGame).ok, true);
  assert.equal(permanentPlayer.base.includes(unit), true);
  assert.equal(permanentPlayer.cardsPlayedThisTurn, permanentExpected.cardOrdinalDelta);
  assert.equal(permanentExpected.played, true);
  assert.equal(permanentExpected.zone, "board");

  const counteredExpected = resolvePlayLifecycleReference({ objectKind: "spell", resolved: false });
  assert.equal(counteredExpected.played, false);
  assert.equal(counteredExpected.cardOrdinalDelta, 0);
  assert.deepEqual(
    resolvePlayLifecycleReference({ objectKind: "spell", enclosingEffect: true, outstandingTask: true }).trace.slice(0, 4),
    ["close", "pending", "wait-for-enclosing-effect", "wait-for-outstanding-task"]
  );
});

test("playing a token is a Unit play but not a card play", () => {
  const game = createGame({ interactive: false });
  const player = game.players[0];
  const opponent = game.players[1];
  const cithria = instance(cards.cithriaOfCloudfield, player.id, "token-play-cithria");
  const viktor = instance(cards.viktorInnovator, player.id, "token-play-viktor");
  player.base = [cithria, viktor];
  player.cardsPlayedThisTurn = 1;
  game.phase = "action";
  game.currentPlayerId = opponent.id;
  game.battlefields = [];

  assert.equal(playUnitToken(game, player, cithria, {
    tokenCardNumber: "OGN-273/298",
    count: 1,
    destination: "base"
  }), true);

  const recruits = player.base.filter((card) => card.cardNumber === "OGN-273/298");
  assert.equal(recruits.length, 1, "Viktor does not observe a token as a played card");
  assert.equal(cithria.buffs, 1, "Cithria observes the Recruit as another played unit");
  assert.equal(player.cardsPlayedThisTurn, 1, "token plays do not increment the card-play ordinal");
});

test("a card played by a resolving effect waits for that effect and grants a new response window", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const source = instance({
    ...cards.blindFury,
    energy: 0,
    power: []
  }, player.id, "effect-play-source");
  const nestedSpell = instance({
    ...cards.stackedDeck,
    id: "TEST-EFFECT-PLAY-SPELL",
    name: "Rules Test Effect-Played Spell",
    energy: 0,
    power: [],
    effects: []
  }, opponent.id, "effect-play-spell");
  const response = instance({
    ...cards.flash,
    id: "TEST-EFFECT-PLAY-RESPONSE",
    name: "Rules Test Effect-Play Response",
    energy: 0,
    power: [],
    effects: []
  }, opponent.id, "effect-play-response");
  game.phase = "action";
  game.battlefields = [];
  player.hand = [source];
  player.trash = [];
  opponent.hand = [response];
  opponent.mainDeck = [nestedSpell];
  opponent.trash = [];

  assert.equal(playCard(game, source.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "playRevealedOpponentTopDeck");
  game.manualActionChainPriority = true;
  assert.equal(chooseEffectOption(game, nestedSpell.instanceId).ok, true);

  assert.equal(player.trash.some((card) => card.instanceId === source.instanceId), true,
    "the enclosing effect finishes before the nested play proceeds");
  assert.equal(opponent.trash.some((card) => card.instanceId === nestedSpell.instanceId), false,
    "the effect-played spell has not resolved during its enclosing effect");
  assert.equal(game.actionChain?.chain.some((item) => item.card.instanceId === nestedSpell.instanceId && item.status === "finalized"), true);
  assert.equal(game.actionChain?.priorityPlayerId, opponent.id,
    "the opponent receives a real response opportunity before the nested spell resolves");

  assert.equal(passShowdown(game, opponent.id).ok, true);
  assert.equal(game.actionChain, null);
  assert.equal(opponent.trash.some((card) => card.instanceId === nestedSpell.instanceId), true);
  assert.equal(player.cardsPlayedThisTurn, 2, "both fully resolved cards are Played exactly once");
});

test("an effect-played targeted card declares its target while Pending and before Finalize", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const friendly = instance(cards.lonelyPoro, player.id, "effect-play-declared-friendly");
  const source = instance({ ...cards.blindFury, energy: 0, power: [] }, player.id, "effect-play-declaration-source");
  const nestedSpell = instance({ ...cards.highlander, energy: 8, power: [] }, opponent.id, "effect-play-targeted-spell");
  game.phase = "action";
  game.battlefields = [];
  player.base = [friendly];
  player.hand = [source];
  opponent.mainDeck = [nestedSpell];
  opponent.trash = [];

  assert.equal(playCard(game, source.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "playRevealedOpponentTopDeck");
  game.manualActionChainPriority = true;
  assert.equal(chooseEffectOption(game, nestedSpell.instanceId).ok, true);

  const pendingItem = game.actionChain?.chain.find((item) => item.card.instanceId === nestedSpell.instanceId);
  assert.equal(player.trash.some((card) => card.instanceId === source.instanceId), true,
    "the enclosing effect completes before the nested declaration opens");
  assert.equal(pendingItem?.status, "pending");
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [friendly.instanceId]);

  assert.equal(chooseEffectOption(game, friendly.instanceId).ok, true);
  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.energyCost, 0, "the instructed base cost is ignored");
  assert.deepEqual(game.pendingPayment?.declaredTargets, [
    { effect: "saveFriendlyUnitThisTurn", targetId: friendly.instanceId }
  ]);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(pendingItem.status, "finalized");
  assert.deepEqual(nestedSpell.declaredPlayTargets, [
    { effect: "saveFriendlyUnitThisTurn", targetId: friendly.instanceId }
  ]);
});

test("a hand card is Pending before choices and cancellation restores its exact origin", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = currentPlayer(game);
  const first = instance(cards.lonelyPoro, player.id, "pending-origin-first");
  const target = instance(cards.stalwartPoro, player.id, "pending-origin-target");
  const spell = instance({ ...cards.highlander, energy: 0, power: [] }, player.id, "pending-origin-spell");
  const last = instance(cards.lonelyPoro, player.id, "pending-origin-last");
  game.phase = "action";
  game.battlefields = [];
  player.base = [target];
  player.hand = [first, spell, last];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.deepEqual(player.hand.map((card) => card.instanceId), [first.instanceId, last.instanceId]);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.equal(game.actionChain?.chain.length, 1);
  assert.equal(game.actionChain?.chain[0].card, spell);
  assert.equal(game.actionChain?.chain[0].status, "pending");

  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment?.playProcess?.card, spell);
  assert.equal(cancelPayment(game).ok, true);
  assert.deepEqual(player.hand.map((card) => card.instanceId), [first.instanceId, spell.instanceId, last.instanceId]);
  assert.equal(game.actionChain, null);
  assert.equal(game.pendingChoice, null);
  assert.equal(game.pendingPayment, null);
});

test("ignoring a base cost preserves Accelerate's optional Energy and Power costs", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const source = instance({ ...cards.blindFury, energy: 0, power: [] }, player.id, "ignore-base-accelerate-source");
  const accelerated = instance(cards.legionRearguard, opponent.id, "ignore-base-accelerated-unit");
  const paymentRune = instance(makeRune(DOMAINS.FURY), player.id, "ignore-base-accelerate-rune");
  game.phase = "action";
  game.battlefields = [];
  player.hand = [source];
  opponent.mainDeck = [accelerated];
  player.runes = [paymentRune];

  assert.equal(playCard(game, source.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "playRevealedOpponentTopDeck");
  assert.equal(chooseEffectOption(game, accelerated.instanceId).ok, true);
  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.energyCost, 0);
  assert.deepEqual(game.pendingPayment?.powerCost, []);

  const accelerate = game.pendingPayment.optionalPowerEffects.find((effect) => effect.kind === "accelerate");
  assert.ok(accelerate);
  assert.equal(toggleOptionalPaymentEffect(game, accelerate.id).ok, true);
  assert.equal(game.pendingPayment.energyCost, 1);
  assert.deepEqual(game.pendingPayment.powerCost, [{ domain: DOMAINS.FURY, amount: 1 }]);
  assert.equal(togglePaymentRune(game, paymentRune.instanceId, "energy").ok, true);
  assert.equal(togglePaymentRune(game, paymentRune.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === accelerated.instanceId && !card.exhausted), true);
});

test("cost increases apply after an effect ignores the played card's base cost", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const vex = instance(cards.vexCheerless, opponent.id, "ignore-base-cost-increase-vex");
  const source = instance({ ...cards.blindFury, energy: 0, power: [] }, player.id, "ignore-base-cost-increase-source");
  const nested = instance({ ...cards.stackedDeck, effects: [] }, opponent.id, "ignore-base-cost-increase-spell");
  const field = testBattlefield("ignore-base-cost-increase-field", [vex], null);
  game.phase = "showdown";
  game.currentPlayerId = player.id;
  game.battlefields = [field];
  game.showdown = {
    battlefieldId: field.instanceId,
    turnPlayerId: player.id,
    attackerId: player.id,
    defenderId: opponent.id,
    focusPlayerId: player.id,
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: []
  };
  player.hand = [source];
  player.runes = [instance(makeRune(DOMAINS.FURY), player.id, "ignore-base-cost-increase-source-rune")];
  opponent.mainDeck = [nested];

  assert.equal(playCard(game, source.instanceId, "base").ok, true);
  for (let passes = 0; !game.pendingChoice && game.showdown && passes < 4; passes += 1) {
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "playRevealedOpponentTopDeck");
  assert.equal(chooseEffectOption(game, nested.instanceId).ok, true);
  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.energyCost, 1);
  assert.deepEqual(game.pendingPayment?.powerCost, [{ domain: DOMAINS.ANY, amount: 1 }]);
});

test("component minima do not prevent a later total discount from reducing Energy to zero", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const apprentice = instance(cards.eagerApprentice, player.id, "ordered-discount-apprentice");
  const mighty = instance({ ...cards.lonelyPoro, might: 7 }, player.id, "ordered-discount-mighty");
  const target = instance({ ...cards.lonelyPoro, might: 9 }, opponent.id, "ordered-discount-target");
  const field = testBattlefield("ordered-discount-field", [apprentice, target], null);
  const spell = instance({ ...cards.skySplitter, power: [] }, player.id, "ordered-discount-spell");
  game.phase = "action";
  game.battlefields = [field];
  player.base = [mighty];
  player.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(game.pendingPayment?.energyCost, 0);
});

test("a chosen optional additional cost remains paid when discounts reduce it to zero", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const keeper = instance({
    ...cards.clockworkKeeper,
    energy: 0,
    effects: [
      ...cards.clockworkKeeper.effects,
      { timing: "static", kind: "costModifier", component: "optionalAdditional", power: -1 }
    ]
  }, player.id, "zero-optional-cost-keeper");
  const drawn = instance(cards.lonelyPoro, player.id, "zero-optional-cost-draw");
  game.phase = "action";
  game.battlefields = [];
  player.hand = [keeper];
  player.mainDeck = [drawn];

  assert.equal(beginPlayCard(game, keeper.instanceId, "base").ok, true);
  const optional = game.pendingPayment.optionalPowerEffects.find((effect) => effect.kind === "optionalPowerDraw");
  assert.ok(optional);
  assert.equal(toggleOptionalPaymentEffect(game, optional.id).ok, true);
  assert.deepEqual(game.pendingPayment.powerCost, []);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
});

test("playing a revealed card for a replacement cost replaces both base cost components", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const seer = instance({ ...cards.gemcraftSeer, energy: 0, power: [] }, player.id, "replacement-cost-seer");
  const nocturne = instance(cards.nocturneHorrifying, player.id, "replacement-cost-nocturne");
  const paymentRune = instance(makeRune(DOMAINS.MIND), player.id, "replacement-cost-rune");
  game.phase = "action";
  game.battlefields = [];
  player.hand = [seer];
  player.mainDeck = [nocturne];
  player.runes = [paymentRune];

  assert.equal(playCard(game, seer.instanceId, "base").ok, true);
  if (game.pendingChoice?.effect === "declareTriggerUse") {
    assert.equal(chooseEffectOption(game, "use-trigger").ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "observedTopDeckSelfAbility");
  assert.equal(chooseEffectOption(game, "banish-play").ok, true);
  assert.equal(game.pendingPayment?.source, "effectPlay");
  assert.equal(game.pendingPayment?.energyCost, 0);
  assert.deepEqual(game.pendingPayment?.powerCost, [{ domain: DOMAINS.ANY, amount: 1 }]);
  assert.equal(togglePaymentRune(game, paymentRune.instanceId, "power").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(player.base.some((card) => card.instanceId === nocturne.instanceId), true);
  assert.equal(player.runeDeck.some((card) => card.instanceId === paymentRune.instanceId), true);
});

test("aggregate targets repair only from the original legal target set at resolution", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const field = testBattlefield("aggregate-target-field", [], opponent.id);
  const targets = Array.from({ length: 4 }, (_, index) => instance({
    ...cards.lonelyPoro,
    might: 1
  }, opponent.id, `aggregate-target-${index + 1}`));
  const neverChosen = instance({ ...cards.lonelyPoro, might: 1 }, opponent.id, "aggregate-never-chosen");
  field.units = [...targets, neverChosen];
  game.battlefields = [field];
  game.phase = "action";
  const foxFire = instance({ ...cards.foxFire, energy: 0, power: [] }, player.id, "aggregate-fox-fire");
  foxFire.declaredPlayTargets = [
    { effect: "killBattlefieldUnitsTotalMightMax", targetId: field.instanceId },
    ...targets.map((unit) => ({ effect: "killBattlefieldUnitsSelection", targetId: unit.instanceId }))
  ];
  targets[0].mightModifier = 1;
  targets[1].mightModifier = 1;

  assert.equal(resolveEffect(game, player, foxFire), true);
  assert.equal(game.pendingChoice?.effect, "repairAggregateTargets");
  assert.equal(game.pendingChoice.options.every((option) => !(option.cardIds || []).includes(neverChosen.instanceId)), true,
    "resolution can only shrink the original target set");
  const repaired = game.pendingChoice.options.find((option) =>
    option.cardIds?.length === 3
    && option.cardIds.includes(targets[0].instanceId)
    && option.cardIds.includes(targets[2].instanceId)
    && option.cardIds.includes(targets[3].instanceId));
  assert.ok(repaired, "a same-battlefield subset with total Might 4 remains legal");
  const reference = resolveAggregateTargetsReference({
    originalTargets: targets.map((unit) => ({
      id: unit.instanceId,
      battlefieldId: field.instanceId,
      might: effectiveMight(game, unit)
    })),
    chosenTargetIds: repaired.cardIds,
    maxTotal: 4
  });
  assert.equal(reference.legal, true);
  assert.equal(resolveAggregateTargetsReference({
    originalTargets: targets.map((unit) => ({ id: unit.instanceId, battlefieldId: field.instanceId, might: effectiveMight(game, unit) })),
    chosenTargetIds: [...repaired.cardIds, neverChosen.instanceId],
    maxTotal: 4
  }).legal, false, "the independent model also rejects a target outside the original set");
  assert.equal(chooseEffectOption(game, repaired.id).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === targets[0].instanceId), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === targets[2].instanceId), true);
  assert.equal(opponent.trash.some((card) => card.instanceId === targets[3].instanceId), true);
  assert.equal(field.units.some((card) => card.instanceId === targets[1].instanceId), true);
  assert.equal(field.units.some((card) => card.instanceId === neverChosen.instanceId), true);
});

test("the independent target classifier covers public, secret, restriction, cost, programmatic, and other-player choices", () => {
  assert.equal(referenceTargetClassification({ zone: "battlefield" }).targeted, true);
  assert.equal(referenceTargetClassification({ zone: "trash" }).targeted, true);
  assert.equal(referenceTargetClassification({ zone: "legend" }).targeted, true);
  assert.equal(referenceTargetClassification({ zone: "champion" }).targeted, true);
  assert.equal(referenceTargetClassification({ zone: "facedown" }).targeted, true);
  assert.equal(referenceTargetClassification({ zone: "chain" }).targeted, true);
  assert.deepEqual(referenceTargetClassification({ zone: "hand" }), {
    targeted: false,
    publicInformation: false,
    choiceTiming: "resolution"
  });
  assert.equal(referenceTargetClassification({ partOfRestriction: true }).targeted, false);
  assert.equal(referenceTargetClassification({ partOfCostTriggerOrReplacement: true }).targeted, false);
  assert.equal(referenceTargetClassification({ programmaticallySelected: true, noChoiceEverPossible: true }).targeted, false);
  assert.equal(referenceTargetClassification({ programmaticallySelected: true, noChoiceEverPossible: false }).targeted, true);
  assert.equal(referenceTargetClassification({ chosenInWholeOrPartByOtherPlayers: true }).targeted, false);
  assert.equal(referenceTargetClassification({ mustInstruction: true }).targeted, false);
  assert.equal(referenceTargetClassification({ isSourceObject: true }).targeted, false);
});

test("Highlander declares its public friendly-unit target before payment", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const friendly = instance(cards.lonelyPoro, player.id, "highlander-declared-target");
  const highlander = instance({ ...cards.highlander, energy: 0, power: [] }, player.id, "highlander-declaration");
  game.phase = "action";
  game.battlefields = [];
  player.base = [friendly];
  player.hand = [highlander];

  assert.equal(beginPlayCard(game, highlander.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [friendly.instanceId]);
  assert.equal(chooseEffectOption(game, friendly.instanceId).ok, true);
  assert.deepEqual(game.pendingPayment?.declaredTargets, [
    { effect: "saveFriendlyUnitThisTurn", targetId: friendly.instanceId }
  ]);
});

test("play declarations reject a target that its own chosen additional cost will certainly remove", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const sacrificed = instance(cards.lonelyPoro, player.id, "deterministic-cost-sacrifice");
  const legalTarget = instance(cards.stalwartPoro, player.id, "deterministic-cost-target");
  const spell = instance({
    ...cards.eclipse,
    id: "TEST-DETERMINISTIC-PLAY-CHOICE",
    name: "Rules Test Deterministic Choice",
    energy: 0,
    power: [],
    additionalCost: { kind: "killFriendlyUnit" },
    effects: [{ timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2, temporary: true }]
  }, player.id, "deterministic-choice-spell");
  game.phase = "action";
  game.battlefields = [];
  player.base = [sacrificed, legalTarget];
  player.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "killFriendlyUnitAdditionalCost");
  assert.equal(chooseEffectOption(game, sacrificed.instanceId).ok, true);
  assert.equal(game.pendingChoice?.data?.targetEffect, "modifyMight");
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [legalTarget.instanceId]);
});

test("a deterministically removed target remains legal only when no alternative choice exists", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const onlyUnit = instance(cards.lonelyPoro, player.id, "deterministic-only-unit");
  const spell = instance({
    ...cards.eclipse,
    id: "TEST-DETERMINISTIC-ONLY-CHOICE",
    name: "Rules Test Deterministic Only Choice",
    energy: 0,
    power: [],
    additionalCost: { kind: "killFriendlyUnit" },
    effects: [{ timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2, temporary: true }]
  }, player.id, "deterministic-only-spell");
  game.phase = "action";
  game.battlefields = [];
  player.base = [onlyUnit];
  player.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, onlyUnit.instanceId).ok, true);
  assert.deepEqual(game.pendingChoice.options.map((option) => option.cardId), [onlyUnit.instanceId]);
});

test("an up-to target declaration may explicitly choose zero before payment", () => {
  const game = createGame({ interactive: true });
  const player = currentPlayer(game);
  const field = testBattlefield("up-to-zero-field", [
    instance(cards.lonelyPoro, player.id, "up-to-zero-unit")
  ], player.id);
  const flash = instance({ ...cards.flash, energy: 0, power: [] }, player.id, "up-to-zero-flash");
  game.phase = "action";
  game.battlefields = [field];
  player.hand = [flash];

  assert.equal(beginPlayCard(game, flash.instanceId, "base").ok, true);
  assert.equal(game.pendingChoice?.effect, "declarePlayTarget");
  assert.ok(game.pendingChoice.options.some((option) => option.id === "declare-finish"));
  assert.equal(chooseEffectOption(game, "declare-finish").ok, true);
  assert.deepEqual(game.pendingPayment?.declaredTargets, []);
  assert.deepEqual(game.pendingPayment?.declaredChoices, [
    { effect: "returnUnitToBase", optionId: "skip" }
  ]);
});

test("split damage fixes targets before resolution but divides amounts only during resolution", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const striker = instance({ ...cards.masterYiTempered, might: 2 }, player.id, "split-rule-striker");
  const first = instance({ ...cards.lonelyPoro, might: 3 }, opponent.id, "split-rule-first");
  const second = instance({ ...cards.lonelyPoro, might: 3 }, opponent.id, "split-rule-second");
  game.battlefields = [testBattlefield("split-rule-field", [striker, first, second], null)];
  game.phase = "action";
  const alpha = instance({ ...cards.alphaStrike, energy: 0, power: [] }, player.id, "split-rule-alpha");
  alpha.declaredPlayTargets = [
    { effect: "alphaStrike", targetId: striker.instanceId },
    { effect: "alphaStrikeDamageTarget", targetId: first.instanceId },
    { effect: "alphaStrikeDamageTarget", targetId: second.instanceId }
  ];
  striker.mightModifier = -1;

  const reference = resolveSplitDamageReference({
    initialDamage: 2,
    resolutionDamage: 1,
    declaredTargetIds: [first.instanceId, second.instanceId],
    retainedTargetIds: [second.instanceId],
    allocations: [{ targetId: second.instanceId, amount: 1 }]
  });
  assert.equal(reference.legal, true);
  assert.equal(resolveEffect(game, player, alpha), true);
  assert.equal(game.pendingChoice?.effect, "splitDamageRemoveTarget");
  assert.deepEqual(new Set(game.pendingChoice.options.map((option) => option.cardId)), new Set([first.instanceId, second.instanceId]));
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  assert.equal(game.pendingChoice?.effect, "splitDamageAllocation");
  assert.deepEqual(game.pendingChoice.options.map((option) => ({ cardId: option.cardId, amount: option.amount })), [
    { cardId: second.instanceId, amount: 1 }
  ]);
  assert.equal(first.damage, 0);
  assert.equal(second.damage, 0);
  assert.equal(chooseEffectOption(game, game.pendingChoice.options[0].id).ok, true);
  assert.equal(first.damage, 0);
  assert.equal(second.damage, 1);
});

test("a target that visits a non-Board zone is a new object even after returning to the Board", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== caster.id);
  const target = instance(cards.lonelyPoro, owner.id, "non-board-identity-target");
  const original = instance({ ...cards.eclipse, energy: 0, power: [] }, caster.id, "non-board-identity-original");
  const replay = instance({
    ...cards.portalRescue,
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"]
  }, owner.id, "non-board-identity-replay");
  game.phase = "action";
  game.battlefields = [];
  owner.base = [target];
  owner.mainDeck = [];
  caster.hand = [original];

  assert.equal(beginPlayCard(game, original.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  assert.equal(game.actionChain?.chain[0].status, "finalized");

  assert.equal(resolveEffect(game, owner, replay), true);
  assert.equal(game.pendingChoice?.effect, "banishFriendlyUnitPlayToBase");
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(owner.base.some((card) => card.instanceId === target.instanceId), true);
  assert.ok((target.zoneChangeCounter || 0) > 0);

  for (let passes = 0; game.actionChain && !game.pendingChoice && !game.pendingPayment && passes < 8; passes += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(target.temporaryMight || 0, 0);
  assert.equal(target.mightModifier || 0, 0);
});

test("a target that moves only between Board locations remains the same object", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== caster.id);
  const target = instance(cards.lonelyPoro, owner.id, "board-identity-target");
  const spell = instance({
    ...cards.eclipse,
    name: "Rules Test Board Identity",
    energy: 0,
    power: [],
    effects: [{ timing: "spell", kind: "modifyMight", target: "unit", amount: -1, temporary: true }]
  }, caster.id, "board-identity-spell");
  const field = testBattlefield("board-identity-field", [], null);
  game.phase = "action";
  game.battlefields = [field];
  owner.base = [target];
  caster.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  owner.base.splice(owner.base.indexOf(target), 1);
  field.units.push(target);
  field.units.splice(field.units.indexOf(target), 1);
  owner.base.push(target);

  for (let passes = 0; game.actionChain && !game.pendingChoice && !game.pendingPayment && passes < 8; passes += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(target.mightModifier, -1);
});

test("a mistargeted instruction is ignored while later instructions still resolve", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== caster.id);
  const target = instance({ ...cards.lonelyPoro, might: 9 }, owner.id, "mistarget-draw-target");
  const drawn = instance(cards.charm, caster.id, "mistarget-later-draw");
  const spell = instance({ ...cards.voidSeeker, energy: 0, power: [] }, caster.id, "mistarget-draw-spell");
  const field = testBattlefield("mistarget-draw-field", [target], owner.id);
  game.phase = "action";
  game.battlefields = [field];
  caster.hand = [spell];
  caster.mainDeck = [drawn];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  field.units.splice(field.units.indexOf(target), 1);
  owner.base.push(target);

  for (let passes = 0; game.actionChain && !game.pendingChoice && !game.pendingPayment && passes < 8; passes += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(target.damage, 0);
  assert.equal(caster.hand.some((card) => card.instanceId === drawn.instanceId), true);
  assert.equal(caster.trash.some((card) => card.instanceId === spell.instanceId), true);
});

test("a spell with every instruction impossible still finishes resolving", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== caster.id);
  const target = instance(cards.lonelyPoro, owner.id, "all-impossible-target");
  const spell = instance({
    ...cards.incinerate,
    name: "Rules Test All Impossible",
    energy: 0,
    power: [],
    effects: [{ timing: "spell", kind: "dealDamageUnit", target: "enemyUnit", amount: 2 }]
  }, caster.id, "all-impossible-spell");
  const field = testBattlefield("all-impossible-field", [target], owner.id);
  game.phase = "action";
  game.battlefields = [field];
  caster.hand = [spell];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  field.units.splice(field.units.indexOf(target), 1);
  target.zoneChangeCounter = (target.zoneChangeCounter || 0) + 1;
  owner.hand.push(target);

  for (let passes = 0; game.actionChain && !game.pendingChoice && !game.pendingPayment && passes < 8; passes += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(target.damage, 0);
  assert.equal(caster.trash.some((card) => card.instanceId === spell.instanceId), true);
  assert.equal(game.actionChain, null);
});

test("a spell that leaves the Chain during resolution stops its remaining instructions", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const kept = instance(cards.lonelyPoro, caster.id, "leave-chain-kept");
  const recycledOne = instance(cards.charm, caster.id, "leave-chain-recycled-one");
  const recycledTwo = instance(cards.gust, caster.id, "leave-chain-recycled-two");
  const drawn = instance(cards.flash, caster.id, "leave-chain-draw");
  const spell = instance({
    ...cards.stackedDeck,
    name: "Rules Test Leave Chain",
    energy: 0,
    power: [],
    effects: [
      { timing: "spell", kind: "chooseTopDeck", look: 3, keep: 1 },
      { timing: "spell", kind: "draw", amount: 1 }
    ]
  }, caster.id, "leave-chain-spell");
  game.phase = "action";
  game.battlefields = [];
  caster.hand = [spell];
  caster.mainDeck = [kept, recycledOne, recycledTwo, drawn];

  assert.equal(beginPlayCard(game, spell.instanceId, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  for (let passes = 0; !game.pendingChoice && game.actionChain && passes < 4; passes += 1) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(game.pendingChoice?.effect, "chooseTopDeck");

  spell.zoneChangeCounter = (spell.zoneChangeCounter || 0) + 1;
  caster.banished.push(spell);
  assert.equal(chooseEffectOption(game, kept.instanceId).ok, true);
  assert.equal(caster.hand.some((card) => card.instanceId === kept.instanceId), true);
  assert.equal(caster.hand.some((card) => card.instanceId === drawn.instanceId), false);
  assert.equal(caster.trash.some((card) => card.instanceId === spell.instanceId), false);
});

test("reflexive instructions create separate response windows instead of resolving inside their parent effect", () => {
  {
    const game = createGame({ interactive: true, manualActionChainPriority: true });
    const caster = currentPlayer(game);
    const owner = game.players.find((candidate) => candidate.id !== caster.id);
    const target = instance({
      id: "TEST-REFLEXIVE-DISINTEGRATE-TARGET",
      name: "Rules Test Disintegrate Target",
      type: "unit",
      energy: 0,
      power: [],
      might: 2,
      tags: [],
      keywords: [],
      effects: []
    }, owner.id, "reflexive-disintegrate-target");
    const drawn = instance(cards.flash, caster.id, "reflexive-disintegrate-draw");
    game.phase = "action";
    game.battlefields = [testBattlefield("reflexive-disintegrate-field", [target], owner.id)];
    caster.mainDeck = [drawn];
    owner.hand = [instance({
      ...cards.gust,
      name: "Rules Test Reflexive Response",
      energy: 0,
      power: [],
      tags: ["Reaction"],
      keywords: ["Reaction"],
      effects: []
    }, owner.id, "reflexive-disintegrate-response")];

    assert.equal(resolveEffect(game, caster,
      instance(cards.disintegrate, caster.id, "reflexive-disintegrate")), true);
    assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
    assert.equal(owner.trash.some((card) => card.instanceId === target.instanceId), true);
    assert.equal(caster.hand.some((card) => card.instanceId === drawn.instanceId), false,
      "the reflexive draw has not resolved with the lethal-damage instruction");
    assert.equal(game.actionChain?.chain.length, 1);
    assert.equal(game.actionChain.chain[0].trigger.kind, "reflexiveGameAction");
    assert.equal(game.actionChain.priorityPlayerId, owner.id,
      "the opponent receives a real opportunity to respond to the reflexive trigger");

    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    assert.equal(caster.hand.some((card) => card.instanceId === drawn.instanceId), true);
  }

  {
    const game = createGame({ interactive: true, manualActionChainPriority: true });
    const caster = currentPlayer(game);
    const owner = game.players.find((candidate) => candidate.id !== caster.id);
    const makeUnit = (id, controllerId, might) => instance({
      id: `TEST-${id.toUpperCase()}`,
      name: id,
      type: "unit",
      energy: 0,
      power: [],
      might,
      tags: [],
      keywords: [],
      effects: []
    }, controllerId, id);
    const striker = makeUnit("reflexive-alpha-striker", caster.id, 4);
    const first = makeUnit("reflexive-alpha-first", owner.id, 2);
    const second = makeUnit("reflexive-alpha-second", owner.id, 2);
    const alpha = instance({ ...cards.alphaStrike, energy: 0, power: [] }, caster.id, "reflexive-alpha");
    alpha.declaredPlayTargets = [
      { effect: "alphaStrike", targetId: striker.instanceId },
      { effect: "alphaStrikeDamageTarget", targetId: first.instanceId },
      { effect: "alphaStrikeDamageTarget", targetId: second.instanceId }
    ];
    game.phase = "action";
    game.battlefields = [testBattlefield("reflexive-alpha-field", [striker, first, second], owner.id)];
    owner.hand = [instance({
      ...cards.gust,
      name: "Rules Test Alpha Response",
      energy: 0,
      power: [],
      tags: ["Reaction"],
      keywords: ["Reaction"],
      effects: []
    }, owner.id, "reflexive-alpha-response")];
    const xpBefore = caster.xp;

    assert.equal(resolveEffect(game, caster, alpha), true);
    assert.equal(chooseEffectOption(game, `${first.instanceId}:2`).ok, true);
    assert.equal(chooseEffectOption(game, `${second.instanceId}:2`).ok, true);
    assert.equal(game.actionChain?.chain.length, 2,
      "each killed unit creates one independent reflexive trigger");
    assert.equal(game.actionChain.chain.every((item) => item.trigger.kind === "reflexiveGameAction"), true);
    assert.equal(caster.xp, xpBefore);

    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    assert.equal(caster.xp, xpBefore + 1);
    assert.equal(game.actionChain.chain.length, 1);
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
    assert.equal(caster.xp, xpBefore + 2);
  }
});

test("Dragon's Rage finishes moving before its separately targeted reflexive duel", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== caster.id);
  const moved = instance({ ...cards.lonelyPoro, might: 3 }, owner.id, "reflexive-rage-moved");
  const enemy = instance({ ...cards.vilemaw, might: 7 }, owner.id, "reflexive-rage-enemy");
  const rage = instance({ ...cards.dragonsRage, energy: 0, power: [] }, caster.id, "reflexive-rage-spell");
  game.phase = "action";
  game.battlefields = [testBattlefield("reflexive-rage-field", [moved], owner.id)];
  owner.base = [enemy];
  owner.hand = [instance({
    ...cards.gust,
    name: "Rules Test Dragon Response",
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"],
    effects: []
  }, owner.id, "reflexive-rage-response")];
  caster.hand = [rage];

  assert.equal(beginPlayCard(game, rage.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, moved.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (!game.pendingChoice && game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.equal(game.pendingChoice?.effect, "dragonsRageEnemy");
  assert.equal(owner.base.some((card) => card.instanceId === moved.instanceId), true);
  assert.equal(caster.trash.some((card) => card.instanceId === rage.instanceId), true,
    "the parent spell has finished before the reflexive target is declared");
  assert.equal(moved.damage, 0);
  assert.equal(enemy.damage, 0);
  assert.equal(chooseEffectOption(game, enemy.instanceId).ok, true);
  assert.equal(game.actionChain?.chain[0].trigger.kind, "reflexiveDragonsRageDuel");
  assert.equal(game.actionChain.priorityPlayerId, owner.id);

  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(owner.trash.some((card) => card.instanceId === moved.instanceId), true);
  assert.equal(enemy.damage, 3);
});

test("a triggered ability mistargets when its declared target becomes a new object", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const caster = currentPlayer(game);
  const owner = game.players.find((candidate) => candidate.id !== caster.id);
  const moved = instance({ ...cards.lonelyPoro, might: 3 }, owner.id, "trigger-identity-moved");
  const enemy = instance({ ...cards.vilemaw, might: 7 }, owner.id, "trigger-identity-enemy");
  const rage = instance({ ...cards.dragonsRage, energy: 0, power: [] }, caster.id, "trigger-identity-rage");
  const rescue = instance({
    ...cards.portalRescue,
    energy: 0,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"]
  }, owner.id, "trigger-identity-rescue");
  game.phase = "action";
  game.battlefields = [testBattlefield("trigger-identity-field", [moved], owner.id)];
  owner.base = [enemy];
  owner.hand = [rescue];
  caster.hand = [rage];

  assert.equal(beginPlayCard(game, rage.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, moved.instanceId).ok, true);
  assert.equal(chooseEffectOption(game, "base").ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (!game.pendingChoice && game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }
  assert.equal(chooseEffectOption(game, enemy.instanceId).ok, true);
  assert.equal(game.actionChain?.chain[0].trigger.data.declaredTargetIdentities[0].zoneChangeCounter, 0);

  assert.equal(beginPlayCard(game, rescue.instanceId, "base").ok, true);
  assert.equal(chooseEffectOption(game, enemy.instanceId).ok, true);
  assert.equal(confirmPayment(game).ok, true);
  while (game.actionChain) {
    assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  }

  assert.ok((enemy.zoneChangeCounter || 0) > 0,
    "Portal Rescue's Banish and replay makes the returned card a new object");
  assert.equal(owner.base.some((card) => card.instanceId === enemy.instanceId), true);
  assert.equal(moved.damage, 0);
  assert.equal(enemy.damage, 0,
    "the Dragon's Rage trigger must not follow its old target through a non-Board zone");
});

test("Twisted Fate's rune outcome is a child trigger with its own pass cycle", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = currentPlayer(game);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const twistedFate = instance(cards.twistedFateGambler, player.id, "reflexive-twisted-fate");
  const defender = instance({ ...cards.vilemaw, might: 20 }, opponent.id, "reflexive-twisted-defender");
  const drawn = instance(cards.flash, player.id, "reflexive-twisted-draw");
  player.base = [twistedFate];
  player.mainDeck = [drawn];
  player.runeDeck = [{
    ...makeRune(DOMAINS.MIND),
    instanceId: "reflexive-twisted-mind-rune",
    ownerId: player.id,
    controllerId: player.id
  }];
  game.phase = "action";
  game.battlefields = [testBattlefield("reflexive-twisted-field", [defender], opponent.id)];

  assert.equal(moveUnit(game, twistedFate.instanceId, "reflexive-twisted-field").ok, true);
  assert.equal(game.showdown?.chain[0].trigger.kind, "attackOrDefendRuneDeckGambit");
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), false);
  assert.equal(game.showdown.chain.length, 1);
  assert.equal(game.showdown.chain[0].trigger.kind, "reflexiveGameAction");

  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), false);
  assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
  assert.equal(player.hand.some((card) => card.instanceId === drawn.instanceId), true);
});

test("delayed triggers keep independent linked sets and resolve after their source leaves", () => {
  const game = createGame({ interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const first = instance({ ...cards.missFortuneCaptain, might: 8 }, opponent.id, "delayed-first-target");
  const second = instance({ ...cards.missFortuneCaptain, might: 8 }, opponent.id, "delayed-second-target");
  const firstSpell = instance(cards.noxianGuillotine, player.id, "delayed-first-source");
  const secondSpell = instance(cards.noxianGuillotine, player.id, "delayed-second-source");
  const response = instance({ ...cards.flash, energy: 0, power: [], effects: [] }, player.id, "delayed-response");
  game.battlefields = [testBattlefield("delayed-field", [first, second], opponent.id)];
  game.phase = "action";
  game.currentPlayerId = player.id;

  assert.equal(resolveEffect(game, player, firstSpell), true);
  assert.equal(chooseEffectOption(game, first.instanceId).ok, true);
  player.cardsPlayedThisTurn = 0;
  assert.equal(resolveEffect(game, player, secondSpell), true);
  assert.equal(chooseEffectOption(game, second.instanceId).ok, true);
  assert.equal(game.delayedAbilities.length, 2);
  assert.equal(new Set(game.delayedAbilities.map((ability) => ability.linkedSetId)).size, 2);
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "delayed-ability-state"), false);

  player.trash = [];
  player.hand = [response];
  const damageSource = instance(cards.lonelyPoro, opponent.id, "delayed-damage-source");
  assert.equal(applyDamage(game, opponent, damageSource, first, 1, { origin: "unit" }), 1);
  assert.equal(game.delayedAbilities.length, 1);
  assert.equal(game.delayedAbilities[0].targetId, second.instanceId,
    "one linked set cannot consume another set's marked object");
  assert.equal(game.actionChain?.chain.length, 1);
  assert.equal(game.actionChain?.chain[0]?.trigger?.kind, "delayedKillDamagedUnit");
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "delayed-ability-state"), false);
  assert.equal(game.battlefields[0].units.some((unit) => unit.instanceId === first.instanceId), true,
    "the delayed trigger creates a response window instead of killing during Cleanup");

  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(passShowdown(game, game.actionChain.priorityPlayerId).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === first.instanceId), true);
  assert.equal(game.delayedAbilities[0].targetId, second.instanceId,
    "the second delayed ability survives even though both source spells left every zone we retained");
});

test("controlled spells enter their owners trash or corresponding deck after resolution", () => {
  for (const destination of ["trash", "mainDeck"]) {
    const game = createGame({ interactive: true });
    const controller = game.players[0];
    const owner = game.players[1];
    controller.legend.effects = [];
    owner.legend.effects = [];
    controller.trash = [];
    controller.mainDeck = [];
    owner.trash = [];
    owner.mainDeck = [];
    const spell = instance(cards.charm, owner.id, `owned-resolution-${destination}`);
    spell.controllerId = controller.id;
    spell.effects = [];
    spell.power = [];
    if (destination === "mainDeck") spell.recycleAfterResolve = true;
    const field = testBattlefield(`owned-resolution-field-${destination}`, [], null);
    game.battlefields = [field];
    game.phase = "showdown";
    game.currentPlayerId = controller.id;
    game.showdown = {
      battlefieldId: field.instanceId,
      attackerId: controller.id,
      defenderId: owner.id,
      turnPlayerId: controller.id,
      priorityPlayerId: controller.id,
      focusPlayerId: controller.id,
      consecutivePasses: 0,
      chain: [{ card: spell, playerId: controller.id, destination: "base", status: "pending" }]
    };

    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    assert.equal(passShowdown(game, game.showdown.priorityPlayerId).ok, true);
    assert.equal(owner[destination].some((card) => card.instanceId === spell.instanceId), true);
    assert.equal(controller[destination].some((card) => card.instanceId === spell.instanceId), false);
    assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "owned-zone"), false);
  }
});

test("killed cards clear temporary board state before entering trash", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const target = instance(cards.lonelyPoro, opponent.id, "oracle-reset-target");
  const killer = instance(cards.blastOfPower, player.id, "oracle-reset-killer");
  target.damage = 1;
  target.buffs = 1;
  target.mightModifier = 1;
  target.stunned = true;
  target.exhausted = true;
  target.temporaryKeywords = ["Ganking"];
  game.battlefields = [testBattlefield("oracle-reset-field", [target], opponent.id)];

  assert.equal(resolveEffect(game, player, killer), true);
  assert.equal(chooseEffectOption(game, target.instanceId).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === target.instanceId), true);
  assert.equal(target.damage, 0);
  assert.equal(target.buffs, 0);
  assert.equal(target.mightModifier, 0);
  assert.equal(target.stunned, false);
  assert.equal(target.exhausted, false);
  assert.equal(target.temporaryKeywords, undefined);
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "non-board-reset"), false);
});

test("killed tokens cease to exist instead of entering trash", () => {
  const game = createGame({ interactive: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const token = instance(cards.recruit, opponent.id, "oracle-killed-token");
  const killer = instance(cards.blastOfPower, player.id, "oracle-token-killer");
  game.battlefields = [testBattlefield("oracle-token-field", [token], opponent.id)];

  assert.equal(resolveEffect(game, player, killer), true);
  assert.equal(chooseEffectOption(game, token.instanceId).ok, true);
  assert.equal(opponent.trash.some((card) => card.instanceId === token.instanceId), false);
  assert.equal(locate(game, token.instanceId), null);
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "token-zone"), false);
});

test("selected battlefields leave the setup reserve instead of occupying two zones", () => {
  const game = createGame({ interactive: true, battlefieldSelectionMode: "manual" });
  assert.equal(confirmFirstPlayer(game).ok, true);
  for (const player of game.players) {
    assert.equal(selectChampion(game, player.id, player.availableChampions[0].instanceId).ok, true);
  }
  const selectingPlayer = game.players.find((player) => player.id === game.setupPlayerId);
  const battlefieldId = selectingPlayer.availableBattlefields[0].instanceId;

  assert.equal(selectBattlefield(game, selectingPlayer.id, battlefieldId).ok, true);
  assert.equal(selectingPlayer.availableBattlefields.some((field) => field.instanceId === battlefieldId), false);
  assert.equal(game.battlefields.some((field) => field.instanceId === battlefieldId), false);

  const otherPlayer = game.players.find((player) => player.id === game.setupPlayerId);
  assert.equal(selectBattlefield(game, otherPlayer.id, otherPlayer.availableBattlefields[0].instanceId).ok, true);
  assert.equal(game.battlefields.some((field) => field.instanceId === battlefieldId), true);
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "single-zone"), false);
});

test("activated abilities cannot be used from the non-board Champion Zone", () => {
  const game = createGame();
  game.phase = "action";
  const player = currentPlayer(game);
  const champion = instance(cards.luxCrownguard, player.id, "champion-zone-activation");
  champion.zone = "champion";
  player.champion = champion;
  player.championPlayed = false;

  assert.equal(activateCard(game, champion.instanceId).ok, false);
  assert.equal(champion.exhausted, false);
  assert.equal(player.runePool.energy.length, 0);

  champion.zone = "played";
  player.championPlayed = true;
  player.base.push(champion);

  assert.equal(activateCard(game, champion.instanceId).ok, true);
  assert.equal(champion.exhausted, true);
  assert.equal(player.runePool.energy.length, 2);
});

test("chain trigger source references do not place their source card in a second zone", () => {
  const game = createGame();
  const player = game.players[0];
  const source = instance(cards.chemtechEnforcer, player.id, "chain-trigger-source");
  player.base = [source];
  game.actionChain = {
    turnPlayerId: player.id,
    playerIds: game.players.map((candidate) => candidate.id),
    priorityPlayerId: player.id,
    consecutivePasses: 0,
    chain: [{
      id: "chain-trigger-reference",
      itemType: "trigger",
      card: source,
      playerId: player.id,
      status: "finalized"
    }]
  };

  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "single-zone"), false);

  game.actionChain.chain[0].itemType = "card";
  assert.equal(evaluateRuleState(game).violations.some((violation) => violation.checkId === "single-zone"), true);
});
