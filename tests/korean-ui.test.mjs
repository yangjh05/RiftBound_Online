import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { uiTranslationCoverage } from "../src/i18n.mjs";
import {
  hasUnexpectedEnglish,
  localizeKoreanChoiceLabel,
  localizeKoreanNetworkError,
  localizeKoreanPackName,
  localizeKoreanRarity,
  localizeKoreanRoomStatus,
  localizeKoreanUiText
} from "../src/ui/korean-text.mjs";

test("Korean and English UI dictionaries expose the same keys", () => {
  const coverage = uiTranslationCoverage();
  assert.deepEqual(coverage.missingKorean, []);
  assert.deepEqual(coverage.missingEnglish, []);
  assert.ok(coverage.koreanKeys.length > 250);
});

test("dynamic room, card-pool, rarity, choice, and combat labels are Korean", () => {
  assert.equal(localizeKoreanRoomStatus("lobby"), "대기실");
  assert.equal(localizeKoreanRoomStatus("sideboarding"), "사이드보드 교체 중");
  assert.equal(localizeKoreanPackName("Origins: Proving Grounds"), "오리진: 증명의 장");
  assert.equal(localizeKoreanPackName("Spiritforged 출시 환경"), "스피릿포지드 출시 환경");
  assert.equal(localizeKoreanRarity("Epic"), "서사급");
  assert.equal(localizeKoreanRarity("Showcase"), "쇼케이스");
  assert.equal(localizeKoreanChoiceLabel("Pay Energy 2"), "에너지 2 지불");
  assert.equal(localizeKoreanUiText("3 damage lethal"), "3 피해 · 처치 가능");
  assert.equal(localizeKoreanUiText("YOUR TURN"), "내 턴");
  assert.equal(localizeKoreanUiText("SHOWDOWN"), "결전");
  assert.equal(localizeKoreanUiText("Assign lethal first"), "먼저 처치 가능한 유닛에 필요한 피해를 배정해야 합니다.");
});

test("every deck validation sentence shown by the UI has a Korean form", () => {
  const messages = [
    "A Legend card is required.",
    "Exactly 3 Battlefields are required.",
    "A tournament Main Deck must contain exactly 40 cards. It currently contains 7.",
    "Sideboard can contain at most 8 cards. It currently contains 9.",
    "Rune Deck must contain exactly 12 cards. It currently contains 4.",
    "테스트 카드 cannot be included in the Main Deck or Sideboard.",
    "테스트 카드 is outside 테스트 레전드's Domain Identity.",
    "테스트 카드 has an invalid copy count.",
    "테스트 카드 can have at most 3 registered copies across the Main Deck and Sideboard. It currently has 4.",
    "Battlefield 테스트 전장 may only be registered once.",
    "테스트 룬 is not a Rune card.",
    "Unknown registered card number: OGN-999/999"
  ];
  for (const message of messages) {
    const localized = localizeKoreanUiText(message);
    assert.equal(hasUnexpectedEnglish(localized, ["OGN"]), false, `${message} -> ${localized}`);
  }
});

test("multiplayer errors never expose raw English in Korean mode", () => {
  const errors = [
    "Room not found.",
    "Room is full.",
    "Game has already started.",
    "Seat token is invalid.",
    "Submit a playable deck first.",
    "Invalid server response.",
    "Failed to fetch"
  ];
  for (const message of errors) {
    const localized = localizeKoreanNetworkError(message);
    assert.equal(hasUnexpectedEnglish(localized), false, `${message} -> ${localized}`);
  }
});

test("known Korean UI bypasses are guarded by localization", async () => {
  const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<strong>UI Exception<\/strong>/u);
  assert.doesNotMatch(source, /<span>available damage<\/span>/u);
  assert.doesNotMatch(source, /<em>\$\{room\.status\}<\/em>/u);
  assert.doesNotMatch(source, /\/ \$\{room\.status\}/u);
  assert.doesNotMatch(source, /<strong>\$\{legal \? amountLabel : info\.reason\}<\/strong>/u);
  assert.match(source, /results\.length\}장/u);
  assert.match(source, /localizedDynamicText\(message\)/u);
  assert.match(source, /localizedRoomStatus\(room\.status\)/u);
});
