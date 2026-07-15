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
  text: "Kill a friendly unit or gear, tap: action - add rune rune. (Use on your turn or in showdowns. Abilities that add resources can't be reacted to.)",
  effects: [
    {
      timing: "activated",
      kind: "killFriendlyPermanentChannelRune",
      abilityKeywords: ["Action"]
    }
  ]
});
