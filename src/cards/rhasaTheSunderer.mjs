import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-195",
  collectorNumber: "OGN-195/298",
  name: "Rhasa the Sunderer",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Shadow Isles","Spirit"],
  keywords: [],
  energy: 10,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-195.webp",
  text: "I cost 1 less for each card in your trash.",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "energyPerTrash": -1,
          "minEnergy": 0
      }
  ]
});
