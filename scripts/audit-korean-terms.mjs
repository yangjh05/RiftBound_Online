import { cards } from "../src/cards.mjs";
import { translateCardText } from "../src/i18n.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";

const forbiddenTerms = ["쇼다운", "매복", "탭:", "메인 덱", "버림 더미", "공격력", "체력치", "파워", "장비", "유언", "예지", "회수"];
const requiredTerms = [
  { english: /\bPower\b/iu, korean: /힘/u, name: "Power/힘" },
  { english: /\bMight\b/iu, korean: /위력/u, name: "Might/위력" },
  { english: /\bShowdown\b/iu, korean: /결전/u, name: "Showdown/결전" },
  {
    english: /(?:\b(?:channel|ready|recycle|reveal|choose|have)\b[^.\n]{0,40}\brunes?\b|\brune deck\b)/iu,
    korean: /룬/u,
    name: "physical Rune/룬"
  },
  { english: /\b(?:ready|readies)\b/iu, korean: /준비/u, name: "ready/준비" },
  { english: /\bexhaust(?:ed|s|ing)?\b/iu, korean: /탈진/u, name: "exhaust/탈진" }
];

const errors = [];
const resourceConfusion = /룬으로 반응|룬(?:\s*\d+개)?를\s*지불|룬 대신|룬 힘|자원\s*\d+/u;
for (const card of Object.values(cards)) {
  if (!CARD_KO_TRANSLATIONS[card.cardNumber]) continue;
  const korean = translateCardText(card, "ko");
  for (const term of forbiddenTerms) {
    if (korean.includes(term)) errors.push(`${card.collectorNumber} ${card.name}: forbidden term ${term}`);
  }
  if (resourceConfusion.test(korean)) {
    errors.push(`${card.collectorNumber} ${card.name}: energy/power cost translated as rune or resource`);
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
