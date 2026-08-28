export function independentActionAuditNearMissRescueEligible(
  diagnostic,
  options = {}
) {
  if (diagnostic?.status !== "final-failed") return false;
  const final = diagnostic.final;
  if (!final) return false;
  const maximumLowerBoundGap = Math.max(
    0,
    Number(options.maximumLowerBoundGap) || 0.03
  );
  const lowerBound = Number(final.lowerBound);
  if (!(Number(final.mean) > 0)
    || !Number.isFinite(lowerBound)
    || lowerBound >= 0
    || lowerBound < -maximumLowerBoundGap) {
    return false;
  }
  if (Number(final.attemptedPairs) !== 64
    || Number(final.seedCount) !== 64
    || Number(final.terminalPairs) < 32
    || final.determinization?.complete !== true) {
    return false;
  }
  const failureReasons = [...(final.failureReasons || [])];
  return failureReasons.length === 1
    && failureReasons[0] === "nonpositive-terminal-paired-lower-bound";
}
