import { card } from "./shared.mjs";

export default card({
  id: "OGN-297",
  collectorNumber: "OGN-297/298",
  name: "Windswept Hillock",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: ["Ganking"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-297.webp?rotate=90&width=3840",
  text: "Units here have GANKING. (They can move from battlefield to battlefield.)",
  effects: [
      {
          "timing": "static",
          "kind": "unitsHereGainKeywords",
          "keywords": [
              "Ganking"
          ]
      }
  ]
});
