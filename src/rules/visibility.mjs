export function pendingHandChainItem(item) {
  return Boolean(item)
    && (item.itemType || "card") === "card"
    && item.status === "pending"
    && item.playOptions?.playProcess?.source === "hand";
}

export function chainItemVisibleToViewer(item, viewerId) {
  if (!item) return false;
  if (!viewerId) return true;
  return !pendingHandChainItem(item) || item.playerId === viewerId;
}

export function pendingHandChainItems(game, playerId = null) {
  const items = [
    ...(game?.actionChain?.chain || []),
    ...(game?.showdown?.chain || [])
  ].filter(pendingHandChainItem);
  const filtered = playerId
    ? items.filter((item) => item.playerId === playerId)
    : items;
  return [...new Map(filtered.map((item) => [item.id || item.card?.instanceId, item])).values()];
}

export function handCountVisibleToViewer(game, player, viewerId) {
  if (!player) return 0;
  const privatePendingCount = viewerId && player.id !== viewerId
    ? pendingHandChainItems(game, player.id).length
    : 0;
  return (player.hand?.length || 0) + privatePendingCount;
}

export function gameLogVisibleToViewer(game, viewerId) {
  if (!game) return [];
  const privatePendingItem = pendingHandChainItems(game)
    .find((item) => viewerId && item.playerId !== viewerId);
  if (!privatePendingItem) return game.log || [];
  const publicLog = privatePendingItem.playOptions?.playProcess?.privateLogSnapshot;
  return Array.isArray(publicLog) ? publicLog : [];
}
