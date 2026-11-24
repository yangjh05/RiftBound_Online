import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';import {pathToFileURL} from 'node:url';
import {adamScalarDelta,adamGradientForDelta} from './adam-update-geometry.mjs';
import {sha,immutable} from './deck-league-io.mjs';
const previous=await import(pathToFileURL(path.resolve('data/ai/deck-league-20261007/runtime-r13-optimizer-aware/scripts/adam-update-geometry.mjs')));
const file=path.resolve('data/ai/deck-league-20261007/profiles/annie/iterations/000120/candidate.json.gz'),before=sha(file);
const c=JSON.parse(gunzipSync(fs.readFileSync(file))),weights=c.optimizerState.weights;
const first=weights[1],second=weights.find(w=>w.name===first.name.replace(/\/m$/,'/v'));
assert.ok(second);let tested=0,previousFalseRejections=0,currentFalseRejections=0,maximumError=0;
for(let i=0;i<first.values.length&&tested<10000;i++){
 const m=first.values[i],v=second.values[i];if(!m||!v)continue;
 // A known finite gradient constructs a reachable step. No training game,
 // objective, validation label, model update or optimizer update is run.
 const state={m,v,bias1:1,bias2:1,learningRate:.0001},gradient=-9*m*(1+1e-6),delta=adamScalarDelta(gradient,state);
 tested++;if(previous.adamGradientForDelta(delta,state,gradient)===null)previousFalseRejections++;
 const inverse=adamGradientForDelta(delta,state,gradient);
 if(inverse===null)currentFalseRejections++;else maximumError=Math.max(maximumError,Math.abs(adamScalarDelta(inverse,state)-delta));
}
assert.equal(tested,10000);assert.equal(currentFalseRejections,0);assert.equal(sha(file),before);
const report={at:new Date().toISOString(),source:{path:file,sha256:before},tested,previousFalseRejections,currentFalseRejections,maximumError,
 generatedNumericalCases:true,actualTrainingUpdates:0,extraGames:0,sourceUnchanged:true};
immutable(path.resolve('data/ai/optimizer-repair-20261013/r14/inverse-numerical-audit.json'),report);console.log(JSON.stringify(report));
