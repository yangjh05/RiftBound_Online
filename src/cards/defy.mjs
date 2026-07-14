import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-045",
  collectorNumber: "OGN-045/298",
  name: "Defy",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Reaction"],
  keywords: ["Reaction"],
  energy: 1,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-045-298.webp",
  text: "[Reaction] (Play any time, even before spells and abilities resolve.)\nCounter a spell that costs no more than Energy 4 and no more than Power.",
  effects: [
  {
    "timing": "spell",
    "kind": "counterSpell",
    "maxEnergy": 4,
    "maxPower": 1
  }
]
});
