import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function inspectCompatibleCollectionRestartSource(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || "data/ai");
  const generation = Number(options.generation);
  const targetEngineFingerprint = String(
    options.targetEngineFingerprint || ""
  ).trim();
  const verifiedSourceFingerprint = String(
    options.verifiedSourceFingerprint || ""
  ).trim();
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error("A non-negative collection generation is required.");
  }
  if (!targetEngineFingerprint) {
    throw new Error("A target engine fingerprint is required.");
  }

  const manifestPath = path.join(
    dataRoot,
    "resume",
    `generation-${String(generation).padStart(5, "0")}`,
    "manifest.json"
  );
  const manifest = await readJson(manifestPath);
  if (!manifest) {
    return {
      version: 1,
      sourceExists: false,
      generation,
      manifestPath,
      compatible: true,
      attachCompatibilityArguments: false,
      reason: "no-source-collection"
    };
  }

  const sourceCollectionKey = String(manifest.collectionKey || "").trim();
  const sourceEngineFingerprint = String(
    manifest.engineFingerprint || ""
  ).trim();
  const exactEngineMatch = sourceEngineFingerprint === targetEngineFingerprint;
  const explicitlyVerified = Boolean(verifiedSourceFingerprint)
    && sourceEngineFingerprint === verifiedSourceFingerprint;
  const compatible = Boolean(sourceCollectionKey)
    && Boolean(sourceEngineFingerprint)
    && (exactEngineMatch || explicitlyVerified);

  return {
    version: 1,
    sourceExists: true,
    generation,
    manifestPath,
    sourceCollectionKey: sourceCollectionKey || null,
    sourceEngineFingerprint: sourceEngineFingerprint || null,
    targetEngineFingerprint,
    verifiedSourceFingerprint: verifiedSourceFingerprint || null,
    exactEngineMatch,
    explicitlyVerified,
    compatible,
    // Passing the arguments is harmless when the descriptor already matches:
    // train-neural-ai only invokes migration after an exact resume miss. It is
    // essential when an audit/storage-only edit changed the broad engine hash.
    attachCompatibilityArguments: compatible,
    reason: compatible
      ? exactEngineMatch
        ? "exact-engine-fingerprint"
        : "explicitly-verified-runtime-compatibility"
      : !sourceCollectionKey
        ? "missing-source-collection-key"
        : !sourceEngineFingerprint
          ? "missing-source-engine-fingerprint"
          : "source-engine-fingerprint-not-verified"
  };
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2)
    .map((value, index, all) => value.startsWith("--")
      ? [value.slice(2), all[index + 1]]
      : null)
    .filter(Boolean));
  const result = await inspectCompatibleCollectionRestartSource({
    dataRoot: args["data-dir"],
    generation: Number(args.generation),
    targetEngineFingerprint: args["target-engine-fingerprint"],
    verifiedSourceFingerprint: args["verified-source-fingerprint"] || null
  });
  console.log(JSON.stringify(result));
}
