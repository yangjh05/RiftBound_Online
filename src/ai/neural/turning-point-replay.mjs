export function extractTurningPointReplays(trajectories, options = {}) {
  const before = Math.max(1, options.before ?? 12);
  const after = Math.max(1, options.after ?? 6);
  const maxPerTrajectory = Math.max(1, options.maxPerTrajectory ?? 2);
  const output = [];
  for (const trajectory of trajectories || []) {
    const candidates = trajectory.steps.flatMap((step, index) => step.turningPoint ? [{ index, type: step.turningPoint }] : []);
    const selected = selectSeparatedIndexes(candidates, before + after + 1, maxPerTrajectory);
    for (const index of selected) {
      const turningPoint = trajectory.steps[index].turningPoint;
      const replayId = `${options.sourceCollectionKey || "collection"}:${trajectory.gameId || trajectory.playerId || "game"}:${index}:${turningPoint}`;
      output.push({
        ...trajectory,
        gameId: `turning-point:${replayId}`,
        replayId,
        replay: true,
        sourceGameId: trajectory.gameId || null,
        sourceCollectionKey: options.sourceCollectionKey || null,
        turningPoint,
        steps: trajectory.steps.slice(Math.max(0, index - before), Math.min(trajectory.steps.length, index + after + 1))
      });
    }
  }
  return output;
}

export function mergeTurningPointReplays(existing, fresh, limit = 256) {
  const unique = new Map();
  for (const trajectory of [...(existing || []), ...(fresh || [])]) {
    if (!trajectory?.replayId || !trajectory.steps?.length) continue;
    unique.delete(trajectory.replayId);
    unique.set(trajectory.replayId, trajectory);
  }
  return [...unique.values()].slice(-Math.max(0, limit));
}

export function sampleTurningPointReplays(trajectories, limit, random = Math.random) {
  const pool = (trajectories || []).map((trajectory) => ({ trajectory, tie: random() }))
    .sort((left, right) => replayPriority(right.trajectory.turningPoint) - replayPriority(left.trajectory.turningPoint)
      || left.tie - right.tie)
    .map((item) => item.trajectory);
  return pool.slice(0, Math.max(0, limit));
}

function selectSeparatedIndexes(candidates, minimumDistance, limit) {
  const ordered = [...candidates].sort((left, right) => {
    return replayPriority(right.type) - replayPriority(left.type) || left.index - right.index;
  });
  const selected = [];
  for (const { index } of ordered) {
    if (selected.every((candidate) => Math.abs(candidate - index) >= minimumDistance)) selected.push(index);
    if (selected.length >= limit) break;
  }
  return selected.sort((left, right) => left - right);
}

function replayPriority(type) {
  return {
    "teacher-critical": 7,
    "teacher-urgent": 6,
    "lead-flip": 5,
    "teacher-regret": 4,
    "stale-hand": 3,
    "near-victory": 2,
    "lead-breakaway": 1
  }[type] || 0;
}
