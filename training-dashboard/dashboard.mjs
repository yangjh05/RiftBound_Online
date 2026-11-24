import {initViews,renderStructure} from './structure.mjs';
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = value => value == null ? "—" : Number(value).toLocaleString("ko-KR");
const percent = value => value == null || !Number.isFinite(value) ? "—" : (value * 100).toFixed(1);
const time = value => value ? new Date(value).toLocaleTimeString("ko-KR", { hour12: false }) : "—";
const finishTime = value => {
  if (!value) return "—";
  const date = new Date(value), today = date.toDateString() === new Date().toDateString();
  return `${today ? "오늘 " : `${date.getMonth() + 1}/${date.getDate()} `}${date.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" })}`;
};
const duration = seconds => { const minutes = Math.max(1, Math.round(seconds / 60)); return minutes < 60 ? `약 ${minutes}분` : `약 ${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`; };
const colors = ["#5ee7cd", "#77a9ff", "#d39af8", "#f6c971", "#f98d9e"];
const labels = { low: "낮음", "below-normal": "낮은 보통", normal: "보통", "above-normal": "높은 보통", high: "높음" };
const outcomes = { passed: "통과", inferior: "열세 확인", "low-promise": "승급 보류", inconclusive: "판정 유보", "budget-closed-unproven": "평가 종료 · 우위 미확인", "not-promoted": "승급 보류", running: "평가 중", invalid: "무효" };
const stages = { "live-policy-audit": "실전 판단 복기", "learner-anchor-selected": "기준점 선택", "fast-selfplay": "자가대전 수집", "fast-selfplay-game-saved": "자가대전 수집", "candidate-policy-training": "정책 학습", "candidate-q-training": "평가기 학습", "candidate-saved-learning-continues": "학습 저장 완료", "tactical-refresh-collection": "전술 자료 수집", "tactical-refresh-training": "전술 학습", "tactical-refresh-ready": "전술 학습 완료", "training-failed": "학습 오류", stopped: "학습 중단" };
let data = null, purpose = "champion-promotion", hiddenDecks = new Set(), timer = null, fetching = false, changingPriority = false, errorCount = 0;
let searchLegend = "all", selectedSearchDeck = null;

function badge(id, label, kind = "") { text(id, label); $(id).className = `badge ${kind}`; }
function meter(id, fraction) { $(id).style.width = `${Math.max(0, Math.min(1, fraction || 0)) * 100}%`; }
function showNotice(message) { text("notice", message || ""); $("notice").hidden = !message; }
function empty(id, message) { $(id).innerHTML = `<div class="empty">${escape(message)}</div>`; }

// Dependency-free SVG charts. Every observation has both a keyboard tooltip
// and an accessible label; missing observations remain gaps, never zeroes.
function chart(id, series, { percentAxis = true, xLabel = "세대", xFormat = num, yFormat, valueFormat, minY, maxY, bars = false } = {}) {
  const host = $(id), width = Math.max(300, host.clientWidth), height = host.clientHeight || 220;
  const points = series.flatMap(s => s.points).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return empty(id, "아직 표시할 기록이 없습니다.");
  const left = 46, right = 17, top = 17, bottom = 33, w = width - left - right, h = height - top - bottom;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  let loX = Math.min(...xs), hiX = Math.max(...xs);
  if (loX === hiX) { loX -= 1; hiX += 1; }
  const loY = minY ?? (percentAxis ? 0 : Math.min(0, ...ys)), hiY = maxY ?? (percentAxis ? 1 : Math.max(...ys, .001) * 1.12);
  const x = value => left + (value - loX) / (hiX - loX) * w;
  const y = value => top + h - (value - loY) / (hiY - loY) * h;
  const fy = yFormat || (value => percentAxis ? `${Math.round(value * 100)}%` : value < 1 ? value.toFixed(2) : num(Math.round(value)));
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${escape(host.getAttribute("aria-label"))}">`;
  for (let i = 0; i <= 4; i++) {
    const value = loY + (hiY - loY) * i / 4, py = y(value);
    svg += `<line x1="${left}" x2="${width - right}" y1="${py}" y2="${py}" stroke="${percentAxis && i === 2 ? "#5b6f89" : "#243246"}" ${percentAxis && i === 2 ? 'stroke-dasharray="5 5"' : ""}/><text x="${left - 9}" y="${py + 4}" text-anchor="end">${fy(value)}</text>`;
  }
  const ticks = width < 430 ? 3 : 5;
  for (let i = 0; i < ticks; i++) { const value = loX + (hiX - loX) * i / (ticks - 1); svg += `<text x="${x(value)}" y="${height - 10}" text-anchor="${i === 0 ? "start" : i === ticks - 1 ? "end" : "middle"}">${escape(xFormat(Math.round(value)))}</text>`; }
  for (const seriesItem of series) {
    if (seriesItem.hidden) continue;
    if (!bars && !seriesItem.markersOnly) {
      let segment = [];
      const flush = () => { if (segment.length) svg += `<polyline points="${segment.join(" ")}" fill="none" stroke="${seriesItem.color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`; segment = []; };
      for (const point of seriesItem.points) { if (Number.isFinite(point.y)) segment.push(`${x(point.x)},${y(point.y)}`); else flush(); }
      flush();
    }
    for (const point of seriesItem.points) {
      if (!Number.isFinite(point.y)) continue;
      const tip = `${seriesItem.name} · ${xFormat(point.x)}${xLabel ? ` ${xLabel}` : ""} · ${valueFormat ? valueFormat(point.y) : percentAxis ? `${percent(point.y)}%` : Number(point.y.toFixed(4))}${point.detail ? ` · ${point.detail}` : ""}`;
      if (bars) svg += `<rect x="${x(point.x) - Math.min(7, w / points.length / 3)}" y="${y(point.y)}" width="${Math.min(14, w / points.length * .6)}" height="${Math.max(1, top + h - y(point.y))}" rx="2" fill="${seriesItem.color}" opacity=".8" data-tip="${escape(tip)}" tabindex="0" aria-label="${escape(tip)}"/>`;
      else svg += `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="${seriesItem.points.length > 30 ? 2 : 3.5}" fill="${seriesItem.color}" stroke="#111b2b" stroke-width="1.5" data-tip="${escape(tip)}" tabindex="0" aria-label="${escape(tip)}"><title>${escape(tip)}</title></circle>`;
    }
  }
  host.innerHTML = `${svg}</svg>`;
}

function renderPriority(priority) {
  document.querySelectorAll("[data-priority]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.priority === priority.requested));
    button.disabled = changingPriority || !priority.supported;
  });
  if (changingPriority) return text("priority-status", "현재 프로세스에 적용하고 설정을 저장하고 있습니다…");
  const errors = priority.errors || [], applied = (priority.processes || []).filter(p => p.priority === priority.requested).length;
  text("priority-status", !priority.supported ? "이 환경에서는 우선순위 변경을 지원하지 않습니다."
    : priority.monitorError ? `프로세스 확인 실패: ${priority.monitorError}`
    : errors.length ? `${errors.length}개 적용 실패 · ${errors[0].message}`
    : priority.requested ? `${labels[priority.requested]} · ${applied}개 적용 · 새 프로세스 자동 적용`
    : `${priority.processes?.length || 0}개 프로세스 · 우선순위를 선택해 주세요.`);
}

function renderDecks() {
  if (!data?.available) return;
  const items = data.evaluations.filter(e => e.purpose === purpose && e.generation != null);
  const recent = items.at(-1);
  $("deck-legend").innerHTML = data.decks.map((deck, i) => `<button data-deck="${escape(deck.id)}" aria-pressed="${!hiddenDecks.has(deck.id)}"><span class="swatch" style="--series:${colors[i % colors.length]}"></span>${escape(deck.name)}</button>`).join("");
  const series = data.decks.map((deck, i) => ({ name: deck.name, color: colors[i % colors.length], hidden: hiddenDecks.has(deck.id), points: items.map(e => {
    const stat = e.decks.find(d => d.id === deck.id);
    return { x: e.generation, y: stat?.winRate ?? null, detail: `${e.finished ? "완료" : "진행 중"} · ${stat?.games || 0}경기 · 상대 ${e.opponentGeneration ?? "—"}세대` };
  }) }));
  chart("deck-chart", series);
  text("deck-note", purpose === "champion-promotion" ? "가로축: 평가 후보 세대 · 승급 후에는 상대 챔피언이 달라집니다. 진행 중 평가는 잠정 수치입니다." : "가로축: 평가 후보 세대 · 고정 기준 AI 상대 성능입니다. 이 평가의 통과는 챔피언 승급을 의미하지 않습니다.");
  $("deck-stats").innerHTML = data.decks.map((deck, i) => {
    const stat = recent?.decks.find(d => d.id === deck.id);
    const prior=items.at(-2);
    const previous = prior?.opponentGeneration===recent?.opponentGeneration && prior?.evaluationFormat===recent?.evaluationFormat
      && JSON.stringify(prior?.decisionReview||null)===JSON.stringify(recent?.decisionReview||null)
      ? prior?.decks.find(d => d.id === deck.id) : null;
    const change = stat && previous ? (stat.winRate - previous.winRate) * 100 : null;
    return `<div class="deck-stat" style="--series:${colors[i % colors.length]}"><div class="name">${escape(deck.name)}</div><div class="rate">${percent(stat?.winRate)}<span class="muted"> %</span></div><div class="detail">${stat ? `${num(stat.games)}경기 · ${stat.wins}승 ${stat.losses}패${stat.draws ? ` ${stat.draws}무` : ""}` : "평가 대기"}</div><div class="detail">${change == null ? "같은 평가 방식의 비교 기록 없음" : `이전 평가 대비 ${change > 0 ? "+" : ""}${change.toFixed(1)}%p`}</div></div>`;
  }).join("");
}

function renderSearchChart() {
  const search = data?.deckSearch;
  if (!search?.enabled) return;
  const deck = search.decks.find(item => item.id === selectedSearchDeck);
  text("search-chart-title", deck ? `${deck.name} · 점수 추이` : "선택 덱 탐색 점수");
  chart("search-chart", [{ name: deck?.name || "덱 탐색", color: colors[0], points: search.history.map(item => {
    const point = item.points.find(p => p.id === selectedSearchDeck);
    return { x: item.iteration, y: point?.score ?? null, detail: `${num(point?.games || 0)}경기 · 탐색용` };
  }) }], { percentAxis: false, minY: 0, maxY: 1, xLabel: "회차",
    yFormat: value => `${Math.round(value * 100)}점`, valueFormat: value => `${percent(value)}점` });
}

function renderPilot() {
  const pilot = data.pilots?.[0];
  $('pilot-panel').hidden = !pilot;
  $('main-integration').hidden = !pilot?.integration;
  if (!pilot) return;
  const integration = pilot.integration, integrated = integration?.status === 'active';
  if (integration) {
    const progress = integration.progress;
    text('main-integration-title', `${pilot.name} · 본학습 ${Math.round(integration.fraction * 100)}% 편입`);
    badge('main-integration-badge', integrated ? '편입 적용 중' : integration.status === 'held' ? '편입 보류' : '검증 완료 대기', integrated ? 'good' : 'warn');
    text('main-integration-detail', integrated
      ? `${finishTime(integration.activatedAt)} · ${num(integration.firstIteration)}회차부터 본학습 모델이 빅토르와 기존 덱의 교차 대전을 학습합니다.`
      : integration.status === 'held' ? `평가 확인이 필요합니다. ${integration.reason || integration.reasons?.join(' · ') || ''}`
      : `별도 모델의 ${num(integration.gateIteration)}회차 검증을 통과하면 새 본학습 회차부터 편입합니다.`);
    $('main-integration-metrics').hidden = !integrated || !progress;
    if (progress) {
      text('main-integration-games', `${num(progress.completedGames)}경기`);
      text('main-integration-trained', `${num(progress.trainingGames)}경기`);
      text('main-integration-held', `${num(progress.validationGames)}경기`);
    }
    text('main-integration-note', integrated
      ? `평균 10% 배정 · 5회차마다 160경기 중 16경기. ${progress?.complete === false ? '일부 기록 확인 중 · 확인된 경기만 표시합니다. ' : ''}${progress?.currentPlanned ? `현재 ${num(progress.currentIteration)}회차 ${num(progress.currentCollected)}/${num(progress.currentPlanned)}경기 수집 · 가중치 반영 전. ` : ''}아래 별도 미러 모델도 계속 학습합니다. 가중치를 합친 것은 아니며, 본학습 승급은 별도로 평가합니다.`
      : '기존 본학습과 별도 미러 학습은 계속 진행합니다.');
  }
  const t = pilot.training, e = pilot.evaluation, w = pilot.workers, schedule = pilot.schedule;
  const cross = pilot.crossEvaluation || e;
  const evaluating = pilot.stage === 'evaluation' && !e.complete;
  const policyTraining = pilot.stage === 'policy-training';
  const collecting = ['mirror-collection', 'mirror-game-saved', 'mirror-game-rejected'].includes(pilot.stage);
  const currentBatch = t.iterations.find(i => i.iteration === t.currentIteration);
  const batchTarget = t.gamesPerIteration || currentBatch?.target || 32;
  const names = { prepared: '시작 대기', 'mirror-collection': '미러전 수집', 'mirror-game-saved': '미러전 수집',
    'mirror-game-rejected': '경기 재수집', 'policy-training': '정책 학습', 'candidate-saved': '가중치 저장 완료',
    evaluation: '학습 전후 검증', 'periodic-evaluation-complete': '정기 평가 완료 · 학습 재개',
    'diagnostic-complete-awaiting-review': '검증 완료 · 결과 검토 대기', paused: '일시 중단', failed: '학습 오류' };
  text('pilot-title', `${pilot.name} · ${integrated ? '별도 모델 미러 학습·평가' : pilot.continuous ? '독립 연속 학습' : '본학습 통합 준비'}`);
  text('pilot-generation', `${num(t.generation)}세대${t.currentIteration > t.completedIterations ? pilot.running ? ' 학습 중' : ' 학습 목표' : ' 저장'}`);
  badge('pilot-badge', pilot.error ? '학습 오류' : pilot.complete ? '검증 완료' : !pilot.running ? '중단 · 저장 기록' : pilot.stale ? '실행 중 · 기록 갱신 대기' : evaluating ? '정기 평가 중' : pilot.continuous ? '연속 학습 중' : '별도 학습 진행 중',
    pilot.error || !pilot.running && !pilot.complete || pilot.stale ? 'warn' : 'good');
  text('pilot-status', `${names[pilot.stage] || pilot.stage} · ${pilot.runName}${pilot.related ? '' : ' · 다른 본학습 실행에 연결된 기록'}${pilot.error ? ` · ${pilot.error}` : ''}`);
  const integrationDetail=pilot.integration?.status==='active'
    ? `본학습 평균 ${Math.round(pilot.integration.fraction*100)}% · ${num(pilot.integration.firstIteration)}회차부터`
    : pilot.integration?.status==='held' ? '편입 보류 · 평가 결과 확인 필요'
    : pilot.integration ? `${num(pilot.integration.gateIteration)}회차 평가 통과 후 평균 ${Math.round(pilot.integration.fraction*100)}% 자동 편입`
    : pilot.mainConfigured ? '본학습 덱 설정 반영' : '예정 · 현재 독립 모델로 학습';
  const steps = pilot.continuous ? [
    ['미러 자가대전', `${num(t.currentIteration)}회차 · ${num(t.currentGames)}/${num(batchTarget)}경기`, collecting ? 'current' : 'planned'],
    ['정책 학습 반복', `저장 ${num(t.savedGeneration)}세대 · ${num(t.trained)}경기 학습`, policyTraining ? 'current' : 'planned'],
    ['정기 평가', evaluating ? `${num(e.iteration)}회차 평가 진행 중` : `다음 ${num(t.nextEvaluationIteration)}회차 · 평가 후 학습 재개`, evaluating ? 'current' : 'planned'],
    ['본학습 점진 통합', integrationDetail, pilot.mainConfigured ? 'current' : 'planned']
  ] : [
    ['미러 학습', `${num(t.trained)} / ${num(t.target)}경기 학습 완료`, t.complete ? 'done' : 'current'],
    ['독립 검증', `${num(e.played)} / ${num(e.target)}경기`, pilot.complete ? 'done' : t.complete ? 'current' : 'planned'],
    ['결과 검토', pilot.complete ? '검토 대기' : '검증 완료 후', pilot.complete ? 'current' : 'planned'],
    ['본학습 점진 통합', integrationDetail, pilot.mainConfigured ? 'current' : 'planned']
  ];
  $('pilot-roadmap').innerHTML = steps.map(([name, detail, state], index) => `<li class="${state}"><span>${state === 'done' ? '✓' : index + 1}</span><div><strong>${name}</strong><small>${detail}</small></div></li>`).join('');
  text('pilot-collection-label', pilot.continuous ? '이번 회차 미러전 수집' : '미러전 수집');
  text('pilot-collected', pilot.continuous ? `${num(t.currentGames)} / ${num(batchTarget)}` : `${num(t.collected)} / ${num(t.target)}`);
  text('pilot-trained', pilot.continuous ? `${num(t.trained)}경기` : `${num(t.trained)} / ${num(t.target)}`);
  text('pilot-evaluation-label', evaluating ? '진행 중 정기 평가' : '최근 평가 · 학습 진행과 별도');
  text('pilot-evaluation', `${num(e.played)} / ${num(e.target)}`);
  text('pilot-workers', `${num(w.collectors)} / ${num(w.limit)}`);
  meter('pilot-collection-meter', pilot.continuous ? (t.currentGames || 0) / batchTarget : t.collected / t.target);
  meter('pilot-training-meter', pilot.continuous ? currentBatch?.trained ? 1 : (t.epoch || 0) / 4 : t.trained / t.target);
  $('pilot-policy-meter').hidden = pilot.continuous && !policyTraining;
  meter('pilot-evaluation-meter', e.played / e.target);
  text('pilot-iteration', `${num(t.currentIteration)}${pilot.continuous ? '회차 · 반복 학습' : ` / ${num(t.targetIterations)}회차`}`);
  text('pilot-collected-total', `누적 수집 ${num(t.collected)}경기`);
  text('pilot-policy-progress', policyTraining ? `이번 회차 정책 학습 ${num(t.epoch || 0)} / 4 epoch` : `${num(t.completedIterations)}회차 가중치 저장 완료`);
  text('pilot-source', `저장 ${num(t.savedGeneration)}세대 · 출발 ${num(pilot.sourceGeneration)}세대`);
  text('pilot-evaluation-state', `${num(e.iteration)}회차 · ${num(e.generation)}세대 · ${e.kind === 'mirror' ? '미러' : '미러 + 교차'} · ${e.complete ? '평가 완료' : '평가 미완료'}`);
  text('pilot-mirror', `미러 ${num(e.mirror.games)} / 64경기 · 승률 ${percent(e.mirror.winRate)}%`);
  text('pilot-resources', `전체 ${num(w.processes)}프로세스 · 별도 예약 ${num(w.reservedSlots)}칸${w.memoryBackpressured ? ' · 메모리 여유 대기' : ''}`);
  text('pilot-updated', `기록 갱신 ${time(pilot.updatedAt)}`);
  text('pilot-window', pilot.continuous ? `최근 ${num(t.iterations.length)}회차 · 수집 → 가중치 저장` : '수집 → 가중치 저장');
  $('pilot-iterations').innerHTML = t.iterations.map(i => `<div class="pilot-iteration"><span>${i.iteration}회차</span><div class="meter"><span class="${i.trained ? 'trained' : ''}" style="width:${Math.min(100, i.collected / i.target * 100)}%"></span></div><strong>${i.collected}/${i.target}</strong><small>${i.trained ? '학습 완료' : i.collected === i.target ? '가중치 저장 대기' : '수집'}</small></div>`).join('');
  text('pilot-outlook-title', pilot.continuous ? '다음 평가 일정 · 예상 종료' : '예상 결과 · 검증 종료');
  text('pilot-outcome', pilot.continuous ? '연속 학습 · 전체 종료시간 없음' : pilot.complete ? '진단 완료 · 통합 검토 대기' : '미러 학습 후 전후 성능 비교');
  const timing = e.timing;
  text('pilot-eta', pilot.continuous && pilot.running && pilot.stage !== 'evaluation'
    ? `다음 ${schedule?.nextEvaluationKind === 'full' ? '미러 + 교차' : '미러'} 평가: ${num(t.nextEvaluationIteration)}회차 학습 후 · ${num(Math.max(0, t.nextEvaluationIteration - t.completedIterations))}회차 남음`
    : pilot.complete ? '검증 결과가 저장되었습니다.' : !pilot.running ? '프로세스 중단 · 종료시간 추정 보류'
    : e.complete ? '최근 평가가 완료되었습니다. 다음 회차 학습을 이어갑니다.'
    : !t.complete && pilot.stage !== 'evaluation' ? '미러 학습 중입니다. 검증 경기 속도가 쌓이면 검증 종료시간을 표시합니다.'
    : timing.status === 'estimated' ? `검증 종료 예상 ${finishTime(timing.estimatedAt)} · ${duration(timing.secondsRemaining)} 남음`
    : timing.status === 'stale' ? '검증 기록 갱신 대기 · 시간 추정 보류' : timing.status === 'awaiting-progress' ? '예상 시각 도달 · 다음 경기 저장 대기' : '검증 경기 처리 속도를 측정하고 있습니다.');
  text('pilot-schedule', schedule ? `초기 ${num(schedule.afterIteration)}회차 이후 ${num(schedule.mirrorEveryGames)}경기마다 미러 평가 · ${num(schedule.crossEveryGames)}경기마다 교차 평가. 다음 교차 평가: ${num(schedule.nextCrossIteration)}회차.` : '');
  text('pilot-integration', integrated ? `본학습 편입은 ${num(integration.firstIteration)}회차부터 적용 중입니다. 위의 본학습 교차 대전 수와 이 별도 모델의 미러 경기 수는 서로 다른 기록입니다.`
    : pilot.mainConfigured ? '본학습 덱 설정에 반영되었습니다. 현재 배정과 승급 여부는 본학습 패널에서 확인합니다.'
    : pilot.continuous ? '평가가 끝나면 자동으로 다음 회차를 학습합니다. 본학습 통합은 예정이며, 현재는 별도 모델을 유지합니다.'
    : '본학습 통합은 예정 단계입니다. 검증을 마친 뒤 점진적으로 반영하며, 현재 후보는 자동 승급하지 않습니다.');
  text('pilot-comparison-title', `최근 교차 평가 · ${num(cross.generation)}세대 · 상대별 학습 전후 승률`);
  text('pilot-comparison-context', `${num(cross.iteration)}회차 평가 · ${num(cross.played)} / ${num(cross.target)}경기 · ${cross.complete ? '평가 완료' : '평가 미완료'}${cross.iteration !== e.iteration ? ' · 최근 미러 평가와 다른 시점의 기록입니다.' : ''}`);
  const scoreBar = (score, after) => `<div class="pilot-score"><span>${after ? '학습 후' : '학습 전'}</span><div class="meter"><span class="${after ? 'trained' : ''}" style="width:${(score.winRate || 0) * 100}%"></span></div><strong>${score.games ? `${percent(score.winRate)}%` : '대기'}</strong><small>${score.games}/16경기</small></div>`;
  $('pilot-comparison').innerHTML = cross.rows.map(row => `<article><div class="panel-heading"><h4>${escape(row.name)}</h4><span class="muted">${row.delta == null ? '비교 대기' : `${row.delta > 0 ? '+' : ''}${(row.delta * 100).toFixed(1)}%p`}</span></div><p class="muted">후보의 덱: ${escape(row.role === 'pilot' ? pilot.name : row.name)}</p>${scoreBar(row.before, false)}${scoreBar(row.after, true)}</article>`).join('')
    + (cross.invalid || cross.unreadable ? `<p class="search-disclaimer">무효 ${num(cross.invalid)}경기 · 저장 중이거나 읽을 수 없는 파일 ${num(cross.unreadable)}개를 제외했습니다.</p>` : '');
  text('pilot-deck-title', `${pilot.name} 덱 구성 · 메인 ${pilot.deck.mainCount}장 · ${pilot.deck.legal ? '합법 확인' : '구성 확인 필요'}`);
  $('pilot-deck').innerHTML = `<div class="deck-zones">${[['main', '메인 덱'], ['runes', '룬'], ['battlefields', '전장'], ['sideboard', '사이드보드']].map(([zone, label]) => `<section><h4>${label}</h4><ul>${pilot.deck.zones[zone].map(card => `<li><span>${escape(card.name)}</span><strong>${card.count}</strong></li>`).join('') || '<li>없음</li>'}</ul></section>`).join('')}</div>${pilot.source ? `<p class="muted"><a href="${escape(pilot.source)}" target="_blank" rel="noopener noreferrer">원본 덱 목록 ↗</a></p>` : ''}`;
}

function renderDeckSearch() {
  const search = data.deckSearch;
  $("deck-search-panel").hidden = !search?.enabled;
  if (!search?.enabled) return;
  text("search-pool", `${search.poolName} · 비금지 카드`);
  text("search-status", `${data.progress.error ? "학습 중단" : data.running ? "학습 진행 중" : "마지막 저장 기록"} · ${search.scoreIteration == null ? "첫 덱 성적 저장 대기" : `${num(search.scoreIteration)}회차까지의 덱 성적`}${search.reportPending ? " · 최신 성적 파일 저장 대기" : ""}`);
  text("search-iterations", `${num(search.completedIterations)}회차`);
  text("search-since", `${num(search.firstIteration)}회차부터 덱 구성 탐색`);
  text("search-games", `${num(search.committedGames)}경기`);
  text("search-holdout", `훈련 ${num(search.trainingGames)} · 독립 검증 ${num(search.heldOutGames)}`);
  text("search-population", `${num(search.anchors)} / ${num(search.variants)}`);
  const checked = search.decks.filter(deck => deck.legal === true).length;
  text("search-legality", `${num(search.legends.length)}개 전설 · 현재 구성 ${checked}/${search.decks.length} 합법 확인`);
  text("search-current", search.currentIteration == null ? "배정 대기" : `${num(search.currentGames)} / ${num(search.targetGames)}`);
  text("search-current-detail", search.currentIteration == null ? "전술 학습 후 경기별 구성을 확정합니다." : `${num(search.currentIteration)}회차 · 검증 ${num(search.currentHeldOutGames)}경기 포함`);
  const mixture = search.mixture || {};
  for (const mode of ["anchor", "local", "broad"]) document.querySelector(`.mixture-bar .${mode}`).style.width = `${(mixture[mode] || 0) * 100}%`;
  text("search-mixture", `기준 ${Math.round((mixture.anchor || 0) * 100)}% · 소규모 변경 ${Math.round((mixture.local || 0) * 100)}% · 넓은 탐색 ${Math.round((mixture.broad || 0) * 100)}%`);
  if (searchLegend !== "all" && !search.legends.some(item => item.id === searchLegend)) searchLegend = "all";
  $("search-legend-filter").innerHTML = '<option value="all">전체 전설</option>' + search.legends.map(item => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  $("search-legend-filter").value = searchLegend;
  const visible = search.decks.filter(deck => searchLegend === "all" || deck.legendId === searchLegend);
  if (!visible.some(deck => deck.id === selectedSearchDeck)) selectedSearchDeck = visible[0]?.id || null;
  const focusedId = document.activeElement?.dataset?.searchDeck;
  $("search-decks").innerHTML = visible.map(deck => `<tr class="${deck.id === selectedSearchDeck ? "selected" : ""}">
    <td>${escape(deck.name)}${deck.quality === "repaired-main-unverified" ? '<small class="draft-note">보정 출발점 · 성능 미검증</small>' : ""}</td>
    <td><span class="badge">${escape(deck.modeName)}</span></td><td>${deck.auroraCount ? `${deck.auroraCount}장` : "미채용"}</td>
    <td>${num(deck.games)}</td><td>${num(deck.opponentsSeen)} / ${search.legends.length}</td><td class="search-score">${deck.score == null ? "비교 대기" : `${percent(deck.score)}점`}</td>
    <td><button class="inspect-button" data-search-deck="${escape(deck.id)}" aria-label="${escape(deck.name)} 구성 보기" aria-pressed="${deck.id === selectedSearchDeck}">구성 보기</button></td></tr>`).join("") || '<tr><td colspan="7">아직 후보가 없습니다.</td></tr>';
  if (focusedId) [...document.querySelectorAll("[data-search-deck]")].find(button => button.dataset.searchDeck === focusedId)?.focus({ preventScroll: true });
  const controlLegends = new Set(search.decks.filter(deck => deck.mode === "anchor" && deck.auroraCount > 0).map(deck => deck.legendId));
  const controls = search.decks.filter(deck => deck.mode === "anchor" && controlLegends.has(deck.legendId));
  $("search-aurora").innerHTML = controls.map(deck => `<article class="aurora-card"><span>${escape(deck.legendName.split(",")[0])} · ${deck.auroraCount ? `오로라 ${deck.auroraCount}장` : "오로라 미채용"}</span><strong>${deck.score == null ? "비교 대기" : `${percent(deck.score)}점`}</strong><small>${num(deck.games)}경기 · 상대 ${num(deck.opponentsSeen)}종</small><small>평균 비용 ${deck.averageEnergy?.toFixed(2) ?? "—"} · 6비용 이상 ${deck.highCostCount}장</small>${deck.quality === "repaired-main-unverified" ? '<small class="draft-note">오리진 보정 초안 · 미검증</small>' : ""}</article>`).join("") || '<p class="muted">오로라 비교 기준 덱이 없습니다.</p>';
  const deck = search.decks.find(item => item.id === selectedSearchDeck);
  text("search-inspector-title", deck ? `${deck.name} · 카드 구성과 상대별 표본` : "선택한 덱 구성 보기");
  $("search-inspector-content").innerHTML = deck ? `<p class="search-disclaimer">${escape(deck.legendName)} · 메인 ${deck.mainCount}장 · 평균 비용 ${deck.averageEnergy?.toFixed(2) ?? "—"} · ${deck.legal === true ? "오리진 합법 구성 확인" : "구성 확인 필요"}</p><div class="deck-zones">${[["main", "메인 덱"], ["runes", "룬"], ["battlefields", "전장"], ["sideboard", "사이드보드"]].map(([zone, label]) => `<section><h4>${label}</h4><ul>${deck.zones[zone].map(card => `<li><span>${escape(card.name)}</span><strong>${card.count}</strong></li>`).join("") || '<li>없음</li>'}</ul></section>`).join("")}</div><p class="search-disclaimer">상대별 비교 경기: ${deck.opponents.map(item => `${escape(item.legend.split(",")[0])} ${item.games}경기`).join(" · ") || "아직 없음"}. 사이드보드 성적은 현재 단판 학습에서 평가하지 않습니다.</p>` : "";
  renderSearchChart();
}

function renderCharts() {
  if (!data?.available) return;
  const current = data.evaluations.find(e => e.id === data.currentEvaluationId);
  chart("live-chart", [{ name: "누적 승률", color: colors[0], points: current?.trend || [] }], { xLabel: "경기" });
  renderDecks();
  renderSearchChart();
  const lossDetail=p=>`${p.epoch??'—'}차 학습 · ${p.accepted===true?'반영':p.accepted===false?'거부·되돌림':'반영 기록 없음'} · 이 회차 ${p.acceptedEpochs??0}단계 반영${p.origin==='reconstructed-joint-v1'?' · 과거 항목 재구성':''}`;
  chart("loss-chart", [
    {name:'기존 학습 항목',color:colors[1],points:data.losses.map(p=>({x:p.iteration,y:p.baseLoss,detail:lossDetail(p)}))},
    {name:'교정 복습 항목',color:colors[2],points:data.losses.map(p=>({x:p.iteration,y:p.rehearsalLoss,detail:lossDetail(p)}))},
    {name:'거부된 시도 합계',color:colors[4],markersOnly:true,points:data.losses.filter(p=>p.accepted===false).map(p=>({x:p.iteration,y:p.loss,detail:lossDetail(p)}))}
  ], { percentAxis: false, xLabel: "반복" });
  const recentLoss=data.losses.at(-1);
  text('loss-status',recentLoss?`${recentLoss.iteration}회차 · 반영 ${recentLoss.acceptedEpochs??0}단계 / 거부 ${recentLoss.rejectedEpochs??0}단계`:'학습 기록 대기');
  const counts = new Map(data.throughput.map(item => [Date.parse(`${item.at}:00.000Z`), item.games]));
  const end = Math.floor(Date.parse(data.updatedAt) / 60000) * 60000;
  // Zero-fill minutes only within the observed event window.
  const start = Math.max(end - 29 * 60000, Math.min(...counts.keys()));
  const throughput = [];
  for (let at = start; at <= end; at += 60000) throughput.push({ x: at, y: counts.get(at) || 0 });
  chart("throughput-chart", [{ name: "수집 경기", color: colors[0], points: throughput }], { percentAxis: false, bars: true, xLabel: "", xFormat: value => new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) });
}

function render() {
  $("loading").hidden = true;
  if (!data.available) { $("workspace").hidden = true; showNotice(data.message); return; }
  $("workspace").hidden = false;
  renderStructure(data);
  const p = data.progress, evaluation = data.evaluations.find(e => e.id === data.currentEvaluationId);
  text("run-name", data.runName);
  text("generation", num(evaluation?.generation));
  text("generation-detail", evaluation ? `평가 #${num(evaluation.ordinal)} · 후보 가중치 고정` : '평가 후보 대기');
  text("progress-percent", num(evaluation?.opponentGeneration));
  text("progress-unit", "세대");
  badge("stage-badge", evaluation?.finished ? "완료" : evaluation?.running ? "평가 중" : "대기");
  text("progress-detail", evaluation?.purpose === 'tactical-baseline-progress' ? '고정 기준 AI와 성장 측정' : '이 평가에 고정된 챔피언 모델');
  text("evaluation-games", num(evaluation?.played));
  text("evaluation-detail", evaluation ? `${evaluation.generation ?? "—"}세대 · ${evaluation.finished ? "평가 완료" : `최대 ${num(evaluation.maximumGames)}경기`} · ${evaluation.decisionReview?'양쪽 전술 보완 적용':'보완 전 평가'}` : "평가 대기");
  badge('matchup-format',evaluation?.evaluationFormat==='balanced-mirror-and-cross'?'미러 + 다른 덱':'미러전');
  text('matchup-summary',evaluation ? ['mirror','cross'].map(kind=>{
    const group=evaluation.groups?.[kind];
    return `${kind==='mirror'?'미러전':'다른 덱'} ${num(group?.games || 0)}경기 · ${group?.games ? `${percent(group.winRate)}%` : '자료 없음'}`;
  }).join(' / ') : '평가 대기');
  $('matchup-stats').innerHTML=(evaluation?.matchups || []).map(pair=>`<tr><td>${escape(pair.name)}</td><td>${pair.kind==='mirror'?'미러전':'다른 덱'}</td><td>${num(pair.games)}</td><td>${percent(pair.winRate)}%</td></tr>`).join('') || '<tr><td colspan="4">경기가 저장되면 표시됩니다.</td></tr>';
  text("win-rate", percent(evaluation?.winRate));
  text("win-detail", evaluation ? `${num(evaluation.wins)}승 ${num(evaluation.losses)}패 ${num(evaluation.draws)}무 · 무효 ${num(evaluation.invalid)}` : "평가 대기");
  renderPriority(data.priority);
  renderPilot();
  renderDeckSearch();
  renderForecast(evaluation, p);
  text("live-title", evaluation?.purpose === "tactical-baseline-progress" ? "고정 기준 AI 상대 누적 승률" : "승급평가 누적 승률");
  badge("live-badge", evaluation ? evaluation.finished ? "평가 완료" : evaluation.running ? "평가 중" : "미완료 기록" : "대기", evaluation?.running ? "good" : "");
  $("live-summary").innerHTML = evaluation ? `<strong>${percent(evaluation.winRate)}<span> %</span></strong><span>후보 ${evaluation.generation ?? "—"}세대 / 상대 ${evaluation.opponentGeneration ?? "—"}세대</span>` : "";
  text("live-progress", evaluation ? evaluation.finished ? `${num(evaluation.played)}경기 · 평가 완료`
    : `${num(evaluation.played)}경기 · 기본 ${num(evaluation.ordinaryGames)} / 최대 ${num(evaluation.maximumGames)}` : "");
  meter("evaluation-meter", evaluation ? evaluation.finished ? 1 : evaluation.played / evaluation.maximumGames : 0);
  const promotion = data.evaluations.findLast(e => e.finished && e.purpose === "champion-promotion");
  badge("promotion-badge", promotion ? promotion.promoted ? "승급 통과" : outcomes[promotion.outcome] || promotion.outcome : "결과 대기", promotion?.promoted ? "good" : promotion ? "warn" : "");
  if (!promotion) empty("promotion-content", "완료된 승급평가가 아직 없습니다.");
  else {
    const d = promotion.decision;
    $("promotion-content").innerHTML = `<div class="promotion-generation">${promotion.generation ?? "—"}세대 <span class="muted">vs ${promotion.opponentGeneration ?? "—"}세대</span></div><div class="promotion-sub">평가 #${promotion.ordinal} · ${num(promotion.played)}경기</div><div class="promotion-rate">${percent(promotion.winRate)}<small>% 승률</small></div><div class="stat-rows"><div class="stat-row"><span>통계 판정 구간</span><span>${d?.lowerBound == null ? "판정 기록 없음" : `${percent(d.lowerBound)}–${percent(d.upperBound)}%`}</span></div><div class="stat-row"><span>최소 관측 승점률</span><span>${percent(promotion.minimumWinRate)}%</span></div><div class="stat-row"><span>덱·선후공 회귀 검사</span><span>${d?.regressionGuardsPassed == null ? "기록 없음" : d.regressionGuardsPassed ? "통과" : "미충족"}</span></div></div><div class="note">${promotion.promoted ? "승급 기준을 충족한 평가입니다." : "승률만으로 승급하지 않습니다. 통계적 우위와 덱·선후공 기준을 함께 확인합니다."}${d?.score != null ? ` 판정 승점률 ${percent(d.score)}% (무승부 0.5점).` : ""}</div>`;
  }
  text("games-saved", `${num(p.gamesSaved)}경기 저장`);
  text("history-total", `${data.evaluationHistory?.complete===false?`과거 평가 복원 중 ${num(data.evaluationHistory.loaded)} / ${num(data.evaluationHistory.total)}개`:`이번 실행 ${data.evaluations.length}개 평가`} · 확인된 ${num(data.totalEvaluationGames)}경기`);
  $("history").innerHTML = [...data.evaluations].reverse().map(e => `<tr><td>#${e.ordinal}</td><td>${e.purpose === "champion-promotion" ? "승급평가" : "고정 기준 AI"}</td><td>${e.generation ?? "—"} / ${e.opponentGeneration ?? "—"}</td><td>${num(e.played)}</td><td>${percent(e.winRate)}%</td><td>${e.decision?.lowerBound == null ? "자료 수집 중" : `${percent(e.decision.lowerBound)}–${percent(e.decision.upperBound)}%`}</td><td><span class="badge ${e.promoted ? "good" : e.finished ? "warn" : ""}">${escape(e.promoted ? "승급 통과" : outcomes[e.outcome] || e.outcome)}</span></td></tr>`).join("") || '<tr><td colspan="7">아직 평가 기록이 없습니다.</td></tr>';
  text("footer-status", `실행 중인 학습 프로세스 ${data.priority.processes?.length || 0}개 · 정밀 복기 ${num(p.completedAudits)}개 완료`);
  text("data-time", new Date(data.updatedAt).toLocaleString("ko-KR", { hour12: false }));
  showNotice([p.error ? `학습 오류: ${p.error}` : !data.running ? "실행 중인 학습 프로세스가 없어 마지막 저장 기록을 표시하고 있습니다." : data.stale ? "학습 기록이 2분 이상 갱신되지 않았습니다. 현재 저장된 수치를 표시하고 있습니다." : null,
    ...(data.warnings || [])].filter(Boolean).join(" "));
  renderCharts();
}

function renderForecast(evaluation, progress) {
  const forecast = evaluation?.forecast, timing = evaluation?.timing;
  const growth = evaluation?.purpose === "tactical-baseline-progress";
  let outcome = "추정 자료 수집 중", result = "", method = "현재 추세에 따른 추정이며 실제 판정과 다를 수 있습니다.";
  if (!evaluation) outcome = "평가 대기";
  else if (evaluation.finished) { outcome = "평가 완료"; result = outcomes[evaluation.outcome] || evaluation.outcome; }
  else if (forecast?.status === "estimated") {
    outcome = !evaluation.running || timing?.status === "stale" ? "저장 기록 기준" : ({ favorable: growth ? "기준 AI 대비 우위 전망" : "승급에 유리한 흐름", unlikely: growth ? "우위 확인 어려울 전망" : "승급 보류 전망", uncertain: "결과 불확실" })[forecast.outlook];
    result = `예상 최종 승률 ${percent(forecast.winRate)}% · 모의 범위 ${forecast.winRateRange.map(percent).join("–")}%`;
    method = `${num(forecast.sourceGames)}경기 기반 · 모의 경로 ${forecast.simulations}개 중 ${forecast.passedPaths}개 통과. 승급 확률이나 확정 판정은 아닙니다.`;
  } else if (forecast?.status === "awaiting-result") { outcome = "최종 결과 저장 대기"; result = "현재 경기 기록에서 종료 조건에 도달했습니다."; }
  else if (forecast?.status === "collecting") result = `덱별 자료 수집 ${num(forecast.sourceGames)} / ${num(forecast.minimumGames)}경기`;
  else if (forecast?.status === "invalid") { outcome = "추정 불가"; result = "경기 기록의 유효성 확인이 필요합니다."; }
  else if (forecast?.status === "unsupported") { outcome = "예상 결과 미지원"; result = "이 평가 형식은 완료된 결과를 확인해 주세요."; }
  text("forecast-outcome", outcome); text("forecast-result", result); text("forecast-method", method);
  badge("evaluation-eta-badge", timing?.basis === "simulated-stop" ? "조기 종료 반영" : "기본 경기 수 기준");
  const waiting = { completed: "평가 완료", paused: "학습 중단 · 추정 보류", stale: "진행 갱신 대기", collecting: "처리 속도 측정 중", "awaiting-progress": "예상 시각 도달 · 완료 대기" };
  text("evaluation-eta", timing?.status === "estimated" ? finishTime(timing.estimatedAt) : waiting[timing?.status] || "평가 대기");
  text("evaluation-eta-detail", timing?.estimatedAt ? `${timing.status === "awaiting-progress" ? "다음 기록 대기" : `${duration(timing.secondsRemaining)} 남음`} · 예상 ${num(timing.targetGames)}경기 종료 · 최근 ${num(timing.sampledGames)}경기 속도 기준` : "경기가 쌓이면 종료시간을 계산합니다.");
  text("evaluation-eta-range", timing?.range ? `범위 ${timing.range.map(finishTime).join("–")} · 최대 경기 수까지 진행 시 ${finishTime(timing.maximumAt)}. 처리 속도가 바뀌면 달라집니다.` : "중단되거나 기록이 오래되면 시간 추정을 보류합니다.");
  const training = progress.timing;
  text("training-eta", training?.status === "estimated" ? finishTime(training.estimatedAt) : ({ completed: "이번 세대 저장 완료", paused: "학습 중단 · 추정 보류", overdue: "평균 소요시간 초과", collecting: "완료 이력 수집 중" })[training?.status] || "계산 중");
  text("training-eta-detail", training?.estimatedAt ? `${training.status === "overdue" ? "단계 완료 대기" : `${duration(training.secondsRemaining)} 남음`} · 최근 ${training.samples}회 같은 단계 이후 소요시간 기준` : "최근 반복의 실제 완료시간을 바탕으로 추정합니다.");
}

async function refresh() {
  if (fetching) return;
  fetching = true; clearTimeout(timer);
  $("refresh").disabled = true;
  try {
    const response = await fetch("/api/state", { cache: "no-store", signal: AbortSignal.timeout(data ? 45000 : 90000) });
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    data = await response.json(); errorCount = 0;
    render();
    text("connection", data.available ? data.running ? "실시간 연결" : "저장 기록" : "기록 대기");
    $("connection-dot").className = `dot ${data.running && !data.stale ? "live" : ""}`;
    text("updated", time(data.fetchedAt));
  } catch (error) {
    errorCount++;
    text("connection", "연결 재시도 중"); $("connection-dot").className = "dot error";
    if (!data) $("loading").hidden = true;
    showNotice(`대시보드에 연결하지 못했습니다. 자동으로 다시 연결합니다.${data ? " 마지막으로 받은 기록을 유지하고 있습니다." : ""}`);
  } finally {
    fetching = false; $("refresh").disabled = false;
    timer = setTimeout(refresh, Math.min(15000, 3000 * Math.max(1, errorCount)));
  }
}

async function setPriority(priority) {
  if (!Object.hasOwn(labels, priority)) throw new Error("지원하지 않는 우선순위입니다.");
  if (changingPriority || !data?.token) throw new Error("현재 요청이 끝난 뒤 다시 시도해 주세요.");
  changingPriority = true; renderPriority(data.priority);
  try {
    const response = await fetch("/api/priority", { method: "POST", headers: { "Content-Type": "application/json", "X-Dashboard-Token": data.token }, body: JSON.stringify({ priority }), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "설정 적용에 실패했습니다.");
    data.priority = result;
    return { requested: result.requested, appliedProcesses: result.processes.length, errors: result.errors };
  } finally { changingPriority = false; renderPriority(data.priority); }
}

$("refresh").addEventListener("click", refresh);
$("search-legend-filter").addEventListener("change", event => {
  searchLegend = event.target.value; selectedSearchDeck = null; renderDeckSearch();
});
$("search-decks").addEventListener("click", event => {
  const id = event.target.closest("[data-search-deck]")?.dataset.searchDeck;
  if (id) { selectedSearchDeck = id; renderDeckSearch(); $("search-inspector").open = true; }
});
$("priority-buttons").addEventListener("click", event => {
  const priority = event.target.closest("[data-priority]")?.dataset.priority;
  if (priority) void setPriority(priority).catch(error => text("priority-status", error.message));
});
document.querySelectorAll("[data-purpose]").forEach(button => button.addEventListener("click", () => {
  purpose = button.dataset.purpose;
  document.querySelectorAll("[data-purpose]").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
  renderDecks();
}));
$("deck-legend").addEventListener("click", event => {
  const id = event.target.closest("[data-deck]")?.dataset.deck;
  if (id) { hiddenDecks.has(id) ? hiddenDecks.delete(id) : hiddenDecks.add(id); renderDecks(); }
});
function tooltip(event) {
  const point = event.target.closest?.("[data-tip]");
  if (!point) { $("tooltip").hidden = true; return; }
  const box = point.getBoundingClientRect();
  text("tooltip", point.dataset.tip); $("tooltip").hidden = false;
  $("tooltip").style.left = `${Math.max(5, Math.min(innerWidth - 270, event.clientX || box.x))}px`;
  $("tooltip").style.top = `${Math.max(5, (event.clientY || box.y) - 55)}px`;
}
document.addEventListener("pointermove", tooltip);
document.addEventListener("focusin", tooltip);
document.addEventListener("focusout", () => { $("tooltip").hidden = true; });
document.addEventListener("keydown", event => { if (event.key === "Escape") $("tooltip").hidden = true; });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderCharts, 120); });

// The visible controls and agent actions share exactly the same request path.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => {
    try { void Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Optional browser capability; the dashboard remains usable. */ }
  };
  register({ name: "read_training_status", title: "AI 학습 현황 확인", description: "Read the live training generation, evaluation results and process priority shown on this dashboard.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
    execute: async () => { await refresh(); if (!data?.available) return { available: false }; return { progress: data.progress, learner: data.learner, champion: data.champion, learningAnchor: data.learningAnchor, experiments: data.experiments, resources: data.resources, pilots: data.pilots, deckSearch: data.deckSearch, priority: data.priority, evaluations: data.evaluations.map(({ trend, ...e }) => e) }; } });
  register({ name: "set_training_process_priority", title: "학습 프로세스 우선순위 변경", description: "Save and apply scheduling priority to this project's running and future training processes. This changes operating system process priority.",
    inputSchema: { type: "object", properties: { priority: { type: "string", enum: Object.keys(labels) } }, required: ["priority"], additionalProperties: false },
    annotations: { readOnlyHint: false }, execute: input => setPriority(input?.priority) });
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
initViews(renderCharts);
void refresh();
