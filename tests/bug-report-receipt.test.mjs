import assert from "node:assert/strict";
import test from "node:test";

import { validateBugReportSubmissionReceipt } from "../src/diagnostics/bug-report-receipt.mjs";

const VALID_RECEIPT = Object.freeze({
  ok: true,
  reportId: "11111111-1111-4111-8111-111111111111",
  submittedAt: "2026-09-02T00:00:00.000Z"
});

test("accepts only a complete canonical bug-report receipt", () => {
  assert.deepEqual(validateBugReportSubmissionReceipt(VALID_RECEIPT), {
    reportId: VALID_RECEIPT.reportId,
    submittedAt: VALID_RECEIPT.submittedAt
  });
});

test("rejects malformed success responses before the caller can discard its log", () => {
  const invalidReceipts = [
    null,
    [],
    "success",
    {},
    { ...VALID_RECEIPT, ok: false },
    { ...VALID_RECEIPT, ok: "true" },
    { ...VALID_RECEIPT, reportId: "" },
    { ...VALID_RECEIPT, reportId: "report-1" },
    { ...VALID_RECEIPT, reportId: 123 },
    { ...VALID_RECEIPT, submittedAt: "" },
    { ...VALID_RECEIPT, submittedAt: "not-a-date" },
    { ...VALID_RECEIPT, submittedAt: "2026-02-31T00:00:00.000Z" },
    { ...VALID_RECEIPT, submittedAt: "2026-09-02" },
    { ...VALID_RECEIPT, submittedAt: 123 }
  ];

  for (const receipt of invalidReceipts) {
    assert.throws(
      () => validateBugReportSubmissionReceipt(receipt),
      (error) => error?.code === "invalid_bug_report_receipt"
    );
  }
});
