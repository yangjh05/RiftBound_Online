let apiBaseUrl = "";
let bugReportBaseUrl = "";

export const DEFAULT_BUG_REPORT_SUBMIT_TIMEOUT_MS = 15_000;
export const MAX_REMOTE_ROOM_EVENT_BUFFER_LENGTH = 1024 * 1024;

export function configureOnlineServer(baseUrl = "") {
  apiBaseUrl = String(baseUrl).replace(/\/+$/u, "");
}

export function configureBugReportServer(baseUrl = "") {
  bugReportBaseUrl = String(baseUrl).replace(/\/+$/u, "");
}

export function configuredMultiplayerServer(build = {}) {
  return String(build.multiplayerBaseUrl || build.updateBaseUrl || "").replace(/\/+$/u, "");
}

export function configuredBugReportServer(build = {}) {
  return String(
    build.bugReportBaseUrl
    || build.multiplayerBaseUrl
    || build.updateBaseUrl
    || ""
  ).replace(/\/+$/u, "");
}

export async function fetchRooms(options = {}) {
  const response = await fetch(apiUrl("/api/rooms"), {
    signal: options.signal
  });
  return readResponse(response);
}

export async function signUpAccount(accountId, password) {
  const response = await postJson("/api/auth/signup", { accountId, password });
  return readResponse(response);
}

export async function loginAccount(accountId, password) {
  const response = await postJson("/api/auth/login", { accountId, password });
  return readResponse(response);
}

export async function fetchAccountSession(token) {
  const response = await fetch(apiUrl("/api/auth/session"), {
    cache: "no-store",
    headers: authorizationHeaders(token)
  });
  return readResponse(response);
}

export async function logoutAccount(token) {
  const response = await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    headers: authorizationHeaders(token)
  });
  return readResponse(response);
}

export async function saveAccountDeckStore(token, deckStore) {
  const response = await fetch(apiUrl("/api/account/decks"), {
    method: "PUT",
    headers: {
      ...authorizationHeaders(token),
      "content-type": "application/json"
    },
    body: JSON.stringify({ deckStore })
  });
  return readResponse(response);
}

export async function createOnlineRoom(options = {}) {
  const response = await postJson("/api/rooms", {
    sideboardingEnabled: options.sideboardingEnabled === true,
    poolId: options.poolId,
    banlistEnabled: options.banlistEnabled === true
  });
  return readResponse(response);
}

export async function joinOnlineRoom(roomId, playerToken = "") {
  const response = await postJson(`/api/rooms/${encodeURIComponent(roomId)}/join`, { playerToken });
  return readResponse(response);
}

export async function submitOnlineDeck(roomId, playerToken, deckRecord) {
  const response = await postJson(`/api/rooms/${encodeURIComponent(roomId)}/deck`, { playerToken, deckRecord });
  return readResponse(response);
}

export async function setOnlineReady(roomId, playerToken, ready = true) {
  const response = await postJson(`/api/rooms/${encodeURIComponent(roomId)}/ready`, { playerToken, ready });
  return readResponse(response);
}

export async function leaveOnlineRoom(roomId, playerToken) {
  const response = await postJson(`/api/rooms/${encodeURIComponent(roomId)}/leave`, { playerToken });
  return readResponse(response);
}

export async function sendOnlineCommand(roomId, playerToken, command) {
  const response = await postJson(`/api/rooms/${encodeURIComponent(roomId)}/commands`, {
    playerToken,
    command
  });
  return readResponse(response);
}

export async function persistAiReplay(replay) {
  const response = await postJson("/api/ai/replays", { replay });
  return readResponse(response);
}

export async function submitBugReport(report, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.floor(options.timeoutMs)
    : DEFAULT_BUG_REPORT_SUBMIT_TIMEOUT_MS;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(bugReportApiUrl("/api/bug-reports"), {
      method: "POST",
      headers: {
        ...authorizationHeaders(options.accountToken),
        "content-type": "application/json"
      },
      body: JSON.stringify(report),
      signal: controller.signal
    });
    return await readResponse(response);
  } catch (error) {
    if (timedOut) throw new Error("Bug report submission timed out.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAiTrainingStatus() {
  const response = await fetch(apiUrl("/api/ai/status"));
  return readResponse(response);
}

export async function fetchAiGenerations() {
  // Account restoration can change the multiplayer server while the catalog
  // request is pending. Models must stay on the server that supplied the list.
  const checkpointBaseUrl = apiBaseUrl;
  const response = await fetch(apiUrl("/api/ai/generations", checkpointBaseUrl));
  return { ...await readResponse(response), checkpointBaseUrl };
}

export async function fetchAiGenerationCheckpoint(generation, options = {}) {
  const response = await fetch(apiUrl(aiCheckpointRoute(generation,options), options.baseUrl), {
    cache: "no-store",
    signal: options.signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `AI generation request failed with ${response.status}.`);
  }
  return response.json();
}

export async function fetchAiGenerationCheckpointBuffer(generation, options = {}) {
  const response = await fetch(apiUrl(aiCheckpointRoute(generation,options), options.baseUrl), {
    cache: "no-store",
    signal: options.signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `AI generation request failed with ${response.status}.`);
  }
  return response.arrayBuffer();
}

function aiCheckpointRoute(generation,options){
 return options.modelId?`/api/ai/models/${encodeURIComponent(options.modelId)}/model`:`/api/ai/generations/${encodeURIComponent(generation)}/model`;
}

export async function fetchAiSpectatorReplays(limit = 40) {
  const response = await fetch(apiUrl(`/api/ai/selfplay-replays?limit=${encodeURIComponent(limit)}`));
  return readResponse(response);
}

export async function fetchAiSpectatorReplay(id) {
  const response = await fetch(apiUrl(`/api/ai/selfplay-replays/${encodeURIComponent(id)}`));
  return readResponse(response);
}

export function openRoomEvents(roomId, playerToken, handlers = {}) {
  if (apiBaseUrl) return openRemoteRoomEvents(roomId, playerToken, handlers);
  const NativeEventSource = EventSource;
  let source = new NativeEventSource(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(playerToken)}`));
  let activeHandlers = handlers;
  let interruptedTimer = null;
  let closed = false;
  handlers = null;

  const clearInterruptedTimer = () => {
    if (interruptedTimer === null) return;
    clearTimeout(interruptedTimer);
    interruptedTimer = null;
  };
  const onOpen = () => {
    if (closed) return;
    clearInterruptedTimer();
    activeHandlers?.open?.();
  };
  const onSnapshot = (event) => {
    if (closed) return;
    clearInterruptedTimer();
    activeHandlers?.snapshot?.(JSON.parse(event.data));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterruptedTimer();
    const activeSource = source;
    source = null;
    activeHandlers = null;
    activeSource?.removeEventListener("open", onOpen);
    activeSource?.removeEventListener("snapshot", onSnapshot);
    activeSource?.removeEventListener("server-error", onServerError);
    activeSource?.removeEventListener("error", onError);
    activeSource?.close();
  };
  const onServerError = (event) => {
    if (closed) return;
    const payload = JSON.parse(event.data || "{}");
    const handleError = activeHandlers?.error;
    close();
    handleError?.(payload.message || "Server connection failed.");
  };
  const onError = () => {
    if (closed || !source) return;
    if (source.readyState === NativeEventSource.CLOSED) {
      const handleError = activeHandlers?.error;
      close();
      handleError?.("Connection closed.");
      return;
    }
    if (interruptedTimer !== null) return;
    interruptedTimer = setTimeout(() => {
      interruptedTimer = null;
      if (closed) return;
      activeHandlers?.error?.("Connection interrupted. Reconnecting...");
    }, 3000);
  };

  source.addEventListener("open", onOpen);
  source.addEventListener("snapshot", onSnapshot);
  source.addEventListener("server-error", onServerError);
  source.addEventListener("error", onError);
  return { close };
}

function openRemoteRoomEvents(roomId, playerToken, handlers) {
  const controller = new AbortController();
  const readerCleanups = new WeakMap();
  let closed = false;
  let activeHandlers = handlers;
  let activeReader = null;
  handlers = null;
  const url = apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(playerToken)}`);

  const disposeReader = (reader) => {
    if (!reader || (typeof reader !== "object" && typeof reader !== "function")) {
      return Promise.resolve();
    }
    const existingCleanup = readerCleanups.get(reader);
    if (existingCleanup) return existingCleanup;
    const cleanup = (async () => {
      try {
        await reader.cancel?.();
      } catch {
        // Cancellation is best-effort; the lock still needs to be released.
      }
      try {
        reader.releaseLock?.();
      } catch {
        // A partially initialized or already released reader is safe to ignore.
      }
    })();
    readerCleanups.set(reader, cleanup);
    return cleanup;
  };

  (async () => {
    let retryDelay = 750;
    while (!closed) {
      try {
        const response = await fetch(url, {
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error(`Event stream failed with ${response.status}.`);
        const reader = response.body.getReader();
        activeReader = reader;
        try {
          if (closed) break;
          activeHandlers?.open?.();
          retryDelay = 750;
          const decoder = new TextDecoder();
          let buffer = "";
          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/u);
            buffer = blocks.pop() || "";
            for (const block of blocks) {
              if (closed) break;
              dispatchRemoteEventBlock(block, activeHandlers);
            }
            if (closed) break;
            if (buffer.length > MAX_REMOTE_ROOM_EVENT_BUFFER_LENGTH) {
              throw new Error(
                `Event stream buffer exceeded ${MAX_REMOTE_ROOM_EVENT_BUFFER_LENGTH} characters.`
              );
            }
          }
        } finally {
          if (activeReader === reader) activeReader = null;
          await disposeReader(reader);
        }
        if (!closed) activeHandlers?.error?.("Connection interrupted. Reconnecting...");
      } catch (error) {
        if (closed || error?.name === "AbortError") break;
        activeHandlers?.error?.(error.message || "Connection interrupted. Reconnecting...");
      }
      if (closed) break;
      await reconnectDelay(retryDelay, controller.signal);
      retryDelay = Math.min(5000, retryDelay * 2);
    }
  })();
  return {
    close() {
      if (closed) return;
      closed = true;
      activeHandlers = null;
      controller.abort();
      const reader = activeReader;
      activeReader = null;
      void disposeReader(reader);
    }
  };
}

function reconnectDelay(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function dispatchRemoteEventBlock(block, handlers) {
  let eventName = "message";
  const data = [];
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return;
  const payload = JSON.parse(data.join("\n"));
  if (eventName === "snapshot") handlers?.snapshot?.(payload);
  if (eventName === "server-error") handlers?.error?.(payload.message || "Server connection failed.");
}

function postJson(url, body) {
  return fetch(apiUrl(url), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function authorizationHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function apiUrl(path, baseUrl = apiBaseUrl) {
  return `${baseUrl}${path}`;
}

function bugReportApiUrl(path) {
  return `${bugReportBaseUrl}${path}`;
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({ ok: false, message: "Invalid server response." }));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `Request failed with ${response.status}.`);
    error.code = payload.code || "request_failed";
    error.status = response.status;
    throw error;
  }
  return payload;
}
