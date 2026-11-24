export function captureOnlineDiagnosticIdentity({ roomId = "", diagnosticKey = "", metadata = {} } = {}) {
  const normalizedRoomId = String(roomId || "");
  const metadataRoomId = String(metadata?.roomId || "");
  const diagnosticGameId = String(metadata?.diagnosticGameId || "");
  const gameNumber = Number(metadata?.gameNumber);
  const normalizedKey = String(diagnosticKey || "");
  const expectedKey = diagnosticGameId
    ? `diagnostic:${diagnosticGameId}`
    : Number.isInteger(gameNumber) && gameNumber > 0 && normalizedRoomId
      ? `${normalizedRoomId}:game:${gameNumber}`
      : "";
  const captured = metadata?.mode === "online"
    && Boolean(normalizedRoomId)
    && metadataRoomId === normalizedRoomId
    && Number.isInteger(gameNumber)
    && gameNumber > 0
    && Boolean(normalizedKey)
    && normalizedKey === expectedKey;
  return {
    diagnosticIdentityCaptured: captured,
    diagnosticKey: captured ? normalizedKey : "",
    diagnosticGameId: captured ? diagnosticGameId : "",
    gameNumber: captured ? gameNumber : null
  };
}

export function onlineDiagnosticIdentityMatchesDescriptor(identity, descriptor) {
  if (identity?.diagnosticIdentityCaptured !== true || !descriptor) return false;
  const ownerGameNumber = Number(identity.gameNumber);
  const descriptorGameNumber = Number(descriptor.gameNumber);
  if (!Number.isInteger(ownerGameNumber)
    || !Number.isInteger(descriptorGameNumber)
    || ownerGameNumber <= 0
    || ownerGameNumber !== descriptorGameNumber) return false;
  if (String(identity.roomId || "") !== String(descriptor.roomId || "")) return false;
  if (!identity.diagnosticKey
    || String(identity.diagnosticKey) !== String(descriptor.key || "")) return false;
  return String(identity.diagnosticGameId || "") === String(descriptor.diagnosticGameId || "");
}
