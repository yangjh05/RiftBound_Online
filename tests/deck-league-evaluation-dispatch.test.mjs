import test from 'node:test';import assert from 'node:assert/strict';
import {nextLeagueEvaluation,EVALUATION_JOBS_PER_VISIT} from '../scripts/deck-league-evaluation-dispatch.mjs';
test('bounded evaluation visits rotate independently of performance or confirmation size',()=>{
 const files=['confirmation-896','screen-112','another-screen'],visits={};
 const created=f=>files.indexOf(f)+1;
 assert.equal(EVALUATION_JOBS_PER_VISIT,8);
 assert.equal(nextLeagueEvaluation(files,visits,created),files[0]);visits[files[0]]=10;
 assert.equal(nextLeagueEvaluation(files,visits,created),files[1]);visits[files[1]]=11;
 assert.equal(nextLeagueEvaluation(files,visits,created),files[2]);visits[files[2]]=12;
 assert.equal(nextLeagueEvaluation(files,visits,created),files[0]);
 assert.deepEqual(files,['confirmation-896','screen-112','another-screen']);
 assert.equal(nextLeagueEvaluation([],visits,created),undefined);
});
