import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-223",
  collectorNumber: "OGN-223/298",
  name: "Peak Guardian",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Mount Targon"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-223.webp",
  text: "When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there. (To buff a unit give it a +1 might if it doesn't already have one.)",
  effects: [
  {
    "timing": "onPlay",
    "kind": "modifySelfMight",
    "amount": 1,
    "buff": true
  }
]
});
