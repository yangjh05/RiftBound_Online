import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-039",
  collectorNumber: "OGN-039/298",
  name: "Kai'Sa, Survivor",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Kai'Sa","The Void"],
  keywords: ["Accelerate"],
  energy: 4,
  power: [],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-039.webp",
  text: "ACCELERATE (You may pay 1 FURY as an additional cost to have me enter ready.)\nWhen I conquer, draw 1.",
  effects: [
    { timing: "score", kind: "draw", reason: "conquer", amount: 1 }
  ]
});
