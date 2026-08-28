import { createHash } from "node:crypto";
import os from "node:os";
import { ACTION_DIM } from "../src/ai/neural/encoding.mjs";

export const TRAINING_INPUT_DIGEST_VERSION = 1;

export function deterministicTrainingTrajectoryDigest(trajectory) {
  const hash = createHash("sha256");
  writeToken(hash, "training-trajectory");
  writeToken(hash, String(TRAINING_INPUT_DIGEST_VERSION));
  const { steps = [], ...header } = trajectory || {};
  writeCanonicalValue(hash, header, new WeakSet());
  writeToken(hash, `steps:${steps.length}`);
  for (const step of steps) {
    const { actions, ...stepWithoutActions } = step || {};
    writeCanonicalValue(hash, stepWithoutActions, new WeakSet());
    const validActionValues = Math.max(
      0,
      Math.min(
        valueLength(actions),
        Math.max(0, Number(step?.legalCount) || 0) * ACTION_DIM
      )
    );
    writeToken(hash, `valid-actions:${validActionValues}`);
    writeCanonicalValue(
      hash,
      sliceNumericValues(actions, validActionValues),
      new WeakSet()
    );
  }
  return `sha256:${hash.digest("hex")}`;
}

export function deterministicValueDigest(value) {
  const hash = createHash("sha256");
  writeToken(hash, "canonical-value");
  writeToken(hash, String(TRAINING_INPUT_DIGEST_VERSION));
  writeCanonicalValue(hash, value, new WeakSet());
  return `sha256:${hash.digest("hex")}`;
}

function writeCanonicalValue(hash, value, ancestors) {
  if (value === null) {
    writeToken(hash, "null");
    return;
  }
  if (value === undefined) {
    writeToken(hash, "undefined");
    return;
  }
  const type = typeof value;
  if (type === "boolean") {
    writeToken(hash, value ? "boolean:1" : "boolean:0");
    return;
  }
  if (type === "number") {
    writeToken(hash, "number");
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(Number.isNaN(value) ? Number.NaN : value, 0);
    hash.update(bytes);
    return;
  }
  if (type === "bigint") {
    writeToken(hash, `bigint:${value.toString(10)}`);
    return;
  }
  if (type === "string") {
    writeToken(hash, "string");
    writeBytes(hash, Buffer.from(value, "utf8"));
    return;
  }
  if (type !== "object") {
    writeToken(hash, `${type}:${String(value)}`);
    return;
  }
  if (ancestors.has(value)) {
    throw new Error("Training input digest cannot encode cyclic data.");
  }
  ancestors.add(value);
  try {
    if (Buffer.isBuffer(value)) {
      writeToken(hash, "typed:Buffer");
      writeBytes(hash, value);
      return;
    }
    if (ArrayBuffer.isView(value)) {
      const name = value.constructor?.name || "TypedArray";
      writeToken(hash, `typed:${name}:${value.length ?? value.byteLength}`);
      writeBytes(hash, canonicalTypedArrayBytes(value));
      return;
    }
    if (value instanceof ArrayBuffer) {
      writeToken(hash, `array-buffer:${value.byteLength}`);
      writeBytes(hash, Buffer.from(value));
      return;
    }
    if (Array.isArray(value)) {
      writeToken(hash, `array:${value.length}`);
      for (const item of value) writeCanonicalValue(hash, item, ancestors);
      return;
    }
    const keys = Object.keys(value).sort();
    writeToken(hash, `object:${keys.length}`);
    for (const key of keys) {
      writeToken(hash, key);
      writeCanonicalValue(hash, value[key], ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function canonicalTypedArrayBytes(value) {
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const elementSize = Number(value.BYTES_PER_ELEMENT) || 1;
  if (os.endianness() !== "LE" || elementSize === 1 || value instanceof DataView) {
    return bytes;
  }
  const canonical = Buffer.from(bytes);
  if (elementSize === 2) canonical.swap16();
  else if (elementSize === 4) canonical.swap32();
  else if (elementSize === 8) canonical.swap64();
  return canonical;
}

function valueLength(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return value.length || 0;
  return 0;
}

function sliceNumericValues(value, length) {
  if (ArrayBuffer.isView(value)) return value.subarray(0, length);
  if (Array.isArray(value)) return value.slice(0, length);
  return [];
}

function writeToken(hash, value) {
  writeBytes(hash, Buffer.from(String(value), "utf8"));
}

function writeBytes(hash, bytes) {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length), 0);
  hash.update(length);
  hash.update(bytes);
}
