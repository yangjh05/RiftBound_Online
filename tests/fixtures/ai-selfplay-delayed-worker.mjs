import {
  createSelfPlayResultHandoff
} from "../../scripts/ai-selfplay-result-handoff.mjs";

let slotIndex = null;
let options = null;
let completedGames = 0;

process.on("message", async (message) => {
  if (message?.type === "initialize") {
    slotIndex = message.slotIndex;
    options = message.options;
    await sendToParent({ type: "ready", slotIndex });
    return;
  }
  if (message?.type === "shutdown") {
    setImmediate(() => process.disconnect?.());
    return;
  }
  if (message?.type !== "run-game") return;
  const task = message.task;
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.max(10, Number(process.env.RIFTBOUND_DELAYED_WORKER_MS) || 250)
  ));
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
        kind: "delayed-test-result",
        workerIndex: task.workerIndex,
        gameIndex: task.gameIndex
      }
    }
  );
  completedGames += 1;
  await sendToParent({
    type: "game-complete",
    slotIndex,
    workerIndex: task.workerIndex,
    gameIndex: task.gameIndex,
    workerCompletedGames: completedGames,
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
