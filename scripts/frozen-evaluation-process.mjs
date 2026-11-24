import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';

// The evaluator owns durable locks/checkpoints and outlives its training
// controller. Give it a separate process group and file-backed output, not
// the controller's IPC channel, console or output-pipe lifetime.
export function spawnFrozenEvaluator(entrypoint,requestFile,{execArgv=process.execArgv}={}){
 const directory=path.dirname(requestFile),descriptors=[];
 try{
  descriptors.push(openSync(path.join(directory,'evaluator.stdout.log'),'a'));
  descriptors.push(openSync(path.join(directory,'evaluator.stderr.log'),'a'));
  return spawn(process.execPath,[...execArgv,entrypoint,'--evaluate',requestFile],{
   detached:true,windowsHide:true,stdio:['ignore',...descriptors]
  });
 }finally{for(const fd of descriptors)closeSync(fd);}
}
