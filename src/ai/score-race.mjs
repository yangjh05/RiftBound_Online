// Public tempo features, not hidden-hand predictions or proof of a forced win.
export function scoreRaceContext(game, actorId) {
  const actor=game.players.find(p=>p.id===actorId),opponent=game.players.find(p=>p.id!==actorId);
  if(!actor||!opponent)return {pressure:0,gap:0,opponentHeld:0,openFields:0,nearVictory:false,exposedFinish:false};
  const victory=game.victoryScore||8;
  const opponentHeld=game.battlefields.filter(f=>f.controlledBy===opponent.id).length;
  const openFields=game.battlefields.filter(f=>f.controlledBy!==opponent.id
    && !f.units.some(c=>c.controllerId===actorId)).length;
  const opponentTurn=game.currentPlayerId===opponent.id;
  const projectedScore=(opponent.score||0)+(opponentTurn?0:opponentHeld);
  const nearVictory=projectedScore>=victory-1;
  const gap=((opponent.score||0)-(actor.score||0))/victory;
  const pressure=Math.min(1,Math.max(0,(projectedScore-(victory-3))/3))
    * Math.min(1,0.75+Math.max(0,gap));
  const publicThreat=Boolean(opponent.champion&&!opponent.championPlayed)
    || [...opponent.base,...game.battlefields.flatMap(f=>f.units)].some(c=>c.controllerId===opponent.id&&c.type==='unit');
  return {pressure,gap,opponentHeld,openFields,nearVictory,
    exposedFinish:nearVictory&&openFields>0&&(publicThreat||(opponent.hand?.length||0)>0)};
}
