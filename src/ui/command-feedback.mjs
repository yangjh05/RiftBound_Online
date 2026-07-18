import { hasUnexpectedEnglish, localizeKoreanUiText } from "./korean-text.mjs";

const KOREAN_FAILURES = [
  {
    code: "pending-step",
    test: /finish the current (choice|payment)|current choice first|pending (choice|payment)/i,
    title: "진행 중인 선택을 먼저 완료해 주세요.",
    detail: "현재 열려 있는 선택 또는 비용 지불을 끝낸 뒤 다시 시도할 수 있습니다."
  },
  {
    code: "insufficient-cost",
    test: /cannot pay|not enough|insufficient|no buff to spend|cost(?: is)? not paid|needs? .* (energy|power)|energy cost|power cost/i,
    title: "비용이 부족합니다.",
    detail: "필요한 에너지, 힘 또는 카드 고유 자원이 충분하지 않습니다."
  },
  {
    code: "no-legal-target",
    test: /no (?:legal|valid) target|target is not legal|cannot target|legal declared targets|destination is not legal|no legal destination/i,
    title: "합법적인 대상이 없습니다.",
    detail: "현재 보드 상태에서 이 효과가 선택할 수 있는 대상이나 목적지가 없습니다."
  },
  {
    code: "condition-unmet",
    test: /condition is not met|use condition|not available in the current game state|requires?|needs legion|legion to|has no .* to (?:spend|use)|cannot activate that card/i,
    title: "발동 조건을 충족하지 못했습니다.",
    detail: "카드에 적힌 발동 조건과 현재 게임 상태를 확인해 주세요."
  },
  {
    code: "wrong-timing",
    test: /current timing|only reaction|existing chain|priority|current phase|cannot be used (?:now|during)|not your (?:turn|focus)/i,
    title: "현재 타이밍에는 발동할 수 없습니다.",
    detail: "턴, 포커스, 반응 창 또는 체인 우선권이 맞을 때 다시 시도해 주세요."
  },
  {
    code: "wrong-zone",
    test: /active board zone|from (?:this|that) zone|not in (?:an )?active/i,
    title: "현재 위치에서는 발동할 수 없습니다.",
    detail: "이 능력은 카드가 유효한 전장 영역에 있을 때만 사용할 수 있습니다."
  },
  {
    code: "no-ability",
    test: /no activated ability/i,
    title: "발동할 수 있는 능력이 없습니다.",
    detail: "현재 카드에는 사용할 수 있는 활성화 능력이 없습니다."
  }
];

export function commandFailureFeedback(message, locale = "ko") {
  const raw = String(message || "").trim();
  if (locale !== "ko") {
    return {
      code: "engine-rejected",
      title: "Action rejected",
      detail: raw || "The rules engine rejected this request without changing the game state."
    };
  }
  const match = KOREAN_FAILURES.find((candidate) => candidate.test.test(raw));
  if (match) return { code: match.code, title: match.title, detail: localizedEngineDetail(raw) || match.detail, engineMessage: raw };
  return {
    code: "engine-rejected",
    title: "요청이 규칙상 거부되었습니다.",
    detail: localizedEngineDetail(raw) || "규칙 엔진이 요청을 거부했으며 게임 상태는 변경되지 않았습니다.",
    engineMessage: raw
  };
}

function localizedEngineDetail(message) {
  const exact = new Map([
    ["That activated ability's use condition is not met.", "이 활성화 능력의 사용 조건이 충족되지 않았습니다."],
    ["Only Reaction abilities can be used on an existing chain.", "이미 열린 체인에는 반응 능력만 사용할 수 있습니다."],
    ["That activated ability cannot be used at the current timing.", "이 활성화 능력은 현재 타이밍에 사용할 수 없습니다."],
    ["Finish the current choice first.", "현재 열려 있는 선택 또는 비용 지불을 먼저 완료해야 합니다."],
    ["Activated abilities can only be used from an active board zone.", "활성화 능력은 유효한 전장 영역에 있는 카드만 사용할 수 있습니다."],
    ["That card has no activated ability.", "이 카드에는 활성화 능력이 없습니다."],
    ["You cannot activate that card.", "현재 플레이어는 이 카드를 발동할 수 없습니다."],
    ["That activated ability is not available in the current game state.", "선택한 능력은 현재 게임 상태에서 사용할 수 없습니다."]
  ]);
  if (exact.has(message)) return exact.get(message);
  const noBuff = message.match(/^(.+) has no buff to spend\.$/i);
  if (noBuff) return `${noBuff[1]}에 사용할 버프가 없습니다.`;
  const noTarget = message.match(/^(.+) has no (?:legal|valid) targets?\.?$/i);
  if (noTarget) return `${noTarget[1]} 효과가 선택할 수 있는 합법적인 대상이 없습니다.`;
  const localized = localizeKoreanUiText(message);
  return localized !== message && !hasUnexpectedEnglish(localized, ["AI", "XP", "HTTP"])
    ? localized
    : "";
}
