import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {DECK_LEAGUE,digest,unwrap,scopedLessons,validateLeague,inputKey} from './deck-league-contract.mjs';
import {extendLeagueRuntime,LEAGUE_RUNTIME_EXTENSIONS} from './deck-league-runtime.mjs';
import {sha,json,atomic,verifyArtifact,exists} from './deck-league-io.mjs';

export async function initializeLeague(sourceConfigFile,directory){
  const old=json(sourceConfigFile),root=path.resolve(directory),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  if(exists(path.join(root,'config.json')))throw new Error('League already initialized; use the existing immutable config.');
  fs.mkdirSync(root,{recursive:true});
  verifyArtifact(old.runtimeManifest);
  const runtime=path.join(root,'runtime'),manifest=json(old.runtimeManifest.path),changes=[];
  for(const entry of manifest){const source=path.join(old.runtimeDirectory,entry.path);assert.equal(sha(source),entry.sha256);
    const target=path.resolve(runtime,entry.path);assert.ok(target.startsWith(runtime+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});
    if(LEAGUE_RUNTIME_EXTENSIONS.includes(entry.path)){
      fs.writeFileSync(target,extendLeagueRuntime(entry.path,fs.readFileSync(source,'utf8')));
      changes.push({path:entry.path,before:entry.sha256,after:sha(target)});
    }else fs.copyFileSync(source,target);
  }
  // Dependencies resolve locally; no mixing current engine/cards with the frozen run.
  if(!exists(path.join(runtime,'node_modules')))fs.symlinkSync(path.join(project,'node_modules'),path.join(runtime,'node_modules'),'junction');
  const runtimeFiles=manifest.map(e=>({path:e.path,sha256:sha(path.join(runtime,e.path))}));
  atomic(path.join(root,'runtime-manifest.json'),runtimeFiles);
  const load=f=>import(pathToFileURL(path.join(runtime,f)).href);
  const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
  const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');
  const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
  const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
  const {makeEvaluationReview}=await load('scripts/evaluation-decision-review.mjs');
  const {trainingDeckRecord,assertLegalTrainingDeck}=await load('src/ai/legal-decks.mjs');
  const {mergeCandidateLessons}=await import('./viktor-candidate-learning.mjs');
  const bank=await read(verifyArtifact(old.lessons)),opening=await read(verifyArtifact(old.openingLessons));
  const history=await read(verifyArtifact(old.priorTrainingInputs));
  const merged=mergeCandidateLessons(bank,[...opening.training,...opening.validation],history.keys);
  const profiles=[];
  const ids=['sett','annie','kaisa','master-yi-no-aurora','master-yi-aurora','leona','viktor'];
  const labels=['세트','애니','카이사','마스터 이 · 비오로라','마스터 이 · 오로라','레오나','빅토르'];
  // Deck order is never guessed: the authored candidate uses this fixed order;
  // additionally identify every profile from the known immutable deck ID.
  const deckIds=['origins-sett','search-afdf4d4f1e9057e652751456c638bd5b09c4f4f9aef311be9bd17ab2bf9884b5','origins-kaisa',
    'search-c39478baa35b3173e6d95ba83a5b3f85d942a9dd76adb3609da63ff3ce84018f','search-7a906363f9377785e6194576f65ef656be377f318bebad0285715359ec0d995e','origins-leona',old.deckId];
  for(let i=0;i<ids.length;i++){
    const deck=old.decks.find(d=>d.id===deckIds[i]);assert.ok(deck,`Missing ${ids[i]}`);assertLegalTrainingDeck(deck);
    const dir=path.join(root,'profiles',ids[i]);fs.mkdirSync(dir,{recursive:true});
    const source=i===6?old.specialist:old.parent;verifyArtifact(source);
    const initial=path.join(dir,'initial.json.gz');fs.copyFileSync(source.path,initial);
    const payload=await read(initial),model=deserialize(unwrap(payload)),ownBank=scopedLessons(merged,deck.id);
    let behaviorHash;
    try{const s=ownBank.bank.validation[0].steps[0];assert.ok(inferStep(model,s.state,s.actions,s.legalCount,s.initialMemory).logits.every(Number.isFinite));behaviorHash=neuralBehaviorHash(model);}finally{dispose(model);}
    await write(path.join(dir,'lessons.json.gz'),ownBank);
    const record={...trainingDeckRecord(deck),chosenChampion:deck.chosenChampion?.cardNumber||deck.champion?.cardNumber||null};
    profiles.push({id:ids[i],label:labels[i],deck,deckHash:digest(deck),deckRecord:record,
      initial:{path:initial,sha256:sha(initial),source:source.path,behaviorHash,generation:unwrap(payload).generation},
      lessons:{path:path.join(dir,'lessons.json.gz'),sha256:sha(path.join(dir,'lessons.json.gz'))}});
  }
  const protocolsFile=path.join(root,'protocols.json.gz');fs.copyFileSync(verifyArtifact(old.protocols),protocolsFile);
  const globalProtected=[...new Set(merged.bank.validation.map(inputKey))].sort();
  await write(path.join(root,'input-protection.json.gz'),{contract:'league-input-roles-v1',protected:globalProtected,trained:history.keys,
    source:old.lessons,priorTrainingInputs:old.priorTrainingInputs,neverRelabelEvaluation:true});
  const config={contract:DECK_LEAGUE,createdAt:new Date().toISOString(),directory:root,projectDirectory:project,runtimeDirectory:runtime,
    runtimeManifest:{path:path.join(root,'runtime-manifest.json'),sha256:sha(path.join(root,'runtime-manifest.json'))},
    engineFingerprint:computeEngineFingerprint(),sourceEngineFingerprint:old.engineFingerprint,sourceIteration:old.sourceIteration,
    sourceConfig:{path:path.resolve(sourceConfigFile),sha256:sha(sourceConfigFile)},runtimeChanges:changes,
    protocols:{path:protocolsFile,sha256:sha(protocolsFile)},
    inputProtection:{path:path.join(root,'input-protection.json.gz'),sha256:sha(path.join(root,'input-protection.json.gz'))},
    profiles,seed:20261007,protectedSeeds:old.protectedSeeds,maximumProcesses:16,priority:'normal',workerProcesses:2,gamesPerOpponent:4,epochs:4,
    rotation:['kaisa','sett','viktor','master-yi-no-aurora','master-yi-aurora','annie','leona'],
    evaluation:{everyIterations:4,screenBlocks:2,confirmationBlocks:16,alpha:.05,maximumMatchupRegression:.10,minimumMeanImprovement:.02},
    evaluationReview:makeEvaluationReview(),legacyRuns:[old.mainRunDirectory,path.resolve('data/ai/viktor-mirror-pilot-20260929')],
    executionFiles:{}};
  for(const name of ['train-deck-league.mjs','deck-league-contract.mjs','deck-league-io.mjs','deck-league-evaluation.mjs']){
    const target=path.join(root,'execution',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,'scripts',name),target);config.executionFiles[name]=sha(target);
  }
  validateLeague(config);atomic(path.join(root,'config.json'),config);
  atomic(path.join(root,'initialization.json'),{configHash:digest(config),at:new Date().toISOString(),profiles:profiles.map(p=>({id:p.id,sha256:p.initial.sha256,behaviorHash:p.initial.behaviorHash})),runtimeChanges:changes,
    originalModelsModified:false,protectedInputs:globalProtected.length,priorTrainingInputs:history.keys.length});
  return config;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const c=await initializeLeague(process.argv[2],process.argv[3]);console.log(JSON.stringify({directory:c.directory,profiles:c.profiles.map(p=>p.id),configHash:digest(c)}));
}
