import test from "node:test";
import assert from "node:assert/strict";

import { commandFailureFeedback } from "../src/ui/command-feedback.mjs";

test("엔진 거부 사유를 행동 없음 대신 구체적인 한국어 사유로 분류한다", () => {
  assert.equal(
    commandFailureFeedback("That activated ability's use condition is not met.", "ko").code,
    "condition-unmet"
  );
  assert.equal(
    commandFailureFeedback("Only Reaction abilities can be used on an existing chain.", "ko").code,
    "wrong-timing"
  );
  assert.equal(
    commandFailureFeedback("Finish the current choice first.", "ko").code,
    "pending-step"
  );
  assert.equal(
    commandFailureFeedback("This effect has no legal target.", "ko").code,
    "no-legal-target"
  );
  assert.equal(
    commandFailureFeedback("Udyr has no buff to spend.", "ko").code,
    "insufficient-cost"
  );
});

test("알 수 없는 엔진 사유도 원문을 보존하고 상태 변화가 없음을 표시한다", () => {
  const feedback = commandFailureFeedback("A future engine rejection.", "ko");
  assert.equal(feedback.code, "engine-rejected");
  assert.equal(feedback.engineMessage, "A future engine rejection.");
  assert.match(feedback.title, /거부/);
});
