import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-129",
  collectorNumber: "OGN-129/298",
  name: "Confront",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-129.webp",
  text: "Action (Play on your turn or in showdowns.)\nUnits you play this turn enter ready.\nDraw 1.",
  effects: [
      {
          "timing": "spell",
          "kind": "unitsEnterReadyThisTurn"
      },
      {
          "timing": "spell",
          "kind": "draw",
          "amount": 1
      }
  ]
});
