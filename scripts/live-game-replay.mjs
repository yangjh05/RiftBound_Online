import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyResolvedGameCommand } from "../server/commands.mjs";
import { activeActorId, applyAiAction } from "../src/ai/actions.mjs";
import { choosePaymentPlan } from "../src/ai/payment-planner.mjs";
import { currentMight } from "../src/engine.mjs";
import {resolveRecordedPaymentCommand} from '../src/ai/replay-command.mjs';

export const liveDigest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Compare semantic checkpoints, excluding wall-clock/generated request IDs.
// A mismatch is quarantined; never label an approximately reconstructed game.
export function replayPosition(game) {
  const card = c => c && ({ id: c.instanceId, number: c.cardNumber, owner: c.ownerId,
    controller: c.controllerId, ready: !c.exhausted, damage: c.damage || 0,
    might: c.type === "unit" ? currentMight(game, c) : null,
    buffs: c.buffs || 0, stunned: !!c.stunned, attachments: (c.attachments || []).map(card) });
  return {
    phase: game.phase, turn: game.turnNumber, sequence: game.turnSequence,
    current: game.currentPlayerId, actor: activeActorId(game), winner: game.winnerId || null,
    random: game.deterministicRandomState, playerRandom: game.deterministicPlayerRandomStates,
    players: game.players.map(p => ({ id: p.id, score: p.score, played: p.cardsPlayedThisTurn,
      championPlayed: p.championPlayed, legend: card(p.legend),
      zones: Object.fromEntries(["hand", "base", "runes", "mainDeck", "runeDeck", "trash", "banished"]
        .map(zone => [zone, (p[zone] || []).map(card)])),
      pools: { energy: (p.runePool?.energy || []).map(x => [x.sourceCardId, x.restriction]),
        power: (p.runePool?.power || []).map(x => [x.sourceCardId, x.domain, x.restriction]) } })),
    fields: game.battlefields.map(f => ({ id: f.instanceId, control: f.controlledBy,
      units: f.units.map(card), hidden: (f.hidden || []).map(h => ({ owner: h.ownerId, card: card(h.card) })) })),
    choice: game.pendingChoice && { player: game.pendingChoice.playerId, effect: game.pendingChoice.effect,
      options: game.pendingChoice.options?.map(o => ({ id: o.id, disabled: !!o.disabled })) },
    payment: game.pendingPayment && { player: game.pendingPayment.playerId, card: game.pendingPayment.cardId,
      energy: game.pendingPayment.energyCost, power: game.pendingPayment.powerCost },
    chains: [game.showdown, game.actionChain].map(c => c && ({ player: c.priorityPlayerId,
      passes: c.consecutivePasses, field: c.battlefieldId,
      cards: c.chain?.map(i => ({ player: i.playerId, status: i.status, card: card(i.card) })) }))
  };
}

export function replaySubmittedGame(report, { model, onDecision = () => {} } = {}) {
  const log = report?.log;
  assert.equal(log?.metadata?.mode, "ai", "Only submitted AI games belong in this curriculum.");
  assert.ok(log.logId && log.initialState?.state && log.latestState?.state, "Missing replay boundaries.");
  assert.equal(log.droppedCommands || 0, 0, "Incomplete command history.");
  assert.ok(log.commands?.length && log.commands.length <= 20000, "Invalid command count.");
  assert.equal(log.latestState.state.phase, "complete", "Unfinished games are review-only.");
  assert.ok(log.latestState.state.winnerId, "A natural game result is required.");
  const game = structuredClone(log.initialState.state);
  assert.ok(!game.players.some(p => p.champion?.zone === "played"), "Replay must start before a champion enters play.");
  const frames = new Map((log.frames || []).filter(f => f.label === "command").map(f => [f.commandSequence, f.state]));
  const checkpoints = [], rejectedNoStateChange = [];
  for (const [index, entry] of log.commands.entries()) {
    assert.equal(entry.sequence, index + 1, "Command sequence has gaps.");
    const rejected = entry.status === 'rejected' && entry.result?.ok !== true;
    assert.ok(rejected || entry.result?.ok === true, "Failed commands require manual review.");
    const before = rejected ? replayPosition(game) : null;
    const actor = entry.context?.actorId;
    assert.equal(actor, activeActorId(game), `Actor mismatch at ${entry.sequence}`);
    if (entry.context.ai && !rejected) onDecision(game, entry);
    const command = structuredClone(entry.command);
    if(command.kind==='chooseEffectOption' && game.pendingChoice?.effect==='triggerOrder'
      && !game.pendingChoice.options.some(o=>o.id===command.optionId)) {
      const descriptor=entry.context?.choiceOption || log.events?.find(event=>event.type==='command-attempt'
        && event.detail?.attemptId===entry.context?.attemptId)?.detail?.choiceOption;
      assert.ok(descriptor?.cardId && descriptor?.effectKind,'Missing stable trigger identity; manual review required.');
      const matches=game.pendingChoice.options.filter(o=>o.cardId===descriptor.cardId && o.effectKind===descriptor.effectKind);
      assert.equal(matches.length,1,'Ambiguous stable trigger identity.');
      command.optionId=matches[0].id;
    }
    let result;
    if (command.kind === "aiResolvePlannedPayment") {
      assert.ok(entry.result?.appliedActions || model, "A pinned payment model is required for legacy abstract payment commands.");
      const actions = entry.result?.appliedActions || choosePaymentPlan(game, { model })?.actions || [{ kind: "cancelPayment" }];
      let applied = 0;
      for (const recorded of actions) {
        const action=resolveRecordedPaymentCommand(game,actor,recorded);
        result = applyAiAction(game, action, actor);
        assert.ok(result?.ok, `Payment failed at ${entry.sequence}`);
        applied++;
        if (action.kind === "cancelPayment" || (action.kind === "activateCard" && game.pendingPayment)) break;
      }
      assert.equal(applied, entry.result.actionsApplied, `Payment diverged at ${entry.sequence}`);
    } else {
      const resourceIdentity=entry.context?.resourceIdentity || log.events?.find(event=>event.type==='command-attempt'
        && event.detail?.attemptId===entry.context?.attemptId)?.detail?.resourceIdentity;
      const resolved=resolveRecordedPaymentCommand(game,actor,{...command,
        ...(resourceIdentity?{resourceIdentity}:{})});
      result = entry.context.ai ? applyAiAction(game, resolved, actor)
        : applyResolvedGameCommand({ game }, actor, resolved);
    }
    if (rejected) {
      assert.equal(result?.ok,false,`Previously rejected command succeeded at ${entry.sequence}`);
      assert.deepEqual(replayPosition(game),before,`Rejected command changed state at ${entry.sequence}`);
      rejectedNoStateChange.push(entry.sequence);
    } else assert.ok(result?.ok, `Replay failed at ${entry.sequence}: ${result?.message}`);
    if (frames.has(entry.sequence)) {
      assert.deepEqual(replayPosition(game), replayPosition(frames.get(entry.sequence)), `Checkpoint diverged at ${entry.sequence}`);
      checkpoints.push(entry.sequence);
    }
  }
  assert.deepEqual(replayPosition(game), replayPosition(log.latestState.state), "Final position diverged.");
  assert.ok(checkpoints.length, "No retained command checkpoints to verify.");
  assert.equal(game.decisionSafety?.violations?.length || 0, 0, "Decision-safety violations require manual review.");
  return { game, validation: { contract: "full-commands-semantic-checkpoints-v1",
    commands: log.commands.length, checkpoints, rejectedNoStateChange, finalMatched: true,
    sourceBuildId: log.metadata.build?.buildId || null, paymentModelHash: liveDigest(model || null) } };
}
