export const EVALUATOR_AUDIT_STRATUM_VERSION = 2;

export const EVALUATOR_AUDIT_PHASE_BANDS = Object.freeze([
  "mulligan",
  "early",
  "mid",
  "late"
]);

export const EVALUATOR_AUDIT_ACTION_CLASSES = Object.freeze([
  "mulligan",
  "movement-combat",
  "target-effect-choice",
  "card-use-vs-resource-preservation",
  "pass-turn-end",
  "card-play",
  "other"
]);

export const EVALUATOR_AUDIT_CORE_ACTION_CLASSES = Object.freeze([
  "movement-combat",
  "target-effect-choice",
  "card-use-vs-resource-preservation",
  "mulligan"
]);

const TURN_NUMBER_STATE_INDEX = 17;
const MULLIGAN_ACTION_KINDS = new Set([
  "toggleMulliganCard",
  "confirmMulligan",
  "skipMulligan",
  "submitMulligan"
]);
const MOVEMENT_ACTION_KINDS = new Set(["moveUnit", "moveUnits"]);
const PLAY_ACTION_KINDS = new Set([
  "beginPlayCard",
  "beginPlayChampion",
  "playCard",
  "playChampion",
  "hideCard",
  "activateCard"
]);
const HOLD_ACTION_KINDS = new Set(["endTurn", "passShowdown"]);
const CHOICE_ACTION_KINDS = new Set([
  "chooseEffectOption",
  "declineEffectChoice",
  "togglePaymentRune",
  "togglePaymentPoolEnergy",
  "togglePaymentPoolPower",
  "toggleOptionalPaymentEffect",
  "confirmPayment",
  "cancelPayment",
  "selectChampion",
  "selectBattlefield",
  "confirmFirstPlayer",
  "chooseFirstPlayer",
  "rollFirstPlayer"
]);

export function auditActionKind(action) {
  if (action && typeof action === "object") return action.kind || "unknown";
  if (typeof action !== "string" || !action) return "unknown";
  if (!action.startsWith("{")) return action;
  try {
    return JSON.parse(action)?.kind || "unknown";
  } catch {
    return "unknown";
  }
}

export function evaluatorAuditPhaseBand(game) {
  if (game?.phase === "mulligan") return "mulligan";
  return phaseBandForTurnNumber(game?.turnNumber);
}

export function evaluatorAuditPhaseBandFromState(
  state,
  actions = [],
  storedPhaseBand = null
) {
  const kinds = (actions || []).map(auditActionKind);
  if (kinds.some((kind) => MULLIGAN_ACTION_KINDS.has(kind))) {
    return "mulligan";
  }
  const encodedTurn = Number(state?.[TURN_NUMBER_STATE_INDEX]);
  if (Number.isFinite(encodedTurn) && encodedTurn > 0) {
    return phaseBandForTurnNumber(Math.max(1, Math.round(encodedTurn * 20)));
  }
  return storedPhaseBand && storedPhaseBand !== "early"
    ? storedPhaseBand
    : "unknown";
}

export function evaluatorAuditActionClass(options = {}) {
  const phaseBand = options.phaseBand
    || (options.game ? evaluatorAuditPhaseBand(options.game) : null);
  const recommendedKind = auditActionKind(options.recommendedAction);
  const selectedKind = auditActionKind(options.selectedAction);
  const legalKinds = new Set(
    (options.legalActions || []).map(auditActionKind).filter(Boolean)
  );
  const comparedKinds = [recommendedKind, selectedKind];
  if (phaseBand === "mulligan"
    || comparedKinds.some((kind) => MULLIGAN_ACTION_KINDS.has(kind))) {
    return "mulligan";
  }
  if (comparedKinds.some((kind) => MOVEMENT_ACTION_KINDS.has(kind))) {
    return "movement-combat";
  }
  if (options.game?.pendingChoice
    || comparedKinds.some((kind) =>
      CHOICE_ACTION_KINDS.has(kind) || kind.startsWith("choose"))) {
    return "target-effect-choice";
  }
  const selectedIsPlay = PLAY_ACTION_KINDS.has(selectedKind);
  const selectedIsHold = HOLD_ACTION_KINDS.has(selectedKind);
  const comparedPlayAndHold = comparedKinds.some((kind) =>
    PLAY_ACTION_KINDS.has(kind))
    && comparedKinds.some((kind) => HOLD_ACTION_KINDS.has(kind));
  const legalPlayAndHold = (selectedIsPlay
    && [...legalKinds].some((kind) => HOLD_ACTION_KINDS.has(kind)))
    || (selectedIsHold
      && [...legalKinds].some((kind) => PLAY_ACTION_KINDS.has(kind)));
  if (comparedPlayAndHold || legalPlayAndHold) {
    return "card-use-vs-resource-preservation";
  }
  if (comparedKinds.some((kind) => HOLD_ACTION_KINDS.has(kind))) {
    return "pass-turn-end";
  }
  if (comparedKinds.some((kind) => PLAY_ACTION_KINDS.has(kind))) {
    return "card-play";
  }
  return "other";
}

export function evaluatorAuditOpportunityActionClasses(options = {}) {
  const phaseBand = options.phaseBand || null;
  const legalKinds = new Set(
    (options.legalActions || []).map(auditActionKind).filter(Boolean)
  );
  const opportunities = new Set();
  if (phaseBand === "mulligan"
    || [...legalKinds].some((kind) => MULLIGAN_ACTION_KINDS.has(kind))) {
    opportunities.add("mulligan");
  }
  if ([...legalKinds].some((kind) => MOVEMENT_ACTION_KINDS.has(kind))) {
    opportunities.add("movement-combat");
  }
  if ([...legalKinds].some((kind) =>
    CHOICE_ACTION_KINDS.has(kind) || kind.startsWith("choose"))) {
    opportunities.add("target-effect-choice");
  }
  const hasPlay = [...legalKinds].some((kind) => PLAY_ACTION_KINDS.has(kind));
  const hasHold = [...legalKinds].some((kind) => HOLD_ACTION_KINDS.has(kind));
  if (hasPlay && hasHold) {
    opportunities.add("card-use-vs-resource-preservation");
  }
  return [...opportunities].sort();
}

export function normalizeEvaluatorAuditStratum(options = {}) {
  const stored = options.stored || {};
  const phaseBand = options.game
    ? evaluatorAuditPhaseBand(options.game)
    : evaluatorAuditPhaseBandFromState(
      options.state,
      [
        options.recommendedAction,
        options.selectedAction,
        ...(options.legalActions || [])
      ],
      stored.phaseBand
    );
  const actionClass = evaluatorAuditActionClass({
    game: options.game,
    phaseBand,
    recommendedAction: options.recommendedAction,
    selectedAction: options.selectedAction,
    legalActions: options.legalActions
  });
  const deckId = options.deckId || stored.deckId || "unknown-deck";
  const seat = normalizeSeat(options.seat ?? stored.seat);
  return {
    version: EVALUATOR_AUDIT_STRATUM_VERSION,
    deckId,
    seat,
    phaseBand,
    actionClass,
    key: [deckId, seat, phaseBand, actionClass].join(":")
  };
}

export function reclassifyTrajectoryAuditStrata(trajectory) {
  const deckId = trajectory?.deckId || "unknown-deck";
  const seat = normalizeSeat(
    trajectory?.playerId ?? trajectory?.playerSeat
  );
  for (const step of trajectory?.steps || []) {
    if (step.actionRankingAuditDiagnostic) {
      step.actionRankingAuditDiagnostic.auditStratum =
        normalizeEvaluatorAuditStratum({
          stored:
            step.actionRankingAuditDiagnostic.auditStratum
            || step.actionRankingAuditDiagnostic.racing?.stratum,
          state: step.state,
          recommendedAction: step.recommendedActionKey,
          selectedAction: step.selectedActionKey,
          legalActions: step.legalActionKeys,
          deckId,
          seat
        });
      if (step.actionRankingAuditDiagnostic.racing) {
        step.actionRankingAuditDiagnostic.racing.stratum =
          structuredClone(
            step.actionRankingAuditDiagnostic.auditStratum
          );
      }
    }
    const auditReference = step.actionRankingAuditReference;
    if (auditReference) {
      auditReference.auditStratum = normalizeEvaluatorAuditStratum({
        stored: auditReference.auditStratum,
        state: step.state,
        recommendedAction:
          auditReference.correctActionKey || step.recommendedActionKey,
        selectedAction:
          auditReference.comparedActionKey || step.selectedActionKey,
        legalActions: step.legalActionKeys,
        deckId,
        seat
      });
    }
    for (const reference of [
      step.leafValueAuditReference,
      step.actionRankingReference?.leafValueReference
    ]) {
      if (!reference) continue;
      reference.auditStratum = normalizeEvaluatorAuditStratum({
        stored: reference.auditStratum,
        state: step.state,
        recommendedAction: step.recommendedActionKey,
        selectedAction: step.selectedActionKey,
        legalActions: step.legalActionKeys,
        deckId,
        seat
      });
    }
  }
  return trajectory;
}

function phaseBandForTurnNumber(value) {
  const turnNumber = Number(value);
  if (!Number.isFinite(turnNumber) || turnNumber < 1) return "unknown";
  if (turnNumber <= 2) return "early";
  if (turnNumber <= 5) return "mid";
  return "late";
}

function normalizeSeat(value) {
  if (value === "p1" || value === 0 || value === "0") return "p1";
  if (value === "p2" || value === 1 || value === "1") return "p2";
  return value || "unknown";
}
