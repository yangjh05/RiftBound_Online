import { hiddenCardIsControlledBy } from "../rules/zones.mjs";
import { movementProfile, tacticalActionProfile, temporaryChoicePurposeProfile, temporaryCommitmentProfile } from "./action-tactics.mjs";
import { enumerateMulliganPlans } from "./mulligan.mjs";
import { addAiPerformance, measureAiPerformance } from "./performance.mjs";
import { cloneAiState } from "./clone-state.mjs";
import { hasCombatSacrificePayoff, previewCombatLines, simpleCombatSpell } from "./combat-safety.mjs";
import { inspectAttackPlan, filterCommittedCombatActions, advanceCombatCommitment,
  validCommitment, combatCommitmentStateKey } from "./attack-plan.mjs";
import { filterReadyEntryOrder } from "./ready-entry-order.mjs";
import { previewTacticalAction } from "./tactical-baseline.mjs";
import {needsPaymentOptionDecision,paymentOptionActions,applyPaymentOptions} from './payment-options.mjs';
import {hasPublicRemovalCombo} from './removal-combo.mjs';
import {
  activateCard,
  beginPlayCard,
  beginPlayCardFromTrash,
  beginPlayChampion,
  canStandardMoveUnits,
  cardHasKeyword,
  cancelPayment,
  chooseFirstPlayer,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmMulligan,
  confirmPayment,
  declineEffectChoice,
  endTurn,
  currentMight,
  firstPlayerDecisionActorId,
  hideCard,
  hiddenCardsAtBattlefieldForPlayer,
  hiddenSlotLimit,
  legalActivatedAbilityOptions,
  legalCardPlayDestinations,
  legalChampionPlayDestinations,
  legalPaymentPoolEnergyOptions,
  moveUnit,
  moveUnits,
  passShowdown,
  recordPublicTurnEvent,
  rollFirstPlayer,
  selectBattlefield,
  selectChampion,
  skipMulligan,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentPoolPower,
  togglePaymentRune
} from "../engine.mjs";

const STRATEGIC_KINDS = new Set([
  "selectChampion", "selectBattlefield", "toggleMulliganCard", "confirmMulligan", "skipMulligan", "submitMulligan",
  "beginPlayCard", "beginPlayCardFromTrash", "beginPlayChampion", "hideCard", "moveUnit", "moveUnits",
  "activateCard", "chooseEffectOption", "choosePaymentOptions", "declineEffectChoice", "passShowdown", "endTurn"
]);

// These fields describe the current decision for scoring/encoding, but they are
// not part of the command that is executed by the engine. Keeping them in an
// action identity makes an explicit { kind, optionId } choice look different
// from the corresponding enumerated AI action.
const ACTION_ANNOTATION_FIELDS = new Set([
  "confirmTriggerOrder",
  "triggerOrderSelected",
  "triggerOrderOptional"
]);

const combatPlanApi = { cloneGame, enumerateLegalActions, planPaymentActions, actionKey,
  hasCombatSacrificePayoff, previewCombatLines, simpleCombatSpell, isMechanicalResourceActivation,
  applyAiAction: (game, action, actorId) => applyAiAction(game, action, actorId, {skipCombatPlan:true}) };

export function activeActorId(game) {
  if (game.pendingChoice?.playerId) return game.pendingChoice.playerId;
  if (game.pendingPayment?.playerId) return game.pendingPayment.playerId;
  if (game.phase === "champion-select") return game.championSelectPlayerId;
  if (game.phase === "battlefield-select") return game.setupPlayerId;
  if (game.phase === "mulligan") return game.mulligan?.playerId || null;
  if (game.actionChain?.priorityPlayerId) return game.actionChain.priorityPlayerId;
  if (game.phase === "showdown") return game.showdown?.priorityPlayerId || null;
  if (game.phase === "first-player") return firstPlayerDecisionActorId(game);
  if (game.phase === "action") return game.currentPlayerId;
  return null;
}

export function enumerateLegalActions(game, actorId = activeActorId(game), options = {}) {
  addAiPerformance("legalCalls");
  return measureAiPerformance("legalMs", () => {
    if (!actorId || game.phase === "complete") return [];
    const candidates = candidateActions(game, actorId);
    const unique = new Map();
    for (const action of candidates) unique.set(actionKey(action), action);
    addAiPerformance("legalCandidates", unique.size);
    const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence ? game.aiDeclinedIntents.keys : []);
    return [...unique.values()].filter((action) => {
      if (declined.has(actionKey(action))) return false;
      if (options.useSharedStandardMoveLegality
        && (action.kind === "moveUnit" || action.kind === "moveUnits")) {
        const unitIds = action.kind === "moveUnit" ? [action.unitId] : action.unitIds;
        if (!canStandardMoveUnits(game, unitIds, action.destinationId)) return false;
        return typeof options.acceptPreview !== "function" || options.acceptPreview(action, null) !== false;
      }
      const clone = cloneGame(game);
      if (!applyAiAction(clone, action, actorId, {skipCombatPlan:true})?.ok) return false;
      if (["beginPlayCard", "beginPlayCardFromTrash", "beginPlayChampion", "hideCard", "activateCard"].includes(action.kind) && clone.pendingPayment
        && !canCompletePayment(clone)) return false;
      return typeof options.acceptPreview !== "function" || options.acceptPreview(action, clone) !== false;
    });
  });
}

// The tabletop only needs declaration and movement affordances. Building the
// full AI action space here used to simulate unrelated abilities, choices, and
// every two/three-unit movement combination on each UI render. A batch move is
// therefore included only for the exact selection supplied by the UI.
export function enumerateUiLegalActions(game, actorId = activeActorId(game), options = {}) {
  if (!actorId || actorId !== activeActorId(game) || game.phase === "complete") return [];
  const player = game.players.find((candidate) => candidate.id === actorId);
  if (!player || game.pendingChoice || game.pendingPayment) return [];
  const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence
    ? game.aiDeclinedIntents.keys
    : []);

  const actions = [];
  for (const card of player.hand) {
    for (const destination of legalCardPlayDestinations(game, card.instanceId)) {
      actions.push({ kind: "beginPlayCard", cardId: card.instanceId, destination });
    }
  }
  for (const card of player.trash) {
    for (const destination of legalCardPlayDestinations(game, card.instanceId)) {
      actions.push({ kind: "beginPlayCardFromTrash", cardId: card.instanceId, destination });
    }
  }
  for (const destination of legalChampionPlayDestinations(game)) {
    actions.push({ kind: "beginPlayChampion", destination });
  }

  // Revealing from Hidden and hiding a card can open additional declarations
  // or a payment continuation. Keep the authoritative preview for these less
  // direct paths instead of treating their inexpensive preflight as complete.
  for (const field of game.battlefields) {
    for (const entry of field.hidden || []) {
      if (!hiddenCardIsControlledBy(entry, actorId) || !entry?.card?.instanceId) continue;
      for (const destination of legalCardPlayDestinations(game, entry.card.instanceId)) {
        const action = { kind: "beginPlayCard", cardId: entry.card.instanceId, destination };
        if (declined.has(actionKey(action))) continue;
        if (uiDeclarationPreviewIsLegal(game, action, actorId)) actions.push(action);
      }
    }
  }
  if (game.phase === "action" && !game.actionChain) {
    const controlledFields = game.battlefields.filter((field) => field.controlledBy === actorId
      && hiddenCardsAtBattlefieldForPlayer(field, actorId) < hiddenSlotLimit(field));
    const hideSources = [
      ...player.hand,
      player.champion?.zone === "champion" && !player.championPlayed ? player.champion : null
    ].filter((card) => card && cardHasKeyword(game, card, "Hidden"));
    const candidates = hideSources.flatMap((card) => controlledFields
      .map((field) => ({ kind: "hideCard", cardId: card.instanceId, destination: field.instanceId })))
      .filter((action) => !declined.has(actionKey(action)));
    // Hide cost legality is independent of the source card and chosen controlled
    // battlefield after the necessary keyword/slot checks above, so one
    // authoritative preview covers every preflight-valid destination.
    if (candidates.length && uiDeclarationPreviewIsLegal(game, candidates[0], actorId)) {
      actions.push(...candidates);
    }
  }

  const destinations = ["base", ...game.battlefields.map((field) => field.instanceId)];
  const movable = [
    ...player.base.filter((card) => card.type === "unit"),
    ...game.battlefields.flatMap((field) =>
      field.units.filter((card) => card.type === "unit" && card.controllerId === actorId))
  ];
  for (const unit of movable) {
    for (const destinationId of destinations) {
      if (canStandardMoveUnits(game, [unit.instanceId], destinationId)) {
        actions.push({ kind: "moveUnit", unitId: unit.instanceId, destinationId });
      }
    }
  }

  actions.push(...enumerateUiMoveUnitsActions(game, options?.moveUnitIds, actorId));

  const unique = new Map();
  for (const action of actions) {
    const key = actionKey(action);
    if (!declined.has(key)) unique.set(key, action);
  }
  return [...unique.values()];
}

export function enumerateUiMoveUnitsActions(game, unitIds, actorId = activeActorId(game)) {
  if (!actorId || actorId !== activeActorId(game) || game.phase === "complete"
    || game.pendingChoice || game.pendingPayment) return [];
  const selectedUnitIds = [...new Set((unitIds || []).filter((id) => typeof id === "string" && id))];
  if (selectedUnitIds.length < 2) return [];
  const destinations = ["base", ...game.battlefields.map((field) => field.instanceId)];
  const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence
    ? game.aiDeclinedIntents.keys
    : []);
  return destinations.flatMap((destinationId) => {
    if (!canStandardMoveUnits(game, selectedUnitIds, destinationId)) return [];
    const action = { kind: "moveUnits", unitIds: [...selectedUnitIds], destinationId };
    return declined.has(actionKey(action)) ? [] : [action];
  });
}

function uiDeclarationPreviewIsLegal(game, action, actorId) {
  const preview = cloneGame(game);
  if (!applyAiAction(preview, action, actorId)?.ok) return false;
  return !preview.pendingPayment || canCompletePayment(preview);
}

// Basic Rune conversion is a mechanical part of paying a declared cost, not a
// strategic action for an AI policy to take speculatively. Keep it in the full
// legal command set for human play, while the payment planner uses the direct
// Rune/pool payment commands. Resources generated by other effects remain in
// runePool and are still offered as payment options.
export function enumerateAiPolicyActions(game, actorId = activeActorId(game), options = {}) {
  if (game.pendingPayment?.playerId === actorId && needsPaymentOptionDecision(game))
    return paymentOptionActions(game, canCompletePayment);
  if (game.phase === "mulligan") return enumerateMulliganPlans(game, actorId);
  const immediateWins = new Set();
  const legal = enumerateLegalActions(game, actorId, {
    useSharedStandardMoveLegality: true,
    acceptPreview: (action, preview) => {
      if (preview?.phase === "complete" && preview.winnerId === actorId
        && !preview.pendingChoice && !preview.pendingPayment && !preview.actionChain && !preview.showdown) {
        immediateWins.add(actionKey(action));
      }
      return declarationHasSafeTargetContinuation(game, actorId, action, preview);
    }
  });
  const policyLegal = legal.filter((action) => !isMechanicalResourceActivation(game, action)
    && !isSelectedTriggerOrderToggle(action));
  // This action already ends the game before another response can occur.
  // Conditional combat improvements must never enter this hard mask.
  const provenWins = policyLegal.filter(action => immediateWins.has(actionKey(action)));
  if (provenWins.length) return provenWins;
  const movementProfiles = new Map(policyLegal
    .filter((action) => action.kind === "moveUnit" || action.kind === "moveUnits")
    .map((action) => [action, movementProfile(game, actorId, action)]));
  const temporaryChoiceProfiles = new Map(policyLegal
    .filter((action) => action.kind === "chooseEffectOption")
    .map((action) => [action, temporaryChoicePurposeProfile(game, actorId, action)]));
  const effectChoiceProfiles = new Map(policyLegal
    .filter((action) => action.kind === "chooseEffectOption")
    .map((action) => [action, tacticalActionProfile(game, actorId, action)]));
  const hasClearTemporaryChoice = [...temporaryChoiceProfiles.values()].some((profile) =>
    profile.isTemporaryChoice && profile.clearPurpose);
  const hasAlignedEffectChoice = [...effectChoiceProfiles.values()].some((profile) => profile.targetAlignment > 0);
  const canDeclineOptionalEffect = Boolean(game.pendingChoice?.optional)
    && policyLegal.some((action) => action.kind === "declineEffectChoice");
  const filtered = policyLegal.filter((action) => {
    const movement = movementProfiles.get(action);
    if (movement && inspectAttackPlan(game, actorId, action, movement, combatPlanApi)?.kind === 'unsupported-loss') return false;
    if (!options.skipTemporaryPurpose && !temporaryCommitmentProfile(game, actorId, action).clearPurpose
      && !hasPublicRemovalCombo(game,actorId,action,previewTacticalAction)) return false;
    const temporaryChoice = temporaryChoiceProfiles.get(action);
    const effectChoice = effectChoiceProfiles.get(action);
    if (!options.skipTemporaryPurpose && hasClearTemporaryChoice && temporaryChoice?.isTemporaryChoice && !temporaryChoice.clearPurpose
      && !hasJustifiedMisalignedUpside(effectChoice)
      && !hasPublicRemovalCombo(game,actorId,action,previewTacticalAction)) return false;
    if (effectChoice && isDominatedEffectChoice(effectChoice, hasAlignedEffectChoice, canDeclineOptionalEffect)) return false;
    // Keep holding resources available: an apparently profitable move may
    // invite a response. The tactical initializer teaches a preference, and
    // PPO must be able to learn when to override it.
    return true;
  });
  const executable = filtered.length
    ? filtered
    : forcedRequiredChoiceFallback(game, policyLegal, effectChoiceProfiles);
  const ordered = options.skipReadyEntryOrdering ? executable : filterReadyEntryOrder(game, actorId,
    executable, { previewTacticalAction, actionKey, enumerateAiPolicyActions });
  return filterCommittedCombatActions(game, actorId,
    prioritizeMovementActions(ordered, movementProfiles), combatPlanApi);
}

function isDominatedEffectChoice(profile, hasAlignedChoice, canDecline) {
  if (profile.targetAlignment >= 0) return false;
  if (profile.clearlySelfDestructive) return true;
  const independentUpside = profile.savesFromLethal || hasJustifiedMisalignedUpside(profile);
  return !independentUpside && (hasAlignedChoice || canDecline);
}

function hasJustifiedMisalignedUpside(profile) {
  if (!profile || profile.targetAlignment >= 0) return false;
  // Drawing or another caster-side payoff can make an apparently backwards
  // enemy buff correct in an already-lost combat. Require the target-side
  // effect to be low-impact; Draw never excuses destroying a healthy ally.
  return (profile.targetRelation === "enemy"
    && profile.polarity === "beneficial"
    && profile.targetImpact < 0.5
    && profile.casterSideBenefit >= 0.08)
    || (profile.targetRelation === "friendly"
      && profile.polarity === "harmful"
      && (profile.friendlyDestructionPayoff || profile.targetAlreadyThreatened)
      && profile.casterSideBenefit >= 0.08);
}

function declarationHasSafeTargetContinuation(game, actorId, action, validatedPreview = null) {
  if (!["beginPlayCard", "beginPlayCardFromTrash", "beginPlayChampion", "activateCard"].includes(action?.kind)) return true;
  const declarationProfile = tacticalActionProfile(game, actorId, action);
  if (!declarationProfile.destructiveTargetEffect) return true;
  const branch = validatedPreview || cloneGame(game);
  if (!validatedPreview && !applyAiAction(branch, action, actorId)?.ok) return true;
  return declarationChoiceHasSafeBranch(branch, actorId, 0);
}

function declarationChoiceHasSafeBranch(game, actorId, depth) {
  const choice = game.pendingChoice;
  if (!choice || choice.playerId !== actorId) return true;
  if (!/^declare(?:Play|HiddenPlay|Activated).*Target$/u.test(String(choice.effect || ""))) return true;
  if (depth >= 6) return true;
  if (choice.optional) return true;
  const options = (choice.options || []).filter((option) => !option?.disabled);
  if (!options.length) return false;
  return options.some((option) => {
    const action = {
      kind: "chooseEffectOption",
      optionId: option?.id ?? option?.value ?? option
    };
    const profile = tacticalActionProfile(game, actorId, action);
    if (profile.clearlySelfDestructive) return false;
    const next = cloneGame(game);
    if (!applyAiAction(next, action, actorId)?.ok) return false;
    return declarationChoiceHasSafeBranch(next, actorId, depth + 1);
  });
}

function forcedRequiredChoiceFallback(game, actions, profiles) {
  if (!game.pendingChoice || game.pendingChoice.optional) return [];
  const choices = actions.filter((action) => action.kind === "chooseEffectOption");
  if (!choices.length) return [];
  return choices.sort((left, right) =>
    effectChoiceFallbackScore(profiles.get(right)) - effectChoiceFallbackScore(profiles.get(left))
    || actionKey(left).localeCompare(actionKey(right))).slice(0, 1);
}

function effectChoiceFallbackScore(profile) {
  if (!profile) return 0;
  return Number(!profile.clearlySelfDestructive) * 10
    + Number(profile.targetAlignment || 0) * Math.max(0.2, Number(profile.targetImpact) || 0)
    + Number(profile.casterSideBenefit || 0)
    + Number(profile.friendlyDestructionPayoff) * 2
    + Number(profile.targetAlreadyThreatened);
}

function actionUsesTemporaryUnit(game, action) {
  const unitIds = action.kind === "moveUnits" ? action.unitIds || [] : [action.unitId];
  return unitIds.some((unitId) => {
    const unit = findPolicyCard(game, unitId);
    return (Number(unit?.temporaryMight) || 0) > 0
      || (unit?.temporaryKeywords || []).length > 0
      || Object.keys(unit?.temporaryKeywordAmounts || {}).length > 0;
  });
}

function findPolicyCard(game, cardId) {
  if (!cardId) return null;
  return [
    ...(game.players || []).flatMap((player) => [
      player.legend, player.champion, ...(player.hand || []), ...(player.base || []), ...(player.runes || [])
    ]),
    ...(game.battlefields || []).flatMap((field) => [field, ...(field.units || [])])
  ].filter(Boolean).find((card) => card.instanceId === cardId || card.id === cardId) || null;
}

function prioritizeMovementActions(actions, profiles) {
  const ranked = actions.filter((action) => profiles.has(action)).sort((left, right) => {
    const leftProfile = profiles.get(left);
    const rightProfile = profiles.get(right);
    return Number(rightProfile.strictlyBeneficial) - Number(leftProfile.strictlyBeneficial)
      || Number(leftProfile.sourceControlRisk) - Number(rightProfile.sourceControlRisk)
      || Number(rightProfile.canRemoveEnemyNoResponse) - Number(leftProfile.canRemoveEnemyNoResponse)
      || Number(rightProfile.tacticalRemovalPossible) - Number(leftProfile.tacticalRemovalPossible)
      || Number(rightProfile.controlGain) - Number(leftProfile.controlGain)
      || rightProfile.projectedFieldAdvantage - leftProfile.projectedFieldAdvantage
      || rightProfile.movingUnitCount - leftProfile.movingUnitCount;
  });
  let movementIndex = 0;
  return actions.map((action) => profiles.has(action) ? ranked[movementIndex++] : action);
}

function isSelectedTriggerOrderToggle(action) {
  return action?.kind === "chooseEffectOption" && action.triggerOrderSelected === true;
}

export function createAiDecisionCycleGuard(limit = 8) {
  const counts = new Map();
  let scope = null;
  return {
    inspect(game) {
      const choice = game?.pendingChoice;
      const options = choice ? (choice.options || []).map((option) => ({
          id: option?.id ?? option?.value ?? option,
          optional: Boolean(option?.optionalTrigger),
          confirm: Boolean(option?.confirmTriggerOrder)
        })) : [];
      const nextScope = choice ? JSON.stringify({
          kind: "choice",
          turnSequence: game.turnSequence ?? null,
          effect: choice.effect || null,
          playerId: choice.playerId || null,
          cardId: choice.card?.instanceId || null,
          options
        }) : JSON.stringify({
          kind: "game",
          turnSequence: game?.turnSequence ?? game?.turnNumber ?? null,
          phase: game?.phase || null
        });
      if (scope !== nextScope) {
        scope = nextScope;
        counts.clear();
      }
      const state = choice
        ? (choice.options || []).map((option) => ({
            id: option?.id ?? option?.value ?? option,
            selected: Boolean(option?.selected),
            disabled: Boolean(option?.disabled)
          }))
        : aiDecisionStateDigest(game);
      const signature = JSON.stringify(state);
      const repetitions = (counts.get(signature) || 0) + 1;
      counts.set(signature, repetitions);
      if (repetitions <= Math.max(2, limit)) return null;
      return {
        kind: "ai-decision-cycle",
        effect: choice?.effect || null,
        playerId: choice?.playerId || activeActorId(game) || null,
        cardId: choice?.card?.instanceId || null,
        repetitions,
        options: choice ? structuredClone(choice.options || []) : null,
        state: choice ? null : state
      };
    }
  };
}

function aiDecisionStateDigest(game) {
  const players = (game?.players || []).map((player) => ({
    id: player.id,
    score: Number(player.score) || 0,
    hand: player.hand?.length || 0,
    deck: player.mainDeck?.length || 0,
    trash: player.trash?.length || 0,
    base: digestCards(player.base),
    runes: (player.runes || []).map((rune) => [rune.instanceId || rune.id || rune.domain, Boolean(rune.exhausted)]),
    pool: [player.runePool?.energy?.length || 0, player.runePool?.power?.length || 0]
  }));
  return {
    actorId: activeActorId(game),
    currentPlayerId: game?.currentPlayerId || null,
    turnPlayerId: game?.turnPlayerId || null,
    activePlayerId: game?.activePlayerId || null,
    winnerId: game?.winnerId || null,
    players,
    battlefields: (game?.battlefields || []).map((field) => ({
      id: field.instanceId || field.id || field.cardNumber || null,
      controlledBy: field.controlledBy || null,
      units: digestCards(field.units)
    })),
    pendingPayment: game?.pendingPayment ? {
      playerId: game.pendingPayment.playerId || null,
      energy: game.pendingPayment.energyCost ?? null,
      power: game.pendingPayment.powerCost ?? null,
      energyRuneIds: [...(game.pendingPayment.energyRuneIds || [])].sort(),
      powerRuneIds: [...(game.pendingPayment.powerRuneIds || [])].sort(),
      optionalEffects: (game.pendingPayment.optionalPowerEffects || []).map(e => [e.id, Boolean(e.selected)]),
      aiOptionSelection: game.pendingPayment.aiOptionSelection || null,
      poolEnergyIds: [...(game.pendingPayment.poolEnergyIds || [])].sort(),
      poolPowerIds: [...(game.pendingPayment.poolPowerIds || [])].sort()
    } : null,
    actionChain: game?.actionChain ? {
      priorityPlayerId: game.actionChain.priorityPlayerId || null,
      passedPlayerIds: [...(game.actionChain.passedPlayerIds || [])].sort(),
      consecutivePasses: game.actionChain.consecutivePasses || 0,
      chain: digestDecisionChain(game.actionChain.chain || game.actionChain.links || game.actionChain.actions)
    } : null,
    showdown: game?.showdown ? {
      priorityPlayerId: game.showdown.priorityPlayerId || null,
      passedPlayerIds: [...(game.showdown.passedPlayerIds || [])].sort(),
      consecutivePasses: game.showdown.consecutivePasses || 0,
      chain: digestDecisionChain(game.showdown.chain),
      battlefieldId: game.showdown.battlefieldId || null
    } : null
  };
}

function digestCards(cards = []) {
  return (cards || []).map((card) => [
    card?.instanceId || card?.id || card?.cardNumber || null,
    card?.controllerId || null,
    Boolean(card?.exhausted),
    Number(card?.damage) || 0,
    Number(card?.mightModifier) || 0,
    Number(card?.buffs) || 0
  ]);
}

export function isBasicRuneConversion(action) {
  if (action?.kind !== "activateCard") return false;
  const abilityKind = String(action.abilityId || "").split(":").at(-1);
  return abilityKind === "basic-rune-energy" || abilityKind === "basic-rune-power";
}

export function isMechanicalResourceActivation(game, action) {
  if (action?.kind !== "activateCard") return false;
  if (isBasicRuneConversion(action)) return true;
  return legalActivatedAbilityOptions(game, action.cardId)
    .some((ability) => ability.id === action.abilityId && ability.resourceOnly);
}

function resolveActionCandidate(game, command, actorId, acceptsCandidate) {
  if (!command || !actorId) return null;
  const normalized = Object.fromEntries(Object.entries(command)
    .filter(([, value]) => value !== undefined && value !== null));
  if (normalized.kind === "moveUnit") {
    if (typeof normalized.unitId !== "string" || typeof normalized.destinationId !== "string") return null;
    const explicitMove = {
      kind: "moveUnit",
      unitId: normalized.unitId,
      destinationId: normalized.destinationId
    };
    return acceptsCandidate(explicitMove) ? explicitMove : null;
  }
  if (normalized.kind === "moveUnits") {
    const unitIds = Array.isArray(normalized.unitIds) ? normalized.unitIds : [];
    if (unitIds.length < 2 || new Set(unitIds).size !== unitIds.length || !normalized.destinationId) return null;
    const explicitMove = { kind: "moveUnits", unitIds: [...unitIds], destinationId: normalized.destinationId };
    return acceptsCandidate(explicitMove) ? explicitMove : null;
  }
  // Command authorization must evaluate only the command the player actually
  // submitted. Enumerating every possible play/activation here made an
  // unrelated broken card candidate capable of rejecting a valid multiplayer
  // pass or end-turn command.
  const candidates = candidateActions(game, actorId, normalized.kind);
  const unique = new Map();
  for (const action of candidates) unique.set(actionKey(action), action);
  const exactKey = actionKey(normalized);
  const exact = unique.get(exactKey);
  if (exact && acceptsCandidate(exact)) return exact;
  // Backward compatibility is intentionally limited to the old activation
  // command shape. Never infer a target, payment, or effect choice on behalf
  // of a player, even when only one option currently exists.
  if (normalized.kind !== "activateCard" || normalized.abilityId != null) return null;
  const compatible = [...unique.values()].filter((action) => Object.entries(normalized)
    .every(([key, value]) => sameActionValue(action[key], value)))
    .filter(acceptsCandidate);
  return compatible.length === 1 ? compatible[0] : null;
}

function digestDecisionChain(chain = []) {
  // Resolving a redundant trigger can change no units or resources. The
  // remaining ordered work is still progress; generated IDs/logs are not.
  return chain.map(item => [item.itemType, item.playerId, item.status,
    item.card?.instanceId, item.card?.declaredPlayTargets, item.destination,
    item.trigger?.kind, item.trigger?.sourceCardId, item.trigger?.data]);
}

// Local UI commands are executed immediately by engine functions that already
// perform the authoritative legality check. Canonicalizing here without running
// the command on a full game clone avoids executing expensive payment/choice
// continuations twice while retaining exact candidate matching.
export function canonicalizeActionCommand(game, command, actorId = activeActorId(game)) {
  const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence
    ? game.aiDeclinedIntents.keys
    : []);
  return resolveActionCandidate(game, command, actorId, (action) => !declined.has(actionKey(action)));
}

export function resolveLegalAction(game, command, actorId = activeActorId(game)) {
  const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence ? game.aiDeclinedIntents.keys : []);
  const legalityByKey = new Map();
  return resolveActionCandidate(game, command, actorId, (action) => {
    const key = actionKey(action);
    if (declined.has(key)) return false;
    if (legalityByKey.has(key)) return legalityByKey.get(key);
    const clone = cloneGame(game);
    const legal = Boolean(applyAiAction(clone, action, actorId)?.ok);
    legalityByKey.set(key, legal);
    return legal;
  });
}

export function auditDecisionBoundary(game, actorId = activeActorId(game), knownPolicyActions = null) {
  const violations = [...(game.decisionSafety?.violations || [])];
  if (game.phase === "complete") return violations;
  if (!actorId) {
    violations.push({ kind: "missing-active-actor", phase: game.phase });
    return violations;
  }
  // A required choice used to enumerate and simulate every candidate once
  // for option parity and then repeat the identical work for the empty-action
  // guard below. Keep one full legal command set for the entire immutable
  // decision boundary.
  // Outside a pending choice, the policy action set is sufficient for the
  // empty-boundary check and may be reused by callers. Pending choices still
  // require the full command set for exact option/decline parity.
  const legal = Array.isArray(knownPolicyActions) && !game.pendingChoice
    ? knownPolicyActions
    : enumerateLegalActions(game, actorId);
  if (game.pendingChoice) {
    const choice = game.pendingChoice;
    if (choice.playerId !== actorId) {
      violations.push({ kind: "choice-actor-mismatch", expected: choice.playerId, actual: actorId, effect: choice.effect });
    }
    const enabled = (choice.options || []).filter((option) => !option?.disabled);
    const optionIds = enabled.map((option) => option?.id ?? option?.value ?? option);
    if (!enabled.length && !choice.optional) {
      violations.push({ kind: "required-choice-without-options", effect: choice.effect, playerId: choice.playerId });
    }
    if (new Set(optionIds).size !== optionIds.length) {
      violations.push({ kind: "duplicate-choice-option", effect: choice.effect, playerId: choice.playerId });
    }
    const legalKeys = new Set(legal.map(actionKey));
    for (const optionId of optionIds) {
      const key = actionKey({ kind: "chooseEffectOption", optionId });
      if (!legalKeys.has(key)) violations.push({ kind: "choice-option-not-actionable", effect: choice.effect, optionId });
    }
    const declineKey = actionKey({ kind: "declineEffectChoice" });
    if (choice.optional !== legalKeys.has(declineKey)) {
      violations.push({ kind: "choice-decline-parity", effect: choice.effect, optional: Boolean(choice.optional) });
    }
  }
  if (game.pendingPayment?.playerId && game.pendingPayment.playerId !== actorId) {
    violations.push({ kind: "payment-actor-mismatch", expected: game.pendingPayment.playerId, actual: actorId });
  }
  if (!legal.length) violations.push({ kind: "no-legal-action", phase: game.phase, actorId });
  return uniqueViolations(violations);
}

export function auditRecordedDecisionSafety(game) {
  return uniqueViolations([...(game?.decisionSafety?.violations || [])]);
}

function canCompletePayment(game) {
  return Boolean(planPaymentActions(game));
}

export function planPaymentActions(source, options = {}) {
  const orders = [
    { reverse: false, powerFirst: true },
    { reverse: true, powerFirst: true },
    { reverse: false, powerFirst: false },
    { reverse: true, powerFirst: false }
  ];
  for (const order of orders) {
    const plan = attemptPaymentPlan(source, order, options);
    if (plan) return plan;
  }
  return null;
}

function attemptPaymentPlan(source, order, options = {}) {
  const game = cloneGame(source);
  const payment = game.pendingPayment;
  const player = game.players.find((candidate) => candidate.id === payment?.playerId);
  if (!payment || !player) return false;
  if (confirmPayment(cloneGame(game))?.ok) return [{ kind: "confirmPayment" }];
  const actions = [];
  if (options.allowResourceActivations !== false) {
    for (const action of paymentAddAbilityActions(game, player)) {
      const branch = cloneGame(game);
      if (!activateCard(branch, action.cardId, action.abilityId || null)?.ok) continue;
      // Generated resource ids are assigned while the ability resolves, so only
      // return the executable next step. The following payment decision replans
      // against the authoritative ids now present in the real game state.
      if (attemptPaymentPlan(branch, order, options)) return [action];
    }
  }
  const selectedPool = new Set(payment.poolEnergyIds || []);
  for (const energy of legalPaymentPoolEnergyOptions(game)) {
    if (selectedPool.has(energy.id) || !energy.canToggle) continue;
    const action = { kind: "togglePaymentPoolEnergy", energyId: energy.id };
    if (!togglePaymentPoolEnergy(game, energy.id)?.ok) continue;
    actions.push(action);
    if (confirmPayment(cloneGame(game))?.ok) return [...actions, { kind: "confirmPayment" }];
  }
  const selectedPoolPower = new Set(payment.poolPowerIds || []);
  for (const power of player.runePool?.power || []) {
    if (!power?.id || selectedPoolPower.has(power.id)) continue;
    const action = { kind: "togglePaymentPoolPower", powerId: power.id };
    if (!togglePaymentPoolPower(game, power.id)?.ok) continue;
    actions.push(action);
    if (confirmPayment(cloneGame(game))?.ok) return [...actions, { kind: "confirmPayment" }];
  }
  const runes = order.reverse ? [...player.runes].reverse() : [...player.runes];
  const modes = order.powerFirst ? ["power", "energy"] : ["energy", "power"];
  for (const mode of modes) {
    for (const rune of runes) {
      const selected = mode === "energy" ? game.pendingPayment.energyRuneIds : game.pendingPayment.powerRuneIds;
      if (selected?.includes(rune.instanceId)) continue;
      const action = { kind: "togglePaymentRune", runeId: rune.instanceId, mode };
      const result = togglePaymentRune(game, rune.instanceId, mode);
      if (!result?.ok) continue;
      actions.push(action);
      if (confirmPayment(cloneGame(game))?.ok) return [...actions, { kind: "confirmPayment" }];
    }
  }
  return null;
}

function paymentAddAbilityActions(game, player) {
  const sources = [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === player.id))
  ].filter(Boolean);
  return sources.flatMap((card) => legalActivatedAbilityOptions(game, card.instanceId)
    .filter((ability) => ability.kind === "addEnergy" || ability.kind === "addPower")
    .map((ability) => ({
      kind: "activateCard",
      cardId: card.instanceId,
      ...(ability.id ? { abilityId: ability.id } : {})
    })));
}

function candidateActions(game, actorId, kindFilter = null) {
  const wants = (kind) => !kindFilter || kindFilter === kind;
  const player = game.players.find((candidate) => candidate.id === actorId);
  if (!player) return [];
  if (game.phase === "first-player") {
    const decision = game.firstPlayerDecision;
    if (decision?.method === "roll" && decision.status === "rolling") {
      return wants("rollFirstPlayer") ? [{ kind: "rollFirstPlayer" }] : [];
    }
    if (["roll", "designated"].includes(decision?.method) && decision.status === "choosing") {
      return wants("chooseFirstPlayer")
        ? game.players.map((candidate) => ({ kind: "chooseFirstPlayer", playerId: candidate.id }))
        : [];
    }
    return wants("confirmFirstPlayer") ? [{ kind: "confirmFirstPlayer" }] : [];
  }
  if (game.phase === "champion-select") {
    return wants("selectChampion")
      ? player.availableChampions.map((card) => ({ kind: "selectChampion", cardId: card.instanceId }))
      : [];
  }
  if (game.phase === "battlefield-select") {
    return wants("selectBattlefield")
      ? player.availableBattlefields.map((field) => ({ kind: "selectBattlefield", battlefieldId: field.instanceId }))
      : [];
  }
  if (game.phase === "mulligan") {
    return [
      ...(wants("toggleMulliganCard") ? player.hand.map((card) => ({ kind: "toggleMulliganCard", cardId: card.instanceId })) : []),
      ...(wants("confirmMulligan") ? [{ kind: "confirmMulligan" }] : []),
      ...(wants("skipMulligan") ? [{ kind: "skipMulligan" }] : [])
    ];
  }
  if (game.pendingChoice) {
    return [
      ...(wants("chooseEffectOption") ? (game.pendingChoice.options || []).filter((option) => !option.disabled).map((option) => ({
        kind: "chooseEffectOption",
        optionId: option.id ?? option.value ?? option,
        ...(game.pendingChoice.effect === "triggerOrder" ? {
          confirmTriggerOrder: Boolean(option.confirmTriggerOrder),
          triggerOrderSelected: Boolean(option.selected),
          triggerOrderOptional: Boolean(option.optionalTrigger)
        } : {})
      })) : []),
      ...(wants("declineEffectChoice") && game.pendingChoice.optional ? [{ kind: "declineEffectChoice" }] : [])
    ];
  }
  if (game.pendingPayment) {
    const payment = game.pendingPayment;
    const addSources = [
      player.legend,
      player.champion?.zone === "played" ? player.champion : null,
      ...player.base,
      ...player.runes,
      ...game.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === actorId))
    ].filter(Boolean);
    return [
      ...(wants("choosePaymentOptions") && needsPaymentOptionDecision(game) ? paymentOptionActions(game, canCompletePayment) : []),
      ...(wants("activateCard") ? addSources.flatMap((card) => activatedAbilityActions(game, card)) : []),
      ...(wants("togglePaymentRune") ? player.runes.flatMap((rune) => [
        { kind: "togglePaymentRune", runeId: rune.instanceId, mode: "energy" },
        { kind: "togglePaymentRune", runeId: rune.instanceId, mode: "power" }
      ]) : []),
      ...(wants("togglePaymentPoolEnergy") ? legalPaymentPoolEnergyOptions(game)
        .filter((energy) => energy.canToggle)
        .map((energy) => ({ kind: "togglePaymentPoolEnergy", energyId: energy.id })) : []),
      ...(wants("togglePaymentPoolPower") ? (player.runePool?.power || []).filter((power) => power?.id).map((power) => ({ kind: "togglePaymentPoolPower", powerId: power.id })) : []),
      ...(wants("toggleOptionalPaymentEffect") ? (payment.optionalPowerEffects || payment.optionalEffects || []).map((effect) => ({ kind: "toggleOptionalPaymentEffect", effectId: effect.id })) : []),
      ...(wants("confirmPayment") ? [{ kind: "confirmPayment" }] : []),
      ...(wants("cancelPayment") ? [{ kind: "cancelPayment" }] : [])
    ];
  }

  const destinations = wants("moveUnit") || wants("moveUnits")
    ? ["base", ...game.battlefields.map((field) => field.instanceId)]
    : [];
  const hiddenCards = wants("beginPlayCard")
    ? game.battlefields.flatMap((field) => (field.hidden || [])
      .filter((item) => hiddenCardIsControlledBy(item, actorId))
      .map((item) => ({ card: item.card, destination: field.instanceId })))
    : [];
  const controlledCards = wants("activateCard") ? [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...player.runes,
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === actorId))
  ].filter(Boolean) : [];
  const hideSources = wants("hideCard") ? [
    ...player.hand,
    player.champion?.zone === "champion" && !player.championPlayed ? player.champion : null
  ].filter((card) => card && cardHasKeyword(game, card, "Hidden")) : [];
  const hideDestinations = wants("hideCard") ? game.battlefields.filter((field) =>
    field.controlledBy === actorId
    && hiddenCardsAtBattlefieldForPlayer(field, actorId) < hiddenSlotLimit(field)) : [];
  const movable = wants("moveUnit") || wants("moveUnits") ? [
    ...player.base.filter((card) => card.type === "unit"),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.type === "unit" && card.controllerId === actorId))
  ] : [];
  const actions = [
    ...(wants("beginPlayCard") ? player.hand.flatMap((card) => legalCardPlayDestinations(game, card.instanceId)
      .map((destination) => ({ kind: "beginPlayCard", cardId: card.instanceId, destination }))) : []),
    ...(wants("beginPlayCard") ? hiddenCards.map(({ card, destination }) => ({ kind: "beginPlayCard", cardId: card.instanceId, destination })) : []),
    ...(wants("beginPlayCardFromTrash") ? player.trash
      .flatMap((card) => legalCardPlayDestinations(game, card.instanceId)
        .map((destination) => ({ kind: "beginPlayCardFromTrash", cardId: card.instanceId, destination }))) : []),
    ...(wants("hideCard") ? hideSources.flatMap((card) => hideDestinations
      .map((field) => ({ kind: "hideCard", cardId: card.instanceId, destination: field.instanceId }))) : []),
    ...(wants("moveUnit") ? movable.flatMap((unit) => destinations.map((destinationId) => ({ kind: "moveUnit", unitId: unit.instanceId, destinationId }))) : []),
    ...(wants("moveUnits") ? batchMoveCandidates(game, movable, destinations) : []),
    ...(wants("activateCard") ? controlledCards.flatMap((card) => activatedAbilityActions(game, card)) : []),
    ...(wants("beginPlayChampion") ? legalChampionPlayDestinations(game)
      .map((destination) => ({ kind: "beginPlayChampion", destination })) : [])
  ];
  if (wants("passShowdown") && (game.phase === "showdown" || game.actionChain)) actions.push({ kind: "passShowdown" });
  if (wants("endTurn") && game.phase === "action" && !game.actionChain) actions.push({ kind: "endTurn" });
  return actions;
}

export function enumerateCommandCandidates(game, actorId = activeActorId(game)) {
  return actorId ? candidateActions(game, actorId) : [];
}

function activatedAbilityActions(game, card) {
  return legalActivatedAbilityOptions(game, card.instanceId).map((ability) => ({
    kind: "activateCard",
    cardId: card.instanceId,
    ...(ability.id ? { abilityId: ability.id } : {})
  }));
}

function batchMoveCandidates(game, units, destinations) {
  if (units.length < 2) return [];
  return destinations.flatMap((destinationId) => {
    const eligible = units.filter((unit) => canStandardMoveUnits(game, [unit.instanceId], destinationId));
    const subsets = new Map();
    const add = (group) => {
      if (group.length < 2) return;
      const unitIds = group.map((unit) => unit.instanceId).sort();
      subsets.set(JSON.stringify(unitIds), { kind: "moveUnits", unitIds, destinationId });
    };
    // Enumerate all subsets on ordinary boards. For large boards keep the
    // existing small-group coverage plus bounded attacks and leave-one-behind
    // groups, instead of an exponential power set.
    const limit = eligible.length <= 8 ? eligible.length : 3;
    add(eligible);
    for (let size = 2; size <= limit; size += 1) choose([], 0, size);
    if (eligible.length > 8) {
      for (const omitted of eligible) add(eligible.filter((unit) => unit !== omitted));
      const byMight = [...eligible].sort((a, b) => currentMight(game, b) - currentMight(game, a));
      for (let size = 4; size < eligible.length; size += 1) {
        add(byMight.slice(0, size));
        add(byMight.slice(-size));
      }
    }
    return [...subsets.values()];
    function choose(chosen, start, remaining) {
      if (!remaining) return add(chosen);
      for (let index = start; index <= eligible.length - remaining; index += 1) {
        choose([...chosen, eligible[index]], index + 1, remaining - 1);
      }
    }
  });
}

export function applyAiAction(game, action, actorId = activeActorId(game), options = {}) {
  if (!action || actorId !== activeActorId(game)) return { ok: false, message: "AI action actor does not have focus." };
  const previousCombatPlan = options.skipCombatPlan ? null : game.aiCombatCommitment;
  const previousCombatPlanValid = previousCombatPlan
    && validCommitment(game, previousCombatPlan.actorId, previousCombatPlan);
  const attackPlan = !options.skipCombatPlan && ['moveUnit','moveUnits'].includes(action.kind)
    ? inspectAttackPlan(game, actorId, action, movementProfile(game, actorId, action), combatPlanApi) : null;
  const turnEvent = publicActionTurnEvent(game, actorId, action);
  const turnEventSequenceBefore = Number(game.publicTurnEventSequence) || 0;
  addAiPerformance("applyCalls");
  const result = measureAiPerformance("applyMs", execute);
  const engineRecordedResponsePass = action.kind === "passShowdown"
    && (Number(game.publicTurnEventSequence) || 0) > turnEventSequenceBefore;
  if (result?.ok && turnEvent && !engineRecordedResponsePass) {
    recordPublicTurnEvent(game, turnEvent);
  }
  if (result?.ok && ["beginPlayCard", "beginPlayCardFromTrash", "beginPlayChampion", "hideCard", "activateCard"].includes(action.kind)
    && (game.pendingPayment || game.pendingChoice)) {
    game.aiDecisionContext = { key: actionKey(action), turnSequence: game.turnSequence };
  }
  if (result?.ok && action.kind === "cancelPayment" && game.aiDecisionContext) {
    if (game.aiDecisionContext.turnSequence === game.turnSequence) {
      const prior = game.aiDeclinedIntents?.turnSequence === game.turnSequence ? game.aiDeclinedIntents.keys : [];
      game.aiDeclinedIntents = { turnSequence: game.turnSequence, keys: [...new Set([...prior, game.aiDecisionContext.key])] };
    }
    game.aiDecisionContext = null;
  }
  if (result?.ok && ["confirmPayment", "declineEffectChoice"].includes(action.kind) && !game.pendingPayment && !game.pendingChoice) game.aiDecisionContext = null;
  if (result?.ok && !options.skipCombatPlan) {
    advanceCombatCommitment(game, actorId, action, previousCombatPlan, previousCombatPlanValid, combatPlanApi);
    if (attackPlan?.kind === 'supported-attack' && game.showdown?.battlefieldId === attackPlan.battlefieldId) {
      game.aiCombatCommitment = {...attackPlan,stateKey:combatCommitmentStateKey(game,actorId)};
    }
  }
  return result;

  function execute() {
    switch (action.kind) {
    case "rollFirstPlayer": return rollFirstPlayer(game, actorId);
    case "chooseFirstPlayer": return chooseFirstPlayer(game, actorId, action.playerId);
    case "confirmFirstPlayer": return confirmFirstPlayer(game);
    case "selectChampion": return selectChampion(game, actorId, action.cardId);
    case "selectBattlefield": return selectBattlefield(game, actorId, action.battlefieldId);
    case "toggleMulliganCard": return toggleMulliganCard(game, action.cardId);
    case "confirmMulligan": return confirmMulligan(game);
    case "skipMulligan": return skipMulligan(game);
    case "submitMulligan": return applyMulliganPlan();
    case "beginPlayCard": return beginPlayCard(game, action.cardId, action.destination);
    case "beginPlayCardFromTrash": return beginPlayCardFromTrash(game, action.cardId, action.destination);
    case "beginPlayChampion": return beginPlayChampion(game, action.destination);
    case "hideCard": return hideCard(game, action.cardId, action.destination);
    case "moveUnit": return moveUnit(game, action.unitId, action.destinationId);
    case "moveUnits": return moveUnits(game, action.unitIds, action.destinationId);
    case "activateCard": return activateCard(game, action.cardId, action.abilityId || null);
    case "togglePaymentRune": return togglePaymentRune(game, action.runeId, action.mode);
    case "togglePaymentPoolEnergy": return togglePaymentPoolEnergy(game, action.energyId);
    case "togglePaymentPoolPower": return togglePaymentPoolPower(game, action.powerId);
    case "toggleOptionalPaymentEffect": return toggleOptionalPaymentEffect(game, action.effectId);
    case "choosePaymentOptions": return applyPaymentOptions(game, action);
    case "confirmPayment": return confirmPayment(game);
    case "cancelPayment": return cancelPayment(game);
    case "chooseEffectOption": return chooseEffectOption(game, action.optionId);
    case "declineEffectChoice": return declineEffectChoice(game);
    case "passShowdown": return passShowdown(game, actorId);
    case "endTurn": return endTurn(game);
    default: return { ok: false, message: `Unknown AI action: ${action.kind}` };
    }
  }

  function applyMulliganPlan() {
    if (game.phase !== "mulligan" || game.mulligan?.playerId !== actorId) return { ok: false, message: "Mulligan is not active for that player." };
    const player = game.players.find((candidate) => candidate.id === actorId);
    const requested = [...new Set(action.cardIds || [])];
    if (!player || requested.length > 2 || requested.some((id) => !player.hand.some((card) => card.instanceId === id))) {
      return { ok: false, message: "Invalid mulligan plan." };
    }
    const desired = new Set(requested);
    const current = new Set(game.mulligan.selectedCardIds || []);
    for (const card of player.hand) {
      if (current.has(card.instanceId) === desired.has(card.instanceId)) continue;
      const toggled = toggleMulliganCard(game, card.instanceId);
      if (!toggled?.ok) return toggled;
    }
    return desired.size ? confirmMulligan(game) : skipMulligan(game);
  }
}

function publicActionTurnEvent(game, actorId, action) {
  if (!STRATEGIC_TURN_EVENT_ACTION_KINDS.has(action.kind)) return null;
  const payment = action.kind === "confirmPayment"
    ? game.pendingPayment
    : null;
  const sourceId = action.cardId || action.unitId || action.sourceId
    || payment?.cardId || null;
  const source = findActionCard(game, sourceId);
  const targetIds = [
    action.targetId,
    ...(action.targetIds || [])
  ].filter(Boolean).map(String);
  const sourceIds = [
    sourceId,
    ...(action.cardIds || []),
    ...(action.unitIds || [])
  ].filter(Boolean).map(String);
  const privateIdentities = [
    "toggleMulliganCard", "confirmMulligan", "skipMulligan",
    "submitMulligan", "hideCard"
  ].includes(action.kind);
  return {
    kind: "decision",
    turnNumber: Number(game.turnNumber) || 1,
    turnSequence: Number(game.turnSequence) || 0,
    phase: game.phase || null,
    actionKind: action.kind || null,
    actorId,
    sourceCardId: source?.instanceId || sourceId || null,
    sourceCardNumber: source?.cardNumber || action.cardNumber || null,
    sourceType: source?.type || null,
    sourceObjectIds: sourceIds,
    targetObjectIds: targetIds,
    destinationId:
      action.destinationId || action.destination || action.battlefieldId || null,
    optionId: action.optionId || action.abilityId || null,
    count: action.kind === "confirmPayment"
      ? paymentSelectionCount(payment)
      : Math.max(sourceIds.length, targetIds.length, 1),
    outcome: action.kind === "passShowdown" ? "pass" : "applied",
    visibility: privateIdentities
      ? "owner-private-identities"
      : "public"
  };
}

const STRATEGIC_TURN_EVENT_ACTION_KINDS = new Set([
  "submitMulligan",
  "beginPlayCard",
  "beginPlayCardFromTrash",
  "beginPlayChampion",
  "hideCard",
  "moveUnit",
  "moveUnits",
  "activateCard",
  // All rune/pool toggles are intentionally collapsed into this one event.
  "confirmPayment",
  "chooseEffectOption",
  "declineEffectChoice",
  "passShowdown",
  "endTurn"
]);

function paymentSelectionCount(payment) {
  if (!payment) return 1;
  const selectedResources = [
    ...(payment.energyRuneIds || []),
    ...(payment.powerRuneIds || []),
    ...(payment.poolEnergyIds || []),
    ...(payment.poolPowerIds || [])
  ].length;
  const selectedOptionalCosts = (payment.optionalPowerEffects || [])
    .filter((effect) => effect?.selected).length;
  return Math.max(1, selectedResources + selectedOptionalCosts);
}

function findActionCard(game, instanceId) {
  if (!instanceId) return null;
  const id = String(instanceId);
  const visit = (cards) => (cards || []).find((card) =>
    String(card?.instanceId || card?.id || "") === id) || null;
  for (const player of game.players || []) {
    for (const zone of [
      player.hand, player.mainDeck, player.trash, player.banished,
      player.base, player.runes, player.availableChampions
    ]) {
      const found = visit(zone);
      if (found) return found;
    }
    for (const singleton of [player.champion, player.legend]) {
      if (String(singleton?.instanceId || singleton?.id || "") === id) {
        return singleton;
      }
    }
  }
  for (const field of game.battlefields || []) {
    const unit = visit(field.units);
    if (unit) return unit;
    const hidden = visit((field.hidden || []).map((entry) => entry.card));
    if (hidden) return hidden;
  }
  for (const item of [
    ...(game.actionChain?.chain || []),
    ...(game.showdown?.chain || [])
  ]) {
    if (String(item?.card?.instanceId || item?.card?.id || "") === id) {
      return item.card;
    }
  }
  return null;
}

export function actionFromCommand(command) {
  if (!command?.kind) return null;
  return { ...command };
}

export function isStrategicAction(action) {
  return STRATEGIC_KINDS.has(action?.kind);
}

export function actionKey(action) {
  if (!action) return "none";
  const entries = Object.entries(action)
    .filter(([key, value]) => value !== undefined && !ACTION_ANNOTATION_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(entries));
}

export function cloneGame(game) {
  addAiPerformance("cloneCalls");
  return measureAiPerformance("cloneMs", () => cloneAiState(game));
}

function uniqueViolations(violations) {
  const unique = new Map();
  for (const violation of violations) unique.set(JSON.stringify(violation), violation);
  return [...unique.values()];
}

function sameActionValue(left, right) {
  if (left === right) return true;
  if (left == null || right == null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
