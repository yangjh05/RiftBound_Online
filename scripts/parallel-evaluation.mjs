import {readFile} from 'node:fs/promises';
import {digest} from './adaptive-policy-q-contract.mjs';
import path from 'node:path';

export const PARALLEL_EVALUATION_CONTRACT='prospective-parallel-champion-evaluation-v1';
export function assertParallelEvaluationProtocol(p){
  if(p?.contract!==PARALLEL_EVALUATION_CONTRACT || !Number.isInteger(p.afterOrdinal) || p.afterOrdinal<0
    || p.workers!==4 || p.priority!=='champion-promotion' || !Array.isArray(p.backgroundRequests)
    || p.backgroundRequests.length>1 || p.backgroundRequests.some(r=>!path.isAbsolute(r.requestFile)
      || !/^[a-f0-9]{64}$/.test(r.requestHash)))throw new Error('Invalid parallel evaluation protocol.');
  return p;
}
export async function readParallelEvaluationProtocol(root){
  try{return assertParallelEvaluationProtocol(JSON.parse((await readFile(path.join(root,'parallel-evaluation-protocol.json'),'utf8')).replace(/^\uFEFF/,'')));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function commitParallelEvaluationProtocol(state,p){
  if(!p){if(state.parallelEvaluationProtocolHash)throw new Error('Parallel evaluation protocol removed.');return;}
  assertParallelEvaluationProtocol(p);
  if(state.parallelEvaluationProtocolHash && state.parallelEvaluationProtocolHash!==digest(p))throw new Error('Parallel evaluation protocol changed.');
  if(!state.parallelEvaluationProtocolHash && state.evaluationOrdinal>p.afterOrdinal)throw new Error('Parallel evaluation must start prospectively.');
  state.parallelEvaluationProtocolHash=digest(p);
}

// Includes the evaluator coordinator, four compute children and every retained
// serial evaluator. The extra slots are reserved even while a pool starts/drains.
export function parallelEvaluationBudget(external=0,maximum=16,background=0){
  if(!Number.isInteger(maximum)||maximum<1||maximum>16)throw new Error('Worker cap must be 1–16.');
  const occupied=Number.isFinite(external)?Math.max(0,Math.ceil(external)):maximum;
  const retained=Math.max(0,Math.ceil(background)||0), available=Math.max(0,maximum-occupied-retained);
  const trainer=available>0?1:0;
  // Reserve five slots before starting the lane; never take capacity away from
  // a still-running collector when an external owner disappears.
  const evaluation=Math.min(5,Math.max(0,available-1));
  const audit=Math.min(3,Math.max(0,available-7));
  const selfplay=Math.min(8,Math.max(0,available-trainer-evaluation-audit));
  return {trainer,evaluation,audit,selfplay,backgroundEvaluation:retained,maximum};
}

export function contiguousEvaluationPrefix(summaries){
  let end=0;while(end<summaries.length&&summaries[end])end++;
  return summaries.slice(0,end);
}

// Completion order cannot select the statistical sample. Fill only the frozen
// round, retain every saved slot, and decide only after its full prefix exists.
export async function runParallelEvaluationRound({targetGames,savedSummaries,workers,runBlock,onGameComplete}){
  if(!Number.isInteger(targetGames)||targetGames<8||targetGames%8||!Number.isInteger(workers)||workers<1)throw new Error('Invalid parallel evaluation round.');
  const summaries=savedSummaries.slice(0,targetGames), jobs=[];
  for(let start=0;start<targetGames;start+=8){
    if(Array.from({length:8},(_,i)=>summaries[start+i]).some(s=>!s))jobs.push(start);
  }
  let next=0,failure=null;
  async function lane(slot){
    while(!failure){
      const start=jobs[next++];if(start===undefined)return;
      try{
        const result=await runBlock(slot,{start,resumedSummaries:summaries.slice(start,start+8)},async(index,summary)=>{
          if(!Number.isInteger(index)||index<start||index>=start+8)throw new Error('Evaluation worker returned an unscheduled game.');
          if(summaries[index]){
            if(digest(summaries[index])!==digest(summary))throw new Error('Evaluation worker rewrote a saved game.');
            return;
          }
          await onGameComplete(index,summary);
          summaries[index]=summary;
        });
        if(result!==start || Array.from({length:8},(_,i)=>summaries[start+i]).some(s=>!s))throw new Error('Evaluation block did not finish its committed games.');
      }catch(e){failure ||= e;}
    }
  }
  await Promise.all(Array.from({length:Math.min(workers,jobs.length)},(_,i)=>lane(i)));
  if(failure)throw failure;
  if(summaries.length!==targetGames||contiguousEvaluationPrefix(summaries).length!==targetGames)throw new Error('Evaluation round contains holes.');
  return summaries;
}
