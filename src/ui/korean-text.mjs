const EXACT_TEXT = new Map([
  ["Unknown error", "알 수 없는 오류"],
  ["No deck was selected.", "선택된 덱이 없습니다."],
  ["A Legend card is required.", "레전드 카드가 필요합니다."],
  ["At least one matching Champion Unit is required in the Main Deck.", "주 덱에 레전드와 일치하는 챔피언 유닛이 최소 1장 필요합니다."],
  ["Each player chooses one starting champion.", "각 플레이어가 시작 챔피언을 선택합니다."],
  ["Each player rolls a die to decide who chooses the play order.", "각 플레이어가 주사위를 굴려 선후공 선택권을 정합니다."],
  ["The play-order roll is tied. Both players roll again.", "선후공 결정 주사위가 동점입니다. 두 플레이어가 다시 굴립니다."],
  ["Battlefields are set. Each player may mulligan up to 2 cards.", "전장 선택이 끝났습니다. 각 플레이어는 최대 2장까지 멀리건할 수 있습니다."],
  ["Mulligans are complete. The first turn begins.", "멀리건이 끝났습니다. 첫 번째 턴을 시작합니다."],
  ["No units remain after the showdown.", "결전 후 남아 있는 유닛이 없습니다."],
  ["Surviving attackers return to base.", "생존한 공격 유닛이 기지로 돌아갑니다."],
  ["The attacking tie recalls every unit at the battlefield.", "공격 결과가 무승부여서 해당 전장의 모든 유닛이 기지로 돌아갑니다."],
  ["Cleanup stopped after reaching the safety limit.", "안전 제한에 도달하여 정리 처리를 중단했습니다."],
  ["Request failed", "요청에 실패했습니다."],
  ["Event stream failed", "실시간 연결에 실패했습니다."],
  ["AI replay is too large.", "AI 리플레이 데이터가 너무 큽니다."],
  ["Invalid AI replay id.", "AI 리플레이 식별자가 올바르지 않습니다."],
  ["Room not found.", "방을 찾을 수 없습니다."],
  ["Room is full.", "방의 좌석이 모두 찼습니다."],
  ["Game has already started.", "이미 게임이 시작되었습니다."],
  ["Seat token is invalid.", "좌석 인증 정보가 올바르지 않습니다."],
  ["Submit a playable deck first.", "먼저 플레이 가능한 덱을 제출해 주세요."],
  ["Command rejected.", "게임 명령이 규칙상 거부되었습니다."],
  ["The match has not ended.", "아직 매치가 끝나지 않았습니다."],
  ["The match has not started.", "아직 매치가 시작되지 않았습니다."],
  ["Both players need a submitted deck.", "두 플레이어 모두 덱을 제출해야 합니다."],
  ["Unknown API route.", "지원하지 않는 서버 요청 경로입니다."],
  ["Method not allowed.", "허용되지 않은 서버 요청 방식입니다."],
  ["Server error.", "서버 오류가 발생했습니다."],
  ["Invalid server response.", "서버 응답 형식이 올바르지 않습니다."],
  ["lobby", "대기실"],
  ["waiting", "대기 중"],
  ["ready", "준비됨"],
  ["playing", "게임 중"],
  ["sideboarding", "사이드보드 교체 중"],
  ["complete", "완료"],
  ["pending", "대기 중"],
  ["resolving", "해결 중"],
  ["finalized", "확정됨"],
  ["declined", "거절됨"],
  ["countered", "무효화됨"],
  ["failed", "처리 실패"],
  ["Common", "일반"],
  ["Uncommon", "고급"],
  ["Rare", "희귀"],
  ["Epic", "서사급"],
  ["Legendary", "전설급"],
  ["Showcase", "쇼케이스"],
  ["Origins", "오리진"],
  ["Origins: Proving Grounds", "오리진: 증명의 장"],
  ["Spiritforged", "스피릿포지드"],
  ["Unleashed", "언리시드"],
  ["Origins 출시 환경", "오리진 출시 환경"],
  ["Spiritforged 출시 환경", "스피릿포지드 출시 환경"],
  ["Unleashed 출시 환경", "언리시드 출시 환경"],
  ["Unit", "유닛"],
  ["Card", "카드"],
  ["Keep", "유지"],
  ["Decline", "거절"],
  ["Continue", "계속"],
  ["Confirm", "확인"],
  ["Pay", "지불"],
  ["Recycle", "재활용"],
  ["Do not", "하지 않음"],
  ["SHOWDOWN", "결전"],
  ["YOUR TURN", "내 턴"],
  ["AMBUSH", "기습"],
  ["RESPONSE", "대응"],
  ["ACTION", "행동"],
  ["MATCH POINT", "승부처"],
  ["TURNAROUND", "역전"],
  ["SCORE", "득점"],
  ["BATTLEFIELD BREAK", "전장 붕괴"],
  ["UNIT DOWN", "유닛 처치"],
  ["MOMENTUM SHIFT", "주도권 전환"],
  ["DENIED", "저지"],
  ["IMPACT", "강타"],
  ["VICTORY", "승리"],
  ["DEFEAT", "패배"],
  ["Lethal already assigned", "이미 처치에 필요한 피해를 배정했습니다."],
  ["Backline last", "후방 유닛에는 마지막에 피해를 배정해야 합니다."],
  ["Assign last", "이 유닛에는 마지막에 피해를 배정해야 합니다."],
  ["Tank first", "방어 유닛에 먼저 피해를 배정해야 합니다."],
  ["Assign lethal first", "먼저 처치 가능한 유닛에 필요한 피해를 배정해야 합니다."],
  ["Excess damage", "남은 초과 피해를 배정할 수 있습니다."]
]);

const TEXT_PATTERNS = [
  [/^Exactly (\d+) Battlefields are required\.$/iu, ([, count]) => `전장은 정확히 ${count}장 필요합니다.`],
  [/^A tournament Main Deck must contain exactly (\d+) cards\. It currently contains (\d+)\.$/iu, ([, required, current]) => `토너먼트 주 덱은 정확히 ${required}장이어야 합니다. 현재 ${current}장입니다.`],
  [/^Main Deck must contain at least (\d+) cards\. It currently contains (\d+)\.$/iu, ([, required, current]) => `주 덱은 최소 ${required}장이어야 합니다. 현재 ${current}장입니다.`],
  [/^Sideboard can contain at most (\d+) cards\. It currently contains (\d+)\.$/iu, ([, limit, current]) => `사이드보드는 최대 ${limit}장까지 등록할 수 있습니다. 현재 ${current}장입니다.`],
  [/^Rune Deck must contain exactly (\d+) cards\. It currently contains (\d+)\.$/iu, ([, required, current]) => `룬 덱은 정확히 ${required}장이어야 합니다. 현재 ${current}장입니다.`],
  [/^Unknown registered card number: (.+)$/iu, ([, number]) => `알 수 없는 등록 카드 번호입니다: ${number}`],
  [/^Unknown Battlefield card number: (.+)$/iu, ([, number]) => `알 수 없는 전장 카드 번호입니다: ${number}`],
  [/^Unknown Rune card number: (.+)$/iu, ([, number]) => `알 수 없는 룬 카드 번호입니다: ${number}`],
  [/^(.+) cannot be included in the Main Deck or Sideboard\.$/iu, ([, name]) => `${name} 카드는 주 덱이나 사이드보드에 넣을 수 없습니다.`],
  [/^(.+) is outside (.+)'s Domain Identity\.$/iu, ([, name, legend]) => `${name} 카드는 ${legend}의 도메인 정체성에 맞지 않습니다.`],
  [/^(.+) has an invalid copy count\.$/iu, ([, name]) => `${name} 카드의 등록 장수가 올바르지 않습니다.`],
  [/^(.+) does not share a 챔피언 태그 with (.+)\.$/iu, ([, name, legend]) => `${name} 카드는 ${legend}와 챔피언 태그를 공유하지 않습니다.`],
  [/^(.+) can have at most (\d+) registered copies across the Main Deck and Sideboard\. It currently has (\d+)\.$/iu, ([, name, limit, current]) => `${name} 카드는 주 덱과 사이드보드를 합쳐 최대 ${limit}장까지 등록할 수 있습니다. 현재 ${current}장입니다.`],
  [/^(.+) has Unique and can have only one registered copy across the Main Deck and Sideboard\.$/iu, ([, name]) => `${name} 카드는 고유 카드이므로 주 덱과 사이드보드를 합쳐 1장만 등록할 수 있습니다.`],
  [/^At most (\d+) Signature cards may be registered in 합계\. It currently has (\d+)\.$/iu, ([, limit, current]) => `시그니처 카드는 합계 최대 ${limit}장까지 등록할 수 있습니다. 현재 ${current}장입니다.`],
  [/^(.+) is not a Battlefield card\.$/iu, ([, name]) => `${name} 카드는 전장 카드가 아닙니다.`],
  [/^Battlefield (.+) may only be registered once\.$/iu, ([, name]) => `전장 ${name}은 1장만 등록할 수 있습니다.`],
  [/^(.+) is not a Rune card\.$/iu, ([, name]) => `${name} 카드는 룬 카드가 아닙니다.`],
  [/^(Body|Calm|Chaos|Fury|Mind|Order) is outside (.+)'s Domain Identity\.$/iu, ([, domain, legend]) => `${koreanDomain(domain)} 도메인은 ${legend}의 도메인 정체성에 맞지 않습니다.`],
  [/^(\d+) cards?$/iu, ([, count]) => `${count}장`],
  [/^Pay Energy (\d+)$/iu, ([, count]) => `에너지 ${count} 지불`],
  [/^(\d+) damage(?: lethal)?$/iu, (match) => `${match[1]} 피해${/lethal/iu.test(match[0]) ? " · 처치 가능" : ""}`],
  [/^(.+) rolls (\d+) for play order\.$/iu, ([, player, value]) => `${player}님이 선후공 결정 주사위에서 ${value}가 나왔습니다.`],
  [/^(.+) wins the play-order roll and chooses who goes first\.$/iu, ([, player]) => `${player}님이 주사위 굴림에서 이겨 선후공을 선택합니다.`],
  [/^(.+) chooses (.+) to go first\.$/iu, ([, chooser, first]) => `${chooser}님이 ${first}님을 선공으로 선택했습니다.`],
  [/^(.+) wins the random first-player roll\.$/iu, ([, player]) => `${player}님이 선공 결정 굴림에서 승리했습니다.`],
  [/^(.+) selects a Battlefield\.$/iu, ([, player]) => `${player}님이 전장을 선택했습니다.`],
  [/^(.+) reveals (.+)\.$/iu, ([, player, target]) => `${player}님이 ${target}을 공개했습니다.`],
  [/^(.+) chooses (.+) as their starting champion\.$/iu, ([, player, champion]) => `${player}님이 ${champion}을 시작 챔피언으로 선택했습니다.`],
  [/^(.+) chooses cards to mulligan\.$/iu, ([, player]) => `${player}님이 멀리건할 카드를 선택합니다.`],
  [/^(.+) mulligans (\d+) cards? and draws (\d+)\.$/iu, ([, player, count, draw]) => `${player}님이 카드 ${count}장을 멀리건하고 ${draw}장을 뽑았습니다.`],
  [/^(.+) keeps their opening hand\.$/iu, ([, player]) => `${player}님이 시작 손패를 유지했습니다.`],
  [/^(.+) starts turn (\d+)\.$/iu, ([, player, turn]) => `${player}님의 ${turn}턴이 시작되었습니다.`],
  [/^(.+) ends the turn\. All units heal\.$/iu, ([, player]) => `${player}님이 턴을 종료했습니다. 모든 유닛이 회복합니다.`],
  [/^(.+) surrenders\. (.+) wins the game\.$/iu, ([, loser, winner]) => `${loser}님이 항복했습니다. ${winner}님이 승리했습니다.`],
  [/^(.+) wins at (\d+) points\.$/iu, ([, player, score]) => `${player}님이 ${score}점으로 승리했습니다.`],
  [/^(.+) is paying for (.+)\.$/iu, ([, player, card]) => `${player}님이 ${card}의 비용을 지불하고 있습니다.`],
  [/^(.+) is paying to activate (.+)\.$/iu, ([, player, card]) => `${player}님이 ${card}의 발동 비용을 지불하고 있습니다.`],
  [/^(.+) cancels payment\.$/iu, ([, player]) => `${player}님이 비용 지불을 취소했습니다.`],
  [/^(.+) activates (.+)\.$/iu, ([, player, card]) => `${player}님이 ${card}의 능력을 발동했습니다.`],
  [/^(.+) puts (.+) onto the Chain as Pending\.$/iu, ([, player, card]) => `${player}님이 ${card}을 체인에 대기 상태로 올렸습니다.`],
  [/^(.+) puts (.+)'s activated ability onto the Chain as Pending\.$/iu, ([, player, card]) => `${player}님이 ${card}의 활성화 능력을 체인에 대기 상태로 올렸습니다.`],
  [/^(.+) adds (.+) to the (?:showdown )?chain\.$/iu, ([, player, card]) => `${player}님이 ${card}을 체인에 추가했습니다.`],
  [/^(.+) resolves from the (?:showdown )?chain\.$/iu, ([, card]) => `${card}의 체인 처리가 해결되었습니다.`],
  [/^(\d+) chain items? finalized\.$/iu, ([, count]) => `체인 항목 ${count}개가 확정되었습니다.`],
  [/^(.+) plays (.+) to (.+)\.$/iu, ([, player, card, field]) => `${player}님이 ${card}을 ${field}에 사용했습니다.`],
  [/^(.+) plays (.+) to base\.$/iu, ([, player, card]) => `${player}님이 ${card}을 기지에 사용했습니다.`],
  [/^(.+) draws (\d+)(?: cards?)?\.$/iu, ([, player, count]) => `${player}님이 카드 ${count}장을 뽑았습니다.`],
  [/^(.+) gains (\d+) XP(?: as .+| from .+)?\.$/iu, ([, source, count]) => `${source}이(가) XP ${count}을 획득했습니다.`],
  [/^(.+) gains (\d+) points?\.$/iu, ([, player, count]) => `${player}님이 ${count}점을 획득했습니다.`],
  [/^(.+) conquers (.+?)(?: .+)?\.$/iu, ([, player, field]) => `${player}님이 ${field}을 점령했습니다.`],
  [/^(.+) passes(?: in the showdown)?\.$/iu, ([, player]) => `${player}님이 우선권을 넘겼습니다.`],
  [/^(.+) has (?:showdown|chain) priority\.$/iu, ([, player]) => `${player}님에게 우선권이 있습니다.`],
  [/^(.+) declines (.+)\.$/iu, ([, player, source]) => `${player}님이 ${source} 효과를 거절했습니다.`],
  [/^(.+) discards (.+?)(?: as .+)?\.$/iu, ([, player, card]) => `${player}님이 ${card}을 버렸습니다.`],
  [/^(.+) is recycled\.$/iu, ([, card]) => `${card}이(가) 재활용되었습니다.`],
  [/^(.+) is banished\.$/iu, ([, card]) => `${card}이(가) 추방되었습니다.`],
  [/^(.+) goes to trash\.$/iu, ([, card]) => `${card}이(가) 폐기장으로 이동했습니다.`],
  [/^(.+) is killed\.$/iu, ([, card]) => `${card}이(가) 처치되었습니다.`],
  [/^(.+) kills (.+?)(?: as .+)?\.$/iu, ([, source, target]) => `${source}이(가) ${target}을 처치했습니다.`],
  [/^(.+) deals (\d+) damage to (.+)\.$/iu, ([, source, amount, target]) => `${source}이(가) ${target}에게 피해 ${amount}을 입혔습니다.`],
  [/^(.+) gives (.+) \+?(-?\d+) Might(?: this turn)?\.$/iu, ([, source, target, amount]) => `${source}이(가) ${target}에게 위력 ${Number(amount) >= 0 ? "+" : ""}${amount}을 부여했습니다.`],
  [/^(.+) gets \+?(-?\d+) Might(?: .+)?\.$/iu, ([, source, amount]) => `${source}의 위력이 ${Number(amount) >= 0 ? "+" : ""}${amount} 변했습니다.`],
  [/^(.+) readies (.+?)(?: .+)?\.$/iu, ([, source, target]) => `${source}이(가) ${target}을 준비시켰습니다.`],
  [/^(.+) readies(?: .+)?\.$/iu, ([, source]) => `${source}이(가) 준비 상태가 되었습니다.`],
  [/^(.+) stuns (.+)\.$/iu, ([, source, target]) => `${source}이(가) ${target}을 기절시켰습니다.`],
  [/^(.+) returns (.+) to hand\.$/iu, ([, source, target]) => `${source}이(가) ${target}을 손으로 되돌렸습니다.`],
  [/^(.+) channels (\d+|a) runes?(?: exhausted)?\.$/iu, ([, source, amount]) => `${source}이(가) 룬 ${amount === "a" ? "1" : amount}개를 채널했습니다.`],
  [/^(.+) recycles (\d+) cards?(?: from trash)?\.$/iu, ([, source, amount]) => `${source}이(가) 카드 ${amount}장을 재활용했습니다.`],
  [/^(.+) has no (?:legal|valid) target(?:s)?(?: and does not trigger)?\.$/iu, ([, source]) => `${source} 효과가 선택할 수 있는 합법적인 대상이 없습니다.`],
  [/^(.+)'s declared target is no longer legal\.$/iu, ([, source]) => `${source}의 선언한 대상이 더 이상 합법적이지 않습니다.`],
  [/^(.+) cannot pay (.+)\.$/iu, ([, source, cost]) => `${source}이(가) ${localizeFragments(cost)} 비용을 지불할 수 없습니다.`],
  [/^(.+) cannot complete (.+)\.$/iu, ([, source, detail]) => `${source}이(가) ${localizeFragments(detail)} 처리를 완료할 수 없습니다.`],
  [/^(.+) has no registered (?:trigger )?resolver for (.+)\.$/iu, ([, source]) => `${source} 효과를 처리할 공용 해결기가 등록되어 있지 않습니다.`],
  [/^Combat begins at (.+): (.+) attacks (.+)\.$/iu, ([, field, attacker, defender]) => `${field}에서 전투가 시작됩니다. ${attacker}님이 ${defender}님을 공격합니다.`],
  [/^(?:Non-combat showdown|Combat showdown) begins at (.+): (.+) faces (.+)\.$/iu, ([, field, attacker, defender]) => `${field}에서 결전이 시작됩니다. ${attacker}님과 ${defender}님이 맞섭니다.`],
  [/^Opposing units meet at (.+)\.$/iu, ([, field]) => `${field}에서 양측 유닛이 맞붙습니다.`],
  [/^Could not connect to the multiplayer server: (.+)$/iu, ([, detail]) => `멀티플레이 서버에 연결하지 못했습니다: ${localizeNetworkDetail(detail)}`],
  [/^Request failed with (\d+)\.$/iu, ([, status]) => `요청에 실패했습니다. 서버 응답 코드: ${status}`],
  [/^Event stream failed with (\d+)\.$/iu, ([, status]) => `실시간 연결에 실패했습니다. 서버 응답 코드: ${status}`]
];

const CHOICE_FRAGMENTS = [
  [/\bKeep cards?\b/giu, "현재 카드 유지"],
  [/\bDo not repeat\b/giu, "반복하지 않음"],
  [/\bDo not move\b/giu, "이동하지 않음"],
  [/\bDo not pay\b/giu, "지불하지 않음"],
  [/\bNo target\b/giu, "대상 없음"],
  [/\bChoose\b/giu, "선택"],
  [/\bPay\b/giu, "지불"],
  [/\bEnergy\b/giu, "에너지"],
  [/\bPower\b/giu, "힘"],
  [/\bRune(?:s)?\b/giu, "룬"],
  [/\bcard(?:s)?\b/giu, "카드"],
  [/\bunit(?:s)?\b/giu, "유닛"],
  [/\bBattlefield\b/giu, "전장"],
  [/\bbase\b/giu, "기지"],
  [/\bhand\b/giu, "손"],
  [/\btrash\b/giu, "폐기장"],
  [/\brecycle\b/giu, "재활용"],
  [/\bready\b/giu, "준비"],
  [/\bexhaust(?:ed)?\b/giu, "탈진"],
  [/\bdamage\b/giu, "피해"],
  [/\blethal\b/giu, "처치 가능"],
  [/\bdecline\b/giu, "거절"],
  [/\bcontinue\b/giu, "계속"],
  [/\bconfirm\b/giu, "확인"]
];

export function localizeKoreanUiText(value, { fallback = "" } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (EXACT_TEXT.has(text)) return EXACT_TEXT.get(text);
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return typeof replacement === "function" ? replacement(match) : text.replace(pattern, replacement);
  }
  const translated = localizeFragments(text);
  if (translated !== text) return translated;
  return fallback || text;
}

export function localizeKoreanChoiceLabel(value) {
  return localizeKoreanUiText(value);
}

export function localizeKoreanRoomStatus(value) {
  return EXACT_TEXT.get(String(value || "").toLowerCase()) || "상태 확인 중";
}

export function localizeKoreanRarity(value) {
  return EXACT_TEXT.get(String(value || "")) || String(value || "");
}

export function localizeKoreanPackName(value) {
  return EXACT_TEXT.get(String(value || "")) || String(value || "");
}

export function localizeKoreanNetworkError(value) {
  const text = String(value || "");
  if (EXACT_TEXT.has(text)) return EXACT_TEXT.get(text);
  const localized = localizeKoreanUiText(text);
  if (localized !== text && !hasUnexpectedEnglish(localized, ["AI", "XP", "HTTP"])) return localized;
  const sentences = text.match(/[^.]+(?:\.|$)/gu)?.map((part) => part.trim()).filter(Boolean) || [];
  if (sentences.length > 1) {
    const translated = sentences.map((part) => localizeKoreanUiText(part));
    if (translated.every((part) => !hasUnexpectedEnglish(part, ["AI", "XP", "HTTP"]))) return translated.join(" ");
  }
  const detail = localizeNetworkDetail(text);
  return !hasUnexpectedEnglish(detail, ["AI", "XP", "HTTP"])
    ? detail
    : "요청 처리 중 오류가 발생했습니다. 서버 연결 상태와 입력 내용을 확인해 주세요.";
}

export function hasUnexpectedEnglish(value, allowed = []) {
  let text = String(value || "");
  for (const token of allowed) text = text.replaceAll(token, "");
  return /[A-Za-z]{2,}/u.test(text);
}

function localizeFragments(value) {
  let text = String(value || "");
  for (const [pattern, replacement] of CHOICE_FRAGMENTS) text = text.replace(pattern, replacement);
  return text;
}

function localizeNetworkDetail(value) {
  return String(value || "")
    .replace(/Failed to fetch/giu, "서버 응답을 받지 못했습니다")
    .replace(/NetworkError/giu, "네트워크 오류")
    .replace(/Load failed/giu, "불러오기에 실패했습니다")
    .replace(/AbortError/giu, "요청이 취소되었습니다")
    .replace(/Request failed/giu, "요청에 실패했습니다")
    .replace(/Event stream failed/giu, "실시간 연결에 실패했습니다");
}

function koreanDomain(domain) {
  return {
    Body: "신체",
    Calm: "평온",
    Chaos: "혼돈",
    Fury: "격노",
    Mind: "정신",
    Order: "질서"
  }[domain] || domain;
}
