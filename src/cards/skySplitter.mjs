import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-014",
  collectorNumber: "OGN-014/298",
  name: "Sky Splitter",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-014.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nThis spell's Energy cost is reduced by the highest Might among units you control.\nDeal 5 to a unit at a battlefield.",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "energyByHighestMight": true,
          "minEnergy": 0
      },
      {
          "timing": "spell",
          "kind": "dealDamageUnit",
          "target": "battlefieldUnit",
          "amount": 5
      }
  ]
});
