import {toggleOptionalPaymentEffect} from '../engine.mjs';
import {cloneAiState} from './clone-state.mjs';

const effectsOf = payment => payment?.optionalPowerEffects || payment?.optionalEffects || [];
const selectedIds = payment => effectsOf(payment).filter(e => e.selected).map(e => e.id).sort();
const signature = payment => JSON.stringify(effectsOf(payment).map(e => [e.id,e.kind,e.energyCost,e.requirements]));

// Optional costs change the strategy; selecting individual runes does not.
// Store the choice on this particular payment continuation, never on the card
// or player, so it cannot accidentally carry into another payment window.
export function needsPaymentOptionDecision(game) {
  const payment = game?.pendingPayment;
  if (!effectsOf(payment).length) return false;
  const chosen = payment.aiOptionSelection;
  return chosen?.signature !== signature(payment)
    || JSON.stringify(chosen.effectIds) !== JSON.stringify(selectedIds(payment));
}

export function applyPaymentOptions(game, action) {
  const payment = game?.pendingPayment;
  const effects = effectsOf(payment);
  if (!payment || !Array.isArray(action.effectIds) || !effects.length
    || action.cardId !== payment.cardId || new Set(action.effectIds).size !== action.effectIds.length
    || action.effectIds.some(id => !effects.some(e => e.id === id))) {
    return {ok:false,message:'Invalid optional payment selection.'};
  }
  const selected = new Set(action.effectIds);
  const toggles = effects.filter(e => Boolean(e.selected) !== selected.has(e.id)).map(e => e.id);
  const trial = cloneAiState(game);
  for (const id of toggles) if (!toggleOptionalPaymentEffect(trial,id)?.ok)
    return {ok:false,message:'Optional payment selection cannot be applied.'};
  for (const id of toggles) {
    const result = toggleOptionalPaymentEffect(game,id);
    if (!result?.ok) return result;
  }
  game.pendingPayment.aiOptionSelection = {signature:signature(game.pendingPayment),effectIds:selectedIds(game.pendingPayment)};
  return {ok:true};
}

export function paymentOptionActions(game, canPay) {
  if (!needsPaymentOptionDecision(game)) return [];
  const payment = game.pendingPayment, effects = effectsOf(payment);
  const selections = [[],selectedIds(payment),effects.map(e => e.id)];
  // Normal cards have one or two optional costs. Larger effect sets retain
  // every single option plus the current/all choices without exponential work.
  if (effects.length <= 4) {
    for (let mask=1; mask<2**effects.length; mask++) selections.push(effects.filter((_,i)=>mask&(1<<i)).map(e=>e.id));
  } else for (const effect of effects) selections.push([effect.id]);
  const unique = new Map(selections.map(ids => [JSON.stringify([...ids].sort()),[...ids].sort()]));
  const actions = [];
  for (const effectIds of unique.values()) {
    const action = {kind:'choosePaymentOptions',cardId:payment.cardId,effectIds};
    const branch = cloneAiState(game);
    if (applyPaymentOptions(branch,action).ok && canPay(branch)) actions.push(action);
  }
  return actions.length ? actions : [{kind:'cancelPayment'}];
}

export function paymentOptionProfile(game, action) {
  if (action?.kind !== 'choosePaymentOptions') return null;
  const effects = effectsOf(game.pendingPayment).filter(e => action.effectIds.includes(e.id));
  return {selected:effects.length,available:effectsOf(game.pendingPayment).length,
    accelerate:effects.some(e=>e.kind==='accelerate'),
    energy:effects.reduce((n,e)=>n+(Number(e.energyCost)||0),0),
    power:effects.reduce((n,e)=>n+(e.requirements||[]).reduce((s,r)=>s+(Number(r.amount)||0),0),0),
    draw:effects.reduce((n,e)=>n+(Number(e.draw)||0),0)};
}
