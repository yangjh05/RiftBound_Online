export const GAME_REPRODUCTION_LOG_SCHEMA_VERSION = 1;
export const GAME_REPRODUCTION_DESCRIPTION_MIN_CODE_POINTS = 10;
export const GAME_REPRODUCTION_DESCRIPTION_MAX_CODE_POINTS = 2000;
export const GAME_REPRODUCTION_DESCRIPTION_PLACEHOLDER =
  "발생한 문제와 직전 행동을 10자 이상 자세히 입력해 주세요.";

export const GAME_REPRODUCTION_END_REASONS = Object.freeze({
  NORMAL: "normal",
  SURRENDER: "surrender",
  UI_ERROR: "ui-error"
});

const SERIALIZED_TYPE_KEY = "__riftboundDiagnosticType";
const VALID_END_REASONS = new Set(Object.values(GAME_REPRODUCTION_END_REASONS));
const DEFAULT_MAX_UI_BREADCRUMBS = 200;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_MAX_UI_ERRORS = 25;
const DEFAULT_MAX_FRAMES = 20;
const DEFAULT_MAX_COMMANDS = 2000;
const DEFAULT_MAX_COMMAND_PART_BYTES = 16 * 1024;
const DEFAULT_MAX_COMMAND_STRING_LENGTH = 2048;
const DEFAULT_MAX_COMMAND_TOTAL_STRING_LENGTH = 8192;
const DEFAULT_MAX_COMMAND_NODES = 2048;
const REDACTED_DIAGNOSTIC_TEXT = "[REDACTED]";
const COMMAND_OUTCOME_KEYS = Object.freeze([
  "state",
  "status",
  "context",
  "result",
  "reason",
  "message",
  "error",
  "exception",
  "rejected",
  "ok",
  "name",
  "stack"
]);
const DEFAULT_SANITIZER_LIMITS = Object.freeze({
  maxDepth: 32,
  maxArrayItems: 1000,
  maxObjectKeys: 256,
  maxPropertyKeyLength: 256,
  maxStringLength: 32 * 1024,
  maxTotalStringLength: 512 * 1024,
  maxNodes: 20_000
});
const STATE_SANITIZER_LIMITS = Object.freeze({
  maxDepth: 100,
  maxArrayItems: 20_000,
  maxObjectKeys: 5000,
  maxPropertyKeyLength: 1024,
  maxStringLength: 256 * 1024,
  maxTotalStringLength: 16 * 1024 * 1024,
  maxNodes: 500_000
});
const LOG_SANITIZER_LIMITS = Object.freeze({
  maxDepth: 120,
  maxArrayItems: 20_000,
  maxObjectKeys: 5000,
  maxPropertyKeyLength: 1024,
  maxStringLength: 256 * 1024,
  maxTotalStringLength: 32 * 1024 * 1024,
  maxNodes: 1_000_000
});
const COMMAND_PART_SANITIZER_LIMITS = Object.freeze({
  maxDepth: 12,
  maxArrayItems: 128,
  maxObjectKeys: 96,
  maxPropertyKeyLength: 180,
  maxStringLength: DEFAULT_MAX_COMMAND_STRING_LENGTH,
  maxTotalStringLength: DEFAULT_MAX_COMMAND_TOTAL_STRING_LENGTH,
  maxNodes: DEFAULT_MAX_COMMAND_NODES
});

const EXACT_SECRET_KEYS = new Set([
  "token",
  "authorization",
  "proxyauthorization",
  "secret",
  "apikey",
  "privatekey",
  "cookie",
  "setcookie",
  "credential",
  "credentials",
  "jwt"
]);

const UI_TEXT_KEYS = new Set([
  "value",
  "text",
  "textcontent",
  "innertext",
  "innerhtml",
  "outerhtml",
  "inputvalue",
  "clipboarddata"
]);

export class GameReproductionLogError extends Error {
  constructor(message, code = "invalid_game_reproduction_log") {
    super(message);
    this.name = "GameReproductionLogError";
    this.code = code;
  }
}

/**
 * Converts an arbitrary value to data that JSON.stringify cannot choke on.
 * Credential-like object keys are omitted at every depth. Accessors are never
 * invoked, so an unexpected DOM object or throwing getter cannot stop logging.
 */
export function sanitizeDiagnosticValue(value, options = {}) {
  const ancestors = new WeakSet();
  const omitUiText = options.omitUiText === true;
  const maxDepth = normalizedSanitizerLimit(options.maxDepth, DEFAULT_SANITIZER_LIMITS.maxDepth);
  const maxArrayItems = normalizedSanitizerLimit(
    options.maxArrayItems,
    DEFAULT_SANITIZER_LIMITS.maxArrayItems
  );
  const maxObjectKeys = normalizedSanitizerLimit(
    options.maxObjectKeys,
    DEFAULT_SANITIZER_LIMITS.maxObjectKeys
  );
  const maxPropertyKeyLength = normalizedSanitizerLimit(
    options.maxPropertyKeyLength,
    DEFAULT_SANITIZER_LIMITS.maxPropertyKeyLength
  );
  const maxStringLength = normalizedSanitizerLimit(
    options.maxStringLength,
    DEFAULT_SANITIZER_LIMITS.maxStringLength
  );
  const maxTotalStringLength = normalizedSanitizerLimit(
    options.maxTotalStringLength,
    DEFAULT_SANITIZER_LIMITS.maxTotalStringLength
  );
  const maxNodes = normalizedSanitizerLimit(options.maxNodes, DEFAULT_SANITIZER_LIMITS.maxNodes);
  let visitedNodes = 0;
  let retainedStringLength = 0;

  function boundedString(value) {
    const source = redactSensitiveDiagnosticText(value);
    const remaining = Math.max(0, maxTotalStringLength - retainedStringLength);
    const limit = Math.min(maxStringLength, remaining);
    if (source.length <= limit) {
      retainedStringLength += source.length;
      return source;
    }
    retainedStringLength += limit;
    return `${source.slice(0, limit)}…[truncated originalLength=${source.length} digest=${digestText(source)}]`;
  }

  function visit(current, depth = 0) {
    visitedNodes += 1;
    if (visitedNodes > maxNodes) {
      return truncationMarker("truncated-nodes", { retainedNodes: maxNodes });
    }
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") return boundedString(current);
    if (typeof current === "number") {
      if (Number.isFinite(current)) return current;
      return taggedValue("number", String(current));
    }
    if (typeof current === "bigint") return taggedValue("bigint", boundedString(current.toString()));
    if (typeof current === "undefined") return taggedValue("undefined");
    if (typeof current === "symbol") return taggedValue("symbol", boundedString(current.description));
    if (typeof current === "function") return taggedValue("function", boundedString(current.name));
    if (typeof current !== "object") return boundedString(current);
    if (depth >= maxDepth) return truncationMarker("truncated-depth", { depth });

    if (ancestors.has(current)) return taggedValue("circular");
    ancestors.add(current);
    try {
      if (current instanceof Date) {
        let iso = null;
        try {
          iso = Number.isNaN(current.getTime()) ? null : current.toISOString();
        } catch {
          // A hostile Date subclass must not prevent the rest of the log.
        }
        return taggedValue("date", iso);
      }

      if (current instanceof RegExp) return taggedValue("regexp", boundedString(current));

      if (current instanceof Error) {
        const normalized = Object.create(null);
        normalized.name = boundedString(safePropertyString(current, "name", "Error"));
        normalized.message = boundedString(safePropertyString(current, "message", ""));
        const stack = boundedString(safePropertyString(current, "stack", ""));
        if (stack) normalized.stack = stack;
        copyDataProperties(current, normalized, visit, {
          depth,
          maxObjectKeys,
          maxPropertyKeyLength,
          omitUiText,
          skipped: new Set(["name", "message", "stack"])
        });
        return normalized;
      }

      if (current instanceof Map) {
        const entries = [];
        try {
          for (const [key, entryValue] of current.entries()) {
            if (entries.length >= maxArrayItems) break;
            if (typeof key === "string" && shouldOmitKey(key, omitUiText)) continue;
            entries.push([visit(key, depth + 1), visit(entryValue, depth + 1)]);
          }
        } catch {
          entries.push([taggedValue("unreadable"), taggedValue("unreadable")]);
        }
        if (Number.isFinite(maxArrayItems) && current.size > entries.length) {
          entries.push(truncationMarker("truncated-items", {
            originalLength: current.size,
            retainedLength: entries.length,
            retainedDigest: digestSanitizedValue(entries)
          }));
        }
        return taggedValue("map", entries);
      }

      if (current instanceof Set) {
        const values = [];
        try {
          for (const entry of current.values()) {
            if (values.length >= maxArrayItems) break;
            values.push(visit(entry, depth + 1));
          }
        } catch {
          values.push(taggedValue("unreadable"));
        }
        if (Number.isFinite(maxArrayItems) && current.size > values.length) {
          values.push(truncationMarker("truncated-items", {
            originalLength: current.size,
            retainedLength: values.length,
            retainedDigest: digestSanitizedValue(values)
          }));
        }
        return taggedValue("set", values);
      }

      if (ArrayBuffer.isView(current)) {
        let values = [];
        let originalLength = 0;
        try {
          if (Number.isFinite(Number(current.length))) {
            originalLength = Number(current.length) || 0;
            const retainedLength = Math.min(originalLength, maxArrayItems);
            for (let index = 0; index < retainedLength; index += 1) {
              values.push(visit(current[index], depth + 1));
            }
          } else {
            originalLength = Number(current.byteLength) || 0;
            const bytes = new Uint8Array(
              current.buffer,
              current.byteOffset,
              Math.min(originalLength, maxArrayItems)
            );
            for (const entry of bytes) values.push(visit(entry, depth + 1));
          }
        } catch {
          values = [taggedValue("unreadable")];
        }
        if (originalLength > values.length) {
          values.push(truncationMarker("truncated-items", {
            originalLength,
            retainedLength: values.length,
            retainedDigest: digestSanitizedValue(values)
          }));
        }
        return taggedValue(safeConstructorName(current) || "typed-array", values);
      }

      if (current instanceof ArrayBuffer) {
        let values = [];
        let originalLength = 0;
        try {
          originalLength = current.byteLength;
          values = Array.from(new Uint8Array(current, 0, Math.min(current.byteLength, maxArrayItems)));
        } catch {
          values = [taggedValue("unreadable")];
        }
        if (originalLength > values.length) {
          values.push(truncationMarker("truncated-items", {
            originalLength,
            retainedLength: values.length,
            retainedDigest: digestSanitizedValue(values)
          }));
        }
        return taggedValue("array-buffer", values);
      }

      if (Array.isArray(current)) {
        const result = [];
        let length = 0;
        try {
          length = current.length;
        } catch {
          return [taggedValue("unreadable")];
        }
        const retainedLength = Math.min(length, maxArrayItems);
        for (let index = 0; index < retainedLength; index += 1) {
          let descriptor;
          try {
            descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          } catch {
            descriptor = null;
          }
          result.push(descriptor && "value" in descriptor
            ? visit(descriptor.value, depth + 1)
            : taggedValue(descriptor ? "accessor" : "empty"));
        }
        if (retainedLength < length) {
          result.push(truncationMarker("truncated-items", {
            originalLength: length,
            retainedLength,
            retainedDigest: digestSanitizedValue(result)
          }));
        }
        return result;
      }

      const result = Object.create(null);
      copyDataProperties(current, result, visit, {
        depth,
        maxObjectKeys,
        maxPropertyKeyLength,
        omitUiText
      });
      return result;
    } catch {
      return taggedValue("unreadable", safeConstructorName(current));
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value);
}

export function digestGameState(state) {
  const safeState = sanitizeDiagnosticValue(state, STATE_SANITIZER_LIMITS);
  return digestSanitizedValue(safeState);
}

export function validateGameReportDescription(description) {
  const value = typeof description === "string" ? description.trim() : "";
  const codePointLength = Array.from(value).length;
  let code = null;
  let message = "";

  if (!value) {
    code = "description_required";
    message = "버그 설명을 입력해 주세요.";
  } else if (codePointLength < GAME_REPRODUCTION_DESCRIPTION_MIN_CODE_POINTS) {
    code = "description_too_short";
    message = `버그 설명은 최소 ${GAME_REPRODUCTION_DESCRIPTION_MIN_CODE_POINTS}자 이상 입력해 주세요.`;
  } else if (codePointLength > GAME_REPRODUCTION_DESCRIPTION_MAX_CODE_POINTS) {
    code = "description_too_long";
    message = `버그 설명은 최대 ${GAME_REPRODUCTION_DESCRIPTION_MAX_CODE_POINTS}자까지 입력할 수 있습니다.`;
  }

  return {
    valid: code === null,
    value,
    codePointLength,
    minCodePoints: GAME_REPRODUCTION_DESCRIPTION_MIN_CODE_POINTS,
    maxCodePoints: GAME_REPRODUCTION_DESCRIPTION_MAX_CODE_POINTS,
    code,
    message
  };
}

export function isValidGameReportDescription(description) {
  return validateGameReportDescription(description).valid;
}

export class GameReproductionLog {
  constructor(initialState, options = {}) {
    this._now = typeof options.now === "function" ? options.now : () => Date.now();
    this._maxUiBreadcrumbs = normalizedCap(options.maxUiBreadcrumbs, DEFAULT_MAX_UI_BREADCRUMBS);
    this._maxEvents = normalizedCap(options.maxEvents, DEFAULT_MAX_EVENTS);
    this._maxUiErrors = normalizedCap(options.maxUiErrors, DEFAULT_MAX_UI_ERRORS);
    this._maxFrames = normalizedCap(options.maxFrames, DEFAULT_MAX_FRAMES);
    this._maxCommands = normalizedCap(options.maxCommands, DEFAULT_MAX_COMMANDS);
    this._maxCommandPartBytes = normalizedCap(
      options.maxCommandPartBytes,
      DEFAULT_MAX_COMMAND_PART_BYTES
    );

    const createdAt = timestampFrom(this._now);
    const initialCheckpoint = stateCheckpoint(initialState, "initial", createdAt, 0);
    this._data = {
      schemaVersion: GAME_REPRODUCTION_LOG_SCHEMA_VERSION,
      logId: safeLogId(options.logId, createdAt),
      createdAt,
      updatedAt: createdAt,
      metadata: sanitizeDiagnosticValue(options.metadata || {}),
      initialState: initialCheckpoint,
      latestState: checkpointWithSharedState(initialCheckpoint),
      frames: [],
      droppedFrames: 0,
      commands: [],
      droppedCommands: 0,
      lastCommandSequence: 0,
      events: [],
      droppedEvents: 0,
      ui: {
        breadcrumbs: [],
        droppedBreadcrumbs: 0,
        errors: [],
        droppedErrors: 0
      },
      onlineSnapshots: [],
      droppedOnlineSnapshots: 0,
      finalization: null
    };
    this._commandSequence = 0;
    this._eventSequence = 0;
    this._breadcrumbSequence = 0;
    this._uiErrorSequence = 0;
    this._onlineSnapshotSequence = 0;
    this._frameSequence = 0;
    this._pushFrame(initialCheckpoint, 0);
  }

  recordCommand(command, outcome = {}) {
    const at = this._touch();
    const outcomeObject = readCommandOutcome(outcome);
    const status = normalizeCommandStatus(outcomeObject);
    const beforeStateDigest = this._data.latestState.digest;
    const hasNextState = Object.prototype.hasOwnProperty.call(outcomeObject, "state");

    if (hasNextState) this._setLatestState(outcomeObject.state, "command", at, this._commandSequence + 1);

    const entry = {
      sequence: ++this._commandSequence,
      at,
      status,
      command: boundedCommandValue(command, this._maxCommandPartBytes),
      beforeStateDigest,
      afterStateDigest: this._data.latestState.digest
    };
    this._data.lastCommandSequence = this._commandSequence;

    if (Object.prototype.hasOwnProperty.call(outcomeObject, "context")) {
      entry.context = boundedCommandValue(outcomeObject.context, this._maxCommandPartBytes);
    }
    if (status === "success" && Object.prototype.hasOwnProperty.call(outcomeObject, "result")) {
      entry.result = boundedCommandValue(outcomeObject.result, this._maxCommandPartBytes);
    }
    if (status === "rejected") {
      const safeReason = sanitizeDiagnosticValue(
        outcomeObject.reason || outcomeObject.message || "rejected",
        COMMAND_PART_SANITIZER_LIMITS
      );
      entry.reason = truncateString(
        safeString(safeReason),
        DEFAULT_MAX_COMMAND_STRING_LENGTH
      );
    }
    if (status === "exception") {
      entry.error = boundedCommandError(
        outcomeObject.error || outcomeObject.exception || commandOutcomeErrorFallback(outcomeObject),
        this._maxCommandPartBytes
      );
    }

    cappedPush(this._data.commands, entry, this._maxCommands, () => {
      this._data.droppedCommands += 1;
    });
    return cloneSafeValue(entry);
  }

  recordCommandSuccess(command, state, result = null, context = null) {
    return this.recordCommand(command, { status: "success", state, result, context });
  }

  recordCommandRejection(command, reason, state, context = null) {
    return this.recordCommand(command, { status: "rejected", state, reason, context });
  }

  recordCommandException(command, error, state, context = null) {
    return this.recordCommand(command, { status: "exception", state, error, context });
  }

  recordEvent(type, detail = {}, state) {
    const at = this._touch();
    if (arguments.length >= 3) this._setLatestState(state, "event", at, this._commandSequence);
    const entry = {
      sequence: ++this._eventSequence,
      at,
      type: safeString(type || "event"),
      detail: sanitizeDiagnosticValue(detail),
      stateDigest: this._data.latestState.digest
    };
    cappedPush(this._data.events, entry, this._maxEvents, () => {
      this._data.droppedEvents += 1;
    });
    return cloneSafeValue(entry);
  }

  recordUiBreadcrumb(breadcrumb = {}) {
    const at = this._touch();
    const entry = {
      sequence: ++this._breadcrumbSequence,
      at,
      detail: sanitizeDiagnosticValue(breadcrumb, { omitUiText: true }),
      stateDigest: this._data.latestState.digest
    };
    cappedPush(this._data.ui.breadcrumbs, entry, this._maxUiBreadcrumbs, () => {
      this._data.ui.droppedBreadcrumbs += 1;
    });
    return cloneSafeValue(entry);
  }

  recordUiError(error, context = {}, state) {
    const at = this._touch();
    if (arguments.length >= 3) this._setLatestState(state, "ui-error", at, this._commandSequence);
    const checkpoint = checkpointWithSharedState(this._data.latestState, {
      label: "ui-error",
      capturedAt: at
    });
    const entry = {
      sequence: ++this._uiErrorSequence,
      at,
      error: normalizeError(error),
      context: sanitizeDiagnosticValue(context, { omitUiText: true }),
      stateCheckpoint: checkpoint
    };
    cappedPush(this._data.ui.errors, entry, this._maxUiErrors, () => {
      this._data.ui.droppedErrors += 1;
    });
    return cloneSafeValue(entry);
  }

  recordUiException(error, context = {}, state) {
    return arguments.length >= 3
      ? this.recordUiError(error, context, state)
      : this.recordUiError(error, context);
  }

  markOnlineSnapshot(marker = {}, state) {
    const at = this._touch();
    if (arguments.length >= 2) this._setLatestState(state, "online-snapshot", at, this._commandSequence);
    const entry = {
      sequence: ++this._onlineSnapshotSequence,
      at,
      marker: sanitizeDiagnosticValue(marker),
      commandSequence: this._commandSequence,
      stateDigest: this._data.latestState.digest
    };
    cappedPush(this._data.onlineSnapshots, entry, this._maxEvents, () => {
      this._data.droppedOnlineSnapshots += 1;
    });
    return cloneSafeValue(entry);
  }

  checkpoint(state, label = "checkpoint", options = {}) {
    const at = this._touch();
    this._setLatestState(state, safeString(label || "checkpoint"), at, this._commandSequence);
    return options.cloneResult === false ? null : cloneSafeValue(this._data.latestState);
  }

  finalize(reason = GAME_REPRODUCTION_END_REASONS.NORMAL, finalState, details = {}) {
    let resolvedReason = reason;
    let resolvedState = finalState;
    let resolvedDetails = details;
    if (isPlainRecord(reason)) {
      resolvedReason = reason.reason || GAME_REPRODUCTION_END_REASONS.NORMAL;
      resolvedState = Object.prototype.hasOwnProperty.call(reason, "state") ? reason.state : undefined;
      resolvedDetails = reason.details || {};
    }
    resolvedReason = normalizeEndReason(resolvedReason);
    if (!VALID_END_REASONS.has(resolvedReason)) {
      throw new GameReproductionLogError(
        `Unknown game end reason: ${safeString(resolvedReason)}`,
        "invalid_end_reason"
      );
    }

    const at = this._touch();
    if (resolvedState !== undefined) {
      this._setLatestState(resolvedState, "final", at, this._commandSequence);
    }
    this._data.finalization = {
      reason: resolvedReason,
      at,
      commandSequence: this._commandSequence,
      stateDigest: this._data.latestState.digest,
      details: sanitizeDiagnosticValue(resolvedDetails)
    };
    return cloneSafeValue(this._data.finalization);
  }

  snapshot() {
    return cloneSafeValue(this._data);
  }

  isFinalized() {
    return Boolean(this._data.finalization);
  }

  summary() {
    return cloneSafeValue({
      logId: this._data.logId,
      metadata: this._data.metadata,
      finalization: this._data.finalization
    });
  }

  serialize() {
    return this._serializeSafeData();
  }

  saveToStorage(storage, key) {
    return saveGameReproductionLogToStorage(storage, key, this);
  }

  toJSON() {
    return this.snapshot();
  }

  _serializeSafeData() {
    assertLogShape(this._data);
    return JSON.stringify(this._data);
  }

  _touch() {
    const at = timestampFrom(this._now);
    this._data.updatedAt = at;
    return at;
  }

  _setLatestState(state, label, at, sequence) {
    this._data.latestState = stateCheckpoint(state, label, at, sequence);
    this._pushFrame(this._data.latestState, sequence);
  }

  _pushFrame(checkpoint, commandSequence) {
    const frame = {
      label: checkpoint.label,
      sequence: this._frameSequence,
      commandSequence: nonNegativeInteger(commandSequence),
      capturedAt: checkpoint.capturedAt,
      digest: checkpoint.digest,
      state: checkpoint.state
    };
    this._frameSequence += 1;
    cappedPush(this._data.frames, frame, this._maxFrames, () => {
      this._data.droppedFrames += 1;
    });
  }

  static restore(serialized, options = {}) {
    const parsed = parseSerializedLog(serialized);
    const recorder = Object.create(GameReproductionLog.prototype);
    recorder._now = typeof options.now === "function" ? options.now : () => Date.now();
    recorder._maxUiBreadcrumbs = normalizedCap(options.maxUiBreadcrumbs, DEFAULT_MAX_UI_BREADCRUMBS);
    recorder._maxEvents = normalizedCap(options.maxEvents, DEFAULT_MAX_EVENTS);
    recorder._maxUiErrors = normalizedCap(options.maxUiErrors, DEFAULT_MAX_UI_ERRORS);
    recorder._maxFrames = normalizedCap(options.maxFrames, DEFAULT_MAX_FRAMES);
    recorder._maxCommands = normalizedCap(options.maxCommands, DEFAULT_MAX_COMMANDS);
    recorder._maxCommandPartBytes = normalizedCap(
      options.maxCommandPartBytes,
      DEFAULT_MAX_COMMAND_PART_BYTES
    );
    recorder._data = normalizedRestoredLog(parsed);

    recorder._commandSequence = Math.max(
      nonNegativeInteger(recorder._data.lastCommandSequence),
      nonNegativeInteger(recorder._data.finalization?.commandSequence),
      maximumSequence(recorder._data.commands)
    );
    recorder._eventSequence = maximumSequence(recorder._data.events);
    recorder._breadcrumbSequence = maximumSequence(recorder._data.ui.breadcrumbs);
    recorder._uiErrorSequence = maximumSequence(recorder._data.ui.errors);
    recorder._onlineSnapshotSequence = maximumSequence(recorder._data.onlineSnapshots);
    recorder._frameSequence = maximumSequence(recorder._data.frames) + 1;

    trimRestoredEntries(recorder._data.events, recorder._maxEvents, (count) => {
      recorder._data.droppedEvents += count;
    });
    trimRestoredEntries(recorder._data.ui.breadcrumbs, recorder._maxUiBreadcrumbs, (count) => {
      recorder._data.ui.droppedBreadcrumbs += count;
    });
    trimRestoredEntries(recorder._data.ui.errors, recorder._maxUiErrors, (count) => {
      recorder._data.ui.droppedErrors += count;
    });
    trimRestoredEntries(recorder._data.onlineSnapshots, recorder._maxEvents, (count) => {
      recorder._data.droppedOnlineSnapshots += count;
    });
    trimRestoredEntries(recorder._data.frames, recorder._maxFrames, (count) => {
      recorder._data.droppedFrames += count;
    });
    trimRestoredEntries(recorder._data.commands, recorder._maxCommands, (count) => {
      recorder._data.droppedCommands += count;
    });
    return recorder;
  }
}

export function createGameReproductionLog(initialState, options = {}) {
  return new GameReproductionLog(initialState, options);
}

export function serializeGameReproductionLog(log) {
  if (log instanceof GameReproductionLog) return log._serializeSafeData();
  const data = sanitizeDiagnosticValue(log, LOG_SANITIZER_LIMITS);
  assertLogShape(data);
  return JSON.stringify(data);
}

export function deserializeGameReproductionLog(serialized) {
  return cloneSafeValue(parseSerializedLog(serialized));
}

export function restoreGameReproductionLog(serialized, options = {}) {
  return GameReproductionLog.restore(serialized, options);
}

export function saveGameReproductionLogToStorage(storage, key, log) {
  if (!storage || typeof storage.setItem !== "function") {
    throw new GameReproductionLogError("A localStorage-compatible store is required.", "invalid_storage");
  }
  const serialized = serializeGameReproductionLog(log);
  storage.setItem(safeString(key), serialized);
  return serialized;
}

export function restoreGameReproductionLogFromStorage(storage, key, options = {}) {
  if (!storage || typeof storage.getItem !== "function") {
    throw new GameReproductionLogError("A localStorage-compatible store is required.", "invalid_storage");
  }
  const serialized = storage.getItem(safeString(key));
  if (serialized === null || serialized === undefined || serialized === "") return null;
  return restoreGameReproductionLog(serialized, options);
}

export function createGameLogSubmissionPayload(log, description, metadata = {}) {
  const validation = validateGameReportDescription(description);
  if (!validation.valid) {
    throw new GameReproductionLogError(validation.message, validation.code);
  }

  const serializedLog = serializeGameReproductionLog(log);
  const parsedLog = JSON.parse(serializedLog);
  if (!parsedLog.finalization) {
    throw new GameReproductionLogError(
      "경기를 종료한 후에만 버그 로그를 전송할 수 있습니다.",
      "game_not_finalized"
    );
  }
  return {
    schemaVersion: GAME_REPRODUCTION_LOG_SCHEMA_VERSION,
    description: validation.value,
    descriptionCodePointLength: validation.codePointLength,
    metadata: sanitizeDiagnosticValue(metadata),
    log: parsedLog
  };
}

export const createGameReproductionSubmissionPayload = createGameLogSubmissionPayload;
export const validateReproductionDescription = validateGameReportDescription;

function normalizedRestoredLog(parsed) {
  const restored = parsed;
  assertLogShape(restored);
  restored.commands = Array.isArray(restored.commands) ? restored.commands : [];
  restored.droppedCommands = nonNegativeInteger(restored.droppedCommands);
  restored.lastCommandSequence = Math.max(
    nonNegativeInteger(restored.lastCommandSequence),
    nonNegativeInteger(restored.finalization?.commandSequence),
    maximumSequence(restored.commands)
  );
  restored.events = Array.isArray(restored.events) ? restored.events : [];
  restored.onlineSnapshots = Array.isArray(restored.onlineSnapshots) ? restored.onlineSnapshots : [];
  restored.frames = Array.isArray(restored.frames) ? restored.frames : [];
  restored.droppedFrames = nonNegativeInteger(restored.droppedFrames);
  restored.droppedEvents = nonNegativeInteger(restored.droppedEvents);
  restored.droppedOnlineSnapshots = nonNegativeInteger(restored.droppedOnlineSnapshots);
  restored.ui = isPlainRecord(restored.ui) ? restored.ui : Object.create(null);
  restored.ui.breadcrumbs = Array.isArray(restored.ui.breadcrumbs) ? restored.ui.breadcrumbs : [];
  restored.ui.errors = Array.isArray(restored.ui.errors) ? restored.ui.errors : [];
  restored.ui.droppedBreadcrumbs = nonNegativeInteger(restored.ui.droppedBreadcrumbs);
  restored.ui.droppedErrors = nonNegativeInteger(restored.ui.droppedErrors);
  return restored;
}

function parseSerializedLog(serialized) {
  let parsed;
  try {
    parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch {
    throw new GameReproductionLogError("The saved game log is not valid JSON.", "invalid_serialized_log");
  }
  const safeParsed = sanitizeDiagnosticValue(parsed, LOG_SANITIZER_LIMITS);
  assertLogShape(safeParsed);
  return safeParsed;
}

function assertLogShape(data) {
  if (!isPlainRecord(data) || data.schemaVersion !== GAME_REPRODUCTION_LOG_SCHEMA_VERSION) {
    throw new GameReproductionLogError("Unsupported game reproduction log schema.", "unsupported_schema");
  }
  if (!isPlainRecord(data.initialState) || !isPlainRecord(data.latestState)) {
    throw new GameReproductionLogError("The game reproduction log has no state checkpoints.", "invalid_log_shape");
  }
}

function stateCheckpoint(state, label, capturedAt, sequence) {
  const safeState = sanitizeDiagnosticValue(state, STATE_SANITIZER_LIMITS);
  return {
    label,
    sequence: nonNegativeInteger(sequence),
    capturedAt,
    digest: digestSanitizedValue(safeState),
    state: safeState
  };
}

function checkpointWithSharedState(checkpoint, overrides = {}) {
  // The sanitized state tree stays internal; public accessors clone it before returning.
  return {
    label: Object.prototype.hasOwnProperty.call(overrides, "label")
      ? overrides.label
      : checkpoint.label,
    sequence: Object.prototype.hasOwnProperty.call(overrides, "sequence")
      ? overrides.sequence
      : checkpoint.sequence,
    capturedAt: Object.prototype.hasOwnProperty.call(overrides, "capturedAt")
      ? overrides.capturedAt
      : checkpoint.capturedAt,
    digest: checkpoint.digest,
    state: checkpoint.state
  };
}

function digestSanitizedValue(value) {
  const text = stableStringify(value);
  return digestText(text);
}

function digestText(text) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
    second ^= second >>> 13;
  }
  return `js-v1:${hex32(first)}${hex32(second)}`;
}

function boundedCommandValue(value, maxBytes) {
  const safeValue = sanitizeDiagnosticValue(value, COMMAND_PART_SANITIZER_LIMITS);
  return boundSanitizedCommandValue(safeValue, maxBytes);
}

function boundedCommandError(error, maxBytes) {
  const safeError = sanitizeDiagnosticValue(error, COMMAND_PART_SANITIZER_LIMITS);
  return boundSanitizedCommandValue(normalizeSanitizedError(safeError), maxBytes);
}

function boundSanitizedCommandValue(safeValue, maxBytes) {
  let serialized = "";
  try {
    serialized = JSON.stringify(safeValue);
  } catch {
    return taggedValue("unreadable-command-part");
  }
  const byteLength = utf8ByteLength(serialized);
  if (byteLength <= maxBytes) return safeValue;

  const truncated = taggedValue("truncated-command-part");
  truncated.byteLength = byteLength;
  truncated.digest = digestSanitizedValue(safeValue);
  if (isPlainRecord(safeValue) && typeof safeValue.kind === "string") {
    truncated.kind = truncateString(safeValue.kind, 120);
  }
  return truncated;
}

function readCommandOutcome(outcome) {
  const result = Object.create(null);
  if (outcome === null || typeof outcome !== "object") return result;
  try {
    if (Array.isArray(outcome)) return result;
  } catch {
    return result;
  }

  for (const key of COMMAND_OUTCOME_KEYS) {
    // Inspect only the fixed command contract and never invoke an outcome accessor.
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(outcome, key);
    } catch {
      descriptor = null;
    }
    if (!descriptor || descriptor.enumerable === false) continue;
    defineSafeProperty(
      result,
      key,
      "value" in descriptor ? descriptor.value : taggedValue("accessor")
    );
  }
  return result;
}

function commandOutcomeErrorFallback(outcome) {
  const result = Object.create(null);
  for (const key of ["name", "message", "reason", "stack"]) {
    if (Object.prototype.hasOwnProperty.call(outcome, key)) {
      defineSafeProperty(result, key, outcome[key]);
    }
  }
  return result;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function copyDataProperties(source, destination, visit, options) {
  let keys;
  try {
    keys = Reflect.ownKeys(source);
  } catch {
    destination.unreadable = taggedValue("unreadable");
    return;
  }

  let retainedKeys = 0;
  for (const propertyKey of keys) {
    if (typeof propertyKey !== "string") continue;
    if (options.skipped?.has(propertyKey) || shouldOmitKey(propertyKey, options.omitUiText)) continue;
    if (retainedKeys >= options.maxObjectKeys) {
      defineSafeProperty(destination, "__riftboundDiagnosticTruncatedKeys", truncationMarker(
        "truncated-keys",
        {
          originalLength: keys.length,
          retainedLength: retainedKeys,
          retainedDigest: digestSanitizedValue(destination)
        }
      ));
      break;
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(source, propertyKey);
    } catch {
      descriptor = null;
    }
    if (!descriptor || descriptor.enumerable === false) continue;
    const cloned = "value" in descriptor
      ? visit(descriptor.value, options.depth + 1)
      : taggedValue("accessor");
    defineSafeProperty(
      destination,
      boundedPropertyKey(propertyKey, options.maxPropertyKeyLength),
      cloned
    );
    retainedKeys += 1;
  }
}

function shouldOmitKey(key, omitUiText) {
  const normalized = normalizeKey(key);
  if (isSecretKey(normalized)) return true;
  return omitUiText && (UI_TEXT_KEYS.has(normalized) || normalized === "data");
}

function isSecretKey(normalizedKey) {
  if (!normalizedKey) return false;
  if (EXACT_SECRET_KEYS.has(normalizedKey)) return true;
  if (normalizedKey.includes("password") || normalizedKey.includes("passwd")
    || normalizedKey.includes("passphrase") || normalizedKey.includes("secret")) return true;
  return /^(?:access|refresh|auth|bearer|identity|id|session|csrf|xsrf|player|account|admin)token$/u.test(normalizedKey)
    || /^(?:api|client|app|private)key$/u.test(normalizedKey)
    || /^(?:proxy)?authorizationheader$/u.test(normalizedKey)
    || /^(?:session|auth|account)?cookie$/u.test(normalizedKey);
}

function normalizeKey(key) {
  return safeString(key).toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function normalizeError(error) {
  const safeError = sanitizeDiagnosticValue(error);
  return normalizeSanitizedError(safeError);
}

function normalizeSanitizedError(safeError) {
  if (isPlainRecord(safeError)) {
    return {
      name: truncateString(safeString(safeError.name || "Error"), 512),
      message: safeString(safeError.message || safeError.reason || ""),
      ...(safeError.stack ? {
        stack: safeString(safeError.stack)
      } : {})
    };
  }
  return {
    name: "Error",
    message: safeString(safeError)
  };
}

function normalizeCommandStatus(outcome) {
  const safeStatus = Object.prototype.hasOwnProperty.call(outcome, "status")
    ? sanitizeDiagnosticValue(outcome.status, COMMAND_PART_SANITIZER_LIMITS)
    : "";
  const rawStatus = safeString(safeStatus || "").toLowerCase();
  if (["exception", "error", "threw", "failed"].includes(rawStatus)
    || Object.prototype.hasOwnProperty.call(outcome, "error")
    || Object.prototype.hasOwnProperty.call(outcome, "exception")) return "exception";
  if (["rejected", "reject", "denied", "invalid"].includes(rawStatus)
    || outcome.rejected === true || outcome.ok === false) return "rejected";
  return "success";
}

function normalizeEndReason(reason) {
  const normalized = safeString(reason).trim().toLowerCase().replace(/_/gu, "-");
  if (["completed", "complete", "finished", "finish"].includes(normalized)) return "normal";
  if (["resign", "resigned", "concede", "conceded"].includes(normalized)) return "surrender";
  if (["uierror", "ui-exception"].includes(normalized)) return "ui-error";
  return normalized;
}

function cloneSafeValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function taggedValue(type, value) {
  const tagged = Object.create(null);
  tagged[SERIALIZED_TYPE_KEY] = type;
  if (arguments.length >= 2) tagged.value = value;
  return tagged;
}

function truncationMarker(type, metadata = {}) {
  const marker = taggedValue(type);
  for (const [key, value] of Object.entries(metadata)) marker[key] = value;
  marker.digest ||= digestText(stableStringify(metadata));
  return marker;
}

function defineSafeProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    enumerable: true,
    writable: true
  });
}

function safePropertyString(object, key, fallback) {
  try {
    return safeString(object[key] ?? fallback);
  } catch {
    return fallback;
  }
}

function safeConstructorName(value) {
  try {
    return safeString(value?.constructor?.name || "object");
  } catch {
    return "object";
  }
}

function safeString(value) {
  try {
    return String(value ?? "");
  } catch {
    return "[unprintable]";
  }
}

function redactSensitiveDiagnosticText(value) {
  return safeString(value)
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu, REDACTED_DIAGNOSTIC_TEXT)
    .replace(/(\b(?:password|passwd|passphrase|authorization(?:[-_ ]?header)?|proxy[-_ ]?authorization(?:[-_ ]?header)?|token|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|identity[-_ ]?token|id[-_ ]?token|session[-_ ]?token|csrf[-_ ]?token|xsrf[-_ ]?token|player[-_ ]?token|account[-_ ]?token|admin[-_ ]?token|api[-_ ]?key|client[-_ ]?key|app[-_ ]?key|private[-_ ]?key|cookie|session[-_ ]?cookie|set[-_ ]?cookie|secret|credentials?|jwt)\b\s*["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?([^\s,;}\]"']+)/giu, `$1${REDACTED_DIAGNOSTIC_TEXT}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9!#$%&'*+\-.^_`|~:/=]+/giu, `$1 ${REDACTED_DIAGNOSTIC_TEXT}`)
    .replace(/([?&](?:token|access_token|refresh_token|auth_token|session_token|player_token|api_key|secret)=)[^&#\s]+/giu, `$1${REDACTED_DIAGNOSTIC_TEXT}`)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, REDACTED_DIAGNOSTIC_TEXT);
}

function safeLogId(logId, createdAt) {
  const supplied = safeString(logId).trim();
  if (supplied) return supplied;
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to an identifier that works in older WebViews.
  }
  return `game-${createdAt}-${Math.random().toString(36).slice(2, 12)}`;
}

function timestampFrom(now) {
  let value;
  try {
    value = now();
  } catch {
    value = Date.now();
  }
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Use the real clock when an injected diagnostic clock misbehaves.
  }
  return new Date().toISOString();
}

function cappedPush(items, value, cap, onDrop) {
  if (cap === 0) {
    onDrop();
    return;
  }
  items.push(value);
  if (items.length <= cap) return;
  items.splice(0, items.length - cap);
  onDrop();
}

function trimRestoredEntries(items, cap, onDrop) {
  if (items.length <= cap) return;
  const dropped = items.length - cap;
  items.splice(0, dropped);
  onDrop(dropped);
}

function normalizedCap(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function normalizedSanitizerLimit(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function truncateString(value, maximumLength) {
  const source = redactSensitiveDiagnosticText(value);
  if (source.length <= maximumLength) return source;
  return `${source.slice(0, maximumLength)}…[truncated originalLength=${source.length} digest=${digestText(source)}]`;
}

function boundedPropertyKey(value, maximumLength) {
  const source = redactSensitiveDiagnosticText(value);
  if (source.length <= maximumLength) return source;
  const digest = digestText(source).slice("js-v1:".length);
  const suffix = `…[key:${source.length}:${digest}]`;
  return `${source.slice(0, Math.max(0, maximumLength - suffix.length))}${suffix}`;
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of safeString(value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function maximumSequence(entries) {
  return entries.reduce((maximum, entry) =>
    Math.max(maximum, nonNegativeInteger(entry?.sequence)), 0);
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hex32(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}
