import { appendFileSync, renameSync } from "node:fs";
import { rename } from "node:fs/promises";

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([10, 25, 50, 100, 200, 400, 800]);
const APPEND_RETRY_DELAYS_MS = Object.freeze([
  25,
  50,
  100,
  200,
  400,
  800,
  1600,
  3200,
  5000
]);
const RETRYABLE_FILE_REPLACE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export function isRetryableFileReplaceError(error) {
  return RETRYABLE_FILE_REPLACE_CODES.has(error?.code);
}

export async function renameWithRetry(source, destination, options = {}) {
  const renameFile = options.renameFile || rename;
  const wait = options.wait || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const delays = options.delays || DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      if (!isRetryableFileReplaceError(error) || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}

export function renameWithRetrySync(source, destination, options = {}) {
  const renameFile = options.renameFile || renameSync;
  const wait = options.wait || waitSync;
  const delays = options.delays || DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameFile(source, destination);
      return;
    } catch (error) {
      if (!isRetryableFileReplaceError(error) || attempt >= delays.length) throw error;
      wait(delays[attempt]);
    }
  }
}

export function appendFileWithRetrySync(file, data, options = {}) {
  const appendFile = options.appendFile || appendFileSync;
  const wait = options.wait || waitSync;
  const delays = options.delays || APPEND_RETRY_DELAYS_MS;
  const encoding = options.encoding || "utf8";
  for (let attempt = 0; ; attempt += 1) {
    try {
      appendFile(file, data, encoding);
      return;
    } catch (error) {
      if (!isRetryableFileReplaceError(error) || attempt >= delays.length) {
        throw error;
      }
      wait(delays[attempt]);
    }
  }
}

function waitSync(delay) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
}
