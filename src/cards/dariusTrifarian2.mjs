import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-027a",
  collectorNumber: "OGN-027a/298",
  name: "Darius, Trifarian",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Darius","Noxus","Trifarian"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-027a.webp",
  text: "When you play your second card in a turn, give me +2 Might this turn and ready me.",
  effects: [
    { timing: "cardPlayed", kind: "secondCardMightReadySelf", cardNumber: 2, amount: 2, temporary: true }
  ]
});
