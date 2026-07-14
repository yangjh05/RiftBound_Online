import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-024",
  collectorNumber: "OGN-024/298",
  name: "Void Seeker",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-024.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nDeal 4 to a unit at a battlefield. Draw 1.",
  effects: [
  {
    "timing": "spell",
    "kind": "dealDamageUnit",
    "target": "battlefieldUnit",
    "amount": 4,
    "draw": 1
  }
]
});
