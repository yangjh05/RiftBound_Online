import assert from 'node:assert/strict';
export const COVERAGE_BUDGET=Object.freeze({initialGamesPerDeck:64,maximumGamesPerDeck:128,minimumCasesPerType:20,minimumGamesPerType:8});
export function correctionCoverage(records,profileId,types,budget=COVERAGE_BUDGET){
  const selected=records.filter(r=>r.profileId===profileId&&r.disposition!=='skipped-coverage-sufficient');
  const byType=types.map(type=>{
    const rows=selected.filter(r=>r.target===type&&r.accepted>0);
    const cases=rows.reduce((s,r)=>s+r.accepted,0),games=new Set(rows.map(r=>r.path)).size;
    return {type,cases,games,sufficient:cases>=budget.minimumCasesPerType&&games>=budget.minimumGamesPerType};
  });
  return {profileId,gamesCollected:selected.length,byType,sufficient:byType.every(x=>x.sufficient)};
}
export function useSecondCollectionStage(firstStageRecords,profileId,types,budget=COVERAGE_BUDGET){
  const first=firstStageRecords.filter(r=>r.profileId===profileId&&r.collectionStage===0);
  assert.equal(first.length,budget.initialGamesPerDeck,'Do not decide from partial collection');
  return !correctionCoverage(first,profileId,types,budget).sufficient;
}
