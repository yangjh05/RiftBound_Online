# Card Effect Framework

This project treats card data as declarative input and engine behavior as registered effect support.
When adding cards, do not encode one-off behavior directly in a card file.

## Core Files

- `src/cards/<cardName>.mjs`: exact card data, text, costs, keywords, and effect specs.
- `src/effects/registry.mjs`: the supported timing/kind registry, valid source card types, target provider, and target declaration metadata.
- `src/effects/runtime.mjs`: timing-aware runtime helpers for reading static, replacement, and other effect specs.
- `src/engine.mjs`: concrete resolver implementation for registered effects.
- `src/engine/setup.mjs`: player/deck instantiation and starting champion extraction.
- `scripts/validate-cards.mjs`: structural validation for every registered card.
- `scripts/validate-engine-effects.mjs`: resolver coverage validation for registered engine effects.
- `tests/engine.test.mjs`: behavior tests for rule and card interactions.

## Adding a Card With an Existing Effect

1. Create the card with `npm run new:card -- --name "..." --number "..." --type ...`.
2. Add exact text, image, costs, tags, keywords, and `effects`.
3. Run `npm run check`.
4. Add or update a focused engine test if the card creates a meaningful interaction.

## Adding a New Effect Kind

1. Add the timing/kind to `src/effects/registry.mjs`.
2. Pick a `targetProvider` if the effect chooses something.
3. If a spell target must be declared before payment/chain finalization, add a `SPELL_TARGET_DECLARATIONS` entry.
4. Implement the concrete resolver in `src/engine.mjs`.
   - Immediate spell/on-play/activated effects go through `EFFECT_RESOLVERS`.
   - Queued triggered effects go through `TRIGGER_RESOLVERS`.
5. Add tests for:
   - legal use,
   - illegal use,
   - target declaration timing,
   - resolution when the target becomes illegal before resolving,
   - relevant showdown/trigger/priority behavior.
6. Run `npm run validate:cards` and `npm test`.

## Deck Construction Rules

Deck construction rules live in `src/decks/rules.mjs`.
The menu deck editor, card validation script, and tests use the same constants and validation function:

- main deck: at least 40 cards,
- rune deck: exactly 12 runes,
- battlefields: exactly 3,
- main-deck copy limit: 3 per card number,
- at least one champion card must exist in the main deck for starting champion selection.

Cards and decklists must reference cards by `cardNumber`/`collectorNumber`, not display name.

## Target Timing Rule

Targets and required move destinations are declared when the card or ability is put into the payment/chain flow.
The target is visible before reactions.
At resolution, the engine re-checks whether the declared target still satisfies the effect restriction.

## Validation Contract

`validate-cards` rejects:

- unknown timing/kind pairs,
- effects attached to invalid card types,
- invalid domains or malformed power requirements,
- malformed numeric effect fields,
- duplicate card numbers,
- missing card images for non-rune cards,
- decklists that reference unknown card numbers.

`validate-engine` rejects:

- registered `activated`, `onPlay`, or `spell` effects without an `EFFECT_RESOLVERS` entry,
- resolver entries not registered in `src/effects/registry.mjs`,
- legacy `choice.effect === ...` branching,
- timing-less `cardHasEffect(kind)` lookup.

This means a future card should not enter the card pool until its effect is either already supported or explicitly registered and tested.
