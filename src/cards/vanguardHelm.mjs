import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-228",
  collectorNumber: "OGN-228/298",
  name: "Vanguard Helm",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-228.webp",
  text: "When a buffed friendly unit dies, buff another friendly unit. (If it doesn't have a buff, it gets a +1 might buff.)",
  effects: [
    {
      timing: "death",
      kind: "buffAnotherFriendlyOnBuffedUnitDeath",
      amount: 1
    }
  ]
});
