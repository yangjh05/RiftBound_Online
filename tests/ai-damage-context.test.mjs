import test from 'node:test';
import assert from 'node:assert/strict';
import { cards } from '../src/cards.mjs';
import { applyAiAction, activeActorId, cloneGame } from '../src/ai/actions.mjs';
import { damageChoiceContext } from '../src/ai/damage-context.mjs';
import { enumerateAiPolicyActions } from '../src/ai/actions.mjs';
import { recommendPublicTacticalAction } from '../src/ai/tactical-baseline.mjs';
import { encodeAction, encodeState } from '../src/ai/neural/encoding.mjs';
import { tacticalActionProfile } from '../src/ai/action-tactics.mjs';
import { tacticalPosition } from './fixtures/ai-tactical-position.mjs';

function repeatedPosition() {
  const position = tacticalPosition({ enemyMight: 4 });
  const { game, actor, opponent, field } = position;
  field.effects = [{ timing: 'static', kind: 'bonusDamageToUnitsHere', amount: 1 }];
  opponent.base = [{ ...structuredClone(field.units[0]), instanceId: 'small', might: 2 }];
  actor.hand = [{ ...structuredClone(cards.fallingStar), instanceId: 'spell', ownerId: actor.id,
    controllerId: actor.id, power: [] }];
  assert.ok(applyAiAction(game, { kind: 'beginPlayCard', cardId: 'spell', destination: 'base' }, actor.id).ok);
  return position;
}

test('repeated damage encodes the allocated target and marginal damage without changing the source', () => {
  const { game } = repeatedPosition();
  const first = cloneGame(game);
  const action = { kind: 'chooseEffectOption', optionId: 'small' };
  assert.ok(applyAiAction(game, action, activeActorId(game)).ok);
  assert.notDeepEqual(encodeState(first, 'p1'), encodeState(game, 'p1'));
  assert.notDeepEqual(encodeAction(first, 'p1', action), encodeAction(game, 'p1', action));
  const before = JSON.stringify(game);
  const repeated = tacticalActionProfile(game, 'p1', { ...action });
  const lethal = tacticalActionProfile(game, 'p1', { kind: 'chooseEffectOption', optionId: 'enemy' });
  assert.equal(repeated.damageContext.allocatedDamage, 3);
  assert.equal(repeated.damageContext.usefulDamage, 0);
  assert.equal(lethal.effectAmount, 4);
  assert.equal(lethal.canRemoveEnemyNoResponse, true);
  assert.ok(repeated.targetImpact < lethal.targetImpact);
  assert.equal(JSON.stringify(game), before);
  const advice = recommendPublicTacticalAction(game, 'p1', enumerateAiPolicyActions(game, 'p1'));
  assert.equal(advice?.action.optionId, 'enemy');
  assert.equal(advice.comparison, 'damage-targets');
  assert.equal(advice.gainOverHold, null);
  const different = cloneGame(first);
  assert.ok(applyAiAction(different, { ...action, optionId: 'enemy' }, 'p1').ok);
  assert.notDeepEqual(encodeState(different, 'p1'), encodeState(game, 'p1'));
});

test('engine prevention and repeated hits remain useful when the first hit is insufficient', () => {
  const { game, actor, field } = repeatedPosition();
  const source = game.pendingChoice.card;
  const target = field.units[0];
  field.effects = [];
  target.might = 6;
  game.pendingChoice.data.selectedForCurrentStep = ['enemy'];
  const context = damageChoiceContext(game, actor.id, source, target, source.effects);
  assert.equal(context.allocatedDamage, 3);
  assert.equal(context.usefulDamage, 3);
  assert.equal(context.lethal, true);
  game.preventSpellAbilityDamageUntilTurnSequence = game.turnSequence;
  const prevented = damageChoiceContext(game, actor.id, source, target, source.effects);
  assert.equal(prevented.damage, 0);
  assert.equal(prevented.lethal, false);
});

test('damage and reaction features do not depend on the actual hidden opponent hand', () => {
  const { game, opponent } = repeatedPosition();
  const action = { kind: 'chooseEffectOption', optionId: 'enemy' };
  const other = cloneGame(game);
  opponent.hand = [structuredClone(cards.retreat)];
  other.players[1].hand = [structuredClone(cards.discipline)];
  assert.deepEqual(encodeAction(game, 'p1', action), encodeAction(other, 'p1', { ...action }));
});
