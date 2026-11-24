// Pure schedule metadata shared by the trainer and the read-only dashboard.
export function leagueDeckPairs(decks){
  const pairs=[];
  for(let a=0;a<decks.length;a++){
    pairs.push([decks[a],decks[a]]);
    for(let b=a+1;b<decks.length;b++)pairs.push([decks[a],decks[b]]);
  }
  return pairs;
}

export function leagueEvaluationJobs(c,stage='screen'){
  const sourceComparison=c.contract==='paired-champion-current-learning-v1';
  const seed=stage==='confirmation'?c.confirmationSeed:c.evaluationSeed;
  const games=sourceComparison?(stage==='confirmation'?c.confirmationGamesPerPair:c.screenGamesPerPair):8;
  const pairs=leagueDeckPairs(c.decks).map((decks,index)=>({decks,index})).filter(({decks})=>{
    if(!sourceComparison||stage!=='screen')return true;
    const a=c.decks.indexOf(decks[0]),b=c.decks.indexOf(decks[1]);
    return a===b||b-a===1||(a===0&&b===c.decks.length-1);
  });
  return pairs.map(({decks,index:pairIndex},index)=>({index,seed:sourceComparison&&decks[0].id!==decks[1].id
      ?((seed+pairIndex*1000003)|1)>>>0:(seed+pairIndex*1000003)>>>0,
    decks:decks[0].id===decks[1].id?[decks[0]]:decks,
    games,evaluationMode:decks[0].id===decks[1].id?'same-deck-mirror-v3':'cross-deck-matrix-v1'}));
}

