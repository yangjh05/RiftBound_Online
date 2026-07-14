import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-159",
  collectorNumber: "OGN-159/298",
  name: "Warwick, Hunter",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Warwick","Zaun","Dog"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-159.webp",
  text: "I enter ready.\nWhen I attack, kill all damaged enemy units here.",
  effects: [
      {
          "timing": "static",
          "kind": "entersReady"
      }
  ]
});
