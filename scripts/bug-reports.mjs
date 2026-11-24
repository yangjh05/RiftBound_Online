import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectEnv } from "./load-project-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadProjectEnv(root);
const { BugReportError, BugReportStore } = await import("../server/bug-reports.mjs");

const args = process.argv.slice(2);
const idIndex = args.indexOf("--id");
const reportId = idIndex >= 0 ? args[idIndex + 1] : "";
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 50;
const store = new BugReportStore();

try {
  if (reportId) {
    process.stdout.write(`${JSON.stringify(await store.get(reportId), null, 2)}\n`);
  } else {
    const reports = await store.list({ limit: Number.isSafeInteger(limit) ? limit : 50 });
    if (!reports.length) {
      console.log("저장된 버그 리포트가 없습니다.");
    } else {
      console.table(reports.map((report) => ({
        id: report.id,
        submittedAt: report.submittedAt,
        description: report.description
      })));
      console.log("상세 보기: npm run bug-reports -- --id <report-id>");
    }
  }
} catch (error) {
  console.error(error instanceof BugReportError ? error.message : (error?.stack || error));
  process.exitCode = 1;
}
