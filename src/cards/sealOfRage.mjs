import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-040",
  collectorNumber: "OGN-040/298",
  name: "Seal of Rage",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY],
  tags: ["Reaction"],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-040.webp",
  text: "Tap: REACTION - ADD Fury. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Fury"
    ],
    "restriction": null,
    "nonReactive": true
  }
]
});
