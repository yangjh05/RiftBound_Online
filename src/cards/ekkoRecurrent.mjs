import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-110",
  collectorNumber: "OGN-110/298",
  name: "Ekko, Recurrent",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Ekko","Zaun"],
  keywords: ["Accelerate","Deathknell"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-110.webp",
  text: "ACCELERATE (You may pay 1 Mind as an additional cost to have me enter ready.)\nDEATHKNELL - Recycle me to ready your runes. (When I die, get the effect.)",
  effects: [
    {
      timing: "death",
      kind: "recycleSelfReadyRunes",
      amount: 999,
      readyAll: true
    }
  ]
});
