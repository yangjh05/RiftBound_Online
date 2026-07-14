import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-074",
  collectorNumber: "OGN-074/298",
  name: "Taric, Protector",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Taric","Mount Targon"],
  keywords: ["Shield","Tank"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-074.webp",
  text: "Shield (+1 Might while I'm a defender.)\nTank (I must be assigned combat damage first.)\nOther friendly units here have Shield.",
  effects: [
      {
          "timing": "static",
          "kind": "otherFriendlyHereGainKeywords",
          "keywords": [
              "Shield"
          ]
      }
  ]
});
