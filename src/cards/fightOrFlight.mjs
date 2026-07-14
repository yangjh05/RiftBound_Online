import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-168",
  collectorNumber: "OGN-168/298",
  name: "Fight or Flight",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: ["Hidden"],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-168.webp",
  text: "Hidden (Hide now for Rune to react with later for 0.)\nAction (Play on your turn or in showdowns.)\nMove a unit from a battlefield to its base.",
  effects: [
  {
    "timing": "spell",
    "kind": "returnUnitToBase",
    "target": "battlefield"
  }
]
});
