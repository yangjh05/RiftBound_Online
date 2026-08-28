import { appendFile, access, writeFile } from "node:fs/promises";
import {
  createSelfPlayResultHandoff
} from "../../scripts/ai-selfplay-result-handoff.mjs";

let slotIndex = null;
let options = null;

process.on("message", async (message) => {
  if (message?.type === "initialize") {
    slotIndex = message.slotIndex;
    options = message.options;
    await sendToParent({ type: "ready", slotIndex });
    return;
  }
  if (message?.type === "shutdown") {
    setImmediate(() => {
      if (process.connected) process.disconnect?.();
    });
    return;
  }
  if (message?.type !== "run-game") return;

  const task = message.task;
  const markerPath = process.env.RIFTBOUND_FLAKY_WORKER_MARKER;
  const seedLogPath = process.env.RIFTBOUND_FLAKY_WORKER_SEED_LOG;
  await appendFile(seedLogPath, `${task.seed}\n`, "utf8");
  let markerExists = true;
  try {
    await access(markerPath);
  } catch {
    markerExists = false;
  }
  if (!markerExists) {
    await writeFile(markerPath, "failed-once\n", "utf8");
    process.exit(1);
  }

  const result = {
    trajectories: [],
    summaries: [{
      completed: true,
      naturallyCompleted: true,
      invalid: false
    }],
    deckLearning: {}
  };
  const handoff = await createSelfPlayResultHandoff(
    result,
    options.resultHandoffDirectory,
    {
      summary: {
        version: 1,
        kind: "test-result",
        workerIndex: task.workerIndex,
        gameIndex: task.gameIndex
      }
    }
  );
  await sendToParent({
    type: "game-complete",
    slotIndex,
    workerIndex: task.workerIndex,
    gameIndex: task.gameIndex,
    workerCompletedGames: 1,
    workerRssBytes: process.memoryUsage().rss,
    ...handoff
  });
});

function sendToParent(message) {
  if (!process.send || !process.connected) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    process.send(message, (error) => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}
