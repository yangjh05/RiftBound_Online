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
    // The test releases these games only after the busy workers recover.
    while (!existsSync(process.env.RIFTBOUND_RECOVERY_RELEASE)) await delay(50);
    const handoff = await createSelfPlayResultHandoff({
      trajectories: [], summaries: [{ completed: true }], deckLearning: {}
    }, options.resultHandoffDirectory);
    process.send({ type: "game-complete", workerIndex: message.task.workerIndex,
      gameIndex: message.task.gameIndex, workerCompletedGames: 1, ...handoff });
  }
});
