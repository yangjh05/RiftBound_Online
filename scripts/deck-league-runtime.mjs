import assert from 'node:assert/strict';

// Opt-in scheduling only. Existing runs/evaluations and all game rules keep
// their original branches. Applied to a private, fully hashed runtime copy.
export function extendLeagueRuntime(relative,source) {
  const replace=(a,b)=>{assert.equal(source.split(a).length,2,`Unexpected runtime source: ${relative}`);source=source.replace(a,b);};
  if(relative==='scripts/adaptive-deck-search.mjs') {
    replace('configurationKeys: [...new Map(decks.map(deck => [deck.id, trainingDeckKey(deck)])).values()]',
      'configurationKeys: [...new Map(decks.map(deck => [deck.id, trainingDeckKey(deck)])).values()], fixedLearnerDeckId: search.fixedLearnerDeckId || null');
    replace('const { decks } = deckSearchTaskOptions(search, gameIndex).deckSearchAssignment;',
      `const { decks } = deckSearchTaskOptions(search, gameIndex).deckSearchAssignment;
  if(search.fixedLearnerDeckId){
    const own=decks.find(d=>d.id===search.fixedLearnerDeckId); assert.ok(own);
    const other=decks.find(d=>d.id!==own.id)||own;
    return gameIndex%2?[other,own]:[own,other];
  }`);
  }
  if(relative==='scripts/ai-selfplay-task-options.mjs') {
    replace('merged.decks = assignment.decks;',`if(assignment.fixedLearnerDeckId && !assignment.decks.some(d=>d.id===assignment.fixedLearnerDeckId))throw new Error('Missing specialist deck.');
      merged.fixedLearnerDeckId=assignment.fixedLearnerDeckId || null;
      merged.decks = assignment.decks;`);
  }
  if(relative==='src/ai/neural/selfplay.mjs') {
    replace('const decks = pairing.decks;',`if(options.fixedLearnerDeckId){
      const own=options.decks.find(d=>d.id===options.fixedLearnerDeckId);
      if(!own || !(options.league?.length))throw new Error('Specialist collection needs its own deck and frozen opponents.');
      const other=options.decks.find(d=>d.id!==own.id)||own;
      pairing.decks=schedule.learnerSeat===0?[own,other]:[other,own];
    }
    const decks = pairing.decks;`);
    // There are two evaluators; restrict modification to the neural one.
    const needle='if (evaluationMode.startsWith("cross-deck-matrix-")) {';
    assert.equal(source.split(needle).length,3);
    source=source.replace(needle,`if(evaluationMode==='fixed-subject-deck-v1'){
      const own=decks.find(d=>d.id===options.subjectDeckId),other=decks.find(d=>d.id===options.opponentDeckId);
      if(!own||!other)throw new Error('Fixed specialist evaluation needs explicit decks.');
      pair=candidateSeat===0?[own,other]:[other,own];
    } else ${needle}`);
    source=source.replace('const playerRandomSeeds = ["same-deck-mirror-v2", "same-deck-mirror-v3"].includes(evaluationMode)',
      'const playerRandomSeeds = ["same-deck-mirror-v2", "same-deck-mirror-v3", "fixed-subject-deck-v1"].includes(evaluationMode)');
    source=source.replace('if(options.reviewDecision && selected){',
      'if(selected && options.onEncodedDecision)options.onEncodedDecision(selected,actorId);\n        if(options.reviewDecision && selected){');
  }
  return source;
}
export const LEAGUE_RUNTIME_EXTENSIONS=['scripts/adaptive-deck-search.mjs','scripts/ai-selfplay-task-options.mjs','src/ai/neural/selfplay.mjs'];
