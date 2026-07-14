import { cards } from "../src/cards.mjs";
import { translateCardText } from "../src/i18n.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";

const forbiddenTerms = ["결전", "매복", "탭:", "메인 덱", "버림 더미", "공격력", "체력치", "자원"];
const requiredTerms = [
  { english: /\bPower\b/iu, korean: /파워/u, name: "Power/파워" },
  { english: /\bMight\b/iu, korean: /위력/u, name: "Might/위력" },
  { english: /\bShowdown\b/iu, korean: /쇼다운/u, name: "Showdown/쇼다운" },
  { english: /\bRunes?\b/iu, korean: /룬/u, name: "Rune/룬" },
  { english: /\b(?:ready|readies)\b/iu, korean: /준비/u, name: "ready/준비" },
  { english: /\bexhaust(?:ed|s|ing)?\b/iu, korean: /탈진/u, name: "exhaust/탈진" }
];

const errors = [];
for (const card of Object.values(cards)) {
  if (!CARD_KO_TRANSLATIONS[card.cardNumber]) continue;
  const korean = translateCardText(card, "ko");
  for (const term of forbiddenTerms) {
    if (korean.includes(term)) errors.push(`${card.collectorNumber} ${card.name}: forbidden term ${term}`);
  }
  for (const rule of requiredTerms) {
    if (rule.english.test(card.text || "") && !rule.korean.test(korean)) {
      errors.push(`${card.collectorNumber} ${card.name}: missing ${rule.name}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Audited Korean terminology for ${Object.keys(cards).length} card records.`);
}
