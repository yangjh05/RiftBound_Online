import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-015",
  collectorNumber: "OGN-015/298",
  name: "Captain Farron",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Noxus","Trifarian"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-015.webp",
  text: "Other friendly units here have ASSAULT (+1 Might while they're attackers.)",
  effects: [
      {
          "timing": "static",
          "kind": "otherFriendlyHereGainKeywords",
          "keywords": [
              "Assault"
          ]
      }
  ]
});
