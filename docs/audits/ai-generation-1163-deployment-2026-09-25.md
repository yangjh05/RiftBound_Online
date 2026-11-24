# 1163세대 시험 대전 공개

사용자의 1163세대 서버 업로드 요청에 따라 2026-09-25 18:49 KST에 `https://punchfirst.site`의 AI 세대 선택 목록에 모델을 추가했습니다.

- 원본: `data/ai/retrain-run-c-20260905-051719/adaptive-policy-q-trigger-fix-20260925/iterations/000103/candidate.json.gz` 안의 `checkpoint`.
- 모델: 1163세대, 버전 6, 누적 학습 36,523경기. 당시 실행 상태의 `championPath`가 이 파일을 가리켰고 62번 승급 평가의 `passed`, `promoted: true`, 840경기 결과를 확인했습니다.
- 공개 파일: `/var/lib/riftbound-online/ai/candidates/generation-01163.json`.
- 공개 API: `/api/ai/generations/1163/model`.
- JSON 크기: 21,822,020바이트.
- SHA-256: `1f3443cc4e8e17ba04db1918f9793379ca47634a5d7849335290210c84c61624`.

학습 아카이브의 외부 포장만 제거하고 체크포인트 내용은 그대로 공개했습니다. 원본 메타데이터의 `promoted: false`도 바꾸지 않아 현재 서버 UI에서는 ‘후보’로 표시됩니다. 엔진 지문은 서버와 달라 기존 UI의 과거 엔진 표시가 유지됩니다. 서버와 같은 엔진에서 재검증한 모델로 재명명하지 않았습니다.

모델을 임시 위치로 전송하여 해시·세대·버전·구조를 검증한 뒤 새 파일을 원자적으로 추가했습니다. 기존 세대, 서버 코드, 계정 데이터, 학습 상태와 체크포인트는 수정하지 않았습니다. 서비스 PID `421207`이 그대로 유지되어 재시작이 없었음을 확인했습니다.

공개 전 브라우저에 모델 응답만 주입해 운영 코드의 로딩 및 준비 단계를 확인했습니다. 공개 후에는 응답 주입 없이 실제 HTTPS 카탈로그에서 1163세대를 선택하고 세트 AI 상대 대전을 시작했습니다. 모델 HTTP 200, 주사위·선후공 결정, 사이드보드, 챔피언 선택, 멀리건, 첫 행동 단계 진입을 통과했으며 브라우저 예외는 없었습니다. 공개 모델을 별도로 다운로드하여 위 해시와 일치함을 확인했고 `/health/ready`는 HTTP 200이었습니다. 전체 경기 종료나 운영 엔진에서의 성능 우위까지 검증한 것은 아닙니다.

증거: `.tmp-ai-generation-1163-20260925/manifest.json`, `publish.log`, `public-verification.json`, `production-browser.json`, `production-game.png`.
