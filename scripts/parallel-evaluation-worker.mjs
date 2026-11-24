import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {readTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {neuralArtifactHash} from '../src/ai/neural/evaluator-certification.mjs';
import {evaluateMixedNeuralBlock} from './mixed-match-evaluation.mjs';
import {evaluationReviewOptions} from './evaluation-decision-review.mjs';
import {computeEngineFingerprint} from './training-safety.mjs';
import {assertAdaptiveCheckpoint} from './adaptive-policy-q-evidence.mjs';
import {assertFrozenMatchPlan,digest} from './adaptive-policy-q-contract.mjs';
import {assertLegalTrainingDeck} from '../src/ai/legal-decks.mjs';
import {withFileLock} from './file-lock.mjs';

const [requestFile,lock]=process.argv.slice(2);
try{await withFileLock(lock,async()=>{
  let candidate=null,opponent=null;
  try{
    const request=await readTrajectoryArchive(requestFile),identity=digest(request);
    assertFrozenMatchPlan(request.plan);
    for(const deck of request.decks)assertLegalTrainingDeck(deck,request.deckPoolId);
    const config=JSON.parse(await readFile(path.resolve(path.dirname(requestFile),'../..','config.json'),'utf8'));
    if(computeEngineFingerprint()!==config.engineFingerprint)throw new Error('Evaluation worker engine changed.');
    const load=async file=>{const p=await readTrajectoryArchive(file),c=p.candidateCheckpoint||p.checkpoint||p;
      assertAdaptiveCheckpoint(c);return deserializeNeuralModel(c);};
    candidate=await load(request.candidatePath);opponent=await load(request.opponentPath);
    if(neuralArtifactHash(candidate)!==request.plan.candidateHash||neuralArtifactHash(opponent)!==request.plan.opponentHash)throw new Error('Evaluation worker model changed.');
    const review=evaluationReviewOptions(request.decisionReview);
    await new Promise((resolve,reject)=>{
      const send=message=>{if(process.connected)process.send(message,e=>{if(e)reject(e);});};
      process.once('disconnect',resolve);
      process.on('message',message=>{
        if(message.type==='close'){resolve();return;}
        try{
          if(message.type!=='block')throw new Error('Unknown evaluation work.');
          const start=message.start;
          evaluateMixedNeuralBlock(candidate,opponent,request.decks,{plan:request.plan,start,
            maxActions:2400,greedy:true,temperature:0.05,...review,resumedSummaries:message.resumedSummaries,
            onGameComplete:({game,summary,resumed})=>{
              if(!resumed){summary.evaluationRequestHash=identity;send({type:'game',start,index:game-1,summary});}
            }});
          send({type:'done',start});
        }catch(e){reject(e);}
      });
      if(process.connected)send({type:'ready'});else resolve();
    });
  }finally{if(candidate)disposeNeuralModel(candidate);if(opponent)disposeNeuralModel(opponent);}
},{timeoutMs:1000});
}catch(e){process.exitCode=1;if(process.connected)await new Promise(resolve=>process.send({type:'error',error:e.stack||String(e)},resolve));}
finally{if(process.connected)process.disconnect();}
