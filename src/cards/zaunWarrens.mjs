import { card } from "./shared.mjs";

export default card({
  id: "OGN-298",
  collectorNumber: "OGN-298/298",
  name: "Zaun Warrens",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-298.webp?rotate=90&width=3840",
  text: "When you conquer here, discard 1, then draw 1.",
  effects: [
    {
      timing: "conquerHere",
      kind: "discardDraw",
      discard: 1,
      draw: 1
    }
  ]
});
