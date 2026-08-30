const SECTION_DEFINITIONS = Object.freeze([
  { key: "legend", title: "Legend", aliases: ["legend"] },
  { key: "champion", title: "Champion", aliases: ["champion"] },
  { key: "main", title: "MainDeck", aliases: ["maindeck", "main deck"] },
  { key: "battlefields", title: "Battlefields", aliases: ["battlefields", "battlefield"] },
  { key: "runes", title: "Rune Pool", aliases: ["rune pool", "runepool", "runes", "rune deck"] },
  { key: "sideboard", title: "Sideboard", aliases: ["sideboard", "side board"] }
]);

const REQUIRED_SECTIONS = Object.freeze(["legend", "champion", "main", "battlefields", "runes"]);
const SECTION_BY_ALIAS = new Map(SECTION_DEFINITIONS.flatMap((section) => (
  section.aliases.map((alias) => [alias, section])
)));

export class DeckTextFormatError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues.filter(Boolean) : [String(issues || "Invalid deck TXT.")];
    super(normalized.join("\n"));
    this.name = "DeckTextFormatError";
    this.issues = normalized;
  }
}

export function parseDeckText(text) {
  const sections = Object.fromEntries(SECTION_DEFINITIONS.map(({ key }) => [key, []]));
  const seenSections = new Set();
  const issues = [];
  let currentSection = null;
  const lines = String(text ?? "").replace(/^\uFEFF/u, "").split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;

    const header = sectionForHeader(line);
    if (header) {
      if (seenSections.has(header.key)) issues.push(`Line ${lineNumber}: ${header.title} appears more than once.`);
      seenSections.add(header.key);
      currentSection = header.key;
      continue;
    }

    if (/^[^:]+:\s*$/u.test(line)) {
      issues.push(`Line ${lineNumber}: unknown section "${line.slice(0, -1).trim()}".`);
      currentSection = null;
      continue;
    }
    if (!currentSection) {
      issues.push(`Line ${lineNumber}: card entry must follow a section header.`);
      continue;
    }

    const entry = line.match(/^(\d+)\s+(.+?)\s*$/u);
    if (!entry) {
      issues.push(`Line ${lineNumber}: use "quantity card name" (for example, "3 First Mate").`);
      continue;
    }
    const count = Number(entry[1]);
    const name = entry[2].trim();
    if (!Number.isSafeInteger(count) || count <= 0) {
      issues.push(`Line ${lineNumber}: quantity must be a positive whole number.`);
      continue;
    }
    if (!name) {
      issues.push(`Line ${lineNumber}: card name is missing.`);
      continue;
    }
    sections[currentSection].push({ count, name, lineNumber });
  }

  for (const sectionKey of REQUIRED_SECTIONS) {
    if (!seenSections.has(sectionKey)) {
      const title = SECTION_DEFINITIONS.find((section) => section.key === sectionKey)?.title || sectionKey;
      issues.push(`Missing section: ${title}.`);
    }
  }
  if (sections.legend.length !== 1 || sections.legend[0]?.count !== 1) {
    issues.push("Legend must contain exactly one line with a quantity of 1.");
  }
  if (sections.champion.length !== 1 || sections.champion[0]?.count !== 1) {
    issues.push("Champion must contain exactly one line with a quantity of 1.");
  }
  if (issues.length) throw new DeckTextFormatError(issues);
  return sections;
}

export function deckRecordFromText(text, {
  cards,
  cardNames = (card) => [card?.name],
  cardAllowed = () => true,
  championMatchesLegend = defaultChampionMatchesLegend
} = {}) {
  const sections = parseDeckText(text);
  const cardList = [...(cards || [])].filter(Boolean);
  const nameIndex = buildNameIndex(cardList, cardNames);
  const issues = [];

  const resolveEntry = (entry, sectionKey) => {
    const candidates = nameIndex.get(normalizeCardName(entry.name)) || [];
    const matchingType = candidates.filter((card) => cardFitsSection(card, sectionKey));
    if (!candidates.length) {
      issues.push(`Line ${entry.lineNumber}: unknown card "${entry.name}".`);
      return null;
    }
    if (!matchingType.length) {
      const title = SECTION_DEFINITIONS.find((section) => section.key === sectionKey)?.title || sectionKey;
      issues.push(`Line ${entry.lineNumber}: "${entry.name}" cannot be used in ${title}.`);
      return null;
    }
    return [...matchingType].sort((left, right) => (
      Number(cardAllowed(right)) - Number(cardAllowed(left))
      || String(left.cardNumber || "").localeCompare(String(right.cardNumber || ""))
    ))[0];
  };

  const resolved = Object.fromEntries(SECTION_DEFINITIONS.map(({ key }) => [key, (
    sections[key].map((entry) => ({ entry, card: resolveEntry(entry, key) }))
  )]));
  const legend = resolved.legend[0]?.card || null;
  const champion = resolved.champion[0]?.card || null;
  if (legend && champion && !championMatchesLegend(champion, legend)) {
    issues.push(`${champion.name} does not match ${legend.name}'s Champion identity.`);
  }
  if (issues.length) throw new DeckTextFormatError(issues);

  return {
    legend: legend.cardNumber,
    battlefields: resolved.battlefields.flatMap(({ entry, card }) => Array.from({ length: entry.count }, () => card.cardNumber)),
    main: combineCountEntries([
      [champion.cardNumber, 1],
      ...resolved.main.map(({ entry, card }) => [card.cardNumber, entry.count])
    ]),
    runes: combineCountEntries(resolved.runes.map(({ entry, card }) => [card.cardNumber, entry.count])),
    sideboard: combineCountEntries(resolved.sideboard.map(({ entry, card }) => [card.cardNumber, entry.count]))
  };
}

export function formatDeckText(deck, {
  cardByNumber,
  championMatchesLegend = defaultChampionMatchesLegend
} = {}) {
  if (typeof cardByNumber !== "function") throw new TypeError("cardByNumber is required.");
  const legend = cardByNumber(deck?.legend);
  const mainEntries = (deck?.main || []).map(([number, count]) => [number, count]);
  const championIndex = mainEntries.findIndex(([number, count]) => (
    count > 0 && championMatchesLegend(cardByNumber(number), legend)
  ));
  const champion = championIndex >= 0 ? cardByNumber(mainEntries[championIndex][0]) : null;
  if (championIndex >= 0) mainEntries[championIndex][1] -= 1;

  const sections = [
    ["Legend", legend ? [[legend, 1]] : []],
    ["Champion", champion ? [[champion, 1]] : []],
    ["MainDeck", resolveNamedCounts(mainEntries, cardByNumber)],
    ["Battlefields", resolveNamedCounts(countCardNumbers(deck?.battlefields || []), cardByNumber)],
    ["Rune Pool", resolveNamedCounts(deck?.runes || [], cardByNumber)],
    ["Sideboard", resolveNamedCounts(deck?.sideboard || [], cardByNumber)]
  ];

  return `${sections.map(([title, entries]) => (
    `${title}:\n${combineNamedCounts(entries).map(([card, count]) => `${count} ${card.name}`).join("\n")}`
  )).join("\n\n")}\n`;
}

function sectionForHeader(line) {
  if (!line.endsWith(":")) return null;
  const name = line.slice(0, -1).trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
  return SECTION_BY_ALIAS.get(name) || null;
}

function normalizeCardName(name) {
  return String(name || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u2013\u2014]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function buildNameIndex(cards, cardNames) {
  const index = new Map();
  for (const card of cards) {
    for (const name of new Set([card.name, ...(cardNames(card) || [])].filter(Boolean))) {
      const key = normalizeCardName(name);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      if (!index.get(key).includes(card)) index.get(key).push(card);
    }
  }
  return index;
}

function cardFitsSection(card, sectionKey) {
  if (sectionKey === "legend") return card?.type === "legend";
  if (sectionKey === "champion") return isChampion(card);
  if (sectionKey === "battlefields") return card?.type === "battlefield";
  if (sectionKey === "runes") return card?.type === "rune";
  return ["unit", "spell", "gear"].includes(card?.type);
}

function isChampion(card) {
  return Boolean(card?.isChampion || card?.tags?.includes("Champion"));
}

function defaultChampionMatchesLegend(card, legend) {
  if (!isChampion(card) || !legend) return false;
  const ignoredTags = new Set(["Champion", "Signature", "Signature Spell", "Action", "Reaction", "Unit", "Spell", "Gear"]);
  const legendTags = new Set((legend.tags || []).filter((tag) => !ignoredTags.has(tag)));
  return (card.tags || []).some((tag) => legendTags.has(tag));
}

function combineCountEntries(entries) {
  const combined = new Map();
  for (const [number, count] of entries) combined.set(number, (combined.get(number) || 0) + count);
  return [...combined.entries()].filter(([, count]) => count > 0);
}

function countCardNumbers(numbers) {
  const counts = new Map();
  for (const number of numbers) counts.set(number, (counts.get(number) || 0) + 1);
  return [...counts.entries()];
}

function resolveNamedCounts(entries, cardByNumber) {
  return entries.flatMap(([number, count]) => {
    if (count <= 0) return [];
    const card = cardByNumber(number);
    if (!card) throw new DeckTextFormatError(`Unknown card number in deck: ${number}.`);
    return [[card, count]];
  });
}

function combineNamedCounts(entries) {
  const byName = new Map();
  for (const [card, count] of entries) {
    const existing = byName.get(card.name);
    if (existing) existing[1] += count;
    else byName.set(card.name, [card, count]);
  }
  return [...byName.values()];
}
