"use strict";

// tfjs-node 4.x still calls these legacy Node util predicates, removed in
// Node 23+. Preload with NODE_OPTIONS so evaluator and self-play children
// receive the same compatibility functions as the training parent.
// These predicates do not alter tensors, model weights, or game semantics.
const util = require("node:util");

if (typeof util.isNullOrUndefined !== "function") {
  util.isNullOrUndefined = (value) => value === null || value === undefined;
}
if (typeof util.isArray !== "function") {
  util.isArray = Array.isArray;
}
