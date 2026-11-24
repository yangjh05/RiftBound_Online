import {recordablePaymentCommand} from './ai/replay-command.mjs';
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
  legalPaymentPoolPowerOptions,
  moveUnit,
  moveUnits,
  passShowdown,
  paymentConfirmationLegality,
  paymentResumeLegality,
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
import { cards, cardHasType, DOMAINS, makeRune, rawDecklists, RUNE_COLORS, runeCardsForDomain } from "./cards.mjs";
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
import { AI_DECK_PRESETS, matchingAiPreset } from './decks/ai-presets.mjs';
import { DECK_IMAGE_SORT_OPTIONS, deckImageChampionCandidates, deckImageFilename, deckImageModel, renderDeckImage } from "./decks/image-export.mjs";
import {
  DEFAULT_ROOM_POOL_ID, STANDARD_BAN_LIST, deckRoomRestrictions,
  isCardBanned, normalizeRoomDeckOptions, validateRoomDeck
} from "./decks/legality.mjs";
import {
  beginInitialSideboarding,
  beginNextMatchGame,
  createMatchState,
  recordMatchGame,
  submitSideboardConfiguration,
  validateSideboardConfiguration
} from "./match.mjs";
import {
  configureOnlineServer,
  configureBugReportServer,
  configuredBugReportServer,
  configuredMultiplayerServer,
  createOnlineRoom,
  fetchAiGenerationCheckpoint,
  fetchAiGenerationCheckpointBuffer,
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
  submitBugReport,
  submitOnlineDeck
} from "./net/client.mjs";
import {
  LOCALE_LABELS,
  LOCALES,
  cardSearchText,
  normalizeLocale,
  t,
  translateCardName,
  translateCardImage,
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
import {
  actionKey,
  activeActorId as aiActiveActorId,
  applyAiAction,
  canonicalizeActionCommand,
  cloneGame,
  enumerateUiLegalActions,
  enumerateUiMoveUnitsActions,
  isStrategicAction
} from "./ai/actions.mjs";
import { buildMatchReport } from "./ai/coach.mjs";
import { recommendDeckForPool } from "./ai/deckbuilding.mjs";
import {
  AI_GENERATIONS,
  aiGenerationDescriptor,
  normalizeAiGeneration,
  sameDeckConfiguration
} from "./ai/generations.mjs";
import { createModel, DEFAULT_AI_MODEL } from "./ai/policy.mjs";
import {
  appendAnalyzedReplayDecision,
  recordExecutedReplayAction,
  createAiReplay,
  createReplayAnalysisWorkerRequest,
  finalizeAiReplay,
  persistableAiReplay,
  refineAiReplay,
  REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES
} from "./ai/replay.mjs";
import {
  AI_TURN_WORKER_MESSAGE_TYPES,
  createAiTurnNeuralConfigureRequest,
  createAiTurnNeuralResetRequest,
  createAiTurnWorkerRequest
} from "./ai/turn-protocol.mjs";
import { CARD_PACKS, CARD_POOL_FORMATS, cardAllowedInPool, packForCard } from "./card-pools.mjs";
import { commandFailureFeedback } from "./ui/command-feedback.mjs";
import { cardStatusItems } from "./ui/card-status.mjs";
import { resolveBoardClickTarget } from "./ui/board-click.mjs";
import { detectEffectAnimations, EFFECT_ANIMATION_DURATION_MS } from "./ui/effect-animations.mjs";
import { collectChainTargetIds } from "./ui/chain-targets.mjs";
import { pendingDecisionVisibleToViewer } from "./ui/game-visibility.mjs";
import { battlefieldDisplayName } from "./ui/battlefield-labels.mjs";
import { fanCardStyle, tabletopSeatView, topDiscardCard } from "./ui/tabletop-view.mjs";
import {
  buildBurnOutDrawTransfers,
  buildPrivateDeckTransfers,
  buildPrivateHandBoardTransfers,
  buildPrivateHandChainTransfers,
  buildPrivateHiddenChainTransfers,
  buildTabletopTransfers,
  clearTabletopStateMotions,
  TABLETOP_DRAW_STAGGER_MS,
  TABLETOP_TRANSFER_DURATION_MS,
  TABLETOP_TRANSFER_EASING
} from "./ui/tabletop-motion.mjs";
import {
  advanceTutorialAfterCommand,
  createTutorialGame,
  localizeTutorialStep,
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
import {
  GAME_REPRODUCTION_DESCRIPTION_PLACEHOLDER,
  GAME_REPRODUCTION_END_REASONS,
  createGameLogSubmissionPayload,
  createGameReproductionLog,
  restoreGameReproductionLogFromStorage,
  saveGameReproductionLogToStorage,
  validateGameReportDescription
} from "./diagnostics/game-reproduction-log.mjs";
import { validateBugReportSubmissionReceipt } from "./diagnostics/bug-report-receipt.mjs";
import {
  captureOnlineDiagnosticIdentity,
  onlineDiagnosticIdentityMatchesDescriptor
} from "./diagnostics/online-diagnostic-identity.mjs";

const LOCAL_SERVER_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const DECK_STORAGE_KEY = "riftbound.deckStore.v1";
const AUTH_STORAGE_KEY = "riftbound.accountSession.v1";
const ONLINE_STORAGE_KEY = "riftbound.onlineSeat.v1";
const SETTINGS_STORAGE_KEY = "riftbound.settings.v1";
const TUTORIAL_STORAGE_KEY = "riftbound.tutorial.v1";
const GAME_DIAGNOSTIC_STORAGE_KEY = "riftbound.gameDiagnostic.v1";
const GAME_DIAGNOSTIC_RELOAD_KEY = "riftbound.gameDiagnosticReload.v1";
// Model construction and large policy searches can legitimately run slowly
// beside local training. Worker error events still fail immediately; these
// watchdogs cover only a genuinely silent/hung Worker.
const AI_TURN_DECISION_TIMEOUT_MS = 120_000;
const AI_TURN_NEURAL_CONFIGURATION_TIMEOUT_MS = 180_000;
const ALL_CARDS = Object.values(cards).sort((a, b) => a.name.localeCompare(b.name));
const CARD_BY_NUMBER = new Map(ALL_CARDS.map((card) => [card.cardNumber, card]));
const RAW_DECK_BY_ID = new Map([...Object.values(rawDecklists), ...AI_DECK_PRESETS].map((deck) => [deck.id, deck]));
const LOCALIZED_CARD_NAMES = [...ALL_CARDS]
  .sort((left, right) => right.name.length - left.name.length)
  .map((card) => [card.name, translateCardName(card, LOCALES.KO)])
  .filter(([englishName, koreanName]) => englishName !== koreanName);
const LOCALIZED_CARD_NAME_BY_ENGLISH = new Map(LOCALIZED_CARD_NAMES);
const LOCALIZED_CARD_NAME_PATTERN = LOCALIZED_CARD_NAMES.length
  ? new RegExp(LOCALIZED_CARD_NAMES.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu")
  : null;
const LOCALIZED_DECK_NAMES = new Map([
  ["Fury/Chaos Annie", "분노/혼돈 애니"],
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
const LOCALIZED_DECK_NAME_REPLACEMENTS = [
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
  ["Fury", "분노"],
  ["Chaos", "혼돈"],
  ["Calm", "평온"],
  ["Body", "신체"],
  ["Mind", "정신"],
  ["Order", "질서"],
  ["Stun", "기절"],
  ["Best", "추천"],
  ["Refined", "개선형"]
];
const LOCALIZED_TEXT_CACHE_LIMIT = 1200;
const localizedDynamicTextCache = new Map();
const localizedDeckNameCache = new Map();
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
online.leaveNotice = "";
online.joinCode = "";
online.loading = false;
online.commandPending = null;
online.match = null;
online.lastRefresh = 0;
online.refreshTimer = null;
let onlineSelectedCardId = null;
let onlineSnapshotRevision = 0;
let onlineEventGeneration = 0;
let onlineSessionGeneration = 0;
let onlineLeaveOperation = null;
let onlineSeatRequestOperation = null;
let onlineRoomMutationOperation = null;
let onlineRefreshOperation = null;
let onlineRequestOperationSequence = 0;
let onlineLoadingOperation = null;
let onlineDiagnosticGameKey = "";
let recoveredOnlineStopRequested = false;
let pendingOnlineDiagnosticStart = null;
let deferredOnlineRenderTimer = null;
let deferredOnlineRenderGeneration = 0;
let deckEditor = {
  selectedDeckId: deckStore.activeDeckIds[0] || deckStore.decks[0]?.id,
  pendingDeleteDeckId: null,
  search: "",
  listSearch: "",
  listFilter: "all",
  mobileToolsOpen: false,
  selectedCardNumber: null,
  poolId: "vendetta-era",
  packId: "all",
  type: "all",
  domain: "all",
  maxEnergy: "all",
  aiRecommendation: null,
  transferNotice: null,
  transferDialog: null,
  imageSort: "type",
  imageChampionFirst: false,
  imageChampionSelections: new Map(),
  mobileView: "list",
  mobileTab: "deck"
};
let deckSyncTimer = null;
let deckSyncQueue = Promise.resolve(true);
let game = createGame({ interactive: true, randomFirstPlayer: true, manualActionChainPriority: true });
let restoredGameDiagnosticCanResume = false;
let gameDiagnostic = restoreSavedGameDiagnostic();
let onlineDiagnosticRecoveryInProgress = Boolean(gameDiagnostic && restoredGameDiagnosticCanResume);
let bugReportUi = createBugReportUiState(Boolean(gameDiagnostic) && !restoredGameDiagnosticCanResume);
let emergencyReportActive = false;
let emergencyReportContext = null;
let emergencyStopState = "idle";
let emergencyStopError = "";
let emergencyStopOwner = null;
let emergencyStopOperation = null;
let emergencyStopOperationSequence = 0;
let clientBuildInfo = {};
let diagnosticServerReady = null;
let lastDiagnosticRenderIssue = "";
let diagnosticCommandAttemptSequence = 0;
let logOpen = false;
let handOpen = false;
let chainZoneCollapsed = false;
let inspectedChainItemId = null;
let inspectedChainTargetIds = new Set();
let chainTreePresentationItems = [];
let graveyardOpenPlayerId = null;
let banishedOpenPlayerId = null;
let intelOpenPlayerId = null;
let fullCardOpen = false;
let fullCardPreviewCard = null;
let inspectorPreviewCard = null;
let attachmentsOpenCardId = null;
let inspectorOpen = false;
let stagedChoiceKey = null;
let stagedChoiceOptionId = null;
let choiceDrawerCollapsed = false;
let draggingCardSession = null;
let pointerCardDrag = null;
let cardDragRenderPending = false;
let pointerRuneScroll = null;
let pointerRunePowerHold = null;
let suppressCardClickUntil = 0;
let suppressRuneClickUntil = 0;
let suppressRunePowerContextMenuUntil = 0;
let pendingGameExit = null;
let pendingPostReportAction = null;
let postReportActionSequence = 0;
let postReportActionRunning = false;
let paymentRunesScrollLeft = 0;
let handScrollLeft = 0;
let shellScrollState = {};
const SCROLL_STATE_SCOPE_LIMIT = 8;
const SCROLL_STATE_ENTRY_LIMIT = 48;
const shellScrollStateByScope = new Map();
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
let sideboardBaselines = [];
let sideboardPlayerId = "p1";
let sideboardPreviewNumber = null;
let sideboardValidationMessages = [];
let onlineSideboardDraft = null;
let onlineSideboardBaseline = null;
let onlineSideboardDraftKey = "";
let aiMode = false;
let aiHumanPlayerId = null;
let aiPlayerId = null;
let aiModel = createModel(DEFAULT_AI_MODEL);
let neuralAiCheckpointMetadata = null;
let neuralAiModel = null;
let neuralAiModelDescriptorKey = null;
let neuralAiLoadedGeneration = null;
let neuralAiLoadedDescriptorKey = null;
let neuralAiLoadState = "idle";
let neuralAiLoadError = "";
let neuralAiLoadPromise = null;
let neuralAiLoadGeneration = 0;
let neuralAiModelDisposer = null;
let neuralAiLoadController = null;
let neuralAiReviewLoadPromise = null;
let neuralAiReviewLoadController = null;
let neuralAiReviewLoadDescriptorKey = "";
let availableAiGenerations = [...AI_GENERATIONS];
let aiGenerationCatalogState = "loading";
let aiGenerationCatalogError = "";
let aiReplay = null;
let aiTurnTimer = null;
let aiThinking = false;
let aiTurnWorker = null;
let aiTurnWorkerUnavailable = false;
let aiTurnRequestSequence = 0;
let pendingAiTurnRequest = null;
let aiTurnWorkerBusyRequestId = "";
let aiTurnWorkerBusyWatchdog = null;
let aiTurnWorkerConfiguredNeuralKey = "";
let aiTurnWorkerConfigurationSequence = 0;
let pendingAiTurnWorkerConfiguration = null;
let aiDeepReviewRunning = false;
let replayAnalysisWorker = null;
let replayAnalysisWorkerUnavailable = false;
let replayAnalysisRequestSequence = 0;
const pendingReplayAnalyses = new Map();
const aiReplayPersistenceStates = new WeakMap();
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
const modalFocusOpeners = new Map();
let tabletopBackSentinelActive = false;
let suppressTabletopPopstate = false;
let observedGame = game;
let gameStateRevision = 0;
let currentRenderPreviousGeometry = null;
let cachedRenderIssueGame = null;
let cachedRenderIssueRevision = -1;
let cachedRenderIssue = "";
let cachedUiLegalGame = null;
let cachedUiLegalRevision = -1;
let cachedUiLegalViewerId = "";
let cachedUiLegalActions = [];
let motionGame = null;
let motionGameRevision = -1;
let motionViewerId = "";
let presentationGame = null;
let presentationGameRevision = -1;
let presentationViewerId = "";
let visibleCardIndexGame = null;
let visibleCardIndexRevision = -1;
let visibleCardIndex = new Map();
let selectedContextIndex = new Map();
let currentMightCache = new WeakMap();
let visibleCardStatusCache = new WeakMap();
let visibleCardStatusCacheLocale = locale();
let usableCardCache = new WeakMap();
let usableCardCacheGame = null;
let usableCardCacheRevision = -1;
let usableCardCacheContext = "";
let chainTreeCacheGame = null;
let chainTreeCacheRevision = -1;
let chainTreeCacheViewerId = "";
let chainTreeCacheItems = null;
let uiActionsByCardId = new Map();
let uiActionByKey = new Map();
let uiMoveDestinationsByUnitId = new Map();
let uiChampionPlayActions = [];
let lastAppMarkup = null;
let currentRenderMarkupChanged = true;
let scrollRestoreFrame = 0;
let diagnosticPersistenceTimer = null;
let diagnosticPersistenceIdleCallback = null;
const DIAGNOSTIC_BOUNDARY_ONLY = Symbol("diagnostic-boundary-only");
let diagnosticPersistenceDirty = false;
let pendingDiagnosticStateCheckpoint = null;
let roomRefreshController = null;
let aiTurnGeneration = 0;
let pointerCardDragFrame = 0;
const activeTabletopFlightCleanups = new Set();
const activeTabletopArrivalTimers = new Set();

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
  const cacheKey = `${text}\u0000${fallback}`;
  const cached = localizedDynamicTextCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let withLocalizedNames = LOCALIZED_CARD_NAME_PATTERN
    ? text.replace(LOCALIZED_CARD_NAME_PATTERN, (englishName) =>
      LOCALIZED_CARD_NAME_BY_ENGLISH.get(englishName) || englishName)
    : text;
  withLocalizedNames = localizedDeckName(withLocalizedNames);
  const localized = localizeKoreanUiText(withLocalizedNames, { fallback });
  rememberBoundedCacheValue(localizedDynamicTextCache, cacheKey, localized);
  return localized;
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
  const cached = localizedDeckNameCache.get(value);
  if (cached !== undefined) return cached;
  const localized = AI_DECK_PRESETS.find(preset => preset.playerName === value)?.displayNameKo
    || LOCALIZED_DECK_NAMES.get(value)
    || LOCALIZED_DECK_NAME_REPLACEMENTS.reduce(
      (result, [english, korean]) => result.replaceAll(english, korean),
      value
    );
  rememberBoundedCacheValue(localizedDeckNameCache, value, localized);
  return localized;
}

function rememberBoundedCacheValue(cache, key, value) {
  if (cache.size >= LOCALIZED_TEXT_CACHE_LIMIT && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
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

function resetDerivedGameCaches() {
  cachedRenderIssueGame = null;
  cachedRenderIssueRevision = -1;
  cachedUiLegalGame = null;
  cachedUiLegalRevision = -1;
  cachedUiLegalViewerId = "";
  cachedUiLegalActions = [];
  visibleCardIndexGame = null;
  visibleCardIndexRevision = -1;
  visibleCardIndex = new Map();
  selectedContextIndex = new Map();
  currentMightCache = new WeakMap();
  visibleCardStatusCache = new WeakMap();
  visibleCardStatusCacheLocale = locale();
  usableCardCache = new WeakMap();
  usableCardCacheGame = null;
  usableCardCacheRevision = -1;
  usableCardCacheContext = "";
  chainTreeCacheGame = null;
  chainTreeCacheRevision = -1;
  chainTreeCacheViewerId = "";
  chainTreeCacheItems = null;
}

function observeCurrentGame() {
  if (observedGame === game) return false;
  observedGame = game;
  gameStateRevision += 1;
  resetDerivedGameCaches();
  return true;
}

function markGameStateChanged() {
  observeCurrentGame();
  gameStateRevision += 1;
  resetDerivedGameCaches();
}

function currentGameUiRenderIssue() {
  observeCurrentGame();
  if (cachedRenderIssueGame === game && cachedRenderIssueRevision === gameStateRevision) {
    return cachedRenderIssue;
  }
  cachedRenderIssueGame = game;
  cachedRenderIssueRevision = gameStateRevision;
  cachedRenderIssue = gameUiRenderIssue(game);
  return cachedRenderIssue;
}

function legalActionsForCurrentUi(viewerId) {
  observeCurrentGame();
  if (cachedUiLegalGame === game
    && cachedUiLegalRevision === gameStateRevision
    && cachedUiLegalViewerId === viewerId) return cachedUiLegalActions;
  cachedUiLegalGame = game;
  cachedUiLegalRevision = gameStateRevision;
  cachedUiLegalViewerId = viewerId;
  cachedUiLegalActions = enumerateUiLegalActions(game, viewerId);
  return cachedUiLegalActions;
}

function indexUiLegalActions(actions) {
  uiActionsByCardId = new Map();
  uiActionByKey = new Map();
  uiMoveDestinationsByUnitId = new Map();
  uiChampionPlayActions = [];
  for (const action of actions || []) {
    uiActionByKey.set(actionKey(action), action);
    if (action?.cardId) {
      const cardActions = uiActionsByCardId.get(action.cardId) || [];
      cardActions.push(action);
      uiActionsByCardId.set(action.cardId, cardActions);
    }
    if (action?.kind === "moveUnit" && action.unitId && action.destinationId) {
      const destinations = uiMoveDestinationsByUnitId.get(action.unitId) || [];
      if (!destinations.includes(action.destinationId)) destinations.push(action.destinationId);
      uiMoveDestinationsByUnitId.set(action.unitId, destinations);
    }
    if (action?.kind === "beginPlayChampion") uiChampionPlayActions.push(action);
  }
}

function uiCardActions(cardId) {
  return uiActionsByCardId.get(String(cardId || "")) || [];
}

function uiUnitMoveDestinationIds(unitId) {
  return uiMoveDestinationsByUnitId.get(String(unitId || "")) || [];
}

function uiCurrentMight(card) {
  if (!card || typeof card !== "object") return 0;
  observeCurrentGame();
  if (currentMightCache.has(card)) return currentMightCache.get(card);
  const might = currentMight(game, card);
  currentMightCache.set(card, might);
  return might;
}

function replaceAppMarkup(markup) {
  const nextMarkup = String(markup ?? "");
  if (lastAppMarkup === nextMarkup && app.childNodes.length) {
    currentRenderMarkupChanged = false;
    return false;
  }
  app.innerHTML = nextMarkup;
  lastAppMarkup = nextMarkup;
  currentRenderMarkupChanged = true;
  return true;
}

function render() {
  if (draggingCardSession || pointerCardDrag) {
    cardDragRenderPending = true;
    return;
  }
  cardDragRenderPending = false;
  if (appView !== "game") cancelScheduledAiTurn();
  if (appView !== "multiplayer") stopRoomRefresh();
  observeCurrentGame();
  clearRuneScrollGesture();
  clearRunePowerHold();
  currentRenderPreviousGeometry = null;
  const previousFocus = captureFocusState();
  const previousModalKey = topUiModalKey();
  try {
    renderApp();
    if (currentRenderMarkupChanged) {
      syncModalAccessibility();
      restoreFocusAfterRender(previousFocus, previousModalKey);
    }
    syncTabletopBackSentinel();
    if (currentRenderPreviousGeometry) {
      runTabletopTransferAnimations(uiMotion.transfers, currentRenderPreviousGeometry);
    }
  } catch (error) {
    reportUiException(error, "render");
    showUiExceptionOverlay(error, "render");
    if (pendingRecoveredBugReport()) {
      window.__riftboundEarlyCrashGuard?.show(error, true);
    }
  }
}

const FOCUS_DATA_KEYS = [
  "action", "card", "cardId", "player", "destination", "choice", "rune", "mode", "ability",
  "chainItemId", "unit", "battlefield", "target", "effect", "power", "energy", "alphaTarget"
];

function focusableElements(scope = app) {
  if (!scope?.querySelectorAll) return [];
  return [...scope.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
    .filter(elementCanReceiveFocus);
}

function elementCanReceiveFocus(node) {
  if (!(node instanceof HTMLElement) || node.disabled || node.closest("[inert]")) return false;
  if (node.tabIndex < 0 && !node.matches("[data-ui-modal]")) return false;
  if (node.hidden || node.closest("[hidden], [aria-hidden='true']")) return false;
  return node.getClientRects().length > 0;
}

function captureFocusState() {
  const node = document.activeElement;
  if (!(node instanceof HTMLElement) || !app?.contains(node)) return null;
  const data = {};
  for (const key of FOCUS_DATA_KEYS) {
    if (node.dataset?.[key] != null) data[key] = String(node.dataset[key]);
  }
  const seat = node.closest("[data-player-id]");
  const zone = node.closest("[data-zone]");
  return {
    tag: node.tagName,
    type: node.getAttribute("type") || "",
    id: node.id || "",
    name: node.getAttribute("name") || "",
    data,
    seatId: seat?.dataset.playerId || "",
    zone: zone?.dataset.zone || "",
    selectionStart: typeof node.selectionStart === "number" ? node.selectionStart : null,
    selectionEnd: typeof node.selectionEnd === "number" ? node.selectionEnd : null
  };
}

function focusStateMatches(node, state) {
  if (!(node instanceof HTMLElement) || !state || node.tagName !== state.tag) return false;
  if (state.id && node.id === state.id) return true;
  if (state.type && node.getAttribute("type") !== state.type) return false;
  if (state.name && node.getAttribute("name") !== state.name) return false;
  const entries = Object.entries(state.data || {});
  if (!entries.length) return false;
  if (!entries.every(([key, value]) => String(node.dataset?.[key] ?? "") === value)) return false;
  const seat = node.closest("[data-player-id]")?.dataset.playerId || "";
  const zone = node.closest("[data-zone]")?.dataset.zone || "";
  if (state.seatId && state.seatId !== seat) return false;
  if (state.zone && state.zone !== zone) return false;
  return true;
}

function restoreFocusState(state, scope = app) {
  if (!state || !scope?.querySelectorAll) return false;
  let candidates = [];
  if (state.id) {
    const byId = document.getElementById(state.id);
    if (byId && scope.contains(byId)) candidates = [byId];
  }
  if (!candidates.length) {
    try {
      candidates = [...scope.querySelectorAll(String(state.tag || "button").toLowerCase())];
    } catch {
      candidates = [];
    }
  }
  const candidate = candidates.find((node) => focusStateMatches(node, state));
  if (!elementCanReceiveFocus(candidate)) return false;
  candidate.focus({ preventScroll: true });
  if (state.selectionStart != null && typeof candidate.setSelectionRange === "function") {
    try {
      candidate.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart);
    } catch {
      // Number/range inputs do not expose a text selection range.
    }
  }
  return true;
}

function topUiModal() {
  const modals = app?.querySelectorAll?.("[data-ui-modal]:not([hidden]):not([aria-hidden='true'])");
  return modals?.[modals.length - 1] || null;
}

function topUiModalKey() {
  const modal = topUiModal();
  return modal?.dataset.modalKey || modal?.id || "";
}

function focusModalInitial(modal) {
  if (!(modal instanceof HTMLElement)) return;
  const items = focusableElements(modal);
  const preferred = items.find((node) => node.hasAttribute("data-primary-focus"))
    || items[0]
    || modal;
  preferred.focus({ preventScroll: true });
}

function restoreFocusAfterRender(previousFocus, previousModalKey) {
  const modal = topUiModal();
  const currentModalKey = modal?.dataset.modalKey || modal?.id || "";
  for (const key of [...modalFocusOpeners.keys()]) {
    if (key !== currentModalKey && key !== previousModalKey) modalFocusOpeners.delete(key);
  }
  if (modal && currentModalKey !== previousModalKey && !modalFocusOpeners.has(currentModalKey)) {
    if (previousFocus) modalFocusOpeners.set(currentModalKey, previousFocus);
    focusModalInitial(modal);
    return;
  }
  if (previousModalKey && previousModalKey !== currentModalKey && modalFocusOpeners.has(previousModalKey)) {
    const opener = modalFocusOpeners.get(previousModalKey);
    modalFocusOpeners.delete(previousModalKey);
    if (restoreFocusState(opener, modal || app)) return;
  }
  if (modal && currentModalKey !== previousModalKey) {
    focusModalInitial(modal);
    return;
  }
  if (modal) {
    if (!restoreFocusState(previousFocus, modal)) focusModalInitial(modal);
    return;
  }
  if (previousModalKey && modalFocusOpeners.has(previousModalKey)) {
    const opener = modalFocusOpeners.get(previousModalKey);
    modalFocusOpeners.delete(previousModalKey);
    if (restoreFocusState(opener)) return;
  }
  restoreFocusState(previousFocus);
}

function setUiInert(node, inert) {
  if (!(node instanceof HTMLElement)) return;
  if (inert) {
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
    node.dataset.uiInert = "true";
    return;
  }
  if (node.dataset.uiInert !== "true") return;
  node.removeAttribute("inert");
  node.removeAttribute("aria-hidden");
  delete node.dataset.uiInert;
}

function syncModalAccessibility() {
  for (const node of app?.querySelectorAll?.("[data-ui-inert]") || []) setUiInert(node, false);
  const modal = topUiModal();
  if (!modal) return;
  const topbar = app.querySelector(".tabletop-topbar");
  const tutorialExit = String(modal.dataset.modalKey || "").startsWith("tutorial-")
    ? topbar?.querySelector('[data-action="tutorial-exit"]')
    : null;
  if (tutorialExit) {
    // The tutorial welcome/complete guide is modal to game actions, but its
    // permanent escape hatch must remain clickable and keyboard reachable.
    for (const child of topbar?.children || []) {
      if (!child.contains(tutorialExit)) setUiInert(child, true);
    }
    for (const control of topbar?.querySelectorAll("button, input, select, textarea, a[href], [tabindex]") || []) {
      if (control !== tutorialExit) setUiInert(control, true);
    }
  } else {
    setUiInert(topbar, true);
  }
  const layout = modal.closest(".tabletop-layout") || app.querySelector(".tabletop-layout");
  const overlay = layout?.querySelector(":scope > .tabletop-overlay-root");
  for (const child of layout?.children || []) {
    if (child === overlay || child === modal || child.contains(modal)) continue;
    setUiInert(child, true);
  }
  for (const child of overlay?.children || []) {
    if (child === modal || child.contains(modal)) continue;
    setUiInert(child, true);
  }
}

function trapModalTab(event, modal) {
  const items = focusableElements(modal).filter((node) => node !== modal);
  if (!items.length) {
    event.preventDefault();
    modal.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items.at(-1);
  if (!modal.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  }
}

function hasTabletopUiLayer() {
  if (appView !== "game") return false;
  if (replayMode) return true;
  if (app?.querySelector?.(".phase-unavailable")) return false;
  return Boolean(topUiModal() || fullCardOpen || pendingGameExit || game?.phase === "complete" || matchIsBetweenGames()
    || graveyardOpenPlayerId || banishedOpenPlayerId || intelOpenPlayerId || logOpen || inspectorOpen
    || attachmentsOpenCardId || inspectedChainItemId || handOpen || moveSelection.size);
}

function syncTabletopBackSentinel() {
  const shouldGuard = hasTabletopUiLayer();
  if (shouldGuard && !tabletopBackSentinelActive) {
    try {
      window.history.pushState({ ...(window.history.state || {}), riftboundUiLayer: true }, "", window.location.href);
      tabletopBackSentinelActive = true;
    } catch (error) {
      reportUiException(error, "UI history guard");
    }
    return;
  }
  if (!shouldGuard && tabletopBackSentinelActive) {
    suppressTabletopPopstate = true;
    tabletopBackSentinelActive = false;
    try {
      window.history.back();
    } catch (error) {
      suppressTabletopPopstate = false;
      reportUiException(error, "UI history release");
    }
  }
}

function normalizedDomZone(zone) {
  return {
    "main-deck": "mainDeck",
    "rune-deck": "runeDeck"
  }[zone] || String(zone || "");
}

const TABLETOP_CARD_ASPECT_RATIO = 5 / 7;

function motionLocationKey(location, { includeLocation = true } = {}) {
  if (!location) return "";
  return [
    String(location.playerId || ""),
    normalizedDomZone(location.zone),
    includeLocation ? String(location.locationId || "") : ""
  ].join("|");
}

function tabletopRect(node) {
  if (!(node instanceof Element)) return null;
  if (node.hidden || node.closest("[hidden], [aria-hidden='true']")) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

function tabletopCardNodePriority(node) {
  if (node.closest(".tabletop-overlay-root")) return -1;
  if (node.matches("[data-hand-card]")) return 100;
  if (node.matches(".unit-token, .base-token, .nonunit-token")) return 95;
  if (node.matches("[data-rune-card], .rune-card-chip")) return 90;
  if (node.matches(".identity-button, .physical-identity-card")) return 80;
  if (node.matches(".chain-zone-item")) return 70;
  if (node.matches(".image-card")) return 50;
  return 20;
}

function tabletopDomLocation(node) {
  if (!(node instanceof Element)) return null;
  const seat = node.closest("[data-player-id]");
  const zoneNode = node.matches("[data-zone]") ? node : node.closest("[data-zone]");
  return {
    playerId: node.dataset.motionPlayerId || node.dataset.playerId || seat?.dataset.playerId || "",
    zone: normalizedDomZone(node.dataset.motionZone || node.dataset.zone || zoneNode?.dataset.zone),
    locationId: node.dataset.motionLocationId
      || node.dataset.locationId
      || node.dataset.battlefieldId
      || zoneNode?.dataset.locationId
      || zoneNode?.dataset.battlefieldId
      || ""
  };
}

function tabletopNodeMatchesLocation(node, location) {
  if (!location) return false;
  const nodeLocation = tabletopDomLocation(node);
  if (!nodeLocation || nodeLocation.zone !== normalizedDomZone(location.zone)) return false;
  if (location.playerId && nodeLocation.playerId && String(location.playerId) !== String(nodeLocation.playerId)) return false;
  if (location.locationId && nodeLocation.locationId && String(location.locationId) !== String(nodeLocation.locationId)) return false;
  return true;
}

function tabletopCardSurfaceRect(rect) {
  if (!rect) return null;
  const width = Number(rect.width);
  const height = Number(rect.height);
  const left = Number(rect.left);
  const top = Number(rect.top);
  if (![width, height, left, top].every(Number.isFinite) || width < 2 || height < 2) return null;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  let cardWidth = width;
  let cardHeight = height;
  if (cardWidth / cardHeight > TABLETOP_CARD_ASPECT_RATIO) cardWidth = cardHeight * TABLETOP_CARD_ASPECT_RATIO;
  else cardHeight = cardWidth / TABLETOP_CARD_ASPECT_RATIO;
  const cardLeft = centerX - cardWidth / 2;
  const cardTop = centerY - cardHeight / 2;
  return {
    top: cardTop,
    right: cardLeft + cardWidth,
    bottom: cardTop + cardHeight,
    left: cardLeft,
    width: cardWidth,
    height: cardHeight
  };
}

function captureTabletopGeometry() {
  const geometry = {
    cardRects: new Map(),
    zoneRects: new Map(),
    anchorRects: new Map(),
    cardNodes: new Map(),
    zoneNodes: new Map(),
    anchorNodes: new Map()
  };
  const root = app?.querySelector?.(".tabletop-layout");
  if (!root) return geometry;

  for (const node of root.querySelectorAll("[data-card-id]")) {
    const id = String(node.dataset.cardId || "");
    if (!id || node.closest(".tabletop-overlay-root")) continue;
    const priority = tabletopCardNodePriority(node);
    const rect = priority >= 0 ? tabletopRect(node) : null;
    const previous = geometry.cardRects.get(id);
    if (!rect || (previous && previous.priority >= priority)) continue;
    geometry.cardRects.set(id, { rect, priority });
    geometry.cardNodes.set(id, { node, priority });
  }

  for (const node of root.querySelectorAll("[data-zone]")) {
    if (node.closest(".tabletop-overlay-root")) continue;
    const rect = tabletopRect(node);
    if (!rect) continue;
    const location = tabletopDomLocation(node);
    if (!location?.zone) continue;
    const broadKey = motionLocationKey(location, { includeLocation: false });
    geometry.zoneRects.set(broadKey, rect);
    geometry.zoneNodes.set(broadKey, node);
    if (location.locationId) {
      const exactKey = motionLocationKey(location);
      geometry.zoneRects.set(exactKey, rect);
      geometry.zoneNodes.set(exactKey, node);
    }
  }

  for (const node of root.querySelectorAll("[data-motion-anchor]")) {
    if (node.closest(".tabletop-overlay-root")) continue;
    const rect = tabletopRect(node);
    const location = tabletopDomLocation(node);
    if (!rect || !location?.zone) continue;
    const broadKey = motionLocationKey(location, { includeLocation: false });
    geometry.anchorRects.set(broadKey, rect);
    geometry.anchorNodes.set(broadKey, node);
    if (location.locationId) {
      const exactKey = motionLocationKey(location);
      geometry.anchorRects.set(exactKey, rect);
      geometry.anchorNodes.set(exactKey, node);
    }
    const cardId = String(node.dataset.motionCardId || "");
    if (!cardId) continue;
    const priority = 120;
    const previous = geometry.cardRects.get(cardId);
    if (!previous || previous.priority < priority) {
      geometry.cardRects.set(cardId, { rect, priority });
      geometry.cardNodes.set(cardId, { node, priority });
    }
  }
  return geometry;
}

function geometryNodeForTransfer(geometry, transfer, endpoint) {
  const location = transfer?.[endpoint];
  if (!location || !geometry) return null;
  const zone = normalizedDomZone(location.zone);
  const preferAnchor = ["chain", "trash", "banished", "mainDeck", "runeDeck"].includes(zone);
  const endpointCardId = endpoint === "from" ? transfer.fromCardId || transfer.id : transfer.toCardId || transfer.id;
  const cardNode = geometry.cardNodes?.get(String(endpointCardId || ""))?.node || null;
  const nodeAt = (nodes) => nodes?.get(motionLocationKey(location))
    || nodes?.get(motionLocationKey(location, { includeLocation: false }))
    || nodes?.get(motionLocationKey({ ...location, playerId: "" }))
    || nodes?.get(motionLocationKey({ ...location, playerId: "" }, { includeLocation: false }))
    || null;
  const anchorNode = nodeAt(geometry.anchorNodes);
  const zoneNode = nodeAt(geometry.zoneNodes);
  if (zone === "chain") return cardNode || anchorNode || zoneNode;
  return preferAnchor ? anchorNode || cardNode || zoneNode : cardNode || anchorNode || zoneNode;
}

function geometryRectForTransfer(geometry, transfer, endpoint) {
  const location = transfer?.[endpoint];
  if (!location || !geometry) return null;
  const zone = normalizedDomZone(location.zone);
  const preferAnchor = ["chain", "trash", "banished", "mainDeck", "runeDeck"].includes(zone);
  const endpointCardId = endpoint === "from" ? transfer.fromCardId || transfer.id : transfer.toCardId || transfer.id;
  const cardRect = geometry.cardRects?.get(endpointCardId)?.rect || null;
  const anchorRect = geometry.anchorRects?.get(motionLocationKey(location))
    || geometry.anchorRects?.get(motionLocationKey(location, { includeLocation: false }))
    || geometry.anchorRects?.get(motionLocationKey({ ...location, playerId: "" }))
    || geometry.anchorRects?.get(motionLocationKey({ ...location, playerId: "" }, { includeLocation: false }))
    || null;
  const zoneRect = geometry.zoneRects?.get(motionLocationKey(location))
    || geometry.zoneRects?.get(motionLocationKey(location, { includeLocation: false }))
    || geometry.zoneRects?.get(motionLocationKey({ ...location, playerId: "" }))
    || geometry.zoneRects?.get(motionLocationKey({ ...location, playerId: "" }, { includeLocation: false }))
    || null;
  const preferredRect = zone === "chain"
    ? cardRect || anchorRect || zoneRect
    : preferAnchor
      ? anchorRect || cardRect || zoneRect
      : cardRect || anchorRect || zoneRect;
  return tabletopCardSurfaceRect(preferredRect);
}

function tabletopMotionReduced() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function presentationMotionDuration(duration) {
  return tabletopMotionReduced() ? Math.min(40, Math.max(1, Number(duration) || 1)) : duration;
}

function tabletopTransferRotations(transfer) {
  return {
    start: transfer?.from?.exhausted ? 90 : 0,
    end: transfer?.to?.exhausted ? 90 : 0
  };
}

function createTabletopFlight(transfer, start) {
  const flight = document.createElement("div");
  flight.className = `tabletop-card-flight transfer-${transfer.kind} ${transfer.faceVisible ? "face-up" : "face-down"}`;
  flight.setAttribute("aria-hidden", "true");
  flight.style.left = `${start.left}px`;
  flight.style.top = `${start.top}px`;
  flight.style.width = `${start.width}px`;
  flight.style.height = `${start.height}px`;
  flight.style.aspectRatio = String(TABLETOP_CARD_ASPECT_RATIO);
  if (transfer.faceVisible && transfer.image) {
    const image = document.createElement("img");
    image.src = transfer.image;
    image.alt = "";
    flight.appendChild(image);
  } else if (transfer.faceVisible && transfer.name) {
    const label = document.createElement("span");
    label.className = "flight-card-name";
    label.textContent = transfer.name;
    flight.appendChild(label);
  } else {
    const back = document.createElement("span");
    back.className = "flight-card-back";
    back.textContent = "R";
    flight.appendChild(back);
  }
  return flight;
}

function runTabletopTransferAnimations(transfers, previousGeometry) {
  if (!Array.isArray(transfers) || !transfers.length || !app?.querySelector?.(".tabletop-layout")) return;
  const currentGeometry = captureTabletopGeometry();
  const reduced = tabletopMotionReduced();
  let drawIndex = 0;
  let layer = null;

  for (const transfer of transfers) {
    if (["exhaust", "ready"].includes(transfer?.kind)) continue;
    const start = geometryRectForTransfer(previousGeometry, transfer, "from");
    const end = geometryRectForTransfer(currentGeometry, transfer, "to");
    if (!start || !end) continue;
    const dx = (end.left + end.width / 2) - (start.left + start.width / 2);
    const dy = (end.top + end.height / 2) - (start.top + start.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance < 3 && Math.abs(end.width - start.width) < 2 && Math.abs(end.height - start.height) < 2) continue;
    const destinationNode = geometryNodeForTransfer(currentGeometry, transfer, "to");
    const destinationVisualNode = destinationNode?.matches?.("[data-zone]") ? null : destinationNode;
    const delay = transfer.kind === "draw" ? drawIndex++ * TABLETOP_DRAW_STAGGER_MS : 0;
    const revealDestination = () => {
      destinationVisualNode?.classList.remove("tabletop-transfer-pending");
      if (!destinationNode) return;
      destinationNode.classList.add("tabletop-transfer-arrival", `arrival-${transfer.kind}`);
      const arrivalTimer = window.setTimeout(() => {
        activeTabletopArrivalTimers.delete(arrivalTimer);
        destinationNode.classList.remove("tabletop-transfer-arrival", `arrival-${transfer.kind}`);
      }, 360);
      activeTabletopArrivalTimers.add(arrivalTimer);
    };
    if (reduced) {
      revealDestination();
      continue;
    }
    destinationVisualNode?.classList.add("tabletop-transfer-pending");

    if (!layer) {
      layer = document.createElement("div");
      layer.className = "tabletop-card-flight-layer";
      document.body.appendChild(layer);
    }
    const flight = createTabletopFlight(transfer, start);
    layer.appendChild(flight);
    const scale = Math.min(4, Math.max(0.18, end.width / Math.max(1, start.width)));
    const rotations = tabletopTransferRotations(transfer);
    const fadeEnd = ["burn", "discard", "defeat", "resolve", "flow", "banish", "recycle"].includes(transfer.kind) ? 0.2 : 0.94;
    const animation = flight.animate([
      {
        transform: `translate3d(0,0,0) scale(1) rotate(${rotations.start}deg)`,
        opacity: 0.96
      },
      {
        transform: `translate3d(${dx}px,${dy}px,0) scale(${scale}) rotate(${rotations.end}deg)`,
        opacity: fadeEnd
      }
    ], {
      duration: TABLETOP_TRANSFER_DURATION_MS,
      delay,
      easing: TABLETOP_TRANSFER_EASING,
      fill: "forwards"
    });
    let cleaned = false;
    let fallbackTimer = null;
    let cancelActiveFlight = null;
    const cleanup = (arrive = true) => {
      if (cleaned) return;
      cleaned = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
      if (cancelActiveFlight) activeTabletopFlightCleanups.delete(cancelActiveFlight);
      flight.remove();
      if (arrive) revealDestination();
      else destinationVisualNode?.classList.remove("tabletop-transfer-pending");
      if (layer && !layer.childElementCount) layer.remove();
    };
    cancelActiveFlight = () => {
      try { animation.cancel(); } catch {}
      cleanup(false);
    };
    activeTabletopFlightCleanups.add(cancelActiveFlight);
    animation.addEventListener("finish", () => cleanup(true), { once: true });
    animation.addEventListener("cancel", () => cleanup(false), { once: true });
    fallbackTimer = window.setTimeout(() => cleanup(true), delay + TABLETOP_TRANSFER_DURATION_MS + 180);
  }
}

function clearTabletopFlightAnimations() {
  for (const cleanup of [...activeTabletopFlightCleanups]) cleanup();
  activeTabletopFlightCleanups.clear();
  for (const timer of activeTabletopArrivalTimers) window.clearTimeout(timer);
  activeTabletopArrivalTimers.clear();
  for (const layer of document.querySelectorAll(".tabletop-card-flight-layer")) layer.remove();
}

function renderPowerCostIssue(power, label) {
  if (!Array.isArray(power)) return `${label} is invalid.`;
  for (const [index, requirement] of power.entries()) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) return `${label}[${index}] is invalid.`;
    if (typeof requirement.domain !== "string" || !requirement.domain) return `${label}[${index}] domain is invalid.`;
    if (!Number.isInteger(requirement.amount) || requirement.amount < 0) return `${label}[${index}] amount is invalid.`;
    if (requirement.allowedDomains != null
      && (!Array.isArray(requirement.allowedDomains) || requirement.allowedDomains.some((domain) => typeof domain !== "string" || !domain))) {
      return `${label}[${index}] allowed domains are invalid.`;
    }
  }
  return "";
}

function renderObjectListIssue(value, label, { allowNull = false } = {}) {
  if (!Array.isArray(value)) return `${label} is invalid.`;
  for (const [index, item] of value.entries()) {
    if (allowNull && item == null) continue;
    if (!item || typeof item !== "object" || Array.isArray(item)) return `${label}[${index}] is invalid.`;
  }
  return "";
}

function renderStringListIssue(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) return `${label} is invalid.`;
  return "";
}

const TARGET_RECORD_KEYS = [
  "declaredTargets", "declaredPlayTargets", "playResolutionTargets", "declaredTargetIdentities",
  "declaredChoices", "declaredPlayChoices", "playResolutionChoices", "allocations"
];
const TARGET_REFERENCE_KEYS = [
  "targetId", "cardId", "unitId", "battlefieldId", "destinationId"
];

function renderTargetCarrierIssue(value, label) {
  if (value == null) return "";
  if (typeof value !== "object" || Array.isArray(value)) return `${label} is invalid.`;
  for (const key of TARGET_REFERENCE_KEYS) {
    if (value[key] != null && (typeof value[key] !== "string" || !value[key])) return `${label} ${key} is invalid.`;
  }
  for (const key of TARGET_RECORD_KEYS) {
    if (value[key] == null) continue;
    const issue = renderObjectListIssue(value[key], `${label} ${key}`);
    if (issue) return issue;
    for (const [index, record] of value[key].entries()) {
      for (const referenceKey of TARGET_REFERENCE_KEYS) {
        if (record[referenceKey] != null && (typeof record[referenceKey] !== "string" || !record[referenceKey])) {
          return `${label} ${key}[${index}] ${referenceKey} is invalid.`;
        }
      }
    }
  }
  if (value.targetIds != null) {
    const issue = renderStringListIssue(value.targetIds, `${label} targetIds`);
    if (issue) return issue;
  }
  return "";
}

function renderNestedRepeatableFieldsIssue(value, label, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = renderNestedRepeatableFieldsIssue(item, `${label}[${index}]`, seen);
      if (issue) return issue;
    }
    return "";
  }
  for (const key of TARGET_REFERENCE_KEYS) {
    if (value[key] != null && (typeof value[key] !== "string" || !value[key])) return `${label} ${key} is invalid.`;
  }
  for (const key of [
    "abilityKeywords", "allowedDomains", "cardTypes", "keywords", "names",
    "sourceCardTypes", "targetIds", "targetTags", "tags"
  ]) {
    if (value[key] == null) continue;
    const issue = renderStringListIssue(value[key], `${label} ${key}`);
    if (issue) return issue;
  }
  for (const key of ["costPower", "replacementPower", "additionalPowerCost"]) {
    if (value[key] == null) continue;
    const issue = renderPowerCostIssue(value[key], `${label} ${key}`);
    if (issue) return issue;
  }
  if (value.additionalPower != null) {
    const issue = renderPowerCostIssue(
      Array.isArray(value.additionalPower) ? value.additionalPower : [value.additionalPower],
      `${label} additionalPower`
    );
    if (issue) return issue;
  }
  if (value.costOptions != null) {
    const optionsIssue = renderObjectListIssue(value.costOptions, `${label} costOptions`);
    if (optionsIssue) return optionsIssue;
    for (const [index, option] of value.costOptions.entries()) {
      if (option.power == null) continue;
      const powerIssue = renderPowerCostIssue(option.power, `${label} costOptions[${index}] power`);
      if (powerIssue) return powerIssue;
    }
  }
  if (value.specs != null) {
    const issue = renderObjectListIssue(value.specs, `${label} specs`);
    if (issue) return issue;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (!nested || typeof nested !== "object") continue;
    const issue = renderNestedRepeatableFieldsIssue(nested, `${label} ${key}`, seen);
    if (issue) return issue;
  }
  return "";
}

function collectAuthoritativeCardIds(card, label, ids) {
  if (!card) return "";
  if (ids.has(card.instanceId)) return `${label} duplicates card identifier ${card.instanceId}.`;
  ids.add(card.instanceId);
  for (const [index, attachment] of (card.attachments || []).entries()) {
    const issue = collectAuthoritativeCardIds(attachment, `${label} attachment[${index}]`, ids);
    if (issue) return issue;
  }
  return "";
}

function renderCardIssue(card, label) {
  if (!card || typeof card !== "object" || Array.isArray(card)
    || typeof card.instanceId !== "string" || !card.instanceId
    || typeof card.name !== "string" || !card.name) return `${label} has an invalid card.`;
  if (card.text != null && typeof card.text !== "string") return `${label} text is invalid.`;
  if (card.translations != null) {
    if (typeof card.translations !== "object" || Array.isArray(card.translations)) return `${label} translations are invalid.`;
    for (const [language, translation] of Object.entries(card.translations)) {
      if (!translation || typeof translation !== "object" || Array.isArray(translation)) return `${label} ${language} translation is invalid.`;
      for (const key of ["name", "text"]) {
        if (translation[key] != null && typeof translation[key] !== "string") return `${label} ${language} translation ${key} is invalid.`;
      }
    }
  }
  for (const key of [
    "attachments", "effects", "appendedEffects", "copiedEffectTextEffects", "keywords", "types", "tags", "domains", "power",
    "temporaryKeywords", "appendedKeywords", "copiedEffectTextKeywords", "damagePreventions",
    "declaredPlayTargets", "playResolutionTargets", "declaredTargetIdentities",
    "declaredPlayChoices", "playResolutionChoices", "paidOptionalPowerEffects"
  ]) {
    if (card[key] != null && !Array.isArray(card[key])) return `${label} ${key} is invalid.`;
  }
  for (const key of ["keywords", "types", "tags", "domains", "temporaryKeywords", "appendedKeywords", "copiedEffectTextKeywords"]) {
    if (card[key] == null) continue;
    const issue = renderStringListIssue(card[key], `${label} ${key}`);
    if (issue) return issue;
  }
  for (const key of ["effects", "appendedEffects", "copiedEffectTextEffects", "damagePreventions", "declaredPlayTargets", "playResolutionTargets", "declaredTargetIdentities", "declaredPlayChoices", "playResolutionChoices", "paidOptionalPowerEffects"]) {
    if (card[key] == null) continue;
    const issue = renderObjectListIssue(card[key], `${label} ${key}`, {
      allowNull: ["effects", "appendedEffects", "copiedEffectTextEffects"].includes(key)
    });
    if (issue) return issue;
  }
  const carrierIssue = renderTargetCarrierIssue(card, label);
  if (carrierIssue) return carrierIssue;
  for (const key of ["effects", "appendedEffects", "copiedEffectTextEffects"]) {
    for (const [index, effect] of (card[key] || []).entries()) {
      const issue = renderNestedRepeatableFieldsIssue(effect, `${label} ${key}[${index}]`);
      if (issue) return issue;
    }
  }
  const powerIssue = renderPowerCostIssue(card.power || [], `${label} power`);
  if (powerIssue) return powerIssue;
  if (card.additionalCost != null) {
    if (typeof card.additionalCost !== "object" || Array.isArray(card.additionalCost)) return `${label} additionalCost is invalid.`;
    const additionalCostIssue = renderNestedRepeatableFieldsIssue(card.additionalCost, `${label} additionalCost`);
    if (additionalCostIssue) return additionalCostIssue;
  }
  for (const [index, attachment] of (card.attachments || []).entries()) {
    const issue = renderCardIssue(attachment, `${label} attachment[${index}]`);
    if (issue) return issue;
  }
  return "";
}

function renderCardListIssue(list, label) {
  if (!Array.isArray(list)) return `${label} is unavailable.`;
  for (const [index, card] of list.entries()) {
    const issue = renderCardIssue(card, `${label}[${index}]`);
    if (issue) return issue;
  }
  return "";
}

function renderContinuationIssue(continuation, label, depth = 0) {
  if (continuation == null) return "";
  if (!continuation || typeof continuation !== "object" || Array.isArray(continuation)
    || typeof continuation.kind !== "string" || !continuation.kind) return `${label} is invalid.`;
  if (depth > 8) return `${label} nesting is invalid.`;
  if (continuation.kind === "triggerContinuationSequence" || continuation.continuations != null) {
    if (!Array.isArray(continuation.continuations)) return `${label} continuations are invalid.`;
    for (const [index, nested] of continuation.continuations.entries()) {
      const issue = renderContinuationIssue(nested, `${label} continuations[${index}]`, depth + 1);
      if (issue) return issue;
    }
  }
  return "";
}

function renderTriggerIssue(trigger, label, playerIds) {
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) return `${label} is invalid.`;
  if (!playerIds.has(trigger.playerId)) return `${label} player is invalid.`;
  if (typeof trigger.kind !== "string" || !trigger.kind) return `${label} kind is invalid.`;
  for (const key of ["id", "sourceCardId"]) {
    if (trigger[key] != null && (typeof trigger[key] !== "string" || !trigger[key])) return `${label} ${key} is invalid.`;
  }
  if (trigger.sourceCardSnapshot != null) {
    const sourceIssue = renderCardIssue(trigger.sourceCardSnapshot, `${label} sourceCardSnapshot`);
    if (sourceIssue) return sourceIssue;
  }
  const triggerIssue = renderTargetCarrierIssue(trigger, label);
  if (triggerIssue) return triggerIssue;
  const dataIssue = renderTargetCarrierIssue(trigger.data, `${label} data`);
  if (dataIssue) return dataIssue;
  const nestedIssue = renderNestedRepeatableFieldsIssue(trigger.data, `${label} data`);
  if (nestedIssue) return nestedIssue;
  return "";
}

function renderTriggerBatchIssue(batch, label, playerIds) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch) || !Array.isArray(batch.triggers)) return `${label} is invalid.`;
  if (batch.mode != null && !["queue", "showdownChain", "actionChain"].includes(batch.mode)) return `${label} mode is invalid.`;
  for (const [index, trigger] of batch.triggers.entries()) {
    const issue = renderTriggerIssue(trigger, `${label} triggers[${index}]`, playerIds);
    if (issue) return issue;
  }
  return renderContinuationIssue(batch.continuation, `${label} continuation`);
}

function renderPendingAsyncStateIssue(pending, label, playerIds) {
  if (pending.effectSequenceContinuation != null) {
    const continuation = pending.effectSequenceContinuation;
    if (!continuation || typeof continuation !== "object" || Array.isArray(continuation)
      || !playerIds.has(continuation.playerId)
      || typeof continuation.finishSpell !== "boolean") return `${label} effectSequenceContinuation is invalid.`;
    const cardIssue = renderCardIssue(continuation.card, `${label} effectSequenceContinuation card`);
    if (cardIssue) return cardIssue;
    const specsIssue = renderObjectListIssue(continuation.specs, `${label} effectSequenceContinuation specs`);
    if (specsIssue) return specsIssue;
    for (const [index, spec] of continuation.specs.entries()) {
      const nestedIssue = renderNestedRepeatableFieldsIssue(spec, `${label} effectSequenceContinuation specs[${index}]`);
      if (nestedIssue) return nestedIssue;
    }
  }
  if (pending.gameEffectResolution != null) {
    const resolution = pending.gameEffectResolution;
    const context = resolution?.context;
    if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)
      || !context || typeof context !== "object" || Array.isArray(context)
      || ![null, "action", "showdown"].includes(context.chainKind)
      || typeof context.finalized !== "boolean"
      || !Array.isArray(context.pendingTriggerBatches)) return `${label} gameEffectResolution is invalid.`;
    for (const [index, batch] of context.pendingTriggerBatches.entries()) {
      const issue = renderTriggerBatchIssue(batch, `${label} gameEffectResolution pendingTriggerBatches[${index}]`, playerIds);
      if (issue) return issue;
    }
  }
  return "";
}

const DIVINE_JUDGMENT_DATA_CATEGORIES = ["units", "gear", "runes", "hand"];

function renderDivineJudgmentDataIssue(choice, label, playerIds) {
  if (!["divineJudgmentKeep", "divineJudgmentRuneOrder"].includes(choice.effect)) return "";
  const data = choice.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return `${label} Divine Judgment data is invalid.`;
  const seatIssue = renderStringListIssue(data.playerIds, `${label} Divine Judgment playerIds`);
  if (seatIssue) return seatIssue;
  if (data.playerIds.length !== playerIds.size
    || new Set(data.playerIds).size !== playerIds.size
    || data.playerIds.some((playerId) => !playerIds.has(playerId))) {
    return `${label} Divine Judgment playerIds are invalid.`;
  }
  if (!Number.isInteger(data.playerIndex) || data.playerIndex < 0 || data.playerIndex > data.playerIds.length) {
    return `${label} Divine Judgment playerIndex is invalid.`;
  }
  if (!Number.isInteger(data.categoryIndex)
    || data.categoryIndex < 0
    || data.categoryIndex >= DIVINE_JUDGMENT_DATA_CATEGORIES.length) {
    return `${label} Divine Judgment categoryIndex is invalid.`;
  }
  if (typeof data.finishSpell !== "boolean" || typeof data.fromShowdownChain !== "boolean") {
    return `${label} Divine Judgment continuation flags are invalid.`;
  }
  const selectedIssue = renderStringListIssue(data.selectedIds, `${label} Divine Judgment selectedIds`);
  if (selectedIssue) return selectedIssue;
  if (!data.kept || typeof data.kept !== "object" || Array.isArray(data.kept)) {
    return `${label} Divine Judgment kept state is invalid.`;
  }
  for (const [playerId, kept] of Object.entries(data.kept)) {
    if (!playerIds.has(playerId) || !kept || typeof kept !== "object" || Array.isArray(kept)) {
      return `${label} Divine Judgment kept state for ${playerId} is invalid.`;
    }
    for (const category of DIVINE_JUDGMENT_DATA_CATEGORIES) {
      if (kept[category] == null) continue;
      const issue = renderStringListIssue(kept[category], `${label} Divine Judgment kept ${playerId} ${category}`);
      if (issue) return issue;
    }
  }
  if (choice.effect === "divineJudgmentKeep") {
    if (data.playerIndex >= data.playerIds.length || data.playerIds[data.playerIndex] !== choice.playerId) {
      return `${label} Divine Judgment keep player is invalid.`;
    }
    return "";
  }
  if (!Number.isInteger(data.runeOrderPlayerIndex)
    || data.runeOrderPlayerIndex < 0
    || data.runeOrderPlayerIndex >= data.playerIds.length
    || data.playerIds[data.runeOrderPlayerIndex] !== choice.playerId) {
    return `${label} Divine Judgment Rune order player is invalid.`;
  }
  const orderIssue = renderStringListIssue(data.selectedRuneOrderIds, `${label} Divine Judgment selectedRuneOrderIds`);
  if (orderIssue) return orderIssue;
  if (!data.runeRecycleOrder || typeof data.runeRecycleOrder !== "object" || Array.isArray(data.runeRecycleOrder)) {
    return `${label} Divine Judgment runeRecycleOrder is invalid.`;
  }
  for (const [playerId, runeIds] of Object.entries(data.runeRecycleOrder)) {
    if (!playerIds.has(playerId)) return `${label} Divine Judgment runeRecycleOrder player is invalid.`;
    const issue = renderStringListIssue(runeIds, `${label} Divine Judgment runeRecycleOrder ${playerId}`);
    if (issue) return issue;
  }
  return "";
}

function renderChainStateIssue(state, label, playerIds) {
  if (state == null) return "";
  if (typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.chain)) return `${label} is invalid.`;
  for (const key of ["playerId", "priorityPlayerId", "turnPlayerId", "attackerId", "defenderId", "focusPlayerId"]) {
    if (state[key] != null && !playerIds.has(state[key])) return `${label} ${key} is invalid.`;
  }
  const continuationIssue = renderContinuationIssue(state.continuation, `${label} continuation`);
  if (continuationIssue) return continuationIssue;
  const itemIds = new Set();
  for (const [index, item] of state.chain.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return `${label} item ${index} is invalid.`;
    if (typeof item.id !== "string" || !item.id) return `${label} item ${index} id is invalid.`;
    if (itemIds.has(item.id)) return `${label} item ${index} duplicates an item id.`;
    itemIds.add(item.id);
    if (!playerIds.has(item.playerId)) return `${label} item ${index} player is invalid.`;
    if (!['card', 'activated', 'trigger'].includes(item.itemType)) return `${label} item ${index} type is invalid.`;
    if (!['pending', 'finalized'].includes(item.status)) return `${label} item ${index} status is invalid.`;
    const cardIssue = renderCardIssue(item.card, `${label} item ${index} card`);
    if (cardIssue) return cardIssue;
    const itemIssue = renderTargetCarrierIssue(item, `${label} item ${index}`);
    if (itemIssue) return itemIssue;
    const dataIssue = renderTargetCarrierIssue(item.data, `${label} item ${index} data`);
    if (dataIssue) return dataIssue;
    const optionsIssue = renderTargetCarrierIssue(item.playOptions, `${label} item ${index} playOptions`);
    if (optionsIssue) return optionsIssue;
    // Older saved/replay chain records did not persist the default destination.
    // It is optional for rendering, but any supplied value still has to be safe.
    if (item.itemType === "card" && item.destination != null
      && (typeof item.destination !== "string" || !item.destination)) {
      return `${label} item ${index} destination is invalid.`;
    }
    if (item.itemType === "trigger" && item.trigger == null) return `${label} item ${index} trigger is unavailable.`;
    if (item.trigger != null) {
      const triggerIssue = renderTriggerIssue(item.trigger, `${label} item ${index} trigger`, playerIds);
      if (triggerIssue) return triggerIssue;
      if (item.itemType === "trigger" && item.trigger.playerId !== item.playerId) return `${label} item ${index} trigger player is inconsistent.`;
    }
    if (item.itemType === "activated" && item.specs == null) return `${label} item ${index} specs are unavailable.`;
    if (item.specs != null) {
      const specsIssue = renderObjectListIssue(item.specs, `${label} item ${index} specs`);
      if (specsIssue) return specsIssue;
      for (const [specIndex, spec] of item.specs.entries()) {
        const nestedIssue = renderNestedRepeatableFieldsIssue(spec, `${label} item ${index} specs[${specIndex}]`);
        if (nestedIssue) return nestedIssue;
      }
    }
  }
  return "";
}

function renderChoiceOptionIssue(option, label, playerIds) {
  if (!option || typeof option !== "object" || Array.isArray(option)
    || typeof option.id !== "string" || !option.id) return `${label} is invalid.`;
  if (option.label != null && typeof option.label !== "string") return `${label} label is invalid.`;
  for (const key of ["cardId", "destinationId", "destination"]) {
    if (option[key] != null && (typeof option[key] !== "string" || !option[key])) return `${label} ${key} is invalid.`;
  }
  if (option.cardIds != null) {
    const idsIssue = renderStringListIssue(option.cardIds, `${label} cardIds`);
    if (idsIssue) return idsIssue;
  }
  if (option.playerId != null && !playerIds.has(option.playerId)) return `${label} player is invalid.`;
  if (option.disabled != null && typeof option.disabled !== "boolean") return `${label} disabled state is invalid.`;
  if (option.amount != null && (!Number.isFinite(option.amount) || option.amount < 0)) return `${label} amount is invalid.`;
  if (option.card != null) {
    const cardIssue = renderCardIssue(option.card, `${label} card`);
    if (cardIssue) return cardIssue;
  }
  return "";
}

function renderChoiceStateIssue(choice, label, playerIds, battlefieldIds, depth = 0) {
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return `${label} is invalid.`;
  if (depth > 2) return `${label} nesting is invalid.`;
  if (!Array.isArray(choice.options)) return `${label} options are unavailable.`;
  if (!playerIds.has(choice.playerId)) return `${label} player is invalid.`;
  if (typeof choice.effect !== "string" || !choice.effect) return `${label} effect is invalid.`;
  if (choice.id != null && (typeof choice.id !== "string" || !choice.id)) return `${label} id is invalid.`;
  if (choice.optional != null && typeof choice.optional !== "boolean") return `${label} optional state is invalid.`;
  const optionIds = new Set();
  for (const [index, option] of choice.options.entries()) {
    const optionIssue = renderChoiceOptionIssue(option, `${label} option ${index}`, playerIds);
    if (optionIssue) return optionIssue;
    if (optionIds.has(option.id)) return `${label} option ${index} duplicates an option id.`;
    optionIds.add(option.id);
  }
  if (choice.optional !== true && !choice.options.some((option) => !option.disabled)) return `${label} has no enabled option.`;
  const pseudoCardAllowed = ["stagedEvent", "triggerOrder"].includes(choice.effect);
  if (!choice.card || typeof choice.card !== "object" || Array.isArray(choice.card)
    || typeof choice.card.name !== "string" || !choice.card.name) return `${label} card is unavailable.`;
  if (!pseudoCardAllowed || choice.card.instanceId != null) {
    const cardIssue = renderCardIssue(choice.card, `${label} card`);
    if (cardIssue) return cardIssue;
  }
  const asyncIssue = renderPendingAsyncStateIssue(choice, label, playerIds);
  if (asyncIssue) return asyncIssue;
  return renderChoiceDataIssue(choice, label, playerIds, battlefieldIds, depth);
}

function renderChoiceDataIssue(choice, label, playerIds, battlefieldIds, depth = 0) {
  const data = choice.data;
  if (data != null && (typeof data !== "object" || Array.isArray(data))) return `${label} data is invalid.`;
  if (!data) {
    if (["triggerOrder", "combatDamage", "acknowledgeReveal", "payDeflect", "divineJudgmentKeep", "divineJudgmentRuneOrder"].includes(choice.effect)) return `${label} data is unavailable.`;
    return "";
  }
  const divineJudgmentIssue = renderDivineJudgmentDataIssue(choice, label, playerIds);
  if (divineJudgmentIssue) return divineJudgmentIssue;
  if (choice.effect === "combatDamage" && !Array.isArray(data.targetInfos)) return `${label} targetInfos are unavailable.`;
  if (choice.effect === "acknowledgeReveal" && !Array.isArray(data.revealedCards)) return `${label} revealedCards are unavailable.`;
  if (data.revealedCards != null) {
    const issue = renderCardListIssue(data.revealedCards, `${label} revealedCards`);
    if (issue) return issue;
  }
  for (const key of ["targetInfos", "allocations", "declaredTargets", "declaredChoices"]) {
    if (data[key] == null) continue;
    const issue = renderObjectListIssue(data[key], `${label} ${key}`);
    if (issue) return issue;
  }
  for (const key of ["remainingTriggers", "triggers", "selectedCards", "declarationSteps", "copySourceKeywords"]) {
    if (data[key] == null) continue;
    const issue = renderObjectListIssue(data[key], `${label} ${key}`);
    if (issue) return issue;
    for (const [index, item] of data[key].entries()) {
      const carrierIssue = renderTargetCarrierIssue(item, `${label} ${key}[${index}]`);
      if (carrierIssue) return carrierIssue;
      const nestedIssue = renderNestedRepeatableFieldsIssue(item, `${label} ${key}[${index}]`);
      if (nestedIssue) return nestedIssue;
    }
  }
  for (const key of ["remainingTriggers", "triggers"]) {
    for (const [index, trigger] of (data[key] || []).entries()) {
      const issue = renderTriggerIssue(trigger, `${label} ${key}[${index}]`, playerIds);
      if (issue) return issue;
    }
  }
  for (const key of [
    "selectedRuneIds", "targetIds", "chosenIds", "allowedIds", "selectedIds", "keptIds",
    "remainingPlayerIds", "selectedForCurrentStep", "deflectTargetIds", "movedIds",
    "selectedRuneOrderIds", "discardedIds", "recycleIds", "revealedIds", "orderedKeepIds",
    "recycledIds", "playerIds"
  ]) {
    if (data[key] == null) continue;
    const issue = renderStringListIssue(data[key], `${label} ${key}`);
    if (issue) return issue;
  }
  for (const playerId of [...(data.playerIds || []), ...(data.remainingPlayerIds || [])]) {
    if (!playerIds.has(playerId)) return `${label} player list is invalid.`;
  }
  if (data.deflectPowerCost != null) {
    const issue = renderPowerCostIssue(data.deflectPowerCost, `${label} deflectPowerCost`);
    if (issue) return issue;
  }
  const state = data.triggerOrderState;
  if (state != null || choice.effect === "triggerOrder") {
    if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.groups)) return `${label} triggerOrderState is invalid.`;
    const stateContinuationIssue = renderContinuationIssue(state.continuation, `${label} triggerOrderState continuation`);
    if (stateContinuationIssue) return stateContinuationIssue;
    if (!Number.isInteger(state.groupIndex) || state.groupIndex < 0 || state.groupIndex >= state.groups.length) return `${label} triggerOrderState groupIndex is invalid.`;
    for (const [index, group] of state.groups.entries()) {
      if (!group || typeof group !== "object" || Array.isArray(group)) return `${label} trigger group ${index} is invalid.`;
      for (const key of ["triggers", "orderedTriggers"]) {
        const issue = renderObjectListIssue(group[key], `${label} trigger group ${index} ${key}`);
        if (issue) return issue;
        for (const [triggerIndex, trigger] of group[key].entries()) {
          const triggerIssue = renderTriggerIssue(trigger, `${label} trigger group ${index} ${key}[${triggerIndex}]`, playerIds);
          if (triggerIssue) return triggerIssue;
        }
      }
      if (!playerIds.has(group.playerId)) return `${label} trigger group ${index} player is invalid.`;
    }
  }
  if (choice.effect === "combatDamage") {
    if (!battlefieldIds.has(data.battlefieldId)) return `${label} battlefield is invalid.`;
    for (const key of ["attackerId", "defenderId", "assigningPlayerId", "targetPlayerId"]) {
      if (!playerIds.has(data[key])) return `${label} ${key} is invalid.`;
    }
    if (!["attacker", "defender"].includes(data.role)) return `${label} combat role is invalid.`;
    for (const key of ["attackerTotal", "defenderTotal"]) {
      if (!Number.isFinite(data[key]) || data[key] < 0) return `${label} ${key} is invalid.`;
    }
    if (!Number.isFinite(data.remaining) || data.remaining <= 0) return `${label} remaining damage is invalid.`;
    const assignmentsIssue = renderObjectListIssue(data.assignments, `${label} assignments`);
    if (assignmentsIssue) return assignmentsIssue;
    for (const [index, assignment] of data.assignments.entries()) {
      if (typeof assignment.targetId !== "string" || !assignment.targetId
        || !Number.isFinite(assignment.amount) || assignment.amount <= 0
        || !playerIds.has(assignment.assigningPlayerId)
        || !["attacker", "defender"].includes(assignment.role)) return `${label} assignments[${index}] is invalid.`;
    }
    for (const [index, info] of (data.targetInfos || []).entries()) {
      if (typeof info.cardId !== "string" || !info.cardId) return `${label} targetInfos[${index}] cardId is invalid.`;
    }
  }
  if (choice.effect === "payDeflect") {
    if (typeof data.targetId !== "string" || !data.targetId) return `${label} Deflect target is invalid.`;
    if (!Number.isFinite(data.amount) || data.amount <= 0) return `${label} Deflect amount is invalid.`;
    const selectedIssue = renderStringListIssue(data.selectedRuneIds, `${label} selectedRuneIds`);
    if (selectedIssue) return selectedIssue;
    const originalChoiceIssue = renderChoiceStateIssue(
      data.originalChoice,
      `${label} original choice`,
      playerIds,
      battlefieldIds,
      depth + 1
    );
    if (originalChoiceIssue) return originalChoiceIssue;
    const originalOptionIssue = renderChoiceOptionIssue(data.originalOption, `${label} original option`, playerIds);
    if (originalOptionIssue) return originalOptionIssue;
  }
  const continuationIssue = renderContinuationIssue(data.continuation, `${label} continuation`);
  if (continuationIssue) return continuationIssue;
  return "";
}

function renderPaymentIssue(payment, playerIds) {
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) return "Payment state is invalid.";
  if (!playerIds.has(payment.playerId)) return "Payment player is invalid.";
  for (const key of ["cardId", "cardName", "source"]) {
    if (typeof payment[key] !== "string" || !payment[key]) return `Payment ${key} is invalid.`;
  }
  if (payment.destination != null && (typeof payment.destination !== "string" || !payment.destination)) return "Payment destination is invalid.";
  const asyncIssue = renderPendingAsyncStateIssue(payment, "Payment", playerIds);
  if (asyncIssue) return asyncIssue;
  for (const key of ["energyCost", "xpCost", "recycleTrashCost", "discardCost"]) {
    if (payment[key] != null && (!Number.isFinite(payment[key]) || payment[key] < 0)) return `Payment ${key} is invalid.`;
  }
  const requiredLists = [
    "basePowerCost", "powerCost", "energyRuneIds", "powerRuneIds", "poolEnergyIds", "poolPowerIds",
    "optionalPowerEffects", "declaredTargets", "declaredChoices", "deflectTargetIds"
  ];
  for (const key of requiredLists) {
    if (!Array.isArray(payment[key])) return `Payment ${key} is unavailable.`;
  }
  for (const key of ["declaredTargetIdentities", "recycleTrashCardIds", "discardCardIds"]) {
    if (payment[key] != null && !Array.isArray(payment[key])) return `Payment ${key} is invalid.`;
  }
  for (const key of ["energyRuneIds", "powerRuneIds", "poolEnergyIds", "poolPowerIds", "deflectTargetIds", "recycleTrashCardIds", "discardCardIds"]) {
    if (payment[key] == null) continue;
    const issue = renderStringListIssue(payment[key], `Payment ${key}`);
    if (issue) return issue;
  }
  const carrierIssue = renderTargetCarrierIssue(payment, "Payment");
  if (carrierIssue) return carrierIssue;
  const basePowerIssue = renderPowerCostIssue(payment.basePowerCost, "Payment basePowerCost");
  if (basePowerIssue) return basePowerIssue;
  const powerIssue = renderPowerCostIssue(payment.powerCost, "Payment powerCost");
  if (powerIssue) return powerIssue;
  for (const [index, effect] of payment.optionalPowerEffects.entries()) {
    if (!effect || typeof effect !== "object" || Array.isArray(effect) || typeof effect.id !== "string" || !effect.id) return `Payment optionalPowerEffects[${index}] is invalid.`;
    const requirementsIssue = renderPowerCostIssue(effect.requirements || [], `Payment optionalPowerEffects[${index}] requirements`);
    if (requirementsIssue) return requirementsIssue;
    const nestedIssue = renderNestedRepeatableFieldsIssue(effect, `Payment optionalPowerEffects[${index}]`);
    if (nestedIssue) return nestedIssue;
  }
  if (payment.costContext != null) {
    const context = payment.costContext;
    if (typeof context !== "object" || Array.isArray(context)) return "Payment costContext is invalid.";
    const additionalPowerIssue = renderPowerCostIssue(context.additionalPower || [], "Payment costContext additionalPower");
    if (additionalPowerIssue) return additionalPowerIssue;
    if (context.replacementPowerCost != null) {
      const replacementIssue = renderPowerCostIssue(context.replacementPowerCost, "Payment costContext replacementPowerCost");
      if (replacementIssue) return replacementIssue;
    }
    if (context.replacementEnergyCost != null
      && (!Number.isFinite(context.replacementEnergyCost) || context.replacementEnergyCost < 0)) return "Payment costContext replacementEnergyCost is invalid.";
    const contextCarrierIssue = renderTargetCarrierIssue(context, "Payment costContext");
    if (contextCarrierIssue) return contextCarrierIssue;
  }
  if (payment.playProcess != null) {
    const process = payment.playProcess;
    if (!process || typeof process !== "object" || Array.isArray(process)
      || typeof process.chainItemId !== "string" || !process.chainItemId) return "Payment playProcess is invalid.";
    const cardIssue = renderCardIssue(process.card, "Payment playProcess card");
    if (cardIssue) return cardIssue;
  }
  if (payment.source === "activatedAbility" || payment.activatedAbility != null) {
    const state = payment.activatedAbility;
    if (!state || typeof state !== "object" || Array.isArray(state)) return "Payment activatedAbility is invalid.";
    const sourceIssue = renderCardIssue(state.sourceCard, "Payment activatedAbility sourceCard");
    if (sourceIssue) return sourceIssue;
    const specsIssue = renderObjectListIssue(state.specs, "Payment activatedAbility specs");
    if (specsIssue) return specsIssue;
    for (const [index, spec] of state.specs.entries()) {
      const nestedIssue = renderNestedRepeatableFieldsIssue(spec, `Payment activatedAbility specs[${index}]`);
      if (nestedIssue) return nestedIssue;
    }
  }
  if (payment.source === "triggeredAbility" || payment.triggeredAbility != null) {
    const state = payment.triggeredAbility;
    if (!state || typeof state !== "object" || Array.isArray(state)) return "Payment triggeredAbility is invalid.";
    const sourceIssue = renderCardIssue(state.sourceCard, "Payment triggeredAbility sourceCard");
    if (sourceIssue) return sourceIssue;
    const triggerIssue = renderTriggerIssue(state.trigger, "Payment triggeredAbility trigger", playerIds);
    if (triggerIssue) return triggerIssue;
    if (!Array.isArray(state.triggers)) return "Payment triggeredAbility triggers are invalid.";
    for (const [index, trigger] of state.triggers.entries()) {
      const issue = renderTriggerIssue(trigger, `Payment triggeredAbility triggers[${index}]`, playerIds);
      if (issue) return issue;
    }
    if (!state.descriptor || typeof state.descriptor !== "object" || Array.isArray(state.descriptor)) return "Payment triggeredAbility descriptor is invalid.";
    const descriptorIssue = renderNestedRepeatableFieldsIssue(state.descriptor, "Payment triggeredAbility descriptor");
    if (descriptorIssue) return descriptorIssue;
    if (!["queue", "showdownChain", "actionChain"].includes(state.mode)) return "Payment triggeredAbility mode is invalid.";
    const continuationIssue = renderContinuationIssue(state.continuation, "Payment triggeredAbility continuation");
    if (continuationIssue) return continuationIssue;
  }
  if (payment.source === "effectEnergy" || payment.effectPayment != null) {
    const state = payment.effectPayment;
    if (!state || typeof state !== "object" || Array.isArray(state)
      || !["playUnitTokenOptionalReady", "repeatSpell", "showdownPredictDrawSpell", "counterUnlessPayDecision"].includes(state.kind)) {
      return "Payment effectPayment is invalid.";
    }
    const sourceIssue = renderCardIssue(state.sourceCard, "Payment effectPayment sourceCard");
    if (sourceIssue) return sourceIssue;
    if (state.sourcePlayerId != null && !playerIds.has(state.sourcePlayerId)) return "Payment effectPayment source player is invalid.";
    if (state.kind === "repeatSpell") {
      if (!state.repeatSpec || typeof state.repeatSpec !== "object" || Array.isArray(state.repeatSpec)
        || typeof state.repeatSpec.kind !== "string" || !state.repeatSpec.kind) {
        return "Payment repeatSpell repeatSpec is invalid.";
      }
      const repeatSpecIssue = renderNestedRepeatableFieldsIssue(state.repeatSpec, "Payment repeatSpell repeatSpec");
      if (repeatSpecIssue) return repeatSpecIssue;
    }
  }
  if (payment.source === "effectPlay" || payment.effectPlay != null) {
    const state = payment.effectPlay;
    if (!state || typeof state !== "object" || Array.isArray(state)
      || typeof state.chainItemId !== "string" || !state.chainItemId) return "Payment effectPlay is invalid.";
    const cardIssue = renderCardIssue(state.card, "Payment effectPlay card");
    if (cardIssue) return cardIssue;
  }
  if (payment.source === "weaponmaster" || payment.weaponmaster != null) {
    const state = payment.weaponmaster;
    if (!state || typeof state !== "object" || Array.isArray(state)
      || typeof state.gearId !== "string" || !state.gearId) return "Payment weaponmaster is invalid.";
  }
  return "";
}

function gameUiRenderIssue(candidate) {
  if (!candidate || typeof candidate !== "object") return "Game state is missing.";
  if (!Array.isArray(candidate.players) || candidate.players.length !== 2) return "Exactly two player seats are required.";
  if (!Array.isArray(candidate.battlefields)) return "Battlefield state is unavailable.";
  for (const key of [
    "operations", "lifecycleEvents", "ruleTaskTrace", "cleanupRequestTrace", "attachmentEvents",
    "empowerEvents", "damageEvents", "discardEvents", "exhaustEvents", "readyEvents", "banishEvents",
    "revealEvents", "combatResultEvents", "killEvents", "healEvents", "moveEvents", "channelEvents",
    "burnEvents", "drawEvents", "delayedAbilities", "damageKillFollowups",
    "cleanupPendingTriggerBatches", "postCombatDamageTriggerBatches"
  ]) {
    if (candidate[key] != null && !Array.isArray(candidate[key])) return `${key} is invalid.`;
  }
  if (candidate.log != null && (!Array.isArray(candidate.log) || candidate.log.some((entry) => typeof entry !== "string"))) return "Game history is invalid.";
  if (candidate.revealedIntel != null && !Array.isArray(candidate.revealedIntel)) return "Revealed intel is invalid.";
  if (candidate.scoreEvents != null && !Array.isArray(candidate.scoreEvents)) return "Score events are invalid.";
  if (candidate.effectFlash != null) {
    if (typeof candidate.effectFlash !== "object" || Array.isArray(candidate.effectFlash)) return "Effect flash is invalid.";
    if (candidate.effectFlash.sourceId != null
      && (typeof candidate.effectFlash.sourceId !== "string" || !candidate.effectFlash.sourceId)) return "Effect flash source is invalid.";
    if (candidate.effectFlash.message != null && typeof candidate.effectFlash.message !== "string") return "Effect flash message is invalid.";
    if (candidate.effectFlash.stamp != null && !Number.isFinite(candidate.effectFlash.stamp)) return "Effect flash stamp is invalid.";
    if (candidate.effectFlash.targetIds != null) {
      const issue = renderStringListIssue(candidate.effectFlash.targetIds, "Effect flash targets");
      if (issue) return issue;
    }
  }
  const requiredPlayerLists = ["mainDeck", "runeDeck", "hand", "base", "runes", "trash", "availableChampions", "availableBattlefields"];
  const authoritativeCardIds = new Set();
  for (const player of candidate.players) {
    if (!player || typeof player !== "object" || Array.isArray(player) || typeof player.id !== "string" || !player.id) return "A player seat is invalid.";
    for (const key of requiredPlayerLists) {
      const issue = renderCardListIssue(player[key], `${player.id} ${key}`);
      if (issue) return issue;
      for (const [index, card] of player[key].entries()) {
        const idIssue = collectAuthoritativeCardIds(card, `${player.id} ${key}[${index}]`, authoritativeCardIds);
        if (idIssue) return idIssue;
      }
    }
    for (const key of ["banished"]) {
      if (player[key] == null) continue;
      const issue = renderCardListIssue(player[key], `${player.id} ${key}`);
      if (issue) return issue;
      for (const [index, card] of player[key].entries()) {
        const idIssue = collectAuthoritativeCardIds(card, `${player.id} ${key}[${index}]`, authoritativeCardIds);
        if (idIssue) return idIssue;
      }
    }
    if (player.runePool != null) {
      if (typeof player.runePool !== "object" || Array.isArray(player.runePool)) return `${player.id} Rune pool is invalid.`;
      const energy = player.runePool.energy;
      if (energy != null && !Array.isArray(energy)
        && !(Number.isInteger(energy) && energy >= 0 && energy <= 1000)) return `${player.id} Rune pool energy is invalid.`;
      if (Array.isArray(energy)) {
        const energyIds = new Set();
        for (const [index, resource] of energy.entries()) {
          if (!resource || typeof resource !== "object" || Array.isArray(resource) || typeof resource.id !== "string" || !resource.id) return `${player.id} Rune pool energy[${index}] is invalid.`;
          if (energyIds.has(resource.id)) return `${player.id} Rune pool energy[${index}] duplicates a resource id.`;
          energyIds.add(resource.id);
          if (resource.domains != null) {
            const issue = renderStringListIssue(resource.domains, `${player.id} Rune pool energy[${index}] domains`);
            if (issue) return issue;
          }
        }
      }
      if (player.runePool.power != null && !Array.isArray(player.runePool.power)) return `${player.id} Rune pool power is invalid.`;
      if (Array.isArray(player.runePool.power)) {
        const powerIds = new Set();
        for (const [index, resource] of player.runePool.power.entries()) {
          if (typeof resource === "string" && resource) continue;
          if (!resource || typeof resource !== "object" || Array.isArray(resource)
            || typeof resource.id !== "string" || !resource.id
            || typeof resource.domain !== "string" || !resource.domain) return `${player.id} Rune pool power[${index}] is invalid.`;
          if (resource.instanceId != null && (typeof resource.instanceId !== "string" || !resource.instanceId)) return `${player.id} Rune pool power[${index}] instanceId is invalid.`;
          if (powerIds.has(resource.id)) return `${player.id} Rune pool power[${index}] duplicates a resource id.`;
          powerIds.add(resource.id);
        }
      }
    }
    for (const [key, card] of [["legend", player.legend], ["champion", player.champion]]) {
      if (!card) continue;
      const issue = renderCardIssue(card, `${player.id} ${key}`);
      if (issue) return issue;
      if (key === "legend" || card.zone === "champion") {
        const idIssue = collectAuthoritativeCardIds(card, `${player.id} ${key}`, authoritativeCardIds);
        if (idIssue) return idIssue;
      }
    }
  }
  const playerIds = new Set(candidate.players.map((player) => player.id));
  if (playerIds.size !== candidate.players.length) return "Player seat identifiers must be unique.";
  if (!playerIds.has("p1") || !playerIds.has("p2")) return "Player seats must be p1 and p2.";
  for (const [index, intel] of (candidate.revealedIntel || []).entries()) {
    if (!intel || typeof intel !== "object" || Array.isArray(intel)
      || !playerIds.has(intel.viewerId) || !playerIds.has(intel.ownerId)
      || !Number.isInteger(intel.expiresAtTurnSequence) || intel.expiresAtTurnSequence < 0
      || (intel.sourceCardId != null && (typeof intel.sourceCardId !== "string" || !intel.sourceCardId))
      || (intel.sourceName != null && typeof intel.sourceName !== "string")) return `Revealed intel ${index} is invalid.`;
  }
  if (!Array.isArray(candidate.turnOrder)
    || candidate.turnOrder.length !== candidate.players.length
    || new Set(candidate.turnOrder).size !== candidate.players.length
    || candidate.turnOrder.some((playerId) => !playerIds.has(playerId))) {
    return "Turn order is invalid.";
  }
  if (!playerIds.has(candidate.currentPlayerId)) return "Current player is invalid.";
  for (const key of ["firstPlayerId", "turnPlayerId", "surrenderedPlayerId", "authoritativeActorId"]) {
    if (candidate[key] != null && !playerIds.has(candidate[key])) return `${key} is invalid.`;
  }
  if (candidate.phase === "complete" && !playerIds.has(candidate.winnerId)) return "Winner is invalid.";
  if (candidate.aiDeclinedIntents != null) {
    const declined = candidate.aiDeclinedIntents;
    if (!declined || typeof declined !== "object" || Array.isArray(declined)
      || !Number.isInteger(declined.turnSequence)
      || !Array.isArray(declined.keys)
      || declined.keys.some((key) => typeof key !== "string" || !key)) {
      return "AI declined intents are invalid.";
    }
  }
  if (["mulligan", "action", "showdown"].includes(candidate.phase)
    && !candidate.tutorial
    && candidate.battlefields.length < 2) {
    return "At least two active battlefields are required.";
  }
  const battlefieldIds = new Set();
  for (const field of candidate.battlefields) {
    const fieldIssue = renderCardIssue(field, "Battlefield");
    if (fieldIssue) return fieldIssue;
    const fieldIdIssue = collectAuthoritativeCardIds(field, `Battlefield ${field.instanceId}`, authoritativeCardIds);
    if (fieldIdIssue) return fieldIdIssue;
    if (battlefieldIds.has(field.instanceId)) return "Battlefield identifiers must be unique.";
    battlefieldIds.add(field.instanceId);
    if (field.controlledBy != null && !playerIds.has(field.controlledBy)) return `${field.instanceId} controller is invalid.`;
    const unitIssue = renderCardListIssue(field.units, `${field.instanceId} units`);
    if (unitIssue) return unitIssue;
    for (const [index, unit] of field.units.entries()) {
      const idIssue = collectAuthoritativeCardIds(unit, `${field.instanceId} units[${index}]`, authoritativeCardIds);
      if (idIssue) return idIssue;
    }
    if (field.units.some((unit) => !playerIds.has(unit.controllerId))) return `${field.instanceId} has a unit with an invalid controller.`;
    if (!Array.isArray(field.hidden)) return `${field.instanceId} hidden zone is invalid.`;
    for (const [index, item] of (field.hidden || []).entries()) {
      if (!item || typeof item !== "object") return `${field.instanceId} hidden[${index}] is invalid.`;
      const issue = renderCardIssue(item.card, `${field.instanceId} hidden[${index}]`);
      if (issue) return issue;
      const idIssue = collectAuthoritativeCardIds(item.card, `${field.instanceId} hidden[${index}]`, authoritativeCardIds);
      if (idIssue) return idIssue;
      if (!playerIds.has(hiddenCardControllerId(item))) return `${field.instanceId} hidden[${index}] has an invalid controller.`;
    }
  }
  if (candidate.stagedEvents != null && !Array.isArray(candidate.stagedEvents)) return "Staged events are invalid.";
  for (const [index, event] of (candidate.stagedEvents || []).entries()) {
    if (!event || typeof event !== "object" || Array.isArray(event)
      || typeof event.id !== "string" || !event.id
      || typeof event.type !== "string" || !event.type
      || !battlefieldIds.has(event.battlefieldId)
      || !playerIds.has(event.attackerId)
      || (event.defenderId != null && !playerIds.has(event.defenderId))) {
      return `Staged event ${index} is invalid.`;
    }
  }
  if (candidate.actionChain && candidate.showdown) return "Action and showdown chains cannot coexist.";
  if (candidate.actionChain && !["action", "complete"].includes(candidate.phase)) return "Action chain phase is invalid.";
  if (candidate.showdown && !["showdown", "complete"].includes(candidate.phase)) return "Showdown phase is invalid.";
  if (candidate.phase === "showdown" && !candidate.showdown) return "Showdown state is unavailable.";
  const actionChainIssue = renderChainStateIssue(candidate.actionChain, "Action chain", playerIds);
  if (actionChainIssue) return actionChainIssue;
  if (candidate.actionChain) {
    if (!playerIds.has(candidate.actionChain.priorityPlayerId) || !playerIds.has(candidate.actionChain.turnPlayerId)) return "Action chain players are invalid.";
    if (!Array.isArray(candidate.actionChain.playerIds)
      || candidate.actionChain.playerIds.length !== candidate.players.length
      || new Set(candidate.actionChain.playerIds).size !== candidate.players.length
      || candidate.actionChain.playerIds.some((playerId) => !playerIds.has(playerId))) {
      return "Action chain seats are invalid.";
    }
  }
  const showdownIssue = renderChainStateIssue(candidate.showdown, "Showdown chain", playerIds);
  if (showdownIssue) return showdownIssue;
  if (candidate.showdown) {
    if (!battlefieldIds.has(candidate.showdown.battlefieldId)) return "Showdown battlefield is invalid.";
    for (const key of ["attackerId", "defenderId", "priorityPlayerId", "focusPlayerId", "turnPlayerId"]) {
      if (!playerIds.has(candidate.showdown[key])) return `Showdown ${key} is invalid.`;
    }
  }
  if (candidate.triggerQueue != null) {
    if (!Array.isArray(candidate.triggerQueue)) return "Trigger queue is invalid.";
    for (const [index, trigger] of candidate.triggerQueue.entries()) {
      const issue = renderTriggerIssue(trigger, `Trigger queue[${index}]`, playerIds);
      if (issue) return issue;
    }
  }
  const queueContinuationIssue = renderContinuationIssue(candidate.triggerQueueContinuation, "Trigger queue continuation");
  if (queueContinuationIssue) return queueContinuationIssue;
  if (candidate.deferredTriggerContinuations != null) {
    if (!Array.isArray(candidate.deferredTriggerContinuations)) return "Deferred trigger continuations are invalid.";
    for (const [index, continuation] of candidate.deferredTriggerContinuations.entries()) {
      const issue = renderContinuationIssue(continuation, `Deferred trigger continuations[${index}]`);
      if (issue) return issue;
    }
  }
  if (candidate.phase === "first-player") {
    const decision = candidate.firstPlayerDecision;
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) return "Play-order decision is invalid.";
    if (!["roll", "designated", "preset"].includes(decision.method)) return "Play-order method is invalid.";
    if (decision.method === "roll") {
      if (!decision.rolls || typeof decision.rolls !== "object" || Array.isArray(decision.rolls)
        || [...playerIds].some((playerId) => !Object.prototype.hasOwnProperty.call(decision.rolls, playerId))) {
        return "Play-order rolls are invalid.";
      }
      for (const playerId of playerIds) {
        const roll = decision.rolls[playerId];
        if (roll != null && (!Number.isInteger(roll) || roll < 1 || roll > 6)) return "A play-order roll is invalid.";
      }
      if (decision.status === "rolling" && !playerIds.has(decision.rollerId)) return "Play-order roller is invalid.";
      if (decision.status === "choosing" && (!playerIds.has(decision.chooserId) || !playerIds.has(decision.winnerId))) return "Play-order chooser is invalid.";
      if (!["rolling", "choosing"].includes(decision.status)) return "Play-order status is invalid.";
    } else if (decision.method === "designated") {
      if (decision.status !== "choosing"
        || !playerIds.has(decision.chooserId)
        || decision.winnerId !== decision.chooserId
        || candidate.firstPlayerId != null) return "Designated play-order chooser is invalid.";
    } else if (decision.status !== "ready" || !playerIds.has(candidate.firstPlayerId)) {
      return "Preset first player is invalid.";
    }
    if (candidate.players.some((player) => !player.legend)) return "First-player legends are unavailable.";
    if (candidate.officialMatchSetup) {
      if (candidate.players.some((player) => !player.champion)) return "First-player champions are unavailable.";
      if (candidate.battlefields.length < 2) return "First-player Battlefields are unavailable.";
      if (candidate.players.some((player) => player.hand.length !== 0)) return "Opening hands were drawn before play order was chosen.";
    }
  }
  if (candidate.phase === "champion-select") {
    if (!playerIds.has(candidate.championSelectPlayerId)) return "Champion selector is invalid.";
    if (candidate.players.some((player) => !player.legend)) return "Champion-select legends are unavailable.";
    if (candidate.players.some((player) => !Array.isArray(player.availableChampions))) return "Champion choices are unavailable.";
  }
  if (candidate.phase === "battlefield-select") {
    if (!playerIds.has(candidate.setupPlayerId)) return "Battlefield selector is invalid.";
    if (candidate.players.some((player) => !player.legend || !player.champion)) return "Battlefield-select identities are unavailable.";
    if (candidate.players.some((player) => !Array.isArray(player.availableBattlefields))) return "Battlefield choices are unavailable.";
  }
  if (candidate.phase === "mulligan") {
    if (!candidate.mulligan || !playerIds.has(candidate.mulligan.playerId)) return "Mulligan player is invalid.";
    if (candidate.mulligan.selectedCardIds != null && !Array.isArray(candidate.mulligan.selectedCardIds)) return "Mulligan selection is invalid.";
  }
  if (candidate.pendingPayment != null && candidate.pendingChoice != null) return "Choice and payment states cannot coexist.";
  if (candidate.pendingPayment != null) {
    const currentPaymentIssue = renderPaymentIssue(candidate.pendingPayment, playerIds);
    const resumeLegality = candidate.pendingPayment
      && typeof candidate.pendingPayment === "object"
      && !Array.isArray(candidate.pendingPayment)
      ? paymentResumeLegality(candidate, candidate.pendingPayment)
      : { ok: true };
    const paymentIssue = currentPaymentIssue || (resumeLegality.ok ? "" : resumeLegality.message);
    const canRenderRecoveryPayment = candidate.pendingPayment
      && typeof candidate.pendingPayment === "object"
      && !Array.isArray(candidate.pendingPayment)
      && (!playerIds.has(candidate.pendingPayment.playerId)
        || (!currentPaymentIssue && !resumeLegality.ok));
    if (paymentIssue && !canRenderRecoveryPayment) return paymentIssue;
  }
  if (candidate.pendingChoice != null) {
    const choiceIssue = renderChoiceStateIssue(candidate.pendingChoice, "Choice", playerIds, battlefieldIds);
    if (choiceIssue) return choiceIssue;
  }
  return "";
}

function unavailableGameView(issue) {
  const korean = locale() === LOCALES.KO;
  if (issue && issue !== lastDiagnosticRenderIssue) {
    lastDiagnosticRenderIssue = issue;
    try {
      gameDiagnostic?.recordUiError(
        new Error(issue),
        diagnosticUiContext("game state validation"),
        game
      );
      discardPendingDiagnosticStateCheckpoint();
      persistGameDiagnostic({ immediate: true });
    } catch {}
  }
  return `
    <main class="layout tabletop-layout phase-unavailable">
      <section class="tabletop-state-unavailable" role="status" aria-live="polite">
        <span>${korean ? "게임 상태 동기화" : "Game state sync"}</span>
        <h1>${korean ? "화면에 필요한 상태를 기다리고 있습니다" : "Waiting for a complete game state"}</h1>
        <p>${escapeHtml(issue)}</p>
        <div class="actions inline">
          ${replayMode
            ? `<button data-action="replay-exit">${korean ? "리플레이 목록" : "Replay list"}</button>`
            : `
              <button class="danger" data-action="stop-after-ui-error">${korean ? "오류로 경기 중단" : "Stop game after error"}</button>
              <button data-action="return-menu-after-ui-error">${korean ? "경기 중단 후 메인 메뉴" : "Stop game, then return to menu"}</button>
            `}
        </div>
      </section>
    </main>
  `;
}

function renderApp() {
  uiLegalActions = [];
  indexUiLegalActions(uiLegalActions);
  const scrollState = captureScrollState();
  if (appView === "menu") {
    replaceAppMarkup(menuView());
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "tutorials") {
    replaceAppMarkup(tutorialMenuView());
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "decks") {
    replaceAppMarkup(deckEditorView());
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "multiplayer") {
    replaceAppMarkup(multiplayerView());
    restoreScrollState(scrollState);
    ensureRoomRefresh();
    return;
  }
  if (appView === "replays") {
    replaceAppMarkup(replayBrowserView());
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "game" && matchIsBetweenGames()) {
    replaceAppMarkup(sideboardingView());
    restoreScrollState(scrollState);
    return;
  }
  if (appView === "analysis") {
    replaceAppMarkup(coachAnalysisView());
    restoreScrollState(scrollState);
    return;
  }
  const renderIssue = currentGameUiRenderIssue();
  if (renderIssue) {
    replaceAppMarkup(unavailableGameView(renderIssue));
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
    clearViewerTransientPresentation();
    game.selectedCardId = null;
    onlineSelectedCardId = null;
    handOpen = false;
    attachmentsOpenCardId = null;
    inspectorPreviewCard = null;
    inspectedChainItemId = null;
    inspectedChainTargetIds.clear();
    moveSelection.clear();
  }
  lastViewerPlayerId = nextViewerPlayerId;
  sanitizeViewerUiState();
  const pendingChoiceVisible = !replayMode && decisionVisibleToViewer(game.pendingChoice, nextViewerPlayerId);
  syncStagedChoiceUi(pendingChoiceVisible ? game.pendingChoice : null);
  const blockingDecisionVisible = !replayMode && (
    decisionVisibleToViewer(game.pendingPayment, nextViewerPlayerId)
    || pendingChoiceVisible
  );
  const chainDecisionVisible = Boolean(
    pendingChoiceVisible && pendingChoiceSharesChainSurface(game.pendingChoice)
  );
  // Standalone choices own the interaction surface. A choice that belongs to
  // the live Chain must still allow its source/target card to remain readable.
  if (pendingChoiceVisible && !chainDecisionVisible) closeTabletopSheets("inspector");
  const player = viewerPlayer();
  if (viewerCanAct()) uiLegalActions = legalActionsForCurrentUi(nextViewerPlayerId);
  indexUiLegalActions(uiLegalActions);
  pruneMoveSelection();
  uiMotion = prepareUiMotionForCurrentState();
  if (uiMotion.feedback) rememberRealtimeFeedback(uiMotion.feedback);
  if (uiMotion.transfers.some((transfer) => !["exhaust", "ready"].includes(transfer?.kind))) {
    currentRenderPreviousGeometry = captureTabletopGeometry();
  }
  const presentationUpdate = updateGamePresentationForCurrentState();
  const interaction = interactionStatus();
  const utilitySheetOpen = Boolean(graveyardOpenPlayerId || banishedOpenPlayerId || intelOpenPlayerId || logOpen);
  const inspectorCard = inspectedCard();
  const inspectorVisible = Boolean(
    inspectorOpen
    && inspectorCard
    && (!pendingChoiceVisible || chainDecisionVisible)
    && !utilitySheetOpen
  );
  window.__riftboundGame = game;
  window.__riftboundRender = () => {
    markGameStateChanged();
    render();
  };
  replaceAppMarkup(`
    <header class="topbar tabletop-topbar">
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
          : `${game.phase !== "complete"
            ? `<button class="secondary danger" data-action="surrender" title="${t("surrender", locale())}">${t("surrender", locale())}</button>`
            : `<button class="secondary" data-action="exit-completed-game">${completedGameExitLabel()}</button>`}
             <button class="secondary" data-action="new-game" title="${t("newGame", locale())}">${t("newGame", locale())}</button>`}
      </div>
    </header>
    <main class="layout tabletop-layout phase-${game.phase} ${isTutorialGame() ? "tutorial-active" : ""} ${inspectorVisible ? "inspector-open" : ""} ${decisionVisibleToViewer(game.pendingPayment, nextViewerPlayerId) ? "payment-active" : ""} ${activeImpact ? `impact-active impact-${activeImpact.kind}` : ""} ${staticImpactPreview ? "preview-impact" : ""}">
      ${game.phase === "first-player" ? firstPlayerPanel() : game.phase === "champion-select" ? championSelectPanel() : game.phase === "battlefield-select" ? setupPanel() : game.phase === "mulligan" ? mulliganPanel() : gamePanel(player)}
      <div class="tabletop-overlay-root">
        ${["first-player", "champion-select", "battlefield-select", "mulligan"].includes(game.phase) ? "" : gameFloatingPanels()}
        ${tutorialPanel()}
        ${cinematicImpactOverlay()}
        ${inspectorVisible && !["first-player", "champion-select", "mulligan"].includes(game.phase) ? inspector(inspectorCard) : ""}
        ${pendingGameExit ? gameExitConfirmModal() : ""}
        ${isTutorialGame() ? "" : gameResultModal()}
        ${fullCardOpen ? fullCardModal(fullCardPreviewCard || inspectorCard) : ""}
        ${!blockingDecisionVisible && logOpen ? logDrawer() : ""}
        ${replayMode ? replayPlaybackControls() : ""}
      </div>
    </main>
  `);
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
  const step = localizeTutorialStep(tutorialStep(game, tutorialUiState()), game.tutorial.id, locale());
  if (!step) return "";
  const progress = tutorialProgress(step);
  const lesson = TUTORIAL_CATALOG.find((entry) => entry.id === game.tutorial.id);
  const complete = step.id === "complete";
  const welcome = step.id === "welcome";
  const location = tutorialStepLocation(step.id);
  const modalAttributes = welcome || complete
    ? `role="dialog" aria-modal="true" data-ui-modal data-modal-key="tutorial-${escapeHtml(step.id)}" tabindex="-1"`
    : `role="status" aria-live="polite"`;
  return `
    <aside class="tutorial-panel tutorial-step-${step.id}" ${modalAttributes} data-tutorial-step="${escapeHtml(step.id)}" aria-labelledby="tutorial-step-title">
      <div class="tutorial-panel-head">
        <span>${escapeHtml(locale() === LOCALES.KO ? (lesson?.title || "초보자 튜토리얼") : (lesson?.englishTitle || "Beginner Tutorial"))}</span>
        <b>${progress.current}/${progress.total}</b>
      </div>
      <div class="tutorial-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${progress.total}" aria-valuenow="${progress.current}">
        <i style="width:${progress.percent}%"></i>
      </div>
      <div class="tutorial-step-location"><span>${locale() === LOCALES.KO ? "찾을 위치" : "Find it"}</span><strong>${escapeHtml(location)}</strong></div>
      <h2 id="tutorial-step-title">${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.body)}</p>
      <small id="tutorial-step-hint">${escapeHtml(step.hint)}</small>
      ${welcome ? `<button class="primary tutorial-panel-action" data-action="tutorial-next" data-primary-focus>${escapeHtml(step.actionLabel)}</button>` : ""}
      ${complete ? `
        <div class="tutorial-complete-actions">
          <button class="secondary" data-action="tutorial-restart">${locale() === LOCALES.KO ? "다시 연습" : "Replay"}</button>
          <button class="primary" data-action="tutorial-exit" data-primary-focus>${locale() === LOCALES.KO ? "튜토리얼 목록" : "Tutorial List"}</button>
        </div>
      ` : ""}
    </aside>
  `;
}

function tutorialUiState() {
  return { handOpen, stagedChoiceId: stagedChoiceOptionId || null };
}

function tutorialStepLocation(stepId) {
  const korean = locale() === LOCALES.KO;
  const locations = korean
    ? {
        welcome: "안내 패널",
        "open-hand": "화면 아래 손패",
        "play-unit": "손패 위 명령 바",
        "play-spell": "손패 위 명령 바",
        "play-power-unit": "손패 위 명령 바",
        "select-runes": "내 룬 영역",
        "select-power-energy": "내 룬 영역",
        "select-domain-power": "내 룬 영역",
        "confirm-payment": "비용 지불 바",
        "select-mover": "내 기지",
        "select-attacker": "내 기지",
        "move-unit": "손패 위 명령 바",
        "move-attacker": "손패 위 명령 바",
        "pass-showdown": "손패 위 결전 명령 바",
        "choose-spell-target": "중앙 보드",
        "confirm-spell-target": "대상 선택 바",
        "assign-combat-damage": "전투 피해 배정 화면",
        "end-turn": "오른쪽 세로 보조 메뉴",
        complete: "완료 안내"
      }
    : {
        welcome: "Guide panel",
        "open-hand": "Hand at the bottom",
        "play-unit": "Command bar above the hand",
        "play-spell": "Command bar above the hand",
        "play-power-unit": "Command bar above the hand",
        "select-runes": "Your Rune row",
        "select-power-energy": "Your Rune row",
        "select-domain-power": "Your Rune row",
        "confirm-payment": "Payment bar",
        "select-mover": "Your Base",
        "select-attacker": "Your Base",
        "move-unit": "Command bar above the hand",
        "move-attacker": "Command bar above the hand",
        "pass-showdown": "Showdown command bar",
        "choose-spell-target": "Center board",
        "confirm-spell-target": "Target confirmation bar",
        "assign-combat-damage": "Combat damage drawer",
        "end-turn": "Right utility rail",
        complete: "Lesson complete"
      };
  return locations[stepId] || (korean ? "게임 화면" : "Game board");
}

function tutorialChoiceInteraction(cardId, ui) {
  if (!cardId || !game.pendingChoice || !["hand", "board"].includes(choiceCardSurface(game.pendingChoice))) return null;
  const option = choiceOptionsForCard(cardId).find((candidate) =>
    !candidate.disabled && tutorialActionAllowed(game, "choose-effect", {
      choice: String(candidate.id || ""),
      card: choiceOptionCardId(candidate)
    }, ui)
  );
  return option
    ? { allowed: true, action: "choose-effect", data: { choice: String(option.id || ""), card: choiceOptionCardId(option) } }
    : { allowed: false, action: "choose-effect", data: { choice: "", card: cardId } };
}

function tutorialNodeInteraction(node, ui) {
  const domAction = node.dataset.action || node.dataset.zoneAction || "";
  const data = { ...node.dataset };

  if (domAction === "confirm-staged-choice") {
    const selected = stagedChoiceOption();
    const choice = String(selected?.id || "");
    const choiceData = { choice, card: selected ? choiceOptionCardId(selected) : "" };
    return {
      allowed: Boolean(selected) && tutorialActionAllowed(game, "choose-effect", choiceData, ui),
      action: "choose-effect",
      data: choiceData,
      domAction
    };
  }

  if (["stage-choice-card", "stage-choice-option"].includes(domAction)) {
    const option = domAction === "stage-choice-option"
      ? validChoiceOptions(game.pendingChoice).find((candidate) => candidate.id === data.choice)
      : data.choice
        ? validChoiceOptions(game.pendingChoice).find((candidate) => candidate.id === data.choice)
        : choiceOptionsForCard(data.cardId).find((candidate) => !candidate.disabled);
    const choiceData = { choice: String(option?.id || ""), card: option ? choiceOptionCardId(option) : data.cardId };
    return {
      allowed: Boolean(option && !option.disabled) && tutorialActionAllowed(game, "choose-effect", choiceData, ui),
      action: "choose-effect",
      data: choiceData,
      domAction
    };
  }

  if (domAction === "pay-rune") {
    const modes = [...new Set([
      data.mode,
      data.paymentEnergy === "true" ? "energy" : "",
      data.paymentPower === "true" ? "power" : ""
    ].filter(Boolean))];
    const mode = modes.find((candidate) => tutorialActionAllowed(game, "pay-rune", { ...data, mode: candidate }, ui));
    return { allowed: Boolean(mode), action: "pay-rune", data: { ...data, mode: mode || data.mode }, domAction };
  }

  if (domAction) {
    return {
      allowed: tutorialActionAllowed(game, domAction, data, ui),
      action: domAction,
      data,
      domAction
    };
  }

  const cardId = String(node.dataset.cardId || "");
  const choiceInteraction = tutorialChoiceInteraction(cardId, ui);
  if (choiceInteraction) return { ...choiceInteraction, domAction: "stage-choice-card" };
  return {
    allowed: tutorialActionAllowed(game, "select-card", { card: cardId }, ui),
    action: "select-card",
    data: { card: cardId },
    domAction: "select-card"
  };
}

function tutorialNodeIsPrimary(step, interaction) {
  if (!interaction?.allowed) return false;
  if (step.id === "confirm-payment") return interaction.domAction === "confirm-payment";
  if (step.id === "confirm-spell-target") return interaction.domAction === "confirm-staged-choice";
  return true;
}

function applyTutorialTargets() {
  if (!isTutorialGame()) return;
  const ui = tutorialUiState();
  const step = tutorialStep(game, ui);
  if (!step) return;
  const selector = "[data-action], [data-zone-action], [data-card-id][role='button']";
  for (const node of app.querySelectorAll(selector)) {
    const action = node.dataset.action || node.dataset.zoneAction;
    if (node.closest(".tutorial-panel") || action === "tutorial-exit") continue;
    const interaction = tutorialNodeInteraction(node, ui);
    const allowed = Boolean(interaction?.allowed);
    const primary = tutorialNodeIsPrimary(step, interaction);
    node.classList.toggle("tutorial-target", primary);
    node.classList.toggle("tutorial-allowed", allowed && !primary);
    node.classList.toggle("tutorial-locked", !allowed);
    if (!allowed) {
      node.setAttribute("aria-disabled", "true");
      if (node instanceof HTMLButtonElement) node.disabled = true;
      else if (node.matches("[role='button']")) node.tabIndex = -1;
    } else if (!node.matches(":disabled")) {
      node.removeAttribute("aria-disabled");
    }
    if (primary) {
      const describedBy = new Set(String(node.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add("tutorial-step-hint");
      node.setAttribute("aria-describedby", [...describedBy].join(" "));
    }
  }
}

function tutorialAllowsUiAction(action, data = {}) {
  return !isTutorialGame() || tutorialActionAllowed(game, action, data, tutorialUiState());
}

function createBugReportUiState(recovered = false) {
  return {
    choice: "prompt",
    description: "",
    status: "idle",
    error: "",
    reportId: "",
    submittedAt: "",
    recovered,
    followUpAfterUiError: false,
    previousDecisions: []
  };
}

function bugReportDecisionResolved() {
  return !gameDiagnostic || ["submitted", "declined"].includes(bugReportUi.choice);
}

function pendingRecoveredBugReport() {
  return Boolean(gameDiagnostic && bugReportUi.recovered && !bugReportDecisionResolved());
}

function diagnosticNavigationBlocked() {
  return onlineDiagnosticRecoveryInProgress
    || pendingRecoveredBugReport()
    || Boolean(currentDiagnosticSnapshot()?.finalization && !bugReportDecisionResolved());
}

function guardedOnlineSurrenderCommand(command, identity) {
  const expectedDiagnosticGameId = String(identity?.diagnosticGameId || "");
  const expectedGameNumber = Number(identity?.gameNumber);
  if (identity?.diagnosticIdentityCaptured !== true
    || !expectedDiagnosticGameId
    || !Number.isSafeInteger(expectedGameNumber)
    || expectedGameNumber < 1) return null;
  return {
    ...command,
    expectedDiagnosticGameId,
    expectedGameNumber
  };
}

function failRestoredOnlineDiagnosticRecovery(details = {}) {
  if (!onlineDiagnosticRecoveryInProgress) return false;
  const recorder = gameDiagnostic;
  const snapshot = currentDiagnosticSnapshot();
  try {
    if (recorder && !snapshot?.finalization) {
      recorder.recordEvent("online-diagnostic-recovery-failed", {
        recoveredAfterAppRestart: true,
        ...details
      });
      recorder.finalize(GAME_REPRODUCTION_END_REASONS.UI_ERROR, undefined, {
        recoveredAfterAppRestart: true,
        stopRequestAccepted: false,
        serverStopConfirmed: false,
        ...details
      });
    }
  } catch {}
  restoredGameDiagnosticCanResume = false;
  onlineDiagnosticRecoveryInProgress = false;
  bugReportUi = createBugReportUiState(true);
  pendingOnlineDiagnosticStart = null;
  persistGameDiagnostic({ immediate: true });
  appView = "menu";
  return true;
}

function abandonRestoredOnlineDiagnosticRecovery() {
  if (!onlineDiagnosticRecoveryInProgress) return;
  failRestoredOnlineDiagnosticRecovery({
    recoveryFailure: "connection-unavailable",
    recoveryAbandonedByUser: true
  });
  invalidateOnlineSession();
  closeOnlineEvents();
  bugReportUi.recovered = true;
  appView = "menu";
  render();
}

function restoreSavedGameDiagnostic() {
  try {
    const restored = restoreGameReproductionLogFromStorage(
      window.localStorage,
      GAME_DIAGNOSTIC_STORAGE_KEY,
      { maxFrames: 20 }
    );
    if (!restored) return null;
    const snapshot = restored.snapshot();
    const reloadMarker = consumeGameDiagnosticReloadMarker();
    restoredGameDiagnosticCanResume = Boolean(
      !snapshot.finalization
      && reloadMarker
      && reloadMarker.logId === snapshot.logId
      && Date.now() - reloadMarker.at < 60_000
    );
    if (!snapshot.finalization && !restoredGameDiagnosticCanResume) {
      restored.finalize(GAME_REPRODUCTION_END_REASONS.UI_ERROR, undefined, {
        recoveredAfterAppRestart: true
      });
    }
    return restored;
  } catch {
    try { window.localStorage.removeItem(GAME_DIAGNOSTIC_STORAGE_KEY); } catch {}
    return null;
  }
}

function consumeGameDiagnosticReloadMarker() {
  try {
    const marker = JSON.parse(window.sessionStorage.getItem(GAME_DIAGNOSTIC_RELOAD_KEY) || "null");
    window.sessionStorage.removeItem(GAME_DIAGNOSTIC_RELOAD_KEY);
    return marker && typeof marker === "object"
      ? { logId: String(marker.logId || ""), at: Number(marker.at) || 0 }
      : null;
  } catch {
    return null;
  }
}

function markResumableOnlineReload() {
  if (onlineDiagnosticRecoveryInProgress
    || emergencyReportActive
    || ["stopping", "failed"].includes(emergencyStopState)) {
    clearGameDiagnosticReloadMarker();
    return;
  }
  if (!gameDiagnostic || !isOnlineGame()) return;
  try {
    const snapshot = gameDiagnostic.summary?.() || gameDiagnostic.snapshot();
    if (snapshot.finalization) {
      clearGameDiagnosticReloadMarker();
      return;
    }
    window.sessionStorage.setItem(GAME_DIAGNOSTIC_RELOAD_KEY, JSON.stringify({
      logId: snapshot.logId,
      at: Date.now()
    }));
  } catch {}
}

function clearGameDiagnosticReloadMarker() {
  try { window.sessionStorage.removeItem(GAME_DIAGNOSTIC_RELOAD_KEY); } catch {}
}

function beginGameDiagnostic(mode, metadata = {}) {
  pendingPostReportAction = null;
  restoredGameDiagnosticCanResume = false;
  onlineDiagnosticRecoveryInProgress = false;
  try {
    gameDiagnostic = createGameReproductionLog(game, {
      maxEvents: 800,
      maxFrames: 20,
      metadata: {
        mode,
        locale: locale(),
        build: clientBuildInfo,
        playerId: isOnlineGame() ? online.playerId : viewerPlayerId(),
        viewport: diagnosticViewport(),
        ...(mode==='ai'?{modelGeneration:neuralAiCheckpointMetadata?.generation ?? activeCoachModel()?.generation ?? null}:{}),
        ...metadata
      }
    });
    bugReportUi = createBugReportUiState(false);
    emergencyReportActive = false;
    emergencyReportContext = null;
    emergencyStopState = "idle";
    emergencyStopError = "";
    emergencyStopOwner = null;
    emergencyStopOperation = null;
    recoveredOnlineStopRequested = false;
    lastDiagnosticRenderIssue = "";
    diagnosticCommandAttemptSequence = 0;
    persistGameDiagnostic({ immediate: true });
  } catch (error) {
    console?.error?.("Game diagnostics could not be started.", error);
    gameDiagnostic = null;
  }
}

function cancelScheduledDiagnosticPersistence() {
  if (diagnosticPersistenceTimer) window.clearTimeout(diagnosticPersistenceTimer);
  diagnosticPersistenceTimer = null;
  if (diagnosticPersistenceIdleCallback != null
    && diagnosticPersistenceIdleCallback !== DIAGNOSTIC_BOUNDARY_ONLY
    && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(diagnosticPersistenceIdleCallback);
  }
  diagnosticPersistenceIdleCallback = null;
}

function scheduleDiagnosticStateCheckpoint(state, label = "command") {
  if (!gameDiagnostic || gameDiagnostic.isFinalized?.() || !state || typeof state !== "object") return false;
  // Keep only the newest state reference. Online snapshots replace `game`, while
  // local commands mutate the same object; in both cases the idle flush captures
  // the newest recoverable boundary without sanitizing every intermediate state.
  pendingDiagnosticStateCheckpoint = {
    recorder: gameDiagnostic,
    state,
    label
  };
  return true;
}

function discardPendingDiagnosticStateCheckpoint(recorder = gameDiagnostic) {
  if (!pendingDiagnosticStateCheckpoint
    || (recorder && pendingDiagnosticStateCheckpoint.recorder !== recorder)) return false;
  pendingDiagnosticStateCheckpoint = null;
  return true;
}

function flushPendingDiagnosticStateCheckpoint() {
  const pending = pendingDiagnosticStateCheckpoint;
  if (!pending) return true;
  if (pending.recorder !== gameDiagnostic || pending.recorder.isFinalized?.()) {
    pendingDiagnosticStateCheckpoint = null;
    return true;
  }
  try {
    // Persistence serializes the recorder immediately afterwards, so cloning
    // the full sanitized checkpoint as an unused return value only adds work.
    pending.recorder.checkpoint(pending.state, pending.label, { cloneResult: false });
    if (pendingDiagnosticStateCheckpoint === pending) pendingDiagnosticStateCheckpoint = null;
    return true;
  } catch {
    return false;
  }
}

function flushGameDiagnosticPersistence() {
  cancelScheduledDiagnosticPersistence();
  if (!gameDiagnostic) {
    pendingDiagnosticStateCheckpoint = null;
    return false;
  }
  if (["submitted", "declined"].includes(bugReportUi.choice)) {
    forgetPersistedGameDiagnostic();
    return true;
  }
  if (!diagnosticPersistenceDirty) return true;
  if (!flushPendingDiagnosticStateCheckpoint()) return false;
  try {
    saveGameReproductionLogToStorage(window.localStorage, GAME_DIAGNOSTIC_STORAGE_KEY, gameDiagnostic);
    diagnosticPersistenceDirty = false;
    return true;
  } catch {
    // Keep a smaller recovery copy when a long game exceeds localStorage.
    try {
      const compact = gameDiagnostic.snapshot();
      const frameCount = (compact.frames || []).length;
      compact.frames = (compact.frames || []).slice(-3);
      compact.droppedFrames = Number(compact.droppedFrames || 0)
        + Math.max(0, frameCount - compact.frames.length);
      window.localStorage.setItem(GAME_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(compact));
      diagnosticPersistenceDirty = false;
      return true;
    } catch {
      return false;
    }
  }
}

function persistGameDiagnostic({ immediate = false } = {}) {
  if (!gameDiagnostic) return false;
  if (["submitted", "declined"].includes(bugReportUi.choice)) {
    forgetPersistedGameDiagnostic();
    return true;
  }
  diagnosticPersistenceDirty = true;
  if (immediate) return flushGameDiagnosticPersistence();
  if (diagnosticPersistenceTimer || diagnosticPersistenceIdleCallback != null) return true;
  if (typeof window.requestIdleCallback !== "function") {
    // There is no safe routine main-thread slot on older WebViews/Safari.
    // Keep the newest checkpoint pending until final/error/hidden/pagehide,
    // all of which already perform an exact synchronous boundary flush.
    diagnosticPersistenceIdleCallback = DIAGNOSTIC_BOUNDARY_ONLY;
    return true;
  }
  diagnosticPersistenceTimer = window.setTimeout(() => {
    diagnosticPersistenceTimer = null;
    diagnosticPersistenceIdleCallback = window.requestIdleCallback(() => {
      diagnosticPersistenceIdleCallback = null;
      flushGameDiagnosticPersistence();
    });
  }, 180);
  return true;
}

function forgetPersistedGameDiagnostic() {
  cancelScheduledDiagnosticPersistence();
  diagnosticPersistenceDirty = false;
  discardPendingDiagnosticStateCheckpoint();
  try { window.localStorage.removeItem(GAME_DIAGNOSTIC_STORAGE_KEY); } catch {}
}

function retireTutorialDiagnosticForTransition() {
  const snapshot = currentDiagnosticSnapshot();
  const finalReason = snapshot?.finalization?.reason || null;
  if (snapshot?.metadata?.mode !== "tutorial"
    || (finalReason && finalReason !== GAME_REPRODUCTION_END_REASONS.NORMAL)) return false;
  clearGameDiagnosticReloadMarker();
  forgetPersistedGameDiagnostic();
  gameDiagnostic = null;
  bugReportUi = createBugReportUiState(false);
  return true;
}

function diagnosticViewport() {
  return {
    width: Number(window.innerWidth) || 0,
    height: Number(window.innerHeight) || 0,
    devicePixelRatio: Number(window.devicePixelRatio) || 1,
    orientation: window.screen?.orientation?.type || "",
    userAgent: navigator.userAgent || "",
    platform: navigator.userAgentData?.platform || navigator.platform || ""
  };
}

function diagnosticUiContext(context = "UI") {
  let modal = "";
  try { modal = topUiModalKey() || ""; } catch {}
  return {
    context,
    appView,
    phase: game?.phase || "",
    modal,
    handOpen,
    logOpen,
    inspectorOpen,
    pendingGameExit,
    selectedCardId: game?.selectedCardId || onlineSelectedCardId || null,
    viewport: diagnosticViewport()
  };
}

function recordDiagnosticCommand(command, outcome = {}) {
  if (!gameDiagnostic) return false;
  try {
    const diagnosticOutcome = { ...outcome };
    delete diagnosticOutcome.state;
    const requestedFinalization = diagnosticOutcome.finalization;
    delete diagnosticOutcome.finalization;
    const recordsFinalState = game?.phase === "complete" && diagnosticOutcome.status !== "rejected";
    gameDiagnostic.recordCommand(command, {
      ...diagnosticOutcome,
      ...(recordsFinalState ? { state: game } : {})
    });
    if (recordsFinalState) discardPendingDiagnosticStateCheckpoint();
    if (ensureGameDiagnosticFinalized(
      requestedFinalization?.reason || null,
      requestedFinalization?.details || {},
      { stateAlreadyRecorded: recordsFinalState }
    )) return true;
    if (diagnosticOutcome.status !== "rejected") scheduleDiagnosticStateCheckpoint(game, "command");
    persistGameDiagnostic();
  } catch {}
  return false;
}

function recordDiagnosticCommandAttempt(command, context = {}) {
  if (!gameDiagnostic) return "";
  const attemptId = `${Date.now()}-${++diagnosticCommandAttemptSequence}`;
  try {
    gameDiagnostic.recordEvent("command-attempt", {
      attemptId,
      command,
      context,
      ...(['togglePaymentPoolPower','togglePaymentPoolEnergy'].includes(command?.kind)
        ? {resourceIdentity:recordablePaymentCommand(game,context.actorId||activePlayerId(),command).resourceIdentity}:{}),
      ...(game.pendingChoice?.effect==='triggerOrder' && command?.kind==='chooseEffectOption'
        ? {choiceOption:((option)=>option?{cardId:option.cardId,effectKind:option.effectKind}:null)
          (game.pendingChoice.options?.find(option=>option.id===command.optionId))}: {})
    });
    persistGameDiagnostic();
    return attemptId;
  } catch {
    return "";
  }
}

function recordDiagnosticUiBreadcrumb(target, eventType = "click") {
  if (!gameDiagnostic || appView !== "game") return;
  try {
    const control = target?.closest?.("[data-action], [data-zone-action], [data-card-id]");
    const safeDataset = {};
    const allowedKeys = [
      "action", "zoneAction", "cardId", "card", "unit", "destination", "player",
      "battlefield", "rune", "mode", "choice", "ability", "chainItemId", "target"
    ];
    for (const key of allowedKeys) {
      if (control?.dataset?.[key] != null) safeDataset[key] = String(control.dataset[key]).slice(0, 180);
    }
    gameDiagnostic.recordUiBreadcrumb({
      eventType,
      tag: control?.tagName || target?.tagName || "",
      dataset: safeDataset,
      view: appView,
      phase: game?.phase || "",
      modal: topUiModalKey() || ""
    });
    persistGameDiagnostic();
  } catch {}
}

function recordDiagnosticOnlineSnapshot(snapshot, { deferFinalization = false } = {}) {
  if (!gameDiagnostic) return false;
  try {
    const recordsFinalState = game?.phase === "complete";
    gameDiagnostic.markOnlineSnapshot({
      revision: onlineSnapshotRevision,
      roomId: snapshot?.room?.roomId || online.roomId,
      gameNumber: snapshot?.match?.gameNumber || 1,
      diagnosticGameId: snapshot?.room?.diagnosticGameId || null,
      roomStatus: snapshot?.room?.status || ""
    }, ...(recordsFinalState ? [game] : []));
    if (recordsFinalState) discardPendingDiagnosticStateCheckpoint();
    if (recordsFinalState && deferFinalization) return true;
    if (ensureGameDiagnosticFinalized(null, {}, { stateAlreadyRecorded: recordsFinalState })) {
      return recordsFinalState;
    }
    scheduleDiagnosticStateCheckpoint(game, "online-snapshot");
    persistGameDiagnostic();
    return recordsFinalState;
  } catch {
    return false;
  }
}

function ensureGameDiagnosticFinalized(reason = null, details = {}, { stateAlreadyRecorded = false } = {}) {
  if (!gameDiagnostic || game?.phase !== "complete") return false;
  const alreadyFinalized = typeof gameDiagnostic.isFinalized === "function"
    ? gameDiagnostic.isFinalized()
    : Boolean(gameDiagnostic.summary?.().finalization);
  if (alreadyFinalized) return false;
  const endReason = reason || (game.surrenderedPlayerId
    ? GAME_REPRODUCTION_END_REASONS.SURRENDER
    : GAME_REPRODUCTION_END_REASONS.NORMAL);
  gameDiagnostic.finalize(endReason, stateAlreadyRecorded ? undefined : game, {
    winnerId: game.winnerId || null,
    surrenderedPlayerId: game.surrenderedPlayerId || null,
    ...details
  });
  discardPendingDiagnosticStateCheckpoint();
  persistGameDiagnostic({ immediate: true });
  return true;
}

function reproductionRandomSeeds() {
  const values = new Uint32Array(3);
  try {
    globalThis.crypto.getRandomValues(values);
  } catch {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 0x100000000) >>> 0;
    }
  }
  const seed = (index) => values[index] || index + 1;
  return {
    randomSeed: seed(0),
    playerRandomSeeds: { p1: seed(1), p2: seed(2) }
  };
}

function reportUiException(error, context = "UI") {
  if (reportingUiException) return;
  reportingUiException = true;
  try {
    const message = errorMessage(error);
    const stackLine = firstStackLine(error);
    const entry = `[UI Exception] ${context}: ${message}${stackLine ? ` (${stackLine})` : ""}`;
    if (game?.log) game.log = [entry, ...game.log].slice(0, 18);
    if (gameDiagnostic) {
      try {
        gameDiagnostic.recordUiError(error, diagnosticUiContext(context), game);
        discardPendingDiagnosticStateCheckpoint();
        persistGameDiagnostic({ immediate: true });
      } catch {}
    }
    if (console?.error) console.error(entry, error);
  } finally {
    reportingUiException = false;
  }
}

function errorMessage(error) {
  const fallback = locale() === LOCALES.KO ? "알 수 없는 오류" : "Unknown error";
  let value = fallback;
  try {
    value = error instanceof Error ? (error.message || error.name || fallback) : (error ?? fallback);
  } catch {}
  return boundedUiErrorText(value, 4096, fallback);
}

function firstStackLine(error) {
  try {
    if (!(error instanceof Error) || !error.stack) return "";
    const line = String(error.stack)
      .split("\n", 12)
      .map((entry) => entry.trim())
      .find((entry) => entry && !entry.startsWith(error.name) && !entry.includes("reportUiException")) || "";
    return boundedUiErrorText(line, 1024, "");
  } catch {
    return "";
  }
}

function boundedUiErrorText(value, maxLength, fallback = "") {
  let text = fallback;
  try { text = String(value ?? fallback); } catch {}
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…[truncated]`;
}

function showUiExceptionOverlay(error, context = "UI") {
  try {
    const existing = app.querySelector(".ui-exception-banner");
    if (existing) existing.remove();
    const banner = document.createElement("div");
    banner.className = "ui-exception-banner";
    banner.setAttribute("role", "alert");
    banner.innerHTML = `
      <strong>${locale() === LOCALES.KO ? "화면 처리 오류" : "UI Exception"}</strong>
      <span>${escapeHtml(locale() === LOCALES.KO ? localizedUiExceptionContext(context) : context)}: ${escapeHtml(localizedDynamicText(errorMessage(error)))}</span>
      ${appView === "game" && !replayMode ? `
        <div class="ui-exception-actions">
          <button type="button" class="secondary" data-ui-exception-continue>${locale() === LOCALES.KO ? "계속 시도" : "Keep trying"}</button>
          <button type="button" class="danger" data-ui-exception-stop>${locale() === LOCALES.KO ? "오류로 경기 중단" : "Stop game after error"}</button>
        </div>
      ` : ""}
    `;
    banner.querySelector("[data-ui-exception-continue]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      banner.remove();
    });
    banner.querySelector("[data-ui-exception-stop]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void stopGameAfterUiError(error, context);
    });
    app.appendChild(banner);
  } catch (overlayError) {
    window.__riftboundEarlyCrashGuard?.show(overlayError, true);
  }
}

async function stopGameAfterUiError(error, context = "UI") {
  if (emergencyStopState === "stopping"
    && emergencyStopOperationIsCurrent(emergencyStopOperation)) {
    return emergencyStopOperation.promise;
  }
  const reopenedResolvedReport = reopenResolvedBugReportAfterUiError();
  const firstAttempt = !emergencyReportActive || reopenedResolvedReport;
  if (!gameDiagnostic) beginGameDiagnostic(isOnlineGame() ? "online" : aiMode ? "ai" : "local", {
    recoveredFromUiError: true
  });
  emergencyReportActive = true;
  clearGameDiagnosticReloadMarker();
  emergencyReportContext = { error, context };
  emergencyStopError = "";
  if (firstAttempt) reportUiException(error, context);
  let stopResult = { ok: false, message: "The game was stopped only on this device." };
  let diagnosticFinalizedByCommand = false;
  if (isOnlineGame()) {
    const owner = emergencyStopState === "failed" && emergencyStopOwnerIsCurrent(emergencyStopOwner)
      ? emergencyStopOwner
      : {
          generation: onlineSessionGeneration,
          roomId: online.roomId,
          playerToken: online.playerToken,
          playerId: online.playerId,
          diagnosticRecorder: gameDiagnostic,
          ...captureOnlineDiagnosticIdentity({
            roomId: online.roomId,
            diagnosticKey: onlineDiagnosticGameKey,
            metadata: currentDiagnosticSnapshot()?.metadata
          }),
          context
        };
    emergencyStopOwner = owner;
    const operation = {
      id: ++emergencyStopOperationSequence,
      ...owner,
      owner,
      command: guardedOnlineSurrenderCommand(
        { kind: "surrender", source: "ui-error-stop" },
        owner
      ),
      promise: null
    };
    emergencyStopOperation = operation;
    emergencyStopState = "stopping";
    showEmergencyReportView();
    const attemptId = recordDiagnosticCommandAttempt(
      operation.command || { kind: "surrender", source: "ui-error-stop" },
      { actorId: operation.playerId, online: true, uiErrorStop: true, stopOperationId: operation.id }
    );
    operation.promise = completeEmergencyOnlineStop(operation, attemptId);
    return operation.promise;
  } else {
    let playerId = "p1";
    try { playerId = viewerPlayerId() || playerId; } catch {}
    const attemptId = recordDiagnosticCommandAttempt(
      { kind: "surrender", source: "ui-error-stop" },
      { actorId: playerId, uiErrorStop: true }
    );
    try {
      stopResult = surrender(game, playerId);
      if (stopResult?.ok !== false) markGameStateChanged();
      diagnosticFinalizedByCommand = recordDiagnosticCommand({ kind: "surrender", source: "ui-error-stop" }, {
        status: stopResult?.ok === false ? "rejected" : "success",
        result: stopResult,
        reason: stopResult?.message,
        context: { actorId: playerId, uiErrorStop: true, attemptId },
        finalization: {
          reason: GAME_REPRODUCTION_END_REASONS.UI_ERROR,
          details: {
            context,
            stopRequestAccepted: stopResult?.ok === true,
            serverStopConfirmed: null
          }
        }
      });
      recordLocalGameIfComplete();
      if (game.phase === "complete") completeAiReplay();
    } catch (stopError) {
      diagnosticFinalizedByCommand = recordDiagnosticCommand({ kind: "surrender", source: "ui-error-stop" }, {
        status: "exception",
        error: stopError,
        context: { actorId: playerId, uiErrorStop: true, attemptId },
        finalization: {
          reason: GAME_REPRODUCTION_END_REASONS.UI_ERROR,
          details: {
            context,
            stopRequestAccepted: false,
            serverStopConfirmed: null
          }
        }
      });
    }
    emergencyStopState = "stopped";
  }
  if (!diagnosticFinalizedByCommand) {
    try {
      gameDiagnostic?.finalize(GAME_REPRODUCTION_END_REASONS.UI_ERROR, game, {
        context,
        stopRequestAccepted: stopResult?.ok === true,
        serverStopConfirmed: null
      });
    } catch {}
    persistGameDiagnostic({ immediate: true });
  }
  pendingGameExit = null;
  resultRevealReady = true;
  resultDismissed = false;
  showEmergencyReportView();
}

async function completeEmergencyOnlineStop(operation, attemptId) {
  let stopResult = { ok: false, message: "The server did not confirm the surrender." };
  let finalStateRecorded = false;
  try {
    if (!operation.command) {
      throw new Error("The current online game identity is unavailable; no surrender was sent.");
    }
    const response = await diagnosticStopRequest(
      sendOnlineCommand(operation.roomId, operation.playerToken, operation.command)
    );
    if (!emergencyStopOperationIsCurrent(operation)) return;
    if (response?.ok !== true) throw new Error(response?.message || stopResult.message);
    stopResult = response;
    try {
      operation.diagnosticRecorder?.recordCommand(operation.command, {
        status: "success",
        state: game,
        result: response,
        context: {
          actorId: operation.playerId,
          online: true,
          uiErrorStop: true,
          attemptId,
          stopOperationId: operation.id
        }
      });
      finalStateRecorded = true;
      operation.diagnosticRecorder?.recordEvent("online-ui-error-stop", {
        ok: true,
        serverConfirmed: true,
        stopOperationId: operation.id
      });
    } catch {}
    emergencyStopState = "stopped";
    closeOnlineEvents();
  } catch (stopError) {
    if (!emergencyStopOperationIsCurrent(operation)) return;
    emergencyStopState = "failed";
    emergencyStopError = errorMessage(stopError);
    try {
      operation.diagnosticRecorder?.recordEvent("online-ui-error-stop", {
        ok: false,
        serverConfirmed: false,
        stopOperationId: operation.id,
        error: { name: stopError?.name, message: stopError?.message, stack: stopError?.stack }
      }, game);
    } catch {}
    persistGameDiagnostic({ immediate: true });
    showEmergencyReportView();
    if (emergencyStopOperation === operation) emergencyStopOperation = null;
    return;
  }
  if (!emergencyStopOperationIsCurrent(operation)) return;
  try {
    operation.diagnosticRecorder?.finalize(
      GAME_REPRODUCTION_END_REASONS.UI_ERROR,
      finalStateRecorded ? undefined : game,
      {
        context: emergencyReportContext?.context || "UI",
        stopRequestAccepted: stopResult?.ok === true,
        serverStopConfirmed: stopResult?.ok === true,
        stopOperationId: operation.id
      }
    );
  } catch {}
  persistGameDiagnostic({ immediate: true });
  pendingGameExit = null;
  resultRevealReady = true;
  resultDismissed = false;
  showEmergencyReportView();
  if (emergencyStopOperation === operation) emergencyStopOperation = null;
  if (emergencyStopOwner === operation.owner) emergencyStopOwner = null;
}

function emergencyStopOperationIsCurrent(operation) {
  return Boolean(operation)
    && emergencyStopOperation === operation
    && emergencyStopOwnerIsCurrent(operation.owner)
    && operation.generation === operation.owner.generation
    && operation.roomId === operation.owner.roomId
    && operation.playerToken === operation.owner.playerToken
    && operation.diagnosticRecorder === operation.owner.diagnosticRecorder;
}

function emergencyStopOwnerIsCurrent(owner) {
  return Boolean(owner)
    && emergencyStopOwner === owner
    && onlineCommandSessionIsCurrent(owner)
    && gameDiagnostic === owner.diagnosticRecorder;
}

function reopenResolvedBugReportAfterUiError() {
  if (!gameDiagnostic || !["submitted", "declined"].includes(bugReportUi.choice)) return false;
  const previousLog = currentDiagnosticSnapshot();
  const previousDecision = {
    choice: bugReportUi.choice,
    reportId: bugReportUi.reportId || "",
    submittedAt: bugReportUi.submittedAt || "",
    endReason: previousLog?.finalization?.reason || ""
  };
  const previousDecisions = [
    ...(Array.isArray(bugReportUi.previousDecisions) ? bugReportUi.previousDecisions : []),
    previousDecision
  ];
  try {
    gameDiagnostic.recordEvent("bug-report-follow-up-after-ui-error", {
      previousChoice: previousDecision.choice,
      previousReportId: previousDecision.reportId || null,
      previousSubmittedAt: previousDecision.submittedAt || null,
      previousEndReason: previousDecision.endReason || null
    }, game);
  } catch {}
  bugReportUi = createBugReportUiState(false);
  bugReportUi.followUpAfterUiError = true;
  bugReportUi.previousDecisions = previousDecisions;
  return true;
}

function retryOnlineStopAfterUiError() {
  if (!emergencyReportContext
    || emergencyStopState !== "failed"
    || !emergencyStopOwnerIsCurrent(emergencyStopOwner)) return;
  void stopGameAfterUiError(emergencyReportContext.error, emergencyReportContext.context);
}

function confirmEmergencyOnlineStopFromSnapshot(owner, descriptor, stateAlreadyRecorded) {
  if (!emergencyStopOwnerIsCurrent(owner)
    || !onlineDiagnosticIdentityMatchesDescriptor(owner, descriptor)) return false;
  if (!emergencyReportActive
    || !isOnlineGame()
    || game?.phase !== "complete"
    || !["stopping", "failed", "stopped"].includes(emergencyStopState)) return false;
  emergencyStopState = "stopped";
  emergencyStopError = "";
  try {
    owner.diagnosticRecorder?.recordEvent("online-ui-error-stop-confirmed-by-snapshot", {
      serverConfirmed: true,
      winnerId: game.winnerId || null,
      surrenderedPlayerId: game.surrenderedPlayerId || null
    });
  } catch {}
  const finalized = ensureGameDiagnosticFinalized(
    GAME_REPRODUCTION_END_REASONS.UI_ERROR,
    {
      context: owner.context || emergencyReportContext?.context || "UI",
      stopRequestAccepted: game.surrenderedPlayerId ? true : null,
      serverStopConfirmed: true,
      confirmedByAuthoritativeSnapshot: true
    },
    { stateAlreadyRecorded }
  );
  if (!finalized) persistGameDiagnostic({ immediate: true });
  closeOnlineEvents();
  pendingGameExit = null;
  resultRevealReady = true;
  resultDismissed = false;
  showEmergencyReportView();
  if (emergencyStopOperation?.owner === owner) emergencyStopOperation = null;
  if (emergencyStopOwner === owner) emergencyStopOwner = null;
  return true;
}

function preserveUiErrorLogWithoutServerStop() {
  if (!gameDiagnostic || !isOnlineGame() || emergencyStopState !== "failed") return;
  emergencyStopState = "preserved-local";
  try {
    gameDiagnostic.recordEvent("online-ui-error-stop-local-preservation", {
      serverConfirmed: false,
      userAcceptedUnconfirmedServerState: true,
      lastError: emergencyStopError
    });
    gameDiagnostic.finalize(GAME_REPRODUCTION_END_REASONS.UI_ERROR, game, {
      context: emergencyReportContext?.context || "UI",
      stopRequestAccepted: false,
      serverStopConfirmed: false,
      locallyPreservedOnly: true
    });
  } catch {}
  persistGameDiagnostic({ immediate: true });
  emergencyStopOperation = null;
  emergencyStopOwner = null;
  closeOnlineEvents();
  pendingGameExit = null;
  resultRevealReady = true;
  resultDismissed = false;
  showEmergencyReportView();
}

function diagnosticStopRequest(request, timeoutMs = 8_000) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("Game stop request timed out.")), timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function showEmergencyReportView() {
  const korean = locale() === LOCALES.KO;
  const waitingForOnlineStop = isOnlineGame() && emergencyStopState === "stopping";
  const onlineStopFailed = isOnlineGame() && emergencyStopState === "failed";
  const locallyPreservedOnly = isOnlineGame() && emergencyStopState === "preserved-local";
  const reportReady = !waitingForOnlineStop && !onlineStopFailed;
  const title = waitingForOnlineStop
    ? (korean ? "서버에 경기 중단을 요청하고 있습니다" : "Requesting a server-side game stop")
    : onlineStopFailed
      ? (korean ? "서버 경기 중단을 확인하지 못했습니다" : "The server-side game stop was not confirmed")
      : locallyPreservedOnly
        ? (korean ? "서버 경기 중단 없이 로그만 보존했습니다" : "The log was preserved without a confirmed server-side stop")
        : (korean ? "화면 오류로 경기를 중단했습니다" : "The game was stopped after a UI error");
  const detail = waitingForOnlineStop
    ? (korean ? "응답을 확인할 때까지 이 화면을 유지해 주세요." : "Keep this screen open until the server responds.")
    : onlineStopFailed
      ? (korean
        ? `서버가 항복을 수락했는지 확인할 수 없습니다. ${emergencyStopError ? `(${localizedDynamicText(emergencyStopError)})` : ""}`
        : `The surrender could not be confirmed. ${emergencyStopError ? `(${emergencyStopError})` : ""}`)
      : locallyPreservedOnly
        ? (korean
          ? "이 기기의 재현 로그만 종료 상태로 보존했습니다. 서버의 경기는 계속 진행 중일 수 있습니다."
          : "Only this device's reproduction log was finalized. The server game may still be running.")
        : (korean
          ? `${localizedUiExceptionContext(emergencyReportContext?.context)} 오류와 경기 재현 정보를 보존했습니다.`
          : `The ${emergencyReportContext?.context || "UI"} error and reproduction data were preserved.`);
  try {
    replaceAppMarkup(`
      <main class="shell-screen emergency-game-stop-screen">
        <section class="emergency-game-stop" role="dialog" aria-modal="true" aria-labelledby="emergency-stop-title">
          <span>${reportReady ? (korean ? "재현 로그 보존" : "Reproduction log preserved") : (korean ? "중단 확인 필요" : "Stop confirmation required")}</span>
          <h1 id="emergency-stop-title">${escapeHtml(title)}</h1>
          <p>${escapeHtml(detail)}</p>
          ${onlineStopFailed ? `
            <div class="game-bug-report-actions emergency-stop-recovery-actions">
              <button type="button" class="primary" data-action="bug-report-retry-online-stop">${korean ? "서버 중단 다시 시도" : "Retry server stop"}</button>
              <button type="button" class="secondary" data-action="bug-report-preserve-local">${korean ? "서버 확인 없이 로그만 보존" : "Preserve log without confirmation"}</button>
            </div>
          ` : ""}
          ${waitingForOnlineStop ? `<p class="online-status" role="status">${korean ? "서버 응답을 기다리는 중…" : "Waiting for the server…"}</p>` : ""}
          ${reportReady ? gameBugReportPanel({ emergency: true }) : ""}
          ${reportReady ? `<button type="button" class="secondary emergency-menu-button" data-action="bug-report-return-menu">${korean ? "메인 메뉴로" : "Main menu"}</button>` : ""}
        </section>
      </main>
    `);
  } catch (viewError) {
    lastAppMarkup = null;
    app.textContent = reportReady
      ? (korean
        ? "경기 로그를 보존했습니다. 앱을 다시 실행하면 로그 전송 여부를 선택할 수 있습니다."
        : "The game log was preserved. Restart the app to choose whether to send it.")
      : (korean
        ? "서버 경기 중단 상태를 확인하지 못했습니다. 비상 복구 화면을 여는 중입니다."
        : "The server-side stop could not be confirmed. Opening emergency recovery.");
    console?.error?.("Emergency report view failed.", viewError);
    window.__riftboundEarlyCrashGuard?.show(viewError, true);
  }
}

function gameBugReportPanel(options = {}) {
  if (!gameDiagnostic) return "";
  ensureGameDiagnosticFinalized();
  const korean = locale() === LOCALES.KO;
  const validation = validateGameReportDescription(bugReportUi.description);
  const choice = bugReportUi.choice;
  const descriptionPlaceholder = korean
    ? GAME_REPRODUCTION_DESCRIPTION_PLACEHOLDER
    : "Describe the bug and the action immediately before it in at least 10 characters.";
  const title = bugReportUi.followUpAfterUiError
    ? (korean ? "새 화면 오류가 기록되었습니다. 추가 로그를 전송할까요?" : "A new UI error was captured. Send an additional report?")
    : options.recovered
      ? (korean ? "중단된 경기 로그가 남아 있습니다" : "An interrupted game log is available")
      : (korean ? "이 경기의 재현 로그를 서버에 전송할까요?" : "Send this game's reproduction log?");
  const followUpNotice = bugReportUi.followUpAfterUiError
    ? `<p>${korean
      ? "이전 전송 또는 전송하지 않음 결정은 그대로 유지됩니다. 새로 기록된 화면 오류는 별도 보고로 처리됩니다."
      : "Your earlier submission or decision is unchanged. The newly captured UI error will be handled as a separate report."}</p>`
    : "";
  if (choice === "submitted") {
    return `
      <section class="game-bug-report status-submitted" aria-label="${korean ? "버그 로그 전송 완료" : "Bug log submitted"}">
        <strong>${korean ? "로그를 전송했습니다" : "Log submitted"}</strong>
        <p>${korean ? "접수 ID" : "Report ID"}: <code>${escapeHtml(bugReportUi.reportId)}</code></p>
      </section>
    `;
  }
  if (choice === "declined") {
    return `
      <section class="game-bug-report status-declined" aria-label="${korean ? "버그 로그 전송 안 함" : "Bug log not submitted"}">
        <strong>${korean ? "이 경기의 로그를 전송하지 않습니다" : "This game's log will not be sent"}</strong>
      </section>
    `;
  }
  if (choice !== "form") {
    return `
      <section class="game-bug-report" aria-labelledby="game-bug-report-title">
        <div class="game-bug-report-copy">
          <strong id="game-bug-report-title">${title}</strong>
          <p>${korean
            ? "전송할 때 경기 상태, 행동 기록, 최근 화면 조작과 오류 정보가 포함됩니다. 온라인 경기는 서버의 양쪽 플레이어 숨겨진 카드 정보가 포함될 수 있으며 서버 관리자만 조회할 수 있습니다. 로그인하지 않아도 전송할 수 있습니다."
            : "The report includes game states, actions, recent UI interactions, and errors. Online reports may include both players' hidden card information from the server, visible only to server administrators. Sign-in is not required."}</p>
          ${followUpNotice}
        </div>
        <div class="game-bug-report-actions">
          <button type="button" class="secondary" data-action="bug-report-decline">${korean ? "전송하지 않음" : "Do not send"}</button>
          <button type="button" class="primary" data-action="bug-report-open">${korean ? "로그 전송" : "Send log"}</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="game-bug-report report-form" aria-labelledby="game-bug-report-title">
      <div class="game-bug-report-copy">
        <strong id="game-bug-report-title">${title}</strong>
          <p>${korean
            ? "어떤 상황에서 무엇이 잘못되었고, 원래 어떤 동작을 기대했는지 직접 작성해 주세요."
            : "Describe what went wrong, when it happened, and what you expected."}</p>
          ${followUpNotice}
      </div>
      <label for="game-bug-report-description">${korean ? "버그 설명 (필수)" : "Bug description (required)"}</label>
      <textarea id="game-bug-report-description" data-action="bug-report-description" required minlength="10" maxlength="2000" placeholder="${escapeHtml(descriptionPlaceholder)}" aria-describedby="game-bug-report-help">${escapeHtml(bugReportUi.description)}</textarea>
      <div class="game-bug-report-help" id="game-bug-report-help">
        <small>${korean ? "앞뒤 공백을 제외하고 최소 10자 이상 작성해야 전송할 수 있습니다." : "Enter at least 10 characters after trimming leading and trailing whitespace."}</small>
        <output data-bug-report-count>${validation.codePointLength}/10</output>
      </div>
      ${bugReportUi.error ? `<p class="game-bug-report-error" role="alert">${escapeHtml(bugReportUi.error)}</p>` : ""}
      <div class="game-bug-report-actions">
        <button type="button" class="secondary" data-action="bug-report-decline" ${bugReportUi.status === "submitting" ? "disabled" : ""}>${korean ? "전송하지 않음" : "Do not send"}</button>
        <button type="button" class="secondary" data-action="bug-report-cancel" ${bugReportUi.status === "submitting" ? "disabled" : ""}>${korean ? "뒤로" : "Back"}</button>
        <button type="button" class="primary" data-action="bug-report-submit" ${!validation.valid || bugReportUi.status === "submitting" ? "disabled" : ""}>${bugReportUi.status === "submitting" ? (korean ? "전송 중…" : "Sending…") : (korean ? "설명과 로그 전송" : "Send description and log")}</button>
      </div>
    </section>
  `;
}

function handleBugReportAction(action) {
  if (!action?.startsWith("bug-report-")) return false;
  if (action === "bug-report-retry-online-stop") {
    retryOnlineStopAfterUiError();
    return true;
  }
  if (action === "bug-report-preserve-local") {
    preserveUiErrorLogWithoutServerStop();
    return true;
  }
  if (action === "bug-report-open") {
    bugReportUi.choice = "form";
    bugReportUi.error = "";
  }
  if (action === "bug-report-cancel") {
    bugReportUi.choice = "prompt";
    bugReportUi.error = "";
  }
  if (action === "bug-report-decline") {
    bugReportUi.choice = "declined";
    bugReportUi.status = "idle";
    bugReportUi.error = "";
    forgetPersistedGameDiagnostic();
    startPendingOnlineDiagnosticIfReady();
    continuePendingPostReportActionIfReady();
  }
  if (action === "bug-report-submit") void submitCurrentGameBugReport();
  if (action === "bug-report-return-menu") {
    emergencyReportActive = false;
    emergencyReportContext = null;
    emergencyStopOwner = null;
    emergencyStopOperation = null;
    bugReportUi.recovered = Boolean(gameDiagnostic)
      && !["submitted", "declined"].includes(bugReportUi.choice);
    appView = "menu";
    resetGameUiState();
  }
  if (action !== "bug-report-submit") refreshBugReportSurface();
  return true;
}

async function submitCurrentGameBugReport() {
  if (!gameDiagnostic || bugReportUi.status === "submitting") return;
  const validation = validateGameReportDescription(bugReportUi.description);
  if (!validation.valid) {
    bugReportUi.error = validation.message;
    refreshBugReportSurface();
    return;
  }
  try {
    ensureGameDiagnosticFinalized();
    bugReportUi.status = "submitting";
    bugReportUi.error = "";
    refreshBugReportSurface();
    await (diagnosticServerReady ||= configureDiagnosticServer());
    const payload = createGameLogSubmissionPayload(gameDiagnostic, validation.value, {
      app: clientBuildInfo,
      locale: locale(),
      client: diagnosticViewport(),
      accountId: auth.user?.accountId || null
    });
    const diagnosticMetadata = currentDiagnosticSnapshot()?.metadata || {};
    if (isOnlineGame() && diagnosticMetadata.mode === "online") {
      payload.onlineContext = {
        roomId: diagnosticMetadata.roomId || online.roomId,
        playerToken: online.playerToken,
        gameNumber: Number(diagnosticMetadata.gameNumber) || 1,
        ...(diagnosticMetadata.diagnosticGameId
          ? { diagnosticGameId: String(diagnosticMetadata.diagnosticGameId) }
          : {})
      };
    }
    const result = await submitBugReport(payload, { accountToken: auth.token });
    const receipt = validateBugReportSubmissionReceipt(result);
    bugReportUi.choice = "submitted";
    bugReportUi.status = "idle";
    bugReportUi.reportId = receipt.reportId;
    bugReportUi.submittedAt = receipt.submittedAt;
    forgetPersistedGameDiagnostic();
    startPendingOnlineDiagnosticIfReady();
    continuePendingPostReportActionIfReady();
  } catch (error) {
    bugReportUi.status = "failed";
    bugReportUi.error = locale() === LOCALES.KO
      ? `로그를 전송하지 못했습니다. 내용을 유지했으니 다시 시도해 주세요. (${localizedDynamicText(errorMessage(error))})`
      : `The log could not be sent. Your description is preserved; please retry. (${errorMessage(error)})`;
    persistGameDiagnostic();
  }
  refreshBugReportSurface();
}

function refreshBugReportSurface() {
  if (emergencyReportActive) showEmergencyReportView();
  else render();
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
  const scrollingElement = document.scrollingElement;
  if (scrollingElement) {
    state[`@page:${scope}`] = { top: scrollingElement.scrollTop, left: scrollingElement.scrollLeft, scope };
  }
  if (state[".hand-panel .cards"]) handScrollLeft = state[".hand-panel .cards"].left || 0;
  const ownerScope = scrollStateOwnerScope(scope);
  return {
    ownerScope,
    state: rememberBoundedScrollState(ownerScope, state)
  };
}

function restoreScrollState(captured = null) {
  const ownerScope = scrollStateOwnerScope();
  shellScrollState = captured?.ownerScope === ownerScope
    ? captured.state
    : shellScrollStateByScope.get(ownerScope) || {};
  if (!currentRenderMarkupChanged) return;
  applyScrollState(shellScrollState);
  const scheduledState = shellScrollState;
  if (scrollRestoreFrame) window.cancelAnimationFrame(scrollRestoreFrame);
  scrollRestoreFrame = window.requestAnimationFrame(() => {
    scrollRestoreFrame = 0;
    if (shellScrollState === scheduledState) applyScrollState(scheduledState);
  });
}

function rememberBoundedScrollState(ownerScope, currentState) {
  const entries = new Map(Object.entries(shellScrollStateByScope.get(ownerScope) || {}));
  // Refresh current nodes to the newest end of the bounded map. Transient
  // choice/action/field ids otherwise accumulated forever and made every
  // later render query the DOM once for every interaction in the match.
  for (const [key, value] of Object.entries(currentState || {})) {
    entries.delete(key);
    entries.set(key, value);
  }
  while (entries.size > SCROLL_STATE_ENTRY_LIMIT) {
    entries.delete(entries.keys().next().value);
  }
  const bounded = Object.fromEntries(entries);
  shellScrollStateByScope.delete(ownerScope);
  shellScrollStateByScope.set(ownerScope, bounded);
  while (shellScrollStateByScope.size > SCROLL_STATE_SCOPE_LIMIT) {
    shellScrollStateByScope.delete(shellScrollStateByScope.keys().next().value);
  }
  return bounded;
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
    if (selector.startsWith("@auto:")) continue;
    const node = app.querySelector(selector);
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

function scrollStateOwnerScope(pageScope = scrollStateScope()) {
  // Game phases share board/hand scroll positions, while page scroll remains
  // keyed by the more specific phase through its @page entry.
  return String(pageScope || "empty").startsWith("layout.phase-") ? "layout" : String(pageScope || "empty");
}

function scrollNodeSignature(node) {
  const classes = [...node.classList]
    .filter((className) => !["open", "closed", "active", "selected", "chosen"].includes(className))
    .sort()
    .join(".");
  return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
}

function restorePaymentScroll() {
  if (!currentRenderMarkupChanged) return;
  const payRunes = app.querySelector(".pay-runes");
  if (payRunes) payRunes.scrollLeft = paymentRunesScrollLeft;
}

function menuView() {
  const activeDecks = activeDeckRecords();
  const validPair = activeDecks.length === 2 && activeDecks.every((deck) => validateDeckRecord(deck).playable);
  const playableDecks = deckStore.decks.filter((deck) => validateDeckRecord(deck).playable);
  const generation = selectedAiGenerationDescriptor();
  const aiDeckTrainingId = trainingDeckIdForGeneration(activeDecks[1], generation);
  const aiTrialPreset = matchingAiPreset(activeDecks[1], cardByNumber);
  const aiMatchReady = validPair && Boolean(aiDeckTrainingId || aiTrialPreset);
  const reportPending = diagnosticNavigationBlocked();
  return `
    <main class="shell-screen main-menu">
      <section class="menu-hero">
        <p class="eyebrow visible">Riftbound Online</p>
        <h1>Riftbound</h1>
        ${accountMenuPanel()}
        ${gameDiagnostic && bugReportUi.recovered && !["submitted", "declined"].includes(bugReportUi.choice)
          ? gameBugReportPanel({ recovered: true })
          : ""}
        ${onlineDiagnosticRecoveryInProgress ? `
          <section class="game-bug-report diagnostic-recovery-wait" role="status">
            <h2>${locale() === LOCALES.KO ? "온라인 경기 복구 중" : "Recovering online game"}</h2>
            <p>${locale() === LOCALES.KO
              ? "저장된 경기와 서버의 현재 경기가 일치하는지 확인하고 있습니다. 확인 전에는 새 경기를 시작할 수 없습니다."
              : "Checking that the saved game matches the server's current game. A new game cannot start until this is verified."}</p>
            <button type="button" class="secondary" data-action="diagnostic-recovery-abandon">${locale() === LOCALES.KO
              ? "복구 중단하고 로그 보존"
              : "Stop recovery and preserve log"}</button>
          </section>
        ` : ""}
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
          <span>${locale() === LOCALES.KO ? "3판 2선승 매치 (해제 시 단판 대회 변경 절차)" : "Best of three (off uses the single-game tournament procedure)"}</span>
        </label>
        <div class="menu-actions">
          <button class="primary menu-button tutorial-start" data-action="menu-tutorial" ${reportPending ? "disabled" : ""}>
            ${locale() === LOCALES.KO
              ? `튜토리얼 ${tutorialRecord.completedIds.length}/${TUTORIAL_CATALOG.length}`
              : `Tutorials ${tutorialRecord.completedIds.length}/${TUTORIAL_CATALOG.length}`}
          </button>
          <button class="primary menu-button" data-action="menu-start" ${validPair && !reportPending ? "" : "disabled"}>${t("startGame", locale())}</button>
          <button class="primary menu-button coach-start" data-action="menu-ai" ${aiMatchReady && neuralAiLoadState !== "loading" && !reportPending ? "" : "disabled"}>${neuralAiLoadState === "loading" ? (locale() === LOCALES.KO ? "선택한 세대 로딩 중…" : "Loading selected generation…") : (locale() === LOCALES.KO ? "학습 AI와 대전" : "Play Learning AI")}</button>
          <button class="secondary menu-button replay-menu-button" data-action="menu-replays">${locale() === LOCALES.KO ? "AI 경기 리플레이" : "AI Match Replays"}</button>
          <button class="secondary menu-button" data-action="menu-multiplayer" ${reportPending ? "disabled" : ""}>${t("multiplayer", locale())}</button>
          <button class="secondary menu-button" data-action="menu-decks">${t("deckEdit", locale())}</button>
        </div>
        <p class="ai-model-status">${escapeHtml(neuralAiStatusText())}</p>
        ${aiGenerationCatalogError ? `<p class="online-error" role="alert">${escapeHtml(aiGenerationCatalogError)}</p>` : ""}
        ${validPair && !aiDeckTrainingId ? `<p class="deck-warning ai-deck-warning">${escapeHtml(aiTrialPreset
          ? (locale() === LOCALES.KO
            ? '추가 덱으로 시험 대전합니다. 선택한 세대의 기록만으로는 이 덱의 학습 여부나 실력을 보장할 수 없습니다.'
            : 'Trial match with an additional deck. This generation’s records do not establish its training or strength with this list.')
          : (locale() === LOCALES.KO
            ? '플레이어 2 덱을 위 학습 덱 또는 추가 시험 덱(비오로라 마스터 이·빅토르 컨트롤)으로 선택해 주세요.'
            : 'Select a trained deck or an additional trial deck (No Aurora Master Yi or Viktor Control) for Player 2.'))}</p>` : ""}
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
    const invalidFrameIndex = result.replay.frames.findIndex((frame) => replayFrameRenderIssue(frame));
    if (invalidFrameIndex >= 0) throw new Error(`Replay frame ${invalidFrameIndex} is invalid: ${replayFrameRenderIssue(result.replay.frames[invalidFrameIndex])}`);
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

function replayFrameRenderIssue(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return "Frame is missing.";
  if (!frame.game || typeof frame.game !== "object" || Array.isArray(frame.game)) return "Game state is missing.";
  return gameUiRenderIssue(frame.game);
}

function leaveReplayBrowser() {
  pauseReplayPlayback();
  clearViewerTransientPresentation();
  replayMode = false;
  replayBrowser.current = null;
  appView = "menu";
}

function exitReplayToList() {
  pauseReplayPlayback();
  clearViewerTransientPresentation();
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
  const card = cardVisibleToCurrentViewer(cardId) ? findVisibleCard(cardId) : null;
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
  if (action === "return-menu") return leaveReplayBrowser();
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
  if (action === "toggle-log") { toggleTabletopSheet("log"); return; }
  if (action === "toggle-hand") { handOpen = !handOpen; return; }
  if (action === "toggle-inspector") { toggleTabletopSheet("inspector"); return; }
  if (action === "toggle-graveyard") { toggleTabletopSheet("graveyard", button.dataset.player); return; }
  if (action === "toggle-banished") { toggleTabletopSheet("banished", button.dataset.player); return; }
  if (action === "toggle-intel") { toggleTabletopSheet("intel", button.dataset.player); return; }
  if (action === "close-graveyard") { graveyardOpenPlayerId = null; return; }
  if (action === "close-banished") { banishedOpenPlayerId = null; return; }
  if (action === "close-intel") { intelOpenPlayerId = null; return; }
  if (action === "close-full-card") { fullCardOpen = false; fullCardPreviewCard = null; return; }
  if (action === "view-full-card") { fullCardPreviewCard = inspectedCard(); fullCardOpen = Boolean(fullCardPreviewCard); return; }
  if (action === "view-chain-card") { fullCardPreviewCard = chainPreviewCard(button.dataset.cardId); fullCardOpen = Boolean(fullCardPreviewCard); return; }
  if (action === "toggle-attachments") { attachmentsOpenCardId = attachmentsOpenCardId === button.dataset.card ? null : button.dataset.card; return; }
  if (action === "toggle-chain-zone") { chainZoneCollapsed = !chainZoneCollapsed; return; }
  if (action === "inspect-chain-effect") {
    toggleInspectedChainItem(button.dataset.chainItemId);
    return;
  }
  if (action === "focus-chain-target") { focusChainTarget(button.dataset.cardId); return; }
  const cardNode = event.target.closest("[data-card-id]");
  if (cardNode) setUiSelectedCard(cardNode.dataset.cardId);
}

function applyReplayFrame(requestedIndex) {
  const frames = replayBrowser.current?.frames || [];
  if (!frames.length) return;
  const previousIndex = replayBrowser.frameIndex;
  const numericIndex = Number(requestedIndex);
  const index = Math.max(0, Math.min(frames.length - 1, Number.isFinite(numericIndex) ? Math.trunc(numericIndex) : 0));
  const frameIssue = replayFrameRenderIssue(frames[index]);
  if (frameIssue) {
    pauseReplayPlayback();
    replayBrowser.error = locale() === LOCALES.KO
      ? `리플레이 프레임을 표시할 수 없습니다: ${frameIssue}`
      : `Could not display replay frame: ${frameIssue}`;
    replayMode = false;
    appView = "replays";
    return;
  }
  const continuousForwardStep = index === previousIndex + 1;
  if (!continuousForwardStep) clearViewerTransientPresentation();
  replayBrowser.frameIndex = index;
  game = structuredClone(frames[index].game);
  game.selectedCardId = null;
  fullCardOpen = false;
  fullCardPreviewCard = null;
  inspectorPreviewCard = null;
  attachmentsOpenCardId = null;
  graveyardOpenPlayerId = null;
  banishedOpenPlayerId = null;
}

function scheduleReplayPlayback() {
  if (!replayMode || !replayBrowser.playing || replayBrowser.timer) return;
  const frames = replayBrowser.current?.frames || [];
  if (replayBrowser.frameIndex >= frames.length - 1) {
    replayBrowser.playing = false;
    return;
  }
  const drawCount = uiMotion.transfers.filter((transfer) => transfer?.kind === "draw").length;
  const motionFloor = uiMotion.transfers.length
    ? TABLETOP_TRANSFER_DURATION_MS + Math.max(0, drawCount - 1) * TABLETOP_DRAW_STAGGER_MS + 180
    : 0;
  replayBrowser.timer = window.setTimeout(() => {
    replayBrowser.timer = null;
    applyReplayFrame(replayBrowser.frameIndex + 1);
    render();
  }, Math.max(180, 1200 / replayBrowser.speed, motionFloor));
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
              ? "실제 대전과 같은 화면에서 중앙 전장, 하단 손패·명령 바, 오른쪽 보조 기능을 따라 기본 규칙부터 전투와 비용 지불까지 연습합니다."
              : "Use the live match layout—center battlefields, bottom hand and command bar, and the right utility rail—to practice the core rules, combat, and costs."}</p>
          </div>
          <div class="tutorial-menu-progress" aria-label="${isKorean ? "튜토리얼 완료 현황" : "Tutorial completion"}">
            <strong>${completed.size}/${TUTORIAL_CATALOG.length}</strong>
            <span>${isKorean ? "완료" : "complete"}</span>
          </div>
        </header>
        <div class="tutorial-ui-map" aria-label="${isKorean ? "대전 화면 빠른 안내" : "Match screen quick guide"}">
          <div><b>${isKorean ? "중앙 보드" : "Center board"}</b><span>${isKorean ? "상대 영역은 위, 내 룬과 기지는 아래에 있습니다." : "The opponent is above; your Runes and Base are below."}</span></div>
          <div><b>${isKorean ? "하단 명령 바" : "Bottom command bar"}</b><span>${isKorean ? "카드를 선택하면 손패 바로 위에 가능한 행동이 표시됩니다." : "Select a card to see its available commands above your hand."}</span></div>
          <div><b>${isKorean ? "오른쪽 보조 기능" : "Right utility rail"}</b><span>${isKorean ? "카드 정보와 턴 종료는 화면 오른쪽에서 사용합니다." : "Card details and End Turn stay on the right edge."}</span></div>
        </div>
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
                  <span>${escapeHtml(isKorean ? lesson.duration : lesson.englishDuration)}</span>
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

function neuralAiDescriptorKey(descriptor) {
  return JSON.stringify({
    generation: Number(descriptor?.generation),
    source: descriptor?.source || "bundled",
    checkpointBaseUrl: descriptor?.checkpointBaseUrl ?? null,
    checkpoint: descriptor?.checkpoint || "",
    filename: descriptor?.filename || "",
    kind: descriptor?.kind || "",
    modifiedAt: Number(descriptor?.modifiedAt) || 0,
    engineFingerprint: descriptor?.engineFingerprint || ""
  });
}

function aiGenerationOptionLabel(entry) {
  const korean = locale() === LOCALES.KO;
  const state = entry.activeChampion
    ? (korean ? "최근 승급 챔피언" : "current promoted champion")
    : entry.activeLearner
      ? (korean ? "최신 학습 모델 · 시험 대전" : "latest learner · trial")
      : entry.kind === "learner"
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
  const trial = entry.activeLearner && !entry.activeChampion
    ? (korean ? " · 챔피언 대비 우위 미확정" : " · superiority over the champion is unproven") : "";
  return `${games} · ${compatibility}${trial}`;
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
      onlinePoolId: normalizeRoomDeckOptions({ poolId: parsed?.onlinePoolId }).poolId,
      onlineBanlistEnabled: parsed?.onlineBanlistEnabled === true,
      aiGeneration: Number.isInteger(Number(parsed?.aiGeneration)) && Number(parsed.aiGeneration) >= 0
        ? Number(parsed.aiGeneration)
        : normalizeAiGeneration()
    };
  } catch {
    return { locale: LOCALES.EN, sideboardingEnabled: false, onlinePoolId: DEFAULT_ROOM_POOL_ID, onlineBanlistEnabled: false, aiGeneration: normalizeAiGeneration() };
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
  const room = online.room;
  const deckValidation = validateRoomDeck(activeDeck, cardByNumber, room || {});
  const deckReady = deckValidation.playable;
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
              <input data-action="online-code-input" value="${codeValue}" maxlength="8" placeholder="${t("roomCode", locale())}" ${online.loading ? "disabled" : ""} />
              <button data-action="online-join-code" ${online.loading ? "disabled" : ""}>${t("join", locale())}</button>
            </div>
            <div class="room-create-options">
              <label>${locale() === LOCALES.KO ? "새 방 환경" : "New room card pool"}
                <select data-action="online-pool" ${online.loading ? "disabled" : ""}>${CARD_POOL_FORMATS.map((pool) => `<option value="${pool.id}" ${pool.id === settings.onlinePoolId ? "selected" : ""}>${escapeHtml(roomPoolName(pool.id))}</option>`).join("")}</select>
              </label>
              <label>${locale() === LOCALES.KO ? "금제" : "Ban list"}
                <select data-action="online-banlist" ${online.loading ? "disabled" : ""}>
                  <option value="off" ${settings.onlineBanlistEnabled ? "" : "selected"}>${locale() === LOCALES.KO ? "미적용" : "Disabled"}</option>
                  <option value="on" ${settings.onlineBanlistEnabled ? "selected" : ""}>${locale() === LOCALES.KO ? "적용" : "Enabled"}</option>
                </select>
              </label>
            </div>
            <p class="deck-note room-banlist-note">${locale() === LOCALES.KO ? `금제: ${STANDARD_BAN_LIST.effectiveDate} 공식 1대1 목록. 기본덱은 금제 예외이며, 선택 환경의 카드팩 범위는 적용됩니다. AI 대전에는 영향을 주지 않습니다.` : `Ban list: Standard, ${STANDARD_BAN_LIST.effectiveDate}. Default decks are exempt from bans; card pool limits still apply. AI games are unaffected.`}</p>
            <button class="primary wide-action" data-action="online-create" ${online.loading ? "disabled" : ""}>${t("createRoom", locale())}</button>
            <p class="deck-note">${settings.sideboardingEnabled ? (locale() === LOCALES.KO ? "새 방: 사이드전 사용" : "New room: sideboarding enabled") : (locale() === LOCALES.KO ? "새 방: 단판" : "New room: single game")}</p>
          </article>
          <article class="multiplayer-panel">
            <div class="section-head">
              <div>
                <h2>${room ? `${t("rooms", locale())} ${room.roomId}` : t("noRoom", locale())}</h2>
                <span>${room ? `${room.playerCount}/2 ${t("players", locale())} / ${localizedRoomStatus(room.status)}` : t("createOrJoinRoom", locale())}</span>
                ${room ? `<small>${room.sideboardingEnabled ? (locale() === LOCALES.KO ? "사이드전 · 3판 2선승" : "Sideboarding · best of three") : (locale() === LOCALES.KO ? "단판" : "Single game")}</small>` : ""}
                ${room ? `<small class="room-rules-summary">${escapeHtml(roomRulesSummary(room))}</small>` : ""}
              </div>
              ${room ? `<button data-action="online-leave">${t("leave", locale())}</button>` : ""}
            </div>
            ${online.error ? `<p class="online-error">${escapeHtml(localizedOnlineError(online.error))}</p>` : ""}
            ${online.leaveNotice ? `<p class="online-error online-leave-notice" role="alert">${escapeHtml(localizedOnlineError(online.leaveNotice))}</p>` : ""}
            <div class="seat-list">
              ${room ? Object.values(room.seats).map(seatBadge).join("") : `<p class="empty">아직 참가한 방이 없습니다.</p>`}
            </div>
            <div class="online-deck-submit">
              <strong>${t("selectedDeck", locale())}</strong>
              ${activeDeck ? deckSummaryBadge(activeDeck, online.playerId ? `${locale() === LOCALES.KO ? "내 좌석" : "Your seat"}: ${playerSlotLabel(online.playerId)}` : (locale() === LOCALES.KO ? "로컬 덱" : "Local deck"), deckValidation) : `<p class="empty">선택된 덱이 없습니다.</p>`}
              ${room && activeDeck ? roomDeckStatus(activeDeck, room) : ""}
              <button data-action="online-submit-deck" ${room && deckReady && !online.loading ? "" : "disabled"}>${t("submitDeck", locale())}</button>
              <button class="primary" data-action="online-ready" ${room && mySeat?.deckName && !online.loading ? "" : "disabled"}>
                ${mySeat?.ready ? t("ready", locale()) : t("readyUp", locale())}
              </button>
            </div>
          </article>
        </div>
      </section>
    </main>
  `;
}

function roomPoolName(poolId) {
  const pool = CARD_POOL_FORMATS.find((candidate) => candidate.id === poolId)
    || CARD_POOL_FORMATS.find((candidate) => candidate.id === DEFAULT_ROOM_POOL_ID);
  return locale() === LOCALES.KO ? localizedPackName(pool.name) : pool.name.replace(" 출시 환경", " era");
}

function roomRulesSummary(room) {
  const options = normalizeRoomDeckOptions(room);
  return `${roomPoolName(options.poolId)} · ${locale() === LOCALES.KO
    ? (options.banlistEnabled ? "금제 적용" : "금제 미적용")
    : (options.banlistEnabled ? "Bans enabled" : "Bans disabled")}`;
}

function roomDeckStatus(deck, room) {
  const restrictions = deckRoomRestrictions(deck, cardByNumber, room);
  const messages = [];
  const names = (list) => list.map(cardName).join(", ");
  if (restrictions.outOfPoolCards.length) messages.push(locale() === LOCALES.KO
    ? `선택 환경에 포함되지 않은 카드: ${names(restrictions.outOfPoolCards)}`
    : `Cards outside this room's card pool: ${names(restrictions.outOfPoolCards)}`);
  if (restrictions.banlistEnabled && !restrictions.banExempt && restrictions.bannedCards.length) messages.push(locale() === LOCALES.KO
    ? `금제 적용 방에서 사용할 수 없는 카드: ${names(restrictions.bannedCards)}`
    : `Banned cards cannot be used in this room: ${names(restrictions.bannedCards)}`);
  if (restrictions.banlistEnabled && restrictions.banExempt) messages.push(locale() === LOCALES.KO
    ? "기본덱 원본 구성: 금제 예외가 적용됩니다."
    : "Original default deck: exempt from the ban list.");
  return messages.length ? `<div class="room-deck-status ${restrictions.playable ? "deck-note" : "online-error"}" role="status">${messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("")}</div>` : "";
}

function roomListItem(room) {
  return `
    <button class="room-list-item" data-action="online-join-room" data-room="${room.roomId}" ${online.loading || room.playerCount >= 2 || room.status !== "lobby" ? "disabled" : ""}>
      <strong>${room.roomId}</strong>
      <span>${room.playerCount}/2</span>
      <em>${localizedRoomStatus(room.status)}</em>
      <small class="room-rules-summary">${escapeHtml(roomRulesSummary(room))}</small>
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
      <section class="deck-select-panel" ${deckEditor.transferDialog?.mode === "image" ? "inert" : ""}>
        ${deckLibraryHeader()}
        ${deckLibraryFilters()}
        <div class="deck-slot-grid" aria-label="${locale() === LOCALES.KO ? "덱 목록" : "Deck list"}">
          ${deckLibraryCards()}
        </div>
      </section>
      <section class="deck-editor-panel" ${deckEditor.transferDialog?.mode === "image" ? "inert" : ""}>
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
      <div class="deck-mobile-navigation">
        <button class="deck-mobile-back" data-action="deck-mobile-list">← ${locale() === LOCALES.KO ? "덱 목록" : "Decks"}</button>
        <button data-action="deck-toggle-tools" aria-expanded="${deckEditor.mobileToolsOpen}" aria-controls="deck-editor-actions">${locale() === LOCALES.KO ? (deckEditor.mobileToolsOpen ? "접기 −" : "더 보기 +") : (deckEditor.mobileToolsOpen ? "Less −" : "More +")}</button>
      </div>
      <div class="deck-name-row">
        <input class="deck-name-input" data-action="deck-name" value="${escapeHtml(localizedDeckName(deck.name))}" maxlength="48" />
        <span class="deck-owner-badge ${deck.isDefault ? "default" : "personal"}">${deck.isDefault
          ? (locale() === LOCALES.KO ? "기본 덱 · 수정 시 내 덱으로 복사" : "Default · copied to My Decks when edited")
          : (auth.user ? (locale() === LOCALES.KO ? "내 계정 덱" : "My account deck") : (locale() === LOCALES.KO ? "이 기기에 저장된 내 덱" : "My deck on this device"))}</span>
        <span class="${validation.playable ? "valid-pill" : "invalid-pill"}">${validation.playable ? t("playable", locale()) : t("notPlayable", locale())}</span>
      </div>
      <div class="deck-editor-actions ${deckEditor.mobileToolsOpen ? "mobile-tools-open" : ""}" id="deck-editor-actions">
        <button data-action="deck-ai-recommend">선택 카드풀 AI 추천</button>
        <button data-action="deck-set-active" data-slot="0" ${validation.playable ? "" : "disabled"}>플레이어 1 덱으로 사용</button>
        <button data-action="deck-set-active" data-slot="1" ${validation.playable ? "" : "disabled"}>플레이어 2 덱으로 사용</button>
        <button data-action="deck-export-open">${locale() === LOCALES.KO ? "덱 텍스트 복사" : "Copy Deck Text"}</button>
        <button class="deck-image-export-button" data-action="deck-image-open">${locale() === LOCALES.KO ? "덱 이미지 내보내기" : "Export Deck Image"}</button>
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
    <div class="deck-editor-grid" data-scroll-key="deck-editor-grid">
      <aside class="deck-card-detail" data-scroll-key="deck-card-detail">
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
  if (dialog.mode === "image") return deckImageTransferView(dialog);
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
          placeholder="Legend:\n1 Master Yi, Wuju Bladesman\n\nChampion:\n1 Master Yi, Tempered\n\nMainDeck:\n3 First Mate\n2 Pit Rookie\n\nBattlefields:\n1 Aspirant's Climb\n1 Obelisk of Power\n1 Sigil of the Storm\n\nRune Pool:\n7 Body Rune\n5 Calm Rune\n\nSideboard:\n2 Alpha Strike\n1 Sabotage"
        >${escapeHtml(dialog.text || "")}</textarea>
        <div class="deck-transfer-feedback">
          ${dialog.error ? `<p class="deck-transfer-message error" role="alert">${escapeHtml(dialog.error)}</p>` : ""}
          ${dialog.notice ? `<p class="deck-transfer-message success" role="status">${escapeHtml(dialog.notice)}</p>` : ""}
        </div>
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

function deckLibraryHeader() {
  const korean = locale() === LOCALES.KO;
  return `
    <div class="deck-library-header">
      <div class="deck-library-heading">
        <button class="round-back" data-action="menu-home" aria-label="${t("back", locale())}">←</button>
        <div><span class="deck-library-eyebrow">RIFTBOUND</span><h1>${t("deckSelect", locale())}</h1></div>
        <span class="deck-library-total">${deckStore.decks.length}${korean ? "개" : " decks"}</span>
      </div>
      <p>${korean ? "나만의 덱을 준비하고 전장으로 향하세요." : "Build your collection. Find your next battle."}</p>
      <div class="deck-library-create">
        <button class="primary" data-action="deck-new"><span aria-hidden="true">＋</span> ${korean ? "새 덱 만들기" : "New Deck"}</button>
        <button data-action="deck-import-open">${korean ? "텍스트 가져오기" : "Import Text"}</button>
      </div>
      ${deckEditor.transferNotice?.tone === "error" ? `<p class="deck-transfer-notice error" role="alert">${escapeHtml(deckEditor.transferNotice.message)}</p>` : ""}
    </div>`;
}

function deckLibraryFilters() {
  const korean = locale() === LOCALES.KO;
  const personal = deckStore.decks.filter((deck) => !deck.isDefault).length;
  const filters = [["all", korean ? "전체" : "All", deckStore.decks.length], ["personal", korean ? "내 덱" : "My Decks", personal], ["default", korean ? "기본 덱" : "Defaults", deckStore.decks.length - personal]];
  return `
    <div class="deck-library-filters">
      <label class="deck-library-search"><span aria-hidden="true">⌕</span><input type="search" data-action="deck-list-search" value="${escapeHtml(deckEditor.listSearch)}" placeholder="${korean ? "덱 이름 · 챔피언 검색" : "Search decks or champions"}" aria-label="${korean ? "덱 검색" : "Search decks"}" autocomplete="off" /></label>
      <div class="deck-library-tabs" role="group" aria-label="${korean ? "덱 종류" : "Deck collection"}">
        ${filters.map(([id, name, count]) => `<button id="deck-list-filter-${id}" data-action="deck-list-filter" data-filter="${id}" aria-pressed="${deckEditor.listFilter === id}">${name}<span>${count}</span></button>`).join("")}
      </div>
      <span class="deck-library-result-count" role="status" aria-live="polite">${deckLibraryResultLabel()}</span>
    </div>`;
}

function filteredDeckRecords() {
  const query = deckEditor.listSearch.trim().toLocaleLowerCase();
  return deckStore.decks.filter((deck) => {
    if (deckEditor.listFilter === "personal" && deck.isDefault) return false;
    if (deckEditor.listFilter === "default" && !deck.isDefault) return false;
    const hero = deckHeroCard(deck);
    const legend = cardByNumber(deck.legend);
    const names = [deck.name, localizedDeckName(deck.name), hero?.name, cardName(hero), legend?.name, cardName(legend), ...(legend?.domains || []).map(domainText)];
    return !query || names.join(" ").toLocaleLowerCase().includes(query);
  });
}

function deckLibraryResultLabel() {
  const count = filteredDeckRecords().length;
  return locale() === LOCALES.KO ? `${count}개의 덱 · 선택하여 편집` : `${count} decks · select to edit`;
}

function deckLibraryCards() {
  const decks = filteredDeckRecords();
  if (decks.length) return decks.map(deckSelectCard).join("");
  const korean = locale() === LOCALES.KO;
  const searching = Boolean(deckEditor.listSearch.trim());
  return `<div class="deck-library-empty">
    <span aria-hidden="true">◇</span>
    <strong>${searching ? (korean ? "검색 결과가 없습니다" : "No matching decks") : (korean ? "첫 번째 덱을 만들어 보세요" : "Create your first deck")}</strong>
    <p>${searching ? (korean ? "다른 덱 이름이나 챔피언으로 검색해 주세요." : "Try a different deck or champion name.") : (korean ? "새 덱을 만들거나 덱 텍스트를 가져올 수 있습니다." : "Build a new deck or import a deck list.")}</p>
    <button data-action="${searching ? "deck-list-clear" : "deck-new"}">${searching ? (korean ? "검색 지우기" : "Clear Search") : (korean ? "새 덱 만들기" : "New Deck")}</button>
  </div>`;
}

function refreshDeckLibraryResults() {
  // The search field stays mounted so mobile keyboards and Korean IME keep focus.
  lastAppMarkup = null;
  const list = app.querySelector(".deck-slot-grid");
  if (list) { list.innerHTML = deckLibraryCards(); list.scrollTop = 0; }
  const count = app.querySelector(".deck-library-result-count");
  if (count) count.textContent = deckLibraryResultLabel();
}

function deckSelectCard(deck) {
  const validation = validateDeckRecord(deck);
  const hero = deckHeroCard(deck);
  const korean = locale() === LOCALES.KO;
  const domains = cardByNumber(deck.legend)?.domains || [];
  const activeLabels = deckStore.activeDeckIds
    .map((id, index) => id === deck.id ? (locale() === LOCALES.KO ? `플레이어 ${index + 1}` : `P${index + 1}`) : null)
    .filter(Boolean)
    .join(" / ");
  return `
    <button class="deck-slot ${deck.id === deckEditor.selectedDeckId ? "selected" : ""}" data-action="deck-select" data-deck="${escapeHtml(deck.id)}" style="--deck-accent: ${RUNE_COLORS[domains[0]] || "#bfa878"}">
      <span class="deck-slot-art">${cardArtUrl(hero) ? `<img src="${escapeHtml(cardArtUrl(hero))}" alt="" loading="lazy" />` : `<span class="deck-slot-placeholder" aria-hidden="true">◇</span>`}</span>
      <span class="deck-slot-copy">
        <span class="deck-slot-meta"><span class="deck-owner-label ${deck.isDefault ? "default" : "personal"}">${deck.isDefault ? (korean ? "기본 덱" : "Default") : (korean ? "내 덱" : "My Deck")}</span>${activeLabels ? `<span class="deck-slot-active">${activeLabels}</span>` : ""}</span>
        <strong class="deck-slot-title">${escapeHtml(localizedDeckName(deck.name))}</strong>
        <span class="deck-slot-domains">${domains.map((domain) => `<span><i aria-hidden="true" style="background: ${RUNE_COLORS[domain] || "#bfa878"}"></i>${escapeHtml(domainText(domain))}</span>`).join("") || (korean ? "레전드를 선택해 주세요" : "Choose a Legend")}</span>
        <span class="deck-slot-counts"><span>${korean ? "메인" : "Main"} ${mainDeckCount(deck)}</span><span>${korean ? "룬" : "Runes"} ${runeDeckCount(deck)}</span><span>${korean ? "사이드" : "Side"} ${sideboardCount(deck)}</span></span>
        <small class="${validation.playable ? "valid-text" : "invalid-text"}">${validation.playable ? (korean ? "플레이 준비 완료" : "Ready to play") : (korean ? "구성 중" : "In progress")}</small>
      </span>
      <span class="deck-slot-chevron" aria-hidden="true">›</span>
    </button>
  `;
}

function deckSummaryBadge(deck, label, validation = validateDeckRecord(deck)) {
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
      ${cardArtUrl(card) ? `<img src="${cardArtUrl(card)}" alt="${cardName(card)}" />` : `<span class="deck-card-back large"></span>`}
      <h2>${cardName(card)}</h2>
      <span>${cardTags(card).join(" / ")}</span>
      <div class="card-ban-status ${isCardBanned(card) ? "is-banned" : "is-allowed"}">${locale() === LOCALES.KO ? (isCardBanned(card) ? "금지 카드" : "금지 아님") : (isCardBanned(card) ? "Banned" : "Not banned")}</div>
      <div class="card-ban-context">${locale() === LOCALES.KO ? `공식 1대1 금제 · ${STANDARD_BAN_LIST.effectiveDate}` : `Standard ban list · ${STANDARD_BAN_LIST.effectiveDate}`}${isCardBanned(card) ? `<br>${locale() === LOCALES.KO ? "금제 적용 방의 개인 덱에서 사용 불가. 기본덱 원본 구성과 AI 대전은 예외입니다." : "Unavailable in personal decks in rooms with bans enabled. Original default decks and AI games are exempt."}` : ""}</div>
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
    buttons.push(`<div class="deck-zone-actions">
      <button data-action="deck-add-main" data-card-number="${card.cardNumber}" ${(!unlimited && registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies) || mainDeckCount(deck) >= DECK_RULES.tournamentMainExact ? "disabled" : ""}>${locale() === LOCALES.KO ? "주 덱 추가" : "Add to Main"} ${count}/${maximumLabel}</button>
      <button class="deck-subtract" data-action="deck-remove-main" data-card-number="${card.cardNumber}" ${count <= 0 ? "disabled" : ""}>${locale() === LOCALES.KO ? "− 주 덱 빼기" : "− Remove Main"}</button>
    </div>`);
    buttons.push(`<div class="deck-zone-actions">
      <button data-action="deck-add-sideboard" data-card-number="${card.cardNumber}" ${(!unlimited && registeredNameCount(deck, card.name) >= DECK_RULES.maxCopies) || sideboardCount(deck) >= DECK_RULES.sideboardMax ? "disabled" : ""}>${locale() === LOCALES.KO ? "사이드보드 추가" : "Add to Sideboard"} ${sideCountValue}/${maximumLabel}</button>
      <button class="deck-subtract" data-action="deck-remove-sideboard" data-card-number="${card.cardNumber}" ${sideCountValue <= 0 ? "disabled" : ""}>${locale() === LOCALES.KO ? "− 사이드 빼기" : "− Remove Side"}</button>
    </div>`);
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
      ${cardArtUrl(card) ? `<img src="${cardArtUrl(card)}" alt="${cardName(card)}" />` : ""}
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
      ${cardArtUrl(card) ? `<img class="rune-row-art" src="${cardArtUrl(card)}" alt="${cardName(card)}" loading="lazy" />` : `<span class="rune-swatch" style="--rune:${RUNE_COLORS[domain]}"></span>`}
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
              <img src="${cardArtUrl(card)}" alt="${cardName(card)}" loading="lazy" />
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
      ${cardArtUrl(card) ? `<img src="${cardArtUrl(card)}" alt="${cardName(card)}" loading="lazy" />` : `<span class="deck-card-back"></span>`}
      <strong>${cardName(card)}</strong>
      <span>${cardType(card)}${card.energy !== undefined ? ` / ${card.energy}` : ""}</span>
      ${isCardBanned(card) ? `<b class="card-ban-badge">${locale() === LOCALES.KO ? "금지" : "Banned"}</b>` : ""}
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
    ...Object.entries(rawDecklists).filter(([key]) => !["keenanXiong", "drowsy"].includes(key)),
    ...AI_DECK_PRESETS.map(preset => [preset.id, preset])
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
      playerToken: parsed?.playerToken || "",
      diagnosticGameId: String(parsed?.diagnosticGameId || ""),
      gameNumber: Number.isInteger(Number(parsed?.gameNumber)) && Number(parsed.gameNumber) > 0
        ? Number(parsed.gameNumber)
        : null
    };
  } catch {
    return {
      mode: "offline",
      roomId: "",
      playerId: "",
      playerToken: "",
      diagnosticGameId: "",
      gameNumber: null
    };
  }
}

function saveOnlineSeat() {
  localStorage.setItem(ONLINE_STORAGE_KEY, JSON.stringify({
    mode: online.mode,
    roomId: online.roomId,
    playerId: online.playerId,
    playerToken: online.playerToken,
    diagnosticGameId: online.diagnosticGameId || null,
    gameNumber: online.gameNumber || null
  }));
}

function beginOnlineOperationLoading(operation) {
  if (onlineRefreshOperation && onlineRefreshOperation !== operation) {
    const refreshOperation = onlineRefreshOperation;
    onlineRefreshOperation = null;
    roomRefreshController?.abort();
    roomRefreshController = null;
    finishOnlineOperationLoading(refreshOperation);
  }
  onlineLoadingOperation = operation;
  online.loading = true;
}

function finishOnlineOperationLoading(operation) {
  if (onlineLoadingOperation !== operation) return false;
  onlineLoadingOperation = null;
  online.loading = false;
  return true;
}

function cancelOnlineSeatRequestOperation() {
  const operation = onlineSeatRequestOperation;
  onlineSeatRequestOperation = null;
  if (operation) finishOnlineOperationLoading(operation);
}

function cancelOnlineRoomMutationOperation() {
  const operation = onlineRoomMutationOperation;
  onlineRoomMutationOperation = null;
  if (operation) finishOnlineOperationLoading(operation);
}

function retireEmergencyOnlineStopOwner(reason) {
  const owner = emergencyStopOwner;
  emergencyStopOwner = null;
  emergencyStopOperation = null;
  const retiresActiveEmergency = Boolean(owner)
    && emergencyReportActive
    && ["stopping", "failed"].includes(emergencyStopState);
  if (!retiresActiveEmergency) return;
  const preservesCurrentRecorder = gameDiagnostic === owner.diagnosticRecorder;
  if (preservesCurrentRecorder) {
    try {
      owner.diagnosticRecorder?.recordEvent(`online-ui-error-stop-${reason}`, {
        serverConfirmed: false,
        roomId: owner.roomId,
        sessionInvalidated: reason === "session-invalidated",
        diagnosticChanged: reason === "diagnostic-changed"
      });
      owner.diagnosticRecorder?.finalize(GAME_REPRODUCTION_END_REASONS.UI_ERROR, game, {
        context: owner.context || emergencyReportContext?.context || "UI",
        stopRequestAccepted: false,
        serverStopConfirmed: false,
        locallyPreservedOnly: true,
        sessionInvalidatedBeforeConfirmation: reason === "session-invalidated",
        diagnosticChangedBeforeConfirmation: reason === "diagnostic-changed"
      });
    } catch {}
    persistGameDiagnostic();
  }
  emergencyReportActive = false;
  emergencyReportContext = null;
  emergencyStopState = "idle";
  emergencyStopError = "";
  bugReportUi.recovered = preservesCurrentRecorder && !bugReportDecisionResolved();
  if (bugReportUi.recovered) appView = "menu";
}

function invalidateEmergencyOnlineStopSession() {
  retireEmergencyOnlineStopOwner("session-invalidated");
}

function invalidateOnlineSession() {
  invalidateEmergencyOnlineStopSession();
  onlineSessionGeneration += 1;
  online.commandPending = null;
  cancelOnlineRoomMutationOperation();
  if (deferredOnlineRenderTimer) clearTimeout(deferredOnlineRenderTimer);
  deferredOnlineRenderTimer = null;
  deferredOnlineRenderGeneration += 1;
  return onlineSessionGeneration;
}

function clearOnlineSeat() {
  cancelOnlineSeatRequestOperation();
  invalidateOnlineSession();
  closeOnlineEvents();
  onlineSelectedCardId = null;
  onlineDiagnosticGameKey = "";
  pendingOnlineDiagnosticStart = null;
  recoveredOnlineStopRequested = false;
  online.mode = "offline";
  online.roomId = "";
  online.playerId = "";
  online.playerToken = "";
  online.diagnosticGameId = "";
  online.gameNumber = null;
  online.room = null;
  online.match = null;
  onlineSideboardDraft = null;
  onlineSideboardBaseline = null;
  onlineSideboardDraftKey = "";
  online.error = "";
  online.leaveNotice = "";
  localStorage.removeItem(ONLINE_STORAGE_KEY);
}

function ensureRoomRefresh() {
  if (online.loading || online.refreshTimer || roomRefreshController || appView !== "multiplayer") return;
  void refreshRooms();
}

function scheduleNextRoomRefresh() {
  if (appView !== "multiplayer" || online.loading || online.refreshTimer || roomRefreshController) return;
  online.refreshTimer = window.setTimeout(() => {
    online.refreshTimer = null;
    if (appView === "multiplayer") void refreshRooms(false);
  }, 3000);
}

function stopRoomRefresh() {
  if (online.refreshTimer) window.clearTimeout(online.refreshTimer);
  online.refreshTimer = null;
  roomRefreshController?.abort();
  roomRefreshController = null;
}

async function refreshRooms(showLoading = true) {
  if (online.loading || roomRefreshController) return false;
  if (online.refreshTimer) window.clearTimeout(online.refreshTimer);
  online.refreshTimer = null;
  const controller = new AbortController();
  roomRefreshController = controller;
  const operation = {
    id: ++onlineRequestOperationSequence,
    kind: "refresh-rooms",
    promise: null
  };
  onlineRefreshOperation = operation;
  if (showLoading) beginOnlineOperationLoading(operation);
  try {
    const result = await fetchRooms({ signal: controller.signal });
    if (onlineRefreshOperation !== operation) return;
    online.rooms = result.rooms || [];
    online.lastRefresh = Date.now();
    online.error = "";
  } catch (error) {
    if (onlineRefreshOperation !== operation) return;
    if (error?.name !== "AbortError") online.error = error.message;
  } finally {
    if (roomRefreshController === controller) roomRefreshController = null;
    const ownsOperation = onlineRefreshOperation === operation;
    if (ownsOperation) {
      onlineRefreshOperation = null;
      if (showLoading) finishOnlineOperationLoading(operation);
    }
    // Release the loading guard before reserving the next poll, then render.
    // renderApp must see the timer or it immediately starts another request.
    scheduleNextRoomRefresh();
    if (ownsOperation && appView === "multiplayer" && !controller.signal.aborted) render();
  }
  return true;
}

async function connectDefaultMultiplayer() {
  if (diagnosticNavigationBlocked() || !bugReportDecisionResolved() || online.loading) return;
  const operation = {
    id: ++onlineRequestOperationSequence,
    kind: "connect-default",
    generation: onlineSessionGeneration,
    diagnosticRecorder: gameDiagnostic,
    startView: appView,
    ownedView: appView
  };
  beginOnlineOperationLoading(operation);
  onlineRefreshOperation = operation;
  online.error = "";
  let timeout = null;
  try {
    const server = await defaultMultiplayerServer();
    if (!connectDefaultMultiplayerOperationOwnsState(operation)
      || !connectDefaultMultiplayerMayNavigate(operation)) return;
    configureOnlineServer(server);
    render();
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 8000);
    const result = await fetchRooms({ signal: controller.signal });
    if (!connectDefaultMultiplayerOperationOwnsState(operation)
      || !connectDefaultMultiplayerMayNavigate(operation)) return;
    online.rooms = result.rooms || [];
    online.lastRefresh = Date.now();
    operation.ownedView = "multiplayer";
    appView = "multiplayer";
  } catch (error) {
    if (!connectDefaultMultiplayerOperationOwnsState(operation)
      || !connectDefaultMultiplayerMayNavigate(operation)) return;
    configureOnlineServer("");
    online.error = error?.name === "AbortError"
      ? (locale() === LOCALES.KO ? "멀티플레이 서버 연결 시간이 초과되었습니다." : "Multiplayer server connection timed out.")
      : (locale() === LOCALES.KO ? `멀티플레이 서버에 연결하지 못했습니다: ${error.message}` : `Could not connect to the multiplayer server: ${error.message}`);
    operation.ownedView = "menu";
    appView = "menu";
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    const mayRenderOwnedView = connectDefaultMultiplayerOperationOwnsState(operation)
      && appView === operation.ownedView;
    if (onlineRefreshOperation === operation) onlineRefreshOperation = null;
    const releasedLoading = finishOnlineOperationLoading(operation);
    if (mayRenderOwnedView && releasedLoading) {
      if (appView === "multiplayer") scheduleNextRoomRefresh();
      render();
    }
  }
}

function connectDefaultMultiplayerOperationOwnsState(operation) {
  return onlineRefreshOperation === operation
    && operation?.generation === onlineSessionGeneration
    && operation.diagnosticRecorder === gameDiagnostic;
}

function connectDefaultMultiplayerMayNavigate(operation) {
  return connectDefaultMultiplayerOperationOwnsState(operation)
    && appView === operation.ownedView
    && bugReportDecisionResolved()
    && !diagnosticNavigationBlocked();
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
  // EventSource can already have a callback queued when close() runs. Invalidate
  // that callback before closing the transport so it cannot restore a seat or
  // diagnostic that the user has just discarded while leaving a finished game.
  onlineEventGeneration += 1;
  const events = online.events;
  online.events = null;
  events?.close();
}

function resetStaleOnlineSeat(message) {
  const recoveredDiagnosticFailed = failRestoredOnlineDiagnosticRecovery({
    recoveryFailure: "stale-room",
    message: boundedUiErrorText(message, 1024, "The saved online room is no longer available.")
  });
  if (!recoveredDiagnosticFailed
    && currentDiagnosticSnapshot()?.finalization
    && !bugReportDecisionResolved()) {
    bugReportUi.recovered = true;
  }
  cancelOnlineSeatRequestOperation();
  invalidateOnlineSession();
  closeOnlineEvents();
  onlineSelectedCardId = null;
  onlineDiagnosticGameKey = "";
  pendingOnlineDiagnosticStart = null;
  online.mode = "offline";
  online.roomId = "";
  online.playerId = "";
  online.playerToken = "";
  online.diagnosticGameId = "";
  online.gameNumber = null;
  online.room = null;
  online.commandPending = null;
  online.error = message;
  localStorage.removeItem(ONLINE_STORAGE_KEY);
  appView = recoveredDiagnosticFailed || diagnosticNavigationBlocked() ? "menu" : "multiplayer";
  if (appView === "multiplayer") refreshRooms(false);
}

function onlineDiagnosticDescriptor(snapshot) {
  const roomId = String(snapshot?.room?.roomId || online.roomId || "");
  const gameNumber = Number(snapshot?.match?.gameNumber) || 1;
  const diagnosticGameId = String(
    snapshot?.room?.diagnosticGameId
    || snapshot?.match?.diagnosticGameId
    || snapshot?.diagnosticGameId
    || ""
  );
  return {
    key: diagnosticGameId ? `diagnostic:${diagnosticGameId}` : `${roomId}:game:${gameNumber}`,
    roomId,
    gameNumber,
    diagnosticGameId,
    sideboardingEnabled: Boolean(snapshot?.room?.sideboardingEnabled)
  };
}

function retireOnlineCommandPendingForDescriptor(descriptor) {
  const pending = online.commandPending;
  if (!pending) return false;
  const sameSession = pending.sessionGeneration === onlineSessionGeneration
    && pending.roomId === descriptor?.roomId;
  if (sameSession && pending.diagnosticIdentityCaptured !== true) return false;
  if (sameSession && onlineDiagnosticIdentityMatchesDescriptor(pending, descriptor)) return false;
  online.commandPending = null;
  return true;
}

function currentDiagnosticSnapshot() {
  try {
    return gameDiagnostic?.summary?.() || gameDiagnostic?.snapshot?.() || null;
  } catch {
    return null;
  }
}

function diagnosticMatchesOnlineDescriptor(log, descriptor) {
  const metadata = log?.metadata || {};
  if (metadata.mode !== "online") return false;
  if (String(metadata.roomId || "") !== descriptor.roomId) return false;
  const logDiagnosticGameId = String(metadata.diagnosticGameId || "");
  const descriptorDiagnosticGameId = String(descriptor.diagnosticGameId || "");
  if (logDiagnosticGameId || descriptorDiagnosticGameId) {
    return Boolean(logDiagnosticGameId)
      && Boolean(descriptorDiagnosticGameId)
      && logDiagnosticGameId === descriptorDiagnosticGameId;
  }
  const logGameNumber = Number(metadata.gameNumber);
  const descriptorGameNumber = Number(descriptor.gameNumber);
  return Number.isInteger(logGameNumber)
    && Number.isInteger(descriptorGameNumber)
    && logGameNumber > 0
    && logGameNumber === descriptorGameNumber;
}

function recoveredDiagnosticNeedsOnlineStop(log, descriptor) {
  if (!diagnosticMatchesOnlineDescriptor(log, descriptor) || game?.phase === "complete") return false;
  const finalization = log?.finalization;
  return finalization?.reason === GAME_REPRODUCTION_END_REASONS.UI_ERROR
    && finalization.details?.stopRequestAccepted !== true
    && finalization.details?.serverStopConfirmed !== true
    && finalization.details?.locallyPreservedOnly !== true
    && (finalization.details?.recoveredAfterAppRestart === true
      || finalization.details?.bootstrapCrash === true);
}

function stagePendingOnlineDiagnostic(snapshot, descriptor) {
  pendingOnlineDiagnosticStart = { snapshot, descriptor };
  bugReportUi.recovered = true;
  appView = "menu";
}

function startPendingOnlineDiagnosticIfReady() {
  if (!pendingOnlineDiagnosticStart || !bugReportDecisionResolved()) return false;
  const pending = pendingOnlineDiagnosticStart;
  pendingOnlineDiagnosticStart = null;
  if (pending.snapshot?.game) game = pending.snapshot.game;
  onlineDiagnosticGameKey = pending.descriptor.key;
  beginGameDiagnostic("online", {
    roomId: pending.descriptor.roomId,
    gameNumber: pending.descriptor.gameNumber,
    diagnosticGameId: pending.descriptor.diagnosticGameId || null,
    sideboardingEnabled: pending.descriptor.sideboardingEnabled
  });
  recordDiagnosticOnlineSnapshot(pending.snapshot);
  appView = "game";
  return true;
}

function connectOnlineEvents() {
  if (!online.roomId || !online.playerToken) return;
  prepareOnlineGameMode();
  closeOnlineEvents();
  const eventGeneration = onlineEventGeneration;
  online.events = openRoomEvents(online.roomId, online.playerToken, {
    open() {
      if (eventGeneration !== onlineEventGeneration) return;
      online.error = "";
      if (appView === "multiplayer" || appView === "game") render();
    },
    snapshot(snapshot) {
      if (eventGeneration !== onlineEventGeneration) return;
      const selectedBeforeSnapshot = onlineSelectedCardId || game?.selectedCardId || null;
      online.room = snapshot.room;
      online.match = snapshot.match || null;
      online.playerId = snapshot.playerId;
      syncOnlineSideboardDraft();
      online.mode = "online";
      online.diagnosticGameId = String(
        snapshot?.room?.diagnosticGameId
        || snapshot?.match?.diagnosticGameId
        || snapshot?.diagnosticGameId
        || ""
      );
      const snapshotGameNumber = Number(snapshot?.match?.gameNumber);
      online.gameNumber = Number.isInteger(snapshotGameNumber) && snapshotGameNumber > 0
        ? snapshotGameNumber
        : null;
      saveOnlineSeat();
      if (snapshot.game) {
        const descriptor = onlineDiagnosticDescriptor(snapshot);
        retireOnlineCommandPendingForDescriptor(descriptor);
        const diagnosticKey = descriptor.key;
        const emergencyOwner = emergencyStopOwner;
        const emergencyOwnerIsCurrent = emergencyReportActive
          && ["stopping", "failed"].includes(emergencyStopState)
          && emergencyStopOwnerIsCurrent(emergencyOwner);
        const emergencyOwnerMatchesIncomingGame = emergencyOwnerIsCurrent
          && onlineDiagnosticIdentityMatchesDescriptor(emergencyOwner, descriptor);
        if (emergencyOwnerIsCurrent && !emergencyOwnerMatchesIncomingGame) {
          // Preserve the old game's recorder before replacing the global game
          // with a snapshot belonging to a different diagnostic identity.
          retireEmergencyOnlineStopOwner("diagnostic-changed");
        }
        game = snapshot.game;
        onlineSnapshotRevision += 1;
        if (emergencyReportActive
          && ["stopping", "failed"].includes(emergencyStopState)
          && game.phase === "complete"
          && emergencyOwnerMatchesIncomingGame) {
          const diagnosticStateRecorded = recordDiagnosticOnlineSnapshot(snapshot, { deferFinalization: true });
          confirmEmergencyOnlineStopFromSnapshot(emergencyOwner, descriptor, diagnosticStateRecorded);
          online.error = "";
          return;
        }
        if (pendingOnlineDiagnosticStart) {
          pendingOnlineDiagnosticStart = { snapshot, descriptor };
          online.error = "";
          render();
          return;
        }
        if (bugReportUi.recovered && !bugReportDecisionResolved()) {
          const restoredLog = currentDiagnosticSnapshot();
          if (recoveredDiagnosticNeedsOnlineStop(restoredLog, descriptor)) {
            onlineDiagnosticGameKey = diagnosticKey;
            recordDiagnosticOnlineSnapshot(snapshot);
            if (!recoveredOnlineStopRequested) {
              recoveredOnlineStopRequested = true;
              void stopGameAfterUiError(
                new Error("The app restarted before the online game was safely stopped."),
                "recovered online game"
              );
            }
          } else if (!diagnosticMatchesOnlineDescriptor(restoredLog, descriptor)) {
            stagePendingOnlineDiagnostic(snapshot, descriptor);
          } else {
            closeOnlineEvents();
          }
          online.error = "";
          render();
          return;
        }
        if (onlineDiagnosticRecoveryInProgress
          && restoredGameDiagnosticCanResume
          && gameDiagnostic
          && !gameDiagnostic.isFinalized?.()
          && !gameDiagnostic.summary?.().finalization) {
          const restoredLog = currentDiagnosticSnapshot();
          if (!diagnosticMatchesOnlineDescriptor(restoredLog, descriptor)) {
            failRestoredOnlineDiagnosticRecovery({
              recoveryFailure: "diagnostic-identity-mismatch",
              incomingDiagnosticGameId: descriptor.diagnosticGameId || null,
              incomingGameNumber: descriptor.gameNumber
            });
            stagePendingOnlineDiagnostic(snapshot, descriptor);
            online.error = "";
            render();
            return;
          }
          onlineDiagnosticGameKey = diagnosticKey;
          restoredGameDiagnosticCanResume = false;
          onlineDiagnosticRecoveryInProgress = false;
        } else if (onlineDiagnosticGameKey !== diagnosticKey
          || (currentDiagnosticSnapshot()?.finalization && game.phase !== "complete")) {
          if (!bugReportDecisionResolved()) {
            stagePendingOnlineDiagnostic(snapshot, descriptor);
            online.error = "";
            render();
            return;
          }
          onlineDiagnosticGameKey = diagnosticKey;
          beginGameDiagnostic("online", {
            roomId: descriptor.roomId,
            gameNumber: descriptor.gameNumber,
            diagnosticGameId: descriptor.diagnosticGameId || null,
            sideboardingEnabled: descriptor.sideboardingEnabled
          });
        }
        recordDiagnosticOnlineSnapshot(snapshot);
        if (!currentGameUiRenderIssue()) restoreOnlineSelection(selectedBeforeSnapshot);
        if (!emergencyReportActive) appView = "game";
      }
      online.error = "";
      if (emergencyReportActive) showEmergencyReportView();
      else render();
    },
    error(message) {
      if (eventGeneration !== onlineEventGeneration) return;
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

function setUiSelectedCard(cardId, { openInspector = true } = {}) {
  actionRejection = null;
  const before = game.selectedCardId;
  selectCard(game, cardId);
  if (game.selectedCardId !== before || game.selectedCardId === cardId) {
    inspectorPreviewCard = null;
    inspectedChainItemId = null;
    inspectedChainTargetIds.clear();
    if (isOnlineGame()) onlineSelectedCardId = game.selectedCardId;
    if (openInspector && game.selectedCardId === cardId) {
      inspectorOpen = true;
      closeTabletopSheets("inspector");
    }
  }
}

async function configureDiagnosticServer() {
  try {
    const response = await fetch("/build-info.json", { cache: "no-store" });
    clientBuildInfo = response.ok ? await response.json() : {};
  } catch {
    clientBuildInfo = {};
  }
  configureBugReportServer(configuredBugReportServer(clientBuildInfo));
  if (gameDiagnostic) {
    try {
      gameDiagnostic.recordEvent("client-build-configured", {
        build: clientBuildInfo,
        reportServerConfigured: Boolean(configuredBugReportServer(clientBuildInfo))
      }, game);
      persistGameDiagnostic();
    } catch {}
  }
}

function toggleUiSelectedCard(cardId) {
  const utilityOpen = Boolean(graveyardOpenPlayerId || banishedOpenPlayerId || intelOpenPlayerId || logOpen);
  if (cardId && game.selectedCardId === cardId && inspectorOpen && !utilityOpen) {
    game.selectedCardId = null;
    onlineSelectedCardId = null;
    inspectorOpen = false;
    inspectorPreviewCard = null;
    inspectedChainItemId = null;
    inspectedChainTargetIds.clear();
    attachmentsOpenCardId = null;
    actionRejection = null;
    return;
  }
  setUiSelectedCard(cardId, { openInspector: true });
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
  closeDeckTransferDialog();
  deckEditor.transferNotice = null;
  deckEditor.transferDialog = { mode: "import", text: "", error: "", notice: "" };
}

function openDeckExportDialog(deck) {
  if (!deck) return;
  closeDeckTransferDialog();
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

function deckImageTransferView(dialog) {
  const korean = dialog.locale === LOCALES.KO;
  return `
    <div class="deck-transfer-modal deck-image-modal">
      <section class="deck-image-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-image-title" aria-describedby="deck-image-description" data-ui-modal data-modal-key="deck-image" tabindex="-1">
        <div class="deck-transfer-heading">
          <div><span>RIFTBOUND ONLINE</span><h2 id="deck-image-title">${korean ? "덱 이미지 내보내기" : "Export Deck Image"}</h2></div>
          <button class="deck-transfer-close" data-action="deck-transfer-close" aria-label="${korean ? "닫기" : "Close"}">×</button>
        </div>
        <div class="deck-image-options">
          <p id="deck-image-description">${korean ? "중복 카드도 한 장씩, 룬은 종류별 아이콘과 개수로 표시합니다." : "Every card copy is shown individually. Runes use their icons and quantities."}</p>
          <label>${korean ? "카드 정렬" : "Card order"}<select id="deck-image-sort" data-action="deck-image-sort">${DECK_IMAGE_SORT_OPTIONS.map((option) => `<option value="${option.id}" ${dialog.sort === option.id ? "selected" : ""}>${korean ? option.ko : option.en}</option>`).join("")}</select></label>
          <small>${korean ? "메인 덱·사이드보드에 적용 · 유닛 → 도구 → 주문 · 낮은 코스트부터" : "Main & sideboard · Units → Gear → Spells · Lowest cost first"}</small>
          <div class="deck-image-champion-options">
            <label class="deck-image-champion-toggle" for="deck-image-champion-first"><input id="deck-image-champion-first" type="checkbox" data-action="deck-image-champion-first" ${dialog.championFirst ? "checked" : ""} ${dialog.championCandidates.length ? "" : "disabled"} />${korean ? "선택한 챔피언 1장을 맨 앞에" : "Show one chosen Champion first"}</label>
            ${!dialog.championCandidates.length ? `<small>${korean ? "메인 덱에 레전드와 일치하는 챔피언이 없습니다." : "No matching Champion in the Main Deck."}</small>` : dialog.championFirst ? dialog.championCandidates.length === 1
              ? `<small>${korean ? "자동 선택" : "Auto-selected"}: ${escapeHtml(translateCardName(dialog.championCandidates[0], dialog.locale))}</small>`
              : `<label>${korean ? "챔피언" : "Champion"}<select id="deck-image-champion" data-action="deck-image-champion" aria-required="true"><option value="">${korean ? "챔피언을 선택해 주세요" : "Choose a Champion"}</option>${dialog.championCandidates.map((card) => `<option value="${escapeHtml(card.cardNumber)}" ${dialog.championNumber === card.cardNumber ? "selected" : ""}>${escapeHtml(translateCardName(card, dialog.locale))} · ${escapeHtml(card.cardNumber)}</option>`).join("")}</select></label>` : ""}
          </div>
        </div>
        <div class="deck-image-preview" data-scroll-key="deck-image-preview" aria-busy="${dialog.loading}">
          ${dialog.url
            ? `<img src="${dialog.url}" alt="${escapeHtml(dialog.name)} ${korean ? "덱 이미지 미리보기" : "deck image preview"}" width="${dialog.width}" height="${dialog.height}" />`
            : `<div class="deck-image-placeholder"><span class="deck-image-emblem" aria-hidden="true">◇</span><p data-deck-image-progress role="status">${escapeHtml(dialog.progress || (korean ? "이미지를 준비하고 있습니다…" : "Preparing image…"))}</p></div>`}
        </div>
        <div class="deck-image-feedback" aria-live="polite">
          ${dialog.error ? `<p class="deck-transfer-message error" role="alert">${escapeHtml(dialog.error)}</p>` : ""}
          ${dialog.missing?.length ? `<p class="deck-transfer-message error" role="alert">${korean ? "일부 카드 이미지를 불러오지 못해 카드 이름으로 표시했습니다" : "Some images could not load and show card names instead"}: ${escapeHtml(dialog.missing.map((card) => translateCardName(card, dialog.locale)).join(", "))}</p>` : ""}
          ${dialog.url ? `<span>${dialog.width} × ${dialog.height} · PNG</span>` : ""}
        </div>
        <div class="actions">
          <button data-action="deck-transfer-close">${korean ? "닫기" : "Close"}</button>
          ${dialog.error || dialog.missing?.length ? `<button data-action="deck-image-retry">${korean ? "이미지 다시 불러오기" : "Retry Images"}</button>` : ""}
          <button class="primary" data-action="deck-image-download" ${dialog.url ? "" : "disabled"}>${korean ? "PNG 저장" : "Save PNG"}</button>
        </div>
      </section>
    </div>`;
}

function closeDeckTransferDialog() {
  const dialog = deckEditor.transferDialog;
  dialog?.controller?.abort();
  if (dialog?.url) URL.revokeObjectURL(dialog.url);
  deckEditor.transferDialog = null;
}

async function openDeckImageDialog(deck = getSelectedDeckRecord()) {
  if (!deck) return;
  closeDeckTransferDialog();
  const championCandidates = deckImageChampionCandidates(deck, { cardByNumber });
  const rememberedChampion = deckEditor.imageChampionSelections.get(deck.id);
  const championNumber = championCandidates.length === 1 ? championCandidates[0].cardNumber
    : championCandidates.some((card) => card.cardNumber === rememberedChampion) ? rememberedChampion : "";
  const dialog = {
    mode: "image", locale: locale(), name: localizedDeckName(deck.name), sort: deckEditor.imageSort,
    championCandidates, championNumber, championFirst: deckEditor.imageChampionFirst && championCandidates.length > 0,
    deck: structuredClone(deck), controller: new AbortController(), loading: true,
    progress: "", error: "", url: "", missing: []
  };
  deckEditor.transferDialog = dialog;
  try {
    if (dialog.championFirst && !dialog.championNumber) {
      dialog.progress = dialog.locale === LOCALES.KO ? "맨 앞에 표시할 챔피언을 선택해 주세요." : "Choose the Champion to show first.";
      return;
    }
    const model = deckImageModel({ ...dialog.deck, name: dialog.name }, {
      cardByNumber, runeByKey: (key) => cardByNumber(key) || makeRune(key), locale: dialog.locale, sort: dialog.sort,
      championFirst: dialog.championFirst, championNumber: dialog.championNumber
    });
    // Packaged mobile builds use the configured server; desktop/web serve this API locally.
    const base = window.Capacitor?.isNativePlatform?.() ? await defaultMultiplayerServer() : "";
    const result = await renderDeckImage(model, {
      signal: dialog.controller.signal,
      imageUrl: (card) => `${base}/api/deck-card-image?${new URLSearchParams({ card: card.cardNumber, locale: dialog.locale })}`,
      onProgress: (completed, total) => {
        if (deckEditor.transferDialog !== dialog) return;
        dialog.progress = dialog.locale === LOCALES.KO ? `카드 이미지를 불러오고 있습니다… ${completed} / ${total}` : `Loading card images… ${completed} / ${total}`;
        const progress = app.querySelector("[data-deck-image-progress]");
        if (progress) progress.textContent = dialog.progress;
      }
    });
    if (deckEditor.transferDialog !== dialog) return;
    Object.assign(dialog, result, { blob: undefined, url: URL.createObjectURL(result.blob) });
  } catch (error) {
    if (deckEditor.transferDialog !== dialog || dialog.controller.signal.aborted) return;
    dialog.error = dialog.locale === LOCALES.KO ? `덱 이미지를 만들지 못했습니다: ${error.message}` : `Could not create deck image: ${error.message}`;
    dialog.progress = dialog.locale === LOCALES.KO ? "이미지를 다시 불러와 주세요." : "Please retry loading the image.";
  } finally {
    dialog.loading = false;
    if (deckEditor.transferDialog === dialog && appView === "decks") {
      render();
    }
  }
}

function downloadDeckImage() {
  const dialog = deckEditor.transferDialog;
  if (dialog?.mode !== "image" || !dialog.url) return;
  const link = document.createElement("a");
  link.href = dialog.url;
  link.download = deckImageFilename(dialog.name);
  document.body.append(link);
  link.click();
  link.remove();
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
    closeDeckTransferDialog();
    deckEditor.transferNotice = {
      tone: "success",
      message: locale() === LOCALES.KO
        ? "붙여넣은 텍스트로 새 덱을 만들었습니다."
        : "Created a new deck from the pasted text."
    };
    saveDeckStore();
  } catch (error) {
    const details = deckImportErrorSummary(error);
    if (deckEditor.transferDialog?.mode === "import") {
      deckEditor.transferDialog.error = locale() === LOCALES.KO
        ? `덱을 가져오지 못했습니다: ${details}`
        : `Could not import the deck: ${details}`;
      deckEditor.transferDialog.notice = "";
    }
  }
}

function deckImportErrorSummary(error) {
  const issues = Array.isArray(error?.issues) && error.issues.length
    ? error.issues.map(String)
    : [String(error?.message || error)];
  const visibleIssues = issues.slice(0, 3);
  const remaining = issues.length - visibleIssues.length;
  const separator = locale() === LOCALES.KO ? " / " : " · ";
  const suffix = remaining > 0
    ? (locale() === LOCALES.KO
      ? ` / 이외 오류 ${remaining}개가 있습니다. 위 오류부터 수정해 주세요.`
      : ` · ${remaining} more error${remaining === 1 ? "" : "s"}. Fix the errors above first.`)
    : "";
  return `${visibleIssues.join(separator)}${suffix}`;
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
    if (deckEditor.type !== "all" && !cardHasType(card, deckEditor.type)) return false;
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

function uiCardEffects(card) {
  if (!Array.isArray(card?.effects)) return [];
  return card.effects.filter((effect) => effect && typeof effect === "object");
}

function cardAllowsUnlimitedCopies(card) {
  return uiCardEffects(card).some((effect) => effect.timing === "static" && effect.kind === "unlimitedDeckCopies");
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
  cancelReplayAnalyses();
  cardDragRenderPending = false;
  clearCardDragPresentation();
  clearRuneScrollGesture();
  clearRunePowerHold();
  cancelScheduledAiTurn();
  resetAiTurnWorkerSession();
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
  inspectorPreviewCard = null;
  attachmentsOpenCardId = null;
  inspectorOpen = false;
  stagedChoiceKey = null;
  stagedChoiceOptionId = null;
  choiceDrawerCollapsed = false;
  suppressCardClickUntil = 0;
  suppressRuneClickUntil = 0;
  suppressRunePowerContextMenuUntil = 0;
  pendingGameExit = null;
  lastViewerPlayerId = null;
  lastInteractionPhase = null;
  paymentRunesScrollLeft = 0;
  handScrollLeft = 0;
  clearViewerTransientPresentation();
  resultRevealReady = true;
  resultDismissed = false;
  moveSelection.clear();
}

function matchIsBetweenGames() {
  const match = isOnlineGame() ? online.match : localMatch;
  return Boolean(match && [
    "initial-sideboarding",
    "sideboarding",
    "between-games",
    "ready-initial-game",
    "ready-next-game"
  ].includes(match.phase));
}

function initialSideboardingActive(match = activeBetweenGamesMatch()) {
  return Boolean(match?.initialSideboarding || ["initial-sideboarding", "ready-initial-game"].includes(match?.phase));
}

function revealedSetupBattlefields(candidate = game) {
  return Object.fromEntries((candidate?.players || []).map((player) => {
    const selected = (candidate?.battlefields || []).find((field) =>
      field?.ownerId === player.id || field?.instanceId === player.selectedBattlefieldId);
    return [player.id, selected?.cardNumber || selected?.collectorNumber || null];
  }));
}

function enterInitialLocalSideboardingIfNeeded() {
  if (!localMatch || game?.phase !== "sideboarding" || localMatch.phase !== "playing") return false;
  const result = beginInitialSideboarding(localMatch, {
    firstPlayerId: game.firstPlayerId,
    battlefields: revealedSetupBattlefields(game)
  });
  if (!result.ok) {
    actionRejection = localizedCommandFailure(result.message);
    return false;
  }
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardBaselines = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardPlayerId = "p1";
  sideboardPreviewNumber = null;
  sideboardValidationMessages = [];
  return true;
}

function syncOnlineSideboardDraft() {
  const match = online.match;
  const acceptingDraft = ["initial-sideboarding", "sideboarding", "between-games"].includes(match?.phase);
  if (!acceptingDraft || !match?.currentDeck || !online.playerId) {
    onlineSideboardDraft = null;
    onlineSideboardBaseline = null;
    onlineSideboardDraftKey = "";
    return;
  }
  const key = `${online.roomId}:${match.gameNumber}:${online.playerId}:${initialSideboardingActive(match) ? "initial" : "between"}`;
  if (onlineSideboardDraftKey === key && onlineSideboardDraft) return;
  onlineSideboardDraftKey = key;
  onlineSideboardDraft = structuredClone(match.currentDeck);
  onlineSideboardBaseline = structuredClone(match.currentDeck);
  sideboardPreviewNumber = null;
  sideboardValidationMessages = [];
}

function recordLocalGameIfComplete() {
  if (game.phase === "complete") ensureGameDiagnosticFinalized();
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
  sideboardBaselines = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardPlayerId = "p1";
  sideboardPreviewNumber = null;
  sideboardValidationMessages = [];
  resultDismissed = true;
}

function activeBetweenGamesMatch() {
  return isOnlineGame() ? online.match : localMatch;
}

function sideboardingView() {
  const match = activeBetweenGamesMatch();
  const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
  const playerIndex = playerId === "p2" ? 1 : 0;
  const draft = isOnlineGame() ? onlineSideboardDraft : sideboardDrafts[playerIndex];
  const baseline = isOnlineGame() ? onlineSideboardBaseline : sideboardBaselines[playerIndex];
  const submitted = Boolean(match?.submissions?.[playerId]);
  const initial = initialSideboardingActive(match);
  const editable = ["initial-sideboarding", "sideboarding"].includes(match?.phase) && !submitted;
  const wins = match?.wins || { p1: 0, p2: 0 };
  if (!draft) return `<main class="shell-screen sideboarding-screen"><p class="empty">${locale() === LOCALES.KO ? "사이드보드 정보를 기다리고 있습니다." : "Waiting for sideboard data."}</p></main>`;
  const exchange = sideboardExchangeSummary(baseline, draft);
  const validation = sideboardDraftValidation(match, playerIndex, baseline, draft, exchange);
  const changed = exchange.out > 0 || exchange.in > 0;
  const visibleMessages = [...new Set([...sideboardValidationMessages, ...validation.messages])];
  return `
    <main class="shell-screen sideboarding-screen">
      <section class="sideboarding-shell ${initial ? "initial-sideboarding-shell" : ""}">
        <header class="sideboarding-head">
          <div>
            <p class="eyebrow visible">${initial
              ? (locale() === LOCALES.KO ? "단판 대회 변경 절차 · 챔피언 공개 전" : "Single-game tournament procedure · before Champion reveal")
              : (locale() === LOCALES.KO ? `게임 ${match?.gameNumber || 1} 종료` : `Game ${match?.gameNumber || 1} complete`)}</p>
            <h1>${locale() === LOCALES.KO ? "사이드보딩" : "Sideboarding"}</h1>
            <p>${initial
              ? (locale() === LOCALES.KO ? "공개된 전설·무작위 전장·선후공을 확인하고 덱을 조정하세요. 선택된 챔피언은 양쪽 확정 후 동시에 공개됩니다." : "Review the revealed Legends, random Battlefields, and play order, then adjust your deck. Chosen Champions are revealed together after both players lock in.")
              : match?.lastGameWasDraw
                ? (locale() === LOCALES.KO ? "이전 선후공은 유지되고 무승부 전장은 다시 선택할 수 있습니다. 주 덱과 사이드 카드를 같은 수만큼 교환해 주세요." : "The previous play order is retained and Battlefields from the drawn game remain available. Exchange the same number of Main Deck and Sideboard cards.")
                : (locale() === LOCALES.KO ? "주 덱 카드와 사이드 카드를 같은 수만큼 교환해 주세요." : "Exchange the same number of Main Deck and Sideboard cards.")}</p>
          </div>
          ${initial ? "" : `<div class="match-score"><strong>${locale() === LOCALES.KO ? "플레이어 1" : "P1"} ${wins.p1}</strong><span>:</span><strong>${wins.p2} ${locale() === LOCALES.KO ? "플레이어 2" : "P2"}</strong></div>`}
        </header>
        <div class="sideboarding-context">
          ${initial ? initialSideboardingSetupSummary() : gameBugReportPanel()}
          ${!initial && !bugReportDecisionResolved() ? `<p class="game-bug-report-gate">${locale() === LOCALES.KO ? "다음 게임으로 진행하려면 먼저 로그 전송 여부를 선택해 주세요." : "Choose whether to send the log before continuing to the next game."}</p>` : ""}
        </div>
        <div class="sideboarding-player-banner">${isOnlineGame() ? (locale() === LOCALES.KO ? "내 사이드보드" : "Your sideboard") : `${playerId.toUpperCase()} · ${locale() === LOCALES.KO ? "다른 플레이어는 화면을 보지 마세요" : "Other player, please look away"}`}</div>
        <div class="sideboarding-grid">
          <section class="sideboarding-column">
            <div class="deck-zone-title"><strong>${t("mainDeck", locale())}</strong><span>${mainDeckCount(draft)}/${DECK_RULES.tournamentMainExact}</span></div>
            <p class="deck-note">${locale() === LOCALES.KO ? "화살표로 한 장씩 사이드 아웃합니다. 카드 영역을 누르면 정보를 봅니다." : "Use the arrow to side out one copy. Select the card area to inspect it."}</p>
            <div class="sideboarding-card-list">${(draft.main || []).map(([number, count]) => sideboardCardRow(number, count, "main", !editable, draft)).join("")}</div>
          </section>
          <section class="sideboarding-column">
            <div class="deck-zone-title"><strong>${locale() === LOCALES.KO ? "사이드보드" : "Sideboard"}</strong><span>${sideboardCount(draft)}/${DECK_RULES.sideboardMax}</span></div>
            <p class="deck-note">${locale() === LOCALES.KO ? "화살표로 한 장씩 사이드 인합니다. 어느 쪽부터 옮겨도 됩니다." : "Use the arrow to side in one copy. You may move cards in either order."}</p>
            <div class="sideboarding-card-list">${(draft.sideboard || []).map(([number, count]) => sideboardCardRow(number, count, "sideboard", !editable, draft)).join("") || `<p class="empty">${locale() === LOCALES.KO ? "등록된 사이드 카드가 없습니다." : "No registered Sideboard cards."}</p>`}</div>
          </section>
        </div>
        <div class="sideboarding-status">
          <div class="sideboarding-exchange-summary" aria-live="polite">
            <span>${locale() === LOCALES.KO ? "사이드 아웃" : "Side out"} <strong>${exchange.out}</strong></span>
            <span>${locale() === LOCALES.KO ? "사이드 인" : "Side in"} <strong>${exchange.in}</strong></span>
            <span class="${validation.playable ? "valid" : "invalid"}">${validation.playable ? (locale() === LOCALES.KO ? "플레이 규약 충족" : "Deck is legal") : (locale() === LOCALES.KO ? "확정 전 수정 필요" : "Changes required before lock-in")}</span>
          </div>
          ${visibleMessages.length ? `<div class="sideboarding-validation" role="alert">${visibleMessages.map((message) => `<p>${escapeHtml(sideboardValidationMessage(message))}</p>`).join("")}</div>` : ""}
        </div>
        <div class="sideboarding-actions">
          ${initial ? `<button class="secondary" data-action="exit-pregame-sideboarding">${isOnlineGame() ? (locale() === LOCALES.KO ? "로비로 돌아가기" : "Return to lobby") : (locale() === LOCALES.KO ? "메인 메뉴" : "Main menu")}</button>` : `<button class="secondary" data-action="exit-completed-game">${completedGameExitLabel()}</button>`}
          <button class="secondary" data-action="sideboard-reset" ${!editable || !changed ? "disabled" : ""}>${locale() === LOCALES.KO ? "변경 초기화" : "Reset changes"}</button>
          <button class="primary" data-action="sideboard-submit" ${submitted || !validation.playable || (!initial && !bugReportDecisionResolved()) ? "disabled" : ""}>${submitted ? (locale() === LOCALES.KO ? "상대 준비 대기 중" : "Waiting for opponent") : changed ? (locale() === LOCALES.KO ? "사이드보딩 확정" : "Lock in sideboard") : (locale() === LOCALES.KO ? "사이드보딩 건너뛰기" : "Skip sideboarding")}</button>
        </div>
        ${sideboardCardPreview()}
      </section>
    </main>
  `;
}

function sideboardCardRow(number, count, zone, disabled, draft) {
  const card = cardByNumber(number);
  if (!card) return "";
  const legend = cardByNumber(draft?.legend);
  const championCandidate = isChampionDeckCard(card) && championMatchesLegend(card, legend);
  const direction = zone === "main" ? "→" : "←";
  const label = zone === "main"
    ? (locale() === LOCALES.KO ? `${cardName(card)} 한 장 사이드 아웃` : `Side out one ${cardName(card)}`)
    : (locale() === LOCALES.KO ? `${cardName(card)} 한 장 사이드 인` : `Side in one ${cardName(card)}`);
  return `
    <div class="sideboarding-card-row ${sideboardPreviewNumber === number ? "selected" : ""}">
      <button class="sideboarding-card-info" data-action="sideboard-view-card" data-card-number="${escapeHtml(number)}" aria-label="${escapeHtml(`${cardName(card)} ${locale() === LOCALES.KO ? "카드 정보" : "card information"}`)}">
        <em>x${count}</em>
        ${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="" loading="lazy" />` : `<span class="deck-card-back"></span>`}
        <span><strong>${escapeHtml(cardName(card))}</strong><small>${escapeHtml(cardType(card))}${championCandidate ? ` · ${locale() === LOCALES.KO ? "챔피언 후보" : "Champion candidate"}` : ""}</small></span>
      </button>
      <button class="sideboarding-transfer" data-action="sideboard-move" data-from-zone="${zone}" data-card-number="${escapeHtml(number)}" aria-label="${escapeHtml(label)}" ${disabled ? "disabled" : ""}>${direction}</button>
    </div>`;
}

function moveSideboardCard(draft, number, fromZone) {
  const source = fromZone === "main" ? draft?.main : draft?.sideboard;
  const destination = fromZone === "main" ? draft?.sideboard : draft?.main;
  if (!Array.isArray(source) || !Array.isArray(destination) || cardCount(source, number) < 1) return false;
  setCountEntry(source, number, cardCount(source, number) - 1);
  setCountEntry(destination, number, cardCount(destination, number) + 1);
  return true;
}

function sideboardExchangeSummary(baseline, draft) {
  const original = new Map(Array.isArray(baseline?.main) ? baseline.main : []);
  const current = new Map(Array.isArray(draft?.main) ? draft.main : []);
  const numbers = new Set([...original.keys(), ...current.keys()]);
  let out = 0;
  let inside = 0;
  for (const number of numbers) {
    const delta = (current.get(number) || 0) - (original.get(number) || 0);
    if (delta < 0) out += -delta;
    if (delta > 0) inside += delta;
  }
  return { out, in: inside };
}

function sideboardDraftValidation(match, playerIndex, baseline, draft, exchange) {
  const registered = !isOnlineGame() ? match?.registeredDecks?.[playerIndex] : baseline;
  const result = registered && draft
    ? validateSideboardConfiguration(registered, draft, cardByNumber)
    : { playable: false, messages: ["Sideboard data is unavailable."] };
  const messages = [...result.messages];
  if (exchange.out !== exchange.in) messages.unshift(`Sideboard in and sideboard out counts must match (${exchange.in}/${exchange.out}).`);
  return { playable: messages.length === 0, messages };
}

function sideboardValidationMessage(message) {
  const raw = String(message || "").trim();
  if (locale() !== LOCALES.KO || !raw) return raw;
  const mainCount = raw.match(/^A tournament Main Deck must contain exactly (\d+) cards\. It currently contains (\d+)\.$/);
  if (mainCount) return `대회용 주 덱은 정확히 ${mainCount[1]}장이어야 합니다. 현재 ${mainCount[2]}장입니다.`;
  const sideboardLimit = raw.match(/^Sideboard can contain at most (\d+) cards\. It currently contains (\d+)\.$/);
  if (sideboardLimit) return `사이드보드는 최대 ${sideboardLimit[1]}장까지 넣을 수 있습니다. 현재 ${sideboardLimit[2]}장입니다.`;
  const exchange = raw.match(/^Sideboard in and sideboard out counts must match \((\d+)\/(\d+)\)\.$/);
  if (exchange) return `사이드 인과 사이드 아웃 매수가 같아야 합니다. 현재 사이드 인 ${exchange[1]}장, 사이드 아웃 ${exchange[2]}장입니다.`;
  if (raw === "At least one matching Champion Unit is required in the Main Deck.") {
    return "전설과 일치하는 챔피언 유닛을 주 덱에 최소 1장 남겨야 합니다.";
  }
  const feedback = localizedCommandFailure(raw);
  return feedback?.detail || feedback?.title || raw;
}

function initialSideboardingSetupSummary() {
  const firstPlayerId = game?.firstPlayerId;
  const sideboardViewerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
  return `
    <section class="sideboarding-setup-summary" aria-label="${locale() === LOCALES.KO ? "공개된 경기 준비 정보" : "Revealed game setup"}">
      ${(game?.players || []).map((player) => {
        const field = (game?.battlefields || []).find((candidate) =>
          candidate?.ownerId === player.id || candidate?.instanceId === player.selectedBattlefieldId);
        const order = player.id === firstPlayerId
          ? (locale() === LOCALES.KO ? "선공" : "First")
          : (locale() === LOCALES.KO ? "후공" : "Second");
        return `<article class="sideboarding-setup-player ${player.id === sideboardViewerId ? "mine" : "opponent"}">
          <header><strong>${escapeHtml(playerName(player))}</strong><span>${order}</span></header>
          <div>${sideboardingSetupCard(player.legend, locale() === LOCALES.KO ? "전설" : "Legend")}${sideboardingSetupCard(field, locale() === LOCALES.KO ? "무작위 전장" : "Random Battlefield")}
            <div class="sideboarding-setup-pending"><small>${locale() === LOCALES.KO ? "선택된 챔피언" : "Chosen Champion"}</small><strong>${locale() === LOCALES.KO ? "사이드보딩 후 공개" : "Revealed after sideboarding"}</strong></div>
          </div>
        </article>`;
      }).join("")}
    </section>`;
}

function sideboardingSetupCard(card, label) {
  if (!card || card.redacted) return `<div class="sideboarding-setup-card unavailable"><small>${escapeHtml(label)}</small><strong>${t("waiting", locale())}</strong></div>`;
  return `<button class="sideboarding-setup-card" data-action="sideboard-view-card" data-card-number="${escapeHtml(card.cardNumber || card.collectorNumber || "")}">
    <small>${escapeHtml(label)}</small>${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="" />` : ""}<strong>${escapeHtml(cardName(card))}</strong>
  </button>`;
}

function sideboardCardPreview() {
  const card = cardByNumber(sideboardPreviewNumber);
  if (!card) return "";
  return `<aside class="sideboarding-card-preview" role="dialog" aria-modal="false" aria-label="${escapeHtml(cardName(card))}">
    <button class="sideboarding-preview-close" data-action="sideboard-close-card" aria-label="${locale() === LOCALES.KO ? "카드 정보 닫기" : "Close card information"}">×</button>
    ${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="${escapeHtml(cardName(card))}" />` : ""}
    <div><h2>${escapeHtml(cardName(card))}</h2><p>${escapeHtml(cardTags(card).join(" · "))}</p><div class="sideboarding-card-rules">${escapeHtml(cardText(card))}</div></div>
  </aside>`;
}

async function submitSideboardDraft() {
  const match = activeBetweenGamesMatch();
  const initial = initialSideboardingActive(match);
  if (!initial && !bugReportDecisionResolved()) {
    bugReportUi.error = locale() === LOCALES.KO
      ? "다음 게임 전에 이 경기의 로그 전송 여부를 선택해 주세요."
      : "Choose whether to send this game's log before the next game.";
    render();
    return;
  }
  const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
  const index = playerId === "p2" ? 1 : 0;
  const draft = isOnlineGame() ? onlineSideboardDraft : sideboardDrafts[index];
  const baseline = isOnlineGame() ? onlineSideboardBaseline : sideboardBaselines[index];
  const exchange = sideboardExchangeSummary(baseline, draft);
  const validation = sideboardDraftValidation(match, index, baseline, draft, exchange);
  if (!validation.playable) {
    sideboardValidationMessages = validation.messages;
    render();
    return;
  }
  sideboardValidationMessages = [];
  if (isOnlineGame()) {
    dispatchGameCommand({ kind: "submitSideboard", deckRecord: draft });
    return;
  }
  const result = submitSideboardConfiguration(localMatch, playerId, draft, cardByNumber);
  if (!result.ok) { recentFeedback = { tone: "error", message: result.message }; return; }
  if (aiMode && playerId === "p1") {
    submitSideboardConfiguration(localMatch, "p2", sideboardDrafts[1], cardByNumber);
  } else if (!localMatch.submissions.p2) {
    sideboardPlayerId = "p2";
    sideboardPreviewNumber = null;
    sideboardValidationMessages = [];
  }
  if (["ready-initial-game", "ready-next-game"].includes(localMatch.phase)) startNextLocalMatchGame();
}

function startNextLocalMatchGame() {
  settleReplayAnalysesWithoutCoaching(aiReplay);
  const next = beginNextMatchGame(localMatch);
  if (!next.ok) return;
  game = createGame({
    interactive: true,
    randomFirstPlayer: !next.firstPlayerId && !next.firstPlayerChooserId,
    firstPlayerId: next.firstPlayerId,
    firstPlayerChooserId: next.firstPlayerChooserId,
    lockedBattlefields: next.lockedBattlefields,
    unavailableBattlefields: next.unavailableBattlefields,
    format: localMatch.sideboardingEnabled ? "match" : "duel",
    setupProcedure: localMatch.setupProcedure,
    initialSideboardingComplete: next.initialSideboardingComplete,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    decks: next.decks.map(resolveDeckRecord),
    ...reproductionRandomSeeds()
  });
  beginGameDiagnostic(aiMode ? "ai" : "local", {
    gameNumber: localMatch.gameNumber,
    sideboardingEnabled: Boolean(localMatch.sideboardingEnabled)
  });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardBaselines = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardPreviewNumber = null;
  sideboardValidationMessages = [];
  if (aiMode) {
    aiHumanPlayerId = game.players[0].id;
    aiPlayerId = game.players[1].id;
    aiReplay = createAiReplay(game, {
      humanPlayerId: aiHumanPlayerId,
      aiPlayerId,
      model: activeCoachModel(),
      deckIds: localMatch.currentDecks.map((deck) => deck.id)
    });
  }
  resetGameUiState();
}

function queueNewGameAfterReportDecision() {
  if (pendingPostReportAction?.kind === "new-local-game"
    && pendingPostReportAction.sourceGame === game
    && pendingPostReportAction.sourceMatch === localMatch) return pendingPostReportAction;
  const diagnosticLogId = currentDiagnosticSnapshot()?.logId || "";
  const continuation = {
    kind: "new-local-game",
    id: `${Date.now()}-${++postReportActionSequence}`,
    status: "waiting-report",
    sourceGame: game,
    sourceMatch: localMatch,
    diagnosticLogId
  };
  pendingPostReportAction = continuation;
  try {
    gameDiagnostic?.recordEvent("post-report-continuation-queued", {
      kind: continuation.kind,
      id: continuation.id
    }, game);
    persistGameDiagnostic();
  } catch {}
  return continuation;
}

function continuePendingPostReportActionIfReady() {
  if (!pendingPostReportAction
    || pendingPostReportAction.status !== "waiting-report"
    || postReportActionRunning
    || !bugReportDecisionResolved()) return false;
  const continuation = pendingPostReportAction;
  if (continuation.kind !== "new-local-game"
    || isOnlineGame()
    || game !== continuation.sourceGame
    || localMatch !== continuation.sourceMatch
    || game.phase !== "complete") return false;
  const activeLogId = currentDiagnosticSnapshot()?.logId || "";
  if (continuation.diagnosticLogId && activeLogId !== continuation.diagnosticLogId) return false;
  continuation.status = "starting";
  pendingPostReportAction = null;
  postReportActionRunning = true;
  try {
    startFreshLocalGame({ continuationId: continuation.id });
    return true;
  } catch (error) {
    reportUiException(error, "post-report new game");
    return false;
  } finally {
    postReportActionRunning = false;
  }
}

function startFreshLocalGame(options = {}) {
  settleReplayAnalysesWithoutCoaching(aiReplay);
  const pair = activeDeckRecords();
  const playablePair = pair.length === 2 && pair.every((deck) => validateDeckRecord(deck).playable);
  localMatch = playablePair
    ? createMatchState({
      decks: pair,
      sideboardingEnabled: settings.sideboardingEnabled,
      setupProcedure: settings.sideboardingEnabled ? "match" : "single-game-sideboard"
    })
    : null;
  game = createGame({
    interactive: true,
    randomFirstPlayer: true,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    format: settings.sideboardingEnabled ? "match" : "duel",
    setupProcedure: settings.sideboardingEnabled ? "match" : "single-game-sideboard",
    decks: playablePair ? pair.map(resolveDeckRecord) : undefined,
    ...reproductionRandomSeeds()
  });
  if (aiMode) {
    aiHumanPlayerId = game.players[0].id;
    aiPlayerId = game.players[1].id;
    aiReplay = createAiReplay(game, {
      humanPlayerId: aiHumanPlayerId,
      aiPlayerId,
      model: activeCoachModel(),
      deckIds: (localMatch?.currentDecks || pair).map((deck) => deck.id)
    });
  } else {
    aiReplay = null;
  }
  beginGameDiagnostic(aiMode ? "ai" : "local", {
    gameNumber: localMatch?.gameNumber || 1,
    sideboardingEnabled: Boolean(localMatch?.sideboardingEnabled),
    ...(aiMode ? { aiGeneration: activeAiGeneration() } : {}),
    ...(options.continuationId
      ? {
        startedFromPostReportContinuation: true,
        postReportContinuationId: options.continuationId
      }
      : {})
  });
  sideboardDrafts = localMatch?.currentDecks.map((deck) => structuredClone(deck)) || [];
  sideboardBaselines = localMatch?.currentDecks.map((deck) => structuredClone(deck)) || [];
  resetGameUiState();
  return true;
}

function startGameFromMenu() {
  if (diagnosticNavigationBlocked()) return;
  clearOnlineSeat();
  aiMode = false;
  aiReplay = null;
  const pair = activeDeckRecords();
  if (pair.length !== 2 || pair.some((deck) => !validateDeckRecord(deck).playable)) return;
  localMatch = createMatchState({
    decks: pair,
    sideboardingEnabled: settings.sideboardingEnabled,
    setupProcedure: settings.sideboardingEnabled ? "match" : "single-game-sideboard"
  });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardBaselines = localMatch.currentDecks.map((deck) => structuredClone(deck));
  game = createGame({
    interactive: true,
    randomFirstPlayer: true,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    format: settings.sideboardingEnabled ? "match" : "duel",
    setupProcedure: settings.sideboardingEnabled ? "match" : "single-game-sideboard",
    decks: pair.map(resolveDeckRecord),
    ...reproductionRandomSeeds()
  });
  beginGameDiagnostic("local", {
    gameNumber: localMatch.gameNumber,
    sideboardingEnabled: Boolean(localMatch.sideboardingEnabled)
  });
  resetGameUiState();
  appView = "game";
}

function startTutorial(tutorialId = TUTORIAL_IDS.firstVictory) {
  retireTutorialDiagnosticForTransition();
  if (diagnosticNavigationBlocked()) return;
  clearOnlineSeat();
  aiMode = false;
  aiReplay = null;
  localMatch = null;
  game = createTutorialGame(tutorialId);
  if (locale() !== LOCALES.KO) {
    const trainee = game.players.find((player) => player.id === game.tutorial.playerId);
    const opponent = game.players.find((player) => player.id === game.tutorial.opponentId);
    if (trainee) trainee.name = "Trainee";
    if (opponent) opponent.name = "Training Opponent";
    const lesson = TUTORIAL_CATALOG.find((entry) => entry.id === tutorialId);
    game.log = [`Tutorial: ${lesson?.englishTitle || "Beginner Tutorial"}`];
  }
  beginGameDiagnostic("tutorial", { tutorialId });
  resetGameUiState();
  appView = "game";
}

function exitTutorial() {
  retireTutorialDiagnosticForTransition();
  if (diagnosticNavigationBlocked()) return;
  game.tutorial.active = false;
  appView = "tutorials";
  resetGameUiState();
}

async function startAiGameFromMenu() {
  if (diagnosticNavigationBlocked()) return;
  clearOnlineSeat();
  const startSessionGeneration = onlineSessionGeneration;
  const pair = activeDeckRecords();
  if (pair.length !== 2 || pair.some((deck) => !validateDeckRecord(deck).playable)) return;
  const generation = selectedAiGenerationDescriptor();
  if (!trainingDeckIdForGeneration(pair[1], generation) && !matchingAiPreset(pair[1], cardByNumber)) return;
  if (!await ensureNeuralAiLoaded()
    || diagnosticNavigationBlocked()
    || startSessionGeneration !== onlineSessionGeneration
    || isOnlineGame()
    || appView !== "menu") return;
  const currentPair = activeDeckRecords();
  if (currentPair.length !== 2 || currentPair.some(deck => !validateDeckRecord(deck).playable)
    || (!trainingDeckIdForGeneration(currentPair[1], generation) && !matchingAiPreset(currentPair[1], cardByNumber))) return;
  localMatch = createMatchState({
    decks: currentPair,
    sideboardingEnabled: settings.sideboardingEnabled,
    setupProcedure: settings.sideboardingEnabled ? "match" : "single-game-sideboard"
  });
  sideboardDrafts = localMatch.currentDecks.map((deck) => structuredClone(deck));
  sideboardBaselines = localMatch.currentDecks.map((deck) => structuredClone(deck));
  game = createGame({
    interactive: true,
    randomFirstPlayer: true,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    format: settings.sideboardingEnabled ? "match" : "duel",
    setupProcedure: settings.sideboardingEnabled ? "match" : "single-game-sideboard",
    decks: currentPair.map(resolveDeckRecord),
    ...reproductionRandomSeeds()
  });
  aiMode = true;
  aiHumanPlayerId = game.players[0].id;
  aiPlayerId = game.players[1].id;
  aiReplay = createAiReplay(game, {
    humanPlayerId: aiHumanPlayerId,
    aiPlayerId,
    model: activeCoachModel(),
    deckIds: currentPair.map((deck) => deck.id)
  });
  beginGameDiagnostic("ai", {
    gameNumber: localMatch.gameNumber,
    sideboardingEnabled: Boolean(localMatch.sideboardingEnabled),
    aiGeneration: activeAiGeneration()
  });
  resetGameUiState();
  appView = "game";
  render();
}

async function onlineCreateRoom() {
  if (diagnosticNavigationBlocked()) return;
  const sideboardingEnabled = settings.sideboardingEnabled === true;
  const { poolId, banlistEnabled } = normalizeRoomDeckOptions({ poolId: settings.onlinePoolId, banlistEnabled: settings.onlineBanlistEnabled });
  const key = `create:${sideboardingEnabled}:${poolId}:${banlistEnabled}`;
  if (onlineSeatRequestOperation) return onlineSeatRequestOperation.promise;
  const operation = {
    id: ++onlineRequestOperationSequence,
    key,
    kind: "create",
    promise: null
  };
  onlineSeatRequestOperation = operation;
  beginOnlineOperationLoading(operation);
  online.error = "";
  operation.promise = (async () => {
    try {
      const result = await createOnlineRoom({ sideboardingEnabled, poolId, banlistEnabled });
      if (onlineSeatRequestOperation !== operation) return;
      applyOnlineSeatResult(result);
      connectOnlineEvents();
    } catch (error) {
      if (onlineSeatRequestOperation !== operation) return;
      online.error = error.message;
    } finally {
      if (onlineSeatRequestOperation !== operation) return;
      onlineSeatRequestOperation = null;
      finishOnlineOperationLoading(operation);
      render();
    }
  })();
  return operation.promise;
}

async function onlineJoinRoom(roomId) {
  if (diagnosticNavigationBlocked()) return;
  if (!roomId) return;
  const normalizedRoomId = String(roomId).trim().toUpperCase();
  if (!normalizedRoomId) return;
  const rejoinToken = online.roomId === normalizedRoomId ? online.playerToken : "";
  const key = `join:${normalizedRoomId}:${rejoinToken}`;
  if (onlineSeatRequestOperation) return onlineSeatRequestOperation.promise;
  const operation = {
    id: ++onlineRequestOperationSequence,
    key,
    kind: "join",
    roomId: normalizedRoomId,
    playerToken: rejoinToken,
    promise: null
  };
  onlineSeatRequestOperation = operation;
  beginOnlineOperationLoading(operation);
  online.error = "";
  operation.promise = (async () => {
    try {
      const result = await joinOnlineRoom(operation.roomId, operation.playerToken);
      if (onlineSeatRequestOperation !== operation) return;
      applyOnlineSeatResult(result);
      connectOnlineEvents();
    } catch (error) {
      if (onlineSeatRequestOperation !== operation) return;
      online.error = error.message;
    } finally {
      if (onlineSeatRequestOperation !== operation) return;
      onlineSeatRequestOperation = null;
      finishOnlineOperationLoading(operation);
      render();
    }
  })();
  return operation.promise;
}

async function onlineSubmitDeck() {
  if (diagnosticNavigationBlocked()) return;
  const deck = activeDeckRecords()[0];
  if (!deck || !online.roomId || !online.playerToken) return;
  return runOnlineRoomMutation("submit-deck", (operation) =>
    submitOnlineDeck(operation.roomId, operation.playerToken, deck));
}

async function onlineReady() {
  if (diagnosticNavigationBlocked()) return;
  if (!online.roomId || !online.playerToken) return;
  return runOnlineRoomMutation("ready", (operation) =>
    setOnlineReady(operation.roomId, operation.playerToken, true));
}

async function runOnlineRoomMutation(kind, request) {
  if (diagnosticNavigationBlocked()) return;
  if (onlineRoomMutationOperation
    && onlineCommandSessionIsCurrent(onlineRoomMutationOperation)) {
    return onlineRoomMutationOperation.promise;
  }
  const operation = {
    id: ++onlineRequestOperationSequence,
    kind,
    generation: onlineSessionGeneration,
    roomId: online.roomId,
    playerToken: online.playerToken,
    promise: null
  };
  onlineRoomMutationOperation = operation;
  beginOnlineOperationLoading(operation);
  online.error = "";
  operation.promise = (async () => {
    try {
      const result = await request(operation);
      if (!onlineRoomMutationOperationIsCurrent(operation)) return;
      online.room = result.room;
    } catch (error) {
      if (!onlineRoomMutationOperationIsCurrent(operation)) return;
      online.error = error.message;
    } finally {
      if (!onlineRoomMutationOperationIsCurrent(operation)) return;
      onlineRoomMutationOperation = null;
      finishOnlineOperationLoading(operation);
      render();
    }
  })();
  return operation.promise;
}

function onlineRoomMutationOperationIsCurrent(operation) {
  return onlineRoomMutationOperation === operation
    && onlineCommandSessionIsCurrent(operation);
}

function boundedOnlineLeaveRequest(request, timeoutMs = 8_000) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("Room leave request timed out.")), timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timeoutId));
}

async function onlineLeaveRoom() {
  const roomId = online.roomId;
  const playerToken = online.playerToken;
  if (onlineLeaveOperation
    && onlineLeaveOperation.roomId === roomId
    && onlineLeaveOperation.playerToken === playerToken
    && onlineLeaveOperation.departureGeneration === onlineSessionGeneration) {
    return onlineLeaveOperation.promise;
  }
  cancelOnlineSeatRequestOperation();
  if (!roomId || !playerToken) {
    clearOnlineSeat();
    appView = "multiplayer";
    refreshRooms();
    render();
    return undefined;
  }
  const departureGeneration = invalidateOnlineSession();
  // Stop room snapshots before waiting for the leave request. Otherwise a
  // just-finished room can advance and start a fresh diagnostic while this
  // client is already on its way back to the lobby.
  closeOnlineEvents();
  const operation = {
    roomId,
    playerToken,
    departureGeneration,
    promise: null
  };
  onlineLeaveOperation = operation;
  operation.promise = (async () => {
    let leaveError = "";
    try {
      await boundedOnlineLeaveRequest(leaveOnlineRoom(roomId, playerToken));
    } catch (error) {
      leaveError = errorMessage(error);
    } finally {
      const stillLeavingCapturedSeat = onlineSessionGeneration === departureGeneration
        && online.roomId === roomId
        && online.playerToken === playerToken;
      if (onlineLeaveOperation === operation) onlineLeaveOperation = null;
      if (!stillLeavingCapturedSeat) return;
      clearOnlineSeat();
      online.error = leaveError;
      online.leaveNotice = leaveError;
      if (currentDiagnosticSnapshot()?.finalization && !bugReportDecisionResolved()) {
        bugReportUi.recovered = true;
      }
      appView = diagnosticNavigationBlocked() ? "menu" : "multiplayer";
      if (appView === "multiplayer") refreshRooms();
      render();
    }
  })();
  return operation.promise;
}

function prepareOnlineGameMode() {
  // An online snapshot belongs to the server. Retire local controllers before
  // accepting it, including decisions still in flight from an earlier AI game.
  pauseReplayPlayback();
  aiMode = false;
  aiHumanPlayerId = null;
  aiPlayerId = null;
  aiReplay = null;
  replayMode = false;
  replayBrowser.current = null;
  localMatch = null;
  sideboardDrafts = [];
  sideboardBaselines = [];
  resetGameUiState();
}

function applyOnlineSeatResult(result) {
  prepareOnlineGameMode();
  invalidateOnlineSession();
  online.leaveNotice = "";
  online.diagnosticGameId = "";
  online.gameNumber = null;
  online.mode = "online";
  online.room = result.room;
  online.roomId = result.room?.roomId || online.roomId;
  online.playerId = result.playerId || online.playerId;
  online.playerToken = result.playerToken || online.playerToken;
  saveOnlineSeat();
}

function dispatchGameCommand(command, applyLocal) {
  if (online.commandPending?.sessionGeneration === onlineSessionGeneration) return;
  if (online.commandPending) online.commandPending = null;
  clearRealtimeFeedback();
  actionRejection = null;
  if (!isOnlineGame()) {
    const resolvedCommand = resolveCurrentGameCommand(command);
    if (!resolvedCommand) {
      recordDiagnosticCommand(command, {
        status: "rejected",
        reason: "That action is not legal in the current game state.",
        context: { actorId: aiActiveActorId(game) }
      });
      actionRejection = localizedCommandFailure("That action is not legal in the current game state.");
      return;
    }
    const actorId = aiActiveActorId(game);
    const before = aiReplay?.humanPlayerId === actorId
      && isStrategicAction(resolvedCommand)
      && !replayAnalysisWorkerUnavailable
      && typeof Worker === "function"
      ? cloneGame(game)
      : null;
    const attemptId = recordDiagnosticCommandAttempt(resolvedCommand, { actorId, online: false });
    let result;
    try {
      result = applyLocal?.(resolvedCommand);
    } catch (error) {
      markGameStateChanged();
      recordDiagnosticCommand(resolvedCommand, {
        status: "exception",
        error,
        context: { actorId, attemptId }
      });
      throw error;
    }
    if (result?.ok === false) actionRejection = localizedCommandFailure(result.message);
    if (result?.ok !== false) enterInitialLocalSideboardingIfNeeded();
    advanceTutorialAfterCommand(game, resolvedCommand, result);
    if (game.tutorial?.completed && !tutorialRecord.completedIds.includes(game.tutorial.id)) {
      const completedAt = new Date().toISOString();
      tutorialRecord = {
        completedIds: [...tutorialRecord.completedIds, game.tutorial.id],
        completedAtById: { ...tutorialRecord.completedAtById, [game.tutorial.id]: completedAt }
      };
      saveTutorialRecord();
    }
    if (result?.ok !== false) markGameStateChanged();
    recordDiagnosticCommand(resolvedCommand, {
      status: result?.ok === false ? "rejected" : "success",
      ...(result?.ok === false
        ? { reason: result.message || "Command rejected." }
        : { result }),
      context: { actorId, attemptId }
    });
    recordLocalGameIfComplete();
    if (before && result?.ok) queueReplayAnalysis(before, actorId, resolvedCommand, result);
    if (result?.ok && game.phase === "complete") completeAiReplay();
    return;
  }
  if (!['surrender', 'restartGame', 'submitSideboard'].includes(command.kind) && !viewerCanAct()) {
    recordDiagnosticCommand(command, {
      status: "rejected",
      reason: "The viewer cannot act right now.",
      context: { actorId: online.playerId, online: true }
    });
    online.error = "상대의 턴 또는 Focus입니다.";
    return;
  }
  // Online snapshots are intentionally redacted and JSON-only. They are not
  // authoritative enough to replay a command through the full rules engine;
  // doing so can both disagree with hidden server state and execute transitions
  // on serialized data. Send the explicit UI command and let the server's
  // shared legal-action gate validate and canonicalize it.
  const commandSession = {
    generation: onlineSessionGeneration,
    roomId: online.roomId,
    playerToken: online.playerToken,
    playerId: online.playerId,
    diagnosticRecorder: gameDiagnostic,
    ...captureOnlineDiagnosticIdentity({
      roomId: online.roomId,
      diagnosticKey: onlineDiagnosticGameKey,
      metadata: currentDiagnosticSnapshot()?.metadata
    })
  };
  const resolvedCommand = command.kind === "surrender"
    ? guardedOnlineSurrenderCommand(command, commandSession)
    : command;
  if (!resolvedCommand) {
    const reason = "The current online game identity is unavailable; no surrender was sent.";
    recordDiagnosticCommand(command, {
      status: "rejected",
      reason,
      context: { actorId: commandSession.playerId, online: true }
    });
    online.error = reason;
    actionRejection = localizedCommandFailure(reason);
    return;
  }
  const snapshotRevisionAtDispatch = onlineSnapshotRevision;
  const attemptId = recordDiagnosticCommandAttempt(resolvedCommand, {
    actorId: commandSession.playerId,
    online: true
  });
  const commandPending = {
    kind: command.kind,
    startedAt: Date.now(),
    sessionGeneration: commandSession.generation,
    roomId: commandSession.roomId,
    diagnosticIdentityCaptured: commandSession.diagnosticIdentityCaptured,
    diagnosticKey: commandSession.diagnosticKey,
    diagnosticGameId: commandSession.diagnosticGameId,
    gameNumber: commandSession.gameNumber
  };
  online.commandPending = commandPending;
  sendOnlineCommand(commandSession.roomId, commandSession.playerToken, resolvedCommand)
    .then((result) => {
      if (!onlineCommandSessionIsCurrent(commandSession)
        || gameDiagnostic !== commandSession.diagnosticRecorder) return;
      online.error = "";
      actionRejection = null;
      recordDiagnosticCommand(resolvedCommand, {
        status: "success",
        result,
        context: { actorId: commandSession.playerId, online: true, attemptId }
      });
    })
    .catch((error) => {
      if (!onlineCommandSessionIsCurrent(commandSession)
        || gameDiagnostic !== commandSession.diagnosticRecorder) return;
      online.error = error.message;
      actionRejection = localizedCommandFailure(error.message);
      recordDiagnosticCommand(resolvedCommand, {
        status: Number(error?.status) >= 400 && Number(error?.status) < 500 ? "rejected" : "exception",
        ...(Number(error?.status) >= 400 && Number(error?.status) < 500
          ? { reason: error.message }
          : { error }),
        context: { actorId: commandSession.playerId, online: true, attemptId }
      });
    })
    .finally(() => {
      if (!onlineCommandSessionIsCurrent(commandSession)
        || online.commandPending !== commandPending) return;
      online.commandPending = null;
      if (gameDiagnostic !== commandSession.diagnosticRecorder) return;
      if (onlineSnapshotRevision === snapshotRevisionAtDispatch) render();
      else renderAfterTabletopFlights();
    });
}

function onlineCommandSessionIsCurrent(commandSession) {
  return commandSession?.generation === onlineSessionGeneration
    && commandSession.roomId === online.roomId
    && commandSession.playerToken === online.playerToken;
}

function renderAfterTabletopFlights() {
  const generation = ++deferredOnlineRenderGeneration;
  if (deferredOnlineRenderTimer) clearTimeout(deferredOnlineRenderTimer);
  deferredOnlineRenderTimer = null;
  const animations = [...document.querySelectorAll(".tabletop-card-flight-layer, .tabletop-state-motion")]
    .flatMap((node) => {
      if (typeof node.getAnimations !== "function") return [];
      try { return node.getAnimations({ subtree: true }); } catch { return node.getAnimations(); }
    })
    .filter((animation) => !["finished", "idle"].includes(animation.playState));
  if (!animations.length || appView !== "game") {
    render();
    return;
  }
  let settled = false;
  const finish = () => {
    if (settled || generation !== deferredOnlineRenderGeneration) return;
    settled = true;
    if (deferredOnlineRenderTimer) clearTimeout(deferredOnlineRenderTimer);
    deferredOnlineRenderTimer = null;
    render();
  };
  deferredOnlineRenderTimer = window.setTimeout(finish, 1800);
  Promise.allSettled(animations.map((animation) => {
    try { return animation.finished; } catch { return Promise.resolve(); }
  })).then(finish);
}

function resolveCurrentGameCommand(command) {
  if (["surrender", "restartGame", "submitSideboard"].includes(command?.kind)) return command;
  if (command?.kind === "cancelPayment"
    && game.pendingPayment
    && !game.players.some((player) => player.id === game.pendingPayment.playerId)) return command;
  const actorId = aiActiveActorId(game);
  if (!actorId) return null;
  if (["beginPlayCard", "beginPlayCardFromTrash", "beginPlayChampion", "hideCard", "moveUnit"].includes(command?.kind)) {
    const key = actionKey(command);
    const cached = uiActionByKey.get(key);
    if (cached) return cached;
  }
  return canonicalizeActionCommand(game, command, actorId);
}

function queueReplayAnalysis(before, actorId, command, result) {
  const replay = aiReplay;
  if (before) recordExecutedReplayAction(replay,before,actorId,command,result);
  if (!replay || !before || !result?.ok || actorId !== replay.humanPlayerId || !isStrategicAction(command)) return;
  const requestId = `replay-analysis-${++replayAnalysisRequestSequence}`;
  const pending = {
    requestId,
    order: replayAnalysisRequestSequence,
    replay,
    gameBefore: before,
    actorId,
    command,
    model: activeCoachModel(),
    ready: false,
    decision: null,
    idleCallback: null,
    timer: null,
    watchdog: null
  };
  pendingReplayAnalyses.set(requestId, pending);
  const worker = ensureReplayAnalysisWorker();
  if (!worker) {
    scheduleReplayAnalysisFallback(pending);
    return;
  }
  try {
    worker.postMessage(createReplayAnalysisWorkerRequest({
      requestId,
      gameBefore: before,
      actorId,
      command,
      model: pending.model
    }));
    pending.watchdog = window.setTimeout(() => {
      if (pendingReplayAnalyses.get(requestId) === pending && !pending.ready) {
        handleReplayAnalysisWorkerFailure();
      }
    }, 15_000);
  } catch {
    handleReplayAnalysisWorkerFailure();
  }
}

function ensureReplayAnalysisWorker() {
  if (replayAnalysisWorker) return replayAnalysisWorker;
  if (replayAnalysisWorkerUnavailable || typeof Worker !== "function") return null;
  try {
    const worker = new Worker(new URL("./ai/replay-worker.mjs", import.meta.url), { type: "module" });
    worker.addEventListener("message", handleReplayAnalysisWorkerMessage);
    worker.addEventListener("error", handleReplayAnalysisWorkerFailure);
    worker.addEventListener("messageerror", handleReplayAnalysisWorkerFailure);
    replayAnalysisWorker = worker;
    return worker;
  } catch {
    replayAnalysisWorkerUnavailable = true;
    return null;
  }
}

function handleReplayAnalysisWorkerMessage(event) {
  const message = event.data;
  const pending = pendingReplayAnalyses.get(message?.requestId);
  if (!pending) return;
  if (pending.watchdog != null) window.clearTimeout(pending.watchdog);
  pending.watchdog = null;
  if (message.type === REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.result && message.ok) {
    pending.decision = message.decision;
    pending.ready = true;
    drainReplayAnalysisResults(pending.replay);
    return;
  }
  scheduleReplayAnalysisFallback(pending);
}

function handleReplayAnalysisWorkerFailure() {
  replayAnalysisWorker?.terminate();
  replayAnalysisWorker = null;
  replayAnalysisWorkerUnavailable = true;
  for (const pending of pendingReplayAnalyses.values()) {
    if (pending.ready) continue;
    if (pending.watchdog != null) window.clearTimeout(pending.watchdog);
    pending.watchdog = null;
    scheduleReplayAnalysisFallback(pending);
  }
}

function scheduleReplayAnalysisFallback(pending) {
  if (!pending?.replay || pending.replay !== aiReplay) {
    if (pending?.requestId) pendingReplayAnalyses.delete(pending.requestId);
    return;
  }
  if (pending.watchdog != null) window.clearTimeout(pending.watchdog);
  if (pending.idleCallback != null && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(pending.idleCallback);
  }
  pending.watchdog = null;
  if (pending.timer != null) window.clearTimeout(pending.timer);
  pending.idleCallback = null;
  pending.timer = null;
  // A Worker failure must never move full policy enumeration back onto the
  // gameplay thread. Mark this item complete without coaching data so ordered
  // replay draining releases the retained state snapshot immediately.
  pending.gameBefore = null;
  pending.decision = null;
  pending.ready = true;
  pendingReplayAnalyses.set(pending.requestId, pending);
  drainReplayAnalysisResults(pending.replay);
}

function drainReplayAnalysisResults(replay) {
  let appended = false;
  const ordered = [...pendingReplayAnalyses.values()]
    .filter((pending) => pending.replay === replay)
    .sort((left, right) => left.order - right.order);
  for (const next of ordered) {
    if (!next.ready) break;
    pendingReplayAnalyses.delete(next.requestId);
    if (next.decision && next.gameBefore) {
      appendAnalyzedReplayDecision(replay, next.decision, next.gameBefore, {
        stateAlreadyCloned: true
      });
    }
    appended = true;
  }
  if (appended) finishReplayAnalysisUpdate(replay);
}

function settleReplayAnalysesWithoutCoaching(replay) {
  if (!replay) return;
  for (const pending of pendingReplayAnalyses.values()) {
    if (pending.replay !== replay) continue;
    if (pending.idleCallback != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(pending.idleCallback);
    }
    if (pending.timer != null) window.clearTimeout(pending.timer);
    if (pending.watchdog != null) window.clearTimeout(pending.watchdog);
    pending.idleCallback = null;
    pending.timer = null;
    pending.watchdog = null;
    if (!pending.ready) {
      pending.gameBefore = null;
      pending.decision = null;
      pending.ready = true;
    }
  }
  drainReplayAnalysisResults(replay);
  if (replay === aiReplay && game.phase === "complete") completeAiReplay();
}

function finishReplayAnalysisUpdate(replay) {
  if ([...pendingReplayAnalyses.values()].some((pending) => pending.replay === replay)) return;
  if (replay === aiReplay && game.phase === "complete") completeAiReplay();
  else if (replay === aiReplay && appView === "analysis") render();
}

function cancelReplayAnalyses() {
  replayAnalysisWorker?.removeEventListener("message", handleReplayAnalysisWorkerMessage);
  replayAnalysisWorker?.removeEventListener("error", handleReplayAnalysisWorkerFailure);
  replayAnalysisWorker?.removeEventListener("messageerror", handleReplayAnalysisWorkerFailure);
  replayAnalysisWorker?.terminate();
  replayAnalysisWorker = null;
  replayAnalysisWorkerUnavailable = false;
  for (const pending of pendingReplayAnalyses.values()) {
    if (pending.idleCallback != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(pending.idleCallback);
    }
    if (pending.timer != null) window.clearTimeout(pending.timer);
    if (pending.watchdog != null) window.clearTimeout(pending.watchdog);
  }
  pendingReplayAnalyses.clear();
}

function persistCurrentAiReplay(replay) {
  if (!replay?.report) return Promise.resolve(false);
  let state = aiReplayPersistenceStates.get(replay);
  if (!state) {
    state = { promise: null, inFlightReport: null, savedReport: null };
    aiReplayPersistenceStates.set(replay, state);
  }
  const requestedReport = replay.report;
  if (state.savedReport === requestedReport) return Promise.resolve(true);
  if (state.promise) {
    if (state.inFlightReport === requestedReport) return state.promise;
    // Refined reports must wait for an older write to finish. Both writes use
    // the same replay id, so parallel persistence could let stale data win.
    return state.promise.catch(() => false).then(() => persistCurrentAiReplay(replay));
  }

  let payload;
  let persistence;
  try {
    payload = persistableAiReplay(replay);
    persistence = persistAiReplay(payload);
  } catch (error) {
    return Promise.reject(error);
  }
  state.inFlightReport = requestedReport;
  const savePromise = Promise.resolve(persistence)
    .then(() => {
      state.savedReport = requestedReport;
      return true;
    })
    .finally(() => {
      if (state.promise !== savePromise) return;
      state.promise = null;
      state.inFlightReport = null;
    });
  state.promise = savePromise;
  return savePromise;
}

function completeAiReplay() {
  const replay = aiReplay;
  if (!replay) return;
  if ([...pendingReplayAnalyses.values()].some((pending) => pending.replay === replay)) return;
  if (!replay.report) finalizeAiReplay(replay, game, activeCoachModel());
  persistCurrentAiReplay(replay).catch((error) => {
    // A later review/exit/new-game action can retry this exact report because
    // failed writes never advance savedReport.
    reportUiException(error, "AI replay persistence");
  });
}

function scheduleAiTurn() {
  if (!aiMode
    || isOnlineGame()
    || appView !== "game"
    || matchIsBetweenGames()
    || aiThinking
    || aiTurnTimer
    || aiTurnWorkerBusyRequestId
    || aiTurnWorkerUnavailable
    || game.phase === "complete") return;
  if (aiActiveActorId(game) !== aiPlayerId) return;
  const scheduledGame = game;
  const scheduledGeneration = aiTurnGeneration;
  const scheduledAiPlayerId = aiPlayerId;
  aiTurnTimer = window.setTimeout(async () => {
    aiTurnTimer = null;
    if (!aiTurnSessionIsCurrent(scheduledGame, scheduledGeneration, scheduledAiPlayerId)) return;
    aiThinking = true;
    render();
    if (!aiTurnSessionIsCurrent(scheduledGame, scheduledGeneration, scheduledAiPlayerId)) return;
    let attemptedCommand = { kind: "ai-turn" };
    let diagnosticRecorded = false;
    let diagnosticAttemptId = "";
    try {
      const workerDecision = await requestAiTurnDecision({
        game: scheduledGame,
        actorId: scheduledAiPlayerId,
        model: aiModel,
        selectionMode: neuralAiCheckpointMetadata
          && aiTurnWorkerConfiguredNeuralKey
          && aiTurnWorkerConfiguredNeuralKey === neuralAiLoadedDescriptorKey
          ? "neural"
          : "policy",
        temperature: 0.22
      });
      if (!aiTurnSessionIsCurrent(scheduledGame, scheduledGeneration, scheduledAiPlayerId)) return;

      if (workerDecision?.kind === "payment") {
        const replayBefore={turnNumber:game.turnNumber,phase:game.phase};
        attemptedCommand = { kind: "aiResolvePlannedPayment" };
        diagnosticAttemptId = recordDiagnosticCommandAttempt(attemptedCommand, {
          actorId: scheduledAiPlayerId,
          ai: true
        });
        const payment = applyAiPaymentActions(workerDecision.actions, scheduledAiPlayerId);
        recordExecutedReplayAction(aiReplay,replayBefore,scheduledAiPlayerId,attemptedCommand,payment);
        if (payment?.ok || payment?.actionsApplied) markGameStateChanged();
        recordDiagnosticCommand(attemptedCommand, {
          status: payment?.ok ? "success" : "rejected",
          ...(payment?.ok
            ? { result: payment }
            : { reason: payment?.message || "AI payment was rejected." }),
          context: { actorId: scheduledAiPlayerId, ai: true, attemptId: diagnosticAttemptId }
        });
        diagnosticRecorded = true;
        if (!payment?.ok) throw new Error(payment?.message || "AI가 비용 결제를 완료하지 못했습니다.");
        enterInitialLocalSideboardingIfNeeded();
        recordLocalGameIfComplete();
        if (game.phase === "complete") completeAiReplay();
        return;
      }

      const selected = workerDecision?.selected;
      if (!selected) throw new Error("AI가 실행 가능한 행동을 찾지 못했습니다.");
      attemptedCommand = selected.action;
      diagnosticAttemptId = recordDiagnosticCommandAttempt(attemptedCommand, {
        actorId: scheduledAiPlayerId,
        ai: true,
        runtimeReview: workerDecision.runtimeReview
      });
      const replayBefore={turnNumber:game.turnNumber,phase:game.phase};
      const result = applyAiAction(game, selected.action, scheduledAiPlayerId);
      recordExecutedReplayAction(aiReplay,replayBefore,scheduledAiPlayerId,selected.action,result);
      if (result?.ok) markGameStateChanged();
      recordDiagnosticCommand(selected.action, {
        status: result?.ok ? "success" : "rejected",
        ...(result?.ok
          ? { result }
          : { reason: result?.message || "AI action was rejected." }),
        context: { actorId: scheduledAiPlayerId, ai: true, attemptId: diagnosticAttemptId,
          runtimeReview: workerDecision.runtimeReview }
      });
      diagnosticRecorded = true;
      if (!result?.ok) throw new Error(result?.message || "AI 행동이 거절되었습니다.");
      enterInitialLocalSideboardingIfNeeded();
      recordLocalGameIfComplete();
      if (game.phase === "complete") completeAiReplay();
    } catch (error) {
      // Cancelled or superseded work must not contaminate the new game's log.
      if (scheduledGeneration !== aiTurnGeneration
        || scheduledGame !== game
        || isOnlineGame()) return;
      if (!diagnosticRecorded) {
        recordDiagnosticCommand(attemptedCommand, {
          status: "exception",
          error,
          context: { actorId: scheduledAiPlayerId, ai: true, attemptId: diagnosticAttemptId }
        });
      }
      if (aiTurnSessionIsCurrent(scheduledGame, scheduledGeneration, scheduledAiPlayerId)) {
        reportUiException(error, "AI turn");
      }
    } finally {
      if (scheduledGeneration === aiTurnGeneration) {
        aiThinking = false;
        render();
      }
    }
  }, EFFECT_ANIMATION_DURATION_MS);
}

function aiTurnSessionIsCurrent(scheduledGame, scheduledGeneration, scheduledAiPlayerId) {
  return scheduledGeneration === aiTurnGeneration
    && scheduledGame === game
    && !isOnlineGame()
    && appView === "game"
    && aiMode
    && aiPlayerId === scheduledAiPlayerId
    && game.phase !== "complete"
    && aiActiveActorId(game) === scheduledAiPlayerId;
}

function applyAiPaymentActions(actions, actorId) {
  if (!Array.isArray(actions) || !actions.length) {
    return { ok: false, message: "No AI payment action is available.", actionsApplied: 0 };
  }
  let actionsApplied = 0;
  const appliedActions=[];
  for (const action of actions) {
    const recorded=recordablePaymentCommand(game,actorId,action);
    const result = applyAiAction(game, action, actorId);
    if (!result?.ok) {
      return {
        ok: false,
        message: result?.message || "AI payment action was rejected.",
        actionsApplied,appliedActions
      };
    }
    actionsApplied += 1;
    appliedActions.push(recorded);
    if (action.kind === "cancelPayment") {
      return { ok: true, complete: true, cancelled: true, actionsApplied,appliedActions };
    }
    // Generated resource ids are authoritative only in the live game. Replan
    // in the Worker after the activation instead of applying ids from its copy.
    if (action.kind === "activateCard" && game.pendingPayment) {
      return { ok: true, complete: false, replan: true, actionsApplied,appliedActions };
    }
  }
  if (game.pendingPayment) {
    return { ok: false, message: "AI payment plan did not complete.", actionsApplied,appliedActions };
  }
  return { ok: true, complete: true, actionsApplied,appliedActions };
}

function requestAiTurnDecision(options) {
  const worker = ensureAiTurnWorker();
  if (!worker) return Promise.reject(new Error("AI turn Worker is unavailable."));
  if (pendingAiTurnRequest || aiTurnWorkerBusyRequestId) {
    return Promise.reject(new Error("An AI turn decision is already pending."));
  }
  const requestId = `ai-turn-${++aiTurnRequestSequence}`;
  return new Promise((resolve, reject) => {
    const pending = {
      requestId,
      resolve,
      reject
    };
    aiTurnWorkerBusyRequestId = requestId;
    aiTurnWorkerBusyWatchdog = window.setTimeout(() => {
      if (aiTurnWorkerBusyRequestId === requestId) {
        failAiTurnWorker(new Error("AI turn Worker timed out."));
      }
    }, AI_TURN_DECISION_TIMEOUT_MS);
    pendingAiTurnRequest = pending;
    try {
      worker.postMessage(createAiTurnWorkerRequest({ requestId, ...options }));
    } catch (error) {
      failAiTurnWorker(error);
    }
  });
}

function configureAiTurnWorkerNeural(checkpointBuffer, descriptorKey, expectedGeneration) {
  if (aiTurnWorkerConfiguredNeuralKey === descriptorKey && neuralAiCheckpointMetadata) {
    return Promise.resolve(neuralAiCheckpointMetadata);
  }
  if (pendingAiTurnWorkerConfiguration?.descriptorKey === descriptorKey) {
    return pendingAiTurnWorkerConfiguration.promise;
  }
  const worker = ensureAiTurnWorker();
  if (!worker) return Promise.reject(new Error("AI turn Worker is unavailable."));
  if (pendingAiTurnWorkerConfiguration) {
    return pendingAiTurnWorkerConfiguration.promise
      .catch(() => false)
      .then(() => {
        if (neuralAiDescriptorKey(selectedAiGenerationDescriptor()) !== descriptorKey) {
          const error = new Error("AI turn neural Worker configuration was superseded.");
          error.name = "AbortError";
          throw error;
        }
        return configureAiTurnWorkerNeural(checkpointBuffer, descriptorKey, expectedGeneration);
      });
  }
  const requestId = `ai-turn-config-${++aiTurnWorkerConfigurationSequence}`;
  let resolveConfiguration;
  let rejectConfiguration;
  const promise = new Promise((resolve, reject) => {
    resolveConfiguration = resolve;
    rejectConfiguration = reject;
  });
  const pending = {
    requestId,
    descriptorKey,
    expectedGeneration,
    promise,
    resolve: resolveConfiguration,
    reject: rejectConfiguration,
    watchdog: window.setTimeout(() => {
      if (pendingAiTurnWorkerConfiguration === pending) {
        failAiTurnWorker(new Error("AI turn neural Worker configuration timed out."));
      }
    }, AI_TURN_NEURAL_CONFIGURATION_TIMEOUT_MS)
  };
  pendingAiTurnWorkerConfiguration = pending;
  try {
    worker.postMessage(createAiTurnNeuralConfigureRequest({
      requestId,
      descriptorKey,
      checkpointBuffer,
      expectedGeneration
    }), [checkpointBuffer]);
  } catch (error) {
    failAiTurnWorker(error);
  }
  return promise;
}

function ensureAiTurnWorker() {
  if (aiTurnWorker) return aiTurnWorker;
  if (aiTurnWorkerUnavailable || typeof Worker !== "function") return null;
  try {
    const worker = new Worker(new URL("./ai/turn-worker.mjs?v=public-review-20261001", import.meta.url), { type: "module" });
    worker.addEventListener("message", handleAiTurnWorkerMessage);
    worker.addEventListener("error", handleAiTurnWorkerFailure);
    worker.addEventListener("messageerror", handleAiTurnWorkerFailure);
    aiTurnWorker = worker;
    return worker;
  } catch (error) {
    aiTurnWorkerUnavailable = true;
    return null;
  }
}

function handleAiTurnWorkerMessage(event) {
  const message = event.data;
  const configuration = pendingAiTurnWorkerConfiguration;
  if (configuration
    && message?.type === AI_TURN_WORKER_MESSAGE_TYPES.neuralConfigured
    && message.requestId === configuration.requestId) {
    window.clearTimeout(configuration.watchdog);
    pendingAiTurnWorkerConfiguration = null;
    if (message.ok
      && message.descriptorKey === configuration.descriptorKey
      && Number(message.checkpointMetadata?.generation) === Number(configuration.expectedGeneration)) {
      aiTurnWorkerConfiguredNeuralKey = configuration.descriptorKey;
      configuration.resolve(lightweightNeuralAiCheckpointMetadata(message.checkpointMetadata));
    } else {
      configuration.reject(new Error(message?.error || "AI turn neural Worker configuration failed."));
    }
    return;
  }
  const releasedBusyWorker = message?.type === AI_TURN_WORKER_MESSAGE_TYPES.result
    && message.requestId === aiTurnWorkerBusyRequestId;
  if (releasedBusyWorker) {
    if (aiTurnWorkerBusyWatchdog) window.clearTimeout(aiTurnWorkerBusyWatchdog);
    aiTurnWorkerBusyWatchdog = null;
    aiTurnWorkerBusyRequestId = "";
  }
  const pending = pendingAiTurnRequest;
  if (!pending || message?.requestId !== pending.requestId) {
    if (releasedBusyWorker && appView === "game") render();
    return;
  }
  pendingAiTurnRequest = null;
  if (message.type === AI_TURN_WORKER_MESSAGE_TYPES.result && message.ok) {
    pending.resolve(message.decision);
  } else {
    const error = new Error(message?.error || "AI turn Worker failed.");
    pending.reject(error);
    failAiTurnWorker(error);
  }
}

function handleAiTurnWorkerFailure(event) {
  failAiTurnWorker(event?.error || new Error(event?.message || "AI turn Worker failed."));
}

function failAiTurnWorker(error) {
  aiTurnWorkerUnavailable = true;
  disposeAiTurnWorker(error instanceof Error ? error : new Error(String(error || "AI turn Worker failed.")));
}

function disposeAiTurnWorker(pendingError = null) {
  aiTurnWorker?.removeEventListener("message", handleAiTurnWorkerMessage);
  aiTurnWorker?.removeEventListener("error", handleAiTurnWorkerFailure);
  aiTurnWorker?.removeEventListener("messageerror", handleAiTurnWorkerFailure);
  aiTurnWorker?.terminate();
  aiTurnWorker = null;
  aiTurnWorkerConfiguredNeuralKey = "";
  if (aiTurnWorkerBusyWatchdog) window.clearTimeout(aiTurnWorkerBusyWatchdog);
  aiTurnWorkerBusyWatchdog = null;
  aiTurnWorkerBusyRequestId = "";
  const configuration = pendingAiTurnWorkerConfiguration;
  pendingAiTurnWorkerConfiguration = null;
  if (configuration) {
    window.clearTimeout(configuration.watchdog);
    const error = pendingError || new Error("AI turn Worker configuration was cancelled.");
    if (!pendingError) error.name = "AbortError";
    configuration.reject(error);
  }
  const pending = pendingAiTurnRequest;
  pendingAiTurnRequest = null;
  if (!pending) return;
  const error = pendingError || new Error("AI turn was cancelled.");
  if (!pendingError) error.name = "AbortError";
  pending.reject(error);
}

function resetAiTurnWorkerSession() {
  if (!aiTurnWorker || !aiTurnWorkerConfiguredNeuralKey) return;
  try {
    aiTurnWorker.postMessage(createAiTurnNeuralResetRequest());
  } catch (error) {
    failAiTurnWorker(error);
  }
}

function cancelScheduledAiTurn() {
  aiTurnGeneration += 1;
  if (aiTurnTimer) window.clearTimeout(aiTurnTimer);
  aiTurnTimer = null;
  aiThinking = false;
  const pending = pendingAiTurnRequest;
  pendingAiTurnRequest = null;
  if (pending) {
    const error = new Error("AI turn was cancelled.");
    error.name = "AbortError";
    pending.reject(error);
    // The Worker cannot interrupt synchronous inference. Queue a reset behind
    // the discarded decision so returning from the coach/another screen does
    // not reuse recurrent memory advanced for an action that was never played.
    resetAiTurnWorkerSession();
  }
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
    transfers: [],
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

function prepareUiMotionForCurrentState() {
  observeCurrentGame();
  const viewerId = viewerPlayerId();
  if (motionGame === game
    && motionGameRevision === gameStateRevision
    && motionViewerId === viewerId) {
    pruneEffectAnimations();
    return emptyMotion();
  }
  motionGame = game;
  motionGameRevision = gameStateRevision;
  motionViewerId = viewerId;
  return prepareUiMotion();
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
  motion.transfers = buildTabletopTransfers(previous.cardZones, current.cardZones);
  motion.transfers.push(...buildPrivateHandChainTransfers(
    previous.cardZones,
    current.cardZones,
    previous.chainItems,
    current.chainItems,
    viewerPlayerId(),
    motion.transfers
  ));
  motion.transfers.push(...buildPrivateHiddenChainTransfers(
    previous.cardZones,
    current.cardZones,
    previous.chainItems,
    current.chainItems,
    viewerPlayerId(),
    motion.transfers
  ));
  motion.transfers.push(...buildPrivateHandBoardTransfers(
    previous.cardZones,
    current.cardZones,
    viewerPlayerId(),
    motion.transfers
  ));
  motion.transfers.push(...buildPrivateDeckTransfers(
    previous.cardZones,
    current.cardZones,
    viewerPlayerId(),
    motion.transfers
  ));
  motion.transfers = buildBurnOutDrawTransfers(
    motion.transfers,
    previous.players,
    current.players,
    previous.cardZones,
    current.cardZones
  );
  motion.transfers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  motion.feedback = buildRealtimeFeedback(current, previous, motion);
  rememberEffectAnimations(detectEffectAnimations(previous, current));

  return motion;
}

function rememberEffectAnimations(events) {
  const expiresAt = Date.now() + presentationMotionDuration(EFFECT_ANIMATION_DURATION_MS);
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
      handIds: new Set(player.hand.map((card) => card.instanceId)),
      burnOuts: Math.max(0, Number(player.burnOuts) || 0)
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
    image: cardArtUrl(card) || "",
    location,
    might: uiCurrentMight(card)
  };
}

function visibleChainItems() {
  return (game.actionChain?.chain || game.showdown?.chain || []).filter(chainItemVisibleInTree);
}

function chainItemSnapshot(item, index) {
  const card = item?.card || {};
  const targets = chainItemTargetIds(item);
  const effectPlayOrigin = item.playOptions?.effectPlayOrigin;
  return {
    id: item.id || `${card.instanceId || "chain"}-${index}`,
    cardId: card.instanceId,
    playerId: item.playerId,
    name: chainItemTitle(item),
    rawName: card.name || item.trigger?.label || "",
    sourceName: chainItemSourceTitle(item),
    type: item.itemType || "card",
    sourceZone: item.playOptions?.playProcess?.source || effectPlayOrigin?.zone || "",
    sourcePlayerId: effectPlayOrigin?.playerId || item.playerId || "",
    order: index,
    status: item.status || "pending",
    targetIds: targets
  };
}

function motionCardZone(card, { playerId = "", zone = "", locationId = "", index = 0, faceVisible = true } = {}) {
  if (!card?.instanceId) return null;
  const visible = Boolean(faceVisible && !card.redacted);
  return {
    playerId: String(playerId || card.controllerId || card.ownerId || ""),
    cardType: String(card.type || ""),
    zone,
    locationId: String(locationId || ""),
    index: Number.isFinite(Number(index)) ? Number(index) : 0,
    faceVisible: visible,
    image: visible ? String(cardArtUrl(card) || "") : "",
    name: visible ? String(cardName(card) || "") : "",
    exhausted: Boolean(card.exhausted)
  };
}

function setMotionCardZone(zones, card, options) {
  const location = motionCardZone(card, options);
  if (location) zones.set(card.instanceId, location);
}

function setMotionAttachmentZones(zones, parent, playerId) {
  for (const [index, attachment] of (parent?.attachments || []).entries()) {
    setMotionCardZone(zones, attachment, {
      playerId: attachment.controllerId || attachment.ownerId || playerId,
      zone: "attachment",
      locationId: parent.instanceId,
      index
    });
    setMotionAttachmentZones(zones, attachment, attachment.controllerId || attachment.ownerId || playerId);
  }
}

function cardZoneSnapshot() {
  const zones = new Map();
  const viewerId = viewerPlayerId();
  for (const player of game.players) {
    const handVisible = player.id === viewerId || canViewPrivateInfo(viewerId, player.id);
    player.hand.forEach((card, index) => setMotionCardZone(zones, card, { playerId: player.id, zone: "hand", index, faceVisible: handVisible }));
    player.base.forEach((card, index) => {
      setMotionCardZone(zones, card, { playerId: player.id, zone: "base", locationId: "base", index });
      setMotionAttachmentZones(zones, card, player.id);
    });
    player.runes.forEach((card, index) => setMotionCardZone(zones, card, { playerId: player.id, zone: "runes", index }));
    player.trash.forEach((card, index) => setMotionCardZone(zones, card, { playerId: player.id, zone: "trash", index }));
    (player.banished || []).forEach((card, index) => setMotionCardZone(zones, card, { playerId: player.id, zone: "banished", index }));
    setMotionCardZone(zones, player.legend, { playerId: player.id, zone: "legend" });
    if (player.champion?.zone === "champion") {
      setMotionCardZone(zones, player.champion, { playerId: player.id, zone: "champion" });
    }
    player.mainDeck.forEach((card, index) => setMotionCardZone(zones, card, { playerId: player.id, zone: "mainDeck", index, faceVisible: false }));
    player.runeDeck.forEach((card, index) => setMotionCardZone(zones, card, { playerId: player.id, zone: "runeDeck", index, faceVisible: false }));
  }
  for (const field of game.battlefields) {
    setMotionCardZone(zones, field, { playerId: field.controlledBy, zone: "battlefield", locationId: field.instanceId });
    field.units.forEach((card, index) => {
      setMotionCardZone(zones, card, { playerId: card.controllerId, zone: "battlefield", locationId: field.instanceId, index });
      setMotionAttachmentZones(zones, card, card.controllerId);
    });
    (field.hidden || []).forEach((item, index) => {
      const controllerId = hiddenCardControllerId(item);
      const visible = controllerId === viewerId || canViewPrivateInfo(viewerId, controllerId);
      setMotionCardZone(zones, item?.card, { playerId: controllerId, zone: "hidden", locationId: field.instanceId, index, faceVisible: visible });
    });
  }
  const motionChain = game.actionChain?.chain || game.showdown?.chain || [];
  motionChain.filter(Boolean).forEach((item, index) => setMotionCardZone(zones, item?.card, {
    playerId: item?.playerId,
    zone: "chain",
    locationId: item?.id || `chain-${index}`,
    index,
    faceVisible: cardVisibleToCurrentViewer(item?.card)
  }));
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
  }, presentationMotionDuration(1800));
}

function clearRealtimeFeedback() {
  recentFeedback = null;
  if (feedbackDismissTimer) clearTimeout(feedbackDismissTimer);
  feedbackDismissTimer = null;
}

function clearViewerTransientPresentation() {
  clearRealtimeFeedback();
  clearEffectAnimations();
  resetPresentationState(presentationState);
  motionGame = null;
  motionGameRevision = -1;
  motionViewerId = "";
  presentationGame = null;
  presentationGameRevision = -1;
  presentationViewerId = "";
  previousUiSnapshot = null;
  uiMotion = emptyMotion();
  activeImpact = null;
  staticImpactPreview = false;
  actionRejection = null;
  chainTreePresentationItems = [];
  chainTreeCacheGame = null;
  chainTreeCacheRevision = -1;
  chainTreeCacheViewerId = "";
  chainTreeCacheItems = null;
  if (impactDismissTimer) clearTimeout(impactDismissTimer);
  impactDismissTimer = null;
  clearTabletopFlightAnimations();
  clearTabletopStateMotions(document);
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
  if (game.phase === "first-player") {
    const method = game.firstPlayerDecision?.method;
    if (method === "roll") return t("firstPlayerRoll", locale());
    if (method === "preset") return locale() === LOCALES.KO ? "선후공 확인" : "Confirm play order";
    return locale() === LOCALES.KO ? "선후공 선택" : "Choose play order";
  }
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
  const mine = (!isOnlineGame() && !aiMode && !replayMode) || actorId === viewerPlayerId();

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
    const decisionVisible = decisionVisibleToViewer(payment);
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
    const decisionVisible = decisionVisibleToViewer(choice);
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
  if (game.phase === "first-player") {
    return game.firstPlayerDecision?.method === "roll"
      ? t("roll", locale())
      : (locale() === LOCALES.KO ? "선후공" : "Play order");
  }
  if (game.phase === "champion-select") return t("champion", locale());
  if (game.phase === "battlefield-select") return t("setup", locale());
  if (game.phase === "mulligan") return t("mulligan", locale());
  if (game.phase === "showdown") return t("showdown", locale());
  return t("turn", locale(), { n: game.turnNumber });
}

function firstPlayerPanel() {
  const decision = game.firstPlayerDecision;
  if (decision?.method === "roll") return firstPlayerRollPanel(decision);
  if (decision?.method === "designated") return designatedFirstPlayerPanel(decision);
  const first = game.players.find((player) => player.id === game.firstPlayerId);
  const second = game.players.find((player) => player.id !== game.firstPlayerId);
  if (!first || !second) return privateFirstPlayerWaitingPanel(null);
  return `
    <section class="first-player-screen">
      <article class="first-player-card">
        <div class="section-head">
          <div>
            <h2>${t("firstPlayer", locale())}</h2>
            <span>${game.officialMatchSetup || game.singleGameSideboardSetup
              ? (locale() === LOCALES.KO ? "전장 공개 후 확정된 선후공입니다." : "This play order is confirmed after both Battlefields are revealed.")
              : t("decidedBeforeSetup", locale())}</span>
          </div>
        </div>
        <div class="first-player-result setup-loadout-result">
          <div class="first-seat first" data-player-id="${escapeHtml(first.id)}">
            ${firstPlayerLoadout(first)}
            <strong>${t("first", locale())}</strong>
            <span>${playerName(first)}</span>
          </div>
          <div class="versus">${locale() === LOCALES.KO ? "대" : "VS"}</div>
          <div class="first-seat second" data-player-id="${escapeHtml(second.id)}">
            ${firstPlayerLoadout(second)}
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
        <div class="first-player-result setup-loadout-result dice-results">
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
    <div class="first-seat dice-seat ${active ? "active" : ""} ${winner ? "roll-winner" : ""}" data-player-index="${index}" data-player-id="${escapeHtml(player.id)}">
      ${firstPlayerLoadout(player)}
      <span class="die-face ${displayValue == null ? "pending" : ""}" aria-label="${displayValue == null ? t("waitingForRoll", locale()) : t("rolledNumber", locale(), { n: displayValue })}">${displayValue ?? "?"}</span>
      <strong>${displayValue == null ? t("waitingForRoll", locale()) : t("rolledNumber", locale(), { n: displayValue })}</strong>
      <span>${playerName(player)}</span>
    </div>
  `;
}

function selectedSetupBattlefield(player) {
  if (!player) return null;
  const battlefields = Array.isArray(game?.battlefields) ? game.battlefields : [];
  return battlefields.find((field) => field
    && (field.ownerId === player.id
      || (player.selectedBattlefieldId && field.instanceId === player.selectedBattlefieldId))) || null;
}

function firstPlayerLoadout(player) {
  if (!player) return "";
  const roles = [
    { key: "legend", label: t("legend", locale()), card: player.legend },
    { key: "champion", label: t("champion", locale()), card: player.champion },
    { key: "battlefield", label: t("battlefield", locale()), card: selectedSetupBattlefield(player) }
  ];
  return `
    <div class="first-player-loadout" aria-label="${escapeHtml(`${playerName(player)} ${locale() === LOCALES.KO ? "공개 구성" : "revealed setup"}`)}">
      ${roles.map(({ key, label, card }) => `
        <div class="first-player-loadout-card ${card && !card.redacted ? "revealed" : "unavailable"}" data-setup-role="${key}">
          <small>${escapeHtml(label)}</small>
          ${card && !card.redacted
            ? `${imageCard(card, "select-only")}<span>${escapeHtml(cardName(card))}</span>`
            : `<div class="setup-card-placeholder" aria-label="${escapeHtml(`${label} ${t("waiting", locale())}`)}"><b>?</b></div><span>${t("waiting", locale())}</span>`}
        </div>
      `).join("")}
    </div>
  `;
}

function winnerName() {
  return game.players.find((player) => player.id === game.winnerId)?.name || t("nobody", locale());
}

function completedGameExitLabel() {
  if (isOnlineGame()) return locale() === LOCALES.KO ? "로비로 돌아가기" : "Return to lobby";
  return locale() === LOCALES.KO ? "메인 메뉴로" : "Main menu";
}

function completedGameExitGateMessage() {
  const korean = locale() === LOCALES.KO;
  if (isOnlineGame()) {
    return korean
      ? "로비로 이동하기 전에 이 경기의 로그 전송 여부를 선택해 주세요."
      : "Choose whether to send this game's log before returning to the lobby.";
  }
  return korean
    ? "메인 메뉴로 이동하기 전에 이 경기의 로그 전송 여부를 선택해 주세요."
    : "Choose whether to send this game's log before returning to the main menu.";
}

function exitCompletedGame() {
  if (appView !== "game" || (!matchIsBetweenGames() && game?.phase !== "complete")) return false;
  if (initialSideboardingActive()) {
    if (isOnlineGame()) void onlineLeaveRoom();
    else {
      appView = "menu";
      resetGameUiState();
      render();
    }
    return true;
  }
  if (!bugReportDecisionResolved()) {
    resultDismissed = false;
    bugReportUi.error = completedGameExitGateMessage();
    render();
    return false;
  }
  settleReplayAnalysesWithoutCoaching(aiReplay);
  // This click is recorded before the action handler runs. Remove that final
  // breadcrumb copy and retire the in-memory recorder too. An online room can
  // emit one last snapshot while it is being left; keeping the recorder alive
  // would persist the already-resolved report again during that short window.
  forgetPersistedGameDiagnostic();
  gameDiagnostic = null;
  if (isOnlineGame()) {
    void onlineLeaveRoom();
    return true;
  }
  appView = "menu";
  resetGameUiState();
  render();
  return true;
}

function updateGamePresentation() {
  const snapshot = snapshotPresentationGame(game, (card) => uiCurrentMight(card), viewerPlayerId());
  const update = advancePresentation(presentationState, snapshot, viewerPlayerId());
  if (update.impact) rememberCinematicImpact(update.impact);
  return update;
}

function updateGamePresentationForCurrentState() {
  observeCurrentGame();
  const viewerId = viewerPlayerId();
  if (presentationGame === game
    && presentationGameRevision === gameStateRevision
    && presentationViewerId === viewerId) return { impact: null };
  presentationGame = game;
  presentationGameRevision = gameStateRevision;
  presentationViewerId = viewerId;
  return updateGamePresentation();
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
  }, presentationMotionDuration(finalImpact ? 2200 : 1150));
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
    <section class="result-modal match-result-modal modal-panel ${won ? "result-victory" : "result-defeat"}" role="dialog" aria-modal="true" aria-labelledby="match-result-title" data-ui-modal data-modal-key="match-result" tabindex="-1">
      <div class="result-scroll-region">
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
        ${gameBugReportPanel()}
        ${!bugReportDecisionResolved() ? `<p class="game-bug-report-gate">${escapeHtml(completedGameExitGateMessage())}</p>` : ""}
      </div>
      <div class="result-actions ${isOnlineGame() ? "" : "three-actions"}">
        <button type="button" class="secondary" data-action="review-result" data-primary-focus>${korean ? "전장 돌아보기" : "Review battlefield"}</button>
        ${isOnlineGame() ? "" : `<button type="button" class="secondary" data-action="new-game" ${!bugReportDecisionResolved() ? "disabled" : ""}>${t("newGame", locale())}</button>`}
        <button type="button" class="primary exit-completed-game" data-action="exit-completed-game">${completedGameExitLabel()}</button>
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
    <section class="result-modal game-exit-modal modal-panel" role="dialog" aria-modal="true" aria-labelledby="game-exit-title" data-ui-modal data-modal-key="game-exit" tabindex="-1">
      <div class="result-modal-copy">
        <span>${restarting ? t("newGame", locale()) : t("surrender", locale())}</span>
        <h2 id="game-exit-title">${t(restarting ? "restartConfirmTitle" : "surrenderConfirmTitle", locale())}</h2>
        <p>${t(restarting ? "restartConfirmDetail" : "surrenderConfirmDetail", locale())}</p>
      </div>
      <div class="actions game-exit-actions">
        <button type="button" data-action="cancel-game-exit" data-primary-focus>${t("continueGame", locale())}</button>
        <button type="button" class="danger" data-action="confirm-game-exit">${restarting ? t("newGame", locale()) : t("surrender", locale())}</button>
      </div>
    </section>
  `;
}

function scoreTrack() {
  const left = viewerPlayer();
  const right = opponentPlayer();
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
  const battlefieldCount = Array.isArray(game?.battlefields) ? game.battlefields.length : 0;
  const selected = uiSelectedCard();
  const bottomPlayer = viewerPlayer();
  const topPlayer = opponentPlayer();
  const showPaymentStage = decisionVisibleToViewer(game.pendingPayment);
  const showChoiceStage = decisionVisibleToViewer(game.pendingChoice);
  const choiceSurface = showChoiceStage && !replayMode ? choiceCardSurface(game.pendingChoice) : "none";
  const commandChoice = ["hand", "pile", "board", "damage"].includes(choiceSurface);
  return `
    <div class="play-area tabletop-board ${actingPlayerClass()} ${showPaymentStage ? "payment-active" : ""} ${isOnlineGame() && !viewerCanAct() ? "waiting-for-opponent" : ""} ${online.commandPending ? "command-pending" : ""}" data-phase="${escapeHtml(game.phase || "unknown")}" aria-busy="${online.commandPending ? "true" : "false"}">
      <section class="board-panel" aria-label="${t("gameBoard", locale())}">
        <div class="board-band opponent-band">
          <span class="side-label">${t("opponentSide", locale())}</span>
          ${playerSide(topPlayer, "top")}
          ${opponentHandFan(topPlayer)}
        </div>
        ${chainZonePanel()}
        ${realtimeFeedbackOverlay()}
        <div class="location-band" data-zone="battlefields" data-count="${battlefieldCount}">
          <span class="zone-caption battlefield-caption">${t("battlefield", locale())}</span>
          <section class="battlefield-mat ${battlefieldCount > 2 ? "has-extra-battlefields" : ""}" aria-label="${t("battlefields", locale())}" data-scroll-key="battlefield-scroll">
            ${battlefieldColumns()}
          </section>
        </div>
        <div class="board-band player-band">
          <span class="side-label">${t("playerSide", locale())}</span>
          ${playerSide(bottomPlayer, "bottom")}
        </div>
      </section>
      <div class="table-command-layer">
        ${showPaymentStage ? paymentPanel() : ""}
        ${showPaymentStage ? "" : commandChoice ? commandChoiceSurface(game.pendingChoice) : actionBar(player, selected)}
        ${handDrawer(player)}
      </div>
      ${tableUtilityRail(inspectedCard() || selected)}
    </div>
  `;
}

function designatedFirstPlayerPanel(decision) {
  const chooser = game.players.find((player) => player.id === decision.chooserId);
  const canChoose = Boolean(chooser && viewerCanAct());
  return `
    <section class="first-player-screen">
      <article class="first-player-card designated-order-card">
        <div class="section-head">
          <div>
            <h2>${locale() === LOCALES.KO ? "선후공 선택" : "Choose play order"}</h2>
            <span>${locale() === LOCALES.KO ? "전장을 동시에 공개했습니다." : "Both Battlefields have been revealed."}</span>
          </div>
        </div>
        <p class="dice-order-notice">${locale() === LOCALES.KO
          ? `${escapeHtml(playerName(chooser))}님이 이번 게임의 선공 플레이어를 선택합니다.`
          : `${escapeHtml(playerName(chooser))} chooses who plays first this game.`}</p>
        <div class="first-player-result setup-loadout-result">
          ${game.players.map((player, index) => `
            ${index ? `<div class="versus">${locale() === LOCALES.KO ? "대" : "VS"}</div>` : ""}
            <div class="first-seat" data-player-id="${escapeHtml(player.id)}">
              ${firstPlayerLoadout(player)}
              <strong>${escapeHtml(playerName(player))}</strong>
              <span>${locale() === LOCALES.KO ? "선공 후보" : "First-player candidate"}</span>
            </div>
          `).join("")}
        </div>
        <div class="play-order-actions">
          ${game.players.map((player) => `<button class="${player.id === chooser?.id ? "primary" : "secondary"}" data-action="choose-first-player" data-player="${escapeHtml(player.id)}" ${canChoose ? "" : "disabled"}>${locale() === LOCALES.KO ? `${escapeHtml(playerName(player))} 선공` : `${escapeHtml(playerName(player))} plays first`}</button>`).join("")}
        </div>
      </article>
    </section>
  `;
}

function gameFloatingPanels() {
  const showPendingChoice = decisionVisibleToViewer(game.pendingChoice);
  const choiceSurface = showPendingChoice ? (replayMode ? "panel" : choiceCardSurface(game.pendingChoice)) : "none";
  const sidePanelChoice = showPendingChoice && choiceSurface === "panel";
  const blocking = sidePanelChoice;
  const liveBlocking = blocking && !replayMode;
  return `
    <div class="floating-panels ${game.phase === "showdown" ? "showdown-dock" : ""} ${liveBlocking ? "has-modal has-blocking-decision" : ""} ${blocking && replayMode ? "replay-readonly-decision" : ""}">
      ${sidePanelChoice ? choicePanel() : ""}
      ${showPendingChoice ? "" : graveyardOpenPlayerId ? graveyardPanel(graveyardOpenPlayerId) : ""}
      ${showPendingChoice ? "" : banishedOpenPlayerId ? banishedPanel(banishedOpenPlayerId) : ""}
      ${showPendingChoice ? "" : intelOpenPlayerId ? intelPanel(intelOpenPlayerId) : ""}
    </div>
  `;
}

function closeTabletopSheets(keep = "") {
  if (keep !== "inspector") {
    inspectorOpen = false;
    inspectorPreviewCard = null;
    attachmentsOpenCardId = null;
  }
  if (keep !== "graveyard") graveyardOpenPlayerId = null;
  if (keep !== "banished") banishedOpenPlayerId = null;
  if (keep !== "intel") intelOpenPlayerId = null;
  if (keep !== "log") logOpen = false;
}

function toggleTabletopSheet(kind, value = true) {
  const open = kind === "inspector"
    ? inspectorOpen
    : kind === "graveyard"
      ? graveyardOpenPlayerId === value
      : kind === "banished"
        ? banishedOpenPlayerId === value
        : kind === "intel"
          ? intelOpenPlayerId === value
          : kind === "log"
            ? logOpen
            : false;
  closeTabletopSheets(open ? "" : kind);
  if (open) return;
  if (kind === "inspector") inspectorOpen = true;
  if (kind === "graveyard") graveyardOpenPlayerId = value;
  if (kind === "banished") banishedOpenPlayerId = value;
  if (kind === "intel") intelOpenPlayerId = value;
  if (kind === "log") logOpen = true;
}

function uiSelectedCard() {
  return game.selectedCardId ? getSelectedCard(game) : null;
}

function inspectedChainCard() {
  if (!inspectedChainItemId) return null;
  const item = currentChainTreeItems().find((candidate) => candidate?.id === inspectedChainItemId);
  const snapshot = chainItemSourceCard(item);
  if (!snapshot || snapshot.redacted) return null;
  return findVisibleCard(snapshot.instanceId || snapshot.id) || snapshot;
}

function inspectedCard() {
  return inspectorPreviewCard || inspectedChainCard() || uiSelectedCard();
}

function chainPreviewCard(cardId) {
  const previewId = String(cardId || "");
  const item = currentChainTreeItems().find((candidate) => {
    const source = chainItemSourceCard(candidate);
    return source?.instanceId === previewId
      || source?.id === previewId
      || candidate?.trigger?.sourceCardId === previewId;
  });
  return findVisibleCard(previewId) || chainItemSourceCard(item) || null;
}

function toggleInspectedChainItem(chainItemId) {
  const requestedId = String(chainItemId || "");
  inspectedChainItemId = requestedId && inspectedChainItemId !== requestedId ? requestedId : null;
  inspectorPreviewCard = null;
  fullCardOpen = false;
  fullCardPreviewCard = null;
  syncInspectedChainTargets();
  if (inspectedChainItemId && inspectedChainCard()) {
    inspectorOpen = true;
    closeTabletopSheets("inspector");
  } else if (!inspectedChainItemId) {
    inspectorOpen = false;
  }
}

function focusChainTarget(cardId) {
  const preview = findVisibleCard(String(cardId || ""));
  if (!preview || preview.redacted || !cardVisibleToCurrentViewer(preview)) return;
  inspectorPreviewCard = preview;
  inspectorOpen = true;
  closeTabletopSheets("inspector");
}

function handDrawer(player) {
  const seat = tabletopSeatView(player, {
    side: "bottom",
    visibleHandCount: handCountVisibleToViewer(game, player, viewerPlayerId()),
    revealHand: true
  });
  const cardCount = seat.counts.hand;
  return `
    <section class="hand-drawer persistent-hand ${handOpen ? "open focused" : "closed"}" data-zone="hand" data-count="${cardCount}" data-player-id="${escapeHtml(seat.id)}">
      <div class="hand-panel" aria-label="${escapeHtml(`${playerName(player)} ${t("hand", locale())} ${cardCount}`)}">
        <div class="section-head">
          <h2>${playerName(player)} ${t("hand", locale())}</h2>
          <span>${t("cardCount", locale(), { n: cardCount })}</span>
          <button type="button" class="hand-focus-toggle" data-action="toggle-hand" aria-expanded="${handOpen}">${handOpen ? t("hideHand", locale()) : t("hand", locale())}</button>
        </div>
        <div class="cards hand-fan" data-scroll-key="hand-scroll">${seat.hand.map((card, index) => handCard(card, index, seat.hand.length)).join("") || `<p class="empty">${t("noCardsInHand", locale())}</p>`}</div>
      </div>
    </section>
  `;
}

function opponentHandFan(player) {
  const revealHand = canViewPrivateInfo(viewerPlayerId(), player?.id);
  const visibleCount = handCountVisibleToViewer(game, player, viewerPlayerId());
  const seat = tabletopSeatView(player, { side: "top", visibleHandCount: visibleCount, revealHand });
  const count = seat.counts.hand;
  const cards = Array.from({ length: count }, (_, index) => seat.visibleHandCards[index] || null);
  return `
    <section class="opponent-hand persistent-hand" data-zone="hand" data-count="${count}" data-player-id="${escapeHtml(seat.id)}" aria-label="${escapeHtml(`${playerName(player)} ${t("hand", locale())} ${count}`)}">
      <span class="zone-caption">${t("hand", locale())} <b>${count}</b></span>
      <div class="opponent-hand-fan">
        ${cards.map((card, index) => card
          ? `<article class="opponent-hand-card revealed-card" data-hand-card style="${fanCardStyle(index, count, { maxAngle: 18, maxRise: 12, reverse: true })}" data-card-id="${escapeHtml(card.instanceId || "")}" role="button" tabindex="0" aria-label="${escapeHtml(cardName(card))}">${cardImage(card)}</article>`
          : `<span class="opponent-hand-card card-back" data-hand-card style="${fanCardStyle(index, count, { maxAngle: 18, maxRise: 12, reverse: true })}" aria-label="${escapeHtml(`${t("opponentSide", locale())} ${t("hand", locale())} ${index + 1}`)}"><i aria-hidden="true">R</i></span>`
        ).join("") || `<span class="empty-hand-count">0</span>`}
      </div>
    </section>
  `;
}

function moveBatchCommandGroup(player) {
  const units = [...moveSelection].map((unitId) => findVisibleCard(unitId)).filter(Boolean);
  if (game.phase !== "action" || game.pendingPayment || game.pendingChoice || units.length < 2) return "";
  const destinations = batchMoveDestinations(units);
  return `
    <div class="move-batch-command-group" role="group" aria-label="${escapeHtml(`${t("standardMove", locale())}: ${units.length} ${t("units", locale())}`)}">
      <span>${t("standardMove", locale())}: ${units.length} ${t("units", locale())}</span>
      <div class="actions inline">
        ${destinations.map((destination) => `
          <button data-action="batch-move" data-destination="${destination.id}">${destination.label}</button>
        `).join("") || `<button disabled>${t("noSharedDestination", locale())}</button>`}
        <button data-action="clear-move-selection">${t("clear", locale())}</button>
      </div>
    </div>
  `;
}

function batchMoveDestinations(units) {
  const options = [];
  const destinationIds = new Set(enumerateUiMoveUnitsActions(
    game,
    units.map((unit) => unit.instanceId),
    viewerPlayerId()
  ).map((action) => action.destinationId));
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
    <aside class="log-drawer" role="dialog" aria-modal="false" aria-label="${t("eventTimeline", locale())}" data-ui-sheet="log">
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

function logEntryView(entry, index, total = (game.log || []).length) {
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
  if (!payment || typeof payment !== "object") return "";
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  if (!player) {
    const issue = locale() === LOCALES.KO
      ? "비용을 지불할 플레이어 정보를 확인할 수 없습니다. 결제를 취소하고 다시 시도해 주세요."
      : "The paying player is unavailable. Cancel this payment and try again.";
    return `
      <section class="payment-stage-banner payment-panel payment-stage-error" role="alert" data-payment-stage>
        <div class="payment-stage-copy">
          <span class="payment-stage-kicker">${locale() === LOCALES.KO ? "비용 지불 단계" : "PAYMENT STEP"}</span>
          <div class="payment-stage-title-row"><h2>${t("paymentRequired", locale())}</h2></div>
          <p>${issue}</p>
        </div>
        <div class="payment-stage-controls actions inline">
          <button data-action="cancel-payment">${t("cancel", locale())}</button>
        </div>
      </section>
    `;
  }
  const resumeLegality = paymentResumeLegality(game, payment);
  if (!resumeLegality.ok) {
    const issue = locale() === LOCALES.KO
      ? "이전에 진행 중이던 비용 지불 상태를 안전하게 복구할 수 없습니다. 현재 결제를 취소하고 다시 시도해 주세요."
      : "The previous payment state cannot be restored safely. Cancel this payment and try again.";
    return `
      <section class="payment-stage-banner payment-panel payment-stage-error" role="alert" data-payment-stage data-invalid-resume-payment>
        <div class="payment-stage-copy">
          <span class="payment-stage-kicker">${locale() === LOCALES.KO ? "비용 지불 단계" : "PAYMENT STEP"}</span>
          <div class="payment-stage-title-row"><h2>${t("paymentRequired", locale())}</h2></div>
          <p>${issue}</p>
        </div>
        <div class="payment-stage-controls actions inline">
          <button data-action="cancel-payment" data-primary-focus>${t("cancel", locale())}</button>
        </div>
      </section>
    `;
  }
  const card = paymentDisplayCard(player, payment);
  const displayCard = card || { name: payment.cardName || t("effectPayment", locale()), energy: payment.energyCost || 0, power: [] };
  const powerCost = Array.isArray(payment.powerCost)
    ? payment.powerCost.filter((requirement) => requirement && typeof requirement === "object")
    : Array.isArray(displayCard.power)
      ? displayCard.power.filter((requirement) => requirement && typeof requirement === "object")
      : [];
  const energyNeeded = payment.energyCost ?? displayCard.energy ?? 0;
  const poolEnergySelected = payment.poolEnergyIds?.length || 0;
  const paymentReady = paymentConfirmationLegality(game).ok;
  const modalAttributes = replayMode
    ? `role="region" aria-labelledby="payment-stage-title" aria-readonly="true" data-replay-readonly-decision inert`
    : `role="region" aria-labelledby="payment-stage-title" aria-describedby="payment-stage-help" data-payment-stage data-modal-key="payment-${escapeHtml(payment.id || payment.cardId || payment.source || "pending")}"`;
  const directRuneStates = (player.runes || []).map((rune) => ({
    rune,
    payment: directRunePaymentState(rune, player.id)
  }));
  const energyRuneInputAvailable = directRuneStates.some(({ rune, payment: runePayment }) =>
    runePayment.canPayEnergy && tutorialAllowsUiAction("pay-rune", { rune: rune.instanceId, mode: "energy" }));
  const powerRuneInputAvailable = directRuneStates.some(({ rune, payment: runePayment }) =>
    runePayment.canPayPower && tutorialAllowsUiAction("pay-rune", { rune: rune.instanceId, mode: "power" }));
  const help = [
    energyRuneInputAvailable
      ? (locale() === LOCALES.KO ? "룬을 클릭하거나 짧게 눌러 에너지를 지불합니다." : "Click or tap a Rune to pay Energy.")
      : "",
    powerRuneInputAvailable
      ? (locale() === LOCALES.KO
          ? "룬을 오른쪽 클릭하거나 길게 누르거나 Shift+Enter를 눌러 힘을 지불합니다."
          : "Right-click, touch and hold, or press Shift+Enter on a Rune to pay Power.")
      : "",
    locale() === LOCALES.KO
      ? "생성 자원은 아래에서 선택하고 전설·문장 등 자원 능력도 바로 사용할 수 있습니다."
      : "Select generated resources below, or activate a Legend, Seal, or another resource ability."
  ].filter(Boolean).join(" ");
  return `
    <section class="payment-stage-banner payment-panel" ${modalAttributes}>
      <div class="payment-stage-copy">
        <span class="payment-stage-kicker">${locale() === LOCALES.KO ? "비용 지불 단계" : "PAYMENT STEP"}</span>
        <div class="payment-stage-title-row">
          <h2 id="payment-stage-title">${t("paymentRequired", locale())}</h2>
          <span>${paymentCostSummary(player, displayCard, payment, energyNeeded, poolEnergySelected, powerCost)}</span>
        </div>
        <p id="payment-stage-help">${help}</p>
      </div>
      <div class="payment-stage-resources">
          ${optionalPaymentControls(payment)}
          ${paymentAddControls(player)}
          ${poolEnergyControls(player, payment)}
          ${poolPowerControls(powerCost)}
      </div>
      <div class="payment-stage-controls actions inline">
        <button data-action="cancel-payment">${t("cancel", locale())}</button>
        <button class="primary" data-action="confirm-payment" ${paymentReady ? "data-primary-focus" : "disabled"}>${paymentReady ? t("confirm", locale()) : t("selectCost", locale())}</button>
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
  const energyRunesSelected = Array.isArray(payment.energyRuneIds) ? payment.energyRuneIds.length : 0;
  if (energyNeeded > 0) parts.push(`${t("energy", locale())} ${energyRunesSelected + poolEnergySelected}/${energyNeeded}`);
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
        const sourceName = localizedEffectSource(resource.sourceName) || t("generatedEnergy", locale());
        return `
          <button
            class="pool-energy ${selected ? "selected" : ""}"
            data-action="pay-pool-energy"
            data-energy="${escapeHtml(resource.id || "")}"
            aria-pressed="${selected}"
            ${resource.canToggle ? "" : "disabled"}
            title="${escapeHtml(sourceName)}${resource.restriction ? ` - ${escapeHtml(resource.restriction)} only` : ""}"
          >
            <span class="pool-energy-orb">${domainSwatches(resource.domains)}</span>
            <strong>${selected ? t("selected", locale()) : `${t("energy", locale())} +1`}</strong>
            <span>${escapeHtml(sourceName)}</span>
          </button>
        `;
      }).join("")}
      </div>
    </section>
  `;
}

function poolPowerControls(powerCost) {
  const pool = legalPaymentPoolPowerOptions(game);
  if (!pool.length || totalPowerAmount(powerCost) <= 0) return "";
  return `
    <section class="payment-resource-group generated-resource-group">
      <div class="payment-resource-heading">
        <strong>${locale() === LOCALES.KO ? "생성된 힘" : "Generated Power"}</strong>
        <span>${locale() === LOCALES.KO ? "비용과 일치하는 힘만 사용할 수 있습니다" : "Only matching Power can be spent"}</span>
      </div>
      <div class="pool-energy-list">
      ${pool.map((resource) => {
        const selected = resource.selected;
        return `
          <button
            class="pool-power ${selected ? "selected" : ""}"
            data-action="pay-pool-power"
            data-power="${escapeHtml(resource.id || "")}"
            aria-pressed="${selected}"
            ${resource.canToggle ? "" : "disabled"}
            title="${escapeHtml(resource.sourceName || t("generatedPower", locale()))}${resource.restriction ? ` - ${escapeHtml(resource.restriction)} only` : ""}"
          >
            <strong>${domainText(resource.domain)} ${t("power", locale())} +1</strong>
            <span>${escapeHtml(localizedEffectSource(resource.sourceName) || t("generatedPower", locale()))}</span>
          </button>
        `;
      }).join("")}
      </div>
    </section>
  `;
}

function poolEnergyCanPay(resource, card = null) {
  if (!resource?.restriction) return true;
  if (resource.restriction === "showdown") return game.phase === "showdown";
  if (resource.restriction === "spell") {
    const pendingCard = game.pendingPayment
      ? game.players.find((player) => player.id === game.pendingPayment.playerId)?.hand.find((candidate) => candidate.instanceId === game.pendingPayment.cardId)
        || findVisibleCard(game.pendingPayment.cardId)
      : card;
    return pendingCard?.type === "spell";
  }
  if (resource.restriction === "unitOrUnitAbility") {
    const pendingCard = card || (game.pendingPayment
      ? paymentDisplayCard(
        game.players.find((player) => player.id === game.pendingPayment.playerId),
        game.pendingPayment
      )
      : null);
    return Boolean(pendingCard && cardHasType(pendingCard, "unit"));
  }
  if (resource.restriction === "gear") {
    const pendingCard = card || (game.pendingPayment
      ? paymentDisplayCard(
        game.players.find((player) => player.id === game.pendingPayment.playerId),
        game.pendingPayment
      )
      : null);
    return Boolean(pendingCard && cardHasType(pendingCard, "gear"));
  }
  return false;
}

function poolPowerCanPay(resource, card = null) {
  if (!resource?.restriction) return true;
  if (resource.restriction === "showdown") return game.phase === "showdown";
  if (resource.restriction === "spell") return card?.type === "spell";
  if (resource.restriction === "unitOrUnitAbility") return Boolean(card && cardHasType(card, "unit"));
  if (resource.restriction === "gear") return Boolean(card && cardHasType(card, "gear"));
  return false;
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
  const power = Array.isArray(player?.runePool?.power) ? player.runePool.power : [];
  return power.map((resource, index) => {
    if (resource && typeof resource === "object") return resource;
    return { id: `legacy-power-${player.id}-${index}`, instanceId: `legacy-power-${player.id}-${index}`, domain: resource || "Any" };
  });
}

function powerProgress(player, card, payment) {
  const powerCost = Array.isArray(payment?.powerCost)
    ? payment.powerCost.filter((requirement) => requirement && typeof requirement === "object")
    : Array.isArray(card?.power)
      ? card.power.filter((requirement) => requirement && typeof requirement === "object")
      : [];
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
  if (!Array.isArray(requirements)) return 0;
  return requirements.reduce((sum, requirement) => sum + Math.max(0, Number(requirement?.amount) || 0), 0);
}

function runeCanPayPower(rune, card, payment, powerCost) {
  const powerRuneIds = payment.powerRuneIds || [];
  if (powerRuneIds.includes(rune.instanceId)) return true;
  if (!powerCost.some((requirement) => powerMatches(rune, requirement))) return false;
  if (powerRuneIds.length + (payment.poolPowerIds?.length || 0) >= totalPowerAmount(powerCost)) return false;
  return true;
}

function directRunePaymentState(rune, playerId) {
  const inactive = {
    active: false,
    energySelected: false,
    powerSelected: false,
    canPayEnergy: false,
    canPayPower: false
  };
  const payment = game?.pendingPayment;
  if (!rune || typeof rune !== "object" || !payment || payment.playerId !== playerId) return inactive;
  if (!decisionVisibleToViewer(payment) || replayMode || !viewerCanAct()) return inactive;
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  if (!player) return inactive;
  const card = paymentDisplayCard(player, payment) || {
    name: payment.cardName || t("effectPayment", locale()),
    energy: Math.max(0, Number(payment.energyCost) || 0),
    power: Array.isArray(payment.powerCost) ? payment.powerCost : []
  };
  const energyRuneIds = Array.isArray(payment.energyRuneIds) ? payment.energyRuneIds : [];
  const powerRuneIds = Array.isArray(payment.powerRuneIds) ? payment.powerRuneIds : [];
  const energySelected = energyRuneIds.includes(rune.instanceId);
  const powerSelected = powerRuneIds.includes(rune.instanceId);
  const energyCost = Math.max(0, Number(payment.energyCost ?? card.energy) || 0);
  const selectedEnergy = energyRuneIds.length + (Array.isArray(payment.poolEnergyIds) ? payment.poolEnergyIds.length : 0);
  const powerCost = Array.isArray(payment.powerCost) ? payment.powerCost : (Array.isArray(card.power) ? card.power : []);
  return {
    active: true,
    energySelected,
    powerSelected,
    canPayEnergy: energySelected || (!rune.exhausted && energyCost > 0 && selectedEnergy < energyCost),
    canPayPower: powerSelected || (totalPowerAmount(powerCost) > 0 && runeCanPayPower(rune, card, payment, powerCost))
  };
}

function domainSwatches(domains = ["Any"]) {
  const safeDomains = Array.isArray(domains) && domains.length ? domains : ["Any"];
  return safeDomains.map((domain) => `<span style="--swatch:${RUNE_COLORS[domain] || RUNE_COLORS.Any || "#e9e2d1"}"></span>`).join("");
}

function graveyardPanel(playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return "";
  return `
    <section class="graveyard-panel modal-panel" role="dialog" aria-modal="false" aria-labelledby="graveyard-panel-title" data-ui-sheet="graveyard">
      <div class="section-head">
        <div>
          <h2 id="graveyard-panel-title">${playerName(player)} ${t("trash", locale())}</h2>
          <span>${t("cardCount", locale(), { n: player.trash.length })}</span>
        </div>
        <button data-action="close-graveyard">${t("close", locale())}</button>
      </div>
      <div class="cards graveyard-cards" data-scroll-key="graveyard-${player.id}">
        ${player.trash.map((card) => `
          <div class="graveyard-card-entry pile-browser-entry">
            <article class="${imageCardClass(card, "graveyard-card pile-browser-card")}" data-card-id="${escapeHtml(card.instanceId || "")}" role="button" tabindex="0" aria-label="${escapeHtml(cardName(card))}">
              <span class="pile-browser-art">${cardImage(card)}</span>
              <span class="pile-browser-copy"><strong>${escapeHtml(cardName(card))}</strong><small>${escapeHtml(cardTags(card).join(" · "))}</small></span>
            </article>
            ${player.id === viewerPlayerId() ? `<div class="pile-browser-actions">${trashActions(card, player).join("")}</div>` : ""}
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
    <section class="graveyard-panel modal-panel banished-panel" role="dialog" aria-modal="false" aria-labelledby="banished-panel-title" data-ui-sheet="banished">
      <div class="section-head">
        <div><h2 id="banished-panel-title">${playerName(player)} ${t("banished", locale())}</h2><span>${t("cardCount", locale(), { n: cards.length })}</span></div>
        <button data-action="close-banished">${t("close", locale())}</button>
      </div>
      <div class="cards graveyard-cards" data-scroll-key="banished-${player.id}">
        ${cards.map((card) => `
          <div class="pile-browser-entry">
            <article class="${imageCardClass(card, "graveyard-card pile-browser-card")}" data-card-id="${escapeHtml(card.instanceId || "")}" role="button" tabindex="0" aria-label="${escapeHtml(cardName(card))}">
              <span class="pile-browser-art">${cardImage(card)}</span>
              <span class="pile-browser-copy"><strong>${escapeHtml(cardName(card))}</strong><small>${escapeHtml(cardTags(card).join(" · "))}</small></span>
            </article>
          </div>
        `).join("") || `<p class="empty">${t("banishedEmpty", locale())}</p>`}
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
    <section class="intel-panel modal-panel reveal-panel" role="dialog" aria-modal="false" aria-labelledby="intel-panel-title" data-ui-sheet="intel" data-scroll-key="intel-${escapeHtml(player.id)}">
      <div class="section-head">
        <div>
          <h2 id="intel-panel-title">${playerName(player)}: ${t("revealedIntel", locale())}</h2>
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

function choiceModalAttributes(choice, { inline = false } = {}) {
  const key = `choice-${choice?.id || choice?.effect || "pending"}`;
  const label = localizedChoicePrompt(choice) || (locale() === LOCALES.KO ? "효과 선택" : "Effect choice");
  if (replayMode) return `role="region" aria-label="${escapeHtml(label)}" aria-readonly="true" data-replay-readonly-decision inert`;
  if (inline || pendingChoiceSharesChainSurface(choice)) {
    return `role="region" aria-label="${escapeHtml(label)}" aria-live="polite" data-choice-stage="${escapeHtml(key)}"`;
  }
  return `role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}" data-ui-modal data-modal-key="${escapeHtml(key)}" tabindex="-1"`;
}

function choiceUiKey(choice) {
  if (!choice || typeof choice !== "object") return null;
  return String(choice.id || `${choice.playerId || "player"}:${choice.effect || "choice"}`);
}

function validChoiceOptions(choice) {
  return Array.isArray(choice?.options)
    ? choice.options.filter((option) => option && typeof option === "object" && !Array.isArray(option))
    : [];
}

function choiceOptionCardId(option) {
  return String(option?.cardId || option?.card?.instanceId || "");
}

function choiceOptionHasPhysicalCard(option) {
  const cardId = choiceOptionCardId(option);
  if (!cardId) return false;
  const preview = choicePreviewCard(option);
  const context = choiceCardContext(cardId, preview);
  return Boolean(preview && context && context.zone !== "unknown");
}

function choiceOptionIsViewerHandCard(option) {
  const cardId = choiceOptionCardId(option);
  const viewer = viewerPlayer();
  return Boolean(cardId && viewer?.hand?.some((card) => card?.instanceId === cardId));
}

function choiceOptionCanUseInlineBoard(option) {
  const cardId = choiceOptionCardId(option);
  const preview = choicePreviewCard(option);
  const context = choiceCardContext(cardId, preview);
  if (!cardId || !context) return false;
  if (["base", "battlefield", "attachment", "battlefield-card", "rune", "legend", "champion"].includes(context.zone)) return true;
  if (context.zone !== "hidden") return false;
  const controllerId = context.playerId || preview?.controllerId || preview?.ownerId || null;
  return Boolean(controllerId && (controllerId === viewerPlayerId() || canViewPrivateInfo(viewerPlayerId(), controllerId)));
}

function syncStagedChoiceUi(choice) {
  const key = choiceUiKey(choice);
  if (key !== stagedChoiceKey) {
    stagedChoiceKey = key;
    stagedChoiceOptionId = choice?.effect === "recycleTopDeck" ? "keep" : null;
    choiceDrawerCollapsed = false;
  }
  if (!choice || !stagedChoiceOptionId) return;
  const stillAvailable = validChoiceOptions(choice).some((option) =>
    option.id === stagedChoiceOptionId
      && (choice.effect === "recycleTopDeck" || choiceOptionCardId(option)) && !option.disabled
  );
  if (!stillAvailable) stagedChoiceOptionId = null;
}

const BINARY_EFFECT_CHOICES = new Set([
  "declareOptionalTrigger",
  "declareTriggerUse"
]);

const FLOATING_EFFECT_CHOICES = new Set([
  ...BINARY_EFFECT_CHOICES,
  "triggerOrder",
  "payDeflect",
  "predictChoice",
  "recycleTopDeck",
  "observedTopDeckSelfAbility",
  "acknowledgeReveal",
  "chooseDrawOrBuffSelf",
  "unleashedPutUnitInDeck",
  "unleashedStunMoveSelf",
  "attachedUnusedMode",
  "damageOrDrawInstead",
  "preparedDeathRecallPayment",
  "moveWithFriendlyFromSameBattlefield",
  "deathReplacementSource"
]);

function choiceCardSurface(choice) {
  if (!choice || !decisionVisibleToViewer(choice)) return "none";
  if (["combatDamage", "alphaStrikeDamage", "splitDamageAllocation"].includes(choice.effect)) return "damage";
  // These decisions describe whether/how an effect is used. Some engine
  // options carry their source card id solely for context; that id must never
  // be mistaken for a target that the player has to click again.
  if (FLOATING_EFFECT_CHOICES.has(choice.effect)) return "panel";
  const cardOptions = validChoiceOptions(choice).filter(choiceOptionHasPhysicalCard);
  if (!cardOptions.length) return "panel";
  const zones = cardOptions.map((option) => choiceCardContext(choiceOptionCardId(option), choicePreviewCard(option))?.zone || "unknown");
  if (zones.every((zone) => zone === "hand") && cardOptions.every(choiceOptionIsViewerHandCard)) return "hand";
  if (zones.every((zone) => ["main-deck", "rune-deck", "trash", "banished"].includes(zone))) return "pile";
  if (cardOptions.every(choiceOptionCanUseInlineBoard)) return "board";
  // Revealed opponent-hand cards and mixed/off-screen zones have no reliable
  // tabletop hit target. Keep those choices in the wide, rules-safe drawer.
  return "pile";
}

function choiceOptionForCard(cardId) {
  if (!cardId || !game?.pendingChoice || !decisionVisibleToViewer(game.pendingChoice)) return null;
  const options = choiceOptionsForCard(cardId);
  return options.find((option) => !option.disabled) || options[0] || null;
}

function choiceOptionsForCard(cardId, choice = game?.pendingChoice) {
  if (!cardId || !choice || !decisionVisibleToViewer(choice)) return [];
  return validChoiceOptions(choice).filter((option) =>
    choiceOptionHasPhysicalCard(option) && choiceOptionCardId(option) === String(cardId)
  );
}

function stageChoiceOption(optionId) {
  const choice = game?.pendingChoice;
  if (!choice || !decisionVisibleToViewer(choice)) return false;
  syncStagedChoiceUi(choice);
  const option = validChoiceOptions(choice).find((candidate) => candidate.id === optionId);
  if (!option || option.disabled || !choiceOptionCardId(option)) return false;
  stagedChoiceOptionId = stagedChoiceOptionId === option.id ? null : option.id;
  return true;
}

function setStagedChoiceOption(optionId) {
  const choice = game?.pendingChoice;
  if (!choice || !decisionVisibleToViewer(choice)) return false;
  syncStagedChoiceUi(choice);
  const option = validChoiceOptions(choice).find((candidate) => candidate.id === optionId);
  if (!option || option.disabled || (choice.effect !== "recycleTopDeck" && !choiceOptionHasPhysicalCard(option))) return false;
  stagedChoiceOptionId = option.id;
  return true;
}

function stageChoiceCard(cardId) {
  const options = choiceOptionsForCard(cardId).filter((option) => !option.disabled);
  if (!options.length) return false;
  const current = stagedChoiceOption();
  if (current && choiceOptionCardId(current) === String(cardId)) {
    stagedChoiceOptionId = null;
    return true;
  }
  stagedChoiceOptionId = options[0].id;
  return true;
}

function stagedChoiceOption(choice = game?.pendingChoice) {
  syncStagedChoiceUi(choice);
  return validChoiceOptions(choice).find((option) => option.id === stagedChoiceOptionId && !option.disabled) || null;
}

function choiceCardStateClasses(cardId) {
  const surface = game?.pendingChoice ? choiceCardSurface(game.pendingChoice) : "none";
  if (!["hand", "board"].includes(surface)) return "";
  const options = choiceOptionsForCard(cardId);
  if (!options.length) return "";
  const enabled = options.some((option) => !option.disabled);
  const staged = stagedChoiceOption();
  return [
    enabled ? "choice-card-selectable" : "choice-card-disabled",
    staged && choiceOptionCardId(staged) === String(cardId) ? "choice-card-staged" : "",
    options.some((option) => option.selected) ? "choice-card-committed" : ""
  ].filter(Boolean).join(" ");
}

function choiceStageTitle(choice) {
  const source = choice?.card ? cardName(choice.card) : t("effect", locale());
  return choice?.data?.declareTrigger
    ? `${t("declaring", locale())} · ${source}`
    : `${t("resolving", locale())} · ${source}`;
}

function choiceTextActions(choice) {
  return validChoiceOptions(choice)
    .filter((option) => !choiceOptionHasPhysicalCard(option))
    .map((option) => `
      <button type="button" class="${option.confirmControlledChoices ? "primary" : "secondary"}" data-action="choose-effect" data-choice="${escapeHtml(option.id || "")}" ${option.disabled ? "disabled aria-disabled=\"true\"" : ""}>
        ${escapeHtml(localizedChoiceOptionLabel(option))}
      </button>
    `).join("");
}

function choiceOptionVariantLabel(option, siblings = []) {
  if (option?.placement === "top") return locale() === LOCALES.KO ? "덱 위" : "Top of deck";
  if (option?.placement === "bottom") return locale() === LOCALES.KO ? "덱 아래" : "Bottom of deck";
  if (option?.destination === "base") return locale() === LOCALES.KO ? "기지" : "Base";
  if (option?.destination) {
    const field = game.battlefields.find((candidate) => candidate?.instanceId === option.destination);
    if (field) return battlefieldName(field);
  }
  if (Number.isFinite(Number(option?.amount)) && Number(option.amount) > 0) {
    return locale() === LOCALES.KO ? `피해 ${Number(option.amount)}` : `${Number(option.amount)} damage`;
  }
  const label = localizedChoiceOptionLabel(option);
  const duplicateCount = siblings.filter((candidate) => localizedChoiceOptionLabel(candidate) === label).length;
  if (duplicateCount <= 1) return label;
  const index = Math.max(0, siblings.findIndex((candidate) => candidate.id === option.id));
  return `${label} ${index + 1}`;
}

function choiceStageVariants(choice) {
  const selected = stagedChoiceOption(choice);
  if (!selected) return "";
  const siblings = choiceOptionsForCard(choiceOptionCardId(selected), choice).filter((option) => !option.disabled);
  if (siblings.length <= 1) return "";
  const groupLabel = locale() === LOCALES.KO ? "선택 방식" : "Choice variant";
  return `
    <div class="choice-stage-variants" role="group" aria-label="${escapeHtml(groupLabel)}">
      ${siblings.map((option) => `
        <button type="button" class="choice-stage-variant ${option.id === selected.id ? "is-active" : ""}" data-action="stage-choice-option" data-choice="${escapeHtml(option.id || "")}" aria-pressed="${option.id === selected.id}">
          ${escapeHtml(choiceOptionVariantLabel(option, siblings))}
        </button>
      `).join("")}
    </div>
  `;
}

function choiceStageActionGroup(choice, { drawer = false } = {}) {
  const selected = stagedChoiceOption(choice);
  const selectedCard = selected ? choicePreviewCard(selected) : null;
  let selectedLabel = selectedCard && !selectedCard.redacted
    ? cardName(selectedCard)
    : selected ? localizedChoiceOptionLabel(selected) : "";
  if (selected) {
    const siblings = choiceOptionsForCard(choiceOptionCardId(selected), choice).filter((option) => !option.disabled);
    if (siblings.length > 1) selectedLabel = `${selectedLabel} · ${choiceOptionVariantLabel(selected, siblings)}`;
  }
  return `
    <div class="choice-stage-actions">
      ${choiceTextActions(choice)}
      ${choice.optional ? `<button type="button" class="secondary" data-action="decline-effect">${t("decline", locale())}</button>` : ""}
      ${drawer ? `<button type="button" class="secondary choice-drawer-toggle" data-action="toggle-choice-drawer" aria-expanded="${!choiceDrawerCollapsed}">${choiceDrawerCollapsed ? (locale() === LOCALES.KO ? "선택 카드 펼치기" : "Show cards") : (locale() === LOCALES.KO ? "선택 카드 숨기기" : "Hide cards")}</button>` : ""}
      ${choiceStageVariants(choice)}
      <button type="button" class="primary confirm-staged-choice" data-action="confirm-staged-choice" ${selected ? "" : "disabled aria-disabled=\"true\""}>
        ${selected ? `${t("confirm", locale())} · ${escapeHtml(selectedLabel)}` : (locale() === LOCALES.KO ? "카드를 선택해 주세요" : "Choose a card")}
      </button>
    </div>
  `;
}

function compactChoiceCard(option) {
  const preview = choicePreviewCard(option);
  const cardId = choiceOptionCardId(option);
  const context = choiceCardContext(cardId, preview);
  const selected = stagedChoiceOptionId === option.id;
  const committed = Boolean(option.selected);
  const label = preview && !preview.redacted ? cardName(preview) : localizedChoiceOptionLabel(option);
  return `
    <div class="choice-drawer-card-wrap ${selected ? "is-staged" : ""} ${committed ? "is-committed" : ""}">
      <button type="button" class="choice-drawer-card" data-action="stage-choice-card" data-stage-mode="option" data-choice="${escapeHtml(option.id || "")}" data-card-id="${escapeHtml(cardId)}" aria-pressed="${selected}" ${option.disabled ? "disabled aria-disabled=\"true\"" : ""}>
        ${choiceOptionImage(option)}
        <span class="choice-card-name">${escapeHtml(label)}</span>
        <small>${escapeHtml(choiceLocationLabel(context))}</small>
        <b class="choice-check" aria-hidden="true">${selected ? "✓" : committed ? "●" : ""}</b>
      </button>
      ${preview && !preview.redacted ? `<button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${escapeHtml(cardId)}">${t("cardInfo", locale())}</button>` : ""}
    </div>
  `;
}

function inlineCardChoiceBar(choice, surface) {
  const surfaceLabel = surface === "hand"
    ? (locale() === LOCALES.KO ? "손패에서 선택" : "Choose from hand")
    : (locale() === LOCALES.KO ? "보드에서 선택" : "Choose on the board");
  const prompt = localizedChoicePrompt(choice);
  const repeatProgress = repeatedDamageProgressInfo(choice);
  const progressTitle = repeatProgress ? `${repeatProgress.label} · ${repeatProgress.detail} · ${prompt}` : prompt;
  return `
    <section class="choice-stage-bar ${surface}-choice-stage" ${choiceModalAttributes(choice, { inline: true })}>
      <div class="choice-stage-copy">
        <span>${surfaceLabel}</span>
        <strong>${escapeHtml(choiceStageTitle(choice))}</strong>
        <p class="${repeatProgress ? "choice-repeat-progress has-repeat-progress" : ""}" title="${escapeHtml(progressTitle)}">
          ${repeatProgress ? `<strong>${escapeHtml(repeatProgress.label)}</strong><span>${escapeHtml(repeatProgress.detail)}</span>` : ""}
          <span class="choice-stage-prompt">${escapeHtml(prompt)}</span>
        </p>
      </div>
      ${choiceStageActionGroup(choice)}
    </section>
  `;
}

function pileChoiceDrawer(choice) {
  const options = validChoiceOptions(choice).filter(choiceOptionHasPhysicalCard);
  return `
    <section class="choice-zone-drawer ${choiceDrawerCollapsed ? "is-collapsed" : ""}" ${choiceModalAttributes(choice)}>
      <div class="choice-drawer-head">
        <div>
          <span>${locale() === LOCALES.KO ? "카드 선택" : "Card selection"}</span>
          <strong>${escapeHtml(choiceStageTitle(choice))}</strong>
          <p>${escapeHtml(localizedChoicePrompt(choice))}</p>
        </div>
        ${choiceStageActionGroup(choice, { drawer: true })}
      </div>
      ${choiceDrawerCollapsed ? "" : `
        <div class="choice-drawer-track" data-scroll-key="choice-${escapeHtml(choiceUiKey(choice) || "pending")}-drawer">
          ${options.map(compactChoiceCard).join("")}
        </div>
      `}
    </section>
  `;
}

function commandChoiceSurface(choice) {
  const surface = choiceCardSurface(choice);
  if (surface === "hand" || surface === "board") return inlineCardChoiceBar(choice, surface);
  if (surface === "pile") return pileChoiceDrawer(choice);
  if (surface === "damage") return choice.effect === "combatDamage" ? combatDamagePanel(choice) : alphaStrikeDamagePanel(choice);
  return "";
}

function choicePanel() {
  const choice = game.pendingChoice;
  if (!choice || !Array.isArray(choice.options)) return "";
  if (BINARY_EFFECT_CHOICES.has(choice.effect)) return binaryEffectChoicePanel(choice);
  if (choice.effect === "triggerOrder") return triggerOrderPanel(choice);
  if (choice.effect === "combatDamage") return combatDamagePanel(choice);
  if (["alphaStrikeDamage", "splitDamageAllocation"].includes(choice.effect)) return alphaStrikeDamagePanel(choice);
  if (choice.effect === "payDeflect") return deflectPaymentPanel(choice);
  if (choice.effect === "predictChoice") return predictChoicePanel(choice);
  if (choice.effect === "recycleTopDeck") return recycleTopDeckPanel(choice);
  if (choice.effect === "observedTopDeckSelfAbility") return observedTopDeckSelfAbilityPanel(choice);
  if (choice.effect === "acknowledgeReveal") return revealConfirmationPanel(choice);
  const options = choice.options.filter((option) => option && typeof option === "object" && !Array.isArray(option));
  const instruction = choiceEffectInstruction(choice);
  const repeatProgress = repeatedDamageProgress(choice);
  const searchable = options.length > 12;
  const hasCardOptions = options.some(choiceOptionHasPhysicalCard);
  const hasTextOptions = options.some((option) => !choiceOptionHasPhysicalCard(option));
  const choiceLayout = hasCardOptions && hasTextOptions ? "mixed" : hasCardOptions ? "cards" : "text";
  return `
    <section class="choice-panel modal-panel choice-resolution-panel ${hasCardOptions ? "choice-card-selection-panel has-card-options" : ""} ${hasTextOptions ? "has-text-options" : ""} ${choice.effect === "sabotage" ? "reveal-panel" : ""}" data-choice-layout="${choiceLayout}" data-choice-count="${options.length}" ${choiceModalAttributes(choice)}>
      <div class="section-head">
        <div>
          <h2>${escapeHtml(choice.effect === "sabotage" ? `${choice?.card ? cardName(choice.card) : t("effect", locale())}: ${t("revealedHand", locale())}` : `${choice.data?.declareTrigger ? t("declaring", locale()) : t("resolving", locale())} ${choice?.card ? cardName(choice.card) : t("effect", locale())}`)}</h2>
          <span>${escapeHtml(localizedChoicePrompt(choice))}</span>
          ${instruction ? `<p class="choice-instruction">${escapeHtml(instruction)}</p>` : ""}
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
          <small data-choice-search-count>${locale() === LOCALES.KO ? `전체 ${options.length}개` : `${options.length} total`}</small>
        </label>
      ` : ""}
      <div class="choice-grid" id="pending-choice-grid" data-choice-layout="${choiceLayout}" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "pending")}-options">
        ${options.map(choiceOptionButton).join("")}
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
  const requiredRemaining = triggerOptions.filter((option) => !option.selected).length;
  return `
    <section class="choice-panel modal-panel trigger-order-panel" ${choiceModalAttributes(choice)}>
      <div class="section-head trigger-order-head">
        <div>
          <h2>${t("triggerOrderTitle", locale())}</h2>
          <span>${t("triggerOrderProgress", locale(), { selected: chosen.length, total })}</span>
          <p class="choice-instruction trigger-order-instruction">${t("triggerOrderHelp", locale())}</p>
          ${requiredRemaining ? `<p class="trigger-order-required">${t("triggerOrderMandatoryRemaining", locale(), { n: requiredRemaining })}</p>` : ""}
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
              <span>${trigger ? escapeHtml(triggerOrderSourceName(trigger)) : t("pending", locale())}</span>
            </div>
          `;
        }).join("")}
      </div>
      ${chosen.length ? `
        <div class="trigger-order-selected">
          <strong>${t("triggerOrderSelected", locale())}</strong>
          <ol>
            ${chosen.map(triggerOrderSelectedItem).join("")}
          </ol>
        </div>
      ` : ""}
      <div class="choice-grid trigger-order-grid" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "trigger-order")}-options">
        ${triggerOptions.map((option) => triggerOrderOptionButton(choice, option)).join("")}
      </div>
    </section>
  `;
}

function triggerOrderSelectedItem(trigger, index) {
  const sourceName = escapeHtml(triggerOrderSourceName(trigger));
  const kind = escapeHtml(triggerKindLabel(trigger) || t("triggeredAbility", locale()));
  const effect = triggerOrderEffectText(trigger);
  return `
    <li title="${effect}" aria-label="${sourceName}: ${effect}">
      <b aria-hidden="true">${index + 1}</b>
      <span class="trigger-order-selected-copy"><strong>${sourceName}</strong><small>${kind}</small></span>
    </li>
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
          : t(option.wasOptionalTrigger ? "triggerOrderAcceptedOptional" : "triggerOrderMandatory", locale())}</strong>
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

function recycleTopDeckPanel(choice) {
  const ko = locale() === LOCALES.KO;
  const options = validChoiceOptions(choice);
  const selected = stagedChoiceOption(choice);
  const cardOptions = (choice.data?.cardIds || []).map((cardId) =>
    options.find((option) => option.cardId === cardId)
  ).filter(Boolean);
  const recycled = cardOptions.filter((option) => selected?.id === "recycle-all" || selected?.id === option.id);
  const returned = cardOptions.filter((option) => !recycled.includes(option));
  if (selected?.id === "swap") returned.reverse();
  const name = (option) => {
    const card = choicePreviewCard(option);
    return card && !card.redacted ? cardName(card) : (ko ? "카드" : "Card");
  };
  const stageButton = (id, label, extra = "") => {
    const option = options.find((candidate) => candidate.id === id);
    return option ? `<button type="button" class="secondary" data-action="stage-choice-option" data-choice="${escapeHtml(id)}" ${extra} ${option.disabled ? "disabled" : ""}>${escapeHtml(label)}</button>` : "";
  };
  const confirmLabel = recycled.length
    ? (ko ? `${recycled.length}장 재활용 확정` : `Confirm recycling ${recycled.length} card${recycled.length > 1 ? "s" : ""}`)
    : (ko ? "이 순서로 덱 위에 놓기" : "Put back in this order");
  return `
    <section class="choice-panel modal-panel top-deck-choice-panel" ${choiceModalAttributes(choice)}>
      <div class="section-head">
        <div>
          <h2>${escapeHtml(choiceStageTitle(choice))}</h2>
          <span>${ko ? "재활용할 카드를 선택해 주세요. 남은 카드는 원하는 순서로 주 덱 맨 위에 놓습니다." : "Select cards to recycle. Put the remaining cards on top of your Main Deck in your chosen order."}</span>
        </div>
      </div>
      <div class="top-deck-choice-content" data-scroll-key="choice-${escapeHtml(choiceUiKey(choice))}-cards">
        <div class="top-deck-choice-cards">
          ${cardOptions.map((option, index) => {
            const isRecycled = recycled.includes(option);
            const nextRecycled = isRecycled ? recycled.filter((item) => item !== option) : [...recycled, option];
            const nextId = nextRecycled.length === 0 ? "keep" : nextRecycled.length === 1 ? nextRecycled[0].id : "recycle-all";
            const nextOption = options.find((candidate) => candidate.id === nextId);
            const position = returned.indexOf(option) + 1;
            const destination = isRecycled
              ? (ko ? "재활용 · 덱 맨 아래" : "Recycle · bottom of deck")
              : (ko ? `덱 위 ${position}번째${position === 1 ? " · 먼저 뽑을 카드" : ""}` : `Top ${position}${position === 1 ? " · drawn first" : ""}`);
            return `
              <article class="top-deck-choice-card ${isRecycled ? "is-recycled" : "is-kept"}" data-card-id="${escapeHtml(option.cardId)}">
                <small>${ko ? `확인한 ${index + 1}번째 카드` : `Looked-at card ${index + 1}`}</small>
                <button type="button" class="top-deck-recycle-toggle" data-action="stage-choice-option" data-choice="${escapeHtml(nextId)}" aria-pressed="${isRecycled}" aria-label="${escapeHtml(`${name(option)}: ${ko ? "재활용" : "Recycle"}`)}" ${!nextOption || nextOption.disabled ? "disabled" : ""}>
                  ${choiceOptionImage(option)}
                  <strong>${escapeHtml(name(option))}</strong>
                  <span class="top-deck-destination">${escapeHtml(destination)}</span>
                  <span class="top-deck-toggle-label">${isRecycled ? (ko ? "✓ 재활용 선택됨 · 누르면 취소" : "✓ Recycling · click to undo") : (ko ? "이 카드 재활용하기" : "Recycle this card")}</span>
                </button>
                <button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${escapeHtml(option.cardId)}">${t("viewFullCard", locale())}</button>
              </article>
            `;
          }).join("")}
        </div>
        <div class="top-deck-choice-tools">
          ${stageButton("keep", ko ? "모두 덱 위에 놓기" : "Keep all on top")}
          ${stageButton("recycle-all", ko ? "모두 재활용하기" : "Recycle all")}
          ${returned.length > 1 ? stageButton(selected?.id === "swap" ? "keep" : "swap", ko ? "덱 위 순서 바꾸기 ⇄" : "Swap top order ⇄", 'data-top-deck-swap') : ""}
        </div>
        <div class="top-deck-choice-result" role="status" aria-live="polite">
          <strong>${ko ? "처리 결과 미리보기" : "Result preview"}</strong>
          <p class="top-deck-return-order">${ko ? "덱 맨 위 → " : "Top of deck → "}${returned.map((option, index) => `${index + 1}. ${escapeHtml(name(option))}`).join(" → ") || (ko ? "남기는 카드 없음" : "No cards kept")}</p>
          <p class="top-deck-recycle-result">${ko ? "재활용 → " : "Recycle → "}${recycled.map((option) => escapeHtml(name(option))).join(", ") || (ko ? "없음" : "None")}</p>
          ${recycled.length ? `<small>${ko ? "재활용한 카드는 주 덱 맨 아래에 무작위 순서로 놓습니다." : "Recycled cards go to the bottom of your Main Deck in random order."}</small>` : ""}
        </div>
      </div>
      <div class="actions top-deck-choice-actions">
        <button type="button" class="primary" data-action="confirm-staged-choice" ${selected ? "" : "disabled"}>${escapeHtml(confirmLabel)}</button>
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
    <section class="choice-panel modal-panel predict-choice-panel" ${choiceModalAttributes(choice)}>
      <div class="section-head">
        <div>
          <h2>${t("predictedCard", locale())}</h2>
          <span>${preview && !preview.redacted ? cardName(preview) : localizedChoicePrompt(choice)}</span>
        </div>
      </div>
      <div class="predict-choice-content" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "predict")}-content">
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

function binaryEffectChoicePanel(choice) {
  const options = validChoiceOptions(choice);
  const source = choice?.card;
  const sourceName = source ? cardName(source) : t("effect", locale());
  const title = locale() === LOCALES.KO ? "효과 발동 여부" : "Use this effect?";
  const prompt = locale() === LOCALES.KO
    ? `${sourceName}의 효과를 발동하시겠습니까?`
    : `Do you want to use ${sourceName}'s effect?`;
  return `
    <section class="choice-panel modal-panel binary-effect-choice-panel" ${choiceModalAttributes(choice)}>
      <div class="binary-effect-copy">
        <span>${locale() === LOCALES.KO ? "선택 효과" : "Optional effect"}</span>
        <h2>${escapeHtml(title)}</h2>
        <strong>${escapeHtml(sourceName)}</strong>
        <p>${escapeHtml(prompt)}</p>
      </div>
      ${cardArtUrl(source) ? `<button type="button" class="binary-effect-source" data-action="view-choice-card" data-card-id="${escapeHtml(source.instanceId || "")}" aria-label="${escapeHtml(`${sourceName} · ${t("cardInfo", locale())}`)}"><img src="${escapeHtml(cardArtUrl(source))}" alt="${escapeHtml(sourceName)}" loading="lazy" /></button>` : ""}
      <div class="binary-effect-actions" role="group" aria-label="${escapeHtml(title)}">
        ${options.map((option, index) => `
          <button type="button" class="${index === 0 ? "primary" : "secondary"}" data-action="choose-effect" data-choice="${escapeHtml(option.id || "")}" ${option.disabled ? "disabled aria-disabled=\"true\"" : ""}>
            ${escapeHtml(localizedChoiceOptionLabel(option))}
          </button>
        `).join("")}
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
    <section class="choice-panel modal-panel predict-choice-panel observed-top-deck-choice-panel" ${choiceModalAttributes(choice)}>
      <div class="section-head">
        <div>
          <h2>${cardName(preview)}</h2>
          <span>${locale() === LOCALES.KO
            ? "주 덱 위에서 확인한 이 카드를 어떻게 처리할지 선택해 주세요."
            : choice.prompt}</span>
        </div>
      </div>
      <div class="predict-choice-content" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "observed")}-content">
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
    <section class="choice-panel modal-panel reveal-confirmation-panel" ${choiceModalAttributes(choice)}>
      <div class="section-head">
        <div>
          <h2>${cardName(choice.card)}: ${t("revealed", locale())}</h2>
          <span>${locale() === "en" ? choice.prompt : t("confirmRevealPrompt", locale())}</span>
        </div>
      </div>
      <div class="revealed-card-grid" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "reveal")}-cards">
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
  const physical = choiceOptionHasPhysicalCard(option);
  const label = preview && !preview.redacted
    ? (preview.type === "battlefield" ? battlefieldName(preview) : cardName(preview))
    : localizedChoiceOptionLabel(option);
  const context = physical ? choiceCardContext(choiceOptionCardId(option), preview) : null;
  const ownership = choiceOwnership(context, preview);
  const location = context ? choiceLocationLabel(context) : "";
  const selectionState = option.selected
    ? (locale() === LOCALES.KO ? "다시 선택하도록 지정됨" : "Marked to remake")
    : "";
  return `
    <div class="choice-option-wrap">
      <button type="button" class="choice-option ${physical ? `card-choice-option choice-owner-${ownership.tone}` : "text-choice-option"} ${option.selected ? "is-selected" : ""} ${option.confirmControlledChoices ? "confirm-choice-option" : ""} ${option.disabled ? "disabled-choice" : ""}" data-action="choose-effect" data-choice="${escapeHtml(option.id || "")}" data-card-id="${physical ? escapeHtml(choiceOptionCardId(option)) : ""}" ${option.confirmControlledChoices ? "" : `aria-pressed="${Boolean(option.selected)}"`} ${option.disabled ? "disabled aria-disabled=\"true\"" : ""}>
        ${physical ? choiceOptionImage(option) : ""}
        <span class="choice-card-name">${escapeHtml(label)}</span>
        ${selectionState ? `<small class="choice-selection-state">${selectionState}</small>` : ""}
        ${physical ? `<span class="choice-card-context"><b>${escapeHtml(ownership.label)}</b>${location ? `<small>${escapeHtml(location)}</small>` : ""}</span>` : ""}
      </button>
      ${physical && preview && !preview.redacted ? `<button type="button" class="choice-card-view" data-action="view-choice-card" data-card-id="${escapeHtml(preview.instanceId || "")}">${t("viewFullCard", locale())}</button>` : ""}
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
    "use-optional-trigger": locale() === LOCALES.KO ? "효과 발동" : "Use effect",
    "decline-optional-trigger": locale() === LOCALES.KO ? "발동하지 않음" : "Do not use",
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

function repeatedDamageProgressInfo(choice) {
  const declarationSpec = choice.effect === "declarePlayTarget"
    ? choice.data?.currentDeclaration?.spec
    : null;
  const declaredRepeatedDamage = declarationSpec?.kind === "dealDamageUnit"
    && declarationSpec?.selectRepeatedTargetsOnPlay;
  if (choice.effect !== "damageUnit" && !declaredRepeatedDamage) return null;
  const total = declaredRepeatedDamage
    ? choice.data?.max || declarationSpec.repeat || 1
    : choice.data?.repeatTotal || 1;
  if (total < 2) return null;
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
  return { label, detail };
}

function repeatedDamageProgress(choice) {
  const progress = repeatedDamageProgressInfo(choice);
  if (!progress) return "";
  const { label, detail } = progress;
  return `<p class="choice-repeat-progress"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></p>`;
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
      splitDamageAllocation: `${sourceName}: 표시된 합법 피해 수치 중 하나를 적 유닛에게 배정하세요.`,
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
    splitDamageAllocation: `${sourceName}: assign one of the shown legal damage amounts to an enemy unit.`,
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

function damageAssignmentHistory(assignments) {
  const safeAssignments = Array.isArray(assignments)
    ? assignments.filter((item) => {
        const targetId = String(item?.targetId || item?.cardId || "");
        const amount = Number(item?.amount);
        return targetId && Number.isFinite(amount) && amount > 0;
      })
    : [];
  if (!safeAssignments.length) return "";
  const label = locale() === LOCALES.KO ? "이미 배정한 피해" : "Assigned damage";
  return `
    <div class="damage-assignment-history" aria-label="${escapeHtml(label)}">
      <strong>${escapeHtml(label)}</strong>
      <div class="damage-assignment-history-track">
        ${safeAssignments.map((item) => {
          const targetId = String(item.targetId || item.cardId || "");
          const target = findChoicePreviewCard(targetId) || findVisibleCard(targetId);
          const targetLabel = target && !target.redacted
            ? cardName(target)
            : (locale() === LOCALES.KO ? "대상" : "Target");
          const amount = Math.max(0, Number(item.amount) || 0);
          return `<span class="damage-assignment-chip" data-target-id="${escapeHtml(targetId)}" data-amount="${amount}"><b>${escapeHtml(targetLabel)}</b><em>${amount}</em></span>`;
        }).join("")}
      </div>
    </div>
  `;
}

function combatDamagePanel(choice) {
  const assigning = game.players.find((player) => player.id === choice.playerId);
  const targetPlayer = game.players.find((player) => player.id === choice.data?.targetPlayerId);
  const legalOptions = new Map(validChoiceOptions(choice)
    .filter((option) => choiceOptionCardId(option) && !option.disabled)
    .map((option) => [choiceOptionCardId(option), String(option.id || "")]));
  const infos = Array.isArray(choice.data?.targetInfos) && choice.data.targetInfos.length
    ? choice.data.targetInfos
    : validChoiceOptions(choice).map((option) => ({ cardId: choiceOptionCardId(option), amount: option.amount || 0 }));
  return `
    <section class="choice-zone-drawer damage-assignment-drawer combat-damage-panel" ${choiceModalAttributes(choice)}>
      <div class="damage-assignment-head">
        <div>
          <span>${locale() === LOCALES.KO ? "전투 피해 배정" : "Combat damage assignment"}</span>
          <h2>${t("damageAssign", locale())}</h2>
          <span>${t("assigningDamage", locale(), { actor: assigning ? playerName(assigning) : t("nobody", locale()), amount: choice.data?.remaining || 0, target: targetPlayer ? playerName(targetPlayer) : t("opponent", locale()) })}</span>
        </div>
        <div class="damage-remaining-orb" aria-label="${escapeHtml(locale() === LOCALES.KO ? `남은 피해 ${choice.data?.remaining || 0}` : `${choice.data?.remaining || 0} damage remaining`)}">
          <strong>${choice.data?.remaining || 0}</strong>
          <span>${locale() === LOCALES.KO ? "남은 피해" : "remaining"}</span>
        </div>
      </div>
      <p class="damage-assignment-help">${t("autoLethalHint", locale())}</p>
      ${damageAssignmentHistory(choice.data?.assignments)}
      <div class="damage-target-track combat-choice-grid" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "combat")}-options">
        ${infos.filter((info) => info?.cardId).map((info) => combatDamageOption(info, legalOptions.get(String(info.cardId)) || "", choice.data?.battlefieldId)).join("")}
      </div>
    </section>
  `;
}

function deflectPaymentPanel(choice) {
  const target = findVisibleCard(choice.data?.targetId);
  const amount = choice.data?.amount || 1;
  const selected = choice.data?.selectedRuneIds?.length || 0;
  return `
    <section class="choice-panel modal-panel deflect-panel" ${choiceModalAttributes(choice)}>
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
      <div class="deflect-rune-grid" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "deflect")}-runes">
        ${choice.options.map((option) => {
          const rune = findVisibleCard(option.cardId);
          return `
            <button type="button" class="deflect-rune-option" data-action="choose-effect" data-choice="${option.id}">
              ${cardArtUrl(rune) ? `<img class="deflect-rune-art" src="${cardArtUrl(rune)}" alt="${cardName(rune)}" />` : `<span class="rune-swatch" style="--rune:${rune?.color || "#94a3b8"}"></span>`}
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
  const remaining = Math.max(0, Number(choice.data?.splitDamage?.remainingDamage ?? choice.data?.remainingDamage ?? choice.data?.remaining) || 0);
  return `
    <section class="choice-zone-drawer damage-assignment-drawer alpha-strike-panel" ${choiceModalAttributes(choice)}>
      <div class="damage-assignment-head">
        <div>
          <span>${locale() === LOCALES.KO ? "효과 피해 배정" : "Effect damage assignment"}</span>
          <h2>${escapeHtml(choice?.card ? cardName(choice.card) : t("effect", locale()))}</h2>
          <span>${escapeHtml(localizedChoicePrompt(choice))}</span>
        </div>
        <div class="damage-remaining-orb">
          <strong>${remaining}</strong>
          <span>${locale() === LOCALES.KO ? "남은 피해" : "remaining"}</span>
        </div>
      </div>
      <p class="damage-assignment-help">${escapeHtml(choiceEffectInstruction(choice))}</p>
      ${damageAssignmentHistory(choice.data?.splitDamage?.allocations)}
      <div class="damage-target-track alpha-strike-targets" data-scroll-key="choice-${escapeHtml(choice.id || choice.effect || "alpha")}-targets">
        ${targets.map((option) => {
          const target = findVisibleCard(option.cardId);
          const stats = target ? boardUnitStats(target, selectedContext(target.instanceId)?.location) : { might: 0, remaining: 0 };
          const amountOptions = validChoiceOptions(choice)
            .filter((candidate) => candidate.cardId === option.cardId && Number(candidate.amount) > 0)
            .sort((left, right) => Number(left.amount) - Number(right.amount));
          const minimum = Number(amountOptions[0]?.amount) || 1;
          const maximum = Number(amountOptions.at(-1)?.amount) || Math.max(1, remaining);
          const initial = maximum;
          return `
            <div class="alpha-strike-target">
              ${choiceOptionImage(option)}
              <div class="damage-target-copy">
                <strong>${target ? cardName(target) : localizedDynamicText(option.label)}</strong>
                <span>${t("currentMight", locale())} ${stats.might} · ${t("remainingHealth", locale())} ${stats.remaining}</span>
              </div>
              <div class="damage-stepper" aria-label="${escapeHtml(locale() === LOCALES.KO ? "배정할 피해" : "Damage to assign")}">
                <button type="button" data-action="adjust-alpha-damage" data-target="${escapeHtml(option.cardId || "")}" data-delta="-1" aria-label="${escapeHtml(locale() === LOCALES.KO ? "피해 1 감소" : "Decrease damage")}">−</button>
                <output>${initial}</output>
                <input type="number" min="${minimum}" max="${maximum}" value="${initial}" data-alpha-target="${escapeHtml(option.cardId || "")}" data-allowed-amounts="${escapeHtml(amountOptions.map((candidate) => candidate.amount).join(" "))}" aria-label="${escapeHtml(locale() === LOCALES.KO ? "배정 피해" : "Assigned damage")}" readonly />
                <button type="button" data-action="adjust-alpha-damage" data-target="${escapeHtml(option.cardId || "")}" data-delta="1" aria-label="${escapeHtml(locale() === LOCALES.KO ? "피해 1 증가" : "Increase damage")}">+</button>
              </div>
              <button type="button" class="primary damage-assign-button" data-action="assign-alpha-strike" data-target="${escapeHtml(option.cardId || "")}">${locale() === LOCALES.KO ? "이 유닛에 배정" : "Assign here"}</button>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function combatDamageOption(info, legalOptionId, battlefieldId = null) {
  const card = findVisibleCard(info.cardId);
  const legal = Boolean(legalOptionId);
  const optionId = legal ? legalOptionId : "";
  const stats = card ? boardUnitStats(card, battlefieldId) : { might: 0, remaining: 0 };
  const amountLabel = info.amount
    ? (locale() === LOCALES.KO ? `${info.amount} 피해${info.lethalNow ? " · 처치 가능" : ""}` : `${info.amount} damage${info.lethalNow ? " lethal" : ""}`)
    : "";
  return `
    <button
      class="damage-target-card combat-choice ${legal ? "is-legal" : "is-locked"} ${info.lethalNow ? "is-lethal" : ""}"
      data-action="choose-effect"
      data-choice="${optionId}"
      data-card-id="${info.cardId}"
      ${legal ? "" : "disabled"}
    >
      ${choiceOptionImage({ cardId: info.cardId })}
      <span class="damage-target-copy">
        <strong>${card ? cardName(card) : (locale() === LOCALES.KO ? "유닛" : "Unit")}</strong>
        <small>${t("currentMight", locale())} ${stats.might} · ${t("remainingHealth", locale())} ${stats.remaining}</small>
        <b>${legal ? amountLabel : combatDamageRestrictionLabel(info.reason)}</b>
      </span>
    </button>
  `;
}

function combatDamageRestrictionLabel(reason) {
  const korean = {
    "Lethal already assigned": "이미 처치 피해가 배정되었습니다",
    "Backline last": "후열 유닛은 마지막에 배정해야 합니다",
    "Assign last": "이 유닛은 마지막에 배정해야 합니다",
    "Tank first": "방벽 유닛에게 먼저 배정해야 합니다",
    "Assign lethal first": "처치 가능한 유닛부터 배정해야 합니다"
  };
  const fallback = locale() === LOCALES.KO ? "현재 이 대상에게 배정할 수 없습니다" : "Damage cannot be assigned here yet";
  const lethalFirst = locale() === LOCALES.KO
    ? "먼저 처치 가능한 유닛에 필요한 피해를 배정해 주세요"
    : "Assign the required lethal damage first";
  if (!reason) return escapeHtml(lethalFirst);
  if (locale() === LOCALES.KO) return escapeHtml(korean[reason] || localizedDynamicText(reason, { fallback }) || fallback);
  return escapeHtml(localizedDynamicText(reason, { fallback }) || fallback);
}

function choiceOptionImage(option) {
  const cardId = typeof option === "string" ? option : option.cardId;
  const optionCard = typeof option === "object" ? option.card : null;
  const visibleCard = findVisibleCard(cardId);
  const card = option?.revealed && optionCard ? optionCard : (visibleCard && !visibleCard.redacted ? visibleCard : optionCard || visibleCard || null);
  if (!card && option.image) return `<span class="choice-card-art"><img src="${option.image}" alt="${localizedDynamicText(option.label || (locale() === LOCALES.KO ? "카드" : "Card"))}" loading="lazy" /></span>`;
  if (!card) return `<div class="choice-card-fallback">${localizedDynamicText(option.label || (locale() === LOCALES.KO ? "카드" : "Card"))}</div>`;
  if (!cardArtUrl(card)) return `<div class="choice-card-fallback">${cardName(card)}</div>`;
  return `<span class="choice-card-art"><img src="${cardArtUrl(card)}" alt="${cardName(card)}" loading="lazy" /></span>`;
}

function ensureVisibleCardIndex() {
  observeCurrentGame();
  if (visibleCardIndexGame === game && visibleCardIndexRevision === gameStateRevision) return;
  const cardsById = new Map();
  const contextsById = new Map();
  const addCard = (card, context = null) => {
    if (!card || typeof card !== "object") return;
    const identifiers = [card.instanceId, card.id].map((id) => String(id || "")).filter(Boolean);
    for (const id of identifiers) {
      if (!cardsById.has(id)) cardsById.set(id, card);
    }
    if (context && card.instanceId && !contextsById.has(card.instanceId)) {
      contextsById.set(card.instanceId, context);
    }
  };
  const addAttachments = (permanent, context) => {
    for (const attachment of permanent?.attachments || []) {
      addCard(attachment, {
        playerId: attachment.controllerId || attachment.ownerId || context.playerId,
        zone: "attachment",
        location: context.location,
        parentUnitId: permanent.instanceId
      });
      addAttachments(attachment, context);
    }
  };

  for (const player of game.players || []) {
    addCard(player.legend, { playerId: player.id, zone: "legend", location: "legend" });
    addCard(player.champion);
    for (const card of player.availableChampions || []) {
      addCard(card, { playerId: player.id, zone: "champion-choice", location: "champion-choice" });
    }
    for (const card of player.availableBattlefields || []) addCard(card);
    for (const card of player.mainDeck || []) addCard(card);
    for (const card of player.runeDeck || []) addCard(card);
    for (const card of player.hand || []) addCard(card, { playerId: player.id, zone: "hand", location: "hand" });
    for (const card of player.base || []) {
      addCard(card, { playerId: player.id, zone: "base", location: "base" });
      addAttachments(card, { playerId: player.id, location: "base" });
    }
    for (const card of player.runes || []) addCard(card, { playerId: player.id, zone: "rune", location: "rune" });
    for (const card of player.trash || []) addCard(card);
    for (const card of player.banished || []) addCard(card, { playerId: player.id, zone: "banished", location: "banished" });
    if (player.champion?.zone === "champion" && !player.championPlayed) {
      contextsById.set(player.champion.instanceId, { playerId: player.id, zone: "champion", location: "champion" });
    }
  }
  for (const field of game.battlefields || []) {
    addCard(field, { playerId: null, zone: "battlefield-card", location: field.instanceId });
    for (const item of field.hidden || []) {
      addCard(item?.card, {
        playerId: hiddenCardControllerId(item),
        zone: "hidden",
        location: field.instanceId
      });
    }
    for (const card of field.units || []) {
      addCard(card, { playerId: card.controllerId, zone: "battlefield", location: field.instanceId });
      addAttachments(card, { playerId: card.controllerId, location: field.instanceId });
    }
  }
  for (const item of game.showdown?.chain || []) addCard(item?.card);
  for (const item of game.actionChain?.chain || []) addCard(item?.card);
  visibleCardIndexGame = game;
  visibleCardIndexRevision = gameStateRevision;
  visibleCardIndex = cardsById;
  selectedContextIndex = contextsById;
}

function findVisibleCard(cardId) {
  if (!cardId) return null;
  ensureVisibleCardIndex();
  return visibleCardIndex.get(String(cardId)) || null;
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
  return Boolean(card && !card.redacted && cardVisibleToCurrentViewer(cardId));
}

function chainZonePanel() {
  const counteredItems = [...effectAnimations.countered.values()];
  const items = currentChainTreeItems();
  const responding = responsePromptInfo();
  if (!items.length && !responding && !counteredItems.length) {
    chainZoneCollapsed = false;
    return "";
  }
  if (isTutorialGame() && game.pendingChoice && choiceCardSurface(game.pendingChoice) === "board") {
    chainZoneCollapsed = true;
  }
  return `
    <section class="chain-zone chain-pod ${chainZoneCollapsed ? "is-collapsed" : ""} ${counteredItems.length ? "has-counter-animation" : ""}" data-zone="chain" aria-label="${t("processingQueue", locale())}" aria-live="polite">
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
          ${counteredItems.map(counteredChainZoneItem).join("")}${items.map((item, index) => chainZoneItem(item, items.length - index, { active: index === 0 })).join("") || `<p class="empty">${t("noChainItem", locale())}</p>`}
        </div>
        ${inspectedChainTargetPanel(items, responding)}
      </div>
    </section>
  `;
}

function currentChainTreeItems() {
  observeCurrentGame();
  const cacheViewerId = String(viewerPlayerId() || "");
  if (chainTreeCacheGame === game
    && chainTreeCacheRevision === gameStateRevision
    && chainTreeCacheViewerId === cacheViewerId
    && chainTreeCacheItems) return chainTreeCacheItems;
  const chain = game?.actionChain || game?.showdown;
  const chainItems = chain ? [...normalizeUiChain(Array.isArray(chain.chain) ? chain.chain : [])].reverse() : [];
  const resolvingItem = pendingResolutionChainItem();
  const triggerItems = [
    ...(Array.isArray(game?.triggerQueue) ? game.triggerQueue : []).filter(Boolean).map((trigger, index) => ({
      id: trigger.id || `queued-trigger-${index}`,
      itemType: "trigger",
      playerId: trigger.playerId,
      card: findVisibleCard(trigger.sourceCardId) || triggerSnapshotCard(trigger),
      trigger,
      status: trigger.status || "pending"
    }))
  ];
  const liveItems = [...chainItems, ...triggerItems];
  if (resolvingItem) {
    const matchingIndex = liveItems.findIndex((item) => chainPresentationItemsMatch(resolvingItem, item));
    if (matchingIndex >= 0) {
      liveItems[matchingIndex] = { ...liveItems[matchingIndex], status: "resolving" };
    } else {
      liveItems.unshift(resolvingItem);
    }
  }
  const seen = new Set();
  const uniqueLiveItems = liveItems.filter((item) => {
    if (!item) return false;
    const id = String(item.id || "");
    if (id && seen.has(id)) return false;
    if (id) seen.add(id);
    return true;
  });
  if (uniqueLiveItems.length) {
    chainTreePresentationItems = uniqueLiveItems.map(snapshotChainPresentationItem);
    return cacheChainTreeItems(uniqueLiveItems, cacheViewerId);
  }
  const pending = game?.pendingChoice || game?.pendingPayment;
  const activeChainState = Boolean(
    game?.actionChain
    || (Array.isArray(game?.showdown?.chain) && game.showdown.chain.length)
  );
  const resolutionStillOpen = Boolean(
    activeChainState
    || (Array.isArray(game?.triggerQueue) && game.triggerQueue.length)
    || pendingDecisionChainKind(pending)
    || game?.resolvingChainContext
  );
  if (resolutionStillOpen && chainTreePresentationItems.length) {
    return cacheChainTreeItems(chainTreePresentationItems.map((item, index) => ({
      ...item,
      status: index === 0 ? "resolving" : (item.status || "pending")
    })), cacheViewerId);
  }
  chainTreePresentationItems = [];
  return cacheChainTreeItems([], cacheViewerId);
}

function cacheChainTreeItems(items, viewerId) {
  chainTreeCacheGame = game;
  chainTreeCacheRevision = gameStateRevision;
  chainTreeCacheViewerId = viewerId;
  chainTreeCacheItems = items;
  return items;
}

function chainPresentationItemsMatch(pendingItem, chainItem) {
  if (!pendingItem || !chainItem) return false;
  const ownedChainItemId = String(pendingItem.presentationChainItemId || "");
  if (ownedChainItemId) return ownedChainItemId === String(chainItem.id || "");
  const pendingTriggerId = String(pendingItem.trigger?.id || "");
  const chainTriggerId = String(chainItem.trigger?.id || "");
  if (pendingTriggerId && chainTriggerId) return pendingTriggerId === chainTriggerId;
  const pendingCardId = String(chainItemSourceCard(pendingItem)?.instanceId || pendingItem.trigger?.sourceCardId || "");
  const chainCardId = String(chainItemSourceCard(chainItem)?.instanceId || chainItem.trigger?.sourceCardId || "");
  if (!pendingCardId || pendingCardId !== chainCardId) return false;
  return String(pendingItem.itemType || "card") === String(chainItem.itemType || "card");
}

function pendingResolutionChainItem() {
  const pending = game?.pendingChoice || game?.pendingPayment;
  if (!pending || typeof pending !== "object") return null;
  const chainKind = pendingDecisionChainKind(pending);
  const triggerId = typeof pending.data?.triggerId === "string" ? pending.data.triggerId : "";
  if (!chainKind && !triggerId) return null;
  const player = game.players.find((candidate) => candidate.id === pending.playerId);
  const card = pending === game.pendingPayment
    ? paymentDisplayCard(player, pending) || pending.effectPayment?.sourceCard || null
    : pending.card || null;
  const sourceCardId = String(card?.instanceId || pending.cardId || pending.sourceCardId || "");
  const itemType = triggerId || pending.triggeredAbility
    ? "trigger"
    : pending.activatedAbility
      ? "activated"
      : "card";
  const id = triggerId || `resolving-${chainKind || "trigger"}-${pending.id || sourceCardId || pending.effect || "effect"}`;
  const item = {
    id,
    presentationChainItemId: pendingResolutionOwnerChainItemId(pending),
    itemType,
    playerId: pending.playerId || card?.controllerId || card?.ownerId || "",
    card,
    specs: pending.activatedAbility?.specs || pending.specs || [],
    status: "resolving"
  };
  if (itemType === "trigger") {
    item.trigger = {
      id: triggerId || id,
      sourceCardId,
      sourceCardSnapshot: card && !card.redacted ? card : undefined,
      kind: pending.effect || pending.triggeredAbility?.kind || "",
      data: pending.data && typeof pending.data === "object" ? pending.data : {}
    };
  }
  return chainItemVisibleInTree(item) ? item : null;
}

function pendingResolutionOwnerChainItemId(pending) {
  if (!pending || typeof pending !== "object") return "";
  return String(
    pending.playProcess?.chainItemId
    || pending.effectPlay?.chainItemId
    || pending.activatedAbility?.sourceCard?.activationProcess?.chainItemId
    || pending.card?.activationProcess?.chainItemId
    || pending.triggeredAbility?.trigger?.pendingChainItemId
    || pending.data?.trigger?.pendingChainItemId
    || ""
  );
}

function pendingDecisionChainKind(pending) {
  if (!pending || typeof pending !== "object") return null;
  if (pending.fromShowdownChain) return "showdown";
  if (pending.fromActionChain) return "action";
  const contextKind = pending.gameEffectResolution?.context?.chainKind;
  return ["action", "showdown"].includes(contextKind) ? contextKind : null;
}

function pendingChoiceSharesChainSurface(pending) {
  if (!pending || typeof pending !== "object") return false;
  return Boolean(
    pendingDecisionChainKind(pending)
    || game?.actionChain
    || (Array.isArray(game?.showdown?.chain) && game.showdown.chain.length)
    || (Array.isArray(game?.triggerQueue) && game.triggerQueue.length)
  );
}

function snapshotChainPresentationItem(item) {
  try {
    return structuredClone(item);
  } catch {
    return {
      ...item,
      card: item?.card && typeof item.card === "object" ? { ...item.card } : null,
      trigger: item?.trigger && typeof item.trigger === "object" ? { ...item.trigger } : null,
      specs: Array.isArray(item?.specs) ? item.specs.map((spec) => ({ ...spec })) : []
    };
  }
}

function triggerSnapshotCard(trigger) {
  const snapshot = trigger?.sourceCardSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.redacted) return null;
  return snapshot;
}

function chainItemSourceCard(item) {
  if (!item || typeof item !== "object") return null;
  const live = item?.trigger?.sourceCardId ? findVisibleCard(item.trigger.sourceCardId) : null;
  if (live && !live.redacted) return live;
  const snapshot = triggerSnapshotCard(item.trigger);
  if (item?.itemType === "trigger" && snapshot) return snapshot;
  if (item?.card && typeof item.card === "object" && !item.card.redacted) return item.card;
  return snapshot;
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
  const sourceCard = chainItemSourceCard(item);
  const sourceCardId = sourceCard?.instanceId || item?.trigger?.sourceCardId || "";
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
      ${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="" loading="lazy" />` : `<span class="chain-target-fallback" aria-hidden="true">◎</span>`}
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

function chainZoneItem(item = {}, order = 0, { active = false } = {}) {
  const playerId = String(item?.playerId || "");
  const player = (Array.isArray(game?.players) ? game.players : []).find((candidate) => candidate?.id === item?.playerId);
  const targets = chainItemTargetIds(item).map(targetLabel).filter(Boolean).map(escapeHtml);
  const previewCard = chainItemSourceCard(item);
  const previewCardId = String(previewCard?.instanceId || item?.trigger?.sourceCardId || "");
  const snapshotPreview = previewCard === triggerSnapshotCard(item?.trigger);
  const previewVisible = Boolean(cardArtUrl(previewCard)
    && !previewCard.redacted
    && (snapshotPreview || cardVisibleToCurrentViewer(previewCardId)));
  const itemId = String(item?.id || `${previewCardId || "chain"}-${order}`);
  const status = String(item?.status || "pending");
  const statusClass = status.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "pending";
  const itemClass = [
    "chain-zone-item",
    active ? "chain-zone-active" : "chain-zone-queued",
    inspectedChainItemId === itemId ? "is-inspected" : "",
    `status-${statusClass}`,
    choiceCardStateClasses(previewCardId)
  ].filter(Boolean).join(" ");
  return `
    <button type="button" class="${itemClass}" data-action="inspect-chain-effect" data-chain-item-id="${escapeHtml(itemId)}" data-card-id="${escapeHtml(previewCardId)}" title="${escapeHtml(t("target", locale()))}">
      <span class="chain-card-motion-anchor" data-motion-anchor data-motion-zone="chain" data-motion-player-id="${escapeHtml(playerId)}" data-motion-card-id="${escapeHtml(previewCardId)}" aria-hidden="true">
        ${previewVisible ? `<img class="chain-card-motion-art" src="${escapeHtml(cardArtUrl(previewCard))}" alt="" width="42" height="59" loading="lazy" />` : `<i class="chain-card-motion-back">R</i>`}
      </span>
      <span class="chain-zone-copy">
        <span class="chain-zone-meta"><b>[${escapeHtml(order)}] ${escapeHtml(playerPerspectiveLabel(player?.id || playerId))}</b><em>${escapeHtml(localizedDynamicText(t(status, locale())))}</em></span>
        <strong>${escapeHtml(chainItemTitle(item))}</strong>
        <span class="chain-zone-target">${escapeHtml(t("target", locale()))}: ${targets.length ? targets.join(", ") : escapeHtml(t("noTargetDeclared", locale()))}</span>
      </span>
    </button>
  `;
}

function chainItemEffectText(item) {
  const source = chainItemSourceCard(item);
  const detail = source ? cardText(source) : (triggerKindLabel(item?.trigger) || "");
  if (item?.itemType !== "activated") return { summary: "", detail };
  const labels = [...new Set((Array.isArray(item.specs) ? item.specs : [])
    .filter((spec) => spec && typeof spec === "object")
    .map((spec) => activatedChainSpecLabel(spec))
    .filter(Boolean))];
  const summary = labels.length
    ? `${t("ability", locale())}: ${labels.join(" · ")}`
    : t("ability", locale());
  return { summary, detail };
}

function activatedChainSpecLabel(spec) {
  const abilityId = typeof spec?.abilityId === "string" ? spec.abilityId.trim() : "";
  const kind = typeof spec?.kind === "string" ? spec.kind.trim() : "";
  const identifier = abilityId && !/^(?:ability|effect)-\d+$/i.test(abilityId) ? abilityId : kind || abilityId;
  if (!identifier) return "";
  const readable = identifier
    .split(":").at(-1)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
  return localizedDynamicText(readable, { fallback: readable });
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
    cardId: chainItemSourceCard(latest)?.instanceId
  };
}

function responsePrompt(info) {
  const passState = passControlState();
  return `
    <div class="response-prompt">
      <strong>${escapeHtml(info?.title || t("responseWindow", locale()))}</strong>
      <span>${escapeHtml(info?.detail || t("responseHint", locale()))}</span>
      ${passState ? `<small class="chain-pass-progress">${escapeHtml(passState.progressText)}</small>` : ""}
    </div>
  `;
}

function priorityResponseControls(actionMarkup = "") {
  return `
    <div class="priority-response-controls" role="group" aria-label="${escapeHtml(locale() === LOCALES.KO ? "반응 또는 패스" : "React or pass")}">
      ${actionMarkup ? `<div class="priority-card-actions">${actionMarkup}</div>` : ""}
      ${passControlButton()}
    </div>
  `;
}

function actionUseWindowAvailable() {
  if (!viewerCanAct() || game?.pendingChoice || game?.pendingPayment || game?.actionChain) return false;
  if (game?.phase === "showdown" && game?.showdown) {
    const hasFocus = game.showdown.priorityPlayerId === viewerPlayerId();
    const chainEmpty = !Array.isArray(game.showdown.chain) || game.showdown.chain.filter(Boolean).length === 0;
    return hasFocus && chainEmpty;
  }
  return game?.phase === "action" && activePlayerId() === viewerPlayerId();
}

function playWindowControlLabel() {
  if (locale() === LOCALES.KO) return actionUseWindowAvailable() ? "행동 사용" : "반응 사용";
  return actionUseWindowAvailable() ? "Play Action" : "Play Reaction";
}

function chainItemTitle(item) {
  if (!item) return t("effect", locale());
  const source = chainItemSourceCard(item);
  if (item.itemType === "trigger") return source ? cardName(source) : (item.trigger?.label || triggerLabel(item.trigger) || t("triggeredAbility", locale()));
  if (item.itemType === "activated") return `${item.card ? cardName(item.card) : t("selectedCard", locale())} ${t("ability", locale())}`;
  return item.card ? cardName(item.card) : t("selectedCard", locale());
}

function chainItemSourceTitle(item) {
  if (!item) return t("effect", locale());
  if (item.itemType === "trigger") {
    const source = chainItemSourceCard(item);
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
  if (!card || card.redacted || !cardVisibleToCurrentViewer(cardId)) return null;
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
    chain: t("chain", locale()),
    trash: t("trash", locale()),
    banished: t("banished", locale()),
    played: locale() === LOCALES.KO ? "플레이 중" : "In play",
    attachment: locale() === LOCALES.KO ? "부착됨" : "Attached"
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
  const visiblePlayers = game.players.filter((player) => player.id === viewerPlayerId());
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
  const visiblePlayers = game.players.filter((player) => player.id === viewerPlayerId());
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
  const matchesLegend = championMatchesLegend(champion, player.legend);
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
  return decisionVisibleToViewer({ playerId });
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
  const seat = tabletopSeatView(player, {
    side,
    visibleHandCount: handCountVisibleToViewer(game, player, viewerPlayerId()),
    revealHand: side === "bottom" || canViewPrivateInfo(viewerPlayerId(), player?.id)
  });
  const baseTarget = targetAttributes("base", player.id);
  const acting = activePlayerId() === player.id;
  const intel = canViewPrivateInfo(viewerPlayerId(), player.id);
  const handGlow = uiMotion.sourceZones.has(`${player.id}:hand`) ? "source-hand-glow" : "";
  const drawAnimation = effectAnimations.draws.get(player.id);
  const baseDeaths = unitDeathGhosts("base", player.id);
  const championReference = championIdentityReference(player, seat.champion);
  const paymentSeat = decisionVisibleToViewer(game.pendingPayment) && game.pendingPayment?.playerId === player.id;
  const baseDropDestination = player.id === viewerPlayerId()
    ? `data-play-destination="base" data-drop-owner="${escapeHtml(player.id)}"`
    : "";
  return `
    <section class="player-side table-seat ${side} owner-${seat.id} ${acting ? "acting-player" : ""} ${paymentSeat ? "payment-seat" : ""} ${handGlow}" data-player-id="${escapeHtml(seat.id)}" data-side="${seat.side}">
      <div class="player-identity tabletop-identity-dock">
        <div class="identity-mini physical-identity-cards">
          <div class="identity-zone legend-zone" data-zone="legend" data-count="${seat.legend ? 1 : 0}">
            <span class="zone-caption">${t("legend", locale())}</span>
            ${seat.legend ? miniIdentity(seat.legend) : `<span class="empty-card-slot" aria-label="${t("legend", locale())}"></span>`}
          </div>
          <div class="identity-zone champion-zone-slot" data-zone="champion" data-count="${championReference.physical ? 1 : 0}" ${championReference.physical ? "" : `data-reference-zone="${escapeHtml(championReference.zone)}"`}>
            <span class="zone-caption">${t("championZone", locale())}</span>
            ${championReference.markup}
          </div>
        </div>
        <div class="player-summary">
          <h2>${playerName(player)}</h2>
          <div class="player-stats" data-scroll-key="player-stats-${player.id}">
            <span class="xp-stat">${t("level", locale())} <b>${seat.xp}</b></span>
            <span class="hand-stat">${t("hand", locale())} <b>${seat.counts.hand}</b></span>
            ${intel ? `<button class="intel-button" data-action="toggle-intel" data-player="${player.id}">${t("intel", locale())}</button>` : ""}
          </div>
          ${championPanelStatus(player)}
        </div>
      </div>
      <div class="table-pile-dock">
        ${tableCardPile({ zone: "main-deck", player, cards: seat.mainDeck, label: t("mainDeck", locale()), cardBack: true, effect: drawAnimation ? "draw" : "", burnOuts: seat.burnOuts })}
        ${tableCardPile({ zone: "trash", player, cards: seat.trash, label: t("trash", locale()), action: "toggle-graveyard", title: t("viewTrashTitle", locale(), { name: playerName(player) }) })}
        ${tableCardPile({ zone: "banished", player, cards: seat.banished, label: t("banished", locale()), action: "toggle-banished", title: t("viewBanishedTitle", locale(), { name: playerName(player) }) })}
      </div>
      <div class="resource-zone" data-zone="runes" data-count="${seat.counts.runes}">
        <span class="zone-caption">${t("runes", locale())}</span>
        <div class="rune-tabletop">
          ${tableCardPile({ zone: "rune-deck", player, cards: seat.runeDeck, label: t("runeDeck", locale()), cardBack: true, compact: true })}
          <div class="rune-play-area">
            ${runeSummary(player)}
            <div class="resource-row rune-card-stack" data-rune-scroll-track data-scroll-key="runes-${escapeHtml(player.id)}" tabindex="0" aria-label="${escapeHtml(locale() === LOCALES.KO ? "배치된 룬 카드 · 좌우로 끌어서 이동" : "Played Rune cards · drag sideways to scroll")}">
              ${seat.runes.map((rune, index) => runeChip(rune, index, seat.runes.length, player.id)).join("")}
            </div>
          </div>
        </div>
      </div>
      <div class="base-zone" data-zone="base" data-count="${seat.counts.base}">
        <span class="zone-caption">${t("base", locale())}</span>
        <div class="base-row ${baseTarget.className}" data-scroll-key="base-${player.id}" ${baseDropDestination} ${baseTarget.attrs}>
          ${seat.base.map((card) => boardCard(card, "base")).join("")}${baseDeaths || (!seat.base.length ? `<p class="empty">${t("baseEmpty", locale())}</p>` : "")}
        </div>
      </div>
    </section>
  `;
}

function tableCardPile({ zone, player, cards, label, action = "", title = "", cardBack = false, effect = "", burnOuts = 0, compact = false }) {
  const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const top = cardBack ? null : topDiscardCard(list);
  const playerId = String(player?.id ?? "");
  const tag = action ? "button" : "div";
  const actionAttributes = action ? `type="button" data-action="${action}" data-player="${escapeHtml(playerId)}"` : `role="group"`;
  const titleAttribute = title ? `title="${escapeHtml(title)}"` : "";
  const compactLabel = locale() === LOCALES.KO
    ? ({ "main-deck": "덱", "rune-deck": "룬", trash: "폐기", banished: "제외" }[zone] || label)
    : ({ "main-deck": "Deck", "rune-deck": "Rune", trash: "Trash", banished: "Banish" }[zone] || label);
  return `
    <${tag} class="table-card-pile pile-${zone} ${cardBack ? "face-down" : "face-up"} ${compact ? "compact" : ""}" data-zone="${zone}" data-count="${list.length}" data-effect="${effect}" ${actionAttributes} ${titleAttribute} aria-label="${escapeHtml(`${label} ${list.length}`)}">
      <span class="pile-cards" data-motion-anchor data-motion-zone="${escapeHtml(zone)}" data-motion-player-id="${escapeHtml(playerId)}" aria-hidden="true">
        <i></i><i></i>
        ${cardArtUrl(top) ? `<img src="${escapeHtml(cardArtUrl(top))}" alt="" loading="lazy" />` : `<b>${cardBack ? "R" : zone === "banished" ? "◇" : "—"}</b>`}
      </span>
      <span class="pile-label"><span class="pile-label-full">${label}</span><span class="pile-label-short">${compactLabel}</span></span>
      <strong class="pile-count">${list.length}</strong>
      ${burnOuts > 0 ? `<em class="burnout-stat" title="${locale() === LOCALES.KO ? "소진될 때마다 상대가 1점을 획득합니다." : "Each Burn Out gives an opponent 1 point."}">${locale() === LOCALES.KO ? "소진" : "Burn Out"} ${burnOuts}</em>` : ""}
    </${tag}>
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
  const championDestinations = player && card?.instanceId === player.champion?.instanceId
    ? legalChampionPlayDestinations(card.instanceId)
    : [];
  const dragAttributes = championDestinations.length
    ? `data-card-drag="champion" data-play-destinations="${escapeHtml(championDestinations.join(" "))}" draggable="true"`
    : `draggable="false"`;
  return `
    <button class="identity-button${championState}${exhausted}${sourceGlow}${chainTarget} ${cardStatusClassNames(card)} ${choiceCardStateClasses(card.instanceId)}" data-action="select-card" data-card="${escapeHtml(card.instanceId || "")}" data-card-id="${escapeHtml(card.instanceId || "")}" data-exhausted="${Boolean(card.exhausted)}" ${dragAttributes} title="${escapeHtml(cardName(card))}">
      <span class="identity-orientation-layer card-exhaust-layer">
        ${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="${escapeHtml(cardName(card))}" loading="lazy" />` : `<span class="identity-card-fallback">${escapeHtml(cardName(card))}</span>`}
      </span>
      ${identityEmpoweredMarker(card)}
      ${championState || exhausted ? `<span class="identity-state-label">${card.exhausted ? t("spent", locale()) : championState.trim() === "deployed" ? t("used", locale()) : t("zone", locale())}</span>` : ""}
    </button>
  `;
}

function championPanelStatus(player) {
  if (!player.champion) return "";
  if (!["champion", "played"].includes(player.champion.zone)) return "";
  const deployed = player.championPlayed || player.champion.zone === "played";
  const mine = viewerPlayerId() === player.id;
  const canUse = mine && !deployed && uiChampionPlayActions.length > 0;
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
  const bottomDropDestination = `data-play-destination="${escapeHtml(field.instanceId)}" data-drop-owner="${escapeHtml(bottomPlayer.id)}"`;
  return `
    <article class="battlefield location-column ${showdownActive ? "showdown-location" : ""} ${chainTargetClass(field.instanceId)} ${choiceCardStateClasses(field.instanceId)}" data-card-id="${field.instanceId}">
      <div class="field-lane top-lane ${topTarget.className}" ${topTarget.attrs}>
        <span class="lane-label">${t("opponentUnits", locale())}</span>
        <div class="field-lane-track" data-scroll-key="field-${field.instanceId}-${topPlayer.id}">
          ${battlefieldLaneContents(topPlayer, field, topUnits, topHidden, "top")}
        </div>
      </div>
      <div class="field-center location-card" ${bottomDropDestination}>
        <div class="field-image">${cardImage(field)}</div>
        <div class="battlefield-head">
          <h2>${battlefieldName(field)}</h2>
          <span>${controller}</span>
        </div>
      </div>
      <div class="field-lane bottom-lane ${bottomTarget.className}" ${bottomDropDestination} ${bottomTarget.attrs}>
        <span class="lane-label">${t("yourUnits", locale())}</span>
        <div class="field-lane-track" data-scroll-key="field-${field.instanceId}-${bottomPlayer.id}">
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
  if (!item?.card || typeof item.card !== "object") return "";
  const controllerId = hiddenCardControllerId(item);
  const controlledByViewer = viewerPlayerId() === controllerId;
  const visibleByIntel = canViewPrivateInfo(viewerPlayerId(), controllerId);
  const playable = hiddenPlayable(item, field);
  const sourceGlow = uiMotion.sourceIds.has(item.card.instanceId) ? " source-card-glow hidden-reveal-glow" : "";
  const targetGlow = uiMotion.targetIds.has(item.card.instanceId) ? " target-card-glow" : "";
  const chainTarget = chainTargetClass(item.card.instanceId) ? " chain-effect-target" : "";
  if (controlledByViewer) {
    return `
      <button class="hidden-card-back hidden-card-visible hidden-card-owned owner-${escapeHtml(item.ownerId || "")} ${playable ? "usable-card" : ""}${sourceGlow}${targetGlow}${chainTarget} ${choiceCardStateClasses(item.card.instanceId)}" data-action="select-card" data-card="${escapeHtml(item.card.instanceId || "")}" data-card-id="${escapeHtml(item.card.instanceId || "")}" title="${escapeHtml(cardName(item.card))}">
        <span class="hidden-visible-art">${cardImage(item.card)}</span>
        <span class="hidden-label">${t("hiddenZone", locale())}</span>
      </button>
    `;
  }
  if (visibleByIntel && !controlledByViewer) {
    return `
      <article class="hidden-card-back hidden-card-visible hidden-card-intel owner-${escapeHtml(item.ownerId || "")}${sourceGlow}${targetGlow}${chainTarget} ${choiceCardStateClasses(item.card.instanceId)}" data-card-id="${escapeHtml(item.card.instanceId || "")}" title="${escapeHtml(cardName(item.card))}" role="button" tabindex="0">
        <span class="hidden-visible-art">${cardImage(item.card)}</span>
        <span class="hidden-label">${t("revealed", locale())}</span>
      </article>
    `;
  }
  const attrs = `title="${t("hiddenZone", locale())}" aria-label="${t("opponentHiddenCard", locale())}"`;
  return `
    <button class="hidden-card-back owner-${escapeHtml(item.ownerId || "")} locked-hidden ${playable ? "usable-card" : ""}${sourceGlow}${targetGlow}${chainTarget}" ${attrs}>
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

function championIdentityReference(player, champion) {
  if (!champion) {
    return {
      physical: false,
      zone: "",
      markup: `<span class="empty-card-slot" aria-label="${t("championZone", locale())}"></span>`
    };
  }
  const chainItems = [...(game.actionChain?.chain || []), ...(game.showdown?.chain || [])];
  const inChain = chainItems.some((item) => item?.card?.instanceId === champion.instanceId);
  const inTrash = player.trash.some((card) => card.instanceId === champion.instanceId);
  const inBanished = (player.banished || []).some((card) => card.instanceId === champion.instanceId);
  const inHidden = game.battlefields.some((field) => field.hidden.some((item) => item.card.instanceId === champion.instanceId));
  const inBattlefield = game.battlefields.some((field) => field.units.some((card) => card.instanceId === champion.instanceId));
  const inBase = player.base.some((card) => card.instanceId === champion.instanceId);
  const physical = champion.zone === "champion" && !inChain && !inTrash && !inBanished && !inHidden && !inBattlefield && !inBase;
  if (physical) return { physical: true, zone: "champion", markup: miniIdentity(champion, player) };

  let zone = inChain ? "chain" : String(champion.zone || "played");
  if (!inChain && inTrash) zone = "trash";
  else if (!inChain && inBanished) zone = "banished";
  else if (!inChain && inHidden) zone = "hidden";
  else if (!inChain && inBattlefield) zone = "battlefield";
  else if (!inChain && inBase) zone = "base";
  return {
    physical: false,
    zone,
    markup: ""
  };
}

function decisionVisibleToViewer(decision, viewerId = viewerPlayerId()) {
  return pendingDecisionVisibleToViewer({
    aiMode: aiMode || replayMode || isOnlineGame(),
    viewerPlayerId: viewerId,
    decision
  });
}

function pendingChoiceCardVisibleToViewer(cardId) {
  const choice = game.pendingChoice;
  if (!choice || !cardId || !decisionVisibleToViewer(choice)) return false;
  const revealed = Array.isArray(choice.data?.revealedCards) ? choice.data.revealedCards : [];
  const options = Array.isArray(choice.options) ? choice.options : [];
  const disclosedIds = [
    ...(Array.isArray(choice.data?.revealedIds) ? choice.data.revealedIds : []),
    ...(Array.isArray(choice.data?.lookedIds) ? choice.data.lookedIds : []),
    ...(Array.isArray(choice.data?.observedIds) ? choice.data.observedIds : []),
    ...(Array.isArray(choice.data?.topCardIds) ? choice.data.topCardIds : []),
    ...(typeof choice.data?.topCardId === "string" ? [choice.data.topCardId] : [])
  ].map(String);
  return revealed.some((card) => card?.instanceId === cardId && !card.redacted)
    || options.some((option) => option?.card?.instanceId === cardId && !option.card.redacted)
    || disclosedIds.includes(String(cardId));
}

function cardVisibleToCurrentViewer(cardOrId) {
  const cardId = typeof cardOrId === "string" ? cardOrId : cardOrId?.instanceId;
  if (!cardId) return false;
  if (pendingChoiceCardVisibleToViewer(cardId)) return true;
  const viewerId = viewerPlayerId();
  for (const player of game.players) {
    const owns = player.id === viewerId;
    if (player.legend?.instanceId === cardId || player.champion?.instanceId === cardId) return true;
    if (player.base.some((card) => card?.instanceId === cardId)) return true;
    if (player.runes.some((card) => card?.instanceId === cardId)) return true;
    if (player.trash.some((card) => card?.instanceId === cardId)) return true;
    if ((player.banished || []).some((card) => card?.instanceId === cardId)) return true;
    if (player.hand.some((card) => card?.instanceId === cardId)) return owns || canViewPrivateInfo(viewerId, player.id);
    if (player.mainDeck.some((card) => card?.instanceId === cardId)) return false;
    if (player.runeDeck.some((card) => card?.instanceId === cardId)) return false;
    if ((player.availableChampions || []).some((card) => card?.instanceId === cardId)) return setupSelectionVisibleToViewer(player.id);
    if ((player.availableBattlefields || []).some((card) => card?.instanceId === cardId)) return setupSelectionVisibleToViewer(player.id);
    for (const permanent of player.base) {
      if ((permanent.attachments || []).some((card) => card?.instanceId === cardId)) return true;
    }
  }
  for (const field of game.battlefields) {
    if (field.instanceId === cardId) return true;
    if (field.units.some((card) => card?.instanceId === cardId)) return true;
    for (const unit of field.units) {
      if ((unit.attachments || []).some((card) => card?.instanceId === cardId)) return true;
    }
    const hidden = (field.hidden || []).find((item) => item?.card?.instanceId === cardId);
    if (hidden) {
      const controllerId = hiddenCardControllerId(hidden);
      return controllerId === viewerId || canViewPrivateInfo(viewerId, controllerId);
    }
  }
  return currentChainTreeItems().some((item) =>
    (item.card?.instanceId || item.trigger?.sourceCardId) === cardId
  );
}

function sanitizeViewerUiState() {
  if (intelOpenPlayerId && !canViewPrivateInfo(viewerPlayerId(), intelOpenPlayerId)) intelOpenPlayerId = null;
  if (inspectorPreviewCard) {
    const previewId = inspectorPreviewCard.instanceId || inspectorPreviewCard.id;
    const livePreview = previewId ? findVisibleCard(previewId) : null;
    if (!livePreview || !cardVisibleToCurrentViewer(livePreview)) inspectorPreviewCard = null;
    else inspectorPreviewCard = livePreview;
  }
  if (game.selectedCardId && !cardVisibleToCurrentViewer(game.selectedCardId)) {
    game.selectedCardId = null;
    onlineSelectedCardId = null;
    if (!inspectedChainCard()) inspectorOpen = false;
    attachmentsOpenCardId = null;
  }
  if (inspectorOpen && !inspectedCard()) inspectorOpen = false;
  if (attachmentsOpenCardId && !cardVisibleToCurrentViewer(attachmentsOpenCardId)) attachmentsOpenCardId = null;
  if (fullCardOpen) {
    const preview = fullCardPreviewCard || inspectedCard();
    if (!preview || !cardVisibleToCurrentViewer(preview)) {
      fullCardOpen = false;
      fullCardPreviewCard = null;
    } else {
      fullCardPreviewCard = findVisibleCard(preview.instanceId || preview.id) || preview;
    }
  }
  syncInspectedChainTargets();
}

function viewerPlayerId() {
  if (replayMode) return replayBrowser.viewerPlayerId || "p1";
  if (isOnlineGame() && online.playerId) return online.playerId;
  if (aiMode && aiHumanPlayerId) return aiHumanPlayerId;
  return activePlayerId() || currentPlayer(game)?.id || game.players[0]?.id;
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
  if (isOnlineGame()) return activePlayerId() === viewerPlayerId();
  if (aiMode) return activePlayerId() === aiHumanPlayerId && !aiThinking;
  return true;
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
  if (id === viewerPlayerId()) return "acting-bottom";
  return game.players.some((player) => player.id === id) ? "acting-top" : "";
}

function handCard(card, index = 0, total = 1) {
  if (!card || typeof card !== "object") return "";
  const choiceOption = choiceOptionForCard(card.instanceId);
  const choiceSurface = game?.pendingChoice ? choiceCardSurface(game.pendingChoice) : "none";
  const choiceSelectable = Boolean(choiceOption && ["hand", "board"].includes(choiceSurface) && !choiceOption.disabled);
  const playDestinations = legalHandCardPlayDestinations(card.instanceId);
  const draggable = !choiceSelectable && playDestinations.length > 0;
  const dragAttributes = draggable
    ? `data-card-drag="play" data-play-destinations="${escapeHtml(playDestinations.join(" "))}" draggable="true"`
    : `data-play-destinations="" draggable="false"`;
  return `
    <article class="hand-fan-card ${imageCardClass(card, `${card.type || "card"} ${motionCardClass(card, "hand")}`)}" data-card-id="${escapeHtml(card.instanceId || "")}" data-hand-card ${choiceSelectable ? `data-action="stage-choice-card" data-choice="${escapeHtml(choiceOption.id || "")}"` : ""} ${dragAttributes} style="${fanCardStyle(index, total)}" role="button" tabindex="0" aria-label="${escapeHtml(cardName(card))}" aria-pressed="${choiceSelectable ? choiceOptionCardId(stagedChoiceOption()) === card.instanceId : game.selectedCardId === card.instanceId}">
      <div class="card-orientation-layer">
        <div class="card-face-layer">${cardImage(card)}</div>
      </div>
    </article>
  `;
}

function legalHandCardPlayDestinations(cardId) {
  if (!cardId || replayMode || game?.pendingChoice || game?.pendingPayment || online.commandPending || !viewerCanAct()) return [];
  return [...new Set(uiCardActions(cardId)
    .filter((action) => action?.kind === "beginPlayCard" && action.cardId === cardId && typeof action.destination === "string")
    .filter((action) => tutorialAllowsUiAction("begin-play", { card: cardId, destination: action.destination }))
    .map((action) => action.destination)
    .filter(Boolean))];
}

function legalChampionPlayDestinations(cardId) {
  const requestedCardId = String(cardId || "");
  const player = viewerPlayer();
  if (!requestedCardId || !player || replayMode || game?.pendingChoice || game?.pendingPayment || online.commandPending || !viewerCanAct()) return [];
  if (player.champion?.instanceId !== requestedCardId || player.championPlayed || player.champion?.zone !== "champion") return [];
  return [...new Set(uiChampionPlayActions
    .filter((action) => action?.kind === "beginPlayChampion" && typeof action.destination === "string")
    .filter((action) => tutorialAllowsUiAction("begin-champion", { card: requestedCardId, destination: action.destination }))
    .map((action) => action.destination)
    .filter(Boolean))];
}

function requestChampionPlay(cardId, destination) {
  const requestedCardId = String(cardId || "");
  const requestedDestination = String(destination || "");
  if (!requestedCardId || !requestedDestination) return false;
  if (!legalChampionPlayDestinations(requestedCardId).includes(requestedDestination)) return false;
  const player = viewerPlayer();
  const legalAction = uiChampionPlayActions.find((action) =>
    action?.kind === "beginPlayChampion" && action.destination === requestedDestination
  );
  if (!player || player.champion?.instanceId !== requestedCardId || !legalAction
    || !tutorialAllowsUiAction("begin-champion", { card: requestedCardId, destination: requestedDestination })) return false;
  handOpen = false;
  dispatchGameCommand(
    { kind: "beginPlayChampion", destination: requestedDestination },
    () => beginPlayChampion(game, requestedDestination)
  );
  return true;
}

function requestHandCardPlay(cardId, destination) {
  const requestedCardId = String(cardId || "");
  const requestedDestination = String(destination || "");
  if (!requestedCardId || !requestedDestination) return false;
  if (!legalHandCardPlayDestinations(requestedCardId).includes(requestedDestination)) return false;
  const legalAction = uiCardActions(requestedCardId).find((action) =>
    action?.kind === "beginPlayCard"
      && action.cardId === requestedCardId
      && action.destination === requestedDestination
  );
  if (!legalAction || !tutorialAllowsUiAction("begin-play", {
    card: requestedCardId,
    destination: requestedDestination
  })) return false;
  handOpen = false;
  dispatchGameCommand(
    { kind: "beginPlayCard", cardId: requestedCardId, destination: requestedDestination },
    () => beginPlayCard(game, requestedCardId, requestedDestination)
  );
  return true;
}

function legalUnitMoveDestinations(unitId) {
  if (!unitId || replayMode || game?.pendingChoice || game?.pendingPayment || online.commandPending || !viewerCanAct()) return [];
  return uiUnitMoveDestinationIds(unitId)
    .filter((destination) => tutorialAllowsUiAction("move", { unit: String(unitId), destination }))
    .filter(Boolean);
}

function requestUnitMove(unitId, destination) {
  const requestedUnitId = String(unitId || "");
  const requestedDestination = String(destination || "");
  if (!requestedUnitId || !requestedDestination) return false;
  if (!legalUnitMoveDestinations(requestedUnitId).includes(requestedDestination)) return false;
  if (!uiUnitMoveDestinationIds(requestedUnitId).includes(requestedDestination)
    || !tutorialAllowsUiAction("move", {
    unit: requestedUnitId,
    destination: requestedDestination
  })) return false;
  dispatchGameCommand(
    { kind: "moveUnit", unitId: requestedUnitId, destinationId: requestedDestination },
    () => moveUnit(game, requestedUnitId, requestedDestination)
  );
  moveSelection.clear();
  return true;
}

function cardDragDescriptor(sourceNode) {
  if (!(sourceNode instanceof HTMLElement)) return null;
  const kind = sourceNode.dataset.cardDrag;
  const cardId = String(sourceNode.dataset.cardId || "");
  if (!cardId || !["play", "move", "champion"].includes(kind)) return null;
  const destinations = kind === "play"
    ? legalHandCardPlayDestinations(cardId)
    : kind === "champion"
      ? legalChampionPlayDestinations(cardId)
      : legalUnitMoveDestinations(cardId);
  return destinations.length ? { kind, cardId } : null;
}

function dragSessionDestinations(session = draggingCardSession) {
  if (!session?.cardId) return [];
  if (session.destinations instanceof Set) return [...session.destinations];
  if (session.kind === "move") return legalUnitMoveDestinations(session.cardId);
  if (session.kind === "champion") return legalChampionPlayDestinations(session.cardId);
  return legalHandCardPlayDestinations(session.cardId);
}

function legalDropDestinationNode(node, session = draggingCardSession) {
  const destinationNode = node?.closest?.("[data-play-destination]") || null;
  if (!destinationNode || !app.contains(destinationNode)) return null;
  if (String(destinationNode.dataset.dropOwner || "") !== String(viewerPlayerId() || "")) return null;
  const destination = String(destinationNode.dataset.playDestination || "");
  const destinations = session?.destinations instanceof Set
    ? session.destinations
    : new Set(dragSessionDestinations(session));
  return destinations.has(destination) ? destinationNode : null;
}

function beginCardDragPresentation(session, sourceNode = null) {
  const normalized = session?.kind && session?.cardId
    ? { kind: String(session.kind), cardId: String(session.cardId) }
    : null;
  if (draggingCardSession && (
    draggingCardSession.kind !== normalized?.kind
    || draggingCardSession.cardId !== normalized?.cardId
  )) clearCardDragPresentation();
  const destinations = new Set(dragSessionDestinations(normalized));
  if (!normalized || !destinations.size) return false;
  const destinationNodes = new Set();
  draggingCardSession = {
    ...normalized,
    destinations,
    destinationNodes,
    activeTarget: null,
    sourceNode
  };
  app.classList.add("is-dragging-card", `is-dragging-${normalized.kind}`);
  sourceNode?.classList.add("drag-source-active");
  for (const node of app.querySelectorAll("[data-play-destination]")) {
    const ownDestination = String(node.dataset.dropOwner || "") === String(viewerPlayerId() || "");
    const destination = String(node.dataset.playDestination || "");
    const legal = ownDestination && destinations.has(destination);
    node.classList.toggle("is-legal-drop", legal);
    if (legal) destinationNodes.add(node);
  }
  return true;
}

function updateCardDragDestination(node) {
  const previous = draggingCardSession?.activeTarget || null;
  const target = legalDropDestinationNode(node);
  if (target === previous) return target;
  previous?.classList?.remove("drag-over", "drop-target-active");
  if (target) target.classList.add("drag-over", "drop-target-active");
  if (draggingCardSession) draggingCardSession.activeTarget = target;
  return target;
}

function clearCardDragPresentation() {
  const pointerSession = pointerCardDrag;
  pointerCardDrag = null;
  if (pointerCardDragFrame) cancelAnimationFrame(pointerCardDragFrame);
  pointerCardDragFrame = 0;
  app.classList.remove("is-dragging-card", "is-dragging-play", "is-dragging-move", "is-dragging-champion");
  draggingCardSession?.sourceNode?.classList?.remove("drag-source-active");
  for (const node of draggingCardSession?.destinationNodes?.values?.() || []) {
    node.classList.remove("is-legal-drop", "drag-over", "drop-target-active");
  }
  pointerSession?.ghost?.remove?.();
  try {
    if (pointerSession?.sourceNode?.hasPointerCapture?.(pointerSession.pointerId)) {
      pointerSession.sourceNode.releasePointerCapture(pointerSession.pointerId);
    }
  } catch {
    // Pointer capture may already have been released by the browser.
  }
  draggingCardSession = null;
  if (cardDragRenderPending) {
    queueMicrotask(() => {
      if (cardDragRenderPending && !draggingCardSession && !pointerCardDrag) render();
    });
  }
}

function createPointerDragGhost(sourceNode) {
  if (!(sourceNode instanceof HTMLElement)) return null;
  const ghost = sourceNode.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.removeAttribute("draggable");
  ghost.removeAttribute("tabindex");
  ghost.removeAttribute("role");
  ghost.classList.add(sourceNode.dataset.cardDrag === "move"
    ? "board-card-drag-ghost"
    : sourceNode.dataset.cardDrag === "champion"
      ? "champion-card-drag-ghost"
      : "hand-card-drag-ghost");
  ghost.setAttribute("aria-hidden", "true");
  document.body.appendChild(ghost);
  return ghost;
}

function positionPointerDragGhost(ghost, clientX, clientY) {
  if (!ghost) return;
  ghost.style.setProperty("--drag-x", `${clientX}px`);
  ghost.style.setProperty("--drag-y", `${clientY}px`);
}

function visibleCardStatuses(card) {
  const activeLocale = locale();
  if (visibleCardStatusCacheLocale !== activeLocale) {
    visibleCardStatusCache = new WeakMap();
    visibleCardStatusCacheLocale = activeLocale;
  }
  if (card && visibleCardStatusCache.has(card)) return visibleCardStatusCache.get(card);
  const statuses = cardStatusItems(card, {
    locale: locale(),
    keywordLabel: (keyword) => keywordText([keyword]),
    cardLabel: (name) => localizedDynamicText(name),
    domainLabel: (domain) => domainText(domain)
  });
  if (card && typeof card === "object") visibleCardStatusCache.set(card, statuses);
  return statuses;
}

function cardStatusBadges(card, { excludeKinds = [] } = {}) {
  const excluded = new Set(excludeKinds);
  const statuses = visibleCardStatuses(card)
    .filter((status) => !["exhausted", "damage", "attachments"].includes(status.kind) && !excluded.has(status.kind))
    .sort((left, right) => Number(right.kind === "empowered") - Number(left.kind === "empowered"));
  if (!statuses.length) return "";
  const visible = statuses.slice(0, 2);
  const remaining = statuses.length - visible.length;
  const summary = statuses.map((status) => status.badge).join(", ");
  return `
    <span class="unit-state-badges" aria-label="${escapeHtml(locale() === LOCALES.KO ? `적용 상태: ${summary}` : `Active statuses: ${summary}`)}" title="${escapeHtml(summary)}">
      ${visible.map((status) => `<span class="unit-state-badge tone-${status.tone}" data-status-kind="${escapeHtml(status.kind)}">${escapeHtml(compactBoardStatusLabel(status))}</span>`).join("")}
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
  const boardMight = isUnit ? uiCurrentMight(card) : 0;
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
  const art = cardArtUrl(unit)
    ? `<img src="${escapeHtml(cardArtUrl(unit))}" alt="" />`
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

function ownerChip(owner, fallbackId = "") {
  const fullName = owner ? playerName(owner) : String(fallbackId || "");
  const playerIndex = owner ? game.players.findIndex((player) => player.id === owner.id) : -1;
  const shortName = playerIndex >= 0 ? `P${playerIndex + 1}` : fullName;
  return `<span class="owner-chip" title="${escapeHtml(fullName)}"><span class="owner-chip-full">${escapeHtml(fullName)}</span><span class="owner-chip-short">${escapeHtml(shortName)}</span></span>`;
}

function boardCard(card, location) {
  const flashed = isFlashed(card.instanceId);
  const owner = game.players.find((player) => player.id === card.ownerId);
  const motion = motionCardClass(card, "board");
  const attachments = card.type === "unit" && Array.isArray(card.attachments)
    ? card.attachments.filter((gear) => gear && typeof gear === "object" && !Array.isArray(gear))
    : [];
  if (location === "base") return baseToken(card, location, owner, motion, attachments, flashed);
  if (card.type === "unit") return unitToken(card, location, owner, motion, attachments, flashed);
  return `
    <article class="${imageCardClass(card, `${card.type} owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : ""} ${flashed ? "effect-flash" : ""} ${motion}`)}" data-card-id="${card.instanceId}" data-location="${location}" data-exhausted="${Boolean(card.exhausted)}">
      ${ownerChip(owner, card.ownerId)}
      ${moveSelectButton(card)}
      <div class="card-exhaust-layer"><div class="card-face-layer">${cardImage(card)}</div></div>
      ${attachmentStrip(attachments)}
      ${statusLine(card)}
    </article>
  `;
}

function boardUnitDragAttributes(card) {
  if (!card || card.type !== "unit") return `draggable="false"`;
  const destinations = legalUnitMoveDestinations(card.instanceId);
  if (!destinations.length) return `data-move-destinations="" draggable="false"`;
  return `data-card-drag="move" data-move-destinations="${escapeHtml(destinations.join(" "))}" draggable="true"`;
}

function baseToken(card, location, owner, motion, attachments, flashed) {
  const domain = domainText(card.domains?.[0]) || (card.tags?.[0] ? keywordText([card.tags[0]]) : cardType(card));
  const stats = card.type === "unit" ? boardUnitStats(card, location) : null;
  const gearMight = card.type === "gear" ? Math.max(0, Number(effectiveMight(card)) || 0) : null;
  const stateLabel = card.exhausted ? t("exhausted", locale()) : t("readyState", locale());
  const statusSummary = visibleCardStatuses(card).map((status) => status.badge).filter(Boolean).join(", ");
  const accessibleState = [cardName(card), stateLabel]
    .concat(stats ? [`${t("currentMight", locale())} ${stats.might}`, `${t("remainingHealth", locale())} ${stats.remaining}`] : [])
    .concat(statusSummary ? [statusSummary] : [])
    .join(" · ");
  const dragAttributes = boardUnitDragAttributes(card);
  return `
    <article class="unit-token base-token physical-board-card ${card.type}-token owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : "ready"} ${cardStatusClassNames(card)} ${unitMightAnimationClass(card)} ${chainTargetClass(card.instanceId)} ${choiceCardStateClasses(card.instanceId)} ${flashed ? "effect-flash" : ""} ${motion}" data-card-id="${card.instanceId}" data-location="${location}" data-current-might="${stats?.might ?? gearMight ?? ""}" data-remaining-health="${stats?.remaining ?? ""}" data-damage="${Number(card.damage) || 0}" data-exhausted="${Boolean(card.exhausted)}" data-stunned="${Boolean(card.stunned)}" ${dragAttributes} role="button" tabindex="0" aria-label="${escapeHtml(accessibleState)}" title="${escapeHtml(accessibleState)}">
      <div class="card-exhaust-layer">
        <div class="card-face-layer">
          <div class="unit-token-art">
            ${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="${escapeHtml(cardName(card))}" loading="lazy" />` : `<span>${escapeHtml(cardName(card))}</span>`}
          </div>
          ${cardArtUrl(card) ? "" : `<div class="unit-token-body"><strong>${escapeHtml(cardName(card))}</strong><span>${escapeHtml(domain)}</span></div>`}
          ${empoweredBoardMarker(card)}
          ${boardCardCornerOverlay(card, stats)}
        </div>
      </div>
      ${ownerChip(owner, card.ownerId)}
      ${card.type === "unit" ? unitMightCue(card) : ""}
      ${card.type === "unit" ? moveSelectButton(card) : ""}
      ${attachmentStrip(attachments)}
    </article>
  `;
}

function unitToken(card, location, owner, motion, attachments, flashed) {
  const domain = domainText(card.domains?.[0]) || (card.tags?.[0] ? keywordText([card.tags[0]]) : "");
  const zoneClass = location === "base" ? "base-token" : "field-token";
  const stats = boardUnitStats(card, location);
  const stateLabel = card.exhausted ? t("exhausted", locale()) : t("readyState", locale());
  const statusSummary = visibleCardStatuses(card).map((status) => status.badge).filter(Boolean).join(", ");
  const accessibleState = [
    cardName(card),
    stateLabel,
    `${t("currentMight", locale())} ${stats.might}`,
    `${t("remainingHealth", locale())} ${stats.remaining}`,
    statusSummary
  ].filter(Boolean).join(" · ");
  const dragAttributes = boardUnitDragAttributes(card);
  return `
    <article class="unit-token ${zoneClass} physical-board-card owner-${card.ownerId} controller-${card.controllerId} ${attachments.length ? "has-attachments" : ""} ${card.exhausted ? "exhausted" : "ready"} ${cardStatusClassNames(card)} ${unitMightAnimationClass(card)} ${chainTargetClass(card.instanceId)} ${choiceCardStateClasses(card.instanceId)} ${flashed ? "effect-flash" : ""} ${motion}" data-card-id="${card.instanceId}" data-location="${location}" data-current-might="${stats.might}" data-remaining-health="${stats.remaining}" data-damage="${Number(card.damage) || 0}" data-exhausted="${Boolean(card.exhausted)}" data-stunned="${Boolean(card.stunned)}" ${dragAttributes} role="button" tabindex="0" aria-label="${escapeHtml(accessibleState)}" title="${escapeHtml(accessibleState)}">
      <div class="card-exhaust-layer">
        <div class="card-face-layer">
          <div class="unit-token-art">
            ${cardArtUrl(card) ? `<img src="${escapeHtml(cardArtUrl(card))}" alt="${escapeHtml(cardName(card))}" loading="lazy" />` : `<span>${escapeHtml(cardName(card))}</span>`}
          </div>
          ${cardArtUrl(card) ? "" : `<div class="unit-token-body"><strong>${escapeHtml(cardName(card))}</strong><span>${escapeHtml(domain)}</span></div>`}
          ${empoweredBoardMarker(card)}
          ${boardCardCornerOverlay(card, stats)}
        </div>
      </div>
      ${ownerChip(owner, card.ownerId)}
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
  const safeAttachments = Array.isArray(attachments)
    ? attachments.filter((gear) => gear && typeof gear === "object" && !Array.isArray(gear))
    : [];
  if (!safeAttachments.length) return "";
  return `
    <div class="attachment-strip" aria-label="${locale() === LOCALES.KO ? "부착된 도구" : "Attached gear"}">
      ${safeAttachments.map((gear) => {
        const state = attachedGearCompactState(gear);
        return `
        <button class="attached-gear ${gear.exhausted ? "exhausted" : "ready"} ${cardStatusClassNames(gear)} ${game.selectedCardId === gear.instanceId ? "selected-attachment" : ""} ${chainTargetClass(gear.instanceId)} ${choiceCardStateClasses(gear.instanceId)}" data-action="select-card" data-card="${escapeHtml(gear.instanceId || "")}" data-card-id="${escapeHtml(gear.instanceId || "")}" data-current-might="${state.might}" data-exhausted="${Boolean(gear.exhausted)}" title="${escapeHtml(`${cardName(gear)} · ${state.summary}`)}">
          <span class="attachment-orientation-layer">
            ${cardArtUrl(gear) ? `<img src="${escapeHtml(cardArtUrl(gear))}" alt="${escapeHtml(cardName(gear))}" loading="lazy" />` : `<span>${escapeHtml(cardName(gear))}</span>`}
            <span class="attached-gear-board-overlay" aria-hidden="true">
              ${cardStatusBadges(gear)}
            </span>
          </span>
        </button>
      `; }).join("")}
    </div>
  `;
}

function boardUnitStats(card, location) {
  const raw = showdownUnitStats(card, location) || unitDamageState(game, card, { might: uiCurrentMight(card) });
  const might = Number.isFinite(Number(raw?.might)) ? Number(raw.might) : 0;
  const remaining = Number.isFinite(Number(raw?.remaining)) ? Math.max(0, Number(raw.remaining)) : Math.max(0, might);
  return { might, remaining };
}

function empoweredBoardMarker(card) {
  const status = visibleCardStatuses(card).find((candidate) => candidate.kind === "empowered");
  if (!status) return "";
  const visibleLabel = locale() === LOCALES.KO ? "강화됨" : "Empowered";
  return `<span class="empowered-board-marker" data-empowered-count="${Math.max(1, Number(card.empoweredCount) || 1)}" title="${escapeHtml(status.badge)}" aria-label="${escapeHtml(status.badge)}"><span aria-hidden="true">✦</span>${escapeHtml(visibleLabel)}</span>`;
}

function identityEmpoweredMarker(card) {
  const status = visibleCardStatuses(card).find((candidate) => candidate.kind === "empowered");
  if (!status) return "";
  const visibleLabel = locale() === LOCALES.KO ? "강화됨" : "Empowered";
  return `<span class="identity-empowered-marker" data-empowered-count="${Math.max(1, Number(card.empoweredCount) || 1)}" title="${escapeHtml(status.badge)}" aria-label="${escapeHtml(status.badge)}"><span aria-hidden="true">✦</span>${escapeHtml(visibleLabel)}</span>`;
}

function boardCardCornerOverlay(card, stats = null) {
  const statusMarkup = cardStatusBadges(card, { excludeKinds: ["empowered"] });
  if (!stats && !statusMarkup) return "";
  return `
    <span class="unit-board-overlay" aria-hidden="true">
      ${statusMarkup}
      ${stats ? `<span class="unit-corner-value unit-remaining-health ${stats.remaining <= 0 ? "lethal-stat" : "health-stat"}" title="${escapeHtml(`${t("remainingHealth", locale())} ${stats.remaining}`)}">${stats.remaining}</span>` : ""}
      ${stats ? `<span class="unit-corner-value unit-current-might" title="${escapeHtml(`${t("currentMight", locale())} ${stats.might}`)}">${stats.might}</span>` : ""}
    </span>
  `;
}

function compactBoardStatusLabel(status) {
  const badge = String(status?.badge || "").trim();
  if (!badge) return locale() === LOCALES.KO ? "상태" : "Status";
  if (locale() !== LOCALES.KO) {
    return badge
      .replace(/^Temporary Might\s*/iu, "Might ")
      .replace(/^Might modifier\s*/iu, "Might ")
      .replace(/^Damage prevention\s*/iu, "Guard ")
      .replace(/^Control changed$/iu, "Control");
  }
  return badge
    .replace(/^일시 위력\s*/u, "위력 ")
    .replace(/^위력 변경\s*/u, "위력 ")
    .replace(/^피해 방지\s*/u, "방지 ")
    .replace(/^죽음 대체$/u, "보호")
    .replace(/^조종권 변경$/u, "조종");
}

function attachedGearCompactState(gear) {
  const mightValue = Number(effectiveMight(gear));
  const might = Number.isFinite(mightValue) ? mightValue : 0;
  const readiness = gear?.exhausted ? t("exhausted", locale()) : t("readyState", locale());
  const statuses = visibleCardStatuses(gear)
    .filter((status) => !["exhausted", "attachments"].includes(status.kind))
    .map((status) => status.badge)
    .filter(Boolean);
  const summary = [readiness, ...statuses].join(" · ");
  const compactReadiness = locale() === LOCALES.KO
    ? readiness
    : gear?.exhausted ? "EXH" : "RDY";
  const compactSummary = `${compactReadiness}${statuses.length ? ` +${statuses.length}` : ""}`;
  return { might, readiness, statuses, summary, compactSummary };
}

function attachedGearStateMarkup(state, { compact = false } = {}) {
  const visibleSummary = compact ? state.compactSummary : state.summary;
  return `
    <span class="attached-gear-state" aria-label="${escapeHtml(state.summary)}">
      <span class="attached-gear-might" title="${escapeHtml(t("might", locale()))}">${state.might}</span>
      <span class="attached-gear-readiness" title="${escapeHtml(state.summary)}">${escapeHtml(visibleSummary)}</span>
    </span>
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
  const choiceClasses = choiceCardStateClasses(card?.instanceId);
  return `image-card ${extra} ${sourceGlow} ${targetGlow} ${chainTargetClass(card?.instanceId)} ${isUsableCard(card) ? "usable-card" : ""} ${game.selectedCardId === card?.instanceId ? "selected-card" : ""} ${choiceClasses}`.trim();
}

function chainTargetClass(cardId) {
  return cardId && inspectedChainTargetIds.has(cardId) ? "chain-effect-target" : "";
}

function motionCardClass() {
  // Geometry-based flights own position and scale changes. Re-applying legacy
  // entry transforms here makes the destination card animate a second time.
  return "";
}

function cardArtUrl(card) {
  return translateCardImage(card, locale());
}

function cardImage(card) {
  const art = cardArtUrl(card)
    ? `<img class="card-art" src="${cardArtUrl(card)}" alt="${cardName(card)}" loading="lazy" />`
    : `<div class="card-art placeholder">${cardName(card)}</div>`;
  return art;
}

function statusLine(card) {
  if (card.type !== "unit") return "";
  const items = [`${t("might", locale())} ${uiCurrentMight(card)}`];
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
  return `<span class="status-line card-state-hud">${items.join(" / ")}</span>`;
}

function moveButtons(card) {
  const destinationIds = new Set(uiUnitMoveDestinationIds(card.instanceId));
  const buttons = destinationIds.has("base")
    ? [`<button data-action="move" data-unit="${card.instanceId}" data-destination="base">${t("base", locale())}</button>`]
    : [];
  for (const [index, field] of visibleBattlefields().entries()) {
    if (!destinationIds.has(field.instanceId)) continue;
    buttons.push(`<button data-action="move" data-unit="${card.instanceId}" data-destination="${field.instanceId}" title="${battlefieldName(field)}">${t("moveToField", locale(), { n: index + 1 })}</button>`);
  }
  return buttons.join("");
}

function passParticipantIds(chain, { actionChain = false } = {}) {
  if (!chain || typeof chain !== "object") return [];
  const declared = actionChain
    ? (Array.isArray(chain.playerIds) && chain.playerIds.length ? chain.playerIds : [chain.turnPlayerId])
    : [chain.attackerId, chain.defenderId];
  const ids = [...new Set(declared.map((id) => String(id || "")).filter(Boolean))];
  if (ids.length) return ids;
  return [...new Set((Array.isArray(game?.players) ? game.players : [])
    .map((candidate) => String(candidate?.id || ""))
    .filter(Boolean))];
}

function passControlState() {
  const actionChain = game?.actionChain || null;
  const showdown = game?.phase === "showdown" ? game?.showdown || null : null;
  const chain = actionChain || showdown;
  if (!chain) return null;
  const isActionChain = Boolean(actionChain);
  const items = Array.isArray(chain.chain) ? chain.chain.filter(Boolean) : [];
  const required = Math.max(1, passParticipantIds(chain, { actionChain: isActionChain }).length);
  const rawPassed = Number(chain.consecutivePasses);
  const passed = Math.min(required, Math.max(0, Number.isFinite(rawPassed) ? Math.trunc(rawPassed) : 0));
  const completesCycle = passed + 1 >= required;
  const korean = locale() === LOCALES.KO;
  let label = korean ? "우선권 넘기기" : "Pass Priority";

  if (items.length) {
    label = completesCycle
      ? (korean ? "패스 · 효과 해결" : "Pass & Resolve")
      : (korean ? "체인 패스" : "Pass Chain");
  } else if (isActionChain) {
    label = completesCycle
      ? (korean ? "반응 창 종료" : "Close Response")
      : (korean ? "반응 패스" : "Pass Response");
  } else {
    label = completesCycle
      ? chain.combat === false
        ? (korean ? "결전 종료 · 진행" : "End · Continue")
        : (korean ? "결전 종료 · 전투" : "End · Combat")
      : (korean ? "포커스 패스" : "Pass Focus");
  }

  const progressText = korean
    ? `패스 ${passed}/${required}${items.length ? ` · 효과 ${items.length}` : ""}`
    : `Pass ${passed}/${required}${items.length ? ` · ${items.length} effect${items.length === 1 ? "" : "s"}` : ""}`;
  return { label, progressText, passed, required, completesCycle, itemCount: items.length };
}

function passControlButton({ disabled = false } = {}) {
  const state = passControlState();
  if (!state) return "";
  const inaccessible = Boolean(disabled || game?.pendingChoice || game?.pendingPayment || !viewerCanAct());
  const accessibleLabel = `${state.label} · ${state.progressText}`;
  return `
    <button type="button" class="primary pass-control" data-action="pass-showdown" ${inaccessible ? "disabled" : ""} aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(accessibleLabel)}">
      <span>${escapeHtml(state.label)}</span>
      <small>${escapeHtml(state.progressText)}</small>
    </button>
  `;
}

function actionWindowCommandButton(cardCount) {
  if (!actionUseWindowAvailable()) return "";
  return `<button class="primary action-window-toggle" data-action="toggle-hand" title="${escapeHtml(`${t("hand", locale())} ${cardCount}`)}">${handOpen ? t("hideHand", locale()) : playWindowControlLabel()}</button>`;
}

function actionCommandList(markup, scrollKey) {
  if (!String(markup || "").trim()) return "";
  return `
    <div class="actions inline action-command-list right-action-command-list" data-scroll-key="${escapeHtml(scrollKey)}">
      ${markup}
    </div>
  `;
}

function tableUtilityRail(card) {
  const chainActive = Boolean(game?.actionChain || (game?.phase === "showdown" && game?.showdown));
  const waiting = isOnlineGame() && !viewerCanAct();
  const disabled = Boolean(game?.pendingPayment || game?.pendingChoice);
  const standaloneChoice = Boolean(
    decisionVisibleToViewer(game?.pendingChoice)
    && !pendingChoiceSharesChainSurface(game.pendingChoice)
  );
  return `
    <div class="bar-controls table-action-rail" aria-label="${escapeHtml(locale() === LOCALES.KO ? "보조 기능" : "Table utilities")}">
      <button data-action="toggle-inspector" ${card && !standaloneChoice ? "" : "disabled"}>${t("cardInfo", locale())}</button>
      ${chainActive ? "" : `<button data-action="end-turn" ${game.phase !== "action" || waiting || disabled || !viewerCanAct() ? "disabled" : ""}>${t("endTurn", locale())}</button>`}
    </div>
  `;
}

function actionBar(player, card) {
  if (game.phase === "first-player" || game.phase === "champion-select" || game.phase === "battlefield-select" || game.phase === "mulligan") return "";
  const disabled = Boolean(game?.pendingPayment || game?.pendingChoice);
  const cardCount = Array.isArray(player?.hand) ? player.hand.length : 0;
  const showdown = game.phase === "showdown" ? showdownBarSummary() : null;
  const actionChain = game.actionChain ? actionChainBarSummary() : null;
  const chainSummary = showdown || actionChain;
  const responseInfo = responsePromptInfo();
  const waiting = isOnlineGame() && !viewerCanAct();
  const rejection = !waiting && !disabled ? actionRejection : null;
  if (!card || disabled || waiting) {
    const quickActions = globalActionButtons(player);
    const directCommands = `${quickActions.join("")}${chainSummary ? "" : moveBatchCommandGroup(player)}${!chainSummary && !responseInfo ? actionWindowCommandButton(cardCount) : ""}`;
    const commandMarkup = waiting
      ? (chainSummary ? priorityResponseControls() : "")
      : responseInfo
        ? priorityResponseControls(quickActions.join(""))
        : chainSummary
          ? priorityResponseControls(quickActions.join(""))
          : directCommands;
    return `
      <section class="action-bar context-action-dock ${chainSummary ? "showdown-action-bar" : ""} ${rejection ? "action-rejected" : ""}">
        <div class="action-context">
          <span class="bar-label">${rejection ? (locale() === LOCALES.KO ? "요청 거부" : "Rejected") : chainSummary ? chainSummary.label : t("action", locale())}</span>
          <strong>${waiting ? t("waitingForOpponent", locale()) : rejection?.title || responseInfo?.title || chainSummary?.title || (disabled ? t("resolvingStep", locale()) : t("noAction", locale()))}</strong>
          <span>${waiting ? t("waitingForOpponent", locale()) : rejection?.detail || responseInfo?.detail || chainSummary?.detail || (disabled ? t("finishDialog", locale()) : t("selectCardHint", locale()))}</span>
        </div>
        ${actionCommandList(commandMarkup, `action-${card?.instanceId || "global"}`)}
      </section>
    `;
  }
  const context = selectedContext(card.instanceId);
  const actions = mergeActionButtons(selectedActions(card, context), globalActionButtons(player, card));
  const directCommands = `${actions.join("")}${chainSummary ? "" : moveBatchCommandGroup(player)}${!chainSummary && !responseInfo ? actionWindowCommandButton(cardCount) : ""}`;
  const commandMarkup = responseInfo
    ? priorityResponseControls(actions.join(""))
    : chainSummary
      ? priorityResponseControls(actions.join(""))
      : directCommands;
  return `
    <section class="action-bar context-action-dock ${chainSummary ? "showdown-action-bar" : ""} ${rejection ? "action-rejected" : ""}">
      <div class="action-context">
        <span class="bar-label">${rejection ? (locale() === LOCALES.KO ? "요청 거부" : "Rejected") : chainSummary ? chainSummary.label : t("selected", locale())}</span>
          <strong>${rejection?.title || responseInfo?.title || chainSummary?.title || cardName(card)}</strong>
        <span>${rejection?.detail || (responseInfo ? `${responseInfo.detail} / ${t("selected", locale())}: ${cardName(card)}` : chainSummary ? `${chainSummary.detail} / ${t("selected", locale())}: ${cardName(card)}` : actionHint(card, context, actions))}</span>
      </div>
      ${actionCommandList(commandMarkup, `action-${card.instanceId || "selected"}`)}
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
  if (game?.phase !== "showdown" || !game?.showdown) return null;
  const field = (Array.isArray(game.battlefields) ? game.battlefields : [])
    .find((candidate) => candidate?.instanceId === game.showdown.battlefieldId);
  const chainCount = Array.isArray(game.showdown.chain) ? game.showdown.chain.filter(Boolean).length : 0;
  return {
    label: t("showdown", locale()),
    title: `${t("showdown", locale())}: ${field ? battlefieldName(field) : t("battlefield", locale())}`,
    detail: chainCount ? `${chainCount} ${t("pending", locale())}` : t("passNoAction", locale())
  };
}

function actionChainBarSummary() {
  const chainCount = Array.isArray(game?.actionChain?.chain) ? game.actionChain.chain.filter(Boolean).length : 0;
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
  return uiCardActions(card.instanceId)
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
  const legalCardActions = uiCardActions(card.instanceId);
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
  const actions = uiChampionPlayActions.map(({ destination }) => {
    if (destination === "base") return `<button data-action="begin-champion" data-destination="base">${t("playChampionToBase", locale())}</button>`;
    const field = game.battlefields.find((candidate) => candidate.instanceId === destination);
    return `<button data-action="begin-champion" data-destination="${destination}">${t("playChampionToField", locale(), { name: battlefieldName(field) })}</button>`;
  });
  for (const command of uiCardActions(player.champion.instanceId).filter((action) => action.kind === "hideCard")) {
    const field = game.battlefields.find((candidate) => candidate.instanceId === command.destination);
    if (field) actions.push(`<button data-action="hide-card" data-card="${player.champion.instanceId}" data-destination="${field.instanceId}">${t("hideAtBattlefield", locale(), { name: battlefieldName(field) })}</button>`);
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
  const abilities = legalActivatedAbilityOptions(game, card.instanceId);
  if (!abilities.length || !viewerCanAct()) return [];
  if (card.type === "rune") {
    return abilities.flatMap((ability) => {
      if (!["addEnergy", "addPower"].includes(ability.kind)) return [];
      const amount = ability.amount;
      if (ability.kind === "addEnergy") {
        const label = locale() === LOCALES.KO ? `탈진 → 에너지 +${amount}` : `Exhaust → +${amount} Energy`;
        return [`<button class="rune-action rune-action-energy" data-action="activate-card" data-card="${card.instanceId}" data-ability="${ability.id}"><strong>${label}</strong></button>`];
      }
      const domain = domainText(ability.domain);
      const label = locale() === LOCALES.KO ? `재활용 → ${domain} 힘 +${amount}` : `Recycle → +${amount} ${domain} Power`;
      return [`<button class="rune-action rune-action-power" data-action="activate-card" data-card="${card.instanceId}" data-ability="${ability.id}"><strong>${label}</strong></button>`];
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
  return uiCardActions(hidden.card.instanceId).some((action) =>
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
  if (!cardId) return null;
  ensureVisibleCardIndex();
  return selectedContextIndex.get(String(cardId)) || null;
}

function isUsableCard(card) {
  if (!card || game.pendingPayment || game.pendingChoice) return false;
  if (["first-player", "champion-select", "battlefield-select", "mulligan", "complete"].includes(game.phase)) return false;
  observeCurrentGame();
  const cacheContext = [viewerPlayerId(), viewerCanAct() ? "can-act" : "waiting", replayMode ? "replay" : "live", appView].join("|");
  if (usableCardCacheGame !== game
    || usableCardCacheRevision !== gameStateRevision
    || usableCardCacheContext !== cacheContext) {
    usableCardCache = new WeakMap();
    usableCardCacheGame = game;
    usableCardCacheRevision = gameStateRevision;
    usableCardCacheContext = cacheContext;
  }
  if (usableCardCache.has(card)) return usableCardCache.get(card);
  const context = selectedContext(card.instanceId);
  const usable = selectedActions(card, context).length > 0;
  usableCardCache.set(card, usable);
  return usable;
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
  const activatedEffects = uiCardEffects(card).filter((effect) => effect.timing === "activated");
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
    return uiCardActions(card.instanceId).some((action) =>
      action.kind === "beginPlayCard" && action.cardId === card.instanceId && action.destination === destination);
  }
  if (context.zone === "champion") {
    return uiChampionPlayActions.some((action) => action.destination === destination);
  }
  if (context.zone === "base" || context.zone === "battlefield") {
    return uiUnitMoveDestinationIds(card.instanceId).includes(destination);
  }
  return false;
}

function runeSummary(player) {
  const pendingCard = game.pendingPayment?.playerId === player?.id
    ? paymentDisplayCard(player, game.pendingPayment)
    : null;
  const seat = tabletopSeatView(player, {
    energyUsable: (resource) => resource?.restriction === "spell"
      ? pendingCard?.type === "spell"
      : poolEnergyCanPay(resource, pendingCard),
    powerUsable: (resource) => resource?.restriction === "spell"
      ? pendingCard?.type === "spell"
      : poolPowerCanPay(resource, pendingCard)
  });
  const counts = new Map();
  for (const rune of seat.runes) {
    const item = counts.get(rune.domain) || {
      total: 0,
      ready: 0,
      color: rune.color,
      image: cardArtUrl(rune) || "",
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
  const poolEnergy = seat.runeResources.energy;
  const poolPower = seat.runeResources.power;
  const availabilityLabel = (resource) => locale() === LOCALES.KO
    ? `${resource.usable}/${resource.total} 지금 사용 가능`
    : `${resource.usable}/${resource.total} available now`;
  return `
    <div class="rune-summary" data-scroll-key="rune-summary-${escapeHtml(player?.id || "unknown")}">
      ${[...counts.entries()].map(([domain, item]) => `
        <button type="button" class="rune-count" data-action="select-card" data-card="${item.cardId}" style="--rune:${item.color}" title="${escapeHtml(item.name)} · ${domainText(domain)} ${item.ready}/${item.total}">
          ${item.image ? `<img class="rune-summary-art" src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" />` : ""}
          <span class="rune-summary-value"><b>${domainText(domain)}</b><em>${item.ready}/${item.total}</em></span>
        </button>
      `).join("") || `<span class="rune-count muted">${t("noRunes", locale())}</span>`}
      ${poolEnergy.total ? `<span class="rune-count generated ${poolEnergy.usable < poolEnergy.total ? "partly-restricted" : ""}" title="${escapeHtml(availabilityLabel(poolEnergy))}"><span class="rune-summary-symbol" aria-hidden="true">⚡</span><span class="rune-summary-value"><b>${t("energy", locale())}</b><em>+${poolEnergy.total} · ${poolEnergy.usable}/${poolEnergy.total}</em></span></span>` : ""}
      ${poolPower.total ? `<span class="rune-count power-pool ${poolPower.usable < poolPower.total ? "partly-restricted" : ""}" title="${escapeHtml(availabilityLabel(poolPower))}"><span class="rune-summary-symbol" aria-hidden="true">◆</span><span class="rune-summary-value"><b>${t("power", locale())}</b><em>${poolPower.total} · ${poolPower.usable}/${poolPower.total}</em></span></span>` : ""}
    </div>
  `;
}

function runeChip(rune, index = 0, total = 1, playerId = "") {
  if (!rune || typeof rune !== "object") return "";
  const spent = rune.exhausted ? " spent" : "";
  const payment = directRunePaymentState(rune, playerId);
  const paymentClasses = payment.active
    ? [
        "payment-rune-choice",
        payment.canPayEnergy ? "can-pay-energy" : "",
        payment.canPayPower ? "can-pay-power" : "",
        payment.energySelected ? "is-energy-selected" : "",
        payment.powerSelected ? "is-power-selected" : "",
        !payment.canPayEnergy && !payment.canPayPower ? "payment-unavailable" : ""
      ].filter(Boolean).join(" ")
    : "";
  const energyInputAvailable = payment.active
    && payment.canPayEnergy
    && tutorialAllowsUiAction("pay-rune", { rune: rune.instanceId, mode: "energy" });
  const powerInputAvailable = payment.active
    && payment.canPayPower
    && tutorialAllowsUiAction("pay-rune", { rune: rune.instanceId, mode: "power" });
  const paymentHelp = [
    energyInputAvailable
      ? (locale() === LOCALES.KO ? "클릭/짧게 누르기: 에너지로 탈진" : "Click/tap: exhaust for Energy")
      : "",
    powerInputAvailable
      ? (locale() === LOCALES.KO ? "오른쪽 클릭/길게 누르기/Shift+Enter: 힘으로 재활용" : "Right-click/touch and hold/Shift+Enter: recycle for Power")
      : ""
  ].filter(Boolean).join(" · ");
  const paymentTitle = payment.active && paymentHelp ? `${cardText(rune)} · ${paymentHelp}` : cardText(rune);
  return `
    <button type="button" class="rune rune-card-chip${spent} ${paymentClasses} ${choiceCardStateClasses(rune.instanceId)}" data-action="${payment.active ? "pay-rune" : "select-card"}" data-mode="${payment.active ? "energy" : ""}" data-direct-payment-rune="${payment.active}" data-card="${escapeHtml(rune.instanceId || "")}" data-card-id="${escapeHtml(rune.instanceId || "")}" data-rune="${escapeHtml(rune.instanceId || "")}" data-rune-card data-payment-energy="${payment.canPayEnergy}" data-payment-power="${payment.canPayPower}" style="--rune:${rune.color || RUNE_COLORS.Any};--rune-index:${index};--rune-count:${Math.max(1, total)}" title="${escapeHtml(paymentTitle)}" aria-pressed="${payment.active ? payment.energySelected || payment.powerSelected : choiceOptionCardId(stagedChoiceOption()) === rune.instanceId || game.selectedCardId === rune.instanceId}" ${payment.active ? `aria-describedby="payment-stage-help"${powerInputAvailable ? " aria-keyshortcuts=\"Shift+Enter\"" : ""}` : ""}>
      <span class="rune-orientation-layer">
        ${cardArtUrl(rune) ? `<img src="${escapeHtml(cardArtUrl(rune))}" alt="${escapeHtml(cardName(rune))}" loading="lazy" />` : `<span class="rune-swatch"></span>`}
        <span class="rune-card-caption">${domainText(rune.domain)}</span>
        ${payment.energySelected ? `<strong class="payment-rune-mode energy-mode">${t("energy", locale())}</strong>` : ""}
        ${payment.powerSelected ? `<strong class="payment-rune-mode power-mode">${t("power", locale())}</strong>` : ""}
      </span>
    </button>
  `;
}

function inspector(card) {
  if (!card || typeof card !== "object") {
    return `
      <aside class="inspector inspector-panel inspector-empty" data-scroll-key="inspector">
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
  const normalizedCard = {
    ...card,
    power: Array.isArray(card.power) ? card.power.filter((item) => item && typeof item === "object") : [],
    keywords: Array.isArray(card.keywords) ? card.keywords.filter(Boolean) : [],
    tags: Array.isArray(card.tags) ? card.tags.filter(Boolean) : [],
    temporaryKeywords: Array.isArray(card.temporaryKeywords) ? card.temporaryKeywords.filter(Boolean) : [],
    damagePreventions: Array.isArray(card.damagePreventions) ? card.damagePreventions.filter(Boolean) : [],
    attachments: Array.isArray(card.attachments) ? card.attachments.filter((item) => item && typeof item === "object") : []
  };
  const power = normalizedCard.power.map((item) => {
    const domain = translateCostDomain(item.domain, locale(), normalizedCard);
    const amount = Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0;
    return locale() === LOCALES.KO ? `${amount} ${domain} ${t("power", locale())}` : `${amount} ${domain}`;
  }).join(", ");
  const cost = normalizedCard.type === "rune"
    ? domainText(normalizedCard.domain)
    : `${normalizedCard.energy ?? "-"}${power ? ` + ${power}` : ""}`;
  const attachments = normalizedCard.attachments;
  const rulesText = String(cardText(normalizedCard) || "").trim();
  const displayName = cardName(normalizedCard);
  return `
    <aside class="inspector inspector-panel" data-scroll-key="inspector">
      <div class="inspector-toolbar">
        <strong>${t("cardInfo", locale())}</strong>
        <button type="button" data-action="toggle-inspector">${t("close", locale())}</button>
      </div>
      <div class="inspector-card">
        <div class="inspector-card-fallback" aria-label="${escapeHtml(displayName)}"><strong>${escapeHtml(displayName)}</strong></div>
        ${cardArtUrl(normalizedCard) ? `<img src="${escapeHtml(cardArtUrl(normalizedCard))}" alt="${escapeHtml(displayName)}" />` : ""}
      </div>
      <div class="inspector-text">
        <h2>${escapeHtml(displayName)}</h2>
        <span>${escapeHtml(cardTags(normalizedCard).join(" / "))} / ${escapeHtml(cost)}</span>
        ${["unit", "gear"].includes(normalizedCard.type) ? `<strong>${t("might", locale())} ${normalizedCard.type === "unit" ? inspectorUnitMight(normalizedCard) : normalizedCard.might || 0}</strong>` : ""}
        <p class="inspector-rules-text">${escapeHtml(rulesText)}</p>
        ${normalizedCard.keywords.length ? `<small>${escapeHtml(keywordText(normalizedCard.keywords))}</small>` : ""}
        ${cardStatusPanel(normalizedCard, { compact: true })}
        <button class="secondary view-full-card" data-action="view-full-card">${t("viewFullCard", locale())}</button>
        ${attachments.length ? `
          <button class="secondary attached-gear-toggle" data-action="toggle-attachments" data-card="${escapeHtml(normalizedCard.instanceId || "")}">
            ${attachmentsOpenCardId === normalizedCard.instanceId ? t("hideAttachedGear", locale()) : `${t("attachedGear", locale())} ${attachments.length}`}
          </button>
          ${attachmentsOpenCardId === normalizedCard.instanceId ? attachedGearPanel(attachments) : ""}
        ` : ""}
      </div>
    </aside>
  `;
}

function inspectorUnitMight(card) {
  const players = Array.isArray(game?.players) ? game.players : [];
  const battlefields = Array.isArray(game?.battlefields) ? game.battlefields : [];
  const onBoard = players.some((player) => (Array.isArray(player?.base) ? player.base : [])
    .some((unit) => unit?.instanceId === card?.instanceId))
    || battlefields.some((field) => (Array.isArray(field?.units) ? field.units : [])
      .some((unit) => unit?.instanceId === card?.instanceId));
  return onBoard ? uiCurrentMight(card) : effectiveMight(card);
}

function attachedGearPanel(attachments) {
  return `
    <div class="attached-gear-panel">
      <span>${t("attachedGear", locale())}</span>
      <div class="attached-gear-list">
        ${attachments.map((gear) => {
          const state = attachedGearCompactState(gear);
          return `
          <button class="attached-gear-card ${gear.exhausted ? "exhausted" : "ready"} ${cardStatusClassNames(gear)}" data-action="select-card" data-card="${escapeHtml(gear.instanceId || "")}" data-card-id="${escapeHtml(gear.instanceId || "")}" data-current-might="${state.might}" data-exhausted="${Boolean(gear.exhausted)}" title="${escapeHtml(`${cardName(gear)} · ${state.summary}`)}">
            <span class="attachment-orientation-layer">
              ${cardArtUrl(gear) ? `<img src="${escapeHtml(cardArtUrl(gear))}" alt="${escapeHtml(cardName(gear))}" loading="lazy" />` : `<span>${escapeHtml(cardName(gear))}</span>`}
            </span>
            <strong>${escapeHtml(cardName(gear))}</strong>
            ${attachedGearStateMarkup(state)}
          </button>
        `; }).join("")}
      </div>
    </div>
  `;
}

function fullCardModal(card) {
  if (!card) return "";
  return `
    <section class="full-card-modal modal-panel" role="dialog" aria-modal="true" aria-labelledby="full-card-dialog-title" data-ui-modal data-modal-key="full-card-${escapeHtml(card.instanceId || card.cardNumber || "preview")}" tabindex="-1">
      <div class="section-head">
        <div>
          <h2 id="full-card-dialog-title">${cardName(card)}</h2>
          <span>${cardTags(card).join(" / ")}</span>
        </div>
        <button data-action="close-full-card" data-primary-focus>${t("close", locale())}</button>
      </div>
      <div class="full-card-body">
        ${cardArtUrl(card) ? `<img src="${cardArtUrl(card)}" alt="${cardName(card)}" />` : ""}
        <div class="full-card-copy">
          <p>${cardText(card)}</p>
          ${cardStatusPanel(card)}
        </div>
      </div>
    </section>
  `;
}

function dismissTopUiLayer() {
  if (appView === "decks" && deckEditor.transferDialog) {
    closeDeckTransferDialog();
    return true;
  }
  if (appView !== "game") return false;
  if (!game || typeof game !== "object") return false;
  const modalKey = topUiModal()?.dataset.modalKey || "";
  if (modalKey === "game-exit") {
    pendingGameExit = null;
    return true;
  }
  if (modalKey === "match-result") {
    resultDismissed = true;
    return true;
  }
  if (modalKey.startsWith("full-card-")) {
    fullCardOpen = false;
    fullCardPreviewCard = null;
    return true;
  }
  if (modalKey.startsWith("payment-") && !replayMode && game.pendingPayment && decisionVisibleToViewer(game.pendingPayment)) {
    dispatchGameCommand({ kind: "cancelPayment" }, () => cancelPayment(game));
    return true;
  }
  if (!modalKey && !replayMode && game.pendingPayment && decisionVisibleToViewer(game.pendingPayment)) {
    dispatchGameCommand({ kind: "cancelPayment" }, () => cancelPayment(game));
    return true;
  }
  if (modalKey.startsWith("choice-") && !replayMode && game.pendingChoice?.optional && decisionVisibleToViewer(game.pendingChoice)) {
    dispatchGameCommand({ kind: "declineEffectChoice" }, () => declineEffectChoice(game));
    return true;
  }
  if (!modalKey && !replayMode && game.pendingChoice?.optional && decisionVisibleToViewer(game.pendingChoice)) {
    dispatchGameCommand({ kind: "declineEffectChoice" }, () => declineEffectChoice(game));
    return true;
  }
  if (attachmentsOpenCardId) {
    attachmentsOpenCardId = null;
    return true;
  }
  if (graveyardOpenPlayerId) {
    graveyardOpenPlayerId = null;
    return true;
  }
  if (banishedOpenPlayerId) {
    banishedOpenPlayerId = null;
    return true;
  }
  if (intelOpenPlayerId) {
    intelOpenPlayerId = null;
    return true;
  }
  if (logOpen) {
    logOpen = false;
    return true;
  }
  if (inspectorOpen) {
    inspectorOpen = false;
    inspectorPreviewCard = null;
    return true;
  }
  if (inspectedChainItemId) {
    inspectedChainItemId = null;
    inspectedChainTargetIds.clear();
    return true;
  }
  if (handOpen) {
    handOpen = false;
    return true;
  }
  if (moveSelection.size) {
    moveSelection.clear();
    return true;
  }
  if (replayMode) {
    exitReplayToList();
    return true;
  }
  return false;
}

window.__riftboundDismissTopUiLayer = () => {
  const dismissed = dismissTopUiLayer();
  if (dismissed) {
    render();
    return true;
  }
  if (appView === "game" && (game?.phase === "complete" || matchIsBetweenGames())) {
    exitCompletedGame();
    return true;
  }
  return false;
};

function hasKeyword(card, keyword) {
  if ((card.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  const player = game.players.find((candidate) => candidate.id === card.controllerId)
    || game.players.find((candidate) => candidate.id === card.ownerId);
  for (const effect of uiCardEffects(card)) {
    if (effect.timing !== "levelStatic" || effect.kind !== "gainKeywords") continue;
    if ((player?.xp || 0) < (effect.level || 0)) continue;
    if ((effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  }
  return false;
}

function isFlashed(cardId) {
  return game.effectFlash?.sourceId === cardId || game.effectFlash?.targetIds?.includes(cardId);
}

function clearRuneScrollGesture() {
  const session = pointerRuneScroll;
  pointerRuneScroll = null;
  session?.track?.classList?.remove("is-panning");
  try {
    if (session?.track?.hasPointerCapture?.(session.pointerId)) {
      session.track.releasePointerCapture(session.pointerId);
    }
  } catch {
    // Pointer capture may already have been released by the browser.
  }
}

function clearRunePowerHold() {
  const session = pointerRunePowerHold;
  pointerRunePowerHold = null;
  if (session?.timerId) clearTimeout(session.timerId);
}

function payDirectRuneAsPower(runeButton) {
  const runeId = String(runeButton?.dataset?.rune || "");
  if (!runeId || runeButton?.dataset?.paymentPower !== "true") return false;
  if (!tutorialAllowsUiAction("pay-rune", { rune: runeId, mode: "power" })) return false;
  dispatchGameCommand(
    { kind: "togglePaymentRune", runeId, mode: "power" },
    () => togglePaymentRune(game, runeId, "power")
  );
  return true;
}

app.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || !event.isPrimary || event.button !== 0 || replayMode || appView !== "game" || !game?.pendingPayment) return;
  const runeButton = event.target.closest?.("button[data-direct-payment-rune='true'][data-rune][data-payment-power='true']");
  if (!runeButton || !app.contains(runeButton)) return;
  clearRunePowerHold();
  const session = {
    pointerId: event.pointerId,
    runeButton,
    startX: event.clientX,
    startY: event.clientY,
    timerId: null
  };
  session.timerId = setTimeout(() => {
    if (pointerRunePowerHold !== session || !runeButton.isConnected) return;
    pointerRunePowerHold = null;
    suppressRuneClickUntil = Date.now() + 700;
    suppressRunePowerContextMenuUntil = Date.now() + 700;
    payDirectRuneAsPower(runeButton);
    render();
  }, 550);
  pointerRunePowerHold = session;
});

app.addEventListener("pointermove", (event) => {
  const session = pointerRunePowerHold;
  if (!session || session.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 10) clearRunePowerHold();
});

app.addEventListener("pointerup", (event) => {
  if (pointerRunePowerHold?.pointerId === event.pointerId) clearRunePowerHold();
});

app.addEventListener("pointercancel", (event) => {
  if (pointerRunePowerHold?.pointerId === event.pointerId) clearRunePowerHold();
});

app.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch" || replayMode || appView !== "game") return;
  const track = event.target.closest?.("[data-rune-scroll-track]");
  if (!(track instanceof HTMLElement) || track.scrollWidth <= track.clientWidth + 1) return;
  clearRuneScrollGesture();
  pointerRuneScroll = {
    pointerId: event.pointerId,
    track,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: track.scrollLeft,
    dragging: false
  };
});

app.addEventListener("pointermove", (event) => {
  const session = pointerRuneScroll;
  if (!session || session.pointerId !== event.pointerId) return;
  if ((event.buttons & 1) === 0) {
    clearRuneScrollGesture();
    return;
  }
  const deltaX = event.clientX - session.startX;
  const deltaY = event.clientY - session.startY;
  if (!session.dragging && Math.hypot(deltaX, deltaY) >= 8 && Math.abs(deltaX) >= Math.abs(deltaY) * 0.7) {
    session.dragging = true;
    session.track.classList.add("is-panning");
    try {
      session.track.setPointerCapture?.(event.pointerId);
    } catch {
      clearRuneScrollGesture();
      return;
    }
  }
  if (!session.dragging) return;
  event.preventDefault();
  session.track.scrollLeft = session.startLeft - deltaX;
}, { passive: false });

app.addEventListener("pointerup", (event) => {
  const session = pointerRuneScroll;
  if (!session || session.pointerId !== event.pointerId) return;
  if (session.dragging) {
    event.preventDefault();
    suppressRuneClickUntil = Date.now() + 500;
  }
  clearRuneScrollGesture();
});

app.addEventListener("pointercancel", (event) => {
  if (pointerRuneScroll?.pointerId === event.pointerId) clearRuneScrollGesture();
});

app.addEventListener("lostpointercapture", (event) => {
  if (pointerRuneScroll?.pointerId === event.pointerId) clearRuneScrollGesture();
  if (pointerRunePowerHold?.pointerId === event.pointerId) clearRunePowerHold();
  if (pointerCardDrag?.pointerId === event.pointerId) clearCardDragPresentation();
});

app.addEventListener("wheel", (event) => {
  const track = event.target.closest?.("[data-rune-scroll-track]");
  if (!(track instanceof HTMLElement) || track.scrollWidth <= track.clientWidth + 1) return;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || !event.deltaY) return;
  track.scrollLeft += event.deltaY;
  event.preventDefault();
}, { passive: false });

app.addEventListener("dragstart", (event) => {
  try {
    if (replayMode || appView !== "game") return;
    const cardNode = event.target.closest?.("[data-card-drag][draggable='true']");
    const interactiveChild = event.target.closest?.("button, a, input, select, textarea");
    const session = cardDragDescriptor(cardNode);
    if (!cardNode || (interactiveChild && interactiveChild !== cardNode) || !session || !beginCardDragPresentation(session, cardNode)) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      // The payload is deliberately opaque. The approved in-memory card id and
      // the current legal action list are the authority at drop time.
      event.dataTransfer.setData("text/plain", `riftbound-card-${session.kind}`);
      event.dataTransfer.setDragImage(cardNode, Math.round(cardNode.offsetWidth / 2), Math.round(cardNode.offsetHeight / 2));
    }
  } catch (error) {
    clearCardDragPresentation();
    reportUiException(error, "card drag start");
  }
});

app.addEventListener("dragover", (event) => {
  if (!draggingCardSession) return;
  const target = updateCardDragDestination(event.target);
  if (!target) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});

app.addEventListener("drop", (event) => {
  if (!draggingCardSession) return;
  const session = { ...draggingCardSession };
  const target = legalDropDestinationNode(event.target, session);
  event.preventDefault();
  event.stopPropagation();
  const destination = String(target?.dataset.playDestination || "");
  clearCardDragPresentation();
  if (destination) {
    if (session.kind === "move") requestUnitMove(session.cardId, destination);
    else if (session.kind === "champion") requestChampionPlay(session.cardId, destination);
    else requestHandCardPlay(session.cardId, destination);
  }
  render();
});

app.addEventListener("dragend", () => clearCardDragPresentation());

app.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0 || replayMode || appView !== "game") return;
  const cardNode = event.target.closest?.("[data-card-drag]");
  const interactiveChild = event.target.closest?.("button, a, input, select, textarea");
  const session = cardDragDescriptor(cardNode);
  if (!cardNode || (interactiveChild && interactiveChild !== cardNode) || !session) return;
  pointerCardDrag = {
    pointerId: event.pointerId,
    ...session,
    sourceNode: cardNode,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    ghost: null,
    pendingX: event.clientX,
    pendingY: event.clientY
  };
  try {
    cardNode.setPointerCapture?.(event.pointerId);
  } catch {
    clearCardDragPresentation();
  }
});

app.addEventListener("pointermove", (event) => {
  const session = pointerCardDrag;
  if (!session || session.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
  if (!session.dragging && distance >= 10) {
    if (!beginCardDragPresentation(session, session.sourceNode)) {
      clearCardDragPresentation();
      return;
    }
    session.dragging = true;
    session.ghost = createPointerDragGhost(session.sourceNode);
    session.destinations = draggingCardSession?.destinations;
  }
  if (!session.dragging) return;
  event.preventDefault();
  session.pendingX = event.clientX;
  session.pendingY = event.clientY;
  if (pointerCardDragFrame) return;
  pointerCardDragFrame = requestAnimationFrame(() => {
    pointerCardDragFrame = 0;
    if (pointerCardDrag !== session || !session.dragging) return;
    positionPointerDragGhost(session.ghost, session.pendingX, session.pendingY);
    updateCardDragDestination(document.elementFromPoint(session.pendingX, session.pendingY));
  });
}, { passive: false });

app.addEventListener("pointerup", (event) => {
  const session = pointerCardDrag;
  if (!session || session.pointerId !== event.pointerId) return;
  if (!session.dragging) {
    clearCardDragPresentation();
    return;
  }
  event.preventDefault();
  const dropNode = legalDropDestinationNode(
    document.elementFromPoint(event.clientX, event.clientY),
    draggingCardSession || session
  );
  const destination = String(dropNode?.dataset.playDestination || "");
  suppressCardClickUntil = Date.now() + 650;
  clearCardDragPresentation();
  if (destination) {
    if (session.kind === "move") requestUnitMove(session.cardId, destination);
    else if (session.kind === "champion") requestChampionPlay(session.cardId, destination);
    else requestHandCardPlay(session.cardId, destination);
  }
  render();
});

app.addEventListener("pointercancel", (event) => {
  if (pointerCardDrag?.pointerId === event.pointerId) clearCardDragPresentation();
});

app.addEventListener("click", (event) => {
  try {
    recordDiagnosticUiBreadcrumb(event.target, "click");
    const diagnosticControl = event.target.closest?.("button[data-action]");
    const diagnosticAction = diagnosticControl?.dataset.action || "";
    if (["stop-after-ui-error", "return-menu-after-ui-error"].includes(diagnosticAction)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void stopGameAfterUiError(
        new Error(lastDiagnosticRenderIssue || "The game UI could not render the current state."),
        "game state validation"
      );
      return;
    }
    if (diagnosticAction.startsWith("bug-report-")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handleBugReportAction(diagnosticAction);
      return;
    }
    if (handlePendingChoiceClick(event)) return;
  } catch (error) {
    reportUiException(error, "pending choice click");
    showUiExceptionOverlay(error, "pending choice click");
  }
}, true);

function handlePendingChoiceClick(event) {
  if (replayMode || appView !== "game" || !game.pendingChoice) return false;
  const button = event.target.closest("button[data-action='choose-effect'], button[data-action='decline-effect'], button[data-action='assign-alpha-strike'], button[data-action='adjust-alpha-damage'], button[data-action='confirm-staged-choice'], button[data-action='toggle-choice-drawer'], button[data-action='stage-choice-option'], button[data-action='toggle-hand'], button[data-action='toggle-chain-zone'], button[data-action='toggle-inspector'], button[data-action='inspect-chain-effect'], button[data-action='view-chain-card'], button[data-action='focus-chain-target'], button[data-action='view-choice-card'], button[data-action='close-full-card'], [data-action='stage-choice-card']");
  const inlineCard = ["hand", "board"].includes(choiceCardSurface(game.pendingChoice))
    ? event.target.closest("[data-card-id]")
    : null;
  const control = button || inlineCard;
  if (!control || !app.contains(control)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const action = button?.dataset.action || "stage-choice-card";
  const choice = button?.dataset.choice;
  const localChoiceUiAction = [
    "stage-choice-card", "stage-choice-option", "toggle-choice-drawer", "toggle-hand", "toggle-chain-zone", "toggle-inspector",
    "inspect-chain-effect", "view-chain-card", "focus-chain-target", "adjust-alpha-damage",
    "view-choice-card", "close-full-card", "confirm-staged-choice"
  ].includes(action);
  if (!localChoiceUiAction && !tutorialAllowsUiAction(action, { ...(button?.dataset || control.dataset || {}) })) {
    return true;
  }
  if (action === "toggle-choice-drawer") {
    choiceDrawerCollapsed = !choiceDrawerCollapsed;
    render();
    return true;
  }
  if (action === "toggle-hand") {
    handOpen = !handOpen;
    render();
    return true;
  }
  if (action === "toggle-chain-zone") {
    chainZoneCollapsed = !chainZoneCollapsed;
    render();
    return true;
  }
  if (action === "toggle-inspector") {
    toggleTabletopSheet("inspector");
    render();
    return true;
  }
  if (action === "inspect-chain-effect") {
    toggleInspectedChainItem(button.dataset.chainItemId);
    render();
    return true;
  }
  if (action === "view-chain-card") {
    fullCardPreviewCard = chainPreviewCard(button.dataset.cardId);
    fullCardOpen = Boolean(fullCardPreviewCard);
    render();
    return true;
  }
  if (action === "focus-chain-target") {
    focusChainTarget(button.dataset.cardId);
    render();
    return true;
  }
  if (action === "stage-choice-option") {
    setStagedChoiceOption(choice);
    render();
    return true;
  }
  if (action === "stage-choice-card") {
    if (control.dataset.stageMode === "option") stageChoiceOption(choice);
    else stageChoiceCard(control.dataset.cardId);
    render();
    return true;
  }
  if (action === "confirm-staged-choice") {
    const selected = stagedChoiceOption();
    if (selected && tutorialAllowsUiAction("choose-effect", { choice: selected.id, card: choiceOptionCardId(selected) })) {
      stagedChoiceOptionId = null;
      dispatchGameCommand({ kind: "chooseEffectOption", optionId: selected.id }, () => chooseEffectOption(game, selected.id));
    }
    render();
    return true;
  }
  if (action === "adjust-alpha-damage") {
    const input = app.querySelector(`input[data-alpha-target="${button.dataset.target}"]`);
    if (input) {
      const allowed = String(input.dataset.allowedAmounts || "")
        .split(/\s+/)
        .map(Number)
        .filter((amount) => Number.isFinite(amount) && amount > 0)
        .sort((left, right) => left - right);
      const current = Number(input.value);
      const currentIndex = Math.max(0, allowed.findIndex((amount) => amount === current));
      const direction = Math.sign(Number(button.dataset.delta) || 0);
      const nextIndex = Math.max(0, Math.min(allowed.length - 1, currentIndex + direction));
      const next = allowed[nextIndex] || current || 1;
      input.value = String(next);
      const output = button.closest(".damage-stepper")?.querySelector("output");
      if (output) output.textContent = String(next);
    }
    return true;
  }
  if (action === "view-choice-card") {
    fullCardPreviewCard = findChoicePreviewCard(button.dataset.cardId);
    fullCardOpen = Boolean(fullCardPreviewCard);
    render();
    return true;
  }
  if (action === "close-full-card") {
    fullCardOpen = false;
    fullCardPreviewCard = null;
    render();
    return true;
  }
  if (action === "choose-effect") dispatchGameCommand({ kind: "chooseEffectOption", optionId: choice }, () => chooseEffectOption(game, choice));
  if (action === "assign-alpha-strike") {
    const input = app.querySelector(`input[data-alpha-target="${button.dataset.target}"]`);
    const requested = Math.max(1, Number(input?.value) || 1);
    const targetOptions = validChoiceOptions(game.pendingChoice)
      .filter((option) => choiceOptionCardId(option) === button.dataset.target && Number(option.amount) > 0 && !option.disabled);
    const legalOption = targetOptions.find((option) => Number(option.amount) === requested)
      || targetOptions.sort((left, right) => Math.abs(Number(left.amount) - requested) - Math.abs(Number(right.amount) - requested))[0];
    if (legalOption) dispatchGameCommand({ kind: "chooseEffectOption", optionId: legalOption.id }, () => chooseEffectOption(game, legalOption.id));
  }
  if (action === "decline-effect") dispatchGameCommand({ kind: "declineEffectChoice" }, () => declineEffectChoice(game));
  render();
  return true;
}

app.addEventListener("contextmenu", (event) => {
  try {
    if (replayMode || appView !== "game" || !game?.pendingPayment) return;
    const runeButton = event.target.closest?.("button[data-direct-payment-rune='true'][data-rune]");
    if (!runeButton || !app.contains(runeButton)) return;
    event.preventDefault();
    event.stopPropagation();
    clearRunePowerHold();
    if (Date.now() < suppressRunePowerContextMenuUntil) return;
    payDirectRuneAsPower(runeButton);
    render();
  } catch (error) {
    reportUiException(error, "direct Rune Power payment");
    showUiExceptionOverlay(error, "direct Rune Power payment");
  }
});

app.addEventListener("click", (event) => {
  try {
    if (Date.now() < suppressRuneClickUntil && event.target.closest?.("[data-rune-scroll-track]")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (Date.now() < suppressCardClickUntil && event.target.closest?.("[data-hand-card], .hand-drawer, [data-card-drag]")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (appView !== "game") {
      if (isTextEditingTarget(event.target) || event.target.closest?.(".deck-image-champion-toggle")) return;
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

    // Every legal pending-choice interaction is handled by the capturing
    // choice controller above. Suppress unrelated board commands while a
    // decision is open so a bottom drawer behaves as a true focused step.
    if (game.pendingChoice) {
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
    if (cardNode && button?.dataset.directPaymentRune !== "true") {
      const selectedCardId = String(cardNode.dataset.cardId || "");
      if (!tutorialAllowsUiAction("select-card", { card: selectedCardId })) {
        return;
      }
      toggleUiSelectedCard(selectedCardId);
    }

    if (targetZone) {
      const { zoneAction, card, unit, destination } = targetZone.dataset;
      if (!tutorialAllowsUiAction(zoneAction, { card, unit, destination })) {
        return;
      }
      if (zoneAction === "begin-play") {
        requestHandCardPlay(card, destination);
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
      if (cardNode) render();
      return;
    }

    const { action, card, unit, destination, player, battlefield, rune, energy, mode, choice, ability } = button.dataset;
    if (action === "return-menu") {
      appView = "menu";
      resetGameUiState();
      render();
      return;
    }
    if (action === "exit-completed-game") {
      exitCompletedGame();
      return;
    }
    if (action === "exit-pregame-sideboarding") {
      if (isOnlineGame()) void onlineLeaveRoom();
      else {
        appView = "menu";
        resetGameUiState();
        render();
      }
      return;
    }
    if (!tutorialAllowsUiAction(action, { ...button.dataset })) {
      return;
    }
    if (action === "sideboard-view-card") {
      sideboardPreviewNumber = sideboardPreviewNumber === button.dataset.cardNumber ? null : button.dataset.cardNumber;
    }
    if (action === "sideboard-close-card") sideboardPreviewNumber = null;
    if (action === "sideboard-move") {
      const match = activeBetweenGamesMatch();
      const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
      const draft = isOnlineGame() ? onlineSideboardDraft : sideboardDrafts[playerId === "p2" ? 1 : 0];
      if (["initial-sideboarding", "sideboarding"].includes(match?.phase)) {
        moveSideboardCard(draft, button.dataset.cardNumber, button.dataset.fromZone);
        sideboardValidationMessages = [];
      }
    }
    if (action === "sideboard-reset") {
      const playerId = isOnlineGame() ? online.playerId : sideboardPlayerId;
      const index = playerId === "p2" ? 1 : 0;
      if (isOnlineGame()) onlineSideboardDraft = structuredClone(onlineSideboardBaseline);
      else sideboardDrafts[index] = structuredClone(sideboardBaselines[index]);
      sideboardValidationMessages = [];
    }
    if (action === "sideboard-submit") submitSideboardDraft();
    if (action === "new-game") {
      if (game.phase === "complete" && !bugReportDecisionResolved()) {
        resultDismissed = false;
        bugReportUi.error = locale() === LOCALES.KO
          ? "새 게임 전에 이 경기의 로그 전송 여부를 선택해 주세요."
          : "Choose whether to send this game's log before starting a new game.";
        render();
        return;
      }
      if (game.phase === "complete") resultDismissed = true;
      pendingGameExit = "new-game";
    }
    if (action === "review-result") resultDismissed = true;
    if (action === "coach-report") {
      if (game.phase === "complete" && aiReplay) completeAiReplay();
      appView = "analysis";
    }
    if (action === "toggle-log") toggleTabletopSheet("log");
    if (action === "dismiss-feedback") clearRealtimeFeedback();
    if (action === "toggle-inspector") toggleTabletopSheet("inspector");
    if (action === "toggle-chain-zone") chainZoneCollapsed = !chainZoneCollapsed;
    if (action === "inspect-chain-effect") {
      toggleInspectedChainItem(button.dataset.chainItemId);
    }
    if (action === "focus-chain-target") focusChainTarget(button.dataset.cardId);
    if (action === "confirm-first-player") dispatchGameCommand({ kind: "confirmFirstPlayer" }, () => confirmFirstPlayer(game));
    if (action === "roll-first-player") dispatchGameCommand({ kind: "rollFirstPlayer" }, () => rollFirstPlayer(game, activePlayerId()));
    if (action === "choose-first-player") dispatchGameCommand({ kind: "chooseFirstPlayer", playerId: player }, () => chooseFirstPlayer(game, activePlayerId(), player));
    if (action === "toggle-hand") handOpen = !handOpen;
    if (action === "toggle-graveyard") toggleTabletopSheet("graveyard", player);
    if (action === "toggle-banished") toggleTabletopSheet("banished", player);
    if (action === "toggle-intel") toggleTabletopSheet("intel", player);
    if (action === "view-full-card") {
      fullCardPreviewCard = inspectedCard();
      fullCardOpen = Boolean(fullCardPreviewCard);
    }
    if (action === "view-choice-card") {
      fullCardPreviewCard = findChoicePreviewCard(button.dataset.cardId);
      fullCardOpen = Boolean(fullCardPreviewCard);
    }
    if (action === "view-chain-card") {
      fullCardPreviewCard = chainPreviewCard(button.dataset.cardId);
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
        if (game.phase !== "complete") {
          const continuation = !isOnlineGame() ? queueNewGameAfterReportDecision() : null;
          try {
            dispatchGameCommand(
              { kind: "surrender", source: "new-game-request" },
              () => surrender(game, viewerPlayerId())
            );
          } catch (error) {
            if (pendingPostReportAction === continuation) pendingPostReportAction = null;
            throw error;
          }
          if (continuation && game.phase !== "complete" && pendingPostReportAction === continuation) {
            pendingPostReportAction = null;
          }
          continuePendingPostReportActionIfReady();
        } else if (isOnlineGame()) {
          dispatchGameCommand({ kind: "restartGame" });
        } else {
          startFreshLocalGame();
        }
      }
      if (exitKind === "surrender") {
        if (isOnlineGame()) dispatchGameCommand({ kind: "surrender" });
        else dispatchGameCommand({ kind: "surrender" }, () => surrender(game, viewerPlayerId()));
      }
    }
    if (action === "confirm-online-result") {
      exitCompletedGame();
      return;
    }
    if (action === "pass-showdown") dispatchGameCommand({ kind: "passShowdown" }, () => passShowdown(game, activePlayerId()));
    if (action === "begin-play") {
      requestHandCardPlay(card, destination);
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
    if (action === "pay-rune" && (button.dataset.directPaymentRune !== "true" || button.dataset.paymentEnergy === "true")) {
      dispatchGameCommand({ kind: "togglePaymentRune", runeId: rune, mode }, () => togglePaymentRune(game, rune, mode));
    }
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
      toggleUiSelectedCard(card);
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
    const wasImage = deckEditor.transferDialog.mode === "image";
    closeDeckTransferDialog();
    render();
    if (wasImage) app.querySelector('[data-action="deck-image-open"]')?.focus();
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
  const powerRune = event.target.closest?.("button[data-direct-payment-rune='true'][data-rune][data-payment-power='true']");
  if (event.shiftKey && powerRune && app.contains(powerRune)) {
    event.preventDefault();
    event.stopPropagation();
    payDirectRuneAsPower(powerRune);
    render();
    return;
  }
  const nativeControl = event.target.closest?.("button, a[href], input, select, textarea, [contenteditable='true']");
  if (nativeControl) return;
  const cardNode = event.target.closest?.("[data-card-id][role='button']");
  if (!cardNode || !app.contains(cardNode)) return;
  event.preventDefault();
  if (game.pendingChoice && ["hand", "board"].includes(choiceCardSurface(game.pendingChoice))) {
    const interaction = tutorialChoiceInteraction(cardNode.dataset.cardId, tutorialUiState());
    if (isTutorialGame() && !interaction?.allowed) {
      return;
    }
    stageChoiceCard(cardNode.dataset.cardId);
  } else {
    if (!tutorialAllowsUiAction("select-card", { card: cardNode.dataset.cardId })) {
      return;
    }
    toggleUiSelectedCard(cardNode.dataset.cardId);
  }
  render();
});

document.addEventListener("keydown", (event) => {
  const modal = topUiModal();
  if (event.key === "Tab" && modal) {
    trapModalTab(event, modal);
    return;
  }
  if (event.key !== "Escape" || appView !== "game") return;
  const dismissed = dismissTopUiLayer();
  if (!dismissed && !modal) return;
  event.preventDefault();
  event.stopPropagation();
  if (dismissed) render();
}, true);

window.addEventListener("popstate", () => {
  if (suppressTabletopPopstate) {
    suppressTabletopPopstate = false;
    return;
  }
  if (!tabletopBackSentinelActive) return;
  tabletopBackSentinelActive = false;
  const dismissed = dismissTopUiLayer();
  if (dismissed) {
    render();
    return;
  }
  if (appView === "game" && (game?.phase === "complete" || matchIsBetweenGames())) {
    exitCompletedGame();
    return;
  }
  render();
});

app.addEventListener("input", (event) => {
  try {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.dataset.action === "bug-report-description") {
      bugReportUi.description = target.value;
      bugReportUi.error = "";
      const validation = validateGameReportDescription(target.value);
      const panel = target.closest(".game-bug-report");
      const count = panel?.querySelector("[data-bug-report-count]");
      const submit = panel?.querySelector("[data-action='bug-report-submit']");
      const visibleError = panel?.querySelector(".game-bug-report-error");
      if (count) count.textContent = `${validation.codePointLength}/10`;
      if (submit) submit.disabled = !validation.valid || bugReportUi.status === "submitting";
      visibleError?.remove();
      return;
    }
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
    if (action === "deck-list-search") {
      deckEditor.listSearch = target.value;
      refreshDeckLibraryResults();
      return;
    }
    if (action === "choice-search") {
      const panel = target.closest(".choice-panel");
      const normalized = target.value.trim().toLocaleLowerCase(locale() === LOCALES.KO ? "ko-KR" : "en-US");
      const options = [...(panel?.querySelectorAll(".choice-grid > .choice-option, .choice-grid > .choice-option-wrap") || [])];
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
    if (target instanceof HTMLInputElement && target.dataset.action === "deck-image-champion-first") {
      if (deckEditor.transferDialog?.mode !== "image") return;
      deckEditor.imageChampionFirst = target.checked;
      void openDeckImageDialog(deckEditor.transferDialog.deck);
      render();
      return;
    }
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.action === "deck-image-champion") {
      const dialog = deckEditor.transferDialog;
      if (dialog?.mode !== "image" || (target.value && !dialog.championCandidates.some((card) => card.cardNumber === target.value))) return;
      deckEditor.imageChampionSelections.set(dialog.deck.id, target.value);
      void openDeckImageDialog(dialog.deck);
      render();
      return;
    }
    if (target.dataset.action === "deck-image-sort") {
      if (deckEditor.transferDialog?.mode !== "image" || !DECK_IMAGE_SORT_OPTIONS.some((option) => option.id === target.value)) return;
      deckEditor.imageSort = target.value;
      void openDeckImageDialog(deckEditor.transferDialog.deck);
      render();
      return;
    }
    if (target.dataset.action === "online-pool" || target.dataset.action === "online-banlist") {
      if (target.dataset.action === "online-pool") settings.onlinePoolId = normalizeRoomDeckOptions({ poolId: target.value }).poolId;
      else settings.onlineBanlistEnabled = target.value === "on";
      saveSettings();
      render();
      return;
    }
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
  if (diagnosticNavigationBlocked() && [
    "menu-start", "menu-ai", "menu-multiplayer", "menu-tutorial", "tutorial-select",
    "online-create", "online-join-room", "online-join-code", "online-submit-deck", "online-ready"
  ].includes(action)) return;
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
    closeDeckTransferDialog();
    deckEditor.pendingDeleteDeckId = null;
  }
  if (action === "menu-decks") {
    appView = "decks";
    deckEditor.mobileView = "list";
    closeDeckTransferDialog();
    deckEditor.pendingDeleteDeckId = null;
  }
  if (action === "menu-multiplayer") {
    connectDefaultMultiplayer();
  }
  if (action === "diagnostic-recovery-abandon") abandonRestoredOnlineDiagnosticRecovery();
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
    closeDeckTransferDialog();
    deckEditor.pendingDeleteDeckId = null;
    deckEditor.selectedDeckId = deck;
    deckEditor.selectedCardNumber = deckHeroCard(getSelectedDeckRecord())?.cardNumber || null;
    deckEditor.mobileView = "edit";
    deckEditor.mobileTab = "deck";
    deckEditor.mobileToolsOpen = false;
  }
  if (action === "deck-new") {
    deckEditor.transferNotice = null;
    closeDeckTransferDialog();
    deckEditor.pendingDeleteDeckId = null;
    const record = createNewDeckRecord();
    deckStore.decks.push(record);
    deckEditor.selectedDeckId = record.id;
    deckEditor.selectedCardNumber = null;
    deckEditor.mobileView = "edit";
    deckEditor.mobileTab = "deck";
    deckEditor.mobileToolsOpen = false;
    deckEditor.listSearch = "";
    deckEditor.listFilter = "personal";
    saveDeckStore();
  }
  if (action === "deck-mobile-list") deckEditor.mobileView = "list";
  if (action === "deck-toggle-tools") deckEditor.mobileToolsOpen = !deckEditor.mobileToolsOpen;
  if (action === "deck-list-filter" && ["all", "personal", "default"].includes(button.dataset.filter)) {
    deckEditor.listFilter = button.dataset.filter;
    const list = app.querySelector(".deck-slot-grid");
    if (list) list.scrollTop = 0;
  }
  if (action === "deck-list-clear") deckEditor.listSearch = "";
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
  if (action === "deck-image-open") void openDeckImageDialog();
  if (action === "deck-image-retry") void openDeckImageDialog(deckEditor.transferDialog?.deck);
  if (action === "deck-image-download") downloadDeckImage();
  if (action === "deck-transfer-close") closeDeckTransferDialog();
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
    if (window.matchMedia?.("(max-width: 1199px)").matches) deckEditor.mobileTab = "detail";
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
  const replay = aiReplay;
  let reviewModel = null;
  aiDeepReviewRunning = true;
  render();
  try {
    if (!await ensureNeuralAiLoaded() || replay !== aiReplay) return;
    reviewModel = await ensureNeuralAiModelForDeepReview();
    if (!reviewModel || replay !== aiReplay) return;
    await refineAiReplay(replay, activeCoachModel(), {
      limit: 5,
      rollouts: 8,
      rolloutDepth: 32,
      neuralModel: reviewModel
    });
    await persistCurrentAiReplay(replay);
  } catch (error) {
    reportUiException(error, "deep AI review");
  } finally {
    disposeNeuralAiReviewModel(reviewModel);
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

diagnosticServerReady = configureDiagnosticServer();
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
        checkpointBaseUrl: result.checkpointBaseUrl,
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
  const descriptorKey = neuralAiDescriptorKey(generation);
  if (neuralAiCheckpointMetadata
    && neuralAiLoadedGeneration === generation.generation
    && neuralAiLoadedDescriptorKey === descriptorKey
    && aiTurnWorkerConfiguredNeuralKey === descriptorKey) return true;
  if (neuralAiLoadPromise) return neuralAiLoadPromise;
  clearNeuralAiModel();
  const loadGeneration = neuralAiLoadGeneration;
  const loadController = new AbortController();
  // The startup catalog can replace the bundled descriptor with the server
  // descriptor for the same generation while its checkpoint is loading. That
  // is not a user selection change and must not strand the AI-start flow in
  // the menu. A real generation change still invalidates this attempt.
  const loadIsStale = () => loadGeneration !== neuralAiLoadGeneration
    || loadController.signal.aborted
    || Number(selectedAiGenerationDescriptor()?.generation) !== Number(generation.generation);
  const abandonStaleLoad = () => {
    if (!loadIsStale()) return false;
    if (loadGeneration === neuralAiLoadGeneration) {
      neuralAiLoadState = "idle";
      neuralAiLoadError = "";
    }
    return true;
  };
  neuralAiLoadController = loadController;
  neuralAiLoadState = "loading";
  neuralAiLoadError = "";
  render();
  let loadPromise;
  loadPromise = (async () => {
    try {
      await nextPaint();
      const checkpointBuffer = await fetchNeuralAiCheckpointBuffer(generation, loadController.signal);
      if (abandonStaleLoad()) return false;
      const checkpointMetadata = await configureAiTurnWorkerNeural(
        checkpointBuffer,
        descriptorKey,
        generation.generation
      );
      if (abandonStaleLoad()) {
        disposeAiTurnWorker();
        return false;
      }
      if (!aiTurnWorker || aiTurnWorkerConfiguredNeuralKey !== descriptorKey) {
        throw new Error("AI turn neural Worker lost its configured model.");
      }
      // Keep only the small policy/coach profile on the UI thread. Ownership
      // of the full checkpoint buffer moves to the Worker without a JSON clone;
      // TensorFlow and its tensors are loaded here only for an actual review.
      neuralAiCheckpointMetadata = checkpointMetadata;
      neuralAiLoadedGeneration = generation.generation;
      neuralAiLoadedDescriptorKey = descriptorKey;
      neuralAiLoadState = "ready";
      return true;
    } catch (error) {
      if (abandonStaleLoad()) return false;
      clearNeuralAiModel({ invalidateLoad: false });
      neuralAiLoadState = "error";
      neuralAiLoadError = error instanceof Error ? error.message : String(error);
      reportUiException(error, "trained AI model load");
      return false;
    } finally {
      if (neuralAiLoadPromise === loadPromise) neuralAiLoadPromise = null;
      if (neuralAiLoadController === loadController) neuralAiLoadController = null;
      if (loadGeneration === neuralAiLoadGeneration) render();
    }
  })();
  neuralAiLoadPromise = loadPromise;
  return loadPromise;
}

async function ensureNeuralAiModelForDeepReview() {
  const generation = selectedAiGenerationDescriptor();
  const descriptorKey = neuralAiDescriptorKey(generation);
  if (!neuralAiCheckpointMetadata
    || neuralAiLoadedDescriptorKey !== descriptorKey
    || aiTurnWorkerConfiguredNeuralKey !== descriptorKey) {
    if (!await ensureNeuralAiLoaded()) return null;
    return ensureNeuralAiModelForDeepReview();
  }
  if (neuralAiModel && neuralAiModelDescriptorKey === descriptorKey) return neuralAiModel;
  if (neuralAiReviewLoadPromise && neuralAiReviewLoadDescriptorKey === descriptorKey) {
    return neuralAiReviewLoadPromise;
  }
  if (neuralAiReviewLoadPromise) {
    await neuralAiReviewLoadPromise.catch(() => null);
    return ensureNeuralAiModelForDeepReview();
  }

  disposeNeuralAiReviewModel();
  const loadGeneration = neuralAiLoadGeneration;
  const loadController = new AbortController();
  const loadIsStale = () => loadGeneration !== neuralAiLoadGeneration
    || loadController.signal.aborted
    || neuralAiDescriptorKey(selectedAiGenerationDescriptor()) !== descriptorKey
    || neuralAiLoadedDescriptorKey !== descriptorKey
    || !neuralAiCheckpointMetadata;
  neuralAiReviewLoadController = loadController;
  neuralAiReviewLoadDescriptorKey = descriptorKey;
  let loadPromise;
  loadPromise = (async () => {
    let loadedModel = null;
    let disposeLoadedModel = null;
    try {
      await nextPaint();
      const checkpoint = await fetchNeuralAiCheckpoint(generation, loadController.signal);
      if (loadIsStale()) return null;
      const {
        deserializeNeuralModel,
        disposeNeuralModel
      } = await import("./ai/neural/model.mjs");
      disposeLoadedModel = disposeNeuralModel;
      // The stale guard deliberately precedes deserialization so an obsolete
      // generation never allocates a second set of TensorFlow resources.
      if (loadIsStale()) return null;
      loadedModel = deserializeNeuralModel(checkpoint);
      if (loadIsStale()) {
        disposeLoadedModel(loadedModel);
        loadedModel = null;
        return null;
      }
      neuralAiModel = loadedModel;
      loadedModel = null;
      neuralAiModelDescriptorKey = descriptorKey;
      neuralAiModelDisposer = disposeNeuralModel;
      return neuralAiModel;
    } catch (error) {
      if (loadedModel && disposeLoadedModel) disposeLoadedModel(loadedModel);
      if (loadIsStale() || error?.name === "AbortError") return null;
      throw error;
    } finally {
      if (neuralAiReviewLoadPromise === loadPromise) {
        neuralAiReviewLoadPromise = null;
        neuralAiReviewLoadDescriptorKey = "";
      }
      if (neuralAiReviewLoadController === loadController) neuralAiReviewLoadController = null;
    }
  })();
  neuralAiReviewLoadPromise = loadPromise;
  return loadPromise;
}

async function fetchNeuralAiCheckpoint(generation, signal) {
  const checkpoint = generation.source === "server"
    ? await fetchAiGenerationCheckpoint(generation.generation, { signal, baseUrl: generation.checkpointBaseUrl })
    : await fetch(new URL(generation.checkpoint, import.meta.url), {
      cache: "no-cache",
      signal
    }).then(async (response) => {
      if (!response.ok) throw new Error(`모델 파일을 읽을 수 없습니다 (HTTP ${response.status}).`);
      return response.json();
    });
  if (Number(checkpoint.generation) !== generation.generation) {
    throw new Error(`선택한 ${generation.generation}세대와 모델 파일의 ${checkpoint.generation}세대가 일치하지 않습니다.`);
  }
  return checkpoint;
}

async function fetchNeuralAiCheckpointBuffer(generation, signal) {
  if (generation.source === "server") {
    return fetchAiGenerationCheckpointBuffer(generation.generation, { signal, baseUrl: generation.checkpointBaseUrl });
  }
  const response = await fetch(new URL(generation.checkpoint, import.meta.url), {
    cache: "no-cache",
    signal
  });
  if (!response.ok) throw new Error(`모델 파일을 읽을 수 없습니다 (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

function lightweightNeuralAiCheckpointMetadata(checkpoint) {
  return {
    generation: Number(checkpoint?.generation) || 0,
    gamesTrained: Number(checkpoint?.gamesTrained) || 0,
    metadata: structuredClone(checkpoint?.metadata || {}),
    knowledge: structuredClone(checkpoint?.knowledge || {})
  };
}

function disposeNeuralAiReviewModel(model = neuralAiModel) {
  const ownsCurrentModel = Boolean(model && model === neuralAiModel);
  const disposeModel = ownsCurrentModel ? neuralAiModelDisposer : null;
  if (ownsCurrentModel) {
    neuralAiModel = null;
    neuralAiModelDescriptorKey = null;
    neuralAiModelDisposer = null;
  }
  if (model && disposeModel) {
    try { disposeModel(model); } catch {}
  }
}

function clearNeuralAiModel({ invalidateLoad = true } = {}) {
  if (invalidateLoad) {
    neuralAiLoadGeneration += 1;
    neuralAiLoadPromise = null;
    neuralAiLoadController?.abort();
    neuralAiLoadController = null;
    neuralAiReviewLoadPromise = null;
    neuralAiReviewLoadController?.abort();
    neuralAiReviewLoadController = null;
    neuralAiReviewLoadDescriptorKey = "";
  }
  disposeNeuralAiReviewModel();
  neuralAiCheckpointMetadata = null;
  neuralAiLoadedGeneration = null;
  neuralAiLoadedDescriptorKey = null;
  disposeAiTurnWorker();
  aiTurnWorkerUnavailable = false;
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
  if (neuralAiLoadState === "error") return korean ? `${generation}세대 모델을 불러오지 못해 AI 대전을 시작할 수 없습니다: ${localizedDynamicText(neuralAiLoadError) || "모델 파일을 불러오지 못했습니다."}` : `Generation ${generation} could not be loaded, so the AI match cannot start: ${neuralAiLoadError}`;
  if (neuralAiLoadState === "idle") return korean ? `선택한 ${generation}세대 모델은 AI 대전을 시작할 때 로드됩니다.` : `The selected generation ${generation} model loads when an AI match starts.`;
  return korean
    ? `AI 세대 ${activeAiGeneration()} · 자가대전 ${activeAiGames()}경기 학습 · 순환형 학습 모델 준비됨`
    : `AI generation ${activeAiGeneration()} · ${activeAiGames()} self-play games · recurrent PPO ready`;
}

function activeCoachModel() {
  return neuralAiCheckpointMetadata
    ? {
      ...aiModel,
      ...(neuralAiCheckpointMetadata.knowledge || {}),
      generation: neuralAiCheckpointMetadata.generation,
      gamesTrained: neuralAiCheckpointMetadata.gamesTrained
    }
    : aiModel;
}

function activeAiGeneration() {
  return neuralAiCheckpointMetadata?.generation ?? aiModel.generation ?? 0;
}

function activeAiGames() {
  return neuralAiCheckpointMetadata?.gamesTrained ?? aiModel.gamesTrained ?? 0;
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
      image: cardArtUrl(card) || null,
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
window.__riftboundUiErrorHandlerReady = true;
window.addEventListener("pagehide", () => {
  markResumableOnlineReload();
  flushGameDiagnosticPersistence();
  cancelReplayAnalyses();
  clearCardDragPresentation();
  clearRuneScrollGesture();
  clearRunePowerHold();
});
window.addEventListener("pointerup", (event) => {
  if (pointerCardDrag?.pointerId === event.pointerId) clearCardDragPresentation();
  if (pointerRuneScroll?.pointerId === event.pointerId) clearRuneScrollGesture();
  if (pointerRunePowerHold?.pointerId === event.pointerId) clearRunePowerHold();
});
window.addEventListener("pointercancel", (event) => {
  if (pointerCardDrag?.pointerId === event.pointerId) clearCardDragPresentation();
  if (pointerRuneScroll?.pointerId === event.pointerId) clearRuneScrollGesture();
  if (pointerRunePowerHold?.pointerId === event.pointerId) clearRunePowerHold();
});
window.addEventListener("blur", () => {
  clearCardDragPresentation();
  clearRuneScrollGesture();
  clearRunePowerHold();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  flushGameDiagnosticPersistence();
  clearCardDragPresentation();
  clearRuneScrollGesture();
  clearRunePowerHold();
});

window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", (event) => {
  if (!event.matches) return;
  clearEffectAnimations();
  clearRealtimeFeedback();
  if (impactDismissTimer) clearTimeout(impactDismissTimer);
  impactDismissTimer = null;
  if (["victory", "defeat"].includes(activeImpact?.kind)) resultRevealReady = true;
  activeImpact = null;
  if (appView === "game") render();
});

render();
