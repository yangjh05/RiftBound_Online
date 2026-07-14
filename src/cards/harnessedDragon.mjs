import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-234",
  collectorNumber: "OGN-234/298",
  name: "Harnessed Dragon",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Demacia","Dragon"],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-234.webp",
  text: "When you play me, kill an enemy unit.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "killUnit",
    "target": "enemyUnit"
  }
]
});
