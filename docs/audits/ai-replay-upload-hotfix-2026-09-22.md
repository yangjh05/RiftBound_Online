# AI 리플레이 업로드 한도 수정 — 2026-09-22

## 원인과 변경

- 카이사 미러매치 보고서 `65042301-334b-4a63-bdd2-6152b55a9cfb`에 경기 종료 직후 `AI replay persistence: Request body is too large.`가 기록됐습니다.
- `storeAiReplay`는 리플레이 JSON 8 MiB까지 허용했지만 `/api/ai/replays`는 일반 HTTP 요청의 1 MiB 한도로 읽었습니다.
- 저장 한도를 서버 모듈에서 공유하고 해당 경로만 8 MiB + JSON 포장 여유 1 KiB로 읽도록 수정했습니다. 저장 대상 리플레이 자체는 여전히 8 MiB로 제한합니다.
- 요청/저장 크기 초과 시 500 대신 413과 명시적 오류 코드를 반환합니다. 일반 멀티플레이 요청의 1 MiB 한도와 nginx의 16 MiB 한도는 변경하지 않았습니다.
- 리플레이의 학습 표본이나 명령을 잘라내지 않습니다. 8 MiB를 넘는 리플레이의 압축/분할 업로드는 이번 수정 범위에 포함하지 않았습니다.

## 검증

- 새 HTTP 통합 테스트 5개: 1 MiB 초과 표본의 원본 그대로 저장, 정확히 8 MiB인 리플레이 수신, 저장 한도 1바이트 초과, 스트리밍 요청 초과, 일반 요청 한도 유지.
- 네트워크·덱 규칙·보안 헤더·버그 보고·리플레이 워커·자원 수명·UI 성능 회귀를 포함한 64개 테스트 통과.
- 테스트 명령: `node --require ./scripts/tf-node-compat.cjs --test --test-concurrency=1 tests/ai-replay-http.test.mjs tests/network.test.mjs tests/deck-legality.test.mjs tests/http-security.test.mjs tests/bug-report-http.test.mjs tests/bug-report-receipt.test.mjs tests/resource-lifecycle.test.mjs tests/ui-performance-regression.test.mjs tests/ai-replay-worker.test.mjs`
- 초기 실행의 TensorFlow 관련 테스트는 Node 24에서 제거된 util API 때문에 실패했습니다. 프로젝트의 기존 호환성 preload를 적용한 위 명령으로 전체 재실행하여 통과했으며, TensorFlow나 모델 코드를 변경하지 않았습니다.

## AWS 배포

- 사용자 승인 후 `/opt/riftbound-online/server/ai-data.mjs`, `server/http-multiplayer.mjs` 두 파일만 반영했습니다.
- 배포 전 운영 파일과 로컬 파일을 비교해 이번 변경 외의 차이가 없음을 확인했습니다. 열린 멀티플레이 방은 0개였습니다.
- 첫 배포는 스크립트 끝의 Windows 줄바꿈 문제로 안전 복구가 작동했습니다. 원본 복구와 서비스 정상 상태를 확인하고 종료 처리를 수정해 재배포했습니다.
- 최종 웹 서버 시작 시각: `2026-09-22T03:51:38.726Z` (12:51:38 KST).
- 원본 백업: `/var/backups/riftbound-online/replay-http-20260922T035200Z`.
- 최종 파일 SHA-256:
  - ai-data: `432f88e0bcd370196740ab1c6e92c58e8ec3aa2022c534175e0e3fdd3c60eeef`
  - http-multiplayer: `b97c354c40d3e01464c887707139b62bbc53224a515c406e7354e497a92ca039`
- 공개 HTTPS 경로에 1,228,981바이트 요청을 보내 HTTP 200 및 디스크 저장 내용 일치를 확인했습니다. 학습 대상이 아닌 검증용 리플레이는 곧바로 삭제했습니다.
- 한도를 넘는 요청의 HTTP 413 및 공개 `/health`의 HTTP 200을 확인했습니다.

## AI 학습 보완 검토 — 아직 구현하지 않음

현재 `src/app.mjs`의 코칭 큐는 사용자 행동만 기록하며, `src/ai/human-data.mjs`도 사용자 행동 중 고신뢰 rollout 표본만 학습 궤적으로 변환합니다. `scripts/train-neural-ai.mjs`에는 이 코칭 자료를 읽는 경로가 있지만, 현재 `train:adaptive` 진입점인 `scripts/train-adaptive-policy-q.mjs`에는 버그 보고서/이 사용자 코칭 리플레이를 직접 가져오는 경로가 없습니다. 따라서 실전 로그가 저장됐다는 사실만으로 이번 AI의 실수가 자동 교정되지는 않습니다.

점수 경쟁(`score-race.mjs`), 반응 자원 표현(`neural/encoding.mjs`), 전투 통과 대안 비교(`combat-safety.mjs`, `neural/selfplay.mjs`), 여러 행동을 잇는 공개 턴 탐색(`turn-planner.mjs`)은 이미 존재합니다. 같은 기능을 중복 추가하기보다는 다음 연결과 검증을 우선하는 것이 타당합니다.

1. 동의하여 제출된 실전 로그에서 AI의 의사결정 직전 상태를 재현하고, 해당 엔진/모델 식별 정보와 함께 별도 학습 후보로 가져옵니다. 후보는 공개 정보와 자신의 손만 관측하고 상대 비공개 카드는 유출하지 않아야 합니다.
2. 이번 실패 유형을 기존 대안 비교 대상으로 우선 배정합니다: 상대 주문 이후 통과 대 대응, 점거 유닛 제거 대 전투로 처리 가능한 유닛 제거, 대형 유닛 단독 전개 대 다단계 정복, 추가 드로우 대 다음 턴 반응 자원.
3. 상대 무대응 재생 결과를 곧바로 정답으로 사용하지 않습니다. 같은 숨은 정보 샘플과 난수 조건에서 상대 대응·실제 비용·턴 종료 후 점거까지 비교한 근거로만 교정합니다. 자원이 없어 통과가 강제되는 반례도 포함합니다.
4. 학습용 변형 국면과 독립 평가 국면을 분리합니다. 전체 승률뿐 아니라 각 실패 유형의 재발률을 측정하고 다른 덱/상대 대응에서도 개선된 후보만 배포합니다. 특정 카드 이름의 예외 분기로 통과를 금지하는 방식은 피합니다.

이번 배포는 업로드 오류 수정만 포함합니다. AI 가중치, 학습 설정, 진행 중인 학습 작업과 경기 규칙은 변경하지 않았습니다.
