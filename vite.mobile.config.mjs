import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const multiplayerBaseUrl = String(
  process.env.RIFTBOUND_MULTIPLAYER_URL
  || packageJson.riftboundMultiplayerBaseUrl
  || packageJson.riftboundUpdateBaseUrl
  || ""
).replace(/\/+$/u, "");

function mobileBuildInfo() {
  return {
    name: "riftbound-mobile-build-info",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: JSON.stringify({
          buildId: `${packageJson.version}-android-${new Date().toISOString().replace(/[-:.TZ]/gu, "")}`,
          version: packageJson.version,
          publishedAt: new Date().toISOString(),
          multiplayerBaseUrl
        }, null, 2)
      });
    }
  };
}

function browserTensorflowRuntime() {
  const replacement = path.join(root, "src", "ai", "neural", "tf-browser-runtime.mjs");
  return {
    name: "riftbound-browser-tensorflow-runtime",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./tf-runtime.mjs" && importer?.replaceAll("\\", "/").includes("/src/ai/neural/")) {
        return replacement;
      }
      return null;
    }
  };
}

export default defineConfig({
  root: path.join(root, "mobile"),
  base: "./",
  publicDir: false,
  plugins: [browserTensorflowRuntime(), mobileBuildInfo()],
  worker: {
    format: "es"
  },
  build: {
    outDir: path.join(root, "mobile-dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@tensorflow/tfjs")) return "tensorflow";
          return undefined;
        }
      }
    }
  }
});
