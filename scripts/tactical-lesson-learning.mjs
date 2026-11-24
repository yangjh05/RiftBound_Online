import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {inferStep,serializeNeuralModel} from '../src/ai/neural/model.mjs';
import {trainBehaviorCloning} from '../src/ai/neural/trainer.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
import {tacticalSelectionGuard} from './local-policy-learning.mjs';
import {resolveLessonMemory,contextualLessonSamples} from './lesson-memory-context.mjs';

export const TACTICAL_LESSON_CONTRACT='prospective-type-balanced-tactical-learning-v1';
export const LESSON_REPLAY_CONTRACT='prospective-run-local-lesson-replay-v1';
export const LESSON_FLAGS=Object.freeze({mulligan:'mulliganLesson',growth:'growthLesson',resource:'localResourceLesson',response:'responsePolicyLesson'});
export const tacticalLessonDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};

export function validateTacticalLessonProtocol(p){
  assert.equal(p.contract,TACTICAL_LESSON_CONTRACT);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.equal(p.minimumSourceIteration,165);assert.equal(p.replayRefreshes,8);
  assert.equal(p.maximumPerType,64);assert.equal(p.examplesPerTypePerRound,8);
  assert.equal(p.retentionPerTypePerRound,8);
  assert.equal(p.maximumRounds,12);assert.equal(p.learningRate,0.0003);
  assert.ok(Number.isSafeInteger(p.seed)&&p.seed>0&&p.seed<=0xffffffff);
  return p;
}
export async function readTacticalLessonProtocol(root){
  let p;try{p=JSON.parse((await readFile(path.join(root,'tactical-lesson-learning-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}return validateTacticalLessonProtocol(p);
}
export function commitTacticalLessonProtocol(state,p){
  const hash=p?tacticalLessonDigest(p):null;
  if(state.tacticalLessonLearningHash)assert.equal(hash,state.tacticalLessonLearningHash,'Tactical lesson protocol changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Tactical lesson learning must start prospectively.');state.tacticalLessonLearningHash=hash;}
}
// A new run has its own iteration numbers. Bind a prospective replay floor to
// its existing lesson contract instead of rewriting historical commitments.
export function validateLessonReplayProtocol(p){
  assert.equal(p.contract,LESSON_REPLAY_CONTRACT);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.ok(Number.isSafeInteger(p.minimumSourceIteration)&&p.minimumSourceIteration>=1
    &&p.minimumSourceIteration<=p.afterIteration+1);
  assert.match(p.lessonProtocolHash,/^[a-f0-9]{64}$/);
  assert.ok(typeof p.engineFingerprint==='string'&&p.engineFingerprint.length>0);
  assert.ok(typeof p.teachingRevision==='string'&&p.teachingRevision.length>0);
  return p;
}
export async function readLessonReplayProtocol(root,lessonProtocol){
  let p;try{p=JSON.parse((await readFile(path.join(root,'lesson-replay-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  validateLessonReplayProtocol(p);validateTacticalLessonProtocol(lessonProtocol);
  assert.equal(p.lessonProtocolHash,tacticalLessonDigest(lessonProtocol),'Replay lesson contract changed.');
  return p;
}
export function commitLessonReplayProtocol(state,p){
  if(p){validateLessonReplayProtocol(p);assert.equal(state.tacticalLessonLearningHash,p.lessonProtocolHash,'Replay lesson contract changed.');}
  const hash=p?tacticalLessonDigest(p):null;
  if(state.tacticalLessonReplayHash)assert.equal(hash,state.tacticalLessonReplayHash,'Lesson replay protocol changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Lesson replay must start prospectively.');state.tacticalLessonReplayHash=hash;}
}
export function lessonReplayCommitment(protocol,replay,{iteration,engineFingerprint,revision}){
  validateTacticalLessonProtocol(protocol);
  assert.ok(Number.isSafeInteger(iteration)&&iteration>=1);
  if(replay){
    validateLessonReplayProtocol(replay);
    assert.equal(replay.lessonProtocolHash,tacticalLessonDigest(protocol),'Replay lesson contract changed.');
    if(iteration>replay.afterIteration){
      assert.equal(replay.engineFingerprint,engineFingerprint,'Replay engine changed.');
      assert.equal(replay.teachingRevision,revision,'Replay teaching revision changed.');
      return {minimumSourceIteration:replay.minimumSourceIteration,replayProtocolHash:tacticalLessonDigest(replay)};
    }
  }
  return {minimumSourceIteration:protocol.minimumSourceIteration,replayProtocolHash:null};
}
export function lessonTypes(sample){return Object.entries(LESSON_FLAGS).filter(([,flag])=>sample.steps.some(s=>s[flag])).map(([type])=>type);}
export function lessonInputKey(sample){
  return tacticalLessonDigest([sample.playerId,sample.steps.map(s=>[Array.from(s.state),Array.from(s.actions),
    Array.from(s.initialMemory),s.legalCount,s.legalActionKeys])]);
}
export function assertLessonSample(sample,role){
  assert.equal(sample.lessonRole,role,'A protected lesson crossed the train/validation boundary.');
  assert.equal(sample.imitation,true);assert.equal(sample.steps.length,1);
  const s=sample.steps[0];assert.equal(s.imitation,true);assert.equal(s.winProbabilityLabel,false);
  assert.equal(s.return,0);assert.equal(s.value,0);
  assert.ok(Number.isInteger(s.selectedIndex)&&s.selectedIndex>=0&&s.selectedIndex<s.legalCount);
  assert.equal(s.legalActionKeys.length,s.legalCount);assert.equal(s.legalActionKeys[s.selectedIndex],s.selectedActionKey);
  assert.ok(Number.isFinite(s.advantage)&&s.advantage>0);
}

// Newest evidence wins within a role. Validation owns any overlapping input;
// an old training label must not turn a held-out position into a train example.
export function buildLessonBank(training,validation,maximumPerType=64){
  for(const s of training)assertLessonSample(s,'training');for(const s of validation)assertLessonSample(s,'validation');
  const unique=items=>{const seen=new Set();return items.filter(s=>{const key=lessonInputKey(s);
    if(seen.has(key))return false;seen.add(key);return true;});};
  const held=unique(validation),heldKeys=new Set(held.map(lessonInputKey));
  const train=unique(training).filter(s=>!heldKeys.has(lessonInputKey(s)));
  const select=items=>{
    const selected=new Map(),counts=Object.fromEntries(Object.keys(LESSON_FLAGS).map(t=>[t,0]));
    for(const type of Object.keys(LESSON_FLAGS)){
      const groups=new Map();for(const s of items.filter(s=>lessonTypes(s).includes(type))){
        const id=s.deckId||'unknown';if(!groups.has(id))groups.set(id,[]);groups.get(id).push(s);
      }
      let count=0;const lists=[...groups.values()];
      for(let index=0;count<maximumPerType&&lists.some(a=>index<a.length);index++)for(const list of lists){
        if(list[index]&&count<maximumPerType){const s=list[index],key=lessonInputKey(s),types=lessonTypes(s);count++;
          if(!selected.has(key)&&types.every(t=>counts[t]<maximumPerType)){
            selected.set(key,s);for(const t of types)counts[t]++;
          }
        }
      }
    }
    return [...selected.values()];
  };
  return {training:select(train),validation:select(held),droppedTrainingOverlap:unique(training).length-train.length};
}

export async function freezeTacticalLessonBank({runDirectory,refreshDirectory,iteration,sourceSha256,engineFingerprint,revision,
  protocol,training,validation,replayProtocol=null}){
  const file=path.join(refreshDirectory,'lesson-bank.json.gz'),protocolHash=tacticalLessonDigest(protocol);
  const replay=lessonReplayCommitment(protocol,replayProtocol,{iteration,engineFingerprint,revision});
  const existing=await optional(file);
  if(existing){
    assert.equal(existing.contract,TACTICAL_LESSON_CONTRACT);assert.equal(existing.protocolHash,protocolHash);
    assert.equal(existing.iteration,iteration);assert.equal(existing.sourceSha256,sourceSha256);
    assert.equal(existing.engineFingerprint,engineFingerprint);assert.equal(existing.revision,revision);
    assert.equal(existing.replayProtocolHash||null,replay.replayProtocolHash,'Frozen lesson replay commitment changed.');
    if(replay.replayProtocolHash){
      assert.ok(Array.isArray(existing.protectedValidationKeys),'Missing protected replay inputs.');
      assert.equal(existing.protectedValidationHash,tacticalLessonDigest(existing.protectedValidationKeys),'Protected replay inputs changed.');
      const protectedKeys=new Set(existing.protectedValidationKeys);
      assert.ok(existing.validation.every(s=>protectedKeys.has(lessonInputKey(s))),'Unprotected replay validation input.');
    }
    for(const source of existing.sources){
      const relative=path.relative(path.resolve(runDirectory,'tactical-refresh'),path.resolve(source.path));
      assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Invalid lesson source path.');
      assert.equal(await fileHash(source.path),source.sha256,'Frozen lesson source changed.');
    }
    for(const s of existing.training)assertLessonSample(s,'training');for(const s of existing.validation)assertLessonSample(s,'validation');
    assert.equal(tacticalLessonDigest([existing.training,existing.validation]),existing.samplesHash);
    return existing;
  }
  const tagged=(samples,role)=>samples.map(s=>{assert.ok(!s.lessonRole||s.lessonRole===role,'Lesson role changed.');
    return {...s,lessonRole:role};});
  const train=tagged(training,'training'),held=tagged(validation,'validation');
  const refreshRoot=path.join(runDirectory,'tactical-refresh');
  let earlier=(await readdir(refreshRoot)).filter(n=>/^\d{6}$/.test(n)&&Number(n)<iteration&&Number(n)>=replay.minimumSourceIteration)
    .sort().reverse();
  // Preserve legacy selection exactly. New replay counts compatible completed
  // refreshes, so an incompatible/incomplete folder cannot consume a slot.
  if(!replay.replayProtocolHash)earlier=earlier.slice(0,protocol.replayRefreshes);
  const sources=[],replayRefreshIterations=[];
  for(const folder of earlier){
    if(replay.replayProtocolHash&&replayRefreshIterations.length>=protocol.replayRefreshes)break;
    const checkpointFile=path.join(refreshRoot,folder,'checkpoint.json.gz');
    try{await stat(checkpointFile);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    const report=await readTrajectoryArchive(checkpointFile);
    if(report.teachingRevision!==revision)continue;
    if(replay.replayProtocolHash&&report.engineFingerprint!==engineFingerprint)continue;
    assert.equal(report.engineFingerprint,engineFingerprint);
    if(replay.replayProtocolHash){
      assert.equal(report.contract,'prospective-public-tactical-refresh-v1','Invalid replay refresh contract.');
      assert.equal(report.iteration,Number(folder),'Replay refresh iteration changed.');
    }
    replayRefreshIterations.push(Number(folder));
    if(replay.replayProtocolHash)sources.push({path:checkpointFile,sha256:await fileHash(checkpointFile),iteration:Number(folder),role:'provenance'});
    if(report.lessonSupply){
      const filename=path.join(refreshRoot,folder,'lesson-supply.json.gz'),supply=await readTrajectoryArchive(filename);
      assert.equal(supply.contract,'prospective-verified-opening-growth-supply-v1');
      assert.equal(supply.sourceSha256,report.sourceSha256);assert.equal(supply.engineFingerprint,engineFingerprint);
      assert.equal(supply.teachingRevision,revision);assert.equal(supply.samplesHash,report.lessonSupply.samplesHash);
      assert.equal(tacticalLessonDigest([supply.training,supply.validation]),supply.samplesHash);
      sources.push({path:filename,sha256:await fileHash(filename),iteration:Number(folder),role:'fixed-in-archive'});
      for(const [role,target] of [['training',train],['validation',held]])for(const sample of supply[role]){
        assertLessonSample(sample,role);target.push(sample);
      }
    }
    for(const name of (await readdir(path.join(refreshRoot,folder,'games'))).filter(n=>/^\d+\.json\.gz$/.test(n)).sort((a,b)=>parseInt(a)-parseInt(b))){
      const filename=path.join(refreshRoot,folder,'games',name),game=await readTrajectoryArchive(filename);
      assert.equal(game.refreshContract,'prospective-public-tactical-refresh-v1');
      assert.equal(game.teachingRevision,revision);assert.equal(game.engineFingerprint,engineFingerprint);
      assert.equal(game.sourceSha256,report.sourceSha256);assert.equal(game.protocolHash,report.protocolHash);
      assert.equal(game.gameIndex,parseInt(name));assert.equal(game.partition,game.gameIndex%2?'validation':'training');
      if(!game.summary.completed)continue;
      sources.push({path:filename,sha256:await fileHash(filename),iteration:Number(folder),seed:game.seed,role:game.partition});
      const target=game.partition==='training'?train:held;
      for(const s of game.samples)if(lessonTypes(s).length){
        assert.ok(!s.lessonRole||s.lessonRole===game.partition,'A protected lesson crossed the train/validation boundary.');
        target.push({...s,deckId:game.summary.deckIds[0],lessonRole:game.partition,
          lessonSource:{path:filename,iteration:Number(folder),gameIndex:game.gameIndex}});
      }
    }
  }
  const bank=buildLessonBank(train,held,protocol.maximumPerType);
  // Even held-out positions omitted by the per-type cap must never become
  // general fresh training examples when the same input appears again.
  const protectedValidationKeys=replay.replayProtocolHash?[...new Set(held.map(lessonInputKey))].sort():null;
  const result={contract:TACTICAL_LESSON_CONTRACT,protocolHash,iteration,sourceSha256,engineFingerprint,revision,sources,...bank,
    ...(replay.replayProtocolHash?{replayProtocolHash:replay.replayProtocolHash,replayRefreshIterations,
      protectedValidationKeys,protectedValidationHash:tacticalLessonDigest(protectedValidationKeys)}:{}),
    samplesHash:tacticalLessonDigest([bank.training,bank.validation])};
  await writeTrajectoryArchive(file,result);return result;
}

export function measureLessonTypes(model,samples,{onDecision}={}){
  const metrics=Object.fromEntries(Object.keys(LESSON_FLAGS).map(type=>[type,{decisions:0,policyLoss:0,meanTargetProbability:0,decisionAccuracy:0}]));
  for(const sample of samples){
    const types=lessonTypes(sample);if(!types.length)continue;const s=sample.steps[0];
    const inferred=inferStep(model,s.state,s.actions,s.legalCount,resolveLessonMemory(model,sample)),logits=inferred.logits;
    assert.equal(logits.length,s.legalCount);assert.ok(logits.every(Number.isFinite));
    const maximum=Math.max(...logits),weights=logits.map(x=>Math.exp(x-maximum)),total=weights.reduce((a,b)=>a+b,0);
    const logProbability=logits[s.selectedIndex]-maximum-Math.log(total),probability=Math.exp(logProbability);
    onDecision?.(sample,logits.indexOf(maximum)===s.selectedIndex,logits);
    for(const type of types){const m=metrics[type];m.decisions++;m.policyLoss-=logProbability;m.meanTargetProbability+=probability;
      m.decisionAccuracy+=Number(logits.indexOf(maximum)===s.selectedIndex);}
  }
  for(const m of Object.values(metrics))if(m.decisions)for(const key of ['policyLoss','meanTargetProbability','decisionAccuracy'])m[key]/=m.decisions;
  return metrics;
}
export function tacticalLessonGuard(before,after){
  const failures=[];
  for(const type of Object.keys(LESSON_FLAGS)){
    const a=before[type],b=after[type];
    if(!a||!b||!Number.isSafeInteger(a.decisions)||a.decisions<0||a.decisions!==b.decisions){failures.push(`${type}:coverage`);continue;}
    if(!a.decisions)continue;
    if(!['policyLoss','meanTargetProbability','decisionAccuracy'].every(k=>Number.isFinite(a[k])&&Number.isFinite(b[k]))){failures.push(`${type}:nonfinite`);continue;}
    if(b.policyLoss>a.policyLoss+1e-7)failures.push(`${type}:loss`);
    // Log loss is the proper scoring rule: correcting a nearly impossible
    // target matters more than further sharpening an already certain target.
    // Mean confidence is reported, but is not a second optimization objective.
    if(b.decisionAccuracy+1e-7<a.decisionAccuracy)failures.push(`${type}:choices`);
  }
  return {passed:!failures.length,failures};
}
export function balancedLessonRound(bank,round,perType=8){
  const batch=[];
  for(const type of Object.keys(LESSON_FLAGS)){
    const examples=bank.training.filter(s=>lessonTypes(s).includes(type));
    if(!examples.length||!bank.validation.some(s=>lessonTypes(s).includes(type)))continue;
    for(let i=0;i<perType;i++){const s=examples[((round-1)*perType+i)%examples.length];assertLessonSample(s,'training');batch.push(s);}
  }
  return batch;
}
const targetProbability=(model,sample)=>{
  const s=sample.steps[0],logits=inferStep(model,s.state,s.actions,s.legalCount,resolveLessonMemory(model,sample)).logits;
  assert.ok(logits.every(Number.isFinite));const maximum=Math.max(...logits);
  return Math.exp(logits[s.selectedIndex]-maximum)/logits.reduce((sum,x)=>sum+Math.exp(x-maximum),0);
};
export function retentionLessonRound(bank,reference,current,perType=8){
  assert.equal(reference.length,bank.training.length);assert.equal(current.length,bank.training.length);
  assert.ok([...reference,...current].every(Number.isFinite));
  const selected=new Set();
  for(const type of Object.keys(LESSON_FLAGS)){
    const losses=bank.training.map((sample,index)=>({sample,index,drop:reference[index]-current[index]}))
      .filter(x=>lessonTypes(x.sample).includes(type)&&x.drop>1e-7)
      .sort((a,b)=>b.drop-a.drop||a.index-b.index).slice(0,perType);
    for(const x of losses){assertLessonSample(x.sample,'training');selected.add(x.sample);}
  }
  return [...selected];
}
const lessonScore=(metrics,allTypes=false)=>{
  const priority=['mulligan','growth'].filter(type=>metrics[type].decisions);
  const types=!allTypes&&priority.length?priority:Object.keys(LESSON_FLAGS).filter(type=>metrics[type].decisions);
  return types.length?types.reduce((sum,type)=>sum+metrics[type].policyLoss,0)/types.length:null;
};

// Fixed, bounded update schedule. Protected examples are only measured, never
// fed to an optimizer; no terminal outcomes, Q targets or GRU weights change.
export async function trainBalancedTacticalLessons({model,bank,training,validation=[],additionalValidation=[],protocol,iteration,measureGlobal,measureLocal,
  onRound=async()=>{},maintenance=null}){
  validateTacticalLessonProtocol(protocol);
  for(const s of bank.training)assertLessonSample(s,'training');for(const s of bank.validation)assertLessonSample(s,'validation');
  for(const s of training)assertLessonSample(s,'training');
  for(const s of additionalValidation)assertLessonSample(s,'validation');
  const heldKeys=new Set([...(bank.protectedValidationKeys||[]),...[...bank.validation,...validation,...additionalValidation].map(lessonInputKey)]);
  assert.ok(bank.training.every(s=>!heldKeys.has(lessonInputKey(s))),'Training bank overlaps protected validation.');
  const generalTraining=training.filter(s=>!heldKeys.has(lessonInputKey(s)));
  const before=measureGlobal(),localBefore=measureLocal?.()||null;
  const typeBefore=measureLessonTypes(model,bank.validation),trainBefore=measureLessonTypes(model,bank.training);
  const freshBefore=measureLessonTypes(model,validation);
  const additionalBefore=measureLessonTypes(model,additionalValidation);let additionalAfter=additionalBefore;
  const trainingReference=bank.training.map(s=>targetProbability(model,s));let trainingCurrent=trainingReference;
  let best=serializeNeuralModel(model),bestEpoch=0,after=before,localAfter=localBefore,typeAfter=typeBefore,trainAfter=trainBefore,freshAfter=freshBefore;
  let bestScore=lessonScore(typeBefore,Boolean(maintenance)),optimizer;
  const maintenanceTools=maintenance?await import('./lesson-maintenance.mjs'):null;
  const commonStep=maintenanceTools?.commonLessonStep;
  const measureRetention=s=>maintenanceTools?.measureLessonRetention(model,s);
  const retentionBefore=measureRetention(bank.validation),freshRetentionBefore=measureRetention(validation),additionalRetentionBefore=measureRetention(additionalValidation);
  const history=[],random=seededRandom((protocol.seed+Math.imul(iteration,104729))>>>0);
  try{
    for(let round=1;round<=protocol.maximumRounds;round++){
      const focus=balancedLessonRound(bank,round,protocol.examplesPerTypePerRound);if(!focus.length)break;
      // Rehearse individual training positions that are being forgotten. These
      // references come exclusively from training, never from held-out scores.
      const retention=retentionLessonRound(bank,trainingReference,trainingCurrent,protocol.retentionPerTypePerRound);
      const general=generalTraining.length?Array.from({length:8},(_,i)=>generalTraining[((round-1)*8+i)%generalTraining.length]):[];
      let commonUpdate=null;
      if(commonStep)commonUpdate=commonStep(model,bank,maintenance);
      else {
      const fit=trainBehaviorCloning(model,contextualLessonSamples(model,[...focus,...retention,...general]),{epochs:1,batchSize:8,sequenceLength:1,learningRate:protocol.learningRate,
        optimizer,random,auxiliary:true,policyInitializationOnly:true,valueCoefficient:0,beliefCoefficient:0,entropyCoefficient:0.002});
      optimizer=fit.optimizer;assert.ok(fit.history.every(h=>Number.isFinite(h.loss)),'Nonfinite focused lesson update.');
      }
      const global=measureGlobal(),local=measureLocal?.()||null,types=measureLessonTypes(model,bank.validation),train=measureLessonTypes(model,bank.training);
      trainingCurrent=bank.training.map(s=>targetProbability(model,s));
      const guard=(a,b,c,s)=>maintenanceTools?maintenanceTools.lessonSafetyGuard(c,measureRetention(s)):tacticalLessonGuard(a,b);
      const globalGuard=tacticalSelectionGuard(before,global),typeGuard=guard(typeBefore,types,retentionBefore,bank.validation),trainGuard=tacticalLessonGuard(trainBefore,train);
      const freshTypes=measureLessonTypes(model,validation),freshGuard=guard(freshBefore,freshTypes,freshRetentionBefore,validation);
      const additionalTypes=measureLessonTypes(model,additionalValidation),additionalGuard=guard(additionalBefore,additionalTypes,additionalRetentionBefore,additionalValidation);
      const localSafe=!localBefore||local.policyLoss<=localBefore.policyLoss+1e-7&&local.decisionAccuracy+1e-7>=localBefore.decisionAccuracy;
      const score=lessonScore(types,Boolean(maintenance)),accepted=globalGuard.passed&&typeGuard.passed&&trainGuard.passed&&freshGuard.passed&&additionalGuard.passed&&localSafe
        &&Number.isFinite(score)&&Number.isFinite(bestScore)&&score<bestScore-1e-6;
      if(accepted){best=serializeNeuralModel(model);bestEpoch=round;bestScore=score;after=global;localAfter=local;typeAfter=types;trainAfter=train;freshAfter=freshTypes;additionalAfter=additionalTypes;}
      history.push({round,accepted,globalGuard,typeGuard,trainGuard,freshGuard,additionalGuard,localSafe,retentionExamples:retention.length,types,global,...(commonUpdate?{commonUpdate}:{})});
      await onRound({round,rounds:protocol.maximumRounds,bestRound:bestEpoch,accepted,typeGuard,globalGuard});
    }
  }finally{optimizer?.dispose();}
  return {best,bestEpoch,before,after,localAfter,history,lessonLearning:{contract:TACTICAL_LESSON_CONTRACT,protocolHash:tacticalLessonDigest(protocol),
    trainingCounts:Object.fromEntries(Object.entries(trainBefore).map(([k,v])=>[k,v.decisions])),
    validationCounts:Object.fromEntries(Object.entries(typeBefore).map(([k,v])=>[k,v.decisions])),
    before:typeBefore,after:typeAfter,trainingBefore:trainBefore,trainingAfter:trainAfter,freshBefore,freshAfter,
    ...(additionalValidation.length?{additionalBefore,additionalAfter}:{}),
    guard:maintenance?(history.find(h=>h.round===bestEpoch)?.typeGuard||{passed:true,failures:[]}):tacticalLessonGuard(typeBefore,typeAfter),bestRound:bestEpoch,rounds:history.length,
    replaySources:bank.sources?.length||0,excludedGeneralOverlap:training.length-generalTraining.length,
    ...(bank.replayProtocolHash?{replayProtocolHash:bank.replayProtocolHash,replayRefreshIterations:bank.replayRefreshIterations}:{}),
    ...(maintenance?{maintenanceHash:tacticalLessonDigest(maintenance),allTypesSelection:true}:{}),
    heldOutLabelsTrained:false,policyOnly:true,winProbabilityLabels:false}};
}
