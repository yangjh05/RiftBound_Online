import { rm } from "node:fs/promises";
import { createTrainingTemporaryDirectory } from "../../scripts/training-temporary-directory.mjs";
import { confinedStorageStat } from "../../scripts/training-storage-files.mjs";

export async function trainingTestDirectory(t, name) {
  const root = await createTrainingTemporaryDirectory(`riftbound-test-${name}-`);
  t.after(async () => {
    if (await confinedStorageStat(root, root)) await rm(root, { recursive: true, force: true });
  });
  return root;
}
