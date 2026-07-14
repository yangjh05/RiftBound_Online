import { actionKey, applyAiAction, cloneGame, enumerateLegalActions } from "./actions.mjs";
import { observeGame } from "./observation.mjs";
import { DEFAULT_AI_MODEL, evaluateState, scoreActions } from "./policy.mjs";
import { buildMatchupDeckPlan, metaCardLeaderboard, recommendDeckChanges } from "./deckbuilding.mjs";
import { rolloutAlternatives } from "./rollout.mjs";

export function analyzeDecision(game, actorId, selectedAction, model = DEFAULT_AI_MODEL, options = {}) {
  const legal = options.legalActions || enumerateLegalActions(game, actorId);
  if (!legal.length) return null;
  const policyScores = new Map(scoreActions(game, actorId, legal, model).map((item) => [item.key, item.score]));
  const before = observeGame(game, actorId);
  const evaluated = legal.map((action) => evaluateAlternative(game, before, actorId, action, policyScores.get(actionKey(action)) || 0, model));
  if (options.rollouts > 0) {
    const rolloutResults = new Map(rolloutAlternatives(game, actorId, legal, model, {
      simulations: options.rollouts,
      depth: options.rolloutDepth || 32,
      random: options.random,
      neuralModel: options.neuralModel
    }).map((item) => [actionKey(item.action), item]));
    for (const item of evaluated) {
      const rollout = rolloutResults.get(item.key);
      if (!rollout) continue;
      item.expectedWinRate = rollout.expectedWinRate;
      item.confidenceInterval = rollout.confidenceInterval;
      item.simulations = rollout.simulations;
      item.opponentDeckPosterior = rollout.opponentDeckPosterior;
    }
  }
  evaluated.sort((left, right) => right.expectedWinRate - left.expectedWinRate);
  const selectedKey = actionKey(selectedAction);
  let selected = evaluated.find((item) => item.key === selectedKey);
  if (!selected && selectedAction) selected = evaluateAlternative(game, before, actorId, selectedAction, policyScores.get(selectedKey) || 0, model);
  if (!selected) return null;
  const best = evaluated[0] || selected;
  const regret = Math.max(0, best.expectedWinRate - selected.expectedWinRate);
  return {
    actorId,
    turnNumber: game.turnNumber,
    phase: game.phase,
    category: decisionCategory(selectedAction, game),
    selected,
    best,
    alternatives: evaluated.slice(0, options.maxAlternatives || 3),
    regret,
    severity: regret >= 0.15 ? "critical" : regret >= 0.08 ? "mistake" : regret >= 0.03 ? "inaccuracy" : "sound",
    confidence: confidenceFor(evaluated),
    explanation: explainDecision(before, selected, best, regret)
  };
}

function evaluateAlternative(game, before, actorId, action, policyScore, model) {
  const clone = cloneGame(game);
  const result = applyAiAction(clone, action, actorId);
  const after = result?.ok ? observeGame(clone, actorId) : before;
  const stateValue = result?.ok ? evaluateState(clone, actorId, model) : -1;
  const learnedPreference = Math.tanh(policyScore / 3);
  const expectedWinRate = clamp(0.5 + stateValue * 0.34 + learnedPreference * 0.16, 0.01, 0.99);
  return {
    action,
    key: actionKey(action),
    label: actionLabel(game, action),
    expectedWinRate,
    stateValue,
    policyScore,
    evidence: stateDelta(before, after)
  };
}

export function buildMatchReport(replay, model = DEFAULT_AI_MODEL) {
  const decisions = (replay?.decisions || []).filter((decision) => !replay?.humanPlayerId || decision.actorId === replay.humanPlayerId);
  const byCategory = { deck: [], mulligan: [], play: [] };
  for (const decision of decisions) (byCategory[decision.analysis?.category] || byCategory.play).push(decision.analysis);
  const summaries = Object.fromEntries(Object.entries(byCategory).map(([category, items]) => {
    const valid = items.filter(Boolean);
    return [category, {
      decisions: valid.length,
      totalRegret: valid.reduce((sum, item) => sum + item.regret, 0),
      majorMistakes: valid.filter((item) => item.severity === "mistake" || item.severity === "critical").length
    }];
  }));
  const deckAdvice = analyzeDeckContribution(replay, model);
  if (deckAdvice.regret) {
    summaries.deck.totalRegret = deckAdvice.regret;
    summaries.deck.majorMistakes = deckAdvice.regret >= 0.08 ? 1 : 0;
  }
  const turningPoints = decisions.map((item) => item.analysis).filter(Boolean)
    .sort((left, right) => right.regret - left.regret).slice(0, 8);
  return {
    winnerId: replay?.winnerId || null,
    summaries,
    turningPoints,
    deckAdvice,
    matchupPlan: analyzeMatchupPlan(replay, model),
    overview: reportOverview(summaries, replay?.winnerId, replay?.humanPlayerId)
  };
}

function analyzeMatchupPlan(replay, model) {
  const mine = replay?.decks?.find((deck) => deck.playerId === replay.humanPlayerId);
  const opponent = replay?.decks?.find((deck) => deck.playerId !== replay.humanPlayerId);
  const matchup = mine && opponent ? model.matchupStats?.[`${mine.id}::${opponent.id}`] : null;
  const profile = opponent?.legend?.cardNumber ? model.archetypeStats?.[opponent.legend.cardNumber] : null;
  const metaCards = metaCardLeaderboard(model, 5);
  const matchupDeckPlan = mine && profile ? buildMatchupDeckPlan(mine, profile, model) : null;
  let plan = "상대 전형 표본이 부족하므로 초반에는 룬을 보존하고 공개되는 카드에 맞춰 플랜을 조정하는 것이 좋습니다.";
  if (profile?.games >= 3 && profile.unitRatio >= 0.62 && profile.averageEnergy <= 3.2) {
    plan = "상대는 저비용 유닛 중심 전형으로 추정됩니다. 초반 전장 방어와 효율적인 교환을 우선하고, 안정화 후 역공하는 플랜이 좋습니다.";
  } else if (profile?.games >= 3 && (profile.averageEnergy >= 4 || profile.spellRatio >= 0.38)) {
    plan = "상대는 느린 자원전 또는 주문 중심 전형으로 추정됩니다. 상대의 핵심 턴 이전에 전장 점수를 압박하는 플랜이 좋습니다.";
  }
  return {
    opponentLegend: opponent?.legend?.name || "",
    plan,
    confidence: profile?.games >= 12 ? "high" : profile?.games >= 3 ? "medium" : "low",
    matchupGames: matchup?.games || 0,
    matchupWinRate: matchup?.games ? matchup.wins / matchup.games : null,
    metaCards,
    deckPlan: matchupDeckPlan
  };
}

function analyzeDeckContribution(replay, model) {
  const deck = replay?.decks?.find((item) => item.playerId === replay.humanPlayerId);
  if (!deck) return { category: "deck", confidence: "low", observations: [], recommendations: [] };
  const cardStats = model.cardStats || {};
  const cards = deck.main || [];
  const ranked = cards.map((card) => ({
    name: card.name,
    cardNumber: card.cardNumber,
    score: cardStats[card.cardNumber]?.meanReturn || 0,
    games: cardStats[card.cardNumber]?.games || 0
  })).sort((left, right) => left.score - right.score);
  const weak = uniqueBy(ranked.filter((item) => item.games >= 3), "cardNumber").slice(0, 3);
  const deckStat = model.deckStats?.[deck.id];
  const comparable = Object.values(model.deckStats || {}).filter((stat) => stat.games >= 5);
  const bestRate = comparable.reduce((best, stat) => Math.max(best, stat.wins / stat.games), 0);
  const currentRate = deckStat?.games ? deckStat.wins / deckStat.games : null;
  const changes = recommendDeckChanges(deck, model);
  return {
    category: "deck",
    confidence: deckStat?.games >= 20 ? "high" : deckStat?.games >= 5 ? "medium" : "low",
    expectedWinRate: currentRate,
    regret: currentRate == null ? 0 : Math.max(0, bestRate - currentRate),
    observations: deckStat?.games
      ? [`이 덱은 자가대전 ${deckStat.games}경기에서 ${(deckStat.wins / deckStat.games * 100).toFixed(1)}%의 승률을 기록했습니다.`]
      : ["이 덱은 아직 충분한 자가대전 표본이 없습니다."],
    recommendations: changes.length
      ? changes.map((change) => `${change.remove.name} 대신 ${change.add.name}을 시험하면 자가대전 카드 기여도를 높일 수 있습니다.`)
      : weak.map((item) => `${item.name}의 학습 기여도가 낮았습니다. 동일 역할의 상위 후보와 교체 실험이 필요합니다.`)
  };
}

function decisionCategory(action, game) {
  if (["toggleMulliganCard", "confirmMulligan", "skipMulligan"].includes(action?.kind) || game.phase === "mulligan") return "mulligan";
  return "play";
}

function explainDecision(before, selected, best, regret) {
  if (regret < 0.03) return `선택하신 플레이는 추천 수와 기대 승률 차이가 ${percent(regret)}로 작아 합리적인 판단입니다.`;
  const reasons = evidenceReasons(selected.evidence, best.evidence);
  return `추천 수는 ${best.label}이며 기대 승률이 ${percent(best.expectedWinRate)}로, 선택하신 수보다 ${percent(regret)} 높습니다.${reasons.length ? ` ${reasons.join(" ")}` : " 자가대전 정책에서 이후 전개가 더 안정적이었습니다."}`;
}

function evidenceReasons(selected, best) {
  const reasons = [];
  if (best.scoreDelta > selected.scoreDelta) reasons.push("즉시 점수 기대값이 더 높습니다.");
  if (best.controlDelta > selected.controlDelta) reasons.push("전장 주도권을 더 많이 확보합니다.");
  if (best.boardMightDelta > selected.boardMightDelta + 1) reasons.push("보드 전투력이 더 잘 보존됩니다.");
  if (best.readyRuneDelta > selected.readyRuneDelta) reasons.push("후속 반응에 사용할 룬을 더 남깁니다.");
  if (best.handDelta > selected.handDelta) reasons.push("손패 자원 손실이 더 적습니다.");
  return reasons.slice(0, 3);
}

function stateDelta(before, after) {
  if (!before || !after) return {};
  return {
    scoreDelta: after.self.score - before.self.score,
    opponentScoreDelta: after.opponent.score - before.opponent.score,
    handDelta: after.self.handCount - before.self.handCount,
    readyRuneDelta: readyRunes(after.self) - readyRunes(before.self),
    boardMightDelta: boardMight(after, after.self.id) - boardMight(before, before.self.id),
    controlDelta: controlled(after, after.self.id) - controlled(before, before.self.id)
  };
}

function actionLabel(game, action) {
  const cardId = action.cardId || action.unitId || action.unitIds?.[0];
  const card = findCard(game, cardId);
  const destinationId = action.destination || action.destinationId;
  const destination = game.battlefields.find((field) => field.instanceId === destinationId);
  const destinationName = destination?.name || (destinationId === "base" ? "기지" : "");
  const labels = {
    confirmFirstPlayer: "선공 확인",
    selectChampion: `${card?.name || "챔피언"} 선택`,
    selectBattlefield: `${destination?.name || "전장"} 선택`,
    toggleMulliganCard: `${card?.name || "카드"} 멀리건 선택`,
    confirmMulligan: "선택한 카드 멀리건",
    skipMulligan: "현재 시작 패 유지",
    beginPlayCard: `${card?.name || "카드"} 사용${destinationName ? ` → ${destinationName}` : ""}`,
    beginPlayChampion: `챔피언 사용${destinationName ? ` → ${destinationName}` : ""}`,
    hideCard: `${card?.name || "카드"} 숨기기 → ${destinationName}`,
    moveUnit: `${card?.name || "유닛"} 이동 → ${destinationName}`,
    moveUnits: `${action.unitIds?.length || 0}개 유닛 이동 → ${destinationName}`,
    activateCard: `${card?.name || "카드"} 능력 발동`,
    chooseEffectOption: "효과 선택",
    declineEffectChoice: "효과 거절",
    passShowdown: "우선권 넘기기",
    endTurn: "턴 종료"
  };
  return labels[action.kind] || action.kind;
}

function findCard(game, id) {
  if (!id) return null;
  for (const player of game.players) {
    const card = [player.legend, player.champion, ...player.availableChampions, ...player.availableBattlefields, ...player.hand, ...player.base, ...player.trash]
      .filter(Boolean).find((item) => item.instanceId === id);
    if (card) return card;
  }
  return game.battlefields.flatMap((field) => [...field.units, ...(field.hidden || []).map((item) => item.card)]).find((card) => card?.instanceId === id) || null;
}

function boardMight(observation, playerId) { return observation.battlefields.flatMap((field) => field.units).filter((unit) => unit.controllerId === playerId).reduce((sum, unit) => sum + (unit.might || 0), 0); }
function controlled(observation, playerId) { return observation.battlefields.filter((field) => field.controlledBy === playerId).length; }
function readyRunes(player) { return player.runes.filter((rune) => !rune.exhausted).length; }
function confidenceFor(items) { const gap = (items[0]?.expectedWinRate || 0) - (items[1]?.expectedWinRate || 0); return gap >= 0.12 ? "high" : gap >= 0.05 ? "medium" : "low"; }
function reportOverview(summaries, winnerId, humanId) { const total = summaries.deck.totalRegret + summaries.mulligan.totalRegret + summaries.play.totalRegret; return winnerId === humanId ? `승리하셨습니다. 그래도 개선 가능한 누적 기대 승률 손실은 ${percent(total)}입니다.` : `패배 원인을 분리했습니다. 가장 큰 개선 영역은 ${largestCategory(summaries)}입니다.`; }
function largestCategory(summaries) { return Object.entries(summaries).sort((a, b) => b[1].totalRegret - a[1].totalRegret)[0]?.[0] === "mulligan" ? "멀리건" : "플레이"; }
function uniqueBy(items, key) { return [...new Map(items.map((item) => [item[key], item])).values()]; }
function percent(value) { return `${(value * 100).toFixed(1)}%`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
