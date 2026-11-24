# 2026-09-22 학습 중단 원인과 복구

## 확인된 시스템 충돌

최근 두 번의 중단은 Windows 시스템 충돌입니다. 2026-09-21 06:19:49와 14:47:05(KST)에 기록된 System / WER-SystemErrorReporting 이벤트 1001 모두 버그 검사 `0x135`와 예외 `0xc0000005`를 보고했습니다. Application / Windows Error Reporting의 두 충돌 보고서도 동일한 버킷 `AV_TKRgFtXp64!unknown_function`을 지목합니다.

사용자가 복사한 `092126-17000-01.dmp`를 Microsoft WinDbg/CDB로 분석했습니다. 실제 충돌 시각은 2026-09-21 14:46:19.214(KST)입니다.

- 버그 검사: `REGISTRY_FILTER_DRIVER_EXCEPTION (135)`
- 드라이버 콜백 주소: `fffff8054ecd01d0`
- 해당 주소의 모듈 범위: `fffff8054ec90000`–`fffff8054ece6000`, `TKRgFtXp64.sys`
- 예외 발생 스택: `TKRgFtXp64+0x3fd3a`
- 실패 버킷: `AV_TKRgFtXp64!unknown_function`
- 당시 프로세스 문맥: `git.exe` (프로세스 문맥 자체가 Git 결함이라는 뜻은 아닙니다.)

현재 설치된 파일 `C:\Windows\System32\TKRgFtXp64.sys`의 제조사는 `INCA Internet Co., Ltd.`, 설명은 `Tachyon Registry Filter Driver(XP Later)`, 버전은 `2025, 10, 17, 1`입니다. `TKRgFt` 드라이버가 실행 중이며, 같은 제조사의 `nProtect Online Security V1.0(PFS)`와 `nossvc` 서비스도 설치되어 실행 중입니다. 충돌한 커널 드라이버는 특정했지만 그 내부 결함의 상세 조건이나 수정 버전은 확인하지 않았습니다. 보안 제품/드라이버를 임의로 제거하거나 비활성화하지 않았습니다.

Microsoft의 [0x135 설명](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-0x135--registry-filter-driver-exception)은 레지스트리 필터 드라이버의 처리되지 않은 예외를 의미하며 세 번째 인자로 원인 드라이버를 식별하도록 안내합니다. 이번 덤프의 주소, 스택, Windows 보고서가 일치합니다. 이 결론은 최근 두 충돌에 대한 것이며, 이전 전원/절전 중단 전체를 같은 원인으로 단정하지 않습니다.

## 데이터 검사 및 학습 재개

대상 실행: `adaptive-policy-q-movement-targets-20260917`.

- 완료 반복 369, 저장된 학습 모델 758세대, 챔피언 714세대.
- 다음 반복 370의 기존 자가대전 13경기와 평가 42의 기존 99경기를 검사했습니다. 평가 후보는 757세대, 상대는 714세대입니다.
- 설정, 상태, 모델, 다음 계획, 경기 등 120개 JSON/압축 자료를 정상적으로 읽었습니다. 원본 해시와 검사 결과를 남겼습니다.
- 현재 엔진 지문 `sha256:01cd750c5f8aa74a7f7abb54bff76bec4a0358436eb25017491197b580dd635c`를 유지합니다.
- 제어 프로세스 PID 24608에서 재개했습니다. 저장된 우선순위 `above-normal`, 최대 16개 연산 프로세스 및 메모리 기반 배분 설정을 유지했습니다.
- 재개 후 자가대전 13→23경기, 평가 99→159경기까지 증가한 것을 확인했습니다. 이후 수치는 계속 변합니다.

`stderr.log`의 ENOSPC는 9월 18일 기록이므로 이번 충돌의 원인으로 해석하지 않았습니다. 이번에는 운영체제 충돌이 학습/대시보드를 함께 종료시켰습니다.

## 대시보드 복구

충돌 시 `status.json`이 10,493바이트 모두 NUL인 파일로 남았고, `status.json.gz`도 손상됐습니다. 둘을 복사 보존했으며 학습 재개 후 정상 상태 파일이 새로 기록됐습니다. 학습 상태와 모델 압축 파일은 정상입니다.

`events.jsonl`의 29174번째 줄에는 NUL 6,987개가 포함된 손상이 있었습니다. 대시보드의 JSON 파싱이 이 줄에서 실패하면서 `/api/state`가 HTTP 500을 반환했습니다. 원본을 수정하지 않고 손상된 완료 줄을 건너뛰며 누락을 화면에 알리도록 읽기 처리를 수정했습니다. 이후 정상 줄은 같은 읽기에서도 처리하고, 새로고침 간 누락 수를 유지하며, 파일 교체/축소 시 초기화합니다.

검증:

- `node --test tests/training-dashboard.test.mjs tests/training-dashboard-forecast.test.mjs`: 13개 통과.
- NUL/깨진 JSON/비객체 줄 뒤 정상 이벤트 처리, 경고 유지, 로그 축소 시 초기화, 원본 불변 및 평가 집계 유지 확인.
- `http://127.0.0.1:4180/api/state`: HTTP 200, `running: true`.
- 실제 브라우저에서 759세대 진행/저장 758세대/챔피언 714세대, 실시간 연결, 우선순위 및 누락 안내 표시. JavaScript 오류 없음.

## 증거 위치와 남은 조치

`.tmp-ai-crash-diagnosis-20260922/`에 `bugchecks.json`, `wer-driver-buckets.json`, `windbg-offline-analysis.txt`, `preflight.json`, 손상 상태 백업, `dashboard-smoke.json`, `dashboard.png`를 보관했습니다. 진단용 대용량 다운로드 압축 파일은 삭제했고 덤프/분석 결과는 보존했습니다.

학습과 대시보드는 복구됐지만 커널 드라이버 결함은 수정되지 않았습니다. 재발 방지를 위해 INCA Internet에 드라이버 버전, `0x135`, 실패 버킷 및 덤프 분석을 전달해 수정 버전을 확인해야 합니다. 재시작만으로 원인이 해결됐다고 판단하면 안 됩니다.

## 후속 복구 설치 시도

사용자의 수정 요청에 따라 [nProtect 공식 기술지원센터](https://15660808.co.kr/index.html)가 연결한 `https://update.nprotect.net/cs/nos/setup/nos_setup.exe`를 받아 INCA 서명이 유효함을 확인한 뒤 실행했습니다. 설치 파일 버전은 `2026.1.7.1`, SHA-256은 `f9239488a6be8648f08869c79975a0a569e0a9fd87ac283d1ee3f3504e578570`입니다. 시스템 관리자 확인은 사용자에게 요청했습니다.

학습 상태와 759세대 모델, 714세대 챔피언을 `.tmp-ai-driver-repair-20260922/`에 별도로 복사하고 압축 JSON 정상 읽기를 확인했습니다. 복구 설치 이후 기존 드라이버가 `TKRgFtXp64_9C70.sys`로 남아 재부팅 시 삭제 예정이며, 새 `TKRgFtXp64.sys`와 두 파일의 SHA-256이 모두 `4b3ba96a34e9bc691f6f7632e3370c0fe2df0d927bfe529319bf82a9d797c472`로 같습니다. 버전도 동일한 `2025, 10, 17, 1`이어서 결함 수정 버전이 적용됐다고 판단하지 않습니다.

Windows Defender의 서비스, 백신 및 실시간 보호가 활성화된 것을 확인했습니다. 원인 드라이버를 포함하는 nProtect 제품을 공식 제거기로 제거하는 선택지를 사용자에게 제시했습니다. 보안 제품 자체 제거는 사용자 확인 후 진행하며, 현재 결과만으로 재발 방지가 완료됐다고 주장하지 않습니다.

## 사용자 승인 후 공식 제거

사용자가 `nProtect 제거 (권장)`을 선택했습니다. 서명이 유효한 INCA 공식 `nProtectUninstaller.exe`를 실행했고, 2026-09-22 04:21(KST)에 다음 결과를 확인했습니다.

- nProtect Online Security의 설치 프로그램 등록이 사라졌습니다.
- `TKRgFt`는 `Win32_SystemDriver` 및 `driverquery` 목록에서 제외됐지만, 이후 `sc.exe query TKRgFt` 직접 조회에서는 여전히 `RUNNING`이었습니다. 목록 부재만으로 커널에서 내려갔다고 판단하면 안 됩니다. `nossvc`는 직접 조회에서도 서비스 없음(1060)을 확인했습니다.
- 원래의 `C:\Windows\System32\TKRgFtXp64.sys` 파일이 제거됐습니다.
- 복구 설치 때 이름이 변경된 `TKRgFtXp64_9C70.sys`와 일부 제품 폴더/로그는 공식 제거기가 다음 재부팅 시 정리하도록 예약했습니다. 잔여 레지스트리 키도 보이므로 완전한 정리는 재부팅 후 확인해야 합니다. 이 파일이나 레지스트리를 임의로 삭제하지 않았습니다.
- Windows Defender의 서비스, 백신, 실시간 보호는 모두 활성 상태입니다.
- 학습 제어 프로세스와 대시보드는 계속 실행 중입니다. 자동 재부팅을 실행하지 않았습니다.

사용자가 승인한 nProtect 제거의 후속 조치로 관리자 권한의 Windows `sc.exe stop TKRgFt`를 실행했으나, 직접 재조회 결과 `RUNNING / NOT_STOPPABLE`로 남았습니다. 따라서 원인 프로그램 제거는 끝났지만 메모리에 남은 커널 드라이버까지 제거하려면 재부팅이 필요합니다. 사용자에게 재부팅 시점을 확인 중이며 임의로 재부팅하지 않았습니다.

장시간 재발 여부까지 확인한 것은 아니며, 같은 버전의 nProtect를 다시 설치하면 원인 드라이버가 재도입될 수 있습니다. 공식 제거 결과와 학습 확인은 `.tmp-ai-driver-repair-20260922/after-uninstall.json`, `training-verification.json`에 보관했습니다. `after-uninstall.json`의 일반 목록 결과는 위 직접 조회 결과와 함께 해석해야 합니다.

## 운영 배포 후 재부팅·자동 재개 준비

사용자가 모든 GPT 작업이 끝나면 실제 운영서버 배포까지 완료한 뒤 재부팅하고 학습을 자동 재개하도록 승인했습니다. 2026-09-22 04:54 KST 현재 카드 번역 작업이 실행 중이며 최종 통합 배포와 재부팅은 아직 하지 않았습니다. 이 대화의 5분 간격 heartbeat가 작업 완료 여부와 후속 절차를 확인하도록 등록됐습니다. 조건과 수행 결과는 `.tmp-ai-reboot-deploy-20260922/HANDOFF.md`, `reboot-request.json`에 기록합니다. 아직 `phase: preparing`, `productionVerified: false`입니다.

Windows 작업 `Riftbound AI Resume After Verified Reboot 20260922`를 기존 USER의 제한된 권한과 S4U 방식으로 등록했습니다. 부팅 45초 후 실행하며 사용자 로그인이나 암호 저장은 필요 없습니다. 실제 작업 스케줄러 컨텍스트에서 저장 모델 읽기, 학습 코드 지문, 입력 크기, 네이티브 TensorFlow 행렬 계산을 검증했고 LastTaskResult=0을 확인했습니다. `startup-install-result.json` 및 `scheduled-preflight.json`이 증거입니다. 실제 재부팅 후 실행 결과는 아직 확인 전입니다.

다른 작업에서 아리의 새 일러스트 카드가 추가되어 AI 입력 크기가 변하는 것을 확인했습니다. 이전 학습을 새 카드 등록 구조와 섞지 않도록 학습 실행 코드를 별도 보존했습니다. 과거 기록과 SHA-256이 정확히 일치하는 파일만 복원했으며 전체 466개 학습 지문 파일의 raw digest가 기존 검증본 `sha256:a807369ec7f3087b885827212391c50549890536bf19ee099186604bf5b0e55a`와 정확히 일치합니다. 지문 검사를 우회하거나 기존 자료를 새 엔진 자료로 바꾸지 않았습니다. 최신 게임 코드와 번역은 원래 작업폴더에 유지됩니다.

자동 재개는 원래 run, 모델 및 평가 파일을 그대로 사용하고 최대 16 워커와 저장된 우선순위를 유지합니다. 760세대와 챔피언 714세대의 입력 크기(stateDim 6022, actionDim 521)와 카드 어휘까지 일치함을 확인했습니다. 운영 검증이 완료되어 재부팅 요청이 armed로 바뀌고 실제 부팅 시각이 달라진 경우에만 자동 실행합니다. 배포 검증, 안전한 학습 저장·중단, 재부팅 뒤 실제 경기 진행 및 TKRgFt/Defender 확인은 후속 절차로 남아 있습니다.
