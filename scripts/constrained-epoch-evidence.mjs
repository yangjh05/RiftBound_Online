export function epochUpdateEvidence(reports,epoch,beforeHash,afterHash){
  const acceptedBatches=reports.filter(r=>r.epoch===epoch&&r.accepted).length;
  const changed=beforeHash!==afterHash;
  return {passed:acceptedBatches>0&&changed,acceptedBatches,changed,
    reason:!acceptedBatches?'no-minibatch-update':!changed?'unchanged-policy-weights':null};
}
