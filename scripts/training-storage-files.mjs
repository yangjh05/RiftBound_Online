import { lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";

export function sameStorageFile(left, right) {
  return left && right && ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every(key => left[key] === right[key]);
}

// Resolve every component, including the supplied root. Never follow a junction
// into a different run or accept a path that merely shares the root's prefix.
export async function confinedStorageStat(root, filename) {
  root = path.resolve(root);
  filename = path.resolve(filename);
  if (root.startsWith("\\\\")) throw new Error("Storage cleanup requires a local disk; remote PIDs cannot be verified.");
  const relative = path.relative(root, filename);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Storage path escapes its root: ${filename}`);
  }
  let info = null;
  // realpath resolves the complete ancestor chain in one operation. Repeating
  // it for every ancestor made a sweep of empty game folders needlessly costly.
  for (const cursor of filename === root ? [root] : [root, filename]) {
    try { info = await lstat(cursor); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (info.isSymbolicLink() || path.relative(cursor, await realpath(cursor)) !== "") {
      throw new Error(`Refusing redirected storage path: ${cursor}`);
    }
    if (cursor === root && !info.isDirectory()) throw new Error(`Invalid storage directory: ${cursor}`);
  }
  return info;
}

export async function removeUnchangedStorageFile(root, filename, expected) {
  const current = await confinedStorageStat(root, filename);
  if (!current?.isFile() || !sameStorageFile(current, expected)) return false;
  try { await unlink(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export function storageProcessIsGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; } // EPERM/unknown means protected.
}
