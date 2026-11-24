import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";
import { KOREAN_DOMAINS, koreanGalleryText, officialKoreanSourceNumber } from "./official-korean-gallery.mjs";

const snapshot = JSON.parse(fs.readFileSync(new URL("../spec/cards/official-korean-gallery-2026-09-22.json", import.meta.url), "utf8"));
const review = JSON.parse(fs.readFileSync(new URL("../spec/cards/korean-translation-review-2026-09-22.json", import.meta.url), "utf8"));
const supplemental = JSON.parse(fs.readFileSync(new URL("../spec/cards/official-korean-launch-2026-09-22.json", import.meta.url), "utf8"));
const output = new URL("../src/cards/originsKoTranslations.mjs", import.meta.url);
const official = new Map([...snapshot.cards, ...supplemental.cards].map((entry) => [entry.cardNumber, entry]));
const registered = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
const numbers = [...new Set([...official.keys(), ...registered.keys()].filter((number) => /^OG[NS]-/u.test(number)))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const tags = {
  Ahri: "아리", Anivia: "애니비아", Annie: "애니", "Bandle City": "밴들 시티", Bilgewater: "빌지워터",
  Bird: "새", Blitzcrank: "블리츠크랭크", Caitlyn: "케이틀린", Cat: "고양이", Darius: "다리우스",
  Demacia: "데마시아", Dog: "개", "Dr. Mundo": "문도 박사", Dragon: "용", Draven: "드레이븐", Ekko: "에코",
  Elite: "정예", Fae: "요정", Fiora: "피오라", Freljord: "프렐요드", Garen: "가렌", Heimerdinger: "하이머딩거",
  Ionia: "아이오니아", Ixtal: "이쉬탈", Jinx: "징크스", "Kai'Sa": "카이사", Karma: "카르마", Karthus: "카서스",
  Kayn: "케인", "Kog'Maw": "코그모", "Lee Sin": "리 신", Leona: "레오나", Lux: "럭스", Malzahar: "말자하",
  "Master Yi": "마스터 이", Mech: "기계", "Miss Fortune": "미스 포츈", "Mount Targon": "타곤 산",
  Nocturne: "녹턴", Noxus: "녹서스", Piltover: "필트오버", Pirate: "해적", Poro: "포로", Qiyana: "키아나",
  Recruit: "신병", Sett: "세트", "Shadow Isles": "그림자 군도", Shen: "쉔", Shurima: "슈리마", Sona: "소나",
  Spirit: "정령", Taric: "타릭", Teemo: "티모", "The Void": "공허", Trifarian: "트리파르", Tryndamere: "트린다미어",
  "Twisted Fate": "트위스티드 페이트", Udyr: "우디르", Vayne: "베인", Vi: "바이", Viktor: "빅토르",
  Volibear: "볼리베어", Warwick: "워윅", Yasuo: "야스오", Yordle: "요들", Zaun: "자운"
};
const types = { unit: "유닛", spell: "주문", gear: "도구", legend: "전설", battlefield: "전장", rune: "룬" };
const supers = { Champion: "챔피언", Signature: "시그니처", Token: "토큰", "기본": "기본" };
const translations = {};
for (const number of numbers) {
  const sourceNumber = officialKoreanSourceNumber(number);
  const source = official.get(sourceNumber);
  if (!source) throw new Error(`Missing official Korean source for ${number}`);
  const card = registered.get(number);
  const koName = [source.name.replace(/ \((?:DE|NX|ZN)\)$/u, ""), source.type === "unit" && source.superTypes.includes("Champion") ? source.subtitle : null].filter(Boolean).join(", ");
  const header = [`[${koName}]`];
  const energy = card?.energy ?? source.energy;
  const might = card?.might ?? source.might;
  if (energy != null) header.push(`${energy} 에너지`);
  const costs = card?.power ?? (source.power ? [{ domain: "Any", amount: source.power }] : []);
  for (const cost of costs) {
    const domains = cost.domain === "Any" ? (card?.domains || source.domains) : [cost.domain];
    header.push(`${cost.amount} ${domains.map((domain) => KOREAN_DOMAINS[domain]).join("/")} 힘`);
  }
  if (might != null) header.push(`${might} 위력`);
  const metadataFix = review.metadataCorrections.find((item) => item.cardNumbers.includes(sourceNumber));
  const koTypeLine = [
    [...source.superTypes.map((type) => supers[type]), types[source.type]].filter(Boolean).join(" "),
    ...(metadataFix?.tags || source.tags).map((tag) => {
      if (!tags[tag]) throw new Error(`Unknown Korean tag: ${tag}`);
      return tags[tag];
    })
  ].join(", ");
  const galleryKoText = koreanGalleryText(source.rulesTextHtml);
  const correction = review.corrections.find((item) => item.cardNumbers.includes(sourceNumber));
  const printedOverride = review.printedTextOverrides.find((item) => item.cardNumbers.includes(sourceNumber));
  const officialKoText = printedOverride?.text || galleryKoText;
  const correctionLabel = correction?.classification === "clarification" ? "공식 번역 해석 주의" : "공식 번역 오역";
  const translation = {
    collectorNumber: number,
    englishName: card?.name || [source.englishName, source.englishSubtitle].filter(Boolean).join(", "),
    koName, koHeader: header.join(", "), koTypeLine,
    koText: correction ? `비공식 번역\n${correctionLabel}: ${correction.reason}\n\n${correction.correctedText}` : galleryKoText,
    translationStatus: correction ? "unofficial-correction" : "official",
    officialKoText,
    officialTextSource: `${snapshot.source.authority} 한국어 ${source.sourceUrl ? "출시 발표 카드 이미지" : "카드 갤러리"} (${snapshot.observedAt.slice(0, 10)}), ${sourceNumber}: ${source.sourceUrl || snapshot.source.url}`,
    officialSourceCardNumber: sourceNumber,
    officialImageUrl: source.imageUrl
  };
  // Text may be inherited across art variants; images must match this printing.
  if (number === sourceNumber || /s\/298$/u.test(number)) translation.koImageUrl = source.imageUrl;
  if (sourceNumber !== number) translation.translationInheritedFrom = sourceNumber;
  if (printedOverride) {
    translation.officialGalleryKoText = galleryKoText;
    translation.officialTextDiscrepancy = printedOverride.reason;
  }
  if (!officialKoText && !correction) translation.printedTextEmpty = true;
  if (correction) translation.translationCorrection = { id: correction.id, classification: correction.classification, reason: correction.reason, correctedText: correction.correctedText, evidence: correction.evidence };
  translations[number] = translation;
}
const content = `// Generated by scripts/build-official-korean-translations.mjs.\n// Source snapshots and reviewed corrections live in spec/cards; do not normalize official prose.\nexport const originsKoTranslations = ${JSON.stringify(translations, null, 2)};\n`;
if (process.argv.includes("--check")) {
  if (fs.readFileSync(output, "utf8") !== content) throw new Error("Official Korean translations are stale. Rebuild from the reviewed snapshot.");
} else {
  fs.writeFileSync(output, content, "utf8");
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} ${numbers.length} official Korean translation records: ${fileURLToPath(output)}`);
