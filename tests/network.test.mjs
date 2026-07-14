import test from "node:test";
import assert from "node:assert/strict";

import { handleMultiplayerRequest } from "../server/http-multiplayer.mjs";
import { configureOnlineServer, fetchRooms } from "../src/net/client.mjs";

test("remote multiplayer room checks use the configured ngrok server", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true, rooms: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    configureOnlineServer("https://backboard-fender-basis.ngrok-free.dev/");
    const result = await fetchRooms();
    assert.deepEqual(result.rooms, []);
    assert.equal(request.url, "https://backboard-fender-basis.ngrok-free.dev/api/rooms");
    assert.equal(request.options.headers["ngrok-skip-browser-warning"], "true");
  } finally {
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("multiplayer API preflight enables cross-origin app clients", async () => {
  let status = null;
  let headers = null;
  let ended = false;
  const response = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end() {
      ended = true;
    }
  };

  assert.equal(await handleMultiplayerRequest({ method: "OPTIONS", url: "/api/rooms" }, response), true);
  assert.equal(status, 204);
  assert.equal(headers["access-control-allow-origin"], "*");
  assert.match(headers["access-control-allow-headers"], /ngrok-skip-browser-warning/);
  assert.equal(ended, true);
});
