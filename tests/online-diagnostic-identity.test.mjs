import assert from "node:assert/strict";
import test from "node:test";

import {
  captureOnlineDiagnosticIdentity,
  onlineDiagnosticIdentityMatchesDescriptor
} from "../src/diagnostics/online-diagnostic-identity.mjs";

test("online emergency identity requires an exact diagnostic id and game number", () => {
  const identity = {
    roomId: "ABCD",
    ...captureOnlineDiagnosticIdentity({
      roomId: "ABCD",
      diagnosticKey: "diagnostic:ABCD:7",
      metadata: {
        mode: "online",
        roomId: "ABCD",
        gameNumber: 2,
        diagnosticGameId: "ABCD:7"
      }
    })
  };
  assert.equal(identity.diagnosticIdentityCaptured, true);
  assert.equal(onlineDiagnosticIdentityMatchesDescriptor(identity, {
    key: "diagnostic:ABCD:7",
    roomId: "ABCD",
    gameNumber: 2,
    diagnosticGameId: "ABCD:7"
  }), true);
  assert.equal(onlineDiagnosticIdentityMatchesDescriptor(identity, {
    key: "diagnostic:ABCD:8",
    roomId: "ABCD",
    gameNumber: 3,
    diagnosticGameId: "ABCD:8"
  }), false);
});

test("game-number fallback is exact and rejects a newly identified game", () => {
  const identity = {
    roomId: "WXYZ",
    ...captureOnlineDiagnosticIdentity({
      roomId: "WXYZ",
      diagnosticKey: "WXYZ:game:4",
      metadata: { mode: "online", roomId: "WXYZ", gameNumber: 4 }
    })
  };
  assert.equal(identity.diagnosticIdentityCaptured, true);
  assert.equal(onlineDiagnosticIdentityMatchesDescriptor(identity, {
    key: "WXYZ:game:4",
    roomId: "WXYZ",
    gameNumber: 4,
    diagnosticGameId: ""
  }), true);
  assert.equal(onlineDiagnosticIdentityMatchesDescriptor(identity, {
    key: "diagnostic:WXYZ:12",
    roomId: "WXYZ",
    gameNumber: 4,
    diagnosticGameId: "WXYZ:12"
  }), false);
});

test("lobby and inconsistent recorder metadata fail closed", () => {
  for (const identity of [
    captureOnlineDiagnosticIdentity({
      roomId: "ABCD",
      diagnosticKey: "",
      metadata: { mode: "online" }
    }),
    captureOnlineDiagnosticIdentity({
      roomId: "ABCD",
      diagnosticKey: "diagnostic:ABCD:1",
      metadata: { mode: "online", roomId: "OTHER", gameNumber: 1, diagnosticGameId: "ABCD:1" }
    }),
    captureOnlineDiagnosticIdentity({
      roomId: "ABCD",
      diagnosticKey: "ABCD:game:2",
      metadata: { mode: "online", roomId: "ABCD", gameNumber: 1 }
    })
  ]) {
    assert.equal(identity.diagnosticIdentityCaptured, false);
    assert.equal(onlineDiagnosticIdentityMatchesDescriptor({ roomId: "ABCD", ...identity }, {
      key: "diagnostic:ABCD:1",
      roomId: "ABCD",
      gameNumber: 1,
      diagnosticGameId: "ABCD:1"
    }), false);
  }
});
