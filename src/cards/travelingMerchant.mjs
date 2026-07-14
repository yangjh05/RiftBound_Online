import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-185",
  collectorNumber: "OGN-185/298",
  name: "Traveling Merchant",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: ["Bilgewater"],
  keywords: [],
  energy: 2,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-185.webp",
  text: "When I move, discard 1, then draw 1.",
  effects: [
      {
          "timing": "onMove",
          "kind": "discardDraw",
          "discard": 1,
          "draw": 1
      }
  ]
});
