import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-212",
  collectorNumber: "OGN-212/298",
  name: "Forge of the Future",
  type: "gear",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-212.webp",
  text: "When you play this, play a 1 might Recruit unit token at your base.\nKill this: Recycle up to 4 cards from trashes.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 1,
          "ready": false,
          "destination": "base"
      }
  ]
});
