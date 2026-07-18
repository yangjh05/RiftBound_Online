let apiBaseUrl = "";

export function configureOnlineServer(baseUrl = "") {
  apiBaseUrl = String(baseUrl).replace(/\/+$/u, "");
}

export function configuredMultiplayerServer(build = {}) {
  return String(build.multiplayerBaseUrl || build.updateBaseUrl || "").replace(/\/+$/u, "");
}

export async function fetchRooms(options = {}) {
  const response = await fetch(apiUrl("/api/rooms"), {
    signal: options.signal
  });
  return readResponse(response);
}

export async function createOnlineRoom(options = {}) {
  const response = await postJson("/api/rooms", { sideboardingEnabled: options.sideboardingEnabled === true });
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

export async function fetchAiTrainingStatus() {
  const response = await fetch(apiUrl("/api/ai/status"));
  return readResponse(response);
}

export function openRoomEvents(roomId, playerToken, handlers = {}) {
  if (apiBaseUrl) return openRemoteRoomEvents(roomId, playerToken, handlers);
  const source = new EventSource(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(playerToken)}`));
  let interruptedTimer = null;
  source.addEventListener("open", () => {
    if (interruptedTimer) clearTimeout(interruptedTimer);
    interruptedTimer = null;
    handlers.open?.();
  });
  source.addEventListener("snapshot", (event) => {
    if (interruptedTimer) clearTimeout(interruptedTimer);
    interruptedTimer = null;
    handlers.snapshot?.(JSON.parse(event.data));
  });
  source.addEventListener("server-error", (event) => {
    const payload = JSON.parse(event.data || "{}");
    if (interruptedTimer) clearTimeout(interruptedTimer);
    interruptedTimer = null;
    source.close();
    handlers.error?.(payload.message || "Server connection failed.");
  });
  source.addEventListener("error", () => {
    if (source.readyState === EventSource.CLOSED) {
      handlers.error?.("Connection closed.");
      return;
    }
    if (interruptedTimer) return;
    interruptedTimer = setTimeout(() => {
      handlers.error?.("Connection interrupted. Reconnecting...");
    }, 3000);
  });
  return source;
}

function openRemoteRoomEvents(roomId, playerToken, handlers) {
  const controller = new AbortController();
  let closed = false;
  const url = apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/events?token=${encodeURIComponent(playerToken)}`);
  (async () => {
    let retryDelay = 750;
    while (!closed) {
      try {
        const response = await fetch(url, {
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error(`Event stream failed with ${response.status}.`);
        handlers.open?.();
        retryDelay = 750;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/u);
          buffer = blocks.pop() || "";
          for (const block of blocks) dispatchRemoteEventBlock(block, handlers);
        }
        if (!closed) handlers.error?.("Connection interrupted. Reconnecting...");
      } catch (error) {
        if (closed || error?.name === "AbortError") break;
        handlers.error?.(error.message || "Connection interrupted. Reconnecting...");
      }
      if (closed) break;
      await reconnectDelay(retryDelay, controller.signal);
      retryDelay = Math.min(5000, retryDelay * 2);
    }
  })();
  return { close: () => { closed = true; controller.abort(); } };
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
  if (eventName === "snapshot") handlers.snapshot?.(payload);
  if (eventName === "server-error") handlers.error?.(payload.message || "Server connection failed.");
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

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({ ok: false, message: "Invalid server response." }));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `Request failed with ${response.status}.`);
  }
  return payload;
}
