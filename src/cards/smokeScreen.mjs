import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-093",
  collectorNumber: "OGN-093/298",
  name: "Smoke Screen",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Reaction"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-093.webp",
  text: "Reaction (Play any time, even before spells and abilities resolve.)\nGive a unit -4 Might this turn, to a minimum of 1 Might.",
  effects: [
  {
    "timing": "spell",
    "kind": "modifyMight",
    "target": "unit",
    "amount": -4,
    "minMight": 1,
    "temporary": true
  }
]
});
