import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const RUNTIME_ENTRY_FILES = Object.freeze([
  "scripts/ai-action-audit-remote-host.mjs",
  "scripts/ai-action-audit-worker-process.mjs"
]);
const RUNTIME_ROOT_FILES = Object.freeze(["package-lock.json"]);
const IMPORT_SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/gu;

export async function actionAuditRuntimeFingerprint(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const files = new Set(RUNTIME_ROOT_FILES);
  for (const entry of RUNTIME_ENTRY_FILES) {
    await collectRuntimeDependencies(root, entry, files);
  }
  const sortedFiles = [...files].sort();
  const digest = createHash("sha256");
  for (const relativePath of sortedFiles) {
    const normalized = relativePath.split(path.sep).join("/");
    digest.update(normalized);
    digest.update("\0");
    digest.update(await readFile(path.join(root, relativePath)));
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

async function collectRuntimeDependencies(root, relativePath, files) {
  const normalized = path.normalize(relativePath);
  if (files.has(normalized)) return;
  files.add(normalized);
  const absolutePath = path.join(root, normalized);
  const source = await readFile(absolutePath, "utf8");
  const directory = path.dirname(normalized);
  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const dependency = await resolveDependency(
      root,
      path.normalize(path.join(directory, match[1]))
    );
    if (dependency) await collectRuntimeDependencies(root, dependency, files);
  }
}

async function resolveDependency(root, relativePath) {
  for (const candidate of [relativePath, `${relativePath}.mjs`, `${relativePath}.json`]) {
    try {
      if ((await stat(path.join(root, candidate))).isFile()) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Action-audit runtime dependency is missing: ${relativePath}`);
}
