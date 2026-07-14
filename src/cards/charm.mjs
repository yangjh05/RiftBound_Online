import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-043",
  collectorNumber: "OGN-043/298",
  name: "Charm",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 1,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-043-298.webp",
  text: "Move an enemy unit.",
  effects: [
  {
    "timing": "spell",
    "kind": "moveUnit",
    "target": "enemyUnit"
  }
]
});
