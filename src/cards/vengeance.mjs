import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-229",
  collectorNumber: "OGN-229/298",
  name: "Vengeance",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-229.webp",
  text: "Kill a unit.",
  effects: [
  {
    "timing": "spell",
    "kind": "killUnit",
    "target": "unit"
  }
]
});
