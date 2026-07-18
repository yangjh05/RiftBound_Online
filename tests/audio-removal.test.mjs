import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the client contains no TTS, Web Audio, or sound controls", () => {
  const sources = sourceFiles(path.join(root, "src"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const app = fs.readFileSync(path.join(root, "src", "app.mjs"), "utf8");

  assert.doesNotMatch(sources, /speechSynthesis|SpeechSynthesisUtterance|AudioContext|webkitAudioContext|createOscillator|createBufferSource/u);
  assert.doesNotMatch(app, /toggle-sound|toggle-voice|settings-volume|playPresentationCue|unlockAudio|configureAudio/u);
  assert.equal(fs.existsSync(path.join(root, "src", "audio.mjs")), false);
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [target] : [];
  });
}
