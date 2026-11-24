import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { assertAdaptiveGame } from "./adaptive-policy-q-evidence.mjs";
import { digest } from "./adaptive-policy-q-contract.mjs";
import { collectProcessPoolSelfPlay } from "./ai-selfplay-process-pool.mjs";
import { leagueGameAssignment } from './league-selfplay-contract.mjs';

export function adaptiveGameRejection(result, plan, gameIndex, maxActions, maximumActions = 38400) {
  try { assertAdaptiveGame(result, plan, gameIndex); return null; }
  catch (error) {
    const summaries = result.summaries || (result.summary ? [result.summary] : []);
    const summary = summaries[0];
    const actionLimit = summaries.length === 1 && summary.completed === false && !summary.invalid
      && !summary.adjudicated && !summary.winnerId && !summary.decisionSafetyViolations?.length
      && Number.isInteger(summary.actions) && summary.actions >= maxActions;
    return { code: actionLimit ? "ADAPTIVE_GAME_ACTION_LIMIT" : "ADAPTIVE_GAME_REJECTED",
      message: error.message, gameIndex, maxActions, recoverable: actionLimit && maxActions < maximumActions,
      nextMaxActions: actionLimit && maxActions < maximumActions ? Math.min(maximumActions, maxActions * 2) : null,
      summaries: summaries.map(s => ({ completed: s.completed, winnerId: s.winnerId, actions: s.actions,
        invalid: s.invalid || false, invalidReason: s.invalidReason || null, adjudicated: s.adjudicated || false,
        decisionSafetyViolations: s.decisionSafetyViolations || [], deckIds: s.deckIds, gameSeed: s.gameSeed })) };
  }
}

function rejectedError(failure, archivePath) {
  const error = new Error(`Adaptive game ${failure.gameIndex} rejected; saved diagnostic: ${archivePath}`);
  error.code = failure.code;
  error.diagnostic = { ...failure, archivePath };
  return error;
}

// Keep completed games immutable. A censored long game is retried separately
// with a larger action budget, never assigned a synthetic winner or fed to PPO.
// Other invalid games are saved first, and peers finish before collection fails.
export async function collectAdaptiveSelfPlay(options) {
  const { directory, plan, onGameComplete, onRejectedGame, collect = collectProcessPoolSelfPlay,
    maximumAdaptiveGameActions = 38400, ...base } = options;
  if(base.league?.length&&!plan.leagueCollection)throw new Error('League opponents require a frozen learner-only collection plan.');
  const initialMaxActions = base.maxActions || 2400;
  const gamesDirectory = path.join(directory, "games");
  const planHash = digest(plan);
  await mkdir(gamesDirectory, { recursive: true });
  for (;;) {
    const completed = new Set();
    for (const name of (await readdir(gamesDirectory)).filter(name => name.endsWith(".json.gz"))) {
      const index = Number(name.slice(0, -8));
      if (!Number.isInteger(index) || index < 0 || index >= plan.games || name !== `${index}.json.gz`) {
        throw new Error("Unexpected adaptive game filename.");
      }
      assertAdaptiveGame(await readTrajectoryArchive(path.join(gamesDirectory, name)), plan, index);
      completed.add(index);
    }
    if (completed.size === plan.games) return { completedGames: completed.size };
    const attempts = new Map();
    for (let index = 0; index < plan.games; index++) {
      if (completed.has(index)) continue;
      const root = path.join(directory, "rejected-games", String(index));
        // Most games succeed immediately. Create a diagnostic directory only
        // when writeTrajectoryArchive actually has a rejected result to save.
        const names = (await readdir(root).catch(error => {
          if (error.code === "ENOENT") return [];
          throw error;
        })).filter(name => /^attempt-\d{6}\.json\.gz$/.test(name)).sort();
      let maxActions = initialMaxActions;
      if (names.length) {
        const archivePath = path.join(root, names.at(-1));
        const previous = await readTrajectoryArchive(archivePath);
        if (previous.planHash !== planHash || previous.failure.gameIndex !== index) throw new Error("Rejected game lineage changed.");
        if (!previous.failure.recoverable) throw rejectedError(previous.failure, archivePath);
        maxActions = previous.failure.nextMaxActions;
      }
      attempts.set(index, { root, ordinal: names.length + 1, maxActions });
    }
    const fatal = [];
    await collect({ ...base, games: plan.games, seed: plan.seed,
      completedGameIndexes: new Map([[0, completed]]), retainResults: false,
      resolveTaskOptions: context => {
        const previous = base.resolveTaskOptions?.(context) || {};
        return { ...previous, optionOverrides: { ...previous.optionOverrides,
          ...(plan.leagueCollection?{leagueGameAssignment:leagueGameAssignment(plan,context.task.gameIndex)}:{}),
          maxActions: attempts.get(context.task.gameIndex).maxActions,
          deterministicGameRandomness: plan.gameRandomnessContract === "seeded-engine-game-v1" } };
      },
      onGameComplete: async game => {
        const { gameIndex, result } = game, attempt = attempts.get(gameIndex);
        for (const trajectory of result.trajectories || []) {
          trajectory.gameId = `adaptive:${plan.iteration}:${gameIndex}`;
          if(!plan.leagueCollection)trajectory.sourcePolicyBehaviorHash = plan.sourceBehaviorHash;
        }
        const failure = adaptiveGameRejection(result, plan, gameIndex, attempt.maxActions, maximumAdaptiveGameActions);
        if (failure) {
          const archivePath = path.join(attempt.root, `attempt-${String(attempt.ordinal).padStart(6, "0")}.json.gz`);
          await writeTrajectoryArchive(archivePath, { version: 1, contract: "adaptive-rejected-game-v1", planHash,
            at: new Date().toISOString(), sourcePath: plan.sourcePath, sourceBehaviorHash: plan.sourceBehaviorHash,
            seed: game.seed, gameRandomnessContract: plan.gameRandomnessContract || "legacy-unseeded-engine",
            failure, result });
          await onRejectedGame?.({ ...failure, archivePath });
          if (!failure.recoverable) fatal.push(rejectedError(failure, archivePath));
          return;
        }
        await writeTrajectoryArchive(path.join(gamesDirectory, `${gameIndex}.json.gz`), result);
        await onGameComplete?.(game);
      }
    });
    if (fatal.length) throw fatal[0];
  }
}
