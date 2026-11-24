import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decklists} from '../src/cards.mjs';
import {activeActorId,actionKey,enumerateAiPolicyActions,applyAiAction} from '../src/ai/actions.mjs';
import {createNeuralModel,createNeuralSession,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {openingDevelopmentAdvice} from '../src/ai/opening-development.mjs';
import {LESSON_SUPPLY_CONTRACT,LESSON_SUPPLY_LIMITS,validateLessonSupplyProtocol,commitLessonSupplyProtocol,
  acceptedSupplyAdvice,supplySample,createSupplyGame,hasGrowthOpening,collectSupplyPrefix,selectSourceGameIndexes,supplySeed,alignReplayTriggerIds}
  from '../scripts/tactical-lesson-supply.mjs';
import {TACTICAL_TEACHING_REVISION} from '../scripts/response-aware-demonstration.mjs';
const rows=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ai-growth-horizon-20260927.json.gz',import.meta.url))));
const fixture=()=>structuredClone(rows.find(r=>r.index===6));
const protocol={contract:LESSON_SUPPLY_CONTRACT,teachingRevision:TACTICAL_TEACHING_REVISION,afterIteration:210,seed:2026092802,...LESSON_SUPPLY_LIMITS};
const decision=(game,id,action={kind:'endTurn'})=>{const legal=enumerateAiPolicyActions(game,id);return {action,legalActions:legal,
  legalCount:legal.length,probabilities:legal.map(()=>1/legal.length)};};

test('supply is prospective, bounded and cannot silently change a committed protocol',()=>{
  assert.deepEqual(validateLessonSupplyProtocol(protocol),protocol);const s={iteration:210};
  commitLessonSupplyProtocol(s,protocol);commitLessonSupplyProtocol(s,protocol);
  assert.throws(()=>commitLessonSupplyProtocol(s,null));assert.throws(()=>commitLessonSupplyProtocol({iteration:211},protocol));
  assert.throws(()=>validateLessonSupplyProtocol({...protocol,maximumGrowthReviews:100}));
});
test('no label for arbitrary, tied, low-gain, incomplete or illegal teacher suggestions',()=>{
  const {game,actorId}=fixture(),d=decision(game,actorId),action=d.legalActions.find(a=>a.kind==='beginPlayCard');
  for(const advice of [null,{action,searchComplete:true,weight:1},
    {action,searchComplete:false,weight:.5,mulliganLesson:true,gain:100},
    {action,searchComplete:true,weight:.5,mulliganLesson:true,gain:.749},
    {action:d.action,searchComplete:true,weight:.5,mulliganLesson:true,gain:1},
    {action:{kind:'invented'},searchComplete:true,weight:.5,mulliganLesson:true,gain:1}])
    assert.equal(acceptedSupplyAdvice(game,actorId,d,{teacher:()=>advice}),null);
});
test('growth keeps the same concrete known-deployment comparison and threshold',()=>{
  const {game,actorId}=fixture(),advice=acceptedSupplyAdvice(game,actorId,decision(game,actorId));
  assert.ok(advice?.growthLesson);assert.equal(advice.action.cardId,'c82');
  assert.ok(advice.supplyProof.gain>=.5);assert.equal(advice.supplyProof.thresholdsUnchanged,true);
  assert.equal(advice.supplyProof.globalOptimalityClaim,false);
  assert.ok(advice.supplyProof.comparisons.every(c=>c.searchComplete));
  assert.ok(advice.supplyProof.assumptions.includes('passive-opponent-resource-projection'));
});
test('immediate deployment and score-race uncertainty still exclude growth lessons',()=>{
  const {game,actorId}=fixture(),p=game.players.find(p=>p.id===actorId);
  p.champion.energy=2;assert.equal(acceptedSupplyAdvice(game,actorId,decision(game,actorId)),null);
  const f=fixture();f.game.players.find(p=>p.id!==f.actorId).score=7;
  assert.equal(acceptedSupplyAdvice(f.game,f.actorId,decision(f.game,f.actorId)),null);
});
test('unresolved or contradictory opponent response cannot create a growth label',()=>{
  const {game,actorId}=fixture();game.players.find(p=>p.id!==actorId).runes.forEach(r=>r.exhausted=false);
  const d=decision(game,actorId),responseContext={};
  assert.equal(acceptedSupplyAdvice(game,actorId,d,{responseContext,responseTeacher:()=>null}),null);
  assert.equal(acceptedSupplyAdvice(game,actorId,d,{responseContext,responseTeacher:()=>({growthLesson:true,action:d.action})}),null);
});
test('source sampling preserves each original whole-game role and rotates, never selects winners',()=>{
  const plan={iteration:208,games:32,utility:{validationGameIndexes:[0,8,16,24]}};
  const indexes=selectSourceGameIndexes(plan);assert.equal(indexes.length,4);assert.equal(new Set(indexes).size,4);
  assert.equal(indexes.filter(i=>plan.utility.validationGameIndexes.includes(i)).length,1);
  assert.throws(()=>selectSourceGameIndexes({...plan,utility:null}));
  assert.notDeepEqual(selectSourceGameIndexes({...plan,iteration:209}),indexes);
  assert.equal(supplySeed(protocol,211,'deck','growth',3),supplySeed(protocol,211,'deck','growth',3));
  assert.notEqual(supplySeed(protocol,211,'deck','growth',3),supplySeed(protocol,212,'deck','growth',3));
});
test('opening scouting uses legal setup and does not modify either the source game or cards',()=>{
  const deck=Object.values(decklists).find(d=>d.id==='proving-grounds-master-yi');
  let found=0;
  for(let seed=1;seed<=12;seed++){
    const g=createSupplyGame([deck,deck],seed),before=structuredClone(g);
    found+=Number(hasGrowthOpening(g));assert.deepEqual(g,before);
  }
  assert.ok(found>0);
});
test('generated prefix is deterministic, legal and carries no terminal or win labels',()=>{
  const deck=Object.values(decklists).find(d=>d.id==='proving-grounds-master-yi'),model=createNeuralModel({seed:123});
  try{
    const collect=()=>collectSupplyPrefix({game:createSupplyGame([deck,deck],4),model,role:'validation',familyId:'test:4',
      deckIds:[deck.id,deck.id],engineFingerprint:'test-only',origin:'opening',openingOnly:true});
    const first=collect(),second=collect();assert.deepEqual(first,second);assert.equal(first.failure,null);
    assert.ok(first.diagnostics.positions>=5);assert.equal(first.terminalLabels,false);
    for(const s of first.samples){assert.equal(s.lessonRole,'validation');assert.equal(s.steps[0].winProbabilityLabel,false);
      assert.equal(s.steps[0].return,0);assert.ok(s.lessonSource.proof.gain>=.75);}
  }finally{disposeNeuralModel(model);}
});
test('replay state mismatch fails closed and produces no labels',()=>{
  const deck=Object.values(decklists)[0],model=createNeuralModel({seed:456});
  try{
    const result=collectSupplyPrefix({game:createSupplyGame([deck,deck],2),model,steps:[{actorId:'p1',state:[NaN]}],
      role:'training',familyId:'test:2',deckIds:[deck.id,deck.id],engineFingerprint:'test-only',origin:'ordinary-selfplay'});
    assert.match(result.failure,/replay-state-mismatch/);assert.deepEqual(result.samples,[]);
  }finally{disposeNeuralModel(model);}
});
test('ordinary preset-first-player games replay without inventing a die-choice action',()=>{
  const deck=Object.values(decklists)[0],model=createNeuralModel({seed:987});
  try{
    const game=createSupplyGame([deck,deck],10,'p1','p2'),id=activeActorId(game);
    const d=createNeuralSession(model).decide(game,id,enumerateAiPolicyActions(game,id),{greedy:true});
    assert.equal(d.action.kind,'confirmFirstPlayer');
    const steps=[{actorId:id,state:d.stateEncoding,actions:d.actionEncoding,selectedIndex:d.selectedIndex,selectedActionKey:actionKey(d.action)}];
    const result=collectSupplyPrefix({game,model,steps,role:'training',familyId:'test:10',deckIds:[deck.id,deck.id],engineFingerprint:'test',origin:'ordinary-selfplay'});
    assert.equal(result.failure,null);assert.equal(result.diagnostics.positions,1);
  }finally{disposeNeuralModel(model);}
});
test('real replay trigger tokens normalize only with matching full state and every action vector',()=>{
  const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ai-lesson-trigger-20260928.json.gz',import.meta.url))));
  assert.equal(fixture.validatedReplay,true);assert.equal(fixture.recorded.legalCount,2);
  const rename=new Map(fixture.recorded.originalLegalActionKeys.map((key,i)=>[JSON.parse(key).optionId,`trigger-new-run-${i}`]));
  const replace=o=>{if(!o||typeof o!=='object')return;for(const k of Object.keys(o)){
    if(typeof o[k]==='string'&&rename.has(o[k]))o[k]=rename.get(o[k]);else replace(o[k]);}};
  replace(fixture.game);const before=structuredClone(fixture.game);
  const aligned=alignReplayTriggerIds(fixture.game,fixture.actorId,fixture.recorded);assert.ok(aligned);
  assert.deepEqual(enumerateAiPolicyActions(aligned,fixture.actorId).map(actionKey),fixture.recorded.originalLegalActionKeys);
  assert.deepEqual(fixture.game,before);
  const altered=structuredClone(fixture.recorded);altered.actions[10]+=1;
  assert.equal(alignReplayTriggerIds(fixture.game,fixture.actorId,altered),null);
  const other=structuredClone(fixture.recorded);other.state[0]+=1;
  assert.equal(alignReplayTriggerIds(fixture.game,fixture.actorId,other),null);
  const extra=structuredClone(fixture.recorded);extra.originalLegalActionKeys.pop();
  assert.equal(alignReplayTriggerIds(fixture.game,fixture.actorId,extra),null);
});
test('accepted mulligan correction is the unchanged deck-integrated teacher result',()=>{
  const deck=Object.values(decklists).find(d=>d.id==='proving-grounds-master-yi'),model=createNeuralModel({seed:789});
  try{
    let tested=false;
    for(let seed=1;seed<20&&!tested;seed++){
      const game=createSupplyGame([deck,deck],seed);
      while(game.phase!=='mulligan'){const id=activeActorId(game),a=enumerateAiPolicyActions(game,id)[0];assert.equal(applyAiAction(game,a,id).ok,true);}
      const id=activeActorId(game),legal=enumerateAiPolicyActions(game,id),hold=legal.find(a=>a.kind==='submitMulligan'&&!a.cardIds.length);
      const expected=openingDevelopmentAdvice(game,id,legal,hold);if(!expected)continue;
      const d=createNeuralSession(model).decide(game,id,legal,{greedy:true});d.action=hold;
      const advice=acceptedSupplyAdvice(game,id,d);assert.equal(actionKey(advice.action),actionKey(expected.action));
      assert.equal(advice.supplyProof.gain,expected.gain);
      const sample=supplySample(d,advice,{familyId:'test-mulligan',role:'validation',deckId:deck.id,actorId:id,engineFingerprint:'test',actionCount:3,origin:'test'});
      assert.equal(sample.lessonRole,'validation');assert.equal(sample.steps[0].selectedActionKey,actionKey(expected.action));tested=true;
    }
    assert.equal(tested,true);
  }finally{disposeNeuralModel(model);}
});
