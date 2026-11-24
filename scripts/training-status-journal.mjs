import fs from 'node:fs/promises';
import path from 'node:path';
import {renameWithRetry} from './file-replace.mjs';

// Worker completion and heartbeat callbacks can overlap. One queue owns both
// the status snapshot and journal so they cannot share or rename a partial file.
export function createTrainingStatusJournal(root,base){
  let tail=Promise.resolve(),ordinal=0;
  return (stage,detail={})=>{
    const value={...base,pid:process.pid,at:new Date().toISOString(),stage,...detail},sequence=++ordinal;
    const next=tail.then(async()=>{
      const file=path.join(root,'status.json'),temporary=`${file}.tmp-${process.pid}-${sequence}`;
      await fs.writeFile(temporary,JSON.stringify(value,null,2));await renameWithRetry(temporary,file);
      await fs.appendFile(path.join(root,'events.jsonl'),JSON.stringify(value)+'\n');
    });
    tail=next;return next;
  };
}
