# 학습 입력 크기 불일치 복구

## 원인과 범위

2026-09-22 04:52:43 KST에 실행 중이던 controller 24608이 372회차 PPO 학습에서 `RangeError: offset is out of bounds`로 종료됐습니다. 위치는 `src/ai/neural/trainer.mjs`의 `packPpoBatch`, `states.set(step.state, flat * STATE_DIM)`입니다.

다른 작업에서 `OGN-303a/298` 일러스트 카드를 등록했습니다. 실행 중인 controller는 기존 카드 어휘와 stateDim 6022를 유지했지만, 다음 회차에서 새로 시작한 worker는 확장된 어휘와 stateDim 6026을 로드했습니다. 기존 worker 초기화는 체크포인트의 카드 어휘 확장을 허용했고, controller는 전달한 기존 엔진 지문을 신뢰하여 크기가 다른 궤적까지 수집했습니다. 기존 수집 승인/학습 사전 검사는 상태 벡터 길이를 검사하지 않았습니다.

369·370·371회차의 전체 96경기를 검사했고 모두 stateDim 6022였습니다. 372회차 32경기는 모두 stateDim 6026, actionDim 521, beliefTarget 길이 991이었습니다. 기존 760세대와 챔피언 714세대는 stateDim 6022로 정상 저장됐습니다. 372회차는 첫 epoch까지 중간 체크포인트가 생성됐지만 최종 candidate는 저장되지 않았습니다. 긴 벡터 복사가 항상 즉시 실패하는 것은 아니므로, 이 중간 checkpoint와 optimizer를 절대로 재개에 사용하지 않습니다.

## 복구

- 372회차의 32경기·중간 epoch·관련 audit 상태 폴더 26개를 `.tmp-ai-offset-recovery-20260922/quarantine`으로 이동해 원본을 보존했습니다.
- 해당 회차의 freshEvidence 32개만 활성 학습 상태에서 제외했습니다. 이 자료에 연결된 완료 audit/sidecar는 0개였습니다. 이전 freshEvidence 11,872개, 별도 legacy 자료, 검증 분할, 진행 중 평가 요청은 유지했습니다.
- 760세대 learner, 714세대 champion, config와 42번 평가 요청의 SHA-256이 변경되지 않았음을 확인했습니다. 기존 회차 계획·시드는 유지하며 잘못된 epoch 재사용 없이 372회차를 다시 수집합니다.
- 별도 보존한 `.tmp-ai-reboot-deploy-20260922/training-runtime`으로 controller 및 self-play/evaluation/audit worker를 모두 재개했습니다. 이 복사본의 466개 지문 파일은 이전 검증본과 정확히 일치합니다. 메인 게임 코드의 최신 번역·카드는 되돌리지 않았습니다.

## 재발 방지

`scripts/ai-training-representation.mjs`는 프로세스에 실제 로드된 상태/행동 크기, 카드 어휘 해시와 action capacity를 고정해 worker 초기화 때 비교합니다. 같은 크기지만 카드 순서가 달라진 경우도 거절합니다. worker는 모델을 불러오기 전에 실제 엔진 지문도 controller의 학습 계보와 일치하는지 검사합니다.

`assertAdaptiveGame`은 새 경기 저장 전과 저장 경기 재사용 시 모든 단계의 상태/행동/상대 패 추정 벡터 길이를 검사합니다. 불일치 자료는 PPO나 정상 증거 목록에 들어가지 않고 진단 자료로 보존됩니다. 이 방어는 `scripts` 경계에만 추가했으며 게임 규칙, 학습 계산, 과거 지문 및 자료를 변경하지 않았습니다. 보존된 학습 runtime에도 같은 방어를 적용했습니다.

관련 검사와 증거는 `.tmp-ai-offset-recovery-20260922/`의 `dimension-audit.json`, `recovery-plan.json`, `recovery-result.json`, `guard-tests.log`, `pool-tests.log`, `restart-verification.json`을 참고합니다. 전체 작업 종료 후 운영 배포·재부팅의 승인된 순서는 유지하며, 이번 오류 복구를 배포 완료로 간주하지 않습니다.

05:04 KST 재확인: 방어/격리 테스트 13개 및 기존 워커 재사용·복구·시간 제한·설정 전달 테스트 17개, 총 30개 통과. controller 7668과 worker들이 보존 runtime에서 실행 중이며 대시보드 HTTP 200, running=true, stale=false, 오류 없음입니다. 새로 수집한 13경기의 2,080단계를 전부 검사해 stateDim 6022와 행동/추정 벡터 크기 일치를 확인했습니다. 현재 761세대용 372회차 13/32경기이며, 수정 후 전체 PPO 회차 완료는 이 시점에서 아직 확인 전입니다.

05:27 KST 후속 확인: 372·373회차의 전체 수집과 PPO 학습을 마치고 learner 762세대가 정상 저장됐습니다. 374회차는 763세대용 경기를 수집 중이며 running=true, stale=false, 오류 없음입니다. 따라서 이번 오류가 났던 학습 단계까지 실제로 통과했음을 확인했습니다. 챔피언은 714세대이며 이 복구를 실력 향상이나 승급으로 간주하지 않습니다. 증거는 `full-iteration-verification.json`에 저장했습니다.
