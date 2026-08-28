import { cardReactionPermissionSources, keywordListHas, printedKeywordValue, temporaryKeywordValue } from "../rules/keywords.mjs";
import { hiddenCardIsControlledBy } from "../rules/zones.mjs";
import { currentCombatMight } from "../engine.mjs";
import { cardResourceAffordability } from "./resource-strategy.mjs";

const BENEFICIAL_EFFECTS = new Set([
  "modifyMight", "readyUnit", "heal", "preventDamage", "grantKeyword",
  "attachGear", "createToken", "drawCards", "gainBuff"
]);

const HARMFUL_EFFECTS = new Set([
  "damage", "dealDamage", "killUnit", "stunUnit", "exhaustUnit", "discardCards",
  "banishUnit", "returnUnitToHand", "reduceMight"
]);

// Legal-action enumeration, policy encoding and teacher routing inspect the
// same action several times at one decision boundary. Action objects are
// recreated at the next boundary, so weak action-keyed caches avoid repeating
// the expensive combat/follow-up analysis without surviving game mutations.
const TACTICAL_PROFILE_CACHE = new WeakMap();
const MOVEMENT_PROFILE_CACHE = new WeakMap();

export function tacticalActionProfile(game, actorId, action) {
  return cachedActionProfile(TACTICAL_PROFILE_CACHE, game, action, actorId, () =>
    computeTacticalActionProfile(game, actorId, action));
}

function computeTacticalActionProfile(game, actorId, action) {
  const choice = game?.pendingChoice || null;
  const option = choice?.options?.find((candidate) =>
    String(candidate?.id ?? candidate?.value ?? candidate) === String(action?.optionId));
  const source = findCard(game, action?.cardId || action?.unitId || action?.unitIds?.[0])
    || (action?.kind === "beginPlayChampion" ? player(game, actorId)?.champion : null)
    || choice?.card
    || findCard(game, choice?.sourceId);
  const target = findCard(game,
    option?.cardId || option?.unitId || choice?.data?.targetId || action?.unitId || action?.unitIds?.[0]);
  const destinationId = action?.destinationId || action?.destination || option?.destination
    || (isLocation(game, option?.id) ? option.id : null);
  const specs = choice
    ? choiceSpecs(choice, source)
    : ["beginPlayCard", "beginPlayChampion", "activateCard"].includes(action?.kind)
      ? source?.effects || []
      : [];
  const polarity = effectPolarity(specs);
  const targetRelation = target?.controllerId === actorId
    ? "friendly"
    : target?.controllerId ? "enemy" : "none";
  const targetAlignment = polarity === "beneficial"
    ? targetRelation === "friendly" ? 1 : targetRelation === "enemy" ? -1 : 0
    : polarity === "harmful"
      ? targetRelation === "enemy" ? 1 : targetRelation === "friendly" ? -1 : 0
      : 0;
  const drawUrgency = playerDrawUrgency(game, actorId);
  const casterSideBenefit = casterBenefit(specs, drawUrgency);
  const pendingThreat = pendingTargetThreat(game, target);
  const buffAmount = effectAmount(specs);
  const savesFromLethal = targetRelation === "friendly" && polarity === "beneficial"
    && pendingThreat.damage >= pendingThreat.remainingMight
    && pendingThreat.damage < pendingThreat.remainingMight + buffAmount;
  const targetImpact = savesFromLethal ? 1 : targetEffectImpact(game, actorId, target, specs, polarity);
  const destructiveTargetEffect = hasDestructiveTargetEffect(specs);
  const targetAlreadyThreatened = targetRelation === "friendly"
    && Boolean(target?.instanceId)
    && hasOpponentChainItem(game, actorId)
    && chainThreatensCard(game, actorId, target.instanceId);
  const friendlyDestructionPayoff = targetRelation === "friendly"
    && destructiveTargetEffect
    && friendlyDestructionHasExplicitPayoff(game, actorId, target, specs);
  const independentOpponentImpact = effectHasIndependentOpponentImpact(specs);
  // A Draw rider is not by itself permission to damage or kill a healthy
  // friendly unit. Keep genuinely ambiguous sacrifice lines for the teacher,
  // but hard-reject a line that only consumes our target, card and resources.
  const clearlySelfDestructive = targetAlignment < 0
    && targetRelation === "friendly"
    && destructiveTargetEffect
    && !friendlyDestructionPayoff
    && !(targetAlreadyThreatened && casterSideBenefit > 0)
    && !independentOpponentImpact;
  const movement = movementProfile(game, actorId, action, destinationId);
  const wastedTargetRisk = playTargetRisk(game, actorId, action, source);
  const tacticalPrior = clamp(
    targetAlignment * (polarity === "beneficial" ? 1.8 : 1.35) * targetImpact
      + casterSideBenefit
      + (savesFromLethal ? 1.2 : 0)
      + movement.prior
      + wastedTargetRisk,
    -3,
    2
  );
  return {
    sourceCardNumber: source?.cardNumber || null,
    targetCardNumber: target?.cardNumber || null,
    targetRelation,
    polarity,
    targetAlignment,
    casterSideBenefit,
    drawUrgency,
    incomingDamage: pendingThreat.damage,
    savesFromLethal,
    targetImpact,
    effectAmount: effectAmount(specs),
    targetMight: currentUnitMight(target),
    destructiveTargetEffect,
    targetAlreadyThreatened,
    friendlyDestructionPayoff,
    independentOpponentImpact,
    clearlySelfDestructive,
    destinationId,
    ...movement,
    wastedTargetRisk,
    tacticalPrior
  };
}

export function tacticalActionPrior(game, actorId, action) {
  // This is deliberately a weak, generic prior. The simulation teacher and
  // learned value heads decide whether a normally awkward play is correct in
  // the current score, resource and response context.
  return tacticalActionProfile(game, actorId, action).tacticalPrior * 0.45;
}

export function temporaryCommitmentProfile(game, actorId, action) {
  if (!["beginPlayCard", "activateCard"].includes(action?.kind)) {
    return { isTemporaryCommitment: false, clearPurpose: true, reason: "not-temporary-commitment" };
  }
  const source = findCard(game, action.cardId);
  if (!source) return { isTemporaryCommitment: false, clearPurpose: true, reason: "unknown-source" };
  const specs = selectedActionSpecs(source, action);
  const flattened = flattenEffectSpecs(specs);
  const isTemporaryCommitment = flattened.some((spec) => spec?.temporary === true
    || spec?.untilEndOfTurn === true
    || /this turn|end of (?:the )?turn/iu.test(String(spec?.duration || "")))
    || /this turn/iu.test(String(source.text || ""));
  if (!isTemporaryCommitment) {
    return { isTemporaryCommitment: false, clearPurpose: true, reason: "lasting-effect" };
  }
  const leavesPermanent = action.kind === "beginPlayCard" && source.type !== "spell";
  const durableBenefit = flattened.some((spec) => {
    const kind = String(spec?.kind || "").toLowerCase();
    return Number(spec?.draw || spec?.gainXp || spec?.xp || 0) > 0
      || /draw|predict|channel|create|gainbuff|discard|damage|kill|destroy|banish|return|recall/.test(kind);
  });
  const responseWindow = Boolean(game.showdown || game.actionChain)
    && temporaryResponseCanMatter(game, actorId, flattened);
  const breakthrough = temporaryBreakthroughOpportunity(game, actorId, flattened);
  const clearPurpose = leavesPermanent || durableBenefit || responseWindow || breakthrough;
  return {
    isTemporaryCommitment,
    clearPurpose,
    reason: leavesPermanent ? "permanent-body"
      : durableBenefit ? "durable-side-benefit"
        : responseWindow ? "active-response-window"
          : breakthrough ? "breakthrough-setup"
            : "no-current-turn-payoff"
  };
}

export function temporaryChoicePurposeProfile(game, actorId, action) {
  if (action?.kind !== "chooseEffectOption" || !game?.pendingChoice) {
    return { isTemporaryChoice: false, clearPurpose: true, reason: "not-temporary-choice" };
  }
  const choice = game.pendingChoice;
  const source = choice.card || findCard(game, choice.sourceId);
  const option = (choice.options || []).find((candidate) =>
    String(candidate?.id ?? candidate?.value ?? candidate) === String(action.optionId));
  const specs = choiceSpecs(choice, source);
  const flattened = flattenEffectSpecs(specs);
  const isTemporaryChoice = flattened.some((spec) => spec?.temporary === true)
    || /this turn/iu.test(String(source?.text || ""));
  if (!isTemporaryChoice) {
    return { isTemporaryChoice: false, clearPurpose: true, reason: "lasting-choice" };
  }
  const durableBenefit = flattened.some((spec) => {
    const kind = String(spec?.kind || "").toLowerCase();
    return Number(spec?.draw || spec?.gainXp || spec?.xp || 0) > 0
      || /draw|predict|channel|create|gainbuff|discard|damage|kill|destroy|banish|return|recall/.test(kind);
  });
  if (durableBenefit) {
    return { isTemporaryChoice: true, clearPurpose: true, reason: "durable-side-benefit" };
  }
  const target = findCard(game, option?.cardId || option?.unitId || option?.id);
  if (!target) return { isTemporaryChoice: true, clearPurpose: false, reason: "no-tactical-target" };
  const polarity = effectPolarity(flattened);
  const friendly = target.controllerId === actorId;
  if (game.showdown) {
    const aligned = (polarity === "beneficial" && friendly) || (polarity === "harmful" && !friendly);
    return { isTemporaryChoice: true, clearPurpose: aligned, reason: aligned ? "showdown-response" : "misaligned-showdown-target" };
  }
  if (game.actionChain && hasOpponentChainItem(game, actorId)) {
    const threatened = chainThreatensCard(game, actorId, target.instanceId);
    const aligned = (polarity === "beneficial" && friendly && threatened)
      || (polarity === "harmful" && !friendly);
    return { isTemporaryChoice: true, clearPurpose: aligned, reason: aligned ? "chain-response" : "unrelated-chain-target" };
  }
  const breakthrough = temporaryTargetCreatesBreakthrough(game, actorId, target, flattened);
  return {
    isTemporaryChoice: true,
    clearPurpose: breakthrough,
    reason: breakthrough ? "breakthrough-target" : "no-current-turn-target-payoff"
  };
}

function hasOpponentChainItem(game, actorId) {
  return [...(game.actionChain?.chain || []), ...(game.showdown?.chain || [])].some((item) => {
    const source = item?.card || findCard(game, item?.cardId || item?.sourceId);
    const controllerId = item?.playerId || source?.controllerId;
    return controllerId && controllerId !== actorId;
  });
}

function chainThreatensCard(game, actorId, targetId) {
  return [...(game.actionChain?.chain || []), ...(game.showdown?.chain || [])].some((item) => {
    const source = item?.card || findCard(game, item?.cardId || item?.sourceId);
    const controllerId = item?.playerId || source?.controllerId;
    if (!controllerId || controllerId === actorId) return false;
    const targets = item?.declaredTargets || item?.data?.declaredTargets || source?.declaredPlayTargets || [];
    return targets.some((target) => (target.targetId || target.cardId || target.unitId) === targetId);
  });
}

function temporaryTargetCreatesBreakthrough(game, actorId, target, specs) {
  const signedMight = flattenEffectSpecs(specs).reduce((sum, spec) =>
    spec?.kind === "modifyMight" ? sum + (Number(spec.amount) || 0) : sum, 0);
  if (!signedMight) return false;
  const adjustedTarget = {
    ...target,
    mightModifier: (Number(target.mightModifier) || 0) + signedMight,
    temporaryMight: (Number(target.temporaryMight) || 0) + signedMight
  };
  const adjustedGame = withCardReplacement(game, adjustedTarget);
  const actor = player(adjustedGame, actorId);
  if (!actor) return false;
  for (const field of adjustedGame.battlefields || []) {
    if (!(field.units || []).some((unit) => unit.controllerId !== actorId)) continue;
    const targetIsThere = (field.units || []).some((unit) => unit.instanceId === target.instanceId);
    const movers = [
      ...(actor.base || []).filter((unit) => unit.type === "unit" && !unit.exhausted && !unit.cantMoveThisTurn),
      ...(adjustedGame.battlefields || []).flatMap((other) => other === field ? [] : (other.units || [])
        .filter((unit) => unit.controllerId === actorId && !unit.exhausted && !unit.cantMoveThisTurn
          && hasKeywordApprox(unit, "Ganking")))
    ];
    if (!targetIsThere && !movers.some((unit) => unit.instanceId === target.instanceId)) continue;
    if (!movers.length) continue;
    const action = movers.length === 1
      ? { kind: "moveUnit", unitId: movers[0].instanceId, destinationId: field.instanceId }
      : { kind: "moveUnits", unitIds: movers.map((unit) => unit.instanceId), destinationId: field.instanceId };
    if (movementProfile(adjustedGame, actorId, action).canRemoveEnemyNoResponse) return true;
  }
  return false;
}

function withCardReplacement(game, replacement) {
  const replace = (card) => card?.instanceId === replacement.instanceId ? replacement : card;
  return {
    ...game,
    players: (game.players || []).map((candidate) => ({
      ...candidate,
      legend: replace(candidate.legend),
      champion: replace(candidate.champion),
      hand: (candidate.hand || []).map(replace),
      base: (candidate.base || []).map(replace)
    })),
    battlefields: (game.battlefields || []).map((field) => ({
      ...field,
      units: (field.units || []).map(replace)
    }))
  };
}

function selectedActionSpecs(source, action) {
  if (action.kind !== "activateCard" || !action.abilityId) return source.effects || [];
  const abilityId = String(action.abilityId).split(":").at(-1);
  const selected = (source.effects || []).filter((effect, index) =>
    String(effect?.abilityId || `effect-${index}`) === abilityId);
  return selected.length ? selected : source.effects || [];
}

function temporaryResponseCanMatter(game, actorId, specs) {
  const potential = combatEffectPotential(specs, actorId);
  const ownKinds = flattenEffectSpecs(specs).map((spec) => String(spec?.kind || "").toLowerCase());
  const protective = ownKinds.some((kind) => /prevent|save|heal|shield|barrier|ready|counter|grant|might|buff/.test(kind));
  if (game.showdown) return potential.removesEnemy || potential.swing > 0 || protective;
  const threats = [...(game.actionChain?.chain || []), ...(game.showdown?.chain || [])].flatMap((item) => {
    const source = item?.card || findCard(game, item?.cardId || item?.sourceId);
    const controllerId = item?.playerId || source?.controllerId;
    if (!controllerId || controllerId === actorId) return [];
    return flattenEffectSpecs(source?.effects || item?.effects || []);
  });
  if (!threats.length) return false;
  const threatKinds = threats.map((spec) => String(spec?.kind || "").toLowerCase());
  const damageThreat = threatKinds.some((kind) => /damage|reduce|might|stun|exhaust/.test(kind));
  const hardRemovalThreat = threatKinds.some((kind) => /kill|destroy|banish|return|recall|capture/.test(kind));
  const countersOrSaves = ownKinds.some((kind) => /counter|save|preventdeath|return|recall/.test(kind));
  if (hardRemovalThreat && !damageThreat) return countersOrSaves || potential.removesEnemy;
  return (damageThreat && (protective || potential.swing > 0)) || potential.removesEnemy;
}

function temporaryBreakthroughOpportunity(game, actorId, specs) {
  const potential = combatEffectPotential(specs, actorId);
  if (!potential.removesEnemy && potential.swing <= 0) return false;
  const actor = player(game, actorId);
  if (!actor) return false;
  const readyFromBase = (actor.base || []).filter((unit) => unit.type === "unit"
    && !unit.exhausted && !unit.cantMoveThisTurn);
  for (const field of game.battlefields || []) {
    const enemies = (field.units || []).filter((unit) => unit.controllerId !== actorId);
    if (!enemies.length) continue;
    const friendlyThere = (field.units || []).filter((unit) => unit.controllerId === actorId);
    const gankers = (game.battlefields || []).flatMap((other) => other === field ? [] : (other.units || [])
      .filter((unit) => unit.controllerId === actorId && !unit.exhausted && !unit.cantMoveThisTurn
        && hasKeywordApprox(unit, "Ganking")));
    const possibleAttackers = [...friendlyThere, ...readyFromBase, ...gankers];
    if (!possibleAttackers.length) continue;
    const projected = withUnitsAtDestination(game, [...readyFromBase, ...gankers], field.instanceId);
    const projectedFriendly = projected.destination.units.filter((unit) => unit.controllerId === actorId);
    const projectedEnemies = projected.destination.units.filter((unit) => unit.controllerId !== actorId);
    const attack = estimatedForceMight(projectedFriendly, "attacker", projectedEnemies,
      projected.game, projected.destination);
    const lethal = minimumLegalLethal(projectedEnemies, "defender", projected.game, projected.destination);
    if (potential.removesEnemy || (lethal > 0 && attack + potential.swing >= lethal)) return true;
  }
  return false;
}

function choiceSpecs(choice, source) {
  const direct = choice?.data?.currentDeclaration?.spec
    || choice?.data?.descriptor?.spec
    || choice?.data?.trigger?.data?.specs?.[0];
  if (direct) return [direct];
  return source?.effects || [];
}

function effectPolarity(specs) {
  let beneficial = 0;
  let harmful = 0;
  for (const spec of specs || []) {
    const kind = String(spec?.kind || "");
    const amount = Number(spec?.amount ?? spec?.might ?? 0);
    if (kind === "modifyMight") {
      if (amount >= 0) beneficial += Math.max(1, amount);
      else harmful += Math.max(1, -amount);
      continue;
    }
    if (BENEFICIAL_EFFECTS.has(kind) || /heal|ready|buff|protect|prevent|grant|create|draw|gain/iu.test(kind)) {
      beneficial += Math.max(1, Math.abs(amount));
    }
    if (HARMFUL_EFFECTS.has(kind) || /damage|kill|stun|exhaust|banish|discard|reduce|return|recall/iu.test(kind)) {
      harmful += Math.max(1, Math.abs(amount));
    }
  }
  if (beneficial > harmful) return "beneficial";
  if (harmful > beneficial) return "harmful";
  return "neutral";
}

function effectAmount(specs) {
  return (specs || []).reduce((largest, spec) => Math.max(largest,
    Math.abs(Number(spec?.amount ?? spec?.damage ?? spec?.draw ?? 0))), 0);
}

function casterBenefit(specs, drawUrgency) {
  return clamp((specs || []).reduce((value, spec) => value
    + Math.max(0, Number(spec?.draw || 0)) * (0.15 + drawUrgency * 0.55)
    + Math.max(0, Number(spec?.gainXp || spec?.xp || 0)) * 0.12
    + Math.max(0, Number(spec?.readyRunes || spec?.ramp || 0)) * 0.2, 0), 0, 1.2);
}

function hasDestructiveTargetEffect(specs) {
  return flattenEffectSpecs(specs).some((spec) =>
    /damage|kill|destroy|banish/iu.test(String(spec?.kind || "")));
}

function friendlyDestructionHasExplicitPayoff(game, actorId, target, specs) {
  const destructive = flattenEffectSpecs(specs);
  const targetMight = currentUnitMight(target);
  const guaranteedRemoval = destructive.some((spec) => {
    const kind = String(spec?.kind || "");
    if (/kill|destroy|banish/iu.test(kind)) return true;
    if (!/damage/iu.test(kind)) return false;
    return Math.max(0, Number(spec?.amount ?? spec?.damage) || 0) >= targetMight;
  });
  if (!guaranteedRemoval) return false;
  const targetSources = [target, ...(target?.attachments || [])].filter(Boolean);
  if (targetSources.some((card) => cardHasDeathPayoff(card))) return true;
  return controlledCards(game, actorId).some((card) =>
    card?.instanceId !== target?.instanceId
    && (card?.effects || []).some((effect) =>
      String(effect?.timing || "").toLowerCase() === "death"
      && /otherfriendly|friendly.*death|buffed.*death|unitdeath/iu.test(String(effect?.kind || ""))));
}

function cardHasDeathPayoff(card) {
  return (card?.keywords || []).some((keyword) => /deathknell/iu.test(String(keyword)))
    || (card?.effects || []).some((effect) =>
      String(effect?.timing || "").toLowerCase() === "death");
}

function controlledCards(game, actorId) {
  const actor = player(game, actorId);
  if (!actor) return [];
  const direct = [
    actor.legend,
    actor.champion?.zone === "played" ? actor.champion : null,
    ...(actor.base || []),
    ...(game.battlefields || []).flatMap((field) =>
      (field.units || []).filter((unit) => unit.controllerId === actorId))
  ].filter(Boolean);
  return direct.flatMap((card) => [card, ...(card.attachments || [])]);
}

function effectHasIndependentOpponentImpact(specs) {
  return flattenEffectSpecs(specs).some((spec) => {
    const target = String(spec?.target || spec?.scope || "").toLowerCase();
    const kind = String(spec?.kind || "");
    return /enemy|opponent/iu.test(target)
      && /damage|kill|destroy|banish|stun|exhaust|discard|reduce|return|recall/iu.test(kind);
  });
}

function playerDrawUrgency(game, actorId) {
  const actor = player(game, actorId);
  const opponent = game?.players?.find((candidate) => candidate.id !== actorId);
  const handPressure = clamp((3 - (actor?.hand?.length || 0)) / 3, 0, 1);
  const scorePressure = clamp(((opponent?.score || 0) - (actor?.score || 0)) / Math.max(1, game?.victoryScore || 8), 0, 1);
  return clamp(handPressure * 0.85 + scorePressure * 0.15, 0, 1);
}

function pendingTargetThreat(game, target) {
  const remainingMight = currentUnitMight(target);
  if (!target) return { damage: 0, remainingMight };
  const items = [
    ...(game?.actionChain?.chain || []),
    ...(game?.showdown?.chain || [])
  ];
  let damage = 0;
  for (const item of items) {
    const source = item?.card || findCard(game, item?.cardId || item?.sourceId);
    const targets = item?.declaredTargets || item?.data?.declaredTargets || source?.declaredPlayTargets || [];
    if (!targets.some((declaration) => (declaration.targetId || declaration.cardId) === target.instanceId)) continue;
    for (const effect of source?.effects || item?.effects || []) {
      if (/damage/iu.test(String(effect?.kind || ""))) damage += Math.max(0, Number(effect.damage ?? effect.amount) || 0);
      if (effect?.kind === "modifyMight" && Number(effect.amount) < 0) damage += -Number(effect.amount);
    }
  }
  return { damage, remainingMight };
}

function targetEffectImpact(game, actorId, target, specs, polarity) {
  if (!target || polarity === "neutral") return 1;
  const temporary = (specs || []).some((spec) => spec?.temporary);
  const location = unitLocation(game, target.instanceId);
  const activeFieldId = game?.showdown?.battlefieldId;
  if (!temporary || !activeFieldId || location?.id !== activeFieldId) return 1;
  const balance = fieldBalance(location.field, actorId);
  const maximumSwing = effectAmount(specs);
  // An expiring combat modifier has little target-side value once even its
  // best friendly use cannot change the current showdown. Caster-side effects
  // such as Draw remain valuable and are scored independently above.
  if (balance < 0 && balance + maximumSwing <= 0) return 0.15;
  if (balance > 0 && balance - maximumSwing >= 0) return 0.3;
  return 1;
}

export function movementProfile(game, actorId, action, destinationId = action?.destinationId || action?.destination) {
  return cachedActionProfile(MOVEMENT_PROFILE_CACHE, game, action, `${actorId}:${destinationId || "none"}`, () =>
    computeMovementProfile(game, actorId, action, destinationId));
}

function computeMovementProfile(game, actorId, action, destinationId) {
  const neutral = {
    isMovement: false,
    destinationType: destinationId === "base" ? "base" : destinationId ? "battlefield" : "none",
    movingUnitCount: 0,
    movingMight: 0,
    attackingMight: 0,
    defendingMight: 0,
    enemyLethalThreshold: 0,
    friendlyLethalThreshold: 0,
    projectedFieldAdvantage: 0,
    hopelessReinforcement: false,
    controlGain: false,
    reversesRemoval: false,
    canRemoveEnemyNoResponse: false,
    tacticalRemovalPossible: false,
    tacticalFollowupCardNumbers: [],
    noOpponentImpact: false,
    temporaryCreatesCleanBreakthrough: false,
    sourceControlRisk: false,
    enemyCanRemoveFriendly: false,
    strictlyBeneficial: false,
    prior: 0
  };
  if (!["moveUnit", "moveUnits"].includes(action?.kind) || !destinationId) return neutral;
  const unitIds = action.kind === "moveUnits" ? action.unitIds || [] : [action.unitId];
  const movingUnits = [...new Map(unitIds.map((unitId) => findCard(game, unitId))
    .filter((unit) => unit?.type === "unit")
    .map((unit) => [unit.instanceId, unit])).values()];
  if (!movingUnits.length) return { ...neutral, isMovement: true };
  const movingIds = new Set(movingUnits.map((unit) => unit.instanceId));
  const sourceLocations = movingUnits.map((unit) => unitLocation(game, unit.instanceId)).filter(Boolean);
  if (sourceLocations.some((location) => location.id === destinationId
    || (location.type === "base" && destinationId === "base"))) {
    return { ...neutral, isMovement: true, prior: -2 };
  }
  const destination = game.battlefields?.find((field) => field.instanceId === destinationId) || null;
  const movingMight = movingUnits.reduce((sum, unit) => sum + estimatedCombatMight(unit, "attacker"), 0);
  const sourceControlRisk = sourceLocations.some((location) => {
    if (location.type !== "battlefield" || location.field?.controlledBy !== actorId) return false;
    const remaining = (location.field.units || []).filter((unit) => !movingIds.has(unit.instanceId));
    const friendly = remaining.filter((unit) => unit.controllerId === actorId);
    const enemies = remaining.filter((unit) => unit.controllerId !== actorId);
    if (!friendly.length) return true;
    return estimatedForceMight(friendly, "defender", enemies, game, location.field)
      <= estimatedForceMight(enemies, "attacker", friendly, game, location.field);
  });
  if (destinationId === "base") {
    const sourceFields = [...new Set(sourceLocations
      .filter((location) => location.type === "battlefield")
      .map((location) => location.field))];
    const sourceBalance = sourceFields.length
      ? sourceFields.reduce((sum, field) => sum + fieldBalance(field, actorId, movingIds), 0) / sourceFields.length
      : 0;
    const retreatsFromLostField = sourceFields.length > 0 && sourceBalance < -2;
    return {
      ...neutral,
      isMovement: true,
      destinationType: "base",
      movingUnitCount: movingUnits.length,
      movingMight,
      projectedFieldAdvantage: sourceBalance / 12,
      sourceControlRisk,
      // Returning to base can be a deliberate regrouping step for a later
      // multi-unit breakthrough, so it is never hard-rejected as "no impact".
      prior: retreatsFromLostField ? 0.2 : -0.2
    };
  }
  if (!destination) return { ...neutral, isMovement: true };
  const projected = withUnitsAtDestination(game, movingUnits, destinationId);
  const projectedDestination = projected.destination;
  const existingFriendly = (destination.units || []).filter((unit) => unit.controllerId === actorId
    && !movingIds.has(unit.instanceId));
  const enemyUnits = (projectedDestination.units || []).filter((unit) => unit.controllerId !== actorId);
  const friendlyUnits = (projectedDestination.units || []).filter((unit) => unit.controllerId === actorId);
  const before = estimatedForceMight(existingFriendly, "attacker", enemyUnits, game, destination)
    - estimatedForceMight(enemyUnits, "defender", existingFriendly, game, destination);
  const attackingMight = estimatedForceMight(friendlyUnits, "attacker", enemyUnits,
    projected.game, projectedDestination);
  const defendingMight = estimatedForceMight(enemyUnits, "defender", friendlyUnits,
    projected.game, projectedDestination);
  const after = attackingMight - defendingMight;
  const enemyLethalThreshold = minimumLegalLethal(enemyUnits, "defender", projected.game, projectedDestination);
  const friendlyLethalThreshold = minimumLegalLethal(friendlyUnits, "attacker", projected.game, projectedDestination);
  const canRemoveEnemyNoResponse = enemyUnits.length > 0
    && enemyLethalThreshold > 0
    && attackingMight >= enemyLethalThreshold;
  const enemyCanRemoveFriendly = enemyUnits.length > 0
    && friendlyLethalThreshold > 0
    && defendingMight >= friendlyLethalThreshold;
  const followup = movementTacticalFollowup(game, actorId, movingUnits, destination, {
    attackingMight,
    enemyLethalThreshold,
    friendlyUnits,
    enemyUnits
  });
  const tacticalRemovalPossible = enemyUnits.length > 0 && !canRemoveEnemyNoResponse
    && followup.removalPossible;
  const noOpponentImpact = enemyUnits.length > 0
    && !canRemoveEnemyNoResponse
    && !tacticalRemovalPossible;
  const hopelessReinforcement = noOpponentImpact && enemyCanRemoveFriendly;
  const controlGain = enemyUnits.length === 0 && destination.controlledBy !== actorId;
  const temporaryMight = friendlyUnits.reduce((sum, unit) => sum + Math.max(0, Number(unit.temporaryMight) || 0), 0);
  const canRemoveWithoutTemporary = enemyUnits.length > 0
    && Math.max(0, attackingMight - temporaryMight) >= enemyLethalThreshold;
  const temporaryCreatesCleanBreakthrough = canRemoveEnemyNoResponse
    && !canRemoveWithoutTemporary
    && !enemyCanRemoveFriendly;
  const strictlyBeneficial = !sourceControlRisk
    && !enemyCanRemoveFriendly
    && (controlGain || canRemoveEnemyNoResponse);
  const prior = noOpponentImpact ? -2
    : tacticalRemovalPossible ? 0.35
      : controlGain ? 0.65
        : clamp(after / 16, -0.35, 0.45);
  return {
    ...neutral,
    isMovement: true,
    destinationType: "battlefield",
    movingUnitCount: movingUnits.length,
    movingMight,
    attackingMight,
    defendingMight,
    enemyLethalThreshold,
    friendlyLethalThreshold,
    projectedFieldAdvantage: clamp(after / 20, -1, 1),
    hopelessReinforcement,
    controlGain,
    canRemoveEnemyNoResponse,
    tacticalRemovalPossible,
    tacticalFollowupCardNumbers: followup.cardNumbers,
    noOpponentImpact,
    temporaryCreatesCleanBreakthrough,
    sourceControlRisk,
    enemyCanRemoveFriendly,
    strictlyBeneficial,
    prior
  };
}

function cachedActionProfile(cache, game, action, key, calculate) {
  if (!game || !action || typeof game !== "object" || typeof action !== "object") return calculate();
  let actions = cache.get(game);
  if (!actions) {
    actions = new WeakMap();
    cache.set(game, actions);
  }
  let profiles = actions.get(action);
  if (!profiles) {
    profiles = new Map();
    actions.set(action, profiles);
  }
  if (!profiles.has(key)) profiles.set(key, calculate());
  return profiles.get(key);
}

function movementTacticalFollowup(game, actorId, movingUnits, destination, context) {
  const actor = player(game, actorId);
  if (!actor || !context.enemyUnits.length || !context.enemyLethalThreshold) {
    return { removalPossible: false, cardNumbers: [] };
  }
  const sourceFields = [...new Set(movingUnits.map((unit) => unitLocation(game, unit.instanceId))
    .filter((location) => location?.type === "battlefield" && location.field.controlledBy === actorId)
    .map((location) => location.field))];
  const globalAloneSources = [
    actor.legend,
    actor.champion?.zone === "played" ? actor.champion : null,
    ...(actor.base || []),
    ...(game.battlefields || []).flatMap((field) => (field.units || []).filter((unit) => unit.controllerId === actorId))
  ].filter(Boolean).flatMap((card) => (card.effects || []).filter((effect) =>
    effect?.timing === "attackOrDefend" && effect?.kind === "modifyFriendlyAlone"
      && (!effect.role || effect.role === "attacker")));
  const movingEffects = movingUnits.flatMap((card) => (card.effects || []).filter((effect) => effect?.timing === "onMove"));
  const participantEffects = context.friendlyUnits.flatMap((card) => (card.effects || []).filter((effect) =>
    (effect?.timing === "attackOrDefend" && (!effect.role || effect.role === "attacker"))
      || effect?.timing === "showdownBeginsHere"));
  const sourceFieldEffects = sourceFields.flatMap((field) => (field.effects || []).filter((effect) => effect?.timing === "onMove"));
  const triggerPotential = [
    ...movingEffects,
    ...participantEffects,
    ...sourceFieldEffects,
    ...(context.friendlyUnits.length === 1 ? globalAloneSources : [])
  ].reduce((result, effect) => mergeCombatPotential(result, combatEffectPotential([effect], actorId)),
    emptyCombatPotential());

  const ambushDestinationEligible = context.friendlyUnits.length > 0;
  const resourceGame = withMovementCostsPaid(game, movingUnits);
  const handCandidates = (actor.hand || []).filter((card) =>
    cardReactionPermissionSources(card, { ambushDestinationEligible }).length > 0
    && cardResourceAffordability(resourceGame, actorId, card).payable);
  const hiddenCandidates = (destination.hidden || [])
    .filter((item) => hiddenCardIsControlledBy(item, actorId))
    .map((item) => item.card)
    .filter((card) => cardReactionPermissionSources(card, { fromHidden: true, ambushDestinationEligible }).length > 0);
  const candidates = [...new Map([...handCandidates, ...hiddenCandidates]
    .filter(Boolean)
    .map((card) => [card.instanceId || card.cardNumber, card])).values()];
  let bestCardSwing = 0;
  let anyCardRemovesEnemy = false;
  const usefulCardNumbers = [];
  for (const card of candidates) {
    const potential = combatEffectPotential(card.effects || [], actorId);
    if (card.type === "unit") potential.swing += estimatedCombatMight(card, "attacker");
    const withTriggers = context.attackingMight + triggerPotential.swing + potential.swing;
    if (triggerPotential.removesEnemy || potential.removesEnemy || withTriggers >= context.enemyLethalThreshold) {
      usefulCardNumbers.push(card.cardNumber || card.instanceId);
    }
    bestCardSwing = Math.max(bestCardSwing, potential.swing);
    anyCardRemovesEnemy ||= potential.removesEnemy;
  }
  const removalPossible = triggerPotential.removesEnemy
    || anyCardRemovesEnemy
    || context.attackingMight + triggerPotential.swing + bestCardSwing >= context.enemyLethalThreshold;
  return { removalPossible, cardNumbers: usefulCardNumbers.filter(Boolean) };
}

function withMovementCostsPaid(game, movingUnits) {
  const movingIds = new Set(movingUnits.map((unit) => unit.instanceId));
  const paid = (card) => movingIds.has(card?.instanceId) ? { ...card, exhausted: true } : card;
  return {
    ...game,
    players: (game.players || []).map((candidate) => ({
      ...candidate,
      legend: paid(candidate.legend),
      champion: paid(candidate.champion),
      base: (candidate.base || []).map(paid)
    })),
    battlefields: (game.battlefields || []).map((field) => ({
      ...field,
      units: (field.units || []).map(paid)
    }))
  };
}

function combatEffectPotential(specs, actorId) {
  const result = emptyCombatPotential();
  for (const spec of flattenEffectSpecs(specs)) {
    const kind = String(spec?.kind || "").toLowerCase();
    const target = `${spec?.target || ""} ${spec?.scope || ""} ${spec?.destination || ""}`.toLowerCase();
    const friendlyOnly = /friendly|ally|self/.test(target) && !/enemy|opponent/.test(target);
    const enemyOnly = /enemy|opponent/.test(target) && !/friendly|ally|self/.test(target);
    const amount = Math.max(0, Math.abs(Number(spec?.amount ?? spec?.damage ?? spec?.might ?? 0)) || 0);
    if (/kill|destroy|banish|capture|steal/.test(kind)
      || (/return|recall|move/.test(kind) && !friendlyOnly && /enemy|opponent/.test(target))) {
      result.removesEnemy = true;
    }
    if (/damage/.test(kind) && !friendlyOnly) result.swing = Math.max(result.swing, amount);
    if (kind === "modifymight") {
      const signed = Number(spec?.amount) || 0;
      if ((signed > 0 && !enemyOnly) || (signed < 0 && !friendlyOnly)) {
        result.swing = Math.max(result.swing, Math.abs(signed));
      }
    } else if (/might|buff|reduce|weaken/.test(kind) && amount > 0) {
      result.swing = Math.max(result.swing, amount);
    } else if (["onMove", "attackOrDefend", "showdownBeginsHere"].includes(spec?.timing) && amount > 0
      && !/draw|xp|energy|power|rune/.test(kind)) {
      result.swing = Math.max(result.swing, amount);
    }
  }
  return result;
}

function flattenEffectSpecs(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => flattenEffectSpecs(item, seen));
  const output = value.kind ? [value] : [];
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") output.push(...flattenEffectSpecs(nested, seen));
  }
  return output;
}

function emptyCombatPotential() {
  return { swing: 0, removesEnemy: false };
}

function mergeCombatPotential(left, right) {
  return {
    // Distinct mandatory movement/attack triggers can all resolve before combat.
    swing: left.swing + right.swing,
    removesEnemy: left.removesEnemy || right.removesEnemy
  };
}

function estimatedForceMight(units, role, enemies, game = null, battlefield = null) {
  const opposingRole = role === "attacker" ? "defender" : "attacker";
  return (units || []).reduce((sum, unit) => {
    if (unit.stunned) return sum;
    const might = estimatedCombatMight(unit, role, game, battlefield);
    const suppressed = (enemies || []).some((enemy) => hasStaticEffectApprox(enemy, "suppressWeakerEnemyCombatDamage")
      && might < estimatedCombatMight(enemy, opposingRole, game, battlefield));
    return sum + (suppressed ? 0 : might);
  }, 0);
}

function minimumLegalLethal(units, role, game = null, battlefield = null) {
  if (!(units || []).length) return 0;
  const active = units.map((unit) => ({
    unit,
    tank: hasKeywordApprox(unit, "Tank"),
    backline: hasKeywordApprox(unit, "Backline") || hasStaticEffectApprox(unit, "combatDamageAssignmentLast")
  }));
  const tanks = active.filter((item) => item.tank && !item.backline);
  const conflicting = active.filter((item) => item.tank && item.backline);
  const ordinary = active.filter((item) => !item.tank && !item.backline);
  const legal = tanks.length ? [...tanks, ...conflicting]
    : ordinary.length ? [...ordinary, ...conflicting]
      : active;
  return Math.min(...legal.map(({ unit }) => Math.max(1,
    estimatedCombatMight(unit, role, game, battlefield) - Math.max(0, Number(unit.damage) || 0))));
}

function estimatedCombatMight(unit, role, game = null, battlefield = null) {
  if (!unit) return 0;
  if (game && battlefield) return Math.max(0, currentCombatMight(game, battlefield, unit, role));
  let might = Math.max(0, Number(unit.might || 0) + Number(unit.mightModifier || 0)
    + Number(unit.buffs || 0) + attachmentMight(unit));
  if (role === "attacker") {
    might += printedKeywordValue(unit, "Assault", 1) + temporaryKeywordValue(unit, "Assault", 1);
  }
  if (role === "defender") {
    might += printedKeywordValue(unit, "Shield", 1) + temporaryKeywordValue(unit, "Shield", 1)
      + Math.max(0, Number(unit.temporaryShieldAmount) || 0);
  }
  return Math.max(0, might);
}

function withUnitsAtDestination(game, movingUnits, destinationId) {
  const movingIds = new Set((movingUnits || []).map((unit) => unit.instanceId));
  const players = (game.players || []).map((candidate) => ({
    ...candidate,
    base: (candidate.base || []).filter((unit) => !movingIds.has(unit.instanceId))
  }));
  const battlefields = (game.battlefields || []).map((field) => ({
    ...field,
    units: (field.units || []).filter((unit) => !movingIds.has(unit.instanceId))
  }));
  const destination = battlefields.find((field) => field.instanceId === destinationId || field.id === destinationId);
  if (destination) destination.units = [...destination.units, ...(movingUnits || [])];
  return { game: { ...game, players, battlefields }, destination };
}

function attachmentMight(unit) {
  return (unit?.attachments || []).flatMap((attachment) => attachment.effects || [])
    .filter((effect) => effect?.timing === "static" && effect?.kind === "attachedMight")
    .reduce((sum, effect) => sum + (Number(effect.amount) || 0), 0);
}

function hasKeywordApprox(card, keyword) {
  return keywordListHas(card?.keywords, keyword) || keywordListHas(card?.temporaryKeywords, keyword);
}

function hasStaticEffectApprox(card, kind) {
  return (card?.effects || []).some((effect) => effect?.timing === "static" && effect?.kind === kind);
}

function playTargetRisk(game, actorId, action, source) {
  if (!["beginPlayCard", "beginPlayChampion", "activateCard"].includes(action?.kind)) return 0;
  const specs = source?.effects || [];
  const polarity = effectPolarity(specs);
  if (polarity === "beneficial") {
    const friendlyTargets = allUnits(game).filter((unit) => unit.controllerId === actorId);
    if (!friendlyTargets.length) return -0.25;
  }
  const enemyMove = specs.some((spec) => spec?.kind === "moveUnit" && String(spec?.target || "").toLowerCase().includes("enemy"));
  if (enemyMove) {
    const enemyAtBattlefield = game.battlefields?.some((field) =>
      (field.units || []).some((unit) => unit.controllerId !== actorId));
    if (!enemyAtBattlefield) return -0.2;
  }
  const lowUrgencyTemporary = (source?.effects || []).some((effect) => effect?.temporary)
    && !game.showdown && !game.actionChain && playerDrawUrgency(game, actorId) < 0.35;
  if (lowUrgencyTemporary) return -0.15;
  return 0;
}

function fieldBalance(field, actorId, excludedId = null) {
  return fieldMight(field, actorId, true, excludedId) - fieldMight(field, actorId, false, excludedId);
}

function fieldMight(field, actorId, friendly, excludedId = null) {
  const excluded = excludedId instanceof Set ? excludedId : new Set(excludedId ? [excludedId] : []);
  return (field?.units || []).filter((unit) => !excluded.has(unit.instanceId)
    && (unit.controllerId === actorId) === friendly)
    .reduce((sum, unit) => sum + currentUnitMight(unit), 0);
}

function currentUnitMight(unit) {
  return Math.max(0, Number(unit?.might || 0) + Number(unit?.mightModifier || 0)
    + Number(unit?.buffs || 0) - Number(unit?.damage || 0));
}

function unitLocation(game, unitId) {
  for (const candidate of game.players || []) {
    if ((candidate.base || []).some((unit) => unit.instanceId === unitId)) return { type: "base", id: "base" };
  }
  for (const field of game.battlefields || []) {
    if ((field.units || []).some((unit) => unit.instanceId === unitId)) return { type: "battlefield", id: field.instanceId, field };
  }
  return null;
}

function allUnits(game) {
  return [
    ...(game.players || []).flatMap((candidate) => candidate.base || []),
    ...(game.battlefields || []).flatMap((field) => field.units || [])
  ].filter((card) => card?.type === "unit");
}

function findCard(game, id) {
  if (!id) return null;
  const visible = [
    ...(game.players || []).flatMap((candidate) => [
      candidate.legend, candidate.champion, ...(candidate.hand || []), ...(candidate.base || []),
      ...(candidate.runes || []), ...(candidate.trash || []), ...(candidate.banished || [])
    ]),
    ...(game.battlefields || []).flatMap((field) => [field, ...(field.units || []),
      ...(field.hidden || []).map((item) => item.card)])
  ].filter(Boolean);
  return visible.find((card) => card.instanceId === id || card.id === id) || null;
}

function player(game, actorId) {
  return game?.players?.find((candidate) => candidate.id === actorId) || null;
}

function isLocation(game, id) {
  return id === "base" || game?.battlefields?.some((field) => field.instanceId === id);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}
