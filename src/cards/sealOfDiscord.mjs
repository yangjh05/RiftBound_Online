import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-204",
  collectorNumber: "OGN-204/298",
  name: "Seal of Discord",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CHAOS],
  tags: ["Reaction"],
  keywords: [],
  energy: 0,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-204.webp",
  text: "Tap: REACTION - ADD Chaos. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Chaos"
    ],
    "restriction": null,
    "nonReactive": true
  }
]
});
