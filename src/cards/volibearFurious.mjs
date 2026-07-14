import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-041",
  collectorNumber: "OGN-041/298",
  name: "Volibear, Furious",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Volibear","Freljord"],
  keywords: ["Deflect"],
  energy: 10,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 9,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-041.webp",
  text: "[DEFLECT 2] (Opponents must play Rune Rune to choose me with a spell or effect.)\nWhen I attack, deal 5 damage split among any number of enemy units here.",
  effects: [
      {
          "timing": "static",
          "kind": "deflect",
          "amount": 2
      },
      {
          "timing": "attackOrDefend",
          "role": "attacker",
          "kind": "splitDamageEnemyHere",
          "amount": 5
      }
  ]
});
