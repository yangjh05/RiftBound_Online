import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-211",
  collectorNumber: "OGN-211/298",
  name: "Faithful Manufactor",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Piltover"],
  keywords: [],
  energy: 3,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-211.webp",
  text: "When you play me, play a 1 Might Recruit unit token here.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 1,
          "ready": false,
          "destination": "sourceBattlefield"
      }
  ]
});
