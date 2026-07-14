import { card } from "./shared.mjs";

export default card({
  id: "OGN-280",
  collectorNumber: "OGN-280/298",
  name: "Grove of the God-Willow",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-280.webp?rotate=90&width=3840",
  text: "When you hold here, draw 1.",
  effects: [
  {
    "timing": "hold",
    "kind": "draw",
    "amount": 1
  }
]
});
