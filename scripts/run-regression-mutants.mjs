import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = path.join(ROOT, "src", "engine.mjs");
const EFFECT_RUNTIME = path.join(ROOT, "src", "effects", "runtime.mjs");
const ENGINE_TEST = path.join(ROOT, "tests", "engine.test.mjs");
const OGS = path.join(ROOT, "src", "cards", "ogsCards.mjs");
const DECK_RULES = path.join(ROOT, "src", "decks", "rules.mjs");

const engineMutants = [
  {
    id: "lethal-equality",
    search: "unit.damage >= currentMight(game, unit)",
    replacement: "unit.damage > currentMight(game, unit)",
    testName: "Incinerate sends a unit with lethal damage to its owner's trash"
  },
  {
    id: "cleanup-single-pass",
    search: "} while ((changed || game.cleanupRequested) && loops < 20 && game.phase !== \"complete\");",
    replacement: "} while (false && (changed || game.cleanupRequested) && loops < 20 && game.phase !== \"complete\");",
    testName: "noncombat cleanup uses current Might and repeats after an aura leaves",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "killed-unit-to-base",
    search: "owner.trash.push(unit);",
    replacement: "controller.base.push(unit);",
    testName: "Incinerate sends a unit with lethal damage to its owner's trash"
  },
  {
    id: "automatic-activated-power-not-recycled",
    search: "  if (!payChosenPowerRunes(game, player, powerSources.powerRuneIds, powerSources.powerRuneIds.length)) return false;",
    replacement: "  // Mutant: incorrectly skip recycling Power paid for an activated ability.",
    testName: "automatic activated Power payment recycles the paid rune"
  },
  {
    id: "generated-pool-power-not-consumed",
    search: "  consumeSelectedPoolPower(player, payment.poolPowerIds || []);",
    replacement: "  // Mutant: generated Power incorrectly remains in the Rune Pool after payment.",
    testName: "Gold kills and exhausts itself as an Add Reaction cost, then universal Power pays a colored cost"
  },
  {
    id: "universal-pool-power-cannot-pay-colored",
    search: "  if (rune.domain === \"Any\") return true;",
    replacement: "  if (false) return true;",
    testName: "Gold kills and exhausts itself as an Add Reaction cost, then universal Power pays a colored cost"
  },
  {
    id: "gold-kill-cost-skipped",
    search: "  if (specs.some((spec) => spec.killSelfCost)) {",
    replacement: "  if (false) {",
    testName: "Gold kills and exhausts itself as an Add Reaction cost, then universal Power pays a colored cost"
  },
  {
    id: "basic-rune-recycle-cost-skipped",
    search: "  if (specs.some((spec) => spec.recycleSelfCost)) {",
    replacement: "  if (false) {",
    testName: "Basic Runes bank Energy by exhausting and matching Power by recycling, including while exhausted"
  },
  {
    id: "exhausted-channel-enters-ready",
    search: "    rune.exhausted = Boolean(options.exhausted);",
    replacement: "    rune.exhausted = false;",
    testName: "Channel is one recorded action and printed exhausted Channel effects enter runes exhausted"
  },
  {
    id: "channel-skips-zone-identity-change",
    search: `    markNonBoardZoneChange(rune);
    rune.controllerId = player.id;
    rune.exhausted = Boolean(options.exhausted);`,
    replacement: `    rune.controllerId = player.id;
    rune.exhausted = Boolean(options.exhausted);`,
    testName: "Channel is one recorded action and printed exhausted Channel effects enter runes exhausted"
  },
  {
    id: "returned-unit-owner-channel-enters-ready",
    search: "      exhausted: choice.data?.channelOwnerExhausted !== false,",
    replacement: "      exhausted: false,",
    testName: "an effect that channels for a returned unit's owner uses that owner and enters the rune exhausted"
  },
  {
    id: "power-recycle-order-reversed",
    search: "  const orderedRunes = orderedIds.map((id) => controller.runes.find((rune) => rune.instanceId === id));",
    replacement: "  const orderedRunes = orderedIds.map((id) => controller.runes.find((rune) => rune.instanceId === id)).reverse();",
    testName: "simultaneous Power recycling follows chosen order, owner destination, and token cessation"
  },
  {
    id: "power-recycle-goes-to-controller",
    search: "    const owner = game.players.find((player) => player.id === rune.ownerId) || controller;",
    replacement: "    const owner = controller;",
    testName: "simultaneous Power recycling follows chosen order, owner destination, and token cessation"
  },
  {
    id: "power-rune-token-persists",
    search: "    if (rune.isToken) continue;",
    replacement: "    if (false) continue;",
    testName: "simultaneous Power recycling follows chosen order, owner destination, and token cessation"
  },
  {
    id: "automatic-power-cost-bypasses-shared-recycle",
    search: "  return recyclePowerRunesInChosenOrder(game, player, chosen.powerRuneIds);",
    replacement: `  for (const id of chosen.powerRuneIds) {
    const index = player.runes.findIndex((rune) => rune.instanceId === id);
    if (index < 0) continue;
    const [rune] = player.runes.splice(index, 1);
    player.runeDeck.push(rune);
  }
  return true;`,
    testName: "automatic Power costs use shared owner and token recycle rules"
  },
  {
    id: "main-deck-recycle-goes-to-actor",
    search: "    const owner = game.players.find((candidate) => candidate.id === card.ownerId) || player;",
    replacement: "    const owner = player;",
    testName: "Main Deck recycling uses each card owner and recycled tokens cease to exist"
  },
  {
    id: "main-deck-recycled-token-persists",
    search: "    if (card.isToken) continue;",
    replacement: "    if (false) continue;",
    testName: "Main Deck recycling uses each card owner and recycled tokens cease to exist"
  },
  {
    id: "non-board-mighty-uses-stale-board-modifiers",
    search: "    .filter((card) => card.type === \"unit\" && printedMight(card) <= (continuation.killedMight ?? -Infinity) + 1)",
    replacement: "    .filter((card) => card.type === \"unit\" && currentMight(game, card) <= (continuation.killedMight ?? -Infinity) + 1)",
    testName: "baited hook kills a friendly unit and plays a top deck unit within might range"
  },
  {
    id: "failed-required-declaration-enters-response-window",
    search: "  if (declaration.required) {",
    replacement: "  if (false) {",
    testName: "a required declaration that cannot open rolls back before the response window"
  },
  {
    id: "karma-recycle-trigger-skipped",
    search: "    for (const effect of cardEffects(source, \"recycle\")) {",
    replacement: "    for (const effect of []) {",
    testName: "Karma Channeler triggers once when one or more cards are recycled but not when a Rune is recycled"
  },
  {
    id: "combat-damage-bypasses-normal-damage-events",
    search: `    applyDamage(game, player, source, target, assignment.amount || 0, {
      origin: "combat",
      sourceCardIds: sources.map((unit) => unit.instanceId),
      deferredTriggerBatches
    });`,
    replacement: "    target.damage = (target.damage || 0) + (assignment.amount || 0);",
    testName: "combat assignment deals damage simultaneously and creates normal damage events"
  },
  {
    id: "damage-ignores-prevent",
    search: `  const validBaseDamage = consumeDamagePrevention(
    game,
    target,
    baseDamageAmount(game, source, target, baseAmount, options),
    origin
  );`,
    replacement: "  const validBaseDamage = baseDamageAmount(game, source, target, baseAmount, options);",
    testName: "Prevent applies only to its declared source and retains an unspent remainder"
  },
  {
    id: "bonus-damage-revives-invalid-deal",
    search: `  const amount = validBaseDamage > 0
    ? validBaseDamage + bonusDamageAmount(game, player, source, target, options)
    : 0;`,
    replacement: "  const amount = validBaseDamage + bonusDamageAmount(game, player, source, target, options);",
    testName: "Bonus Damage is added only after the underlying Deal action remains valid"
  },
  {
    id: "split-damage-total-ignores-bonus-damage",
    search: "  return baseAmount + bonusDamageAmount(game, player, damageSource, representative, { origin });",
    replacement: "  return baseAmount;",
    testName: "Bonus Damage increases one split total and its target limit without being added per allocation"
  },
  {
    id: "split-damage-reapplies-bonus-per-allocation",
    search: "      bonusAlreadyApplied: true",
    replacement: "      bonusAlreadyApplied: false",
    testName: "Bonus Damage increases one split total and its target limit without being added per allocation"
  },
  {
    id: "combat-lethal-ignores-prevent",
    search: "  return trackedDamagePreventionValue(game, unit, \"combat\");",
    replacement: "  return 0;",
    testName: "finite Prevent values are consumed by matching damage and increase combat lethal assignment"
  },
  {
    id: "combat-healing-is-not-one-simultaneous-heal-event",
    search: "  healUnits(game, allUnits(game), { reason: \"combat-special-cleanup\" });",
    replacement: "  for (const unit of allUnits(game)) unit.damage = 0;",
    testName: "combat special cleanup heals an aura survivor before the next normal cleanup"
  },
  {
    id: "combat-result-not-recorded",
    search: "  recordCombatResultEvent(game, battlefield, process, attackersRemain, defendersRemain);",
    replacement: "  // Mutant: omit the required combat win/loss/no-result determination.",
    testName: "combat special cleanup heals an aura survivor before the next normal cleanup"
  },
  {
    id: "revealed-main-deck-card-leaves-zone-before-reveal-ends",
    search: `function resolveDefendHereRevealTopSpellTrigger(game, trigger, player, source) {
  const top = player.mainDeck[0];
  if (!top) return;
  recordRevealEvent(game, player, [top], source, "mainDeck");`,
    replacement: `function resolveDefendHereRevealTopSpellTrigger(game, trigger, player, source) {
  const top = player.mainDeck.shift();
  if (!top) return;
  recordRevealEvent(game, player, [top], source, "mainDeck");`,
    testName: "ravenbloom conservatory puts the defending player's revealed spell into hand"
  },
  {
    id: "top-deck-self-ability-skipped-outside-predict",
    search: "    const effect = card ? firstCardEffect(card, \"static\", \"playFromTopReveal\") : null;",
    replacement: "    const effect = null;",
    testName: "look effects resolve every observed top-deck self ability before presenting their own choices"
  },
  {
    id: "effect-move-forces-exhausted-state",
    search: "  if (options.readyAfterMove) readyUnitWithEffects(game, player, source, unit);",
    replacement: "  unit.exhausted = true;",
    testName: "effect Moves use the shared movement event and send controlled units to their controller's base"
  },
  {
    id: "ready-step-skips-ready-action",
    search: `    controlledCardsAtReadyStep,
    { reason: "ready-step" }`,
    replacement: `    [],
    { reason: "ready-step" }`,
    testName: "Ready actions share one event and trigger friendly-unit Ready abilities"
  },
  {
    id: "effect-ready-skips-ready-action",
    search: "  readyCardsWithEffects(game, player, source, selected, { reason: \"effect\" });",
    replacement: "  for (const unit of selected) unit.exhausted = false;",
    testName: "Ready actions share one event and trigger friendly-unit Ready abilities"
  },
  {
    id: "multi-draw-stops-after-two-cards",
    search: "  for (let i = 0; i < requested; i++) {",
    replacement: "  for (let i = 0; i < Math.min(requested, 2); i++) {",
    testName: "Draw completes its full amount before every simultaneous second-draw trigger resolves"
  },
  {
    id: "second-draw-triggers-only-first-source",
    search: "  for (const source of allControlledCards(game, player.id)) {\n    for (const effect of cardEffects(source, \"secondDrawEachTurn\")) {",
    replacement: "  for (const source of allControlledCards(game, player.id).slice(0, 1)) {\n    for (const effect of cardEffects(source, \"secondDrawEachTurn\")) {",
    testName: "Draw completes its full amount before every simultaneous second-draw trigger resolves"
  },
  {
    id: "weaponmaster-does-not-discount-universal-power",
    search: "  const universalIndex = power.findIndex((requirement) => requirement.domain === \"Any\" && requirement.amount > 0);\n  if (universalIndex >= 0) power[universalIndex].amount -= 1;",
    replacement: "  const universalIndex = power.findIndex((requirement) => requirement.domain === \"Any\" && requirement.amount > 0);\n  if (universalIndex >= 0) power[universalIndex].amount -= 0;",
    testName: "Weaponmaster discounts one universal Power rather than one Energy"
  },
  {
    id: "effect-move-goes-to-owner-base",
    search: "    movingPlayer.base.push(unit);",
    replacement: "    (game.players.find((candidate) => candidate.id === unit.ownerId) || movingPlayer).base.push(unit);",
    testName: "effect Moves use the shared movement event and send controlled units to their controller's base"
  },
  {
    id: "effect-move-skips-move-counter-and-triggers",
    search: "  unit.movesThisTurn = (unit.movesThisTurn || 0) + 1;",
    replacement: "  // Mutant: an effect Move is not recorded as a Move event.",
    testName: "effect Moves use the shared movement event and send controlled units to their controller's base"
  },
  {
    id: "move-with-effect-adds-exhaust-cost",
    search: "    moveUnitBySpell(game, player, source, source, targetDestination);",
    replacement: "    source.exhausted = true;\n    moveUnitBySpell(game, player, source, source, targetDestination);",
    testName: "stealthy pursuer may move with a friendly unit from the same battlefield"
  },
  {
    id: "effect-move-is-attributed-to-moved-unit-controller",
    search: `  battlefield.units.push(unit);
  log(game, \`\${source.name} moves \${unit.name} to \${battlefield.name}.\`);`,
    replacement: `  battlefield.units.push(unit);
  player = game.players.find((candidate) => candidate.id === unit.controllerId) || player;
  log(game, \`\${source.name} moves \${unit.name} to \${battlefield.name}.\`);`,
    testName: "an effect that moves an enemy unit attributes the Move to the effect controller"
  },
  {
    id: "detach-at-battlefield-recalls-gear-too-early",
    search: "    destinationType = location?.type === \"battlefield\" ? \"battlefield\" : \"base\";",
    replacement: "    destinationType = \"base\";",
    testName: "portal rescue replays a friendly unit to base ignoring its cost"
  },
  {
    id: "attaching-same-card-is-not-a-no-op",
    search: `  if (gear.attachedToId === unit.instanceId
    && (unit.attachments || []).some((attachment) => attachment.instanceId === gear.instanceId)) return false;`,
    replacement: "  // Mutant: attaching the same card to the same Top-Most card repeats the action.",
    testName: "multiple Weaponmaster instances resolve separately even when they choose the same Equipment"
  },
  {
    id: "reattachment-skips-detach-event",
    search: "    if (removed) detachAttachmentFromTopMost(game, unit, removed);",
    replacement: `    if (removed) {
      delete removed.attachedToId;
      unit.attachments = unit.attachments.filter((card) => card.instanceId !== gearId);
      syncTopMostAttachmentEffects(unit);
    }`,
    testName: "attaching Equipment to a new Top-Most card records the required Detach first"
  },
  {
    id: "banish-does-not-remove-card-from-current-zone",
    search: "    removeCardFromNonBoardZones(game, card.instanceId);",
    replacement: "    // Mutant: the Banished card incorrectly remains in its previous non-board zone.",
    testName: "Banish uses the owner's zone and linked event before a later instructed play"
  },
  {
    id: "banish-goes-to-responsible-player-zone",
    search: `    if (!options.boardStateAlreadyCleared) clearBoardState(game, card);
    const owner = game.players.find((player) => player.id === card.ownerId) || responsiblePlayer;`,
    replacement: `    if (!options.boardStateAlreadyCleared) clearBoardState(game, card);
    const owner = responsiblePlayer;`,
    testName: "blind fury waits for the player to inspect and choose a revealed opponent card"
  },
  {
    id: "already-scored-conquer-triggers-again",
    search: "  if (!scored) return false;",
    replacement: "  // Mutant: Conquer abilities trigger even when this Battlefield was already scored.",
    testName: "Conquer and Hunt trigger exactly when the battlefield is scored"
  },
  {
    id: "winning-conquer-is-not-a-score-event",
    search: `    log(game, \`\${player.name} would score the winning conquest point, so they draw 1 instead.\`);
    return true;`,
    replacement: `    log(game, \`\${player.name} would score the winning conquest point, so they draw 1 instead.\`);
    return false;`,
    testName: "Conquer and Hunt trigger exactly when the battlefield is scored"
  },
  {
    id: "duel-battlefield-selection-is-manual",
    search: "      || (sanctionedFormat === \"match\" ? \"manual\" : \"random\"),",
    replacement: "      || \"manual\",",
    testName: "Duel setup randomly selects and simultaneously places one Battlefield per player"
  },
  {
    id: "match-reuses-used-battlefield",
    search: "      !unavailable.has(field.cardNumber) && !unavailable.has(field.collectorNumber));",
    replacement: "      true);",
    testName: "Match setup excludes every Battlefield that player already used in the Match"
  },
  {
    id: "match-first-battlefield-reveals-early",
    search: "  game.setupBattlefieldSelections[player.id] = chosen;",
    replacement: `  game.setupBattlefieldSelections[player.id] = chosen;
  game.battlefields.push({ ...chosen, controlledBy: null, units: [], hidden: [] });`,
    testName: "selected battlefields leave the setup reserve instead of occupying two zones",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "predict-x-kept-order-reversed",
    search: "  player.mainDeck.unshift(...kept);",
    replacement: "  player.mainDeck.unshift(...kept.reverse());",
    testName: "Predict X lets its player recycle any subset and explicitly reorder every card left on top"
  },
  {
    id: "divine-judgment-rune-order-reversed",
    search: "    const orderedRuneIds = runeRecycleOrder[candidate.id] || runeExcess.map((rune) => rune.instanceId);",
    replacement: "    const orderedRuneIds = (runeRecycleOrder[candidate.id] || runeExcess.map((rune) => rune.instanceId)).reverse();",
    testName: "Divine Judgment lets each Rune owner explicitly order simultaneous recycling",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "hidden-cannot-use-champion-zone",
    search: `  const championSource = cardIndex < 0
    && player.champion?.instanceId === cardId
    && player.champion.zone === "champion"
    && !player.championPlayed;`,
    replacement: "  const championSource = false;",
    testName: "Hidden can move the Chosen Champion from the Champion Zone and preserves its identity when played"
  },
  {
    id: "level-uses-owner-xp-after-control-change",
    search: `function controllerOfCard(game, card) {
  return game.players.find((player) => player.id === card?.controllerId)
    || game.players.find((player) => player.id === card?.ownerId)
    || null;
}`,
    replacement: `function controllerOfCard(game, card) {
  return game.players.find((player) => player.id === card?.controllerId || player.id === card?.ownerId)
    || null;
}`,
    testName: "master yi tempered gains ganking only at level 6 xp"
  },
  {
    id: "rune-activated-zone-omitted",
    search: "    ...player.runes.filter((rune) => rune.controllerId === playerId),",
    replacement: "    // Mutant: Runes are incorrectly omitted from active controlled cards.",
    testName: "Basic Runes bank Energy by exhausting and matching Power by recycling, including while exhausted"
  },
  {
    id: "exhausted-rune-cannot-recycle-for-power",
    search: `function canActivateAbilityAtCurrentTiming(game, player, card, specs, { usingForgeAbility = false } = {}) {
  if (!card || card.controllerId !== player.id || game.pendingChoice) return false;
  if (card.exhausted && activatedAbilityExhausts(specs)) return false;`,
    replacement: `function canActivateAbilityAtCurrentTiming(game, player, card, specs, { usingForgeAbility = false } = {}) {
  if (!card || card.controllerId !== player.id || game.pendingChoice) return false;
  if (card.exhausted) return false;`,
    testName: "Basic Runes bank Energy by exhausting and matching Power by recycling, including while exhausted"
  },
  {
    id: "priority-player-not-used-as-actor",
    search: "    || game.actionChain?.priorityPlayerId",
    replacement: "    || null",
    testName: "Reaction cards and abilities use the Priority player instead of the turn player"
  },
  {
    id: "reaction-card-requires-turn-ownership",
    search: "  if (game.actionChain) return canPlayInActionChain(game, player, card, destination);",
    replacement: "  if (game.actionChain) return game.currentPlayerId === player.id && canPlayInActionChain(game, player, card, destination);",
    testName: "Reaction cards and abilities use the Priority player instead of the turn player"
  },
  {
    id: "additional-turns-use-oldest-first",
    search: "  game.additionalTurnQueue.unshift(playerId);\n  return true;\n}",
    replacement: "  game.additionalTurnQueue.push(playerId);\n  return true;\n}",
    testName: "multiple Additional Turns resolve newest-first and then resume the untouched regular turn order"
  },
  {
    id: "additional-turn-scheduling-erases-existing-turns",
    search: "export function scheduleAdditionalTurn(game, playerId) {\n  if (!game.players.some((player) => player.id === playerId)) return false;\n  game.additionalTurnQueue ||= [];",
    replacement: "export function scheduleAdditionalTurn(game, playerId) {\n  if (!game.players.some((player) => player.id === playerId)) return false;\n  game.additionalTurnQueue = [];",
    testName: "multiple Additional Turns resolve newest-first and then resume the untouched regular turn order"
  },
  {
    id: "additional-turn-resumes-after-extra-player-instead-of-regular-order",
    search: "    game.currentPlayerId = game.additionalTurnReturnPlayerId || ordered[nextIndex].id;",
    replacement: "    game.currentPlayerId = ordered[nextIndex].id;",
    testName: "multiple Additional Turns resolve newest-first and then resume the untouched regular turn order"
  },
  {
    id: "baron-anywhere-permission-skipped",
    search: "      && !hasStaticEffect(destination, \"unitsCanMoveHereFromAnywhere\")) {",
    replacement: "      && true) {",
    testName: "Brush and Baron Pit battlefield tokens share the Replace framework and their printed movement and Might rules"
  },
  {
    id: "brush-tag-might-skipped",
    search: "    if ((effect.tags || []).some((tag) => unit.tags?.includes(tag))) amount += effect.amount || 1;",
    replacement: "    if (false) amount += effect.amount || 1;",
    testName: "Brush and Baron Pit battlefield tokens share the Replace framework and their printed movement and Might rules"
  },
  {
    id: "battlefield-swap-does-not-restore",
    search: "  game.battlefields[index] = original;",
    replacement: "  game.battlefields[index] = token;",
    testName: "Brush and Baron Pit battlefield tokens share the Replace framework and their printed movement and Might rules"
  },
  {
    id: "brush-score-trigger-skipped",
    search: "        collectBattlefieldScoreTriggers(field, player, \"hold\", triggers);",
    replacement: "        if (false) collectBattlefieldScoreTriggers(field, player, \"hold\", triggers);",
    testName: "Brush offers its optional swap-back trigger only after its controller actually scores"
  },
  {
    id: "attachment-effect-text-not-appended",
    search: "      .filter((effect) => effect.textSection === \"effect\")",
    replacement: "      .filter((effect) => false)",
    testName: "attached Rules Text is inactive while Effect Text is appended to the Top-Most card"
  },
  {
    id: "numeric-keyword-first-instance-only",
    search: "const printed = printedKeywordValue(card, keyword, fallback);",
    replacement: "const printed = keywordListHas(card?.keywords, keyword) ? fallback : 0;",
    testName: "numeric keyword values from separate sources are summed"
  },
  {
    id: "vision-keyword-resolver-skipped",
    search: "  [\"keyword:predict\", (game, player, card, spec) => offerPredictChoice(game, player, card, {}, { amount: spec.amount || 1 })],",
    replacement: "  [\"keyword:predict\", () => false],",
    testName: "Vision is a shared keyword trigger and each granted instance predicts separately"
  },
  {
    id: "friendly-vision-aura-skipped",
    search: "        if (effect.kind === \"otherFriendlyUnitsGainKeywords\") count += keywordListCount(effect.keywords, keyword);",
    replacement: "        if (false) count += keywordListCount(effect.keywords, keyword);",
    testName: "Vision is a shared keyword trigger and each granted instance predicts separately"
  },
  {
    id: "death-discard-draw-skips-explicit-selection",
    search: "  chooseDiscardCards(game, player, source, { amount: discardAmount, draw: drawAmount });",
    replacement: "  player.trash.push(...player.hand.splice(0, discardAmount));\n  draw(player, drawAmount, game);",
    testName: "Discard instructions let their responsible player choose the cards before later instructions continue",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "effect-rune-recycle-auto-selects",
    search: "  chooseRecycleRunes(game, player, source, trigger.data?.amount || 1);",
    replacement: "  chooseRecycleRunes(game, player, source, trigger.data?.amount || 1);\n  if (game.pendingChoice?.effect === \"recycleRunes\") applyChoiceEffect(game, game.pendingChoice, game.pendingChoice.options[0]);",
    testName: "Recycle instructions let the responsible player choose the Rune and preserve its owner destination",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "beginning-trash-recycle-auto-selects",
    search: "  chooseRecycleTrashCards(game, player, source, amount);",
    replacement: "  chooseRecycleTrashCards(game, player, source, amount);\n  if (game.pendingChoice?.effect === \"recycleTrashCards\") applyChoiceEffect(game, game.pendingChoice, game.pendingChoice.options[0]);",
    testName: "Beginning recycle effects explicitly choose every card instead of using trash order",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "activated-trash-recycle-declaration-skipped",
    search: "  if (game.interactive && (activatedCost?.recycleTrash || 0) > 0",
    replacement: "  if (false && (activatedCost?.recycleTrash || 0) > 0",
    testName: "vi recycles one trash card to gain might without exhausting"
  },
  {
    id: "mighty-condition-recurses-through-own-keyword",
    search: "    printed: effectiveMight(unit),",
    replacement: "    printed: currentMight(game, unit),",
    testName: "conditional and shared static keywords affect combat, movement, and Deflect targeting",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "accelerate-uses-first-domain-on-multi-domain-card",
    search: "  return { domain: domains.length === 1 ? domains[0] : \"Any\", amount: 1 };",
    replacement: "  return { domain: domains[0] || \"Any\", amount: 1 };",
    testName: "Accelerate derives exactly one Power from Domain identity instead of reminder text"
  },
  {
    id: "deathknell-goes-to-owner-instead-of-last-controller",
    search: "function collectDeathknellTriggers(game, owner, unit, diedAlone) {\n  const triggers = [];\n  const controller = game.players.find((player) => player.id === unit.controllerId) || owner;",
    replacement: "function collectDeathknellTriggers(game, owner, unit, diedAlone) {\n  const triggers = [];\n  const controller = owner;",
    testName: "Deathknell remains controlled by the permanent's last controller after it enters its owner's trash",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "tank-priority-disabled",
    search: "mustAssignFirst: !damagePrevented && hasKeyword(unit, \"Tank\", game),",
    replacement: "mustAssignFirst: false,",
    testName: "manual combat damage must assign lethal damage to Tank units first"
  },
  {
    id: "backline-priority-disabled",
    search: `hasKeyword(unit, "Backline", game)
          || hasStaticEffect(unit, "combatDamageAssignmentLast")`,
    replacement: `false
          || hasStaticEffect(unit, "combatDamageAssignmentLast")`,
    testName: "manual combat damage assigns Backline units only after non-Backline units"
  },
  {
    id: "activated-abilities-resolve-together",
    search: `const specs = continuingActivation
    ? card.activationProcess.specs
    : selectedAbility?.specs || selectableGroups[0]?.specs || [];`,
    replacement: `const specs = continuingActivation
    ? card.activationProcess.specs
    : selectableGroups.flatMap((group) => group.specs);`,
    testName: "Heimerdinger chooses one copied activated ability instead of resolving all of them",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "automatic-activated-target-declaration-skipped",
    search: "if (!game.interactive && !card.activationDeclarationReady) {",
    replacement: "if (false && !card.activationDeclarationReady) {",
    testName: "Heimerdinger, Inventor copies a friendly activated ability",
    testFile: "tests/effect-conformance.test.mjs"
  },
  {
    id: "optional-trigger-prompts-twice-before-cost",
    search: "if (spec.optional && !effectDefinition(spec)?.optionalTrigger) {",
    replacement: "if (spec.optional) {",
    testName: "optional triggered ability placement proceeds directly to its cost"
  },
  {
    id: "equip-skips-activation-payment",
    search: "if (spec.kind === \"equip\") return [{ domain: spec.domain || \"Any\", amount: spec.amount || 1 }];",
    replacement: "if (false) return [{ domain: spec.domain || \"Any\", amount: spec.amount || 1 }];",
    testName: "activated equipment attaches only after explicit activation"
  },
  {
    id: "equip-incorrectly-exhausts",
    search: "return specs.some((spec) => spec.exhaust === true || (spec.exhaust !== false && spec.kind !== \"equip\"));",
    replacement: "return specs.some((spec) => spec.exhaust !== false);",
    testName: "activated equipment attaches only after explicit activation"
  },
  {
    id: "ordinary-activated-ability-skips-chain",
    search: "else if (game.phase === \"action\" && game.interactive) chainState = ensureActionChain(game, player.id);",
    replacement: "else if (game.phase === \"action\" && false) chainState = ensureActionChain(game, player.id);",
    testName: "ordinary activated abilities use the action Chain before resolving"
  },
  {
    id: "channel-misclassified-as-add",
    search: "return specs.length > 0 && specs.every((spec) => effectDefinition(spec)?.addsResources);",
    replacement: "return specs.length > 0 && specs.every((spec) => effectDefinition(spec)?.addsResources || spec.kind === \"killFriendlyPermanentChannelRune\");",
    testName: "malzahar fanatic uses the normal Chain before killing a permanent and channeling"
  },
  {
    id: "add-ability-loses-chain-item-classification",
    search: `    itemType: "activated",
    card,
    playerId,
    specs,`,
    replacement: `    itemType: "mutant-activated",
    card,
    playerId,
    specs,`,
    testName: "an Add Reaction finalizes during payment without passing Priority or Focus",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "activated-keyword-leaks-to-card-timing",
    search: `  return cardReactionPermissionSources(card, {
    fromHidden: card.hidden === true,
    ambushDestinationEligible: ambushGrantsReaction(game, player, card, destination)
  }).length > 0;`,
    replacement: `  return cardReactionPermissionSources(card, {
    fromHidden: card.hidden === true,
    ambushDestinationEligible: ambushGrantsReaction(game, player, card, destination)
  }).length > 0 || cardEffects(card, "activated").some((spec) => (spec.abilityKeywords || []).includes("Reaction"));`,
    testName: "activated ability timing keywords do not make their source cards Action or Reaction cards"
  },
  {
    id: "ordinary-legend-activation-blocked",
    search: "return game.phase === \"action\" && game.currentPlayerId === player.id;",
    replacement: "return game.phase === \"action\" && game.currentPlayerId === player.id && card.type !== \"legend\";",
    testName: "ordinary Legend activated abilities use their controller's neutral open action timing"
  },
  {
    id: "action-ability-blocked-in-showdown",
    search: "return isActionAbility(specs);",
    replacement: "return isReactionAbility(specs);",
    testName: "Action belongs to Malzahar's ability rather than the unit card"
  },
  {
    id: "activated-source-location-ignored",
    search: "if (spec.sourceLocation === \"battlefield\" && location?.type !== \"battlefield\") return false;",
    replacement: "if (false) return false;",
    testName: "activated ability use conditions are checked before paying costs or exhausting the source"
  },
  {
    id: "activated-legion-condition-ignored",
    search: "if (spec.requiresLegion && (player.cardsPlayedThisTurn || 0) <= 0) return false;",
    replacement: "if (false) return false;",
    testName: "activated ability use conditions are checked before paying costs or exhausting the source"
  },
  {
    id: "activated-battlefield-unit-means-enemy",
    search: "const scope = spec.target === \"battlefieldUnit\"\n      ? \"battlefield\"",
    replacement: "const scope = spec.target === \"battlefieldUnit\"\n      ? \"enemyBattlefield\"",
    testName: "activated ability use conditions are checked before paying costs or exhausting the source"
  },
  {
    id: "closed-state-card-skips-reaction-gate",
    search: "if (game.actionChain) return canPlayInActionChain(game, player, card, destination);",
    replacement: "if (game.actionChain) return true;",
    testName: "direct and interactive card entry points share the Closed-state Reaction gate",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "existing-chain-is-replaced",
    search: `  if (game.actionChain) {
    ownActionChainContinuation(game, continuation);
    return game.actionChain;
  }`,
    replacement: `  if (false) {
    ownActionChainContinuation(game, continuation);
    return game.actionChain;
  }`,
    testName: "cards, abilities, and their triggers join the one existing Chain",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "showdown-open-ignores-focus",
    search: "if (!showdown.chain.length && showdown.focusPlayerId !== player.id) return false;",
    replacement: "if (false) return false;",
    testName: "card categories follow the independent Neutral/Showdown Open/Closed permission matrix",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "ambush-is-unconditional-reaction",
    search: "    ambushDestinationEligible: ambushGrantsReaction(game, player, card, destination)",
    replacement: "    ambushDestinationEligible: hasKeyword(card, \"Ambush\", null)",
    testName: "Ambush grants Reaction only while playing to a battlefield with a friendly unit"
  },
  {
    id: "hidden-loses-conditional-reaction",
    search: "    fromHidden: card.hidden === true,",
    replacement: "    fromHidden: false,",
    testName: "a Hidden card gains its conditional Reaction permission beginning on the next turn",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "card-finalization-skips-legality-recheck",
    search: `  if (process.timingPermission === "actionOrReaction") {
    if (game.phase !== "showdown" || (!card.tags?.includes("Action")
      && !pendingCardRetainsReactionPermission(game, player, card, payment.destination, process))) {
      return { ok: false, message: "That card is no longer legally timed." };
    }
  }`,
    replacement: `  if (process.timingPermission === "actionOrReaction") {
    if (false) {
      return { ok: false, message: "That card is no longer legally timed." };
    }
  }`,
    testName: "Check Legality rejects Ambush when its destination loses the friendly unit before Finalize",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "cleanup-runs-during-chain-resolution",
    search: "if (game.resolvingChainContext || game.resolvingGameEffect) {",
    replacement: "if (false) {",
    testName: "Chain finalization and post-resolution Priority follow the independent FEPR model",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "task-chain-drops-continuation",
    search: "  game.actionChain.continuation = continuation;",
    replacement: "  // Mutant: the Chain no longer owns the Task continuation.",
    testName: "Start and Ending Tasks survive Chain Pass, Resolve, and choice re-entry without skip or duplication",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "start-task-repeats-beginning-step",
    search: `  if (process.step === "beginning") {
    process.step = "scoring";`,
    replacement: `  if (process.step === "beginning") {
    process.step = "beginning";`,
    testName: "Start and Ending Tasks survive Chain Pass, Resolve, and choice re-entry without skip or duplication",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "ending-task-repeats-trigger-step",
    search: `  if (process.step === "endingTriggers") {
    process.step = "expiration";`,
    replacement: `  if (process.step === "endingTriggers") {
    process.step = "endingTriggers";`,
    testName: "Start and Ending Tasks survive Chain Pass, Resolve, and choice re-entry without skip or duplication",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "choice-skips-action-chain-resume",
    search: "  if (!game.actionChain || game.pendingChoice || game.pendingPayment) return;",
    replacement: "  if (!game.actionChain || game.pendingChoice || game.pendingPayment || !game.actionChain.chain.length) return;",
    testName: "Start and Ending Tasks survive Chain Pass, Resolve, and choice re-entry without skip or duplication",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "showdown-finalization-passes-priority",
    search: "if (newest) giveShowdownPriority(game, newest.playerId);",
    replacement: "if (newest) giveShowdownPriority(game, otherShowdownPlayerId(game.showdown, newest.playerId));",
    testName: "interactive showdown spells can enter manual payment and join the chain"
  },
  {
    id: "action-finalization-passes-priority",
    search: "giveActionChainPriority(game, newest.playerId);",
    replacement: "giveActionChainPriority(game, otherActionChainPlayerId(game.actionChain, newest.playerId));",
    testName: "ordinary activated abilities use the action Chain before resolving"
  },
  {
    id: "action-item-remains-pending",
    search: `function finalizePendingActionChainItems(game) {
  const pending = normalizeActionChainItems(game.actionChain)
    .filter((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!pending.length) return;
  for (const item of pending) {
    item.status = "finalized";
    requestCleanup(game, "pending-item-finalized", { itemId: item.id, itemType: item.itemType });
  }`,
    replacement: `function finalizePendingActionChainItems(game) {
  const pending = normalizeActionChainItems(game.actionChain)
    .filter((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!pending.length) return;
  for (const item of pending) {
    item.status = "pending";
    requestCleanup(game, "pending-item-finalized", { itemId: item.id, itemType: item.itemType });
  }`,
    testName: "cards and abilities use every first and later two-player Execute window through Finalize",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "execute-card-passes-priority",
    search: `function addPendingChainItem(game, showdown, card, playerId, destination, playOptions = {}) {
  if (!showdown.chain.length && !showdown.chainOpenedBy) showdown.chainOpenedBy = "card";`,
    replacement: `function addPendingChainItem(game, showdown, card, playerId, destination, playOptions = {}) {
  if (!showdown.chain.length && !showdown.chainOpenedBy) showdown.chainOpenedBy = "card";
  showdown.priorityPlayerId = (showdown.playerIds || [showdown.attackerId, showdown.defenderId]).find((id) => id && id !== playerId);`,
    testName: "a Pending card keeps Priority with its controller before Finalize",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "execute-ability-passes-priority",
    search: `    log(game, \`\${player.name} completes \${card.name}'s ability choices, costs, and legality check.\`);
    checkState(game);
    if (game.actionChain) maybeAutoPassActionChain(game);
    return { ok: true };`,
    replacement: `    log(game, \`\${player.name} completes \${card.name}'s ability choices, costs, and legality check.\`);
    checkState(game);
    if (game.actionChain) {
      giveActionChainPriority(game, otherActionChainPlayerId(game.actionChain, player.id));
      maybeAutoPassActionChain(game);
    }
    return { ok: true };`,
    testName: "cards and abilities use every first and later two-player Execute window through Finalize",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "execute-pass-keeps-priority",
    search: "giveActionChainPriority(game, otherActionChainPlayerId(game.actionChain, playerId));",
    replacement: "giveActionChainPriority(game, playerId);",
    testName: "cards and abilities use every first and later two-player Execute window through Finalize",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "resolved-card-trigger-skips-existing-chain",
    search: `    : context.chainKind === "action"
      ? "actionChain"`,
    replacement: `    : context.chainKind === "action"
      ? "queue"`,
    testName: "a Pending trigger created during Resolve re-enters Finalize before the next Execute window",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "showdown-item-remains-pending",
    search: `function finalizePendingChainItems(game) {
  const pending = normalizeChainItems(game.showdown)
    .filter((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!pending.length) return;
  for (const item of pending) {
    item.status = "finalized";
    requestCleanup(game, "pending-item-finalized", { itemId: item.id, itemType: item.itemType });
  }`,
    replacement: `function finalizePendingChainItems(game) {
  const pending = normalizeChainItems(game.showdown)
    .filter((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!pending.length) return;
  for (const item of pending) {
    item.status = "pending";
    requestCleanup(game, "pending-item-finalized", { itemId: item.id, itemType: item.itemType });
  }`,
    testName: "interactive showdown spells can enter manual payment and join the chain"
  },
  {
    id: "permanent-waits-for-execute",
    search: `if (item.itemType === "card") return ["unit", "gear"].includes(item.card?.type);`,
    replacement: `if (item.itemType === "card") return false;`,
    testName: "Units and Gear resolve during Finalize without waiting for the Pass step",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "token-counts-as-card-play",
    search: "  return recordResolvedPlay(game, player, playedToken, { isCard: false, continuation });",
    replacement: "  return recordResolvedPlay(game, player, playedToken, { isCard: true, continuation });",
    testName: "playing a token is a Unit play but not a card play",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "effect-played-spell-resolves-inside-enclosing-effect",
    search: `  addPendingChainItem(game, chainState, played, player.id, destination, {
    ...options,
    effectPlay: true,
    playProcess: { kind: "cardPlay" },
    declarationsComplete: false
  });`,
    replacement: `  if (played.type === "spell") {
    if (!resolveEffect(game, player, played)) finishSpell(game, player, played);
    return true;
  }
  addPendingChainItem(game, chainState, played, player.id, destination, {
    ...options,
    effectPlay: true,
    playProcess: { kind: "cardPlay" },
    declarationsComplete: false
  });`,
    testName: "a card played by a resolving effect waits for that effect and grants a new response window",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "effect-played-target-skips-declaration",
    search: `    effectPlay: true,
    playProcess: { kind: "cardPlay" },
    declarationsComplete: false`,
    replacement: `    effectPlay: true,
    playProcess: { kind: "cardPlay" },
    declarationsComplete: true`,
    testName: "an effect-played targeted card declares its target while Pending and before Finalize",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "public-spell-target-chosen-on-resolution",
    search: "    const declaration = spellTargetDeclaration(spec);",
    replacement: "    const declaration = spec.kind === \"saveFriendlyUnitThisTurn\" ? null : spellTargetDeclaration(spec);",
    testName: "Highlander declares its public friendly-unit target before payment",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "aggregate-target-repair-collapses-to-empty",
    search: "  const subsets = legalAggregateTargetSubsets(game, selectedIds, maxMight);",
    replacement: "  const subsets = [{ units: [], battlefield: null, totalMight: 0 }];",
    testName: "aggregate targets repair only from the original legal target set at resolution",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "split-damage-applies-before-division-completes",
    search: "  state.allocations = [...(state.allocations || []), { targetId: context.option.cardId, amount }];",
    replacement: `  applyDamage(context.game, context.player, context.source, findCard(context.game, context.option.cardId), amount);
  state.allocations = [...(state.allocations || []), { targetId: context.option.cardId, amount }];`,
    testName: "split damage fixes targets before resolution but divides amounts only during resolution",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "deterministically-illegal-play-target-remains-selectable",
    search: "  if (!alternatives.length) return options;\n  return options.filter((option) => !option.cardId || !deterministicallyRemovedIds.has(option.cardId));",
    replacement: "  return options;",
    testName: "play declarations reject a target that its own chosen additional cost will certainly remove",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "up-to-zero-target-requires-one",
    search: "    const canFinish = (declaration.min ?? 1) === 0;",
    replacement: "    const canFinish = (declaration.min || 1) === 0;",
    testName: "an up-to target declaration may explicitly choose zero before payment",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "only-deterministically-removed-target-is-rejected",
    search: "  if (!alternatives.length) return options;",
    replacement: "  if (!alternatives.length) return [];",
    testName: "a deterministically removed target remains legal only when no alternative choice exists",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "new-chain-item-keeps-prior-passes",
    search: `function resetChainPassCycle(chainState) {
  chainState.consecutivePasses = 0;
}`,
    replacement: `function resetChainPassCycle(chainState) {
  chainState.consecutivePasses = Math.max(1, chainState.consecutivePasses || 0);
}`,
    testName: "adding a Chain Item resets prior passes before the next Pass cycle",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "chain-requires-extra-pass",
    search: "return chainState.consecutivePasses >= participantIds.length;",
    replacement: "return chainState.consecutivePasses > participantIds.length;",
    testName: "Neutral and Showdown Chains require one uninterrupted all-player Pass cycle per resolved Item",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "chain-resolves-before-all-pass",
    search: "return chainState.consecutivePasses >= participantIds.length;",
    replacement: "return chainState.consecutivePasses >= participantIds.length - 1;",
    testName: "Neutral and Showdown Chains require one uninterrupted all-player Pass cycle per resolved Item",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "action-remaining-priority-to-turn-player",
    search: "giveActionChainPriority(game, remaining.at(-1).playerId);",
    replacement: "giveActionChainPriorityToTurnPlayer(game);",
    testName: "non-showdown chain gives Priority to the newest remaining item's controller"
  },
  {
    id: "showdown-remaining-priority-to-focus",
    search: "giveShowdownPriority(game, remaining.at(-1).playerId);",
    replacement: "giveShowdownPriority(game, currentShowdownFocusId(showdown));",
    testName: "showdown chain keeps Focus but gives Priority to the newest remaining item's controller"
  },
  {
    id: "played-card-chain-keeps-focus-when-empty",
    search: "if (!suppressFocusPass) showdown.focusPlayerId = otherShowdownPlayerId(showdown, currentShowdownFocusId(showdown));",
    replacement: "if (false) showdown.focusPlayerId = otherShowdownPlayerId(showdown, currentShowdownFocusId(showdown));",
    testName: "a Showdown Chain opened by a played card passes Focus when it empties"
  },
  {
    id: "showdown-focus-goes-to-defender",
    search: "    focusPlayerId: attackerId,",
    replacement: "    focusPlayerId: defenderId,",
    testName: "standard and effect movement give Showdown Focus to the player who applied Contested",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "showdown-settles-before-exit-cleanup",
    search: `  game.showdownExitProcess = {
    battlefieldId: showdown.battlefieldId,
    turnPlayerId: showdown.turnPlayerId,
    attackerId: showdown.attackerId,
    defenderId: showdown.defenderId,
    combat: showdown.combat !== false
  };
  requestCleanup(game, "state-transition", { from: "showdown", to: "neutral" });
  requestCleanup(game, "phase-transition", { from: "showdown", to: "action" });
  checkState(game);`,
    replacement: `  game.showdownExitProcess = {
    battlefieldId: showdown.battlefieldId,
    turnPlayerId: showdown.turnPlayerId,
    attackerId: showdown.attackerId,
    defenderId: showdown.defenderId,
    combat: showdown.combat !== false
  };
  requestCleanup(game, "state-transition", { from: "showdown", to: "neutral" });
  requestCleanup(game, "phase-transition", { from: "showdown", to: "action" });
  completeShowdownExitTask(game);`,
    testName: "Showdown exit Cleanup precedes Combat and Conquer settlement",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "add-empty-chain-passes-focus",
    search: `    if (kind === "showdown") {
      delete chainState.suppressFocusPassOnEmpty;
      delete chainState.chainOpenedBy;
    } else {`,
    replacement: `    if (kind === "showdown") {
      delete chainState.suppressFocusPassOnEmpty;
      delete chainState.chainOpenedBy;
      chainState.focusPlayerId = otherShowdownPlayerId(chainState, currentShowdownFocusId(chainState));
      giveShowdownPriority(game, chainState.focusPlayerId);
    } else {`,
    testName: "an Add ability that opens and empties its transient Showdown Chain does not pass Focus",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "trigger-empty-chain-passes-focus",
    search: `    const suppressFocusPass = showdown.suppressFocusPassOnEmpty
      || ["trigger", "add"].includes(showdown.chainOpenedBy);`,
    replacement: `    const suppressFocusPass = showdown.chainOpenedBy === "add";`,
    testName: "a Showdown Chain opened by a triggered ability does not pass Focus when it empties"
  },
  {
    id: "ending-expiration-order",
    search: `  recordRuleTask(game, "317.2.c", "expire-this-turn-effects");
  expireThisTurnEffects(game);
  recordRuleTask(game, "317.2.d", "empty-rune-pools");
  clearAllRunePools(game);`,
    replacement: `  recordRuleTask(game, "317.2.d", "empty-rune-pools");
  clearAllRunePools(game);
  recordRuleTask(game, "317.2.c", "expire-this-turn-effects");
  expireThisTurnEffects(game);`,
    testName: "start, cleanup, and Ending tasks follow the independent official order",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "ending-skips-staged-showdown",
    search: "if (resolveStagedEvents(game)) return;",
    replacement: "if (false && resolveStagedEvents(game)) return;",
    testName: "cleanup downgrades an invalid staged combat to the remaining contested showdown before Ending"
  },
  {
    id: "activated-cost-modifiers-skipped",
    search: "    const modifiers = collectActivatedAbilityCostModifiers(game, player, card, specs);",
    replacement: "    const modifiers = [];",
    testName: "activated ability costs apply shared increases, component discounts, and discount minima",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "activated-use-event-not-recorded",
    search: "  player.activatedAbilitiesResolved = [...(player.activatedAbilitiesResolved || []), event].slice(-100);",
    replacement: "  return null;",
    testName: "using an activated ability becomes true only when that ability resolves",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "noncombat-upgrade-double-designates-before-attack-trigger",
    search: "  const triggers = collectAttackOrDefendTriggers(game, battlefield, showdown.attackerId);",
    replacement: `  assignCombatDesignations(game, battlefield, showdown.attackerId);
  const triggers = collectAttackOrDefendTriggers(game, battlefield, showdown.attackerId);`,
    testName: "a non-combat showdown upgrade checks attack triggers exactly at the new designation"
  },
  {
    id: "combat-role-regain-rechecks-trigger",
    search: "      if (unit.combatTriggerChecks[combatId][role]) return false;",
    replacement: "      if (false) return false;",
    testName: "losing and regaining a combat role does not check that role twice in one combat"
  },
  {
    id: "mandatory-card-death-replacement-becomes-optional",
    search: `    if (replacementEffect(sourceCard, "saveFriendlyUnitByKillingThis")) {
      candidates.push({
        key: \`card:\${sourceCard.instanceId}\`,
        type: "card",
        sourceCard,
        optional: false,`,
    replacement: `    if (replacementEffect(sourceCard, "saveFriendlyUnitByKillingThis")) {
      candidates.push({
        key: \`card:\${sourceCard.instanceId}\`,
        type: "card",
        sourceCard,
        optional: true,`,
    testName: "a mandatory card replacement applies automatically even when the affected unit has a different owner"
  },
  {
    id: "death-replacement-order-goes-to-controller",
    search: `  const chooserId = candidates.length > 1
    ? unit.ownerId
    : candidates[0]?.sourceCard?.controllerId;`,
    replacement: `  const chooserId = unit.controllerId;`,
    testName: "the affected object's owner orders multiple mandatory replacement effects"
  },
  {
    id: "simultaneous-replacement-selection-prompts-again",
    search: "  const selectedByPreference = (preference?.kind === \"source\" || preference?.kind === \"event\")",
    replacement: "  const selectedByPreference = preference?.kind === \"source\"",
    testName: "a simultaneous event choice retains its selected replacement source"
  },
  {
    id: "inactive-replacement-source-remains-eligible",
    search: "  const location = findActiveCardLocation(game, candidate.sourceCard?.instanceId);\n  return Boolean(location?.card && location.card.controllerId === candidate.sourceCard.controllerId);",
    replacement: "  const location = { card: findCard(game, candidate.sourceCard?.instanceId) };\n  return Boolean(location?.card && location.card.controllerId === candidate.sourceCard.controllerId);",
    testName: "a simultaneous event choice retains its selected replacement source"
  },
  {
    id: "simultaneous-replacement-cannot-decline",
    search: "      ...(replacement.optional",
    replacement: "      ...(false",
    testName: "a simultaneous replacement event can be declined without consuming its source"
  },
  {
    id: "delayed-damage-trigger-skipped",
    search: "    queueDelayedUnitDamageTriggers(game, target, target.lastDamageEvent, options.deferredTriggerBatches || null);",
    replacement: "    // Mutant: omit the delayed event trigger.",
    testName: "delayed triggers keep independent linked sets and resolve after their source leaves",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "delayed-trigger-requires-live-source",
    search: `function resolveQueuedTrigger(game, trigger) {
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;`,
    replacement: `function resolveQueuedTrigger(game, trigger) {
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId);`,
    testName: "delayed triggers keep independent linked sets and resolve after their source leaves",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "delayed-event-consumes-unrelated-linked-sets",
    search: "  game.delayedAbilities = game.delayedAbilities.filter((ability) => !consumed.has(ability.id));",
    replacement: "  game.delayedAbilities = [];",
    testName: "delayed triggers keep independent linked sets and resolve after their source leaves",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "delayed-passive-does-not-stack",
    search: "    player.nextSpellBonusDamage = (player.nextSpellBonusDamage || 0) + (spec.amount || 1);",
    replacement: "    player.nextSpellBonusDamage = Math.max(player.nextSpellBonusDamage || 0, spec.amount || 1);",
    testName: "independent Ravenborn Tome delayed passives stack after their sources leave"
  },
  {
    id: "activated-final-legality-recheck-skipped",
    search: `  if (payment.source === "activatedAbility") {
    const legality = activatedAbilityFinalizationLegality(game, player, card, payment.activatedAbility?.specs || []);
    if (!legality.ok) {`,
    replacement: `  if (payment.source === "activatedAbility") {
    const legality = activatedAbilityFinalizationLegality(game, player, card, payment.activatedAbility?.specs || []);
    if (false && !legality.ok) {`,
    testName: "an activated ability legality failure rolls back its complete Pending transaction"
  },
  {
    id: "cleanup-cause-registry-disabled",
    search: "  game.cleanupRequestTrace.push({",
    replacement: "  false && game.cleanupRequestTrace.push({",
    testName: "every Cleanup request cause is recorded at its shared engine boundary",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "expiration-fepr-repeat-marker-skipped",
    search: "    if (game.endingCleanupProcess) game.endingCleanupProcess.itemsUnderwentFepr = true;",
    replacement: "    if (false && game.endingCleanupProcess) game.endingCleanupProcess.itemsUnderwentFepr = true;",
    testName: "Ending Expiration repeats exactly once after a Pending item undergoes FEPR",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "cleanup-misplaced-combat-roles-retained",
    search: "  for (const field of game.battlefields) {\n    if (field.instanceId === battlefield.instanceId) continue;",
    replacement: "  for (const field of []) {\n    if (field.instanceId === battlefield.instanceId) continue;",
    testName: "Cleanup corrects every missing, opposite, and misplaced combat designation",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "cleanup-opposite-combat-role-retained",
    search: "    if (unit.combatRole === nextRole) continue;",
    replacement: "    if (unit.combatRole) continue;",
    testName: "Cleanup corrects every missing, opposite, and misplaced combat designation",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "single-staged-combat-not-started",
    search: "  if (game.stagedEvents.length === 1 || !game.interactive) {",
    replacement: "  if (!game.interactive) {",
    testName: "a Combat-only staged task begins Combat before the pending Ending Step",
    testFile: "tests/rules-conformance.test.mjs"
  },
  {
    id: "cleanup-unattached-gear-not-recalled",
    search: "      if (permanent.type !== \"gear\") continue;",
    replacement: "      if (true) continue;",
    testName: "cleanup recalls unattached Gear and board objects from the wrong controller's base"
  },
  {
    id: "cleanup-foreign-base-permanent-not-recalled",
    search: "      if (!controller || controller.id === host.id) continue;\n      host.base.splice(index, 1);",
    replacement: "      if (true || !controller || controller.id === host.id) continue;\n      host.base.splice(index, 1);",
    testName: "cleanup recalls unattached Gear and board objects from the wrong controller's base"
  },
  {
    id: "cleanup-foreign-rune-not-recalled",
    search: "      if (!controller || controller.id === host.id) continue;\n      host.runes.splice(index, 1);",
    replacement: "      if (true || !controller || controller.id === host.id) continue;\n      host.runes.splice(index, 1);",
    testName: "cleanup recalls unattached Gear and board objects from the wrong controller's base"
  },
  {
    id: "cleanup-invalid-hidden-not-trashed",
    search: "      if (field.controlledBy === hiddenCardControllerId(item)) continue;",
    replacement: "      if (true || field.controlledBy === hiddenCardControllerId(item)) continue;",
    testName: "hidden cards are trashed during cleanup when their controller loses the battlefield"
  },
  {
    id: "ready-step-clears-stunned",
    search: "  for (const card of controlledCardsAtReadyStep) {\n    card.cantMoveThisTurn = false;",
    replacement: "  for (const card of controlledCardsAtReadyStep) {\n    card.stunned = false;\n    card.cantMoveThisTurn = false;",
    testName: "Ready Step does not clear Stunned after the next Ending Step has already begun"
  },
  {
    id: "ready-step-skips-controlled-battlefields",
    search: "    ...allControlledCards(game, player.id),\n    ...game.battlefields.filter((field) => field.controlledBy === player.id)",
    replacement: "    ...allControlledCards(game, player.id),\n    ...[]",
    testName: "Ready Step readies every controlled non-spell object including a Battlefield"
  },
  {
    id: "cleanup-facdown-overflow-not-repaired",
    search: "    const overflow = Math.max(0, hidden.length - hiddenSlotLimit(field));",
    replacement: "    const overflow = 0;",
    testName: "Cleanup lets the Facedown Zone controller choose cards discarded after its capacity decreases"
  }
];

const runtimeMutants = [
  {
    id: "attached-rules-text-remains-active",
    search: "  if (card?.attachedToId && textSection === \"rules\") return false;",
    replacement: "  if (false) return false;",
    testName: "attached Rules Text is inactive while Effect Text is appended to the Top-Most card"
  }
];

const deckRuleMutants = [
  {
    id: "tournament-main-deck-allows-over-40",
    search: "if (format === DECK_FORMATS.TOURNAMENT && mainCount !== DECK_RULES.tournamentMainExact) {",
    replacement: "if (format === DECK_FORMATS.TOURNAMENT && mainCount < DECK_RULES.tournamentMainExact) {",
    testName: "tournament decks require exactly 40 Main Deck cards and at most 8 Sideboard cards",
    testFile: "tests/match.test.mjs"
  },
  {
    id: "tournament-main-deck-allows-under-40",
    search: "if (format === DECK_FORMATS.TOURNAMENT && mainCount !== DECK_RULES.tournamentMainExact) {",
    replacement: "if (format === DECK_FORMATS.TOURNAMENT && mainCount > DECK_RULES.tournamentMainExact) {",
    testName: "tournament decks require exactly 40 Main Deck cards and at most 8 Sideboard cards",
    testFile: "tests/match.test.mjs"
  },
  {
    id: "sideboard-only-champion-is-accepted",
    search: "const mainChampionCount = mainEntries.reduce((total, [number, count]) => total + (championMatchesLegend(cardByNumber(number), legend) ? count : 0), 0);",
    replacement: "const mainChampionCount = registeredEntries.reduce((total, [number, count]) => total + (championMatchesLegend(cardByNumber(number), legend) ? count : 0), 0);",
    testName: "deck validation requires a real Champion card and rejects off-identity runes",
    testFile: "tests/engine.test.mjs"
  }
];

const failures = [];
for (const mutant of engineMutants) {
  const mutantEngine = path.join(ROOT, "src", `.mutant-${mutant.id}.mjs`);
  const mutantTest = path.join(ROOT, "tests", `.mutant-${mutant.id}.test.mjs`);
  try {
    const source = replaceExactlyOnce(fs.readFileSync(ENGINE, "utf8"), mutant.search, mutant.replacement, mutant.id);
    const sourceTest = mutant.testFile ? path.join(ROOT, mutant.testFile) : ENGINE_TEST;
    const testSource = fs.readFileSync(sourceTest, "utf8")
      .replace('from "../src/engine.mjs";', `from "../src/.mutant-${mutant.id}.mjs";`);
    fs.writeFileSync(mutantEngine, source);
    fs.writeFileSync(mutantTest, testSource);
    const run = spawnSync(process.execPath, ["--test", `--test-name-pattern=${mutant.testName}`, mutantTest], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    assess(mutant.id, run);
  } finally {
    fs.rmSync(mutantEngine, { force: true });
    fs.rmSync(mutantTest, { force: true });
  }
}

for (const mutant of runtimeMutants) runRuntimeMutant(mutant);
for (const mutant of deckRuleMutants) runDeckRuleMutant(mutant);
runCardDataMutant();

if (failures.length) {
  console.error(`Mutation testing failed (${failures.length} surviving/invalid mutants):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Killed ${engineMutants.length + runtimeMutants.length + deckRuleMutants.length + 1} regression mutants covering duel rules, effect text, deck legality, and published card costs.`);

function runRuntimeMutant(mutant) {
  const mutantRuntime = path.join(ROOT, "src", "effects", `.mutant-${mutant.id}.mjs`);
  const mutantEngine = path.join(ROOT, "src", `.mutant-${mutant.id}.mjs`);
  const mutantTest = path.join(ROOT, "tests", `.mutant-${mutant.id}.test.mjs`);
  try {
    const runtimeSource = replaceExactlyOnce(
      fs.readFileSync(EFFECT_RUNTIME, "utf8"),
      mutant.search,
      mutant.replacement,
      mutant.id
    );
    const engineSource = replaceExactlyOnce(
      fs.readFileSync(ENGINE, "utf8"),
      'from "./effects/runtime.mjs";',
      `from "./effects/.mutant-${mutant.id}.mjs";`,
      `${mutant.id}-engine-import`
    );
    const testSource = fs.readFileSync(ENGINE_TEST, "utf8")
      .replace('from "../src/engine.mjs";', `from "../src/.mutant-${mutant.id}.mjs";`);
    fs.writeFileSync(mutantRuntime, runtimeSource);
    fs.writeFileSync(mutantEngine, engineSource);
    fs.writeFileSync(mutantTest, testSource);
    const run = spawnSync(process.execPath, ["--test", `--test-name-pattern=${mutant.testName}`, mutantTest], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    assess(mutant.id, run);
  } finally {
    fs.rmSync(mutantRuntime, { force: true });
    fs.rmSync(mutantEngine, { force: true });
    fs.rmSync(mutantTest, { force: true });
  }
}

function runDeckRuleMutant(mutant) {
  const mutantRules = path.join(ROOT, "src", "decks", `.mutant-${mutant.id}.mjs`);
  const mutantTest = path.join(ROOT, "tests", `.mutant-${mutant.id}.test.mjs`);
  try {
    const source = replaceExactlyOnce(fs.readFileSync(DECK_RULES, "utf8"), mutant.search, mutant.replacement, mutant.id);
    const testSource = fs.readFileSync(path.join(ROOT, mutant.testFile), "utf8")
      .replace('from "../src/decks/rules.mjs";', `from "../src/decks/.mutant-${mutant.id}.mjs";`);
    fs.writeFileSync(mutantRules, source);
    fs.writeFileSync(mutantTest, testSource);
    const run = spawnSync(process.execPath, ["--test", `--test-name-pattern=${mutant.testName}`, mutantTest], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    assess(mutant.id, run);
  } finally {
    fs.rmSync(mutantRules, { force: true });
    fs.rmSync(mutantTest, { force: true });
  }
}

function runCardDataMutant() {
  const id = "annie-missing-power";
  const mutantCards = path.join(ROOT, "src", "cards", `.mutant-${id}.mjs`);
  const mutantTest = path.join(ROOT, "tests", `.mutant-${id}.test.mjs`);
  try {
    const source = replaceExactlyOnce(
      fs.readFileSync(OGS, "utf8"),
      "energy:5,power:[{domain:DOMAINS.FURY,amount:1}],might:4",
      "energy:5,power:[],might:4",
      id
    );
    const testSource = `
import test from "node:test";
import assert from "node:assert/strict";
import { ogsCards } from "../src/cards/.mutant-${id}.mjs";
import { comparePublishedCards, officialOgsSnapshot } from "../scripts/validate-rule-contracts.mjs";
test("official Annie cost mutation is rejected", () => {
  const snapshot = { ...officialOgsSnapshot, cards: officialOgsSnapshot.cards.filter((card) => card.cardNumber === "OGS-001/024") };
  assert.deepEqual(comparePublishedCards(Object.values(ogsCards), snapshot), []);
});
`;
    fs.writeFileSync(mutantCards, source);
    fs.writeFileSync(mutantTest, testSource);
    const run = spawnSync(process.execPath, ["--test", mutantTest], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    assess(id, run);
  } finally {
    fs.rmSync(mutantCards, { force: true });
    fs.rmSync(mutantTest, { force: true });
  }
}

function assess(id, run) {
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  if (/SyntaxError|ERR_MODULE_NOT_FOUND|ReferenceError/.test(output)) {
    failures.push(`${id}: invalid mutant/test harness\n${tail(output)}`);
    return;
  }
  if (run.status === 0) {
    failures.push(`${id}: survived (the targeted regression test still passed)`);
    return;
  }
  if (!/not ok/i.test(output)) {
    failures.push(`${id}: failed without an assertion failure\n${tail(output)}`);
    return;
  }
  console.log(`Killed mutant: ${id}`);
}

function replaceExactlyOnce(source, search, replacement, id) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${id}: expected one mutation point, found ${count}`);
  return source.replace(search, replacement);
}

function tail(value) {
  return value.trim().split(/\r?\n/).slice(-12).join("\n");
}
