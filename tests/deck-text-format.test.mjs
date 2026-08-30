import test from "node:test";
import assert from "node:assert/strict";
import { cards, makeRune, rawDecklists } from "../src/cards.mjs";
import { cardAllowedInPool } from "../src/card-pools.mjs";
import { championMatchesLegend } from "../src/decks/rules.mjs";
import {
  DeckTextFormatError,
  deckRecordFromText,
  formatDeckText,
  parseDeckText
} from "../src/decks/text-format.mjs";

const SAMPLE_DECK = `Legend:
1 Master Yi, Wuju Bladesman

Champion:
1 Master Yi, Tempered

MainDeck:
3 First Mate
2 Pit Rookie
3 Lonely Poro
3 Scuttle Crab
3 Rengar, Trophy Hunter
3 En Garde
3 Discipline
3 Defy
3 Charm
3 Punch First
1 Rampage
1 Onslaught
3 Sabotage
1 Twilight Shroud
2 Zhonya's Hourglass
2 Irelia, Fervent

Battlefields:
1 Emperor's Dais
1 Seat of Power
1 Startipped Peak

Rune Pool:
7 Body Rune
5 Calm Rune

Sideboard:
1 Decree of Strength
2 Alpha Strike
2 Ruin Runner
2 Tomb-Raider Barbara
1 Rampage
1 Not So Fast
1 Ambessa, The Wolf
`;

const cardList = Object.values(cards);
const cardByNumberMap = new Map(cardList.map((card) => [card.cardNumber, card]));
const cardByNumber = (number) => cardByNumberMap.get(number) || null;

test("TXT deck parser accepts the requested section layout and quantities", () => {
  const sections = parseDeckText(SAMPLE_DECK);

  assert.deepEqual(sections.legend.map(({ count, name }) => ({ count, name })), [
    { count: 1, name: "Master Yi, Wuju Bladesman" }
  ]);
  assert.deepEqual(sections.champion.map(({ count, name }) => ({ count, name })), [
    { count: 1, name: "Master Yi, Tempered" }
  ]);
  assert.equal(sections.main.reduce((total, { count }) => total + count, 0), 39);
  assert.equal(sections.battlefields.reduce((total, { count }) => total + count, 0), 3);
  assert.equal(sections.runes.reduce((total, { count }) => total + count, 0), 12);
  assert.equal(sections.sideboard.reduce((total, { count }) => total + count, 0), 10);
});

test("TXT deck export uses the canonical section order and round-trips an existing deck", () => {
  const raw = rawDecklists.provingGroundsMasterYi;
  const record = {
    legend: raw.legend,
    battlefields: [...raw.battlefields],
    main: raw.main.map((entry) => [...entry]),
    runes: raw.runes.map(([domain, count]) => [makeRune(domain).cardNumber, count]),
    sideboard: raw.sideboard.map((entry) => [...entry])
  };
  const exported = formatDeckText(record, { cardByNumber, championMatchesLegend });
  const imported = deckRecordFromText(exported, {
    cards: cardList,
    cardAllowed: (card) => cardAllowedInPool(card, "origins-era"),
    championMatchesLegend
  });

  assert.match(exported, /^Legend:\n1 Master Yi, Wuju Bladesman\n\nChampion:\n1 Master Yi, Honed\n\nMainDeck:/u);
  assert.match(exported, /\n\nBattlefields:\n/u);
  assert.match(exported, /\n\nRune Pool:\n/u);
  assert.match(exported, /\n\nSideboard:\n/u);
  assert.equal(formatDeckText(imported, { cardByNumber, championMatchesLegend }), exported);
  assert.equal(imported.main.reduce((total, [, count]) => total + count, 0), 40);
});

test("TXT deck parser reports malformed lines and unknown cards without creating a partial deck", () => {
  assert.throws(
    () => parseDeckText("Legend:\n1 Master Yi, Wuju Bladesman\nChampion:\nMaster Yi, Tempered"),
    (error) => error instanceof DeckTextFormatError
      && error.issues.some((issue) => issue.includes("quantity card name"))
      && error.issues.some((issue) => issue.includes("Missing section: MainDeck"))
  );

  assert.throws(
    () => deckRecordFromText(SAMPLE_DECK.replace("3 First Mate", "3 Definitely Not A Card"), {
      cards: cardList,
      championMatchesLegend
    }),
    (error) => error instanceof DeckTextFormatError
      && error.issues.some((issue) => issue.includes('unknown card "Definitely Not A Card"'))
  );
});
