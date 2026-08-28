import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  POLICY_Q_FORMAL_AUDIT_REQUIREMENTS,
  POLICY_Q_SHADOW_READINESS_GRID
} from "./evaluator-policy-q-readiness.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const dataRoot = path.resolve(
  args["data-dir"] || process.env.RIFTBOUND_AI_DATA_DIR || "data/ai"
);
const latestPath = path.join(dataRoot, "progress", "latest.json");
const intervalMs = Math.max(500, Number(args["interval-ms"]) || 2000);
const telegramEnabled = args.telegram === "true";
const telegramBotToken = process.env.RIFTBOUND_TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.RIFTBOUND_TELEGRAM_CHAT_ID;
let telegramReady = args["skip-initial-telegram"] !== "true";
let lastDisplayMarker = null;
let waitingWasPrinted = false;
const baselines = new Map();
const evidenceYieldBaselines = new Map();
const policyQStageBaselines = new Map();
const policyQLossBaselines = new Map();
const CERTIFICATION_ROLE_ORDER = [
  "training",
  "development",
  "confirmation",
  "final-audit"
];

async function printLatest() {
  try {
    const latest = JSON.parse(await readFile(latestPath, "utf8"));
    waitingWasPrinted = false;
    // Collection workers update the progress sequence on every heartbeat so
    // elapsed task time remains observable. A heartbeat is not new training
    // progress, however, and printing the complete last-game block for it made
    // one result appear once per minute while also pushing the ETA backwards.
    const displayProgress = await enrichDetachedAuditProgress(latest);
    const marker = args["show-heartbeats"] === "true"
      ? `${latest.runId}:${latest.sequence}`
      : progressDisplayMarker(displayProgress);
    if (marker === lastDisplayMarker) return;
    const modelContext = await loadModelContext();
    const output = args.json === "true"
      ? JSON.stringify(displayProgress, null, 2)
      : formatFriendly(displayProgress, modelContext);
    console.log(output);
    if (telegramEnabled && telegramReady) {
      await sendTelegramMessage({
        botToken: telegramBotToken,
        chatId: telegramChatId,
        text: args["telegram-full"] === "true"
          ? output
          : formatTelegramFriendly(displayProgress, modelContext)
      });
    }
    telegramReady = true;
    lastDisplayMarker = marker;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!waitingWasPrinted) {
      console.log(`Waiting for training progress: ${latestPath}`);
      waitingWasPrinted = true;
    }
  }
}

export function progressDisplayMarker(progress) {
  const common = [progress.runId, progress.state, progress.stage, progress.generation, progress.trainingIteration];
  if (progress.state === "collecting") {
    return JSON.stringify([
      ...common,
      progress.completedGames ?? 0,
      progress.targetGames ?? progress.games ?? 0,
      progress.lastGame?.workerIndex ?? null,
      progress.lastGame?.gameIndex ?? null,
      progress.lastGame?.completed ?? null
    ]);
  }
  if (progress.state === "training") {
    if (progress.stage === "evaluator-bootstrap") {
      return JSON.stringify([
        ...common,
        progress.samplingMode ?? null,
        progress.evaluatorCertificateKind ?? null,
        progress.evidenceCheckpointId ?? null,
        ...(progress.activeEvidenceRoles || []),
        progress.acceptedGames ?? 0,
        progress.allocatedGames ?? 0,
        progress.actionReferenceCount ?? 0,
        progress.actionReferenceGameCount ?? 0,
        progress.leafValuePairCount ?? 0,
        progress.leafValueReferenceGameCount ?? 0,
        progress.representativeCalibrationGames ?? 0,
        progress.workerPool?.completedTasks ?? 0,
        progress.workerPool?.totalTasks ?? 0,
        progress.workerPool?.processCount ?? null,
        ...Object.entries(progress.certificationPartitions || {}).flatMap(
          ([role, partition]) => [
            role,
            partition.structuredV2ActionReferenceCount ?? 0,
            partition.structuredV2ActionReferenceGameCount ?? 0,
            partition.structuredV2LeafValuePairCount ?? 0,
            partition.structuredV2LeafValueReferenceGameCount ?? 0,
            partition.complete === true
          ]
        ),
        progress.detachedActionAudit?.stage ?? null,
        progress.detachedActionAudit?.completedSeedBatches ?? 0,
        progress.detachedActionAudit?.totalSeedBatches ?? 0,
        progress.detachedActionAudit?.pairedSeedsCompleted ?? 0,
        progress.detachedActionAudit?.pairedSeedsPlanned ?? 0,
        ...actionAuditWorkerMarker(progress),
        progress.complete === true
      ]);
    }
    return JSON.stringify([
      ...common,
      progress.evaluatorTrainingPurpose ?? null,
      progress.evaluatorArchitecture ?? null,
      progress.evaluatorCandidate ?? null,
      progress.evaluatorCandidates ?? null,
      progress.evaluatorTrainingReplica ?? null,
      progress.policyQReadinessProgress?.phase ?? null,
      progress.policyQReadinessProgress?.currentConfiguration ?? null,
      progress.policyQReadinessProgress?.completedConfigurations ?? null,
      progress.policyQReadinessProgress?.passed ?? null,
      progress.evaluatorEarlyDiagnostic?.checkpointId ?? null,
      progress.evaluatorEarlyDiagnostic?.status?.status ?? null,
      progress.evaluatorEarlyDiagnostic?.status?.shadowDevelopment
        ?.candidateRiskCount ?? null,
      progress.epoch ?? 0,
      progress.completedBatches ?? progress.batch ?? 0,
      progress.totalBatches ?? null
    ]);
  }
  if (progress.state === "evaluating") {
    return JSON.stringify([
      ...common,
      progress.opponent ?? null,
      progress.game ?? 0,
      progress.completed ?? null,
      progress.candidateWins ?? progress.progress?.candidateWins ?? null
    ]);
  }
  if (progress.state === "error") {
    return JSON.stringify([...common, progress.failurePath, progress.error?.message]);
  }
  if (progress.state === "idle") {
    return JSON.stringify([...common, progress.promoted, progress.completedGames]);
  }
  return JSON.stringify(common);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (telegramEnabled && (!telegramBotToken || !telegramChatId)) {
    throw new Error(
      "Telegram notifications require RIFTBOUND_TELEGRAM_BOT_TOKEN and RIFTBOUND_TELEGRAM_CHAT_ID."
    );
  }
  await printLatest();
  if (args.once !== "true") {
    let printInFlight = false;
    setInterval(async () => {
      // Telegram/network I/O can outlive an interval. Do not stack another
      // 2 MiB telemetry read and formatter while the prior update is pending.
      if (printInFlight) return;
      printInFlight = true;
      try {
        await printLatest();
      } catch (error) {
        console.error(error);
      } finally {
        printInFlight = false;
      }
    }, intervalMs);
  }
}

export function formatFriendly(progress, modelContext) {
  const lines = ["", `===== AI 학습 진행 상황 · ${formatDate(progress.updatedAt)} =====`];
  lines.push(`상태        : ${stateLabel(progress.state)}${progress.stage ? ` / ${stageLabel(progress.stage)}` : ""}`);
  lines.push(`반복/세대   : iteration ${progress.trainingIteration ?? "-"} / generation ${progress.generation ?? "-"}`);

  if (progress.state === "collecting") {
    const completed = progress.completedGames ?? 0;
    const target = progress.targetGames ?? progress.games ?? 0;
    lines.push(`경기 수집    : ${completed} / ${target} (${percent(completed, target)})`);
    lines.push(`재사용/재시도: ${progress.resumedGames ?? 0} / ${progress.retriedGames ?? 0}`);
    if (progress.lastGame) {
      lines.push(`마지막 경기  : worker ${progress.lastGame.workerIndex}, game ${progress.lastGame.gameIndex} · ${progress.lastGame.completed ? "정상 완료" : "미완료"}`);
      const summary = progress.lastGame.summaries?.[0];
      if (summary) appendGameDetails(lines, summary, progress, modelContext);
    }
    if (progress.workerPool?.active?.length) {
      lines.push(`실행 방식    : 별도 프로세스 ${progress.workerPool.active.length}개 · 동적 경기 큐`);
      lines.push(`현재 작업    : ${progress.workerPool.active.map((item) => `slot ${item.slotIndex} → worker ${item.workerIndex}, game ${item.gameIndex} (${Math.floor(item.elapsedSeconds / 60)}분 ${item.elapsedSeconds % 60}초)`).join(" | ")}`);
    }
  } else if (progress.state === "training"
    && progress.stage === "evaluator-bootstrap") {
    const accepted = progress.acceptedGames ?? 0;
    const allocated = progress.allocatedGames ?? 0;
    const actionReferences = progress.actionReferenceCount ?? 0;
    const actionGames = progress.actionReferenceGameCount ?? 0;
    const leafPairs = progress.leafValuePairCount ?? 0;
    const leafGames = progress.leafValueReferenceGameCount ?? 0;
    const trainingPartition = progress.certificationPartitions?.training || {};
    const structuredV2ActionReferences =
      trainingPartition.structuredV2ActionReferenceCount ?? 0;
    const structuredV2ActionGames =
      trainingPartition.structuredV2ActionReferenceGameCount ?? 0;
    const structuredV2LeafPairs =
      trainingPartition.structuredV2LeafValuePairCount ?? 0;
    const structuredV2LeafGames =
      trainingPartition.structuredV2LeafValueReferenceGameCount ?? 0;
    const calibrationGames = progress.representativeCalibrationGames ?? 0;
    const policyQBootstrap = progress.evaluatorCertificateKind === "policy-q";
    lines.push(`수집 모드   : ${bootstrapSamplingModeLabel(progress.samplingMode)}`);
    const completedTasks = Number(progress.workerPool?.completedTasks) || 0;
    const totalTasks = Number(progress.workerPool?.totalTasks) || 0;
    lines.push(`현재 목적   : ${policyQBootstrap
      ? "Policy-Q용 상태가치 증거 확보 (PPO 경기·Robust 행동증거 재수집 아님)"
      : "frozen evaluator 인증 부족 조건 보충 (PPO 경기 재수집 아님)"}`);
    if (policyQBootstrap) appendPolicyQReadinessOverview(lines, progress);
    appendCertificationPipeline(lines, progress);
    if (totalTasks > 0) {
      lines.push(
        `현재 묶음   : ${completedTasks} / ${totalTasks}`
        + ` (${percent(completedTasks, totalTasks)}) · 조건 충족 시 조기 종료`
      );
    } else {
      lines.push("현재 묶음   : 다음 동적 할당 대기");
    }
    const migratedAuditGames = Number(
      progress.displayContext?.migratedAuditGames
    );
    const exactMigratedGames = Number.isFinite(migratedAuditGames)
      ? migratedAuditGames
      : null;
    lines.push(
      `자료 구성   : ${modelContext?.trainingStatus?.resumedArchive
        ? `기존 PPO ${modelContext.trainingStatus.games ?? "-"}경기 · `
        : ""}마이그레이션 감사 ${exactMigratedGames == null
          ? "확인 중"
          : `${exactMigratedGames}경기`}`
      + `${exactMigratedGames == null
        ? ""
        : ` · 이후 신규 ${Math.max(0, accepted - exactMigratedGames)}경기`}`
      + ` · 누적 ${accepted}경기`
    );
    appendCertificationNeeds(lines, progress);
    if (progress.actionEvidenceProtocol && !policyQBootstrap) {
      appendActionEvidenceProtocol(lines, progress.actionEvidenceProtocol);
      const grades = progress.actionEvidenceGradeCounts || {};
      const strengths =
        progress.actionEvidenceStatisticalStrengthCounts || {};
      const scopes = progress.actionEvidenceContinuationScopeCounts || {};
      const natural = progress.naturalDistributionActionAudit || {};
      const efficiency = progress.actionEvidenceComputeEfficiency || {};
      lines.push(
        `초반 증거   : robust ${Number(grades["terminal-robust"]) || 0}`
        + ` · consistent ${Number(grades["continuation-consistent"]) || 0}`
        + ` · legacy ${Number(grades["legacy-terminal-conditioned"]) || 0}`
        + ` · 독립 시작상태 ${Number(
          progress.actionEvidenceIndependentOpeningStateCount
        ) || 0}`
      );
      lines.push(
        `기존 증거 재판정: 고신뢰 ${Number(strengths.high) || 0}`
        + ` · 중신뢰 ${Number(strengths.medium) || 0}`
        + ` · 무효 ${Number(strengths.invalid) || 0}`
        + ` | π조건부 ${Number(scopes["policy-conditioned"]) || 0}`
      );
      lines.push(
        `평가기 권한 : ${progress.evaluatorCertificateKind === "robust-action"
          ? "Robust-Action (행동 교정·공식 행동 인증 가능)"
          : "Policy-Q (가치·탐색·Q 학습 전용, 보편 행동 인증 금지)"}`
      );
      lines.push(
        `다음 인증   : ${progress.strongContinuationPoolReady === true
          ? `강한 독립 continuation ${Number(
            progress.strongContinuationCandidates
          ) || 0}개 확보 · Robust-Action 전환 가능`
          : `Policy-Q 이후 전체 정책 강화 대기 · 강한 독립 continuation ${Number(
            progress.strongContinuationCandidates
          ) || 0}/2`}`
      );
      lines.push(
        `자연분포 감사: ${Number(natural.states) || 0}상태`
        + ` · 판정 가능 ${formatOptionalPercent(natural.decisiveCoverage)}`
        + ` · 동급 ${Number(natural.nearEquivalent) || 0}`
        + ` · 불확실 ${Number(natural.inconclusive) || 0}`
      );
      lines.push(
        `증거 효율   : ${formatOptionalRate(
          efficiency.evidencePerComputeHour
        )}/계산시간 · ${formatOptionalRate(
          efficiency.evidencePerWallHour
        )}/실시간`
      );
    } else if (policyQBootstrap) {
      lines.push(
        "행동 증거   : 이번 Policy-Q 완료 조건 아님"
        + " · 기존 고신뢰 자료는 Q-head 보조학습에만 재사용"
      );
      lines.push(
        "권한 경계   : 탐색 leaf·가치/Q 제안만 허용"
        + " · 보편 행동 정답·직접 정책 교정은 Robust-Action 이후"
      );
      const effect = progress.leafActionEffectAudit || {};
      if (Number(effect.comparisons) > 0) {
        lines.push(
          `행동효과 감사: targeted ${Number(effect.targeted) || 0}`
          + ` · natural ${Number(effect.natural) || 0}`
          + ` | decisive ${Number(effect.decisive) || 0}`
          + ` · 동급 ${Number(effect.nearEquivalent) || 0}`
          + ` · 불확실 ${Number(effect.inconclusive) || 0}`
        );
        lines.push(
          `감사 정밀도 : paired ${Number(effect.totalPairedSamples) || 0}쌍`
          + ` · 평균 CI 폭 ${formatOptionalPercent(
            effect.meanIntervalWidth
          )}`
        );
      }
    }
    if (progress.stratumVersion) {
      lines.push(`행동 단계별 : ${formatAuditPhaseEvidence(
        progress.actionReferencePhaseCoverage,
        progress.actionReferencePhaseGameCount
      )}`);
      lines.push(`가치 단계별 : ${formatAuditPhaseEvidence(
        progress.leafValuePhaseCoverage,
        progress.leafValuePhaseReferenceGameCount
      )}`);
    }
    const calibrationRequirement = Math.max(
      1,
      Number(progress.representativeCalibrationRequirement) || 100
    );
    lines.push(
      `대표 보정   : ${calibrationGames} / ${calibrationRequirement}경기`
    );
    if (progress.workerPool) {
      const workerView = evaluatorBootstrapWorkerView(progress);
      const workerCompletedTasks = workerView.completedTasks;
      const workerTotalTasks = progress.workerPool.totalTasks ?? 0;
      const workerTotal = Math.max(
        workerView.activeWorkers,
        Number(progress.workerPool.processCount) || 0
      );
      const workerDesiredValue = Number(
        progress.workerPool.desiredProcessCount
      );
      const workerDesired = Number.isFinite(workerDesiredValue)
        ? Math.max(0, workerDesiredValue)
        : workerTotal;
      const workerMaximum = Math.max(
        workerDesired,
        Number(progress.workerPool.maximumProcessCount) || 0
      );
      const workerScaleStatus = workerDesired > workerTotal
        ? " · 확장 중"
        : workerDesired < workerTotal
          ? " · 축소 중"
          : "";
      lines.push(
        `워커        : 작업 ${workerView.activeWorkers}`
        + ` / 전체 ${workerTotal || "확인 중"}`
        + (workerMaximum > 0
          ? ` / 목표 ${workerDesired} / 최대 ${workerMaximum}${workerScaleStatus}`
          : "")
        + ` / 대기 ${workerTotal ? Math.max(0, workerTotal - workerView.activeWorkers) : "-"}`
      );
      lines.push(`묶음 작업   : ${workerCompletedTasks} / ${workerTotalTasks} 완료`);
      if (progress.workerPool.draining === true) {
        lines.push("중단 상태   : 진행 중인 경기 완료 후 안전 중단");
      }
    }
    if (progress.detachedActionAudit) {
      const audit = progress.detachedActionAudit;
      const auditGames = Number(audit.games);
      const auditTotalGames = Number(audit.totalGames);
      if (Number.isFinite(auditGames) && auditTotalGames > 0) {
        lines.push(
          `행동감사 전체: ${auditGames} / ${auditTotalGames}`
          + ` (${percent(auditGames, auditTotalGames)})`
          + ` · 남은 게임 ${Math.max(0, auditTotalGames - auditGames)}`
        );
      } else {
        const remaining = Math.max(0, allocated - accepted);
        lines.push(
          `행동감사 전체: 확정 ${accepted} / 계획 ${allocated}`
          + ` (${percent(accepted, allocated)}) · 미확정 ${remaining}경기`
        );
      }
      const procedure = detachedAuditProcedureProgress(audit);
      if (procedure) {
        lines.push(
          `검증 절차     : ${procedure.step} / ${procedure.totalSteps}단계`
          + ` (${procedure.label}, 단계 내 ${percent(procedure.completed, procedure.total)})`
        );
      }
      lines.push(
        `행동 감사   : ${detachedAuditStageLabel(audit.stage)}`
        + ` · seed 묶음 ${audit.completedSeedBatches ?? 0} / ${audit.totalSeedBatches ?? 0}`
      );
      lines.push(
        `감사 연산   : paired seed ${audit.pairedSeedsCompleted ?? 0}`
        + ` / ${audit.pairedSeedsPlanned ?? 0}`
      );
      appendDetachedAuditWorkers(lines, progress);
    }
    const missingAction =
      progress.missingActionReferenceCoverage?.length || 0;
    const missingLeaf = progress.missingLeafValueCoverage?.length || 0;
    const missingActionPhases =
      progress.missingActionReferencePhaseCoverage || [];
    const missingLeafPhases =
      progress.missingLeafValuePhaseCoverage || [];
    const partitionRequirements = Object.entries(
      progress.certificationPartitions || {}
    ).map(([role, partition]) => {
      const requirement = partition?.requirement || {};
      if (policyQBootstrap) {
        return `${certificationRoleLabel(role)} 전체 `
          + `${Number(partition.acceptedGames) || 0}`
          + `/${Number(requirement.minimumGames) || 0}경기 · 가치 `
          + `${Number(requirement.minimumLeafValuePairs) || 0}`
          + `/${Number(requirement.minimumLeafValueReferenceGames) || 0}경기`;
      }
      return `${certificationRoleLabel(role)} 행동 `
        + `${Number(requirement.minimumActionReferences) || 0}`
        + `/${Number(requirement.minimumActionReferenceGames) || 0}경기`
        + ` · 가치 ${Number(requirement.minimumLeafValuePairs) || 0}`
        + `/${Number(requirement.minimumLeafValueReferenceGames) || 0}경기`
        + (Number(requirement.continuationConsistentMinimum) > 0
          ? ` · 초반 일관 ${Number(
            partition.actionEvidenceGradeCounts?.[
              "continuation-consistent"
            ]
          ) || 0}/${Number(requirement.continuationConsistentMinimum)}`
          : "")
        + (Number(requirement.naturalDistributionAuditMinimum) > 0
          ? ` · 자연 ${Number(
            partition.naturalDistributionActionAudit?.states
          ) || 0}/${Number(requirement.naturalDistributionAuditMinimum)}`
          : "");
    });
    if (partitionRequirements.length > 0) {
      lines.push(`완료 기준   : ${partitionRequirements.join(" | ")}`);
    } else {
      lines.push("완료 기준   : 역할별 증거 요구량을 불러오는 중");
    }
    if (policyQBootstrap) {
      lines.push(`공식 효과계약: ${formatPolicyQFormalActionEffectTargets()}`);
    }
    if (policyQBootstrap) {
      if (missingLeaf) {
        lines.push(`부족 조건   : 가치 덱·좌석 ${missingLeaf}개`);
      }
    } else if (missingAction || missingLeaf) {
      lines.push(`부족 조건   : 행동 덱·좌석 ${missingAction}개 · 가치 덱·좌석 ${missingLeaf}개`);
    }
    if (policyQBootstrap && missingLeafPhases.length) {
      lines.push(`부족 단계   : 가치 ${missingLeafPhases.join(", ")}`);
    } else if (!policyQBootstrap
      && (missingActionPhases.length || missingLeafPhases.length)) {
      lines.push(
        `부족 단계   : 행동 ${missingActionPhases.join(", ") || "없음"}`
        + ` · 가치 ${missingLeafPhases.join(", ") || "없음"}`
      );
    }
    if (progress.complete === true) lines.push("인증 자료   : 수집 완료");
    appendEvaluatorTiming(lines, progress);
  } else if (progress.state === "training"
    && progress.stage === "evaluator-bootstrap-compatible-migration") {
    lines.push("현재 작업   : 기존 evaluator 감사 기록을 새 증거 계약으로 호환 전환 중");
    lines.push("자료 보존   : 저장된 경기·V1/V2 증거 재사용 · PPO/감사 경기 재수집 아님");
    if (progress.sourceEvaluatorBootstrapDatasetKey
      || progress.evaluatorBootstrapDatasetKey) {
      lines.push(
        `자료 전환   : ${shortDigest(progress.sourceEvaluatorBootstrapDatasetKey)}`
        + ` → ${shortDigest(progress.evaluatorBootstrapDatasetKey)}`
      );
    }
    if (progress.actionEvidenceProtocol) {
      appendActionEvidenceProtocol(lines, progress.actionEvidenceProtocol);
    }
    lines.push("AWS 보조    : 전환 완료 후 분리 행동감사 큐가 열리면 자동 연결");
  } else if (progress.state === "training") {
    if (progress.policyQReadinessProgress
      || progress.evaluatorTrainingPurpose?.startsWith("policy-q-")
      || progress.evaluatorTrainingPurpose === "official-development") {
      appendPolicyQReadinessOverview(lines, progress);
    }
    if (progress.evaluatorArchitecture) {
      lines.push(
        `평가기 후보   : ${progress.evaluatorArchitecture}`
        + ` · ${progress.evaluatorCandidate ?? "-"}`
        + ` / ${progress.evaluatorCandidates ?? "-"}`
        + ` · seed ${(Number(progress.evaluatorTrainingReplica) || 0) + 1}`
      );
      if (progress.evaluatorTrainingPurpose?.startsWith("early-diagnostic-")) {
        lines.push(`조기 진단    : ${progress.evaluatorTrainingPurpose.replace("early-diagnostic-", "")}`);
        lines.push("판정 용도    : Training 전용 실패 탐지 · 공식 인증/선택에는 미사용");
      }
      if (progress.evaluatorTrainingPurpose?.startsWith("policy-q-shadow-")) {
        lines.push(
          `Shadow 작업 : ${policyQTrainingPurposeLabel(
            progress.evaluatorTrainingPurpose
          )}`
        );
      }
    }
    appendEvaluatorEvaluationProgress(
      lines,
      progress.evaluatorEvaluationProgress
    );
    const earlyDiagnostic = progress.evaluatorEarlyDiagnostic;
    if (earlyDiagnostic?.status) {
      const status = earlyDiagnostic.status;
      const shadow = status.shadowDevelopment || {};
      lines.push(
        `조기 진단    : ${earlyDiagnostic.checkpointId || "-"}`
        + ` · ${earlyDiagnosticStatusLabel(status.status)}`
      );
      lines.push(
        `고정 검증    : 최저 정확도 ${percentMetric(status.bestAnchorMinimumAccuracy)}`
        + ` · 낙관 상한 ${percentMetric(status.bestAnchorMinimumUpperBound)}`
      );
      if (Number(shadow.candidateRiskCount) > 0) {
        lines.push(
          `개발 위험    : 후보 ${shadow.candidateRiskCount}`
          + ` / ${status.completeCandidateCount || status.candidateCount || 0}`
          + ` · ${(shadow.warnings || []).map(earlyDiagnosticWarningLabel).join(", ")}`
        );
      } else {
        lines.push("개발 위험    : 현재 표본에서 반복 위험 신호 없음");
      }
      lines.push("판정 용도    : Training shadow-development · 공식 holdout에는 미사용");
    }
    const epochTotal = policyQTrainingEpochTotal(progress);
    lines.push(
      `epoch       : ${progress.epoch ?? 0} / ${epochTotal || progress.epochs || "-"}`
      + (epochTotal
        ? ` (${percent(Number(progress.epoch) || 0, epochTotal)})`
        : "")
    );
    if (progress.totalBatches) lines.push(`batch       : ${progress.completedBatches ?? progress.batch ?? 0} / ${progress.totalBatches} (${percent(progress.completedBatches ?? progress.batch ?? 0, progress.totalBatches)})`);
    if (progress.metrics || Number.isFinite(Number(progress.loss))) {
      const metrics = [
        policyQLossMetric(progress),
        numberMetric("policy", progress.metrics?.policyLoss),
        numberMetric("value", progress.metrics?.valueLoss),
        numberMetric("entropy", progress.metrics?.entropy)
      ].filter(Boolean);
      if (metrics.length) lines.push(`학습 지표    : ${metrics.join(" · ")}`);
    }
    const policyQEta = policyQTrainingEta(progress);
    if (policyQEta) lines.push(`후보 예상    : ${policyQEta}`);
  } else if (progress.state === "evaluating") {
    const game = progress.game ?? 0;
    const games = progress.games ?? 0;
    lines.push(`평가 경기    : ${game} / ${games} (${percent(game, games)})`);
    lines.push(`완료/승리    : ${progress.completed ?? 0} / ${progress.candidateWins ?? progress.progress?.candidateWins ?? 0}`);
    const rate = progress.winRate ?? progress.progress?.winRate;
    if (Number.isFinite(rate)) lines.push(`중간 승률    : ${(rate * 100).toFixed(1)}%`);
    if (progress.opponents) lines.push(`리그 상대    : ${progress.opponent ?? 0} / ${progress.opponents} · 상대 내 경기 ${progress.opponentGame ?? 0} / ${progress.gamesPerOpponent ?? "-"}`);
    if (progress.resumedGames) lines.push(`재사용 경기  : ${progress.resumedGames}`);
    const summary = progress.summary || progress.progress?.summary;
    if (summary) appendGameDetails(lines, summary, progress, modelContext);
  } else if (progress.state === "idle") {
    lines.push(`승격 결과    : ${progress.promoted ? "승격 성공" : "승격하지 않음 (learner는 계속 보존)"}`);
    if (progress.completedGames != null) lines.push(`수집 완료    : ${progress.completedGames}경기`);
  } else if (progress.state === "error") {
    lines.push(`오류         : ${progress.error?.message || "알 수 없는 오류"}`);
    if (progress.failurePath) lines.push(`오류 기록    : ${progress.failurePath}`);
  } else if (progress.state === "interrupted") {
    if ([
      "evaluator-policy-q-shadow-readiness-unmet",
      "evaluator-policy-q-shadow-inconclusive",
      "evaluator-policy-q-shadow-structural-failure"
    ].includes(progress.stage)) {
      const structuralFailure = progress.stage
        === "evaluator-policy-q-shadow-structural-failure";
      appendPolicyQReadinessOverview(lines, {
        ...progress,
        policyQReadinessProgress: {
          phase: structuralFailure ? "structural-failure" : "inconclusive",
          protectedDevelopmentOpened: false,
          passed: false,
          reasons: progress.policyQShadowReadiness?.reasons || []
        }
      });
      lines.push(structuralFailure
        ? "중단 의미   : 복수 초기값에서 낙관적 상한도 미달 · 모델 구조 검토 필요"
        : "중단 의미   : 실패 아님 · 표본상 불확실 · 공식 Development는 열지 않음");
      lines.push(structuralFailure
        ? "재개 조건   : 모델/표현/학습 경로를 검토한 뒤 재개"
        : "재개 조건   : 취약 Training 시점의 독립 경기 보충 후 재개 가능");
    } else {
      lines.push("중단 상태   : 현재 단계가 안전하게 보존되어 재개 가능");
    }
  }

  const eta = progress.state === "training"
    && progress.stage === "evaluator-bootstrap"
    ? null
    : estimateEta(progress);
  if (eta) {
    lines.push(
      `${progress.detachedActionAudit?.totalGames
        ? "행동감사 ETA"
        : progress.stage === "evaluator-bootstrap" && Number(progress.workerPool?.totalTasks) > 0
          ? "최대 한도 ETA"
          : "현재 단계 ETA"}: ${eta}`
    );
  }
  lines.push("===============================================");
  return lines.join("\n");
}

function appendPolicyQReadinessOverview(lines, progress) {
  if (policyQLegacyHandoff(progress)) {
    lines.push("Policy-Q 관문: 기존 실행의 마지막 경기 안전 인계 중");
    lines.push(
      "자료 경계   : 완료 경기와 기존 증거는 전부 보존"
      + " · 재개 후 새 Training-only Shadow 계약으로 재판정"
    );
    return;
  }
  const readiness = progress.policyQReadinessProgress || {};
  const phase = readiness.phase || inferPolicyQPhase(progress);
  lines.push(`Policy-Q 관문: ${policyQPhaseLabel(phase)}`);
  if (phase === "training-evidence") {
    lines.push(
      "자료 경계   : Training 가치증거만 수집"
      + " · Shadow/Development/Confirmation/Final은 미공개"
    );
  } else if ([
    "split-preparation",
    "architecture-screen",
    "configuration-grid",
    "replica-stability",
    "needs-more-training-evidence"
  ].includes(phase)) {
    lines.push(
      "자료 경계   : Training을 80% 학습 + 20% 고정 Shadow 검증으로 분리"
      + " · 공식 Development 미공개"
    );
    const current = policyQReadinessOrdinal(readiness, progress);
    const total = Number(readiness.totalConfigurations) || 0;
    if (total > 0) {
      const snapshot = policyQConfigurationSnapshot(progress);
      lines.push(
        `Shadow 현황  : ${snapshot.completed} 완료 · `
        + `${snapshot.active} 진행 · `
        + `${snapshot.pending} 대기 (전체 ${total})`
      );
      if (Number(readiness.parallelConfigurationProcessLimit) > 1) {
        lines.push(
          `Grid 병렬    : ${snapshot.active} / `
          + `${Number(readiness.parallelConfigurationProcessLimit)} 프로세스`
          + " · 메모리 여유에 따라 자동 조절"
        );
      }
      if (current > 0) {
        lines.push(
          `현재 검사    : ${current} / ${total}`
          + (readiness.architecture
            ? ` · ${readiness.architecture}`
            : "")
          + (Number.isFinite(Number(readiness.learningRate))
            ? ` · lr ${Number(readiness.learningRate)}`
            : "")
          + (Number.isFinite(Number(readiness.epochs))
            ? ` · ${Number(readiness.epochs)} epoch`
            : "")
        );
      }
    }
    const gate = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements;
    lines.push(
      `Shadow 기준: 전체 가치 ${(gate.minimumLeafAccuracy * 100).toFixed(0)}%+`
      + ` · 각 시점 ${(gate.minimumPhaseAccuracy * 100).toFixed(0)}%+`
      + ` · 하한 ${(gate.minimumPhaseAccuracyLowerBound * 100).toFixed(0)}% 초과`
      + ` · 일반화 격차 ${(gate.maximumGeneralizationGap * 100).toFixed(0)}%p 이하`
    );
  } else if (phase === "development-evidence") {
    lines.push(
      "자료 경계   : Shadow에서 구조·학습률·epoch 동결 완료"
      + " · 이제 공식 Development 증거만 신규 수집"
    );
  } else if (phase === "official-development") {
    lines.push(
      "자료 경계   : 동결된 단일 설정만 공식 Development에서 검증"
      + " · 설정 재선택 금지"
    );
  }
  const schedule = readiness.schedule;
  if (schedule?.architecture) {
    lines.push(
      `동결 설정   : ${schedule.architecture.id || schedule.architecture}`
      + ` · lr ${schedule.learningRate}`
      + ` · ${schedule.epochs} epoch`
      + ` · ${schedule.replicas} replica`
    );
  }
}

function inferPolicyQPhase(progress) {
  const inferredRoles = [
    ...(progress.activeEvidenceRoles || []),
    progress.certificationRole,
    ...(progress.workerPool?.active || []).map(
      (item) => item.taskContext?.certificationRole
    )
  ].filter(Boolean);
  const roles = new Set(inferredRoles);
  if (roles.has("training")) return "training-evidence";
  if (roles.has("development")) return "development-evidence";
  if (roles.has("confirmation")) return "confirmation";
  if (roles.has("final-audit")) return "final-audit";
  if (progress.stage === "evaluator-confirmation-gate") {
    return "confirmation";
  }
  return "training-evidence";
}

function policyQLegacyHandoff(progress) {
  return progress.workerPool?.draining === true
    && !progress.evidenceCheckpointId
    && !progress.policyQReadinessProgress;
}

function policyQPhaseLabel(phase) {
  return ({
    "training-evidence": "1/6 Training 가치증거 확보",
    "split-preparation": "2/6 Training-only Shadow 분할 고정",
    "architecture-screen": "2/6 6개 구조 선별",
    "configuration-grid": "2/6 학습률·epoch 탐색",
    "replica-stability": "2/6 복수 초기값 안정성 확인",
    passed: "2/6 Shadow 준비도 통과",
    "needs-more-training-evidence": "2/6 Shadow 미달 · Training 보충 판단",
    inconclusive: "2/6 Shadow 불확실 · Training 보충 판단",
    "structural-failure": "2/6 Shadow 구조적 실패 신호",
    "development-evidence": "3/6 공식 Development 증거 확보",
    "official-development": "3/6 공식 Development 검증",
    confirmation: "4/6 독립 Confirmation",
    "final-audit": "5/6 비공개 Final-audit",
    certified: "6/6 Policy-Q 인증 완료"
  })[phase] || phase || "단계 확인 중";
}

function policyQTrainingPurposeLabel(purpose) {
  if (purpose === "policy-q-shadow-architecture-screen-v1") {
    return "6개 구조 × 2 초기값 선별";
  }
  if (purpose === "policy-q-shadow-final-stability-v1") {
    return "선택 설정을 3개 초기값으로 재검증";
  }
  if (purpose?.startsWith("policy-q-shadow-grid-")) {
    return "상위 3개 구조의 학습률·epoch 격자 비교";
  }
  return purpose || "준비 중";
}

function policyQReadinessOrdinal(readiness, progress) {
  if (readiness.phase === "architecture-screen") {
    return Number(progress.evaluatorCandidate) || 0;
  }
  if (readiness.phase === "replica-stability") {
    return (Number(progress.evaluatorTrainingReplica) || 0) + 1;
  }
  return Number(readiness.currentConfiguration)
    || Number(readiness.completedConfigurations) || 0;
}

function policyQConfigurationSnapshot(progress) {
  const readiness = progress.policyQReadinessProgress || {};
  const phase = readiness.phase || inferPolicyQPhase(progress);
  const total = Math.max(0,
    Number(readiness.totalConfigurations)
      || Number(progress.evaluatorCandidates)
      || 0);
  let ordinal = policyQReadinessOrdinal(readiness, progress);
  let completed = Number(readiness.completedConfigurations);
  if (!Number.isFinite(completed)) completed = Math.max(0, ordinal - 1);
  if (phase === "architecture-screen") {
    ordinal = Number(progress.evaluatorCandidate) || ordinal;
    completed = Math.max(0, ordinal - 1);
  } else if (phase === "replica-stability") {
    ordinal = (Number(progress.evaluatorTrainingReplica) || 0) + 1;
    completed = Math.max(0, ordinal - 1);
  }
  completed = Math.min(total, Math.max(0, completed));
  let active = Number(
    readiness.parallelConfigurationProcesses
      ?? readiness.parallelCandidateProcesses
      ?? progress.evaluatorCandidateProcesses
  );
  if (!Number.isFinite(active)) {
    active = total > completed && ordinal > 0 ? 1 : 0;
  }
  active = Math.min(
    Math.max(0, total - completed),
    Math.max(0, Math.floor(active))
  );
  const current = active > 0;
  return {
    total,
    ordinal,
    completed,
    active,
    current,
    pending: Math.max(0, total - completed - active)
  };
}

function policyQTrainingEpochTotal(progress) {
  const explicit = Number(
    progress.evaluatorTrainingEpochs
      ?? progress.epochs
      ?? progress.policyQReadinessProgress?.epochs
  );
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const purpose = String(progress.evaluatorTrainingPurpose || "");
  if (purpose === "policy-q-shadow-architecture-screen-v1") {
    return Number(POLICY_Q_SHADOW_READINESS_GRID.architectureScreen.epochs) || 0;
  }
  const match = purpose.match(/epochs-(\d+)(?:$|[^0-9])/);
  return match ? Number(match[1]) : 0;
}

function policyQTrainingIdentity(progress) {
  return [
    progress.runId,
    progress.evaluatorTrainingPurpose,
    progress.evaluatorArchitecture,
    progress.evaluatorCandidate,
    progress.evaluatorTrainingReplica
  ].join(":");
}

function policyQLossMetric(progress) {
  const current = Number(progress.metrics?.loss ?? progress.loss);
  if (!Number.isFinite(current)) return null;
  const key = policyQTrainingIdentity(progress);
  const epoch = Number(progress.epoch) || 0;
  let baseline = policyQLossBaselines.get(key);
  if (!baseline || epoch < baseline.epoch) {
    baseline = { epoch, loss: current };
    policyQLossBaselines.set(key, baseline);
  }
  const relative = baseline.loss === 0
    ? 0
    : (current - baseline.loss) / Math.abs(baseline.loss);
  return `loss ${current.toFixed(4)}`
    + (epoch > baseline.epoch && Math.abs(relative) >= 0.0005
      ? ` · 첫 관측 대비 ${relative >= 0 ? "+" : ""}${(relative * 100).toFixed(1)}%`
      : "");
}

function policyQTrainingEta(progress) {
  const total = policyQTrainingEpochTotal(progress);
  const epoch = Number(progress.epoch) || 0;
  if (!(total > 0) || !(epoch > 0)) return null;
  if (epoch >= total) return "현재 후보 학습 완료 · 검증 준비";
  const now = new Date(progress.updatedAt).getTime();
  if (!Number.isFinite(now)) return null;
  const key = policyQTrainingIdentity(progress);
  let baseline = policyQStageBaselines.get(key);
  if (!baseline || epoch < baseline.epoch) {
    baseline = { at: now, epoch };
    policyQStageBaselines.set(key, baseline);
    return "현재 후보 속도 측정 중";
  }
  const elapsed = (now - baseline.at) / 1000;
  const completed = epoch - baseline.epoch;
  if (!(elapsed > 0) || !(completed > 0)) return "현재 후보 속도 측정 중";
  const finish = new Date(now + (total - epoch) * elapsed / completed * 1000);
  return `${formatDate(finish.toISOString())} 전후 (현재 후보)`;
}

export function formatTelegramFriendly(progress, modelContext) {
  const policyQ = progress.evaluatorCertificateKind === "policy-q"
    || progress.policyQReadinessProgress
    || progress.evaluatorTrainingPurpose?.startsWith("policy-q-")
    || progress.evaluatorTrainingPurpose === "official-development";
  if (!policyQ) return formatFriendly(progress, modelContext);
  const lines = [
    `RiftBound AI · ${formatDate(progress.updatedAt)}`,
    `현재: ${stageLabel(progress.stage)}`,
    `관문: ${policyQPhaseLabel(
      progress.policyQReadinessProgress?.phase || inferPolicyQPhase(progress)
    )}`
  ];
  if (policyQLegacyHandoff(progress)) {
    lines[2] = "관문: 기존 실행 마지막 경기 안전 인계 중";
  }
  if (progress.stage === "evaluator-bootstrap") {
    const role = progress.activeEvidenceRoles?.[0]
      || currentCertificationRole(progress)
      || "training";
    const partition = progress.certificationPartitions?.[role] || {};
    const requirement = partition.requirement || {};
    lines.push(
      `${certificationRoleLabel(role)} V2 가치: `
      + `${Number(partition.structuredV2LeafValuePairCount) || 0}`
      + `/${Number(requirement.minimumStructuredV2LeafValuePairs) || 0}쌍`
      + ` · ${Number(partition.structuredV2LeafValueReferenceGameCount) || 0}`
      + `/${Number(requirement.minimumStructuredV2LeafValueReferenceGames) || 0}경기`
    );
    lines.push(
      `전체 경기: ${Number(partition.acceptedGames) || 0}`
      + `/${Number(requirement.minimumGames) || 0}`
    );
    lines.push(`시점별: ${formatPolicyQPhaseTargets(partition, requirement)}`);
    const completed = Number(progress.workerPool?.completedTasks) || 0;
    const total = Number(progress.workerPool?.totalTasks) || 0;
    const worker = evaluatorBootstrapWorkerView(progress);
    lines.push(
      `현재 묶음: ${completed}/${total || "-"}`
      + ` · 작업 워커 ${worker.activeWorkers}`
      + (progress.workerPool?.draining === true ? " · 안전 중단 중" : "")
    );
    lines.push("행동증거: 이번 Policy-Q 완료 조건 아님");
    lines.push(`공식 효과계약: ${formatPolicyQFormalActionEffectTargets()}`);
  } else {
    const readiness = progress.policyQReadinessProgress || {};
    if (Number(readiness.totalConfigurations) > 0) {
      const snapshot = policyQConfigurationSnapshot(progress);
      lines.push(
        `전체 후보: ${snapshot.completed} 완료 · `
        + `${snapshot.current ? "1 진행" : "0 진행"} · `
        + `${snapshot.pending} 대기`
      );
    }
    if (progress.evaluatorArchitecture) {
      lines.push(
        `현재 후보: ${progress.evaluatorArchitecture}`
        + ` · ${policyQReadinessOrdinal(readiness, progress)}`
        + `/${Number(readiness.totalConfigurations)
          || progress.evaluatorCandidates
          || "-"}`
      );
      lines.push(
        `초기값: ${(Number(progress.evaluatorTrainingReplica) || 0) + 1}`
        + `/${Number(progress.evaluatorTrainingReplicas) || "-"}`
      );
    }
    appendEvaluatorEvaluationProgress(
      lines,
      progress.evaluatorEvaluationProgress,
      { compact: true }
    );
    const epochTotal = policyQTrainingEpochTotal(progress);
    if (epochTotal || Number(progress.epoch) > 0) {
      lines.push(
        `학습: epoch ${Number(progress.epoch) || 0}/${epochTotal || "-"}`
        + (epochTotal
          ? ` (${percent(Number(progress.epoch) || 0, epochTotal)})`
          : "")
      );
    }
    const loss = policyQLossMetric(progress);
    if (loss) lines.push(`지표: ${loss}`);
    const eta = policyQTrainingEta(progress);
    if (eta) lines.push(`예상: ${eta}`);
    lines.push(
      readiness.protectedDevelopmentOpened === true
        ? "공식 Development: 공개됨 · 동결 설정만 평가"
        : "공식 Development: 잠김 · Shadow 결과와 완전 분리"
    );
  }
  lines.push("다음: " + policyQNextStep(progress));
  return lines.join("\n");
}

function formatPolicyQFormalActionEffectTargets() {
  const targeted = POLICY_Q_FORMAL_AUDIT_REQUIREMENTS.targeted;
  const natural = POLICY_Q_FORMAL_AUDIT_REQUIREMENTS.natural;
  return `targeted ${targeted.minimumComparisons}`
    + `/${targeted.minimumContributingGames}경기`
    + ` · natural ${natural.minimumComparisons}`
    + `/${natural.minimumContributingGames}경기`
    + ` · 덱×좌석×시점 ${natural.minimumDeckSeatPhaseSafetyComparisons}`
    + `/${natural.minimumDeckSeatPhaseSafetyGames}경기`;
}

function formatPolicyQPhaseTargets(partition = {}, requirement = {}) {
  const counts = partition.structuredV2LeafValuePhaseCoverage || {};
  const games = partition.structuredV2LeafValuePhaseReferenceGameCount || {};
  const targetCounts = requirement.minimumLeafValuePairsByPhase || {};
  const targetGames = requirement.minimumLeafValueReferenceGamesByPhase || {};
  const labels = { mulligan: "멀리건", early: "초반", mid: "중반", late: "후반" };
  return ["mulligan", "early", "mid", "late"].map((phase) =>
    `${labels[phase]} ${Number(counts[phase]) || 0}/${Number(targetCounts[phase]) || 0}`
    + `(${Number(games[phase]) || 0}/${Number(targetGames[phase]) || 0}경기)`
  ).join(" · ");
}

function policyQNextStep(progress) {
  const phase = progress.policyQReadinessProgress?.phase
    || inferPolicyQPhase(progress);
  return ({
    "training-evidence": "Training 목표 충족 후 6개 구조 Shadow 선별",
    "split-preparation": "Training-only 80/20 분할 확정",
    "architecture-screen": "V1·Set V2·Attention V2 계열별 하나 보존",
    "configuration-grid": "노출량을 맞춘 학습률·epoch 중 하나 동결",
    "replica-stability": "2/3 이상 안정 통과 시 공식 Development 공개",
    passed: "공식 Development 증거 수집",
    "needs-more-training-evidence": "취약 Training 구간만 한 차례 보충",
    inconclusive: "시점별 유효 경기 35~50개를 목표로 보충",
    "structural-failure": "추가 수집 대신 모델 구조 검토",
    "development-evidence": "동결 모델의 공식 Development 검증",
    "official-development": "통과 시 독립 Confirmation",
    confirmation: "통과 시 비공개 Final-audit",
    "final-audit": "통과 시 Policy-Q 인증"
  })[phase] || "현재 단계 완료 후 다음 보호 단계";
}

function appendEvaluatorEvaluationProgress(lines, evaluation, options = {}) {
  if (!evaluation || typeof evaluation !== "object") return;
  const section = ({
    calibration: "Calibration",
    "shadow-validation": "Shadow validation",
    "training-recheck": "학습셋 재검사",
    "fixed-anchor": "고정 anchor"
  })[evaluation.section] || evaluation.section || "후보 검증";
  const completed = Number(evaluation.completedEntries) || 0;
  const total = Number(evaluation.totalEntries) || 0;
  lines.push(
    `${options.compact ? "채점" : "채점 구간    "}: ${section}`
    + (total > 0 ? ` ${completed}/${total} (${percent(completed, total)})` : "")
  );
  const scores = [];
  if (Number.isFinite(Number(evaluation.leafAccuracy))) {
    scores.push(
      `가치 ${(Number(evaluation.leafAccuracy) * 100).toFixed(1)}%`
      + `(${Number(evaluation.leafDecisions) || 0}판정)`
    );
  }
  if (Number.isFinite(Number(evaluation.actionAccuracy))) {
    scores.push(
      `행동 ${(Number(evaluation.actionAccuracy) * 100).toFixed(1)}%`
      + `(${Number(evaluation.actionDecisions) || 0}판정)`
    );
  }
  if (scores.length) {
    lines.push(`${options.compact ? "잠정 점수" : "잠정 점수    "}: ${scores.join(" · ")}`);
  }
  if (!options.compact && evaluation.preliminary === true) {
    lines.push("점수 상태    : 중간 집계 · 신뢰구간과 최종 합격 판정 전");
  }
}

function appendActionEvidenceProtocol(lines, protocol) {
  if (!protocol || typeof protocol !== "object") return;
  const continuationCount = protocol.continuationPool?.members?.length || 0;
  const opponentCount = protocol.opponentPool?.members?.length || 0;
  const pairCount = continuationCount * opponentCount;
  lines.push(
    `증거 계약   : ${protocol.contract || `protocol-v${protocol.version || "?"}`}`
    + ` · continuation ${continuationCount}`
    + ` × opponent ${opponentCount}`
    + ` = ${pairCount}쌍`
    + (protocol.protocolHash
      ? ` · ${shortDigest(protocol.protocolHash)}`
      : "")
  );
}

function shortDigest(value) {
  if (!value) return "-";
  const normalized = String(value).replace(/^sha256:/, "");
  if (normalized.length <= 14) return normalized;
  return `${normalized.slice(0, 7)}…${normalized.slice(-5)}`;
}

function earlyDiagnosticStatusLabel(status) {
  return ({
    failed: "반복 실패 확인",
    "strong-warning-continue": "위험 신호 · 계속 수집",
    promising: "유망 · 계속 수집",
    "inconclusive-continue": "불확실 · 계속 수집"
  })[status] || status || "불확실";
}

function earlyDiagnosticWarningLabel(warning) {
  return ({
    "shadow-development-generalization-gap": "일반화 격차",
    "shadow-development-calibration-risk": "보정 위험",
    "shadow-development-stratum-risk": "취약 구간",
    "all-architectures-fixed-anchor-overfit": "전 구조 과적합",
    "shadow-development-replica-instability": "초기값 불안정"
  })[warning] || warning;
}

function percentMetric(value) {
  return value !== null && value !== undefined && value !== ""
    && Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)}%`
    : "자료 부족";
}

function formatAuditPhaseEvidence(counts = {}, games = {}) {
  const labels = {
    mulligan: "멀리건",
    early: "초반",
    mid: "중반",
    late: "후반"
  };
  return ["mulligan", "early", "mid", "late"].map((phase) =>
    `${labels[phase]} ${Number(counts?.[phase]) || 0}`
    + `(${Number(games?.[phase]) || 0}경기)`
  ).join(" · ");
}

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  fetchImpl = globalThis.fetch
}) {
  if (!botToken || !chatId) {
    throw new Error("Telegram bot token and chat ID are required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  const chunks = splitTelegramMessage(String(text));
  for (const chunk of chunks) {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          disable_web_page_preview: true
        })
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Telegram sendMessage failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }
  }
}

export function splitTelegramMessage(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let boundary = remaining.lastIndexOf("\n", limit);
    if (boundary < 1) boundary = limit;
    chunks.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function evaluatorBootstrapWorkerView(progress) {
  const pool = progress?.workerPool || {};
  const detachedAuditStarted = progress?.detachedActionAudit != null;
  const totalTasks = Math.max(0, Number(pool.totalTasks) || 0);
  return {
    completedTasks: detachedAuditStarted
      ? totalTasks
      : Math.max(0, Number(pool.completedTasks) || 0),
    activeWorkers: detachedAuditStarted
      ? 0
      : Array.isArray(pool.active) ? pool.active.length : 0,
    detachedAuditStarted
  };
}

function detachedAuditStageLabel(stage) {
  return ({
    "selection-8": "후보 예선 8쌍",
    "selection-16": "후보 선별 16쌍",
    "selection-24": "후보 선별 24쌍",
    "selection-32": "후보 선별 32쌍",
    "final-v2-16": "독립 최종 검증 16쌍",
    "final-v2-32": "독립 최종 검증 32쌍",
    "final-v2-48": "독립 최종 검증 48쌍",
    "final-v2-64": "독립 최종 검증 64쌍",
    "detached-action-audit-complete": "행동 감사 완료"
  })[stage] || stage || "준비 중";
}

export function detachedAuditProcedureProgress(audit = {}) {
  const stages = [
    "selection-8",
    "selection-16",
    "selection-24",
    "selection-32",
    "final-v2-16",
    "final-v2-32",
    "final-v2-48",
    "final-v2-64"
  ];
  const index = stages.indexOf(audit.stage);
  if (index < 0) return null;
  return {
    step: index + 1,
    totalSteps: stages.length,
    label: detachedAuditStageLabel(audit.stage),
    completed: Math.max(0, Number(audit.pairedSeedsCompleted) || 0),
    total: Math.max(0, Number(audit.pairedSeedsPlanned) || 0)
  };
}

export function detachedAuditWorkerBreakdown(progress = {}) {
  const recorded = progress.displayContext?.actionAuditWorkers || {};
  const current = progress.detachedActionAudit || null;
  const local = normalizeActionAuditWorkerSnapshot(
    recorded.local || (current?.remote === true ? null : current),
    "local"
  );
  const aws = normalizeActionAuditWorkerSnapshot(
    recorded.aws || (current?.remote === true ? current : null),
    "aws"
  );
  const workers = [local, aws].filter(Boolean);
  if (workers.length === 0) return null;
  return {
    local,
    aws,
    activeProcesses: workers.reduce(
      (sum, worker) => sum + worker.activeProcesses,
      0
    ),
    processCount: workers.reduce(
      (sum, worker) => sum + worker.processCount,
      0
    ),
    desiredProcessCount: workers.reduce(
      (sum, worker) => sum + worker.desiredProcessCount,
      0
    ),
    maximumProcessCount: workers.reduce(
      (sum, worker) => sum + worker.maximumProcessCount,
      0
    )
  };
}

function appendDetachedAuditWorkers(lines, progress) {
  const view = detachedAuditWorkerBreakdown(progress);
  if (!view) return;
  lines.push(formatActionAuditWorkerLine("감사 워커", view, progress, {
    includeMaximum: true
  }));
  if (view.local && view.aws) {
    lines.push(formatActionAuditWorkerLine("로컬 워커", view.local, progress, {
      includeMaximum: true
    }));
  }
  if (view.aws) {
    lines.push(formatActionAuditWorkerLine("AWS 워커", view.aws, progress, {
      includeMaximum: true,
      includeMemory: true
    }));
  }
}

function normalizeActionAuditWorkerSnapshot(snapshot, location) {
  if (!snapshot) return null;
  const processCount = Math.max(0, Number(snapshot.processCount) || 0);
  const desiredValue = Number(snapshot.desiredProcessCount);
  const desiredProcessCount = Number.isFinite(desiredValue)
    ? Math.max(0, desiredValue)
    : processCount;
  const activeProcesses = Math.min(
    processCount,
    Math.max(0, Number(snapshot.activeProcesses) || 0)
  );
  return {
    ...snapshot,
    location,
    activeProcesses,
    processCount,
    desiredProcessCount,
    maximumProcessCount: Math.max(
      processCount,
      desiredProcessCount,
      Number(snapshot.maximumProcessCount) || 0
    )
  };
}

function formatActionAuditWorkerLine(label, worker, progress, options = {}) {
  const parts = [
    `작업 ${worker.activeProcesses}`,
    `전체 ${worker.processCount}`,
    `목표 ${worker.desiredProcessCount}`,
    `대기 ${Math.max(0, worker.processCount - worker.activeProcesses)}`
  ];
  if (options.includeMaximum && worker.maximumProcessCount > 0) {
    parts.push(`최대 ${worker.maximumProcessCount}`);
  }
  if (worker.desiredProcessCount > worker.processCount) parts.push("확장 중");
  if (worker.desiredProcessCount < worker.processCount) parts.push("축소 중");
  if (options.includeMemory) {
    const physical = formatMemoryBytes(worker.remotePhysicalAvailableMemoryBytes);
    const swap = formatMemoryBytes(worker.remoteSwapFreeBytes);
    if (physical) parts.push(`메모리 여유 ${physical}`);
    if (swap) parts.push(`스왑 여유 ${swap}`);
  }
  const age = workerTelemetryAge(worker.updatedAt, progress.updatedAt);
  if (age) parts.push(age);
  return `${label.padEnd(11)}: ${parts.join(" / ")}`;
}

function actionAuditWorkerMarker(progress) {
  const view = detachedAuditWorkerBreakdown(progress);
  if (!view) return [];
  return ["action-audit-workers", ...[view.local, view.aws].flatMap(
    (worker) => worker
      ? [
        worker.location,
        worker.processCount,
        worker.desiredProcessCount,
        worker.maximumProcessCount
      ]
      : []
  )];
}

function formatMemoryBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  const gibibytes = bytes / (1024 ** 3);
  if (gibibytes >= 1) return `${gibibytes.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

function workerTelemetryAge(updatedAt, referenceAt) {
  const updated = Date.parse(updatedAt);
  const reference = Date.parse(referenceAt);
  if (!Number.isFinite(updated) || !Number.isFinite(reference)) return null;
  const seconds = Math.max(0, Math.floor((reference - updated) / 1000));
  if (seconds < 60) return null;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전 갱신`;
  return `${Math.floor(seconds / 3600)}시간 전 갱신`;
}

export async function enrichDetachedAuditProgress(progress) {
  const audit = progress?.detachedActionAudit;
  const telemetry = await readRecentProgressTelemetry(progress.eventLogPath);
  const bootstrapState = await readBootstrapDisplayState(progress);
  const enriched = {
    ...progress,
    workerPool: progress.workerPool
      ? {
        ...progress.workerPool,
        processCount: Number(progress.workerPool.processCount)
          || telemetry.workerCapacity
          || null
      }
      : progress.workerPool,
    displayContext: bootstrapState || telemetry.actionAuditWorkers.local
      || telemetry.actionAuditWorkers.aws
      ? {
        ...(bootstrapState || {}),
        actionAuditWorkers: telemetry.actionAuditWorkers
      }
      : null
  };
  if (!audit || Number.isFinite(Number(audit.totalGames))) return enriched;
  const checkpoint = telemetry.auditCheckpoint;
  if (!checkpoint) return enriched;
  return {
    ...enriched,
    detachedActionAudit: {
      ...audit,
      games: checkpoint.games,
      totalGames: checkpoint.totalGames,
      skippedTargetSatisfied: checkpoint.skippedTargetSatisfied ?? 0
    }
  };
}

async function readRecentProgressTelemetry(eventLogPath) {
  const result = {
    auditCheckpoint: null,
    workerCapacity: 0,
    actionAuditWorkers: { local: null, aws: null }
  };
  if (!eventLogPath) return result;
  let handle;
  try {
    handle = await open(eventLogPath, "r");
    const stat = await handle.stat();
    const length = Math.min(stat.size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const lines = buffer.toString("utf8").split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const active = event.workerPool?.active || [];
        result.workerCapacity = Math.max(
          result.workerCapacity,
          Number(event.workerPool?.processCount) || 0,
          active.length,
          ...active.map((item) => (Number(item.slotIndex) || 0) + 1)
        );
        const candidate = event.detachedActionAudit;
        if (candidate && Number.isFinite(Number(candidate.processCount))) {
          const location = candidate.remote === true ? "aws" : "local";
          if (!result.actionAuditWorkers[location]) {
            result.actionAuditWorkers[location] = {
              ...candidate,
              updatedAt: event.updatedAt || null
            };
          }
        }
        if (!result.auditCheckpoint
          && Number.isFinite(Number(candidate?.games))
          && Number(candidate?.totalGames) > 0) {
          result.auditCheckpoint = candidate;
        }
      } catch {}
    }
  } catch {
    return result;
  } finally {
    await handle?.close().catch(() => {});
  }
  return result;
}

async function readBootstrapDisplayState(progress) {
  if (!progress?.evaluatorBootstrapDatasetKey) return null;
  try {
    const statePath = path.join(
      dataRoot,
      "evaluator-bootstrap",
      progress.evaluatorBootstrapDatasetKey,
      "bootstrap-state.json"
    );
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const migratedAuditGames = Number(
      state.deckSeatSchedule?.boundaryGameIndex
    );
    return {
      migratedAuditGames: Number.isFinite(migratedAuditGames)
        ? migratedAuditGames
        : null,
      batchStartedAt: state.activeCollectionWindow?.createdAt || null,
      batchStartGames: Number(
        state.activeCollectionWindow?.startCompletedLogical
      ) || null,
      batchTargetGames: Number(
        state.activeCollectionWindow?.targetCompletedLogical
      ) || null
    };
  } catch {
    return null;
  }
}

function appendGameDetails(lines, summary, progress, modelContext) {
  const decks = summary.deckIds || [];
  if (decks.length >= 2) {
    lines.push(`P1 덱        : ${deckLabel(decks[0])}`);
    lines.push(`P2 덱        : ${deckLabel(decks[1])}`);
  }
  const aiSeats = (summary.aiSeats || inferAiSeats(progress, modelContext))?.map((ai) => normalizeAiRole(ai, modelContext));
  if (aiSeats?.length >= 2) {
    lines.push(`P1 AI        : ${aiLabel(aiSeats[0])}`);
    lines.push(`P2 AI        : ${aiLabel(aiSeats[1])}`);
  }
  if (Array.isArray(summary.scores)) lines.push(`최종 점수    : P1 ${summary.scores[0]} : ${summary.scores[1]} P2`);
  if (Array.isArray(summary.wins)) lines.push(`매치 승수    : P1 ${summary.wins[0]} : ${summary.wins[1]} P2`);
  if (summary.firstPlayerId) lines.push(`선공 플레이어: ${summary.firstPlayerId.toUpperCase()}`);
  if (summary.comparisonBlock != null) lines.push(`교차 비교 묶음: worker 내 #${summary.comparisonBlock + 1} · 같은 덱 조합 4경기`);
  if (summary.learnerPlayerId) lines.push(`learner 조건 : ${summary.learnerPlayerId.toUpperCase()} · ${summary.learnerWentFirst ? "선공" : "후공"}`);
  lines.push(`경기 결과    : ${summary.completed ? `${summary.winnerId?.toUpperCase() || "승자 미상"} 승리` : "행동 제한 내 미완료"}`);
  if (summary.actions != null) lines.push(`행동 횟수    : ${summary.actions}`);
  if (Number(summary.proofLabels) > 0) {
    lines.push(`증명 교사    : 전수 검사 ${summary.proofChecks || 0}회 · 증명 ${summary.proofLabels}회 · 실수 교정 ${summary.proofCorrections || 0}회`);
  }
  if (Number(summary.postmortemReviews) > 0) {
    lines.push(`패배 복기    : 결정적 후보 ${summary.postmortemCapturedCandidates || 0}개 · 심층 검토 ${summary.postmortemReviews}개 · 교정 확정 ${summary.postmortemVerifiedCorrections || 0}개`);
    const causes = Object.entries(summary.postmortemCauses || {})
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .map(([cause, count]) => `${postmortemCauseLabel(cause)} ${count}개`);
    if (causes.length) lines.push(`복기 원인    : ${causes.join(" · ")}`);
  }
}

function postmortemCauseLabel(cause) {
  return ({
    "missed-winning-line": "승리 수 누락",
    "verified-higher-value-winning-line": "검증된 상위 승리 수 누락",
    "missed-action-before-stop": "행동 전 턴 종료",
    "fragmented-attack": "분산 공격",
    "premature-attack": "성급한 공격",
    "resource-overcommitment": "자원 과투입",
    "mulligan-regret": "멀리건 판단",
    "resource-timing": "자원 사용 시점",
    "decision-regret": "일반 판단"
  })[cause] || cause;
}

function inferAiSeats(progress, modelContext) {
  if (progress.state === "collecting" && progress.lastGame && modelContext.learner) {
    const learnerSeat = progress.lastGame.gameIndex % 2;
    const opponent = modelContext.champion ? { ...modelContext.champion, role: "champion" } : { role: "league", generation: null };
    const learner = { ...modelContext.learner, role: "learner" };
    return learnerSeat === 0 ? [learner, opponent] : [opponent, learner];
  }
  const summary = progress.summary || progress.progress?.summary;
  if (progress.state !== "evaluating" || summary?.candidateSeat == null) return null;
  const candidate = { role: "candidate", generation: progress.generation, trainingIteration: progress.trainingIteration };
  const opponent = progress.stage === "candidate-vs-heuristic"
    ? { role: "heuristic", generation: null }
    : progress.stage === "candidate-vs-champion" && modelContext.champion
      ? { ...modelContext.champion, role: "champion" }
      : { role: "league", generation: null };
  return summary.candidateSeat === 0 ? [candidate, opponent] : [opponent, candidate];
}

function aiLabel(ai) {
  const role = ({ learner: "학습 중 learner", champion: "기존 champion", league: "리그 상대", candidate: "평가 후보", heuristic: "기본 AI" })[ai.role] || ai.role || "신경망 AI";
  const generation = ai.generation == null ? "" : ` · generation ${ai.generation}`;
  const iteration = ai.trainingIteration == null ? "" : ` · iteration ${ai.trainingIteration}`;
  return `${role}${generation}${iteration}`;
}

function normalizeAiRole(ai, modelContext) {
  if (ai?.role !== "league" || !modelContext.champion) return ai;
  if (ai.generation === modelContext.champion.generation && ai.gamesTrained === modelContext.champion.gamesTrained) return { ...ai, role: "champion" };
  return ai;
}

function deckLabel(id) {
  const labels = [
    ["origins-sett", "세트"],
    ["proving-grounds-annie", "애니"],
    ["origins-kaisa", "카이사"],
    ["proving-grounds-master-yi", "마스터 이"],
    ["origins-leona", "레오나"]
  ];
  const matched = labels.find(([prefix]) => id?.startsWith(prefix));
  const variant = id?.includes("-evolved-") ? " · 진화 덱" : id?.includes("-runes-") ? " · 룬 변형 덱" : "";
  return matched ? `${matched[1]}${variant} (${id})` : id || "알 수 없음";
}

async function loadModelContext() {
  const [learner, champion, trainingStatus] = await Promise.all([
    readModelSummary(path.join(dataRoot, "learner", "neural-learner.json")),
    readModelSummary(path.join(dataRoot, "selfplay-local", "neural-champion.json")),
    readTrainingStatus(path.join(dataRoot, "status.json"))
  ]);
  return { learner, champion, trainingStatus };
}

async function readTrainingStatus(filename) {
  try {
    const status = JSON.parse(await readFile(filename, "utf8"));
    return {
      games: status.games ?? null,
      resumedArchive: status.resumedArchive === true
    };
  } catch {
    return null;
  }
}

async function readModelSummary(filename) {
  try {
    const checkpoint = JSON.parse(await readFile(filename, "utf8"));
    return { generation: checkpoint.generation, trainingIteration: checkpoint.metadata?.trainingIteration ?? null, gamesTrained: checkpoint.gamesTrained ?? null };
  } catch {
    return null;
  }
}

function appendEvaluatorTiming(lines, progress) {
  const batch = evaluatorBatchTiming(progress);
  const role = currentCertificationRole(progress);
  const rates = measureEvidenceYields(progress, role);
  const rateParts = [
    batch?.gamesPerHour > 0
      ? `경기 ${batch.gamesPerHour.toFixed(2)}/시간`
      : "경기 수율 측정 중",
    rates?.actionReferences > 0
      ? `v2 행동 ${rates.actionReferences.toFixed(2)}/시간`
      : "v2 행동 수율 미측정",
    rates?.leafPairs > 0
      ? `v2 가치 ${rates.leafPairs.toFixed(2)}/시간`
      : "v2 가치 수율 미측정"
  ];
  lines.push(`최근 수율   : ${rateParts.join(" · ")}`);
  lines.push(
    `현재 묶음 ETA: ${batch?.eta || "속도 측정 중"}`
  );
  lines.push(
    `현재 파티션 ETA: ${estimatePartitionEta(progress, role, rates)}`
  );
  const partitions = progress.certificationPartitions || {};
  const futureUnmeasured = CERTIFICATION_ROLE_ORDER.some((item) =>
    item !== role && Number(partitions[item]?.acceptedGames) === 0);
  lines.push(
    `전체 ETA    : ${futureUnmeasured
      ? "후속 파티션 수율 미측정으로 계산 불가"
      : "동적 추가 할당을 포함한 안정 수율이 없어 계산 불가"}`
  );
}

function evaluatorBatchTiming(progress) {
  const completed = Number(progress.workerPool?.completedTasks) || 0;
  const total = Number(progress.workerPool?.totalTasks) || 0;
  const minimumStableSamples = 8;
  if (total > 0 && completed > 0 && completed < minimumStableSamples) {
    return {
      gamesPerHour: 0,
      eta: `초기 완료 표본 ${completed}/${minimumStableSamples}개 · ETA 안정화 대기`
    };
  }
  const startedAt = new Date(
    progress.displayContext?.batchStartedAt || ""
  ).getTime();
  const now = new Date(progress.updatedAt).getTime();
  if (!(total > 0) || !(completed > 0)
    || !Number.isFinite(startedAt) || !(now > startedAt)) return null;
  const elapsedHours = (now - startedAt) / 3_600_000;
  const gamesPerHour = completed / elapsedHours;
  const remainingHours = Math.max(0, total - completed) / gamesPerHour;
  const finish = new Date(now + remainingHours * 3_600_000);
  return {
    gamesPerHour,
    eta: completed >= total
      ? "현재 묶음 완료 · 다음 동적 할당 대기"
      : `${formatDate(finish.toISOString())} 전후 (현재 묶음만)`
  };
}

function currentCertificationRole(progress) {
  const explicit = progress.certificationRole
    || progress.workerPool?.active?.find(
      (item) => item.taskContext?.certificationRole
    )?.taskContext?.certificationRole;
  if (explicit) return explicit;
  const partitions = progress.certificationPartitions || {};
  return CERTIFICATION_ROLE_ORDER.find((role) =>
    partitions[role]?.complete !== true) || null;
}

function measureEvidenceYields(progress, role) {
  const partition = progress.certificationPartitions?.[role];
  if (!partition || !role) return null;
  const now = new Date(progress.updatedAt).getTime();
  const current = {
    at: now,
    games: Number(partition.acceptedGames) || 0,
    actionReferences: Number(partition.structuredV2ActionReferenceCount) || 0,
    leafPairs: Number(partition.structuredV2LeafValuePairCount) || 0
  };
  const key = `${progress.runId}:${role}`;
  const baseline = evidenceYieldBaselines.get(key);
  if (!baseline || !(now > baseline.at)) {
    evidenceYieldBaselines.set(key, current);
    return null;
  }
  const hours = (now - baseline.at) / 3_600_000;
  return {
    games: Math.max(0, current.games - baseline.games) / hours,
    actionReferences: Math.max(
      0,
      current.actionReferences - baseline.actionReferences
    ) / hours,
    leafPairs: Math.max(0, current.leafPairs - baseline.leafPairs) / hours
  };
}

function estimatePartitionEta(progress, role, rates) {
  const partition = progress.certificationPartitions?.[role];
  if (!partition) return "현재 파티션을 확인할 수 없어 계산 불가";
  const requirement = partition.requirement || {};
  const remaining = {
    actionReferences: gap(
      partition.structuredV2ActionReferenceCount,
      requirement.minimumStructuredV2ActionReferences
    ),
    actionGames: gap(
      partition.structuredV2ActionReferenceGameCount,
      requirement.minimumStructuredV2ActionReferenceGames
    ),
    leafPairs: gap(
      partition.structuredV2LeafValuePairCount,
      requirement.minimumStructuredV2LeafValuePairs
    ),
    leafGames: gap(
      partition.structuredV2LeafValueReferenceGameCount,
      requirement.minimumStructuredV2LeafValueReferenceGames
    )
  };
  if (remaining.actionReferences > 0 && !(rates?.actionReferences > 0)) {
    return "v2 행동 수율 미측정으로 계산 불가";
  }
  if (remaining.leafPairs > 0 && !(rates?.leafPairs > 0)) {
    return "v2 가치 수율 미측정으로 계산 불가";
  }
  if (remaining.actionGames > 0 || remaining.leafGames > 0) {
    return "v2 기여 경기 수율 미측정으로 계산 불가";
  }
  return "핵심 목표 충족 · 세부 조건 확인 중";
}

function estimateEta(progress) {
  const units = progressUnits(progress);
  if (!units || progress.resumed) return null;
  const key = `${progress.runId}:${progress.stage || progress.state}`;
  const now = new Date(progress.updatedAt).getTime();
  const baseline = baselines.get(key);
  if (!baseline) {
    baselines.set(key, { at: now, completed: units.completed });
    return "속도 측정 중";
  }
  const elapsedSeconds = (now - baseline.at) / 1000;
  const completedDelta = units.completed - baseline.completed;
  if (elapsedSeconds < 1 || completedDelta <= 0 || units.total <= units.completed) return "속도 측정 중";
  const remainingSeconds = (units.total - units.completed) * elapsedSeconds / completedDelta;
  const finish = new Date(now + remainingSeconds * 1000);
  return `${formatDate(finish.toISOString())} 전후 (현재 단계 기준)`;
}

function progressUnits(progress) {
  if (progress.state === "collecting") return { completed: progress.completedGames ?? 0, total: progress.targetGames ?? progress.games ?? 0 };
  if (progress.state === "training"
    && progress.stage === "evaluator-bootstrap") {
    const audit = progress.detachedActionAudit;
    if (Number(audit?.totalGames) > 0) {
      return {
        completed: Number(audit.games) || 0,
        total: Number(audit.totalGames)
      };
    }
    if (Number(progress.workerPool?.totalTasks) > 0) {
      return {
        completed: Number(progress.workerPool.completedTasks) || 0,
        total: Number(progress.workerPool.totalTasks)
      };
    }
    return {
      completed: progress.acceptedGames ?? 0,
      total: progress.allocatedGames ?? 0
    };
  }
  if (progress.state === "training" && progress.totalBatches) return { completed: progress.completedBatches ?? 0, total: progress.totalBatches };
  if (progress.state === "evaluating") return { completed: progress.game ?? 0, total: progress.games ?? 0 };
  return null;
}

function stateLabel(state) {
  return ({ preparing: "준비", collecting: "게임 수집", training: "신경망 학습", evaluating: "후보 평가", interrupted: "안전 중단", idle: "완료", error: "오류" })[state] || state || "알 수 없음";
}

function stageLabel(stage) {
  if (stage === "evaluator-bootstrap") {
    return "독립 평가기 인증 자료 수집";
  }
  if (stage === "evaluator-early-diagnostic-checkpoint") {
    return "평가기 조기 실패 진단";
  }
  if (stage === "shared-evidence-training") {
    return "Policy-Q 평가기 후보 학습";
  }
  return ({ generation: "실행 준비", selfplay: "자기대전", ppo: "PPO batch", "ppo-epoch": "PPO epoch 완료", "human-behavior-cloning": "사람 리플레이 학습", "training-resumed": "저장된 학습 후보 재사용", "evaluator-policy-q-shadow-readiness": "Policy-Q Shadow 자료 분할", "evaluator-policy-q-shadow-readiness-complete": "Policy-Q Shadow 통과", "evaluator-policy-q-shadow-readiness-review": "Policy-Q Shadow 보충 판단", "evaluator-policy-q-shadow-readiness-unmet": "Policy-Q Shadow 준비도 미달", "evaluator-policy-q-shadow-inconclusive": "Policy-Q Shadow 불확실", "evaluator-policy-q-shadow-structural-failure": "Policy-Q Shadow 구조적 실패", "evaluator-development-gate-training": "평가기 후보 학습", "evaluator-development-gate-evaluation": "평가기 후보 검증", "evaluator-confirmation-gate": "독립 Confirmation", "candidate-vs-champion": "기존 챔피언 상대", "candidate-vs-heuristic": "기본 AI 상대", "candidate-vs-league": "리그 상대", complete: "모든 단계 완료" })[stage] || stage;
}

function bootstrapSamplingModeLabel(mode) {
  return ({
    "calibration-only": "대표 보정 경기",
    "leaf-audit": "가치 판단 감사",
    "action-ranking-audit": "행동 우열 감사"
  })[mode] || mode || "전환 준비";
}

function appendCertificationPipeline(lines, progress) {
  const partitions = progress.certificationPartitions || {};
  const activeIndex = CERTIFICATION_ROLE_ORDER.findIndex((role) =>
    partitions[role]?.complete !== true);
  const policyQBootstrap = progress.evaluatorCertificateKind === "policy-q";
  let policyQDisplayRoleIndex = activeIndex;
  if (policyQBootstrap) {
    if (policyQLegacyHandoff(progress)) {
      lines.push(
        "Policy-Q 새 흐름: [기존 실행 안전 인계]"
        + " → Training 가치증거 → Shadow 준비도 → 공식 Development"
      );
    } else {
    const activeRoles = new Set([
      ...(progress.activeEvidenceRoles || []),
      progress.certificationRole,
      ...(progress.workerPool?.active || []).map(
        (item) => item.taskContext?.certificationRole
      )
    ].filter(Boolean));
    const policyQIndex = activeRoles.has("training")
      ? 0
      : activeRoles.has("development")
        ? 2
        : activeRoles.has("confirmation")
          ? 3
          : activeRoles.has("final-audit")
            ? 4
            : Math.max(0, activeIndex === 0 ? 0 : activeIndex + 1);
    policyQDisplayRoleIndex = policyQIndex <= 1
      ? 0
      : Math.min(CERTIFICATION_ROLE_ORDER.length - 1, policyQIndex - 1);
    const labels = [
      "Training 가치증거",
      "Shadow 준비도",
      "공식 Development",
      "Confirmation",
      "Final-audit",
      "Policy-Q 인증"
    ];
    lines.push(`Policy-Q 흐름: ${labels.map((label, index) =>
      index < policyQIndex
        ? `${label} 완료`
        : index === policyQIndex
          ? `[${label}]`
          : `${label} 잠김`).join(" → ")}`);
    }
  } else {
  const pipeline = CERTIFICATION_ROLE_ORDER.map((role, index) => {
    const label = certificationRoleLabel(role);
    if (activeIndex < 0 || index < activeIndex) return `${label} 완료`;
    if (index === activeIndex) return `[${label} 인증]`;
    return `${label} 잠김`;
  });
  pipeline.push(activeIndex < 0 ? "[epoch 학습·실전 평가]" : "epoch 학습·실전 평가 잠김");
  lines.push(`전체 파이프라인: ${pipeline.join(" → ")}`);
  }

  const remaining = structuredV2Remaining(partitions);
  lines.push(
    `v2 핵심 잔여: 행동 ${remaining.actionReferences}개`
    + `·${remaining.actionGames}경기`
    + ` | 가치 ${remaining.leafPairs}쌍·${remaining.leafGames}경기`
  );
  let hiddenLockedPartitions = 0;
  for (const [roleIndex, role] of CERTIFICATION_ROLE_ORDER.entries()) {
    const partition = partitions[role];
    if (!partition) continue;
    const noEvidence = partitionEvidenceTotal(partition) === 0;
    if (policyQBootstrap && noEvidence
      && roleIndex > policyQDisplayRoleIndex) {
      hiddenLockedPartitions += 1;
      continue;
    }
    const requirement = partition.requirement || {};
    lines.push(formatPartitionEvidence(role, partition, requirement, false));
    lines.push(formatPartitionEvidence(role, partition, requirement, true));
  }
  if (hiddenLockedPartitions > 0) {
    lines.push(
      `잠긴 파티션 : ${hiddenLockedPartitions}개 · 앞 단계 통과 후에만 수집 시작`
    );
  }
}

function partitionEvidenceTotal(partition = {}) {
  return [
    partition.actionReferenceCount,
    partition.leafValuePairCount,
    partition.structuredV2ActionReferenceCount,
    partition.structuredV2LeafValuePairCount
  ].reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function formatPartitionEvidence(role, partition, requirement, structured) {
  const action = Number(partition[
    structured ? "structuredV2ActionReferenceCount" : "actionReferenceCount"
  ]) || 0;
  const actionGames = Number(partition[
    structured
      ? "structuredV2ActionReferenceGameCount"
      : "actionReferenceGameCount"
  ]) || 0;
  const leaf = Number(partition[
    structured ? "structuredV2LeafValuePairCount" : "leafValuePairCount"
  ]) || 0;
  const leafGames = Number(partition[
    structured
      ? "structuredV2LeafValueReferenceGameCount"
      : "leafValueReferenceGameCount"
  ]) || 0;
  const requirementPrefix = structured ? "minimumStructuredV2" : "minimum";
  const targetAction = Number(
    requirement[`${requirementPrefix}ActionReferences`]
  ) || 0;
  const targetActionGames = Number(
    requirement[`${requirementPrefix}ActionReferenceGames`]
  ) || 0;
  const targetLeaf = Number(
    requirement[`${requirementPrefix}LeafValuePairs`]
  ) || 0;
  const targetLeafGames = Number(
    requirement[`${requirementPrefix}LeafValueReferenceGames`]
  ) || 0;
  return `${certificationRoleLabel(role)} ${structured ? "v2" : "v1"}`
    + `: 행동 ${action}/${targetAction}(경기 ${actionGames}/${targetActionGames})`
    + ` · 가치 ${leaf}/${targetLeaf}(경기 ${leafGames}/${targetLeafGames})`;
}

function structuredV2Remaining(partitions) {
  const result = {
    actionReferences: 0,
    actionGames: 0,
    leafPairs: 0,
    leafGames: 0
  };
  for (const partition of Object.values(partitions)) {
    const requirement = partition?.requirement || {};
    result.actionReferences += gap(
      partition?.structuredV2ActionReferenceCount,
      requirement.minimumStructuredV2ActionReferences
    );
    result.actionGames += gap(
      partition?.structuredV2ActionReferenceGameCount,
      requirement.minimumStructuredV2ActionReferenceGames
    );
    result.leafPairs += gap(
      partition?.structuredV2LeafValuePairCount,
      requirement.minimumStructuredV2LeafValuePairs
    );
    result.leafGames += gap(
      partition?.structuredV2LeafValueReferenceGameCount,
      requirement.minimumStructuredV2LeafValueReferenceGames
    );
  }
  return result;
}

function gap(current, target) {
  return Math.max(0, (Number(target) || 0) - (Number(current) || 0));
}

function appendCertificationNeeds(lines, progress) {
  const partitions = progress.certificationPartitions || {};
  const currentMode = progress.samplingMode;
  const policyQBootstrap = progress.evaluatorCertificateKind === "policy-q";
  const leafRows = [];
  const actionRows = [];
  for (const [role, partition] of Object.entries(partitions)) {
    const leafItems = (
      partition?.missingLeafValueDeckPhaseCoverage || []
    ).map((key) => formatDeckPhaseGap(partition, key, "leaf-audit"));
    if (leafItems.length) leafRows.push({ role, items: leafItems });
    const actionItems = [
      ...(partition?.missingActionReferenceActionClassCoverage || [])
        .map((key) => formatActionClassGap(partition, key)),
      ...(partition?.missingActionReferenceDeckPhaseCoverage || [])
        .map((key) => formatDeckPhaseGap(
        partition,
        key,
        "action-ranking-audit"
      ))
    ];
    if (actionItems.length) actionRows.push({ role, items: actionItems });
  }
  const leafCount = leafRows.reduce((sum, row) => sum + row.items.length, 0);
  const actionCount = policyQBootstrap
    ? 0
    : actionRows.reduce((sum, row) => sum + row.items.length, 0);
  lines.push(
    `비어 있는 조건 칸: 가치 ${leafCount}개 · 행동 ${actionCount}개`
    + ` · 합계 ${leafCount + actionCount}개 (증거 잔여량과 별도)`
  );
  if (policyQBootstrap) {
    appendMissingConditionRows(lines, "현재 가치 부족", leafRows, leafCount);
    lines.push("행동 조건   : 이번 Policy-Q 수집에서는 완료 판정에서 제외");
  } else if (currentMode === "action-ranking-audit") {
    appendMissingConditionRows(lines, "현재 행동 부족", actionRows, actionCount);
  } else {
    appendMissingConditionRows(lines, "현재 가치 부족", leafRows, leafCount);
    appendMissingConditionRows(lines, "다음 행동 감사", actionRows, actionCount);
  }
}

function appendMissingConditionRows(lines, label, rows, count) {
  if (count === 0) {
    lines.push(`${label}: 없음`);
    return;
  }
  if (count > 5) {
    lines.push(`${label}: ${count}개 조건`);
    return;
  }
  for (const row of rows) {
    lines.push(
      `${label}(${certificationRoleLabel(row.role)}): ${row.items.join(" / ")}`
    );
  }
}

function certificationRoleLabel(role) {
  return ({
    training: "학습",
    development: "개발",
    confirmation: "확인",
    "final-audit": "최종"
  })[role] || role;
}

function formatDeckPhaseKey(value) {
  const [deckId, phase] = String(value).split("::");
  const deck = deckLabel(deckId).replace(/ \([^)]*\)$/, "");
  const phaseName = ({
    mulligan: "멀리건",
    early: "초반",
    mid: "중반",
    late: "후반"
  })[phase] || phase;
  return `${deck} ${phaseName}`;
}

function actionClassLabel(value) {
  return ({ mulligan: "멀리건" })[value] || value;
}

function formatDeckPhaseGap(partition, key, mode) {
  const action = mode === "action-ranking-audit";
  const requirement = partition?.requirement || {};
  const evidenceCoverage = action
    ? partition?.actionReferenceDeckPhaseCoverage
    : partition?.leafValueDeckPhaseCoverage;
  const gameCoverage = action
    ? partition?.actionReferenceDeckPhaseGameCount
    : partition?.leafValueDeckPhaseReferenceGameCount;
  const evidence = Math.max(0, Number(evidenceCoverage?.[key]) || 0);
  const games = Math.max(0, Number(gameCoverage?.[key]) || 0);
  const requiredEvidence = Math.max(
    1,
    Number(action
      ? requirement.minimumActionReferencesPerDeckPhase
      : requirement.minimumLeafValuePairsPerDeckPhase) || 1
  );
  const requiredGames = Math.max(
    1,
    Number(action
      ? requirement.minimumActionReferenceGamesPerDeckPhase
      : requirement.minimumLeafValueReferenceGamesPerDeckPhase) || 1
  );
  return `${formatDeckPhaseKey(key)}: ${action ? "행동" : "가치"} `
    + `${gapLabel(evidence, requiredEvidence)}`
    + `, 경기 ${gapLabel(games, requiredGames)}`;
}

function formatActionClassGap(partition, key) {
  const requirement = partition?.requirement || {};
  const evidence = Math.max(
    0,
    Number(partition?.actionReferenceActionClassCoverage?.[key]) || 0
  );
  const games = Math.max(
    0,
    Number(partition?.actionReferenceActionClassGameCount?.[key]) || 0
  );
  const requiredEvidence = Math.max(
    1,
    Number(requirement.minimumActionReferencesPerCoreClass) || 5
  );
  const requiredGames = Math.max(
    1,
    Number(requirement.minimumActionReferenceGamesPerCoreClass) || 5
  );
  return `${actionClassLabel(key)}: 행동 `
    + `${gapLabel(evidence, requiredEvidence)}`
    + `, 경기 ${gapLabel(games, requiredGames)}`;
}

function gapLabel(current, required) {
  return `${current}/${required}(${Math.max(0, required - current)} 부족)`;
}

function percent(value, total) {
  return total ? `${(value / total * 100).toFixed(1)}%` : "0.0%";
}

function formatOptionalPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "측정 전";
}

function formatOptionalRate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "측정 전";
}

function numberMetric(label, value) {
  return Number.isFinite(value) ? `${label} ${value.toFixed(4)}` : null;
}

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hourCycle: "h23" });
}
