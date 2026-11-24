import fs from 'node:fs';
const [output,seconds='20',port='9229']=process.argv.slice(2);
const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const socket=new WebSocket(targets[0].webSocketDebuggerUrl),pending=new Map();let id=0;
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}});
const post=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
try{
 await post('Profiler.enable');await post('Profiler.start');await new Promise(r=>setTimeout(r,Number(seconds)*1000));
 const {profile}=await post('Profiler.stop');fs.writeFileSync(output,JSON.stringify(profile));
 const counts=new Map(),nodes=new Map(profile.nodes.map(n=>[n.id,n]));
 for(const sample of profile.samples||[])counts.set(sample,(counts.get(sample)||0)+1);
 const rows=[...counts].map(([key,count])=>({samples:count,function:nodes.get(key).callFrame.functionName,file:nodes.get(key).callFrame.url,line:nodes.get(key).callFrame.lineNumber+1}))
  .sort((a,b)=>b.samples-a.samples).slice(0,18);
 console.log(JSON.stringify({samples:profile.samples?.length,rows}));
}finally{await post('Profiler.disable');socket.close();}
