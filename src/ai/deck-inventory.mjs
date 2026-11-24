// Count physical, owned deck cards once, including cards temporarily on the
// chain or attached to another object. This also accepts a public observation;
// callers must choose that input when reasoning about an opponent's cards.
export function deckInventoryCards(state, ownerId) {
  const players = state.players || [state.self, state.opponent].filter(Boolean);
  const roots = players.flatMap((player) => [
    ...(player.mainDeck || []), ...(player.hand || []), ...(player.base || []),
    ...(player.trash || []), ...(player.banished || []),
    player.champion, ...(player.availableChampions || [])
  ]);
  roots.push(...(state.battlefields || []).flatMap((field) => [
    ...(field.units || []), ...(field.hidden || []).map((item) => item.card)
  ]), ...(state.chainCards || []),
  ...(state.actionChain?.chain || []).map((item) => item.card),
  ...(state.showdown?.chain || []).map((item) => item.card));
  const seen = new Set();
  const output = [];
  function visit(card) {
    if (!card) return;
    const identity = card.instanceId || card;
    if (seen.has(identity)) return;
    seen.add(identity);
    if (card.ownerId === ownerId && card.cardNumber
      && ["unit", "spell", "gear"].includes(card.type)
      && !card.isToken && !(card.tags || []).some((tag) => /^token$/i.test(tag))) {
      output.push(card);
    }
    for (const attachment of card.attachments || []) visit(attachment);
  }
  roots.forEach(visit);
  return output;
}
