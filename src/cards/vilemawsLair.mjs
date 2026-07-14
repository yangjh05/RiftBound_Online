import { card } from "./shared.mjs";

export default card({
  id: "OGN-295",
  collectorNumber: "OGN-295/298",
  name: "Vilemaw's Lair",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-295-298.webp",
  text: "Units can't move from here to base.",
  effects: [
  {
    "timing": "static",
    "kind": "cantMoveFromHereToBase"
  }
]
});
