// Browser module Workers have no `window`, but they must still use the bundled
// browser TensorFlow runtime. Treat only a real Node process as the server path.
const browser = typeof process === "undefined" || typeof window !== "undefined";
let runtime;
let backend = "webgl";
if (browser) {
  runtime = await import("../../../assets/vendor/tensorflow/tf.fesm.min.js");
} else {
  // Every Node entry point (including remote workers) needs this, even when
  // it was launched without the optional training preload on Node 23+.
  const nodeUtilModule = "node:util";
  const { default: util } = await import(/* @vite-ignore */ nodeUtilModule);
  if (typeof util.isNullOrUndefined !== "function") util.isNullOrUndefined = value => value == null;
  if (typeof util.isArray !== "function") util.isArray = Array.isArray;
  const requestedBackend = process.env.RIFTBOUND_TF_BACKEND || "tensorflow";
  try {
    if (process.platform === "win32") {
      const nodeUrlModule = "node:url";
      const { fileURLToPath } = await import(/* @vite-ignore */ nodeUrlModule);
      const tensorflowDllPath = "../../../node_modules/@tensorflow/tfjs-node/deps/lib/";
      const tensorflowDllDirectory = fileURLToPath(new URL(tensorflowDllPath, import.meta.url));
      process.env.PATH = `${tensorflowDllDirectory};${process.env.PATH || ""}`;
    }
    const requestedRuntime = requestedBackend === "gpu" ? "@tensorflow/tfjs-node-gpu" : "@tensorflow/tfjs-node";
    runtime = await import(/* @vite-ignore */ requestedRuntime);
    backend = requestedBackend === "gpu" ? "tensorflow-gpu" : "tensorflow";
  } catch {
    try {
      const cpuRuntime = "@tensorflow/tfjs-node";
      runtime = await import(/* @vite-ignore */ cpuRuntime);
      backend = requestedBackend === "gpu" ? "tensorflow-gpu-unavailable-cpu-fallback" : "tensorflow";
    } catch {
      const javascriptRuntime = "@tensorflow/tfjs";
      runtime = await import(/* @vite-ignore */ javascriptRuntime);
      backend = "cpu-js";
    }
  }
}
export const tf = runtime;
export const tfBackend = backend;
