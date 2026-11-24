// Generated pool IDs contain wall-clock/random values. Persist their public
// identity and position before payment; never guess between different resources.
const poolSpec = command => command?.kind === 'togglePaymentPoolPower'
  ? ['power','powerId'] : command?.kind === 'togglePaymentPoolEnergy' ? ['energy','energyId'] : null;
const identity = item => ({sourceCardId:item?.sourceCardId??null,domain:item?.domain??null,
  restriction:item?.restriction??null});

export function recordablePaymentCommand(game,actorId,command){
  const result=structuredClone(command),spec=poolSpec(command);
  if(!spec)return result;
  const [poolName,idKey]=spec,pool=game.players.find(p=>p.id===actorId)?.runePool?.[poolName]||[];
  const index=pool.findIndex(item=>item.id===command[idKey]);
  if(index>=0)result.resourceIdentity={pool:poolName,index,...identity(pool[index])};
  return result;
}

export function resolveRecordedPaymentCommand(game,actorId,recorded){
  const command=structuredClone(recorded),spec=poolSpec(command),descriptor=command.resourceIdentity;
  delete command.resourceIdentity;
  if(!spec)return command;
  const [poolName,idKey]=spec,pool=game.players.find(p=>p.id===actorId)?.runePool?.[poolName]||[];
  if(descriptor){
    const item=pool[descriptor.index];
    if(descriptor.pool!==poolName || !Number.isInteger(descriptor.index) || !item
      || JSON.stringify(identity(item))!==JSON.stringify(identity(descriptor)))
      throw new Error('Recorded payment resource identity changed.');
    const existing=pool.find(item=>item.id===command[idKey]);
    if(existing && existing!==item)throw new Error('Recorded payment ID contradicts its identity.');
    command[idKey]=item.id;
  }else if(!pool.some(item=>item.id===command[idKey])){
    if(pool.length!==1)throw new Error('Ambiguous generated payment resource identity.');
    command[idKey]=pool[0].id;
  }
  return command;
}
