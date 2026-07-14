import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-092",
  collectorNumber: "OGN-092/298",
  name: "Riptide Rex",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Bilgewater","Pirate"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-092.webp",
  text: "When you play me, deal 6 to an enemy unit at a battlefield.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "dealDamageUnit",
    "target": "enemyBattlefieldUnit",
    "amount": 6
  }
]
});
