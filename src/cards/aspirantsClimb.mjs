import { card } from "./shared.mjs";

export default card({
  id: "OGN-276",
  collectorNumber: "OGN-276/298",
  name: "Aspirant's Climb",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-276.webp?rotate=90&width=3840",
  text: "Increase the points needed to win the game by 1.",
  effects: [
    {
      timing: "static",
      kind: "victoryScoreModifier",
      amount: 1
    }
  ]
});
