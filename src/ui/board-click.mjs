export function resolveBoardClickTarget(target) {
  const button = target?.closest?.("button") || null;
  if (button) return { button, cardNode: null, targetZone: null };

  const cardNode = target?.closest?.("[data-card-id]") || null;
  const targetZone = target?.closest?.("[data-zone-action]") || null;

  // Battlefield lanes live inside the battlefield card element. In that case
  // the actionable lane is closer to the click than the enclosing card.
  if (targetZone && (!cardNode || cardNode.contains(targetZone))) {
    return { button: null, cardNode: null, targetZone };
  }

  // A unit inside an actionable lane remains selectable because the unit card
  // is closer to the click than its enclosing lane.
  return { button: null, cardNode, targetZone: null };
}
