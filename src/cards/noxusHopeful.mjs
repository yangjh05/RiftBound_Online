import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-012",
  collectorNumber: "OGN-012/298",
  name: "Noxus Hopeful",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Noxus","Trifarian"],
  keywords: ["Legion"],
  energy: 4,
  power: [],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-012.webp",
  text: "LEGION I cost 2 less. (Get the effect if you've played another card this turn.)",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "appliesTo": "self",
          "energy": -2,
          "requiresLegion": true,
          "minEnergy": 0
      }
  ]
});
