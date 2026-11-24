import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { SELF_PLAY_REPRESENTATION, assertSelfPlayRepresentation } from "../scripts/ai-training-representation.mjs";

test("worker contract rejects same-size reordered vocabularies as well as changed dimensions", () => {
  assert.doesNotThrow(() => assertSelfPlayRepresentation({...SELF_PLAY_REPRESENTATION}));
  for (const key of Object.keys(SELF_PLAY_REPRESENTATION)) {
    assert.throws(() => assertSelfPlayRepresentation({...SELF_PLAY_REPRESENTATION, [key]: null}),
      error => error.code === "AI_REPRESENTATION_MISMATCH");
  }
  assert.throws(() => assertSelfPlayRepresentation(undefined), /representation mismatch/);
});

test("real worker refuses a different controller layout before loading a model or accepting a game", {timeout: 30000}, async () => {
  const child=fork(new URL("../scripts/ai-selfplay-worker-process.mjs",import.meta.url),[], {
    windowsHide:true,execArgv:["--require","./scripts/tf-node-compat.cjs"],stdio:["ignore","ignore","ignore","ipc"]
  });
  try {
    const messagePromise=once(child,"message");
    child.send({type:"initialize",slotIndex:0,options:{representation:{...SELF_PLAY_REPRESENTATION,stateDim:SELF_PLAY_REPRESENTATION.stateDim-4},model:null}});
    const [message]=await messagePromise;
    assert.equal(message.type,"error");
    assert.match(message.error?.message ?? message.message ?? String(message.error),/representation mismatch/);
  } finally { child.kill(); }
});
