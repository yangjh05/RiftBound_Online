const browser = typeof window !== "undefined";
let runtime;
let backend = "webgl";
if (browser) {
  runtime = await import("../../../node_modules/@tensorflow/tfjs/dist/tf.fesm.min.js");
} else {
  const requestedBackend = process.env.RIFTBOUND_TF_BACKEND || "tensorflow";
  try {
    if (process.platform === "win32") {
      const { fileURLToPath } = await import("node:url");
      const tensorflowDllDirectory = fileURLToPath(new URL("../../../node_modules/@tensorflow/tfjs-node/deps/lib/", import.meta.url));
      process.env.PATH = `${tensorflowDllDirectory};${process.env.PATH || ""}`;
    }
    runtime = await import(requestedBackend === "gpu" ? "@tensorflow/tfjs-node-gpu" : "@tensorflow/tfjs-node");
    backend = requestedBackend === "gpu" ? "tensorflow-gpu" : "tensorflow";
  } catch {
    try {
      runtime = await import("@tensorflow/tfjs-node");
      backend = requestedBackend === "gpu" ? "tensorflow-gpu-unavailable-cpu-fallback" : "tensorflow";
    } catch {
      runtime = await import("@tensorflow/tfjs");
      backend = "cpu-js";
    }
  }
}
export const tf = runtime;
export const tfBackend = backend;
