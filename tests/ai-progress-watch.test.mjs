import test from "node:test";
import assert from "node:assert/strict";
import {
  detachedAuditProcedureProgress,
  detachedAuditWorkerBreakdown,
  evaluatorBootstrapWorkerView,
  formatFriendly,
  formatTelegramFriendly,
  progressDisplayMarker,
  sendTelegramMessage,
  splitTelegramMessage
} from "../scripts/watch-ai-progress.mjs";

test("AI progress display suppresses heartbeat-only collection updates", () => {
  const progress = {
    runId: "iteration-7",
    sequence: 10,
    state: "collecting",
    stage: "selfplay",
    generation: 7,
    trainingIteration: 7,
    completedGames: 23,
    targetGames: 80,
    lastGame: { workerIndex: 1, gameIndex: 4, completed: true },
    workerPool: { active: [{ slotIndex: 0, workerIndex: 1, gameIndex: 5, elapsedSeconds: 60 }] }
  };
  const heartbeat = structuredClone(progress);
  heartbeat.sequence += 1;
  heartbeat.workerPool.active[0].elapsedSeconds = 120;

  assert.equal(progressDisplayMarker(heartbeat), progressDisplayMarker(progress));

  const nextGame = structuredClone(heartbeat);
  nextGame.sequence += 1;
  nextGame.completedGames += 1;
  nextGame.lastGame = { workerIndex: 1, gameIndex: 5, completed: true };
  assert.notEqual(progressDisplayMarker(nextGame), progressDisplayMarker(progress));
});

test("AI progress display preserves meaningful training and evaluation updates", () => {
  const training = { runId: "run", state: "training", stage: "ppo", generation: 7, trainingIteration: 7, epoch: 1, completedBatches: 3, totalBatches: 20 };
  assert.notEqual(progressDisplayMarker({ ...training, completedBatches: 4 }), progressDisplayMarker(training));

  const evaluating = { runId: "run", state: "evaluating", stage: "candidate-vs-champion", generation: 7, trainingIteration: 7, game: 3, completed: 3, candidateWins: 2 };
  assert.notEqual(progressDisplayMarker({ ...evaluating, game: 4, completed: 4 }), progressDisplayMarker(evaluating));
});

test("AI progress display preserves evaluator bootstrap evidence updates", () => {
  const bootstrap = {
    runId: "run",
    state: "training",
    stage: "evaluator-bootstrap",
    generation: 6,
    trainingIteration: 6,
    samplingMode: "leaf-audit",
    acceptedGames: 12,
    allocatedGames: 320,
    actionReferenceCount: 0,
    actionReferenceGameCount: 0,
    leafValuePairCount: 0,
    leafValueReferenceGameCount: 0,
    representativeCalibrationGames: 12,
    workerPool: { completedTasks: 0, totalTasks: 12 }
  };
  assert.notEqual(
    progressDisplayMarker({
      ...bootstrap,
      leafValuePairCount: 6,
      leafValueReferenceGameCount: 1
    }),
    progressDisplayMarker(bootstrap)
  );
  assert.notEqual(
    progressDisplayMarker({
      ...bootstrap,
      samplingMode: "action-ranking-audit"
    }),
    progressDisplayMarker(bootstrap)
  );
  assert.notEqual(
    progressDisplayMarker({
      ...bootstrap,
      detachedActionAudit: {
        stage: "selection-16",
        completedSeedBatches: 3,
        totalSeedBatches: 12,
        pairedSeedsCompleted: 12,
        pairedSeedsPlanned: 48
      }
    }),
    progressDisplayMarker(bootstrap)
  );
});

test("AI progress display shows the dynamic leaf-audit worker target and ceiling", () => {
  const output = formatFriendly({
    runId: "run",
    state: "training",
    stage: "evaluator-bootstrap",
    samplingMode: "leaf-audit",
    acceptedGames: 20,
    allocatedGames: 24,
    certificationPartitions: {},
    workerPool: {
      processCount: 14,
      desiredProcessCount: 15,
      maximumProcessCount: 16,
      completedTasks: 10,
      totalTasks: 24,
      active: Array.from({ length: 14 }, (_, slotIndex) => ({
        slotIndex,
        workerIndex: slotIndex,
        gameIndex: slotIndex
      }))
    }
  }, {});
  assert.match(
    output,
    /워커\s+: 작업 14 \/ 전체 14 \/ 목표 15 \/ 최대 16 · 확장 중 \/ 대기 0/
  );
});

test("AI progress display does not carry a drained game worker into detached audit", () => {
  const view = evaluatorBootstrapWorkerView({
    workerPool: {
      completedTasks: 23,
      totalTasks: 24,
      active: [{
        processId: 20620,
        workerIndex: 2,
        gameIndex: 91
      }]
    },
    detachedActionAudit: {
      stage: "selection-24",
      activeProcesses: 15,
      processCount: 16
    }
  });
  assert.deepEqual(view, {
    completedTasks: 24,
    activeWorkers: 0,
    detachedAuditStarted: true
  });
});

test("Telegram progress messages split on line boundaries", () => {
  assert.deepEqual(
    splitTelegramMessage("first line\nsecond line\nthird", 23),
    ["first line\nsecond line", "third"]
  );
});

test("Telegram progress sender preserves every message chunk", async () => {
  const requests = [];
  await sendTelegramMessage({
    botToken: "secret-token",
    chatId: "12345",
    text: "first line\nsecond line\nthird",
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.chat_id, "12345");
  assert.equal(requests[0].body.text, "first line\nsecond line\nthird");
  assert.match(requests[0].url, /secret-token\/sendMessage$/);
});

test("AI progress display reports detached audit procedure progress", () => {
  assert.deepEqual(detachedAuditProcedureProgress({
    stage: "final-v2-32",
    pairedSeedsCompleted: 12,
    pairedSeedsPlanned: 16
  }), {
    step: 6,
    totalSteps: 8,
    label: "독립 최종 검증 32쌍",
    completed: 12,
    total: 16
  });
});

test("AI progress display combines local and AWS action-audit workers", () => {
  const progress = {
    runId: "run",
    updatedAt: "2026-08-08T02:30:20.000Z",
    state: "training",
    stage: "evaluator-bootstrap",
    samplingMode: "action-ranking-audit",
    workerPool: { completedTasks: 0, totalTasks: 0, active: [] },
    detachedActionAudit: {
      stage: "selection-8",
      pairedSeedsCompleted: 9,
      pairedSeedsPlanned: 48,
      activeProcesses: 12,
      processCount: 12
    },
    displayContext: {
      actionAuditWorkers: {
        local: {
          activeProcesses: 12,
          processCount: 12,
          desiredProcessCount: 12,
          maximumProcessCount: 12,
          updatedAt: "2026-08-08T02:30:19.000Z"
        },
        aws: {
          activeProcesses: 1,
          processCount: 1,
          desiredProcessCount: 1,
          maximumProcessCount: 2,
          remotePhysicalAvailableMemoryBytes: 374116352,
          remoteSwapFreeBytes: 2026070016,
          updatedAt: "2026-08-08T02:30:07.000Z"
        }
      }
    },
    certificationPartitions: {}
  };
  assert.deepEqual(detachedAuditWorkerBreakdown(progress), {
    local: {
      activeProcesses: 12,
      processCount: 12,
      desiredProcessCount: 12,
      maximumProcessCount: 12,
      updatedAt: "2026-08-08T02:30:19.000Z",
      location: "local"
    },
    aws: {
      activeProcesses: 1,
      processCount: 1,
      desiredProcessCount: 1,
      maximumProcessCount: 2,
      remotePhysicalAvailableMemoryBytes: 374116352,
      remoteSwapFreeBytes: 2026070016,
      updatedAt: "2026-08-08T02:30:07.000Z",
      location: "aws"
    },
    activeProcesses: 13,
    processCount: 13,
    desiredProcessCount: 13,
    maximumProcessCount: 14
  });
  const output = formatFriendly(progress, {});
  assert.match(output, /감사 워커\s+: 작업 13 \/ 전체 13 \/ 목표 13 \/ 대기 0 \/ 최대 14/);
  assert.match(output, /로컬 워커\s+: 작업 12 \/ 전체 12 \/ 목표 12 \/ 대기 0 \/ 최대 12/);
  assert.match(output, /AWS 워커\s+: 작업 1 \/ 전체 1 \/ 목표 1 \/ 대기 0 \/ 최대 2/);
  assert.match(output, /메모리 여유 357 MB \/ 스왑 여유 1\.9 GB/);

  const scaling = structuredClone(progress);
  scaling.displayContext.actionAuditWorkers.aws.desiredProcessCount = 2;
  assert.notEqual(
    progressDisplayMarker(scaling),
    progressDisplayMarker(progress)
  );
  assert.match(formatFriendly(scaling, {}), /AWS 워커.*목표 2.*확장 중/);
});

test("AI progress display distinguishes evaluator certification from PPO collection", () => {
  const output = formatFriendly({
    runId: "run",
    updatedAt: "2026-08-01T09:00:00.000Z",
    state: "training",
    stage: "evaluator-bootstrap",
    trainingIteration: 6,
    generation: 6,
    samplingMode: "leaf-audit",
    acceptedGames: 962,
    allocatedGames: 1120,
    displayContext: { migratedAuditGames: 960 },
    workerPool: {
      completedTasks: 2,
      totalTasks: 160,
      active: Array(12).fill({})
    },
    certificationPartitions: {
      confirmation: {
        missingLeafValueDeckPhaseCoverage: [
          "origins-sett::late",
          "proving-grounds-annie::late"
        ],
        leafValueDeckPhaseCoverage: {},
        leafValueDeckPhaseReferenceGameCount: {},
        missingActionReferenceDeckPhaseCoverage: [],
        missingActionReferenceActionClassCoverage: ["mulligan"],
        actionReferenceActionClassCoverage: { mulligan: 3 },
        actionReferenceActionClassGameCount: { mulligan: 2 }
      },
      "final-audit": {
        missingLeafValueDeckPhaseCoverage: ["origins-leona::mid"],
        leafValueDeckPhaseCoverage: {},
        leafValueDeckPhaseReferenceGameCount: {},
        missingActionReferenceDeckPhaseCoverage: ["origins-kaisa::late"],
        actionReferenceDeckPhaseCoverage: {},
        actionReferenceDeckPhaseGameCount: {}
      }
    }
  }, {});
  assert.match(output, /frozen evaluator 인증 부족 조건 보충/);
  assert.match(output, /현재 묶음\s+: 2 \/ 160/);
  assert.match(output, /마이그레이션 감사 960경기/);
  assert.match(output, /세트 후반: 가치 0\/1\(1 부족\), 경기 0\/1\(1 부족\)/);
  assert.match(output, /애니 후반: 가치 0\/1\(1 부족\), 경기 0\/1\(1 부족\)/);
  assert.match(output, /현재 가치 부족\(최종\): 레오나 중반: 가치 0\/1/);
  assert.match(output, /멀리건: 행동 3\/5\(2 부족\), 경기 2\/5\(3 부족\)/);
  assert.match(output, /다음 행동 감사/);
});

test("AI progress display uses the current evaluator partition requirements", () => {
  const requirement = {
    minimumActionReferences: 450,
    minimumActionReferenceGames: 300,
    minimumLeafValuePairs: 1500,
    minimumLeafValueReferenceGames: 200,
    minimumActionReferencesPerCoreClass: 40,
    minimumActionReferenceGamesPerCoreClass: 30,
    minimumActionReferencesPerDeckPhase: 10,
    minimumActionReferenceGamesPerDeckPhase: 8,
    minimumLeafValuePairsPerDeckPhase: 20,
    minimumLeafValueReferenceGamesPerDeckPhase: 8
  };
  const output = formatFriendly({
    runId: "run",
    updatedAt: "2026-08-03T07:00:00.000Z",
    state: "training",
    stage: "evaluator-bootstrap",
    trainingIteration: 7,
    generation: 6,
    samplingMode: "action-ranking-audit",
    representativeCalibrationGames: 107,
    representativeCalibrationRequirement: 200,
    workerPool: { completedTasks: 0, totalTasks: 0, active: [] },
    certificationPartitions: {
      training: {
        requirement,
        missingActionReferenceDeckPhaseCoverage: ["deck-a::late"],
        actionReferenceDeckPhaseCoverage: { "deck-a::late": 4 },
        actionReferenceDeckPhaseGameCount: { "deck-a::late": 3 },
        missingActionReferenceActionClassCoverage: ["mulligan"],
        actionReferenceActionClassCoverage: { mulligan: 12 },
        actionReferenceActionClassGameCount: { mulligan: 10 }
      }
    }
  }, {});
  assert.match(output, /대표 보정\s+: 107 \/ 200경기/);
  assert.match(output, /학습 행동 450\/300경기 · 가치 1500\/200경기/);
  assert.match(output, /행동 4\/10\(6 부족\), 경기 3\/8\(5 부족\)/);
  assert.match(output, /멀리건: 행동 12\/40\(28 부족\), 경기 10\/30\(20 부족\)/);
});

test("AI progress display collapses missing-condition detail above five items", () => {
  const missing = Array.from({ length: 6 }, (_, index) => `deck-${index}::late`);
  const output = formatFriendly({
    runId: "run",
    updatedAt: "2026-08-03T07:00:00.000Z",
    state: "training",
    stage: "evaluator-bootstrap",
    samplingMode: "leaf-audit",
    workerPool: { completedTasks: 0, totalTasks: 0, active: [] },
    certificationPartitions: {
      confirmation: {
        missingLeafValueDeckPhaseCoverage: missing,
        leafValueDeckPhaseCoverage: {},
        leafValueDeckPhaseReferenceGameCount: {}
      }
    }
  }, {});
  assert.match(output, /비어 있는 조건 칸: 가치 6개 · 행동 0개 · 합계 6개/);
  assert.match(output, /현재 가치 부족: 6개 조건/);
  assert.doesNotMatch(output, /deck-0 후반/);
});

test("AI progress display reads structured-v2 totals from each partition", () => {
  const requirement = {
    minimumActionReferences: 450,
    minimumActionReferenceGames: 300,
    minimumLeafValuePairs: 1500,
    minimumLeafValueReferenceGames: 200,
    minimumStructuredV2ActionReferences: 450,
    minimumStructuredV2ActionReferenceGames: 300,
    minimumStructuredV2LeafValuePairs: 1500,
    minimumStructuredV2LeafValueReferenceGames: 200
  };
  const output = formatFriendly({
    runId: "run",
    updatedAt: "2026-08-04T07:00:00.000Z",
    state: "training",
    stage: "evaluator-bootstrap",
    samplingMode: "action-ranking-audit",
    acceptedGames: 1671,
    displayContext: { migratedAuditGames: 1592 },
    workerPool: {
      completedTasks: 47,
      totalTasks: 48,
      processCount: 12,
      active: [{ slotIndex: 6 }]
    },
    certificationPartitions: {
      training: {
        requirement,
        acceptedGames: 1460,
        actionReferenceCount: 219,
        actionReferenceGameCount: 218,
        leafValuePairCount: 2135,
        leafValueReferenceGameCount: 273,
        structuredV2ActionReferenceCount: 0,
        structuredV2ActionReferenceGameCount: 0,
        structuredV2LeafValuePairCount: 190,
        structuredV2LeafValueReferenceGameCount: 24
      }
    }
  }, {});
  assert.match(output, /학습 v2: 행동 0\/450\(경기 0\/300\) · 가치 190\/1500\(경기 24\/200\)/);
  assert.match(output, /현재 묶음\s+: 47 \/ 48 \(97\.9%\)/);
  assert.match(output, /자료 구성\s+: 마이그레이션 감사 1592경기 · 이후 신규 79경기/);
  assert.match(
    output,
    /워커\s+: 작업 1 \/ 전체 12 \/ 목표 12 \/ 최대 12 \/ 대기 11/
  );
  assert.match(output, /현재 파티션 ETA: v2 행동 수율 미측정으로 계산 불가/);
});

test("AI progress display exposes shadow-development risks without calling them official certification", () => {
  const progress = {
    runId: "run",
    updatedAt: "2026-08-07T09:00:00.000Z",
    state: "training",
    stage: "evaluator-early-diagnostic-checkpoint",
    evaluatorEarlyDiagnostic: {
      checkpointId: "v2-100-action-300-leaf",
      status: {
        status: "strong-warning-continue",
        candidateCount: 6,
        completeCandidateCount: 6,
        bestAnchorMinimumAccuracy: 0.54,
        bestAnchorMinimumUpperBound: 0.68,
        shadowDevelopment: {
          candidateRiskCount: 2,
          warnings: [
            "shadow-development-generalization-gap",
            "shadow-development-stratum-risk"
          ]
        }
      }
    }
  };
  const output = formatFriendly(progress, {});
  assert.match(output, /위험 신호 · 계속 수집/);
  assert.match(output, /고정 검증\s+: 최저 정확도 54\.0% · 낙관 상한 68\.0%/);
  assert.match(output, /후보 2 \/ 6 · 일반화 격차, 취약 구간/);
  assert.match(output, /공식 holdout에는 미사용/);
  assert.notEqual(
    progressDisplayMarker(progress),
    progressDisplayMarker({
      ...progress,
      evaluatorEarlyDiagnostic: {
        ...progress.evaluatorEarlyDiagnostic,
        status: {
          ...progress.evaluatorEarlyDiagnostic.status,
          status: "promising"
        }
      }
    })
  );
});

test("Policy-Q progress separates Training value evidence from locked official holdouts", () => {
  const requirement = {
    minimumStructuredV2ActionReferences: 0,
    minimumStructuredV2ActionReferenceGames: 0,
    minimumStructuredV2LeafValuePairs: 1500,
    minimumStructuredV2LeafValueReferenceGames: 200,
    minimumLeafValuePairsByPhase: {
      mulligan: 250, early: 250, mid: 250, late: 250
    },
    minimumLeafValueReferenceGamesByPhase: {
      mulligan: 80, early: 80, mid: 80, late: 80
    }
  };
  const progress = {
    runId: "run",
    updatedAt: "2026-08-10T03:00:00.000Z",
    state: "training",
    stage: "evaluator-bootstrap",
    evaluatorCertificateKind: "policy-q",
    evidenceCheckpointId: "policy-q-shadow-readiness-1",
    activeEvidenceRoles: ["training"],
    samplingMode: "leaf-audit",
    workerPool: {
      completedTasks: 8,
      totalTasks: 24,
      processCount: 12,
      active: Array(12).fill({})
    },
    certificationPartitions: {
      training: {
        requirement,
        structuredV2LeafValuePairCount: 900,
        structuredV2LeafValueReferenceGameCount: 120,
        structuredV2LeafValuePhaseCoverage: {
          mulligan: 210, early: 230, mid: 250, late: 210
        },
        structuredV2LeafValuePhaseReferenceGameCount: {
          mulligan: 60, early: 70, mid: 80, late: 55
        }
      },
      development: { requirement: {}, structuredV2LeafValuePairCount: 0 },
      confirmation: { requirement: {}, structuredV2LeafValuePairCount: 0 },
      "final-audit": { requirement: {}, structuredV2LeafValuePairCount: 0 }
    }
  };
  const output = formatFriendly(progress, {});
  assert.match(output, /Policy-Q 관문: 1\/6 Training 가치증거 확보/);
  assert.match(output, /Policy-Q 흐름: \[Training 가치증거\].*Shadow 준비도 잠김/);
  assert.match(output, /행동 증거\s+: 이번 Policy-Q 완료 조건 아님/);
  assert.match(output, /행동 조건\s+: 이번 Policy-Q 수집에서는 완료 판정에서 제외/);
  assert.doesNotMatch(output, /다음 행동 감사/);
  assert.match(output, /잠긴 파티션 : 3개/);
  assert.doesNotMatch(output, /개발 v2:/);

  const telegram = formatTelegramFriendly(progress, {});
  assert.match(telegram, /학습 V2 가치: 900\/1500쌍 · 120\/200경기/);
  assert.match(telegram, /멀리건 210\/250\(60\/80경기\)/);
  assert.match(telegram, /행동증거: 이번 Policy-Q 완료 조건 아님/);
  assert.doesNotMatch(telegram, /===== AI 학습 진행 상황/);
});

test("Policy-Q shadow progress shows the precommitted grid and protected Development", () => {
  const progress = {
    runId: "run",
    updatedAt: "2026-08-10T03:00:00.000Z",
    state: "training",
    stage: "shared-evidence-training",
    evaluatorTrainingPurpose: "policy-q-shadow-grid-structured-attention-v2-128-lr-0001-epochs-12",
    evaluatorArchitecture: "structured-attention-v2-128",
    evaluatorCandidate: 1,
    evaluatorCandidates: 1,
    evaluatorTrainingReplica: 0,
    evaluatorTrainingReplicas: 1,
    epoch: 5,
    loss: 0.2,
    evaluatorEvaluationProgress: {
      section: "shadow-validation",
      completedEntries: 4,
      totalEntries: 10,
      actionDecisions: 8,
      actionAccuracy: 0.625,
      leafDecisions: 20,
      leafAccuracy: 0.65,
      preliminary: true
    },
    policyQReadinessProgress: {
      phase: "configuration-grid",
      currentConfiguration: 11,
      completedConfigurations: 10,
      totalConfigurations: 27,
      architecture: "structured-attention-v2-128",
      learningRate: 0.0001,
      epochs: 12,
      protectedDevelopmentOpened: false
    }
  };
  const output = formatFriendly(progress, {});
  assert.match(output, /Policy-Q 관문: 2\/6 학습률·epoch 탐색/);
  assert.match(output, /Shadow 현황\s+: 10 완료 · 1 진행 · 16 대기/);
  assert.match(output, /현재 검사\s+: 11 \/ 27/);
  assert.match(output, /전체 가치 63%\+ · 각 시점 65%\+/);
  assert.match(output, /공식 Development 미공개/);
  assert.match(output, /상위 3개 구조의 학습률·epoch 격자 비교/);
  assert.match(output, /Shadow validation 4\/10 \(40\.0%\)/);
  assert.match(output, /가치 65\.0%\(20판정\).*행동 62\.5%\(8판정\)/);
  assert.match(output, /신뢰구간과 최종 합격 판정 전/);
  const telegram = formatTelegramFriendly(progress, {});
  assert.match(telegram, /현재: Policy-Q 평가기 후보 학습/);
  assert.match(telegram, /전체 후보: 10 완료 · 1 진행 · 16 대기/);
  assert.match(telegram, /현재 후보: structured-attention-v2-128 · 11\/27/);
  assert.match(telegram, /초기값: 1\/1/);
  assert.match(telegram, /학습: epoch 5\/12/);
  assert.match(telegram, /지표: loss 0\.2000/);
  assert.match(telegram, /채점: Shadow validation 4\/10 \(40\.0%\)/);
  assert.match(telegram, /잠정 점수: 가치 65\.0%\(20판정\).*행동 62\.5%\(8판정\)/);
});
