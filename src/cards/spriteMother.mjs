import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-106",
  collectorNumber: "OGN-106/298",
  name: "Sprite Mother",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: ["Fae"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-106.webp",
  text: "When you play me, play a ready 3 Might Sprite unit token with Temporary here. (Kill it at the start of its controller's Beginning Phase, before scoring.)",
  effects: [
      {
          "timing": "onPlay",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-274/298",
          "count": 1,
          "ready": true,
          "destination": "sourceBattlefield"
      }
  ]
});
