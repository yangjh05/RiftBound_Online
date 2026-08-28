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
    setImmediate(() => {
      if (process.connected) process.disconnect?.();
    });
    return;
  }
  if (message?.type !== "run-game") return;

  const task = message.task;
  const valueCount = Math.max(
    1024,
    Number(process.env.RIFTBOUND_LARGE_RESULT_VALUES) || 262144
  );
  const state = new Float32Array(valueCount);
  state[0] = task.workerIndex;
  state[1] = task.gameIndex;
  state[state.length - 1] = task.seed;
  const result = {
    trajectories: [{
      gameId: `${task.workerIndex}:${task.gameIndex}`,
      state
    }],
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
        kind: "large-test-result",
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
