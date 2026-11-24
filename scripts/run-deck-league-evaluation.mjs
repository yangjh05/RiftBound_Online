import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {withFileLock} from './file-lock.mjs';
import {json,sha,atomic,immutable,exists,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';
import {evaluationStep} from './deck-league-evaluation.mjs';
import {createParallelEvaluationPool} from './parallel-evaluation-pool.mjs';
import {assertLaneResult} from './deck-league-evaluation-lane.mjs';
import {nextLeagueEvaluation,EVALUATION_JOBS_PER_VISIT} from './deck-league-evaluation-dispatch.mjs';
import {assertApprovedEvaluationBinding} from './reviewed-training-contract.mjs';
import {queryTrainingCapacity} from './training-process-capacity.mjs';

const [laneFile,mode='run']=process.argv.slice(2),lane=json(laneFile),root=lane.directory;
const status=(stage,extra={})=>atomic(path.join(root,'controller.json'),{at:new Date().toISOString(),pid:process.pid,stage,...extra});
await withFileLock(path.join(root,'controller.lock'),async()=>{
  try{
    assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);
    assert.ok(Number.isInteger(lane.workers)&&lane.workers>=1&&lane.workers<=4);
    for(const runtime of [lane.runtime,...(lane.legacyBindings||[]).map(b=>b.runtime)]){
      verifyArtifact(runtime.manifest);
      for(const item of json(runtime.manifest.path))assert.equal(sha(path.join(runtime.directory,item.path)),item.sha256,item.path);
      const {computeEngineFingerprint}=await import(pathToFileURL(path.join(runtime.directory,'scripts/training-safety.mjs')));
      assert.equal(computeEngineFingerprint(),runtime.engineFingerprint);
    }
    status('passed');if(mode==='preflight')return;
    const dispatchPolicy=lane.dispatchPolicy?json(verifyArtifact(lane.dispatchPolicy)):null;
    if(dispatchPolicy){
      assert.equal(dispatchPolicy.contract,'fixed-verification-priority-v1');
      assert.equal(dispatchPolicy.performanceIndependent,true);
      dispatchPolicy.requests.forEach(verifyArtifact);
    }
    for(;;){
      if(exists(path.join(root,'stop.request.json'))){status('paused-at-boundary');return;}
      const files=exists(path.join(root,'requests'))?fs.readdirSync(path.join(root,'requests')).filter(f=>f.endsWith('.request.json')):[];
      const journalFile=path.join(root,'dispatch-journal.json'),visits=exists(journalFile)?json(journalFile):{};
      const next=nextLeagueEvaluation(files.filter(f=>!['.result.json','.failure.json'].some(suffix=>exists(path.join(root,'requests',f.replace('.request.json',suffix))))),
        visits,f=>fs.statSync(path.join(root,'requests',f)).mtimeMs,
        {priorityFiles:dispatchPolicy?.requests.map(r=>path.basename(r.path))||[]});
      if(!next){status('idle');if(mode==='once')return;await new Promise(r=>setTimeout(r,2000));continue;}
      const requestFile=path.join(root,'requests',next),request=json(requestFile),config=json(verifyArtifact(request.config));
      assertApprovedEvaluationBinding(lane,request);
      const load=f=>import(pathToFileURL(path.join(request.runtime.directory,f)));
      const {listNodeProcesses,selectTrainingProcesses}=await import(pathToFileURL(path.join(config.projectDirectory,'server/training-dashboard-priority.mjs')));
      const capacity=await queryTrainingCapacity(listNodeProcesses,p=>selectTrainingProcesses(p,config.projectDirectory));
      if(!capacity.known){status('waiting-process-query',{attempts:capacity.attempts,errors:capacity.errors});await new Promise(r=>setTimeout(r,2000));continue;}
      const active=capacity.active;
      const normal=active.every(p=>{try{return os.getPriority(p.pid)===os.constants.priority.PRIORITY_NORMAL;}catch{return true;}});
      if(active.length+lane.workers>config.maximumProcesses||os.freemem()<4*1024**3||!normal){
        status('waiting-capacity',{processes:active.length,normal,freeBytes:os.freemem()});await new Promise(r=>setTimeout(r,2000));continue;
      }
      visits[next]=Date.now();atomic(journalFile,visits);
      const pending={...request.pending},started=Date.now();let pool,final,yielded=false,computed=0,failure=null;
      try{
        pool=await createParallelEvaluationPool(requestFile,lane.workers,{workerFile:fileURLToPath(new URL('./deck-league-evaluation-worker.mjs',import.meta.url))});
        for(;;){
          const step=()=>evaluationStep({config,pending,load,protectedInputs:new Set(),trainedInputs:new Set(),saveProtection:async()=>{},
            status,maximumNewJobs:0,precommittedSeeds:true});
          let result=await step();
          if(!result.done&&!result.nextPhase){
            const dir=path.join(pending.directory,pending.phase),binding=json(path.join(dir,'plan.json'));
            let completed=0;const missing=[];
            binding.jobs.forEach((job,index)=>{const f=path.join(dir,job.id+'.json');const old=exists(f)?json(f):null;
              if(old?.rows.length===4)completed+=4;else missing.push(index);});
            const selected=missing.slice(0,EVALUATION_JOBS_PER_VISIT-computed);let cursor=0;
            await Promise.all(Array.from({length:lane.workers},(_,slot)=>(async()=>{
              for(;;){const start=selected[cursor++];if(start===undefined)return;
                status('evaluation',{profileId:pending.profileId,iteration:pending.iteration,phase:pending.phase,completed,total:binding.jobs.length*4,
                  workerPids:pool.pids,elapsedMs:Date.now()-started});
                await pool.runBlock(slot,{start,phase:pending.phase,resumedSummaries:[]},async()=>{});completed+=4;computed++;
              }
            })()));
            result=await step();
          }
          if(!result.done&&computed>=EVALUATION_JOBS_PER_VISIT){yielded=true;break;}
          if(result.nextPhase){pending.phase=result.nextPhase;continue;}
          assert.equal(result.done,true);final=result.result;break;
        }
      }catch(e){failure=e;}finally{await pool?.close();}
      if(failure){immutable(requestFile.replace('.request.json','.failure.json'),{requestHash:digest(request),
        profileId:pending.profileId,iteration:pending.iteration,evaluationRuntime:request.runtime,phase:pending.phase,
        promoted:false,error:failure.stack||String(failure),at:new Date().toISOString()});
        status('evaluation-failed',{profileId:pending.profileId,iteration:pending.iteration,error:String(failure)});continue;}
      if(yielded){status('evaluation-yielded',{profileId:pending.profileId,iteration:pending.iteration,phase:pending.phase,
        jobsComputed:computed,elapsedMs:Date.now()-started});continue;}
      const result={requestHash:digest(request),profileId:pending.profileId,iteration:pending.iteration,
        evaluationRuntime:request.runtime,final,elapsedMs:Date.now()-started,at:new Date().toISOString()};
      assertLaneResult(request,result);
      immutable(requestFile.replace('.request.json','.result.json'),result);status('evaluation-completed',result);
    }
  }catch(e){status('failed',{error:e.stack||String(e)});throw e;}
},{timeoutMs:1000});
