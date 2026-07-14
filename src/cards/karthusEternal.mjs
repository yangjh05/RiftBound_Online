import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-236",
  collectorNumber: "OGN-236/298",
  name: "Karthus, Eternal",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Shadow Isles","Spirit","Karthus"],
  keywords: ["Deathknell"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-236.webp",
  text: "Your deathknell trigger an additional time",
  effects: [
    {
      timing: "static",
      kind: "deathTriggersAdditionalTime"
    }
  ]
});
