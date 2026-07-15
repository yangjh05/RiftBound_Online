import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-158",
  collectorNumber: "OGN-158/298",
  name: "Volibear, Imposing",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Volibear","Freljord"],
  keywords: ["Shield","Tank"],
  energy: 12,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 10,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-158.webp",
  text: "[SHIELD 3] (+3 Might while I'm a defender.)\nTANK (I must be assigned combat damage first.)\nWhen an opponent moves to a battlefield other than mine, draw 1. (Bases are not battlefields.)",
  effects: [
    {
      timing: "onMove",
      kind: "drawWhenOpponentMovesToOtherBattlefield",
      amount: 1
    }
  ]
});
