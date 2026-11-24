import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const read=async f=>JSON.parse((await readFile(f,'utf8')).replace(/^\uFEFF/,''));
const optional=async f=>{try{return await read(f);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export async function readDeckLeague(projectRoot){
 const pointer=await optional(path.join(projectRoot,'data/ai/deck-league-active.json'));if(!pointer)return null;
 const directory=path.resolve(projectRoot,pointer.directory);
 const [registry,state,controller]=await Promise.all(['registry.json','state.json','controller.json'].map(f=>optional(path.join(directory,f))));
 if(!registry||!state)return {stage:'initializing',profiles:[],controller};
 const lock=await optional(path.join(directory,'controller.lock'));
 let live=false;try{if(lock?.pid===controller?.pid){process.kill(controller.pid,0);live=true;}}catch{}
 return {contract:registry.contract,updatedAt:registry.updatedAt,live,controller,
  profiles:registry.profiles.map(p=>{const s=state.profiles[p.id];return {...p,checkpointPath:undefined,learner:undefined,champion:undefined,
   iteration:s.iteration,games:s.games,acceptedEpochs:s.acceptedEpochs,changedIterations:s.changedIterations,
   lastTraining:s.lastTraining||null,lastEvaluation:s.lastEvaluation||null,
   pending:state.evaluationQueue.find(e=>e.profileId===p.id)?{phase:state.evaluationQueue.find(e=>e.profileId===p.id).phase}:null};}),
  maximumProcesses:16,priority:'normal',queue:state.evaluationQueue.map(e=>({profileId:e.profileId,iteration:e.iteration,phase:e.phase}))};
}
export async function deckLeagueCheckpoint(projectRoot,modelId){
 if(!/^[a-z0-9-]+$/.test(modelId)||modelId.length>100)return null;
 const pointer=await optional(path.join(projectRoot,'data/ai/deck-league-active.json'));if(!pointer)return null;
 const directory=path.resolve(projectRoot,pointer.directory),registry=await read(path.join(directory,'registry.json'));
 const entry=registry.profiles.find(p=>p.modelId===modelId)||await optional(path.join(directory,'serving',modelId+'.descriptor.json'));
 if(!entry||entry.modelId!==modelId)return null;
 const file=path.resolve(entry.checkpointPath);
 if(!file.startsWith(directory+path.sep))throw new Error('Model path outside league.');
 if((await stat(file)).size>128*1024**2)throw new Error('Model too large.');
 const contents=await readFile(file);
 if(createHash('sha256').update(contents).digest('hex')!==entry.checkpointSha256)throw new Error('Model checksum mismatch.');
 return {entry,contents};
}

export async function deckLeagueCatalog(projectRoot){
 const pointer=await optional(path.join(projectRoot,'data/ai/deck-league-active.json'));if(!pointer)return [];
 const directory=path.resolve(projectRoot,pointer.directory),registry=await optional(path.join(directory,'registry.json'));
 if(!registry)return [];
 // Frozen training and current serving engines have separate release checks.
 // A training promotion alone never certifies a different deployed engine.
 const validation=await optional(path.join(directory,'serving-validation.json'));
 const {computeEngineFingerprint}=await import('../scripts/training-safety.mjs');
 const currentEngine=computeEngineFingerprint();
 return registry.profiles.map(p=>({id:p.id,label:p.label,deckId:p.deckId,deckRecord:p.deckRecord,
   modelId:p.modelId,checkpointSha256:p.checkpointSha256,generation:p.generation,kind:'deck-specialist',
   trainingDeckIds:[p.deckId],trainingEngineFingerprint:p.engineFingerprint,
   servingAvailable:pointer.servingEnabled===true&&validation?.passed===true&&validation.engineFingerprint===currentEngine
     &&validation.models?.[p.modelId]===p.checkpointSha256,
   engineCompatible:validation?.passed===true&&validation.engineFingerprint===currentEngine&&validation.models?.[p.modelId]===p.checkpointSha256}));
}
