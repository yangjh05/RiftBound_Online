import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = process.env.RIFTBOUND_AUDIT_CAPACITY_FIXTURE;
process.on("message", async message => {
  if (message.type === "initialize") process.send({ type: "ready" });
  if (message.type === "shutdown") process.exit(0);
  if (message.type !== "run-audit-seed-batch") return;
  const task = message.task;
  appendFileSync(path.join(directory, "events.jsonl"), `${JSON.stringify({ taskId: task.taskId, pid: process.pid })}\n`);
  while (!existsSync(path.join(directory, `release-${task.taskId}`))) await delay(20);
  writeFileSync(task.outputPath, JSON.stringify({ taskId: task.taskId, pid: process.pid }));
  process.send({ type: "audit-seed-batch-complete", outputPath: task.outputPath, workerRssBytes: 1024 });
});
