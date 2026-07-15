export function createPresentationState() {
  return {
    gameKey: "",
    previous: null,
    highlights: [],
    highlightIds: new Set(),
    sequence: 0
  };
}

export function resetPresentationState(state) {
  state.gameKey = "";
  state.previous = null;
  state.highlights = [];
  state.highlightIds = new Set();
  state.sequence = 0;
  return state;
}

export function snapshotPresentationGame(game, mightOf = defaultMight) {
  const units = [];
  for (const player of game.players || []) {
    for (const unit of player.base || []) {
      if (unit.type === "unit") units.push(unitSnapshot(unit, "base", mightOf));
    }
  }
  for (const battlefield of game.battlefields || []) {
    for (const unit of battlefield.units || []) {
      if (unit.type === "unit") units.push(unitSnapshot(unit, battlefield.instanceId, mightOf));
    }
  }

  const chain = game.actionChain?.chain || game.showdown?.chain || [];
  const players = (game.players || []).map((player) => ({
    id: player.id,
    name: player.name,
    score: player.score || 0,
    xp: player.xp || 0,
    handCount: player.hand?.length || 0,
    trashIds: (player.trash || []).map((card) => card.instanceId),
    banishedIds: (player.banished || []).map((card) => card.instanceId)
  }));

  return {
    gameKey: (game.players || []).map((player) => player.legend?.instanceId || player.id).join("|"),
    phase: game.phase,
    turnNumber: game.turnNumber || 1,
    turnSequence: game.turnSequence || 0,
    currentPlayerId: game.currentPlayerId,
    winnerId: game.winnerId || null,
    victoryScore: game.victoryScore || 8,
    players,
    units,
    chain: chain.map((item, index) => ({
      id: item.id || item.card?.instanceId || `chain-${index}`,
      playerId: item.playerId,
      name: item.card?.name || item.trigger?.kind || "Effect",
      type: item.itemType || "card",
      ambush: Boolean(item.card?.keywords?.includes("Ambush")),
      reaction: Boolean(item.card?.tags?.includes("Reaction") || item.card?.keywords?.includes("Reaction"))
    })),
    showdownId: game.showdown?.battlefieldId || null,
    effectStamp: game.effectFlash?.stamp || 0,
    effectMessage: game.effectFlash?.message || "",
    logHead: game.log?.[0] || "",
    surrenderedPlayerId: game.surrenderedPlayerId || null
  };
}

export function advancePresentation(state, current, viewerId) {
  if (state.gameKey !== current.gameKey) {
    resetPresentationState(state);
    state.gameKey = current.gameKey;
  }

  const previous = state.previous;
  state.previous = current;
  if (!previous) return emptyAdvance(state);

  const cues = [];
  const impacts = [];
  const addedHighlights = [];

  if (current.phase === "showdown" && previous.phase !== "showdown") {
    cues.push({ kind: "showdown" });
    impacts.push(impact("showdown", "SHOWDOWN", "승부가 걸린 전투가 시작됩니다", "Showdown", "The battlefield is contested"));
  }

  if (current.currentPlayerId !== previous.currentPlayerId && current.phase === "action") {
    cues.push({ kind: current.currentPlayerId === viewerId ? "your-turn" : "turn" });
    if (current.currentPlayerId === viewerId) {
      impacts.push(impact("turn", "YOUR TURN", "행동할 차례입니다", "Your turn", "Take the initiative"));
    }
  }

  const previousChainIds = new Set(previous.chain.map((item) => item.id));
  const addedChain = current.chain.find((item) => !previousChainIds.has(item.id));
  if (addedChain) {
    const kind = addedChain.ambush ? "ambush" : addedChain.reaction ? "reaction" : addedChain.type === "trigger" ? "trigger" : "card";
    cues.push({ kind });
    impacts.push(impact(kind, kind === "ambush" ? "AMBUSH" : kind === "reaction" ? "RESPONSE" : "ACTION", addedChain.name, kind === "ambush" ? "Ambush" : kind === "reaction" ? "Response" : "Action", addedChain.name));
  }

  const scoreEvents = scoreChanges(previous, current);
  for (const event of scoreEvents) {
    cues.push({
      kind: event.winning ? "victory-score" : event.comeback ? "comeback" : "score",
      calloutKo: event.winning ? "승부가 결정됩니다" : event.comeback ? "전세가 뒤집혔습니다" : event.kind === "lock" ? "승기를 굳힙니다" : "전장을 가져옵니다",
      calloutEn: event.winning ? "The match is decided" : event.comeback ? "The tide has turned" : event.kind === "lock" ? "The lead is locked in" : "The battlefield is claimed"
    });
    impacts.push(impact(event.winning ? "finisher" : event.comeback ? "comeback" : "score", event.winning ? "MATCH POINT" : event.comeback ? "TURNAROUND" : "SCORE", event.titleKo, event.winning ? "Match point" : event.comeback ? "Turnaround" : "Score", event.titleEn));
    addedHighlights.push(addHighlight(state, event));
  }

  const removalEvent = removedUnitEvent(previous, current);
  if (removalEvent) {
    cues.push({
      kind: removalEvent.count >= 2 ? "multi-kill" : "unit-down",
      calloutKo: removalEvent.count >= 2 ? "전장이 무너집니다" : "유닛이 쓰러졌습니다",
      calloutEn: removalEvent.count >= 2 ? "The battlefield collapses" : "A unit has fallen"
    });
    impacts.push(impact(removalEvent.count >= 2 ? "sweep" : "strike", removalEvent.count >= 2 ? "BATTLEFIELD BREAK" : "UNIT DOWN", removalEvent.titleKo, removalEvent.count >= 2 ? "Battlefield break" : "Unit down", removalEvent.titleEn));
    if (removalEvent.count >= 2) addedHighlights.push(addHighlight(state, removalEvent));
  }

  const boardSwing = boardSwingEvent(previous, current);
  if (boardSwing) {
    cues.push({ kind: "comeback" });
    impacts.push(impact("comeback", "MOMENTUM SHIFT", boardSwing.titleKo, "Momentum shift", boardSwing.titleEn));
    addedHighlights.push(addHighlight(state, boardSwing));
  }

  const chainShrank = current.chain.length < previous.chain.length;
  if (chainShrank && /counter|무효/i.test(current.logHead)) {
    const counter = makeHighlight({
      id: `counter-${current.turnSequence}-${current.logHead}`,
      kind: "counter",
      playerId: current.currentPlayerId,
      turn: current.turnNumber,
      weight: 62,
      titleKo: "결정적인 대응",
      titleEn: "Decisive response",
      detailKo: "상대의 플레이를 정확한 타이밍에 끊어냈습니다.",
      detailEn: "A precisely timed response stopped the opposing play."
    });
    cues.push({ kind: "counter", calloutKo: "완벽한 대응입니다", calloutEn: "A perfect response" });
    impacts.push(impact("counter", "DENIED", "상대의 수를 끊었습니다", "Denied", "The opposing play was stopped"));
    addedHighlights.push(addHighlight(state, counter));
  } else if (current.effectStamp !== previous.effectStamp) {
    const damage = /damage|kill|피해|처치/i.test(`${current.effectMessage} ${current.logHead}`);
    cues.push({ kind: damage ? "impact" : "resolve" });
    if (damage) impacts.push(impact("strike", "IMPACT", current.effectMessage || "강력한 효과가 적중했습니다", "Impact", current.effectMessage || "A powerful effect landed"));
  }

  if (current.phase === "complete" && previous.phase !== "complete") {
    const won = current.winnerId === viewerId;
    cues.push({
      kind: won ? "victory" : "defeat",
      calloutKo: won ? "승리를 쟁취했습니다" : "치열한 승부가 끝났습니다",
      calloutEn: won ? "Victory is yours" : "The battle is over"
    });
    impacts.push(impact(won ? "victory" : "defeat", won ? "VICTORY" : "DEFEAT", won ? "승리를 쟁취했습니다" : "치열한 승부가 끝났습니다", won ? "Victory" : "Defeat", won ? "The match is yours" : "The battle is over"));
    const winner = current.players.find((player) => player.id === current.winnerId);
    addedHighlights.push(addHighlight(state, makeHighlight({
      id: `victory-${current.winnerId}-${current.turnSequence}`,
      kind: "victory",
      playerId: current.winnerId,
      turn: current.turnNumber,
      weight: 100,
      titleKo: current.surrenderedPlayerId ? "상대의 항복을 받아낸 압박" : "승부를 끝낸 마지막 한 수",
      titleEn: current.surrenderedPlayerId ? "Pressure forced the surrender" : "The final decisive play",
      detailKo: `${winner?.name || "승자"}님이 ${winner?.score || 0}점으로 경기를 마무리했습니다.`,
      detailEn: `${winner?.name || "The winner"} closed the match at ${winner?.score || 0} points.`
    })));
  }

  state.sequence += 1;
  return {
    cues,
    impact: highestImpact(impacts),
    highlights: addedHighlights.filter(Boolean),
    resultHighlights: rankPresentationHighlights(state.highlights),
    sequence: state.sequence
  };
}

export function rankPresentationHighlights(highlights, limit = 3) {
  return [...highlights]
    .sort((a, b) => b.weight - a.weight || b.sequence - a.sequence)
    .filter((highlight, index, list) => list.findIndex((item) => item.kind === highlight.kind && item.playerId === highlight.playerId) === index)
    .slice(0, limit);
}

function scoreChanges(previous, current) {
  const results = [];
  for (const player of current.players) {
    const before = previous.players.find((candidate) => candidate.id === player.id);
    if (!before || player.score <= before.score) continue;
    const opponent = current.players.find((candidate) => candidate.id !== player.id);
    const previousOpponent = previous.players.find((candidate) => candidate.id === opponent?.id);
    const amount = player.score - before.score;
    const wasBehindBy = (previousOpponent?.score || 0) - before.score;
    const nowDifference = player.score - (opponent?.score || 0);
    const winning = player.score >= current.victoryScore || current.winnerId === player.id;
    const comeback = wasBehindBy >= 2 && nowDifference >= 0;
    const closing = !winning && player.score >= current.victoryScore - 2 && nowDifference >= 2;
    const titleKo = winning ? "승부를 결정한 득점" : comeback ? "경기를 뒤집은 득점" : closing ? "승기를 굳힌 득점" : amount >= 2 ? "한 번에 만든 대량 득점" : "전장을 가져온 득점";
    const titleEn = winning ? "Match-winning score" : comeback ? "Score that turned the match" : closing ? "Score that locked the lead" : amount >= 2 ? "Multi-point swing" : "Battlefield score";
    results.push(makeHighlight({
      id: `score-${player.id}-${current.turnSequence}-${player.score}`,
      kind: winning ? "finisher" : comeback ? "comeback" : closing ? "lock" : "score",
      playerId: player.id,
      turn: current.turnNumber,
      weight: winning ? 96 : comeback ? 88 : closing ? 76 : amount >= 2 ? 72 : 44,
      titleKo,
      titleEn,
      detailKo: `${player.name}님이 ${amount}점을 획득해 ${player.score}:${opponent?.score || 0}을 만들었습니다.`,
      detailEn: `${player.name} gained ${amount} point${amount === 1 ? "" : "s"} to make it ${player.score}:${opponent?.score || 0}.`,
      winning,
      comeback
    }));
  }
  return results;
}

function removedUnitEvent(previous, current) {
  const currentIds = new Set(current.units.map((unit) => unit.id));
  const removed = previous.units.filter((unit) => !currentIds.has(unit.id));
  const disposed = new Set(current.players.flatMap((player) => [...player.trashIds, ...player.banishedIds]));
  const defeated = removed.filter((unit) => disposed.has(unit.id));
  if (!defeated.length) return null;
  const losses = new Map();
  for (const unit of defeated) losses.set(unit.playerId, (losses.get(unit.playerId) || 0) + 1);
  const [victimId, count] = [...losses.entries()].sort((a, b) => b[1] - a[1])[0];
  const victim = current.players.find((player) => player.id === victimId);
  const actor = current.players.find((player) => player.id !== victimId);
  return makeHighlight({
    id: `removal-${current.turnSequence}-${defeated.map((unit) => unit.id).sort().join("-")}`,
    kind: "sweep",
    playerId: actor?.id,
    turn: current.turnNumber,
    count,
    weight: count >= 3 ? 82 : count === 2 ? 68 : 34,
    titleKo: count >= 2 ? `${count}개 유닛을 쓸어낸 전장 장악` : `${victim?.name || "상대"}의 핵심 유닛 제거`,
    titleEn: count >= 2 ? `Battlefield sweep: ${count} units removed` : `Key unit removed from ${victim?.name || "the opponent"}`,
    detailKo: count >= 2 ? `${actor?.name || "상대"}님이 한 흐름에서 전장을 크게 정리했습니다.` : `${defeated[0].name}이 전장에서 이탈했습니다.`,
    detailEn: count >= 2 ? `${actor?.name || "The opponent"} cleared a major part of the board in one sequence.` : `${defeated[0].name} left the battlefield.`
  });
}

function boardSwingEvent(previous, current) {
  if (previous.phase === "complete" || current.phase === "complete") return null;
  for (const player of current.players) {
    const opponent = current.players.find((candidate) => candidate.id !== player.id);
    const before = boardMight(previous, player.id) - boardMight(previous, opponent?.id);
    const after = boardMight(current, player.id) - boardMight(current, opponent?.id);
    const swing = after - before;
    if (before <= -3 && after >= 2 && swing >= 6) {
      return makeHighlight({
        id: `board-swing-${player.id}-${current.turnSequence}-${after}`,
        kind: "board-swing",
        playerId: player.id,
        turn: current.turnNumber,
        weight: 80,
        titleKo: "전장 주도권을 완전히 뒤집은 플레이",
        titleEn: "A play that completely flipped board control",
        detailKo: `${player.name}님이 전력 열세를 ${Math.abs(after)} 전력 우위로 전환했습니다.`,
        detailEn: `${player.name} turned a losing board into a ${Math.abs(after)} Might advantage.`
      });
    }
  }
  return null;
}

function boardMight(snapshot, playerId) {
  return snapshot.units.filter((unit) => unit.playerId === playerId).reduce((sum, unit) => sum + Math.max(0, unit.might - unit.damage), 0);
}

function unitSnapshot(unit, location, mightOf) {
  return {
    id: unit.instanceId,
    playerId: unit.controllerId || unit.ownerId,
    name: unit.name || "Unit",
    might: Number(mightOf(unit)) || 0,
    damage: unit.damage || 0,
    location
  };
}

function defaultMight(unit) {
  return (unit.might || 0) + (unit.buffs || 0) + (unit.mightModifier || 0);
}

function makeHighlight(data) {
  return { winning: false, comeback: false, count: 0, ...data };
}

function addHighlight(state, highlight) {
  if (!highlight || state.highlightIds.has(highlight.id)) return null;
  state.highlightIds.add(highlight.id);
  state.highlights.push({ ...highlight, sequence: state.sequence });
  state.highlights = state.highlights.slice(-18);
  return highlight;
}

function impact(kind, kicker, titleKo, kickerEn, titleEn) {
  const priorities = { turn: 10, card: 20, trigger: 25, reaction: 30, ambush: 40, strike: 45, score: 55, showdown: 60, counter: 68, sweep: 72, comeback: 82, finisher: 92, defeat: 96, victory: 100 };
  return { kind, kicker, titleKo, kickerEn, titleEn, priority: priorities[kind] || 20 };
}

function highestImpact(impacts) {
  return impacts.sort((a, b) => b.priority - a.priority)[0] || null;
}

function emptyAdvance(state) {
  return { cues: [], impact: null, highlights: [], resultHighlights: rankPresentationHighlights(state.highlights), sequence: state.sequence };
}
