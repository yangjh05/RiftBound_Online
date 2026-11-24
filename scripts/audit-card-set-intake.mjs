import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards as registeredCardMap } from "../src/cards.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL_GALLERY_URL = "https://playriftbound.com/en-us/card-gallery/";
const OFFICIAL_RULES_HUB_URL = "https://playriftbound.com/en-us/rules-hub/";

export const SET_INTAKE_CONFIG = Object.freeze({
  SFD: Object.freeze({
    name: "Spiritforged",
    implementationOrder: Object.freeze([
      Object.freeze({
        id: "source-baseline",
        label: "공식 소스와 누적 정오표 고정",
        dependencies: [],
        canaries: []
      }),
      Object.freeze({
        id: "state-foundation",
        label: "부착·비활성 텍스트·범용 토큰·복합 비용 기반",
        dependencies: ["source-baseline"],
        canaries: ["SFD-051/221", "SFD-115/221"]
      }),
      Object.freeze({
        id: "gold",
        label: "Gold 생성과 결제 수단",
        dependencies: ["state-foundation"],
        canaries: ["SFD-130/221", "SFD-074/221", "SFD-201/221"]
      }),
      Object.freeze({
        id: "equip",
        label: "Equip·Detach와 Equipment 효과 텍스트",
        dependencies: ["state-foundation"],
        canaries: ["SFD-161/221", "SFD-118/221", "SFD-178/221", "SFD-150/221", "SFD-011/221"]
      }),
      Object.freeze({
        id: "derived-equipment-keywords",
        label: "Quick-Draw·Weaponmaster·부착 트리거",
        dependencies: ["equip"],
        canaries: ["SFD-022/221", "SFD-002/221", "SFD-054/221", "SFD-119/221"]
      }),
      Object.freeze({
        id: "repeat",
        label: "Repeat 추가 비용·선택 선언·명령 재실행",
        dependencies: ["state-foundation"],
        canaries: ["SFD-034/221", "SFD-122/221", "SFD-023/221", "SFD-077/221", "SFD-078/221", "SFD-211/221"]
      }),
      Object.freeze({
        id: "rules-edges",
        label: "FAQ·정오표 경계와 복합 상호작용",
        dependencies: ["gold", "derived-equipment-keywords", "repeat"],
        canaries: ["SFD-020/221", "SFD-059/221", "SFD-202/221", "SFD-060/221", "SFD-116/221"]
      }),
      Object.freeze({
        id: "bulk-import",
        label: "검증된 효과군별 대량 import와 전체 회귀 검증",
        dependencies: ["rules-edges"],
        canaries: []
      })
    ]),
    errataSources: Object.freeze([
      Object.freeze({
        publishedAt: "2026-01-14",
        url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/"
      }),
      Object.freeze({
        publishedAt: "2026-04-03",
        url: "https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/"
      }),
      Object.freeze({
        publishedAt: "2026-07-23",
        url: "https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates/"
      })
    ])
  }),
  UNL: Object.freeze({
    name: "Unleashed",
    implementationOrder: Object.freeze([
      Object.freeze({ id: "source-baseline", label: "공식 목록·유효 문구·누적 정오표 고정", dependencies: [], canaries: [] }),
      Object.freeze({ id: "hidden", label: "Hidden·뒷면 카드·공개 반응 흐름", dependencies: ["source-baseline"], canaries: ["UNL-138/219"] }),
      Object.freeze({ id: "tokens", label: "동물·Sprite·Gold·Reflection 토큰 생태계", dependencies: ["source-baseline"], canaries: ["UNL-145/219"] }),
      Object.freeze({ id: "xp-level", label: "XP 추가 비용·Level·전투 승리 보상", dependencies: ["source-baseline"], canaries: ["UNL-095/219", "UNL-140/219"] }),
      Object.freeze({ id: "temporary-death", label: "Temporary·사망 추적·사망 대체·지연 효과", dependencies: ["tokens"], canaries: ["UNL-007/219", "UNL-073/219", "UNL-172/219"] }),
      Object.freeze({ id: "movement", label: "Ganking·복수 유닛 이동·이동 비용 선언", dependencies: ["hidden"], canaries: ["UNL-045/219"] }),
      Object.freeze({ id: "repeat", label: "서로 다른 Repeat 비용·모드·대상 사전 선언", dependencies: ["xp-level"], canaries: ["UNL-182/219"] }),
      Object.freeze({ id: "trash-zone", label: "폐기장 사용·조종권·추방 연계", dependencies: ["temporary-death"], canaries: ["UNL-165/219", "UNL-168/219"] }),
      Object.freeze({ id: "battlefield", label: "전장 유발·전장 토큰 교체·턴당 최초 사건", dependencies: ["movement", "tokens"], canaries: ["UNL-215/219"] }),
      Object.freeze({ id: "bulk-verification", label: "효과군별 일괄 등록·UI·한국어·비AI 전체 검증", dependencies: ["repeat", "trash-zone", "battlefield"], canaries: [] })
    ]),
    errataSources: Object.freeze([
      Object.freeze({
        publishedAt: "2026-04-03",
        url: "https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/"
      }),
      Object.freeze({
        publishedAt: "2026-07-23",
        url: "https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates/"
      })
    ])
  })
});

export const MECHANIC_FAMILIES = Object.freeze([
  Object.freeze({
    id: "attachment-ecosystem",
    label: "Equipment/Attach/Detach 상호작용",
    sets: ["SFD"],
    matches: (card) => /\bEquipment\b|attach|detach/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "equip",
    label: "Equip 장비",
    sets: ["SFD"],
    matches: (card) => card.type === "gear" && /\[Equip\]/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "quick-draw",
    label: "Quick-Draw 및 부여",
    sets: ["SFD"],
    matches: (card) => /\[Quick-Draw\]/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "weaponmaster",
    label: "Weaponmaster 및 부여",
    sets: ["SFD"],
    matches: (card) => /\[Weaponmaster\]/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "repeat",
    label: "Repeat 및 비용 변경/부여",
    sets: ["SFD"],
    matches: (card) => /\[Repeat\]/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "gold",
    label: "Gold 생성/변경",
    sets: ["SFD"],
    matches: (card) => /\bGold\b/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "mech-token",
    label: "Mech 토큰 생성",
    sets: ["SFD"],
    matches: (card) => /Mech unit token/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "sand-soldier-token",
    label: "Sand Soldier 토큰 생성",
    sets: ["SFD"],
    matches: (card) => /Sand Soldier unit token/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "hidden-facedown",
    label: "Hidden·뒷면 카드",
    sets: ["UNL"],
    matches: (card) => /\[Hidden\]|facedown|hide\b/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "unleashed-tokens",
    label: "동물·Sprite·Gold·Reflection 토큰",
    sets: ["UNL"],
    matches: (card) => /(?:Bird|Cat|Dog|Poro|Sprite|Gold|Reflection) (?:unit|gear )?token/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "xp-level",
    label: "XP·Level 연계",
    sets: ["UNL"],
    matches: (card) => /\bXP\b|\[Level\]/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "temporary",
    label: "Temporary 생성·상호작용",
    sets: ["UNL"],
    matches: (card) => /\[Temporary\]|\bTemporary\b/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "unleashed-repeat",
    label: "Repeat·복수 모드",
    sets: ["UNL"],
    matches: (card) => /\[Repeat\]|\brepeat\b/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "movement-ganking",
    label: "이동·Ganking",
    sets: ["UNL"],
    matches: (card) => /\[Ganking\]|\bmove\b/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "death-replacement",
    label: "사망·처치·대체 효과",
    sets: ["UNL"],
    matches: (card) => /\[Deathknell\]|\bdies?\b|\bkill\b|banish it instead/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "trash-play",
    label: "폐기장 사용·회수",
    sets: ["UNL"],
    matches: (card) => /\btrash\b/i.test(card.rulesText)
  }),
  Object.freeze({
    id: "battlefield-replacement",
    label: "전장 토큰·전장 교체",
    sets: ["UNL"],
    matches: (card) => /Battlefield token|replace (?:a|the) battlefield/i.test(card.rulesText)
  })
]);

export function canonicalNumberedSetCards(items, setId, collectorNumberMax) {
  const escapedSet = escapeRegExp(setId);
  const escapedMaximum = escapeRegExp(String(collectorNumberMax));
  const pattern = new RegExp(`^${escapedSet}-(\\d{3})/${escapedMaximum}$`);
  const byNumber = new Map();

  for (const rawCard of items || []) {
    const card = normalizeGalleryCard(rawCard);
    const match = card.cardNumber.match(pattern);
    if (!match) continue;
    const collectorNumber = Number(match[1]);
    if (collectorNumber < 1 || collectorNumber > collectorNumberMax) continue;
    byNumber.set(card.cardNumber, { ...card, collectorNumber });
  }

  return [...byNumber.values()].sort((left, right) => left.collectorNumber - right.collectorNumber);
}

export function buildSetIntakeReport({
  galleryItems,
  gallerySets,
  registeredCards,
  setId,
  officialRulesDate = null,
  localRulesDate = null
}) {
  const normalizedSetId = String(setId || "").trim().toUpperCase();
  const setRecord = (gallerySets || []).find((set) => String(set.id || "").toUpperCase() === normalizedSetId);
  if (!setRecord) throw new Error(`Official gallery has no set '${normalizedSetId}'.`);

  const officialCards = canonicalNumberedSetCards(
    galleryItems,
    normalizedSetId,
    Number(setRecord.collectorNumberMax)
  );
  const officialByNumber = new Map(officialCards.map((card) => [card.cardNumber, card]));
  const registeredByNumber = new Map((registeredCards || []).map((card) => [card.cardNumber, card]));
  const implemented = officialCards.filter((card) => registeredByNumber.has(card.cardNumber));
  const missing = officialCards.filter((card) => !registeredByNumber.has(card.cardNumber));
  const unmatchedRegistered = (registeredCards || [])
    .filter((card) => String(card.cardNumber || "").startsWith(`${normalizedSetId}-`))
    .filter((card) => !officialByNumber.has(card.cardNumber))
    .map((card) => card.cardNumber)
    .sort(cardNumberSort);

  const types = Object.entries(officialCards.reduce((counts, card) => {
    counts[card.type || "unknown"] = (counts[card.type || "unknown"] || 0) + 1;
    return counts;
  }, {})).map(([type, count]) => ({ type, count }));

  const mechanics = MECHANIC_FAMILIES
    .filter((family) => !family.sets?.length || family.sets.includes(normalizedSetId))
    .map((family) => {
    const members = officialCards.filter(family.matches);
    const implementedMembers = members.filter((card) => registeredByNumber.has(card.cardNumber));
    return {
      id: family.id,
      label: family.label,
      official: members.length,
      implemented: implementedMembers.length,
      missing: members.length - implementedMembers.length,
      cardNumbers: members.map((card) => card.cardNumber),
      implementedCardNumbers: implementedMembers.map((card) => card.cardNumber)
    };
    });

  const config = SET_INTAKE_CONFIG[normalizedSetId] || null;
  const warnings = [];
  if (officialCards.length !== Number(setRecord.collectorNumberMax)) {
    warnings.push(`Numbered gallery coverage is ${officialCards.length}/${setRecord.collectorNumberMax}.`);
  }
  if (officialRulesDate && localRulesDate && localRulesDate < officialRulesDate) {
    warnings.push(`Local Core Rules snapshot ${localRulesDate} is older than the official ${officialRulesDate} baseline.`);
  }
  if (config?.errataSources?.length) {
    warnings.push("Official gallery text is printed text; apply every listed errata source before authoring effects.");
  }

  return {
    schemaVersion: 1,
    set: {
      id: normalizedSetId,
      name: setRecord.name,
      collectorNumberMax: Number(setRecord.collectorNumberMax),
      officialNumberedCards: officialCards.length,
      types
    },
    implementation: {
      registered: implemented.length,
      missing: missing.length,
      coveragePercent: officialCards.length
        ? Number(((implemented.length / officialCards.length) * 100).toFixed(1))
        : 0,
      registeredCardNumbers: implemented.map((card) => card.cardNumber),
      missingCardNumbers: missing.map((card) => card.cardNumber),
      unmatchedRegisteredCardNumbers: unmatchedRegistered
    },
    mechanics,
    sources: {
      gallery: OFFICIAL_GALLERY_URL,
      rulesHub: OFFICIAL_RULES_HUB_URL,
      officialRulesDate,
      localRulesDate,
      errata: config?.errataSources || []
    },
    implementationOrder: config?.implementationOrder || [],
    warnings
  };
}

export function renderSetIntakeMarkdown(report) {
  const lines = [
    `# ${report.set.name} (${report.set.id}) 구현 인수 점검`,
    "",
    `- 본세트: ${report.set.officialNumberedCards}/${report.set.collectorNumberMax}장 확인`,
    `- 현재 등록: ${report.implementation.registered}장 (${report.implementation.coveragePercent}%)`,
    `- 미등록: ${report.implementation.missing}장`,
    `- Core Rules: 로컬 ${report.sources.localRulesDate || "미확인"} / 공식 ${report.sources.officialRulesDate || "미확인"}`,
    "",
    "## 카드 유형",
    "",
    "| 유형 | 장수 |",
    "| --- | ---: |",
    ...report.set.types.map((entry) => `| ${entry.type} | ${entry.count} |`),
    "",
    "## 기믹군",
    "",
    "| 기믹군 | 공식 | 구현 | 남음 |",
    "| --- | ---: | ---: | ---: |",
    ...report.mechanics.map((entry) => `| ${entry.label} | ${entry.official} | ${entry.implemented} | ${entry.missing} |`),
    "",
    "## 구현 순서",
    "",
    ...report.implementationOrder.map((phase, index) => {
      const dependencies = phase.dependencies.length ? ` · 선행: ${phase.dependencies.join(", ")}` : "";
      const canaries = phase.canaries.length ? ` · 대표 카드: ${phase.canaries.join(", ")}` : "";
      return `${index + 1}. ${phase.label}${dependencies}${canaries}`;
    })
  ];

  if (report.warnings.length) {
    lines.push("", "## 경고", "", ...report.warnings.map((warning) => `- ${warning}`));
  }
  if (report.implementation.missingCardNumbers.length) {
    lines.push(
      "",
      "## 다음 미등록 카드",
      "",
      report.implementation.missingCardNumbers.slice(0, 20).join(", "),
      report.implementation.missingCardNumbers.length > 20
        ? `\n(나머지 ${report.implementation.missingCardNumbers.length - 20}장은 --json 출력에서 확인)`
        : ""
    );
  }
  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const setId = String(args.set || "SFD").toUpperCase();
  const gallery = args.gallery
    ? loadGallerySnapshot(path.resolve(ROOT, String(args.gallery)))
    : await fetchOfficialGallery();
  const officialRulesDate = args["skip-rules-check"]
    ? null
    : await fetchOfficialRulesDate();
  const localRulesDate = latestLocalRulesDate();
  const report = buildSetIntakeReport({
    galleryItems: gallery.items,
    gallerySets: gallery.sets,
    registeredCards: Object.values(registeredCardMap),
    setId,
    officialRulesDate,
    localRulesDate
  });
  const output = args.json
    ? `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`
    : renderSetIntakeMarkdown(report);

  if (args.output) {
    const outputPath = path.resolve(ROOT, String(args.output));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, "utf8");
    console.log(`Wrote ${path.relative(ROOT, outputPath)}.`);
    return;
  }
  process.stdout.write(output);
}

async function fetchOfficialGallery() {
  const response = await fetch(OFFICIAL_GALLERY_URL, {
    headers: { "user-agent": "Riftbound-Online-Set-Intake/1.0" }
  });
  if (!response.ok) throw new Error(`Official card gallery returned HTTP ${response.status}.`);
  const html = await response.text();
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const payloadText = html.split(marker)[1]?.split("</script>")[0];
  if (!payloadText) throw new Error("Official card gallery did not contain __NEXT_DATA__.");
  const payload = JSON.parse(payloadText);
  const gallery = payload?.props?.pageProps?.page?.blades?.find((blade) => blade.type === "riftboundCardGallery");
  if (!gallery?.cards?.items?.length) throw new Error("Official card gallery contained no card records.");
  return { items: gallery.cards.items, sets: gallery.sets?.items || [] };
}

async function fetchOfficialRulesDate() {
  const response = await fetch(OFFICIAL_RULES_HUB_URL, {
    headers: { "user-agent": "Riftbound-Online-Set-Intake/1.0" }
  });
  if (!response.ok) throw new Error(`Official rules hub returned HTTP ${response.status}.`);
  const html = await response.text();
  const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = plainText.match(/Core Rules \(last updated:\s*([^)]+)\)/i);
  if (!match) return null;
  const timestamp = Date.parse(`${match[1]} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : match[1].trim();
}

function loadGallerySnapshot(filePath) {
  const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const items = snapshot.cards || snapshot.items || [];
  const sets = snapshot.sets || (snapshot.set ? [snapshot.set] : []);
  return { items, sets };
}

function latestLocalRulesDate() {
  const rulesDir = path.join(ROOT, "spec", "rules");
  const dates = fs.readdirSync(rulesDir)
    .map((fileName) => fileName.match(/^core-rules-(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter(Boolean)
    .sort();
  return dates.at(-1) || null;
}

function normalizeGalleryCard(card) {
  if (card.rulesText != null || card.effectiveText != null || card.printedText != null) {
    return {
      cardNumber: String(card.cardNumber || card.collectorNumber || card.publicCode || ""),
      name: card.name || "",
      type: card.type || card.cardType?.type?.[0]?.id || null,
      rulesText: String(card.effectiveText || card.rulesText || card.printedText || "")
    };
  }
  return {
    cardNumber: String(card.publicCode || card.cardNumber || ""),
    name: card.name || "",
    type: card.cardType?.type?.[0]?.id || card.type || null,
    rulesText: htmlToText(card.text?.richText?.body || "")
  };
}

function htmlToText(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function printHelp() {
  console.log(`
Usage:
  npm run audit:set -- --set SFD
  npm run audit:set -- --set SFD --json --output tmp/spiritforged-intake.json

Options:
  --set SFD              Official set prefix (default: SFD)
  --gallery <path>       Read a local official-gallery snapshot instead of the live gallery
  --skip-rules-check     Do not compare the local Core Rules snapshot with the Rules Hub
  --json                 Emit the full JSON report
  --output <path>        Write the report to a file
  --help                 Show this help
  `.trim());
}

function cardNumberSort(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
