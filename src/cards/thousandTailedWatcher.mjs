import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-116",
  collectorNumber: "OGN-116/298",
  name: "Thousand-Tailed Watcher",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Ionia"],
  keywords: ["Accelerate"],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 7,
  image: "https://cdn.piltoverarchive.com/cards/OGN-116.webp",
  text: "Accelerate (You may pay 1 Mind as an additional cost to have me enter ready.)\nWhen you play me, give enemy units -3 Might this turn, to a minimum of 1 Might.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "modifyEnemyUnits",
    "amount": -3,
    "minMight": 1,
    "temporary": true
  }
]
});
