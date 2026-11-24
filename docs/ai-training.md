# 순환형 셀프플레이 AI와 코칭

2026-09-23: 현재 adaptive 학습은 저장 경계에서 [오리진 합법 덱 탐색](audits/ai-deck-search-2026-09-23.md)을 활성화합니다. Origins·Proving Grounds의 비금지 카드만 사용하며, 기존 기준 덱과 작은 변경·큰 변경을 함께 학습합니다. 비오로라 마스터 이의 오리진 보정 초안은 미검증 출발점으로 표시합니다.

AI는 사람과 동일한 게임 엔진과 공용 카드 효과 resolver를 사용합니다. 카드 이름에 따라 행동을 고정하는 전략 분기는 두지 않습니다. 학습 전 파이프라인은 다음 네 문제를 함께 다루도록 구성되어 있습니다.

- **플레이**: 공개 상태와 이전 의사결정을 기억하는 GRU 정책이 모든 합법 행동의 점수를 계산합니다.
- **숨은 정보**: 공개된 전설·카드·보드만으로 상대 덱 유형과 카드 분포를 베이지안 방식으로 갱신합니다.
- **구축**: 카드 한 장뿐 아니라 카드 패키지, 룬 구성, 전장 조합을 변이하고 덱·매치업별 성과를 따로 기록합니다.
- **복기**: 덱 구축, 멀리건, 실제 플레이를 분리해 후회를 측정하고 중요한 수는 숨은 정보의 여러 가능한 구성을 샘플링해 재시뮬레이션합니다.

## 모델 구조

고정 길이 공개 상태 인코딩과 합법 행동 인코딩을 사용하므로 카드 수나 선택지 수가 달라도 같은 네트워크로 처리할 수 있습니다. 모든 등록 카드는 정렬된 고유 카드번호 사전의 전용 슬롯을 사용합니다. 해시 압축을 사용하지 않으므로 카드 정체성 충돌이 없고, 사전 전체가 체크포인트에 저장되어 카드 풀이 달라진 체크포인트를 잘못 불러오는 것도 차단합니다. 상태 투영층은 각 카드 슬롯의 학습 가능한 임베딩 역할을 합니다. GRU 메모리 뒤에는 세 개의 학습 헤드가 있습니다.

1. 합법 행동별 정책 점수
2. 현재 상태의 승패 가치
3. 상대 덱에 포함될 카드 분포

학습은 GAE를 적용한 clipped PPO이며 가치 손실, 상대 덱 추정 손실, 탐색 엔트로피를 함께 최적화합니다. 현재 세대 학습은 실제 최종 승패를 목표로 사용하며, 점수·보드·손패 우위의 보조 보상 가중치는 모든 단계에서 0입니다. 결제·선택·반응·멀리건·이동·사이드보드·일반 행동을 계층별로 표본화하므로 합법 행동이 한도를 넘어도 특정 종류가 잘려 나가지 않습니다. 가치 예측에는 학습 궤적으로 온도 보정을 적용하고 Brier score와 ECE를 체크포인트에 기록합니다. Node 학습에서는 네이티브 TensorFlow CPU 백엔드를 우선 사용하고, `RIFTBOUND_TF_BACKEND=gpu` 환경에서는 설치된 TensorFlow GPU 백엔드를 시도한 뒤 CPU로 안전하게 대체됩니다.

상대 손패와 덱 순서는 상태 인코딩에서 제외됩니다. 정밀 복기는 공개 정보와 학습된 덱 분포에 맞는 여러 숨은 상태를 생성하되, 실제 숨은 패를 정답처럼 읽지 않습니다.

2026-09-15부터 가속 등 추가 비용의 선택은 정책이 직접 학습하고, 선택 이후 룬 지급만 자동화합니다. 전술 시범은 같은 턴의 비용·득점·후속 행동을 비교하여 비가속 연계, 군단 순서, 주문과 전투의 대상 배분, 위력 감소→피해 주문 제거를 다룹니다. 기존 가중치는 보존하되 변경된 행동 공간의 경기와 평가는 새 실행에 수집합니다. [수정 및 검증 기록](audits/ai-strategic-costs-and-removal-combos-2026-09-15.md)에 범위와 제한을 기록했습니다.

## 학습 저장공간 자동 정리

Adaptive 학습, 독립 덱 학습, 신경망 학습은 시작할 때와 이후 15분마다 안전한 정리를 실행합니다. 이전 검사가 진행 중이면 겹쳐 실행하지 않으며, 수동 정리와 여러 학습 프로세스도 공용 잠금으로 순서대로 처리합니다. 다른 정리가 길어지면 학습은 계속하고 정리는 다음 주기에 재시도합니다. 정리 오류는 학습을 중단시키지 않으며, 디스크 여유가 5GiB 미만이면 경고합니다.

정리 대상은 저장이 확정된 Adaptive 후보의 중간 `epoch.json.gz`, 생성 프로세스가 종료된 원자적 쓰기 임시 파일, 소유자 정보가 있는 종료된 테스트·self-play 임시 폴더, 비어 있는 `iterations/<회차>/rejected-games/<경기>` 폴더입니다. 임시 파일과 빈 폴더는 마지막 수정 후 최소 1시간이 지나야 하며, 원자적 쓰기 파일은 정식 저장본이 정상적으로 읽혀야 합니다. 작업자 또는 부모 프로세스가 살아 있거나 확인이 불가능하면 임시 파일을 보존합니다. 삭제 직전 파일 식별 정보와 경로를 다시 검사하고 심볼릭 링크·Windows junction을 따라가지 않습니다. 빈 폴더는 재귀 삭제 없이 제거하여 도중에 진단 파일이 도착하면 그대로 남깁니다.

자가대전은 실제 실패 자료를 저장할 때만 `rejected-games` 폴더를 생성합니다. 성공한 경기마다 비어 있는 폴더를 미리 만들던 누적 원인도 제거했습니다. 실패 자료가 들어 있는 폴더는 보존합니다.

모델, 원본 대국, 학습·평가 증거, 재시작 상태, 미완료 iteration, 소유자 정보가 없는 기존 임시 폴더, `.incoming` 파일, 로그와 임의의 `.tmp-*` 작업 폴더는 자동 삭제하지 않습니다. 필요한 데이터가 계속 증가하면 정크 정리만으로 여유 공간을 유지할 수 없으므로 별도 저장장치나 보관 정책이 필요합니다.

```powershell
npm run ai:storage                         # 삭제 없이 후보·용량 확인
npm run ai:storage:clean                   # 현재 안전하게 삭제할 수 있는 파일 정리
npm run ai:storage:watch                   # 별도 감시 프로세스에서 15분마다 정리
npm run ai:storage -- --root data/ai/my-run # 특정 실행만 점검
```

별도 감시 명령은 이미 실행 중인 이전 런타임에도 학습 재시작 없이 적용할 수 있습니다. 같은 데이터 루트의 중복 감시 실행은 lock으로 방지하며, 최신 결과는 `data/ai/storage-maintenance.json` 한 파일에 덮어씁니다. `Ctrl+C`로 종료할 수 있고, 별도 감시 프로세스는 PC 재부팅 후 다시 실행해야 합니다. 수정된 학습 프로그램은 실행할 때 자체 정리를 시작합니다. AI 테스트에서 생성하는 관리 대상 임시 폴더는 정상 종료 시 즉시 정리하며, 비정상 종료 잔여물은 다음 정리에서 처리합니다.

## 신경망 학습 전 점검

2026-09-06부터 Policy-Q 평가기를 처음 구축할 때는 학습용 독립 비교 자료 120개와 기여 경기 80개를 확보한 뒤 작은 조기 진단을 먼저 실행합니다. 같은 경기에서 나온 자료가 양쪽에 섞이지 않도록 학습/진단 검증을 약 80/20으로 나누고, structured-v2 구조 3종을 각각 3 epoch 실행합니다. 이 결과는 손실·순위 계산의 정상 작동과 과적합 징후를 확인하는 용도이며 공식 구조 선택이나 승격에 사용하지 않습니다. 공식 Shadow 학습의 1,500개 기준, Development/Confirmation/Final audit 분리는 유지합니다.

AI 탐색의 게임 상태 복사는 모든 필드와 내부 참조 관계를 보존하는 공용 `cloneAiState`를 사용합니다. 일반 객체·배열 이외의 값이 포함되면 전체 그래프를 `structuredClone`으로 처리합니다. `RIFTBOUND_AI_NATIVE_CLONE=1`로 기존 복사 경로를 선택해 `node scripts/benchmark-ai-clone.mjs`와 비교할 수 있습니다. 상세 측정과 재시작 자료 보존 검증은 [2026-09-06 효율 개선 기록](audits/ai-training-efficiency-2026-09-06.md)에 있습니다.

평가 자료 수집 단계는 데이터셋 폴더에 `restart-contract.json`으로 수집 조건을 보관합니다. 경기 경계 중단 후 임시 프로세스 전달 파일이 삭제되어도 재시작 검사는 이 조건의 데이터셋 해시와 저장된 경기의 출처를 확인할 수 있습니다. 조건 불일치와 미완료 저장 기록을 임의로 통과시키지 않습니다. [2026-09-07 자동 전환 복구 기록](audits/ai-training-restart-recovery-2026-09-07.md)에 관련 원인과 검증을 기록했습니다.

기본 정책의 플레이를 모방하는 초기 체크포인트가 필요하면 다음 명령을 사용합니다. 수집은 worker별로 병렬 실행되며, Origins 역사 메타 70%와 균등 탐색 30%를 혼합합니다. 최대 행동 수 안에 승패가 결정된 경기만 학습에 사용하고, 목표 완주 경기 수를 채울 때까지 제한된 횟수만큼 다시 시도합니다.

```powershell
npm run ai:bootstrap -- --games 256 --workers 4 --epochs 5 --batch-size 8 --max-actions 800 --card-pool origins-era --output src/ai/checkpoints/neural-champion.json
```

### Bootstrap integrity and quality gates

The bootstrap job rejects a run instead of publishing a weak or corrupted model when any required condition fails:

- every requested game must complete, while capped-game rate, action truncation, deck coverage, and first-player balance stay within configured limits;
- every tensor is checked for shape and finite values, train/validation game IDs must not overlap, and the collected dataset receives a SHA-256 fingerprint;
- the full legal action set is scored before capping, and the teacher-selected action is always retained in the encoded set;
- payment decisions reuse a verified completion plan, and repeated card-play intents are suppressed within a turn to prevent collection loops;
- validation is measured after every epoch, the best held-out epoch is retained, and the model must beat chance plus either its untrained accuracy or policy-loss baseline;
- `latest-checkpoint.json`, `best-checkpoint.json`, `run-status.json`, and `console.log` remain available for diagnosis or recovery when a run fails;
- the final model checksum, dataset fingerprint, report state, and both quality gates are verified before an artifact can be applied.

GitHub Actions also runs the complete engine test suite before collection and verifies the generated artifact before upload. A failed or `quality-rejected` run must not be applied by bypassing the verifier.

초기 정책은 PPO가 아니라 교사 행동 cross-entropy, 최종 승패 가치 회귀, 상대 덱 카드 분포 손실로 학습합니다. 교사가 1순위와 2순위를 명확하게 구분한 판단에 높은 가중치를 부여하며, 강제 행동을 제외한 검증 행동 일치율도 별도로 계산합니다. 실행 중에는 JSON Lines 형식으로 worker 진행률과 epoch 결과가 출력됩니다. 완료 후 `data/ai/runs/bootstrap-*.json`에 다음 정보가 저장됩니다.

- 완주·행동 제한·실패 경기 수와 완주율
- 완주 경기의 평균 행동 수와 턴 수
- 덱별 등장 횟수와 평균 교사 확신도
- 학습/검증 경기 분리 수
- 전체 행동 일치율과 복수 선택지 행동 일치율
- 검증 정책 손실, 가치 MSE, 덱 추정 손실 및 실제 신경망 예측 보정치
- 전체 실행 인자, seed, 시작·종료 시각과 소요시간

체크포인트와 보고서는 임시 파일에 완전히 기록한 뒤 원자적으로 교체되므로 중단된 실행이 기존 챔피언을 덮어쓰지 않습니다.

## GitHub Actions에서 초기화 실행

`.github/workflows/ai-bootstrap.yml`을 GitHub 저장소에 올리면 **Actions → AI Bootstrap Training → Run workflow**에서 모방 초기화를 실행할 수 있습니다. 표준 Ubuntu runner의 메모리를 고려해 기본 worker 수는 2이며, 작업 제한시간은 6시간입니다. 완료 여부와 관계없이 다음 파일을 `origins-ai-bootstrap-...` artifact로 업로드합니다.

- `neural-champion.json` — 성공한 경우에만 존재하는 세대 0 모델
- `run-report.json` — 완주율, 손실, 검증 정확도와 설정
- `console.log` — worker 진행률과 epoch 로그

artifact를 내려받아 압축을 푼 뒤 다음 명령으로 적용합니다. 적용기는 모델 버전·완료 상태·세대·Origins 카드풀을 검증하고 기존 로컬 모델을 `data/ai/backups`에 백업합니다.

```powershell
npm run ai:bootstrap:apply -- --input "C:\Downloads\origins-ai-bootstrap-실행번호"
```

장기 실행을 로컬 PowerShell에서 직접 수행할 때는 TensorFlow의 정상 `stderr` 안내가 PowerShell 오류로 변환되지 않도록 로깅 래퍼를 사용합니다.

```powershell
npm run ai:bootstrap:logged -- --games 256 --workers 4 --epochs 5 --batch-size 8 --max-actions 800 --card-pool origins-era --seed 20251207 --output src/ai/checkpoints/neural-champion.json
```

```powershell
npm run ai:neural:smoke
```

짧은 점검도 실제 궤적과 후보 체크포인트를 `data/ai`에 기록합니다. 프로덕션 챔피언을 건드리지 않고 별도 경로에서 시험하려면 다음처럼 실행합니다.

```powershell
node scripts/train-neural-ai.mjs --games 2 --evaluation-games 2 --workers 1 --epochs 1 --max-actions 120 --output tmp/neural-test.json --data-dir tmp/neural-test-data
```

## 세대 학습

```powershell
npm run ai:neural:train -- --games 256 --evaluation-games 80 --workers 4 --epochs 4 --seed 20260714
```

지속 학습은 다음 명령을 사용합니다.

```powershell
npm run ai:continuous
```

경기 수집의 자동 워커 조절은 다음처럼 켭니다. `workers`는 경기 배정과 난수 시드에 사용하는 논리 그룹 수이며, 실제 프로세스는 4개로 시작해 메모리 여유에 따라 최대 16개까지 늘어납니다. 여유 메모리가 4 GiB 아래로 내려가면 새 경기 배정을 보류하고, 진행 중인 경기를 저장한 뒤 프로세스 수를 줄입니다. 평가 데이터 수집에도 같은 초기 프로세스 수를 적용하며, 평가 단계의 최대치는 별도로 지정합니다.

```powershell
npm run ai:continuous -- --processes 4 --maximum-processes 16 --dynamic-scaling true --selfplay-memory-reserve-gb 4 --evaluator-action-audit-processes 16
```

수집 작업 하나에는 단판 또는 최대 3판의 매치가 들어갑니다. **기본적으로 총 경과 시간에 따른 강제 종료는 하지 않습니다.** 복잡한 경기나 CPU 경합으로 오래 걸리는 정상 작업을 버리지 않기 위한 설정입니다. 풀 호출자가 양수 `maximumTaskDurationMs`를 명시할 때만 작업 전체의 시간 제한을 적용하며, 0은 제한 없음입니다.

작업자는 프로파일링 설정과 관계없이 복사·합법 행동 검사·행동 적용·추론·탐색 계산 횟수를 최대 5초 간격으로 기록합니다. 행동 적용에는 탐색 중 시뮬레이션도 포함되므로 실제 대전의 행동 수와 다릅니다. 긴 동기식 탐색 중에도 기록되며, 진행 상태의 `workerPool.active[].progress`에서 확인할 수 있습니다. 5분 동안 새 기록을 확인하지 못하면 `no-recent-progress` 경고를 표시하고 계산은 계속합니다. 기록 부재만으로 정지를 확정하거나 재시도하지 않습니다. 실제 프로세스 종료·오류 또는 명시적으로 활성화한 제한 초과는 같은 시드로 최대 두 번 재시도하고, 계속 실패하면 중단합니다.

실행 중 `progress/latest.json`의 `workerPool.dynamicScaling`, `processCount`, `maximumProcessCount`, `minimumFreeMemoryBytes`에서 적용 여부를 확인할 수 있습니다. 프로세스 수만 바꾸는 것은 경기 배정 그룹과 수집 데이터 식별자를 바꾸지 않습니다.

각 세대는 아래 순서로 진행됩니다.

1. 여러 worker에서 좌석과 덱 조합을 바꿔 셀프플레이 궤적을 수집합니다. 현 챔피언뿐 아니라 최근 과거 챔피언 리그를 상대 풀로 사용합니다.
2. 카드 패키지, 룬, 전장, 등록 사이드보드 변이를 포함한 덱 population을 평가합니다.
3. PPO로 후보를 학습하고 가치 예측을 보정합니다.
4. 단판과 3판 2선승 매치를 함께 수행합니다. 매치에서는 메타 카드 분포와 현재 덱·사이드보드를 관찰하고, 메인↔사이드 교체 및 다음 게임 선공 선택을 매치 최종 승패로 학습합니다.
5. 현 챔피언 및 과거 챔피언 리그와 양쪽 좌석에서 대전합니다.
6. 충분한 대전이 완주되고 현 챔피언 및 각 과거 챔피언에 대한 최악의 Wilson 하한과 좌석별 승률 편차가 모두 기준을 넘을 때만 챔피언을 교체합니다.

챔피언은 `src/ai/checkpoints/neural-champion.json`, 세대별 압축 궤적·탈락 후보·과거 챔피언 리그·Adam optimizer 상태는 `data/ai` 아래에 저장됩니다. 체크포인트는 임시 파일을 거쳐 원자적으로 교체되므로 중단 중에 기존 챔피언이 손상되지 않습니다. `/api/ai/status`에서 현재 수집·학습·평가 상태를 확인할 수 있습니다.

여러 머신에서 궤적만 수집할 때는 동일한 챔피언 체크포인트를 배포하고 서로 다른 shard 번호를 지정합니다. 생성된 gzip shard를 한 폴더에 모은 뒤 학습기에 전달할 수 있습니다.

```powershell
npm run ai:collect:shard -- --shard-index 0 --shard-count 4 --games 64 --card-pool origins-era
npm run ai:neural:train -- --trajectory-shards data/ai/shards --card-pool origins-era
```

## 현재 메타 가져오기

별도 메타 파일이 없으면 현재 구현 카드풀에 맞춰 **Origins 출시 환경**을 기본값으로 사용합니다. 기본 역사 스냅샷은 2025 Houston Regional Qualifier 1일 차 1,129명 분포이며, 저장소에 덱 프로필이 있는 레전드의 공식 참가 수를 그대로 사용합니다. 승수 자료가 없는 역사 통계는 승률을 0%로 간주하지 않고 `null`로 유지합니다. 카드풀은 `origins-era`(Origins + Proving Grounds), `spiritforged-era`, `unleashed-era`의 누적 출시 환경으로 구분됩니다.

외부 대회·랭크 통계를 다음 형태의 JSON으로 준비할 수 있습니다. `main`과 `sideboard`는 카드번호와 장수의 목록입니다.

```json
{
  "source": "season snapshot",
  "observedAt": "2026-07-14T00:00:00Z",
  "decks": [
    {
      "id": "meta-deck-id",
      "name": "Deck name",
      "legend": "OGN-000/298",
      "games": 1200,
      "wins": 630,
      "share": 0.18,
      "main": [["OGN-001/298", 3]],
      "sideboard": [["OGN-002/298", 2]]
    }
  ]
}
```

```powershell
npm run ai:meta:import -- --input data/meta-snapshot.json --source "ranked-season"
```

가져온 점유율은 셀프플레이 상대 덱 샘플링, 상대 덱 사전확률, 사이드보드 후보 구성과 3판 2선승 평가에 반영됩니다. 새 스냅샷으로 같은 명령을 실행하면 다음 학습 세대부터 현재 환경이 바뀝니다.

완료된 사람 경기의 공개 상태·합법 행동·선택·코치 추천은 희소 학습 표본으로 `data/ai/replays`에 저장됩니다. 정밀 롤아웃이 끝나면 같은 복기 파일을 갱신하며, 최소 시뮬레이션 수·신뢰도·신뢰구간 폭을 통과한 결정만 학습에 사용합니다. 학습기는 최근 복기 중 최대 25%만 보조 표본으로 사용하여 사람의 실수를 그대로 과적합하지 않고, 후회가 큰 선택은 코치 추천 행동을 교정 목표로 사용합니다.

기존 선형 학습기는 회귀 비교용으로 남아 있습니다.

```powershell
npm run ai:train:quick
npm run ai:train -- --games 1000 --evaluation-games 100 --seed 20260714
```

## 게임과 복기 UI

두 덱을 선택한 뒤 **학습 AI와 대전**을 시작하면 신경망 챔피언이 있을 때 순환형 PPO 정책을 사용하고, 아직 학습되지 않았으면 기본 정책으로 안전하게 대체됩니다. **AI 분석**에서는 다음 항목을 따로 보여 줍니다.

- 덱 구축 기여도와 학습된 교체 실험
- 멀리건 후회
- 실제 플레이 후회와 주요 변곡점
- 공개 정보로 추정한 상대 덱과 추천 매치업 플랜
- 현재 셀프플레이 환경에서 많이 쓰이는 카드

**정밀 롤아웃 분석**은 후회가 큰 사람의 선택을 골라 여러 가능한 상대 손패·덱 순서에서 대안을 반복 시뮬레이션하고, 실제 챔피언 신경망 정책과 보정된 가치 헤드로 평균 승리 가치와 신뢰구간을 다시 계산합니다. 완료된 복기는 `data/ai/replays`에 보관되어 이후 사람의 실수 데이터로 재학습할 수 있습니다.

덱 편집기의 고급 검색에서는 누적 카드풀, 개별 출시 카드팩, 카드 종류, 도메인, 최대 에너지를 함께 지정할 수 있습니다. **선택 카드풀 AI 추천**은 동일한 카드풀 제한을 덱 교체 및 사이드보드 후보에 적용하며 세대·표본 수·신뢰도를 함께 표시합니다.

예상 승률과 추천은 규칙상 절대 정답이 아닙니다. 표본이 적은 덱·매치업·상대 유형은 낮은 신뢰도로 표시하며, 챔피언 승격 판단 역시 단순 관측 승률이 아니라 신뢰 하한을 사용합니다.
# 현재 장기 실행: 학습과 승격 분리

2026-09-14부터 진행 중인 재학습은 `scripts/train-adaptive-policy-q.mjs`의
별도 실행 계약을 사용합니다. 희귀 상황의 Shadow 정밀도 부족은 후보 학습을
막지 않으며, 실제 챔피언 교체는 동결한 독립 대전 평가가 통과해야 합니다.
자기대전·저장 상태 감사·후보 갱신·평가를 분리하고 전체 계산 슬롯은 16개로
제한합니다. 기존 실행 자료와 고정 검증 분할을 보존합니다.

현재 실행(2026-09-22): `adaptive-policy-q-live-games-20260922`. 811세대에서 실전 경기 평가기 학습을 연결한 새 엔진 실행으로 이전했고, 후속 작업에서 별도 검증을 통과한 실전 대안을 실제 행동 교정에 연결했습니다. 실행/재개는 프로젝트 루트에서 `pwsh -NoProfile -File .tmp-ai-live-policy-20260922/run-training.ps1`을 사용합니다. 새 대시보드는 `http://127.0.0.1:4181`입니다. 기존 실행·모델·진행 중 승격 평가를 보존합니다. [실전 학습 및 행동 교정 절차](ai-live-game-learning.md)를 참고하십시오.

상태: 해당 디렉터리의 `status.json`, `events.jsonl`, `state.json.gz`.
구조, 통계적 해석과 한계는 [변경 검증 기록](audits/ai-adaptive-policy-q-2026-09-14.md)을 참고합니다.

2026-09-15부터 기존 경기의 학습/검증 역할은 후속 수집이 끝나도 재배정하지
않습니다. 매 회차 학습·검증 목록을 고정하고, 재개 시 과거 학습 계획도 검증 목록과
대조합니다. 진행 중인 평가는 유지하며 대기 후보는 가장 최근 저장한 후보로 갱신합니다.
승격 전에는 동결한 조건과 저장된 경기로 판정을 다시 계산합니다.
이번 오류 수정, 자료 복원 및 검증 범위는
[엄격 검증 기록](audits/ai-adaptive-integrity-2026-09-15.md)에 정리했습니다.

100회차에서 발생한 자연 종료 검사 실패 이후에는 거절 경기를 먼저 별도 보관하고,
행동 한도에 도달한 경기만 한도를 확대해 재계산합니다. 실제 규칙 오류는 계속 차단합니다.
새 계획은 엔진 셔플 난수까지 시드로 고정합니다.
[중단 원인과 복구 기록](audits/ai-adaptive-stop-recovery-2026-09-15.md)을 참고합니다.

## 2026-10-14: 실제 Hidden 규칙과 카이사·빅토르 대화 검토 반영

`execution-r15-conversation-rules`부터 수정된 Hidden/Reaction 엔진을 사용합니다.
현재 실행은 `data/ai/deck-league-20261007/execution-active.json`에서 확인합니다.
새 엔진 지문은 `sha256:82672d935914740e67ee48d3a9bc9b758000f404fea8fe4fed61806cbc1a0a7d`입니다.
기존 7개 학습기의 체크포인트, Adam 상태, 원본 교정·검증 자료를 보존하고 저장 경계에서 전환했습니다.

사용자와 검토한 12개 분기의 이유·대안과 교정 사항은
`data/ai/conversation-integration-20261014/conversation-analysis.json` 및
`certified-evidence/source-reviews.json.gz`에 보관합니다. 합성 상황 2개는 일반 경기로 취급하지 않았으며,
나머지 10개 분기를 수정된 엔진에서 완주 재생하여 432개 판단 후보를 검토했습니다.
기존 공개 정보 검증 기준을 통과한 정책 교정 5개(카이사 3개, 빅토르 2개)를 각 학습 자료에 추가했습니다.
상대 비공개 손패와 알려지지 않은 덱 순서를 변경해도 입력·추천이 유지되는지 재검사했습니다.
멀리건 등으로 알고 있는 덱 아래 카드의 위치는 이 검사에서 보존합니다.

교정에는 멀리건, 불필요한 Hextech Ray 사용을 피하는 선택,
특정 7:7 상황의 Grand Strategem/Vanguard Captain 전개 순서가 포함됩니다.
현재 카이사 학습 덱과 사용자가 제시한 덱은 다르므로 원본 덱 식별자와 동일 챔피언 변형 덱 간 교정 출처를 유지했습니다.
반복된 수동 지불 조작은 하나의 선택 시점으로 묶고, 플레이어 자신의 전체 관측 이력으로 순환 신경망 기억을 재구성합니다.

폭우로 신병과 중형 유닛을 함께 제거하는 가치, Captain·Leader의 본진 보존,
광선 보존, 귀환·재전개 및 폭우 없이 이긴 대안은 조건부 분기 분석으로 함께 기록했습니다.
같은 턴 같은 전장에서 다시 점수를 얻는다는 철회된 설명은 정답으로 채택하지 않았습니다.
분기들이 같은 초기 게임에서 파생되었으므로 모두 하나의 학습 가족으로 묶었습니다.
독립 경기 승률, 선후공별 승률, 전역 최적수 또는 가치·승패 정답으로 사용하지 않습니다.

기존 평가 요청은 원래 엔진·설정에 고정된 채 완료되며 새 규칙의 모델 승격·복구 근거로 사용하지 않습니다.
새 평가부터 수정된 엔진을 사용하고 평가 예산·승격 기준은 유지합니다.
새 규칙에서 수집되는 자원 관리 교정은 `corrected-rules-resource-curriculum-20261014`에 따로 저장합니다.

반영 자료와 실행 상태는 `data/ai/conversation-integration-20261014/activation.json`,
`runtime-verification.json`, `privacy-and-acceptance-audit.json`, `live-verification.json`에서 확인합니다.
교정 자료 연결은 각 덱의 다음 학습 순번부터 적용됩니다. 가중치 개선·승률 향상은 이 전환만으로 입증되지 않습니다.

## 2026-10-14: 문장 등 재사용 힘 도구의 전개 시점 학습

기존 `localResourceDecision`은 주문과 군단 비용 할인만 대상으로 삼아 문장의
설치 시점을 검토하지 않았습니다. `execution-r16-resource-timing`은 완료된
자기 정책 경기에서 이 판단도 검토합니다. 경기당 검토 상한 2회는 유지하며,
그중 최대 1회를 이 종류의 판단에 배정합니다. 카드 이름 대신 `addPower`
능력과 비용을 검사하므로 같은 효과의 다른 문장에도 적용됩니다.

새 교사는 실제 엔진에서 같은 두 행동을 양쪽 순서로 실행합니다. 자원 외
판면이 같고 자원 선택지가 줄지 않으면서 에너지 또는 룬이 더 남는 비교만
교정 후보로 만듭니다. 다음 세 경우를 집중 검사했습니다.

- 준비된 룬 3개로 2에너지 유닛과 문장을 낼 때, 기존 자동 지불 방식에서는
  유닛부터 내면 문장부터 내는 순서보다 사용 가능한 에너지 1개가 더 남습니다.
- 이미 에너지를 쓴 룬이 있을 때 문장부터 내고 힘을 필요한 유닛에 공급하면,
  유닛부터 내고 문장을 추가하는 순서보다 룬 1개를 더 보존할 수 있습니다.
- 지금 쓸 힘이 없고 다른 전개나 이동도 할 수 없을 때에는, 다음 자기 턴에
  현재 손패의 에너지 전용 유닛을 먼저 내고 문장을 내는 분기와 비교합니다.
  동일 판면에서 에너지가 더 남는 경우에만 이번 턴 보류를 교정 후보로 삼습니다.

보류 검토는 알려진 힘 비용·군단 효과·반응 카드, 기존 문장으로 무료 설치가
가능한 경우 등을 보수적으로 제외합니다. 미래 드로우와 룬의 색 순서는
알고 있다고 가정하지 않습니다. 비교 수순은 상대의 자발적인 대응이 없고
기존 자동 지불을 사용하는 조건입니다. 룬 에너지를 미리 생성하는 모든
수순이나 상대의 모든 대응까지 탐색한 전역 최적수라는 뜻은 아닙니다.

추천은 경기 종료 후에만 생성합니다. 경기 중 신경망 선택과 확률을 덮어쓰지
않으며, 기존 가중치·Adam 상태·검증 자료·누적 교정 자료·평가 실행은 보존합니다.
새 교사 기준은 `local-resource-with-deployment-v2`로 명시하고, 과거와 같은
교사라고 표기하지 않습니다. `deploymentOpportunities`, `deploymentReviews`,
`deploymentProved`로 검토와 승인 수를 분리하며, 승인된 자료에는 비교 수순과
자원 스냅샷을 저장합니다. 새 자료도 전체 자기 관측 이력을 사용하며 보호된
검증 입력과 중복 입력은 기존과 같이 배제합니다.

준비·검사·전환 기록은 `data/ai/resource-timing-20261014-r3/`에 저장합니다.
관련 30개 검사가 통과했습니다. 규칙 엔진·신경망·옵티마이저 파일은 이전
학습 실행과 동일하며 엔진 지문도 바뀌지 않았습니다. 저장된 대화의 문장
보유 11개 국면에서는 검사한 빅토르 champion 및 137회차 learner가 문장을
첫 선택으로 고르지 않았습니다. 따라서 사용자가 관찰한 특정 경기의 즉시
사용을 재현했다고 주장하지 않습니다. 새 수집 경로의 활성화와 실제 모델의
판단 개선·대전용 모델 승격은 별개로 확인해야 합니다.
