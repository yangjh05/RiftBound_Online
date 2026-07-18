import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const privatePath = path.join(root, ".secrets", "update-private-key.pem");
const publicPath = path.join(root, "electron", "update-public-key.pub");

if (await exists(privatePath) || await exists(publicPath)) {
  throw new Error("Update signing keys already exist. Refusing to overwrite them.");
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
await mkdir(path.dirname(privatePath), { recursive: true });
await writeFile(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { encoding: "utf8", mode: 0o600 });
await writeFile(publicPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");
console.log(`Created update signing keys. Keep ${privatePath} secret and back it up securely.`);

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
