import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {projectReachableAdamDelta} from './reachable-adam-projection.mjs';
const n=1434609,delta=[new Float64Array(n)],bounds={lower:[new Float64Array(n).fill(-.0001)],upper:[new Float64Array(n).fill(.0001)]};
const directions=Array.from({length:12},(_,j)=>{const a=new Float64Array(n);let count=0;
 for(let i=j%6;i<n;i+=97){a[i]=j<6?1:-1;count++;}const norm=Math.sqrt(count);for(let i=j%6;i<n;i+=97)a[i]/=norm;
 return {values:[a],minimumDescent:.1};});
const results=[];let expected;
for(const sparse of [false,true]){const start=performance.now(),r=projectReachableAdamDelta(delta,directions,bounds,{passes:32,maximumNorm:.2,sparse});
 results.push({sparse,milliseconds:performance.now()-start,iterations:r.iterations,feasible:r.feasible});if(expected)assert.deepEqual(r,expected);else expected=r;}
const report={at:new Date().toISOString(),contract:'synthetic-exact-zero-projection-benchmark-v1',parameters:n,directions:directions.length,passes:32,
 numericalResultsIdentical:true,realTrainingExecuted:false,results,speedup:results[0].milliseconds/results[1].milliseconds,
 limitation:'Synthetic sparse, inconsistent constraints exercise the iteration budget. This is not an end-to-end live training throughput measurement.'};
const out=path.resolve(process.argv[2]||'data/ai/reachable-recovery-20261015-sparse/projection-benchmark.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
