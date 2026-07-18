const SIGNAL_EXIT_CODES = Object.freeze({
  SIGINT: 130,
  SIGTERM: 143
});

export function classifyBootstrapTermination(result, interruptionSignal = null) {
  if (interruptionSignal) {
    return {
      state: "interrupted",
      exitCode: SIGNAL_EXIT_CODES[interruptionSignal] || 1
    };
  }
  if (result.exitCode === 0) return { state: "complete", exitCode: 0 };
  return {
    state: "failed",
    exitCode: Number.isInteger(result.exitCode) && result.exitCode > 0 ? result.exitCode : 1
  };
}
