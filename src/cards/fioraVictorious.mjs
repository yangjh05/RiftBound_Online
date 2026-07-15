import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-232",
  collectorNumber: "OGN-232/298",
  name: "Fiora, Victorious",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Fiora","Demacia"],
  keywords: [],
  energy: 4,
  power: [],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-232.webp",
  text: "While I'm Mighty, I have Deflect, Ganking and Shield. (I'm Mighty while I have 5+ Might.)",
  effects: [
      {
          "timing": "static",
          "kind": "gainKeywordsWhileMighty",
          "threshold": 5,
          "keywords": [
              "Deflect",
              "Ganking",
              "Shield"
          ]
      }
  ]
});
