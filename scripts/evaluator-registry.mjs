import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deserializeNeuralModel,
  serializeNeuralModel
} from "../src/ai/neural/model.mjs";
import {
  evaluatorCertificateStatus,
  neuralBehaviorHash,
  neuralEvaluatorCoreHash,
  neuralEvaluatorLeafHash,
  neuralEvaluatorModelHash
} from "../src/ai/neural/evaluator-certification.mjs";
import { withFileLock } from "./file-lock.mjs";
import { renameWithRetry } from "./file-replace.mjs";

const REGISTRY_VERSION = 3;

export async function loadFrozenEvaluatorRegistry(dataRoot, options = {}) {
  const directory = path.join(dataRoot, "evaluators");
  const indexPath = path.join(directory, "index.json");
  const index = await readJson(indexPath) || emptyRegistry();
  const accepted = [];
  const rejected = [];
  const primaryModel = options.primaryModel || null;
  const activeEntries = (index.entries || [])
    .filter((entry) => entry.status === "active")
    .sort((left, right) =>
      String(right.issuedAt || "").localeCompare(String(left.issuedAt || "")));
  for (const entry of activeEntries) {
    if (entry.engineFingerprint !== options.engineFingerprint) {
      rejected.push({ entry, reasons: ["engine-fingerprint-mismatch"] });
      continue;
    }
    try {
      const checkpoint = JSON.parse(await readFile(path.join(directory, entry.checkpoint), "utf8"));
      const model = deserializeNeuralModel(checkpoint);
      const status = evaluatorCertificateStatus(model, {
        engineFingerprint: options.engineFingerprint,
        primaryModel
      });
      if (!status.eligible) {
        rejected.push({ entry, reasons: status.reasons });
        continue;
      }
      accepted.push(model);
      if (accepted.length >= Math.max(1, Number(options.limit) || 3)) break;
    } catch (error) {
      rejected.push({
        entry,
        reasons: ["checkpoint-load-failed"],
        error: error?.message || String(error)
      });
    }
  }
  if (activeEntries.some((entry) =>
    entry.engineFingerprint !== options.engineFingerprint)) {
    await withFileLock(`${indexPath}.lock`, async () => {
      const current = await readJson(indexPath) || emptyRegistry();
      await writeJsonAtomic(indexPath, {
        ...current,
        engineFingerprint: options.engineFingerprint,
        updatedAt: new Date().toISOString(),
        entries: (current.entries || []).map((entry) =>
          entry.status === "active"
            && entry.engineFingerprint !== options.engineFingerprint
            ? { ...entry, status: "inactive-engine-mismatch" }
            : entry)
      });
    });
  }
  return {
    version: REGISTRY_VERSION,
    directory,
    index,
    accepted,
    rejected
  };
}

export async function registerFrozenEvaluator(dataRoot, model, options = {}) {
  const engineFingerprint = options.engineFingerprint
    || model?.metadata?.engineFingerprint
    || null;
  const status = evaluatorCertificateStatus(model, { engineFingerprint });
  if (!status.eligible) {
    return { registered: false, status };
  }
  const modelHash = neuralEvaluatorModelHash(model);
  const behaviorHash = neuralBehaviorHash(model);
  const evaluatorCoreHash = neuralEvaluatorCoreHash(model);
  const evaluatorLeafHash = neuralEvaluatorLeafHash(model);
  const directory = path.join(dataRoot, "evaluators");
  const checkpoint = `evaluator-${modelHash}.json`;
  const indexPath = path.join(directory, "index.json");
  await mkdir(directory, { recursive: true });
  await writeJsonAtomic(path.join(directory, checkpoint), serializeNeuralModel(model));
  const maximumActive = Math.max(2, Math.min(3, Number(options.maximumActive) || 3));
  await withFileLock(`${indexPath}.lock`, async () => {
    const current = await readJson(indexPath) || emptyRegistry();
    const now = new Date().toISOString();
    const entries = (current.entries || [])
      .filter((entry) => entry.modelHash !== modelHash
        && entry.evaluatorLeafHash !== evaluatorLeafHash)
      .map((entry) => entry.engineFingerprint === engineFingerprint
        ? entry
        : { ...entry, status: "inactive-engine-mismatch" });
    entries.push({
      modelHash,
      behaviorHash,
      evaluatorCoreHash,
      evaluatorLeafHash,
      generation: model.generation ?? null,
      engineFingerprint,
      certificateVersion: model.metadata?.evaluatorCertificate?.version || null,
      certificateKind:
        model.metadata?.evaluatorCertificate?.certificateKind || null,
      permissions: structuredClone(
        model.metadata?.evaluatorCertificate?.permissions || {}
      ),
      issuedAt: model.metadata?.evaluatorCertificate?.issuedAt || now,
      checkpoint,
      status: "active"
    });
    const sameEngineActive = entries
      .filter((entry) => entry.status === "active"
        && entry.engineFingerprint === engineFingerprint)
      .sort((left, right) =>
        String(right.issuedAt || "").localeCompare(String(left.issuedAt || "")));
    const retainedHashes = new Set(
      sameEngineActive.slice(0, maximumActive).map((entry) => entry.modelHash)
    );
    const normalizedEntries = entries.map((entry) =>
      entry.status === "active"
        && entry.engineFingerprint === engineFingerprint
        && !retainedHashes.has(entry.modelHash)
        ? { ...entry, status: "retired" }
        : entry);
    await writeJsonAtomic(indexPath, {
      version: REGISTRY_VERSION,
      engineFingerprint,
      maximumActive,
      updatedAt: now,
      entries: normalizedEntries.slice(-32)
    });
  });
  return {
    registered: true,
    modelHash,
    behaviorHash,
    evaluatorCoreHash,
    evaluatorLeafHash,
    checkpoint,
    status
  };
}

function emptyRegistry() {
  return {
    version: REGISTRY_VERSION,
    engineFingerprint: null,
    maximumActive: 3,
    updatedAt: null,
    entries: []
  };
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await renameWithRetry(temporary, filename);
}
