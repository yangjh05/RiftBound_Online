import {evaluateNeuralModels} from '../src/ai/neural/selfplay.mjs';
import {mixedExpectedGame} from './mixed-match-schedule.mjs';

export function evaluateMixedNeuralBlock(candidate,opponent,decks,options){
  const {plan,start,resumedSummaries=[],onGameComplete}=options;
  if(!Number.isInteger(start)||start<0||start%8||start+8>plan.blocks*8)throw new Error('Invalid mixed evaluation block.');
  const byId=new Map(decks.map(deck=>[deck.id,deck]));
  if(plan.deckIds.some(id=>!byId.has(id))||byId.size!==plan.deckIds.length)throw new Error('Frozen mixed deck set changed.');
  const expected=mixedExpectedGame(plan,start),pair=[...new Set(expected.deckIds)].map(id=>byId.get(id));
  return evaluateNeuralModels(candidate,opponent,pair,{...options,games:8,seed:expected.gameSeed,
    evaluationMode:expected.evaluationMode,resumedSummaries,
    onGameComplete:p=>onGameComplete?.({...p,game:start+p.game,games:plan.blocks*8})});
}

// Reuse the proven matrix evaluator, including legal-action checks, recurrent
// memory, payment handling and replay identity checks. Only scheduling differs.
export function evaluateMixedNeuralModels(candidate, opponent, decks, options) {
  const {plan, games, resumedSummaries = [], onGameComplete} = options;
  if (!Number.isInteger(games) || games % 8 || games > plan.blocks * 8) throw new Error('Invalid mixed evaluation prefix.');
  const byId = new Map(decks.map(deck => [deck.id, deck]));
  if (plan.deckIds.some(id => !byId.has(id)) || byId.size !== plan.deckIds.length) throw new Error('Mixed evaluation deck pool changed.');
  const summaries = [];
  for (let start = 0; start < games; start += 8) {
    const expected = mixedExpectedGame(plan, start);
    const pair = [...new Set(expected.deckIds)].map(id => byId.get(id));
    const result = evaluateNeuralModels(candidate, opponent, pair, {...options,
      games: 8, seed: expected.gameSeed, evaluationMode: expected.evaluationMode,
      resumedSummaries: resumedSummaries.slice(start, start + 8),
      onGameComplete: progress => onGameComplete?.({...progress, game: start + progress.game, games})});
    summaries.push(...result.summaries);
  }
  return {summaries};
}
