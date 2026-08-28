import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.join(root, "android");
const gradle = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const androidSdk = process.env.ANDROID_SDK_ROOT
  || process.env.ANDROID_HOME
  || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const androidStudioJdk = process.platform === "win32"
  ? "C:\\Program Files\\Android\\Android Studio\\jbr"
  : "";

if (!existsSync(gradle)) throw new Error("Android Gradle wrapper is missing. Run `npx cap add android` first.");
if (!existsSync(androidSdk)) throw new Error(`Android SDK was not found at ${androidSdk}.`);

const environment = {
  ...process.env,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk
};
environment.JAVA_HOME = process.env.RIFTBOUND_ANDROID_JAVA_HOME
  || (existsSync(androidStudioJdk) ? androidStudioJdk : process.env.JAVA_HOME);
if (!environment.JAVA_HOME) throw new Error("A Java 21 JDK is required to build the Android app.");

await new Promise((resolve, reject) => {
  const child = spawn(gradle, ["assembleDebug", "--stacktrace"], {
    cwd: androidRoot,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Gradle exited with code ${code}.`)));
});

const source = path.join(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const destinationDirectory = path.join(root, "dist");
const destination = path.join(destinationDirectory, "Riftbound-Online-debug.apk");
await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
console.log(`APK: ${destination}`);
