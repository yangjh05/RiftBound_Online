import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-267",
  collectorNumber: "OGN-267/298",
  name: "Miss Fortune, Bounty Hunter",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY, DOMAINS.CHAOS],
  tags: ["Miss Fortune"],
  keywords: ["Ganking"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-267.webp",
  text: "Tap: Give a unit GANKING this turn. (It can move from battlefield to battlefield.)",
  effects: [
      {
          "timing": "activated",
          "kind": "giveKeyword",
          "target": "unit",
          "keywords": [
              "Ganking"
          ]
      }
  ]
});
