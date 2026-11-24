// CPU allocation only. Never changes the frozen policy, seeds, statistical
// thresholds, or which evidence is allowed to update a policy.
export function livePolicyAuditBudget(base,{active=false,backgroundWorkers=0}={}){
  if(!active)return base;
  const occupied=Math.max(0,Math.ceil(Number(backgroundWorkers)||0));
  return {...base,audit:0,selfplay:Math.max(0,base.selfplay+base.audit-occupied)};
}

// Several independent candidates share one seed-shard pool. Each candidate
// still completes its selection bank before admitting its final bank. Return
// results in committed plan order, regardless of completion order.
export async function runLivePolicyAuditPipeline(jobs,{runJob,onCompleted=async()=>{},
  shouldStop=()=>false,concurrency=4}={}){
  const results=Array(jobs.length).fill(null);
  let next=0,failure=null,paused=false;
  async function lane(){
    while(!failure&&!paused){
      if(shouldStop()){paused=true;return;}
      const index=next++;if(index>=jobs.length)return;
      try{
        const result=await runJob(jobs[index],index);
        if(result?.paused){paused=true;return;}
        results[index]=result;
        await onCompleted(results.slice(),index);
      }catch(error){failure ||= error;return;}
    }
  }
  await Promise.all(Array.from({length:Math.min(jobs.length,Math.max(1,Math.floor(concurrency)||1))},lane));
  if(failure)throw failure;
  return {results,paused:paused||results.some(r=>r===null)};
}
