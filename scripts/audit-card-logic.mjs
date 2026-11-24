import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";
import { describeEffectKo } from "../src/cards/koreanEffectSummary.mjs";
import { effectDefinition, effectKey } from "../src/effects/registry.mjs";
import { keywordBehaviorEffectSpecs } from "../src/rules/keywords.mjs";
import { parseArgs, writeJson } from "./card-script-utils.mjs";
import { derivePublishedCardFindings } from "./card-rules-judge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "artifacts", "card-logic-audit.json");
const SNAPSHOT_PATHS = [
  "spec/cards/ogs-official-2026-07-14.json",
  "spec/cards/official-gallery-2026-07-14.json",
  "spec/cards/spiritforged-official-2026-08-29.json",
  "spec/cards/unleashed-official-2026-08-29.json",
  "spec/cards/vendetta-official-2026-08-29.json"
];

const OPERATIONS = Object.freeze([
  operation("draw", /(?<!-)\bdraw\b/iu, /뽑/u, ["draw", "search", "predict", "chooseTop", "revealTop"]),
  operation("discard", /\bdiscard\b/iu, /버(?:리|립|린|릴|렸|려)/u, ["discard", "invertTimelines"]),
  operation("recycle", /\brecycle\b/iu, /재활용/u, ["recycle", "predict", "search", "revealTop", "chooseTop"]),
  operation("kill", /\bkill\b/iu, /처치|죽/u, ["kill", "death", "divineJudgment"], ["Temporary"]),
  operation("damage", /\b(?:deal|deals)\b[^.\n]*(?:damage|\d)|\bBonus Damage\b/iu, /피해/u, ["damage", "strike", "duel", "alpha", "stareDown", "facebreaker", "stormbringer"]),
  operation("ready", /\bready\b/iu, /준비/u, ["ready", "entersReady", "conditionalEnterReady", "possession"]),
  operation("exhaust", /\bexhaust\b/iu, /탈진/u, ["exhaust", "stun", "possession"]),
  operation("recall", /\brecall\b/iu, /귀환|기지로/u, ["recall", "returnUnitToBase", "save", "possession", "fightOrFlight"]),
  operation("move", /\bmove\b/iu, /이동|옮기|맞바꾸|맞바꿉|기지로\s*(?:보내|보냅)/u, ["move", "moonfall", "callToBattle", "heroicCharge", "possession"], ["Ganking"]),
  operation("playToken", /\bplay\b[^.\n]{0,50}(?<!non-)\btokens?\b/iu, /토큰|분신|모래 병사|신병|요정 유닛|새 유닛/u, ["playToken", "playUnitToken", "reflection", "recruit", "partyFavors"]),
  operation("gainXp", /\bgain\s+\d+\s+XP\b/iu, /XP[^.\n]{0,16}획득|XP를 획득/u, ["gainXp", "hunt"], ["Hunt"]),
  operation("score", /\bscore\s+\d+\s+points?\b/iu, /점수[^.\n]{0,16}획득|득점|\d+점(?:을)?\s*(?:획득|얻)/u, ["gainPoint", "score", "winIf"]),
  operation("buff", /\bbuff\b/iu, /버프/u, ["buff"]),
  operation("counter", /\bcounter\b/iu, /차단/u, ["counter"]),
  operation("channel", /\bchannel\b/iu, /전개/u, ["channel"]),
  operation("returnHand", /\breturn\b[^.\n]{0,80}\bhand\b/iu, /손으로/u, ["return", "guerilla", "morbid", "starCrossed"]),
  operation("stun", /\bstun\b/iu, /기절/u, ["stun"]),
  operation("attach", /\battach\b/iu, /부착|장착/u, ["attach", "equip", "weaponmaster"], ["Equip", "Weaponmaster"]),
  operation("reveal", /\breveal\b/iu, /공개/u, ["reveal", "search", "predict", "chooseTop"]),
  operation("look", /\blook at\b/iu, /확인|살펴/u, ["look", "search", "predict", "chooseTop", "revealTop"]),
  operation("hide", /\bhide\b/iu, /숨/u, ["hide", "hidden"], ["Hidden"]),
  operation("banish", /\bbanish\b/iu, /추방/u, ["banish"]),
  operation("heal", /\bheal\b/iu, /회복/u, ["heal", "save", "recall"]),
  operation("control", /\b(?:take|gain|lose) control\b/iu, /조종권|조종|통제/u, ["possession", "steal", "control"])
]);

// Named composite effects still use shared resolvers, but their kind names do not
// enumerate every rules verb they execute. Keeping that contract explicit makes
// the per-card audit semantic instead of relying on substring coincidences.
const EFFECT_OPERATION_CONTRACTS = Object.freeze({
  playOpponentTopDeckCard: ["reveal", "banish", "recycle"],
  standUnited: ["buff"],
  playTopDeckUnitFromLook: ["look", "banish", "recycle"],
  partyFavors: ["draw", "channel"],
  damageEnemyByHiddenTopDeck: ["reveal", "recycle", "damage"],
  extraTurn: ["banish"],
  recycleOpponentNonUnit: ["reveal", "recycle"],
  udyrChooseMode: ["damage", "ready", "buff", "stun"],
  playTopDeckUnitIgnoreCost: ["reveal", "recycle"],
  discardOpponentHand: ["reveal", "discard"],
  playFromTopReveal: ["look"],
  runeDeckGambit: ["draw", "recycle", "damage", "stun", "reveal"],
  facebreaker: ["stun"],
  baitedHook: ["look", "kill", "banish", "recycle"],
  divineJudgment: ["recycle"],
  stormbringer: ["damage", "move"],
  dragonsRage: ["damage", "move"],
  lastBreath: ["damage", "ready"],
  zenithBlade: ["move", "stun"],
  showstopper: ["move", "buff"],
  saveBuffedFriendlyUnitBySett: ["exhaust", "recall", "heal"],
  returnFriendlyUnitHereToBase: ["move"],
  recycleTopDeck: ["look", "recycle"],
  stealEnemyGear: ["move", "control", "attach"],
  legendAttachEquipment: ["exhaust", "attach"],
  revealOpponentHand: ["reveal", "look"],
  drawDiscardTypeBonus: ["draw", "discard", "ready"],
  swapFriendlyUnitLocations: ["move", "draw"],
  anyDamageIsLethal: ["kill"],
  discardExhaustPlayReflectionCopy: ["discard", "exhaust", "playToken", "ready"]
  ,replaceChosenDisableWithBuff: ["stun", "returnHand"]
  ,lookTopPlayUnitOrGearReducedThenEmpower: ["look", "banish", "recycle"]
  ,swapWithControlledToken: ["move"]
  ,rebuttal: ["counter", "control"]
});

export function auditCardLogic(cardPool = Object.values(cards), options = {}) {
  const official = options.official || readOfficialCards();
  const rows = cardPool
    .slice()
    .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber, "en", { numeric: true }))
    .map((card) => auditCard(card, officialRecord(official, card.cardNumber)));
  const findings = rows.flatMap((row) => row.findings);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "One row per registered card: official source, Korean semantics, executable declaration, and UI render contract.",
    cardCount: rows.length,
    passedCardCount: rows.filter((row) => row.status === "pass").length,
    failedCardCount: rows.filter((row) => row.status === "fail").length,
    findingCount: findings.length,
    findingsByCode: countBy(findings, (finding) => finding.code),
    cards: rows
  };
}

function auditCard(card, published) {
  const findings = [];
  const officialText = publishedRulesText(published) || card.text || "";
  const rulesText = stripReminderText(officialText).replace(/\[[^\]]+\]/gu, " ");
  const translation = CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber];
  const koreanText = translation?.koText || "";
  const printedTextEmpty = translation?.printedTextEmpty === true;
  const behaviorEffects = [...(card.effects || []), ...keywordBehaviorEffectSpecs(card)];
  const publishedRecord = published ? { ...published, rulesText: publishedRulesText(published) } : null;
  const publishedMetadataFindings = publishedRecord
    && (Object.hasOwn(publishedRecord, "effectiveText") || Object.hasOwn(publishedRecord, "printedText"))
    ? derivePublishedCardFindings(card, publishedRecord)
    : [];

  if (!published) findings.push(finding(card, "OFFICIAL_SOURCE_MISSING", "공식 카드 스냅샷이 없습니다."));
  for (const item of publishedMetadataFindings) {
    findings.push(finding(card, item.code, item.message, { expected: item.expected, actual: item.actual }));
  }
  if (!translation?.koName || (officialText && !translation?.koText && !printedTextEmpty) || !translation?.koTypeLine) {
    findings.push(finding(card, "KOREAN_TRANSLATION_MISSING", "한국어 이름·유형·규칙 문구 중 일부가 없습니다."));
  }
  if (/[A-Za-z]{3,}/u.test(koreanText.replace(/XP|B\.F\./gu, ""))) {
    findings.push(finding(card, "KOREAN_ENGLISH_FRAGMENT", "한국어 규칙 문구에 번역되지 않은 영문 조각이 있습니다."));
  }

  for (const operation of OPERATIONS) {
    if (!operation.english.test(rulesText)) continue;
    if (!supportsOperation(card, behaviorEffects, operation)) {
      findings.push(finding(card, "RULE_OPERATION_UNMAPPED", `공식 문구의 ${operation.id} 동작을 선언 효과에서 찾지 못했습니다.`, { operation: operation.id }));
    }
    if (!printedTextEmpty && translation?.koText && !operation.korean.test(koreanText)) {
      findings.push(finding(card, "KOREAN_OPERATION_MISSING", `공식 문구의 ${operation.id} 의미가 한국어 문구에 드러나지 않습니다.`, { operation: operation.id }));
    }
  }

  const expectedNumbers = printedTextEmpty ? [] : meaningfulNumbers(rulesText);
  const translatedNumbers = koreanNumbers(koreanText);
  const missingNumbers = expectedNumbers.filter((number) => !translatedNumbers.has(number));
  if (missingNumbers.length) {
    findings.push(finding(card, "KOREAN_NUMBER_MISSING", "공식 규칙 문구의 수치가 한국어 문구에 없습니다.", { missingNumbers }));
  }
  if (!printedTextEmpty && /\bmay\b/iu.test(rulesText) && !/수 있|선택 가능|원한다면|않아도/u.test(koreanText)) {
    findings.push(finding(card, "KOREAN_OPTIONALITY_MISSING", "공식 문구의 선택 가능성이 한국어 문구에 드러나지 않습니다."));
  }

  for (const effect of behaviorEffects) {
    if (!effectDefinition(effect)) {
      findings.push(finding(card, "EFFECT_DEFINITION_MISSING", `${effectKey(effect)} 공용 효과 정의가 없습니다.`));
    }
  }
  if (meaningfulAttachedEffectText(published?.effectText) && !(card.effects || []).some((effect) => effect.textSection === "effect")) {
    findings.push(finding(card, "ATTACHED_EFFECT_TEXT_UNMAPPED", "장착 중 효과 문구가 textSection:effect로 선언되지 않았습니다."));
  }

  const ui = {
    hasImage: card.type === "rune" || Boolean(card.image),
    hasKoreanName: Boolean(translation?.koName),
    hasKoreanText: !card.text || Boolean(translation?.koText) || printedTextEmpty,
    hasKoreanTypeLine: Boolean(translation?.koTypeLine),
    renderStringsSafe: [translation?.koName, translation?.koText, translation?.koTypeLine]
      .filter(Boolean)
      .every((value) => typeof value === "string" && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value))
  };
  if (!Object.values(ui).every(Boolean)) findings.push(finding(card, "UI_RENDER_CONTRACT_MISSING", "카드 UI 렌더링에 필요한 이미지 또는 한국어 문자열이 없습니다.", ui));

  return {
    cardNumber: card.cardNumber,
    name: card.name,
    set: card.set,
    type: card.type,
    officialSource: published?.sourceUrl || published?.sourceUrls?.[0] || published?.snapshotPath || null,
    officialMetadata: {
      snapshotPresent: Boolean(published),
      strictStructuredComparison: Boolean(publishedRecord
        && (Object.hasOwn(publishedRecord, "effectiveText") || Object.hasOwn(publishedRecord, "printedText"))),
      matched: publishedMetadataFindings.length === 0
    },
    officialText,
    koreanName: translation?.koName || null,
    koreanText: translation?.koText || null,
    effectKeys: behaviorEffects.map(effectKey),
    ui,
    status: findings.length ? "fail" : "pass",
    findings
  };
}

function supportsOperation(card, effects, operation) {
  const declarationText = JSON.stringify({ additionalCost: card.additionalCost || null, effects }).toLowerCase();
  if (operation.kindParts.some((part) => declarationText.includes(part.toLowerCase()))) return true;
  if (operation.keywords.some((keyword) => (card.keywords || []).includes(keyword))) return true;
  if (operation.id === "discard" && /discard/i.test(card.additionalCost?.kind || "")) return true;
  if (operation.id === "kill" && /kill/i.test(card.additionalCost?.kind || "")) return true;
  if (operation.id === "ready" && (card.keywords || []).includes("Accelerate")) return true;
  return effects.some((effect) => {
    if ((EFFECT_OPERATION_CONTRACTS[effect.kind] || []).includes(operation.id)) return true;
    const kind = String(effect.kind || "").toLowerCase();
    if (operation.kindParts.some((part) => kind.includes(part.toLowerCase()))) return true;
    if (operation.korean.test(describeEffectKo(effect))) return true;
    if (operation.id === "discard" && /discard/iu.test(effect.timing || "")) return true;
    if (operation.id === "playToken" && (effect.tokenKind || effect.tokenCardNumber)) return true;
    if (operation.id === "exhaust" && effect.exhaust) return true;
    return false;
  });
}

function operation(id, english, korean, kindParts, keywords = []) {
  return { id, english, korean, kindParts, keywords };
}

function meaningfulNumbers(text) {
  const normalized = String(text)
    .replace(/\btwo\b/giu, " 2 ")
    .replace(/\bthree\b/giu, " 3 ")
    .replace(/\bfour\b/giu, " 4 ")
    .replace(/\bfive\b/giu, " 5 ");
  return [...new Set([...normalized.matchAll(/(?<![A-Za-z])\d+(?![A-Za-z])/gu)].map((match) => Number(match[0])))];
}

function koreanNumbers(text) {
  const values = [...String(text).matchAll(/(?<![A-Za-z])\d+(?![A-Za-z])/gu)].map((match) => Number(match[0]));
  const words = [[/한|하나/u, 1], [/두|둘/u, 2], [/세|셋/u, 3], [/네|넷/u, 4]];
  for (const [pattern, value] of words) if (pattern.test(text)) values.push(value);
  return new Set(values);
}

function stripReminderText(text) {
  let value = String(text || "");
  let previous;
  do {
    previous = value;
    value = value.replace(/\([^()]*\)/gu, " ");
  } while (value !== previous);
  return value.replace(/\s+/gu, " ").trim();
}

function publishedRulesText(card) {
  if (!card) return null;
  const printed = card.effectiveText || card.rulesText || card.printedText || "";
  return [printed, meaningfulAttachedEffectText(card.effectText)].filter(Boolean).join("\n") || null;
}

function meaningfulAttachedEffectText(value) {
  const text = String(value || "").trim();
  return /[A-Za-z]/.test(text) ? text : "";
}

function readOfficialCards() {
  const result = new Map();
  for (const relativePath of SNAPSHOT_PATHS) {
    const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
    for (const card of snapshot.cards || []) result.set(card.cardNumber, { ...card, snapshotPath: relativePath });
  }
  return result;
}

function officialRecord(records, cardNumber) {
  if (records.has(cardNumber)) return records.get(cardNumber);
  const variant = /^(OGN-\d+)[abs]\/298$/iu.exec(cardNumber || "");
  return variant ? records.get(`${variant[1]}/298`) || null : null;
}

function finding(card, code, message, details) {
  return { code, cardNumber: card.cardNumber, cardName: card.name, message, ...(details ? { details } : {}) };
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const report = auditCardLogic();
  const output = args.output ? path.resolve(ROOT, String(args.output)) : DEFAULT_OUTPUT;
  writeJson(output, report);
  console.log(`Audited ${report.cardCount} cards: ${report.passedCardCount} passed, ${report.failedCardCount} need review. Report: ${path.relative(ROOT, output)}`);
  console.log(JSON.stringify(report.findingsByCode, null, 2));
  if (args.strict && report.failedCardCount) process.exitCode = 1;
}

await run();
