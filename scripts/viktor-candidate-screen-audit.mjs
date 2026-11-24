import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {digest,candidateScreenJobs} from './viktor-candidate-learning.mjs';

export function expectedCandidateScreenGame(job,index,reviewHash){
 assert.ok(Number.isInteger(index)&&index>=0&&index<job.games);
 const candidateSeat=index%2,firstPlayerId=Math.floor(index/2)%2?'p2':'p1';
 let pair;
 if(job.mode==='same-deck-mirror-v3'){
  assert.equal(job.deckIds.length,1);pair=[job.deckIds[0],job.deckIds[0]];
 }else{
  assert.equal(job.mode,'cross-deck-matrix-v1');assert.equal(job.deckIds.length,2);assert.equal(job.seed%2,1);
  const ordered=[...job.deckIds].sort((a,b)=>a.localeCompare(b)),own=Math.floor(index/4)%2;
  pair=[ordered[own],ordered[1-own]];if(candidateSeat)pair.reverse();
 }
 return {candidateSeat,firstPlayerId,deckIds:pair,evaluationMode:job.mode,
  gameSeed:(job.seed+Math.floor(index/(job.mode==='same-deck-mirror-v3'?8:4))*104729)>>>0,
  streamAssignment:job.mode==='same-deck-mirror-v3'?Math.floor((index%8)/4):0,decisionReviewHash:reviewHash};
}
export function assertCandidateScreenGame(row,job,index,reviewHash,generations){
 const expected=expectedCandidateScreenGame(job,index,reviewHash);
 for(const [key,value]of Object.entries(expected))assert.deepEqual(row[key],value,`${job.id}/${index}: ${key}`);
 assert.equal(row.completed,true);assert.equal(row.invalid,false);assert.equal(row.adjudicated,false);assert.equal(row.counted,true);
 assert.ok(['p1','p2'].includes(row.winnerId));
 assert.equal(row.aiSeats?.length,2);assert.equal(row.decisionReviewStats?.length,2);
 for(const [seat,subject]of [[row.candidateSeat,job.subject],[1-row.candidateSeat,job.opponent]]){
  assert.equal(row.aiSeats[seat].generation,generations[subject]);
  assert.equal(row.aiSeats[seat].role,seat===row.candidateSeat?'candidate':'champion');
 }
 return row;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(process.argv[2]||'data/ai/viktor-main-candidate-20261005'),json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
 const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 const c=json(path.join(root,'config.json')),binding=json(path.join(root,'screen','plan.json'));
 assert.equal(binding.configHash,digest(c));assert.deepEqual(binding.jobs,candidateScreenJobs(c));
 assert.deepEqual(binding.review,c.evaluationReview);
 assert.equal(binding.parentSha256,c.parent.sha256);assert.equal(binding.specialistSha256,c.specialist.sha256);
 for(const [file,hash]of [[binding.candidatePath,binding.candidateSha256],[c.parent.path,binding.parentSha256],[c.specialist.path,binding.specialistSha256]])assert.equal(sha(file),hash);
 for(const [file,hash]of Object.entries(c.executionFiles))assert.equal(sha(path.join(root,'execution',file)),hash);
 const {readTrajectoryArchive:read}=await import('../src/ai/neural/archive.mjs');
 const final=await read(binding.candidatePath);
 const generations={candidate:final.checkpoint.generation,parent:c.parent.generation,specialist:c.specialist.generation};
 const groups={},jobs=[];let games=0,reviewErrors=0;
 for(const job of binding.jobs){
  const file=path.join(root,'screen',`${job.id}.json`);if(!fs.existsSync(file))continue;
  const record=json(file);assert.equal(record.bindingHash,digest(binding));assert.deepEqual(record.job,job);
  assert.ok(Array.isArray(record.summaries)&&record.summaries.length<=job.games);
  record.summaries.forEach((row,index)=>{
   assertCandidateScreenGame(row,job,index,digest(binding.review),generations);games++;
   reviewErrors+=row.decisionReviewStats.reduce((n,s)=>n+(s.errors||0),0);
   const deck=row.deckIds[row.candidateSeat],key=`${job.group}:${job.subject}:${deck}`;
   const g=groups[key]||={group:job.group,subject:job.subject,deckId:deck,games:0,wins:0};
   g.games++;g.wins+=Number(row.winnerId===`p${row.candidateSeat+1}`);
  });
  jobs.push({id:job.id,completed:record.summaries.length,total:job.games});
 }
 const output={checkedAt:new Date().toISOString(),configHash:digest(c),bindingHash:digest(binding),modelsVerified:true,
  actualGamesVerified:games,targetGames:384,completed:games===384,reviewErrors,generations,jobs,groups,
  interpretation:games===384?'Completed diagnostic only; no parity or integration approval.':'Incomplete evaluation; do not select a winner or alter the plan.',
  parityEstablished:false,integrationAllowed:false};
 fs.writeFileSync(path.join(root,'screen-audit.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}
