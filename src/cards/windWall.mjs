import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-064",
  collectorNumber: "OGN-064/298",
  name: "Wind Wall",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Reaction"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-064.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve.)\nCounter a spell.",
  effects: [
  {
    "timing": "spell",
    "kind": "counterSpell"
  }
]
});
