import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-125",
  collectorNumber: "OGN-125/298",
  name: "Bilgewater Bully",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Bilgewater"],
  keywords: [],
  energy: 6,
  power: [],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-125.webp",
  text: "While I'm buffed, I have GANKING. (I can move from battlefield to battlefield.)",
  effects: [
      {
          "timing": "static",
          "kind": "gainKeywordsWhileBuffed",
          "keywords": [
              "Ganking"
          ]
      }
  ]
});
