# Bounded prospective champion evaluation — 2026-09-16

## Problem and outcome

Generation 250's frozen comparison against champion 211 had reached 3,208 saved
games. Its last complete balanced look was 3,200 games, with a score of 53.0625%.
The existing neutral-candidate stop required cumulative **and** recent scores at
most 52% at two scheduled checks. Modest advantages escaped this rule, while the
global ordinal-based alpha allocation made promotion progressively harder.
Newly trained candidates waited behind a 4,000-game evaluation.

The user authorized bounded evaluation and a prospective confidence change.
Evaluation 22 is administratively closed as `budget-closed-unproven`; it is
neither a proven loss nor a promotion. Its request, games, original statistical
decision, models, and old protocols remain unchanged. A separate result binds
the administrative reason to the original request and all saved games by digest.

## New requests only

`bounded-balanced-deck-betting-evaluation-v3` is activated by an additional
immutable `bounded-evaluation-protocol.json`, after ordinal 22. Existing
reservations and historical v1/v2 plans retain their original semantics.

| Games | Champion comparison decision |
| --- | --- |
| 400 onward, every balanced deck round | Promote if sequential evidence, minimum 52% observed score, and regression guards pass; stop for statistically supported inferiority. |
| 800 | Stop as low promise if the first 400, total 800, and recent 400 scores are all at most 50%. |
| 1,200 | Stop as low promise if total and recent 400 scores are at most 52%. |
| 1,600 | Default budget ends. Extend only if total score is at least 54%, recent 400 score at least 52%, regression guards pass, and evidence is at least one quarter of the promotion threshold. |
| 2,000 | Extend again only under the same score/guard requirements and evidence at least half the promotion threshold. |
| 2,400 | Hard cap. Without a pass or inferiority crossing, conclude inconclusive. |

Evidence fractions refer to betting capital, not a probability of promotion.
Budget stops never assert inferiority. An already crossed promotion/inferiority
boundary takes precedence over resource stops. Replay always returns the first
stopping decision; later observations cannot erase that decision.

Four champion comparisons are followed by one fixed-baseline progress check.
Baseline checks are capped at 800 games and cannot promote a champion. Every
new reservation captures the latest completed pending candidate, then remains
immutable through crashes. The first new request is a champion comparison.

## Statistical guarantee and tradeoff

The betting mixture, independent eight-game seed blocks, and balanced five-deck
looks are unchanged. Mirrored games are not counted as independent observations.
The first decision requires 400 games (ten seed blocks per deck for this run).
Each deck and each candidate seat must still meet the observed 40% regression
floor. These guardrails are observed-score filters, not per-deck confidence
claims. The existing candidate-seat guard is preserved; both initiative choices
remain balanced in the eight-game schedule.

New comparisons fix two-sided alpha at 0.02: 0.01 per direction, promotion
capital threshold 100, and a 98% two-sided anytime confidence sequence. Subject
to the existing independent-block and frozen-model assumptions, false promotion
probability for each precommitted comparison is at most 1%, even with repeated
looks and these resource stops. This does **not** mean a passed candidate has a
99% posterior probability of superiority.

This replaces the old lifetime family-wise budget of `0.05 / (n*(n+1))` for
future requests only. There is no longer a 5% bound on the chance of **any**
false promotion across all future candidates. More comparisons can accumulate
false promotions. The code and result explicitly label the scope
`per-comparison-anytime-two-sided-not-familywise`.

The mathematical basis is the same nonnegative betting-process / Ville
inequality construction used in v2; see
[Waudby-Smith and Ramdas, Estimating means of bounded random variables by betting](https://doi.org/10.1093/jrsssb/qkad009)
and the existing `ai-sequential-evaluation-2026-09-15.md` proof for balanced deck
rounds. The budget cutoffs and extension criteria are engineering allocations,
not claims that their numerical choices optimize statistical power.

## Preservation and validation

- Controller completed iteration 139 before stopping. Latest learner and
  champion weights are unchanged by this rollout.
- SHA-256 verified 3,217 files across activation, including all 3,208 game files,
  the old request, models, state, configuration, and old protocol files.
- Canonical and raw engine fingerprints are unchanged. No training trajectories
  are relabeled or discarded. The change concerns evaluation scheduling only.
- 45 focused tests pass: existing sequential contracts, balanced blocks,
  adaptive evidence/integrity, frozen plans, new budget branches, regression
  guards, growth scheduling, reservation crash recovery, result forgery checks,
  immutable rollout hashes, and exact-prefix replay.
- Directly restarting the closed production evaluation returns its verified
  result without scheduling more games or loading either model.
- Activation and preservation records:
  `.tmp-ai-bounded-evaluation-20260916/activation.json`,
  `preserved-before-resume.json`, `tests.log`, `closed-worker-restart.log`.
- Resumed controller PID 25296 at High priority. At 17:17 KST, evaluation 23
  had completed eight games of generation **327 vs champion 211**, with the new
  frozen v3 plan, alpha 0.02, ordinary budget 1,600 and hard cap 2,400. Training
  iteration 140 was independently collecting games. All 16 training processes
  were High priority and adaptive balancing remained enabled.
- Post-resume verification rechecked all 3,216 immutable files (the live state
  file is expected to advance), both engine fingerprints, the new request and
  rollout digests, and the old closure. See `resume-verification.json` and
  `processes.json` in the same artifact directory.

Compared with the old 4,000-game cap, the default 1,600-game budget is 60% lower;
even an extended comparison is capped 40% lower at 2,400. These are budget
reductions, not measured speed or learning-strength improvements. Small real
advantages may deliberately go unproven so newer candidates can be tested.
