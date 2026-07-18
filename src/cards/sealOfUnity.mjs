import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-245",
  collectorNumber: "OGN-245/298",
  name: "Seal of Unity",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-245.webp",
  text: "Tap: REACTION - ADD 1 Order Power. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "exhaust": true,
    "kind": "addPower",
    "amount": 1,
    "domain": "Order",
    "restriction": null,
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});
