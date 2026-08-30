import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { bundledServerModulePath } = require("../electron/runtime-paths.cjs");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("packaged desktop loads its ESM server from app.asar.unpacked", () => {
  const resourcesPath = path.join("C:\\", "Riftbound", "resources");
  assert.equal(
    bundledServerModulePath({
      appRoot: path.join(resourcesPath, "app.asar"),
      isPackaged: true,
      resourcesPath
    }),
    path.join(resourcesPath, "app.asar.unpacked", "server", "http-multiplayer.mjs")
  );
});

test("desktop package unpacks the complete local server module graph", () => {
  const unpacked = new Set(packageJson.build.asarUnpack || []);
  const packaged = new Set(packageJson.build.files || []);
  for (const pattern of ["server/**", "scripts/file-replace.mjs", "src/**"]) {
    assert.equal(unpacked.has(pattern), true, `${pattern} must be outside ASAR for ESM imports`);
    assert.equal(packaged.has(pattern), true, `${pattern} must be included in the desktop package`);
  }
});
