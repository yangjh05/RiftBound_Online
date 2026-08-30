const BOARD_ZONES = new Set(["base", "battlefield", "attachment"]);

export const TABLETOP_TRANSFER_DURATION_MS = 280;
export const TABLETOP_DRAW_STAGGER_MS = 82;
export const TABLETOP_TRANSFER_EASING = "cubic-bezier(.22,.9,.2,1)";
export const TABLETOP_STATE_MOTION_DURATION_MS = 220;
export const TABLETOP_STATE_MOTION_EASING = "cubic-bezier(.2,.8,.2,1)";

const TABLETOP_STATE_MOTION_WAIT_MS = 2400;
const STATE_MOTION_KINDS = new Set(["exhaust", "ready"]);
const pendingStateMotions = new Map();
const activeStateMotionRuns = new Set();
let stateMotionSequence = 0;
let stateMotionFlushScheduled = false;

function locationMap(value) {
  if (value instanceof Map) return value;
  if (!value || typeof value !== "object") return new Map();
  return new Map(Object.entries(value));
}

function isBoardZone(zone) {
  return BOARD_ZONES.has(String(zone || ""));
}

function changedLocation(from, to) {
  return from?.zone !== to?.zone
    || String(from?.playerId || "") !== String(to?.playerId || "")
    || String(from?.locationId || "") !== String(to?.locationId || "");
}

function stateMotionKind(from, to) {
  if (!from || !to || changedLocation(from, to)) return "";
  const wasExhausted = Boolean(from.exhausted);
  const isExhausted = Boolean(to.exhausted);
  if (wasExhausted === isExhausted) return "";
  return isExhausted ? "exhaust" : "ready";
}

export function classifyTabletopTransfer(from, to) {
  if (!from || !to) return "";
  const stateKind = stateMotionKind(from, to);
  if (stateKind) return stateKind;
  if (!changedLocation(from, to)) return "";
  const source = String(from.zone || "");
  const destination = String(to.zone || "");

  if (source === "mainDeck" && destination === "hand") return "draw";
  if (source === "mainDeck" && destination === "trash") return "burn";
  if (source === "trash" && destination === "banished") return "flow";
  if (source === "trash" && destination === "mainDeck") return "recycle";
  if (source === "runes" && destination === "runeDeck") return "recycle";
  if (source === "runeDeck" && destination === "runes") return "rune";
  if (isBoardZone(source) && isBoardZone(destination)) return "move";
  if (["hand", "champion", "chain", "trash"].includes(source) && (isBoardZone(destination) || destination === "hidden")) {
    return source === "trash" ? "recover" : "play";
  }
  if (["hand", "champion", "hidden"].includes(source) && destination === "chain") return source === "hidden" ? "reveal" : "play";
  if (source === "chain" && destination === "trash") return "resolve";
  if (isBoardZone(source) && destination === "trash") return "defeat";
  if (destination === "trash") return "discard";
  if (destination === "banished") return "banish";
  if (source === "hidden") return "reveal";
  return "transfer";
}

export function buildTabletopTransfers(previousLocations, currentLocations) {
  const previous = locationMap(previousLocations);
  const current = locationMap(currentLocations);
  const ids = new Set([...previous.keys(), ...current.keys()]);
  const transfers = [];

  for (const id of ids) {
    const from = previous.get(id);
    const to = current.get(id);
    const kind = classifyTabletopTransfer(from, to);
    if (!kind) continue;
    transfers.push({
      id: String(id || ""),
      kind,
      from: { ...from },
      to: { ...to },
      faceVisible: Boolean(to?.faceVisible),
      image: to?.image || from?.image || "",
      name: to?.name || from?.name || "",
      order: Number.isFinite(Number(to?.index)) ? Number(to.index) : Number(from?.index) || 0
    });
  }

  const ordered = transfers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  queueTabletopStateMotions(ordered);
  return ordered;
}

function stateMotionTransform(exhausted, zone = "") {
  const exhaustedScale = zone === "attachment" ? 0.68 : 0.76;
  return exhausted ? `rotate(90deg) scale(${exhaustedScale})` : "rotate(0deg) scale(1)";
}

export function tabletopStateMotionKeyframes(transfer) {
  if (!STATE_MOTION_KINDS.has(transfer?.kind)) return [];
  const zone = String(transfer?.to?.zone || transfer?.from?.zone || "");
  return [
    { transform: stateMotionTransform(Boolean(transfer?.from?.exhausted), zone) },
    { transform: stateMotionTransform(Boolean(transfer?.to?.exhausted), zone) }
  ];
}

function stateMotionLayerSelector(transfer) {
  const zone = String(transfer?.to?.zone || transfer?.from?.zone || "");
  if (zone === "runes") return ".rune-orientation-layer";
  if (zone === "attachment") return ".attachment-orientation-layer";
  return ".card-exhaust-layer";
}

function stateMotionCardNodes(root, cardId) {
  if (!root?.querySelectorAll || !cardId) return [];
  return [...root.querySelectorAll("[data-card-id]")]
    .filter((node) => String(node?.dataset?.cardId || "") === String(cardId));
}

function setStateMotionMarker(node, kind, marker) {
  if (!node?.dataset) return;
  node.dataset.tabletopStateMotion = kind;
  node.dataset.tabletopStateMotionMarker = marker;
  node.classList?.add?.("tabletop-state-motion", `state-motion-${kind}`);
}

function clearStateMotionMarker(node, kind, marker) {
  if (!node?.dataset || node.dataset.tabletopStateMotionMarker !== marker) return;
  delete node.dataset.tabletopStateMotion;
  delete node.dataset.tabletopStateMotionMarker;
  node.classList?.remove?.("tabletop-state-motion", `state-motion-${kind}`);
}

function defaultReducedMotion() {
  if (typeof globalThis.matchMedia !== "function") return false;
  return Boolean(globalThis.matchMedia("(prefers-reduced-motion: reduce)")?.matches);
}

function defaultMotionRoot() {
  return typeof document === "undefined" ? null : document;
}

function attachAnimationSettlement(animation, settle) {
  if (typeof animation?.addEventListener === "function") {
    animation.addEventListener("finish", () => settle("finish"), { once: true });
    animation.addEventListener("cancel", () => settle("cancel"), { once: true });
    return;
  }
  if (animation && "onfinish" in animation) animation.onfinish = () => settle("finish");
  if (animation && "oncancel" in animation) animation.oncancel = () => settle("cancel");
}

export function runTabletopStateMotionAnimations(transfers, {
  root = defaultMotionRoot(),
  reducedMotion = defaultReducedMotion(),
  duration = TABLETOP_STATE_MOTION_DURATION_MS,
  easing = TABLETOP_STATE_MOTION_EASING,
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
  onSettled = null
} = {}) {
  if (!root?.querySelectorAll || !Array.isArray(transfers)) return [];
  const runs = [];

  for (const transfer of transfers) {
    if (!STATE_MOTION_KINDS.has(transfer?.kind) || !transfer.id) continue;
    const marker = String(transfer.stateMotionMarker || `${transfer.kind}:${transfer.id}`);
    const keyframes = tabletopStateMotionKeyframes(transfer);
    const selector = stateMotionLayerSelector(transfer);

    for (const cardNode of stateMotionCardNodes(root, transfer.id)) {
      const layers = typeof cardNode.querySelectorAll === "function"
        ? [...cardNode.querySelectorAll(selector)]
        : [];
      for (const layer of layers) {
        if (layer?.dataset?.tabletopStateMotionMarker === marker) continue;
        setStateMotionMarker(cardNode, transfer.kind, marker);
        setStateMotionMarker(layer, transfer.kind, marker);

        let settled = false;
        let fallbackTimer = null;
        let run = null;
        const cleanup = (reason = "cleanup") => {
          if (settled) return;
          settled = true;
          if (fallbackTimer != null && typeof clearTimeoutFn === "function") clearTimeoutFn(fallbackTimer);
          if (run) activeStateMotionRuns.delete(run);
          clearStateMotionMarker(layer, transfer.kind, marker);
          clearStateMotionMarker(cardNode, transfer.kind, marker);
          onSettled?.({ transfer, cardNode, layer, reason });
        };

        if (reducedMotion || typeof layer?.animate !== "function") {
          cleanup(reducedMotion ? "reduced" : "unsupported");
          continue;
        }

        let animation = null;
        try {
          animation = layer.animate(keyframes, {
            duration: Math.max(1, Number(duration) || TABLETOP_STATE_MOTION_DURATION_MS),
            easing,
            fill: "none"
          });
        } catch {
          cleanup("unsupported");
          continue;
        }
        attachAnimationSettlement(animation, cleanup);
        if (typeof setTimeoutFn === "function") {
          fallbackTimer = setTimeoutFn(
            () => cleanup("timeout"),
            Math.max(1, Number(duration) || TABLETOP_STATE_MOTION_DURATION_MS) + 180
          );
        }
        run = { transfer, cardNode, layer, animation, cleanup };
        activeStateMotionRuns.add(run);
        runs.push(run);
      }
    }
  }
  return runs;
}

function cleanupPendingStateMotion(entry) {
  if (!entry) return;
  if (entry.expiryTimer != null && typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(entry.expiryTimer);
  }
  for (const run of entry.runs || []) {
    try {
      run.animation?.cancel?.();
    } catch {
      // The explicit cleanup below is the fail-safe for partial Web Animations implementations.
    }
    run.cleanup?.("cancel");
  }
  entry.runs = [];
}

function finishPendingStateMotion(entry) {
  if (!entry || pendingStateMotions.get(entry.transfer.id) !== entry) return;
  pendingStateMotions.delete(entry.transfer.id);
  cleanupPendingStateMotion(entry);
}

function flushPendingStateMotions() {
  stateMotionFlushScheduled = false;
  const root = defaultMotionRoot();
  if (!root?.querySelectorAll) return;

  for (const entry of pendingStateMotions.values()) {
    const transfer = { ...entry.transfer, stateMotionMarker: entry.marker };
    const runs = runTabletopStateMotionAnimations([transfer], {
      root,
      onSettled: ({ cardNode, layer, reason }) => {
        const completedOnCurrentDom = reason === "finish" || reason === "timeout"
          ? Boolean(cardNode?.isConnected !== false && layer?.isConnected !== false)
          : reason === "reduced" || reason === "unsupported";
        if (completedOnCurrentDom) finishPendingStateMotion(entry);
      }
    });
    if (runs.length) entry.runs.push(...runs);
  }
}

function schedulePendingStateMotionFlush() {
  if (stateMotionFlushScheduled || !pendingStateMotions.size || !defaultMotionRoot()) return;
  stateMotionFlushScheduled = true;
  const flush = () => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(flushPendingStateMotions);
    } else if (typeof globalThis.setTimeout === "function") {
      globalThis.setTimeout(flushPendingStateMotions, 0);
    } else {
      flushPendingStateMotions();
    }
  };
  if (typeof globalThis.queueMicrotask === "function") globalThis.queueMicrotask(flush);
  else flush();
}

function queueTabletopStateMotions(transfers) {
  if (!defaultMotionRoot()) return;
  for (const transfer of transfers) {
    if (!STATE_MOTION_KINDS.has(transfer?.kind) || !transfer.id) continue;
    const previous = pendingStateMotions.get(transfer.id);
    if (previous) cleanupPendingStateMotion(previous);
    const entry = {
      transfer: { ...transfer },
      marker: `${transfer.kind}:${transfer.id}:${++stateMotionSequence}`,
      runs: [],
      expiryTimer: null
    };
    if (typeof globalThis.setTimeout === "function") {
      entry.expiryTimer = globalThis.setTimeout(() => finishPendingStateMotion(entry), TABLETOP_STATE_MOTION_WAIT_MS);
    }
    pendingStateMotions.set(transfer.id, entry);
  }
  schedulePendingStateMotionFlush();
}

export function clearTabletopStateMotions(root = defaultMotionRoot()) {
  const pending = [...pendingStateMotions.values()];
  pendingStateMotions.clear();
  stateMotionFlushScheduled = false;
  for (const entry of pending) cleanupPendingStateMotion(entry);
  for (const run of [...activeStateMotionRuns]) {
    try {
      run.animation?.cancel?.();
    } catch {
      // Explicit cleanup below also covers partial Web Animations implementations.
    }
    run.cleanup?.("cancel");
  }
  activeStateMotionRuns.clear();

  if (!root?.querySelectorAll) return;
  const marked = root.querySelectorAll(
    ".tabletop-state-motion, [data-tabletop-state-motion], [data-tabletop-state-motion-marker]"
  );
  for (const node of marked) {
    if (node?.dataset) {
      delete node.dataset.tabletopStateMotion;
      delete node.dataset.tabletopStateMotionMarker;
    }
    node?.classList?.remove?.("tabletop-state-motion", "state-motion-exhaust", "state-motion-ready");
  }
}

function playerSnapshotMap(value) {
  if (value instanceof Map) return value;
  if (!value || typeof value !== "object") return new Map();
  return new Map(Object.entries(value));
}

function playerHandCount(snapshot) {
  const handIds = snapshot?.handIds;
  if (handIds instanceof Set || Array.isArray(handIds)) return handIds.size ?? handIds.length;
  const count = Number(snapshot?.handCount);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function transferPlayerId(transfer) {
  return String(transfer?.to?.playerId || transfer?.from?.playerId || "");
}

function faceDownHandAliasEntries(previousLocations, currentLocations, playerId) {
  const previous = locationMap(previousLocations);
  const current = locationMap(currentLocations);
  return [...current.entries()]
    .filter(([id, location]) => !previous.has(id)
      && String(id).startsWith(`redacted-hand-${playerId}-`)
      && location?.zone === "hand"
      && String(location?.playerId || "") === playerId
      && location.faceVisible === false)
    .map(([id, location]) => ({ id: String(id), location }))
    .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0)
      || left.id.localeCompare(right.id));
}

export function buildBurnOutDrawTransfers(
  existingTransfers,
  previousPlayers,
  currentPlayers,
  previousLocations,
  currentLocations
) {
  const previous = playerSnapshotMap(previousPlayers);
  const current = playerSnapshotMap(currentPlayers);
  const burnOutPlayerIds = new Set();
  for (const [playerId, snapshot] of current) {
    const previousBurnOuts = Number(previous.get(playerId)?.burnOuts) || 0;
    const currentBurnOuts = Number(snapshot?.burnOuts) || 0;
    if (currentBurnOuts > previousBurnOuts) burnOutPlayerIds.add(String(playerId));
  }

  const reconciled = (Array.isArray(existingTransfers) ? existingTransfers : []).map((transfer) => {
    const playerId = transferPlayerId(transfer);
    if (!burnOutPlayerIds.has(playerId)
      || transfer?.from?.zone !== "trash"
      || transfer?.to?.zone !== "hand") return transfer;
    return {
      ...transfer,
      kind: "draw",
      from: {
        ...transfer.from,
        playerId,
        zone: "mainDeck",
        locationId: ""
      },
      burnOut: true
    };
  });

  for (const playerId of burnOutPlayerIds) {
    const converted = reconciled.some((transfer) => transfer?.burnOut
      && transfer.kind === "draw"
      && transferPlayerId(transfer) === playerId);
    if (converted) continue;

    const previousPlayer = previous.get(playerId);
    const currentPlayer = current.get(playerId);
    const handIncrease = playerHandCount(currentPlayer) - playerHandCount(previousPlayer);
    if (handIncrease <= 0) continue;
    const aliases = faceDownHandAliasEntries(previousLocations, currentLocations, playerId);
    if (aliases.length !== handIncrease) continue;
    const claimedDestinationIds = new Set(reconciled
      .map((transfer) => String(transfer?.toCardId || transfer?.id || ""))
      .filter(Boolean));
    if (aliases.some((alias) => claimedDestinationIds.has(alias.id))) continue;

    for (const alias of aliases) {
      reconciled.push({
        id: alias.id,
        toCardId: alias.id,
        kind: "draw",
        from: {
          playerId,
          zone: "mainDeck",
          locationId: "",
          index: Number(alias.location?.index || 0),
          faceVisible: false,
          exhausted: false
        },
        to: { ...alias.location, faceVisible: false },
        faceVisible: false,
        image: "",
        name: "",
        order: Number(alias.location?.index || 0),
        burnOut: true,
        synthetic: true
      });
    }
  }

  return reconciled.sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0)
    || String(left?.id || "").localeCompare(String(right?.id || "")));
}

export function buildPrivateHandChainTransfers(
  previousLocations,
  currentLocations,
  previousChainItems = [],
  currentChainItems = [],
  viewerPlayerId = "",
  existingTransfers = []
) {
  const previous = locationMap(previousLocations);
  const current = locationMap(currentLocations);
  const previousItemIds = new Set((Array.isArray(previousChainItems) ? previousChainItems : []).map((item) => item?.id).filter(Boolean));
  const claimedDestinationIds = new Set((Array.isArray(existingTransfers) ? existingTransfers : []).map((transfer) => transfer?.toCardId || transfer?.id).filter(Boolean));
  const candidatesByPlayer = new Map();

  for (const item of (Array.isArray(currentChainItems) ? currentChainItems : [])) {
    const cardId = String(item?.cardId || "");
    const playerId = String(item?.playerId || "");
    const destination = current.get(cardId);
    if (!cardId || !playerId || playerId === String(viewerPlayerId || "")
      || previousItemIds.has(item?.id)
      || (item?.type || "card") !== "card"
      || item?.sourceZone !== "hand"
      || destination?.zone !== "chain"
      || claimedDestinationIds.has(cardId)) continue;
    const candidates = candidatesByPlayer.get(playerId) || [];
    candidates.push({ ...item, cardId, playerId, destination });
    candidatesByPlayer.set(playerId, candidates);
  }

  const transfers = [];
  for (const [playerId, candidates] of candidatesByPlayer) {
    const prefix = `redacted-pending-hand-${playerId}-`;
    const placeholders = [...previous.entries()]
      .filter(([id, location]) => String(id).startsWith(prefix)
        && location?.zone === "hand"
        && String(location?.playerId || "") === playerId
        && !current.has(id))
      .map(([id, location]) => ({ id: String(id), location }))
      .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0) || left.id.localeCompare(right.id));
    candidates.sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || left.cardId.localeCompare(right.cardId));
    if (!placeholders.length || placeholders.length !== candidates.length) continue;
    for (let index = 0; index < candidates.length; index += 1) {
      const placeholder = placeholders[index];
      const candidate = candidates[index];
      transfers.push({
        id: candidate.cardId,
        fromCardId: placeholder.id,
        toCardId: candidate.cardId,
        kind: "play",
        from: { ...placeholder.location, faceVisible: false },
        to: { ...candidate.destination },
        faceVisible: false,
        image: "",
        name: "",
        order: Number(candidate.order || 0)
      });
      claimedDestinationIds.add(candidate.cardId);
    }
  }
  return transfers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function buildPrivateHandBoardTransfers(
  previousLocations,
  currentLocations,
  viewerPlayerId = "",
  existingTransfers = []
) {
  const previous = locationMap(previousLocations);
  const current = locationMap(currentLocations);
  const claimedDestinationIds = new Set((Array.isArray(existingTransfers) ? existingTransfers : [])
    .map((transfer) => transfer?.toCardId || transfer?.id)
    .filter(Boolean));
  const playerIds = new Set([...previous.values(), ...current.values()]
    .map((location) => String(location?.playerId || ""))
    .filter(Boolean));
  const transfers = [];

  for (const playerId of playerIds) {
    if (playerId === String(viewerPlayerId || "")) continue;
    const prefix = `redacted-pending-hand-${playerId}-`;
    const placeholders = [...previous.entries()]
      .filter(([id, location]) => String(id).startsWith(prefix)
        && location?.zone === "hand"
        && String(location?.playerId || "") === playerId
        && location.faceVisible === false
        && !current.has(id))
      .map(([id, location]) => ({ id: String(id), location }))
      .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0)
        || left.id.localeCompare(right.id));
    if (!placeholders.length) continue;

    const destinations = [...current.entries()]
      .filter(([id, location]) => !previous.has(id)
        && !claimedDestinationIds.has(id)
        && isBoardZone(location?.zone)
        && ["unit", "gear"].includes(String(location?.cardType || ""))
        && location.faceVisible === true
        && String(location?.playerId || "") === playerId)
      .map(([id, location]) => ({ id: String(id), location }))
      .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0)
        || left.id.localeCompare(right.id));
    if (destinations.length !== placeholders.length) continue;

    for (let index = 0; index < destinations.length; index += 1) {
      const source = placeholders[index];
      const destination = destinations[index];
      transfers.push({
        id: destination.id,
        fromCardId: source.id,
        toCardId: destination.id,
        kind: "play",
        from: { ...source.location, faceVisible: false },
        to: { ...destination.location },
        faceVisible: false,
        image: "",
        name: "",
        order: Number(destination.location?.index || 0),
        synthetic: true
      });
      claimedDestinationIds.add(destination.id);
    }
  }

  return transfers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function buildPrivateHiddenChainTransfers(
  previousLocations,
  currentLocations,
  previousChainItems = [],
  currentChainItems = [],
  viewerPlayerId = "",
  existingTransfers = []
) {
  const previous = locationMap(previousLocations);
  const current = locationMap(currentLocations);
  const previousItemIds = new Set((Array.isArray(previousChainItems) ? previousChainItems : []).map((item) => item?.id).filter(Boolean));
  const claimedDestinationIds = new Set((Array.isArray(existingTransfers) ? existingTransfers : []).map((transfer) => transfer?.toCardId || transfer?.id).filter(Boolean));
  const candidatesByOrigin = new Map();

  for (const item of (Array.isArray(currentChainItems) ? currentChainItems : [])) {
    const cardId = String(item?.cardId || "");
    const sourceZone = String(item?.sourceZone || "");
    const sourcePlayerId = String(item?.sourcePlayerId || item?.playerId || "");
    const destination = current.get(cardId);
    if (!cardId || !sourcePlayerId || sourcePlayerId === String(viewerPlayerId || "")
      || previousItemIds.has(item?.id)
      || (item?.type || "card") !== "card"
      || !["hand", "mainDeck"].includes(sourceZone)
      || destination?.zone !== "chain"
      || claimedDestinationIds.has(cardId)) continue;
    const key = `${sourcePlayerId}:${sourceZone}`;
    const candidates = candidatesByOrigin.get(key) || [];
    candidates.push({ ...item, cardId, sourcePlayerId, sourceZone, destination });
    candidatesByOrigin.set(key, candidates);
  }

  const transfers = [];
  for (const candidates of candidatesByOrigin.values()) {
    const { sourcePlayerId, sourceZone } = candidates[0];
    const aliasZone = sourceZone;
    const prefix = sourceZone === "hand"
      ? `redacted-hand-${sourcePlayerId}-`
      : `redacted-main-${sourcePlayerId}-`;
    const aliases = [...previous.entries()]
      .filter(([id, location]) => String(id).startsWith(prefix)
        && location?.zone === aliasZone
        && String(location?.playerId || "") === sourcePlayerId
        && !current.has(id))
      .map(([id, location]) => ({ id: String(id), location }))
      .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0) || left.id.localeCompare(right.id));
    candidates.sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || left.cardId.localeCompare(right.cardId));
    if (!aliases.length || aliases.length !== candidates.length) continue;
    for (let index = 0; index < candidates.length; index += 1) {
      const source = aliases[index];
      const destination = candidates[index];
      transfers.push({
        id: destination.cardId,
        fromCardId: source.id,
        toCardId: destination.cardId,
        kind: "play",
        from: { ...source.location, faceVisible: false },
        to: { ...destination.destination },
        faceVisible: false,
        image: "",
        name: "",
        order: Number(destination.order || 0)
      });
      claimedDestinationIds.add(destination.cardId);
    }
  }
  return transfers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function buildPrivateDeckTransfers(
  previousLocations,
  currentLocations,
  viewerPlayerId = "",
  existingTransfers = []
) {
  const previous = locationMap(previousLocations);
  const current = locationMap(currentLocations);
  const claimedDestinationIds = new Set((Array.isArray(existingTransfers) ? existingTransfers : []).map((transfer) => transfer?.toCardId || transfer?.id).filter(Boolean));
  const playerIds = new Set([...previous.values(), ...current.values()].map((location) => String(location?.playerId || "")).filter(Boolean));
  const transfers = [];

  for (const playerId of playerIds) {
    if (playerId === String(viewerPlayerId || "")) continue;
    const deckPrefix = `redacted-main-${playerId}-`;
    const departedDeckCards = [...previous.entries()]
      .filter(([id, location]) => String(id).startsWith(deckPrefix) && location?.zone === "mainDeck" && !current.has(id))
      .map(([id, location]) => ({ id: String(id), location }))
      .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0) || left.id.localeCompare(right.id));
    if (!departedDeckCards.length) continue;

    const destinations = [...current.entries()]
      .filter(([id, location]) => !previous.has(id)
        && !claimedDestinationIds.has(id)
        && String(location?.playerId || "") === playerId
        && ((location.zone === "hand" && location.faceVisible === false)
          || location.zone === "trash"
          || location.zone === "banished"))
      .map(([id, location]) => ({ id: String(id), location }))
      .sort((left, right) => Number(left.location?.index || 0) - Number(right.location?.index || 0) || left.id.localeCompare(right.id));
    if (destinations.length !== departedDeckCards.length) continue;

    for (let index = 0; index < destinations.length; index += 1) {
      const source = departedDeckCards[index];
      const destination = destinations[index];
      const kind = destination.location.zone === "hand" ? "draw" : destination.location.zone === "trash" ? "burn" : "banish";
      transfers.push({
        id: destination.id,
        fromCardId: source.id,
        toCardId: destination.id,
        kind,
        from: { ...source.location, faceVisible: false },
        to: { ...destination.location },
        faceVisible: false,
        image: "",
        name: "",
        order: Number(destination.location?.index || 0)
      });
      claimedDestinationIds.add(destination.id);
    }
  }
  return transfers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}
