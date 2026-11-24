import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedCandidateScreenGame,assertCandidateScreenGame} from '../scripts/viktor-candidate-screen-audit.mjs';
const job={id:'cross',mode:'cross-deck-matrix-v1',deckIds:['viktor','sett'],seed:19,games:8,subject:'candidate',opponent:'parent'};
const generations={candidate:8,parent:3};
const row=index=>{const expected=expectedCandidateScreenGame(job,index,'review');
 return {...expected,completed:true,invalid:false,adjudicated:false,counted:true,winnerId:'p1',
  decisionReviewStats:[{errors:0},{errors:0}],aiSeats:[0,1].map(seat=>({generation:seat===expected.candidateSeat?8:3,role:seat===expected.candidateSeat?'candidate':'champion'}))};};
test('screen evidence checks both deck roles with all seat and first-player conditions',()=>{
 const rows=Array.from({length:8},(_,i)=>assertCandidateScreenGame(row(i),job,i,'review',generations));
 for(const deck of job.deckIds){const group=rows.filter(r=>r.deckIds[r.candidateSeat]===deck);assert.equal(group.length,4);
  assert.equal(new Set(group.map(r=>`${r.candidateSeat}:${r.firstPlayerId}`)).size,4);}
 assert.equal(rows[0].gameSeed,19);assert.equal(rows[4].gameSeed,19+104729);
});
test('corrupt schedule, model identity, reviewer and incomplete or adjudicated outcomes fail closed',()=>{
 for(const edit of [r=>r.gameSeed++,r=>r.candidateSeat=1,r=>r.firstPlayerId='p2',r=>r.deckIds.reverse(),r=>r.decisionReviewHash='other',
  r=>r.aiSeats[0].generation++,r=>r.completed=false,r=>r.adjudicated=true,r=>r.counted=false,r=>r.winnerId=null]){
  const value=row(0);edit(value);assert.throws(()=>assertCandidateScreenGame(value,job,0,'review',generations));
 }
});
test('mirror blocks share one seed and swap private streams halfway through the block',()=>{
 const mirror={...job,mode:'same-deck-mirror-v3',deckIds:['viktor']};
 const a=expectedCandidateScreenGame(mirror,0,'r'),b=expectedCandidateScreenGame(mirror,4,'r');
 assert.equal(a.gameSeed,b.gameSeed);assert.equal(a.streamAssignment,0);assert.equal(b.streamAssignment,1);
});
