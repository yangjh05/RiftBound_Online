import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export function loadProjectEnv(root = process.cwd()) {
  let contents = "";
  try {
    contents = readFileSync(path.join(root, ".env"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawValue.trim());
  }
}

function unquote(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value.at(-1) !== quote) return value;
  const inner = value.slice(1, -1);
  return quote === "\""
    ? inner.replace(/\\n/gu, "\n").replace(/\\r/gu, "\r").replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\")
    : inner;
}
