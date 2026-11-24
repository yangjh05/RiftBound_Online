import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveDeckModel,deckModelIdentity,verifyCheckpointBuffer,sameAiModelSelection} from '../src/ai/deck-league-routing.mjs';
import {deckLeagueCheckpoint} from '../server/deck-league-data.mjs';
import {atomic,reserveSeeds,json} from '../scripts/deck-league-io.mjs';
import {registerAiTurnWorker} from '../src/ai/turn-worker.mjs';
import {createAiTurnNeuralConfigureRequest} from '../src/ai/turn-protocol.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const deck={legend:'yi',main:[['x',3]],runes:[['a',6]],battlefields:['b'],sideboard:[]};

test('own exact configuration selects separate variants even with equal generation',()=>{
 const a={modelId:'yi-1',checkpointSha256:'a'.repeat(64),generation:1833,deckRecord:deck,servingAvailable:true};
 const b={...a,modelId:'yi-2',checkpointSha256:'b'.repeat(64),deckRecord:{...deck,main:[['aurora',3]]}};
 assert.equal(resolveDeckModel([a,b],deck),a);assert.equal(resolveDeckModel([a,b],b.deckRecord),b);
 assert.notEqual(deckModelIdentity(a),deckModelIdentity(b));
 assert.equal(sameAiModelSelection(a,b),false);
 assert.equal(sameAiModelSelection(a,{generation:1833}),false);
 assert.equal(sameAiModelSelection(a,{...a,checkpointSha256:b.checkpointSha256}),false);
 assert.equal(sameAiModelSelection({generation:1833,source:'bundled'},{generation:1833,source:'server'}),true);
 assert.equal(resolveDeckModel([{...a,servingAvailable:false}],deck),null);
 assert.equal(resolveDeckModel([a,b],{...deck,main:[['x',2]]}),null);
 assert.throws(()=>resolveDeckModel([a,a],deck),/Ambiguous/);
});

test('worker rejects tampered bytes even on a previously cached descriptor',async()=>{
 let listener;const posted=[];let loads=0;
 const scope={addEventListener(_t,fn){listener=fn;},postMessage(x){posted.push(x);}};
 registerAiTurnWorker(scope,{neural:{deserializeNeuralModel(){loads++;return {};},createNeuralSession(){return {reset(){}};},disposeNeuralModel(){}}});
 const text=JSON.stringify({generation:1833}),buffer=new TextEncoder().encode(text).buffer;
 const send=bytes=>listener({data:createAiTurnNeuralConfigureRequest({requestId:1,descriptorKey:'yi-id',checkpointBuffer:bytes,expectedGeneration:1833,expectedCheckpointSha256:hash(text)})});
 send(buffer);for(let i=0;i<100&&!posted.length;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(posted[0]?.ok,true);assert.equal(loads,1);
 send(new TextEncoder().encode(JSON.stringify({generation:1833,tampered:true})).buffer);
 for(let i=0;i<100&&posted.length<2;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(posted[1]?.ok,false);assert.match(posted[1].error,/checksum/);assert.equal(loads,1);
 await assert.rejects(verifyCheckpointBuffer(buffer,'f'.repeat(64)),/checksum/);
});

test('archived serving identity survives promotion and rejects changed weights; seeds preserve roles',async t=>{
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'riftbound-league-test-'));
 t.after(async()=>{assert.ok(path.resolve(root).startsWith(parent+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const directory=path.join(root,'data/ai/league'),modelId='yi-abc',file=path.join(directory,'serving',modelId+'.json');
 atomic(file,{weights:new Float32Array([1,2])});const contents=await fs.readFile(file);
 assert.deepEqual(json(file).weights,[1,2],'typed arrays must remain valid checkpoint arrays');
 const entry={modelId,checkpointPath:file,checkpointSha256:hash(contents)};
 atomic(path.join(directory,'serving',modelId+'.descriptor.json'),entry);
 atomic(path.join(directory,'registry.json'),{profiles:[]});
 atomic(path.join(root,'data/ai/deck-league-active.json'),{directory:'data/ai/league'});
 assert.deepEqual((await deckLeagueCheckpoint(root,modelId)).contents,contents);
 await fs.appendFile(file,' ');await assert.rejects(deckLeagueCheckpoint(root,modelId),/checksum/);
 assert.equal(await deckLeagueCheckpoint(root,'../../escape'),null);
 reserveSeeds(directory,'train:a',[1,2]);reserveSeeds(directory,'train:a',[1,2]);
 assert.throws(()=>reserveSeeds(directory,'evaluation:b',[1]),/collision/);
 assert.throws(()=>reserveSeeds(directory,'train:b',[3],[3]),/collision/);
});
