import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-178",
  collectorNumber: "OGN-178/298",
  name: "Undercover Agent",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: ["Deathknell"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-178.webp",
  text: "DEATHKNELL - Discard 2, then draw 2. (When I die, get the effect.)",
  effects: [
  {
    "timing": "death",
    "kind": "discardDraw",
    "discard": 2,
    "draw": 2
  }
]
});
