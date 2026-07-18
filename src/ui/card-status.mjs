const COPY = {
  ko: {
    stunned: ["기절", "이번 턴 동안 전투 피해를 입히지 않습니다.", "종료 단계까지"],
    exhausted: ["탈진", "현재 탈진 상태입니다.", "다시 준비될 때까지"],
    buff: ["버프", "버프 하나마다 위력이 +1 증가하며, 효과의 비용으로 소모될 수 있습니다.", "소모하거나 전장을 떠날 때까지"],
    temporaryMight: ["일시 위력", "이번 턴에 적용되는 위력 변경입니다.", "턴 종료까지"],
    lastingMight: ["위력 변경", "현재 카드에 지속 적용되는 위력 변경입니다.", "전장을 떠날 때까지"],
    keywords: ["추가 키워드", "이번 턴에 추가로 부여받은 키워드입니다.", "턴 종료까지"],
    cannotMove: ["이동 불가", "이번 턴에는 이 유닛을 이동할 수 없습니다.", "턴 종료까지"],
    temporary: ["임시", "종료 단계에 전장에서 제거되는 임시 카드입니다.", "종료 단계까지"],
    prevention: ["피해 방지", "다음 피해를 방지하는 효과가 준비되어 있습니다.", "사용하거나 만료될 때까지"],
    save: ["죽음 대체", "죽을 때 룬을 지불해 귀환할 수 있는 효과가 준비되어 있습니다.", "이번 턴"],
    damage: ["누적 피해", "현재 이 유닛에 남아 있는 피해입니다.", "회복하거나 전장을 떠날 때까지"],
    attachments: ["부착 도구", "도구 효과가 이 카드에 적용되고 있습니다.", "도구가 떨어질 때까지"],
    controller: ["조종권 변경", "현재 소유자가 아닌 다른 플레이어가 조종하고 있습니다.", "조종 효과가 끝날 때까지"],
    attacker: ["공격 유닛", "현재 결전에서 공격 유닛으로 지정되었습니다.", "결전 종료까지"],
    defender: ["방어 유닛", "현재 결전에서 방어 유닛으로 지정되었습니다.", "결전 종료까지"],
    source: "출처",
    domainPower: "힘"
  },
  en: {
    stunned: ["Stunned", "This unit deals no combat damage this turn.", "Until the Ending Step"],
    exhausted: ["Exhausted", "This card is currently exhausted.", "Until it becomes ready"],
    buff: ["Buff", "Each buff grants +1 Might and may be spent by effects.", "Until spent or this leaves play"],
    temporaryMight: ["Temporary Might", "This Might modifier applies for the current turn.", "Until end of turn"],
    lastingMight: ["Might modifier", "This Might modifier persists on the card.", "Until this leaves play"],
    keywords: ["Granted keywords", "These keywords were granted for the current turn.", "Until end of turn"],
    cannotMove: ["Cannot move", "This unit cannot move this turn.", "Until end of turn"],
    temporary: ["Temporary", "This temporary card is removed during the Ending Step.", "Until the Ending Step"],
    prevention: ["Damage prevention", "An effect is ready to prevent the next damage.", "Until used or expired"],
    save: ["Death replacement", "A Rune may be paid to recall this card instead of letting it die.", "This turn"],
    damage: ["Damage", "Damage currently marked on this unit.", "Until healed or this leaves play"],
    attachments: ["Attached gear", "Attached gear effects are applying to this card.", "Until detached"],
    controller: ["Control changed", "A player other than the owner currently controls this card.", "Until the control effect ends"],
    attacker: ["Attacker", "This unit is designated as an attacker in the current showdown.", "Until the showdown ends"],
    defender: ["Defender", "This unit is designated as a defender in the current showdown.", "Until the showdown ends"],
    source: "Source",
    domainPower: "Power"
  }
};

function language(locale) {
  return locale === "en" ? COPY.en : COPY.ko;
}

function signed(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function item(locale, kind, tone, badge, detail = null, source = null) {
  const copy = language(locale);
  const [title, defaultDetail, duration] = copy[kind];
  return { kind, tone, badge, title, detail: detail || defaultDetail, duration, source };
}

function preventionAmount(preventions = [], locale = "ko") {
  if (preventions.some((entry) => entry?.remaining === "all")) return locale === "en" ? "all" : "전부";
  return preventions.reduce((sum, entry) => sum + Math.max(0, Number(entry?.remaining) || 0), 0);
}

export function cardStatusItems(card, options = {}) {
  if (!card) return [];
  const locale = options.locale === "en" ? "en" : "ko";
  const copy = language(locale);
  const keywordLabel = options.keywordLabel || ((keyword) => keyword);
  const cardLabel = options.cardLabel || ((name) => name);
  const domainLabel = options.domainLabel || ((domain) => domain);
  const items = [];

  if (card.stunned) items.push(item(locale, "stunned", "negative", copy.stunned[0]));
  if (card.exhausted) items.push(item(locale, "exhausted", "neutral", copy.exhausted[0]));
  if ((card.buffs || 0) > 0) {
    const amount = card.buffs || 0;
    items.push(item(locale, "buff", "positive", `${copy.buff[0]} ×${amount}`));
  }

  const temporaryMight = Number(card.temporaryMight) || 0;
  const lastingMight = (Number(card.mightModifier) || 0) - temporaryMight;
  if (temporaryMight) {
    items.push(item(locale, "temporaryMight", temporaryMight > 0 ? "positive" : "negative", `${copy.temporaryMight[0]} ${signed(temporaryMight)}`));
  }
  if (lastingMight) {
    items.push(item(locale, "lastingMight", lastingMight > 0 ? "positive" : "negative", `${copy.lastingMight[0]} ${signed(lastingMight)}`));
  }

  const temporaryKeywords = [...new Set(card.temporaryKeywords || [])];
  if (temporaryKeywords.length) {
    const labels = temporaryKeywords.map((keyword) => {
      const amount = card.temporaryKeywordAmounts?.[String(keyword).toLowerCase()];
      return `${keywordLabel(keyword)}${amount == null ? "" : ` ${amount}`}`;
    });
    items.push(item(locale, "keywords", "positive", labels.join(" · "), `${copy.keywords[1]} ${labels.join(", ")}`));
  }

  if (card.cantMoveThisTurn) items.push(item(locale, "cannotMove", "negative", copy.cannotMove[0]));
  if (card.temporary) items.push(item(locale, "temporary", "warning", copy.temporary[0]));

  const activePreventions = (card.damagePreventions || []).filter((entry) => entry && (entry.remaining === "all" || Number(entry.remaining) > 0));
  if (activePreventions.length) {
    const amount = preventionAmount(activePreventions, locale);
    items.push(item(locale, "prevention", "positive", `${copy.prevention[0]} ${amount}`));
  }

  if (card.saveWithRuneUntilTurnSequence != null) {
    const domain = card.saveWithRuneDomain ? domainLabel(card.saveWithRuneDomain) : null;
    const cost = domain ? `${domain} ${copy.domainPower}` : null;
    items.push(item(
      locale,
      "save",
      "positive",
      copy.save[0],
      `${copy.save[1]}${cost ? ` (${cost})` : ""}`,
      card.saveWithRuneSourceName ? cardLabel(card.saveWithRuneSourceName) : null
    ));
  }

  if ((card.damage || 0) > 0) items.push(item(locale, "damage", "negative", `${copy.damage[0]} ${card.damage}`));

  const attachments = card.attachments || [];
  if (attachments.length) {
    const names = attachments.map((attachment) => cardLabel(attachment.name));
    items.push(item(locale, "attachments", "positive", `${copy.attachments[0]} ${attachments.length}`, copy.attachments[1], names.join(", ")));
  }

  if (card.ownerId && card.controllerId && card.ownerId !== card.controllerId) {
    items.push(item(locale, "controller", "warning", copy.controller[0]));
  }
  if (card.combatRole === "attacker") items.push(item(locale, "attacker", "warning", copy.attacker[0]));
  if (card.combatRole === "defender") items.push(item(locale, "defender", "positive", copy.defender[0]));
  return items;
}

export function cardHasVisibleStatus(card) {
  return cardStatusItems(card).length > 0;
}
