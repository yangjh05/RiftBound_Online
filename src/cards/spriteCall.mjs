import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-094",
  collectorNumber: "OGN-094/298",
  name: "Sprite Call",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Action"],
  keywords: ["Temporary","Hidden"],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-094.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nACTION (Play on your turn or in showdowns.)\nPlay a ready 3 Might Sprite unit token with TEMPORARY. (Kill it at the start of its controller's Beginning Phase, before scoring.)",
  effects: [
      {
          "timing": "spell",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-274/298",
          "count": 1,
          "ready": true,
          "destination": "showdownBattlefield"
      }
  ]
});
