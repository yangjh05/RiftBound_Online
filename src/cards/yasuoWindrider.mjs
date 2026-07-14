import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-205",
  collectorNumber: "OGN-205/298",
  name: "Yasuo, Windrider",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Yasuo","Ionia"],
  keywords: ["Ganking"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-205.webp",
  text: "GANKING (I can move from battlefield to battlefield.)\nThe third time I move in a turn, you score 1 point.",
  effects: [
    {
      timing: "onMove",
      kind: "scoreOnNthMoveEachTurn",
      moveNumber: 3,
      amount: 1
    }
  ]
});
