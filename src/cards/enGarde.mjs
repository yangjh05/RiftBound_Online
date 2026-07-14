import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-046",
  collectorNumber: "OGN-046/298",
  name: "En Garde",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Reaction"],
  keywords: ["Reaction"],
  energy: 1,
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-046-298.webp",
  text: "[Reaction] (Play any time, even before spells and abilities resolve.)\nGive a friendly unit +1 Might this turn, then an additional +1 Might this turn if it is the only unit you control there.",
  effects: [
  {
    "timing": "spell",
    "kind": "enGarde"
  }
]
});
