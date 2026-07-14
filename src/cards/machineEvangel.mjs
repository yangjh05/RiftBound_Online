import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-239",
  collectorNumber: "OGN-239/298",
  name: "Machine Evangel",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Piltover"],
  keywords: ["Deathknell"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-239.webp",
  text: "DEATHKNELL - Play three 1 Might Recruit unit tokens into your base. (When I die, get the effect.)",
  effects: [
      {
          "timing": "death",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 3,
          "ready": false,
          "destination": "base"
      }
  ]
});
