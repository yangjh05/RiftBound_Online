import assert from 'node:assert/strict';

export function adamScalarDelta(g,{m=0,v=0,beta1=.9,beta2=.999,bias1,bias2,epsilon=1e-7,learningRate}){
  return -learningRate*(beta1*m+(1-beta1)*g)/bias1/(Math.sqrt((beta2*v+(1-beta2)*g*g)/bias2)+epsilon);
}

// Invert the real Adam equation, including old moments and the second moment
// of the NEW gradient. Projecting a delta and retaining unrelated moments is
// forbidden: the returned gradient must reproduce it through ordinary Adam.
export function adamGradientForDelta(delta,state,reference=0){
  const {m=0,v=0,beta1=.9,beta2=.999,bias1,bias2,epsilon=1e-7,learningRate}=state;
  assert.ok([delta,m,v,beta1,beta2,bias1,bias2,epsilon,learningRate,reference].every(Number.isFinite));
  assert.ok(v>=0&&beta1>=0&&beta1<1&&beta2>=0&&beta2<1&&bias1>0&&bias2>0&&epsilon>0&&learningRate>0);
  const q=-delta*bias1/learningRate,A=beta1*m-q*epsilon,B=1-beta1,C=beta2*v/bias2,D=(1-beta2)/bias2;
  if(q===0)return -beta1*m/B;
  const a=B*B-q*q*D,b=2*A*B,c=A*A-q*q*C,roots=[];
  if(Math.abs(a)<1e-15*Math.max(B*B,q*q*D,1e-30)){
    if(b!==0)roots.push(-c/b);
  }else{
    // b*b - 4*a*c cancels almost equal moment-sized terms when the
    // requested displacement is small. Factor q² before evaluating it.
    const inner=B*B*C+D*A*A-q*q*D*C;
    if(inner>=-1e-13*Math.max(B*B*C,D*A*A,q*q*D*C,1e-300)){
      const d=2*Math.abs(q)*Math.sqrt(Math.max(0,inner)),r=-.5*(b+(b>=0?d:-d));
      if(r===0)roots.push(-b/(2*a));else roots.push(r/a,c/r);
    }
  }
  const valid=roots.filter(g=>Number.isFinite(g)&&(A+B*g)*q>=0
    &&Math.abs(adamScalarDelta(g,state)-delta)<=1e-7*Math.max(Math.abs(delta),1e-10));
  return valid.sort((x,y)=>Math.abs(x-reference)-Math.abs(y-reference))[0]??null;
}

const canonical=name=>name.replace(/\/[mv]$/,'').replace(/_\d+(?=\/|$)/g,'');
export function readAdamGeometry(optimizer,names,variables){
  const cfg=optimizer.getConfig(),first=optimizer.accumulatedFirstMoment,second=optimizer.accumulatedSecondMoment;
  assert.ok(Array.isArray(first)&&Array.isArray(second),'Unsupported Adam slot layout');
  assert.equal(first.length,second.length);
  assert.ok(first.length===0||first.length===names.length,'Adam slot count differs from gradient order');
  const byName=new Map(variables.map(v=>[v.name,v]));
  const moments=names.map((name,i)=>{
    const variable=byName.get(name);assert.ok(variable);
    if(!first.length)return {name,m:new Float32Array(variable.size),v:new Float32Array(variable.size)};
    assert.equal(canonical(first[i].originalName),canonical(name),'Adam first moment order changed');
    assert.equal(canonical(second[i].originalName),canonical(name),'Adam second moment order changed');
    assert.deepEqual(first[i].variable.shape,variable.shape);assert.deepEqual(second[i].variable.shape,variable.shape);
    return {name,m:Float32Array.from(first[i].variable.dataSync()),v:Float32Array.from(second[i].variable.dataSync())};
  });
  return {...cfg,bias1:1-optimizer.accBeta1.dataSync()[0],bias2:1-optimizer.accBeta2.dataSync()[0],moments};
}

export function gradientsForAdamDelta(delta,reference,names,variables,geometry,learningRate){
  const indexes=new Map(variables.map((v,i)=>[v.name,i])),values=reference.map(a=>Float64Array.from(a));let maximumError=0;
  for(let slot=0;slot<names.length;slot++){
    const k=indexes.get(names[slot]),{m,v}=geometry.moments[slot];
    const state={beta1:geometry.beta1,beta2:geometry.beta2,bias1:geometry.bias1,bias2:geometry.bias2,epsilon:geometry.epsilon,learningRate,m:0,v:0};
    for(let i=0;i<values[k].length;i++){
      state.m=m[i];state.v=v[i];
      const g=adamGradientForDelta(delta[k][i],state,reference[k][i]);
      if(g===null)return {feasible:false,reason:'unreachable-adam-delta',slot,index:i};
      values[k][i]=Math.fround(g);
      maximumError=Math.max(maximumError,Math.abs(adamScalarDelta(values[k][i],state)-delta[k][i]));
    }
  }
  return {feasible:true,values,maximumError};
}

// Shorten the requested DISPLACEMENT while keeping Adam's learning rate fixed.
// Shortening its learning rate instead shrinks the reachable interval by the
// same factor, so an unreachable projected step stays unreachable forever.
export function gradientsForAdamFraction(delta,fraction,reference,names,variables,geometry,learningRate){
  assert.ok(Number.isFinite(fraction)&&fraction>0&&fraction<=1);
  const target=delta.map(a=>Float64Array.from(a,x=>x*fraction));
  return {...gradientsForAdamDelta(target,reference,names,variables,geometry,learningRate),fraction};
}
