import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";
import { translateCardName, translateCardText, translateCardImage } from "../src/i18n.mjs";
import { auditOfficialKoreanTranslations } from "../scripts/audit-official-korean-translations.mjs";
import { koreanGalleryText } from "../scripts/official-korean-gallery.mjs";

const cardByNumber = (number) => Object.values(cards).find((card) => card.cardNumber === number);

test("all Origins and Proving Grounds translations retain verified official provenance", () => {
  assert.deepEqual(auditOfficialKoreanTranslations(), []);
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/build-official-korean-translations.mjs", import.meta.url)), "--check"]);
  for (const card of Object.values(cards).filter((card) => /^OG[NS]-/u.test(card.cardNumber))) {
    const translation = CARD_KO_TRANSLATIONS[card.cardNumber];
    assert.ok(["official", "unofficial-correction"].includes(translation.translationStatus), card.cardNumber);
    assert.equal(translateCardText(card, "ko"), translation.koText, card.cardNumber);
  }
});

test("Ahri duration correction stays unofficial across normal, alternate and signature art", () => {
  for (const number of ["OGN-255/298", "OGN-303/298", "OGN-303s/298", "OGN-303a/298"]) {
    const entry = CARD_KO_TRANSLATIONS[number];
    assert.doesNotMatch(entry.officialKoText, /이번 턴/u);
    assert.match(entry.translationCorrection.correctedText, /이번 턴/u);
    assert.match(translateCardText(cardByNumber(number), "ko"), /^비공식 번역\n공식 번역 오역:/u);
  }
  assert.match(CARD_KO_TRANSLATIONS["OGN-303/298"].officialGalleryKoText, /이번 턴/u);
  assert.ok(CARD_KO_TRANSLATIONS["OGN-303s/298"].officialTextDiscrepancy);
});

test("Korean images match the printing and fall back without changing card data", () => {
  for (const number of ["OGN-001/298", "OGN-303s/298", "OGS-001/024"]) {
    const card = cardByNumber(number);
    assert.ok(card, number);
    const originalImage = card.image;
    assert.equal(translateCardImage(card, "ko"), CARD_KO_TRANSLATIONS[number].koImageUrl);
    assert.ok(translateCardImage(card, "ko").startsWith("https://cmsassets.rgpub.io/"));
    assert.equal(translateCardImage(card, "en"), originalImage);
    assert.equal(card.image, originalImage);
  }
  for (const number of ["OGN-007b/298", "OGN-197b/298", "SFD-001/221"]) {
    const card = cardByNumber(number);
    assert.ok(card, number);
    assert.equal(translateCardImage(card, "ko"), card.image);
  }
  assert.equal(translateCardImage(null, "ko"), "");
  const hidden = { ...cardByNumber("OGN-255/298"), image: "", redacted: true };
  assert.equal(translateCardImage(hidden, "ko"), "");
  assert.equal(translateCardImage(hidden, "en"), "");
});

test("Korean-exclusive Dynasty Ahri reuses the existing legend effect and has distinct art", () => {
  const original = cardByNumber("OGN-255/298");
  const korea = cardByNumber("OGN-303a/298");
  assert.equal(korea.name, original.name);
  assert.deepEqual(korea.effects, original.effects);
  assert.deepEqual(korea.implementationReferences, { "static:enemyAttacksControlledBattlefieldMightReduction": original.cardNumber });
  assert.notEqual(korea.image, original.image);
  assert.equal(translateCardImage(korea, "ko"), korea.image);
  assert.match(CARD_KO_TRANSLATIONS[korea.cardNumber].officialTextSource, /koreas-rift-opens-on-september-18/u);
});

test("yellow Sett counts himself while the original erroneous wording remains available", () => {
  for (const number of ["OGN-240/298", "OGN-240a/298"]) {
    const entry = CARD_KO_TRANSLATIONS[number];
    assert.match(entry.officialKoText, /다른 버프된 아군/u);
    assert.doesNotMatch(entry.translationCorrection.correctedText, /다른/u);
    assert.match(entry.translationCorrection.correctedText, /버프된 아군 유닛 1명당/u);
    assert.equal(entry.translationStatus, "unofficial-correction");
  }
  assert.equal(CARD_KO_TRANSLATIONS["OGN-164/298"].translationStatus, "official");
  assert.equal(CARD_KO_TRANSLATIONS["OGN-269/298"].translationStatus, "official");
});

test("additional translation corrections preserve damage source, battlefield scope and choice rules", () => {
  assert.match(CARD_KO_TRANSLATIONS["OGN-260/298"].translationCorrection.correctedText, /해당 유닛이.*자신의 위력/u);
  assert.match(CARD_KO_TRANSLATIONS["OGN-268/298"].translationCorrection.correctedText, /한 전장에 있는 모든 적 유닛/u);
  assert.match(CARD_KO_TRANSLATIONS["OGN-287/298"].translationCorrection.correctedText, /반드시 재활용.*규칙상 아무것도 선택하지/u);
  assert.match(CARD_KO_TRANSLATIONS["OGN-268/298"].koText, /공식 번역 해석 주의/u);
  assert.match(CARD_KO_TRANSLATIONS["OGN-287/298"].koText, /공식 번역 해석 주의/u);
  // Teemo's missing hidden-play trigger is official errata, not a Korean mistake.
  assert.equal(CARD_KO_TRANSLATIONS["OGN-121/298"].translationStatus, "official");
});

test("symbol extraction preserves combined costs, lists and official phrasing", () => {
  assert.equal(koreanGalleryText("<p>:rb_energy_1::rb_rune_fury:을 지불합니다.</p>"), "에너지 1 + 분노 힘 1을 지불합니다.");
  assert.equal(koreanGalleryText("<p>:rb_rune_rainbow::rb_rune_rainbow:을 지불합니다.</p>"), "힘 2를 지불합니다.");
  assert.equal(koreanGalleryText("<p>:rb_exhaust:: 카드 1장을 뽑습니다.</p>"), "이 카드를 탈진: 카드 1장을 뽑습니다.");
  assert.equal(koreanGalleryText("<p>모든 :rb_exhaust: 스킬을 가집니다.</p>"), "모든 탈진 스킬을 가집니다.");
  assert.equal(koreanGalleryText("<ul><li>카드를 1장 뽑습니다.</li><li>효과를 얻습니다.</li></ul>"), "• 카드를 1장 뽑습니다.\n• 효과를 얻습니다.");
  assert.throws(() => koreanGalleryText(":rb_unknown:"), /Unknown official card symbol/);
});

test("source audit rejects silently rewritten official wording and lost correction warnings", () => {
  const changed = { ...CARD_KO_TRANSLATIONS,
    "OGN-012/298": { ...CARD_KO_TRANSLATIONS["OGN-012/298"], koText: "효과를 적용합니다." },
    "OGN-255/298": { ...CARD_KO_TRANSLATIONS["OGN-255/298"], koText: CARD_KO_TRANSLATIONS["OGN-255/298"].translationCorrection.correctedText }
  };
  const failures = auditOfficialKoreanTranslations(changed);
  assert.ok(failures.some((error) => error.startsWith("OGN-012/298")));
  assert.ok(failures.some((error) => error.startsWith("OGN-255/298")));
});

test("official rune names and empty text work through the public translation API", () => {
  for (const number of ["OGN-007/298", "OGN-007a/298", "OGN-007b/298"]) {
    assert.equal(translateCardName(cardByNumber(number), "ko"), "분노 룬");
    assert.equal(translateCardText(cardByNumber(number), "ko"), "");
  }
  assert.equal(translateCardText({ cardNumber: "OGN-001/298" }, "ko"), CARD_KO_TRANSLATIONS["OGN-001/298"].koText);
});
