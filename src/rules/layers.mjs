export const LAYER_ORDER = Object.freeze(["trait", "ability", "arithmetic"]);

export function resolveLayeredNumber({
  printed = 0,
  assignment = null,
  modifiers = [],
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY
} = {}) {
  let value = Number.isFinite(assignment) ? Number(assignment) : finiteNumber(printed);
  const values = modifiers.map(finiteNumber);
  for (const increase of values.filter((amount) => amount >= 0)) value += increase;
  for (const decrease of values.filter((amount) => amount < 0)) value += decrease;
  return Math.min(maximum, Math.max(minimum, value));
}

export function evaluateLayeredCharacteristics({ printed = {}, effects = [], context = {}, maxPasses = 32 } = {}) {
  let previous = normalizeState(printed);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const state = normalizeState(printed);
    for (const layer of LAYER_ORDER) {
      const active = orderLayerEffects(effects.filter((effect) => effect.layer === layer), previous, context);
      if (layer === "arithmetic") {
        const increases = active.filter((effect) => finiteNumber(effect.value) >= 0);
        const decreases = active.filter((effect) => finiteNumber(effect.value) < 0);
        for (const effect of [...increases, ...decreases]) applyLayerEffect(state, effect, context);
      } else {
        for (const effect of active) applyLayerEffect(state, effect, context);
      }
    }
    if (stableState(state) === stableState(previous)) return state;
    previous = state;
  }
  throw new Error(`Layer evaluation did not reach a fixed point within ${maxPasses} passes.`);
}

export function orderLayerEffects(effects, state = {}, context = {}) {
  const applicable = effects.filter((effect) => effect && (typeof effect.applies !== "function" || effect.applies(state, context)));
  const byId = new Map(applicable.filter((effect) => effect.id).map((effect) => [effect.id, effect]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  const visit = (effect) => {
    const key = effect.id || effect;
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Cyclic layer dependency involving ${effect.id || "anonymous effect"}.`);
    visiting.add(key);
    for (const dependencyId of effect.dependsOn || []) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(effect);
  };
  for (const effect of [...applicable].sort(compareTimestamps)) visit(effect);
  return ordered;
}

function applyLayerEffect(state, effect, context) {
  if (typeof effect.apply === "function") {
    effect.apply(state, context);
    return;
  }
  const property = effect.property;
  if (effect.operation === "copy") {
    for (const [key, value] of Object.entries(effect.value || {})) state[key] = structuredClone(value);
    return;
  }
  if (effect.operation === "set" || effect.operation === "assign") {
    state[property] = structuredClone(effect.value);
    return;
  }
  if (effect.operation === "grant") {
    state[property] = unique([...(state[property] || []), effect.value]);
    return;
  }
  if (effect.operation === "remove") {
    state[property] = (state[property] || []).filter((value) => value !== effect.value);
    return;
  }
  if (effect.operation === "append") {
    state[property] = `${state[property] || ""}${effect.value || ""}`;
    return;
  }
  if (effect.operation === "add") {
    state[property] = finiteNumber(state[property]) + finiteNumber(effect.value);
  }
}

function normalizeState(printed) {
  const state = structuredClone(printed || {});
  state.tags = unique(state.tags || []);
  state.keywords = unique(state.keywords || []);
  return state;
}

function stableState(state) {
  return JSON.stringify(sortObject(state));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function compareTimestamps(left, right) {
  const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : 0;
  const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : 0;
  return leftTime - rightTime;
}

function unique(values) {
  return [...new Set(values)];
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}
