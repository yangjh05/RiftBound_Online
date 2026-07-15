export function hiddenCardControllerId(item) {
  return item?.card?.controllerId || item?.hiddenByPlayerId || item?.ownerId || null;
}

export function hiddenCardIsControlledBy(item, playerId) {
  return Boolean(playerId && hiddenCardControllerId(item) === playerId);
}
