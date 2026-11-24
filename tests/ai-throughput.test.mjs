import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {selfPlayInitialProcessCount,collectProcessPoolSelfPlay} from '../scripts/ai-selfplay-process-pool.mjs';
import {adaptiveWorkerBudget} from '../scripts/adaptive-policy-q-contract.mjs';
import {collectTacticalRefreshGames} from '../scripts/tactical-policy-refresh.mjs';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {createNeuralModel,createNeuralSession,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM} from '../src/ai/neural/encoding.mjs';
import {decklists} from '../src/cards.mjs';

const gib=1024**3;
test('warm starts reserve aggregate memory, obey live capacity and retain cold-start compatibility',()=>{
  const options={initialProcesses:8,maximumProcesses:8,memoryAwareInitialProcesses:true,
    minimumFreeMemoryBytes:4*gib,dynamicWorkerHeadroomBytes:2*gib,freeMemoryBytes:()=>12*gib};
  assert.equal(selfPlayInitialProcessCount(options,32),4);
  assert.equal(selfPlayInitialProcessCount({...options,initialWorkerRssBytes:4*gib},32),1);
  assert.equal(selfPlayInitialProcessCount({...options,dynamicProcessLimit:()=>3},32),3);
  assert.equal(selfPlayInitialProcessCount({...options,dynamicProcessLimit:()=>0},32),0);
  assert.equal(selfPlayInitialProcessCount(options,2),2);
  for(const free of [NaN,undefined,Infinity,2*gib])assert.equal(selfPlayInitialProcessCount({...options,freeMemoryBytes:()=>free},32),1);
  assert.equal(selfPlayInitialProcessCount({...options,memoryAwareInitialProcesses:false,initialProcesses:2},32),2);
  for(let legacy=0;legacy<=16;legacy++){
    const budget=adaptiveWorkerBudget(legacy,16);
    const initial=selfPlayInitialProcessCount({...options,freeMemoryBytes:()=>128*gib,
      dynamicProcessLimit:()=>budget.selfplay},32);
    assert.ok(initial+budget.trainer+budget.audit+budget.evaluation+legacy<=16);
  }
});

test('parallel refresh restores original order, preserves saved games and resumes only missing identities',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-refresh-order-'));
  const schedule=Array.from({length:4},(_,index)=>({index,deckId:`deck-${index>>1}`,seed:100+index,
    partition:index%2?'validation':'training'}));
  const base={root,model:null,decks:[],schedule,engineFingerprint:'engine',protocolHash:'protocol',sourceSha256:'source',processes:16};
  const game=item=>({engineFingerprint:'engine',gameIndex:item.index,seed:item.seed,
    summary:{completed:true,deckIds:[item.deckId,item.deckId]},samples:[{identity:item.index,encoding:new Float32Array([0.25,item.index])}]});
  try{
    // Simulate interruption after one out-of-order completion.
    await assert.rejects(collectTacticalRefreshGames({...base,collect:async options=>{
      assert.equal(options.maximumProcesses,8);
      assert.equal(options.awaitWorkerExit,true);
      await options.onGameComplete({gameIndex:2,result:{tacticalDemonstration:game(schedule[2])}});
      throw new Error('interrupted');
    }}),/interrupted/);
    const saved=await readFile(path.join(root,'games','2.json.gz'));
    const results=await collectTacticalRefreshGames({...base,collect:async options=>{
      assert.deepEqual([...options.completedGameIndexes.get(0)],[2]);
      for(const index of [3,1,0])await options.onGameComplete({gameIndex:index,result:{tacticalDemonstration:game(schedule[index])}});
    }});
    assert.deepEqual(results.map(g=>g.samples[0].identity),[0,1,2,3]);
    assert.deepEqual(results.map(g=>g.partition),['training','validation','training','validation']);
    assert.deepEqual(await readFile(path.join(root,'games','2.json.gz')),saved);
    await collectTacticalRefreshGames({...base,collect:()=>assert.fail('completed refresh was recollected')});
    const corrupt=await readTrajectoryArchive(path.join(root,'games','2.json.gz'));
    corrupt.seed++;
    await writeTrajectoryArchive(path.join(root,'games','2.json.gz'),corrupt);
    await assert.rejects(collectTacticalRefreshGames({...base,collect:()=>assert.fail('invalid source was accepted')}),/identity changed/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('lean inference preserves exact probabilities, sampled actions and recurrent memory',()=>{
  const model=createNeuralModel({seed:719});
  const full=createNeuralSession(model),lean=createNeuralSession(model,{lean:true,maxHistory:0});
  try{
    for(let turn=0;turn<12;turn++){
      const count=[1,3,16,64][turn%4];
      const prepared={stateEncoding:Float32Array.from({length:STATE_DIM},(_,i)=>((i+turn)%17-8)/20),
        actionEncoding:Float32Array.from({length:count*ACTION_DIM},(_,i)=>((i+turn)%11-5)/10),
        actions:Array.from({length:count},(_,i)=>({kind:`action-${i}`})),legalCount:count};
      const options={greedy:turn%2===0,random:()=>0.413,temperature:turn%2?0.85:0.05};
      const a=full.decideEncoded(`p${turn%2}`,prepared,options);
      const b=lean.decideEncoded(`p${turn%2}`,prepared,options);
      assert.deepEqual(b.probabilities,a.probabilities);
      assert.deepEqual(b.nextMemory,a.nextMemory);
      assert.equal(b.selectedIndex,a.selectedIndex);
    }
  }finally{disposeNeuralModel(model);}
});

test('a warm collection joins child exits before releasing its process budget',{timeout:15000},async()=>{
  const model=createNeuralModel({seed:13}),pids=new Set();
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-warm-start-'));
  const release=path.join(root,'release');
  let released=false;
  try{
    const result=await collectProcessPoolSelfPlay({games:4,workers:1,processes:4,maximumProcesses:4,
      memoryAwareInitialProcesses:true,freeMemoryBytes:()=>64*gib,minimumFreeMemoryBytes:4*gib,
      dynamicProcessLimit:()=>3,awaitWorkerExit:true,dynamicScaling:false,
      workerPath:path.resolve('tests/fixtures/ai-selfplay-recovery-worker.mjs'),
      workerEnvironment:{RIFTBOUND_RECOVERY_RELEASE:release},
      model,decks:Object.values(decklists).slice(0,2),maxActions:1,
      onWorkerHeartbeat:snapshot=>{
        for(const slot of snapshot.active)pids.add(slot.processId);
        if(pids.size===3&&!released){released=true;void writeFile(release,'ready');}
      }});
    assert.equal(result.workerStats.initial,3);
    assert.equal(result.workerStats.collectedGames,4);
    assert.equal(pids.size,3);
    for(const pid of pids)assert.throws(()=>process.kill(pid,0));
  }finally{disposeNeuralModel(model);await rm(root,{recursive:true,force:true});}
});

test('a warm pool waits at zero capacity and starts when its reserved slot becomes available',{timeout:15000},async()=>{
  const model=createNeuralModel();
  let capacity=0,earlyStart=false;
  const release=setTimeout(()=>{capacity=1;},1500);
  try{
    const result=await collectProcessPoolSelfPlay({model,decks:[],games:1,workers:1,processes:1,maximumProcesses:1,
      memoryAwareInitialProcesses:true,dynamicProcessLimit:()=>capacity,dynamicScaleIntervalMs:1000,
      freeMemoryBytes:()=>64*gib,minimumFreeMemoryBytes:4*gib,awaitWorkerExit:true,
      workerPath:path.resolve('tests/fixtures/ai-selfplay-recovery-worker.mjs'),
      workerEnvironment:{RIFTBOUND_RECOVERY_RELEASE:path.resolve('package.json')},
      onWorkerHeartbeat:snapshot=>{if(capacity===0&&snapshot.processCount>0)earlyStart=true;}});
    assert.equal(earlyStart,false);
    assert.equal(result.workerStats.initial,0);
    assert.equal(result.workerStats.collectedGames,1);
  }finally{clearTimeout(release);disposeNeuralModel(model);}
});
