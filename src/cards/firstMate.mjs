import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-132",
  collectorNumber: "OGN-132/298",
  name: "First Mate",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Pirate","Bilgewater"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://exburst.dev/riftbound/cards/sd/OGN-132-298.webp",
  text: "When you play me, ready another unit.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "readyUnit",
    "target": "anotherUnit"
  }
]
});
