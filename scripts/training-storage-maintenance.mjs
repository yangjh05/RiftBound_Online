import { readdir, readFile, rmdir, statfs, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneCommittedAdaptiveEpochs } from "./adaptive-storage-maintenance.mjs";
import { confinedStorageStat, removeUnchangedStorageFile, sameStorageFile, storageProcessIsGone } from "./training-storage-files.mjs";
import { TRAINING_TEMP_OWNER } from "./training-temporary-directory.mjs";
import { withFileLock } from "./file-lock.mjs";
import { renameWithRetry } from "./file-replace.mjs";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOUR = 60 * 60 * 1000;
const ATOMIC_TEMP = /^(.+\.json(?:\.gz)?)\.tmp-([1-9]\d*)(?:-(?:\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}))?$/;
const MANAGED_TEMP = /^riftbound-(?:ai-selfplay-pool|test-[a-z0-9-]+)-[a-zA-Z0-9]{6}$/;
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "runtime", "training-runtime", "previous-runtime", "production-runtime"]);

async function* directories(root, report) {
  try { if (!(await confinedStorageStat(root, root))?.isDirectory()) return; }
  catch (error) { recordError(report, root, error); return; }
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    try {
      // Native dirents exclude links from traversal. Every operation on an
      // artifact below independently revalidates canonical confinement, so a
      // directory replaced by a junction cannot authorize any deletion.
      // Avoid resolving every *read-only* directory on a 90,000-directory tree.
      if (path.relative(root, directory).split(path.sep).length > 64) throw new Error("Storage scan nesting limit exceeded.");
      const entries = await readdir(directory, { withFileTypes: true });
      report.scannedDirectories += 1;
      yield { directory, entries };
      for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && !SKIP_DIRECTORIES.has(entry.name)) {
        pending.push(path.join(directory, entry.name));
      }
    } catch (error) { recordError(report, directory, error); }
  }
}

function recordError(report, filename, error) {
  if (error.code === "ENOENT") return;
  report.errorCount += 1;
  if (report.errors.length < 20) report.errors.push({ path: filename, message: error.message });
}

function account(report, reason, bytes, filename) {
  report.candidateFiles += 1;
  report.candidateBytes += bytes;
  const category = report.categories[reason] ||= { files: 0, bytes: 0 };
  category.files += 1; category.bytes += bytes;
  if (report.samples.length < 50) report.samples.push({ path: filename, reason, bytes });
  if (!report.dryRun) { report.removedFiles += 1; report.freedBytes += bytes; }
}

async function cleanAtomicTemp(root, filename, match, options, report) {
  const pid = Number(match[2]);
  if (!storageProcessIsGone(pid)) return;
  const info = await confinedStorageStat(root, filename);
  if (!info?.isFile() || options.now - info.mtimeMs < options.minimumAgeMs) return;
  // Retain an orphan if it is the only potentially recoverable copy.
  const destination = path.join(path.dirname(filename), match[1]);
  const committed = await confinedStorageStat(root, destination);
  if (!committed?.isFile() || committed.size === 0 || !storageProcessIsGone(pid)) return;
  if (destination.endsWith(".gz")) await readTrajectoryArchive(destination);
  else JSON.parse(await readFile(destination, "utf8"));
  if (!sameStorageFile(await confinedStorageStat(root, destination), committed)) return;
  if (options.dryRun || await removeUnchangedStorageFile(root, filename, info)) {
    account(report, "orphan-atomic-write", info.size, filename);
  }
}

async function cleanManagedTemp(tempRoot, directory, options, report) {
  if (!(await confinedStorageStat(tempRoot, directory))?.isDirectory()) return;
  const ownerFile = path.join(directory, TRAINING_TEMP_OWNER);
  const ownerInfo = await confinedStorageStat(tempRoot, ownerFile);
  if (!ownerInfo?.isFile()) return; // Legacy/unowned folders are never guessed safe.
  const owner = JSON.parse(await readFile(ownerFile, "utf8"));
  if (owner.version !== 1 || owner.hostname !== hostname() || !storageProcessIsGone(owner.pid)) return;
  const files = [], folders = [], pids = new Set([owner.pid]);
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    const info = await confinedStorageStat(tempRoot, current);
    if (!info?.isDirectory() || options.now - info.mtimeMs < options.minimumAgeMs) return;
    folders.push(current);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory()) { pending.push(filename); continue; }
      const details = await confinedStorageStat(tempRoot, filename);
      if (!details?.isFile() || options.now - details.mtimeMs < options.minimumAgeMs) return;
      const worker = /^(?:result-|progress-|\.worker-)([1-9]\d*)[.-]/.exec(entry.name);
      if (worker) pids.add(Number(worker[1]));
      files.push({ filename, details });
    }
  }
  // Preflight the entire tree before the first unlink. No recursive removal.
  if ([...pids].some(pid => !storageProcessIsGone(pid))) return;
  if (!sameStorageFile(await confinedStorageStat(tempRoot, ownerFile), ownerInfo)) return;
  for (const file of files) if (!sameStorageFile(await confinedStorageStat(tempRoot, file.filename), file.details)) return;
  // Owner marker is deleted last so an interrupted sweep remains recoverable.
  files.sort((a, b) => Number(a.filename === ownerFile) - Number(b.filename === ownerFile));
  for (const { filename, details } of files) {
    if ([...pids].some(pid => !storageProcessIsGone(pid))) return;
    if (options.dryRun || await removeUnchangedStorageFile(tempRoot, filename, details)) {
      account(report, "abandoned-managed-temp", details.size, filename);
    }
  }
  if (!options.dryRun) for (const folder of folders.reverse()) {
    await confinedStorageStat(tempRoot, folder);
    try { await rmdir(folder); }
    catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
  }
}

// Unknown files, raw games, final models, evidence, restart states, .incoming
// transactions, logs and arbitrary .tmp-* workspaces are deliberately retained.
export async function maintainTrainingStorage(options = {}) {
  if (options.dryRun !== false) return sweepTrainingStorage(options);
  const lockRoot = path.resolve(options.temporaryRoot === null
    ? options.trainingRoots?.[0] || path.join(PROJECT_ROOT, "data", "ai")
    : options.temporaryRoot || tmpdir());
  if (!(await confinedStorageStat(lockRoot, lockRoot))?.isDirectory()) throw new Error("Missing storage maintenance lock directory.");
  // Manual runs, training controllers and the watcher share the same temp
  // namespace. Serialize sweeps to avoid Windows delete-pending path races.
  return withFileLock(path.join(lockRoot, ".riftbound-training-storage-sweep.lock"),
    () => sweepTrainingStorage(options), { timeoutMs: 1000 });
}

async function sweepTrainingStorage({ trainingRoots = [path.join(PROJECT_ROOT, "data", "ai")],
  temporaryRoot = tmpdir(), dryRun = true, minimumAgeMs = HOUR, now = Date.now() } = {}) {
  if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < HOUR) throw new Error("Temporary retention must be at least one hour.");
  const options = { dryRun, minimumAgeMs, now };
  const report = { version: 1, at: new Date(now).toISOString(), dryRun, scannedDirectories: 0,
    candidateFiles: 0, candidateBytes: 0, removedFiles: 0, freedBytes: 0, candidateDirectories: 0, removedDirectories: 0,
    categories: {}, samples: [], errorCount: 0, errors: [], volumes: [] };
  const roots = [...new Set(trainingRoots.map(root => path.resolve(root)))];
  for (const root of roots.filter(root => !roots.some(other => other !== root && root.startsWith(other + path.sep)))) {
    for await (const { directory, entries } of directories(root, report)) {
      if (!entries.length && /[\\/]iterations[\\/]\d{6}[\\/]rejected-games(?:[\\/]\d+)?$/.test(directory)) {
        try {
          const info = await confinedStorageStat(root, directory);
          if (info?.isDirectory() && now - info.mtimeMs >= minimumAgeMs) {
            // rmdir is intentionally non-recursive: a new diagnostic arriving
            // after enumeration keeps the directory with ENOTEMPTY.
            if (!dryRun) await rmdir(directory);
            report.candidateDirectories += 1;
            if (!dryRun) report.removedDirectories += 1;
          }
        } catch (error) { if (!["ENOTEMPTY", "EEXIST"].includes(error.code)) recordError(report, directory, error); }
      }
      if (entries.some(entry => entry.name === "state.json.gz" && entry.isFile())
        && entries.some(entry => entry.name === "iterations" && entry.isDirectory())) {
        try {
          // Unsupported state contracts are preserved, including isolated pilots.
          const result = await pruneCommittedAdaptiveEpochs(directory, { dryRun });
          if (result.removedFiles) {
            report.candidateFiles += result.removedFiles; report.candidateBytes += result.freedBytes;
            const category = report.categories["committed-epoch"] ||= { files: 0, bytes: 0 };
            category.files += result.removedFiles; category.bytes += result.freedBytes;
            if (!dryRun) { report.removedFiles += result.removedFiles; report.freedBytes += result.freedBytes; }
            if (report.samples.length < 50) report.samples.push({ path: directory, reason: "committed-epoch", ...result });
          }
        } catch (error) {
          if (!error.message.startsWith("Invalid committed adaptive state")) recordError(report, directory, error);
        }
      }
      for (const entry of entries) {
        const match = entry.isFile() && ATOMIC_TEMP.exec(entry.name);
        if (!match) continue;
        const filename = path.join(directory, entry.name);
        try { await cleanAtomicTemp(root, filename, match, options, report); }
        catch (error) { recordError(report, filename, error); }
      }
    }
  }
  if (temporaryRoot) {
    temporaryRoot = path.resolve(temporaryRoot);
    try {
      await confinedStorageStat(temporaryRoot, temporaryRoot);
      for (const entry of await readdir(temporaryRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !MANAGED_TEMP.test(entry.name)) continue;
        const directory = path.join(temporaryRoot, entry.name);
        try { await cleanManagedTemp(temporaryRoot, directory, options, report); }
        catch (error) { recordError(report, directory, error); }
      }
    } catch (error) { recordError(report, temporaryRoot, error); }
  }
  for (const root of [...roots, ...(temporaryRoot ? [temporaryRoot] : [])]) {
    try { const stats = await statfs(root); report.volumes.push({ path: root, freeBytes: stats.bavail * stats.bsize, lowSpace: stats.bavail * stats.bsize < 5 * 1024 ** 3 }); }
    catch (error) { recordError(report, root, error); }
  }
  return report;
}

export function startTrainingStorageMaintenance(options = {}) {
  let stopped = false, running = null;
  const run = () => {
    if (stopped || running) return running;
    running = maintainTrainingStorage({ ...options, dryRun: false }).then(async report => {
      if (options.onReport) await options.onReport(report);
      else if (report.removedFiles || report.removedDirectories || report.errorCount || report.volumes.some(volume => volume.lowSpace)) {
        console.warn(`[training-storage] removed=${report.removedFiles} directories=${report.removedDirectories} freed=${report.freedBytes} errors=${report.errorCount} lowSpace=${report.volumes.some(volume => volume.lowSpace)}`);
      }
      return report;
    }).catch(error => console.warn(`[training-storage] Deferred: ${error.message}`)).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(run, 15 * 60 * 1000);
  timer.unref();
  void run();
  return async () => { stopped = true; clearInterval(timer); await running; };
}

export async function withTrainingStorageMaintenance(root, action) {
  const stop = startTrainingStorageMaintenance({ trainingRoots: [root] });
  try { return await action(); } finally { await stop(); }
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run ai:storage -- [--apply] [--watch] [--root DIRECTORY] [--temp-root DIRECTORY]\nDefault: preview only. --watch requires --apply; sweeps every 15 minutes.");
    return;
  }
  const options = { dryRun: !args.includes("--apply") };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--apply", "--watch"].includes(arg)) continue;
    if (!["--root", "--temp-root"].includes(arg) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Invalid storage argument: ${arg}`);
    if (arg === "--root") options.trainingRoots = [path.resolve(args[++i])];
    else options.temporaryRoot = path.resolve(args[++i]);
  }
  if (!args.includes("--watch")) { console.log(JSON.stringify(await maintainTrainingStorage(options), null, 2)); return; }
  if (options.dryRun) throw new Error("--watch requires --apply.");
  const root = options.trainingRoots?.[0] || path.join(PROJECT_ROOT, "data", "ai");
  await confinedStorageStat(root, root);
  await withFileLock(path.join(root, ".storage-maintenance.lock"), async () => {
    const reportFile = path.join(root, "storage-maintenance.json");
    const stop = startTrainingStorageMaintenance({ ...options, onReport: async report => {
      await confinedStorageStat(root, root);
      const temporary = `${reportFile}.tmp-${process.pid}`;
      await writeFile(temporary, JSON.stringify({ ...report, watcherPid: process.pid }, null, 2));
      await renameWithRetry(temporary, reportFile);
    } });
    await new Promise(resolve => {
      const keepAlive = setInterval(() => {}, HOUR);
      const finish = () => { clearInterval(keepAlive); process.off("SIGINT", finish); process.off("SIGTERM", finish); resolve(); };
      process.once("SIGINT", finish); process.once("SIGTERM", finish);
    });
    await stop();
  }, { timeoutMs: 1000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
