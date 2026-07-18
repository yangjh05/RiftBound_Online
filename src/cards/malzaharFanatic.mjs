import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-113",
  collectorNumber: "OGN-113/298",
  name: "Malzahar, Fanatic",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Malzahar","The Void"],
  keywords: [],
  energy: 4,
  power: [],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-113.webp",
  text: "Kill a friendly unit or gear, tap: ACTION - ADD 2 Any Power. (Use on your turn or in showdowns. Abilities that add resources can't be reacted to.)",
  effects: [
    {
      timing: "activated",
      exhaust: true,
      kind: "addPower",
      amount: 2,
      domain: DOMAINS.ANY,
      killFriendlyPermanentCost: true,
      abilityKeywords: ["Action"]
    }
  ]
});
