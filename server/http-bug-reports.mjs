import { accountStore, bearerToken } from "./accounts.mjs";
import { BugReportError, bugReportStore } from "./bug-reports.mjs";
import { diagnosticLogForSeat } from "./rooms.mjs";

const REPORT_REQUEST_LIMIT_BYTES = 12 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMISSIONS = 10;
const DEFAULT_RATE_LIMIT_MAX_ENTRIES = 2048;
const RATE_LIMIT_MAX_ENTRIES_ENV = "RIFTBOUND_BUG_REPORT_RATE_LIMIT_MAX_ENTRIES";
const TRUST_PROXY_ENV = "RIFTBOUND_BUG_REPORT_TRUST_PROXY";
const OVERFLOW_RATE_LIMIT_KEY = Symbol("bug-report-rate-limit-overflow");
const VALID_GAME_END_REASONS = new Set(["normal", "surrender", "ui-error"]);

export function createBugReportRequestHandler(options = {}) {
  const store = options.store || bugReportStore;
  const accounts = options.accounts || accountStore;
  const authoritativeLookup = options.authoritativeLookup || diagnosticLogForSeat;
  const submissionsByAddress = new Map();
  const rateLimitMaxEntries = configuredPositiveInteger(
    options.rateLimitMaxEntries,
    RATE_LIMIT_MAX_ENTRIES_ENV,
    DEFAULT_RATE_LIMIT_MAX_ENTRIES
  );
  const trustProxy = Object.hasOwn(options, "trustProxy")
    ? options.trustProxy === true
    : configuredBoolean(TRUST_PROXY_ENV, false);

  return async function handleBugReportRequest(req, res, helpers) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const isSubmission = url.pathname === "/api/bug-reports";
    const isAdminRoute = url.pathname === "/api/admin/bug-reports"
      || /^\/api\/admin\/bug-reports\/[^/]+$/u.test(url.pathname);
    if (!isSubmission && !isAdminRoute) return false;

    try {
      if (isSubmission) {
        if (req.method !== "POST") {
          return helpers.json(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
        }
        enforceSubmissionRateLimit(
          submissionsByAddress,
          requestAddress(req, trustProxy),
          options.now?.() ?? Date.now(),
          rateLimitMaxEntries
        );
        const body = await helpers.readJson(req, REPORT_REQUEST_LIMIT_BYTES);
        assertGameLogPayload(body);
        const onlineContext = body?.onlineContext && typeof body.onlineContext === "object"
          ? body.onlineContext
          : null;
        const authoritative = onlineContext
          ? authoritativeLookup(
            onlineContext.roomId,
            onlineContext.playerToken,
            onlineContext.gameNumber,
            onlineContext.diagnosticGameId
          )
          : null;
        const reporter = await optionalReporter(accounts, bearerToken(req));
        const { onlineContext: ignoredOnlineContext, serverContext: ignoredServerContext, ...clientPayload } = body || {};
        const submitted = await store.submit({
          ...clientPayload,
          serverContext: {
            reporter,
            authoritative: authoritative || null
          }
        });
        return helpers.json(res, 201, {
          ok: true,
          reportId: submitted.id,
          submittedAt: submitted.submittedAt
        });
      }

      store.requireAdmin(bearerToken(req));
      if (req.method !== "GET") {
        return helpers.json(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
      }
      if (url.pathname === "/api/admin/bug-reports") {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
        const reports = await store.list({ limit });
        return helpers.json(res, 200, { ok: true, reports });
      }
      const reportId = decodeURIComponent(url.pathname.slice("/api/admin/bug-reports/".length));
      const report = await store.get(reportId);
      if (!report) {
        return helpers.json(res, 404, { ok: false, code: "report_not_found", message: "Bug report was not found." });
      }
      return helpers.json(res, 200, { ok: true, report });
    } catch (error) {
      const status = error instanceof BugReportError
        ? error.status
        : Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      return helpers.json(res, status, {
        ok: false,
        code: error instanceof BugReportError
          ? error.code
          : error?.code || (error instanceof SyntaxError ? "invalid_json" : "server_error"),
        message: status >= 500 ? "Server error." : (error?.message || "Invalid bug report request.")
      });
    }
  };
}

export const handleBugReportRequest = createBugReportRequestHandler();

async function optionalReporter(accounts, token) {
  if (!token) return null;
  try {
    const account = await accounts.account(token);
    return account?.user ? {
      id: account.user.id,
      accountId: account.user.accountId
    } : null;
  } catch {
    return null;
  }
}

function requestAddress(req, trustProxy = false) {
  const remoteAddress = String(req?.socket?.remoteAddress || "");
  const forwardedAddress = String(req?.headers?.["x-forwarded-for"] || "");
  const trustedForwardedAddress = trustProxy && forwardedAddress && isLoopbackAddress(remoteAddress)
    ? forwardedAddress
    : "";
  const forwardedClient = String(trustedForwardedAddress)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return String(forwardedClient || remoteAddress || "unknown")
    .trim()
    .slice(0, 120);
}

function isLoopbackAddress(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(address || "").toLowerCase());
}

function enforceSubmissionRateLimit(entries, address, now, maximumEntries) {
  let key = address;
  if (!entries.has(key) && entries.size >= Math.max(0, maximumEntries - 1)) {
    pruneExpiredRateLimits(entries, now);
    if (!entries.has(key) && entries.size >= Math.max(0, maximumEntries - 1)) {
      key = OVERFLOW_RATE_LIMIT_KEY;
    }
  }
  const recent = (entries.get(key) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_SUBMISSIONS) {
    throw new BugReportError("Too many bug reports were submitted. Please try again later.", 429, "rate_limited");
  }
  recent.push(now);
  entries.set(key, recent);
}

function pruneExpiredRateLimits(entries, now) {
  for (const [key, timestamps] of entries) {
    if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) entries.delete(key);
  }
}

function configuredPositiveInteger(optionValue, environmentName, fallback) {
  const value = optionValue ?? process.env[environmentName];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(`${environmentName} must be a positive integer.`);
  }
  return number;
}

function configuredBoolean(environmentName, fallback) {
  const value = process.env[environmentName];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLocaleLowerCase("en-US"));
}

function assertGameLogPayload(body) {
  const log = body?.log;
  if (!isPlainObject(body)
    || body.schemaVersion !== 1
    || !isPlainObject(log)
    || log.schemaVersion !== 1
    || !isPlainObject(log.initialState)
    || !isPlainObject(log.latestState)
    || !isPlainObject(log.finalization)
    || !VALID_GAME_END_REASONS.has(log.finalization.reason)) {
    throw new BugReportError(
      "A finalized game reproduction log is required.",
      400,
      "invalid_game_log"
    );
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
