export function isChampionCard(card) {
  return Boolean(card?.isChampion || card?.tags?.includes("Champion"));
}

export function championIdentityTag(card) {
  if (!isChampionCard(card)) return null;
  const explicitTag = typeof card.championTag === "string" ? card.championTag.trim() : "";
  const printedNameTag = typeof card.name === "string" ? card.name.split(",", 1)[0].trim() : "";
  const identityTag = explicitTag || printedNameTag;
  return identityTag && card.tags?.includes(identityTag) ? identityTag : null;
}

export function championMatchesLegend(card, legend) {
  const identityTag = championIdentityTag(card);
  return Boolean(identityTag && legend?.tags?.includes(identityTag));
}
