import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readTrajectoryArchive,
  writeTrajectoryArchive
} from "../src/ai/neural/archive.mjs";
import { renameWithRetry } from "./file-replace.mjs";

const DEFAULT_HANDOFF_DIRECTORY = path.join(
  os.tmpdir(),
  "riftbound-ai-selfplay-results"
);

export async function createSelfPlayResultHandoff(
  result,
  directory = DEFAULT_HANDOFF_DIRECTORY,
  options = {}
) {
  await mkdir(directory, { recursive: true });
  const identity = `result-${process.pid}-${randomUUID()}`;
  const resultArchivePath = path.join(
    directory,
    `${identity}.json.gz`
  );
  const resultSummaryPath = path.join(directory, `${identity}.summary.json`);
  try {
    await writeTrajectoryArchive(resultArchivePath, result);
    await writeFile(
      resultSummaryPath,
      `${JSON.stringify(options.summary || null)}\n`,
      "utf8"
    );
    return { resultArchivePath, resultSummaryPath };
  } catch (error) {
    await Promise.all([
      rm(resultArchivePath, { force: true }).catch(() => {}),
      rm(resultSummaryPath, { force: true }).catch(() => {})
    ]);
    throw error;
  }
}

export async function consumeSelfPlayResultHandoff(message) {
  if (!message?.resultArchivePath) return message?.result;
  try {
    return await readTrajectoryArchive(message.resultArchivePath);
  } finally {
    await discardSelfPlayResultHandoff(message);
  }
}

export async function readSelfPlayResultHandoffSummary(message) {
  if (!message?.resultSummaryPath) return message?.resultSummary || null;
  return JSON.parse(await readFile(message.resultSummaryPath, "utf8"));
}

export async function adoptSelfPlayResultHandoff(
  message,
  destinationArchivePath,
  destinationSummaryPath
) {
  if (!message?.resultArchivePath || !message?.resultSummaryPath) {
    throw new Error("Self-play result handoff is missing its archive or summary path.");
  }
  await Promise.all([
    mkdir(path.dirname(destinationArchivePath), { recursive: true }),
    mkdir(path.dirname(destinationSummaryPath), { recursive: true })
  ]);
  if (existsSync(destinationArchivePath)
    && existsSync(destinationSummaryPath)) {
    await discardSelfPlayResultHandoff(message);
    return {
      resultArchivePath: destinationArchivePath,
      resultSummaryPath: destinationSummaryPath,
      reusedExisting: true
    };
  }
  const transactionId = randomUUID();
  const stagedArchivePath =
    `${destinationArchivePath}.incoming-${transactionId}`;
  const stagedSummaryPath =
    `${destinationSummaryPath}.incoming-${transactionId}`;
  const commitPath = destinationSummaryPath.replace(
    /\.summary\.json$/,
    ".commit.json"
  );
  const stagedCommitPath = `${commitPath}.incoming-${transactionId}`;
  let archiveCommitted = false;
  let summaryCommitted = false;
  try {
    await renameWithRetry(message.resultArchivePath, stagedArchivePath);
    await renameWithRetry(message.resultSummaryPath, stagedSummaryPath);
    await Promise.all([
      rm(destinationArchivePath, { force: true }),
      rm(destinationSummaryPath, { force: true })
    ]);
    await renameWithRetry(stagedArchivePath, destinationArchivePath);
    archiveCommitted = true;
    await renameWithRetry(stagedSummaryPath, destinationSummaryPath);
    summaryCommitted = true;
    await writeFile(
      stagedCommitPath,
      `${JSON.stringify({
        version: 1,
        transactionId,
        archive: path.basename(destinationArchivePath),
        summary: path.basename(destinationSummaryPath)
      })}\n`,
      "utf8"
    );
    await rm(commitPath, { force: true });
    await renameWithRetry(stagedCommitPath, commitPath);
  } catch (error) {
    await Promise.all([
      rm(stagedArchivePath, { force: true }).catch(() => {}),
      rm(stagedSummaryPath, { force: true }).catch(() => {}),
      rm(stagedCommitPath, { force: true }).catch(() => {}),
      archiveCommitted
        ? rm(destinationArchivePath, { force: true }).catch(() => {})
        : null,
      summaryCommitted
        ? rm(destinationSummaryPath, { force: true }).catch(() => {})
        : null,
      discardSelfPlayResultHandoff(message)
    ]);
    throw error;
  }
  return {
    resultArchivePath: destinationArchivePath,
    resultSummaryPath: destinationSummaryPath
  };
}

export async function discardSelfPlayResultHandoff(message) {
  await Promise.all([
    message?.resultArchivePath
      ? rm(message.resultArchivePath, { force: true }).catch(() => {})
      : null,
    message?.resultSummaryPath
      ? rm(message.resultSummaryPath, { force: true }).catch(() => {})
      : null
  ]);
}
