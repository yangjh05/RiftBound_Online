import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";
import { OFFICIAL_TOKEN_DEFINITIONS } from "../src/rules/tokens.mjs";
import {
  LOCALES,
  t,
  translateCardName,
  translateCardTags,
  translateCardText,
  translateCostDomain,
  translateDomain,
  translateKeyword,
  translateType,
  translationMetadata
} from "../src/i18n.mjs";

const byNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number);

test("all app UI translation keys resolve to visible labels", () => {
  const source = fs.readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
  const keys = [...source.matchAll(/\bt\("([^"]+)"/g)]
    .map((match) => match[1])
    .filter((key) => /^[A-Za-z0-9_]+$/.test(key));
  for (const key of new Set(keys)) {
    assert.notEqual(t(key, LOCALES.EN), key, `missing English UI label for ${key}`);
    assert.notEqual(t(key, LOCALES.KO), key, `missing Korean UI label for ${key}`);
  }
});

test("the canonical Korean translation guide stays synchronized with keyword terminology", () => {
  const guide = fs.readFileSync(
    new URL("../docs/korean-card-translation-style.md", import.meta.url),
    "utf8"
  );
  const keywordMetadata = translationMetadata().keywords;

  assert.match(guide, /^# 리프트바운드 한국어 카드 번역 단일 기준$/mu);
  for (const [english, entry] of Object.entries(keywordMetadata)) {
    const status = entry.confirmed ? "확정" : "잠정";
    assert.ok(
      guide.includes(`| \`${english}\` | \`${entry.ko}\` | ${status} |`),
      `missing canonical guide row for ${english}`
    );
  }

  for (const type of ["legend", "battlefield", "unit", "spell", "gear", "rune"]) {
    assert.ok(
      guide.includes(`| \`${type}\` | \`${translateType(type, "ko")}\``),
      `missing canonical guide type row for ${type}`
    );
  }
  for (const domain of ["Body", "Calm", "Chaos", "Fury", "Mind", "Order", "Any"]) {
    assert.ok(
      guide.includes(`| \`${domain}\` | \`${translateDomain(domain, "ko")}\``),
      `missing canonical guide domain row for ${domain}`
    );
  }

  for (const requiredRule of [
    "`내가`는 플레이어 본인만 가리킵니다",
    "이 카드를 탈진:",
    "N의 피해를 입힙니다",
    "printedTextEmpty: true",
    "원문에 없는 `하다` 금지",
    "Mountain Drake",
    "Eclipse"
  ]) {
    assert.ok(guide.includes(requiredRule), `missing canonical guide rule: ${requiredRule}`);
  }
});

test("Korean translations use authored card sentences for example champion cards", () => {
  const yasuo = byNumber("OGN-076/298");
  const jinx = byNumber("OGN-030/298");
  const sett = byNumber("OGN-164/298");

  assert.equal(translateCardName(yasuo, "ko"), "야스오, 회한");
  assert.equal(
    translateCardText(yasuo, "ko"),
    "이 카드가 공격하면, 이곳에 있는 적 유닛 1명에게 이 카드의 위력과 동일한 피해를 입힙니다."
  );
  assert.match(translateCardText(jinx, "ko"), /^\[가속\]/u);
  assert.match(translateCardText(jinx, "ko"), /이 카드를 사용하면, 카드 2장을 버립니다\./u);
  assert.match(translateCardText(sett, "ko"), /이 카드를 사용하면 혹은 이 카드가 정복하면, 이 카드를 버프합니다\./u);
  assert.match(translateCardText(sett, "ko"), /이 카드의 버프 소모: 이번 턴에 이 카드가 \+4 위력을 획득합니다\./u);
});

test("official Origins names and printed prose replace legacy translations", () => {
  const expectedNames = new Map([
    ["OGN-001/298", "타오르는 화염용"], ["OGN-004/298", "쪼개기"],
    ["OGN-005/298", "붕괴"], ["OGN-006/298", "와작와작 뻥"],
    ["OGN-007/298", "분노 룬"], ["OGN-045/298", "반항"],
    ["OGN-076/298", "야스오, 회한"], ["OGN-240/298", "세트, 두목"],
    ["OGN-255/298", "구미호"], ["OGN-298/298", "자운 땅굴"]
  ]);
  for (const [number, expected] of expectedNames) assert.equal(translateCardName(byNumber(number), "ko"), expected, number);
  assert.equal(translateCardText(byNumber("OGN-002/298"), "ko"), "이 카드를 사용할 때, 추가 비용으로 카드 1장을 버릴 수 있습니다. 그렇게 할 경우, 이 카드의 비용이 에너지 2 감소합니다.");
  assert.match(translateCardText(byNumber("OGN-012/298"), "ko"), /^\[군단\] —/u);
  assert.match(translateCardText(byNumber("OGN-178/298"), "ko"), /사망하면 해당 효과를 얻습니다/u);
  assert.equal(translateCardText(byNumber("OGN-298/298"), "ko"), "이곳을 정복하면, 카드 1장을 버린 후 1장을 뽑습니다.");
});

test("Korean card tags and Any power render like localized card metadata", () => {
  const yasuo = byNumber("OGN-076/298");
  const spellThief = byNumber("UNL-192/219");
  assert.deepEqual(translateCardTags(yasuo, "ko"), ["챔피언 유닛", "야스오", "아이오니아"]);
  assert.deepEqual(translateCardTags({ type: "unit", tags: "legacy-tag" }, "ko"), ["유닛"]);
  assert.equal(translateCostDomain("Any", "ko", yasuo), "평정");
  assert.equal(translateCostDomain("Any", "ko", spellThief), "평정/신체");
});

test("Baron Pit battlefield token has usable unofficial Korean UI text", () => {
  const pit = OFFICIAL_TOKEN_DEFINITIONS.baronPit;
  assert.equal(translateCardName(pit, "ko"), "내셔 남작 둥지");
  assert.equal(
    translateCardText(pit, "ko"),
    "비공식 번역\n유닛은 어디서든 이곳으로 이동할 수 있습니다."
  );
});

test("Korean translation bundle normalizes requested keyword terms", () => {
  const allText = Object.values(cards)
    .map((card) => [
      translateCardText(card, "ko"),
      translateCardTags(card, "ko").join(", ")
    ].join("\n"))
    .join("\n");
  assert.doesNotMatch(allText, /\[은신\]|\[방벽\]|\[사냥(?:\s*\d*)\]/u);
  assert.match(translateCardText(byNumber("OGN-077/298"), "ko"), /\[숨겨짐\]/u);
  assert.match(translateCardText(byNumber("OGN-240/298"), "ko"), /\[탱커\]/u);
  assert.match(translateCardText(byNumber("UNL-113/219"), "ko"), /\[추적 2\]/u);
});

test("official FAQ keyword translations are confirmed", () => {
  assert.equal(translateKeyword("Deathknell", "ko"), "죽음의 종소리");
  assert.equal(translateKeyword("Deflect", "ko"), "굴절");
  assert.equal(translateKeyword("Vision", "ko"), "통찰");
  assert.equal(translateKeyword("Ganking", "ko"), "개입");
  assert.equal(translateKeyword("Tank", "ko"), "탱커");
  assert.equal(translationMetadata().keywords.Deathknell.confirmed, true);
  assert.equal(translationMetadata().keywords.Deflect.confirmed, true);
  assert.equal(translationMetadata().keywords.Vision.confirmed, true);
  assert.equal(translationMetadata().keywords.Action.confirmed, true);
});

test("requested keyword translations preserve their confirmed or provisional status", () => {
  assert.equal(translateKeyword("Add", "ko"), "추가");
  assert.equal(translateKeyword("Mighty", "ko"), "위력적");
  assert.equal(translateKeyword("Empower", "ko"), "강화");
  assert.equal(translateKeyword("Empowered", "ko"), "강화됨");
  assert.equal(translateKeyword("Flow", "ko"), "흐름 (미확정)");

  const metadata = translationMetadata().keywords;
  assert.equal(metadata.Add.confirmed, true);
  assert.equal(metadata.Mighty.confirmed, true);
  assert.equal(metadata.Empower.confirmed, true);
  assert.equal(metadata.Empowered.confirmed, true);
  assert.equal(metadata.Flow.confirmed, false);
});

test("Korean card text marks unofficial translations before the text", () => {
  const translated = translateCardText(byNumber("SFD-001/221"), "ko");
  assert.match(translated, /^비공식 번역\n/u);
  assert.doesNotMatch(translated, /\n미확인$/u);
});

test("Korean card text distinguishes the player from the source card", () => {
  const playerAndSource = translateCardText(byNumber("OGS-004/024"), "ko");
  const sourceOnly = translateCardText(byNumber("OGS-009/024"), "ko");

  assert.equal(playerAndSource, "내가 8+ 룬을 보유하는 동안, 이 카드가 +4 위력을 가집니다.");
  assert.match(sourceOnly, /^\[개입\][\s\S]*\n이 카드는 준비 상태로 진입합니다\.$/u);
  assert.doesNotMatch(translateCardText(byNumber("OGN-030/298"), "ko"), /소환|내려놓|발동하/u);
});

test("every playable card has authored Korean metadata and text", () => {
  for (const card of Object.values(cards)) {
    const translation = CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber];
    assert.ok(translation?.koName, `missing Korean metadata for ${card.cardNumber}`);
    if (card.text && !translation.printedTextEmpty) {
      const translated = translateCardText(card, "ko");
      if (translation.officialTextSource && translation.translationStatus !== "unofficial-correction") {
        assert.doesNotMatch(
          translated,
          /^(?:공식 번역 미확인|비공식 번역)\n/u,
          `confirmed FAQ text still marked for ${card.cardNumber}`,
        );
      } else {
        assert.match(
          translated,
          /^비공식 번역\n/u,
          `missing Korean text for ${card.cardNumber}`,
        );
      }
    }
  }
});

test("all Korean card translations follow the project terminology and style rules", () => {
  const translations = Object.values(cards).map((card) => (
    CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber]
  ));
  const allText = translations.map((entry) => entry.koText || "").join("\n");
  const unofficialText = translations
    .filter((entry) => !entry.officialTextSource)
    .map((entry) => entry.koText || "")
    .join("\n");
  const allMetadata = translations.map((entry) => `${entry.koName}\n${entry.koHeader}\n${entry.koTypeLine}`).join("\n");

  assert.doesNotMatch(unofficialText, /(?:^|[\s("])(?:나는|나를|나에게)(?=[\s,.)]|$)/u);
  assert.doesNotMatch(unofficialText, /소환|내려놓|휴지통|쓰레기통|얻습니다/u);
  assert.doesNotMatch(allText, /쇼다운|메인 덱|파워|장비|유언|예지|회수/u);
  assert.doesNotMatch(allText, /채널|룬\s*\d+개/u);
  assert.doesNotMatch(allText, /\[은신(?:\s|\])|\[방벽(?:\s|\])|\[사냥(?:\s|\])/u);
  assert.doesNotMatch(`${allMetadata}\n${allText}`, /인내|비어 있는 전장|빈 전장/u);
  assert.doesNotMatch(unofficialText, /유닛 토큰\s*\d+명|유닛 토큰\s*\d+명를/u);
  assert.doesNotMatch(allText, /피해\s*\d+(?:을|를|만큼)?|추가\s+\d+의 피해|피해(?:은|을)/u);
  assert.doesNotMatch(unofficialText, /카드를\s*\d+장\s*(?:뽑|버)/u);
  assert.doesNotMatch(allMetadata, /[A-Za-z]{3,}/u);
  assert.doesNotMatch(allText.replaceAll("XP", ""), /[A-Za-z]{3,}/u);
  assert.doesNotMatch(allText, /정복 스킬을 발동|유발 효과|유발 능력/u);
  assert.equal(t("triggeredAbility", "ko"), "유발 스킬");
  assert.equal(t("ability", "ko"), "스킬");
});

test("meaning-sensitive Korean corrections preserve card costs and conditions", () => {
  assert.match(
    translateCardText(byNumber("OGN-226/298"), "ko"),
    /비용이 에너지 3 이하이며 힘 1 이하인 유닛 1명/u
  );
  assert.equal(translateCardName(byNumber("OGS-001/024"), "ko"), "애니, 화염");
  assert.match(translateCardText(byNumber("OGN-060/298"), "ko"), /공격하거나 방어하면/u);
});

test("provided Proving Grounds cards preserve the official Korean wording", () => {
  assert.equal(translateCardName(byNumber("OGS-019/024"), "ko"), "우주 검사");
  assert.equal(translateCardName(byNumber("OGS-021/024"), "ko"), "광명의 소녀");
  assert.equal(translateCardName(byNumber("OGS-023/024"), "ko"), "데마시아의 힘");
  assert.equal(
    translateCardText(byNumber("OGS-008/024"), "ko"),
    "[행동] (내 턴 또는 결전 시 사용합니다.)\n이번 턴에 아군 유닛 1명에게 +3 위력을 부여합니다. 이후 적 유닛 1명을 선택합니다. 각 유닛이 자신의 위력만큼 서로에게 피해를 입힙니다."
  );
  assert.equal(
    translateCardText(byNumber("OGS-014/024"), "ko"),
    "이 카드를 탈진: [반응] — 에너지 2 [추가] 주문을 사용할 때만 이용합니다. (자원을 추가하는 스킬에는 반응할 수 없습니다.)"
  );
});

test("official Origins wording preserves quantities, timing and reminders", () => {
  assert.equal(translateCardText(byNumber("OGN-095/298"), "ko"), "[반응] (주문 및 스킬이 처리되기 전을 포함해 시점에 관계없이 사용합니다.)\n이번 턴에 유닛 1명에게 -1 위력을 부여합니다. 1 위력까지 감소할 수 있습니다. 카드 1장을 뽑습니다.");
  assert.equal(translateCardText(byNumber("OGN-105/298"), "ko"), "최대 2명의 유닛에게 각각 6의 피해를 입힙니다.");
  assert.equal(translateCardText(byNumber("OGN-134/298"), "ko"), "룬 1장을 탈진 상태로 전개합니다. 전개할 수 없을 경우, 카드 1장을 뽑습니다.");
  assert.equal(translateCardText(byNumber("OGN-294/298"), "ko"), "이곳에 있는 유닛이 +1 위력을 가집니다. (공격자도 포함됩니다.)");
});

test("Morbid Return preserves the official trash-to-hand target and zone order", () => {
  assert.equal(translateCardName(byNumber("OGN-170/298"), "ko"), "소름끼치는 귀환");
  assert.equal(
    translateCardText(byNumber("OGN-170/298"), "ko"),
    "[행동] (내 턴 또는 결전 시 사용합니다.)\n유닛 1명을 내 폐기장에서 내 손으로 되돌립니다."
  );

  const trashToHandCards = Object.values(cards).filter((card) => (
    /\breturn\b[^.\n]{0,120}\bfrom your trash to your hand\b/iu.test(card.text || "")
  ));
  assert.equal(trashToHandCards.length, 8);
  for (const card of trashToHandCards) {
    assert.match(
      translateCardText(card, "ko"),
      /[^.\n]+(?:을|를) 내 폐기장에서 내 손으로 되돌/u,
      card.cardNumber
    );
  }
});

test("Korean basic rune cards have no printed rules sentence", () => {
  const runeNumbers = [
    "OGN-007/298", "OGN-007a/298", "OGN-007b/298",
    "OGN-042/298", "OGN-042a/298", "OGN-042b/298",
    "OGN-089/298", "OGN-089a/298", "OGN-089b/298",
    "OGN-126/298", "OGN-126a/298", "OGN-126b/298",
    "OGN-166/298", "OGN-166a/298", "OGN-166b/298",
    "OGN-214/298", "OGN-214a/298", "OGN-214b/298"
  ];

  for (const number of runeNumbers) {
    const translation = CARD_KO_TRANSLATIONS[number];
    assert.equal(translation.printedTextEmpty, true, `${number} empty-text metadata`);
    assert.equal(translateCardText(byNumber(number), "ko"), "", `${number} text`);
  }
});

test("Mountain Drake uses the corrected Korean printed name", () => {
  assert.equal(translateCardName(byNumber("OGN-142/298"), "ko"), "대지의 드래곤");
});

test("Eclipse uses the lunar Korean name", () => {
  assert.equal(translateCardName(byNumber("UNL-063/219"), "ko"), "월식");
  assert.doesNotMatch(CARD_KO_TRANSLATIONS["UNL-063/219"].koHeader, /일식/u);
});

test("bare Predict instructions do not add an unprinted 하다 verb", () => {
  const expectedFragments = new Map([
    ["UNL-062/219", "[죽음의 종소리] [예측 2]."],
    ["UNL-063/219", "\n[예측]."],
    ["UNL-079/219", "[예측] 후 내 주 덱"],
    ["UNL-131/219", "\n[예측]."],
    ["UNL-136/219", ": [예측 2] 후 카드 1장을 뽑습니다."],
    ["UNL-211/219", "지불했다면, [예측]."]
  ]);

  for (const [number, fragment] of expectedFragments) {
    const translated = translateCardText(byNumber(number), "ko");
    assert.match(translated, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), number);
    assert.doesNotMatch(
      translated,
      /\[(?:예측|통찰)(?:\s+\d+)?\](?:을|를)?\s*(?:합니다|한|하려면)/u,
      number
    );
  }
});

test("resource Add effects remain the bracketed 추가 keyword without an invented verb", () => {
  const addKeywordCards = Object.values(cards).filter((card) => (
    /\[Add\]|\bADD\b|\bAdd\s+\d+\s*\.|\bAdd\b[^.\n]{0,40}\b(?:Energy|Power)\b/u.test(card.text || "")
  ));
  assert.equal(addKeywordCards.length, 32);

  for (const card of addKeywordCards) {
    const translated = translateCardText(card, "ko");
    assert.match(translated, /\[추가\]/u, card.cardNumber);
    assert.doesNotMatch(translated, /\[추가\](?:을|를)?\s*(?:합니다|한|하려면)/u, card.cardNumber);
    assert.doesNotMatch(
      translated,
      /(?:에너지|(?:신체|평정|혼돈|분노|정신|질서)?\s*힘)\s*\d+(?:을|를)\s*추가합니다/u,
      card.cardNumber
    );
  }

  assert.equal(
    translateCardText(byNumber("OGN-204/298"), "ko"),
    "이 카드를 탈진: [반응] — 혼돈 힘 1 [추가] (자원을 추가하는 스킬에는 반응할 수 없습니다.)"
  );
  assert.match(translateCardText(byNumber("UNL-197/219"), "ko"), /에너지 1 \[추가\]\./u);
});

test("Mighty and Counter use one Korean rules term everywhere", () => {
  const mightyCards = Object.values(cards).filter((card) => /\bMighty\b/iu.test(card.text || ""));
  const counterCards = Object.values(cards).filter((card) => /\bcounter\b/iu.test(card.text || ""));

  for (const card of mightyCards) {
    const translated = translateCardText(card, "ko");
    assert.match(translated, /\[위력적\]/u, card.cardNumber);
    assert.doesNotMatch(translated, /(?<!\[)강력(?:한|합니다|\s*상태)|\[위력적\]\s*상태/u, card.cardNumber);
  }
  for (const card of counterCards) {
    const translated = translateCardText(card, "ko");
    assert.match(translated, /차단/u, card.cardNumber);
    assert.doesNotMatch(translated, /무효화/u, card.cardNumber);
  }

  const allText = Object.values(cards).map((card) => translateCardText(card, "ko")).join("\n");
  assert.doesNotMatch(allText, /무효화|범용 힘/u);
  assert.equal(t("countered", "ko"), "차단됨");
});

test("Korean card translations distinguish energy and power costs from rune cards", () => {
  const allText = Object.values(CARD_KO_TRANSLATIONS).map((entry) => entry.koText || "").join("\n");

  assert.doesNotMatch(allText, /룬으로 반응|룬(?:\s*\d+장)?을?\s*지불|룬 대신|룬 힘|자원\s*\d+/u);
  assert.match(translateCardText(byNumber("OGN-053/298"), "ko"), /힘 1을 지불해 숨긴 후 나중에 에너지 0의 비용으로 반응/u);
  assert.match(translateCardText(byNumber("OGN-041/298"), "ko"), /힘 2를 지불/u);
  assert.match(translateCardText(byNumber("OGN-263/298"), "ko"), /힘 1 대신 에너지 1/u);
  assert.match(translateCardText(byNumber("OGN-268/298"), "ko"), /원하는 만큼 힘을 지불/u);
  assert.match(translateCardText(byNumber("OGN-269/298"), "ko"), /힘 1을 지불/u);
  assert.match(translateCardText(byNumber("OGN-047/298"), "ko"), /룬 1장을 탈진 상태로 전개/u);
});

test("official Origins FAQ card text is applied without an unconfirmed marker", () => {
  assert.equal(translateCardName(byNumber("OGN-108/298"), "ko"), "수렴 변이");
  assert.equal(translateCardName(byNumber("OGN-102/298"), "ko"), "차원문 구출");
  assert.match(translateCardText(byNumber("OGN-190/298"), "ko"), /^\[죽음의 종소리\]/u);
  assert.match(translateCardText(byNumber("OGN-235/298"), "ko"), /^\[통찰\]/u);
  assert.match(translateCardText(byNumber("OGN-258/298"), "ko"), /이후 다음을 수행:/u);
  assert.match(translateCardText(byNumber("OGN-269/298"), "ko"), /사망하게 될 경우/u);
});

test("Korean card headers match card energy and power costs", () => {
  const domainNames = {
    Body: "신체",
    Calm: "평정",
    Chaos: "혼돈",
    Fury: "분노",
    Mind: "정신",
    Order: "질서"
  };

  for (const card of Object.values(cards)) {
    const translation = CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber];
    if (card.energy > 0) {
      assert.match(translation.koHeader, new RegExp(`${card.energy} 에너지`, "u"), `${card.cardNumber} energy header mismatch`);
    }

    for (const cost of card.power || []) {
      const domains = cost.domain === "Any" ? card.domains : [cost.domain];
      const label = domains.map((domain) => domainNames[domain]).join("/");
      assert.match(
        translation.koHeader,
        new RegExp(`${cost.amount} ${label} 힘`, "u"),
        `${card.cardNumber} power header mismatch`
      );
    }
  }
});
