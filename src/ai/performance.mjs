const EMPTY_COUNTERS = Object.freeze({
  cloneCalls: 0,
  cloneMs: 0,
  legalCalls: 0,
  legalCandidates: 0,
  legalMs: 0,
  applyCalls: 0,
  applyMs: 0,
  inferenceCalls: 0,
  inferenceMs: 0,
  rolloutCalls: 0,
  rolloutCandidates: 0,
  rolloutSimulations: 0,
  rolloutSteps: 0,
  rolloutMs: 0,
  gcCount: 0,
  gcMs: 0
});

let enabled = false;
let counters = { ...EMPTY_COUNTERS };
let startedAt = now();
let progressObserver = null;

// These counters are emitted at computation boundaries, including inside
// synchronous searches where an event-loop heartbeat cannot run. Progress
// observation is independent of optional timing instrumentation.
export const AI_PROGRESS_COUNTERS = Object.freeze([
  "cloneCalls", "legalCalls", "applyCalls", "inferenceCalls",
  "rolloutCalls", "rolloutSimulations", "rolloutSteps",
  "productionLeafAuditCalls", "productionLeafAuditSteps"
]);
const progressKeys = new Set(AI_PROGRESS_COUNTERS);

export function observeAiProgress(callback, options = {}) {
  const observer = {
    callback,
    clock: options.clock || now,
    intervalMs: Math.max(0, Number(options.intervalMs ?? 5000) || 0),
    lastReportedAt: -Infinity,
    sequence: 0,
    counters: {}
  };
  progressObserver = observer;
  return () => {
    if (progressObserver === observer) progressObserver = null;
  };
}

export function configureAiPerformance(options = {}) {
  enabled = options === true || options?.enabled === true;
  resetAiPerformance();
  return enabled;
}

export function aiPerformanceEnabled() {
  return enabled;
}

export function resetAiPerformance() {
  counters = { ...EMPTY_COUNTERS };
  startedAt = now();
}

export function addAiPerformance(key, amount = 1) {
  if (!enabled && !progressObserver) return;
  const increment = Number(amount);
  if (!Number.isFinite(increment)) return;
  if (progressObserver && increment > 0 && progressKeys.has(key)) {
    const observer = progressObserver;
    observer.counters[key] = (observer.counters[key] || 0) + increment;
    observer.sequence += 1;
    const timestamp = observer.clock();
    if (timestamp - observer.lastReportedAt >= observer.intervalMs) {
      observer.lastReportedAt = timestamp;
      try {
        observer.callback({ sequence: observer.sequence, counters: { ...observer.counters } });
      } catch {
        // Telemetry must never change a game result or consume its RNG.
      }
    }
  }
  if (!enabled) return;
  counters[key] = (Number(counters[key]) || 0) + increment;
}

export function measureAiPerformance(key, fn) {
  if (!enabled) return fn();
  const start = now();
  try {
    return fn();
  } finally {
    addAiPerformance(key, now() - start);
  }
}

export function snapshotAiPerformance(options = {}) {
  if (!enabled) return null;
  const snapshot = {
    version: 1,
    wallMs: round(now() - startedAt),
    ...Object.fromEntries(Object.entries(counters).map(([key, value]) => [
      key,
      key.endsWith("Ms") ? round(value) : value
    ]))
  };
  if (options.reset === true) resetAiPerformance();
  return snapshot;
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
