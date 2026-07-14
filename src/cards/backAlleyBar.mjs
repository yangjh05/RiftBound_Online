import { card } from "./shared.mjs";

export default card({
  id: "OGN-277",
  collectorNumber: "OGN-277/298",
  name: "Back-Alley Bar",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-277.webp?rotate=90&width=3840",
  text: "When a unit moves from here, give it +1 Might this turn.",
  effects: [
    {
      timing: "onMove",
      kind: "buffMovedUnit",
      amount: 1
    }
  ]
});
