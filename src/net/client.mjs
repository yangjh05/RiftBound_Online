let apiBaseUrl = "";

export function configureOnlineServer(baseUrl = "") {
  apiBaseUrl = String(baseUrl).replace(/\/+$/u, "");
}

export async function fetchRooms(options = {}) {
  const response = await fetch(apiUrl("/api/rooms"), {
    signal: options.signal,
    headers: apiBaseUrl ? { "ngrok-skip-browser-warning": "true" } : undefined
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
  const response = await fetch(apiUrl("/api/ai/status"), {
    headers: apiBaseUrl ? { "ngrok-skip-browser-warning": "true" } : undefined
  });
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
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "ngrok-skip-browser-warning": "true" }
      });
      if (!response.ok || !response.body) throw new Error(`Event stream failed with ${response.status}.`);
      handlers.open?.();
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
      if (!closed) handlers.error?.("Connection closed.");
    } catch (error) {
      if (!closed && error?.name !== "AbortError") handlers.error?.(error.message || "Connection interrupted.");
    }
  })();
  return { close: () => { closed = true; controller.abort(); } };
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
      "content-type": "application/json",
      ...(apiBaseUrl ? { "ngrok-skip-browser-warning": "true" } : {})
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
