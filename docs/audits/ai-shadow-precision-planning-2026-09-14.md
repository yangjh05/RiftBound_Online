# Shadow evidence precision planning — 2026-09-14

The old scheduler requested enough data to reach about eight effective games
for a weak deck/seat/phase, or fixed 16/32-game precision goals. The risk gate
already used substantially more conservative game-cluster confidence bounds.
Passing the old count preflight could therefore launch another complete model
search even when the population evidence could not support its risk decisions.

## Change

`scripts/evaluator-policy-q-precision.mjs` derives planning targets from the
existing performance thresholds and the trainer's confidence constants.
Natural evidence starts from an equal-weight, zero-observed-loss reference:
85 independent/effective validation games per phase or requested weak
deck/seat/phase, and 119 overall. The decisive comparison reference is 47
effective independent games, derived from the allowed accuracy-to-lower-bound
margin and the trainer's two-sided Hoeffding radius. These are collection
planning policies, not a claim that any finite reference count certifies a
model. Measured uncertainty can raise later targets. A point estimate already
outside a performance threshold remains a model-tuning issue.

The evidence inventory now reports game-cluster effective support under the
actual inverse selection probabilities, distinct information-set counts, and
deck/seat/phase buckets. Repeated comparisons within a game do not become
independent games. The preflight checks this support before model training and
retains weak deck/seat/phase demands across collection checkpoints.

Validation deficits and new collection games have separate fields and units.
An empirical conversion uses the validation fraction and observed eligible
game yield in the existing validation corpus, including old collection
protocols. It is a historical estimate, not a promise about the new sampler.
Zero observed yield leaves the total estimate unknown and schedules a bounded
discovery batch. Overlapping demands are not summed as disjoint games.

Precision collection checkpoints contain 64–256 new Training-role games.
Worker pools remain at most 32 tasks and retain dynamic balancing up to 16
workers. Between collection checkpoints the pipeline runs a data preflight;
it skips the full architecture/learning-rate search while support is lacking.
Count-only legacy demands retain their 16–32-game behavior. Performance
thresholds, confidence estimators and protected formal evaluation are unchanged.
Grid version 10 invalidates the old readiness decision cache without changing
the model-training namespace.

## Preservation and validation

No game engine, sampler, policy, model, archived label or split membership was
changed. The exact raw source fingerprint remains
`sha256:0c917d63ded1f1cf29eaec474dc93ea7a4a32e4580995315a329292eea7c9e0c`;
the compatible collection fingerprint remains
`sha256:2d7d82283e9825597f91fb6ed7c57b949d6408e7d460cdfc1a733a715a84c8ba`.

Verification covers the production risk function at the 84/85-game boundary,
the decisive confidence-radius boundary, repeated-game counting, effective
weight deficits, deck/seat/phase gaps, explicit yield conversion, unknown
yield, model-performance deficits, and the real serialized worker handoff.
The read-only corpus check accepted 1,802 archived games, retained existing
Training/validation assignments and the learner SHA-256, and correctly
returned `modelTrainingStarted: false` with explicit remaining support.

Runtime application preserves the active parent and its exact Training-count
bridge, routes the next Shadow preflight and quota calculation to the new
planner, and caps future child pools. Running games keep their original
assignments. High priority, maximum 16 workers and no hard game deadline remain
in force. Proofs are in `.tmp-shadow-precision-20260914/`.
