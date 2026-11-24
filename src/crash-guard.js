(function installRiftboundCrashGuard() {
  "use strict";

  const LOG_KEY = "riftbound.gameDiagnostic.v1";
  const ONLINE_KEY = "riftbound.onlineSeat.v1";
  const AUTH_KEY = "riftbound.accountSession.v1";
  const BUILD_INFO_TIMEOUT_MS = 5000;
  const ONLINE_STOP_TIMEOUT_MS = 15000;
  const BUG_REPORT_TIMEOUT_MS = 15000;
  const REDACTED = "[REDACTED]";
  let visible = false;
  let buildPromise = null;

  function boundedString(value, maxLength, fallback = "") {
    let text;
    try {
      text = String(value ?? fallback);
    } catch {
      text = fallback;
    }
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…[truncated]`;
  }

  function safeProperty(value, key, fallback = "") {
    try { return value?.[key] ?? fallback; } catch { return fallback; }
  }

  function plainRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function positiveGameNumber(value) {
    if (typeof value !== "number"
      && !(typeof value === "string" && /^[1-9][0-9]*$/u.test(value))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function diagnosticIdentity(value) {
    if (typeof value !== "string") return "";
    const identity = value.trim();
    return identity && identity.length <= 512 ? identity : "";
  }

  function recoveredLogMatchesOnlineSeat(log, seat) {
    if (!plainRecord(log) || !plainRecord(log.metadata) || !plainRecord(seat)) return false;
    if (log.metadata.mode !== "online") return false;
    const roomId = diagnosticIdentity(seat.roomId);
    if (!roomId || diagnosticIdentity(log.metadata.roomId) !== roomId) return false;

    const seatDiagnosticId = diagnosticIdentity(seat.diagnosticGameId);
    const logDiagnosticId = diagnosticIdentity(log.metadata.diagnosticGameId);
    const seatGameNumber = positiveGameNumber(seat.gameNumber);
    const logGameNumber = positiveGameNumber(log.metadata.gameNumber);
    return Boolean(seatDiagnosticId)
      && Boolean(logDiagnosticId)
      && seatDiagnosticId === logDiagnosticId
      && seatGameNumber !== null
      && logGameNumber !== null
      && seatGameNumber === logGameNumber;
  }

  function captureRecoveredOnlineStopOwner(log, seat) {
    if (!recoveredLogMatchesOnlineSeat(log, seat)) return null;
    const roomId = diagnosticIdentity(seat.roomId);
    const playerToken = diagnosticIdentity(seat.playerToken);
    const expectedDiagnosticGameId = diagnosticIdentity(seat.diagnosticGameId);
    const expectedGameNumber = positiveGameNumber(seat.gameNumber);
    if (!roomId || !playerToken || !expectedDiagnosticGameId || expectedGameNumber === null) return null;
    return Object.freeze({
      roomId,
      playerToken,
      expectedDiagnosticGameId,
      expectedGameNumber
    });
  }

  function onlineReportContext(log, seat) {
    if (!plainRecord(log?.metadata) || !plainRecord(seat)) return null;
    const playerToken = diagnosticIdentity(seat.playerToken);
    if (log.metadata.mode !== "online" || !playerToken) return null;
    const roomId = diagnosticIdentity(seat.roomId);
    if (!roomId || diagnosticIdentity(log.metadata.roomId) !== roomId) return null;
    const diagnosticGameId = diagnosticIdentity(log.metadata.diagnosticGameId);
    const gameNumber = positiveGameNumber(log.metadata.gameNumber);
    if (!diagnosticGameId && gameNumber === null) return null;
    return {
      roomId,
      playerToken,
      ...(gameNumber !== null ? { gameNumber } : {}),
      ...(diagnosticGameId ? { diagnosticGameId } : {})
    };
  }

  function sensitiveKey(key) {
    const normalized = boundedString(key, 512).toLowerCase().replace(/[^a-z0-9]/gu, "");
    if ([
      "token", "authorization", "proxyauthorization", "apikey",
      "privatekey", "cookie", "setcookie", "credential", "credentials", "jwt"
    ].includes(normalized)) return true;
    if (normalized.includes("password") || normalized.includes("passwd")
      || normalized.includes("passphrase") || normalized.includes("secret")) return true;
    return /^(?:access|refresh|auth|bearer|identity|id|session|csrf|xsrf|player|account|admin)token$/u.test(normalized)
      || /^(?:api|client|app|private)key$/u.test(normalized)
      || /^(?:proxy)?authorizationheader$/u.test(normalized)
      || /^(?:session|auth|account)?cookie$/u.test(normalized);
  }

  function redactSensitiveText(value) {
    let text;
    try { text = String(value ?? ""); } catch { text = ""; }
    return text
      .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu, REDACTED)
      .replace(/(\b(?:password|passwd|passphrase|authorization(?:[-_ ]?header)?|proxy[-_ ]?authorization(?:[-_ ]?header)?|token|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|identity[-_ ]?token|id[-_ ]?token|session[-_ ]?token|csrf[-_ ]?token|xsrf[-_ ]?token|player[-_ ]?token|account[-_ ]?token|admin[-_ ]?token|api[-_ ]?key|client[-_ ]?key|app[-_ ]?key|private[-_ ]?key|cookie|session[-_ ]?cookie|set[-_ ]?cookie|secret|credentials?|jwt)\b\s*["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?([^\s,;}\]"']+)/giu, `$1${REDACTED}`)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9!#$%&'*+\-.^_`|~:/=]+/giu, `$1 ${REDACTED}`)
      .replace(/([?&](?:token|access_token|refresh_token|auth_token|session_token|player_token|api_key|secret)=)[^&#\s]+/giu, `$1${REDACTED}`)
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, REDACTED);
  }

  function diagnosticText(value, maxLength, fallback = "") {
    return redactSensitiveText(boundedString(value, maxLength, fallback));
  }

  function scrubSensitiveData(root) {
    if (!root || typeof root !== "object") return root;
    const pending = [root];
    const seen = new WeakSet();
    while (pending.length) {
      const current = pending.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      for (const key of Object.keys(current)) {
        if (sensitiveKey(key)) {
          delete current[key];
          continue;
        }
        const item = current[key];
        if (typeof item === "string") current[key] = redactSensitiveText(item);
        else if (item && typeof item === "object") pending.push(item);
      }
    }
    return root;
  }

  function parseStored(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function errorDetail(error) {
    let nativeError = false;
    try { nativeError = error instanceof Error; } catch {}
    const objectLike = error !== null
      && (typeof error === "object" || typeof error === "function");
    const objectMessage = objectLike ? safeProperty(error, "message", "") : "";
    const objectStack = objectLike ? safeProperty(error, "stack", "") : "";
    if (nativeError || objectMessage || objectStack) return {
      name: diagnosticText(safeProperty(error, "name", "Error"), 200, "Error") || "Error",
      message: diagnosticText(objectMessage || "알 수 없는 오류", 8192, "알 수 없는 오류") || "알 수 없는 오류",
      stack: diagnosticText(objectStack, 32768, "")
    };
    return {
      name: "Error",
      message: diagnosticText(error || "알 수 없는 오류", 8192, "알 수 없는 오류"),
      stack: ""
    };
  }

  function finalizeStoredLog(error) {
    const log = scrubSensitiveData(parseStored(LOG_KEY));
    if (!log || typeof log !== "object" || Number(log.schemaVersion) !== 1) return null;
    const previousFinalization = plainRecord(log.finalization)
      ? log.finalization
      : null;
    const at = new Date().toISOString();
    const detail = errorDetail(error);
    log.ui = plainRecord(log.ui) ? log.ui : {};
    log.ui.errors = Array.isArray(log.ui.errors) ? log.ui.errors : [];
    log.ui.errors.push({
      sequence: log.ui.errors.length + 1,
      at,
      error: detail,
      context: { context: "bootstrap crash guard", appView: "unknown" },
      stateCheckpoint: log.latestState || log.initialState || null
    });
    log.ui.errors = log.ui.errors.slice(-25);
    log.updatedAt = at;
    if (!previousFinalization) {
      log.finalization = {
        reason: "ui-error",
        at,
        commandSequence: Number(log.lastCommandSequence)
          || (Array.isArray(log.commands)
            ? Number(log.commands.at(-1)?.sequence) || log.commands.length
            : 0),
        stateDigest: log.latestState?.digest || log.initialState?.digest || "",
        details: { bootstrapCrash: true }
      };
    }
    let persisted = false;
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
      persisted = true;
    } catch {}
    const finalization = log.finalization || {};
    const needsOnlineStop = !previousFinalization || (
      finalization.reason === "ui-error"
      && finalization.details?.serverStopConfirmed !== true
      && finalization.details?.stopRequestAccepted !== true
      && finalization.details?.locallyPreservedOnly !== true
      && (finalization.details?.bootstrapCrash === true
        || finalization.details?.recoveredAfterAppRestart === true)
    );
    return { log, needsOnlineStop, persisted };
  }

  async function buildInfo() {
    if (!buildPromise) {
      buildPromise = fetchJsonWithTimeout(
        "/build-info.json",
        { cache: "no-store" },
        BUILD_INFO_TIMEOUT_MS
      )
        .then(({ response, result }) => response.ok && plainRecord(result) ? result : {})
        .catch(() => ({}));
    }
    return buildPromise;
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    let timeout;
    const timeoutFailure = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`요청 시간이 ${Math.ceil(timeoutMs / 1000)}초를 초과했습니다.`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...options, signal: controller.signal });
          let result;
          try {
            result = await response.json();
          } catch {
            throw new Error(`서버 응답 JSON을 읽지 못했습니다. (HTTP ${Number(response.status) || 0})`);
          }
          return { response, result };
        })(),
        timeoutFailure
      ]);
    } catch (error) {
      if (timedOut) {
        throw new Error(`요청 시간이 ${Math.ceil(timeoutMs / 1000)}초를 초과했습니다.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function serverFailureMessage(result, response) {
    const fallback = `HTTP ${Number(response?.status) || 0}`;
    return diagnosticText(plainRecord(result) ? result.message : fallback, 1024, fallback)
      || fallback;
  }

  function validBugReportReceipt(result) {
    if (!plainRecord(result) || result.ok !== true) return false;
    const reportId = typeof result.reportId === "string" ? result.reportId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(reportId)) {
      return false;
    }
    if (typeof result.submittedAt !== "string" || !result.submittedAt) return false;
    const timestamp = new Date(result.submittedAt);
    return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === result.submittedAt;
  }

  async function stopRecoveredOnlineGame(owner) {
    if (!owner) throw new Error("현재 온라인 경기 식별자를 확인할 수 없습니다.");
    const build = await buildInfo();
    const baseUrl = String(build.multiplayerBaseUrl || build.updateBaseUrl || "").replace(/\/+$/u, "");
    const { response, result } = await fetchJsonWithTimeout(
      `${baseUrl}/api/rooms/${encodeURIComponent(owner.roomId)}/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerToken: owner.playerToken,
          command: {
            kind: "surrender",
            expectedDiagnosticGameId: owner.expectedDiagnosticGameId,
            expectedGameNumber: owner.expectedGameNumber
          }
        })
      },
      ONLINE_STOP_TIMEOUT_MS
    );
    if (!response.ok || !plainRecord(result) || result.ok !== true) {
      throw new Error(serverFailureMessage(result, response));
    }
    return result;
  }

  function show(error, force = false) {
    if ((!force && window.__riftboundUiErrorHandlerReady) || visible) return;
    visible = true;
    const recovery = finalizeStoredLog(error);
    const log = recovery?.log || null;
    const seat = parseStored(ONLINE_KEY);
    const hasOnlineSeat = Boolean(
      diagnosticIdentity(seat?.roomId) && diagnosticIdentity(seat?.playerToken)
    );
    const onlineStopOwner = captureRecoveredOnlineStopOwner(log, seat);
    const logMatchesOnlineSeat = Boolean(onlineStopOwner);
    const shouldRequestOnlineStop = Boolean(
      hasOnlineSeat
      && logMatchesOnlineSeat
      && recovery?.needsOnlineStop === true
    );
    const onlineStopIdentityUnavailable = Boolean(
      hasOnlineSeat
      && !logMatchesOnlineSeat
      && (!recovery || recovery.needsOnlineStop)
    );
    const reportOnlineContext = onlineReportContext(log, seat);

    const overlay = document.createElement("div");
    overlay.id = "riftbound-early-crash-guard";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:auto;padding:20px;background:#030814;color:#eef6ff;font-family:system-ui,sans-serif";
    overlay.innerHTML = `
      <section style="display:grid;gap:14px;width:min(680px,100%);border:1px solid #b94e58;border-radius:16px;padding:24px;background:#0b1421;box-shadow:0 24px 80px #000b">
        <strong style="color:#ff9b96">게임 화면 비상 중단</strong>
        <h1 data-crash-title style="margin:0;font-size:clamp(1.35rem,4vw,2rem)">${shouldRequestOnlineStop
          ? "서버에 경기 중단을 요청하고 있습니다"
          : onlineStopIdentityUnavailable
            ? "UI 초기화 오류를 감지했습니다"
            : "UI 초기화 오류로 게임을 중단했습니다"}</h1>
        <p data-crash-preservation-status style="margin:0;line-height:1.55">${recovery?.persisted === false
          ? "오류 정보를 로컬 저장소에 갱신하지 못했습니다. 앱을 다시 불러오기 전에 지금 로그를 전송해 주세요."
          : "마지막으로 저장된 경기 상태와 오류 정보를 보존했습니다."}</p>
        ${onlineStopIdentityUnavailable ? `
          <p data-crash-online-identity-warning style="margin:0;color:#ffcf70;line-height:1.55">저장된 로그가 현재 온라인 경기와 같은 경기인지 확인할 수 없어 서버에 자동 항복을 요청하지 않았습니다. 로그는 계속 전송할 수 있습니다.</p>
        ` : ""}
        <pre data-crash-detail style="max-height:120px;overflow:auto;white-space:pre-wrap;color:#b8c7d9"></pre>
        ${shouldRequestOnlineStop ? `
          <p data-crash-stop-status style="min-height:1.4em;margin:0;color:#b8c7d9" aria-live="polite">서버 응답을 기다리는 중…</p>
          <div data-crash-stop-actions hidden style="display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" data-crash-stop-retry>서버 중단 다시 시도</button>
            <button type="button" data-crash-preserve-local>서버 확인 없이 로그만 보존</button>
          </div>
        ` : ""}
        ${log ? `
          <label for="early-crash-description" style="font-weight:800">버그 설명 (필수)</label>
          <textarea id="early-crash-description" required minlength="10" maxlength="2000" placeholder="발생한 문제와 직전 행동을 10자 이상 자세히 입력해 주세요." style="box-sizing:border-box;width:100%;min-height:112px;border:1px solid #66809b;border-radius:8px;padding:10px;background:#020a12;color:#eef6ff;font:inherit"></textarea>
          <small>앞뒤 공백을 제외하고 최소 10자 이상 작성해야 전송할 수 있습니다. <output data-crash-count>0/10</output></small>
          <small>온라인 경기 보고에는 서버의 양쪽 플레이어 숨겨진 카드 정보가 포함될 수 있으며 서버 관리자만 조회할 수 있습니다.</small>
          <p data-crash-status style="min-height:1.4em;margin:0;color:#ffb0aa" aria-live="polite"></p>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" data-crash-decline ${shouldRequestOnlineStop ? "disabled" : ""}>전송하지 않음</button>
            <button type="button" data-crash-submit disabled>설명과 로그 전송</button>
          </div>
        ` : `<p style="margin:0;color:#ffb0aa">진행 중인 경기 로그가 없어 전송할 데이터는 없습니다.</p>`}
        <button type="button" data-crash-reload ${shouldRequestOnlineStop ? "disabled" : ""}>앱 다시 불러오기</button>
      </section>
    `;
    overlay.querySelector("[data-crash-detail]").textContent = errorDetail(error).message;
    document.body.appendChild(overlay);

    const description = overlay.querySelector("#early-crash-description");
    const submit = overlay.querySelector("[data-crash-submit]");
    const count = overlay.querySelector("[data-crash-count]");
    const status = overlay.querySelector("[data-crash-status]");
    const title = overlay.querySelector("[data-crash-title]");
    const stopStatus = overlay.querySelector("[data-crash-stop-status]");
    const stopActions = overlay.querySelector("[data-crash-stop-actions]");
    const retryStop = overlay.querySelector("[data-crash-stop-retry]");
    const preserveLocal = overlay.querySelector("[data-crash-preserve-local]");
    const decline = overlay.querySelector("[data-crash-decline]");
    const reload = overlay.querySelector("[data-crash-reload]");
    let reportUnlocked = !shouldRequestOnlineStop;
    let reportSubmitting = false;
    let reportResolved = false;
    let stopRequestPending = false;

    const syncReportControls = () => {
      const length = Array.from(description?.value?.trim?.() || "").length;
      if (count) count.textContent = `${length}/10`;
      if (description) description.disabled = reportSubmitting || reportResolved;
      if (submit) submit.disabled = !reportUnlocked || reportSubmitting
        || reportResolved || length < 10 || length > 2000;
      if (decline) decline.disabled = !reportUnlocked || reportSubmitting || reportResolved;
      if (reload) reload.disabled = !reportUnlocked || reportSubmitting;
    };

    const persistStopResolution = (details) => {
      if (!log?.finalization) return false;
      log.finalization.details = {
        ...(plainRecord(log.finalization.details) ? log.finalization.details : {}),
        ...details
      };
      log.updatedAt = new Date().toISOString();
      try {
        localStorage.setItem(LOG_KEY, JSON.stringify(log));
        return true;
      } catch {
        return false;
      }
    };

    const unlockReport = () => {
      reportUnlocked = true;
      syncReportControls();
    };

    const attemptOnlineStop = async () => {
      if (!shouldRequestOnlineStop || stopRequestPending || reportUnlocked) return;
      stopRequestPending = true;
      retryStop.disabled = true;
      preserveLocal.disabled = true;
      stopActions.hidden = true;
      title.textContent = "서버에 경기 중단을 요청하고 있습니다";
      stopStatus.style.color = "#b8c7d9";
      stopStatus.textContent = "서버 응답을 기다리는 중…";
      try {
        await stopRecoveredOnlineGame(onlineStopOwner);
        const resolutionPersisted = persistStopResolution({
          stopRequestAccepted: true,
          serverStopConfirmed: true
        });
        title.textContent = "UI 초기화 오류로 서버 경기를 중단했습니다";
        stopStatus.style.color = "#66d9a1";
        stopStatus.textContent = resolutionPersisted
          ? "서버가 항복 요청을 수락했습니다."
          : "서버는 항복 요청을 수락했지만 결과를 로컬 저장소에 갱신하지 못했습니다.";
        unlockReport();
      } catch (stopError) {
        title.textContent = "서버 경기 중단을 확인하지 못했습니다";
        stopStatus.style.color = "#ffb0aa";
        stopStatus.textContent = `다시 시도하거나 로그만 로컬에 보존해 주세요. (${errorDetail(stopError).message})`;
        stopActions.hidden = false;
        retryStop.disabled = false;
        preserveLocal.disabled = false;
      } finally {
        stopRequestPending = false;
      }
    };

    description?.addEventListener("input", () => {
      if (reportSubmitting || reportResolved) return;
      syncReportControls();
      status.textContent = "";
    });
    submit?.addEventListener("click", async () => {
      const value = description.value.trim();
      const valueLength = Array.from(value).length;
      if (!reportUnlocked || reportSubmitting || reportResolved
        || valueLength < 10 || valueLength > 2000) return;
      reportSubmitting = true;
      syncReportControls();
      status.style.color = "#b8c7d9";
      status.textContent = "로그를 전송하는 중입니다…";
      try {
        const build = await buildInfo();
        const reportBaseUrl = String(
          build.bugReportBaseUrl || build.multiplayerBaseUrl || build.updateBaseUrl || ""
        ).replace(/\/+$/u, "");
        const account = parseStored(AUTH_KEY);
        const payload = {
          schemaVersion: 1,
          description: value,
          descriptionCodePointLength: valueLength,
          metadata: { app: build, bootstrapCrash: true, client: { userAgent: navigator.userAgent } },
          log,
          ...(reportOnlineContext ? { onlineContext: reportOnlineContext } : {})
        };
        const { response, result } = await fetchJsonWithTimeout(
          `${reportBaseUrl}/api/bug-reports`,
          {
            method: "POST",
            headers: {
              ...(account?.token ? { authorization: `Bearer ${account.token}` } : {}),
              "content-type": "application/json"
            },
            body: JSON.stringify(payload)
          },
          BUG_REPORT_TIMEOUT_MS
        );
        if (!response.ok || !validBugReportReceipt(result)) {
          throw new Error(serverFailureMessage(result, response));
        }
        reportResolved = true;
        reportSubmitting = false;
        let localCopyRemoved = false;
        try {
          localStorage.removeItem(LOG_KEY);
          localCopyRemoved = true;
        } catch {}
        syncReportControls();
        status.style.color = "#66d9a1";
        status.textContent = `로그를 전송했습니다. 접수 ID: ${diagnosticText(result.reportId, 200, "-")}${localCopyRemoved
          ? ""
          : " (접수는 완료되었지만 로컬 사본을 삭제하지 못했습니다.)"}`;
      } catch (submitError) {
        reportSubmitting = false;
        syncReportControls();
        status.style.color = "#ffb0aa";
        status.textContent = `전송하지 못했습니다. 다시 시도해 주세요. (${errorDetail(submitError).message})`;
      } finally {
        if (!reportResolved && reportSubmitting) {
          reportSubmitting = false;
          syncReportControls();
        }
      }
    });
    decline?.addEventListener("click", () => {
      if (!reportUnlocked || reportSubmitting || reportResolved) return;
      try {
        localStorage.removeItem(LOG_KEY);
      } catch {
        status.style.color = "#ffb0aa";
        status.textContent = "로컬 로그를 삭제하지 못했습니다. 다시 시도해 주세요.";
        syncReportControls();
        return;
      }
      reportResolved = true;
      syncReportControls();
      status.style.color = "#b8c7d9";
      status.textContent = "이 경기의 로그를 전송하지 않습니다.";
    });
    retryStop?.addEventListener("click", () => void attemptOnlineStop());
    preserveLocal?.addEventListener("click", () => {
      if (stopRequestPending || reportUnlocked) return;
      const resolutionPersisted = persistStopResolution({
        stopRequestAccepted: false,
        serverStopConfirmed: false,
        locallyPreservedOnly: true
      });
      title.textContent = resolutionPersisted
        ? "서버 경기 중단 없이 로그만 보존했습니다"
        : "로그를 로컬 저장소에 갱신하지 못했습니다";
      stopStatus.style.color = "#ffcf70";
      stopStatus.textContent = resolutionPersisted
        ? "서버의 경기는 계속 진행 중일 수 있습니다."
        : "서버 경기는 계속 진행 중일 수 있습니다. 앱을 다시 불러오기 전에 지금 로그를 전송해 주세요.";
      stopActions.hidden = true;
      unlockReport();
    });
    reload.addEventListener("click", () => {
      if (reportUnlocked && !reportSubmitting) location.reload();
    });
    syncReportControls();
    if (shouldRequestOnlineStop) void attemptOnlineStop();
  }

  window.__riftboundEarlyCrashGuard = { show };
  window.addEventListener("error", (event) => show(event.error || event.message), true);
  window.addEventListener("unhandledrejection", (event) => show(event.reason));
})();
