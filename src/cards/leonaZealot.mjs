import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-079",
  collectorNumber: "OGN-079/298",
  name: "Leona, Zealot",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Leona","Mount Targon"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-079.webp",
  text: "If an opponent's score is within 3 points of the Victory Score, I enter ready.\nStunned enemy units here have -8 Might, to a minimum of 1 Might.",
  effects: [
      {
          "timing": "static",
          "kind": "stunnedEnemyHereMight",
          "amount": -8,
          "minMight": 1
      }
  ]
});
