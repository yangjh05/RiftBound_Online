import { actionKey, cloneGame } from "../actions.mjs";
import { DEFAULT_AI_MODEL, scoreActions } from "../policy.mjs";
import { simulationTeacherDecision } from "./teacher.mjs";
import { TEACHER_LABEL_VERSION } from "./teacher-contract.mjs";
import { NEURAL_HIDDEN_SIZE } from "./model.mjs";
import { createActionRankingReference } from "./action-ranking-reference.mjs";

export const POSTMORTEM_REVIEW_VERSION = 2;

export function capturePostmortemCandidate(game, actorId, decision, step, context = {}) {
  if (!game || !actorId || !step || (decision?.legalCount || 0) < 2) return null;
  if (["first-player", "champion-select", "battlefield-select"].includes(game.phase)) return null;
  const reasons = postmortemCandidateReasons(game, actorId, decision, context);
  if (!reasons.length) return null;
  return {
    version: POSTMORTEM_REVIEW_VERSION,
    actorId,
    actionCount: Number(step.actionCount) || 0,
    priority: postmortemCandidatePriority(reasons, context),
    reasons,
    game: cloneGame(game),
    legalActions: structuredClone(decision.legalActions || []),
    selectedAction: structuredClone(decision.action),
    policyProbabilities: Array.from(decision.probabilities || []),
    teacherProposalValues: Array.from(decision.teacherProposalValues || []),
    neuralBelief: decision.belief ? structuredClone(decision.belief) : null,
    initialMemories: cloneInitialMemories(context.initialMemories),
    requiredActions: structuredClone(context.criticalDecision?.requiredActions || []),
    uncertainty: clamp01(context.uncertainty),
    step,
    reviewSeed: postmortemSeed(game, actorId, Number(step.actionCount) || 0)
  };
}

export function finalizePostmortemCandidate(candidate, step, gameAfter = null) {
  if (!candidate || !step) return candidate;
  if (step.turningPoint) {
    candidate.reasons = [...new Set([...candidate.reasons, step.turningPoint])];
    candidate.priority += turningPointPriority(step.turningPoint);
  }
  const leadLoss = Math.max(0, Number(step.scoreLeadBefore) - Number(step.scoreLeadAfter));
  candidate.priority += Math.min(4, leadLoss * 1.5);
  if (leadLoss > 0) candidate.reasons = [...new Set([...candidate.reasons, "score-lead-drop"])];
  if (gameAfter) {
    const before = publicMaterialProfile(candidate.game, candidate.actorId);
    const after = publicMaterialProfile(gameAfter, candidate.actorId);
    if (after.controlledBattlefields < before.controlledBattlefields) {
      candidate.reasons = [...new Set([...candidate.reasons, "control-loss"])];
      candidate.priority += 4;
    }
    if (after.unitCount < before.unitCount || after.unitMight + 1e-9 < before.unitMight) {
      candidate.reasons = [...new Set([...candidate.reasons, "irreversible-unit-loss"])];
      candidate.priority += Math.min(5, Math.max(
        before.unitCount - after.unitCount,
        (before.unitMight - after.unitMight) * 0.5
      ));
    }
  }
  return candidate;
}

export function retainPostmortemCandidate(candidatesByPlayer, candidate, limit = 8) {
  if (!candidate?.actorId) return;
  const candidates = candidatesByPlayer.get(candidate.actorId) || [];
  candidates.push(candidate);
  candidates.sort((left, right) => right.priority - left.priority
    || left.actionCount - right.actionCount);
  candidates.splice(Math.max(1, limit));
  candidatesByPlayer.set(candidate.actorId, candidates);
}

export function reviewDefeatPostmortems(candidatesByPlayer, options = {}) {
  const winnerId = options.winnerId || null;
  const configuredMaximumReviews = Number(options.maximumReviews);
  const maximumReviews = Math.max(0, Math.min(4,
    Number.isFinite(configuredMaximumReviews) ? configuredMaximumReviews : 2));
  const minimumSimulations = Math.max(8, Math.min(32, Number(options.minimumSimulations) || 16));
  const minimumConfidence = Math.max(0.35, Math.min(0.8, Number(options.minimumConfidence) || 0.45));
  const minimumRegret = Math.max(0.03, Math.min(0.25, Number(options.minimumRegret) || 0.05));
  const teacherDecision = options.teacherDecision || simulationTeacherDecision;
  const reviews = [];
  if (!winnerId || maximumReviews === 0) return summarizePostmortemReviews(reviews, candidatesByPlayer);
  const configuredWinnerReviewFraction = Number(options.winnerReviewFraction);
  const winnerReviewFraction = clamp(
    Number.isFinite(configuredWinnerReviewFraction) ? configuredWinnerReviewFraction : 0.15,
    0,
    1
  );
  const winnerCandidates = candidatesByPlayer.get(winnerId) || [];
  const winnerReviewRandom = seededPostmortemRandom(
    ((winnerCandidates[0]?.reviewSeed || 1) ^ 0xa511e9b3) >>> 0
  );
  const reviewWinner = winnerCandidates.length > 0 && winnerReviewRandom() < winnerReviewFraction;

  for (const [actorId, candidates] of candidatesByPlayer) {
    const outcomeRole = actorId === winnerId ? "winner" : "loser";
    const actorMaximumReviews = outcomeRole === "winner" ? (reviewWinner ? 1 : 0) : maximumReviews;
    if (actorMaximumReviews === 0) continue;
    const selected = selectSeparatedPostmortemCandidates(
      candidates,
      actorMaximumReviews,
      options.minimumActionDistance || 6
    );
    for (const candidate of selected) {
      const neuralModel = options.neuralModels?.[actorId] || null;
      const teacher = teacherDecision(candidate.game, actorId, candidate.legalActions, {
        model: options.model || DEFAULT_AI_MODEL,
        neuralModel,
        neuralModels: options.neuralModels,
        evaluatorModels: [...new Set(
          options.evaluatorModelsByActor?.[actorId] || []
        )],
        evaluatorModelsCertified: true,
        engineFingerprint: options.engineFingerprint,
        initialMemories: candidate.initialMemories,
        neuralBelief: candidate.neuralBelief,
        requiredAction: candidate.selectedAction,
        requiredActions: candidate.requiredActions,
        policyProbabilities: candidate.policyProbabilities,
        proposalValues: candidate.teacherProposalValues,
        screenSimulations: Math.max(2, Number(options.screenSimulations) || 4),
        confirmationMinimumSimulations: 8,
        confirmationSimulations: minimumSimulations,
        confirmationMaxSimulations: Math.max(
          minimumSimulations,
          Number(options.maximumSimulations) || 32
        ),
        depth: Math.max(10, Number(options.depth) || 16),
        maxCandidates: Math.max(2, Number(options.maxCandidates) || 6),
        uncertainty: candidate.uncertainty,
        critical: true,
        random: seededPostmortemRandom(candidate.reviewSeed)
      });
      const review = buildPostmortemReview(candidate, teacher, {
        finalScores: options.finalScores,
        minimumSimulations,
        minimumConfidence,
        minimumRegret,
        outcomeRole
      });
      candidate.step.postmortemReview = review;
      const correctionSteps = review.verifiedLocalRegret
        ? buildPostmortemCorrectionSteps(candidate, teacher, review)
        : null;
      if (correctionSteps?.length) candidate.step.postmortemCorrectionSteps = correctionSteps;
      if (review.verifiedLocalRegret && !candidate.step.actionRankingReference) {
        candidate.step.actionRankingReference = postmortemActionRankingReference(
          candidate,
          teacher,
          review
        );
        if (candidate.step.actionRankingReference
          && !Array.isArray(candidate.step.fullHeuristicScores)) {
          const scoresByKey = new Map(
            scoreActions(candidate.game, candidate.actorId, candidate.legalActions, DEFAULT_AI_MODEL)
              .map((item) => [item.key, item.score])
          );
          candidate.step.fullHeuristicScores = candidate.legalActions.map((action) =>
            scoresByKey.get(actionKey(action)));
          candidate.step.fullHeuristicEvaluatorVersion = 1;
        }
      }
      reviews.push(review);
    }
  }
  return summarizePostmortemReviews(reviews, candidatesByPlayer);
}

export function buildPostmortemReview(candidate, teacher, options = {}) {
  const selectedKey = actionKey(candidate?.selectedAction);
  const teacherKey = actionKey(teacher?.action);
  const paired = teacher?.policyComparison?.pairedEvidence || null;
  const regret = Math.max(0, Number(teacher?.policyComparison?.regret) || 0);
  const confidence = clamp01(teacher?.correctionConfidence ?? teacher?.confidence);
  const terminalProof = teacher?.verification?.proofKind === "immediate-terminal-win";
  const independentConfirmation = terminalProof || Boolean(
    teacher?.confirmation?.independent === true
    && teacher?.confirmation?.seedBanks?.disjoint === true
    && teacher?.confirmation?.determinizationAudit?.complete === true
  );
  const confirmationValidity = terminalProof || Boolean(
    Number(teacher?.confirmation?.validPairedSamples) >= Number(options.minimumSimulations || 16)
    && Number(teacher?.confirmation?.validRates?.recommended) >= 0.75
    && Number(teacher?.confirmation?.validRates?.selected) >= 0.75
    && teacher?.confirmation?.determinizationAudit?.complete === true
  );
  const enoughPairedEvidence = terminalProof || (Number(paired?.samples) >= Number(options.minimumSimulations || 16)
    && Number(paired?.lowerBound) > 0);
  const verifiedLocalRegret = Boolean(
    teacher?.labelVersion === TEACHER_LABEL_VERSION
    && teacher?.correctionEligible === true
    && teacher?.verification?.status === "verified"
    && teacherKey
    && teacherKey !== selectedKey
    && confidence >= Number(options.minimumConfidence || 0.45)
    && (terminalProof || regret >= Number(options.minimumRegret || 0.05))
    && independentConfirmation
    && confirmationValidity
    && enoughPairedEvidence
  );
  const bestAlternative = teacher?.alternatives?.find((alternative) =>
    actionKey(alternative.action) === teacherKey) || null;
  const selectedAlternative = teacher?.alternatives?.find((alternative) =>
    actionKey(alternative.action) === selectedKey) || null;
  return {
    version: POSTMORTEM_REVIEW_VERSION,
    status: verifiedLocalRegret ? "verified-local-regret" : teacher ? "unproven" : "not-reviewed",
    verifiedLocalRegret,
    // Compatibility alias for v1 archives and report readers.
    avoidableLoss: verifiedLocalRegret,
    cause: verifiedLocalRegret ? classifyPostmortemCause(candidate, teacher) : "unproven-local-regret",
    outcomeRole: options.outcomeRole || null,
    actorId: candidate?.actorId || null,
    actionCount: candidate?.actionCount ?? null,
    informationSetHash: candidate?.step?.informationSetHash || null,
    candidateReasons: [...(candidate?.reasons || [])],
    actualActionKey: selectedKey || null,
    recommendedActionKeys: verifiedLocalRegret
      ? [...new Set(teacher?.correctionAlternativeKeys || [teacherKey])]
      : [],
    expectedWinRateBefore: selectedAlternative?.expectedWinRate ?? teacher?.policyComparison?.selectedExpectedWinRate ?? null,
    expectedWinRateAfter: bestAlternative?.expectedWinRate ?? teacher?.expectedWinRate ?? null,
    expectedWinRateDelta: regret,
    confidence,
    pairedEvidence: paired,
    independentConfirmation,
    confirmationValidity,
    confirmation: teacher?.confirmation || null,
    determinizationAudit: terminalProof
      ? {
        version: 1,
        source: "direct-engine-transition",
        complete: true
      }
      : structuredClone(teacher?.confirmation?.determinizationAudit || {
        version: 1,
        source: "missing-confirmation-audit",
        complete: false
      }),
    proofKind: teacher?.verification?.proofKind || null,
    verificationReasons: teacher?.verification?.reasons || [],
    simulations: Math.min(
      Number(bestAlternative?.simulations) || 0,
      Number(selectedAlternative?.simulations) || Number(bestAlternative?.simulations) || 0
    ),
    board: publicPostmortemBoard(candidate?.game, candidate?.actorId),
    finalScores: Array.isArray(options.finalScores) ? [...options.finalScores] : null
  };
}

export function selectSeparatedPostmortemCandidates(candidates, limit, minimumDistance = 6) {
  const selected = [];
  for (const candidate of [...(candidates || [])].sort((left, right) =>
    right.priority - left.priority || left.actionCount - right.actionCount)) {
    if (selected.every((item) => Math.abs(item.actionCount - candidate.actionCount) >= minimumDistance)) {
      selected.push(candidate);
    }
    if (selected.length >= Math.max(0, limit)) break;
  }
  return selected.sort((left, right) => left.actionCount - right.actionCount);
}

function postmortemActionRankingReference(candidate, teacher, review) {
  const correctIndex = Number(teacher?.selectedIndex);
  const comparedIndex = candidate?.legalActions?.findIndex((action) =>
    actionKey(action) === actionKey(candidate.selectedAction));
  if (!Number.isInteger(correctIndex) || !Number.isInteger(comparedIndex)
    || correctIndex === comparedIndex) return null;
  const legalActionKeys = candidate.legalActions.map(actionKey);
  if (teacher?.verification?.proofKind === "immediate-terminal-win") {
    return createActionRankingReference({
      informationSetHash: candidate.step?.informationSetHash,
      informationSetHashVersion: candidate.step?.informationSetHashVersion || 1,
      correctIndex,
      comparedIndex,
      correctActionKey: legalActionKeys[correctIndex],
      comparedActionKey: legalActionKeys[comparedIndex],
      evidenceKind: "engine-proof",
      pairedSamples: 1,
      proofKind: "postmortem-immediate-terminal-win",
      modelHashes: []
    });
  }
  if (teacher?.verification?.proofKind !== "confirmed-terminal-rollout-dominance") {
    return null;
  }
  const confirmation = teacher.confirmation;
  const terminalPaired = confirmation?.terminalPairedEvidence;
  const attemptedRecommended = Number(confirmation?.attemptedSimulations?.recommended) || 0;
  const attemptedSelected = Number(confirmation?.attemptedSimulations?.selected) || 0;
  return createActionRankingReference({
    informationSetHash: candidate.step?.informationSetHash,
    informationSetHashVersion: candidate.step?.informationSetHashVersion || 1,
    correctIndex,
    comparedIndex,
    correctActionKey: legalActionKeys[correctIndex],
    comparedActionKey: legalActionKeys[comparedIndex],
    evidenceKind: "terminal-postmortem-dominance",
    validSamples: {
      correct: Math.floor(
        attemptedRecommended * (Number(confirmation?.validRates?.recommended) || 0)
      ),
      compared: Math.floor(
        attemptedSelected * (Number(confirmation?.validRates?.selected) || 0)
      )
    },
    terminalSamples: {
      correct: Math.floor(
        attemptedRecommended
          * (Number(confirmation?.validRates?.recommended) || 0)
          * (Number(confirmation?.terminalRates?.recommended) || 0)
      ),
      compared: Math.floor(
        attemptedSelected
          * (Number(confirmation?.validRates?.selected) || 0)
          * (Number(confirmation?.terminalRates?.selected) || 0)
      )
    },
    pairedSamples: Number(terminalPaired?.samples) || 0,
    pairedLowerBound: terminalPaired?.lowerBound,
    pairedUpperBound: terminalPaired?.upperBound,
    seedBanks: confirmation?.seedBanks,
    determinizationAudit: review.determinizationAudit,
    leafValuePairs: confirmation?.leafValuePairs,
    proofKind: "terminal-postmortem-dominance",
    modelHashes: []
  });
}

function buildPostmortemCorrectionSteps(candidate, teacher, review) {
  const parent = candidate.step;
  const teacherTargets = postmortemTargetDistribution(teacher, candidate.legalActions);
  const valueSupervision = postmortemValueSupervision(teacher, candidate.legalActions, review.confidence);
  const expectedReturn = clamp(Number(teacher.expectedWinRate) * 2 - 1, -1, 1);
  const correction = {
    state: parent.state,
    actions: parent.actions,
    selectedIndex: teacher.selectedIndex,
    legalCount: parent.legalCount,
    originalLegalCount: parent.originalLegalCount,
    actionManifestVersion: 2,
    originalLegalActionKeys: parent.originalLegalActionKeys || parent.legalActionKeys,
    selectedActionKey: actionKey(teacher.action),
    behaviorActionKey: actionKey(candidate.selectedAction),
    recommendedActionKey: actionKey(teacher.action),
    informationSetHash: parent.informationSetHash || null,
    legalActionKeys: candidate.legalActions.map(actionKey),
    oldLogProbability: 0,
    value: parent.value,
    initialMemory: parent.initialMemory,
    advantage: review.confidence,
    return: expectedReturn,
    beliefTarget: parent.beliefTarget,
    teacherIndex: teacher.selectedIndex,
    teacherTargets,
    teacherActionValueTargets: valueSupervision.targets,
    teacherActionValueWeights: valueSupervision.weights,
    teacherLabelVersion: TEACHER_LABEL_VERSION,
    teacherCorrectionEligible: true,
    teacherVerificationStatus: "verified",
    teacherPolicyEligible: true,
    teacherVerificationReasons: teacher.verification?.reasons || [],
    teacherConfidence: review.confidence,
    teacherSearchConfidence: teacher.searchConfidence,
    teacherCorrectionConfidence: teacher.correctionConfidence,
    teacherSelectedRegret: review.expectedWinRateDelta,
    teacherRankingMargin: Math.min(0.5, Math.max(0.05, review.expectedWinRateDelta * 0.5)),
    teacherProofKind: teacher.verification?.proofKind || "postmortem-paired-improvement",
    teacherEvidenceSource: postmortemEvidenceSource(teacher, review),
    postmortemVersion: POSTMORTEM_REVIEW_VERSION,
    postmortemCause: review.cause,
    imitation: true,
    source: "postmortem-local-regret"
  };
  const macroSteps = teacher.macroDemonstration?.verified
    ? teacher.macroDemonstration.steps.map((step, index) => ({
      ...step,
      oldLogProbability: 0,
      value: 0,
      initialMemory: step.initialMemory,
      advantage: review.confidence,
      return: expectedReturn,
      teacherIndex: step.selectedIndex,
      teacherTargets: oneHot(step.legalCount, step.selectedIndex),
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: true,
      teacherVerificationStatus: "verified",
      teacherPolicyEligible: true,
      teacherVerificationReasons: [],
      teacherConfidence: review.confidence,
      teacherSearchConfidence: teacher.searchConfidence,
      teacherCorrectionConfidence: teacher.correctionConfidence,
      teacherSelectedRegret: review.expectedWinRateDelta,
      teacherRankingMargin: Math.min(0.5, Math.max(0.05, review.expectedWinRateDelta * 0.5)),
      teacherProofKind: "verified-declaration-macro",
      teacherEvidenceSource: postmortemEvidenceSource(teacher, review),
      postmortemVersion: POSTMORTEM_REVIEW_VERSION,
      postmortemCause: review.cause,
      postmortemMacroStepIndex: index,
      behaviorActionKey: actionKey(candidate.selectedAction),
      recommendedActionKey: step.legalActionKeys?.[step.selectedIndex]
        || step.selectedActionKey
        || null,
      informationSetHash: step.informationSetHash || parent.informationSetHash || null,
      imitation: true,
      source: "postmortem-local-regret-macro"
    }))
    : [];
  return [correction, ...macroSteps];
}

function postmortemEvidenceSource(teacher, review) {
  if (teacher?.verification?.proofKind === "immediate-terminal-win") {
    return "engine-proof";
  }
  if (["confirmed-terminal-rollout-dominance",
    "terminal-postmortem-dominance"].includes(teacher?.verification?.proofKind)
    || (Number(teacher?.confirmation?.terminalPairedEvidence?.samples) >= 16
      && Number(teacher?.confirmation?.terminalPairedEvidence?.lowerBound) > 0
      && review?.determinizationAudit?.complete === true)) {
    return "terminal-confirmed";
  }
  const evaluator = teacher?.policyComparison?.evaluatorComparison
    || review?.evaluatorComparison;
  if (evaluator?.available === true
    && evaluator?.independent === true
    && evaluator?.conflict !== true
    && evaluator?.agreesOnDirection === true) {
    return "certified-evaluator";
  }
  return "other-verified";
}

function postmortemCandidateReasons(game, actorId, decision, context) {
  const reasons = [];
  const teacher = context.teacher;
  const critical = context.criticalDecision;
  const uncertainty = clamp01(context.uncertainty);
  const selected = decision.action;
  const actor = game.players.find((player) => player.id === actorId);
  const opponent = game.players.find((player) => player.id !== actorId);
  const victoryScore = Math.max(1, Number(game.victoryScore) || 8);
  const regret = Math.max(0, Number(teacher?.policyComparison?.regret) || 0);
  if (regret >= 0.03) reasons.push("teacher-regret");
  if (teacher?.verification?.status === "provisional" && teacherKeyDiffers(teacher, selected)) {
    reasons.push("provisional-teacher-disagreement");
  }
  if (critical?.urgent) reasons.push("urgent-decision");
  for (const type of critical?.types || []) reasons.push(type);
  if (uncertainty >= 0.6) reasons.push("policy-uncertainty");
  if (Math.max(Number(actor?.score) || 0, Number(opponent?.score) || 0) >= victoryScore - 2) {
    reasons.push("near-victory");
  }
  if (["endTurn", "passShowdown"].includes(selected?.kind) && decision.legalCount > 1) reasons.push("stop-with-alternatives");
  if (context.compactAudit === true) reasons.push("periodic-audit");
  const unique = [...new Set(reasons)];
  // Entropy alone is not a decisive mistake and would make almost every early
  // game action retain a full engine snapshot. It only breaks ties among an
  // independently material candidate.
  return unique.some((reason) => reason !== "policy-uncertainty") ? unique : [];
}

function postmortemCandidatePriority(reasons, context) {
  const regret = Math.max(0, Number(context.teacher?.policyComparison?.regret) || 0);
  return regret * 30
    + (context.criticalDecision?.urgent ? 6 : 0)
    + (context.criticalDecision?.types?.length || 0) * 1.5
    + clamp01(context.uncertainty) * 2
    + reasons.reduce((sum, reason) => sum + turningPointPriority(reason), 0);
}

function classifyPostmortemCause(candidate, teacher) {
  const selectedKind = candidate?.selectedAction?.kind;
  const recommendedKinds = new Set((teacher?.correctionAlternativeKeys || [])
    .map((key) => candidate.legalActions.find((action) => actionKey(action) === key)?.kind)
    .filter(Boolean));
  if (["immediate-terminal-win", "confirmed-terminal-rollout-dominance"]
    .includes(teacher?.verification?.proofKind)) {
    return "verified-higher-value-winning-line";
  }
  if (["endTurn", "passShowdown"].includes(selectedKind)
    && [...recommendedKinds].some((kind) => !["endTurn", "passShowdown"].includes(kind))) {
    return "missed-action-before-stop";
  }
  if (selectedKind === "moveUnit" && recommendedKinds.has("moveUnits")) return "fragmented-attack";
  if (["moveUnit", "moveUnits"].includes(selectedKind)
    && [...recommendedKinds].some((kind) => ["endTurn", "passShowdown"].includes(kind))) {
    return "premature-attack";
  }
  if (["beginPlayCard", "beginPlayChampion", "activateCard"].includes(selectedKind)
    && [...recommendedKinds].some((kind) => ["endTurn", "passShowdown"].includes(kind))) {
    return "resource-overcommitment";
  }
  if (selectedKind === "submitMulligan") return "mulligan-regret";
  if (candidate?.reasons?.includes("card-versus-resource-reserve")) return "resource-timing";
  return "decision-regret";
}

function postmortemTargetDistribution(teacher, legalActions) {
  const correctionKeys = new Set(teacher?.correctionAlternativeKeys || []);
  const alternatives = (teacher?.alternatives || []).filter((alternative) =>
    correctionKeys.has(actionKey(alternative.action)));
  if (!alternatives.length) return oneHot(legalActions.length, teacher?.selectedIndex || 0);
  const maximum = Math.max(...alternatives.map((alternative) => Number(alternative.decisionScore) || 0));
  const weighted = alternatives.map((alternative) => ({
    key: actionKey(alternative.action),
    weight: Math.exp(((Number(alternative.decisionScore) || 0) - maximum) / 0.08)
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const byKey = new Map(weighted.map((item) => [item.key, item.weight / total]));
  return legalActions.map((action) => byKey.get(actionKey(action)) || 0);
}

function postmortemValueSupervision(teacher, legalActions, confidence) {
  const targets = new Array(legalActions.length).fill(0);
  const weights = new Array(legalActions.length).fill(0);
  const alternatives = new Map((teacher?.alternatives || []).map((alternative) => [
    actionKey(alternative.action), alternative
  ]));
  for (let index = 0; index < legalActions.length; index += 1) {
    const alternative = alternatives.get(actionKey(legalActions[index]));
    if (!Number.isFinite(Number(alternative?.expectedWinRate))) continue;
    const interval = alternative.confidenceInterval || [0, 1];
    const precision = Math.max(0.1, 1 - Math.max(0, Number(interval[1]) - Number(interval[0])));
    targets[index] = clamp(Number(alternative.expectedWinRate) * 2 - 1, -1, 1);
    weights[index] = clamp01(confidence * precision);
  }
  return { targets, weights };
}

function summarizePostmortemReviews(reviews, candidatesByPlayer) {
  const verified = reviews.filter((review) => review.verifiedLocalRegret || review.avoidableLoss);
  const causes = {};
  for (const review of verified) causes[review.cause] = (causes[review.cause] || 0) + 1;
  return {
    version: POSTMORTEM_REVIEW_VERSION,
    capturedCandidates: [...candidatesByPlayer.values()].reduce((sum, candidates) => sum + candidates.length, 0),
    reviewed: reviews.length,
    winnerAudits: reviews.filter((review) => review.outcomeRole === "winner").length,
    loserAudits: reviews.filter((review) => review.outcomeRole === "loser").length,
    verifiedCorrections: verified.length,
    unproven: reviews.length - verified.length,
    averageRegret: reviews.length
      ? reviews.reduce((sum, review) => sum + (Number(review.expectedWinRateDelta) || 0), 0) / reviews.length
      : 0,
    causes,
    reviews
  };
}

function publicMaterialProfile(game, actorId) {
  const player = game?.players?.find((item) => item.id === actorId);
  const units = [
    ...(player?.base || []),
    ...(game?.battlefields || []).flatMap((field) =>
      (field.units || []).filter((unit) => (unit.controllerId || unit.ownerId) === actorId))
  ];
  return {
    controlledBattlefields: (game?.battlefields || []).filter((field) =>
      (field.controlledBy || field.controllerId) === actorId).length,
    unitCount: units.length,
    unitMight: units.reduce((sum, unit) =>
      sum + Math.max(0, (Number(unit.might) || 0) + (Number(unit.mightModifier) || 0)
        + (Number(unit.buffs) || 0) - (Number(unit.damage) || 0)), 0)
  };
}

function publicPostmortemBoard(game, actorId) {
  if (!game) return null;
  return {
    phase: game.phase || null,
    turn: game.turn || null,
    turnSequence: Number(game.turnSequence) || 0,
    players: game.players.map((player) => ({
      id: player.id,
      viewer: player.id === actorId,
      score: Number(player.score) || 0,
      handSize: player.hand?.length || 0,
      mainDeckSize: player.mainDeck?.length || 0,
      baseUnits: player.base?.length || 0,
      readyRunes: (player.runes || []).filter((rune) => !rune.exhausted).length,
      totalRunes: player.runes?.length || 0
    })),
    battlefields: (game.battlefields || []).map((field) => ({
      id: field.id,
      controllerId: field.controllerId || null,
      units: (field.units || []).map((unit) => ({
        instanceId: unit.instanceId,
        controllerId: unit.controllerId || unit.ownerId,
        exhausted: Boolean(unit.exhausted),
        damage: Number(unit.damage) || 0
      }))
    })),
    pendingChoice: game.pendingChoice ? { playerId: game.pendingChoice.playerId, kind: game.pendingChoice.kind || null } : null,
    pendingPayment: game.pendingPayment ? { playerId: game.pendingPayment.playerId } : null,
    chainOpen: Boolean(game.actionChain)
  };
}

function turningPointPriority(reason) {
  return {
    "teacher-critical": 8,
    "teacher-urgent": 7,
    "lead-flip": 6,
    "teacher-regret": 5,
    "near-victory": 4,
    "profitable-action-before-stop": 4,
    "movement-group-comparison": 3,
    "card-versus-resource-reserve": 3,
    "lead-breakaway": 2,
    "score-lead-drop": 5,
    "control-loss": 5,
    "irreversible-unit-loss": 5,
    "periodic-audit": 0.25,
    "policy-uncertainty": 1
  }[reason] || 0;
}

function teacherKeyDiffers(teacher, selected) {
  return teacher?.action && actionKey(teacher.action) !== actionKey(selected);
}

function cloneInitialMemories(memories) {
  return Object.fromEntries(Object.entries(memories || {}).map(([playerId, memory]) => [
    playerId,
    memory ? new Float32Array(memory) : new Float32Array(NEURAL_HIDDEN_SIZE)
  ]));
}

function postmortemSeed(game, actorId, actionCount) {
  let hash = (Number(game?.deterministicRandomState) || 0x9e3779b9) ^ (actionCount * 0x85ebca6b);
  for (const character of String(actorId || "")) hash = Math.imul(hash ^ character.charCodeAt(0), 0xc2b2ae35);
  return hash >>> 0;
}

function seededPostmortemRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function oneHot(length, selectedIndex) {
  return Array.from({ length: Math.max(1, Number(length) || 1) }, (_, index) =>
    index === Math.max(0, Number(selectedIndex) || 0) ? 1 : 0);
}

function clamp01(value) {
  return clamp(Number(value) || 0, 0, 1);
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, Number(value) || 0));
}
