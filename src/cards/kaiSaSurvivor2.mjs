import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-039a",
  collectorNumber: "OGN-039a/298",
  name: "Kai'Sa, Survivor",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Kai'Sa","The Void"],
  keywords: ["Accelerate"],
  energy: 4,
  power: [],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-039a.webp",
  text: "ACCELERATE (You may pay 1 Energy and 1 FURY as an additional cost to have me enter ready.)\nWhen I conquer, draw 1.",
  effects: [
    { timing: "score", kind: "draw", reason: "conquer", amount: 1 }
  ]
});
