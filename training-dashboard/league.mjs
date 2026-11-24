const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const n=v=>Number(v||0).toLocaleString('ko-KR');
const stages={collecting:'자가대전 수집',training:'신경망 학습',evaluation:'독립 평가','waiting-capacity':'기존 작업 저장 / 자원 대기',failed:'오류로 중단','iteration-saved':'회차 저장 완료','paused-at-boundary':'안전하게 일시 정지',preflight:'사전 검사'};
async function refresh(){try{
 const response=await fetch('/api/deck-league',{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const s=await response.json();if(!s){$('status').textContent='등록된 덱별 리그가 없습니다.';return;}
 const c=s.controller||{},active=s.profiles.find(p=>p.id===c.profileId);
 $('status').textContent=`${s.live?'실행 중':'실행 프로세스 없음'} · ${active?.label||''} ${stages[c.stage]||c.stage||'준비 중'}`;
 $('resources').textContent=`프로세스 최대 ${s.maximumProcesses||16}개 · Normal`;
 $('updated').textContent=c.at?`마지막 진행 ${new Date(c.at).toLocaleString('ko-KR')}`:'';
 $('profiles').innerHTML=s.profiles.map(p=>`<article class="card ${s.live&&p.id===c.profileId?'active':''}"><h2>${esc(p.label)}</h2><span class="tag">${p.id===c.profileId?esc(stages[c.stage]||c.stage):p.pending?'평가 대기':'순환 학습 대기'}</span><div class="metrics"><div><small>완료 회차</small><strong>${n(p.iteration)}</strong></div><div><small>자가대전 경기</small><strong>${n(p.games)}</strong></div><div><small>실제 갱신 회차</small><strong>${n(p.changedIterations)}</strong></div><div><small>수용된 epoch</small><strong>${n(p.acceptedEpochs)}</strong></div></div><p>리그 기준 모델: ${esc(p.generation)}세대 · ${esc(p.modelId.slice(-8))}</p><p>${p.lastTraining?`최근 학습: ${p.lastTraining.changed?'가중치 갱신':'보존 검사로 갱신 없음'} · ${n(p.lastTraining.trainingGames)}경기 사용`:'기존 검증 모델에서 독립 학습을 준비합니다.'}</p>${p.id===c.profileId&&c.total?`<p>현재 경기 ${n(c.completed)} / ${n(c.total)}</p>`:''}</article>`).join('');
 $('matrix').innerHTML='<thead><tr><th>학습 모델 / 상대</th>'+s.profiles.map(p=>`<th>${esc(p.label)}</th>`).join('')+'</tr></thead><tbody>'+s.profiles.map(p=>'<tr><th>'+esc(p.label)+(p.lastEvaluation?'<small><br>'+(p.lastEvaluation.phase==='confirmation'?'확인 평가':'선별 평가')+'</small>':'')+'</th>'+s.profiles.map(q=>{
 const cell=p.lastEvaluation?.byOpponent?.find(x=>x.profileId===q.id);return cell?`<td class="${cell.difference>=0?'positive':'negative'}">${(cell.candidateRate*100).toFixed(1)}% / 기존 ${(cell.incumbentRate*100).toFixed(1)}%<br>${cell.difference>=0?'+':''}${(cell.difference*100).toFixed(1)}%p · ${cell.blocks}시드 묶음</td>`:'<td class="muted">평가 전</td>';
 }).join('')+'</tr>').join('')+'</tbody>';
 $('queue').textContent=c.error?`오류: ${c.error}`:`평가 대기 ${s.queue?.length||0}개 · 선별 평가와 확인 평가를 구분하며, 검증되지 않은 학습 모델을 자동 실전 배포하지 않습니다.`;
}catch(e){$('status').textContent=`상태를 읽지 못했습니다: ${e.message}`;}}
await refresh();setInterval(refresh,5000);
