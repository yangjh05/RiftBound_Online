import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-009",
  collectorNumber: "OGN-009/298",
  name: "Hextech Ray",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 1,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-009.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nDeal 3 damage to a unit at a battlefield.",
  effects: [
  {
    "timing": "spell",
    "kind": "dealDamageUnit",
    "target": "battlefieldUnit",
    "amount": 3
  }
]
});
