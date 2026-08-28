export function battlefieldDisplayName(game, battlefield, localizedName = battlefield?.name || "Battlefield") {
  if (!battlefield || !hasDuplicateBattlefieldName(game, battlefield)) return localizedName;
  const seat = battlefieldSeatNumber(game, battlefield);
  return seat ? `${localizedName} · P${seat}` : localizedName;
}

export function battlefieldSeatNumber(game, battlefield) {
  const players = game?.players || [];
  const ownerIndex = players.findIndex((player) =>
    player.id === battlefield?.ownerId || player.selectedBattlefieldId === battlefield?.instanceId);
  if (ownerIndex >= 0) return ownerIndex + 1;

  const battlefieldIndex = (game?.battlefields || []).findIndex((candidate) =>
    candidate === battlefield || candidate?.instanceId === battlefield?.instanceId);
  return battlefieldIndex >= 0 ? battlefieldIndex + 1 : null;
}

function hasDuplicateBattlefieldName(game, battlefield) {
  const name = normalizedName(battlefield?.name);
  if (!name) return false;
  return (game?.battlefields || []).filter((candidate) => normalizedName(candidate?.name) === name).length > 1;
}

function normalizedName(name) {
  return String(name || "").trim().toLocaleLowerCase();
}
