import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-133",
  collectorNumber: "OGN-133/298",
  name: "Flurry of Blades",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Reaction"],
  keywords: [],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-133.webp",
  text: "Reaction (Play any time, even before spells and abilities resolve.)\nDeal 1 to all units at battlefields.",
  effects: [
  {
    "timing": "spell",
    "kind": "dealDamageAllBattlefieldUnits",
    "amount": 1
  }
]
});
