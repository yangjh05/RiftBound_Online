import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-140",
  collectorNumber: "OGN-140/298",
  name: "Herald of Scales",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Mount Targon"],
  keywords: [],
  energy: 4,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-140.webp",
  text: "Your Dragons' Energy costs are reduced by 2, to a minimum of 1.",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "cardType": "unit",
          "tag": "Dragon",
          "energy": -2,
          "minEnergy": 1
      }
  ]
});
