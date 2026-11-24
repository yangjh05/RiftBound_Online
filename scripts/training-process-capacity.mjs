// A failed process query means capacity is UNKNOWN. It must never mean zero
// live processes, and must not turn a still-pending evaluation into a failure.
export async function queryTrainingCapacity(list,select,{attempts=3,delays=[250,1000],sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const errors=[];
  for(let attempt=0;attempt<attempts;attempt++){
    try{return {known:true,active:select(await list()),attempts:attempt+1,errors};}
    catch(error){errors.push(String(error));if(attempt+1<attempts)await sleep(delays[Math.min(attempt,delays.length-1)]);}
  }
  return {known:false,active:null,attempts,errors};
}
