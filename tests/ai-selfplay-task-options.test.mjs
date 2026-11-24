import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { selfPlayTaskOptions } from "../scripts/ai-selfplay-task-options.mjs";
import { collectProcessPoolSelfPlay } from "../scripts/ai-selfplay-process-pool.mjs";
import { createNeuralModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import { decklists } from "../src/cards.mjs";
import { playNeuralSelfPlayGame,seededRandom,selfPlayComparisonSchedule } from '../src/ai/neural/selfplay.mjs';
import { NATURAL_MIXTURE_SELECTION, naturalLeafSamplingChannel }
  from "../src/ai/neural/natural-leaf-sampling.mjs";

test("per-game precision and pair budget reach workers without changing frozen options", () => {
  const base = { teacherLeafAuditSimulations: 128, teacherLeafAuditPairBudget: 4,
    model: { generation: 5 }, seed: 7, engineFingerprint: "original" };
  const result = selfPlayTaskOptions(base, { optionOverrides: {
    teacherLeafAuditSimulations: 1024, teacherLeafAuditPairBudget: 1,
    evidenceSamplingFrame: { plannedFinalSimulations: 1024 },
    model: { generation: 0 }, seed: 99, engineFingerprint: "changed"
  } });
  assert.equal(result.teacherLeafAuditSimulations, 1024);
  assert.equal(result.teacherLeafAuditPairBudget, 1);
  assert.equal(base.teacherLeafAuditSimulations, 128);
  assert.equal(base.teacherLeafAuditPairBudget, 4);
  assert.equal(result.model, base.model);
  assert.equal(result.seed, 7);
  assert.equal(result.engineFingerprint, "original");
  const next = selfPlayTaskOptions(base, {});
  assert.equal(next.teacherLeafAuditSimulations, 128);
  assert.equal(next.teacherLeafAuditPairBudget, 4);
});

test('first-player collection reaches both learner seats and records actual choice actions',()=>{
  const model=createNeuralModel({seed:612});
  try {
    for(const index of [0,7]){
      const schedule=selfPlayComparisonSchedule(index),id=`p${schedule.learnerSeat+1}`;
      assert.equal(schedule.firstPlayerId,id);
      const options=selfPlayTaskOptions({model,decks:Object.values(decklists).slice(0,2),
        maxActions:2,captureReplay:true,teacherFraction:0,teacherBudget:0,teacherCriticalBudget:0,
        teacherUrgentBudget:0,teacherEvaluatorMode:'heuristic-only',postmortemReviews:0,
        firstPlayerId:id,random:seededRandom(715+index)}, {optionOverrides:{learnFirstPlayerChoice:true}});
      const result=playNeuralSelfPlayGame(options);
      const choice=result.spectatorReplay.frames.find(frame=>frame.action?.kind==='chooseFirstPlayer');
      assert.ok(choice);assert.equal(choice.actorId,id);
      assert.equal(result.game.firstPlayerId,choice.action.playerId);
    }
    assert.equal(selfPlayTaskOptions({},{}).learnFirstPlayerChoice,undefined);
    assert.throws(()=>selfPlayTaskOptions({}, {optionOverrides:{learnFirstPlayerChoice:'yes'}}),/first-player/);
  }finally{disposeNeuralModel(model);}
});

test("invalid or inconsistent audit budgets fail before any game calculation", () => {
  for (const n of [-1, 1025, 2.5, NaN, Infinity]) {
    assert.throws(() => selfPlayTaskOptions({}, { optionOverrides: {
      teacherLeafAuditSimulations: n
    } }), /simulation budget/);
  }
  assert.throws(() => selfPlayTaskOptions({ teacherLeafAuditSimulations: 128 }, {
    optionOverrides: { evidenceSamplingFrame: { plannedFinalSimulations: 1024 } }
  }), /precision mismatch/);
  assert.throws(() => selfPlayTaskOptions({}, { optionOverrides: {
    teacherLeafAuditPairBudget: -1
  } }), /pair budget/);
  assert.equal(selfPlayTaskOptions({}, { optionOverrides: {
    teacherLeafAuditSimulations: 0, teacherLeafAuditPairBudget: 0,
    evidenceSamplingFrame: { plannedFinalSimulations: 0 }
  } }).teacherLeafAuditSimulations, 0);
});

test("action extension and deterministic engine RNG use the frozen task without accepting arbitrary seeds", () => {
  const task = { seed: 17, gameIndex: 3, optionOverrides: {
    maxActions: 4800, deterministicGameRandomness: true, randomSeed: 999, seed: 999 } };
  const result = selfPlayTaskOptions({ seed: 17, maxActions: 2400 }, task);
  assert.equal(result.seed, 17);
  assert.equal(result.randomSeed, 17 + 3 * 130363);
  assert.equal(result.maxActions, 4800);
  assert.equal(selfPlayTaskOptions({}, { seed: 0, gameIndex: 0,
    optionOverrides: { deterministicGameRandomness: true } }).randomSeed, 1);
  assert.equal(selfPlayTaskOptions({}, { optionOverrides: { randomSeed: 999 } }).randomSeed, undefined);
  assert.throws(() => selfPlayTaskOptions({}, { optionOverrides: { maxActions: -1 } }), /action budget/);
});

test("real workers reproduce engine shuffles and actions after a fresh process restart", async () => {
  const model = createNeuralModel();
  const frames = [];
  try {
    for (let run = 0; run < 2; run++) {
      await collectProcessPoolSelfPlay({ games: 1, workers: 1, processes: 1, maximumProcesses: 1,
        model, decks: Object.values(decklists).slice(0, 2), seed: 723, maxActions: 16,
        teacherFraction: 0, teacherBudget: 0, teacherCriticalBudget: 0, teacherUrgentBudget: 0,
        teacherEvaluatorMode: "heuristic-only", bestOfThreeFraction: 0,
        captureReplays: true, replayEvery: 1, retainResults: false,
        resolveTaskOptions: () => ({ optionOverrides: { deterministicGameRandomness: true } }),
        onGameComplete: ({ result }) => frames.push(result.spectatorReplays[0].frames.map(frame => ({
          phase: frame.phase, turnNumber: frame.turnNumber, actorId: frame.actorId,
          randomState: frame.game.deterministicRandomState,
          actionKind: frame.action?.kind,
          players: frame.game.players.map(player => ({ score: player.score,
            hand: player.hand.map(card => card.cardNumber), deck: player.mainDeck.map(card => card.cardNumber) }))
        }))) });
    }
    assert.ok(frames[0].length > 8);
    assert.ok(frames[0].every(frame => Number.isInteger(frame.randomState)));
    assert.deepEqual(frames[1], frames[0]);
  } finally { disposeNeuralModel(model); }
});

test("real worker IPC applies 1024 then 128 and persists the applied settings", async () => {
  const saved = [];
  let acknowledgeFirst;
  const firstAcknowledgement = new Promise(resolve => { acknowledgeFirst = resolve; });
  const model = createNeuralModel();
  try {
    const result = await collectProcessPoolSelfPlay({
      games: 2, workers: 1, processes: 1, maximumProcesses: 1, seed: 721,
      decks: Object.values(decklists).slice(0, 2), model,
      maxActions: 1, teacherFraction: 0, bestOfThreeFraction: 0,
      workerHeartbeatMs: 5000,
      postmortemReviews: 0, teacherLeafAuditSimulations: 128,
      teacherLeafAuditPairBudget: 4, streamResultHandoff: true, retainResults: false,
      resultHandoff: { kind: "evaluator-bootstrap", datasetKey: "precision-ipc-test",
        samplingMode: "leaf-audit", certificationRole: "training" },
      resolveTaskOptions: ({ taskIndex }) => ({ optionOverrides: {
        teacherLeafAuditSimulations: taskIndex === 0 ? 1024 : 128,
        teacherLeafAuditPairBudget: taskIndex === 0 ? 1 : 2,
        evidenceSamplingFrame: { plannedFinalSimulations: taskIndex === 0 ? 1024 : 128,
          distribution: "natural-distribution", candidateSelection: NATURAL_MIXTURE_SELECTION,
          taskManifestHash: `ipc-mixture-${taskIndex}` }
      } }),
      onWorkerHeartbeat: snapshot => {
        const first = snapshot.active.find(w => w.gameIndex === 0 && w.appliedAuditSettings);
        if (first) acknowledgeFirst(first.appliedAuditSettings);
      },
      onGameHandoff: async (game) => {
        // Read the file written by the child, not the parent's requested context.
        const summary = JSON.parse(await readFile(game.resultHandoff.resultSummaryPath, "utf8"));
        saved.push(summary.appliedAuditSettings);
        if (game.gameIndex === 0) {
          let timer;
          try {
            const applied = await Promise.race([
              firstAcknowledgement,
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Missing worker acknowledgement")), 15000); })
            ]);
            assert.deepEqual(applied, summary.appliedAuditSettings);
          } finally { clearTimeout(timer); }
        }
      }
    });
    assert.equal(result.workerStats.collectedGames, 2);
    assert.deepEqual(saved.map(s => s.teacherLeafAuditSimulations), [1024, 128]);
    assert.deepEqual(saved.map(s => s.teacherLeafAuditPairBudget), [1, 2]);
    assert.ok(saved.every(s => s.samplingContract === NATURAL_MIXTURE_SELECTION));
    assert.deepEqual(saved.map(s => s.samplingChannel),
      [0, 1].map(i => naturalLeafSamplingChannel(`ipc-mixture-${i}`)));
  } finally { model.network?.dispose?.(); }
});
