// JSON does not preserve the aliases between champion slots, live units and
// pending continuations. Record paths, not executable code or object IDs.
export function captureGameReferences(game) {
  const seen = new Map(), references = [];
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) { references.push([path, seen.get(value)]); return; }
    seen.set(value, path);
    for (const key of Object.keys(value)) visit(value[key], [...path, key]);
  }
  visit(game, []);
  return references;
}

export function restoreGameReferences(game, references = []) {
  if (!Array.isArray(references) || references.length > 100000) throw new Error("Invalid game reference table.");
  const get = path => {
    if (!Array.isArray(path) || path.length > 128) throw new Error("Invalid game reference path.");
    let value = game;
    for (const key of path) {
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || !value || !Object.hasOwn(value, key)) throw new Error("Unsafe game reference path.");
      value = value[key];
    }
    if (!value || typeof value !== "object") throw new Error("Game reference is not an object.");
    return value;
  };
  for (const [destination, source] of references) {
    get(destination);
    if (!destination.length) throw new Error("Cannot replace the game root.");
    get(destination.slice(0, -1))[destination.at(-1)] = get(source);
  }
  return game;
}
