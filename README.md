# Riftbound Online

Riftbound hotseat desktop/browser implementation for the currently registered Origins-era card pool and the two included deck seats.

## Current Scope

- Two-player duel mode
- Menu screen, game start, and persistent local deck editor
- Card-number based decklists and card registry
- Starting first-player confirmation, champion selection, battlefield selection, mulligan, and turn flow
- Manual rune payment for Energy and Power
- Showdown chain with Focus/pass handling and last-in-first-out resolution
- Target declaration at activation time for cards and triggered abilities
- Combat and non-combat showdown handling
- Conquest/hold scoring and 1-8-1 score rail
- Unit, spell, gear, attachment, Hidden, Deflect, Deathknell, Ambush, Ganking, Shield, Tank, Temporary, Vision-style interactions covered by registered effects
- Card images in card-selection UI, board tokens, card inspector, graveyard/intel reveal UI
- Central effect registry and resolver validation for adding new cards
- Recurrent PPO self-play AI with collision-free card embeddings, public-information observations, Bayesian opponent-deck belief and learned mulligans
- Native TensorFlow training, historical-champion league self-play and calibrated neural rollouts
- Evolving card-package, rune, battlefield and meta-weighted Sideboard populations with best-of-three match learning
- AI opponent mode and counterfactual coaching review for deck, mulligan, play and matchup-plan mistakes
- Release-pack card-pool filters and card-pool-scoped AI deck/Sideboard recommendations

## Run

Desktop app:

```powershell
npm run desktop:setup
npm run desktop
```

The setup command installs the Electron runtime into `.desktop_runtime`. Run it once per machine, then use `npm run desktop`.

Browser dev server:

```powershell
npm start
```

Open:

```text
http://127.0.0.1:4173
```

## Publish a Desktop Update

Build and publish a new Windows portable app, then restart the game server and
public tunnel with:

```powershell
npm run restart
```

The server is restarted only after the build succeeds. The command creates
`dist/Riftbound Online.exe`, stores an immutable copy under
`dist/updates/<buildId>/`, publishes `dist/update.json`, and then restarts the
server. Packaged apps check the server automatically after launch, download a
newer build in the background, verify its SHA-256 checksum, and offer to restart
into the update.

To publish an update without restarting the server, use `npm run publish:update`.

The first updater-enabled EXE must be distributed manually once. Every later
build can update that app automatically while the server and its public tunnel
are available. For local testing, override the update server for one launch:

```powershell
$env:RIFTBOUND_UPDATE_URL = "http://127.0.0.1:4173"
```

## Validate

Run the full project check before adding or changing cards:

```powershell
npm run check
```

This runs:

- `npm run validate:cards`: card data, card numbers, decklists, and registered effect specs
- `npm run validate:engine`: resolver coverage and engine structure checks
- `npm test`: gameplay and rules regression tests

## Train the AI

```powershell
npm run ai:neural:smoke
npm run ai:bootstrap -- --games 256 --workers 4 --epochs 5 --batch-size 8 --max-actions 800 --card-pool origins-era --output src/ai/checkpoints/neural-champion.json
npm run ai:bootstrap:logged -- --games 256 --workers 4 --epochs 5 --max-actions 800 --card-pool origins-era
npm run ai:bootstrap:apply -- --input "C:\Downloads\origins-ai-bootstrap-artifact"
npm run ai:neural:train -- --games 256 --evaluation-games 80 --workers 4 --epochs 4 --seed 20260714
npm run ai:continuous
npm run ai:meta:import -- --input data/meta-snapshot.json --source "ranked-season"
npm run ai:collect:shard -- --shard-index 0 --shard-count 4 --games 64 --card-pool origins-era
```

The older linear trainer remains available as a regression baseline:

```powershell
npm run ai:train:quick
npm run ai:train -- --games 1000 --evaluation-games 100 --seed 20260714
```

See [docs/ai-training.md](docs/ai-training.md) for recurrent PPO, checkpoint promotion, deck evolution, hidden-information rules and the coaching report.

## Add a Card

Use the scaffold script:

```powershell
npm run new:card -- --name "Example Spell" --number "OGN-001/298" --type spell --set Origins --rarity Common --domain Calm --energy 1 --power Any:1 --text "Exact card text" --timing spell --kind moveUnit
```

Then fill exact card data, image URL, effect specs, and focused tests.
See [docs/card-authoring.md](docs/card-authoring.md) and [docs/card-effect-framework.md](docs/card-effect-framework.md).

## Bulk Import

Use the standard JSON import pipeline for large card drops:

```powershell
npm run export:cards -- --output tmp/card-export.json
npm run import:cards -- --input data/cards.json --dry-run
npm run import:cards -- --input data/cards.json
npm run audit:effects -- --output tmp/effect-audit.json
npm run check
```

See [docs/bulk-card-import.md](docs/bulk-card-import.md).

## Key Files

- `src/cards/*.mjs`: one card per file
- `src/cards.mjs`: card registry and default raw decklists
- `src/effects/registry.mjs`: supported effect timing/kind declarations
- `src/effects/runtime.mjs`: timing-aware effect lookup helpers
- `src/engine.mjs`: game rules and effect resolvers
- `src/engine/setup.mjs`: deck instantiation, seat names, and starting champion setup
- `src/ai/neural/`: fixed encodings, recurrent policy/value/belief model, parallel self-play and PPO trainer
- `src/ai/belief.mjs`: public-information opponent-deck inference and matchup plans
- `src/ai/rollout.mjs`: belief-consistent counterfactual coaching rollouts
- `src/decks/rules.mjs`: deck construction rules shared by UI and validation
- `src/app.mjs`: UI and deck editor
- `scripts/import-cards.mjs`: batch card importer
- `scripts/export-card-data.mjs`: current card pool exporter
- `scripts/audit-effects.mjs`: effect coverage report
- `tests/engine.test.mjs`: rules regression tests
