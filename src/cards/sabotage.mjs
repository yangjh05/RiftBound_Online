import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-156",
  collectorNumber: "OGN-156/298",
  name: "Sabotage",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 1,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-156-298.webp",
  text: "Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card.",
  effects: [
  {
    "timing": "spell",
    "kind": "recycleOpponentNonUnit"
  }
]
});
