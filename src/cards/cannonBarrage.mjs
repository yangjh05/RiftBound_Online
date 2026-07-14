import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-127",
  collectorNumber: "OGN-127/298",
  name: "Cannon Barrage",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Reaction"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-127.webp",
  text: "Reaction (Play any time, even before spells and abilities resolve.)\nDeal 2 to all enemy units in combat.",
  effects: [
    { timing: "spell", kind: "dealDamageAllBattlefieldUnits", scope: "enemyCombat", amount: 2 }
  ]
});
