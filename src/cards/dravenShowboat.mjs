import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-028",
  collectorNumber: "OGN-028/298",
  name: "Draven, Showboat",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Draven","Noxus"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-028.webp",
  text: "My might is increased by your points.",
  effects: [
      {
          "timing": "static",
          "kind": "selfMightByPoints"
      }
  ]
});
