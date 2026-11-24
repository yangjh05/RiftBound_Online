import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import v8 from 'node:v8';
import {pathToFileURL} from 'node:url';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';
import {digest,assertLessonAugmentation} from './deck-league-contract.mjs';
const out=path.resolve('data/ai/conversation-integration-20261014'),root=path.resolve('data/ai/deck-league-20261007');
const curriculumFile=path.join(out,'curriculum.json'),curriculum=json(curriculumFile),load=f=>import(pathToFileURL(path.join(curriculum.runtime.directory,f)).href);
assert.equal(curriculum.completed,true);assert.equal(curriculum.liveTrainingActivated,false);
assert.ok(!fs.existsSync(path.join(root,'execution-r15-conversation-rules/repair.json')),'Never modify a sealed curriculum');
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {approvedTeacherAdvice}=await load('scripts/viktor-candidate-learning.mjs');
const A=await load('src/ai/actions.mjs'),Enc=await load('src/ai/neural/encoding.mjs');
const {observeGame}=await load('src/ai/observation.mjs');
const {randomizeUnknownOwnDeck}=await load('src/ai/deck-memory.mjs');
const {acceptedSupplyAdvice}=await load('scripts/tactical-lesson-supply.mjs');
const {recommendLocalResourceDemonstration}=await load('scripts/local-policy-learning.mjs');
const {recommendSafeTacticalAction,recommendResponseAwareAction}=await load('scripts/response-aware-demonstration.mjs');
const c=json(path.join(root,'config.json')),additions=json(path.join(out,'lesson-additions.json'));
const positions=new Map(v8.deserialize(fs.readFileSync(path.join(out,'certified-evidence/candidate-positions.bin'))).map(p=>[p.key,p]));
const protectedInputs=new Set((await read(path.join(root,'input-protection-live.json.gz'))).protected);
const context=json(verifyArtifact(curriculum.publicResponseCatalog)),audited=[];
for(const [id,addition]of Object.entries(additions)){
 const profile=c.profiles.find(p=>p.id===id),original=await read(verifyArtifact(profile.lessons)),augmented=await read(verifyArtifact(addition.augmented));
 const count=assertLessonAugmentation(original,augmented,profile.deck.id,protectedInputs,{approve:approvedTeacherAdvice,actionKey:A.actionKey,targetLegend:profile.deck.legend.name});
 assert.equal(count,curriculum.accepted[id]);
 for(const s of augmented.bank.training.slice(original.bank.training.length)){
  const p=positions.get(s.lessonSource.positionKey);assert.ok(p?.completeReplay&&p.memoryContextCertified);
  assert.deepEqual(s.memoryContext.states,p.observationPrefix);
  const g=A.cloneGame(p.game),observation=observeGame(g,p.actor),opponent=g.players.find(x=>x.id!==p.actor);
  // Shuffle only UNKNOWN order, preserving known returned-card placement.
  // Reversing the entire deck would illegally alter the player's known bottom cards.
  // Replace private opponent cards with opaque
  // placeholders exactly as the public response teacher does, preserving IDs/counts.
  let seed=37;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(const player of g.players)randomizeUnknownOwnDeck(player,random);
  if(!observation.opponent.handVisible)opponent.hand=opponent.hand.map(card=>({instanceId:card.instanceId,type:'unknown',effects:[],keywords:[]}));
  assert.deepEqual(Array.from(Enc.encodeState(g,p.actor)),s.steps[0].state,'Private information changed the policy observation');
  const encoded=Enc.encodeActionSet(g,p.actor,A.enumerateAiPolicyActions(g,p.actor));
  assert.deepEqual(encoded.actions.map(A.actionKey),s.steps[0].legalActionKeys);
  assert.deepEqual(Array.from(encoded.encoded.slice(0,encoded.legalCount*Enc.ACTION_DIM)),s.steps[0].actions);
  const baseline=s.lessonSource.proof.baseline,decision={action:baseline,legalActions:encoded.actions,legalCount:encoded.legalCount};
  let advice=g.phase==='mulligan'?acceptedSupplyAdvice(g,p.actor,decision,{responseContext:context}):recommendLocalResourceDemonstration(g,p.actor,decision);
  if(!advice&&['action','showdown'].includes(g.phase)){
   const fallback=recommendSafeTacticalAction(g,p.actor,encoded.actions,{selectedAction:baseline});
   advice=recommendResponseAwareAction(g,p.actor,decision,fallback,{responseContext:context});
  }
  assert.equal(approvedTeacherAdvice(advice,A.actionKey(baseline),A.actionKey),true);
  assert.equal(A.actionKey(advice.action),s.steps[0].selectedActionKey);
  audited.push({profileId:id,positionKey:p.key,completeMemoryPrefix:true,privateHandAndFutureOrderInvariant:true,teacherRecheckPassed:true});
 }
 const audit=json(addition.audit.path),source=curriculum.sourceDecks.find(d=>d.id===augmented.bank.training.at(-1).deckId);
 audit.sourceDeckIsTargetTrainingDeck=digest(source.record.main)===digest(profile.deck.main.map(c=>c.id).sort());
 audit.acceptanceRechecked=true;atomic(addition.audit.path,audit);addition.audit.sha256=sha(addition.audit.path);
}
const ledger={contract:'conversation-strategy-review-ledger-v1',language:'ko',role:'training-curriculum-provenance',
 sourceScope:'사용자 요청·교정과 저장된 분기별 플레이 이유/대안. 논리 검토는 조건부 설명이며 전역 최적수 증명은 아닙니다.',
 records:[
  {status:'user-correction',topic:'이케시아 폭우',statement:'신병 여러 개와 중형 유닛을 함께 제거해 가속이 없는 빅토르의 재건을 늦추는 용도를 검토합니다. 두 유닛 제거만 필요하면 유성의 비용과 비교합니다.'},
  {status:'user-experimental-design',topic:'교체 카드',statement:'폭우 비교 시 선공은 주시자, 후공은 2드랍을 교체합니다. 현재 실제 재생 가족은 카이사 후공이며 Pouty Poro 1장을 폭우로 바꾼 상태입니다. 선공 승률 근거로 전용하지 않습니다.'},
  {status:'opponent-response-requirement',topic:'빅토르 본진 보존',statement:'Captain·Leader와 잉여 신병을 본진에 남기는 대응을 포함합니다. 신병의 전장 과투입을 가정하지 않습니다. 필요한 득점·방어를 위해 실제로 소모할 유인이 있는지 양쪽에서 검토합니다.'},
  {status:'bounded-replay-example',topic:'광선 보존',branches:['captain-rain-pass'],statement:'검토한 분기에서는 광선을 성급히 쓰지 않고 Zaun 탈환을 저지하는 데 남기는 선택을 비교했습니다. 모든 손패에 적용되는 고정 규칙으로 사용하지 않습니다.'},
  {status:'bounded-replay-example',topic:'귀환과 재전개',branches:['captain-rain-pass','leader-base'],statement:'Sprite Mother의 재전개와 Singularity 대응을 기록했습니다. 해당 상태의 남은 자원·우선권·다음 득점 가능성을 함께 평가합니다.'},
  {status:'replay-supported-counterexample',topic:'폭우의 필요성',branches:['leader-base-develop','leader-end-no-rain'],statement:'폭우가 있던 경기의 승리가 폭우의 필요성을 입증하지는 않습니다. 기록된 대안에서는 Darius·Stupefy·저비용 유닛과 전장별 득점으로 폭우를 쓰지 않고도 이겼습니다.'},
  {status:'withdrawn-do-not-label',topic:'같은 턴 같은 전장 재득점',branches:['v3-captain-base'],statement:'Zaun 유지 후 같은 턴 재정복으로 추가 점수를 얻는다는 설명은 잘못되어 철회합니다.'},
  {status:'withdrawn-do-not-label',topic:'승률·최적성',statement:'분기들은 같은 초기 게임의 파생 기록입니다. 독립 경기 승률, 선후공별 승률, 양쪽 전역 최적 플레이의 증거로 사용하지 않습니다.'},
  {status:'training-contract',topic:'정답 채택',statement:'합법적 완주와 승리만으로 정답으로 채택하지 않습니다. 공개 정보로 기존 독립 검증 기준을 통과한 교정만 정책 모방 학습에 추가하며 승패·가치 정답으로 사용하지 않습니다.'}
 ],rawBranchReasonsAndAlternatives:curriculum.rawReviews,positionDisposition:curriculum.positionReviews};
atomic(path.join(out,'conversation-analysis.json'),ledger);
atomic(path.join(out,'privacy-and-acceptance-audit.json'),{passed:true,accepted:audited.length,cases:audited,protectedInputsPreserved:true});
curriculum.analysisLedger={path:path.join(out,'conversation-analysis.json'),sha256:sha(path.join(out,'conversation-analysis.json'))};
curriculum.acceptanceAudit={path:path.join(out,'privacy-and-acceptance-audit.json'),sha256:sha(path.join(out,'privacy-and-acceptance-audit.json'))};
atomic(path.join(out,'lesson-additions.json'),additions);atomic(curriculumFile,curriculum);
console.log(JSON.stringify({passed:true,accepted:audited.length,analysisRecords:ledger.records.length}));
