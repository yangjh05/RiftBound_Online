# Storage recovery, 2026-09-18

The adaptive trainer stopped at 06:03 KST with ENOSPC in iteration 138.
Committed learner generation 528 and champion generation 452 were readable.
Iteration 138 retained its games and a valid epoch-1 checkpoint including Adam
optimizer and random state, allowing continuation through the remaining epochs.

Cleanup is limited to obsolete PPO epoch checkpoints for durably committed
iterations. Each retained final candidate archive is read and validated first.
Game archives, final candidates, plans, audit evidence, evaluation results and
the unfinished iteration's epoch checkpoint are preserved. The cleanup rejects
redirected directories and never recursively removes training directories.

`scripts/adaptive-storage-maintenance.mjs` performs the same cleanup after each
future durable candidate/state commit. Failure to clean is reported without
discarding a successful model update. No model/game logic, training targets,
configuration or engine fingerprint changes were made.

Validation artifacts are in `.tmp-ai-disk-recovery-20260918/`:

- `protected-before.json`: hashes of current state/config, learner/champion,
  unfinished epoch/plan and pending evaluation request before cleanup.
- `cleanup-files.json`: inventory of verified obsolete intermediate checkpoints.
- `epoch-cleanup.jsonl`: completed cleanup operations.
- `tests.log`: eight focused storage/archive tests passed.
- `regression.log`: 25 tests passed including resume and evaluation integrity.

Previous deployment builds were identified separately under `dist/updates`.
Automated approval review rejected their deletion, including after explicit
user confirmation. No deployment file was deleted by the agent. The user was
given the directory and instructed to preserve published build
`0.1.0-20260904185710850` while manually removing older versions.

Recovery result at 10:26 KST: 523 obsolete intermediate files removed, totaling
6,635,145,176 bytes. Approximately 12.5 GB remained free. Controller 26960 resumed
with Normal priority and the unchanged maximum of 16 compute processes.
Iteration 138 finished, its now-obsolete epoch file was automatically removed,
and iteration 139 began self-play. Evaluation 32 advanced from 233 to 249 games.
All seven protected hashes and the engine fingerprint matched before restart;
the immutable protected model/config/request files matched again afterward.
See `restart-verification.json` for the final snapshot.
