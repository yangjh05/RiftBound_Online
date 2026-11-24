// Exact, user-approved lists shared by the game menu and training tools.
// Being selectable is separate from having been trained by a given checkpoint.
export const AI_DECK_PRESETS = [
  {
    id: 'user-master-yi-no-aurora-20260924',
    playerName: 'Master Yi / No Aurora (user 2026-09-24)',
    displayNameKo: '마스터 이 · 비오로라',
    source: 'User-provided exact list, 2026-09-24',
    replacesSeedDeckId: 'keenan-xiong',
    legend: 'OGS-019/024', chosenChampion: 'OGS-009/024',
    main: [
      ['OGS-009/024', 1], ['OGN-046/298', 2], ['OGN-043/298', 3],
      ['OGN-045/298', 3], ['OGN-156/298', 3], ['OGN-044/298', 3],
      ['OGN-129/298', 1], ['OGN-058/298', 3], ['OGN-136/298', 3],
      ['OGN-052/298', 3], ['OGN-077/298', 2], ['OGN-047/298', 2],
      ['OGN-132/298', 2], ['OGN-155/298', 3], ['OGN-161/298', 3], ['OGN-082/298', 3]
    ],
    battlefields: ['OGN-280/298', 'OGN-289/298', 'OGN-295/298'],
    runes: [['Calm', 6], ['Body', 6]], sideboard: []
  },
  {
    id: 'viktor-control-ceasar-1-20260929',
    playerName: 'Viktor / Control (Ceasar #1)',
    displayNameKo: '빅토르 · 컨트롤 (계피디)',
    source: 'https://www.ceasar.kr/riftbound/decks/1',
    legend: 'OGN-265/298', chosenChampion: 'OGN-246/298',
    main: [
      ['OGN-246/298', 1], ['OGN-216/298', 3], ['OGN-210/298', 3],
      ['OGN-097/298', 1], ['OGN-218/298', 3], ['OGN-211/298', 3],
      ['OGN-226/298', 1], ['OGN-106/298', 2], ['OGN-239/298', 3],
      ['OGN-116/298', 2], ['OGN-213/298', 3], ['OGN-209/298', 3],
      ['OGN-083/298', 1], ['OGN-221/298', 2], ['OGN-233/298', 3],
      ['OGN-105/298', 3], ['OGN-245/298', 3]
    ],
    battlefields: ['OGN-294/298', 'OGN-295/298', 'OGN-298/298'],
    runes: [['Mind', 5], ['Order', 7]], sideboard: []
  }
];

const counts = (entries, normalize = value => value) => JSON.stringify(
  [...(entries || []).reduce((map, [id, count]) => {
    const key = normalize(id); map.set(key, (map.get(key) || 0) + count); return map;
  }, new Map())].sort(([a], [b]) => a.localeCompare(b)));

// Deck-store records use rune card numbers; authored lists may use domains.
export function matchingAiPreset(deck, cardByNumber) {
  if (!deck) return null;
  const runeDomain = id => {
    const card = cardByNumber(id);
    return card?.type === 'rune' && card.tags?.includes('Basic Rune') ? card.domains[0] : id;
  };
  return AI_DECK_PRESETS.find(preset => deck.legend === preset.legend
    && counts(deck.main) === counts(preset.main)
    && counts(deck.sideboard) === counts(preset.sideboard)
    && counts(deck.runes, runeDomain) === counts(preset.runes, runeDomain)
    && JSON.stringify([...(deck.battlefields || [])].sort()) === JSON.stringify([...preset.battlefields].sort())) || null;
}
