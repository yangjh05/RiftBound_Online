import fs from "node:fs";
import path from "node:path";

const files = process.argv.slice(2);
if (!files.length) {
  throw new Error("Usage: node scripts/normalize-korean-card-style.mjs <translation-file> [...]");
}

const replacements = Object.freeze([
  [/추가 피해\s+(\d+)/gu, "$1의 추가 피해"],
  [/추가\s+(\d+)의 피해/gu, "$1의 추가 피해"],
  [/피해\s+(\d+)(?:을|를)/gu, "$1의 피해를"],
  [/피해은/gu, "피해는"],
  [/피해을/gu, "피해를"],
  [/유닛들에게/gu, "유닛에게"],
  [/유닛들은/gu, "유닛은"],
  [/유닛들이/gu, "유닛이"],
  [/유닛들을/gu, "유닛을"],
  [/유닛들의/gu, "유닛의"],
  [/유닛들/gu, "유닛"],
  [/유닛 토큰\s+(\d+)명/gu, "유닛 토큰 $1개"],
  [/주문\s+(\d+)장/gu, "주문 $1개"],
  [/유닛\s+(\d+)장/gu, "유닛 $1명"],
  [/도구\s+(\d+)장/gu, "도구 $1개"],
  [/장착물\s+(\d+)장/gu, "장착물 $1개"],
  [/룬\s+(\d+)개를/gu, "룬 $1장을"],
  [/룬\s+(\d+)개/gu, "룬 $1장"],
  [/룬\s+(\d+)장를/gu, "룬 $1장을"],
  [/(\d+)개을/gu, "$1개를"],
  [/위력이\s+(\d+)인\s+([^\n.]*?유닛 토큰)/gu, "$1 위력 $2"],
  [/처치하고 탈진:/gu, "처치하고 이 카드를 탈진:"],
  [/(\\n|, )탈진:/gu, "$1이 카드를 탈진:"],
  [/("koText": ")탈진:/gu, "$1이 카드를 탈진:"],
  [/해당 효과를 얻습니다/gu, "해당 효과를 적용합니다"],
  [/효과를 얻습니다/gu, "효과를 적용합니다"],
  [/조종권을 얻습니다/gu, "조종권을 획득합니다"],
  [/봅니다/gu, "확인합니다"],
  [/볼 수 있습니다/gu, "확인할 수 있습니다"],
  [/채널/gu, "전개"],
  [/버린 후 (\d+)장을 뽑/gu, "버린 후 카드 $1장을 뽑"],
  [/카드를\s+(\d+)장\s+뽑/gu, "카드 $1장을 뽑"],
  [/카드를\s+(\d+)장\s+버/gu, "카드 $1장을 버"]
]);

for (const file of files) {
  const absolute = path.resolve(file);
  const before = fs.readFileSync(absolute, "utf8");
  if (/translationStatus|officialKoText|officialTextSource/u.test(before)) {
    throw new Error(`Refusing to rewrite sourced Korean wording in ${file}. Edit unofficial entries separately.`);
  }
  const after = replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), before);
  if (after === before) {
    console.log(`${path.relative(process.cwd(), absolute)}: already normalized`);
    continue;
  }
  fs.writeFileSync(absolute, after, "utf8");
  console.log(`${path.relative(process.cwd(), absolute)}: normalized`);
}
