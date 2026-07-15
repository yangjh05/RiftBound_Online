import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-081",
  collectorNumber: "OGN-081/298",
  name: "Seal of Focus",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-081.webp",
  text: "Tap: REACTION - ADD Calm. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Calm"
    ],
    "restriction": null,
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});
