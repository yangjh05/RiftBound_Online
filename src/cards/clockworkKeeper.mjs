import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-044",
  collectorNumber: "OGN-044/298",
  name: "Clockwork Keeper",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Shurima"],
  keywords: [],
  energy: 2,
  power: [],
  might: 2,
  image: "https://exburst.dev/riftbound/cards/sd/OGN-044-298.webp",
  text: "As you play me, you may pay Calm Power as an additional cost. If you do, draw 1.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "optionalPowerDraw",
    "domain": "Calm",
    "amount": 1,
    "draw": 1
  }
]
});
