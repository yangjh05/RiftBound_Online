import { actionKey } from "../actions.mjs";
import {
  movementProfile,
  tacticalActionProfile,
  temporaryChoicePurposeProfile,
  temporaryCommitmentProfile
} from "../action-tactics.mjs";
import { proveImmediateActionOutcome } from "../rollout.mjs";
import { PROOF_LABEL_VERSION } from "./proof-contract.mjs";

export { PROOF_LABEL_VERSION } from "./proof-contract.mjs";

const STOP_KINDS = new Set(["endTurn", "passShowdown", "declineEffectChoice"]);
const IMMEDIATE_OUTCOME_KINDS = new Set([
  "endTurn",
  "passShowdown",
  "declineEffectChoice",
  "chooseEffectOption",
  "moveUnit",
  "moveUnits",
  "activateCard"
]);

// This reviewer deliberately has no rollout, model, or query budget. Actual
// engine transitions are proofs; tactical semantics are lower-confidence rule
// guards and must never be reported with proof-level confidence.
export function proofTeacherDecision(game, actorId, legalActions, selectedAction) {
  if (!actorId || !selectedAction || !Array.isArray(legalActions) || legalActions.length < 2) return null;
  if (["first-player", "champion-select", "battlefield-select", "mulligan"].includes(game?.phase)) return null;
  const actions = uniqueActions(legalActions);
  const selectedKey = actionKey(selectedAction);

  const terminalWins = immediateWinningActions(game, actorId, actions);
  if (terminalWins.length) {
    return proofLabel(actions, selectedKey, terminalWins, "immediate-terminal-win", [
      "engine-transition-proves-win"
    ], { evidenceKind: "engine-proof", confidence: 1 });
  }

  const targetDominance = provenTargetDominance(game, actorId, actions, selectedAction);
  if (targetDominance.length) {
    return proofLabel(actions, selectedKey, targetDominance, "dominated-effect-target", [
      "same-effect-has-aligned-target",
      "selected-target-is-locally-self-destructive"
    ], { evidenceKind: "rule-guard", confidence: 0.75 });
  }

  const temporaryPurpose = provenTemporaryPurpose(game, actorId, actions, selectedAction);
  if (temporaryPurpose.length) {
    return proofLabel(actions, selectedKey, temporaryPurpose, "temporary-effect-without-purpose", [
      "temporary-effect-has-no-current-window-payoff"
    ], { evidenceKind: "rule-guard", confidence: 0.65 });
  }

  const movementDominance = provenMovementDominance(game, actorId, actions, selectedAction);
  if (movementDominance.length) {
    return proofLabel(actions, selectedKey, movementDominance, "risk-free-tactical-gain", [
      "selected-line-has-no-opponent-impact",
      "alternative-has-no-response-removal-or-control-gain"
    ], { evidenceKind: "rule-guard", confidence: 0.7 });
  }

  return null;
}

function immediateWinningActions(game, actorId, actions) {
  const actor = game?.players?.find((player) => player.id === actorId);
  const victoryScore = Math.max(1, Number(game?.victoryScore) || 8);
  const nearVictory = (Number(actor?.score) || 0) >= victoryScore - 2;
  return actions.filter((action) => {
    if (!nearVictory && !IMMEDIATE_OUTCOME_KINDS.has(action.kind)) return false;
    return proveImmediateActionOutcome(game, actorId, action).won === true;
  });
}

function provenTargetDominance(game, actorId, actions, selectedAction) {
  if (selectedAction.kind !== "chooseEffectOption" || !game?.pendingChoice) return [];
  const selected = tacticalActionProfile(game, actorId, selectedAction);
  if (selected.targetAlignment >= 0
    || selected.savesFromLethal
    || selected.friendlyDestructionPayoff
    || selected.targetAlreadyThreatened
    || selected.independentOpponentImpact) return [];
  return actions.filter((action) => {
    if (action.kind !== "chooseEffectOption" || actionKey(action) === actionKey(selectedAction)) return false;
    const candidate = tacticalActionProfile(game, actorId, action);
    return !candidate.clearlySelfDestructive
      && candidate.targetAlignment > 0
      && candidate.polarity === selected.polarity
      && candidate.casterSideBenefit + 1e-9 >= selected.casterSideBenefit;
  });
}

function provenTemporaryPurpose(game, actorId, actions, selectedAction) {
  if (selectedAction.kind === "chooseEffectOption") {
    const selected = temporaryChoicePurposeProfile(game, actorId, selectedAction);
    if (!selected.isTemporaryChoice || selected.clearPurpose) return [];
    return actions.filter((action) => action.kind === "chooseEffectOption"
      && temporaryChoicePurposeProfile(game, actorId, action).isTemporaryChoice
      && temporaryChoicePurposeProfile(game, actorId, action).clearPurpose);
  }
  const selected = temporaryCommitmentProfile(game, actorId, selectedAction);
  if (!selected.isTemporaryCommitment || selected.clearPurpose) return [];
  return actions.filter((action) => STOP_KINDS.has(action.kind));
}

function provenMovementDominance(game, actorId, actions, selectedAction) {
  const selectedIsStop = STOP_KINDS.has(selectedAction.kind);
  const selectedIsMovement = ["moveUnit", "moveUnits"].includes(selectedAction.kind);
  if (!selectedIsStop && !selectedIsMovement) return [];
  const selectedProfile = selectedIsMovement
    ? movementProfile(game, actorId, selectedAction)
    : null;
  if (selectedIsMovement && !selectedProfile.noOpponentImpact && !selectedProfile.hopelessReinforcement) {
    return [];
  }
  return actions.filter((action) => {
    if (!["moveUnit", "moveUnits"].includes(action.kind)) return false;
    if (selectedIsMovement && action.destinationId !== selectedAction.destinationId) return false;
    const candidate = movementProfile(game, actorId, action);
    return candidate.strictlyBeneficial
      && !candidate.sourceControlRisk
      && !candidate.enemyCanRemoveFriendly;
  });
}

function proofLabel(actions, selectedKey, provenActions, proofKind, reasons, evidence = {}) {
  const provenKeys = [...new Set(provenActions.map(actionKey))];
  const provenKeySet = new Set(provenKeys);
  const selectedIndex = actions.findIndex((action) => actionKey(action) === selectedKey);
  const proofIndex = actions.findIndex((action) => provenKeySet.has(actionKey(action)));
  if (selectedIndex < 0 || proofIndex < 0) return null;
  const agreement = provenKeySet.has(selectedKey);
  const targetWeight = 1 / provenKeys.length;
  return {
    labelVersion: PROOF_LABEL_VERSION,
    proofKind,
    evidenceKind: evidence.evidenceKind || "rule-guard",
    reasons,
    action: actions[proofIndex],
    selectedIndex: proofIndex,
    policySelectedIndex: selectedIndex,
    agreement,
    correctionEligible: !agreement,
    confidence: Math.max(0, Math.min(1, Number(evidence.confidence) || 0)),
    correctionAlternativeKeys: provenKeys,
    targets: actions.map((action) => provenKeySet.has(actionKey(action)) ? targetWeight : 0),
    actionValueTargets: actions.map((action) =>
      provenKeySet.has(actionKey(action)) ? 1 : actionKey(action) === selectedKey ? -1 : 0),
    actionValueWeights: actions.map((action) =>
      provenKeySet.has(actionKey(action)) || actionKey(action) === selectedKey ? 1 : 0)
  };
}

function uniqueActions(actions) {
  return [...new Map(actions.map((action) => [actionKey(action), action])).values()];
}
