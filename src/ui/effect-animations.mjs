export const EFFECT_ANIMATION_DURATION_MS = 1200;

export function detectEffectAnimations(previous, current) {
  if (!previous || !current) return emptyEffectAnimations();

  const draws = [];
  for (const [playerId, player] of current.players || []) {
    const prior = previous.players?.get(playerId);
    if (!prior) continue;
    const deckDelta = Math.max(0, Number(prior.deckCount || 0) - Number(player.deckCount || 0));
    const newHandCards = difference(player.handIds, prior.handIds);
    const count = Math.min(deckDelta, newHandCards.length);
    if (count > 0) draws.push({ playerId, count });
  }

  const deaths = [];
  for (const [unitId, unit] of previous.boardUnits || []) {
    if (current.boardUnits?.has(unitId) || !current.trash?.has(unitId)) continue;
    deaths.push(unit);
  }

  const mightChanges = [];
  for (const [unitId, unit] of current.boardUnits || []) {
    const prior = previous.boardUnits?.get(unitId);
    if (!prior) continue;
    const delta = Number(unit.might || 0) - Number(prior.might || 0);
    if (delta !== 0) mightChanges.push({ unitId, delta, from: prior.might, to: unit.might });
  }

  const countered = detectCounteredChainItem(previous, current);
  return { draws, deaths, mightChanges, countered: countered ? [countered] : [] };
}

function detectCounteredChainItem(previous, current) {
  const removed = (previous.chainItems || []).filter((item) => !current.chainItemIds?.has(item.id));
  if (!removed.length) return null;

  const message = [current.logHead, current.effectMessage].filter(Boolean).join(" ");
  const targetText = counterTargetText(message);
  if (!targetText) return null;

  return removed.find((item) => targetText.includes(normalize(item.rawName || item.name)))
    || removed.find((item) => item.cardId && current.trash?.has(item.cardId))
    || removed[0];
}

function counterTargetText(message) {
  const normalized = normalize(message);
  const active = normalized.match(/\bcounters?\s+(.+?)(?:\.|$)/u);
  if (active) return active[1];
  const passive = normalized.match(/(?:^|\.\s*)(.+?)\s+is\s+countered(?:\.|$)/u);
  return passive?.[1] || "";
}

function difference(current = new Set(), previous = new Set()) {
  return [...current].filter((value) => !previous.has(value));
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function emptyEffectAnimations() {
  return { draws: [], deaths: [], mightChanges: [], countered: [] };
}
