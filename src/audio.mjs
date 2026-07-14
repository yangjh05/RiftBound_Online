let audioContext = null;
let masterGain = null;
let unlocked = false;
let options = { enabled: true, voice: true, volume: 0.72 };
let lastVoiceAt = 0;

export function configureAudio(next = {}) {
  options = { ...options, ...next };
  if (masterGain) masterGain.gain.setTargetAtTime(options.enabled ? options.volume : 0, audioContext.currentTime, 0.025);
}

export function unlockAudio() {
  if (!options.enabled) return false;
  ensureContext();
  if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
  unlocked = Boolean(audioContext);
  return unlocked;
}

export function playPresentationCue(cue) {
  if (!options.enabled || !unlocked || !cue?.kind) return;
  const now = audioContext.currentTime;
  switch (cue.kind) {
    case "card":
      whoosh(now, 0.28, 0.22);
      tone(220, 330, now + 0.06, 0.18, "triangle", 0.16);
      break;
    case "trigger":
      shimmer(now, [392, 523, 659], 0.12);
      break;
    case "reaction":
      whoosh(now, 0.22, 0.3);
      tone(740, 310, now + 0.03, 0.22, "sawtooth", 0.14);
      break;
    case "ambush":
      whoosh(now, 0.35, 0.4);
      noiseHit(now + 0.08, 0.32, 0.32, 130);
      tone(95, 62, now + 0.08, 0.42, "sawtooth", 0.25);
      break;
    case "resolve":
      shimmer(now, [330, 440, 554], 0.09);
      break;
    case "impact":
    case "unit-down":
      noiseHit(now, 0.24, 0.28, 170);
      tone(120, 54, now, 0.36, "square", 0.22);
      break;
    case "multi-kill":
      noiseHit(now, 0.42, 0.4, 110);
      tone(92, 46, now, 0.55, "sawtooth", 0.3);
      tone(180, 90, now + 0.12, 0.38, "square", 0.15);
      break;
    case "counter":
      tone(820, 160, now, 0.2, "sawtooth", 0.2);
      noiseHit(now + 0.08, 0.18, 0.25, 720);
      break;
    case "score":
      shimmer(now, [262, 392, 523, 784], 0.14);
      tone(110, 82, now, 0.5, "sine", 0.2);
      break;
    case "comeback":
      shimmer(now, [196, 294, 392, 587, 784], 0.18);
      noiseHit(now + 0.16, 0.3, 0.24, 140);
      break;
    case "victory-score":
      shimmer(now, [196, 262, 330, 523, 784], 0.2);
      tone(82, 55, now, 0.8, "sine", 0.25);
      break;
    case "showdown":
      tone(72, 54, now, 0.85, "sawtooth", 0.26);
      noiseHit(now + 0.3, 0.36, 0.22, 90);
      break;
    case "your-turn":
      shimmer(now, [330, 494, 659], 0.1);
      break;
    case "turn":
      tone(262, 220, now, 0.2, "sine", 0.1);
      break;
    case "victory":
      victoryFanfare(now);
      break;
    case "defeat":
      tone(196, 147, now, 0.7, "triangle", 0.18);
      tone(147, 98, now + 0.28, 0.8, "sine", 0.2);
      break;
    case "ui":
      tone(420, 560, now, 0.06, "sine", 0.08);
      break;
    default:
      tone(300, 360, now, 0.12, "sine", 0.08);
  }
  if (cue.callout) speakCallout(cue.callout);
}

export function speakCallout(text) {
  if (!options.enabled || !options.voice || !text || !("speechSynthesis" in window)) return;
  const now = Date.now();
  if (now - lastVoiceAt < 2200) return;
  lastVoiceAt = now;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => /^ko(-|_)/i.test(voice.lang)) || voices.find((voice) => /^en(-|_)/i.test(voice.lang)) || null;
  utterance.lang = utterance.voice?.lang || "ko-KR";
  utterance.rate = 0.9;
  utterance.pitch = 0.78;
  utterance.volume = Math.min(1, options.volume * 0.9);
  window.speechSynthesis.speak(utterance);
}

function ensureContext() {
  if (audioContext) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext = new AudioContext();
  masterGain = audioContext.createGain();
  masterGain.gain.value = options.enabled ? options.volume : 0;
  masterGain.connect(audioContext.destination);
}

function tone(startFrequency, endFrequency, start, duration, type = "sine", gainAmount = 0.16) {
  if (!audioContext || !masterGain) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainAmount, start + Math.min(0.025, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function shimmer(start, frequencies, spacing) {
  frequencies.forEach((frequency, index) => tone(frequency, frequency * 1.015, start + index * spacing, 0.34, "triangle", 0.11));
}

function whoosh(start, duration, gainAmount) {
  if (!audioContext || !masterGain) return;
  const length = Math.ceil(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    const envelope = Math.sin(Math.PI * index / length);
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(380, start);
  filter.frequency.exponentialRampToValueAtTime(2400, start + duration);
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainAmount, start + duration * 0.55);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(start);
}

function noiseHit(start, duration, gainAmount, frequency) {
  if (!audioContext || !masterGain) return;
  const length = Math.ceil(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2.2);
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = frequency;
  gain.gain.setValueAtTime(gainAmount, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(start);
}

function victoryFanfare(start) {
  [196, 247, 294, 392, 494, 587, 784].forEach((frequency, index) => {
    tone(frequency, frequency * 1.01, start + index * 0.115, index > 4 ? 0.72 : 0.36, index > 3 ? "triangle" : "sine", index > 4 ? 0.18 : 0.12);
  });
  tone(65, 49, start, 1.45, "sine", 0.24);
  noiseHit(start + 0.68, 0.55, 0.18, 180);
}
