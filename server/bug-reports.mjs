import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN_ENV = "RIFTBOUND_BUG_REPORT_ADMIN_TOKEN";
const DATA_DIR_ENV = "RIFTBOUND_BUG_REPORT_DATA_DIR";
const MAX_REPORT_COUNT_ENV = "RIFTBOUND_BUG_REPORT_MAX_COUNT";
const MAX_TOTAL_BYTES_ENV = "RIFTBOUND_BUG_REPORT_MAX_TOTAL_BYTES";
const PRUNE_ON_QUOTA_ENV = "RIFTBOUND_BUG_REPORT_PRUNE_ON_QUOTA";
const REPORT_ID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const REPORT_ID_PATTERN = new RegExp(`^${REPORT_ID_SOURCE}$`, "iu");
const REPORT_FILE_PATTERN = new RegExp(`^(?:(\\d{8}T\\d{9}Z)-)?(${REPORT_ID_SOURCE})\\.json$`, "iu");
const RESERVED_REPORT_KEYS = new Set(["id", "reportId", "submittedAt", "receivedAt", "description"]);
const REDACTED = "[REDACTED]";
const MAX_STORED_OBJECT_KEY_LENGTH = 512;
const TRUNCATED_KEY_SUFFIX = "…[truncated]";
const EXACT_SENSITIVE_KEYS = new Set([
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
const MAX_STRUCTURE_DEPTH = 100;

export const DEFAULT_MAX_BUG_REPORT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_BUG_REPORT_COUNT = 1000;
export const DEFAULT_MAX_BUG_REPORT_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MIN_BUG_REPORT_DESCRIPTION_LENGTH = 10;
export const MAX_BUG_REPORT_DESCRIPTION_LENGTH = 2000;

export class BugReportError extends Error {
  constructor(message, status = 400, code = "bug_report_error", options = undefined) {
    super(message, options);
    this.name = "BugReportError";
    this.status = status;
    this.code = code;
  }
}

export class BugReportStore {
  constructor(options = {}) {
    const configuredRoot = options.rootDir || options.dataDir || process.env[DATA_DIR_ENV];
    this.rootDir = path.resolve(configuredRoot || path.join(projectRoot, "data", "bug-reports"));
    this.maxJsonBytes = positiveInteger(
      options.maxJsonBytes ?? options.maxBytes ?? DEFAULT_MAX_BUG_REPORT_BYTES,
      "maxJsonBytes"
    );
    this.maxReportCount = positiveInteger(
      options.maxReportCount ?? options.maxReports ?? environmentInteger(MAX_REPORT_COUNT_ENV, DEFAULT_MAX_BUG_REPORT_COUNT),
      "maxReportCount"
    );
    this.maxTotalBytes = positiveInteger(
      options.maxTotalBytes ?? environmentInteger(MAX_TOTAL_BYTES_ENV, DEFAULT_MAX_BUG_REPORT_TOTAL_BYTES),
      "maxTotalBytes"
    );
    this.pruneOnQuota = Object.hasOwn(options, "pruneOnQuota")
      ? options.pruneOnQuota === true
      : environmentBoolean(PRUNE_ON_QUOTA_ENV, false);
    this.now = typeof options.now === "function" ? options.now : () => new Date();
    this.createId = typeof options.createId === "function" ? options.createId : randomUUID;
    this.adminToken = Object.hasOwn(options, "adminToken")
      ? options.adminToken
      : process.env[ADMIN_TOKEN_ENV];
    this.writeQueue = Promise.resolve();
  }

  async submit(payload) {
    const description = redactSensitiveText(normalizeDescription(payload));
    const sanitized = sanitizePayload(payload, this.maxJsonBytes);
    for (const key of RESERVED_REPORT_KEYS) delete sanitized[key];

    const id = String(this.createId()).toLowerCase();
    if (!REPORT_ID_PATTERN.test(id)) {
      throw new BugReportError("The server could not issue a valid bug report ID.", 500, "report_id_generation_failed");
    }
    const submittedAt = utcTimestamp(this.now());
    const report = { id, submittedAt, description, ...sanitized };
    const serialized = serializeWithinLimit(report, this.maxJsonBytes);
    await this.enqueueWrite(() => this.writeAtomic(id, submittedAt, serialized));
    return structuredClone(report);
  }

  async create(payload) {
    return this.submit(payload);
  }

  async list(options = {}) {
    const limit = listLimit(options.limit);
    const candidates = await this.storedReportFiles();
    const summaries = [];
    for (const candidate of candidates) {
      if (summaries.length >= limit) break;
      try {
        summaries.push(reportSummary(await this.readStoredReport(candidate.id, candidate.name)));
      } catch (error) {
        if (error instanceof BugReportError
          && ["invalid_stored_report", "report_not_found"].includes(error.code)) continue;
        throw error;
      }
    }
    return summaries;
  }

  async get(rawId) {
    const id = normalizeReportId(rawId);
    return structuredClone(await this.readStoredReport(id));
  }

  requireAdmin(candidateToken) {
    return requireBugReportAdminToken(candidateToken, { adminToken: this.adminToken });
  }

  async enqueueWrite(action) {
    const operation = this.writeQueue.catch(() => {}).then(action);
    this.writeQueue = operation;
    return operation;
  }

  async writeAtomic(id, submittedAt, serialized) {
    try {
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw storageError("The bug report directory could not be created.", error);
    }

    const serializedBytes = Buffer.byteLength(serialized, "utf8");
    await this.pruneForWrite(serializedBytes);
    const targetPath = this.reportPath(id, submittedAt);
    const temporaryPath = path.join(this.rootDir, `.${id}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw storageError("The bug report could not be saved.", error);
    }
  }

  async readStoredReport(id, knownFileName = "") {
    const fileName = knownFileName || await this.findStoredReportFile(id);
    if (!fileName) {
      throw new BugReportError("The requested bug report was not found.", 404, "report_not_found");
    }
    const parsedFile = parseReportFileName(fileName);
    if (!parsedFile || parsedFile.id !== id) {
      throw new BugReportError("The bug report ID is invalid.", 400, "invalid_report_id");
    }
    const filePath = path.join(this.rootDir, fileName);
    try {
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new BugReportError("The requested bug report was not found.", 404, "report_not_found");
      }
      if (info.size > this.maxJsonBytes) {
        throw new BugReportError("The stored bug report is invalid.", 500, "invalid_stored_report");
      }
      const serialized = await readFile(filePath, "utf8");
      const report = JSON.parse(serialized);
      if (!isStoredReport(report, id)) {
        throw new BugReportError("The stored bug report is invalid.", 500, "invalid_stored_report");
      }
      return report;
    } catch (error) {
      if (error instanceof BugReportError) throw error;
      if (error?.code === "ENOENT") {
        throw new BugReportError("The requested bug report was not found.", 404, "report_not_found");
      }
      if (error instanceof SyntaxError) {
        throw new BugReportError("The stored bug report is invalid.", 500, "invalid_stored_report", { cause: error });
      }
      throw storageError("The bug report could not be read.", error);
    }
  }

  async storedReportFiles(options = {}) {
    let entries;
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw storageError("Bug reports could not be listed.", error);
    }

    const reports = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = parseReportFileName(entry.name);
      if (!parsed) continue;
      let info = null;
      if (options.withStats || !parsed.sortTime) {
        try {
          info = await lstat(path.join(this.rootDir, entry.name));
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw storageError("Bug report metadata could not be read.", error);
        }
        if (!info.isFile() || info.isSymbolicLink()) continue;
      }
      reports.push({
        ...parsed,
        name: entry.name,
        sortTime: parsed.sortTime || info?.mtimeMs || 0,
        size: info?.size
      });
    }
    return reports.sort((left, right) => right.sortTime - left.sortTime || right.name.localeCompare(left.name));
  }

  async findStoredReportFile(id) {
    const matches = (await this.storedReportFiles()).filter((entry) => entry.id === id);
    return matches[0]?.name || "";
  }

  async pruneForWrite(incomingBytes) {
    if (incomingBytes > this.maxTotalBytes) {
      throw new BugReportError("Bug report storage is full.", 507, "bug_report_storage_full");
    }
    const reports = await this.storedReportFiles({ withStats: true });
    let totalBytes = reports.reduce((total, report) => total + (report.size || 0), 0);
    const exceedsQuota = () => reports.length + 1 > this.maxReportCount
      || totalBytes + incomingBytes > this.maxTotalBytes;
    if (!exceedsQuota()) return;
    if (!this.pruneOnQuota) {
      throw new BugReportError("Bug report storage is full.", 507, "bug_report_storage_full");
    }
    reports.sort((left, right) => left.sortTime - right.sortTime || left.name.localeCompare(right.name));
    while (reports.length && exceedsQuota()) {
      const oldest = reports.shift();
      try {
        await unlink(path.join(this.rootDir, oldest.name));
        totalBytes -= oldest.size || 0;
      } catch (error) {
        if (error?.code === "ENOENT") totalBytes -= oldest.size || 0;
        else throw storageError("An expired bug report could not be removed.", error);
      }
    }
    if (exceedsQuota()) {
      throw new BugReportError("Bug report storage is full.", 507, "bug_report_storage_full");
    }
  }

  reportPath(id, submittedAt = "") {
    const prefix = submittedAt ? `${fileTimestamp(submittedAt)}-` : "";
    return path.join(this.rootDir, `${prefix}${id}.json`);
  }
}

export const bugReportStore = new BugReportStore();

export async function submitBugReport(payload, options = {}) {
  return new BugReportStore(options).submit(payload);
}

export async function listBugReports(options = {}) {
  return new BugReportStore(options).list(options);
}

export async function getBugReport(id, options = {}) {
  return new BugReportStore(options).get(id);
}

export function verifyBugReportAdminToken(candidateToken, options = {}) {
  const expectedToken = configuredAdminToken(options);
  if (typeof candidateToken !== "string" || !candidateToken || !expectedToken) return false;
  const candidateHash = createHash("sha256").update(candidateToken, "utf8").digest();
  const expectedHash = createHash("sha256").update(expectedToken, "utf8").digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function requireBugReportAdminToken(candidateToken, options = {}) {
  const expectedToken = configuredAdminToken(options);
  if (!expectedToken) {
    throw new BugReportError("Bug report administration is not configured.", 503, "admin_token_not_configured");
  }
  if (!verifyBugReportAdminToken(candidateToken, { adminToken: expectedToken })) {
    throw new BugReportError("A valid bug report administrator token is required.", 401, "invalid_admin_token");
  }
  return true;
}

function normalizeDescription(payload) {
  if (!isPlainObject(payload) || typeof payload.description !== "string") {
    throw new BugReportError("A bug description is required.", 400, "invalid_description");
  }
  const description = payload.description.trim();
  const length = [...description].length;
  if (length < MIN_BUG_REPORT_DESCRIPTION_LENGTH) {
    throw new BugReportError(
      `Bug descriptions must contain at least ${MIN_BUG_REPORT_DESCRIPTION_LENGTH} characters after trimming.`,
      400,
      "description_too_short"
    );
  }
  if (length > MAX_BUG_REPORT_DESCRIPTION_LENGTH) {
    throw new BugReportError(
      `Bug descriptions must contain at most ${MAX_BUG_REPORT_DESCRIPTION_LENGTH} characters.`,
      400,
      "description_too_long"
    );
  }
  return description;
}

function sanitizePayload(payload, maxJsonBytes) {
  let rawSerialized;
  try {
    assertJsonValue(payload, new WeakSet(), 0);
    rawSerialized = JSON.stringify(payload);
  } catch (error) {
    if (error instanceof BugReportError) throw error;
    throw new BugReportError("The bug report must be a JSON-serializable object.", 400, "invalid_report_payload", { cause: error });
  }
  assertSize(Buffer.byteLength(rawSerialized, "utf8"), maxJsonBytes);
  return redactSensitiveValues(payload, 0);
}

function assertJsonValue(value, ancestors, depth) {
  if (depth > MAX_STRUCTURE_DEPTH) {
    throw new BugReportError("The bug report structure is too deeply nested.", 400, "report_too_deep");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new BugReportError("The bug report contains a non-finite number.", 400, "invalid_report_payload");
    }
    return;
  }
  if (typeof value !== "object" || (!Array.isArray(value) && !isPlainObject(value))) {
    throw new BugReportError("The bug report must contain only JSON values.", 400, "invalid_report_payload");
  }
  if (ancestors.has(value)) {
    throw new BugReportError("The bug report must not contain circular references.", 400, "invalid_report_payload");
  }
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertJsonValue(child, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function redactSensitiveValues(value, depth) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValues(item, depth + 1));
  const entries = [];
  const storedKeys = new Set();
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    const storedKey = boundedStoredKey(key);
    // Redaction and truncation can collapse attacker-controlled keys. Keep the
    // first value rather than adding a suffix derived from sensitive source text.
    if (storedKeys.has(storedKey)) continue;
    storedKeys.add(storedKey);
    entries.push([storedKey, redactSensitiveValues(child, depth + 1)]);
  }
  return Object.fromEntries(entries);
}

function boundedStoredKey(key) {
  const redacted = redactSensitiveText(String(key));
  if (redacted.length <= MAX_STORED_OBJECT_KEY_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STORED_OBJECT_KEY_LENGTH - TRUNCATED_KEY_SUFFIX.length)}${TRUNCATED_KEY_SUFFIX}`;
}

function isSensitiveKey(key) {
  const normalized = String(key).toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
  if (!normalized) return false;
  if (EXACT_SENSITIVE_KEYS.has(normalized)) return true;
  if (normalized.includes("password") || normalized.includes("passwd")
    || normalized.includes("passphrase") || normalized.includes("secret")) return true;
  return /^(?:access|refresh|auth|bearer|identity|id|session|csrf|xsrf|player|account|admin)token$/u.test(normalized)
    || /^(?:api|client|app|private)key$/u.test(normalized)
    || /^(?:proxy)?authorizationheader$/u.test(normalized)
    || /^(?:session|auth|account)?cookie$/u.test(normalized);
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu, REDACTED)
    .replace(/(\b(?:password|passwd|passphrase|authorization(?:[-_ ]?header)?|proxy[-_ ]?authorization(?:[-_ ]?header)?|token|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|identity[-_ ]?token|id[-_ ]?token|session[-_ ]?token|csrf[-_ ]?token|xsrf[-_ ]?token|player[-_ ]?token|account[-_ ]?token|admin[-_ ]?token|api[-_ ]?key|client[-_ ]?key|app[-_ ]?key|private[-_ ]?key|cookie|session[-_ ]?cookie|set[-_ ]?cookie|secret|credentials?|jwt)\b\s*["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?([^\s,;}\]"']+)/giu, `$1${REDACTED}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9!#$%&'*+\-.^_`|~:/=]+/giu, `$1 ${REDACTED}`)
    .replace(/([?&](?:token|access_token|refresh_token|auth_token|session_token|player_token|api_key|secret)=)[^&#\s]+/giu, `$1${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, REDACTED);
}

function serializeWithinLimit(value, maxJsonBytes) {
  let serialized;
  try {
    serialized = `${JSON.stringify(value)}\n`;
  } catch (error) {
    throw new BugReportError("The bug report could not be serialized.", 400, "invalid_report_payload", { cause: error });
  }
  assertSize(Buffer.byteLength(serialized, "utf8"), maxJsonBytes);
  return serialized;
}

function assertSize(size, maxJsonBytes) {
  if (size > maxJsonBytes) {
    throw new BugReportError(
      `The bug report exceeds the ${maxJsonBytes}-byte limit.`,
      413,
      "report_too_large"
    );
  }
}

function reportSummary(report) {
  return {
    id: report.id,
    submittedAt: report.submittedAt,
    description: report.description
  };
}

function parseReportFileName(fileName) {
  const match = String(fileName || "").match(REPORT_FILE_PATTERN);
  if (!match) return null;
  return {
    id: match[2].toLowerCase(),
    sortTime: match[1] ? fileTimestampToMilliseconds(match[1]) : 0
  };
}

function fileTimestamp(submittedAt) {
  return submittedAt.replace(/[-:.]/gu, "");
}

function fileTimestampToMilliseconds(value) {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/u);
  if (!match) return 0;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeReportId(value) {
  if (typeof value !== "string" || !REPORT_ID_PATTERN.test(value)) {
    throw new BugReportError("The bug report ID is invalid.", 400, "invalid_report_id");
  }
  return value.toLowerCase();
}

function isStoredReport(report, expectedId) {
  return isPlainObject(report)
    && report.id === expectedId
    && typeof report.submittedAt === "string"
    && Number.isFinite(Date.parse(report.submittedAt))
    && typeof report.description === "string";
}

function configuredAdminToken(options) {
  const configured = Object.hasOwn(options, "adminToken")
    ? options.adminToken
    : process.env[ADMIN_TOKEN_ENV];
  return typeof configured === "string" && configured ? configured : "";
}

function utcTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BugReportError("The server could not determine the submission time.", 500, "submission_time_failed");
  }
  return date.toISOString();
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function environmentInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function environmentBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLocaleLowerCase("en-US"));
}

function listLimit(value) {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new BugReportError("The bug report list limit must be between 1 and 1000.", 400, "invalid_list_limit");
  }
  return value;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function storageError(message, cause) {
  return new BugReportError(message, 500, "bug_report_storage_error", { cause });
}
