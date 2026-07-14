export function cardEffects(card, timing) {
  return (card?.effects || []).filter((effect) => effect.timing === timing);
}

export function firstCardEffect(card, timing, kind) {
  return cardEffects(card, timing).find((effect) => effect.kind === kind) || null;
}

export function hasAnyEffect(card, timing, kind) {
  return (card?.effects || []).some((effect) => effect.timing === timing && effect.kind === kind);
}

export function hasStaticEffect(card, kind) {
  return hasAnyEffect(card, "static", kind);
}

export function staticEffectAmount(card, kind, fallback = 0) {
  return firstCardEffect(card, "static", kind)?.amount ?? fallback;
}

export function replacementEffect(card, kind) {
  return firstCardEffect(card, "replacement", kind);
}
