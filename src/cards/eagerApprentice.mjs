import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-084",
  collectorNumber: "OGN-084/298",
  name: "Eager Apprentice",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Piltover"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-084.webp",
  text: "While I'm at a battlefield, the Energy costs for spells you play is reduced by 1, to a minimum of 1.",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "cardType": "spell",
          "energy": -1,
          "minEnergy": 1,
          "sourceAtBattlefield": true
      }
  ]
});
