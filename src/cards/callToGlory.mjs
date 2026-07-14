import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-207",
  collectorNumber: "OGN-207/298",
  name: "Call to Glory",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Reaction"],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-207.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve.)\nAs you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\nGive a unit +3 Might this turn.",
  additionalCost: { kind: "optionalSpendFriendlyBuffIgnoreCost" },
  effects: [
  {
    "timing": "spell",
    "kind": "modifyMight",
    "target": "unit",
    "amount": 3,
    "temporary": true
  }
]
});
