export function legalMoveDestinationIds(legalActions, unitId) {
  const destinations = [];
  const seen = new Set();
  for (const action of legalActions || []) {
    if (action?.kind !== "moveUnit" || action.unitId !== unitId || seen.has(action.destinationId)) continue;
    seen.add(action.destinationId);
    destinations.push(action.destinationId);
  }
  return destinations;
}

export function sharedLegalMoveDestinationIds(legalActions, unitIds) {
  const selectedIds = [...new Set(unitIds || [])];
  if (!selectedIds.length) return [];
  const firstDestinations = legalMoveDestinationIds(legalActions, selectedIds[0]);
  const remainingDestinations = selectedIds.slice(1).map((unitId) =>
    new Set(legalMoveDestinationIds(legalActions, unitId)));
  return firstDestinations.filter((destinationId) =>
    remainingDestinations.every((destinations) => destinations.has(destinationId)));
}
