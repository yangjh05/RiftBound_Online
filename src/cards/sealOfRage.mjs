import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-040",
  collectorNumber: "OGN-040/298",
  name: "Seal of Rage",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY],
  tags: [],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-040.webp",
  text: "Tap: REACTION - ADD 1 Fury Power. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "exhaust": true,
    "kind": "addPower",
    "amount": 1,
    "domain": "Fury",
    "restriction": null,
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});
