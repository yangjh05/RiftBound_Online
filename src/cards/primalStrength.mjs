import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-154",
  collectorNumber: "OGN-154/298",
  name: "Primal Strength",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Action"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-154.webp",
  text: "Action (Play on your turn or in showdowns.)\nGive a unit +7 Might this turn.",
  effects: [
  {
    "timing": "spell",
    "kind": "modifyMight",
    "target": "unit",
    "amount": 7,
    "temporary": true
  }
]
});
