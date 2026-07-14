import { card } from "./shared.mjs";

export default card({
  id: "OGN-285",
  collectorNumber: "OGN-285/298",
  name: "Reaver's Row",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-285.webp?rotate=90&width=3840",
  text: "When you defend here, you may move a friendly unit here to base.",
  effects: [
    {
      timing: "defendHere",
      kind: "returnFriendlyUnitHereToBase",
      optional: true
    }
  ]
});
