export function pendingDecisionVisibleToViewer({ aiMode, viewerPlayerId, decision }) {
  if (!decision) return false;
  if (!aiMode) return true;
  return !decision.playerId || decision.playerId === viewerPlayerId;
}
