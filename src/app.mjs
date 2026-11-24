import {
  beginPlayCard,
  beginPlayCardFromTrash,
  beginPlayChampion,
  activateCard,
  cancelPayment,
  chooseFirstPlayer,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmPayment,
  createGame,
  currentCombatMight,
  currentMight,
  currentPlayer,
  declineEffectChoice,
  endTurn,
  effectiveMight,
  firstPlayerDecisionActorId,
  getSelectedCard,
  hasRequiredPlayTargets,
  hideCard,
  legalActivatedAbilityOptions,
  legalPaymentPoolEnergyOptions,
  moveUnit,
  moveUnits,
  passShowdown,
  paymentConfirmationLegality,
  rollFirstPlayer,
  selectBattlefield,
  selectCard,
  selectChampion,
  surrender,
  confirmMulligan,
  skipMulligan,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentPoolPower,
  togglePaymentRune,
  unitDamageState
} from "./engine.mjs";
import { hiddenCardControllerId, hiddenCardIsControlledBy } from "./rules/zones.mjs";
import {
  chainItemVisibleToViewer,
  gameLogVisibleToViewer,
  handCountVisibleToViewer
} from "./rules/visibility.mjs";
import { cards, DOMAINS, makeRune, rawDecklists, RUNE_COLORS, runeCardsForDomain } from "./cards.mjs";
import {
  DECK_RULES,
  cardCount as deckCardCount,
  championMatchesLegend,
  isChampionDeckCard as isChampionDeckCardByRule,
  mainDeckCount as deckMainDeckCount,
  normalizeCountEntries as normalizeDeckCountEntries,
  runeCount as deckRuneCount,
  runeDeckCount as deckRuneDeckCount,
  sideboardCount as deckSideboardCount,
  validateDeckRecord as validateDeckRecordByRule
} from "./decks/rules.mjs";
import { deckRecordFromText, formatDeckText } from "./decks/text-format.mjs";
import { beginNextMatchGame, createMatchState, recordMatchGame, submitSideboardConfiguration } from "./match.mjs";
import {
  configureOnlineServer,
  configuredMultiplayerServer,
  createOnlineRoom,
  fetchAiGenerationCheckpoint,
  fetchAiGenerations,
  fetchAiSpectatorReplay,
  fetchAiSpectatorReplays,
  fetchAccountSession,
  fetchRooms,
  joinOnlineRoom,
  leaveOnlineRoom,
  loginAccount,
  logoutAccount,
  openRoomEvents,
  persistAiReplay,
  saveAccountDeckStore,
  sendOnlineCommand,
  setOnlineReady,
  signUpAccount,
  submitOnlineDeck
} from "./net/client.mjs";
import {
  LOCALE_LABELS,
  LOCALES,
  cardSearchText,
  normalizeLocale,
  t,
  translateCardName,
  translateCardTags,
  translateCardText,
  translateCostDomain,
  translateDomain,
  translateKeywordList,
  translateType
} from "./i18n.mjs";
import {
  advancePresentation,
  chainCardInstanceIds,
  createPresentationState,
  rankPresentationHighlights,
  resetPresentationState,
  snapshotPresentationGame
} from "./presentation.mjs";
import { activeActorId as aiActiveActorId, applyAiAction, cloneGame, enumerateAiPolicyActions, enumerateLegalActions, resolveLegalAction } from "./ai/actions.mjs";
import { resolvePlannedPayment } from "./ai/payment-planner.mjs";
import { buildMatchReport } from "./ai/coach.mjs";
import { recommendDeckForPool } from "./ai/deckbuilding.mjs";
import {
  AI_GENERATIONS,
  aiGenerationDescriptor,
  normalizeAiGeneration,
  sameDeckConfiguration
} from "./ai/generations.mjs";
import { choosePolicyAction, createModel, DEFAULT_AI_MODEL } from "./ai/policy.mjs";
import { createAiReplay, finalizeAiReplay, persistableAiReplay, recordReplayDecision, refineAiReplay } from "./ai/replay.mjs";
import { CARD_PACKS, CARD_POOL_FORMATS, cardAllowedInPool, packForCard } from "./card-pools.mjs";
import { commandFailureFeedback } from "./ui/command-feedback.mjs";
import { cardStatusItems } from "./ui/card-status.mjs";
import { resolveBoardClickTarget } from "./ui/board-click.mjs";
import { legalMoveDestinationIds, sharedLegalMoveDestinationIds } from "./ui/movement-options.mjs";
import { detectEffectAnimations, EFFECT_ANIMATION_DURATION_MS } from "./ui/effect-animations.mjs";
import { collectChainTargetIds } from "./ui/chain-targets.mjs";
import { pendingDecisionVisibleToViewer } from "./ui/game-visibility.mjs";
import { battlefieldDisplayName } from "./ui/battlefield-labels.mjs";
import {
  advanceTutorialAfterCommand,
  createTutorialGame,
  TUTORIAL_CATALOG,
  TUTORIAL_IDS,
  tutorialActionAllowed,
  tutorialProgress,
  tutorialStep
} from "./tutorial.mjs";
import {
  hasUnexpectedEnglish,
  localizeKoreanChoiceLabel,
  localizeKoreanNetworkError,
  localizeKoreanPackName,
  localizeKoreanRarity,
  localizeKoreanRoomStatus,
  localizeKoreanUiText
} from "./ui/korean-text.mjs";

const LOCAL_SERVER_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const DECK_STORAGE_KEY = "riftbound.deckStore.v1";
const AUTH_STORAGE_KEY = "riftbound.accountSession.v1";
const ONLINE_STORAGE_KEY = "riftbound.onlineSeat.v1";
const SETTINGS_STORAGE_KEY = "riftbound.settings.v1";
const TUTORIAL_STORAGE_KEY = "riftbound.tutorial.v1";
const ALL_CARDS = Object.values(cards).sort((a, b) => a.name.localeCompare(b.name));
const CARD_BY_NUMBER = new Map(ALL_CARDS.map((card) => [card.cardNumber, card]));
const RAW_DECK_BY_ID = new Map(Object.values(rawDecklists).map((deck) => [deck.id, deck]));
const LOCALIZED_CARD_NAMES = [...ALL_CARDS]
  .sort((left, right) => right.name.length - left.name.length)
  .map((card) => [card.name, translateCardName(card, LOCALES.KO)]);
let settings = loadSettings();
let tutorialRecord = loadTutorialRecord();
let auth = loadAuthState();
let deckStore = loadDeckStore(accountDeckStorageKey(auth.user?.id));
let appView = "menu";
let online = loadOnlineSeat();
online.rooms = [];
online.room = null;
online.events = null;
online.error = "";
online.joinCode = "";
online.loading = false;
online.commandPending = null;
online.match = null;
online.lastRefresh = 0;
online.refreshTimer = null;
let onlineSelectedCardId = null;
let deckEditor = {
  selectedDeckId: deckStore.activeDeckIds[0] || deckStore.decks[0]?.id,
  pendingDeleteDeckId: null,
  search: "",
  selectedCardNumber: null,
  poolId: "vendetta-era",
  packId: "all",
  type: "all",
  domain: "all",
  maxEnergy: "all",
  aiRecommendation: null,
  transferNotice: null,
  transferDialog: null,
  mobileView: "list",
  mobileTab: "deck"
};
let deckSyncTimer = null;
let deckSyncQueue = Promise.resolve(true);
let game = createGame({ interactive: true, randomFirstPlayer: true, manualActionChainPriority: true });
let logOpen = false;
let handOpen = false;
let chainZoneCollapsed = false;
let inspectedChainItemId = null;
let inspectedChainTargetIds = new Set();
let graveyardOpenPlayerId = null;
let banishedOpenPlayerId = null;
let intelOpenPlayerId = null;
let fullCardOpen = false;
let fullCardPreviewCard = null;
let attachmentsOpenCardId = null;
let inspectorOpen = false;
let pendingGameExit = null;
let paymentRunesScrollLeft = 0;
let handScrollLeft = 0;
let shellScrollState = {};
let previousUiSnapshot = null;
let uiMotion = emptyMotion();
let effectAnimations = emptyEffectAnimationState();
let effectAnimationTimer = null;
let uiLegalActions = [];
let recentFeedback = null;
let feedbackDismissTimer = null;
let actionRejection = null;
let presentationState = createPresentationState();
let activeImpact = null;
let impactDismissTimer = null;
let resultRevealReady = true;
let resultDismissed = false;
let staticImpactPreview = false;
let lastViewerPlayerId = null;
let lastInteractionPhase = null;
let moveSelection = new Set();
let localMatch = null;
let sideboardDrafts = [];
let sideboardPlayerId = "p1";
let sideboardSelectedMain = null;
let sideboardFirstPlayerId = null;
let aiMode = false;
let aiHumanPlayerId = null;
let aiPlayerId = null;
let aiModel = createModel(DEFAULT_AI_MODEL);
let neuralAiModel = null;
let neuralAiSession = null;
let neuralValueEstimator = null;
let neuralAiLoadedGeneration = null;
let neuralAiLoadState = "idle";
let neuralAiLoadError = "";
let neuralAiLoadPromise = null;
let availableAiGenerations = [...AI_GENERATIONS];
let aiGenerationCatalogState = "loading";
let aiGenerationCatalogError = "";
let aiReplay = null;
let aiTurnTimer = null;
let aiThinking = false;
let aiDeepReviewRunning = false;
let replayMode = false;
let replayBrowser = {
  loading: false,
  error: "",
  items: [],
  current: null,
  frameIndex: 0,
  playing: false,
  speed: 1,
  viewerPlayerId: "p1",
  timer: null
};
const app = document.querySelector("#app");
let reportingUiException = false;

function syncVisualViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  const offsetTop = viewport?.offsetTop || 0;
  document.documentElement.style.setProperty("--app-height", `${height.toFixed(2)}px`);
  document.documentElement.style.setProperty("--viewport-offset-top", `${offsetTop.toFixed(2)}px`);
}

let viewportSyncFrame = 0;
function scheduleVisualViewportSync() {
  cancelAnimationFrame(viewportSyncFrame);
  viewportSyncFrame = requestAnimationFrame(syncVisualViewport);
}

syncVisualViewport();
window.addEventListener("resize", scheduleVisualViewportSync, { passive: true });
window.addEventListener("orientationchange", scheduleVisualViewportSync, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleVisualViewportSync, { passive: true });
window.visualViewport?.addEventListener("scroll", scheduleVisualViewportSync, { passive: true });

function locale() {
  return settings.locale;
}

function cardName(card) {
  return translateCardName(card, locale());
}

function battlefieldName(field) {
  return battlefieldDisplayName(game, field, cardName(field));
}

function cardText(card) {
  return translateCardText(card, locale());
}

function cardType(card) {
  const types = Array.isArray(card?.types) && card.types.length ? card.types : [card?.type];
  return [...new Set(types.filter(Boolean).map((type) => translateType(type, locale())))].join(" / ");
}

function cardTags(card) {
  return translateCardTags(card, locale());
}

function keywordText(keywords = []) {
  return translateKeywordList(keywords, locale()).join(" / ");
}

function domainText(domain) {
  if (!domain) return "";
  return translateDomain(domain, locale());
}

function localizedDynamicText(value, { fallback = "" } = {}) {
  const text = String(value ?? "");
  if (locale() !== LOCALES.KO || !text) return text;
  let withLocalizedNames = text;
  for (const [englishName, koreanName] of LOCALIZED_CARD_NAMES) {
    if (englishName !== koreanName && withLocalizedNames.includes(englishName)) {
      withLocalizedNames = withLocalizedNames.replaceAll(englishName, koreanName);
    }
  }
  withLocalizedNames = localizedDeckName(withLocalizedNames);
  return localizeKoreanUiText(withLocalizedNames, { fallback });
}

function localizedPackName(name) {
  return locale() === LOCALES.KO ? localizeKoreanPackName(name) : name;
}

function localizedRoomStatus(status) {
  return locale() === LOCALES.KO ? localizeKoreanRoomStatus(status) : status;
}

function localizedRarity(rarity) {
  return locale() === LOCALES.KO ? localizeKoreanRarity(rarity) : rarity;
}

function localizedDeckName(name) {
  const value = String(name || "");
  if (locale() !== LOCALES.KO) return value;
  const exact = new Map([
    ["Fury/Chaos Annie", "격노/혼돈 애니"],
    ["Calm/Body Master Yi OGS", "평온/신체 마스터 이 OGS"],
    ["Mind/Order Lux", "정신/질서 럭스"],
    ["Body/Order Garen", "신체/질서 가렌"],
    ["Best Origins Miss Fortune", "추천 오리진 미스 포츈"],
    ["Best Origins Kai'Sa", "추천 오리진 카이사"],
    ["Best Origins Sett", "추천 오리진 세트"],
    ["Origins Leona Stun", "오리진 레오나 기절"],
    ["Refined Origins Volibear", "개선형 오리진 볼리베어"],
    ["Riftbound.gg Origins Yasuo", "Riftbound.gg 오리진 야스오"],
    ["Riftbound.gg Origins Teemo", "Riftbound.gg 오리진 티모"],
    ["Riftbound.gg Origins Darius", "Riftbound.gg 오리진 다리우스"],
    ["SamaBR Origins Ahri", "SamaBR 오리진 아리"],
    ["Void Origins Viktor", "Void 오리진 빅토르"]
  ]);
  if (exact.has(value)) return exact.get(value);
  const replacements = [
    ["Master Yi", "마스터 이"],
    ["Miss Fortune", "미스 포츈"],
    ["Kai'Sa", "카이사"],
    ["Annie", "애니"],
    ["Diana", "다이애나"],
    ["Lux", "럭스"],
    ["Garen", "가렌"],
    ["Sett", "세트"],
    ["Leona", "레오나"],
    ["Volibear", "볼리베어"],
    ["Yasuo", "야스오"],
    ["Teemo", "티모"],
    ["Darius", "다리우스"],
    ["Ahri", "아리"],
    ["Viktor", "빅토르"],
    ["Origins", "오리진"],
    ["Fury", "격노"],
    ["Chaos", "혼돈"],
    ["Calm", "평온"],
    ["Body", "신체"],
    ["Mind", "정신"],
    ["Order", "질서"],
    ["Stun", "기절"],
    ["Best", "추천"],
    ["Refined", "개선형"]
  ];
  return replacements.reduce((result, [english, korean]) => result.replaceAll(english, korean), value);
}

function playerName(player) {
  return localizedDeckName(player?.name || "");
}

function localizedOnlineError(message) {
  return locale() === LOCALES.KO ? localizeKoreanNetworkError(message) : String(message || "");
}

function localizedCommandFailure(message) {
  const feedback = commandFailureFeedback(message, locale());
  if (locale() !== LOCALES.KO) return feedback;
  return {
    ...feedback,
    title: localizedDynamicText(feedback.title),
    detail: localizedDynamicText(feedback.detail, { fallback: "규칙 엔진이 요청을 거부했으며 게임 상태는 변경되지 않았습니다." })
  };
}

function render() {
  try {
    renderApp();
  } catch (error) {
    reportUiException(error, "render");
    showUiExceptionOverlay(error, "render");
  }
}

function renderApp() {
  uiLegalActions = [];
  const scrollState = captureScrollState();
  if (appView === "menu") {
    app.innerHTML = menuView();
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "tutorials") {
    app.innerHTML = tutorialMenuView();
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "decks") {
    app.innerHTML = deckEditorView();
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "multiplayer") {
    app.innerHTML = multiplayerView();
    restoreScrollState(scrollState);
    ensureRoomRefresh();
    return;
  }
  if (appView === "replays") {
    app.innerHTML = replayBrowserView();
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "game" && matchIsBetweenGames()) {
    app.innerHTML = sideboardingView();
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "analysis") {
    app.innerHTML = coachAnalysisView();
    restoreScrollState(scrollState);
    return;
  }
  if (lastInteractionPhase && lastInteractionPhase !== game.phase) {
    game.selectedCardId = null;
    onlineSelectedCardId = null;
    handOpen = false;
    attachmentsOpenCardId = null;
    inspectorOpen = false;
    moveSelection.clear();
  }
  lastInteractionPhase = game.phase;
  const nextViewerPlayerId = viewerPlayerId();
  if (lastViewerPlayerId && lastViewerPlayerId !== nextViewerPlayerId) {
    game.selectedCardId = null;
    onlineSelectedCardId = null;
    handOpen = false;
    attachmentsOpenCardId = null;
    moveSelection.clear();
  }
  lastViewerPlayerId = nextViewerPlayerId;
  const player = viewerPlayer();
  if (viewerCanAct()) uiLegalActions = enumerateLegalActions(game, nextViewerPlayerId);
  pruneMoveSelection();
  uiMotion = prepareUiMotion();
  if (uiMotion.feedback) rememberRealtimeFeedback(uiMotion.feedback);
  const presentationUpdate = updateGamePresentation();
  const interaction = interactionStatus();
  window.__riftboundGame = game;
  window.__riftboundRender = render;
  app.innerHTML = `
    <header class="topbar">
      <div class="titlebox status-${interaction.tone}" aria-live="polite">
        <p class="status-kicker">${interaction.label}</p>
        <h1>${interaction.title}</h1>
        <p class="status-detail">${interaction.detail}</p>
      </div>
      ${scoreTrack()}
      <div class="turnbox">
        <span>${turnLabel()}</span>
        <button class="secondary" data-action="toggle-log" title="${t("toggleLog", locale())}">${t("log", locale())}</button>
        ${replayMode ? `<button class="secondary" data-action="replay-exit">${locale() === LOCALES.KO ? "리플레이 목록" : "Replay list"}</button>` : ""}
        ${!replayMode && aiReplay ? `<button class="secondary" data-action="coach-report">${locale() === LOCALES.KO ? "AI 분석" : "AI Review"}</button>` : ""}
        ${replayMode ? "" : isTutorialGame()
          ? `<button class="secondary" data-action="tutorial-exit">${locale() === LOCALES.KO ? "튜토리얼 나가기" : "Exit Tutorial"}</button>`
          : `${game.phase !== "complete" ? `<button class="secondary danger" data-action="surrender" title="${t("surrender", locale())}">${t("surrender", locale())}</button>` : ""}
             <button class="secondary" data-action="new-game" title="${t("newGame", locale())}">${t("newGame", locale())}</button>`}
      </div>
    </header>
    <main class="layout phase-${game.phase} ${isTutorialGame() ? "tutorial-active" : ""} ${inspectorOpen ? "inspector-open" : ""} ${activeImpact ? `impact-active impact-${activeImpact.kind}` : ""} ${staticImpactPreview ? "preview-impact" : ""}">
      ${game.phase === "first-player" ? firstPlayerPanel() : game.phase === "champion-select" ? championSelectPanel() : game.phase === "battlefield-select" ? setupPanel() : game.phase === "mulligan" ? mulliganPanel() : gamePanel(player)}
      ${tutorialPanel()}
      ${cinematicImpactOverlay()}
      ${["first-player", "champion-select", "mulligan"].includes(game.phase) ? "" : inspector(uiSelectedCard())}
      ${pendingGameExit ? gameExitConfirmModal() : ""}
      ${isTutorialGame() ? "" : gameResultModal()}
      ${fullCardOpen ? fullCardModal(fullCardPreviewCard || uiSelectedCard()) : ""}
      ${logOpen ? logDrawer() : ""}
      ${replayMode ? replayPlaybackControls() : ""}
    </main>
  `;
  applyTutorialTargets();
  restorePaymentScroll();
  restoreScrollState(scrollState);
  scheduleAiTurn();
  scheduleReplayPlayback();
}

function isTutorialGame() {
  return Boolean(game?.tutorial?.active);
}

function tutorialPanel() {
  if (!isTutorialGame()) return "";
  const step = tutorialStep(game, { handOpen });
  if (!step) return "";
  const progress = tutorialProgress(step);
  const lesson = TUTORIAL_CATALOG.find((entry) => entry.id === game.tutorial.id);
  const complete = step.id === "complete";
  const welcome = step.id === "welcome";
  return `
    <aside class="tutorial-panel tutorial-step-${step.id}" role="status" aria-live="polite">
      <div class="tutorial-panel-head">
        <span>${escapeHtml(locale() === LOCALES.KO ? (lesson?.title || "초보자 튜토리얼") : (lesson?.englishTitle || "Beginner Tutorial"))}</span>
        <b>${progress.current}/${progress.total}</b>
      </div>
      <div class="tutorial-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${progress.total}" aria-valuenow="${progress.current}">
        <i style="width:${progress.percent}%"></i>
      </div>
      <h2>${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.body)}</p>
      <small>${escapeHtml(step.hint)}</small>
      ${welcome ? `<button class="primary tutorial-panel-action" data-action="tutorial-next">${escapeHtml(step.actionLabel)}</button>` : ""}
      ${complete ? `
        <div class="tutorial-complete-actions">
          <button class="secondary" data-action="tutorial-restart">${locale() === LOCALES.KO ? "다시 연습" : "Replay"}</button>
          <button class="primary" data-action="tutorial-exit">${locale() === LOCALES.KO ? "튜토리얼 목록" : "Tutorial List"}</button>
        </div>
      ` : ""}
    </aside>
  `;
}

function applyTutorialTargets() {
  if (!isTutorialGame()) return;
  for (const node of app.querySelectorAll("[data-action]")) {
    const action = node.dataset.action;
    if (node.closest(".tutorial-panel") || action === "tutorial-exit") continue;
    const allowed = tutorialActionAllowed(game, action, { ...node.dataset }, { handOpen });
    node.classList.toggle("tutorial-target", allowed);
    node.classList.toggle("tutorial-locked", !allowed);
    if (!allowed) node.setAttribute("aria-disabled", "true");
  }
}

function tutorialAllowsUiAction(action, data = {}) {
  return !isTutorialGame() || tutorialActionAllowed(game, action, data, { handOpen });
}

function reportUiException(error, context = "UI") {
  if (reportingUiException) return;
  reportingUiException = true;
  try {
    const message = errorMessage(error);
    const stackLine = firstStackLine(error);
    const entry = `[UI Exception] ${context}: ${message}${stackLine ? ` (${stackLine})` : ""}`;
    if (game?.log) game.log = [entry, ...game.log].slice(0, 18);
    if (console?.error) console.error(entry, error);
  } finally {
    reportingUiException = false;
  }
}

function errorMessage(error) {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? (locale() === LOCALES.KO ? "알 수 없는 오류" : "Unknown error"));
}

function firstStackLine(error) {
  if (!(error instanceof Error) || !error.stack) return "";
  return error.stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith(error.name) && !line.includes("reportUiException")) || "";
}

function showUiExceptionOverlay(error, context = "UI") {
  const existing = app.querySelector(".ui-exception-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.className = "ui-exception-banner";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `
    <strong>${locale() === LOCALES.KO ? "화면 처리 오류" : "UI Exception"}</strong>
    <span>${escapeHtml(locale() === LOCALES.KO ? localizedUiExceptionContext(context) : context)}: ${escapeHtml(localizedDynamicText(errorMessage(error)))}</span>
  `;
  app.appendChild(banner);
}

function localizedUiExceptionContext(context) {
  return {
    UI: "화면",
    render: "화면 그리기",
    "window error": "브라우저 오류",
    "unhandled promise": "비동기 처리 오류",
    "deep AI review": "정밀 AI 분석",
    "trained AI model load": "학습 AI 모델 불러오기"
  }[context] || "화면 처리";
}

function captureScrollState() {
  const selectors = [".deck-card-library", ".deck-list-panel", ".deck-slot-grid", ".deck-preview-card p", ".hand-panel .cards"];
  const state = {};
  for (const selector of selectors) {
    const node = app.querySelector(selector);
    if (node) state[selector] = { top: node.scrollTop, left: node.scrollLeft };
  }
  for (const node of app.querySelectorAll("[data-scroll-key]")) {
    const selector = `[data-scroll-key="${node.dataset.scrollKey}"]`;
    state[selector] = { top: node.scrollTop, left: node.scrollLeft };
  }
  const scope = scrollStateScope();
  for (const node of app.querySelectorAll("*")) {
    if (node.hasAttribute("data-scroll-key")) continue;
    const style = window.getComputedStyle(node);
    const scrollsHorizontally = /^(auto|scroll|overlay)$/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    const scrollsVertically = /^(auto|scroll|overlay)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (!scrollsHorizontally && !scrollsVertically) continue;
    const path = scrollNodePath(node);
    if (!path) continue;
    state[`@auto:${scope}:${path.join(".")}`] = {
      top: node.scrollTop,
      left: node.scrollLeft,
      path,
      scope,
      signature: scrollNodeSignature(node)
    };
  }
  const scrollingElement = document.scrollingElement;
  if (scrollingElement) {
    state[`@page:${scope}`] = { top: scrollingElement.scrollTop, left: scrollingElement.scrollLeft, scope };
  }
  if (state[".hand-panel .cards"]) handScrollLeft = state[".hand-panel .cards"].left || 0;
  return { ...shellScrollState, ...state };
}

function restoreScrollState(state = shellScrollState) {
  shellScrollState = state || {};
  applyScrollState(shellScrollState);
  const scheduledState = shellScrollState;
  window.requestAnimationFrame(() => {
    if (shellScrollState === scheduledState) applyScrollState(scheduledState);
  });
}

function applyScrollState(state) {
  const scope = scrollStateScope();
  for (const [selector, value] of Object.entries(state || {})) {
    if (selector.startsWith("@page:")) {
      if (value.scope !== scope || !document.scrollingElement) continue;
      document.scrollingElement.scrollTop = value.top || 0;
      document.scrollingElement.scrollLeft = value.left || 0;
      continue;
    }
    const node = selector.startsWith("@auto:")
      ? (value.scope === scope ? resolveScrollNodePath(value.path) : null)
      : app.querySelector(selector);
    if (!node || (value.signature && scrollNodeSignature(node) !== value.signature)) continue;
    node.scrollTop = value.top || 0;
    node.scrollLeft = value.left || 0;
  }
  const handCards = app.querySelector(".hand-panel .cards");
  if (handCards) handCards.scrollLeft = handScrollLeft;
}

function scrollStateScope() {
  const main = app.querySelector(":scope > main");
  if (!main) return "empty";
  if (main.classList.contains("layout")) {
    const phase = [...main.classList].find((className) => className.startsWith("phase-")) || "phase-unknown";
    return `layout.${phase}`;
  }
  return [...main.classList].sort().join(".") || main.tagName.toLowerCase();
}

function scrollNodePath(node) {
  const path = [];
  let current = node;
  while (current && current !== app) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = [...parent.children].indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === app ? path : null;
}

function resolveScrollNodePath(path = []) {
  let node = app;
  for (const index of path) {
    node = node?.children?.[index] || null;
    if (!node) return null;
  }
  return node;
}

function scrollNodeSignature(node) {
  const classes = [...node.classList]
    .filter((className) => !["open", "closed", "active", "selected", "chosen"].includes(className))
    .sort()
    .join(".");
  return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
}

function restorePaymentScroll() {
  const payRunes = app.querySelector(".pay-runes");
  if (payRunes) payRunes.scrollLeft = paymentRunesScrollLeft;
}

function menuView() {
  const activeDecks = activeDeckRecords();
  const validPair = activeDecks.length === 2 && activeDecks.every((deck) => validateDeckRecord(deck).playable);
  const playableDecks = deckStore.decks.filter((deck) => validateDeckRecord(deck).playable);
  const generation = selectedAiGenerationDescriptor();
  const aiDeckTrainingId = trainingDeckIdForGeneration(activeDecks[1], generation);
  const aiMatchReady = validPair && Boolean(aiDeckTrainingId);
  return `
    <main class="shell-screen main-menu">
      <section class="menu-hero">
        <p class="eyebrow visible">Riftbound Online</p>
        <h1>Riftbound</h1>
        ${accountMenuPanel()}
        <div class="settings-row" aria-label="${t("settings", locale())}">
          <label>
            <span>${t("language", locale())}</span>
            <select data-action="settings-language">
              ${Object.entries(LOCALE_LABELS).map(([value, label]) => `
                <option value="${value}" ${locale() === value ? "selected" : ""}>${label}</option>
              `).join("")}
            </select>
          </label>
        </div>
        <p>${locale() === LOCALES.KO ? "\uB85C\uCEEC \uB300\uC804\uACFC \uB371 \uD3B8\uC9D1\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4." : "Start a local match or edit decks."}</p>
        <div class="menu-deck-picker">
          <label>
            <span>${t("playerDeck", locale(), { n: 1 })}</span>
            <select data-action="menu-active-deck" data-slot="0">
              ${deckPickerOptions(playableDecks, deckStore.activeDeckIds[0])}
            </select>
          </label>
          <label>
            <span>${t("playerDeck", locale(), { n: 2 })}</span>
            <select data-action="menu-active-deck" data-slot="1">
              ${deckPickerOptions(playableDecks, deckStore.activeDeckIds[1])}
            </select>
          </label>
        </div>
        <div class="ai-menu-config">
          <label>
            <span>${locale() === LOCALES.KO ? "AI 세대" : "AI generation"}</span>
            <select data-action="menu-ai-generation" ${neuralAiLoadState === "loading" ? "disabled" : ""}>
              ${availableAiGenerations.map((entry) => `<option value="${entry.generation}" ${entry.generation === generation.generation ? "selected" : ""}>${escapeHtml(aiGenerationOptionLabel(entry))}</option>`).join("")}
            </select>
          </label>
          <div class="ai-training-scope">
            <span>${locale() === LOCALES.KO ? "이 세대가 학습한 AI 덱" : "AI decks trained for this generation"}</span>
            <strong>${escapeHtml(trainingDeckNames(generation).join(" · "))}</strong>
            <small>${escapeHtml(aiGenerationDetailText(generation))}</small>
          </div>
        </div>
        <label class="sideboard-toggle">
          <input type="checkbox" data-action="settings-sideboarding" ${settings.sideboardingEnabled ? "checked" : ""} />
          <span>${locale() === LOCALES.KO ? "사이드전 사용 (3판 2선승)" : "Use sideboarding (best of three)"}</span>
        </label>
        <div class="menu-actions">
          <button class="primary menu-button tutorial-start" data-action="menu-tutorial">
            ${locale() === LOCALES.KO
              ? `튜토리얼 ${tutorialRecord.completedIds.length}/${TUTORIAL_CATALOG.length}`
              : `Tutorials ${tutorialRecord.completedIds.length}/${TUTORIAL_CATALOG.length}`}
          </button>
          <button class="primary menu-button" data-action="menu-start" ${validPair ? "" : "disabled"}>${t("startGame", locale())}</button>
          <button class="primary menu-button coach-start" data-action="menu-ai" ${aiMatchReady && neuralAiLoadState !== "loading" ? "" : "disabled"}>${neuralAiLoadState === "loading" ? (locale() === LOCALES.KO ? "선택한 세대 로딩 중…" : "Loading selected generation…") : (locale() === LOCALES.KO ? "학습 AI와 대전" : "Play Learning AI")}</button>
          <button class="secondary menu-button replay-menu-button" data-action="menu-replays">${locale() === LOCALES.KO ? "AI 경기 리플레이" : "AI Match Replays"}</button>
          <button class="secondary menu-button" data-action="menu-multiplayer">${t("multiplayer", locale())}</button>
          <button class="secondary menu-button" data-action="menu-decks">${t("deckEdit", locale())}</button>
        </div>
        <p class="ai-model-status">${escapeHtml(neuralAiStatusText())}</p>
        ${aiGenerationCatalogError ? `<p class="online-error" role="alert">${escapeHtml(aiGenerationCatalogError)}</p>` : ""}
        ${validPair && !aiDeckTrainingId ? `<p class="deck-warning ai-deck-warning">${escapeHtml(locale() === LOCALES.KO
          ? `${generation.generation}세대 AI는 학습한 5개 덱만 사용할 수 있습니다. 플레이어 2 덱을 위 학습 덱 중 하나로 선택해 주세요.`
          : `Generation ${generation.generation} AI can only use its five trained decks. Select one of the trained decks for Player 2.`)}</p>` : ""}
        ${online.loading ? `<p class="online-status">${locale() === LOCALES.KO ? "멀티플레이 서버에 연결 중입니다." : "Connecting to the multiplayer server."}</p>` : ""}
        ${online.error ? `<p class="online-error" role="alert">${escapeHtml(localizedOnlineError(online.error))}</p>` : ""}
        <div class="active-decks-summary">
          ${activeDecks.map((deck, index) => deckSummaryBadge(deck, t("playerDeck", locale(), { n: index + 1 }))).join("")}
        </div>
        ${validPair ? "" : `<p class="deck-warning">${locale() === LOCALES.KO ? `토너먼트에서 사용 가능한 덱 2개가 필요합니다. 주 덱은 정확히 ${DECK_RULES.tournamentMainExact}장, 사이드보드는 최대 ${DECK_RULES.sideboardMax}장, 룬은 ${DECK_RULES.runeExact}장, 전장은 ${DECK_RULES.battlefieldsExact}장이어야 합니다.` : `Two tournament-legal decks are required: exactly ${DECK_RULES.tournamentMainExact} Main Deck cards, up to ${DECK_RULES.sideboardMax} Sideboard cards, ${DECK_RULES.runeExact} Runes, and ${DECK_RULES.battlefieldsExact} Battlefields.`}</p>`}
      </section>
    </main>
  `;
}

function accountMenuPanel() {
  const korean = locale() === LOCALES.KO;
  if (auth.user) {
    const syncText = {
      saving: korean ? "덱을 서버에 저장하는 중…" : "Saving decks to the server…",
      saved: korean ? "계정 덱이 서버에 저장됨" : "Account decks saved on the server",
      error: korean ? "서버 저장 실패" : "Server save failed",
      idle: korean ? "계정별 덱 보관 사용 중" : "Account deck storage is active"
    }[auth.syncStatus] || (korean ? "계정별 덱 보관 사용 중" : "Account deck storage is active");
    return `
      <section class="account-panel signed-in" aria-label="${korean ? "계정" : "Account"}">
        <div class="account-identity">
          <span>${korean ? "로그인 계정" : "Signed in"}</span>
          <strong>${escapeHtml(auth.user.accountId)}</strong>
          <small class="account-sync sync-${auth.syncStatus}">${escapeHtml(syncText)}</small>
        </div>
        <button type="button" class="secondary" data-action="auth-logout" ${auth.status === "working" ? "disabled" : ""}>${korean ? "로그아웃" : "Sign out"}</button>
      </section>
      ${auth.error ? `<p class="account-message error" role="alert">${escapeHtml(auth.error)}</p>` : ""}
      ${auth.notice ? `<p class="account-message success" role="status">${escapeHtml(auth.notice)}</p>` : ""}
    `;
  }
  const signingUp = auth.mode === "signup";
  if (!auth.panelOpen) {
    return `
      <section class="account-panel account-compact signed-out" aria-label="${korean ? "로그인 및 회원가입" : "Sign in and create account"}">
        <div class="account-compact-copy">
          <strong>${korean ? "계정 덱 보관" : "Account decks"}</strong>
          <small>${korean ? "서버에 내 덱 저장" : "Save decks on the server"}</small>
        </div>
        <div class="account-mode-tabs" role="tablist">
          <button type="button" data-action="auth-mode" data-mode="login">${korean ? "로그인" : "Sign in"}</button>
          <button type="button" data-action="auth-mode" data-mode="signup">${korean ? "회원가입" : "Create account"}</button>
        </div>
        ${auth.notice ? `<p class="account-message success" role="status">${escapeHtml(auth.notice)}</p>` : ""}
      </section>
    `;
  }
  return `
    <section class="account-panel signed-out" aria-label="${korean ? "로그인 및 회원가입" : "Sign in and create account"}">
      <div class="account-panel-head">
        <div>
          <strong>${korean ? "내 덱을 어디서든 이어서 사용하세요" : "Keep your decks across devices"}</strong>
          <small>${korean ? "계정별 덱은 이 서버에 안전하게 보관됩니다." : "Your account decks are stored on this server."}</small>
        </div>
        <div class="account-mode-tabs" role="tablist">
          <button type="button" class="${!signingUp ? "active" : ""}" data-action="auth-mode" data-mode="login">${korean ? "로그인" : "Sign in"}</button>
          <button type="button" class="${signingUp ? "active" : ""}" data-action="auth-mode" data-mode="signup">${korean ? "회원가입" : "Create account"}</button>
        </div>
        <button type="button" class="account-panel-close" data-action="auth-close" aria-label="${korean ? "계정 창 닫기" : "Close account panel"}">×</button>
      </div>
      <div class="account-form">
        <label>
          <span>${korean ? "아이디" : "Account ID"}</span>
          <input data-action="auth-account-id" value="${escapeHtml(auth.accountId)}" autocomplete="username" minlength="3" maxlength="24" placeholder="${korean ? "3~24자 아이디" : "3–24 characters"}" ${auth.status === "working" ? "disabled" : ""} />
        </label>
        <label>
          <span>${korean ? "비밀번호" : "Password"}</span>
          <input data-action="auth-password" type="password" value="${escapeHtml(auth.password)}" autocomplete="${signingUp ? "new-password" : "current-password"}" minlength="8" maxlength="128" placeholder="${korean ? "8자 이상" : "At least 8 characters"}" ${auth.status === "working" ? "disabled" : ""} />
        </label>
        ${signingUp ? `<label>
          <span>${korean ? "비밀번호 확인" : "Confirm password"}</span>
          <input data-action="auth-password-confirm" type="password" value="${escapeHtml(auth.passwordConfirm)}" autocomplete="new-password" minlength="8" maxlength="128" placeholder="${korean ? "비밀번호를 다시 입력" : "Enter password again"}" ${auth.status === "working" ? "disabled" : ""} />
        </label>` : ""}
        <button type="button" class="primary account-submit" data-action="auth-submit" ${auth.status === "working" ? "disabled" : ""}>${auth.status === "working"
          ? (korean ? "처리 중…" : "Please wait…")
          : signingUp ? (korean ? "계정 만들기" : "Create account") : (korean ? "로그인" : "Sign in")}</button>
      </div>
      ${auth.error ? `<p class="account-message error" role="alert">${escapeHtml(auth.error)}</p>` : ""}
      ${auth.notice ? `<p class="account-message success" role="status">${escapeHtml(auth.notice)}</p>` : ""}
    </section>
  `;
}

function replayBrowserView() {
  const korean = locale() === LOCALES.KO;
  return `
    <main class="shell-screen replay-browser-screen">
      <section class="replay-browser-shell">
        <header class="replay-browser-head">
          <div>
            <p class="eyebrow visible">${korean ? "AI 자기대전 관전실" : "AI self-play theater"}</p>
            <h1>${korean ? "최근 AI 경기 리플레이" : "Recent AI match replays"}</h1>
            <p>${korean ? "모델과 양쪽 덱, 경기 결과를 확인한 뒤 관전할 경기를 선택하세요." : "Choose a match after reviewing its models, decks, and result."}</p>
          </div>
          <div class="actions inline">
            <button class="secondary" data-action="replay-list-refresh" ${replayBrowser.loading ? "disabled" : ""}>${korean ? "새로고침" : "Refresh"}</button>
            <button data-action="replay-list-back">${korean ? "메뉴로" : "Menu"}</button>
          </div>
        </header>
        ${replayBrowser.loading ? `<p class="replay-list-message">${korean ? "최근 리플레이를 불러오는 중입니다…" : "Loading recent replays…"}</p>` : ""}
        ${replayBrowser.error ? `<p class="online-error replay-list-message" role="alert">${escapeHtml(replayBrowser.error)}</p>` : ""}
        <div class="replay-list">
          ${!replayBrowser.loading && !replayBrowser.items.length ? `
            <section class="replay-empty">
              <strong>${korean ? "아직 관전 가능한 기록이 없습니다." : "No watchable matches yet."}</strong>
              <p>${korean ? "다음 AI 학습 자기대전부터 표본 경기가 자동 저장됩니다." : "Sample matches will be saved automatically during the next AI training run."}</p>
            </section>
          ` : replayBrowser.items.map(replayListCard).join("")}
        </div>
      </section>
    </main>
  `;
}

function replayListCard(item) {
  const korean = locale() === LOCALES.KO;
  const decks = ["p1", "p2"].map((playerId) => item.decks?.find((deck) => deck.playerId === playerId) || {});
  const models = ["p1", "p2"].map((playerId) => item.models?.find((model) => model.playerId === playerId) || {});
  const winnerIndex = item.winnerId === "p2" ? 1 : item.winnerId === "p1" ? 0 : -1;
  const score = item.scores || [0, 0];
  const date = formatReplayDate(item.completedAt || item.createdAt);
  return `
    <article class="replay-list-card">
      <div class="replay-card-summary">
        <span>${escapeHtml(date)}${item.matchGameNumber ? ` · ${korean ? `${item.matchGameNumber}경기` : `Game ${item.matchGameNumber}`}` : ""}</span>
        <strong>${score[0] || 0} : ${score[1] || 0}</strong>
        <em>${winnerIndex < 0 ? (korean ? "미완료/무승부" : "Incomplete/draw") : `${korean ? "승자" : "Winner"} · ${escapeHtml(localizedDeckName(decks[winnerIndex].name || decks[winnerIndex].id || `P${winnerIndex + 1}`))}`}</em>
      </div>
      <div class="replay-matchup">
        ${replaySeatSummary("P1", decks[0], models[0], winnerIndex === 0)}
        <b>VS</b>
        ${replaySeatSummary("P2", decks[1], models[1], winnerIndex === 1)}
      </div>
      <footer>
        <span>${korean ? `세대 ${item.generation ?? "-"} · ${item.turns || 0}라운드 · ${item.actionCount || 0}행동` : `Gen ${item.generation ?? "-"} · ${item.turns || 0} rounds · ${item.actionCount || 0} actions`}</span>
        <button class="primary" data-action="replay-open" data-replay-id="${escapeHtml(item.id)}">${korean ? "이 경기 관전" : "Watch match"}</button>
      </footer>
    </article>
  `;
}

function replaySeatSummary(seat, deck = {}, model = {}, won = false) {
  const korean = locale() === LOCALES.KO;
  const deckName = localizedDeckName(deck.name || deck.id || seat);
  const legendName = deck.legend?.name ? localizedDynamicText(deck.legend.name) : "";
  return `
    <section class="replay-seat ${won ? "winner" : ""}">
      <span>${seat}${won ? ` · ${korean ? "승리" : "WIN"}` : ""}</span>
      <strong>${escapeHtml(deckName)}</strong>
      <small>${escapeHtml(legendName || deck.id || "-")}</small>
      <em>${korean ? "모델" : "Model"} G${model.generation ?? "-"} · ${escapeHtml(model.role || "AI")}</em>
    </section>
  `;
}

function formatReplayDate(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale() === LOCALES.KO ? "ko-KR" : "en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

async function openReplayBrowser() {
  pauseReplayPlayback();
  replayMode = false;
  replayBrowser.current = null;
  appView = "replays";
  render();
  await loadReplayList();
}

async function loadReplayList() {
  if (replayBrowser.loading) return;
  replayBrowser.loading = true;
  replayBrowser.error = "";
  render();
  try {
    const result = await fetchAiSpectatorReplays(40);
    replayBrowser.items = Array.isArray(result.replays) ? result.replays : [];
  } catch (error) {
    replayBrowser.error = locale() === LOCALES.KO
      ? `리플레이 목록을 불러오지 못했습니다: ${localizedOnlineError(error.message)}`
      : `Could not load replays: ${error.message}`;
  } finally {
    replayBrowser.loading = false;
    render();
  }
}

async function openAiSpectatorReplay(id) {
  if (!id || replayBrowser.loading) return;
  replayBrowser.loading = true;
  replayBrowser.error = "";
  render();
  try {
    const result = await fetchAiSpectatorReplay(id);
    if (!Array.isArray(result.replay?.frames) || !result.replay.frames.length) throw new Error("Replay has no frames.");
    clearOnlineSeat();
    aiMode = false;
    aiReplay = null;
    localMatch = null;
    replayBrowser.current = result.replay;
    replayBrowser.frameIndex = 0;
    replayBrowser.viewerPlayerId = "p1";
    replayBrowser.playing = false;
    replayMode = true;
    appView = "game";
    game = structuredClone(result.replay.frames[0].game);
    resetGameUiState();
  } catch (error) {
    replayBrowser.error = locale() === LOCALES.KO
      ? `리플레이를 열지 못했습니다: ${localizedOnlineError(error.message)}`
      : `Could not open replay: ${error.message}`;
    replayMode = false;
    appView = "replays";
  } finally {
    replayBrowser.loading = false;
    render();
  }
}

function leaveReplayBrowser() {
  pauseReplayPlayback();
  replayMode = false;
  replayBrowser.current = null;
  appView = "menu";
}

function exitReplayToList() {
  pauseReplayPlayback();
  replayMode = false;
  replayBrowser.current = null;
  appView = "replays";
}

function replayPlaybackControls() {
  const replay = replayBrowser.current;
  if (!replay?.frames?.length) return "";
  const frame = replay.frames[replayBrowser.frameIndex] || replay.frames[0];
  const lastIndex = replay.frames.length - 1;
  const korean = locale() === LOCALES.KO;
  return `
    <aside class="replay-playback-controls" aria-label="${korean ? "리플레이 재생 조작" : "Replay controls"}">
      <div class="replay-now-playing">
        <span>${korean ? `행동 ${replayBrowser.frameIndex}/${lastIndex}` : `Action ${replayBrowser.frameIndex}/${lastIndex}`} · ${korean ? `${frame.turnNumber || 1}라운드` : `Round ${frame.turnNumber || 1}`}</span>
        <strong>${escapeHtml(replayActionDescription(frame))}</strong>
      </div>
      <div class="replay-transport">
        <button data-action="replay-first" title="${korean ? "처음" : "First"}">|◀</button>
        <button data-action="replay-prev" title="${korean ? "이전 행동" : "Previous"}">◀</button>
        <button class="primary" data-action="replay-toggle">${replayBrowser.playing ? (korean ? "일시정지" : "Pause") : (korean ? "재생" : "Play")}</button>
        <button data-action="replay-next" title="${korean ? "다음 행동" : "Next"}">▶</button>
        <button data-action="replay-last" title="${korean ? "마지막" : "Last"}">▶|</button>
      </div>
      <input class="replay-timeline" type="range" min="0" max="${lastIndex}" value="${replayBrowser.frameIndex}" data-action="replay-seek" aria-label="${korean ? "리플레이 위치" : "Replay position"}" />
      <div class="replay-view-options">
        <button class="${replayBrowser.viewerPlayerId === "p1" ? "active" : ""}" data-action="replay-viewer" data-player="p1">P1</button>
        <button class="${replayBrowser.viewerPlayerId === "p2" ? "active" : ""}" data-action="replay-viewer" data-player="p2">P2</button>
        <select data-action="replay-speed" aria-label="${korean ? "재생 속도" : "Playback speed"}">
          ${[0.5, 1, 2, 4].map((speed) => `<option value="${speed}" ${replayBrowser.speed === speed ? "selected" : ""}>${speed}×</option>`).join("")}
        </select>
      </div>
    </aside>
  `;
}

function replayActionDescription(frame) {
  if (!frame?.action) return locale() === LOCALES.KO ? "경기 시작 상태" : "Match start";
  const actor = game.players.find((player) => player.id === frame.actorId);
  const actorName = actor ? playerName(actor) : (frame.actorId || "AI");
  const action = frame.action;
  const cardId = action.cardId || action.unitId || action.sourceCardId;
  const card = findVisibleCard(cardId);
  const target = card ? cardName(card) : "";
  const koreanLabels = {
    confirmFirstPlayer: "선공 확정", rollFirstPlayer: "선공 주사위", chooseFirstPlayer: "선공 선택",
    selectChampion: "챔피언 선택", selectBattlefield: "전장 선택", submitMulligan: "멀리건 확정",
    skipMulligan: "멀리건 유지", beginPlayCard: "카드 플레이", beginPlayChampion: "챔피언 플레이",
    hideCard: "카드 매복", moveUnit: "유닛 이동", moveUnits: "유닛 일괄 이동", activateCard: "능력 사용",
    chooseEffectOption: "효과 선택", declineEffectChoice: "선택 거절", passShowdown: "쇼다운 패스",
    endTurn: "턴 종료", gameComplete: "경기 종료"
  };
  const englishLabels = {
    confirmFirstPlayer: "confirmed first player", rollFirstPlayer: "rolled for first player", chooseFirstPlayer: "chose first player",
    selectChampion: "selected a champion", selectBattlefield: "selected a battlefield", submitMulligan: "confirmed mulligan",
    skipMulligan: "kept opening hand", beginPlayCard: "played a card", beginPlayChampion: "played the champion",
    hideCard: "set a hidden card", moveUnit: "moved a unit", moveUnits: "moved units", activateCard: "activated an ability",
    chooseEffectOption: "made an effect choice", declineEffectChoice: "declined an effect", passShowdown: "passed showdown",
    endTurn: "ended the turn", gameComplete: "match complete"
  };
  const label = (locale() === LOCALES.KO ? koreanLabels : englishLabels)[action.kind] || action.kind;
  return locale() === LOCALES.KO
    ? `${actorName} · ${label}${target ? ` · ${target}` : ""}`
    : `${actorName} ${label}${target ? ` · ${target}` : ""}`;
}

function handleReplayGameClick(event) {
  const button = event.target.closest("button");
  const action = button?.dataset.action;
  if (action === "replay-exit") return exitReplayToList();
  if (action === "replay-first") { pauseReplayPlayback(); return applyReplayFrame(0); }
  if (action === "replay-prev") { pauseReplayPlayback(); return applyReplayFrame(replayBrowser.frameIndex - 1); }
  if (action === "replay-next") { pauseReplayPlayback(); return applyReplayFrame(replayBrowser.frameIndex + 1); }
  if (action === "replay-last") { pauseReplayPlayback(); return applyReplayFrame((replayBrowser.current?.frames?.length || 1) - 1); }
  if (action === "replay-toggle") {
    replayBrowser.playing = !replayBrowser.playing;
    if (replayBrowser.playing && replayBrowser.frameIndex >= replayBrowser.current.frames.length - 1) applyReplayFrame(0);
    if (!replayBrowser.playing) pauseReplayPlayback();
    return;
  }
  if (action === "replay-viewer" && ["p1", "p2"].includes(button.dataset.player)) {
    replayBrowser.viewerPlayerId = button.dataset.player;
    handOpen = false;
    game.selectedCardId = null;
    return;
  }
  if (action === "toggle-log") { logOpen = !logOpen; return; }
  if (action === "toggle-hand") { handOpen = !handOpen; return; }
  if (action === "toggle-graveyard") { graveyardOpenPlayerId = graveyardOpenPlayerId === button.dataset.player ? null : button.dataset.player; return; }
  if (action === "toggle-banished") { banishedOpenPlayerId = banishedOpenPlayerId === button.dataset.player ? null : button.dataset.player; return; }
  if (action === "close-graveyard") { graveyardOpenPlayerId = null; return; }
  if (action === "close-banished") { banishedOpenPlayerId = null; return; }
  if (action === "close-full-card") { fullCardOpen = false; fullCardPreviewCard = null; return; }
  if (action === "view-full-card") { fullCardPreviewCard = uiSelectedCard(); fullCardOpen = Boolean(fullCardPreviewCard); return; }
  const cardNode = event.target.closest("[data-card-id]");
  if (cardNode) setUiSelectedCard(cardNode.dataset.cardId);
}

function applyReplayFrame(requestedIndex) {
  const frames = replayBrowser.current?.frames || [];
  if (!frames.length) return;
  const previousIndex = replayBrowser.frameIndex;
  const index = Math.max(0, Math.min(frames.length - 1, Math.trunc(requestedIndex)));
  replayBrowser.frameIndex = index;
  game = structuredClone(frames[index].game);
  game.selectedCardId = null;
  fullCardOpen = false;
  fullCardPreviewCard = null;
  attachmentsOpenCardId = null;
  graveyardOpenPlayerId = null;
  banishedOpenPlayerId = null;
  if (index <= previousIndex) {
    previousUiSnapshot = null;
    clearEffectAnimations();
    resetPresentationState(presentationState);
  }
}

function scheduleReplayPlayback() {
  if (!replayMode || !replayBrowser.playing || replayBrowser.timer) return;
  const frames = replayBrowser.current?.frames || [];
  if (replayBrowser.frameIndex >= frames.length - 1) {
    replayBrowser.playing = false;
    return;
  }
  replayBrowser.timer = window.setTimeout(() => {
    replayBrowser.timer = null;
    applyReplayFrame(replayBrowser.frameIndex + 1);
    render();
  }, Math.max(180, 1200 / replayBrowser.speed));
}

function pauseReplayPlayback() {
  replayBrowser.playing = false;
  if (replayBrowser.timer) window.clearTimeout(replayBrowser.timer);
  replayBrowser.timer = null;
}

function restartReplayTimer() {
  const wasPlaying = replayBrowser.playing;
  if (replayBrowser.timer) window.clearTimeout(replayBrowser.timer);
  replayBrowser.timer = null;
  replayBrowser.playing = wasPlaying;
  if (wasPlaying) scheduleReplayPlayback();
}

function tutorialMenuView() {
  const completed = new Set(tutorialRecord.completedIds);
  const isKorean = locale() === LOCALES.KO;
  return `
    <main class="shell-screen tutorial-menu-screen">
      <section class="tutorial-menu-shell">
        <header class="tutorial-menu-header">
          <button class="round-back" data-action="tutorial-menu-back">${t("back", locale())}</button>
          <div>
            <p class="eyebrow visible">${isKorean ? "오리진 덱으로 배우는" : "Learn With Origins Decks"}</p>
            <h1>${isKorean ? "초보자 튜토리얼" : "Beginner Tutorials"}</h1>
            <p>${isKorean
              ? "오리진 출시 환경의 카드와 덱으로 기본 규칙부터 전투와 비용 지불까지 차례대로 연습합니다."
              : "Practice the core rules, combat, and costs with cards and decks from the Origins environment."}</p>
          </div>
          <div class="tutorial-menu-progress" aria-label="${isKorean ? "튜토리얼 완료 현황" : "Tutorial completion"}">
            <strong>${completed.size}/${TUTORIAL_CATALOG.length}</strong>
            <span>${isKorean ? "완료" : "complete"}</span>
          </div>
        </header>
        <div class="tutorial-course-grid">
          ${TUTORIAL_CATALOG.map((lesson) => {
            const done = completed.has(lesson.id);
            return `
              <article class="tutorial-course-card ${done ? "is-complete" : ""}">
                <div class="tutorial-course-number">${lesson.order}</div>
                <div class="tutorial-course-copy">
                  <div class="tutorial-course-title">
                    <h2>${escapeHtml(isKorean ? lesson.title : lesson.englishTitle)}</h2>
                    ${done ? `<span class="tutorial-complete-badge">${isKorean ? "완료" : "Complete"}</span>` : ""}
                  </div>
                  <p>${escapeHtml(isKorean ? lesson.summary : lesson.englishSummary)}</p>
                  <small>${escapeHtml(isKorean ? lesson.focus : lesson.englishFocus)}</small>
                </div>
                <div class="tutorial-course-action">
                  <span>${escapeHtml(lesson.duration)}</span>
                  <button class="${lesson.order === 1 ? "primary" : "secondary"}" data-action="tutorial-select" data-tutorial="${lesson.id}">
                    ${done ? (isKorean ? "다시 하기" : "Replay") : (isKorean ? "시작하기" : "Start")}
                  </button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    </main>
  `;
}

function deckPickerOptions(playableDecks, selectedId) {
  if (!playableDecks.length) return `<option value="">${t("noPlayableDecks", locale())}</option>`;
  return playableDecks.map((deck) => `
    <option value="${escapeHtml(deck.id)}" ${deck.id === selectedId ? "selected" : ""}>${escapeHtml(localizedDeckName(deck.name))}</option>
  `).join("");
}

function selectedAiGenerationDescriptor() {
  return availableAiGenerations.find((entry) => entry.generation === Number(settings.aiGeneration))
    || aiGenerationDescriptor(settings.aiGeneration)
    || availableAiGenerations.at(-1)
    || AI_GENERATIONS.at(-1);
}

function aiGenerationOptionLabel(entry) {
  const korean = locale() === LOCALES.KO;
  const state = entry.kind === "learner"
    ? (korean ? "현재 learner" : "current learner")
    : entry.promoted
      ? (korean ? "승격" : "promoted")
      : entry.kind === "candidate"
        ? (korean ? "후보" : "candidate")
        : entry.kind === "league"
          ? (korean ? "리그" : "league")
          : (korean ? "배포" : "bundled");
  const progress = entry.inProgress ? (korean ? " · 학습 진행 중" : " · training in progress") : "";
  return korean
    ? `${entry.generation}세대 (${state}${progress})`
    : `Generation ${entry.generation} (${state}${progress})`;
}

function aiGenerationDetailText(entry) {
  const korean = locale() === LOCALES.KO;
  const games = korean ? `${entry.gamesTrained || 0}경기 학습` : `${entry.gamesTrained || 0} training games`;
  const compatibility = entry.engineCompatible === false
    ? (korean ? "과거 엔진 체크포인트" : "historical-engine checkpoint")
    : (korean ? "현재 엔진 호환" : "current-engine compatible");
  return `${games} · ${compatibility}`;
}

function trainingDeckNames(generation = selectedAiGenerationDescriptor()) {
  return generation.trainingDeckIds.map((id) => {
    const deck = RAW_DECK_BY_ID.get(id);
    return localizedDeckName(deck?.playerName || id);
  });
}

function trainingDeckIdForGeneration(deck, generation = selectedAiGenerationDescriptor()) {
  if (!deck) return null;
  return generation.trainingDeckIds.find((id) => {
    const rawDeck = RAW_DECK_BY_ID.get(id);
    if (!rawDeck) return false;
    const trainedDeck = deckRecordFromRaw(`trained-${id}`, rawDeck.playerName || id, rawDeck);
    return sameDeckConfiguration(deck, trainedDeck);
  }) || null;
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null");
    return {
      locale: normalizeLocale(parsed?.locale || LOCALES.EN),
      sideboardingEnabled: parsed?.sideboardingEnabled === true,
      aiGeneration: Number.isInteger(Number(parsed?.aiGeneration)) && Number(parsed.aiGeneration) >= 0
        ? Number(parsed.aiGeneration)
        : normalizeAiGeneration()
    };
  } catch {
    return { locale: LOCALES.EN, sideboardingEnabled: false, aiGeneration: normalizeAiGeneration() };
  }
}

function loadTutorialRecord() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TUTORIAL_STORAGE_KEY) || "null");
    const completedIds = Array.isArray(parsed?.completedIds)
      ? parsed.completedIds.filter((id) => TUTORIAL_CATALOG.some((entry) => entry.id === id))
      : (parsed?.completed === true ? [TUTORIAL_IDS.firstVictory] : []);
    return {
      completedIds: [...new Set(completedIds)],
      completedAtById: parsed?.completedAtById && typeof parsed.completedAtById === "object"
        ? parsed.completedAtById
        : (parsed?.completedAt ? { [TUTORIAL_IDS.firstVictory]: parsed.completedAt } : {})
    };
  } catch {
    return { completedIds: [], completedAtById: {} };
  }
}

function saveTutorialRecord() {
  localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(tutorialRecord));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function multiplayerView() {
  const activeDeck = activeDeckRecords()[0];
  const deckReady = activeDeck && validateDeckRecord(activeDeck).playable;
  const room = online.room;
  const mySeat = room?.seats?.[online.playerId];
  const codeValue = escapeHtml(online.joinCode || "");
  return `
    <main class="shell-screen multiplayer-screen">
      <section class="multiplayer-lobby">
        <div class="deck-builder-head">
          <button class="round-back" data-action="menu-home">${t("back", locale())}</button>
          <div>
            <h1>${t("multiplayer", locale())}</h1>
            <p>방을 만들거나 목록/코드로 참가합니다.</p>
          </div>
        </div>
        <div class="multiplayer-grid">
          <article class="multiplayer-panel">
            <div class="section-head">
              <div>
                <h2>${t("rooms", locale())}</h2>
                <span>${online.rooms.length} ${t("available", locale())}</span>
              </div>
              <button data-action="online-refresh" ${online.loading ? "disabled" : ""}>${t("refresh", locale())}</button>
            </div>
            <div class="room-list">
              ${online.rooms.map(roomListItem).join("") || `<p class="empty">열린 방이 없습니다.</p>`}
            </div>
            <div class="room-code-row">
              <input data-action="online-code-input" value="${codeValue}" maxlength="8" placeholder="${t("roomCode", locale())}" />
              <button data-action="online-join-code">${t("join", locale())}</button>
            </div>
            <button class="primary wide-action" data-action="online-create">${t("createRoom", locale())}</button>
            <p class="deck-note">${settings.sideboardingEnabled ? (locale() === LOCALES.KO ? "새 방: 사이드전 사용" : "New room: sideboarding enabled") : (locale() === LOCALES.KO ? "새 방: 단판" : "New room: single game")}</p>
          </article>
          <article class="multiplayer-panel">
            <div class="section-head">
              <div>
                <h2>${room ? `${t("rooms", locale())} ${room.roomId}` : t("noRoom", locale())}</h2>
                <span>${room ? `${room.playerCount}/2 ${t("players", locale())} / ${localizedRoomStatus(room.status)}` : t("createOrJoinRoom", locale())}</span>
                ${room ? `<small>${room.sideboardingEnabled ? (locale() === LOCALES.KO ? "사이드전 · 3판 2선승" : "Sideboarding · best of three") : (locale() === LOCALES.KO ? "단판" : "Single game")}</small>` : ""}
              </div>
              ${room ? `<button data-action="online-leave">${t("leave", locale())}</button>` : ""}
            </div>
            ${online.error ? `<p class="online-error">${escapeHtml(localizedOnlineError(online.error))}</p>` : ""}
            <div class="seat-list">
              ${room ? Object.values(room.seats).map(seatBadge).join("") : `<p class="empty">아직 참가한 방이 없습니다.</p>`}
            </div>
            <div class="online-deck-submit">
              <strong>${t("selectedDeck", locale())}</strong>
              ${activeDeck ? deckSummaryBadge(activeDeck, online.playerId ? `${locale() === LOCALES.KO ? "내 좌석" : "Your seat"}: ${playerSlotLabel(online.playerId)}` : (locale() === LOCALES.KO ? "로컬 덱" : "Local deck")) : `<p class="empty">선택된 덱이 없습니다.</p>`}
              <button data-action="online-submit-deck" ${room && deckReady ? "" : "disabled"}>${t("submitDeck", locale())}</button>
              <button class="primary" data-action="online-ready" ${room && mySeat?.deckName ? "" : "disabled"}>
                ${mySeat?.ready ? t("ready", locale()) : t("readyUp", locale())}
              </button>
            </div>
          </article>
        </div>
      </section>
    </main>
  `;
}

function roomListItem(room) {
  return `
    <button class="room-list-item" data-action="online-join-room" data-room="${room.roomId}" ${room.playerCount >= 2 || room.status !== "lobby" ? "disabled" : ""}>
      <strong>${room.roomId}</strong>
      <span>${room.playerCount}/2</span>
      <em>${localizedRoomStatus(room.status)}</em>
    </button>
  `;
}

function seatBadge(seat) {
  return `
    <div class="seat-badge ${seat.occupied ? "occupied" : ""} ${seat.playerId === online.playerId ? "mine" : ""}">
      <strong>${playerSlotLabel(seat.playerId)}</strong>
      <span>${seat.occupied ? localizedDeckName(seat.deckName) || "덱 대기 중" : "빈 좌석"}</span>
      <em>${seat.ready ? t("ready", locale()) : t("waiting", locale())}</em>
    </div>
  `;
}

function playerSlotLabel(playerId) {
  const number = String(playerId || "").match(/\d+/u)?.[0];
  if (locale() === LOCALES.KO && number) return `플레이어 ${number}`;
  return String(playerId || "").toUpperCase();
}

function deckEditorView() {
  const selectedDeck = getSelectedDeckRecord();
  const selectedCard = selectedDeckLibraryCard();
  return `
    <main class="shell-screen deck-builder-screen mobile-view-${deckEditor.mobileView} mobile-tab-${deckEditor.mobileTab}">
      <section class="deck-select-panel">
        <div class="deck-builder-head">
          <button class="round-back" data-action="menu-home">${t("back", locale())}</button>
          <div>
            <h1>${t("deckSelect", locale())}</h1>
            <p>편집할 덱을 선택하세요.</p>
            ${deckEditor.transferNotice?.tone === "error" ? `<p class="deck-transfer-notice error" role="alert">${escapeHtml(deckEditor.transferNotice.message)}</p>` : ""}
          </div>
        </div>
        <div class="deck-slot-grid">
          ${deckStore.decks.map(deckSelectCard).join("")}
          <button class="deck-slot new-deck-slot" data-action="deck-new">
            <span class="big-plus">+</span>
            <strong>새 덱 만들기</strong>
          </button>
          <button class="deck-slot import-deck-slot" data-action="deck-import-open">
            <span class="deck-import-icon" aria-hidden="true">TEXT</span>
            <strong>${locale() === LOCALES.KO ? "덱 텍스트 가져오기" : "Import Deck Text"}</strong>
            <span>${locale() === LOCALES.KO ? "복사한 덱 리스트를 붙여넣으세요." : "Paste a copied deck list."}</span>
            <span class="deck-import-cta">${locale() === LOCALES.KO ? "붙여넣기 창 열기" : "Open paste field"}</span>
          </button>
        </div>
      </section>
      <section class="deck-editor-panel">
        ${selectedDeck ? deckEditorContent(selectedDeck, selectedCard) : `<div class="empty-editor"><h2>덱을 선택하세요</h2></div>`}
      </section>
      ${deckDeleteConfirmationView()}
      ${deckTextTransferView()}
    </main>
  `;
}

function deckEditorContent(deck, selectedCard) {
  const validation = validateDeckRecord(deck);
  return `
    <div class="deck-editor-top">
      <button class="deck-mobile-back" data-action="deck-mobile-list">← ${locale() === LOCALES.KO ? "덱 목록" : "Decks"}</button>
      <div class="deck-name-row">
        <input class="deck-name-input" data-action="deck-name" value="${escapeHtml(localizedDeckName(deck.name))}" maxlength="48" />
        <span class="deck-owner-badge ${deck.isDefault ? "default" : "personal"}">${deck.isDefault
          ? (locale() === LOCALES.KO ? "기본 덱 · 수정 시 내 덱으로 복사" : "Default · copied to My Decks when edited")
          : (auth.user ? (locale() === LOCALES.KO ? "내 계정 덱" : "My account deck") : (locale() === LOCALES.KO ? "이 기기에 저장된 내 덱" : "My deck on this device"))}</span>
        <span class="${validation.playable ? "valid-pill" : "invalid-pill"}">${validation.playable ? t("playable", locale()) : t("notPlayable", locale())}</span>
      </div>
      <div class="deck-editor-actions">
        <button data-action="deck-ai-recommend">선택 카드풀 AI 추천</button>
        <button data-action="deck-set-active" data-slot="0" ${validation.playable ? "" : "disabled"}>플레이어 1 덱으로 사용</button>
        <button data-action="deck-set-active" data-slot="1" ${validation.playable ? "" : "disabled"}>플레이어 2 덱으로 사용</button>
        <button data-action="deck-export-open">${locale() === LOCALES.KO ? "덱 텍스트 복사" : "Copy Deck Text"}</button>
        ${deck.isDefault ? "" : `<button class="danger" data-action="deck-delete-request">${locale() === LOCALES.KO ? "덱 삭제" : "Delete deck"}</button>`}
        <button class="primary" data-action="deck-save">저장</button>
      </div>
      ${deckEditor.transferNotice ? `<p class="deck-transfer-notice ${deckEditor.transferNotice.tone}" role="${deckEditor.transferNotice.tone === "error" ? "alert" : "status"}">${escapeHtml(deckEditor.transferNotice.message)}</p>` : ""}
    </div>
    <nav class="deck-mobile-tabs" aria-label="${locale() === LOCALES.KO ? "덱 편집 단계" : "Deck editor sections"}">
      <button class="${deckEditor.mobileTab === "deck" ? "active" : ""}" data-action="deck-mobile-tab" data-tab="deck">${locale() === LOCALES.KO ? "덱 구성" : "Deck"}</button>
      <button class="${deckEditor.mobileTab === "runes" ? "active" : ""}" data-action="deck-mobile-tab" data-tab="runes">${t("runes", locale())}</button>
      <button class="${deckEditor.mobileTab === "cards" ? "active" : ""}" data-action="deck-mobile-tab" data-tab="cards">${locale() === LOCALES.KO ? "카드 추가" : "Cards"}</button>
      <button class="${deckEditor.mobileTab === "detail" ? "active" : ""}" data-action="deck-mobile-tab" data-tab="detail">${locale() === LOCALES.KO ? "상세" : "Detail"}</button>
    </nav>
    <div class="deck-editor-grid">
      <aside class="deck-card-detail">
        ${selectedCard ? deckDetailCard(selectedCard, deck) : deckDetailEmpty(deck)}
      </aside>
      <section class="deck-list-panel">
        ${deckValidityPanel(validation)}
        ${deckAiRecommendationPanel()}
        ${deckCompositionPanel(deck)}
      </section>
      <aside class="card-search-panel">
        ${cardSearchPanel(deck)}
      </aside>
    </div>
  `;
}

function deckDeleteConfirmationView() {
  const deck = deckStore.decks.find((candidate) => candidate.id === deckEditor.pendingDeleteDeckId);
  if (!deck || deck.isDefault || deck.id.startsWith("default-")) return "";
  const name = escapeHtml(localizedDeckName(deck.name));
  return `
    <div class="deck-delete-modal">
      <section class="deck-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-delete-title" aria-describedby="deck-delete-description">
        <span class="deck-delete-kicker">${locale() === LOCALES.KO ? "내 덱 삭제" : "Delete My Deck"}</span>
        <h2 id="deck-delete-title">${locale() === LOCALES.KO ? "이 덱을 삭제하시겠습니까?" : "Delete this deck?"}</h2>
        <p id="deck-delete-description">${locale() === LOCALES.KO
          ? "삭제한 덱은 복구할 수 없습니다. 사용 중인 덱이라면 해당 자리에 기본 덱이 자동으로 지정됩니다."
          : "This cannot be undone. If the deck is active, a default deck will replace it automatically."}</p>
        <strong class="deck-delete-name">${name}</strong>
        <div class="actions">
          <button data-action="deck-delete-cancel" autofocus>${locale() === LOCALES.KO ? "취소" : "Cancel"}</button>
          <button class="danger" data-action="deck-delete-confirm">${locale() === LOCALES.KO ? "영구 삭제" : "Delete permanently"}</button>
        </div>
      </section>
    </div>
  `;
}

function deckTextTransferView() {
  const dialog = deckEditor.transferDialog;
  if (!dialog) return "";
  const importing = dialog.mode === "import";
  const korean = locale() === LOCALES.KO;
  return `
    <div class="deck-transfer-modal">
      <section class="deck-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-transfer-title">
        <div class="deck-transfer-heading">
          <div>
            <span>${importing ? (korean ? "덱 가져오기" : "Import Deck") : (korean ? "덱 내보내기" : "Export Deck")}</span>
            <h2 id="deck-transfer-title">${importing
              ? (korean ? "덱 텍스트를 붙여넣으세요" : "Paste deck text")
              : (korean ? "덱 텍스트를 복사하세요" : "Copy deck text")}</h2>
          </div>
          <button class="deck-transfer-close" data-action="deck-transfer-close" aria-label="${t("close", locale())}">×</button>
        </div>
        <p>${importing
          ? (korean ? "Legend, Champion, MainDeck, Battlefields, Rune Pool, Sideboard 형식의 전체 목록을 붙여넣으세요." : "Paste the complete Legend, Champion, MainDeck, Battlefields, Rune Pool, and Sideboard list.")
          : (korean ? "아래 내용을 그대로 복사해 다른 곳에 저장하거나 다시 가져올 수 있습니다." : "Copy the text below to save it elsewhere or import it again later.")}</p>
        <textarea
          class="deck-transfer-text"
          data-action="deck-transfer-text"
          aria-label="${importing ? (korean ? "가져올 덱 텍스트" : "Deck text to import") : (korean ? "내보낼 덱 텍스트" : "Exported deck text")}"
          spellcheck="false"
          ${importing ? "" : "readonly"}
          placeholder="Legend:\n1 Master Yi, Wuju Bladesman\n\nChampion:\n1 Master Yi, Tempered\n\nMainDeck:\n3 First Mate"
        >${escapeHtml(dialog.text || "")}</textarea>
        ${dialog.error ? `<p class="deck-transfer-message error" role="alert">${escapeHtml(dialog.error)}</p>` : ""}
        ${dialog.notice ? `<p class="deck-transfer-message success" role="status">${escapeHtml(dialog.notice)}</p>` : ""}
        <div class="actions">
          <button data-action="deck-transfer-close">${korean ? "닫기" : "Close"}</button>
          ${importing
            ? `<button class="primary" data-action="deck-import-confirm" ${dialog.text?.trim() ? "" : "disabled"}>${korean ? "이 텍스트로 덱 만들기" : "Create Deck From Text"}</button>`
            : `<button class="primary" data-action="deck-export-copy">${korean ? "전체 텍스트 복사" : "Copy All Text"}</button>`}
        </div>
      </section>
    </div>
  `;
}

function deckSelectCard(deck) {
  const validation = validateDeckRecord(deck);
  const hero = deckHeroCard(deck);
  const activeLabels = deckStore.activeDeckIds
    .map((id, index) => id === deck.id ? (locale() === LOCALES.KO ? `플레이어 ${index + 1}` : `P${index + 1}`) : null)
    .filter(Boolean)
    .join(" / ");
  return `
    <button class="deck-slot ${deck.id === deckEditor.selectedDeckId ? "selected" : ""}" data-action="deck-select" data-deck="${escapeHtml(deck.id)}">
      ${hero?.image ? `<img src="${hero.image}" alt="${cardName(hero)}" loading="lazy" />` : `<span class="deck-card-back"></span>`}
      ${activeLabels ? `<em>${activeLabels}</em>` : ""}
      <strong>${escapeHtml(localizedDeckName(deck.name))}</strong>
      <span class="deck-owner-label ${deck.isDefault ? "default" : "personal"}">${deck.isDefault
        ? (locale() === LOCALES.KO ? "기본 덱" : "Default")
        : (locale() === LOCALES.KO ? "내 덱" : "My Deck")}</span>
      <span>${mainDeckCount(deck)}/${DECK_RULES.tournamentMainExact} ${t("main", locale())} · ${sideboardCount(deck)}/${DECK_RULES.sideboardMax} ${locale() === LOCALES.KO ? "사이드보드" : "SB"}</span>
      <small class="${validation.playable ? "valid-text" : "invalid-text"}">${validation.playable ? t("playable", locale()) : t("cannotPlayDeck", locale())}</small>
    </button>
  `;
}

function deckSummaryBadge(deck, label) {
  const validation = validateDeckRecord(deck);
  return `
    <div class="active-deck-badge ${validation.playable ? "" : "invalid"}">
      <span>${label}</span>
      <strong>${escapeHtml(deck ? localizedDeckName(deck.name) : t("noDeck", locale()))}</strong>
      <em>${validation.playable ? t("ready", locale()) : t("invalid", locale())}</em>
    </div>
  `;
}

function deckDetailEmpty(deck) {
  return `
    <div class="deck-preview-card">
      <span class="deck-card-back large"></span>
      <h2>${escapeHtml(localizedDeckName(deck.name))}</h2>
      <p>오른쪽 카드 목록에서 카드를 선택하세요.</p>
    </div>
  `;
}

function deckDetailCard(card, deck) {
  return `
    <div class="deck-preview-card">
      ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" />` : `<span class="deck-card-back large"></span>`}
      <h2>${cardName(card)}</h2>
      <span>${cardTags(card).join(" / ")}</span>
      <p>${cardText(card)}</p>
      <div class="deck-detail-actions">
        ${deckActionButtonsForCard(card, deck)}
      </div>
    </div>
  `;
}

function deckActionButtonsForCard(card, deck) {
  const buttons = [];
  if (card.type === "legend") {
    buttons.push(`<button data-action="deck-set-legend" data-card-number="${card.cardNumber}">레전드 설정</button>`);
  } else if (card.type === "battlefield") {
    const disabled = deck.battlefields.length >= DECK_RULES.battlefieldsExact && !deck.battlefields.includes(card.cardNumber);
    buttons.push(`<button data-action="deck-add-battlefield" data-card-number="${card.cardNumber}" ${disabled ? "disabled" : ""}>전장 추가</button>`);
  } else if (card.type === "rune") {
    const count = cardCount(deck.runes, card.cardNumber);
    const disabled = runeDeckCount(deck) >= DECK_RULES.runeExact || !runeMatchesLegend(deck, card);
    buttons.push(`<button data-action="deck-rune-add" data-card-number="${card.cardNumber}" ${disabled ? "disabled" : ""}>${locale() === LOCALES.KO ? "룬 덱에 추가" : "Add to Rune Deck"} ${count}</button>`);
  } else if (["unit", "spell", "gear"].includes(card.type)) {
    const count = cardCount(deck.main, card.cardNumber);
    const sideCountValue = cardCount(deck.sideboard, card.cardNumber);
    const unlimited = cardAllowsUnlimitedCopies(card);
    const maximumLabel = unlimited ? "∞" : DECK_RULES.maxCopies;
    buttons.push(`<button data-action="deck-add-main" data-card-number="${card.cardNumber}" ${(!unlimited && registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies) || mainDeckCount(deck) >= DECK_RULES.tournamentMainExact ? "disabled" : ""}>주 덱 추가 ${count}/${maximumLabel}</button>`);
    buttons.push(`<button data-action="deck-add-sideboard" data-card-number="${card.cardNumber}" ${(!unlimited && registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies) || sideboardCount(deck) >= DECK_RULES.sideboardMax ? "disabled" : ""}>${locale() === LOCALES.KO ? "사이드보드 추가" : "Add to Sideboard"} ${sideCountValue}/${maximumLabel}</button>`);
  }
  return buttons.join("") || `<button disabled>추가할 수 없음</button>`;
}

function deckValidityPanel(validation) {
  return `
    <div class="deck-validity ${validation.playable ? "playable" : ""}">
      <strong>${validation.playable ? "이 덱으로 플레이할 수 있습니다." : "이 덱으로는 아직 플레이할 수 없습니다."}</strong>
      ${validation.messages.length ? `<ul>${validation.messages.map((message) => `<li>${escapeHtml(localizedDynamicText(message))}</li>`).join("")}</ul>` : ""}
      <p>저장은 항상 가능하지만, 장수 조건을 만족하지 못하면 게임 시작 덱으로 사용할 수 없습니다.</p>
    </div>
  `;
}

function deckCompositionPanel(deck) {
  const legend = cardByNumber(deck.legend);
  const battlefields = deck.battlefields.map(cardByNumber).filter(Boolean);
  return `
    <div class="deck-zone-block">
      <div class="deck-zone-title"><strong>${t("legend", locale())}</strong><span>${legend ? "1/1" : "0/1"}</span></div>
      ${legend ? compactDeckRow(legend, 1, "legend") : `<p class="empty">레전드를 선택하세요.</p>`}
    </div>
    <div class="deck-zone-block">
      <div class="deck-zone-title"><strong>${t("battlefields", locale())}</strong><span>${battlefields.length}/${DECK_RULES.battlefieldsExact}</span></div>
      ${battlefields.map((card) => compactDeckRow(card, 1, "battlefield")).join("") || `<p class="empty">전장 ${DECK_RULES.battlefieldsExact}장을 선택하세요.</p>`}
    </div>
    <div class="deck-zone-block main-deck-block">
      <div class="deck-zone-title"><strong>${t("mainDeck", locale())}</strong><span>${mainDeckCount(deck)}/${DECK_RULES.tournamentMainExact}</span></div>
      ${deck.main.map(([number, count]) => compactDeckRow(cardByNumber(number), count, "main")).join("") || `<p class="empty">주 덱 카드를 추가하세요.</p>`}
    </div>
    <div class="deck-zone-block sideboard-deck-block">
      <div class="deck-zone-title"><strong>${locale() === LOCALES.KO ? "사이드보드" : "Sideboard"}</strong><span>${sideboardCount(deck)}/${DECK_RULES.sideboardMax}</span></div>
      ${deck.sideboard.map(([number, count]) => compactDeckRow(cardByNumber(number), count, "sideboard")).join("") || `<p class="empty">${locale() === LOCALES.KO ? `사이드 카드를 최대 ${DECK_RULES.sideboardMax}장 추가할 수 있습니다.` : `Add up to ${DECK_RULES.sideboardMax} sideboard cards.`}</p>`}
    </div>
    <div class="deck-zone-block rune-deck-block">
      <div class="deck-zone-title"><strong>${t("runeDeck", locale())}</strong><span>${runeDeckCount(deck)}/${DECK_RULES.runeExact}</span></div>
      <p class="deck-note">룬 덱은 주 덱 뒤에 표시되지만, 주 덱 장수와는 별도로 계산됩니다.</p>
      <div class="selected-rune-list">
        ${deck.runes.map(([runeKey, count]) => runeDeckRow(deck, runeKey, count)).join("") || `<p class="empty">${locale() === LOCALES.KO ? "아래에서 룬 카드를 선택하세요." : "Choose Rune cards below."}</p>`}
      </div>
      ${runeCardPicker(deck)}
    </div>
  `;
}

function compactDeckRow(card, count, zone) {
  if (!card) return "";
  const removeAction = zone === "main" ? "deck-remove-main" : zone === "sideboard" ? "deck-remove-sideboard" : zone === "battlefield" ? "deck-remove-battlefield" : "";
  return `
    <div class="deck-row" data-card-number="${card.cardNumber}">
      ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" />` : ""}
      <button class="deck-row-main" data-action="deck-card-focus" data-card-number="${card.cardNumber}">
        <strong>${cardName(card)}</strong>
        <span>${cardType(card)}${card.energy !== undefined ? ` / ${card.energy} ${t("energy", locale())}` : ""}</span>
      </button>
      <em>x${count}</em>
      ${removeAction ? `<button class="small-icon" data-action="${removeAction}" data-card-number="${card.cardNumber}">-</button>` : ""}
    </div>
  `;
}

function runeDeckRow(deck, runeKey, count) {
  const card = cardByNumber(runeKey) || makeRune(runeKey);
  const domain = card.domains?.[0] || card.domain;
  return `
    <div class="rune-deck-row">
      ${card.image ? `<img class="rune-row-art" src="${card.image}" alt="${cardName(card)}" loading="lazy" />` : `<span class="rune-swatch" style="--rune:${RUNE_COLORS[domain]}"></span>`}
      <button class="deck-row-main" data-action="deck-card-focus" data-card-number="${card.cardNumber}">
        <strong>${cardName(card)}</strong>
        <span>${domainText(domain)} · ${card.rarity ? localizedRarity(card.rarity) : card.cardNumber}</span>
      </button>
      <em>x${count}</em>
      <button class="small-icon" data-action="deck-rune-remove" data-card-number="${card.cardNumber}" ${count <= 0 ? "disabled" : ""}>-</button>
      <button class="small-icon" data-action="deck-rune-add" data-card-number="${card.cardNumber}" ${runeDeckCount(deck) >= DECK_RULES.runeExact ? "disabled" : ""}>+</button>
    </div>
  `;
}

function runeCardPicker(deck) {
  const legend = cardByNumber(deck.legend);
  const domains = (legend?.domains || []).filter((domain) => domain !== DOMAINS.ANY);
  const variants = domains.flatMap((domain) => runeCardsForDomain(domain));
  if (!variants.length) return `<p class="empty">${locale() === LOCALES.KO ? "먼저 레전드를 선택하세요." : "Choose a Legend first."}</p>`;
  return `
    <div class="rune-variant-picker" aria-label="${locale() === LOCALES.KO ? "룬 카드 선택" : "Rune card selection"}">
      ${variants.map((card) => {
        const count = cardCount(deck.runes, card.cardNumber);
        return `
          <article class="rune-variant ${count ? "selected" : ""}">
            <button class="rune-variant-preview" data-action="deck-card-focus" data-card-number="${card.cardNumber}" title="${cardName(card)}">
              <img src="${card.image}" alt="${cardName(card)}" loading="lazy" />
              ${count ? `<em>x${count}</em>` : ""}
            </button>
            <button class="small-icon" data-action="deck-rune-add" data-card-number="${card.cardNumber}" ${runeDeckCount(deck) >= DECK_RULES.runeExact ? "disabled" : ""}>+</button>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function cardSearchPanel(deck) {
  const results = filteredDeckCards();
  return `
    <div class="card-search-head">
      <input data-action="deck-search" placeholder="카드 검색..." value="${escapeHtml(deckEditor.search)}" />
      <span class="card-search-count">${locale() === LOCALES.KO ? `${results.length}장` : `${results.length} cards`}</span>
    </div>
    <div class="card-advanced-search">
      <label>카드풀<select data-action="deck-pool-filter">${CARD_POOL_FORMATS.map((pool) => `<option value="${pool.id}" ${pool.id === deckEditor.poolId ? "selected" : ""}>${escapeHtml(localizedPackName(pool.name))}</option>`).join("")}</select></label>
      <label>출시 카드팩<select data-action="deck-pack-filter"><option value="all">전체 카드팩</option>${CARD_PACKS.map((pack) => `<option value="${pack.id}" ${pack.id === deckEditor.packId ? "selected" : ""}>${escapeHtml(localizedPackName(pack.name))}</option>`).join("")}</select></label>
      <label>종류<select data-action="deck-type-filter">${[["all", "전체"], ["legend", "레전드"], ["unit", "유닛"], ["spell", "주문"], ["gear", "도구"], ["battlefield", "전장"], ["rune", locale() === LOCALES.KO ? "룬" : "Rune"]].map(([value, label]) => `<option value="${value}" ${value === deckEditor.type ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>도메인<select data-action="deck-domain-filter"><option value="all">전체</option>${Object.values(DOMAINS).filter((domain) => domain !== DOMAINS.ANY).map((domain) => `<option value="${domain}" ${domain === deckEditor.domain ? "selected" : ""}>${domainText(domain)}</option>`).join("")}</select></label>
      <label>최대 에너지<select data-action="deck-energy-filter"><option value="all">제한 없음</option>${Array.from({ length: 9 }, (_, energy) => `<option value="${energy}" ${String(energy) === deckEditor.maxEnergy ? "selected" : ""}>${energy}</option>`).join("")}</select></label>
    </div>
    <div class="deck-card-library">
      ${results.map((card) => libraryCard(card, deck)).join("")}
    </div>
  `;
}

function deckAiRecommendationPanel() {
  const recommendation = deckEditor.aiRecommendation;
  if (!recommendation) return "";
  const pool = CARD_POOL_FORMATS.find((candidate) => candidate.id === recommendation.poolId);
  if (!recommendation.compatible) {
    return `<div class="deck-ai-recommendation invalid"><strong>${escapeHtml(localizedPackName(pool?.name || recommendation.poolId))} 추천 불가</strong><p>${escapeHtml(localizedDynamicText(recommendation.reason, { fallback: "현재 카드풀에서는 추천 덱을 만들 수 없습니다." }))}</p></div>`;
  }
  const confidence = recommendation.confidence === "high" ? "높음" : recommendation.confidence === "medium" ? "보통" : "낮음";
  const changes = recommendation.changes || [];
  const sideboard = recommendation.sideboard || [];
  return `
    <div class="deck-ai-recommendation">
      <div class="deck-zone-title"><strong>${escapeHtml(localizedPackName(pool?.name || recommendation.poolId))} AI 추천</strong><span>세대 ${recommendation.generation} · 표본 ${recommendation.sampleGames} · 신뢰도 ${confidence}</span></div>
      ${recommendation.generation > 0 ? "" : `<p class="deck-note">아직 학습 체크포인트가 없어 기본 휴리스틱의 준비용 추천입니다.</p>`}
      ${changes.length ? `<ul>${changes.map((change) => `<li>${escapeHtml(localizedDynamicText(change.remove.name))} → ${escapeHtml(localizedDynamicText(change.add.name))}</li>`).join("")}</ul><button data-action="deck-ai-apply">추천 교체 적용</button>` : `<p>현재 학습 지식으로 확실한 주 덱 교체안을 찾지 못했습니다.</p>`}
      ${sideboard.length ? `<details><summary>매치업 사이드보드 제안 ${sideboard.length}개</summary><ul>${sideboard.map((change) => `<li>${escapeHtml(localizedDynamicText(change.outName || "-"))} → ${escapeHtml(localizedDynamicText(change.inName || "-"))}</li>`).join("")}</ul></details>` : ""}
    </div>
  `;
}

function libraryCard(card, deck) {
  const mainCount = cardCount(deck.main, card.cardNumber);
  const runeCardCount = card.type === "rune" ? cardCount(deck.runes, card.cardNumber) : 0;
  const displayedCount = card.type === "rune" ? runeCardCount : mainCount;
  const disabled = ["unit", "spell", "gear"].includes(card.type)
    && !cardAllowsUnlimitedCopies(card) && mainCount >= DECK_RULES.maxCopies;
  return `
    <button class="library-card ${deckEditor.selectedCardNumber === card.cardNumber ? "selected" : ""}" data-action="deck-card-focus" data-card-number="${card.cardNumber}">
      ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" loading="lazy" />` : `<span class="deck-card-back"></span>`}
      <strong>${cardName(card)}</strong>
      <span>${cardType(card)}${card.energy !== undefined ? ` / ${card.energy}` : ""}</span>
      ${displayedCount ? `<em>x${displayedCount}</em>` : ""}
      ${disabled ? `<small>${t("max", locale())}</small>` : ""}
    </button>
  `;
}

function loadDeckStore(storageKey = accountDeckStorageKey()) {
  const fallback = defaultDeckStore();
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!parsed || !Array.isArray(parsed.decks)) return fallback;
    const fallbackById = new Map(fallback.decks.map((deck) => [deck.id, deck]));
    const personalDecks = [];
    const migratedActiveIds = new Map();
    for (const value of parsed.decks) {
      const deck = normalizeDeckRecord(value);
      const currentDefault = fallbackById.get(deck.id);
      if (!currentDefault) {
        personalDecks.push(deck);
        continue;
      }
      const changedDefault = deck.source === currentDefault.source
        && (deck.name !== currentDefault.name || !sameDeckConfiguration(deck, currentDefault));
      if (!changedDefault) continue;
      const migrated = normalizeDeckRecord({
        ...deck,
        id: newDeckId(),
        name: personalDeckName(deck.name),
        isDefault: false
      });
      personalDecks.push(migrated);
      migratedActiveIds.set(deck.id, migrated.id);
    }
    const personalById = new Map(personalDecks.map((deck) => [deck.id, deck]));
    const decks = [...fallback.decks, ...personalById.values()];
    const proposedActiveIds = Array.isArray(parsed.activeDeckIds) && parsed.activeDeckIds.length >= 2
      ? parsed.activeDeckIds.slice(0, 2).map((id) => migratedActiveIds.get(id) || id)
      : fallback.activeDeckIds;
    const availableIds = new Set(decks.map((deck) => deck.id));
    const activeDeckIds = proposedActiveIds.map((id, index) => availableIds.has(id) ? id : fallback.activeDeckIds[index]);
    return { decks, activeDeckIds };
  } catch {
    return fallback;
  }
}

function defaultDeckStore() {
  const orderedEntries = [
    ["keenanXiong", rawDecklists.keenanXiong],
    ["drowsy", rawDecklists.drowsy],
    ...Object.entries(rawDecklists).filter(([key]) => !["keenanXiong", "drowsy"].includes(key))
  ];
  const decks = orderedEntries.map(([key, rawDeck]) => deckRecordFromRaw(
    `default-${rawDeck.id || key}`,
    rawDeck.playerName || key,
    rawDeck
  ));
  return { decks, activeDeckIds: [decks[0].id, decks[1].id] };
}

function deckRecordFromRaw(id, name, rawDeck) {
  return normalizeDeckRecord({
    id,
    name,
    source: rawDeck.source || "",
    legend: rawDeck.legend || "",
    battlefields: [...(rawDeck.battlefields || [])],
    main: (rawDeck.main || []).map(([cardNumber, count]) => [cardNumber, count]),
    sideboard: (rawDeck.sideboard || []).map(([cardNumber, count]) => [cardNumber, count]),
    runes: (rawDeck.runes || []).map(([domain, count]) => [domain, count]),
    isDefault: id.startsWith("default-"),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

function normalizeDeckRecord(deck) {
  return {
    id: deck.id || `deck-${Date.now()}`,
    name: deck.name || "새 덱",
    source: deck.source || "",
    legend: deck.legend || "",
    battlefields: Array.isArray(deck.battlefields) ? [...deck.battlefields] : [],
    main: normalizeCountEntries(deck.main),
    sideboard: normalizeCountEntries(deck.sideboard),
    runes: normalizeRuneEntries(deck.runes),
    isDefault: Boolean(deck.isDefault || String(deck.id || "").startsWith("default-")),
    createdAt: deck.createdAt || Date.now(),
    updatedAt: deck.updatedAt || Date.now()
  };
}

function normalizeCountEntries(entries) {
  return normalizeDeckCountEntries(entries);
}

function normalizeRuneEntries(entries) {
  const normalized = (Array.isArray(entries) ? entries : []).map(([key, count]) => {
    const registered = cardByNumber(key);
    if (registered?.type === "rune") return [registered.cardNumber, count];
    if (Object.values(DOMAINS).includes(key) && key !== DOMAINS.ANY) return [makeRune(key).cardNumber, count];
    return [key, count];
  });
  return normalizeCountEntries(normalized);
}

function saveDeckStore(options = {}) {
  localStorage.setItem(accountDeckStorageKey(), JSON.stringify(deckStore));
  if (options.sync !== false) scheduleAccountDeckSync();
}

function loadAuthState() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    const token = String(stored?.token || "");
    const user = stored?.user?.id && stored?.user?.accountId
      ? { id: String(stored.user.id), accountId: String(stored.user.accountId), createdAt: Number(stored.user.createdAt) || 0 }
      : null;
    return createAuthState({
      token,
      user,
      status: token && user ? "checking" : "signed-out"
    });
  } catch {
    return createAuthState();
  }
}

function createAuthState(overrides = {}) {
  return {
    token: "",
    user: null,
    status: "signed-out",
    mode: "login",
    accountId: "",
    password: "",
    passwordConfirm: "",
    error: "",
    notice: "",
    syncStatus: "idle",
    panelOpen: !window.matchMedia?.("(max-width: 760px)").matches,
    ...overrides
  };
}

function saveAuthState() {
  if (!auth.token || !auth.user) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    token: auth.token,
    user: auth.user
  }));
}

function accountDeckStorageKey(userId = auth?.user?.id) {
  return userId ? `${DECK_STORAGE_KEY}.account.${userId}` : DECK_STORAGE_KEY;
}

async function restoreAccountSession() {
  if (!auth.token || !auth.user) return;
  auth.status = "checking";
  try {
    configureOnlineServer(await defaultMultiplayerServer());
    const result = await fetchAccountSession(auth.token);
    completeAuthentication(result, {
      notice: locale() === LOCALES.KO ? `${result.user.accountId} 계정의 덱을 불러왔습니다.` : `Loaded decks for ${result.user.accountId}.`
    });
  } catch (error) {
    clearAuthenticatedState();
    auth.error = accountErrorText(error);
  }
  render();
}

async function submitAuthentication() {
  if (auth.status === "working") return;
  auth.error = "";
  auth.notice = "";
  const accountId = auth.accountId.trim();
  if (accountId.length < 3) {
    auth.error = locale() === LOCALES.KO ? "아이디를 3자 이상 입력해 주세요." : "Enter an account ID with at least 3 characters.";
    render();
    return;
  }
  if (auth.password.length < 8) {
    auth.error = locale() === LOCALES.KO ? "비밀번호를 8자 이상 입력해 주세요." : "Enter a password with at least 8 characters.";
    render();
    return;
  }
  if (auth.mode === "signup" && auth.password !== auth.passwordConfirm) {
    auth.error = locale() === LOCALES.KO ? "비밀번호 확인이 일치하지 않습니다." : "The password confirmation does not match.";
    render();
    return;
  }

  const guestDeckStore = auth.mode === "signup" ? accountDeckStorePayload() : null;
  auth.status = "working";
  render();
  try {
    configureOnlineServer(await defaultMultiplayerServer());
    const result = auth.mode === "signup"
      ? await signUpAccount(accountId, auth.password)
      : await loginAccount(accountId, auth.password);
    completeAuthentication(result, {
      additionalDeckStore: guestDeckStore,
      notice: auth.mode === "signup"
        ? (locale() === LOCALES.KO ? "회원가입이 완료되었습니다. 내 덱이 이 계정에 저장됩니다." : "Your account is ready. Your decks will be saved to it.")
        : (locale() === LOCALES.KO ? "로그인했습니다. 계정에 저장된 덱을 불러왔습니다." : "Signed in and loaded your saved decks.")
    });
    if (auth.mode === "signup") await flushAccountDeckSync();
  } catch (error) {
    auth.status = "signed-out";
    auth.error = accountErrorText(error);
  } finally {
    auth.password = "";
    auth.passwordConfirm = "";
    render();
  }
}

function completeAuthentication(result, options = {}) {
  const serverStore = result.deckStore || { decks: [], activeDeckIds: [] };
  const additional = options.additionalDeckStore || { decks: [], activeDeckIds: [] };
  const personalById = new Map();
  for (const deck of [...(serverStore.decks || []), ...(additional.decks || [])]) {
    const normalized = normalizeDeckRecord({ ...deck, isDefault: false });
    if (!normalized.id.startsWith("default-")) personalById.set(normalized.id, normalized);
  }
  auth.token = result.token || auth.token;
  auth.user = result.user;
  auth.status = "signed-in";
  auth.error = "";
  auth.notice = options.notice || "";
  auth.syncStatus = "idle";
  auth.accountId = result.user.accountId;
  saveAuthState();
  applyAccountDeckStore({
    decks: [...personalById.values()],
    activeDeckIds: additional.activeDeckIds?.length ? additional.activeDeckIds : serverStore.activeDeckIds
  });
}

function applyAccountDeckStore(value) {
  const defaults = defaultDeckStore();
  const personal = (Array.isArray(value?.decks) ? value.decks : [])
    .map((deck) => normalizeDeckRecord({ ...deck, isDefault: false }))
    .filter((deck) => !deck.id.startsWith("default-"));
  const decks = [...defaults.decks, ...new Map(personal.map((deck) => [deck.id, deck])).values()];
  const available = new Set(decks.map((deck) => deck.id));
  const proposed = Array.isArray(value?.activeDeckIds) ? value.activeDeckIds.slice(0, 2) : [];
  const activeDeckIds = [0, 1].map((index) => available.has(proposed[index]) ? proposed[index] : defaults.activeDeckIds[index]);
  deckStore = { decks, activeDeckIds };
  deckEditor.selectedDeckId = activeDeckIds[0] || decks[0]?.id;
  deckEditor.selectedCardNumber = deckHeroCard(getSelectedDeckRecord())?.cardNumber || null;
  saveDeckStore({ sync: false });
}

async function signOutAccount() {
  if (!auth.user || auth.status === "working") return;
  const token = auth.token;
  auth.status = "working";
  render();
  await flushAccountDeckSync();
  try {
    await logoutAccount(token);
  } catch {
    // Local sign-out still completes if the server is temporarily unavailable.
  }
  clearAuthenticatedState();
  auth.notice = locale() === LOCALES.KO ? "로그아웃했습니다." : "Signed out.";
  render();
}

function clearAuthenticatedState() {
  if (deckSyncTimer) clearTimeout(deckSyncTimer);
  deckSyncTimer = null;
  auth = createAuthState({ notice: auth.notice || "" });
  saveAuthState();
  deckStore = loadDeckStore(DECK_STORAGE_KEY);
  deckEditor.selectedDeckId = deckStore.activeDeckIds[0] || deckStore.decks[0]?.id;
  deckEditor.selectedCardNumber = deckHeroCard(getSelectedDeckRecord())?.cardNumber || null;
}

function accountDeckStorePayload() {
  return {
    decks: deckStore.decks
      .filter((deck) => !deck.isDefault && !deck.id.startsWith("default-"))
      .map((deck) => structuredClone({ ...deck, isDefault: false })),
    activeDeckIds: deckStore.activeDeckIds.slice(0, 2)
  };
}

function scheduleAccountDeckSync() {
  if (!auth.token || !auth.user) return;
  auth.syncStatus = "saving";
  if (deckSyncTimer) clearTimeout(deckSyncTimer);
  deckSyncTimer = setTimeout(() => {
    deckSyncTimer = null;
    void enqueueAccountDeckSync();
  }, 450);
}

function flushAccountDeckSync() {
  if (deckSyncTimer) clearTimeout(deckSyncTimer);
  deckSyncTimer = null;
  return enqueueAccountDeckSync();
}

function enqueueAccountDeckSync() {
  if (!auth.token || !auth.user) return Promise.resolve(true);
  const token = auth.token;
  const payload = accountDeckStorePayload();
  auth.syncStatus = "saving";
  deckSyncQueue = deckSyncQueue
    .catch(() => false)
    .then(async () => {
      try {
        await saveAccountDeckStore(token, payload);
        if (auth.token === token) {
          auth.syncStatus = "saved";
          auth.error = "";
        }
        return true;
      } catch (error) {
        if (auth.token === token) {
          auth.syncStatus = "error";
          auth.error = locale() === LOCALES.KO
            ? `덱을 서버에 저장하지 못했습니다: ${accountErrorText(error)}`
            : `Could not save decks to the server: ${accountErrorText(error)}`;
        }
        return false;
      } finally {
        if (appView === "menu") render();
      }
    });
  return deckSyncQueue;
}

function accountErrorText(error) {
  const korean = locale() === LOCALES.KO;
  const byCode = {
    account_exists: korean ? "이미 사용 중인 아이디입니다." : "That account ID is already in use.",
    invalid_credentials: korean ? "아이디 또는 비밀번호가 올바르지 않습니다." : "The account ID or password is incorrect.",
    invalid_account_id: korean ? "아이디는 문자·숫자·점·밑줄·하이픈으로 3~24자여야 합니다." : "Use 3–24 letters, numbers, dots, underscores, or hyphens.",
    invalid_password: korean ? "비밀번호는 8~128자여야 합니다." : "Passwords must be 8–128 characters.",
    invalid_session: korean ? "로그인이 만료되었습니다. 다시 로그인해 주세요." : "Your sign-in expired. Please sign in again.",
    expired_session: korean ? "로그인이 만료되었습니다. 다시 로그인해 주세요." : "Your sign-in expired. Please sign in again."
  };
  return byCode[error?.code]
    || (korean ? localizeKoreanNetworkError(error?.message || "서버에 연결하지 못했습니다.") : (error?.message || "Could not connect to the server."));
}

function loadOnlineSeat() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ONLINE_STORAGE_KEY) || "null");
    return {
      mode: parsed?.mode || "offline",
      roomId: parsed?.roomId || "",
      playerId: parsed?.playerId || "",
      playerToken: parsed?.playerToken || ""
    };
  } catch {
    return { mode: "offline", roomId: "", playerId: "", playerToken: "" };
  }
}

function saveOnlineSeat() {
  localStorage.setItem(ONLINE_STORAGE_KEY, JSON.stringify({
    mode: online.mode,
    roomId: online.roomId,
    playerId: online.playerId,
    playerToken: online.playerToken
  }));
}

function clearOnlineSeat() {
  closeOnlineEvents();
  onlineSelectedCardId = null;
  online.mode = "offline";
  online.roomId = "";
  online.playerId = "";
  online.playerToken = "";
  online.room = null;
  online.match = null;
  online.error = "";
  localStorage.removeItem(ONLINE_STORAGE_KEY);
}

function ensureRoomRefresh() {
  if (online.refreshTimer) return;
  refreshRooms();
  online.refreshTimer = setInterval(() => {
    if (appView === "multiplayer") refreshRooms(false);
    else stopRoomRefresh();
  }, 3000);
}

function stopRoomRefresh() {
  if (!online.refreshTimer) return;
  clearInterval(online.refreshTimer);
  online.refreshTimer = null;
}

async function refreshRooms(showLoading = true) {
  if (online.loading) return;
  online.loading = showLoading;
  try {
    const result = await fetchRooms();
    online.rooms = result.rooms || [];
    online.lastRefresh = Date.now();
    online.error = "";
  } catch (error) {
    online.error = error.message;
  } finally {
    online.loading = false;
    if (appView === "multiplayer") render();
  }
}

async function connectDefaultMultiplayer() {
  if (online.loading) return;
  online.loading = true;
  online.error = "";
  configureOnlineServer(await defaultMultiplayerServer());
  render();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetchRooms({ signal: controller.signal });
    online.rooms = result.rooms || [];
    online.lastRefresh = Date.now();
    appView = "multiplayer";
    ensureRoomRefresh();
  } catch (error) {
    configureOnlineServer("");
    online.error = error?.name === "AbortError"
      ? (locale() === LOCALES.KO ? "멀티플레이 서버 연결 시간이 초과되었습니다." : "Multiplayer server connection timed out.")
      : (locale() === LOCALES.KO ? `멀티플레이 서버에 연결하지 못했습니다: ${error.message}` : `Could not connect to the multiplayer server: ${error.message}`);
    appView = "menu";
  } finally {
    clearTimeout(timeout);
    online.loading = false;
    render();
  }
}

async function defaultMultiplayerServer() {
  if (!LOCAL_SERVER_HOSTNAMES.has(window.location.hostname)) return "";
  try {
    const response = await fetch("/build-info.json", { cache: "no-store" });
    if (!response.ok) return "";
    const build = await response.json();
    return configuredMultiplayerServer(build);
  } catch {
    return "";
  }
}

function closeOnlineEvents() {
  if (!online.events) return;
  online.events.close();
  online.events = null;
}

function resetStaleOnlineSeat(message) {
  closeOnlineEvents();
  onlineSelectedCardId = null;
  online.mode = "offline";
  online.roomId = "";
  online.playerId = "";
  online.playerToken = "";
  online.room = null;
  online.error = message;
  localStorage.removeItem(ONLINE_STORAGE_KEY);
  appView = "multiplayer";
  refreshRooms(false);
}

function connectOnlineEvents() {
  if (!online.roomId || !online.playerToken) return;
  closeOnlineEvents();
  online.events = openRoomEvents(online.roomId, online.playerToken, {
    open() {
      online.error = "";
      if (appView === "multiplayer" || appView === "game") render();
    },
    snapshot(snapshot) {
      const selectedBeforeSnapshot = onlineSelectedCardId || game?.selectedCardId || null;
      online.room = snapshot.room;
      online.match = snapshot.match || null;
      online.playerId = snapshot.playerId;
      online.mode = "online";
      saveOnlineSeat();
      if (snapshot.game) {
        game = snapshot.game;
        restoreOnlineSelection(selectedBeforeSnapshot);
        appView = "game";
      }
      online.error = "";
      render();
    },
    error(message) {
      if (isStaleRoomError(message)) {
        resetStaleOnlineSeat(`${message} 새 방에 다시 참가해 주세요.`);
        render();
        return;
      }
      online.error = message;
      if (appView === "multiplayer" || appView === "game") render();
    }
  });
}

function restoreOnlineSelection(preferredCardId) {
  if (preferredCardId && isVisibleSelectableCard(preferredCardId)) {
    game.selectedCardId = preferredCardId;
    onlineSelectedCardId = preferredCardId;
    return;
  }
  const viewer = viewerPlayer();
  const fallbackId = viewer?.champion?.instanceId || viewer?.legend?.instanceId || null;
  if (fallbackId && isVisibleSelectableCard(fallbackId)) {
    game.selectedCardId = fallbackId;
    onlineSelectedCardId = fallbackId;
  } else {
    onlineSelectedCardId = game.selectedCardId || null;
  }
}

function setUiSelectedCard(cardId) {
  actionRejection = null;
  const before = game.selectedCardId;
  selectCard(game, cardId);
  if (game.selectedCardId !== before || game.selectedCardId === cardId) {
    if (isOnlineGame()) onlineSelectedCardId = game.selectedCardId;
    inspectorOpen = true;
  }
}

function isStaleRoomError(message) {
  return /room not found|seat token is invalid/i.test(message || "");
}

function getSelectedDeckRecord() {
  return deckStore.decks.find((deck) => deck.id === deckEditor.selectedDeckId) || deckStore.decks[0] || null;
}

function activeDeckRecords() {
  return deckStore.activeDeckIds.map((id) => deckStore.decks.find((deck) => deck.id === id)).filter(Boolean);
}

function createNewDeckRecord() {
  const id = newDeckId();
  return normalizeDeckRecord({
    id,
    name: "새 덱",
    legend: "",
    battlefields: [],
    main: [],
    runes: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

function openDeckImportDialog() {
  deckEditor.transferNotice = null;
  deckEditor.transferDialog = { mode: "import", text: "", error: "", notice: "" };
}

function openDeckExportDialog(deck) {
  if (!deck) return;
  try {
    deckEditor.transferNotice = null;
    deckEditor.transferDialog = {
      mode: "export",
      text: formatDeckText(deck, { cardByNumber, championMatchesLegend }),
      error: "",
      notice: ""
    };
  } catch (error) {
    deckEditor.transferNotice = {
      tone: "error",
      message: locale() === LOCALES.KO
        ? `덱 텍스트를 만들지 못했습니다: ${error?.message || error}`
        : `Could not create deck text: ${error?.message || error}`
    };
  }
}

function importDeckTextValue(text) {
  try {
    const imported = deckRecordFromText(text, {
      cards: ALL_CARDS,
      cardNames: (card) => [translateCardName(card, LOCALES.KO)],
      cardAllowed: (card) => cardAllowedInPool(card, deckEditor.poolId),
      championMatchesLegend
    });
    const record = normalizeDeckRecord({
      ...imported,
      id: newDeckId(),
      name: importedDeckName(imported),
      source: "Pasted deck text",
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    deckStore.decks.push(record);
    deckEditor.selectedDeckId = record.id;
    deckEditor.selectedCardNumber = deckHeroCard(record)?.cardNumber || null;
    deckEditor.mobileView = "edit";
    deckEditor.mobileTab = "deck";
    deckEditor.transferDialog = null;
    deckEditor.transferNotice = {
      tone: "success",
      message: locale() === LOCALES.KO
        ? "붙여넣은 텍스트로 새 덱을 만들었습니다."
        : "Created a new deck from the pasted text."
    };
    saveDeckStore();
  } catch (error) {
    const details = Array.isArray(error?.issues) ? error.issues.join(" · ") : String(error?.message || error);
    if (deckEditor.transferDialog?.mode === "import") {
      deckEditor.transferDialog.error = locale() === LOCALES.KO
        ? `덱을 가져오지 못했습니다: ${details}`
        : `Could not import the deck: ${details}`;
      deckEditor.transferDialog.notice = "";
    }
  }
}

function importedDeckName(imported) {
  const legend = cardByNumber(imported?.legend);
  const baseName = legend ? cardName(legend) : (locale() === LOCALES.KO ? "가져온" : "Imported");
  return `${baseName} ${locale() === LOCALES.KO ? "덱" : "Deck"}`.slice(0, 48);
}

async function copyDeckTransferText() {
  const dialog = deckEditor.transferDialog;
  if (dialog?.mode !== "export") return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(dialog.text);
    dialog.error = "";
    dialog.notice = locale() === LOCALES.KO ? "전체 덱 텍스트를 복사했습니다." : "Copied all deck text.";
  } catch (error) {
    const textarea = app.querySelector('textarea[data-action="deck-transfer-text"]');
    textarea?.focus();
    textarea?.select();
    const copied = Boolean(textarea && document.execCommand?.("copy"));
    dialog.notice = copied
      ? (locale() === LOCALES.KO ? "전체 덱 텍스트를 복사했습니다." : "Copied all deck text.")
      : "";
    dialog.error = copied
      ? ""
      : (locale() === LOCALES.KO ? "자동 복사가 차단되었습니다. 텍스트 필드에서 직접 복사해 주세요." : "Automatic copying was blocked. Copy directly from the text field.");
  }
  render();
}

function newDeckId() {
  if (globalThis.crypto?.randomUUID) return `deck-${globalThis.crypto.randomUUID()}`;
  return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function personalDeckName(name) {
  const localized = localizedDeckName(name || (locale() === LOCALES.KO ? "새 덱" : "New Deck"));
  const suffix = locale() === LOCALES.KO ? " (내 덱)" : " (My Deck)";
  return localized.endsWith(suffix) ? localized : `${localized}${suffix}`.slice(0, 48);
}

function ensureSelectedDeckIsPersonal() {
  const selected = getSelectedDeckRecord();
  if (!selected?.isDefault) return selected;
  const copy = normalizeDeckRecord({
    ...structuredClone(selected),
    id: newDeckId(),
    name: personalDeckName(selected.name),
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  deckStore.decks.push(copy);
  deckStore.activeDeckIds = deckStore.activeDeckIds.map((id) => id === selected.id ? copy.id : id);
  deckEditor.selectedDeckId = copy.id;
  return copy;
}

function deletePersonalDeck(deckId) {
  const index = deckStore.decks.findIndex((deck) => deck.id === deckId);
  const deck = deckStore.decks[index];
  if (!deck || deck.isDefault || deck.id.startsWith("default-")) {
    deckEditor.pendingDeleteDeckId = null;
    return false;
  }

  deckStore.decks.splice(index, 1);
  const defaults = defaultDeckStore();
  const availableIds = new Set(deckStore.decks.map((candidate) => candidate.id));
  deckStore.activeDeckIds = deckStore.activeDeckIds.map((activeId, slotIndex) => {
    if (activeId !== deck.id && availableIds.has(activeId)) return activeId;
    const defaultId = defaults.activeDeckIds[slotIndex];
    if (availableIds.has(defaultId)) return defaultId;
    return deckStore.decks.find((candidate) => validateDeckRecord(candidate).playable)?.id || deckStore.decks[0]?.id || "";
  });

  const nextDeck = deckStore.decks[Math.min(index, deckStore.decks.length - 1)] || deckStore.decks[0] || null;
  deckEditor.selectedDeckId = nextDeck?.id || null;
  deckEditor.selectedCardNumber = deckHeroCard(nextDeck)?.cardNumber || null;
  deckEditor.aiRecommendation = null;
  deckEditor.transferNotice = null;
  deckEditor.pendingDeleteDeckId = null;
  saveDeckStore();
  void flushAccountDeckSync();
  return true;
}

function selectedDeckLibraryCard() {
  return cardByNumber(deckEditor.selectedCardNumber) || deckHeroCard(getSelectedDeckRecord());
}

function filteredDeckCards() {
  const query = deckEditor.search.trim().toLowerCase();
  return ALL_CARDS.filter((card) => {
    if (!cardAllowedInPool(card, deckEditor.poolId)) return false;
    if (deckEditor.packId !== "all" && packForCard(card)?.id !== deckEditor.packId) return false;
    if (deckEditor.type !== "all" && card.type !== deckEditor.type) return false;
    if (deckEditor.domain !== "all" && !(card.domains || []).includes(deckEditor.domain)) return false;
    if (deckEditor.maxEnergy !== "all" && Number(card.energy ?? 0) > Number(deckEditor.maxEnergy)) return false;
    return !query || cardSearchText(card, locale()).toLowerCase().includes(query);
  });
}

function cardByNumber(cardNumber) {
  return CARD_BY_NUMBER.get(cardNumber) || null;
}

function deckHeroCard(deck) {
  if (!deck) return null;
  return cardByNumber(deck.legend) || cardByNumber(deck.main[0]?.[0]) || cardByNumber(deck.battlefields[0]);
}

function validateDeckRecord(deck) {
  return validateDeckRecordByRule(deck, cardByNumber);
}

function isChampionDeckCard(card) {
  return isChampionDeckCardByRule(card);
}

function mainDeckCount(deck) {
  return deckMainDeckCount(deck);
}

function sideboardCount(deck) {
  return deckSideboardCount(deck);
}

function registeredNameCount(deck, name) {
  return [...(deck?.main || []), ...(deck?.sideboard || [])].reduce((total, [number, count]) => (
    total + (cardByNumber(number)?.name === name ? count : 0)
  ), 0);
}

function cardAllowsUnlimitedCopies(card) {
  return Boolean(card?.effects?.some((effect) => effect?.timing === "static" && effect.kind === "unlimitedDeckCopies"));
}

function runeDeckCount(deck) {
  return deckRuneDeckCount(deck);
}

function runeCount(deck, domain) {
  return deckRuneCount(deck, domain, cardByNumber);
}

function cardCount(entries, cardNumber) {
  return deckCardCount(entries, cardNumber);
}

function mutateSelectedDeck(mutator) {
  const deck = ensureSelectedDeckIsPersonal();
  if (!deck) return;
  mutator(deck);
  deck.updatedAt = Date.now();
  saveDeckStore();
}

function setCountEntry(entries, key, count) {
  const index = entries.findIndex(([candidate]) => candidate === key);
  if (count <= 0) {
    if (index >= 0) entries.splice(index, 1);
    return;
  }
  if (index >= 0) entries[index][1] = count;
  else entries.push([key, count]);
}

function addMainDeckCard(deck, cardNumber) {
  const card = cardByNumber(cardNumber);
  if (!card || !["unit", "spell", "gear"].includes(card.type)) return;
  const count = cardCount(deck.main, cardNumber);
  if (mainDeckCount(deck) >= DECK_RULES.tournamentMainExact
    || (!cardAllowsUnlimitedCopies(card) && registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies)) return;
  setCountEntry(deck.main, cardNumber, count + 1);
}

function removeMainDeckCard(deck, cardNumber) {
  setCountEntry(deck.main, cardNumber, cardCount(deck.main, cardNumber) - 1);
}

function addSideboardCard(deck, cardNumber) {
  const card = cardByNumber(cardNumber);
  if (!card || !["unit", "spell", "gear"].includes(card.type)) return;
  if (sideboardCount(deck) >= DECK_RULES.sideboardMax
    || (!cardAllowsUnlimitedCopies(card) && registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies)) return;
  setCountEntry(deck.sideboard, cardNumber, cardCount(deck.sideboard, cardNumber) + 1);
}

function removeSideboardCard(deck, cardNumber) {
  setCountEntry(deck.sideboard, cardNumber, cardCount(deck.sideboard, cardNumber) - 1);
}

function addBattlefieldCard(deck, cardNumber) {
  const card = cardByNumber(cardNumber);
  if (card?.type !== "battlefield") return;
  if (deck.battlefields.includes(cardNumber)) return;
  if (deck.battlefields.length >= DECK_RULES.battlefieldsExact) return;
  deck.battlefields.push(cardNumber);
}

function removeBattlefieldCard(deck, cardNumber) {
  const index = deck.battlefields.indexOf(cardNumber);
  if (index >= 0) deck.battlefields.splice(index, 1);
}

function addRuneCard(deck, cardNumber) {
  const card = cardByNumber(cardNumber);
  if (card?.type !== "rune" || runeDeckCount(deck) >= DECK_RULES.runeExact || !runeMatchesLegend(deck, card)) return;
  setCountEntry(deck.runes, card.cardNumber, cardCount(deck.runes, card.cardNumber) + 1);
}

function removeRuneCard(deck, cardNumber) {
  const card = cardByNumber(cardNumber);
  if (card?.type !== "rune") return;
  setCountEntry(deck.runes, card.cardNumber, cardCount(deck.runes, card.cardNumber) - 1);
}

function runeMatchesLegend(deck, runeCard) {
  const legend = cardByNumber(deck?.legend);
  const domain = runeCard?.domains?.[0];
  return Boolean(domain && legend?.domains?.includes(domain));
}

function resolveDeckRecord(deck) {
  return {
    id: deck.id,
    playerName: deck.name,
    source: deck.source || "",
    legend: cardByNumber(deck.legend),
    battlefields: deck.battlefields.map(cardByNumber).filter(Boolean),
    main: deck.main.flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number))).filter(Boolean),
    sideboard: deck.sideboard.flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number))).filter(Boolean),
    runes: deck.runes.flatMap(([runeKey, count]) => Array.from({ length: count }, () => makeRune(runeKey)))
  };
}

function resetGameUiState() {
  logOpen = false;
  handOpen = false;
  chainZoneCollapsed = false;
  inspectedChainItemId = null;
  inspectedChainTargetIds.clear();
  graveyardOpenPlayerId = null;
  banishedOpenPlayerId = null;
  intelOpenPlayerId = null;
  fullCardOpen = false;
  fullCardPreviewCard = null;
  attachmentsOpenCardId = null;
  inspectorOpen = false;
  pendingGameExit = null;
  lastViewerPlayerId = null;
  lastInteractionPhase = null;
  paymentRunesScrollLeft = 0;
  handScrollLeft = 0;
  previousUiSnapshot = null;
  clearEffectAnimations();
  resetPresentationState(presentationState);
  activeImpact = null;
  resultRevealReady = true;
  resultDismissed = false;
  if (impactDismissTimer) clearTimeout(impactDismissTimer);
  impactDismissTimer = null;
  clearRealtimeFeedback();
  actionRejection = null;
  moveSelection.clear();
}

function matchIsBetweenGames() {
  const match = isOnlineGame() ? online.match : localMatch;
  return Boolean(match && ["sideboarding", "between-games", "ready-next-game"].includes(match.phase));
}

function recordLocalGameIfComplete() {
  if (!localMatch || localMatch.phase !== "playing" || game.phase !== "complete") return;
  const battlefields = Object.fromEntries(game.players.map((player) => {
    const selected = game.battlefields.find((field) => field.ownerId === player.id || field.instanceId === player.selectedBattlefieldId);
    return [player.id, selected?.cardNumber || selected?.collectorNumber || null];
  }));
  const result = recordMatchGame(localMatch, {
    winnerId: game.winnerId || null,
    firstPlayerId: game.firstPlayerId,
    battlefields
  });
  if (!result.ok || result.complete) return;
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardPlayerId = "p1";
  sideboardSelectedMain = null;
  sideboardFirstPlayerId = localMatch.nextFirstPlayerId || null;
  resultDismissed = true;
}

function activeBetweenGamesMatch() {
  return isOnlineGame() ? online.match : localMatch;
}

function sideboardingView() {
  const match = activeBetweenGamesMatch();
  const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
  const playerIndex = playerId === "p2" ? 1 : 0;
  const draft = isOnlineGame() ? online.match?.currentDeck : sideboardDrafts[playerIndex];
  const submitted = Boolean(match?.submissions?.[playerId]);
  const locked = match?.phase === "between-games" || match?.lastGameWasDraw;
  const chooser = match?.firstPlayerChooserId === playerId;
  const wins = match?.wins || { p1: 0, p2: 0 };
  if (!draft) return `<main class="shell-screen sideboarding-screen"><p class="empty">${locale() === LOCALES.KO ? "사이드보드 정보를 기다리고 있습니다." : "Waiting for sideboard data."}</p></main>`;
  return `
    <main class="shell-screen sideboarding-screen">
      <section class="sideboarding-shell">
        <header class="sideboarding-head">
          <div>
            <p class="eyebrow visible">${locale() === LOCALES.KO ? `게임 ${match.gameNumber} 종료` : `Game ${match.gameNumber} complete`}</p>
            <h1>${locked ? (locale() === LOCALES.KO ? "무승부 후 다음 게임 준비" : "Prepare after a draw") : (locale() === LOCALES.KO ? "사이드보딩" : "Sideboarding")}</h1>
            <p>${locked ? (locale() === LOCALES.KO ? "무승부였으므로 카드를 교체할 수 없고 직전 전장을 그대로 사용합니다." : "Cards cannot be exchanged after a draw, and both previous Battlefields are locked.") : (locale() === LOCALES.KO ? "주 덱 카드와 사이드 카드를 같은 수만큼 교환해 주세요." : "Exchange the same number of Main Deck and Sideboard cards.")}</p>
          </div>
          <div class="match-score"><strong>${locale() === LOCALES.KO ? "플레이어 1" : "P1"} ${wins.p1}</strong><span>:</span><strong>${wins.p2} ${locale() === LOCALES.KO ? "플레이어 2" : "P2"}</strong></div>
        </header>
        <div class="sideboarding-player-banner">${isOnlineGame() ? (locale() === LOCALES.KO ? "내 사이드보드" : "Your sideboard") : `${playerId.toUpperCase()} · ${locale() === LOCALES.KO ? "다른 플레이어는 화면을 보지 마세요" : "Other player, please look away"}`}</div>
        <div class="sideboarding-grid">
          <section class="sideboarding-column">
            <div class="deck-zone-title"><strong>${t("mainDeck", locale())}</strong><span>${mainDeckCount(draft)}/${DECK_RULES.tournamentMainExact}</span></div>
            <p class="deck-note">${sideboardSelectedMain ? (locale() === LOCALES.KO ? "이제 넣을 사이드 카드를 선택하세요." : "Now choose a Sideboard card to bring in.") : (locale() === LOCALES.KO ? "뺄 카드를 먼저 선택하세요." : "Choose a card to take out first.")}</p>
            <div class="sideboarding-card-list">${draft.main.map(([number, count]) => sideboardCardRow(number, count, "main", locked || submitted)).join("")}</div>
          </section>
          <section class="sideboarding-column">
            <div class="deck-zone-title"><strong>${locale() === LOCALES.KO ? "사이드보드" : "Sideboard"}</strong><span>${sideboardCount(draft)}/${DECK_RULES.sideboardMax}</span></div>
            <p class="deck-note">${locale() === LOCALES.KO ? "교체된 주 덱 카드는 새 사이드보드가 됩니다." : "Cards removed from the Main Deck become the new Sideboard."}</p>
            <div class="sideboarding-card-list">${draft.sideboard.map(([number, count]) => sideboardCardRow(number, count, "sideboard", locked || submitted)).join("") || `<p class="empty">${locale() === LOCALES.KO ? "등록된 사이드 카드가 없습니다." : "No registered Sideboard cards."}</p>`}</div>
          </section>
        </div>
        ${chooser ? `<fieldset class="first-player-choice" ${submitted ? "disabled" : ""}><legend>${locale() === LOCALES.KO ? "이전 게임 패자: 다음 게임의 선공 플레이어를 선택하세요." : "Previous game loser: choose who plays first."}</legend><label><input type="radio" name="next-first" value="p1" data-action="sideboard-first-player" ${sideboardFirstPlayerId === "p1" ? "checked" : ""}/> ${locale() === LOCALES.KO ? "플레이어 1" : "P1"}</label><label><input type="radio" name="next-first" value="p2" data-action="sideboard-first-player" ${sideboardFirstPlayerId === "p2" ? "checked" : ""}/> ${locale() === LOCALES.KO ? "플레이어 2" : "P2"}</label></fieldset>` : ""}
        <div class="sideboarding-actions">
          ${sideboardSelectedMain ? `<button class="secondary" data-action="sideboard-cancel-selection">${locale() === LOCALES.KO ? "선택 취소" : "Cancel selection"}</button>` : ""}
          <button class="primary" data-action="sideboard-submit" ${submitted || (chooser && !sideboardFirstPlayerId) ? "disabled" : ""}>${submitted ? (locale() === LOCALES.KO ? "상대 준비 대기 중" : "Waiting for opponent") : (locale() === LOCALES.KO ? "구성 확정" : "Confirm configuration")}</button>
        </div>
      </section>
    </main>
  `;
}

function sideboardCardRow(number, count, zone, disabled) {
  const card = cardByNumber(number);
  if (!card) return "";
  const selected = zone === "main" && sideboardSelectedMain === number;
  const action = zone === "main" ? "sideboard-select-main" : "sideboard-swap-in";
  return `<button class="sideboarding-card ${selected ? "selected" : ""}" data-action="${action}" data-card-number="${number}" ${disabled || (zone === "sideboard" && !sideboardSelectedMain) ? "disabled" : ""}>${card.image ? `<img src="${card.image}" alt="${cardName(card)}" />` : ""}<span><strong>${cardName(card)}</strong><small>${cardType(card)}</small></span><em>x${count}</em></button>`;
}

function swapSideboardCard(draft, mainNumber, sideNumber) {
  if (!draft || cardCount(draft.main, mainNumber) < 1 || cardCount(draft.sideboard, sideNumber) < 1) return;
  setCountEntry(draft.main, mainNumber, cardCount(draft.main, mainNumber) - 1);
  setCountEntry(draft.sideboard, mainNumber, cardCount(draft.sideboard, mainNumber) + 1);
  setCountEntry(draft.sideboard, sideNumber, cardCount(draft.sideboard, sideNumber) - 1);
  setCountEntry(draft.main, sideNumber, cardCount(draft.main, sideNumber) + 1);
}

async function submitSideboardDraft() {
  const match = activeBetweenGamesMatch();
  const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
  const index = playerId === "p2" ? 1 : 0;
  const draft = isOnlineGame() ? online.match.currentDeck : sideboardDrafts[index];
  const firstPlayerId = match.firstPlayerChooserId === playerId ? sideboardFirstPlayerId : null;
  if (isOnlineGame()) {
    dispatchGameCommand({ kind: "submitSideboard", deckRecord: draft, firstPlayerId });
    return;
  }
  const result = submitSideboardConfiguration(localMatch, playerId, draft, cardByNumber, firstPlayerId);
  if (!result.ok) { recentFeedback = { tone: "error", message: result.message }; return; }
  if (aiMode && playerId === "p1") {
    const aiFirst = localMatch.firstPlayerChooserId === "p2" ? "p2" : null;
    submitSideboardConfiguration(localMatch, "p2", sideboardDrafts[1], cardByNumber, aiFirst);
  } else if (!localMatch.submissions.p2) {
    sideboardPlayerId = "p2";
    sideboardSelectedMain = null;
    sideboardFirstPlayerId = localMatch.nextFirstPlayerId || null;
  }
  if (localMatch.phase === "ready-next-game") startNextLocalMatchGame();
}

function startNextLocalMatchGame() {
  const next = beginNextMatchGame(localMatch);
  if (!next.ok) return;
  game = createGame({
    interactive: true,
    randomFirstPlayer: !next.firstPlayerId,
    firstPlayerId: next.firstPlayerId,
    lockedBattlefields: next.lockedBattlefields,
    unavailableBattlefields: next.unavailableBattlefields,
    format: localMatch.sideboardingEnabled ? "match" : "duel",
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    decks: next.decks.map(resolveDeckRecord)
  });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardSelectedMain = null;
  resetGameUiState();
}

function startGameFromMenu() {
  clearOnlineSeat();
  aiMode = false;
  aiReplay = null;
  const pair = activeDeckRecords();
  if (pair.length !== 2 || pair.some((deck) => !validateDeckRecord(deck).playable)) return;
  localMatch = createMatchState({ decks: pair, sideboardingEnabled: settings.sideboardingEnabled });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  game = createGame({
    interactive: true,
    randomFirstPlayer: true,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    format: settings.sideboardingEnabled ? "match" : "duel",
    decks: pair.map(resolveDeckRecord)
  });
  resetGameUiState();
  appView = "game";
}

function startTutorial(tutorialId = TUTORIAL_IDS.firstVictory) {
  clearOnlineSeat();
  aiMode = false;
  aiReplay = null;
  localMatch = null;
  game = createTutorialGame(tutorialId);
  resetGameUiState();
  appView = "game";
}

function exitTutorial() {
  game.tutorial.active = false;
  appView = "tutorials";
  resetGameUiState();
}

async function startAiGameFromMenu() {
  clearOnlineSeat();
  const pair = activeDeckRecords();
  if (pair.length !== 2 || pair.some((deck) => !validateDeckRecord(deck).playable)) return;
  const generation = selectedAiGenerationDescriptor();
  if (!trainingDeckIdForGeneration(pair[1], generation)) return;
  if (!await ensureNeuralAiLoaded()) return;
  const currentPair = activeDeckRecords();
  if (currentPair.length !== 2 || !trainingDeckIdForGeneration(currentPair[1], generation)) return;
  localMatch = createMatchState({ decks: currentPair, sideboardingEnabled: settings.sideboardingEnabled });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  game = createGame({
    interactive: true,
    randomFirstPlayer: true,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    format: settings.sideboardingEnabled ? "match" : "duel",
    decks: currentPair.map(resolveDeckRecord)
  });
  aiMode = true;
  neuralAiSession?.reset();
  aiHumanPlayerId = game.players[0].id;
  aiPlayerId = game.players[1].id;
  aiReplay = createAiReplay(game, {
    humanPlayerId: aiHumanPlayerId,
    aiPlayerId,
    model: activeCoachModel(),
    deckIds: currentPair.map((deck) => deck.id)
  });
  resetGameUiState();
  appView = "game";
  render();
}

async function onlineCreateRoom() {
  try {
    online.loading = true;
    online.error = "";
    const result = await createOnlineRoom({ sideboardingEnabled: settings.sideboardingEnabled });
    applyOnlineSeatResult(result);
    connectOnlineEvents();
    await refreshRooms(false);
  } catch (error) {
    online.error = error.message;
  } finally {
    online.loading = false;
    render();
  }
}

async function onlineJoinRoom(roomId) {
  if (!roomId) return;
  try {
    online.loading = true;
    online.error = "";
    const result = await joinOnlineRoom(roomId, online.roomId === roomId ? online.playerToken : "");
    applyOnlineSeatResult(result);
    connectOnlineEvents();
    await refreshRooms(false);
  } catch (error) {
    online.error = error.message;
  } finally {
    online.loading = false;
    render();
  }
}

async function onlineSubmitDeck() {
  const deck = activeDeckRecords()[0];
  if (!deck || !online.roomId || !online.playerToken) return;
  try {
    online.loading = true;
    online.error = "";
    const result = await submitOnlineDeck(online.roomId, online.playerToken, deck);
    online.room = result.room;
  } catch (error) {
    online.error = error.message;
  } finally {
    online.loading = false;
    render();
  }
}

async function onlineReady() {
  if (!online.roomId || !online.playerToken) return;
  try {
    online.loading = true;
    online.error = "";
    const result = await setOnlineReady(online.roomId, online.playerToken, true);
    online.room = result.room;
  } catch (error) {
    online.error = error.message;
  } finally {
    online.loading = false;
    render();
  }
}

async function onlineLeaveRoom() {
  const roomId = online.roomId;
  const playerToken = online.playerToken;
  try {
    if (roomId && playerToken) await leaveOnlineRoom(roomId, playerToken);
  } catch (error) {
    online.error = error.message;
  } finally {
    clearOnlineSeat();
    appView = "multiplayer";
    refreshRooms();
    render();
  }
}

function applyOnlineSeatResult(result) {
  online.mode = "online";
  online.room = result.room;
  online.roomId = result.room?.roomId || online.roomId;
  online.playerId = result.playerId || online.playerId;
  online.playerToken = result.playerToken || online.playerToken;
  saveOnlineSeat();
}

function dispatchGameCommand(command, applyLocal) {
  if (online.commandPending) return;
  clearRealtimeFeedback();
  actionRejection = null;
  if (!isOnlineGame()) {
    const resolvedCommand = resolveCurrentGameCommand(command);
    if (!resolvedCommand) {
      actionRejection = localizedCommandFailure("That action is not legal in the current game state.");
      render();
      return;
    }
    const before = aiReplay ? cloneGame(game) : null;
    const actorId = aiActiveActorId(game);
    const result = applyLocal?.(resolvedCommand);
    if (result?.ok === false) actionRejection = localizedCommandFailure(result.message);
    advanceTutorialAfterCommand(game, resolvedCommand, result);
    if (game.tutorial?.completed && !tutorialRecord.completedIds.includes(game.tutorial.id)) {
      const completedAt = new Date().toISOString();
      tutorialRecord = {
        completedIds: [...tutorialRecord.completedIds, game.tutorial.id],
        completedAtById: { ...tutorialRecord.completedAtById, [game.tutorial.id]: completedAt }
      };
      saveTutorialRecord();
    }
    recordLocalGameIfComplete();
    if (aiReplay && result?.ok) queueReplayAnalysis(before, actorId, resolvedCommand, result);
    return;
  }
  if (!['surrender', 'restartGame', 'submitSideboard'].includes(command.kind) && !viewerCanAct()) {
    online.error = "상대의 턴 또는 Focus입니다.";
    render();
    return;
  }
  // Online snapshots are intentionally redacted and JSON-only. They are not
  // authoritative enough to replay a command through the full rules engine;
  // doing so can both disagree with hidden server state and execute transitions
  // on serialized data. Send the explicit UI command and let the server's
  // shared legal-action gate validate and canonicalize it.
  const resolvedCommand = command;
  online.commandPending = { kind: command.kind, startedAt: Date.now() };
  render();
  sendOnlineCommand(online.roomId, online.playerToken, resolvedCommand)
    .then(() => {
      online.error = "";
      actionRejection = null;
    })
    .catch((error) => {
      online.error = error.message;
      actionRejection = localizedCommandFailure(error.message);
    })
    .finally(() => {
      online.commandPending = null;
      render();
    });
}

function resolveCurrentGameCommand(command) {
  if (["surrender", "restartGame", "submitSideboard"].includes(command?.kind)) return command;
  const actorId = aiActiveActorId(game);
  if (!actorId) return null;
  return resolveLegalAction(game, command, actorId);
}

function queueReplayAnalysis(before, actorId, command, result) {
  window.setTimeout(() => {
    try {
      recordReplayDecision(aiReplay, before, actorId, command, result, activeCoachModel());
      if (game.phase === "complete" && !aiReplay.report) completeAiReplay();
    } catch (error) {
      reportUiException(error, "AI replay analysis");
    }
  }, 0);
}

function completeAiReplay() {
  if (!aiReplay || aiReplay.report) return;
  finalizeAiReplay(aiReplay, game, activeCoachModel());
  persistAiReplay(persistableAiReplay(aiReplay)).catch((error) => {
    reportUiException(error, "AI replay persistence");
  });
}

function scheduleAiTurn() {
  if (!aiMode || appView !== "game" || aiThinking || aiTurnTimer || game.phase === "complete") return;
  if (aiActiveActorId(game) !== aiPlayerId) return;
  aiTurnTimer = window.setTimeout(() => {
    aiTurnTimer = null;
    aiThinking = true;
    try {
      if (game.pendingPayment) {
        const payment = resolvePlannedPayment(game, {
          model: aiModel,
          ...(neuralAiModel && neuralValueEstimator ? {
            learnedCandidateLimit: 3,
            valueEstimator: (state, actorId) => neuralValueEstimator(neuralAiModel, state, actorId)
          } : {})
        });
        if (!payment?.ok) throw new Error(payment?.message || "AI가 비용 결제를 완료하지 못했습니다.");
        return;
      }
      const before = cloneGame(game);
      const legal = enumerateAiPolicyActions(game, aiPlayerId);
      const selected = neuralAiSession
        ? neuralAiSession.decide(game, aiPlayerId, legal, { temperature: 0.22 })
        : choosePolicyAction(game, aiPlayerId, legal, aiModel, { temperature: 0.22 });
      if (!selected) throw new Error("AI가 실행 가능한 행동을 찾지 못했습니다.");
      const result = applyAiAction(game, selected.action, aiPlayerId);
      if (!result?.ok) throw new Error(result?.message || "AI 행동이 거절되었습니다.");
      queueReplayAnalysis(before, aiPlayerId, selected.action, result);
    } catch (error) {
      reportUiException(error, "AI turn");
    } finally {
      aiThinking = false;
      render();
    }
  }, EFFECT_ANIMATION_DURATION_MS);
}

function isOnlineGame() {
  return online.mode === "online" && Boolean(online.roomId && online.playerToken);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emptyMotion() {
  return {
    drawn: new Set(),
    entered: new Set(),
    chained: new Set(),
    trashed: new Set(),
    sourceIds: new Set(),
    targetIds: new Set(),
    sourceZones: new Set(),
    feedback: null
  };
}

function emptyEffectAnimationState() {
  return {
    draws: new Map(),
    deaths: new Map(),
    mightChanges: new Map(),
    countered: new Map()
  };
}

function prepareUiMotion() {
  const current = uiSnapshot();
  const previous = previousUiSnapshot;
  previousUiSnapshot = current;
  pruneEffectAnimations();
  if (!previous) return emptyMotion();

  const motion = emptyMotion();
  motion.drawn = diffSet(current.hand, previous.hand);
  motion.entered = diffSet(current.board, previous.board);
  motion.chained = diffSet(current.chain, previous.chain);
  motion.trashed = diffSet(current.trash, previous.trash);
  motion.feedback = buildRealtimeFeedback(current, previous, motion);
  rememberEffectAnimations(detectEffectAnimations(previous, current));

  return motion;
}

function rememberEffectAnimations(events) {
  const expiresAt = Date.now() + EFFECT_ANIMATION_DURATION_MS;
  for (const event of events.draws) effectAnimations.draws.set(event.playerId, { ...event, expiresAt });
  for (const event of events.deaths) effectAnimations.deaths.set(event.id, { ...event, expiresAt });
  for (const event of events.mightChanges) effectAnimations.mightChanges.set(event.unitId, { ...event, expiresAt });
  for (const event of events.countered) effectAnimations.countered.set(event.id, { ...event, expiresAt });
  scheduleEffectAnimationCleanup();
}

function pruneEffectAnimations(now = Date.now()) {
  for (const group of Object.values(effectAnimations)) {
    for (const [id, event] of group) {
      if (event.expiresAt <= now) group.delete(id);
    }
  }
}

function scheduleEffectAnimationCleanup() {
  if (effectAnimationTimer) clearTimeout(effectAnimationTimer);
  const expirations = Object.values(effectAnimations).flatMap((group) => [...group.values()].map((event) => event.expiresAt));
  if (!expirations.length) {
    effectAnimationTimer = null;
    return;
  }
  const delay = Math.max(0, Math.min(...expirations) - Date.now()) + 24;
  effectAnimationTimer = setTimeout(() => {
    effectAnimationTimer = null;
    pruneEffectAnimations();
    scheduleEffectAnimationCleanup();
    if (appView === "game") render();
  }, delay);
}

function clearEffectAnimations() {
  effectAnimations = emptyEffectAnimationState();
  if (effectAnimationTimer) clearTimeout(effectAnimationTimer);
  effectAnimationTimer = null;
}

function uiSnapshot() {
  const chainItems = visibleChainItems().map((item, index) => chainItemSnapshot(item, index));
  const cardZones = cardZoneSnapshot();
  const boardUnits = boardUnitSnapshot();
  const visibleLog = gameLogVisibleToViewer(game, viewerPlayerId());
  return {
    phase: game.phase,
    currentPlayerId: game.currentPlayerId,
    turnNumber: game.turnNumber,
    logHead: visibleLog[0] || "",
    effectStamp: game.effectFlash?.stamp || 0,
    effectMessage: game.effectFlash?.message || "",
    players: new Map(game.players.map((player) => [player.id, {
      deckCount: player.mainDeck.length,
      handIds: new Set(player.hand.map((card) => card.instanceId))
    }])),
    hand: new Set(game.players.flatMap((player) => player.hand.map((card) => card.instanceId))),
    board: new Set(boardUnits.keys()),
    boardUnits,
    trash: new Set(game.players.flatMap((player) => player.trash.map((card) => card.instanceId))),
    chain: new Set(chainCardInstanceIds(game, viewerPlayerId())),
    chainItems,
    chainItemIds: new Set(chainItems.map((item) => item.id)),
    cardZones
  };
}

function boardUnitSnapshot() {
  const units = new Map();
  for (const player of game.players) {
    for (const card of player.base) {
      if (card.type === "unit") units.set(card.instanceId, effectUnitSnapshot(card, "base"));
    }
  }
  for (const field of game.battlefields) {
    for (const card of field.units) {
      if (card.type === "unit") units.set(card.instanceId, effectUnitSnapshot(card, field.instanceId));
    }
  }
  return units;
}

function effectUnitSnapshot(card, location) {
  return {
    id: card.instanceId,
    playerId: card.controllerId || card.ownerId,
    ownerId: card.ownerId,
    name: card.name || "Unit",
    image: card.image || "",
    location,
    might: currentMight(game, card)
  };
}

function visibleChainItems() {
  return (game.actionChain?.chain || game.showdown?.chain || []).filter(chainItemVisibleInTree);
}

function chainItemSnapshot(item, index) {
  const card = item?.card || {};
  const targets = chainItemTargetIds(item);
  return {
    id: item.id || `${card.instanceId || "chain"}-${index}`,
    cardId: card.instanceId,
    playerId: item.playerId,
    name: chainItemTitle(item),
    rawName: card.name || item.trigger?.label || "",
    sourceName: chainItemSourceTitle(item),
    type: item.itemType || "card",
    status: item.status || "pending",
    targetIds: targets
  };
}

function cardZoneSnapshot() {
  const zones = new Map();
  for (const player of game.players) {
    for (const card of player.hand) zones.set(card.instanceId, { playerId: player.id, zone: "hand" });
    for (const card of player.base) zones.set(card.instanceId, { playerId: player.id, zone: "base" });
    for (const card of player.trash) zones.set(card.instanceId, { playerId: player.id, zone: "trash" });
    for (const card of player.banished || []) zones.set(card.instanceId, { playerId: player.id, zone: "banished" });
    if (player.legend) zones.set(player.legend.instanceId, { playerId: player.id, zone: "legend" });
    if (player.champion) zones.set(player.champion.instanceId, { playerId: player.id, zone: "champion" });
    for (const card of player.mainDeck) zones.set(card.instanceId, { playerId: player.id, zone: "mainDeck" });
    for (const card of player.runeDeck) zones.set(card.instanceId, { playerId: player.id, zone: "runeDeck" });
  }
  for (const field of game.battlefields) {
    zones.set(field.instanceId, { playerId: field.controlledBy, zone: "battlefield" });
    for (const card of field.units) zones.set(card.instanceId, { playerId: card.controllerId, zone: "battlefield" });
    for (const item of field.hidden || []) zones.set(item.card.instanceId, { playerId: hiddenCardControllerId(item), zone: "hidden", battlefieldId: field.instanceId });
  }
  return zones;
}

function buildRealtimeFeedback(current, previous, motion) {
  const added = current.chainItems.find((item) => !previous.chainItemIds.has(item.id));
  if (added) {
    const previousZone = previous.cardZones.get(added.cardId);
    if (added.cardId) motion.sourceIds.add(added.cardId);
    for (const targetId of added.targetIds) motion.targetIds.add(targetId);
    if (previousZone) motion.sourceZones.add(`${previousZone.playerId}:${previousZone.zone}`);
    return {
      kind: added.type === "trigger" ? "trigger" : previousZone?.zone === "hidden" ? "hidden" : added.type === "activated" ? "ability" : "card",
      playerId: added.playerId,
      title: chainFeedbackTitle(added, previousZone),
      name: added.name,
      source: added.sourceName,
      sourceZone: previousZone?.zone || "chain",
      targetIds: added.targetIds,
      status: added.status
    };
  }

  const removed = previous.chainItems.find((item) => !current.chainItemIds.has(item.id));
  if (removed && current.logHead !== previous.logHead) {
    for (const targetId of removed.targetIds) motion.targetIds.add(targetId);
    return {
      kind: "resolved",
      playerId: removed.playerId,
      title: current.logHead.includes("counter") ? t("countered", locale()) : current.logHead.includes("cannot") || current.logHead.includes("no longer") ? t("failed", locale()) : t("resolved", locale()),
      name: removed.name,
      source: removed.sourceName,
      targetIds: removed.targetIds,
      result: current.logHead
    };
  }

  if (current.effectStamp !== previous.effectStamp && game.effectFlash) {
    const effect = game.effectFlash;
    const source = findVisibleCard(effect.sourceId);
    for (const targetId of effect.targetIds || []) motion.targetIds.add(targetId);
    return {
      kind: "effect",
      playerId: source?.controllerId,
      title: t("effectResolved", locale()),
      name: source ? cardName(source) : t("effect", locale()),
      targetIds: effect.targetIds || [],
      result: effect.message || ""
    };
  }

  return null;
}

function rememberRealtimeFeedback(feedback) {
  recentFeedback = feedback;
  if (feedbackDismissTimer) clearTimeout(feedbackDismissTimer);
  feedbackDismissTimer = setTimeout(() => {
    feedbackDismissTimer = null;
    recentFeedback = null;
    if (appView === "game") render();
  }, 1800);
}

function clearRealtimeFeedback() {
  recentFeedback = null;
  if (feedbackDismissTimer) clearTimeout(feedbackDismissTimer);
  feedbackDismissTimer = null;
}

function chainFeedbackTitle(item, previousZone) {
  const actor = playerPerspectiveLabel(item.playerId);
  if (item.type === "trigger") return t("actorTriggered", locale(), { actor });
  if (item.type === "activated") return t("actorActivated", locale(), { actor });
  if (previousZone?.zone === "hidden") return t("actorRevealed", locale(), { actor });
  return t("actorPlayed", locale(), { actor });
}

function diffSet(current, previous) {
  return new Set([...current].filter((id) => !previous.has(id)));
}

function headline() {
  if (game.phase === "complete") return t("wins", locale(), { name: winnerName() });
  if (game.phase === "first-player") return t("firstPlayerRoll", locale());
  if (game.phase === "champion-select") {
    const championPlayer = game.players.find((player) => player.id === game.championSelectPlayerId);
    return `${playerName(championPlayer)}: ${t("chooseChampion", locale())}`;
  }
  if (game.phase === "battlefield-select") {
    const setupPlayer = game.players.find((player) => player.id === game.setupPlayerId);
    return `${playerName(setupPlayer)}: ${t("chooseBattlefield", locale())}`;
  }
  if (game.phase === "mulligan") {
    const mulliganPlayer = game.players.find((player) => player.id === game.mulligan?.playerId);
    return `${playerName(mulliganPlayer)}: ${t("mulligan", locale())}`;
  }
  if (game.phase === "showdown") return `${playerName(currentPlayer(game))}: ${t("showdownPriority", locale())}`;
  return t("playerTurn", locale(), { name: playerName(currentPlayer(game)) });
}

function interactionStatus() {
  const actorId = activePlayerId();
  const actor = game.players.find((player) => player.id === actorId) || currentPlayer(game);
  const actorName = actor ? playerName(actor) : t("nobody", locale());
  const mine = !isOnlineGame() || actorId === viewerPlayerId();

  if (game.phase === "complete") {
    return { tone: "complete", label: t("gameEnded", locale()), title: headline(), detail: t("reviewFinalState", locale()) };
  }
  if (online.commandPending) {
    return {
      tone: "processing",
      label: t("sendingCommand", locale()),
      title: t("waitingForServer", locale()),
      detail: t("duplicateInputLocked", locale())
    };
  }
  if (game.pendingPayment) {
    const payment = game.pendingPayment;
    const decisionVisible = pendingDecisionVisibleToViewer({ aiMode, viewerPlayerId: viewerPlayerId(), decision: payment });
    const player = game.players.find((candidate) => candidate.id === payment.playerId);
    const card = paymentDisplayCard(player, payment) || payment.effectPayment?.sourceCard;
    const needed = payment.energyCost ?? card?.energy ?? 0;
    const selected = (payment.energyRuneIds?.length || 0) + (payment.poolEnergyIds?.length || 0);
    return {
      tone: mine ? "attention" : "waiting",
      label: t("paymentInProgress", locale()),
      title: t("playerMustPay", locale(), { name: actorName }),
      detail: !decisionVisible
        ? t("playerIsChoosing", locale(), { name: actorName })
        : needed > 0
        ? t("energyProgressDetail", locale(), { selected, needed, remaining: Math.max(0, needed - selected) })
        : t("finishDialog", locale())
    };
  }
  if (game.pendingChoice) {
    const choice = game.pendingChoice;
    const decisionVisible = pendingDecisionVisibleToViewer({ aiMode, viewerPlayerId: viewerPlayerId(), decision: choice });
    const source = choice.card ? cardName(choice.card) : t("effect", locale());
    return {
      tone: mine ? "attention" : "waiting",
      label: choice.data?.declareTrigger ? t("declaring", locale()) : t("resolving", locale()),
      title: t("playerMustChoose", locale(), { name: actorName }),
      detail: decisionVisible
        ? `${source} · ${localizedChoicePrompt(choice)}`
        : t("playerIsChoosing", locale(), { name: actorName })
    };
  }
  const queuedTriggers = game.triggerQueue?.length || 0;
  if (queuedTriggers) {
    return {
      tone: "processing",
      label: t("processingQueue", locale()),
      title: t("resolvingTriggers", locale()),
      detail: t("queuedEffectsCount", locale(), { n: queuedTriggers })
    };
  }
  const activeChain = game.actionChain || (game.phase === "showdown" ? game.showdown : null);
  if (activeChain) {
    const count = activeChain.chain?.length || 0;
    return {
      tone: mine ? "attention" : "waiting",
      label: game.phase === "showdown" ? t("showdown", locale()) : t("responseWindow", locale()),
      title: mine ? t("yourPriority", locale()) : t("playerHasPriority", locale(), { name: actorName }),
      detail: count ? t("queuedEffectsCount", locale(), { n: count }) : t("passNoResponse", locale())
    };
  }
  if (["first-player", "champion-select", "battlefield-select", "mulligan"].includes(game.phase)) {
    return {
      tone: mine ? "attention" : "waiting",
      label: turnLabel(),
      title: headline(),
      detail: mine ? t("yourDecision", locale()) : t("playerIsChoosing", locale(), { name: actorName })
    };
  }
  return {
    tone: mine ? "active" : "waiting",
    label: t("actionPhase", locale()),
    title: mine ? t("yourAction", locale()) : t("playerTurn", locale(), { name: actorName }),
    detail: mine ? t("selectCardHint", locale()) : t("waitingForOpponent", locale())
  };
}

function turnLabel() {
  if (game.phase === "first-player") return t("roll", locale());
  if (game.phase === "champion-select") return t("champion", locale());
  if (game.phase === "battlefield-select") return t("setup", locale());
  if (game.phase === "mulligan") return t("mulligan", locale());
  if (game.phase === "showdown") return t("showdown", locale());
  return t("turn", locale(), { n: game.turnNumber });
}

function firstPlayerPanel() {
  const decision = game.firstPlayerDecision;
  if (decision?.method === "roll") return firstPlayerRollPanel(decision);
  const first = game.players.find((player) => player.id === game.firstPlayerId);
  const second = game.players.find((player) => player.id !== game.firstPlayerId);
  return `
    <section class="first-player-screen">
      <article class="first-player-card">
        <div class="section-head">
          <div>
            <h2>${t("firstPlayer", locale())}</h2>
            <span>${t("decidedBeforeSetup", locale())}</span>
          </div>
        </div>
        <div class="first-player-result">
          <div class="first-seat first">
            ${imageCard(first.legend, "select-only")}
            <strong>${t("first", locale())}</strong>
            <span>${playerName(first)}</span>
          </div>
          <div class="versus">${locale() === LOCALES.KO ? "대" : "VS"}</div>
          <div class="first-seat second">
            ${imageCard(second.legend, "select-only")}
            <strong>${t("second", locale())}</strong>
            <span>${playerName(second)}</span>
          </div>
        </div>
        <button class="primary confirm-first-player" data-action="confirm-first-player" ${viewerCanAct() ? "" : "disabled"}>${t("confirm", locale())}</button>
      </article>
    </section>
  `;
}

function firstPlayerRollPanel(decision) {
  const chooser = game.players.find((player) => player.id === decision.chooserId);
  const isChoosing = decision.status === "choosing";
  if (isChoosing && !setupSelectionVisibleToViewer(chooser?.id)) {
    return privateFirstPlayerWaitingPanel(chooser);
  }
  const canUseDecisionControl = viewerCanAct();
  const notice = isChoosing
    ? (canUseDecisionControl
      ? t("rollWinnerChooses", locale(), { name: playerName(chooser) })
      : t("waitingForOrderChoice", locale(), { name: playerName(chooser) }))
    : (decision.previousRolls && Object.values(decision.rolls || {}).every((value) => value == null)
      ? t("tiedRollAgain", locale())
      : t("rollToChooseOrder", locale()));
  return `
    <section class="first-player-screen">
      <article class="first-player-card dice-order-card">
        <div class="section-head">
          <div>
            <h2>${t("firstPlayerRoll", locale())}</h2>
            <span>${t("rollRound", locale(), { n: decision.round })}</span>
          </div>
        </div>
        <p class="dice-order-notice">${notice}</p>
        <div class="first-player-result dice-results">
          ${game.players.map((player, index) => firstPlayerDieSeat(player, decision, index)).join(`<div class="versus">${locale() === LOCALES.KO ? "대" : "VS"}</div>`)}
        </div>
        ${isChoosing ? `
          <div class="play-order-actions">
            <button class="primary" data-action="choose-first-player" data-player="${chooser.id}" ${canUseDecisionControl ? "" : "disabled"}>${t("chooseFirst", locale())}</button>
            <button class="secondary" data-action="choose-first-player" data-player="${game.players.find((player) => player.id !== chooser.id)?.id || chooser.id}" ${canUseDecisionControl ? "" : "disabled"}>${t("chooseSecond", locale())}</button>
          </div>
        ` : `
          <button class="primary roll-first-player" data-action="roll-first-player" ${canUseDecisionControl ? "" : "disabled"}>${t("rollDie", locale())}</button>
        `}
      </article>
    </section>
  `;
}

function privateFirstPlayerWaitingPanel(player) {
  const name = player ? playerName(player) : t("opponentSide", locale());
  return `
    <section class="first-player-screen">
      <article class="first-player-card dice-order-card private-setup-waiting">
        <div class="setup-hidden-choice">
          <strong>${t("waiting", locale())}</strong>
          <span>${t("playerIsChoosing", locale(), { name })}</span>
        </div>
      </article>
    </section>
  `;
}

function firstPlayerDieSeat(player, decision, index) {
  const value = decision.rolls?.[player.id];
  const showPreviousTie = Object.values(decision.rolls || {}).every((roll) => roll == null);
  const tiedValue = value == null && showPreviousTie ? decision.previousRolls?.[player.id] : null;
  const displayValue = value ?? tiedValue;
  const active = decision.status === "rolling" && decision.rollerId === player.id;
  const winner = decision.winnerId === player.id;
  return `
    <div class="first-seat dice-seat ${active ? "active" : ""} ${winner ? "roll-winner" : ""}" data-player-index="${index}">
      ${imageCard(player.legend, "select-only")}
      <span class="die-face ${displayValue == null ? "pending" : ""}" aria-label="${displayValue == null ? t("waitingForRoll", locale()) : t("rolledNumber", locale(), { n: displayValue })}">${displayValue ?? "?"}</span>
      <strong>${displayValue == null ? t("waitingForRoll", locale()) : t("rolledNumber", locale(), { n: displayValue })}</strong>
      <span>${playerName(player)}</span>
    </div>
  `;
}

function winnerName() {
  return game.players.find((player) => player.id === game.winnerId)?.name || t("nobody", locale());
}

function updateGamePresentation() {
  const snapshot = snapshotPresentationGame(game, (card) => currentMight(game, card), viewerPlayerId());
  const update = advancePresentation(presentationState, snapshot, viewerPlayerId());
  if (update.impact) rememberCinematicImpact(update.impact);
  return update;
}

function rememberCinematicImpact(impact) {
  activeImpact = impact;
  if (impactDismissTimer) clearTimeout(impactDismissTimer);
  const finalImpact = impact.kind === "victory" || impact.kind === "defeat";
  if (finalImpact) {
    resultRevealReady = false;
    resultDismissed = false;
  }
  impactDismissTimer = setTimeout(() => {
    impactDismissTimer = null;
    activeImpact = null;
    if (finalImpact) resultRevealReady = true;
    if (appView === "game") render();
  }, finalImpact ? 2200 : 1150);
}

function cinematicImpactOverlay() {
  if (!activeImpact) return "";
  const korean = locale() === LOCALES.KO;
  return `
    <section class="cinematic-impact impact-${activeImpact.kind}" aria-live="assertive">
      <div class="impact-vignette"></div>
      <div class="impact-streaks"></div>
      <div class="impact-copy">
        <span>${escapeHtml(korean ? localizedDynamicText(activeImpact.kicker) : activeImpact.kickerEn)}</span>
        <strong>${escapeHtml(korean ? localizedDynamicText(activeImpact.titleKo) : activeImpact.titleEn)}</strong>
        ${(korean ? activeImpact.detailKo : activeImpact.detailEn) ? `<small>${escapeHtml(korean ? localizedDynamicText(activeImpact.detailKo) : activeImpact.detailEn)}</small>` : ""}
      </div>
    </section>
  `;
}

function gameResultModal() {
  if (replayMode || game.phase !== "complete" || !resultRevealReady || resultDismissed) return "";
  const won = game.winnerId === viewerPlayerId();
  const winner = game.players.find((player) => player.id === game.winnerId);
  const loser = game.players.find((player) => player.id !== game.winnerId);
  const highlights = rankPresentationHighlights(presentationState.highlights);
  const korean = locale() === LOCALES.KO;
  return `
    <section class="result-modal match-result-modal modal-panel ${won ? "result-victory" : "result-defeat"}" role="dialog" aria-modal="true" aria-labelledby="match-result-title">
      <div class="result-crown" aria-hidden="true"><span></span></div>
      <div class="result-modal-copy">
        <span>${game.surrenderedPlayerId ? (korean ? "항복으로 종료" : "Ended by surrender") : t("gameEnded", locale())}</span>
        <h2 id="match-result-title">${t(won ? "victory" : "defeat", locale())}</h2>
        <p>${korean ? `${winner ? playerName(winner) : winnerName()}님이 전장을 지배했습니다.` : `${winner?.name || winnerName()} controlled the battlefield.`}</p>
      </div>
      <div class="result-scoreline">
        <strong>${winner?.score || 0}</strong>
        <span>${winner ? playerName(winner) : ""}<b>${locale() === LOCALES.KO ? "최종" : "FINAL"}</b>${loser ? playerName(loser) : ""}</span>
        <strong>${loser?.score || 0}</strong>
      </div>
      <section class="match-highlights" aria-label="${korean ? "결정적 플레이" : "Decisive plays"}">
        <div class="match-highlights-head">
          <span>${korean ? "승부를 가른 장면" : "Plays that decided the match"}</span>
          <small>${korean ? `총 ${game.turnNumber || 1}라운드` : `${game.turnNumber || 1} rounds`}</small>
        </div>
        ${highlights.length ? highlights.map((highlight, index) => resultHighlightCard(highlight, index)).join("") : `
          <article class="result-highlight fallback-highlight">
            <b>01</b>
            <div><strong>${korean ? "끝까지 유지한 전장 압박" : "Sustained battlefield pressure"}</strong><p>${korean ? "마지막 득점까지 이어진 운영이 승부를 만들었습니다." : "Consistent control carried the match to its final score."}</p></div>
          </article>
        `}
      </section>
      <div class="result-actions">
        <button type="button" class="secondary" data-action="review-result">${korean ? "전장 돌아보기" : "Review battlefield"}</button>
        ${isOnlineGame()
          ? `<button type="button" class="primary" data-action="confirm-online-result">${korean ? "로비로 돌아가기" : "Return to lobby"}</button>`
          : `<button type="button" class="primary" data-action="new-game">${t("newGame", locale())}</button>`}
      </div>
    </section>
  `;
}

function resultHighlightCard(highlight, index) {
  const korean = locale() === LOCALES.KO;
  const actor = game.players.find((player) => player.id === highlight.playerId);
  return `
    <article class="result-highlight highlight-${highlight.kind}">
      <b>${String(index + 1).padStart(2, "0")}</b>
      <div>
        <span>${korean ? `${highlight.turn}라운드` : `Round ${highlight.turn}`} ${actor ? `· ${escapeHtml(korean ? playerName(actor) : actor.name)}` : ""}</span>
        <strong>${escapeHtml(korean ? localizedDynamicText(highlight.titleKo) : highlight.titleEn)}</strong>
        <p>${escapeHtml(korean ? localizedDynamicText(highlight.detailKo) : highlight.detailEn)}</p>
      </div>
    </article>
  `;
}

function gameExitConfirmModal() {
  const restarting = pendingGameExit === "new-game";
  return `
    <section class="result-modal game-exit-modal modal-panel" role="dialog" aria-modal="true" aria-labelledby="game-exit-title">
      <div class="result-modal-copy">
        <span>${restarting ? t("newGame", locale()) : t("surrender", locale())}</span>
        <h2 id="game-exit-title">${t(restarting ? "restartConfirmTitle" : "surrenderConfirmTitle", locale())}</h2>
        <p>${t(restarting ? "restartConfirmDetail" : "surrenderConfirmDetail", locale())}</p>
      </div>
      <div class="actions game-exit-actions">
        <button type="button" data-action="cancel-game-exit">${t("continueGame", locale())}</button>
        <button type="button" class="danger" data-action="confirm-game-exit">${restarting ? t("newGame", locale()) : t("surrender", locale())}</button>
      </div>
    </section>
  `;
}

function scoreTrack() {
  const left = isOnlineGame() ? viewerPlayer() : game.players[0];
  const right = isOnlineGame() ? opponentPlayer() : game.players[1];
  const labels = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1];
  return `
    <section class="score-track" aria-label="${locale() === LOCALES.KO ? "점수" : "Score"}">
      <span class="score-name">${playerName(left)}</span>
      <div class="score-rail">
        ${labels.map((label, index) => {
          const leftActive = left.score > 0 && left.score === index + 1;
          const rightActive = right.score > 0 && right.score === labels.length - index;
          const winCell = index === 7;
          return `
            <span class="score-cell ${winCell ? "win-cell" : ""} ${leftActive ? "p1-score" : ""} ${rightActive ? "p2-score" : ""}">
              ${label}
            </span>
          `;
        }).join("")}
      </div>
      <span class="score-name right">${playerName(right)}</span>
    </section>
  `;
}

function gamePanel(player) {
  syncInspectedChainTargets();
  const selected = uiSelectedCard();
  const bottomPlayer = viewerPlayer();
  const topPlayer = opponentPlayer();
  const showPendingPayment = pendingDecisionVisibleToViewer({
    aiMode,
    viewerPlayerId: viewerPlayerId(),
    decision: game.pendingPayment
  });
  const showPendingChoice = pendingDecisionVisibleToViewer({
    aiMode,
    viewerPlayerId: viewerPlayerId(),
    decision: game.pendingChoice
  });
  return `
    <div class="play-area ${actingPlayerClass()} ${isOnlineGame() && !viewerCanAct() ? "waiting-for-opponent" : ""} ${online.commandPending ? "command-pending" : ""}" aria-busy="${online.commandPending ? "true" : "false"}">
      <section class="board-panel" aria-label="${t("gameBoard", locale())}">
        <div class="board-band opponent-band">
          <span>${t("opponentSide", locale())}</span>
          ${playerSide(topPlayer, "top")}
        </div>
        ${chainZonePanel()}
        ${realtimeFeedbackOverlay()}
        <div class="location-band" data-scroll-key="battlefield-scroll">
          <span>${t("battlefield", locale())}</span>
          <section class="battlefield-mat ${game.battlefields.length > 2 ? "has-extra-battlefields" : ""}" aria-label="${t("battlefields", locale())}">
            ${battlefieldColumns()}
          </section>
        </div>
        <div class="board-band player-band">
          <span>${t("playerSide", locale())}</span>
          ${playerSide(bottomPlayer, "bottom")}
        </div>
      </section>
      ${moveBatchBar(player)}
      ${actionBar(player, selected)}
      ${handDrawer(player)}
      <div class="floating-panels ${game.phase === "showdown" ? "showdown-dock" : ""} ${showPendingPayment || showPendingChoice || graveyardOpenPlayerId || banishedOpenPlayerId ? "has-modal" : ""}">
        ${game.phase === "showdown" ? "" : ""}
        ${showPendingPayment ? paymentPanel() : ""}
        ${showPendingChoice ? choicePanel() : ""}
        ${graveyardOpenPlayerId ? graveyardPanel(graveyardOpenPlayerId) : ""}
        ${banishedOpenPlayerId ? banishedPanel(banishedOpenPlayerId) : ""}
        ${intelOpenPlayerId ? intelPanel(intelOpenPlayerId) : ""}
      </div>
    </div>
  `;
}

function uiSelectedCard() {
  return game.selectedCardId ? getSelectedCard(game) : null;
}

function handDrawer(player) {
  const cardCount = player.hand.length;
  return `
    <section class="hand-drawer ${handOpen ? "open" : "closed"}">
      <div class="hand-panel" aria-hidden="${handOpen ? "false" : "true"}">
        <div class="section-head">
          <h2>${playerName(player)} ${t("hand", locale())}</h2>
          <span>${t("cardCount", locale(), { n: cardCount })}</span>
        </div>
        <div class="cards">${championCard(player)}${player.hand.map(handCard).join("") || `<p class="empty">${t("noCardsInHand", locale())}</p>`}</div>
      </div>
    </section>
  `;
}

function moveBatchBar(player) {
  const units = [...moveSelection].map((unitId) => findVisibleCard(unitId)).filter(Boolean);
  if (game.phase !== "action" || game.pendingPayment || game.pendingChoice || units.length < 2) return "";
  const destinations = batchMoveDestinations(units);
  return `
    <section class="move-batch-bar">
      <span>${t("standardMove", locale())}: ${units.length} ${t("units", locale())}</span>
      <div class="actions inline">
        ${destinations.map((destination) => `
          <button data-action="batch-move" data-destination="${destination.id}">${destination.label}</button>
        `).join("") || `<button disabled>${t("noSharedDestination", locale())}</button>`}
        <button data-action="clear-move-selection">${t("clear", locale())}</button>
      </div>
    </section>
  `;
}

function batchMoveDestinations(units) {
  const options = [];
  const destinationIds = new Set(sharedLegalMoveDestinationIds(
    uiLegalActions,
    units.map((unit) => unit.instanceId)
  ));
  if (destinationIds.has("base")) {
    options.push({ id: "base", label: t("moveToBase", locale()) });
  }
  for (const [index, field] of visibleBattlefields().entries()) {
    if (destinationIds.has(field.instanceId)) {
      options.push({ id: field.instanceId, label: t("moveToField", locale(), { n: index + 1 }) });
    }
  }
  return options;
}

function logDrawer() {
  const interaction = interactionStatus();
  const visibleLog = gameLogVisibleToViewer(game, viewerPlayerId());
  return `
    <aside class="log-drawer" aria-label="${t("eventTimeline", locale())}">
      <div class="section-head">
        <div>
          <h2>${t("eventTimeline", locale())}</h2>
          <span>${visibleLog.length} ${t("recentEvents", locale())}</span>
        </div>
        <button data-action="toggle-log">${t("close", locale())}</button>
      </div>
      <div class="log-current status-${interaction.tone}">
        <strong>${interaction.title}</strong>
        <span>${interaction.detail}</span>
      </div>
      <div class="log-list">
        ${visibleLog.map((entry, index) => logEntryView(entry, index, visibleLog.length)).join("")}
      </div>
    </aside>
  `;
}

function logEntryView(entry, index, total = game.log.length) {
  const value = String(entry || "");
  const category = /pay|cost/i.test(value)
    ? "payment"
    : /starts turn|ends the turn|first turn/i.test(value)
      ? "turn"
      : /choose|mulligan|select/i.test(value)
        ? "choice"
        : /damage|kill|draw|gain|score|heal/i.test(value)
          ? "result"
          : /play|activate|trigger|showdown/i.test(value)
            ? "effect"
            : "system";
  const exception = value.startsWith("[UI Exception]");
  return `
    <article class="log-entry log-${category} ${exception ? "ui-exception-log" : ""}">
      <span class="log-index">${total - index}</span>
      <p>${escapeHtml(localizedLogEntry(value))}</p>
    </article>
  `;
}

function localizedLogEntry(entry) {
  const value = String(entry || "");
  if (locale() !== LOCALES.KO) return value;
  if (value.startsWith("[UI Exception]")) {
    const detail = value.replace(/^\[UI Exception\]\s*/u, "");
    return `화면 처리 오류: ${localizedDynamicText(detail)}`;
  }
  const energyGain = value.match(/^(.+) adds (\d+) Energy\.$/u);
  if (energyGain) return `${localizedEffectSource(energyGain[1])} 효과로 에너지 ${energyGain[2]}을 획득했습니다.`;
  const powerGain = value.match(/^(.+) adds (\d+) (Body|Calm|Chaos|Fury|Mind|Order|Any) Power\.$/u);
  if (powerGain) return `${localizedEffectSource(powerGain[1])} 효과로 ${domainText(powerGain[3])} 힘 ${powerGain[2]}을 획득했습니다.`;
  const patterns = [
    [/^(.+) plays (.+) from the Champion Zone to base\.$/u, "$1님이 챔피언 존의 $2 카드를 기지에 사용했습니다."],
    [/^(.+) is paying for (.+)\.$/u, "$1님이 $2 비용을 지불하고 있습니다."],
    [/^(.+) starts turn (\d+)\.$/u, "$1님의 $2턴이 시작됐습니다."],
    [/^(.+) ends the turn\. All units heal\.$/u, "$1님이 턴을 종료했습니다. 모든 유닛이 회복합니다."],
    [/^(.+) keeps their opening hand\.$/u, "$1님이 시작 손패를 유지했습니다."],
    [/^(.+) chooses cards to mulligan\.$/u, "$1님이 멀리건 카드를 선택합니다."],
    [/^(.+) chooses (.+) as their starting champion\.$/u, "$1님이 시작 챔피언으로 $2 카드를 선택했습니다."],
    [/^(.+) rolls (\d+) for play order\.$/u, "$1님이 선후공 결정 주사위에서 $2가 나왔습니다."],
    [/^(.+) wins the play-order roll and chooses who goes first\.$/u, "$1님이 주사위 굴림에서 이겨 선후공을 선택합니다."],
    [/^(.+) chooses (.+) to go first\.$/u, "$1님이 $2님을 선공으로 선택했습니다."],
    [/^(.+) chooses (.+)\.$/u, "$1님이 $2 카드를 선택했습니다."],
    [/^(.+) wins the random first-player roll\.$/u, "$1님이 선공으로 결정됐습니다."],
    [/^(.+) plays (.+)\.$/u, "$1님이 $2 카드를 사용했습니다."],
    [/^(.+) draws (\d+) cards?\.$/u, "$1님이 카드 $2장을 뽑았습니다."],
    [/^(.+) gains (\d+) point(?:s)?\.$/u, "$1님이 점수 $2점을 획득했습니다."]
  ];
  const fixed = new Map([
    ["Mulligans are complete. The first turn begins.", "멀리건이 끝나 첫 턴을 시작합니다."],
    ["Battlefields are set. Each player may mulligan up to 2 cards.", "전장 선택이 끝났습니다. 각 플레이어는 최대 2장까지 멀리건할 수 있습니다."],
    ["Each player chooses one starting battlefield.", "각 플레이어가 시작 전장 1개를 선택합니다."],
    ["Each player chooses one starting champion.", "각 플레이어가 시작 챔피언 1명을 선택합니다."],
    ["Each player rolls a die to decide who chooses the play order.", "각 플레이어가 주사위를 굴려 선후공 선택권을 정합니다."],
    ["The play-order roll is tied. Both players roll again.", "선후공 결정 주사위가 동점입니다. 두 플레이어가 다시 굴립니다."]
  ]);
  if (fixed.has(value)) return fixed.get(value);
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(value)) return localizedDynamicText(value.replace(pattern, replacement));
  }
  const localized = localizedDynamicText(value);
  const allowed = ["AI", "XP", "HTTP", "Riftbound", ...game.players.map((player) => player.name)];
  if (!hasUnexpectedEnglish(localized, allowed)) return localized;
  const sourceCard = ALL_CARDS.find((card) => value.startsWith(card.name));
  const sourcePlayer = game.players.find((player) => value.startsWith(player.name));
  const source = sourceCard ? cardName(sourceCard) : sourcePlayer?.name;
  return source ? `${source} 관련 게임 효과가 처리되었습니다.` : "게임 규칙에 따라 상태가 갱신되었습니다.";
}

function localizedEffectSource(sourceName) {
  const rune = String(sourceName || "").match(/^(Body|Calm|Chaos|Fury|Mind|Order|Any) Rune$/u);
  if (rune) return `${domainText(rune[1])} 룬`;
  const card = ALL_CARDS.find((candidate) => candidate.name === sourceName);
  return card ? cardName(card) : sourceName;
}

function paymentPanel() {
  const payment = game.pendingPayment;
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const card = paymentDisplayCard(player, payment);
  const displayCard = card || { name: payment.cardName || t("effectPayment", locale()), energy: payment.energyCost || 0, power: [] };
  const powerCost = payment.powerCost || displayCard.power || [];
  const energyNeeded = payment.energyCost ?? displayCard.energy ?? 0;
  const poolEnergySelected = payment.poolEnergyIds?.length || 0;
  const runeEnergyNeeded = Math.max(0, energyNeeded - poolEnergySelected);
  const paymentReady = paymentConfirmationLegality(game).ok;
  return `
    <section class="payment-panel modal-panel">
      <div class="section-head">
        <div>
          <h2>${t("paymentRequired", locale())}</h2>
          <span>${paymentCostSummary(player, displayCard, payment, energyNeeded, poolEnergySelected, powerCost)}</span>
        </div>
        <div class="actions inline">
          <button data-action="cancel-payment">${t("cancel", locale())}</button>
          <button class="primary" data-action="confirm-payment" ${paymentReady ? "" : "disabled"}>${paymentReady ? t("confirm", locale()) : t("selectCost", locale())}</button>
        </div>
      </div>
      <div class="payment-body">
        <aside class="payment-card-preview">
          ${cardImage(displayCard)}
          <strong>${displayCard.cardNumber ? cardName(displayCard) : localizedDynamicText(displayCard.name)}</strong>
          <span>${payment.source === "effectEnergy"
            ? t("effectPayment", locale())
            : payment.source === "activatedAbility"
              ? (locale() === LOCALES.KO ? "활성화 비용" : "Activation cost")
              : payment.source === "hideCard" ? t("payCost", locale()) : t("playCost", locale())}</span>
        </aside>
        <div class="payment-cost-area">
          ${optionalPaymentControls(payment)}
          ${paymentAddControls(player)}
          ${poolEnergyControls(player, payment)}
          ${poolPowerControls(player, payment, powerCost)}
          ${paymentRuneSection(player, payment, displayCard, powerCost)}
        </div>
      </div>
    </section>
  `;
}

function paymentDisplayCard(player, payment) {
  if (!player || !payment) return null;
  if (payment.source === "champion") return player.champion;
  if (payment.source === "effectEnergy") return payment.effectPayment?.sourceCard || findVisibleCard(payment.cardId);
  if (payment.source === "trashSpell") return player.trash.find((candidate) => candidate.instanceId === payment.cardId) || findVisibleCard(payment.cardId);
  return player.hand.find((candidate) => candidate.instanceId === payment.cardId) || findVisibleCard(payment.cardId);
}

function paymentCostSummary(player, card, payment, energyNeeded, poolEnergySelected, powerCost) {
  const parts = [t("costFor", locale(), { name: cardName(card) })];
  if (energyNeeded > 0) parts.push(`${t("energy", locale())} ${(payment.energyRuneIds || []).length + poolEnergySelected}/${energyNeeded}`);
  if (totalPowerAmount(powerCost) > 0) parts.push(`${t("power", locale())} ${powerProgress(player, card, payment)}`);
  if ((payment.xpCost || 0) > 0) parts.push(`XP ${player.xp || 0}/${payment.xpCost}`);
  if (parts.length === 1) parts.push(t("noCost", locale()));
  return parts.join(" - ");
}

function poolEnergyControls(player, payment) {
  const pool = legalPaymentPoolEnergyOptions(game);
  if (!pool.length) return "";
  return `
    <section class="payment-resource-group generated-resource-group">
      <div class="payment-resource-heading">
        <strong>${locale() === LOCALES.KO ? "생성된 에너지" : "Generated Energy"}</strong>
        <span>${locale() === LOCALES.KO ? "먼저 사용할 에너지를 선택하세요" : "Choose generated Energy to spend first"}</span>
      </div>
      <div class="pool-energy-list">
      ${pool.map((resource) => {
        const selected = resource.selected;
        return `
          <button
            class="pool-energy ${selected ? "selected" : ""}"
            data-action="pay-pool-energy"
            data-energy="${resource.id}"
            aria-pressed="${selected}"
            ${resource.canToggle ? "" : "disabled"}
            title="${resource.sourceName}${resource.restriction ? ` - ${resource.restriction} only` : ""}"
          >
            <span class="pool-energy-orb">${domainSwatches(resource.domains)}</span>
            <strong>${selected ? t("selected", locale()) : `${t("energy", locale())} +1`}</strong>
            <span>${localizedEffectSource(resource.sourceName)}</span>
          </button>
        `;
      }).join("")}
      </div>
    </section>
  `;
}

function poolPowerControls(player, payment, powerCost) {
  const pool = runePoolPower(player);
  if (!pool.length || totalPowerAmount(powerCost) <= 0) return "";
  return `
    <section class="payment-resource-group generated-resource-group">
      <div class="payment-resource-heading">
        <strong>${locale() === LOCALES.KO ? "생성된 힘" : "Generated Power"}</strong>
        <span>${locale() === LOCALES.KO ? "비용과 일치하는 힘만 사용할 수 있습니다" : "Only matching Power can be spent"}</span>
      </div>
      <div class="pool-energy-list">
      ${pool.map((resource) => {
        const selected = (payment.poolPowerIds || []).includes(resource.id);
        const card = game.players.find((candidate) => candidate.id === payment.playerId)?.hand
          .find((candidate) => candidate.instanceId === payment.cardId)
          || findVisibleCard(payment.cardId);
        const usable = poolPowerCanPay(resource, card)
          && powerCost.some((requirement) => powerMatches(resource, requirement));
        const limitReached = !selected
          && ((payment.poolPowerIds?.length || 0) + (payment.powerRuneIds?.length || 0) >= totalPowerAmount(powerCost));
        return `
          <button
            class="${selected ? "selected" : ""}"
            data-action="pay-pool-power"
            data-power="${resource.id}"
            aria-pressed="${selected}"
            ${!selected && (!usable || limitReached) ? "disabled" : ""}
            title="${resource.sourceName || t("generatedPower", locale())}${resource.restriction ? ` - ${resource.restriction} only` : ""}"
          >${domainText(resource.domain)} ${t("power", locale())}</button>
        `;
      }).join("")}
      </div>
    </section>
  `;
}

function poolEnergyCanPay(resource, card = null) {
  if (resource.restriction === "showdown") return game.phase === "showdown";
  if (resource.restriction === "spell") {
    const pendingCard = game.pendingPayment
      ? game.players.find((player) => player.id === game.pendingPayment.playerId)?.hand.find((candidate) => candidate.instanceId === game.pendingPayment.cardId)
        || findVisibleCard(game.pendingPayment.cardId)
      : card;
    return pendingCard?.type === "spell";
  }
  return true;
}

function poolPowerCanPay(resource, card = null) {
  if (resource.restriction === "showdown") return game.phase === "showdown";
  if (resource.restriction === "spell") return card?.type === "spell";
  return true;
}

function paymentAddControls(player) {
  const options = activatedAddResources(player);
  if (!options.length) return "";
  return `
    <section class="payment-resource-group add-resource-group">
      <div class="payment-resource-heading">
        <strong>${locale() === LOCALES.KO ? "결제 중 생성 가능" : "Available During Payment"}</strong>
        <span>${locale() === LOCALES.KO ? "필요할 때만 사용하세요" : "Use only when needed"}</span>
      </div>
      <div class="payment-add-actions">
      ${options.map(({ card, ability }) => `
        <button data-action="activate-card" data-card="${card.instanceId}" data-ability="${ability.id}" title="${cardText(card) || cardName(card)}">
          <strong>${cardName(card)}</strong>
          <span>${ability.kind === "addPower"
            ? `${domainText(ability.domain)} ${t("power", locale())} +${ability.amount || 1}`
            : `${t("energy", locale())} +${ability.amount || 1}`}</span>
        </button>
      `).join("")}
      </div>
    </section>
  `;
}

function activatedAddResources(player) {
  if (!game.pendingPayment || game.pendingChoice) return [];
  if (game.pendingPayment.playerId !== player.id) return [];
  return controlledCards(player)
    // Basic Runes already have direct Energy/Power controls in the Rune payment
    // section. Listing their ADD abilities here duplicates the same decision.
    .filter((card) => card.controllerId === player.id && card.type !== "rune")
    .flatMap((card) => legalActivatedAbilityOptions(game, card.instanceId)
      .filter((ability) => ["addEnergy", "addPower"].includes(ability.kind))
      .map((ability) => ({ card, ability })));
}

function controlledCards(player) {
  return [
    player.legend,
    player.champion,
    ...player.base,
    ...player.runes,
    ...game.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === player.id))
  ].filter(Boolean);
}

function optionalPaymentControls(payment) {
  if (!(payment.optionalPowerEffects || []).length) return "";
  return `
    <div class="optional-costs">
      ${payment.optionalPowerEffects.map((effect) => `
        <button
          class="${effect.selected ? "selected" : ""}"
          data-action="toggle-optional-payment"
          data-effect="${effect.id}"
          title="${localizedDynamicText(effect.label)}"
        >
          ${effect.selected ? t("on", locale()) : t("off", locale())} - ${localizedDynamicText(effect.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function runePoolEnergy(player) {
  const energy = player.runePool?.energy || [];
  if (Array.isArray(energy)) return energy;
  return Array.from({ length: energy }, (_, index) => ({
    id: `legacy-pool-${player.id}-${index}`,
    domains: ["Any"],
    sourceName: t("generatedEnergy", locale())
  }));
}

function runePoolPower(player) {
  return (player.runePool?.power || []).map((resource, index) => {
    if (resource && typeof resource === "object") return resource;
    return { id: `legacy-power-${player.id}-${index}`, instanceId: `legacy-power-${player.id}-${index}`, domain: resource || "Any" };
  });
}

function powerProgress(player, card, payment) {
  const powerCost = payment.powerCost || card.power || [];
  if (!powerCost.length) return "0/0";
  const selectedPowerRunes = (payment.powerRuneIds || [])
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);
  const selectedPoolPower = (payment.poolPowerIds || [])
    .map((id) => runePoolPower(player).find((resource) => resource.id === id))
    .filter(Boolean);
  const selectedPower = [...selectedPoolPower, ...selectedPowerRunes];
  return powerCost
    .map((requirement) => {
      const available = selectedPower.filter((rune) => powerMatches(rune, requirement)).length;
      return `${Math.min(available, requirement.amount)}/${requirement.amount} ${requirement.domain}`;
    })
    .join(", ");
}

function powerMatches(rune, requirement) {
  if (rune.temporaryResource) return false;
  if (rune.domain === "Any") return true;
  if (requirement.allowedDomains?.length) return requirement.allowedDomains.includes(rune.domain);
  return requirement.domain === "Any" || rune.domain === requirement.domain;
}

function totalPowerAmount(requirements) {
  return requirements.reduce((sum, requirement) => sum + requirement.amount, 0);
}

function runeCanPayPower(rune, card, payment, powerCost) {
  const powerRuneIds = payment.powerRuneIds || [];
  if (powerRuneIds.includes(rune.instanceId)) return true;
  if (!powerCost.some((requirement) => powerMatches(rune, requirement))) return false;
  if (powerRuneIds.length + (payment.poolPowerIds?.length || 0) >= totalPowerAmount(powerCost)) return false;
  return true;
}

function paymentRuneSection(player, payment, card, powerCost) {
  const runes = player.runes.map((rune) => paymentRune(rune, payment, card, powerCost)).filter(Boolean);
  if (!runes.length) return "";
  return `
    <section class="payment-resource-group rune-payment-group">
      <div class="payment-resource-heading">
        <strong>${locale() === LOCALES.KO ? "룬으로 지불" : "Pay With Runes"}</strong>
        <span>${locale() === LOCALES.KO
          ? "에너지는 룬을 탈진시키고, 힘은 룬을 재활용합니다"
          : "Energy exhausts a Rune; Power recycles it"}</span>
      </div>
      <div class="pay-runes">${runes.join("")}</div>
    </section>
  `;
}

function paymentRune(rune, payment, card, powerCost) {
  const energyRuneIds = payment.energyRuneIds || [];
  const powerRuneIds = payment.powerRuneIds || [];
  const energySelected = energyRuneIds.includes(rune.instanceId);
  const powerSelected = powerRuneIds.includes(rune.instanceId);
  const powerDisabled = !runeCanPayPower(rune, card, payment, powerCost);
  const energyCost = payment.energyCost ?? (card.energy || 0);
  const poolSelected = payment.poolEnergyIds?.length || 0;
  const runeEnergyNeeded = Math.max(0, energyCost - poolSelected);
  const energyDisabled = rune.exhausted || (!energySelected && energyRuneIds.length >= runeEnergyNeeded);
  const showEnergy = energySelected || (energyCost > 0 && !energyDisabled);
  const showPower = powerSelected || (totalPowerAmount(powerCost) > 0 && !powerDisabled);
  if (!showEnergy && !showPower) return "";
  return `
    <article class="pay-rune ${energySelected ? "selected-energy" : ""} ${powerSelected ? "selected-power" : ""}">
      <span class="rune payment-rune-card ${rune.exhausted ? "spent" : ""}" style="--rune:${rune.color}">
        ${rune.image ? `<img src="${rune.image}" alt="${cardName(rune)}" />` : `<span class="rune-swatch"></span>`}
        <span class="rune-card-caption">${domainText(rune.domain)}${rune.exhausted ? ` · ${t("spent", locale())}` : ""}</span>
      </span>
      <div class="payment-mode-buttons">
        ${showEnergy ? `<button class="${energySelected ? "selected" : ""}" data-action="pay-rune" data-rune="${rune.instanceId}" data-mode="energy" aria-pressed="${energySelected}">${t("energy", locale())}</button>` : ""}
        ${showPower ? `<button class="${powerSelected ? "selected" : ""}" data-action="pay-rune" data-rune="${rune.instanceId}" data-mode="power" aria-pressed="${powerSelected}">${domainText(rune.domain)} ${t("power", locale())}</button>` : ""}
      </div>
    </article>
  `;
}

function domainSwatches(domains = ["Any"]) {
  return domains.map((domain) => `<span style="--swatch:${RUNE_COLORS[domain] || RUNE_COLORS.Any || "#e9e2d1"}"></span>`).join("");
}

function graveyardPanel(playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return "";
  return `
    <section class="graveyard-panel modal-panel">
      <div class="section-head">
        <div>
          <h2>${playerName(player)} ${t("trash", locale())}</h2>
          <span>${t("cardCount", locale(), { n: player.trash.length })}</span>
        </div>
        <button data-action="close-graveyard">${t("close", locale())}</button>
      </div>
      <div class="cards graveyard-cards" data-scroll-key="graveyard-${player.id}">
        ${player.trash.map((card) => `
          <div class="graveyard-card-entry">
            <article class="${imageCardClass(card, "graveyard-card")}" data-card-id="${card.instanceId}">
              ${cardImage(card)}
            </article>
            ${player.id === viewerPlayerId() ? trashActions(card, player).join("") : ""}
          </div>
        `).join("") || `<p class="empty">${t("trashEmpty", locale())}</p>`}
      </div>
    </section>
  `;
}

function banishedPanel(playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return "";
  const cards = player.banished || [];
  return `
    <section class="graveyard-panel modal-panel banished-panel">
      <div class="section-head">
        <div><h2>${playerName(player)} ${t("banished", locale())}</h2><span>${t("cardCount", locale(), { n: cards.length })}</span></div>
        <button data-action="close-banished">${t("close", locale())}</button>
      </div>
      <div class="cards graveyard-cards" data-scroll-key="banished-${player.id}">
        ${cards.map((card) => `<article class="${imageCardClass(card, "graveyard-card")}" data-card-id="${card.instanceId}">${cardImage(card)}</article>`).join("") || `<p class="empty">${t("banishedEmpty", locale())}</p>`}
      </div>
    </section>`;
}

function intelPanel(playerId) {
  const viewer = viewerPlayer();
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || !canViewPrivateInfo(viewer.id, player.id)) return "";
  const hiddenCards = game.battlefields.flatMap((field) =>
    (field.hidden || [])
      .filter((item) => hiddenCardIsControlledBy(item, player.id))
      .map((item) => ({ ...item, fieldName: battlefieldName(field) }))
  );
  return `
    <section class="intel-panel modal-panel reveal-panel">
      <div class="section-head">
        <div>
          <h2>${playerName(player)}: ${t("revealedIntel", locale())}</h2>
          <span>${t("availableUntilTurnEnds", locale())}</span>
        </div>
        <button data-action="close-intel">${t("close", locale())}</button>
      </div>
      <div class="intel-section">
        <strong>${t("hand", locale())}</strong>
        <div class="cards intel-cards">
          ${player.hand.map((card) => `
            <article class="${imageCardClass(card, "intel-card")}" data-card-id="${card.instanceId}">
              ${cardImage(card)}
            </article>
          `).join("") || `<p class="empty">${t("noCardsInHand", locale())}</p>`}
        </div>
      </div>
      <div class="intel-section">
        <strong>${t("facedownCards", locale())}</strong>
        <div class="cards intel-cards">
          ${hiddenCards.map((item) => `
            <article class="${imageCardClass(item.card, "intel-card")}" data-card-id="${item.card.instanceId}">
              ${cardImage(item.card)}
              <span class="status-line">${item.fieldName}</span>
            </article>
          `).join("") || `<p class="empty">${t("noFacedownCards", locale())}</p>`}
        </div>
      </div>
    </section>
  `;
}

function choicePanel() {
  const choice = game.pendingChoice;
  if (choice.effect === "triggerOrder") return triggerOrderPanel(choice);
  if (choice.effect === "combatDamage") return combatDamagePanel(choice);
  if (choice.effect === "alphaStrikeDamage") return alphaStrikeDamagePanel(choice);
  if (choice.effect === "payDeflect") return deflectPaymentPanel(choice);
  if (choice.effect === "predictChoice") return predictChoicePanel(choice);
  if (choice.effect === "observedTopDeckSelfAbility") return observedTopDeckSelfAbilityPanel(choice);
  if (choice.effect === "acknowledgeReveal") return revealConfirmationPanel(choice);
  const instruction = choiceEffectInstruction(choice);
  const repeatProgress = repeatedDamageProgress(choice);
  const searchable = choice.options.length > 12;
  return `
    <section class="choice-panel modal-panel ${choice.effect === "sabotage" ? "reveal-panel" : ""}">
      <div class="section-head">
        <div>
          <h2>${choice.effect === "sabotage" ? `${cardName(choice.card)}: ${t("revealedHand", locale())}` : `${choice.data?.declareTrigger ? t("declaring", locale()) : t("resolving", locale())} ${cardName(choice.card)}`}</h2>
          <span>${localizedChoicePrompt(choice)}</span>
          ${instruction ? `<p class="choice-instruction">${instruction}</p>` : ""}
          ${repeatProgress}
        </div>
        ${choice.optional ? `<button data-action="decline-effect">${t("decline", locale())}</button>` : ""}
      </div>
      ${choiceRevealedCards(choice)}
      ${searchable ? `
        <label class="choice-search">
          <span>${locale() === LOCALES.KO ? "선택지 검색" : "Search choices"}</span>
          <input type="search" data-action="choice-search" autocomplete="off"
            placeholder="${locale() === LOCALES.KO ? "카드 이름이나 선택지 입력" : "Type a card name or choice"}"
            aria-controls="pending-choice-grid" />
          <small data-choice-search-count>${locale() === LOCALES.KO ? `전체 ${choice.options.length}개` : `${choice.options.length} total`}</small>
        </label>
      ` : ""}
      <div class="choice-grid" id="pending-choice-grid">
        ${choice.options.map(choiceOptionButton).join("")}
      </div>
      ${searchable ? `<p class="choice-search-empty" data-choice-search-empty hidden>${locale() === LOCALES.KO ? "일치하는 선택지가 없습니다." : "No matching choices."}</p>` : ""}
    </section>
  `;
}

function triggerOrderPanel(choice) {
  const state = choice.data?.triggerOrderState;
  const group = state?.groups?.[state.groupIndex];
  const chosen = group?.orderedTriggers || [];
  const triggerOptions = choice.options.filter((option) => !option.confirmTriggerOrder);
  const confirmOption = choice.options.find((option) => option.confirmTriggerOrder);
  const total = triggerOptions.length;
  const mandatoryRemaining = triggerOptions.filter((option) => !option.optionalTrigger && !option.selected).length;
  return `
    <section class="choice-panel modal-panel trigger-order-panel">
      <div class="section-head trigger-order-head">
        <div>
          <h2>${t("triggerOrderTitle", locale())}</h2>
          <span>${t("triggerOrderProgress", locale(), { selected: chosen.length, total })}</span>
          <p class="choice-instruction trigger-order-instruction">${t("triggerOrderHelp", locale())}</p>
          ${mandatoryRemaining ? `<p class="trigger-order-required">${t("triggerOrderMandatoryRemaining", locale(), { n: mandatoryRemaining })}</p>` : ""}
        </div>
        ${confirmOption ? `
          <div class="trigger-order-confirm">
            <button type="button" class="primary" data-action="choose-effect" data-choice="${confirmOption.id}" ${confirmOption.disabled ? "disabled aria-disabled=\"true\"" : ""}>${t("triggerOrderConfirm", locale())}</button>
          </div>
        ` : ""}
      </div>
      <div class="trigger-order-track" aria-label="${t("triggerOrderSelected", locale())}">
        ${Array.from({ length: total }, (_, index) => {
          const trigger = chosen[index];
          return `
            <div class="trigger-order-step ${trigger ? "is-chosen" : "is-pending"}">
              <b>${index + 1}</b>
              <span>${trigger ? triggerOrderSourceName(trigger) : t("pending", locale())}</span>
            </div>
          `;
        }).join("")}
      </div>
      ${chosen.length ? `
        <div class="trigger-order-selected">
          <strong>${t("triggerOrderSelected", locale())}</strong>
          <ol>
            ${chosen.map((trigger) => `<li><b>${triggerOrderSourceName(trigger)}</b><span>${triggerOrderEffectText(trigger)}</span></li>`).join("")}
          </ol>
        </div>
      ` : ""}
      <div class="choice-grid trigger-order-grid">
        ${triggerOptions.map((option) => triggerOrderOptionButton(choice, option)).join("")}
      </div>
    </section>
  `;
}

function triggerOrderOptionButton(choice, option) {
  const group = choice.data?.triggerOrderState?.groups?.[choice.data.triggerOrderState.groupIndex];
  const trigger = group?.triggers?.find((candidate) => candidate.id === option.id);
  const preview = choicePreviewCard(option);
  const sourceName = trigger ? triggerOrderSourceName(trigger) : (preview ? cardName(preview) : localizedChoiceOptionLabel(option));
  return `
    <div class="choice-option-wrap trigger-order-option-wrap">
      <button type="button" class="choice-option trigger-order-option ${option.selected ? "is-selected" : ""}" data-action="choose-effect" data-choice="${option.id}" data-card-id="${option.cardId || ""}" aria-pressed="${Boolean(option.selected)}">
        <strong class="trigger-order-rank">${option.selected
          ? t("triggerOrderChooseRank", locale(), { n: option.selectionOrder })
          : t(option.optionalTrigger ? "triggerOrderOptional" : "triggerOrderMandatory", locale())}</strong>
        ${option.cardId ? choiceOptionImage(option) : ""}
        <span class="choice-card-name">${sourceName}</span>
        <span class="trigger-order-kind">${triggerKindLabel(trigger) || t("triggeredAbility", locale())}</span>
        <small class="trigger-order-effect">${triggerOrderEffectText(trigger, option)}</small>
      </button>
      ${preview && !preview.redacted ? `<button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${preview.instanceId}">${t("viewFullCard", locale())}</button>` : ""}
    </div>
  `;
}

function triggerOrderSourceName(trigger) {
  const source = findVisibleCard(trigger?.sourceCardId) || trigger?.sourceCardSnapshot;
  return source ? cardName(source) : (triggerKindLabel(trigger) || t("triggeredAbility", locale()));
}

function triggerOrderEffectText(trigger, option = null) {
  const source = findVisibleCard(trigger?.sourceCardId) || trigger?.sourceCardSnapshot;
  if (source) return escapeHtml(cardText(source));
  return escapeHtml(triggerKindLabel(trigger) || localizedChoiceOptionLabel(option || {}) || t("triggeredAbility", locale()));
}

function predictChoicePanel(choice) {
  const cardOption = choice.options.find((option) => option.cardId);
  const preview = choicePreviewCard(cardOption);
  const keep = choice.options.find((option) => option.id === "keep");
  const recycle = choice.options.find((option) => option.id === "recycle");
  return `
    <section class="choice-panel modal-panel predict-choice-panel">
      <div class="section-head">
        <div>
          <h2>${t("predictedCard", locale())}</h2>
          <span>${preview && !preview.redacted ? cardName(preview) : localizedChoicePrompt(choice)}</span>
        </div>
      </div>
      <div class="predict-choice-content">
        <div class="predict-card-preview">
          ${cardOption ? choiceOptionImage(cardOption) : ""}
          ${preview && !preview.redacted ? `<strong>${cardName(preview)}</strong><button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${preview.instanceId}">${t("viewFullCard", locale())}</button>` : ""}
        </div>
        <div class="predict-actions">
          ${keep ? `
            <button type="button" class="predict-action keep-action" data-action="choose-effect" data-choice="${keep.id}">
              <strong>${t("keepOnTop", locale())}</strong>
              <span>${t("keepOnTopDescription", locale())}</span>
            </button>
          ` : ""}
          ${recycle ? `
            <button type="button" class="predict-action recycle-action" data-action="choose-effect" data-choice="${recycle.id}">
              <strong>${t("recycle", locale())}</strong>
              <span>${t("recycleMainDeckDescription", locale())}</span>
            </button>
          ` : ""}
        </div>
      </div>
    </section>
  `;
}

function observedTopDeckSelfAbilityPanel(choice) {
  const preview = choice.card;
  const descriptions = locale() === LOCALES.KO
    ? {
        "banish-play": "이 카드를 추방한 뒤 표시된 대체 비용으로 즉시 사용합니다.",
        banish: "이 카드를 추방하지만 사용하지 않습니다.",
        leave: "이 카드를 주 덱에 그대로 두고 원래 효과 처리를 계속합니다."
      }
    : {
        "banish-play": "Banish this card, then immediately play it for the shown replacement cost.",
        banish: "Banish this card without playing it.",
        leave: "Leave this card in the Main Deck and continue the original effect."
      };
  return `
    <section class="choice-panel modal-panel predict-choice-panel observed-top-deck-choice-panel">
      <div class="section-head">
        <div>
          <h2>${cardName(preview)}</h2>
          <span>${locale() === LOCALES.KO
            ? "주 덱 위에서 확인한 이 카드를 어떻게 처리할지 선택해 주세요."
            : choice.prompt}</span>
        </div>
      </div>
      <div class="predict-choice-content">
        <div class="predict-card-preview">
          ${choiceOptionImage({ cardId: preview.instanceId, card: preview, revealed: true, label: cardName(preview) })}
          <strong>${cardName(preview)}</strong>
          <button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${preview.instanceId}">${t("viewFullCard", locale())}</button>
        </div>
        <div class="predict-actions observed-top-deck-actions">
          ${choice.options.map((option) => `
            <button type="button" class="predict-action ${option.id === "banish-play" ? "keep-action" : option.id === "banish" ? "recycle-action" : ""}" data-action="choose-effect" data-choice="${option.id}">
              <strong>${localizedChoiceOptionLabel(option)}</strong>
              <span>${descriptions[option.id] || ""}</span>
            </button>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function localizedChoicePrompt(choice) {
  if (choice.effect === "triggerOrder") return t("triggerOrderHelp", locale());
  if (locale() === "en") return choice.prompt;
  return t("chooseEffectPrompt", locale(), { name: cardName(choice.card) });
}

function choiceRevealedCards(choice) {
  const revealedCards = choice.data?.revealedCards || [];
  if (!revealedCards.length) return "";
  return `
    <div class="choice-revealed-strip">
      ${revealedCards.map((card) => `
        <article class="revealed-card-item">
          ${choiceOptionImage({ cardId: card.instanceId, card, revealed: true, label: cardName(card) })}
          <strong>${cardName(card)}</strong>
          <button type="button" data-action="view-choice-card" data-card-id="${card.instanceId}">${t("viewFullCard", locale())}</button>
        </article>
      `).join("")}
    </div>
  `;
}

function revealConfirmationPanel(choice) {
  const revealedCards = choice.data?.revealedCards || [];
  return `
    <section class="choice-panel modal-panel reveal-confirmation-panel">
      <div class="section-head">
        <div>
          <h2>${cardName(choice.card)}: ${t("revealed", locale())}</h2>
          <span>${locale() === "en" ? choice.prompt : t("confirmRevealPrompt", locale())}</span>
        </div>
      </div>
      <div class="revealed-card-grid">
        ${revealedCards.map((card) => `
          <article class="revealed-card-item">
            ${choiceOptionImage({ cardId: card.instanceId, card, revealed: true, label: cardName(card) })}
            <strong>${cardName(card)}</strong>
            <button type="button" data-action="view-choice-card" data-card-id="${card.instanceId}">${t("viewFullCard", locale())}</button>
          </article>
        `).join("") || `<p class="empty">${t("noCardsInHand", locale())}</p>`}
      </div>
      <div class="actions reveal-confirmation-actions">
        <button type="button" class="primary" data-action="choose-effect" data-choice="continue">${t("confirm", locale())}</button>
      </div>
    </section>
  `;
}

function choiceOptionButton(option) {
  const preview = choicePreviewCard(option);
  const label = preview && !preview.redacted
    ? (preview.type === "battlefield" ? battlefieldName(preview) : cardName(preview))
    : localizedChoiceOptionLabel(option);
  const context = option.cardId ? choiceCardContext(option.cardId, preview) : null;
  const ownership = choiceOwnership(context, preview);
  const location = context ? choiceLocationLabel(context) : "";
  const selectionState = option.selected
    ? (locale() === LOCALES.KO ? "다시 선택하도록 지정됨" : "Marked to remake")
    : "";
  return `
    <div class="choice-option-wrap">
      <button type="button" class="choice-option ${option.cardId ? `card-choice-option choice-owner-${ownership.tone}` : "text-choice-option"} ${option.selected ? "is-selected" : ""} ${option.confirmControlledChoices ? "confirm-choice-option" : ""} ${option.disabled ? "disabled-choice" : ""}" data-action="choose-effect" data-choice="${option.id}" data-card-id="${option.cardId || ""}" ${option.confirmControlledChoices ? "" : `aria-pressed="${Boolean(option.selected)}"`} ${option.disabled ? "disabled aria-disabled=\"true\"" : ""}>
        ${option.cardId ? choiceOptionImage(option) : ""}
        <span class="choice-card-name">${label}</span>
        ${selectionState ? `<small class="choice-selection-state">${selectionState}</small>` : ""}
        ${option.cardId ? `<span class="choice-card-context"><b>${ownership.label}</b>${location ? `<small>${location}</small>` : ""}</span>` : ""}
      </button>
      ${preview && !preview.redacted ? `<button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${preview.instanceId}">${t("viewFullCard", locale())}</button>` : ""}
    </div>
  `;
}

function choiceCardContext(cardId, card = null) {
  const visibleContext = selectedContext(cardId);
  if (visibleContext) return visibleContext;
  for (const player of game.players) {
    if (player.mainDeck.some((candidate) => candidate.instanceId === cardId)) return { playerId: player.id, zone: "main-deck", location: "main-deck" };
    if (player.runeDeck.some((candidate) => candidate.instanceId === cardId)) return { playerId: player.id, zone: "rune-deck", location: "rune-deck" };
    if (player.trash.some((candidate) => candidate.instanceId === cardId)) return { playerId: player.id, zone: "trash", location: "trash" };
    if ((player.banished || []).some((candidate) => candidate.instanceId === cardId)) return { playerId: player.id, zone: "banished", location: "banished" };
  }
  if (game.showdown?.chain?.some((item) => item?.card?.instanceId === cardId) || game.actionChain?.chain?.some((item) => item?.card?.instanceId === cardId)) {
    return { playerId: card?.controllerId || card?.ownerId || null, zone: "chain", location: "chain" };
  }
  return { playerId: card?.controllerId || card?.ownerId || null, zone: "unknown", location: "unknown" };
}

function choiceOwnership(context, card) {
  const playerId = context?.playerId || card?.controllerId || card?.ownerId || null;
  if (!playerId) return { tone: "neutral", label: t("neutralCard", locale()) };
  if (playerId === viewerPlayerId()) return { tone: "self", label: t("yourCard", locale()) };
  return { tone: "opponent", label: t("opponentCard", locale()) };
}

function choiceLocationLabel(context) {
  if (!context) return "";
  if (["battlefield", "hidden", "attachment", "battlefield-card"].includes(context.zone)) {
    const field = game.battlefields.find((candidate) => candidate.instanceId === context.location);
    return field ? `${battlefieldName(field)} · ${t("battlefield", locale())}` : t("battlefield", locale());
  }
  const labels = {
    hand: t("hand", locale()),
    base: t("base", locale()),
    "main-deck": t("mainDeck", locale()),
    "rune-deck": t("runeDeck", locale()),
    trash: t("trash", locale()),
    banished: t("banished", locale()),
    rune: t("runes", locale()),
    chain: t("chain", locale()),
    legend: t("legend", locale()),
    champion: t("championZone", locale()),
    "champion-choice": t("championZone", locale())
  };
  return labels[context.zone] || t("unknownLocation", locale());
}

function localizedChoiceOptionLabel(option) {
  if (locale() === "en") return option.label;
  const labels = {
    decline: t("decline", locale()),
    continue: t("confirm", locale()),
    "use-trigger": t("useEffect", locale()),
    pay: t("payCost", locale()),
    keep: t("keepOnTop", locale()),
    recycle: t("recycle", locale()),
    "recycle-all": t("recycleAll", locale()),
    swap: t("reverseOrder", locale()),
    "basic-rune-energy": "탈진 → 에너지 +1",
    "basic-rune-power": "재활용 → 힘 +1"
  };
  const localAbilityId = String(option.id || "").split(":").at(-1);
  if (labels[localAbilityId]) return labels[localAbilityId];
  if (labels[option.id]) return labels[option.id];
  if (/^Pay Energy \d+$/i.test(option.label || "")) return option.label.replace(/^Pay Energy/i, t("payEnergy", locale()));
  if (/^(Decline|Keep cards)/i.test(option.label || "")) return t("decline", locale());
  return localizeKoreanChoiceLabel(localizedDynamicText(option.label));
}

function choicePreviewCard(option) {
  return option?.card && !option.card.redacted ? option.card : findChoicePreviewCard(option?.cardId);
}

function repeatedDamageProgress(choice) {
  const declarationSpec = choice.effect === "declarePlayTarget"
    ? choice.data?.currentDeclaration?.spec
    : null;
  const declaredRepeatedDamage = declarationSpec?.kind === "dealDamageUnit"
    && declarationSpec?.selectRepeatedTargetsOnPlay;
  if (choice.effect !== "damageUnit" && !declaredRepeatedDamage) return "";
  const total = declaredRepeatedDamage
    ? choice.data?.max || declarationSpec.repeat || 1
    : choice.data?.repeatTotal || 1;
  if (total < 2) return "";
  const step = declaredRepeatedDamage
    ? Math.min(total, (choice.data?.selectedForCurrentStep?.length || 0) + 1)
    : Math.max(1, total - (choice.data?.remaining || total) + 1);
  const amount = declaredRepeatedDamage ? declarationSpec.amount || 0 : choice.data?.amount || 0;
  const mayRepeatTarget = Boolean(declaredRepeatedDamage
    ? declarationSpec.allowRepeatedTargets
    : choice.data?.allowRepeatedTargets);
  const label = locale() === LOCALES.KO
    ? (declaredRepeatedDamage ? `피해 ${amount} 대상 · ${step}/${total}회 선언` : `피해 ${amount} · ${step}/${total}회`)
    : (declaredRepeatedDamage ? `${amount} damage target · declare ${step}/${total}` : `${amount} damage · ${step}/${total}`);
  const detail = locale() === LOCALES.KO
    ? (mayRepeatTarget ? "같은 유닛을 다시 선택할 수 있습니다." : "이전에 선택한 유닛은 다시 선택할 수 없습니다.")
    : (mayRepeatTarget ? "The same unit may be selected again." : "Previously selected units cannot be selected again.");
  return `<p class="choice-repeat-progress"><strong>${label}</strong><span>${detail}</span></p>`;
}

function choiceEffectInstruction(choice) {
  const sourceName = choice.card ? cardName(choice.card) : t("effect", locale());
  const amount = choice.data?.amount || choice.data?.remaining || 0;
  if (locale() === LOCALES.KO) {
    const instructionsKo = {
      trashGear: `${sourceName}: 처치하여 소유자의 폐기장에 놓을 도구를 선택하세요.`,
      markTemporaryGear: `${sourceName}: 일시적으로 만들 도구를 선택하세요.`,
      damageUnit: `${sourceName}: 피해 ${amount || "지정된 수치"}를 받을 유닛을 선택하세요.`,
      returnUnitToHand: `${sourceName}: 소유자의 손으로 되돌릴 유닛을 선택하세요.`,
      readyUnit: `${sourceName}: 준비시킬 아군 탈진 유닛을 선택하세요.`,
      readyAnotherExhausted: `${sourceName}: 준비시킬 다른 탈진 비주문 오브젝트를 선택하세요.`,
      playEffectUnitDestination: `${sourceName}: 공개한 유닛을 사용할 합법적인 장소를 선택하세요.`,
      sabotage: `${sourceName}: 재활용할 상대의 공개된 비유닛 카드를 선택하세요.`,
      equipGear: `${sourceName}: 이 도구를 부착할 유닛을 선택하세요.`,
      stealEnemyGear: `${sourceName}: 추가 비용을 지불한 뒤 가져올 적 도구를 선택하세요.`,
      payDeflect: `${sourceName}: 굴절 힘을 지불할 룬을 선택하세요.`,
      declarePlayTarget: `${sourceName}: 비용을 지불하기 전에 대상을 선언하세요.`,
      declareMoveDestination: `${sourceName}: 상대가 반응하기 전에 이동 목적지를 선언하세요.`,
      secondDrawBuff: `${sourceName}: 두 번째 카드 뽑기 보너스를 받을 아군 유닛을 선택하세요.`,
      topDeckCard: `${sourceName}: 가져오거나 재활용할 공개 카드를 선택하세요.`,
      predictChoice: `${sourceName}: 예측한 카드를 덱 위에 둘지 재활용할지 선택하세요.`,
      moveUnit: `${sourceName}: 이동할 유닛을 선택하세요.`,
      moveUnitSpellTarget: `${sourceName}: 이 주문으로 이동할 유닛을 선택하세요.`,
      moveUnitSpellDestination: `${sourceName}: 선택한 유닛의 이동 목적지를 선택하세요.`,
      moveDestination: `${sourceName}: 선택한 유닛의 이동 목적지를 선택하세요.`,
      chooseBattlefield: `${sourceName}: 이 효과가 적용될 전장을 선택하세요.`,
      moonfallEnemyMove: `${sourceName}: 선택한 전장으로 적 유닛을 이동할지 선택하세요.`,
      counterSpell: `${sourceName}: 차단할 체인의 주문을 선택하세요.`,
      counterChainCard: `${sourceName}: 차단할 체인의 주문을 선택하세요.`,
      counterUnlessPayEnergy: `${sourceName}: 조종자가 에너지를 지불하지 않으면 차단할 주문을 선택하세요.`,
      counterUnlessPay: `${sourceName}: 조종자가 에너지를 지불하지 않으면 차단할 주문을 선택하세요.`,
      alphaStrike: `${sourceName}: 선제 피해를 입힐 아군 유닛을 선택하세요.`,
      trashSpell: `${sourceName}: 폐기장에서 사용할 주문을 선택하세요.`,
      alphaStrikeDamage: `${sourceName}: 합법적인 적 유닛들에게 피해를 배정하세요.`,
      starCrossedFriendly: `${sourceName}: 손으로 되돌릴 아군 유닛을 선택하세요.`,
      starCrossedEnemy: `${sourceName}: 손으로 되돌릴 적 유닛을 선택하세요.`,
      discardForHwei: `${sourceName}: 효과를 위해 버릴 카드를 선택하세요.`,
      readyRunes: `${sourceName}: 준비시킬 룬을 선택하세요.`
    };
    if (instructionsKo[choice.effect]) return instructionsKo[choice.effect];
    if (choice.options?.some((option) => option.cardId)) return `${sourceName}: 현재 효과의 카드 대상을 선택하세요.`;
    return "";
  }
  const instructions = {
    trashGear: `${sourceName}: choose a gear to kill and put into its owner's trash.`,
    markTemporaryGear: `${sourceName}: choose a gear to make Temporary. It will be killed at the start of its controller's turn.`,
    damageUnit: `${sourceName}: choose a unit to take ${amount || "the listed"} damage.`,
    returnUnitToHand: `${sourceName}: choose a unit to return to its owner's hand.`,
    readyUnit: `${sourceName}: choose a friendly exhausted unit to ready.`,
    readyAnotherExhausted: `${sourceName}: choose another exhausted non-spell object to ready.`,
    playEffectUnitDestination: `${sourceName}: choose a legal location for the revealed unit.`,
    sabotage: `${sourceName}: choose a revealed non-unit card from the opponent's hand to recycle.`,
    equipGear: `${sourceName}: choose the unit this gear will attach to.`,
    stealEnemyGear: `${sourceName}: choose an enemy gear to take and attach after paying the additional cost.`,
    payDeflect: `${sourceName}: choose the rune that will pay the target's Deflect Power.`,
    declarePlayTarget: `${sourceName}: choose the target now. Payment is made after this target is declared.`,
    declareMoveDestination: `${sourceName}: choose the move destination now. Opponents can react after seeing this declared move.`,
    secondDrawBuff: `${sourceName}: choose a friendly unit to receive the second-draw Might bonus.`,
    topDeckCard: `${sourceName}: choose which revealed top-deck card to take or recycle.`,
    predictChoice: `${sourceName}: choose whether to keep the predicted card on top or recycle it.`,
    moveUnit: `${sourceName}: choose the unit that will be moved by this effect.`,
    moveUnitSpellTarget: `${sourceName}: choose the unit that will be moved by this spell.`,
    moveUnitSpellDestination: `${sourceName}: choose where the selected unit will move.`,
    moveDestination: `${sourceName}: choose where the selected unit will move.`,
    chooseBattlefield: `${sourceName}: choose the battlefield this effect will use.`,
    moonfallEnemyMove: `${sourceName}: choose whether to move an enemy unit to the chosen battlefield.`,
    counterSpell: `${sourceName}: choose the spell on the chain to counter.`,
    counterChainCard: `${sourceName}: choose the spell on the chain to counter.`,
    counterUnlessPayEnergy: `${sourceName}: choose the spell that may be countered unless its controller pays Energy.`,
    counterUnlessPay: `${sourceName}: choose the spell that may be countered unless its controller pays Energy.`,
    alphaStrike: `${sourceName}: choose the friendly unit that will deal Alpha Strike damage.`,
    trashSpell: `${sourceName}: choose a spell from trash to play through this effect.`,
    alphaStrikeDamage: `${sourceName}: assign the spell's damage among legal enemy units.`,
    starCrossedFriendly: `${sourceName}: choose the friendly unit that will be returned to hand.`,
    starCrossedEnemy: `${sourceName}: choose the enemy unit that will be returned to hand.`,
    discardForHwei: `${sourceName}: choose a card to discard for Hwei's effect.`,
    readyRunes: `${sourceName}: choose runes to ready.`
  };
  if (instructions[choice.effect]) return instructions[choice.effect];
  if (choice.options?.some((option) => option.cardId)) {
    return `${sourceName}: choose a card target for the effect currently resolving.`;
  }
  return "";
}

function combatDamagePanel(choice) {
  const assigning = game.players.find((player) => player.id === choice.playerId);
  const targetPlayer = game.players.find((player) => player.id === choice.data?.targetPlayerId);
  const legal = new Set(choice.options.map((option) => option.cardId));
  const infos = choice.data?.targetInfos || [];
  return `
    <section class="choice-panel modal-panel combat-damage-panel">
      <div class="section-head">
        <div>
          <h2>${t("damageAssign", locale())}</h2>
          <span>${t("assigningDamage", locale(), { actor: assigning ? playerName(assigning) : t("nobody", locale()), amount: choice.data?.remaining || 0, target: targetPlayer ? playerName(targetPlayer) : t("opponent", locale()) })}</span>
        </div>
      </div>
      <div class="combat-summary">
        <strong>${choice.data?.remaining || 0}</strong>
        <span>${locale() === LOCALES.KO ? "배정 가능한 피해" : "available damage"}</span>
        <small>${t("autoLethalHint", locale())}</small>
      </div>
      <div class="choice-grid combat-choice-grid">
        ${infos.map((info) => combatDamageOption(info, legal.has(info.cardId))).join("")}
      </div>
    </section>
  `;
}

function deflectPaymentPanel(choice) {
  const target = findVisibleCard(choice.data?.targetId);
  const amount = choice.data?.amount || 1;
  const selected = choice.data?.selectedRuneIds?.length || 0;
  return `
    <section class="choice-panel modal-panel deflect-panel">
      <div class="section-head">
        <div>
          <h2>${keywordText(["Deflect"])} ${amount}</h2>
          <span>${target ? cardName(target) : t("selected", locale())}</span>
        </div>
        <strong class="deflect-progress">${selected}/${amount}</strong>
      </div>
      <p class="choice-instruction">${locale() === LOCALES.KO
        ? `이 대상을 선택하려면 힘으로 사용할 룬 ${amount}개를 선택해야 합니다. 선택한 룬은 룬 덱으로 재활용됩니다.`
        : `Choose ${amount} rune${amount === 1 ? "" : "s"} to pay as Power. Chosen runes are recycled to the Rune Deck.`}</p>
      <div class="deflect-rune-grid">
        ${choice.options.map((option) => {
          const rune = findVisibleCard(option.cardId);
          return `
            <button type="button" class="deflect-rune-option" data-action="choose-effect" data-choice="${option.id}">
              ${rune?.image ? `<img class="deflect-rune-art" src="${rune.image}" alt="${cardName(rune)}" />` : `<span class="rune-swatch" style="--rune:${rune?.color || "#94a3b8"}"></span>`}
              <strong>${rune ? domainText(rune.domain) : localizedDynamicText(option.label)}</strong>
              <span>${rune?.exhausted ? t("spent", locale()) : t("ready", locale())}</span>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function alphaStrikeDamagePanel(choice) {
  const targets = [...new Map(choice.options
    .filter((option) => option.cardId)
    .map((option) => [option.cardId, option])).values()];
  const remaining = choice.data?.remainingDamage || 0;
  return `
    <section class="choice-panel modal-panel alpha-strike-panel">
      <div class="section-head">
        <div>
          <h2>${cardName(choice.card)}</h2>
          <span>${localizedChoicePrompt(choice)}</span>
        </div>
      </div>
      <div class="combat-summary">
        <strong>${remaining}</strong>
        <span>${locale() === LOCALES.KO ? "배정 가능한 피해" : "available damage"}</span>
        <small>${choiceEffectInstruction(choice)}</small>
      </div>
      <div class="alpha-strike-targets">
        ${targets.map((option) => {
          const target = findVisibleCard(option.cardId);
          return `
            <div class="alpha-strike-target">
              ${choiceOptionImage(option)}
              <strong>${target ? cardName(target) : localizedDynamicText(option.label)}</strong>
              <label>
                <span>${t("damage", locale())}</span>
                <input type="number" min="1" max="${remaining}" value="1" data-alpha-target="${option.cardId}" />
              </label>
              <button type="button" class="primary" data-action="assign-alpha-strike" data-target="${option.cardId}">${t("confirm", locale())}</button>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function combatDamageOption(info, legal) {
  const card = findVisibleCard(info.cardId);
  const optionId = legal ? info.cardId : "";
  const amountLabel = info.amount
    ? (locale() === LOCALES.KO ? `${info.amount} 피해${info.lethalNow ? " · 처치 가능" : ""}` : `${info.amount} damage${info.lethalNow ? " lethal" : ""}`)
    : "";
  return `
    <button
      class="choice-option card-choice-option combat-choice ${legal ? "" : "disabled-choice"}"
      data-action="choose-effect"
      data-choice="${optionId}"
      data-card-id="${info.cardId}"
      ${legal ? "" : "disabled"}
    >
      ${choiceOptionImage({ cardId: info.cardId })}
      <span>${card ? cardName(card) : (locale() === LOCALES.KO ? "유닛" : "Unit")}</span>
      <strong>${legal ? amountLabel : localizedDynamicText(info.reason, { fallback: "현재 이 대상에게 피해를 배정할 수 없습니다." })}</strong>
    </button>
  `;
}

function choiceOptionImage(option) {
  const cardId = typeof option === "string" ? option : option.cardId;
  const optionCard = typeof option === "object" ? option.card : null;
  const visibleCard = findVisibleCard(cardId);
  const card = option?.revealed && optionCard ? optionCard : (visibleCard && !visibleCard.redacted ? visibleCard : optionCard || visibleCard || null);
  if (!card && option.image) return `<span class="choice-card-art"><img src="${option.image}" alt="${localizedDynamicText(option.label || (locale() === LOCALES.KO ? "카드" : "Card"))}" loading="lazy" /></span>`;
  if (!card) return `<div class="choice-card-fallback">${localizedDynamicText(option.label || (locale() === LOCALES.KO ? "카드" : "Card"))}</div>`;
  if (!card.image) return `<div class="choice-card-fallback">${cardName(card)}</div>`;
  return `<span class="choice-card-art"><img src="${card.image}" alt="${cardName(card)}" loading="lazy" /></span>`;
}

function findVisibleCard(cardId) {
  if (!cardId) return null;
  const allAttachments = game.players.flatMap((player) => player.base)
    .concat(game.battlefields.flatMap((field) => field.units))
    .flatMap((card) => card.attachments || []);
  const pools = [
    ...game.players.flatMap((player) => [
      player.legend,
      player.champion,
      ...player.availableChampions,
      ...player.availableBattlefields,
      ...player.mainDeck,
      ...player.runeDeck,
      ...player.hand,
      ...player.base,
      ...player.runes,
      ...player.trash
      ,...(player.banished || [])
    ]),
    ...allAttachments,
    ...game.battlefields,
    ...game.battlefields.flatMap((field) => field.units),
    ...game.battlefields.flatMap((field) => (field.hidden || []).map((item) => item.card)),
    ...(game.showdown?.chain.map((item) => item?.card).filter(Boolean) || []),
    ...(game.actionChain?.chain.map((item) => item?.card).filter(Boolean) || [])
  ];
  return pools.find((card) => card?.instanceId === cardId || card?.id === cardId) || null;
}

function findChoicePreviewCard(cardId) {
  if (!cardId) return null;
  const choice = game.pendingChoice;
  return (choice?.data?.revealedCards || []).find((card) => card.instanceId === cardId)
    || (choice?.options || []).map((option) => option.card).find((card) => card?.instanceId === cardId)
    || findVisibleCard(cardId);
}

function isVisibleSelectableCard(cardId) {
  const card = findVisibleCard(cardId);
  return Boolean(card && !card.redacted);
}

function showdownPanel() {
  const showdown = game.showdown;
  const field = game.battlefields.find((candidate) => candidate.instanceId === showdown.battlefieldId);
  const chain = [...(showdown.chain || [])].filter(chainItemVisibleInTree).reverse();
  return `
    <section class="showdown-panel">
      <div class="section-head">
        <div>
          <h2>${t("showdown", locale())}: ${field ? battlefieldName(field) : t("battlefield", locale())}</h2>
          <span>${chain.length ? t("resolveChainFirst", locale()) : t("passToFight", locale())}</span>
        </div>
        <button class="primary" data-action="pass-showdown" ${viewerCanAct() ? "" : "disabled"}>${t("pass", locale())}</button>
      </div>
      <div class="chain-row">
        ${chain.map((item, index) => chainCard(item, index)).join("") || `<p class="empty">${t("chainEmpty", locale())}</p>`}
      </div>
    </section>
  `;
}

function chainCard(item, index) {
  const player = game.players.find((candidate) => candidate.id === item?.playerId);
  const card = item?.card || findVisibleCard(item?.trigger?.sourceCardId);
  const cardId = card?.instanceId || "";
  const motionClass = cardId && uiMotion.chained.has(cardId)
    ? (hasKeyword(card, "Ambush") ? "ambush-chain" : (card.tags?.includes("Reaction") ? "reaction-chain" : "chain-enter"))
    : "";
  const itemId = item?.id || `${cardId || "chain"}-${index}`;
  return `
    <button type="button" class="chain-card ${motionClass} ${inspectedChainItemId === itemId ? "is-inspected" : ""}" data-action="inspect-chain-effect" data-chain-item-id="${escapeHtml(itemId)}" data-card-id="${cardId}" title="${t("target", locale())}">
      <strong>${t(index === 0 ? "next" : "queued", locale())}</strong>
      <span>${chainItemTitle(item)}</span>
      <small>${player ? playerName(player) : ""} / ${localizedDynamicText(t(item?.status || "finalized", locale()))}</small>
    </button>
  `;
}

function chainZonePanel() {
  const counteredItems = [...effectAnimations.countered.values()];
  const items = currentChainTreeItems();
  const responding = responsePromptInfo();
  if (!items.length && !responding && !counteredItems.length) {
    chainZoneCollapsed = false;
    return "";
  }
  if (counteredItems.length) chainZoneCollapsed = false;
  return `
    <section class="chain-zone ${chainZoneCollapsed ? "is-collapsed" : ""} ${counteredItems.length ? "has-counter-animation" : ""}" aria-label="${t("processingQueue", locale())}" aria-live="polite">
      <div class="chain-zone-head">
        <div>
          <strong>${t("processingQueue", locale())}</strong>
          <span>${counteredItems.length ? t("countered", locale()) : items.length ? `${items.length} ${t("pending", locale())}` : t("responseWindow", locale())}</span>
          ${responding ? `<em>${t("youMayRespond", locale())}</em>` : ""}
        </div>
        <button type="button" class="chain-zone-toggle" data-action="toggle-chain-zone" aria-expanded="${chainZoneCollapsed ? "false" : "true"}" aria-controls="chain-zone-content">
          <span aria-hidden="true">${chainZoneCollapsed ? "▾" : "▴"}</span>
          ${t(chainZoneCollapsed ? "showChain" : "hideChain", locale())}
        </button>
      </div>
      <div id="chain-zone-content" class="chain-zone-content" ${chainZoneCollapsed ? "hidden" : ""}>
        <div class="chain-stack" data-scroll-key="chain-stack">
          ${counteredItems.map(counteredChainZoneItem).join("")}${items.map((item, index) => chainZoneItem(item, items.length - index)).join("") || `<p class="empty">${t("noChainItem", locale())}</p>`}
        </div>
        ${inspectedChainTargetPanel(items, responding)}
      </div>
    </section>
  `;
}

function currentChainTreeItems() {
  const chain = game.actionChain || game.showdown;
  const chainItems = chain ? [...normalizeUiChain(chain.chain)].reverse() : [];
  const activeTriggerChoice = game.pendingChoice?.data?.triggerId ? game.pendingChoice : null;
  const triggerItems = [
    ...(activeTriggerChoice ? [{
      id: activeTriggerChoice.data.triggerId,
      itemType: "trigger",
      playerId: activeTriggerChoice.playerId,
      card: activeTriggerChoice.card,
      trigger: {
        sourceCardId: activeTriggerChoice.card?.instanceId,
        kind: activeTriggerChoice.effect,
        data: activeTriggerChoice.data
      },
      status: "resolving"
    }] : []),
    ...(game.triggerQueue || []).map((trigger, index) => ({
      id: trigger.id || `queued-trigger-${index}`,
      itemType: "trigger",
      playerId: trigger.playerId,
      card: findVisibleCard(trigger.sourceCardId),
      trigger,
      status: trigger.status || "pending"
    }))
  ];
  return [...chainItems, ...triggerItems];
}

function syncInspectedChainTargets() {
  if (!inspectedChainItemId) {
    inspectedChainTargetIds.clear();
    return;
  }
  const item = currentChainTreeItems().find((candidate) => candidate.id === inspectedChainItemId);
  if (!item) {
    inspectedChainItemId = null;
    inspectedChainTargetIds.clear();
    return;
  }
  inspectedChainTargetIds = new Set(chainItemTargetIds(item));
}

function inspectedChainTargetPanel(items, responding) {
  const item = inspectedChainItemId
    ? items.find((candidate) => candidate.id === inspectedChainItemId)
    : null;
  if (!item && !responding) return "";
  const targets = item ? chainItemTargetIds(item) : [];
  const sourceCardId = item?.card?.instanceId || item?.trigger?.sourceCardId || "";
  return `
    <aside class="chain-context-panel ${item ? "showing-targets" : ""}" aria-live="polite">
      ${item ? `
        <section class="chain-target-panel">
          <div class="chain-target-head">
            <div>
              <span>${t("target", locale())}</span>
              <strong>${chainItemTitle(item)}</strong>
            </div>
            ${sourceCardId ? `<button type="button" class="secondary" data-action="view-chain-card" data-card-id="${escapeHtml(sourceCardId)}">${t("viewFullCard", locale())}</button>` : ""}
          </div>
          <div class="chain-target-list">
            ${targets.length
              ? targets.map(chainTargetCard).join("")
              : `<p class="chain-no-target">${t("noTargetDeclared", locale())}</p>`}
          </div>
        </section>
      ` : ""}
      ${responding ? responsePrompt(responding) : ""}
    </aside>
  `;
}

function chainTargetCard(targetId) {
  if (targetId === "base") {
    return `<div class="chain-target-card destination-target"><span>${t("target", locale())}</span><strong>${t("base", locale())}</strong></div>`;
  }
  const card = visibleChainTargetCard(targetId);
  if (!card) {
    return `<div class="chain-target-card destination-target"><span>${t("target", locale())}</span><strong>${escapeHtml(targetLabel(targetId))}</strong></div>`;
  }
  return `
    <button type="button" class="chain-target-card" data-action="focus-chain-target" data-card-id="${escapeHtml(targetId)}">
      ${card.image ? `<img src="${escapeHtml(card.image)}" alt="" loading="lazy" />` : `<span class="chain-target-fallback" aria-hidden="true">◎</span>`}
      <span><small>${t("target", locale())}</small><strong>${escapeHtml(cardName(card))}</strong></span>
    </button>
  `;
}

function counteredChainZoneItem(item) {
  const targets = (item.targetIds || []).map(targetLabel).filter(Boolean);
  return `
    <article class="chain-zone-item chain-zone-countered" aria-label="${escapeHtml(`${item.name} ${t("countered", locale())}`)}">
      <b>${playerPerspectiveLabel(item.playerId)}</b>
      <strong>${escapeHtml(localizedDynamicText(item.name))}</strong>
      <span>${t("source", locale())}: ${escapeHtml(localizedDynamicText(item.sourceName || item.name))}</span>
      ${targets.length ? `<small>${t("target", locale())}: ${targets.join(", ")}</small>` : ""}
      <em>${t("countered", locale())}</em>
      <i class="counter-slash" aria-hidden="true"></i>
    </article>
  `;
}

function normalizeUiChain(items = []) {
  return items.filter(chainItemVisibleInTree).map((item, index) => ({
    ...item,
    id: item.id || `${item.card?.instanceId || "chain"}-${index}`,
    status: item.status || "pending"
  }));
}

function chainItemVisibleInTree(item) {
  return chainItemVisibleToViewer(item, viewerPlayerId());
}

function chainZoneItem(item, order) {
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  const targets = chainItemTargetIds(item).map(targetLabel).filter(Boolean);
  const source = chainItemSourceTitle(item);
  const effectText = chainItemEffectText(item);
  const previewCardId = item.card?.instanceId || item.trigger?.sourceCardId || "";
  const itemClass = [
    "chain-zone-item",
    uiMotion.chained.has(item.card?.instanceId) ? "chain-zone-new" : "",
    inspectedChainItemId === item.id ? "is-inspected" : "",
    item.status ? `status-${item.status}` : ""
  ].filter(Boolean).join(" ");
  return `
    <button type="button" class="${itemClass}" data-action="inspect-chain-effect" data-chain-item-id="${escapeHtml(item.id)}" data-card-id="${previewCardId}" title="${t("target", locale())}">
      <b>[${order}] ${playerPerspectiveLabel(item.playerId)}</b>
      <strong>${chainItemTitle(item)}</strong>
      <span>${t("source", locale())}: ${source}</span>
      ${targets.length ? `<small>${t("target", locale())}: ${targets.join(", ")}</small>` : ""}
      ${effectText ? `<p class="chain-zone-effect">${escapeHtml(effectText)}</p>` : ""}
      <em>${localizedDynamicText(t(item.status || "pending", locale()))}</em>
    </button>
  `;
}

function chainItemEffectText(item) {
  const source = item?.itemType === "trigger"
    ? findVisibleCard(item.trigger?.sourceCardId) || item.card
    : item?.card;
  return source ? cardText(source) : (triggerKindLabel(item?.trigger) || "");
}

function realtimeFeedbackOverlay() {
  const feedback = recentFeedback;
  if (!feedback) return "";
  const targets = (feedback.targetIds || []).map(targetLabel).filter(Boolean);
  const sourceZone = feedback.sourceZone ? `${t("from", locale())}: ${sourceZoneLabel(feedback.sourceZone)}` : "";
  return `
    <section class="realtime-feedback ${feedback.kind} persistent-feedback" aria-live="polite">
      <button type="button" class="feedback-dismiss" data-action="dismiss-feedback" aria-label="${t("close", locale())}">×</button>
      <span>${feedback.title}</span>
      <strong>${localizedDynamicText(feedback.name)}</strong>
      ${sourceZone ? `<em>${sourceZone}</em>` : ""}
      ${targets.length ? `<small>${t("target", locale())}: ${targets.join(", ")}</small>` : ""}
      ${feedback.result ? `<p>${localizedLogEntry(feedback.result)}</p>` : ""}
    </section>
  `;
}

function responsePromptInfo() {
  const chain = game.actionChain || (game.phase === "showdown" ? game.showdown : null);
  if (!chain || !viewerCanAct() || chain.priorityPlayerId !== viewerPlayerId() || game.pendingChoice || game.pendingPayment) return null;
  const latest = [...normalizeUiChain(chain.chain)].reverse()[0] || null;
  if (!latest) return { title: t("responseWindow", locale()), detail: t("responseHint", locale()) };
  const targets = chainItemTargetIds(latest).map(targetLabel).filter(Boolean);
  return {
    title: `${playerPerspectiveLabel(latest.playerId)} ${t(latest.itemType === "activated" ? "activatedVerb" : latest.itemType === "trigger" ? "triggeredVerb" : "playedVerb", locale())} ${chainItemTitle(latest)}`,
    detail: targets.length ? `${t("target", locale())}: ${targets.join(", ")}` : t("noTargetDeclared", locale()),
    cardId: latest.card?.instanceId
  };
}

function responsePrompt(info) {
  return `
    <div class="response-prompt">
      <strong>${info.title}</strong>
      <span>${info.detail}</span>
      <div class="actions inline">
        <button class="primary" data-action="toggle-hand">${handOpen ? t("hideHand", locale()) : t("playReaction", locale())}</button>
        <button data-action="pass-showdown">${t("pass", locale())}</button>
      </div>
    </div>
  `;
}

function chainItemTitle(item) {
  if (!item) return t("effect", locale());
  if (item.itemType === "trigger") return item.card ? cardName(item.card) : (item.trigger?.label || triggerLabel(item.trigger) || t("triggeredAbility", locale()));
  if (item.itemType === "activated") return `${item.card ? cardName(item.card) : t("selectedCard", locale())} ${t("ability", locale())}`;
  return item.card ? cardName(item.card) : t("selectedCard", locale());
}

function chainItemSourceTitle(item) {
  if (!item) return t("effect", locale());
  if (item.itemType === "trigger") {
    const source = findVisibleCard(item.trigger?.sourceCardId);
    return source ? cardName(source) : (triggerKindLabel(item.trigger) || t("triggeredAbility", locale()));
  }
  return item.card ? cardName(item.card) : t("effect", locale());
}

function chainItemTargetIds(item) {
  const targets = collectChainTargetIds(item);
  if (item?.destination && !targets.includes(item.destination)) targets.push(item.destination);
  return targets;
}

function visibleChainTargetCard(cardId) {
  const card = findVisibleCard(cardId);
  if (!card || card.redacted) return null;
  const context = selectedContext(cardId);
  const privateZones = new Set(["hand", "main-deck", "rune-deck", "hidden", "champion-choice"]);
  if (context?.playerId && context.playerId !== viewerPlayerId() && privateZones.has(context.zone)
    && !canViewPrivateInfo(viewerPlayerId(), context.playerId)) return null;
  return card;
}

function targetLabel(cardId) {
  if (!cardId) return "";
  if (cardId === "base") return t("base", locale());
  const card = visibleChainTargetCard(cardId);
  if (card) return cardName(card);
  const context = selectedContext(cardId);
  if (context?.zone === "hidden") return t("hiddenZone", locale());
  return locale() === LOCALES.KO ? "공개되지 않은 대상" : "Undisclosed target";
}

function playerPerspectiveLabel(playerId) {
  if (playerId === viewerPlayerId()) return t("you", locale());
  const player = game.players.find((candidate) => candidate.id === playerId);
  return isOnlineGame() ? t("opponent", locale()) : (player ? playerName(player) : t("opponent", locale()));
}

function sourceZoneLabel(zone) {
  const labels = {
    hand: t("hand", locale()),
    hidden: t("hiddenZone", locale()),
    legend: t("legend", locale()),
    champion: t("champion", locale()),
    base: t("base", locale()),
    battlefield: t("battlefield", locale()),
    mainDeck: t("mainDeck", locale()),
    runeDeck: t("runeDeck", locale()),
    chain: t("chain", locale())
  };
  return labels[zone] || localizedDynamicText(zone);
}

function triggerQueuePanel() {
  const queued = game.triggerQueue || [];
  const activeChoice = game.pendingChoice?.data?.triggerId ? game.pendingChoice : null;
  if (!queued.length && !activeChoice) return "";
  return `
    <section class="trigger-panel">
      <div class="section-head">
        <div>
          <h2>${t("triggers", locale())}</h2>
          <span>${activeChoice ? t("resolvingTrigger", locale()) : `${queued.length} ${t("queued", locale())}`}</span>
        </div>
      </div>
      <div class="trigger-row">
        ${activeChoice ? triggerChip({ label: cardName(activeChoice.card) || t("triggers", locale()), owner: t("resolving", locale()), sourceCardId: activeChoice.card?.instanceId }) : ""}
        ${queued.map((trigger, index) => triggerChip({
          label: triggerLabel(trigger),
          owner: index === 0 ? t("next", locale()) : t("queued", locale()),
          status: localizedDynamicText(trigger.status || t("finalized", locale())),
          sourceCardId: trigger.sourceCardId
        })).join("")}
      </div>
    </section>
  `;
}

function triggerLabel(trigger) {
  const source = findVisibleCard(trigger.sourceCardId);
  return source ? cardName(source) : (triggerKindLabel(trigger) || t("triggers", locale()));
}

function triggerKindLabel(trigger) {
  const labels = {
    showdownBeginsPayEnergyPredictDrawSpell: t("showdownTrigger", locale()),
    defendHereRevealTopSpell: t("defendTrigger", locale()),
    scoreGainXp: t("scoringTrigger", locale()),
    holdDraw: t("holdTrigger", locale()),
    conquerHereReadyRunesEndTurn: t("conquerTrigger", locale()),
    attackOrDefendBuffXp: t("combatTrigger", locale()),
    firstBeginningGainPoint: t("beginningTrigger", locale()),
    endTurnReadyRunes: t("endTurnTrigger", locale()),
    battlefieldSpellBuff: t("battlefieldTrigger", locale()),
    spellPlayedSelfBuff: t("spellTrigger", locale())
  };
  if (trigger?.kind?.startsWith("death")) return t("deathknellTrigger", locale());
  return labels[trigger?.kind] || null;
}

function triggerChip(item) {
  return `
    <article class="trigger-chip" ${item.sourceCardId ? `data-card-id="${item.sourceCardId}"` : ""}>
      <strong>${item.owner}</strong>
      <span>${item.label}</span>
      ${item.status ? `<small>${localizedDynamicText(item.status)}</small>` : ""}
    </article>
  `;
}

function setupPanel() {
  const selectingPlayer = game.players.find((player) => player.id === game.setupPlayerId);
  if (!setupSelectionVisibleToViewer(selectingPlayer?.id)) {
    return privateSetupWaitingPanel(selectingPlayer);
  }
  const visiblePlayers = aiMode
    ? game.players.filter((player) => player.id === viewerPlayerId())
    : game.players;
  return `
    <section class="setup">
      ${visiblePlayers.map((player) => `
        <article class="setup-player ${player.id === game.setupPlayerId ? "active" : ""}">
          <div class="section-head">
            <div>
              <h2>${playerName(player)}</h2>
              <span>${cardName(player.legend)} / ${cardName(player.champion)}</span>
            </div>
          </div>
          <div class="identity-row">
            ${imageCard(player.legend, "select-only")}
            ${imageCard(player.champion, "select-only")}
          </div>
          ${battlefieldSelectionContent(player)}
        </article>
      `).join("")}
    </section>
  `;
}

function battlefieldSelectionContent(player) {
  return `
    <h3>${t("battlefieldChoices", locale())}</h3>
    <div class="cards">
      ${player.availableBattlefields.map((field) => battlefieldChoice(player, field)).join("")}
    </div>
  `;
}

function championSelectPanel() {
  const selectingPlayer = game.players.find((player) => player.id === game.championSelectPlayerId);
  if (!setupSelectionVisibleToViewer(selectingPlayer?.id)) {
    return privateSetupWaitingPanel(selectingPlayer, "champion-setup");
  }
  const visiblePlayers = aiMode
    ? game.players.filter((player) => player.id === viewerPlayerId())
    : game.players;
  return `
    <section class="setup champion-setup">
      ${visiblePlayers.map((player) => `
        <article class="setup-player ${player.id === game.championSelectPlayerId ? "active" : ""}">
          <div class="section-head">
            <div>
              <h2>${playerName(player)}</h2>
              <span>${cardName(player.legend)}</span>
            </div>
          </div>
          <div class="identity-row">
            ${imageCard(player.legend, "select-only")}
          </div>
          <h3>${t("championChoices", locale())}</h3>
          <div class="cards champion-cards">
            ${player.champion ? selectedChampionChoice(player) : player.availableChampions.map((champion) => championChoice(player, champion)).join("")}
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function championChoice(player, champion) {
  const legendTags = new Set((player.legend?.tags || []).filter((tag) => !["Champion", "Signature", "Signature Spell", "Action", "Reaction", "Unit", "Spell", "Gear"].includes(tag)));
  const matchesLegend = (champion.tags || []).some((tag) => legendTags.has(tag));
  const disabled = !matchesLegend || game.championSelectPlayerId !== player.id || (isOnlineGame() && player.id !== viewerPlayerId()) || !viewerCanAct() || champion.redacted;
  return `
    <article class="image-card champion-choice" data-card-id="${champion.instanceId}">
      ${cardImage(champion)}
      <button data-action="choose-champion" data-player="${player.id}" data-card="${champion.instanceId}" ${disabled ? "disabled" : ""}>
        ${t("choose", locale())}
      </button>
    </article>
  `;
}

function selectedChampionChoice(player) {
  return `
    <article class="image-card champion-choice chosen" data-card-id="${player.champion.instanceId}">
      ${cardImage(player.champion)}
      <button disabled>${t("chosen", locale())}</button>
    </article>
  `;
}

function battlefieldChoice(player, field) {
  const selected = player.selectedBattlefieldId === field.instanceId;
  const disabled = game.setupPlayerId !== player.id || selected || (isOnlineGame() && player.id !== viewerPlayerId()) || !viewerCanAct() || field.redacted;
  return `
    <article class="image-card battlefield-choice ${selected ? "chosen" : ""}" data-card-id="${field.instanceId}">
      ${cardImage(field)}
      <button data-action="choose-battlefield" data-player="${player.id}" data-battlefield="${field.instanceId}" ${disabled ? "disabled" : ""}>
        ${selected ? t("chosen", locale()) : t("choose", locale())}
      </button>
    </article>
  `;
}

function mulliganPanel() {
  const player = game.players.find((candidate) => candidate.id === game.mulligan?.playerId);
  const selected = new Set(game.mulligan?.selectedCardIds || []);
  if ((isOnlineGame() && player?.id !== viewerPlayerId()) || !setupSelectionVisibleToViewer(player?.id)) {
    return `
      <section class="mulligan">
        <article class="mulligan-player active waiting">
          <div class="section-head">
            <div>
              <h2>${player ? playerName(player) : t("opponentSide", locale())}</h2>
              <span>${t("opponentMulligan", locale())}</span>
            </div>
          </div>
        </article>
      </section>
    `;
  }
  return `
    <section class="mulligan">
      <article class="mulligan-player active">
        <div class="section-head">
          <div>
            <h2>${playerName(player)}</h2>
            <span>${t("mulliganInstruction", locale())}</span>
          </div>
          <div class="actions inline">
            <button data-action="skip-mulligan">${t("keepHand", locale())}</button>
            <button class="primary" data-action="confirm-mulligan">${t("mulliganCount", locale(), { n: selected.size })}</button>
          </div>
        </div>
        <div class="cards mulligan-hand">
          ${player.hand.map((card) => mulliganCard(card, selected.has(card.instanceId))).join("")}
        </div>
      </article>
    </section>
  `;
}

function setupSelectionVisibleToViewer(playerId) {
  if (!playerId) return true;
  return pendingDecisionVisibleToViewer({
    aiMode,
    viewerPlayerId: viewerPlayerId(),
    decision: { playerId }
  });
}

function privateSetupWaitingPanel(player, panelClass = "") {
  const name = player ? playerName(player) : t("opponentSide", locale());
  return `
    <section class="setup ${panelClass} private-setup-waiting">
      <article class="setup-player active">
        <div class="setup-hidden-choice">
          <strong>${t("waiting", locale())}</strong>
          <span>${t("playerIsChoosing", locale(), { name })}</span>
        </div>
      </article>
    </section>
  `;
}

function mulliganCard(card, selected) {
  return `
    <article class="${imageCardClass(card, `mulligan-card ${selected ? "chosen" : ""}`)}" data-card-id="${card.instanceId}">
      ${cardImage(card)}
      <button class="secondary" data-action="view-choice-card" data-card-id="${card.instanceId}">${t("viewFullCard", locale())}</button>
      <button data-action="toggle-mulligan-card" data-card="${card.instanceId}">
        ${selected ? t("selected", locale()) : t("select", locale())}
      </button>
    </article>
  `;
}

function playerSide(player, side) {
  const baseTarget = targetAttributes("base", player.id);
  const acting = activePlayerId() === player.id;
  const intel = canViewPrivateInfo(viewerPlayerId(), player.id);
  const handGlow = uiMotion.sourceZones.has(`${player.id}:hand`) ? "source-hand-glow" : "";
  const drawAnimation = effectAnimations.draws.get(player.id);
  const baseDeaths = unitDeathGhosts("base", player.id);
  return `
    <section class="player-side ${side} owner-${player.id} ${acting ? "acting-player" : ""} ${handGlow}">
      <div class="player-identity">
        <div class="identity-mini">
          ${miniIdentity(player.legend)}
          ${miniIdentity(player.champion, player)}
        </div>
        <div class="player-summary">
          <h2>${playerName(player)}</h2>
          <div class="player-stats" data-scroll-key="player-stats-${player.id}">
            <span class="xp-stat">${t("level", locale())} ${player.xp || 0}</span>
            <span class="deck-stat" data-effect="${drawAnimation ? "draw" : ""}" aria-label="${t("deck", locale())} ${player.mainDeck.length}">${t("deck", locale())} <b>${player.mainDeck.length}</b></span>
            ${(player.burnOuts || 0) > 0 ? `<span class="burnout-stat" title="${locale() === LOCALES.KO ? "소진될 때마다 상대가 1점을 획득합니다." : "Each Burn Out gives an opponent 1 point."}">${locale() === LOCALES.KO ? "소진" : "Burn Out"} <b>${player.burnOuts}</b></span>` : ""}
            <span class="hand-stat">${t("hand", locale())} ${handCountVisibleToViewer(game, player, viewerPlayerId())}</span>
            <button class="trash-button" data-action="toggle-graveyard" data-player="${player.id}" title="${t("viewTrashTitle", locale(), { name: playerName(player) })}">
              ${t("trash", locale())} ${player.trash.length}
            </button>
            <button class="trash-button banished-button" data-action="toggle-banished" data-player="${player.id}" title="${t("viewBanishedTitle", locale(), { name: playerName(player) })}">
              ${t("banished", locale())} ${(player.banished || []).length}
            </button>
            ${intel ? `<button class="intel-button" data-action="toggle-intel" data-player="${player.id}">${t("intel", locale())}</button>` : ""}
          </div>
          ${championPanelStatus(player)}
        </div>
      </div>
      <div class="resource-zone">
        <span class="zone-caption">${t("runes", locale())}</span>
        ${runeSummary(player)}
        <div class="resource-row">
          ${player.runes.map(runeChip).join("")}
        </div>
      </div>
      <div class="base-zone">
        <span class="zone-caption">${t("base", locale())}</span>
        <div class="base-row ${baseTarget.className}" data-scroll-key="base-${player.id}" ${baseTarget.attrs}>
          ${player.base.map((card) => boardCard(card, "base")).join("")}${baseDeaths || (!player.base.length ? `<p class="empty">${t("baseEmpty", locale())}</p>` : "")}
        </div>
      </div>
    </section>
  `;
}

function miniIdentity(card, player = null) {
  if (!card) return "";
  const championState = player && ["champion", "played"].includes(player.champion?.zone)
    && card?.instanceId === player.champion?.instanceId
    ? player.championPlayed || player.champion.zone === "played" ? " deployed" : " ready"
    : "";
  const exhausted = card?.exhausted ? " exhausted" : "";
  const sourceGlow = uiMotion.sourceIds.has(card?.instanceId) ? " source-card-glow" : "";
  const chainTarget = chainTargetClass(card?.instanceId) ? " chain-effect-target" : "";
  return `
    <button class="identity-button${championState}${exhausted}${sourceGlow}${chainTarget}" data-action="select-card" data-card="${card.instanceId}" title="${cardName(card)}">
      <img src="${card.image}" alt="${cardName(card)}" loading="lazy" />
      ${championState || exhausted ? `<span>${card.exhausted ? t("spent", locale()) : championState.trim() === "deployed" ? t("used", locale()) : t("zone", locale())}</span>` : ""}
    </button>
  `;
}

function championPanelStatus(player) {
  if (!player.champion) return "";
  if (!["champion", "played"].includes(player.champion.zone)) return "";
  const deployed = player.championPlayed || player.champion.zone === "played";
  const mine = viewerPlayerId() === player.id;
  const canUse = mine && !deployed && uiLegalActions.some((action) => action.kind === "beginPlayChampion");
  const reason = deployed
    ? t("alreadyUsed", locale())
    : !mine
      ? t("opponentChampion", locale())
      : game.phase !== "action" && game.phase !== "showdown"
        ? t("notActionPhase", locale())
        : !canUse
          ? t("needCost", locale())
          : t("readyState", locale());
  return `
    <div class="champion-control ${deployed ? "deployed" : canUse ? "ready" : "disabled"}">
      <span>${deployed ? t("championUsed", locale()) : t("championZone", locale())}</span>
      ${canUse
        ? `<button data-action="select-card" data-card="${player.champion.instanceId}">${t("useChampion", locale())}</button>`
        : `<small>${reason}</small>`}
    </div>
  `;
}

function battlefieldColumns() {
  return visibleBattlefields().map(battlefieldCard).join("");
}

function battlefieldCard(field) {
  const controller = battlefieldStatus(field);
  const [topPlayer, bottomPlayer] = [opponentPlayer(), viewerPlayer()];
  const topUnits = field.units.filter((unit) => unit.controllerId === topPlayer.id);
  const bottomUnits = field.units.filter((unit) => unit.controllerId === bottomPlayer.id);
  const topHidden = (field.hidden || []).filter((item) => hiddenCardIsControlledBy(item, topPlayer.id));
  const bottomHidden = (field.hidden || []).filter((item) => hiddenCardIsControlledBy(item, bottomPlayer.id));
  const topTarget = targetAttributes(field.instanceId, topPlayer.id);
  const bottomTarget = targetAttributes(field.instanceId, bottomPlayer.id);
  const showdownActive = game.phase === "showdown" && game.showdown?.battlefieldId === field.instanceId;
  return `
    <article class="battlefield location-column ${showdownActive ? "showdown-location" : ""} ${chainTargetClass(field.instanceId)}" data-card-id="${field.instanceId}">
      <div class="field-lane top-lane ${topTarget.className}" data-scroll-key="field-${field.instanceId}-${topPlayer.id}" ${topTarget.attrs}>
        <span class="lane-label">${t("opponentUnits", locale())}</span>
        <div class="field-lane-track">
          ${battlefieldLaneContents(topPlayer, field, topUnits, topHidden, "top")}
        </div>
      </div>
      <div class="field-center location-card">
        <div class="field-image">${cardImage(field)}</div>
        <div class="battlefield-head">
          <h2>${battlefieldName(field)}</h2>
          <span>${controller}</span>
        </div>
      </div>
      <div class="field-lane bottom-lane ${bottomTarget.className}" data-scroll-key="field-${field.instanceId}-${bottomPlayer.id}" ${bottomTarget.attrs}>
        <span class="lane-label">${t("yourUnits", locale())}</span>
        <div class="field-lane-track">
          ${battlefieldLaneContents(bottomPlayer, field, bottomUnits, bottomHidden, "bottom")}
        </div>
      </div>
    </article>
  `;
}

function emptyBattlefieldColumn(index) {
  return `
    <article class="battlefield location-column empty-location" aria-label="${locale() === LOCALES.KO ? `빈 전장 칸 ${index}` : `Empty battlefield slot ${index}`}">
      <div class="field-lane top-lane">
        <span class="lane-label">${t("opponentUnits", locale())}</span>
        <div class="field-lane-track">
          <span class="unit-placeholder">${t("noUnits", locale())}</span>
        </div>
      </div>
      <div class="field-center location-card placeholder-location-card">
        <div class="field-image placeholder">
          <span>${t("locationSlot", locale())}</span>
        </div>
        <div class="battlefield-head">
          <h2>${t("openLocation", locale())}</h2>
          <span>${t("noBattlefield", locale())}</span>
        </div>
      </div>
      <div class="field-lane bottom-lane">
        <span class="lane-label">${t("yourUnits", locale())}</span>
        <div class="field-lane-track">
          <span class="unit-placeholder">${t("noUnits", locale())}</span>
        </div>
      </div>
    </article>
  `;
}

function battlefieldStatus(field) {
  if (field.controlledBy) {
    const controller = game.players.find((player) => player.id === field.controlledBy);
    return locale() === LOCALES.KO ? `${controller ? playerName(controller) : "플레이어"}님이 지배 중` : `${controller?.name || "Player"} controls`;
  }
  const controllers = [...new Set(field.units.map((unit) => unit.controllerId))];
  if (controllers.length > 1) return locale() === LOCALES.KO ? "경합 중" : "Contested";
  if (controllers.length === 1) {
    const occupant = game.players.find((player) => player.id === controllers[0]);
    return locale() === LOCALES.KO ? `${occupant ? playerName(occupant) : "플레이어"}님이 주둔 중` : `${occupant?.name || "Player"} present`;
  }
  return t("uncontrolled", locale());
}

function battlefieldLaneContents(player, field, units, hiddenItems, side) {
  const unitCards = units.map((unit) => boardCard(unit, field.instanceId)).join("");
  const hiddenCards = hiddenItems.map((item) => hiddenCardBack(item, field, side)).join("");
  const deathGhosts = unitDeathGhosts(field.instanceId, player.id);
  if (!unitCards && !hiddenCards && !deathGhosts) return `<span class="unit-placeholder">${t("dropUnitHere", locale())}</span>`;
  return `${side === "top" ? hiddenCards : ""}${unitCards}${deathGhosts}${side === "bottom" ? hiddenCards : ""}`;
}

function hiddenCardBack(item, field) {
  const controllerId = hiddenCardControllerId(item);
  const controlledByViewer = viewerPlayerId() === controllerId;
  const visibleByIntel = canViewPrivateInfo(viewerPlayerId(), controllerId);
  const playable = hiddenPlayable(item, field);
  const sourceGlow = uiMotion.sourceIds.has(item.card.instanceId) ? " source-card-glow hidden-reveal-glow" : "";
  const targetGlow = uiMotion.targetIds.has(item.card.instanceId) ? " target-card-glow" : "";
  const chainTarget = chainTargetClass(item.card.instanceId) ? " chain-effect-target" : "";
  if (controlledByViewer) {
    return `
      <button class="hidden-card-back hidden-card-owned owner-${item.ownerId} ${playable ? "usable-card" : ""}${sourceGlow}${targetGlow}${chainTarget}" data-action="select-card" data-card="${item.card.instanceId}" data-card-id="${item.card.instanceId}" title="${cardName(item.card)}">
        ${cardImage(item.card)}
        <span class="hidden-label">${t("hiddenZone", locale())}</span>
      </button>
    `;
  }
  if (visibleByIntel && !controlledByViewer) {
    return `
      <article class="${imageCardClass(item.card, `hidden-revealed owner-${item.ownerId}${sourceGlow}${targetGlow}${chainTarget}`)}" data-card-id="${item.card.instanceId}" title="${cardName(item.card)}">
        ${cardImage(item.card)}
        <span class="status-line">${t("revealed", locale())}</span>
      </article>
    `;
  }
  const attrs = `title="${t("hiddenZone", locale())}" aria-label="${t("opponentHiddenCard", locale())}"`;
  return `
    <button class="hidden-card-back owner-${item.ownerId} locked-hidden ${playable ? "usable-card" : ""}${sourceGlow}${targetGlow}${chainTarget}" ${attrs}>
      <span class="card-back-mark">H</span>
      <span class="hidden-label">${controlledByViewer ? t("hiddenZone", locale()) : t("setHidden", locale())}</span>
    </button>
  `;
}

function canViewPrivateInfo(viewerId, ownerId) {
  if (!viewerId || !ownerId || viewerId === ownerId) return false;
  return Boolean((game.revealedIntel || []).some((item) =>
    item.viewerId === viewerId && item.ownerId === ownerId && item.expiresAtTurnSequence === game.turnSequence
  ));
}

function viewerPlayerId() {
  if (replayMode) return replayBrowser.viewerPlayerId || "p1";
  if (isOnlineGame() && online.playerId) return online.playerId;
  if (aiMode && aiHumanPlayerId) return aiHumanPlayerId;
  return currentPlayer(game)?.id || game.players[0]?.id;
}

function viewerPlayer() {
  return game.players.find((player) => player.id === viewerPlayerId()) || currentPlayer(game) || game.players[0];
}

function opponentPlayer() {
  const viewerId = viewerPlayerId();
  return game.players.find((player) => player.id !== viewerId) || game.players[1] || game.players[0];
}

function viewerCanAct() {
  if (replayMode) return false;
  if (online.commandPending) return false;
  if (aiMode) return activePlayerId() === aiHumanPlayerId && !aiThinking;
  if (!isOnlineGame()) return true;
  return activePlayerId() === viewerPlayerId();
}

function visibleBattlefields() {
  const fields = [...game.battlefields];
  return viewerPlayerId() === game.players[1]?.id ? fields.reverse() : fields;
}

function activePlayerId() {
  if (isOnlineGame() && game.authoritativeActorId) return game.authoritativeActorId;
  if (game.phase === "first-player") return firstPlayerDecisionActorId(game);
  if (game.pendingPayment?.playerId) return game.pendingPayment.playerId;
  if (game.pendingChoice?.playerId) return game.pendingChoice.playerId;
  if (game.phase === "champion-select") return game.championSelectPlayerId;
  if (game.phase === "battlefield-select") return game.setupPlayerId;
  if (game.phase === "mulligan") return game.mulligan?.playerId || null;
  if (game.actionChain?.priorityPlayerId) return game.actionChain.priorityPlayerId;
  if (game.phase === "showdown" && game.showdown?.priorityPlayerId) return game.showdown.priorityPlayerId;
  return game.currentPlayerId;
}

function actingPlayerClass() {
  const id = activePlayerId();
  if (!id) return "";
  const index = game.players.findIndex((player) => player.id === id);
  return index === 0 ? "acting-bottom" : index === 1 ? "acting-top" : "";
}

function championCard(player) {
  if (!player.champion) return "";
  if (!["champion", "played"].includes(player.champion.zone)) return "";
  if (player.championPlayed || player.champion.zone === "played") {
    return `
      <article class="champion-zone-slot champion-zone-used" aria-label="${locale() === LOCALES.KO ? `${cardName(player.champion)} 챔피언을 사용했습니다` : `${player.champion.name} has been played`}">
        <span class="zone-label">${t("championZone", locale())}</span>
        ${cardImage(player.champion)}
        <span class="status-line">${t("deployed", locale())}</span>
      </article>
    `;
  }
  return `
    <article class="${imageCardClass(player.champion, `champion-zone ${motionCardClass(player.champion, "hand")}`)}" data-card-id="${player.champion.instanceId}">
      <span class="zone-label">${t("championZone", locale())}</span>
      ${cardImage(player.champion)}
    </article>
  `;
}

function handCard(card) {
  return `
    <article class="${imageCardClass(card, `${card.type} ${motionCardClass(card, "hand")}`)}" data-card-id="${card.instanceId}" role="button" tabindex="0" aria-label="${escapeHtml(cardName(card))}">
      ${cardImage(card)}
    </article>
  `;
}

function visibleCardStatuses(card) {
  return cardStatusItems(card, {
    locale: locale(),
    keywordLabel: (keyword) => keywordText([keyword]),
    cardLabel: (name) => localizedDynamicText(name),
    domainLabel: (domain) => domainText(domain)
  });
}

function cardStatusBadges(card) {
  const statuses = visibleCardStatuses(card)
    .filter((status) => !["stunned", "exhausted", "damage", "attachments", "attacker", "defender"].includes(status.kind));
  if (!statuses.length) return "";
  const visible = statuses.slice(0, 2);
  const remaining = statuses.length - visible.length;
  const summary = statuses.map((status) => status.badge).join(", ");
  return `
    <span class="unit-state-badges" aria-label="${escapeHtml(locale() === LOCALES.KO ? `적용 상태: ${summary}` : `Active statuses: ${summary}`)}" title="${escapeHtml(summary)}">
      ${visible.map((status) => `<span class="unit-state-badge tone-${status.tone}">${escapeHtml(status.badge)}</span>`).join("")}
      ${remaining > 0 ? `<span class="unit-state-badge more">${locale() === LOCALES.KO ? `외 ${remaining}` : `+${remaining} more`}</span>` : ""}
    </span>
  `;
}

function cardStatusClassNames(card) {
  return visibleCardStatuses(card)
    .filter((status) => ["stunned", "empowered", "buff", "temporaryMight", "lastingMight", "keywords", "cannotMove"].includes(status.kind))
    .map((status) => `status-${status.kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
    .join(" ");
}

function cardStatusPanel(card, { compact = false } = {}) {
  const statuses = visibleCardStatuses(card);
  const isUnit = card.type === "unit";
  const printedMight = Number(card.might) || 0;
  const boardMight = isUnit ? currentMight(game, card) : 0;
  const stateTitle = locale() === LOCALES.KO ? "현재 카드 상태" : "Current card status";
  const stateCount = statuses.length
    ? (locale() === LOCALES.KO ? `${statuses.length}개 효과 적용 중` : `${statuses.length} active effects`)
    : (locale() === LOCALES.KO ? "추가 효과 없음" : "No additional effects");
  const sourceLabel = locale() === LOCALES.KO ? "출처" : "Source";
  return `
    <section class="card-status-panel ${compact ? "compact" : ""}" aria-label="${stateTitle}">
      <div class="card-status-heading">
        <strong>${stateTitle}</strong>
        <span>${stateCount}</span>
      </div>
      ${isUnit ? `
        <div class="might-breakdown" aria-label="${locale() === LOCALES.KO ? "현재 위력 계산" : "Current Might calculation"}">
          <span>${locale() === LOCALES.KO ? "기본" : "Base"} <b>${printedMight}</b></span>
          ${(card.buffs || 0) ? `<span class="positive">${locale() === LOCALES.KO ? "버프" : "Buff"} <b>+${card.buffs}</b></span>` : ""}
          ${(card.mightModifier || 0) ? `<span class="${card.mightModifier > 0 ? "positive" : "negative"}">${locale() === LOCALES.KO ? "변경" : "Modifier"} <b>${card.mightModifier > 0 ? "+" : ""}${card.mightModifier}</b></span>` : ""}
          <span class="current">${locale() === LOCALES.KO ? "현재" : "Current"} <b>${boardMight}</b></span>
        </div>
      ` : ""}
      ${statuses.length ? `
        <div class="card-status-list">
          ${statuses.map((status) => `
            <article class="card-status-item tone-${status.tone}">
              <span class="card-status-icon" aria-hidden="true">${status.tone === "negative" ? "!" : status.tone === "positive" ? "+" : status.tone === "warning" ? "◆" : "•"}</span>
              <div>
                <strong>${escapeHtml(status.badge)}</strong>
                <p>${escapeHtml(status.detail)}</p>
                <small>${escapeHtml(status.duration)}${status.source ? ` · ${sourceLabel}: ${escapeHtml(status.source)}` : ""}</small>
              </div>
            </article>
          `).join("")}
        </div>
      ` : `<p class="card-status-empty">${locale() === LOCALES.KO ? "이 카드에는 현재 기절, 버프, 위력 변경, 추가 키워드 같은 효과가 적용되어 있지 않습니다." : "This card currently has no stun, buff, Might modifier, or granted keyword."}</p>`}
    </section>
  `;
}

function unitDeathGhosts(location, playerId) {
  return [...effectAnimations.deaths.values()]
    .filter((unit) => unit.location === location && unit.playerId === playerId)
    .map(unitDeathGhost)
    .join("");
}

function unitDeathGhost(unit) {
  const label = locale() === LOCALES.KO ? `${unit.name} 처치됨` : `${unit.name} defeated`;
  const art = unit.image
    ? `<img src="${escapeHtml(unit.image)}" alt="" />`
    : `<span>${escapeHtml(unit.name)}</span>`;
  return `
    <article class="unit-token unit-death-ghost owner-${unit.ownerId}" aria-label="${escapeHtml(label)}">
      <div class="death-ghost-copy">
        <div class="unit-token-art">${art}</div>
        <div class="unit-token-body"><strong>${escapeHtml(unit.name)}</strong><span>${locale() === LOCALES.KO ? "처치됨" : "Defeated"}</span></div>
      </div>
      <div class="death-fragments" aria-hidden="true">
        ${["one", "two", "three", "four"].map((part) => `<span class="death-fragment fragment-${part}">${art}</span>`).join("")}
      </div>
    </article>
  `;
}

function unitMightAnimation(card) {
  return effectAnimations.mightChanges.get(card.instanceId) || null;
}

function unitMightAnimationClass(card) {
  const animation = unitMightAnimation(card);
  if (!animation) return "";
  return animation.delta > 0 ? "effect-might-up" : "effect-might-down";
}

function unitMightCue(card) {
  const animation = unitMightAnimation(card);
  if (!animation) return "";
  const sign = animation.delta > 0 ? "+" : "";
  const label = locale() === LOCALES.KO ? "위력" : "Might";
  return `<span class="unit-might-cue" aria-label="${escapeHtml(`${label} ${sign}${animation.delta}`)}"><b>${sign}${animation.delta}</b><small>${label}</small></span>`;
}

function boardCard(card, location) {
  const flashed = isFlashed(card.instanceId);
  const owner = game.players.find((player) => player.id === card.ownerId);
  const motion = motionCardClass(card, "board");
  const attachments = card.type === "unit" ? (card.attachments || []) : [];
  if (location === "base") return baseToken(card, location, owner, motion, attachments, flashed);
  if (card.type === "unit") return unitToken(card, location, owner, motion, attachments, flashed);
  return `
    <article class="${imageCardClass(card, `${card.type} owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : ""} ${flashed ? "effect-flash" : ""} ${motion}`)}" data-card-id="${card.instanceId}" data-location="${location}">
      <span class="owner-chip">${owner ? playerName(owner) : card.ownerId}</span>
      ${moveSelectButton(card)}
      ${cardImage(card)}
      ${attachmentStrip(attachments)}
      ${statusLine(card)}
    </article>
  `;
}

function baseToken(card, location, owner, motion, attachments, flashed) {
  const domain = domainText(card.domains?.[0]) || (card.tags?.[0] ? keywordText([card.tags[0]]) : cardType(card));
  const state = card.stunned ? t("stunned", locale()) : card.exhausted ? t("exhausted", locale()) : t("readyState", locale());
  const mainBadge = card.type === "unit" ? `${t("might", locale())} ${currentMight(game, card)}` : cardType(card);
  return `
    <article class="unit-token base-token ${card.type}-token owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : "ready"} ${cardStatusClassNames(card)} ${unitMightAnimationClass(card)} ${chainTargetClass(card.instanceId)} ${flashed ? "effect-flash" : ""} ${motion}" data-card-id="${card.instanceId}" data-location="${location}">
      <div class="unit-token-art">
        ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" loading="lazy" />` : `<span>${cardName(card)}</span>`}
      </div>
      <div class="unit-token-body">
        <strong>${cardName(card)}</strong>
        <span>${domain}</span>
        <div class="unit-token-badges">
          <b>${mainBadge}</b>
          <em>${state}</em>
          ${card.damage ? `<em>${card.damage} ${t("damageShort", locale())}</em>` : ""}
          ${attachments.length ? `<em>${attachments.length} ${t("attachedGear", locale())}</em>` : ""}
          ${cardStatusBadges(card)}
        </div>
      </div>
      <span class="owner-chip">${owner ? playerName(owner) : card.ownerId}</span>
      ${card.type === "unit" ? unitMightCue(card) : ""}
      ${card.type === "unit" ? moveSelectButton(card) : ""}
      ${attachmentStrip(attachments)}
    </article>
  `;
}

function unitToken(card, location, owner, motion, attachments, flashed) {
  const domain = domainText(card.domains?.[0]) || (card.tags?.[0] ? keywordText([card.tags[0]]) : "");
  const state = card.exhausted ? t("exhausted", locale()) : card.stunned ? t("stunned", locale()) : t("readyState", locale());
  const zoneClass = location === "base" ? "base-token" : "field-token";
  const combatStats = showdownUnitStats(card, location);
  const displayMight = combatStats?.might ?? currentMight(game, card);
  return `
    <article class="unit-token ${zoneClass} owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : ""} ${cardStatusClassNames(card)} ${unitMightAnimationClass(card)} ${chainTargetClass(card.instanceId)} ${flashed ? "effect-flash" : ""} ${motion}" data-card-id="${card.instanceId}" data-location="${location}">
      <div class="unit-token-art">
        ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" loading="lazy" />` : `<span>${cardName(card)}</span>`}
      </div>
      <div class="unit-token-body">
        <strong>${cardName(card)}</strong>
        <span>${domain}</span>
        <div class="unit-token-badges">
          <b>${t("might", locale())} ${displayMight}</b>
          <em>${state}</em>
          ${card.damage ? `<em>${card.damage} ${t("damageShort", locale())}</em>` : ""}
          ${combatStats ? `<b class="combat-stat">${t("currentMight", locale())} ${combatStats.might}</b><em class="${combatStats.remaining <= 0 ? "lethal-stat" : "health-stat"}">${t("remainingHealth", locale())} ${combatStats.remaining}</em>` : ""}
          ${cardStatusBadges(card)}
        </div>
      </div>
      <span class="owner-chip">${owner ? playerName(owner) : card.ownerId}</span>
      ${unitMightCue(card)}
      ${moveSelectButton(card)}
      ${attachmentStrip(attachments)}
    </article>
  `;
}

function showdownUnitStats(card, location) {
  if (game.phase !== "showdown" || !game.showdown || location !== game.showdown.battlefieldId || card.type !== "unit") return null;
  const battlefield = game.battlefields.find((field) => field.instanceId === game.showdown.battlefieldId);
  if (!battlefield) return null;
  const role = game.showdown.combat === false
    ? card.combatRole || null
    : card.controllerId === game.showdown.attackerId
      ? "attacker"
      : card.controllerId === game.showdown.defenderId
      ? "defender"
      : card.combatRole || null;
  const damageState = unitDamageState(game, card, { battlefield, role });
  return {
    role,
    ...damageState
  };
}

function attachmentStrip(attachments) {
  if (!attachments.length) return "";
  return `
    <div class="attachment-strip" aria-label="${locale() === LOCALES.KO ? "부착된 도구" : "Attached gear"}">
      ${attachments.map((gear) => `
        <button class="attached-gear ${game.selectedCardId === gear.instanceId ? "selected-attachment" : ""} ${chainTargetClass(gear.instanceId)}" data-card-id="${gear.instanceId}" title="${cardName(gear)}">
          ${gear.image ? `<img src="${gear.image}" alt="${cardName(gear)}" loading="lazy" />` : `<span>${cardName(gear)}</span>`}
        </button>
      `).join("")}
    </div>
  `;
}

function moveSelectButton(card) {
  if (!canSelectForBatchMove(card)) return "";
  const selected = moveSelection.has(card.instanceId);
  return `
    <button
      class="move-select-chip ${selected ? "selected" : ""}"
      data-action="toggle-move-selection"
      data-unit="${card.instanceId}"
      title="${selected ? (locale() === LOCALES.KO ? "일반 이동 선택에서 제외" : "Remove from standard move") : (locale() === LOCALES.KO ? "일반 이동 대상으로 선택" : "Add to standard move")}"
    >
      ${selected ? "OK" : "+"}
    </button>
  `;
}

function imageCard(card, className = "") {
  const flashed = isFlashed(card.instanceId);
  return `
    <article class="${imageCardClass(card, `${className} ${flashed ? "effect-flash" : ""}`)}" data-card-id="${card.instanceId}">
      ${cardImage(card)}
    </article>
  `;
}

function imageCardClass(card, extra = "") {
  const sourceGlow = uiMotion.sourceIds.has(card?.instanceId) ? "source-card-glow" : "";
  const targetGlow = uiMotion.targetIds.has(card?.instanceId) ? "target-card-glow" : "";
  return `image-card ${extra} ${sourceGlow} ${targetGlow} ${chainTargetClass(card?.instanceId)} ${isUsableCard(card) ? "usable-card" : ""} ${game.selectedCardId === card.instanceId ? "selected-card" : ""}`.trim();
}

function chainTargetClass(cardId) {
  return cardId && inspectedChainTargetIds.has(cardId) ? "chain-effect-target" : "";
}

function motionCardClass(card, zone) {
  if (!card) return "";
  if (zone === "hand" && uiMotion.drawn.has(card.instanceId)) return "draw-enter";
  if (zone === "board" && uiMotion.entered.has(card.instanceId)) {
    return hasKeyword(card, "Ambush") ? "ambush-enter" : "board-enter";
  }
  return "";
}

function cardImage(card) {
  const art = card.image
    ? `<img class="card-art" src="${card.image}" alt="${cardName(card)}" loading="lazy" />`
    : `<div class="card-art placeholder">${cardName(card)}</div>`;
  return art;
}

function statusLine(card) {
  if (card.type !== "unit") return "";
  const items = [`${t("might", locale())} ${currentMight(game, card)}`];
  if (card.exhausted) items.push(t("exhausted", locale()));
  if (card.damage) items.push(`${card.damage} ${t("damageShort", locale())}`);
  if (card.stunned) items.push(t("stunned", locale()));
  if ((card.empoweredCount || 0) > 0) {
    const maximum = Math.max(card.empoweredCount || 0, card.maxEmpowerCount || 1);
    items.push(maximum > 1
      ? `${locale() === LOCALES.KO ? "강화됨" : "Empowered"} ${card.empoweredCount}/${maximum}`
      : (locale() === LOCALES.KO ? "강화됨" : "Empowered"));
  }
  if (card.buffs) items.push(t("buff", locale()));
  if (card.mightModifier) items.push(`${card.mightModifier > 0 ? "+" : ""}${card.mightModifier} ${t("might", locale())}`);
  return `<span class="status-line">${items.join(" / ")}</span>`;
}

function moveButtons(card) {
  const destinationIds = new Set(legalMoveDestinationIds(uiLegalActions, card.instanceId));
  const buttons = destinationIds.has("base")
    ? [`<button data-action="move" data-unit="${card.instanceId}" data-destination="base">${t("base", locale())}</button>`]
    : [];
  for (const [index, field] of visibleBattlefields().entries()) {
    if (!destinationIds.has(field.instanceId)) continue;
    buttons.push(`<button data-action="move" data-unit="${card.instanceId}" data-destination="${field.instanceId}" title="${battlefieldName(field)}">${t("moveToField", locale(), { n: index + 1 })}</button>`);
  }
  return buttons.join("");
}

function actionBar(player, card) {
  if (game.phase === "first-player" || game.phase === "champion-select" || game.phase === "battlefield-select" || game.phase === "mulligan") return "";
  const disabled = game.pendingPayment || game.pendingChoice;
  const cardCount = player.hand.length;
  const showdown = game.phase === "showdown" ? showdownBarSummary() : null;
  const actionChain = game.actionChain ? actionChainBarSummary() : null;
  const chainSummary = showdown || actionChain;
  const responseInfo = responsePromptInfo();
  const waiting = isOnlineGame() && !viewerCanAct();
  const rejection = !waiting && !disabled ? actionRejection : null;
  if (!card || disabled || waiting) {
    const quickActions = globalActionButtons(player);
    return `
      <section class="action-bar ${chainSummary ? "showdown-action-bar" : ""} ${rejection ? "action-rejected" : ""}">
        <div class="action-context">
          <span class="bar-label">${rejection ? (locale() === LOCALES.KO ? "요청 거부" : "Rejected") : chainSummary ? chainSummary.label : t("action", locale())}</span>
          <strong>${waiting ? t("waitingForOpponent", locale()) : rejection?.title || responseInfo?.title || chainSummary?.title || (disabled ? t("resolvingStep", locale()) : t("noAction", locale()))}</strong>
          <span>${waiting ? t("waitingForOpponent", locale()) : rejection?.detail || responseInfo?.detail || chainSummary?.detail || (disabled ? t("finishDialog", locale()) : t("selectCardHint", locale()))}</span>
        </div>
        <div class="actions inline">
          ${waiting ? `<button disabled>${t("noAction", locale())}</button>` : responseInfo ? `<button class="primary" data-action="toggle-hand">${handOpen ? t("hideHand", locale()) : t("playReaction", locale())}</button><button data-action="pass-showdown">${t("pass", locale())}</button>` : quickActions.join("") || `<button disabled>${t("noAction", locale())}</button>`}
        </div>
        <div class="bar-controls">
          <button data-action="toggle-inspector" ${card ? "" : "disabled"}>${t("cardInfo", locale())}</button>
          <button class="primary" data-action="toggle-hand">${handOpen ? t("hideHand", locale()) : `${t("hand", locale())} ${cardCount}`}</button>
          ${chainSummary
            ? `<button class="primary" data-action="pass-showdown" ${waiting ? "disabled" : ""}>${t("pass", locale())}</button>`
            : `<button data-action="end-turn" ${game.phase !== "action" || waiting || disabled ? "disabled" : ""}>${t("endTurn", locale())}</button>`}
        </div>
      </section>
    `;
  }
  const context = selectedContext(card.instanceId);
  const actions = mergeActionButtons(selectedActions(card, context), globalActionButtons(player, card));
  return `
    <section class="action-bar ${chainSummary ? "showdown-action-bar" : ""} ${rejection ? "action-rejected" : ""}">
      <div class="action-context">
        <span class="bar-label">${rejection ? (locale() === LOCALES.KO ? "요청 거부" : "Rejected") : chainSummary ? chainSummary.label : t("selected", locale())}</span>
          <strong>${rejection?.title || responseInfo?.title || chainSummary?.title || cardName(card)}</strong>
        <span>${rejection?.detail || (responseInfo ? `${responseInfo.detail} / ${t("selected", locale())}: ${cardName(card)}` : chainSummary ? `${chainSummary.detail} / ${t("selected", locale())}: ${cardName(card)}` : actionHint(card, context, actions))}</span>
      </div>
      <div class="actions inline">
        ${actions.join("") || `<button disabled>${t("noAction", locale())}</button>`}
      </div>
      <div class="bar-controls">
        <button data-action="toggle-inspector">${t("cardInfo", locale())}</button>
        <button class="primary" data-action="toggle-hand">${handOpen ? t("hideHand", locale()) : `${t("hand", locale())} ${cardCount}`}</button>
        ${chainSummary
          ? `<button class="primary" data-action="pass-showdown" ${!viewerCanAct() ? "disabled" : ""}>${t("pass", locale())}</button>`
          : `<button data-action="end-turn" ${game.phase !== "action" || !viewerCanAct() ? "disabled" : ""}>${t("endTurn", locale())}</button>`}
      </div>
    </section>
  `;
}

function mergeActionButtons(primary, secondary) {
  const seen = new Set();
  return [...primary, ...secondary].filter((button) => {
    const key = button.replace(/\s+/g, " ").match(/data-action="[^"]+"[^>]*(data-card="[^"]+")?/)?.[0] || button;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function globalActionButtons(player, selectedCard = null) {
  if (game.pendingPayment || game.pendingChoice) return [];
  if (game.phase === "showdown") return [];
  return [];
}

function showdownBarSummary() {
  if (game.phase !== "showdown" || !game.showdown) return null;
  const field = game.battlefields.find((candidate) => candidate.instanceId === game.showdown.battlefieldId);
  const chainCount = game.showdown.chain.length;
  return {
    label: t("showdown", locale()),
    title: `${t("showdown", locale())}: ${field ? battlefieldName(field) : t("battlefield", locale())}`,
    detail: chainCount ? `${chainCount} ${t("pending", locale())}` : t("passNoAction", locale())
  };
}

function actionChainBarSummary() {
  const chainCount = game.actionChain?.chain.length || 0;
  return {
    label: t("chain", locale()),
    title: t("responseWindow", locale()),
    detail: chainCount ? `${chainCount} ${t("pending", locale())}` : t("passNoResponse", locale())
  };
}

function selectedActions(card, context) {
  if (!viewerCanAct()) return [];
  const player = viewerPlayer();
  if (!context || context.playerId !== player.id) return [];
  if (context.zone === "hand") return handActions(card, player);
  if (context.zone === "champion") return championActions(player);
  if (context.zone === "base" || context.zone === "battlefield") return [...unitActions(card, context), ...activatedActions(card)];
  if (context.zone === "legend") return activatedActions(card);
  if (context.zone === "rune") return activatedActions(card);
  if (context.zone === "hidden") return hiddenActions(card, context);
  if (context.zone === "trash") return trashActions(card, player);
  return [];
}

function trashActions(card, player) {
  if (!player || player.id !== viewerPlayerId()) return [];
  return uiLegalActions
    .filter((action) => action.kind === "beginPlayCardFromTrash" && action.cardId === card.instanceId)
    .map((command) => {
      const field = game.battlefields.find((candidate) => candidate.instanceId === command.destination);
      const label = locale() === LOCALES.KO
        ? `폐기장에서 사용${field ? ` → ${battlefieldName(field)}` : " → 기지"}`
        : `Play from trash${field ? ` → ${battlefieldName(field)}` : " → Base"}`;
      return `<button class="graveyard-play-button" data-action="begin-play-from-trash" data-card="${card.instanceId}" data-destination="${command.destination}">${label}</button>`;
    });
}

function handActions(card, player) {
  const inShowdown = game.phase === "showdown";
  const inActionChain = game.phase === "action" && Boolean(game.actionChain);
  const actions = [];
  const legalCardActions = uiLegalActions.filter((action) => action.cardId === card.instanceId);
  for (const command of legalCardActions.filter((action) => action.kind === "beginPlayCard")) {
    const destination = command.destination;
    const field = game.battlefields.find((candidate) => candidate.instanceId === destination);
    const label = field
      ? (inShowdown
        ? (hasKeyword(card, "Ambush") ? keywordText(["Ambush"]) : (card.tags?.includes("Reaction") ? t("chainReaction", locale()) : t("chainAction", locale())))
        : t("playToBattlefield", locale(), { name: battlefieldName(field) }))
      : inShowdown
        ? (card.tags?.includes("Reaction") ? t("chainReaction", locale()) : t("chainAction", locale()))
        : inActionChain
          ? t("chainReaction", locale())
          : (card.type === "spell" ? t("cast", locale()) : t("playBase", locale()));
    actions.push(`<button data-action="begin-play" data-card="${card.instanceId}" data-destination="${destination}">${label}</button>`);
  }
  for (const command of legalCardActions.filter((action) => action.kind === "hideCard")) {
    const field = game.battlefields.find((candidate) => candidate.instanceId === command.destination);
    if (field) actions.push(`<button data-action="hide-card" data-card="${card.instanceId}" data-destination="${field.instanceId}">${t("hideAtBattlefield", locale(), { name: battlefieldName(field) })}</button>`);
  }
  return actions;
}

function championActions(player) {
  if (!player.champion) return [];
  return uiLegalActions.filter((action) => action.kind === "beginPlayChampion").map(({ destination }) => {
    if (destination === "base") return `<button data-action="begin-champion" data-destination="base">${t("playChampionToBase", locale())}</button>`;
    const field = game.battlefields.find((candidate) => candidate.instanceId === destination);
    return `<button data-action="begin-champion" data-destination="${destination}">${t("playChampionToField", locale(), { name: battlefieldName(field) })}</button>`;
  });
}

function unitActions(card, context) {
  if (game.phase !== "action" || card.type !== "unit" || card.controllerId !== viewerPlayerId()) return [];
  if (card.exhausted || card.cantMoveThisTurn) return [];
  return moveButtons(card, context.location)
    .split(/(?=<button)/)
    .filter(Boolean);
}

function activatedActions(card) {
  const abilities = legalActivatedAbilityOptions(game, card.instanceId);
  if (!abilities.length || !viewerCanAct()) return [];
  if (card.type === "rune") {
    return abilities.flatMap((ability) => {
      if (!["addEnergy", "addPower"].includes(ability.kind)) return [];
      const amount = ability.amount;
      if (ability.kind === "addEnergy") {
        const label = locale() === LOCALES.KO ? `탈진 → 에너지 +${amount}` : `Exhaust → +${amount} Energy`;
        return [`<button class="rune-action rune-action-energy" data-action="activate-card" data-card="${card.instanceId}" data-ability="${ability.id}"><strong>${label}</strong><small>${locale() === LOCALES.KO ? "룬은 탈진 상태가 됩니다" : "This Rune becomes exhausted"}</small></button>`];
      }
      const domain = domainText(ability.domain);
      const label = locale() === LOCALES.KO ? `재활용 → ${domain} 힘 +${amount}` : `Recycle → +${amount} ${domain} Power`;
      return [`<button class="rune-action rune-action-power" data-action="activate-card" data-card="${card.instanceId}" data-ability="${ability.id}"><strong>${label}</strong><small>${locale() === LOCALES.KO ? "룬 덱 맨 아래로 되돌아갑니다" : "Return this Rune to the bottom of the Rune Deck"}</small></button>`];
    });
  }
  const baseLabel = card.type === "legend" ? t("useLegend", locale()) : t("activateCard", locale(), { name: cardName(card) });
  return abilities.map((ability) => {
    const label = abilities.length > 1 ? `${baseLabel}: ${localizedDynamicText(ability.label)}` : baseLabel;
    return `<button data-action="activate-card" data-card="${card.instanceId}" data-ability="${ability.id}">${label}</button>`;
  });
}

function hiddenActions(card, context) {
  const player = game.players.find((candidate) => candidate.id === context.playerId);
  const field = game.battlefields.find((candidate) => candidate.instanceId === context.location);
  const hidden = field?.hidden?.find((item) => item.card.instanceId === card.instanceId);
  if (!hidden || !hiddenPlayable(hidden, field, player)) return [];
  return [`<button data-action="begin-play" data-card="${card.instanceId}" data-destination="${context.location}">${t("revealHidden", locale())}</button>`];
}

function hiddenPlayable(hidden, field, player = viewerPlayer()) {
  if (!hidden || !field || !player || !hiddenCardIsControlledBy(hidden, player.id)) return false;
  return uiLegalActions.some((action) =>
    action.kind === "beginPlayCard"
    && action.cardId === hidden.card.instanceId
    && action.destination === field.instanceId);
}

function actionHint(card, context, actions) {
  if (locale() === "ko") {
    if (!context) return t("selectCardHint", locale());
    if (actions.length) return t("availableActions", locale());
    if (context.zone === "attachment") return t("attachedGear", locale());
    const activationReason = activationBlockedReason(card);
    if (activationReason) return localizedCommandFailure(activationReason).title;
    if (card.exhausted && card.type !== "rune") return t("exhausted", locale());
    if (context.playerId !== viewerPlayerId()) return t("opponent", locale());
    if (game.phase === "showdown") return "결전 체인에는 행동, 반응 또는 매복 카드만 추가할 수 있습니다.";
    if (game.actionChain) return "열린 체인에는 반응 능력만 추가할 수 있습니다.";
    return "현재 조건에서 실행할 수 있는 행동이 없습니다.";
  }
  if (!context) return "Select a playable card or unit";
  if (actions.length) return "Use the buttons, or click a highlighted zone";
  if (context.zone === "attachment") return "Attached gear";
  if (card.exhausted) return "Exhausted";
  const activationReason = activationBlockedReason(card);
  if (activationReason) return activationReason;
  if (context.playerId !== viewerPlayerId()) return "Opponent card";
  if (game.phase === "showdown") return "Only Actions, Reactions, or Ambush cards can join the chain";
  if (game.actionChain) return "Only Reactions can join the open chain";
  return "No legal action right now";
}

function selectedContext(cardId) {
  for (const player of game.players) {
    if (player.legend?.instanceId === cardId) return { playerId: player.id, zone: "legend", location: "legend" };
    if (player.availableChampions.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "champion-choice", location: "champion-choice" };
    if (player.hand.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "hand", location: "hand" };
    if (player.base.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "base", location: "base" };
    if (player.runes.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "rune", location: "rune" };
    if ((player.banished || []).some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "banished", location: "banished" };
    if (player.champion?.instanceId === cardId && !player.championPlayed && player.champion.zone === "champion") {
      return { playerId: player.id, zone: "champion", location: "champion" };
    }
    for (const unit of player.base.filter((card) => card.type === "unit")) {
      const attachment = (unit.attachments || []).find((card) => card.instanceId === cardId);
      if (attachment) return { playerId: attachment.controllerId || attachment.ownerId, zone: "attachment", location: "base", parentUnitId: unit.instanceId };
    }
  }
  for (const field of game.battlefields) {
    if (field.instanceId === cardId) return { playerId: null, zone: "battlefield-card", location: field.instanceId };
    const hidden = field.hidden?.find((item) => item.card.instanceId === cardId);
    if (hidden) return { playerId: hiddenCardControllerId(hidden), zone: "hidden", location: field.instanceId };
    const unit = field.units.find((card) => card.instanceId === cardId);
    if (unit) return { playerId: unit.controllerId, zone: "battlefield", location: field.instanceId };
    for (const unit of field.units) {
      const attachment = (unit.attachments || []).find((card) => card.instanceId === cardId);
      if (attachment) return { playerId: attachment.controllerId || attachment.ownerId, zone: "attachment", location: field.instanceId, parentUnitId: unit.instanceId };
    }
  }
  return null;
}

function isUsableCard(card) {
  if (!card || game.pendingPayment || game.pendingChoice) return false;
  if (["first-player", "champion-select", "battlefield-select", "mulligan", "complete"].includes(game.phase)) return false;
  const context = selectedContext(card.instanceId);
  return selectedActions(card, context).length > 0;
}

function canSelectForBatchMove(card) {
  if (!card || card.type !== "unit") return false;
  if (!viewerCanAct()) return false;
  if (game.phase !== "action" || game.pendingPayment || game.pendingChoice) return false;
  if (card.controllerId !== viewerPlayerId()) return false;
  if (card.exhausted || card.cantMoveThisTurn) return false;
  const context = selectedContext(card.instanceId);
  return context?.zone === "base" || context?.zone === "battlefield";
}

function pruneMoveSelection() {
  if (game.phase !== "action" || game.pendingPayment || game.pendingChoice) {
    moveSelection.clear();
    return;
  }
  for (const unitId of [...moveSelection]) {
    if (!canSelectForBatchMove(findVisibleCard(unitId))) moveSelection.delete(unitId);
  }
}

function activationBlockedReason(card) {
  const activatedEffects = (card.effects || []).filter((effect) => effect?.timing === "activated");
  if (!activatedEffects.length) return "";
  if (!activatedEffects.some((effect) => effect.abilityKeywords?.includes("Reaction"))
    && !card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return "";
  if (card.exhausted && !activatedEffects.some((effect) => effect.exhaust === false)) return "Source Exhausted";
  if (game.pendingPayment) {
    const player = game.players.find((candidate) => candidate.id === game.pendingPayment.playerId);
    const paidCard = player ? paymentDisplayCard(player, game.pendingPayment) : null;
    if (game.pendingPayment.playerId !== card.controllerId) return "Not your payment window";
    if (activatedEffects.some((effect) => effect.restriction === "spell") && paidCard?.type !== "spell") return "Only usable for Spell costs";
    return "";
  }
  if (game.actionChain && game.actionChain.priorityPlayerId !== card.controllerId) return "No priority";
  if (game.phase === "showdown" && game.showdown && game.showdown.priorityPlayerId !== card.controllerId) return "No showdown focus";
  if (game.phase === "action" && !game.actionChain && viewerPlayerId() !== card.controllerId) return "Opponent Turn - No Reaction Window";
  if (game.phase !== "action" && game.phase !== "showdown") return "No Chain";
  return "";
}

function targetAttributes(destination, ownerId) {
  const card = uiSelectedCard();
  if (!card) return { className: "", attrs: "" };
  const context = selectedContext(card.instanceId);
  if (!canUseTarget(card, context, destination, ownerId)) return { className: "", attrs: "" };
  const action = context.zone === "hand" ? "begin-play" : context.zone === "champion" ? "begin-champion" : "move";
  const payload = action === "move" ? `data-unit="${card.instanceId}"` : action === "begin-play" ? `data-card="${card.instanceId}"` : "";
  return {
    className: "target-zone",
    attrs: `data-zone-action="${action}" ${payload} data-destination="${destination}"`
  };
}

function canUseTarget(card, context, destination, ownerId) {
  if (!card || !context || game.pendingPayment || game.pendingChoice) return false;
  if (!viewerCanAct()) return false;
  if (ownerId !== viewerPlayerId()) return false;
  if (context.playerId !== viewerPlayerId()) return false;
  if (context.zone === "hand") {
    if (card.type !== "unit") return false;
    return uiLegalActions.some((action) =>
      action.kind === "beginPlayCard" && action.cardId === card.instanceId && action.destination === destination);
  }
  if (context.zone === "champion") {
    return uiLegalActions.some((action) => action.kind === "beginPlayChampion" && action.destination === destination);
  }
  if (context.zone === "base" || context.zone === "battlefield") {
    return uiLegalActions.some((action) =>
      action.kind === "moveUnit" && action.unitId === card.instanceId && action.destinationId === destination);
  }
  return false;
}

function runeSummary(player) {
  const counts = new Map();
  for (const rune of player.runes) {
    const item = counts.get(rune.domain) || {
      total: 0,
      ready: 0,
      color: rune.color,
      image: rune.image || "",
      name: cardName(rune),
      cardId: rune.instanceId,
      cardReady: !rune.exhausted
    };
    item.total += 1;
    if (!rune.exhausted) {
      item.ready += 1;
      if (!item.cardReady) {
        item.cardId = rune.instanceId;
        item.cardReady = true;
      }
    }
    counts.set(rune.domain, item);
  }
  const poolEnergy = runePoolEnergy(player).filter((resource) => poolEnergyCanPay(resource));
  const poolPower = player.runePool?.power || [];
  return `
    <div class="rune-summary">
      ${[...counts.entries()].map(([domain, item]) => `
        <button type="button" class="rune-count" data-action="select-card" data-card="${item.cardId}" style="--rune:${item.color}" title="${escapeHtml(item.name)} · ${domainText(domain)} ${item.ready}/${item.total}">
          ${item.image ? `<img class="rune-summary-art" src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" />` : ""}
          <span class="rune-summary-value"><b>${domainText(domain)}</b><em>${item.ready}/${item.total}</em></span>
        </button>
      `).join("") || `<span class="rune-count muted">${t("noRunes", locale())}</span>`}
      ${poolEnergy.length ? `<span class="rune-count generated"><span class="rune-summary-symbol" aria-hidden="true">⚡</span><span class="rune-summary-value"><b>${t("energy", locale())}</b><em>+${poolEnergy.length}</em></span></span>` : ""}
      ${poolPower.length ? `<span class="rune-count power-pool"><span class="rune-summary-symbol" aria-hidden="true">◆</span><span class="rune-summary-value"><b>${t("power", locale())}</b><em>${poolPower.length}</em></span></span>` : ""}
    </div>
  `;
}

function runeChip(rune) {
  const spent = rune.exhausted ? " spent" : "";
  const canRecycle = (rune.effects || []).some((effect) => effect?.timing === "activated" && effect.kind === "addPower" && effect.exhaust === false);
  return `
    <button type="button" class="rune rune-card-chip${spent}" data-action="select-card" data-card="${rune.instanceId}" style="--rune:${rune.color}" title="${cardText(rune)}">
      ${rune.image ? `<img src="${rune.image}" alt="${cardName(rune)}" loading="lazy" />` : `<span class="rune-swatch"></span>`}
      <span class="rune-card-caption">${domainText(rune.domain)}</span>
      ${rune.exhausted ? `<strong>${t("exhausted", locale())}</strong>` : ""}
      ${rune.exhausted && canRecycle ? `<small class="rune-recycle-ready">${locale() === LOCALES.KO ? "재활용 가능" : "Can recycle"}</small>` : ""}
    </button>
  `;
}

function inspector(card) {
  if (!card) {
    return `
      <aside class="inspector inspector-empty">
        <div class="inspector-toolbar">
          <strong>${t("cardInfo", locale())}</strong>
          <button type="button" data-action="toggle-inspector">${t("close", locale())}</button>
        </div>
        <div class="inspector-empty-state">
          <strong>${t("cardInfo", locale())}</strong>
          <p>${t("selectCardHint", locale())}</p>
        </div>
      </aside>
    `;
  }
  const power = (card.power || []).map((item) => {
    const domain = translateCostDomain(item.domain, locale(), card);
    return locale() === LOCALES.KO ? `${item.amount} ${domain} ${t("power", locale())}` : `${item.amount} ${domain}`;
  }).join(", ");
  const cost = card.type === "rune" ? domainText(card.domain) : `${card.energy ?? "-"}${power ? ` + ${power}` : ""}`;
  const attachments = card.attachments || [];
  return `
    <aside class="inspector">
      <div class="inspector-toolbar">
        <strong>${t("cardInfo", locale())}</strong>
        <button type="button" data-action="toggle-inspector">${t("close", locale())}</button>
      </div>
      <div class="inspector-card">
        ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" />` : ""}
      </div>
      <div class="inspector-text">
        <h2>${cardName(card)}</h2>
        <span>${cardTags(card).join(" / ")} / ${cost}</span>
        ${["unit", "gear"].includes(card.type) ? `<strong>${t("might", locale())} ${card.type === "unit" ? inspectorUnitMight(card) : card.might || 0}</strong>` : ""}
        <p>${shortCardText(cardText(card))}</p>
        ${(card.keywords || []).length ? `<small>${keywordText(card.keywords)}</small>` : ""}
        ${cardStatusPanel(card, { compact: true })}
        <button class="secondary view-full-card" data-action="view-full-card">${t("viewFullCard", locale())}</button>
        ${attachments.length ? `
          <button class="secondary attached-gear-toggle" data-action="toggle-attachments" data-card="${card.instanceId}">
            ${attachmentsOpenCardId === card.instanceId ? t("hideAttachedGear", locale()) : `${t("attachedGear", locale())} ${attachments.length}`}
          </button>
          ${attachmentsOpenCardId === card.instanceId ? attachedGearPanel(attachments) : ""}
        ` : ""}
      </div>
    </aside>
  `;
}

function inspectorUnitMight(card) {
  const onBoard = game.players.some((player) => player.base.some((unit) => unit.instanceId === card.instanceId))
    || game.battlefields.some((field) => field.units.some((unit) => unit.instanceId === card.instanceId));
  return onBoard ? currentMight(game, card) : effectiveMight(card);
}

function attachedGearPanel(attachments) {
  return `
    <div class="attached-gear-panel">
      <span>${t("attachedGear", locale())}</span>
      <div class="attached-gear-list">
        ${attachments.map((gear) => `
          <button class="attached-gear-card" data-action="select-card" data-card="${gear.instanceId}" title="${cardName(gear)}">
            ${gear.image ? `<img src="${gear.image}" alt="${cardName(gear)}" loading="lazy" />` : ""}
            <strong>${cardName(gear)}</strong>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function shortCardText(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function fullCardModal(card) {
  if (!card) return "";
  return `
    <section class="full-card-modal modal-panel">
      <div class="section-head">
        <div>
          <h2>${cardName(card)}</h2>
          <span>${cardTags(card).join(" / ")}</span>
        </div>
        <button data-action="close-full-card">${t("close", locale())}</button>
      </div>
      <div class="full-card-body">
        ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" />` : ""}
        <div class="full-card-copy">
          <p>${cardText(card)}</p>
          ${cardStatusPanel(card)}
        </div>
      </div>
    </section>
  `;
}

function hasKeyword(card, keyword) {
  if ((card.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  const player = game.players.find((candidate) => candidate.id === card.controllerId)
    || game.players.find((candidate) => candidate.id === card.ownerId);
  for (const effect of card.effects || []) {
    if (!effect) continue;
    if (effect.timing !== "levelStatic" || effect.kind !== "gainKeywords") continue;
    if ((player?.xp || 0) < (effect.level || 0)) continue;
    if ((effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  }
  return false;
}

function isFlashed(cardId) {
  return game.effectFlash?.sourceId === cardId || game.effectFlash?.targetIds?.includes(cardId);
}

app.addEventListener("click", (event) => {
  try {
    if (handlePendingChoiceClick(event)) return;
  } catch (error) {
    reportUiException(error, "pending choice click");
    showUiExceptionOverlay(error, "pending choice click");
  }
}, true);

function handlePendingChoiceClick(event) {
  if (replayMode || appView !== "game" || !game.pendingChoice) return false;
  const button = event.target.closest("button[data-action='choose-effect'], button[data-action='decline-effect'], button[data-action='assign-alpha-strike']");
  if (!button || !app.contains(button)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const { action, choice } = button.dataset;
  if (!tutorialAllowsUiAction(action, { ...button.dataset })) {
    render();
    return true;
  }
  if (action === "choose-effect") dispatchGameCommand({ kind: "chooseEffectOption", optionId: choice }, () => chooseEffectOption(game, choice));
  if (action === "assign-alpha-strike") {
    const input = app.querySelector(`input[data-alpha-target="${button.dataset.target}"]`);
    const amount = Math.max(1, Math.min(Number(input?.value) || 1, game.pendingChoice.data?.remainingDamage || 1));
    const optionId = `${button.dataset.target}:${amount}`;
    dispatchGameCommand({ kind: "chooseEffectOption", optionId }, () => chooseEffectOption(game, optionId));
  }
  if (action === "decline-effect") dispatchGameCommand({ kind: "declineEffectChoice" }, () => declineEffectChoice(game));
  render();
  return true;
}

app.addEventListener("click", (event) => {
  try {
    if (appView !== "game") {
      if (isTextEditingTarget(event.target)) return;
      handleShellClick(event);
      render();
      return;
    }

    if (isTextEditingTarget(event.target)) return;

    if (replayMode) {
      handleReplayGameClick(event);
      render();
      return;
    }

    const tutorialControl = event.target.closest("button[data-action^='tutorial-']");
    if (tutorialControl) {
      const tutorialAction = tutorialControl.dataset.action;
      if (tutorialAction === "tutorial-next") game.tutorial.introDismissed = true;
      if (tutorialAction === "tutorial-restart") startTutorial(game.tutorial.id);
      if (tutorialAction === "tutorial-exit") exitTutorial();
      render();
      return;
    }

    const payRunes = app.querySelector(".pay-runes");
    if (payRunes) paymentRunesScrollLeft = payRunes.scrollLeft;

    const { button, cardNode, targetZone } = resolveBoardClickTarget(event.target);
    if (cardNode) setUiSelectedCard(cardNode.dataset.cardId);

    if (targetZone) {
      const { zoneAction, card, unit, destination } = targetZone.dataset;
      if (!tutorialAllowsUiAction(zoneAction, { card, unit, destination })) {
        render();
        return;
      }
      if (zoneAction === "begin-play") {
        handOpen = false;
        dispatchGameCommand({ kind: "beginPlayCard", cardId: card, destination }, () => beginPlayCard(game, card, destination));
      }
      if (zoneAction === "begin-champion") {
        handOpen = false;
        dispatchGameCommand({ kind: "beginPlayChampion", destination }, () => beginPlayChampion(game, destination));
      }
      if (zoneAction === "move") {
        dispatchGameCommand({ kind: "moveUnit", unitId: unit, destinationId: destination }, () => moveUnit(game, unit, destination));
        moveSelection.clear();
      }
      render();
      return;
    }

    if (!button) {
      render();
      return;
    }

    const { action, card, unit, destination, player, battlefield, rune, energy, mode, choice, ability } = button.dataset;
    if (!tutorialAllowsUiAction(action, { ...button.dataset })) {
      render();
      return;
    }
    if (action === "sideboard-select-main") sideboardSelectedMain = button.dataset.cardNumber;
    if (action === "sideboard-swap-in") {
      const match = activeBetweenGamesMatch();
      const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
      const draft = isOnlineGame() ? online.match?.currentDeck : sideboardDrafts[playerId === "p2" ? 1 : 0];
      if (match?.phase === "sideboarding") swapSideboardCard(draft, sideboardSelectedMain, button.dataset.cardNumber);
      sideboardSelectedMain = null;
    }
    if (action === "sideboard-cancel-selection") sideboardSelectedMain = null;
    if (action === "sideboard-submit") submitSideboardDraft();
    if (action === "new-game") {
      if (game.phase === "complete") resultDismissed = true;
      pendingGameExit = "new-game";
    }
    if (action === "review-result") resultDismissed = true;
    if (action === "coach-report") {
      if (game.phase === "complete" && aiReplay && !aiReplay.report) completeAiReplay();
      appView = "analysis";
    }
    if (action === "toggle-log") logOpen = !logOpen;
    if (action === "dismiss-feedback") clearRealtimeFeedback();
    if (action === "toggle-inspector") inspectorOpen = !inspectorOpen;
    if (action === "toggle-chain-zone") chainZoneCollapsed = !chainZoneCollapsed;
    if (action === "inspect-chain-effect") {
      inspectedChainItemId = inspectedChainItemId === button.dataset.chainItemId ? null : button.dataset.chainItemId;
      fullCardOpen = false;
      fullCardPreviewCard = null;
      syncInspectedChainTargets();
    }
    if (action === "focus-chain-target") setUiSelectedCard(button.dataset.cardId);
    if (action === "confirm-first-player") dispatchGameCommand({ kind: "confirmFirstPlayer" }, () => confirmFirstPlayer(game));
    if (action === "roll-first-player") dispatchGameCommand({ kind: "rollFirstPlayer" }, () => rollFirstPlayer(game, activePlayerId()));
    if (action === "choose-first-player") dispatchGameCommand({ kind: "chooseFirstPlayer", playerId: player }, () => chooseFirstPlayer(game, activePlayerId(), player));
    if (action === "toggle-hand") handOpen = !handOpen;
    if (action === "toggle-graveyard") graveyardOpenPlayerId = graveyardOpenPlayerId === player ? null : player;
    if (action === "toggle-banished") banishedOpenPlayerId = banishedOpenPlayerId === player ? null : player;
    if (action === "toggle-intel") intelOpenPlayerId = intelOpenPlayerId === player ? null : player;
    if (action === "view-full-card") {
      fullCardPreviewCard = uiSelectedCard();
      fullCardOpen = Boolean(fullCardPreviewCard);
    }
    if (action === "view-choice-card") {
      fullCardPreviewCard = findChoicePreviewCard(button.dataset.cardId);
      fullCardOpen = Boolean(fullCardPreviewCard);
    }
    if (action === "view-chain-card") {
      fullCardPreviewCard = findVisibleCard(button.dataset.cardId);
      fullCardOpen = Boolean(fullCardPreviewCard);
    }
    if (action === "close-full-card") {
      fullCardOpen = false;
      fullCardPreviewCard = null;
    }
    if (action === "toggle-attachments") attachmentsOpenCardId = attachmentsOpenCardId === card ? null : card;
    if (action === "close-graveyard") graveyardOpenPlayerId = null;
    if (action === "close-banished") banishedOpenPlayerId = null;
    if (action === "close-intel") intelOpenPlayerId = null;
    if (action === "choose-champion") dispatchGameCommand({ kind: "selectChampion", cardId: card }, () => selectChampion(game, player, card));
    if (action === "choose-battlefield") dispatchGameCommand({ kind: "selectBattlefield", battlefieldId: battlefield }, () => selectBattlefield(game, player, battlefield));
    if (action === "toggle-mulligan-card") dispatchGameCommand({ kind: "toggleMulliganCard", cardId: card }, () => toggleMulliganCard(game, card));
    if (action === "confirm-mulligan") dispatchGameCommand({ kind: "confirmMulligan" }, () => confirmMulligan(game));
    if (action === "skip-mulligan") dispatchGameCommand({ kind: "skipMulligan" }, () => skipMulligan(game));
    if (action === "end-turn") dispatchGameCommand({ kind: "endTurn" }, () => endTurn(game));
    if (action === "surrender") pendingGameExit = "surrender";
    if (action === "cancel-game-exit") pendingGameExit = null;
    if (action === "confirm-game-exit") {
      const exitKind = pendingGameExit;
      pendingGameExit = null;
      if (exitKind === "new-game") {
        if (isOnlineGame()) {
          dispatchGameCommand({ kind: "restartGame" });
        } else {
          const pair = activeDeckRecords();
          localMatch = pair.length === 2 && pair.every((deck) => validateDeckRecord(deck).playable)
            ? createMatchState({ decks: pair, sideboardingEnabled: settings.sideboardingEnabled })
            : null;
          game = createGame({
            interactive: true,
            randomFirstPlayer: true,
            manualActionChainPriority: true,
            enforceChampionLegendMatch: true,
            format: settings.sideboardingEnabled ? "match" : "duel",
            decks: pair.length === 2 && pair.every((deck) => validateDeckRecord(deck).playable)
              ? pair.map(resolveDeckRecord)
              : undefined
          });
          sideboardDrafts = localMatch?.currentDecks.map((deck) => structuredClone(deck)) || [];
          resetGameUiState();
        }
      }
      if (exitKind === "surrender") {
        if (isOnlineGame()) dispatchGameCommand({ kind: "surrender" });
        else {
          appView = "menu";
          resetGameUiState();
        }
      }
    }
    if (action === "confirm-online-result") onlineLeaveRoom();
    if (action === "pass-showdown") dispatchGameCommand({ kind: "passShowdown" }, () => passShowdown(game, activePlayerId()));
    if (action === "begin-play") {
      handOpen = false;
      dispatchGameCommand({ kind: "beginPlayCard", cardId: card, destination }, () => beginPlayCard(game, card, destination));
    }
    if (action === "begin-play-from-trash") {
      graveyardOpenPlayerId = null;
      dispatchGameCommand({ kind: "beginPlayCardFromTrash", cardId: card, destination }, () =>
        beginPlayCardFromTrash(game, card, destination));
    }
    if (action === "begin-champion") {
      handOpen = false;
      dispatchGameCommand({ kind: "beginPlayChampion", destination }, () => beginPlayChampion(game, destination));
    }
    if (action === "hide-card") dispatchGameCommand({ kind: "hideCard", cardId: card, destination }, () => hideCard(game, card, destination));
    if (action === "toggle-move-selection") {
      if (moveSelection.has(unit)) moveSelection.delete(unit);
      else moveSelection.add(unit);
    }
    if (action === "clear-move-selection") moveSelection.clear();
    if (action === "batch-move") {
      dispatchGameCommand({ kind: "moveUnits", unitIds: [...moveSelection], destinationId: destination }, () => moveUnits(game, [...moveSelection], destination));
      moveSelection.clear();
    }
    if (action === "activate-card") dispatchGameCommand(
      { kind: "activateCard", cardId: card, abilityId: ability || undefined },
      (resolved) => activateCard(game, resolved.cardId, resolved.abilityId || null)
    );
    if (action === "pay-rune") dispatchGameCommand({ kind: "togglePaymentRune", runeId: rune, mode }, () => togglePaymentRune(game, rune, mode));
    if (action === "pay-pool-energy") dispatchGameCommand({ kind: "togglePaymentPoolEnergy", energyId: energy }, () => togglePaymentPoolEnergy(game, energy));
    if (action === "pay-pool-power") dispatchGameCommand({ kind: "togglePaymentPoolPower", powerId: button.dataset.power }, () => togglePaymentPoolPower(game, button.dataset.power));
    if (action === "toggle-optional-payment") dispatchGameCommand({ kind: "toggleOptionalPaymentEffect", effectId: button.dataset.effect }, () => toggleOptionalPaymentEffect(game, button.dataset.effect));
    if (action === "confirm-payment") dispatchGameCommand({ kind: "confirmPayment" }, () => confirmPayment(game));
    if (action === "cancel-payment") dispatchGameCommand({ kind: "cancelPayment" }, () => cancelPayment(game));
    if (action === "choose-effect") dispatchGameCommand({ kind: "chooseEffectOption", optionId: choice }, () => chooseEffectOption(game, choice));
    if (action === "decline-effect") dispatchGameCommand({ kind: "declineEffectChoice" }, () => declineEffectChoice(game));
    if (action === "move") {
      dispatchGameCommand({ kind: "moveUnit", unitId: unit, destinationId: destination }, () => moveUnit(game, unit, destination));
      moveSelection.clear();
    }
    if (action === "select-card") {
      if (game.selectedCardId !== card) attachmentsOpenCardId = null;
      setUiSelectedCard(card);
    }
    render();
  } catch (error) {
    reportUiException(error, "click");
    showUiExceptionOverlay(error, "click");
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && appView === "decks" && deckEditor.transferDialog) {
    event.preventDefault();
    deckEditor.transferDialog = null;
    render();
    return;
  }
  if (event.key === "Escape" && appView === "decks" && deckEditor.pendingDeleteDeckId) {
    event.preventDefault();
    deckEditor.pendingDeleteDeckId = null;
    render();
    return;
  }
  if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.dataset.action?.startsWith("auth-")) {
    event.preventDefault();
    void submitAuthentication();
    return;
  }
  if (!['Enter', ' '].includes(event.key)) return;
  const cardNode = event.target.closest?.("[data-card-id][role='button']");
  if (!cardNode || !app.contains(cardNode)) return;
  event.preventDefault();
  setUiSelectedCard(cardNode.dataset.cardId);
  render();
});

app.addEventListener("input", (event) => {
  try {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.dataset.action === "deck-transfer-text") {
      if (deckEditor.transferDialog) {
        deckEditor.transferDialog.text = target.value;
        deckEditor.transferDialog.error = "";
        deckEditor.transferDialog.notice = "";
      }
      const confirm = app.querySelector('[data-action="deck-import-confirm"]');
      if (confirm) confirm.disabled = !target.value.trim();
      return;
    }
    if (!(target instanceof HTMLInputElement)) return;
    const action = target.dataset.action;
    if (action === "choice-search") {
      const panel = target.closest(".choice-panel");
      const normalized = target.value.trim().toLocaleLowerCase(locale() === LOCALES.KO ? "ko-KR" : "en-US");
      const options = [...(panel?.querySelectorAll(".choice-grid > .choice-option") || [])];
      let visible = 0;
      for (const option of options) {
        const matches = !normalized || option.textContent.toLocaleLowerCase(locale() === LOCALES.KO ? "ko-KR" : "en-US").includes(normalized);
        option.hidden = !matches;
        if (matches) visible += 1;
      }
      const count = panel?.querySelector("[data-choice-search-count]");
      if (count) count.textContent = locale() === LOCALES.KO ? `${visible}개 표시` : `${visible} shown`;
      const empty = panel?.querySelector("[data-choice-search-empty]");
      if (empty) empty.hidden = visible !== 0;
      return;
    }
    if (action === "replay-seek" && replayMode) {
      pauseReplayPlayback();
      applyReplayFrame(Number(target.value));
      render();
      return;
    }
    if (action === "settings-sideboarding") {
      settings.sideboardingEnabled = target.checked;
      saveSettings();
      render();
      return;
    }
    if (action === "sideboard-first-player") {
      sideboardFirstPlayerId = target.value;
      render();
      return;
    }
    if (action === "online-code-input") {
      online.joinCode = target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return;
    }
    if (action === "auth-account-id") {
      auth.accountId = target.value;
      auth.error = "";
      return;
    }
    if (action === "auth-password") {
      auth.password = target.value;
      auth.error = "";
      return;
    }
    if (action === "auth-password-confirm") {
      auth.passwordConfirm = target.value;
      auth.error = "";
      return;
    }
    if (action === "deck-search") {
      deckEditor.search = target.value;
      renderDeckSearchOnly();
    }
    if (action === "deck-name") {
      mutateSelectedDeck((deck) => {
        deck.name = target.value || "New Deck";
      });
    }
  } catch (error) {
    reportUiException(error, "input");
    showUiExceptionOverlay(error, "input");
  }
});

app.addEventListener("change", (event) => {
  try {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.action === "replay-speed") {
      replayBrowser.speed = Math.max(0.25, Math.min(4, Number(target.value) || 1));
      restartReplayTimer();
      return;
    }
    if (target.dataset.action === "settings-language") {
      settings.locale = normalizeLocale(target.value);
      saveSettings();
      render();
      return;
    }
    if (target.dataset.action === "menu-ai-generation") {
      selectAiGeneration(target.value);
      render();
      return;
    }
    const deckFilter = {
      "deck-pool-filter": "poolId",
      "deck-pack-filter": "packId",
      "deck-type-filter": "type",
      "deck-domain-filter": "domain",
      "deck-energy-filter": "maxEnergy"
    }[target.dataset.action];
    if (deckFilter) {
      deckEditor[deckFilter] = target.value;
      if (deckFilter === "poolId" && deckEditor.packId !== "all" && !CARD_POOL_FORMATS.find((pool) => pool.id === deckEditor.poolId)?.packIds.includes(deckEditor.packId)) {
        deckEditor.packId = "all";
        render();
      } else {
        renderDeckSearchOnly();
      }
      return;
    }
    if (target.dataset.action !== "menu-active-deck") return;
    const index = Number(target.dataset.slot);
    const deck = deckStore.decks.find((candidate) => candidate.id === target.value);
    if ((index !== 0 && index !== 1) || !deck || !validateDeckRecord(deck).playable) return;
    deckStore.activeDeckIds[index] = deck.id;
    saveDeckStore();
    render();
  } catch (error) {
    reportUiException(error, "change");
    showUiExceptionOverlay(error, "change");
  }
});

function isTextEditingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target?.isContentEditable);
}

function renderDeckSearchOnly() {
  if (appView !== "decks") return;
  const deck = getSelectedDeckRecord();
  const library = app.querySelector(".deck-card-library");
  const count = app.querySelector(".card-search-count");
  if (!deck || !library) return;
  const scrollTop = library.scrollTop;
  const results = filteredDeckCards();
  library.innerHTML = results.map((card) => libraryCard(card, deck)).join("");
  library.scrollTop = scrollTop;
  if (count) count.textContent = locale() === LOCALES.KO ? `${results.length}장` : `${results.length} cards`;
}

function handleShellClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const { action, deck, cardNumber, domain, slot, room, tab, tutorial, mode } = button.dataset;
  if (action === "auth-mode" && ["login", "signup"].includes(mode)) {
    auth.mode = mode;
    auth.panelOpen = true;
    auth.password = "";
    auth.passwordConfirm = "";
    auth.error = "";
    auth.notice = "";
  }
  if (action === "auth-close") {
    auth.panelOpen = false;
    auth.password = "";
    auth.passwordConfirm = "";
    auth.error = "";
  }
  if (action === "auth-submit") void submitAuthentication();
  if (action === "auth-logout") void signOutAccount();
  if (action === "menu-home") {
    appView = "menu";
    deckEditor.transferDialog = null;
    deckEditor.pendingDeleteDeckId = null;
  }
  if (action === "menu-decks") {
    appView = "decks";
    deckEditor.mobileView = "list";
    deckEditor.transferDialog = null;
    deckEditor.pendingDeleteDeckId = null;
  }
  if (action === "menu-multiplayer") {
    connectDefaultMultiplayer();
  }
  if (action === "menu-start") startGameFromMenu();
  if (action === "menu-tutorial") appView = "tutorials";
  if (action === "tutorial-menu-back") appView = "menu";
  if (action === "tutorial-select") startTutorial(tutorial);
  if (action === "menu-ai") void startAiGameFromMenu();
  if (action === "menu-replays") void openReplayBrowser();
  if (action === "replay-list-back") leaveReplayBrowser();
  if (action === "replay-list-refresh") void loadReplayList();
  if (action === "replay-open") void openAiSpectatorReplay(button.dataset.replayId);
  if (action === "coach-back") appView = "game";
  if (action === "coach-deep-review") runDeepAiReview();
  if (action === "online-refresh") refreshRooms();
  if (action === "online-create") onlineCreateRoom();
  if (action === "online-join-room") onlineJoinRoom(room);
  if (action === "online-join-code") onlineJoinRoom(online.joinCode);
  if (action === "online-submit-deck") onlineSubmitDeck();
  if (action === "online-ready") onlineReady();
  if (action === "online-leave") onlineLeaveRoom();
  if (action === "deck-select") {
    deckEditor.transferNotice = null;
    deckEditor.transferDialog = null;
    deckEditor.pendingDeleteDeckId = null;
    deckEditor.selectedDeckId = deck;
    deckEditor.selectedCardNumber = deckHeroCard(getSelectedDeckRecord())?.cardNumber || null;
    deckEditor.mobileView = "edit";
    deckEditor.mobileTab = "deck";
  }
  if (action === "deck-new") {
    deckEditor.transferNotice = null;
    deckEditor.transferDialog = null;
    deckEditor.pendingDeleteDeckId = null;
    const record = createNewDeckRecord();
    deckStore.decks.push(record);
    deckEditor.selectedDeckId = record.id;
    deckEditor.selectedCardNumber = null;
    deckEditor.mobileView = "edit";
    deckEditor.mobileTab = "deck";
    saveDeckStore();
  }
  if (action === "deck-mobile-list") deckEditor.mobileView = "list";
  if (action === "deck-mobile-tab" && ["deck", "runes", "cards", "detail"].includes(tab)) deckEditor.mobileTab = tab;
  if (action === "deck-delete-request") {
    const selected = getSelectedDeckRecord();
    if (selected && !selected.isDefault && !selected.id.startsWith("default-")) deckEditor.pendingDeleteDeckId = selected.id;
  }
  if (action === "deck-delete-cancel") deckEditor.pendingDeleteDeckId = null;
  if (action === "deck-delete-confirm") deletePersonalDeck(deckEditor.pendingDeleteDeckId);
  if (action === "deck-save") {
    saveDeckStore();
    void flushAccountDeckSync();
  }
  if (action === "deck-import-open") openDeckImportDialog();
  if (action === "deck-export-open") openDeckExportDialog(getSelectedDeckRecord());
  if (action === "deck-transfer-close") deckEditor.transferDialog = null;
  if (action === "deck-import-confirm") importDeckTextValue(deckEditor.transferDialog?.text || "");
  if (action === "deck-export-copy") void copyDeckTransferText();
  if (action === "deck-ai-recommend") void runDeckAiRecommendation();
  if (action === "deck-ai-apply") {
    const changes = deckEditor.aiRecommendation?.changes || [];
    mutateSelectedDeck((selected) => {
      for (const change of changes) {
        const removeCount = cardCount(selected.main, change.remove.cardNumber);
        if (removeCount <= 0) continue;
        setCountEntry(selected.main, change.remove.cardNumber, removeCount - 1);
        setCountEntry(selected.main, change.add.cardNumber, cardCount(selected.main, change.add.cardNumber) + 1);
      }
    });
    deckEditor.aiRecommendation = null;
  }
  if (action === "deck-card-focus") {
    deckEditor.selectedCardNumber = cardNumber;
    if (window.matchMedia?.("(max-width: 760px)").matches) deckEditor.mobileTab = "detail";
  }
  if (action === "deck-set-legend") {
    mutateSelectedDeck((selected) => {
      if (cardByNumber(cardNumber)?.type === "legend") selected.legend = cardNumber;
    });
    deckEditor.selectedCardNumber = cardNumber;
  }
  if (action === "deck-add-main") {
    mutateSelectedDeck((selected) => addMainDeckCard(selected, cardNumber));
    deckEditor.selectedCardNumber = cardNumber;
  }
  if (action === "deck-add-sideboard") {
    mutateSelectedDeck((selected) => addSideboardCard(selected, cardNumber));
    deckEditor.selectedCardNumber = cardNumber;
  }
  if (action === "deck-remove-main") mutateSelectedDeck((selected) => removeMainDeckCard(selected, cardNumber));
  if (action === "deck-remove-sideboard") mutateSelectedDeck((selected) => removeSideboardCard(selected, cardNumber));
  if (action === "deck-add-battlefield") {
    mutateSelectedDeck((selected) => addBattlefieldCard(selected, cardNumber));
    deckEditor.selectedCardNumber = cardNumber;
  }
  if (action === "deck-remove-battlefield") mutateSelectedDeck((selected) => removeBattlefieldCard(selected, cardNumber));
  if (action === "deck-rune-add") mutateSelectedDeck((selected) => addRuneCard(selected, cardNumber));
  if (action === "deck-rune-remove") mutateSelectedDeck((selected) => removeRuneCard(selected, cardNumber));
  if (action === "deck-set-active") {
    const selected = getSelectedDeckRecord();
    if (!selected || !validateDeckRecord(selected).playable) return;
    const index = Number(slot);
    if (index !== 0 && index !== 1) return;
    deckStore.activeDeckIds[index] = selected.id;
    saveDeckStore();
  }
}

function coachAnalysisView() {
  const report = aiReplay?.report || buildMatchReport(aiReplay || { decisions: [] }, activeCoachModel());
  const summaries = report.summaries || {};
  const korean = locale() === LOCALES.KO;
  return `
    <main class="shell-screen coach-screen">
      <section class="coach-report-panel">
        <div class="section-head">
          <div>
            <p class="eyebrow visible">${korean ? "자가대전 AI 코치" : "Self-play AI coach"}</p>
            <h1>${korean ? "경기 분석" : "Match review"}</h1>
            <p>${escapeHtml(korean ? localizedDynamicText(report.overview || "아직 분석할 결정이 없습니다.") : (report.overview || "There are no decisions to review yet."))}</p>
          </div>
          <div class="actions inline">
            <button data-action="coach-deep-review" ${aiDeepReviewRunning || !aiReplay?.decisions?.length ? "disabled" : ""}>${aiDeepReviewRunning ? (korean ? "대안 시뮬레이션 중…" : "Simulating…") : (korean ? "정밀 롤아웃 분석" : "Deep rollout review")}</button>
            <button data-action="coach-back">${korean ? "게임으로 돌아가기" : "Back to game"}</button>
          </div>
        </div>
        <div class="coach-summary-grid">
          ${coachSummaryCard(korean ? "덱 구축" : "Deck", summaries.deck)}
          ${coachSummaryCard(korean ? "멀리건" : "Mulligan", summaries.mulligan)}
          ${coachSummaryCard(korean ? "실제 플레이" : "Play", summaries.play)}
        </div>
        <section class="coach-deck-advice">
          <h2>${korean ? "덱 구축 분석" : "Deck analysis"}</h2>
          ${(report.deckAdvice?.observations || []).map((item) => `<p>${escapeHtml(korean ? localizedDynamicText(item) : item)}</p>`).join("")}
          ${(report.deckAdvice?.recommendations || []).map((item) => `<p class="coach-recommendation">${escapeHtml(korean ? localizedDynamicText(item) : item)}</p>`).join("") || `<p>${korean ? "카드 교체를 권고하려면 더 많은 자가대전 표본이 필요합니다." : "More self-play samples are needed for card replacement advice."}</p>`}
        </section>
        <section class="coach-deck-advice coach-matchup-plan">
          <h2>${korean ? "상대 덱 대응 플랜" : "Matchup plan"}</h2>
          <p>${escapeHtml(korean ? localizedDynamicText(report.matchupPlan?.plan || "") : (report.matchupPlan?.plan || ""))}</p>
          <small>${korean ? "플랜 신뢰도" : "Plan confidence"} ${report.matchupPlan?.confidence === "high" ? "높음" : report.matchupPlan?.confidence === "medium" ? "보통" : "낮음"}</small>
          ${report.matchupPlan?.matchupWinRate == null ? "" : `<p>이 덱 조합 자가대전 승률 ${(report.matchupPlan.matchupWinRate * 100).toFixed(1)}% · ${report.matchupPlan.matchupGames}경기</p>`}
          <h3>${korean ? "현재 학습 환경의 주요 채용 카드" : "Most played cards in the learned meta"}</h3>
          <div class="coach-meta-cards">${(report.matchupPlan?.metaCards || []).map((card) => `<span>${escapeHtml(korean ? localizedDynamicText(card.name) : card.name)} · 채용 ${(card.inclusionRate * 100).toFixed(1)}%</span>`).join("") || `<span>${korean ? "아직 충분한 환경 표본이 없습니다." : "Not enough meta samples yet."}</span>`}</div>
        </section>
        <section class="coach-turning-points">
          <h2>${korean ? "중요한 판단" : "Key decisions"}</h2>
          ${(report.turningPoints || []).map(coachDecisionCard).join("") || `<p>${korean ? "기록된 주요 판단이 없습니다." : "No key decisions recorded."}</p>`}
        </section>
      </section>
    </main>
  `;
}

async function runDeepAiReview() {
  if (!aiReplay || aiDeepReviewRunning) return;
  aiDeepReviewRunning = true;
  render();
  try {
    await ensureNeuralAiLoaded();
    await refineAiReplay(aiReplay, activeCoachModel(), { limit: 5, rollouts: 8, rolloutDepth: 32, neuralModel: neuralAiModel });
    await persistAiReplay(persistableAiReplay(aiReplay));
  } catch (error) {
    reportUiException(error, "deep AI review");
  } finally {
    aiDeepReviewRunning = false;
    render();
  }
}

function coachSummaryCard(label, summary = {}) {
  return `<article><span>${escapeHtml(label)}</span><strong>${summary.majorMistakes || 0}</strong><small>주요 실수 · 누적 손실 ${((summary.totalRegret || 0) * 100).toFixed(1)}%</small></article>`;
}

function coachDecisionCard(item) {
  const selected = item.selected;
  const best = item.best;
  return `
    <article class="coach-decision severity-${item.severity}">
      <div><span>${item.turnNumber}턴 · ${item.category === "mulligan" ? "멀리건" : "플레이"}</span><strong>${item.severity === "critical" ? "치명적 실수" : item.severity === "mistake" ? "실수" : item.severity === "inaccuracy" ? "부정확" : "좋은 판단"}</strong></div>
      <p>선택: ${escapeHtml(locale() === LOCALES.KO ? localizedDynamicText(selected?.label || "-") : (selected?.label || "-"))} · 예상 승률 ${((selected?.expectedWinRate || 0) * 100).toFixed(1)}%</p>
      <p>추천: ${escapeHtml(locale() === LOCALES.KO ? localizedDynamicText(best?.label || "-") : (best?.label || "-"))} · 예상 승률 ${((best?.expectedWinRate || 0) * 100).toFixed(1)}%</p>
      <p>${escapeHtml(locale() === LOCALES.KO ? localizedDynamicText(item.explanation || "") : (item.explanation || ""))}</p>
      <small>신뢰도 ${item.confidence === "high" ? "높음" : item.confidence === "medium" ? "보통" : "낮음"}</small>
    </article>
  `;
}

enableLocalPresentationPreview();
loadAiCheckpoint();
loadAiGenerationCatalog();
void restoreAccountSession();

if (online.mode === "online" && online.roomId && online.playerToken) {
  connectOnlineEvents();
}

function enableLocalPresentationPreview() {
  const localHost = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const preview = new URLSearchParams(window.location.search).get("presentation");
  if (!localHost || !["result", "impact"].includes(preview)) return;
  const [first, second] = game.players;
  for (const player of game.players) {
    player.champion = player.availableChampions.shift();
    player.champion.zone = "champion";
    player.chosenChampionName = player.champion.name;
    player.availableChampions = [];
  }
  game.selectedCardId = first.champion.instanceId;
  game.currentPlayerId = first.id;
  first.score = 4;
  second.score = 6;
  game.phase = "action";
  game.turnNumber = 6;
  game.turnSequence = 11;
  advancePresentation(presentationState, snapshotPresentationGame(game, (card) => currentMight(game, card), first.id), first.id);
  if (preview === "impact") {
    first.score = 7;
    game.turnNumber = 7;
    game.turnSequence = 12;
    const update = advancePresentation(presentationState, snapshotPresentationGame(game, (card) => currentMight(game, card), first.id), first.id);
    activeImpact = update.impact;
    staticImpactPreview = true;
    appView = "game";
    return;
  }
  first.score = 8;
  game.phase = "complete";
  game.turnNumber = 7;
  game.turnSequence = 12;
  game.winnerId = first.id;
  game.log.unshift(`${first.name} wins at 8 points.`);
  advancePresentation(presentationState, snapshotPresentationGame(game, (card) => currentMight(game, card), first.id), first.id);
  appView = "game";
  resultRevealReady = true;
  resultDismissed = false;
}

async function loadAiCheckpoint() {
  try {
    const response = await fetch(new URL("./ai/checkpoints/champion.json", import.meta.url));
    if (!response.ok) return;
    aiModel = createModel(await response.json());
    if (appView === "menu") render();
  } catch {
    // The bootstrap model remains available when a packaged checkpoint cannot be read.
  }
}

async function loadAiGenerationCatalog() {
  aiGenerationCatalogState = "loading";
  try {
    const result = await fetchAiGenerations();
    const generations = (result.generations || [])
      .filter((entry) => Number.isInteger(Number(entry.generation)) && Number(entry.generation) >= 0)
      .map((entry) => ({
        ...entry,
        generation: Number(entry.generation),
        source: "server",
        trainingDeckIds: Array.isArray(entry.trainingDeckIds) && entry.trainingDeckIds.length
          ? [...entry.trainingDeckIds]
          : [...(aiGenerationDescriptor(entry.generation)?.trainingDeckIds || AI_GENERATIONS[0].trainingDeckIds)]
      }))
      .sort((left, right) => left.generation - right.generation);
    if (generations.length) availableAiGenerations = generations;
    if (!availableAiGenerations.some((entry) => entry.generation === Number(settings.aiGeneration))) {
      settings.aiGeneration = availableAiGenerations.find((entry) => entry.activeLearner)?.generation
        ?? availableAiGenerations.at(-1)?.generation
        ?? normalizeAiGeneration();
      saveSettings();
    }
    aiGenerationCatalogState = "ready";
    aiGenerationCatalogError = "";
  } catch (error) {
    aiGenerationCatalogState = "error";
    aiGenerationCatalogError = locale() === LOCALES.KO
      ? "학습 작업공간의 세대 목록을 불러오지 못해 번들 모델만 표시합니다."
      : "Could not load the training workspace generations; only bundled models are shown.";
  } finally {
    if (appView === "menu") render();
  }
}

async function ensureNeuralAiLoaded() {
  const generation = selectedAiGenerationDescriptor();
  if (neuralAiModel && neuralAiSession && neuralAiLoadedGeneration === generation.generation) return true;
  if (neuralAiLoadPromise) return neuralAiLoadPromise;
  clearNeuralAiModel();
  neuralAiLoadState = "loading";
  neuralAiLoadError = "";
  render();
  neuralAiLoadPromise = (async () => {
    try {
      await nextPaint();
      const checkpoint = generation.source === "server"
        ? await fetchAiGenerationCheckpoint(generation.generation)
        : await fetch(new URL(generation.checkpoint, import.meta.url), { cache: "no-cache" }).then(async (response) => {
          if (!response.ok) throw new Error(`모델 파일을 읽을 수 없습니다 (HTTP ${response.status}).`);
          return response.json();
        });
      if (Number(checkpoint.generation) !== generation.generation) {
        throw new Error(`선택한 ${generation.generation}세대와 모델 파일의 ${checkpoint.generation}세대가 일치하지 않습니다.`);
      }
      const { createNeuralSession, deserializeNeuralModel, estimateNeuralValue } = await import("./ai/neural/model.mjs");
      neuralAiModel = deserializeNeuralModel(checkpoint);
      neuralAiSession = createNeuralSession(neuralAiModel);
      neuralValueEstimator = estimateNeuralValue;
      neuralAiLoadedGeneration = generation.generation;
      neuralAiLoadState = "ready";
      return true;
    } catch (error) {
      clearNeuralAiModel();
      neuralAiLoadState = "error";
      neuralAiLoadError = error instanceof Error ? error.message : String(error);
      reportUiException(error, "trained AI model load");
      return false;
    } finally {
      neuralAiLoadPromise = null;
      render();
    }
  })();
  return neuralAiLoadPromise;
}

function clearNeuralAiModel() {
  neuralAiModel = null;
  neuralAiSession = null;
  neuralValueEstimator = null;
  neuralAiLoadedGeneration = null;
}

function selectAiGeneration(value) {
  const generation = availableAiGenerations.find((entry) => entry.generation === Number(value));
  if (!generation || generation.generation === settings.aiGeneration) return;
  settings.aiGeneration = generation.generation;
  saveSettings();
  clearNeuralAiModel();
  neuralAiLoadState = "idle";
  neuralAiLoadError = "";
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function runDeckAiRecommendation() {
  const selected = getSelectedDeckRecord();
  if (!selected) return;
  await ensureNeuralAiLoaded();
  deckEditor.aiRecommendation = recommendDeckForPool(resolveDeckRecord(selected), activeCoachModel(), deckEditor.poolId);
  render();
}

function neuralAiStatusText() {
  const korean = locale() === LOCALES.KO;
  const generation = selectedAiGenerationDescriptor().generation;
  if (neuralAiLoadState === "loading") return korean ? `${generation}세대 AI 모델을 불러오는 중입니다.` : `Loading generation ${generation} AI.`;
  if (neuralAiLoadState === "error") return korean ? `${generation}세대 모델을 불러오지 못해 AI 대전을 시작할 수 없습니다: ${localizedDynamicText(neuralAiLoadError, { fallback: "모델 파일을 불러오지 못했습니다." })}` : `Generation ${generation} could not be loaded, so the AI match cannot start: ${neuralAiLoadError}`;
  if (neuralAiLoadState === "idle") return korean ? `선택한 ${generation}세대 모델은 AI 대전을 시작할 때 로드됩니다.` : `The selected generation ${generation} model loads when an AI match starts.`;
  return korean
    ? `AI 세대 ${activeAiGeneration()} · 자가대전 ${activeAiGames()}경기 학습 · 순환형 학습 모델 준비됨`
    : `AI generation ${activeAiGeneration()} · ${activeAiGames()} self-play games · recurrent PPO ready`;
}

function activeCoachModel() {
  return neuralAiModel ? { ...aiModel, ...(neuralAiModel.knowledge || {}), generation: neuralAiModel.generation, gamesTrained: neuralAiModel.gamesTrained } : aiModel;
}

function activeAiGeneration() {
  return neuralAiModel?.generation ?? aiModel.generation ?? 0;
}

function activeAiGames() {
  return neuralAiModel?.gamesTrained ?? aiModel.gamesTrained ?? 0;
}

// Browser smoke tests use the same production renderers without repeatedly
// rebuilding the full 823-card deck editor DOM.
window.__riftboundCardRenderAudit = (cardNumber) => {
  const card = CARD_BY_NUMBER.get(cardNumber);
  if (!card) return null;
  const previousLocale = settings.locale;
  settings.locale = LOCALES.KO;
  try {
    const auditDeck = {
      id: "card-render-audit",
      name: "Card render audit",
      legend: null,
      battlefields: [],
      main: [],
      sideboard: [],
      runes: []
    };
    const renderedCard = {
      ...structuredClone(card),
      instanceId: `render-audit-${card.cardNumber}`,
      ownerId: game.players[0]?.id || "p1",
      controllerId: game.players[0]?.id || "p1",
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      mightModifier: 0,
      attachments: []
    };
    return {
      cardNumber: card.cardNumber,
      name: cardName(card),
      text: cardText(card),
      type: cardType(card),
      image: card.image || null,
      libraryHtml: libraryCard(card, auditDeck),
      detailHtml: deckDetailCard(card, auditDeck),
      modalHtml: fullCardModal(renderedCard)
    };
  } finally {
    settings.locale = previousLocale;
  }
};
window.__riftboundCardRenderAuditNumbers = () => ALL_CARDS.map((card) => card.cardNumber);

window.addEventListener("error", (event) => {
  reportUiException(event.error || event.message, "window error");
  if (appView === "game") showUiExceptionOverlay(event.error || event.message, "window error");
});

window.addEventListener("unhandledrejection", (event) => {
  reportUiException(event.reason, "unhandled promise");
  if (appView === "game") showUiExceptionOverlay(event.reason, "unhandled promise");
});

render();
