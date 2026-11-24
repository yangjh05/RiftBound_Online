export function validateActionManifest(step) {
  const keys = step.legalActionKeys;
  if (!Array.isArray(keys) || keys.length !== step.legalCount
    || !Number.isInteger(step.selectedIndex) || step.selectedIndex < 0
    || step.selectedIndex >= keys.length
    || !step.selectedActionKey || keys[step.selectedIndex] !== step.selectedActionKey) {
    return "Selected action does not match its encoded action index.";
  }
  const original = step.originalLegalActionKeys || keys;
  if (new Set(keys).size !== keys.length || original.length !== step.originalLegalCount
    || keys.some((key) => !original.includes(key))) {
    return "Legal-action manifest is incomplete or inconsistent.";
  }
  return null;
}
