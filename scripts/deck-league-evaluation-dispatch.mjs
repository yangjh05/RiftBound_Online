import assert from 'node:assert/strict';
export const EVALUATION_JOBS_PER_VISIT=8;
// Fairness depends on dispatch time only, never on wins or intermediate CI.
// A long confirmation cannot hold the lane until all 896 games complete.
export function nextLeagueEvaluation(files,lastVisits,createdAt,{priorityFiles=[]}={}){
  assert.ok(Array.isArray(files));
  const priority=new Set(priorityFiles);
  return files.slice().sort((a,b)=>Number(priority.has(b))-Number(priority.has(a))
    ||(lastVisits[a]??0)-(lastVisits[b]??0)||createdAt(a)-createdAt(b)||a.localeCompare(b))[0];
}
