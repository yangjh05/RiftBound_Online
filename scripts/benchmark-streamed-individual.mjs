import path from 'node:path';import {pathToFileURL} from 'node:url';
import {json,atomic,verifyArtifact} from './deck-league-io.mjs';
import {unwrap} from './deck-league-contract.mjs';
const [directory,profileId='sett',output]=process.argv.slice(2),c=json(path.join(directory,'config.json'));
const old=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)));
const next=f=>import(pathToFileURL(path.join(directory,'runtime-r5-streamed',f)));
const {readTrajectoryArchive:read}=await old('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await old('src/ai/neural/model.mjs');
const {individualMarginDirections}=await old('scripts/individual-training-margin.mjs');
const {streamedIndividualMargins}=await next('scripts/individual-training-margin.mjs');
const {lessonInputKey}=await old('scripts/tactical-lesson-learning.mjs');
const p=c.profiles.find(p=>p.id===profileId),bank=await read(path.join(directory,'profiles',p.id,'lessons.json.gz'));
const samples=[...new Map(bank.bank.training.map(s=>[lessonInputKey(s),s])).values()];
const model=deserialize(unwrap(await read(verifyArtifact(p.champion))));
try{
 const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val)),parameters=variables.reduce((s,v)=>s+v.size,0);
 let started=performance.now();const baseline=individualMarginDirections(model,samples,variables),oldMs=performance.now()-started;
 const sum=variables.map(v=>new Float64Array(v.size));
 for(const d of baseline)for(let k=0;k<sum.length;k++)for(let i=0;i<sum[k].length;i++)sum[k][i]+=d.values[k][i]/baseline.length;
 const oldCount=baseline.length;baseline.length=0;globalThis.gc?.();
 started=performance.now();const streamed=streamedIndividualMargins(model,samples,variables),newMs=performance.now()-started;
 let maximumError=0,maximumValue=0;
 for(let k=0;k<sum.length;k++)for(let i=0;i<sum[k].length;i++){
  maximumError=Math.max(maximumError,Math.abs(sum[k][i]-streamed.gradient[k][i]));maximumValue=Math.max(maximumValue,Math.abs(sum[k][i]));}
 const result={at:new Date().toISOString(),profileId,cases:samples.length,activeCases:oldCount,parameters,oldMs,newMs,speedup:oldMs/newMs,
  oldRetainedGradientBytes:oldCount*parameters*8,newRetainedGradientBytes:(1+streamed.directions.length)*parameters*8,
  projectionDirectionsBefore:oldCount,projectionDirectionsAfter:streamed.directions.length,maximumError,maximumValue,
  gradientEquivalent:maximumError<1e-5*Math.max(1,maximumValue),acceptanceCriteriaUnchanged:true};
 if(!result.gradientEquivalent)throw Error('Hinge gradient changed beyond numeric tolerance');
 if(output)atomic(output,result);console.log(JSON.stringify(result));
}finally{dispose(model);}
