# Riftbound Core Rules (2026-03-30) Audit Notes

Source: [official Core Rules PDF](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861747d1d4d505b7c14d73aba9749d1c3a209a67.pdf), published through the [official Rules Hub](https://playriftbound.com/en-us/rules-hub/).

This project treats the official 2026-03-30 Core Rules as the primary authority when adding cards or rule-engine behavior. Card text still wins over general rules where the official rules say it does.

Timing override: the [2026-07-16 Core Rules](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/e9ac8e3d33e0f78cef296f5945aba7bc1313b086.pdf) supersede the earlier permanent Finalize timing. Under rules 337.1.a and 337.2, Finalize does not pass Priority and a Unit, Gear, or Add resource ability resolves immediately after Finalize. Under rule 383.4.a.2, a Permanent's Play Effect is put on the Chain as a separate Pending Item only after the Permanent finalizes and enters the Board.

Hidden timing clarification (2026-10-14): the [2026-10-09 Core Rules](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf), 811.1.b, 811.6 and 813.2, grant Reaction from the turn after hiding. Revealing is legal at ordinary Reaction opportunities, including an action chain outside combat and another battlefield's Showdown. The same-turn prohibition, controller's Priority, Hidden destination/target restrictions (811.1.d), reveal prohibitions and additional costs still apply. The Reaction characteristic is present while facedown or on the Chain, including during payment, but does not persist on a permanent on the Board. Mystic Vortex's Reaction cost increase applies to cards, including Hidden units, while spell-only modifiers remain limited to spells. `tests/hidden-reaction-timing.test.mjs` checks these boundaries, including Hidden Blade responding to Hextech Ray, a hidden unit's local play-effect targets, additional Reaction/Deflect costs and payment cancellation restoring the previous Chain. These focused tests do not certify the entire Hidden keyword workstream.

## Verification Record and Completion Gate

The machine-validated source of truth for progress is [`spec/rules/verification-ledger-2026-03-30.json`](../spec/rules/verification-ledger-2026-03-30.json). `npm run validate:rules` rejects stale rule IDs, missing evidence tests, stale implementation anchors, missing or duplicate workstream assignments, stale inventory counts, and an AI-training gate opened while work remains.

The active 300-324 audit is expanded in [`spec/rules/workstreams/turn-tasks-and-cleanup-2026-03-30.json`](../spec/rules/workstreams/turn-tasks-and-cleanup-2026-03-30.json). Its 98 official leaf clauses must each belong to exactly one verified, partial, or unverified case; the validator rejects omissions and overlaps.

The active 325-406 Chain, card-play, and ability audit is expanded in [`spec/rules/workstreams/chains-and-showdowns-2026-03-30.json`](../spec/rules/workstreams/chains-and-showdowns-2026-03-30.json). All 285 official leaf clauses are assigned exactly once. Rules 325-354 are verified, including Pending-to-Finalized conversion, HOT/FEPR Task re-entry, Execute/Pass/Resolve, Focus, Cleanup-before-Combat/Conquer Showdown exit, card/token Played lifecycles, and effect-created play deferral. Rules 355-406 remain explicitly recorded in nine partial cases until their targeting, cost, resolution, passive/replacement, triggered, delayed/linked, and ability-play boundaries gain leaf-complete evidence.

Inventory coverage and behavioral verification are deliberately different:

- The official catalog contains 2,085 clauses and 1,421 leaf clauses.
- 1,383 leaf clauses are currently classified as applicable to the two-player game. All 1,383 are assigned to exactly one of 45 inventory families.
- Family assignment only proves that no official leaf was lost during classification. It does **not** prove that the engine implements that leaf correctly.
- Twenty-one narrow milestones currently have explicit executable evidence and implementation anchors. The latest milestone proves that Showdown exit Cleanup precedes Combat and Conquer settlement, so lethally damaged units cannot fight or score first; the ledger also records HOT/FEPR re-entry, Showdown opening/Focus, both players' Execute windows, the reviewed timing-exception registry, shared two-player Pass cycles, immediate Finalize, one-Chain placement, ordered turn tasks, and cleanup staging.
- All seven broad two-player workstreams remain `partial`. The 38 other-mode leaves remain `unverified` until those modes are implemented or the product scope explicitly excludes them.
- `completionGate.readyForAiTraining` remains `false`. AI training and its GitHub Actions workflow must not run until every required workstream reaches `verified` and the full project gate passes.

The work order is recorded in the ledger rather than selected ad hoc. Current priority-0 workstreams are:

1. Turn tasks and cleanup (rules 300-324). Ordered Start/Ending tasks and the main staged-event boundaries now have executable evidence; the remaining exact leaves are listed in the ledger.
2. Chains, Showdowns, card play, and triggers (rules 325-406), including a complete Focus/Priority state-machine oracle.
3. Combat, scoring, layers, and ending (rules 454-481 and 649-652), including simultaneous combat damage and layer dependencies.

Priority-1 work covers core zone/movement actions and every keyword boundary; priority-2 covers interpretation/deck/setup and the remaining object/zone/resource/control rules. Each workstream can become `verified` only when every applicable leaf has an explicit structural or executable disposition and every state-changing boundary has negative detection evidence.

## Implemented Evidence (Not Full-Workstream Verification)

- Setup and turn order: first player is determined before play and turn order follows that player.
- Chosen Champion zone: the chosen champion now explicitly starts in the Champion Zone, is marked as used when played from that zone, and cannot be played from the Champion Zone a second time. The UI keeps a locked Champion Zone slot visible after deployment.
- Chosen Champion identity: same-name champion unit copies in the deck, hand, trash, or board now have an engine-level `isChosenChampion` check, matching rule 103.2.a.3.
- Mulligan: players choose up to 2 cards, draw that many first, then recycle the set-aside cards to the bottom of the Main Deck. Simultaneous Main Deck recycle uses random bottom order.
- Hidden timing: a hidden card cannot be played on the same turn it was hidden. Beginning on the next turn, it may be played whenever Reaction is legal, including outside a Showdown or during another battlefield's Showdown.
- Hidden targeting: a spell played from Hidden restricts chosen unit targets to the battlefield where it was hidden.
- Hidden cleanup: hidden cards at battlefields no longer controlled by their owner are removed during cleanup and placed into their owner's trash.
- Target declaration timing: interactive target-required spells now declare supported unit/card targets before payment, then carry the declared target through resolution without asking for the same target again.
- Declared target legality: if a declared target is no longer among the legal choices at resolution, the engine no longer retargets; that declared-target portion fails.
- Move declaration timing: move spells now declare both the moving unit and required destination before payment/finalizing the chain item, then reuse those declarations at resolution.
- Hidden declaration timing: targeted spells revealed from Hidden enter the current Chain as Pending, then declare their targets before payment and Finalize.
- On-play trigger declaration: targeted "When you play me" abilities now ask for any required or optional target before the triggered ability finalizes. If the declared target is no longer legal at resolution, that targeted portion fails instead of prompting for a replacement target.
- Other targeted trigger declaration: Frigid Jewel's second-draw trigger and Abandoned Hall's spell-play battlefield trigger now declare their target as the trigger is put onto the queue. Multiple simultaneous targeted triggers gather their declarations first, then resolve from the prepared queue.
- Chain target declaration: counter spells such as Hard Bargain now declare the targeted spell on the showdown chain before payment, matching the spell play sequence for target choices.
- Alpha Strike declaration: Alpha Strike now declares its friendly unit before payment, then reuses that declared unit when the spell resolves and asks for damage allocation.
- Deflect timing: if the declared target is an opposing Deflect unit, Deflect is included as mandatory additional Power during that same payment.
- Attachment zone changes: when a top-most unit leaves the board, attached Gear detaches and returns to its controller's base instead of being trashed; Gear directly killed by an effect still goes to trash.
- Gear recall cleanup: attached Gear on a battlefield unit now follows the official detach/recall behavior when that unit leaves the board.
- State cleanup loop: lethal units, battlefield control updates, and invalid Hidden cards are processed repeatedly until stable, with a safety limit. Rule 187.4.c now has a focused regression proving that an absent controller loses control without automatically awarding the Battlefield to a remaining occupant.
- Combat damage assignment: interactive games now ask players to assign combat damage, and Tank units must receive lethal damage before non-Tank units can be chosen.
- Combat designations: units now explicitly gain temporary `attacker` or `defender` combat roles when a combat showdown opens or an active non-combat showdown becomes combat, and those roles are cleared when combat ends or the unit leaves the board.
- Standard move batching: a player can now move multiple ready units to the same destination as one Standard Move. The shared destination is checked against each unit's legal movement, all moved units exhaust, and only one resulting non-combat showdown or combat showdown opens.
- Staged event ordering: staged showdowns and combats now use an engine-level staged event queue. If more than one staged event is waiting, the turn player receives a UI choice for which battlefield to resolve first.
- Chain item states: cards and abilities enter as `pending`, complete choices/costs/legality through outstanding Tasks, then become `finalized`. Finalization itself does not pass Priority. Units, Gear, and Add resource abilities resolve immediately after Finalize without an Execute/Pass response window; other finalized Items proceed to that window.
- Permanent Play Effect timing: after a Unit or Gear enters the Board through its immediate resolution, each Play Effect is put on the Chain as a separate Pending trigger. Reactions can respond to that trigger, but not between the Permanent's Finalize and entry.
- Trigger item states: triggered abilities in the shared trigger queue now also enter as `pending` items and become `finalized` immediately before resolving. This gives triggers the same state vocabulary as played showdown chain cards.
- Initial Chain triggers: attack/defend triggers, showdown-begins triggers, and defend-here battlefield triggers now enter the active showdown chain as trigger items. They require the same all-player pass window before resolving, so Reaction cards can respond before those triggered abilities resolve.
- Non-combat showdowns: a standard move to an empty non-controlled battlefield now opens a stand-alone non-combat showdown before conquest; if an opposing unit enters during that showdown, it becomes a combat showdown.
- Combat showdowns: moving into an enemy-occupied battlefield, or effect movement that creates opposing units outside an active non-combat showdown, opens a combat showdown and proceeds to combat damage only after the showdown closes.
- Showdown conquest settlement: after a showdown, battlefield control and conquest scoring are rechecked from the final units remaining there, including cases where chain effects move units away before combat.
- Effect movement conquest settlement: spell/effect movement that leaves a non-showdown battlefield occupied by only one player's units now checks conquest immediately.
- Per-turn battlefield scoring: a player can only score each battlefield once per turn; repeated hold/conquer events for the same battlefield in that turn do not add another point.
- Trigger queue: spell-play battlefield triggers now queue only after the original spell successfully resolves, and countered spells produce none.
- Shared trigger queue foundation: spell-play triggers now use the engine-level trigger queue only after the original spell completes successfully, instead of carrying ad hoc trigger lists inside individual choices.
- Deathknell trigger queue: Lonely Poro and Scuttle Crab death effects now enqueue through the shared trigger queue, including cases where a draw-created choice pauses and later resumes the remaining Deathknell triggers.
- Cleanup Deathknell timing: Deathknell abilities created by state cleanup are now queued during cleanup and resolve only after cleanup finishes, so hidden-card removal and board-state cleanup complete before any Deathknell-created UI choice resolves.
- Scoring trigger queue: Hunt/score XP, hold draw effects, and conquer-here delayed battlefield effects now enqueue through the shared trigger queue.
- Attack/defend trigger queue: attack-or-defend effects such as Kha'Zix now enqueue through the shared trigger queue before the showdown proceeds.
- Showdown battlefield trigger queue: showdown-begins effects such as Diana, Lunari and defend-here battlefield effects such as Ravenbloom Conservatory now enqueue through the shared queue, including payment choices that pause and resume queued triggers.
- Beginning/end delayed trigger queue: The Arena's Greatest first-Beginning point and Targon's Peak delayed end-turn rune readying now resolve through the shared queue.
- Replacement effects: Zhonya's Hourglass death replacement now routes through a replacement resolver with shared effect marking/logging, while still resolving immediately because replacement effects must modify the event before a death occurs.
- Rune pool: players now track an explicit rune pool for generated Energy/Power during payment. Generated Energy is a click-selectable pool resource with source, domain colors, and timing restrictions; it cannot be selected for Power costs. If an effect asks a player to pay Energy while generated Energy is available, the payment UI now opens instead of auto-consuming that generated Energy.
- Card coverage: all currently registered card effect branches now have direct engine tests, including Disarming Rake, En Garde, Whiteflame Protector, and Rebuke.

## Remaining Work Is Tracked by Rule ID

Do not add informal “remaining gap” bullets here. Update the verification ledger with the affected official family IDs, current evidence, exact remaining behavior, and exit criteria. A behavior may move into `verifiedMilestones` only when its named tests and implementation anchors pass ledger validation. A broad workstream remains `partial` until all of its official leaves satisfy its exit criteria.

## Card Implementation Checklist

- Confirm timing: Action, Reaction, Open/Closed state, Showdown state, Focus/Priority.
- Confirm costs: base cost, additional costs, optional additional costs, discounts, Deflect, and whether the card adds resources.
- Confirm targets before payment where the official process requires target declaration before costs.
- Confirm Hidden restrictions if the card has Hidden or can be played from Hidden.
- Confirm whether effects create chain items, delayed triggers, replacement effects, or immediate actions.
- For triggered abilities, declare use/targets/required destinations as the trigger is put onto the queue or chain; never defer target selection to resolution.
- Confirm zone changes clear temporary modifications when moving to or from non-board zones.
- Add or update an engine test for every new card effect branch, including "no legal target" and declined optional choices.
