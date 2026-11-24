import {fork} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readLiveFileLockOwner} from './file-lock.mjs';

export async function createParallelEvaluationPool(requestFile,workers,{workerFile=fileURLToPath(new URL('./parallel-evaluation-worker.mjs',import.meta.url))}={}){
  if(!Number.isInteger(workers)||workers<1||workers>4)throw new Error('Evaluation compute worker cap is four.');
  const directory=path.join(path.dirname(requestFile),'worker-locks');await mkdir(directory,{recursive:true});
  const slots=[];
  async function open(slot){
    const lock=path.join(directory,`${slot}.lock`);
    // A coordinator crash must not spawn replacements over its surviving children.
    while(await readLiveFileLockOwner(lock))await delay(1000);
    const child=fork(workerFile,[requestFile,lock],{windowsHide:true,execArgv:process.execArgv,
      stdio:['ignore','inherit','inherit','ipc'],serialization:'json'});
    let job=null,readyResolve,readyReject,failure=null,closed=false;
    let messages=Promise.resolve();
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const exited=new Promise(resolve=>child.once('exit',resolve));
    const fail=e=>{failure ||= e;readyReject(e);job?.reject(e);job=null;};
    child.on('error',fail);
    child.on('exit',(code)=>{if(!closed)fail(new Error(`Parallel evaluation worker exited ${code}.`));});
    child.on('message',message=>{
      messages=messages.then(async()=>{
        if(message.type==='ready'){readyResolve();return;}
        if(message.type==='error')throw new Error(message.error);
        if(!job||message.start!==job.start)throw new Error('Evaluation worker response belongs to another block.');
        if(message.type==='game')await job.onGame(message.index,message.summary);
        else if(message.type==='done'){const current=job;job=null;current.resolve(message.start);}
        else throw new Error('Unknown evaluation worker response.');
      }).catch(fail);
    });
    const handle={pid:child.pid,ready,run(task,onGame){
      if(failure)return Promise.reject(failure);
      if(job||closed)return Promise.reject(new Error('Evaluation slot is not idle.'));
      return new Promise((resolve,reject)=>{job={...task,onGame,resolve,reject};
        child.send({type:'block',...task},e=>{if(e)fail(e);});});
    },async close(){
      closed=true;
      if(child.connected)child.send({type:'close'},()=>{});
      await exited;await messages;
    }};
    slots.push(handle);await ready;
  }
  try{for(let slot=0;slot<workers;slot++)await open(slot);}
  catch(e){await Promise.all(slots.map(s=>s.close()));throw e;}
  return {pids:slots.map(s=>s.pid),runBlock:(slot,task,onGame)=>slots[slot].run(task,onGame),
    close:()=>Promise.all(slots.map(s=>s.close()))};
}
