import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-095",
  collectorNumber: "OGN-095/298",
  name: "Stupefy",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Reaction"],
  keywords: ["Reaction"],
  energy: 1,
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-095-298.webp",
  text: "[Reaction] (Play any time, even before spells and abilities resolve.)\nGive a unit -1 Might this turn, to a minimum of 1 Might. Draw 1.",
  effects: [
  {
    "timing": "spell",
    "kind": "modifyMight",
    "target": "unit",
    "amount": -1,
    "minMight": 1,
    "draw": 1,
    "temporary": true
  }
]
});
