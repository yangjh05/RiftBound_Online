import { card } from "./shared.mjs";

export default card({
  id: "OGN-290",
  collectorNumber: "OGN-290/298",
  name: "The Arena's Greatest",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-290-298.webp",
  text: "At the start of each player's first Beginning Phase, that player gains 1 point.",
  effects: [
  {
    "timing": "firstBeginning",
    "kind": "gainPoint",
    "amount": 1
  }
]
});
