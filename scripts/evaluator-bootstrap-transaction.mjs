import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { renameWithRetry } from "./file-replace.mjs";

const TRANSACTION_VERSION = 2;

export function evaluatorBootstrapCommitPath(summaryPath) {
  return summaryPath.replace(/\.summary\.json$/, ".commit.json");
}

export function evaluatorBootstrapUpdatePath(summaryPath) {
  return summaryPath.replace(/\.summary\.json$/, ".updating.json");
}

export async function replaceEvaluatorBootstrapArchiveAndSummary(options) {
  const {
    archivePath,
    summaryPath,
    payload,
    summary,
    afterArchiveReplace
  } = options;
  const transactionId = randomUUID();
  const stagedArchivePath = `${archivePath}.incoming-${transactionId}`;
  const stagedSummaryPath = `${summaryPath}.incoming-${transactionId}`;
  const commitPath = evaluatorBootstrapCommitPath(summaryPath);
  const stagedCommitPath = `${commitPath}.incoming-${transactionId}`;
  const updatePath = evaluatorBootstrapUpdatePath(summaryPath);
  const stagedUpdatePath = `${updatePath}.incoming-${transactionId}`;

  await Promise.all([
    mkdir(path.dirname(archivePath), { recursive: true }),
    mkdir(path.dirname(summaryPath), { recursive: true })
  ]);

  try {
    await writeTrajectoryArchive(stagedArchivePath, payload);
    const archive = await archiveIdentity(stagedArchivePath);
    const transaction = {
      version: TRANSACTION_VERSION,
      transactionId,
      archiveSha256: archive.sha256,
      archiveBytes: archive.bytes,
      archiveModifiedMs: archive.modifiedMs
    };
    const committedSummary = {
      ...summary,
      archiveTransaction: transaction
    };
    const commit = {
      ...transaction,
      archive: path.basename(archivePath),
      summary: path.basename(summaryPath)
    };

    await Promise.all([
      writeFile(
        stagedSummaryPath,
        `${JSON.stringify(committedSummary)}\n`,
        "utf8"
      ),
      writeFile(stagedCommitPath, `${JSON.stringify(commit)}\n`, "utf8"),
      writeFile(
        stagedUpdatePath,
        `${JSON.stringify({
          version: TRANSACTION_VERSION,
          transactionId,
          archive: path.basename(archivePath),
          summary: path.basename(summaryPath)
        })}\n`,
        "utf8"
      )
    ]);

    await replaceFile(stagedUpdatePath, updatePath);
    await rm(commitPath, { force: true });
    await replaceFile(stagedArchivePath, archivePath);
    await afterArchiveReplace?.({
      archivePath,
      summaryPath,
      transaction
    });
    await replaceFile(stagedSummaryPath, summaryPath);
    await replaceFile(stagedCommitPath, commitPath);
    await rm(updatePath, { force: true });
    return { summary: committedSummary, commit };
  } catch (error) {
    await Promise.all([
      rm(stagedArchivePath, { force: true }).catch(() => {}),
      rm(stagedSummaryPath, { force: true }).catch(() => {}),
      rm(stagedCommitPath, { force: true }).catch(() => {}),
      rm(stagedUpdatePath, { force: true }).catch(() => {})
    ]);
    throw error;
  }
}

export async function commitEvaluatorBootstrapSummary(options) {
  const { archivePath, summaryPath, summary } = options;
  const transactionId = randomUUID();
  const commitPath = evaluatorBootstrapCommitPath(summaryPath);
  const updatePath = evaluatorBootstrapUpdatePath(summaryPath);
  const stagedSummaryPath = `${summaryPath}.incoming-${transactionId}`;
  const stagedCommitPath = `${commitPath}.incoming-${transactionId}`;
  const stagedUpdatePath = `${updatePath}.incoming-${transactionId}`;

  await mkdir(path.dirname(summaryPath), { recursive: true });
  try {
    const archive = await archiveIdentity(archivePath);
    const transaction = {
      version: TRANSACTION_VERSION,
      transactionId,
      archiveSha256: archive.sha256,
      archiveBytes: archive.bytes,
      archiveModifiedMs: archive.modifiedMs
    };
    const committedSummary = {
      ...summary,
      archiveTransaction: transaction
    };
    const commit = {
      ...transaction,
      archive: path.basename(archivePath),
      summary: path.basename(summaryPath)
    };
    await Promise.all([
      writeFile(
        stagedSummaryPath,
        `${JSON.stringify(committedSummary)}\n`,
        "utf8"
      ),
      writeFile(stagedCommitPath, `${JSON.stringify(commit)}\n`, "utf8"),
      writeFile(
        stagedUpdatePath,
        `${JSON.stringify({
          version: TRANSACTION_VERSION,
          transactionId,
          archive: path.basename(archivePath),
          summary: path.basename(summaryPath)
        })}\n`,
        "utf8"
      )
    ]);

    await replaceFile(stagedUpdatePath, updatePath);
    await rm(commitPath, { force: true });
    await replaceFile(stagedSummaryPath, summaryPath);
    await replaceFile(stagedCommitPath, commitPath);
    await rm(updatePath, { force: true });
    return { summary: committedSummary, commit };
  } catch (error) {
    await Promise.all([
      rm(stagedSummaryPath, { force: true }).catch(() => {}),
      rm(stagedCommitPath, { force: true }).catch(() => {}),
      rm(stagedUpdatePath, { force: true }).catch(() => {})
    ]);
    throw error;
  }
}

export async function evaluatorBootstrapSummaryMatchesArchive(
  archivePath,
  summaryPath,
  summary
) {
  if (await fileExists(evaluatorBootstrapUpdatePath(summaryPath))) {
    return false;
  }
  const transaction = summary?.archiveTransaction;
  if (!transaction) {
    // Existing result-v1 records predate the transactional updater. They are
    // safe until the first detached audit update, which creates an update
    // marker before replacing either member of the pair.
    return true;
  }
  if (transaction.version !== TRANSACTION_VERSION) return false;
  let commit;
  try {
    commit = JSON.parse(await readFile(
      evaluatorBootstrapCommitPath(summaryPath),
      "utf8"
    ));
  } catch {
    return false;
  }
  if (commit?.version !== TRANSACTION_VERSION
    || commit.transactionId !== transaction.transactionId
    || commit.archiveSha256 !== transaction.archiveSha256
    || commit.archiveBytes !== transaction.archiveBytes
    || commit.archive !== path.basename(archivePath)
    || commit.summary !== path.basename(summaryPath)) {
    return false;
  }
  let archiveStat;
  try {
    archiveStat = await stat(archivePath);
  } catch {
    return false;
  }
  if (archiveStat.size !== transaction.archiveBytes) return false;
  if (Math.abs(archiveStat.mtimeMs - transaction.archiveModifiedMs) <= 1) {
    return true;
  }
  return (await archiveDigest(archivePath)) === transaction.archiveSha256;
}

async function archiveIdentity(filename) {
  const archiveStat = await stat(filename);
  return {
    sha256: await archiveDigest(filename),
    bytes: archiveStat.size,
    modifiedMs: archiveStat.mtimeMs
  };
}

async function archiveDigest(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

async function replaceFile(source, destination) {
  await rm(destination, { force: true });
  await renameWithRetry(source, destination);
}

async function fileExists(filename) {
  try {
    await stat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
