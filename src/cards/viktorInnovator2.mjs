import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-117a",
  collectorNumber: "OGN-117a/298",
  name: "Viktor, Innovator",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Viktor","Zaun"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-117a.webp",
  text: "When you play a card on an opponent's turn, play a 1 Might Recruit unit token in your base.",
  effects: [
    { timing: "cardPlayed", kind: "opponentTurnRecruit", tokenCardNumber: "OGN-273/298", count: 1 }
  ]
});
