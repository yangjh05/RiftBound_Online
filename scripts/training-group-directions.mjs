import assert from 'node:assert/strict';
import {trainingLossDirections} from './ppo-training-projection.mjs';
import {lessonInputKey,lessonTypes} from './tactical-lesson-learning.mjs';

// Different acceptance groups must have their own loss direction. Partition
// overlapping banks by membership so shared examples are differentiated once.
export function groupedTrainingLossDirections(model,groups,protectedKeys){
  const unique=new Map(),partitions=new Map(),sums=new Map();
  groups.forEach((g,i)=>{for(const sample of g.samples){const key=lessonInputKey(sample);
    if(!unique.has(key))unique.set(key,{sample,members:new Set()});unique.get(key).members.add(i);}});
  for(const {sample,members}of unique.values()){
    const key=[...members].join(',');if(!partitions.has(key))partitions.set(key,{members:[...members],samples:[]});
    partitions.get(key).samples.push(sample);
  }
  for(const {members,samples}of partitions.values()){
    const bank={training:samples,validation:[],protectedValidationKeys:[...protectedKeys]};
    for(const d of trainingLossDirections(model,bank)){
      const count=samples.filter(s=>lessonTypes(s).includes(d.type)).length;
      for(const group of members){
        const key=group+':'+d.type;
        if(!sums.has(key))sums.set(key,{type:groups[group].id+':'+d.type,group:groups[group].id,category:d.type,count:0,
          values:d.values.map(v=>new Float64Array(v.length))});
        const sum=sums.get(key);sum.count+=count;
        sum.values.forEach((v,k)=>{for(let j=0;j<v.length;j++)v[j]+=d.values[k][j]*d.norm*count;});
      }
    }
  }
  return [...sums.values()].map(d=>{
    // Count all group examples, including any zero-gradient partition.
    const g=groups.find(g=>g.id===d.group);assert.ok(g);
    d.count=new Map(g.samples.filter(s=>lessonTypes(s).includes(d.category)).map(s=>[lessonInputKey(s),s])).size;
    for(const v of d.values)for(let i=0;i<v.length;i++)v[i]/=d.count;
    d.norm=Math.sqrt(d.values.reduce((n,a)=>n+a.reduce((s,x)=>s+x*x,0),0));
    if(d.norm>1e-12)for(const v of d.values)for(let i=0;i<v.length;i++)v[i]/=d.norm;
    return d;
  }).filter(d=>d.norm>1e-12);
}
