import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-120",
  collectorNumber: "OGN-120/298",
  name: "Seal of Insight",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-120.webp",
  text: "Tap: REACTION - ADD Mind. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Mind"
    ],
    "restriction": null,
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});
