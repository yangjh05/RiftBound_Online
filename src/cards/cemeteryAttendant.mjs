import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-165",
  collectorNumber: "OGN-165/298",
  name: "Cemetery Attendant",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Shadow Isles","Dog"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-165.webp",
  text: "When you play me, return a unit from your trash to your hand.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "returnTrashUnitToHand",
          "optional": false
      }
  ]
});
