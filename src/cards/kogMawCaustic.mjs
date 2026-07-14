import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-190",
  collectorNumber: "OGN-190/298",
  name: "Kog'Maw, Caustic",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Kog'Maw","The Void"],
  keywords: ["Deathknell"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 1,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-190.webp",
  text: "Deathknell - Deal 4 to all units at my battlefield. (When I die, get the effect)",
  effects: [
  {
    "timing": "death",
    "kind": "dealDamageAllHere",
    "amount": 4
  }
]
});
