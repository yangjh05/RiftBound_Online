const BUG_REPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validateBugReportSubmissionReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.ok !== true) throw invalidReceipt();

  const reportId = typeof value.reportId === "string" ? value.reportId.trim() : "";
  const submittedAt = typeof value.submittedAt === "string" ? value.submittedAt.trim() : "";
  const submittedTime = Date.parse(submittedAt);
  if (!BUG_REPORT_ID_PATTERN.test(reportId)
    || !submittedAt
    || !Number.isFinite(submittedTime)
    || new Date(submittedTime).toISOString() !== submittedAt) {
    throw invalidReceipt();
  }

  return { reportId, submittedAt };
}

function invalidReceipt() {
  const error = new Error("Invalid server response.");
  error.code = "invalid_bug_report_receipt";
  return error;
}
