import {
  activeActorId,
  actionKey,
  applyAiAction,
  cloneGame,
  enumerateCommandCandidates,
  planPaymentActions
} from "./actions.mjs";
import { DEFAULT_AI_MODEL, evaluateState } from "./policy.mjs";
import { reactionReserveProfile, resourceSourceOpportunityCost } from "./resource-strategy.mjs";

const PAYMENT_PLAN_KINDS = new Set([
  "activateCard",
  "togglePaymentRune",
  "togglePaymentPoolEnergy",
  "togglePaymentPoolPower",
  "toggleOptionalPaymentEffect"
]);

export function isMechanicalPaymentAction(action) {
  return [
    "togglePaymentRune",
    "togglePaymentPoolEnergy",
    "togglePaymentPoolPower",
    "confirmPayment"
  ].includes(action?.kind);
}

// Payment plans are produced by executing the engine's real commands on cloned
// games. This deliberately does not duplicate Rune matching, generated-resource
// or optional-cost rules in the AI layer.
export function enumeratePaymentPlans(source, options = {}) {
  const actorId = source?.pendingPayment?.playerId || activeActorId(source);
  if (!actorId || !source?.pendingPayment) return [];
  const maxPlans = Math.max(1, options.maxPlans || 64);
  const maxNodes = Math.max(maxPlans, options.maxNodes || 4096);
  const maxSteps = Math.max(1, options.maxSteps || 24);
  const queue = [{ game: cloneGame(source), actions: [] }];
  const visited = new Set([pendingPaymentKey(queue[0].game)]);
  const outcomes = new Map();
  let exploredNodes = 0;

  while (queue.length && exploredNodes < maxNodes && outcomes.size < maxPlans) {
    // Payment state grows roughly as three choices per Rune (unused, Energy,
    // Power). Breadth-first search spends most of its budget enumerating
    // incomplete shallow subsets before it reaches a single payable outcome.
    // The AI needs a small set of complete alternatives, so depth-first search
    // reaches those outcomes far sooner while the visited-state key still
    // prevents toggle cycles.
    const node = options.depthFirst ? queue.pop() : queue.shift();
    exploredNodes += 1;
    const confirmed = cloneGame(node.game);
    const confirmation = applyAiAction(confirmed, { kind: "confirmPayment" }, actorId);
    if (confirmation?.ok) {
      const actions = [...node.actions, { kind: "confirmPayment" }];
      const key = paymentOutcomeKey(confirmed, actorId);
      const existing = outcomes.get(key);
      if (!existing || actions.length < existing.actions.length) outcomes.set(key, { actions, game: confirmed, outcomeKey: key });
      // A complete payment never benefits from toggling resources off and on
      // again. Stopping this branch also keeps enumeration proportional to the
      // number of complete allocations instead of every selection permutation.
      continue;
    }
    if (node.actions.length >= maxSteps) continue;

    const payingPlayer = node.game.players.find((player) => player.id === actorId);
    const directRuneIds = new Set((payingPlayer?.runes || []).map((rune) => rune.instanceId));
    const candidates = enumerateCommandCandidates(node.game, actorId)
      .filter((action) => PAYMENT_PLAN_KINDS.has(action.kind))
      .filter((action) => options.allowResourceActivations !== false || action.kind !== "activateCard")
      // Basic Rune ADD abilities are the same direct Energy/Power payment
      // represented by togglePaymentRune. Exploring both would manufacture
      // duplicate resource states and an exponential number of fake plans.
      .filter((action) => action.kind !== "activateCard" || !directRuneIds.has(action.cardId));
    for (const action of candidates) {
      const next = cloneGame(node.game);
      if (!applyAiAction(next, action, actorId)?.ok || !next.pendingPayment || next.pendingChoice) continue;
      const key = pendingPaymentKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ game: next, actions: [...node.actions, action] });
    }
  }
  return [...outcomes.values()].map((plan) => ({
    ...plan,
    score: scorePaymentOutcome(source, plan.game, actorId, options)
  })).sort((left, right) => right.score - left.score
    || left.actions.length - right.actions.length
    || planKey(left.actions).localeCompare(planKey(right.actions)));
}

export function choosePaymentPlan(source, options = {}) {
  // Paying a printed cost is mechanical: spend already-generated pool
  // resources first, satisfy colored Power, then use any ready Runes for
  // colorless Energy. Rune color does not change Energy and exhausted Runes
  // remain usable for later Power, so neural comparison of thousands of
  // equivalent allocations only wastes self-play time.
  const direct = greedyPaymentPlan(source, options, { allowResourceActivations: false });
  if (direct) return direct;
  // Only activate a Legend/Seal resource source when the existing pool and
  // Basic Runes cannot complete the payment. Execution replans immediately
  // after the authoritative generated resource ids exist.
  return fastestResourceActivation(source, options) || greedyPaymentPlan(source, options);
}

function fastestResourceActivation(source, options) {
  const actorId = source?.pendingPayment?.playerId || activeActorId(source);
  const player = source?.players?.find((candidate) => candidate.id === actorId);
  if (!actorId || !player) return [];
  const directRuneIds = new Set((player.runes || []).map((rune) => rune.instanceId));
  const maxBranches = Math.max(1, options.maxResourceBranches || 8);
  const actions = enumerateCommandCandidates(source, actorId)
    .filter((action) => action.kind === "activateCard" && !directRuneIds.has(action.cardId))
    .slice(0, maxBranches);
  const plans = [];
  for (const action of actions) {
    const branch = cloneGame(source);
    if (!applyAiAction(branch, action, actorId)?.ok || !branch.pendingPayment || branch.pendingChoice) continue;
    const beforePlayer = source.players.find((candidate) => candidate.id === actorId);
    const afterPlayer = branch.players.find((candidate) => candidate.id === actorId);
    const gainedEnergy = Math.max(0, (afterPlayer?.runePool?.energy?.length || 0) - (beforePlayer?.runePool?.energy?.length || 0));
    const gainedPower = Math.max(0, (afterPlayer?.runePool?.power?.length || 0) - (beforePlayer?.runePool?.power?.length || 0));
    const opportunity = resourceSourceOpportunityCost(source, branch, actorId);
    plans.push({
      actions: [action],
      game: branch,
      outcomeKey: pendingPaymentKey(branch),
      score: gainedEnergy * 0.12 + gainedPower * 0.1 - opportunity,
      resourceActivation: true
    });
  }
  return plans.sort(comparePlans)[0] || null;
}

export function executePaymentPlan(game, plan, actorId = game?.pendingPayment?.playerId || activeActorId(game)) {
  if (!plan?.actions?.length || !actorId) return { ok: false, message: "No complete payment plan is available.", actionsApplied: 0 };
  let actionsApplied = 0;
  for (const action of plan.actions) {
    const result = applyAiAction(game, action, actorId);
    if (!result?.ok) return { ...result, actionsApplied, failedAction: action };
    actionsApplied += 1;
    // ADD abilities allocate generated resource ids while resolving. Ids seen
    // in an exploratory clone are intentionally not authoritative. Execute
    // the ability itself, then let resolvePlannedPayment build a fresh plan
    // against the ids that now exist in the real game.
    if (action.kind === "activateCard" && game.pendingPayment) {
      return { ok: true, complete: false, actionsApplied, replan: true, planScore: plan.score };
    }
  }
  return { ok: true, complete: !game.pendingPayment, actionsApplied, planScore: plan.score, outcomeKey: plan.outcomeKey };
}

export function resolvePlannedPayment(game, options = {}) {
  const plans = [];
  let actionsApplied = 0;
  const maxWindows = Math.max(1, options.maxWindows || 8);
  while (game?.pendingPayment && plans.length < maxWindows) {
    const actorId = game.pendingPayment.playerId || activeActorId(game);
    const plan = choosePaymentPlan(game, options);
    if (!plan) {
      // A declaration choice can change a previously payable card into an
      // unpayable one (for example, declining an optional additional cost
      // which would have ignored the base cost). Roll the pending intent back
      // through the engine instead of manufacturing resources or aborting the
      // entire self-play game. The strategic choice still receives the
      // resulting negative trajectory signal.
      const cancelled = applyAiAction(game, { kind: "cancelPayment" }, actorId);
      if (cancelled?.ok) return { ok: true, complete: true, cancelled: true, actorId, actionsApplied: actionsApplied + 1, plans };
      return { ok: false, message: "No complete payment plan is available.", actorId, actionsApplied, plans };
    }
    const executed = executePaymentPlan(game, plan, actorId);
    actionsApplied += executed.actionsApplied || 0;
    plans.push(plan);
    if (!executed.ok) return { ...executed, actorId, actionsApplied, plans };
  }
  if (game?.pendingPayment) return { ok: false, message: "Payment continuation exceeded the safety limit.", actorId: game.pendingPayment.playerId, actionsApplied, plans };
  return { ok: true, complete: true, actorId: plans[0]?.game?.pendingPayment?.playerId || null, actionsApplied, plan: plans[0], plans };
}

function scorePaymentOutcome(before, after, actorId, options = {}) {
  const playerBefore = before.players.find((player) => player.id === actorId);
  const playerAfter = after.players.find((player) => player.id === actorId);
  if (!playerBefore || !playerAfter) return -Infinity;
  const heuristicModel = options.model?.valueWeights ? options.model : DEFAULT_AI_MODEL;
  const stateValue = evaluateState(after, actorId, heuristicModel);
  const flexibility = resourceFlexibility(playerAfter);
  const reserve = reactionReserveProfile(after, actorId);
  const readyRunes = playerAfter.runes.filter((rune) => !rune.exhausted).length;
  const retainedRunes = playerAfter.runes.length;
  const durableSpent = Math.max(0, playerBefore.runes.length - retainedRunes);
  const readySpent = Math.max(0, playerBefore.runes.filter((rune) => !rune.exhausted).length - readyRunes);
  const poolBefore = (playerBefore.runePool?.energy?.length || 0) + (playerBefore.runePool?.power?.length || 0);
  const poolAfter = (playerAfter.runePool?.energy?.length || 0) + (playerAfter.runePool?.power?.length || 0);
  const expiringPoolSpent = Math.max(0, poolBefore - poolAfter);
  const sourceOpportunity = resourceSourceOpportunityCost(before, after, actorId);
  const reserveWeight = 0.1 + Math.min(0.18, reserve.threat * 0.12);
  return stateValue * 8
    + flexibility * 0.45
    + reserve.reserveValue * reserveWeight
    + readyRunes * 0.08
    + expiringPoolSpent * 0.06
    - sourceOpportunity
    - durableSpent * 0.12
    - readySpent * 0.03;
}

function resourceFlexibility(player) {
  const ready = player.runes.filter((rune) => !rune.exhausted);
  const poolEnergy = player.runePool?.energy?.length || 0;
  const poolPower = player.runePool?.power || [];
  let score = 0;
  for (const card of player.hand || []) {
    const power = card.power || [];
    const powerAmount = power.reduce((sum, requirement) => sum + Math.max(0, Number(requirement.amount) || 0), 0);
    const matching = power.reduce((sum, requirement) => {
      const available = ready.filter((rune) => runeMatchesRequirement(rune, requirement)).length
        + poolPower.filter((resource) => runeMatchesRequirement(resource, requirement)).length;
      return sum + Math.min(Math.max(0, Number(requirement.amount) || 0), available);
    }, 0);
    const totalResources = ready.length + poolEnergy + poolPower.length;
    if (matching >= powerAmount && totalResources >= Math.max(0, Number(card.energy) || 0) + powerAmount) score += 1;
    else score += Math.min(0.5, totalResources / Math.max(1, (Number(card.energy) || 0) + powerAmount) * 0.35);
  }
  return score;
}

function runeMatchesRequirement(resource, requirement) {
  const required = String(requirement?.domain || requirement?.color || requirement?.type || "").toLowerCase();
  if (!required || required === "any" || required === "generic") return true;
  const actual = String(resource?.domain || resource?.color || resource?.type || "").toLowerCase();
  return actual === required;
}

function pendingPaymentKey(game) {
  const payment = game.pendingPayment;
  const player = game.players.find((candidate) => candidate.id === payment?.playerId);
  return JSON.stringify({
    payment: payment ? {
      source: payment.source,
      energyCost: payment.energyCost,
      powerCost: payment.powerCost,
      energyRuneIds: [...(payment.energyRuneIds || [])].sort(),
      powerRuneIds: [...(payment.powerRuneIds || [])].sort(),
      poolEnergyIds: [...(payment.poolEnergyIds || [])].sort(),
      poolPowerIds: [...(payment.poolPowerIds || [])].sort(),
      optional: (payment.optionalPowerEffects || payment.optionalEffects || []).map((effect) => [effect.id, Boolean(effect.selected)])
    } : null,
    runes: (player?.runes || []).map((rune) => [rune.instanceId, rune.zone, Boolean(rune.exhausted)]),
    pools: player?.runePool || null,
    chain: game.actionChain?.chain?.length || 0
  });
}

function paymentOutcomeKey(game, actorId) {
  const clone = cloneGame(game);
  delete clone.log;
  delete clone.aiDecisionContext;
  delete clone.aiDeclinedIntents;
  // Random function identity and diagnostic clocks do not make payment plans
  // strategically different.
  delete clone.random;
  delete clone.updatedAt;
  return `${actorId}:${JSON.stringify(clone)}`;
}

function planKey(actions) {
  return actions.map(actionKey).join("|");
}

function comparePlans(left, right) {
  return right.score - left.score
    || left.actions.length - right.actions.length
    || planKey(left.actions).localeCompare(planKey(right.actions));
}

function greedyPaymentPlan(source, options, plannerOptions = {}) {
  const game = cloneGame(source);
  const actorId = game.pendingPayment?.playerId;
  const actions = [];
  for (let iteration = 0; iteration < 16 && game.pendingPayment; iteration += 1) {
    const next = planPaymentActions(game, plannerOptions);
    if (!next?.length) return null;
    for (const action of next) {
      if (!applyAiAction(game, action, actorId)?.ok) return null;
      actions.push(action);
      if (action.kind === "confirmPayment") {
        const outcomeKey = paymentOutcomeKey(game, actorId);
        return { actions, game, outcomeKey, score: scorePaymentOutcome(source, game, actorId, options), fallback: true };
      }
    }
  }
  return null;
}
