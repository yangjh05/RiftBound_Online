import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";
import {
  LOCALES,
  t,
  translateCardName,
  translateCardTags,
  translateCardText,
  translateCostDomain,
  translateKeyword,
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

test("Korean translations use authored card sentences for example champion cards", () => {
  const yasuo = byNumber("OGN-076/298");
  const jinx = byNumber("OGN-030/298");
  const sett = byNumber("OGN-164/298");

  assert.equal(translateCardName(yasuo, "ko"), "야스오, 회한");
  assert.equal(
    translateCardText(yasuo, "ko"),
    "공식 번역 미확인\n이 카드가 공격하면, 이곳에 있는 적 유닛 1명에게 이 카드의 위력과 동일한 피해를 입힙니다."
  );
  assert.match(translateCardText(jinx, "ko"), /^공식 번역 미확인\n\[가속\]/u);
  assert.match(translateCardText(jinx, "ko"), /이 카드를 사용하면, 카드 2장을 버립니다\./u);
  assert.match(translateCardText(sett, "ko"), /이 카드를 사용하면 혹은 이 카드가 정복하면, 이 카드를 버프합니다\./u);
  assert.match(translateCardText(sett, "ko"), /이 카드의 버프 소모: 이번 턴에 이 카드가 \+4 위력을 획득합니다\./u);
});

test("Korean card tags and Any power render like localized card metadata", () => {
  const yasuo = byNumber("OGN-076/298");
  const spellThief = byNumber("UNL-192/219");
  assert.deepEqual(translateCardTags(yasuo, "ko"), ["챔피언 유닛", "야스오", "아이오니아"]);
  assert.equal(translateCostDomain("Any", "ko", yasuo), "인내");
  assert.equal(translateCostDomain("Any", "ko", spellThief), "인내/신체");
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
  assert.equal(translationMetadata().keywords.Deathknell.confirmed, true);
  assert.equal(translationMetadata().keywords.Deflect.confirmed, true);
  assert.equal(translationMetadata().keywords.Vision.confirmed, true);
  assert.equal(translationMetadata().keywords.Action.confirmed, true);
});

test("Korean card text marks unofficial translations before the text", () => {
  const translated = translateCardText(byNumber("OGN-030/298"), "ko");
  assert.match(translated, /^공식 번역 미확인\n/u);
  assert.doesNotMatch(translated, /\n미확인$/u);
});

test("Korean card text avoids forbidden first-person and play wording", () => {
  const translated = translateCardText(byNumber("OGN-030/298"), "ko");
  assert.doesNotMatch(translated, /내가|나|내/u);
  assert.doesNotMatch(translated, /소환|내려놓|발동하/u);
});

test("every playable card has authored Korean metadata and text", () => {
  for (const card of Object.values(cards)) {
    const translation = CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber];
    assert.ok(translation?.koName, `missing Korean metadata for ${card.cardNumber}`);
    if (card.text) {
      const translated = translateCardText(card, "ko");
      if (translation.officialTextSource) {
        assert.doesNotMatch(translated, /^공식 번역 미확인\n/u, `confirmed FAQ text still marked for ${card.cardNumber}`);
      } else {
        assert.match(translated, /^공식 번역 미확인\n/u, `missing Korean text for ${card.cardNumber}`);
      }
    }
  }
});

test("all Korean card translations follow the project terminology and style rules", () => {
  const translations = Object.values(cards).map((card) => (
    CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber]
  ));
  const allText = translations.map((entry) => entry.koText || "").join("\n");
  const allMetadata = translations.map((entry) => `${entry.koName}\n${entry.koHeader}\n${entry.koTypeLine}`).join("\n");

  assert.doesNotMatch(allText, /(?:^|[\s("])(?:내가|나와|나는|나를|나에게)(?=[\s,.)]|$)/u);
  assert.doesNotMatch(allText, /소환|내려놓|휴지통|쓰레기통|얻습니다/u);
  assert.doesNotMatch(allText, /쇼다운|메인 덱|파워|장비|유언|예지|회수/u);
  assert.doesNotMatch(allText, /\[은신(?:\s|\])|\[방벽(?:\s|\])|\[사냥(?:\s|\])/u);
  assert.doesNotMatch(allText, /유닛\s*\d+장|유닛 토큰\s*\d+개|유닛 토큰\s*\d+명를/u);
  assert.doesNotMatch(allText, /공격하거나|방어하거나|정복하거나|점거하거나/u);
  assert.doesNotMatch(allMetadata, /[A-Za-z]{3,}/u);
  assert.doesNotMatch(allText.replaceAll("XP", ""), /[A-Za-z]{3,}/u);
  assert.doesNotMatch(allText, /정복 스킬을 발동|유발 효과|유발 능력/u);
  assert.equal(t("triggeredAbility", "ko"), "유발 스킬");
  assert.equal(t("ability", "ko"), "스킬");
});

test("meaning-sensitive Korean corrections preserve card costs and conditions", () => {
  assert.match(
    translateCardText(byNumber("OGN-226/298"), "ko"),
    /에너지 비용이 3 이하이고 힘 비용이 1 이하인 유닛 1명/u
  );
  assert.equal(translateCardName(byNumber("OGS-001/024"), "ko"), "애니, 불꽃");
  assert.match(translateCardText(byNumber("OGN-060/298"), "ko"), /공격하면 혹은 방어하면/u);
});

test("Korean card translations distinguish energy and power costs from rune cards", () => {
  const allText = Object.values(CARD_KO_TRANSLATIONS).map((entry) => entry.koText || "").join("\n");

  assert.doesNotMatch(allText, /룬으로 반응|룬(?:\s*\d+개)?를\s*지불|룬 대신|룬 힘|자원\s*\d+/u);
  assert.match(translateCardText(byNumber("OGN-053/298"), "ko"), /힘으로 반응하여 에너지 0으로 사용/u);
  assert.match(translateCardText(byNumber("OGN-041/298"), "ko"), /힘 2를 지불/u);
  assert.match(translateCardText(byNumber("OGN-263/298"), "ko"), /힘 대신 에너지 1/u);
  assert.match(translateCardText(byNumber("OGN-268/298"), "ko"), /힘을 원하는 만큼 지불/u);
  assert.match(translateCardText(byNumber("OGN-269/298"), "ko"), /힘 1을 지불/u);
  assert.match(translateCardText(byNumber("OGN-047/298"), "ko"), /룬 1개를 탈진 상태로 채널/u);
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
    Calm: "인내",
    Chaos: "혼돈",
    Fury: "격노",
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
