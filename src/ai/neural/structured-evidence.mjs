import { observeGame } from "../observation.mjs";
import {
  BATTLEFIELD_FEATURES,
  CARD_BINS,
  MAX_BATTLEFIELDS,
  STATE_DIM,
  STATE_SCALARS,
  STRUCTURED_STATE_LAYOUT,
  cardBin
} from "./encoding.mjs";

export const STRUCTURED_EVIDENCE_SCHEMA_VERSION = 5;
export const STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT =
  "public-structured-evidence-v5-object-masks-full-turn-priority-ledger";
export const STRUCTURED_EVIDENCE_TENSOR_LAYOUT = Object.freeze({
  version: 2,
  globalWidth: 64,
  cardTokenWidth: CARD_BINS + 32,
  maximumCardTokens: 128,
  battlefieldTokenWidth: 32,
  maximumBattlefields: MAX_BATTLEFIELDS,
  turnEventTokenWidth: 32,
  maximumTurnEvents: 32,
  actionWidth: 64,
  availabilityWidth: 8
});

// Append-only companion to the legacy 3,704-value encoding. observeGame() is
// the only source, which keeps opponent private cards outside the archive.
export function createPublicStructuredEvidenceSnapshot(game, viewerId, options = {}) {
  const observation = observeGame(game, viewerId);
  if (!observation) return null;
  const objectIndex = publicObjectIndex(observation);
  return {
    evidenceSchemaVersion: STRUCTURED_EVIDENCE_SCHEMA_VERSION,
    encoderFingerprint: STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
    engineFingerprint: options.engineFingerprint || null,
    informationSetHash: options.informationSetHash || null,
    source: "viewer-public-observation",
    featureAvailableMask: {
      legacyState: true,
      cardZoneTokens: true,
      battlefieldUnitRelations: true,
      actionObjectRelations: Boolean(options.action),
      turnEventHistory: true,
      hiddenOpponentCards: false
    },
    global: {
      phase: observation.phase,
      turnNumber: Number(observation.turnNumber) || 0,
      turnSequence: Number(observation.turnSequence) || 0,
      victoryScore: Number(observation.victoryScore) || 0,
      currentPlayer: relativePlayer(observation.currentPlayerId, viewerId),
      focusPlayer: relativePlayer(observation.focusPlayerId, viewerId),
      actionChainSize: Number(observation.actionChainSize) || 0,
      showdown: observation.showdown ? {
        battlefieldId: observation.showdown.battlefieldId || null,
        attacker: relativePlayer(observation.showdown.attackerId, viewerId),
        defender: relativePlayer(observation.showdown.defenderId, viewerId),
        priority: relativePlayer(observation.showdown.priorityPlayerId, viewerId),
        chainSize: Number(observation.showdown.chainSize) || 0
      } : null
    },
    players: [
      compactPlayer(observation.self, viewerId),
      compactPlayer(observation.opponent, viewerId)
    ],
    battlefields: observation.battlefields.map((field) => ({
      id: field.id || null,
      cardNumber: field.cardNumber || null,
      controlledBy: relativePlayer(field.controlledBy, viewerId),
      units: field.units.map((card) => compactCard(card, viewerId)),
      hidden: field.hidden.map((item) => ({
        owner: relativePlayer(item.ownerId, viewerId),
        card: item.card?.hidden === true
          ? { hidden: true }
          : compactCard(item.card, viewerId)
      }))
    })),
    chainCards: observation.chainCards.map((card) => compactCard(card, viewerId)),
    turnEvents: selectStrategicTurnEvents(
      (observation.turnEvents || []).filter((event) =>
        Number(event.turnNumber) === Number(observation.turnNumber)
        && Number(event.turnSequence) === Number(observation.turnSequence)),
      32
    )
      .map((event) => ({
        kind: event.kind || null,
        actionKind: event.actionKind || null,
        outcome: event.outcome || null,
        chainKind: event.chainKind || null,
        chainItemType: event.chainItemType || null,
        actor: relativePlayer(event.actorId, viewerId),
        sourcePlayer: relativePlayer(event.sourcePlayerId, viewerId),
        sourceCardId: event.sourceCardId || null,
        sourceCardNumber: event.sourceCardNumber || null,
        sourceType: event.sourceType || null,
        sourceObjectIds: [...(event.sourceObjectIds || [])],
        targetObjectIds: [...(event.targetObjectIds || [])],
        objectIds: [...(event.objectIds || [])],
        cardNumbers: [...(event.cardNumbers || [])],
        destinationId: event.destinationId || null,
        optionId: event.optionId || null,
        count: Math.max(0, Number(event.count) || 0),
        identitiesVisible: event.identitiesVisible === true,
        phase: event.phase || null,
        turnSequence: Number(event.turnSequence) || 0
      })),
    action: compactAction(options.action, objectIndex)
  };
}

function selectStrategicTurnEvents(events, maximum) {
  const values = Array.isArray(events) ? events : [];
  if (values.length <= maximum) return values;
  const selected = [];
  const selectedIndexes = new Set();
  for (const priority of [4, 3, 2, 1]) {
    const candidates = values
      .map((event, index) => ({ event, index }))
      .filter((entry) => turnEventPriority(entry.event) === priority);
    const remaining = maximum - selected.length;
    if (remaining <= 0) break;
    const chosen = candidates.length <= remaining
      ? candidates
      : Array.from({ length: remaining }, (_, index) =>
        candidates[Math.floor(index * candidates.length / remaining)]);
    for (const entry of chosen) {
      if (selectedIndexes.has(entry.index)) continue;
      selectedIndexes.add(entry.index);
      selected.push(entry);
    }
  }
  return selected.sort((left, right) => left.index - right.index)
    .map((entry) => entry.event);
}

function turnEventPriority(event) {
  if (event?.kind === "recycle") return 4;
  if ([
    "beginPlayCard", "beginPlayChampion", "hideCard", "moveUnit",
    "moveUnits", "activateCard"
  ].includes(event?.actionKind)) return 4;
  if (event?.kind === "response" || [
    "chooseEffectOption", "declineEffectChoice", "passShowdown", "endTurn",
    "submitMulligan"
  ].includes(event?.actionKind)) return 3;
  if (event?.kind === "effect-resolution") return 2;
  return 1;
}

// Action evidence is evaluated at the post-action state, while object
// relations must be resolved before the transition can remove or transform
// those objects. Preserve both public observations and carry the action
// relation created from the pre-action index.
export function createPublicStructuredEvidenceTransition(
  beforeGame,
  afterGame,
  viewerId,
  options = {}
) {
  const before = createPublicStructuredEvidenceSnapshot(
    beforeGame,
    viewerId,
    options
  );
  const after = createPublicStructuredEvidenceSnapshot(
    afterGame,
    viewerId,
    {
      ...options,
      action: null
    }
  );
  if (!before || !after) return null;
  return {
    evidenceSchemaVersion: STRUCTURED_EVIDENCE_SCHEMA_VERSION,
    encoderFingerprint: STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
    engineFingerprint: options.engineFingerprint || null,
    informationSetHash: options.informationSetHash || null,
    source: "viewer-public-transition",
    featureAvailableMask: {
      legacyState: true,
      cardZoneTokens: true,
      battlefieldUnitRelations: true,
      actionObjectRelations:
        (before.action?.objectRelations || []).some(
          (relation) => relation?.unavailableBeforeAction !== true
        ),
      turnEventHistory: true,
      preActionObservation: true,
      postActionObservation: true,
      hiddenOpponentCards: false
    },
    action: before.action,
    preAction: { ...before, action: null },
    postAction: after
  };
}

export function validPublicStructuredEvidenceSnapshot(value, options = {}) {
  if (value?.source === "viewer-public-transition") {
    return validStructuredEvidenceEnvelope(value, options)
      && validObservationSnapshot(value.preAction, options)
      && validObservationSnapshot(value.postAction, options)
      && sameProvenance(value, value.preAction)
      && sameProvenance(value, value.postAction)
      && validActionRelations(value.action)
      && value.featureAvailableMask?.preActionObservation === true
      && value.featureAvailableMask?.postActionObservation === true;
  }
  return validObservationSnapshot(value, options);
}

function validStructuredEvidenceEnvelope(value, options = {}) {
  return value?.evidenceSchemaVersion === STRUCTURED_EVIDENCE_SCHEMA_VERSION
    && value?.encoderFingerprint === STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT
    && value?.featureAvailableMask?.hiddenOpponentCards === false
    && typeof value?.engineFingerprint === "string"
    && value.engineFingerprint.length > 0
    && typeof value?.informationSetHash === "string"
    && value.informationSetHash.length > 0
    && (!options.engineFingerprint
      || value.engineFingerprint === options.engineFingerprint)
    && (!options.informationSetHash
      || value.informationSetHash === options.informationSetHash);
}

function validObservationSnapshot(value, options = {}) {
  return validStructuredEvidenceEnvelope(value, options)
    && value?.source === "viewer-public-observation"
    && Array.isArray(value?.players)
    && value.players.length === 2
    && value.players[0]?.side === "self"
    && value.players[1]?.side === "opponent"
    && Array.isArray(value.players[1]?.hand)
    && value.players[1].hand.length === 0
    && Array.isArray(value?.battlefields)
    && !containsPrivateHiddenIdentity(value);
}

export function encodePublicStructuredEvidence(value, options = {}) {
  const legacyState = options.legacyState;
  if (!validPublicStructuredEvidenceSnapshot(value, options)) {
    return encodeLegacyStructuredFallback(legacyState);
  }
  const before = value.source === "viewer-public-transition"
    ? value.preAction
    : value;
  const after = value.source === "viewer-public-transition"
    ? value.postAction
    : value;
  const action = value.source === "viewer-public-transition"
    ? value.action
    : value.action;
  const layout = STRUCTURED_EVIDENCE_TENSOR_LAYOUT;
  const global = new Float32Array(layout.globalWidth);
  encodeGlobalObservation(after, global, 0);
  const beforeGlobal = new Float32Array(layout.globalWidth);
  encodeGlobalObservation(before, beforeGlobal, 0);
  for (let index = 0; index < 12; index += 1) {
    global[52 + index] = global[index] - beforeGlobal[index];
  }
  const cards = new Float32Array(
    layout.maximumCardTokens * layout.cardTokenWidth
  );
  const cardMask = new Float32Array(layout.maximumCardTokens);
  const actionSourceMask = new Float32Array(layout.maximumCardTokens);
  const actionTargetMask = new Float32Array(layout.maximumCardTokens);
  encodeCardTokens(after, cards, cardMask, {
    before,
    action,
    actionSourceMask,
    actionTargetMask
  });
  const battlefields = new Float32Array(
    layout.maximumBattlefields * layout.battlefieldTokenWidth
  );
  const battlefieldMask = new Float32Array(layout.maximumBattlefields);
  encodeBattlefields(after, battlefields, battlefieldMask);
  const turnEvents = new Float32Array(
    layout.maximumTurnEvents * layout.turnEventTokenWidth
  );
  const turnEventMask = new Float32Array(layout.maximumTurnEvents);
  encodeTurnEvents(after, turnEvents, turnEventMask);
  const actionValues = new Float32Array(layout.actionWidth);
  encodeAction(action, actionValues);
  const availability = new Float32Array(layout.availabilityWidth);
  availability.set([
    1,
    Number(value.featureAvailableMask?.cardZoneTokens === true),
    Number(value.featureAvailableMask?.battlefieldUnitRelations === true),
    Number(value.featureAvailableMask?.actionObjectRelations === true),
    Number(value.featureAvailableMask?.turnEventHistory === true),
    Number(value.featureAvailableMask?.preActionObservation === true),
    Number(value.featureAvailableMask?.postActionObservation === true),
    0
  ]);
  return {
    version: layout.version,
    actualStructuredV2: true,
    global,
    cards,
    cardMask,
    actionSourceMask,
    actionTargetMask,
    battlefields,
    battlefieldMask,
    turnEvents,
    turnEventMask,
    action: actionValues,
    availability
  };
}

export function stackPublicStructuredEvidence(values, options = {}) {
  const encoded = values.map((value, index) => encodePublicStructuredEvidence(
    value,
    {
      engineFingerprint: options.engineFingerprint,
      informationSetHash: options.informationSetHashes?.[index],
      legacyState: options.legacyStates?.[index]
    }
  ));
  const layout = STRUCTURED_EVIDENCE_TENSOR_LAYOUT;
  return {
    size: encoded.length,
    actualStructuredV2: encoded.map((item) => item.actualStructuredV2),
    global: stackTyped(encoded, "global", layout.globalWidth),
    cards: stackTyped(
      encoded,
      "cards",
      layout.maximumCardTokens * layout.cardTokenWidth
    ),
    cardMask: stackTyped(
      encoded,
      "cardMask",
      layout.maximumCardTokens
    ),
    actionSourceMask: stackTyped(
      encoded,
      "actionSourceMask",
      layout.maximumCardTokens
    ),
    actionTargetMask: stackTyped(
      encoded,
      "actionTargetMask",
      layout.maximumCardTokens
    ),
    battlefields: stackTyped(
      encoded,
      "battlefields",
      layout.maximumBattlefields * layout.battlefieldTokenWidth
    ),
    battlefieldMask: stackTyped(
      encoded,
      "battlefieldMask",
      layout.maximumBattlefields
    ),
    turnEvents: stackTyped(
      encoded,
      "turnEvents",
      layout.maximumTurnEvents * layout.turnEventTokenWidth
    ),
    turnEventMask: stackTyped(
      encoded,
      "turnEventMask",
      layout.maximumTurnEvents
    ),
    action: stackTyped(encoded, "action", layout.actionWidth),
    availability: stackTyped(
      encoded,
      "availability",
      layout.availabilityWidth
    )
  };
}

function compactPlayer(player, viewerId) {
  return {
    side: relativePlayer(player.id, viewerId),
    score: Number(player.score) || 0,
    xp: Number(player.xp) || 0,
    handCount: Number(player.handCount) || 0,
    hand: (player.hand || []).map((card) => compactCard(card, viewerId)),
    deckCount: Number(player.deckCount) || 0,
    trash: (player.trash || []).map((card) => compactCard(card, viewerId)),
    banished: (player.banished || []).map((card) => compactCard(card, viewerId)),
    base: (player.base || []).map((card) => compactCard(card, viewerId)),
    runes: (player.runes || []).map((rune) => [
      rune.domain || null,
      rune.exhausted === true ? 1 : 0
    ]),
    champion: compactCard(player.champion, viewerId),
    legend: compactCard(player.legend, viewerId),
    knownBottomCards: (player.knownBottomCards || []).map((card) => compactCard(card, viewerId)),
    knownBottomCardsAhead: finiteOrNull(player.knownBottomCardsAhead),
    mulliganBottomCards: (player.mulliganBottomCards || []).map((card) => compactCard(card, viewerId)),
    mulliganBottomCardsAhead: finiteOrNull(player.mulliganBottomCardsAhead)
  };
}

function compactCard(card, viewerId) {
  if (!card) return null;
  if (card.hidden === true) return { hidden: true };
  return {
    id: card.instanceId || card.id || null,
    cardNumber: card.cardNumber || null,
    type: card.type || null,
    controller: relativePlayer(card.controllerId, viewerId),
    owner: relativePlayer(card.ownerId, viewerId),
    energy: Number(card.energy) || 0,
    might: Number(card.might) || 0,
    damage: Number(card.damage) || 0,
    buffs: Number(card.buffs) || 0,
    mightModifier: Number(card.mightModifier) || 0,
    exhausted: card.exhausted === true ? 1 : 0,
    stunned: card.stunned === true ? 1 : 0,
    domains: [...(card.domains || [])],
    tags: [...(card.tags || [])],
    keywords: [...(card.keywords || [])],
    attachments: (card.attachments || []).map((item) => compactCard(item, viewerId))
  };
}

function publicObjectIndex(observation) {
  const index = new Map();
  const add = (card, zone, battlefieldId = null) => {
    if (!card || card.hidden === true) return;
    const id = card.instanceId || card.id;
    if (!id) return;
    index.set(String(id), { id: String(id), cardNumber: card.cardNumber || null, zone, battlefieldId });
    for (const attachment of card.attachments || []) add(attachment, "attachment", battlefieldId);
  };
  for (const [side, player] of [["self", observation.self], ["opponent", observation.opponent]]) {
    for (const zone of ["hand", "trash", "banished", "base"]) {
      for (const card of player[zone] || []) add(card, `${side}:${zone}`);
    }
    add(player.champion, `${side}:champion`);
    add(player.legend, `${side}:legend`);
  }
  for (const field of observation.battlefields) {
    for (const card of field.units) add(card, "battlefield", field.id);
    for (const hidden of field.hidden) add(hidden.card, "hidden", field.id);
  }
  for (const card of observation.chainCards) add(card, "chain");
  return index;
}

function compactAction(action, objectIndex) {
  if (!action) return null;
  const candidates = [
    [action.cardId, "source"],
    [action.unitId, "source"],
    [action.sourceId, "source"],
    [action.targetId, "target"],
    ...(action.cardIds || []).map((id) => [id, "source"]),
    ...(action.unitIds || []).map((id) => [id, "source"]),
    ...(action.targetIds || []).map((id) => [id, "target"])
  ].filter(([id]) => Boolean(id));
  const relationByIdentity = new Map();
  for (const [rawId, role] of candidates) {
    const id = String(rawId);
    const key = `${role}:${id}`;
    relationByIdentity.set(key, {
      ...(objectIndex.get(id) || {
        id,
        unavailableBeforeAction: true
      }),
      role
    });
  }
  return {
    kind: action.kind || null,
    keyFields: Object.fromEntries([
      "cardNumber", "abilityId", "mode", "optionId", "destination",
      "destinationId", "battlefieldId", "outCardNumber", "inCardNumber"
    ].flatMap((key) => action[key] == null ? [] : [[key, action[key]]])),
    objectRelations: [...relationByIdentity.values()]
  };
}

function relativePlayer(playerId, viewerId) {
  if (!playerId) return null;
  return playerId === viewerId ? "self" : "opponent";
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sameProvenance(left, right) {
  return left?.engineFingerprint === right?.engineFingerprint
    && left?.informationSetHash === right?.informationSetHash
    && left?.encoderFingerprint === right?.encoderFingerprint;
}

function validActionRelations(action) {
  if (action == null) return true;
  return typeof action === "object"
    && Array.isArray(action.objectRelations)
    && action.objectRelations.every((relation) =>
      relation && typeof relation.id === "string");
}

function containsPrivateHiddenIdentity(value) {
  let invalid = false;
  const visit = (item) => {
    if (invalid || item == null || typeof item !== "object") return;
    if (item.hidden === true) {
      const keys = Object.keys(item);
      if (keys.some((key) => key !== "hidden")) invalid = true;
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return invalid;
}

function encodeLegacyStructuredFallback(legacyState) {
  const layout = STRUCTURED_EVIDENCE_TENSOR_LAYOUT;
  const state = (Array.isArray(legacyState) || ArrayBuffer.isView(legacyState))
    && legacyState.length === STATE_DIM
    ? Float32Array.from(legacyState)
    : new Float32Array(STATE_DIM);
  const global = new Float32Array(layout.globalWidth);
  global.set(state.slice(0, Math.min(STATE_SCALARS, layout.globalWidth)));
  const cards = new Float32Array(
    layout.maximumCardTokens * layout.cardTokenWidth
  );
  const cardMask = new Float32Array(layout.maximumCardTokens);
  let token = 0;
  for (let zone = 0; zone < 4 && token < layout.maximumCardTokens; zone += 1) {
    const offset = STRUCTURED_STATE_LAYOUT.cardZones.offset + zone * CARD_BINS;
    for (let index = 0; index < CARD_BINS && token < layout.maximumCardTokens; index += 1) {
      const count = Number(state[offset + index]) || 0;
      if (count === 0) continue;
      const target = token * layout.cardTokenWidth;
      cards[target + index] = Math.sign(count);
      cards[target + CARD_BINS] = Math.min(1, Math.abs(count));
      cards[target + CARD_BINS + 1 + zone] = 1;
      cardMask[token] = 1;
      token += 1;
    }
  }
  const battlefields = new Float32Array(
    layout.maximumBattlefields * layout.battlefieldTokenWidth
  );
  const battlefieldMask = new Float32Array(layout.maximumBattlefields);
  for (let index = 0; index < layout.maximumBattlefields; index += 1) {
    const sourceOffset = STRUCTURED_STATE_LAYOUT.battlefields.offset
      + index * STRUCTURED_STATE_LAYOUT.battlefields.width;
    const targetOffset = index * layout.battlefieldTokenWidth;
    battlefields.set(
      state.slice(
        sourceOffset,
        sourceOffset + Math.min(
          BATTLEFIELD_FEATURES,
          layout.battlefieldTokenWidth
        )
      ),
      targetOffset
    );
    battlefieldMask[index] = 1;
  }
  const availability = new Float32Array(layout.availabilityWidth);
  availability[0] = 0;
  availability[7] = 1;
  return {
    version: layout.version,
    actualStructuredV2: false,
    global,
    cards,
    cardMask,
    actionSourceMask: new Float32Array(layout.maximumCardTokens),
    actionTargetMask: new Float32Array(layout.maximumCardTokens),
    battlefields,
    battlefieldMask,
    turnEvents: new Float32Array(
      layout.maximumTurnEvents * layout.turnEventTokenWidth
    ),
    turnEventMask: new Float32Array(layout.maximumTurnEvents),
    action: new Float32Array(layout.actionWidth),
    availability
  };
}

function encodeGlobalObservation(observation, output) {
  const phaseIndex = [
    "setup", "mulligan", "main", "showdown", "reaction", "complete"
  ].indexOf(observation.global?.phase);
  if (phaseIndex >= 0) output[phaseIndex] = 1;
  output[6] = Math.min(1, Number(observation.global?.turnNumber) / 20 || 0);
  output[7] = Math.min(1, Number(observation.global?.turnSequence) / 80 || 0);
  output[8] = Math.min(1, Number(observation.global?.actionChainSize) / 8 || 0);
  output[9] = observation.global?.currentPlayer === "self" ? 1 : -1;
  output[10] = observation.global?.focusPlayer === "self" ? 1 : -1;
  output[11] = observation.global?.showdown ? 1 : 0;
  for (let side = 0; side < 2; side += 1) {
    const player = observation.players?.[side] || {};
    const base = 12 + side * 12;
    const victoryScore = Math.max(1, Number(observation.global?.victoryScore) || 8);
    output[base] = (Number(player.score) || 0) / victoryScore;
    output[base + 1] = Math.min(1, (Number(player.xp) || 0) / 20);
    output[base + 2] = Math.min(1, (Number(player.handCount) || 0) / 20);
    output[base + 3] = Math.min(1, (Number(player.deckCount) || 0) / 50);
    output[base + 4] = Math.min(1, (player.trash?.length || 0) / 30);
    output[base + 5] = Math.min(1, (player.banished?.length || 0) / 20);
    output[base + 6] = Math.min(1, (player.base?.length || 0) / 12);
    output[base + 7] = Math.min(1, (player.runes?.length || 0) / 12);
    output[base + 8] = Math.min(1, (player.runes || []).filter((rune) => !rune?.[1]).length / 12);
    output[base + 9] = Math.min(1, (player.knownBottomCards?.length || 0) / 20);
    output[base + 10] = Math.min(1, (player.mulliganBottomCards?.length || 0) / 20);
    output[base + 11] = side === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.min(3, observation.battlefields?.length || 0); index += 1) {
    const field = observation.battlefields[index];
    output[36 + index * 4] = field.controlledBy === "self" ? 1
      : field.controlledBy === "opponent" ? -1 : 0;
    output[37 + index * 4] = Math.min(1, (field.units?.length || 0) / 12);
    output[38 + index * 4] = Math.min(1, (field.hidden?.length || 0) / 8);
    output[39 + index * 4] = 1;
  }
  const events = observation.turnEvents || [];
  output[48] = Math.min(1, events.length / 32);
  output[49] = Math.min(1, events.filter((event) =>
    event.kind === "decision"
      && ["beginPlayCard", "activateCard"].includes(event.actionKind))
    .length / 12);
  output[50] = Math.min(1, events.filter((event) =>
    event.outcome === "pass").length / 12);
  output[51] = Math.min(1, (observation.chainCards?.length || 0) / 12);
}

function encodeCardTokens(observation, output, mask, options = {}) {
  const layout = STRUCTURED_EVIDENCE_TENSOR_LAYOUT;
  const tokens = [];
  const seenIds = new Set();
  const add = (card, metadata = {}) => {
    if (!card || card.hidden === true) return;
    const id = String(card.id || "");
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    tokens.push({ card, preActionOnly: false, ...metadata });
    for (const attachment of card.attachments || []) {
      add(attachment, { ...metadata, zone: "attachment" });
    }
  };
  const collect = (source) => {
    for (let side = 0; side < 2; side += 1) {
      const player = source?.players?.[side] || {};
      for (const zone of [
        "hand", "trash", "banished", "base", "knownBottomCards",
        "mulliganBottomCards"
      ]) {
        for (const card of player[zone] || []) add(card, { side, zone });
      }
      add(player.champion, { side, zone: "champion" });
      add(player.legend, { side, zone: "legend" });
    }
    for (let battlefield = 0;
      battlefield < (source?.battlefields?.length || 0);
      battlefield += 1) {
      for (const card of source.battlefields[battlefield].units || []) {
        add(card, {
          side: card.controller === "self" ? 0 : 1,
          zone: "battlefield",
          battlefield
        });
      }
    }
    for (const card of source?.chainCards || []) {
      add(card, {
        side: card.controller === "self" ? 0 : 1,
        zone: "chain"
      });
    }
  };
  collect(observation);
  const relationIds = new Set(
    (options.action?.objectRelations || []).map((relation) =>
      String(relation?.id || "")).filter(Boolean)
  );
  if (relationIds.size > 0 && options.before) {
    const preTokens = publicObservationCardTokens(options.before);
    for (const token of preTokens) {
      const id = String(token.card?.id || "");
      if (!relationIds.has(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      tokens.push({ ...token, preActionOnly: true });
    }
  }
  const relationsById = new Map();
  for (const relation of options.action?.objectRelations || []) {
    const id = String(relation?.id || "");
    if (!id) continue;
    const roles = relationsById.get(id) || new Set();
    roles.add(relation.role || "source");
    relationsById.set(id, roles);
  }
  tokens.slice(0, layout.maximumCardTokens).forEach((token, index) => {
    const offset = index * layout.cardTokenWidth;
    const vocabularyIndex = cardBin(token.card.cardNumber);
    output[offset + vocabularyIndex] = 1;
    let cursor = offset + CARD_BINS;
    output[cursor++] = 1;
    output[cursor++] = token.side === 0 ? 1 : 0;
    output[cursor++] = token.side === 1 ? 1 : 0;
    const zones = [
      "hand", "trash", "banished", "base", "knownBottomCards",
      "mulliganBottomCards", "champion", "legend", "battlefield",
      "chain", "attachment"
    ];
    const zoneIndex = zones.indexOf(token.zone);
    for (let zone = 0; zone < zones.length; zone += 1) {
      output[cursor++] = zone === zoneIndex ? 1 : 0;
    }
    for (let field = 0; field < 3; field += 1) {
      output[cursor++] = field === token.battlefield ? 1 : 0;
    }
    output[cursor++] = Math.tanh((Number(token.card.energy) || 0) / 10);
    output[cursor++] = Math.tanh((Number(token.card.might) || 0) / 10);
    output[cursor++] = Math.tanh((Number(token.card.damage) || 0) / 10);
    output[cursor++] = Math.tanh((Number(token.card.buffs) || 0) / 10);
    output[cursor++] = Math.tanh((Number(token.card.mightModifier) || 0) / 10);
    output[cursor++] = Number(token.card.exhausted) || 0;
    output[cursor++] = Number(token.card.stunned) || 0;
    output[cursor++] = Math.min(1, (token.card.attachments?.length || 0) / 4);
    output[cursor++] = Math.min(1, (token.card.keywords?.length || 0) / 8);
    output[cursor++] = Math.min(1, (token.card.domains?.length || 0) / 4);
    output[cursor++] = stableUnitHash(token.card.type, 2);
    output[cursor++] = stableUnitHash((token.card.domains || []).join("|"), 3);
    output[cursor++] = stableUnitHash((token.card.tags || []).join("|"), 5);
    output[cursor++] = stableUnitHash((token.card.keywords || []).join("|"), 7);
    output[cursor++] = token.preActionOnly ? 1 : 0;
    const roles = relationsById.get(String(token.card.id || ""));
    if (roles?.has("source")) options.actionSourceMask[index] = 1;
    if (roles?.has("target")) options.actionTargetMask[index] = 1;
    mask[index] = 1;
  });
}

function publicObservationCardTokens(observation) {
  const tokens = [];
  const add = (card, metadata = {}) => {
    if (!card || card.hidden === true) return;
    tokens.push({ card, ...metadata });
    for (const attachment of card.attachments || []) {
      add(attachment, { ...metadata, zone: "attachment" });
    }
  };
  for (let side = 0; side < 2; side += 1) {
    const player = observation?.players?.[side] || {};
    for (const zone of [
      "hand", "trash", "banished", "base", "knownBottomCards",
      "mulliganBottomCards"
    ]) {
      for (const card of player[zone] || []) add(card, { side, zone });
    }
    add(player.champion, { side, zone: "champion" });
    add(player.legend, { side, zone: "legend" });
  }
  for (let battlefield = 0;
    battlefield < (observation?.battlefields?.length || 0);
    battlefield += 1) {
    for (const card of observation.battlefields[battlefield].units || []) {
      add(card, {
        side: card.controller === "self" ? 0 : 1,
        zone: "battlefield",
        battlefield
      });
    }
  }
  for (const card of observation?.chainCards || []) {
    add(card, {
      side: card.controller === "self" ? 0 : 1,
      zone: "chain"
    });
  }
  return tokens;
}

function encodeBattlefields(observation, output, mask) {
  const width = STRUCTURED_EVIDENCE_TENSOR_LAYOUT.battlefieldTokenWidth;
  (observation.battlefields || []).slice(0, MAX_BATTLEFIELDS).forEach((field, index) => {
    const offset = index * width;
    output[offset] = 1;
    output[offset + 1] = field.controlledBy === "self" ? 1
      : field.controlledBy === "opponent" ? -1 : 0;
    output[offset + 2] = Math.min(1, (field.units?.length || 0) / 12);
    output[offset + 3] = Math.min(1, (field.hidden?.length || 0) / 8);
    output[offset + 4] = stableUnitHash(field.cardNumber, 11);
    const mine = (field.units || []).filter((card) => card.controller === "self");
    const theirs = (field.units || []).filter((card) => card.controller === "opponent");
    output[offset + 5] = mine.length / 12;
    output[offset + 6] = theirs.length / 12;
    output[offset + 7] = mine.reduce((sum, card) => sum + (Number(card.might) || 0), 0) / 40;
    output[offset + 8] = theirs.reduce((sum, card) => sum + (Number(card.might) || 0), 0) / 40;
    mask[index] = 1;
  });
}

function encodeTurnEvents(observation, output, mask) {
  const width = STRUCTURED_EVIDENCE_TENSOR_LAYOUT.turnEventTokenWidth;
  const events = (observation.turnEvents || []).slice(
    -STRUCTURED_EVIDENCE_TENSOR_LAYOUT.maximumTurnEvents
  );
  events.forEach((event, index) => {
    const offset = index * width;
    output[offset] = 1;
    output[offset + 1 + stableIndex(event.kind, 5)] = 1;
    output[offset + 6 + stableIndex(event.actionKind, 8)] = 1;
    output[offset + 14] = event.actor === "self" ? 1
      : event.actor === "opponent" ? -1 : 0;
    output[offset + 15] = event.sourcePlayer === "self" ? 1
      : event.sourcePlayer === "opponent" ? -1 : 0;
    output[offset + 16] = event.outcome === "pass" ? 1 : 0;
    output[offset + 17] = event.outcome === "applied" ? 1 : 0;
    output[offset + 18] = event.kind === "recycle" ? 1 : 0;
    output[offset + 19] = event.kind === "effect-resolution" ? 1 : 0;
    output[offset + 20] = Math.min(1, (Number(event.count) || 0) / 12);
    output[offset + 21] = Math.min(
      1,
      (Number(event.turnSequence) || 0) / 80
    );
    output[offset + 22] = stableUnitHash(event.sourceCardNumber, 29);
    output[offset + 23] = stableUnitHash(event.sourceType, 31);
    output[offset + 24] = stableUnitHash(event.destinationId, 37);
    output[offset + 25] = stableUnitHash(event.optionId, 41);
    output[offset + 26] = stableUnitHash(event.chainKind, 43);
    output[offset + 27] = stableUnitHash(event.chainItemType, 47);
    output[offset + 28] = event.identitiesVisible ? 1 : 0;
    output[offset + 29] = Math.min(
      1,
      (event.sourceObjectIds?.length || 0) / 8
    );
    output[offset + 30] = Math.min(
      1,
      (event.targetObjectIds?.length || 0) / 8
    );
    output[offset + 31] = Math.min(
      1,
      (event.cardNumbers?.length || 0) / 12
    );
    mask[index] = 1;
  });
}

function encodeAction(action, output) {
  if (!action) return;
  output[stableIndex(action.kind, 16)] = 1;
  let cursor = 16;
  for (const [key, value] of Object.entries(action.keyFields || {}).slice(0, 12)) {
    output[cursor++] = stableUnitHash(key, 13);
    output[cursor++] = typeof value === "number"
      ? Math.tanh(value / 10)
      : stableUnitHash(value, 17);
  }
  const relations = action.objectRelations || [];
  output[48] = Math.min(1, relations.length / 8);
  output[49] = Math.min(1, relations.filter((item) => item.unavailableBeforeAction).length / 8);
  for (let index = 0; index < Math.min(7, relations.length); index += 1) {
    output[50 + index * 2] = stableUnitHash(relations[index].cardNumber, 19);
    output[51 + index * 2] = stableUnitHash(
      `${relations[index].zone || ""}|${relations[index].battlefieldId || ""}`,
      23
    );
  }
}

function stackTyped(items, key, width) {
  const result = new Float32Array(items.length * width);
  items.forEach((item, index) => result.set(item[key], index * width));
  return result;
}

function stableIndex(value, bins) {
  let hash = 2166136261;
  for (const character of String(value || "<unknown>")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % bins;
}

function stableUnitHash(value, salt) {
  return stableIndex(`${salt}:${String(value || "<unknown>")}`, 65521) / 32760.5 - 1;
}
