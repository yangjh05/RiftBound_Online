import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AI_PROGRESS_COUNTERS, observeAiProgress } from "../src/ai/performance.mjs";

export const DEFAULT_SELF_PLAY_PROGRESS_WARNING_MS = 5 * 60_000;

export function selfPlayProgressPath(directory, processId) {
  return path.join(directory, `progress-${processId}.json`);
}

export function startSelfPlayProgressReporting(options) {
  const filename = selfPlayProgressPath(options.directory, options.processId);
  const temporary = `${filename}.tmp`;
  return observeAiProgress((progress) => {
    const sample = { version: 1, token: options.token, ...progress };
    // A small synchronous atomic write also works during a long synchronous
    // rollout. A timer or an IPC flush callback would wait for that rollout.
    writeFileSync(temporary, JSON.stringify(sample));
    renameSync(temporary, filename);
  }, { intervalMs: options.intervalMs ?? 5000, clock: options.clock });
}

export function readSelfPlayProgress(filename) {
  try {
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch {
    return null;
  }
}

export function acceptSelfPlayProgress(slot, sample, timestamp = Date.now()) {
  if (!slot?.task || !slot.progressToken || sample?.token !== slot.progressToken
    || !Number.isSafeInteger(sample.sequence) || sample.sequence <= 0
    || sample.sequence <= (slot.taskProgress?.sequence || 0)) return false;
  const previous = slot.taskProgress?.counters || {};
  const counters = {};
  let advanced = false;
  for (const key of AI_PROGRESS_COUNTERS) {
    const value = Number(sample.counters?.[key] ?? 0);
    if (!Number.isFinite(value) || value < (previous[key] || 0)) return false;
    counters[key] = value;
    if (value > (previous[key] || 0)) advanced = true;
  }
  if (!advanced) return false;
  slot.taskProgress = { sequence: sample.sequence, counters };
  slot.lastProgressAt = timestamp;
  slot.progressWarningEmitted = false;
  return true;
}

export function selfPlayProgressStatus(slot, timestamp = Date.now(), warningMs = DEFAULT_SELF_PLAY_PROGRESS_WARNING_MS) {
  if (!slot?.task || slot.startedAt == null) return null;
  const elapsed = Math.max(0, timestamp - (slot.lastProgressAt ?? slot.startedAt));
  return {
    state: elapsed >= warningMs ? "no-recent-progress"
      : slot.taskProgress ? "advancing" : "awaiting-first-progress",
    secondsSinceProgress: Math.floor(elapsed / 1000),
    sequence: slot.taskProgress?.sequence || 0,
    counters: slot.taskProgress?.counters || null
  };
}
