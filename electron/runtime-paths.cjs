const path = require("node:path");

function bundledServerModulePath({ appRoot, isPackaged, resourcesPath }) {
  const runtimeRoot = isPackaged
    ? path.join(resourcesPath, "app.asar.unpacked")
    : appRoot;
  return path.join(runtimeRoot, "server", "http-multiplayer.mjs");
}

module.exports = { bundledServerModulePath };
