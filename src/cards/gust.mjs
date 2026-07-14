import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-169",
  collectorNumber: "OGN-169/298",
  name: "Gust",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Reaction"],
  keywords: ["Reaction"],
  energy: 1,
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-169-298.webp",
  text: "[Reaction] (Play any time, even before spells and abilities resolve.)\nReturn a unit at a battlefield with 3 Might or less to its owner's hand.",
  effects: [
  {
    "timing": "spell",
    "kind": "returnBattlefieldUnitToHand",
    "maxMight": 3
  }
]
});
