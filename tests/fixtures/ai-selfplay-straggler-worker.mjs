import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createSelfPlayResultHandoff } from "../../scripts/ai-selfplay-result-handoff.mjs";

let options;
process.on("message", async (message) => {
  if (message.type === "initialize") {
    options = message.options;
    process.send({ type: "ready" });
  } else if (message.type === "shutdown") {
    process.disconnect();
  } else if (message.type === "run-game") {
    const task = message.task;
    if (`${task.workerIndex}:${task.gameIndex}` === process.env.RIFTBOUND_STRAGGLER_TASK) {
      while (!existsSync(process.env.RIFTBOUND_STRAGGLER_RELEASE)) await delay(25);
    }
    const handoff = await createSelfPlayResultHandoff({
      trajectories: [], summaries: [{ completed: true, task }], deckLearning: {}
    }, options.resultHandoffDirectory);
    process.send({ type: "game-complete", workerIndex: task.workerIndex,
      gameIndex: task.gameIndex, workerCompletedGames: 1, ...handoff });
  }
});
