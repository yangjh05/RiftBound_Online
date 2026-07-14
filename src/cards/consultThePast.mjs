import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-083",
  collectorNumber: "OGN-083/298",
  name: "Consult the Past",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Reaction"],
  keywords: ["Hidden"],
  energy: 4,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-083.webp",
  text: "Hidden (Hide now for Rune to react with later for 0.)\nReaction (Play any time, even before spells and abilities resolve.)\nDraw 2.",
  effects: [
  {
    "timing": "spell",
    "kind": "draw",
    "amount": 2
  }
]
});
