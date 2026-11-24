import { actionKey, isStrategicAction } from "../actions.mjs";
import {
  movementProfile,
  tacticalActionProfile,
  temporaryChoicePurposeProfile,
  temporaryCommitmentProfile
} from "../action-tactics.mjs";
import { DEFAULT_AI_MODEL, scoreActions } from "../policy.mjs";
import {
  buildTeacherMacroDemonstration,
  hydrateActionAuditRolloutResults,
  independentSimulationSeeds,
  mergeActionAuditRolloutResults,
  pairedEvaluatorLeafStateEvidence,
  pairedIndependentTerminalActionAudit,
  pairedRolloutDifference,
  pairedTerminalLeafValueEvidence,
  pairedTerminalRolloutDifference,
  proveImmediateActionOutcome,
  rolloutAlternatives,
  serializeActionAuditRolloutResults
} from "../rollout.mjs";
import { opponentResponseProfile } from "../resource-strategy.mjs";
import { TEACHER_LABEL_VERSION } from "./teacher-contract.mjs";
import { validPublicStructuredEvidenceSnapshot } from "./structured-evidence.mjs";
import {
  ACTION_EVIDENCE_GRADES,
  applyHolmSimultaneousBounds,
  actionEvidenceProtocolCoversPhase,
  classifyPrecommittedActionEvidence,
  validActionEvidenceProtocolManifest,
  validActionEvidenceSeedCommitment
} from "./evidence-protocol.mjs";
import { evaluatorAuditPhaseBand } from "./audit-strata.mjs";

export { TEACHER_LABEL_VERSION } from "./teacher-contract.mjs";

export function simulationTeacherDecision(game, actorId, legalActions, options = {}) {
  if (!actorId || legalActions.length < 2) return null;
  if (["first-player", "champion-select", "battlefield-select"].includes(game.phase)) return null;
  const strategic = legalActions.filter(isStrategicAction);
  if (strategic.length < 2) return null;
  const model = options.model || DEFAULT_AI_MODEL;
  const policyProbabilityByKey = Array.isArray(options.policyProbabilities)
    ? new Map(legalActions.map((action, index) => [actionKey(action), options.policyProbabilities[index] || 0]))
    : null;
  const ranked = policyProbabilityByKey
    ? strategic.map((action) => ({ action, score: policyProbabilityByKey.get(actionKey(action)) || 0 }))
      .sort((left, right) => right.score - left.score || actionKey(left.action).localeCompare(actionKey(right.action)))
    : scoreActions(game, actorId, strategic, model);
  const profile = teacherPlanningProfile(game, actorId, { ...options, model });
  const mulliganMode = game.phase === "mulligan";
  const candidateMap = mulliganMode || game.pendingChoice || strategic.length <= profile.maxCandidates
    ? new Map(strategic.map((action) => [actionKey(action), action]))
    : diverseTeacherCandidates(game, actorId, ranked, strategic,
      [options.requiredAction, ...(options.requiredActions || [])], profile.maxCandidates);
  const candidates = [...candidateMap.values()];
  if (candidates.length < 2) return null;
  const screenSimulations = mulliganMode
    ? Math.max(4, Math.min(8, profile.simulations))
    : Math.max(2, Math.min(4,
      Number(options.screenSimulations ?? options.simulations) || 4));
  const confirmationMinimumSimulations = Math.max(8, Math.min(32,
    Number(options.confirmationMinimumSimulations) || 8));
  const confirmationSimulations = Math.max(
    confirmationMinimumSimulations,
    Math.min(32, Number(
      options.confirmationSimulations
        ?? options.minimumVerificationSimulations
    ) || 16)
  );
  const confirmationMaxSimulations = Math.max(
    confirmationSimulations,
    Math.min(32, Number(options.confirmationMaxSimulations) || 32)
  );
  const search = {
    // The broad screen only selects a shortlist. No sample from this bank may
    // certify a policy correction.
    simulations: screenSimulations,
    depth: mulliganMode ? Math.max(10, profile.depth) : profile.depth,
    minimumTurnTransitions: mulliganMode ? 2 : profile.minimumTurnTransitions
  };
  const searchStages = [];
  const runSearch = (
    stageCandidates,
    stageSearch,
    stage,
    priorResults = null,
    randomOverride = options.random
  ) => {
    const productionLeafAuditEnabled =
      options.captureProductionLeafAudit === true
        && (stage.startsWith("independent-leaf-value-audit-")
          || stage.startsWith("independent-terminal-action-audit-"));
    const priorByKey = new Map((priorResults || []).map((result) => [
      actionKey(result.action),
      result.attemptedSimulations ?? result.simulations ?? 0
    ]));
    const stageResults = rolloutAlternatives(game, actorId, stageCandidates, model, {
      ...stageSearch,
      priorResults,
      neuralModel: options.neuralModel,
      neuralModels: options.neuralModels,
      evaluatorModels: options.evaluatorModels,
      evaluatorModelsCertified: options.evaluatorModelsCertified === true,
      engineFingerprint: options.engineFingerprint,
      informationSetHash: options.informationSetHash || null,
      initialMemories: options.initialMemories,
      neuralBelief: options.neuralBelief,
      captureProductionLeafAudit: productionLeafAuditEnabled,
      productionLeafAuditMaximumSteps:
        productionLeafAuditEnabled
          ? Math.max(
            1,
            Math.min(
              1200,
              Number(options.actionAuditMaximumSteps) || 1200
            )
          )
          : undefined,
      random: randomOverride
    }).sort(compareTeacherAlternatives);
    searchStages.push({
      stage,
      candidates: stageCandidates.length,
      simulations: stageSearch.simulations,
      additionalSimulations: stageResults.reduce((sum, result) =>
        sum + Math.max(0, Number(result.attemptedSimulations ?? result.simulations)
          - (priorByKey.get(actionKey(result.action)) || 0)), 0),
      depth: stageSearch.depth,
      productionLeafAuditEnabled,
      sampleBankFingerprints: [...new Set(stageResults
        .map((result) => result.simulationSeedFingerprint)
        .filter(Boolean))]
    });
    return stageResults;
  };
  const results = runSearch(candidates, search, "screen");
  const occupiedAuditSeeds = new Set(results.flatMap((result) =>
    Array.from(result.simulationSeeds || [], (seed) => Number(seed) >>> 0)));
  const best = results[0];
  const second = results[1];
  const hold = results.find((item) => ["endTurn", "passShowdown", "declineEffectChoice"].includes(item.action?.kind)) || null;
  const selectedPolicyAlternative = options.requiredAction
    ? results.find((item) => actionKey(item.action) === actionKey(options.requiredAction)) || null
    : null;
  const bestOtherThanSelected = selectedPolicyAlternative
    ? results.find((item) => actionKey(item.action) !== actionKey(selectedPolicyAlternative.action)) || null
    : null;
  const selectedIndex = legalActions.findIndex((action) => actionKey(action) === actionKey(best?.action));
  if (!best || selectedIndex < 0) return null;
  const screenPairedEvidence = pairedRolloutDifference(best, second);
  const screenSelectedEvidence = selectedPolicyAlternative && selectedPolicyAlternative !== best
    ? pairedRolloutDifference(best, selectedPolicyAlternative)
    : null;
  const proposalPriority = teacherProposalPriority(
    legalActions,
    options.proposalValues,
    best?.action,
    selectedPolicyAlternative?.action
  );
  const shouldConfirm = selectedPolicyAlternative
    && actionKey(selectedPolicyAlternative.action) !== actionKey(best.action)
    && best.rolloutEvidenceEligible !== false
    && selectedPolicyAlternative.rolloutEvidenceEligible !== false
    && Number(screenSelectedEvidence?.mean) > 0
    && (Number(screenSelectedEvidence?.lowerBound) > 0
      || Number(best.decisionScore) - Number(selectedPolicyAlternative.decisionScore) >= 0.04
      || proposalPriority >= 0.05);
  let confirmation = null;
  if (shouldConfirm) {
    const screeningSeeds = [...new Set(results.flatMap((result) =>
      Array.from(result.simulationSeeds || [], (seed) => Number(seed) >>> 0)))];
    let confirmationResults = null;
    let confirmationSeedsUsed = [];
    for (const targetSimulations of [...new Set([
      confirmationMinimumSimulations,
      confirmationSimulations
    ])].sort((left, right) => left - right)) {
      confirmationResults = runSearch(
        [best.action, selectedPolicyAlternative.action],
        {
          ...search,
          simulations: targetSimulations,
          excludedSimulationSeeds: [...screeningSeeds, ...confirmationSeedsUsed]
        },
        `independent-confirmation-${targetSimulations}`,
        confirmationResults
      );
      confirmationSeedsUsed = [...new Set(confirmationResults.flatMap((result) =>
        Array.from(result.simulationSeeds || [], (seed) => Number(seed) >>> 0)))];
      for (const seed of confirmationSeedsUsed) occupiedAuditSeeds.add(seed);
    }
    let evidence = confirmationEvidence(
      confirmationResults,
      best.action,
      selectedPolicyAlternative.action
    );
    const importantState = profile.decisionLeverage >= 0.55
      || proposalPriority >= 0.05
      || Number(screenSelectedEvidence?.mean) >= 0.1;
    if (confirmationMaxSimulations > confirmationSimulations
      && importantState
      && evidence
      && evidence.pairedEvidence.lowerBound <= 0
      && evidence.pairedEvidence.upperBound >= 0) {
      confirmationResults = runSearch(
        [best.action, selectedPolicyAlternative.action],
        {
          ...search,
          simulations: confirmationMaxSimulations,
          excludedSimulationSeeds: [...screeningSeeds, ...confirmationSeedsUsed]
        },
        `independent-confirmation-${confirmationMaxSimulations}`,
        confirmationResults
      );
      confirmationSeedsUsed = [...new Set(confirmationResults.flatMap(
        (result) => Array.from(
          result.simulationSeeds || [],
          (seed) => Number(seed) >>> 0
        )
      ))];
      for (const seed of confirmationSeedsUsed) occupiedAuditSeeds.add(seed);
      evidence = confirmationEvidence(
        confirmationResults,
        best.action,
        selectedPolicyAlternative.action
      );
    }
    if (evidence) {
      const confirmationSeeds = [...new Set([
        ...Array.from(evidence.best.simulationSeeds || [], (seed) => Number(seed) >>> 0),
        ...Array.from(evidence.selected.simulationSeeds || [], (seed) => Number(seed) >>> 0)
      ])];
      const independent = disjointSeedBanks(screeningSeeds, confirmationSeeds);
      confirmation = {
        independent,
        simulations: Math.max(
          Number(evidence.best.attemptedSimulations) || 0,
          Number(evidence.selected.attemptedSimulations) || 0
        ),
        best: evidence.best,
        selected: evidence.selected,
        pairedEvidence: evidence.pairedEvidence,
        terminalPairedEvidence: evidence.terminalPairedEvidence,
        leafValuePairs: pairedTerminalLeafValueEvidence(
          evidence.best,
          evidence.selected
        ),
        determinizationAudit: confirmationDeterminizationAudit(
          evidence.best,
          evidence.selected
        ),
        proposalPriority,
        seedBanks: {
          screening: [...new Set(results
            .map((result) => result.simulationSeedFingerprint)
            .filter(Boolean))],
          confirmation: [...new Set(confirmationResults
            .map((result) => result.simulationSeedFingerprint)
            .filter(Boolean))],
          disjoint: independent
        }
      };
      if (!independent) confirmation = null;
    }
  }
  const actionAuditKey = selectedPolicyAlternative
    && actionKey(selectedPolicyAlternative.action) !== actionKey(best.action)
    ? independentActionAuditKey(
      options.informationSetHash,
      best.action,
      selectedPolicyAlternative.action
    )
    : null;
  const actionAuditExistingKeys = new Set(options.actionAuditExistingKeys || []);
  const actionAuditGateBest = confirmation?.best || best;
  const actionAuditGateSelected =
    confirmation?.selected || selectedPolicyAlternative;
  const actionAuditPairedEvidence =
    confirmation?.pairedEvidence || screenSelectedEvidence;
  const actionAuditDeterminization = confirmation?.determinizationAudit
    || confirmationDeterminizationAudit(
      actionAuditGateBest,
      actionAuditGateSelected
    );
  const actionAuditGateReasons = independentActionAuditGateReasons({
    captureEnabled: options.captureIndependentActionAudit === true,
    budgetEnabled: options.actionAuditEnabled === true,
    actionAuditKey,
    duplicate: actionAuditExistingKeys.has(actionAuditKey),
    selected: actionAuditGateSelected,
    confirmationRequired:
      options.deferIndependentActionAudit === true,
    confirmationAvailable: Boolean(confirmation),
    determinizationAudit: actionAuditDeterminization,
    recommendedValidRate: actionAuditGateBest?.validRate,
    selectedValidRate: actionAuditGateSelected?.validRate,
    lowerBound: actionAuditPairedEvidence?.lowerBound,
    requirePositiveLowerBound:
      options.deferIndependentActionAudit !== true
  });
  const actionAuditGatePassed = actionAuditGateReasons.length === 0;
  const evidenceProtocolManifest =
    validActionEvidenceProtocolManifest(options.evidenceProtocolManifest)
      && actionEvidenceProtocolCoversPhase(
        options.evidenceProtocolManifest,
        evaluatorAuditPhaseBand(game)
      )
      ? options.evidenceProtocolManifest
      : null;
  const deferredActionAuditCandidate =
    actionAuditGatePassed && options.deferIndependentActionAudit === true
      ? {
        version: 1,
        contract: "independent-terminal-action-audit-candidate-v1",
        auditKey: actionAuditKey,
        informationSetHash: options.informationSetHash || null,
        recommendedAction: structuredClone(best.action),
        selectedAction: structuredClone(selectedPolicyAlternative.action),
        recommendedIndex: legalActions.findIndex(
          (action) => actionKey(action) === actionKey(best.action)
        ),
        selectedIndex: legalActions.findIndex(
          (action) =>
            actionKey(action) === actionKey(selectedPolicyAlternative.action)
        ),
        occupiedAuditSeeds: [...occupiedAuditSeeds],
        screeningSeeds: actionAuditSeeds(results),
        confirmationSeeds: confirmation
          ? actionAuditSeeds([confirmation.best, confirmation.selected])
          : [],
        priority: {
          confirmationLowerBound:
            Number(actionAuditPairedEvidence?.lowerBound) || 0,
          confirmationMean:
            Number(actionAuditPairedEvidence?.mean) || 0,
          policyRankingDifference: proposalPriority,
          decisionScoreDifference: Math.max(
            0,
            Number(actionAuditGateBest?.decisionScore)
              - Number(actionAuditGateSelected?.decisionScore)
          ),
          decisionLeverage: Number(profile.decisionLeverage) || 0
        },
        search: {
          depth: search.depth,
          minimumTurnTransitions: search.minimumTurnTransitions
        },
        evidenceProtocolManifest: evidenceProtocolManifest
          ? structuredClone(evidenceProtocolManifest)
          : null,
        samplingFrame: structuredClone(
          options.evidenceSamplingFrame || null
        )
      }
      : null;
  let independentActionRankingAudit = null;
  let actionAuditAttempted = false;
  let independentActionRankingAuditDiagnostic = actionAuditKey
    && options.captureIndependentActionAudit === true
    ? {
      version: 2,
      contract: "independent-terminal-action-audit-diagnostic-v2",
      auditKey: actionAuditKey,
      status: deferredActionAuditCandidate
        ? "candidate-eligible"
        : actionAuditGatePassed
          ? "eligible"
          : "gate-failed",
      gateReasons: actionAuditGateReasons,
      preselection: null,
      selection: null,
      final: null
    }
    : null;
  if (actionAuditGatePassed && options.deferIndependentActionAudit !== true) {
    actionAuditAttempted = true;
    const occupiedBeforeSelection = [...occupiedAuditSeeds];
    const preselectionResults = runSearch(
      [best.action, selectedPolicyAlternative.action],
      {
        ...search,
        // The first 16 seeds are a fixed futility-only prefix of the 32-seed
        // selection bank. It can reject a clearly reversed candidate, but it
        // can never issue a reference or weaken the fixed 32/64 contract.
        simulations: 16,
        excludedSimulationSeeds: [...occupiedAuditSeeds]
      },
      "independent-terminal-action-audit-preselection",
      null,
      deterministicActionAuditRandom(
        game,
        actorId,
        [best.action, selectedPolicyAlternative.action],
        options.informationSetHash,
        "selection"
      )
    );
    const preselectionEvidence = actionAuditEvidence(
      preselectionResults,
      best.action,
      selectedPolicyAlternative.action
    );
    const preselectionSeeds = actionAuditSeeds(preselectionResults);
    const preselectionSeedBanksDisjoint = disjointSeedBanks(
      occupiedBeforeSelection,
      preselectionSeeds
    );
    const preselectionFutilityReasons =
      independentActionAuditPreselectionFutilityReasons(
        preselectionEvidence,
        { seedBanksDisjoint: preselectionSeedBanksDisjoint }
      );
    independentActionRankingAuditDiagnostic.preselection =
      compactIndependentActionAuditStageDiagnostic(
        preselectionEvidence,
        preselectionSeeds,
        preselectionFutilityReasons
      );
    if (preselectionFutilityReasons.length === 0) {
    const selectionResults = runSearch(
      [best.action, selectedPolicyAlternative.action],
      {
        ...search,
        // This is a precommitted bank. Results never cause additional seeds to
        // be appended to this stage.
        simulations: 32,
        excludedSimulationSeeds: [
          ...occupiedAuditSeeds,
          ...preselectionSeeds
        ]
      },
      "independent-terminal-action-audit-selection",
      preselectionResults,
      deterministicActionAuditRandom(
        game,
        actorId,
        [best.action, selectedPolicyAlternative.action],
        options.informationSetHash,
        "selection"
      )
    );
    const selectionEvidence = actionAuditEvidence(
      selectionResults,
      best.action,
      selectedPolicyAlternative.action
    );
    const selectionSeeds = actionAuditSeeds(selectionResults);
    const selectionSeedBanksDisjoint = disjointSeedBanks(
      occupiedBeforeSelection,
      selectionSeeds
    );
    for (const auditSeed of selectionSeeds) occupiedAuditSeeds.add(auditSeed);
    const selectionFailureReasons = independentActionAuditStageFailureReasons(
      selectionEvidence,
      {
        attemptedPairs: 32,
        minimumTerminalPairs: 16,
        seedBanksDisjoint: selectionSeedBanksDisjoint
      }
    );
    independentActionRankingAuditDiagnostic.selection =
      compactIndependentActionAuditStageDiagnostic(
        selectionEvidence,
        selectionSeeds,
        selectionFailureReasons
      );
    if (selectionFailureReasons.length === 0) {
      const occupiedBeforeFinal = [...occupiedAuditSeeds];
      const finalResults = runSearch(
        [best.action, selectedPolicyAlternative.action],
        {
          ...search,
          // This second bank is also fixed before observing any result.
          simulations: 64,
          excludedSimulationSeeds: [...occupiedAuditSeeds]
        },
        "independent-terminal-action-audit-final",
        null,
        deterministicActionAuditRandom(
          game,
          actorId,
          [best.action, selectedPolicyAlternative.action],
          options.informationSetHash,
          "final"
        )
      );
      const finalEvidence = actionAuditEvidence(
        finalResults,
        best.action,
        selectedPolicyAlternative.action
      );
      const finalSeeds = actionAuditSeeds(finalResults);
      const seedBanksDisjoint = disjointSeedBanks(
        occupiedBeforeFinal,
        finalSeeds
      );
      const finalFailureReasons = independentActionAuditStageFailureReasons(
        finalEvidence,
        {
          attemptedPairs: 64,
          minimumTerminalPairs: 32,
          seedBanksDisjoint
        }
      );
      independentActionRankingAuditDiagnostic.final =
        compactIndependentActionAuditStageDiagnostic(
          finalEvidence,
          finalSeeds,
          finalFailureReasons
        );
      if (finalFailureReasons.length === 0) {
        const evaluatorStatePairs = pairedEvaluatorLeafStateEvidence(
          finalEvidence.recommended,
          finalEvidence.selected,
          { maximumPairs: 64 }
        );
        const evaluatorTarget = evaluatorStatePairAuditSummary(
          evaluatorStatePairs
        );
        independentActionRankingAudit = {
          version: 3,
          contract: "independent-terminal-action-audit-v3",
          source: "independent-terminal-action-audit",
          policyCorrectionIndependent: true,
          auditKey: actionAuditKey,
          informationSetHash: options.informationSetHash || null,
          recommendedActionKey: actionKey(best.action),
          selectedActionKey: actionKey(selectedPolicyAlternative.action),
          selection: {
            attemptedPairs:
              selectionEvidence.terminalEvidence.attemptedPairs,
            samples: selectionEvidence.terminalEvidence.samples,
            terminalPairs: selectionEvidence.terminalEvidence.terminalPairs,
            mean: selectionEvidence.terminalEvidence.mean,
            lowerBound: selectionEvidence.terminalEvidence.lowerBound,
            upperBound: selectionEvidence.terminalEvidence.upperBound,
            terminalOutcomePairs:
              selectionEvidence.terminalEvidence.outcomePairs.map(
                terminalActionOutcomePair
              ),
            rates: selectionEvidence.terminalEvidence.rates
          },
          final: {
            attemptedPairs: finalEvidence.terminalEvidence.attemptedPairs,
            terminalPairs: finalEvidence.terminalEvidence.terminalPairs,
            samples: finalEvidence.terminalEvidence.samples,
            mean: finalEvidence.terminalEvidence.mean,
            lowerBound: finalEvidence.terminalEvidence.lowerBound,
            upperBound: finalEvidence.terminalEvidence.upperBound,
            positiveRate: finalEvidence.terminalEvidence.positiveRate,
            terminalOutcomePairs:
              finalEvidence.terminalEvidence.outcomePairs.map(
                terminalActionOutcomePair
              ),
            rates: finalEvidence.terminalEvidence.rates
          },
          evaluatorStatePairs,
          evaluatorTarget,
          determinizationAudit: finalEvidence.determinizationAudit,
          seedBanks: {
            screening: actionAuditSeeds(results),
            confirmation: confirmation
              ? actionAuditSeeds([
                confirmation.best,
                confirmation.selected
              ])
              : [],
            selection: selectionSeeds,
            final: finalSeeds,
            disjoint: seedBanksDisjoint
              && disjointSeedBanks(selectionSeeds, finalSeeds)
          },
          usedForTeacherDecision: false,
          usedForPolicyTraining: false,
          usedForActionValueTraining: false,
          usedForProposalValueTraining: false,
          usedForEpochSelection: false
        };
        independentActionRankingAuditDiagnostic.status =
          evaluatorTarget.direction === "tie"
            ? "evaluator-target-ineligible"
            : "reference-issued";
        independentActionRankingAuditDiagnostic.evaluatorStatePairs =
          evaluatorStatePairs.length;
        independentActionRankingAuditDiagnostic.evaluatorTarget =
          evaluatorTarget;
        if (evaluatorTarget.direction === "tie") {
          independentActionRankingAudit = null;
        }
      } else {
        independentActionRankingAuditDiagnostic.status = "final-failed";
      }
    } else {
      independentActionRankingAuditDiagnostic.status = "selection-failed";
    }
    } else {
      independentActionRankingAuditDiagnostic.status = "preselection-futile";
    }
  }
  const leafAuditAlternative = selectedPolicyAlternative
    && actionKey(selectedPolicyAlternative.action) !== actionKey(best.action)
    ? selectedPolicyAlternative
    : second;
  let independentLeafValuePairs = [];
  let independentLeafActionEffectComparison = null;
  let independentLeafAuditAttempted = false;
  const independentLeafPairLimit = Number.isFinite(
    Number(options.independentLeafPairLimit)
  )
    ? Math.max(0, Math.min(2, Math.floor(
      Number(options.independentLeafPairLimit)
    )))
    : 2;
  const finalLeafAuditSimulations = Math.max(0, Math.min(1024,
    Math.floor(Number(options.leafAuditSimulations ?? 128))));
  const deferredLeafAuditCandidate = options.detachedIndependentLeafAudit === true
    && finalLeafAuditSimulations > 0 && independentLeafPairLimit > 0
    && options.captureProductionLeafAudit === true
    && options.captureIndependentLeafAudit !== false && leafAuditAlternative
    && actionKey(leafAuditAlternative.action) !== actionKey(best.action)
    ? {
      version: 1, contract: "detached-leaf-audit-candidate-v1",
      auditKey: independentActionAuditKey(options.informationSetHash,
        best.action, leafAuditAlternative.action),
      informationSetHash: options.informationSetHash,
      recommendedAction: structuredClone(best.action),
      selectedAction: structuredClone(leafAuditAlternative.action),
      occupiedAuditSeeds: [...occupiedAuditSeeds],
      search: { depth: search.depth, minimumTurnTransitions: search.minimumTurnTransitions },
      samplingFrame: structuredClone(options.evidenceSamplingFrame || null),
      maximumSimulations: finalLeafAuditSimulations,
      priority: { decisionLeverage: Number(profile.decisionLeverage) || 0,
        uncertainty: Number(options.uncertainty) || 0 }
    } : null;
  if (deferredLeafAuditCandidate) independentLeafAuditAttempted = true;
  if (finalLeafAuditSimulations > 0 && independentLeafPairLimit > 0
    && options.captureProductionLeafAudit === true
    && options.captureIndependentLeafAudit !== false
    && leafAuditAlternative
    && actionKey(leafAuditAlternative.action) !== actionKey(best.action)
    && !deferredLeafAuditCandidate) {
    independentLeafAuditAttempted = true;
    const decisiveEffectThreshold = Math.max(
      0,
      Number(evidenceProtocolManifest?.statistics?.minimumTrainingEffect)
        || 0.01
    );
    const nearEquivalentMargin = Math.max(
      0,
      Number(evidenceProtocolManifest?.statistics?.nearEquivalentMargin)
        || 0.01
    );
    const minimumNearEquivalentSamples = Math.max(
      32,
      Number(evidenceProtocolManifest?.statistics
        ?.minimumNearEquivalentSamples) || 32
    );
    const finalConfidence = 0.99;
    let first = null;
    let secondLeaf = null;
    let pairedAudit = null;
    let evaluatorStatePairs = [];
    // Candidate selection has already happened in the teacher screen. There
    // is no multi-candidate leaf pool here, so an extra pilot would only add
    // cost. Evidence comes from one fixed, precommitted final bank.
    const finalLeafAuditResults = runSearch(
        [best.action, leafAuditAlternative.action],
        {
          ...search,
          simulations: finalLeafAuditSimulations,
          excludedSimulationSeeds: [...occupiedAuditSeeds]
        },
        "independent-leaf-value-audit-final",
        null,
        deterministicLeafAuditRandom(game, actorId, [
          best.action,
          leafAuditAlternative.action
        ], `${options.informationSetHash}:leaf-final:${finalLeafAuditSimulations}`)
    );
    const byKey = new Map(finalLeafAuditResults.map((result) => [
      actionKey(result.action),
      result
    ]));
    first = byKey.get(actionKey(best.action));
    secondLeaf = byKey.get(actionKey(leafAuditAlternative.action));
    pairedAudit = pairedIndependentTerminalActionAudit(first, secondLeaf, {
      confidence: finalConfidence
    });
    evaluatorStatePairs = pairedEvaluatorLeafStateEvidence(
      first,
      secondLeaf,
      { maximumPairs: finalLeafAuditSimulations }
    );
    if (evaluatorStatePairs.length > 0 && pairedAudit.samples > 0) {
      independentLeafActionEffectComparison = {
        version: 1,
        contract: "paired-action-effect-leaf-audit-v1",
        recommendedActionKey: actionKey(best.action),
        comparedActionKey: actionKey(leafAuditAlternative.action),
        decisiveEffectThreshold,
        nearEquivalentMargin,
        minimumNearEquivalentSamples,
        provenance: {
          version: 1,
          informationSetHash: options.informationSetHash || null,
          engineFingerprint: options.engineFingerprint || null,
          independentSeedContract: true,
          determinizationRequired: true,
          sequentialAuditContract: {
            version: finalLeafAuditSimulations === 128 ? 3 : 4,
            finalSimulations: finalLeafAuditSimulations,
            completedStage: finalLeafAuditSimulations,
            evidenceSeedUse: "single-fixed-final-bank-v1",
            confidenceSpending: "single-precommitted-final-look-v1",
            perStageConfidence: finalConfidence
          }
        },
        samplingFrame: structuredClone(
          options.evidenceSamplingFrame || null
        ),
        pairedAudit,
        evaluatorStatePairs
      };
    }
    independentLeafValuePairs = [
      ...pairedTerminalLeafValueEvidence(first, secondLeaf, {
        maximumPairs: 2
      }),
      ...pairedTerminalLeafValueEvidence(secondLeaf, first, {
        maximumPairs: 2
      })
    ].slice(0, independentLeafPairLimit);
  }
  const evidenceBest = confirmation?.best || best;
  const evidenceSelected = confirmation?.selected || selectedPolicyAlternative;
  const pairedEvidence = confirmation?.pairedEvidence || screenPairedEvidence;
  // A reused screen may shortlist a correction, but only an independent
  // confirmation is allowed to certify a nonterminal disagreement.
  const selectedPairedEvidence = selectedPolicyAlternative && selectedPolicyAlternative !== best
    ? confirmation?.pairedEvidence || null
    : null;
  const evaluatorComparison = teacherEvaluatorComparison(evidenceBest, evidenceSelected);
  const searchConfidence = teacherDecisionConfidence(results, { pairedEvidence });
  let correctionConfidence = selectedPolicyAlternative && selectedPolicyAlternative !== best
    ? teacherDecisionConfidence([evidenceBest, evidenceSelected], {
      pairedEvidence: selectedPairedEvidence,
      evaluatorComparison
    })
    : searchConfidence;
  const bestImmediateProof = proveImmediateActionOutcome(game, actorId, best.action);
  const selectedImmediateProof = selectedPolicyAlternative
    ? proveImmediateActionOutcome(game, actorId, selectedPolicyAlternative.action)
    : null;
  const immediateDominance = bestImmediateProof.won === true && selectedImmediateProof?.won !== true;
  const confirmedTerminalDominance = !immediateDominance
    && confirmation?.independent === true
    && confirmation?.determinizationAudit?.complete === true
    && Number(confirmation.terminalPairedEvidence?.samples) >= 16
    && Number(confirmation.terminalPairedEvidence?.lowerBound) > 0
    && Number(evidenceBest.validRate) >= 0.75
    && Number(evidenceSelected?.validRate) >= 0.75
    && Number(evidenceBest.terminalRate) >= 0.75
    && Number(evidenceSelected?.terminalRate) >= 0.75;
  const terminalDominance = immediateDominance || confirmedTerminalDominance;
  const terminalProofKind = immediateDominance ? "immediate-terminal-win"
    : confirmedTerminalDominance ? "confirmed-terminal-rollout-dominance" : null;
  const macroDemonstration = evidenceBest.macroContinuation?.verified
    ? buildTeacherMacroDemonstration(game, actorId, best.action, evidenceBest.macroContinuation, model, {
      neuralModel: options.neuralModel,
      initialMemory: options.initialMemories?.[actorId] || null
    })
    : null;
  const preliminaryVerification = teacherActionVerification(game, actorId, evidenceBest, results, {
    pairedEvidence: selectedPolicyAlternative && selectedPolicyAlternative !== best
      ? selectedPairedEvidence
      : pairedEvidence,
    simulations: evidenceBest.simulations,
    mulliganMode,
    selectedAlternative: evidenceSelected,
    evaluatorComparison,
    terminalDominance,
    terminalProofKind,
    immediateProof: bestImmediateProof,
    determinizationAudit: immediateDominance
      ? directEngineDeterminizationAudit()
      : confirmation?.determinizationAudit || null,
    macroDemonstration
  });
  if (immediateDominance) correctionConfidence = 1;
  else if (confirmedTerminalDominance) correctionConfidence = 0.95;
  const evidenceConfidence = selectedPolicyAlternative && selectedPolicyAlternative !== best
    ? correctionConfidence
    : searchConfidence;
  const confidence = clamp01(Math.min(evidenceConfidence, preliminaryVerification.confidenceCap)
    * preliminaryVerification.confidenceMultiplier);
  const correctionThreshold = terminalDominance ? 0
    : best.initialChoiceRate > 0 && macroDemonstration?.verified ? 0.25
      : 0.35;
  const verification = finalizeTeacherVerification(
    preliminaryVerification,
    confidence,
    correctionThreshold
  );
  const correctionEligible = verification.correctionEligible;
  const correctionAlternativeKeys = teacherCorrectionAlternativeKeys(
    game,
    actorId,
    results,
    selectedPolicyAlternative,
    {
      terminalDominance,
      correctionEligible,
      confirmedActionKey: confirmation?.independent === true
        && confirmation?.pairedEvidence?.lowerBound > 0
        ? actionKey(best.action)
        : null
    }
  );
  return {
    labelVersion: TEACHER_LABEL_VERSION,
    action: best.action,
    selectedIndex,
    expectedWinRate: evidenceBest.expectedWinRate,
    decisionScore: evidenceBest.decisionScore,
    downsideWinRate: evidenceBest.downsideWinRate,
    resourcePlan: evidenceBest.resourcePlan,
    responseRisk: evidenceBest.responseRisk,
    mulliganPlan: evidenceBest.mulliganPlan,
    confidence,
    searchConfidence,
    correctionConfidence,
    correctionEligible,
    verification,
    immediateProof: bestImmediateProof,
    macroContinuation: evidenceBest.macroContinuation || null,
    macroDemonstration: macroDemonstration?.verified ? macroDemonstration : null,
    confirmation: confirmation ? {
      independent: confirmation.independent === true,
      simulations: confirmation.simulations,
      pairedEvidence: confirmation.pairedEvidence,
      terminalPairedEvidence: confirmation.terminalPairedEvidence,
      validPairedSamples: confirmation.pairedEvidence?.samples || 0,
      validRates: {
        recommended: confirmation.best.validRate,
        selected: confirmation.selected.validRate
      },
      terminalRates: {
        recommended: confirmation.best.terminalRate,
        selected: confirmation.selected.terminalRate
      },
      evaluatorComparison,
      attemptedSimulations: {
        recommended: confirmation.best.attemptedSimulations,
        selected: confirmation.selected.attemptedSimulations
      },
      invalidSimulations: {
        recommended: confirmation.best.invalidSimulations,
        selected: confirmation.selected.invalidSimulations
      },
      invalidReasons: {
        recommended: confirmation.best.invalidReasons,
        selected: confirmation.selected.invalidReasons
      },
      determinizationAudit: confirmation.determinizationAudit,
      leafValuePairs: confirmation.leafValuePairs,
      seedBanks: confirmation.seedBanks,
      proposalPriority: confirmation.proposalPriority
    } : null,
    independentActionRankingAudit,
    independentActionRankingAuditDiagnostic,
    actionAuditAttempted,
    actionAuditKey,
    deferredActionAuditCandidate,
    deferredLeafAuditCandidate,
    independentLeafValuePairs,
    independentLeafAuditAttempted,
    independentLeafActionEffectComparison,
    correctionAlternativeKeys,
    holdComparison: hold ? {
      action: hold.action,
      expectedWinRate: hold.expectedWinRate,
      decisionScore: hold.decisionScore,
      gainFromBest: best.decisionScore - hold.decisionScore,
      pairedGainFromBest: best.pairedGainOverHold
    } : null,
    policyComparison: selectedPolicyAlternative ? {
      selectedAction: selectedPolicyAlternative.action,
      selectedExpectedWinRate: evidenceSelected?.expectedWinRate ?? selectedPolicyAlternative.expectedWinRate,
      selectedDecisionScore: evidenceSelected?.decisionScore ?? selectedPolicyAlternative.decisionScore,
      bestAlternativeAction: bestOtherThanSelected?.action || null,
      bestAlternativeExpectedWinRate: bestOtherThanSelected?.expectedWinRate ?? null,
      regret: Math.max(0, Number(evidenceBest.decisionScore)
        - Number(evidenceSelected?.decisionScore ?? selectedPolicyAlternative.decisionScore)),
      pairedGainOverHold: selectedPolicyAlternative.pairedGainOverHold,
      pairedEvidence: selectedPairedEvidence,
      evaluatorComparison
    } : null,
    planningProfile: profile,
    search: {
      ...search,
      screenSimulations,
      confirmationMinimumSimulations,
      confirmationSimulations,
      confirmationMaxSimulations,
      stages: searchStages
    },
    alternatives: results
  };
}

export function runIndependentActionAuditCandidateRace(
  candidates = [],
  options = {}
) {
  const uniqueCandidates = [...new Map(
    candidates
      .filter((candidate) =>
        candidate?.game
        && candidate?.actorId
        && candidate?.descriptor?.auditKey
        && candidate?.descriptor?.recommendedAction
        && candidate?.descriptor?.selectedAction)
      .map((candidate) => [candidate.descriptor.auditKey, candidate])
  ).values()];
  if (uniqueCandidates.length === 0) {
    return {
      version: 1,
      contract: "independent-terminal-action-audit-race-v1",
      candidates: [],
      reference: null,
      summary: {
        discovered: 0,
        pilotAttempted: 0,
        expandedTo16: 0,
        expandedTo32: 0,
        finalAttempted: 0,
        selectionPairedSeedsCompleted: 0,
        finalPairedSeedsCompleted: 0,
        pairedSeedsCompleted: 0,
        references: 0
      }
    };
  }

  const raceEntries = uniqueCandidates.map((candidate) => ({
    candidate,
    selectionResults: null,
    finalResults: null,
    selectionEvidence: null,
    finalEvidence: null,
    diagnostic: {
      version: 3,
      contract: "independent-terminal-action-audit-diagnostic-v3",
      auditKey: candidate.descriptor.auditKey,
      status: "candidate-pending",
      gateReasons: [],
      racing: {
        version: 1,
        contract: "candidate-racing-8-16-32-64-v1",
        source: candidate.selectionSource || "priority",
        stratum: structuredClone(candidate.stratum || null),
        cheapPriority: structuredClone(candidate.descriptor.priority || null),
        checkpoints: []
      },
      selection: null,
      final: null
    }
  }));

  let pilotSurvivors = [];
  for (const entry of raceEntries) {
    const stage = runDeferredActionAuditStage(entry, {
      targetPairs: 8,
      bank: "selection",
      maximumSteps: options.maximumSteps
    });
    entry.selectionResults = stage.results;
    entry.selectionEvidence = stage.evidence;
    const futilityReasons = independentActionAuditFutilityReasons(
      stage.evidence,
      {
        targetPairs: 32,
        minimumTerminalPairs: 16,
        seedBanksDisjoint: stage.seedBanksDisjoint
      }
    );
    appendRaceCheckpoint(entry, 8, "selection", stage, futilityReasons);
    if (futilityReasons.length === 0) {
      pilotSurvivors.push(entry);
    } else {
      entry.diagnostic.status = "racing-futile-after-8";
    }
  }

  pilotSurvivors = pilotSurvivors
    .sort(compareActionAuditRaceEntries)
    .slice(0, 2);
  const pilotSurvivorKeys = new Set(
    pilotSurvivors.map((entry) => entry.candidate.descriptor.auditKey)
  );
  for (const entry of raceEntries) {
    if (entry.diagnostic.status === "candidate-pending"
      && !pilotSurvivorKeys.has(entry.candidate.descriptor.auditKey)) {
      entry.diagnostic.status = "racing-eliminated-after-8";
    }
  }

  const sixteenSurvivors = [];
  for (const entry of pilotSurvivors) {
    const stage = runDeferredActionAuditStage(entry, {
      targetPairs: 16,
      bank: "selection",
      priorResults: entry.selectionResults,
      maximumSteps: options.maximumSteps
    });
    entry.selectionResults = stage.results;
    entry.selectionEvidence = stage.evidence;
    const futilityReasons = independentActionAuditFutilityReasons(
      stage.evidence,
      {
        targetPairs: 32,
        minimumTerminalPairs: 16,
        seedBanksDisjoint: stage.seedBanksDisjoint
      }
    );
    appendRaceCheckpoint(entry, 16, "selection", stage, futilityReasons);
    if (futilityReasons.length === 0) {
      sixteenSurvivors.push(entry);
    } else {
      entry.diagnostic.status = "racing-futile-after-16";
    }
  }

  const rankedSixteenSurvivors =
    sixteenSurvivors.sort(compareActionAuditRaceEntries);
  let finalist = null;
  for (const selectionCandidate of rankedSixteenSurvivors) {
    for (const targetPairs of [24, 32]) {
      const stage = runDeferredActionAuditStage(selectionCandidate, {
        targetPairs,
        bank: "selection",
        priorResults: selectionCandidate.selectionResults,
        maximumSteps: options.maximumSteps
      });
      selectionCandidate.selectionResults = stage.results;
      selectionCandidate.selectionEvidence = stage.evidence;
      const failureReasons = targetPairs === 32
        ? independentActionAuditStageFailureReasons(stage.evidence, {
          attemptedPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: stage.seedBanksDisjoint
        })
        : independentActionAuditFutilityReasons(stage.evidence, {
          targetPairs: 32,
          minimumTerminalPairs: 16,
          seedBanksDisjoint: stage.seedBanksDisjoint
        });
      appendRaceCheckpoint(
        selectionCandidate,
        targetPairs,
        "selection",
        stage,
        failureReasons
      );
      if (failureReasons.length > 0) {
        selectionCandidate.diagnostic.status = targetPairs === 32
          ? "selection-failed"
          : "racing-futile-after-24";
        break;
      }
    }
    if (selectionCandidate.diagnostic.status === "candidate-pending"
      && Number(
        selectionCandidate.selectionEvidence
          ?.terminalEvidence?.attemptedPairs
      ) === 32) {
      finalist = selectionCandidate;
      break;
    }
  }
  if (finalist) {
    for (const entry of rankedSixteenSurvivors) {
      if (entry === finalist
        || entry.diagnostic.status !== "candidate-pending") continue;
      entry.diagnostic.status = "racing-eliminated-after-16";
    }
  }

  if (finalist
    && finalist.diagnostic.status === "candidate-pending"
    && Number(finalist.selectionEvidence?.terminalEvidence?.attemptedPairs) === 32) {
    for (const targetPairs of [16, 32, 48, 64]) {
      const stage = runDeferredActionAuditStage(finalist, {
        targetPairs,
        bank: "final-v2",
        priorResults: finalist.finalResults,
        maximumSteps: options.maximumSteps
      });
      finalist.finalResults = stage.results;
      finalist.finalEvidence = stage.evidence;
      const failureReasons = targetPairs === 64
        ? independentActionAuditStageFailureReasons(stage.evidence, {
          attemptedPairs: 64,
          minimumTerminalPairs: 32,
          seedBanksDisjoint: stage.seedBanksDisjoint
            && disjointSeedBanks(
              actionAuditSeeds(finalist.selectionResults),
              stage.seeds
            )
        })
        : independentActionAuditFutilityReasons(stage.evidence, {
          targetPairs: 64,
          minimumTerminalPairs: 32,
          seedBanksDisjoint: stage.seedBanksDisjoint
            && disjointSeedBanks(
              actionAuditSeeds(finalist.selectionResults),
              stage.seeds
            )
        });
      appendRaceCheckpoint(
        finalist,
        targetPairs,
        "final",
        stage,
        failureReasons
      );
      if (failureReasons.length > 0) {
        finalist.diagnostic.status = targetPairs === 64
          ? "final-failed"
          : `racing-final-futile-after-${targetPairs}`;
        break;
      }
    }
  }

  let reference = null;
  if (finalist
    && finalist.diagnostic.status === "candidate-pending"
    && Number(finalist.finalEvidence?.terminalEvidence?.attemptedPairs) === 64) {
    const descriptor = finalist.candidate.descriptor;
    const selectionEvidence = finalist.selectionEvidence;
    const finalEvidence = finalist.finalEvidence;
    const selectionSeeds = actionAuditSeeds(finalist.selectionResults);
    const finalSeeds = actionAuditSeeds(finalist.finalResults);
    const evaluatorStatePairs = pairedEvaluatorLeafStateEvidence(
      finalEvidence.recommended,
      finalEvidence.selected,
      { maximumPairs: 64 }
    );
    const evaluatorTarget = evaluatorStatePairAuditSummary(evaluatorStatePairs);
    const seedBanksDisjoint =
      disjointSeedBanks(descriptor.occupiedAuditSeeds, selectionSeeds)
      && disjointSeedBanks(descriptor.occupiedAuditSeeds, finalSeeds)
      && disjointSeedBanks(selectionSeeds, finalSeeds);
    if (evaluatorTarget.direction !== "tie" && seedBanksDisjoint) {
      reference = buildIndependentActionRankingAudit({
        descriptor,
        selectionEvidence,
        finalEvidence,
        selectionSeeds,
        finalSeeds,
        evaluatorStatePairs,
        evaluatorTarget,
        stratum: finalist.candidate.stratum
      });
      finalist.diagnostic.status = "reference-issued";
      finalist.diagnostic.evaluatorStatePairs = evaluatorStatePairs.length;
      finalist.diagnostic.evaluatorTarget = evaluatorTarget;
    } else {
      finalist.diagnostic.status = evaluatorTarget.direction === "tie"
        ? "evaluator-target-ineligible"
        : "final-failed";
      const failureReason = evaluatorTarget.direction === "tie"
        ? "evaluator-target-tie"
        : "seed-bank-overlap";
      finalist.diagnostic.final = {
        ...(finalist.diagnostic.final || {}),
        failureReasons: [
          ...(finalist.diagnostic.final?.failureReasons || []),
          failureReason
        ]
      };
    }
  }

  return {
    version: 1,
    contract: "independent-terminal-action-audit-race-v1",
    candidates: raceEntries.map((entry) => ({
      auditKey: entry.candidate.descriptor.auditKey,
      recordedStep: entry.candidate.recordedStep,
      diagnostic: entry.diagnostic,
      audit: reference
        && entry === finalist
        ? reference
        : null
    })),
    reference,
    summary: {
      discovered: raceEntries.length,
      pilotAttempted: raceEntries.length,
      expandedTo16: pilotSurvivors.length,
      expandedTo32: raceEntries.filter((entry) =>
        entry.diagnostic.racing.checkpoints.some(
          (checkpoint) =>
            checkpoint.bank === "selection"
            && Number(checkpoint.attemptedPairs) === 32
        )).length,
      finalAttempted: finalist?.finalResults ? 1 : 0,
      selectionPairedSeedsCompleted: raceEntries.reduce(
        (sum, entry) => sum
          + actionAuditSeeds(entry.selectionResults).length,
        0
      ),
      finalPairedSeedsCompleted:
        actionAuditSeeds(finalist?.finalResults).length,
      pairedSeedsCompleted: raceEntries.reduce(
        (sum, entry) => sum
          + actionAuditSeeds(entry.selectionResults).length,
        0
      ) + actionAuditSeeds(finalist?.finalResults).length,
      references: reference ? 1 : 0
    }
  };
}

export function independentActionAuditSeedBank(
  candidate,
  bank,
  count,
  excludedSeeds = []
) {
  const descriptor = candidate?.descriptor || {};
  const actions = [
    descriptor.recommendedAction,
    descriptor.selectedAction
  ].filter(Boolean);
  const random = deterministicActionAuditRandom(
    candidate?.game,
    candidate?.actorId,
    actions,
    descriptor.informationSetHash,
    bank || "selection"
  );
  const excluded = new Set([
    ...(descriptor.occupiedAuditSeeds || []),
    ...(excludedSeeds || [])
  ].map((seed) => Number(seed) >>> 0));
  return independentSimulationSeeds(Math.max(0, Number(count) || 0), random, excluded);
}

export function runIndependentActionAuditSeedBatch(
  candidate,
  options = {}
) {
  const descriptor = candidate?.descriptor || {};
  const bank = options.bank || "selection";
  const captureEvaluatorState = bank !== "selection";
  const seeds = [...new Set(Array.from(
    options.seeds || [],
    (seed) => Number(seed) >>> 0
  ))];
  if (!candidate?.game
    || !candidate?.actorId
    || !descriptor.recommendedAction
    || !descriptor.selectedAction
    || seeds.length === 0) {
    throw new Error(
      "Independent action-audit seed batch requires a hydrated candidate and explicit seeds."
    );
  }
  const runForPolicy = (policy = null) => rolloutAlternatives(
      candidate.game,
      candidate.actorId,
      [descriptor.recommendedAction, descriptor.selectedAction],
      candidate.model || DEFAULT_AI_MODEL,
      {
      simulations: seeds.length,
      explicitSimulationSeeds: seeds,
      reusePairedDeterminization: true,
      depth: Math.max(
        1,
        Number(descriptor.search?.depth)
          || Number(candidate.depth)
          || 10
      ),
      minimumTurnTransitions: Math.max(
        0,
        Number(descriptor.search?.minimumTurnTransitions) || 0
      ),
      neuralModel: policy?.neuralModel || candidate.neuralModel,
      neuralModels: policy?.neuralModels || candidate.neuralModels,
      evaluatorModels: candidate.evaluatorModels,
      evaluatorModelsCertified:
        candidate.evaluatorModelsCertified === true,
      engineFingerprint: candidate.engineFingerprint,
      informationSetHash: descriptor.informationSetHash,
      initialMemories: policy ? {} : candidate.initialMemories,
      neuralBelief: candidate.neuralBelief,
      captureProductionLeafAudit: true,
      captureActionAuditEvaluatorState: captureEvaluatorState,
      productionLeafAuditMaximumSteps: Math.max(
        192,
        Math.min(1200, Number(options.maximumSteps) || 1200)
      )
      }
    );
  const policyPairs = Array.isArray(candidate.auditPolicyPairs)
    && candidate.auditPolicyPairs.length > 0
    ? candidate.auditPolicyPairs
    : [null];
  const requestedPolicyPairIds = new Set(
    Array.from(options.protocolPairIds || [], String)
  );
  const selectedPolicyPairs = requestedPolicyPairIds.size > 0
    ? policyPairs.filter((policy) => requestedPolicyPairIds.has(
      `${policy?.continuationId || ""}::${policy?.opponentId || ""}`
    ))
    : policyPairs;
  if (requestedPolicyPairIds.size > 0
    && selectedPolicyPairs.length !== requestedPolicyPairIds.size) {
    throw new Error(
      "Independent action-audit task requested an unavailable policy pair."
    );
  }
  const protocolResults = selectedPolicyPairs.map((policy) => ({
    continuationId: policy?.continuationId || null,
    opponentId: policy?.opponentId || null,
    results: serializeActionAuditRolloutResults(runForPolicy(policy))
  }));
  if (protocolResults.length === 0) {
    throw new Error("Independent action-audit seed batch has no policy pair.");
  }
  const results = hydrateActionAuditRolloutResults(
    protocolResults[0].results
  );
  const serializedResults = serializeActionAuditRolloutResults(results);
  const structuredCompanionFailure = captureEvaluatorState
    ? protocolResults.map((item) =>
      independentActionAuditStructuredV2CompanionFailure(item.results, {
        engineFingerprint: candidate.engineFingerprint,
        informationSetHash: descriptor.informationSetHash
      })).find(Boolean) || null
    : null;
  if (structuredCompanionFailure) {
    const error = new Error(structuredCompanionFailure);
    error.code = "STRUCTURED_V2_COMPANION_MISSING";
    throw error;
  }
  return {
    version: 1,
    contract: "independent-action-audit-seed-batch-v1",
    auditKey: descriptor.auditKey,
    bank,
    seeds,
    // Pair-sharded worker tasks already carry the exact result under
    // protocolResults. Avoid duplicating the largest payload in the archive;
    // direct/legacy callers retain the compatibility field.
    results: requestedPolicyPairIds.size > 0
      && selectedPolicyPairs[0] != null
      ? []
      : serializedResults,
    protocolResults: selectedPolicyPairs[0] == null ? [] : protocolResults
  };
}

export function independentActionAuditStructuredV2CompanionFailure(
  serializedResults = [],
  options = {}
) {
  if (!options.engineFingerprint || !options.informationSetHash) {
    return "structured-v2-companion-missing";
  }
  for (const result of serializedResults || []) {
    for (const sample of result?.samples || []) {
      if (sample?.invalid === true) continue;
      const auditState = sample?.postActionAuditState;
      if (!auditState?.state) return "structured-v2-companion-missing";
      if (!validPublicStructuredEvidenceSnapshot(
        auditState.structuredState,
        {
          engineFingerprint: options.engineFingerprint,
          informationSetHash: options.informationSetHash
        }
      )) return "structured-v2-companion-missing";
    }
  }
  return null;
}

export function mergeIndependentActionAuditSeedBatches(batches = []) {
  return mergeActionAuditRolloutResults(
    ...(batches || []).map((batch) => batch?.results || [])
  );
}

export function mergeIndependentActionAuditProtocolBatches(batches = []) {
  const grouped = new Map();
  for (const batch of batches || []) {
    for (const item of batch?.protocolResults || []) {
      if (!item?.continuationId || !item?.opponentId) continue;
      const key = `${item.continuationId}::${item.opponentId}`;
      const group = grouped.get(key) || {
        continuationId: item.continuationId,
        opponentId: item.opponentId,
        batches: []
      };
      group.batches.push({ results: item.results || [] });
      grouped.set(key, group);
    }
  }
  return [...grouped.values()]
    .sort((left, right) =>
      left.continuationId.localeCompare(right.continuationId)
      || left.opponentId.localeCompare(right.opponentId))
    .map((group) => ({
      continuationId: group.continuationId,
      opponentId: group.opponentId,
      results: mergeIndependentActionAuditSeedBatches(group.batches)
    }));
}

export function independentActionAuditEvidenceFromBatches(
  candidate,
  serializedResults
) {
  const descriptor = candidate?.descriptor || {};
  return actionAuditEvidence(
    hydrateActionAuditRolloutResults(serializedResults),
    descriptor.recommendedAction,
    descriptor.selectedAction
  );
}

export function independentActionAuditProtocolMixtureEvidence(
  candidate,
  protocolResults = []
) {
  const protocol = candidate?.descriptor?.evidenceProtocolManifest;
  if (!validActionEvidenceProtocolManifest(protocol)) return null;
  const continuations = protocol.continuationPool.members || [];
  const opponents = protocol.opponentPool.members || [];
  const expected = continuations.flatMap((continuation) =>
    opponents.map((opponent) => ({
      continuation,
      opponent,
      id: `${continuation.id}::${opponent.id}`,
      weight: Number(continuation.weight) * Number(opponent.weight)
    })));
  const provided = new Map();
  for (const item of protocolResults || []) {
    const id = `${item?.continuationId || ""}::${item?.opponentId || ""}`;
    if (!id.includes("::") || provided.has(id)) return null;
    provided.set(id, item);
  }
  if (provided.size !== expected.length
    || expected.some(({ id }) => !provided.has(id))) return null;
  const pairEvidence = expected.flatMap((pair) => {
    const item = provided.get(pair.id);
    const hydrated = hydrateActionAuditRolloutResults(item.results || []);
    const evidence = actionAuditEvidence(
      hydrated,
      candidate.descriptor.recommendedAction,
      candidate.descriptor.selectedAction
    );
    if (!evidence) return [];
    return [{ ...pair, hydrated, evidence, seeds: actionAuditSeeds(hydrated) }];
  });
  if (pairEvidence.length !== expected.length) return null;
  const seedSignature = pairEvidence[0].seeds
    .map((seed) => Number(seed) >>> 0)
    .sort((left, right) => left - right);
  if (seedSignature.length === 0
    || pairEvidence.some((item) => {
      const seeds = item.seeds
        .map((seed) => Number(seed) >>> 0)
        .sort((left, right) => left - right);
      return seeds.length !== seedSignature.length
        || seeds.some((seed, index) => seed !== seedSignature[index]);
    })) return null;
  const totalWeight = pairEvidence.reduce(
    (sum, item) => sum + Math.max(0, Number(item.weight) || 0),
    0
  );
  if (!(totalWeight > 0)) return null;
  const weightedPairs = pairEvidence.map((item) => ({
    ...item,
    normalizedWeight: Math.max(0, Number(item.weight) || 0) / totalWeight,
    outcomes: new Map(
      (item.evidence.terminalEvidence?.outcomePairs || []).map((outcome) => [
        Number(outcome.simulationSeed) >>> 0,
        outcome
      ])
    )
  }));
  const outcomePairs = seedSignature.flatMap((simulationSeed) => {
    const outcomes = weightedPairs.map((item) => item.outcomes.get(simulationSeed));
    if (outcomes.some((outcome) => !outcome)) return [];
    return [{
      simulationSeed,
      leftOutcome: weightedPairs.reduce(
        (sum, item, index) =>
          sum + item.normalizedWeight * Number(outcomes[index].leftOutcome),
        0
      ),
      rightOutcome: weightedPairs.reduce(
        (sum, item, index) =>
          sum + item.normalizedWeight * Number(outcomes[index].rightOutcome),
        0
      )
    }];
  });
  const differences = outcomePairs.map((outcome) =>
    outcome.leftOutcome - outcome.rightOutcome);
  const commonTerminalCount = differences.length;
  const commonMean = commonTerminalCount > 0
    ? differences.reduce((sum, value) => sum + value, 0)
      / commonTerminalCount
    : 0;
  const empiricalVariance = commonTerminalCount > 1
    ? differences.reduce(
      (sum, value) => sum + (value - commonMean) ** 2,
      0
    ) / (commonTerminalCount - 1)
    : 1;
  const empiricalStandardError = commonTerminalCount > 0
    ? Math.sqrt(Math.max(0, empiricalVariance) / commonTerminalCount)
    : 0;
  const mean = weightedPairs.reduce(
    (sum, item) => sum + item.normalizedWeight
      * (Number(item.evidence.terminalEvidence?.mean) || 0),
    0
  );
  // Pair estimates share seeds and model lineage. Treat them as maximally
  // correlated rather than shrinking uncertainty as though the pool were
  // independent; the per-seed mixture estimate is retained when it is wider.
  const correlatedStandardError = weightedPairs.reduce((sum, item) => {
    const terminal = item.evidence.terminalEvidence || {};
    const reported = Math.max(0, Number(terminal.standardError) || 0);
    const fallbackSamples = Math.max(0, Number(terminal.samples) || 0);
    const standardError = reported > 0
      ? reported
      : fallbackSamples > 1
        ? 1 / Math.sqrt(fallbackSamples)
        : 1;
    return sum + item.normalizedWeight * standardError;
  }, 0);
  const standardError = Math.max(empiricalStandardError, correlatedStandardError);
  const terminalPairs = Math.min(
    ...weightedPairs.map((item) => Math.max(
      0,
      Number(item.evidence.terminalEvidence?.terminalPairs) || 0
    ))
  );
  const rateAt = (category, side) => {
    const values = weightedPairs.map((item) =>
      item.evidence.terminalEvidence?.rates?.[category]?.[side] || {});
    const attempts = seedSignature.length;
    const successes = Math.min(
      attempts,
      ...values.map((rate) => Math.max(0, Number(rate.successes) || 0))
    );
    return {
      successes,
      attempts,
      rate: attempts ? successes / attempts : 0,
      lowerBound: Math.min(
        ...values.map((rate) => Math.max(0, Number(rate.lowerBound) || 0))
      )
    };
  };
  const failureReasons = {};
  for (const item of weightedPairs) {
    for (const [reason, occurrences] of Object.entries(
      item.evidence.terminalEvidence?.failureReasons || {}
    )) {
      failureReasons[reason] = (failureReasons[reason] || 0)
        + Math.max(0, Number(occurrences) || 0);
    }
  }
  const primary = weightedPairs[0].evidence;
  return {
    recommended: primary.recommended,
    selected: primary.selected,
    terminalEvidence: {
      attemptedPairs: seedSignature.length,
      validPairs: Math.min(
        ...weightedPairs.map((item) =>
          Math.max(0, Number(item.evidence.terminalEvidence?.validPairs) || 0))
      ),
      terminalPairs,
      samples: terminalPairs,
      mean,
      standardError,
      lowerBound: terminalPairs > 0 ? mean - 1.96 * standardError : -1,
      upperBound: terminalPairs > 0 ? mean + 1.96 * standardError : 1,
      positiveRate: weightedPairs.reduce(
        (sum, item) => sum + item.normalizedWeight * Math.max(
          0,
          Number(item.evidence.terminalEvidence?.positiveRate) || 0
        ),
        0
      ),
      terminalSeeds: outcomePairs.map((outcome) => outcome.simulationSeed),
      outcomePairs,
      rates: {
        valid: {
          recommended: rateAt("valid", "recommended"),
          selected: rateAt("valid", "selected"),
          paired: rateAt("valid", "paired")
        },
        terminal: {
          recommended: rateAt("terminal", "recommended"),
          selected: rateAt("terminal", "selected"),
          paired: rateAt("terminal", "paired")
        }
      },
      failureReasons,
      maximumStepCutoffs: weightedPairs.reduce(
        (sum, item) => sum + Math.max(
          0,
          Number(item.evidence.terminalEvidence?.maximumStepCutoffs) || 0
        ),
        0
      ),
      protocolMixture: {
        version: 1,
        contract: "precommitted-policy-pool-mixture-stage-evidence-v1",
        pairCount: weightedPairs.length,
        commonTerminalPairs: commonTerminalCount,
        conservativeStandardError: true,
        aggregation: "frozen-weighted-mean-maximally-correlated-se-v1"
      }
    },
    determinizationAudit: {
      version: 1,
      source: "precommitted-policy-pool-mixture",
      complete: weightedPairs.every((item) =>
        item.evidence.determinizationAudit?.complete === true),
      policyPairs: weightedPairs.length
    }
  };
}

export function finalizeIndependentActionAuditBatches(
  candidate,
  options = {}
) {
  const descriptor = candidate?.descriptor || {};
  const protocol = descriptor.evidenceProtocolManifest || null;
  const protocolEligible = validActionEvidenceProtocolManifest(protocol)
    && validActionEvidenceSeedCommitment(
      descriptor.evidenceCommitment,
      protocol
    );
  const finalPairsRequired = protocolEligible ? 128 : 64;
  const minimumFinalTerminalPairs = protocolEligible ? 64 : 32;
  const minimumEffect = protocolEligible
    ? Number(protocol.statistics?.minimumTrainingEffect) || 0
    : 0;
  const selectionResults = hydrateActionAuditRolloutResults(
    options.selectionResults || []
  );
  const finalResults = hydrateActionAuditRolloutResults(
    options.finalResults || []
  );
  const selectionEvidence = actionAuditEvidence(
    selectionResults,
    descriptor.recommendedAction,
    descriptor.selectedAction
  );
  const finalEvidence = actionAuditEvidence(
    finalResults,
    descriptor.recommendedAction,
    descriptor.selectedAction
  );
  const protocolSelectionResults = options.protocolSelectionResults || [];
  const protocolFinalEvidence = (options.protocolFinalResults || []).map(
    (item) => ({
      continuationId: item.continuationId,
      opponentId: item.opponentId,
      evidence: actionAuditEvidence(
        hydrateActionAuditRolloutResults(item.results || []),
        descriptor.recommendedAction,
        descriptor.selectedAction
      )
    })
  );
  const selectionGateEvidence = protocolEligible
    ? independentActionAuditProtocolMixtureEvidence(
      candidate,
      protocolSelectionResults
    )
    : selectionEvidence;
  const finalGateEvidence = protocolEligible
    ? independentActionAuditProtocolMixtureEvidence(
      candidate,
      options.protocolFinalResults || []
    )
    : finalEvidence;
  const selectionSeeds = actionAuditSeeds(selectionResults);
  const finalSeeds = actionAuditSeeds(finalResults);
  const seedBanksDisjoint =
    disjointSeedBanks(descriptor.occupiedAuditSeeds, selectionSeeds)
    && disjointSeedBanks(descriptor.occupiedAuditSeeds, finalSeeds)
    && disjointSeedBanks(selectionSeeds, finalSeeds);
  const failureReasons = [
    ...independentActionAuditStageFailureReasons(selectionGateEvidence, {
      attemptedPairs: 32,
      minimumTerminalPairs: 16,
      seedBanksDisjoint,
      minimumEffect: 0
    }),
    ...independentActionAuditStageFailureReasons(finalGateEvidence, {
      attemptedPairs: finalPairsRequired,
      minimumTerminalPairs: minimumFinalTerminalPairs,
      seedBanksDisjoint,
      minimumEffect
    })
  ];
  if (failureReasons.length > 0) {
    return {
      audit: null,
      selectionEvidence: selectionGateEvidence,
      finalEvidence: finalGateEvidence,
      selectionSeeds,
      finalSeeds,
      seedBanksDisjoint,
      failureReasons: [...new Set(failureReasons)]
    };
  }
  const evaluatorStatePairs = pairedEvaluatorLeafStateEvidence(
    finalEvidence.recommended,
    finalEvidence.selected,
    { maximumPairs: finalPairsRequired }
  );
  const evaluatorTarget = evaluatorStatePairAuditSummary(
    evaluatorStatePairs
  );
  return {
    audit: buildIndependentActionRankingAudit({
      descriptor,
      stratum: candidate.stratum,
      selectionEvidence: selectionGateEvidence,
      finalEvidence: finalGateEvidence,
      evaluatorStatePairs,
      evaluatorTarget,
      selectionSeeds,
      finalSeeds,
      computeUsage: options.computeUsage,
      protocolFinalEvidence
    }),
    selectionEvidence: selectionGateEvidence,
    finalEvidence: finalGateEvidence,
    selectionSeeds,
    finalSeeds,
    seedBanksDisjoint,
    evaluatorStatePairs,
    evaluatorTarget,
    failureReasons: []
  };
}

function runDeferredActionAuditStage(entry, options = {}) {
  const candidate = entry.candidate;
  const descriptor = candidate.descriptor;
  const bank = options.bank || "selection";
  const priorResults = options.priorResults || null;
  const priorSeeds = actionAuditSeeds(priorResults);
  const occupiedSeeds = [
    ...(descriptor.occupiedAuditSeeds || []),
    ...priorSeeds
  ];
  if (bank !== "selection") {
    occupiedSeeds.push(...actionAuditSeeds(entry.selectionResults));
  }
  const targetPairs = Math.max(1, Number(options.targetPairs) || 1);
  const results = rolloutAlternatives(
    candidate.game,
    candidate.actorId,
    [descriptor.recommendedAction, descriptor.selectedAction],
    candidate.model || DEFAULT_AI_MODEL,
    {
      simulations: targetPairs,
      depth: Math.max(
        1,
        Number(descriptor.search?.depth)
          || Number(candidate.depth)
          || 10
      ),
      minimumTurnTransitions: Math.max(
        0,
        Number(descriptor.search?.minimumTurnTransitions) || 0
      ),
      priorResults,
      excludedSimulationSeeds: [...new Set(occupiedSeeds)],
      neuralModel: candidate.neuralModel,
      neuralModels: candidate.neuralModels,
      evaluatorModels: candidate.evaluatorModels,
      evaluatorModelsCertified:
        candidate.evaluatorModelsCertified === true,
      engineFingerprint: candidate.engineFingerprint,
      informationSetHash: descriptor.informationSetHash,
      initialMemories: candidate.initialMemories,
      neuralBelief: candidate.neuralBelief,
      captureProductionLeafAudit: true,
      captureActionAuditEvaluatorState: bank !== "selection",
      productionLeafAuditMaximumSteps: Math.max(
        192,
        Math.min(1200, Number(options.maximumSteps) || 1200)
      ),
      random: deterministicActionAuditRandom(
        candidate.game,
        candidate.actorId,
        [descriptor.recommendedAction, descriptor.selectedAction],
        descriptor.informationSetHash,
        bank
      )
    }
  );
  const evidence = actionAuditEvidence(
    results,
    descriptor.recommendedAction,
    descriptor.selectedAction
  );
  const seeds = actionAuditSeeds(results);
  return {
    results,
    evidence,
    seeds,
    seedBanksDisjoint:
      disjointSeedBanks(descriptor.occupiedAuditSeeds, seeds)
      && (bank === "selection"
        || disjointSeedBanks(actionAuditSeeds(entry.selectionResults), seeds))
  };
}

function appendRaceCheckpoint(
  entry,
  attemptedPairs,
  bank,
  stage,
  failureReasons
) {
  const compact = compactIndependentActionAuditStageDiagnostic(
    stage.evidence,
    stage.seeds,
    failureReasons
  );
  entry.diagnostic.racing.checkpoints.push({
    bank,
    attemptedPairs,
    ...compact
  });
  if (bank === "selection") entry.diagnostic.selection = compact;
  else entry.diagnostic.final = compact;
}

export function compareActionAuditRaceEntries(left, right) {
  const leftEvidence = left.selectionEvidence?.terminalEvidence || {};
  const rightEvidence = right.selectionEvidence?.terminalEvidence || {};
  const leftPriority = left.candidate.descriptor.priority || {};
  const rightPriority = right.candidate.descriptor.priority || {};
  return (
    (Number(rightEvidence.lowerBound) || -1)
      - (Number(leftEvidence.lowerBound) || -1)
    || (Number(rightEvidence.mean) || 0)
      - (Number(leftEvidence.mean) || 0)
    || (Number(rightPriority.confirmationLowerBound) || 0)
      - (Number(leftPriority.confirmationLowerBound) || 0)
    || (Number(rightPriority.confirmationMean) || 0)
      - (Number(leftPriority.confirmationMean) || 0)
    || (Number(rightPriority.policyRankingDifference) || 0)
      - (Number(leftPriority.policyRankingDifference) || 0)
    || String(left.candidate.descriptor.auditKey)
      .localeCompare(String(right.candidate.descriptor.auditKey))
  );
}

function buildIndependentActionRankingAudit(options = {}) {
  const descriptor = options.descriptor;
  const selectionEvidence = options.selectionEvidence;
  const finalEvidence = options.finalEvidence;
  const protocol = descriptor.evidenceProtocolManifest || null;
  const commitment = descriptor.evidenceCommitment || null;
  const protocolEligible = validActionEvidenceProtocolManifest(protocol)
    && validActionEvidenceSeedCommitment(commitment, protocol);
  if (protocolEligible
    && protocol.candidateSelection?.recordSamplingPropensity === true
    && !descriptor.samplingFrame?.candidateSelection) return null;
  const continuationEvidence = protocolEligible
    ? actionAuditContinuationEvidence(
      protocol,
      finalEvidence,
      options.protocolFinalEvidence
    )
    : null;
  const classification = protocolEligible
    ? classifyPrecommittedActionEvidence({
      manifest: protocol,
      commitment,
      continuationResults: continuationEvidence.results
    })
    : null;
  if (protocolEligible && ![
    ACTION_EVIDENCE_GRADES.terminalRobust,
    ACTION_EVIDENCE_GRADES.continuationConsistent,
    ACTION_EVIDENCE_GRADES.policyConditioned
  ].includes(classification?.grade)) return null;
  return {
    version: protocolEligible ? 4 : 3,
    contract: protocolEligible
      ? "precommitted-continuation-terminal-action-audit-v1"
      : "independent-terminal-action-audit-v3",
    source: "independent-terminal-action-audit",
    policyCorrectionIndependent: true,
    candidateSelectionVersion: 1,
    auditStratum: structuredClone(options.stratum || null),
    auditKey: descriptor.auditKey,
    informationSetHash: descriptor.informationSetHash || null,
    recommendedActionKey: actionKey(descriptor.recommendedAction),
    selectedActionKey: actionKey(descriptor.selectedAction),
    selection: {
      attemptedPairs: selectionEvidence.terminalEvidence.attemptedPairs,
      samples: selectionEvidence.terminalEvidence.samples,
      terminalPairs: selectionEvidence.terminalEvidence.terminalPairs,
      mean: selectionEvidence.terminalEvidence.mean,
      lowerBound: selectionEvidence.terminalEvidence.lowerBound,
      upperBound: selectionEvidence.terminalEvidence.upperBound,
      terminalOutcomePairs:
        selectionEvidence.terminalEvidence.outcomePairs.map(
          terminalActionOutcomePair
        ),
      rates: selectionEvidence.terminalEvidence.rates
    },
    final: {
      attemptedPairs: finalEvidence.terminalEvidence.attemptedPairs,
      terminalPairs: finalEvidence.terminalEvidence.terminalPairs,
      samples: finalEvidence.terminalEvidence.samples,
      mean: finalEvidence.terminalEvidence.mean,
      lowerBound: finalEvidence.terminalEvidence.lowerBound,
      upperBound: finalEvidence.terminalEvidence.upperBound,
      positiveRate: finalEvidence.terminalEvidence.positiveRate,
      terminalOutcomePairs:
        finalEvidence.terminalEvidence.outcomePairs.map(
          terminalActionOutcomePair
        ),
      rates: finalEvidence.terminalEvidence.rates
    },
    evaluatorStatePairs: options.evaluatorStatePairs,
    evaluatorTarget: options.evaluatorTarget,
    evidenceGrade: classification?.grade
      || ACTION_EVIDENCE_GRADES.legacyTerminalConditioned,
    evidenceProtocol: protocolEligible ? structuredClone(protocol) : null,
    evidenceCommitment:
      protocolEligible ? structuredClone(commitment) : null,
    evidenceClassification:
      protocolEligible ? structuredClone(classification) : null,
    continuationEvidence:
      protocolEligible ? structuredClone(continuationEvidence) : null,
    samplingFrame: structuredClone(descriptor.samplingFrame || null),
    computeUsage: structuredClone(options.computeUsage || null),
    determinizationAudit: finalEvidence.determinizationAudit,
    seedBanks: {
      screening: [...new Set(descriptor.screeningSeeds || [])],
      confirmation: [...new Set(descriptor.confirmationSeeds || [])],
      selection: options.selectionSeeds,
      final: options.finalSeeds,
      disjoint: true
    },
    usedForTeacherDecision: false,
    usedForPolicyTraining: false,
    usedForActionValueTraining: false,
    usedForProposalValueTraining: false,
    usedForEpochSelection: false
  };
}

function evaluatorStatePairAuditSummary(pairs = []) {
  const deltas = pairs.map((pair) =>
    Number(pair.recommendedOutcome) - Number(pair.selectedOutcome));
  const meanOutcomeDelta = deltas.length
    ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    : 0;
  return {
    pairs: deltas.length,
    wins: deltas.filter((value) => value > 0).length,
    losses: deltas.filter((value) => value < 0).length,
    ties: deltas.filter((value) => value === 0).length,
    meanOutcomeDelta,
    direction: meanOutcomeDelta > 0
      ? "recommended"
      : meanOutcomeDelta < 0
        ? "selected"
        : "tie"
  };
}

function terminalActionOutcomePair(pair) {
  return {
    simulationSeed: Number(pair.simulationSeed) >>> 0,
    recommendedOutcome: Number(pair.leftOutcome),
    selectedOutcome: Number(pair.rightOutcome)
  };
}

function confirmationEvidence(results, recommendedAction, selectedAction) {
  const byKey = new Map((results || []).map((result) => [actionKey(result.action), result]));
  const best = byKey.get(actionKey(recommendedAction)) || null;
  const selected = byKey.get(actionKey(selectedAction)) || null;
  if (!best || !selected) return null;
  return {
    best,
    selected,
    pairedEvidence: pairedRolloutDifference(best, selected),
    terminalPairedEvidence: pairedTerminalRolloutDifference(best, selected)
  };
}

function actionAuditEvidence(results, recommendedAction, selectedAction) {
  const byKey = new Map((results || []).map((result) => [
    actionKey(result.action),
    result
  ]));
  const recommended = byKey.get(actionKey(recommendedAction)) || null;
  const selected = byKey.get(actionKey(selectedAction)) || null;
  if (!recommended || !selected) return null;
  const terminalEvidence = pairedIndependentTerminalActionAudit(
    recommended,
    selected
  );
  return {
    recommended,
    selected,
    terminalEvidence,
    determinizationAudit: terminalPairDeterminizationAudit(
      recommended,
      selected,
      terminalEvidence
    )
  };
}

function independentActionAuditGateReasons(options = {}) {
  const reasons = [];
  if (options.captureEnabled !== true) reasons.push("capture-disabled");
  if (options.budgetEnabled !== true) reasons.push("game-audit-budget-exhausted");
  if (!options.actionAuditKey) reasons.push("no-policy-disagreement");
  if (options.duplicate === true) reasons.push("duplicate-information-set-action-pair");
  if (!options.selected) reasons.push("selected-action-missing-from-search");
  if (options.confirmationRequired === true
    && options.confirmationAvailable !== true) {
    reasons.push("independent-confirmation-missing");
  }
  if (options.determinizationAudit?.complete !== true) {
    reasons.push("confirmation-determinization-incomplete");
  }
  if (Number(options.recommendedValidRate) < 0.75) {
    reasons.push("recommended-confirmation-valid-rate");
  }
  if (Number(options.selectedValidRate) < 0.75) {
    reasons.push("selected-confirmation-valid-rate");
  }
  if (options.requirePositiveLowerBound !== false
    && !(Number(options.lowerBound) > 0)) {
    reasons.push("confirmation-paired-lower-bound");
  }
  return reasons;
}

export function independentActionAuditPreselectionFutilityReasons(
  evidence,
  options = {}
) {
  return independentActionAuditFutilityReasons(evidence, {
    targetPairs: 32,
    minimumTerminalPairs: 16,
    seedBanksDisjoint: options.seedBanksDisjoint
  }).map((reason) => `preselection-${reason}`);
}

export function independentActionAuditFutilityReasons(
  evidence,
  options = {}
) {
  if (!evidence) return ["missing-evidence"];
  if (options.seedBanksDisjoint !== true) {
    return ["seed-bank-overlap"];
  }
  const terminal = evidence.terminalEvidence;
  const targetPairs = Math.max(1, Number(options.targetPairs) || 1);
  const minimumTerminalPairs = Math.max(
    1,
    Number(options.minimumTerminalPairs) || Math.ceil(targetPairs / 2)
  );
  const attemptedPairs = Math.max(
    0,
    Number(terminal?.attemptedPairs) || 0
  );
  if (attemptedPairs > targetPairs) {
    return ["attempted-pairs-exceed-target"];
  }
  const remainingPairs = Math.max(0, targetPairs - attemptedPairs);
  if (terminal?.protocolMixture) {
    if (Number(terminal?.terminalPairs) + remainingPairs
      < minimumTerminalPairs) {
      return ["insufficient-maximum-terminal-pairs"];
    }
    const optimisticRateFailures = [
      terminal?.rates?.valid?.recommended,
      terminal?.rates?.valid?.selected,
      terminal?.rates?.valid?.paired,
      terminal?.rates?.terminal?.recommended,
      terminal?.rates?.terminal?.selected,
      terminal?.rates?.terminal?.paired
    ].some((rate) => wilsonLowerBoundForAudit(
      (Number(rate?.successes) || 0) + remainingPairs,
      targetPairs
    ) < 0.3);
    return optimisticRateFailures ? ["rate-lower-bound-impossible"] : [];
  }
  const observedDifferences = (terminal?.outcomePairs || [])
    .map((pair) => Number(pair.leftOutcome) - Number(pair.rightOutcome))
    .filter((difference) =>
      Number.isFinite(difference) && difference >= -1 && difference <= 1);
  if (observedDifferences.length + remainingPairs < minimumTerminalPairs) {
    return ["insufficient-maximum-terminal-pairs"];
  }
  if (!(maximumAttainableAuditLowerBound(
    observedDifferences,
    remainingPairs,
    minimumTerminalPairs
  ) > 0)) {
    return ["positive-lower-bound-impossible"];
  }
  const optimisticRateFailures = [
    terminal?.rates?.valid?.recommended,
    terminal?.rates?.valid?.selected,
    terminal?.rates?.valid?.paired,
    terminal?.rates?.terminal?.recommended,
    terminal?.rates?.terminal?.selected,
    terminal?.rates?.terminal?.paired
  ].some((rate) => wilsonLowerBoundForAudit(
    (Number(rate?.successes) || 0) + remainingPairs,
    targetPairs
  ) < 0.3);
  if (optimisticRateFailures) {
    return ["rate-lower-bound-impossible"];
  }
  return [];
}

function maximumAttainableAuditLowerBound(
  observedDifferences,
  remainingPairs,
  minimumTerminalPairs
) {
  let maximumLowerBound = Number.NEGATIVE_INFINITY;
  const observed = observedDifferences.filter(Number.isFinite);
  const minimumAdded = Math.max(
    0,
    minimumTerminalPairs - observed.length
  );
  for (let addedTerminal = minimumAdded;
    addedTerminal <= remainingPairs;
    addedTerminal += 1) {
    for (let positive = 0; positive <= addedTerminal; positive += 1) {
      for (let negative = 0;
        negative <= addedTerminal - positive;
        negative += 1) {
        const zero = addedTerminal - positive - negative;
        const differences = [
          ...observed,
          ...Array(positive).fill(1),
          ...Array(zero).fill(0),
          ...Array(negative).fill(-1)
        ];
        if (differences.length === 0) continue;
        const mean =
          differences.reduce((sum, value) => sum + value, 0)
            / differences.length;
        const variance = differences.length > 1
          ? differences.reduce(
            (sum, value) => sum + (value - mean) ** 2,
            0
          ) / (differences.length - 1)
          : 1;
        const lowerBound =
          mean - 1.96 * Math.sqrt(Math.max(0, variance) / differences.length);
        if (lowerBound > maximumLowerBound) maximumLowerBound = lowerBound;
      }
    }
  }
  return maximumLowerBound;
}

function wilsonLowerBoundForAudit(successes, attempts, z = 1.96) {
  const count = Math.max(0, Number(attempts) || 0);
  if (!count) return 0;
  const passed = Math.max(
    0,
    Math.min(count, Number(successes) || 0)
  );
  const probability = passed / count;
  const denominator = 1 + (z * z) / count;
  const centre = probability + (z * z) / (2 * count);
  const margin = z * Math.sqrt(
    (
      probability * (1 - probability)
        + (z * z) / (4 * count)
    ) / count
  );
  return Math.max(0, (centre - margin) / denominator);
}

export function independentActionAuditStageFailureReasons(evidence, options = {}) {
  if (!evidence) return ["missing-stage-evidence"];
  const terminal = evidence.terminalEvidence;
  const reasons = [];
  if (Number(terminal?.attemptedPairs) !== Number(options.attemptedPairs)) {
    reasons.push("precommitted-seed-count-mismatch");
  }
  if (options.seedBanksDisjoint !== true) reasons.push("seed-bank-overlap");
  if (Number(terminal?.terminalPairs) < Number(options.minimumTerminalPairs)) {
    reasons.push("insufficient-terminal-pairs");
  }
  const minimumEffect = Math.max(0, Number(options.minimumEffect) || 0);
  if (!(Number(terminal?.lowerBound) > minimumEffect)) {
    reasons.push("nonpositive-terminal-paired-lower-bound");
  }
  const validLower = Math.min(
    Number(terminal?.rates?.valid?.recommended?.lowerBound) || 0,
    Number(terminal?.rates?.valid?.selected?.lowerBound) || 0,
    Number(terminal?.rates?.valid?.paired?.lowerBound) || 0
  );
  const terminalLower = Math.min(
    Number(terminal?.rates?.terminal?.recommended?.lowerBound) || 0,
    Number(terminal?.rates?.terminal?.selected?.lowerBound) || 0,
    Number(terminal?.rates?.terminal?.paired?.lowerBound) || 0
  );
  // The fixed 32/64 banks intentionally permit a 50% terminal yield. The
  // Wilson lower bound guards against a few lucky terminal samples without
  // silently restoring an all-samples-must-finish contract.
  if (validLower < 0.3) reasons.push("valid-rate-lower-bound");
  if (terminalLower < 0.3) reasons.push("terminal-rate-lower-bound");
  return reasons;
}

function actionAuditContinuationEvidence(
  protocol,
  finalEvidence,
  protocolFinalEvidence = []
) {
  const members = protocol?.continuationPool?.members || [];
  const opponents = protocol?.opponentPool?.members || [];
  const opponentById = new Map(opponents.map((member) => [member.id, member]));
  const expectedPairs = new Set(members.flatMap((continuation) =>
    opponents.map((opponent) => `${continuation.id}::${opponent.id}`)));
  const providedPairs = protocolFinalEvidence.map((item) =>
    `${item?.continuationId || ""}::${item?.opponentId || ""}`);
  const uniqueProvidedPairs = new Set(providedPairs);
  const exactPairSet = providedPairs.length === expectedPairs.size
    && uniqueProvidedPairs.size === providedPairs.length
    && [...uniqueProvidedPairs].every((key) => expectedPairs.has(key));
  if (!exactPairSet) {
    return {
      version: 1,
      contract: "continuation-sensitivity-action-audit-v1",
      results: [],
      completePool: false,
      mixtureWeightsFrozen: true,
      validationFailure: "continuation-opponent-result-set-not-exact"
    };
  }
  const evidenceByPair = new Map(protocolFinalEvidence.map((item) => [
    `${item.continuationId}::${item.opponentId}`,
    item.evidence?.terminalEvidence || null
  ]));
  const unadjusted = members.flatMap((member) => {
    const opponentEvidence = opponents.flatMap((opponent) => {
      const terminal = evidenceByPair.get(`${member.id}::${opponent.id}`);
      if (!terminal) return [];
      const mean = Number(terminal.mean) || 0;
      const reportedStandardError = Math.max(
        0,
        Number(terminal.standardError) || 0
      );
      const samples = Math.max(0, Number(terminal.samples) || 0);
      const standardError = reportedStandardError > 0
        ? reportedStandardError
        : samples > 1
          ? 1 / Math.sqrt(samples)
          : 1;
      return [{
        opponentId: opponent.id,
        weight: Number(opponent.weight) || 0,
        samples,
        mean,
        standardError
      }];
    });
    if (opponentEvidence.length !== opponentById.size) return [];
    const mean = opponentEvidence.reduce(
      (sum, item) => sum + item.weight * item.mean,
      0
    );
    // Treat opponent-conditioned estimates as maximally correlated. This is
    // wider than the independence formula and cannot manufacture confidence
    // merely by adding very similar opponents to the frozen pool.
    const standardError = opponentEvidence.reduce(
      (sum, item) => sum + item.weight * item.standardError,
      0
    );
    return [{
      id: member.id,
      modelHash: member.modelHash,
      behaviorHash: member.behaviorHash,
      weight: member.weight,
      samples: opponentEvidence.reduce(
        (sum, item) => sum + item.samples,
        0
      ),
      mean,
      standardError,
      lowerBound: mean,
      upperBound: mean,
      behaviorallyIndependent: member.behaviorallyIndependent === true,
      strengthEligible:
        Number(member.strength) >= Number(
          protocol?.continuationPool?.minimumStrength
        ),
      opponentResults: opponentEvidence
    }];
  });
  const results = unadjusted.length === members.length
    ? applyHolmSimultaneousBounds(unadjusted, {
      confidenceLevel: protocol?.statistics?.confidenceLevel,
      nullValue: 0
    })
    : [];
  return {
    version: 1,
    contract: "continuation-sensitivity-action-audit-v1",
    results,
    completePool: results.length === members.length
      && results.every((item) =>
        item.opponentResults?.length === opponentById.size),
    mixtureWeightsFrozen: true
  };
}

export function compactIndependentActionAuditStageDiagnostic(
  evidence,
  seeds,
  failureReasons
) {
  const terminal = evidence?.terminalEvidence;
  return {
    attemptedPairs: Number(terminal?.attemptedPairs) || 0,
    validPairs: Number(terminal?.validPairs) || 0,
    terminalPairs: Number(terminal?.terminalPairs) || 0,
    mean: Number(terminal?.mean) || 0,
    lowerBound: Number(terminal?.lowerBound) || 0,
    upperBound: Number(terminal?.upperBound) || 0,
    rates: structuredClone(terminal?.rates || null),
    determinization: structuredClone(evidence?.determinizationAudit || null),
    invalidReasons: structuredClone(terminal?.failureReasons || {}),
    maximumStepCutoffs: Number(terminal?.maximumStepCutoffs) || 0,
    seedCount: (seeds || []).length,
    failureReasons: [...(failureReasons || [])]
  };
}

function terminalPairDeterminizationAudit(recommended, selected, terminalEvidence) {
  const recommendedAudit = recommended?.determinizationAudit || null;
  const selectedAudit = selected?.determinizationAudit || null;
  const terminalPairs = Number(terminalEvidence?.terminalPairs) || 0;
  return {
    version: 2,
    source: "paired-terminal-action-audit",
    // Every retained terminal pair necessarily came from a complete
    // determinization. Failures outside the retained evidence remain visible
    // below and are governed by the valid-rate lower bound.
    complete: terminalPairs > 0,
    retainedTerminalPairs: terminalPairs,
    attemptedFailures:
      (Number(recommendedAudit?.failures) || 0)
      + (Number(selectedAudit?.failures) || 0),
    recommended: structuredClone(recommendedAudit),
    selected: structuredClone(selectedAudit)
  };
}

function actionAuditSeeds(results) {
  return [...new Set((results || []).flatMap((result) =>
    Array.from(
      result?.simulationSeeds || [],
      (seed) => Number(seed) >>> 0
    )))];
}

function confirmationDeterminizationAudit(recommended, selected) {
  const recommendedAudit = recommended?.determinizationAudit || null;
  const selectedAudit = selected?.determinizationAudit || null;
  return {
    version: 1,
    source: "paired-independent-confirmation",
    complete: recommendedAudit?.complete === true
      && selectedAudit?.complete === true,
    recommended: structuredClone(recommendedAudit),
    selected: structuredClone(selectedAudit)
  };
}

function directEngineDeterminizationAudit() {
  return {
    version: 1,
    source: "direct-engine-transition",
    complete: true
  };
}

function teacherProposalPriority(legalActions, proposalValues, recommendedAction, selectedAction) {
  if (!Array.isArray(proposalValues) && !ArrayBuffer.isView(proposalValues)) return 0;
  if (!recommendedAction || !selectedAction) return 0;
  const byKey = new Map(legalActions.map((action, index) => [
    actionKey(action),
    Number(proposalValues[index]) || 0
  ]));
  return Math.max(0,
    (byKey.get(actionKey(recommendedAction)) || 0)
      - (byKey.get(actionKey(selectedAction)) || 0));
}

function disjointSeedBanks(left, right) {
  const seen = new Set(Array.from(left || [], (seed) => Number(seed) >>> 0));
  return Array.from(right || [], (seed) => Number(seed) >>> 0)
    .every((seed) => !seen.has(seed));
}

function deterministicLeafAuditRandom(
  game,
  actorId,
  actions,
  informationSetHash = null
) {
  let state = independentLeafAuditSeed(
    game,
    actorId,
    actions,
    informationSetHash
  );
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function deterministicActionAuditRandom(
  game,
  actorId,
  actions,
  informationSetHash,
  stage
) {
  let state = independentActionAuditSeed(
    game,
    actorId,
    actions,
    informationSetHash,
    stage
  );
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function independentActionAuditSeed(
  game,
  actorId,
  actions,
  informationSetHash,
  stage
) {
  return stableAuditHash([
    "action-audit-v1",
    stage || "unknown",
    informationSetHash || "missing-information-set-hash",
    actorId,
    game?.phase,
    game?.turnSequence,
    game?.round,
    ...(actions || []).map(actionKey).sort()
  ].join("|"));
}

export function independentActionAuditKey(
  informationSetHash,
  recommendedAction,
  selectedAction
) {
  return [
    "independent-terminal-action-audit-v1",
    informationSetHash || "missing-information-set-hash",
    ...[actionKey(recommendedAction), actionKey(selectedAction)].sort()
  ].join("|");
}

export function independentLeafAuditSeed(
  game,
  actorId,
  actions,
  informationSetHash
) {
  const text = [
    "leaf-audit-v2",
    informationSetHash || "missing-information-set-hash",
    actorId,
    game?.phase,
    game?.turnSequence,
    game?.round,
    ...(actions || []).map(actionKey).sort()
  ].join("|");
  return stableAuditHash(text);
}

function stableAuditHash(text) {
  let state = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return state;
}

export function finalizeTeacherVerification(preliminary, confidence, correctionThreshold) {
  const threshold = Math.max(0, Number(correctionThreshold) || 0);
  const correctionEligible = preliminary?.correctionEligible === true
    && Number(confidence) >= threshold;
  const reasons = [...(preliminary?.reasons || [])];
  if (preliminary?.correctionEligible === true && !correctionEligible
    && !reasons.includes("below-correction-confidence-threshold")) {
    reasons.push("below-correction-confidence-threshold");
  }
  return {
    ...preliminary,
    status: preliminary?.status === "rejected"
      ? "rejected"
      : correctionEligible ? "verified" : "provisional",
    correctionEligible,
    correctionThreshold: threshold,
    reasons
  };
}

export function teacherDecisionConfidence(results, options = {}) {
  const [best, second] = results || [];
  if (!best) return 0;
  if (!second) return clamp01(Math.sqrt(Math.max(1, Number(best.simulations) || 1) / 16));
  const gap = Math.max(0, Number(best.decisionScore) - Number(second.decisionScore));
  const bestInterval = normalizedInterval(best.confidenceInterval, best.expectedWinRate);
  const secondInterval = normalizedInterval(second.confidenceInterval, second.expectedWinRate);
  const meanWidth = ((bestInterval[1] - bestInterval[0]) + (secondInterval[1] - secondInterval[0])) / 2;
  const precision = clamp01(1 - meanWidth);
  const separatedBy = Math.max(0, bestInterval[0] - secondInterval[1]);
  const separationEvidence = clamp01(separatedBy / 0.12);
  const gapEvidence = clamp01(gap / 0.15);
  const simulations = Math.max(1, Math.min(
    Number(best.simulations) || 1,
    Number(second.simulations) || Number(best.simulations) || 1
  ));
  // A two-rollout preference may be directionally useful, but it must not be
  // treated like a well-separated result from a deeper critical-state search.
  const sampleReliability = clamp01(Math.sqrt(simulations / 16));
  const paired = options.pairedEvidence || pairedRolloutDifference(best, second);
  const pairedEvidence = paired.samples > 0 && paired.mean > 0
    ? clamp01(
      Math.max(0, paired.lowerBound) / 0.08 * 0.7
      + Math.max(0, paired.positiveRate - 0.5) * 0.6
    )
    : 0;
  const evaluatorComparison = options.evaluatorComparison || teacherEvaluatorComparison(best, second);
  const modelAgreement = evaluatorComparison.available
    ? evaluatorComparison.conflict
      ? clamp01(1 - evaluatorComparison.deltaDisagreement * 1.5)
      : clamp01(1 - evaluatorComparison.deltaDisagreement * 0.5)
    : clamp01(1 - Math.max(
      Number(best.neuralHeuristicDisagreement) || 0,
      Number(second.neuralHeuristicDisagreement) || 0
    ));
  const terminalEvidence = clamp01(Math.min(
    Number(best.terminalRate) || 0,
    Number(second.terminalRate) || 0
  ));
  const evidence = gapEvidence * 0.2
    + precision * 0.15
    + separationEvidence * 0.2
    + pairedEvidence * 0.35
    + modelAgreement * 0.05
    + terminalEvidence * 0.05;
  return clamp01(Math.min(sampleReliability, sampleReliability * evidence));
}

export function teacherActionVerification(game, actorId, best, alternatives = [], options = {}) {
  if (!best?.action) {
    return {
      status: "rejected",
      correctionEligible: false,
      confidenceCap: 0,
      confidenceMultiplier: 0,
      reasons: ["missing-action"]
    };
  }
  const action = best.action;
  const reasons = [];
  let confidenceCap = 1;
  let confidenceMultiplier = 1;
  let correctionEligible = true;
  const tactical = tacticalActionProfile(game, actorId, action);
  const temporary = temporaryCommitmentProfile(game, actorId, action);
  const temporaryChoice = temporaryChoicePurposeProfile(game, actorId, action);
  const paired = options.pairedEvidence || null;
  const simulations = Math.max(1, Number(options.simulations || best.simulations) || 1);
  const terminalDominance = options.terminalDominance === true;
  const macroVerified = Number(best.initialChoiceRate) > 0
    && best.macroContinuation?.verified === true
    && options.macroDemonstration?.verified === true;
  const directEngineProof = options.immediateProof?.won === true;
  if (!directEngineProof && options.determinizationAudit?.complete !== true) {
    reasons.push("determinization-audit-incomplete");
    confidenceCap = Math.min(confidenceCap, 0.2);
    correctionEligible = false;
  }

  if ((temporary.isTemporaryCommitment && !temporary.clearPurpose)
    || (temporaryChoice.isTemporaryChoice && !temporaryChoice.clearPurpose)) {
    if (!terminalDominance) {
      reasons.push("temporary-effect-without-verified-payoff");
      confidenceCap = 0;
      correctionEligible = false;
    }
  }
  if (Number(best.initialChoiceRate) > 0 && !macroVerified) {
    // A declaration alone does not identify its eventual payment, target, or
    // option. Compare the complete macro before promoting it to a correction.
    reasons.push("unresolved-declaration-continuation");
    confidenceCap = Math.min(confidenceCap, 0.35);
    correctionEligible = false;
  }
  if (!terminalDominance && (best.rolloutEvidenceEligible === false
    || options.selectedAlternative?.rolloutEvidenceEligible === false)) {
    reasons.push("insufficient-valid-rollout-rate");
    confidenceCap = Math.min(confidenceCap, 0.2);
    correctionEligible = false;
  }
  if (tactical.isMovement && !terminalDominance) {
    const saferSubset = alternatives.some((alternative) =>
      isSaferMovementSubset(game, actorId, action, alternative.action));
    if (tactical.sourceControlRisk && saferSubset) {
      reasons.push("movement-overcommitment-has-safer-subset");
      confidenceCap = Math.min(confidenceCap, 0.2);
      correctionEligible = false;
    }
    if (tactical.destinationType === "base" && Number(best.terminalRate) < 0.5) {
      // Returning to base may be excellent setup, but a shallow nonterminal
      // learner rollout cannot prove it. Let actual returns teach the setup.
      reasons.push("nonterminal-regrouping-requires-long-horizon-proof");
      confidenceCap = Math.min(confidenceCap, 0.35);
      correctionEligible = false;
    }
  }
  const evaluatorDisagreement = Math.max(0, Number(best.neuralHeuristicDisagreement) || 0);
  const evaluatorComparison = options.evaluatorComparison
    || teacherEvaluatorComparison(best, options.selectedAlternative);
  const minimumTerminalRate = Math.min(
    Number(best.terminalRate) || 0,
    Number(options.selectedAlternative?.terminalRate) || 0
  );
  const minimumValidRate = Math.min(
    Number(best.validRate) || 0,
    Number(options.selectedAlternative?.validRate) || 0
  );
  const independentEvaluatorAgreement = evaluatorComparison.available === true
    && evaluatorComparison.independent === true
    && evaluatorComparison.independentEvaluatorAgreement === true
    && evaluatorComparison.conflict !== true
    && evaluatorComparison.materialConflict !== true
    && evaluatorComparison.agreesOnDirection === true
    && Number(evaluatorComparison.primaryDelta) > 0
    && Number(evaluatorComparison.independentDelta) >= 0;
  if (evaluatorDisagreement >= 0.2 && !terminalDominance) {
    reasons.push("neural-rule-evaluator-disagreement");
    if (evaluatorComparison.available) {
      confidenceMultiplier *= evaluatorComparison.conflict
        ? clamp01(1 - evaluatorComparison.deltaDisagreement * 1.5)
        : clamp01(1 - evaluatorComparison.deltaDisagreement * 0.35);
      if (!terminalDominance && evaluatorComparison.materialConflict) correctionEligible = false;
    } else {
      confidenceMultiplier *= clamp01(1 - (evaluatorDisagreement - 0.15) * 0.75);
    }
  }
  if (!terminalDominance && Number(best.saturatedLeafRate) >= 0.5 && Number(best.terminalRate) < 0.25) {
    reasons.push("nonterminal-value-saturation");
    confidenceCap = Math.min(confidenceCap, 0.4);
    correctionEligible = false;
  }
  if (options.mulliganMode) {
    const bestPlanDelta = Number(best.mulliganPlan?.expectedDelta) || 0;
    const strongestPlanDelta = Math.max(...alternatives.map((alternative) =>
      Number(alternative.mulliganPlan?.expectedDelta) || 0));
    if (strongestPlanDelta - bestPlanDelta >= 0.04 && Number(best.terminalRate) < 0.5) {
      reasons.push("mulligan-search-conflicts-with-deck-curve-evidence");
      confidenceCap = Math.min(confidenceCap, 0.25);
      correctionEligible = false;
    }
  }
  const minimumPairedSamples = independentEvaluatorAgreement ? 8 : 16;
  if (!terminalDominance && (!paired
    || paired.samples < minimumPairedSamples
    || paired.lowerBound <= 0)) {
    reasons.push("paired-improvement-not-proven");
    correctionEligible = false;
  }
  if (!terminalDominance && simulations < minimumPairedSamples) {
    reasons.push("insufficient-search-samples");
    correctionEligible = false;
  }
  if (!terminalDominance && !independentEvaluatorAgreement
    && (minimumValidRate < 0.75 || minimumTerminalRate < 0.75)) {
    // A longer rollout using the same leaf evaluator is not independent
    // evidence. Tier-B policy labels require either predominantly terminal
    // outcomes or agreement from a distinct frozen evaluator.
    reasons.push("independent-tier-b-evidence-missing");
    correctionEligible = false;
  }
  return {
    status: confidenceCap <= 0 ? "rejected" : correctionEligible ? "verified" : "provisional",
    correctionEligible,
    confidenceCap: clamp01(confidenceCap),
    confidenceMultiplier: clamp01(confidenceMultiplier),
    reasons,
    pairedEvidence: paired,
    evaluatorDisagreement,
    evaluatorComparison,
    minimumValidRate,
    minimumTerminalRate,
    independentEvaluatorAgreement,
    proofKind: options.terminalProofKind
      || (macroVerified ? "verified-declaration-macro"
        : paired?.lowerBound > 0 ? "paired-rollout-improvement" : null),
    immediateProof: options.immediateProof || null,
    macroVerified
  };
}

export function teacherEvaluatorComparison(best, selected) {
  if (!best || !selected) {
    return {
      available: false,
      independent: false,
      neuralDelta: 0,
      heuristicDelta: 0,
      ensembleDelta: 0,
      deltaDisagreement: 1,
      conflict: false,
      materialConflict: false
    };
  }
  const bestNeural = Number(best.neuralLeafWinRate ?? best.expectedWinRate);
  const selectedNeural = Number(selected.neuralLeafWinRate ?? selected.expectedWinRate);
  const bestHeuristic = Number(best.heuristicLeafWinRate);
  const selectedHeuristic = Number(selected.heuristicLeafWinRate);
  // Policy comparison uses the certified action-Q head on the immediate
  // post-action information state. The state-value head remains the cutoff
  // evaluator for deeper continuation leaves.
  const bestIndependent = Number(
    best.independentEvaluatorPolicyCorrectionActionQWinRate
      ?? best.independentEvaluatorActionQWinRate
      ?? best.independentEvaluatorLeafWinRate
  );
  const selectedIndependent = Number(
    selected.independentEvaluatorPolicyCorrectionActionQWinRate
      ?? selected.independentEvaluatorActionQWinRate
      ?? selected.independentEvaluatorLeafWinRate
  );
  const bestIndependentByModel =
    best.independentEvaluatorPolicyCorrectionActionQWinRatesByModel
      || best.independentEvaluatorActionQWinRatesByModel
      || best.independentEvaluatorLeafWinRatesByModel
      || [];
  const selectedIndependentByModel =
    selected.independentEvaluatorPolicyCorrectionActionQWinRatesByModel
      || selected.independentEvaluatorActionQWinRatesByModel
      || selected.independentEvaluatorLeafWinRatesByModel
      || [];
  const policyCorrectionEligible =
    best.independentEvaluatorPolicyCorrectionEligible === true
    && selected.independentEvaluatorPolicyCorrectionEligible === true;
  if (![bestNeural, selectedNeural, bestHeuristic, selectedHeuristic,
    bestIndependent, selectedIndependent].every(Number.isFinite)
    || (best.independentEvaluatorActionQAvailable !== true
      && best.independentEvaluatorAvailable !== true)
    || (selected.independentEvaluatorActionQAvailable !== true
      && selected.independentEvaluatorAvailable !== true)) {
    return {
      available: false,
      independent: false,
      neuralDelta: 0,
      heuristicDelta: 0,
      ensembleDelta: 0,
      deltaDisagreement: 1,
      conflict: false,
      materialConflict: false
    };
  }
  const neuralDelta = bestNeural - selectedNeural;
  const heuristicDelta = bestHeuristic - selectedHeuristic;
  const independentDelta = bestIndependent - selectedIndependent;
  const independentEvaluatorDeltas = Array.from({
    length: Math.min(bestIndependentByModel.length, selectedIndependentByModel.length)
  }, (_, index) =>
    Number(bestIndependentByModel[index]) - Number(selectedIndependentByModel[index]))
    .filter(Number.isFinite);
  if (!independentEvaluatorDeltas.length && Number.isFinite(independentDelta)) {
    independentEvaluatorDeltas.push(independentDelta);
  }
  const bestEnsemble = Number(best.ensembleLeafWinRate);
  const selectedEnsemble = Number(selected.ensembleLeafWinRate);
  const ensembleDelta = Number.isFinite(bestEnsemble) && Number.isFinite(selectedEnsemble)
    ? bestEnsemble - selectedEnsemble
    : null;
  const deltas = [
    neuralDelta,
    heuristicDelta,
    ...independentEvaluatorDeltas,
    ensembleDelta
  ].filter(Number.isFinite);
  const positive = deltas.filter((value) => value > 0);
  const negative = deltas.filter((value) => value < 0);
  const conflict = positive.length > 0 && negative.length > 0;
  const deltaDisagreement = Math.min(1, Math.max(...deltas) - Math.min(...deltas));
  const materialOpposition = conflict
    ? Math.min(
      Math.max(...positive.map(Math.abs)),
      Math.max(...negative.map(Math.abs))
    )
    : 0;
  return {
    available: true,
    independent: true,
    primaryDelta: neuralDelta,
    independentDelta,
    independentEvaluatorDeltas,
    policyCorrectionEligible,
    independentEvaluatorAgreement: policyCorrectionEligible
      && independentEvaluatorDeltas.length > 0
      && independentEvaluatorDeltas.every((value) =>
        value === 0
          || Math.sign(value) === Math.sign(
            independentEvaluatorDeltas.find((item) => item !== 0) || 0
          )),
    neuralDelta,
    heuristicDelta,
    ensembleDelta,
    evaluatorSpread: Math.max(Number(best.evaluatorSpread) || 0, Number(selected.evaluatorSpread) || 0),
    deltaDisagreement,
    conflict,
    materialConflict: conflict && materialOpposition >= 0.05,
    agreesOnDirection: !conflict && deltas.every((value) =>
      value === 0 || Math.sign(value) === Math.sign(deltas.find((item) => item !== 0) || 0))
  };
}

function teacherCorrectionAlternativeKeys(game, actorId, results, selected, options = {}) {
  if (!options.correctionEligible || !selected) return [];
  const selectedKey = actionKey(selected.action);
  if (options.terminalDominance) {
    const engineProven = results
      .filter((alternative) => actionKey(alternative.action) !== selectedKey
        && proveImmediateActionOutcome(game, actorId, alternative.action).won)
      .map((alternative) => actionKey(alternative.action));
    if (engineProven.length) return engineProven;
  }
  // Screen samples select a candidate but do not certify it. Only the action
  // that passed the independent confirmation bank can become a correction
  // target; other shortlisted actions remain value diagnostics.
  return options.confirmedActionKey && options.confirmedActionKey !== selectedKey
    ? [options.confirmedActionKey]
    : [];
}

export function teacherPlanningProfile(game, actorId, options = {}) {
  const player = game.players?.find((candidate) => candidate.id === actorId);
  const cards = player ? [
    ...(player.mainDeck || []),
    ...(player.hand || []),
    ...(player.base || []),
    ...(player.trash || []),
    ...(player.banished || []),
    player.champion
  ].filter((card) => Number(card?.energy) > 0) : [];
  const averageEnergy = cards.length ? cards.reduce((sum, card) => sum + Number(card.energy || 0), 0) / cards.length : 0;
  const resourceCapacity = (player?.runes?.length || 0) + 1;
  const curvePressure = clamp01((averageEnergy - 2.6) / 1.8);
  const developmentPressure = clamp01((averageEnergy / Math.max(1, resourceCapacity) - 0.8) / 1.6);
  const planningPressure = Math.min(1, curvePressure * 0.6 + developmentPressure * 0.65);
  const response = opponentResponseProfile(game, actorId, options.model || DEFAULT_AI_MODEL);
  const responsePressure = Math.min(1, response.expectedThreat);
  const uncertainty = clamp01(options.uncertainty || 0);
  const victoryScore = Math.max(1, Number(game.victoryScore) || 8);
  const opponent = game.players?.find((candidate) => candidate.id !== actorId);
  const scoreLeverage = Math.max(Number(player?.score) || 0, Number(opponent?.score) || 0) / victoryScore;
  const tacticalLeverage = options.critical || game.pendingChoice || game.phase === "showdown" || game.actionChain ? 1 : 0;
  const decisionLeverage = clamp01(tacticalLeverage * 0.45 + scoreLeverage * 0.25 + uncertainty * 0.45 + responsePressure * 0.25);
  const baseDepth = Math.max(2, options.depth || 6);
  const baseSimulations = Math.max(1, options.simulations || 1);
  const baseCandidates = Math.max(2, options.maxCandidates || 3);
  return {
    averageEnergy,
    resourceCapacity,
    planningPressure,
    opponentResponseProbability: response.responseProbability,
    responsePressure,
    uncertainty,
    decisionLeverage,
    depth: Math.min(96, Math.ceil(baseDepth * (1 + planningPressure * 0.7 + responsePressure * 0.35 + decisionLeverage * 1.1))),
    simulations: Math.min(16, baseSimulations
      + Math.ceil(uncertainty * 4)
      + Math.ceil(decisionLeverage * 3)
      + (planningPressure >= 0.5 ? 1 : 0)),
    maxCandidates: Math.min(24, baseCandidates
      + Math.ceil(uncertainty * 6)
      + Math.ceil(decisionLeverage * 6)
      + (planningPressure >= 0.5 ? 2 : 0)
      + (responsePressure >= 0.35 ? 2 : 0)),
    minimumTurnTransitions: decisionLeverage >= 0.45 ? 1 : 0
  };
}

export function strategicActionResourceDemand(game, actorId, action) {
  if (!action || ["endTurn", "passShowdown", "declineEffectChoice"].includes(action.kind)) return 0;
  const player = game.players.find((candidate) => candidate.id === actorId);
  const cardId = action.cardId || action.unitId || action.unitIds?.[0];
  const cards = [
    player?.legend, player?.champion, ...(player?.hand || []), ...(player?.base || []),
    ...game.battlefields.flatMap((field) => [...(field.units || []), ...(field.hidden || []).map((item) => item.card)])
  ].filter(Boolean);
  const card = cards.find((candidate) => candidate.instanceId === cardId)
    || (action.kind === "beginPlayChampion" ? player?.champion : null);
  const cardDemand = Math.max(0, Number(card?.energy) || 0)
    + (Array.isArray(card?.power) ? card.power : []).reduce((sum, requirement) => sum + Math.max(0, Number(requirement.amount) || 0), 0) * 0.6;
  if (action.kind !== "activateCard") return cardDemand;
  const abilityId = String(action.abilityId || "").split(":").at(-1);
  const effects = (card?.effects || []).filter((effect, index) => (effect.abilityId || `effect-${index}`) === abilityId);
  return effects.reduce((sum, effect) => sum
    + Math.max(0, Number(effect.energyCost) || 0)
    + (Array.isArray(effect.powerCost) ? effect.powerCost : []).reduce((power, requirement) => power + Math.max(0, Number(requirement.amount) || 0) * 0.6, 0), 0);
}

function diverseTeacherCandidates(game, actorId, ranked, strategic, requiredActions, maximum) {
  const output = new Map();
  const add = (action) => {
    if (action && output.size < maximum) output.set(actionKey(action), action);
  };
  add(ranked[0]?.action);
  for (const action of requiredActions || []) add(action);
  for (const action of strategic) if (action.kind === "endTurn" || action.kind === "passShowdown") add(action);
  const byDemand = [...strategic].sort((left, right) => strategicActionResourceDemand(game, actorId, right)
    - strategicActionResourceDemand(game, actorId, left)
    || actionKey(left).localeCompare(actionKey(right)));
  add(byDemand[0]);
  add(byDemand.at(-1));
  const representedKinds = new Set([...output.values()].map((action) => action.kind));
  for (const item of ranked) {
    if (output.size >= maximum) break;
    if (representedKinds.has(item.action.kind)) continue;
    add(item.action);
    representedKinds.add(item.action.kind);
  }
  for (const item of ranked) {
    if (output.size >= maximum) break;
    add(item.action);
  }
  return output;
}

function compareTeacherAlternatives(left, right) {
  return right.decisionScore - left.decisionScore
    || right.expectedWinRate - left.expectedWinRate
    || actionKey(left.action).localeCompare(actionKey(right.action));
}

function shouldExpandTeacherSearch(results, requiredAction, profile, targetSimulations) {
  const [best] = results || [];
  if (!best || Number(best.simulations) >= targetSimulations) return false;
  const selected = requiredAction
    ? results.find((item) => actionKey(item.action) === actionKey(requiredAction))
    : null;
  if (!selected || actionKey(selected.action) === actionKey(best.action)) return false;
  const regret = Math.max(0, Number(best.decisionScore) - Number(selected.decisionScore));
  if (targetSimulations <= 8) return regret >= 0.04
    || (profile.decisionLeverage >= 0.55 && regret >= 0.02);
  const paired = pairedRolloutDifference(best, selected);
  return regret >= 0.1 && paired.lowerBound <= 0.04;
}

function teacherSearchShortlist(results, requiredAction, configuredMaximum) {
  const maximum = Math.max(2, Math.min(6, configuredMaximum || 6));
  const output = new Map();
  const add = (item) => {
    if (item?.action && output.size < maximum) output.set(actionKey(item.action), item.action);
  };
  for (const item of results.slice(0, 3)) add(item);
  if (requiredAction) add({ action: requiredAction });
  add(results.find((item) => ["endTurn", "passShowdown", "declineEffectChoice"].includes(item.action?.kind)));
  for (const item of results) add(item);
  return [...output.values()];
}

function isSaferMovementSubset(game, actorId, action, alternative) {
  if (!["moveUnit", "moveUnits"].includes(action?.kind)
    || !["moveUnit", "moveUnits"].includes(alternative?.kind)
    || action.destinationId !== alternative.destinationId) return false;
  const actionIds = movementUnitIds(action);
  const alternativeIds = movementUnitIds(alternative);
  if (alternativeIds.length >= actionIds.length
    || !alternativeIds.every((unitId) => actionIds.includes(unitId))) return false;
  const selectedProfile = movementProfile(game, actorId, action);
  const alternativeProfile = movementProfile(game, actorId, alternative);
  if (alternativeProfile.sourceControlRisk) return false;
  if (selectedProfile.destinationType === "battlefield") {
    return alternativeProfile.canRemoveEnemyNoResponse === selectedProfile.canRemoveEnemyNoResponse
      && alternativeProfile.controlGain === selectedProfile.controlGain
      && alternativeProfile.projectedFieldAdvantage >= selectedProfile.projectedFieldAdvantage;
  }
  return selectedProfile.destinationType === "base";
}

function movementUnitIds(action) {
  return action?.kind === "moveUnits"
    ? [...new Set(action.unitIds || [])]
    : action?.unitId ? [action.unitId] : [];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizedInterval(interval, fallback) {
  const center = clamp01(Number(fallback) || 0);
  if (!Array.isArray(interval) || interval.length < 2) return [center, center];
  const low = clamp01(Number(interval[0]));
  const high = clamp01(Number(interval[1]));
  return low <= high ? [low, high] : [high, low];
}
