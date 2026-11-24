// Test-only control of setup randomness and transient engine identifiers.
// Production keeps its existing random distributions and never uses this file.
import { seededRandom } from '../../src/ai/neural/selfplay.mjs';
let schedule;
process.prependListener('message', message => {
  if (message.type === 'initialize') schedule = message.options.tacticalRefreshSchedule;
  if (message.type === 'run-game') {
    const item = schedule[message.task.gameIndex];
    Math.random = seededRandom(item.seed ^ 0x15ab937d);
    Date.now = () => 1700000000000 + item.index;
  }
});
await import('../../scripts/ai-selfplay-worker-process.mjs');
