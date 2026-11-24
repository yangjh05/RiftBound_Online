import { applyDamage, currentMight, currentCombatMight } from '../engine.mjs';
import { cloneAiState } from './clone-state.mjs';
import { cards } from '../cards.mjs';
import { opponentResponseProfile } from './resource-strategy.mjs';

const CARD_BY_NUMBER = new Map(Object.values(cards).map(card => [card.cardNumber, card]));

// Public target facts, not a hand-written ranking of which unit to kill.
// A stunned body still has durability and future value; only its current
// combat damage is zero. Keep those quantities separate for the policy.
export function targetChoiceContext(game, actorId, target, specs, damage = null) {
  if (target?.type !== 'unit') return null;
  const spec = specs?.length === 1 ? specs[0] : null;
  const kind = damage ? 'damage' : spec?.kind === 'killUnit' ? 'kill'
    : spec?.kind === 'modifyMight' && Number(spec.amount) < 0 ? 'weakening'
    : ['stunUnit', 'stunEnemyHere'].includes(spec?.kind) ? 'stun'
      : ['returnBattlefieldUnitToHand', 'returnUnitToHand', 'returnUnitToBase', 'moveUnit'].includes(spec?.kind) ? 'relocation' : null;
  if (!kind) return null;
  const field = game.battlefields.find(f => f.units.some(u => u.instanceId === target.instanceId));
  const activeCombat = Boolean(field && game.showdown?.combat !== false
    && game.showdown?.battlefieldId === field.instanceId && target.combatRole);
  const contribution = unit => {
    if (!activeCombat || unit.stunned || !unit.combatRole) return 0;
    const noDamage=(unit.effects||[]).find(e=>e.timing==='static'&&e.kind==='doesNotDealCombatDamage');
    const others=field.units.filter(ally=>ally.controllerId===unit.controllerId&&ally.instanceId!==unit.instanceId);
    if(noDamage&&(!noDamage.unlessExactlyOneOtherFriendlyHere||others.length!==1))return 0;
    const might=currentCombatMight(game,field,unit,unit.combatRole);
    if(field.units.some(enemy=>enemy.controllerId!==unit.controllerId
      && enemy.effects?.some(e=>e.timing==='static'&&e.kind==='suppressWeakerEnemyCombatDamage')
      && currentCombatMight(game,field,enemy,enemy.combatRole)>might))return 0;
    return might;
  };
  const others = (field?.units || []).filter(u => u.instanceId !== target.instanceId);
  let lethal = false;
  if (kind === 'weakening') {
    const preview = cloneAiState(game), copy = publicUnit(preview, target.instanceId);
    if (copy) {
      copy.mightModifier = (Number(copy.mightModifier) || 0) + Number(spec.amount);
      // Zero Might alone does not kill a unit; use the engine's damage threshold.
      lethal = (copy.damage || 0) > 0 && copy.damage >= currentMight(preview, copy);
    }
  }
  return {
    kind, lethal, ...(kind==='weakening'?{damage:-Number(spec.amount)}:{}), fieldId: field?.instanceId || null, activeCombat,
    stunned: Boolean(target.stunned), ready: !target.exhausted,
    combatDamage: contribution(target),
    remainingBeforeHit: Math.max(0, currentMight(game, target) - (target.damage || 0)),
    otherEnemyCombatDamage: others.filter(u => u.controllerId !== actorId).reduce((n, u) => n + contribution(u), 0),
    friendlyCombatDamage: others.filter(u => u.controllerId === actorId).reduce((n, u) => n + contribution(u), 0),
    otherFriendlyHere: others.filter(u => u.controllerId === target.controllerId).length,
    enemyControlledField: Boolean(field?.controlledBy && field.controlledBy !== actorId),
    drawController: Math.max(0, Number(spec?.drawController) || 0),
    deathDraw: (target.effects || []).filter(e => e.timing === 'death' && ['draw', 'drawCards'].includes(e.kind))
      .reduce((n, e) => n + Math.max(0, Number(e.amount) || 0), 0),
    energy: Math.max(0, Number(target.energy) || 0)
  };
}

export function declarationTargetContext(game) {
  const data = game.pendingChoice?.data;
  const spec = data?.currentDeclaration?.spec;
  // Only this declaration step shares the same effect specification. Earlier
  // steps may have different damage amounts, so never merge them blindly.
  const selected = spec?.selectRepeatedTargetsOnPlay ? data.selectedForCurrentStep || [] : [];
  return { selected, maximum: Number(data?.max) || 0, spec };
}

export function publicUnit(game, id) {
  return [...game.players.flatMap(p => p.base || []), ...game.battlefields.flatMap(f => f.units || [])]
    .find(card => card.instanceId === id) || null;
}

export function damageChoiceContext(game, actorId, source, target, specs) {
  const spec = specs?.length === 1 ? specs[0] : null;
  if (!target || !source || !['dealDamageUnit', 'damageUnit'].includes(spec?.kind)
    || !Number.isFinite(spec.amount) || spec.amount < 0) return null;
  const { selected, maximum } = declarationTargetContext(game);
  const previousHits = selected.filter(id => id === target.instanceId).length;
  const preview = cloneAiState(game);
  const copy = publicUnit(preview, target.instanceId);
  if (!copy) return null;
  const caster = preview.players.find(p => p.id === actorId);
  let allocatedDamage = 0;
  for (let hit = 0; hit < previousHits; hit++) {
    allocatedDamage += applyDamage(preview, caster, source, copy, spec.amount);
  }
  const remaining = Math.max(0, currentMight(preview, copy) - (copy.damage || 0));
  // The engine applies field bonuses, prevention consumption and replacement
  // ordering. This estimate does not resolve death triggers or future responses.
  const damage = applyDamage(preview, caster, source, copy, spec.amount);
  const usefulDamage = Math.min(remaining, damage);
  return {
    damage, usefulDamage, allocatedDamage, previousHits,
    selectedCount: selected.length, remainingSelections: Math.max(0, maximum - selected.length),
    remainingBeforeHit: remaining,
    lethal: remaining > 0 && damage >= remaining,
    alreadyLethal: previousHits > 0 && remaining === 0,
    fieldId: game.battlefields.find(f => f.units.some(u => u.instanceId === target.instanceId))?.instanceId || null
  };
}

// Belief-derived features, never certainty or a prohibition. A recall can save
// material while still surrendering the scoring location; a negative Might
// modifier does not save a unit from fixed spell damage.
export function targetResponseContext(game, actorId, target, damage, options = {}) {
  const result = { protection: 0, relocation: 0, unknown: 0 };
  if (!damage || target?.controllerId === actorId) return result;
  const responses = options.responses || opponentResponseProfile(game, actorId, {}, { includeCandidates: true });
  for (const response of responses.responses || responses.topResponses) {
    if (!(response.probability > 0)) continue;
    const card = CARD_BY_NUMBER.get(response.cardNumber);
    const kinds = new Set();
    for (const spec of card?.effects || []) {
      if (spec.timing !== 'spell') continue;
      // Target ownership/location restrictions are observable. Unsupported
      // restrictions remain uncertain rather than becoming invented saves.
      if (/enemy/i.test(spec.target || '')) continue;
      if (/battlefield/i.test(spec.target || '') && !damage.fieldId) continue;
      if (spec.maxMight != null && currentMight(game, target) > spec.maxMight) continue;
      if (spec.kind === 'modifyMight') {
        // Extra Might saves against damage thresholds, not unconditional
        // killing, relocation or stun. Unsupported effects remain unknown.
        if ((!damage.kind || ['damage','weakening'].includes(damage.kind)) && Number(spec.amount) > 0
          && Number(spec.amount) > damage.damage - damage.remainingBeforeHit) kinds.add('protection');
      } else if (['returnBattlefieldUnitToHand', 'returnUnitToHand'].includes(spec.kind)) {
        kinds.add('relocation');
      } else {
        kinds.add('unknown');
      }
    }
    for (const kind of kinds) result[kind] = 1 - (1 - result[kind]) * (1 - response.probability);
  }
  return result;
}
