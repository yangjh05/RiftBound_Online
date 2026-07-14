import { createGame } from "../../engine.mjs";
import { activeActorId, applyAiAction, enumerateLegalActions, actionKey, planPaymentActions } from "../actions.mjs";
import { DEFAULT_AI_MODEL, evaluateState, scoreActions } from "../policy.mjs";
import { ACTION_DIM, encodeActionSet, encodeOpponentDeckTarget, encodeState } from "./encoding.mjs";
import { NEURAL_HIDDEN_SIZE } from "./model.mjs";

export function collectBaselineImitation(options) {
  const trajectories = [];
  const summaries = [];
  const random = options.random || Math.random;
  const targetGames = Math.max(1, options.games || 32);
  const maxAttempts = Math.max(targetGames, options.maxAttempts || targetGames * 2);
  let completed = 0;
  for (let attempt = 0; attempt < maxAttempts && completed < targetGames; attempt += 1) {
    const pair = pickPair(options.decks, random, options.meta, options.metaFraction ?? 0.7);
    const gameNumber = (options.gameOffset || 0) + attempt;
    const gameId = `baseline-${gameNumber}`;
    const game = createGame({ decks: pair, firstPlayerId: gameNumber % 2 ? "p2" : "p1", interactive: true, manualActionChainPriority: true });
    const stepsByPlayer = new Map(game.players.map((player) => [player.id, []]));
    let actionCount = 0;
    let failure = null;
    let intentTurnSequence = game.turnSequence;
    const attemptedIntents = new Set();
    let paymentPlan = [];
    for (; actionCount < (options.maxActions || 640) && game.phase !== "complete"; actionCount += 1) {
      const actorId = activeActorId(game);
      const legal = actorId ? enumerateLegalActions(game, actorId) : [];
      if (!actorId || !legal.length) { failure = "no-legal-action"; break; }
      if (game.turnSequence !== intentTurnSequence) {
        intentTurnSequence = game.turnSequence;
        attemptedIntents.clear();
      }
      const freshLegal = legal.filter((action) => !isRepeatableIntent(action) || !attemptedIntents.has(`${actorId}:${actionKey(action)}`));
      const teacherLegal = freshLegal.length ? freshLegal : legal;
      let ranked = scoreActions(game, actorId, teacherLegal, options.baseline || DEFAULT_AI_MODEL);
      if (game.pendingPayment) {
        if (!paymentPlan.length) paymentPlan = planPaymentActions(game) || [{ kind: "cancelPayment" }];
        const plannedKey = actionKey(paymentPlan[0]);
        const plannedIndex = ranked.findIndex((item) => item.key === plannedKey);
        if (plannedIndex >= 0) {
          const [planned] = ranked.splice(plannedIndex, 1);
          planned.score = Math.max(planned.score, (ranked[0]?.score || 0) + 12);
          ranked.unshift(planned);
        } else {
          paymentPlan = [];
        }
      } else {
        paymentPlan = [];
      }
      const selected = ranked[0];
      const actionSet = encodeActionSet(game, actorId, legal, { requiredActions: [selected?.action] });
      const selectedIndex = actionSet.actions.findIndex((action) => actionKey(action) === selected?.key);
      if (!selected || selectedIndex < 0) { failure = "teacher-selection-failed"; break; }
      const confidence = teacherConfidence(ranked);
      if (isRepeatableIntent(selected.action)) attemptedIntents.add(`${actorId}:${selected.key}`);
      stepsByPlayer.get(actorId).push({
        state: encodeState(game, actorId),
        actions: actionSet.encoded.slice(0, actionSet.legalCount * ACTION_DIM),
        selectedIndex,
        legalCount: actionSet.legalCount,
        oldLogProbability: 0,
        value: evaluateState(game, actorId, options.baseline || DEFAULT_AI_MODEL),
        beliefTarget: encodeOpponentDeckTarget(game, actorId),
        initialMemory: new Float32Array(NEURAL_HIDDEN_SIZE),
        advantage: confidence,
        return: 0,
        teacherConfidence: confidence,
        selectedKind: selected.action.kind,
        originalLegalCount: actionSet.originalLegalCount,
        actionSetTruncated: actionSet.truncated,
        imitation: true
      });
      if (!applyAiAction(game, selected.action, actorId)?.ok) { failure = "teacher-action-failed"; break; }
      if (paymentPlan.length && selected.key === actionKey(paymentPlan[0])) paymentPlan.shift();
    }
    const didComplete = game.phase === "complete" && Boolean(game.winnerId);
    summaries.push({
      gameId, completed: didComplete, capped: !didComplete && actionCount >= (options.maxActions || 640),
      actions: actionCount, turns: game.turnNumber || 0, winnerId: game.winnerId || null,
      deckIds: pair.map((deck) => deck.id), firstPlayerId: gameNumber % 2 ? "p2" : "p1",
      truncatedSteps: [...stepsByPlayer.values()].flat().filter((step) => step.actionSetTruncated).length,
      maxLegalActions: Math.max(0, ...[...stepsByPlayer.values()].flat().map((step) => step.originalLegalCount || 0)),
      actionKinds: countValues([...stepsByPlayer.values()].flat().map((step) => step.selectedKind)),
      deckByPlayer: Object.fromEntries(game.players.map((player, index) => [player.id, pair[index]?.id || null])),
      failure
    });
    if (didComplete || options.includeTruncated) {
      for (const player of game.players) {
        const reward = didComplete ? (player.id === game.winnerId ? 1 : -1) : 0;
        const steps = stepsByPlayer.get(player.id);
        for (const step of steps) step.return = reward;
        if (steps.length) trajectories.push({ gameId, playerId: player.id, imitation: true, completed: didComplete, steps });
      }
    }
    if (didComplete) completed += 1;
    options.onProgress?.({ attempted: attempt + 1, completed, targetGames, last: summaries.at(-1) });
  }
  return { trajectories, summaries, completedGames: completed, attemptedGames: summaries.length, targetGames };
}

export function weightedDeckPick(decks, random, meta = null, metaFraction = 0.7) {
  const fraction = Math.max(0, Math.min(1, metaFraction));
  const uniform = 1 / Math.max(1, decks.length);
  const weights = decks.map((deck) => (1 - fraction) * uniform + fraction * Math.max(0, meta?.deckWeights?.[deck.id] || 0));
  let roll = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < decks.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return decks[index];
  }
  return decks.at(-1);
}

function pickPair(decks, random, meta, metaFraction) {
  const first = weightedDeckPick(decks, random, meta, metaFraction);
  const remaining = decks.filter((deck) => deck !== first);
  const second = weightedDeckPick(remaining.length ? remaining : decks, random, meta, metaFraction);
  return [first, second];
}

function teacherConfidence(ranked) {
  if (ranked.length <= 1) return 1;
  const margin = Math.max(0, ranked[0].score - ranked[1].score);
  return Math.max(0.25, Math.min(1, 1 / (1 + Math.exp(-margin))));
}

function countValues(values) { const counts = {}; for (const value of values) counts[value] = (counts[value] || 0) + 1; return counts; }
function isRepeatableIntent(action) { return ["beginPlayCard", "beginPlayChampion", "hideCard", "activateCard"].includes(action?.kind); }
