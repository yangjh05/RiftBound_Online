import { cards } from "../src/cards.mjs";
import { CARD_KO_TRANSLATIONS } from "../src/cardKoTranslations.mjs";

const rows = Object.values(cards).map((card) => ({
  card,
  translation: CARD_KO_TRANSLATIONS[card.cardNumber] || CARD_KO_TRANSLATIONS[card.collectorNumber]
}));

const domainNames = {
  Body: "신체",
  Calm: "평정",
  Chaos: "혼돈",
  Fury: "격노",
  Mind: "정신",
  Order: "질서"
};

const checks = {
  englishText: /\b(?:the|this|when|while|choose|target|unit|spell|gear|draw|discard|damage|might|power|play|ready|exhaust|friendly|enemy|battlefield|trash|rune|energy)\b/i,
  forbidden: /소환|내려놓|파괴(?:합니다|하세요|한다|하고|한|된|되)|(?:^|[\s.])(?:하라|하여라)(?:[.!?\s]|$)|휴지통|쓰레기통|\[은신(?:\s|\])|\[방벽(?:\s|\])|\[사냥(?:\s|\])/u,
  inconsistent: /얻습니다|획득하세요|부여하세요|뽑으세요|버리세요|처치하세요|이동하세요|준비하세요|탈진하세요/u,
  koreanNumbers: /카드(?:를|가|는|의)?\s*(?:한|두|세|네)\s*장|유닛(?:을|이|은|의)?\s*(?:한|두|세|네)\s*명|피해\s*(?:한|두|세|네)(?:\D|$)/u,
  trailingMarker: /\n(?:미확인|공식 번역 미확인)$/u,
  andTrigger: /(?:사용|공격|정복|이동|처치|버리|뽑|유발)[^\n.]{0,40}(?:하면|할 때)[^\n.]{0,20}그리고[^\n.]{0,30}(?:하면|할 때)/u,
  metadataSummary: /(?:주문 효과|지속 효과|활성화 능력):|\([^\n)]*(?:대상|수치|조건|토큰|선택지)[^\n)]*·/u,
  damageNumberOrder: /피해\s*\d+(?:을|를|만큼)?/u,
  malformedBonusDamage: /추가\s+\d+의 피해|피해(?:은|을)/u,
  redundantPlural: /유닛들(?:이|은|을|에게|의)?/u,
  oldTimingReminder: /주문(?:과| 및) 스킬이 (?:해결|처리)되기 전을 포함해 언제든|자신의 턴 또는 결전 중/u,
  wrongTokenClassifier: /유닛 토큰\s*\d+명/u,
  wrongSpellClassifier: /주문\s*\d+장/u,
  wrongUnitClassifier: /유닛\s*\d+장/u,
  wrongToolClassifier: /(?:도구|장착물)\s*\d+장/u,
  wrongRuneClassifier: /룬\s*\d+개/u,
  wrongRuneParticle: /룬\s*\d+장를/u,
  unofficialChannelTerm: /채널/u,
  wrongObjectParticle: /\d+개을/u,
  bareSelfCost: /(?:^|\n|,\s)탈진:/u,
  verboseTokenMight: /위력이\s*\d+인\s+[^\n.]*토큰/u,
  wrongCardClassifierOrder: /카드를\s*\d+장\s*(?:뽑|버)/u,
  addedKeywordDo: /\[(?:예측|통찰)(?:\s+\d+)?\](?:을|를)?\s*(?:합니다|한|하려면)/u
};

const semanticChecks = {
  give: { english: /\bgive (?!me\b)/i, korean: /부여/u },
  gain: { english: /\bgain\b/i, korean: /획득/u },
  dealDamage: { english: /\bdeal(?:s)?\b[^.\n]*(?:damage|\d)/i, korean: /피해[^.\n]*(?:입히|입힙|입힌|입힐)/u },
  kill: { english: /\bkill\b/i, korean: /처치/u },
  ready: { english: /\bready\b/i, korean: /준비/u },
  exhaust: { english: /\bexhaust\b/i, korean: /탈진/u },
  draw: { english: /(?<!Quick-)\bdraw\b/i, korean: /(?:카드(?:를|가)?(?:\s*\d+장(?:을|씩)?)?|카드\s*\d+장을|(?:해당|그)\s*카드를|공개하여|그중\s*\d+장을|나머지(?:\s*카드)?를|추방하지 않은 카드는 모두)\s*뽑/u },
  discard: { english: /\bdiscard\b/i, korean: /카드(?:를)?(?:\s*\d+장(?:을| 이상)?)?\s*버|카드\s*\d+장을\s*버/u },
  recycle: { english: /\brecycle\b/i, korean: /재활용/u },
  channel: { english: /\bchannel\b/i, korean: /전개/u },
  move: { english: /\bmove\b/i, korean: /이동/u },
  conquer: { english: /\bconquer\b/i, korean: /정복/u },
  hold: { english: /\bhold\b/i, korean: /점거/u },
  target: { english: /\btarget\b/i, korean: /대상으로 지정/u }
};

const findings = {};
for (const [check, pattern] of Object.entries(checks)) {
  findings[check] = rows
    .filter(({ translation }) => translation?.koText && pattern.test(translation.koText))
    .map(({ card, translation }) => ({
      number: card.cardNumber,
      englishName: card.name,
      koreanName: translation.koName,
      englishText: card.text,
      koreanText: translation.koText
    }));
}

findings.semantic = {};
for (const [check, patterns] of Object.entries(semanticChecks)) {
  findings.semantic[check] = rows
    .filter(({ card, translation }) => !translation?.printedTextEmpty
      && patterns.english.test(card.text || "")
      && !patterns.korean.test(translation?.koText || ""))
    .map(({ card, translation }) => ({
      number: card.cardNumber,
      englishName: card.name,
      koreanName: translation?.koName,
      englishText: card.text,
      koreanText: translation?.koText
    }));
}

findings.awkward = rows
  .filter(({ translation }) => /효과(?:를|들을) 얻습니다/u.test(translation?.koText || ""))
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    englishName: card.name,
    koreanName: translation.koName,
    englishText: card.text,
    koreanText: translation.koText
  }));

findings.missingMarker = rows
  .filter(({ card, translation }) => card.text && !translation?.officialTextSource && !translation?.koText?.startsWith("비공식 번역\n"))
  .map(({ card }) => card.cardNumber);

findings.officiallyConfirmed = rows
  .filter(({ translation }) => translation?.officialTextSource)
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    source: translation.officialTextSource
  }));

findings.englishName = rows
  .filter(({ translation }) => translation && /[A-Za-z]{3,}/.test(translation.koName))
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    englishName: card.name,
    koreanName: translation.koName
  }));

findings.englishMetadata = rows
  .filter(({ translation }) => translation && /[A-Za-z]{3,}/.test(translation.koHeader + "\n" + translation.koTypeLine))
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    koreanHeader: translation.koHeader,
    koreanTypeLine: translation.koTypeLine
  }));

findings.englishFragments = rows
  .filter(({ translation }) => translation && /[A-Za-z]{3,}/.test((translation.koText || "").replaceAll("XP", "")))
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    koreanText: translation.koText
  }));

findings.resourceTermConfusion = rows
  .filter(({ translation }) => /룬으로 반응|룬(?:\s*\d+장)?을?\s*지불|룬 대신|룬 힘|자원\s*\d+/u.test(translation?.koText || ""))
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    koreanText: translation.koText
  }));

findings.resourceHeaderMismatch = rows
  .filter(({ card, translation }) => {
    if (card.energy > 0 && !translation?.koHeader?.includes(`${card.energy} 에너지`)) return true;
    return (card.power || []).some((cost) => {
      const domains = cost.domain === "Any" ? card.domains : [cost.domain];
      const label = domains.map((domain) => domainNames[domain]).join("/");
      return !translation.koHeader.includes(`${cost.amount} ${label} 힘`);
    });
  })
  .map(({ card, translation }) => ({
    number: card.cardNumber,
    energy: card.energy,
    power: card.power,
    domains: card.domains,
    koreanHeader: translation?.koHeader
  }));

console.log(JSON.stringify(findings, null, 2));
