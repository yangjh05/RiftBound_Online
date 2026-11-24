const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = value => value == null ? '—' : Number(value).toLocaleString('ko-KR');
const pct = value => Number.isFinite(value) ? `${(value*100).toFixed(1)}%` : '—';
const delta = value => Number.isFinite(value) ? `${value>0?'+':''}${(value*100).toFixed(1)}%p` : '—';
const when = value => value ? new Date(value).toLocaleString('ko-KR',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '기록 대기';
const bar = (done,total) => `<div class="meter"><span style="width:${total?Math.max(0,Math.min(100,done/total*100)):0}%"></span></div>`;
const tag = (label,kind='') => `<span class="badge ${kind}">${esc(label)}</span>`;
const names = {'champion-start':'챔피언 출발','current-start':'현재 모델 출발','champion-start-initial':'챔피언 · 학습 전','current-start-initial':'현재 모델 · 학습 전',league:'혼합 상대',selfplay:'자가대전',baseline:'기존 모델'};
const stages = {'collection':'자가대전 수집','game-saved':'자가대전 수집','game-rejected':'유효 경기 재수집','policy-training':'정책 학습',
  'preparing-contextual-lessons':'교정 사례 준비','candidate-saved':'후보 저장','starting-point-evaluation':'출발점 비교 평가',
  'held-out-evaluation':'독립 평가','fast-selfplay':'자가대전 수집','fast-selfplay-game-saved':'자가대전 수집',
  'candidate-policy-training':'정책 학습','candidate-q-training':'Policy-Q 학습','live-policy-audit':'실전 판단 복기',
  'candidate-saved-learning-continues':'후보 저장 완료','learner-anchor-selected':'학습 기준점 선택',
  'confirmed-learning-anchor':'새 기준점 확인','confirmation-inconclusive':'확인 평가 · 우위 미확인',
  'no-improving-candidate':'개선 후보 미확인','failed':'오류','paused':'일시 중단'};
const stageName = s => stages[s] || (s?.startsWith('live-policy-audit')?'실전 판단 복기':s || '기록 대기');
const outcomeName = s => ({'inferior':'열세 확인','inconclusive':'판정 유보','budget-closed-unproven':'우위 미확인','passed':'승급 통과','low-promise':'승급 보류','screen-complete-awaiting-review':'비교 완료'})[s] || stageName(s);
const stateBadge = (running,terminal,error) => tag(error?'오류':terminal?'완료':running?'진행 중':'대기 · 저장 기록',error?'warn':running?'good':'');
const stat = (label,value,detail='') => `<div><span>${esc(label)}</span><strong>${value}</strong><small>${esc(detail)}</small></div>`;

export function initViews(onChange) {
  const buttons=[...document.querySelectorAll('[data-view]')];
  const choose = id => {
    if(!buttons.some(b=>b.dataset.view===id))id='overview';
    buttons.forEach(b=>{const selected=b.dataset.view===id;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;$(`view-${b.dataset.view}`).hidden=!selected;});
    try {localStorage.setItem('riftbound-dashboard-view-v2',id);} catch { /* Private browsing can disable storage. */ }
    onChange();
  };
  buttons.forEach((button,i)=>{
    button.addEventListener('click',()=>choose(button.dataset.view));
    button.addEventListener('keydown',event=>{
      const next=event.key==='ArrowRight'?(i+1)%buttons.length:event.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;
      if(next!==null){event.preventDefault();choose(buttons[next].dataset.view);buttons[next].focus();}
    });
  });
  document.addEventListener('click',event=>{const id=event.target.closest('[data-open-view]')?.dataset.openView;if(id){choose(id);buttons.find(b=>b.dataset.view===id)?.focus();}});
  let selected='overview';try{selected=localStorage.getItem('riftbound-dashboard-view-v2')||selected;}catch{}
  choose(selected);
}

function renderComparison(experiment) {
  const hosts=['comparison-flow','comparison-arms','comparison-evidence','comparison-contract'];
  if(!experiment){$('comparison-status').textContent='기록 대기';hosts.forEach(id=>$(id).innerHTML='');$('comparison-evidence').innerHTML='<p class="empty">연결된 출발점 비교 실험이 없거나 기록을 확인 중입니다.</p>';return;}
  const e=experiment;
  $('comparison-status').className=`badge ${e.running?'good':e.error?'warn':''}`;
  $('comparison-status').textContent=e.error?'오류':e.terminal?outcomeName(e.terminal):e.running?stageName(e.stage):'대기 · 저장 기록';
  const phase=e.phase==='complete'?(e.confirmation?3:1):['training','screen','confirmation'].indexOf(e.phase);
  const screenTarget=e.evaluations.find(x=>x.stage==='screen')?.target;
  const confirmTarget=e.evaluations.find(x=>x.stage==='confirmation')?.target ?? (e.deckCount*(e.deckCount+1)/2*8);
  $('comparison-flow').innerHTML=`<ol class="comparison-roadmap">${[
    ['같은 조건으로 학습',`각 ${e.iterations}회차 · ${n(e.iterations*e.gamesPerIteration)}경기`],
    ['학습 전후 선별 평가',`모델당 ${n(screenTarget)}경기`],
    ['새 대전으로 확인',`선택 후보·기존 모델 각 ${n(confirmTarget)}경기`],
    ['본학습 기준점 반영','확인 통과 후 새 회차에서 적용']
  ].map(([title,detail],i)=>`<li class="${phase>i?'done':phase===i?'current':''}"><b>${phase>i?'✓':i+1}</b><div><strong>${title}</strong><small>${detail}</small></div></li>`).join('')}</ol>`;
  // Completing the bounded experiment can yield no anchor. Do not show an
  // unsuccessful confirmation as a completed adoption.
  if(e.phase==='complete'){
    const last=$('comparison-flow').querySelector('li:last-child');
    last.classList.remove('current');
    last.querySelector('small').textContent=e.terminal==='confirmed-learning-anchor'?'확인 완료 · 본학습 반영 여부는 기준점 이력 참조':'기준점 변경 없이 실험 종료';
  }
  $('comparison-arms').innerHTML=e.arms.map((a,index)=>{
    const active=e.activeArm===a.id&&!e.terminal;
    const current=a.cycles.find(x=>x.active);
    return `<article class="arm-card arm-${index}"><div class="panel-heading"><div><span class="arm-letter">${index?'B':'A'}</span><h3>${esc(names[a.id])}</h3></div>${tag(active&&e.running?'실행 중':a.completedIterations===e.iterations?'학습 완료':a.completedIterations?'다음 순서 대기':'차례 대기',active&&e.running?'good':'')}</div>
      <div class="arm-generation"><strong>${n(a.initialGeneration)}</strong><span>세대에서 출발</span><span class="arrow">→</span><strong>${n(a.generation)}</strong><span>세대 저장</span></div>
      <div class="arm-progress"><strong>${n(a.games)}<small> / ${n(a.targetGames)}경기 수집</small></strong><span>${n(a.completedIterations)} / ${n(e.iterations)}회차 저장</span></div>${bar(a.games,a.targetGames)}
      <div class="cycle-grid">${a.cycles.map(c=>`<div class="cycle ${c.committed?'done':c.active?'active':''}"><span>${c.iteration}회차</span><strong>${n(c.games)}<small>/${n(c.target)}</small></strong><small>${c.committed?`${c.accepted}/${c.epoch}단계 반영`:c.active?`${c.epoch?`${c.epoch}차 정책 학습`:'수집 중'}`:c.games?'저장 기록':'대기'}</small></div>`).join('')}</div>
      <div class="arm-footer"><span>가중치 반영 ${n(a.acceptedEpochs)} / ${n(a.attemptedEpochs)}단계</span><span>${n(a.trainedGames)}경기 학습 저장</span></div>
      <p class="guard-status">${a.attemptedEpochs?(a.cycles.filter(c=>c.committed).every(c=>c.lessonGuardsPassed)?'✓ 반영된 갱신의 교정 사례 보존 검사 통과':'보존 검사 기록 확인 필요'):'교정 사례 보존 검사 · 후보 저장 후 표시'}</p>
      <p class="muted">${a.change?`정책 확률 변화 ${pct(a.change.meanTotalVariation)} · ${n(a.change.changedChoices)}/${n(a.change.samples)}장면의 최상위 선택 변경`:current?.epoch?`${current.epoch}차 학습 진행 기록 · 반영 수는 후보 저장 후 확정됩니다.`:'분기별 세대 번호입니다. 서로 다른 출발점의 세대 크기로 실력을 비교하지 않습니다.'}</p>
    </article>`;
  }).join('');
  const c=e.confirmation;
  const outcome=c?`<div class="confirmation-result"><strong>${c.accepted?'새 학습 기준점 조건 충족':'새 기준점의 우위 미확인'}</strong><p>후보 ${pct(c.winRate)} / 기존 출발점 ${pct(c.referenceWinRate)} · 차이 ${delta(c.difference)}</p><small>짝지은 대전 ${n(c.games)}경기 · 독립 시드 묶음 ${n(c.clusters)}개 · 차이의 근사 2표준오차 구간 ${delta(c.approximateLowerBound)} ~ ${delta(c.approximateUpperBound)}</small></div>`:'';
  const relevant=e.evaluations.filter(x=>x.stage===(e.selected?'confirmation':'screen'));
  $('comparison-evidence').innerHTML=`${outcome}<div class="evidence-heading"><h3>${e.selected?'독립 확인 평가':'학습 전후 선별 평가'}</h3><span class="muted">${e.selected?`${esc(names[e.selected.arm])} 선택됨`:'학습 완료 후 평가 시작'}</span></div><div class="table-wrap"><table><thead><tr><th>모델</th><th>저장된 평가</th><th>승 / 패</th><th>관측 승률</th><th>상태</th></tr></thead><tbody>${relevant.map(r=>`<tr><td>${esc(names[r.id]||r.id)}</td><td>${n(r.games)} / ${n(r.target)}</td><td>${r.games?`${n(r.wins)} / ${n(r.losses)}`:'—'}</td><td>${pct(r.winRate)}</td><td>${r.skipped?'변화 기준 미달 · 평가 생략':r.complete?'평가 저장 완료':r.games?'잠정 성적':'평가 대기'}${r.invalid?` · 제외 ${n(r.invalid)}경기`:''}</td></tr>`).join('')}</tbody></table></div><p class="structure-note">기준점 선택은 다음 학습의 출발점을 정합니다. 챔피언 승급은 별도의 공식 평가를 통과해야 합니다.${e.error?` 오류: ${esc(e.error)}`:''}</p>`;
  const mix=e.opponentMixture || [],fraction=role=>pct(mix.length?mix.filter(x=>x===role).length/mix.length:null);
  $('comparison-contract').innerHTML=`<div class="contract-grid"><div><h4>두 출발점에 같은 조건</h4><p>${n(e.deckCount)}개 고정 덱 · 같은 시드·좌석 구성<br>현재 챔피언 ${fraction('champion')} / 과거 챔피언 ${fraction('historical')} / 자기 모델 ${fraction('self')}<br>본인 좌석만 학습 · 회차당 최대 ${n(e.epochs)}단계</p></div><div><h4>옳음이 확인된 교정 사례 유지</h4>${e.coverage?`<p>훈련 ${n(e.coverage.training.total)}개 / 독립 검증 ${n(e.coverage.validation.total)}개<br>관측 이력 복원: 훈련 ${n(e.coverage.training.reconstructed)}개 / 검증 ${n(e.coverage.validation.reconstructed)}개<br>기존 저장 기억 사용: 훈련 ${n(e.coverage.training.legacyStoredMemory)}개 / 검증 ${n(e.coverage.validation.legacyStoredMemory)}개</p>`:'<p>교정 사례 기록 대기</p>'}<p>보존 검사를 통과하지 못한 갱신은 되돌립니다. 검증 사례는 경사 학습에 사용하지 않습니다.</p></div></div>`;
}

export function renderStructure(data) {
  const p=data.progress,a=data.learningAnchor,e=data.experiments?.find(e=>e.starting),resources=data.resources||{};
  const evaluation=data.evaluations.find(x=>x.id===data.currentEvaluationId);
  $('system-summary').innerHTML=[stat('공식 챔피언',`${n(data.champion?.generation)}<small>세대</small>`,'승급평가를 통과한 모델'),
    stat('본학습 저장 모델',`${n(data.learner?.generation)}<small>세대</small>`,`${n(p.iteration)}회차 · ${data.running?'실행 중':'저장 기록'}`),
    stat('출발점 비교',e?`${n(e.arms.reduce((n,a)=>n+a.games,0))}<small> / ${n(e.arms.reduce((n,a)=>n+a.targetGames,0))}경기</small>`:'—',e?`${stageName(e.stage)} · 두 분기 합계`:'연결된 실험 대기'),
    stat('실행 프로세스',`${n(resources.processCount)}<small> / ${n(resources.maximum)}</small>`,`별도 작업 예약 ${n(resources.sideReserved)}개 · 대시보드 제외`)].join('');
  const stage=stageName(p.stage);
  $('main-learning').innerHTML=`<div class="panel-heading"><h3>계속 학습하는 모델</h3>${stateBadge(data.running,false,p.error)}</div><div class="main-stage">${esc(stage)}</div><p class="muted">${n(p.iteration)}회차 · 마지막 저장 ${n(data.learner?.generation)}세대</p>${p.phaseTotal?`<div class="phase-count"><strong>${n(p.phaseDone)} / ${n(p.phaseTotal)}</strong><span>${esc(p.phaseUnit)}</span></div>${bar(p.phaseDone,p.phaseTotal)}`:'<p class="phase-running">단계가 끝나면 저장 기록이 갱신됩니다.</p>'}<p class="structure-note">자가대전 수집 → 정책·평가기 학습 → 판단 복기·교정 → 후보 저장을 반복합니다. 저장된 후보는 별도 프로세스에서 평가합니다.</p><div class="small-meta">기록 ${when(data.updatedAt)}${data.stale?' · 장시간 계산 중에는 기록 시각이 유지될 수 있습니다.':''}</div>`;
  $('anchor-summary').innerHTML=!a?.enabled?'<h3>검증된 학습 기준점</h3><p class="muted">기준점 관리가 연결되지 않은 실행입니다.</p>':`<div class="panel-heading"><h3>검증된 학습 기준점</h3>${tag(a.returnEligible?'다음 새 회차에서 복귀':a.initialized?'관리 적용 중':'초기화 대기',a.returnEligible?'warn':'')}</div><div class="anchor-model">${n(a.model?.generation)}<small>세대</small></div><div class="anchor-conditions"><div><span>기준점 이후 완료 회차</span><strong>${n(a.elapsedIterations)} / ${n(a.maximumUnverifiedIterations)}</strong>${bar(a.elapsedIterations,a.maximumUnverifiedIterations)}</div><div><span>서로 다른 후보의 확정 열세</span><strong>${n(a.inferiorEvaluations.length)} / ${n(a.minimumInferiorEvaluations)}</strong>${bar(a.inferiorEvaluations.length,a.minimumInferiorEvaluations)}</div></div><p class="structure-note">두 조건을 모두 만족하면 새 회차 시작 시 기준점으로 돌아갑니다. 판정 유보·단일 패배는 복귀 횟수에 포함하지 않습니다.</p>`;
  renderComparison(e);
  const parallel=[];
  parallel.push(`<article class="work-card"><div class="panel-heading"><h3>공식 승급평가</h3>${stateBadge(evaluation?.running,evaluation?.finished)}</div><strong>${n(evaluation?.generation)} <span>vs</span> ${n(evaluation?.opponentGeneration)}</strong><p>${evaluation?.valid?`${pct(evaluation.winRate)} · ${n(evaluation.wins)}승 ${n(evaluation.losses)}패 / ${n(evaluation.valid)}경기`:'유효 경기 기록 대기'}</p><small>${evaluation?.finished?outcomeName(evaluation.outcome):'진행 중 성적은 잠정 수치입니다.'}</small><button class="text-button" data-open-view="evaluation">공식 평가 자세히 보기 →</button></article>`);
  for(const old of (data.experiments||[]).filter(x=>!x.starting))parallel.push(`<article class="work-card"><div class="panel-heading"><h3>혼합 상대 실험</h3>${stateBadge(old.running,old.terminal,old.error)}</div><strong>${n(old.evaluations.reduce((n,r)=>n+r.games,0))}<span>평가 경기</span></strong><p>${esc(stageName(old.stage))}</p><small>이전 출발점에서 혼합 상대와 자가대전을 비교하는 별도 실험입니다. 새 출발점 비교와 성적을 합산하지 않습니다.</small><details><summary>모델별 성적</summary>${old.evaluations.map(r=>`<p>${esc(names[r.id])}: ${n(r.games)}/${n(r.target)}경기 · ${pct(r.winRate)}</p>`).join('')}<p>초기 실험의 일부 교차 배정은 실제 미러전으로 진행됐습니다. 새 비교는 수정된 배정을 사용합니다.</p></details></article>`);
  const pilot=data.pilots?.[0];
  if(pilot)parallel.push(`<article class="work-card"><div class="panel-heading"><h3>${esc(pilot.name||'빅토르')} 별도 학습</h3>${tag(pilot.integration?.status==='active'?'본학습 편입 중':'별도 학습')}</div><p>별도 미러 모델과 본학습 편입은 각각 진행됩니다.</p><small>본학습과 모델 가중치를 합치는 방식이 아닙니다.</small><button class="text-button" data-open-view="decks">덱 학습·편입 현황 →</button></article>`);
  const detailOpen=$('parallel-work').querySelector('details')?.open;
  $('parallel-work').innerHTML=parallel.join('');
  if(detailOpen && $('parallel-work').querySelector('details'))$('parallel-work').querySelector('details').open=true;
  $('anchor-history').innerHTML=a?.history?.length?`<div class="table-wrap"><table><thead><tr><th>시각</th><th>회차</th><th>변경 이유</th></tr></thead><tbody>${[...a.history].reverse().map(h=>`<tr><td>${when(h.at)}</td><td>${n(h.iteration)}</td><td>${h.reason==='fresh-paired-confirmation'?`독립 비교 통과 · 개선 ${delta(h.difference)}`:'한정 회차 학습 후 반복 열세 · 기준점 복귀'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">아직 학습 기준점 변경이 없습니다. 비교 실험의 완료와 본학습의 실제 반영은 이 이력으로 구분합니다.</p>';
}
