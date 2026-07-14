import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-123",
  collectorNumber: "OGN-123/298",
  name: "Unchecked Power",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-123-298.webp",
  text: "Exhaust all friendly units, then deal 12 to ALL units at battlefields.",
  effects: [
  {
    "timing": "spell",
    "kind": "exhaustFriendlyUnits"
  },
  {
    "timing": "spell",
    "kind": "dealDamageAllBattlefieldUnits",
    "amount": 12
  }
]
});
