import { card } from "./shared.mjs";

export default card({
  id: "OGN-289",
  collectorNumber: "OGN-289/298",
  name: "Targon's Peak",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-289-298.webp",
  text: "When you conquer here, ready 2 runes at the end of this turn.",
  effects: [
  {
    "timing": "conquerHere",
    "kind": "readyRunesEndTurn",
    "amount": 2
  }
]
});
