const number=x=>Number.isFinite(x)?x:null;
// Preserve every epoch's acceptance decision. A rejected attempt is a
// measurement of a discarded proposal, not the loss of the saved model.
export function summarizePolicyLossEvent(event,previous=null){
 const m=event.metrics||{},loss=number(m.meanLoss??event.meanLoss);
 if(loss===null)return previous;
 const joint=event.guard?.lessonRetention?.report?.contract==='prospective-joint-ppo-verified-lessons-v1';
 let baseLoss=number(m.meanBaseLoss),rehearsalLoss=number(m.meanPolicyRehearsalContribution),origin='recorded';
 if(baseLoss===null&&rehearsalLoss===null&&joint){
  // This historical contract fixes these coefficients. Never infer a new
  // protocol's decomposition or silently treat missing components as zero.
  const keys=['meanPolicyLoss','meanValueLoss','meanActionValueLoss','meanDiagnosticLoss','meanAnchorKl','meanEntropy'];
  const zeros=['meanTeacherLoss','meanTeacherRankingLoss','meanTeacherActionValueLoss','meanBeliefLoss'];
  if(keys.every(k=>number(m[k])!==null)&&zeros.every(k=>m[k]===0)){
   baseLoss=m.meanPolicyLoss+.5*m.meanValueLoss+.25*m.meanActionValueLoss+.05*m.meanDiagnosticLoss+.05*m.meanAnchorKl-.01*m.meanEntropy;
   rehearsalLoss=loss-baseLoss;origin='reconstructed-joint-v1';
  }else origin='unavailable';
 }else if(baseLoss===null&&rehearsalLoss===null){baseLoss=loss;rehearsalLoss=0;origin='legacy-total';}
 const epoch={epoch:event.epoch??null,at:event.at,loss,baseLoss,rehearsalLoss,origin,accepted:typeof event.accepted==='boolean'?event.accepted:null};
 const epochs=[...(previous?.epochs||[]).filter(e=>e.epoch!==epoch.epoch),epoch].sort((a,b)=>(a.epoch??0)-(b.epoch??0));
 return {iteration:event.iteration,...epoch,epochs,acceptedEpochs:epochs.filter(e=>e.accepted===true).length,
  rejectedEpochs:epochs.filter(e=>e.accepted===false).length,lastAccepted:epochs.filter(e=>e.accepted===true).at(-1)||null};
}
