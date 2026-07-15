import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-098",
  collectorNumber: "OGN-098/298",
  name: "Energy Conduit",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-098.webp",
  text: "Tap: Reaction - Add 1. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Fury",
      "Calm",
      "Mind",
      "Body",
      "Chaos",
      "Order"
    ],
    "restriction": null,
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});
