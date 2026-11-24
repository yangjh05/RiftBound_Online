import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {hostname,tmpdir} from 'node:os';
import path from 'node:path';
import {withFileLock,readLiveFileLockOwner,readLockBootTimeMs,readWindowsProcessStartTimeMs} from '../scripts/file-lock.mjs';

test('wall-clock corrections preserve a live lock and cannot allow a second writer',{timeout:25000},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-lock-clock-'));
  const file=path.join(root,'evaluation.lock');
  const realNow=Date.now;
  try{
    const boot=await readLockBootTimeMs();
    await withFileLock(file,async()=>{
      const original=await readFile(file,'utf8');
      // Reproduce the observed 52,932-second correction; also test backwards.
      for(const jump of [52932000,-52932000]){
        t.mock.method(Date,'now',()=>realNow()+jump);
        assert.equal(await readLockBootTimeMs(),boot);
        assert.equal((await readLiveFileLockOwner(file)).pid,process.pid);
        await assert.rejects(withFileLock(file,()=>assert.fail('duplicate writer'),{timeoutMs:1000}),/Timed out/);
        assert.equal(await readFile(file,'utf8'),original);
        t.mock.restoreAll();
      }
    });
    assert.equal(await readLiveFileLockOwner(file),null);
  }finally{
    t.mock.restoreAll();
    assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('riftbound-lock-clock-'));
    await rm(root,{recursive:true,force:true});
  }
});

test('stable boot identity still rejects a reused PID from a previous boot',{timeout:25000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-lock-reboot-'));
  const file=path.join(root,'evaluation.lock');
  try{
    for(const version of [2,3]){
    await writeFile(file,JSON.stringify({version,token:'previous-boot',pid:process.pid,hostname:hostname(),
      bootTimeMs:(await readLockBootTimeMs())-86400000,acquiredAt:new Date(0).toISOString()}));
    assert.equal(await readLiveFileLockOwner(file),null);
    await withFileLock(file,async()=>{
      const current=await readLiveFileLockOwner(file);
      assert.equal(current.pid,process.pid);assert.notEqual(current.token,'previous-boot');
    });
    }
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('riftbound-lock-reboot-'));
    await rm(root,{recursive:true,force:true});
  }
});

test('legacy Windows lock survives the old uptime-derived boot estimate drifting',{timeout:25000,skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-lock-legacy-'));
  const file=path.join(root,'evaluation.lock');
  try{
    await writeFile(file,JSON.stringify({version:2,token:'legacy-live',pid:process.pid,hostname:hostname(),
      bootTimeMs:(await readLockBootTimeMs())+52932000,acquiredAt:new Date().toISOString()}));
    assert.equal((await readLiveFileLockOwner(file)).pid,process.pid);
    await assert.rejects(withFileLock(file,()=>assert.fail('duplicate legacy writer'),{timeoutMs:1000}),/Timed out/);
    assert.equal(JSON.parse(await readFile(file,'utf8')).token,'legacy-live');
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('riftbound-lock-legacy-'));
    await rm(root,{recursive:true,force:true});
  }
});

test('empty process lookup retries through the independent CIM query',async()=>{
  const commands=[];
  const started=await readWindowsProcessStartTimeMs(123,{isAlive:()=>true,pause:async()=>{},execute:async(file,args,opts)=>{
    assert.equal(opts.windowsHide,true);commands.push(args.at(-1));
    return {stdout:commands.length===1?'':'1790000000000'};
  }});
  assert.equal(started,1790000000000);assert.equal(commands.length,2);
  assert.match(commands[0],/Get-Process/);assert.match(commands[1],/Get-CimInstance Win32_Process/);
});
test('process-query failures are bounded and distinct from confirmed process exit',async()=>{
  let calls=0;
  assert.equal(await readWindowsProcessStartTimeMs(123,{isAlive:()=>true,pause:async()=>{},execute:async()=>{
    calls++;if(calls===1)throw new Error('transient process query');return {stdout:calls===2?'nonnumeric':''};
  }}),undefined);
  assert.equal(calls,3);
  let alive=true;
  assert.equal(await readWindowsProcessStartTimeMs(123,{isAlive:()=>alive,pause:async()=>{},execute:async()=>{
    alive=false;return {stdout:''};
  }}),null);
  assert.equal(await readWindowsProcessStartTimeMs(-1,{execute:()=>assert.fail('Invalid PID must not reach a command')}),null);
});
test('unverifiable legacy owner remains reserved, blocks a duplicate, then recovers',{timeout:25000,skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-lock-query-')),file=path.join(root,'evaluation.lock');
  const acquiredAt=new Date().toISOString();
  const options={processStartTimeQuery:async()=>undefined,timeoutMs:1000};
  try{
    const owner={version:2,token:'legacy-query-uncertain',pid:process.pid,hostname:hostname(),
      bootTimeMs:(await readLockBootTimeMs())+52932000,acquiredAt};
    await writeFile(file,JSON.stringify(owner));
    assert.deepEqual(await readLiveFileLockOwner(file,options),{...owner,verificationPending:true});
    await assert.rejects(withFileLock(file,()=>assert.fail('unknown identity allowed duplicate writer'),options),/Timed out/);
    assert.equal(JSON.parse(await readFile(file,'utf8')).token,owner.token);
    const recovered=await readLiveFileLockOwner(file,{processStartTimeQuery:async()=>Date.parse(acquiredAt)-1000});
    assert.deepEqual(recovered,owner);
    const reused=await readLiveFileLockOwner(file,{processStartTimeQuery:async()=>Date.parse(acquiredAt)+5000});
    assert.equal(reused,null,'New process using the PID must not be adopted');
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('riftbound-lock-query-'));
    await rm(root,{recursive:true,force:true});
  }
});
