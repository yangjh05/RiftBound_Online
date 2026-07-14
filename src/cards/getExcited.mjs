import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-008",
  collectorNumber: "OGN-008/298",
  name: "Get Excited!",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-008.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nDiscard 1. Deal its Energy cost as damage to a unit at a battlefield. (Ignore its Power cost.)",
  effects: [
    {
      timing: "spell",
      kind: "discardEnergyDamageUnit"
    }
  ]
});
