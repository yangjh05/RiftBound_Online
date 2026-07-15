import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-058",
  collectorNumber: "OGN-058/298-662921",
  cardNumber: "OGN-058/298",
  name: "Discipline",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Reaction"],
  keywords: ["Reaction"],
  energy: 2,
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/tr_w-828,q-80 (1)_fx_1772139314570.webp",
  text: "[Reaction] (Play any time, even before spells and abilities resolve.)\nGive a unit +2 Might this turn. Draw 1.",
  effects: [
  {
    "timing": "spell",
    "kind": "modifyMight",
    "target": "unit",
    "amount": 2,
    "temporary": true,
    "draw": 1
  }
]
});
