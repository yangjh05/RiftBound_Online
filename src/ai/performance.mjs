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
  if (!enabled || !Number.isFinite(Number(amount))) return;
  counters[key] = (Number(counters[key]) || 0) + Number(amount);
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
