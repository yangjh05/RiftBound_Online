import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-051",
  collectorNumber: "OGN-051/298",
  name: "Solari Shieldbearer",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Mount Targon"],
  keywords: [],
  energy: 3,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-051.webp",
  text: "When you play me, stun a unit. (It doesn't deal combat damage this turn.)",
  effects: [
  {
    "timing": "onPlay",
    "kind": "stunUnit",
    "target": "unit"
  }
]
});
