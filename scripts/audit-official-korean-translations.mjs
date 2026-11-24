import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";
import { koreanGalleryText, officialKoreanSourceNumber } from "./official-korean-gallery.mjs";

export function auditOfficialKoreanTranslations(translations = CARD_KO_TRANSLATIONS) {
  const snapshot = JSON.parse(fs.readFileSync(new URL("../spec/cards/official-korean-gallery-2026-09-22.json", import.meta.url), "utf8"));
  const review = JSON.parse(fs.readFileSync(new URL("../spec/cards/korean-translation-review-2026-09-22.json", import.meta.url), "utf8"));
  const supplemental = JSON.parse(fs.readFileSync(new URL("../spec/cards/official-korean-launch-2026-09-22.json", import.meta.url), "utf8"));
  const sources = new Map([...snapshot.cards, ...supplemental.cards].map((entry) => [entry.cardNumber, entry]));
  const errors = [];
  for (const [set, count] of [["OGN", 352], ["OGS", 24]]) {
    if (snapshot.cards.filter((entry) => entry.cardNumber.startsWith(`${set}-`)).length !== count) errors.push(`${set}: incomplete official Korean snapshot`);
  }
  const requested = new Set([...sources.keys(), ...Object.values(cards).map((card) => card.cardNumber).filter((number) => /^OG[NS]-/u.test(number))]);
  for (const number of requested) {
    const translation = translations[number];
    const sourceNumber = officialKoreanSourceNumber(number);
    const source = sources.get(sourceNumber);
    if (!source || !translation) { errors.push(`${number}: missing sourced Korean translation`); continue; }
    const correction = review.corrections.find((entry) => entry.cardNumbers.includes(sourceNumber));
    const printed = review.printedTextOverrides.find((entry) => entry.cardNumbers.includes(sourceNumber));
    const raw = koreanGalleryText(source.rulesTextHtml);
    const label = correction?.classification === "clarification" ? "공식 번역 해석 주의" : "공식 번역 오역";
    const expected = correction ? `비공식 번역\n${label}: ${correction.reason}\n\n${correction.correctedText}` : raw;
    if (translation.koText !== expected) errors.push(`${number}: official wording or reviewed correction was rewritten`);
    if (translation.officialKoText !== (printed?.text || raw)) errors.push(`${number}: official original was not preserved`);
    if (translation.translationStatus !== (correction ? "unofficial-correction" : "official")) errors.push(`${number}: incorrect official/correction status`);
    if (!translation.officialTextSource?.includes(source.sourceUrl || snapshot.source.url) || translation.officialSourceCardNumber !== sourceNumber || translation.officialImageUrl !== source.imageUrl) errors.push(`${number}: missing or incorrect provenance`);
    const expectedImage = number === sourceNumber || /s\/298$/u.test(number) ? source.imageUrl : undefined;
    if (translation.koImageUrl !== expectedImage) errors.push(`${number}: Korean image does not match this printing`);
    if (Boolean(translation.printedTextEmpty) !== (!raw && !correction)) errors.push(`${number}: incorrect empty printed text flag`);
    if (printed && (translation.officialGalleryKoText !== raw || !translation.officialTextDiscrepancy)) errors.push(`${number}: image/gallery disagreement is hidden`);
    if (correction && (translation.translationCorrection?.id !== correction.id || translation.translationCorrection?.classification !== correction.classification || translation.translationCorrection?.correctedText !== correction.correctedText || !translation.translationCorrection?.evidence?.length)) errors.push(`${number}: missing correction explanation/evidence`);
    if (sourceNumber !== number && translation.translationInheritedFrom !== sourceNumber) errors.push(`${number}: missing art-variant inheritance`);
    if (/:rb_|<\/?(?:p|br|li|ul)\b/u.test(translation.koText)) errors.push(`${number}: unrendered official symbols or HTML`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = auditOfficialKoreanTranslations();
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Verified official Korean sources, art variants, empty cards, and reviewed corrections.");
}
