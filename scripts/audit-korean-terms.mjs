import { cards } from "../src/cards.mjs";
import { translateCardText, translationMetadata } from "../src/i18n.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";
import { auditOfficialKoreanTranslations } from "./audit-official-korean-translations.mjs";

const completeUnofficialSets = new Map([
  ["SFD", 221],
  ["UNL", 219],
  ["VEN", 166]
]);

const forbiddenTerms = [
  "쇼다운",
  "매복",
  "탭:",
  "메인 덱",
  "버림 더미",
  "공격력",
  "체력치",
  "파워",
  "장비",
  "유언",
  "예지",
  "회수",
  "채널",
  "무효화",
  "범용 힘",
  "인내",
  "비어 있는 전장",
  "빈 전장"
];
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

const errors = auditOfficialKoreanTranslations();
const keywordTranslations = translationMetadata().keywords;
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const resourceConfusion = /룬으로 반응|룬(?:\s*\d+장)?을?\s*지불|룬 대신|룬 힘|자원\s*\d+/u;
const styleViolations = [
  [/(?:주문 효과|지속 효과|활성화 능력):|\([^\n)]*(?:대상|수치|조건|토큰|선택지)[^\n)]*·/u, "effect metadata summary instead of printed sentence"],
  [/피해\s*\d+(?:을|를|만큼)?/u, "damage number must precede 의 피해"],
  [/추가\s+\d+의 피해|피해(?:은|을)/u, "bonus-damage order or particle is noncanonical"],
  [/유닛들(?:이|은|을|에게|의)?/u, "redundant plural suffix on 유닛"],
  [/주문(?:과| 및) 스킬이 (?:해결|처리)되기 전을 포함해 언제든|자신의 턴 또는 결전 중/u, "noncanonical timing reminder"],
  [/유닛 토큰\s*\d+명/u, "unit token must use 개 classifier"],
  [/주문\s*\d+장/u, "spell must use 개 classifier"],
  [/유닛\s*\d+장/u, "unit must use 명 classifier"],
  [/(?:도구|장착물)\s*\d+장/u, "gear must use 개 classifier"],
  [/룬\s*\d+개/u, "rune must use 장 classifier"],
  [/룬\s*\d+장를/u, "rune 장 classifier must take 을"],
  [/\d+개을/u, "개 classifier must take 를"],
  [/(?:^|\n|,\s)탈진:/u, "source-card exhaust cost must say 이 카드를 탈진"],
  [/위력이\s*\d+인\s+[^\n.]*토큰/u, "token Might must use N 위력 prefix"],
  [/카드를\s*\d+장\s*(?:뽑|버)/u, "card count must use 카드 N장을"],
  [/\[(?:예측|통찰)(?:\s+\d+)?\](?:을|를)?\s*(?:합니다|한|하려면)/u, "standalone keyword action must not add 하다"],
  [/\[추가\](?:을|를)?\s*(?:합니다|한|하려면)/u, "Add keyword must not add 하다"],
  [/(?:에너지|(?:신체|평정|혼돈|분노|정신|질서)?\s*힘)\s*\d+(?:을|를)\s*추가합니다/u, "resource Add must remain the [추가] keyword"]
];
for (const [setId, expected] of completeUnofficialSets) {
  const setCards = Object.values(cards).filter((card) => String(card.cardNumber || "").startsWith(`${setId}-`));
  if (setCards.length !== expected) errors.push(`${setId}: expected ${expected} registered cards, found ${setCards.length}`);
  for (const card of setCards) {
    const translation = CARD_KO_TRANSLATIONS[card.cardNumber];
    if (!translation) {
      errors.push(`${card.cardNumber} ${card.name}: missing Korean translation`);
      continue;
    }
    const combined = `${translation.koName || ""}\n${translation.koHeader || ""}\n${translation.koTypeLine || ""}\n${translation.koText || ""}`;
    if (/스피릿포지드\s+\d+번 카드|카드 이미지의 인쇄 문구를 기준으로 효과를 적용/u.test(combined)) {
      errors.push(`${card.cardNumber} ${card.name}: placeholder Korean translation`);
    }
    const unexpectedEnglish = combined.replace(/XP|B\.F\./gu, "").match(/[A-Za-z]{2,}/gu);
    if (unexpectedEnglish) {
      errors.push(`${card.cardNumber} ${card.name}: untranslated English ${[...new Set(unexpectedEnglish)].join(", ")}`);
    }
  }
}
for (const card of Object.values(cards)) {
  const translation = CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber];
  if (!translation || translation.printedTextEmpty) continue;
  // Exact official prose (including reminders such as 얻습니다) is checked above
  // against the source, not against the style rules for authored translations.
  if (translation.translationStatus) continue;
  const korean = translateCardText(card, "ko");
  for (const term of forbiddenTerms) {
    if (korean.includes(term)) errors.push(`${card.collectorNumber} ${card.name}: forbidden term ${term}`);
  }
  if (korean.includes("얻습니다")) errors.push(`${card.collectorNumber} ${card.name}: noncanonical 얻습니다`);
  if (resourceConfusion.test(korean)) {
    errors.push(`${card.collectorNumber} ${card.name}: energy/power cost translated as rune or resource`);
  }
  for (const [pattern, message] of styleViolations) {
    if (pattern.test(korean)) errors.push(`${card.collectorNumber} ${card.name}: ${message}`);
  }
  const englishForRequiredTerms = String(card.text || "").replace(
    /\b(Body|Calm|Chaos|Fury|Mind|Order)\s*\(\s*\1\s+Power\s*\)/giu,
    "$1"
  );
  for (const rule of requiredTerms) {
    if (rule.english.test(englishForRequiredTerms) && !rule.korean.test(korean)) {
      errors.push(`${card.collectorNumber} ${card.name}: missing ${rule.name}`);
    }
  }

  const english = card.text || "";
  for (const [englishKeyword, entry] of Object.entries(keywordTranslations)) {
    const englishPattern = new RegExp(`\\[${escapeRegExp(englishKeyword)}(?:\\s+\\d+\\+?)?\\]`, "iu");
    if (!englishPattern.test(english)) continue;
    const koreanPattern = new RegExp(`\\[${escapeRegExp(entry.ko)}(?:\\s+\\d+\\+?)?\\]`, "u");
    if (!koreanPattern.test(korean)) {
      errors.push(`${card.collectorNumber} ${card.name}: missing [${englishKeyword}]/[${entry.ko}] keyword`);
    }
  }
  const usesAddKeyword = /\[Add\]|\bADD\b|\bAdd\s+\d+\s*\.|\bAdd\b[^.\n]{0,40}\b(?:Energy|Power)\b/u.test(english);
  if (usesAddKeyword && !/\[추가\]/u.test(korean)) {
    errors.push(`${card.collectorNumber} ${card.name}: missing Add/[추가] keyword`);
  }
  if (/\bMighty\b/iu.test(english)) {
    if (!/\[위력적\]/u.test(korean)) errors.push(`${card.collectorNumber} ${card.name}: missing Mighty/[위력적] keyword`);
    if (/(?<!\[)강력(?:한|합니다|\s*상태)|\[강력\]|\[위력적\]\s*상태/u.test(korean)) {
      errors.push(`${card.collectorNumber} ${card.name}: Mighty must remain the [위력적] keyword`);
    }
  }
  if (/\bcounter\b/iu.test(english) && !/차단/u.test(korean)) {
    errors.push(`${card.collectorNumber} ${card.name}: missing Counter/차단 term`);
  }
  if (/\breturn\b[^.\n]{0,120}\bfrom your trash to your hand\b/iu.test(english)) {
    if (!/[^.\n]+(?:을|를) 내 폐기장에서 내 손으로 되돌/u.test(korean)) {
      errors.push(`${card.collectorNumber} ${card.name}: trash-to-hand text must use [대상]을 내 폐기장에서 내 손으로 되돌립니다`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Audited Korean terminology for ${Object.keys(cards).length} card records.`);
}
