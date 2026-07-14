import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-034",
  collectorNumber: "OGN-034/298",
  name: "Tryndamere, Barbarian",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Tryndamere","Freljord"],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 8,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-034.webp",
  text: "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you score 1 Point.",
  effects: [{ timing: "conquer", kind: "scoreIfExcessDamage", amount: 1, excessDamage: 5 }]
});
