export function collectChainTargetIds(item) {
  if (!item) return [];
  const card = item.card || {};
  const trigger = item.trigger || {};
  const triggerData = trigger.data || {};
  const itemData = item.data || {};
  const cardRecords = [
    ...(card.declaredPlayTargets || []),
    ...(card.playResolutionTargets || []),
    ...(card.declaredTargetIdentities || [])
  ];
  const cardChoices = [
    ...(card.declaredPlayChoices || []),
    ...(card.playResolutionChoices || [])
  ];
  const triggerRecords = [
    ...(triggerData.declaredTargets || []),
    ...(triggerData.declaredTargetIdentities || [])
  ];
  const triggerChoices = [...(triggerData.declaredChoices || [])];
  const itemRecords = [
    ...(item.declaredTargets || []),
    ...(item.playOptions?.declaredTargets || []),
    ...(triggerData.allocations || []),
    ...(itemData.allocations || [])
  ];
  const itemChoices = [
    ...(item.declaredChoices || []),
    ...(item.playOptions?.declaredChoices || [])
  ];
  const ids = [
    ...cardRecords.flatMap((record) => targetValues(record)),
    ...cardChoices.flatMap((record) => targetValues(record)),
    ...triggerRecords.flatMap((record) => targetValues(record)),
    ...triggerChoices.flatMap((record) => targetValues(record)),
    ...itemRecords.flatMap((record) => targetValues(record)),
    ...itemChoices.flatMap((record) => targetValues(record)),
    ...targetValues(item, false),
    ...targetValues(trigger, false),
    ...targetValues(triggerData, false),
    ...targetValues(itemData, false),
    ...(item.targetIds || []),
    ...(trigger.targetIds || []),
    ...(triggerData.targetIds || []),
    ...(itemData.targetIds || []),
    item.destination
  ];
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

function targetValues(value = {}, includeCardId = true) {
  return [
    value.targetId,
    includeCardId ? value.cardId : null,
    value.unitId,
    value.battlefieldId,
    value.destinationId
  ];
}
