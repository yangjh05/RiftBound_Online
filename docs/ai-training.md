# 순환형 셀프플레이 AI와 코칭

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

학습은 GAE를 적용한 clipped PPO이며 가치 손실, 상대 덱 추정 손실, 탐색 엔트로피를 함께 최적화합니다. 초기 세대에는 점수·보드·손패 우위를 이용한 potential-based 보상으로 탐색을 돕고 세대가 진행되면 해당 보상을 감쇠합니다. 결제·선택·반응·멀리건·이동·사이드보드·일반 행동을 계층별로 표본화하므로 합법 행동이 한도를 넘어도 특정 종류가 잘려 나가지 않습니다. 가치 예측에는 학습 궤적으로 온도 보정을 적용하고 Brier score와 ECE를 체크포인트에 기록합니다. Node 학습에서는 네이티브 TensorFlow CPU 백엔드를 우선 사용하고, `RIFTBOUND_TF_BACKEND=gpu` 환경에서는 설치된 TensorFlow GPU 백엔드를 시도한 뒤 CPU로 안전하게 대체됩니다.

상대 손패와 덱 순서는 상태 인코딩에서 제외됩니다. 정밀 복기는 공개 정보와 학습된 덱 분포에 맞는 여러 숨은 상태를 생성하되, 실제 숨은 패를 정답처럼 읽지 않습니다.

## 신경망 학습 전 점검

기본 정책의 플레이를 모방하는 초기 체크포인트가 필요하면 다음 명령을 사용합니다. 수집은 worker별로 병렬 실행되며, Origins 역사 메타 70%와 균등 탐색 30%를 혼합합니다. 최대 행동 수 안에 승패가 결정된 경기만 학습에 사용하고, 목표 완주 경기 수를 채울 때까지 제한된 횟수만큼 다시 시도합니다.

```powershell
npm run ai:bootstrap -- --games 256 --workers 4 --epochs 5 --batch-size 8 --max-actions 640 --card-pool origins-era --output src/ai/checkpoints/neural-champion.json
```

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
npm run ai:bootstrap:logged -- --games 256 --workers 4 --epochs 5 --batch-size 8 --max-actions 640 --card-pool origins-era --seed 20251207 --output src/ai/checkpoints/neural-champion.json
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
