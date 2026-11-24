import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readTrajectoryArchive as read,writeTrajectoryArchive as write} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {neuralBehaviorHash} from '../src/ai/neural/evaluator-certification.mjs';
import {digest} from './adaptive-policy-q-contract.mjs';
import {renameWithRetrySync} from './file-replace.mjs';
import {collectSupplyPrefix,createSupplyGame} from './tactical-lesson-supply.mjs';
import {assertLessonSample,tacticalLessonDigest} from './tactical-lesson-learning.mjs';
import {lessonMemoryCoverage} from './lesson-memory-context.mjs';
import {experimentArms,experimentInitial,leagueEvaluationJobs,runLeagueEvaluationJob} from './league-policy-experiment.mjs';
import {measurePolicyChange,selectScreenCandidate,confirmLearningAnchor,assertSelectionRows,assertAnchorEvaluationSchedule} from './learning-anchor-selection.mjs';

const optional=async f=>read(f).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const unwrap=p=>p.candidateCheckpoint||p.checkpoint||p;
const publicKey=s=>digest([s.playerId,s.steps[0].state,s.steps[0].actions,s.steps[0].legalActionKeys]);

export async function prepareStartingPointLessons(config,frozen,champion,status){
  const file=path.join(config.directory,'contextual-lessons.json.gz'),saved=await optional(file);
  if(saved){assert.equal(saved.comparisonConfigHash,digest(config));return saved;}
  const bank={...frozen.bank,training:[...frozen.bank.training],validation:[...frozen.bank.validation]};
  const used=new Set([...bank.training,...bank.validation].map(publicKey)),reports=[];
  // One frozen teacher supplies BOTH arms. Training/evaluation game seeds and
  // correction train/validation roles remain separate. The teacher's proof
  // rules and labels are unchanged; winning a game does not create a label.
  for(const [index,deck] of config.decks.entries())for(let repeat=0;repeat<4;repeat++){
    const role=repeat%2?'validation':'training',seed=(config.correctionSeed+index*100003+repeat*13007)>>>0;
    const result=collectSupplyPrefix({game:createSupplyGame([deck,deck],seed,Math.floor(repeat/2)?'p1':'p2'),model:champion,
      role,familyId:`anchor-opening-${seed}`,deckIds:[deck.id,deck.id],engineFingerprint:config.engineFingerprint,
      origin:'frozen-champion-opening',openingOnly:true});
    let added=0;
    for(const sample of result.samples){assertLessonSample(sample,role);const key=publicKey(sample);
      if(used.has(key))continue;used.add(key);bank[role].push(sample);added++;}
    reports.push({deckId:deck.id,role,seed,failure:result.failure,accepted:result.samples.length,added});
    await status('preparing-contextual-lessons',{deckId:deck.id,repeat,added});
  }
  bank.samplesHash=tacticalLessonDigest([bank.training,bank.validation]);
  const output={...frozen,bank,comparisonConfigHash:digest(config),contextualSupply:reports,
    memoryCoverage:{training:lessonMemoryCoverage(bank.training),validation:lessonMemoryCoverage(bank.validation)}};
  await write(file,output);return output;
}

export async function evaluateStartingPointLearning({config,state,opponents,protocols,status}){
  const root=config.directory,arms=experimentArms(config),runtime=protocols.maintenance.evaluationRuntime;
  const {evaluateNeuralModels}=await import(pathToFileURL(path.join(runtime,'src/ai/neural/selfplay.mjs')));
  const {evaluationReviewOptions}=await import(pathToFileURL(path.join(runtime,'scripts/evaluation-decision-review.mjs')));
  const options=evaluationReviewOptions(config.evaluationReview),changes={},models={},results={};
  const lessons=await read(path.join(root,'contextual-lessons.json.gz'));
  try{
    for(const arm of arms){
      models[`${arm}-initial`]=deserializeNeuralModel(unwrap(await read(experimentInitial(config,arm).path)));
      models[arm]=deserializeNeuralModel(unwrap(await read(state.arms[arm].learnerPath)));
      let acceptedEpochs=0;
      for(let i=1;i<=config.iterations;i++){
        const candidate=await read(path.join(root,arm,'iterations',String(i).padStart(6,'0'),'candidate.json.gz'));
        acceptedEpochs+=candidate.epochGuards.filter(g=>g.passed).length;
      }
      changes[arm]={...measurePolicyChange(models[`${arm}-initial`],models[arm],lessons.bank.training),acceptedEpochs};
    }
    await write(path.join(root,'policy-change.json.gz'),{configHash:digest(config),changes});
    const evaluate=async(name,stage)=>{
      const candidate=models[name],jobs=leagueEvaluationJobs(config,stage);
      const binding={configHash:digest(config),stage,candidateHash:neuralBehaviorHash(candidate),
        opponentHash:neuralBehaviorHash(opponents[0]),jobs,review:config.evaluationReview};
      // Content-addressed reuse is valid only for identical weights, review,
      // opponent, seeds and jobs. Generation equality is insufficient.
      const directory=path.join(root,'comparison',stage,digest(binding));await fs.mkdir(directory,{recursive:true});
      const rows=[];
      for(const job of jobs){
        const file=path.join(directory,`${job.index}.json.gz`),partial=path.join(directory,`${job.index}.partial.json`);
        const prior=await optional(file);
        const resumed=prior||await fs.readFile(partial,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(resumed)assert.equal(resumed.planHash,digest(binding));
        if(prior){assert.equal(prior.summaries.length,job.games);assertSelectionRows(prior.summaries);rows.push(...prior.summaries);continue;}
        const summaries=resumed?.summaries||[];
        await status('starting-point-evaluation',{stageName:stage,arm:name,job:job.index,jobs:jobs.length,savedGames:summaries.length});
        const outcome=runLeagueEvaluationJob(evaluateNeuralModels,candidate,opponents[0],job,{...options,greedy:true,maxActions:2400,
          engineFingerprint:config.engineFingerprint,resumedSummaries:summaries,
          onGameComplete:({game,summary})=>{summaries[game-1]=summary;const tmp=`${partial}.tmp-${process.pid}`;
            writeFileSync(tmp,JSON.stringify({planHash:digest(binding),summaries}));renameWithRetrySync(tmp,partial);}});
        assertSelectionRows(outcome.summaries);await write(file,{planHash:digest(binding),summaries:outcome.summaries});rows.push(...outcome.summaries);
      }
      assertAnchorEvaluationSchedule(config,rows,stage);return rows;
    };
    for(const arm of arms){
      // No long match test for a rejected/tiny update. Its baseline still
      // measures the old starting point, but is never labelled as a new fit.
      results[`${arm}-initial`]=await evaluate(`${arm}-initial`,'screen');
      results[arm]=changes[arm].acceptedEpochs>0&&changes[arm].meanTotalVariation>=config.minimumMeanPolicyChange
        ?await evaluate(arm,'screen'):results[`${arm}-initial`];
    }
    const selected=selectScreenCandidate(arms,results,changes,config.minimumMeanPolicyChange);
    const screen={configHash:digest(config),changes,selected,rows:results,promotionEligible:false};
    await write(path.join(root,'screen.json.gz'),screen);
    if(!selected)return {status:'no-improving-candidate',changes,selected:null,promotionEligible:false};
    // Lock the endpoint BEFORE touching the fresh confirmation namespace.
    const decisionFile=path.join(root,'screen-selection.json.gz'),old=await optional(decisionFile);
    const decision={configHash:digest(config),selected,candidatePath:state.arms[selected.arm].learnerPath,
      candidateHash:neuralBehaviorHash(models[selected.arm]),screenHash:digest(screen)};
    if(old)assert.equal(digest(old),digest(decision));else await write(decisionFile,decision);
    const candidate=await evaluate(selected.arm,'confirmation'),reference=await evaluate('current-start-initial','confirmation');
    const confirmation=confirmLearningAnchor(candidate,reference);
    const result={...decision,status:confirmation.accepted?'confirmed-learning-anchor':'confirmation-inconclusive',
      changes,confirmation,promotionEligible:false,engineFingerprint:config.engineFingerprint,
      championHash:neuralBehaviorHash(opponents[0]),referencePath:experimentInitial(config,'current-start').path};
    await write(path.join(root,'confirmation.json.gz'),{...result,candidateRows:candidate,referenceRows:reference});
    return result;
  }finally{Object.values(models).forEach(disposeNeuralModel);}
}
