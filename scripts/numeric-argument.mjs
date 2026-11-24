export function numericArgument(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (typeof value === "boolean" || String(value).trim() === "" || !Number.isFinite(number)) {
    throw new Error(`Invalid numeric training argument: ${String(value)}`);
  }
  return number;
}
