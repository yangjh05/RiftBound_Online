import assert from 'node:assert/strict';
import {adamScalarDelta} from './adam-update-geometry.mjs';

// A conservative interval witnessed by finite gradients. Continuity of Adam's
// scalar map guarantees every interior displacement is reachable. In particular
// old momentum can make the reachable interval asymmetric; +/- learningRate
// is NOT a valid substitute. The small interior margin protects float32 inverse.
export function adamReachableInterval(state){
  const {m=0,v=0,beta1=.9,beta2=.999,bias2}=state;
  const root=-beta1*m/(1-beta1),extent=Math.max(1,Math.abs(root)*4,Math.sqrt(v)*32);
  const probes=[-extent,0,extent,root];
  const a=beta1*m,c=beta2*v/bias2,d=(1-beta2)/bias2;
  if(a!==0)probes.push(Math.max(-extent,Math.min(extent,c*(1-beta1)/(d*a))));
  const values=probes.map(g=>adamScalarDelta(g,state));
  assert.ok(values.every(Number.isFinite));
  return {lower:Math.min(0,...values)*.999,upper:Math.max(0,...values)*.999};
}

export function adamReachableBounds(names,variables,geometry,learningRate,masks=null){
  const lower=variables.map(v=>new Float64Array(v.size)),upper=variables.map(v=>new Float64Array(v.size));
  const indexes=new Map(variables.map((v,i)=>[v.name,i]));
  for(let slot=0;slot<names.length;slot++){
    const k=indexes.get(names[slot]);assert.ok(k!==undefined);
    const {m,v}=geometry.moments[slot],state={...geometry,learningRate,m:0,v:0};
    for(let i=0;i<m.length;i++){
      if(masks&&!masks[k][i])continue;
      state.m=m[i];state.v=v[i];const bounds=adamReachableInterval(state);
      lower[k][i]=bounds.lower;upper[k][i]=bounds.upper;
    }
  }
  return {lower,upper};
}
export function adamDeltaForGradients(gradients,names,variables,geometry,learningRate){
  const delta=variables.map(v=>new Float64Array(v.size)),indexes=new Map(variables.map((v,i)=>[v.name,i]));
  for(let slot=0;slot<names.length;slot++){
    const k=indexes.get(names[slot]),{m,v}=geometry.moments[slot],state={...geometry,learningRate,m:0,v:0};
    for(let i=0;i<m.length;i++){state.m=m[i];state.v=v[i];delta[k][i]=adamScalarDelta(gradients[k][i],state);}
  }
  return delta;
}
const dot=(a,b)=>{let sum=0;for(let k=0;k<a.length;k++)for(let i=0;i<a[k].length;i++)sum+=a[k][i]*b[k][i];return sum;};
// Joint Dykstra projection: training half-spaces, actual Adam reachable box,
// and trust ball. Failure to find an intersection is reported, never converted
// into a weaker training requirement or an unbounded gradient fallback.
export function projectReachableAdamDelta(delta,directions,bounds,{passes=128,minimumDescent=0,maximumNorm=Infinity,sparse=true}={}){
  assert.ok(minimumDescent>=0&&maximumNorm>0);
  const x=delta.map(a=>Float64Array.from(a)),box=x.map(a=>new Float64Array(a.length)),ball=x.map(a=>new Float64Array(a.length));
  const dual=directions.map(()=>0),required=directions.map(g=>Math.max(minimumDescent,g.minimumDescent??0));
  const squared=directions.map(g=>dot(g.values,g.values));
  // One-hot state/action inputs leave most gradient coordinates EXACTLY zero.
  // Omit only exact zeros, keeping the summation order and every constraint.
  // Dense mode is retained for bit-for-bit equivalence tests and benchmarks.
  const compiled=directions.map(g=>g.values.map((values,k)=>{
    if(!sparse)return {k,values,indexes:null};
    const nonzero=[];for(let i=0;i<values.length;i++)if(values[i]!==0)nonzero.push(i);
    return {k,values,indexes:nonzero.length<values.length?Uint32Array.from(nonzero):null};
  }).filter(c=>c.indexes===null||c.indexes.length));
  const directionDot=(direction,arrays)=>{
    let sum=0;for(const {k,values,indexes}of direction){const a=arrays[k];
      if(indexes===null){for(let i=0;i<values.length;i++)sum+=values[i]*a[i];}
      else for(let j=0;j<indexes.length;j++){const i=indexes[j];sum+=values[i]*a[i];}}
    return sum;
  };
  for(let k=0;k<x.length;k++)for(let i=0;i<x[k].length;i++)assert.ok(Number.isFinite(x[k][i])&&Number.isFinite(bounds.lower[k][i])&&Number.isFinite(bounds.upper[k][i])&&bounds.lower[k][i]<=bounds.upper[k][i]);
  let iterations=0;
  for(;iterations<passes;iterations++){
    let change=0;
    directions.forEach((g,j)=>{
      if(squared[j]<=1e-24)return;
      const amount=Math.max(0,(directionDot(compiled[j],x)+dual[j]*squared[j]+required[j])/squared[j]),diff=dual[j]-amount;
      for(const {k,values,indexes}of compiled[j]){
        if(indexes===null){for(let i=0;i<values.length;i++){const d=diff*values[i];x[k][i]+=d;change=Math.max(change,Math.abs(d));}}
        else for(let n=0;n<indexes.length;n++){const i=indexes[n],d=diff*values[i];x[k][i]+=d;change=Math.max(change,Math.abs(d));}
      }
      dual[j]=amount;
    });
    for(let k=0;k<x.length;k++)for(let i=0;i<x[k].length;i++){
      const y=x[k][i]+box[k][i],z=Math.max(bounds.lower[k][i],Math.min(bounds.upper[k][i],y));
      box[k][i]=y-z;change=Math.max(change,Math.abs(z-x[k][i]));x[k][i]=z;
    }
    if(Number.isFinite(maximumNorm)){
      let norm=0;for(let k=0;k<x.length;k++)for(let i=0;i<x[k].length;i++)norm+=(x[k][i]+ball[k][i])**2;
      const scale=Math.min(1,maximumNorm/Math.sqrt(norm||1));
      for(let k=0;k<x.length;k++)for(let i=0;i<x[k].length;i++){
        const y=x[k][i]+ball[k][i],z=y*scale;ball[k][i]=y-z;change=Math.max(change,Math.abs(z-x[k][i]));x[k][i]=z;
      }
    }
    if(change<1e-11){iterations++;break;}
  }
  const after=compiled.map(g=>directionDot(g,x)),norm=Math.sqrt(dot(x,x));
  const boxPassed=x.every((a,k)=>a.every((v,i)=>Number.isFinite(v)&&v>=bounds.lower[k][i]-1e-12&&v<=bounds.upper[k][i]+1e-12));
  return {delta:x,after,norm,iterations,feasible:boxPassed&&norm<=maximumNorm+1e-10&&after.every((v,i)=>Number.isFinite(v)&&v<=-required[i]+1e-8)};
}
