import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readTrajectoryArchive,
  writeTrajectoryArchive
} from "../src/ai/neural/archive.mjs";

const DEFAULT_OPTIONS_DIRECTORY = path.join(
  os.tmpdir(),
  "riftbound-ai-action-audit-options"
);

export async function createActionAuditOptionsHandoff(
  options,
  directory = DEFAULT_OPTIONS_DIRECTORY
) {
  await mkdir(directory, { recursive: true });
  const optionsArchivePath = path.join(
    directory,
    `options-${process.pid}-${randomUUID()}.json.gz`
  );
  await writeTrajectoryArchive(optionsArchivePath, options);
  return { optionsArchivePath };
}

export async function readActionAuditOptionsHandoff(message) {
  if (!message?.optionsArchivePath) return message?.options || {};
  return readTrajectoryArchive(message.optionsArchivePath);
}

export async function discardActionAuditOptionsHandoff(message) {
  if (!message?.optionsArchivePath) return;
  await rm(message.optionsArchivePath, { force: true });
}
