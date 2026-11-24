import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

test('frozen evaluator keeps running and saving after its controller exits',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'riftbound-evaluation-lifetime-'));
 try{
  const entry=path.join(root,'worker.mjs'),request=path.join(root,'request.json'),parent=path.join(root,'parent.mjs');
  const module=pathToFileURL(path.resolve('scripts/frozen-evaluation-process.mjs')).href;
  await fs.writeFile(request,'{}');
  await fs.writeFile(entry,`import fs from 'node:fs/promises';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
const dir=path.dirname(process.argv[3]);await fs.writeFile(path.join(dir,'started'),String(process.pid));
for(let i=0;i<4;i++){await delay(200);console.log('persist',i);await fs.writeFile(path.join(dir,'progress'),String(i));}
await fs.writeFile(path.join(dir,'completed'),'yes');`);
  await fs.writeFile(parent,`import {spawnFrozenEvaluator} from ${JSON.stringify(module)};import fs from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';
const child=spawnFrozenEvaluator(${JSON.stringify(entry)},${JSON.stringify(request)},{execArgv:[]});child.on('error',e=>{throw e});
while(!await fs.access(${JSON.stringify(path.join(root,'started'))}).then(()=>true,()=>false))await delay(20);
child.unref();`);
  const child=spawn(process.execPath,[parent],{windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',v=>error+=v);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(code,0,error);
  assert.equal(await fs.access(path.join(root,'completed')).then(()=>true,()=>false),false,'Parent must exit before evaluator completes.');
  for(let i=0;i<100&&!await fs.access(path.join(root,'completed')).then(()=>true,()=>false);i++)await delay(50);
  assert.equal(await fs.readFile(path.join(root,'completed'),'utf8'),'yes');
  assert.equal(await fs.readFile(path.join(root,'progress'),'utf8'),'3');
  assert.match(await fs.readFile(path.join(root,'evaluator.stdout.log'),'utf8'),/persist 3/);
 }finally{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('riftbound-evaluation-lifetime-'));await fs.rm(root,{recursive:true,force:true});}
});
