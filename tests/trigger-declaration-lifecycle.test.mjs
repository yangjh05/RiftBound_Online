import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {createGame, confirmFirstPlayer, selectChampion, selectBattlefield, skipMulligan,
  currentPlayer, playCard, chooseEffectOption, endTurn, passShowdown, moveUnit} from '../src/engine.mjs';

function fixture({doubleVision = false, showdown = false} = {}) {
  const game = createGame({interactive: true});
  game.setupRandomValues = game.players.map(() => 0);
  if (game.phase === 'first-player') confirmFirstPlayer(game);
  while (game.phase === 'champion-select') {
    const p = game.players.find(p => p.id === game.championSelectPlayerId);
    selectChampion(game, p.id, p.availableChampions[0].instanceId);
  }
  while (game.phase === 'battlefield-select') {
    const p = game.players.find(p => p.id === game.setupPlayerId);
    selectBattlefield(game, p.id, p.availableBattlefields[0].instanceId);
  }
  while (game.phase === 'mulligan') skipMulligan(game);
  const player = currentPlayer(game);
  const unit = {...structuredClone(cards.mysticPoro), instanceId: 'declining-vision',
    ownerId: player.id, controllerId: player.id, energy: 0, power: [], effects: [],
    exhausted: false, damage: 0, buffs: 0, mightModifier: 0, attachments: []};
  player.hand = [unit];
  player.base = [];
  player.mainDeck = ['top','middle','bottom'].map(id => ({...structuredClone(cards.lonelyPoro),
    instanceId: id, ownerId: player.id, controllerId: player.id}));
  if (doubleVision) player.base.push({...structuredClone(cards.gemcraftSeer), instanceId: 'seer',
    ownerId: player.id, controllerId: player.id, exhausted: false, damage: 0});
  if (showdown) {
    const field = game.battlefields[0], opponent = game.players.find(p => p.id !== player.id);
    const attacker = {...structuredClone(unit), instanceId: 'attacker', keywords: [], effects: []};
    const defender = {...structuredClone(attacker), instanceId: 'defender', ownerId: opponent.id, controllerId: opponent.id};
    field.effects = []; field.units = [defender]; field.controlledBy = opponent.id;
    player.base.push(attacker);
    assert.equal(moveUnit(game, attacker.instanceId, field.instanceId).ok, true);
    assert.equal(game.phase, 'showdown');
    unit.keywords.push('Reaction');
  }
  assert.equal(playCard(game, unit.instanceId, 'base').ok, true);
  return {game, player};
}

test('declining a pending Vision declaration removes it permanently and resumes the turn', () => {
  const {game, player} = fixture();
  assert.equal(game.pendingChoice?.data?.declareTrigger, true);
  assert.ok(game.pendingChoice.options.some(o => o.id === 'decline'));
  const declined = game.pendingChoice.data.trigger;
  assert.equal(game.actionChain.chain.length, 1);
  assert.equal(chooseEffectOption(game, 'decline').ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(declined.declined, true);
  assert.equal(declined.pendingChainItemId, undefined);
  assert.ok(!game.actionChain, 'an empty chain must close instead of retaining a pending ghost');
  assert.deepEqual(player.mainDeck.map(c => c.instanceId), ['top','middle','bottom']);
  assert.equal(endTurn(game).ok, true);
});

test('accepting Vision still finalizes and resolves its prediction once', () => {
  const {game, player} = fixture();
  assert.equal(chooseEffectOption(game, 'use-trigger').ok, true);
  for (let i=0; i<4 && !game.pendingChoice; i++) assert.equal(passShowdown(game).ok, true);
  assert.ok(game.pendingChoice, 'accepted prediction opens a real resolution choice');
  assert.ok(!game.actionChain?.chain.some(item => item.status === 'pending'));
  assert.deepEqual(player.mainDeck.map(c => c.instanceId), ['top','middle','bottom']);
});

test('declining one simultaneous Vision continues the remaining declaration and leaves no ghost items', () => {
  const {game} = fixture({doubleVision: true});
  assert.equal(game.pendingChoice.effect, 'triggerOrder');
  const order = game.pendingChoice.options.filter(o => !o.confirmTriggerOrder).map(o => o.id);
  assert.equal(order.length, 2);
  for (const id of order) assert.equal(chooseEffectOption(game, id).ok, true);
  assert.equal(chooseEffectOption(game, 'confirm-trigger-order').ok, true);
  const first = game.pendingChoice.data.trigger;
  assert.equal(chooseEffectOption(game, 'decline').ok, true);
  assert.equal(game.pendingChoice?.data?.declareTrigger, true);
  assert.notEqual(game.pendingChoice.data.trigger, first);
  assert.equal(game.actionChain.chain.length, 1);
  assert.equal(chooseEffectOption(game, 'decline').ok, true);
  assert.equal(game.pendingChoice, null);
  assert.ok(!game.actionChain);
  assert.equal(endTurn(game).ok, true);
});

test('declining a declaration during a showdown releases priority without leaving a pending item', () => {
  const {game} = fixture({showdown: true});
  assert.equal(game.pendingChoice?.data?.declareTrigger, true);
  const trigger = game.pendingChoice.data.trigger;
  assert.equal(chooseEffectOption(game, 'decline').ok, true);
  assert.equal(game.pendingChoice, null);
  assert.equal(trigger.pendingChainItemId, undefined);
  assert.ok(!game.showdown.chain.some(item => item.trigger === trigger));
  assert.equal(passShowdown(game).ok, true);
});
