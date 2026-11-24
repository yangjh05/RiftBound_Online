import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import v8 from 'node:v8';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const project=process.cwd();
const source=path.resolve('.tmp-kaisa-viktor-fullmatch-20261013/deep-review');
const destination=path.resolve(process.argv[2]||'data/ai/manual-kaisa-viktor-review-20261014');
const league=path.resolve('data/ai/deck-league-20261007');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const write=(name,data)=>fs.writeFileSync(path.join(destination,name),JSON.stringify(data,null,2));
fs.mkdirSync(destination,{recursive:true});
const active=json(path.join(league,'execution-active.json'));
const repair=json(path.join(league,active.directory,'repair.json'));
const preparedRuntime=process.argv[3]?json(path.resolve(process.argv[3])):null;
const runtime=preparedRuntime?.runtime||repair.trainingRuntime;
assert.equal(sha(runtime.manifest.path),runtime.manifest.sha256);
for(const item of json(runtime.manifest.path))assert.equal(sha(path.join(runtime.directory,item.path)),item.sha256,item.path);
const load=f=>import(pathToFileURL(path.join(runtime.directory,f)).href);
const A=await load('src/ai/actions.mjs'), E=await load('src/engine.mjs');
const {needsPaymentOptionDecision}=await load('src/ai/payment-options.mjs');
const {cards}=await load('src/cards.mjs');
const Enc=await load('src/ai/neural/encoding.mjs');
const catalog=new Map(Object.values(cards).map(c=>[c.id,c]));
const names=['main','k5-poro-corrected','k5-star','k5-rain','cf-singularity-poro','cf-singularity-star',
  'v3-captain-base','captain-base-rain','captain-rain-pass','leader-base','leader-base-develop','leader-end-no-rain'];
const files=[];
const records=Object.fromEntries(names.map(name=>{
  const file=path.join(source,name,'journal.jsonl');files.push({path:file,sha256:sha(file)});
  const originFile=path.join(source,name,'origin.json');
  const origin=fs.existsSync(originFile)?json(originFile):null;
  if(origin)files.push({path:originFile,sha256:sha(originFile)});
  return [name,{name,origin,synthetic:name.startsWith('cf-'),rows:fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}];
}));
function history(name,limit){const r=records[name];return [...(r.origin?history(r.origin.session,r.origin.index):[]),
  ...r.rows.slice(0,limit).map(x=>({...x,source:name}))];}
const initialFile=path.join(source,'main/before-0.json.gz');files.push({path:initialFile,sha256:sha(initialFile)});
const initial=JSON.parse(zlib.gunzipSync(fs.readFileSync(initialFile)));
const familyId='reviewed-kaisa-viktor-'+digest(initial).slice(0,16);
const definitions=new Map();
function visit(x){if(!x||typeof x!=='object')return;if(x.instanceId&&x.id&&x.type)definitions.set(x.id,x);for(const v of Object.values(x))if(v&&typeof v==='object')visit(v);}
visit(initial);
const definitionMismatch=[];
for(const [id,c] of definitions){const live=catalog.get(id);for(const k of ['type','energy','might','domains','power','effects']){
  if(!live||digest(c[k]??null)!==digest(live[k]??null))definitionMismatch.push({id,name:c.name,field:k,source:c[k],live:live?.[k]});
}}
const replays=[];const positions=[];const seen=new Set();const observationCache=new Map();
for(const name of names.filter(n=>!records[n].synthetic)){
  const g=structuredClone(initial),prefix={p1:[],p2:[]};let checked=0,failure=null;
  const paymentObservations=new WeakMap();let optionalWindows=0;const humanOverrides=[];
  const branchPositions=[];
  try{for(const row of history(name)){
    assert.equal(A.activeActorId(g),row.actor,'actor');assert.equal(g.turnSequence,row.before.sequence,'turn sequence');
    const a=structuredClone(row.action);
    if(a.kind==='skipMulligan'){a.kind='submitMulligan';a.cardIds=[];}
    if(a.kind==='chooseEffectOption'&&!g.pendingChoice?.options?.some(x=>x.id===a.optionId)){
      const index=row.before.choice.options.findIndex(x=>x.id===a.optionId),option=g.pendingChoice?.options?.[index];
      assert.ok(index>=0&&option);assert.equal(option.label,row.before.choice.options[index].label);a.optionId=option.id;
    }
    const p=g.players.find(p=>p.id===row.actor);
    for(const [kind,key,pool] of [['togglePaymentPoolPower','powerId','power'],['togglePaymentPoolEnergy','energyId','energy']]){
      if(a.kind===kind&&!p.runePool[pool].some(x=>x.id===a[key])){assert.equal(p.runePool[pool].length,1);a[key]=p.runePool[pool][0].id;}
    }
    const observationKey=row.source+':'+row.index;
    // Trigger choice IDs are generated during replay. Never reuse another
    // branch's action list for a pending choice, even with the same source row.
    const cached=g.pendingChoice?null:observationCache.get(observationKey);
    // Self-play skips mechanical payment steps without advancing neural memory.
    const payment=g.pendingPayment;
    const policyOpportunity=!payment||(needsPaymentOptionDecision(g)&&!paymentObservations.has(payment));
    const legal=policyOpportunity?(cached?.legal||A.enumerateAiPolicyActions(g,row.actor)):[];
    const target=legal.findIndex(x=>A.actionKey(x)===A.actionKey(a));
    if(payment&&policyOpportunity){paymentObservations.set(payment,legal);optionalWindows++;}
    // A legal human move can lie outside the AI's pruned action candidates.
    // It still advances the observation memory exactly once, but supplies no label.
    if(!payment&&legal.length&&target<0)humanOverrides.push({source:row.source,index:row.index,kind:a.kind});
    if(payment&&a.kind==='confirmPayment'&&paymentObservations.has(payment)){
      const effectIds=(payment.optionalPowerEffects||payment.optionalEffects||[]).filter(e=>e.selected).map(e=>e.id).sort();
      assert.ok(paymentObservations.get(payment).some(x=>x.kind==='choosePaymentOptions'&&digest([...x.effectIds].sort())===digest(effectIds)),
        'Manual optional costs do not map to one legal policy selection');
    }
    if(legal.length){
      const encoded=cached?.encoded||Array.from(Enc.encodeState(g,row.actor));
      if(!cached)observationCache.set(observationKey,{legal,encoded});
      const key=row.source+':'+row.index;
      if(target>=0&&!row.automatic&&legal.length>1&&!/^(togglePayment|confirmPayment|activateRune)/.test(a.kind)&&!seen.has(key)){
        seen.add(key);branchPositions.push({key,source:row.source,index:row.index,branch:name,actor:row.actor,
          action:a,reason:row.reason,verdict:row.verdict,turn:g.turnNumber,sequence:g.turnSequence,
          familyId,role:'training-candidate',policyOnly:true,winProbabilityLabel:false,
          selectedIndex:target,legalActions:legal,publicState:encoded,
          observationPrefix:prefix[row.actor].slice(),memoryContextCertified:true,game:A.cloneGame(g)});
      }
      prefix[row.actor].push(encoded);
    }
    const result=A.applyAiAction(g,a,row.actor,{skipCombatPlan:true});assert.equal(result?.ok,true,JSON.stringify(result));
    assert.deepEqual(g.players.map(p=>p.score),row.after.score,'score');assert.deepEqual(A.auditRecordedDecisionSafety(g),[]);checked++;
  }}catch(error){failure={step:checked,message:error.message};}
  const original=json(path.join(source,name,'state.json'));
  const completed=!failure&&g.phase==='complete'&&g.winnerId===original.winnerId;
  const rec={name,checked,completed,failure,score:g.players.map(p=>p.score),winner:g.winnerId,positions:branchPositions.length,optionalWindows,
    memoryContract:'complete-actor-observation-prefix-v1',manualOptionalPaymentAggregation:true,humanOverrides};
  replays.push(rec);positions.push(...branchPositions.map(p=>({...p,completeReplay:completed})));
  console.log(JSON.stringify(rec));
}
const body={contract:'reviewed-matchup-evidence-v1',createdAt:new Date().toISOString(),familyId,
  role:'training-only-candidate-family',allBranchesOneFamily:true,terminalWinRateLabels:false,
  sourceFiles:files,activeExecution:active,activeTrainingRuntime:repair.trainingRuntime,replayRuntime:runtime,
  liveTrainingActivated:false,definitionMismatch,replays,
  positions:positions.length,automaticLabels:0,requiresIndependentPublicVerification:true,
  reviewCorrections:[
    {kind:'user-strategic-hypothesis',claim:'Evaluate Icathian Rain as clearing recruits together with medium units and delaying Viktor rebuilding; do not reward it merely for removing two units when Falling Star is cheaper.'},
    {kind:'opponent-model-requirement',claim:'Include Viktor preserving Vanguard Captain, Viktor Leader and surplus recruits in base; never assume voluntary overcommitment to a battlefield.'},
    {kind:'replay-supported-counterexample',branches:['leader-end-no-rain','leader-base-develop'],claim:'A win in a Rain branch does not establish Rain was necessary. Recorded legal alternatives win without playing Rain.'},
    {kind:'withdrawn-reasoning',branch:'v3-captain-base',turn:5,claim:'Exclude the explanation that holding Zaun and reconquering that same battlefield in the same turn gives another point.'},
    {kind:'statistical-limitation',claim:'These branches share an initial game and reviewed interventions; no independent win-rate, first-seat/second-seat win-rate or global-optimality label is supported.'}
  ],
  syntheticBranches:names.filter(n=>records[n].synthetic),
  restrictions:['Do not relabel human choices as independently verified teacher labels.','A complete legal replay does not prove optimality.',
    'Never split these branches or hidden-state perturbations into independent validation.',
    'Exclude corrected score reasoning and withdrawn automated win-rate results.',
    'Observation prefixes include one observation per optional-payment policy choice, no mechanical payment steps, and every forced non-payment policy decision.',
    'Reconstruct memory from the complete acting-player observation prefix; do not use opponent private cards or actual future draws as inputs.']};
write('manifest.json',body);
fs.writeFileSync(path.join(destination,'source-reviews.json.gz'),zlib.gzipSync(JSON.stringify(records)));
fs.writeFileSync(path.join(destination,'candidate-positions.bin'),v8.serialize(positions));
fs.writeFileSync(path.join(destination,'candidate-index.json'),JSON.stringify(positions.map(({game,observationPrefix,publicState,legalActions,...p})=>({...p,prefixLength:observationPrefix.length,legalCount:legalActions.length})),null,2));
console.log(JSON.stringify({destination,positions:positions.length,definitionMismatches:definitionMismatch.length,completedReplays:replays.filter(x=>x.completed).length}));
