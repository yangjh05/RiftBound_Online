import { mkdtemp, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";

export const TRAINING_TEMP_OWNER = ".riftbound-temp-owner.json";

export async function createTrainingTemporaryDirectory(prefix, directory = tmpdir()) {
  if (!/^riftbound-(?:ai-selfplay-pool|test-[a-z0-9-]+)-$/.test(prefix)) {
    throw new Error("Unrecognized managed training temporary directory prefix.");
  }
  const root = await mkdtemp(path.join(directory, prefix));
  // The parent owns completed handoffs too, even after a worker has exited.
  await writeFile(path.join(root, TRAINING_TEMP_OWNER), JSON.stringify({
    version: 1, hostname: hostname(), pid: process.pid, createdAt: new Date().toISOString()
  }), { flag: "wx" });
  return root;
}
