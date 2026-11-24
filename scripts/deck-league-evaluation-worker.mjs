import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {withFileLock} from './file-lock.mjs';
import {json,atomic,exists,verifyArtifact} from './deck-league-io.mjs';
import {digest,unwrap,inputKey,isEvaluationChoice,assertEvaluationRows,MATCH_INDEPENDENCE} from './deck-league-contract.mjs';

const [requestFile,lock]=process.argv.slice(2);
try{await withFileLock(lock,async()=>{
  const request=json(requestFile),config=json(verifyArtifact(request.config)),pending=request.pending;
  verifyArtifact(request.runtime.manifest);
  const load=f=>import(pathToFileURL(path.join(request.runtime.directory,f)));
  const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');
  assert.equal(computeEngineFingerprint(),request.runtime.engineFingerprint);
  const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
  const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
  const {evaluateNeuralModels}=await load('src/ai/neural/selfplay.mjs');
  const {evaluationReviewOptions,evaluationReviewHash}=await load('scripts/evaluation-decision-review.mjs');
  const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
  const diagnostic=await read(verifyArtifact(request.diagnosticInputs)),trained=new Set(diagnostic.trained);
  const review=evaluationReviewOptions(config.evaluationReview),reviewHash=evaluationReviewHash(config.evaluationReview);
  const models=new Map();
  const model=async ref=>{verifyArtifact(ref);if(!models.has(ref.sha256))models.set(ref.sha256,deserialize(unwrap(await read(ref.path))));return models.get(ref.sha256);};
  try{await new Promise((resolve,reject)=>{
    let busy=false;
    const send=message=>process.connected&&process.send(message,e=>{if(e)reject(e);});
    process.once('disconnect',resolve);
    process.on('message',async message=>{
      if(message.type==='close'){if(busy)return reject(Error('Cannot close a working evaluator'));resolve();return;}
      try{
        assert.equal(message.type,'block');assert.equal(busy,false);busy=true;
        const {start,phase}=message,dir=path.join(pending.directory,phase),binding=json(path.join(dir,'plan.json'));
        assert.deepEqual(binding.evaluationRuntime,request.runtime);
        const bindingHash=digest(binding),job=binding.jobs[start];assert.ok(job);
        const file=path.join(dir,job.id+'.json'),old=exists(file)?json(file):null;
        if(old){assert.equal(old.bindingHash,bindingHash);assert.deepEqual(old.job,job);}
        const rows=old?.rows||[],keys=new Set(old?.inputKeys||[]),overlaps=new Set(old?.previouslyTrainedInputs||[]);
        const a=await model(pending[job.subject]),b=await model(job.opponent);
        const save=()=>atomic(file,{bindingHash,job,rows,inputKeys:[...keys],previouslyTrainedInputs:[...overlaps],
          dataRole:'evaluation-only',inputRoleContract:MATCH_INDEPENDENCE,protocolSha256:pending.inputProtocol.sha256,
          diagnosticInputSnapshot:request.diagnosticInputs});
        const result=evaluateNeuralModels(a,b,config.profiles.map(p=>p.deck),{
          games:4,seed:job.seed,evaluationMode:'fixed-subject-deck-v1',subjectDeckId:job.subjectDeckId,opponentDeckId:job.opponentDeckId,
          greedy:true,maxActions:2400,resumedSummaries:rows,...review,
          onEncodedDecision:selected=>{if(!isEvaluationChoice(selected))return;
            const key=inputKey({steps:[{state:selected.stateEncoding,actions:Array.from(selected.actionEncoding).slice(0,selected.legalCount*ACTION_DIM),legalCount:selected.legalCount}]});
            keys.add(key);if(trained.has(key))overlaps.add(key);},
          onGameComplete:({game,summary})=>{rows[game-1]=summary;save();send({type:'game',start,index:game-1,summary:{completed:true}});}
        });
        assertEvaluationRows(result.summaries,job,reviewHash);save();busy=false;send({type:'done',start});
      }catch(e){reject(e);}
    });
    send({type:'ready'});
  });}finally{models.forEach(dispose);}
},{timeoutMs:1000});}
catch(e){process.exitCode=1;if(process.connected)await new Promise(resolve=>process.send({type:'error',error:e.stack||String(e)},resolve));}
finally{if(process.connected)process.disconnect();}
