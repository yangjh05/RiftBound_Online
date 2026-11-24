# Natural Shadow phase coverage — 2026-09-13

The old whole-game reservoir produced one mulligan comparison in 264 completed natural jobs. That record belongs to Training; none belonged to Shadow validation. Each game contained about 79 eligible decisions on average. Collecting another small wave did not reliably address this coverage gap.

## Collection and statistics

New natural jobs precommit a channel using a domain-separated SHA-256 draw: 25% whole population, 50% mulligan, 25% early. The selected channel retains one uniform hash-priority reservoir candidate. Selection does not consult teacher outcomes, and the terminal audit runs only after the real game finishes. The population channel preserves positive inclusion probability for every decision, including setup/unknown phases. A missing phase produces no replacement sample.

For a decision in phase h, its marginal inclusion probability is `0.25 / N + I(h=mulligan)*0.5/N_mulligan + I(h=early)*0.25/N_early`. The evaluator uses its reciprocal, including both overlapping channels. It never treats the oversampled phase proportions as the population distribution. Confidence resampling continues to use independent game clusters.

Frames and observations have version 3. Frames commit channel, phase counts, selected phase, marginal probability and the parent task commitment. Readers validate the exact channel draw, positive counts, total, probability formula and hash. Old version 2 frames retain their original `1/N` interpretation. Existing version 1 references are not relabeled.

The Shadow preflight now counts unavailable natural observations and checks the existing risk-assessment count, game and coverage requirements. A stored unavailable observation can be certified as zero regret only when the complete action manifest proves exactly one legal policy action: original count and encoded count are one, index is zero and the selected key matches. Other unavailable observations remain unassessed. A claimed audit whose comparison is invalid remains unavailable instead of disappearing from the denominator. Model performance thresholds are unchanged. The readiness grid version is 9 to invalidate old readiness caches.

## Data compatibility

Saved trajectories, labels, model weights, committed outcome seeds, calibration/protected roles and fixed validation membership are preserved. The game rules and policy decisions are unchanged; the collector only changes the subsequent evidence sample. An exact full-source fingerprint entry in `scripts/training-fingerprint-compatibility.json` preserves this compatible dataset lineage. The raw digest is retained explicitly. An unknown subsequent source change does not match the entry and receives a new fingerprint.

The previous full source digest must be reconstructed exactly from the three saved neural-source backups with the new sampler omitted before this entry is created. This is not a path exclusion or a wildcard exception. The old/new readers and a real-engine fixture are checked before registration.

## Verification

- Focused sampling/evidence/quota tests: 20 passed.
- Existing natural-regret, Policy-Q Shadow, formal-audit and stage-handoff regression tests: 16 passed.
- Fingerprint, training-safety and migration regression tests: 35 passed.
- Real worker IPC, precision and sampling-channel tests: 3 passed.
- Analytic enumeration recovers the original population with inverse marginal probabilities, including overlapping channels.
- An actual 128-pair terminal teacher audit persists a valid version 3 natural mulligan reference.
- A controlled real-engine self-play fixture produces one version 3 mulligan sample, with identical policy actions to the game without collection.
- Runtime and archive compatibility evidence is saved in `.tmp-phase-natural-20260913/`.

Normal priority, maximum 16 workers, memory balancing, 32-game waves and the absence of hard game deadlines remain in force. Existing running games retain their original sampling commitment; the new collector applies to newly launched pools.

## Applied state

At 04:21 KST, the read-only archive check accepted all 1,737 committed records and preserved existing Training/validation membership and the learner file SHA-256. The updated audit recognized 64 previously unavailable, provably single-action observations in validation. Early natural coverage is 11 comparisons from 11 games, including six such zero-regret observations; only mulligan remains below the preflight requirement. This is a data-readiness result, not a model-strength result.

The live parent now uses the updated frame validator, evaluator aggregation, preflight and grid 9. Its existing Training-count quota adapter is preserved. The current coordinator's future pools use the new collection commitment. Runtime probes verified the original exported call paths with a real persisted version 3 comparison and verified that future task upgrades preserve the precision budget and re-sign the changed commitment. Inspector connections were closed afterward. Ten already-running games still use their original protocol and continue to completion.

Raw reviewed source digest: `sha256:0c917d63ded1f1cf29eaec474dc93ea7a4a32e4580995315a329292eea7c9e0c`. Compatible data fingerprint: `sha256:2d7d82283e9825597f91fb6ed7c57b949d6408e7d460cdfc1a733a715a84c8ba`.
