# Archive save recovery, 2026-09-17

The movement/target training controller exited at 2026-09-16T19:27:46Z
(04:27:46 KST) after an `EPERM` replacing `state.json.gz`. The process causing
the lock is unknown. The previous archive and completed game archives survived.

`writeTrajectoryArchive` now uses the existing bounded `renameWithRetry` helper
for EPERM/EACCES/EBUSY. It keeps the previous destination until atomic replacement
succeeds, propagates permanent errors, and removes its temporary file on failure.
Temporary filenames use UUIDs to avoid collisions between concurrent writers.
JSON serialization, gzip, typed-array representation, and reads are unchanged.

This is an I/O-only compatibility exception for one exact complete source digest.
The source comparison must show that `src/ai/neural/archive.mjs` is the only changed
fingerprinted file. Existing config, state, model and evaluation request hashes
must remain identical before restart. Policy actions, evaluation, model dimensions,
saved training targets and archive payloads are unchanged; no data is relabeled.

Verification artifacts are in `.tmp-ai-archive-recovery-20260917/`:

- `before.json`: complete source digest, per-file hashes and saved artifact hashes.
- `verification.json`: changed sources, preservation and old/new archive equality.
- `tests.log`: 21 passing tests for transient/permanent failures, preserving the
  previous file, cleanup, concurrent writes, exact compatibility, collection resume,
  evaluation integrity and PPO rollback.

Retries total 1.585 seconds over seven waits, matching the existing shared helper.
A persistent permission problem still surfaces as an error; this fix does not
claim to make storage failure impossible or silently skip a failed checkpoint.

Restart verification: controller 12808 resumed generation 400 / iteration 10 at
09:39 KST with Normal priority and the existing maximum of 16 compute processes.
At 09:40, the saved game count advanced from 27 to 32, and `state.json.gz` was
successfully replaced. The existing evaluation and detached audit also resumed.
See `restart.json` for the process snapshot. Five protected artifacts retained
their original hashes before restart; old/new archive bytes were identical.
