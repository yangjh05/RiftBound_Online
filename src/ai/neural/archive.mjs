import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export async function writeTrajectoryArchive(filename, payload) {
  await mkdir(path.dirname(filename), { recursive: true });
  const serialized = JSON.stringify(payload, typedArrayReplacer);
  await writeFile(filename, await gzipAsync(serialized));
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
