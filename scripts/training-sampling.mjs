export function splitStratifiedHoldoutTrajectories(trajectories, options = {}) {
  const items = [...(trajectories || [])];
  if (!items.length) return emptySplit(options.deckIds || []);
  const fraction = Math.max(0, Math.min(0.5, Number(options.fraction) || 0));
  const minimumPerDeck = Math.max(0, Math.floor(options.minimumPerDeck ?? 4));
  const minimumTrainingPerDeck = Math.max(1, Math.floor(options.minimumTrainingPerDeck ?? 6));
  const requestedDeckIds = [...new Set(options.deckIds || items.map((item) => item.deckId).filter(Boolean))];
  const grouped = groupByGame(items);
  shuffle(grouped, seededRandom((Number(options.seed) || 1) >>> 0));

  const totalCounts = countDecks(items, requestedDeckIds);
  const targets = Object.fromEntries(requestedDeckIds.map((deckId) => {
    const total = totalCounts[deckId] || 0;
    const desired = Math.max(Math.round(total * fraction), minimumPerDeck);
    return [deckId, Math.max(0, Math.min(desired, total - minimumTrainingPerDeck))];
  }));
  const selected = new Set();
  const calibrationCounts = countDecks([], requestedDeckIds);

  while (true) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < grouped.length; index += 1) {
      if (selected.has(index)) continue;
      const groupCounts = countDecks(grouped[index], requestedDeckIds);
      if (!canHoldOut(groupCounts, calibrationCounts, totalCounts, minimumTrainingPerDeck)) continue;
      const score = requestedDeckIds.reduce((sum, deckId) => {
        const deficit = Math.max(0, targets[deckId] - calibrationCounts[deckId]);
        return sum + Math.min(deficit, groupCounts[deckId] || 0);
      }, 0);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex < 0 || bestScore <= 0) break;
    selected.add(bestIndex);
    addDeckCounts(calibrationCounts, grouped[bestIndex], requestedDeckIds);
  }

  const desiredHoldoutItems = Math.round(items.length * fraction);
  for (let index = 0; index < grouped.length && selectedItemCount(grouped, selected) < desiredHoldoutItems; index += 1) {
    if (selected.has(index)) continue;
    const groupCounts = countDecks(grouped[index], requestedDeckIds);
    if (!canHoldOut(groupCounts, calibrationCounts, totalCounts, minimumTrainingPerDeck)) continue;
    selected.add(index);
    addDeckCounts(calibrationCounts, grouped[index], requestedDeckIds);
  }

  const calibration = grouped.filter((_, index) => selected.has(index)).flat();
  const training = grouped.filter((_, index) => !selected.has(index)).flat();
  const trainingCounts = countDecks(training, requestedDeckIds);
  const failures = [];
  for (const deckId of requestedDeckIds) {
    if ((trainingCounts[deckId] || 0) < minimumTrainingPerDeck) failures.push({
      deckId,
      reason: "insufficient-training-trajectories",
      actual: trainingCounts[deckId] || 0,
      minimum: minimumTrainingPerDeck
    });
    if ((calibrationCounts[deckId] || 0) < minimumPerDeck) failures.push({
      deckId,
      reason: "insufficient-retention-trajectories",
      actual: calibrationCounts[deckId] || 0,
      minimum: minimumPerDeck
    });
  }
  return {
    training,
    calibration,
    coverage: {
      version: 1,
      passed: failures.length === 0,
      minimumPerDeck,
      minimumTrainingPerDeck,
      totalCounts,
      trainingCounts,
      calibrationCounts,
      targets,
      failures
    }
  };
}

export function splitIndependentTrainingPartitions(trajectories, options = {}) {
  const deckIds = [...new Set(options.deckIds || (trajectories || [])
    .map((item) => item?.deckId)
    .filter(Boolean))];
  const minimumTrainingPerDeck = Math.max(1,
    Math.floor(options.minimumTrainingPerDeck ?? 6));
  const specifications = [
    {
      name: "evaluatorAudit",
      fraction: boundedFraction(options.evaluatorAuditFraction, 0.05),
      minimumPerDeck: Math.max(0, Math.floor(options.minimumEvaluatorAuditPerDeck ?? 1)),
      seedOffset: 0x243f6a88
    },
    {
      name: "calibrationTest",
      fraction: boundedFraction(options.calibrationTestFraction, 0.05),
      minimumPerDeck: Math.max(0, Math.floor(options.minimumCalibrationTestPerDeck ?? 1)),
      seedOffset: 0x85a308d3
    },
    {
      name: "calibrationFit",
      fraction: boundedFraction(options.calibrationFitFraction, 0.05),
      minimumPerDeck: Math.max(0, Math.floor(options.minimumCalibrationFitPerDeck ?? 1)),
      seedOffset: 0x13198a2e
    },
    {
      name: "retention",
      fraction: boundedFraction(options.retentionFraction, 0.1),
      minimumPerDeck: Math.max(0, Math.floor(options.minimumRetentionPerDeck ?? 4)),
      seedOffset: 0x03707344
    }
  ];
  const original = [...(trajectories || [])];
  const baseSeed = (Number(options.seed) || 1) >>> 0;
  let remaining = original;
  const partitions = {};
  const reports = {};
  const failures = [];

  for (let index = 0; index < specifications.length; index += 1) {
    const specification = specifications[index];
    const futureMinimum = specifications.slice(index + 1)
      .reduce((sum, item) => sum + item.minimumPerDeck, 0);
    const desiredItems = Math.round(original.length * specification.fraction);
    const relativeFraction = remaining.length
      ? Math.min(0.5, desiredItems / remaining.length)
      : 0;
    const split = splitStratifiedHoldoutTrajectories(remaining, {
      fraction: relativeFraction,
      seed: (baseSeed ^ specification.seedOffset) >>> 0,
      deckIds,
      minimumPerDeck: specification.minimumPerDeck,
      minimumTrainingPerDeck: minimumTrainingPerDeck + futureMinimum
    });
    partitions[specification.name] = split.calibration;
    reports[specification.name] = split.coverage;
    remaining = split.training;
    for (const failure of split.coverage.failures || []) {
      failures.push({ partition: specification.name, ...failure });
    }
  }

  partitions.training = remaining;
  const gameSets = Object.fromEntries(Object.entries(partitions).map(([name, items]) => [
    name,
    new Set(items.map((item, index) => trajectoryGameKey(item, index)))
  ]));
  const overlaps = [];
  const names = Object.keys(gameSets);
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const shared = [...gameSets[names[left]]].filter((gameId) => gameSets[names[right]].has(gameId));
      if (shared.length) overlaps.push({
        left: names[left],
        right: names[right],
        games: shared
      });
    }
  }
  const finalTrainingCounts = countDecks(partitions.training, deckIds);
  for (const deckId of deckIds) {
    if ((finalTrainingCounts[deckId] || 0) < minimumTrainingPerDeck) failures.push({
      partition: "training",
      deckId,
      reason: "insufficient-training-trajectories",
      actual: finalTrainingCounts[deckId] || 0,
      minimum: minimumTrainingPerDeck
    });
  }
  if (overlaps.length) failures.push({
    partition: "manifest",
    reason: "game-overlap",
    overlaps
  });

  return {
    ...partitions,
    manifest: {
      version: 1,
      splitUnit: "game",
      seed: baseSeed,
      deckIds,
      minimumTrainingPerDeck,
      counts: Object.fromEntries(Object.entries(partitions).map(([name, items]) =>
        [name, items.length])),
      gameCounts: Object.fromEntries(Object.entries(gameSets).map(([name, ids]) =>
        [name, ids.size])),
      gameIds: Object.fromEntries(Object.entries(gameSets).map(([name, ids]) =>
        [name, [...ids].sort()])),
      reports,
      overlaps,
      failures,
      passed: failures.length === 0
    }
  };
}

export function balanceTrainingTrajectories(trajectories, options = {}) {
  const items = [...(trajectories || [])];
  const deckIds = [...new Set(options.deckIds || items.map((item) => item.deckId).filter(Boolean))];
  const random = seededRandom((Number(options.seed) || 1) >>> 0);
  const byDeck = new Map(deckIds.map((deckId) => [deckId, items.filter((item) => item.deckId === deckId)]));
  const originalDeckCounts = Object.fromEntries(deckIds.map((deckId) => [deckId, byDeck.get(deckId).length]));
  const targetPerDeck = Math.max(0, ...Object.values(originalDeckCounts));
  const balanced = [...items];
  const addedDeckCounts = Object.fromEntries(deckIds.map((deckId) => [deckId, 0]));
  const addedConditionCounts = {};

  for (const deckId of deckIds) {
    const deckItems = byDeck.get(deckId);
    if (!deckItems.length) continue;
    const conditionBuckets = new Map();
    for (const item of deckItems) {
      const condition = item.condition || "unknown";
      if (!conditionBuckets.has(condition)) conditionBuckets.set(condition, []);
      conditionBuckets.get(condition).push(item);
    }
    for (const bucket of conditionBuckets.values()) shuffle(bucket, random);
    const effectiveCounts = new Map([...conditionBuckets].map(([condition, bucket]) => [condition, bucket.length]));
    const cursors = new Map([...conditionBuckets.keys()].map((condition) => [condition, 0]));
    while (deckItems.length + addedDeckCounts[deckId] < targetPerDeck) {
      const conditions = [...conditionBuckets.keys()].sort((left, right) =>
        effectiveCounts.get(left) - effectiveCounts.get(right) || left.localeCompare(right));
      const condition = conditions[0];
      const bucket = conditionBuckets.get(condition);
      const cursor = cursors.get(condition);
      balanced.push(bucket[cursor % bucket.length]);
      cursors.set(condition, cursor + 1);
      effectiveCounts.set(condition, effectiveCounts.get(condition) + 1);
      addedDeckCounts[deckId] += 1;
      const key = `${deckId}:${condition}`;
      addedConditionCounts[key] = (addedConditionCounts[key] || 0) + 1;
    }
  }

  return {
    trajectories: balanced,
    report: {
      version: 1,
      originalTrajectories: items.length,
      balancedTrajectories: balanced.length,
      addedTrajectories: balanced.length - items.length,
      targetPerDeck,
      originalDeckCounts,
      addedDeckCounts,
      addedConditionCounts
    }
  };
}

function emptySplit(deckIds) {
  const failures = [...new Set(deckIds)].flatMap((deckId) => [
    { deckId, reason: "insufficient-training-trajectories", actual: 0, minimum: 1 },
    { deckId, reason: "insufficient-retention-trajectories", actual: 0, minimum: 1 }
  ]);
  return {
    training: [],
    calibration: [],
    coverage: { version: 1, passed: false, totalCounts: {}, trainingCounts: {}, calibrationCounts: {}, targets: {}, failures }
  };
}

function groupByGame(trajectories) {
  const groups = new Map();
  trajectories.forEach((trajectory, index) => {
    const key = trajectory.gameId || `ungrouped-${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trajectory);
  });
  return [...groups.values()];
}

function countDecks(trajectories, deckIds) {
  const counts = Object.fromEntries(deckIds.map((deckId) => [deckId, 0]));
  for (const trajectory of trajectories) {
    if (trajectory?.deckId in counts) counts[trajectory.deckId] += 1;
  }
  return counts;
}

function addDeckCounts(target, trajectories, deckIds) {
  const counts = countDecks(trajectories, deckIds);
  for (const deckId of deckIds) target[deckId] += counts[deckId];
}

function canHoldOut(groupCounts, calibrationCounts, totalCounts, minimumTrainingPerDeck) {
  return Object.keys(totalCounts).every((deckId) => totalCounts[deckId]
    - calibrationCounts[deckId]
    - (groupCounts[deckId] || 0) >= minimumTrainingPerDeck);
}

function selectedItemCount(groups, selected) {
  let count = 0;
  for (const index of selected) count += groups[index].length;
  return count;
}

function boundedFraction(value, fallback) {
  const number = Number(value);
  return Math.max(0, Math.min(0.25, Number.isFinite(number) ? number : fallback));
}

function trajectoryGameKey(trajectory, index) {
  return trajectory?.gameId || `ungrouped-${index}`;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}
