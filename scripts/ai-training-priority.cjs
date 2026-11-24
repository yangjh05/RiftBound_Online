"use strict";

// Preload only in training entrypoints. Keep the file authoritative so a child
// never inherits an obsolete setting from a long-lived controller environment.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const classes = {
  low: os.constants.priority.PRIORITY_LOW,
  "below-normal": os.constants.priority.PRIORITY_BELOW_NORMAL,
  normal: os.constants.priority.PRIORITY_NORMAL,
  "above-normal": os.constants.priority.PRIORITY_ABOVE_NORMAL,
  high: os.constants.priority.PRIORITY_HIGH
};
const priorityFile = process.env.RIFTBOUND_AI_PROCESS_PRIORITY_FILE
  || path.resolve(__dirname, "../data/ai/process-priority.json");
process.env.RIFTBOUND_AI_PROCESS_PRIORITY_FILE = priorityFile;
// Propagate this hook even when this controller was invoked directly instead
// of via npm. Existing NODE_OPTIONS (including TensorFlow compatibility) survive.
if (!(process.env.NODE_OPTIONS || "").includes(__filename)
  && !(process.env.NODE_OPTIONS || "").includes(__filename.replaceAll("\\", "/"))) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --require "${__filename.replaceAll("\\", "/")}"`.trim();
}
let lastWarning = null;
function apply() {
  let requested = process.env.RIFTBOUND_AI_PROCESS_PRIORITY;
  try {
    const settings = JSON.parse(fs.readFileSync(priorityFile, "utf8").replace(/^\uFEFF/, ""));
    if (Object.hasOwn(classes, settings.priority)) requested = settings.priority;
  } catch (error) {
    if (error.code !== "ENOENT" && lastWarning !== error.message) {
      lastWarning = error.message;
      process.emitWarning(`Could not read training priority setting: ${error.message}`);
    }
  }
  if (!Object.hasOwn(classes, requested)) return;
  process.env.RIFTBOUND_AI_PROCESS_PRIORITY = requested;
  try {
    if (os.getPriority(0) !== classes[requested]) os.setPriority(0, classes[requested]);
  } catch (error) {
    // A scheduling permission error must never abort a training game.
    if (lastWarning !== error.message) { lastWarning = error.message; process.emitWarning(`Could not apply training priority: ${error.message}`); }
  }
}
apply();
setInterval(apply, 3000).unref();
