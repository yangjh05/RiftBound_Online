import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { sha256Hex } from "../src/ai/neural/sha256.mjs";

test("browser-compatible SHA-256 matches standard vectors", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("browser-compatible SHA-256 preserves Node UTF-8 hashing semantics", () => {
  const values = [
    "한글과 😀 emoji",
    "block-boundary-".repeat(20),
    `lone-surrogate:\ud800:end`,
    JSON.stringify({ z: 1, nested: [true, null, "문자열"] }),
    ...[55, 56, 63, 64, 65, 127, 128].map((length) => "x".repeat(length))
  ];

  for (const value of values) {
    const expected = createHash("sha256").update(value).digest("hex");
    assert.equal(sha256Hex(value), expected);
  }
});
