import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-077",
  collectorNumber: "OGN-077/298",
  name: "Zhonya's Hourglass",
  type: "gear",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Hidden"],
  keywords: ["Hidden"],
  energy: 2,
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-077-298.webp",
  text: "[Hidden] (Hide now for Power to react with later for Energy 0.)\nThe next time a friendly unit would die, kill this instead. Recall that unit exhausted. (Send it to base. This isn't a move.)",
  effects: [
  {
    "timing": "replacement",
    "kind": "saveFriendlyUnitByKillingThis"
  }
]
});
