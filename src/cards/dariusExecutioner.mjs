import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-243",
  collectorNumber: "OGN-243/298",
  name: "Darius, Executioner",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Darius","Noxus","Trifarian"],
  keywords: ["Legion"],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-243.webp",
  text: "LEGION - When you play me, ready me. (Get the effect if you've played another card this turn)\nOther friendly units have +1 Might here.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "readySelf",
          "requiresLegion": true
      },
      {
          "timing": "static",
          "kind": "otherFriendlyHereMight",
          "amount": 1
      }
  ]
});
