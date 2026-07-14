import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-082",
  collectorNumber: "OGN-082/298",
  name: "Whiteflame Protector",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM],
  tags: ["Dragon","Mount Targon"],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 8,
  image: "https://exburst.dev/riftbound/cards/sd/OGN-082-298.webp",
  text: "When you play me, give a unit +8 Might this turn.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "modifyMight",
    "target": "unit",
    "amount": 8,
    "temporary": true
  }
]
});
