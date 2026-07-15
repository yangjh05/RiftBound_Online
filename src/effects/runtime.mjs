export function cardEffects(card, timing) {
  return [...(card?.effects || []), ...(card?.appendedEffects || [])]
    .filter((effect) => effect.timing === timing && effectIsEnabled(effect, card));
}

export function firstCardEffect(card, timing, kind) {
  return cardEffects(card, timing).find((effect) => effect.kind === kind) || null;
}

export function hasAnyEffect(card, timing, kind) {
  return [...(card?.effects || []), ...(card?.appendedEffects || [])]
    .some((effect) => effect.timing === timing && effect.kind === kind && effectIsEnabled(effect, card));
}

export function hasStaticEffect(card, kind) {
  return hasAnyEffect(card, "static", kind);
}

export function staticEffectAmount(card, kind, fallback = 0) {
  return firstCardEffect(card, "static", kind)?.amount ?? fallback;
}

export function staticEffectAmountTotal(card, kind, fallback = 0) {
  const effects = cardEffects(card, "static").filter((effect) => effect.kind === kind);
  if (!effects.length) return fallback;
  return effects.reduce((sum, effect) => sum + (Number(effect.amount) || 0), 0);
}

export function replacementEffect(card, kind) {
  return firstCardEffect(card, "replacement", kind);
}

export function effectIsEnabled(effect, card = null) {
  if (!effect) return false;
  const textSection = effect.textSection || "rules";
  if (card?.attachedToId && textSection === "rules") return false;
  // Printed Effect Text is never an ability of the attachment itself. While
  // attached it is copied onto the Top-Most card as an `appended` effect; while
  // unattached there is no Top-Most card for it to modify.
  if (textSection === "effect") return false;
  if (textSection === "mightBonus") return false;
  return effectIsEnabledByMutation(effect);
}

export function effectIsEnabledByMutation(effect) {
  if (!effect) return false;
  const mutationMode = typeof process !== "undefined" && process?.env?.RIFTBOUND_EFFECT_MUTATION_MODE === "1";
  if (!mutationMode) return true;
  return `${effect.timing}:${effect.kind}` !== process.env.RIFTBOUND_EFFECT_MUTATION_KEY;
}
