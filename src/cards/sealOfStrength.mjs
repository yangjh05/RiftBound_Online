import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-163",
  collectorNumber: "OGN-163/298",
  name: "Seal of Strength",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-163.webp",
  text: "Tap: REACTION - ADD 1 Body Power. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "exhaust": true,
    "kind": "addPower",
    "amount": 1,
    "domain": "Body",
    "restriction": null,
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});
