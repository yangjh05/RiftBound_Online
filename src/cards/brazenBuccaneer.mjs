import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-002",
  collectorNumber: "OGN-002/298",
  name: "Brazen Buccaneer",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Bilgewater","Pirate"],
  keywords: [],
  energy: 6,
  power: [],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-002.webp",
  text: "As you play me, you may discard a card as an additional cost. If you do, reduce my cost by 2.",
  additionalCost: { kind: "optionalDiscardEnergyReduction", energyReduction: 2 },
  effects: []
});
