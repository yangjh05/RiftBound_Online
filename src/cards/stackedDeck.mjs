import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-183",
  collectorNumber: "OGN-183/298",
  name: "Stacked Deck",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: ["Action"],
  energy: 1,
  power: [],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-183-298.webp",
  text: "[Action] (Play on your turn or in showdowns.)\nLook at the top 3 cards of your Main Deck. Put 1 into your hand and recycle the rest.",
  effects: [
  {
    "timing": "spell",
    "kind": "chooseTopDeck",
    "look": 3,
    "keep": 1
  }
]
});
