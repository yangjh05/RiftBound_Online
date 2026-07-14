import { card } from "./shared.mjs";

export default card({
  id: "OGN-275",
  collectorNumber: "OGN-275/298",
  name: "Altar to Unity",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-275.webp?rotate=90&width=3840",
  text: "When you hold here, play a 1 Might Recruit unit token in your base.",
  effects: [
      {
          "timing": "hold",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 1,
          "ready": false,
          "destination": "base"
      }
  ]
});
