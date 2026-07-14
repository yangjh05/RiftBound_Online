import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-218",
  collectorNumber: "OGN-218/298",
  name: "Vanguard Captain",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Demacia","Elite"],
  keywords: ["Legion"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-218.webp",
  text: "LEGION - When you play me, play two 1 Might Recruit unit token here. (Get the effect if you've played another card this turn.)",
  effects: [
      {
          "timing": "onPlay",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 2,
          "ready": false,
          "destination": "sourceBattlefield",
          "requiresLegion": true
      }
  ]
});
