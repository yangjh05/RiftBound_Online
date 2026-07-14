import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-308",
  collectorNumber: "OGN-308/298",
  name: "Viktor, Herald of the Arcane",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.ORDER, DOMAINS.MIND],
  tags: ["Viktor"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-308.webp",
  text: "1, Tap: Play a 1 Might Recruit unit token.",
  effects: [
      {
          "timing": "activated",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 1,
          "ready": false,
          "destination": "base",
          "costEnergy": 1,
          "exhaust": true
      }
  ]
});
