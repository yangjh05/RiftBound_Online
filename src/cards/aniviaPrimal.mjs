import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-148",
  collectorNumber: "OGN-148/298",
  name: "Anivia, Primal",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Anivia","Freljord","Bird"],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 8,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-148.webp",
  text: "When I attack, deal 3 to all enemy units here.",
  effects: [
    { timing: "attackOrDefend", kind: "dealDamageAllEnemiesHere", role: "attacker", amount: 3 }
  ]
});
