// Engine states are graphs of plain data. Copy them directly rather than
// serializing the entire graph through the platform structured-clone API.
// A new memo per call preserves aliases/cycles within a branch while keeping
// every branch independent. No fields, histories or card data are omitted.
const unsupported = Symbol("native-clone-required");
// A process-level reference backend for reproducible performance comparisons.
const nativeBackend = globalThis.process?.env?.RIFTBOUND_AI_NATIVE_CLONE === "1";

export function cloneAiState(value) {
  if (nativeBackend) return structuredClone(value);
  const seen = new Map();
  function visit(source) {
    if (source === null || typeof source !== "object") {
      if (typeof source === "function" || typeof source === "symbol") throw unsupported;
      return source;
    }
    if (seen.has(source)) return seen.get(source);
    const array = Array.isArray(source);
    const prototype = Object.getPrototypeOf(source);
    if (!array && prototype !== Object.prototype && prototype !== null) throw unsupported;
    const target = array ? new Array(source.length) : {};
    seen.set(source, target);
    for (const key of Object.keys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      // Do not invoke accessors during the fast attempt. Native fallback then
      // invokes each getter once, including getters preceding exotic values.
      if (!Object.hasOwn(descriptor, "value")) throw unsupported;
      const item = visit(descriptor.value);
      if (key === "__proto__") {
        Object.defineProperty(target, key, {
          value: item, writable: true, enumerable: true, configurable: true
        });
      } else target[key] = item;
    }
    return target;
  }
  try {
    return visit(value);
  } catch (error) {
    if (error !== unsupported) throw error;
    // Exotic data (typed arrays, Map/Set, Date, etc.) falls back as one whole
    // graph so aliases crossing a plain/exotic boundary are preserved too.
    return structuredClone(value);
  }
}
