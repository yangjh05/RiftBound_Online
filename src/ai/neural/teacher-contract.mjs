// Increment when simulation-teacher confidence, verification, or label meaning
// changes. PPO returns remain compatible across versions; direct teacher
// supervision does not.
export const TEACHER_LABEL_VERSION = 8;

export const INFORMATION_SET_HASH_VERSION = 1;

// This identity intentionally uses only tensors and action keys that were
// available to the acting player at the decision boundary. Never add the
// authoritative engine snapshot, hidden deck order, or opponent hand here.
export function createInformationSetHash(step = {}) {
  let hash = 2166136261;
  hash = hashText(hash, `information-set-v${INFORMATION_SET_HASH_VERSION}`);
  hash = hashText(hash, String(step.actorId || step.playerId || "unknown"));
  hash = hashNumbers(hash, step.state || step.stateEncoding);
  hash = hashNumbers(hash, step.initialMemory);
  for (const key of step.legalActionKeys || []) hash = hashText(hash, String(key));
  return `info-v${INFORMATION_SET_HASH_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function stableTeacherCorrectionId(chunk = {}, step = {}, kind = "teacher") {
  const informationSetHash = step.informationSetHash || createInformationSetHash({
    ...step,
    playerId: chunk.playerId
  });
  const selectedActionKey = step.behaviorActionKey
    || step.actualActionKey
    || step.teacherComparedActionKey
    || step.selectedActionKey
    || step.legalActionKeys?.[step.selectedIndex]
    || "none";
  const recommendedActionKey = step.recommendedActionKey
    || step.legalActionKeys?.[step.teacherIndex]
    || step.selectedActionKey
    || "none";
  let hash = 2166136261;
  for (const value of [
    `teacher-label-v${TEACHER_LABEL_VERSION}`,
    kind,
    informationSetHash,
    selectedActionKey,
    recommendedActionKey
  ]) hash = hashText(hash, String(value));
  return `correction-v2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function hashNumbers(initial, values) {
  let hash = initial >>> 0;
  if (!values) return hashText(hash, "none");
  const source = ArrayBuffer.isView(values) || Array.isArray(values)
    ? values
    : [];
  hash = hashText(hash, String(source.length));
  for (let index = 0; index < source.length; index += 1) {
    const value = Number(source[index]) || 0;
    // Quantization keeps the identity stable across JSON/Float32 round trips.
    hash = hashText(hash, String(Math.round(value * 1e6)));
  }
  return hash;
}

function hashText(initial, value) {
  let hash = initial >>> 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}
