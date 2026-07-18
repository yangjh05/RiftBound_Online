import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-309s",
  collectorNumber: "OGN-309/298",
  cardNumber: "OGN-309s/298",
  name: "Miss Fortune, Bounty Hunter",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.BODY, DOMAINS.CHAOS],
  tags: ["Miss Fortune"],
  keywords: ["Ganking"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-309s.webp",
  text: "Tap: Give a unit GANKING this turn. (It can move from battlefield to battlefield.)",
  effects: [
      {
          "timing": "activated",
          "exhaust": true,
          "kind": "giveKeyword",
          "target": "unit",
          "keywords": [
              "Ganking"
          ]
      }
  ]
});
