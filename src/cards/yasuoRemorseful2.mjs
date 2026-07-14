import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-076a",
  collectorNumber: "OGN-076a/298",
  name: "Yasuo, Remorseful",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Yasuo","Ionia"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-076a.webp",
  text: "When I attack, deal damage equal to my Might to an enemy unit here.",
  effects: [
      {
          "timing": "attackOrDefend",
          "kind": "dealDamageEnemyHere",
          "role": "attacker",
          "amountFromSelfMight": true
      }
  ]
});
