import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {json,atomic} from './deck-league-io.mjs';import {unwrap} from './deck-league-contract.mjs';
import {individualEpochResumeState,finalizeIndividualEpochResume} from './individual-epoch-resume.mjs';
const root=path.resolve('data/ai/deck-league-individual-20261011-r2'),c=json(path.join(root,'config.json'));
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)));
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
const {trainRecurrentPpo,restoreAdamOptimizer,serializeOptimizer}=await load('src/ai/neural/trainer.mjs');
const {seededRandom}=await load('src/ai/neural/selfplay.mjs');
const dir=path.join(root,'profiles/sett/replay'),resume=await read(path.join(dir,'epoch.json.gz')),final=await read(path.join(dir,'candidate.json.gz'));
assert.equal(resume.accepted,false);
const trajectories=[];for(let i=0;i<28;i++)trajectories.push(...(await read(path.join(dir,'games',i+'.json.gz'))).trajectories);
const model=deserialize(unwrap(resume)),optimizer=await restoreAdamOptimizer(resume.optimizerState,.0001),random=seededRandom(1);
random.setState(resume.randomState);let trained;
try{
 optimizer.applyGradients=()=>{throw Error('A rejected finite epoch was retried');};
 trained=await trainRecurrentPpo(model,trajectories,{epochs:4,batchSize:16,learningRate:.0001,optimizer,random,
  resumeState:individualEpochResumeState(resume,4),teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,selectBestEpoch:false,gamesObserved:28,
  ppoBatchUpdate:()=>{throw Error('Unexpected new minibatch');},onEpoch:()=>{throw Error('Unexpected new epoch');}});
 finalizeIndividualEpochResume(model,resume);
 assert.deepEqual(serialize(model).weights,final.checkpoint.weights);
 const state=await serializeOptimizer(trained.optimizer,model.generation);
 assert.deepEqual(state.weights.map(w=>[w.shape,w.values]),final.optimizerState.weights.map(w=>[w.shape,w.values]));
 assert.equal(model.generation,final.checkpoint.generation);
 assert.equal(model.gamesTrained,final.checkpoint.gamesTrained);
 assert.equal(model.metadata.selectedEpoch,0);
 assert.equal(model.metadata.acceptedEpochs,0);
 assert.deepEqual(trained.epochGuards,final.epochGuards);
 const result={at:new Date().toISOString(),passed:true,newOptimizerSteps:0,newEpochs:0,weightsIdentical:true,optimizerIdentical:true,generationIdentical:true};
 atomic(path.resolve('data/ai/training-repair-20261013/finite-resume-native-verification.json'),result);console.log(JSON.stringify(result));
}finally{(trained?.optimizer||optimizer).dispose();dispose(model);}
