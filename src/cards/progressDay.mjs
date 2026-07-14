import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-114",
  collectorNumber: "OGN-114/298",
  name: "Progress Day",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-114.webp",
  text: "Draw 4.",
  effects: [
  {
    "timing": "spell",
    "kind": "draw",
    "amount": 4
  }
]
});
