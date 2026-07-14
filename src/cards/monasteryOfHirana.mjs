import { card } from "./shared.mjs";

export default card({
  id: "OGN-282",
  collectorNumber: "OGN-282/298",
  name: "Monastery of Hirana",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-282.webp?rotate=90&width=3840",
  text: "When you conquer here, you may spend a buff to draw 1.",
  effects: [
    {
      timing: "conquerHere",
      kind: "spendBuffDraw",
      draw: 1,
      optional: true
    }
  ]
});
