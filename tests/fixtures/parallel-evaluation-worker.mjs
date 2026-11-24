import {withFileLock} from '../../scripts/file-lock.mjs';
const [,lock]=process.argv.slice(2);
await withFileLock(lock,()=>new Promise(resolve=>{
  process.once('disconnect',resolve);
  process.on('message',message=>{
    if(message.type==='close'){resolve();return;}
    if(message.start<0){process.send({type:'error',error:'fixture failure'});return;}
    for(let i=0;i<8;i++)process.send({type:'game',start:message.start,index:message.start+i,summary:{index:message.start+i,pid:process.pid}});
    process.send({type:'done',start:message.start});
  });
  process.send({type:'ready'});
}));
if(process.connected)process.disconnect();
