import {
  beginPlayCard,
  beginPlayChampion,
  activateCard,
  cancelPayment,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmPayment,
  createGame,
  currentCombatMight,
  currentPlayer,
  declineEffectChoice,
  endTurn,
  effectiveMight,
  getSelectedCard,
  hasRequiredPlayTargets,
  hideCard,
  hiddenCardsAtBattlefieldForPlayer,
  hiddenSlotLimit,
  moveUnit,
  moveUnits,
  passShowdown,
  selectBattlefield,
  selectCard,
  selectChampion,
  surrender,
  confirmMulligan,
  skipMulligan,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentRune
} from "./engine.mjs";
import { cards, DOMAINS, makeRune, rawDecklists, RUNE_COLORS } from "./cards.mjs";
import {
  DECK_RULES,
  cardCount as deckCardCount,
  isChampionDeckCard as isChampionDeckCardByRule,
  mainDeckCount as deckMainDeckCount,
  normalizeCountEntries as normalizeDeckCountEntries,
  runeCount as deckRuneCount,
  runeDeckCount as deckRuneDeckCount,
  sideboardCount as deckSideboardCount,
  validateDeckRecord as validateDeckRecordByRule
} from "./decks/rules.mjs";
import { beginNextMatchGame, createMatchState, recordMatchGame, submitSideboardConfiguration } from "./match.mjs";
import {
  configureOnlineServer,
  createOnlineRoom,
  fetchRooms,
  joinOnlineRoom,
  leaveOnlineRoom,
  openRoomEvents,
  persistAiReplay,
  sendOnlineCommand,
  setOnlineReady,
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
import { configureAudio, playPresentationCue, unlockAudio } from "./audio.mjs";
import {
  advancePresentation,
  createPresentationState,
  rankPresentationHighlights,
  resetPresentationState,
  snapshotPresentationGame
} from "./presentation.mjs";
import { activeActorId as aiActiveActorId, applyAiAction, cloneGame, enumerateLegalActions } from "./ai/actions.mjs";
import { buildMatchReport } from "./ai/coach.mjs";
import { recommendDeckForPool } from "./ai/deckbuilding.mjs";
import { choosePolicyAction, createModel, DEFAULT_AI_MODEL } from "./ai/policy.mjs";
import { createAiReplay, finalizeAiReplay, persistableAiReplay, recordReplayDecision, refineAiReplay } from "./ai/replay.mjs";
import { CARD_PACKS, CARD_POOL_FORMATS, cardAllowedInPool, packForCard } from "./card-pools.mjs";

const DEFAULT_MULTIPLAYER_SERVER = "https://backboard-fender-basis.ngrok-free.dev";
const DECK_STORAGE_KEY = "riftbound.deckStore.v1";
const ONLINE_STORAGE_KEY = "riftbound.onlineSeat.v1";
const SETTINGS_STORAGE_KEY = "riftbound.settings.v1";
const ALL_CARDS = Object.values(cards).sort((a, b) => a.name.localeCompare(b.name));
const CARD_BY_NUMBER = new Map(ALL_CARDS.map((card) => [card.cardNumber, card]));
let settings = loadSettings();
let deckStore = loadDeckStore();
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
  search: "",
  selectedCardNumber: null,
  poolId: "origins-era",
  packId: "all",
  type: "all",
  domain: "all",
  maxEnergy: "all",
  aiRecommendation: null
};
let game = createGame({ interactive: true, randomFirstPlayer: true, manualActionChainPriority: true });
let logOpen = false;
let handOpen = false;
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
let recentFeedback = null;
let feedbackDismissTimer = null;
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
let aiReplay = null;
let aiTurnTimer = null;
let aiThinking = false;
let aiDeepReviewRunning = false;
const app = document.querySelector("#app");
let reportingUiException = false;

configureAudio({ enabled: settings.sound, voice: settings.voice, volume: settings.volume });

function locale() {
  return settings.locale;
}

function cardName(card) {
  return translateCardName(card, locale());
}

function cardText(card) {
  return translateCardText(card, locale());
}

function cardType(card) {
  return translateType(card?.type, locale());
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

function render() {
  try {
    renderApp();
  } catch (error) {
    reportUiException(error, "render");
    showUiExceptionOverlay(error, "render");
  }
}

function renderApp() {
  const scrollState = captureScrollState();
  if (appView === "menu") {
    app.innerHTML = menuView();
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
        ${aiReplay ? `<button class="secondary" data-action="coach-report">${locale() === LOCALES.KO ? "AI 분석" : "AI Review"}</button>` : ""}
        <button class="secondary sound-toggle ${settings.sound ? "enabled" : "muted"}" data-action="toggle-sound" title="${settings.sound ? "효과음 끄기" : "효과음 켜기"}">${settings.sound ? "SFX ON" : "SFX OFF"}</button>
        ${game.phase !== "complete" ? `<button class="secondary danger" data-action="surrender" title="${t("surrender", locale())}">${t("surrender", locale())}</button>` : ""}
        <button class="secondary" data-action="new-game" title="${t("newGame", locale())}">${t("newGame", locale())}</button>
      </div>
    </header>
    <main class="layout phase-${game.phase} ${inspectorOpen ? "inspector-open" : ""} ${activeImpact ? `impact-active impact-${activeImpact.kind}` : ""} ${staticImpactPreview ? "preview-impact" : ""}">
      ${game.phase === "first-player" ? firstPlayerPanel() : game.phase === "champion-select" ? championSelectPanel() : game.phase === "battlefield-select" ? setupPanel() : game.phase === "mulligan" ? mulliganPanel() : gamePanel(player)}
      ${cinematicImpactOverlay()}
      ${["first-player", "champion-select", "mulligan"].includes(game.phase) ? "" : inspector(uiSelectedCard())}
      ${pendingGameExit ? gameExitConfirmModal() : ""}
      ${gameResultModal()}
      ${fullCardOpen ? fullCardModal(fullCardPreviewCard || uiSelectedCard()) : ""}
      ${logOpen ? logDrawer() : ""}
    </main>
  `;
  restorePaymentScroll();
  restoreScrollState(scrollState);
  if (presentationUpdate.cues.length) {
    const korean = locale() === LOCALES.KO;
    requestAnimationFrame(() => presentationUpdate.cues.forEach((cue) => playPresentationCue({
      ...cue,
      callout: korean ? cue.calloutKo : cue.calloutEn
    })));
  }
  scheduleAiTurn();
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
  return String(error ?? "Unknown error");
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
    <strong>UI Exception</strong>
    <span>${escapeHtml(context)}: ${escapeHtml(errorMessage(error))}</span>
  `;
  app.appendChild(banner);
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
  return `
    <main class="shell-screen main-menu">
      <section class="menu-hero">
        <p class="eyebrow visible">Riftbound Online</p>
        <h1>Riftbound</h1>
        <div class="settings-row" aria-label="${t("settings", locale())}">
          <label>
            <span>${t("language", locale())}</span>
            <select data-action="settings-language">
              ${Object.entries(LOCALE_LABELS).map(([value, label]) => `
                <option value="${value}" ${locale() === value ? "selected" : ""}>${label}</option>
              `).join("")}
            </select>
          </label>
          <button type="button" class="secondary audio-setting ${settings.sound ? "enabled" : "muted"}" data-action="toggle-sound">
            ${settings.sound ? "효과음 켜짐" : "효과음 꺼짐"}
          </button>
          <button type="button" class="secondary audio-setting ${settings.voice ? "enabled" : "muted"}" data-action="toggle-voice" ${settings.sound ? "" : "disabled"}>
            ${settings.voice ? "승부 대사 켜짐" : "승부 대사 꺼짐"}
          </button>
          <label class="volume-setting">
            <span>음량 ${Math.round(settings.volume * 100)}%</span>
            <input type="range" min="0" max="100" step="5" value="${Math.round(settings.volume * 100)}" data-action="settings-volume" />
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
        <label class="sideboard-toggle">
          <input type="checkbox" data-action="settings-sideboarding" ${settings.sideboardingEnabled ? "checked" : ""} />
          <span>${locale() === LOCALES.KO ? "사이드전 사용 (3판 2선승)" : "Use sideboarding (best of three)"}</span>
        </label>
        <div class="menu-actions">
          <button class="primary menu-button" data-action="menu-start" ${validPair ? "" : "disabled"}>${t("startGame", locale())}</button>
          <button class="primary menu-button coach-start" data-action="menu-ai" ${validPair ? "" : "disabled"}>${locale() === LOCALES.KO ? "학습 AI와 대전" : "Play Learning AI"}</button>
          <button class="secondary menu-button" data-action="menu-multiplayer">${t("multiplayer", locale())}</button>
          <button class="secondary menu-button" data-action="menu-decks">${t("deckEdit", locale())}</button>
        </div>
        <p class="ai-model-status">${locale() === LOCALES.KO ? `AI 세대 ${activeAiGeneration()} · 자가대전 ${activeAiGames()}경기 학습 · ${neuralAiModel ? "순환 PPO" : "기본 정책"}` : `AI generation ${activeAiGeneration()} · ${activeAiGames()} self-play games · ${neuralAiModel ? "recurrent PPO" : "baseline policy"}`}</p>
        ${online.loading ? `<p class="online-status">${locale() === LOCALES.KO ? "멀티플레이 서버에 연결 중입니다." : "Connecting to the multiplayer server."}</p>` : ""}
        ${online.error ? `<p class="online-error" role="alert">${escapeHtml(online.error)}</p>` : ""}
        <div class="active-decks-summary">
          ${activeDecks.map((deck, index) => deckSummaryBadge(deck, t("playerDeck", locale(), { n: index + 1 }))).join("")}
        </div>
        ${validPair ? "" : `<p class="deck-warning">${locale() === LOCALES.KO ? `사용 가능한 덱 2개가 필요합니다. 메인 덱은 정확히 ${DECK_RULES.mainExact}장, 사이드보드는 최대 ${DECK_RULES.sideboardMax}장, 룬은 ${DECK_RULES.runeExact}장, 전장은 ${DECK_RULES.battlefieldsExact}장이어야 합니다.` : `Two playable decks are required: exactly ${DECK_RULES.mainExact} Main Deck cards, up to ${DECK_RULES.sideboardMax} Sideboard cards, ${DECK_RULES.runeExact} Runes, and ${DECK_RULES.battlefieldsExact} Battlefields.`}</p>`}
      </section>
    </main>
  `;
}

function deckPickerOptions(playableDecks, selectedId) {
  if (!playableDecks.length) return `<option value="">${t("noPlayableDecks", locale())}</option>`;
  return playableDecks.map((deck) => `
    <option value="${deck.id}" ${deck.id === selectedId ? "selected" : ""}>${escapeHtml(deck.name)}</option>
  `).join("");
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null");
    return {
      locale: normalizeLocale(parsed?.locale || LOCALES.EN),
      sound: parsed?.sound !== false,
      voice: parsed?.voice !== false,
      volume: clampVolume(parsed?.volume),
      sideboardingEnabled: parsed?.sideboardingEnabled === true
    };
  } catch {
    return { locale: LOCALES.EN, sound: true, voice: true, volume: 0.72, sideboardingEnabled: false };
  }
}

function clampVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.72;
  return Math.max(0, Math.min(1, numeric));
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
                <span>${room ? `${room.playerCount}/2 ${t("players", locale())} / ${room.status}` : t("createOrJoinRoom", locale())}</span>
                ${room ? `<small>${room.sideboardingEnabled ? (locale() === LOCALES.KO ? "사이드전 · 3판 2선승" : "Sideboarding · best of three") : (locale() === LOCALES.KO ? "단판" : "Single game")}</small>` : ""}
              </div>
              ${room ? `<button data-action="online-leave">${t("leave", locale())}</button>` : ""}
            </div>
            ${online.error ? `<p class="online-error">${escapeHtml(online.error)}</p>` : ""}
            <div class="seat-list">
              ${room ? Object.values(room.seats).map(seatBadge).join("") : `<p class="empty">아직 참가한 방이 없습니다.</p>`}
            </div>
            <div class="online-deck-submit">
              <strong>${t("selectedDeck", locale())}</strong>
              ${activeDeck ? deckSummaryBadge(activeDeck, online.playerId ? `Your seat: ${online.playerId.toUpperCase()}` : "Local deck") : `<p class="empty">선택된 덱이 없습니다.</p>`}
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
      <em>${room.status}</em>
    </button>
  `;
}

function seatBadge(seat) {
  return `
    <div class="seat-badge ${seat.occupied ? "occupied" : ""} ${seat.playerId === online.playerId ? "mine" : ""}">
      <strong>${seat.playerId.toUpperCase()}</strong>
      <span>${seat.occupied ? seat.deckName || "덱 대기 중" : "빈 좌석"}</span>
      <em>${seat.ready ? t("ready", locale()) : t("waiting", locale())}</em>
    </div>
  `;
}

function deckEditorView() {
  const selectedDeck = getSelectedDeckRecord();
  const selectedCard = selectedDeckLibraryCard();
  return `
    <main class="shell-screen deck-builder-screen">
      <section class="deck-select-panel">
        <div class="deck-builder-head">
          <button class="round-back" data-action="menu-home">${t("back", locale())}</button>
          <div>
            <h1>${t("deckSelect", locale())}</h1>
            <p>편집할 덱을 선택하세요.</p>
          </div>
        </div>
        <div class="deck-slot-grid">
          ${deckStore.decks.map(deckSelectCard).join("")}
          <button class="deck-slot new-deck-slot" data-action="deck-new">
            <span class="big-plus">+</span>
            <strong>새 덱 만들기</strong>
          </button>
        </div>
      </section>
      <section class="deck-editor-panel">
        ${selectedDeck ? deckEditorContent(selectedDeck, selectedCard) : `<div class="empty-editor"><h2>덱을 선택하세요</h2></div>`}
      </section>
    </main>
  `;
}

function deckEditorContent(deck, selectedCard) {
  const validation = validateDeckRecord(deck);
  return `
    <div class="deck-editor-top">
      <div class="deck-name-row">
        <input class="deck-name-input" data-action="deck-name" value="${escapeHtml(deck.name)}" maxlength="48" />
        <span class="${validation.playable ? "valid-pill" : "invalid-pill"}">${validation.playable ? t("playable", locale()) : t("notPlayable", locale())}</span>
      </div>
      <div class="deck-editor-actions">
        <button data-action="deck-ai-recommend">선택 카드풀 AI 추천</button>
        <button data-action="deck-set-active" data-slot="0" ${validation.playable ? "" : "disabled"}>P1 사용</button>
        <button data-action="deck-set-active" data-slot="1" ${validation.playable ? "" : "disabled"}>P2 사용</button>
        <button class="primary" data-action="deck-save">저장</button>
      </div>
    </div>
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

function deckSelectCard(deck) {
  const validation = validateDeckRecord(deck);
  const hero = deckHeroCard(deck);
  const activeLabels = deckStore.activeDeckIds
    .map((id, index) => id === deck.id ? `P${index + 1}` : null)
    .filter(Boolean)
    .join(" / ");
  return `
    <button class="deck-slot ${deck.id === deckEditor.selectedDeckId ? "selected" : ""}" data-action="deck-select" data-deck="${deck.id}">
      ${hero?.image ? `<img src="${hero.image}" alt="${hero.name}" loading="lazy" />` : `<span class="deck-card-back"></span>`}
      ${activeLabels ? `<em>${activeLabels}</em>` : ""}
      <strong>${escapeHtml(deck.name)}</strong>
      <span>${mainDeckCount(deck)}/${DECK_RULES.mainExact} ${t("main", locale())} · ${sideboardCount(deck)}/${DECK_RULES.sideboardMax} SB</span>
      <small class="${validation.playable ? "valid-text" : "invalid-text"}">${validation.playable ? t("playable", locale()) : t("cannotPlayDeck", locale())}</small>
    </button>
  `;
}

function deckSummaryBadge(deck, label) {
  const validation = validateDeckRecord(deck);
  return `
    <div class="active-deck-badge ${validation.playable ? "" : "invalid"}">
      <span>${label}</span>
      <strong>${escapeHtml(deck?.name || t("noDeck", locale()))}</strong>
      <em>${validation.playable ? t("ready", locale()) : t("invalid", locale())}</em>
    </div>
  `;
}

function deckDetailEmpty(deck) {
  return `
    <div class="deck-preview-card">
      <span class="deck-card-back large"></span>
      <h2>${escapeHtml(deck.name)}</h2>
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
  } else if (["unit", "spell", "gear"].includes(card.type)) {
    const count = cardCount(deck.main, card.cardNumber);
    const sideCountValue = cardCount(deck.sideboard, card.cardNumber);
    buttons.push(`<button data-action="deck-add-main" data-card-number="${card.cardNumber}" ${registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies || mainDeckCount(deck) >= DECK_RULES.mainExact ? "disabled" : ""}>메인 덱 추가 ${count}/${DECK_RULES.maxCopies}</button>`);
    buttons.push(`<button data-action="deck-add-sideboard" data-card-number="${card.cardNumber}" ${registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies || sideboardCount(deck) >= DECK_RULES.sideboardMax ? "disabled" : ""}>${locale() === LOCALES.KO ? "사이드보드 추가" : "Add to Sideboard"} ${sideCountValue}/${DECK_RULES.maxCopies}</button>`);
  }
  return buttons.join("") || `<button disabled>추가할 수 없음</button>`;
}

function deckValidityPanel(validation) {
  return `
    <div class="deck-validity ${validation.playable ? "playable" : ""}">
      <strong>${validation.playable ? "이 덱으로 플레이할 수 있습니다." : "이 덱으로는 아직 플레이할 수 없습니다."}</strong>
      ${validation.messages.length ? `<ul>${validation.messages.map((message) => `<li>${message}</li>`).join("")}</ul>` : ""}
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
      <div class="deck-zone-title"><strong>${t("mainDeck", locale())}</strong><span>${mainDeckCount(deck)}/${DECK_RULES.mainExact}</span></div>
      ${deck.main.map(([number, count]) => compactDeckRow(cardByNumber(number), count, "main")).join("") || `<p class="empty">메인 덱 카드를 추가하세요.</p>`}
    </div>
    <div class="deck-zone-block sideboard-deck-block">
      <div class="deck-zone-title"><strong>${locale() === LOCALES.KO ? "사이드보드" : "Sideboard"}</strong><span>${sideboardCount(deck)}/${DECK_RULES.sideboardMax}</span></div>
      ${deck.sideboard.map(([number, count]) => compactDeckRow(cardByNumber(number), count, "sideboard")).join("") || `<p class="empty">${locale() === LOCALES.KO ? "사이드 카드를 최대 8장 추가할 수 있습니다." : "Add up to 8 sideboard cards."}</p>`}
    </div>
    <div class="deck-zone-block rune-deck-block">
      <div class="deck-zone-title"><strong>${t("runeDeck", locale())}</strong><span>${runeDeckCount(deck)}/${DECK_RULES.runeExact}</span></div>
      <p class="deck-note">룬 덱은 메인 덱 뒤에 표시되지만, 메인 덱 장수와는 별도로 계산됩니다.</p>
      ${Object.values(DOMAINS).filter((domain) => domain !== DOMAINS.ANY).map((domain) => runeDeckRow(deck, domain)).join("")}
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

function runeDeckRow(deck, domain) {
  const count = runeCount(deck, domain);
  return `
    <div class="rune-deck-row">
      <span class="rune-swatch" style="--rune:${RUNE_COLORS[domain]}"></span>
      <strong>${domainText(domain)} ${t("runes", locale()).replace(/s$/u, "")}</strong>
      <em>${count}</em>
      <button class="small-icon" data-action="deck-rune-dec" data-domain="${domain}" ${count <= 0 ? "disabled" : ""}>-</button>
      <button class="small-icon" data-action="deck-rune-inc" data-domain="${domain}">+</button>
    </div>
  `;
}

function cardSearchPanel(deck) {
  const results = filteredDeckCards();
  return `
    <div class="card-search-head">
      <input data-action="deck-search" placeholder="카드 검색..." value="${escapeHtml(deckEditor.search)}" />
      <span class="card-search-count">${results.length} cards</span>
    </div>
    <div class="card-advanced-search">
      <label>카드풀<select data-action="deck-pool-filter">${CARD_POOL_FORMATS.map((pool) => `<option value="${pool.id}" ${pool.id === deckEditor.poolId ? "selected" : ""}>${escapeHtml(pool.name)}</option>`).join("")}</select></label>
      <label>출시 카드팩<select data-action="deck-pack-filter"><option value="all">전체 카드팩</option>${CARD_PACKS.map((pack) => `<option value="${pack.id}" ${pack.id === deckEditor.packId ? "selected" : ""}>${escapeHtml(pack.name)}</option>`).join("")}</select></label>
      <label>종류<select data-action="deck-type-filter">${[["all", "전체"], ["legend", "레전드"], ["unit", "유닛"], ["spell", "주문"], ["gear", "장비"], ["battlefield", "전장"]].map(([value, label]) => `<option value="${value}" ${value === deckEditor.type ? "selected" : ""}>${label}</option>`).join("")}</select></label>
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
    return `<div class="deck-ai-recommendation invalid"><strong>${escapeHtml(pool?.name || recommendation.poolId)} 추천 불가</strong><p>${escapeHtml(recommendation.reason)}</p></div>`;
  }
  const confidence = recommendation.confidence === "high" ? "높음" : recommendation.confidence === "medium" ? "보통" : "낮음";
  const changes = recommendation.changes || [];
  const sideboard = recommendation.sideboard || [];
  return `
    <div class="deck-ai-recommendation">
      <div class="deck-zone-title"><strong>${escapeHtml(pool?.name || recommendation.poolId)} AI 추천</strong><span>세대 ${recommendation.generation} · 표본 ${recommendation.sampleGames} · 신뢰도 ${confidence}</span></div>
      ${recommendation.generation > 0 ? "" : `<p class="deck-note">아직 학습 체크포인트가 없어 기본 휴리스틱의 준비용 추천입니다.</p>`}
      ${changes.length ? `<ul>${changes.map((change) => `<li>${escapeHtml(change.remove.name)} → ${escapeHtml(change.add.name)}</li>`).join("")}</ul><button data-action="deck-ai-apply">추천 교체 적용</button>` : `<p>현재 학습 지식으로 확실한 메인 덱 교체안을 찾지 못했습니다.</p>`}
      ${sideboard.length ? `<details><summary>매치업 사이드보드 제안 ${sideboard.length}개</summary><ul>${sideboard.map((change) => `<li>${escapeHtml(change.outName || "-")} → ${escapeHtml(change.inName || "-")}</li>`).join("")}</ul></details>` : ""}
    </div>
  `;
}

function libraryCard(card, deck) {
  const mainCount = cardCount(deck.main, card.cardNumber);
  const disabled = ["unit", "spell", "gear"].includes(card.type) && mainCount >= DECK_RULES.maxCopies;
  return `
    <button class="library-card ${deckEditor.selectedCardNumber === card.cardNumber ? "selected" : ""}" data-action="deck-card-focus" data-card-number="${card.cardNumber}">
      ${card.image ? `<img src="${card.image}" alt="${cardName(card)}" loading="lazy" />` : `<span class="deck-card-back"></span>`}
      <strong>${cardName(card)}</strong>
      <span>${cardType(card)}${card.energy !== undefined ? ` / ${card.energy}` : ""}</span>
      ${mainCount ? `<em>x${mainCount}</em>` : ""}
      ${disabled ? `<small>${t("max", locale())}</small>` : ""}
    </button>
  `;
}

function loadDeckStore() {
  const fallback = defaultDeckStore();
  try {
    const parsed = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.decks)) return fallback;
    const storedDecks = parsed.decks.length ? parsed.decks.map(normalizeDeckRecord) : [];
    const storedIds = new Set(storedDecks.map((deck) => deck.id));
    const decks = [...storedDecks, ...fallback.decks.filter((deck) => !storedIds.has(deck.id))];
    const activeDeckIds = Array.isArray(parsed.activeDeckIds) && parsed.activeDeckIds.length >= 2
      ? parsed.activeDeckIds
      : fallback.activeDeckIds;
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
    runes: normalizeCountEntries(deck.runes),
    createdAt: deck.createdAt || Date.now(),
    updatedAt: deck.updatedAt || Date.now()
  };
}

function normalizeCountEntries(entries) {
  return normalizeDeckCountEntries(entries);
}

function saveDeckStore() {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deckStore));
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
  configureOnlineServer(DEFAULT_MULTIPLAYER_SERVER);
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
  const before = game.selectedCardId;
  selectCard(game, cardId);
  if (game.selectedCardId !== before || game.selectedCardId === cardId) {
    if (isOnlineGame()) onlineSelectedCardId = game.selectedCardId;
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
  const id = `deck-${Date.now()}`;
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

function runeDeckCount(deck) {
  return deckRuneDeckCount(deck);
}

function runeCount(deck, domain) {
  return deckRuneCount(deck, domain);
}

function cardCount(entries, cardNumber) {
  return deckCardCount(entries, cardNumber);
}

function mutateSelectedDeck(mutator) {
  const deck = getSelectedDeckRecord();
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
  if (mainDeckCount(deck) >= DECK_RULES.mainExact || registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies) return;
  setCountEntry(deck.main, cardNumber, count + 1);
}

function removeMainDeckCard(deck, cardNumber) {
  setCountEntry(deck.main, cardNumber, cardCount(deck.main, cardNumber) - 1);
}

function addSideboardCard(deck, cardNumber) {
  const card = cardByNumber(cardNumber);
  if (!card || !["unit", "spell", "gear"].includes(card.type)) return;
  if (sideboardCount(deck) >= DECK_RULES.sideboardMax || registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies) return;
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

function updateRune(deck, domain, delta) {
  setCountEntry(deck.runes, domain, Math.max(0, runeCount(deck, domain) + delta));
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
    runes: deck.runes.flatMap(([domain, count]) => Array.from({ length: count }, () => makeRune(domain)))
  };
}

function resetGameUiState() {
  logOpen = false;
  handOpen = false;
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
  resetPresentationState(presentationState);
  activeImpact = null;
  resultRevealReady = true;
  resultDismissed = false;
  if (impactDismissTimer) clearTimeout(impactDismissTimer);
  impactDismissTimer = null;
  clearRealtimeFeedback();
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
            <p>${locked ? (locale() === LOCALES.KO ? "무승부였으므로 카드를 교체할 수 없고 직전 Battlefield를 그대로 사용합니다." : "Cards cannot be exchanged after a draw, and both previous Battlefields are locked.") : (locale() === LOCALES.KO ? "메인 덱 카드와 사이드 카드를 같은 수만큼 교환해 주세요." : "Exchange the same number of Main Deck and Sideboard cards.")}</p>
          </div>
          <div class="match-score"><strong>P1 ${wins.p1}</strong><span>:</span><strong>${wins.p2} P2</strong></div>
        </header>
        <div class="sideboarding-player-banner">${isOnlineGame() ? (locale() === LOCALES.KO ? "내 사이드보드" : "Your sideboard") : `${playerId.toUpperCase()} · ${locale() === LOCALES.KO ? "다른 플레이어는 화면을 보지 마세요" : "Other player, please look away"}`}</div>
        <div class="sideboarding-grid">
          <section class="sideboarding-column">
            <div class="deck-zone-title"><strong>${t("mainDeck", locale())}</strong><span>${mainDeckCount(draft)}/${DECK_RULES.mainExact}</span></div>
            <p class="deck-note">${sideboardSelectedMain ? (locale() === LOCALES.KO ? "이제 넣을 사이드 카드를 선택하세요." : "Now choose a Sideboard card to bring in.") : (locale() === LOCALES.KO ? "뺄 카드를 먼저 선택하세요." : "Choose a card to take out first.")}</p>
            <div class="sideboarding-card-list">${draft.main.map(([number, count]) => sideboardCardRow(number, count, "main", locked || submitted)).join("")}</div>
          </section>
          <section class="sideboarding-column">
            <div class="deck-zone-title"><strong>${locale() === LOCALES.KO ? "사이드보드" : "Sideboard"}</strong><span>${sideboardCount(draft)}/${DECK_RULES.sideboardMax}</span></div>
            <p class="deck-note">${locale() === LOCALES.KO ? "교체된 메인 덱 카드는 새 사이드보드가 됩니다." : "Cards removed from the Main Deck become the new Sideboard."}</p>
            <div class="sideboarding-card-list">${draft.sideboard.map(([number, count]) => sideboardCardRow(number, count, "sideboard", locked || submitted)).join("") || `<p class="empty">${locale() === LOCALES.KO ? "등록된 사이드 카드가 없습니다." : "No registered Sideboard cards."}</p>`}</div>
          </section>
        </div>
        ${chooser ? `<fieldset class="first-player-choice" ${submitted ? "disabled" : ""}><legend>${locale() === LOCALES.KO ? "이전 게임 패자: 다음 게임의 선공 플레이어를 선택하세요." : "Previous game loser: choose who plays first."}</legend><label><input type="radio" name="next-first" value="p1" data-action="sideboard-first-player" ${sideboardFirstPlayerId === "p1" ? "checked" : ""}/> P1</label><label><input type="radio" name="next-first" value="p2" data-action="sideboard-first-player" ${sideboardFirstPlayerId === "p2" ? "checked" : ""}/> P2</label></fieldset>` : ""}
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
    decks: pair.map(resolveDeckRecord)
  });
  resetGameUiState();
  appView = "game";
}

function startAiGameFromMenu() {
  clearOnlineSeat();
  const pair = activeDeckRecords();
  if (pair.length !== 2 || pair.some((deck) => !validateDeckRecord(deck).playable)) return;
  localMatch = createMatchState({ decks: pair, sideboardingEnabled: settings.sideboardingEnabled });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  game = createGame({
    interactive: true,
    randomFirstPlayer: true,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    decks: pair.map(resolveDeckRecord)
  });
  aiMode = true;
  neuralAiSession?.reset();
  aiHumanPlayerId = game.players[0].id;
  aiPlayerId = game.players[1].id;
  aiReplay = createAiReplay(game, {
    humanPlayerId: aiHumanPlayerId,
    aiPlayerId,
    model: activeCoachModel(),
    deckIds: pair.map((deck) => deck.id)
  });
  resetGameUiState();
  appView = "game";
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
  if (!isOnlineGame()) {
    const before = aiReplay ? cloneGame(game) : null;
    const actorId = aiActiveActorId(game);
    const result = applyLocal?.();
    recordLocalGameIfComplete();
    if (aiReplay && result?.ok) queueReplayAnalysis(before, actorId, command, result);
    return;
  }
  if (!['surrender', 'restartGame', 'submitSideboard'].includes(command.kind) && !viewerCanAct()) {
    online.error = "상대의 턴 또는 Focus입니다.";
    render();
    return;
  }
  online.commandPending = { kind: command.kind, startedAt: Date.now() };
  render();
  sendOnlineCommand(online.roomId, online.playerToken, command)
    .then(() => {
      online.error = "";
    })
    .catch((error) => {
      online.error = error.message;
    })
    .finally(() => {
      online.commandPending = null;
      render();
    });
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
      const before = cloneGame(game);
      const legal = enumerateLegalActions(game, aiPlayerId);
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
  }, 240);
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

function prepareUiMotion() {
  const current = uiSnapshot();
  const previous = previousUiSnapshot;
  previousUiSnapshot = current;
  if (!previous) return emptyMotion();

  const motion = emptyMotion();
  motion.drawn = diffSet(current.hand, previous.hand);
  motion.entered = diffSet(current.board, previous.board);
  motion.chained = diffSet(current.chain, previous.chain);
  motion.trashed = diffSet(current.trash, previous.trash);
  motion.feedback = buildRealtimeFeedback(current, previous, motion);

  return motion;
}

function uiSnapshot() {
  const chainItems = visibleChainItems().map((item, index) => chainItemSnapshot(item, index));
  const cardZones = cardZoneSnapshot();
  return {
    phase: game.phase,
    currentPlayerId: game.currentPlayerId,
    turnNumber: game.turnNumber,
    logHead: game.log[0] || "",
    effectStamp: game.effectFlash?.stamp || 0,
    hand: new Set(game.players.flatMap((player) => player.hand.map((card) => card.instanceId))),
    board: new Set([
      ...game.players.flatMap((player) => player.base.map((card) => card.instanceId)),
      ...game.battlefields.flatMap((field) => field.units.map((card) => card.instanceId))
    ]),
    trash: new Set(game.players.flatMap((player) => player.trash.map((card) => card.instanceId))),
    chain: new Set([
      ...(game.showdown?.chain.map((item) => item.card.instanceId) || []),
      ...(game.actionChain?.chain.map((item) => item.card.instanceId) || [])
    ]),
    chainItems,
    chainItemIds: new Set(chainItems.map((item) => item.id)),
    cardZones
  };
}

function visibleChainItems() {
  return game.actionChain?.chain || game.showdown?.chain || [];
}

function chainItemSnapshot(item, index) {
  const card = item.card || {};
  const targets = chainItemTargetIds(item);
  return {
    id: item.id || `${card.instanceId || "chain"}-${index}`,
    cardId: card.instanceId,
    playerId: item.playerId,
    name: chainItemTitle(item),
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
    for (const item of field.hidden || []) zones.set(item.card.instanceId, { playerId: item.ownerId, zone: "hidden", battlefieldId: field.instanceId });
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
  }, 2600);
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
    return `${championPlayer.name}: ${t("chooseChampion", locale())}`;
  }
  if (game.phase === "battlefield-select") {
    const setupPlayer = game.players.find((player) => player.id === game.setupPlayerId);
    return `${setupPlayer.name}: ${t("chooseBattlefield", locale())}`;
  }
  if (game.phase === "mulligan") {
    const mulliganPlayer = game.players.find((player) => player.id === game.mulligan?.playerId);
    return `${mulliganPlayer.name}: ${t("mulligan", locale())}`;
  }
  if (game.phase === "showdown") return `${currentPlayer(game).name}: ${t("showdownPriority", locale())}`;
  return t("playerTurn", locale(), { name: currentPlayer(game).name });
}

function interactionStatus() {
  const actorId = activePlayerId();
  const actor = game.players.find((player) => player.id === actorId) || currentPlayer(game);
  const actorName = actor?.name || t("nobody", locale());
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
    const player = game.players.find((candidate) => candidate.id === payment.playerId);
    const card = paymentDisplayCard(player, payment) || payment.effectPayment?.sourceCard;
    const needed = payment.energyCost ?? card?.energy ?? 0;
    const selected = (payment.energyRuneIds?.length || 0) + (payment.poolEnergyIds?.length || 0);
    return {
      tone: mine ? "attention" : "waiting",
      label: t("paymentInProgress", locale()),
      title: t("playerMustPay", locale(), { name: actorName }),
      detail: needed > 0
        ? t("energyProgressDetail", locale(), { selected, needed, remaining: Math.max(0, needed - selected) })
        : t("finishDialog", locale())
    };
  }
  if (game.pendingChoice) {
    const choice = game.pendingChoice;
    const source = choice.card ? cardName(choice.card) : t("effect", locale());
    return {
      tone: mine ? "attention" : "waiting",
      label: choice.data?.declareTrigger ? t("declaring", locale()) : t("resolving", locale()),
      title: t("playerMustChoose", locale(), { name: actorName }),
      detail: `${source} · ${localizedChoicePrompt(choice)}`
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
            <span>${first.name}</span>
          </div>
          <div class="versus">VS</div>
          <div class="first-seat second">
            ${imageCard(second.legend, "select-only")}
            <strong>${t("second", locale())}</strong>
            <span>${second.name}</span>
          </div>
        </div>
        <button class="primary confirm-first-player" data-action="confirm-first-player" ${viewerCanAct() ? "" : "disabled"}>${t("confirm", locale())}</button>
      </article>
    </section>
  `;
}

function winnerName() {
  return game.players.find((player) => player.id === game.winnerId)?.name || t("nobody", locale());
}

function updateGamePresentation() {
  const snapshot = snapshotPresentationGame(game, effectiveMight);
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
        <span>${escapeHtml(korean ? activeImpact.kicker : activeImpact.kickerEn)}</span>
        <strong>${escapeHtml(korean ? activeImpact.titleKo : activeImpact.titleEn)}</strong>
      </div>
    </section>
  `;
}

function gameResultModal() {
  if (game.phase !== "complete" || !resultRevealReady || resultDismissed) return "";
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
        <p>${korean ? `${winner?.name || winnerName()}님이 전장을 지배했습니다.` : `${winner?.name || winnerName()} controlled the battlefield.`}</p>
      </div>
      <div class="result-scoreline">
        <strong>${winner?.score || 0}</strong>
        <span>${winner?.name || ""}<b>FINAL</b>${loser?.name || ""}</span>
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
        <span>${korean ? `${highlight.turn}라운드` : `Round ${highlight.turn}`} ${actor ? `· ${escapeHtml(actor.name)}` : ""}</span>
        <strong>${escapeHtml(korean ? highlight.titleKo : highlight.titleEn)}</strong>
        <p>${escapeHtml(korean ? highlight.detailKo : highlight.detailEn)}</p>
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
    <section class="score-track" aria-label="Score">
      <span class="score-name">${left.name}</span>
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
      <span class="score-name right">${right.name}</span>
    </section>
  `;
}

function gamePanel(player) {
  const selected = uiSelectedCard();
  const bottomPlayer = viewerPlayer();
  const topPlayer = opponentPlayer();
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
          <section class="battlefield-mat" aria-label="${t("battlefields", locale())}">
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
      <div class="floating-panels ${game.phase === "showdown" ? "showdown-dock" : ""} ${game.pendingPayment || game.pendingChoice || graveyardOpenPlayerId || banishedOpenPlayerId ? "has-modal" : ""}">
        ${game.phase === "showdown" ? "" : ""}
        ${game.pendingPayment ? paymentPanel() : ""}
        ${game.pendingChoice ? choicePanel() : ""}
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
          <h2>${player.name} ${t("hand", locale())}</h2>
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
  const contexts = units.map((unit) => selectedContext(unit.instanceId));
  if (contexts.every((context) => context?.location !== "base")) {
    options.push({ id: "base", label: t("moveToBase", locale()) });
  }
  for (const [index, field] of visibleBattlefields().entries()) {
    const legal = units.every((unit, unitIndex) => {
      const context = contexts[unitIndex];
      if (!context || context.location === field.instanceId) return false;
      if (context.location !== "base" && !hasKeyword(unit, "Ganking")) return false;
      return true;
    });
    if (legal) options.push({ id: field.instanceId, label: t("moveToField", locale(), { n: index + 1 }) });
  }
  return options;
}

function logDrawer() {
  const interaction = interactionStatus();
  return `
    <aside class="log-drawer" aria-label="${t("eventTimeline", locale())}">
      <div class="section-head">
        <div>
          <h2>${t("eventTimeline", locale())}</h2>
          <span>${game.log.length} ${t("recentEvents", locale())}</span>
        </div>
        <button data-action="toggle-log">${t("close", locale())}</button>
      </div>
      <div class="log-current status-${interaction.tone}">
        <strong>${interaction.title}</strong>
        <span>${interaction.detail}</span>
      </div>
      <div class="log-list">
        ${game.log.map((entry, index) => logEntryView(entry, index)).join("")}
      </div>
    </aside>
  `;
}

function logEntryView(entry, index) {
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
      <span class="log-index">${game.log.length - index}</span>
      <p>${escapeHtml(localizedLogEntry(value))}</p>
    </article>
  `;
}

function localizedLogEntry(entry) {
  const value = String(entry || "");
  if (locale() !== LOCALES.KO) return value;
  const patterns = [
    [/^(.+) plays (.+) from the Champion Zone to base\.$/u, "$1님이 챔피언 존의 $2 카드를 기지에 사용했습니다."],
    [/^(.+) is paying for (.+)\.$/u, "$1님이 $2 비용을 지불하고 있습니다."],
    [/^(.+) starts turn (\d+)\.$/u, "$1님의 $2턴이 시작됐습니다."],
    [/^(.+) ends the turn\. All units heal\.$/u, "$1님이 턴을 종료했습니다. 모든 유닛이 회복합니다."],
    [/^(.+) keeps their opening hand\.$/u, "$1님이 시작 손패를 유지했습니다."],
    [/^(.+) chooses cards to mulligan\.$/u, "$1님이 멀리건 카드를 선택합니다."],
    [/^(.+) chooses (.+) as their starting champion\.$/u, "$1님이 시작 챔피언으로 $2 카드를 선택했습니다."],
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
    ["Each player chooses one starting champion.", "각 플레이어가 시작 챔피언 1명을 선택합니다."]
  ]);
  if (fixed.has(value)) return fixed.get(value);
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
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
  const paymentReady = paymentCanConfirm(player, card, payment);
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
          <strong>${displayCard.name}</strong>
          <span>${payment.source === "effectEnergy"
            ? t("effectPayment", locale())
            : payment.source === "hideCard" ? t("payCost", locale()) : t("playCost", locale())}</span>
        </aside>
        <div class="payment-cost-area">
          ${optionalPaymentControls(payment)}
          ${paymentAddControls(player)}
          ${poolEnergyControls(player, payment, energyNeeded)}
          <div class="pay-runes">
            ${player.runes.map((rune) => paymentRune(rune, payment, displayCard, powerCost)).join("")}
          </div>
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
  if (parts.length === 1) parts.push(t("noCost", locale()));
  return parts.join(" - ");
}

function poolEnergyControls(player, payment, energyNeeded) {
  const pool = runePoolEnergy(player);
  const energyRuneIds = payment.energyRuneIds || [];
  if (!pool.length) return "";
  return `
    <div class="pool-energy-list">
      ${pool.map((resource) => {
        const selected = (payment.poolEnergyIds || []).includes(resource.id);
        const usable = poolEnergyCanPay(resource);
        const limitReached = !selected && ((payment.poolEnergyIds?.length || 0) + energyRuneIds.length >= energyNeeded);
        return `
          <button
            class="pool-energy ${selected ? "selected" : ""}"
            data-action="pay-pool-energy"
            data-energy="${resource.id}"
            ${limitReached || !usable ? "disabled" : ""}
            title="${resource.sourceName}${resource.restriction ? ` - ${resource.restriction} only` : ""}"
          >
            <span class="pool-energy-orb">${domainSwatches(resource.domains)}</span>
            <strong>${selected ? t("selected", locale()) : t("generatedEnergy", locale())}</strong>
            <span>${resource.sourceName}</span>
          </button>
        `;
      }).join("")}
    </div>
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

function paymentAddControls(player) {
  const options = activatedAddResources(player);
  if (!options.length) return "";
  return `
    <div class="payment-add-actions">
      ${options.map((card) => `
        <button data-action="activate-card" data-card="${card.instanceId}" title="${card.text || card.name}">
          ${t("addEnergy", locale())} - ${cardName(card)}
        </button>
      `).join("")}
    </div>
  `;
}

function activatedAddResources(player) {
  if (!game.pendingPayment || game.pendingChoice) return [];
  if (game.pendingPayment.playerId !== player.id) return [];
  const paidCard = paymentDisplayCard(player, game.pendingPayment);
  return controlledCards(player)
    .filter((card) => card.controllerId === player.id)
    .filter((card) => !card.exhausted)
    .filter((card) => card.tags?.includes("Reaction") || card.keywords?.includes("Reaction"))
    .filter((card) => (card.effects || [])
      .filter((effect) => effect.timing === "activated")
      .some((effect) =>
        effect.kind === "addEnergy"
        && (effect.restriction !== "spell" || paidCard?.type === "spell")
      ));
}

function controlledCards(player) {
  return [
    player.legend,
    player.champion,
    ...player.base,
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
          title="${effect.label}"
        >
          ${effect.selected ? t("on", locale()) : t("off", locale())} - ${effect.label}
        </button>
      `).join("")}
    </div>
  `;
}

function paymentCanConfirm(player, card, payment) {
  const energyRuneIds = payment.energyRuneIds || [];
  const powerRuneIds = payment.powerRuneIds || [];
  const energyRunes = energyRuneIds
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);
  const energyCost = payment.energyCost ?? (card.energy || 0);
  const powerCost = payment.powerCost || card.power || [];
  const selectedPoolEnergy = (payment.poolEnergyIds || [])
    .map((id) => runePoolEnergy(player).find((resource) => resource.id === id))
    .filter(Boolean);
  if (selectedPoolEnergy.length !== (payment.poolEnergyIds || []).length) return false;
  if (selectedPoolEnergy.some((resource) => !poolEnergyCanPay(resource))) return false;
  if (energyRunes.length + selectedPoolEnergy.length !== energyCost) return false;
  if (energyRunes.some((rune) => rune.exhausted)) return false;

  const selectedPowerRunes = powerRuneIds
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);

  return powerSelectionSatisfies(selectedPowerRunes, powerCost, true);
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

function powerProgress(player, card, payment) {
  const powerCost = payment.powerCost || card.power || [];
  if (!powerCost.length) return "0/0";
  const selectedPowerRunes = (payment.powerRuneIds || [])
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);
  return powerCost
    .map((requirement) => {
      const available = selectedPowerRunes.filter((rune) => powerMatches(rune, requirement)).length;
      return `${Math.min(available, requirement.amount)}/${requirement.amount} ${requirement.domain}`;
    })
    .join(", ");
}

function powerMatches(rune, requirement) {
  if (rune.temporaryResource) return false;
  return requirement.domain === "Any" || rune.domain === requirement.domain;
}

function powerSelectionSatisfies(runes, requirements, exact = false) {
  if (exact && runes.length !== totalPowerAmount(requirements)) return false;
  return Boolean(choosePowerRunes(runes, requirements));
}

function totalPowerAmount(requirements) {
  return requirements.reduce((sum, requirement) => sum + requirement.amount, 0);
}

function choosePowerRunes(runes, requirements) {
  const slots = expandPowerRequirements(requirements);
  if (slots.length === 0) return [];
  if (runes.length < slots.length) return null;
  const used = new Set();
  const chosen = [];
  const assign = (slotIndex) => {
    if (slotIndex >= slots.length) return true;
    const requirement = slots[slotIndex];
    for (const rune of runes) {
      if (used.has(rune.instanceId) || !powerMatches(rune, requirement)) continue;
      used.add(rune.instanceId);
      chosen.push(rune);
      if (assign(slotIndex + 1)) return true;
      chosen.pop();
      used.delete(rune.instanceId);
    }
    return false;
  };
  return assign(0) ? [...chosen] : null;
}

function expandPowerRequirements(requirements) {
  return requirements
    .flatMap((requirement) => Array.from({ length: requirement.amount }, () => requirement))
    .sort((left, right) => {
      if (left.domain === "Any" && right.domain !== "Any") return 1;
      if (left.domain !== "Any" && right.domain === "Any") return -1;
      return 0;
    });
}

function runeCanPayPower(rune, card, payment, powerCost) {
  const powerRuneIds = payment.powerRuneIds || [];
  if (powerRuneIds.includes(rune.instanceId)) return true;
  if (!powerCost.some((requirement) => powerMatches(rune, requirement))) return false;
  if (powerRuneIds.length >= totalPowerAmount(powerCost)) return false;
  return true;
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
  return `
    <article class="pay-rune ${energySelected ? "selected-energy" : ""} ${powerSelected ? "selected-power" : ""}">
      <span class="rune" style="--rune:${rune.color}">
        <span class="rune-swatch"></span>${domainText(rune.domain)}${rune.exhausted ? ` ${t("spent", locale())}` : ""}
        ${energySelected ? `<strong>${t("energySelected", locale())}</strong>` : ""}
        ${powerSelected ? `<strong>${t("powerSelected", locale())}</strong>` : ""}
      </span>
      <div class="actions">
        <button data-action="pay-rune" data-rune="${rune.instanceId}" data-mode="energy" ${energyDisabled ? "disabled" : ""}>${t("energy", locale())}</button>
        <button data-action="pay-rune" data-rune="${rune.instanceId}" data-mode="power" ${powerDisabled ? "disabled" : ""}>${t("power", locale())}</button>
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
          <h2>${player.name} ${t("trash", locale())}</h2>
          <span>${t("cardCount", locale(), { n: player.trash.length })}</span>
        </div>
        <button data-action="close-graveyard">${t("close", locale())}</button>
      </div>
      <div class="cards graveyard-cards">
        ${player.trash.map((card) => `
          <article class="${imageCardClass(card, "graveyard-card")}" data-card-id="${card.instanceId}">
            ${cardImage(card)}
          </article>
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
        <div><h2>${player.name} ${t("banished", locale())}</h2><span>${t("cardCount", locale(), { n: cards.length })}</span></div>
        <button data-action="close-banished">${t("close", locale())}</button>
      </div>
      <div class="cards graveyard-cards">
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
      .filter((item) => item.ownerId === player.id)
      .map((item) => ({ ...item, fieldName: field.name }))
  );
  return `
    <section class="intel-panel modal-panel reveal-panel">
      <div class="section-head">
        <div>
          <h2>${player.name}: ${t("revealedIntel", locale())}</h2>
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
  if (choice.effect === "combatDamage") return combatDamagePanel(choice);
  if (choice.effect === "alphaStrikeDamage") return alphaStrikeDamagePanel(choice);
  if (choice.effect === "payDeflect") return deflectPaymentPanel(choice);
  if (choice.effect === "predictChoice") return predictChoicePanel(choice);
  if (choice.effect === "acknowledgeReveal") return revealConfirmationPanel(choice);
  const instruction = choiceEffectInstruction(choice);
  return `
    <section class="choice-panel modal-panel ${choice.effect === "sabotage" ? "reveal-panel" : ""}">
      <div class="section-head">
        <div>
          <h2>${choice.effect === "sabotage" ? `${cardName(choice.card)}: ${t("revealedHand", locale())}` : `${choice.data?.declareTrigger ? t("declaring", locale()) : t("resolving", locale())} ${cardName(choice.card)}`}</h2>
          <span>${localizedChoicePrompt(choice)}</span>
          ${instruction ? `<p class="choice-instruction">${instruction}</p>` : ""}
        </div>
        ${choice.optional ? `<button data-action="decline-effect">${t("decline", locale())}</button>` : ""}
      </div>
      ${choiceRevealedCards(choice)}
      <div class="choice-grid">
        ${choice.options.map(choiceOptionButton).join("")}
      </div>
    </section>
  `;
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

function localizedChoicePrompt(choice) {
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
      <div class="actions">
        <button type="button" class="primary" data-action="choose-effect" data-choice="continue">${t("confirm", locale())}</button>
      </div>
    </section>
  `;
}

function choiceOptionButton(option) {
  const preview = choicePreviewCard(option);
  const label = preview && !preview.redacted ? cardName(preview) : localizedChoiceOptionLabel(option);
  const context = option.cardId ? choiceCardContext(option.cardId, preview) : null;
  const ownership = choiceOwnership(context, preview);
  const location = context ? choiceLocationLabel(context) : "";
  return `
    <div class="choice-option-wrap">
      <button type="button" class="choice-option ${option.cardId ? `card-choice-option choice-owner-${ownership.tone}` : "text-choice-option"} ${option.disabled ? "disabled-choice" : ""}" data-action="choose-effect" data-choice="${option.id}" data-card-id="${option.cardId || ""}" ${option.disabled ? "disabled" : ""}>
        ${option.cardId ? choiceOptionImage(option) : ""}
        <span class="choice-card-name">${label}</span>
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
  if (game.showdown?.chain.some((item) => item.card?.instanceId === cardId) || game.actionChain?.chain.some((item) => item.card?.instanceId === cardId)) {
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
    return field ? `${cardName(field)} · ${t("battlefield", locale())}` : t("battlefield", locale());
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
    swap: t("reverseOrder", locale())
  };
  if (labels[option.id]) return labels[option.id];
  if (/^Pay Energy \d+$/i.test(option.label || "")) return option.label.replace(/^Pay Energy/i, t("payEnergy", locale()));
  if (/^(Do not|Decline|Keep cards)/i.test(option.label || "")) return t("decline", locale());
  return option.label;
}

function choicePreviewCard(option) {
  return option?.card && !option.card.redacted ? option.card : findChoicePreviewCard(option?.cardId);
}

function choiceEffectInstruction(choice) {
  const sourceName = choice.card ? cardName(choice.card) : t("effect", locale());
  const amount = choice.data?.amount || choice.data?.remaining || 0;
  if (locale() === LOCALES.KO) {
    const instructionsKo = {
      trashGear: `${sourceName}: 처치하여 소유자의 폐기장에 놓을 장비를 선택하세요.`,
      markTemporaryGear: `${sourceName}: 일시적으로 만들 장비를 선택하세요.`,
      damageUnit: `${sourceName}: 피해 ${amount || "지정된 수치"}를 받을 유닛을 선택하세요.`,
      returnUnitToHand: `${sourceName}: 소유자의 손으로 되돌릴 유닛을 선택하세요.`,
      readyUnit: `${sourceName}: 준비시킬 아군 탈진 유닛을 선택하세요.`,
      sabotage: `${sourceName}: 재활용할 상대의 공개된 비유닛 카드를 선택하세요.`,
      equipGear: `${sourceName}: 이 장비를 부착할 유닛을 선택하세요.`,
      stealEnemyGear: `${sourceName}: 추가 비용을 지불한 뒤 가져올 적 장비를 선택하세요.`,
      payDeflect: `${sourceName}: 굴절 파워를 지불할 룬을 선택하세요.`,
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
      counterSpell: `${sourceName}: 무효화할 체인의 주문을 선택하세요.`,
      counterChainCard: `${sourceName}: 무효화할 체인의 주문을 선택하세요.`,
      counterUnlessPayEnergy: `${sourceName}: 조종자가 에너지를 지불하지 않으면 무효화할 주문을 선택하세요.`,
      counterUnlessPay: `${sourceName}: 조종자가 에너지를 지불하지 않으면 무효화할 주문을 선택하세요.`,
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
          <span>${t("assigningDamage", locale(), { actor: assigning?.name || t("nobody", locale()), amount: choice.data?.remaining || 0, target: targetPlayer?.name || t("opponent", locale()) })}</span>
        </div>
      </div>
      <div class="combat-summary">
        <strong>${choice.data?.remaining || 0}</strong>
        <span>available damage</span>
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
        ? `이 대상을 선택하려면 파워로 사용할 룬 ${amount}개를 선택해야 합니다. 선택한 룬은 룬 덱으로 재활용됩니다.`
        : `Choose ${amount} rune${amount === 1 ? "" : "s"} to pay as Power. Chosen runes are recycled to the Rune Deck.`}</p>
      <div class="deflect-rune-grid">
        ${choice.options.map((option) => {
          const rune = findVisibleCard(option.cardId);
          return `
            <button type="button" class="deflect-rune-option" data-action="choose-effect" data-choice="${option.id}">
              <span class="rune-swatch" style="--rune:${rune?.color || "#94a3b8"}"></span>
              <strong>${rune ? domainText(rune.domain) : option.label}</strong>
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
        <span>available damage</span>
        <small>${choiceEffectInstruction(choice)}</small>
      </div>
      <div class="alpha-strike-targets">
        ${targets.map((option) => {
          const target = findVisibleCard(option.cardId);
          return `
            <div class="alpha-strike-target">
              ${choiceOptionImage(option)}
              <strong>${target ? cardName(target) : option.label}</strong>
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
  const amountLabel = info.amount ? `${info.amount} damage${info.lethalNow ? " lethal" : ""}` : "";
  return `
    <button
      class="choice-option card-choice-option combat-choice ${legal ? "" : "disabled-choice"}"
      data-action="choose-effect"
      data-choice="${optionId}"
      data-card-id="${info.cardId}"
      ${legal ? "" : "disabled"}
    >
      ${choiceOptionImage({ cardId: info.cardId })}
      <span>${card?.name || "Unit"}</span>
      <strong>${legal ? amountLabel : info.reason}</strong>
    </button>
  `;
}

function choiceOptionImage(option) {
  const cardId = typeof option === "string" ? option : option.cardId;
  const optionCard = typeof option === "object" ? option.card : null;
  const visibleCard = findVisibleCard(cardId);
  const card = option?.revealed && optionCard ? optionCard : (visibleCard && !visibleCard.redacted ? visibleCard : optionCard || visibleCard || null);
  if (!card && option.image) return `<span class="choice-card-art"><img src="${option.image}" alt="${option.label || "Card"}" loading="lazy" /></span>`;
  if (!card) return `<div class="choice-card-fallback">${option.label || "Card"}</div>`;
  if (!card.image) return `<div class="choice-card-fallback">${card.name}</div>`;
  return `<span class="choice-card-art"><img src="${card.image}" alt="${card.name}" loading="lazy" /></span>`;
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
    ...(game.showdown?.chain.map((item) => item.card) || []),
    ...(game.actionChain?.chain.map((item) => item.card) || [])
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
  const chain = [...showdown.chain].reverse();
  return `
    <section class="showdown-panel">
      <div class="section-head">
        <div>
          <h2>${t("showdown", locale())}: ${field ? cardName(field) : t("battlefield", locale())}</h2>
          <span>${chain.length ? t("resolveChainFirst", locale()) : t("passToFight", locale())}</span>
        </div>
        <button class="primary" data-action="pass-showdown">${t("pass", locale())}</button>
      </div>
      <div class="chain-row">
        ${chain.map((item, index) => chainCard(item, index)).join("") || `<p class="empty">${t("chainEmpty", locale())}</p>`}
      </div>
    </section>
  `;
}

function chainCard(item, index) {
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  const motionClass = uiMotion.chained.has(item.card.instanceId)
    ? (hasKeyword(item.card, "Ambush") ? "ambush-chain" : (item.card.tags?.includes("Reaction") ? "reaction-chain" : "chain-enter"))
    : "";
  return `
    <button type="button" class="chain-card ${motionClass}" data-action="view-chain-card" data-card-id="${item.card.instanceId}" title="${t("viewFullCard", locale())}">
      <strong>${t(index === 0 ? "next" : "queued", locale())}</strong>
      <span>${cardName(item.card)}</span>
      <small>${player?.name || ""} / ${t(item.status || "finalized", locale())}</small>
    </button>
  `;
}

function chainZonePanel() {
  const chain = game.actionChain || game.showdown;
  const chainItems = chain ? [...normalizeUiChain(chain.chain)].reverse() : [];
  const activeTriggerChoice = game.pendingChoice?.data?.triggerId ? game.pendingChoice : null;
  const triggerItems = [
    ...(activeTriggerChoice ? [{
      id: activeTriggerChoice.data.triggerId,
      itemType: "trigger",
      playerId: activeTriggerChoice.playerId,
      card: activeTriggerChoice.card,
      trigger: { sourceCardId: activeTriggerChoice.card?.instanceId, kind: activeTriggerChoice.effect },
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
  const items = [...chainItems, ...triggerItems];
  const responding = responsePromptInfo();
  if (!items.length && !responding) return "";
  return `
    <section class="chain-zone" aria-label="${t("processingQueue", locale())}" aria-live="polite">
      <div class="chain-zone-head">
        <div>
          <strong>${t("processingQueue", locale())}</strong>
          <span>${items.length ? `${items.length} ${t("pending", locale())}` : t("responseWindow", locale())}</span>
        </div>
        ${responding ? `<em>${t("youMayRespond", locale())}</em>` : ""}
      </div>
      <div class="chain-stack">
        ${items.map((item, index) => chainZoneItem(item, items.length - index)).join("") || `<p class="empty">${t("noChainItem", locale())}</p>`}
      </div>
      ${responding ? responsePrompt(responding) : ""}
    </section>
  `;
}

function normalizeUiChain(items = []) {
  return items.map((item, index) => ({
    ...item,
    id: item.id || `${item.card?.instanceId || "chain"}-${index}`,
    status: item.status || "pending"
  }));
}

function chainZoneItem(item, order) {
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  const targets = chainItemTargetIds(item).map(targetLabel).filter(Boolean);
  const source = chainItemSourceTitle(item);
  const previewCardId = item.card?.instanceId || item.trigger?.sourceCardId || "";
  const itemClass = [
    "chain-zone-item",
    uiMotion.chained.has(item.card?.instanceId) ? "chain-zone-new" : "",
    item.status ? `status-${item.status}` : ""
  ].filter(Boolean).join(" ");
  return `
    <button type="button" class="${itemClass}" data-action="view-chain-card" data-card-id="${previewCardId}" title="${t("viewFullCard", locale())}" ${previewCardId ? "" : "disabled"}>
      <b>[${order}] ${playerPerspectiveLabel(item.playerId)}</b>
      <strong>${chainItemTitle(item)}</strong>
      <span>${t("source", locale())}: ${source}</span>
      ${targets.length ? `<small>${t("target", locale())}: ${targets.join(", ")}</small>` : ""}
      <em>${t(item.status || "pending", locale())}</em>
    </button>
  `;
}

function realtimeFeedbackOverlay() {
  const feedback = uiMotion.feedback || recentFeedback;
  if (!feedback) return "";
  const targets = (feedback.targetIds || []).map(targetLabel).filter(Boolean);
  const sourceZone = feedback.sourceZone ? `${t("from", locale())}: ${sourceZoneLabel(feedback.sourceZone)}` : "";
  return `
    <section class="realtime-feedback ${feedback.kind} persistent-feedback" aria-live="polite">
      <button type="button" class="feedback-dismiss" data-action="dismiss-feedback" aria-label="${t("close", locale())}">×</button>
      <span>${feedback.title}</span>
      <strong>${feedback.name}</strong>
      ${sourceZone ? `<em>${sourceZone}</em>` : ""}
      ${targets.length ? `<small>${t("target", locale())}: ${targets.join(", ")}</small>` : ""}
      ${feedback.result ? `<p>${localizedLogEntry(feedback.result)}</p>` : ""}
    </section>
  `;
}

function responsePromptInfo() {
  const chain = game.actionChain || (game.phase === "showdown" ? game.showdown : null);
  if (!chain || chain.priorityPlayerId !== viewerPlayerId() || game.pendingChoice || game.pendingPayment) return null;
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
  const card = item?.card || {};
  const targets = [
    ...(card.declaredPlayTargets || []).flatMap((target) => [
      target.cardId,
      target.targetId,
      target.unitId,
      target.battlefieldId,
      target.destinationId
    ]),
    ...(card.declaredPlayChoices || []).flatMap((choice) => [
      choice.cardId,
      choice.targetId,
      choice.unitId,
      choice.battlefieldId,
      choice.destinationId
    ]),
    item?.destination
  ].filter(Boolean);
  return [...new Set(targets)];
}

function targetLabel(cardId) {
  if (!cardId) return "";
  if (cardId === "base") return t("base", locale());
  const card = findVisibleCard(cardId);
  return card ? cardName(card) : cardId;
}

function playerPerspectiveLabel(playerId) {
  if (playerId === viewerPlayerId()) return t("you", locale());
  const player = game.players.find((candidate) => candidate.id === playerId);
  return isOnlineGame() ? t("opponent", locale()) : (player?.name || t("opponent", locale()));
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
  return labels[zone] || zone;
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
          status: trigger.status || t("finalized", locale()),
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
      ${item.status ? `<small>${item.status}</small>` : ""}
    </article>
  `;
}

function setupPanel() {
  return `
    <section class="setup">
      ${game.players.map((player) => `
        <article class="setup-player ${player.id === game.setupPlayerId ? "active" : ""}">
          <div class="section-head">
            <div>
              <h2>${player.name}</h2>
              <span>${player.legend.name} / ${player.champion.name}</span>
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
  return `
    <section class="setup champion-setup">
      ${game.players.map((player) => `
        <article class="setup-player ${player.id === game.championSelectPlayerId ? "active" : ""}">
          <div class="section-head">
            <div>
              <h2>${player.name}</h2>
              <span>${player.legend.name}</span>
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
  if (isOnlineGame() && player?.id !== viewerPlayerId()) {
    return `
      <section class="mulligan">
        <article class="mulligan-player active waiting">
          <div class="section-head">
            <div>
              <h2>${player?.name || t("opponentSide", locale())}</h2>
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
            <h2>${player.name}</h2>
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
  return `
    <section class="player-side ${side} owner-${player.id} ${acting ? "acting-player" : ""} ${handGlow}">
      <div class="player-identity">
        <div class="identity-mini">
          ${miniIdentity(player.legend)}
          ${miniIdentity(player.champion, player)}
        </div>
        <div class="player-summary">
          <h2>${player.name}</h2>
          <div class="player-stats">
            <span class="deck-stat">${t("deck", locale())} ${player.mainDeck.length}</span>
            <span class="hand-stat">${t("hand", locale())} ${player.hand.length}</span>
            <button class="trash-button" data-action="toggle-graveyard" data-player="${player.id}" title="${t("viewTrashTitle", locale(), { name: player.name })}">
              ${t("trash", locale())} ${player.trash.length}
            </button>
            <button class="trash-button banished-button" data-action="toggle-banished" data-player="${player.id}" title="${t("viewBanishedTitle", locale(), { name: player.name })}">
              ${t("banished", locale())} ${(player.banished || []).length}
            </button>
            <span class="xp-stat">XP ${player.xp || 0}</span>
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
          ${player.base.map((card) => boardCard(card, "base")).join("") || `<p class="empty">${t("baseEmpty", locale())}</p>`}
        </div>
      </div>
    </section>
  `;
}

function miniIdentity(card, player = null) {
  const championState = player && card?.instanceId === player.champion?.instanceId
    ? player.championPlayed || player.champion.zone === "played" ? " deployed" : " ready"
    : "";
  const exhausted = card?.exhausted ? " exhausted" : "";
  const sourceGlow = uiMotion.sourceIds.has(card?.instanceId) ? " source-card-glow" : "";
  return `
    <button class="identity-button${championState}${exhausted}${sourceGlow}" data-action="select-card" data-card="${card.instanceId}" title="${cardName(card)}">
      <img src="${card.image}" alt="${cardName(card)}" loading="lazy" />
      ${championState || exhausted ? `<span>${card.exhausted ? t("spent", locale()) : championState.trim() === "deployed" ? t("used", locale()) : t("zone", locale())}</span>` : ""}
    </button>
  `;
}

function championPanelStatus(player) {
  if (!player.champion) return "";
  const deployed = player.championPlayed || player.champion.zone === "played";
  const mine = viewerPlayerId() === player.id;
  const canUse = mine && viewerCanAct() && !deployed && game.phase === "action" && !game.pendingPayment && !game.pendingChoice && canPayCard(player, player.champion);
  const reason = deployed
    ? t("alreadyUsed", locale())
    : !mine
      ? t("opponentChampion", locale())
      : game.phase !== "action"
        ? t("notActionPhase", locale())
        : !canPayCard(player, player.champion)
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
  const topHidden = (field.hidden || []).filter((item) => item.ownerId === topPlayer.id);
  const bottomHidden = (field.hidden || []).filter((item) => item.ownerId === bottomPlayer.id);
  const topTarget = targetAttributes(field.instanceId, topPlayer.id);
  const bottomTarget = targetAttributes(field.instanceId, bottomPlayer.id);
  const showdownActive = game.phase === "showdown" && game.showdown?.battlefieldId === field.instanceId;
  return `
    <article class="battlefield location-column ${showdownActive ? "showdown-location" : ""}" data-card-id="${field.instanceId}">
      <div class="field-lane top-lane ${topTarget.className}" data-scroll-key="field-${field.instanceId}-${topPlayer.id}" ${topTarget.attrs}>
        <span class="lane-label">${t("opponentUnits", locale())}</span>
        ${battlefieldLaneContents(topPlayer, field, topUnits, topHidden, "top")}
      </div>
      <div class="field-center location-card">
        <div class="field-image">${cardImage(field)}</div>
        <div class="battlefield-head">
          <h2>${cardName(field)}</h2>
          <span>${controller}</span>
        </div>
      </div>
      <div class="field-lane bottom-lane ${bottomTarget.className}" data-scroll-key="field-${field.instanceId}-${bottomPlayer.id}" ${bottomTarget.attrs}>
        <span class="lane-label">${t("yourUnits", locale())}</span>
        ${battlefieldLaneContents(bottomPlayer, field, bottomUnits, bottomHidden, "bottom")}
      </div>
    </article>
  `;
}

function emptyBattlefieldColumn(index) {
  return `
    <article class="battlefield location-column empty-location" aria-label="Empty battlefield slot ${index}">
      <div class="field-lane top-lane">
        <span class="lane-label">${t("opponentUnits", locale())}</span>
        <span class="unit-placeholder">${t("noUnits", locale())}</span>
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
        <span class="unit-placeholder">${t("noUnits", locale())}</span>
      </div>
    </article>
  `;
}

function battlefieldStatus(field) {
  if (field.controlledBy) {
    const controller = game.players.find((player) => player.id === field.controlledBy);
    return `${controller?.name || "Player"} controls`;
  }
  const controllers = [...new Set(field.units.map((unit) => unit.controllerId))];
  if (controllers.length > 1) return "Contested";
  if (controllers.length === 1) {
    const occupant = game.players.find((player) => player.id === controllers[0]);
    return `${occupant?.name || "Player"} present`;
  }
  return t("uncontrolled", locale());
}

function battlefieldLaneContents(player, field, units, hiddenItems, side) {
  const unitCards = units.map((unit) => boardCard(unit, field.instanceId)).join("");
  const hiddenCards = hiddenItems.map((item) => hiddenCardBack(item, field, side)).join("");
  if (!unitCards && !hiddenCards) return `<span class="unit-placeholder">${t("dropUnitHere", locale())}</span>`;
  return `${side === "top" ? hiddenCards : ""}${unitCards}${side === "bottom" ? hiddenCards : ""}`;
}

function hiddenCardBack(item, field) {
  const ownedByViewer = viewerPlayerId() === item.ownerId;
  const visibleByIntel = canViewPrivateInfo(viewerPlayerId(), item.ownerId);
  const playable = hiddenPlayable(item, field);
  const sourceGlow = uiMotion.sourceIds.has(item.card.instanceId) ? " source-card-glow hidden-reveal-glow" : "";
  const targetGlow = uiMotion.targetIds.has(item.card.instanceId) ? " target-card-glow" : "";
  if (ownedByViewer) {
    return `
      <button class="hidden-card-back hidden-card-owned owner-${item.ownerId} ${playable ? "usable-card" : ""}${sourceGlow}${targetGlow}" data-action="select-card" data-card="${item.card.instanceId}" data-card-id="${item.card.instanceId}" title="${item.card.name}">
        ${cardImage(item.card)}
        <span class="hidden-label">${t("hiddenZone", locale())}</span>
      </button>
    `;
  }
  if (visibleByIntel && !ownedByViewer) {
    return `
      <article class="${imageCardClass(item.card, `hidden-revealed owner-${item.ownerId}${sourceGlow}${targetGlow}`)}" data-card-id="${item.card.instanceId}" title="${item.card.name}">
        ${cardImage(item.card)}
        <span class="status-line">${t("revealed", locale())}</span>
      </article>
    `;
  }
  const attrs = `title="${t("hiddenZone", locale())}" aria-label="${t("opponentHiddenCard", locale())}"`;
  return `
    <button class="hidden-card-back owner-${item.ownerId} locked-hidden ${playable ? "usable-card" : ""}${sourceGlow}${targetGlow}" ${attrs}>
      <span class="card-back-mark">H</span>
      <span class="hidden-label">${ownedByViewer ? t("hiddenZone", locale()) : t("setHidden", locale())}</span>
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
  if (online.commandPending) return false;
  if (aiMode) return activePlayerId() === aiHumanPlayerId && !aiThinking;
  if (!isOnlineGame()) return true;
  return activePlayerId() === viewerPlayerId();
}

function visibleBattlefields() {
  const fields = game.battlefields.slice(0, 2);
  return viewerPlayerId() === game.players[1]?.id ? fields.reverse() : fields;
}

function activePlayerId() {
  if (game.phase === "first-player") return online.room?.hostPlayerId || game.hostPlayerId || "p1";
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
  if (player.championPlayed || player.champion.zone === "played") {
    return `
      <article class="champion-zone-slot champion-zone-used" aria-label="${player.champion.name} has been played">
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
    <article class="${imageCardClass(card, `${card.type} ${motionCardClass(card, "hand")}`)}" data-card-id="${card.instanceId}">
      ${cardImage(card)}
    </article>
  `;
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
      <span class="owner-chip">${owner?.name || card.ownerId}</span>
      ${moveSelectButton(card)}
      ${cardImage(card)}
      ${attachmentStrip(attachments)}
      ${statusLine(card)}
    </article>
  `;
}

function baseToken(card, location, owner, motion, attachments, flashed) {
  const domain = domainText(card.domains?.[0]) || (card.tags?.[0] ? keywordText([card.tags[0]]) : cardType(card));
  const state = card.exhausted ? t("exhausted", locale()) : t("readyState", locale());
  const mainBadge = card.type === "unit" ? `${t("might", locale())} ${effectiveMight(card)}` : cardType(card);
  return `
    <article class="unit-token base-token ${card.type}-token owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : "ready"} ${flashed ? "effect-flash" : ""} ${motion}" data-card-id="${card.instanceId}" data-location="${location}">
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
        </div>
      </div>
      <span class="owner-chip">${owner?.name || card.ownerId}</span>
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
  const displayMight = combatStats?.might ?? effectiveMight(card);
  return `
    <article class="unit-token ${zoneClass} owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : ""} ${flashed ? "effect-flash" : ""} ${motion}" data-card-id="${card.instanceId}" data-location="${location}">
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
        </div>
      </div>
      <span class="owner-chip">${owner?.name || card.ownerId}</span>
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
  const might = Math.max(0, currentCombatMight(game, battlefield, card, role));
  return {
    role,
    might,
    damage: card.damage || 0,
    remaining: Math.max(0, might - (card.damage || 0))
  };
}

function attachmentStrip(attachments) {
  if (!attachments.length) return "";
  return `
    <div class="attachment-strip" aria-label="Attached gear">
      ${attachments.map((gear) => `
        <button class="attached-gear ${game.selectedCardId === gear.instanceId ? "selected-attachment" : ""}" data-card-id="${gear.instanceId}" title="${gear.name}">
          ${gear.image ? `<img src="${gear.image}" alt="${gear.name}" loading="lazy" />` : `<span>${gear.name}</span>`}
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
      title="${selected ? "Remove from standard move" : "Add to standard move"}"
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
  return `image-card ${extra} ${sourceGlow} ${targetGlow} ${isUsableCard(card) ? "usable-card" : ""} ${game.selectedCardId === card.instanceId ? "selected-card" : ""}`.trim();
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
  const items = [`${t("might", locale())} ${effectiveMight(card)}`];
  if (card.exhausted) items.push(t("exhausted", locale()));
  if (card.damage) items.push(`${card.damage} ${t("damageShort", locale())}`);
  if (card.stunned) items.push(t("stunned", locale()));
  if (card.buffs) items.push(`+${card.buffs} ${t("buff", locale())}`);
  return `<span class="status-line">${items.join(" / ")}</span>`;
}

function moveButtons(card, location) {
  const buttons = [];
  if (location !== "base") {
    buttons.push(`<button data-action="move" data-unit="${card.instanceId}" data-destination="base">${t("base", locale())}</button>`);
  }
  for (const [index, field] of visibleBattlefields().entries()) {
    if (location === field.instanceId) continue;
    if (location !== "base" && !hasKeyword(card, "Ganking")) continue;
    buttons.push(`<button data-action="move" data-unit="${card.instanceId}" data-destination="${field.instanceId}" title="${field.name}">${t("moveToField", locale(), { n: index + 1 })}</button>`);
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
  if (!card || disabled || waiting) {
    const quickActions = globalActionButtons(player);
    return `
      <section class="action-bar ${chainSummary ? "showdown-action-bar" : ""}">
        <div class="action-context">
          <span class="bar-label">${chainSummary ? chainSummary.label : t("action", locale())}</span>
          <strong>${waiting ? t("waitingForOpponent", locale()) : responseInfo?.title || chainSummary?.title || (disabled ? t("resolvingStep", locale()) : t("noAction", locale()))}</strong>
          <span>${waiting ? t("waitingForOpponent", locale()) : responseInfo?.detail || chainSummary?.detail || (disabled ? t("finishDialog", locale()) : t("selectCardHint", locale()))}</span>
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
    <section class="action-bar ${chainSummary ? "showdown-action-bar" : ""}">
      <div class="action-context">
        <span class="bar-label">${chainSummary ? chainSummary.label : t("selected", locale())}</span>
          <strong>${responseInfo?.title || chainSummary?.title || cardName(card)}</strong>
        <span>${responseInfo ? `${responseInfo.detail} / ${t("selected", locale())}: ${cardName(card)}` : chainSummary ? `${chainSummary.detail} / ${t("selected", locale())}: ${cardName(card)}` : actionHint(card, context, actions)}</span>
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
    title: `${t("showdown", locale())}: ${field ? cardName(field) : t("battlefield", locale())}`,
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
  if (context.zone === "hidden") return hiddenActions(card, context);
  return [];
}

function handActions(card, player) {
  const inShowdown = game.phase === "showdown";
  const inActionChain = game.phase === "action" && Boolean(game.actionChain);
  const showdownDestination = inShowdown && card.type === "unit" ? game.showdown.battlefieldId : "base";
  if (inShowdown && !canPlayInShowdown(card, player, showdownDestination)) return [];
  if (inActionChain && !canPlayInActionChain(card, player)) return [];
  if (!canPayCard(player, card)) return [];
  const label = inShowdown
    ? (hasKeyword(card, "Ambush") ? keywordText(["Ambush"]) : (card.tags?.includes("Reaction") ? t("chainReaction", locale()) : t("chainAction", locale())))
    : inActionChain ? t("chainReaction", locale())
    : (card.type === "spell" ? t("cast", locale()) : t("playBase", locale()));
  const actions = [];
  if (hasRequiredPlayTargets(game, player, card, showdownDestination)) {
    actions.push(`<button data-action="begin-play" data-card="${card.instanceId}" data-destination="${showdownDestination}">${label}</button>`);
  }
  if (!inShowdown && !inActionChain && card.type === "unit") {
    const canEnterEnemyBattlefield = (card.effects || []).some((effect) => effect.kind === "canEnterEnemyBattlefield");
    for (const field of game.battlefields.filter((candidate) =>
      candidate.controlledBy === player.id
      || (canEnterEnemyBattlefield && candidate.units.some((unit) => unit.controllerId !== player.id)))) {
      actions.push(`<button data-action="begin-play" data-card="${card.instanceId}" data-destination="${field.instanceId}">${t("playToBattlefield", locale(), { name: cardName(field) })}</button>`);
    }
  }
  if (!inShowdown && !inActionChain && hasKeyword(card, "Hidden")) {
    for (const field of game.battlefields.filter((candidate) =>
      candidate.controlledBy === player.id
      && hiddenCardsAtBattlefieldForPlayer(candidate, player.id) < hiddenSlotLimit(candidate))) {
      if (!canPayPowerCost(player, [{ domain: "Any", amount: 1 }])) continue;
      actions.push(`<button data-action="hide-card" data-card="${card.instanceId}" data-destination="${field.instanceId}">${t("hideAtBattlefield", locale(), { name: cardName(field) })}</button>`);
    }
  }
  return actions;
}

function championActions(player) {
  if (!player.champion) return [];
  if (game.phase !== "action" || player.championPlayed || player.champion.zone === "played") return [];
  if (!canPayCard(player, player.champion)) return [];
  const actions = [`<button data-action="begin-champion" data-destination="base">${t("playChampionToBase", locale())}</button>`];
  for (const field of game.battlefields.filter((candidate) => candidate.controlledBy === player.id)) {
    actions.push(`<button data-action="begin-champion" data-destination="${field.instanceId}">${t("playChampionToField", locale(), { name: cardName(field) })}</button>`);
  }
  return actions;
}

function unitActions(card, context) {
  if (game.phase !== "action" || card.type !== "unit" || card.controllerId !== viewerPlayerId()) return [];
  if (card.exhausted || card.cantMoveThisTurn) return [];
  return moveButtons(card, context.location)
    .split(/(?=<button)/)
    .filter(Boolean);
}

function activatedActions(card) {
  if (!canActivate(card)) return [];
  const label = card.type === "legend" ? t("useLegend", locale()) : t("activateCard", locale(), { name: cardName(card) });
  return [`<button data-action="activate-card" data-card="${card.instanceId}">${label}</button>`];
}

function hiddenActions(card, context) {
  const player = game.players.find((candidate) => candidate.id === context.playerId);
  const field = game.battlefields.find((candidate) => candidate.instanceId === context.location);
  const hidden = field?.hidden?.find((item) => item.card.instanceId === card.instanceId);
  if (!hidden || !hiddenPlayable(hidden, field, player)) return [];
  return [`<button data-action="begin-play" data-card="${card.instanceId}" data-destination="${context.location}">${t("revealHidden", locale())}</button>`];
}

function hiddenPlayable(hidden, field, player = currentPlayer(game)) {
  if (!hidden || !field || !player) return false;
  if (game.pendingPayment || game.pendingChoice) return false;
  if (hidden.ownerId !== player.id) return false;
  if (game.phase !== "showdown" || !game.showdown) return false;
  if (game.showdown.priorityPlayerId !== player.id) return false;
  if (field.instanceId !== game.showdown.battlefieldId) return false;
  if ((game.turnSequence || 0) < (hidden.playableFromTurnSequence || 0)) return false;
  if (!canPlayInShowdown(hidden.card, player, field.instanceId)) return false;
  return hasRequiredPlayTargets(game, player, hidden.card, field.instanceId);
}

function canPayCard(player, card) {
  const cost = adjustedDisplayCost(player, card);
  const readyEnergy = player.runes.filter((rune) => !rune.exhausted).length;
  if (readyEnergy + availablePoolEnergy(player, card) < cost.energy) return false;
  return canPayPowerCost(player, cost.power);
}

function adjustedDisplayCost(player, card) {
  const cost = {
    energy: card.energy || 0,
    power: structuredClone(card.power || [])
  };
  if (game.phase !== "showdown" || card.type !== "spell" || !game.showdown) return cost;
  const battlefield = game.battlefields.find((field) => field.instanceId === game.showdown.battlefieldId);
  if (!battlefield) return cost;
  for (const unit of battlefield.units) {
    for (const effect of (unit.effects || []).filter((candidate) => candidate.timing === "combatStatic")) {
      if (effect.kind !== "spellCostModifier") continue;
      const friendly = unit.controllerId === player.id;
      cost.energy += friendly ? (effect.friendlyEnergy || 0) : (effect.enemyEnergy || 0);
      cost.power = adjustDisplayPowerCost(cost.power, friendly ? (effect.friendlyPower || 0) : (effect.enemyPower || 0));
      if (effect.minEnergy != null) cost.energy = Math.max(effect.minEnergy, cost.energy);
    }
  }
  cost.energy = Math.max(0, cost.energy);
  return cost;
}

function adjustDisplayPowerCost(requirements, delta) {
  const next = structuredClone(requirements || []);
  if (delta > 0) return [...next, { domain: "Any", amount: delta }];
  let remove = Math.abs(delta);
  for (let index = next.length - 1; index >= 0 && remove > 0; index -= 1) {
    const amount = Math.min(next[index].amount, remove);
    next[index].amount -= amount;
    remove -= amount;
  }
  return next.filter((requirement) => requirement.amount > 0);
}

function availablePoolEnergy(player, card = null) {
  return runePoolEnergy(player).filter((resource) => poolEnergyCanPay(resource, card)).length;
}

function canPayPowerCost(player, powerCost) {
  const amount = totalPowerAmount(powerCost || []);
  if (!amount) return true;
  if (player.runes.length < amount) return false;
  return Boolean(choosePowerRunes(player.runes, powerCost || []));
}

function actionHint(card, context, actions) {
  if (locale() === "ko") {
    if (!context) return t("selectCardHint", locale());
    if (actions.length) return t("availableActions", locale());
    if (context.zone === "attachment") return t("attachedGear", locale());
    if (card.exhausted) return t("exhausted", locale());
    if (context.playerId !== viewerPlayerId()) return t("opponent", locale());
    return t("noAction", locale());
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
    if (player.legend.instanceId === cardId) return { playerId: player.id, zone: "legend", location: "legend" };
    if (player.availableChampions.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "champion-choice", location: "champion-choice" };
    if (player.hand.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "hand", location: "hand" };
    if (player.base.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "base", location: "base" };
    if (player.runes.some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "rune", location: "rune" };
    if ((player.banished || []).some((card) => card.instanceId === cardId)) return { playerId: player.id, zone: "banished", location: "banished" };
    if (player.champion?.instanceId === cardId && !player.championPlayed && player.champion.zone !== "played") {
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
    if (hidden) return { playerId: hidden.ownerId, zone: "hidden", location: field.instanceId };
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

function canActivate(card) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (!viewerCanAct()) return false;
  const hasActivated = (card.effects || []).some((effect) => effect.timing === "activated");
  const playerControlsForge = game.battlefields.some((field) => field.controlledBy === viewerPlayerId() && (field.effects || []).some((effect) => effect.kind === "legendAttachEquipment"));
  if (!hasActivated && !(card.type === "legend" && playerControlsForge)) return false;
  if (card.exhausted) return false;
  if (canActivateReactionAbility(card)) return true;
  if (game.actionChain) {
    return false;
  }
  if (card.type === "legend" && playerControlsForge && game.phase === "action") return viewerPlayerId() === card.controllerId;
  if (card.type === "legend") return false;
  return game.phase === "action" && viewerPlayerId() === card.controllerId;
}

function canActivateReactionAbility(card) {
  const activatedEffects = (card.effects || []).filter((effect) => effect.timing === "activated");
  if (!activatedEffects.length) return false;
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return false;
  if (game.pendingPayment) {
    const player = game.players.find((candidate) => candidate.id === game.pendingPayment.playerId);
    const paidCard = player ? paymentDisplayCard(player, game.pendingPayment) : null;
    return game.pendingPayment.playerId === card.controllerId
      && activatedEffects.every((effect) =>
        effect.kind === "addEnergy"
        && (effect.restriction !== "spell" || paidCard?.type === "spell")
      );
  }
  if (game.actionChain) return game.actionChain.priorityPlayerId === card.controllerId && viewerPlayerId() === card.controllerId;
  if (game.phase === "showdown" && game.showdown) return game.showdown.priorityPlayerId === card.controllerId && viewerPlayerId() === card.controllerId;
  return game.phase === "action" && viewerPlayerId() === card.controllerId;
}

function activationBlockedReason(card) {
  const activatedEffects = (card.effects || []).filter((effect) => effect.timing === "activated");
  if (!activatedEffects.length) return "";
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return "";
  if (card.exhausted) return "Legend Exhausted";
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
    if (game.phase === "showdown") return destination === game.showdown?.battlefieldId && canPlayInShowdown(card, viewerPlayer(), destination);
    if (destination === "base") return game.phase === "action";
    const field = game.battlefields.find((candidate) => candidate.instanceId === destination);
    return game.phase === "action" && card.type === "unit" && field?.controlledBy === viewerPlayerId();
  }
  if (context.zone === "champion") {
    const player = game.players.find((candidate) => candidate.id === context.playerId);
    if (game.phase !== "action" || player?.championPlayed || card.zone === "played") return false;
    if (destination === "base") return true;
    const field = game.battlefields.find((candidate) => candidate.instanceId === destination);
    return field?.controlledBy === viewerPlayerId();
  }
  if (context.zone === "base" || context.zone === "battlefield") {
    if (game.phase !== "action" || card.type !== "unit" || card.exhausted || card.cantMoveThisTurn) return false;
    if (destination === context.location) return false;
    if (context.location !== "base" && destination !== "base" && !hasKeyword(card, "Ganking")) return false;
    return true;
  }
  return false;
}

function runeSummary(player) {
  const counts = new Map();
  for (const rune of player.runes) {
    const item = counts.get(rune.domain) || { total: 0, ready: 0, color: rune.color };
    item.total += 1;
    if (!rune.exhausted) item.ready += 1;
    counts.set(rune.domain, item);
  }
  const poolEnergy = runePoolEnergy(player).filter((resource) => poolEnergyCanPay(resource));
  const poolPower = player.runePool?.power || [];
  return `
    <div class="rune-summary">
      ${[...counts.entries()].map(([domain, item]) => `
        <span class="rune-count" style="--rune:${item.color}">
          <b>${domain}</b> ${item.ready}/${item.total}
        </span>
      `).join("") || `<span class="rune-count muted">${t("noRunes", locale())}</span>`}
      ${poolEnergy.length ? `<span class="rune-count generated"><b>${t("energy", locale())}</b> +${poolEnergy.length}</span>` : ""}
      ${poolPower.length ? `<span class="rune-count power-pool"><b>${t("power", locale())}</b> ${poolPower.length}</span>` : ""}
    </div>
  `;
}

function runeChip(rune) {
  const spent = rune.exhausted ? " spent" : "";
  return `
    <span class="rune${spent}" style="--rune:${rune.color}" title="${translateCardText(rune.text, locale())}">
      <span class="rune-swatch"></span>${domainText(rune.domain)}
      ${rune.exhausted ? `<strong>${t("energy", locale())} ${t("spent", locale()).toLowerCase()}</strong>` : ""}
    </span>
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
        ${["unit", "gear"].includes(card.type) ? `<strong>${t("might", locale())} ${card.type === "unit" ? card.might + (card.buffs || 0) : card.might || 0}</strong>` : ""}
        <p>${shortCardText(cardText(card))}</p>
        ${(card.keywords || []).length ? `<small>${keywordText(card.keywords)}</small>` : ""}
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
        <p>${cardText(card)}</p>
      </div>
    </section>
  `;
}

function hasKeyword(card, keyword) {
  if ((card.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  const player = game.players.find((candidate) => candidate.id === card.controllerId || candidate.id === card.ownerId);
  for (const effect of card.effects || []) {
    if (effect.timing !== "levelStatic" || effect.kind !== "gainKeywords") continue;
    if ((player?.xp || 0) < (effect.level || 0)) continue;
    if ((effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  }
  return false;
}

function isFlashed(cardId) {
  return game.effectFlash?.sourceId === cardId || game.effectFlash?.targetIds?.includes(cardId);
}

function canPlayInShowdown(card, player = currentPlayer(game), destination = "base") {
  const isAction = card.tags?.includes("Action");
  const isReaction = card.tags?.includes("Reaction");
  const isAmbush = hasKeyword(card, "Ambush");
  if (!isAction && !isReaction && !isAmbush) return false;
  if (game.showdown.chain.length > 0 && !isReaction && !isAmbush) return false;
  if (isAmbush) {
    const battlefield = game.battlefields.find((field) => field.instanceId === game.showdown.battlefieldId);
    if (destination !== game.showdown.battlefieldId) return false;
    if ((card.effects || []).some((effect) => effect.kind === "canEnterEnemyBattlefield")) return true;
    return Boolean(battlefield?.units.some((unit) => unit.controllerId === player.id));
  }
  return true;
}

function canPlayInActionChain(card, player = currentPlayer(game)) {
  if (!game.actionChain || game.actionChain.priorityPlayerId !== player.id) return false;
  return card.tags?.includes("Reaction") || card.keywords?.includes("Reaction");
}

app.addEventListener("click", (event) => {
  try {
    unlockAudio();
    if (handlePendingChoiceClick(event)) return;
  } catch (error) {
    reportUiException(error, "pending choice click");
    showUiExceptionOverlay(error, "pending choice click");
  }
}, true);

function handlePendingChoiceClick(event) {
  if (appView !== "game" || !game.pendingChoice) return false;
  const button = event.target.closest("button[data-action='choose-effect'], button[data-action='decline-effect'], button[data-action='assign-alpha-strike']");
  if (!button || !app.contains(button)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const { action, choice } = button.dataset;
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
    const globalAction = event.target.closest("button")?.dataset.action;
    if (handleAudioSettingAction(globalAction)) {
      render();
      return;
    }
    if (appView !== "game") {
      if (isTextEditingTarget(event.target)) return;
      handleShellClick(event);
      render();
      return;
    }

    if (isTextEditingTarget(event.target)) return;

    const payRunes = app.querySelector(".pay-runes");
    if (payRunes) paymentRunesScrollLeft = payRunes.scrollLeft;

    const button = event.target.closest("button");
    const cardNode = button ? null : event.target.closest("[data-card-id]");
    if (cardNode) setUiSelectedCard(cardNode.dataset.cardId);

    const targetZone = !cardNode && !button ? event.target.closest("[data-zone-action]") : null;
    if (targetZone) {
      const { zoneAction, card, unit, destination } = targetZone.dataset;
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

    const { action, card, unit, destination, player, battlefield, rune, energy, mode, choice } = button.dataset;
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
    if (action === "confirm-first-player") dispatchGameCommand({ kind: "confirmFirstPlayer" }, () => confirmFirstPlayer(game));
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
    if (action === "pass-showdown") dispatchGameCommand({ kind: "passShowdown" }, () => passShowdown(game));
    if (action === "begin-play") {
      handOpen = false;
      dispatchGameCommand({ kind: "beginPlayCard", cardId: card, destination }, () => beginPlayCard(game, card, destination));
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
    if (action === "activate-card") dispatchGameCommand({ kind: "activateCard", cardId: card }, () => activateCard(game, card));
    if (action === "pay-rune") dispatchGameCommand({ kind: "togglePaymentRune", runeId: rune, mode }, () => togglePaymentRune(game, rune, mode));
    if (action === "pay-pool-energy") dispatchGameCommand({ kind: "togglePaymentPoolEnergy", energyId: energy }, () => togglePaymentPoolEnergy(game, energy));
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

app.addEventListener("input", (event) => {
  try {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const action = target.dataset.action;
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
    if (action === "settings-volume") {
      settings.volume = clampVolume(Number(target.value) / 100);
      configureAudio({ volume: settings.volume });
      const label = target.closest("label")?.querySelector("span");
      if (label) label.textContent = `음량 ${Math.round(settings.volume * 100)}%`;
      saveSettings();
      return;
    }
    if (action === "online-code-input") {
      online.joinCode = target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
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
    if (target.dataset.action === "settings-language") {
      settings.locale = normalizeLocale(target.value);
      saveSettings();
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

function handleAudioSettingAction(action) {
  if (action !== "toggle-sound" && action !== "toggle-voice") return false;
  if (action === "toggle-sound") settings.sound = !settings.sound;
  if (action === "toggle-voice") settings.voice = !settings.voice;
  configureAudio({ enabled: settings.sound, voice: settings.voice, volume: settings.volume });
  saveSettings();
  if (settings.sound) {
    unlockAudio();
    playPresentationCue({ kind: "ui" });
  }
  return true;
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
  if (count) count.textContent = `${results.length} cards`;
}

function handleShellClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const { action, deck, cardNumber, domain, slot, room } = button.dataset;
  if (action === "menu-home") appView = "menu";
  if (action === "menu-decks") appView = "decks";
  if (action === "menu-multiplayer") {
    connectDefaultMultiplayer();
  }
  if (action === "menu-start") startGameFromMenu();
  if (action === "menu-ai") startAiGameFromMenu();
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
    deckEditor.selectedDeckId = deck;
    deckEditor.selectedCardNumber = deckHeroCard(getSelectedDeckRecord())?.cardNumber || null;
  }
  if (action === "deck-new") {
    const record = createNewDeckRecord();
    deckStore.decks.push(record);
    deckEditor.selectedDeckId = record.id;
    deckEditor.selectedCardNumber = null;
    saveDeckStore();
  }
  if (action === "deck-save") saveDeckStore();
  if (action === "deck-ai-recommend") {
    const selected = getSelectedDeckRecord();
    if (selected) deckEditor.aiRecommendation = recommendDeckForPool(resolveDeckRecord(selected), activeCoachModel(), deckEditor.poolId);
  }
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
  if (action === "deck-card-focus") deckEditor.selectedCardNumber = cardNumber;
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
  if (action === "deck-rune-inc") mutateSelectedDeck((selected) => updateRune(selected, domain, 1));
  if (action === "deck-rune-dec") mutateSelectedDeck((selected) => updateRune(selected, domain, -1));
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
            <p>${escapeHtml(report.overview || (korean ? "아직 분석할 결정이 없습니다." : "There are no decisions to review yet."))}</p>
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
          ${(report.deckAdvice?.observations || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
          ${(report.deckAdvice?.recommendations || []).map((item) => `<p class="coach-recommendation">${escapeHtml(item)}</p>`).join("") || `<p>${korean ? "카드 교체를 권고하려면 더 많은 자가대전 표본이 필요합니다." : "More self-play samples are needed for card replacement advice."}</p>`}
        </section>
        <section class="coach-deck-advice coach-matchup-plan">
          <h2>${korean ? "상대 덱 대응 플랜" : "Matchup plan"}</h2>
          <p>${escapeHtml(report.matchupPlan?.plan || "")}</p>
          <small>${korean ? "플랜 신뢰도" : "Plan confidence"} ${report.matchupPlan?.confidence === "high" ? "높음" : report.matchupPlan?.confidence === "medium" ? "보통" : "낮음"}</small>
          ${report.matchupPlan?.matchupWinRate == null ? "" : `<p>이 덱 조합 자가대전 승률 ${(report.matchupPlan.matchupWinRate * 100).toFixed(1)}% · ${report.matchupPlan.matchupGames}경기</p>`}
          <h3>${korean ? "현재 학습 환경의 주요 채용 카드" : "Most played cards in the learned meta"}</h3>
          <div class="coach-meta-cards">${(report.matchupPlan?.metaCards || []).map((card) => `<span>${escapeHtml(card.name)} · 채용 ${(card.inclusionRate * 100).toFixed(1)}%</span>`).join("") || `<span>${korean ? "아직 충분한 환경 표본이 없습니다." : "Not enough meta samples yet."}</span>`}</div>
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
      <p>선택: ${escapeHtml(selected?.label || "-")} · 예상 승률 ${((selected?.expectedWinRate || 0) * 100).toFixed(1)}%</p>
      <p>추천: ${escapeHtml(best?.label || "-")} · 예상 승률 ${((best?.expectedWinRate || 0) * 100).toFixed(1)}%</p>
      <p>${escapeHtml(item.explanation || "")}</p>
      <small>신뢰도 ${item.confidence === "high" ? "높음" : item.confidence === "medium" ? "보통" : "낮음"}</small>
    </article>
  `;
}

enableLocalPresentationPreview();
loadAiCheckpoint();
loadNeuralAiCheckpoint();

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
  advancePresentation(presentationState, snapshotPresentationGame(game, effectiveMight), first.id);
  if (preview === "impact") {
    first.score = 7;
    game.turnNumber = 7;
    game.turnSequence = 12;
    const update = advancePresentation(presentationState, snapshotPresentationGame(game, effectiveMight), first.id);
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
  advancePresentation(presentationState, snapshotPresentationGame(game, effectiveMight), first.id);
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

async function loadNeuralAiCheckpoint() {
  try {
    const response = await fetch(new URL("./ai/checkpoints/neural-champion.json", import.meta.url));
    if (!response.ok) return;
    const checkpoint = await response.json();
    const { createNeuralSession, deserializeNeuralModel } = await import("./ai/neural/model.mjs");
    neuralAiModel = deserializeNeuralModel(checkpoint);
    neuralAiSession = createNeuralSession(neuralAiModel);
    if (appView === "menu") render();
  } catch {
    neuralAiModel = null;
    neuralAiSession = null;
  }
}

function activeCoachModel() {
  return neuralAiModel ? { ...aiModel, ...(neuralAiModel.knowledge || {}), generation: neuralAiModel.generation, gamesTrained: neuralAiModel.gamesTrained } : aiModel;
}

function activeAiGeneration() {
  return neuralAiModel?.generation || aiModel.generation || 0;
}

function activeAiGames() {
  return neuralAiModel?.gamesTrained || aiModel.gamesTrained || 0;
}

window.addEventListener("error", (event) => {
  reportUiException(event.error || event.message, "window error");
  if (appView === "game") showUiExceptionOverlay(event.error || event.message, "window error");
});

window.addEventListener("unhandledrejection", (event) => {
  reportUiException(event.reason, "unhandled promise");
  if (appView === "game") showUiExceptionOverlay(event.reason, "unhandled promise");
});

render();
