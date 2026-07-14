import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-119",
  collectorNumber: "OGN-119/298",
  name: "Ahri, Inquisitive",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Ahri","Ionia"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-119.webp",
  text: "When I attack or defend, give an enemy unit here -2 Might this turn, to a minimum of 1 Might.",
  effects: [
      {
          "timing": "attackOrDefend",
          "kind": "modifyEnemyHere",
          "amount": -2,
          "minMight": 1,
          "temporary": true
      }
  ]
});
