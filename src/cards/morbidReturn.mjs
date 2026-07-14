import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-170",
  collectorNumber: "OGN-170/298",
  name: "Morbid Return",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-170.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nReturn a unit from your trash to your hand.",
  effects: [
      {
          "timing": "spell",
          "kind": "returnTrashUnitToHand",
          "optional": false
      }
  ]
});
