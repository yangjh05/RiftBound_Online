import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createGzip, gunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { renameWithRetry } from "../../../scripts/file-replace.mjs";

const gunzipAsync = promisify(gunzip);

export async function writeTrajectoryArchive(filename, payload) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await pipeline(
      trajectoryArchiveJsonChunks(payload),
      createGzip(),
      createWriteStream(temporary)
    );
    // Windows readers can briefly block replacement. Keep the last complete
    // archive intact while retrying the atomic rename; never unlink it first.
    await renameWithRetry(temporary, filename);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readTrajectoryArchive(filename) {
  const content = await gunzipAsync(await readFile(filename));
  return JSON.parse(content.toString("utf8"), typedArrayReviver);
}

function typedArrayReplacer(key, value) {
  if (!ArrayBuffer.isView(value)) return value;
  return { __typedArray: value.constructor.name, base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
}

function typedArrayReviver(key, value) {
  if (!value?.__typedArray) return value;
  const bytes = Buffer.from(value.base64, "base64");
  const constructors = { Float32Array, Int32Array, Uint8Array, Uint16Array, Uint32Array };
  const Constructor = constructors[value.__typedArray];
  if (!Constructor) throw new Error(`Unsupported trajectory typed array: ${value.__typedArray}`);
  const copy = Uint8Array.from(bytes);
  return new Constructor(copy.buffer);
}

function* trajectoryArchiveJsonChunks(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    yield JSON.stringify(payload, typedArrayReplacer);
    return;
  }
  yield "{";
  let wroteProperty = false;
  for (const [key, value] of Object.entries(payload)) {
    if (key === "trajectories" && Array.isArray(value)) {
      if (wroteProperty) yield ",";
      yield `${JSON.stringify(key)}:[`;
      for (let index = 0; index < value.length; index += 1) {
        if (index) yield ",";
        yield JSON.stringify(value[index], typedArrayReplacer) ?? "null";
      }
      yield "]";
      wroteProperty = true;
      continue;
    }
    const serialized = JSON.stringify(value, typedArrayReplacer);
    if (serialized == null) continue;
    if (wroteProperty) yield ",";
    yield `${JSON.stringify(key)}:${serialized}`;
    wroteProperty = true;
  }
  yield "}";
}
