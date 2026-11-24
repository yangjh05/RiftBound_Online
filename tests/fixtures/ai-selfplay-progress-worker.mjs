import { addAiPerformance } from "../../src/ai/performance.mjs";
import { startSelfPlayProgressReporting } from "../../scripts/ai-selfplay-progress.mjs";
import { createSelfPlayResultHandoff } from "../../scripts/ai-selfplay-result-handoff.mjs";

let options;
process.on("message", async (message) => {
  if (message.type === "initialize") {
    options = message.options;
    process.send({ type: "ready" });
  } else if (message.type === "shutdown") {
    process.disconnect();
  } else if (message.type === "run-game") {
    const stop = startSelfPlayProgressReporting({
      directory: options.resultHandoffDirectory,
      processId: process.pid,
      token: message.progressToken,
      intervalMs: 100
    });
    // Deliberately block this worker's event loop while the parent reads
    // progress. An interval-based worker heartbeat cannot pass this test.
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) addAiPerformance("rolloutSteps");
    stop();
    const handoff = await createSelfPlayResultHandoff({
      trajectories: [], summaries: [{ completed: true }], deckLearning: {}
    }, options.resultHandoffDirectory);
    process.send({ type: "game-complete", workerIndex: message.task.workerIndex,
      gameIndex: message.task.gameIndex, workerCompletedGames: 1, ...handoff });
  }
});
