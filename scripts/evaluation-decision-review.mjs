import {readFileSync} from 'node:fs';
import {readFile as readAsync} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewRuntimeTacticalAction,RUNTIME_TACTICAL_REVIEW_CONTRACT} from '../src/ai/runtime-tactical-review.mjs';

export const EVALUATION_REVIEW_ROLLOUT='prospective-symmetric-runtime-review-v1';
export const EVALUATION_REVIEW_CONTRACT='fixed-work-public-runtime-review-v1';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sourceFiles=['src/ai/runtime-tactical-review.mjs','src/ai/tactical-baseline.mjs','src/ai/turn-planner.mjs',
  'src/ai/public-continuation.mjs','src/ai/opening-development.mjs','src/ai/growth-development.mjs',
  'scripts/evaluation-decision-review.mjs'];
export function evaluationReviewImplementationHash(directory=root){
  return hash(sourceFiles.map(file=>[file,hash(readFileSync(path.join(directory,file),'utf8').replace(/\r\n/g,'\n'))]));
}
export function makeEvaluationReview(){
  return {contract:EVALUATION_REVIEW_CONTRACT,runtimeContract:RUNTIME_TACTICAL_REVIEW_CONTRACT,
    implementationHash:evaluationReviewImplementationHash(),sides:'both',budget:'fixed-previews',
    maximumPreviews:48,maximumCandidates:4};
}
export function evaluationReviewHash(review){
  if(!review)return null;
  if(review.contract!==EVALUATION_REVIEW_CONTRACT || !['bounded-public-runtime-review-v2','bounded-public-runtime-review-v3','bounded-public-runtime-review-v4',RUNTIME_TACTICAL_REVIEW_CONTRACT].includes(review.runtimeContract)
    || review.sides!=='both' || review.budget!=='fixed-previews' || review.maximumPreviews!==48 || review.maximumCandidates!==4
    || !/^[a-f0-9]{64}$/.test(review.implementationHash||''))throw new Error('Invalid symmetric evaluation review.');
  return hash(review);
}
export function evaluationReviewOptions(review){
  if(!review)return {};
  const decisionReviewHash=evaluationReviewHash(review);
  if(review.implementationHash!==evaluationReviewImplementationHash())throw new Error('Frozen evaluation reviewer changed.');
  return {decisionReviewHash,reviewDecision:(game,actorId,selected,legal)=>reviewRuntimeTacticalAction(game,actorId,selected,legal,{
    maximumPreviews:review.maximumPreviews,maximumCandidates:review.maximumCandidates,
    // Equal work on both sides: CPU contention must not determine which
    // candidates were compared. The web additionally has a 2-second UI limit.
    now:()=>0
  })};
}
export async function readEvaluationReviewRollout(directory){
  let protocol;
  try{protocol=JSON.parse((await readAsync(path.join(directory,'evaluation-review-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(protocol.contract!==EVALUATION_REVIEW_ROLLOUT || !Number.isInteger(protocol.afterOrdinal) || protocol.afterOrdinal<0)
    throw new Error('Invalid evaluation review rollout.');
  evaluationReviewOptions(protocol.review);
  return protocol;
}
export function commitEvaluationReviewRollout(state,protocol){
  if(!protocol){if(state.evaluationReviewProtocolHash)throw new Error('Evaluation review rollout removed.');return;}
  evaluationReviewHash(protocol.review);
  if(protocol.contract!==EVALUATION_REVIEW_ROLLOUT || !Number.isInteger(protocol.afterOrdinal) || protocol.afterOrdinal<0)
    throw new Error('Invalid evaluation review rollout.');
  const identity=hash(protocol);
  if(state.evaluationReviewProtocolHash && state.evaluationReviewProtocolHash!==identity)throw new Error('Evaluation review rollout changed.');
  if(!state.evaluationReviewProtocolHash && (state.evaluationOrdinal||0)>protocol.afterOrdinal)
    throw new Error('Evaluation review rollout cannot rewrite existing evaluations.');
  state.evaluationReviewProtocolHash=identity;
}
export function assertEvaluationReviewSummary(request,summary){
  if((summary?.decisionReviewHash||null)!==evaluationReviewHash(request.decisionReview))
    throw new Error('Evaluation game uses a different decision review.');
  if(request.decisionReview && (!Array.isArray(summary.decisionReviewStats) || summary.decisionReviewStats.length!==2))
    throw new Error('Reviewed evaluation is missing both-side diagnostics.');
}
